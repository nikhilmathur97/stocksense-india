'use client'

import { useState } from 'react'
import {
  TrendingUp, TrendingDown, Target, Shield, AlertTriangle,
  ChevronDown, ChevronUp, Zap, Clock, BarChart2, Info
} from 'lucide-react'
import { cn, formatPrice } from '@/lib/utils'
import type { OptionTrade } from '@/lib/api'

interface TradeCardProps {
  trade: OptionTrade
  rank: number
}

export function TradeCard({ trade, rank }: TradeCardProps) {
  const [expanded, setExpanded] = useState(false)

  const isBullish = trade.option_type === 'CE'
  const accentColor = isBullish ? 'green' : 'red'

  const strengthColors = {
    STRONG: 'text-green-400 bg-green-400/10 border-green-400/30',
    MODERATE: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
    WEAK: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  }

  const tradeTypeColors = {
    INTRADAY: 'text-blue-400 bg-blue-400/10',
    SWING: 'text-purple-400 bg-purple-400/10',
    POSITIONAL: 'text-cyan-400 bg-cyan-400/10',
  }

  const trendIcon = isBullish
    ? <TrendingUp className="w-4 h-4 text-green-400" />
    : <TrendingDown className="w-4 h-4 text-red-400" />

  return (
    <div className={cn(
      'glass rounded-xl border transition-all duration-200',
      isBullish ? 'border-green-500/20 hover:border-green-500/40' : 'border-red-500/20 hover:border-red-500/40'
    )}>
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left: Rank + Option Info */}
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
              isBullish ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            )}>
              {rank}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  'text-sm font-bold px-2 py-0.5 rounded',
                  isBullish ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                )}>
                  {trade.option_type}
                </span>
                <span className="font-bold text-base num">{formatPrice(trade.strike, 0)}</span>
                <span className="text-xs text-muted-foreground">{trade.expiry}</span>
                {trendIcon}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={cn('text-xs px-1.5 py-0.5 rounded border', strengthColors[trade.signal_strength])}>
                  {trade.signal_strength}
                </span>
                <span className={cn('text-xs px-1.5 py-0.5 rounded', tradeTypeColors[trade.trade_type])}>
                  {trade.trade_type}
                </span>
                <span className="text-xs text-muted-foreground">
                  Confidence: <span className="text-foreground font-medium">{trade.confidence_pct.toFixed(0)}%</span>
                </span>
              </div>
            </div>
          </div>

          {/* Right: LTP */}
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">LTP</p>
            <p className="num font-bold text-lg">₹{formatPrice(trade.ltp)}</p>
            <p className="text-xs text-muted-foreground">IV: {trade.iv.toFixed(1)}%</p>
          </div>
        </div>

        {/* Key Levels Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          {/* Entry */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Zap className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] text-blue-400 font-medium uppercase tracking-wide">Entry</span>
            </div>
            <p className="num font-bold text-sm">₹{formatPrice(trade.entry_price)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {formatPrice(trade.entry_range_low)}–{formatPrice(trade.entry_range_high)}
            </p>
          </div>

          {/* Stop Loss */}
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Shield className="w-3 h-3 text-red-400" />
              <span className="text-[10px] text-red-400 font-medium uppercase tracking-wide">Stop Loss</span>
            </div>
            <p className="num font-bold text-sm text-red-400">₹{formatPrice(trade.stop_loss)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              -{((trade.entry_price - trade.stop_loss) / trade.entry_price * 100).toFixed(0)}% loss
            </p>
          </div>

          {/* Target 1 */}
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Target className="w-3 h-3 text-green-400" />
              <span className="text-[10px] text-green-400 font-medium uppercase tracking-wide">Target 1</span>
            </div>
            <p className="num font-bold text-sm text-green-400">₹{formatPrice(trade.target_1)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              +{((trade.target_1 - trade.entry_price) / trade.entry_price * 100).toFixed(0)}% gain
            </p>
          </div>

          {/* Target 2 */}
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Target className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-medium uppercase tracking-wide">Target 2</span>
            </div>
            <p className="num font-bold text-sm text-emerald-400">₹{formatPrice(trade.target_2)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              +{((trade.target_2 - trade.entry_price) / trade.entry_price * 100).toFixed(0)}% gain
            </p>
          </div>
        </div>

        {/* Risk/Reward + Capital Row */}
        <div className="flex items-center gap-4 mt-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <BarChart2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">R:R</span>
            <span className={cn('text-xs font-bold num', trade.risk_reward >= 2 ? 'text-green-400' : trade.risk_reward >= 1.5 ? 'text-yellow-400' : 'text-red-400')}>
              1:{trade.risk_reward.toFixed(1)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Capital:</span>
            <span className="text-xs font-medium num">₹{formatPrice(trade.capital_required, 0)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Breakeven:</span>
            <span className="text-xs font-medium num">₹{formatPrice(trade.breakeven, 0)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Lot:</span>
            <span className="text-xs font-medium">{trade.lot_size}</span>
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? 'Hide' : 'Show'} Greeks & Analysis
        </button>
      </div>

      {/* Expanded Section */}
      {expanded && (
        <div className="border-t border-border/50 p-4 space-y-4">
          {/* Greeks */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Option Greeks</p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Delta', value: trade.delta.toFixed(3), color: 'text-blue-400', desc: 'Price sensitivity' },
                { label: 'Gamma', value: trade.gamma.toFixed(5), color: 'text-purple-400', desc: 'Delta change rate' },
                { label: 'Theta', value: trade.theta.toFixed(2), color: 'text-red-400', desc: 'Daily time decay' },
                { label: 'Vega', value: trade.vega.toFixed(2), color: 'text-cyan-400', desc: 'IV sensitivity' },
              ].map(({ label, value, color, desc }) => (
                <div key={label} className="bg-secondary/50 rounded-lg p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className={cn('num font-bold text-sm', color)}>{value}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* OI & Volume */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Open Interest & Volume</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-secondary/50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-muted-foreground">OI</p>
                <p className="num font-bold text-sm">{(trade.oi / 1000).toFixed(0)}K</p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-muted-foreground">OI Change</p>
                <p className={cn('num font-bold text-sm', trade.oi_change >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {trade.oi_change >= 0 ? '+' : ''}{(trade.oi_change / 1000).toFixed(0)}K
                </p>
              </div>
              <div className="bg-secondary/50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Volume</p>
                <p className="num font-bold text-sm">{(trade.volume / 1000).toFixed(0)}K</p>
              </div>
            </div>
          </div>

          {/* P&L */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">P&L (1 Lot)</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2 text-center">
                <p className="text-[10px] text-green-400">Max Profit (T2)</p>
                <p className="num font-bold text-sm text-green-400">+₹{formatPrice(trade.max_profit, 0)}</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center">
                <p className="text-[10px] text-red-400">Max Loss (SL)</p>
                <p className="num font-bold text-sm text-red-400">-₹{formatPrice(trade.max_loss, 0)}</p>
              </div>
            </div>
          </div>

          {/* Rationale */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1">
              <Info className="w-3 h-3" /> Why This Trade
            </p>
            <ul className="space-y-1">
              {trade.rationale.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="text-green-400 mt-0.5 shrink-0">✓</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>

          {/* Risks */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-yellow-400" /> Risks
            </p>
            <ul className="space-y-1">
              {trade.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="text-yellow-400 mt-0.5 shrink-0">⚠</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
