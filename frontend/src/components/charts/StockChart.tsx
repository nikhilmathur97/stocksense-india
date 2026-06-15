'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type IPriceLine,
  type Time,
  type AutoscaleInfo,
} from 'lightweight-charts'
import { useQuery } from '@tanstack/react-query'
import { stocksApi, type StockSignal, type OHLCVCandle } from '@/lib/api'
import { cn } from '@/lib/utils'
import { RefreshCw } from 'lucide-react'

// ── Timeframe config ──────────────────────────────────────────────────────────

type TF = { label: string; interval: string; intraday: boolean; showDays: number }

const TIMEFRAMES: TF[] = [
  { label: '3m',  interval: '3m',  intraday: true,  showDays: 1   },
  { label: '5m',  interval: '5m',  intraday: true,  showDays: 2   },
  { label: '10m', interval: '10m', intraday: true,  showDays: 3   },
  { label: '15m', interval: '15m', intraday: true,  showDays: 5   },
  { label: '1W',  interval: '1h',  intraday: true,  showDays: 7   },
  { label: '1M',  interval: '1d',  intraday: false, showDays: 30  },
  { label: '3M',  interval: '1d',  intraday: false, showDays: 90  },
  { label: '1Y',  interval: '1d',  intraday: false, showDays: 365 },
  { label: 'All', interval: '1d',  intraday: false, showDays: 9999 },
]

// ── Time helpers ──────────────────────────────────────────────────────────────

// Daily: extract date directly from IST string (avoids UTC -5:30 shift)
function dailyTime(iso: string): Time { return iso.slice(0, 10) as Time }

// Intraday: treat IST wall-clock as UTC so axis shows 09:15, 13:05 etc.
function intradayTime(iso: string): Time {
  return Math.floor(new Date(`${iso.slice(0, 19)}Z`).getTime() / 1000) as Time
}

// ── Indicator math (client-side) ──────────────────────────────────────────────

function calcEMA(closes: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1)
  const out: (number | null)[] = []
  let ema = closes[0]
  for (let i = 0; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
    out.push(i < period - 1 ? null : ema)
  }
  return out
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period + 1) return out
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

function calcMACD(closes: number[], fast = 12, slow = 26, sigPeriod = 9) {
  const emaFast = calcEMA(closes, fast)
  const emaSlow = calcEMA(closes, slow)
  const macdLine = emaFast.map((f, i) =>
    f !== null && emaSlow[i] !== null ? f - emaSlow[i]! : null
  )
  const k = 2 / (sigPeriod + 1)
  let sigEma: number | null = null
  const sigLine: (number | null)[] = new Array(closes.length).fill(null)
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) continue
    sigEma = sigEma === null ? macdLine[i]! : macdLine[i]! * k + sigEma * (1 - k)
    sigLine[i] = sigEma
  }
  const hist = macdLine.map((m, i) =>
    m !== null && sigLine[i] !== null ? m - sigLine[i]! : null
  )
  return { macdLine, sigLine, hist }
}

// ── Shared chart options factory ──────────────────────────────────────────────

function baseChartOpts(showTimeAxis: boolean) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor:  '#94a3b8',
      fontFamily: "'Inter', 'DM Mono', monospace",
      fontSize:   10,
    },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.03)' },
      horzLines: { color: 'rgba(255,255,255,0.03)' },
    },
    crosshair: {
      mode:     CrosshairMode.Normal,
      vertLine: { color: '#475569', labelBackgroundColor: '#1e293b' },
      horzLine: { color: '#475569', labelBackgroundColor: '#1e293b' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
    timeScale: {
      borderColor:    'rgba(255,255,255,0.06)',
      visible:        showTimeAxis,
      timeVisible:    true,
      secondsVisible: false,
      fixLeftEdge:    true,
      fixRightEdge:   true,
    },
    handleScroll: true,
    handleScale:  true,
  }
}

// ── Signal price lines ────────────────────────────────────────────────────────

function buildLineSpecs(signal?: StockSignal) {
  if (!signal) return []
  return [
    signal.stop_loss   && { price: signal.stop_loss,   color: '#ef4444', title: '▼ SL',       width: 2 as const, style: LineStyle.Dashed },
    signal.entry_price && { price: signal.entry_price, color: '#3b82f6', title: '▶ Entry',     width: 2 as const, style: LineStyle.Solid  },
    signal.target_3d   && { price: signal.target_3d,   color: '#10b981', title: '▲ 3d Target', width: 1 as const, style: LineStyle.Dashed },
    signal.target_7d   && { price: signal.target_7d,   color: '#22c55e', title: '▲ 7d Target', width: 2 as const, style: LineStyle.Dashed },
  ].filter(Boolean) as { price: number; color: string; title: string; width: 1|2; style: LineStyle }[]
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { symbol: string; signal?: StockSignal }

export function StockChart({ symbol, signal }: Props) {
  // DOM refs
  const mainRef = useRef<HTMLDivElement>(null)
  const rsiRef  = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)

  // Chart instances
  const mainChart = useRef<IChartApi | null>(null)
  const rsiChart  = useRef<IChartApi | null>(null)
  const macdChart = useRef<IChartApi | null>(null)

  // Series refs
  const candleSeries  = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volSeries     = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ema21Series   = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Series   = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiSeries     = useRef<ISeriesApi<'Line'> | null>(null)
  const macdHistSeries = useRef<ISeriesApi<'Histogram'> | null>(null)
  const macdLineSeries = useRef<ISeriesApi<'Line'> | null>(null)
  const macdSigSeries  = useRef<ISeriesApi<'Line'> | null>(null)
  const priceLines    = useRef<IPriceLine[]>([])

  // Always-current signal ref for autoscaleInfoProvider closure
  const signalRef = useRef<StockSignal | undefined>(signal)
  signalRef.current = signal

  const [chartReady, setChartReady] = useState(false)
  const [tfIdx, setTfIdx] = useState(6) // default 3M
  const tf = TIMEFRAMES[tfIdx]

  // ── Fetch OHLCV ────────────────────────────────────────────────────────────
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['ohlcv', symbol, tf.interval],
    queryFn:  () => stocksApi.historical(symbol, 'NSE', tf.interval),
    refetchInterval: tf.intraday ? 15_000 : 60_000,
    staleTime:       tf.intraday ? 10_000 : 55_000,
  })

  // ── Create charts (once) ───────────────────────────────────────────────────
  useEffect(() => {
    if (!mainRef.current || !rsiRef.current || !macdRef.current) return

    // ── Main chart ──
    const mc = createChart(mainRef.current, {
      ...baseChartOpts(false),
      rightPriceScale: {
        borderColor:  'rgba(255,255,255,0.06)',
        scaleMargins: { top: 0.06, bottom: 0.20 },
      },
    })

    const cs = mc.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor:   '#22c55e', wickDownColor:   '#ef4444',
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const base = original()
        const sig  = signalRef.current
        if (!sig) return base
        const prices = [sig.stop_loss, sig.entry_price, sig.target_3d, sig.target_7d]
          .filter((p): p is number => !!p)
        if (!prices.length) return base
        const mn = Math.min(...prices), mx = Math.max(...prices)
        if (!base) return { priceRange: { minValue: mn, maxValue: mx }, margins: { above: 0.1, below: 0.1 } }
        return {
          priceRange: {
            minValue: Math.min(base.priceRange.minValue, mn),
            maxValue: Math.max(base.priceRange.maxValue, mx),
          },
          margins: base.margins,
        }
      },
    })

    const vs = mc.addHistogramSeries({
      color: '#60a5fa', priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    })
    mc.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    const e21 = mc.addLineSeries({ color: '#f97316', lineWidth: 1, title: 'EMA21', priceLineVisible: false, lastValueVisible: true  })
    const e50 = mc.addLineSeries({ color: '#a855f7', lineWidth: 1, title: 'EMA50', priceLineVisible: false, lastValueVisible: true  })

    // ── RSI chart ──
    const rc = createChart(rsiRef.current, {
      ...baseChartOpts(false),
      rightPriceScale: {
        borderColor:  'rgba(255,255,255,0.06)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
        minimumWidth: 60,
      },
    })
    const rsiS = rc.addLineSeries({ color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    // Overbought / Oversold / Midline reference
    ;[{ p: 70, c: '#ef4444', t: 'OB' }, { p: 50, c: '#475569', t: '' }, { p: 30, c: '#22c55e', t: 'OS' }]
      .forEach(({ p, c, t }) =>
        rsiS.createPriceLine({ price: p, color: c, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: !!t, title: t })
      )

    // ── MACD chart ──
    const macd = createChart(macdRef.current, {
      ...baseChartOpts(true),
      rightPriceScale: {
        borderColor:  'rgba(255,255,255,0.06)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
        minimumWidth: 60,
      },
    })
    const mh = macd.addHistogramSeries({ priceFormat: { type: 'price', precision: 2 }, priceLineVisible: false, lastValueVisible: false })
    const ml = macd.addLineSeries({ color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'MACD' })
    const ms = macd.addLineSeries({ color: '#f97316', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'Signal' })
    macd.addLineSeries({ color: '#475569', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      .createPriceLine({ price: 0, color: '#475569', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' })

    // Store refs
    mainChart.current = mc; candleSeries.current = cs; volSeries.current = vs
    ema21Series.current = e21; ema50Series.current = e50
    rsiChart.current = rc; rsiSeries.current = rsiS
    macdChart.current = macd; macdHistSeries.current = mh; macdLineSeries.current = ml; macdSigSeries.current = ms

    // ── Sync time ranges ──
    mc.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return
      rc.timeScale().setVisibleLogicalRange(range)
      macd.timeScale().setVisibleLogicalRange(range)
    })
    rc.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return
      mc.timeScale().setVisibleLogicalRange(range)
      macd.timeScale().setVisibleLogicalRange(range)
    })
    macd.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return
      mc.timeScale().setVisibleLogicalRange(range)
      rc.timeScale().setVisibleLogicalRange(range)
    })

    // ── Sync crosshair ──
    mc.subscribeCrosshairMove((p) => {
      if (p.time) {
        rc.setCrosshairPosition(NaN, p.time, rsiS)
        macd.setCrosshairPosition(NaN, p.time, mh)
      } else {
        rc.clearCrosshairPosition()
        macd.clearCrosshairPosition()
      }
    })

    // ── Resize observers ──
    const mkRo = (el: HTMLDivElement, chart: IChartApi) => {
      const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
      ro.observe(el)
      return ro
    }
    const ro1 = mkRo(mainRef.current, mc)
    const ro2 = mkRo(rsiRef.current,  rc)
    const ro3 = mkRo(macdRef.current, macd)

    setChartReady(true)

    return () => {
      ro1.disconnect(); ro2.disconnect(); ro3.disconnect()
      mc.remove(); rc.remove(); macd.remove()
      mainChart.current = rsiChart.current = macdChart.current = null
      candleSeries.current = volSeries.current = null
      ema21Series.current = ema50Series.current = null
      rsiSeries.current = null
      macdHistSeries.current = macdLineSeries.current = macdSigSeries.current = null
      priceLines.current = []
      setChartReady(false)
    }
  }, [])

  // ── Load & compute indicators whenever data / timeframe changes ─────────────
  useEffect(() => {
    if (!chartReady || !data?.candles) return
    if (!candleSeries.current || !volSeries.current) return
    if (!ema21Series.current || !ema50Series.current) return
    if (!rsiSeries.current || !macdHistSeries.current) return

    const cutoff = Date.now() - tf.showDays * 24 * 60 * 60 * 1000
    const toTime  = tf.intraday ? intradayTime : dailyTime

    // Sort ALL candles for indicator accuracy (EMAs need full history)
    const all = [...data.candles].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    const closes = all.map((c) => c.close)

    // Compute indicators on full history
    const ema21  = calcEMA(closes, 21)
    const ema50  = calcEMA(closes, 50)
    const rsi    = calcRSI(closes, 14)
    const { macdLine, sigLine, hist } = calcMACD(closes)

    // Filter to visible window
    const visible = all.filter((c) => new Date(c.time).getTime() >= cutoff)
    const startIdx = all.length - visible.length

    const toLD = (vals: (number | null)[], from: number, candles: OHLCVCandle[]): LineData[] =>
      candles.map((c, i) => ({ time: toTime(c.time), value: vals[from + i] ?? NaN }))
        .filter((d) => !isNaN(d.value as number)) as LineData[]

    // Candles + volume
    candleSeries.current.setData(
      visible.map((c) => ({ time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))
    )
    volSeries.current.setData(
      visible.map((c) => ({ time: toTime(c.time), value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)' }))
    )

    // EMA lines
    ema21Series.current.setData(toLD(ema21, startIdx, visible))
    ema50Series.current.setData(toLD(ema50, startIdx, visible))

    // RSI
    rsiSeries.current.setData(toLD(rsi, startIdx, visible))

    // MACD histogram (green above zero, red below)
    macdHistSeries.current.setData(
      visible.map((c, i) => {
        const v = hist[startIdx + i]
        return { time: toTime(c.time), value: v ?? NaN, color: (v ?? 0) >= 0 ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)' }
      }).filter((d) => !isNaN(d.value as number)) as HistogramData[]
    )
    macdLineSeries.current?.setData(toLD(macdLine, startIdx, visible))
    macdSigSeries.current?.setData(toLD(sigLine, startIdx, visible))

    mainChart.current?.timeScale().fitContent()
    rsiChart.current?.timeScale().fitContent()
    macdChart.current?.timeScale().fitContent()
  }, [chartReady, data, tf.interval, tf.intraday, tf.showDays])

  // ── Signal price lines ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady || !candleSeries.current) return

    priceLines.current.forEach((l) => { try { candleSeries.current!.removePriceLine(l) } catch {} })
    priceLines.current = []

    const specs = buildLineSpecs(signal)
    priceLines.current = specs.map((s) =>
      candleSeries.current!.createPriceLine({
        price: s.price, color: s.color, lineWidth: s.width,
        lineStyle: s.style, axisLabelVisible: true, title: s.title,
      })
    )
    if (specs.length) {
      candleSeries.current.applyOptions({})
      mainChart.current?.timeScale().fitContent()
    }
  }, [chartReady, signal?.entry_price, signal?.target_3d, signal?.target_7d, signal?.stop_loss])

  // ── Refit on timeframe toggle ───────────────────────────────────────────────
  useEffect(() => {
    mainChart.current?.timeScale().fitContent()
  }, [tfIdx])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/30 flex-wrap">
        {/* Intraday */}
        <div className="flex items-center gap-0.5 mr-2">
          {['3m','5m','10m','15m'].map((lbl) => {
            const idx = TIMEFRAMES.findIndex((t) => t.label === lbl)
            return (
              <button key={lbl} onClick={() => setTfIdx(idx)}
                className={cn('px-2 py-1 rounded text-xs font-semibold transition-colors',
                  tfIdx === idx ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:text-foreground hover:bg-secondary')}>
                {lbl}
              </button>
            )
          })}
        </div>
        <div className="w-px h-4 bg-border/50 mr-2" />
        {/* Higher TF */}
        {['1W','1M','3M','1Y','All'].map((lbl) => {
          const idx = TIMEFRAMES.findIndex((t) => t.label === lbl)
          return (
            <button key={lbl} onClick={() => setTfIdx(idx)}
              className={cn('px-2 py-1 rounded text-xs font-semibold transition-colors',
                tfIdx === idx ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary')}>
              {lbl}
            </button>
          )
        })}

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
          {tf.intraday && <span className="text-muted-foreground/50 font-medium">IST</span>}
          <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-orange-400" />EMA21</span>
          <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-purple-400" />EMA50</span>
          {signal && <>
            <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-blue-500" />Entry</span>
            <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-green-400 border-dashed" />Target</span>
            <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-red-500 border-dashed" />SL</span>
          </>}
          <button onClick={() => refetch()} className="p-1 rounded hover:bg-secondary" title="Refresh">
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── Main price chart (candles + EMA21 + EMA50 + volume) ── */}
      <div className="relative">
        <span className="absolute left-2 top-1.5 text-[9px] text-muted-foreground/50 z-10 pointer-events-none">Price</span>
        <div ref={mainRef} style={{ height: 320 }} />
      </div>

      {/* ── RSI pane ── */}
      <div className="relative border-t border-border/20">
        <span className="absolute left-2 top-1.5 text-[9px] text-muted-foreground/50 z-10 pointer-events-none">RSI(14)</span>
        <div ref={rsiRef} style={{ height: 100 }} />
      </div>

      {/* ── MACD pane ── */}
      <div className="relative border-t border-border/20">
        <span className="absolute left-2 top-1.5 text-[9px] text-muted-foreground/50 z-10 pointer-events-none">MACD(12,26,9)</span>
        <div ref={macdRef} style={{ height: 100 }} />
      </div>
    </div>
  )
}
