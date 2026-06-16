'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function StockError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Stock page error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <AlertTriangle className="w-12 h-12 text-amber-400" />
      <div>
        <h2 className="text-lg font-semibold mb-1">Something went wrong</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Failed to load this stock page. The chart or data may be temporarily unavailable.
        </p>
      </div>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
