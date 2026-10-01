import { useMemo } from 'react'
import { Panel, G, R, A, M, DIM } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 14. STRESS CORRELATION ───────────────────────────────────────────────────
// Normal correlations rise 15–30% in VIX > 25 environments.
// Heuristic: stressed = min(0.98, base × 1.30 + 0.12) same-type; base × 1.20 + 0.18 cross-type
export function StressCorrelation({ data }: { data: DashboardData }) {
  const totalVal = data.summary.total_value

  const { syms, stressMatrix, normalMatrix } = useMemo(() => {
    type PItem = { sym: string; weight: number; ret: number; type: string; mom: number }
    const pos: PItem[] = []
    const seen = new Set<string>()
    for (const acct of data.accounts)
      for (const p of acct.positions) {
        if (p.is_money_market || seen.has(p.symbol)) continue
        seen.add(p.symbol)
        const sn = data.snapshots[p.symbol]
        pos.push({ sym: p.symbol, weight: p.value / totalVal, ret: sn?.total_return_1y ?? 0, type: (p as any).asset_type ?? 'UNKNOWN', mom: sn?.momentum_20d ?? 0 })
      }
    pos.sort((a, b) => b.weight - a.weight)
    const top = pos.slice(0, 6)

    function baseCorr(a: PItem, b: PItem): number {
      if (a.sym === b.sym) return 1.0
      let c = a.type === b.type ? 0.70 : 0.35
      const income = new Set(['DIVIDEND', 'CEF', 'OPTION_INCOME'])
      if (income.has(a.type) && income.has(b.type)) c = 0.60
      if (a.type === 'GROWTH'   && b.type === 'GROWTH')   c = 0.75
      const dr = Math.abs(a.ret - b.ret)
      if (dr < 0.10) c += 0.12
      else if (dr < 0.20) c += 0.05
      else if (dr > 0.35) c -= 0.10
      if ((a.mom > 0) === (b.mom > 0)) { c += 0.06 } else { c -= 0.08 }
      return Math.min(0.98, Math.max(-0.25, c))
    }

    function stressCorr(a: PItem, b: PItem): number {
      if (a.sym === b.sym) return 1.0
      const base = baseCorr(a, b)
      const sameType = a.type === b.type
      // Stress caps differ by cluster type — growth ETFs converge more tightly than CEFs/income
      const growthTypes  = new Set(['GROWTH'])
      const incomeTypes  = new Set(['DIVIDEND', 'OPTION_INCOME'])
      const cefTypes     = new Set(['CEF'])
      const isGrowthPair = growthTypes.has(a.type) && growthTypes.has(b.type)
      const isCefPair    = cefTypes.has(a.type) && cefTypes.has(b.type)
      const isIncomePair = incomeTypes.has(a.type) && incomeTypes.has(b.type)
      const cap = isGrowthPair ? 0.98        // growth cluster: high systemic risk
                : isCefPair   ? 0.85        // CEF cluster: moderate convergence
                : isIncomePair? 0.80        // dividend/income cluster: lower convergence
                : sameType    ? 0.92        // other same-type
                :               0.88        // cross-type
      return sameType
        ? Math.min(cap, base * 1.30 + 0.12)
        : Math.min(cap, base * 1.20 + 0.18)
    }

    const syms         = top.map(p => p.sym)
    const normalMatrix = top.map(a => top.map(b => baseCorr(a, b)))
    const stressMatrix = top.map(a => top.map(b => stressCorr(a, b)))
    return { syms, stressMatrix, normalMatrix }
  }, [data, totalVal])

  // Cluster risk: pairs with stressed corr > 0.80
  const highPairs: { pair: string; stress: number; normal: number }[] = []
  for (let i = 0; i < syms.length; i++)
    for (let j = i + 1; j < syms.length; j++) {
      const s = stressMatrix[i]?.[j] ?? 0
      if (s > 0.80) highPairs.push({ pair: `${syms[i]}–${syms[j]}`, stress: s, normal: normalMatrix[i]?.[j] ?? 0 })
    }
  highPairs.sort((a, b) => b.stress - a.stress)

  const clusterRisk  = highPairs.length >= 4 ? 'HIGH' : highPairs.length >= 2 ? 'MODERATE' : 'LOW'
  const clusterColor = clusterRisk === 'HIGH' ? R : clusterRisk === 'MODERATE' ? A : G

  function corrBg(c: number, self: boolean) {
    if (self)   return 'var(--fd-card)'
    if (c > 0.85) return 'var(--fd-card)'
    if (c > 0.70) return 'var(--fd-card)'
    if (c > 0.55) return 'var(--fd-card)'
    return 'var(--fd-card)'
  }
  function corrText(c: number) {
    if (c > 0.85) return R
    if (c > 0.70) return A
    if (c > 0.55) return A
    return 'var(--fd-lilac-ink)'
  }

  return (
    <Panel title="◈ Stress Correlation" sub="Estimated correlations under VIX > 25 regime" color={clusterColor} metricId="stress_correlation">
      <div style={{ fontSize: 12, color: DIM, fontStyle: 'italic', marginBottom: 8 }}>
        Heuristic — correlations historically rise 15–30% in high-vol regimes. Not from VIX price series.
      </div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 10, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 2 }}>Cluster Risk</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: clusterColor, lineHeight: 1 }}>{clusterRisk}</div>
          <div style={{ fontSize: 12, color: DIM, marginTop: 2 }}>{highPairs.length} high-corr pairs (&gt;0.80)</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 2 }}>Stress Uplift</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: A }}>+15–30%</div>
          <div style={{ fontSize: 12, color: DIM }}>vs normal regime</div>
        </div>
      </div>

      {syms.length >= 2 && (
        <>
          <div style={{ overflowX: 'auto', marginBottom: 8 }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: 44 }} />
                  {syms.map(s => (
                    <th key={s} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: M, fontWeight: 500, padding: '0 2px 4px', textAlign: 'center', minWidth: 40 }}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {syms.map((rowSym, i) => (
                  <tr key={rowSym}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', paddingRight: 6 }}>{rowSym}</td>
                    {syms.map((_, j) => {
                      const c    = stressMatrix[i]?.[j] ?? 0
                      const self = i === j
                      return (
                        <td key={j} style={{
                          width: 40, height: 26, textAlign: 'center',
                          background: corrBg(c, self),
                          border: '1px solid var(--fd-hairline)',
                          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                          color: self ? DIM : corrText(c),
                        }}>
                          {self ? '—' : c.toFixed(2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {highPairs.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4 }}>Highest Stress Pairs</div>
              {highPairs.slice(0, 4).map(p => (
                <div key={p.pair} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, padding: '5px 8px', borderRadius: 0, background: 'var(--fd-card)', borderLeft: `2px solid ${R}` }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{p.pair}</span>
                  <span style={{ fontSize: 12, color: M }}>normal: {p.normal.toFixed(2)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: R }}>stress: {p.stress.toFixed(2)}</span>
                </div>
              ))}
            </>
          )}
        </>
      )}

    </Panel>
  )
}
