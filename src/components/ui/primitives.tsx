/**
 * Financial Dashboard — AtScale UI primitives (reference implementation).
 *
 * Matches the codebase's existing conventions: inline styles, no CSS-in-JS lib,
 * CSS variables from index.tokens.css. Replaces / supersedes:
 *   ui/Tile.tsx, ui/StatTile.tsx, ui/SectionHeader.tsx, ui/ModeToggle.tsx,
 *   ui/Terminal.tsx (PanelHeader, DataRow, TermBadge), ui/SubTabBtn.tsx
 *
 * Every value below is lifted from prototype/*.dc.html.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type Status = 'ok' | 'watch' | 'warn' | 'alert' | 'info'

export const STATUS_FILL: Record<Status, string> = {
  ok:    'var(--fd-ok)',
  watch: 'var(--fd-watch)',
  warn:  'var(--fd-watch)',
  alert: 'var(--fd-alert)',
  info:  'var(--fd-hairline)',
}
/** Status as a bare mark (dot, stripe, bar) with no text on it — must read on Warm White. */
export const STATUS_MARK: Record<Status, string> = {
  ok:    'var(--fd-lime-ink)',
  watch: 'var(--fd-lilac-ink)',
  warn:  'var(--fd-lilac-ink)',
  alert: 'var(--fd-alert)',
  info:  'var(--fd-hairline)',
}
/** Text colour that sits ON a status fill. */
export const STATUS_ON: Record<Status, string> = {
  ok: 'var(--as-washed-black)', watch: 'var(--as-washed-black)', warn: 'var(--as-washed-black)',
  alert: 'var(--as-warm-white)', info: 'var(--fd-ink)',
}

/** Number colour: gains = accent (cobalt light / lime dark), losses = vermillion. */
export const gain = (n: number) => (n >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)')

// ── Type ─────────────────────────────────────────────────────────────────────
export const mono: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase',
}
export const muted: CSSProperties = { color: 'var(--fd-muted)' }

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ ...mono, ...muted, ...style }}>{children}</span>
}

// ── Page hero: eyebrow → serif headline (ONE italic word) → muted lead ──────
/**
 * `aside` sits in a 7/5 split. With `bleed`, the hero spans the page gutter
 * (the App content wrapper has 48px side padding) so a Cobalt aside runs
 * edge-to-edge, as in prototype/Tab Overview.
 */
export function PageHero({ eyebrow, eyebrowRight, before, em, after, lead, children, aside, bleed = false }: {
  eyebrow: ReactNode; eyebrowRight?: ReactNode; before?: string; em: string; after?: string
  lead?: ReactNode; children?: ReactNode; aside?: ReactNode; bleed?: boolean
}) {
  const text = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: bleed ? '64px 48px 56px' : undefined, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <span style={{ ...mono, fontSize: 13, color: 'var(--fd-accent)' }}>{eyebrow}</span>
        {eyebrowRight}
      </div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 80, lineHeight: 0.85, letterSpacing: '-0.02em', margin: 0 }}>
        {before}<em>{em}</em>{after}
      </h1>
      {lead && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 18, lineHeight: 1.35, maxWidth: 640 }}>{lead}</div>}
      {children}
    </div>
  )
  if (bleed) {
    return (
      <section style={{ display: 'grid', gridTemplateColumns: aside ? 'minmax(0,7fr) minmax(0,5fr)' : '1fr', margin: '0 -48px' }}>
        {text}{aside}
      </section>
    )
  }
  return (
    <section style={{ padding: '56px 0 40px', display: 'grid', gridTemplateColumns: aside ? 'minmax(0,7fr) minmax(0,5fr)' : '1fr', gap: 48, alignItems: 'start' }}>
      {text}{aside}
    </section>
  )
}

/** Muted second lead line. */
export function LeadMuted({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--fd-muted)' }}>{children}</span>
}

/** Mono-caps key/value meta row under a hero lead. */
export function HeroMeta({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', ...mono, ...muted, paddingTop: 8 }}>
      {items.map(i => <span key={i.k}>{i.k} <span style={{ color: 'var(--fd-ink)' }}>{i.v}</span></span>)}
    </div>
  )
}

// ── Decision plane (Cobalt ground). One per tab, maximum. ───────────────────
export function DecisionPlane({ label, children, pad = '36px 40px', style }: { label: string; children: ReactNode; pad?: string; style?: CSSProperties }) {
  return (
    <div data-ground="cobalt" style={{ background: 'var(--fd-page)', color: 'var(--fd-ink)', padding: pad, display: 'flex', flexDirection: 'column', gap: 20, position: 'relative', ...style }}>
      <CornerTriangle />
      <span style={mono}>{label}</span>
      {children}
    </div>
  )
}

/** Lime corner triangle, top-right of its positioned parent. */
export function CornerTriangle({ size = 40, color = 'var(--as-lime)' }: { size?: number; color?: string }) {
  return <div style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderTop: `${size}px solid ${color}`, borderLeft: `${size}px solid transparent` }} />
}

// ── KPI strip: N equal columns between hairlines, vertical dividers ─────────
/** `unit` renders in Suffix Serif italic after the value ("$5.71" + "M"). */
export interface Kpi { label: string; value: ReactNode; unit?: string; sub?: ReactNode; subColor?: string; status?: Status; valueColor?: string }
export function KpiStrip({ items, size = 44, bleed = false }: { items: Kpi[]; size?: number; bleed?: boolean }) {
  return (
    <section style={{
      display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))`,
      borderTop: '1px solid var(--fd-hairline)', borderBottom: '1px solid var(--fd-hairline)',
      ...(bleed ? { margin: '0 -48px', padding: '0 48px' } : null),
    }}>
      {items.map((k, i) => (
        <div key={i} style={{ padding: '32px 24px 32px 0', marginRight: 24, borderRight: '1px solid var(--fd-hairline)', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Label>{k.label}</Label>
            {k.status && <StatusChip status={k.status} />}
          </div>
          <span style={{ fontSize: typeof k.value === 'string' && k.value.length > 8 && !/^[−+$\d]/.test(k.value) ? Math.round(size * 0.65) : size, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1, color: k.valueColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {k.value}
            {k.unit && <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 400 }}>{k.unit}</span>}
          </span>
          {k.sub && <span style={{ fontSize: 14, color: k.subColor ?? 'var(--fd-muted)' }}>{k.sub}</span>}
        </div>
      ))}
    </section>
  )
}

// ── Status chip (12px square, 4px radius) and status tag (mono pill) ─────────
export function StatusChip({ status, size = 12 }: { status: Status; size?: number }) {
  return <span aria-label={status} style={{ width: size, height: size, borderRadius: 4, background: STATUS_MARK[status], flexShrink: 0, display: 'inline-block' }} />
}
export function StatusTag({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span style={{ ...mono, height: 24, display: 'inline-flex', alignItems: 'center', padding: '0 10px', borderRadius: 8, background: STATUS_FILL[status], color: STATUS_ON[status] }}>{children}</span>
  )
}

// ── Section heading (replaces SectionHeader + TerminalSection header) ────────
export function SectionTitle({ title, meta, index, level = 2 }: { title: string; meta?: ReactNode; index?: string; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        {index && <span style={{ ...mono, color: 'var(--fd-accent)' }}>{index}</span>}
        <H style={{ fontSize: level === 2 ? 24 : 18, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>{title}</H>
      </div>
      {meta && (typeof meta === 'string' ? <Label>{meta}</Label> : meta)}
    </div>
  )
}

// ── List row with structural top rule (replaces DataRow / bb-row) ────────────
export function RuledList({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--fd-rule)' }}>{children}</div>
}
export function KeyValueRow({ k, v, sub, status }: { k: ReactNode; v: ReactNode; sub?: ReactNode; status?: Status }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: status ? '14px 1fr auto' : '1fr auto', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14, alignItems: 'start' }}>
      {status && <StatusChip status={status} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{k}</span>
        {sub && <span style={{ fontSize: 13, ...muted }}>{sub}</span>}
      </div>
      <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{v}</span>
    </div>
  )
}

// ── Alert / attention row: 8px status bar + title + message + target tab ─────
export function AttentionRow({ status, title, msg, tab, onClick }: { status: Status; title: string; msg: string; tab?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={onClick ? 'fd-row' : undefined} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === 'Enter') onClick() } : undefined}
      style={{ display: 'grid', gridTemplateColumns: '8px 1fr auto', gap: 20, padding: '16px 0', borderBottom: '1px solid var(--fd-hairline)', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ background: STATUS_MARK[status] }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 14, lineHeight: 1.35, ...muted }}>{msg}</span>
      </div>
      {tab && <span style={{ ...mono, ...muted, alignSelf: 'center', paddingRight: 12 }}>{tab} →</span>}
    </div>
  )
}

// ── Tile grid (replaces Tile / MetricCell): hairline grid, no cards ─────────
export function TileGrid({ cols, children }: { cols: number; children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: 1, background: 'var(--fd-hairline)', border: '1px solid var(--fd-hairline)' }}>{children}</div>
}
export function GridTile({ label, value, sub, status }: { label: string; value: ReactNode; sub?: ReactNode; status?: Status }) {
  return (
    <div style={{ background: 'var(--fd-page)', padding: 20, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 140 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Label>{label}</Label>{status && <StatusChip status={status} size={10} />}</div>
      <span style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.005em', lineHeight: 1.05 }}>{value}</span>
      {sub && <span style={{ fontSize: 13, lineHeight: 1.35, ...muted }}>{sub}</span>}
    </div>
  )
}

// ── Segmented control (Simple/Advanced, periods, scenarios, sub-tabs) ───────
export function Segmented<T extends string>({ value, options, onChange, size = 'md', mono: useMono }: {
  value: T; options: { id: T; label: string; n?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; mono?: boolean
}) {
  const h = size === 'sm' ? 30 : 40
  return (
    <div role="tablist" style={{ display: 'flex', border: '1px solid var(--fd-rule)' }}>
      {options.map(o => {
        const on = o.id === value
        return (
          <button key={o.id} role="tab" aria-selected={on} onClick={() => onChange(o.id)} style={{
            height: h, padding: '0 16px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 6,
            background: on ? 'var(--fd-ink)' : 'transparent', color: on ? 'var(--fd-page)' : 'var(--fd-ink)',
            fontSize: useMono ? 12 : 14, fontWeight: 500, fontFamily: useMono ? 'var(--font-mono)' : 'var(--font-sans)',
          }}>
            {o.n && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.64 }}>{o.n}</span>}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Highlight capsule (one per section; states what a number means) ─────────
export function Capsule({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ background: 'var(--as-lime)', color: 'var(--as-washed-black)', borderRadius: 28, padding: '12px 20px', display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 500 }}>
      <span>{children}</span>{right && <span>{right}</span>}
    </div>
  )
}

// ── Palette bar footer mark ──────────────────────────────────────────────────
export function PaletteBar() {
  return (
    <div style={{ display: 'flex', width: 112, height: 10 }}>
      {['--as-vermillion', '--as-cobalt', '--as-lilac', '--as-lime'].map(c => <div key={c} style={{ flex: 1, background: `var(${c})` }} />)}
    </div>
  )
}

// ── Layout helpers (added during the port; same values as the prototype) ────

/** Tab page wrapper: 0 48px side padding, 64px bottom. Children = hero, KPI strip, sections. */
export function TabPage({ children }: { children: ReactNode }) {
  return <div style={{ padding: '0 0 64px' }}>{children}</div>
}

/** Vertical stack of sections, 56px apart, starting 56px below the KPI strip. */
export function Sections({ children, gap = 56, top = 56 }: { children: ReactNode; gap?: number; top?: number }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap, paddingTop: top }}>{children}</div>
}

/** Section with title + optional meta; `rule` puts the 2px ink rule under the title. */
export function Section({ title, meta, index, level = 2, rule = false, children, gap = 16 }: {
  title: string; meta?: ReactNode; index?: string; level?: 2 | 3; rule?: boolean; children: ReactNode; gap?: number
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap }}>
      <div style={rule ? { borderBottom: '2px solid var(--fd-rule)', paddingBottom: 12 } : undefined}>
        <SectionTitle title={title} meta={meta} index={index} level={level} />
      </div>
      {children}
    </section>
  )
}

/** Main + side rail, 8/4 (default) or 7/5, 56px gap. */
export function MainRail({ main, rail, split = '8/4' }: { main: ReactNode; rail: ReactNode; split?: '8/4' | '7/5' }) {
  const [a, b] = split === '7/5' ? [7, 5] : [8, 4]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `minmax(0,${a}fr) minmax(0,${b}fr)`, gap: 56, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 56, minWidth: 0 }}>{main}</div>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 40, minWidth: 0 }}>{rail}</aside>
    </div>
  )
}

/** Flat snow-grey card (no border, no shadow, square). */
export function Card({ children, pad = 32, style }: { children: ReactNode; pad?: number; style?: CSSProperties }) {
  return <div style={{ background: 'var(--fd-card)', padding: pad, display: 'flex', flexDirection: 'column', gap: 12, ...style }}>{children}</div>
}

/** Buttons: primary = Cobalt (→ Washed Black on hover), ghost = hairline (→ ink border). */
export function Button({ children, onClick, variant = 'ghost', disabled, size = 'md', type = 'button', style }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean; size?: 'sm' | 'md'; type?: 'button' | 'submit'; style?: CSSProperties
}) {
  const primary = variant === 'primary'
  return (
    <button type={type} className={primary ? 'fd-primary' : 'fd-ghost'} onClick={onClick} disabled={disabled} style={{
      height: size === 'sm' ? 32 : 40, padding: '0 16px', borderRadius: 0, cursor: disabled ? 'not-allowed' : 'pointer',
      border: primary ? 'none' : '1px solid var(--fd-hairline)',
      background: primary ? 'var(--as-cobalt)' : 'transparent', color: primary ? 'var(--as-warm-white)' : 'var(--fd-ink)',
      ...mono, whiteSpace: 'nowrap', ...style,
    }}>{children}</button>
  )
}

/** Horizontal meter bar, 8px tall by default, square. `pct` 0–100. Optional target tick. */
export function Bar({ pct, color = 'var(--fd-accent)', height = 8, track = 'var(--fd-card)', tick }: {
  pct: number; color?: string; height?: number; track?: string; tick?: number
}) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div style={{ position: 'relative', height, background: track }}>
      <div style={{ width: `${w}%`, height: '100%', background: color }} />
      {tick != null && <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${Math.max(0, Math.min(100, tick))}%`, width: 2, background: 'var(--fd-ink)' }} />}
    </div>
  )
}

/** Mono column-head table helpers: wrap a <table> in this for ruled styling. */
export const TH: CSSProperties = { ...mono, color: 'var(--fd-muted)', fontWeight: 400, textAlign: 'left', padding: '10px 12px 10px 0', borderBottom: '1px solid var(--fd-hairline)', whiteSpace: 'nowrap' }
export const TD: CSSProperties = { padding: '12px 12px 12px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14, verticalAlign: 'middle' }
export const TABLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', borderTop: '2px solid var(--fd-rule)' }

/** Map legacy colour levels (green/yellow/orange/red/info) to Status. */
export const levelToStatus = (l?: string | null): Status =>
  l === 'red' || l === 'critical' || l === 'alert' || l === 'high' ? 'alert'
  : l === 'orange' || l === 'yellow' || l === 'amber' || l === 'warn' || l === 'warning' || l === 'watch' || l === 'medium' ? 'warn'
  : l === 'green' || l === 'ok' || l === 'low' || l === 'good' ? 'ok' : 'info'

/** Empty / loading line in mono caps. */
export function MonoNote({ children }: { children: ReactNode }) {
  return <div style={{ ...mono, ...muted, padding: '24px 0' }}>{children}</div>
}

/** Split a money value into number + serif unit for KpiStrip ($5.71 + M). */
export function moneyUnit(n: number | null | undefined): { value: string; unit?: string } {
  if (n == null || isNaN(n)) return { value: '—' }
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (a >= 1e6) return { value: `${sign}$${(a / 1e6).toFixed(2)}`, unit: 'M' }
  if (a >= 1e3) return { value: `${sign}$${(a / 1e3).toFixed(1)}`, unit: 'K' }
  return { value: `${sign}$${a.toFixed(0)}` }
}

/** Signed money, full precision, with a true minus sign. */
export function signedMoney(n: number | null | undefined, fmt: (n: number) => string): string {
  if (n == null || isNaN(n)) return '—'
  return `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`
}
export const signedPct = (n: number | null | undefined, d = 2) =>
  n == null || isNaN(n) ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}%`

// ── Dialog: centred, page ground, 1px ink border, 64% ink backdrop, Esc closes ─
export function Dialog({ onClose, children, width = 760, label }: { onClose: () => void; children: ReactNode; width?: number; label?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)', zIndex: 900 }} />
      <div role="dialog" aria-modal="true" aria-label={label} style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 901,
        width: `min(${width}px, 94vw)`, maxHeight: '88vh', overflowY: 'auto',
        background: 'var(--fd-page)', color: 'var(--fd-ink)', border: '1px solid var(--fd-rule)', padding: 40,
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button onClick={onClose}>Close</Button></div>
      </div>
    </>,
    document.body,
  )
}

/** Pill chip (999px) with muted key + value — wellness chips, filters. */
export function Pill({ k, v, onClick, active }: { k?: ReactNode; v: ReactNode; onClick?: () => void; active?: boolean }) {
  const El = onClick ? 'button' : 'span'
  return (
    <El onClick={onClick} className={onClick ? 'fd-ghost' : undefined} style={{
      display: 'inline-flex', gap: 8, alignItems: 'center', height: 32, padding: '0 14px', borderRadius: 999,
      border: `1px solid ${active ? 'var(--fd-ink)' : 'var(--fd-hairline)'}`, fontSize: 13, whiteSpace: 'nowrap',
      background: active ? 'var(--fd-ink)' : 'transparent', color: active ? 'var(--fd-page)' : 'var(--fd-ink)', cursor: onClick ? 'pointer' : undefined,
    }}>
      {k != null && <span style={{ color: active ? 'inherit' : 'var(--fd-muted)' }}>{k}</span>}
      <span style={{ fontWeight: 500 }}>{v}</span>
    </El>
  )
}

/** Mono-caps sub-heading inside a column (e.g. "Income flow rules"). */
export function ColHead({ children, rule = false, style }: { children: ReactNode; rule?: boolean; style?: CSSProperties }) {
  return <span style={{ ...mono, padding: rule ? '12px 0' : undefined, ...style }}>{children}</span>
}

/** Small lilac callout (12px radius) — info notes. */
export function Callout({ children, tone = 'lilac' }: { children: ReactNode; tone?: 'lilac' | 'lime' }) {
  return <div style={{ background: tone === 'lime' ? 'var(--as-lime)' : 'var(--as-lilac)', color: 'var(--as-washed-black)', borderRadius: 12, padding: '14px 16px', fontSize: 13, lineHeight: 1.4 }}>{children}</div>
}

/** "2026-10-29" → "29 Oct" (adds the year when it isn't the current one). Non-ISO input is returned as-is. */
export function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** One segment button (ink fill when active). Group several in <SegGroup>. */
export function SegBtn({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button role="tab" aria-selected={active} title={title} onClick={onClick} style={{
      height: 30, padding: '0 12px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
      fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase',
      background: active ? 'var(--fd-ink)' : 'transparent', color: active ? 'var(--fd-page)' : 'var(--fd-ink)',
    }}>{children}</button>
  )
}
export function SegGroup({ children }: { children: ReactNode }) {
  return <div role="tablist" style={{ display: 'inline-flex', border: '1px solid var(--fd-rule)', flexShrink: 0 }}>{children}</div>
}
