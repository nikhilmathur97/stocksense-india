'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { stocksApi, screenerApi } from '@/lib/api'
import { StockChart } from '@/components/charts/StockChart'
import { cn, formatPrice, formatVolume, signalColor } from '@/lib/utils'
import { TrendingUp, BarChart2, Activity, ArrowUp, ArrowDown } from 'lucide-react'

export default function StockDetailPage() {
  const params = useParams()
  const symbol = (params.symbol as string).toUpperCase()

  const { data: quote } = useQuery({
    queryKey: ['quote', symbol],
    queryFn: () => stocksApi.quote(symbol),
    refetchInterval: 5000,
  })

  const { data: indicators } = useQuery({
    queryKey: ['indicators', symbol, '1d'],
    queryFn: () => stocksApi.indicators(symbol, 'NSE', '1d'),
    refetchInterval: 60000,
  })

  // Use top-picks first (live-rescaled prices); fall back to full signals list
  const { data: topPicks } = useQuery({
    queryKey: ['topPicks'],
    queryFn:  () => screenerApi.topPicks(),
    refetchInterval: 30_000,
  })
  const { data: allSignals } = useQuery({
    queryKey: ['signals', 'all'],
    queryFn:  () => screenerApi.signals({ min_probability: 0, limit: 100 }),
  })
  const signal =
    topPicks?.find((s) => s.symbol === symbol) ??
    allSignals?.find((s) => s.symbol === symbol)

  const isPositive = (quote?.change_pct || 0) >= 0

  const indicatorItems = [
    { label: 'RSI (14)',    value: indicators?.rsi_14?.toFixed(1),                                         signal: indicators?.signals?.rsi_signal },
    { label: 'MACD',       value: indicators?.macd?.toFixed(2),                                            signal: indicators?.signals?.macd_crossover },
    { label: 'EMA 50',     value: indicators?.ema_50     ? `₹${formatPrice(indicators.ema_50)}`     : null, signal: indicators?.signals?.ema_signal },
    { label: 'Supertrend', value: indicators?.supertrend ? `₹${formatPrice(indicators.supertrend)}` : null, signal: indicators?.signals?.supertrend_signal },
    { label: 'Bollinger',  value: indicators?.bb_middle  ? `₹${formatPrice(indicators.bb_middle)}`  : null, signal: indicators?.signals?.bb_signal },
    { label: 'ADX (14)',   value: indicators?.adx_14?.toFixed(1),                                          signal: indicators?.signals?.adx_signal },
    { label: 'Stoch K',    value: indicators?.stoch_k?.toFixed(1),                                         signal: indicators?.signals?.stoch_signal },
    { label: 'MFI (14)',   value: indicators?.mfi_14?.toFixed(1),                                          signal: indicators?.signals?.mfi_signal },
  ]

  return (
    <div className="space-y-4 max-w-screen-2xl mx-auto">

      {/* ── Header: symbol + live price ── */}
      <div className="glass rounded-xl px-5 py-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{symbol}</h1>
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-secondary text-muted-foreground">NSE</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-secondary text-muted-foreground">Equity</span>
          </div>
          {quote && (
            <div className="flex flex-wrap gap-x-5 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
              <span>O&nbsp;<span className="num text-foreground font-medium">₹{formatPrice(quote.open)}</span></span>
              <span>H&nbsp;<span className="num text-green-400 font-medium">₹{formatPrice(quote.high)}</span></span>
              <span>L&nbsp;<span className="num text-red-400 font-medium">₹{formatPrice(quote.low)}</span></span>
              <span>C&nbsp;<span className="num text-foreground font-medium">₹{formatPrice(quote.close)}</span></span>
              <span>Vol&nbsp;<span className="num text-foreground font-medium">{formatVolume(quote.volume)}</span></span>
              {quote.week_52_high && (
                <span>52W H&nbsp;<span className="num text-foreground font-medium">₹{formatPrice(quote.week_52_high)}</span></span>
              )}
              {quote.week_52_low && (
                <span>52W L&nbsp;<span className="num text-foreground font-medium">₹{formatPrice(quote.week_52_low)}</span></span>
              )}
            </div>
          )}
        </div>

        {quote ? (
          <div className="text-right shrink-0">
            <p className="num text-3xl font-bold">₹{formatPrice(quote.ltp)}</p>
            <p className={cn('num text-sm font-semibold flex items-center justify-end gap-1 mt-0.5', isPositive ? 'text-green-400' : 'text-red-400')}>
              {isPositive ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
              ₹{formatPrice(Math.abs(quote.change))}&nbsp;({isPositive ? '+' : ''}{quote.change_pct.toFixed(2)}%)
            </p>
          </div>
        ) : (
          <div className="h-12 w-32 bg-secondary rounded animate-pulse" />
        )}
      </div>

      {/* ── Full-width Candlestick Chart + Indicators ── */}
      <div className="glass rounded-xl overflow-hidden border border-border/40 shadow-lg">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-background/60">
          <BarChart2 className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Chart + Indicators</span>
          <span className="text-xs text-muted-foreground">· EMA21 · EMA50 · RSI · MACD</span>
          {indicators?.overall_signal && (
            <span className={cn('ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-secondary', signalColor(indicators.overall_signal))}>
              {indicators.overall_signal.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <StockChart symbol={symbol} signal={signal} />
      </div>

      {/* ── Bottom row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Technical Indicators (2/3 width) */}
        <div className="lg:col-span-2 glass rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            Technical Indicators
            <span className="text-xs text-muted-foreground font-normal ml-1">(Daily)</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {indicatorItems.map((ind) => (
              <div key={ind.label} className="bg-secondary rounded-lg p-2.5">
                <p className="text-xs text-muted-foreground">{ind.label}</p>
                <p className="num text-sm font-semibold mt-0.5">{ind.value ?? '—'}</p>
                {ind.signal && (
                  <p className={cn('text-[10px] font-medium mt-0.5', signalColor(ind.signal))}>
                    {ind.signal.replace(/_/g, ' ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right sidebar (1/3 width) */}
        <div className="space-y-4">

          {/* AI Signal */}
          {signal ? (
            <div className="glass rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-yellow-400" />
                AI Signal
                <span className={cn('ml-auto text-xs font-bold px-2 py-0.5 rounded-full',
                  signal.signal_type === 'BULLISH' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                )}>
                  {signal.signal_type}
                </span>
              </h2>
              <div className="space-y-2">
                {[
                  { label: '3-Day Target',   value: signal.target_3d   ? `₹${formatPrice(signal.target_3d)}`   : '—', color: 'text-emerald-400' },
                  { label: '7-Day Target',   value: signal.target_7d   ? `₹${formatPrice(signal.target_7d)}`   : '—', color: 'text-green-400'   },
                  { label: 'Entry Price',    value: `₹${formatPrice(signal.entry_price || 0)}`,                        color: ''                  },
                  { label: 'Stop Loss',      value: `₹${formatPrice(signal.stop_loss || 0)}`,                          color: 'text-red-400'      },
                  { label: 'R/R Ratio',      value: `1 : ${signal.risk_reward_ratio?.toFixed(1) ?? '—'}`,               color: ''                  },
                  { label: '7d Probability', value: `${signal.probability_7d?.toFixed(0) ?? '—'}%`,                     color: 'text-blue-400'     },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className={cn('num font-medium', row.color)}>{row.value}</span>
                  </div>
                ))}
              </div>
              {signal.top_reasons?.[0] && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <p className="text-xs text-muted-foreground font-medium mb-1">Key Reason</p>
                  <p className="text-xs leading-relaxed">{signal.top_reasons[0]}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="glass rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-yellow-400" />
                AI Signal
              </h2>
              <p className="text-xs text-muted-foreground">No signal available for {symbol}.</p>
            </div>
          )}

          {/* Bollinger Bands */}
          {indicators?.bb_upper && (
            <div className="glass rounded-xl p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-purple-400" />
                Bollinger Bands
              </h2>
              <div className="space-y-1.5 text-sm">
                {[
                  { label: 'Upper',        value: indicators.bb_upper,  color: 'text-red-400' },
                  { label: 'Middle (SMA)', value: indicators.bb_middle, color: 'text-foreground' },
                  { label: 'Lower',        value: indicators.bb_lower,  color: 'text-green-400' },
                ].map((b) => (
                  <div key={b.label} className="flex justify-between">
                    <span className="text-muted-foreground">{b.label}</span>
                    <span className={cn('num font-medium', b.color)}>₹{formatPrice(b.value || 0)}</span>
                  </div>
                ))}
                {indicators.bb_width != null && (
                  <div className="flex justify-between pt-1 border-t border-border/50">
                    <span className="text-muted-foreground">Width</span>
                    <span className="num font-medium">{indicators.bb_width.toFixed(2)}%</span>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
