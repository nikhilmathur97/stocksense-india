'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { useTicksStore } from '@/store'
import { cn, formatPrice, formatChangePct, formatVolume } from '@/lib/utils'
import { SparkLine } from '@/components/charts/SparkLine'
import type { Quote } from '@/lib/api'

interface QuoteCardProps {
  quote: Quote
  showDetails?: boolean
}

export function QuoteCard({ quote: initialQuote, showDetails = false }: QuoteCardProps) {
  const tick = useTicksStore((s) => s.ticks[initialQuote.symbol])
  const quote = tick || initialQuote
  const prevLtp = useRef(quote.ltp)
  const [flashClass, setFlashClass] = useState('')
  const [priceHistory, setPriceHistory] = useState<number[]>([])

  useEffect(() => {
    if (quote.ltp === prevLtp.current) return
    const cls = quote.ltp > prevLtp.current ? 'price-up' : 'price-down'
    setFlashClass(cls)
    prevLtp.current = quote.ltp
    const t = setTimeout(() => setFlashClass(''), 600)

    // Track price history for sparkline
    setPriceHistory(prev => {
      const next = [...prev, quote.ltp].slice(-20)
      return next
    })

    return () => clearTimeout(t)
  }, [quote.ltp])

  // Generate synthetic sparkline data from OHLC if no history
  const sparkData = priceHistory.length >= 3
    ? priceHistory
    : generateSparkFromOHLC(quote)

  const positive = quote.change_pct >= 0

  return (
    <Link href={`/stocks/${quote.symbol}`}>
      <div className={cn(
        'glass-hover rounded-xl p-4 cursor-pointer group',
        flashClass,
        positive ? 'hover:glow-green' : 'hover:glow-red'
      )}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-semibold text-sm group-hover:text-primary transition-colors">{quote.symbol}</p>
            <p className="text-[10px] text-muted-foreground">{quote.exchange}</p>
          </div>
          <div className={cn(
            'flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md',
            positive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
          )}>
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {formatChangePct(quote.change_pct)}
          </div>
        </div>

        {/* Price + Sparkline row */}
        <div className="flex items-end justify-between">
          <div>
            <p className="num text-xl font-bold">₹{formatPrice(quote.ltp)}</p>
            <p className={cn('num text-xs mt-0.5', positive ? 'text-green-400' : 'text-red-400')}>
              {positive ? '+' : ''}₹{formatPrice(quote.change)}
            </p>
          </div>
          <SparkLine
            data={sparkData}
            width={70}
            height={28}
            className="opacity-80 group-hover:opacity-100 transition-opacity"
          />
        </div>

        {showDetails && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 pt-3 border-t border-border/50">
            <div>
              <p className="text-[10px] text-muted-foreground">Open</p>
              <p className="num text-xs font-medium">₹{formatPrice(quote.open)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Volume</p>
              <p className="num text-xs font-medium">{formatVolume(quote.volume)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">High</p>
              <p className="num text-xs font-medium text-green-400">₹{formatPrice(quote.high)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Low</p>
              <p className="num text-xs font-medium text-red-400">₹{formatPrice(quote.low)}</p>
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}

/**
 * Generate a synthetic sparkline from OHLC data when no tick history is available.
 * Creates a realistic-looking intraday path.
 */
function generateSparkFromOHLC(quote: Quote): number[] {
  const { open, high, low, ltp } = quote
  if (!open || !high || !low) return [ltp, ltp]

  // Create a path: open → dip/peak → mid → peak/dip → close
  const mid = (high + low) / 2
  const isUp = ltp >= open

  if (isUp) {
    return [open, open * 0.998, low, mid, high * 0.998, high, ltp * 0.999, ltp]
  } else {
    return [open, open * 1.002, high, mid, low * 1.002, low, ltp * 1.001, ltp]
  }
}
