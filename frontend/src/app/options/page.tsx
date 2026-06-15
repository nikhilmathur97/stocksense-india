'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart2, RefreshCw, ChevronDown, AlertCircle, Wifi, WifiOff, Clock
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { optionSuggestionsApi } from '@/lib/api'
import { MarketContextBar } from '@/components/options/MarketContextBar'
import { LiveChainTable } from '@/components/options/LiveChainTable'
import { SelectedStrikePanel } from '@/components/options/SelectedStrikePanel'

const SYMBOLS = ['NIFTY 50', 'BANKNIFTY', 'FINNIFTY', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN']

export default function OptionsPage() {
  const [selectedSymbol, setSelectedSymbol] = useState('NIFTY 50')
  const [countdown, setCountdown] = useState(15)
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)

  const {
    data: chainData,
    isLoading,
    isFetching,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['liveChain', selectedSymbol],
    queryFn: () => optionSuggestionsApi.getLiveChain(selectedSymbol),
    refetchInterval: 15000,
    staleTime: 5000,
  })

  // Also fetch suggestions for market context
  const { data: suggestionsData } = useQuery({
    queryKey: ['optionSuggestionsCtx', selectedSymbol],
    queryFn: () => optionSuggestionsApi.getSuggestions(selectedSymbol),
    refetchInterval: 30000,
    staleTime: 10000,
  })

  // Countdown
  useEffect(() => { setCountdown(15) }, [dataUpdatedAt])
  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => (c <= 1 ? 15 : c - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  const handleRefresh = useCallback(() => { refetch(); setCountdown(15) }, [refetch])

  // Build chain strikes from live chain data
  const chainStrikes = useMemo(() => {
    if (!chainData?.calls || !chainData?.puts) return null
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
  }, [chainData])

  // Reset selected strike when symbol changes
  useEffect(() => { setSelectedStrike(null) }, [selectedSymbol])

  // Auto-select ATM when chain first loads or strike goes out of view
  useEffect(() => {
    if (!chainStrikes) return
    const visible = chainStrikes.strikes.map((s) => s.strike)
    if (selectedStrike == null || !visible.includes(selectedStrike)) {
      setSelectedStrike(chainStrikes.atm)
    }
  }, [chainStrikes, selectedStrike])

  const selectedRow = useMemo(
    () => chainStrikes?.strikes.find((s) => s.strike === selectedStrike) ?? null,
    [chainStrikes, selectedStrike]
  )

  const ctx = suggestionsData?.market_context
  const expiry = suggestionsData?.expiry ?? ''
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : undefined

  return (
    <div className="space-y-5 max-w-screen-2xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-blue-400" />
            Live Options Chain
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Full CE/PE data with Greeks, OI, IV · auto-refreshes every 15s
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Symbol selector */}
          <div className="relative">
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-secondary border border-border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
            >
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>

          {/* Live status */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isFetching
              ? <WifiOff className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
              : <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            }
            {isFetching ? 'Updating…' : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-IN')}` : 'Waiting…'}
          </div>

          {/* Countdown */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span className="num">{countdown}s</span>
          </div>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-sm text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Market Context Bar */}
      {ctx && (
        <MarketContextBar ctx={ctx} expiry={expiry} symbol={selectedSymbol} />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="glass rounded-xl p-4 space-y-2">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="h-6 bg-secondary rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="glass rounded-xl p-10 text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-400 opacity-60" />
          <p className="text-muted-foreground">Could not load options chain</p>
          <p className="text-xs text-muted-foreground mt-1">Market may be closed or data unavailable</p>
          <button onClick={handleRefresh} className="mt-4 px-4 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-sm text-primary transition-colors">
            Try Again
          </button>
        </div>
      )}

      {/* Selected Strike — Live Premium */}
      {chainStrikes && !isLoading && (
        <SelectedStrikePanel
          row={selectedRow}
          underlying={chainStrikes.underlying}
          symbol={selectedSymbol}
          expiry={expiry}
          isFetching={isFetching}
          lastUpdated={lastUpdated}
        />
      )}

      {/* Chain Table */}
      {chainStrikes && !isLoading && (
        <div className="glass rounded-xl p-4 overflow-hidden">
          {/* Summary row */}
          {suggestionsData && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-secondary/60 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Put-Call Ratio</p>
                <p className={cn(
                  'num text-xl font-bold mt-1',
                  suggestionsData.market_context.pcr > 1.2 ? 'text-emerald-400' :
                  suggestionsData.market_context.pcr < 0.8 ? 'text-red-400' : 'text-yellow-400'
                )}>
                  {suggestionsData.market_context.pcr.toFixed(2)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {suggestionsData.market_context.pcr > 1.2 ? '🐂 Bullish' : suggestionsData.market_context.pcr < 0.8 ? '🐻 Bearish' : '↔ Neutral'}
                </p>
              </div>
              <div className="bg-secondary/60 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Max Pain</p>
                <p className="num text-xl font-bold mt-1 text-yellow-400">
                  ₹{suggestionsData.market_context.max_pain.toLocaleString('en-IN')}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Options expiry magnet</p>
              </div>
              <div className="bg-secondary/60 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Underlying</p>
                <p className="num text-xl font-bold mt-1">
                  ₹{suggestionsData.market_context.underlying_price.toLocaleString('en-IN')}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {suggestionsData.expiry} expiry
                </p>
              </div>
            </div>
          )}

          <LiveChainTable
            strikes={chainStrikes.strikes}
            underlying={chainStrikes.underlying}
            atm={chainStrikes.atm}
            isFetching={isFetching}
            lastUpdated={lastUpdated}
            selectedStrike={selectedStrike}
            onSelectStrike={setSelectedStrike}
          />
        </div>
      )}

      {/* OI Analysis */}
      {suggestionsData && (
        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-purple-400" />
            OI Analysis — Key Levels
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="w-2 h-10 bg-red-500/60 rounded-full shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Resistance (Max CE OI)</p>
                <p className="num font-bold text-red-400 text-lg">
                  ₹{suggestionsData.market_context.resistance_level.toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-muted-foreground">Call writers defending — strong resistance</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <div className="w-2 h-10 bg-emerald-500/60 rounded-full shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Support (Max PE OI)</p>
                <p className="num font-bold text-emerald-400 text-lg">
                  ₹{suggestionsData.market_context.support_level.toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-muted-foreground">Put writers defending — strong support</p>
              </div>
            </div>
          </div>

          {/* Range bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span className="text-emerald-400">Support ₹{suggestionsData.market_context.support_level.toLocaleString('en-IN')}</span>
              <span className="text-primary font-medium">Spot ₹{suggestionsData.market_context.underlying_price.toLocaleString('en-IN')}</span>
              <span className="text-red-400">Resistance ₹{suggestionsData.market_context.resistance_level.toLocaleString('en-IN')}</span>
            </div>
            <div className="relative h-4 bg-secondary rounded-full overflow-hidden">
              {(() => {
                const low = suggestionsData.market_context.support_level
                const high = suggestionsData.market_context.resistance_level
                const spot = suggestionsData.market_context.underlying_price
                const range = high - low
                const spotPct = range > 0 ? ((spot - low) / range) * 100 : 50
                return (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 via-yellow-500/10 to-red-500/20" />
                    <div className="absolute top-0 bottom-0 w-0.5 bg-primary" style={{ left: `${Math.min(95, Math.max(5, spotPct))}%` }} />
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
