'use client'

import { TrendingUp, TrendingDown, Minus, Calendar, Zap, Shield, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MarketContext } from '@/lib/api'

interface MarketContextBarProps {
  ctx: MarketContext
  expiry: string
  symbol: string
  underlyingChange?: number
  underlyingChangePct?: number
}

function MetricCard({
  label,
  value,
  sub,
  valueClass,
  children,
}: {
  label: string
  value?: string
  sub?: string
  valueClass?: string
  children?: React.ReactNode
}) {
  return (
    <div className="glass rounded-xl px-3 py-2.5 min-w-[110px] flex-shrink-0">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      {children ?? (
        <>
          <p className={cn('num font-bold text-sm leading-tight', valueClass)}>{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sub}</p>}
        </>
      )}
    </div>
  )
}

export function MarketContextBar({
  ctx,
  expiry,
  symbol,
  underlyingChange = 0,
  underlyingChangePct = 0,
}: MarketContextBarProps) {
  const trendColor =
    ctx.market_trend === 'BULLISH' ? 'text-emerald-400' :
    ctx.market_trend === 'BEARISH' ? 'text-red-400' : 'text-yellow-400'
  const trendBg =
    ctx.market_trend === 'BULLISH' ? 'bg-emerald-400/10 border-emerald-400/30' :
    ctx.market_trend === 'BEARISH' ? 'bg-red-400/10 border-red-400/30' : 'bg-yellow-400/10 border-yellow-400/30'
  const TrendIcon =
    ctx.market_trend === 'BULLISH' ? TrendingUp :
    ctx.market_trend === 'BEARISH' ? TrendingDown : Minus

  const pcrColor = ctx.pcr > 1.2 ? 'text-emerald-400' : ctx.pcr < 0.8 ? 'text-red-400' : 'text-yellow-400'
  const pcrLabel = ctx.pcr > 1.2 ? '🐂 Bullish' : ctx.pcr < 0.8 ? '🐻 Bearish' : '↔ Neutral'

  const ivRankColor = ctx.iv_rank > 70 ? 'text-red-400' : ctx.iv_rank > 40 ? 'text-yellow-400' : 'text-emerald-400'

  // Days to expiry — parse "09JUN2026" without relying on locale-specific
  // string parsing (new Date("JUN 09, 2026") is Invalid Date in many engines).
  let daysToExpiry = 0
  try {
    const parts = expiry.match(/(\d{2})([A-Z]{3})(\d{4})/)
    if (parts) {
      const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
      const d = new Date(parseInt(parts[3]), MONTHS.indexOf(parts[2]), parseInt(parts[1]))
      if (!isNaN(d.getTime())) {
        daysToExpiry = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000))
      }
    }
  } catch { /* ignore */ }

  const spotAboveMaxPain = ctx.underlying_price > ctx.max_pain

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1 scrollbar-thin">
      {/* Underlying Price */}
      <MetricCard label={symbol}>
        <p className={cn('num font-bold text-base leading-tight', underlyingChangePct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
          ₹{ctx.underlying_price.toLocaleString('en-IN')}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={cn('text-[10px] font-medium num px-1 py-0.5 rounded', underlyingChangePct >= 0 ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400')}>
            {underlyingChangePct >= 0 ? '+' : ''}{underlyingChangePct.toFixed(2)}%
          </span>
        </div>
      </MetricCard>

      {/* Market Trend */}
      <div className={cn('glass rounded-xl px-3 py-2.5 flex items-center gap-2 border flex-shrink-0', trendBg)}>
        <TrendIcon className={cn('w-4 h-4', trendColor)} />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Trend</p>
          <p className={cn('font-bold text-sm', trendColor)}>{ctx.market_trend}</p>
        </div>
      </div>

      {/* ATM Strike */}
      <MetricCard label="ATM Strike" value={`₹${ctx.atm_strike.toLocaleString('en-IN')}`} valueClass="text-blue-400" sub="At-The-Money" />

      {/* PCR */}
      <MetricCard label="PCR" valueClass={pcrColor}>
        <p className={cn('num font-bold text-sm leading-tight', pcrColor)}>{ctx.pcr.toFixed(2)}</p>
        <p className={cn('text-[10px] mt-0.5', pcrColor)}>{pcrLabel}</p>
      </MetricCard>

      {/* Max Pain */}
      <MetricCard label="Max Pain" valueClass="text-yellow-400">
        <p className="num font-bold text-sm text-yellow-400 leading-tight">₹{ctx.max_pain.toLocaleString('en-IN')}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {spotAboveMaxPain ? '↑ Spot above' : '↓ Spot below'}
        </p>
      </MetricCard>

      {/* IV Rank */}
      <MetricCard label="IV Rank">
        <p className={cn('num font-bold text-sm leading-tight', ivRankColor)}>{ctx.iv_rank.toFixed(0)}%</p>
        <div className="mt-1 h-1 w-full bg-secondary rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', ctx.iv_rank > 70 ? 'bg-red-400' : ctx.iv_rank > 40 ? 'bg-yellow-400' : 'bg-emerald-400')}
            style={{ width: `${ctx.iv_rank}%` }}
          />
        </div>
      </MetricCard>

      {/* VIX Estimate */}
      <MetricCard
        label="VIX Est."
        value={ctx.vix_estimate.toFixed(1)}
        valueClass={ctx.vix_estimate > 20 ? 'text-red-400' : ctx.vix_estimate > 15 ? 'text-yellow-400' : 'text-emerald-400'}
        sub={ctx.vix_estimate > 20 ? 'High vol' : ctx.vix_estimate > 15 ? 'Moderate' : 'Low vol'}
      />

      {/* Support */}
      <MetricCard label="Support" valueClass="text-emerald-400">
        <div className="flex items-center gap-1">
          <Shield className="w-3 h-3 text-emerald-400 shrink-0" />
          <p className="num font-bold text-sm text-emerald-400">₹{ctx.support_level.toLocaleString('en-IN')}</p>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">Max PE OI</p>
      </MetricCard>

      {/* Resistance */}
      <MetricCard label="Resistance" valueClass="text-red-400">
        <div className="flex items-center gap-1">
          <Shield className="w-3 h-3 text-red-400 shrink-0" />
          <p className="num font-bold text-sm text-red-400">₹{ctx.resistance_level.toLocaleString('en-IN')}</p>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">Max CE OI</p>
      </MetricCard>

      {/* Expiry */}
      <MetricCard label="Expiry">
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3 text-blue-400 shrink-0" />
          <p className="num font-bold text-sm text-blue-400">{expiry}</p>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {daysToExpiry === 0 ? '⚠ Expiry today' : `${daysToExpiry}d remaining`}
        </p>
      </MetricCard>
    </div>
  )
}
