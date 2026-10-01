/**
 * Legacy "terminal" primitives — v4 (AtScale) implementations.
 * Same APIs as v3 so every call site keeps working; the look now follows
 * DESIGN_GUIDE §6 (SectionTitle + 2px rule, RuledList rows, status chips).
 * Prefer ./primitives for new code.
 */
import type { CSSProperties, ReactNode } from 'react'
import { StatusChip, mono } from './primitives'

const tidyTitle = (t: string) => {
  const raw = t.replace(/^[◈▸▶●■]\s*/, '').trim()
  // SHOUTING CAPS → sentence case (keeps acronyms inside mixed-case titles)
  return raw === raw.toUpperCase() && /[A-Z]{4,}/.test(raw) ? raw.charAt(0) + raw.slice(1).toLowerCase() : raw
}

/* ── Section (was collapsible; v4 sections are always open — Simple/Advanced decides visibility) ── */
interface TerminalSectionProps {
  id: string
  title: string
  children: ReactNode
  defaultOpen?: boolean
  badge?: ReactNode
  accent?: string
  /** Right-aligned header content (e.g. a view toggle). */
  right?: ReactNode
}

export function TerminalSection({ id, title, children, badge, right }: TerminalSectionProps) {
  return (
    <section id={id} style={{ display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 140 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, borderBottom: '2px solid var(--fd-rule)', paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>{tidyTitle(title)}</h2>
          {badge}
        </div>
        {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </section>
  )
}

/* ── Flat panel ───────────────────────────────────────────────────────── */
export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ background: 'var(--fd-card)', padding: 24, ...style }}>{children}</div>
}

/* ── Panel header: mono label over a hairline ─────────────────────────── */
export function PanelHeader({ children }: { children: ReactNode }) {
  return <div style={{ ...mono, color: 'var(--fd-muted)', padding: '0 0 10px', borderBottom: '1px solid var(--fd-hairline)', marginBottom: 4 }}>{children}</div>
}

/* ── Data row (KeyValueRow) ───────────────────────────────────────────── */
interface DataRowProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  bar?: { value: number; color: string }
  spark?: ReactNode
}

export function DataRow({ label, value, sub, bar, spark }: DataRowProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14 }}>{label.charAt(0) + (label === label.toUpperCase() ? label.slice(1).toLowerCase() : label.slice(1))}</span>
        {sub && <span style={{ fontSize: 13, color: 'var(--fd-muted)', lineHeight: 1.35 }}>{sub}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {spark}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 500, whiteSpace: 'nowrap' }}>{value}</span>
          {bar && (
            <div style={{ width: 72, height: 6, background: 'var(--fd-hairline)' }}>
              <div style={{ width: `${Math.min(100, Math.max(0, bar.value))}%`, height: 6, background: 'var(--fd-accent)' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Metric cell (GridTile look) ──────────────────────────────────────── */
interface MetricCellProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  color?: string
  border?: string
  micro?: ReactNode
}

export function MetricCell({ label, value, sub, color, micro }: MetricCellProps) {
  return (
    <div style={{ background: 'var(--fd-page)', border: '1px solid var(--fd-hairline)', padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ ...mono, color: 'var(--fd-muted)' }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.05, color }}>{value}</span>
      {sub && <span style={{ fontSize: 13, color: 'var(--fd-muted)', lineHeight: 1.35 }}>{sub}</span>}
      {micro}
    </div>
  )
}

/* ── Divider: mono label + hairline ───────────────────────────────────── */
export function Divider({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0 4px' }}>
      {label && <span style={{ ...mono, color: 'var(--fd-muted)', flexShrink: 0 }}>{label}</span>}
      <div style={{ flex: 1, height: 1, background: 'var(--fd-hairline)' }} />
    </div>
  )
}

/* ── Badge → mono tag; colour maps onto a status chip ────────────────── */
const colorToStatus = (c?: string) =>
  !c ? 'info' : /red|negative|alert/.test(c) ? 'alert' : /green|accent|lime|ok/.test(c) ? 'ok' : /amber|yellow|lilac|orange|watch/.test(c) ? 'warn' : 'info'

export function TermBadge({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span style={{ ...mono, display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 8, border: '1px solid var(--fd-hairline)', color: 'var(--fd-ink)', whiteSpace: 'nowrap' }}>
      <StatusChip status={colorToStatus(color) as 'ok' | 'warn' | 'alert' | 'info'} size={8} />{children}
    </span>
  )
}

/* ── Count → mono muted number ────────────────────────────────────────── */
export function CountBadge({ n }: { n: number; color?: string }) {
  return <span style={{ ...mono, color: 'var(--fd-muted)' }}>{n}</span>
}
