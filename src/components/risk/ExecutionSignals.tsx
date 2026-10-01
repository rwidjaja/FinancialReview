import { useMemo, useState } from 'react'
import { Panel, G, R, A, M, DIM } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 4. EXECUTION SIGNALS ─────────────────────────────────────────────────────
const SIGNAL_MAP: Record<string, { action: string; color: string }> = {
  ENGINE_HEALTHY:       { action: 'HOLD',  color: G },
  VALUATION_STRETCHED:  { action: 'TRIM',  color: A },
  INCOME_COMPRESSION:   { action: 'WATCH', color: A },
  STRUCTURAL_BREAKDOWN: { action: 'EXIT',  color: R },
}
const LEVEL_COLOR: Record<string, string> = { GREEN: G, YELLOW: A, RED: R }

// Threshold: a position this many pct-points over target triggers a REDUCE
// upgrade when portfolio-level risk is elevated (fragility ≥70 or vol budget ≥100%).
const REDUCE_OVER_TARGET_THRESHOLD = 15

// At extreme overweight (>= this delta), treat as an intentional user override rather than
// a REDUCE recommendation — concentration this large is a deliberate strategy choice, not drift.
const INTENTIONAL_OVERWEIGHT_THRESHOLD = 35

export function ExecutionSignals({ data }: { data: DashboardData }) {
  const decisions = data.decisions ?? []
  const overUnder = data.portfolio_intel.taxable_target_vs_actual ?? []

  // Portfolio-level risk gates — if either is elevated, overweight positions
  // should be flagged REDUCE rather than HOLD.
  const fragility = data.portfolio_intel?.fragility_score ?? 0
  const volBudget = data.portfolio_intel?.vol_budget_used ?? 0
  const isHighRiskPortfolio = fragility >= 70 || volBudget >= 100

  const rows = useMemo(() => decisions.filter(d => {
    const sym = d.symbol?.toUpperCase() ?? ''
    return !sym.includes('MAIN') && !sym.includes('NEW') && sym.length > 0
  }).map(d => {
    const sig   = SIGNAL_MAP[d.structural_status] ?? { action: 'HOLD', color: M }
    const tva   = overUnder.find(t => t.symbol === d.symbol)
    const delta = tva ? tva.delta_pct : null

    let action = sig.action
    let color  = LEVEL_COLOR[d.overall] ?? sig.color
    let reason = d.summary

    // Intentional overweight: delta so large it can only be a deliberate strategy choice.
    // Label as OVERWEIGHT (amber) rather than REDUCE (red) — flags the concentration
    // without nagging the user to undo something they chose.
    if (action === 'HOLD' && delta != null && delta >= INTENTIONAL_OVERWEIGHT_THRESHOLD && isHighRiskPortfolio) {
      action = 'OVERWEIGHT'
      color  = A
      reason = `+${delta.toFixed(1)}% vs target — intentional overweight · concentration risk acknowledged · monitor if position exceeds 65% or VIX > 25`
    // Moderate overweight that isn't clearly intentional — standard REDUCE signal.
    } else if (action === 'HOLD' && delta != null && delta > REDUCE_OVER_TARGET_THRESHOLD && isHighRiskPortfolio) {
      action = 'REDUCE'
      color  = R
      reason = `${reason} · +${delta.toFixed(1)}% vs target — concentration + fragility ${fragility}/100 require reduction`
    }

    return { sym: d.symbol, action, color, reason, delta }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [decisions, overUnder, isHighRiskPortfolio, fragility])

  const actionPriority: Record<string, number> = { EXIT: 0, TRIM: 1, REDUCE: 2, OVERWEIGHT: 3, WATCH: 4, HOLD: 5, BUY: 6 }

  const buys = overUnder.filter(t => t.delta_pct < -5 && !rows.find(r => r.sym === t.symbol))
    .map(t => ({ sym: t.symbol, action: 'BUY', color: G, reason: `Under target by ${Math.abs(t.delta_pct).toFixed(1)}%`, delta: t.delta_pct }))

  const allRows = [...rows, ...buys].sort((a, b) => (actionPriority[a.action] ?? 9) - (actionPriority[b.action] ?? 9))

  return (
    <Panel title="◈ Execution Signals" sub="Based on structural status · target gap + reason per row" color={A}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {allRows.length === 0 && <div style={{ fontSize: 12, color: DIM }}>No signals. Add decisions to your dashboard.</div>}
        {allRows.map(r => (
          <SignalRow key={r.sym} r={r} />
        ))}
      </div>
    </Panel>
  )
}

function SignalRow({ r }: { r: { sym: string; action: string; color: string; reason: string; delta: number | null } }) {
  const [hovered, setHovered] = useState(false)
  const A = 'var(--amber)'
  const R = 'var(--red)'
  const M = 'var(--text2)'
  const DIM = 'var(--text3)'  // always-on detail text — must stay readable, not 0.2-alpha
  const ACTION_BG: Record<string, string> = {
    EXIT:       'var(--fd-card)',
    TRIM:       'var(--fd-card)',
    REDUCE:     'var(--fd-card)',
    OVERWEIGHT: 'var(--fd-card)',
    WATCH:      'var(--fd-card)',
    HOLD:       'transparent',
    BUY:        'var(--fd-card)',
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '4px 8px', background: ACTION_BG[r.action] ?? 'transparent', borderLeft: `2px solid ${r.color}`, cursor: 'default' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', minWidth: 52 }}>{r.sym}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: r.color, minWidth: 40 }}>{r.action}</span>
      {r.delta != null && (
        <span style={{ fontSize: 12, color: r.delta < 0 ? A : r.delta > 5 ? R : M, whiteSpace: 'nowrap' }}>
          {r.delta > 0 ? '+' : ''}{r.delta.toFixed(1)}% vs target
        </span>
      )}
      {/* Detail is always visible — hover-only text is an invisible affordance.
          Quiet by default, brightens on hover for readability. */}
      <span style={{ fontSize: 12, color: hovered ? M : DIM, flex: 1, lineHeight: 1.4,
        transition: 'color 0.15s ease' }}>
        {r.reason}
      </span>
    </div>
  )
}
