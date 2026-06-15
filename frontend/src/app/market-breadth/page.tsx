'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Activity, TrendingUp, TrendingDown, BarChart3,
  ArrowUpCircle, ArrowDownCircle, Minus
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BreadthData {
  advances: number
  declines: number
  unchanged: number
  total: number
  ad_ratio: number
  new_52w_highs: number
  new_52w_lows: number
  above_200dma_pct: number
  above_50dma_pct: number
  mcclellan_oscillator: number
  trin: number
  market_sentiment: string
  breadth_thrust: boolean
  sector_breadth: { sector: string; advances: number; declines: number; ad_ratio: number }[]
  timestamp: string
}

// ── Gauge Component ───────────────────────────────────────────────────────────

function SentimentGauge({ value, label }: { value: number; label: string }) {
  // value: -100 to +100
  const normalized = Math.max(-100, Math.min(100, value))
  const angle = (normalized / 100) * 90 // -90 to +90 degrees
  const color = normalized > 30 ? '#22c55e' : normalized > -30 ? '#eab308' : '#ef4444'

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-32 h-16 overflow-hidden">
        <svg viewBox="0 0 100 50" className="w-full h-full">
          {/* Background arc */}
          <path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" strokeLinecap="round" />
          {/* Colored sections */}
          <path d="M 5 50 A 45 45 0 0 1 30 10" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" opacity="0.3" />
          <path d="M 30 10 A 45 45 0 0 1 70 10" fill="none" stroke="#eab308" strokeWidth="3" strokeLinecap="round" opacity="0.3" />
          <path d="M 70 10 A 45 45 0 0 1 95 50" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" opacity="0.3" />
          {/* Needle */}
          <line
            x1="50" y1="50"
            x2={50 + 35 * Math.cos((angle - 90) * Math.PI / 180)}
            y2={50 + 35 * Math.sin((angle - 90) * Math.PI / 180)}
            stroke={color} strokeWidth="2" strokeLinecap="round"
          />
          <circle cx="50" cy="50" r="3" fill={color} />
        </svg>
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-bold" style={{ color }}>{normalized > 0 ? '+' : ''}{normalized.toFixed(0)}</div>
    </div>
  )
}

// ── Bar Component ─────────────────────────────────────────────────────────────

function ADBar({ advances, declines, unchanged }: { advances: number; declines: number; unchanged: number }) {
  const total = advances + declines + unchanged || 1
  const advPct = (advances / total) * 100
  const decPct = (declines / total) * 100
  const unchPct = (unchanged / total) * 100

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-4 rounded-full overflow-hidden">
        <div className="bg-green-500 transition-all" style={{ width: advPct + '%' }} />
        <div className="bg-gray-500 transition-all" style={{ width: unchPct + '%' }} />
        <div className="bg-red-500 transition-all" style={{ width: decPct + '%' }} />
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-green-400 font-semibold flex items-center gap-1">
          <ArrowUpCircle className="w-3 h-3" />{advances} ({advPct.toFixed(0)}%)
        </span>
        <span className="text-gray-400 flex items-center gap-1">
          <Minus className="w-3 h-3" />{unchanged}
        </span>
        <span className="text-red-400 font-semibold flex items-center gap-1">
          <ArrowDownCircle className="w-3 h-3" />{declines} ({decPct.toFixed(0)}%)
        </span>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MarketBreadthPage() {
  const { data, isLoading } = useQuery<BreadthData>({
    queryKey: ['market-breadth'],
    queryFn: () => api.get('/api/stocks/market-breadth').then(r => r.data),
    refetchInterval: 30000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) return <div className="text-muted-foreground text-center py-12">Failed to load market breadth data</div>

  const sentimentScore = data.ad_ratio > 1.5 ? 70 : data.ad_ratio > 1 ? 30 : data.ad_ratio > 0.7 ? -30 : -70
  const trinInterpretation = data.trin < 0.8 ? 'Bullish (buying pressure)' :
    data.trin > 1.2 ? 'Bearish (selling pressure)' : 'Neutral'

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <Activity className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Market Breadth</h1>
          <p className="text-sm text-muted-foreground">
            Advance/Decline, 52W Highs/Lows, McClellan, TRIN — updated {data.timestamp?.split('T')[0]}
          </p>
        </div>
        <div className={cn('ml-auto px-3 py-1.5 rounded-lg text-sm font-bold',
          data.market_sentiment === 'BULLISH' ? 'bg-green-500/20 text-green-400' :
          data.market_sentiment === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
          'bg-yellow-500/20 text-yellow-400')}>
          {data.market_sentiment}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Advance/Decline */}
        <div className="glass rounded-xl p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Advance / Decline</span>
            <span className="ml-auto text-xs text-muted-foreground">{data.total} stocks</span>
          </div>
          <ADBar advances={data.advances} declines={data.declines} unchanged={data.unchanged} />

          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{data.advances}</div>
              <div className="text-xs text-muted-foreground">Advancing</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">{data.ad_ratio?.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">A/D Ratio</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">{data.declines}</div>
              <div className="text-xs text-muted-foreground">Declining</div>
            </div>
          </div>
        </div>

        {/* Sentiment Gauge */}
        <div className="glass rounded-xl p-5 flex flex-col items-center justify-center">
          <span className="font-semibold text-sm mb-4">Market Sentiment</span>
          <SentimentGauge value={sentimentScore} label={data.market_sentiment} />
          {data.breadth_thrust && (
            <div className="mt-3 px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/30 text-xs text-green-400 font-semibold">
              🚀 Breadth Thrust Detected!
            </div>
          )}
        </div>
      </div>

      {/* Key Indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="glass rounded-xl p-4 text-center">
          <div className="text-xs text-muted-foreground mb-1">52W Highs</div>
          <div className="text-xl font-bold text-green-400">{data.new_52w_highs}</div>
        </div>
        <div className="glass rounded-xl p-4 text-center">
          <div className="text-xs text-muted-foreground mb-1">52W Lows</div>
          <div className="text-xl font-bold text-red-400">{data.new_52w_lows}</div>
        </div>
        <div className="glass rounded-xl p-4 text-center">
          <div className="text-xs text-muted-foreground mb-1">Above 200 DMA</div>
          <div className={cn('text-xl font-bold', data.above_200dma_pct > 50 ? 'text-green-400' : 'text-red-400')}>
            {data.above_200dma_pct?.toFixed(0)}%
          </div>
        </div>
        <div className="glass rounded-xl p-4 text-center">
          <div className="text-xs text-muted-foreground mb-1">Above 50 DMA</div>
          <div className={cn('text-xl font-bold', data.above_50dma_pct > 50 ? 'text-green-400' : 'text-red-400')}>
            {data.above_50dma_pct?.toFixed(0)}%
          </div>
        </div>
        <div className="glass rounded-xl p-4 text-center">
          <div className="text-xs text-muted-foreground mb-1">McClellan Osc.</div>
          <div className={cn('text-xl font-bold', data.mcclellan_oscillator > 0 ? 'text-green-400' : 'text-red-400')}>
            {data.mcclellan_oscillator > 0 ? '+' : ''}{data.mcclellan_oscillator?.toFixed(0)}
          </div>
        </div>
        <div className="glass rounded-xl p-4 text-center">
          <div className="text-xs text-muted-foreground mb-1">TRIN (Arms)</div>
          <div className={cn('text-xl font-bold',
            data.trin < 0.8 ? 'text-green-400' : data.trin > 1.2 ? 'text-red-400' : 'text-yellow-400')}>
            {data.trin?.toFixed(2)}
          </div>
          <div className="text-[10px] text-muted-foreground">{trinInterpretation}</div>
        </div>
      </div>

      {/* Sector Breadth */}
      {data.sector_breadth && data.sector_breadth.length > 0 && (
        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Sector-wise Breadth</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.sector_breadth.map(sector => {
              const total = sector.advances + sector.declines || 1
              const advPct = (sector.advances / total) * 100
              return (
                <div key={sector.sector} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{sector.sector}</span>
                    <span className={cn('text-xs font-bold',
                      sector.ad_ratio > 1 ? 'text-green-400' : 'text-red-400')}>
                      {sector.ad_ratio?.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden mb-1">
                    <div className="bg-green-500" style={{ width: advPct + '%' }} />
                    <div className="bg-red-500" style={{ width: (100 - advPct) + '%' }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span className="text-green-400">{sector.advances} ↑</span>
                    <span className="text-red-400">{sector.declines} ↓</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <Activity className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-300">
          <strong>How to read:</strong> A/D Ratio &gt; 1.5 = strong bullish breadth. TRIN &lt; 0.8 = buying pressure.
          McClellan &gt; +100 = overbought. Breadth Thrust = rare bullish signal when &gt;80% stocks advance.
          52W Highs &gt;&gt; Lows = healthy uptrend.
        </p>
      </div>
    </div>
  )
}
