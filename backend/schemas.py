"""
Pydantic schemas for API request/response models
"""
from datetime import date, datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, EmailStr, Field


# ── Generic ───────────────────────────────────────────────────────────────────

class APIResponse(BaseModel):
    success: bool = True
    message: str = "OK"
    data: Any = None


# ── Auth ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    plan: str
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Stocks ────────────────────────────────────────────────────────────────────

class StockOut(BaseModel):
    id: int
    symbol: str
    name: str
    exchange: str
    sector: Optional[str] = None
    industry: Optional[str] = None
    lot_size: int
    is_fo_enabled: bool
    market_cap: Optional[int] = None


class QuoteOut(BaseModel):
    symbol: str
    exchange: str
    ltp: float
    open: float
    high: float
    low: float
    close: float
    volume: int
    change: float
    change_pct: float
    week_52_high: Optional[float] = None
    week_52_low: Optional[float] = None
    timestamp: str


class OHLCVCandle(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class HistoricalDataOut(BaseModel):
    symbol: str
    exchange: str
    interval: str
    candles: List[OHLCVCandle]


# ── Technical Indicators ──────────────────────────────────────────────────────

class IndicatorsOut(BaseModel):
    symbol: str
    exchange: str
    timeframe: str
    # Trend
    ema_9: Optional[float] = None
    ema_21: Optional[float] = None
    ema_50: Optional[float] = None
    ema_200: Optional[float] = None
    sma_20: Optional[float] = None
    vwap: Optional[float] = None
    supertrend: Optional[float] = None
    supertrend_direction: Optional[int] = None
    adx_14: Optional[float] = None
    # Momentum
    rsi_14: Optional[float] = None
    macd: Optional[float] = None
    macd_signal_line: Optional[float] = None
    macd_hist: Optional[float] = None
    stoch_k: Optional[float] = None
    stoch_d: Optional[float] = None
    williams_r: Optional[float] = None
    roc_12: Optional[float] = None
    # Volatility
    bb_upper: Optional[float] = None
    bb_middle: Optional[float] = None
    bb_lower: Optional[float] = None
    bb_width: Optional[float] = None
    atr_14: Optional[float] = None
    # Volume
    obv: Optional[int] = None
    volume_ratio: Optional[float] = None
    mfi_14: Optional[float] = None
    # Signals
    overall_signal: Optional[str] = None
    bullish_count: Optional[int] = None
    bearish_count: Optional[int] = None
    candlestick_pattern: Optional[str] = None
    # All raw signals
    signals: Optional[Dict[str, str]] = None


# ── Options Chain ─────────────────────────────────────────────────────────────

class OptionData(BaseModel):
    ltp: float
    oi: int
    change_in_oi: int
    volume: int
    iv: float
    delta: float
    gamma: float
    theta: float
    vega: float
    bid: float
    ask: float


class OptionsChainOut(BaseModel):
    symbol: str
    underlying_price: float
    expiry_date: Optional[str] = None
    pcr: float
    max_pain: float
    total_ce_oi: int
    total_pe_oi: int
    calls: Dict[str, OptionData]
    puts: Dict[str, OptionData]
    timestamp: str


class UnusualOIOut(BaseModel):
    symbol: str
    strike_price: float
    option_type: str
    current_oi: int
    prev_oi: Optional[int]
    oi_change_pct: float


# ── Screener / AI Signals ─────────────────────────────────────────────────────

class StockSignalOut(BaseModel):
    symbol: str
    exchange: str
    signal_type: str
    timeframe: str
    probability_score: float
    probability_3d: Optional[float] = None
    probability_7d: Optional[float] = None
    probability_15d: Optional[float] = None
    entry_price: Optional[float] = None
    target_3d: Optional[float] = None
    target_7d: Optional[float] = None
    target_15d: Optional[float] = None
    stop_loss: Optional[float] = None
    expected_return_3d: Optional[float] = None
    expected_return_7d: Optional[float] = None
    expected_return_15d: Optional[float] = None
    risk_reward_ratio: Optional[float] = None
    estimated_hold_days: Optional[int] = None
    confidence: Optional[str] = None
    category: Optional[str] = None
    top_reasons: List[str] = []
    risks: List[str] = []
    technical_score: Optional[float] = None
    volume_score: Optional[float] = None
    price_action_score: Optional[float] = None
    options_score: Optional[float] = None
    reasoning: Optional[str] = None
    created_at: Optional[str] = None  # serialized as ISO string by router
    # Live price overlay — populated by /top-picks endpoint from Redis
    live_ltp: Optional[float] = None
    price_change_pct: Optional[float] = None
    price_updated_at: Optional[str] = None
    # Backtest calibration — populated by /signals and /top-picks after backtest runs
    backtest_win_rate: Optional[float] = None
    backtest_sample_count: Optional[int] = None
    backtest_expectancy: Optional[float] = None
    # Buy confirmation checklist — all 5 must be True for buy_confirmed=True
    confirmation_checks: Optional[dict] = None
    confirmed_count: Optional[int] = None
    buy_confirmed: Optional[bool] = None

    class Config:
        from_attributes = True


class ScreenerFilters(BaseModel):
    min_probability: float = 60.0
    signal_type: Optional[str] = None  # STRONG_BUY, BUY, etc.
    sector: Optional[str] = None
    min_volume_ratio: float = 1.0
    min_rsi: Optional[float] = None
    max_rsi: Optional[float] = None
    confidence: Optional[str] = None
    limit: int = Field(default=50, le=200)


# ── Watchlist ─────────────────────────────────────────────────────────────────

class WatchlistCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    symbols: List[str] = []


class WatchlistOut(BaseModel):
    id: str
    name: str
    symbols: List[str]
    is_default: bool
    created_at: datetime


class WatchlistUpdate(BaseModel):
    name: Optional[str] = None
    symbols: Optional[List[str]] = None


# ── Alerts ────────────────────────────────────────────────────────────────────

class AlertCreate(BaseModel):
    symbol: str
    exchange: str = "NSE"
    alert_type: str
    condition: str  # above, below, change_pct
    target_value: float


class AlertOut(BaseModel):
    id: str
    symbol: str
    exchange: str
    alert_type: str
    condition: str
    target_value: float
    is_active: bool
    triggered_at: Optional[datetime] = None
    created_at: datetime


# ── Market Status ─────────────────────────────────────────────────────────────

class MarketStatusOut(BaseModel):
    nse: Dict[str, Any]
    bse: Dict[str, Any]
    timestamp: str
    market_open_time: str
    market_close_time: str
    next_open: str


# ── Sector Heatmap ────────────────────────────────────────────────────────────

class SectorData(BaseModel):
    sector: str
    avg_change_pct: float
    stock_count: int
    top_gainer: Optional[str] = None
    top_loser: Optional[str] = None


# ── Search ────────────────────────────────────────────────────────────────────

class SearchResult(BaseModel):
    symbol: str
    name: str
    exchange: str
    token: Optional[str] = None
    instrument_type: Optional[str] = None
