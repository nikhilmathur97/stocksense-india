"""
Backtest Router — Professional Grade
=====================================
Endpoints:
  POST /api/backtest/run              — Options strategy backtest
  GET  /api/backtest/quick/{symbol}   — Quick options backtest
  POST /api/backtest/equity           — Equity stock backtest (EMA crossover / Supertrend)
  POST /api/backtest/monte-carlo      — Monte Carlo simulation on existing backtest
  GET  /api/backtest/walk-forward/{symbol} — Walk-forward optimization
"""
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.database import get_redis

logger = logging.getLogger("backtest_router")

router = APIRouter(prefix="/api/backtest", tags=["Backtest"])


# ── Request Models ─────────────────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    symbol: str = "NIFTY 50"
    start_date: str = Field(default="", description="YYYY-MM-DD")
    end_date: str = Field(default="", description="YYYY-MM-DD")
    initial_capital: float = Field(default=500000.0, ge=10000, le=10000000)
    lots_per_trade: int = Field(default=1, ge=1, le=10)
    trade_type: str = Field(default="INTRADAY", pattern="^(INTRADAY|SWING)$")
    min_confidence: float = Field(default=70.0, ge=50.0, le=95.0)
    t1_exit_pct: float = Field(default=0.5, ge=0.0, le=1.0)
    brokerage_per_lot: float = Field(default=40.0, ge=0.0, le=500.0)


class EquityBacktestRequest(BaseModel):
    symbol: str = Field(..., description="NSE stock symbol e.g. RELIANCE")
    start_date: str = Field(default="", description="YYYY-MM-DD")
    end_date: str = Field(default="", description="YYYY-MM-DD")
    initial_capital: float = Field(default=500000.0, ge=10000, le=10000000)
    strategy: str = Field(default="EMA_CROSSOVER", pattern="^(EMA_CROSSOVER|SUPERTREND)$")
    fast_ema: int = Field(default=9, ge=3, le=50)
    slow_ema: int = Field(default=21, ge=5, le=200)
    sl_pct: float = Field(default=0.03, ge=0.005, le=0.15)
    target_pct: float = Field(default=0.06, ge=0.01, le=0.30)
    brokerage_pct: float = Field(default=0.0003, ge=0.0, le=0.01)


class MonteCarloRequest(BaseModel):
    trades: List[Dict[str, Any]] = Field(..., description="List of trade dicts from a backtest result")
    initial_capital: float = Field(default=500000.0, ge=10000)
    n_simulations: int = Field(default=1000, ge=100, le=10000)


# ── Options Backtest Endpoints ─────────────────────────────────────────────────

@router.post("/run")
async def run_backtest(
    req: BacktestRequest,
    redis=Depends(get_redis),
):
    """
    Run the options strategy backtest.
    Uses Black-Scholes pricing + synthetic NIFTY data if live data unavailable.
    Results cached for 5 minutes per config.
    Returns: trades, metrics (Sharpe, Sortino, Calmar, Kelly), equity curve, monthly P&L.
    """
    cache_key = (
        f"backtest:{req.symbol}:{req.start_date}:{req.end_date}:"
        f"{req.trade_type}:{req.min_confidence}:{req.lots_per_trade}:"
        f"{req.initial_capital}"
    )

    cached = await redis.get(cache_key)
    if cached:
        logger.info("Returning cached backtest result")
        return json.loads(cached)

    try:
        from engine.backtest import run_backtest as _run
        result = _run(
            symbol=req.symbol,
            start_date=req.start_date,
            end_date=req.end_date,
            initial_capital=req.initial_capital,
            lots_per_trade=req.lots_per_trade,
            trade_type=req.trade_type,
            min_confidence=req.min_confidence,
            t1_exit_pct=req.t1_exit_pct,
            brokerage_per_lot=req.brokerage_per_lot,
        )
        await redis.setex(cache_key, 300, json.dumps(result))
        return result
    except Exception as e:
        logger.error(f"Backtest error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Backtest failed: {str(e)}")


@router.get("/quick/{symbol}")
async def quick_backtest(
    symbol: str,
    days: int = Query(default=180, ge=30, le=1095),
    trade_type: str = Query(default="INTRADAY", pattern="^(INTRADAY|SWING)$"),
    min_confidence: float = Query(default=70.0, ge=50.0, le=95.0),
    redis=Depends(get_redis),
):
    """Quick backtest with default settings for last N days"""
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    cache_key = f"backtest:quick:{symbol}:{days}:{trade_type}:{min_confidence}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        from engine.backtest import run_backtest as _run
        result = _run(
            symbol=symbol.upper(),
            start_date=start_date,
            end_date=end_date,
            trade_type=trade_type,
            min_confidence=min_confidence,
        )
        await redis.setex(cache_key, 300, json.dumps(result))
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Equity Backtest ────────────────────────────────────────────────────────────

@router.post("/equity")
async def equity_backtest(
    req: EquityBacktestRequest,
    redis=Depends(get_redis),
):
    """
    Equity stock backtest using EMA crossover or Supertrend strategy.
    - EMA_CROSSOVER: Buy on golden cross (fast > slow EMA), sell on death cross
    - SUPERTREND: Buy on RSI oversold + price above 50 EMA
    Uses ATR-based dynamic stop-loss and target.
    Returns: trades, metrics, equity curve, buy-and-hold comparison, alpha.
    """
    cache_key = (
        f"backtest:equity:{req.symbol}:{req.strategy}:{req.start_date}:"
        f"{req.end_date}:{req.fast_ema}:{req.slow_ema}:{req.initial_capital}"
    )
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        from engine.backtest import run_equity_backtest as _run
        result = _run(
            symbol=req.symbol.upper(),
            start_date=req.start_date,
            end_date=req.end_date,
            initial_capital=req.initial_capital,
            strategy=req.strategy,
            fast_ema=req.fast_ema,
            slow_ema=req.slow_ema,
            sl_pct=req.sl_pct,
            target_pct=req.target_pct,
            brokerage_pct=req.brokerage_pct,
        )
        await redis.setex(cache_key, 300, json.dumps(result))
        return result
    except Exception as e:
        logger.error(f"Equity backtest error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Equity backtest failed: {str(e)}")


@router.get("/equity/quick/{symbol}")
async def quick_equity_backtest(
    symbol: str,
    days: int = Query(default=365, ge=60, le=1095),
    strategy: str = Query(default="EMA_CROSSOVER"),
    fast_ema: int = Query(default=9, ge=3, le=50),
    slow_ema: int = Query(default=21, ge=5, le=200),
    redis=Depends(get_redis),
):
    """Quick equity backtest for last N days"""
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    cache_key = f"backtest:equity:quick:{symbol}:{days}:{strategy}:{fast_ema}:{slow_ema}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    try:
        from engine.backtest import run_equity_backtest as _run
        result = _run(
            symbol=symbol.upper(),
            start_date=start_date,
            end_date=end_date,
            strategy=strategy,
            fast_ema=fast_ema,
            slow_ema=slow_ema,
        )
        await redis.setex(cache_key, 300, json.dumps(result))
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Monte Carlo ────────────────────────────────────────────────────────────────

@router.post("/monte-carlo")
async def monte_carlo(
    req: MonteCarloRequest,
    redis=Depends(get_redis),
):
    """
    Run Monte Carlo simulation on a set of trades.
    Bootstraps trade sequence N times to compute confidence intervals.
    Returns:
      - Final equity at p5/p25/p50/p75/p95
      - Max drawdown distribution
      - Probability of profit / probability of ruin (50% capital loss)
    """
    try:
        from engine.backtest import run_monte_carlo as _mc
        result = _mc(
            trades=req.trades,
            initial_capital=req.initial_capital,
            n_simulations=req.n_simulations,
        )
        return result
    except Exception as e:
        logger.error(f"Monte Carlo error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Monte Carlo failed: {str(e)}")


# ── Walk-Forward Optimization ──────────────────────────────────────────────────

@router.get("/walk-forward/{symbol}")
async def walk_forward(
    symbol: str,
    days: int = Query(default=365, ge=120, le=1095),
    trade_type: str = Query(default="INTRADAY", pattern="^(INTRADAY|SWING)$"),
    n_windows: int = Query(default=5, ge=3, le=10),
    redis=Depends(get_redis),
):
    """
    Walk-forward optimization: splits data into N rolling windows.
    Trains on 70% of each window, tests on 30%.
    Returns out-of-sample performance per window + robustness summary.
    A strategy is considered robust if ≥60% of windows are profitable.
    """
    cache_key = f"backtest:wf:{symbol}:{days}:{trade_type}:{n_windows}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    try:
        from engine.backtest import (
            _load_historical_data,
            _generate_synthetic_nifty,
            run_walk_forward,
        )
        df = _load_historical_data(symbol.upper(), start_date, end_date)
        if df is None or len(df) < 60:
            df = _generate_synthetic_nifty(start_date, end_date)

        result = run_walk_forward(
            df=df,
            initial_capital=500000.0,
            n_windows=n_windows,
            trade_type=trade_type,
        )
        result["symbol"] = symbol.upper()
        result["period_days"] = days
        await redis.setex(cache_key, 600, json.dumps(result))
        return result
    except Exception as e:
        logger.error(f"Walk-forward error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Walk-forward failed: {str(e)}")


# ── Parameter Sensitivity ──────────────────────────────────────────────────────

@router.get("/sensitivity/{symbol}")
async def parameter_sensitivity(
    symbol: str,
    days: int = Query(default=365, ge=120, le=1095),
    redis=Depends(get_redis),
):
    """
    Parameter sensitivity analysis: test multiple confidence thresholds
    and find the optimal min_confidence for the given symbol/period.
    Returns win_rate, pnl, sharpe for each threshold tested.
    """
    cache_key = f"backtest:sensitivity:{symbol}:{days}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    results = []
    thresholds = [60.0, 65.0, 70.0, 75.0, 80.0]

    try:
        from engine.backtest import run_backtest as _run
        for threshold in thresholds:
            try:
                r = _run(
                    symbol=symbol.upper(),
                    start_date=start_date,
                    end_date=end_date,
                    min_confidence=threshold,
                )
                m = r["metrics"]
                results.append({
                    "min_confidence": threshold,
                    "total_trades": m["total_trades"],
                    "win_rate": m["win_rate"],
                    "total_pnl": m["total_pnl"],
                    "sharpe_ratio": m["sharpe_ratio"],
                    "sortino_ratio": m["sortino_ratio"],
                    "calmar_ratio": m["calmar_ratio"],
                    "max_drawdown_pct": m["max_drawdown_pct"],
                    "profit_factor": m["profit_factor"],
                })
            except Exception as e:
                logger.warning(f"Sensitivity test failed for threshold {threshold}: {e}")

        # Find optimal threshold (highest Sharpe with ≥10 trades)
        valid = [r for r in results if r["total_trades"] >= 10]
        optimal = max(valid, key=lambda x: x["sharpe_ratio"]) if valid else None

        output = {
            "symbol": symbol.upper(),
            "period_days": days,
            "results": results,
            "optimal_confidence": optimal["min_confidence"] if optimal else 70.0,
            "optimal_metrics": optimal,
        }
        await redis.setex(cache_key, 600, json.dumps(output))
        return output
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
