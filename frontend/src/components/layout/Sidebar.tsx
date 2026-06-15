'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart2, TrendingUp, LineChart, Bell, BookOpen, Settings,
  Activity, Menu, Newspaper, Zap, FlaskConical, LayoutGrid,
  Clock, Layers, PieChart
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store'

const navItems = [
  { href: '/',                  label: 'Dashboard',       icon: BarChart2 },
  { href: '/screener',          label: 'AI Screener',     icon: TrendingUp },
  { href: '/news',              label: 'Market News',     icon: Newspaper },
  { href: '/sectors',           label: 'Sector Heatmap',  icon: LayoutGrid },
  { href: '/market-breadth',    label: 'Market Breadth',  icon: Activity },
  { href: '/multi-timeframe',   label: 'Multi-TF',        icon: Clock },
  { href: '/options',           label: 'Options Chain',   icon: LineChart },
  { href: '/option-signals',    label: 'Option Signals',  icon: Zap },
  { href: '/strategy-builder',  label: 'Strategy Builder', icon: Layers },
  { href: '/backtest',          label: 'Backtest',        icon: FlaskConical },
  { href: '/trade-journal',     label: 'Trade Journal',   icon: BookOpen },
  { href: '/alerts',            label: 'Alerts',          icon: Bell },
  { href: '/watchlist',         label: 'Watchlist',       icon: PieChart },
]

export function Sidebar() {
  const pathname = usePathname()
  const { sidebarOpen, setSidebarOpen } = useUIStore()

  return (
    <aside
      className={cn(
        'flex flex-col bg-card border-r border-border transition-all duration-200 z-20',
        sidebarOpen ? 'w-56' : 'w-14'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 py-4 border-b border-border">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1 rounded hover:bg-accent transition-colors"
        >
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>
        {sidebarOpen && (
          <span className="font-bold text-sm gradient-text">
            StockSense
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div className="p-2 border-t border-border">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-2 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Settings className="w-4 h-4 shrink-0" />
          {sidebarOpen && <span>Settings</span>}
        </Link>
      </div>
    </aside>
  )
}
