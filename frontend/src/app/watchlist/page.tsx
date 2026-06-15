'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen, Plus, Trash2, TrendingUp, TrendingDown,
  Search, Check, X, ExternalLink, RefreshCw,
} from 'lucide-react'
import Link from 'next/link'
import { stocksApi } from '@/lib/api'
import { useWatchlistStore, useTicksStore } from '@/store'
import { cn, formatPrice, formatChangePct } from '@/lib/utils'
import toast from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchResult {
  symbol: string
  name: string
  exchange: string
  instrument_type?: string
}

// ── Portal Dropdown ───────────────────────────────────────────────────────────
// Rendered at document.body via createPortal so it is NEVER clipped by any
// parent stacking context, overflow:hidden, or z-index hierarchy.

interface DropdownPortalProps {
  anchorRef: React.RefObject<HTMLDivElement | null>
  results: SearchResult[]
  query: string
  activeIdx: number
  isWatched: (s: string) => boolean
  onAdd: (sym: string) => void
  onClose: () => void
}

function DropdownPortal({
  anchorRef, results, query, activeIdx, isWatched, onAdd, onClose,
}: DropdownPortalProps) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  // Recompute position whenever the anchor moves (scroll, resize)
  useEffect(() => {
    const update = () => {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect())
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef])

  if (!rect || typeof document === 'undefined') return null

  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 6,
    left: rect.left,
    width: rect.width,
    zIndex: 9999,
  }

  return createPortal(
    <>
      {/* Invisible backdrop — click outside closes dropdown */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 9998 }}
        onMouseDown={(e) => { e.preventDefault(); onClose() }}
      />

      {/* Dropdown panel */}
      <div
        style={style}
        className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {results.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground text-center">
            No results for "{query}"
          </div>
        ) : (
          <>
            <div className="px-3 py-2 border-b border-border/50 text-[10px] text-muted-foreground uppercase tracking-wide font-medium flex items-center justify-between">
              <span>{results.length} stocks found · click + to add to watchlist</span>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-2">
                <X className="w-3 h-3" />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {results.map((r, i) => {
                const watched = isWatched(r.symbol)
                return (
                  <div
                    key={`${r.symbol}-${r.exchange}`}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 transition-colors',
                      i === activeIdx ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    {/* Icon */}
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="w-3.5 h-3.5 text-primary" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{r.symbol}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border/50">
                          {r.exchange}
                        </span>
                        {watched && (
                          <span className="text-[10px] text-green-400 flex items-center gap-0.5">
                            <Check className="w-2.5 h-2.5" /> Watching
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{r.name}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Link
                        href={`/stocks/${r.symbol}`}
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="View stock"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); onAdd(r.symbol) }}
                        disabled={watched}
                        className={cn(
                          'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                          watched
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20 cursor-default'
                            : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20',
                        )}
                      >
                        {watched ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                        {watched ? 'Added' : 'Add'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="px-3 py-1.5 border-t border-border/50 text-[10px] text-muted-foreground flex gap-3">
              <span>↑↓ navigate</span><span>Enter to add</span><span>Esc to close</span>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}

// ── Stock Search Input ────────────────────────────────────────────────────────

function StockSearchInput({ onSearchOpen }: { onSearchOpen: (open: boolean) => void }) {
  const { addSymbol, isWatched } = useWatchlistStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  // Notify parent when dropdown opens/closes (to dim the table)
  useEffect(() => { onSearchOpen(isOpen) }, [isOpen, onSearchOpen])

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }
    setIsSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await stocksApi.search(query)
        setResults(res.slice(0, 12))
        setIsOpen(true)
        setActiveIdx(-1)
      } catch {
        setResults([])
      } finally {
        setIsSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const handleAdd = useCallback((sym: string) => {
    if (!sym) return
    if (isWatched(sym)) {
      toast(`${sym} is already in your watchlist`, { icon: '👁️' })
    } else {
      addSymbol(sym)
      toast.success(`${sym} added to watchlist`)
    }
    setQuery('')
    setResults([])
    setIsOpen(false)
    inputRef.current?.focus()
  }, [addSymbol, isWatched])

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setResults([])
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { handleClose(); inputRef.current?.blur(); return }
    if (!isOpen || results.length === 0) {
      if (e.key === 'Enter' && query.trim()) handleAdd(query.trim().toUpperCase())
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const target = activeIdx >= 0 ? results[activeIdx] : results[0]
      if (target) handleAdd(target.symbol)
    }
  }, [isOpen, results, activeIdx, handleAdd, handleClose, query])

  return (
    <div className="flex gap-2">
      {/* Anchor div — portal dropdown positions itself relative to this */}
      <div ref={anchorRef} className="relative flex-1">
        <Search className={cn(
          'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors pointer-events-none',
          isSearching ? 'text-primary animate-pulse' : 'text-muted-foreground',
        )} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onFocus={() => { if (results.length > 0) setIsOpen(true) }}
          onBlur={() => {
            // Small delay so onMouseDown on portal items fires before blur closes
            setTimeout(() => setIsOpen(false), 150)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search by symbol or name… e.g. ADA, HDFC, Reliance"
          className="w-full bg-background border border-border rounded-lg pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-primary/60 transition-colors"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            onMouseDown={(e) => { e.preventDefault(); handleClose() }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <button
        onMouseDown={(e) => { e.preventDefault(); handleAdd(query.trim().toUpperCase()) }}
        disabled={!query.trim()}
        className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
      >
        <Plus className="w-4 h-4" />
        Add
      </button>

      {/* Portal dropdown — rendered at document.body, never clipped */}
      {isOpen && query.length >= 2 && (
        <DropdownPortal
          anchorRef={anchorRef}
          results={results}
          query={query}
          activeIdx={activeIdx}
          isWatched={isWatched}
          onAdd={handleAdd}
          onClose={handleClose}
        />
      )}
    </div>
  )
}

// ── Watchlist Page ────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const { watchedSymbols, removeSymbol } = useWatchlistStore()
  const ticks = useTicksStore((s) => s.ticks)
  const [searchOpen, setSearchOpen] = useState(false)

  const { data: quotes, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['watchlistQuotes', watchedSymbols],
    queryFn: async () => {
      if (!watchedSymbols.length) return []
      const results = await Promise.allSettled(
        watchedSymbols.map((sym) => stocksApi.quote(sym))
      )
      return results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value)
    },
    enabled: watchedSymbols.length > 0,
    refetchInterval: 15000,
  })

  const handleRemove = useCallback((sym: string) => {
    removeSymbol(sym)
    toast(`${sym} removed from watchlist`, { icon: '🗑️' })
  }, [removeSymbol])

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Watchlist
          </h1>
          <p className="text-sm text-muted-foreground">
            {watchedSymbols.length} stock{watchedSymbols.length !== 1 ? 's' : ''} tracked · auto-saved
          </p>
        </div>
        {watchedSymbols.length > 0 && (
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
            Refresh
          </button>
        )}
      </div>

      {/* Search + Add */}
      <div className="glass rounded-xl p-4">
        <p className="text-xs text-muted-foreground mb-3 font-medium">
          Search and add NSE/BSE stocks to your watchlist
        </p>
        <StockSearchInput onSearchOpen={setSearchOpen} />
      </div>

      {/* Watchlist table — dimmed when dropdown is open so focus stays on search */}
      {watchedSymbols.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium text-muted-foreground">Your watchlist is empty</p>
          <p className="text-sm text-muted-foreground mt-1">
            Search for stocks above and click <strong>Add</strong> to start tracking them.
          </p>
        </div>
      ) : (
        <div className={cn(
          'glass rounded-xl overflow-hidden transition-opacity duration-200',
          searchOpen ? 'opacity-30 pointer-events-none select-none' : 'opacity-100',
        )}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left px-4 py-3">Symbol</th>
                <th className="text-right px-4 py-3">LTP</th>
                <th className="text-right px-4 py-3">Change</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">Open</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">High</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Low</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Volume</th>
                <th className="px-4 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {watchedSymbols.map((sym) => {
                const live = ticks[sym]
                const q = live || quotes?.find((x: any) => x.symbol === sym)
                // Only treat as "has data" when ltp > 0 (ltp=0 means stub/no-data)
                const hasData = q && (q.ltp > 0)
                const positive = (q?.change_pct || 0) >= 0
                // Derive exchange from quote or default NSE
                const exchLabel = q?.exchange || 'NSE'
                return (
                  <tr key={sym} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/stocks/${sym}`} className="font-bold text-primary hover:underline">
                        {sym}
                      </Link>
                      <p className="text-[10px] text-muted-foreground">{exchLabel}</p>
                    </td>
                    <td className="px-4 py-3 text-right num font-semibold">
                      {isLoading && !q ? (
                        <span className="inline-block w-16 h-3 bg-secondary animate-pulse rounded" />
                      ) : hasData ? `₹${formatPrice(q.ltp)}` : '—'}
                    </td>
                    <td className={cn('px-4 py-3 text-right num text-xs font-medium', positive ? 'text-green-400' : 'text-red-400')}>
                      {hasData ? (
                        <span className="flex items-center justify-end gap-1">
                          {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {formatChangePct(q.change_pct)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right num text-xs text-muted-foreground hidden sm:table-cell">
                      {hasData ? `₹${formatPrice(q.open)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right num text-xs text-green-400 hidden md:table-cell">
                      {hasData ? `₹${formatPrice(q.high)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right num text-xs text-red-400 hidden md:table-cell">
                      {hasData ? `₹${formatPrice(q.low)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right num text-xs text-muted-foreground hidden lg:table-cell">
                      {hasData && q.volume > 0
                        ? q.volume >= 1e7 ? `${(q.volume / 1e7).toFixed(1)}Cr`
                          : q.volume >= 1e5 ? `${(q.volume / 1e5).toFixed(1)}L`
                          : `${(q.volume / 1e3).toFixed(0)}K`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRemove(sym)}
                        className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title={`Remove ${sym}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
