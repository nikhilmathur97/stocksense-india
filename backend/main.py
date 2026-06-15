"""
Indian Stock Market Platform — FastAPI Backend
"""
import logging
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text as _text
from backend.database import init_db, close_db, get_redis
from backend.routers import stocks, options, screener, websocket, ai_analysis
from backend.routers import paper_trades as paper_trades_router
from backend.routers import news as news_router
from backend.routers import option_suggestions
from backend.routers import backtest as backtest_router
from backend.routers import alerts as alerts_router
from backend.routers.market import stocks_router as market_stocks_router
from backend.routers.market import options_router as market_options_router
from backend.routers.market import trades_router as trades_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("main")

# ── Rate Limiter ──────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])


# ── App Lifespan ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up Indian Stock Market Platform...")

    # Run heavy startup (DB migration, Angel One) in a background task so
    # /health responds immediately and Railway's health check passes.
    async def _startup_tasks():
        try:
            await init_db()
            await get_redis()
            logger.info("DB and Redis connections established")

            # Ensure paper_trades table exists
            try:
                from backend.database import get_db as _get_db
                from backend.routers.paper_trades import ensure_table as _ensure_pt
                async for _db in _get_db():
                    await _ensure_pt(_db)
                    break
                logger.info("✅ Paper trades table ready")
            except Exception as _pt_err:
                logger.warning(f"Paper trades table init failed: {_pt_err}")
        except Exception as e:
            logger.error(f"DB/Redis init error: {e}")

        try:
            from backend.data_fetcher import initialize
            initialize()
            logger.info("Angel One session initialized")
        except Exception as e:
            logger.warning(f"Angel One init skipped: {e}")

    import asyncio as _asyncio
    _asyncio.create_task(_startup_tasks())

    # Start Angel One WebSocket live feed — subscribe to all active stocks
    try:
        import asyncpg
        from backend.data_fetcher import live_feed
        import threading

        db_url = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
        pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
        async with pool.acquire() as conn:
            stocks = await conn.fetch(
                "SELECT symbol, symbol_token FROM stocks WHERE is_active=TRUE AND symbol_token IS NOT NULL AND symbol_token != ''"
            )
        await pool.close()

        tokens = [r["symbol_token"] for r in stocks if r["symbol_token"]]
        if tokens:
            # Angel One WebSocket (blocking) — run in background thread
            # exchangeType key (camelCase) required by SmartWebSocketV2
            token_groups = [{"exchangeType": 1, "tokens": tokens}]
            ws_thread = threading.Thread(
                target=live_feed.connect,
                args=(token_groups,),
                daemon=True,
            )
            ws_thread.start()
            logger.info(f"Angel One WebSocket feed started — {len(tokens)} stocks")

            # REST poll — refreshes all quotes every 2s, publishes to frontend WebSocket
            async def _poll_quotes():
                import asyncio as _asyncio, json as _json
                from datetime import datetime as _dt
                from backend.data_fetcher import get_smart_api
                redis_client = await get_redis()

                token_to_symbol = {dict(s)["symbol_token"]: dict(s)["symbol"] for s in stocks if dict(s).get("symbol_token")}
                all_tokens = list(token_to_symbol.keys())

                while True:
                    try:
                        api = get_smart_api()
                        # Fetch all tokens in batches of 50 (Angel One limit)
                        for i in range(0, len(all_tokens), 50):
                            batch = all_tokens[i:i+50]
                            data = api.getMarketData("FULL", {"NSE": batch})
                            if data and data.get("status") and data.get("data"):
                                for item in data["data"].get("fetched", []):
                                    token = str(item.get("symbolToken", item.get("symboltoken", "")))
                                    sym = token_to_symbol.get(token, "")
                                    if not sym:
                                        continue
                                    ltp = float(item.get("ltp", 0))
                                    if ltp <= 0:
                                        continue
                                    # Angel One returns prev-day close in "close" field
                                    api_close = float(item.get("close", 0))
                                    prev = api_close if api_close > 0 else ltp
                                    # Use Angel One's own netChange/percentChange (most accurate)
                                    net_change = float(item.get("netChange", 0))
                                    pct_change = float(item.get("percentChange", 0))
                                    # Fallback computation if API returns 0
                                    if pct_change == 0 and prev > 0 and prev != ltp:
                                        net_change = round(ltp - prev, 2)
                                        pct_change = round(net_change / prev * 100, 2)
                                    q = {
                                        "type": "tick",
                                        "symbol": sym, "exchange": "NSE",
                                        "ltp": ltp,
                                        "open":   float(item.get("open",  0)),
                                        "high":   float(item.get("high",  0)),
                                        "low":    float(item.get("low",   0)),
                                        "close":  api_close,
                                        "volume": int(item.get("tradeVolume", item.get("tradedQuantity", 0))),
                                        "change": net_change,
                                        "change_pct": pct_change,
                                        "timestamp": _dt.now().isoformat(),
                                    }
                                    # Cache with 30s TTL (refreshed every 2s by poll loop)
                                    # 30s prevents expiry gaps when screener/other endpoints read quotes
                                    await redis_client.setex(f"quote:NSE:{sym}", 30, _json.dumps(q))
                                    # Publish to frontend WebSocket for instant push
                                    await redis_client.publish("live:ticks", _json.dumps(q))
                            await _asyncio.sleep(0.1)  # small gap between batches
                    except Exception as ex:
                        logger.debug(f"Quote poll error: {ex}")
                    await _asyncio.sleep(2)  # poll every 2s for near-real-time updates

            # Auto-screener — runs every 1 min during market hours (9:15–15:30 IST)
            # WHY NOT EVERY SECOND: Screener reads 200 OHLCV candles per stock from
            # PostgreSQL, calculates 15+ indicators, and scores all 68 stocks.
            # A new 1-min candle forms every 60s — running more often gives identical
            # results but hammers the DB (68 queries/sec → crash).
            # PRICES update every 1-2s via the poll loop + WebSocket above.
            async def _auto_screener():
                import asyncio as _asyncio
                from datetime import datetime as _dt, timedelta as _td, timezone as _tz, time as _time
                _IST_OFFSET = _td(hours=5, minutes=30)
                _SCREENER_INTERVAL = 60  # 1 minute — matches 1-min candle formation rate
                _MARKET_OPEN  = _time(9, 15)
                _MARKET_CLOSE = _time(15, 30)

                def _is_market_hours():
                    now_ist = _dt.now(_tz.utc) + _IST_OFFSET
                    return (now_ist.weekday() < 5) and (_MARKET_OPEN <= now_ist.time() <= _MARKET_CLOSE)

                async def _run_once():
                    try:
                        import json as _json
                        from decimal import Decimal as _Decimal
                        from engine.screener import run_screener as _run_screener
                        from backend.database import get_db as _get_db
                        from backend.routers.paper_trades import auto_enter_paper_trades as _auto_pt

                        results = await _run_screener()
                        high_conf = [r for r in results if r.get("probability_score", 0) >= 80]

                        # Persist signals to DB (same as manual /run endpoint)
                        if results:
                            async for _db in _get_db():
                                try:
                                    await _db.execute(_text(
                                        "UPDATE stock_signals SET is_active = FALSE"
                                    ))
                                    for s in results:
                                        await _db.execute(_text("""
                                            INSERT INTO stock_signals (
                                                symbol, exchange, signal_type, timeframe,
                                                probability_score, probability_3d,
                                                probability_7d, probability_15d,
                                                entry_price, target_3d, target_7d,
                                                target_15d, stop_loss,
                                                expected_return_3d, expected_return_7d,
                                                expected_return_15d, risk_reward_ratio,
                                                estimated_hold_days, confidence, category,
                                                top_reasons, risks,
                                                technical_score, volume_score,
                                                price_action_score, options_score,
                                                reasoning, confirmation_checks,
                                                confirmed_count, buy_confirmed,
                                                is_active, created_at
                                            ) VALUES (
                                                :symbol, :exchange, :signal_type, :timeframe,
                                                :probability_score, :probability_3d,
                                                :probability_7d, :probability_15d,
                                                :entry_price, :target_3d, :target_7d,
                                                :target_15d, :stop_loss,
                                                :expected_return_3d, :expected_return_7d,
                                                :expected_return_15d, :risk_reward_ratio,
                                                :estimated_hold_days, :confidence, :category,
                                                :top_reasons, :risks,
                                                :technical_score, :volume_score,
                                                :price_action_score, :options_score,
                                                :reasoning, :confirmation_checks,
                                                :confirmed_count, :buy_confirmed,
                                                TRUE, NOW()
                                            )
                                        """), {
                                            "symbol": s.get("symbol"),
                                            "exchange": s.get("exchange"),
                                            "signal_type": s.get("signal_type"),
                                            "timeframe": s.get("timeframe", "1d"),
                                            "probability_score": s.get("probability_score"),
                                            "probability_3d": s.get("probability_3d"),
                                            "probability_7d": s.get("probability_7d"),
                                            "probability_15d": s.get("probability_15d"),
                                            "entry_price": s.get("entry_price"),
                                            "target_3d": s.get("target_3d"),
                                            "target_7d": s.get("target_7d"),
                                            "target_15d": s.get("target_15d"),
                                            "stop_loss": s.get("stop_loss"),
                                            "expected_return_3d": s.get("expected_return_3d"),
                                            "expected_return_7d": s.get("expected_return_7d"),
                                            "expected_return_15d": s.get("expected_return_15d"),
                                            "risk_reward_ratio": s.get("risk_reward_ratio"),
                                            "estimated_hold_days": s.get("estimated_hold_days", 5),
                                            "confidence": s.get("confidence"),
                                            "category": s.get("category"),
                                            "top_reasons": _json.dumps(s.get("top_reasons") or []),
                                            "risks": _json.dumps(s.get("risks") or []),
                                            "technical_score": s.get("technical_score"),
                                            "volume_score": s.get("volume_score"),
                                            "price_action_score": s.get("price_action_score"),
                                            "options_score": s.get("options_score"),
                                            "reasoning": s.get("reasoning"),
                                            "confirmation_checks": _json.dumps(
                                                s.get("confirmation_checks") or {}
                                            ),
                                            "confirmed_count": s.get("confirmed_count", 0),
                                            "buy_confirmed": bool(s.get("buy_confirmed", False)),
                                        })
                                    await _db.commit()

                                    # Auto-enter paper trades for qualifying signals
                                    entered = await _auto_pt(results, _db)
                                    if entered:
                                        logger.info(f"📊 Auto paper trades: {entered} new position(s) opened")
                                except Exception as _db_err:
                                    logger.error(f"Auto-screener DB save error: {_db_err}")
                                break

                        logger.info(
                            f"✅ Auto-screener done: {len(results)} signals, "
                            f"{len(high_conf)} HIGH confidence (≥80%)"
                        )
                        redis_client = await get_redis()
                        await redis_client.delete("screener:top_picks")
                        await redis_client.delete("screener:results")
                    except Exception as se:
                        logger.error(f"Auto-screener run error: {se}")

                # Wait for DB + Angel One feed to settle
                await _asyncio.sleep(10)

                # Run immediately at startup if market is open
                if _is_market_hours():
                    logger.info("⏰ Auto-screener: startup run (market is open)...")
                    await _run_once()

                while True:
                    await _asyncio.sleep(_SCREENER_INTERVAL)
                    try:
                        if _is_market_hours():
                            logger.info("⏰ Auto-screener: market open — running screener...")
                            await _run_once()
                        else:
                            now_ist = _dt.now(_tz.utc) + _IST_OFFSET
                            logger.debug(
                                f"⏸ Auto-screener: market closed "
                                f"(IST {now_ist.strftime('%H:%M')}) — skipping"
                            )
                    except Exception as ex:
                        logger.error(f"Auto-screener loop error: {ex}")

            # News fetch loop — runs every 60 s, 24/7 (news is not market-hours-only)
            async def _news_loop():
                import asyncio as _asyncio
                import json as _json
                from backend.routers.news import fetch_all_news as _fetch_news
                # Initial fetch after a short delay
                await _asyncio.sleep(5)
                while True:
                    try:
                        items = await _fetch_news()
                        if items:
                            redis_client_sync = await get_redis()
                            await redis_client_sync.setex("news:all", 60, _json.dumps(items))
                            # Publish breaking news to WebSocket clients
                            breaking = [i for i in items if i.get("is_breaking")]
                            for item in breaking[:3]:
                                await redis_client_sync.publish("news:breaking", _json.dumps({
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
                            logger.info(f"📰 News loop: {len(items)} articles, {len(breaking)} breaking")
                    except Exception as _ne:
                        logger.debug(f"News loop error: {_ne}")
                    await _asyncio.sleep(60)

            # Paper trade price monitor — checks open trades every 5 min during market hours
            async def _paper_trade_monitor():
                import asyncio as _asyncio
                from datetime import datetime as _dt, timedelta as _td, timezone as _tz, time as _time
                from backend.database import get_db as _get_db
                from backend.routers.paper_trades import monitor_open_trades as _monitor
                _IST = _td(hours=5, minutes=30)
                _OPEN  = _time(9, 15)
                _CLOSE = _time(15, 35)
                await _asyncio.sleep(30)   # let DB settle before first check
                while True:
                    now_ist = (_dt.now(_tz.utc) + _IST).time()
                    is_mkt = _OPEN <= now_ist <= _CLOSE
                    if is_mkt:
                        try:
                            _rc = await get_redis()
                            async for _db in _get_db():
                                closed = await _monitor(_db, _rc)
                                if closed:
                                    logger.info(f"📊 Paper trade monitor: {closed} trade(s) closed")
                                break
                        except Exception as _me:
                            logger.error(f"Paper trade monitor error: {_me}")
                    await _asyncio.sleep(300)   # every 5 minutes

            import asyncio as _asyncio
            _asyncio.ensure_future(_poll_quotes())
            _asyncio.ensure_future(_auto_screener())
            _asyncio.ensure_future(_news_loop())
            _asyncio.ensure_future(_paper_trade_monitor())
            logger.info("Quote poll loop started — FULL mode, 2s interval, publishes to live:ticks")
            logger.info("Auto-screener started — runs every 1 min during market hours (9:15–15:30 IST)")
            logger.info("News loop started — fetches from 8 sources every 60 s, 24/7")
            logger.info("Paper trade monitor started — checks open trades every 5 min during market hours")

            # Start Alert Engine — monitors live quotes and fires alerts
            try:
                from backend.services.alert_engine import AlertEngine, set_alert_engine
                _redis_for_alerts = await get_redis()
                alert_engine = AlertEngine(_redis_for_alerts)
                set_alert_engine(alert_engine)
                await alert_engine.start()
                logger.info("✅ Alert engine started — monitoring RSI, volume, patterns, MACD, Supertrend")
            except Exception as ae_err:
                logger.warning(f"Alert engine start failed: {ae_err}")
        else:
            logger.warning("No stock tokens found — WebSocket feed not started")
    except Exception as e:
        logger.warning(f"WebSocket feed skipped: {e}")

    yield

    logger.info("Shutting down...")
    # Stop alert engine
    try:
        from backend.services.alert_engine import get_alert_engine
        ae = get_alert_engine()
        if ae:
            await ae.stop()
    except Exception:
        pass
    # Stop WebSocket feed
    try:
        from backend.data_fetcher import live_feed
        live_feed.close()
    except Exception:
        pass
    await close_db()


# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Indian Stock Market Analytics API",
    description="NSE/BSE data — quotes, options, AI signals, technical indicators",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
allowed_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3001",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(stocks.router)
app.include_router(options.router)
app.include_router(screener.router)
app.include_router(websocket.router)
app.include_router(ai_analysis.router)
app.include_router(news_router.router)
app.include_router(option_suggestions.router)
app.include_router(backtest_router.router)
app.include_router(alerts_router.router)
app.include_router(market_stocks_router)
app.include_router(market_options_router)
app.include_router(trades_router)
app.include_router(paper_trades_router.router)


# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "ok",
        "service": "Indian Stock Market Analytics API",
        "version": "1.0.0",
    }


@app.get("/health/detailed", tags=["Health"])
async def detailed_health():
    checks = {"api": "ok", "redis": "unknown", "database": "unknown"}

    try:
        redis = await get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    try:
        from backend.database import engine
        async with engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        content={"status": "ok" if all_ok else "degraded", "checks": checks},
        status_code=200 if all_ok else 503,
    )


# ── Global Exception Handler ──────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "Internal server error"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=os.getenv("BACKEND_HOST", "0.0.0.0"),
        port=int(os.getenv("BACKEND_PORT", 8000)),
        reload=os.getenv("ENVIRONMENT", "development") == "development",
        workers=1,
    )
