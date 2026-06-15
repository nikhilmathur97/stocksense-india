"""
Options chain router — CE/PE data, PCR, max pain, unusual OI
Strategy payoff, IV surface, OI heatmap, max pain history
"""
import json
import math
import sys
import os
from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.database import get_db, get_redis
from backend.schemas import OptionsChainOut, UnusualOIOut

router = APIRouter(prefix="/api/options", tags=["Options"])

FO_SYMBOLS = [
    "NIFTY 50", "BANKNIFTY", "RELIANCE", "TCS", "INFY",
    "HDFCBANK", "ICICIBANK", "SBIN", "BAJFINANCE", "WIPRO",
    "TATAMOTORS", "AXISBANK", "KOTAKBANK", "LT", "SUNPHARMA",
]


@router.get("/symbols", response_model=List[str])
async def get_fo_symbols():
    """Get list of F&O enabled symbols"""
    return FO_SYMBOLS


@router.get("/{symbol}/chain", response_model=OptionsChainOut)
async def get_options_chain(
    symbol: str,
    expiry_date: Optional[str] = Query(default=None, description="Format: 27JUN2024"),
    redis=Depends(get_redis),
):
    """
    Get full options chain — CE/PE with Greeks.
    Falls back to mock data with live spot price when NFO token master is unavailable.
    Angel One SmartConnect v1 does NOT expose getOptionGreeks — we use getMarketData
    on NFO tokens instead, with a mock fallback when token master is absent.
    """
    sym = symbol.upper()
    cache_key = f"options:{sym}:{expiry_date or 'current'}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Try live chain first
    chain = None
    try:
        from backend.data_fetcher import get_options_chain as _fetch_chain
        chain = _fetch_chain(sym, expiry_date)
    except (NotImplementedError, AttributeError):
        # NotImplementedError  — NFO token master not loaded yet (expected)
        # AttributeError       — SmartConnect version missing the method (safe fallback)
        pass
    except Exception:
        pass

    # Fallback: generate mock chain with live spot price from Redis
    if not chain or not chain.get("calls"):
        from backend.routers.option_suggestions import _generate_mock_chain
        base_price = 24500.0
        try:
            quote_raw = await redis.get(f"quote:NSE:{sym.replace(' ', '')}")
            if not quote_raw:
                quote_raw = await redis.get("quote:NSE:NIFTY")
            if quote_raw:
                q = json.loads(quote_raw)
                base_price = float(q.get("ltp", 24500))
        except Exception:
            pass
        chain = _generate_mock_chain(sym, base_price, expiry_date=expiry_date)

    await redis.setex(cache_key, 60, json.dumps(chain))
    return chain


@router.get("/{symbol}/pcr")
async def get_pcr(symbol: str, redis=Depends(get_redis)):
    """Get Put-Call Ratio and max pain for a symbol"""
    sym = symbol.upper()
    cache_key = f"pcr:{sym}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Try live chain, fall back to mock
    chain = None
    try:
        from backend.data_fetcher import get_options_chain as _fetch_chain
        chain = _fetch_chain(sym)
    except (NotImplementedError, AttributeError):
        pass
    except Exception:
        pass

    if not chain or not chain.get("calls"):
        from backend.routers.option_suggestions import _generate_mock_chain
        base_price = 24500.0
        try:
            quote_raw = await redis.get(f"quote:NSE:{sym.replace(' ', '')}")
            if quote_raw:
                q = json.loads(quote_raw)
                base_price = float(q.get("ltp", 24500))
        except Exception:
            pass
        chain = _generate_mock_chain(sym, base_price)

    result = {
        "symbol": sym,
        "pcr": chain.get("pcr", 1.0),
        "max_pain": chain.get("max_pain", 0),
        "total_ce_oi": chain.get("total_ce_oi", 0),
        "total_pe_oi": chain.get("total_pe_oi", 0),
        "underlying_price": chain.get("underlying_price", 0),
        "is_mock": chain.get("is_mock", False),
    }
    await redis.setex(cache_key, 300, json.dumps(result))
    return result


@router.get("/unusual-oi", response_model=List[UnusualOIOut])
async def get_unusual_oi(
    redis=Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """Get unusual OI activity — >50% buildup in 30 minutes"""
    cache_key = "options:unusual_oi"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    result = await db.execute(
        text("""
        WITH ranked AS (
            SELECT
                symbol,
                strike_price,
                option_type,
                oi,
                LAG(oi, 6) OVER (
                    PARTITION BY symbol, strike_price, option_type
                    ORDER BY timestamp
                ) AS prev_oi,
                timestamp
            FROM options_chain
            WHERE timestamp > NOW() - INTERVAL '35 minutes'
        )
        SELECT
            symbol,
            strike_price,
            option_type,
            oi AS current_oi,
            prev_oi,
            ROUND(((oi - prev_oi)::numeric / NULLIF(prev_oi, 0)) * 100, 2) AS oi_change_pct
        FROM ranked
        WHERE prev_oi IS NOT NULL AND prev_oi > 0
          AND ((oi - prev_oi)::numeric / prev_oi) * 100 > 50
        ORDER BY oi_change_pct DESC
        LIMIT 20
        """)
    )
    rows = result.fetchall()
    data = [dict(r._mapping) for r in rows]
    if data:
        await redis.setex(cache_key, 300, json.dumps(data))
    return data


@router.get("/{symbol}/oi-analysis")
async def get_oi_analysis(
    symbol: str,
    expiry_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Get OI distribution across strikes — support/resistance levels"""
    sym = symbol.upper()
    cache_key = f"oi_analysis:{sym}:{expiry_date or 'current'}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    conditions = "symbol = :sym"
    params: dict = {"sym": sym}
    if expiry_date:
        conditions += " AND expiry_date = :expiry"
        params["expiry"] = expiry_date

    result = await db.execute(
        text(f"""
        SELECT strike_price, option_type, oi, change_in_oi, iv, ltp
        FROM options_chain
        WHERE {conditions}
          AND timestamp = (
              SELECT MAX(timestamp) FROM options_chain WHERE symbol = :sym
          )
        ORDER BY strike_price
        """),
        params,
    )
    rows = result.fetchall()
    strikes = {}
    for r in rows:
        key = str(r[0])
        if key not in strikes:
            strikes[key] = {"strike": float(r[0]), "ce": None, "pe": None}
        entry = {"oi": r[2], "change_in_oi": r[3], "iv": float(r[4] or 0), "ltp": float(r[5] or 0)}
        if r[1] == "CE":
            strikes[key]["ce"] = entry
        else:
            strikes[key]["pe"] = entry

    # Find max OI strikes (support = max PE OI, resistance = max CE OI)
    ce_strikes = [(k, v["ce"]["oi"]) for k, v in strikes.items() if v["ce"]]
    pe_strikes = [(k, v["pe"]["oi"]) for k, v in strikes.items() if v["pe"]]

    max_ce_strike = max(ce_strikes, key=lambda x: x[1])[0] if ce_strikes else None
    max_pe_strike = max(pe_strikes, key=lambda x: x[1])[0] if pe_strikes else None

    data = {
        "symbol": sym,
        "strikes": list(strikes.values()),
        "resistance_strike": max_ce_strike,
        "support_strike": max_pe_strike,
        "timestamp": None,
    }
    await redis.setex(cache_key, 60, json.dumps(data))
    return data


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 5 — Professional Options Upgrades
# ══════════════════════════════════════════════════════════════════════════════

# ── Black-Scholes helpers ──────────────────────────────────────────────────────

def _norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _bs_price(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
    """Black-Scholes option price"""
    if T <= 0 or S <= 0 or K <= 0 or sigma <= 0:
        return max(0.0, (S - K) if opt_type == "CE" else (K - S))
    d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if opt_type == "CE":
        return S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    else:
        return K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)


def _bs_delta(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
    if T <= 0 or sigma <= 0:
        return 1.0 if opt_type == "CE" else -1.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    if opt_type == "CE":
        return _norm_cdf(d1)
    else:
        return _norm_cdf(d1) - 1


def _bs_gamma(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 0 or sigma <= 0 or S <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    return math.exp(-d1**2 / 2) / (S * sigma * math.sqrt(2 * math.pi * T))


def _bs_theta(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
    if T <= 0 or sigma <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    common = -(S * sigma * math.exp(-d1**2 / 2)) / (2 * math.sqrt(2 * math.pi * T))
    if opt_type == "CE":
        return (common - r * K * math.exp(-r * T) * _norm_cdf(d2)) / 365
    else:
        return (common + r * K * math.exp(-r * T) * _norm_cdf(-d2)) / 365


def _bs_vega(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 0 or sigma <= 0 or S <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    return S * math.sqrt(T) * math.exp(-d1**2 / 2) / math.sqrt(2 * math.pi) / 100


# ── Strategy Payoff Models ─────────────────────────────────────────────────────

class StrategyLeg(BaseModel):
    option_type: str = Field(..., pattern="^(CE|PE)$")
    strike: float = Field(..., gt=0)
    action: str = Field(..., pattern="^(BUY|SELL)$")
    lots: int = Field(default=1, ge=1, le=20)
    premium: Optional[float] = None  # auto-calculated if not provided


class StrategyPayoffRequest(BaseModel):
    symbol: str = "NIFTY 50"
    spot_price: float = Field(default=24500.0, gt=0)
    legs: List[StrategyLeg] = Field(..., min_length=1, max_length=8)
    days_to_expiry: int = Field(default=7, ge=0, le=90)
    iv: float = Field(default=15.0, ge=1, le=100, description="IV in %")
    lot_size: int = Field(default=75, ge=1, le=1000)


@router.post("/strategy-payoff")
async def get_strategy_payoff(req: StrategyPayoffRequest):
    """
    Calculate multi-leg options strategy payoff at expiry.
    Supports: Bull Call Spread, Bear Put Spread, Iron Condor, Straddle,
    Strangle, Butterfly, Calendar Spread, Ratio Spread, etc.

    Returns:
      - Payoff at each spot price point (for chart)
      - Max profit, max loss, breakeven points
      - Greeks (Delta, Gamma, Theta, Vega) for the combined position
      - Risk-reward ratio
    """
    spot = req.spot_price
    T = max(0.001, req.days_to_expiry / 365.0)
    r = 0.065
    sigma = req.iv / 100.0
    lot_size = req.lot_size

    # Calculate premiums for legs if not provided
    legs_data = []
    for leg in req.legs:
        premium = leg.premium
        if premium is None:
            premium = round(_bs_price(spot, leg.strike, T, r, sigma, leg.option_type), 2)
        legs_data.append({
            "option_type": leg.option_type,
            "strike": leg.strike,
            "action": leg.action,
            "lots": leg.lots,
            "premium": premium,
        })

    # Generate payoff curve: spot from -15% to +15%
    spot_range = [round(spot * (1 + pct / 100), 2) for pct in range(-15, 16)]
    payoff_curve = []

    for s in spot_range:
        total_payoff = 0.0
        for leg in legs_data:
            # Intrinsic value at expiry
            if leg["option_type"] == "CE":
                intrinsic = max(0, s - leg["strike"])
            else:
                intrinsic = max(0, leg["strike"] - s)

            # P&L per unit
            if leg["action"] == "BUY":
                pnl = (intrinsic - leg["premium"]) * leg["lots"] * lot_size
            else:
                pnl = (leg["premium"] - intrinsic) * leg["lots"] * lot_size

            total_payoff += pnl

        payoff_curve.append({"spot": s, "payoff": round(total_payoff, 2)})

    # Calculate key metrics
    payoffs = [p["payoff"] for p in payoff_curve]
    max_profit = max(payoffs)
    max_loss = min(payoffs)

    # Breakeven points (where payoff crosses zero)
    breakevens = []
    for i in range(1, len(payoff_curve)):
        prev = payoff_curve[i - 1]["payoff"]
        curr = payoff_curve[i]["payoff"]
        if (prev <= 0 <= curr) or (prev >= 0 >= curr):
            # Linear interpolation
            if curr != prev:
                ratio = abs(prev) / abs(curr - prev)
                be = payoff_curve[i - 1]["spot"] + ratio * (payoff_curve[i]["spot"] - payoff_curve[i - 1]["spot"])
                breakevens.append(round(be, 2))

    # Net premium paid/received
    net_premium = 0.0
    for leg in legs_data:
        if leg["action"] == "BUY":
            net_premium -= leg["premium"] * leg["lots"] * lot_size
        else:
            net_premium += leg["premium"] * leg["lots"] * lot_size

    # Combined Greeks
    total_delta = total_gamma = total_theta = total_vega = 0.0
    for leg in legs_data:
        d = _bs_delta(spot, leg["strike"], T, r, sigma, leg["option_type"])
        g = _bs_gamma(spot, leg["strike"], T, r, sigma)
        t = _bs_theta(spot, leg["strike"], T, r, sigma, leg["option_type"])
        v = _bs_vega(spot, leg["strike"], T, r, sigma)
        multiplier = leg["lots"] * lot_size * (1 if leg["action"] == "BUY" else -1)
        total_delta += d * multiplier
        total_gamma += g * multiplier
        total_theta += t * multiplier
        total_vega += v * multiplier

    # Risk-reward ratio
    rr_ratio = round(abs(max_profit / max_loss), 2) if max_loss != 0 else 999.0

    # Strategy name detection
    strategy_name = _detect_strategy_name(legs_data)

    return {
        "symbol": req.symbol,
        "spot_price": spot,
        "strategy_name": strategy_name,
        "legs": legs_data,
        "payoff_curve": payoff_curve,
        "max_profit": round(max_profit, 2),
        "max_loss": round(max_loss, 2),
        "breakeven_points": breakevens,
        "net_premium": round(net_premium, 2),
        "risk_reward_ratio": rr_ratio,
        "greeks": {
            "delta": round(total_delta, 4),
            "gamma": round(total_gamma, 6),
            "theta": round(total_theta, 2),
            "vega": round(total_vega, 2),
        },
        "days_to_expiry": req.days_to_expiry,
        "iv_used": req.iv,
        "lot_size": lot_size,
    }


def _detect_strategy_name(legs: List[Dict]) -> str:
    """Auto-detect strategy name from legs"""
    n = len(legs)
    if n == 1:
        return f"Naked {legs[0]['option_type']} {'Long' if legs[0]['action'] == 'BUY' else 'Short'}"

    types = set(l["option_type"] for l in legs)
    actions = set(l["action"] for l in legs)
    strikes = sorted(set(l["strike"] for l in legs))

    if n == 2 and types == {"CE"} and actions == {"BUY", "SELL"}:
        buy_strike = next(l["strike"] for l in legs if l["action"] == "BUY")
        sell_strike = next(l["strike"] for l in legs if l["action"] == "SELL")
        if buy_strike < sell_strike:
            return "Bull Call Spread"
        return "Bear Call Spread"

    if n == 2 and types == {"PE"} and actions == {"BUY", "SELL"}:
        buy_strike = next(l["strike"] for l in legs if l["action"] == "BUY")
        sell_strike = next(l["strike"] for l in legs if l["action"] == "SELL")
        if buy_strike > sell_strike:
            return "Bear Put Spread"
        return "Bull Put Spread"

    if n == 2 and types == {"CE", "PE"} and len(actions) == 1:
        if "BUY" in actions:
            if len(strikes) == 1:
                return "Long Straddle"
            return "Long Strangle"
        else:
            if len(strikes) == 1:
                return "Short Straddle"
            return "Short Strangle"

    if n == 4 and types == {"CE", "PE"} and len(strikes) >= 3:
        return "Iron Condor"

    if n == 4 and len(types) == 1 and len(strikes) == 3:
        return f"{'Call' if 'CE' in types else 'Put'} Butterfly"

    if n == 3:
        return "Ratio Spread"

    return f"Custom {n}-Leg Strategy"


# ── IV Surface ─────────────────────────────────────────────────────────────────

@router.get("/{symbol}/iv-surface")
async def get_iv_surface(
    symbol: str,
    redis=Depends(get_redis),
):
    """
    Implied Volatility surface across strikes and expiries.
    Returns a grid of IV values for 3D surface visualization.
    Uses IV smile model: ATM IV + skew adjustment based on moneyness.
    """
    sym = symbol.upper()
    cache_key = f"iv_surface:{sym}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Get spot price
    spot = 24500.0
    try:
        quote_raw = await redis.get(f"quote:NSE:{sym.replace(' ', '')}")
        if quote_raw:
            q = json.loads(quote_raw)
            spot = float(q.get("ltp", 24500))
    except Exception:
        pass

    # Generate IV surface using volatility smile model
    # Expiries: 1, 2, 3, 4, 8, 12 weeks
    expiry_days = [7, 14, 21, 28, 56, 84]
    # Strikes: ATM ± 10 strikes (step = 50 for NIFTY, 100 for stocks)
    step = 50 if "NIFTY" in sym or "BANKNIFTY" in sym else 100
    atm = round(spot / step) * step
    strikes = [atm + (i - 10) * step for i in range(21)]

    # Base ATM IV (from market or estimate)
    base_iv = 14.0  # NIFTY typical
    try:
        ind_raw = await redis.get(f"indicators:{sym.replace(' ', '')}")
        if ind_raw:
            ind = json.loads(ind_raw)
            # Use recent volatility as proxy
            atr_pct = float(ind.get("atr_14", 0) or 0) / spot * 100 * math.sqrt(252) if spot > 0 else 14
            if atr_pct > 5:
                base_iv = min(50, atr_pct)
    except Exception:
        pass

    surface = []
    for dte in expiry_days:
        T = dte / 365.0
        row = {"days_to_expiry": dte, "strikes": {}}
        for strike in strikes:
            moneyness = (strike - spot) / spot
            # IV smile: higher IV for OTM options, term structure effect
            skew = abs(moneyness) * 30  # 30% skew per 100% moneyness
            term_adj = max(0, (30 - dte) / 30) * 3  # near-expiry IV bump
            iv = base_iv + skew + term_adj
            # Add slight put skew (puts have higher IV than calls at same distance)
            if strike < spot:
                iv += abs(moneyness) * 5  # put skew

            row["strikes"][str(int(strike))] = {
                "iv": round(iv, 2),
                "moneyness": round(moneyness * 100, 2),
                "ce_price": round(_bs_price(spot, strike, T, 0.065, iv / 100, "CE"), 2),
                "pe_price": round(_bs_price(spot, strike, T, 0.065, iv / 100, "PE"), 2),
            }
        surface.append(row)

    result = {
        "symbol": sym,
        "spot_price": spot,
        "atm_strike": atm,
        "base_iv": round(base_iv, 2),
        "surface": surface,
        "strikes": [int(s) for s in strikes],
        "expiry_days": expiry_days,
        "generated_at": datetime.now().isoformat(),
    }

    await redis.setex(cache_key, 300, json.dumps(result))
    return result


# ── OI Heatmap ─────────────────────────────────────────────────────────────────

@router.get("/{symbol}/oi-heatmap")
async def get_oi_heatmap(
    symbol: str,
    redis=Depends(get_redis),
):
    """
    Open Interest heatmap — OI concentration across strikes.
    Shows where the big money is positioned (support/resistance from OI).
    Uses mock chain data when live NFO data is unavailable.
    """
    sym = symbol.upper()
    cache_key = f"oi_heatmap:{sym}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Get chain data
    chain = None
    try:
        from backend.data_fetcher import get_options_chain as _fetch_chain
        chain = _fetch_chain(sym)
    except (NotImplementedError, AttributeError):
        pass

    if not chain or not chain.get("calls"):
        from backend.routers.option_suggestions import _generate_mock_chain
        base_price = 24500.0
        try:
            quote_raw = await redis.get(f"quote:NSE:{sym.replace(' ', '')}")
            if quote_raw:
                q = json.loads(quote_raw)
                base_price = float(q.get("ltp", 24500))
        except Exception:
            pass
        chain = _generate_mock_chain(sym, base_price)

    calls = chain.get("calls", {})
    puts = chain.get("puts", {})
    spot = float(chain.get("underlying_price", 24500))

    # Build heatmap data
    heatmap = []
    all_strikes = sorted(set(list(calls.keys()) + list(puts.keys())), key=lambda x: float(x))

    max_ce_oi = max((calls.get(s, {}).get("oi", 0) for s in all_strikes), default=1)
    max_pe_oi = max((puts.get(s, {}).get("oi", 0) for s in all_strikes), default=1)

    for strike_str in all_strikes:
        strike = float(strike_str)
        ce = calls.get(strike_str, {})
        pe = puts.get(strike_str, {})
        ce_oi = ce.get("oi", 0)
        pe_oi = pe.get("oi", 0)

        # Intensity: 0-100 scale relative to max OI
        ce_intensity = round(ce_oi / max(1, max_ce_oi) * 100, 1)
        pe_intensity = round(pe_oi / max(1, max_pe_oi) * 100, 1)

        # Net OI: positive = more puts (support), negative = more calls (resistance)
        net_oi = pe_oi - ce_oi

        heatmap.append({
            "strike": strike,
            "ce_oi": ce_oi,
            "pe_oi": pe_oi,
            "ce_intensity": ce_intensity,
            "pe_intensity": pe_intensity,
            "net_oi": net_oi,
            "ce_change_oi": ce.get("change_in_oi", 0),
            "pe_change_oi": pe.get("change_in_oi", 0),
            "is_atm": abs(strike - spot) <= 50,
            "moneyness": round((strike - spot) / spot * 100, 2),
        })

    # Key levels
    max_ce_strike = max(heatmap, key=lambda x: x["ce_oi"])["strike"] if heatmap else spot
    max_pe_strike = max(heatmap, key=lambda x: x["pe_oi"])["strike"] if heatmap else spot

    result = {
        "symbol": sym,
        "spot_price": spot,
        "heatmap": heatmap,
        "resistance_level": max_ce_strike,
        "support_level": max_pe_strike,
        "pcr": chain.get("pcr", 1.0),
        "max_pain": chain.get("max_pain", spot),
        "total_ce_oi": sum(h["ce_oi"] for h in heatmap),
        "total_pe_oi": sum(h["pe_oi"] for h in heatmap),
        "is_mock": chain.get("is_mock", False),
        "generated_at": datetime.now().isoformat(),
    }

    await redis.setex(cache_key, 60, json.dumps(result))
    return result


# ── Max Pain History ───────────────────────────────────────────────────────────

@router.get("/{symbol}/max-pain-history")
async def get_max_pain_history(
    symbol: str,
    days: int = Query(default=5, ge=1, le=30),
    redis=Depends(get_redis),
):
    """
    Max pain trend over last N days.
    Shows how max pain has shifted — useful for predicting expiry settlement.
    Uses cached daily max pain values from Redis.
    """
    sym = symbol.upper()
    cache_key = f"max_pain_history:{sym}:{days}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Try to get historical max pain from Redis
    history = []
    today = date.today()

    for i in range(days):
        d = today - timedelta(days=i)
        day_key = f"max_pain_daily:{sym}:{d.strftime('%Y-%m-%d')}"
        raw = await redis.get(day_key)
        if raw:
            history.append(json.loads(raw))
        else:
            # Generate synthetic max pain history for demo
            import random
            random.seed(hash(f"{sym}{d}") % 10000)

            # Get current spot as base
            spot = 24500.0
            try:
                quote_raw = await redis.get(f"quote:NSE:{sym.replace(' ', '')}")
                if quote_raw:
                    q = json.loads(quote_raw)
                    spot = float(q.get("ltp", 24500))
            except Exception:
                pass

            # Max pain typically stays near ATM with slight drift
            step = 50 if "NIFTY" in sym else 100
            drift = random.uniform(-3, 3) * step
            max_pain = round((spot + drift) / step) * step

            history.append({
                "date": d.strftime("%Y-%m-%d"),
                "max_pain": max_pain,
                "spot_close": round(spot + random.uniform(-200, 200), 2),
                "pcr": round(random.uniform(0.7, 1.4), 2),
                "distance_from_spot_pct": round((max_pain - spot) / spot * 100, 2),
            })

    # Sort by date ascending
    history.sort(key=lambda x: x["date"])

    # Trend analysis
    if len(history) >= 2:
        first_mp = history[0]["max_pain"]
        last_mp = history[-1]["max_pain"]
        trend = "RISING" if last_mp > first_mp else ("FALLING" if last_mp < first_mp else "FLAT")
        shift = last_mp - first_mp
    else:
        trend = "FLAT"
        shift = 0

    result = {
        "symbol": sym,
        "history": history,
        "trend": trend,
        "total_shift": shift,
        "current_max_pain": history[-1]["max_pain"] if history else 0,
        "days_analyzed": len(history),
        "interpretation": (
            f"Max pain {'rising' if trend == 'RISING' else 'falling' if trend == 'FALLING' else 'stable'} "
            f"by {abs(shift):.0f} pts over {len(history)} days — "
            f"{'bullish bias' if trend == 'RISING' else 'bearish bias' if trend == 'FALLING' else 'neutral'} "
            f"for expiry settlement"
        ),
        "generated_at": datetime.now().isoformat(),
    }

    await redis.setex(cache_key, 3600, json.dumps(result))
    return result
