'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Wifi, Plus, Check, TrendingUp, ExternalLink, X, Sun, Moon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { stocksApi } from '@/lib/api'
import { useWatchlistStore, useUIStore } from '@/store'
import { cn, marketIsOpen } from '@/lib/utils'
import toast from 'react-hot-toast'

interface SearchResult {
  symbol: string
  name: string
  exchange: string
  token?: string
  instrument_type?: string
}

// ── Portal Dropdown ───────────────────────────────────────────────────────────
// Rendered at document.body so it is NEVER clipped by parent stacking contexts.

interface TopBarDropdownProps {
  anchorRef: React.RefObject<HTMLDivElement | null>
  results: SearchResult[]
  query: string
  activeIdx: number
  onSelect: (r: SearchResult) => void
  onAddWatchlist: (sym: string) => void
  onClose: () => void
}

function TopBarDropdown({
  anchorRef, results, query, activeIdx, onSelect, onAddWatchlist, onClose,
}: TopBarDropdownProps) {
  const { isWatched } = useWatchlistStore()
  const [rect, setRect] = useState<DOMRect | null>(null)

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
    top: rect.bottom + 4,
    left: rect.left,
    width: rect.width,
    zIndex: 9999,
  }

  return createPortal(
    <>
      {/* Backdrop — click outside closes */}
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
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            {results.length} result{results.length !== 1 ? 's' : ''} for &quot;{query}&quot;
          </span>
          <button
            onMouseDown={(e) => { e.preventDefault(); onClose() }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground text-center">
              No results for &quot;{query}&quot;
            </div>
          ) : results.map((r, i) => {
            const watched = isWatched(r.symbol)
            const isActive = i === activeIdx
            return (
              <div
                key={`${r.symbol}-${r.exchange}`}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 transition-colors',
                  isActive ? 'bg-accent' : 'hover:bg-accent/60',
                )}
              >
                {/* Symbol + name — click to navigate */}
                <button
                  className="flex-1 flex items-start gap-3 text-left min-w-0"
                  onMouseDown={(e) => { e.preventDefault(); onSelect(r) }}
                >
                  <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <TrendingUp className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{r.symbol}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border/50">
                        {r.exchange}
                      </span>
                      {r.instrument_type && r.instrument_type !== 'EQ' && (
                        <span className="text-[10px] text-muted-foreground">{r.instrument_type}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{r.name}</p>
                  </div>
                </button>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onMouseDown={(e) => { e.preventDefault(); onSelect(r) }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title={`View ${r.symbol}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); onAddWatchlist(r.symbol) }}
                    disabled={watched}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors',
                      watched
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20 cursor-default'
                        : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20',
                    )}
                    title={watched ? 'Already in watchlist' : 'Add to watchlist'}
                  >
                    {watched ? (
                      <><Check className="w-3 h-3" /> Watching</>
                    ) : (
                      <><Plus className="w-3 h-3" /> Watch</>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 border-t border-border/50 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ── Theme Initializer ─────────────────────────────────────────────────────────
// Applies persisted theme on mount (avoids flash of wrong theme)

function ThemeInitializer() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)

  useEffect(() => {
    // Apply theme from store on mount
    setTheme(theme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

// ── TopBar ────────────────────────────────────────────────────────────────────

export function TopBar() {
  const router = useRouter()
  const { addSymbol } = useWatchlistStore()
  const { theme, toggleTheme } = useUIStore()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const { data: marketStatus } = useQuery({
    queryKey: ['marketStatus'],
    queryFn: stocksApi.marketStatus,
    refetchInterval: 60000,
  })

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([])
      setIsOpen(false)
      setActiveIdx(-1)
      return
    }
    setIsSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await stocksApi.search(query)
        setResults(res.slice(0, 10))
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

  const handleSelect = useCallback((r: SearchResult) => {
    setQuery('')
    setIsOpen(false)
    setResults([])
    router.push(`/stocks/${r.symbol}`)
  }, [router])

  const handleAddWatchlist = useCallback((sym: string) => {
    addSymbol(sym)
    toast.success(`${sym} added to watchlist`)
  }, [addSymbol])

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setResults([])
  }, [])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { handleClose(); inputRef.current?.blur(); return }
    if (!isOpen || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = activeIdx >= 0 ? results[activeIdx] : results[0]
      if (target) handleSelect(target)
    }
  }, [isOpen, results, activeIdx, handleSelect, handleClose])

  const nseOpen = marketStatus?.nse?.open ?? marketIsOpen()

  return (
    <>
      <ThemeInitializer />
      <header className="flex items-center gap-4 px-4 py-2 border-b border-border bg-card/50 backdrop-blur-sm">
        {/* Search anchor — portal dropdown positions itself relative to this */}
        <div ref={anchorRef} className="relative flex-1 max-w-sm">
          <Search className={cn(
            'absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors pointer-events-none',
            isSearching ? 'text-primary animate-pulse' : 'text-muted-foreground',
          )} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (results.length > 0) setIsOpen(true) }}
            onBlur={() => setTimeout(() => setIsOpen(false), 150)}
            onKeyDown={handleKeyDown}
            placeholder="Search stocks… (e.g. ADA, RELIANCE, HDFC)"
            className="w-full bg-secondary border border-border rounded-lg pl-8 pr-8 py-1.5 text-sm focus:outline-none focus:border-primary/50 transition-colors"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              onMouseDown={(e) => { e.preventDefault(); handleClose() }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Portal dropdown — rendered at document.body, never clipped */}
        {isOpen && query.length >= 2 && (
          <TopBarDropdown
            anchorRef={anchorRef}
            results={results}
            query={query}
            activeIdx={activeIdx}
            onSelect={handleSelect}
            onAddWatchlist={handleAddWatchlist}
            onClose={handleClose}
          />
        )}

        <div className="flex items-center gap-3 ml-auto">
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-yellow-400" />
            ) : (
              <Moon className="w-4 h-4 text-blue-400" />
            )}
          </button>

          {/* Market Status */}
          <div className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
            nseOpen
              ? 'bg-green-500/10 text-green-400 border-green-500/20'
              : 'bg-red-500/10 text-red-400 border-red-500/20'
          )}>
            <span className={cn('w-1.5 h-1.5 rounded-full', nseOpen ? 'bg-green-400 animate-pulse' : 'bg-red-400')} />
            NSE {nseOpen ? 'OPEN' : 'CLOSED'}
          </div>

          {/* Live indicator */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Wifi className="w-3.5 h-3.5 text-green-400" />
            <span>LIVE</span>
          </div>
        </div>
      </header>
    </>
  )
}
