'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Plus, X, TrendingUp, TrendingDown, Target,
  Calendar, DollarSign, BarChart3, Award, AlertTriangle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function fmtCur(n: number) {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : '+'
  if (abs >= 1e7) return sign + '₹' + (abs / 1e7).toFixed(2) + 'Cr'
  if (abs >= 1e5) return sign + '₹' + (abs / 1e5).toFixed(2) + 'L'
  return (n >= 0 ? '+' : '-') + '₹' + fmt(abs)
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Trade {
  id: string
  symbol: string
  exchange: string
  direction: string
  entry_price: number
  exit_price?: number
  quantity: number
  entry_date: string
  exit_date?: string
  strategy?: string
  notes?: string
  pnl?: number
  pnl_pct?: number
  status: string
}

interface TradeStats {
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  total_pnl: number
  avg_pnl: number
  profit_factor: number
  avg_winner: number
  avg_loser: number
  best_trade: number
  worst_trade: number
  current_streak: number
  streak_type: string
  max_winning_streak: number
  max_losing_streak: number
  avg_holding_days: number
  top_symbols: { symbol: string; pnl: number; trades: number }[]
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TradeJournalPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null)
  const [form, setForm] = useState({
    symbol: '', exchange: 'NSE', direction: 'LONG',
    entry_price: '', exit_price: '', quantity: '',
    entry_date: new Date().toISOString().split('T')[0],
    exit_date: '', strategy: '', notes: '',
  })

  // Fetch trades
  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['trade-journal'],
    queryFn: () => api.get('/api/trades/journal').then(r => r.data.trades || r.data),
  })

  // Fetch stats
  const { data: stats } = useQuery<TradeStats>({
    queryKey: ['trade-stats'],
    queryFn: () => api.get('/api/trades/stats').then(r => r.data),
  })

  // Add trade
  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/api/trades/journal', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-journal'] })
      queryClient.invalidateQueries({ queryKey: ['trade-stats'] })
      setShowForm(false)
      resetForm()
    },
  })

  // Update trade (close)
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/api/trades/journal/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-journal'] })
      queryClient.invalidateQueries({ queryKey: ['trade-stats'] })
      setEditingTrade(null)
    },
  })

  function resetForm() {
    setForm({
      symbol: '', exchange: 'NSE', direction: 'LONG',
      entry_price: '', exit_price: '', quantity: '',
      entry_date: new Date().toISOString().split('T')[0],
      exit_date: '', strategy: '', notes: '',
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    addMutation.mutate({
      symbol: form.symbol.toUpperCase(),
      exchange: form.exchange,
      direction: form.direction,
      entry_price: parseFloat(form.entry_price),
      exit_price: form.exit_price ? parseFloat(form.exit_price) : undefined,
      quantity: parseInt(form.quantity),
      entry_date: form.entry_date,
      exit_date: form.exit_date || undefined,
      strategy: form.strategy || undefined,
      notes: form.notes || undefined,
    })
  }

  function handleClose(trade: Trade) {
    const exitPrice = prompt(`Enter exit price for ${trade.symbol}:`)
    if (exitPrice) {
      updateMutation.mutate({
        id: trade.id,
        data: {
          exit_price: parseFloat(exitPrice),
          exit_date: new Date().toISOString().split('T')[0],
          status: 'CLOSED',
        },
      })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <BookOpen className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Trade Journal</h1>
            <p className="text-sm text-muted-foreground">Track, analyze, and improve your trading</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'Add Trade'}
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="glass rounded-xl p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" />Win Rate</div>
            <div className={cn('text-lg font-bold', stats.win_rate >= 50 ? 'text-green-400' : 'text-red-400')}>
              {stats.win_rate?.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">{stats.winning_trades}W / {stats.losing_trades}L</div>
          </div>
          <div className="glass rounded-xl p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" />Total P&L</div>
            <div className={cn('text-lg font-bold', (stats.total_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
              {fmtCur(stats.total_pnl || 0)}
            </div>
            <div className="text-xs text-muted-foreground">{stats.total_trades} trades</div>
          </div>
          <div className="glass rounded-xl p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><BarChart3 className="w-3 h-3" />Profit Factor</div>
            <div className="text-lg font-bold text-foreground">{(stats.profit_factor || 0).toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">Gross W/L ratio</div>
          </div>
          <div className="glass rounded-xl p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" />Avg Winner</div>
            <div className="text-lg font-bold text-green-400">{fmtCur(stats.avg_winner || 0)}</div>
            <div className="text-xs text-muted-foreground">Best: {fmtCur(stats.best_trade || 0)}</div>
          </div>
          <div className="glass rounded-xl p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3 h-3" />Avg Loser</div>
            <div className="text-lg font-bold text-red-400">{fmtCur(stats.avg_loser || 0)}</div>
            <div className="text-xs text-muted-foreground">Worst: {fmtCur(stats.worst_trade || 0)}</div>
          </div>
          <div className="glass rounded-xl p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Award className="w-3 h-3" />Streak</div>
            <div className={cn('text-lg font-bold', stats.streak_type === 'winning' ? 'text-green-400' : 'text-red-400')}>
              {stats.current_streak} {stats.streak_type}
            </div>
            <div className="text-xs text-muted-foreground">Max W: {stats.max_winning_streak} / L: {stats.max_losing_streak}</div>
          </div>
        </div>
      )}

      {/* Add Trade Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Plus className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold text-sm">New Trade Entry</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Symbol *</label>
              <input type="text" required value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
                placeholder="RELIANCE" className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Direction</label>
              <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Entry Price *</label>
              <input type="number" step="0.01" required value={form.entry_price} onChange={e => setForm(f => ({ ...f, entry_price: e.target.value }))}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Exit Price</label>
              <input type="number" step="0.01" value={form.exit_price} onChange={e => setForm(f => ({ ...f, exit_price: e.target.value }))}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Quantity *</label>
              <input type="number" required value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Entry Date</label>
              <input type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Strategy</label>
              <input type="text" value={form.strategy} onChange={e => setForm(f => ({ ...f, strategy: e.target.value }))}
                placeholder="Breakout, Swing..." className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Notes</label>
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Reason for entry..." className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button type="submit" disabled={addMutation.isPending}
              className="flex items-center gap-2 px-6 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all">
              {addMutation.isPending ? 'Saving...' : 'Save Trade'}
            </button>
          </div>
        </form>
      )}

      {/* Trade List */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Trade History</span>
          <span className="ml-auto text-xs text-muted-foreground">{(trades as Trade[]).length} trades</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (trades as Trade[]).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <BookOpen className="w-10 h-10 opacity-20" />
            <div className="text-sm">No trades yet. Click &quot;Add Trade&quot; to start journaling.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 px-3 text-left">Date</th>
                  <th className="py-2 px-3 text-left">Symbol</th>
                  <th className="py-2 px-3 text-left">Dir</th>
                  <th className="py-2 px-3 text-right">Entry</th>
                  <th className="py-2 px-3 text-right">Exit</th>
                  <th className="py-2 px-3 text-right">Qty</th>
                  <th className="py-2 px-3 text-right">P&L</th>
                  <th className="py-2 px-3 text-left">Status</th>
                  <th className="py-2 px-3 text-left">Strategy</th>
                  <th className="py-2 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {(trades as Trade[]).map((trade) => {
                  const pnl = trade.pnl || 0
                  const isOpen = trade.status === 'OPEN'
                  return (
                    <tr key={trade.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="py-2 px-3 num">{trade.entry_date}</td>
                      <td className="py-2 px-3 font-medium">{trade.symbol}</td>
                      <td className="py-2 px-3">
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold',
                          trade.direction === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400')}>
                          {trade.direction}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right num">₹{trade.entry_price?.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right num">{trade.exit_price ? '₹' + trade.exit_price.toFixed(2) : '—'}</td>
                      <td className="py-2 px-3 text-right num">{trade.quantity}</td>
                      <td className={cn('py-2 px-3 text-right num font-semibold',
                        pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-muted-foreground')}>
                        {pnl !== 0 ? fmtCur(pnl) : '—'}
                      </td>
                      <td className="py-2 px-3">
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold',
                          isOpen ? 'bg-blue-500/20 text-blue-400' : 'bg-muted text-muted-foreground')}>
                          {trade.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{trade.strategy || '—'}</td>
                      <td className="py-2 px-3 text-center">
                        {isOpen && (
                          <button onClick={() => handleClose(trade)}
                            className="px-2 py-1 rounded text-[10px] font-semibold bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors">
                            Close
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top Symbols */}
      {stats?.top_symbols && stats.top_symbols.length > 0 && (
        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Top Performing Symbols</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {stats.top_symbols.map(s => (
              <div key={s.symbol} className="rounded-lg border border-border p-3 text-center">
                <div className="font-semibold text-sm">{s.symbol}</div>
                <div className={cn('text-sm font-bold', s.pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {fmtCur(s.pnl)}
                </div>
                <div className="text-xs text-muted-foreground">{s.trades} trades</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
