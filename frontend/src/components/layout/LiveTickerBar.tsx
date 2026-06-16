'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Newspaper, Zap } from 'lucide-react'
import { stocksApi, newsApi, type Quote, type NewsItem } from '@/lib/api'
import { stockWS } from '@/lib/websocket'
import { useTicksStore } from '@/store'
import { cn } from '@/lib/utils'

// ── Live price ticker ─────────────────────────────────────────────────────────

function PriceTick({ quote }: { quote: Quote }) {
  const changePct = quote.change_pct ?? 0
  const isUp = changePct >= 0
  return (
    <span className="inline-flex items-center gap-1.5 px-3 border-r border-border/40 whitespace-nowrap">
      <span className="font-semibold text-xs">{quote.symbol}</span>
      <span className="num text-xs">₹{(quote.ltp ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
      <span className={cn('num text-[10px] flex items-center gap-0.5', isUp ? 'text-green-400' : 'text-red-400')}>
        {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
        {isUp ? '+' : ''}{changePct.toFixed(2)}%
      </span>
    </span>
  )
}

// ── News headline ticker ──────────────────────────────────────────────────────

function NewsTick({ item }: { item: NewsItem }) {
  const sentColor =
    item.sentiment === 'POSITIVE' ? 'text-green-400' :
    item.sentiment === 'NEGATIVE' ? 'text-red-400' :
    'text-muted-foreground'

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-4 border-r border-border/40 whitespace-nowrap hover:text-primary transition-colors"
    >
      {item.is_breaking && (
        <span className="text-[9px] font-bold text-red-400 border border-red-500/40 px-1 py-0.5 rounded animate-pulse mr-1">
          BREAKING
        </span>
      )}
      <Newspaper className={cn('w-2.5 h-2.5 flex-shrink-0', sentColor)} />
      <span className="text-[11px] max-w-xs truncate">{item.title}</span>
      {item.symbols.length > 0 && (
        <span className="text-[9px] font-mono text-primary/70">[{item.symbols.slice(0, 2).join(', ')}]</span>
      )}
    </a>
  )
}

// ── Main Ticker Bar ───────────────────────────────────────────────────────────

export function LiveTickerBar() {
  const ticks = useTicksStore((s) => s.ticks)
  const updateTick = useTicksStore((s) => s.updateTick)
  const [liveNews, setLiveNews] = useState<NewsItem[]>([])
  const trackRef = useRef<HTMLDivElement>(null)

  // Fetch trending quotes (refreshes every 2 s)
  const { data: trending } = useQuery({
    queryKey: ['trending-ticker'],
    queryFn: stocksApi.trending,
    refetchInterval: 2000,
    staleTime: 1000,
  })

  // Fetch news headlines (refreshes every 60 s)
  const { data: newsItems } = useQuery({
    queryKey: ['news-ticker'],
    queryFn: () => newsApi.all({ limit: 20 }),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  // Subscribe to WebSocket for live ticks + breaking news
  useEffect(() => {
    stockWS.connect()
    stockWS.onAll((msg) => {
      if (msg.type === 'tick' && msg.symbol && typeof msg.ltp === 'number') {
        updateTick(msg as unknown as Quote)
      }
      if (msg.type === 'news') {
        setLiveNews((prev) => {
          const item = msg as unknown as NewsItem
          if (prev.find((n) => n.id === item.id)) return prev
          return [item, ...prev].slice(0, 10)
        })
      }
    })
  }, [updateTick])

  // Merge live ticks into trending
  const quotes: Quote[] = (trending ?? []).map((q) => {
    const tick = ticks[q.symbol]
    return tick ? { ...q, ...tick } : q
  })

  // Combine live news with polled news, deduplicated
  const allNews: NewsItem[] = (() => {
    const base = newsItems ?? []
    const combined = [...liveNews, ...base]
    const seen = new Set<string>()
    return combined.filter((n) => {
      if (seen.has(n.id)) return false
      seen.add(n.id)
      return true
    }).slice(0, 25)
  })()

  if (quotes.length === 0 && allNews.length === 0) return null

  return (
    <div className="h-8 bg-card border-b border-border flex items-center overflow-hidden select-none">
      {/* Left label */}
      <div className="flex items-center gap-1.5 px-3 border-r border-border bg-card z-10 h-full flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Live</span>
      </div>

      {/* Scrolling track */}
      <div className="flex-1 overflow-hidden relative">
        <div
          ref={trackRef}
          className="flex items-center animate-ticker"
          style={{ width: 'max-content' }}
        >
          {/* Price ticks */}
          {quotes.length > 0 && (
            <>
              <span className="inline-flex items-center gap-1 px-3 border-r border-border/40 text-[10px] font-bold text-yellow-400 uppercase tracking-wide whitespace-nowrap">
                <Zap className="w-2.5 h-2.5" /> Prices
              </span>
              {quotes.map((q) => <PriceTick key={q.symbol} quote={q} />)}
            </>
          )}

          {/* News ticks */}
          {allNews.length > 0 && (
            <>
              <span className="inline-flex items-center gap-1 px-3 border-r border-border/40 text-[10px] font-bold text-blue-400 uppercase tracking-wide whitespace-nowrap">
                <Newspaper className="w-2.5 h-2.5" /> News
              </span>
              {allNews.map((n) => <NewsTick key={n.id} item={n} />)}
            </>
          )}

          {/* Duplicate for seamless loop */}
          {quotes.length > 0 && quotes.map((q) => <PriceTick key={`dup-${q.symbol}`} quote={q} />)}
          {allNews.length > 0 && allNews.map((n) => <NewsTick key={`dup-${n.id}`} item={n} />)}
        </div>
      </div>
    </div>
  )
}
