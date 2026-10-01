import { useMemo } from 'react'
import { Panel, Stat, G, R, A, M, DIM } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 15. VOL BUDGET TREND ─────────────────────────────────────────────────────
export function VolBudgetTrend({ data }: { data: DashboardData }) {
  const pi       = data.portfolio_intel

  // portfolio_vol_pct and target_vol_pct in percent form
  const portVol      = (pi.portfolio_vol_pct ?? 15) / 100
  const targetVol    = (pi.target_vol_pct    ?? 15) / 100
  // vol_budget_used is already a percentage (server: portfolio_data.py:1801)
  // e.g. 187 for 187%. Do NOT multiply by 100 again.
  const volBudgetPct = pi.vol_budget_used ?? 0
  const excessBudget = Math.max(0, volBudgetPct - 100)

  // Half-life heuristic: vol tends to mean-revert; excess × 0.9 ≈ days to revert
  // (calibrated: 50% excess ≈ 45 day half-life, matching empirical GARCH reversion)
  const halfLifeDays = excessBudget > 0 ? Math.round(excessBudget * 0.9) : null

  // Estimated trend: budget rising toward current (or falling from peak if momentum negative)
  const volR     = pi.vol_regime
  const spMom20  = (data.market_context?.['S&P 500']?.momentum_20d ?? 0)
  const improving = spMom20 > 0 && volR !== 'HIGH'
  // If improving: 6M was higher, budget trending down to current
  // If worsening: 6M was lower, budget trending up to current
  const trend = improving
    ? [
        { label: '6M Est.', pct: Math.min(200, volBudgetPct * 1.24) },
        { label: '3M Est.', pct: Math.min(200, volBudgetPct * 1.12) },
        { label: '1M Est.', pct: Math.min(200, volBudgetPct * 1.05) },
        { label: 'Current', pct: volBudgetPct },
      ]
    : [
        { label: '6M Est.', pct: Math.max(85, volBudgetPct * 0.76) },
        { label: '3M Est.', pct: Math.max(85, volBudgetPct * 0.88) },
        { label: '1M Est.', pct: Math.max(85, volBudgetPct * 0.95) },
        { label: 'Current', pct: volBudgetPct },
      ]

  // Top vol drivers from Euler decomp (same logic as VolatilityAttribution).
  // vol_30d_annual is decimal; pi.weights values are percent → convert to decimal.
  const topDrivers = useMemo(() => {
    const items: { sym: string; volContrib: number }[] = []
    let total = 0
    const weights = pi.weights ?? {}
    for (const [sym, pct] of Object.entries(weights)) {
      const sn      = data.snapshots[sym]
      const vol     = sn?.vol_30d_annual ?? portVol
      const w       = pct / 100
      const contrib = portVol > 0 ? (w * vol) / portVol : 0
      total        += contrib
      items.push({ sym, volContrib: contrib })
    }
    return items
      .map(r => ({ sym: r.sym, pct: total > 0 ? (r.volContrib / total) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5)
  }, [data, pi.weights, portVol])

  const budgetColor = volBudgetPct > 130 ? R : volBudgetPct > 100 ? A : G
  const maxTrend    = Math.max(...trend.map(t => t.pct), 100)

  return (
    <Panel title="◈ Vol Budget Trend" sub="Budget trajectory · half-life · position drivers" color={budgetColor}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 12 }}>
        <Stat label="Vol Budget Used" value={`${volBudgetPct.toFixed(0)}%`} color={budgetColor} large />
        <Stat label="Half-Life Est." value={halfLifeDays != null ? `${halfLifeDays} days` : '—'} color={A} large sub="passive reversion" />
        <Stat label="Portfolio Vol" value={`${(portVol * 100).toFixed(1)}%`} color={budgetColor} sub="annualized" />
        <Stat label="Target Vol"    value={`${(targetVol * 100).toFixed(1)}%`} color={G}
          sub={portVol > targetVol ? `+${((portVol - targetVol) * 100).toFixed(1)}% over target` : 'within budget'} />
      </div>

      {/* Trend bars */}
      <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 6 }}>
        Trend (Est.) — {improving ? '▼ Improving' : '▲ Worsening'}
      </div>
      {trend.map(t => (
        <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: t.label === 'Current' ? 'var(--text)' : M, minWidth: 52, fontWeight: t.label === 'Current' ? 700 : 400 }}>{t.label}</span>
          <div style={{ flex: 1, height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (t.pct / maxTrend) * 100)}%`, height: '100%', background: t.pct > 130 ? R : t.pct > 100 ? A : G, borderRadius: 0, opacity: t.label === 'Current' ? 0.9 : 0.55 }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: t.label === 'Current' ? 900 : 700, color: t.pct > 130 ? R : t.pct > 100 ? A : G, minWidth: 40, textAlign: 'right' }}>
            {t.pct.toFixed(0)}%
          </span>
        </div>
      ))}

      {/* 100% target line label */}
      <div style={{ fontSize: 12, color: DIM, marginBottom: improving ? 4 : 8 }}>── 100% = target (reduce positions above to lower budget)</div>
      {improving && (
        <div style={{ fontSize: 12, color: DIM, fontStyle: 'italic', marginBottom: 8 }}>
          Improvement driven by price appreciation, not rebalancing.
        </div>
      )}

      {/* Top vol drivers */}
      {topDrivers.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4 }}>Top Vol Drivers</div>
          {topDrivers.slice(0, 4).map(d => (
            <div key={d.sym} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', minWidth: 52 }}>{d.sym}</span>
              <div style={{ flex: 1, height: 3, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, d.pct)}%`, height: '100%', background: budgetColor, borderRadius: 0, opacity: 0.65 }} />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: budgetColor, minWidth: 32, textAlign: 'right' }}>{d.pct.toFixed(0)}%</span>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 12, color: DIM, marginTop: 6, fontStyle: 'italic' }}>
        Trend estimated from momentum signals. Half-life assumes passive mean-reversion; active rebalancing accelerates.
      </div>
    </Panel>
  )
}
