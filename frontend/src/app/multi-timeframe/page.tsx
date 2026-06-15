'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Clock, TrendingUp, TrendingDown, Minus, Search, Activity, Layers
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimeframeSignal {
  timeframe: string
  signal: string
  rsi: number
  macd_signal: string
  supertrend: string
  ema_trend: string
  strength: number
}

interface MTFData {
  symbol: string
  timeframes: TimeframeSignal[]
  confluence_signal: string
  aligned_timeframes: number
  total_timeframes: number
  recommendation: string
  timestamp: string
}

// ── Signal Badge ──────────────────────────────────────────────────────────────

function SignalBadge({ signal }: { signal: string }) {
  const color = signal === 'BULLISH' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
    signal === 'BEARISH' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  const icon = signal === 'BULLISH' ? <TrendingUp className="w-3 h-3" /> :
    signal === 'BEARISH' ? <TrendingDown className="w-3 h-3" /> :
    <Minus className="w-3 h-3" />

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border', color)}>
      {icon} {signal}
    </span>
  )
}

// ── Strength Bar ──────────────────────────────────────────────────────────────

function StrengthBar({ value, signal }: { value: number; signal: string }) {
  const color = signal === 'BULLISH' ? 'bg-green-500' : signal === 'BEARISH' ? 'bg-red-500' : 'bg-yellow-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted/30 rounded-full h-1.5 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: Math.min(100, value) + '%' }} />
      </div>
      <span className="text-[10px] text-muted-foreground w-8 text-right">{value}%</span>
    </div>
  )
}

// ── Confluence Meter ──────────────────────────────────────────────────────────

function ConfluenceMeter({ aligned, total, signal }: { aligned: number; total: number; signal: string }) {
  const pct = (aligned / total) * 100
  const color = signal === 'BULLISH' ? '#22c55e' : signal === 'BEARISH' ? '#ef4444' : '#eab308'

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
          <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${pct * 2.51} 251`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold" style={{ color }}>{aligned}/{total}</span>
          <span className="text-[9px] text-muted-foreground">aligned</span>
        </div>
      </div>
      <SignalBadge signal={signal} />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const POPULAR_SYMBOLS = ['NIFTY 50', 'BANKNIFTY', 'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN']

export default function MultiTimeframePage() {
  const [symbol, setSymbol] = useState('RELIANCE')
  const [searchInput, setSearchInput] = useState('RELIANCE')

  const { data, isLoading, refetch } = useQuery<MTFData>({
    queryKey: ['multi-timeframe', symbol],
    queryFn: () => api.get(`/api/stocks/multi-timeframe/${encodeURIComponent(symbol)}`).then(r => r.data),
    enabled: !!symbol,
    refetchInterval: 60000,
  })

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setSymbol(searchInput.toUpperCase())
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <Clock className="w-5 h-5 text-cyan-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Multi-Timeframe Analysis</h1>
          <p className="text-sm text-muted-foreground">5 timeframe confluence — 15m, 1h, 4h, Daily, Weekly</p>
        </div>
      </div>

      {/* Search + Quick Symbols */}
      <div className="glass rounded-xl p-4">
        <form onSubmit={handleSearch} className="flex items-center gap-3 mb-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Enter symbol..." className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <button type="submit" className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all">
            Analyze
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          {POPULAR_SYMBOLS.map(s => (
            <button key={s} onClick={() => { setSearchInput(s); setSymbol(s) }}
              className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-colors border',
                symbol === s ? 'bg-primary/20 text-primary border-primary/30' : 'bg-muted text-muted-foreground border-border hover:text-foreground')}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Results */}
      {data && !isLoading && (
        <div className="flex flex-col gap-6">
          {/* Confluence Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="glass rounded-xl p-5 flex items-center justify-center lg:col-span-1">
              <ConfluenceMeter
                aligned={data.aligned_timeframes}
                total={data.total_timeframes}
                signal={data.confluence_signal}
              />
            </div>
            <div className="glass rounded-xl p-5 lg:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm">{data.symbol} — Confluence Analysis</span>
              </div>
              <div className={cn('text-lg font-bold mb-2',
                data.confluence_signal === 'BULLISH' ? 'text-green-400' :
                data.confluence_signal === 'BEARISH' ? 'text-red-400' : 'text-yellow-400')}>
                {data.confluence_signal} Confluence ({data.aligned_timeframes}/{data.total_timeframes} aligned)
              </div>
              <p className="text-sm text-muted-foreground mb-3">{data.recommendation}</p>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Activity className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-300">
                  <strong>Trading tip:</strong> {data.aligned_timeframes >= 4
                    ? 'Strong confluence — high probability setup. Consider entering with confidence.'
                    : data.aligned_timeframes >= 3
                    ? 'Moderate confluence — wait for confirmation on lower timeframe before entry.'
                    : 'Weak confluence — mixed signals. Avoid trading or use tight stops.'}
                </p>
              </div>
            </div>
          </div>

          {/* Timeframe Grid */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-sm">Timeframe Breakdown</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 px-3 text-left">Timeframe</th>
                    <th className="py-2 px-3 text-center">Signal</th>
                    <th className="py-2 px-3 text-center">RSI</th>
                    <th className="py-2 px-3 text-center">MACD</th>
                    <th className="py-2 px-3 text-center">Supertrend</th>
                    <th className="py-2 px-3 text-center">EMA Trend</th>
                    <th className="py-2 px-3 text-left">Strength</th>
                  </tr>
                </thead>
                <tbody>
                  {data.timeframes?.map(tf => (
                    <tr key={tf.timeframe} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="py-3 px-3">
                        <span className="font-semibold text-sm">{tf.timeframe}</span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <SignalBadge signal={tf.signal} />
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={cn('font-bold',
                          tf.rsi > 70 ? 'text-red-400' : tf.rsi < 30 ? 'text-green-400' : 'text-foreground')}>
                          {tf.rsi?.toFixed(1)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold',
                          tf.macd_signal === 'BULLISH' ? 'bg-green-500/20 text-green-400' :
                          tf.macd_signal === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
                          'bg-muted text-muted-foreground')}>
                          {tf.macd_signal}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold',
                          tf.supertrend === 'BUY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400')}>
                          {tf.supertrend}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={cn('text-[10px] font-bold',
                          tf.ema_trend === 'BULLISH' ? 'text-green-400' :
                          tf.ema_trend === 'BEARISH' ? 'text-red-400' : 'text-yellow-400')}>
                          {tf.ema_trend}
                        </span>
                      </td>
                      <td className="py-3 px-3 w-32">
                        <StrengthBar value={tf.strength} signal={tf.signal} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Visual Alignment */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-sm">Visual Alignment</span>
            </div>
            <div className="flex items-center gap-2">
              {data.timeframes?.map(tf => {
                const color = tf.signal === 'BULLISH' ? 'bg-green-500' :
                  tf.signal === 'BEARISH' ? 'bg-red-500' : 'bg-yellow-500'
                return (
                  <div key={tf.timeframe} className="flex-1 flex flex-col items-center gap-2">
                    <div className={cn('w-full h-12 rounded-lg flex items-center justify-center', color + '/20 border border-' + color.replace('bg-', '') + '/30')}>
                      {tf.signal === 'BULLISH' ? <TrendingUp className="w-5 h-5 text-green-400" /> :
                       tf.signal === 'BEARISH' ? <TrendingDown className="w-5 h-5 text-red-400" /> :
                       <Minus className="w-5 h-5 text-yellow-400" />}
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">{tf.timeframe}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!data && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
          <Clock className="w-12 h-12 opacity-20" />
          <div className="text-center">
            <div className="font-semibold text-foreground mb-1">Select a Symbol</div>
            <div className="text-sm">Choose a stock above to see multi-timeframe confluence analysis</div>
          </div>
        </div>
      )}
    </div>
  )
}
