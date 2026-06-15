'use client'

import { useQuery } from '@tanstack/react-query'
import { paperTradesApi, screenerApi, type PaperTrade, type StockSignal } from '@/lib/api'
import { useTicksStore } from '@/store'
import { cn } from '@/lib/utils'
import { TestTube2, Clock, Target, ShieldAlert, Eye, CheckCircle2, Circle, Zap } from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

function pct(n: number | null | undefined) {
  if (n == null) return '—'
  const v = Number(n)
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null) return '—'
  return n.toFixed(dec)
}

function rupee(n: number | null | undefined) {
  if (n == null) return '—'
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function daysAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 86400000
  if (diff < 1) return 'Today'
  if (diff < 2) return '1d ago'
  return `${Math.floor(diff)}d ago`
}

// ── Watching card — screener candidate not yet entered ────────────────────────

function WatchCard({ s, isEntered }: { s: StockSignal; isEntered: boolean }) {
  const tick = useTicksStore((st) => st.getTick(s.symbol))
  const ltp = tick?.ltp ?? s.entry_price
  const checks = s.confirmation_checks
  const confirmed = s.confirmed_count ?? 0
  const prob = s.probability_score ?? 0

  // probability colour gradient: 70-80 amber, 80-90 green, 90+ bright green
  const probColor =
    prob >= 90 ? 'text-green-300' : prob >= 80 ? 'text-green-400' : 'text-amber-400'
  const borderColor =
    prob >= 90
      ? 'border-green-500/40'
      : prob >= 80
      ? 'border-primary/30'
      : 'border-amber-500/20'

  return (
    <div
      className={cn(
        'glass rounded-xl p-4 border transition-colors relative overflow-hidden',
        borderColor,
        isEntered && 'opacity-60'
      )}
    >
      {/* Glow strip at top */}
      <div
        className={cn(
          'absolute top-0 left-0 right-0 h-0.5',
          prob >= 90 ? 'bg-green-400' : prob >= 80 ? 'bg-primary' : 'bg-amber-400'
        )}
      />

      {/* ENTERED badge */}
      {isEntered && (
        <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">
          ENTERED
        </span>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-sm">{s.symbol}</span>
            <span className="text-[10px] text-muted-foreground">{s.exchange}</span>
            {s.category && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                {s.category}
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {s.timeframe} · {s.estimated_hold_days ?? 3}d hold
          </div>
        </div>

        {/* Probability ring */}
        <div className="text-right">
          <div className={cn('font-bold text-lg leading-none num', probColor)}>
            {prob.toFixed(0)}%
          </div>
          <div className="text-[10px] text-muted-foreground">probability</div>
        </div>
      </div>

      {/* Probability bar */}
      <div className="w-full h-1.5 bg-secondary rounded-full mb-3 overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            prob >= 90 ? 'bg-green-400' : prob >= 80 ? 'bg-primary' : 'bg-amber-400'
          )}
          style={{ width: `${Math.min(100, prob)}%` }}
        />
      </div>

      {/* Price / Target / SL row */}
      <div className="grid grid-cols-3 gap-1 text-[10px] mb-3">
        <div className="text-center">
          <div className="text-muted-foreground mb-0.5">LTP</div>
          <div className="font-semibold">{ltp ? rupee(ltp) : rupee(s.entry_price)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground mb-0.5 flex items-center justify-center gap-0.5">
            <Target className="w-2.5 h-2.5 text-green-400" /> Target
          </div>
          <div className="text-green-400 font-semibold">{rupee(s.target_3d)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground mb-0.5 flex items-center justify-center gap-0.5">
            <ShieldAlert className="w-2.5 h-2.5 text-red-400" /> SL
          </div>
          <div className="text-red-400 font-semibold">{rupee(s.stop_loss)}</div>
        </div>
      </div>

      {/* Expected return & R:R */}
      {(s.expected_return_3d != null || s.risk_reward_ratio != null) && (
        <div className="flex gap-3 text-[10px] mb-3">
          {s.expected_return_3d != null && (
            <span>
              <span className="text-muted-foreground">E[R] </span>
              <span
                className={cn(
                  'font-semibold',
                  s.expected_return_3d >= 0 ? 'text-green-400' : 'text-red-400'
                )}
              >
                {pct(s.expected_return_3d)}
              </span>
            </span>
          )}
          {s.risk_reward_ratio != null && (
            <span>
              <span className="text-muted-foreground">R:R </span>
              <span className="font-semibold">{s.risk_reward_ratio.toFixed(1)}x</span>
            </span>
          )}
          {s.expected_return_7d != null && (
            <span>
              <span className="text-muted-foreground">7d E[R] </span>
              <span
                className={cn(
                  'font-semibold',
                  s.expected_return_7d >= 0 ? 'text-green-400' : 'text-red-400'
                )}
              >
                {pct(s.expected_return_7d)}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Confirmation checks */}
      {checks && (
        <div className="flex gap-1.5 flex-wrap mb-3">
          {(
            [
              ['VOL', checks.volume_surge],
              ['RSI', checks.rsi_healthy],
              ['EMA', checks.ema_uptrend],
              ['MACD', checks.macd_positive],
              ['OBV', checks.obv_accumulation],
            ] as [string, boolean][]
          ).map(([label, pass]) => (
            <span
              key={label}
              className={cn(
                'flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded',
                pass
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-secondary text-muted-foreground'
              )}
            >
              {pass ? (
                <CheckCircle2 className="w-2.5 h-2.5" />
              ) : (
                <Circle className="w-2.5 h-2.5" />
              )}
              {label}
            </span>
          ))}
          <span className="ml-auto text-[9px] text-muted-foreground">
            {confirmed}/5 checks
          </span>
        </div>
      )}

      {/* Top reasons */}
      {s.top_reasons?.slice(0, 2).map((r, i) => (
        <div key={i} className="text-[10px] text-muted-foreground flex items-start gap-1 leading-tight">
          <Zap className="w-2.5 h-2.5 text-primary mt-0.5 shrink-0" />
          <span>{r}</span>
        </div>
      ))}
    </div>
  )
}

// ── Open trade card (shows live unrealised P&L) ───────────────────────────────

function OpenTradeCard({ t }: { t: PaperTrade }) {
  const tick = useTicksStore((s) => s.getTick(t.symbol))
  const ltp = tick?.ltp ?? t.entry_price
  const unreal_pnl = (ltp - t.entry_price) * t.quantity
  const unreal_pct = ((ltp - t.entry_price) / t.entry_price) * 100
  const isUp = unreal_pnl >= 0

  const slDist = t.stop_loss ? ((t.entry_price - t.stop_loss) / t.entry_price * 100) : null
  const tgtDist = t.target_3d ? ((t.target_3d - t.entry_price) / t.entry_price * 100) : null

  return (
    <div className="glass rounded-xl p-4 border border-border hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">{t.symbol}</span>
            <span className="text-xs text-muted-foreground">{t.exchange}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              {t.category}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {t.probability_score?.toFixed(0)}% prob · {t.confirmed_count}/5 checks · {daysAgo(t.entry_time)}
          </div>
        </div>
        <div className={cn('text-right', isUp ? 'text-green-400' : 'text-red-400')}>
          <div className="font-bold text-sm">{isUp ? '+' : ''}₹{unreal_pnl.toFixed(0)}</div>
          <div className="text-xs">{pct(unreal_pct)}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
        <div className="text-center">
          <div className="text-muted-foreground mb-0.5">Entry</div>
          <div className="font-medium">{rupee(t.entry_price)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground mb-0.5">LTP</div>
          <div className={cn('font-bold', isUp ? 'text-green-400' : 'text-red-400')}>
            {rupee(ltp)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground mb-0.5">Qty</div>
          <div className="font-medium">{t.quantity}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <ShieldAlert className="w-3 h-3 text-red-400 shrink-0" />
        <span className="text-red-400">{rupee(t.stop_loss)}</span>
        {slDist != null && (
          <span className="text-muted-foreground">(-{slDist.toFixed(1)}%)</span>
        )}
        <span className="flex-1" />
        <Target className="w-3 h-3 text-green-400 shrink-0" />
        <span className="text-green-400">{rupee(t.target_3d)}</span>
        {tgtDist != null && (
          <span className="text-muted-foreground">(+{tgtDist.toFixed(1)}%)</span>
        )}
      </div>

      <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
        <Clock className="w-3 h-3" />
        Expires in ~{t.estimated_hold_days + 3}d from entry
      </div>
    </div>
  )
}

// ── Closed trade row ──────────────────────────────────────────────────────────

function ClosedRow({ t }: { t: PaperTrade }) {
  const isWin = t.status === 'WIN'
  return (
    <tr className="border-b border-border hover:bg-accent/30 transition-colors">
      <td className="px-3 py-2 font-medium text-sm">{t.symbol}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{t.category}</td>
      <td className="px-3 py-2 text-xs">{t.probability_score?.toFixed(0)}%</td>
      <td className="px-3 py-2 text-xs">{rupee(t.entry_price)}</td>
      <td className="px-3 py-2 text-xs">{rupee(t.exit_price)}</td>
      <td className={cn('px-3 py-2 text-xs font-medium', isWin ? 'text-green-400' : 'text-red-400')}>
        {pct(t.pnl_pct)} / {t.pnl_amount != null ? (t.pnl_amount >= 0 ? '+' : '') + '₹' + t.pnl_amount.toFixed(0) : '—'}
      </td>
      <td className="px-3 py-2 text-xs">
        <span className={cn(
          'px-1.5 py-0.5 rounded text-xs font-medium',
          t.status === 'WIN'  ? 'bg-green-500/10 text-green-400' :
          t.status === 'LOSS' ? 'bg-red-500/10 text-red-400' :
                                'bg-muted text-muted-foreground'
        )}>
          {t.exit_reason?.replace('_', ' ') ?? t.status}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {t.exit_time ? daysAgo(t.exit_time) : '—'}
      </td>
    </tr>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PaperTradesPage() {
  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ['paperTradeSummary'],
    queryFn: paperTradesApi.summary,
    refetchInterval: 60_000,
  })

  const { data: openTrades = [] } = useQuery({
    queryKey: ['paperTradesOpen'],
    queryFn: () => paperTradesApi.list('OPEN'),
    refetchInterval: 30_000,
  })

  const { data: closedTrades = [] } = useQuery({
    queryKey: ['paperTradesClosed'],
    queryFn: () => paperTradesApi.list(),
    refetchInterval: 60_000,
    select: (d) => d.filter((t) => t.status !== 'OPEN'),
  })

  // Top 10 STRONG_BUY candidates — wider threshold (≥70%) so there are always stocks to watch
  const { data: watching = [] } = useQuery({
    queryKey: ['paperTradesWatching'],
    queryFn: () =>
      screenerApi.signals({
        signal_type: 'STRONG_BUY',
        min_probability: 70,
        sort_by: 'probability_score',
        limit: 10,
      }),
    refetchInterval: 5 * 60_000,
    select: (d: StockSignal[]) => d.slice(0, 10),
  })

  const openSymbols = new Set(openTrades.map((t) => t.symbol))
  const winRate = summary?.win_rate
  const totalPnl = summary?.total_pnl ?? 0

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <TestTube2 className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Paper Trades</h1>
          <p className="text-xs text-muted-foreground">
            Auto-entered when screener finds a STRONG_BUY · ≥80% probability · 4+/5 checks · positive E[R] category
          </p>
        </div>
      </div>

      {/* Summary stats */}
      {!sumLoading && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: 'Open',      value: summary.open_count,  color: 'text-primary' },
            { label: 'Closed',    value: summary.closed_count, color: '' },
            { label: 'Wins',      value: summary.wins,        color: 'text-green-400' },
            { label: 'Losses',    value: summary.losses,      color: 'text-red-400' },
            {
              label: 'Win Rate',
              value: winRate != null ? winRate.toFixed(1) + '%' : '—',
              color: winRate != null && winRate >= 50 ? 'text-green-400' : 'text-red-400',
            },
            {
              label: 'Total P&L',
              value: (totalPnl >= 0 ? '+' : '') + '₹' + totalPnl.toFixed(0),
              color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400',
            },
            {
              label: 'Avg P&L',
              value: pct(summary.avg_pnl_pct),
              color: (summary.avg_pnl_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400',
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="glass rounded-xl p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">{label}</div>
              <div className={cn('font-bold text-base num', color)}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Watching — top 10 candidates ──────────────────────────────────── */}
      {watching.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold">Watching — Planning to Enter</h2>
            <span className="text-xs text-muted-foreground ml-1">
              Top {watching.length} STRONG_BUY · sorted by probability · auto-enters when ≥80% + 4/5 checks pass
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground italic">updates every 5 min</span>
          </div>

          {/* Colour legend */}
          <div className="flex gap-4 text-[10px] text-muted-foreground mb-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> ≥90% very strong
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-primary inline-block" /> ≥80% strong
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> 70–80% watching
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {watching.map((s) => (
              <WatchCard key={s.symbol} s={s} isEntered={openSymbols.has(s.symbol)} />
            ))}
          </div>
        </section>
      )}

      {/* ── Open positions ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Open Positions ({openTrades.length})
        </h2>
        {openTrades.length === 0 ? (
          <div className="glass rounded-xl p-6 text-center text-muted-foreground text-sm">
            No open paper trades yet. System auto-enters when a STRONG_BUY signal meets all criteria above.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {openTrades.map((t) => <OpenTradeCard key={t.id} t={t} />)}
          </div>
        )}
      </section>

      {/* ── Calibration by category ────────────────────────────────────────── */}
      {summary && summary.by_category.length > 0 && (
        <div className="glass rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Actual Outcomes by Category</h2>
          <div className="space-y-2">
            {summary.by_category.map((cat) => {
              const wr = cat.total > 0 ? (cat.wins / cat.total) * 100 : 0
              const isPos = (cat.avg_pnl_pct ?? 0) >= 0
              return (
                <div key={cat.category} className="flex items-center gap-3 text-xs">
                  <span className="w-36 truncate text-muted-foreground">{cat.category}</span>
                  <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', isPos ? 'bg-green-500' : 'bg-red-500')}
                      style={{ width: `${Math.min(100, wr)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-medium">{wr.toFixed(0)}% W</span>
                  <span className={cn('w-16 text-right', isPos ? 'text-green-400' : 'text-red-400')}>
                    {pct(cat.avg_pnl_pct)}
                  </span>
                  <span className="w-16 text-right text-muted-foreground">
                    {cat.wins}W / {cat.losses}L
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Closed trades table ────────────────────────────────────────────── */}
      {closedTrades.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3">Trade History ({closedTrades.length})</h2>
          <div className="glass rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    {['Symbol', 'Strategy', 'Prob', 'Entry', 'Exit', 'P&L', 'Outcome', 'When'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map((t) => <ClosedRow key={t.id} t={t} />)}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── Calibration note ──────────────────────────────────────────────── */}
      {summary && summary.closed_count > 0 && (
        <div className="glass rounded-xl p-4 border border-yellow-500/20 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1">Probability Calibration</div>
          Avg probability of winning trades:{' '}
          <span className="text-green-400 font-medium">{fmt(summary.avg_prob_wins)}%</span>
          {' '}· Avg probability of losing trades:{' '}
          <span className="text-red-400 font-medium">{fmt(summary.avg_prob_losses)}%</span>
          {' '}· Actual win rate:{' '}
          <span className="font-medium">{summary.win_rate?.toFixed(1) ?? '—'}%</span>.
          {' '}As more trades close, these numbers calibrate whether the model's probability scores are predictive.
        </div>
      )}
    </div>
  )
}
