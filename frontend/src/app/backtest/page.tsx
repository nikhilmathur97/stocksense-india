'use client'

import { useState, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  FlaskConical, Play, TrendingUp, TrendingDown,
  Target, ShieldAlert, Activity, Info,
  ChevronDown, ChevronUp, AlertTriangle, Layers, BarChart3
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { backtestApi, BacktestRequest, BacktestResult, BacktestTrade } from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 0) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtPct(n: number) {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}
function fmtCur(n: number) {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e7) return sign + '₹' + (abs / 1e7).toFixed(2) + 'Cr'
  if (abs >= 1e5) return sign + '₹' + (abs / 1e5).toFixed(2) + 'L'
  return sign + '₹' + fmt(abs)
}

// ── Metric Card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon: Icon, color, highlight,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  color?: string
  highlight?: boolean
}) {
  return (
    <div className={cn('glass rounded-xl p-4 flex flex-col gap-1', highlight && 'border border-primary/30 bg-primary/5')}>
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={cn('text-xl font-bold num', color ?? 'text-foreground')}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

// ── Equity Curve SVG ──────────────────────────────────────────────────────────

function EquityCurve({ points, initialCapital }: { points: { equity: number; date: string }[]; initialCapital: number }) {
  if (!points.length) return null
  const W = 800, H = 160, PAD = 8
  const values = points.map(p => p.equity)
  const minV = Math.min(...values, initialCapital)
  const maxV = Math.max(...values, initialCapital)
  const range = maxV - minV || 1
  const toX = (i: number) => PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2)
  const toY = (v: number) => H - PAD - ((v - minV) / range) * (H - PAD * 2)
  const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + toX(i).toFixed(1) + ',' + toY(p.equity).toFixed(1)).join(' ')
  const areaD = pathD + ' L' + toX(points.length - 1).toFixed(1) + ',' + H + ' L' + toX(0).toFixed(1) + ',' + H + ' Z'
  const finalEquity = points[points.length - 1]?.equity ?? initialCapital
  const isProfit = finalEquity >= initialCapital
  const color = isProfit ? '#22c55e' : '#ef4444'
  const baseY = toY(initialCapital)
  const step = Math.max(1, Math.floor(points.length / 40))

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full h-40" preserveAspectRatio="none">
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={PAD} y1={baseY} x2={W - PAD} y2={baseY} stroke="#ffffff20" strokeWidth="1" strokeDasharray="4 4" />
        <path d={areaD} fill="url(#eqGrad)" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
        {points.filter((_, i) => i % step === 0).map((p, i) => (
          <circle key={i} cx={toX(points.indexOf(p))} cy={toY(p.equity)} r="2"
            fill={p.equity >= initialCapital ? '#22c55e' : '#ef4444'} opacity="0.7" />
        ))}
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground mt-1 px-1">
        <span>{points[0]?.date}</span>
        <span className={cn('font-semibold', isProfit ? 'text-green-400' : 'text-red-400')}>
          {fmtCur(finalEquity)} ({fmtPct((finalEquity - initialCapital) / initialCapital * 100)})
        </span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  )
}

// ── Monthly Bar Chart ─────────────────────────────────────────────────────────

function MonthlyBars({ data }: { data: { month: string; pnl: number; trades: number; win_rate: number }[] }) {
  if (!data.length) return null
  const maxAbs = Math.max(...data.map(d => Math.abs(d.pnl)), 1)
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 min-w-max h-40 px-2 pb-6">
        {data.map(m => {
          const pct = (Math.abs(m.pnl) / maxAbs) * 100
          const isPos = m.pnl >= 0
          return (
            <div key={m.month} className="flex flex-col items-center gap-0.5 group relative" style={{ minWidth: 36 }}>
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-lg p-2 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                <div className="font-semibold">{m.month}</div>
                <div className={isPos ? 'text-green-400' : 'text-red-400'}>{fmtCur(m.pnl)}</div>
                <div className="text-muted-foreground">{m.trades} trades · {m.win_rate}% WR</div>
              </div>
              <div className="flex flex-col justify-end" style={{ height: 100 }}>
                <div className={cn('rounded-t transition-all', isPos ? 'bg-green-500/70' : 'bg-red-500/70')}
                  style={{ height: Math.max(4, pct) + '%', width: 28 }} />
              </div>
              <span className="text-[9px] text-muted-foreground rotate-45 origin-left mt-1 whitespace-nowrap">
                {m.month.slice(5)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Exit Reason Bar ───────────────────────────────────────────────────────────

function ExitBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1 bg-muted/30 rounded-full h-2 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: pct + '%' }} />
      </div>
      <span className="text-xs num w-16 text-right">
        {count} <span className="text-muted-foreground">({pct.toFixed(0)}%)</span>
      </span>
    </div>
  )
}

// ── Trade Row ─────────────────────────────────────────────────────────────────

function TradeRow({ trade, idx }: { trade: BacktestTrade; idx: number }) {
  const [open, setOpen] = useState(false)
  const isWin = trade.net_pnl > 0
  return (
    <>
      <tr
        className={cn('border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors text-xs', isWin ? 'hover:bg-green-500/5' : 'hover:bg-red-500/5')}
        onClick={() => setOpen(!open)}
      >
        <td className="py-2 px-3 text-muted-foreground">{idx + 1}</td>
        <td className="py-2 px-3 num">{trade.date}</td>
        <td className="py-2 px-3">
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold', trade.option_type === 'CE' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400')}>
            {trade.option_type}
          </span>
        </td>
        <td className="py-2 px-3 num">{fmt(trade.strike)}</td>
        <td className="py-2 px-3 num">{trade.entry_price.toFixed(2)}</td>
        <td className="py-2 px-3 num">{trade.exit_price.toFixed(2)}</td>
        <td className="py-2 px-3">
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold',
            trade.exit_reason === 'T2' ? 'bg-green-500/20 text-green-400' :
            trade.exit_reason === 'T1' ? 'bg-emerald-500/20 text-emerald-400' :
            trade.exit_reason === 'SL' ? 'bg-red-500/20 text-red-400' :
            'bg-muted text-muted-foreground')}>
            {trade.exit_reason}
          </span>
        </td>
        <td className={cn('py-2 px-3 num font-semibold', isWin ? 'text-green-400' : 'text-red-400')}>{fmtCur(trade.net_pnl)}</td>
        <td className={cn('py-2 px-3 num', isWin ? 'text-green-400' : 'text-red-400')}>{fmtPct(trade.pnl_pct)}</td>
        <td className="py-2 px-3 text-muted-foreground">{trade.confidence}%</td>
        <td className="py-2 px-3">{open ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}</td>
      </tr>
      {open && (
        <tr className="bg-accent/20 border-b border-border/50">
          <td colSpan={11} className="px-4 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div><div className="text-muted-foreground mb-0.5">Expiry</div><div className="font-medium">{trade.expiry}</div></div>
              <div><div className="text-muted-foreground mb-0.5">Stop Loss</div><div className="font-medium text-red-400">{trade.stop_loss.toFixed(2)}</div></div>
              <div><div className="text-muted-foreground mb-0.5">Target 1</div><div className="font-medium text-emerald-400">{trade.target_1.toFixed(2)}</div></div>
              <div><div className="text-muted-foreground mb-0.5">Target 2</div><div className="font-medium text-green-400">{trade.target_2.toFixed(2)}</div></div>
              <div>
                <div className="text-muted-foreground mb-0.5">Trend</div>
                <div className={cn('font-medium', trade.trend === 'BULLISH' ? 'text-green-400' : trade.trend === 'BEARISH' ? 'text-red-400' : 'text-yellow-400')}>{trade.trend}</div>
              </div>
              <div><div className="text-muted-foreground mb-0.5">PCR</div><div className="font-medium">{trade.pcr}</div></div>
              <div><div className="text-muted-foreground mb-0.5">Holding Periods</div><div className="font-medium">{trade.holding_periods}</div></div>
              <div><div className="text-muted-foreground mb-0.5">Brokerage</div><div className="font-medium text-muted-foreground">₹{trade.brokerage}</div></div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BacktestRequest = {
  symbol: 'NIFTY 50',
  start_date: '',
  end_date: '',
  initial_capital: 500000,
  lots_per_trade: 1,
  trade_type: 'INTRADAY',
  min_confidence: 70,
  t1_exit_pct: 0.5,
  brokerage_per_lot: 40,
}

type Tab = 'overview' | 'trades' | 'monthly'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BacktestPage() {
  const [config, setConfig] = useState<BacktestRequest>(DEFAULT_CONFIG)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [tradeFilter, setTradeFilter] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL')
  const [sortField, setSortField] = useState<keyof BacktestTrade>('trade_id')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const mutation = useMutation({ mutationFn: () => backtestApi.run(config) })

  const result = mutation.data as BacktestResult | undefined
  const m = result?.metrics
  const isProfit = (m?.total_pnl ?? 0) >= 0

  const filteredTrades = useMemo(() => {
    if (!result?.trades) return []
    let trades = [...result.trades]
    if (tradeFilter === 'WIN') trades = trades.filter(t => t.net_pnl > 0)
    if (tradeFilter === 'LOSS') trades = trades.filter(t => t.net_pnl <= 0)
    trades.sort((a, b) => {
      const av = a[sortField] as number | string
      const bv = b[sortField] as number | string
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return trades
  }, [result?.trades, tradeFilter, sortField, sortDir])

  function toggleSort(field: keyof BacktestTrade) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function SortIcon({ field }: { field: keyof BacktestTrade }) {
    if (sortField !== field) return <span className="opacity-30">↕</span>
    return <span>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const totalExits = (m?.sl_exits ?? 0) + (m?.t1_exits ?? 0) + (m?.t2_exits ?? 0) + (m?.eod_exits ?? 0) + (m?.expiry_exits ?? 0)
  const bd = result?.strategy_breakdown

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 min-h-screen">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <FlaskConical className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Strategy Backtest</h1>
          <p className="text-sm text-muted-foreground">Test the options trading strategy on historical NIFTY data using Black-Scholes pricing</p>
        </div>
      </div>

      {/* Config Panel */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Backtest Configuration</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Symbol</label>
            <select value={config.symbol} onChange={e => setConfig(c => ({ ...c, symbol: e.target.value }))}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="NIFTY 50">NIFTY 50</option>
              <option value="BANKNIFTY">BANKNIFTY</option>
              <option value="FINNIFTY">FINNIFTY</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Start Date</label>
            <input type="date" value={config.start_date} onChange={e => setConfig(c => ({ ...c, start_date: e.target.value }))}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">End Date</label>
            <input type="date" value={config.end_date} onChange={e => setConfig(c => ({ ...c, end_date: e.target.value }))}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Trade Type</label>
            <select value={config.trade_type} onChange={e => setConfig(c => ({ ...c, trade_type: e.target.value as 'INTRADAY' | 'SWING' }))}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="INTRADAY">Intraday</option>
              <option value="SWING">Swing</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Capital (₹)</label>
            <select value={config.initial_capital} onChange={e => setConfig(c => ({ ...c, initial_capital: Number(e.target.value) }))}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
              <option value={100000}>₹1 Lakh</option>
              <option value={250000}>₹2.5 Lakh</option>
              <option value={500000}>₹5 Lakh</option>
              <option value={1000000}>₹10 Lakh</option>
              <option value={2500000}>₹25 Lakh</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Lots per Trade</label>
            <select value={config.lots_per_trade} onChange={e => setConfig(c => ({ ...c, lots_per_trade: Number(e.target.value) }))}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
              {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n} lot{n > 1 ? 's' : ''} ({n * 75} qty)</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Min Confidence: {config.min_confidence}%</label>
            <input type="range" min={50} max={90} step={5} value={config.min_confidence}
              onChange={e => setConfig(c => ({ ...c, min_confidence: Number(e.target.value) }))}
              className="accent-primary mt-1" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">T1 Exit: {((config.t1_exit_pct ?? 0.5) * 100).toFixed(0)}%</label>
            <input type="range" min={0} max={100} step={10} value={(config.t1_exit_pct ?? 0.5) * 100}
              onChange={e => setConfig(c => ({ ...c, t1_exit_pct: Number(e.target.value) / 100 }))}
              className="accent-primary mt-1" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Brokerage/Lot (₹)</label>
            <select value={config.brokerage_per_lot} onChange={e => setConfig(c => ({ ...c, brokerage_per_lot: Number(e.target.value) }))}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
              <option value={0}>₹0 (Free)</option>
              <option value={20}>₹20</option>
              <option value={40}>₹40</option>
              <option value={100}>₹100</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5 justify-end">
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
              className={cn('flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all',
                mutation.isPending ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20')}>
              {mutation.isPending ? (
                <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Running…</>
              ) : (
                <><Play className="w-4 h-4" />Run Backtest</>
              )}
            </button>
          </div>
        </div>
        <div className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300">
            Uses Black-Scholes option pricing with synthetic GBM NIFTY data (seeded at ₹23,500).
            Strategy: ATM CE/PE buy based on EMA9/EMA21 trend + PCR + RSI. Exits: SL 35% · T1 45% · T2 90%.
            Leave dates empty to use last 1 year.
          </p>
        </div>
      </div>

      {/* Error */}
      {mutation.isError && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <div className="font-semibold">Backtest Failed</div>
            <div className="text-sm opacity-80">{(mutation.error as Error)?.message}</div>
          </div>
        </div>
      )}

      {/* Results */}
      {result && m && (
        <div className="flex flex-col gap-6">

          {/* Summary Banner */}
          <div className={cn('rounded-xl p-4 border flex items-center gap-4', isProfit ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30')}>
            <div className={cn('p-3 rounded-xl', isProfit ? 'bg-green-500/20' : 'bg-red-500/20')}>
              {isProfit ? <TrendingUp className="w-6 h-6 text-green-400" /> : <TrendingDown className="w-6 h-6 text-red-400" />}
            </div>
            <div className="flex-1">
              <div className={cn('text-lg font-bold', isProfit ? 'text-green-400' : 'text-red-400')}>
                {isProfit ? '✅ Profitable Strategy' : '❌ Unprofitable Strategy'}
              </div>
              <div className="text-sm text-muted-foreground">
                  {String(result.config.symbol)} ·{' '}
                  {result.config.start_date ? String(result.config.start_date) : 'Last 1 Year'}{' '}
                  {result.config.end_date ? '→ ' + String(result.config.end_date) : ''} ·{' '}
                  {m.total_trades} trades · {String(result.config.trade_type)}
                </div>
            </div>
            <div className="text-right">
              <div className={cn('text-2xl font-bold num', isProfit ? 'text-green-400' : 'text-red-400')}>
                {fmtCur(m.total_pnl)}
              </div>
              <div className="text-sm text-muted-foreground">{fmtPct(m.total_return_pct)} return</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit">
            {(['overview', 'trades', 'monthly'] as Tab[]).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  activeTab === tab ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {tab === 'overview' ? '📊 Overview' : tab === 'trades' ? '📋 Trades (' + filteredTrades.length + ')' : '📅 Monthly'}
              </button>
            ))}
          </div>

          {/* ── Overview Tab ── */}
          {activeTab === 'overview' && (
            <div className="flex flex-col gap-6">

              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                <MetricCard label="Win Rate" value={m.win_rate + '%'} sub={m.winning_trades + 'W / ' + m.losing_trades + 'L'} icon={Target}
                  color={m.win_rate >= 55 ? 'text-green-400' : m.win_rate >= 45 ? 'text-yellow-400' : 'text-red-400'} highlight />
                <MetricCard label="Profit Factor" value={m.profit_factor >= 999 ? '∞' : m.profit_factor.toFixed(2)}
                  sub="Gross profit / loss" icon={BarChart3}
                  color={m.profit_factor >= 1.5 ? 'text-green-400' : m.profit_factor >= 1 ? 'text-yellow-400' : 'text-red-400'} />
                <MetricCard label="Sharpe Ratio" value={m.sharpe_ratio.toFixed(2)} sub="Risk-adjusted return" icon={Activity}
                  color={m.sharpe_ratio >= 1.5 ? 'text-green-400' : m.sharpe_ratio >= 0.5 ? 'text-yellow-400' : 'text-red-400'} />
                <MetricCard label="Max Drawdown" value={fmtCur(m.max_drawdown)} sub={fmtPct(-m.max_drawdown_pct)} icon={ShieldAlert}
                  color={m.max_drawdown_pct <= 10 ? 'text-green-400' : m.max_drawdown_pct <= 20 ? 'text-yellow-400' : 'text-red-400'} />
                <MetricCard label="Total P&L" value={fmtCur(m.total_pnl)} sub={'Capital: ' + fmtCur(m.final_capital)} icon={TrendingUp}
                  color={m.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'} />
                <MetricCard label="Avg Win" value={fmtCur(m.avg_win)} sub={'Best: ' + fmtCur(m.best_trade)} icon={TrendingUp} color="text-green-400" />
                <MetricCard label="Avg Loss" value={fmtCur(m.avg_loss)} sub={'Worst: ' + fmtCur(m.worst_trade)} icon={TrendingDown} color="text-red-400" />
                <MetricCard label="CE Trades" value={m.ce_trades + ''} sub={'Win rate: ' + m.ce_win_rate + '%'} icon={Layers}
                  color={m.ce_win_rate >= 50 ? 'text-blue-400' : 'text-muted-foreground'} />
                <MetricCard label="PE Trades" value={m.pe_trades + ''} sub={'Win rate: ' + m.pe_win_rate + '%'} icon={Layers}
                  color={m.pe_win_rate >= 50 ? 'text-orange-400' : 'text-muted-foreground'} />
                <MetricCard label="Brokerage" value={fmtCur(m.total_brokerage)} sub={'₹' + String(result.config.brokerage_per_lot) + '/lot'} icon={Info} />
                <MetricCard label="Max Consec. Wins" value={m.consecutive_wins + ''} sub={'Losses: ' + m.consecutive_losses} icon={Target} color="text-emerald-400" />
                <MetricCard label="Avg Holding" value={m.avg_holding_periods + ' periods'} sub={String(result.config.trade_type)} icon={Activity} />
              </div>

              {/* Equity Curve */}
              <div className="glass rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold text-sm">Equity Curve</span>
                  <span className="text-xs text-muted-foreground ml-auto">Initial capital: {fmtCur(Number(result.config.initial_capital))}</span>
                </div>
                <EquityCurve points={result.equity_curve} initialCapital={Number(result.config.initial_capital)} />
              </div>

              {/* Exit Reasons + Strategy Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Exit Reasons */}
                <div className="glass rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <ShieldAlert className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Exit Reason Breakdown</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    <ExitBar label="Target 2" count={m.t2_exits} total={totalExits} color="bg-green-500" />
                    <ExitBar label="Target 1" count={m.t1_exits} total={totalExits} color="bg-emerald-500" />
                    <ExitBar label="Stop Loss" count={m.sl_exits} total={totalExits} color="bg-red-500" />
                    <ExitBar label="EOD" count={m.eod_exits} total={totalExits} color="bg-blue-500" />
                    <ExitBar label="Expiry" count={m.expiry_exits} total={totalExits} color="bg-purple-500" />
                  </div>
                </div>

                {/* Strategy Breakdown */}
                <div className="glass rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Layers className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Strategy Breakdown</span>
                  </div>
                  {bd && (
                    <div className="flex flex-col gap-4">
                      {/* By Trend */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">By Trend</div>
                        <div className="grid grid-cols-3 gap-2">
                          {(['BULLISH', 'BEARISH', 'SIDEWAYS'] as const).map(trend => {
                            const s = bd.by_trend[trend] as { trades: number; win_rate: number; pnl: number }
                            return (
                              <div key={trend} className={cn('rounded-lg p-3 text-center',
                                trend === 'BULLISH' ? 'bg-green-500/10 border border-green-500/20' :
                                trend === 'BEARISH' ? 'bg-red-500/10 border border-red-500/20' :
                                'bg-yellow-500/10 border border-yellow-500/20')}>
                                <div className={cn('text-xs font-bold mb-1',
                                  trend === 'BULLISH' ? 'text-green-400' : trend === 'BEARISH' ? 'text-red-400' : 'text-yellow-400')}>
                                  {trend}
                                </div>
                                <div className="text-sm font-semibold">{s.trades} trades</div>
                                <div className="text-xs text-muted-foreground">{s.win_rate}% WR</div>
                                <div className={cn('text-xs font-medium', s.pnl >= 0 ? 'text-green-400' : 'text-red-400')}>{fmtCur(s.pnl)}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      {/* By Option Type */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">By Option Type</div>
                        <div className="grid grid-cols-2 gap-2">
                          {(['CE', 'PE'] as const).map(ot => {
                            const s = bd.by_option_type[ot] as { trades: number; win_rate: number; pnl: number }
                            return (
                              <div key={ot} className={cn('rounded-lg p-3 text-center',
                                ot === 'CE' ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-orange-500/10 border border-orange-500/20')}>
                                <div className={cn('text-xs font-bold mb-1', ot === 'CE' ? 'text-blue-400' : 'text-orange-400')}>{ot}</div>
                                <div className="text-sm font-semibold">{s.trades} trades</div>
                                <div className="text-xs text-muted-foreground">{s.win_rate}% WR</div>
                                <div className={cn('text-xs font-medium', s.pnl >= 0 ? 'text-green-400' : 'text-red-400')}>{fmtCur(s.pnl)}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Trades Tab ── */}
          {activeTab === 'trades' && (
            <div className="glass rounded-xl overflow-hidden">
              {/* Filter bar */}
              <div className="flex items-center gap-3 p-4 border-b border-border">
                <span className="text-sm text-muted-foreground">Filter:</span>
                {(['ALL', 'WIN', 'LOSS'] as const).map(f => (
                  <button key={f} onClick={() => setTradeFilter(f)}
                    className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-all',
                      tradeFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                    {f}
                  </button>
                ))}
                <span className="ml-auto text-xs text-muted-foreground">{filteredTrades.length} trades shown</span>
              </div>
              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 px-3 text-left">#</th>
                      <th className="py-2 px-3 text-left cursor-pointer hover:text-foreground" onClick={() => toggleSort('date')}>
                        Date <SortIcon field="date" />
                      </th>
                      <th className="py-2 px-3 text-left">Type</th>
                      <th className="py-2 px-3 text-left cursor-pointer hover:text-foreground" onClick={() => toggleSort('strike')}>
                        Strike <SortIcon field="strike" />
                      </th>
                      <th className="py-2 px-3 text-left cursor-pointer hover:text-foreground" onClick={() => toggleSort('entry_price')}>
                        Entry <SortIcon field="entry_price" />
                      </th>
                      <th className="py-2 px-3 text-left cursor-pointer hover:text-foreground" onClick={() => toggleSort('exit_price')}>
                        Exit <SortIcon field="exit_price" />
                      </th>
                      <th className="py-2 px-3 text-left">Reason</th>
                      <th className="py-2 px-3 text-left cursor-pointer hover:text-foreground" onClick={() => toggleSort('net_pnl')}>
                        Net P&L <SortIcon field="net_pnl" />
                      </th>
                      <th className="py-2 px-3 text-left cursor-pointer hover:text-foreground" onClick={() => toggleSort('pnl_pct')}>
                        P&L % <SortIcon field="pnl_pct" />
                      </th>
                      <th className="py-2 px-3 text-left cursor-pointer hover:text-foreground" onClick={() => toggleSort('confidence')}>
                        Conf. <SortIcon field="confidence" />
                      </th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map((trade, idx) => (
                      <TradeRow key={trade.trade_id} trade={trade} idx={idx} />
                    ))}
                  </tbody>
                </table>
                {filteredTrades.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground text-sm">No trades match the filter</div>
                )}
              </div>
            </div>
          )}

          {/* ── Monthly Tab ── */}
          {activeTab === 'monthly' && (
            <div className="flex flex-col gap-4">
              <div className="glass rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold text-sm">Monthly P&L</span>
                </div>
                <MonthlyBars data={result.monthly_pnl} />
              </div>
              {/* Monthly table */}
              <div className="glass rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 px-4 text-left">Month</th>
                      <th className="py-2 px-4 text-right">Trades</th>
                      <th className="py-2 px-4 text-right">Win Rate</th>
                      <th className="py-2 px-4 text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.monthly_pnl.map(row => (
                      <tr key={row.month} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                        <td className="py-2 px-4 font-medium">{row.month}</td>
                        <td className="py-2 px-4 text-right text-muted-foreground">{row.trades}</td>
                        <td className="py-2 px-4 text-right">
                          <span className={cn('font-medium', row.win_rate >= 55 ? 'text-green-400' : row.win_rate >= 45 ? 'text-yellow-400' : 'text-red-400')}>
                            {row.win_rate}%
                          </span>
                        </td>
                        <td className={cn('py-2 px-4 text-right font-semibold num', row.pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {fmtCur(row.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/20">
                      <td className="py-2 px-4 font-semibold">Total</td>
                      <td className="py-2 px-4 text-right text-muted-foreground">{m.total_trades}</td>
                      <td className="py-2 px-4 text-right font-semibold">{m.win_rate}%</td>
                      <td className={cn('py-2 px-4 text-right font-bold num', isProfit ? 'text-green-400' : 'text-red-400')}>
                        {fmtCur(m.total_pnl)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

        </div>
      )}

      {/* Empty state */}
      {!result && !mutation.isPending && !mutation.isError && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
          <FlaskConical className="w-12 h-12 opacity-20" />
          <div className="text-center">
            <div className="font-semibold text-foreground mb-1">Ready to Backtest</div>
            <div className="text-sm">Configure the parameters above and click Run Backtest to simulate the strategy</div>
          </div>
        </div>
      )}

    </div>
  )
}