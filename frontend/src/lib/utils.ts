import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const IST = 'Asia/Kolkata'

export function formatPrice(value: number, decimals = 2): string {
  if (!value && value !== 0) return '—'
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatCrore(value: number): string {
  if (!value) return '—'
  if (value >= 1e7) return `₹${(value / 1e7).toFixed(2)}Cr`
  if (value >= 1e5) return `₹${(value / 1e5).toFixed(2)}L`
  return `₹${value.toFixed(0)}`
}

export function formatVolume(value: number): string {
  if (!value) return '0'
  if (value >= 1e7) return `${(value / 1e7).toFixed(2)}Cr`
  if (value >= 1e5) return `${(value / 1e5).toFixed(2)}L`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toString()
}

export function formatChange(value: number): string {
  if (!value && value !== 0) return '—'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

export function formatChangePct(value: number): string {
  if (!value && value !== 0) return '—'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function isPositive(value: number): boolean {
  return value > 0
}

export function signalColor(signal: string): string {
  switch (signal) {
    case 'STRONG_BUY': return 'text-green-400'
    case 'BUY': return 'text-green-500'
    case 'NEUTRAL': return 'text-muted-foreground'
    case 'SELL': return 'text-red-400'
    case 'STRONG_SELL': return 'text-red-500'
    default: return 'text-muted-foreground'
  }
}

export function confidenceBadge(confidence: string): string {
  switch (confidence) {
    case 'HIGH': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'MEDIUM': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'LOW': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default: return 'bg-muted text-muted-foreground'
  }
}

export function probabilityColor(score: number): string {
  if (score >= 80) return 'text-green-400'
  if (score >= 65) return 'text-green-500'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

export function formatIST(dateStr: string, fmt = 'dd MMM, HH:mm'): string {
  try {
    const zoned = toZonedTime(new Date(dateStr), IST)
    return format(zoned, fmt)
  } catch {
    return dateStr
  }
}

export function timeAgo(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
  } catch {
    return dateStr
  }
}

export function marketIsOpen(): boolean {
  const now = toZonedTime(new Date(), IST)
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const hours = now.getHours()
  const minutes = now.getMinutes()
  const time = hours * 60 + minutes
  return time >= 9 * 60 + 15 && time <= 15 * 60 + 30
}
