'use client'

import { useScreenerStore } from '@/store'

const STRATEGIES = [
  'Ichimoku Breakout',
  'Momentum Breakout',
  'Trend Following',
  'Technical Setup',
  'Volume Surge',
  'Reversal Pattern',
  'Mean Reversion',
  'Oversold Bounce',
]

export function ScreenerFilters() {
  const { filters, setFilter, resetFilters } = useScreenerStore()

  return (
    <div className="glass rounded-xl p-4 flex flex-wrap items-end gap-4">

      {/* Signal Strength */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Signal Strength</label>
        <select
          value={filters.signalType}
          onChange={(e) => setFilter('signalType', e.target.value)}
          className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary/50 min-w-[180px]"
        >
          <option value="">All Signals</option>
          <option value="STRONG_BUY">Strong Buy — High Conviction (≥80%)</option>
          <option value="BUY">Buy — Active Signals (65–80%)</option>
        </select>
      </div>

      {/* Strategy */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Strategy</label>
        <select
          value={filters.category}
          onChange={(e) => setFilter('category', e.target.value)}
          className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary/50 min-w-[180px]"
        >
          <option value="">All Strategies</option>
          {STRATEGIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Sort By */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Sort By</label>
        <select
          value={filters.sortBy}
          onChange={(e) => setFilter('sortBy', e.target.value)}
          className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary/50"
        >
          <option value="probability_score">Probability Score</option>
          <option value="expected_return_7d">Expected Return (7D)</option>
          <option value="risk_reward_ratio">Risk-Reward Ratio</option>
        </select>
      </div>

      {/* Min Probability */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Min Probability</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={filters.minProbability}
            onChange={(e) => setFilter('minProbability', Number(e.target.value))}
            className="w-28 accent-primary"
          />
          <span className="num text-sm font-medium w-10">{filters.minProbability}%</span>
        </div>
      </div>

      <button
        onClick={resetFilters}
        className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent transition-colors text-muted-foreground"
      >
        Reset
      </button>
    </div>
  )
}
