"""
Seed 250 days of realistic mock OHLCV data for all stocks in the DB.
Also computes technical indicators and AI screener signals.
Run once after DB setup.
"""
import asyncio
import os
import sys
import random
import math
import json
from datetime import date, timedelta

import asyncpg
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

# Current approximate prices for NSE stocks (May 2026 approximate)
SEED_PRICES = {
    "RELIANCE":   2950.0,
    "TCS":        4150.0,
    "INFY":       1820.0,
    "HDFCBANK":   1720.0,
    "ICICIBANK":  1380.0,
    "HINDUNILVR": 2550.0,
    "SBIN":       890.0,
    "BAJFINANCE": 7200.0,
    "WIPRO":      530.0,
    "MARUTI":     13200.0,
    "NIFTY 50":   25400.0,
    "BANKNIFTY":  55800.0,
}

BASE_VOLUMES = {
    "RELIANCE":   4500000,
    "TCS":        2200000,
    "INFY":       3800000,
    "HDFCBANK":   5500000,
    "ICICIBANK":  7200000,
    "HINDUNILVR": 1200000,
    "SBIN":       12000000,
    "BAJFINANCE": 2800000,
    "WIPRO":      4500000,
    "MARUTI":     500000,
    "NIFTY 50":   300000,
    "BANKNIFTY":  200000,
}

DB_URL = os.getenv("DATABASE_URL", "postgresql://nikhilmathur1997@localhost:5432/stockdb") \
    .replace("postgresql+asyncpg://", "postgresql://")


def simulate_ohlcv(days: int, start_price: float, base_volume: int, trend_bias: float = 0.0003):
    """Simulate realistic OHLCV data using a biased geometric random walk."""
    candles = []
    price = start_price
    rng = random.Random(int(start_price))  # deterministic seed per stock

    # Work backwards so the end price is ~ current price
    trading_days = []
    d = date.today()
    count = 0
    while count < days:
        if d.weekday() < 5:  # Mon–Fri only
            trading_days.append(d)
            count += 1
        d -= timedelta(days=1)

    trading_days.reverse()
    # Adjust start price so last day ≈ start_price
    start = start_price * math.exp(-(trend_bias * days))

    p = start
    for day in trading_days:
        daily_ret = rng.gauss(trend_bias, 0.012)  # ~1.2% daily vol
        p_open = p
        p_close = max(p_open * (1 + daily_ret), 1.0)

        intraday_range = rng.uniform(0.005, 0.025)
        p_high = max(p_open, p_close) * (1 + rng.uniform(0, intraday_range))
        p_low  = min(p_open, p_close) * (1 - rng.uniform(0, intraday_range))

        vol_multiplier = rng.lognormvariate(0, 0.4)
        volume = max(int(base_volume * vol_multiplier), 1000)

        candles.append({
            "date": day,
            "open":   round(p_open, 2),
            "high":   round(p_high, 2),
            "low":    round(p_low, 2),
            "close":  round(p_close, 2),
            "volume": volume,
        })
        p = p_close

    return candles


async def seed():
    print("Connecting to database...")
    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)

    stocks = await pool.fetch("SELECT symbol, exchange FROM stocks WHERE is_active = TRUE")
    print(f"Found {len(stocks)} stocks to seed")

    for stock in stocks:
        symbol = stock["symbol"]
        exchange = stock["exchange"]
        start_price = SEED_PRICES.get(symbol, 500.0)
        base_vol = BASE_VOLUMES.get(symbol, 1000000)

        # Check if already seeded
        count = await pool.fetchval(
            "SELECT COUNT(*) FROM ohlcv_daily WHERE symbol=$1 AND exchange=$2",
            symbol, exchange
        )
        if count and count > 100:
            print(f"  {symbol}: already seeded ({count} rows), skipping")
            continue

        candles = simulate_ohlcv(250, start_price, base_vol)
        records = [
            (c["date"], symbol, exchange, c["open"], c["high"], c["low"], c["close"], c["volume"])
            for c in candles
        ]

        await pool.executemany(
            """
            INSERT INTO ohlcv_daily (date, symbol, exchange, open, high, low, close, volume)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (date, symbol, exchange) DO NOTHING
            """,
            records,
        )
        print(f"  {symbol}: seeded {len(records)} daily candles (current ≈ ₹{candles[-1]['close']:,.0f})")

    # Compute indicators + signals for all stocks
    print("\nCalculating technical indicators and AI signals...")
    import pandas as pd
    from engine.indicators import calculate_all_indicators

    signals_inserted = 0
    for stock in stocks:
        symbol = stock["symbol"]
        exchange = stock["exchange"]

        rows = await pool.fetch(
            """
            SELECT date AS time, open, high, low, close, volume
            FROM ohlcv_daily WHERE symbol=$1 AND exchange=$2
            ORDER BY date ASC LIMIT 250
            """,
            symbol, exchange
        )
        if len(rows) < 30:
            continue

        df = pd.DataFrame([dict(r) for r in rows])
        df["time"] = df["time"].astype(str)
        indicators = calculate_all_indicators(df)
        if not indicators:
            continue

        # Store indicators
        await pool.execute(
            """
            INSERT INTO technical_indicators
            (time, symbol, exchange, timeframe,
             ema_9, ema_21, ema_50, ema_200, sma_20, vwap,
             rsi_14, macd, macd_signal, macd_hist,
             bb_upper, bb_middle, bb_lower, atr_14, adx_14,
             obv, volume_sma_20, supertrend, supertrend_direction)
            VALUES (NOW(),$1,$2,'1d',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
            ON CONFLICT (time, symbol, exchange, timeframe) DO NOTHING
            """,
            symbol, exchange,
            indicators.get("ema_9"), indicators.get("ema_21"),
            indicators.get("ema_50"), indicators.get("ema_200"),
            indicators.get("sma_20"), indicators.get("vwap"),
            indicators.get("rsi_14"), indicators.get("macd"),
            indicators.get("macd_signal_line"), indicators.get("macd_hist"),
            indicators.get("bb_upper"), indicators.get("bb_middle"),
            indicators.get("bb_lower"), indicators.get("atr_14"),
            indicators.get("adx_14"), indicators.get("obv"),
            indicators.get("volume_sma_20"),
            indicators.get("supertrend"), indicators.get("supertrend_direction"),
        )

        # Generate AI signal
        ltp = float(df["close"].iloc[-1])
        atr = indicators.get("atr_14") or (ltp * 0.02)
        rsi = indicators.get("rsi_14") or 50
        overall = indicators.get("overall_signal", "NEUTRAL")

        # Score from indicators
        signal_scores = {"STRONG_BUY": 100, "BUY": 75, "NEUTRAL": 50, "SELL": 25, "STRONG_SELL": 0}
        signal_keys = [k for k in indicators if k.endswith("_signal") or k == "macd_crossover"]
        if signal_keys:
            avg = sum(signal_scores.get(indicators[k], 50) for k in signal_keys) / len(signal_keys)
        else:
            avg = 50

        prob = round(max(0, min(100, avg + random.uniform(-5, 5))), 2)
        if prob < 60:
            continue

        sig_type = "STRONG_BUY" if prob >= 80 else "BUY"
        target_7d = round(ltp + atr * 2.5, 2)
        target_15d = round(ltp + atr * 4.0, 2)
        stop_loss = round(ltp - atr * 1.5, 2)
        exp_ret_7d = round((target_7d - ltp) / ltp * 100, 2)
        risk = round((ltp - stop_loss) / ltp * 100, 2)
        rr = round(exp_ret_7d / risk, 2) if risk > 0 else 0

        reasons = []
        if rsi < 40: reasons.append(f"RSI oversold ({rsi:.0f}) — bounce opportunity")
        if indicators.get("macd_bullish_crossover"): reasons.append("MACD bullish crossover — fresh momentum")
        if indicators.get("supertrend_direction") == 1: reasons.append("Supertrend bullish — trend confirmed")
        if indicators.get("volume_ratio", 1) >= 1.5: reasons.append("Above-average volume — institutional interest")
        if indicators.get("ema_50") and ltp > indicators["ema_50"]: reasons.append(f"Above 50 EMA — uptrend intact")
        if not reasons: reasons.append("Technical indicators aligned positively")

        confidence = "HIGH" if prob >= 80 and rr >= 2 else "MEDIUM" if prob >= 70 else "LOW"
        category_map = {
            "Oversold Bounce": rsi < 35,
            "Momentum Breakout": indicators.get("macd_bullish_crossover", False),
            "Trend Following": indicators.get("supertrend_direction") == 1,
        }
        category = next((k for k, v in category_map.items() if v), "Technical Setup")

        await pool.execute(
            """
            INSERT INTO stock_signals
            (symbol, exchange, signal_type, timeframe, probability_score,
             probability_7d, probability_15d, entry_price, target_7d, target_15d,
             stop_loss, expected_return_7d, risk_reward_ratio,
             confidence, category, top_reasons, risks, reasoning, is_active,
             technical_score)
            VALUES ($1,$2,$3,'1d',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE,$18)
            """,
            symbol, exchange, sig_type, prob,
            round(prob * 0.95, 2), round(prob * 0.88, 2),
            ltp, target_7d, target_15d, stop_loss,
            exp_ret_7d, rr,
            confidence, category,
            json.dumps(reasons[:4]),
            json.dumps(["Monitor stop-loss", "Market volatility risk"]),
            reasons[0] if reasons else "",
            round(avg, 2),
        )
        signals_inserted += 1
        print(f"  {symbol}: prob={prob:.0f}% | RSI={rsi:.0f} | {sig_type} | ₹{ltp:,.0f} → ₹{target_7d:,.0f}")

    print(f"\n✅ Done! {signals_inserted} signals generated")
    await pool.close()


if __name__ == "__main__":
    asyncio.run(seed())
