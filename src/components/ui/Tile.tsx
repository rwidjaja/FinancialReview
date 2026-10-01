/**
 * Tile — v4 GridTile look: page ground, hairline frame, mono label, 26/500
 * value, muted sub-line, status chip top-right. Same API as v3.
 */
import type { ReactNode } from 'react'
import { MetricTooltip } from './MetricTooltip'
import { StatusChip, mono } from './primitives'

export type TileStatus = 'ok' | 'watch' | 'warn' | 'alert' | 'info'

interface Props {
  label: string
  value: ReactNode
  sub?: ReactNode
  status?: TileStatus
  valueColor?: string
  onClick?: () => void
  /** Opt-in tooltip: id must match a key in server/explainers.py METRICS. */
  metricId?: string
}

export function Tile({ label, value, sub, status = 'ok', valueColor, onClick, metricId }: Props) {
  return (
    <div onClick={onClick} className={onClick ? 'fd-row' : undefined} style={{
      background: 'var(--fd-page)', border: '1px solid var(--fd-hairline)', padding: 20,
      display: 'flex', flexDirection: 'column', gap: 8, cursor: onClick ? 'pointer' : 'default', minHeight: 120, minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ ...mono, color: 'var(--fd-muted)', display: 'inline-flex', alignItems: 'center' }}>
          {label}{metricId && <MetricTooltip metricId={metricId} label={label} />}
        </span>
        <StatusChip status={status} size={10} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.005em', color: valueColor }}>{value}</div>
      {sub && <span style={{ fontSize: 13, color: 'var(--fd-muted)', lineHeight: 1.35 }}>{sub}</span>}
    </div>
  )
}
