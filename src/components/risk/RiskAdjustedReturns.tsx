import { useMemo } from 'react'
import { Panel, Stat, G, R, A, M, TECH_C, fmtPct } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 2. RISK-ADJUSTED RETURNS ─────────────────────────────────────────────────
// portfolio_vol_pct is stored as percent (e.g. 22.9 = 22.9%) → divide by 100 for Sharpe
export function RiskAdjustedReturns({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel

  const { portReturn, maxDD, topHoldings } = useMemo(() => {
    let portReturn = 0
    // Portfolio-weighted 6M drawdown (consistent with DrawdownPath panel).
    // Previously used Math.min(...) which picked the worst single symbol,
    // labeled the same as the portfolio DD — gave -32% vs DrawdownPath's
    // -4% on the same tab.
    let maxDD = 0
    const holdingReturns: { sym: string; weight: number; ret: number }[] = []
    // pi.weights are PERCENT (server: portfolio_data.py:1929). Convert to
    // decimal for weighted math; keep weight field as decimal (the JSX
    // display already does weight * 100 to render percent).
    const weights = pi.weights ?? {}
    for (const [sym, pct] of Object.entries(weights)) {
      const sn = data.snapshots[sym]
      if (!sn) continue
      const w = pct / 100
      const r = sn.total_return_1y ?? 0
      portReturn += w * r
      maxDD      += w * (sn.max_drawdown_6m ?? 0)
      holdingReturns.push({ sym, weight: w, ret: r })
    }
    holdingReturns.sort((a, b) => b.weight - a.weight)
    return { portReturn, maxDD, topHoldings: holdingReturns.slice(0, 3) }
  }, [data, pi.weights])

  const beta      = pi.weighted_beta
  // portfolio_vol_pct is in percent form (22.9) → convert to decimal for ratio calculations
  const portVol   = (pi.portfolio_vol_pct ?? 0) / 100
  const riskFree  = 0.045
  const excessRet = portReturn - riskFree
  const sharpe    = portVol > 0 ? excessRet / portVol : null
  const sortino   = sharpe != null ? sharpe * 1.35 : null  // approx downside vol ≈ 0.74 × total

  const retColor    = portReturn >= 0.08 ? G : portReturn >= 0 ? A : R
  const sharpeColor = sharpe == null ? M : sharpe >= 1.0 ? G : sharpe >= 0.5 ? A : R
  const volColor    = portVol > 0.20 ? R : portVol > 0.15 ? A : G

  return (
    <Panel title="◈ Risk-Adjusted Returns" sub="12-month · portfolio-weighted" color={TECH_C}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 16px', marginBottom: 12 }}>
        <Stat label="Portfolio Return (1Y)" value={fmtPct(portReturn * 100)} color={retColor} large metricId="cagr" />
        <Stat label="Sharpe Ratio"  value={sharpe  != null ? sharpe.toFixed(2)  : '—'} color={sharpeColor} large metricId="sharpe_ratio" />
        <Stat label="Sortino Ratio" value={sortino != null ? sortino.toFixed(2) : '—'} color={sharpeColor} />
        <Stat label="Beta vs SPX"   value={beta != null ? beta.toFixed(2) : '—'} color={beta != null && beta > 1.3 ? R : beta != null && beta > 1.0 ? A : G} metricId="beta" />
        <Stat label="Portfolio Vol" value={portVol ? fmtPct(portVol * 100) : '—'} color={volColor} sub="annualized" metricId="vol_budget" />
        <Stat label="Max DD (6M)"   value={maxDD !== 0 ? fmtPct(maxDD * 100) : '—'} color={maxDD < -0.15 ? R : maxDD < -0.08 ? A : G} metricId="max_drawdown" />
      </div>

      {topHoldings.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 5 }}>Top Holdings by Weight</div>
          {topHoldings.map(h => (
            <div key={h.sym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{h.sym}</span>
              <span style={{ fontSize: 12, color: M }}>{fmtPct(h.weight * 100)} weight</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: h.ret >= 0 ? G : R, fontWeight: 500 }}>
                {h.ret >= 0 ? '+' : ''}{fmtPct(h.ret * 100)} 1Y
              </span>
            </div>
          ))}
        </>
      )}
    </Panel>
  )
}
