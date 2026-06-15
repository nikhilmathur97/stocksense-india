'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, TrendingUp, TrendingDown, Zap, RefreshCw, Newspaper, ExternalLink, Clock } from 'lucide-react'
import { stocksApi, screenerApi, newsApi } from '@/lib/api'
import { QuoteCard } from '@/components/dashboard/QuoteCard'
import { SectorHeatmap } from '@/components/dashboard/SectorHeatmap'
import { SignalCard } from '@/components/screener/SignalCard'
import { stockWS } from '@/lib/websocket'
import { useTicksStore } from '@/store'
import { cn, formatPrice, formatChangePct } from '@/lib/utils'

export default function DashboardPage() {
  const updateTick = useTicksStore((s) => s.updateTick)
  const ticks = useTicksStore((s) => s.ticks)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  // ── Data Queries ──────────────────────────────────────────────────────────
  const { data: trending, isLoading: loadingTrending, refetch: refetchTrending } = useQuery({
    queryKey: ['trending'],
    queryFn: stocksApi.trending,
    refetchInterval: 2000,   // poll every 2s to match backend
    staleTime: 1000,
  })

  const { data: topPicks, isLoading: loadingPicks } = useQuery({
    queryKey: ['topPicks'],
    queryFn: screenerApi.topPicks,
    refetchInterval: 30000,
  })

  const { data: latestNews } = useQuery({
    queryKey: ['dashboardNews'],
    queryFn: () => newsApi.all({ limit: 6 }),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  const { data: marketStatus } = useQuery({
    queryKey: ['marketStatus'],
    queryFn: stocksApi.marketStatus,
    refetchInterval: 30000,
  })

  // ── WebSocket for 1-second tick updates ──────────────────────────────────
  useEffect(() => {
    stockWS.connect()
    stockWS.onAll((tick) => {
      if (tick.type === 'tick' && tick.symbol && typeof tick.ltp === 'number') {
        updateTick(tick as unknown as Parameters<typeof updateTick>[0])
        setLastUpdate(new Date())
      }
    })
    return () => stockWS.disconnect()
  }, [])

  // Subscribe to trending symbols when they load
  useEffect(() => {
    if (trending && trending.length > 0) {
      stockWS.subscribe(trending.map((q) => q.symbol), () => {})
    }
  }, [trending?.length])

  // ── Merge live ticks into trending data ───────────────────────────────────
  const liveQuotes = trending?.map((q) => {
    const tick = ticks[q.symbol]
    return tick ? { ...q, ...tick } : q
  }) ?? []

  const gainers = [...liveQuotes]
    .filter((q) => q.change_pct > 0)
    .sort((a, b) => b.change_pct - a.change_pct)
    .slice(0, 6)

  const losers = [...liveQuotes]
    .filter((q) => q.change_pct < 0)
    .sort((a, b) => a.change_pct - b.change_pct)
    .slice(0, 6)

  const topGainer = gainers[0]
  const topLoser = losers[0]

  // High-confidence picks (80%+)
  const highConfPicks = topPicks?.filter(
    (s) => s.probability_score >= 80 || s.confidence === 'HIGH'
  ) ?? []
  const displayPicks = highConfPicks.length > 0 ? highConfPicks : (topPicks ?? [])

  const isMarketOpen = marketStatus?.nse?.open ?? false

  return (
    <div className="space-y-6 max-w-screen-2xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Market Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            NSE/BSE live data · AI-powered signals
            {lastUpdate && (
              <span className="ml-2 text-green-400">
                · Updated {lastUpdate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetchTrending()}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            title="Refresh data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border',
            isMarketOpen
              ? 'bg-green-500/10 text-green-400 border-green-500/20'
              : 'bg-muted text-muted-foreground border-border'
          )}>
            <span className={cn(
              'w-1.5 h-1.5 rounded-full',
              isMarketOpen ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'
            )} />
            <Activity className="w-3.5 h-3.5" />
            Market {isMarketOpen ? 'Open' : 'Closed'}
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Top Gainer */}
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            Top Gainer
          </div>
          {loadingTrending ? (
            <div className="h-4 w-24 bg-secondary animate-pulse rounded" />
          ) : topGainer ? (
            <>
              <p className="font-bold text-sm text-green-400">
                {topGainer.symbol} +{topGainer.change_pct.toFixed(2)}%
              </p>
              <p className="num text-xs text-muted-foreground">₹{formatPrice(topGainer.ltp)}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>

        {/* Top Loser */}
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <TrendingDown className="w-3.5 h-3.5 text-red-400" />
            Top Loser
          </div>
          {loadingTrending ? (
            <div className="h-4 w-24 bg-secondary animate-pulse rounded" />
          ) : topLoser ? (
            <>
              <p className="font-bold text-sm text-red-400">
                {topLoser.symbol} {topLoser.change_pct.toFixed(2)}%
              </p>
              <p className="num text-xs text-muted-foreground">₹{formatPrice(topLoser.ltp)}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>

        {/* AI Signals */}
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
            AI Signals (80%+)
          </div>
          {loadingPicks ? (
            <div className="h-4 w-16 bg-secondary animate-pulse rounded" />
          ) : (
            <>
              <p className="font-bold text-sm text-yellow-400">
                {highConfPicks.length > 0 ? `${highConfPicks.length} active` : `${topPicks?.length ?? 0} active`}
              </p>
              {highConfPicks.length > 0 && (
                <p className="text-xs text-green-400">{highConfPicks.length} HIGH confidence</p>
              )}
            </>
          )}
        </div>

        {/* Stocks Tracked */}
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            Stocks Tracked
          </div>
          <p className="font-bold text-sm text-blue-400">
            {liveQuotes.length > 0 ? `${liveQuotes.length} live` : '68 live'}
          </p>
          <p className="text-xs text-muted-foreground">Angel One feed</p>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trending Stocks */}
        <div className="lg:col-span-2 space-y-4">
          {/* Top Gainers */}
          <div>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              Top Gainers
              <span className="text-xs text-muted-foreground font-normal">({gainers.length})</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {loadingTrending
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="glass rounded-xl h-28 animate-pulse" />
                  ))
                : gainers.length > 0
                  ? gainers.map((q) => <QuoteCard key={q.symbol} quote={q} />)
                  : <p className="text-sm text-muted-foreground col-span-3">No gainers right now</p>
              }
            </div>
          </div>

          {/* Top Losers */}
          <div>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              Top Losers
              <span className="text-xs text-muted-foreground font-normal">({losers.length})</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {loadingTrending
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="glass rounded-xl h-28 animate-pulse" />
                  ))
                : losers.length > 0
                  ? losers.map((q) => <QuoteCard key={q.symbol} quote={q} />)
                  : <p className="text-sm text-muted-foreground col-span-3">No losers right now</p>
              }
            </div>
          </div>
        </div>

        {/* Right column — Sector Heatmap */}
        <div className="space-y-4">
          <SectorHeatmap />
        </div>
      </div>

      {/* Latest News — 6 headlines */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-blue-400" />
            Latest Market News
          </h2>
          <a href="/news" className="text-xs text-primary hover:underline">View all →</a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(latestNews ?? []).slice(0, 6).map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'glass rounded-xl p-3 flex flex-col gap-1.5 hover:border-primary/30 transition-all group',
                item.is_breaking && 'border-red-500/30 bg-red-500/5',
              )}
            >
              <div className="flex items-center gap-1.5">
                {item.is_breaking && (
                  <span className="text-[9px] font-bold text-red-400 border border-red-500/40 px-1 py-0.5 rounded animate-pulse">
                    BREAKING
                  </span>
                )}
                <span className={cn(
                  'text-[10px] font-medium',
                  item.sentiment === 'POSITIVE' ? 'text-green-400' :
                  item.sentiment === 'NEGATIVE' ? 'text-red-400' : 'text-muted-foreground'
                )}>
                  {item.source}
                </span>
              </div>
              <p className="text-xs font-medium line-clamp-2 group-hover:text-primary transition-colors leading-snug">
                {item.title}
              </p>
              <div className="flex items-center justify-between mt-auto">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {(() => {
                    try {
                      const diff = Date.now() - new Date(item.published_at).getTime()
                      const mins = Math.floor(diff / 60000)
                      if (mins < 1) return 'just now'
                      if (mins < 60) return `${mins}m ago`
                      return `${Math.floor(mins / 60)}h ago`
                    } catch { return '' }
                  })()}
                </span>
                {item.symbols.length > 0 && (
                  <span className="text-[9px] font-mono text-primary/70">
                    {item.symbols.slice(0, 2).join(', ')}
                  </span>
                )}
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* AI Top Picks — always show section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            AI Top Picks — High Confidence (80%+)
          </h2>
          <a href="/screener" className="text-xs text-primary hover:underline">View all →</a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {loadingPicks
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="glass rounded-xl h-48 animate-pulse" />
              ))
            : displayPicks.length > 0
              ? displayPicks.slice(0, 8).map((sig) => (
                  <SignalCard key={sig.symbol} signal={sig} />
                ))
              : (
                <div className="col-span-4 glass rounded-xl p-6 text-center">
                  <Zap className="w-8 h-8 text-yellow-400/50 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No high-confidence signals yet. Run the screener to generate fresh signals.
                  </p>
                  <button
                    onClick={() => screenerApi.run().then(() => window.location.reload())}
                    className="mt-3 px-4 py-2 bg-primary/10 border border-primary/20 rounded-lg text-xs text-primary hover:bg-primary/20 transition-colors"
                  >
                    Run AI Screener Now
                  </button>
                </div>
              )
          }
        </div>
      </div>
    </div>
  )
}
