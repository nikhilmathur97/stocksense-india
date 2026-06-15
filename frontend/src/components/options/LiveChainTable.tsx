'use client'

import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChainStrike, OptionData } from '@/lib/api'

interface LiveChainTableProps {
  strikes: ChainStrike[]
  underlying: number
  atm: number
  isFetching?: boolean
  lastUpdated?: Date
  selectedStrike?: number | null
  onSelectStrike?: (strike: number) => void
}

function fmtL(v: number | undefined | null): string {
  if (v == null || v === 0) return '—'
  const abs = Math.abs(v)
  if (abs >= 10_000_000) return `${(abs / 10_000_000).toFixed(2)}Cr`
  if (abs >= 100_000) return `${(abs / 100_000).toFixed(2)}L`
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`
  return String(abs)
}

function fmtLTP(v: number | undefined | null): string {
  if (!v) return '—'
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function OIChangeCell({ val }: { val: number | undefined | null }) {
  if (val == null || val === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('num', val > 0 ? 'text-emerald-400' : 'text-red-400')}>
      {val > 0 ? '+' : '-'}{fmtL(val)}
    </span>
  )
}

export function LiveChainTable({
  strikes,
  underlying,
  atm,
  isFetching = false,
  lastUpdated,
  selectedStrike,
  onSelectStrike,
}: LiveChainTableProps) {
  // Find max OI for CE and PE separately
  const { maxCeOI, maxPeOI } = useMemo(() => {
    let maxCe = 0, maxPe = 0
    for (const s of strikes) {
      if (s.ce?.oi && s.ce.oi > maxCe) maxCe = s.ce.oi
      if (s.pe?.oi && s.pe.oi > maxPe) maxPe = s.pe.oi
    }
    return { maxCeOI: maxCe, maxPeOI: maxPe }
  }, [strikes])

  return (
    <div>
      {/* Table header with refresh indicator */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>ATM ±{Math.floor(strikes.length / 2)} strikes</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
            Orange = highest OI wall
          </span>
          {onSelectStrike && (
            <>
              <span>·</span>
              <span className="text-primary">Click a strike to track its live premium</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastUpdated && (
            <span>Updated {lastUpdated.toLocaleTimeString('en-IN')}</span>
          )}
          <span className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px]',
            isFetching
              ? 'border-yellow-400/40 text-yellow-400 bg-yellow-400/10'
              : 'border-emerald-400/40 text-emerald-400 bg-emerald-400/10'
          )}>
            <RefreshCw className={cn('w-2.5 h-2.5', isFetching && 'animate-spin')} />
            {isFetching ? 'Updating' : 'Live · 15s'}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead>
            <tr className="border-b border-border">
              {/* CE headers — green tint */}
              <th className="py-2 text-right pr-1 font-medium text-emerald-400/70 w-14">Vol</th>
              <th className="py-2 text-right pr-1 font-medium text-emerald-400/70 w-16">OI</th>
              <th className="py-2 text-right pr-1 font-medium text-emerald-400/70 w-16">ΔOI</th>
              <th className="py-2 text-right pr-1 font-medium text-emerald-400/70 w-10">IV%</th>
              <th className="py-2 text-right pr-1 font-medium text-emerald-400/70 w-10">Δ</th>
              <th className="py-2 text-right pr-3 font-bold text-emerald-400 w-20">CE LTP</th>
              {/* Strike */}
              <th className="py-2 text-center font-bold text-foreground px-2 w-24">STRIKE</th>
              {/* PE headers — red tint */}
              <th className="py-2 text-left pl-3 font-bold text-red-400 w-20">PE LTP</th>
              <th className="py-2 text-left pl-1 font-medium text-red-400/70 w-10">Δ</th>
              <th className="py-2 text-left pl-1 font-medium text-red-400/70 w-10">IV%</th>
              <th className="py-2 text-left pl-1 font-medium text-red-400/70 w-16">ΔOI</th>
              <th className="py-2 text-left pl-1 font-medium text-red-400/70 w-16">OI</th>
              <th className="py-2 text-left pl-1 font-medium text-red-400/70 w-14">Vol</th>
            </tr>
          </thead>
          <tbody>
            {strikes.map(({ strike, is_atm, ce, pe }) => {
              const isITM_CE = strike < underlying
              const isITM_PE = strike > underlying
              const isMaxCeOI = ce?.oi === maxCeOI && maxCeOI > 0
              const isMaxPeOI = pe?.oi === maxPeOI && maxPeOI > 0
              const isSelected = selectedStrike === strike

              return (
                <tr
                  key={strike}
                  onClick={onSelectStrike ? () => onSelectStrike(strike) : undefined}
                  className={cn(
                    'border-b border-border/30 hover:bg-accent/20 transition-colors',
                    is_atm && 'bg-blue-500/8 border-blue-500/30',
                    onSelectStrike && 'cursor-pointer',
                    isSelected && 'bg-primary/10 ring-1 ring-inset ring-primary/50'
                  )}
                >
                  {/* CE Vol */}
                  <td className={cn('py-1.5 text-right pr-1 num', isITM_CE && 'opacity-40')}>
                    {fmtL(ce?.volume)}
                  </td>
                  {/* CE OI */}
                  <td className={cn(
                    'py-1.5 text-right pr-1 num',
                    isITM_CE && 'opacity-40',
                    isMaxCeOI && 'bg-orange-400/15 text-orange-400 font-semibold rounded'
                  )}>
                    {fmtL(ce?.oi)}
                  </td>
                  {/* CE ΔOI */}
                  <td className={cn('py-1.5 text-right pr-1', isITM_CE && 'opacity-40')}>
                    <OIChangeCell val={ce?.change_in_oi} />
                  </td>
                  {/* CE IV */}
                  <td className={cn('py-1.5 text-right pr-1 num', isITM_CE && 'opacity-40')}>
                    {ce?.iv ? ce.iv.toFixed(1) : '—'}
                  </td>
                  {/* CE Delta */}
                  <td className={cn('py-1.5 text-right pr-1 num text-blue-400', isITM_CE && 'opacity-40')}>
                    {ce?.delta != null ? ce.delta.toFixed(2) : '—'}
                  </td>
                  {/* CE LTP */}
                  <td className="py-1.5 text-right pr-3">
                    <span
                      className="num font-semibold text-emerald-400 cursor-help"
                      title={ce ? `Bid: ₹${ce.bid?.toFixed(2) ?? '—'} | Ask: ₹${ce.ask?.toFixed(2) ?? '—'}` : ''}
                    >
                      {fmtLTP(ce?.ltp)}
                    </span>
                  </td>

                  {/* Strike */}
                  <td className={cn(
                    'py-1.5 text-center px-2 font-bold text-sm',
                    is_atm ? 'text-blue-400' : 'text-muted-foreground'
                  )}>
                    {strike.toLocaleString('en-IN')}
                    {is_atm && (
                      <span className="ml-1 text-[9px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded">ATM</span>
                    )}
                  </td>

                  {/* PE LTP */}
                  <td className="py-1.5 text-left pl-3">
                    <span
                      className="num font-semibold text-red-400 cursor-help"
                      title={pe ? `Bid: ₹${pe.bid?.toFixed(2) ?? '—'} | Ask: ₹${pe.ask?.toFixed(2) ?? '—'}` : ''}
                    >
                      {fmtLTP(pe?.ltp)}
                    </span>
                  </td>
                  {/* PE Delta */}
                  <td className={cn('py-1.5 text-left pl-1 num text-blue-400', isITM_PE && 'opacity-40')}>
                    {pe?.delta != null ? pe.delta.toFixed(2) : '—'}
                  </td>
                  {/* PE IV */}
                  <td className={cn('py-1.5 text-left pl-1 num', isITM_PE && 'opacity-40')}>
                    {pe?.iv ? pe.iv.toFixed(1) : '—'}
                  </td>
                  {/* PE ΔOI */}
                  <td className={cn('py-1.5 text-left pl-1', isITM_PE && 'opacity-40')}>
                    <OIChangeCell val={pe?.change_in_oi} />
                  </td>
                  {/* PE OI */}
                  <td className={cn(
                    'py-1.5 text-left pl-1 num',
                    isITM_PE && 'opacity-40',
                    isMaxPeOI && 'bg-orange-400/15 text-orange-400 font-semibold rounded'
                  )}>
                    {fmtL(pe?.oi)}
                  </td>
                  {/* PE Vol */}
                  <td className={cn('py-1.5 text-left pl-1 num', isITM_PE && 'opacity-40')}>
                    {fmtL(pe?.volume)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
