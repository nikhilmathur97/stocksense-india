"""
Real-Time Alert Engine — Professional Grade
=============================================
Monitors live market data and fires alerts when conditions are met.

Alert Types:
  PRICE_CROSS_ABOVE   — Price crosses above a target level
  PRICE_CROSS_BELOW   — Price crosses below a target level
  RSI_OVERBOUGHT      — RSI > 70 (configurable)
  RSI_OVERSOLD        — RSI < 30 (configurable)
  VOLUME_SPIKE        — Volume > N× 20-day average
  PATTERN_DETECTED    — Candlestick pattern detected (Hammer, Engulfing, etc.)
  MACD_CROSSOVER      — MACD bullish/bearish crossover
  SUPERTREND_FLIP     — Supertrend direction changes
  PRICE_NEAR_SUPPORT  — Price within 1% of key support (Pivot/Fib)
  CIRCUIT_BREAKER     — Stock hits upper/lower circuit

Architecture:
  - AlertEngine runs as a background asyncio task in main.py lifespan
  - Polls Redis for live quotes every 5 seconds
  - Fires alerts via Redis pub/sub channel "alerts"
  - Alerts also stored in Redis list "alert_history" (last 500)
  - WebSocket clients subscribe to "alerts" channel for real-time delivery
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger("alert_engine")

# ── Alert Type Constants ───────────────────────────────────────────────────────
PRICE_CROSS_ABOVE = "PRICE_CROSS_ABOVE"
PRICE_CROSS_BELOW = "PRICE_CROSS_BELOW"
RSI_OVERBOUGHT = "RSI_OVERBOUGHT"
RSI_OVERSOLD = "RSI_OVERSOLD"
VOLUME_SPIKE = "VOLUME_SPIKE"
PATTERN_DETECTED = "PATTERN_DETECTED"
MACD_CROSSOVER = "MACD_CROSSOVER"
SUPERTREND_FLIP = "SUPERTREND_FLIP"
PRICE_NEAR_SUPPORT = "PRICE_NEAR_SUPPORT"
CIRCUIT_BREAKER = "CIRCUIT_BREAKER"

# Alert severity
SEVERITY_HIGH = "HIGH"
SEVERITY_MEDIUM = "MEDIUM"
SEVERITY_LOW = "LOW"

# Redis keys
ALERT_CHANNEL = "alerts"
ALERT_HISTORY_KEY = "alert_history"
USER_ALERTS_KEY = "user_alerts"
ALERT_STATE_KEY = "alert_engine_state"

MAX_HISTORY = 500
POLL_INTERVAL = 5  # seconds


class AlertEngine:
    """
    Background service that monitors live quotes and fires alerts.
    Runs as a single asyncio task — no threads needed.
    """

    def __init__(self, redis_client):
        self.redis = redis_client
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._fired_cache: Dict[str, float] = {}  # alert_key → last_fired_ts
        self._cooldown_seconds = 300  # 5 min cooldown per alert to avoid spam
        self._prev_prices: Dict[str, float] = {}  # for crossover detection
        self._prev_supertrend: Dict[str, int] = {}  # for flip detection
        self._prev_macd_hist: Dict[str, float] = {}  # for MACD crossover

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    async def start(self):
        """Start the alert engine background task"""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop(), name="alert-engine")
        logger.info("✅ Alert engine started")

    async def stop(self):
        """Stop the alert engine"""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Alert engine stopped")

    async def _run_loop(self):
        """Main polling loop — runs every POLL_INTERVAL seconds"""
        logger.info(f"Alert engine polling every {POLL_INTERVAL}s")
        while self._running:
            try:
                await self._check_all_alerts()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Alert engine error: {e}", exc_info=True)
            await asyncio.sleep(POLL_INTERVAL)

    # ── Core Alert Checker ─────────────────────────────────────────────────────

    async def _check_all_alerts(self):
        """Check all alert conditions for all monitored symbols"""
        # 1. Check user-defined price alerts
        await self._check_user_alerts()

        # 2. Check automatic system alerts (RSI, volume, patterns, etc.)
        await self._check_system_alerts()

    async def _check_user_alerts(self):
        """Check user-defined price cross alerts"""
        try:
            raw = await self.redis.get(USER_ALERTS_KEY)
            if not raw:
                return
            user_alerts: List[Dict] = json.loads(raw)

            for alert in user_alerts:
                if alert.get("triggered"):
                    continue

                sym = alert.get("symbol", "").upper()
                alert_type = alert.get("alert_type")
                target = float(alert.get("target_price", 0))

                # Get current price
                quote = await self.redis.get(f"quote:{sym}")
                if not quote:
                    continue
                data = json.loads(quote)
                ltp = float(data.get("ltp", 0) or 0)
                if ltp <= 0:
                    continue

                prev_price = self._prev_prices.get(sym, ltp)
                triggered = False
                message = ""

                if alert_type == PRICE_CROSS_ABOVE and prev_price < target <= ltp:
                    triggered = True
                    message = f"{sym} crossed ABOVE ₹{target:,.2f} (LTP: ₹{ltp:,.2f})"
                elif alert_type == PRICE_CROSS_BELOW and prev_price > target >= ltp:
                    triggered = True
                    message = f"{sym} crossed BELOW ₹{target:,.2f} (LTP: ₹{ltp:,.2f})"

                if triggered:
                    await self._fire_alert(
                        symbol=sym,
                        alert_type=alert_type,
                        message=message,
                        severity=SEVERITY_HIGH,
                        data={"ltp": ltp, "target": target, "change_pct": data.get("change_pct", 0)},
                        alert_id=alert.get("id"),
                    )
                    # Mark as triggered
                    alert["triggered"] = True
                    alert["triggered_at"] = datetime.now().isoformat()
                    alert["triggered_price"] = ltp

                self._prev_prices[sym] = ltp

            # Save updated alerts
            await self.redis.set(USER_ALERTS_KEY, json.dumps(user_alerts))

        except Exception as e:
            logger.debug(f"User alert check error: {e}")

    async def _check_system_alerts(self):
        """Check automatic system-wide alerts for all active symbols"""
        try:
            # Get all quote keys
            all_keys = await self.redis.keys("quote:*")
            if not all_keys:
                return

            # Process in batches to avoid blocking
            batch_size = 50
            for i in range(0, len(all_keys), batch_size):
                batch = all_keys[i:i + batch_size]
                await asyncio.gather(
                    *[self._check_symbol_alerts(key) for key in batch],
                    return_exceptions=True,
                )

        except Exception as e:
            logger.debug(f"System alert check error: {e}")

    async def _check_symbol_alerts(self, quote_key: str):
        """Check all alert conditions for a single symbol"""
        try:
            raw = await self.redis.get(quote_key)
            if not raw:
                return
            data = json.loads(raw)

            # Handle both "quote:SYMBOL" and "quote:NSE:SYMBOL" key formats
            key_str = quote_key if isinstance(quote_key, str) else quote_key.decode()
            sym = key_str.replace("quote:", "").replace("NSE:", "").replace("BSE:", "")
            if not sym or len(sym) < 2:
                return

            ltp = float(data.get("ltp", 0) or 0)
            if ltp <= 0:
                return

            change_pct = float(data.get("change_pct", 0) or 0)

            # Get indicators for this symbol
            ind_raw = await self.redis.get(f"indicators:{sym}")
            ind: Dict = json.loads(ind_raw) if ind_raw else {}

            # ── RSI Alerts ─────────────────────────────────────────────────────
            rsi = float(ind.get("rsi_14", 50) or 50)
            if rsi >= 75:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=RSI_OVERBOUGHT,
                    message=f"{sym} RSI overbought: {rsi:.1f} — potential reversal",
                    severity=SEVERITY_MEDIUM,
                    data={"rsi": rsi, "ltp": ltp},
                )
            elif rsi <= 25:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=RSI_OVERSOLD,
                    message=f"{sym} RSI oversold: {rsi:.1f} — potential bounce",
                    severity=SEVERITY_MEDIUM,
                    data={"rsi": rsi, "ltp": ltp},
                )

            # ── Volume Spike Alert ─────────────────────────────────────────────
            vol_ratio = float(ind.get("volume_ratio", 1.0) or 1.0)
            if vol_ratio >= 3.0:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=VOLUME_SPIKE,
                    message=f"{sym} volume spike: {vol_ratio:.1f}× average — institutional activity",
                    severity=SEVERITY_HIGH,
                    data={"volume_ratio": vol_ratio, "ltp": ltp, "change_pct": change_pct},
                )
            elif vol_ratio >= 2.0:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=VOLUME_SPIKE,
                    message=f"{sym} above-average volume: {vol_ratio:.1f}× — watch for breakout",
                    severity=SEVERITY_LOW,
                    data={"volume_ratio": vol_ratio, "ltp": ltp},
                )

            # ── Candlestick Pattern Alert ──────────────────────────────────────
            pattern = ind.get("candlestick_pattern")
            candle_signal = ind.get("candlestick_signal", "NEUTRAL")
            if pattern and candle_signal in ("STRONG_BUY", "BUY", "STRONG_SELL", "SELL"):
                severity = SEVERITY_HIGH if "STRONG" in candle_signal else SEVERITY_MEDIUM
                direction = "bullish" if "BUY" in candle_signal else "bearish"
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=PATTERN_DETECTED,
                    message=f"{sym} {direction} pattern: {pattern} (LTP: ₹{ltp:,.2f})",
                    severity=severity,
                    data={"pattern": pattern, "signal": candle_signal, "ltp": ltp},
                )

            # ── MACD Crossover Alert ───────────────────────────────────────────
            macd_hist = float(ind.get("macd_hist", 0) or 0)
            prev_hist = self._prev_macd_hist.get(sym, macd_hist)

            if prev_hist <= 0 < macd_hist:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=MACD_CROSSOVER,
                    message=f"{sym} MACD bullish crossover — fresh buy signal",
                    severity=SEVERITY_HIGH,
                    data={"macd_hist": macd_hist, "ltp": ltp, "direction": "BULLISH"},
                )
            elif prev_hist >= 0 > macd_hist:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=MACD_CROSSOVER,
                    message=f"{sym} MACD bearish crossover — sell signal",
                    severity=SEVERITY_HIGH,
                    data={"macd_hist": macd_hist, "ltp": ltp, "direction": "BEARISH"},
                )
            self._prev_macd_hist[sym] = macd_hist

            # ── Supertrend Flip Alert ──────────────────────────────────────────
            st_dir = int(ind.get("supertrend_direction", 0) or 0)
            prev_st = self._prev_supertrend.get(sym, st_dir)

            if prev_st == -1 and st_dir == 1:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=SUPERTREND_FLIP,
                    message=f"{sym} Supertrend flipped BULLISH — trend reversal confirmed",
                    severity=SEVERITY_HIGH,
                    data={"direction": "BULLISH", "ltp": ltp},
                )
            elif prev_st == 1 and st_dir == -1:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=SUPERTREND_FLIP,
                    message=f"{sym} Supertrend flipped BEARISH — exit long positions",
                    severity=SEVERITY_HIGH,
                    data={"direction": "BEARISH", "ltp": ltp},
                )
            self._prev_supertrend[sym] = st_dir

            # ── Circuit Breaker Alert ──────────────────────────────────────────
            if change_pct >= 4.8:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=CIRCUIT_BREAKER,
                    message=f"{sym} hitting UPPER circuit ({change_pct:.1f}%) — trading may be restricted",
                    severity=SEVERITY_HIGH,
                    data={"change_pct": change_pct, "ltp": ltp, "direction": "UPPER"},
                )
            elif change_pct <= -4.8:
                await self._maybe_fire(
                    symbol=sym,
                    alert_type=CIRCUIT_BREAKER,
                    message=f"{sym} hitting LOWER circuit ({change_pct:.1f}%) — panic selling",
                    severity=SEVERITY_HIGH,
                    data={"change_pct": change_pct, "ltp": ltp, "direction": "LOWER"},
                )

            # ── Price Near Support Alert ───────────────────────────────────────
            pivot = ind.get("pivot_classic_p")
            s1 = ind.get("pivot_classic_s1")
            fib_support = ind.get("fib_nearest_support")

            for support_level, label in [(pivot, "Pivot"), (s1, "S1"), (fib_support, "Fib Support")]:
                if support_level and abs(ltp - support_level) / ltp < 0.005:
                    await self._maybe_fire(
                        symbol=sym,
                        alert_type=PRICE_NEAR_SUPPORT,
                        message=f"{sym} near {label} support ₹{support_level:,.2f} — potential bounce zone",
                        severity=SEVERITY_MEDIUM,
                        data={"support": support_level, "label": label, "ltp": ltp},
                    )
                    break  # only one support alert per cycle

        except Exception as e:
            logger.debug(f"Symbol alert check error for {quote_key}: {e}")

    # ── Alert Firing ───────────────────────────────────────────────────────────

    async def _maybe_fire(
        self,
        symbol: str,
        alert_type: str,
        message: str,
        severity: str,
        data: Dict,
    ):
        """Fire alert only if not in cooldown period"""
        cooldown_key = f"{symbol}:{alert_type}"
        last_fired = self._fired_cache.get(cooldown_key, 0)
        now = datetime.now().timestamp()

        if now - last_fired < self._cooldown_seconds:
            return  # still in cooldown

        self._fired_cache[cooldown_key] = now
        await self._fire_alert(symbol, alert_type, message, severity, data)

    async def _fire_alert(
        self,
        symbol: str,
        alert_type: str,
        message: str,
        severity: str,
        data: Dict,
        alert_id: Optional[str] = None,
    ):
        """Publish alert to Redis pub/sub and store in history"""
        alert = {
            "id": alert_id or f"AL{datetime.now().strftime('%Y%m%d%H%M%S%f')[:18]}",
            "symbol": symbol,
            "alert_type": alert_type,
            "message": message,
            "severity": severity,
            "data": data,
            "timestamp": datetime.now().isoformat(),
            "read": False,
        }

        alert_json = json.dumps(alert)

        try:
            # Publish to Redis pub/sub for WebSocket delivery
            await self.redis.publish(ALERT_CHANNEL, alert_json)

            # Store in history (LPUSH + LTRIM to keep last MAX_HISTORY)
            await self.redis.lpush(ALERT_HISTORY_KEY, alert_json)
            await self.redis.ltrim(ALERT_HISTORY_KEY, 0, MAX_HISTORY - 1)

            logger.info(f"🔔 Alert [{severity}] {symbol}: {message}")

        except Exception as e:
            logger.error(f"Failed to fire alert: {e}")

    # ── User Alert Management ──────────────────────────────────────────────────

    async def add_user_alert(
        self,
        symbol: str,
        alert_type: str,
        target_price: Optional[float] = None,
        rsi_threshold: Optional[float] = None,
        notes: Optional[str] = None,
    ) -> Dict:
        """Add a user-defined alert"""
        raw = await self.redis.get(USER_ALERTS_KEY)
        alerts: List[Dict] = json.loads(raw) if raw else []

        alert_id = f"UA{datetime.now().strftime('%Y%m%d%H%M%S%f')[:18]}"
        new_alert = {
            "id": alert_id,
            "symbol": symbol.upper(),
            "alert_type": alert_type,
            "target_price": target_price,
            "rsi_threshold": rsi_threshold,
            "notes": notes or "",
            "triggered": False,
            "triggered_at": None,
            "triggered_price": None,
            "created_at": datetime.now().isoformat(),
        }

        alerts.append(new_alert)
        # Keep last 200 user alerts
        if len(alerts) > 200:
            alerts = alerts[-200:]

        await self.redis.set(USER_ALERTS_KEY, json.dumps(alerts))
        return new_alert

    async def delete_user_alert(self, alert_id: str) -> bool:
        """Delete a user-defined alert by ID"""
        raw = await self.redis.get(USER_ALERTS_KEY)
        if not raw:
            return False
        alerts: List[Dict] = json.loads(raw)
        original_len = len(alerts)
        alerts = [a for a in alerts if a["id"] != alert_id]
        if len(alerts) < original_len:
            await self.redis.set(USER_ALERTS_KEY, json.dumps(alerts))
            return True
        return False

    async def get_alert_history(self, limit: int = 50) -> List[Dict]:
        """Get recent alert history"""
        try:
            raw_list = await self.redis.lrange(ALERT_HISTORY_KEY, 0, limit - 1)
            return [json.loads(r) for r in raw_list]
        except Exception:
            return []

    async def get_user_alerts(self) -> List[Dict]:
        """Get all user-defined alerts"""
        try:
            raw = await self.redis.get(USER_ALERTS_KEY)
            return json.loads(raw) if raw else []
        except Exception:
            return []

    async def mark_alert_read(self, alert_id: str) -> bool:
        """Mark an alert as read in history"""
        try:
            raw_list = await self.redis.lrange(ALERT_HISTORY_KEY, 0, MAX_HISTORY - 1)
            updated = []
            found = False
            for raw in raw_list:
                alert = json.loads(raw)
                if alert.get("id") == alert_id:
                    alert["read"] = True
                    found = True
                updated.append(json.dumps(alert))

            if found:
                # Rebuild the list
                await self.redis.delete(ALERT_HISTORY_KEY)
                if updated:
                    await self.redis.rpush(ALERT_HISTORY_KEY, *updated)
            return found
        except Exception:
            return False


# ── Singleton Instance ─────────────────────────────────────────────────────────
# Created in main.py lifespan and injected via dependency

_alert_engine_instance: Optional[AlertEngine] = None


def get_alert_engine() -> Optional[AlertEngine]:
    return _alert_engine_instance


def set_alert_engine(engine: AlertEngine):
    global _alert_engine_instance
    _alert_engine_instance = engine
