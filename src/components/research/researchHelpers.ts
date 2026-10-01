// ── Helpers ───────────────────────────────────────────────────────────────────

import { G, R, A, M, Y } from './researchTypes'

export function verdictColor(v?: string) {
  if (!v) return M
  const u = v.toUpperCase()
  if (u.includes('STRONG')) return G
  if (u.includes('BUY')) return G
  if (u.includes('SELL') || u.includes('AVOID')) return R
  if (u.includes('TRIM')) return Y
  return A
}
export function qualityColor(s?: number) {
  return s == null ? M : s >= 70 ? G : s >= 50 ? A : R
}
export function qualityBadge(s?: number): 'green' | 'yellow' | 'red' | 'none' {
  if (s == null) return 'none'
  return s >= 80 ? 'green' : s >= 60 ? 'yellow' : 'red'
}
export function corrColor(v?: number | null) {
  if (v == null) return M
  const a = Math.abs(v)
  return a > 0.8 ? R : a > 0.5 ? Y : G
}
export function fmtAssets(v?: number | null) {
  if (!v) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toLocaleString()}`
}
