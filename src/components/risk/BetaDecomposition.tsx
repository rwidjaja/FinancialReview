import { useMemo } from 'react'
import { Panel, Stat, G, R, A, M, DIM } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 10. BETA DECOMPOSITION ───────────────────────────────────────────────────
export function BetaDecomposition({ data }: { data: DashboardData }) {
  const pi       = data.portfolio_intel

  type BRow = { sym: string; weightPct: number; beta: number; betaContrib: number }

  // pi.weights values are stored as PERCENT on the server
  // (portfolio_data.py:1929: round(w * 100, 1)), e.g. 43.6 for SMH.
  // So weightPct = pct as-is; weight (decimal) for math = pct / 100.
  const rows = useMemo<BRow[]>(() => {
    const items: BRow[] = []
    const weights = pi.weights ?? {}
    for (const [sym, pct] of Object.entries(weights)) {
      const sn   = data.snapshots[sym]
      const beta = sn?.beta
      if (beta == null || isNaN(beta)) continue
      const w = pct / 100
      items.push({ sym, weightPct: pct, beta, betaContrib: w * beta })
    }
    return items.sort((a, b) => b.betaContrib - a.betaContrib).slice(0, 10)
  }, [data, pi.weights])

  const portBeta = pi.weighted_beta ?? (rows.length > 0 ? rows.reduce((s, r) => s + r.betaContrib, 0) : null)
  const betaColor = portBeta == null ? M : portBeta > 1.3 ? R : portBeta > 1.0 ? A : G

  const top3Share = portBeta && portBeta > 0 && rows.length >= 3
    ? (rows.slice(0, 3).reduce((s, r) => s + r.betaContrib, 0) / portBeta) * 100
    : null

  return (
    <Panel title="◈ Beta Decomposition" sub="Systematic risk by position · SPX benchmark" color={betaColor}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 16px', marginBottom: 10 }}>
        <Stat label="Portfolio Beta"  value={portBeta != null ? portBeta.toFixed(2) : '—'} color={betaColor} large metricId="beta" />
        <Stat label="High-β Driver" value={rows[0]?.sym ?? '—'} color={A}
          sub={rows[0] ? `${rows[0].weightPct.toFixed(1)}% wt · β=${rows[0].beta.toFixed(2)}` : 'no data'} />
        <Stat label="Top-3 Share" value={top3Share != null ? `${top3Share.toFixed(0)}%` : '—'} color={M}
          sub="of portfolio beta" />
      </div>

      {rows.length > 0 ? rows.map(r => {
        const sharePct = portBeta && portBeta > 0 ? (r.betaContrib / portBeta) * 100 : 0
        return (
          <div key={r.sym} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', minWidth: 52 }}>{r.sym}</span>
            <span style={{ fontSize: 12, color: M, minWidth: 40 }}>{r.weightPct.toFixed(1)}% wt</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: r.beta > 1.5 ? R : r.beta > 1.1 ? A : G, minWidth: 36 }}>β{r.beta.toFixed(2)}</span>
            <div style={{ flex: 1, height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, sharePct)}%`, height: '100%', background: r.beta > 1.3 ? R : A, borderRadius: 0, opacity: 0.7 }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: A, minWidth: 34, textAlign: 'right' }}>{sharePct.toFixed(0)}%</span>
          </div>
        )
      }) : (
        <div style={{ fontSize: 12, color: DIM, fontStyle: 'italic' }}>
          Per-position beta not in snapshot data.{portBeta != null && ` Portfolio beta: ${portBeta.toFixed(2)} (weighted avg)`}
        </div>
      )}
    </Panel>
  )
}
