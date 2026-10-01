import type { ReactNode } from 'react'
import { M } from './constants'

export function Label({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 500, color: M,
      textTransform: 'uppercase', letterSpacing: '0.7px' }}>
      {children}
    </span>
  )
}

export function StatBox({ label, value, color = 'var(--text)', sub }:
  { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
      borderRadius: 0, padding: '8px 12px', minWidth: 110 }}>
      <Label>{label}</Label>
      <div style={{ fontSize: 15, fontWeight: 500, color,
        fontFamily: 'var(--font-mono)', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: M, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

export function Btn({ children, onClick, variant = 'default', disabled = false, small = false }:
  { children: ReactNode; onClick?: () => void
    variant?: 'default'|'green'|'red'|'blue'; disabled?: boolean; small?: boolean }) {
  // v4: blue/green = primary (Cobalt), red = ghost with Vermillion text, default = ghost
  const primary = variant === 'blue' || variant === 'green'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={primary ? 'fd-primary' : 'fd-ghost'}
      style={{
        height: small ? 28 : 32, padding: small ? '0 10px' : '0 14px',
        background: primary ? 'var(--as-cobalt)' : 'transparent',
        border: primary ? 'none' : '1px solid var(--fd-hairline)',
        color: primary ? 'var(--as-warm-white)' : variant === 'red' ? 'var(--fd-negative)' : 'var(--fd-ink)',
        fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

export function Input({ label, value, onChange, type = 'text', placeholder = '', onKeyDown }:
  { label?: string; value: string; onChange: (v: string) => void
    type?: string; placeholder?: string
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {label && <Label>{label}</Label>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{
          background: 'var(--bg)', border: '1px solid var(--fd-hairline)',
          color: 'var(--text)', padding: '4px 8px', fontSize: 12,
          fontFamily: 'var(--font-mono)', outline: 'none', width: '100%',
        }}
      />
    </div>
  )
}

export function fmtPct(v: number, digits = 2) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}
export function fmtDate(s: string) {
  return s?.slice(0, 10) ?? '—'
}
