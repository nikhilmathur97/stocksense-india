'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Layers, Plus, Trash2, Play, TrendingUp, TrendingDown,
  Target, Info, DollarSign
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StrategyLeg {
  option_type: 'CE' | 'PE'
  strike: number
  action: 'BUY' | 'SELL'
  lots: number
  premium: number
}

interface PayoffResult {
  strategy_name: string
  total_premium_paid: number
  total_premium_received: number
  net_premium: number
  max_profit: number
  max_loss: number
  breakeven_points: number[]
  risk_reward_ratio: number
  payoff_curve: { spot: number; pnl: number }[]
  greeks: { delta: number; gamma: number; theta: number; vega: number }
  legs: { option_type: string; strike: number; action: string; lots: number; premium: number }[]
}

// ── Presets ───────────────────────────────────────────────────────────────────

const STRATEGY_PRESETS = [
  {
    name: 'Bull Call Spread',
    description: 'Buy lower CE, Sell higher CE',
    legs: [
      { option_type: 'CE' as const, strike: 24000, action: 'BUY' as const, lots: 1, premium: 250 },
      { option_type: 'CE' as const, strike: 24500, action: 'SELL' as const, lots: 1, premium: 100 },
    ],
  },
  {
    name: 'Bear Put Spread',
    description: 'Buy higher PE, Sell lower PE',
    legs: [
      { option_type: 'PE' as const, strike: 24500, action: 'BUY' as const, lots: 1, premium: 280 },
      { option_type: 'PE' as const, strike: 24000, action: 'SELL' as const, lots: 1, premium: 120 },
    ],
  },
  {
    name: 'Long Straddle',
    description: 'Buy ATM CE + ATM PE',
    legs: [
      { option_type: 'CE' as const, strike: 24200, action: 'BUY' as const, lots: 1, premium: 200 },
      { option_type: 'PE' as const, strike: 24200, action: 'BUY' as const, lots: 1, premium: 180 },
    ],
  },
  {
    name: 'Iron Condor',
    description: 'Sell OTM CE+PE, Buy further OTM CE+PE',
    legs: [
      { option_type: 'PE' as const, strike: 23500, action: 'BUY' as const, lots: 1, premium: 40 },
      { option_type: 'PE' as const, strike: 23800, action: 'SELL' as const, lots: 1, premium: 90 },
      { option_type: 'CE' as const, strike: 24500, action: 'SELL' as const, lots: 1, premium: 85 },
      { option_type: 'CE' as const, strike: 24800, action: 'BUY' as const, lots: 1, premium: 35 },
    ],
  },
  {
    name: 'Short Strangle',
    description: 'Sell OTM CE + OTM PE',
    legs: [
      { option_type: 'CE' as const, strike: 24500, action: 'SELL' as const, lots: 1, premium: 100 },
      { option_type: 'PE' as const, strike: 23800, action: 'SELL' as const, lots: 1, premium: 90 },
    ],
  },
]

// ── Payoff Chart SVG ──────────────────────────────────────────────────────────

function PayoffChart({ curve, breakevens }: { curve: { spot: number; pnl: number }[]; breakevens: number[] }) {
  if (!curve || curve.length === 0) return null

  const W = 800, H = 250, PAD = 40
  const spots = curve.map(c => c.spot)
  const pnls = curve.map(c => c.pnl)
  const minSpot = Math.min(...spots)
  const maxSpot = Math.max(...spots)
  const minPnl = Math.min(...pnls)
  const maxPnl = Math.max(...pnls)
  const pnlRange = maxPnl - minPnl || 1

  const toX = (spot: number) => PAD + ((spot - minSpot) / (maxSpot - minSpot)) * (W - PAD * 2)
  const toY = (pnl: number) => H - PAD - ((pnl - minPnl) / pnlRange) * (H - PAD * 2)

  const zeroY = toY(0)

  // Build path
  const pathD = curve.map((p, i) => (i === 0 ? 'M' : 'L') + toX(p.spot).toFixed(1) + ',' + toY(p.pnl).toFixed(1)).join(' ')

  // Profit area (above zero)
  const profitArea = curve.filter(p => p.pnl >= 0)
  const lossArea = curve.filter(p => p.pnl < 0)

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-64" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#ffffff20" strokeWidth="1" strokeDasharray="4 4" />

        {/* Profit/Loss fill */}
        {curve.length > 1 && (
          <>
            <defs>
              <clipPath id="profitClip">
                <rect x={PAD} y={0} width={W - PAD * 2} height={zeroY} />
              </clipPath>
              <clipPath id="lossClip">
                <rect x={PAD} y={zeroY} width={W - PAD * 2} height={H - zeroY} />
              </clipPath>
            </defs>
            <path
              d={pathD + ` L${toX(spots[spots.length - 1])},${zeroY} L${toX(spots[0])},${zeroY} Z`}
              fill="rgba(34, 197, 94, 0.15)"
              clipPath="url(#profitClip)"
            />
            <path
              d={pathD + ` L${toX(spots[spots.length - 1])},${zeroY} L${toX(spots[0])},${zeroY} Z`}
              fill="rgba(239, 68, 68, 0.15)"
              clipPath="url(#lossClip)"
            />
          </>
        )}

        {/* Main line */}
        <path d={pathD} fill="none" stroke="#60a5fa" strokeWidth="2.5" />

        {/* Breakeven markers */}
        {breakevens.map((be, i) => (
          <g key={i}>
            <line x1={toX(be)} y1={PAD} x2={toX(be)} y2={H - PAD} stroke="#eab308" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={toX(be)} cy={zeroY} r="4" fill="#eab308" />
            <text x={toX(be)} y={PAD - 5} textAnchor="middle" fill="#eab308" fontSize="10">
              BE: {be.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Zero line label */}
        <text x={PAD - 5} y={zeroY + 4} textAnchor="end" fill="#ffffff60" fontSize="9">₹0</text>

        {/* Max profit label */}
        <text x={W - PAD + 5} y={toY(maxPnl) + 4} textAnchor="start" fill="#22c55e" fontSize="9">
          +₹{maxPnl.toFixed(0)}
        </text>

        {/* Max loss label */}
        <text x={W - PAD + 5} y={toY(minPnl) + 4} textAnchor="start" fill="#ef4444" fontSize="9">
          -₹{Math.abs(minPnl).toFixed(0)}
        </text>

        {/* X-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const spot = minSpot + pct * (maxSpot - minSpot)
          return (
            <text key={pct} x={toX(spot)} y={H - 10} textAnchor="middle" fill="#ffffff40" fontSize="9">
              {spot.toFixed(0)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StrategyBuilderPage() {
  const [spot, setSpot] = useState('24200')
  const [lotSize, setLotSize] = useState('75')
  const [legs, setLegs] = useState<StrategyLeg[]>([
    { option_type: 'CE', strike: 24000, action: 'BUY', lots: 1, premium: 250 },
    { option_type: 'CE', strike: 24500, action: 'SELL', lots: 1, premium: 100 },
  ])

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/api/options/strategy-payoff', data).then(r => r.data),
  })

  const result = mutation.data as PayoffResult | undefined

  function addLeg() {
    setLegs([...legs, { option_type: 'CE', strike: parseInt(spot), action: 'BUY', lots: 1, premium: 100 }])
  }

  function removeLeg(idx: number) {
    setLegs(legs.filter((_, i) => i !== idx))
  }

  function updateLeg(idx: number, field: keyof StrategyLeg, value: string | number) {
    const updated = [...legs]
    updated[idx] = { ...updated[idx], [field]: value }
    setLegs(updated)
  }

  function loadPreset(preset: typeof STRATEGY_PRESETS[0]) {
    setLegs(preset.legs)
  }

  function calculate() {
    mutation.mutate({
      spot_price: parseFloat(spot),
      lot_size: parseInt(lotSize),
      legs: legs.map(l => ({
        option_type: l.option_type,
        strike: l.strike,
        action: l.action,
        lots: l.lots,
        premium: l.premium,
      })),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
          <Layers className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Options Strategy Builder</h1>
          <p className="text-sm text-muted-foreground">Build multi-leg strategies, visualize payoff diagrams & Greeks</p>
        </div>
      </div>

      {/* Presets */}
      <div className="glass rounded-xl p-4">
        <div className="text-xs text-muted-foreground mb-2 font-medium">Quick Presets:</div>
        <div className="flex flex-wrap gap-2">
          {STRATEGY_PRESETS.map(preset => (
            <button key={preset.name} onClick={() => loadPreset(preset)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-accent hover:text-foreground text-muted-foreground transition-colors border border-border">
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Configuration */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Strategy Configuration</span>
        </div>

        {/* Spot & Lot Size */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Spot Price</label>
            <input type="number" value={spot} onChange={e => setSpot(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Lot Size</label>
            <input type="number" value={lotSize} onChange={e => setLotSize(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </div>

        {/* Legs */}
        <div className="space-y-2">
          {legs.map((leg, idx) => (
            <div key={idx} className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/50">
              <span className="text-xs text-muted-foreground w-6">L{idx + 1}</span>
              <select value={leg.action} onChange={e => updateLeg(idx, 'action', e.target.value)}
                className={cn('bg-background border border-border rounded-lg px-2 py-1.5 text-xs font-bold w-20',
                  leg.action === 'BUY' ? 'text-green-400' : 'text-red-400')}>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
              <select value={leg.option_type} onChange={e => updateLeg(idx, 'option_type', e.target.value)}
                className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs w-16">
                <option value="CE">CE</option>
                <option value="PE">PE</option>
              </select>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-muted-foreground">Strike</label>
                <input type="number" value={leg.strike} onChange={e => updateLeg(idx, 'strike', parseInt(e.target.value))}
                  className="bg-background border border-border rounded-lg px-2 py-1 text-xs w-24" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-muted-foreground">Premium ₹</label>
                <input type="number" step="0.5" value={leg.premium} onChange={e => updateLeg(idx, 'premium', parseFloat(e.target.value))}
                  className="bg-background border border-border rounded-lg px-2 py-1 text-xs w-20" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-muted-foreground">Lots</label>
                <input type="number" min={1} value={leg.lots} onChange={e => updateLeg(idx, 'lots', parseInt(e.target.value))}
                  className="bg-background border border-border rounded-lg px-2 py-1 text-xs w-14" />
              </div>
              <button onClick={() => removeLeg(idx)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors ml-auto">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-4">
          <button onClick={addLeg}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-dashed border-border hover:border-primary hover:text-primary transition-colors text-muted-foreground">
            <Plus className="w-3.5 h-3.5" /> Add Leg
          </button>
          <div className="flex-1" />
          <button onClick={calculate} disabled={mutation.isPending || legs.length === 0}
            className={cn('flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm transition-all',
              mutation.isPending ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20')}>
            {mutation.isPending ? (
              <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Calculating...</>
            ) : (
              <><Play className="w-4 h-4" />Calculate Payoff</>
            )}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="flex flex-col gap-4">
          {/* Strategy Name Banner */}
          <div className="glass rounded-xl p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-indigo-500/20">
              <Layers className="w-6 h-6 text-indigo-400" />
            </div>
            <div className="flex-1">
              <div className="text-lg font-bold">{result.strategy_name}</div>
              <div className="text-sm text-muted-foreground">{result.legs?.length} legs · Lot size: {lotSize}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Net Premium</div>
              <div className={cn('text-lg font-bold', result.net_premium >= 0 ? 'text-red-400' : 'text-green-400')}>
                {result.net_premium >= 0 ? '-' : '+'}₹{Math.abs(result.net_premium).toLocaleString('en-IN')}
              </div>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass rounded-xl p-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" />Max Profit</div>
              <div className="text-xl font-bold text-green-400">
                {result.max_profit >= 999999 ? '∞' : '₹' + result.max_profit?.toLocaleString('en-IN')}
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3 h-3" />Max Loss</div>
              <div className="text-xl font-bold text-red-400">
                {result.max_loss >= 999999 ? '∞' : '₹' + result.max_loss?.toLocaleString('en-IN')}
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" />Risk:Reward</div>
              <div className="text-xl font-bold text-foreground">1:{result.risk_reward_ratio?.toFixed(2)}</div>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" />Breakeven</div>
              <div className="text-xl font-bold text-yellow-400">
                {result.breakeven_points?.map(b => b.toFixed(0)).join(', ') || '—'}
              </div>
            </div>
          </div>

          {/* Payoff Chart */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-sm">Payoff Diagram at Expiry</span>
            </div>
            <PayoffChart curve={result.payoff_curve} breakevens={result.breakeven_points || []} />
          </div>

          {/* Greeks */}
          {result.greeks && (
            <div className="glass rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Info className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Combined Greeks</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Delta (Δ)</div>
                  <div className={cn('text-lg font-bold', result.greeks.delta > 0 ? 'text-green-400' : 'text-red-400')}>
                    {result.greeks.delta?.toFixed(4)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Directional exposure</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Gamma (Γ)</div>
                  <div className="text-lg font-bold text-purple-400">{result.greeks.gamma?.toFixed(4)}</div>
                  <div className="text-[10px] text-muted-foreground">Delta acceleration</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Theta (Θ)</div>
                  <div className={cn('text-lg font-bold', result.greeks.theta < 0 ? 'text-red-400' : 'text-green-400')}>
                    {result.greeks.theta?.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">₹/day time decay</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Vega (ν)</div>
                  <div className="text-lg font-bold text-cyan-400">{result.greeks.vega?.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground">₹ per 1% IV change</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !mutation.isPending && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
          <Layers className="w-12 h-12 opacity-20" />
          <div className="text-center">
            <div className="font-semibold text-foreground mb-1">Build Your Strategy</div>
            <div className="text-sm">Select a preset or add legs manually, then click Calculate Payoff</div>
          </div>
        </div>
      )}
    </div>
  )
}
