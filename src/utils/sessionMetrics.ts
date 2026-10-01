/**
 * Shared daily session metric helpers — used by BalanceHistoryTab and OverviewTab.
 * All functions are pure and dependency-free.
 */

const G = 'var(--green)'
const R = 'var(--red)'
const M = 'var(--text2)'

export interface DirectionInfo {
  label: string
  color: string
  emoji: string
}

/**
 * Categorise a DoD % into a named direction + color.
 * Thresholds: ±1% = Strong, ±0.25% = flat boundary.
 */
export function directionInfo(dovPct: number | null): DirectionInfo {
  if (dovPct == null) return { label: '—',           color: M,   emoji: '' }
  if (dovPct >  1.0)  return { label: 'Strong Up',   color: G,   emoji: '▲▲' }
  if (dovPct >  0.25) return { label: 'Up',          color: G,   emoji: '▲' }
  if (dovPct >= -0.25)return { label: 'Flat',        color: M,   emoji: '◆' }
  if (dovPct >= -1.0) return { label: 'Down',        color: R,   emoji: '▼' }
  return               { label: 'Strong Down',       color: R,   emoji: '▼▼' }
}

/**
 * Composite Day Score 0–100.
 * Weights: Close Pos % (50%), normalised intraday % (30%), normalised DoD % (20%).
 * Returns null when closePct (requires H/L data) is unavailable.
 */
export function dayScore(
  closePct: number | null,
  intradayPct: number | null,
  dovPct: number | null,
): number | null {
  if (closePct == null) return null
  const normIntraday = intradayPct != null ? Math.min(100, Math.max(0, (intradayPct + 3) / 6 * 100)) : 50
  const normDod      = dovPct      != null ? Math.min(100, Math.max(0, (dovPct      + 3) / 6 * 100)) : 50
  return Math.round(0.5 * Math.max(0, Math.min(100, closePct)) + 0.3 * normIntraday + 0.2 * normDod)
}

/** Simplified Day Score without H/L — uses only intraday % and DoD %. */
export function dayScoreSimple(
  intradayPct: number | null,
  dovPct: number | null,
): number {
  const normIntraday = intradayPct != null ? Math.min(100, Math.max(0, (intradayPct + 3) / 6 * 100)) : 50
  const normDod      = dovPct      != null ? Math.min(100, Math.max(0, (dovPct      + 3) / 6 * 100)) : 50
  return Math.round(0.6 * normIntraday + 0.4 * normDod)
}

export function dayScoreColor(score: number): string {
  return score >= 65 ? G : score >= 45 ? 'var(--amber)' : R
}
