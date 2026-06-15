"""
Options Trading Suggestions Router
===================================
Provides AI-driven NIFTY 50 options trading suggestions with:
- Live option chain data
- Entry / Exit / Stop-Loss / Target prices
- Greeks analysis (Delta, Gamma, Theta, Vega)
- PCR, Max Pain, OI analysis
- Trend-based CE/PE recommendations
- Risk/Reward calculations
"""
import json
import math
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.database import get_redis
from backend.nse_calendar import (
    upcoming_weekly_expiries,
    next_weekly_expiry,
    is_monthly_expiry,
    format_expiry,
    now_ist,
)

logger = logging.getLogger("option_suggestions")

router = APIRouter(prefix="/api/options/suggestions", tags=["Option Suggestions"])


# ── Response Models ────────────────────────────────────────────────────────────

class OptionTrade(BaseModel):
    symbol: str
    option_type: str          # CE or PE
    strike: float
    expiry: str
    ltp: float
    entry_price: float
    entry_range_low: float
    entry_range_high: float
    target_1: float
    target_2: float
    stop_loss: float
    risk_reward: float
    max_profit: float
    max_loss: float
    breakeven: float
    lot_size: int
    lots_suggested: int
    capital_required: float
    delta: float
    gamma: float
    theta: float
    vega: float
    iv: float
    oi: int
    oi_change: int
    volume: int
    signal_strength: str      # STRONG / MODERATE / WEAK
    trade_type: str           # INTRADAY / SWING / POSITIONAL
    rationale: List[str]
    risks: List[str]
    confidence_pct: float
    trend_direction: str      # BULLISH / BEARISH / NEUTRAL


class MarketContext(BaseModel):
    underlying_price: float
    atm_strike: float
    pcr: float
    max_pain: float
    total_ce_oi: int
    total_pe_oi: int
    iv_rank: float            # 0–100
    market_trend: str         # BULLISH / BEARISH / SIDEWAYS
    support_level: float
    resistance_level: float
    vix_estimate: float
    timestamp: str


class OptionSuggestionsResponse(BaseModel):
    symbol: str
    expiry: str
    market_context: MarketContext
    suggestions: List[OptionTrade]
    option_chain_snapshot: Dict[str, Any]
    generated_at: str


# ── NIFTY Lot Size ─────────────────────────────────────────────────────────────
NIFTY_LOT_SIZE = 75
BANKNIFTY_LOT_SIZE = 15
LOT_SIZES = {
    "NIFTY 50": 75,
    "NIFTY": 75,
    "BANKNIFTY": 15,
    "FINNIFTY": 40,
}

# ── Expiry Weeks ───────────────────────────────────────────────────────────────
def _get_expiry_weeks(n: int = 5) -> List[Dict[str, Any]]:
    """
    Generate next N weekly expiry dates for NIFTY.

    NSE weekly/monthly expiry is every **Tuesday** (since 2025-09-01), shifted to
    the previous trading day on holidays. Logic lives in backend.nse_calendar so
    every part of the app stays consistent.
    Returns list of {label, date, days_remaining, is_current, week, expiry_type}.
    """
    ref = now_ist()
    today = ref.date()
    expiries = []
    for i, expiry in enumerate(upcoming_weekly_expiries(n, ref)):
        expiries.append({
            "label": expiry.strftime("%d %b %Y"),
            "date": format_expiry(expiry),
            "days_remaining": (expiry - today).days,
            "is_current": i == 0,
            "week": "Current Week" if i == 0 else f"Week {i + 1}",
            "expiry_type": "MONTHLY" if is_monthly_expiry(expiry) else "WEEKLY",
        })
    return expiries


@router.get("/expiry-weeks")
async def get_expiry_weeks(symbol: str = Query(default="NIFTY 50")):
    """Get next 5 weekly expiry dates for options"""
    return _get_expiry_weeks(5)


# ── Helper: nearest ATM strike ─────────────────────────────────────────────────
def _nearest_strike(price: float, step: int = 50) -> float:
    return round(round(price / step) * step, 2)


def _round_to_tick(price: float, tick: float = 0.05) -> float:
    return round(round(price / tick) * tick, 2)


# ── Helper: compute IV rank from chain ────────────────────────────────────────
def _compute_iv_rank(chain_data: Dict) -> float:
    """Estimate IV rank from current chain IVs (simplified)"""
    ivs = []
    for opt in list(chain_data.get("calls", {}).values()) + list(chain_data.get("puts", {}).values()):
        iv = opt.get("iv", 0)
        if iv > 0:
            ivs.append(iv)
    if not ivs:
        return 50.0
    avg_iv = sum(ivs) / len(ivs)
    # Normalize: typical NIFTY IV range 10–40
    rank = min(100, max(0, (avg_iv - 10) / 30 * 100))
    return round(rank, 1)


# ── Helper: detect market trend from OI ───────────────────────────────────────
def _detect_trend(chain_data: Dict, underlying: float) -> tuple:
    """
    Returns (trend, support, resistance) based on max OI strikes.
    Max CE OI = resistance, Max PE OI = support.
    """
    calls = chain_data.get("calls", {})
    puts = chain_data.get("puts", {})

    ce_oi = {float(k): v.get("oi", 0) for k, v in calls.items()}
    pe_oi = {float(k): v.get("oi", 0) for k, v in puts.items()}

    resistance = max(ce_oi, key=ce_oi.get) if ce_oi else underlying + 200
    support = max(pe_oi, key=pe_oi.get) if pe_oi else underlying - 200

    pcr = chain_data.get("pcr", 1.0)
    max_pain = chain_data.get("max_pain", underlying)

    # Trend logic
    if pcr > 1.3 and underlying > max_pain:
        trend = "BULLISH"
    elif pcr < 0.7 and underlying < max_pain:
        trend = "BEARISH"
    elif 0.9 <= pcr <= 1.2:
        trend = "SIDEWAYS"
    elif underlying > max_pain + 100:
        trend = "BULLISH"
    elif underlying < max_pain - 100:
        trend = "BEARISH"
    else:
        trend = "SIDEWAYS"

    return trend, support, resistance


# ── Helper: build a single option trade suggestion ────────────────────────────
def _build_trade(
    symbol: str,
    option_type: str,
    strike: float,
    opt_data: Dict,
    underlying: float,
    expiry: str,
    trade_type: str,
    rationale: List[str],
    risks: List[str],
    confidence: float,
    trend: str,
    lot_size: int,
) -> OptionTrade:
    ltp = opt_data.get("ltp", 0)
    iv = opt_data.get("iv", 20)
    delta = abs(opt_data.get("delta", 0.5))
    gamma = opt_data.get("gamma", 0)
    theta = opt_data.get("theta", 0)
    vega = opt_data.get("vega", 0)
    oi = opt_data.get("oi", 0)
    oi_change = opt_data.get("change_in_oi", 0)
    volume = opt_data.get("volume", 0)

    if ltp <= 0:
        ltp = max(opt_data.get("ask", 1), 1)

    # Entry range: ±2% of LTP
    entry_low = _round_to_tick(ltp * 0.98)
    entry_high = _round_to_tick(ltp * 1.02)
    entry_price = _round_to_tick(ltp)

    # Stop-loss: 30–40% below entry (options SL is wider)
    sl_pct = 0.35 if trade_type == "INTRADAY" else 0.40
    stop_loss = _round_to_tick(entry_price * (1 - sl_pct))

    # Targets based on delta and underlying move expectation
    # T1: 40–50% gain, T2: 80–100% gain
    target_1 = _round_to_tick(entry_price * 1.45)
    target_2 = _round_to_tick(entry_price * 1.90)

    # Risk/Reward
    risk = entry_price - stop_loss
    reward_t1 = target_1 - entry_price
    rr = round(reward_t1 / risk, 2) if risk > 0 else 0

    # Breakeven at expiry
    if option_type == "CE":
        breakeven = strike + entry_price
    else:
        breakeven = strike - entry_price

    # Capital required (1 lot)
    lots = 1
    capital = round(entry_price * lot_size * lots, 2)
    max_profit = round((target_2 - entry_price) * lot_size * lots, 2)
    max_loss = round((entry_price - stop_loss) * lot_size * lots, 2)

    # Signal strength
    if confidence >= 75:
        strength = "STRONG"
    elif confidence >= 55:
        strength = "MODERATE"
    else:
        strength = "WEAK"

    return OptionTrade(
        symbol=symbol,
        option_type=option_type,
        strike=strike,
        expiry=expiry,
        ltp=ltp,
        entry_price=entry_price,
        entry_range_low=entry_low,
        entry_range_high=entry_high,
        target_1=target_1,
        target_2=target_2,
        stop_loss=stop_loss,
        risk_reward=rr,
        max_profit=max_profit,
        max_loss=max_loss,
        breakeven=round(breakeven, 2),
        lot_size=lot_size,
        lots_suggested=lots,
        capital_required=capital,
        delta=round(delta, 4),
        gamma=round(gamma, 6),
        theta=round(theta, 4),
        vega=round(vega, 4),
        iv=round(iv, 2),
        oi=oi,
        oi_change=oi_change,
        volume=volume,
        signal_strength=strength,
        trade_type=trade_type,
        rationale=rationale,
        risks=risks,
        confidence_pct=round(confidence, 1),
        trend_direction=trend,
    )


# ── Core Suggestion Engine ─────────────────────────────────────────────────────
def _generate_suggestions(chain_data: Dict, symbol: str) -> List[OptionTrade]:
    """Generate trading suggestions from live options chain data"""
    underlying = chain_data.get("underlying_price", 0)
    expiry = chain_data.get("expiry_date", _get_nearest_expiry())
    pcr = chain_data.get("pcr", 1.0)
    max_pain = chain_data.get("max_pain", underlying)
    calls = chain_data.get("calls", {})
    puts = chain_data.get("puts", {})

    lot_size = LOT_SIZES.get(symbol, 75)
    step = 100 if "BANKNIFTY" in symbol.upper() else 50
    atm = _nearest_strike(underlying, step)
    trend, support, resistance = _detect_trend(chain_data, underlying)

    suggestions: List[OptionTrade] = []

    # ── Strategy 1: ATM CE (Bullish) ──────────────────────────────────────────
    if trend in ("BULLISH", "SIDEWAYS") and pcr >= 0.9:
        atm_ce = calls.get(str(int(atm))) or calls.get(str(atm))
        if atm_ce and atm_ce.get("ltp", 0) > 0:
            conf = 70 + min(15, (pcr - 0.9) * 30)
            rationale = [
                f"PCR {pcr:.2f} indicates {'bullish' if pcr > 1 else 'neutral'} sentiment",
                f"ATM strike {atm} has high liquidity (OI: {atm_ce.get('oi', 0):,})",
                f"Underlying {underlying:.0f} trading {'above' if underlying > max_pain else 'near'} max pain {max_pain:.0f}",
                f"Max CE OI resistance at {resistance:.0f} — room to move up",
                f"IV {atm_ce.get('iv', 0):.1f}% — {'favorable' if atm_ce.get('iv', 25) < 25 else 'elevated'} for buying",
            ]
            risks = [
                "IV crush risk if market moves sideways",
                f"Theta decay accelerates near expiry (θ={atm_ce.get('theta', 0):.2f}/day)",
                f"Hard stop at {_round_to_tick(atm_ce.get('ltp', 1) * 0.65):.2f} (35% loss)",
                "Avoid holding through major news events",
            ]
            suggestions.append(_build_trade(
                symbol, "CE", atm, atm_ce, underlying, expiry,
                "INTRADAY", rationale, risks, conf, "BULLISH", lot_size
            ))

    # ── Strategy 2: OTM CE (Bullish Breakout) ─────────────────────────────────
    if trend == "BULLISH" and underlying > max_pain:
        otm_strike = atm + 2 * step
        otm_ce = calls.get(str(int(otm_strike))) or calls.get(str(otm_strike))
        if otm_ce and otm_ce.get("ltp", 0) > 0:
            conf = 60 + min(15, (underlying - max_pain) / 50)
            rationale = [
                f"Strong bullish trend — underlying {underlying:.0f} above max pain {max_pain:.0f}",
                f"OTM CE {otm_strike} offers higher leverage on breakout",
                f"Low capital requirement: ₹{otm_ce.get('ltp', 0) * lot_size:.0f}/lot",
                f"PCR {pcr:.2f} — put writers defending {support:.0f} support",
                "Volume surge in CE side indicates call buying momentum",
            ]
            risks = [
                "OTM options can expire worthless — high risk",
                "Requires strong directional move to profit",
                f"Delta {abs(otm_ce.get('delta', 0.3)):.2f} — lower probability of profit",
                "Time decay is aggressive for OTM options",
            ]
            suggestions.append(_build_trade(
                symbol, "CE", otm_strike, otm_ce, underlying, expiry,
                "INTRADAY", rationale, risks, conf, "BULLISH", lot_size
            ))

    # ── Strategy 3: ATM PE (Bearish) ──────────────────────────────────────────
    if trend in ("BEARISH", "SIDEWAYS") and pcr <= 1.1:
        atm_pe = puts.get(str(int(atm))) or puts.get(str(atm))
        if atm_pe and atm_pe.get("ltp", 0) > 0:
            conf = 65 + min(15, (1.1 - pcr) * 30)
            rationale = [
                f"PCR {pcr:.2f} indicates {'bearish' if pcr < 0.8 else 'neutral'} sentiment",
                f"Underlying {underlying:.0f} {'below' if underlying < max_pain else 'near'} max pain {max_pain:.0f}",
                f"Max PE OI support at {support:.0f} — breakdown risk if breached",
                f"ATM PE {atm} has strong OI: {atm_pe.get('oi', 0):,}",
                "Put-side volume increasing — bearish pressure building",
            ]
            risks = [
                "Market can bounce from support levels",
                f"Theta decay: {atm_pe.get('theta', 0):.2f}/day",
                "Global cues can reverse intraday trend",
                f"Stop loss at {_round_to_tick(atm_pe.get('ltp', 1) * 0.65):.2f}",
            ]
            suggestions.append(_build_trade(
                symbol, "PE", atm, atm_pe, underlying, expiry,
                "INTRADAY", rationale, risks, conf, "BEARISH", lot_size
            ))

    # ── Strategy 4: OTM PE (Bearish Breakdown) ────────────────────────────────
    if trend == "BEARISH" and underlying < max_pain:
        otm_pe_strike = atm - 2 * step
        otm_pe = puts.get(str(int(otm_pe_strike))) or puts.get(str(otm_pe_strike))
        if otm_pe and otm_pe.get("ltp", 0) > 0:
            conf = 58 + min(12, (max_pain - underlying) / 50)
            rationale = [
                f"Bearish breakdown — underlying {underlying:.0f} below max pain {max_pain:.0f}",
                f"OTM PE {otm_pe_strike} offers high leverage on further decline",
                f"Support at {support:.0f} — breakdown below triggers panic selling",
                f"PCR {pcr:.2f} — call writers dominating",
                "High OI in CE side indicates resistance overhead",
            ]
            risks = [
                "Support bounce can quickly erode OTM PE value",
                "Low delta means slow response to small moves",
                "Requires sustained selling pressure",
                "Exit quickly if support holds",
            ]
            suggestions.append(_build_trade(
                symbol, "PE", otm_pe_strike, otm_pe, underlying, expiry,
                "INTRADAY", rationale, risks, conf, "BEARISH", lot_size
            ))

    # ── Strategy 5: Swing CE (2–5 day hold) ───────────────────────────────────
    if trend == "BULLISH" and pcr > 1.1:
        swing_strike = atm + step
        swing_ce = calls.get(str(int(swing_strike))) or calls.get(str(swing_strike))
        if not swing_ce:
            swing_ce = calls.get(str(int(atm)))
        if swing_ce and swing_ce.get("ltp", 0) > 0:
            conf = 68 + min(10, (pcr - 1.1) * 20)
            rationale = [
                f"Strong PCR {pcr:.2f} — bullish momentum for swing trade",
                f"Resistance at {resistance:.0f} — target on breakout",
                "Swing trade: 2–5 day holding for trend continuation",
                f"Delta {abs(swing_ce.get('delta', 0.45)):.2f} — good directional exposure",
                "OI buildup in PE side confirms bullish bias",
            ]
            risks = [
                "Overnight gap risk — use wider SL",
                "Theta decay over multiple days",
                "Expiry week — avoid if < 3 days to expiry",
                "Hedge with PE if holding overnight",
            ]
            suggestions.append(_build_trade(
                symbol, "CE", swing_strike, swing_ce, underlying, expiry,
                "SWING", rationale, risks, conf, "BULLISH", lot_size
            ))

    # ── Strategy 6: Swing PE (2–5 day hold) ───────────────────────────────────
    if trend == "BEARISH" and pcr < 0.9:
        swing_pe_strike = atm - step
        swing_pe = puts.get(str(int(swing_pe_strike))) or puts.get(str(swing_pe_strike))
        if not swing_pe:
            swing_pe = puts.get(str(int(atm)))
        if swing_pe and swing_pe.get("ltp", 0) > 0:
            conf = 65 + min(10, (0.9 - pcr) * 20)
            rationale = [
                f"Weak PCR {pcr:.2f} — bearish momentum for swing trade",
                f"Support at {support:.0f} — target on breakdown",
                "Swing trade: 2–5 day holding for trend continuation",
                f"Delta {abs(swing_pe.get('delta', 0.45)):.2f} — good directional exposure",
                "OI buildup in CE side confirms bearish bias",
            ]
            risks = [
                "Overnight gap risk — use wider SL",
                "Theta decay over multiple days",
                "Expiry week — avoid if < 3 days to expiry",
                "Hedge with CE if holding overnight",
            ]
            suggestions.append(_build_trade(
                symbol, "PE", swing_pe_strike, swing_pe, underlying, expiry,
                "SWING", rationale, risks, conf, "BEARISH", lot_size
            ))

    # Sort by confidence descending
    suggestions.sort(key=lambda x: x.confidence_pct, reverse=True)
    return suggestions[:6]  # Return top 6 suggestions


def _get_nearest_expiry() -> str:
    """Nearest upcoming NSE expiry (Tuesday, holiday-adjusted) as e.g. '09JUN2026'."""
    return format_expiry(next_weekly_expiry())


# ── Black-Scholes helpers (no scipy needed — uses math.erf) ──────────────────
def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def _npdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)

def _bs_ltp(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return max(0.05, (S - K) if opt_type == "CE" else (K - S))
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if opt_type == "CE":
        return max(0.05, S * _ncdf(d1) - K * math.exp(-r * T) * _ncdf(d2))
    return max(0.05, K * math.exp(-r * T) * _ncdf(-d2) - S * _ncdf(-d1))

def _bs_delta_val(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
    if T <= 0 or sigma <= 0:
        return 1.0 if opt_type == "CE" else -1.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    return _ncdf(d1) if opt_type == "CE" else _ncdf(d1) - 1

def _bs_gamma_val(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 0 or sigma <= 0 or S <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    return _npdf(d1) / (S * sigma * math.sqrt(T))

def _bs_theta_val(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
    if T <= 0 or sigma <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    common = -(S * sigma * _npdf(d1)) / (2 * math.sqrt(T))
    if opt_type == "CE":
        return (common - r * K * math.exp(-r * T) * _ncdf(d2)) / 365
    return (common + r * K * math.exp(-r * T) * _ncdf(-d2)) / 365

def _bs_vega_val(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 0 or sigma <= 0 or S <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    return S * math.sqrt(T) * _npdf(d1) / 100  # per 1% change in IV


# ── Mock chain for when live data is unavailable ──────────────────────────────
def _generate_mock_chain(symbol: str, base_price: float = 24500.0, expiry_date: Optional[str] = None) -> Dict:
    """Generate a realistic mock options chain using Black-Scholes pricing.

    Uses proper BS formulae so ATM premiums are realistic (not the old ad-hoc
    formula which gave ₹25 for an ATM NIFTY call that should be ~₹200).
    """
    import random

    resolved_expiry = expiry_date or _get_nearest_expiry()

    try:
        exp_dt = datetime.strptime(resolved_expiry, "%d%b%Y")
        dte = max(1, (exp_dt - datetime.now()).days)
    except Exception:
        dte = 7

    # Strike step: BANKNIFTY uses 100-point intervals, everything else 50.
    step = 100 if "BANKNIFTY" in symbol.upper() else 50

    # Stable seed: rounds price to nearest ATM so small intraday moves
    # don't produce completely different mock data on every refresh.
    atm_seed = round(base_price / step) * step
    random.seed(int(atm_seed) + dte * 31)

    atm = _nearest_strike(base_price, step)
    strikes = [atm + (i * step) for i in range(-10, 11)]

    T = max(0.001, dte / 365.0)
    r = 0.065

    # Base ATM IV — typical NIFTY range 13-18%
    base_iv_pct = 14.0 + random.uniform(-1.0, 3.0)

    calls: Dict = {}
    puts: Dict = {}

    for strike in strikes:
        dist = abs(strike - base_price)
        moneyness = (strike - base_price) / max(base_price, 1)

        # IV smile: further OTM → higher IV; slight extra put skew
        smile = abs(moneyness) * 25
        put_skew = max(0.0, -moneyness) * 5
        ce_iv_pct = base_iv_pct + smile + random.uniform(-0.5, 0.5)
        pe_iv_pct = base_iv_pct + smile + put_skew + random.uniform(-0.5, 0.5)

        ce_s = ce_iv_pct / 100
        pe_s = pe_iv_pct / 100

        ce_ltp   = round(_bs_ltp(base_price, strike, T, r, ce_s, "CE"), 2)
        pe_ltp   = round(_bs_ltp(base_price, strike, T, r, pe_s, "PE"), 2)
        ce_delta = round(_bs_delta_val(base_price, strike, T, r, ce_s, "CE"), 4)
        pe_delta = round(_bs_delta_val(base_price, strike, T, r, pe_s, "PE"), 4)
        avg_s    = (ce_s + pe_s) / 2
        gamma    = round(_bs_gamma_val(base_price, strike, T, r, avg_s), 6)
        ce_theta = round(_bs_theta_val(base_price, strike, T, r, ce_s, "CE"), 4)
        pe_theta = round(_bs_theta_val(base_price, strike, T, r, pe_s, "PE"), 4)
        ce_vega  = round(_bs_vega_val(base_price, strike, T, r, ce_s), 4)
        pe_vega  = round(_bs_vega_val(base_price, strike, T, r, pe_s), 4)

        ce_oi = int(random.uniform(50_000, 500_000) * math.exp(-dist / (step * 5)))
        pe_oi = int(random.uniform(50_000, 500_000) * math.exp(-dist / (step * 5)))

        calls[str(int(strike))] = {
            "ltp": ce_ltp,
            "oi": ce_oi,
            "change_in_oi": int(random.uniform(-50_000, 100_000)),
            "volume": int(ce_oi * random.uniform(0.1, 0.5)),
            "iv": round(ce_iv_pct, 2),
            "delta": ce_delta,
            "gamma": gamma,
            "theta": ce_theta,
            "vega": ce_vega,
            "bid": round(ce_ltp * 0.99, 2),
            "ask": round(ce_ltp * 1.01, 2),
        }
        puts[str(int(strike))] = {
            "ltp": pe_ltp,
            "oi": pe_oi,
            "change_in_oi": int(random.uniform(-50_000, 100_000)),
            "volume": int(pe_oi * random.uniform(0.1, 0.5)),
            "iv": round(pe_iv_pct, 2),
            "delta": pe_delta,
            "gamma": gamma,
            "theta": pe_theta,
            "vega": pe_vega,
            "bid": round(pe_ltp * 0.99, 2),
            "ask": round(pe_ltp * 1.01, 2),
        }

    total_ce_oi = sum(c["oi"] for c in calls.values())
    total_pe_oi = sum(p["oi"] for p in puts.values())
    pcr = round(total_pe_oi / total_ce_oi, 2) if total_ce_oi > 0 else 1.0
    max_pain = atm + random.choice([-step, 0, step])

    return {
        "symbol": symbol,
        "underlying_price": base_price,
        "expiry_date": resolved_expiry,
        "pcr": pcr,
        "max_pain": max_pain,
        "total_ce_oi": total_ce_oi,
        "total_pe_oi": total_pe_oi,
        "calls": calls,
        "puts": puts,
        "timestamp": datetime.now().isoformat(),
        "is_mock": True,
    }


# ── API Endpoints ──────────────────────────────────────────────────────────────

@router.get("/{symbol}", response_model=OptionSuggestionsResponse)
async def get_option_suggestions(
    symbol: str,
    expiry_date: Optional[str] = Query(default=None, description="Format: 27JUN2024"),
    trade_type: Optional[str] = Query(default=None, description="INTRADAY / SWING / POSITIONAL"),
    redis=Depends(get_redis),
):
    """
    Get AI-driven options trading suggestions for a symbol.
    Includes entry, exit, SL, targets, Greeks, and rationale.
    """
    sym = symbol.upper().replace("-", " ")
    cache_key = f"opt_suggestions:{sym}:{expiry_date or 'current'}:{trade_type or 'all'}"

    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Try to get live chain data
    chain_data = None
    try:
        from backend.data_fetcher import get_options_chain
        chain_data = get_options_chain(sym, expiry_date)
    except (NotImplementedError, AttributeError):
        # NotImplementedError — NFO token master not loaded (expected, use mock)
        # AttributeError      — SmartConnect version missing getOptionGreeks (safe fallback)
        logger.info(f"NFO token master not available for {sym} — using mock chain with live spot price")
    except Exception as e:
        logger.warning(f"Live chain unavailable for {sym}: {e}")

    # Fallback to mock data
    if not chain_data or not chain_data.get("calls"):
        logger.info(f"Using mock chain for {sym}")
        # Try to get current price from Redis (key stored with original spacing, e.g. "NIFTY 50")
        base_price = 24500.0
        try:
            quote_raw = await redis.get(f"quote:NSE:{sym}")
            if not quote_raw:
                quote_raw = await redis.get(f"quote:NSE:{sym.replace(' ', '')}")
            if quote_raw:
                q = json.loads(quote_raw)
                base_price = float(q.get("ltp", 24500))
        except Exception:
            pass
        chain_data = _generate_mock_chain(sym, base_price, expiry_date=expiry_date)

    underlying = chain_data.get("underlying_price", 24500)
    pcr = chain_data.get("pcr", 1.0)
    max_pain = chain_data.get("max_pain", underlying)
    expiry = chain_data.get("expiry_date", _get_nearest_expiry())

    trend, support, resistance = _detect_trend(chain_data, underlying)
    iv_rank = _compute_iv_rank(chain_data)

    # Estimate VIX from ATM IV
    _step = 100 if "BANKNIFTY" in sym.upper() else 50
    atm = _nearest_strike(underlying, _step)
    atm_ce = chain_data["calls"].get(str(int(atm)), {})
    atm_pe = chain_data["puts"].get(str(int(atm)), {})
    vix_est = round((atm_ce.get("iv", 15) + atm_pe.get("iv", 15)) / 2, 1)

    market_context = MarketContext(
        underlying_price=underlying,
        atm_strike=atm,
        pcr=pcr,
        max_pain=max_pain,
        total_ce_oi=chain_data.get("total_ce_oi", 0),
        total_pe_oi=chain_data.get("total_pe_oi", 0),
        iv_rank=iv_rank,
        market_trend=trend,
        support_level=support,
        resistance_level=resistance,
        vix_estimate=vix_est,
        timestamp=chain_data.get("timestamp", datetime.now().isoformat()),
    )

    suggestions = _generate_suggestions(chain_data, sym)

    # Filter by trade_type if specified
    if trade_type:
        filtered = [s for s in suggestions if s.trade_type == trade_type.upper()]
        if filtered:
            suggestions = filtered

    # Build compact chain snapshot (ATM ±5 strikes)
    strikes_sorted = sorted([float(k) for k in chain_data["calls"].keys()])
    atm_idx = min(range(len(strikes_sorted)), key=lambda i: abs(strikes_sorted[i] - underlying))
    snapshot_strikes = strikes_sorted[max(0, atm_idx - 5): atm_idx + 6]

    chain_snapshot = {
        "strikes": [],
        "underlying": underlying,
        "atm": atm,
    }
    for s in snapshot_strikes:
        sk = str(int(s))
        chain_snapshot["strikes"].append({
            "strike": s,
            "is_atm": s == atm,
            "ce": chain_data["calls"].get(sk),
            "pe": chain_data["puts"].get(sk),
        })

    result = OptionSuggestionsResponse(
        symbol=sym,
        expiry=expiry,
        market_context=market_context,
        suggestions=suggestions,
        option_chain_snapshot=chain_snapshot,
        generated_at=datetime.now().isoformat(),
    )

    result_dict = result.dict()
    await redis.setex(cache_key, 30, json.dumps(result_dict))  # Cache 30s
    return result_dict


@router.get("/{symbol}/live-chain")
async def get_live_chain_snapshot(
    symbol: str,
    expiry_date: Optional[str] = None,
    redis=Depends(get_redis),
):
    """Get live options chain with all strikes — refreshes every 15s"""
    sym = symbol.upper().replace("-", " ")
    expiry_key = expiry_date or "current"
    cache_key = f"live_chain:{sym}:{expiry_key}"

    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    chain_data = None
    try:
        from backend.data_fetcher import get_options_chain
        chain_data = get_options_chain(sym, expiry_date)
    except (NotImplementedError, AttributeError):
        # NotImplementedError — NFO token master not loaded (expected, use mock)
        # AttributeError      — SmartConnect version missing getOptionGreeks (safe fallback)
        logger.info(f"NFO token master not available for {sym} — using mock chain")
    except Exception as e:
        logger.warning(f"Live chain unavailable for {sym}: {e}")

    if not chain_data or not chain_data.get("calls"):
        base_price = 24500.0
        try:
            quote_raw = await redis.get(f"quote:NSE:{sym}")
            if not quote_raw:
                quote_raw = await redis.get(f"quote:NSE:{sym.replace(' ', '')}")
            if quote_raw:
                q = json.loads(quote_raw)
                base_price = float(q.get("ltp", 24500))
        except Exception:
            pass
        chain_data = _generate_mock_chain(sym, base_price, expiry_date=expiry_date)

    await redis.setex(cache_key, 15, json.dumps(chain_data))
    return chain_data