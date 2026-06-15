'use client'

import { cn } from '@/lib/utils'

interface SparkLineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  className?: string
  showArea?: boolean
}

/**
 * Lightweight SVG sparkline chart.
 * Pass an array of numbers and it renders a mini line chart.
 */
export function SparkLine({
  data,
  width = 80,
  height = 28,
  color,
  className,
  showArea = true,
}: SparkLineProps) {
  if (!data || data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const PAD = 1

  // Determine color from trend if not provided
  const lineColor = color || (data[data.length - 1] >= data[0] ? '#22c55e' : '#ef4444')

  const points = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (width - PAD * 2)
    const y = height - PAD - ((v - min) / range) * (height - PAD * 2)
    return { x, y }
  })

  const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')
  const areaD = pathD + ` L${points[points.length - 1].x.toFixed(1)},${height} L${points[0].x.toFixed(1)},${height} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0', className)}
      style={{ width, height }}
      preserveAspectRatio="none"
    >
      {showArea && (
        <path d={areaD} fill={lineColor} opacity="0.1" />
      )}
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* End dot */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r="1.5"
        fill={lineColor}
      />
    </svg>
  )
}

/**
 * Mini bar chart for volume or similar data.
 */
export function MiniBarChart({
  data,
  width = 60,
  height = 20,
  color = '#60a5fa',
  className,
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
  className?: string
}) {
  if (!data || data.length < 2) return null

  const max = Math.max(...data) || 1
  const barWidth = (width - data.length + 1) / data.length

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0', className)}
      style={{ width, height }}
      preserveAspectRatio="none"
    >
      {data.map((v, i) => {
        const barH = (v / max) * (height - 2)
        const x = i * (barWidth + 1)
        return (
          <rect
            key={i}
            x={x}
            y={height - barH}
            width={barWidth}
            height={barH}
            fill={color}
            opacity={i === data.length - 1 ? 1 : 0.5}
            rx="0.5"
          />
        )
      })}
    </svg>
  )
}

/**
 * Donut/Ring chart for percentage display.
 */
export function DonutChart({
  value,
  max = 100,
  size = 40,
  strokeWidth = 4,
  color,
  className,
}: {
  value: number
  max?: number
  size?: number
  strokeWidth?: number
  color?: string
  className?: string
}) {
  const pct = Math.min(value / max, 1)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - pct)
  const fillColor = color || (pct >= 0.7 ? '#22c55e' : pct >= 0.4 ? '#eab308' : '#ef4444')

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={fillColor}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-500"
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        fontSize={size * 0.25}
        fontWeight="bold"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  )
}
