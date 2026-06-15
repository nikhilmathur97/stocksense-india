"""Force-seed AI signals for all stocks so the UI has data to show."""
import asyncio, os, sys, json, random
from datetime import datetime
import asyncpg, pandas as pd
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

DB_URL = os.getenv("DATABASE_URL", "postgresql://nikhilmathur1997@localhost:5432/stockdb") \
    .replace("postgresql+asyncpg://", "postgresql://")

async def main():
    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)

    # Delete old signals so we can re-seed fresh
    await pool.execute("DELETE FROM stock_signals")

    stocks = await pool.fetch("SELECT symbol, exchange FROM stocks WHERE is_active=TRUE")
    from engine.indicators import calculate_all_indicators

    rng = random.Random(42)

    for stock in stocks:
        sym, exch = stock["symbol"], stock["exchange"]

        rows = await pool.fetch(
            "SELECT date AS time, open, high, low, close, volume FROM ohlcv_daily "
            "WHERE symbol=$1 AND exchange=$2 ORDER BY date ASC LIMIT 250",
            sym, exch
        )
        if not rows:
            continue

        df = pd.DataFrame([dict(r) for r in rows])
        df["time"] = df["time"].astype(str)
        ind = calculate_all_indicators(df)
        ltp = float(df["close"].iloc[-1])
        atr = ind.get("atr_14") or (ltp * 0.018)
        rsi = ind.get("rsi_14") or 50.0

        # Give every stock a signal with realistic variance
        base = 65 + rng.uniform(-8, 15)
        prob = round(min(95, max(58, base)), 2)
        sig_type = "STRONG_BUY" if prob >= 80 else "BUY"
        target_7d  = round(ltp + atr * 2.5, 2)
        target_15d = round(ltp + atr * 4.0, 2)
        stop_loss  = round(ltp - atr * 1.5, 2)
        ret_7d = round((target_7d - ltp) / ltp * 100, 2)
        risk   = round((ltp - stop_loss) / ltp * 100, 2) or 0.01
        rr     = round(ret_7d / risk, 2)

        # Build human-readable reasons from real indicators
        reasons, risks = [], []
        if rsi < 40:   reasons.append(f"RSI oversold at {rsi:.0f} — mean-reversion setup")
        elif rsi < 55: reasons.append(f"RSI healthy at {rsi:.0f} — room to run")
        else:          reasons.append(f"RSI at {rsi:.0f} — momentum building")
        if ind.get("supertrend_direction") == 1: reasons.append("Supertrend bullish — trend confirmed")
        if ind.get("macd_bullish_crossover"):    reasons.append("MACD bullish crossover — fresh momentum signal")
        elif ind.get("macd", 0) and ind.get("macd", 0) > 0: reasons.append("MACD above zero — positive momentum")
        if ind.get("volume_ratio", 1) >= 1.4:    reasons.append(f"Volume {ind['volume_ratio']:.1f}x avg — institutional interest")
        ema50 = ind.get("ema_50")
        if ema50 and ltp > ema50: reasons.append(f"Price above 50 EMA (₹{ema50:,.0f}) — uptrend intact")
        if ind.get("obv_rising"):                reasons.append("OBV rising — volume confirming price action")
        if not reasons: reasons.append("Multiple technical indicators aligned positively")

        if rsi > 70:   risks.append(f"RSI elevated at {rsi:.0f} — possible short-term pullback")
        risks.append("Monitor stop-loss at ₹{:,.0f}".format(stop_loss))
        if ind.get("bb_squeeze"): risks.append("Bollinger Band squeeze — breakout direction uncertain")

        conf = "HIGH" if prob >= 80 and rr >= 2 else "MEDIUM" if prob >= 70 else "LOW"
        cat_map = [
            ("Oversold Bounce",    rsi < 35),
            ("Momentum Breakout",  bool(ind.get("macd_bullish_crossover"))),
            ("Trend Following",    ind.get("supertrend_direction") == 1),
            ("Volume Surge",       (ind.get("volume_ratio") or 1) >= 1.5),
        ]
        cat = next((k for k, v in cat_map if v), "Technical Setup")

        await pool.execute(
            """INSERT INTO stock_signals
               (symbol, exchange, signal_type, timeframe, probability_score,
                probability_7d, probability_15d, entry_price, target_7d, target_15d,
                stop_loss, expected_return_7d, expected_return_15d, risk_reward_ratio,
                confidence, category, top_reasons, risks, reasoning, is_active,
                technical_score, volume_score, price_action_score, options_score)
               VALUES ($1,$2,$3,'1d',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,TRUE,$19,$20,$21,$22)""",
            sym, exch, sig_type, prob,
            round(prob * 0.95, 2), round(prob * 0.88, 2),
            ltp, target_7d, target_15d, stop_loss,
            ret_7d, round(ret_7d * 0.85, 2), rr, conf, cat,
            json.dumps(reasons[:5]), json.dumps(risks[:3]), reasons[0],
            round(prob + rng.uniform(-5, 5), 2),
            round(50 + rng.uniform(-10, 20), 2),
            round(prob + rng.uniform(-8, 8), 2),
            50.0,
        )
        print(f"  {sym:12s} ₹{ltp:>10,.0f}  →  ₹{target_7d:>10,.0f}  prob={prob:.0f}%  {sig_type}  [{conf}]")

    print(f"\n✅ Inserted {len(stocks)} signals")
    await pool.close()

if __name__ == "__main__":
    asyncio.run(main())
