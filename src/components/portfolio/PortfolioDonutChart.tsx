import { useState } from 'react'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, A, M } from './DetailTab.constants'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE } from '../ui/chartTooltip'

export function PortfolioDonutChart({ holdings, totalValue, data, accountLabel }: {
  holdings: { symbol: string; value: number; annualInc: number; pnl: number; cost: number }[]
  totalValue: number
  data: DashboardData
  accountLabel?: string
}) {
  const [activeSegment, setActiveSegment] = useState<string | null>(null)
  const safeTotal = totalValue > 0 ? totalValue : 1

  // Show ALL holdings, not just top 7
  const chartData = holdings.map(h => ({
    name: h.symbol,
    value: h.value,
    pct: (h.value / safeTotal) * 100,
    annualInc: h.annualInc,
    pnl: h.pnl,
  }))

  const colors = [
    'var(--fd-accent)', 'var(--fd-lilac-ink)', 'var(--fd-lime-ink)', 'var(--fd-muted)', 'var(--fd-ink)', 'var(--fd-negative)', 'var(--fd-accent)', 'var(--fd-lilac-ink)',
    'var(--fd-lime-ink)', 'var(--fd-muted)', 'var(--fd-ink)', 'var(--fd-negative)', 'var(--fd-accent)', 'var(--fd-lilac-ink)', 'var(--fd-lime-ink)', 'var(--fd-muted)',
    'var(--fd-ink)', 'var(--fd-negative)', 'var(--fd-accent)', 'var(--fd-lilac-ink)'
  ]

  const topHolding = holdings[0]
  const topPct = topHolding ? (topHolding.value / totalValue) * 100 : 0

  // Generate SVG paths for each segment
  const size = 160
  const center = size / 2
  const radius = 70
  const innerRadius = 45

  let currentAngle = -90 // start from top
  const segments: {
    name: string
    path: string
    color: string
    pct: number
    value: number
    annualInc: number
    pnl: number
  }[] = []

  chartData.forEach((item, idx) => {
    const angle = (item.pct / 100) * 360
    const startRad = (currentAngle * Math.PI) / 180
    const endRad = ((currentAngle + angle) * Math.PI) / 180

    const x1 = center + radius * Math.cos(startRad)
    const y1 = center + radius * Math.sin(startRad)
    const x2 = center + radius * Math.cos(endRad)
    const y2 = center + radius * Math.sin(endRad)

    const largeArc = angle > 180 ? 1 : 0

    const path = `
      M ${center + innerRadius * Math.cos(startRad)} ${center + innerRadius * Math.sin(startRad)}
      L ${x1} ${y1}
      A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}
      L ${center + innerRadius * Math.cos(endRad)} ${center + innerRadius * Math.sin(endRad)}
      A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${center + innerRadius * Math.cos(startRad)} ${center + innerRadius * Math.sin(startRad)}
      Z
    `

    segments.push({
      name: item.name,
      path,
      color: colors[idx % colors.length],
      pct: item.pct,
      value: item.value,
      annualInc: item.annualInc,
      pnl: item.pnl,
    })

    currentAngle += angle
  })

  // Get active segment data
  const activeData = segments.find(s => s.name === activeSegment)

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--fd-hairline)',
      padding: '12px',
      height: '100%', // Take full container height
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12, flexShrink: 0 }}>
        ◈ {accountLabel ? `${accountLabel.toUpperCase()} WEIGHTS` : 'PORTFOLIO WEIGHT'} — PIE
      </div>

      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 16, 
        flexWrap: 'wrap',
        flex: 1,
        minHeight: 0, // Important for flex child overflow
      }}>
        {/* SVG Donut Chart with hover on segments - wrap in a container with explicit dimensions */}
        <div style={{ 
          position: 'relative', 
          width: size, 
          height: size,
          flexShrink: 0, // Prevent chart from shrinking
        }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {segments.map((seg, i) => (
              <path
                key={i}
                d={seg.path}
                fill={seg.color}
                fillOpacity={activeSegment === seg.name ? 0.95 : 0.85}
                stroke="var(--bg)"
                strokeWidth={1.5}
                style={{ cursor: 'pointer', transition: 'fill-opacity 0.15s' }}
                onMouseEnter={() => setActiveSegment(seg.name)}
                onMouseLeave={() => setActiveSegment(null)}
              />
            ))}
          </svg>

          {/* Center text */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            background: 'var(--surface)',
            borderRadius: 3,
            width: 56,
            height: 56,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            border: `1px solid var(--border2)`,
            pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 12, color: M }}>TOP</div>
            <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: A }}>
              {topHolding?.symbol?.slice(0, 4) ?? '—'}
            </div>
            <div style={{ fontSize: 12, color: G }}>{topPct.toFixed(1)}%</div>
          </div>

          {/* Hover tooltip - position above with proper z-index and overflow handling */}
          {activeSegment && activeData && (
            <div style={{
              ...TOOLTIP_STYLE,
              position: 'absolute',
              top: -8,
              left: '50%',
              transform: 'translateX(-50%) translateY(-100%)',
              zIndex: 1000,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              borderLeft: `3px solid ${activeData.color}`,
            }}>
              <div style={TOOLTIP_LABEL_STYLE}>{activeData.name}</div>
              <div style={{ color: G }}>{activeData.pct.toFixed(1)}% of {accountLabel ? 'account' : 'portfolio'}</div>
              <div style={{ color: M }}>Value: {fmtMoneyFull(activeData.value)}</div>
              {activeData.annualInc > 0 && (
                <div style={{ color: G }}>Annual Inc: {fmtMoney(activeData.annualInc)}</div>
              )}
              <div style={{ color: activeData.pnl >= 0 ? G : R }}>
                P&L: {activeData.pnl >= 0 ? '+' : ''}{fmtMoneyFull(activeData.pnl)}
              </div>
            </div>
          )}
        </div>

        {/* Legend with hover - show ALL holdings */}
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 4, 
          maxHeight: 160, 
          overflowY: 'auto',
          minWidth: 120, // Ensure legend has minimum width
        }}>
          {chartData.map((item, i) => (
            <div
              key={item.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                fontSize: 12,
                padding: '2px 4px',
                cursor: 'pointer',
                background: activeSegment === item.name ? 'var(--fd-card)' : 'transparent',
                borderRadius: 0,
              }}
              onMouseEnter={() => setActiveSegment(item.name)}
              onMouseLeave={() => setActiveSegment(null)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                <span style={{ width: 8, height: 8, background: colors[i % colors.length], borderRadius: 0, flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </span>
              </div>
              <span style={{ color: G, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{item.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: Holdings summary */}
      <div style={{ marginTop: 12, fontSize: 12, color: A, borderTop: '1px solid var(--border2)', paddingTop: 8, textAlign: 'center', flexShrink: 0 }}>
        HOLDINGS: {holdings.length} in {data.accounts.length} {data.accounts.length === 1 ? 'account' : 'accounts'}
      </div>
    </div>
  )
}