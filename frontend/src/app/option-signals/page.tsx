'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Zap, RefreshCw, ChevronDown, ChevronUp, AlertCircle,
  BarChart2, LineChart, Clock, Wifi, WifiOff, Trophy, Calendar
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { optionSuggestionsApi } from '@/lib/api'
import { MarketContextBar } from '@/components/options/MarketContextBar'
import { LiveChainTable } from '@/components/options/LiveChainTable'
import { OptionSuggestionCard } from '@/components/options/OptionSuggestionCard'
import { SelectedStrikePanel } from '@/components/options/SelectedStrikePanel'

type SymbolType = 'NIFTY 50' | 'BANKNIFTY' | 'FINNIFTY'
type TradeTypeFilter = 'ALL' | 'INTRADAY' | 'SWING'

const SYMBOLS: SymbolType[] = ['NIFTY 50', 'BANKNIFTY', 'FINNIFTY']
const TRADE_TYPES: TradeTypeFilter[] = ['ALL', 'INTRADAY', 'SWING']
const SUGGESTIONS_REFETCH = 30000
const CHAIN_REFETCH = 15000
// Only show suggestions with confidence ≥ this threshold
const MIN_CONFIDENCE = 70

export default function OptionSignalsPage() {
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolType>('NIFTY 50')
  const [tradeTypeFilter, setTradeTypeFilter] = useState<TradeTypeFilter>('ALL')
  const [selectedExpiry, setSelectedExpiry] = useState<string>('')
  const [showChain, setShowChain] = useState(true)
  const [countdown, setCountdown] = useState(SUGGESTIONS_REFETCH / 1000)
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)

  // ── Expiry weeks query ───────────────────────────────────────────────────────
  const { data: expiryWeeks } = useQuery({
    queryKey: ['expiryWeeks', selectedSymbol],
    queryFn: () => optionSuggestionsApi.getExpiryWeeks(selectedSymbol),
    staleTime: 3600000, // 1 hour
  })

  // Auto-select current week expiry when weeks load
  useEffect(() => {
    if (expiryWeeks && expiryWeeks.length > 0 && !selectedExpiry) {
      setSelectedExpiry(expiryWeeks[0].date)
    }
  }, [expiryWeeks, selectedExpiry])

  // Reset expiry when symbol changes
  useEffect(() => {
    setSelectedExpiry('')
  }, [selectedSymbol])

  // ── Suggestions query ────────────────────────────────────────────────────────
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['optionSuggestions', selectedSymbol, selectedExpiry, tradeTypeFilter],
    queryFn: () =>
      optionSuggestionsApi.getSuggestions(
        selectedSymbol,
        selectedExpiry || undefined,
        tradeTypeFilter === 'ALL' ? undefined : tradeTypeFilter
      ),
    refetchInterval: SUGGESTIONS_REFETCH,
    staleTime: 10000,
    enabled: true,
  })

  // ── Live chain query ─────────────────────────────────────────────────────────
  const {
    data: chainData,
    isFetching: chainFetching,
    dataUpdatedAt: chainUpdatedAt,
  } = useQuery({
    queryKey: ['liveChain', selectedSymbol, selectedExpiry],
    queryFn: () => optionSuggestionsApi.getLiveChain(selectedSymbol, selectedExpiry || undefined),
    refetchInterval: CHAIN_REFETCH,
    staleTime: 5000,
    enabled: showChain,
  })

  // ── Countdown timer ──────────────────────────────────────────────────────────
  useEffect(() => { setCountdown(SUGGESTIONS_REFETCH / 1000) }, [dataUpdatedAt])
  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => (c <= 1 ? SUGGESTIONS_REFETCH / 1000 : c - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  const handleRefresh = useCallback(() => { refetch(); setCountdown(SUGGESTIONS_REFETCH / 1000) }, [refetch])

  // ── Filter: only high-confidence suggestions ─────────────────────────────────
  const allSuggestions = data?.suggestions ?? []
  const highConfSuggestions = allSuggestions.filter((s) => s.confidence_pct >= MIN_CONFIDENCE)
  const filteredSuggestions = tradeTypeFilter === 'ALL'
    ? highConfSuggestions
    : highConfSuggestions.filter((s) => s.trade_type === tradeTypeFilter)

  // Best trade = highest confidence
  const bestTrade = filteredSuggestions.length > 0 ? filteredSuggestions[0] : null

  // ── Chain strikes ────────────────────────────────────────────────────────────
  const chainStrikes = useMemo(() => {
    if (chainData?.calls && chainData?.puts) {
      const underlying = chainData.underlying_price as number
      const allStrikes = Array.from(
        new Set([...Object.keys(chainData.calls), ...Object.keys(chainData.puts)])
      ).map(Number).sort((a, b) => a - b)
      const atmIdx = allStrikes.reduce(
        (best, s, i) => Math.abs(s - underlying) < Math.abs(allStrikes[best] - underlying) ? i : best,
        0
      )
      const atm = allStrikes[atmIdx]
      const slice = allStrikes.slice(Math.max(0, atmIdx - 10), atmIdx + 11)
      return {
        strikes: slice.map((s) => ({
          strike: s,
          is_atm: s === atm,
          ce: chainData.calls[String(s)] ?? null,
          pe: chainData.puts[String(s)] ?? null,
        })),
        underlying,
        atm,
      }
    }
    return data?.option_chain_snapshot ?? null
  }, [chainData, data?.option_chain_snapshot])

  // Reset the tracked strike when the symbol or expiry changes.
  useEffect(() => { setSelectedStrike(null) }, [selectedSymbol, selectedExpiry])

  // Default the tracked strike to ATM once the chain loads (or if the current
  // pick is no longer in the visible strike window).
  useEffect(() => {
    if (!chainStrikes) return
    const visible = chainStrikes.strikes.map((s) => s.strike)
    if (selectedStrike == null || !visible.includes(selectedStrike)) {
      setSelectedStrike(chainStrikes.atm)
    }
  }, [chainStrikes, selectedStrike])

  // The live row for the tracked strike — updates every chain refetch (15s).
  const selectedRow = useMemo(
    () => chainStrikes?.strikes.find((s) => s.strike === selectedStrike) ?? null,
    [chainStrikes, selectedStrike]
  )

  const lastUpdated = chainUpdatedAt ? new Date(chainUpdatedAt) : undefined
  const ctx = data?.market_context
  const expiry = data?.expiry ?? selectedExpiry

  // Selected expiry week info
  const selectedWeekInfo = expiryWeeks?.find((w) => w.date === selectedExpiry)

  return (
    <div className="space-y-5 max-w-screen-2xl mx-auto">

      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            Option Trading Signals
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            High-confidence AI signals only (≥{MIN_CONFIDENCE}%) · live NIFTY data · auto-refreshes every 30s
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isFetching
              ? <WifiOff className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
              : <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            }
            {isFetching ? 'Updating…' : dataUpdatedAt ? `Updated ${new Date(dataUpdatedAt).toLocaleTimeString('en-IN')}` : 'Waiting…'}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-sm text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
            Refresh Now
          </button>
        </div>
      </div>

      {/* ── Controls Row ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Symbol tabs */}
        <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-xl p-1">
          {SYMBOLS.map((sym) => (
            <button
              key={sym}
              onClick={() => setSelectedSymbol(sym)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                selectedSymbol === sym
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {sym}
            </button>
          ))}
        </div>

        {/* Trade type filter */}
        <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-xl p-1">
          {TRADE_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setTradeTypeFilter(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm transition-colors',
                tradeTypeFilter === t
                  ? t === 'INTRADAY' ? 'bg-blue-500/20 text-blue-400 shadow-sm'
                    : t === 'SWING' ? 'bg-purple-500/20 text-purple-400 shadow-sm'
                    : 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Expiry week selector */}
        {expiryWeeks && expiryWeeks.length > 0 && (
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-xl p-1 flex-wrap">
              {expiryWeeks.map((w) => (
                <button
                  key={w.date}
                  onClick={() => setSelectedExpiry(w.date)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs transition-colors flex flex-col items-center',
                    selectedExpiry === w.date
                      ? 'bg-card border border-border shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="font-medium">{w.week}</span>
                  <span className="text-[10px] opacity-70">{w.label}</span>
                  {w.days_remaining <= 3 && (
                    <span className="text-[9px] text-yellow-400 mt-0.5">⚠ {w.days_remaining}d left</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Countdown */}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span>Refreshing in <span className="text-foreground font-medium num">{countdown}s</span></span>
          <svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" className="text-secondary" />
            <circle
              cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2"
              className="text-primary"
              strokeDasharray={`${(1 - countdown / (SUGGESTIONS_REFETCH / 1000)) * 37.7} 37.7`}
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* ── Expiry info banner ────────────────────────────────────────────────── */}
      {selectedWeekInfo && (
        <div className={cn(
          'flex items-center gap-3 px-4 py-2 rounded-xl border text-xs',
          selectedWeekInfo.days_remaining <= 3
            ? 'bg-yellow-500/5 border-yellow-500/20 text-yellow-400'
            : 'bg-blue-500/5 border-blue-500/20 text-blue-400'
        )}>
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>
            <strong>{selectedWeekInfo.week}</strong> · Expiry: {selectedWeekInfo.label} ·{' '}
            {selectedWeekInfo.days_remaining === 0
              ? '⚠ Expiry today — avoid buying options'
              : selectedWeekInfo.days_remaining <= 3
              ? `⚠ Only ${selectedWeekInfo.days_remaining} days to expiry — theta decay is aggressive`
              : `${selectedWeekInfo.days_remaining} days remaining`
            }
          </span>
        </div>
      )}

      {/* ── Loading State ────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-16 w-28 bg-secondary rounded-xl animate-pulse shrink-0" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="glass rounded-xl p-4 space-y-3">
                {Array.from({ length: 8 }).map((_, j) => (
                  <div key={j} className="h-4 bg-secondary rounded animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error State ──────────────────────────────────────────────────────── */}
      {error && !isLoading && (
        <div className="glass rounded-xl p-10 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400 opacity-60" />
          <p className="font-medium text-muted-foreground">Failed to load option signals</p>
          <p className="text-sm text-muted-foreground mt-1">Market may be closed or API unavailable</p>
          <button onClick={handleRefresh} className="mt-4 px-4 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-sm text-primary transition-colors">
            Try Again
          </button>
        </div>
      )}

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      {data && !isLoading && (
        <div className="space-y-5">

          {/* Market Context Bar */}
          {ctx && (
            <MarketContextBar ctx={ctx} expiry={expiry} symbol={selectedSymbol} />
          )}

          {/* ── Best Trade Highlight ──────────────────────────────────────────── */}
          {bestTrade && (
            <div className={cn(
              'rounded-xl border-2 p-1',
              bestTrade.option_type === 'CE'
                ? 'border-emerald-400/50 bg-emerald-400/5'
                : 'border-red-400/50 bg-red-400/5'
            )}>
              <div className="flex items-center gap-2 px-3 py-2 mb-1">
                <Trophy className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-bold text-yellow-400">Best Trade Recommendation</span>
                <span className="text-xs text-muted-foreground ml-1">
                  Highest confidence · {bestTrade.confidence_pct.toFixed(0)}% · {bestTrade.signal_strength}
                </span>
              </div>
              <OptionSuggestionCard trade={bestTrade} rank={1} />
            </div>
          )}

          {/* ── Selected Strike — Live Premium ────────────────────────────────── */}
          {chainStrikes && (
            <SelectedStrikePanel
              row={selectedRow}
              underlying={chainStrikes.underlying}
              symbol={selectedSymbol}
              expiry={expiry}
              isFetching={chainFetching}
              lastUpdated={lastUpdated}
            />
          )}

          {/* ── Live Option Chain ─────────────────────────────────────────────── */}
          <div className="glass rounded-xl overflow-hidden">
            <button
              onClick={() => setShowChain(!showChain)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/20 transition-colors"
            >
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-blue-400" />
                <span className="font-semibold text-sm">
                  Live Option Chain · {selectedSymbol} · {expiry}
                </span>
                {chainFetching && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{showChain ? 'Hide' : 'Show'}</span>
                {showChain ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </button>
            {showChain && chainStrikes && (
              <div className="px-4 pb-4">
                <LiveChainTable
                  strikes={chainStrikes.strikes}
                  underlying={chainStrikes.underlying}
                  atm={chainStrikes.atm}
                  isFetching={chainFetching}
                  lastUpdated={lastUpdated}
                  selectedStrike={selectedStrike}
                  onSelectStrike={setSelectedStrike}
                />
              </div>
            )}
          </div>

          {/* ── All High-Confidence Signals ───────────────────────────────────── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" />
                All High-Confidence Signals
                <span className="bg-primary/20 text-primary text-xs px-2 py-0.5 rounded-full">
                  {filteredSuggestions.length}
                </span>
                <span className="text-xs text-muted-foreground font-normal">
                  (≥{MIN_CONFIDENCE}% confidence only)
                </span>
              </h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{ctx?.market_trend} market</span>
                {allSuggestions.length > filteredSuggestions.length && (
                  <span className="text-yellow-400">
                    · {allSuggestions.length - filteredSuggestions.length} low-confidence signals hidden
                  </span>
                )}
              </div>
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-2 px-3 py-2.5 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
              <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-yellow-400/80 leading-relaxed">
                <strong>Disclaimer:</strong> AI-generated signals based on live options data and technical analysis.
                Options trading involves significant risk of loss. Always do your own research.
                This is NOT financial advice. Past performance does not guarantee future results.
              </p>
            </div>

            {/* No signals */}
            {filteredSuggestions.length === 0 && !isLoading && (
              <div className="glass rounded-xl p-10 text-center">
                <LineChart className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-muted-foreground text-sm font-medium">
                  No high-confidence signals right now
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {allSuggestions.length > 0
                    ? `${allSuggestions.length} signal(s) found but below ${MIN_CONFIDENCE}% confidence threshold`
                    : 'Market conditions do not support a clear directional trade'
                  }
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Try a different expiry week or check back when market direction is clearer
                </p>
                {tradeTypeFilter !== 'ALL' && (
                  <button onClick={() => setTradeTypeFilter('ALL')} className="mt-3 text-xs text-primary hover:underline">
                    Show all trade types
                  </button>
                )}
              </div>
            )}

            {/* Signal cards — skip rank 1 (already shown as best trade) */}
            {filteredSuggestions.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredSuggestions.slice(bestTrade ? 1 : 0).map((trade, i) => (
                  <OptionSuggestionCard
                    key={`${trade.option_type}-${trade.strike}-${i}`}
                    trade={trade}
                    rank={i + (bestTrade ? 2 : 1)}
                  />
                ))}
              </div>
            )}

            {/* Strategy guide */}
            <div className="glass rounded-xl p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <LineChart className="w-4 h-4 text-blue-400" />
                Options Trading Guide
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { icon: '🎯', title: 'Entry Zone', desc: 'Use limit orders within the entry range. Avoid market orders — options have wide spreads.' },
                  { icon: '🛡️', title: 'Stop Loss', desc: 'Place SL immediately after entry. Intraday: 30–35% of premium. Swing: 40% of premium.' },
                  { icon: '📈', title: 'Targets', desc: 'Book 50% at T1, trail remaining to T2. Never hold options to expiry unless deep ITM.' },
                  { icon: '⏰', title: 'Timing', desc: 'Intraday: exit by 3:15 PM IST. Avoid buying options on expiry day. Watch theta decay.' },
                ].map(({ icon, title, desc }) => (
                  <div key={title} className="bg-secondary/50 rounded-lg p-3">
                    <p className="text-base mb-1">{icon}</p>
                    <p className="text-xs font-medium mb-1">{title}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
