import { useMemo } from 'react'
import { Panel, G, R, A, M, DIM } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 7. REGIME TRANSITION RISK (expanded) ────────────────────────────────────
export function RegimeTransition({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel
  const mc = data.market_context

  const regime    = pi.market_regime
  const volR      = pi.vol_regime
  const spMom20   = mc?.['S&P 500']?.momentum_20d ?? 0
  const spTrend90 = mc?.['S&P 500']?.trend_90d ?? 0

  // Historical median regime durations (NBER / Goldman Sachs regime data)
  const HALF_LIFE: Record<string, number> = {
    EXPANSION: 24, CONSOLIDATION: 6, 'RISK-OFF': 12, ACCELERATION: 4,
  }

  // Signal tension: opposing bull vs bear signals → reduces persistence
  const bullSignals = (spMom20 > 0.005 ? 1 : 0) + (spTrend90 > 0.01 ? 1 : 0) + (volR === 'LOW' ? 1 : 0)
  const bearSignals = (spMom20 < -0.005 ? 1 : 0) + (spTrend90 < -0.01 ? 1 : 0) + (volR === 'HIGH' ? 1 : 0) + (pi.fragility_score > 60 ? 1 : 0)
  const tension     = Math.abs(bullSignals - bearSignals)  // 0–4

  // Base persistence by horizon, adjusted down by signal tension
  const persAdj    = -tension * 0.04
  const persist30  = Math.min(0.97, Math.max(0.60, 0.92 + persAdj))
  const persist90  = Math.min(0.90, Math.max(0.35, 0.72 + persAdj * 2))
  const persist180 = Math.min(0.80, Math.max(0.20, 0.52 + persAdj * 3))

  // 90-day transition probability distribution
  const transitions = useMemo(() => {
    type State = 'EXPANSION' | 'CONSOLIDATION' | 'RISK-OFF' | 'ACCELERATION'
    const states: State[] = regime === 'EXPANSION'
      ? ['CONSOLIDATION', 'RISK-OFF', 'ACCELERATION']
      : regime === 'CONSOLIDATION'
      ? ['EXPANSION', 'RISK-OFF', 'ACCELERATION']
      : ['CONSOLIDATION', 'EXPANSION', 'ACCELERATION']

    let rawProbs: number[]
    if (regime === 'EXPANSION') {
      const slowBias  = (volR === 'HIGH' ? 15 : 0) + (spMom20 < 0 ? 10 : 0) + (spTrend90 < 0 ? 8 : 0)
      const crashBias = (volR === 'HIGH' ? 8  : 0) + (pi.fragility_score > 60 ? 5 : 0)
      rawProbs = [30 + slowBias, 10 + crashBias, 60 - slowBias - crashBias]
    } else if (regime === 'CONSOLIDATION') {
      const bullBias = (spMom20 > 0 ? 15 : 0) + (volR === 'LOW'  ? 10 : 0)
      const bearBias = (spMom20 < 0 ? 15 : 0) + (volR === 'HIGH' ? 10 : 0)
      rawProbs = [40 + bullBias, 20 + bearBias, 40 - bullBias - bearBias]
    } else {
      const recovBias = spMom20 > 0 ? 20 : 0
      rawProbs = [35 + recovBias, 45 - recovBias, 20]
    }
    const total = rawProbs.reduce((s, v) => s + v, 0)
    return states.map((st, i) => ({ state: st, pct: Math.round(rawProbs[i] / total * 100) }))
      .sort((a, b) => b.pct - a.pct)
  }, [regime, volR, spMom20, spTrend90, pi.fragility_score])

  const topAlt      = transitions[0]
  const regimeColor = regime === 'EXPANSION' ? G : regime === 'RISK-OFF' ? R : A
  const transColor  = (st: string) => st === 'EXPANSION' || st === 'ACCELERATION' ? G : st === 'RISK-OFF' ? R : A

  const horizons = [
    { label: '30D',  persist: persist30  },
    { label: '90D',  persist: persist90  },
    { label: '180D', persist: persist180 },
  ]

  return (
    <Panel title="◈ Regime Transition Risk" sub="Multi-horizon persistence · heuristic signal model" color={regimeColor} metricId="regime_transition">
      {/* Header */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12, color: M, marginBottom: 3, textTransform: 'uppercase' }}>Current Regime</div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: regimeColor }}>{regime}</span>
          {volR && (
            <span style={{ fontSize: 12, color: M, marginLeft: 6 }}>
              VOL: <span style={{ fontFamily: 'var(--font-mono)', color: volR === 'HIGH' ? R : volR === 'LOW' ? G : M }}>{volR}</span>
            </span>
          )}
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: M, marginBottom: 2, textTransform: 'uppercase' }}>Est. Half-Life</div>
          {HALF_LIFE[regime] != null
            ? <>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: M }}>{HALF_LIFE[regime]} mo</div>
                <div style={{ fontSize: 12, color: DIM }}>historical median</div>
              </>
            : <>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: DIM }}>—</div>
                <div style={{ fontSize: 12, color: DIM, maxWidth: 120, lineHeight: 1.4 }}>
                  {regime} has no fixed duration estimate
                </div>
              </>
          }
        </div>
      </div>

      {/* Multi-horizon persistence cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
        {horizons.map(h => {
          const persistPct  = Math.round(h.persist * 100)
          const topTransPct = Math.round((1 - h.persist) * (topAlt?.pct ?? 33) / 100 * 100)
          const hColor = persistPct >= 80 ? G : persistPct >= 55 ? A : R
          return (
            <div key={h.label} style={{ background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: M, marginBottom: 4, letterSpacing: '0.8px' }}>{h.label} HORIZON</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: hColor, lineHeight: 1 }}>{persistPct}%</div>
              <div style={{ fontSize: 12, color: DIM, marginTop: 2 }}>stays {regime.substring(0, 6)}</div>
              <div style={{ height: 3, background: 'var(--fd-card)', borderRadius: 0, margin: '5px 0' }}>
                <div style={{ width: `${persistPct}%`, height: '100%', background: hColor, borderRadius: 0, opacity: 0.6 }} />
              </div>
              <div style={{ fontSize: 12, color: transColor(topAlt?.state ?? ''), marginTop: 2 }}>
                {topTransPct}% → {topAlt?.state ?? '?'}
              </div>
            </div>
          )
        })}
      </div>

      {/* 90-day transition probability bars */}
      <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 6 }}>Transition Probabilities (90D)</div>
      {transitions.map(t => (
        <div key={t.state} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 12, color: transColor(t.state), fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
              {regime} → {t.state}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: transColor(t.state) }}>{t.pct}%</span>
          </div>
          <div style={{ height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{ width: `${t.pct}%`, height: '100%', background: transColor(t.state), borderRadius: 0, opacity: 0.7 }} />
          </div>
        </div>
      ))}

      {/* Signal summary */}
      <div style={{ borderTop: '1px solid var(--border2)', paddingTop: 8, marginTop: 4 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {[
            { label: '20D Momentum', val: `${spMom20 > 0 ? '+' : ''}${(spMom20 * 100).toFixed(1)}%`, color: spMom20 > 0 ? G : R },
            { label: '90D Trend',    val: `${spTrend90 > 0 ? '+' : ''}${(spTrend90 * 100).toFixed(1)}%`, color: spTrend90 > 0 ? G : R },
            { label: 'Signal Tension', val: `${tension}/4 ${tension >= 3 ? 'HIGH' : tension >= 2 ? 'MOD' : 'LOW'}`, color: tension >= 3 ? R : tension >= 2 ? A : G },
            { label: 'Fragility',    val: `${pi.fragility_score}/100`, color: pi.fragility_score > 60 ? R : pi.fragility_score > 40 ? A : G },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: DIM, marginTop: 8, fontStyle: 'italic' }}>
        Heuristic model — persistence adjusted by signal tension. Half-life from NBER/GS historical regime data.
        RISK-OFF is modeled as a transition destination from all regimes; self-persistence (stays in RISK-OFF) is shown in the horizon cards above.
      </div>
    </Panel>
  )
}
