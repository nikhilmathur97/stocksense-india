'use client'

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Newspaper, RefreshCw, TrendingUp, TrendingDown, Minus,
  ExternalLink, Clock, Building2, BarChart2, Globe, Zap,
} from 'lucide-react'
import { newsApi, type NewsItem } from '@/lib/api'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

const SOURCE_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  corporate: { label: 'Corporate', icon: <Building2 className="w-3 h-3" />, color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  market:    { label: 'Market',    icon: <BarChart2 className="w-3 h-3" />,  color: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' },
  economy:   { label: 'Economy',   icon: <Globe className="w-3 h-3" />,      color: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
  global:    { label: 'Global',    icon: <Globe className="w-3 h-3" />,      color: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' },
}

const SENTIMENT_CONFIG = {
  POSITIVE: { icon: <TrendingUp className="w-3 h-3" />,  color: 'text-green-400', label: 'Positive' },
  NEGATIVE: { icon: <TrendingDown className="w-3 h-3" />, color: 'text-red-400',   label: 'Negative' },
  NEUTRAL:  { icon: <Minus className="w-3 h-3" />,        color: 'text-muted-foreground', label: 'Neutral' },
}

function timeAgo(isoStr: string): string {
  try {
    const diff = Date.now() - new Date(isoStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  } catch {
    return ''
  }
}

function NewsCard({ item }: { item: NewsItem }) {
  const src = SOURCE_TYPE_LABELS[item.source_type] ?? SOURCE_TYPE_LABELS.market
  const sent = SENTIMENT_CONFIG[item.sentiment] ?? SENTIMENT_CONFIG.NEUTRAL

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'glass rounded-xl p-4 flex flex-col gap-2 hover:border-primary/30 transition-all group',
        item.is_breaking && 'border-red-500/40 bg-red-500/5',
      )}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.is_breaking && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 rounded animate-pulse">
              <Zap className="w-2.5 h-2.5" /> BREAKING
            </span>
          )}
          <span className={cn('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border', src.color)}>
            {src.icon} {src.label}
          </span>
          <span className={cn('flex items-center gap-1 text-[10px]', sent.color)}>
            {sent.icon} {sent.label}
          </span>
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary flex-shrink-0 mt-0.5 transition-colors" />
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
        {item.title}
      </h3>

      {/* Summary */}
      {item.summary && item.summary !== item.title && (
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {item.summary}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-1">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="w-2.5 h-2.5" />
          {timeAgo(item.published_at)} · {item.source}
        </div>
        {item.symbols.length > 0 && (
          <div className="flex items-center gap-1">
            {item.symbols.slice(0, 3).map((sym) => (
              <span key={sym} className="text-[10px] font-mono px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                {sym}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  )
}

const FILTERS = [
  { key: '',          label: 'All News' },
  { key: 'corporate', label: 'Corporate' },
  { key: 'market',    label: 'Market' },
  { key: 'economy',   label: 'Economy' },
]

const SENTIMENT_FILTERS = [
  { key: '',         label: 'All' },
  { key: 'POSITIVE', label: '↑ Positive' },
  { key: 'NEGATIVE', label: '↓ Negative' },
  { key: 'NEUTRAL',  label: '— Neutral' },
]

export default function NewsPage() {
  const [sourceType, setSourceType] = useState('')
  const [sentiment, setSentiment] = useState('')
  const [search, setSearch] = useState('')

  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['news', sourceType, sentiment],
    queryFn: () => newsApi.all({ source_type: sourceType || undefined, sentiment: sentiment || undefined, limit: 100 }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 55_000,
  })

  const handleRefresh = useCallback(async () => {
    const t = toast.loading('Refreshing news…')
    try {
      await newsApi.refresh()
      await refetch()
      toast.success('News refreshed', { id: t })
    } catch {
      toast.error('Refresh failed', { id: t })
    }
  }, [refetch])

  const items = (data ?? []).filter((item) =>
    !search || item.title.toLowerCase().includes(search.toLowerCase()) ||
    item.symbols.some((s) => s.includes(search.toUpperCase()))
  )

  const breaking = items.filter((i) => i.is_breaking)
  const positive = items.filter((i) => i.sentiment === 'POSITIVE').length
  const negative = items.filter((i) => i.sentiment === 'NEGATIVE').length

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  return (
    <div className="space-y-6 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-blue-400" />
            Market News
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {items.length} articles · {breaking.length} breaking ·{' '}
            <span className="text-green-400">{positive} positive</span> ·{' '}
            <span className="text-red-400">{negative} negative</span>
          </p>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              {isFetching && <span className="text-primary animate-pulse ml-1">· Refreshing…</span>}
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-sm text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Breaking news banner */}
      {breaking.length > 0 && (
        <div className="glass rounded-xl p-3 border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-red-400 animate-pulse" />
            <span className="text-xs font-bold text-red-400 uppercase tracking-wide">Breaking News</span>
          </div>
          <div className="space-y-2">
            {breaking.slice(0, 3).map((item) => (
              <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
                className="block text-sm hover:text-primary transition-colors line-clamp-1">
                <span className="text-muted-foreground text-xs mr-2">{timeAgo(item.published_at)}</span>
                {item.title}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {/* Source type */}
        <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setSourceType(f.key)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                sourceType === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Sentiment */}
        <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
          {SENTIMENT_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setSentiment(f.key)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                sentiment === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Symbol search */}
        <input
          type="text"
          placeholder="Search symbol or keyword…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-secondary/50 border border-border text-xs placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 w-48"
        />
      </div>

      {/* News grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="glass rounded-xl h-44 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Newspaper className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No news found</p>
          <p className="text-sm text-muted-foreground mt-1">Try changing the filters or refreshing</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
