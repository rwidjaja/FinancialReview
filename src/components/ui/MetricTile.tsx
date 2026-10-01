interface MetricTileProps {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  color?: string
  accent?: boolean
}

export function MetricTile({ label, value, sub, color = 'var(--text)', accent = false }: MetricTileProps) {
  return (
    <div style={{ background: 'var(--fd-page)', border: '1px solid var(--fd-hairline)', padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="bb-label">{label}</div>
      <div className="bb-value" style={{ color: accent ? color : color }}>{value}</div>
      {sub && <div className="bb-sub">{sub}</div>}
    </div>
  )
}

interface StatRowProps {
  label: string
  value: React.ReactNode
  valueColor?: string
  sub?: string
}

export function StatRow({ label, value, valueColor = 'var(--text)', sub }: StatRowProps) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--fd-hairline)', gap: 12,
    }}>
      <span style={{ color: 'var(--fd-muted)', fontSize: 14 }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontWeight: 500, color: valueColor, fontSize: 14 }}>{value}</span>
        {sub && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="bb-label" style={{
      marginBottom: 8, marginTop: 16, paddingBottom: 4,
      borderBottom: '1px solid var(--border)',
      color: 'var(--text3)',
    }}>
      {children}
    </div>
  )
}
