"""
Paper Trades — fully automated paper trading driven by screener signals.

Flow:
  Screener runs (auto every 60s or manual)
    → qualifying signals auto-entered as paper trades
  Background monitor (every 5 min, market hours)
    → checks live Redis prices against targets / stop-loss
    → closes trades, records actual P&L
  /api/paper-trades/ + /summary expose results for the dashboard
"""
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from backend.database import get_db, get_redis

logger = logging.getLogger("paper_trades")
router = APIRouter(prefix="/api/paper-trades", tags=["Paper Trades"])

# ── Entry criteria — "perfect signal" definition ──────────────────────────────
_MIN_PROB        = 80.0                   # probability_score threshold
_MIN_CONFIRMED   = 4                      # confirmed_count (out of 5 checks)
_SIGNAL_TYPES    = {"STRONG_BUY"}
_GOOD_CATEGORIES = {                      # categories with positive historical E[R]
    "Momentum Breakout",
    "Trend Following",
    "Technical Setup",
    "Volume Surge",
}
CAPITAL_PER_TRADE = 10_000               # ₹10,000 simulated per position

# ── DB table ──────────────────────────────────────────────────────────────────

async def ensure_table(db: AsyncSession):
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS paper_trades (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            symbol          VARCHAR(20)  NOT NULL,
            exchange        VARCHAR(5)   DEFAULT 'NSE',
            signal_type     VARCHAR(20),
            category        VARCHAR(60),
            probability_score FLOAT,
            confirmed_count INT          DEFAULT 0,

            entry_price     FLOAT        NOT NULL,
            entry_time      TIMESTAMPTZ  DEFAULT NOW(),
            target_3d       FLOAT,
            target_7d       FLOAT,
            stop_loss       FLOAT,
            estimated_hold_days INT      DEFAULT 3,
            capital         FLOAT        DEFAULT 10000,
            quantity        INT          DEFAULT 1,

            status          VARCHAR(20)  DEFAULT 'OPEN',
            exit_price      FLOAT,
            exit_time       TIMESTAMPTZ,
            exit_reason     VARCHAR(30),
            pnl_amount      FLOAT,
            pnl_pct         FLOAT,

            top_reasons     JSONB        DEFAULT '[]',
            created_at      TIMESTAMPTZ  DEFAULT NOW()
        )
    """))
    await db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_pt_status  ON paper_trades(status);
        CREATE INDEX IF NOT EXISTS idx_pt_sym_st  ON paper_trades(symbol, status);
    """))
    await db.commit()


# ── Auto-entry logic ──────────────────────────────────────────────────────────

async def auto_enter_paper_trades(signals: list, db: AsyncSession) -> int:
    """
    Called after each screener run. Creates a paper trade for every signal
    that meets the 'perfect entry' criteria and has no existing open trade
    for that symbol.

    Returns the count of new paper trades opened.
    """
    # Symbols already in an open position → skip to avoid double-entry
    res = await db.execute(text(
        "SELECT symbol FROM paper_trades WHERE status = 'OPEN'"
    ))
    open_syms = {r[0] for r in res.fetchall()}

    created = 0
    for s in signals:
        if s.get("signal_type") not in _SIGNAL_TYPES:
            continue
        if (s.get("probability_score") or 0) < _MIN_PROB:
            continue
        if (s.get("confirmed_count") or 0) < _MIN_CONFIRMED:
            continue
        if s.get("category") not in _GOOD_CATEGORIES:
            continue
        sym = s.get("symbol", "")
        if sym in open_syms:
            continue

        entry = float(s.get("entry_price") or s.get("live_ltp") or 0)
        if entry <= 0:
            continue

        qty = max(1, int(CAPITAL_PER_TRADE / entry))

        await db.execute(text("""
            INSERT INTO paper_trades (
                symbol, exchange, signal_type, category,
                probability_score, confirmed_count,
                entry_price, target_3d, target_7d, stop_loss,
                estimated_hold_days, capital, quantity, top_reasons
            ) VALUES (
                :sym, :exch, :stype, :cat,
                :prob, :conf,
                :entry, :t3d, :t7d, :sl,
                :hold, :cap, :qty, :reasons
            )
        """), {
            "sym": sym, "exch": s.get("exchange", "NSE"),
            "stype": s.get("signal_type"), "cat": s.get("category"),
            "prob": s.get("probability_score"),
            "conf": s.get("confirmed_count", 0),
            "entry": entry,
            "t3d":  s.get("target_3d"),
            "t7d":  s.get("target_7d"),
            "sl":   s.get("stop_loss"),
            "hold": s.get("estimated_hold_days", 3),
            "cap":  CAPITAL_PER_TRADE, "qty": qty,
            "reasons": json.dumps(s.get("top_reasons") or []),
        })
        open_syms.add(sym)
        created += 1
        logger.info(
            f"📊 Paper trade ENTERED  {sym} @ ₹{entry:.2f}  "
            f"qty={qty}  prob={s.get('probability_score'):.1f}%  "
            f"cat={s.get('category')}  sl=₹{s.get('stop_loss')}  "
            f"t3d=₹{s.get('target_3d')}"
        )

    if created:
        await db.commit()
    return created


# ── Price monitor ─────────────────────────────────────────────────────────────

async def monitor_open_trades(db: AsyncSession, redis) -> int:
    """
    Called every 5 minutes during market hours.
    Checks each open paper trade against the latest Redis price.
    Closes trades that hit their 3-day target, 7-day target, stop-loss,
    or have expired past their estimated hold period.

    Returns the count of trades closed this cycle.
    """
    res = await db.execute(text("""
        SELECT id, symbol, exchange,
               entry_price, target_3d, target_7d, stop_loss,
               estimated_hold_days, capital, quantity, entry_time
        FROM paper_trades WHERE status = 'OPEN'
    """))
    open_trades = res.fetchall()
    if not open_trades:
        return 0

    now_utc = datetime.now(timezone.utc)
    closed = 0

    for t in open_trades:
        tid, sym, exch, entry, t3d, t7d, sl, hold, cap, qty, entry_time = t

        # ── Get current price (Redis primary, DB fallback) ────────────────────
        raw = await redis.get(f"quote:{exch}:{sym}")
        if raw:
            try:
                ltp = float(json.loads(raw).get("ltp", 0) or 0)
            except Exception:
                ltp = 0.0
        else:
            pr = await db.execute(text(
                "SELECT close FROM ohlcv_daily "
                "WHERE symbol=:s AND exchange=:e ORDER BY date DESC LIMIT 1"
            ), {"s": sym, "e": exch})
            row = pr.fetchone()
            ltp = float(row[0]) if row else 0.0

        if ltp <= 0:
            continue

        # ── Decide exit ───────────────────────────────────────────────────────
        reason = None
        if sl   and ltp <= float(sl):   reason = "STOP_LOSS"
        elif t3d and ltp >= float(t3d): reason = "TARGET_3D"
        elif t7d and ltp >= float(t7d): reason = "TARGET_7D"
        else:
            # Time-based expiry: hold + 3 buffer days
            if entry_time:
                et = entry_time if entry_time.tzinfo else entry_time.replace(tzinfo=timezone.utc)
                if (now_utc - et).days >= (hold or 3) + 3:
                    reason = "EXPIRED"

        if not reason:
            continue

        pnl_amt = round((ltp - float(entry)) * (qty or 1), 2)
        pnl_pct = round((ltp - float(entry)) / float(entry) * 100, 2)
        status  = "WIN" if pnl_amt >= 0 else "LOSS"

        await db.execute(text("""
            UPDATE paper_trades SET
                status      = :status,
                exit_price  = :exit,
                exit_time   = NOW(),
                exit_reason = :reason,
                pnl_amount  = :pnl_amt,
                pnl_pct     = :pnl_pct
            WHERE id = :id
        """), {
            "status": status, "exit": ltp, "reason": reason,
            "pnl_amt": pnl_amt, "pnl_pct": pnl_pct,
            "id": str(tid),
        })
        closed += 1
        logger.info(
            f"📊 Paper trade CLOSED   {sym}  [{reason}]  "
            f"entry=₹{entry:.2f}  exit=₹{ltp:.2f}  "
            f"P&L ₹{pnl_amt:+.2f} ({pnl_pct:+.2f}%)  → {status}"
        )

    if closed:
        await db.commit()
    return closed


# ── REST API ──────────────────────────────────────────────────────────────────

@router.get("/")
async def list_trades(
    status: Optional[str] = Query(default=None,
        description="OPEN | WIN | LOSS | EXPIRED"),
    limit:  int           = Query(default=100, le=500),
    db: AsyncSession = Depends(get_db),
):
    where = "WHERE status = :status" if status else ""
    res = await db.execute(text(f"""
        SELECT id, symbol, exchange, signal_type, category,
               probability_score, confirmed_count,
               entry_price, entry_time, target_3d, target_7d, stop_loss,
               estimated_hold_days, capital, quantity,
               status, exit_price, exit_time, exit_reason,
               pnl_amount, pnl_pct, top_reasons, created_at
        FROM paper_trades {where}
        ORDER BY created_at DESC
        LIMIT :limit
    """), {"status": status, "limit": limit} if status else {"limit": limit})

    trades = []
    for r in res.fetchall():
        d = dict(r._mapping)
        for k in ("entry_time", "exit_time", "created_at"):
            if d.get(k):
                d[k] = d[k].isoformat()
        # live unrealised P&L placeholder — frontend can compute from live price
        trades.append(d)
    return trades


@router.get("/summary")
async def summary(db: AsyncSession = Depends(get_db)):
    res = await db.execute(text("""
        SELECT
            COUNT(*)                                          AS total,
            COUNT(*) FILTER (WHERE status='OPEN')            AS open_count,
            COUNT(*) FILTER (WHERE status IN ('WIN','LOSS','EXPIRED')) AS closed_count,
            COUNT(*) FILTER (WHERE status='WIN')             AS wins,
            COUNT(*) FILTER (WHERE status='LOSS')            AS losses,
            ROUND(SUM(pnl_amount)  FILTER (WHERE status IN ('WIN','LOSS','EXPIRED'))::numeric, 2)
                                                             AS total_pnl,
            ROUND(AVG(pnl_pct)     FILTER (WHERE status IN ('WIN','LOSS','EXPIRED'))::numeric, 2)
                                                             AS avg_pnl_pct,
            ROUND(AVG(pnl_pct)     FILTER (WHERE status='WIN')::numeric, 2)  AS avg_win_pct,
            ROUND(AVG(pnl_pct)     FILTER (WHERE status='LOSS')::numeric, 2) AS avg_loss_pct,
            ROUND(AVG(probability_score) FILTER (WHERE status='WIN')::numeric, 1)  AS avg_prob_wins,
            ROUND(AVG(probability_score) FILTER (WHERE status='LOSS')::numeric, 1) AS avg_prob_losses
        FROM paper_trades
    """))
    d = dict(res.fetchone()._mapping)
    closed = int(d.get("closed_count") or 0)
    wins   = int(d.get("wins") or 0)
    d["win_rate"] = round(wins / closed * 100, 1) if closed > 0 else None

    # Per-category breakdown
    cat = await db.execute(text("""
        SELECT category,
               COUNT(*)                                          AS total,
               COUNT(*) FILTER (WHERE status='WIN')             AS wins,
               COUNT(*) FILTER (WHERE status='LOSS')            AS losses,
               ROUND(AVG(pnl_pct) FILTER (
                   WHERE status IN ('WIN','LOSS','EXPIRED')
               )::numeric, 2)                                    AS avg_pnl_pct
        FROM paper_trades
        WHERE status IN ('WIN','LOSS','EXPIRED')
        GROUP BY category
        ORDER BY total DESC
    """))
    d["by_category"] = [dict(r._mapping) for r in cat.fetchall()]
    return d
