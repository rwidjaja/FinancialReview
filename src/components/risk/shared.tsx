/**
 * Shared primitives for the Intelligence tab:
 * color constants, formatters, and reusable UI components
 * (Panel, Stat, ScoreMeter, ModeBtn).
 */
import { SegBtn } from '../ui/primitives'
import { MetricTooltip } from '../ui/MetricTooltip'

// ─── Color system ──────────────────────────────────────────────────────────────
export const G    = 'var(--green)'
export const R    = 'var(--red)'
export const A    = 'var(--amber)'
export const M    = 'var(--text2)'
export const DIM  = 'var(--text3)'
export const TAX_C  = 'var(--as-lilac)'
export const TECH_C = 'var(--fd-accent)'

// ─── Formatters ───────────────────────────────────────────────────────────────
export const fmtK = (v: number) => {
  if (v == null || isNaN(v)) return '—'
  const abs = Math.abs(v), sign = v < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}
export const fmtPct = (v: number, decimals = 1) => `${v.toFixed(decimals)}%`

// ─── Panel wrapper (v4: 2px ink rule, h3 title, no card chrome) ──────────────
// `color` is accepted for compatibility but no longer tints anything — status
// belongs in chips, not borders.
export function Panel({ title, sub, metricId, children }: {
  title: string; sub?: string; color?: string; metricId?: string; children: React.ReactNode
}) {
  // Strip legacy decorative prefixes and shouting caps
  const raw = title.replace(/^[◈▸▶●■]\s*/, '').trim()
  const displayTitle = raw === raw.toUpperCase() ? raw.charAt(0) + raw.slice(1).toLowerCase() : raw
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '2px solid var(--fd-rule)', paddingTop: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {displayTitle}
          {metricId && <MetricTooltip metricId={metricId} label={displayTitle} size={12} />}
        </h3>
        {sub && <span style={{ fontSize: 13, color: 'var(--fd-muted)' }}>{sub}</span>}
      </div>
      <div style={{ flex: 1, fontSize: 14 }}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, color = 'var(--fd-ink)', large = false, sub, metricId }: {
  label: string; value: string; color?: string; large?: boolean; sub?: string; metricId?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', display: 'inline-flex', alignItems: 'center' }}>
        {label}
        {metricId && <MetricTooltip metricId={metricId} label={label} />}
      </div>
      <div style={{ fontSize: large ? 26 : 16, fontWeight: 500, color, lineHeight: 1.05 }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--fd-muted)' }}>{sub}</div>}
    </div>
  )
}

export function ScoreMeter({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <span style={{ fontSize: 12, color: M, minWidth: 120, textTransform: 'uppercase' }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, Math.max(0, score))}%`, height: '100%', background: color, borderRadius: 0 }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color, minWidth: 28, textAlign: 'right' }}>{score.toFixed(0)}</span>
    </div>
  )
}

// ─── Mode toggle ───────────────────────────────────────────────────────────────
export type Mode = 'simple' | 'advanced'

// v4: segmented-control segment (see ui/primitives SegBtn)
export const ModeBtn = SegBtn
