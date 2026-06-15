"""
Screener router — AI probability signals, filtering, watchlists, alerts
"""
import json
import logging
import sys
import os
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional

logger = logging.getLogger("screener")


def _json_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _dumps(obj) -> str:
    return json.dumps(obj, default=_json_default)

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.database import get_db, get_redis
from backend.schemas import (
    StockSignalOut, ScreenerFilters,
    WatchlistCreate, WatchlistOut, WatchlistUpdate,
    AlertCreate, AlertOut,
)

router = APIRouter(prefix="/api/screener", tags=["Screener"])


# ── Shared live-price overlay helper ─────────────────────────────────────────

async def _overlay_live_prices(signals: list, redis, db: "AsyncSession | None" = None) -> list:
    """
    For each signal dict, look up the live LTP and overlay it onto
    entry_price, target_7d, target_15d, stop_loss.
    Also adds live_ltp, price_change_pct, price_updated_at fields.

    Priority:
      1. Redis cache (quote:EXCHANGE:SYMBOL) — populated by WebSocket feed
      2. Angel One live quote via data_fetcher (non-blocking, 3s timeout)
      3. DB OHLCV fallback — last 2 rows from ohlcv_daily (always available)
    """
    for s in signals:
        sym = s.get("symbol", "")
        exchange = s.get("exchange", "NSE")
        live_ltp: float = 0.0
        change_pct: float = 0.0
        price_ts: str = ""

        # ── 1. Redis cache ────────────────────────────────────────────────────
        for key in [f"quote:{exchange}:{sym}", f"quote:NSE:{sym}", f"quote:{sym}"]:
            raw = await redis.get(key)
            if raw:
                try:
                    q = json.loads(raw)
                    ltp_val = float(q.get("ltp", 0) or 0)
                    if ltp_val > 0:
                        live_ltp = ltp_val
                        change_pct = round(float(q.get("change_pct", 0) or 0), 2)
                        price_ts = q.get("timestamp", "")
                        break
                except Exception:
                    pass

        # ── 2. Angel One live quote (fast, non-blocking) ──────────────────────
        if live_ltp == 0:
            try:
                import asyncio
                from concurrent.futures import ThreadPoolExecutor
                from backend.data_fetcher import get_live_quote as _get_live_quote

                loop = asyncio.get_event_loop()
                with ThreadPoolExecutor(max_workers=1) as pool:
                    quote = await asyncio.wait_for(
                        loop.run_in_executor(pool, _get_live_quote, sym, exchange),
                        timeout=3.0,
                    )
                if quote and float(quote.get("ltp", 0) or 0) > 0:
                    live_ltp = float(quote["ltp"])
                    change_pct = round(float(quote.get("change_pct", 0) or 0), 2)
                    price_ts = quote.get("timestamp", "")
                    # Cache in Redis for 15s so subsequent calls are instant
                    cache_key = f"quote:{exchange}:{sym}"
                    await redis.setex(cache_key, 15, json.dumps(quote))
            except Exception:
                pass

        # ── 3. DB OHLCV fallback ──────────────────────────────────────────────
        if live_ltp == 0 and db is not None:
            try:
                rows = await db.execute(
                    text("""
                    SELECT close, date
                    FROM ohlcv_daily
                    WHERE symbol = :sym AND exchange = :exch
                    ORDER BY date DESC LIMIT 2
                    """),
                    {"sym": sym, "exch": exchange},
                )
                ohlcv_rows = rows.fetchall()
                if ohlcv_rows:
                    latest_close = float(ohlcv_rows[0][0])
                    prev_close = float(ohlcv_rows[1][0]) if len(ohlcv_rows) > 1 else latest_close
                    if latest_close > 0:
                        live_ltp = latest_close
                        change_pct = round((latest_close - prev_close) / prev_close * 100, 2) if prev_close > 0 else 0.0
                        price_ts = str(ohlcv_rows[0][1])
            except Exception:
                pass

        # ── Apply overlay ─────────────────────────────────────────────────────
        if live_ltp > 0:
            stored_entry = float(s.get("entry_price") or 0)
            if stored_entry > 0 and abs(live_ltp - stored_entry) / stored_entry > 0.001:
                # Price has moved since signal was generated — rescale targets/SL
                ratio = live_ltp / stored_entry
                s["entry_price"] = round(live_ltp, 2)
                if s.get("target_3d"):
                    s["target_3d"] = round(float(s["target_3d"]) * ratio, 2)
                if s.get("target_7d"):
                    s["target_7d"] = round(float(s["target_7d"]) * ratio, 2)
                if s.get("target_15d"):
                    s["target_15d"] = round(float(s["target_15d"]) * ratio, 2)
                if s.get("stop_loss"):
                    s["stop_loss"] = round(float(s["stop_loss"]) * ratio, 2)
            elif stored_entry == 0:
                s["entry_price"] = round(live_ltp, 2)

            s["live_ltp"] = live_ltp
            s["price_change_pct"] = change_pct
            s["price_updated_at"] = price_ts

    return signals


# ── Screener ──────────────────────────────────────────────────────────────────

@router.get("/signals", response_model=List[StockSignalOut])
async def get_signals(
    min_probability: float = Query(default=60.0),
    signal_type: Optional[str] = Query(default=None),
    sector: Optional[str] = Query(default=None),
    confidence: Optional[str] = Query(default=None),
    limit: int = Query(default=50, le=200),
    redis=Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """Get AI-generated trade probability signals with live price overlay"""
    # Fetch raw signals from DB (no long-lived cache — we overlay live prices)
    result = await db.execute(
        text("""
        SELECT symbol, exchange, signal_type, timeframe,
               probability_score, probability_7d, probability_15d,
               entry_price, target_7d, target_15d, stop_loss,
               expected_return_7d, expected_return_15d, risk_reward_ratio,
               estimated_hold_days, confidence, category, top_reasons, risks,
               technical_score, volume_score, price_action_score, options_score,
               reasoning, confirmation_checks, confirmed_count, buy_confirmed,
               probability_3d, target_3d, expected_return_3d, created_at
        FROM stock_signals
        WHERE is_active = TRUE
        ORDER BY probability_score DESC
        LIMIT 200
        """)
    )
    rows = result.fetchall()
    signals = []
    for r in rows:
        s = {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(r._mapping).items()}
        s["top_reasons"] = s.get("top_reasons") or []
        s["risks"] = s.get("risks") or []
        # confirmation_checks comes back as dict from JSONB, or string if old row
        cc = s.get("confirmation_checks")
        if isinstance(cc, str):
            try:
                cc = json.loads(cc)
            except Exception:
                cc = {}
        s["confirmation_checks"] = cc or {}
        if s.get("created_at"):
            s["created_at"] = s["created_at"].isoformat()
        signals.append(s)

    # Overlay live prices (Redis → Angel One → DB fallback)
    signals = await _overlay_live_prices(signals, redis, db)
    await _overlay_backtest(signals, redis)

    # Apply filters in-memory
    filtered = signals
    if min_probability:
        filtered = [s for s in filtered if (s.get("probability_score") or 0) >= min_probability]
    if signal_type:
        filtered = [s for s in filtered if s.get("signal_type") == signal_type.upper()]
    if confidence:
        filtered = [s for s in filtered if s.get("confidence") == confidence.upper()]

    return filtered[:limit]


@router.post("/run")
async def run_screener(
    redis=Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """Trigger the AI screener and persist results to DB + Redis."""
    try:
        from engine.screener import run_screener as _run
        results = await _run()

        if results:
            # Persist to Redis — store ALL results (up to 200) with a 60-second
            # TTL so the /signals endpoint always sees fresh data within 1 minute.
            await redis.setex("screener:results", 60, _dumps(results[:200]))

            # Deactivate old signals
            await db.execute(text("UPDATE stock_signals SET is_active = FALSE"))

            # Insert new signals into DB
            for s in results:
                await db.execute(text("""
                    INSERT INTO stock_signals (
                        symbol, exchange, signal_type, timeframe,
                        probability_score, probability_3d, probability_7d, probability_15d,
                        entry_price, target_3d, target_7d, target_15d, stop_loss,
                        expected_return_3d, expected_return_7d, expected_return_15d, risk_reward_ratio,
                        estimated_hold_days, confidence, category,
                        top_reasons, risks,
                        technical_score, volume_score, price_action_score, options_score,
                        reasoning, confirmation_checks, confirmed_count, buy_confirmed,
                        is_active, created_at
                    ) VALUES (
                        :symbol, :exchange, :signal_type, :timeframe,
                        :probability_score, :probability_3d, :probability_7d, :probability_15d,
                        :entry_price, :target_3d, :target_7d, :target_15d, :stop_loss,
                        :expected_return_3d, :expected_return_7d, :expected_return_15d, :risk_reward_ratio,
                        :estimated_hold_days, :confidence, :category,
                        :top_reasons, :risks,
                        :technical_score, :volume_score, :price_action_score, :options_score,
                        :reasoning, :confirmation_checks, :confirmed_count, :buy_confirmed,
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
                    "top_reasons": json.dumps(s.get("top_reasons") or []),
                    "risks": json.dumps(s.get("risks") or []),
                    "technical_score": s.get("technical_score"),
                    "volume_score": s.get("volume_score"),
                    "price_action_score": s.get("price_action_score"),
                    "options_score": s.get("options_score"),
                    "reasoning": s.get("reasoning"),
                    "confirmation_checks": json.dumps(s.get("confirmation_checks") or {}),
                    "confirmed_count": s.get("confirmed_count", 0),
                    "buy_confirmed": bool(s.get("buy_confirmed", False)),
                })

            await db.commit()
            # Invalidate caches
            await redis.delete("screener:top_picks")

        return {"message": f"Screener completed: {len(results)} signals saved to DB", "count": len(results)}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/top-picks", response_model=List[StockSignalOut])
async def get_top_picks(
    redis=Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """Get today's top 10 high-probability signals with live price overlay."""
    result = await db.execute(
        text("""
        SELECT symbol, exchange, signal_type, timeframe,
               probability_score, probability_3d, probability_7d, probability_15d,
               entry_price, target_3d, target_7d, target_15d, stop_loss,
               expected_return_3d, expected_return_7d, expected_return_15d, risk_reward_ratio,
               estimated_hold_days, confidence, category, top_reasons, risks,
               technical_score, volume_score, price_action_score, options_score,
               reasoning, confirmation_checks, confirmed_count, buy_confirmed, created_at
        FROM stock_signals
        WHERE is_active = TRUE
        ORDER BY probability_score DESC
        LIMIT 10
        """)
    )
    rows = result.fetchall()
    signals = []
    for r in rows:
        s = {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(r._mapping).items()}
        s["top_reasons"] = s.get("top_reasons") or []
        s["risks"] = s.get("risks") or []
        # confirmation_checks comes back as dict from JSONB, or string if old row
        cc = s.get("confirmation_checks")
        if isinstance(cc, str):
            try:
                cc = json.loads(cc)
            except Exception:
                cc = {}
        s["confirmation_checks"] = cc or {}
        if s.get("created_at"):
            s["created_at"] = s["created_at"].isoformat()
        signals.append(s)

    # Overlay live prices using shared helper (Redis → Angel One → DB fallback)
    signals = await _overlay_live_prices(signals, redis, db)
    await _overlay_backtest(signals, redis)
    return signals


# ── Backtest calibration ───────────────────────────────────────────────────────

async def _overlay_backtest(signals: list, redis) -> None:
    """Attach backtest win-rate data to each signal in-place (no-op if not computed yet)."""
    try:
        cached = await redis.get("backtest:calibration")
        if not cached:
            return
        calibration = json.loads(cached)
        for s in signals:
            cat = s.get("category", "")
            if cat in calibration:
                cal = calibration[cat]
                s["backtest_win_rate"]     = cal["win_rate_7d"]
                s["backtest_sample_count"] = cal["sample_count"]
                s["backtest_expectancy"]   = cal["expectancy"]
    except Exception:
        pass


@router.post("/backtest/run")
async def run_backtest(
    background_tasks: BackgroundTasks,
    min_probability: float = Query(default=75.0),
    redis=Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger walk-forward backtest filtered to stocks that have historically
    scored above min_probability in the screener (default 75%).
    Runs in background (~30–60s). Poll /backtest/results for output.
    """
    # Fetch the distinct symbols that have ever scored above the threshold
    result = await db.execute(
        text("SELECT DISTINCT symbol FROM stock_signals WHERE probability_score >= :p"),
        {"p": min_probability},
    )
    symbols = [r[0] for r in result.fetchall()]

    if not symbols:
        raise HTTPException(status_code=404, detail=f"No signals found with probability >= {min_probability}")

    async def _run(syms: list):
        try:
            from engine.backtester import run_backtest as _bt
            result = await _bt(symbol_filter=syms)
            if result:
                await redis.setex("backtest:calibration", 86400 * 7, json.dumps(result))
                logger.info(f"Backtest done: {len(result)} categories, {len(syms)} stocks (prob>={min_probability})")
        except Exception as e:
            logger.error(f"Backtest background task failed: {e}")

    background_tasks.add_task(_run, symbols)
    return {
        "message": f"Backtest started on {len(symbols)} stocks with probability ≥ {min_probability}% — results in ~30s",
        "symbols": symbols,
    }


@router.get("/backtest/results")
async def get_backtest_results(redis=Depends(get_redis)):
    """Return stored backtest calibration stats per signal category."""
    cached = await redis.get("backtest:calibration")
    if cached:
        return json.loads(cached)

    # Fall back to DB if Redis cache expired
    try:
        from engine.backtester import get_calibration
        return await get_calibration()
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"No backtest data yet. Run POST /backtest/run first. ({e})")


# ── Watchlists ────────────────────────────────────────────────────────────────

@router.get("/watchlists", response_model=List[WatchlistOut])
async def get_watchlists(
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("SELECT * FROM watchlists WHERE user_id = :uid ORDER BY is_default DESC, created_at"),
        {"uid": user_id},
    )
    rows = result.fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/watchlists", response_model=WatchlistOut)
async def create_watchlist(
    body: WatchlistCreate,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    wid = str(uuid.uuid4())
    await db.execute(
        text("""
        INSERT INTO watchlists (id, user_id, name, symbols)
        VALUES (:id, :uid, :name, :symbols::jsonb)
        """),
        {"id": wid, "uid": user_id, "name": body.name, "symbols": json.dumps(body.symbols)},
    )
    await db.commit()
    result = await db.execute(text("SELECT * FROM watchlists WHERE id = :id"), {"id": wid})
    return dict(result.fetchone()._mapping)


@router.patch("/watchlists/{watchlist_id}", response_model=WatchlistOut)
async def update_watchlist(
    watchlist_id: str,
    body: WatchlistUpdate,
    db: AsyncSession = Depends(get_db),
):
    updates = []
    params: dict = {"id": watchlist_id}
    if body.name is not None:
        updates.append("name = :name")
        params["name"] = body.name
    if body.symbols is not None:
        updates.append("symbols = :symbols::jsonb")
        params["symbols"] = json.dumps(body.symbols)
    updates.append("updated_at = NOW()")

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.execute(
        text(f"UPDATE watchlists SET {', '.join(updates)} WHERE id = :id"),
        params,
    )
    await db.commit()
    result = await db.execute(text("SELECT * FROM watchlists WHERE id = :id"), {"id": watchlist_id})
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return dict(row._mapping)


@router.delete("/watchlists/{watchlist_id}")
async def delete_watchlist(watchlist_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(text("DELETE FROM watchlists WHERE id = :id"), {"id": watchlist_id})
    await db.commit()
    return {"message": "Deleted"}


# ── Price Alerts ──────────────────────────────────────────────────────────────

@router.get("/alerts", response_model=List[AlertOut])
async def get_alerts(
    user_id: str = Query(...),
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
):
    condition = "user_id = :uid"
    if active_only:
        condition += " AND is_active = TRUE"
    result = await db.execute(
        text(f"SELECT * FROM price_alerts WHERE {condition} ORDER BY created_at DESC"),
        {"uid": user_id},
    )
    rows = result.fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/alerts", response_model=AlertOut)
async def create_alert(
    body: AlertCreate,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    aid = str(uuid.uuid4())
    await db.execute(
        text("""
        INSERT INTO price_alerts (id, user_id, symbol, exchange, alert_type, condition, target_value)
        VALUES (:id, :uid, :symbol, :exchange, :alert_type, :condition, :target_value)
        """),
        {
            "id": aid, "uid": user_id,
            "symbol": body.symbol.upper(),
            "exchange": body.exchange.upper(),
            "alert_type": body.alert_type,
            "condition": body.condition,
            "target_value": body.target_value,
        },
    )
    await db.commit()
    result = await db.execute(text("SELECT * FROM price_alerts WHERE id = :id"), {"id": aid})
    return dict(result.fetchone()._mapping)


@router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("UPDATE price_alerts SET is_active = FALSE WHERE id = :id"),
        {"id": alert_id},
    )
    await db.commit()
    return {"message": "Alert deactivated"}
