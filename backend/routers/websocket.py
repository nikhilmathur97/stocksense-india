"""
WebSocket router — real-time tick data, screener signals
"""
import asyncio
import json
import logging
import sys
import os
from typing import Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

logger = logging.getLogger("websocket")
router = APIRouter(tags=["WebSocket"])


class ConnectionManager:
    """Manages active WebSocket connections and message broadcasting"""

    def __init__(self):
        self.active: Set[WebSocket] = set()
        self.symbol_subscribers: dict[str, Set[WebSocket]] = {}

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)
        logger.info(f"WS connected — {len(self.active)} active connections")

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)
        for symbol, subs in self.symbol_subscribers.items():
            subs.discard(ws)
        logger.info(f"WS disconnected — {len(self.active)} active connections")

    def subscribe_symbol(self, ws: WebSocket, symbol: str):
        if symbol not in self.symbol_subscribers:
            self.symbol_subscribers[symbol] = set()
        self.symbol_subscribers[symbol].add(ws)

    def unsubscribe_symbol(self, ws: WebSocket, symbol: str):
        if symbol in self.symbol_subscribers:
            self.symbol_subscribers[symbol].discard(ws)

    async def broadcast(self, message: dict):
        dead = set()
        for ws in self.active.copy():
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_to_symbol_subscribers(self, symbol: str, message: dict):
        subs = self.symbol_subscribers.get(symbol, set())
        dead = set()
        for ws in subs.copy():
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


# ── Shared Redis pub/sub broadcaster ─────────────────────────────────────────
# One background task per process subscribes to all Redis channels and fans
# messages out to the correct WebSocket clients.  This avoids N pub/sub
# connections (one per WS client) which was the previous design.

_broadcast_task: asyncio.Task | None = None


async def _ensure_broadcaster():
    """Start the single shared Redis→WebSocket broadcast task if not running."""
    global _broadcast_task
    if _broadcast_task and not _broadcast_task.done():
        return

    from backend.database import get_redis
    redis = await get_redis()

    async def _run():
        pubsub = redis.pubsub()
        await pubsub.subscribe("live:ticks", "screener:signals", "news:breaking")
        logger.info("Redis pub/sub broadcaster started — channels: live:ticks, screener:signals, news:breaking")
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                data = json.loads(message["data"])
                channel = message["channel"]
                msg_type = data.get("type", "")

                if channel == "live:ticks":
                    symbol = data.get("symbol", "")
                    # Broadcast tick to ALL connected clients (dashboard needs all ticks)
                    # AND to symbol-specific subscribers (stock detail pages)
                    await manager.broadcast(data)
                    if symbol:
                        await manager.send_to_symbol_subscribers(symbol, data)

                elif channel == "screener:signals" or msg_type == "signal":
                    await manager.broadcast(data)

                elif channel == "news:breaking":
                    await manager.broadcast(data)

            except Exception as e:
                logger.debug(f"Broadcaster error: {e}")

    _broadcast_task = asyncio.create_task(_run())


@router.websocket("/ws/ticks")
async def ticks_websocket(ws: WebSocket):
    """
    WebSocket endpoint for live tick data + screener signals + breaking news.

    Client sends:
      {"action": "subscribe",   "symbols": ["RELIANCE", "TCS"]}
      {"action": "unsubscribe", "symbols": ["RELIANCE"]}
      {"action": "ping"}

    Server pushes:
      {"type": "tick",      "symbol": "...", "ltp": ..., "change_pct": ..., ...}
      {"type": "signal",    "symbol": "...", "probability": ..., ...}
      {"type": "news",      "title": "...", "source": "...", ...}
      {"type": "heartbeat"}
    """
    await manager.connect(ws)
    # Ensure the shared broadcaster is running
    await _ensure_broadcaster()

    try:
        # Handle client messages (subscribe/unsubscribe/ping)
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=30.0)
                action = msg.get("action")
                symbols = msg.get("symbols", [])

                if action == "subscribe":
                    for sym in symbols:
                        manager.subscribe_symbol(ws, sym.upper())
                    await ws.send_json({"type": "subscribed", "symbols": symbols})

                elif action == "unsubscribe":
                    for sym in symbols:
                        manager.unsubscribe_symbol(ws, sym.upper())
                    await ws.send_json({"type": "unsubscribed", "symbols": symbols})

                elif action == "ping":
                    await ws.send_json({"type": "pong"})

            except asyncio.TimeoutError:
                # Send heartbeat to keep connection alive
                try:
                    await ws.send_json({"type": "heartbeat", "ts": asyncio.get_event_loop().time()})
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        manager.disconnect(ws)


@router.websocket("/ws/screener")
async def screener_websocket(ws: WebSocket):
    """
    WebSocket for real-time screener signal alerts.
    Pushes new high-probability signals as they are detected.
    """
    await manager.connect(ws)
    try:
        from backend.database import get_redis
        redis = await get_redis()
        pubsub = redis.pubsub()
        await pubsub.subscribe("screener:signals")

        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    await ws.send_json(data)
                except Exception:
                    pass

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws)
