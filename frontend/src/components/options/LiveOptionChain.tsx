'use client'

import { useMemo } from 'react'
import { cn, formatPrice } from '@/lib/utils'
import type { ChainStrike } from '@/lib/api'

interface LiveOptionChainProps {
  strikes: ChainStrike[]
  underlying: number
  atm: number
}

function fmt(v: number | undefined | null, decimals = 0) {
  if (v == null || v === 0) return '—'
  return formatPrice(v, decimals)
}

function fmtK(v: number | undefined | null) {
  if (v == null || v === 0) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(v)
}

export function LiveOptionChain({ strikes, underlying, atm }: LiveOptionChainProps) {
  const maxOI = useMemo(() => {
    let m = 1
    for (const s of strikes) {
      if (s.ce?.oi && s.ce.oi > m) m = s.ce.oi
      if (s.pe?.oi && s.pe.oi > m) m = s.pe.oi
    }
    return m
  }, [strikes])

  return (
    <div className="overflow-x-auto">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[10px] text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500/60 inline-block" /> CE (Call)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/60 inline-block" /> PE (Put)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary/60 inline-block" /> ATM Strike</span>
        <span className="ml-auto text-[10px]">Underlying: <span className="text-foreground font-medium num">₹{formatPrice(underlying, 0)}</span></span>
      </div>

      <table className="w-full text-xs min-w-[700px]">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {/* CE side */}
            <th className="py-2 text-right pr-1 font-medium w-16">OI</th>
            <th className="py-2 text-right pr-1 font-medium w-14">Chg OI</th>
            <th className="py-2 text-right pr-1 font-medium w-12">Vol</th>
            <th className="py-2 text-right pr-1 font-medium w-10">IV%</th>
            <th className="py-2 text-right pr-1 font-medium w-10">Δ</th>
            <th className="py-2 text-right pr-2 font-medium text-green-400 w-16">CE LTP</th>
            {/* Strike */}
            <th className="py-2 text-center font-bold px-3 w-24 text-foreground">STRIKE</th>
            {/* PE side */}
            <th className="py-2 text-left pl-2 font-medium text-red-400 w-16">PE LTP</th>
            <th className="py-2 text-left pl-1 font-medium w-10">Δ</th>
            <th className="py-2 text-left pl-1 font-medium w-10">IV%</th>
            <th className="py-2 text-left pl-1 font-medium w-12">Vol</th>
            <th className="py-2 text-left pl-1 font-medium w-14">Chg OI</th>
            <th className="py-2 text-left pl-1 font-medium w-16">OI</th>
          </tr>
        </thead>
        <tbody>
          {strikes.map(({ strike, is_atm, ce, pe }) => {
            const isITM_CE = strike < underlying
            const isITM_PE = strike > underlying
            const ceOIBar = ce?.oi ? (ce.oi / maxOI) * 60 : 0
            const peOIBar = pe?.oi ? (pe.oi / maxOI) * 60 : 0

            return (
              <tr
                key={strike}
                className={cn(
                  'border-b border-border/30 hover:bg-accent/20 transition-colors',
                  is_atm && 'bg-primary/8 border-primary/30'
                )}
              >
                {/* CE OI */}
                <td className={cn('py-1.5 text-right pr-1 num', isITM_CE && 'opacity-50')}>
                  <div className="flex items-center justify-end gap-1">
                    {ce?.oi ? (
                      <>
                        <div
                          className="h-1.5 bg-green-500/50 rounded-sm shrink-0"
                          style={{ width: `${ceOIBar}px` }}
                        />
                        <span>{fmtK(ce.oi)}</span>
                      </>
                    ) : '—'}
                  </div>
                </td>
                {/* CE Chg OI */}
                <td className={cn('py-1.5 text-right pr-1 num', isITM_CE && 'opacity-50')}>
                  {ce?.change_in_oi != null && ce.change_in_oi !== 0 ? (
                    <span className={ce.change_in_oi > 0 ? 'text-green-400' : 'text-red-400'}>
                      {ce.change_in_oi > 0 ? '+' : ''}{fmtK(ce.change_in_oi)}
                    </span>
                  ) : '—'}
                </td>
                {/* CE Vol */}
                <td className={cn('py-1.5 text-right pr-1 num', isITM_CE && 'opacity-50')}>
                  {fmtK(ce?.volume)}
                </td>
                {/* CE IV */}
                <td className={cn('py-1.5 text-right pr-1 num', isITM_CE && 'opacity-50')}>
                  {ce?.iv ? `${ce.iv.toFixed(1)}` : '—'}
                </td>
                {/* CE Delta */}
                <td className={cn('py-1.5 text-right pr-1 num text-blue-400', isITM_CE && 'opacity-50')}>
                  {ce?.delta ? ce.delta.toFixed(2) : '—'}
                </td>
                {/* CE LTP */}
                <td className="py-1.5 text-right pr-2 num font-semibold text-green-400">
                  {ce?.ltp ? `₹${fmt(ce.ltp, 2)}` : '—'}
                </td>

                {/* Strike */}
                <td className={cn(
                  'py-1.5 text-center px-3 font-bold text-sm',
                  is_atm ? 'text-primary' : 'text-muted-foreground'
                )}>
                  {formatPrice(strike, 0)}
                  {is_atm && (
                    <span className="ml-1 text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded">ATM</span>
                  )}
                </td>

                {/* PE LTP */}
                <td className="py-1.5 text-left pl-2 num font-semibold text-red-400">
                  {pe?.ltp ? `₹${fmt(pe.ltp, 2)}` : '—'}
                </td>
                {/* PE Delta */}
                <td className={cn('py-1.5 text-left pl-1 num text-blue-400', isITM_PE && 'opacity-50')}>
                  {pe?.delta ? pe.delta.toFixed(2) : '—'}
                </td>
                {/* PE IV */}
                <td className={cn('py-1.5 text-left pl-1 num', isITM_PE && 'opacity-50')}>
                  {pe?.iv ? `${pe.iv.toFixed(1)}` : '—'}
                </td>
                {/* PE Vol */}
                <td className={cn('py-1.5 text-left pl-1 num', isITM_PE && 'opacity-50')}>
                  {fmtK(pe?.volume)}
                </td>
                {/* PE Chg OI */}
                <td className={cn('py-1.5 text-left pl-1 num', isITM_PE && 'opacity-50')}>
                  {pe?.change_in_oi != null && pe.change_in_oi !== 0 ? (
                    <span className={pe.change_in_oi > 0 ? 'text-green-400' : 'text-red-400'}>
                      {pe.change_in_oi > 0 ? '+' : ''}{fmtK(pe.change_in_oi)}
                    </span>
                  ) : '—'}
                </td>
                {/* PE OI */}
                <td className={cn('py-1.5 text-left pl-1 num', isITM_PE && 'opacity-50')}>
                  {pe?.oi ? (
                    <div className="flex items-center gap-1">
                      <span>{fmtK(pe.oi)}</span>
                      <div
                        className="h-1.5 bg-red-500/50 rounded-sm shrink-0"
                        style={{ width: `${peOIBar}px` }}
                      />
                    </div>
                  ) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
