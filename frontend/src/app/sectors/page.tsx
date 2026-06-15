'use client'

import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, TrendingUp, TrendingDown, Activity, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SectorData {
  sector: string
  change_pct: number
  signal: string
  top_gainer: { symbol: string; change_pct: number }
  top_loser: { symbol: string; change_pct: number }
  breadth: { advances: number; declines: number }
  stocks: { symbol: string; change_pct: number; ltp: number }[]
}

interface SectorPerformance {
  sectors: SectorData[]
  market_summary: {
    total_advancing: number
    total_declining: number
    market_trend: string
  }
  timestamp: string
}

// ── Backend → UI normalization ──────────────────────────────────────────────────
// The backend returns avg_change_pct / best_performer / advancing etc.
// Map it to the shape this page renders, coercing every numeric field so a
// missing/renamed field degrades to 0 instead of crashing on .toFixed().

interface RawSector {
  sector: string
  avg_change_pct?: number
  advancing?: number
  declining?: number
  best_performer?: { symbol: string; change_pct: number }
  worst_performer?: { symbol: string; change_pct: number }
  signal?: string
  stocks?: { symbol: string; change_pct: number; ltp: number }[]
}

interface RawSectorPerformance {
  sectors?: RawSector[]
  market_breadth?: number
  updated_at?: string
}

function mapSignal(signal?: string): string {
  switch (signal) {
    case 'STRONG_BUY':
    case 'BUY':
      return 'BULLISH'
    case 'STRONG_SELL':
    case 'SELL':
      return 'BEARISH'
    default:
      return 'NEUTRAL'
  }
}

function normalizeSectorPerformance(raw: RawSectorPerformance): SectorPerformance {
  const rawSectors = raw?.sectors ?? []
  const sectors: SectorData[] = rawSectors.map((s) => ({
    sector: s.sector,
    change_pct: Number(s.avg_change_pct) || 0,
    signal: mapSignal(s.signal),
    top_gainer: s.best_performer,
    top_loser: s.worst_performer,
    breadth: { advances: s.advancing ?? 0, declines: s.declining ?? 0 },
    stocks: s.stocks ?? [],
  })) as SectorData[]

  const total_advancing = sectors.reduce((sum, s) => sum + (s.breadth?.advances ?? 0), 0)
  const total_declining = sectors.reduce((sum, s) => sum + (s.breadth?.declines ?? 0), 0)
  const breadth = Number(raw?.market_breadth) || 0
  const market_trend = breadth >= 55 ? 'BULLISH' : breadth <= 45 ? 'BEARISH' : 'NEUTRAL'

  return {
    sectors,
    market_summary: { total_advancing, total_declining, market_trend },
    timestamp: raw?.updated_at ?? new Date().toISOString(),
  }
}

// ── Heatmap Cell ──────────────────────────────────────────────────────────────

function HeatmapCell({ sector, onClick, isSelected }: { sector: SectorData; onClick: () => void; isSelected: boolean }) {
  const change = sector.change_pct ?? 0
  const intensity = Math.min(Math.abs(change) / 3, 1) // normalize to 0-1 for 3% max

  let bgColor: string
  if (change > 0) {
    bgColor = `rgba(34, 197, 94, ${0.15 + intensity * 0.45})`
  } else if (change < 0) {
    bgColor = `rgba(239, 68, 68, ${0.15 + intensity * 0.45})`
  } else {
    bgColor = 'rgba(100, 100, 100, 0.2)'
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-xl p-4 border transition-all hover:scale-[1.02] cursor-pointer text-left',
        isSelected ? 'ring-2 ring-primary border-primary/50' : 'border-border/50 hover:border-border'
      )}
      style={{ backgroundColor: bgColor }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm">{sector.sector}</span>
        <span className={cn('text-xs px-1.5 py-0.5 rounded font-bold',
          sector.signal === 'BULLISH' ? 'bg-green-500/30 text-green-400' :
          sector.signal === 'BEARISH' ? 'bg-red-500/30 text-red-400' :
          'bg-yellow-500/30 text-yellow-400')}>
          {sector.signal}
        </span>
      </div>
      <div className={cn('text-2xl font-bold',
        change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-muted-foreground')}>
        {change > 0 ? '+' : ''}{change.toFixed(2)}%
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
        <span className="text-green-400">↑ {sector.breadth?.advances || 0}</span>
        <span className="text-red-400">↓ {sector.breadth?.declines || 0}</span>
      </div>
    </button>
  )
}

// ── Stock Row ─────────────────────────────────────────────────────────────────

function StockRow({ symbol, change_pct, ltp }: { symbol: string; change_pct: number; ltp: number }) {
  const pct = change_pct ?? 0
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-accent/30 transition-colors">
      <span className="font-medium text-sm flex-1">{symbol}</span>
      <span className="text-xs text-muted-foreground num">₹{ltp?.toLocaleString('en-IN')}</span>
      <span className={cn('text-xs font-bold num min-w-[60px] text-right',
        pct > 0 ? 'text-green-400' : pct < 0 ? 'text-red-400' : 'text-muted-foreground')}>
        {pct > 0 ? '+' : ''}{pct.toFixed(2)}%
      </span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

import { useState } from 'react'

export default function SectorHeatmapPage() {
  const [selectedSector, setSelectedSector] = useState<string | null>(null)

  const { data, isLoading } = useQuery<SectorPerformance>({
    queryKey: ['sector-performance'],
    queryFn: () => api.get('/api/stocks/sector-performance').then(r => normalizeSectorPerformance(r.data)),
    refetchInterval: 30000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) return <div className="text-muted-foreground text-center py-12">Failed to load sector data</div>

  const sectors = data.sectors || []
  const selected = sectors.find(s => s.sector === selectedSector)

  // Sort by change for ranking
  const sorted = [...sectors].sort((a, b) => b.change_pct - a.change_pct)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <LayoutGrid className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Sector Heatmap</h1>
            <p className="text-sm text-muted-foreground">
              Live sector performance — click a sector to drill into stocks
            </p>
          </div>
        </div>
        {data.market_summary && (
          <div className={cn('px-3 py-1.5 rounded-lg text-sm font-bold',
            data.market_summary.market_trend === 'BULLISH' ? 'bg-green-500/20 text-green-400' :
            data.market_summary.market_trend === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
            'bg-yellow-500/20 text-yellow-400')}>
            Market: {data.market_summary.market_trend}
          </div>
        )}
      </div>

      {/* Market Summary Bar */}
      {data.market_summary && (
        <div className="flex items-center gap-6 glass rounded-xl p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-sm"><span className="font-bold text-green-400">{data.market_summary.total_advancing}</span> advancing</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-400" />
            <span className="text-sm"><span className="font-bold text-red-400">{data.market_summary.total_declining}</span> declining</span>
          </div>
          <div className="flex-1" />
          <div className="text-xs text-muted-foreground">
            Updated: {data.timestamp?.split('T')[1]?.split('.')[0] || 'now'}
          </div>
        </div>
      )}

      {/* Heatmap Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {sorted.map(sector => (
          <HeatmapCell
            key={sector.sector}
            sector={sector}
            onClick={() => setSelectedSector(selectedSector === sector.sector ? null : sector.sector)}
            isSelected={selectedSector === sector.sector}
          />
        ))}
      </div>

      {/* Sector Detail Drill-down */}
      {selected && (
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-sm">{selected.sector} — Stocks</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              {selected.top_gainer && (
                <span className="text-green-400">
                  🏆 {selected.top_gainer.symbol} +{selected.top_gainer.change_pct?.toFixed(2)}%
                </span>
              )}
              {selected.top_loser && (
                <span className="text-red-400">
                  📉 {selected.top_loser.symbol} {selected.top_loser.change_pct?.toFixed(2)}%
                </span>
              )}
            </div>
          </div>

          {selected.stocks && selected.stocks.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {selected.stocks
                .sort((a, b) => b.change_pct - a.change_pct)
                .map(stock => (
                  <StockRow key={stock.symbol} {...stock} />
                ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-6">
              Stock-level data not available for this sector
            </div>
          )}
        </div>
      )}

      {/* Sector Ranking Table */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Sector Ranking</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-2 px-4 text-left">#</th>
              <th className="py-2 px-4 text-left">Sector</th>
              <th className="py-2 px-4 text-right">Change %</th>
              <th className="py-2 px-4 text-center">Signal</th>
              <th className="py-2 px-4 text-left">Top Gainer</th>
              <th className="py-2 px-4 text-left">Top Loser</th>
              <th className="py-2 px-4 text-center">Breadth</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((sector, idx) => (
              <tr key={sector.sector} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                <td className="py-2 px-4 text-muted-foreground">{idx + 1}</td>
                <td className="py-2 px-4 font-medium">{sector.sector}</td>
                <td className={cn('py-2 px-4 text-right font-bold num',
                  (sector.change_pct ?? 0) > 0 ? 'text-green-400' : (sector.change_pct ?? 0) < 0 ? 'text-red-400' : 'text-muted-foreground')}>
                  {(sector.change_pct ?? 0) > 0 ? '+' : ''}{(sector.change_pct ?? 0).toFixed(2)}%
                </td>
                <td className="py-2 px-4 text-center">
                  <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold',
                    sector.signal === 'BULLISH' ? 'bg-green-500/20 text-green-400' :
                    sector.signal === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
                    'bg-yellow-500/20 text-yellow-400')}>
                    {sector.signal}
                  </span>
                </td>
                <td className="py-2 px-4 text-green-400">
                  {sector.top_gainer ? `${sector.top_gainer.symbol} +${sector.top_gainer.change_pct?.toFixed(1)}%` : '—'}
                </td>
                <td className="py-2 px-4 text-red-400">
                  {sector.top_loser ? `${sector.top_loser.symbol} ${sector.top_loser.change_pct?.toFixed(1)}%` : '—'}
                </td>
                <td className="py-2 px-4 text-center">
                  <span className="text-green-400">{sector.breadth?.advances || 0}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-red-400">{sector.breadth?.declines || 0}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

