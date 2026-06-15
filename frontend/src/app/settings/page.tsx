'use client'

import { useState } from 'react'
import { Settings, Sun, Moon, Monitor, Palette, Bell, Activity, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store'

export default function SettingsPage() {
  const { theme, setTheme } = useUIStore()
  const [refreshRate, setRefreshRate] = useState('2')
  const [notifications, setNotifications] = useState(true)

  const themes = [
    { id: 'dark' as const, label: 'Dark', icon: Moon, description: 'Easy on the eyes for long trading sessions' },
    { id: 'light' as const, label: 'Light', icon: Sun, description: 'Clean and bright for daytime use' },
  ]

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-muted border border-border">
          <Settings className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Customize your StockSense experience</p>
        </div>
      </div>

      {/* Theme Section */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Appearance</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {themes.map(t => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                'flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
                theme === t.id
                  ? 'border-primary bg-primary/5 shadow-md shadow-primary/10'
                  : 'border-border hover:border-muted-foreground/30'
              )}
            >
              <div className={cn(
                'p-3 rounded-xl',
                theme === t.id ? 'bg-primary/20' : 'bg-muted'
              )}>
                <t.icon className={cn('w-5 h-5', theme === t.id ? 'text-primary' : 'text-muted-foreground')} />
              </div>
              <div>
                <div className="font-semibold text-sm flex items-center gap-2">
                  {t.label}
                  {theme === t.id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold">ACTIVE</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Data Refresh */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Data & Performance</span>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Live Data Refresh Rate</div>
              <div className="text-xs text-muted-foreground">How often to poll for new quotes</div>
            </div>
            <select
              value={refreshRate}
              onChange={e => setRefreshRate(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="1">1 second (fastest)</option>
              <option value="2">2 seconds (default)</option>
              <option value="5">5 seconds (balanced)</option>
              <option value="10">10 seconds (low bandwidth)</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">WebSocket Connection</div>
              <div className="text-xs text-muted-foreground">Real-time tick data via Angel One</div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 font-medium">Connected</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Notifications</span>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Browser Notifications</div>
              <div className="text-xs text-muted-foreground">Get notified when alerts trigger</div>
            </div>
            <button
              onClick={() => setNotifications(!notifications)}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors',
                notifications ? 'bg-primary' : 'bg-muted'
              )}
            >
              <span className={cn(
                'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform',
                notifications ? 'left-[22px]' : 'left-0.5'
              )} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Sound Alerts</div>
              <div className="text-xs text-muted-foreground">Play sound on high-priority alerts</div>
            </div>
            <button
              className="relative w-11 h-6 rounded-full bg-muted transition-colors"
            >
              <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>
        </div>
      </div>

      {/* API & Data */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">API & Data Sources</span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-sm">Angel One SmartAPI</span>
            </div>
            <span className="text-xs text-green-400 font-medium">Active</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-sm">Redis Cache</span>
            </div>
            <span className="text-xs text-green-400 font-medium">Connected</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-sm">AI Engine (Claude)</span>
            </div>
            <span className="text-xs text-green-400 font-medium">Ready</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-sm">Alert Engine</span>
            </div>
            <span className="text-xs text-green-400 font-medium">Running (5s poll)</span>
          </div>
        </div>
      </div>

      {/* Version Info */}
      <div className="text-center text-xs text-muted-foreground py-4">
        <p>StockSense India v2.0 — Professional Trading Platform</p>
        <p className="mt-1">70+ API endpoints · 22 indicators · 13 pages · Real-time alerts</p>
      </div>
    </div>
  )
}
