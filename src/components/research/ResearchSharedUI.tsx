import { SegBtn } from '../ui/primitives'
// ── Shared small UI components ────────────────────────────────────────────────

import { M } from './researchTypes'

// v4: segmented-control segment (see ui/primitives SegBtn)
export const ModeBtn = SegBtn

export function SbBox({ label, val, color, sub }: { label: string; val: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '5px 8px' }}>
      <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)', color: color ?? 'var(--text)' }}>{val}</div>
      {sub && <div style={{ fontSize: 12, color: M, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

export function LevelCell({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ padding: '10px 14px', borderRight: '1px solid var(--border2)',
      background: `${color}08` }}>
      <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
        letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 500, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function NextCondRow({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 12, color, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span style={{ fontSize: 12, color: M, lineHeight: 1.45 }}>{text}</span>
    </div>
  )
}
