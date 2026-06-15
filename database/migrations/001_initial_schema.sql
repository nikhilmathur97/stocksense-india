-- ═══════════════════════════════════════════════════════════════════════════
-- Indian Stock Market Platform — TimescaleDB Schema
-- Run this file on a fresh TimescaleDB instance
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For fuzzy text search

-- ── 1. USERS TABLE ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    plan            VARCHAR(50) DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'elite')),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ── 2. STOCKS MASTER TABLE ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stocks (
    id              SERIAL PRIMARY KEY,
    symbol          VARCHAR(50) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    exchange        VARCHAR(10) NOT NULL CHECK (exchange IN ('NSE', 'BSE', 'NFO')),
    sector          VARCHAR(100),
    industry        VARCHAR(100),
    isin            VARCHAR(20) UNIQUE,
    lot_size        INTEGER DEFAULT 1,
    symbol_token    VARCHAR(20),
    instrument_type VARCHAR(20) DEFAULT 'EQ',
    market_cap      BIGINT DEFAULT 0,
    face_value      NUMERIC(10,2) DEFAULT 10,
    is_active       BOOLEAN DEFAULT TRUE,
    is_fo_enabled   BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(symbol, exchange)
);

CREATE INDEX idx_stocks_symbol ON stocks(symbol);
CREATE INDEX idx_stocks_exchange ON stocks(exchange);
CREATE INDEX idx_stocks_sector ON stocks(sector);
CREATE INDEX idx_stocks_name_trgm ON stocks USING gin(name gin_trgm_ops);
CREATE INDEX idx_stocks_symbol_trgm ON stocks USING gin(symbol gin_trgm_ops);
CREATE INDEX idx_stocks_active ON stocks(is_active) WHERE is_active = TRUE;

-- ── 3. OHLCV 1-MINUTE (HYPERTABLE) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_1min (
    time        TIMESTAMPTZ NOT NULL,
    symbol      VARCHAR(50) NOT NULL,
    exchange    VARCHAR(10) NOT NULL,
    open        NUMERIC(12,2) NOT NULL,
    high        NUMERIC(12,2) NOT NULL,
    low         NUMERIC(12,2) NOT NULL,
    close       NUMERIC(12,2) NOT NULL,
    volume      BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (time, symbol, exchange)
);

-- Convert to TimescaleDB hypertable (partition by time, 1 day chunks)
SELECT create_hypertable('ohlcv_1min', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

-- Indexes for fast queries
CREATE INDEX idx_ohlcv_1min_symbol_time ON ohlcv_1min(symbol, exchange, time DESC);
CREATE INDEX idx_ohlcv_1min_time ON ohlcv_1min USING BRIN(time);

-- Data retention: keep 1-min data for 3 months
SELECT add_retention_policy('ohlcv_1min', INTERVAL '3 months', if_not_exists => TRUE);

-- ── 4. OHLCV DAILY (HYPERTABLE) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_daily (
    date            DATE NOT NULL,
    symbol          VARCHAR(50) NOT NULL,
    exchange        VARCHAR(10) NOT NULL,
    open            NUMERIC(12,2) NOT NULL,
    high            NUMERIC(12,2) NOT NULL,
    low             NUMERIC(12,2) NOT NULL,
    close           NUMERIC(12,2) NOT NULL,
    volume          BIGINT NOT NULL DEFAULT 0,
    delivery_qty    BIGINT DEFAULT 0,
    delivery_pct    NUMERIC(5,2) DEFAULT 0,
    turnover        NUMERIC(20,2) DEFAULT 0,
    PRIMARY KEY (date, symbol, exchange)
);

SELECT create_hypertable('ohlcv_daily', 'date', chunk_time_interval => INTERVAL '1 year', if_not_exists => TRUE);

CREATE INDEX idx_ohlcv_daily_symbol ON ohlcv_daily(symbol, exchange, date DESC);
CREATE INDEX idx_ohlcv_daily_date ON ohlcv_daily USING BRIN(date);

-- ── 5. OPTIONS CHAIN SNAPSHOTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS options_chain (
    id              BIGSERIAL,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    symbol          VARCHAR(50) NOT NULL,
    expiry_date     DATE NOT NULL,
    strike_price    NUMERIC(12,2) NOT NULL,
    option_type     CHAR(2) NOT NULL CHECK (option_type IN ('CE', 'PE')),
    ltp             NUMERIC(12,2) DEFAULT 0,
    oi              BIGINT DEFAULT 0,
    change_in_oi    BIGINT DEFAULT 0,
    volume          BIGINT DEFAULT 0,
    iv              NUMERIC(8,4) DEFAULT 0,
    delta           NUMERIC(8,6) DEFAULT 0,
    gamma           NUMERIC(10,8) DEFAULT 0,
    theta           NUMERIC(8,4) DEFAULT 0,
    vega            NUMERIC(8,4) DEFAULT 0,
    bid             NUMERIC(12,2) DEFAULT 0,
    ask             NUMERIC(12,2) DEFAULT 0,
    underlying_price NUMERIC(12,2) DEFAULT 0,
    PRIMARY KEY (timestamp, symbol, expiry_date, strike_price, option_type)
);

SELECT create_hypertable('options_chain', 'timestamp', chunk_time_interval => INTERVAL '1 week', if_not_exists => TRUE);

CREATE INDEX idx_options_symbol_expiry ON options_chain(symbol, expiry_date, timestamp DESC);
CREATE INDEX idx_options_strike ON options_chain(symbol, strike_price, option_type);

-- Keep options data for 6 months
SELECT add_retention_policy('options_chain', INTERVAL '6 months', if_not_exists => TRUE);

-- ── 6. TECHNICAL INDICATORS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS technical_indicators (
    time        TIMESTAMPTZ NOT NULL,
    symbol      VARCHAR(50) NOT NULL,
    exchange    VARCHAR(10) NOT NULL,
    timeframe   VARCHAR(10) NOT NULL DEFAULT '1d',
    -- Trend
    ema_9       NUMERIC(12,2),
    ema_21      NUMERIC(12,2),
    ema_50      NUMERIC(12,2),
    ema_200     NUMERIC(12,2),
    sma_20      NUMERIC(12,2),
    sma_50      NUMERIC(12,2),
    vwap        NUMERIC(12,2),
    supertrend  NUMERIC(12,2),
    supertrend_direction SMALLINT,  -- 1=bullish, -1=bearish
    adx_14      NUMERIC(8,4),
    -- Momentum
    rsi_14      NUMERIC(8,4),
    macd        NUMERIC(12,4),
    macd_signal NUMERIC(12,4),
    macd_hist   NUMERIC(12,4),
    stoch_k     NUMERIC(8,4),
    stoch_d     NUMERIC(8,4),
    williams_r  NUMERIC(8,4),
    roc_12      NUMERIC(8,4),
    -- Volatility
    bb_upper    NUMERIC(12,2),
    bb_middle   NUMERIC(12,2),
    bb_lower    NUMERIC(12,2),
    bb_width    NUMERIC(8,4),
    atr_14      NUMERIC(12,4),
    -- Volume
    obv         BIGINT,
    volume_sma_20 BIGINT,
    mfi_14      NUMERIC(8,4),
    PRIMARY KEY (time, symbol, exchange, timeframe)
);

SELECT create_hypertable('technical_indicators', 'time', chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE);

CREATE INDEX idx_indicators_symbol ON technical_indicators(symbol, exchange, timeframe, time DESC);

-- ── 7. STOCK SIGNALS (AI SCREENER OUTPUT) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_signals (
    id                  BIGSERIAL PRIMARY KEY,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    symbol              VARCHAR(50) NOT NULL,
    exchange            VARCHAR(10) NOT NULL,
    signal_type         VARCHAR(20) NOT NULL CHECK (signal_type IN ('STRONG_BUY', 'BUY', 'NEUTRAL', 'SELL', 'STRONG_SELL')),
    timeframe           VARCHAR(20) NOT NULL,
    probability_score   NUMERIC(5,2) NOT NULL,
    probability_7d      NUMERIC(5,2),
    probability_15d     NUMERIC(5,2),
    entry_price         NUMERIC(12,2),
    target_7d           NUMERIC(12,2),
    target_15d          NUMERIC(12,2),
    stop_loss           NUMERIC(12,2),
    expected_return_7d  NUMERIC(8,4),
    expected_return_15d NUMERIC(8,4),
    risk_reward_ratio   NUMERIC(8,4),
    confidence          VARCHAR(10) CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
    category            VARCHAR(20),
    top_reasons         JSONB DEFAULT '[]',
    risks               JSONB DEFAULT '[]',
    technical_score     NUMERIC(5,2),
    volume_score        NUMERIC(5,2),
    price_action_score  NUMERIC(5,2),
    options_score       NUMERIC(5,2),
    reasoning           TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    hit_target          BOOLEAN DEFAULT FALSE,
    hit_stop_loss       BOOLEAN DEFAULT FALSE,
    closed_at           TIMESTAMPTZ
);

CREATE INDEX idx_signals_symbol ON stock_signals(symbol, exchange, created_at DESC);
CREATE INDEX idx_signals_probability ON stock_signals(probability_score DESC) WHERE is_active = TRUE;
CREATE INDEX idx_signals_active ON stock_signals(is_active, created_at DESC) WHERE is_active = TRUE;
CREATE INDEX idx_signals_category ON stock_signals(category, probability_score DESC);

-- ── 8. WATCHLISTS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL DEFAULT 'My Watchlist',
    symbols     JSONB DEFAULT '[]',
    is_default  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_watchlists_user ON watchlists(user_id);

-- ── 9. PRICE ALERTS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol          VARCHAR(50) NOT NULL,
    exchange        VARCHAR(10) NOT NULL,
    alert_type      VARCHAR(30) NOT NULL,
    condition       VARCHAR(20) NOT NULL CHECK (condition IN ('above', 'below', 'change_pct')),
    target_value    NUMERIC(12,2) NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    triggered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_user ON price_alerts(user_id, is_active);
CREATE INDEX idx_alerts_symbol ON price_alerts(symbol, exchange, is_active) WHERE is_active = TRUE;

-- ── CONTINUOUS AGGREGATES (Daily rollup from 1-min data) ─────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_daily_agg
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS date,
    symbol,
    exchange,
    FIRST(open, time) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, time) AS close,
    SUM(volume) AS volume
FROM ohlcv_1min
GROUP BY time_bucket('1 day', time), symbol, exchange
WITH NO DATA;

-- Refresh policy: update daily aggregate every hour
SELECT add_continuous_aggregate_policy('ohlcv_daily_agg',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- ── SEED DATA — 10 Popular NSE Stocks ────────────────────────────────────────
INSERT INTO stocks (symbol, name, exchange, sector, industry, isin, lot_size, symbol_token, is_fo_enabled) VALUES
('RELIANCE',    'Reliance Industries Ltd',          'NSE', 'Energy',          'Oil & Gas',              'INE002A01018', 250,  '2885',  TRUE),
('TCS',         'Tata Consultancy Services Ltd',    'NSE', 'IT',              'IT Services',            'INE467B01029', 150,  '11536', TRUE),
('INFY',        'Infosys Ltd',                      'NSE', 'IT',              'IT Services',            'INE009A01021', 300,  '1594',  TRUE),
('HDFCBANK',    'HDFC Bank Ltd',                    'NSE', 'Banking',         'Private Sector Bank',    'INE040A01034', 550,  '1333',  TRUE),
('ICICIBANK',   'ICICI Bank Ltd',                   'NSE', 'Banking',         'Private Sector Bank',    'INE090A01021', 700,  '4963',  TRUE),
('HINDUNILVR',  'Hindustan Unilever Ltd',           'NSE', 'FMCG',            'Personal Products',      'INE030A01027', 300,  '1394',  TRUE),
('SBIN',        'State Bank of India',              'NSE', 'Banking',         'Public Sector Bank',     'INE062A01020', 1500, '3045',  TRUE),
('BAJFINANCE',  'Bajaj Finance Ltd',                'NSE', 'Finance',         'NBFC',                   'INE296A01024', 125,  '317',   TRUE),
('WIPRO',       'Wipro Ltd',                        'NSE', 'IT',              'IT Services',            'INE075A01022', 1500, '3787',  TRUE),
('MARUTI',      'Maruti Suzuki India Ltd',          'NSE', 'Auto',            'Passenger Vehicles',     'INE585B01010', 100,  '10999', TRUE),
('NIFTY 50',    'Nifty 50 Index',                   'NSE', 'Index',           'Index',                  NULL,           50,   '26000', TRUE),
('BANKNIFTY',   'Bank Nifty Index',                 'NSE', 'Index',           'Index',                  NULL,           15,   '26009', TRUE)
ON CONFLICT (symbol, exchange) DO NOTHING;
