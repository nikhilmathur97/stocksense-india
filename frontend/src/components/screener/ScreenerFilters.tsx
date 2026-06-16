'use client'

import { useScreenerStore } from '@/store'
import { cn } from '@/lib/utils'

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

const SELECT_CLS =
  'w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-colors'

export function ScreenerFilters() {
  const { filters, setFilter, resetFilters } = useScreenerStore()

  const prob = filters.minProbability
  const probPct = ((prob - 50) / (95 - 50)) * 100   // 0–100 for gradient fill

  return (
    <div className="glass rounded-xl p-4 space-y-4">

      {/* Row 1 — dropdowns in a responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* Signal Strength */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Signal Strength</label>
          <select
            value={filters.signalType}
            onChange={(e) => setFilter('signalType', e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">All Signals</option>
            <option value="STRONG_BUY">Strong Buy — ≥80% Conviction</option>
            <option value="BUY">Buy — 65–80% Range</option>
          </select>
        </div>

        {/* Strategy */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Strategy</label>
          <select
            value={filters.category}
            onChange={(e) => setFilter('category', e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">All Strategies</option>
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Sort By */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Sort By</label>
          <select
            value={filters.sortBy}
            onChange={(e) => setFilter('sortBy', e.target.value)}
            className={SELECT_CLS}
          >
            <option value="probability_score">Probability Score</option>
            <option value="expected_return_7d">Expected Return (7D)</option>
            <option value="risk_reward_ratio">Risk-Reward Ratio</option>
          </select>
        </div>
      </div>

      {/* Row 2 — Min Probability slider, full-width, prominent on mobile */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Min Probability</label>
          <span className={cn(
            'text-sm font-bold num px-2 py-0.5 rounded',
            prob >= 85 ? 'text-green-400 bg-green-500/10'
            : prob >= 70 ? 'text-primary bg-primary/10'
            : 'text-amber-400 bg-amber-500/10'
          )}>
            {prob}%
          </span>
        </div>

        {/* Slider + labels */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-8 text-right shrink-0">50%</span>
          <div className="relative flex-1 flex items-center h-8">
            {/* Custom filled track */}
            <div className="absolute inset-x-0 h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-150',
                  prob >= 85 ? 'bg-green-500' : prob >= 70 ? 'bg-primary' : 'bg-amber-400'
                )}
                style={{ width: `${probPct}%` }}
              />
            </div>
            <input
              type="range"
              min={50}
              max={95}
              step={5}
              value={prob}
              onChange={(e) => setFilter('minProbability', Number(e.target.value))}
              className="relative w-full h-2 appearance-none bg-transparent cursor-pointer accent-primary [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
            />
          </div>
          <span className="text-xs text-muted-foreground w-8 shrink-0">95%</span>
        </div>

        {/* Tick labels */}
        <div className="flex justify-between px-11 text-[10px] text-muted-foreground/60 select-none">
          {[50, 55, 60, 65, 70, 75, 80, 85, 90, 95].map((v) => (
            <button
              key={v}
              onClick={() => setFilter('minProbability', v)}
              className={cn(
                'transition-colors hover:text-primary',
                v === prob ? 'text-primary font-bold' : ''
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Row 3 — active filters summary + reset */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <div className="flex flex-wrap gap-1.5">
          {filters.signalType && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              {filters.signalType === 'STRONG_BUY' ? 'Strong Buy' : 'Buy'}
            </span>
          )}
          {filters.category && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
              {filters.category}
            </span>
          )}
          {prob !== 60 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
              ≥{prob}% prob
            </span>
          )}
        </div>
        <button
          onClick={resetFilters}
          className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-accent transition-colors text-muted-foreground shrink-0 ml-2"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
