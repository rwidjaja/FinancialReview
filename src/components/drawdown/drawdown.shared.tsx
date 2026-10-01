/**
 * Shared constants, types, and helper components used across drawdown panel files.
 */

import { useState } from 'react'
import { fmtMoneyFull } from '../../utils/formatters'
import type { StrategyId } from './drawdown.engine'

// ─── Shared colour palette (matches simTypes / taxColors) ─────────────────────
export const G  = 'var(--green)'
export const R  = 'var(--red)'
export const A  = 'var(--amber)'
export const M  = 'var(--text2)'
export const Y  = 'var(--yellow)'
export const BL = 'var(--blue)'
export const MU = '#9b59b6'   // muted purple for 5th strategy
export const TL = '#14b8a6'   // teal for spending guardrails

export const STRATEGY_COLORS: Record<StrategyId, string> = {
  taxable_first:   A,
  ira_first:       BL,
  roth_last:       G,
  proportional:    Y,
  dynamic_bracket: MU,
}

// 'rebalance' moved to Tax tab → "Sell & Rebalance" sub-view (TaxTab.tsx)
export type SubTab = 'decision' | 'guardrails' | 'optimizer' | 'tax' | 'longevity' | 'sandbox' | 'risk' | 'summary'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(digits === 0 ? 0 : digits)}K`
  return `$${n.toFixed(digits)}`
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null) return '—'
  return `${n.toFixed(digits)}%`
}

// Thin coloured label used in section headers
export function SectionLabel({ text, color = A }: { text: string; color?: string }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 500, letterSpacing: '1px',
      color, textTransform: 'uppercase', marginBottom: 6,
    }}>{text}</div>
  )
}

// Numeric input row with a label
export function InputRow({
  label, value, onChange, min, max, step, format, regime,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  format?: 'dollar' | 'pct' | 'age' | 'years'
  regime?: (v: number) => { label: string; color: string } | null
}) {
  const display =
    format === 'dollar' ? fmtMoneyFull(value) :
    format === 'pct'    ? `${(value * 100).toFixed(1)}%` :
    format === 'age'    ? `age ${value}` :
    `${value}`

  const badge = regime?.(value)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
      borderBottom: '1px solid var(--border2)' }}>
      <span style={{ fontSize: 12, color: M, flex: 1, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
      {badge && (
        <span style={{
          fontSize: 12, fontWeight: 500, letterSpacing: '0.6px', textTransform: 'uppercase',
          padding: '1px 6px', border: `1px solid ${badge.color}`,
          color: badge.color, background: `${badge.color}18`, whiteSpace: 'nowrap',
        }}>
          {badge.label}
        </span>
      )}
      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text1)', minWidth: 60, textAlign: 'right' }}>
        {display}
      </span>
      <input
        type="range"
        min={min ?? 0}
        max={max ?? 100}
        step={step ?? 1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: 120, accentColor: A }}
      />
    </div>
  )
}

// ⓘ icon that shows a plain-text popup — no API call needed
export function InlineTooltip({ text, label, color }: { text: string; label: string; color?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, padding: 0, marginLeft: 4,
          background: 'transparent', border: 'none',
          color: color ?? 'var(--text3)', fontSize: 12, fontWeight: 500,
          cursor: 'help', verticalAlign: 'middle',
        }}>ⓘ</button>
      {open && (
        <span role="tooltip" style={{
          position: 'absolute', top: '100%', left: '50%',
          transform: 'translateX(-50%) translateY(4px)',
          zIndex: 1000, width: 240, padding: '8px 10px',
          background: 'var(--bg2)',
          border: '1px solid var(--fd-hairline)',
          borderTop: `2px solid ${color ?? A}`,
          boxShadow: 'none',
          fontFamily: 'var(--font-sans)', fontSize: 12,
          lineHeight: 1.55, color: 'var(--text)',
          whiteSpace: 'normal', textAlign: 'left', cursor: 'default',
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: color ?? A,
            letterSpacing: '0.6px', fontFamily: 'var(--font-mono)', marginBottom: 4,
            textTransform: 'uppercase' }}>{label}</div>
          {text}
        </span>
      )}
    </span>
  )
}
