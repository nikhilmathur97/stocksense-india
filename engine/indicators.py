"""
Technical Indicators Engine — Professional Grade
=================================================
Calculates all technical indicators for Indian NSE/BSE stocks.
Input:  pandas DataFrame with [time, open, high, low, close, volume]
Output: Dictionary with all indicator values and signals

Indicators included:
  Trend:    EMA (9/21/50/200), SMA (20/50), Supertrend, Ichimoku Cloud
  Momentum: RSI, MACD, Stochastic, Williams %R, ROC, CCI
  Volume:   OBV, MFI, Volume Analysis, VWAP with ±1σ/±2σ bands
  Volatility: Bollinger Bands, ATR, Keltner Channels
  Levels:   Pivot Points (Classic + Camarilla), Fibonacci Retracements
  Profile:  Volume Profile (POC, VAH, VAL)
  Candles:  Heikin Ashi, 10 candlestick patterns
  Composite: ADX/DI, Overall Signal, Bullish/Bearish count
"""

import logging
import numpy as np
import pandas as pd
from typing import Dict, Any, List

logger = logging.getLogger("indicators")

BUY = "BUY"
SELL = "SELL"
NEUTRAL = "NEUTRAL"
STRONG_BUY = "STRONG_BUY"
STRONG_SELL = "STRONG_SELL"


def calculate_all_indicators(df: pd.DataFrame) -> Dict[str, Any]:
    """Master function: calculate all indicators and return as dict."""
    if df is None or len(df) < 20:
        return {}

    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close"])
    df = df.sort_values("time").reset_index(drop=True)

    result = {}
    result.update(_calculate_ema(df))
    result.update(_calculate_sma(df))
    result.update(_calculate_vwap(df))
    result.update(_calculate_supertrend(df))
    result.update(_calculate_adx(df))
    result.update(_calculate_rsi(df))
    result.update(_calculate_macd(df))
    result.update(_calculate_stochastic(df))
    result.update(_calculate_williams_r(df))
    result.update(_calculate_roc(df))
    result.update(_calculate_cci(df))
    result.update(_calculate_bollinger_bands(df))
    result.update(_calculate_atr(df))
    result.update(_calculate_keltner_channels(df))
    result.update(_calculate_obv(df))
    result.update(_calculate_volume_analysis(df))
    result.update(_calculate_mfi(df))
    result.update(_calculate_ichimoku(df))
    result.update(_calculate_pivot_points(df))
    result.update(_calculate_fibonacci(df))
    result.update(_calculate_volume_profile(df))
    result.update(_calculate_vwap_bands(df))
    result.update(_calculate_heikin_ashi(df))
    result.update(_detect_candlestick_patterns(df))
    result["overall_signal"] = _calculate_overall_signal(result)
    result["bullish_count"] = sum(1 for k, v in result.items() if k.endswith("_signal") and v in [BUY, STRONG_BUY])
    result["bearish_count"] = sum(1 for k, v in result.items() if k.endswith("_signal") and v in [SELL, STRONG_SELL])
    return result


def _calculate_ema(df: pd.DataFrame) -> Dict[str, Any]:
    close = df["close"]
    result = {}
    for period in [9, 21, 50, 200]:
        if len(df) >= period:
            ema = close.ewm(span=period, adjust=False).mean()
            result[f"ema_{period}"] = round(float(ema.iloc[-1]), 2)
        else:
            result[f"ema_{period}"] = None

    e9 = result.get("ema_9")
    e21 = result.get("ema_21")
    e50 = result.get("ema_50")
    ltp = float(close.iloc[-1])

    if all([e9, e21, e50]):
        if ltp > e9 > e21 > e50:
            result["ema_signal"] = STRONG_BUY
        elif ltp > e21 > e50:
            result["ema_signal"] = BUY
        elif ltp < e9 < e21 < e50:
            result["ema_signal"] = STRONG_SELL
        elif ltp < e21 < e50:
            result["ema_signal"] = SELL
        else:
            result["ema_signal"] = NEUTRAL
    else:
        result["ema_signal"] = NEUTRAL
    return result


def _calculate_sma(df: pd.DataFrame) -> Dict[str, Any]:
    close = df["close"]
    result = {}
    for period in [20, 50]:
        if len(df) >= period:
            sma = close.rolling(window=period).mean()
            result[f"sma_{period}"] = round(float(sma.iloc[-1]), 2)
        else:
            result[f"sma_{period}"] = None
    ltp = float(close.iloc[-1])
    sma20 = result.get("sma_20")
    result["sma_signal"] = BUY if sma20 and ltp > sma20 else SELL if sma20 else NEUTRAL
    return result


def _calculate_vwap(df: pd.DataFrame) -> Dict[str, Any]:
    try:
        typical_price = (df["high"] + df["low"] + df["close"]) / 3
        cumulative_tp_vol = (typical_price * df["volume"]).cumsum()
        cumulative_vol = df["volume"].cumsum()
        vwap = cumulative_tp_vol / cumulative_vol.replace(0, np.nan)
        vwap_val = round(float(vwap.iloc[-1]), 2)
        ltp = float(df["close"].iloc[-1])
        return {"vwap": vwap_val, "vwap_signal": BUY if ltp > vwap_val else SELL}
    except Exception:
        return {"vwap": None, "vwap_signal": NEUTRAL}


def _calculate_supertrend(df: pd.DataFrame, period: int = 7, multiplier: float = 3.0) -> Dict[str, Any]:
    try:
        if len(df) < period + 1:
            return {"supertrend": None, "supertrend_direction": 0, "supertrend_signal": NEUTRAL}

        high = df["high"]
        low = df["low"]
        close = df["close"]

        tr = pd.concat([
            high - low,
            (high - close.shift(1)).abs(),
            (low - close.shift(1)).abs()
        ], axis=1).max(axis=1)
        atr = tr.rolling(window=period).mean()
        hl2 = (high + low) / 2
        upper_band = hl2 + (multiplier * atr)
        lower_band = hl2 - (multiplier * atr)

        supertrend = [None] * len(df)
        direction = [1] * len(df)

        for i in range(period, len(df)):
            if close.iloc[i] > (upper_band.iloc[i - 1] if supertrend[i-1] is None else supertrend[i-1]):
                direction[i] = 1
                supertrend[i] = float(lower_band.iloc[i])
            elif close.iloc[i] < (lower_band.iloc[i - 1] if supertrend[i-1] is None else supertrend[i-1]):
                direction[i] = -1
                supertrend[i] = float(upper_band.iloc[i])
            else:
                direction[i] = direction[i - 1]
                if direction[i] == 1:
                    prev = supertrend[i-1] if supertrend[i-1] is not None else float(lower_band.iloc[i])
                    supertrend[i] = max(float(lower_band.iloc[i]), prev)
                else:
                    prev = supertrend[i-1] if supertrend[i-1] is not None else float(upper_band.iloc[i])
                    supertrend[i] = min(float(upper_band.iloc[i]), prev)

        st_val = round(supertrend[-1], 2) if supertrend[-1] is not None else None
        dir_val = direction[-1]
        return {
            "supertrend": st_val,
            "supertrend_direction": dir_val,
            "supertrend_signal": STRONG_BUY if dir_val == 1 else STRONG_SELL,
        }
    except Exception as e:
        logger.debug(f"Supertrend error: {e}")
        return {"supertrend": None, "supertrend_direction": 0, "supertrend_signal": NEUTRAL}


def _calculate_adx(df: pd.DataFrame, period: int = 14) -> Dict[str, Any]:
    try:
        if len(df) < period * 2:
            return {"adx_14": None, "adx_signal": NEUTRAL}

        high = df["high"]
        low = df["low"]
        close = df["close"]

        tr = pd.concat([
            high - low,
            (high - close.shift(1)).abs(),
            (low - close.shift(1)).abs()
        ], axis=1).max(axis=1)

        dm_plus = high.diff()
        dm_minus = -low.diff()
        dm_plus = dm_plus.where((dm_plus > dm_minus) & (dm_plus > 0), 0.0)
        dm_minus = dm_minus.where((dm_minus > dm_plus) & (dm_minus > 0), 0.0)

        atr = tr.rolling(period).mean()
        di_plus = 100 * (dm_plus.rolling(period).mean() / atr)
        di_minus = 100 * (dm_minus.rolling(period).mean() / atr)

        dx = 100 * (di_plus - di_minus).abs() / (di_plus + di_minus).replace(0, np.nan)
        adx = dx.rolling(period).mean()

        adx_val = round(float(adx.iloc[-1]), 2) if not pd.isna(adx.iloc[-1]) else None
        di_p = round(float(di_plus.iloc[-1]), 2) if not pd.isna(di_plus.iloc[-1]) else None
        di_m = round(float(di_minus.iloc[-1]), 2) if not pd.isna(di_minus.iloc[-1]) else None

        signal = NEUTRAL
        if adx_val and adx_val > 25 and di_p and di_m:
            signal = BUY if di_p > di_m else SELL

        return {"adx_14": adx_val, "di_plus": di_p, "di_minus": di_m, "adx_signal": signal}
    except Exception as e:
        logger.debug(f"ADX error: {e}")
        return {"adx_14": None, "adx_signal": NEUTRAL}


def _calculate_rsi(df: pd.DataFrame, period: int = 14) -> Dict[str, Any]:
    try:
        if len(df) < period + 1:
            return {"rsi_14": None, "rsi_signal": NEUTRAL}

        close = df["close"]
        delta = close.diff()
        gain = delta.where(delta > 0, 0.0)
        loss = -delta.where(delta < 0, 0.0)

        avg_gain = gain.ewm(com=period - 1, adjust=False).mean()
        avg_loss = loss.ewm(com=period - 1, adjust=False).mean()

        rs = avg_gain / avg_loss.replace(0, np.nan)
        rsi = 100 - (100 / (1 + rs))

        rsi_val = round(float(rsi.iloc[-1]), 2)
        prev_rsi = round(float(rsi.iloc[-2]), 2) if len(rsi) > 1 else rsi_val

        if rsi_val < 30:
            signal = STRONG_BUY
        elif rsi_val < 40:
            signal = BUY
        elif rsi_val > 70:
            signal = STRONG_SELL
        elif rsi_val > 60:
            signal = SELL
        else:
            signal = NEUTRAL

        return {
            "rsi_14": rsi_val,
            "rsi_prev": prev_rsi,
            "rsi_signal": signal,
            "rsi_overbought": rsi_val > 70,
            "rsi_oversold": rsi_val < 30,
        }
    except Exception as e:
        logger.debug(f"RSI error: {e}")
        return {"rsi_14": None, "rsi_signal": NEUTRAL}


def _calculate_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal_period: int = 9) -> Dict[str, Any]:
    try:
        if len(df) < slow + signal_period:
            return {"macd": None, "macd_signal_line": None, "macd_hist": None, "macd_crossover": NEUTRAL}

        close = df["close"]
        ema_fast = close.ewm(span=fast, adjust=False).mean()
        ema_slow = close.ewm(span=slow, adjust=False).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
        histogram = macd_line - signal_line

        macd_val = round(float(macd_line.iloc[-1]), 4)
        signal_val = round(float(signal_line.iloc[-1]), 4)
        hist_val = round(float(histogram.iloc[-1]), 4)
        prev_hist = round(float(histogram.iloc[-2]), 4) if len(histogram) > 1 else hist_val

        recent_macd = macd_line.iloc[-3:]
        recent_signal = signal_line.iloc[-3:]

        bullish_crossover = False
        bearish_crossover = False
        for i in range(1, len(recent_macd)):
            if recent_macd.iloc[i-1] < recent_signal.iloc[i-1] and recent_macd.iloc[i] > recent_signal.iloc[i]:
                bullish_crossover = True
            if recent_macd.iloc[i-1] > recent_signal.iloc[i-1] and recent_macd.iloc[i] < recent_signal.iloc[i]:
                bearish_crossover = True

        if bullish_crossover:
            crossover_signal = STRONG_BUY
        elif bearish_crossover:
            crossover_signal = STRONG_SELL
        elif macd_val > signal_val and hist_val > prev_hist:
            crossover_signal = BUY
        elif macd_val < signal_val and hist_val < prev_hist:
            crossover_signal = SELL
        else:
            crossover_signal = NEUTRAL

        return {
            "macd": macd_val,
            "macd_signal_line": signal_val,
            "macd_hist": hist_val,
            "macd_crossover": crossover_signal,
            "macd_bullish_crossover": bullish_crossover,
            "macd_bearish_crossover": bearish_crossover,
        }
    except Exception as e:
        logger.debug(f"MACD error: {e}")
        return {"macd": None, "macd_signal_line": None, "macd_hist": None, "macd_crossover": NEUTRAL}


def _calculate_stochastic(df: pd.DataFrame, k_period: int = 14, d_period: int = 3) -> Dict[str, Any]:
    try:
        if len(df) < k_period:
            return {"stoch_k": None, "stoch_d": None, "stoch_signal": NEUTRAL}

        low_min = df["low"].rolling(k_period).min()
        high_max = df["high"].rolling(k_period).max()
        k = 100 * (df["close"] - low_min) / (high_max - low_min).replace(0, np.nan)
        d = k.rolling(d_period).mean()

        k_val = round(float(k.iloc[-1]), 2)
        d_val = round(float(d.iloc[-1]), 2)

        if k_val < 20 and d_val < 20:
            signal = STRONG_BUY
        elif k_val > 80 and d_val > 80:
            signal = STRONG_SELL
        elif k_val > d_val and k_val < 50:
            signal = BUY
        elif k_val < d_val and k_val > 50:
            signal = SELL
        else:
            signal = NEUTRAL

        return {"stoch_k": k_val, "stoch_d": d_val, "stoch_signal": signal}
    except Exception:
        return {"stoch_k": None, "stoch_d": None, "stoch_signal": NEUTRAL}


def _calculate_williams_r(df: pd.DataFrame, period: int = 14) -> Dict[str, Any]:
    try:
        if len(df) < period:
            return {"williams_r": None, "williams_r_signal": NEUTRAL}

        high_max = df["high"].rolling(period).max()
        low_min = df["low"].rolling(period).min()
        wr = -100 * (high_max - df["close"]) / (high_max - low_min).replace(0, np.nan)
        wr_val = round(float(wr.iloc[-1]), 2)
        signal = STRONG_BUY if wr_val < -80 else (STRONG_SELL if wr_val > -20 else NEUTRAL)
        return {"williams_r": wr_val, "williams_r_signal": signal}
    except Exception:
        return {"williams_r": None, "williams_r_signal": NEUTRAL}


def _calculate_roc(df: pd.DataFrame, period: int = 12) -> Dict[str, Any]:
    try:
        if len(df) < period + 1:
            return {"roc_12": None, "roc_signal": NEUTRAL}

        close = df["close"]
        roc = ((close - close.shift(period)) / close.shift(period)) * 100
        roc_val = round(float(roc.iloc[-1]), 2)
        return {"roc_12": roc_val, "roc_signal": BUY if roc_val > 0 else SELL}
    except Exception:
        return {"roc_12": None, "roc_signal": NEUTRAL}


def _calculate_bollinger_bands(df: pd.DataFrame, period: int = 20, std_dev: float = 2.0) -> Dict[str, Any]:
    try:
        if len(df) < period:
            return {"bb_upper": None, "bb_middle": None, "bb_lower": None, "bb_signal": NEUTRAL}

        close = df["close"]
        sma = close.rolling(period).mean()
        std = close.rolling(period).std()
        upper = sma + (std_dev * std)
        lower = sma - (std_dev * std)

        upper_val = round(float(upper.iloc[-1]), 2)
        middle_val = round(float(sma.iloc[-1]), 2)
        lower_val = round(float(lower.iloc[-1]), 2)
        ltp = float(close.iloc[-1])
        bb_width = round((upper_val - lower_val) / middle_val * 100, 2) if middle_val else 0

        if ltp <= lower_val:
            signal = STRONG_BUY
        elif ltp >= upper_val:
            signal = STRONG_SELL
        elif ltp < middle_val:
            signal = BUY
        else:
            signal = SELL

        return {
            "bb_upper": upper_val,
            "bb_middle": middle_val,
            "bb_lower": lower_val,
            "bb_width": bb_width,
            "bb_squeeze": bb_width < 2.0,
            "bb_signal": signal,
        }
    except Exception:
        return {"bb_upper": None, "bb_middle": None, "bb_lower": None, "bb_signal": NEUTRAL}


def _calculate_atr(df: pd.DataFrame, period: int = 14) -> Dict[str, Any]:
    try:
        if len(df) < period:
            return {"atr_14": None}

        tr = pd.concat([
            df["high"] - df["low"],
            (df["high"] - df["close"].shift(1)).abs(),
            (df["low"] - df["close"].shift(1)).abs()
        ], axis=1).max(axis=1)
        atr = tr.rolling(period).mean()
        return {"atr_14": round(float(atr.iloc[-1]), 2)}
    except Exception:
        return {"atr_14": None}


def _calculate_keltner_channels(df: pd.DataFrame, period: int = 20, multiplier: float = 2.0) -> Dict[str, Any]:
    try:
        if len(df) < period:
            return {"kc_upper": None, "kc_middle": None, "kc_lower": None}

        close = df["close"]
        ema = close.ewm(span=period, adjust=False).mean()
        tr = pd.concat([
            df["high"] - df["low"],
            (df["high"] - close.shift(1)).abs(),
            (df["low"] - close.shift(1)).abs()
        ], axis=1).max(axis=1)
        atr = tr.rolling(period).mean()

        return {
            "kc_upper": round(float((ema + multiplier * atr).iloc[-1]), 2),
            "kc_middle": round(float(ema.iloc[-1]), 2),
            "kc_lower": round(float((ema - multiplier * atr).iloc[-1]), 2),
        }
    except Exception:
        return {"kc_upper": None, "kc_middle": None, "kc_lower": None}


def _calculate_obv(df: pd.DataFrame) -> Dict[str, Any]:
    try:
        close = df["close"]
        volume = df["volume"]
        obv = (np.sign(close.diff()) * volume).fillna(0).cumsum()
        obv_val = int(obv.iloc[-1])
        obv_5d = obv.iloc[-5:]
        obv_rising = all(obv_5d.iloc[i] > obv_5d.iloc[i-1] for i in range(1, len(obv_5d)))
        obv_falling = all(obv_5d.iloc[i] < obv_5d.iloc[i-1] for i in range(1, len(obv_5d)))
        return {
            "obv": obv_val,
            "obv_rising": obv_rising,
            "obv_falling": obv_falling,
            "obv_signal": BUY if obv_rising else (SELL if obv_falling else NEUTRAL),
        }
    except Exception:
        return {"obv": None, "obv_signal": NEUTRAL}


def _calculate_volume_analysis(df: pd.DataFrame, period: int = 20) -> Dict[str, Any]:
    try:
        volume = df["volume"]
        vol_sma = volume.rolling(period).mean()
        current_vol = int(volume.iloc[-1])
        avg_vol = int(vol_sma.iloc[-1]) if not pd.isna(vol_sma.iloc[-1]) else 1
        vol_ratio = round(current_vol / avg_vol, 2) if avg_vol > 0 else 0
        return {
            "volume_current": current_vol,
            "volume_sma_20": avg_vol,
            "volume_ratio": vol_ratio,
            "volume_breakout": vol_ratio >= 2.0,
            "volume_surge": vol_ratio >= 1.5,
            "volume_signal": STRONG_BUY if vol_ratio >= 2.0 else (BUY if vol_ratio >= 1.5 else NEUTRAL),
        }
    except Exception:
        return {"volume_sma_20": None, "volume_signal": NEUTRAL}


def _calculate_mfi(df: pd.DataFrame, period: int = 14) -> Dict[str, Any]:
    try:
        if len(df) < period + 1:
            return {"mfi_14": None, "mfi_signal": NEUTRAL}

        typical_price = (df["high"] + df["low"] + df["close"]) / 3
        raw_money_flow = typical_price * df["volume"]
        positive_flow = raw_money_flow.where(typical_price > typical_price.shift(1), 0.0)
        negative_flow = raw_money_flow.where(typical_price < typical_price.shift(1), 0.0)
        pos_mf = positive_flow.rolling(period).sum()
        neg_mf = negative_flow.rolling(period).sum()
        mfi = 100 - (100 / (1 + pos_mf / neg_mf.replace(0, np.nan)))
        mfi_val = round(float(mfi.iloc[-1]), 2)
        signal = STRONG_BUY if mfi_val < 20 else (STRONG_SELL if mfi_val > 80 else NEUTRAL)
        return {"mfi_14": mfi_val, "mfi_signal": signal}
    except Exception:
        return {"mfi_14": None, "mfi_signal": NEUTRAL}


def _detect_candlestick_patterns(df: pd.DataFrame) -> Dict[str, Any]:
    """Detect common candlestick patterns on last 3 candles"""
    if len(df) < 3:
        return {"candlestick_pattern": None, "candlestick_signal": NEUTRAL}

    o = df["open"].values
    h = df["high"].values
    l = df["low"].values
    c = df["close"].values

    o1, o2, o3 = o[-3], o[-2], o[-1]
    h1, h2, h3 = h[-3], h[-2], h[-1]
    l1, l2, l3 = l[-3], l[-2], l[-1]
    c1, c2, c3 = c[-3], c[-2], c[-1]

    body3 = abs(c3 - o3)
    range3 = h3 - l3
    body2 = abs(c2 - o2)

    detected = []
    signal = NEUTRAL

    # Doji
    if range3 > 0 and body3 / range3 < 0.1:
        detected.append("Doji")

    # Hammer (bullish reversal at bottom)
    lower_shadow3 = min(o3, c3) - l3
    upper_shadow3 = h3 - max(o3, c3)
    if body3 > 0 and lower_shadow3 >= 2 * body3 and upper_shadow3 <= 0.1 * body3:
        detected.append("Hammer")
        signal = BUY

    # Shooting Star (bearish reversal at top)
    if body3 > 0 and upper_shadow3 >= 2 * body3 and lower_shadow3 <= 0.1 * body3:
        detected.append("Shooting Star")
        signal = SELL

    # Bullish Engulfing
    if c2 < o2 and c3 > o3 and o3 < c2 and c3 > o2:
        detected.append("Bullish Engulfing")
        signal = STRONG_BUY

    # Bearish Engulfing
    if c2 > o2 and c3 < o3 and o3 > c2 and c3 < o2:
        detected.append("Bearish Engulfing")
        signal = STRONG_SELL

    # Morning Star (3-candle bullish reversal)
    if (c1 < o1 and                          # First: bearish
        abs(c2 - o2) < abs(c1 - o1) * 0.3 and  # Second: small body (star)
        c3 > o3 and c3 > (o1 + c1) / 2):    # Third: bullish, closes above midpoint
        detected.append("Morning Star")
        signal = STRONG_BUY

    # Evening Star (3-candle bearish reversal)
    if (c1 > o1 and                          # First: bullish
        abs(c2 - o2) < abs(c1 - o1) * 0.3 and  # Second: small body (star)
        c3 < o3 and c3 < (o1 + c1) / 2):    # Third: bearish, closes below midpoint
        detected.append("Evening Star")
        signal = STRONG_SELL

    # Three White Soldiers (3 consecutive bullish candles)
    if (c1 > o1 and c2 > o2 and c3 > o3 and
            c2 > c1 and c3 > c2 and
            o2 > o1 and o3 > o2):
        detected.append("Three White Soldiers")
        signal = STRONG_BUY

    # Three Black Crows (3 consecutive bearish candles)
    if (c1 < o1 and c2 < o2 and c3 < o3 and
            c2 < c1 and c3 < c2 and
            o2 < o1 and o3 < o2):
        detected.append("Three Black Crows")
        signal = STRONG_SELL

    return {
        "candlestick_pattern": detected[0] if detected else None,
        "candlestick_patterns": detected,
        "candlestick_signal": signal,
    }


def _calculate_cci(df: pd.DataFrame, period: int = 20) -> Dict[str, Any]:
    """Commodity Channel Index — measures deviation from average price"""
    try:
        if len(df) < period:
            return {"cci_20": None, "cci_signal": NEUTRAL}
        typical = (df["high"] + df["low"] + df["close"]) / 3
        sma_tp = typical.rolling(period).mean()
        mad = typical.rolling(period).apply(lambda x: np.mean(np.abs(x - np.mean(x))), raw=True)
        cci = (typical - sma_tp) / (0.015 * mad.replace(0, np.nan))
        cci_val = round(float(cci.iloc[-1]), 2)
        if cci_val > 100:
            signal = STRONG_SELL  # overbought
        elif cci_val < -100:
            signal = STRONG_BUY   # oversold
        elif cci_val > 0:
            signal = BUY
        else:
            signal = SELL
        return {"cci_20": cci_val, "cci_signal": signal}
    except Exception:
        return {"cci_20": None, "cci_signal": NEUTRAL}


def _calculate_ichimoku(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Ichimoku Cloud (Ichimoku Kinko Hyo)
    =====================================
    Tenkan-sen (Conversion):  (9-period high + low) / 2
    Kijun-sen (Base):         (26-period high + low) / 2
    Senkou Span A (Leading A): (Tenkan + Kijun) / 2, shifted +26
    Senkou Span B (Leading B): (52-period high + low) / 2, shifted +26
    Chikou Span (Lagging):    Close shifted -26

    Signals:
    - Price above cloud = BULLISH
    - Price below cloud = BEARISH
    - Tenkan > Kijun = bullish momentum
    - Cloud is green (Span A > Span B) = bullish cloud
    """
    try:
        if len(df) < 52:
            return {
                "ichimoku_tenkan": None, "ichimoku_kijun": None,
                "ichimoku_span_a": None, "ichimoku_span_b": None,
                "ichimoku_cloud_top": None, "ichimoku_cloud_bottom": None,
                "ichimoku_signal": NEUTRAL, "ichimoku_above_cloud": None,
                "ichimoku_cloud_bullish": None,
            }

        high = df["high"]
        low  = df["low"]
        close = df["close"]

        # Tenkan-sen (9)
        tenkan = (high.rolling(9).max() + low.rolling(9).min()) / 2
        # Kijun-sen (26)
        kijun  = (high.rolling(26).max() + low.rolling(26).min()) / 2
        # Senkou Span A (current, not shifted for current bar analysis)
        span_a = (tenkan + kijun) / 2
        # Senkou Span B (52)
        span_b = (high.rolling(52).max() + low.rolling(52).min()) / 2

        tenkan_val = round(float(tenkan.iloc[-1]), 2) if not pd.isna(tenkan.iloc[-1]) else None
        kijun_val  = round(float(kijun.iloc[-1]),  2) if not pd.isna(kijun.iloc[-1])  else None
        span_a_val = round(float(span_a.iloc[-1]), 2) if not pd.isna(span_a.iloc[-1]) else None
        span_b_val = round(float(span_b.iloc[-1]), 2) if not pd.isna(span_b.iloc[-1]) else None
        ltp        = float(close.iloc[-1])

        cloud_top    = max(span_a_val, span_b_val) if span_a_val and span_b_val else None
        cloud_bottom = min(span_a_val, span_b_val) if span_a_val and span_b_val else None
        above_cloud  = ltp > cloud_top  if cloud_top  else None
        below_cloud  = ltp < cloud_bottom if cloud_bottom else None
        cloud_bullish = span_a_val > span_b_val if span_a_val and span_b_val else None

        # Signal logic
        if above_cloud and cloud_bullish and tenkan_val and kijun_val and tenkan_val > kijun_val:
            signal = STRONG_BUY
        elif above_cloud:
            signal = BUY
        elif below_cloud and not cloud_bullish and tenkan_val and kijun_val and tenkan_val < kijun_val:
            signal = STRONG_SELL
        elif below_cloud:
            signal = SELL
        else:
            signal = NEUTRAL  # price inside cloud = indecision

        return {
            "ichimoku_tenkan":       tenkan_val,
            "ichimoku_kijun":        kijun_val,
            "ichimoku_span_a":       span_a_val,
            "ichimoku_span_b":       span_b_val,
            "ichimoku_cloud_top":    cloud_top,
            "ichimoku_cloud_bottom": cloud_bottom,
            "ichimoku_above_cloud":  above_cloud,
            "ichimoku_cloud_bullish": cloud_bullish,
            "ichimoku_signal":       signal,
        }
    except Exception as e:
        logger.debug(f"Ichimoku error: {e}")
        return {
            "ichimoku_tenkan": None, "ichimoku_kijun": None,
            "ichimoku_span_a": None, "ichimoku_span_b": None,
            "ichimoku_cloud_top": None, "ichimoku_cloud_bottom": None,
            "ichimoku_signal": NEUTRAL, "ichimoku_above_cloud": None,
            "ichimoku_cloud_bullish": None,
        }


def _calculate_pivot_points(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Pivot Points — Classic and Camarilla
    ======================================
    Uses the PREVIOUS day's (or last completed bar's) H/L/C.

    Classic:
      Pivot (P) = (H + L + C) / 3
      R1 = 2P - L,  R2 = P + (H - L),  R3 = H + 2(P - L)
      S1 = 2P - H,  S2 = P - (H - L),  S3 = L - 2(H - P)

    Camarilla:
      R1 = C + (H - L) * 1.1/12,  R2 = C + (H - L) * 1.1/6
      R3 = C + (H - L) * 1.1/4,  R4 = C + (H - L) * 1.1/2
      S1 = C - (H - L) * 1.1/12, S2 = C - (H - L) * 1.1/6
      S3 = C - (H - L) * 1.1/4,  S4 = C - (H - L) * 1.1/2
    """
    try:
        if len(df) < 2:
            return {}
        # Use previous bar for pivot calculation
        prev = df.iloc[-2]
        H = float(prev["high"])
        L = float(prev["low"])
        C = float(prev["close"])
        ltp = float(df["close"].iloc[-1])

        # Classic Pivots
        P  = (H + L + C) / 3
        R1 = 2 * P - L
        R2 = P + (H - L)
        R3 = H + 2 * (P - L)
        S1 = 2 * P - H
        S2 = P - (H - L)
        S3 = L - 2 * (H - P)

        # Camarilla Pivots
        rng = H - L
        CR1 = C + rng * 1.1 / 12
        CR2 = C + rng * 1.1 / 6
        CR3 = C + rng * 1.1 / 4
        CR4 = C + rng * 1.1 / 2
        CS1 = C - rng * 1.1 / 12
        CS2 = C - rng * 1.1 / 6
        CS3 = C - rng * 1.1 / 4
        CS4 = C - rng * 1.1 / 2

        # Signal: where is price relative to pivot?
        if ltp > R1:
            pivot_signal = STRONG_BUY
        elif ltp > P:
            pivot_signal = BUY
        elif ltp < S1:
            pivot_signal = STRONG_SELL
        elif ltp < P:
            pivot_signal = SELL
        else:
            pivot_signal = NEUTRAL

        return {
            "pivot_p":  round(P,  2), "pivot_r1": round(R1, 2),
            "pivot_r2": round(R2, 2), "pivot_r3": round(R3, 2),
            "pivot_s1": round(S1, 2), "pivot_s2": round(S2, 2),
            "pivot_s3": round(S3, 2),
            "cam_r1": round(CR1, 2), "cam_r2": round(CR2, 2),
            "cam_r3": round(CR3, 2), "cam_r4": round(CR4, 2),
            "cam_s1": round(CS1, 2), "cam_s2": round(CS2, 2),
            "cam_s3": round(CS3, 2), "cam_s4": round(CS4, 2),
            "pivot_signal": pivot_signal,
        }
    except Exception as e:
        logger.debug(f"Pivot points error: {e}")
        return {}


def _calculate_fibonacci(df: pd.DataFrame, lookback: int = 50) -> Dict[str, Any]:
    """
    Fibonacci Retracement Levels
    ==============================
    Uses the highest high and lowest low over the lookback period.
    Levels: 0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%

    If price is in an uptrend (close > open of lookback start):
      Retracement from high to low (support levels).
    If downtrend: extension from low to high (resistance levels).
    """
    try:
        window = df.tail(lookback)
        swing_high = float(window["high"].max())
        swing_low  = float(window["low"].min())
        ltp = float(df["close"].iloc[-1])
        diff = swing_high - swing_low

        if diff <= 0:
            return {}

        levels = {
            "fib_0":    round(swing_high, 2),
            "fib_236":  round(swing_high - 0.236 * diff, 2),
            "fib_382":  round(swing_high - 0.382 * diff, 2),
            "fib_500":  round(swing_high - 0.500 * diff, 2),
            "fib_618":  round(swing_high - 0.618 * diff, 2),
            "fib_786":  round(swing_high - 0.786 * diff, 2),
            "fib_100":  round(swing_low,  2),
            "fib_swing_high": swing_high,
            "fib_swing_low":  swing_low,
        }

        # Find nearest support and resistance from Fibonacci levels
        fib_values = sorted([
            levels["fib_236"], levels["fib_382"], levels["fib_500"],
            levels["fib_618"], levels["fib_786"],
        ])
        fib_support    = max((v for v in fib_values if v <= ltp), default=swing_low)
        fib_resistance = min((v for v in fib_values if v >= ltp), default=swing_high)

        levels["fib_nearest_support"]    = round(fib_support, 2)
        levels["fib_nearest_resistance"] = round(fib_resistance, 2)

        # Signal: price bouncing off key Fibonacci level?
        near_support = abs(ltp - fib_support) / ltp < 0.005   # within 0.5%
        near_resist  = abs(ltp - fib_resistance) / ltp < 0.005
        if near_support:
            levels["fib_signal"] = BUY
        elif near_resist:
            levels["fib_signal"] = SELL
        else:
            levels["fib_signal"] = NEUTRAL

        return levels
    except Exception as e:
        logger.debug(f"Fibonacci error: {e}")
        return {}


def _calculate_volume_profile(df: pd.DataFrame, bins: int = 20) -> Dict[str, Any]:
    """
    Volume Profile — Point of Control (POC), Value Area High/Low
    =============================================================
    Divides the price range into bins and sums volume at each price level.
    POC  = price level with highest volume (strongest support/resistance)
    VAH  = top of value area (70% of total volume)
    VAL  = bottom of value area (70% of total volume)

    Professional traders use POC as the most important S/R level.
    """
    try:
        if len(df) < 10:
            return {}

        price_min = float(df["low"].min())
        price_max = float(df["high"].max())
        if price_max <= price_min:
            return {}

        bin_edges = np.linspace(price_min, price_max, bins + 1)
        bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
        vol_at_price = np.zeros(bins)

        for _, row in df.iterrows():
            row_low  = float(row["low"])
            row_high = float(row["high"])
            row_vol  = float(row.get("volume", 0))
            if row_vol <= 0:
                continue
            # Distribute volume proportionally across bins touched by this candle
            for i in range(bins):
                overlap_low  = max(row_low,  bin_edges[i])
                overlap_high = min(row_high, bin_edges[i + 1])
                if overlap_high > overlap_low:
                    fraction = (overlap_high - overlap_low) / max(row_high - row_low, 1e-9)
                    vol_at_price[i] += row_vol * fraction

        # POC = bin with max volume
        poc_idx = int(np.argmax(vol_at_price))
        poc = round(float(bin_centers[poc_idx]), 2)

        # Value Area: bins containing 70% of total volume, expanding from POC
        total_vol = vol_at_price.sum()
        target_vol = total_vol * 0.70
        va_vol = vol_at_price[poc_idx]
        lo_idx = hi_idx = poc_idx

        while va_vol < target_vol:
            expand_up   = vol_at_price[hi_idx + 1] if hi_idx + 1 < bins else 0
            expand_down = vol_at_price[lo_idx - 1] if lo_idx - 1 >= 0 else 0
            if expand_up >= expand_down and hi_idx + 1 < bins:
                hi_idx += 1
                va_vol += vol_at_price[hi_idx]
            elif lo_idx - 1 >= 0:
                lo_idx -= 1
                va_vol += vol_at_price[lo_idx]
            else:
                break

        vah = round(float(bin_centers[hi_idx]), 2)
        val = round(float(bin_centers[lo_idx]), 2)
        ltp = float(df["close"].iloc[-1])

        # Signal: price relative to POC and value area
        if ltp > vah:
            vp_signal = STRONG_BUY   # above value area = breakout
        elif ltp > poc:
            vp_signal = BUY          # above POC = bullish
        elif ltp < val:
            vp_signal = STRONG_SELL  # below value area = breakdown
        elif ltp < poc:
            vp_signal = SELL         # below POC = bearish
        else:
            vp_signal = NEUTRAL

        return {
            "vp_poc":    poc,
            "vp_vah":    vah,
            "vp_val":    val,
            "vp_signal": vp_signal,
        }
    except Exception as e:
        logger.debug(f"Volume profile error: {e}")
        return {}


def _calculate_vwap_bands(df: pd.DataFrame) -> Dict[str, Any]:
    """
    VWAP with ±1σ and ±2σ Standard Deviation Bands
    =================================================
    VWAP = cumulative(typical_price × volume) / cumulative(volume)
    Bands = VWAP ± n × std_dev(typical_price, volume-weighted)

    Professional use:
    - Price above VWAP +2σ = extremely overbought (fade)
    - Price below VWAP -2σ = extremely oversold (buy)
    - Price crossing VWAP = trend change signal
    """
    try:
        tp = (df["high"] + df["low"] + df["close"]) / 3
        vol = df["volume"].replace(0, np.nan).fillna(1)
        cum_tp_vol = (tp * vol).cumsum()
        cum_vol    = vol.cumsum()
        vwap       = cum_tp_vol / cum_vol

        # Volume-weighted variance
        vw_var = ((tp - vwap) ** 2 * vol).cumsum() / cum_vol
        vw_std = np.sqrt(vw_var)

        vwap_val  = round(float(vwap.iloc[-1]),    2)
        std_val   = round(float(vw_std.iloc[-1]),  2)
        upper_1   = round(vwap_val + 1 * std_val,  2)
        upper_2   = round(vwap_val + 2 * std_val,  2)
        lower_1   = round(vwap_val - 1 * std_val,  2)
        lower_2   = round(vwap_val - 2 * std_val,  2)
        ltp       = float(df["close"].iloc[-1])

        if ltp >= upper_2:
            vwap_band_signal = STRONG_SELL
        elif ltp >= upper_1:
            vwap_band_signal = SELL
        elif ltp <= lower_2:
            vwap_band_signal = STRONG_BUY
        elif ltp <= lower_1:
            vwap_band_signal = BUY
        elif ltp > vwap_val:
            vwap_band_signal = BUY
        else:
            vwap_band_signal = SELL

        return {
            "vwap_bands": vwap_val,
            "vwap_upper_1": upper_1, "vwap_upper_2": upper_2,
            "vwap_lower_1": lower_1, "vwap_lower_2": lower_2,
            "vwap_std": std_val,
            "vwap_band_signal": vwap_band_signal,
        }
    except Exception as e:
        logger.debug(f"VWAP bands error: {e}")
        return {}


def _calculate_heikin_ashi(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Heikin Ashi Candles
    ====================
    HA_Close = (O + H + L + C) / 4
    HA_Open  = (prev_HA_Open + prev_HA_Close) / 2
    HA_High  = max(H, HA_Open, HA_Close)
    HA_Low   = min(L, HA_Open, HA_Close)

    Signals:
    - Consecutive green HA candles (no lower shadow) = strong uptrend
    - Consecutive red HA candles (no upper shadow) = strong downtrend
    - Small body with both shadows = trend reversal / indecision
    """
    try:
        if len(df) < 3:
            return {}

        ha_close = (df["open"] + df["high"] + df["low"] + df["close"]) / 4
        ha_open  = ha_close.copy()
        for i in range(1, len(df)):
            ha_open.iloc[i] = (ha_open.iloc[i - 1] + ha_close.iloc[i - 1]) / 2

        ha_high = pd.concat([df["high"], ha_open, ha_close], axis=1).max(axis=1)
        ha_low  = pd.concat([df["low"],  ha_open, ha_close], axis=1).min(axis=1)

        last_ha_open  = round(float(ha_open.iloc[-1]),  2)
        last_ha_close = round(float(ha_close.iloc[-1]), 2)
        last_ha_high  = round(float(ha_high.iloc[-1]),  2)
        last_ha_low   = round(float(ha_low.iloc[-1]),   2)

        ha_bullish = last_ha_close > last_ha_open
        # No lower shadow on green candle = strong bull
        no_lower_shadow = (min(last_ha_open, last_ha_close) - last_ha_low) < 0.001 * last_ha_close
        # No upper shadow on red candle = strong bear
        no_upper_shadow = (last_ha_high - max(last_ha_open, last_ha_close)) < 0.001 * last_ha_close

        # Count consecutive same-color candles
        consecutive = 1
        for i in range(len(df) - 2, max(0, len(df) - 6), -1):
            if (ha_close.iloc[i] > ha_open.iloc[i]) == ha_bullish:
                consecutive += 1
            else:
                break

        if ha_bullish and no_lower_shadow and consecutive >= 3:
            ha_signal = STRONG_BUY
        elif ha_bullish:
            ha_signal = BUY
        elif not ha_bullish and no_upper_shadow and consecutive >= 3:
            ha_signal = STRONG_SELL
        elif not ha_bullish:
            ha_signal = SELL
        else:
            ha_signal = NEUTRAL

        return {
            "ha_open":  last_ha_open,
            "ha_close": last_ha_close,
            "ha_high":  last_ha_high,
            "ha_low":   last_ha_low,
            "ha_bullish": ha_bullish,
            "ha_consecutive": consecutive,
            "ha_signal": ha_signal,
        }
    except Exception as e:
        logger.debug(f"Heikin Ashi error: {e}")
        return {}


def _calculate_overall_signal(indicators: Dict[str, Any]) -> str:
    """Aggregate all signals into a single overall signal"""
    signal_keys = [k for k in indicators if k.endswith("_signal")]
    if not signal_keys:
        return NEUTRAL

    scores = {STRONG_BUY: 2, BUY: 1, NEUTRAL: 0, SELL: -1, STRONG_SELL: -2}
    total = sum(scores.get(indicators[k], 0) for k in signal_keys)
    avg = total / len(signal_keys)

    if avg >= 1.2:
        return STRONG_BUY
    elif avg >= 0.4:
        return BUY
    elif avg <= -1.2:
        return STRONG_SELL
    elif avg <= -0.4:
        return SELL
    else:
        return NEUTRAL


# ── Unit Tests ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import random

    # Generate synthetic OHLCV data
    dates = pd.date_range("2024-01-01", periods=250, freq="D")
    close_prices = [2000.0]
    for _ in range(249):
        change = random.uniform(-0.03, 0.03)
        close_prices.append(round(close_prices[-1] * (1 + change), 2))

    df = pd.DataFrame({
        "time": dates,
        "open": [p * random.uniform(0.99, 1.01) for p in close_prices],
        "high": [p * random.uniform(1.00, 1.03) for p in close_prices],
        "low": [p * random.uniform(0.97, 1.00) for p in close_prices],
        "close": close_prices,
        "volume": [random.randint(500000, 5000000) for _ in close_prices],
    })

    result = calculate_all_indicators(df)
    print(f"Overall signal: {result.get('overall_signal')}")
    print(f"RSI: {result.get('rsi_14')}, MACD: {result.get('macd')}")
    print(f"Bullish signals: {result.get('bullish_count')}, Bearish: {result.get('bearish_count')}")
