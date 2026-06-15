"""
Options Strategy Backtesting Engine  — Professional Grade
==========================================================
Backtests the option trading signals strategy against historical NIFTY data.

Strategy Logic (mirrors option_suggestions.py):
  - ATM CE buy when PCR > 0.9 and trend BULLISH/SIDEWAYS
  - ATM PE buy when PCR < 1.1 and trend BEARISH/SIDEWAYS
  - Entry: ATM option premium priced via Black-Scholes
  - Exit: SL hit (35%) OR T1 hit (45%) OR T2 hit (90%) OR EOD/Expiry

Metrics (Professional):
  - Win rate, profit factor, max drawdown, Sharpe ratio
  - Sortino ratio (downside deviation only)
  - Calmar ratio (return / max drawdown)
  - Monte Carlo simulation (1000 runs) for confidence intervals
  - Walk-forward optimization (rolling windows)
  - Equity backtest for cash stocks (EMA crossover strategy)
  - Equity curve, monthly P&L, CE/PE breakdown
"""

import logging
import math
import os
import random
import sys
from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logger = logging.getLogger("backtest")

# ── Constants ─────────────────────────────────────────────────────────────────
NIFTY_LOT_SIZE = 75
INTRADAY_SL_PCT = 0.35
INTRADAY_T1_PCT = 0.45
INTRADAY_T2_PCT = 0.90
SWING_SL_PCT = 0.40
SWING_T1_PCT = 0.45
SWING_T2_PCT = 0.90
NIFTY_IV_BASE = 15.0
NIFTY_STRIKE_STEP = 50


# ── Black-Scholes ─────────────────────────────────────────────────────────────

def _norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _bs_price(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> float:
    if T <= 0 or S <= 0 or K <= 0 or sigma <= 0:
        return max(0.05, (S - K) if option_type == "CE" else (K - S))
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if option_type == "CE":
        price = S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    else:
        price = K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)
    return max(0.05, round(price, 2))


def _get_atm_strike(spot: float, step: int = 50) -> float:
    return round(round(spot / step) * step, 2)


def _estimate_iv(spot: float, strike: float, days_to_expiry: int) -> float:
    moneyness = abs(spot - strike) / spot
    base_iv = NIFTY_IV_BASE / 100
    smile_adj = moneyness * 0.5
    dte_adj = max(0, (7 - days_to_expiry) / 7) * 0.05
    return base_iv + smile_adj + dte_adj


# ── Trend Detection ───────────────────────────────────────────────────────────

def _detect_trend(df: pd.DataFrame, idx: int) -> Tuple[str, float, float]:
    """Returns (trend, pcr_estimate, rsi) using full history up to idx"""
    if idx < 21:
        return "SIDEWAYS", 1.0, 50.0

    # Use all available history for EMA (more stable)
    all_close = df["close"].iloc[:idx + 1]
    ema9 = float(all_close.ewm(span=9, adjust=False).mean().iloc[-1])
    ema21 = float(all_close.ewm(span=21, adjust=False).mean().iloc[-1])
    ema50 = float(all_close.ewm(span=50, adjust=False).mean().iloc[-1])
    current = float(all_close.iloc[-1])

    # RSI on last 20 bars
    window_close = all_close.iloc[-20:].values
    delta = pd.Series(window_close).diff()
    gain = float(delta.clip(lower=0).rolling(14, min_periods=1).mean().iloc[-1] or 0)
    loss = float((-delta.clip(upper=0)).rolling(14, min_periods=1).mean().iloc[-1] or 0)
    rsi = 100 - (100 / (1 + gain / loss)) if loss > 0 else 50.0

    # Short-term momentum: last 5 bars
    recent = all_close.iloc[-5:].values
    momentum = (recent[-1] - recent[0]) / recent[0] * 100  # % change over 5 days

    # Trend classification — require both EMA alignment AND momentum confirmation
    if current > ema9 > ema21 and rsi > 52 and momentum > 0.3:
        trend = "BULLISH"
        pcr = min(2.0, 1.1 + (rsi - 52) / 120)
    elif current < ema9 < ema21 and rsi < 48 and momentum < -0.3:
        trend = "BEARISH"
        pcr = max(0.4, 0.9 - (48 - rsi) / 120)
    elif current > ema50 and rsi > 55:
        trend = "BULLISH"
        pcr = 1.05
    elif current < ema50 and rsi < 45:
        trend = "BEARISH"
        pcr = 0.95
    else:
        trend = "SIDEWAYS"
        pcr = 1.0 + (rsi - 50) / 300

    return trend, round(pcr, 2), round(rsi, 1)


def _compute_confidence(trend: str, pcr: float, rsi: float, iv_pct: float) -> float:
    base = 65.0
    if trend == "BULLISH":
        base += min(15, (pcr - 0.9) * 30)
        if rsi > 55:
            base += min(5, (rsi - 55) / 5)
    elif trend == "BEARISH":
        base += min(15, (1.1 - pcr) * 30)
        if rsi < 45:
            base += min(5, (45 - rsi) / 5)
    if iv_pct > 25:
        base -= (iv_pct - 25) * 0.5
    return round(min(95, max(40, base)), 1)


# ── Signal Generator ──────────────────────────────────────────────────────────

def _generate_signal(
    spot: float,
    trend: str,
    pcr: float,
    rsi: float,
    days_to_expiry: int,
    trade_type: str,
    min_confidence: float,
) -> Optional[Dict[str, Any]]:
    atm = _get_atm_strike(spot)
    r = 0.065
    T = max(0.001, days_to_expiry / 365.0)

    if trend == "BULLISH":
        option_type, strike = "CE", atm
    elif trend == "BEARISH":
        option_type, strike = "PE", atm
    else:
        option_type = "CE" if pcr >= 1.0 else "PE"
        strike = atm

    iv = _estimate_iv(spot, strike, days_to_expiry)
    ltp = _bs_price(spot, strike, T, r, iv, option_type)
    if ltp < 1:
        return None

    sl_pct = INTRADAY_SL_PCT if trade_type == "INTRADAY" else SWING_SL_PCT
    t1_pct = INTRADAY_T1_PCT if trade_type == "INTRADAY" else SWING_T1_PCT
    t2_pct = INTRADAY_T2_PCT if trade_type == "INTRADAY" else SWING_T2_PCT

    entry = round(ltp, 2)
    confidence = _compute_confidence(trend, pcr, rsi, iv * 100)
    if confidence < min_confidence:
        return None

    return {
        "option_type": option_type,
        "strike": strike,
        "entry_price": entry,
        "stop_loss": round(entry * (1 - sl_pct), 2),
        "target_1": round(entry * (1 + t1_pct), 2),
        "target_2": round(entry * (1 + t2_pct), 2),
        "iv": round(iv * 100, 2),
        "confidence": confidence,
        "trend": trend,
        "pcr": pcr,
    }


# ── Trade Simulator ───────────────────────────────────────────────────────────

def _simulate_intraday_path(
    candle: pd.Series,
    entry_price: float,
    stop_loss: float,
    target_1: float,
    target_2: float,
    strike: float,
    iv: float,
    days_left: int,
    option_type: str,
    n_steps: int = 20,
) -> Tuple[float, str]:
    """
    Simulate intraday price path using the candle's H/L range.
    Generates n_steps intraday spot prices between open and close,
    bounded by high/low, then prices the option at each step.
    Returns (exit_price, exit_reason).
    """
    r = 0.065
    T = max(0.001, days_left / 365.0)

    spot_open = float(candle.get("open", candle["close"]))
    spot_high = float(candle.get("high", candle["close"]))
    spot_low = float(candle.get("low", candle["close"]))
    spot_close = float(candle["close"])

    # Generate intraday path: random walk bounded by H/L
    np.random.seed(None)
    steps = np.linspace(spot_open, spot_close, n_steps)
    noise = np.random.normal(0, (spot_high - spot_low) / (4 * n_steps), n_steps)
    path = np.clip(steps + np.cumsum(noise), spot_low, spot_high)
    path[-1] = spot_close  # ensure we end at close

    trailing_sl = stop_loss
    t1_hit = False
    partial_exit_price = 0.0

    for spot in path:
        opt_price = _bs_price(spot, strike, T, r, iv, option_type)

        if opt_price <= trailing_sl:
            return trailing_sl, "SL"

        if not t1_hit and opt_price >= target_1:
            t1_hit = True
            partial_exit_price = target_1
            trailing_sl = entry_price  # trail to breakeven

        if t1_hit and opt_price >= target_2:
            return target_2, "T2"

    # End of day
    eod_price = _bs_price(spot_close, strike, T, r, iv, option_type)
    if t1_hit:
        return target_1, "T1"
    return eod_price, "EOD"


def _simulate_trade(
    signal: Dict[str, Any],
    future_candles: pd.DataFrame,
    expiry_date: date,
    trade_type: str,
    lots: int,
    brokerage_per_lot: float,
    t1_exit_pct: float,
    trade_id: int,
    entry_date: str,
) -> Dict[str, Any]:
    r = 0.065
    entry_price = signal["entry_price"]
    stop_loss = signal["stop_loss"]
    target_1 = signal["target_1"]
    target_2 = signal["target_2"]
    option_type = signal["option_type"]
    strike = signal["strike"]
    iv = signal["iv"] / 100

    exit_price = entry_price
    exit_reason = "EOD"
    holding = 0
    t1_hit = False
    partial_exit_price = 0.0
    trailing_sl = stop_loss

    for i, (_, candle) in enumerate(future_candles.iterrows()):
        candle_date = pd.to_datetime(candle["time"]).date()
        days_left = max(0, (expiry_date - candle_date).days)
        T = max(0.001, days_left / 365.0)
        holding = i + 1

        if trade_type == "INTRADAY":
            # Simulate full intraday path using H/L range
            exit_price, exit_reason = _simulate_intraday_path(
                candle=candle,
                entry_price=entry_price,
                stop_loss=trailing_sl,
                target_1=target_1,
                target_2=target_2,
                strike=strike,
                iv=iv,
                days_left=days_left,
                option_type=option_type,
            )
            # Sync t1_hit flag for P&L split calculation
            if exit_reason in ("T1", "T2"):
                t1_hit = True
                partial_exit_price = target_1
            break  # intraday: always exits same day

        # SWING: check EOD price each day
        spot = float(candle["close"])
        current_price = _bs_price(spot, strike, T, r, iv, option_type)

        if current_price <= trailing_sl:
            exit_price = trailing_sl
            exit_reason = "SL"
            break

        if not t1_hit and current_price >= target_1:
            t1_hit = True
            partial_exit_price = target_1
            trailing_sl = entry_price

        if t1_hit and current_price >= target_2:
            exit_price = target_2
            exit_reason = "T2"
            break

        if days_left == 0:
            exit_price = current_price
            exit_reason = "EXPIRY"
            break

        exit_price = current_price
        exit_reason = "EOD"

    # P&L
    if t1_hit and exit_reason not in ("T1", "T2", "SL"):
        pnl_per_unit = (
            t1_exit_pct * (partial_exit_price - entry_price) +
            (1 - t1_exit_pct) * (exit_price - entry_price)
        )
    else:
        pnl_per_unit = exit_price - entry_price

    gross_pnl = pnl_per_unit * NIFTY_LOT_SIZE * lots
    brokerage = brokerage_per_lot * lots
    net_pnl = gross_pnl - brokerage
    pnl_pct = (pnl_per_unit / entry_price) * 100 if entry_price > 0 else 0

    return {
        "trade_id": trade_id,
        "date": entry_date,
        "option_type": option_type,
        "strike": strike,
        "expiry": expiry_date.strftime("%d%b%Y").upper(),
        "entry_price": entry_price,
        "stop_loss": signal["stop_loss"],
        "target_1": target_1,
        "target_2": target_2,
        "exit_price": round(exit_price, 2),
        "exit_reason": exit_reason,
        "pnl": round(gross_pnl, 2),
        "pnl_pct": round(pnl_pct, 2),
        "holding_periods": holding,
        "trend": signal["trend"],
        "pcr": signal["pcr"],
        "confidence": signal["confidence"],
        "is_winner": net_pnl > 0,
        "brokerage": brokerage,
        "net_pnl": round(net_pnl, 2),
    }


# ── Metrics ───────────────────────────────────────────────────────────────────

def _metrics_subset(trades: List[Dict]) -> Dict[str, Any]:
    if not trades:
        return {"trades": 0, "win_rate": 0, "pnl": 0}
    winners = [t for t in trades if t["net_pnl"] > 0]
    return {
        "trades": len(trades),
        "win_rate": round(len(winners) / len(trades) * 100, 1),
        "pnl": round(sum(t["net_pnl"] for t in trades), 2),
    }


def _compute_metrics(trades: List[Dict], initial_capital: float) -> Dict[str, Any]:
    if not trades:
        return {
            "total_trades": 0, "win_rate": 0, "profit_factor": 0,
            "total_pnl": 0, "total_return_pct": 0, "max_drawdown": 0,
            "max_drawdown_pct": 0, "sharpe_ratio": 0, "sortino_ratio": 0,
            "calmar_ratio": 0, "avg_win": 0, "avg_loss": 0,
            "best_trade": 0, "worst_trade": 0,
            "consecutive_wins": 0, "consecutive_losses": 0,
            "final_capital": initial_capital, "total_brokerage": 0,
            "expectancy": 0, "kelly_criterion": 0,
        }

    winners = [t for t in trades if t["net_pnl"] > 0]
    losers = [t for t in trades if t["net_pnl"] <= 0]
    total_pnl = sum(t["net_pnl"] for t in trades)
    gross_profit = sum(t["net_pnl"] for t in winners)
    gross_loss = abs(sum(t["net_pnl"] for t in losers))

    equity = initial_capital
    peak = initial_capital
    max_dd = 0.0
    for t in trades:
        equity += t["net_pnl"]
        if equity > peak:
            peak = equity
        dd = peak - equity
        if dd > max_dd:
            max_dd = dd

    daily_returns = [t["net_pnl"] / initial_capital for t in trades]
    mean_r = float(np.mean(daily_returns))
    std_r = float(np.std(daily_returns))
    sharpe = (mean_r / std_r * math.sqrt(252)) if std_r > 0 else 0

    # Sortino Ratio: only penalise downside deviation
    downside_returns = [r for r in daily_returns if r < 0]
    downside_std = float(np.std(downside_returns)) if len(downside_returns) > 1 else std_r
    sortino = (mean_r / downside_std * math.sqrt(252)) if downside_std > 0 else 0

    # Calmar Ratio: annualised return / max drawdown
    annualised_return = mean_r * 252
    calmar = (annualised_return / (max_dd / initial_capital)) if max_dd > 0 else 0

    # Expectancy per trade (₹)
    avg_win = float(np.mean([t["net_pnl"] for t in winners])) if winners else 0
    avg_loss = float(np.mean([t["net_pnl"] for t in losers])) if losers else 0
    win_rate_dec = len(winners) / len(trades)
    expectancy = (win_rate_dec * avg_win) + ((1 - win_rate_dec) * avg_loss)

    # Kelly Criterion: optimal position sizing
    if avg_loss != 0 and win_rate_dec > 0:
        win_loss_ratio = abs(avg_win / avg_loss) if avg_loss != 0 else 1
        kelly = win_rate_dec - ((1 - win_rate_dec) / win_loss_ratio)
        kelly = max(0.0, min(0.5, kelly))  # cap at 50% for safety
    else:
        kelly = 0.0

    max_cw = max_cl = cw = cl = 0
    for t in trades:
        if t["net_pnl"] > 0:
            cw += 1; cl = 0; max_cw = max(max_cw, cw)
        else:
            cl += 1; cw = 0; max_cl = max(max_cl, cl)

    exit_counts: Dict[str, int] = {}
    for t in trades:
        exit_counts[t["exit_reason"]] = exit_counts.get(t["exit_reason"], 0) + 1

    ce_trades = [t for t in trades if t.get("option_type") == "CE"]
    pe_trades = [t for t in trades if t.get("option_type") == "PE"]

    return {
        "total_trades": len(trades),
        "winning_trades": len(winners),
        "losing_trades": len(losers),
        "win_rate": round(win_rate_dec * 100, 1),
        "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else 999.0,
        "total_pnl": round(total_pnl, 2),
        "total_return_pct": round(total_pnl / initial_capital * 100, 2),
        "max_drawdown": round(max_dd, 2),
        "max_drawdown_pct": round(max_dd / initial_capital * 100, 2),
        "sharpe_ratio": round(sharpe, 2),
        "sortino_ratio": round(sortino, 2),
        "calmar_ratio": round(calmar, 2),
        "expectancy": round(expectancy, 2),
        "kelly_criterion": round(kelly * 100, 1),  # as percentage
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "best_trade": round(max(t["net_pnl"] for t in trades), 2),
        "worst_trade": round(min(t["net_pnl"] for t in trades), 2),
        "avg_holding_periods": round(float(np.mean([t.get("holding_periods", 1) for t in trades])), 1),
        "consecutive_wins": max_cw,
        "consecutive_losses": max_cl,
        "ce_trades": len(ce_trades),
        "pe_trades": len(pe_trades),
        "ce_win_rate": round(len([t for t in ce_trades if t["net_pnl"] > 0]) / len(ce_trades) * 100, 1) if ce_trades else 0,
        "pe_win_rate": round(len([t for t in pe_trades if t["net_pnl"] > 0]) / len(pe_trades) * 100, 1) if pe_trades else 0,
        "sl_exits": exit_counts.get("SL", 0),
        "t1_exits": exit_counts.get("T1", 0),
        "t2_exits": exit_counts.get("T2", 0),
        "eod_exits": exit_counts.get("EOD", 0),
        "expiry_exits": exit_counts.get("EXPIRY", 0),
        "final_capital": round(initial_capital + total_pnl, 2),
        "total_brokerage": round(sum(t.get("brokerage", 0) for t in trades), 2),
    }


def _build_equity_curve(trades: List[Dict], initial_capital: float) -> List[Dict[str, Any]]:
    curve = []
    equity = initial_capital
    peak = initial_capital
    for t in trades:
        equity += t["net_pnl"]
        if equity > peak:
            peak = equity
        curve.append({
            "date": t["date"],
            "trade_id": t["trade_id"],
            "pnl": t["net_pnl"],
            "equity": round(equity, 2),
            "drawdown": round(peak - equity, 2),
            "is_winner": t["is_winner"],
        })
    return curve


def _build_monthly_pnl(trades: List[Dict]) -> List[Dict[str, Any]]:
    monthly: Dict[str, Dict[str, Any]] = {}
    for t in trades:
        try:
            key = t["date"][:7]
            if key not in monthly:
                monthly[key] = {"month": key, "pnl": 0.0, "trades": 0, "wins": 0}
            monthly[key]["pnl"] += t["net_pnl"]
            monthly[key]["trades"] += 1
            if t["is_winner"]:
                monthly[key]["wins"] += 1
        except Exception:
            pass
    result = sorted(monthly.values(), key=lambda x: x["month"])
    for m in result:
        m["pnl"] = round(m["pnl"], 2)
        m["win_rate"] = round(m["wins"] / m["trades"] * 100, 1) if m["trades"] > 0 else 0
    return result


# ── Monte Carlo Simulation ────────────────────────────────────────────────────

def run_monte_carlo(
    trades: List[Dict],
    initial_capital: float,
    n_simulations: int = 1000,
    confidence_levels: List[float] = None,
) -> Dict[str, Any]:
    """
    Monte Carlo simulation: randomly resample trade sequence N times.
    Returns confidence intervals for final equity, max drawdown, and win rate.
    Used to stress-test strategy robustness.
    """
    if confidence_levels is None:
        confidence_levels = [0.05, 0.25, 0.50, 0.75, 0.95]

    if not trades or len(trades) < 5:
        return {"error": "Insufficient trades for Monte Carlo (need ≥5)"}

    pnl_list = [t["net_pnl"] for t in trades]
    n_trades = len(pnl_list)

    final_equities = []
    max_drawdowns = []
    win_rates = []

    rng = np.random.default_rng(seed=42)

    for _ in range(n_simulations):
        # Bootstrap: sample with replacement
        sampled = rng.choice(pnl_list, size=n_trades, replace=True)

        equity = initial_capital
        peak = initial_capital
        max_dd = 0.0
        wins = 0

        for pnl in sampled:
            equity += pnl
            if equity > peak:
                peak = equity
            dd = peak - equity
            if dd > max_dd:
                max_dd = dd
            if pnl > 0:
                wins += 1

        final_equities.append(equity)
        max_drawdowns.append(max_dd)
        win_rates.append(wins / n_trades * 100)

    final_equities = sorted(final_equities)
    max_drawdowns = sorted(max_drawdowns)
    win_rates = sorted(win_rates)

    def _percentile(data: list, p: float) -> float:
        idx = int(p * len(data))
        return round(data[min(idx, len(data) - 1)], 2)

    return {
        "n_simulations": n_simulations,
        "n_trades": n_trades,
        "initial_capital": initial_capital,
        "final_equity": {
            f"p{int(p*100)}": _percentile(final_equities, p)
            for p in confidence_levels
        },
        "max_drawdown": {
            f"p{int(p*100)}": _percentile(max_drawdowns, p)
            for p in confidence_levels
        },
        "win_rate": {
            f"p{int(p*100)}": round(_percentile(win_rates, p), 1)
            for p in confidence_levels
        },
        "probability_of_profit": round(
            sum(1 for e in final_equities if e > initial_capital) / n_simulations * 100, 1
        ),
        "probability_of_ruin": round(
            sum(1 for e in final_equities if e < initial_capital * 0.5) / n_simulations * 100, 1
        ),
        "median_final_equity": _percentile(final_equities, 0.50),
        "worst_case_equity": _percentile(final_equities, 0.05),
        "best_case_equity": _percentile(final_equities, 0.95),
    }


# ── Walk-Forward Optimization ─────────────────────────────────────────────────

def run_walk_forward(
    df: pd.DataFrame,
    initial_capital: float = 500000.0,
    train_pct: float = 0.60,
    n_windows: int = 5,
    trade_type: str = "INTRADAY",
) -> Dict[str, Any]:
    """
    Walk-forward optimization: sliding windows with overlap.
    Each window uses the full data up to that point as context for _detect_trend.
    Test portion starts after train_pct of the window.
    """
    if len(df) < 100:
        return {"error": "Insufficient data for walk-forward (need ≥100 candles)"}

    df = df.sort_values("time").reset_index(drop=True)
    n = len(df)

    # Use overlapping sliding windows: each window is 60% of total data,
    # sliding by (n - window_size) / (n_windows - 1) each step
    window_size = max(60, int(n * 0.6))
    step = max(1, (n - window_size) // max(1, n_windows - 1))

    windows = []
    for i in range(n_windows):
        start_idx = i * step
        end_idx = min(start_idx + window_size, n)
        if end_idx - start_idx < 50:
            continue

        window_df = df.iloc[start_idx:end_idx].reset_index(drop=True)
        train_end = int(len(window_df) * train_pct)

        # Use full window for trend detection context, but only trade in test portion
        test_df = window_df  # full window for context
        test_start_idx = max(22, train_end)  # start trading from train_end

        if len(window_df) - test_start_idx < 5:
            continue

        # Run backtest on test portion (but with full history for _detect_trend)
        test_trades: List[Dict] = []
        trade_id = 1
        in_trade = False

        for idx in range(test_start_idx, len(test_df) - 1):
            if in_trade:
                in_trade = False
                continue

            row = test_df.iloc[idx]
            spot = float(row["close"])
            candle_date = pd.to_datetime(row["time"]).date()

            if candle_date.weekday() >= 5:
                continue

            trend, pcr, rsi = _detect_trend(test_df, idx)
            days_to_thursday = (3 - candle_date.weekday()) % 7
            if days_to_thursday == 0:
                days_to_thursday = 7
            expiry_date = candle_date + timedelta(days=days_to_thursday)
            days_to_expiry = (expiry_date - candle_date).days

            if days_to_expiry == 0:
                continue

            signal = _generate_signal(
                spot=spot, trend=trend, pcr=pcr, rsi=rsi,
                days_to_expiry=days_to_expiry, trade_type=trade_type,
                min_confidence=65.0,
            )
            if signal is None:
                continue

            future_start = idx + 1
            future_candles = test_df.iloc[future_start: future_start + (1 if trade_type == "INTRADAY" else 5)]
            if len(future_candles) == 0:
                continue

            trade = _simulate_trade(
                signal=signal, future_candles=future_candles,
                expiry_date=expiry_date, trade_type=trade_type,
                lots=1, brokerage_per_lot=40.0, t1_exit_pct=0.5,
                trade_id=trade_id, entry_date=str(candle_date),
            )
            test_trades.append(trade)
            trade_id += 1
            in_trade = True

        if test_trades:
            metrics = _compute_metrics(test_trades, initial_capital)
            start_dt = str(pd.to_datetime(window_df["time"].iloc[test_start_idx]).date())
            end_dt = str(pd.to_datetime(window_df["time"].iloc[-1]).date())
            windows.append({
                "window": i + 1,
                "test_start": start_dt,
                "test_end": end_dt,
                "trades": len(test_trades),
                "win_rate": metrics["win_rate"],
                "total_pnl": metrics["total_pnl"],
                "sharpe_ratio": metrics["sharpe_ratio"],
                "sortino_ratio": metrics["sortino_ratio"],
                "max_drawdown_pct": metrics["max_drawdown_pct"],
                "profit_factor": metrics["profit_factor"],
            })

    if not windows:
        return {"error": "No valid windows generated"}

    avg_win_rate = round(float(np.mean([w["win_rate"] for w in windows])), 1)
    avg_pnl = round(float(np.mean([w["total_pnl"] for w in windows])), 2)
    avg_sharpe = round(float(np.mean([w["sharpe_ratio"] for w in windows])), 2)
    consistency = round(
        sum(1 for w in windows if w["total_pnl"] > 0) / len(windows) * 100, 1
    )

    return {
        "n_windows": len(windows),
        "train_pct": train_pct,
        "windows": windows,
        "summary": {
            "avg_win_rate": avg_win_rate,
            "avg_pnl": avg_pnl,
            "avg_sharpe": avg_sharpe,
            "profitable_windows_pct": consistency,
            "is_robust": consistency >= 60 and avg_win_rate >= 50,
        },
    }


# ── Equity Stock Backtest ─────────────────────────────────────────────────────

def run_equity_backtest(
    symbol: str,
    start_date: str = "",
    end_date: str = "",
    initial_capital: float = 500000.0,
    strategy: str = "EMA_CROSSOVER",
    fast_ema: int = 9,
    slow_ema: int = 21,
    sl_pct: float = 0.03,
    target_pct: float = 0.06,
    brokerage_pct: float = 0.0003,
) -> Dict[str, Any]:
    """
    Equity stock backtest — EMA crossover or Supertrend strategy.
    Buys on golden cross (fast EMA > slow EMA), sells on death cross.
    Uses ATR-based stop-loss and target.
    """
    if not end_date:
        end_date = datetime.now().strftime("%Y-%m-%d")
    if not start_date:
        start_date = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")

    logger.info(f"Equity backtest: {symbol} | {strategy} | {start_date} → {end_date}")

    # Load data
    df = _load_historical_data(symbol, start_date, end_date)
    if df is None or len(df) < 50:
        # Generate synthetic equity data
        df = _generate_synthetic_equity(symbol, start_date, end_date)

    df = df.sort_values("time").reset_index(drop=True)

    # Calculate indicators
    close = df["close"]
    df["ema_fast"] = close.ewm(span=fast_ema, adjust=False).mean()
    df["ema_slow"] = close.ewm(span=slow_ema, adjust=False).mean()
    df["ema_200"] = close.ewm(span=200, adjust=False).mean()

    # ATR for dynamic SL
    high_low = df["high"] - df["low"]
    high_close = (df["high"] - df["close"].shift()).abs()
    low_close = (df["low"] - df["close"].shift()).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    df["atr"] = tr.rolling(14, min_periods=1).mean()

    # RSI
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14, min_periods=1).mean()
    loss = (-delta.clip(upper=0)).rolling(14, min_periods=1).mean()
    df["rsi"] = 100 - (100 / (1 + gain / loss.replace(0, np.nan))).fillna(50)

    trades: List[Dict] = []
    trade_id = 1
    position = None  # {"entry_price", "entry_date", "shares", "sl", "target"}

    for idx in range(slow_ema + 5, len(df)):
        row = df.iloc[idx]
        prev = df.iloc[idx - 1]
        ltp = float(row["close"])
        atr = float(row["atr"]) if not pd.isna(row["atr"]) else ltp * 0.02

        if position is not None:
            # Check exit conditions
            exit_price = None
            exit_reason = None

            if ltp <= position["sl"]:
                exit_price = position["sl"]
                exit_reason = "SL"
            elif ltp >= position["target"]:
                exit_price = position["target"]
                exit_reason = "TARGET"
            elif strategy == "EMA_CROSSOVER":
                # Death cross exit
                if float(row["ema_fast"]) < float(row["ema_slow"]):
                    exit_price = ltp
                    exit_reason = "SIGNAL"
            elif strategy == "SUPERTREND":
                if float(row.get("rsi", 50)) < 40:
                    exit_price = ltp
                    exit_reason = "SIGNAL"

            if exit_price is not None:
                gross_pnl = (exit_price - position["entry_price"]) * position["shares"]
                brokerage = exit_price * position["shares"] * brokerage_pct * 2
                net_pnl = gross_pnl - brokerage
                pnl_pct = (exit_price - position["entry_price"]) / position["entry_price"] * 100

                trades.append({
                    "trade_id": trade_id,
                    "date": position["entry_date"],
                    "exit_date": str(pd.to_datetime(row["time"]).date()),
                    "symbol": symbol,
                    "entry_price": round(position["entry_price"], 2),
                    "exit_price": round(exit_price, 2),
                    "stop_loss": round(position["sl"], 2),
                    "target": round(position["target"], 2),
                    "shares": position["shares"],
                    "exit_reason": exit_reason,
                    "pnl": round(gross_pnl, 2),
                    "net_pnl": round(net_pnl, 2),
                    "pnl_pct": round(pnl_pct, 2),
                    "brokerage": round(brokerage, 2),
                    "is_winner": net_pnl > 0,
                    "holding_periods": max(1, (
                        pd.to_datetime(row["time"]).date() -
                        pd.to_datetime(position["entry_date"]).date()
                    ).days),
                })
                trade_id += 1
                position = None

        else:
            # Check entry conditions
            entry_signal = False

            if strategy == "EMA_CROSSOVER":
                # Golden cross: fast EMA crosses above slow EMA
                prev_fast = float(prev["ema_fast"])
                prev_slow = float(prev["ema_slow"])
                curr_fast = float(row["ema_fast"])
                curr_slow = float(row["ema_slow"])
                entry_signal = (prev_fast <= prev_slow) and (curr_fast > curr_slow)
                # Additional filter: price above 200 EMA
                if entry_signal and float(row["ema_200"]) > 0:
                    entry_signal = ltp > float(row["ema_200"])

            elif strategy == "SUPERTREND":
                # RSI oversold + price above 50 EMA
                rsi_val = float(row.get("rsi", 50))
                ema50 = float(close.ewm(span=50, adjust=False).mean().iloc[idx])
                entry_signal = rsi_val < 35 and ltp > ema50

            if entry_signal:
                # Position sizing: risk 2% of capital per trade
                risk_per_share = atr * 1.5
                shares = max(1, int((initial_capital * 0.02) / risk_per_share))
                # Cap at 20% of capital
                max_shares = int(initial_capital * 0.20 / ltp)
                shares = min(shares, max_shares)

                entry_sl = ltp - (atr * 1.5)
                entry_target = ltp + (atr * 3.0)

                position = {
                    "entry_price": ltp,
                    "entry_date": str(pd.to_datetime(row["time"]).date()),
                    "shares": shares,
                    "sl": round(entry_sl, 2),
                    "target": round(entry_target, 2),
                }

    # Close any open position at end
    if position and len(df) > 0:
        last_row = df.iloc[-1]
        exit_price = float(last_row["close"])
        gross_pnl = (exit_price - position["entry_price"]) * position["shares"]
        brokerage = exit_price * position["shares"] * brokerage_pct * 2
        net_pnl = gross_pnl - brokerage
        trades.append({
            "trade_id": trade_id,
            "date": position["entry_date"],
            "exit_date": str(pd.to_datetime(last_row["time"]).date()),
            "symbol": symbol,
            "entry_price": round(position["entry_price"], 2),
            "exit_price": round(exit_price, 2),
            "stop_loss": round(position["sl"], 2),
            "target": round(position["target"], 2),
            "shares": position["shares"],
            "exit_reason": "EOD",
            "pnl": round(gross_pnl, 2),
            "net_pnl": round(net_pnl, 2),
            "pnl_pct": round((exit_price - position["entry_price"]) / position["entry_price"] * 100, 2),
            "brokerage": round(brokerage, 2),
            "is_winner": net_pnl > 0,
            "holding_periods": 1,
        })

    metrics = _compute_metrics(trades, initial_capital)
    equity_curve = _build_equity_curve(trades, initial_capital)
    monthly_pnl = _build_monthly_pnl(trades)

    # Buy & hold comparison
    if len(df) >= 2:
        bh_return = (float(df["close"].iloc[-1]) - float(df["close"].iloc[0])) / float(df["close"].iloc[0]) * 100
    else:
        bh_return = 0.0

    return {
        "config": {
            "symbol": symbol,
            "strategy": strategy,
            "start_date": start_date,
            "end_date": end_date,
            "initial_capital": initial_capital,
            "fast_ema": fast_ema,
            "slow_ema": slow_ema,
            "sl_pct": sl_pct,
            "target_pct": target_pct,
            "total_candles": len(df),
        },
        "trades": trades,
        "metrics": metrics,
        "equity_curve": equity_curve,
        "monthly_pnl": monthly_pnl,
        "buy_and_hold_return_pct": round(bh_return, 2),
        "alpha": round(metrics["total_return_pct"] - bh_return, 2),
        "generated_at": datetime.now().isoformat(),
    }


def _generate_synthetic_equity(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    """Generate synthetic equity price data for any stock symbol"""
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    dates = pd.bdate_range(start=start, end=end)
    n = len(dates)

    if n < 50:
        dates = pd.bdate_range(start=start, end=start + timedelta(days=365))
        n = len(dates)

    # Use symbol hash for reproducible but varied starting prices
    seed = sum(ord(c) for c in symbol) % 1000
    np.random.seed(seed)

    # Starting price based on symbol (rough mapping)
    price_map = {
        "RELIANCE": 2800, "HDFCBANK": 1650, "INFY": 1800, "TCS": 4200,
        "ICICIBANK": 1200, "SBIN": 800, "TATAMOTORS": 950, "WIPRO": 550,
    }
    S0 = price_map.get(symbol.upper(), 500 + seed)

    # Regime-switching GBM (same as NIFTY but stock-specific params)
    regime_mu = [0.0006, -0.0005, 0.0001]
    regime_sigma = [0.015, 0.020, 0.010]
    trans = np.array([[0.96, 0.02, 0.02], [0.02, 0.95, 0.03], [0.04, 0.03, 0.93]])

    regime = 0
    regimes = []
    for _ in range(n):
        regimes.append(regime)
        regime = np.random.choice(3, p=trans[regime])

    returns = np.zeros(n)
    vol = np.zeros(n)
    vol[0] = regime_sigma[regimes[0]]
    for i in range(n):
        base_vol = regime_sigma[regimes[i]]
        if i > 0:
            vol[i] = 0.80 * vol[i-1] + 0.20 * base_vol + 0.05 * abs(returns[i-1])
        returns[i] = regime_mu[regimes[i]] + vol[i] * np.random.normal(0, 1)

    prices = [S0]
    for ret in returns[1:]:
        prices.append(max(1.0, prices[-1] * (1 + ret)))

    rows = []
    for i, (dt, close) in enumerate(zip(dates, prices)):
        range_pct = regime_sigma[regimes[i]] * np.random.uniform(1.5, 3.0)
        intraday_range = close * range_pct
        open_price = close * (1 + np.random.normal(0, regime_sigma[regimes[i]] * 0.3))
        high = max(open_price, close) + intraday_range * np.random.uniform(0.2, 0.6)
        low = min(open_price, close) - intraday_range * np.random.uniform(0.2, 0.6)
        low = max(low, close * 0.85)
        high = min(high, close * 1.15)
        volume = int(np.random.uniform(1e5, 5e6))
        rows.append({
            "time": dt, "open": round(open_price, 2), "high": round(high, 2),
            "low": round(low, 2), "close": round(close, 2), "volume": volume,
        })

    return pd.DataFrame(rows)


# ── Data Loaders ──────────────────────────────────────────────────────────────

def _load_historical_data(symbol: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
    """Try to load historical OHLCV from Angel One via data_fetcher"""
    try:
        from backend.data_fetcher import get_historical_ohlcv, get_smart_api
        candles = get_historical_ohlcv(
            symbol=symbol.replace(" ", "").replace("50", ""),
            exchange="NSE",
            interval="1d",
            from_date=f"{start_date} 09:15",
            to_date=f"{end_date} 15:30",
        )
        if candles and len(candles) > 10:
            df = pd.DataFrame(candles)
            df["time"] = pd.to_datetime(df["time"])
            return df
    except Exception as e:
        logger.warning(f"Could not load live historical data: {e}")
    return None


def _generate_synthetic_nifty(start_date: str, end_date: str) -> pd.DataFrame:
    """
    Generate realistic synthetic NIFTY 50 daily OHLCV data.
    Uses mean-reverting GBM with regime switching so the series
    has realistic bull/bear/sideways cycles — not a monotone uptrend.
    """
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")

    dates = pd.bdate_range(start=start, end=end)
    n = len(dates)

    if n < 30:
        # Extend to at least 1 year of data for meaningful backtesting
        dates = pd.bdate_range(start=start, end=start + timedelta(days=365))
        n = len(dates)

    np.random.seed(42)

    # ── Regime-switching parameters ──────────────────────────────────────────
    # Regimes: 0=BULL (+drift), 1=BEAR (-drift), 2=SIDEWAYS (low drift)
    regime_mu    = [0.0008,  -0.0006,  0.0001]   # daily drift per regime
    regime_sigma = [0.008,    0.012,   0.006]     # daily vol per regime
    # Transition matrix: P[from][to]
    trans = np.array([
        [0.97, 0.02, 0.01],   # BULL → stays BULL 97%, goes BEAR 2%, SIDEWAYS 1%
        [0.02, 0.96, 0.02],   # BEAR → stays BEAR 96%
        [0.03, 0.03, 0.94],   # SIDEWAYS → stays SIDEWAYS 94%
    ])

    # Simulate regime sequence
    regime = 0  # start BULL
    regimes = []
    for _ in range(n):
        regimes.append(regime)
        regime = np.random.choice(3, p=trans[regime])

    # Generate daily returns with GARCH-like volatility clustering
    S0 = 23500.0
    returns = np.zeros(n)
    vol = np.zeros(n)
    vol[0] = regime_sigma[regimes[0]]
    for i in range(n):
        r_regime = regimes[i]
        base_vol = regime_sigma[r_regime]
        # GARCH(1,1)-like: vol persistence
        if i > 0:
            vol[i] = 0.85 * vol[i-1] + 0.15 * base_vol + 0.05 * abs(returns[i-1])
        else:
            vol[i] = base_vol
        returns[i] = regime_mu[r_regime] + vol[i] * np.random.normal(0, 1)

    # Build price series
    prices = [S0]
    for ret in returns[1:]:
        prices.append(max(100.0, prices[-1] * (1 + ret)))

    # Build OHLCV with realistic intraday range
    rows = []
    for i, (dt, close) in enumerate(zip(dates, prices)):
        r_regime = regimes[i]
        # Intraday range scales with regime volatility
        range_pct = regime_sigma[r_regime] * np.random.uniform(1.5, 3.0)
        intraday_range = close * range_pct

        open_price = close * (1 + np.random.normal(0, regime_sigma[r_regime] * 0.3))
        high = max(open_price, close) + intraday_range * np.random.uniform(0.2, 0.6)
        low  = min(open_price, close) - intraday_range * np.random.uniform(0.2, 0.6)
        low  = max(low, close * 0.90)   # cap at -10% intraday
        high = min(high, close * 1.10)  # cap at +10% intraday
        volume = int(np.random.uniform(8e6, 20e6))

        rows.append({
            "time":   dt,
            "open":   round(open_price, 2),
            "high":   round(high, 2),
            "low":    round(low, 2),
            "close":  round(close, 2),
            "volume": volume,
        })

    df = pd.DataFrame(rows)
    bull_days = sum(1 for r in regimes if r == 0)
    bear_days = sum(1 for r in regimes if r == 1)
    side_days = sum(1 for r in regimes if r == 2)
    logger.info(
        f"Generated {len(df)} synthetic NIFTY candles ({start_date} → {end_date}) "
        f"| BULL:{bull_days} BEAR:{bear_days} SIDEWAYS:{side_days}"
    )
    return df


# ── Main Entry Point ──────────────────────────────────────────────────────────

def run_backtest(
    symbol: str = "NIFTY 50",
    start_date: str = "",
    end_date: str = "",
    initial_capital: float = 500000.0,
    lots_per_trade: int = 1,
    trade_type: str = "INTRADAY",
    min_confidence: float = 70.0,
    t1_exit_pct: float = 0.5,
    brokerage_per_lot: float = 40.0,
) -> Dict[str, Any]:
    """
    Run the options strategy backtest.
    Returns full BacktestResult as a dict.
    """
    # Default date range: last 1 year
    if not end_date:
        end_date = datetime.now().strftime("%Y-%m-%d")
    if not start_date:
        start_date = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")

    logger.info(f"Backtest: {symbol} | {start_date} → {end_date} | {trade_type} | Capital: ₹{initial_capital:,.0f}")

    # Load data
    df = _load_historical_data(symbol, start_date, end_date)
    if df is None or len(df) < 30:
        logger.info("Using synthetic NIFTY data for backtest")
        df = _generate_synthetic_nifty(start_date, end_date)

    df = df.sort_values("time").reset_index(drop=True)

    # Run strategy
    trades: List[Dict] = []
    trade_id = 1
    in_trade = False

    for idx in range(20, len(df) - 1):
        if in_trade:
            in_trade = False
            continue

        row = df.iloc[idx]
        spot = float(row["close"])
        candle_date = pd.to_datetime(row["time"]).date()

        if candle_date.weekday() >= 5:
            continue

        trend, pcr, rsi = _detect_trend(df, idx)

        # Next Thursday expiry
        days_to_thursday = (3 - candle_date.weekday()) % 7
        if days_to_thursday == 0:
            days_to_thursday = 7
        expiry_date = candle_date + timedelta(days=days_to_thursday)
        days_to_expiry = (expiry_date - candle_date).days

        if days_to_expiry == 0:
            continue

        signal = _generate_signal(
            spot=spot,
            trend=trend,
            pcr=pcr,
            rsi=rsi,
            days_to_expiry=days_to_expiry,
            trade_type=trade_type,
            min_confidence=min_confidence,
        )

        if signal is None:
            continue

        future_start = idx + 1
        if trade_type == "INTRADAY":
            future_candles = df.iloc[future_start: future_start + 1]
        else:
            future_candles = df.iloc[future_start: future_start + 5]

        if len(future_candles) == 0:
            continue

        trade = _simulate_trade(
            signal=signal,
            future_candles=future_candles,
            expiry_date=expiry_date,
            trade_type=trade_type,
            lots=lots_per_trade,
            brokerage_per_lot=brokerage_per_lot,
            t1_exit_pct=t1_exit_pct,
            trade_id=trade_id,
            entry_date=str(candle_date),
        )

        trades.append(trade)
        trade_id += 1
        in_trade = True

    # Compute results
    metrics = _compute_metrics(trades, initial_capital)
    equity_curve = _build_equity_curve(trades, initial_capital)
    monthly_pnl = _build_monthly_pnl(trades)

    strategy_breakdown = {
        "by_trend": {
            "BULLISH": _metrics_subset([t for t in trades if t["trend"] == "BULLISH"]),
            "BEARISH": _metrics_subset([t for t in trades if t["trend"] == "BEARISH"]),
            "SIDEWAYS": _metrics_subset([t for t in trades if t["trend"] == "SIDEWAYS"]),
        },
        "by_option_type": {
            "CE": _metrics_subset([t for t in trades if t["option_type"] == "CE"]),
            "PE": _metrics_subset([t for t in trades if t["option_type"] == "PE"]),
        },
        "by_exit_reason": {
            "SL": len([t for t in trades if t["exit_reason"] == "SL"]),
            "T1": len([t for t in trades if t["exit_reason"] == "T1"]),
            "T2": len([t for t in trades if t["exit_reason"] == "T2"]),
            "EOD": len([t for t in trades if t["exit_reason"] == "EOD"]),
            "EXPIRY": len([t for t in trades if t["exit_reason"] == "EXPIRY"]),
        },
    }

    return {
        "config": {
            "symbol": symbol,
            "start_date": start_date,
            "end_date": end_date,
            "initial_capital": initial_capital,
            "lots_per_trade": lots_per_trade,
            "trade_type": trade_type,
            "min_confidence": min_confidence,
            "t1_exit_pct": t1_exit_pct,
            "brokerage_per_lot": brokerage_per_lot,
            "total_candles": len(df),
        },
        "trades": trades,
        "metrics": metrics,
        "equity_curve": equity_curve,
        "monthly_pnl": monthly_pnl,
        "strategy_breakdown": strategy_breakdown,
        "generated_at": datetime.now().isoformat(),
    }
