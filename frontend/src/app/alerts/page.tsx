'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bell, Plus, X, Trash2, Check, AlertTriangle,
  TrendingUp, TrendingDown, Volume2, Activity, Zap
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Alert {
  id: string
  symbol: string
  alert_type: string
  condition: string
  value: number
  message?: string
  is_active: boolean
  created_at: string
}

interface TriggeredAlert {
  id: string
  symbol: string
  alert_type: string
  message: string
  severity: string
  triggered_at: string
  is_read: boolean
  price?: number
}

const ALERT_TYPES = [
  { value: 'PRICE_ABOVE', label: 'Price Above', icon: TrendingUp, color: 'text-green-400' },
  { value: 'PRICE_BELOW', label: 'Price Below', icon: TrendingDown, color: 'text-red-400' },
  { value: 'RSI_OVERBOUGHT', label: 'RSI Overbought (>70)', icon: Activity, color: 'text-orange-400' },
  { value: 'RSI_OVERSOLD', label: 'RSI Oversold (<30)', icon: Activity, color: 'text-blue-400' },
  { value: 'VOLUME_SPIKE', label: 'Volume Spike (>2x avg)', icon: Volume2, color: 'text-purple-400' },
  { value: 'MACD_CROSSOVER', label: 'MACD Crossover', icon: Zap, color: 'text-cyan-400' },
  { value: 'SUPERTREND_FLIP', label: 'Supertrend Flip', icon: AlertTriangle, color: 'text-yellow-400' },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [form, setForm] = useState({
    symbol: '', alert_type: 'PRICE_ABOVE', value: '',
  })

  // Fetch user alerts
  const { data: userAlerts = [] } = useQuery<Alert[]>({
    queryKey: ['user-alerts'],
    queryFn: () => api.get('/api/alerts/user').then(r => r.data.alerts || r.data || []),
  })

  // Fetch triggered alerts history
  const { data: alertHistory = [] } = useQuery<TriggeredAlert[]>({
    queryKey: ['alert-history'],
    queryFn: () => api.get('/api/alerts/history').then(r => r.data.alerts || r.data || []),
    refetchInterval: 10000,
  })

  // Create alert
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/api/alerts/user', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-alerts'] })
      setShowForm(false)
      setForm({ symbol: '', alert_type: 'PRICE_ABOVE', value: '' })
    },
  })

  // Delete alert
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/alerts/user/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-alerts'] }),
  })

  // Mark as read
  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/api/alerts/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alert-history'] }),
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      symbol: form.symbol.toUpperCase(),
      alert_type: form.alert_type,
      value: parseFloat(form.value),
    })
  }

  const unreadCount = (alertHistory as TriggeredAlert[]).filter(a => !a.is_read).length

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 relative">
            <Bell className="w-5 h-5 text-amber-400" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold">Alert Center</h1>
            <p className="text-sm text-muted-foreground">Real-time price, RSI, volume, and pattern alerts</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'New Alert'}
        </button>
      </div>

      {/* Create Alert Form */}
      {showForm && (
        <form onSubmit={handleCreate} className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Plus className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Create Alert</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Symbol *</label>
              <input type="text" required value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
                placeholder="RELIANCE, NIFTY 50..." className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Alert Type</label>
              <select value={form.alert_type} onChange={e => setForm(f => ({ ...f, alert_type: e.target.value }))}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                {ALERT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">
                {form.alert_type.includes('PRICE') ? 'Price Level (₹)' : 'Threshold Value'}
              </label>
              <div className="flex gap-2">
                <input type="number" step="0.01" required value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                <button type="submit" disabled={createMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all">
                  {createMutation.isPending ? '...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit">
        <button onClick={() => setTab('active')}
          className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all',
            tab === 'active' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          🔔 Active Alerts ({(userAlerts as Alert[]).length})
        </button>
        <button onClick={() => setTab('history')}
          className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all relative',
            tab === 'history' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          📜 Triggered History ({(alertHistory as TriggeredAlert[]).length})
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Active Alerts Tab */}
      {tab === 'active' && (
        <div className="glass rounded-xl overflow-hidden">
          {(userAlerts as Alert[]).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Bell className="w-10 h-10 opacity-20" />
              <div className="text-sm">No active alerts. Create one to get notified.</div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {(userAlerts as Alert[]).map(alert => {
                const typeInfo = ALERT_TYPES.find(t => t.value === alert.alert_type)
                const Icon = typeInfo?.icon || Bell
                return (
                  <div key={alert.id} className="flex items-center gap-4 p-4 hover:bg-accent/30 transition-colors">
                    <div className={cn('p-2 rounded-lg bg-muted/50', typeInfo?.color)}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{alert.symbol}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {typeInfo?.label || alert.alert_type}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {alert.condition || `Trigger at ${alert.value}`} · Created {alert.created_at?.split('T')[0]}
                      </div>
                    </div>
                    <button onClick={() => deleteMutation.mutate(alert.id)}
                      className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div className="glass rounded-xl overflow-hidden">
          {(alertHistory as TriggeredAlert[]).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Activity className="w-10 h-10 opacity-20" />
              <div className="text-sm">No triggered alerts yet. They will appear here when conditions are met.</div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {(alertHistory as TriggeredAlert[]).map(alert => {
                const severityColor = alert.severity === 'HIGH' ? 'border-l-red-500' :
                  alert.severity === 'MEDIUM' ? 'border-l-yellow-500' : 'border-l-blue-500'
                return (
                  <div key={alert.id} className={cn(
                    'flex items-center gap-4 p-4 border-l-4 transition-colors',
                    severityColor,
                    !alert.is_read ? 'bg-primary/5' : 'hover:bg-accent/30'
                  )}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{alert.symbol}</span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold',
                          alert.severity === 'HIGH' ? 'bg-red-500/20 text-red-400' :
                          alert.severity === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-blue-500/20 text-blue-400')}>
                          {alert.severity}
                        </span>
                        {!alert.is_read && (
                          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <div className="text-sm text-foreground/80 mt-0.5">{alert.message}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {alert.triggered_at} {alert.price ? `· ₹${alert.price}` : ''}
                      </div>
                    </div>
                    {!alert.is_read && (
                      <button onClick={() => markReadMutation.mutate(alert.id)}
                        className="p-2 rounded-lg hover:bg-green-500/20 text-muted-foreground hover:text-green-400 transition-colors"
                        title="Mark as read">
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
