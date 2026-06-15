import axios from 'axios'
import toast from 'react-hot-toast'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Dedup toast errors — show at most 1 per unique message per 10 s ──────────
const _toastCooldown = new Map<string, number>()
function showErrorToast(message: string) {
  const now = Date.now()
  const last = _toastCooldown.get(message) ?? 0
  if (now - last < 10_000) return   // suppress duplicate within 10 s
  _toastCooldown.set(message, now)
  toast.error(message)
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Network error / backend down — show a single friendly message
    if (!err.response) {
      showErrorToast('Backend offline — retrying…')
      return Promise.reject(err)
    }
    const message = err.response?.data?.detail || err.response?.data?.message || 'Request failed'
    if (err.response?.status !== 404) {
      showErrorToast(message)
    }
    return Promise.reject(err)
  }
)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Quote {
  symbol: string
  exchange: string
  ltp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  change: number
  change_pct: number
  week_52_high?: number
  week_52_low?: number
  timestamp: string
}

export interface OHLCVCandle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Indicators {
  symbol: string
  exchange: string
  timeframe: string
  ema_9?: number
  ema_21?: number
  ema_50?: number
  ema_200?: number
  sma_20?: number
  vwap?: number
  rsi_14?: number
  macd?: number
  macd_signal_line?: number
  macd_hist?: number
  bb_upper?: number
  bb_middle?: number
  bb_lower?: number
  bb_width?: number
  atr_14?: number
  supertrend?: number
  supertrend_direction?: number
  adx_14?: number
  stoch_k?: number
  stoch_d?: number
  obv?: number
  volume_ratio?: number
  mfi_14?: number
  overall_signal?: string
  bullish_count?: number
  bearish_count?: number
  candlestick_pattern?: string
  signals?: Record<string, string>
}

export interface OptionData {
  ltp: number
  oi: number
  change_in_oi: number
  volume: number
  iv: number
  delta: number
  gamma: number
  theta: number
  vega: number
  bid: number
  ask: number
}

export interface OptionsChain {
  symbol: string
  underlying_price: number
  expiry_date?: string
  pcr: number
  max_pain: number
  total_ce_oi: number
  total_pe_oi: number
  calls: Record<string, OptionData>
  puts: Record<string, OptionData>
  timestamp: string
}

export interface StockSignal {
  symbol: string
  exchange: string
  signal_type: string
  timeframe: string
  probability_score: number
  probability_3d?: number
  probability_7d?: number
  probability_15d?: number
  entry_price?: number
  target_3d?: number
  target_7d?: number
  target_15d?: number
  stop_loss?: number
  expected_return_3d?: number
  expected_return_7d?: number
  expected_return_15d?: number
  risk_reward_ratio?: number
  estimated_hold_days?: number
  confidence?: string
  category?: string
  top_reasons: string[]
  risks: string[]
  technical_score?: number
  volume_score?: number
  price_action_score?: number
  options_score?: number
  reasoning?: string
  created_at?: string
  // Live price overlay fields (added by backend /top-picks endpoint)
  live_ltp?: number
  price_change_pct?: number
  price_updated_at?: string
  // Backtest calibration (present after /backtest/run has been called)
  backtest_win_rate?: number
  backtest_sample_count?: number
  backtest_expectancy?: number
  // Buy confirmation checklist — all 5 must pass for buy_confirmed=true
  confirmation_checks?: {
    volume_surge: boolean       // today's volume ≥ 1.5× 20d avg
    rsi_healthy: boolean        // RSI between 30–70
    ema_uptrend: boolean        // price > EMA21 > EMA50
    macd_positive: boolean      // MACD histogram > 0
    obv_accumulation: boolean   // 5-day OBV trending up
  }
  confirmed_count?: number
  buy_confirmed?: boolean
}

export interface BacktestCalibration {
  win_rate_7d: number
  sample_count: number
  winning_trades: number
  losing_trades: number
  avg_win_pct: number
  avg_loss_pct: number
  expectancy: number
  last_computed?: string
}

export interface MarketStatus {
  nse: { open: boolean; status: string }
  bse: { open: boolean; status: string }
  timestamp: string
  next_open: string
}

export interface Stock {
  id: number
  symbol: string
  name: string
  exchange: string
  sector?: string
  lot_size: number
  is_fo_enabled: boolean
}

// ── API Methods ───────────────────────────────────────────────────────────────

export const stocksApi = {
  search: (q: string) => api.get<{ symbol: string; name: string; exchange: string }[]>(`/api/stocks/search?q=${q}`).then((r) => r.data),
  marketStatus: () => api.get<MarketStatus>('/api/stocks/market-status').then((r) => r.data),
  trending: () => api.get<Quote[]>('/api/stocks/trending').then((r) => r.data),
  sectorHeatmap: () => api.get<{ sector: string; avg_change_pct: number; stock_count: number }[]>('/api/stocks/sector-heatmap').then((r) => r.data),
  list: (params?: { exchange?: string; sector?: string; fo_only?: boolean }) =>
    api.get<Stock[]>('/api/stocks', { params }).then((r) => r.data),
  quote: (symbol: string, exchange = 'NSE') =>
    api.get<Quote>(`/api/stocks/${symbol}/quote?exchange=${exchange}`).then((r) => r.data),
  historical: (symbol: string, exchange = 'NSE', interval = '1d', days?: number) =>
    api.get<{ symbol: string; candles: OHLCVCandle[] }>(`/api/stocks/${symbol}/historical`, { params: { exchange, interval, ...(days ? { days } : {}) } }).then((r) => r.data),
  indicators: (symbol: string, exchange = 'NSE', timeframe = '1d') =>
    api.get<Indicators>(`/api/stocks/${symbol}/indicators`, { params: { exchange, timeframe } }).then((r) => r.data),
}

export const optionsApi = {
  symbols: () => api.get<string[]>('/api/options/symbols').then((r) => r.data),
  chain: (symbol: string, expiry?: string) =>
    api.get<OptionsChain>(`/api/options/${symbol}/chain`, { params: expiry ? { expiry_date: expiry } : {} }).then((r) => r.data),
  pcr: (symbol: string) => api.get(`/api/options/${symbol}/pcr`).then((r) => r.data),
  unusualOI: () => api.get('/api/options/unusual-oi').then((r) => r.data),
  oiAnalysis: (symbol: string) => api.get(`/api/options/${symbol}/oi-analysis`).then((r) => r.data),
}

// ── Option Suggestions Types ──────────────────────────────────────────────────

export interface OptionTrade {
  symbol: string
  option_type: 'CE' | 'PE'
  strike: number
  expiry: string
  ltp: number
  entry_price: number
  entry_range_low: number
  entry_range_high: number
  target_1: number
  target_2: number
  stop_loss: number
  risk_reward: number
  max_profit: number
  max_loss: number
  breakeven: number
  lot_size: number
  lots_suggested: number
  capital_required: number
  delta: number
  gamma: number
  theta: number
  vega: number
  iv: number
  oi: number
  oi_change: number
  volume: number
  signal_strength: 'STRONG' | 'MODERATE' | 'WEAK'
  trade_type: 'INTRADAY' | 'SWING' | 'POSITIONAL'
  rationale: string[]
  risks: string[]
  confidence_pct: number
  trend_direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
}

export interface MarketContext {
  underlying_price: number
  atm_strike: number
  pcr: number
  max_pain: number
  total_ce_oi: number
  total_pe_oi: number
  iv_rank: number
  market_trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS'
  support_level: number
  resistance_level: number
  vix_estimate: number
  timestamp: string
}

export interface ChainStrike {
  strike: number
  is_atm: boolean
  ce: OptionData | null
  pe: OptionData | null
}

export interface OptionSuggestionsResponse {
  symbol: string
  expiry: string
  market_context: MarketContext
  suggestions: OptionTrade[]
  option_chain_snapshot: {
    strikes: ChainStrike[]
    underlying: number
    atm: number
  }
  generated_at: string
}

export interface ExpiryWeek {
  label: string
  date: string
  days_remaining: number
  is_current: boolean
  week: string
}

export const optionSuggestionsApi = {
  getSuggestions: (symbol: string, expiry?: string, tradeType?: string) =>
    api.get<OptionSuggestionsResponse>(`/api/options/suggestions/${encodeURIComponent(symbol)}`, {
      params: { ...(expiry ? { expiry_date: expiry } : {}), ...(tradeType ? { trade_type: tradeType } : {}) },
    }).then((r) => r.data),
  getLiveChain: (symbol: string, expiry?: string) =>
    api.get(`/api/options/suggestions/${encodeURIComponent(symbol)}/live-chain`, {
      params: expiry ? { expiry_date: expiry } : {},
    }).then((r) => r.data),
  getExpiryWeeks: (symbol?: string) =>
    api.get<ExpiryWeek[]>('/api/options/suggestions/expiry-weeks', {
      params: symbol ? { symbol } : {},
    }).then((r) => r.data),
}

// ── Backtest Types ────────────────────────────────────────────────────────────

export interface BacktestRequest {
  symbol?: string
  start_date?: string
  end_date?: string
  initial_capital?: number
  lots_per_trade?: number
  trade_type?: 'INTRADAY' | 'SWING'
  min_confidence?: number
  t1_exit_pct?: number
  brokerage_per_lot?: number
}

export interface BacktestTrade {
  trade_id: number
  date: string
  option_type: 'CE' | 'PE'
  strike: number
  expiry: string
  entry_price: number
  stop_loss: number
  target_1: number
  target_2: number
  exit_price: number
  exit_reason: 'SL' | 'T1' | 'T2' | 'EOD' | 'EXPIRY'
  pnl: number
  pnl_pct: number
  holding_periods: number
  trend: string
  pcr: number
  confidence: number
  is_winner: boolean
  brokerage: number
  net_pnl: number
}

export interface BacktestMetrics {
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  profit_factor: number
  total_pnl: number
  total_return_pct: number
  max_drawdown: number
  max_drawdown_pct: number
  sharpe_ratio: number
  avg_win: number
  avg_loss: number
  best_trade: number
  worst_trade: number
  avg_holding_periods: number
  consecutive_wins: number
  consecutive_losses: number
  ce_trades: number
  pe_trades: number
  ce_win_rate: number
  pe_win_rate: number
  sl_exits: number
  t1_exits: number
  t2_exits: number
  eod_exits: number
  expiry_exits: number
  final_capital: number
  total_brokerage: number
}

export interface EquityPoint {
  date: string
  trade_id: number
  pnl: number
  equity: number
  drawdown: number
  is_winner: boolean
}

export interface MonthlyPnL {
  month: string
  pnl: number
  trades: number
  wins: number
  win_rate: number
}

export interface BacktestResult {
  config: Record<string, unknown>
  trades: BacktestTrade[]
  metrics: BacktestMetrics
  equity_curve: EquityPoint[]
  monthly_pnl: MonthlyPnL[]
  strategy_breakdown: {
    by_trend: Record<string, { trades: number; win_rate: number; pnl: number }>
    by_option_type: Record<string, { trades: number; win_rate: number; pnl: number }>
    by_exit_reason: Record<string, number>
  }
  generated_at: string
}

export const backtestApi = {
  run: (req: BacktestRequest) =>
    api.post<BacktestResult>('/api/backtest/run', req, { timeout: 120000 }).then((r) => r.data),
  quick: (symbol: string, days = 180, tradeType = 'INTRADAY', minConfidence = 70) =>
    api.get<BacktestResult>(`/api/backtest/quick/${encodeURIComponent(symbol)}`, {
      params: { days, trade_type: tradeType, min_confidence: minConfidence },
      timeout: 120000,
    }).then((r) => r.data),
}

export const screenerApi = {
  signals: (params?: { min_probability?: number; signal_type?: string; category?: string; sort_by?: string; limit?: number }) =>
    api.get<StockSignal[]>('/api/screener/signals', { params }).then((r) => r.data),
  topPicks: () => api.get<StockSignal[]>('/api/screener/top-picks').then((r) => r.data),
  // Screener run can take 30–60 s — use a dedicated long-timeout request
  run: () => api.post('/api/screener/run', null, { timeout: 120_000 }).then((r) => r.data),
  runBacktest: () => api.post('/api/screener/backtest/run', null, { timeout: 10_000 }).then((r) => r.data),
  backtestResults: () => api.get<Record<string, BacktestCalibration>>('/api/screener/backtest/results').then((r) => r.data),
}

// ── Paper Trades ──────────────────────────────────────────────────────────────

export interface PaperTrade {
  id: string
  symbol: string
  exchange: string
  signal_type: string
  category: string
  probability_score: number
  confirmed_count: number
  entry_price: number
  entry_time: string
  target_3d: number | null
  target_7d: number | null
  stop_loss: number | null
  estimated_hold_days: number
  capital: number
  quantity: number
  status: 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED'
  exit_price: number | null
  exit_time: string | null
  exit_reason: string | null
  pnl_amount: number | null
  pnl_pct: number | null
  top_reasons: string[]
  created_at: string
}

export interface PaperTradeSummary {
  total: number
  open_count: number
  closed_count: number
  wins: number
  losses: number
  win_rate: number | null
  total_pnl: number | null
  avg_pnl_pct: number | null
  avg_win_pct: number | null
  avg_loss_pct: number | null
  avg_prob_wins: number | null
  avg_prob_losses: number | null
  by_category: Array<{
    category: string
    total: number
    wins: number
    losses: number
    avg_pnl_pct: number | null
  }>
}

export const paperTradesApi = {
  list: (status?: string) =>
    api.get<PaperTrade[]>('/api/paper-trades/', { params: status ? { status } : {} }).then((r) => r.data),
  summary: () =>
    api.get<PaperTradeSummary>('/api/paper-trades/summary').then((r) => r.data),
}

// ── News ──────────────────────────────────────────────────────────────────────

export interface NewsItem {
  id: string
  title: string
  summary: string
  url: string
  source: string
  source_type: 'corporate' | 'market' | 'economy' | 'global'
  published_at: string
  symbols: string[]
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
  is_breaking: boolean
}

export const newsApi = {
  all: (params?: { source_type?: string; symbol?: string; sentiment?: string; limit?: number }) =>
    api.get<NewsItem[]>('/api/news', { params }).then((r) => r.data),
  breaking: () => api.get<NewsItem[]>('/api/news/breaking').then((r) => r.data),
  bySymbol: (symbol: string, limit = 10) =>
    api.get<NewsItem[]>(`/api/news/symbol/${symbol}`, { params: { limit } }).then((r) => r.data),
  refresh: () => api.post('/api/news/refresh').then((r) => r.data),
}

// ── Market Data (Phase 7) ─────────────────────────────────────────────────────

export const marketApi = {
  sectorPerformance: () => api.get('/api/stocks/sector-performance').then((r) => r.data),
  marketBreadth: () => api.get('/api/stocks/market-breadth').then((r) => r.data),
  multiTimeframe: (symbol: string) => api.get(`/api/stocks/multi-timeframe/${encodeURIComponent(symbol)}`).then((r) => r.data),
  circuitBreakers: () => api.get('/api/stocks/circuit-breakers').then((r) => r.data),
  foBanList: () => api.get('/api/stocks/fo-ban-list').then((r) => r.data),
}

// ── Trade Journal (Phase 7) ───────────────────────────────────────────────────

export const tradeJournalApi = {
  list: () => api.get('/api/trades/journal').then((r) => r.data),
  add: (data: Record<string, unknown>) => api.post('/api/trades/journal', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/api/trades/journal/${id}`, data).then((r) => r.data),
  stats: () => api.get('/api/trades/stats').then((r) => r.data),
  positionSize: (data: Record<string, unknown>) => api.post('/api/trades/position-size', data).then((r) => r.data),
  portfolioHeatmap: (data: Record<string, unknown>) => api.post('/api/trades/portfolio-heatmap', data).then((r) => r.data),
  dailyPnl: (days = 30) => api.get('/api/trades/daily-pnl', { params: { days } }).then((r) => r.data),
  addDailyPnl: (data: Record<string, unknown>) => api.post('/api/trades/daily-pnl', data).then((r) => r.data),
  riskOfRuin: (data: Record<string, unknown>) => api.post('/api/trades/risk-of-ruin', data).then((r) => r.data),
}

// ── Alerts (Phase 7) ──────────────────────────────────────────────────────────

export const alertsApi = {
  history: () => api.get('/api/alerts/history').then((r) => r.data),
  userAlerts: () => api.get('/api/alerts/user').then((r) => r.data),
  create: (data: Record<string, unknown>) => api.post('/api/alerts/user', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/api/alerts/user/${id}`).then((r) => r.data),
  markRead: (id: string) => api.patch(`/api/alerts/${id}/read`).then((r) => r.data),
  config: () => api.get('/api/alerts/config').then((r) => r.data),
}

// ── Options Strategy (Phase 7) ────────────────────────────────────────────────

export const strategyApi = {
  payoff: (data: Record<string, unknown>) => api.post('/api/options/strategy-payoff', data).then((r) => r.data),
  ivSurface: (symbol: string) => api.get(`/api/options/${encodeURIComponent(symbol)}/iv-surface`).then((r) => r.data),
  oiHeatmap: (symbol: string) => api.get(`/api/options/${encodeURIComponent(symbol)}/oi-heatmap`).then((r) => r.data),
  maxPainHistory: (symbol: string, days = 5) => api.get(`/api/options/${encodeURIComponent(symbol)}/max-pain-history`, { params: { days } }).then((r) => r.data),
}
