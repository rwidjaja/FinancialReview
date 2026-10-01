import { useMemo } from 'react'
import { Panel, ScoreMeter, G, R, A, M, DIM, TECH_C } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 1. REGIME ALIGNMENT ──────────────────────────────────────────────────────
// tech_growth_pct, income_pct, defensive_pct are stored as percent (e.g. 45.1 = 45.1%)
export function RegimeAlignment({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel
  const regime    = pi.market_regime
  const volR      = pi.vol_regime
  const fragScore = pi.fragility_score
  const volBudget = pi.vol_budget_used ?? 0          // already a percent (e.g. 187)
  const techPct   = pi.tech_growth_pct ?? 0          // already percent
  const incomePct = pi.income_pct ?? 0               // already percent
  const defPct    = pi.defensive_pct ?? 0            // already percent
  const pos       = pi.positioning

  const alignScore = useMemo(() => {
    let s = 50
    if (regime === 'EXPANSION') {
      if (pos === 'AGGRESSIVE') s += 25
      else if (pos === 'BALANCED') s += 10
      else s -= 10
      if (techPct > 30) s += 15
      if (incomePct > 50) s -= 10
      if (volBudget > 150) s -= 20   // critically breached — hard cap on alignment
      else if (volBudget > 130) s -= 10
      if (fragScore > 60) s -= 5
    } else if (regime === 'RISK-OFF') {
      if (pos === 'CONSERVATIVE') s += 25
      else if (pos === 'BALANCED') s += 5
      else s -= 20
      if (incomePct > 40) s += 15
      if (defPct > 20) s += 10
      if (techPct > 30) s -= 15
    } else {
      // CONSOLIDATION / NEUTRAL — only BALANCED positioning earns a bonus
      // Vol/fragility penalties apply only in directional regimes (EXPANSION/RISK-OFF)
      if (pos === 'BALANCED') s += 15
    }
    return Math.min(100, Math.max(0, s))
  }, [regime, pos, techPct, incomePct, defPct, volBudget, fragScore])

  const alignColor  = alignScore >= 70 ? G : alignScore >= 45 ? A : R
  const regimeColor = regime === 'EXPANSION' ? G : regime === 'RISK-OFF' ? R : A

  const notes: { text: string; color: string }[] = []
  if (pos === 'AGGRESSIVE' && regime === 'EXPANSION')  notes.push({ text: 'Growth-heavy tilt appropriate for expansion', color: G })
  if (pos === 'AGGRESSIVE' && regime === 'RISK-OFF')   notes.push({ text: 'Aggressive tilt misaligned with risk-off regime', color: R })
  if (volBudget > 130) notes.push({ text: `Vol budget exceeded (${volBudget.toFixed(0)}% > 100%)`, color: R })
  else if (volBudget > 100) notes.push({ text: `Vol budget elevated (${volBudget.toFixed(0)}%)`, color: A })
  if (fragScore > 60) notes.push({ text: `Fragility elevated (${fragScore}) — consider hedging`, color: A })
  if (techPct > 35)   notes.push({ text: `Tech/growth overweight (${techPct.toFixed(0)}%)`, color: A })
  if (incomePct > 50 && regime === 'EXPANSION') notes.push({ text: `Income-heavy allocation sub-optimal for expansion`, color: A })

  return (
    <Panel title="◈ Regime Alignment" sub="How your allocation fits the current macro regime" color={regimeColor}>
      <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: M, marginBottom: 4, textTransform: 'uppercase' }}>Regime</div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: regimeColor }}>{regime}</span>
          {volR && <span style={{ fontSize: 12, color: M, marginLeft: 8 }}>VOL: <span style={{ fontFamily: 'var(--font-mono)', color: volR === 'HIGH' ? R : volR === 'LOW' ? G : M }}>{volR}</span></span>}
        </div>
        <div>
          <div style={{ fontSize: 12, color: M, marginBottom: 4, textTransform: 'uppercase' }}>Positioning</div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: alignColor }}>{pos ?? '—'}</span>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: M, marginBottom: 2, textTransform: 'uppercase' }}>Alignment Score</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500, color: alignColor, lineHeight: 1 }}>{alignScore}</div>
          <div style={{ fontSize: 12, color: DIM }}>/100</div>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <ScoreMeter score={Math.min(100, techPct)}   label="Tech / Growth %" color={TECH_C} />
        <ScoreMeter score={Math.min(100, incomePct)} label="Income %"         color={G} />
        <ScoreMeter score={Math.min(100, defPct)}    label="Defensive %"      color={A} />
        <ScoreMeter score={Math.min(100, volBudget)} label="Vol Budget Used %" color={volBudget > 130 ? R : volBudget > 100 ? A : G} />
      </div>

      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {notes.map((n, i) => (
            <div key={i} style={{ fontSize: 12, color: n.color, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0 }}>{n.color === R ? '' : n.color === G ? '✔' : '•'}</span>
              <span>{n.text}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
