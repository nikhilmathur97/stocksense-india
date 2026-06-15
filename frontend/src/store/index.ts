import { create } from 'zustand'
import { subscribeWithSelector, persist, createJSONStorage } from 'zustand/middleware'
import type { Quote, StockSignal } from '@/lib/api'

// ── Live Ticks Store ──────────────────────────────────────────────────────────

interface TicksState {
  ticks: Record<string, Quote>
  updateTick: (tick: Quote) => void
  getTick: (symbol: string) => Quote | undefined
}

export const useTicksStore = create<TicksState>()(
  subscribeWithSelector((set, get) => ({
    ticks: {},
    updateTick: (tick) =>
      set((state) => ({
        ticks: { ...state.ticks, [tick.symbol]: tick },
      })),
    getTick: (symbol) => get().ticks[symbol],
  }))
)

// ── Screener Store ────────────────────────────────────────────────────────────

interface ScreenerState {
  signals: StockSignal[]
  filters: {
    minProbability: number
    signalType: string
    category: string
    sortBy: string
  }
  setSignals: (signals: StockSignal[]) => void
  setFilter: (key: string, value: string | number) => void
  resetFilters: () => void
}

const defaultFilters = {
  minProbability: 60,
  signalType: '',
  category: '',
  sortBy: 'probability_score',
}

export const useScreenerStore = create<ScreenerState>()((set) => ({
  signals: [],
  filters: defaultFilters,
  setSignals: (signals) => set({ signals }),
  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),
  resetFilters: () => set({ filters: defaultFilters }),
}))

// ── Watchlist Store ───────────────────────────────────────────────────────────

interface WatchlistState {
  watchedSymbols: string[]
  addSymbol: (symbol: string) => void
  removeSymbol: (symbol: string) => void
  toggleSymbol: (symbol: string) => void
  isWatched: (symbol: string) => boolean
}

// Watchlist is persisted to localStorage so symbols survive page reloads.
// Only `watchedSymbols` (the plain string array) is persisted — functions are
// re-created by Zustand on every mount and must NOT be serialised.
export const useWatchlistStore = create<WatchlistState>()(
  persist(
    subscribeWithSelector((set, get) => ({
      watchedSymbols: [],
      addSymbol: (symbol) =>
        set((state) => ({
          watchedSymbols: state.watchedSymbols.includes(symbol)
            ? state.watchedSymbols
            : [...state.watchedSymbols, symbol],
        })),
      removeSymbol: (symbol) =>
        set((state) => ({
          watchedSymbols: state.watchedSymbols.filter((s) => s !== symbol),
        })),
      toggleSymbol: (symbol) => {
        const { isWatched, addSymbol, removeSymbol } = get()
        if (isWatched(symbol)) removeSymbol(symbol)
        else addSymbol(symbol)
      },
      isWatched: (symbol) => get().watchedSymbols.includes(symbol),
    })),
    {
      name: 'stocksense-watchlist',          // localStorage key
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ watchedSymbols: state.watchedSymbols }),
    }
  )
)

// ── UI Store ──────────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light'

interface UIState {
  sidebarOpen: boolean
  selectedExchange: 'NSE' | 'BSE'
  theme: Theme
  setSidebarOpen: (open: boolean) => void
  setExchange: (exchange: 'NSE' | 'BSE') => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      selectedExchange: 'NSE',
      theme: 'dark',
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setExchange: (exchange) => set({ selectedExchange: exchange }),
      setTheme: (theme) => {
        set({ theme })
        if (typeof document !== 'undefined') {
          document.documentElement.classList.remove('dark', 'light')
          document.documentElement.classList.add(theme)
        }
      },
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        get().setTheme(next)
      },
    }),
    {
      name: 'stocksense-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ theme: state.theme, sidebarOpen: state.sidebarOpen }),
    }
  )
)
