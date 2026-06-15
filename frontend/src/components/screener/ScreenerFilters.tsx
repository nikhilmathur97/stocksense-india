'use client'

import { useScreenerStore } from '@/store'

export function ScreenerFilters() {
  const { filters, setFilter, resetFilters } = useScreenerStore()

  return (
    <div className="glass rounded-xl p-4 flex flex-wrap items-end gap-4">
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

      <div>
        <label className="text-xs text-muted-foreground block mb-1">Signal Type</label>
        <select
          value={filters.signalType}
          onChange={(e) => setFilter('signalType', e.target.value)}
          className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary/50"
        >
          <option value="">All Signals</option>
          <option value="STRONG_BUY">Strong Buy</option>
          <option value="BUY">Buy</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">Confidence</label>
        <select
          value={filters.confidence}
          onChange={(e) => setFilter('confidence', e.target.value)}
          className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary/50"
        >
          <option value="">All</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
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
