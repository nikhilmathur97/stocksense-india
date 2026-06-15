'use client'

import ReconnectingWebSocket from 'reconnecting-websocket'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

type TickHandler = (data: Record<string, unknown>) => void

class StockWebSocket {
  private ws: ReconnectingWebSocket | null = null
  private handlers: Map<string, Set<TickHandler>> = new Map()
  private subscribedSymbols: Set<string> = new Set()

  connect() {
    if (this.ws) return

    this.ws = new ReconnectingWebSocket(`${WS_URL}/ws/ticks`, [], {
      maxRetries: 20,
      reconnectionDelayGrowFactor: 1.5,
      minReconnectionDelay: 2000,
      maxReconnectionDelay: 30000,
    })

    this.ws.addEventListener('open', () => {
      // Resubscribe to all symbols on reconnect
      if (this.subscribedSymbols.size > 0) {
        this.ws?.send(
          JSON.stringify({ action: 'subscribe', symbols: Array.from(this.subscribedSymbols) })
        )
      }
    })

    this.ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data as string)
        const symbol = data.symbol as string
        if (symbol) {
          const handlers = this.handlers.get(symbol) || new Set()
          handlers.forEach((h) => h(data))
          // Also call wildcard handlers
          const wildcards = this.handlers.get('*') || new Set()
          wildcards.forEach((h) => h(data))
        }
      } catch {
        // ignore parse errors
      }
    })
  }

  subscribe(symbols: string[], handler: TickHandler) {
    symbols.forEach((sym) => {
      this.subscribedSymbols.add(sym)
      if (!this.handlers.has(sym)) {
        this.handlers.set(sym, new Set())
      }
      this.handlers.get(sym)!.add(handler)
    })

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'subscribe', symbols }))
    }
  }

  unsubscribe(symbols: string[], handler: TickHandler) {
    symbols.forEach((sym) => {
      this.handlers.get(sym)?.delete(handler)
      if (this.handlers.get(sym)?.size === 0) {
        this.subscribedSymbols.delete(sym)
        this.handlers.delete(sym)
      }
    })
  }

  onAll(handler: TickHandler) {
    if (!this.handlers.has('*')) this.handlers.set('*', new Set())
    this.handlers.get('*')!.add(handler)
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
    this.handlers.clear()
    this.subscribedSymbols.clear()
  }
}

export const stockWS = new StockWebSocket()
