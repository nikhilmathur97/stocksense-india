'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  PieChart, Plus, Trash2, TrendingUp, TrendingDown,
  ShieldAlert, Target, BarChart3, Activity
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Holding {
  symbol: string
  shares: number
  avg_price: number
}

interface PortfolioResult {
  total_value: number
  total_cost: number
  total_pnl: number
  total_pnl_pct: number
  holdings: {
    symbol: string
    shares: number
    avg_price: number
    current_price: number
    value: number
    cost: number
    pnl: number
    pnl_pct: number
    sector: string
    weight_pct: number
  }[]
  sector_exposure: { sector: string; value: number; weight_pct: number }[]
  correlation_matrix: { symbols: string[]; matrix: number[][] }
  risk_metrics: {
    portfolio_beta: number
    herfindahl_index: number
    effective_positions: number
    concentration_risk: string
    diversification_score: number
    max_single_stock_weight: number
    top_sector_weight: number
  }
  recommendations: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCur(n: number) {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : n > 0 ? '+' : ''
  if (abs >= 1e7) return sign + '₹' + (abs / 1e7).toFixed(2) + 'Cr'
  if (abs >= 1e5) return sign + '₹' + (abs / 1e5).toFixed(2) + 'L'
  return sign + '₹' + abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([
    { symbol: 'RELIANCE', shares: 50, avg_price: 2400 },
    { symbol: 'TCS', shares: 30, avg_price: 3500 },
    { symbol: 'HDFCBANK', shares: 40, avg_price: 1600 },
    { symbol: 'INFY', shares: 60, avg_price: 1450 },
    { symbol: 'SUNPHARMA', shares: 25, avg_price: 1200 },
  ])

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/api/trades/portfolio-heatmap', data).then(r => r.data),
  })

  const result = mutation.data as PortfolioResult | undefined

  function addHolding() {
    setHoldings([...holdings, { symbol: '', shares: 0, avg_price: 0 }])
  }

  function removeHolding(idx: number) {
    setHoldings(holdings.filter((_, i) => i !== idx))
  }

  function updateHolding(idx: number, field: keyof Holding, value: string | number) {
    const updated = [...holdings]
    updated[idx] = { ...updated[idx], [field]: value }
    setHoldings(updated)
  }

  function analyze() {
    const valid = holdings.filter(h => h.symbol && h.shares > 0 && h.avg_price > 0)
    if (valid.length === 0) return
    mutation.mutate({ holdings: valid })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
          <PieChart className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Portfolio Tracker</h1>
          <p className="text-sm text-muted-foreground">Analyze holdings, sector exposure, correlation & risk metrics</p>
        </div>
      </div>

      {/* Holdings Input */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Your Holdings</span>
          </div>
          <button onClick={addHolding}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-border hover:border-primary hover:text-primary transition-colors text-muted-foreground">
            <Plus className="w-3 h-3" /> Add Stock
          </button>
        </div>

        <div className="space-y-2">
          {holdings.map((h, idx) => (
            <div key={idx} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
              <input type="text" value={h.symbol} onChange={e => updateHolding(idx, 'symbol', e.target.value.toUpperCase())}
                placeholder="SYMBOL" className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-primary" />
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-muted-foreground">Shares</label>
                <input type="number" value={h.shares || ''} onChange={e => updateHolding(idx, 'shares', parseInt(e.target.value) || 0)}
                  className="bg-background border border-border rounded-lg px-2 py-1 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] text-muted-foreground">Avg Price ₹</label>
                <input type="number" value={h.avg_price || ''} onChange={e => updateHolding(idx, 'avg_price', parseFloat(e.target.value) || 0)}
                  className="bg-background border border-border rounded-lg px-2 py-1 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <button onClick={() => removeHolding(idx)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors ml-auto">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={analyze} disabled={mutation.isPending}
            className={cn('flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm transition-all',
              mutation.isPending ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20')}>
            {mutation.isPending ? 'Analyzing...' : '📊 Analyze Portfolio'}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="flex flex-col gap-4">
          {/* Summary Banner */}
          <div className={cn('glass rounded-xl p-4 flex items-center gap-4',
            result.total_pnl >= 0 ? 'border-green-500/30' : 'border-red-500/30')}>
            <div className={cn('p-3 rounded-xl', result.total_pnl >= 0 ? 'bg-green-500/20' : 'bg-red-500/20')}>
              {result.total_pnl >= 0 ? <TrendingUp className="w-6 h-6 text-green-400" /> : <TrendingDown className="w-6 h-6 text-red-400" />}
            </div>
            <div className="flex-1">
              <div className="text-sm text-muted-foreground">Portfolio Value</div>
              <div className="text-2xl font-bold">{fmtCur(result.total_value)}</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Total P&L</div>
              <div className={cn('text-xl font-bold', result.total_pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                {fmtCur(result.total_pnl)} ({result.total_pnl_pct > 0 ? '+' : ''}{result.total_pnl_pct}%)
              </div>
            </div>
          </div>

          {/* Risk Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass rounded-xl p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Portfolio Beta</div>
              <div className={cn('text-xl font-bold',
                result.risk_metrics.portfolio_beta > 1.2 ? 'text-red-400' :
                result.risk_metrics.portfolio_beta < 0.8 ? 'text-blue-400' : 'text-foreground')}>
                {result.risk_metrics.portfolio_beta.toFixed(3)}
              </div>
            </div>
            <div className="glass rounded-xl p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Diversification</div>
              <div className={cn('text-xl font-bold',
                result.risk_metrics.diversification_score >= 70 ? 'text-green-400' :
                result.risk_metrics.diversification_score >= 40 ? 'text-yellow-400' : 'text-red-400')}>
                {result.risk_metrics.diversification_score}/100
              </div>
            </div>
            <div className="glass rounded-xl p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Concentration</div>
              <div className={cn('text-xl font-bold',
                result.risk_metrics.concentration_risk === 'LOW' ? 'text-green-400' :
                result.risk_metrics.concentration_risk === 'MODERATE' ? 'text-yellow-400' : 'text-red-400')}>
                {result.risk_metrics.concentration_risk}
              </div>
            </div>
            <div className="glass rounded-xl p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Effective Positions</div>
              <div className="text-xl font-bold text-foreground">{result.risk_metrics.effective_positions}</div>
            </div>
          </div>

          {/* Holdings Table */}
          <div className="glass rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b border-border">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-sm">Holdings Breakdown</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 px-3 text-left">Symbol</th>
                    <th className="py-2 px-3 text-left">Sector</th>
                    <th className="py-2 px-3 text-right">Shares</th>
                    <th className="py-2 px-3 text-right">Avg Price</th>
                    <th className="py-2 px-3 text-right">Current</th>
                    <th className="py-2 px-3 text-right">Value</th>
                    <th className="py-2 px-3 text-right">P&L</th>
                    <th className="py-2 px-3 text-right">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {result.holdings.map(h => (
                    <tr key={h.symbol} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="py-2 px-3 font-semibold">{h.symbol}</td>
                      <td className="py-2 px-3 text-muted-foreground">{h.sector}</td>
                      <td className="py-2 px-3 text-right num">{h.shares}</td>
                      <td className="py-2 px-3 text-right num">₹{h.avg_price}</td>
                      <td className="py-2 px-3 text-right num">₹{h.current_price}</td>
                      <td className="py-2 px-3 text-right num">{fmtCur(h.value)}</td>
                      <td className={cn('py-2 px-3 text-right num font-semibold',
                        h.pnl > 0 ? 'text-green-400' : h.pnl < 0 ? 'text-red-400' : 'text-muted-foreground')}>
                        {fmtCur(h.pnl)} ({h.pnl_pct > 0 ? '+' : ''}{h.pnl_pct}%)
                      </td>
                      <td className="py-2 px-3 text-right num">{h.weight_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sector Exposure */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <PieChart className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Sector Exposure</span>
              </div>
              <div className="space-y-3">
                {result.sector_exposure.map(s => (
                  <div key={s.sector} className="flex items-center gap-3">
                    <span className="text-xs w-16 shrink-0">{s.sector}</span>
                    <div className="flex-1 bg-muted/30 rounded-full h-3 overflow-hidden">
                      <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: s.weight_pct + '%' }} />
                    </div>
                    <span className="text-xs num w-12 text-right font-medium">{s.weight_pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recommendations */}
            <div className="glass rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <ShieldAlert className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Recommendations</span>
              </div>
              <div className="space-y-2">
                {result.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-muted/30">
                    <span className="text-sm">{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Correlation Matrix */}
          {result.correlation_matrix && (
            <div className="glass rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Correlation Matrix</span>
              </div>
              <div className="overflow-x-auto">
                <table className="text-[10px]">
                  <thead>
                    <tr>
                      <th className="p-1.5"></th>
                      {result.correlation_matrix.symbols.map(s => (
                        <th key={s} className="p-1.5 font-medium text-center">{s.slice(0, 6)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.correlation_matrix.matrix.map((row, i) => (
                      <tr key={i}>
                        <td className="p-1.5 font-medium">{result.correlation_matrix.symbols[i].slice(0, 6)}</td>
                        {row.map((val, j) => {
                          const color = i === j ? 'bg-primary/30' :
                            val > 0.6 ? 'bg-red-500/30' :
                            val > 0.3 ? 'bg-yellow-500/20' : 'bg-green-500/20'
                          return (
                            <td key={j} className={cn('p-1.5 text-center rounded', color)}>
                              {val.toFixed(2)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500/20" /> Low (&lt;0.3)</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500/20" /> Medium (0.3-0.6)</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30" /> High (&gt;0.6)</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !mutation.isPending && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
          <PieChart className="w-12 h-12 opacity-20" />
          <div className="text-center">
            <div className="font-semibold text-foreground mb-1">Enter Your Holdings</div>
            <div className="text-sm">Add stocks above and click Analyze to see portfolio metrics</div>
          </div>
        </div>
      )}
    </div>
  )
}
