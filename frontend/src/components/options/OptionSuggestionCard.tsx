'use client'

import { useState } from 'react'
import {
  ChevronDown, ChevronUp, Target, Shield, Zap, BarChart2,
  AlertTriangle, CheckCircle2, Copy, Bell, TrendingUp, TrendingDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OptionTrade } from '@/lib/api'
import toast from 'react-hot-toast'

interface OptionSuggestionCardProps {
  trade: OptionTrade
  rank: number
}

// Circular confidence arc (SVG)
function ConfidenceArc({ pct }: { pct: number }) {
  const r = 16
  const circ = 2 * Math.PI * r
  const filled = (pct / 100) * circ
  const color = pct >= 75 ? '#34d399' : pct >= 55 ? '#facc15' : '#f87171'
  return (
    <div className="relative w-10 h-10 shrink-0">
      <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-secondary" />
        <circle
          cx="20" cy="20" r={r} fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold num" style={{ color }}>
        {pct.toFixed(0)}
      </span>
    </div>
  )
}

// Trade meter: SL ← Entry → T1 → T2
function TradeMeter({ entry, sl, t1, t2 }: { entry: number; sl: number; t1: number; t2: number }) {
  const low = sl * 0.95
  const high = t2 * 1.05
  const range = high - low
  const pct = (v: number) => Math.min(98, Math.max(2, ((v - low) / range) * 100))

  return (
    <div className="relative h-5 bg-secondary rounded-full overflow-hidden my-2">
      {/* SL zone */}
      <div className="absolute inset-y-0 left-0 bg-red-500/20 rounded-l-full" style={{ width: `${pct(entry)}%` }} />
      {/* Profit zone */}
      <div className="absolute inset-y-0 bg-emerald-500/20" style={{ left: `${pct(entry)}%`, width: `${pct(t2) - pct(entry)}%` }} />
      {/* SL marker */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-red-400" style={{ left: `${pct(sl)}%` }}>
        <span className="absolute -top-4 -translate-x-1/2 text-[9px] text-red-400 whitespace-nowrap">SL</span>
      </div>
      {/* Entry marker */}
      <div className="absolute top-0 bottom-0 w-1 bg-blue-400 rounded" style={{ left: `${pct(entry)}%`, transform: 'translateX(-50%)' }}>
        <span className="absolute -top-4 -translate-x-1/2 text-[9px] text-blue-400 whitespace-nowrap">Entry</span>
      </div>
      {/* T1 marker */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-emerald-400" style={{ left: `${pct(t1)}%` }}>
        <span className="absolute -top-4 -translate-x-1/2 text-[9px] text-emerald-400 whitespace-nowrap">T1</span>
      </div>
      {/* T2 marker */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-green-300" style={{ left: `${pct(t2)}%` }}>
        <span className="absolute -top-4 -translate-x-1/2 text-[9px] text-green-300 whitespace-nowrap">T2</span>
      </div>
    </div>
  )
}

export function OptionSuggestionCard({ trade, rank }: OptionSuggestionCardProps) {
  const [showRationale, setShowRationale] = useState(false)
  const [showRisks, setShowRisks] = useState(false)

  const isCE = trade.option_type === 'CE'

  const strengthColors: Record<string, string> = {
    STRONG: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/30',
    MODERATE: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30',
    WEAK: 'bg-gray-400/10 text-gray-400 border-gray-400/30',
  }
  const tradeTypeColors: Record<string, string> = {
    INTRADAY: 'bg-blue-400/10 text-blue-400',
    SWING: 'bg-purple-400/10 text-purple-400',
    POSITIONAL: 'bg-orange-400/10 text-orange-400',
  }

  const entryGainPct = (v: number) => ((v - trade.entry_price) / trade.entry_price * 100).toFixed(0)
  const entryLossPct = ((trade.entry_price - trade.stop_loss) / trade.entry_price * 100).toFixed(0)

  function copyTrade() {
    const text = [
      `📊 ${trade.symbol} ${trade.option_type} ${trade.strike} | ${trade.expiry}`,
      `📈 Signal: ${trade.signal_strength} ${trade.trade_type} | Confidence: ${trade.confidence_pct.toFixed(0)}%`,
      ``,
      `🎯 Entry: ₹${trade.entry_price} (Range: ₹${trade.entry_range_low}–₹${trade.entry_range_high})`,
      `🛡️ Stop Loss: ₹${trade.stop_loss} (-${entryLossPct}%)`,
      `🎯 Target 1: ₹${trade.target_1} (+${entryGainPct(trade.target_1)}%)`,
      `🎯 Target 2: ₹${trade.target_2} (+${entryGainPct(trade.target_2)}%)`,
      ``,
      `📐 R:R = 1:${trade.risk_reward.toFixed(1)} | Capital: ₹${trade.capital_required.toLocaleString('en-IN')}`,
      `⚖️ Breakeven: ₹${trade.breakeven.toLocaleString('en-IN')}`,
      `📦 Lot: ${trade.lot_size} | Max Profit: ₹${trade.max_profit.toLocaleString('en-IN')} | Max Loss: ₹${trade.max_loss.toLocaleString('en-IN')}`,
    ].join('\n')
    navigator.clipboard.writeText(text).then(() => toast.success('Trade details copied!'))
  }

  function setAlert() {
    toast.success(`Alert set for ${trade.symbol} ${trade.option_type} ${trade.strike} at ₹${trade.entry_price}`)
  }

  return (
    <div className={cn(
      'glass rounded-xl border overflow-hidden transition-all duration-200',
      isCE ? 'border-emerald-500/20 hover:border-emerald-500/40' : 'border-red-500/20 hover:border-red-500/40'
    )}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className={cn('px-4 py-2.5 flex items-center gap-2', isCE ? 'bg-emerald-500/5' : 'bg-red-500/5')}>
        {/* Rank */}
        <span className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
          isCE ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        )}>
          {rank}
        </span>

        {/* CE/PE badge */}
        <span className={cn(
          'text-xs font-bold px-2 py-0.5 rounded-full shrink-0',
          isCE ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        )}>
          {trade.option_type}
        </span>

        {/* Title */}
        <div className="flex items-center gap-1.5 min-w-0">
          {isCE
            ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            : <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />
          }
          <span className="font-bold text-sm num truncate">
            {trade.strike.toLocaleString('en-IN')} {trade.option_type}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">{trade.expiry}</span>
        </div>

        <div className="flex items-center gap-1.5 ml-auto shrink-0 flex-wrap justify-end">
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', strengthColors[trade.signal_strength])}>
            {trade.signal_strength}
          </span>
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded', tradeTypeColors[trade.trade_type])}>
            {trade.trade_type}
          </span>
          <ConfidenceArc pct={trade.confidence_pct} />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* ── Price Grid ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2">
          {/* Entry */}
          <div className="bg-blue-400/10 border border-blue-400/20 rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Zap className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] text-blue-400 font-medium uppercase">Entry</span>
            </div>
            <p className="num font-bold text-sm">₹{trade.entry_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 num">
              ₹{trade.entry_range_low}–₹{trade.entry_range_high}
            </p>
          </div>

          {/* Target 1 */}
          <div className="bg-emerald-400/10 border border-emerald-400/20 rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Target className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-medium uppercase">Target 1</span>
            </div>
            <p className="num font-bold text-sm text-emerald-400">₹{trade.target_1.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-emerald-400/70 mt-0.5">+{entryGainPct(trade.target_1)}%</p>
          </div>

          {/* Target 2 */}
          <div className="bg-green-400/10 border border-green-400/20 rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Target className="w-3 h-3 text-green-300" />
              <span className="text-[10px] text-green-300 font-medium uppercase">Target 2</span>
            </div>
            <p className="num font-bold text-sm text-green-300">₹{trade.target_2.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-green-300/70 mt-0.5">+{entryGainPct(trade.target_2)}%</p>
          </div>

          {/* Stop Loss */}
          <div className="bg-red-400/10 border border-red-400/20 rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Shield className="w-3 h-3 text-red-400" />
              <span className="text-[10px] text-red-400 font-medium uppercase">Stop Loss</span>
            </div>
            <p className="num font-bold text-sm text-red-400">₹{trade.stop_loss.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-red-400/70 mt-0.5">-{entryLossPct}%</p>
          </div>

          {/* R:R */}
          <div className="bg-secondary/60 border border-border rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <BarChart2 className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase">Risk:Reward</span>
            </div>
            <p className={cn('num font-bold text-sm', trade.risk_reward >= 2 ? 'text-emerald-400' : trade.risk_reward >= 1.5 ? 'text-yellow-400' : 'text-red-400')}>
              1:{trade.risk_reward.toFixed(1)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {trade.risk_reward >= 2 ? 'Excellent' : trade.risk_reward >= 1.5 ? 'Good' : 'Acceptable'}
            </p>
          </div>

          {/* Capital */}
          <div className="bg-secondary/60 border border-border rounded-lg p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] text-muted-foreground font-medium uppercase">Capital</span>
            </div>
            <p className="num font-bold text-sm">₹{trade.capital_required.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">1 lot ({trade.lot_size})</p>
          </div>
        </div>

        {/* ── Trade Meter ─────────────────────────────────────────────────────── */}
        <div className="pt-3">
          <TradeMeter
            entry={trade.entry_price}
            sl={trade.stop_loss}
            t1={trade.target_1}
            t2={trade.target_2}
          />
        </div>

        {/* ── Greeks Row ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap text-xs bg-secondary/40 rounded-lg px-3 py-2">
          <span className="text-muted-foreground">Greeks:</span>
          <span><span className="text-muted-foreground">Δ</span> <span className="num text-blue-400 font-medium">{trade.delta.toFixed(3)}</span></span>
          <span className="text-border">|</span>
          <span><span className="text-muted-foreground">Γ</span> <span className="num text-purple-400 font-medium">{trade.gamma.toFixed(5)}</span></span>
          <span className="text-border">|</span>
          <span><span className="text-muted-foreground">Θ</span> <span className="num text-red-400 font-medium">{trade.theta.toFixed(2)}/day</span></span>
          <span className="text-border">|</span>
          <span><span className="text-muted-foreground">Vega</span> <span className="num text-cyan-400 font-medium">{trade.vega.toFixed(2)}</span></span>
          <span className="text-border">|</span>
          <span><span className="text-muted-foreground">IV</span> <span className="num font-medium">{trade.iv.toFixed(1)}%</span></span>
        </div>

        {/* ── Market Data Row ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <span>OI: <span className="text-foreground num">{trade.oi.toLocaleString('en-IN')}</span></span>
          <span className="text-border">|</span>
          <span>ΔOI: <span className={cn('num', trade.oi_change >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {trade.oi_change >= 0 ? '+' : ''}{trade.oi_change.toLocaleString('en-IN')}
          </span></span>
          <span className="text-border">|</span>
          <span>Vol: <span className="text-foreground num">{trade.volume.toLocaleString('en-IN')}</span></span>
          <span className="text-border">|</span>
          <span>Breakeven: <span className="text-foreground num">₹{trade.breakeven.toLocaleString('en-IN')}</span></span>
        </div>

        {/* ── Expiry + Lot Info ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground border-t border-border/50 pt-3">
          <span>Expiry: <span className="text-foreground">{trade.expiry}</span></span>
          <span className="text-border">|</span>
          <span>Lot: <span className="text-foreground">{trade.lot_size}</span></span>
          <span className="text-border">|</span>
          <span>Max Profit: <span className="text-emerald-400 num">₹{trade.max_profit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></span>
          <span className="text-border">|</span>
          <span>Max Loss: <span className="text-red-400 num">₹{trade.max_loss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></span>
        </div>

        {/* ── Collapsible Rationale ────────────────────────────────────────────── */}
        <div className="border-t border-border/50 pt-3">
          <button
            onClick={() => setShowRationale(!showRationale)}
            className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Why This Trade ({trade.rationale.length} reasons)
            </span>
            {showRationale ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showRationale && (
            <ul className="mt-2 space-y-1.5">
              {trade.rationale.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Collapsible Risks ────────────────────────────────────────────────── */}
        <div className="border-t border-border/50 pt-3">
          <button
            onClick={() => setShowRisks(!showRisks)}
            className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
              Risks ({trade.risks.length})
            </span>
            {showRisks ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showRisks && (
            <ul className="mt-2 space-y-1.5">
              {trade.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="text-yellow-400 shrink-0 mt-0.5">⚠</span>
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Action Buttons ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={setAlert}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            <Bell className="w-3.5 h-3.5" />
            Set Alert
          </button>
          <button
            onClick={copyTrade}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy Trade
          </button>
          <div className="ml-auto text-[10px] text-muted-foreground">
            LTP: <span className="num font-medium text-foreground">₹{trade.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
