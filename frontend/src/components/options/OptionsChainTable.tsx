'use client'

import { useMemo } from 'react'
import { cn, formatPrice, formatVolume } from '@/lib/utils'
import type { OptionsChain } from '@/lib/api'

interface OptionsChainTableProps {
  chain: OptionsChain
}

export function OptionsChainTable({ chain }: OptionsChainTableProps) {
  const underlying = chain.underlying_price

  const strikes = useMemo(() => {
    const allStrikes = new Set([
      ...Object.keys(chain.calls),
      ...Object.keys(chain.puts),
    ])
    return Array.from(allStrikes)
      .map(Number)
      .sort((a, b) => a - b)
  }, [chain])

  // Find ATM strike
  const atmStrike = strikes.reduce((prev, curr) =>
    Math.abs(curr - underlying) < Math.abs(prev - underlying) ? curr : prev
  , strikes[0])

  const maxOI = Math.max(
    ...Object.values(chain.calls).map((c) => c.oi),
    ...Object.values(chain.puts).map((p) => p.oi),
    1,
  )

  return (
    <div className="overflow-x-auto">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="glass rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Put-Call Ratio</p>
          <p className={cn('num text-lg font-bold mt-0.5', chain.pcr > 1.2 ? 'text-green-400' : chain.pcr < 0.8 ? 'text-red-400' : 'text-foreground')}>
            {chain.pcr.toFixed(2)}
          </p>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Max Pain</p>
          <p className="num text-lg font-bold mt-0.5">₹{formatPrice(chain.max_pain)}</p>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Underlying</p>
          <p className="num text-lg font-bold mt-0.5">₹{formatPrice(underlying)}</p>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            {/* CE headers */}
            <th className="py-2 text-right pr-2 font-medium">OI</th>
            <th className="py-2 text-right pr-2 font-medium">Vol</th>
            <th className="py-2 text-right pr-2 font-medium">IV%</th>
            <th className="py-2 text-right pr-2 font-medium text-green-400">LTP</th>
            {/* Strike */}
            <th className="py-2 text-center font-medium text-muted-foreground px-3">STRIKE</th>
            {/* PE headers */}
            <th className="py-2 text-left pl-2 font-medium text-red-400">LTP</th>
            <th className="py-2 text-left pl-2 font-medium">IV%</th>
            <th className="py-2 text-left pl-2 font-medium">Vol</th>
            <th className="py-2 text-left pl-2 font-medium">OI</th>
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike) => {
            const ce = chain.calls[String(strike)]
            const pe = chain.puts[String(strike)]
            const isATM = strike === atmStrike
            const isITM_CE = strike < underlying
            const isITM_PE = strike > underlying

            const ceOIWidth = ce ? (ce.oi / maxOI) * 100 : 0
            const peOIWidth = pe ? (pe.oi / maxOI) * 100 : 0

            return (
              <tr
                key={strike}
                className={cn(
                  'border-b border-border/30 hover:bg-accent/30 transition-colors',
                  isATM && 'bg-primary/5 border-primary/20'
                )}
              >
                {/* CE side */}
                <td className={cn('py-1.5 text-right pr-2 num', isITM_CE ? 'opacity-60' : '')}>
                  <div className="flex items-center justify-end gap-1">
                    {ce ? (
                      <>
                        <div className="h-1 bg-green-500/40 rounded" style={{ width: `${ceOIWidth * 0.4}px`, maxWidth: '60px' }} />
                        <span>{formatVolume(ce.oi)}</span>
                      </>
                    ) : '—'}
                  </div>
                </td>
                <td className={cn('py-1.5 text-right pr-2 num', isITM_CE ? 'opacity-60' : '')}>
                  {ce ? formatVolume(ce.volume) : '—'}
                </td>
                <td className={cn('py-1.5 text-right pr-2 num', isITM_CE ? 'opacity-60' : '')}>
                  {ce ? `${ce.iv.toFixed(1)}%` : '—'}
                </td>
                <td className="py-1.5 text-right pr-2 num font-medium text-green-400">
                  {ce ? `₹${formatPrice(ce.ltp)}` : '—'}
                </td>

                {/* Strike */}
                <td className={cn('py-1.5 text-center px-3 font-bold', isATM ? 'text-primary' : 'text-muted-foreground')}>
                  {formatPrice(strike, 0)}
                  {isATM && <span className="ml-1 text-[10px] text-primary">ATM</span>}
                </td>

                {/* PE side */}
                <td className="py-1.5 text-left pl-2 num font-medium text-red-400">
                  {pe ? `₹${formatPrice(pe.ltp)}` : '—'}
                </td>
                <td className={cn('py-1.5 text-left pl-2 num', isITM_PE ? 'opacity-60' : '')}>
                  {pe ? `${pe.iv.toFixed(1)}%` : '—'}
                </td>
                <td className={cn('py-1.5 text-left pl-2 num', isITM_PE ? 'opacity-60' : '')}>
                  {pe ? formatVolume(pe.volume) : '—'}
                </td>
                <td className={cn('py-1.5 text-left pl-2 num', isITM_PE ? 'opacity-60' : '')}>
                  {pe ? (
                    <div className="flex items-center gap-1">
                      <span>{formatVolume(pe.oi)}</span>
                      <div className="h-1 bg-red-500/40 rounded" style={{ width: `${peOIWidth * 0.4}px`, maxWidth: '60px' }} />
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
