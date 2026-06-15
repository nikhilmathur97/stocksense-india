"""
Angel One SmartAPI — READ-ONLY Data Fetcher
============================================
PURPOSE: Real-time market data ONLY (quotes, OHLCV, options chain, WebSocket ticks).
STRICTLY PROHIBITED: Order placement, trade execution, position management of any kind.
This module must NEVER call: placeOrder, modifyOrder, cancelOrder, getPosition,
getOrderBook, getTradeBook, or any brokerage/execution API on SmartConnect.
All trading decisions are made manually by the user based on AI analysis output.
"""

import os
import json
import time
import logging
import asyncio
import threading
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from functools import wraps

import pyotp
import redis
import schedule
from SmartApi import SmartConnect
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
from dotenv import load_dotenv

load_dotenv()

# ── Logging Setup ────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("angel_one")

# ── Redis Client ─────────────────────────────────────────────────────────────
redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    password=os.getenv("REDIS_PASSWORD", ""),
    decode_responses=True,
)

# ── Constants ────────────────────────────────────────────────────────────────
TOKEN_KEY = "angel_one:auth_token"
FEED_TOKEN_KEY = "angel_one:feed_token"
TOKEN_TTL = 86400  # 24 hours in seconds

# Exchange codes
NSE = "NSE"
BSE = "BSE"
NFO = "NFO"  # NSE F&O

# Interval mapping for historical data
INTERVAL_MAP = {
    "1m": "ONE_MINUTE",
    "3m": "THREE_MINUTE",
    "5m": "FIVE_MINUTE",
    "10m": "TEN_MINUTE",
    "15m": "FIFTEEN_MINUTE",
    "30m": "THIRTY_MINUTE",
    "1h": "ONE_HOUR",
    "1d": "ONE_DAY",
}


# ── Retry Decorator ──────────────────────────────────────────────────────────
def retry(max_attempts: int = 3, delay: float = 1.0, backoff: float = 2.0):
    """Retry decorator with exponential backoff"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            attempt = 0
            current_delay = delay
            while attempt < max_attempts:
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    attempt += 1
                    if attempt == max_attempts:
                        logger.error(f"[{func.__name__}] Failed after {max_attempts} attempts: {e}")
                        raise
                    logger.warning(f"[{func.__name__}] Attempt {attempt} failed: {e}. Retrying in {current_delay}s...")
                    time.sleep(current_delay)
                    current_delay *= backoff
        return wrapper
    return decorator


# ── Angel One Session Manager ────────────────────────────────────────────────
class AngelOneSession:
    """Manages Angel One SmartAPI authentication and session lifecycle"""

    def __init__(self):
        self.api_key = os.getenv("ANGEL_ONE_API_KEY")
        self.client_code = os.getenv("ANGEL_ONE_CLIENT_CODE")
        self.password = os.getenv("ANGEL_ONE_PASSWORD")
        self.totp_secret = os.getenv("ANGEL_ONE_TOTP_SECRET")
        self.smart_api: Optional[SmartConnect] = None
        self.auth_token: Optional[str] = None
        self.feed_token: Optional[str] = None
        self._lock = threading.Lock()

    @retry(max_attempts=3, delay=2.0)
    def login(self) -> bool:
        """Generate new session with TOTP authentication"""
        with self._lock:
            try:
                logger.info("Logging into Angel One SmartAPI...")
                totp = pyotp.TOTP(self.totp_secret).now()
                self.smart_api = SmartConnect(api_key=self.api_key)
                data = self.smart_api.generateSession(
                    self.client_code, self.password, totp
                )

                if data.get("status") and data["data"]:
                    self.auth_token = data["data"]["jwtToken"]
                    self.feed_token = data["data"]["feedToken"]

                    # Store tokens in Redis with TTL
                    redis_client.setex(TOKEN_KEY, TOKEN_TTL, self.auth_token)
                    redis_client.setex(FEED_TOKEN_KEY, TOKEN_TTL, self.feed_token)

                    logger.info("✅ Angel One login successful")
                    return True
                else:
                    logger.error(f"Login failed: {data.get('message', 'Unknown error')}")
                    return False

            except Exception as e:
                logger.error(f"Login exception: {e}")
                raise

    def get_session(self) -> SmartConnect:
        """Get active session, refreshing if needed"""
        # Check Redis for valid token
        cached_token = redis_client.get(TOKEN_KEY)
        if cached_token and self.smart_api:
            self.auth_token = cached_token
            return self.smart_api

        # Token expired or missing — re-login
        logger.info("Session expired, re-authenticating...")
        self.login()
        return self.smart_api

    def auto_refresh(self):
        """Schedule token refresh every 23 hours"""
        schedule.every(23).hours.do(self.login)
        logger.info("Token auto-refresh scheduled every 23 hours")

        def run_scheduler():
            while True:
                schedule.run_pending()
                time.sleep(60)

        thread = threading.Thread(target=run_scheduler, daemon=True)
        thread.start()


# ── Singleton Session ────────────────────────────────────────────────────────
_session = AngelOneSession()


def get_smart_api() -> SmartConnect:
    """Get authenticated SmartAPI instance"""
    return _session.get_session()


def initialize():
    """Initialize Angel One connection on startup"""
    _session.login()
    _session.auto_refresh()


# ── Data Fetcher Functions ───────────────────────────────────────────────────

def get_live_quote(symbol: str, exchange: str = NSE, token: str = None) -> Dict[str, Any]:
    """
    Get live quote for a stock using Angel One getMarketData (FULL mode).
    Falls back to ltpData if getMarketData is unavailable.
    Returns: LTP, open, high, low, volume, % change
    No retry decorator — callers handle timeouts externally.
    """
    cache_key = f"quote:{exchange}:{symbol}"
    cached = redis_client.get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            pass

    try:
        api = get_smart_api()
        sym_token = token or _get_symbol_token(symbol, exchange)
        trading_symbol = f"{symbol}-EQ" if exchange == NSE else symbol

        # ── Try getMarketData (FULL) — returns OHLCV + LTP + change ─────────
        try:
            data = api.getMarketData(
                "FULL",
                {exchange: [sym_token]} if sym_token else {},
            )
            if data and data.get("status") and data.get("data"):
                fetched = data["data"].get("fetched", [])
                if fetched:
                    item = fetched[0]
                    ltp = float(item.get("ltp", 0))
                    close = float(item.get("close", 0))
                    change = round(ltp - close, 2) if close else 0.0
                    change_pct = round(change / close * 100, 2) if close else 0.0
                    result = {
                        "symbol": symbol,
                        "exchange": exchange,
                        "ltp": ltp,
                        "open": float(item.get("open", 0)),
                        "high": float(item.get("high", 0)),
                        "low": float(item.get("low", 0)),
                        "close": close,
                        "volume": int(item.get("tradeVolume", 0)),
                        "change": change,
                        "change_pct": change_pct,
                        "52w_high": float(item.get("52WeekHighPrice", 0)),
                        "52w_low": float(item.get("52WeekLowPrice", 0)),
                        "timestamp": datetime.now().isoformat(),
                    }
                    if ltp > 0:
                        redis_client.setex(cache_key, 15, json.dumps(result))
                        return result
        except Exception as e1:
            logger.debug(f"getMarketData failed for {symbol}: {e1}")

        # ── Fallback: ltpData ─────────────────────────────────────────────────
        if sym_token:
            try:
                ltp_resp = api.ltpData(exchange, trading_symbol, sym_token)
                if ltp_resp and ltp_resp.get("status") and ltp_resp.get("data"):
                    ltp = float(ltp_resp["data"].get("ltp", 0))
                    if ltp > 0:
                        result = {
                            "symbol": symbol,
                            "exchange": exchange,
                            "ltp": ltp,
                            "open": 0.0, "high": 0.0, "low": 0.0, "close": 0.0,
                            "volume": 0,
                            "change": 0.0, "change_pct": 0.0,
                            "52w_high": 0.0, "52w_low": 0.0,
                            "timestamp": datetime.now().isoformat(),
                        }
                        redis_client.setex(cache_key, 15, json.dumps(result))
                        return result
            except Exception as e2:
                logger.debug(f"ltpData failed for {symbol}: {e2}")

        logger.warning(f"No live quote available for {symbol} on {exchange}")
        return {}

    except Exception as e:
        logger.error(f"Error fetching quote for {symbol}: {e}")
        return {}


@retry(max_attempts=3, delay=1.0)
def get_historical_ohlcv(
    symbol: str,
    exchange: str = NSE,
    interval: str = "1d",
    from_date: str = None,
    to_date: str = None,
    token: str = None,
) -> List[Dict[str, Any]]:
    """
    Get historical OHLCV candlestick data.
    interval: 1m, 3m, 5m, 10m, 15m, 30m, 1h, 1d
    from_date/to_date: "YYYY-MM-DD HH:MM"
    """
    if not from_date:
        from_date = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d 09:15")
    if not to_date:
        to_date = datetime.now().strftime("%Y-%m-%d 15:30")

    cache_key = f"hist:{exchange}:{symbol}:{interval}:{from_date[:10]}"
    if interval in ["1d", "1h"]:  # Cache longer intervals
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    try:
        api = get_smart_api()
        trading_symbol = f"{symbol}-EQ" if exchange == NSE else symbol

        params = {
            "exchange": exchange,
            "symboltoken": token or _get_symbol_token(symbol, exchange),
            "interval": INTERVAL_MAP.get(interval, "ONE_DAY"),
            "fromdate": from_date,
            "todate": to_date,
            "tradingsymbol": trading_symbol,
        }

        data = api.getCandleData(params)

        if data and data.get("status") and data.get("data"):
            candles = []
            for candle in data["data"]:
                # Format: [timestamp, open, high, low, close, volume]
                candles.append({
                    "time": candle[0],
                    "open": float(candle[1]),
                    "high": float(candle[2]),
                    "low": float(candle[3]),
                    "close": float(candle[4]),
                    "volume": int(candle[5]),
                })

            # Cache daily data for 1 hour
            if interval == "1d":
                redis_client.setex(cache_key, 3600, json.dumps(candles))

            return candles

        logger.warning(f"No historical data for {symbol}: {data.get('message')}")
        return []

    except Exception as e:
        logger.error(f"Error fetching historical data for {symbol}: {e}")
        raise


def get_options_chain(symbol: str, expiry_date: str = None) -> Dict[str, Any]:
    """
    Get full options chain for a symbol (CE + PE data).

    Angel One SmartConnect v1 does NOT expose getOptionGreeks.
    Available methods: getMarketData(mode, exchangeTokens) and ltpData.
    To fetch a full NFO options chain we need pre-resolved symbol tokens for
    every CE/PE strike — which requires a separate token master file lookup.

    Strategy:
      1. Check Redis cache (populated by pipeline/scheduler if running).
      2. Attempt getMarketData on NFO with known NIFTY option tokens from cache.
      3. If unavailable, raise so callers can fall back to mock data.
    """
    cache_key = f"options:{symbol}:{expiry_date or 'current'}"
    cached = redis_client.get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            pass

    # Try to fetch underlying spot price via ltpData for context
    try:
        api = get_smart_api()
        # Map symbol to NSE equity token for spot price
        spot_token_map = {
            "NIFTY 50": ("NSE", "Nifty 50", "99926000"),
            "NIFTY": ("NSE", "Nifty 50", "99926000"),
            "BANKNIFTY": ("NSE", "Nifty Bank", "99926009"),
            "FINNIFTY": ("NSE", "Nifty Fin Service", "99926037"),
        }
        sym_upper = symbol.upper()
        if sym_upper in spot_token_map:
            exch, ts, tok = spot_token_map[sym_upper]
            ltp_resp = api.ltpData(exch, ts, tok)
            if ltp_resp and ltp_resp.get("status") and ltp_resp.get("data"):
                spot = float(ltp_resp["data"].get("ltp", 0))
                if spot > 0:
                    # Cache the spot so mock generator uses real price
                    redis_client.setex(f"quote:NSE:{sym_upper.replace(' ', '')}", 10,
                                       json.dumps({"ltp": spot, "symbol": sym_upper}))
    except Exception as spot_err:
        logger.debug(f"Spot price fetch failed for {symbol}: {spot_err}")

    # Full NFO chain requires token master — not available without it
    raise NotImplementedError(
        f"Full NFO options chain for {symbol} requires token master lookup. "
        "Falling back to mock data with live spot price."
    )


def get_market_status() -> Dict[str, Any]:
    """Check if NSE/BSE market is currently open (always uses IST)"""
    from datetime import timezone as _tz
    utc_now = datetime.now(_tz.utc)
    # Convert to IST = UTC + 5:30
    ist_offset = timedelta(hours=5, minutes=30)
    now = utc_now + ist_offset

    ist_time = now.hour * 60 + now.minute
    market_open = 9 * 60 + 15   # 9:15 AM IST
    market_close = 15 * 60 + 30  # 3:30 PM IST
    is_weekday = now.weekday() < 5  # Monday=0, Friday=4

    is_open = is_weekday and market_open <= ist_time <= market_close

    return {
        "nse": {"open": is_open, "status": "OPEN" if is_open else "CLOSED"},
        "bse": {"open": is_open, "status": "OPEN" if is_open else "CLOSED"},
        "timestamp": now.isoformat(),
        "market_open_time": "09:15 IST",
        "market_close_time": "15:30 IST",
        "next_open": _get_next_market_open(now),
    }


@retry(max_attempts=3, delay=1.0)
def search_symbol(query: str, exchange: str = None) -> List[Dict[str, Any]]:
    """
    Search for stocks by name or symbol via Angel One searchScrip API.
    When no exchange is specified, searches both NSE and BSE and merges results.
    """
    exchanges_to_search = [exchange] if exchange else ["NSE", "BSE"]
    all_results: List[Dict[str, Any]] = []
    seen_syms: set = set()

    for exch in exchanges_to_search:
        cache_key = f"angel_search:{query.upper()}:{exch.upper()}"
        cached = redis_client.get(cache_key)
        if cached:
            for item in json.loads(cached):
                key = f"{item.get('symbol')}:{item.get('exchange')}"
                if key not in seen_syms:
                    seen_syms.add(key)
                    all_results.append(item)
            continue

        try:
            api = get_smart_api()
            data = api.searchScrip(exch, query.upper())

            if data and data.get("status") and data.get("data"):
                results = []
                for item in data["data"][:15]:
                    sym = item.get("tradingsymbol", "").replace("-EQ", "").strip()
                    if not sym:
                        continue
                    entry = {
                        "symbol": sym,
                        "name": item.get("name", sym),
                        "exchange": item.get("exch_seg", exch),
                        "token": item.get("symboltoken", ""),
                        "instrument_type": item.get("instrumenttype", "EQ"),
                    }
                    results.append(entry)
                    key = f"{sym}:{entry['exchange']}"
                    if key not in seen_syms:
                        seen_syms.add(key)
                        all_results.append(entry)

                if results:
                    redis_client.setex(cache_key, 300, json.dumps(results))

        except Exception as e:
            logger.error(f"Error searching symbol '{query}' on {exch}: {e}")

    return all_results[:30]


@retry(max_attempts=3, delay=1.0)
def get_bulk_quotes(symbols: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """
    Fetch quotes for multiple symbols at once.
    symbols: [{"exchange": "NSE", "tradingsymbol": "RELIANCE-EQ", "symboltoken": "2885"}]
    """
    try:
        api = get_smart_api()
        data = api.getMarketData("FULL", symbols)

        if data and data.get("status") and data.get("data"):
            fetched = data["data"].get("fetched", [])
            results = []
            for item in fetched:
                results.append({
                    "symbol": item.get("tradingSymbol", "").replace("-EQ", ""),
                    "exchange": item.get("exchange", ""),
                    "ltp": float(item.get("ltp", 0)),
                    "open": float(item.get("open", 0)),
                    "high": float(item.get("high", 0)),
                    "low": float(item.get("low", 0)),
                    "close": float(item.get("close", 0)),
                    "volume": int(item.get("tradeVolume", 0)),
                    "change": float(item.get("netChange", 0)),
                    "change_pct": float(item.get("percentChange", 0)),
                    "timestamp": datetime.now().isoformat(),
                })
            return results

        return []

    except Exception as e:
        logger.error(f"Error fetching bulk quotes: {e}")
        raise


# ── Helper Functions ─────────────────────────────────────────────────────────

def _get_symbol_token(symbol: str, exchange: str) -> str:
    """Get symbol token from Redis cache or Angel One searchScrip."""
    token_key = f"token:{exchange}:{symbol}"
    cached = redis_client.get(token_key)
    if cached:
        return cached.decode() if isinstance(cached, bytes) else cached

    # Search on the specific exchange first, then any exchange as fallback
    for exch_try in [exchange, None]:
        results = search_symbol(symbol, exch_try)
        for r in results:
            r_sym = r.get("symbol", "")
            r_exch = r.get("exchange", "").upper()
            r_token = r.get("token", "")
            if r_sym == symbol and r_token:
                # Prefer exact exchange match; accept any if no exact match
                if r_exch == exchange.upper() or exch_try is None:
                    redis_client.setex(token_key, 86400, r_token)
                    return r_token

    return ""


def _get_nearest_expiry() -> str:
    """Nearest upcoming NSE expiry (Tuesday since 2025-09-01, holiday-adjusted)."""
    from backend.nse_calendar import next_weekly_expiry, format_expiry
    return format_expiry(next_weekly_expiry())


def _get_next_market_open(now: datetime) -> str:
    """Get next market open datetime"""
    next_day = now + timedelta(days=1)
    while next_day.weekday() >= 5:  # Skip weekends
        next_day += timedelta(days=1)
    return next_day.replace(hour=9, minute=15, second=0).isoformat()


def _parse_options_chain(symbol: str, raw_data: List) -> Dict[str, Any]:
    """Parse raw options chain data into structured format"""
    calls = {}
    puts = {}
    underlying_price = 0

    for item in raw_data:
        strike = float(item.get("strikePrice", 0))
        option_type = item.get("optionType", "")

        option_data = {
            "ltp": float(item.get("ltp", 0)),
            "oi": int(item.get("openInterest", 0)),
            "change_in_oi": int(item.get("changeinOpenInterest", 0)),
            "volume": int(item.get("tradedVolume", 0)),
            "iv": float(item.get("impliedVolatility", 0)),
            "delta": float(item.get("delta", 0)),
            "gamma": float(item.get("gamma", 0)),
            "theta": float(item.get("theta", 0)),
            "vega": float(item.get("vega", 0)),
            "bid": float(item.get("bestBids", [{}])[0].get("price", 0) if item.get("bestBids") else 0),
            "ask": float(item.get("bestAsks", [{}])[0].get("price", 0) if item.get("bestAsks") else 0),
        }

        if option_type == "CE":
            calls[strike] = option_data
        elif option_type == "PE":
            puts[strike] = option_data

        if item.get("underlyingValue"):
            underlying_price = float(item["underlyingValue"])

    # Calculate PCR
    total_ce_oi = sum(c["oi"] for c in calls.values())
    total_pe_oi = sum(p["oi"] for p in puts.values())
    pcr = round(total_pe_oi / total_ce_oi, 2) if total_ce_oi > 0 else 0

    # Calculate max pain
    max_pain = _calculate_max_pain(calls, puts)

    return {
        "symbol": symbol,
        "underlying_price": underlying_price,
        "pcr": pcr,
        "max_pain": max_pain,
        "total_ce_oi": total_ce_oi,
        "total_pe_oi": total_pe_oi,
        "calls": {str(k): v for k, v in sorted(calls.items())},
        "puts": {str(k): v for k, v in sorted(puts.items())},
        "timestamp": datetime.now().isoformat(),
    }


def _calculate_max_pain(calls: Dict, puts: Dict) -> float:
    """Calculate options max pain strike price"""
    all_strikes = sorted(set(list(calls.keys()) + list(puts.keys())))
    if not all_strikes:
        return 0

    min_pain = float("inf")
    max_pain_strike = all_strikes[0]

    for strike in all_strikes:
        pain = 0
        for call_strike, call_data in calls.items():
            if strike > call_strike:
                pain += (strike - call_strike) * call_data["oi"]
        for put_strike, put_data in puts.items():
            if strike < put_strike:
                pain += (put_strike - strike) * put_data["oi"]

        if pain < min_pain:
            min_pain = pain
            max_pain_strike = strike

    return max_pain_strike


# ── WebSocket Live Feed ──────────────────────────────────────────────────────

class AngelOneWebSocket:
    """
    WebSocket connection to Angel One for live tick data.
    Subscribes to symbols and pushes updates to Redis pub/sub.

    Fix for [Errno 32] Broken Pipe:
    - Reconnect runs in a NEW thread each time (never blocks the current thread).
    - Exponential backoff capped at 5 minutes to avoid infinite rapid retries.
    - _reconnect_lock prevents concurrent reconnect storms.
    - Heartbeat thread sends a ping every 30s to keep the connection alive and
      detect silent disconnects before the OS raises a broken-pipe error.
    - close() sets _stop_flag so reconnect loop exits cleanly on shutdown.
    """

    def __init__(self):
        self.ws: Optional[SmartWebSocketV2] = None
        self.subscribed_tokens: List[Dict] = []
        self.is_connected = False
        self.reconnect_attempts = 0
        self.max_reconnect = 20          # increased from 10
        self.reconnect_base_delay = 5    # seconds — first retry after 5s
        self.reconnect_max_delay = 300   # cap at 5 minutes
        self._reconnect_lock = threading.Lock()
        self._stop_flag = False
        self._heartbeat_thread: Optional[threading.Thread] = None

    # ── Public API ────────────────────────────────────────────────────────────

    def connect(self, tokens: List[Dict[str, str]]):
        """
        Connect and subscribe to live tick data.
        tokens: [{"exchangeType": 1, "tokens": ["2885", "1594"]}]
        exchangeType: 1=NSE, 3=BSE, 2=NFO
        """
        self.subscribed_tokens = tokens
        self._stop_flag = False
        self._do_connect()

    def _do_connect(self):
        """Internal: (re)create the SmartWebSocketV2 and call connect()."""
        feed_token = redis_client.get(FEED_TOKEN_KEY)
        client_code = os.getenv("ANGEL_ONE_CLIENT_CODE")
        api_key = os.getenv("ANGEL_ONE_API_KEY")

        if not feed_token:
            logger.error("Feed token not found in Redis. Cannot start WebSocket.")
            return

        try:
            # ── Patch SmartWebSocketV2._on_close ─────────────────────────────
            # websocket-client passes (ws, code, msg, was_clean) but the library
            # method only accepts (self, ws) → TypeError → broken-pipe cascade.
            from SmartApi.smartWebSocketV2 import SmartWebSocketV2 as _SWSV2
            _orig_cls_close = _SWSV2._on_close.__func__ if hasattr(_SWSV2._on_close, '__func__') else _SWSV2._on_close

            def _safe_on_close(self_ws, *args, **kwargs):
                try:
                    _orig_cls_close(self_ws, *args[:1])
                except (TypeError, Exception):
                    pass

            _SWSV2._on_close = _safe_on_close

            # ── Also patch _on_error to swallow BrokenPipeError silently ─────
            _orig_cls_error = _SWSV2._on_error.__func__ if hasattr(_SWSV2._on_error, '__func__') else _SWSV2._on_error

            def _safe_on_error(self_ws, *args, **kwargs):
                try:
                    _orig_cls_error(self_ws, *args[:1])
                except (TypeError, Exception):
                    pass

            _SWSV2._on_error = _safe_on_error

            self.ws = SmartWebSocketV2(
                feed_token,
                api_key,
                client_code,
                feed_token,
            )

            self.ws.on_open = self._on_open
            self.ws.on_data = self._on_data
            self.ws.on_error = self._on_error
            self.ws.on_close = self._on_close

            logger.info(f"Connecting to Angel One WebSocket for {len(self.subscribed_tokens)} token groups...")
            self.ws.connect()  # blocking call — runs until disconnect

        except OSError as e:
            # Catch [Errno 32] Broken pipe and similar OS-level socket errors
            logger.warning(f"WebSocket OS error (will reconnect): {e}")
            self.is_connected = False
            self._schedule_reconnect()
        except Exception as e:
            logger.error(f"WebSocket connection error: {e}")
            self.is_connected = False
            self._schedule_reconnect()

    # ── Callbacks ─────────────────────────────────────────────────────────────

    def _on_open(self, ws):
        """Called when WebSocket connection is established."""
        self.is_connected = True
        self.reconnect_attempts = 0
        logger.info("✅ WebSocket connected")

        # Subscribe to all token groups
        for token_group in self.subscribed_tokens:
            self.ws.subscribe(
                correlation_id="stock_feed",
                mode=2,  # Mode 2 = Quote (LTP + OHLCV)
                token_list=[token_group],
            )
            logger.info(f"Subscribed to {len(token_group.get('tokens', []))} tokens")

        # Start heartbeat to detect silent disconnects
        self._start_heartbeat()

    def _on_data(self, ws, message):
        """Called when tick data is received."""
        try:
            if isinstance(message, dict):
                tick = {
                    "type": "tick",
                    "symbol": message.get("trading_symbol", "").replace("-EQ", ""),
                    "exchange": "NSE" if message.get("exchange_type") == 1 else "BSE",
                    # Angel One sends prices in paise → divide by 100
                    "ltp":    float(message.get("last_traded_price",      0)) / 100,
                    "open":   float(message.get("open_price_of_the_day",  0)) / 100,
                    "high":   float(message.get("high_price_of_the_day",  0)) / 100,
                    "low":    float(message.get("low_price_of_the_day",   0)) / 100,
                    "close":  float(message.get("closed_price",           0)) / 100,
                    "volume": int(message.get("volume_trade_for_the_day", 0)),
                    "timestamp": datetime.now().isoformat(),
                }

                if tick["close"] > 0:
                    tick["change"]     = round(tick["ltp"] - tick["close"], 2)
                    tick["change_pct"] = round((tick["change"] / tick["close"]) * 100, 2)
                else:
                    tick["change"]     = 0
                    tick["change_pct"] = 0

                cache_key = f"quote:{tick['exchange']}:{tick['symbol']}"
                redis_client.setex(cache_key, 10, json.dumps(tick))
                redis_client.publish("live:ticks", json.dumps(tick))

        except Exception as e:
            logger.error(f"Error processing tick data: {e}")

    def _on_error(self, ws, error):
        """Called on WebSocket error — suppress BrokenPipe noise, schedule reconnect."""
        err_str = str(error)
        if "Broken pipe" in err_str or "32" in err_str:
            logger.warning(f"WebSocket broken pipe — scheduling reconnect")
        else:
            logger.error(f"WebSocket error: {error}")
        self.is_connected = False
        self._schedule_reconnect()

    def _on_close(self, ws, *args):
        """Called when WebSocket connection is closed."""
        close_status_code = args[0] if len(args) > 0 else None
        close_msg         = args[1] if len(args) > 1 else None
        logger.warning(f"WebSocket closed: code={close_status_code} msg={close_msg}")
        self.is_connected = False
        if not self._stop_flag:
            self._schedule_reconnect()

    # ── Reconnect Logic ───────────────────────────────────────────────────────

    def _schedule_reconnect(self):
        """
        Spawn a NEW daemon thread for reconnect so we never block the caller.
        Uses exponential backoff capped at reconnect_max_delay.
        _reconnect_lock prevents concurrent reconnect storms.
        """
        if self._stop_flag:
            return

        def _reconnect_worker():
            if not self._reconnect_lock.acquire(blocking=False):
                # Another reconnect is already in progress — skip
                return
            try:
                if self.reconnect_attempts >= self.max_reconnect:
                    logger.error(
                        f"Max reconnection attempts ({self.max_reconnect}) reached. "
                        "WebSocket feed stopped. Restart the server to resume."
                    )
                    return

                delay = min(
                    self.reconnect_base_delay * (2 ** self.reconnect_attempts),
                    self.reconnect_max_delay,
                )
                self.reconnect_attempts += 1
                logger.info(
                    f"Reconnecting in {delay}s "
                    f"(attempt {self.reconnect_attempts}/{self.max_reconnect})..."
                )
                time.sleep(delay)

                if not self._stop_flag:
                    # Re-fetch feed token in case it was refreshed
                    new_feed_token = redis_client.get(FEED_TOKEN_KEY)
                    if new_feed_token:
                        self._do_connect()
                    else:
                        logger.warning("Feed token missing during reconnect — retrying login...")
                        try:
                            _session.login()
                        except Exception as login_err:
                            logger.error(f"Re-login failed: {login_err}")
                        self._do_connect()
            finally:
                self._reconnect_lock.release()

        t = threading.Thread(target=_reconnect_worker, daemon=True, name="ws-reconnect")
        t.start()

    # ── Heartbeat ─────────────────────────────────────────────────────────────

    def _start_heartbeat(self):
        """Send a ping every 30s to keep the connection alive."""
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            return  # already running

        def _heartbeat_worker():
            while self.is_connected and not self._stop_flag:
                time.sleep(30)
                if not self.is_connected or self._stop_flag:
                    break
                try:
                    if self.ws and hasattr(self.ws, "wsapp") and self.ws.wsapp:
                        self.ws.wsapp.send_ping()
                    elif self.ws and hasattr(self.ws, "ws") and self.ws.ws:
                        self.ws.ws.ping()
                except Exception as ping_err:
                    logger.debug(f"Heartbeat ping failed: {ping_err}")
                    # Don't trigger reconnect here — _on_error will handle it

        self._heartbeat_thread = threading.Thread(
            target=_heartbeat_worker, daemon=True, name="ws-heartbeat"
        )
        self._heartbeat_thread.start()

    # ── Subscribe / Unsubscribe ───────────────────────────────────────────────

    def subscribe(self, tokens: List[str], exchange_type: int = 1):
        """Subscribe to additional tokens at runtime."""
        if self.is_connected and self.ws:
            self.ws.subscribe(
                correlation_id="stock_feed",
                mode=2,
                token_list=[{"exchangeType": exchange_type, "tokens": tokens}],
            )

    def unsubscribe(self, tokens: List[str], exchange_type: int = 1):
        """Unsubscribe from tokens at runtime."""
        if self.is_connected and self.ws:
            self.ws.unsubscribe(
                correlation_id="stock_feed",
                mode=2,
                token_list=[{"exchangeType": exchange_type, "tokens": tokens}],
            )

    def close(self):
        """Close WebSocket connection gracefully — stops reconnect loop."""
        self._stop_flag = True
        self.is_connected = False
        if self.ws:
            try:
                self.ws.close_connection()
            except Exception:
                pass
        logger.info("WebSocket connection closed")


# ── Singleton WebSocket ──────────────────────────────────────────────────────
live_feed = AngelOneWebSocket()


# ── Module Initialization ────────────────────────────────────────────────────
if __name__ == "__main__":
    # Test the connection
    initialize()

    # Test live quote
    quote = get_live_quote("RELIANCE", NSE)
    print(f"RELIANCE Quote: {json.dumps(quote, indent=2)}")

    # Test market status
    status = get_market_status()
    print(f"Market Status: {json.dumps(status, indent=2)}")

    # Test symbol search
    results = search_symbol("INFY")
    print(f"Search Results: {json.dumps(results[:3], indent=2)}")
