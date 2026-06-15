'use client'

import { useQuery } from '@tanstack/react-query'
import { paperTradesApi, type PaperTrade } from '@/lib/api'
import { useTicksStore } from '@/store'
import { cn } from '@/lib/utils'
import { TestTube2, Clock, Target, ShieldAlert } from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null) return '—'
  return n.toFixed(dec)
}

function pct(n: number | null | undefined) {
  if (n == null) return '—'
  const v = Number(n)
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
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
      {/* Header */}
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
        {/* Live P&L */}
        <div className={cn('text-right', isUp ? 'text-green-400' : 'text-red-400')}>
          <div className="font-bold text-sm">{isUp ? '+' : ''}₹{unreal_pnl.toFixed(0)}</div>
          <div className="text-xs">{pct(unreal_pct)}</div>
        </div>
      </div>

      {/* Price bar */}
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

      {/* Target / SL bar */}
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

      {/* Estimated expiry */}
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
            { label: 'Open',       value: summary.open_count,   color: 'text-primary' },
            { label: 'Closed',     value: summary.closed_count, color: '' },
            { label: 'Wins',       value: summary.wins,         color: 'text-green-400' },
            { label: 'Losses',     value: summary.losses,       color: 'text-red-400' },
            { label: 'Win Rate',
              value: winRate != null ? winRate.toFixed(1) + '%' : '—',
              color: winRate != null && winRate >= 50 ? 'text-green-400' : 'text-red-400' },
            { label: 'Total P&L',
              value: (totalPnl >= 0 ? '+' : '') + '₹' + totalPnl.toFixed(0),
              color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
            { label: 'Avg P&L',
              value: pct(summary.avg_pnl_pct),
              color: (summary.avg_pnl_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="glass rounded-xl p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">{label}</div>
              <div className={cn('font-bold text-base num', color)}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Calibration: predicted probability vs actual win rate */}
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

      {/* Open positions */}
      <section>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Open Positions ({openTrades.length})
        </h2>
        {openTrades.length === 0 ? (
          <div className="glass rounded-xl p-8 text-center text-muted-foreground text-sm">
            No open paper trades. The screener will auto-enter trades when a qualifying signal appears.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {openTrades.map((t) => <OpenTradeCard key={t.id} t={t} />)}
          </div>
        )}
      </section>

      {/* Closed trades table */}
      {closedTrades.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3">
            Trade History ({closedTrades.length})
          </h2>
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

      {/* Confidence calibration note */}
      {summary && summary.closed_count > 0 && (
        <div className="glass rounded-xl p-4 border border-yellow-500/20 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1">Probability Calibration</div>
          Avg probability of winning trades: <span className="text-green-400 font-medium">{fmt(summary.avg_prob_wins)}%</span>
          {' '}· Avg probability of losing trades: <span className="text-red-400 font-medium">{fmt(summary.avg_prob_losses)}%</span>
          {' '}· Actual win rate: <span className="font-medium">{summary.win_rate?.toFixed(1) ?? '—'}%</span>.
          {' '}As more trades close, these numbers calibrate whether the model's probability scores are predictive.
        </div>
      )}
    </div>
  )
}
