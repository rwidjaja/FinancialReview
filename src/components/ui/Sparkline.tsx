interface SparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
  fill?: boolean
}

export function Sparkline({ data, color = 'var(--fd-accent)', width = 80, height = 24, fill = true }: SparklineProps) {
  if (data.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = 1

  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2)
    const y = pad + (1 - (v - min) / range) * (height - pad * 2)
    return [x, y] as [number, number]
  })

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const fillPath = fill
    ? `${linePath} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`
    : ''

  const trend = data[data.length - 1] >= data[0]
  const dotColor = trend ? color: 'var(--fd-negative)'

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {fill && (
        <path d={fillPath} fill={color} fillOpacity={0.08} />
      )}
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
      <circle
        cx={pts[pts.length - 1][0]}
        cy={pts[pts.length - 1][1]}
        r={2}
        fill={dotColor}
      />
    </svg>
  )
}

interface MiniBarProps {
  value: number   // 0–100
  color?: string
  width?: number
  height?: number
}

export function MiniBar({ value, color = 'var(--as-lilac)', width = 60, height = 8 }: MiniBarProps) {
  const filled = Math.min(100, Math.max(0, isFinite(value) ? value : 0))
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <rect x={0} y={0} width={width} height={height} fill="var(--fd-page)" />
      <rect x={0} y={0} width={(filled / 100) * width} height={height} fill={color} />
      <rect x={0} y={0} width={width} height={height} fill="none" stroke="var(--fd-ink)" strokeWidth={1} />
    </svg>
  )
}

interface GaugeRingProps {
  value: number   // 0–100
  color?: string
  size?: number
  label?: string
}

export function GaugeRing({ value, color = 'var(--as-lilac)', size = 44, label }: GaugeRingProps) {
  const r = (size / 2) - 4
  const circ = 2 * Math.PI * r
  const filled = (value / 100) * circ
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="var(--fd-ink)" strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="butt"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {label && (
        <text x={size / 2} y={size / 2 + 3}
          textAnchor="middle" fontSize={9} fontFamily="monospace" fill={color} fontWeight={700}>
          {label}
        </text>
      )}
    </svg>
  )
}
