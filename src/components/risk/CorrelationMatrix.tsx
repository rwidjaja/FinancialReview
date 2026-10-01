import { useMemo } from 'react'
import { Panel, G, R, A, DIM } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 12. CORRELATION MATRIX (heuristic) ───────────────────────────────────────
// No raw price series → proxy via asset type, 1Y return similarity, momentum alignment
export function CorrelationMatrix({ data }: { data: DashboardData }) {
  const totalVal = data.summary.total_value

  const { syms, matrix } = useMemo(() => {
    type PItem = { sym: string; weight: number; ret: number; type: string; mom: number }
    const pos: PItem[] = []
    const seen = new Set<string>()

    for (const acct of data.accounts)
      for (const p of acct.positions) {
        if (p.is_money_market || seen.has(p.symbol)) continue
        seen.add(p.symbol)
        const sn = data.snapshots[p.symbol]
        pos.push({
          sym:    p.symbol,
          weight: p.value / totalVal,
          ret:    sn?.total_return_1y ?? 0,
          type:   (p as any).asset_type ?? 'UNKNOWN',
          mom:    sn?.momentum_20d ?? 0,
        })
      }
    pos.sort((a, b) => b.weight - a.weight)
    const top = pos.slice(0, 6)

    function corrEst(a: PItem, b: PItem): number {
      if (a.sym === b.sym) return 1.0
      // Base correlation by asset type
      let c = a.type === b.type ? 0.70 : 0.35
      const incomeTypes = new Set(['DIVIDEND', 'CEF', 'OPTION_INCOME'])
      if (incomeTypes.has(a.type) && incomeTypes.has(b.type)) c = 0.60
      if (a.type === 'GROWTH' && b.type === 'GROWTH') c = 0.75
      // Return similarity
      const dr = Math.abs(a.ret - b.ret)
      if (dr < 0.10) c += 0.12
      else if (dr < 0.20) c += 0.05
      else if (dr > 0.35) c -= 0.10
      // Momentum alignment
      if ((a.mom > 0) === (b.mom > 0)) c += 0.06
      else c -= 0.08
      return Math.min(0.98, Math.max(-0.25, c))
    }

    const syms   = top.map(p => p.sym)
    const matrix = top.map(a => top.map(b => corrEst(a, b)))
    return { syms, matrix }
  }, [data, totalVal])

  const highCorrPairs: string[] = []
  for (let i = 0; i < syms.length; i++)
    for (let j = i + 1; j < syms.length; j++)
      if ((matrix[i]?.[j] ?? 0) > 0.75)
        highCorrPairs.push(`${syms[i]}↔${syms[j]}`)

  // Use server-computed count as the authoritative pair count for the alert
  // (server uses real price data; frontend uses heuristic — keep visual matrix but align the count)
  const pi = data.portfolio_intel
  const authoritativePairCount = pi.high_corr_pairs_count ?? highCorrPairs.length

  // Build cluster summary: group pairs into HIGH / MOD / LOW buckets
  const clusterSummary = useMemo(() => {
    type Pair = { a: string; b: string; c: number }
    const high: Pair[] = [], mod: Pair[] = [], low: Pair[] = []
    for (let i = 0; i < syms.length; i++)
      for (let j = i + 1; j < syms.length; j++) {
        const c = matrix[i]?.[j] ?? 0
        const pair = { a: syms[i], b: syms[j], c }
        if (c > 0.70) high.push(pair)
        else if (c > 0.50) mod.push(pair)
        else low.push(pair)
      }
    const avgC = (pairs: Pair[]) => pairs.length ? pairs.reduce((s, p) => s + p.c, 0) / pairs.length : 0
    return { high, mod, low, avgC }
  }, [syms, matrix])

  const { high, mod, low, avgC } = clusterSummary

  return (
    <Panel title="◈ Correlation Clusters" sub="Heuristic — asset type · return proximity · momentum" color={high.length > 0 ? R : G} metricId="correlation_cluster">
      {syms.length < 2
        ? <div style={{ fontSize: 12, color: DIM }}>Need ≥ 2 non-MM positions.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* HIGH cluster */}
            <div style={{
              padding: '8px 10px', borderRadius: 0,
              background: high.length > 0 ? 'var(--fd-card)' : 'var(--fd-card)',
              borderLeft: `2px solid ${high.length > 0 ? R : 'var(--fd-hairline)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: high.length > 0 ? 4 : 0 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: high.length > 0 ? R : DIM }}>
                  HIGH &gt; 0.70
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: DIM }}>
                  {high.length === 0 ? '— no highly correlated pairs' : `${high.length} pair${high.length !== 1 ? 's' : ''} · avg ${avgC(high).toFixed(2)}`}
                </span>
              </div>
              {high.length > 0 && (
                <>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: R, marginBottom: 2 }}>
                    {high.slice(0, 4).map(p => `${p.a}↔${p.b}`).join(' · ')}
                    {high.length > 4 && ` +${high.length - 4} more`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fd-muted)' }}>
                    Moves together — diversification benefit limited; reduce concentration risk
                  </div>
                </>
              )}
            </div>

            {/* MOD cluster */}
            <div style={{
              padding: '8px 10px', borderRadius: 0,
              background: mod.length > 0 ? 'var(--fd-card)' : 'var(--fd-card)',
              borderLeft: `2px solid ${mod.length > 0 ? A : 'var(--fd-hairline)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: mod.length > 0 ? 4 : 0 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: mod.length > 0 ? A : DIM }}>
                  MODERATE 0.50–0.70
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: DIM }}>
                  {mod.length === 0 ? '— no moderately correlated pairs' : `${mod.length} pair${mod.length !== 1 ? 's' : ''} · avg ${avgC(mod).toFixed(2)}`}
                </span>
              </div>
              {mod.length > 0 && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: A }}>
                  {mod.slice(0, 4).map(p => `${p.a}↔${p.b}`).join(' · ')}
                  {mod.length > 4 && ` +${mod.length - 4} more`}
                </div>
              )}
            </div>

            {/* LOW / DIVERSIFIED cluster */}
            <div style={{
              padding: '8px 10px', borderRadius: 0,
              background: low.length > 0 ? 'var(--fd-card)' : 'var(--fd-card)',
              borderLeft: `2px solid ${low.length > 0 ? G : 'var(--fd-hairline)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: low.length > 0 ? 4 : 0 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: low.length > 0 ? G : DIM }}>
                  DIVERSIFIED &lt; 0.50
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: DIM }}>
                  {low.length === 0 ? '— no low-corr pairs' : `${low.length} pair${low.length !== 1 ? 's' : ''} · avg ${avgC(low).toFixed(2)}`}
                </span>
              </div>
              {low.length > 0 && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: G }}>
                  {low.slice(0, 4).map(p => `${p.a}↔${p.b}`).join(' · ')}
                  {low.length > 4 && ` +${low.length - 4} more`}
                </div>
              )}
            </div>

            {high.length > 0 && (
              <div style={{ fontSize: 12, color: R, padding: '5px 8px', background: 'var(--fd-card)', borderLeft: `2px solid ${R}`, borderRadius: 0 }}>
                 {authoritativePairCount} high-correlation pair{authoritativePairCount !== 1 ? 's' : ''} detected — portfolio may not be as diversified as it appears
              </div>
            )}
          </div>
        )
      }
      <div style={{ fontSize: 12, color: DIM, marginTop: 6, fontStyle: 'italic' }}>
        Heuristic — not computed from price series. Based on asset type, 1Y return, and momentum alignment.
      </div>
    </Panel>
  )
}
