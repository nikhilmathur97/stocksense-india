'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  TrendingUp, Target, Shield, ChevronDown, ChevronUp,
  Zap, BarChart2, Activity, BookOpen, AlertTriangle,
  Clock, Database, CheckCircle2, XCircle, Info, Radio, History, ShieldCheck,
} from 'lucide-react'
import { cn, formatPrice, probabilityColor, confidenceBadge } from '@/lib/utils'
import type { StockSignal } from '@/lib/api'

interface SignalCardProps {
  signal: StockSignal
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('num font-semibold', color)}>{value.toFixed(0)}</span>
      </div>
      <div className="h-1 bg-secondary rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color.includes('green') ? 'bg-green-500' : color.includes('blue') ? 'bg-blue-500' : color.includes('yellow') ? 'bg-yellow-500' : 'bg-purple-500')}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  )
}

function ScalpingBadge({ signal }: { signal: StockSignal }) {
  const rr = signal.risk_reward_ratio ?? 0
  const prob = signal.probability_7d ?? signal.probability_score
  const hold = signal.estimated_hold_days ?? 5

  // Scalping suitability: high prob + good R/R + short hold
  const isScalpable = prob >= 75 && rr >= 2.0 && hold <= 3
  const isMedium = prob >= 65 && rr >= 1.5 && hold <= 5

  if (isScalpable) {
    return (
      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30 font-medium">
        <Zap className="w-2.5 h-2.5" />
        Scalp Ready
      </span>
    )
  }
  if (isMedium) {
    return (
      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 font-medium">
        <Activity className="w-2.5 h-2.5" />
        Swing Trade
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border/50 font-medium">
      <Clock className="w-2.5 h-2.5" />
      Positional
    </span>
  )
}

// ── Data Sources used by the screener ────────────────────────────────────────
const DATA_SOURCES = [
  { label: 'OHLCV History', detail: '250 days daily candles from Angel One', icon: Database },
  { label: 'Technical Indicators', detail: 'EMA 9/21/50, MACD, RSI, Supertrend, ADX, Bollinger Bands, OBV, MFI, ATR', icon: BarChart2 },
  { label: 'Candlestick Patterns', detail: 'Hammer, Engulfing, Doji, Morning Star, Shooting Star', icon: Activity },
  { label: 'Options PCR', detail: 'Put-Call Ratio from Redis cache (F&O stocks only)', icon: BookOpen },
]

// ── Main Component ────────────────────────────────────────────────────────────

// ── Signal age helper ─────────────────────────────────────────────────────────
function signalAge(createdAt?: string): { label: string; isStale: boolean } {
  if (!createdAt) return { label: 'Unknown age', isStale: false }
  try {
    const diffMs = Date.now() - new Date(createdAt).getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 60) return { label: `${diffMins}m ago`, isStale: false }
    const diffHrs = Math.floor(diffMins / 60)
    if (diffHrs < 24) return { label: `${diffHrs}h ago`, isStale: diffHrs >= 2 }
    return { label: `${Math.floor(diffHrs / 24)}d ago`, isStale: true }
  } catch {
    return { label: 'Unknown age', isStale: false }
  }
}

export function SignalCard({ signal }: SignalCardProps) {
  const [expanded, setExpanded] = useState(false)

  const probColor = probabilityColor(signal.probability_7d ?? signal.probability_score)
  const confClass = confidenceBadge(signal.confidence ?? '')
  const rr = signal.risk_reward_ratio ?? 0
  const techScore = signal.technical_score ?? 0
  const volScore = signal.volume_score ?? 0
  const paScore = signal.price_action_score ?? 0
  const optScore = signal.options_score ?? 0
  const holdDays = signal.estimated_hold_days ?? 5

  // Signal age
  const age = signalAge(signal.created_at)

  // Live price from backend overlay (added by screener /top-picks endpoint)
  const liveLtp = signal.live_ltp
  const priceChangePct = signal.price_change_pct
  const hasLivePrice = liveLtp != null && liveLtp > 0

  // Probability interpretation
  const probLabel =
    (signal.probability_7d ?? 0) >= 80 ? 'Very High' :
    (signal.probability_7d ?? 0) >= 70 ? 'High' :
    (signal.probability_7d ?? 0) >= 60 ? 'Moderate' : 'Low'

  // Why this stock was selected
  const selectionReason =
    signal.category === 'Oversold Bounce' ? 'RSI oversold — high mean-reversion probability' :
    signal.category === 'Momentum Breakout' ? 'MACD bullish crossover detected — fresh momentum entry' :
    signal.category === 'Volume Surge' ? 'Unusual volume spike — institutional accumulation signal' :
    signal.category === 'Mean Reversion' ? 'Price near Bollinger lower band — bounce setup' :
    signal.category === 'Reversal Pattern' ? 'Bullish candlestick reversal pattern confirmed' :
    signal.category === 'Trend Following' ? 'Supertrend bullish + ADX strong — trend continuation' :
    'Multiple technical indicators aligned bullishly'

  return (
    <div className="glass rounded-xl overflow-hidden hover:border-primary/30 transition-all">
      {/* ── Stale signal warning banner ── */}
      {age.isStale && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20 text-[10px] text-yellow-400">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          Signal is {age.label} — prices updated to live LTP
        </div>
      )}

      {/* ── Clickable header → stock page ── */}
      <Link href={`/stocks/${signal.symbol}`}>
        <div className="p-4 cursor-pointer group">
          {/* Header row */}
          <div className="flex items-start justify-between mb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base">{signal.symbol}</span>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', confClass)}>
                  {signal.confidence}
                </span>
                <ScalpingBadge signal={signal} />
                {/* Live price badge */}
                {hasLivePrice && (
                  <span className={cn(
                    'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium',
                    (priceChangePct ?? 0) >= 0
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                  )}>
                    <Radio className="w-2.5 h-2.5 animate-pulse" />
                    ₹{formatPrice(liveLtp!)}
                    {priceChangePct != null && (
                      <span>{priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(2)}%</span>
                    )}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {signal.exchange} · {signal.category ?? 'Technical Setup'} · Hold ~{holdDays}d
                <span className={cn('ml-1.5', age.isStale ? 'text-yellow-500' : 'text-muted-foreground/60')}>
                  · Signal {age.label}
                </span>
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 ml-2 flex-shrink-0">
              <span className={cn('num text-xl font-black', probColor)}>
                {(signal.probability_7d ?? signal.probability_score).toFixed(0)}%
              </span>
              <span className="text-[9px] text-muted-foreground">{probLabel} prob.</span>
              {signal.backtest_win_rate != null && (signal.backtest_sample_count ?? 0) >= 20 && (
                <span className={cn(
                  'flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border font-medium',
                  signal.backtest_win_rate >= 55
                    ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                    : signal.backtest_win_rate >= 45
                    ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10'
                    : 'border-red-500/30 text-red-400 bg-red-500/10'
                )}>
                  <History className="w-2.5 h-2.5" />
                  {signal.backtest_win_rate.toFixed(0)}% hist.
                </span>
              )}
            </div>
          </div>

          {/* Buy confirmation banner */}
          {signal.confirmation_checks != null && (
            <div className={cn(
              'flex items-center justify-between rounded-lg px-3 py-2 mb-3 border text-xs font-semibold',
              signal.buy_confirmed
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : (signal.confirmed_count ?? 0) >= 3
                ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            )}>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                {signal.buy_confirmed
                  ? 'BUY CONFIRMED'
                  : (signal.confirmed_count ?? 0) >= 3
                  ? 'WATCH — Wait for more signals'
                  : 'AVOID — Too many signals missing'
                }
              </span>
              <span className="text-[10px] font-normal opacity-80">
                {signal.confirmed_count}/5 checks passed
              </span>
            </div>
          )}

          {/* Probability bars — 3d / 7d / 15d */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-muted-foreground">3-Day</span>
                <span className={cn('num font-bold', probabilityColor(signal.probability_3d ?? 0))}>
                  {(signal.probability_3d ?? 0).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${signal.probability_3d ?? 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-muted-foreground">7-Day</span>
                <span className={cn('num font-bold', probColor)}>
                  {(signal.probability_7d ?? 0).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${signal.probability_7d ?? 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-muted-foreground">15-Day</span>
                <span className={cn('num font-bold', probabilityColor(signal.probability_15d ?? 0))}>
                  {(signal.probability_15d ?? 0).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${signal.probability_15d ?? 0}%` }} />
              </div>
            </div>
          </div>

          {/* Current Price row — always visible */}
          {hasLivePrice && (
            <div className={cn(
              'flex items-center justify-between rounded-lg px-3 py-1.5 mb-2 text-[11px] font-semibold border',
              (priceChangePct ?? 0) >= 0
                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            )}>
              <span className="flex items-center gap-1.5">
                <Radio className="w-3 h-3 animate-pulse" />
                Current Price
              </span>
              <span className="num">
                ₹{formatPrice(liveLtp!)}
                <span className="ml-1.5 text-[10px]">
                  {(priceChangePct ?? 0) >= 0 ? '+' : ''}{(priceChangePct ?? 0).toFixed(2)}%
                </span>
              </span>
            </div>
          )}

          {/* Price targets */}
          <div className={cn('grid gap-1.5 text-[10px] mb-3', signal.target_3d != null ? 'grid-cols-4' : 'grid-cols-3')}>
            <div className="glass rounded-lg p-2 text-center">
              <p className="text-muted-foreground mb-0.5">Entry</p>
              <p className="num font-bold">₹{formatPrice(signal.entry_price ?? 0)}</p>
            </div>
            {signal.target_3d != null && (
              <div className="glass rounded-lg p-2 text-center border-emerald-500/20">
                <div className="flex items-center justify-center gap-0.5 text-muted-foreground mb-0.5">
                  <Target className="w-2.5 h-2.5" />
                  <span>3d Target</span>
                </div>
                <p className="num font-bold text-emerald-400">₹{formatPrice(signal.target_3d)}</p>
                {signal.expected_return_3d != null && (
                  <p className="num text-[9px] text-emerald-500">+{signal.expected_return_3d.toFixed(1)}%</p>
                )}
              </div>
            )}
            <div className="glass rounded-lg p-2 text-center border-green-500/20">
              <div className="flex items-center justify-center gap-0.5 text-muted-foreground mb-0.5">
                <Target className="w-2.5 h-2.5" />
                <span>7d Target</span>
              </div>
              <p className="num font-bold text-green-400">₹{formatPrice(signal.target_7d ?? 0)}</p>
              {signal.expected_return_7d != null && (
                <p className="num text-[9px] text-green-500">+{signal.expected_return_7d.toFixed(1)}%</p>
              )}
            </div>
            <div className="glass rounded-lg p-2 text-center border-red-500/20">
              <div className="flex items-center justify-center gap-0.5 text-muted-foreground mb-0.5">
                <Shield className="w-2.5 h-2.5" />
                <span>Stop Loss</span>
              </div>
              <p className="num font-bold text-red-400">₹{formatPrice(signal.stop_loss ?? 0)}</p>
            </div>
          </div>

          {/* R/R + top reason */}
          <div className="flex items-center justify-between text-[10px] border-t border-border/50 pt-2">
            <span className="text-muted-foreground">Risk/Reward</span>
            <span className={cn('num font-bold', rr >= 2 ? 'text-green-400' : 'text-yellow-400')}>
              1:{rr.toFixed(1)}
            </span>
          </div>
          {signal.top_reasons?.[0] && (
            <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-1 italic">
              "{signal.top_reasons[0]}"
            </p>
          )}
        </div>
      </Link>

      {/* ── Expand/Collapse toggle ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-center gap-1.5 py-2 border-t border-border/50 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
      >
        {expanded ? (
          <><ChevronUp className="w-3 h-3" /> Hide Analysis</>
        ) : (
          <><ChevronDown className="w-3 h-3" /> Full Analysis & Sources</>
        )}
      </button>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div className="border-t border-border/50 p-4 space-y-4 bg-card/30">

          {/* Why this stock was selected */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Info className="w-3 h-3" /> Why This Stock Was Selected
            </h4>
            <p className="text-xs text-foreground/90 bg-primary/5 border border-primary/15 rounded-lg p-2.5">
              {selectionReason}
            </p>
          </div>

          {/* Score breakdown */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <BarChart2 className="w-3 h-3" /> Score Breakdown (How Probability is Calculated)
            </h4>
            <div className="space-y-2 bg-secondary/30 rounded-lg p-3">
              <ScoreBar label="Technical (45% weight) — EMA, MACD, RSI, Supertrend, ADX" value={techScore} color="text-green-400" />
              <ScoreBar label="Price Action (35% weight) — Trend alignment, BB, Candles" value={paScore} color="text-blue-400" />
              <ScoreBar label="Volume (10% weight) — Volume ratio, OBV, MFI" value={volScore} color="text-yellow-400" />
              <ScoreBar label="Options PCR (10% weight) — Put-Call Ratio sentiment" value={optScore} color="text-purple-400" />
              <div className="border-t border-border/50 pt-2 mt-2">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground font-medium">Composite Score</span>
                  <span className={cn('num font-black', probColor)}>
                    {signal.probability_score.toFixed(1)} / 100
                  </span>
                </div>
                <p className="text-[9px] text-muted-foreground mt-1">
                  Formula: (Tech×0.45) + (Price Action×0.35) + (Volume×0.10) + (Options×0.10)
                </p>
              </div>
            </div>
          </div>

          {/* Buy confirmation checklist */}
          {signal.confirmation_checks && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" /> Buy Confirmation Checklist
              </h4>
              <div className="space-y-1.5 bg-secondary/30 rounded-lg p-3">
                {([
                  { key: 'volume_surge',     label: 'Volume Surge',      detail: 'Today\'s volume ≥ 1.5× 20-day average — institutional buying' },
                  { key: 'rsi_healthy',      label: 'RSI Healthy',       detail: 'RSI between 30–70 — not overbought, not in free-fall' },
                  { key: 'ema_uptrend',      label: 'EMA Uptrend',       detail: 'Price > EMA21 > EMA50 — confirmed uptrend structure' },
                  { key: 'macd_positive',    label: 'MACD Positive',     detail: 'MACD histogram > 0 — momentum is bullish' },
                  { key: 'obv_accumulation', label: 'OBV Accumulation',  detail: '5-day OBV rising — money flowing into the stock' },
                ] as { key: keyof NonNullable<typeof signal.confirmation_checks>; label: string; detail: string }[]).map(({ key, label, detail }) => {
                  const passed = signal.confirmation_checks![key]
                  return (
                    <div key={key} className="flex items-start gap-2 text-[11px]">
                      {passed
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        : <XCircle     className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                      }
                      <div>
                        <span className={cn('font-semibold', passed ? 'text-emerald-400' : 'text-red-400')}>
                          {label}
                        </span>
                        <span className="text-muted-foreground ml-1.5">{detail}</span>
                      </div>
                    </div>
                  )
                })}
                <div className="border-t border-border/50 pt-2 mt-1 text-[10px] text-muted-foreground">
                  {signal.buy_confirmed
                    ? '✅ All 5 signals confirmed — this is a high-quality entry setup'
                    : `⚠️ Only ${signal.confirmed_count}/5 signals confirmed — wait for remaining checks to pass before entering`
                  }
                </div>
              </div>
            </div>
          )}

          {/* Historical backtest accuracy */}
          {signal.backtest_win_rate != null && (signal.backtest_sample_count ?? 0) >= 20 && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                <History className="w-3 h-3 text-blue-400" /> Historical Accuracy (Backtested)
              </h4>
              <div className="bg-secondary/30 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                  <div className={cn('rounded-md py-2', signal.backtest_win_rate >= 55 ? 'bg-emerald-500/15' : signal.backtest_win_rate >= 45 ? 'bg-yellow-500/15' : 'bg-red-500/15')}>
                    <div className="text-muted-foreground text-[9px]">Win Rate</div>
                    <div className={cn('num font-bold text-sm', signal.backtest_win_rate >= 55 ? 'text-emerald-400' : signal.backtest_win_rate >= 45 ? 'text-yellow-400' : 'text-red-400')}>
                      {signal.backtest_win_rate.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-secondary/40 rounded-md py-2">
                    <div className="text-muted-foreground text-[9px]">Sample Size</div>
                    <div className="num font-bold text-sm">{signal.backtest_sample_count}</div>
                  </div>
                  <div className={cn('rounded-md py-2', (signal.backtest_expectancy ?? 0) >= 0 ? 'bg-emerald-500/15' : 'bg-red-500/15')}>
                    <div className="text-muted-foreground text-[9px]">Expectancy</div>
                    <div className={cn('num font-bold text-sm', (signal.backtest_expectancy ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {(signal.backtest_expectancy ?? 0) >= 0 ? '+' : ''}{(signal.backtest_expectancy ?? 0).toFixed(2)}%
                    </div>
                  </div>
                </div>
                {/* Win rate bar */}
                <div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', signal.backtest_win_rate >= 55 ? 'bg-emerald-500' : signal.backtest_win_rate >= 45 ? 'bg-yellow-500' : 'bg-red-500')}
                      style={{ width: `${signal.backtest_win_rate}%` }}
                    />
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground leading-relaxed">
                  {signal.backtest_win_rate >= 55
                    ? `✅ This signal category (${signal.category}) has a strong historical win rate of ${signal.backtest_win_rate.toFixed(1)}% across ${signal.backtest_sample_count} trades. Positive expectancy confirms edge.`
                    : signal.backtest_win_rate >= 45
                    ? `⚡ Moderate historical accuracy for "${signal.category}" signals (${signal.backtest_win_rate.toFixed(1)}% win rate). Use tight stop-loss and confirm with volume.`
                    : `⚠️ "${signal.category}" signals have historically won only ${signal.backtest_win_rate.toFixed(1)}% of the time. Trade cautiously — use minimum position size.`
                  }
                </p>
              </div>
            </div>
          )}
          {signal.backtest_win_rate == null && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-secondary/20 rounded-lg p-2.5">
              <History className="w-3 h-3 flex-shrink-0" />
              No backtest data yet. Click "Calibrate Accuracy" on the screener page to compute historical win rates.
            </div>
          )}

          {/* Why high probability */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-green-400" /> Reasons for High Probability
            </h4>
            <ul className="space-y-1.5">
              {(signal.top_reasons ?? []).map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0 mt-0.5" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Risks */}
          {(signal.risks ?? []).length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-yellow-400" /> Risks & Cautions
              </h4>
              <ul className="space-y-1.5">
                {(signal.risks ?? []).map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <XCircle className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Scalping suitability detail */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Zap className="w-3 h-3 text-yellow-400" /> Scalping Suitability
            </h4>
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div className="bg-secondary/40 rounded-lg p-2 text-center">
                <p className="text-muted-foreground mb-0.5">Est. Hold</p>
                <p className="num font-bold">{holdDays}d</p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center">
                <p className="text-muted-foreground mb-0.5">R/R Ratio</p>
                <p className={cn('num font-bold', rr >= 2 ? 'text-green-400' : 'text-yellow-400')}>
                  1:{rr.toFixed(1)}
                </p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center">
                <p className="text-muted-foreground mb-0.5">15d Target</p>
                <p className="num font-bold text-blue-400">₹{formatPrice(signal.target_15d ?? 0)}</p>
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground mt-2 leading-relaxed">
              {rr >= 2 && holdDays <= 3
                ? '✅ Suitable for scalping — high R/R with short estimated hold. Enter near entry price, exit at 7d target, stop at stop-loss.'
                : rr >= 1.5 && holdDays <= 5
                ? '⚡ Better for swing trade (2–5 days). R/R is good but hold time suggests intraday scalping is risky.'
                : '📈 Positional trade recommended. Low R/R or longer hold — not ideal for scalping. Use as swing/positional setup.'}
            </p>
          </div>

          {/* Data sources */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Database className="w-3 h-3" /> Data Sources & Methodology
            </h4>
            <div className="space-y-1.5">
              {DATA_SOURCES.map(({ label, detail, icon: Icon }) => (
                <div key={label} className="flex items-start gap-2 text-[10px]">
                  <Icon className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground/90">{label}: </span>
                    <span className="text-muted-foreground">{detail}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground mt-2 leading-relaxed border-t border-border/50 pt-2">
              ⚠️ <strong>Disclaimer:</strong> This is an algorithmic signal based on historical price patterns and technical indicators. 
              It is NOT financial advice. Past performance does not guarantee future results. 
              Always use stop-loss and manage position size. Verify with your own analysis before trading.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
