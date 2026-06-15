"""
Stocks router — quotes, historical data, search, indicators, market status
"""
import json
import logging
import sys
import os
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import List, Optional

logger = logging.getLogger(__name__)


def _to_float(v):
    return float(v) if isinstance(v, Decimal) else v

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.database import get_db, get_redis
from backend.schemas import (
    QuoteOut, HistoricalDataOut, IndicatorsOut,
    StockOut, SearchResult, MarketStatusOut, SectorData,
)

router = APIRouter(prefix="/api/stocks", tags=["Stocks"])


@router.get("/search", response_model=List[SearchResult])
async def search_stocks(
    q: str = Query(..., min_length=1),
    exchange: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """
    Search stocks by symbol or name — NSE + BSE.
    Strategy:
      1. Check Redis cache (5-min TTL)
      2. pg_trgm fuzzy search in local DB across NSE + BSE
      3. Angel One searchScrip API fallback on both exchanges
      4. Merge & deduplicate by (symbol, exchange), DB results ranked first
    """
    cache_key = f"search:{q.upper()}:{(exchange or 'ALL').upper()}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    results: List[dict] = []
    # Deduplicate by (symbol, exchange) tuple so same symbol on NSE+BSE both show
    seen_keys: set = set()

    # ── 1. pg_trgm fuzzy search in local DB (NSE + BSE) ──────────────────────
    try:
        rows = await db.execute(
            text("""
                SELECT symbol, name, exchange, symbol_token AS token,
                       GREATEST(
                           similarity(symbol, :q),
                           similarity(name, :q)
                       ) AS score
                FROM stocks
                WHERE (
                    symbol ILIKE :like_q
                    OR name ILIKE :like_q
                    OR similarity(symbol, :q) > 0.2
                    OR similarity(name, :q) > 0.2
                )
                AND (:exch IS NULL OR exchange = :exch)
                ORDER BY
                    -- NSE first, then BSE
                    CASE exchange WHEN 'NSE' THEN 0 ELSE 1 END,
                    score DESC,
                    symbol
                LIMIT 25
            """),
            {"q": q.upper(), "like_q": f"%{q}%", "exch": exchange},
        )
        for row in rows.mappings():
            sym = row["symbol"]
            exch = row["exchange"] or "NSE"
            key = f"{sym}:{exch}"
            if key not in seen_keys:
                seen_keys.add(key)
                results.append({
                    "symbol": sym,
                    "name": row["name"] or sym,
                    "exchange": exch,
                    "token": row["token"],
                    "instrument_type": "EQ",
                })
    except Exception as e:
        logger.warning(f"DB search failed for '{q}': {e}")

    # ── 2. Angel One API fallback — searches both NSE + BSE ──────────────────
    # Only call if DB returned fewer than 5 results (DB is preferred source)
    if len(results) < 5:
        try:
            from backend.data_fetcher import search_symbol as _angel_search
            # Pass exchange=None so data_fetcher searches both NSE and BSE
            angel_results = _angel_search(q, exchange)
            for item in angel_results:
                sym = item.get("symbol", "")
                exch = item.get("exchange", "NSE")
                key = f"{sym}:{exch}"
                if sym and key not in seen_keys:
                    seen_keys.add(key)
                    results.append(item)
        except Exception as e:
            logger.warning(f"Angel One search failed for '{q}': {e}")

    # Cache merged results for 5 minutes
    await redis.setex(cache_key, 300, json.dumps(results[:30]))
    return results[:30]


@router.get("/market-status", response_model=MarketStatusOut)
async def get_market_status():
    """Get NSE/BSE market open/close status"""
    from backend.data_fetcher import get_market_status
    return get_market_status()


@router.get("/trending", response_model=List[QuoteOut])
async def get_trending(
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Get top movers from live Redis quotes (updated every 15s by poll loop)"""
    # Read all live quotes from Redis — populated by poll loop every 15s
    keys = await redis.keys("quote:NSE:*")
    quotes = []
    for key in keys:
        raw = await redis.get(key)
        if not raw:
            continue
        try:
            q = json.loads(raw)
            sym = q.get("symbol", "")
            if not sym:
                continue
            quotes.append({
                "symbol": sym,
                "exchange": q.get("exchange", "NSE"),
                "ltp": float(q.get("ltp", 0)),
                "open": float(q.get("open", 0)),
                "high": float(q.get("high", 0)),
                "low": float(q.get("low", 0)),
                "close": float(q.get("close", 0)),
                "volume": int(q.get("volume", 0)),
                "change": float(q.get("change", 0)),
                "change_pct": float(q.get("change_pct", 0)),
                "week_52_high": None,
                "week_52_low": None,
                "timestamp": q.get("timestamp", datetime.now().isoformat()),
            })
        except Exception:
            continue

    if not quotes:
        # DB fallback if poll loop hasn't run yet
        result_rows = await db.execute(
            text("""
            WITH latest_date AS (
                SELECT MAX(date) AS max_date FROM ohlcv_daily WHERE exchange='NSE'
            ),
            prev_date AS (
                SELECT MAX(date) AS prev_date FROM ohlcv_daily
                WHERE exchange='NSE' AND date < (SELECT max_date FROM latest_date)
            ),
            latest AS (
                SELECT o.symbol, o.exchange, o.close, o.open, o.high, o.low, o.volume, o.date
                FROM ohlcv_daily o, latest_date
                WHERE o.exchange='NSE' AND o.date = latest_date.max_date
            ),
            prev AS (
                SELECT o.symbol, o.exchange, o.close AS prev_close
                FROM ohlcv_daily o, prev_date
                WHERE o.exchange='NSE' AND o.date = prev_date.prev_date
            )
            SELECT l.symbol, l.exchange,
                   l.close AS ltp, l.open, l.high, l.low,
                   COALESCE(p.prev_close, l.close) AS close_prev,
                   l.volume,
                   l.close - COALESCE(p.prev_close, l.close) AS change,
                   ROUND((l.close - COALESCE(p.prev_close, l.close))
                         / NULLIF(COALESCE(p.prev_close, l.close), 0) * 100, 2) AS change_pct,
                   l.date
            FROM latest l
            LEFT JOIN prev p ON l.symbol = p.symbol AND l.exchange = p.exchange
            ORDER BY ABS(l.close - COALESCE(p.prev_close, l.close))
                     / NULLIF(COALESCE(p.prev_close, l.close), 0) DESC NULLS LAST
            LIMIT 20
            """)
        )
        rows = result_rows.fetchall()
        quotes = [
            {
                "symbol": r[0], "exchange": r[1],
                "ltp": _to_float(r[2]), "open": _to_float(r[3]), "high": _to_float(r[4]),
                "low": _to_float(r[5]), "close": _to_float(r[6]), "volume": int(r[7] or 0),
                "change": _to_float(r[8] or 0), "change_pct": _to_float(r[9] or 0),
                "week_52_high": None, "week_52_low": None,
                "timestamp": str(r[10]),
            }
            for r in rows
        ]

    # Sort by absolute change% descending, return top 20
    quotes.sort(key=lambda x: abs(x.get("change_pct", 0)), reverse=True)
    return quotes[:20]


@router.get("/sector-heatmap", response_model=List[SectorData])
async def get_sector_heatmap(
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Get sector-wise performance heatmap"""
    cache_key = "heatmap:sectors"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    result = await db.execute(
        text("""
        SELECT
            s.sector,
            AVG((o.close - o.prev_close) / NULLIF(o.prev_close, 0) * 100) AS avg_change_pct,
            COUNT(DISTINCT s.symbol) AS stock_count
        FROM stocks s
        JOIN LATERAL (
            SELECT
                (array_agg(close ORDER BY date DESC))[1] AS close,
                (array_agg(close ORDER BY date DESC))[2] AS prev_close
            FROM ohlcv_daily
            WHERE symbol = s.symbol AND exchange = s.exchange
        ) o ON TRUE
        WHERE s.sector IS NOT NULL AND s.sector != 'Index'
        GROUP BY s.sector
        ORDER BY avg_change_pct DESC
        """)
    )
    rows = result.fetchall()
    data = [
        {"sector": r[0], "avg_change_pct": round(_to_float(r[1] or 0), 2), "stock_count": r[2]}
        for r in rows
    ]
    await redis.setex(cache_key, 60, json.dumps(data))
    return data


@router.get("", response_model=List[StockOut])
async def list_stocks(
    exchange: Optional[str] = None,
    sector: Optional[str] = None,
    fo_only: bool = False,
    limit: int = Query(default=100, le=500),
    db: AsyncSession = Depends(get_db),
):
    """List all stocks with optional filters"""
    conditions = ["is_active = TRUE"]
    params = {}

    if exchange:
        conditions.append("exchange = :exchange")
        params["exchange"] = exchange.upper()
    if sector:
        conditions.append("sector = :sector")
        params["sector"] = sector
    if fo_only:
        conditions.append("is_fo_enabled = TRUE")

    where_clause = " AND ".join(conditions)
    result = await db.execute(
        text(f"SELECT * FROM stocks WHERE {where_clause} ORDER BY symbol LIMIT :limit"),
        {**params, "limit": limit},
    )
    rows = result.fetchall()
    return [dict(r._mapping) for r in rows]


@router.get("/{symbol}/quote", response_model=QuoteOut)
async def get_quote(
    symbol: str,
    exchange: str = Query(default="NSE"),
    redis=Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """
    Get live quote for a stock.
    Priority: Redis cache → Angel One live → DB OHLCV fallback → zero-filled stub.
    Never raises 404 so watchlist always renders the row.
    """
    sym = symbol.upper()
    exch = exchange.upper()
    cache_key = f"quote:{exch}:{sym}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # ── 1. Try Angel One live quote ───────────────────────────────────────────
    try:
        from backend.data_fetcher import get_live_quote
        quote = get_live_quote(sym, exch)
        if quote and quote.get("ltp", 0) > 0:
            result = _normalize_quote(quote)
            await redis.setex(cache_key, 15, json.dumps(result))
            return result
    except Exception as e:
        logger.warning(f"Angel One quote failed for {sym}: {e}")

    # ── 2. DB OHLCV fallback — last 2 days ────────────────────────────────────
    try:
        result_rows = await db.execute(
            text("""
            SELECT close, open, high, low, volume, date
            FROM ohlcv_daily
            WHERE symbol=:sym AND exchange=:exch
            ORDER BY date DESC LIMIT 2
            """),
            {"sym": sym, "exch": exch},
        )
        rows = result_rows.fetchall()
        if rows:
            latest = rows[0]
            prev_close = float(rows[1][0]) if len(rows) > 1 else float(latest[0])
            ltp = float(latest[0])
            change = round(ltp - prev_close, 2)
            change_pct = round(change / prev_close * 100, 2) if prev_close else 0
            result = {
                "symbol": sym, "exchange": exch,
                "ltp": ltp, "open": _to_float(latest[1]), "high": _to_float(latest[2]),
                "low": _to_float(latest[3]), "close": prev_close,
                "volume": int(latest[4] or 0),
                "change": change, "change_pct": change_pct,
                "week_52_high": None, "week_52_low": None,
                "timestamp": str(latest[5]),
            }
            await redis.setex(cache_key, 300, json.dumps(result))
            return result
    except Exception as e:
        logger.warning(f"DB quote fallback failed for {sym}: {e}")

    # ── 3. Zero-filled stub — stock exists in watchlist but no data yet ───────
    # Return a valid response so the watchlist row renders (shows — for prices)
    stub = {
        "symbol": sym, "exchange": exch,
        "ltp": 0.0, "open": 0.0, "high": 0.0, "low": 0.0, "close": 0.0,
        "volume": 0, "change": 0.0, "change_pct": 0.0,
        "week_52_high": None, "week_52_low": None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    # Cache stub for only 30s so it retries quickly
    await redis.setex(cache_key, 30, json.dumps(stub))
    return stub


@router.get("/{symbol}/historical", response_model=HistoricalDataOut)
async def get_historical(
    symbol: str,
    exchange: str = Query(default="NSE"),
    interval: str = Query(default="1d"),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Get historical OHLCV data"""
    sym = symbol.upper()
    exch = exchange.upper()
    cache_key = f"hist:{exch}:{sym}:{interval}:{(from_date or '')[:10]}"
    cached = await redis.get(cache_key)
    if cached:
        candles = json.loads(cached)
        return {"symbol": sym, "exchange": exch, "interval": interval, "candles": candles}

    from backend.data_fetcher import get_historical_ohlcv

    # Try DB first for daily data
    if interval == "1d":
        result = await db.execute(
            text("""
            SELECT date::text AS time, open, high, low, close, volume
            FROM ohlcv_daily
            WHERE symbol = :sym AND exchange = :exch
            ORDER BY date DESC LIMIT 365
            """),
            {"sym": sym, "exch": exch},
        )
        rows = result.fetchall()
        if rows:
            candles = [
                {k: (float(v) if isinstance(v, Decimal) else v)
                 for k, v in dict(r._mapping).items()}
                for r in reversed(rows)
            ]
            # Check if DB data is fresh (last candle within 2 calendar days)
            try:
                last_date = date.fromisoformat(candles[-1]["time"][:10])
                days_stale = (date.today() - last_date).days
                if days_stale > 2:
                    # Use 1h data to synthesize missing daily candles (avoids rate-limit hit)
                    hourly = get_historical_ohlcv(sym, exch, "1h")
                    existing_dates = {c["time"][:10] for c in candles}
                    # Group hourly bars by IST date
                    day_map: dict = {}
                    for h in hourly:
                        d_key = h["time"][:10]  # IST date is already correct in the string
                        if d_key in existing_dates:
                            continue
                        if d_key not in day_map:
                            day_map[d_key] = []
                        day_map[d_key].append(h)
                    # Aggregate each missing date into a daily candle
                    for d_key, bars in day_map.items():
                        bars.sort(key=lambda b: b["time"])
                        candles.append({
                            "time":   d_key,
                            "open":   bars[0]["open"],
                            "high":   max(b["high"]   for b in bars),
                            "low":    min(b["low"]    for b in bars),
                            "close":  bars[-1]["close"],
                            "volume": int(sum(b["volume"] for b in bars)),
                        })
                    candles.sort(key=lambda c: c["time"])
            except Exception:
                pass  # serve DB data as-is if aggregation fails

            await redis.setex(cache_key, 3600, json.dumps(candles))
            return {"symbol": sym, "exchange": exch, "interval": interval, "candles": candles}

    # Fallback to Angel One API (no DB rows, or intraday interval)
    try:
        candles = get_historical_ohlcv(sym, exch, interval, from_date, to_date)
        ttl = 3600 if interval == "1d" else 300
        await redis.setex(cache_key, ttl, json.dumps(candles))
        return {"symbol": sym, "exchange": exch, "interval": interval, "candles": candles}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/{symbol}/indicators", response_model=IndicatorsOut)
async def get_indicators(
    symbol: str,
    exchange: str = Query(default="NSE"),
    timeframe: str = Query(default="1d"),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Get computed technical indicators"""
    sym = symbol.upper()
    exch = exchange.upper()
    cache_key = f"indicators:{exch}:{sym}:{timeframe}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Get OHLCV from DB
    table = "ohlcv_1min" if timeframe in ("1m", "5m", "15m") else "ohlcv_daily"
    time_col = "time" if table == "ohlcv_1min" else "date"
    result = await db.execute(
        text(f"""
        SELECT {time_col} AS time, open, high, low, close, volume
        FROM {table}
        WHERE symbol = :sym AND exchange = :exch
        ORDER BY {time_col} DESC LIMIT 250
        """),
        {"sym": sym, "exch": exch},
    )
    rows = result.fetchall()

    if len(rows) < 20:
        # Try Angel One API as fallback
        from backend.data_fetcher import get_historical_ohlcv
        interval_map = {"1d": "1d", "1h": "1h", "15m": "15m", "5m": "5m", "1m": "1m"}
        candles = get_historical_ohlcv(sym, exch, interval_map.get(timeframe, "1d"))
        if not candles:
            raise HTTPException(status_code=404, detail=f"No data for {sym}")
        df = pd.DataFrame(candles)
    else:
        df = pd.DataFrame([dict(r._mapping) for r in reversed(rows)])

    from engine.indicators import calculate_all_indicators
    indicators = calculate_all_indicators(df)

    # Extract signal keys — convert booleans to strings so schema validates
    signals = {
        k: ("BUY" if v is True else "SELL" if v is False else str(v))
        for k, v in indicators.items()
        if k.endswith("_signal") or k.endswith("_crossover")
    }

    result_data = {
        "symbol": sym, "exchange": exch, "timeframe": timeframe,
        **{k: v for k, v in indicators.items()},
        "signals": signals,
    }
    await redis.setex(cache_key, 60, json.dumps(result_data))
    return result_data


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_quote(q: dict) -> dict:
    return {
        "symbol": q.get("symbol", ""),
        "exchange": q.get("exchange", "NSE"),
        "ltp": q.get("ltp", 0),
        "open": q.get("open", 0),
        "high": q.get("high", 0),
        "low": q.get("low", 0),
        "close": q.get("close", 0),
        "volume": q.get("volume", 0),
        "change": q.get("change", 0),
        "change_pct": q.get("change_pct", 0),
        "week_52_high": q.get("52w_high"),
        "week_52_low": q.get("52w_low"),
        "timestamp": q.get("timestamp", datetime.now().isoformat()),
    }
