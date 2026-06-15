'use client'

import { TrendingUp, TrendingDown, Minus, Activity, BarChart2, Shield, Zap } from 'lucide-react'
import { cn, formatPrice } from '@/lib/utils'
import type { MarketContext } from '@/lib/api'

interface MarketContextPanelProps {
  ctx: MarketContext
  symbol: string
  expiry: string
}

export function MarketContextPanel({ ctx, symbol, expiry }: MarketContextPanelProps) {
  const trendColor = ctx.market_trend === 'BULLISH'
    ? 'text-green-400' : ctx.market_trend === 'BEARISH'
    ? 'text-red-400' : 'text-yellow-400'

  const trendBg = ctx.market_trend === 'BULLISH'
    ? 'bg-green-500/10 border-green-500/30' : ctx.market_trend === 'BEARISH'
    ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/10 border-yellow-500/30'

  const TrendIcon = ctx.market_trend === 'BULLISH'
    ? TrendingUp : ctx.market_trend === 'BEARISH'
    ? TrendingDown : Minus

  const pcrColor = ctx.pcr > 1.2 ? 'text-green-400' : ctx.pcr < 0.8 ? 'text-red-400' : 'text-yellow-400'
  const pcrLabel = ctx.pcr > 1.2 ? 'Bullish' : ctx.pcr < 0.8 ? 'Bearish' : 'Neutral'

  const ivRankColor = ctx.iv_rank > 70 ? 'text-red-400' : ctx.iv_rank > 40 ? 'text-yellow-400' : 'text-green-400'
  const ivRankLabel = ctx.iv_rank > 70 ? 'High IV — sell premium' : ctx.iv_rank > 40 ? 'Moderate IV' : 'Low IV — buy premium'

  const now = new Date(ctx.timestamp)
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className="glass rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            Market Context
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {symbol} · Expiry: {expiry} · Updated {timeStr}
          </p>
        </div>
        <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-bold', trendBg, trendColor)}>
          <TrendIcon className="w-4 h-4" />
          {ctx.market_trend}
        </div>
      </div>

      {/* Underlying + ATM */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-secondary/60 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Underlying</p>
          <p className="num font-bold text-lg">₹{formatPrice(ctx.underlying_price, 0)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">NIFTY 50 Spot</p>
        </div>
        <div className="bg-secondary/60 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">ATM Strike</p>
          <p className="num font-bold text-lg text-primary">₹{formatPrice(ctx.atm_strike, 0)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">At-The-Money</p>
        </div>
        <div className="bg-secondary/60 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Max Pain</p>
          <p className="num font-bold text-lg text-yellow-400">₹{formatPrice(ctx.max_pain, 0)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {ctx.underlying_price > ctx.max_pain ? 'Above max pain ↑' : 'Below max pain ↓'}
          </p>
        </div>
        <div className="bg-secondary/60 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">VIX Est.</p>
          <p className={cn('num font-bold text-lg', ctx.vix_estimate > 20 ? 'text-red-400' : ctx.vix_estimate > 15 ? 'text-yellow-400' : 'text-green-400')}>
            {ctx.vix_estimate.toFixed(1)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {ctx.vix_estimate > 20 ? 'High volatility' : ctx.vix_estimate > 15 ? 'Moderate' : 'Low volatility'}
          </p>
        </div>
      </div>

      {/* PCR + IV Rank + Support/Resistance */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* PCR */}
        <div className="bg-secondary/60 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
            <BarChart2 className="w-3 h-3" /> PCR
          </p>
          <p className={cn('num font-bold text-lg', pcrColor)}>{ctx.pcr.toFixed(2)}</p>
          <p className={cn('text-[10px] mt-0.5', pcrColor)}>{pcrLabel}</p>
        </div>

        {/* IV Rank */}
        <div className="bg-secondary/60 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
            <Zap className="w-3 h-3" /> IV Rank
          </p>
          <p className={cn('num font-bold text-lg', ivRankColor)}>{ctx.iv_rank.toFixed(0)}%</p>
          <p className={cn('text-[10px] mt-0.5', ivRankColor)}>{ivRankLabel}</p>
        </div>

        {/* Support */}
        <div className="bg-secondary/60 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
            <Shield className="w-3 h-3 text-green-400" /> Support
          </p>
          <p className="num font-bold text-lg text-green-400">₹{formatPrice(ctx.support_level, 0)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Max PE OI strike</p>
        </div>

        {/* Resistance */}
        <div className="bg-secondary/60 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
            <Shield className="w-3 h-3 text-red-400" /> Resistance
          </p>
          <p className="num font-bold text-lg text-red-400">₹{formatPrice(ctx.resistance_level, 0)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Max CE OI strike</p>
        </div>
      </div>

      {/* OI Bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground">Total CE OI</span>
          <span className="text-xs text-muted-foreground">Total PE OI</span>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden">
          {(() => {
            const total = ctx.total_ce_oi + ctx.total_pe_oi
            const cePct = total > 0 ? (ctx.total_ce_oi / total) * 100 : 50
            const pePct = 100 - cePct
            return (
              <>
                <div className="bg-green-500/60 transition-all" style={{ width: `${cePct}%` }} />
                <div className="bg-red-500/60 transition-all" style={{ width: `${pePct}%` }} />
              </>
            )
          })()}
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-green-400 num">{(ctx.total_ce_oi / 1e6).toFixed(2)}M CE</span>
          <span className="text-[10px] text-muted-foreground">OI Distribution</span>
          <span className="text-[10px] text-red-400 num">{(ctx.total_pe_oi / 1e6).toFixed(2)}M PE</span>
        </div>
      </div>
    </div>
  )
}
