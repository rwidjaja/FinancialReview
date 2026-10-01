// ─── Number formatters ────────────────────────────────────────────────────────

export function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtMoney(n: number | null | undefined, decimals = 0): string {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) {
    const k = Math.round(abs / 1000)
    // 999,500+ rounds to 1000K — show as $1.00M instead of "$1000K"
    if (k >= 1000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
    return `${sign}$${k}K`
  }
  return `${sign}$${abs.toFixed(decimals)}`
}

export function fmtMoneyFull(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-$' : '$'
  // Cents only below $10K — "$2,047,554.28" on portfolio-scale values is false
  // precision and visual noise. Per-share prices keep cents via fmtPrice.
  const decimals = abs < 10_000 ? 2 : 0
  return `${sign}${abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function fmtK(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  const k = Math.round(abs / 1000)
  if (k >= 1000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  return `${sign}$${k}K`
}

export function fmtM(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  return fmtK(n)
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null || isNaN(n)) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(decimals)}%`
}

export function fmtPctAbs(n: number | null | undefined, decimals = 1): string {
  if (n == null || isNaN(n)) return '—'
  return `${n.toFixed(decimals)}%`
}

export function fmtSignK(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  const sign = n >= 0 ? '+' : '−'
  return `${sign}$${Math.round(Math.abs(n) / 1000)}K`
}

export function fmtFull(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  const sign = n < 0 ? '-$' : '$'
  return `${sign}${Math.round(Math.abs(n)).toLocaleString('en-US')}`
}

export function fmtSignFull(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  const sign = n >= 0 ? '+$' : '−$'
  return `${sign}${Math.round(Math.abs(n)).toLocaleString('en-US')}`
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return `$${n.toFixed(2)}`
}

// ─── Color helpers ────────────────────────────────────────────────────────────
// v4 (AtScale): text colours only — good = accent, middling = ink, bad =
// Vermillion. Status belongs in a StatusChip, never a tinted number.

export function gainColor(n: number | null | undefined): string {
  if (n == null) return 'var(--fd-muted)'
  return n >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)'
}

export function gainClass(n: number | null | undefined): string {
  if (n == null) return 'text-[var(--fd-muted)]'
  return n >= 0 ? 'text-[var(--fd-accent)]' : 'text-[var(--fd-negative)]'
}

export function levelColor(level: 'GREEN' | 'YELLOW' | 'RED' | string): string {
  switch (level) {
    case 'GREEN': return 'var(--fd-accent)'
    case 'YELLOW': return 'var(--fd-ink)'
    case 'RED': return 'var(--fd-negative)'
    default: return 'var(--fd-muted)'
  }
}

export function alertColor(level: 'red' | 'orange' | 'yellow' | 'green' | string): string {
  switch (level) {
    case 'red': return 'var(--fd-negative)'
    case 'orange': return 'var(--fd-ink)'
    case 'yellow': return 'var(--fd-ink)'
    case 'green': return 'var(--fd-accent)'
    default: return 'var(--fd-muted)'
  }
}

export function confidenceColor(score: number): string {
  if (score >= 75) return 'var(--fd-accent)'
  if (score >= 55) return 'var(--fd-ink)'
  if (score >= 35) return 'var(--fd-ink)'
  return 'var(--fd-negative)'
}

export function withdrawalRateColor(wr: number | null): string {
  if (wr == null) return 'var(--fd-muted)'
  if (wr < 0.03) return 'var(--fd-accent)'
  if (wr < 0.04) return 'var(--fd-ink)'
  if (wr < 0.05) return 'var(--fd-ink)'
  return 'var(--fd-negative)'
}

export function coverageColor(cov: number | null): string {
  if (cov == null) return 'var(--fd-muted)'
  if (cov >= 150) return 'var(--fd-accent)'
  if (cov >= 100) return 'var(--fd-ink)'
  return 'var(--fd-negative)'
}

export function successColor(p: number): string {
  if (p >= 0.90) return 'var(--fd-accent)'
  if (p >= 0.80) return 'var(--fd-ink)'
  if (p >= 0.70) return 'var(--fd-ink)'
  return 'var(--fd-negative)'
}

// ─── Status maps ──────────────────────────────────────────────────────────────

// v4: no emoji — a neutral glyph; colour/status comes from STRUCTURAL_STATUS chips.
export const STRUCTURAL_ICON: Record<string, string> = {
  ENGINE_HEALTHY: '●',
  VALUATION_STRETCHED: '●',
  INCOME_COMPRESSION: '●',
  STRUCTURAL_BREAKDOWN: '●',
}

/** Fund-health → StatusChip status (ok = Lime, watch = Lilac, alert = Vermillion). */
export const STRUCTURAL_STATUS: Record<string, 'ok' | 'watch' | 'warn' | 'alert'> = {
  ENGINE_HEALTHY: 'ok',
  VALUATION_STRETCHED: 'watch',
  INCOME_COMPRESSION: 'warn',
  STRUCTURAL_BREAKDOWN: 'alert',
}

export const STRUCTURAL_LABEL: Record<string, string> = {
  ENGINE_HEALTHY: 'Engine Healthy',
  VALUATION_STRETCHED: 'Valuation Stretched',
  INCOME_COMPRESSION: 'Income / Vol Risk',
  STRUCTURAL_BREAKDOWN: 'Structural Breakdown',
}

export const STRUCTURAL_ROW: Record<string, string> = {
  ENGINE_HEALTHY: 'row-healthy',
  VALUATION_STRETCHED: 'row-stretched',
  INCOME_COMPRESSION: 'row-compressed',
  STRUCTURAL_BREAKDOWN: 'row-breakdown',
}

export function valuationColor(v: string): string {
  switch (v) {
    case 'EXTENDED': return 'var(--fd-negative)'
    case 'ELEVATED': return 'var(--fd-ink)'
    case 'FAIR': return 'var(--fd-accent)'
    case 'DISCOUNTED': return 'var(--fd-accent)'
    default: return 'var(--fd-muted)'
  }
}
