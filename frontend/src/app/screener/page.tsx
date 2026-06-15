'use client'

import { useEffect, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Zap, RefreshCw, Clock, History, TrendingUp, TrendingDown } from 'lucide-react'
import { screenerApi, type BacktestCalibration } from '@/lib/api'
import { SignalCard } from '@/components/screener/SignalCard'
import { ScreenerFilters } from '@/components/screener/ScreenerFilters'
import { useScreenerStore } from '@/store'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

const REFETCH_INTERVAL_MS = 60_000

export default function ScreenerPage() {
  const { filters, setSignals } = useScreenerStore()
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState(REFETCH_INTERVAL_MS / 1000)
  const [isCalibrating, setIsCalibrating] = useState(false)

  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['screenerSignals', filters],
    queryFn: () =>
      screenerApi.signals({
        min_probability: filters.minProbability,
        signal_type: filters.signalType || undefined,
        category: filters.category || undefined,
        sort_by: filters.sortBy || 'probability_score',
        limit: 100,
      }),
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    staleTime: 55_000,
  })

  const { data: backtestData, refetch: refetchBacktest } = useQuery({
    queryKey: ['backtestResults'],
    queryFn: screenerApi.backtestResults,
    staleTime: 3600_000,  // backtest is expensive — cache 1 hour
    retry: false,
  })

  useEffect(() => {
    if (dataUpdatedAt) {
      setLastUpdated(new Date(dataUpdatedAt))
      setCountdown(REFETCH_INTERVAL_MS / 1000)
    }
  }, [dataUpdatedAt])

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? REFETCH_INTERVAL_MS / 1000 : prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (data) setSignals(data)
  }, [data, setSignals])

  const handleRunScreener = useCallback(async () => {
    const t = toast.loading('Running AI screener… (30–60s)', { duration: 120_000 })
    try {
      const result = await screenerApi.run()
      toast.success(result.message || 'Screener complete', { id: t })
      await refetch()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Screener failed'
      toast.error(msg, { id: t })
    }
  }, [refetch])

  const handleCalibrate = useCallback(async () => {
    setIsCalibrating(true)
    const t = toast.loading('Running walk-forward backtest on 220+ stocks… (~60s)', { duration: 120_000 })
    try {
      await screenerApi.runBacktest()
      toast.success('Backtest started — results will appear shortly', { id: t })
      // Poll for results after 10s, then refresh signals to show calibrated scores
      setTimeout(async () => {
        await refetchBacktest()
        await refetch()
      }, 12_000)
    } catch {
      toast.error('Backtest failed to start', { id: t })
    } finally {
      setTimeout(() => setIsCalibrating(false), 12_000)
    }
  }, [refetch, refetchBacktest])

  const signals = data || []
  const highConf = signals.filter((s) => s.confidence === 'HIGH').length
  const strongBuy = signals.filter((s) => s.signal_type === 'STRONG_BUY').length
  const hasBacktest = backtestData && Object.keys(backtestData).length > 0

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className="space-y-6 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            AI Stock Screener
          </h1>
          <p className="text-sm text-muted-foreground">
            {signals.length} signals · {highConf} high confidence · {strongBuy} strong buy
          </p>
          <div className="flex items-center gap-3 mt-1">
            {lastUpdated && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                Updated {formatTime(lastUpdated)}
              </span>
            )}
            {!isFetching && (
              <span className="text-xs text-muted-foreground tabular-nums">
                Next refresh in{' '}
                <span className={countdown <= 10 ? 'text-yellow-400 font-semibold' : ''}>
                  {countdown}s
                </span>
              </span>
            )}
            {isFetching && (
              <span className="flex items-center gap-1 text-xs text-primary animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Refreshing…
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleCalibrate}
            disabled={isCalibrating}
            title="Run walk-forward backtest on all stocks to compute historical signal accuracy"
            className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
          >
            <History className={cn('w-4 h-4', isCalibrating && 'animate-spin')} />
            {isCalibrating ? 'Calibrating…' : 'Calibrate Accuracy'}
          </button>
          <button
            onClick={handleRunScreener}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-sm text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            Run Screener
          </button>
        </div>
      </div>

      {/* Backtest accuracy banner */}
      {hasBacktest && (
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold">Historical Accuracy by Signal Category</span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              Walk-forward backtest · 7-day outcomes · {Object.values(backtestData as Record<string, BacktestCalibration>).reduce((a, b) => a + b.sample_count, 0).toLocaleString()} trades evaluated
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(backtestData as Record<string, BacktestCalibration>)
              .sort((a, b) => b[1].win_rate_7d - a[1].win_rate_7d)
              .map(([cat, stats]) => (
                <div key={cat} className="bg-secondary/40 rounded-lg p-3">
                  <p className="text-[10px] text-muted-foreground mb-1 truncate">{cat}</p>
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn(
                      'num text-lg font-bold',
                      stats.win_rate_7d >= 55 ? 'text-emerald-400' :
                      stats.win_rate_7d >= 45 ? 'text-yellow-400' : 'text-red-400'
                    )}>
                      {stats.win_rate_7d.toFixed(1)}%
                    </span>
                    {stats.win_rate_7d >= 55
                      ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      : <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                    }
                  </div>
                  <div className="h-1 bg-secondary rounded-full overflow-hidden mb-1.5">
                    <div
                      className={cn('h-full rounded-full', stats.win_rate_7d >= 55 ? 'bg-emerald-500' : stats.win_rate_7d >= 45 ? 'bg-yellow-500' : 'bg-red-500')}
                      style={{ width: `${stats.win_rate_7d}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-muted-foreground">
                    {stats.winning_trades}W / {stats.losing_trades}L · {stats.sample_count} trades
                  </p>
                  <p className={cn('text-[9px] num mt-0.5', stats.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    E[R] {stats.expectancy >= 0 ? '+' : ''}{stats.expectancy.toFixed(2)}%
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <ScreenerFilters />

      {/* Signals Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass rounded-xl h-52 animate-pulse" />
          ))}
        </div>
      ) : signals.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No signals found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Try lowering the minimum probability filter or run the screener
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {signals.map((sig) => (
            <SignalCard key={`${sig.symbol}-${sig.exchange}`} signal={sig} />
          ))}
        </div>
      )}
    </div>
  )
}
