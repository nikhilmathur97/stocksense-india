'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Zap, RefreshCw, TrendingUp, TrendingDown, Minus,
  LineChart, ChevronDown, Clock, AlertCircle, Wifi, WifiOff,
  Filter, BarChart2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { optionSuggestionsApi } from '@/lib/api'
import { TradeCard } from '@/components/options/TradeCard'
import { MarketContextPanel } from '@/components/options/MarketContextPanel'
import { LiveOptionChain } from '@/components/options/LiveOptionChain'

const SYMBOLS = ['NIFTY 50', 'BANKNIFTY', 'FINNIFTY']
const TRADE_TYPES = ['ALL', 'INTRADAY', 'SWING', 'POSITIONAL']
const OPTION_TYPES = ['ALL', 'CE', 'PE']
const REFRESH_INTERVALS = [
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
  { label: '1m', value: 60000 },
  { label: '2m', value: 120000 },
]

export default function OptionSuggestionsPage() {
  const [symbol, setSymbol] = useState('NIFTY 50')
  const [tradeTypeFilter, setTradeTypeFilter] = useState('ALL')
  const [optionTypeFilter, setOptionTypeFilter] = useState('ALL')
  const [activeTab, setActiveTab] = useState<'suggestions' | 'chain'>('suggestions')
  const [refreshInterval, setRefreshInterval] = useState(30000)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [countdown, setCountdown] = useState(30)

  // Main suggestions query
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['optionSuggestions', symbol],
    queryFn: () => optionSuggestionsApi.getSuggestions(symbol),
    refetchInterval: refreshInterval,
    staleTime: 10000,
  })

  // Countdown timer
  useEffect(() => {
    setLastRefresh(new Date())
    setCountdown(refreshInterval / 1000)
  }, [dataUpdatedAt, refreshInterval])

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) return refreshInterval / 1000
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [refreshInterval])

  const handleRefresh = useCallback(() => {
    refetch()
    setCountdown(refreshInterval / 1000)
  }, [refetch, refreshInterval])

  // Filter suggestions
  const filteredSuggestions = data?.suggestions.filter((s) => {
    if (tradeTypeFilter !== 'ALL' && s.trade_type !== tradeTypeFilter) return false
    if (optionTypeFilter !== 'ALL' && s.option_type !== optionTypeFilter) return false
    return true
  }) ?? []

  const ctx = data?.market_context
  const chainStrikes = data?.option_chain_snapshot?.strikes ?? []

  const TrendIcon = ctx?.market_trend === 'BULLISH'
    ? TrendingUp : ctx?.market_trend === 'BEARISH'
    ? TrendingDown : Minus

  const trendColor = ctx?.market_trend === 'BULLISH'
    ? 'text-green-400' : ctx?.market_trend === 'BEARISH'
    ? 'text-red-400' : 'text-yellow-400'

  return (
    <div className="space-y-5 max-w-screen-2xl mx-auto">

      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            Options Trading Suggestions
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live NIFTY 50 option chain · AI-driven entry / exit / SL / targets · refreshes every {refreshInterval / 1000}s
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Symbol selector */}
          <div className="relative">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="bg-secondary border border-border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
            >
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>

          {/* Refresh interval */}
          <div className="flex items-center gap-1 bg-secondary border border-border rounded-lg p-1">
            {REFRESH_INTERVALS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setRefreshInterval(value)}
                className={cn(
                  'px-2 py-1 rounded text-xs transition-colors',
                  refreshInterval === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-sm text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
            {isFetching ? 'Loading…' : `Refresh (${countdown}s)`}
          </button>
        </div>
      </div>

      {/* ── Live Status Bar ──────────────────────────────────────────────────── */}
      {ctx && (
        <div className="flex items-center gap-4 px-4 py-2.5 glass rounded-xl flex-wrap">
          <div className="flex items-center gap-1.5">
            {isFetching
              ? <WifiOff className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
              : <Wifi className="w-3.5 h-3.5 text-green-400" />
            }
            <span className="text-xs text-muted-foreground">
              {isFetching ? 'Updating…' : `Live · ${lastRefresh.toLocaleTimeString('en-IN')}`}
            </span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <TrendIcon className={cn('w-3.5 h-3.5', trendColor)} />
            <span className={cn('text-xs font-medium', trendColor)}>{ctx.market_trend}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className="text-xs text-muted-foreground">
            Spot: <span className="text-foreground font-medium num">₹{ctx.underlying_price.toLocaleString('en-IN')}</span>
          </span>
          <div className="h-4 w-px bg-border" />
          <span className="text-xs text-muted-foreground">
            PCR: <span className={cn('font-medium num', ctx.pcr > 1.2 ? 'text-green-400' : ctx.pcr < 0.8 ? 'text-red-400' : 'text-yellow-400')}>
              {ctx.pcr.toFixed(2)}
            </span>
          </span>
          <div className="h-4 w-px bg-border" />
          <span className="text-xs text-muted-foreground">
            Max Pain: <span className="text-foreground font-medium num">₹{ctx.max_pain.toLocaleString('en-IN')}</span>
          </span>
          <div className="h-4 w-px bg-border" />
          <span className="text-xs text-muted-foreground">
            Expiry: <span className="text-foreground font-medium">{data?.expiry}</span>
          </span>
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            Next refresh in {countdown}s
          </div>
        </div>
      )}

      {/* ── Loading State ────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="space-y-4">
          <div className="glass rounded-xl p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-6 bg-secondary rounded animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass rounded-xl p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="h-5 bg-secondary rounded animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error State ──────────────────────────────────────────────────────── */}
      {error && !isLoading && (
        <div className="glass rounded-xl p-8 text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-400 opacity-60" />
          <p className="text-muted-foreground">Failed to load option suggestions</p>
          <p className="text-xs text-muted-foreground mt-1">Market may be closed or API unavailable</p>
          <button
            onClick={handleRefresh}
            className="mt-4 px-4 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-sm text-primary transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      {data && !isLoading && (
        <div className="space-y-5">

          {/* Market Context */}
          <MarketContextPanel
            ctx={data.market_context}
            symbol={data.symbol}
            expiry={data.expiry}
          />

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 bg-secondary/50 rounded-xl p-1 w-fit">
            <button
              onClick={() => setActiveTab('suggestions')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                activeTab === 'suggestions'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Zap className="w-4 h-4 text-yellow-400" />
              Trading Suggestions
              {filteredSuggestions.length > 0 && (
                <span className="bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full">
                  {filteredSuggestions.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('chain')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                activeTab === 'chain'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <BarChart2 className="w-4 h-4 text-blue-400" />
              Live Option Chain
              <span className="text-xs text-muted-foreground">ATM ±5</span>
            </button>
          </div>

          {/* ── Suggestions Tab ─────────────────────────────────────────────── */}
          {activeTab === 'suggestions' && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Filter:</span>
                </div>

                {/* Trade Type */}
                <div className="flex items-center gap-1 bg-secondary border border-border rounded-lg p-1">
                  {TRADE_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTradeTypeFilter(t)}
                      className={cn(
                        'px-2.5 py-1 rounded text-xs transition-colors',
                        tradeTypeFilter === t
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Option Type */}
                <div className="flex items-center gap-1 bg-secondary border border-border rounded-lg p-1">
                  {OPTION_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setOptionTypeFilter(t)}
                      className={cn(
                        'px-2.5 py-1 rounded text-xs transition-colors',
                        optionTypeFilter === t
                          ? t === 'CE'
                            ? 'bg-green-500/20 text-green-400'
                            : t === 'PE'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <span className="text-xs text-muted-foreground ml-auto">
                  {filteredSuggestions.length} suggestion{filteredSuggestions.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Disclaimer */}
              <div className="flex items-start gap-2 px-3 py-2 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-yellow-400/80">
                  <strong>Disclaimer:</strong> These are AI-generated suggestions based on technical analysis and options data.
                  Options trading involves significant risk. Always do your own research. Past performance is not indicative of future results.
                  This is NOT financial advice.
                </p>
              </div>

              {/* Trade Cards */}
              {filteredSuggestions.length === 0 ? (
                <div className="glass rounded-xl p-8 text-center">
                  <LineChart className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-muted-foreground text-sm">No suggestions match the current filters</p>
                  <button
                    onClick={() => { setTradeTypeFilter('ALL'); setOptionTypeFilter('ALL') }}
                    className="mt-3 text-xs text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {filteredSuggestions.map((trade, i) => (
                    <TradeCard key={`${trade.option_type}-${trade.strike}-${i}`} trade={trade} rank={i + 1} />
                  ))}
                </div>
              )}

              {/* Strategy Guide */}
              <div className="glass rounded-xl p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <LineChart className="w-4 h-4 text-blue-400" />
                  How to Use These Suggestions
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    {
                      icon: '🎯',
                      title: 'Entry Zone',
                      desc: 'Buy within the entry range shown. Use limit orders for better fills. Avoid market orders for options.',
                    },
                    {
                      icon: '🛡️',
                      title: 'Stop Loss',
                      desc: 'Place SL immediately after entry. For intraday, use 30–35% SL. For swing, use 40% SL on premium.',
                    },
                    {
                      icon: '🎯',
                      title: 'Targets',
                      desc: 'Book 50% at T1, trail remaining to T2. Never hold options to expiry unless deep ITM.',
                    },
                    {
                      icon: '⏰',
                      title: 'Timing',
                      desc: 'Intraday: exit by 3:15 PM. Swing: review daily. Avoid buying options on expiry day.',
                    },
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
          )}

          {/* ── Live Chain Tab ───────────────────────────────────────────────── */}
          {activeTab === 'chain' && (
            <div className="space-y-4">
              {/* Chain Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">Put-Call Ratio</p>
                  <p className={cn(
                    'num text-xl font-bold mt-1',
                    data.market_context.pcr > 1.2 ? 'text-green-400' :
                    data.market_context.pcr < 0.8 ? 'text-red-400' : 'text-yellow-400'
                  )}>
                    {data.market_context.pcr.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {data.market_context.pcr > 1.2 ? '🐂 Bullish' : data.market_context.pcr < 0.8 ? '🐻 Bearish' : '↔ Neutral'}
                  </p>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">Max Pain</p>
                  <p className="num text-xl font-bold mt-1 text-yellow-400">
                    ₹{data.market_context.max_pain.toLocaleString('en-IN')}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Options expiry magnet</p>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">Underlying</p>
                  <p className="num text-xl font-bold mt-1">
                    ₹{data.market_context.underlying_price.toLocaleString('en-IN')}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">NIFTY 50 Spot</p>
                </div>
              </div>

              {/* Chain Table */}
              <div className="glass rounded-xl p-4 overflow-hidden">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-blue-400" />
                    Live Option Chain — {data.symbol} · {data.expiry}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    Showing ATM ±5 strikes · {chainStrikes.length} strikes
                  </span>
                </div>
                {chainStrikes.length > 0 ? (
                  <LiveOptionChain
                    strikes={chainStrikes}
                    underlying={data.option_chain_snapshot.underlying}
                    atm={data.option_chain_snapshot.atm}
                  />
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No chain data available
                  </div>
                )}
              </div>

              {/* OI Analysis */}
              <div className="glass rounded-xl p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-purple-400" />
                  OI Analysis — Support & Resistance
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Key Resistance (Max CE OI)</p>
                    <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                      <div className="w-2 h-8 bg-red-500/60 rounded-full" />
                      <div>
                        <p className="num font-bold text-red-400 text-lg">
                          ₹{data.market_context.resistance_level.toLocaleString('en-IN')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Call writers defending this level — strong resistance
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Key Support (Max PE OI)</p>
                    <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                      <div className="w-2 h-8 bg-green-500/60 rounded-full" />
                      <div>
                        <p className="num font-bold text-green-400 text-lg">
                          ₹{data.market_context.support_level.toLocaleString('en-IN')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Put writers defending this level — strong support
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Range visualization */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                    <span className="text-green-400">Support ₹{data.market_context.support_level.toLocaleString('en-IN')}</span>
                    <span className="text-primary font-medium">
                      Spot ₹{data.market_context.underlying_price.toLocaleString('en-IN')}
                    </span>
                    <span className="text-red-400">Resistance ₹{data.market_context.resistance_level.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="relative h-4 bg-secondary rounded-full overflow-hidden">
                    {(() => {
                      const low = data.market_context.support_level
                      const high = data.market_context.resistance_level
                      const spot = data.market_context.underlying_price
                      const range = high - low
                      const spotPct = range > 0 ? ((spot - low) / range) * 100 : 50
                      return (
                        <>
                          <div className="absolute inset-0 bg-gradient-to-r from-green-500/20 via-yellow-500/10 to-red-500/20" />
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-primary"
                            style={{ left: `${Math.min(95, Math.max(5, spotPct))}%` }}
                          />
                        </>
                      )
                    })()}
                  </div>
                  <div className="flex items-center justify-center mt-1.5 gap-1.5 text-[10px] text-muted-foreground">
                    <span className="w-2 h-0.5 bg-primary inline-block" />
                    Current spot position within support-resistance range
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
