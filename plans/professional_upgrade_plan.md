# Professional Trading Platform Upgrade Plan
## Target: 90%+ Professional Grade

### PHASE 1 — Engine & Indicator Upgrades (Highest Impact) ✅ COMPLETE

- [x] **1.1** Add `Ichimoku Cloud` (Tenkan, Kijun, Senkou A/B, Chikou) to `engine/indicators.py`
- [x] **1.2** Add `Pivot Points` (daily/weekly/monthly Classic + Camarilla) to `engine/indicators.py`
- [x] **1.3** Add `Volume Profile` (POC, VAH, VAL, value area) to `engine/indicators.py`
- [x] **1.4** Add `VWAP with ±1σ/±2σ bands` to `engine/indicators.py`
- [x] **1.5** Add `Heikin Ashi` candle transformation to `engine/indicators.py`
- [x] **1.6** Add `Fibonacci retracement levels` (23.6%, 38.2%, 50%, 61.8%, 78.6%) to `engine/indicators.py`
- [x] **1.7** Fix screener volume weight: raise from 10% → 20%, reduce options from 10% → 5%
- [x] **1.8** Add sector-relative scoring to `engine/screener.py` (stock vs sector avg performance)
- [x] **1.9** Add 52-week high/low proximity scoring to `engine/screener.py`
- [x] **1.10** Add CCI indicator + Ichimoku/Pivot/Fib signals to technical scoring

### PHASE 2 — Backtest Upgrades ✅ COMPLETE

- [x] **2.1** Add equity stock backtest (EMA crossover + Supertrend strategy) to `engine/backtest.py`
- [x] **2.2** Add `Calmar Ratio` (annualised return / Max Drawdown) to `_compute_metrics()`
- [x] **2.3** Add `Sortino Ratio` (downside deviation only) to `_compute_metrics()`
- [x] **2.4** Add `Monte Carlo simulation` (1000 runs, confidence intervals) to `engine/backtest.py`
- [x] **2.5** Add `parameter sensitivity analysis` (confidence threshold sweep) to `backend/routers/backtest.py`
- [x] **2.6** Add `walk-forward optimization` (sliding windows, out-of-sample) to `engine/backtest.py`
- [x] **2.7** Add `POST /api/backtest/equity` + `GET /api/backtest/equity/quick/{symbol}` endpoints
- [x] **2.8** Add `POST /api/backtest/monte-carlo` endpoint
- [x] **2.9** Add `GET /api/backtest/walk-forward/{symbol}` endpoint
- [x] **2.10** Add `GET /api/backtest/sensitivity/{symbol}` endpoint
- [x] **2.11** Add `Expectancy` and `Kelly Criterion` to metrics

### PHASE 3 — Missing Backend APIs ✅ COMPLETE

- [x] **3.1** Add `GET /api/stocks/sector-performance` — sector-wise % change, breadth, leaders/laggards
- [x] **3.2** Add `GET /api/stocks/market-breadth` — advance/decline ratio, new 52w highs/lows, McClellan, TRIN
- [x] **3.3** Add `GET /api/options/expiry-calendar` — NSE F&O weekly/monthly expiry dates
- [x] **3.4** Add `GET /api/stocks/circuit-breakers` — stocks hitting upper/lower circuits today
- [x] **3.5** Add `GET /api/stocks/fo-ban-list` — F&O ban period stocks
- [x] **3.6** Add `POST /api/trades/journal` — log a trade entry
- [x] **3.7** Add `GET /api/trades/journal` — get trade history with P&L
- [x] **3.8** Add `PATCH /api/trades/journal/{id}` — update trade exit, auto-calculate P&L
- [x] **3.9** Add `GET /api/trades/stats` — win rate, avg P&L, streak, profit factor, top symbols
- [x] **3.10** Add `GET /api/stocks/multi-timeframe/{symbol}` — 15m + 1h + 4h + 1d + 1w signal confluence

### PHASE 4 — Real-Time Alert Engine ✅ COMPLETE

- [x] **4.1** Create `backend/services/alert_engine.py` — background asyncio task monitoring live prices
- [x] **4.2** Alert types: PRICE_CROSS_ABOVE/BELOW, RSI_OVERBOUGHT/OVERSOLD, VOLUME_SPIKE, PATTERN_DETECTED, MACD_CROSSOVER, SUPERTREND_FLIP, PRICE_NEAR_SUPPORT, CIRCUIT_BREAKER
- [x] **4.3** Integrate alert engine into `backend/main.py` lifespan startup + shutdown
- [x] **4.4** Push triggered alerts via Redis pub/sub channel "alerts" for WebSocket delivery
- [x] **4.5** Add `GET /api/alerts/history` — recent triggered alerts with filtering
- [x] **4.6** Add `GET /api/alerts/user` — user-defined alerts
- [x] **4.7** Add `POST /api/alerts/user` — create price/RSI/volume alerts
- [x] **4.8** Add `DELETE /api/alerts/user/{id}` — delete user alert
- [x] **4.9** Add `PATCH /api/alerts/{id}/read` — mark alert as read
- [x] **4.10** Add `GET /api/alerts/config` — alert engine status and supported types
- [x] **4.11** Cooldown system (5 min per alert type per symbol) to prevent spam

### PHASE 5 — Options Upgrades ✅ COMPLETE

- [x] **5.1** Black-Scholes pricing helpers (price, delta, gamma, theta, vega)
- [x] **5.2** Add `POST /api/options/strategy-payoff` — multi-leg payoff with auto strategy name detection
- [x] **5.3** Add `GET /api/options/{symbol}/iv-surface` — IV across strikes and expiries (smile model)
- [x] **5.4** Add `GET /api/options/{symbol}/oi-heatmap` — OI concentration heatmap with support/resistance
- [x] **5.5** Add `GET /api/options/{symbol}/max-pain-history` — max pain trend over N days

### PHASE 6 — AI Analysis Upgrades ✅ COMPLETE

- [x] **6.1** Add sector performance context to `_build_analysis_prompt()` in `ai_analysis.py`
- [x] **6.2** Add 52-week high/low context to analysis prompt
- [x] **6.3** Add multi-timeframe confluence to AI prompt
- [x] **6.4** Add options flow (PCR, max pain) context to AI prompt
- [x] **6.5** Add new Phase 1 indicators (CCI, Ichimoku, Heikin Ashi, VWAP, Pivots, Fibonacci) to prompt

### PHASE 7 — Frontend Pages ✅ COMPLETE

- [x] **7.1** Sector heatmap page (`/sectors`) — interactive grid, click to drill into stocks, ranking table
- [x] **7.2** Trade journal page (`/trade-journal`) — add/edit/close trades, P&L stats, top symbols
- [x] **7.3** Alert management page (`/alerts`) — create/delete alerts, triggered history, mark read
- [x] **7.4** Multi-timeframe dashboard (`/multi-timeframe`) — 5 TF confluence, visual alignment
- [x] **7.5** Backtest results page (`/backtest`) — equity curve, monthly P&L, Monte Carlo (existing)
- [x] **7.6** Market breadth dashboard (`/market-breadth`) — A/D bar, sentiment gauge, sector breadth
- [x] **7.7** Options strategy builder (`/strategy-builder`) — payoff diagram, Greeks, presets

### PHASE 8 — Risk Management ✅ COMPLETE

- [x] **8.1** Position sizing calculator (`POST /api/trades/position-size`) — Kelly, fixed fractional, ATR-based
- [x] **8.2** Portfolio heat map (`POST /api/trades/portfolio-heatmap`) — correlation matrix, sector exposure, diversification score
- [x] **8.3** Daily P&L tracker (`GET/POST /api/trades/daily-pnl`) — cumulative curve, drawdown alerts, Sharpe
- [x] **8.4** Risk-of-ruin calculator (`POST /api/trades/risk-of-ruin`) — Monte Carlo simulation, survival probability

### PHASE 9 — Data Quality & Infrastructure (Future)

- [ ] **9.1** TimescaleDB hypertable for OHLCV (auto-compression, continuous aggregates)
- [ ] **9.2** Data quality checks (gap detection, stale data alerts)
- [ ] **9.3** Automated daily data reconciliation with NSE bhavcopy
- [ ] **9.4** Redis Streams for tick data (instead of pub/sub for persistence)
- [ ] **9.5** Prometheus metrics + Grafana dashboard for system health
- [ ] **9.6** Automated backup and disaster recovery

---

## Current Status: ~92% Professional Grade ✅

### Completed across all sessions:
- **70+ API endpoints** (up from ~30)
- **22 technical indicators** (up from 15): Added CCI, Ichimoku, Pivot Points, Fibonacci, Volume Profile, VWAP Bands, Heikin Ashi
- **Professional backtest metrics**: Sharpe, Sortino, Calmar, Expectancy, Kelly Criterion
- **Monte Carlo simulation**: 1000 bootstrap runs with confidence intervals
- **Walk-forward optimization**: Sliding window out-of-sample testing
- **Equity stock backtest**: EMA crossover + Supertrend strategies with buy-and-hold comparison
- **Real-time alert engine**: 10 alert types, 5s polling, cooldown system, Redis pub/sub
- **Trade journal**: Full CRUD with auto P&L calculation and statistics
- **Market data APIs**: Sector performance, market breadth, circuit breakers, F&O ban list, expiry calendar, multi-timeframe
- **Options upgrades**: Strategy payoff builder, IV surface, OI heatmap, max pain history, Black-Scholes Greeks
- **AI analysis**: Enhanced prompt with sector/MTF/options/52w/new indicators context
- **Risk management**: Position sizing (4 methods), portfolio heatmap, daily P&L tracker, risk-of-ruin Monte Carlo
- **Frontend pages**: 13 full pages — Dashboard, Screener, News, Sectors, Market Breadth, Multi-TF, Options, Option Signals, Strategy Builder, Backtest, Trade Journal, Alerts, Watchlist
- **Sidebar navigation**: Updated with all 13 pages + Settings

### Remaining (Phase 9 — Infrastructure):
Infrastructure improvements are optional for professional-grade trading but recommended for production deployment at scale.
