'use client'

import { useQuery } from '@tanstack/react-query'
import { stocksApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export function SectorHeatmap() {
  const { data: sectors, isLoading } = useQuery({
    queryKey: ['sectorHeatmap'],
    queryFn: stocksApi.sectorHeatmap,
    refetchInterval: 60000,
  })

  if (isLoading) {
    return (
      <div className="glass rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Sector Heatmap</h2>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-secondary animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const sorted = [...(sectors || [])].sort((a, b) => b.avg_change_pct - a.avg_change_pct)
  const max = Math.max(...sorted.map((s) => Math.abs(s.avg_change_pct)), 1)

  return (
    <div className="glass rounded-xl p-4">
      <h2 className="text-sm font-semibold mb-3">Sector Heatmap</h2>
      <div className="grid grid-cols-3 gap-2">
        {sorted.map((sector) => {
          const intensity = Math.min(Math.abs(sector.avg_change_pct) / max, 1)
          const isPositive = sector.avg_change_pct >= 0
          return (
            <div
              key={sector.sector}
              className={cn(
                'rounded-lg p-2.5 flex flex-col justify-between border transition-colors cursor-default',
                isPositive
                  ? `border-green-500/20`
                  : `border-red-500/20`
              )}
              style={{
                backgroundColor: isPositive
                  ? `rgba(34,197,94,${intensity * 0.25})`
                  : `rgba(239,68,68,${intensity * 0.25})`,
              }}
            >
              <p className="text-xs font-medium leading-tight">{sector.sector}</p>
              <div className="mt-1">
                <p className={cn('num text-sm font-bold', isPositive ? 'text-green-400' : 'text-red-400')}>
                  {isPositive ? '+' : ''}{sector.avg_change_pct.toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground">{sector.stock_count} stocks</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
