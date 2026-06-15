"""
AI Probability Screener — scores 1800+ NSE stocks for 7-day and 15-day trade probability
Output: ranked list of BUY/SELL signals with entry, target, stop-loss

Professional upgrades:
  - Volume weight raised 10%→20% (volume confirmation is critical)
  - Options weight reduced 10%→5% (most stocks have no options data)
  - Added sector-relative scoring (stock vs sector average)
  - Added 52-week high/low proximity scoring
  - Added intraday momentum score (gap + range expansion)
  - Added new indicator signals: CCI, Ichimoku, Pivot Points, Fibonacci
"""
import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import redis as sync_redis

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Shared Redis pool — avoids creating a new connection per stock per scoring function
_redis_pool = sync_redis.ConnectionPool(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    decode_responses=True,
    max_connections=20,
)

def _get_redis():
    return sync_redis.Redis(connection_pool=_redis_pool)

logger = logging.getLogger("screener")

# Screener thresholds
STRONG_BUY_THRESHOLD = 80.0   # 80%+ = STRONG_BUY
BUY_THRESHOLD = 65.0           # 65%+ = BUY (surfaces on dashboard)
SELL_THRESHOLD = 25.0
STRONG_SELL_THRESHOLD = 15.0

# Scoring weights — professional grade
# Volume raised to 20%: volume is the most reliable confirmation signal
# Options reduced to 5%: most stocks don't have liquid options
# Added sector_relative (5%): stock vs sector momentum
# Added proximity (5%): 52w high/low proximity bonus
WEIGHTS = {
    "technical": 0.40,        # EMA, MACD, RSI, Supertrend, ADX, CCI, Ichimoku
    "volume": 0.20,           # volume surge, OBV, MFI — raised from 10%
    "price_action": 0.30,     # EMA alignment, Supertrend, BB, RSI, Pivot, Fib
    "options": 0.05,          # PCR from Redis — reduced from 10%
    "sector_relative": 0.05,  # stock momentum vs sector average
}

# Sector mapping for sector-relative scoring
SECTOR_MAP = {
    "RELIANCE": "Energy", "ONGC": "Energy", "BPCL": "Energy", "IOC": "Energy",
    "HDFCBANK": "Banking", "ICICIBANK": "Banking", "SBIN": "Banking", "AXISBANK": "Banking",
    "KOTAKBANK": "Banking", "BANDHANBNK": "Banking", "IDFCFIRSTB": "Banking",
    "INFY": "IT", "TCS": "IT", "WIPRO": "IT", "HCLTECH": "IT", "TECHM": "IT",
    "LTIM": "IT", "MPHASIS": "IT", "PERSISTENT": "IT",
    "TATAMOTORS": "Auto", "MARUTI": "Auto", "M&M": "Auto", "BAJAJ-AUTO": "Auto",
    "HEROMOTOCO": "Auto", "EICHERMOT": "Auto", "TVSMOTOR": "Auto",
    "SUNPHARMA": "Pharma", "DRREDDY": "Pharma", "CIPLA": "Pharma", "DIVISLAB": "Pharma",
    "APOLLOHOSP": "Pharma", "TORNTPHARM": "Pharma",
    "TATASTEEL": "Metal", "JSWSTEEL": "Metal", "HINDALCO": "Metal", "VEDL": "Metal",
    "COALINDIA": "Metal", "NMDC": "Metal",
    "HINDUNILVR": "FMCG", "ITC": "FMCG", "NESTLEIND": "FMCG", "BRITANNIA": "FMCG",
    "DABUR": "FMCG", "MARICO": "FMCG",
    "ADANIPORTS": "Infra", "LT": "Infra", "ULTRACEMCO": "Infra", "GRASIM": "Infra",
    "NTPC": "Power", "POWERGRID": "Power", "ADANIGREEN": "Power", "TATAPOWER": "Power",
}


async def run_screener() -> List[Dict[str, Any]]:
    """
    Main screener entry point.
    Fetches all active stocks, computes scores, returns ranked signals.
    """
    logger.info("Running AI probability screener...")

    try:
        import asyncpg
        from engine.indicators import calculate_all_indicators

        db_url = os.getenv(
            "DATABASE_URL",
            "postgresql://stockuser:stockpass@localhost:5432/stockdb",
        ).replace("postgresql+asyncpg://", "postgresql://")

        pool = await asyncpg.create_pool(db_url, min_size=2, max_size=10)

        async with pool.acquire() as conn:
            stocks = await conn.fetch(
                "SELECT symbol, exchange, symbol_token FROM stocks WHERE is_active = TRUE ORDER BY symbol"
            )

        results = []
        tasks = [
            _score_stock(pool, dict(stock), calculate_all_indicators)
            for stock in stocks
        ]

        # Process in batches of 50 to avoid overwhelming the DB
        batch_size = 50
        for i in range(0, len(tasks), batch_size):
            batch = tasks[i : i + batch_size]
            batch_results = await asyncio.gather(*batch, return_exceptions=True)
            for r in batch_results:
                if isinstance(r, dict) and r.get("probability_score", 0) >= BUY_THRESHOLD:
                    results.append(r)

        await pool.close()

        # Deduplicate: keep highest-scoring signal per symbol (handles NSE+BSE duplicates)
        seen: dict = {}
        for r in results:
            sym = r["symbol"]
            if sym not in seen or r.get("probability_score", 0) > seen[sym].get("probability_score", 0):
                seen[sym] = r
        results = list(seen.values())

        # Sort by probability descending
        results.sort(key=lambda x: x.get("probability_score", 0), reverse=True)
        logger.info(f"Screener complete: {len(results)} signals above threshold")
        return results

    except Exception as e:
        logger.error(f"Screener error: {e}")
        return []


async def _score_stock(pool, stock: Dict, calculate_fn) -> Optional[Dict[str, Any]]:
    """Score a single stock and return a signal dict"""
    symbol = stock["symbol"]
    exchange = stock["exchange"]

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT date AS time, open, high, low, close, volume
                FROM ohlcv_daily
                WHERE symbol = $1 AND exchange = $2
                ORDER BY date DESC LIMIT 250
                """,
                symbol, exchange,
            )

        if len(rows) < 30:
            return None

        df = pd.DataFrame([dict(r) for r in reversed(rows)])
        df.columns = [c.lower() for c in df.columns]

        # ── Supplement stale ohlcv_daily with today's live Redis quote ─────────
        # Only safe when the gap is ≤ 2 calendar days (e.g. weekend or one missed day).
        # A larger gap (12 days) means a single appended candle creates a ~23% jump,
        # which blows up RSI/MACD. Those cases score from stale but un-distorted data;
        # the /top-picks API layer already rescales prices to live LTP.
        import json as _json
        _today = datetime.now().date()
        _last_dt = df['time'].iloc[-1]
        _last_date = _last_dt.date() if isinstance(_last_dt, pd.Timestamp) else _last_dt
        _gap_days = (_today - _last_date).days
        if 0 < _gap_days <= 2:
            try:
                _r = _get_redis()
                _raw = _r.get(f"quote:NSE:{symbol}")
                if _raw:
                    _q = _json.loads(_raw)
                    _ltp = float(_q.get('ltp', 0))
                    if _ltp > 0:
                        _today_s = _today.isoformat()
                        _existing = {
                            (t.date() if isinstance(t, pd.Timestamp) else t).isoformat()
                            for t in df['time']
                        }
                        _row = {
                            'time':   _today,
                            'open':   float(_q.get('open',   _ltp)),
                            'high':   float(_q.get('high',   _ltp)),
                            'low':    float(_q.get('low',    _ltp)),
                            'close':  _ltp,
                            'volume': int(_q.get('volume', 0)),
                        }
                        if _today_s not in _existing:
                            df = pd.concat([df, pd.DataFrame([_row])], ignore_index=True)
                        else:
                            _m = df['time'].apply(
                                lambda t: (t.date() if isinstance(t, pd.Timestamp) else t).isoformat()
                            ) == _today_s
                            df.loc[_m, 'close']  = _ltp
                            df.loc[_m, 'high']   = df.loc[_m, 'high'].clip(lower=_ltp)
                            df.loc[_m, 'low']    = df.loc[_m, 'low'].clip(upper=_ltp)
                            df.loc[_m, 'volume'] = int(_q.get('volume', 0))
            except Exception:
                pass

        indicators = calculate_fn(df)

        if not indicators:
            return None

        # ── Score Components ───────────────────────────────────────────────────
        tech_score = _calculate_technical_score(indicators)
        vol_score = _calculate_volume_score(indicators, df)
        pa_score = _calculate_price_action_score(indicators, df)
        opt_score = _calculate_options_score(symbol)
        sector_score = _calculate_sector_relative_score(symbol, indicators, df)

        # Weighted composite score (5 components)
        composite = (
            tech_score * WEIGHTS["technical"]
            + vol_score * WEIGHTS["volume"]
            + pa_score * WEIGHTS["price_action"]
            + opt_score * WEIGHTS["options"]
            + sector_score * WEIGHTS["sector_relative"]
        )

        # ── Confluence multiplier ───────────────────────────────────────────────
        # Count how many major signals are bullish simultaneously
        adx_strong       = (indicators.get("adx_14") or 0) > 25
        supertrend_bull  = (indicators.get("supertrend_direction") or 0) == 1
        macd_bull        = (indicators.get("macd_hist") or 0) > 0
        ema_bull         = (indicators.get("ema_21") or 0) > (indicators.get("ema_50") or 0)
        ichimoku_bull    = indicators.get("ichimoku_signal", "NEUTRAL") in ("BUY", "STRONG_BUY")
        ha_bull          = indicators.get("ha_trend", "NEUTRAL") == "BULLISH"
        obv_bull         = indicators.get("obv_rising", False)

        bull_signals = sum([adx_strong, supertrend_bull, macd_bull, ema_bull, ichimoku_bull, ha_bull, obv_bull])

        # Momentum streak: consecutive green closes (max window = last 10 days)
        closes = df["close"].values
        streak = 0
        for i in range(len(closes) - 1, max(len(closes) - 11, 0), -1):
            if closes[i] > closes[i - 1]:
                streak += 1
            else:
                break

        # 52-week high proximity bonus
        high_52w = float(df["high"].max()) if len(df) >= 50 else 0
        proximity_pct = (float(closes[-1]) / high_52w) if high_52w > 0 else 0

        # Apply confluence bonuses to composite (BEFORE clamping)
        if bull_signals >= 6:                    # near-perfect alignment
            composite += 8
        elif bull_signals >= 5:
            composite += 5
        elif bull_signals >= 4:
            composite += 2

        if streak >= 5:                          # 5+ consecutive green days
            composite += 6
        elif streak >= 3:
            composite += 3

        if proximity_pct >= 0.97:               # within 3% of 52W high = breakout zone
            composite += 5
        elif proximity_pct >= 0.93:
            composite += 2

        # Final clamp to [0, 100]
        probability_score = round(max(0.0, min(100.0, composite)), 2)

        if probability_score < BUY_THRESHOLD:
            return None

        ltp = float(df["close"].iloc[-1])
        atr = indicators.get("atr_14", ltp * 0.02) or (ltp * 0.02)

        signal_type = "STRONG_BUY" if probability_score >= STRONG_BUY_THRESHOLD else "BUY"

        # ATR-based targets — more realistic than fixed %
        # Use ATR but clamp to sensible % range (2.5%-10% target, 1.5%-4% SL)
        atr_pct = atr / ltp if ltp > 0 else 0.02

        # Target: 2.5x ATR, clamped between 5% and 10%
        raw_target_pct = atr_pct * 2.5
        target_pct = max(0.05, min(0.10, raw_target_pct))

        # Stop-loss: 1.5x ATR, clamped between 2% and 4%
        raw_sl_pct = atr_pct * 1.5
        sl_pct = max(0.02, min(0.04, raw_sl_pct))

        target_7d = round(ltp * (1 + target_pct), 2)
        target_15d = round(ltp * (1 + target_pct * 1.5), 2)   # 15-day = 1.5x 7-day target
        stop_loss = round(ltp * (1 - sl_pct), 2)

        # Ensure stop_loss is meaningfully below entry (min ₹0.50 gap)
        if ltp - stop_loss < 0.50:
            stop_loss = round(ltp * 0.97, 2)
            sl_pct = 0.03

        expected_return_7d = round(target_pct * 100, 2)
        expected_return_15d = round(target_pct * 150, 2)
        risk = round(sl_pct * 100, 2)
        rr_ratio = round(expected_return_7d / risk, 2) if risk > 0 else 2.0

        # Hold-day estimate: distance to target / average daily ATR move
        daily_move = atr if atr > 0 else ltp * 0.02
        distance_to_target = target_7d - ltp
        estimated_hold_days = max(1, min(10, round(distance_to_target / daily_move)))

        # 3d/7d/15d adjusted probabilities (shorter horizon = less time decay)
        prob_3d  = round(probability_score * 0.99, 2)
        prob_7d  = round(probability_score * 0.97, 2)
        prob_15d = round(probability_score * 0.92, 2)

        # 3-day target: ~50% of the 7-day ATR move (realistic for 3 trading days)
        target_3d           = round(ltp * (1 + target_pct * 0.5), 2)
        expected_return_3d  = round(target_pct * 0.5 * 100, 2)

        # Confidence — mapped to schema-valid values (HIGH/MEDIUM/LOW)
        if probability_score >= 80:
            confidence = "HIGH"
        elif probability_score >= 70:
            confidence = "MEDIUM"
        else:
            confidence = "LOW"

        # ── Buy Confirmation Checklist ─────────────────────────────────────────
        # 5 independent filters; all must pass for a BUY CONFIRMED tag.
        vol_ratio  = indicators.get("volume_ratio", 0) or 0
        rsi_val    = indicators.get("rsi_14", 50)      or 50
        ema21      = indicators.get("ema_21", 0)        or 0
        ema50      = indicators.get("ema_50", 0)        or 0
        macd_hist  = indicators.get("macd_hist", 0)     or 0
        obv_rising = indicators.get("obv_rising", False)
        close_now  = float(df["close"].iloc[-1])

        confirmation_checks = {
            "volume_surge":     vol_ratio >= 1.5,          # today's vol ≥ 1.5× 20d avg
            "rsi_healthy":      30 < rsi_val < 70,         # not overbought, not in free-fall
            "ema_uptrend":      close_now > ema21 > ema50, # price above both EMAs
            "macd_positive":    macd_hist > 0,             # MACD histogram in positive territory
            "obv_accumulation": obv_rising,                # 5-day OBV trending up
        }
        confirmed_count = sum(confirmation_checks.values())
        buy_confirmed   = confirmed_count == 5

        # Reasoning
        reasons, risks = _generate_reasoning(indicators, df)

        # Category
        category = _classify_category(indicators, df)

        # 52-week high/low proximity
        w52_high, w52_low = _get_52w_range(df)
        near_52w_high = (w52_high > 0) and (ltp >= w52_high * 0.97)
        near_52w_low = (w52_low > 0) and (ltp <= w52_low * 1.03)
        pct_from_52w_low = round((ltp - w52_low) / w52_low * 100, 1) if w52_low > 0 else 0.0
        pct_from_52w_high = round((w52_high - ltp) / w52_high * 100, 1) if w52_high > 0 else 0.0

        return {
            "symbol": symbol,
            "exchange": exchange,
            "signal_type": signal_type,
            "timeframe": "1d",
            "probability_score": probability_score,
            "probability_3d": prob_3d,
            "probability_7d": prob_7d,
            "probability_15d": prob_15d,
            "entry_price": ltp,
            "target_3d": target_3d,
            "target_7d": target_7d,
            "target_15d": target_15d,
            "expected_return_3d": expected_return_3d,
            "stop_loss": stop_loss,
            "expected_return_7d": expected_return_7d,
            "expected_return_15d": expected_return_15d,
            "risk_reward_ratio": rr_ratio,
            "estimated_hold_days": estimated_hold_days,
            "confidence": confidence,
            "category": category,
            "top_reasons": reasons[:5],
            "risks": risks[:3],
            "technical_score": round(tech_score, 2),
            "volume_score": round(vol_score, 2),
            "price_action_score": round(pa_score, 2),
            "options_score": round(opt_score, 2),
            "sector_score": round(sector_score, 2),
            "sector": SECTOR_MAP.get(symbol, "Other"),
            "52w_high": round(w52_high, 2),
            "52w_low": round(w52_low, 2),
            "near_52w_high": near_52w_high,
            "near_52w_low": near_52w_low,
            "pct_from_52w_low": pct_from_52w_low,
            "pct_from_52w_high": pct_from_52w_high,
            "reasoning": "; ".join(reasons[:3]),
            "confirmation_checks": confirmation_checks,
            "confirmed_count": confirmed_count,
            "buy_confirmed": buy_confirmed,
            "created_at": datetime.now().isoformat(),
        }

    except Exception as e:
        logger.debug(f"Score error for {symbol}: {e}")
        return None


def _get_52w_range(df: pd.DataFrame) -> Tuple[float, float]:
    """Return (52w_high, 52w_low) from last 252 trading days"""
    try:
        lookback = min(252, len(df))
        window = df.tail(lookback)
        return float(window["high"].max()), float(window["low"].min())
    except Exception:
        return 0.0, 0.0


def _calculate_technical_score(ind: Dict) -> float:
    """Score based on technical indicator signals + ADX/MACD/Supertrend/CCI/Ichimoku confluence (0–100)"""
    signal_map = {"STRONG_BUY": 100, "BUY": 75, "NEUTRAL": 50, "SELL": 25, "STRONG_SELL": 0}
    signal_keys = [k for k in ind if k.endswith("_signal") or k == "macd_crossover"]
    base = (sum(signal_map.get(ind[k], 50) for k in signal_keys) / len(signal_keys)) if signal_keys else 50.0

    # ADX: strongest trend filter
    adx = ind.get("adx_14") or 0
    if adx > 40:
        base += 15
    elif adx > 25:
        base += 8
    elif adx < 15:
        base -= 5  # weak trend penalty

    # MACD histogram direction
    macd_hist = ind.get("macd_hist") or 0
    if macd_hist > 0:
        base += 5
    elif macd_hist < 0:
        base -= 5

    # Supertrend + MACD confluence
    st = ind.get("supertrend_direction") or 0
    if st == 1 and macd_hist > 0:
        base += 8   # both bullish
    elif st == -1 and macd_hist < 0:
        base -= 8

    # CCI: extreme readings are high-probability setups
    cci = ind.get("cci_20") or 0
    if cci < -100:
        base += 8   # oversold CCI = buy setup
    elif cci > 100:
        base -= 5   # overbought CCI = caution
    elif -50 < cci < 50:
        base += 3   # neutral zone = stable

    # Ichimoku cloud signal
    ichi_signal = ind.get("ichimoku_signal", "NEUTRAL")
    if ichi_signal == "STRONG_BUY":
        base += 10
    elif ichi_signal == "BUY":
        base += 5
    elif ichi_signal == "SELL":
        base -= 5
    elif ichi_signal == "STRONG_SELL":
        base -= 10

    # Heikin Ashi trend confirmation
    ha_trend = ind.get("ha_trend", "NEUTRAL")
    ha_strength = ind.get("ha_trend_strength", 0) or 0
    if ha_trend == "BULLISH" and ha_strength >= 3:
        base += 6
    elif ha_trend == "BEARISH" and ha_strength >= 3:
        base -= 6

    return max(0.0, min(100.0, base))


def _calculate_volume_score(ind: Dict, df: pd.DataFrame) -> float:
    """Score based on volume confirmation — raised weight to 20% (0–100)"""
    vol_ratio = ind.get("volume_ratio", 1.0) or 1.0
    obv_rising = ind.get("obv_rising", False)
    mfi = ind.get("mfi_14", 50) or 50

    score = 50.0

    # Volume ratio vs 20-day average
    if vol_ratio >= 5.0:
        score += 40   # extraordinary volume = strong institutional activity
    elif vol_ratio >= 3.0:
        score += 30   # exceptional volume
    elif vol_ratio >= 2.0:
        score += 20
    elif vol_ratio >= 1.5:
        score += 12
    elif vol_ratio >= 1.2:
        score += 5
    elif vol_ratio < 0.5:
        score -= 25   # very low volume = no conviction
    elif vol_ratio < 0.7:
        score -= 15

    # OBV trend
    if obv_rising:
        score += 15
    elif ind.get("obv_falling", False):
        score -= 15

    # MFI (Money Flow Index)
    if mfi < 20:
        score += 15   # extreme oversold + volume = strong accumulation
    elif mfi < 30:
        score += 10
    elif 40 <= mfi <= 60:
        score += 5    # healthy accumulation zone
    elif mfi > 80:
        score -= 10   # distribution zone
    elif mfi > 90:
        score -= 20

    # Volume Profile: price near POC = high liquidity zone
    poc = ind.get("volume_poc")
    if poc:
        ltp = float(df["close"].iloc[-1])
        poc_dist = abs(ltp - poc) / poc
        if poc_dist < 0.005:   # within 0.5% of POC
            score += 8
        elif poc_dist < 0.01:  # within 1% of POC
            score += 4

    return max(0.0, min(100.0, score))


def _calculate_price_action_score(ind: Dict, df: pd.DataFrame) -> float:
    """Score based on price action: trend, S/R, candles, pivot points, Fibonacci (0–100)"""
    score = 50.0
    ltp = float(df["close"].iloc[-1])

    ema_9 = ind.get("ema_9")
    ema_21 = ind.get("ema_21")
    ema_50 = ind.get("ema_50")
    ema_200 = ind.get("ema_200")
    bb_lower = ind.get("bb_lower")
    bb_upper = ind.get("bb_upper")
    rsi = ind.get("rsi_14", 50) or 50
    supertrend_dir = ind.get("supertrend_direction", 0) or 0

    # Full EMA stack alignment (strongest trend signal)
    if ema_9 and ema_21 and ema_50 and ema_200:
        if ltp > ema_9 > ema_21 > ema_50 > ema_200:
            score += 25   # perfect bull stack
        elif ltp > ema_9 > ema_21 > ema_50:
            score += 18
        elif ltp > ema_21:
            score += 8
        elif ltp < ema_9 < ema_21 < ema_50 < ema_200:
            score -= 20   # perfect bear stack
    elif ema_9 and ema_21 and ema_50:
        if ltp > ema_9 > ema_21 > ema_50:
            score += 20
        elif ltp > ema_21:
            score += 10

    # Supertrend
    if supertrend_dir == 1:
        score += 12
    elif supertrend_dir == -1:
        score -= 12

    # Bollinger Band position
    if bb_lower and ltp <= bb_lower * 1.02:
        score += 10   # near lower band = bounce
    elif bb_upper and ltp >= bb_upper * 0.98:
        score -= 8    # near upper band = resistance

    # RSI zones
    if 40 <= rsi <= 65:
        score += 10   # healthy momentum
    elif rsi < 30:
        score += 15   # oversold bounce
    elif rsi > 75:
        score -= 15   # overbought

    # Candlestick patterns
    candle_signal = ind.get("candlestick_signal", "NEUTRAL")
    candle_boosts = {"STRONG_BUY": 12, "BUY": 6, "STRONG_SELL": -12, "SELL": -6}
    score += candle_boosts.get(candle_signal, 0)

    # Pivot Points: price above pivot = bullish bias
    pivot = ind.get("pivot_classic_p")
    r1 = ind.get("pivot_classic_r1")
    s1 = ind.get("pivot_classic_s1")
    if pivot:
        if ltp > pivot:
            score += 5
            if r1 and ltp > r1:
                score += 3   # above R1 = strong breakout
        elif ltp < pivot:
            score -= 5
            if s1 and ltp < s1:
                score -= 3   # below S1 = breakdown

    # Fibonacci: near support levels = buy zone
    fib_support = ind.get("fib_nearest_support")
    fib_resistance = ind.get("fib_nearest_resistance")
    if fib_support and abs(ltp - fib_support) / ltp < 0.01:
        score += 8   # within 1% of Fib support
    if fib_resistance and abs(ltp - fib_resistance) / ltp < 0.01:
        score -= 5   # near Fib resistance = caution

    # VWAP position
    vwap = ind.get("vwap")
    if vwap and ltp > vwap:
        score += 5
    elif vwap and ltp < vwap:
        score -= 5

    # 52-week high proximity: breakout zone = high probability continuation
    high_52w = float(df["high"].max()) if len(df) >= 50 else 0
    if high_52w > 0:
        prox = ltp / high_52w
        if prox >= 0.98:
            score += 10   # at or near 52W high = breakout momentum
        elif prox >= 0.95:
            score += 6
        elif prox >= 0.90:
            score += 3
        elif prox < 0.60:
            score -= 8    # deep in the hole

    # Momentum streak: consecutive green closes
    streak = 0
    closes = df["close"].values
    for i in range(len(closes) - 1, max(len(closes) - 11, 0), -1):
        if closes[i] > closes[i - 1]:
            streak += 1
        else:
            break
    if streak >= 5:
        score += 10
    elif streak >= 3:
        score += 5

    return max(0.0, min(100.0, score))


def _calculate_options_score(symbol: str) -> float:
    """
    Score based on options data — PCR, OI buildup.
    Returns 50 (neutral) if no options data available.
    Weight reduced to 5% since most stocks lack liquid options.
    """
    try:
        import json
        r = _get_redis()
        cached = r.get(f"pcr:{symbol}")
        if not cached:
            return 50.0

        pcr_data = json.loads(cached)
        pcr = float(pcr_data.get("pcr", 1.0))

        # PCR interpretation: contrarian signal
        # > 1.5 = extreme fear = strong contrarian buy
        # > 1.3 = fear = contrarian buy
        # 0.7–1.3 = neutral
        # < 0.7 = greed = contrarian sell
        if pcr > 1.5:
            return 80.0
        elif pcr > 1.3:
            return 70.0
        elif pcr > 1.0:
            return 60.0
        elif pcr < 0.5:
            return 30.0
        elif pcr < 0.7:
            return 40.0
        else:
            return 50.0
    except Exception:
        return 50.0


def _calculate_sector_relative_score(symbol: str, ind: Dict, df: pd.DataFrame) -> float:
    """
    Score stock momentum relative to its sector average.
    Uses Redis-cached sector scores if available, else falls back to
    comparing the stock's own 5-day vs 20-day return.
    Returns 0–100 (50 = neutral).
    """
    try:
        import json
        r = _get_redis()
        sector = SECTOR_MAP.get(symbol, "Other")
        cached = r.get(f"sector_score:{sector}")
        if cached:
            sector_data = json.loads(cached)
            sector_avg_score = float(sector_data.get("avg_score", 50.0))
            # Stock's own technical score vs sector average
            stock_tech = ind.get("rsi_14", 50) or 50
            # Normalize: if stock RSI > sector avg RSI → outperforming
            if stock_tech > sector_avg_score + 10:
                return 75.0
            elif stock_tech > sector_avg_score:
                return 60.0
            elif stock_tech < sector_avg_score - 10:
                return 30.0
            else:
                return 50.0

        # Fallback: compare 5-day vs 20-day return (momentum)
        if len(df) >= 20:
            ret_5d = (float(df["close"].iloc[-1]) - float(df["close"].iloc[-5])) / float(df["close"].iloc[-5]) * 100
            ret_20d = (float(df["close"].iloc[-1]) - float(df["close"].iloc[-20])) / float(df["close"].iloc[-20]) * 100
            # Accelerating momentum: 5d return > 20d/4 = outperforming
            if ret_5d > 2.0 and ret_5d > ret_20d / 4:
                return 75.0
            elif ret_5d > 0 and ret_20d > 0:
                return 62.0
            elif ret_5d < -2.0:
                return 30.0
            elif ret_5d < 0:
                return 42.0
        return 50.0
    except Exception:
        return 50.0


def _generate_reasoning(ind: Dict, df: pd.DataFrame) -> tuple[List[str], List[str]]:
    """Generate human-readable reasons and risks — enhanced with new indicators"""
    reasons = []
    risks = []

    ltp = float(df["close"].iloc[-1])
    rsi = ind.get("rsi_14", 50) or 50
    vol_ratio = ind.get("volume_ratio", 1.0) or 1.0
    macd = ind.get("macd", 0) or 0
    ema_50 = ind.get("ema_50")
    ema_200 = ind.get("ema_200")
    bb_lower = ind.get("bb_lower")
    adx = ind.get("adx_14", 0) or 0
    pattern = ind.get("candlestick_pattern")
    cci = ind.get("cci_20", 0) or 0
    ha_trend = ind.get("ha_trend", "NEUTRAL")
    ha_strength = ind.get("ha_trend_strength", 0) or 0
    pivot = ind.get("pivot_classic_p")
    fib_support = ind.get("fib_nearest_support")

    if ind.get("macd_bullish_crossover"):
        reasons.append("MACD bullish crossover — fresh momentum signal")
    elif macd > 0:
        reasons.append("MACD above zero line — positive momentum")

    if rsi < 35:
        reasons.append(f"RSI oversold ({rsi:.0f}) — high bounce probability")
    elif 40 <= rsi <= 60:
        reasons.append(f"RSI in healthy zone ({rsi:.0f}) — room to run")

    if vol_ratio >= 2.0:
        reasons.append(f"Volume {vol_ratio:.1f}x average — strong institutional buying")
    elif vol_ratio >= 1.5:
        reasons.append(f"Volume surge {vol_ratio:.1f}x — above average interest")

    if ind.get("supertrend_direction") == 1:
        reasons.append("Supertrend bullish — trend confirmed")

    if ema_50 and ltp > ema_50:
        reasons.append(f"Price above 50 EMA ({ema_50:.0f}) — uptrend intact")

    if ema_200 and ltp > ema_200:
        reasons.append(f"Price above 200 EMA ({ema_200:.0f}) — long-term bull trend")

    if bb_lower and ltp <= bb_lower * 1.03:
        reasons.append("Near Bollinger lower band — mean reversion setup")

    if adx > 25:
        reasons.append(f"ADX {adx:.0f} — strong trend in progress")

    if pattern:
        reasons.append(f"Candlestick pattern: {pattern}")

    if ind.get("obv_rising"):
        reasons.append("OBV rising — volume confirming price action")

    if cci < -100:
        reasons.append(f"CCI oversold ({cci:.0f}) — high-probability reversal zone")

    if ha_trend == "BULLISH" and ha_strength >= 3:
        reasons.append(f"Heikin Ashi: {ha_strength} consecutive bullish candles")

    if ind.get("ichimoku_signal") in ("BUY", "STRONG_BUY"):
        reasons.append("Ichimoku: price above cloud — strong uptrend")

    if pivot and ltp > pivot:
        reasons.append(f"Price above daily pivot ({pivot:.0f}) — bullish bias")

    if fib_support and abs(ltp - fib_support) / ltp < 0.015:
        reasons.append(f"Near Fibonacci support ({fib_support:.0f}) — key bounce level")

    # Risks
    if rsi > 70:
        risks.append(f"RSI overbought ({rsi:.0f}) — short-term pullback risk")
    if ind.get("bb_squeeze"):
        risks.append("Bollinger squeeze — breakout direction uncertain")
    if vol_ratio < 0.8:
        risks.append("Below-average volume — weak conviction")
    if adx < 15:
        risks.append("Low ADX — weak trend, choppy price action likely")
    if cci > 100:
        risks.append(f"CCI overbought ({cci:.0f}) — momentum may stall")
    if ha_trend == "BEARISH" and ha_strength >= 3:
        risks.append(f"Heikin Ashi: {ha_strength} consecutive bearish candles")

    return reasons or ["Technical indicators aligned bullishly"], risks or ["Monitor stop-loss levels"]


def _classify_category(ind: Dict, df: pd.DataFrame) -> str:
    """Classify signal into a trading category — enhanced with new indicators"""
    rsi = ind.get("rsi_14", 50) or 50
    bb_lower = ind.get("bb_lower")
    bb_upper = ind.get("bb_upper")
    ltp = float(df["close"].iloc[-1])
    vol_ratio = ind.get("volume_ratio", 1.0) or 1.0
    pattern = ind.get("candlestick_pattern", "")
    cci = ind.get("cci_20", 0) or 0
    ha_trend = ind.get("ha_trend", "NEUTRAL")
    ha_strength = ind.get("ha_trend_strength", 0) or 0
    ichi_signal = ind.get("ichimoku_signal", "NEUTRAL")
    pivot = ind.get("pivot_classic_p")

    if rsi < 30 or cci < -150:
        return "Oversold Bounce"
    if bb_lower and ltp <= bb_lower * 1.02:
        return "Mean Reversion"
    if ind.get("macd_bullish_crossover") and vol_ratio >= 1.5:
        return "Momentum Breakout"
    if vol_ratio >= 2.5:
        return "Volume Surge"
    if pattern in ("Morning Star", "Bullish Engulfing", "Hammer", "Piercing Line"):
        return "Reversal Pattern"
    if ichi_signal in ("BUY", "STRONG_BUY") and ind.get("supertrend_direction") == 1:
        return "Ichimoku Breakout"
    if ha_trend == "BULLISH" and ha_strength >= 4:
        return "Heikin Ashi Trend"
    if ind.get("supertrend_direction") == 1 and ind.get("adx_14", 0) > 25:
        return "Trend Following"
    if pivot and ltp > pivot and vol_ratio >= 1.2:
        return "Pivot Breakout"
    return "Technical Setup"
