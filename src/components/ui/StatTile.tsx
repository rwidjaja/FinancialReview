/**
 * StatTile — v4: same anatomy as Tile (no accent stripe, no tint). The v3
 * `badge` colour maps onto a status chip + mono word. Same API as v3.
 */
import type { ReactNode } from 'react'
import { MetricTooltip } from './MetricTooltip'
import { StatusChip, mono, type Status } from './primitives'

interface Props {
  label: string
  value: ReactNode
  sub?: ReactNode
  color?: string
  badge?: 'green' | 'yellow' | 'orange' | 'red' | 'blue' | 'none'
  badgeLabel?: string
  trend?: 'up' | 'down' | 'flat' | null
  accent?: string
  onClick?: () => void
  wide?: boolean
  className?: string
  metricId?: string
}

const BADGE_STATUS: Record<string, Status> = { green: 'ok', yellow: 'watch', orange: 'warn', red: 'alert', blue: 'info' }
const BADGE_WORD: Record<string, string> = { green: 'OK', yellow: 'Watch', orange: 'Watch', red: 'Action', blue: 'Info' }

export function StatTile({ label, value, sub, color, badge, badgeLabel, trend, onClick, wide, className, metricId }: Props) {
  const st = badge && badge !== 'none' ? BADGE_STATUS[badge] : null
  return (
    <div onClick={onClick} className={[className, onClick ? 'fd-row' : ''].filter(Boolean).join(' ')} style={{
      background: 'var(--fd-page)', border: '1px solid var(--fd-hairline)', padding: 20, display: 'flex', flexDirection: 'column', gap: 8,
      cursor: onClick ? 'pointer' : 'default', gridColumn: wide ? 'span 2' : undefined, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ ...mono, color: 'var(--fd-muted)', display: 'inline-flex', alignItems: 'center' }}>
          {label}{metricId && <MetricTooltip metricId={metricId} label={label} />}
        </span>
        {st && <span style={{ ...mono, display: 'inline-flex', alignItems: 'center', gap: 6 }}><StatusChip status={st} size={10} />{badgeLabel ?? BADGE_WORD[badge!]}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.005em', color }}>{value}</span>
        {trend && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: trend === 'up' ? 'var(--fd-accent)' : trend === 'down' ? 'var(--fd-negative)' : 'var(--fd-muted)' }}>{trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}</span>}
      </div>
      {sub && <div style={{ fontSize: 13, color: 'var(--fd-muted)', lineHeight: 1.35 }}>{sub}</div>}
    </div>
  )
}

/** 2×2 hairline grid with a mono title over a 2px rule. */
interface QuadrantProps {
  title: string
  titleColor?: string
  items: { label: string; value: ReactNode; color?: string; badge?: Props['badge'] }[]
}

export function QuadrantPanel({ title, items }: QuadrantProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ ...mono, borderTop: '2px solid var(--fd-rule)', paddingTop: 12 }}>{title}</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--fd-hairline)', border: '1px solid var(--fd-hairline)' }}>
        {items.slice(0, 4).map((item, i) => (
          <div key={i} style={{ background: 'var(--fd-page)', padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ ...mono, color: 'var(--fd-muted)' }}>{item.label}</span>
            <span style={{ fontSize: 26, fontWeight: 500, color: item.color }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
