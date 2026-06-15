'use client'

import { Target, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChainStrike, OptionData } from '@/lib/api'

interface SelectedStrikePanelProps {
  row: ChainStrike | null
  underlying: number
  symbol: string
  expiry?: string
  isFetching?: boolean
  lastUpdated?: Date
}

function ltp(v: number | undefined | null): string {
  if (v == null) return '—'
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function compact(v: number | undefined | null): string {
  if (v == null || v === 0) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e7) return `${(abs / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(1)}K`
  return String(abs)
}

// One side (Call or Put) of the selected strike.
function Leg({
  kind,
  data,
  moneyness,
}: {
  kind: 'CE' | 'PE'
  data: OptionData | null
  moneyness: 'ITM' | 'OTM' | 'ATM'
}) {
  const isCall = kind === 'CE'
  const accent = isCall ? 'emerald' : 'red'
  const spread =
    data?.bid != null && data?.ask != null ? Math.max(0, data.ask - data.bid) : null

  return (
    <div
      className={cn(
        'flex-1 rounded-lg border p-3',
        isCall ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {isCall ? (
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-red-400" />
          )}
          <span className={cn('text-xs font-bold', isCall ? 'text-emerald-400' : 'text-red-400')}>
            {isCall ? 'CALL (CE)' : 'PUT (PE)'}
          </span>
        </div>
        <span
          className={cn(
            'text-[9px] font-semibold px-1.5 py-0.5 rounded border',
            moneyness === 'ATM'
              ? 'border-blue-400/40 text-blue-400 bg-blue-400/10'
              : moneyness === 'ITM'
              ? 'border-amber-400/40 text-amber-400 bg-amber-400/10'
              : 'border-muted-foreground/30 text-muted-foreground'
          )}
        >
          {moneyness}
        </span>
      </div>

      {/* Live premium — the headline number */}
      <div className="flex items-baseline gap-1">
        <span className="text-xs text-muted-foreground">₹</span>
        <span className={cn('text-3xl font-bold num tabular-nums', isCall ? 'text-emerald-400' : 'text-red-400')}>
          {ltp(data?.ltp)}
        </span>
        <span className="text-[10px] text-muted-foreground ml-1">LTP / premium</span>
      </div>

      {/* Bid / Ask */}
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Bid <span className="text-foreground num">₹{ltp(data?.bid)}</span></span>
        <span>·</span>
        <span>Ask <span className="text-foreground num">₹{ltp(data?.ask)}</span></span>
        {spread != null && (
          <span className={cn('ml-auto num', spread > (data?.ltp ?? 0) * 0.02 ? 'text-yellow-400' : 'text-muted-foreground')}>
            spread ₹{spread.toFixed(2)}
          </span>
        )}
      </div>

      {/* Greeks / OI row */}
      <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
        {[
          { label: 'IV%', value: data?.iv != null ? data.iv.toFixed(1) : '—' },
          { label: 'Δ', value: data?.delta != null ? data.delta.toFixed(2) : '—' },
          { label: 'OI', value: compact(data?.oi) },
          { label: 'Vol', value: compact(data?.volume) },
        ].map((m) => (
          <div key={m.label} className={cn('rounded-md py-1', isCall ? 'bg-emerald-500/10' : 'bg-red-500/10')}>
            <div className="text-[9px] text-muted-foreground">{m.label}</div>
            <div className="text-[11px] font-semibold num">{m.value}</div>
          </div>
        ))}
      </div>

      {/* One-lot cost hint */}
      {data?.ltp != null && (
        <div className="mt-2 text-[10px] text-muted-foreground">
          ΔOI{' '}
          <span className={cn('num', (data.change_in_oi ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {(data.change_in_oi ?? 0) >= 0 ? '+' : '-'}{compact(data.change_in_oi)}
          </span>{' '}
          · γ <span className="num text-foreground">{data.gamma != null ? data.gamma.toFixed(4) : '—'}</span>
          {' '}· θ <span className="num text-foreground">{data.theta != null ? data.theta.toFixed(2) : '—'}</span>
        </div>
      )}
    </div>
  )
}

export function SelectedStrikePanel({
  row,
  underlying,
  symbol,
  expiry,
  isFetching = false,
  lastUpdated,
}: SelectedStrikePanelProps) {
  const moneyness = (forCall: boolean): 'ITM' | 'OTM' | 'ATM' => {
    if (!row) return 'ATM'
    if (row.is_atm) return 'ATM'
    if (forCall) return row.strike < underlying ? 'ITM' : 'OTM'
    return row.strike > underlying ? 'ITM' : 'OTM'
  }

  return (
    <div className="glass rounded-xl p-4 border border-primary/30">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">Selected Strike — Live Premium</span>
          {row && (
            <span className="text-sm font-bold text-primary num">
              {symbol} {row.strike.toLocaleString('en-IN')}
            </span>
          )}
          {expiry && <span className="text-xs text-muted-foreground">· {expiry}</span>}
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full border',
              isFetching
                ? 'border-yellow-400/40 text-yellow-400 bg-yellow-400/10'
                : 'border-emerald-400/40 text-emerald-400 bg-emerald-400/10'
            )}
          >
            <RefreshCw className={cn('w-2.5 h-2.5', isFetching && 'animate-spin')} />
            {isFetching ? 'Updating' : 'Live · 15s'}
          </span>
          {lastUpdated && (
            <span className="text-muted-foreground">{lastUpdated.toLocaleTimeString('en-IN')}</span>
          )}
        </div>
      </div>

      {row ? (
        <div className="flex flex-col sm:flex-row gap-3">
          <Leg kind="CE" data={row.ce} moneyness={moneyness(true)} />
          <Leg kind="PE" data={row.pe} moneyness={moneyness(false)} />
        </div>
      ) : (
        <div className="text-sm text-muted-foreground text-center py-6">
          Click any strike in the chain below to track its live premium here.
        </div>
      )}
    </div>
  )
}
