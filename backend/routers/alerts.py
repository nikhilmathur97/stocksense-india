"""
Alerts Router — Real-Time Alert Engine API
============================================
Endpoints:
  GET  /api/alerts/history        — Get recent alert history
  GET  /api/alerts/user           — Get user-defined alerts
  POST /api/alerts/user           — Create a new user alert
  DELETE /api/alerts/user/{id}    — Delete a user alert
  PATCH /api/alerts/{id}/read     — Mark alert as read
  GET  /api/alerts/config         — Get alert engine config/status
"""
import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.database import get_redis
from backend.services.alert_engine import get_alert_engine

logger = logging.getLogger("alerts_router")

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


# ── Request Models ─────────────────────────────────────────────────────────────

class CreateAlertRequest(BaseModel):
    symbol: str = Field(..., description="Stock symbol e.g. RELIANCE")
    alert_type: str = Field(
        ...,
        pattern="^(PRICE_CROSS_ABOVE|PRICE_CROSS_BELOW|RSI_OVERBOUGHT|RSI_OVERSOLD|VOLUME_SPIKE)$",
        description="Alert type",
    )
    target_price: Optional[float] = Field(default=None, description="Target price for price cross alerts")
    rsi_threshold: Optional[float] = Field(default=None, ge=1, le=99, description="RSI threshold")
    notes: Optional[str] = Field(default=None, max_length=500)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/history")
async def get_alert_history(
    limit: int = Query(default=50, ge=1, le=200),
    symbol: Optional[str] = None,
    alert_type: Optional[str] = None,
    severity: Optional[str] = None,
    redis=Depends(get_redis),
):
    """
    Get recent alert history.
    Optionally filter by symbol, alert_type, or severity.
    """
    engine = get_alert_engine()
    if not engine:
        # Fallback: read directly from Redis
        try:
            raw_list = await redis.lrange("alert_history", 0, limit - 1)
            alerts = [json.loads(r) for r in raw_list]
        except Exception:
            alerts = []
    else:
        alerts = await engine.get_alert_history(limit=limit * 2)  # fetch extra for filtering

    # Apply filters
    if symbol:
        alerts = [a for a in alerts if a.get("symbol", "").upper() == symbol.upper()]
    if alert_type:
        alerts = [a for a in alerts if a.get("alert_type") == alert_type]
    if severity:
        alerts = [a for a in alerts if a.get("severity") == severity.upper()]

    return {
        "alerts": alerts[:limit],
        "total": len(alerts),
        "unread": sum(1 for a in alerts if not a.get("read", False)),
    }


@router.get("/user")
async def get_user_alerts(redis=Depends(get_redis)):
    """Get all user-defined alerts (active + triggered)"""
    engine = get_alert_engine()
    if engine:
        alerts = await engine.get_user_alerts()
    else:
        raw = await redis.get("user_alerts")
        alerts = json.loads(raw) if raw else []

    active = [a for a in alerts if not a.get("triggered")]
    triggered = [a for a in alerts if a.get("triggered")]

    return {
        "alerts": alerts,
        "active_count": len(active),
        "triggered_count": len(triggered),
    }


@router.post("/user")
async def create_user_alert(
    req: CreateAlertRequest,
    redis=Depends(get_redis),
):
    """
    Create a new user-defined alert.
    - PRICE_CROSS_ABOVE/BELOW: requires target_price
    - RSI_OVERBOUGHT/OVERSOLD: optional rsi_threshold (defaults 70/30)
    - VOLUME_SPIKE: fires when volume > 3× average
    """
    # Validate
    if req.alert_type in ("PRICE_CROSS_ABOVE", "PRICE_CROSS_BELOW") and not req.target_price:
        raise HTTPException(
            status_code=400,
            detail="target_price is required for PRICE_CROSS alerts",
        )

    engine = get_alert_engine()
    if engine:
        alert = await engine.add_user_alert(
            symbol=req.symbol,
            alert_type=req.alert_type,
            target_price=req.target_price,
            rsi_threshold=req.rsi_threshold,
            notes=req.notes,
        )
    else:
        # Direct Redis fallback
        from datetime import datetime
        raw = await redis.get("user_alerts")
        alerts = json.loads(raw) if raw else []
        alert = {
            "id": f"UA{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "symbol": req.symbol.upper(),
            "alert_type": req.alert_type,
            "target_price": req.target_price,
            "rsi_threshold": req.rsi_threshold,
            "notes": req.notes or "",
            "triggered": False,
            "triggered_at": None,
            "created_at": datetime.now().isoformat(),
        }
        alerts.append(alert)
        await redis.set("user_alerts", json.dumps(alerts))

    return {"success": True, "alert": alert}


@router.delete("/user/{alert_id}")
async def delete_user_alert(alert_id: str, redis=Depends(get_redis)):
    """Delete a user-defined alert by ID"""
    engine = get_alert_engine()
    if engine:
        deleted = await engine.delete_user_alert(alert_id)
    else:
        raw = await redis.get("user_alerts")
        alerts = json.loads(raw) if raw else []
        original_len = len(alerts)
        alerts = [a for a in alerts if a.get("id") != alert_id]
        deleted = len(alerts) < original_len
        if deleted:
            await redis.set("user_alerts", json.dumps(alerts))

    if not deleted:
        raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")

    return {"success": True, "deleted": alert_id}


@router.patch("/{alert_id}/read")
async def mark_alert_read(alert_id: str, redis=Depends(get_redis)):
    """Mark an alert as read"""
    engine = get_alert_engine()
    if engine:
        found = await engine.mark_alert_read(alert_id)
    else:
        found = False

    return {"success": found, "alert_id": alert_id}


@router.get("/config")
async def get_alert_config(redis=Depends(get_redis)):
    """Get alert engine configuration and status"""
    engine = get_alert_engine()
    is_running = engine._running if engine else False

    return {
        "engine_running": is_running,
        "poll_interval_seconds": 5,
        "cooldown_seconds": 300,
        "max_history": 500,
        "alert_types": [
            {"type": "PRICE_CROSS_ABOVE", "description": "Price crosses above target", "requires": "target_price"},
            {"type": "PRICE_CROSS_BELOW", "description": "Price crosses below target", "requires": "target_price"},
            {"type": "RSI_OVERBOUGHT", "description": "RSI exceeds 70 (auto)", "auto": True},
            {"type": "RSI_OVERSOLD", "description": "RSI drops below 30 (auto)", "auto": True},
            {"type": "VOLUME_SPIKE", "description": "Volume > 3× average (auto)", "auto": True},
            {"type": "PATTERN_DETECTED", "description": "Candlestick pattern detected (auto)", "auto": True},
            {"type": "MACD_CROSSOVER", "description": "MACD bullish/bearish crossover (auto)", "auto": True},
            {"type": "SUPERTREND_FLIP", "description": "Supertrend direction change (auto)", "auto": True},
            {"type": "PRICE_NEAR_SUPPORT", "description": "Price near pivot/fib support (auto)", "auto": True},
            {"type": "CIRCUIT_BREAKER", "description": "Stock hits circuit limit (auto)", "auto": True},
        ],
        "severity_levels": ["HIGH", "MEDIUM", "LOW"],
    }
