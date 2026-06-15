"""
Walk-forward signal backtester.

For each stock in ohlcv_daily (220+ stocks, ~250 days history):
  - Detect 4 signal types on each day using rolling indicators
  - Evaluate whether the next 7 trading days hit the ATR-based target or stop-loss first
  - Aggregate win rates per category → store in backtest_calibration table

Signal types detected:
  MACD_CROSSOVER  → "Momentum Breakout"
  RSI_OVERSOLD    → "Oversold Bounce"
  ICHIMOKU_BREAK  → "Ichimoku Breakout"
  EMA_TREND       → "Trend Following"
"""
import logging
import os
from typing import Dict, List, Optional

import asyncpg
import numpy as np
import pandas as pd

logger = logging.getLogger("backtester")

CATEGORY_MAP = {
    "MACD_CROSSOVER": "Momentum Breakout",
    "RSI_OVERSOLD": "Oversold Bounce",
    "ICHIMOKU_BREAK": "Ichimoku Breakout",
    "EMA_TREND": "Trend Following",
}

_DB_URL = os.getenv(
    "DATABASE_URL", "postgresql://stockuser:stockpass@localhost:5432/stockdb"
).replace("postgresql+asyncpg://", "postgresql://")


# ── Indicator computation ──────────────────────────────────────────────────────

def _compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    c, h, l = df["close"], df["high"], df["low"]

    df["ema9"]  = c.ewm(span=9,  adjust=False).mean()
    df["ema21"] = c.ewm(span=21, adjust=False).mean()
    df["ema50"] = c.ewm(span=50, adjust=False).mean()

    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    df["macd"]        = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"]   = df["macd"] - df["macd_signal"]

    delta = c.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    rs    = gain / loss.replace(0, np.nan)
    df["rsi"] = 100 - (100 / (1 + rs))

    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    df["atr14"] = tr.rolling(14).mean()

    # Ichimoku cloud top (shifted 26 forward, so index aligns with current bar)
    tenkan = (h.rolling(9).max() + l.rolling(9).min()) / 2
    kijun  = (h.rolling(26).max() + l.rolling(26).min()) / 2
    span_a = ((tenkan + kijun) / 2).shift(26)
    span_b = ((h.rolling(52).max() + l.rolling(52).min()) / 2).shift(26)
    df["cloud_top"] = pd.concat([span_a, span_b], axis=1).max(axis=1)

    return df


# ── Signal detection ───────────────────────────────────────────────────────────

def _detect_signals(df: pd.DataFrame) -> pd.Series:
    """Return a Series of signal labels (or None) for each row."""
    df = _compute_indicators(df)
    n   = len(df)
    out = [None] * n

    for i in range(60, n - 8):   # 60 day warmup, leave 8 days for outcome evaluation
        r  = df.iloc[i]
        pr = df.iloc[i - 1]

        macd_cross     = (pr["macd"] <= pr["macd_signal"]) and (r["macd"] > r["macd_signal"])
        rsi_oversold   = r["rsi"] < 32 and r["macd_hist"] > -1  # avoid free-fall
        ichi_break     = (not pd.isna(r["cloud_top"])) and \
                         r["close"] > r["cloud_top"] and pr["close"] <= pr["cloud_top"]
        ema_trend_entry = (r["ema9"] > r["ema21"] > r["ema50"]) and \
                          (pr["ema9"] <= pr["ema21"])

        if macd_cross:
            out[i] = "MACD_CROSSOVER"
        elif ichi_break:
            out[i] = "ICHIMOKU_BREAK"
        elif rsi_oversold:
            out[i] = "RSI_OVERSOLD"
        elif ema_trend_entry:
            out[i] = "EMA_TREND"

    return pd.Series(out, index=df.index)


# ── Outcome evaluation ─────────────────────────────────────────────────────────

def _evaluate(df: pd.DataFrame, signals: pd.Series) -> List[Dict]:
    outcomes = []
    signal_idx = signals[signals.notna()].index

    for idx in signal_idx:
        pos = df.index.get_loc(idx)
        if pos + 8 > len(df):
            continue

        sig   = signals[idx]
        entry = float(df.at[idx, "close"])
        atr   = float(df.at[idx, "atr14"])

        if pd.isna(atr) or atr <= 0 or entry <= 0:
            continue

        atr_pct    = atr / entry
        target_pct = max(0.05, min(0.10, 2.5 * atr_pct))
        sl_pct     = max(0.02, min(0.04, 1.5 * atr_pct))
        target     = entry * (1 + target_pct)
        stop_loss  = entry * (1 - sl_pct)

        outcome     = "NEITHER"
        outcome_pct = 0.0

        for _, frow in df.iloc[pos + 1 : pos + 8].iterrows():
            hit_target = frow["high"] >= target
            hit_sl     = frow["low"]  <= stop_loss

            if hit_target and hit_sl:
                outcome, outcome_pct = "LOSS", -sl_pct * 100   # conservative
                break
            elif hit_target:
                outcome, outcome_pct = "WIN", target_pct * 100
                break
            elif hit_sl:
                outcome, outcome_pct = "LOSS", -sl_pct * 100
                break

        outcomes.append({
            "signal_type": sig,
            "category":    CATEGORY_MAP.get(sig, "Technical Setup"),
            "outcome":     outcome,
            "outcome_pct": outcome_pct,
        })

    return outcomes


# ── Public API ─────────────────────────────────────────────────────────────────

async def run_backtest(symbol_filter: Optional[List[str]] = None) -> Dict:
    """
    Walk-forward backtest on stocks with ≥80 days of OHLCV history.
    If symbol_filter is provided, only those symbols are tested.
    Returns calibration stats per category and stores them in the DB.
    """
    pool = await asyncpg.create_pool(_DB_URL, min_size=2, max_size=8)
    try:
        async with pool.acquire() as conn:
            if symbol_filter:
                stocks = await conn.fetch("""
                    SELECT symbol, exchange, COUNT(*) AS rows
                    FROM ohlcv_daily
                    WHERE symbol = ANY($1::text[])
                    GROUP BY symbol, exchange
                    HAVING COUNT(*) >= 80
                    ORDER BY rows DESC
                """, symbol_filter)
            else:
                stocks = await conn.fetch("""
                    SELECT symbol, exchange, COUNT(*) AS rows
                    FROM ohlcv_daily
                    GROUP BY symbol, exchange
                    HAVING COUNT(*) >= 80
                    ORDER BY rows DESC
                """)

        all_outcomes: List[Dict] = []

        for stock in stocks:
            sym, exch = stock["symbol"], stock["exchange"]
            try:
                async with pool.acquire() as conn:
                    rows = await conn.fetch("""
                        SELECT date AS time, open, high, low, close, volume
                        FROM ohlcv_daily
                        WHERE symbol = $1 AND exchange = $2
                        ORDER BY date ASC
                    """, sym, exch)

                if len(rows) < 80:
                    continue

                df = pd.DataFrame([dict(r) for r in rows])
                df.columns = [c.lower() for c in df.columns]
                df = df.set_index("time")

                sigs = _detect_signals(df)
                all_outcomes.extend(_evaluate(df, sigs))

            except Exception as e:
                logger.warning(f"Backtest skipped {sym}: {e}")

        if not all_outcomes:
            logger.warning("Backtest: no outcomes generated")
            return {}

        # Aggregate by category
        df_out = pd.DataFrame(all_outcomes)
        calibration: Dict = {}

        for category in df_out["category"].unique():
            decided = df_out[(df_out["category"] == category) & (df_out["outcome"] != "NEITHER")]
            wins   = int((decided["outcome"] == "WIN").sum())
            losses = int((decided["outcome"] == "LOSS").sum())
            total  = wins + losses

            if total < 10:   # skip categories with too little data
                continue

            win_rate  = wins / total
            avg_win   = float(df_out[(df_out["category"] == category) & (df_out["outcome"] == "WIN")]["outcome_pct"].mean()) if wins else 0.0
            avg_loss  = float(df_out[(df_out["category"] == category) & (df_out["outcome"] == "LOSS")]["outcome_pct"].mean()) if losses else 0.0
            expectancy = round(win_rate * avg_win + (1 - win_rate) * avg_loss, 2)

            calibration[category] = {
                "win_rate_7d":     round(win_rate * 100, 1),
                "sample_count":    total,
                "winning_trades":  wins,
                "losing_trades":   losses,
                "avg_win_pct":     round(avg_win, 2),
                "avg_loss_pct":    round(avg_loss, 2),
                "expectancy":      expectancy,
            }

        # Persist to DB
        async with pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS backtest_calibration (
                    category        VARCHAR(60) PRIMARY KEY,
                    win_rate_7d     FLOAT NOT NULL,
                    sample_count    INT   NOT NULL,
                    winning_trades  INT   NOT NULL,
                    losing_trades   INT   NOT NULL,
                    avg_win_pct     FLOAT,
                    avg_loss_pct    FLOAT,
                    expectancy      FLOAT,
                    last_computed   TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            for cat, s in calibration.items():
                await conn.execute("""
                    INSERT INTO backtest_calibration
                        (category, win_rate_7d, sample_count, winning_trades, losing_trades,
                         avg_win_pct, avg_loss_pct, expectancy, last_computed)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
                    ON CONFLICT (category) DO UPDATE SET
                        win_rate_7d    = EXCLUDED.win_rate_7d,
                        sample_count   = EXCLUDED.sample_count,
                        winning_trades = EXCLUDED.winning_trades,
                        losing_trades  = EXCLUDED.losing_trades,
                        avg_win_pct    = EXCLUDED.avg_win_pct,
                        avg_loss_pct   = EXCLUDED.avg_loss_pct,
                        expectancy     = EXCLUDED.expectancy,
                        last_computed  = NOW()
                """, cat, s["win_rate_7d"], s["sample_count"],
                    s["winning_trades"], s["losing_trades"],
                    s["avg_win_pct"], s["avg_loss_pct"], s["expectancy"])

        total_sigs = len(all_outcomes)
        logger.info(f"Backtest done: {total_sigs} signals evaluated, {len(calibration)} categories calibrated")
        return calibration

    finally:
        await pool.close()


async def get_calibration() -> Dict:
    """Fetch stored calibration stats from DB."""
    try:
        pool = await asyncpg.create_pool(_DB_URL, min_size=1, max_size=3)
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT category, win_rate_7d, sample_count, winning_trades, losing_trades,
                       avg_win_pct, avg_loss_pct, expectancy, last_computed
                FROM backtest_calibration
                ORDER BY win_rate_7d DESC
            """)
        await pool.close()
        return {
            r["category"]: {
                "win_rate_7d":    r["win_rate_7d"],
                "sample_count":   r["sample_count"],
                "winning_trades": r["winning_trades"],
                "losing_trades":  r["losing_trades"],
                "avg_win_pct":    r["avg_win_pct"],
                "avg_loss_pct":   r["avg_loss_pct"],
                "expectancy":     r["expectancy"],
                "last_computed":  r["last_computed"].isoformat() if r["last_computed"] else None,
            }
            for r in rows
        }
    except Exception as e:
        logger.error(f"Failed to fetch calibration: {e}")
        return {}
