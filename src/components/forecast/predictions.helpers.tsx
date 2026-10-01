import { M, DIM } from './predictions.constants'

// ─── Helpers ───────────────────────────────────────────────────────────────────
export const fmtK = (v: number) => {
  if (v == null || isNaN(v)) return '—'
  const abs = Math.abs(v), sign = v < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}
export const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`

export function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string | number }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      <div style={{ color: M, fontWeight: 500, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color, fontWeight: 500 }}>{p.name}: {fmtK(p.value)}</div>)}
    </div>
  )
}

export function SectionLabel({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border2)', paddingBottom: 6, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: '1.2px', textTransform: 'uppercase', color: M }}>{children}</div>
      {sub && <div style={{ fontSize: 12, color: DIM, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
