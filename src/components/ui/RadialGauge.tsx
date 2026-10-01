/**
 * RadialGauge — arc/speedometer gauge for risk budget, fragility, etc.
 * Pure SVG, no dependencies.
 *
 * value: 0–100 (or custom max)
 * Zones are painted as colored arc segments.
 */

interface Zone {
  max: number     // 0–100
  color: string
}

interface Props {
  value: number
  max?: number
  label: string
  sublabel?: string
  size?: number
  zones?: Zone[]
  valueColor?: string
}

const DEFAULT_ZONES: Zone[] = [
  { max: 80, color: 'var(--fd-accent)' },
  { max: 120, color: '#ffd600' },
  { max: 150, color: 'var(--fd-ink)' },
  { max: 200, color: 'var(--fd-negative)' },
]

export function RadialGauge({
  value,
  max = 200,
  label,
  sublabel,
  size = 120,
  zones = DEFAULT_ZONES,
  valueColor,
}: Props) {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.38
  const strokeW = size * 0.09

  // Arc goes from 210° to 330° (240° sweep) — bottom-left to bottom-right
  const START_DEG = 210
  const SWEEP_DEG = 240

  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toXY = (deg: number) => ({
    x: cx + r * Math.cos(toRad(deg)),
    y: cy + r * Math.sin(toRad(deg)),
  })

  const arcPath = (startDeg: number, endDeg: number) => {
    const s = toXY(startDeg)
    const e = toXY(endDeg)
    const large = endDeg - startDeg > 180 ? 1 : 0
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
  }

  // Build zone arcs
  type ZoneArc = { path: string; color: string }
  const zoneArcs: ZoneArc[] = []
  let prevPct = 0
  for (const z of zones) {
    const fromPct = prevPct / max
    const toPct = Math.min(z.max, max) / max
    const fromDeg = START_DEG + fromPct * SWEEP_DEG
    const toDeg = START_DEG + toPct * SWEEP_DEG
    zoneArcs.push({ path: arcPath(fromDeg, toDeg), color: z.color })
    prevPct = z.max
    if (z.max >= max) break
  }

  // Needle
  const clampedVal = Math.min(Math.max(value, 0), max)
  const needlePct = clampedVal / max
  const needleDeg = START_DEG + needlePct * SWEEP_DEG
  const needleLen = r * 0.8
  const needleEnd = {
    x: cx + needleLen * Math.cos(toRad(needleDeg)),
    y: cy + needleLen * Math.sin(toRad(needleDeg)),
  }

  // Auto color from zone
  const autoColor = zones.find(z => value <= z.max)?.color ?? zones[zones.length - 1]?.color ?? 'var(--fd-negative)'
  const displayColor = valueColor ?? autoColor

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={size} height={size * 0.75} viewBox={`0 0 ${size} ${size * 0.75}`} style={{ overflow: 'visible' }}>
        {/* Track */}
        <path
          d={arcPath(START_DEG, START_DEG + SWEEP_DEG)}
          fill="none"
          stroke="var(--border2)"
          strokeWidth={strokeW}
          strokeLinecap="round"
        />

        {/* Zone arcs */}
        {zoneArcs.map((z, i) => (
          <path
            key={i}
            d={z.path}
            fill="none"
            stroke={z.color}
            strokeWidth={strokeW}
            strokeLinecap="round"
            opacity={0.22}
          />
        ))}

        {/* Filled arc up to value */}
        {clampedVal > 0 && (
          <path
            d={arcPath(START_DEG, START_DEG + needlePct * SWEEP_DEG)}
            fill="none"
            stroke={displayColor}
            strokeWidth={strokeW}
            strokeLinecap="round"
            opacity={0.9}
          />
        )}

        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={needleEnd.x.toFixed(2)} y2={needleEnd.y.toFixed(2)}
          stroke={displayColor}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={strokeW * 0.35} fill={displayColor} />

        {/* Center value */}
        <text
          x={cx} y={cy + r * 0.18}
          textAnchor="middle"
          fontSize={size * 0.17}
          fontWeight="bold"
          fontFamily="monospace"
          fill={displayColor}
        >
          {value % 1 === 0 ? value : value.toFixed(1)}
        </text>
      </svg>

      {/* Labels */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: 'var(--text2)',
          textTransform: 'uppercase', letterSpacing: '0.6px',
        }}>
          {label}
        </div>
        {sublabel && (
          <div style={{ fontSize: 12, color: displayColor, fontWeight: 500, marginTop: 2 }}>
            {sublabel}
          </div>
        )}
      </div>
    </div>
  )
}
