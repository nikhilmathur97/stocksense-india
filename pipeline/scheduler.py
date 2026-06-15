"""
Data Pipeline Scheduler — APScheduler-based job runner
Runs data collection, indicator calculation, and AI screener jobs
"""

import os
import sys
import json
import asyncio
import logging
import signal
from datetime import datetime, time as dtime
from typing import List, Dict, Any

import pytz
import asyncpg
import redis
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED
from dotenv import load_dotenv

load_dotenv()

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.data_fetcher import (
    initialize as init_angel_one,
    get_bulk_quotes,
    get_options_chain,
    get_market_status,
    get_historical_ohlcv,
    NSE, BSE,
)

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("pipeline")

# ── Config ───────────────────────────────────────────────────────────────────
IST = pytz.timezone("Asia/Kolkata")
DB_URL = os.getenv("DATABASE_URL", "postgresql://stockuser:stockpass@localhost:5432/stockdb")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# ── Redis Client ─────────────────────────────────────────────────────────────
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)

# ── Database Pool ────────────────────────────────────────────────────────────
db_pool: asyncpg.Pool = None


async def get_db_pool() -> asyncpg.Pool:
    global db_pool
    if db_pool is None:
        db_pool = await asyncpg.create_pool(
            DB_URL.replace("postgresql+asyncpg://", "postgresql://"),
            min_size=5,
            max_size=20,
            command_timeout=60,
        )
    return db_pool


# ── Circuit Breaker ──────────────────────────────────────────────────────────
class CircuitBreaker:
    def __init__(self, failure_threshold: int = 5, reset_timeout: int = 300):
        self.failure_count = 0
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.last_failure_time = None
        self.is_open = False

    def record_failure(self):
        self.failure_count += 1
        self.last_failure_time = datetime.now()
        if self.failure_count >= self.failure_threshold:
            self.is_open = True
            logger.error(f"🔴 Circuit breaker OPEN after {self.failure_count} failures")

    def record_success(self):
        self.failure_count = 0
        self.is_open = False

    def can_execute(self) -> bool:
        if not self.is_open:
            return True
        elapsed = (datetime.now() - self.last_failure_time).seconds
        if elapsed >= self.reset_timeout:
            self.is_open = False
            self.failure_count = 0
            logger.info("🟢 Circuit breaker RESET")
            return True
        return False


circuit_breaker = CircuitBreaker()


# ── Helper: Is Market Open ────────────────────────────────────────────────────
def is_market_open() -> bool:
    now = datetime.now(IST)
    if now.weekday() >= 5:  # Weekend
        return False
    market_open = dtime(9, 15)
    market_close = dtime(15, 30)
    current_time = now.time()
    return market_open <= current_time <= market_close


# ── Helper: Get All Active Stocks ────────────────────────────────────────────
async def get_active_stocks() -> List[Dict]:
    """Fetch all active stocks from database"""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT symbol, exchange, symbol_token FROM stocks WHERE is_active = TRUE ORDER BY symbol"
        )
        return [dict(r) for r in rows]


# ── JOB 1: Fetch Live Quotes (Every Minute, Market Hours) ────────────────────
async def job_fetch_live_quotes():
    """Fetch live quotes for all active stocks and store in DB + Redis"""
    if not is_market_open():
        return

    if not circuit_breaker.can_execute():
        logger.warning("Circuit breaker open — skipping quote fetch")
        return

    try:
        logger.info("📊 Fetching live quotes...")
        stocks = await get_active_stocks()

        # Batch into groups of 50 (Angel One API limit)
        batch_size = 50
        all_quotes = []

        for i in range(0, len(stocks), batch_size):
            batch = stocks[i:i + batch_size]
            symbols_payload = [
                {
                    "exchange": s["exchange"],
                    "tradingsymbol": f"{s['symbol']}-EQ" if s["exchange"] == NSE else s["symbol"],
                    "symboltoken": s["symbol_token"] or "",
                }
                for s in batch
            ]

            try:
                quotes = get_bulk_quotes(symbols_payload)
                all_quotes.extend(quotes)
            except Exception as e:
                logger.error(f"Batch quote fetch error: {e}")
                circuit_breaker.record_failure()
                continue

        # Store in TimescaleDB
        if all_quotes:
            await _store_ohlcv_1min(all_quotes)
            circuit_breaker.record_success()
            logger.info(f"✅ Stored {len(all_quotes)} quotes")

    except Exception as e:
        logger.error(f"job_fetch_live_quotes error: {e}")
        circuit_breaker.record_failure()
        await _send_telegram_alert(f"❌ Quote fetch job failed: {e}")


async def _store_ohlcv_1min(quotes: List[Dict]):
    """Batch insert OHLCV data into TimescaleDB"""
    pool = await get_db_pool()
    now = datetime.now(IST)

    records = [
        (
            now,
            q["symbol"],
            q["exchange"],
            q.get("open", q.get("ltp", 0)),
            q.get("high", q.get("ltp", 0)),
            q.get("low", q.get("ltp", 0)),
            q.get("ltp", 0),
            q.get("volume", 0),
        )
        for q in quotes
        if q.get("ltp", 0) > 0
    ]

    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO ohlcv_1min (time, symbol, exchange, open, high, low, close, volume)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (time, symbol, exchange) DO UPDATE
            SET close = EXCLUDED.close, volume = EXCLUDED.volume,
                high = GREATEST(ohlcv_1min.high, EXCLUDED.high),
                low = LEAST(ohlcv_1min.low, EXCLUDED.low)
            """,
            records,
        )


# ── JOB 2: Calculate Technical Indicators (Every Minute) ─────────────────────
async def job_calculate_indicators():
    """Calculate and store technical indicators for all active stocks"""
    if not is_market_open():
        return

    try:
        logger.info("📐 Calculating technical indicators...")
        # Import here to avoid circular imports
        from engine.indicators import calculate_all_indicators

        stocks = await get_active_stocks()
        pool = await get_db_pool()

        processed = 0
        for stock in stocks[:200]:  # Process top 200 stocks per minute
            try:
                # Get recent OHLCV data (last 200 candles for indicator calculation)
                async with pool.acquire() as conn:
                    rows = await conn.fetch(
                        """
                        SELECT time, open, high, low, close, volume
                        FROM ohlcv_1min
                        WHERE symbol = $1 AND exchange = $2
                        ORDER BY time DESC LIMIT 200
                        """,
                        stock["symbol"], stock["exchange"]
                    )

                if len(rows) < 20:
                    continue

                import pandas as pd
                df = pd.DataFrame([dict(r) for r in rows])
                df = df.sort_values("time").reset_index(drop=True)

                indicators = calculate_all_indicators(df)

                # Store latest indicator values
                async with pool.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO technical_indicators
                        (time, symbol, exchange, timeframe,
                         ema_9, ema_21, ema_50, ema_200, sma_20, vwap,
                         rsi_14, macd, macd_signal, macd_hist,
                         bb_upper, bb_middle, bb_lower, atr_14, adx_14,
                         obv, volume_sma_20, supertrend, supertrend_direction)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
                        ON CONFLICT (time, symbol, exchange, timeframe) DO UPDATE
                        SET ema_9=EXCLUDED.ema_9, rsi_14=EXCLUDED.rsi_14,
                            macd=EXCLUDED.macd, macd_signal=EXCLUDED.macd_signal
                        """,
                        datetime.now(IST),
                        stock["symbol"], stock["exchange"], "1m",
                        indicators.get("ema_9"), indicators.get("ema_21"),
                        indicators.get("ema_50"), indicators.get("ema_200"),
                        indicators.get("sma_20"), indicators.get("vwap"),
                        indicators.get("rsi_14"), indicators.get("macd"),
                        indicators.get("macd_signal"), indicators.get("macd_hist"),
                        indicators.get("bb_upper"), indicators.get("bb_middle"),
                        indicators.get("bb_lower"), indicators.get("atr_14"),
                        indicators.get("adx_14"), indicators.get("obv"),
                        indicators.get("volume_sma_20"),
                        indicators.get("supertrend"), indicators.get("supertrend_direction"),
                    )

                processed += 1

            except Exception as e:
                logger.debug(f"Indicator calc error for {stock['symbol']}: {e}")
                continue

        logger.info(f"✅ Indicators calculated for {processed} stocks")

    except Exception as e:
        logger.error(f"job_calculate_indicators error: {e}")


# ── JOB 3: Run AI Screener (Every Minute) ────────────────────────────────────
async def job_run_screener():
    """Run AI probability screener and publish top signals"""
    if not is_market_open():
        return

    try:
        logger.info("🤖 Running AI screener...")
        from engine.screener import run_screener

        results = await run_screener()

        if results:
            # Store ALL results (up to 200) in Redis with a 60-second TTL so
            # the /api/screener/signals endpoint always serves data that is at
            # most 1 minute old.  Previously only 50 results were stored with a
            # 120-second TTL, which caused the API to serve stale/incomplete
            # data for up to 2 minutes.
            redis_client.setex(
                "screener:results",
                60,                          # 60 s TTL — matches 1-min job cadence
                json.dumps(results[:200])    # store full set (was [:50])
            )

            # Also invalidate the top-picks cache so it rebuilds from fresh data
            redis_client.delete("screener:top_picks")

            # Publish top signals to WebSocket clients
            top_signals = [r for r in results if r.get("probability_7d", 0) >= 85]
            for signal in top_signals[:5]:
                redis_client.publish("screener:signals", json.dumps({
                    "type": "signal",
                    "symbol": signal["symbol"],
                    "message": f"🚀 {signal['symbol']} — {signal['probability_7d']:.0f}% probability BUY signal",
                    "probability": signal["probability_7d"],
                    "entry": signal.get("entry_price"),
                    "target": signal.get("target_7d"),
                    "stop_loss": signal.get("stop_loss"),
                }))

            logger.info(f"✅ Screener found {len(results)} stocks, {len(top_signals)} high-probability signals")

    except Exception as e:
        logger.error(f"job_run_screener error: {e}")


# ── JOB 3b: Fetch Market News (Every Minute) ─────────────────────────────────
async def job_fetch_news():
    """Fetch and cache market news from all sources every minute."""
    try:
        logger.info("📰 Fetching market news...")
        from backend.routers.news import fetch_all_news
        import json as _json

        items = await fetch_all_news()
        if items:
            redis_client.setex("news:all", 60, _json.dumps(items))

            # Publish breaking news items to WebSocket clients
            breaking = [i for i in items if i.get("is_breaking")]
            for item in breaking[:3]:
                redis_client.publish("news:breaking", _json.dumps({
                    "type": "news",
                    "title": item["title"],
                    "summary": item["summary"],
                    "url": item["url"],
                    "source": item["source"],
                    "source_type": item["source_type"],
                    "published_at": item["published_at"],
                    "symbols": item.get("symbols", []),
                    "sentiment": item.get("sentiment", "NEUTRAL"),
                    "is_breaking": True,
                }))

            logger.info(f"✅ News fetched: {len(items)} articles, {len(breaking)} breaking")
    except Exception as e:
        logger.error(f"job_fetch_news error: {e}")


# ── JOB 4: Fetch Options Chain (Every 5 Minutes) ─────────────────────────────
async def job_fetch_options_chain():
    """Fetch and store options chain for F&O stocks"""
    if not is_market_open():
        return

    fo_symbols = ["NIFTY 50", "BANKNIFTY", "RELIANCE", "TCS", "INFY",
                  "HDFCBANK", "ICICIBANK", "SBIN", "BAJFINANCE", "WIPRO"]

    try:
        logger.info("📋 Fetching options chain data...")
        pool = await get_db_pool()

        for symbol in fo_symbols:
            try:
                chain = get_options_chain(symbol)
                if not chain:
                    continue

                # Store options data
                records = []
                now = datetime.now(IST)

                for strike_str, ce_data in chain.get("calls", {}).items():
                    records.append((
                        now, symbol, None, float(strike_str), "CE",
                        ce_data["ltp"], ce_data["oi"], ce_data["change_in_oi"],
                        ce_data["volume"], ce_data["iv"],
                        ce_data["delta"], ce_data["gamma"], ce_data["theta"], ce_data["vega"],
                        ce_data["bid"], ce_data["ask"], chain["underlying_price"]
                    ))

                for strike_str, pe_data in chain.get("puts", {}).items():
                    records.append((
                        now, symbol, None, float(strike_str), "PE",
                        pe_data["ltp"], pe_data["oi"], pe_data["change_in_oi"],
                        pe_data["volume"], pe_data["iv"],
                        pe_data["delta"], pe_data["gamma"], pe_data["theta"], pe_data["vega"],
                        pe_data["bid"], pe_data["ask"], chain["underlying_price"]
                    ))

                if records:
                    async with pool.acquire() as conn:
                        await conn.executemany(
                            """
                            INSERT INTO options_chain
                            (timestamp, symbol, expiry_date, strike_price, option_type,
                             ltp, oi, change_in_oi, volume, iv, delta, gamma, theta, vega,
                             bid, ask, underlying_price)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                            ON CONFLICT DO NOTHING
                            """,
                            records,
                        )

                # Cache PCR in Redis
                redis_client.setex(
                    f"pcr:{symbol}",
                    300,
                    json.dumps({"pcr": chain["pcr"], "max_pain": chain["max_pain"]})
                )

            except Exception as e:
                logger.error(f"Options chain error for {symbol}: {e}")
                continue

        logger.info(f"✅ Options chain updated for {len(fo_symbols)} symbols")

    except Exception as e:
        logger.error(f"job_fetch_options_chain error: {e}")


# ── JOB 5: Detect Unusual OI Activity (Every 5 Minutes) ──────────────────────
async def job_detect_unusual_oi():
    """Detect unusual OI buildup (>50% change in 30 mins)"""
    if not is_market_open():
        return

    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            unusual = await conn.fetch(
                """
                SELECT symbol, strike_price, option_type,
                       oi as current_oi,
                       LAG(oi, 6) OVER (PARTITION BY symbol, strike_price, option_type ORDER BY timestamp) as prev_oi,
                       ROUND(((oi - LAG(oi, 6) OVER (PARTITION BY symbol, strike_price, option_type ORDER BY timestamp))
                              / NULLIF(LAG(oi, 6) OVER (PARTITION BY symbol, strike_price, option_type ORDER BY timestamp), 0)) * 100, 2) as oi_change_pct
                FROM options_chain
                WHERE timestamp > NOW() - INTERVAL '35 minutes'
                ORDER BY oi_change_pct DESC NULLS LAST
                LIMIT 20
                """
            )

        unusual_list = [dict(r) for r in unusual if r.get("oi_change_pct", 0) and r["oi_change_pct"] > 50]

        if unusual_list:
            redis_client.setex("options:unusual_oi", 300, json.dumps(unusual_list))
            logger.info(f"⚠️ Found {len(unusual_list)} unusual OI activities")

    except Exception as e:
        logger.error(f"job_detect_unusual_oi error: {e}")


# ── JOB 6: End of Day Processing (3:35 PM IST) ───────────────────────────────
async def job_end_of_day():
    """End of day: calculate daily OHLCV, generate summary"""
    logger.info("🌙 Running end-of-day processing...")

    try:
        pool = await get_db_pool()
        today = datetime.now(IST).date()

        # Aggregate 1-min data to daily OHLCV
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ohlcv_daily (date, symbol, exchange, open, high, low, close, volume)
                SELECT
                    $1::date,
                    symbol,
                    exchange,
                    FIRST(open, time) as open,
                    MAX(high) as high,
                    MIN(low) as low,
                    LAST(close, time) as close,
                    SUM(volume) as volume
                FROM ohlcv_1min
                WHERE time::date = $1
                GROUP BY symbol, exchange
                ON CONFLICT (date, symbol, exchange) DO UPDATE
                SET open=EXCLUDED.open, high=EXCLUDED.high,
                    low=EXCLUDED.low, close=EXCLUDED.close, volume=EXCLUDED.volume
                """,
                today,
            )

        # Deactivate old signals
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE stock_signals SET is_active = FALSE WHERE created_at < NOW() - INTERVAL '15 days'"
            )

        logger.info("✅ End-of-day processing complete")
        await _send_telegram_alert("✅ End-of-day processing complete for " + str(today))

    except Exception as e:
        logger.error(f"job_end_of_day error: {e}")
        await _send_telegram_alert(f"❌ End-of-day job failed: {e}")


# ── JOB 7: Startup — Sync Stock Master List ───────────────────────────────────
async def job_sync_stock_master():
    """Sync master stock list from NSE/BSE on startup"""
    logger.info("🔄 Syncing stock master list...")

    try:
        from backend.data_fetcher import search_symbol

        # Popular NSE stocks to ensure are in DB
        popular_symbols = [
            "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK",
            "HINDUNILVR", "SBIN", "BAJFINANCE", "WIPRO", "MARUTI",
            "ADANIENT", "ADANIPORTS", "AXISBANK", "BHARTIARTL", "BPCL",
            "CIPLA", "COALINDIA", "DIVISLAB", "DRREDDY", "EICHERMOT",
            "GRASIM", "HCLTECH", "HEROMOTOCO", "HINDALCO", "INDUSINDBK",
            "JSWSTEEL", "KOTAKBANK", "LT", "M&M", "NESTLEIND",
            "NTPC", "ONGC", "POWERGRID", "SUNPHARMA", "TATAMOTORS",
            "TATASTEEL", "TECHM", "TITAN", "ULTRACEMCO", "UPL",
        ]

        pool = await get_db_pool()

        for symbol in popular_symbols:
            results = search_symbol(symbol, NSE)
            for r in results:
                if r["symbol"] == symbol:
                    async with pool.acquire() as conn:
                        await conn.execute(
                            """
                            INSERT INTO stocks (symbol, name, exchange, symbol_token, instrument_type)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (symbol, exchange) DO UPDATE
                            SET symbol_token = EXCLUDED.symbol_token,
                                updated_at = NOW()
                            """,
                            r["symbol"], r["name"], r["exchange"],
                            r["token"], r["instrument_type"]
                        )
                    break

        logger.info(f"✅ Stock master synced: {len(popular_symbols)} symbols")

    except Exception as e:
        logger.error(f"job_sync_stock_master error: {e}")


# ── Telegram Alert Helper ─────────────────────────────────────────────────────
async def _send_telegram_alert(message: str):
    """Send alert via Telegram bot"""
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")

    if not bot_token or not chat_id:
        return

    try:
        import aiohttp
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        async with aiohttp.ClientSession() as session:
            await session.post(url, json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"})
    except Exception as e:
        logger.error(f"Telegram alert failed: {e}")


# ── Job Event Listener ────────────────────────────────────────────────────────
def job_listener(event):
    if event.exception:
        logger.error(f"Job {event.job_id} failed: {event.exception}")
    else:
        logger.debug(f"Job {event.job_id} completed successfully")


# ── Main Scheduler ────────────────────────────────────────────────────────────
async def main():
    """Initialize and start the scheduler"""
    logger.info("🚀 Starting Indian Stock Market Data Pipeline...")

    # Initialize Angel One connection
    init_angel_one()

    # Initialize DB pool
    await get_db_pool()

    # Run startup jobs
    await job_sync_stock_master()

    # Create scheduler
    scheduler = AsyncIOScheduler(timezone=IST)
    scheduler.add_listener(job_listener, EVENT_JOB_ERROR | EVENT_JOB_EXECUTED)

    # ── Every minute during market hours ──────────────────────────────────────
    scheduler.add_job(
        job_fetch_live_quotes,
        trigger=CronTrigger(minute="*", hour="9-15", day_of_week="mon-fri", timezone=IST),
        id="fetch_quotes",
        name="Fetch Live Quotes",
        max_instances=1,
        coalesce=True,
    )

    scheduler.add_job(
        job_calculate_indicators,
        trigger=CronTrigger(minute="*", hour="9-15", day_of_week="mon-fri", timezone=IST),
        id="calc_indicators",
        name="Calculate Indicators",
        max_instances=1,
        coalesce=True,
    )

    scheduler.add_job(
        job_run_screener,
        trigger=CronTrigger(minute="*/1", hour="9-15", day_of_week="mon-fri", timezone=IST),
        id="run_screener",
        name="Run AI Screener",
        max_instances=1,
        coalesce=True,
    )

    # News runs every minute all day (not just market hours — news is 24/7)
    scheduler.add_job(
        job_fetch_news,
        trigger=CronTrigger(minute="*", timezone=IST),
        id="fetch_news",
        name="Fetch Market News",
        max_instances=1,
        coalesce=True,
    )

    # ── Every 5 minutes ───────────────────────────────────────────────────────
    scheduler.add_job(
        job_fetch_options_chain,
        trigger=CronTrigger(minute="*/5", hour="9-15", day_of_week="mon-fri", timezone=IST),
        id="fetch_options",
        name="Fetch Options Chain",
        max_instances=1,
        coalesce=True,
    )

    scheduler.add_job(
        job_detect_unusual_oi,
        trigger=CronTrigger(minute="*/5", hour="9-15", day_of_week="mon-fri", timezone=IST),
        id="detect_unusual_oi",
        name="Detect Unusual OI",
        max_instances=1,
        coalesce=True,
    )

    # ── End of day (3:35 PM IST) ──────────────────────────────────────────────
    scheduler.add_job(
        job_end_of_day,
        trigger=CronTrigger(hour=15, minute=35, day_of_week="mon-fri", timezone=IST),
        id="end_of_day",
        name="End of Day Processing",
        max_instances=1,
    )

    # ── Daily stock master sync (8 AM) ────────────────────────────────────────
    scheduler.add_job(
        job_sync_stock_master,
        trigger=CronTrigger(hour=8, minute=0, day_of_week="mon-fri", timezone=IST),
        id="sync_master",
        name="Sync Stock Master",
        max_instances=1,
    )

    scheduler.start()
    logger.info("✅ Scheduler started with all jobs")

    # ── Graceful shutdown ─────────────────────────────────────────────────────
    loop = asyncio.get_event_loop()

    def shutdown(sig, frame):
        logger.info("Shutting down scheduler...")
        scheduler.shutdown(wait=False)
        if db_pool:
            loop.run_until_complete(db_pool.close())
        loop.stop()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Keep running
    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Pipeline stopped")


if __name__ == "__main__":
    asyncio.run(main())
