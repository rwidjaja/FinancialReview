import { useMemo } from 'react'
import { Panel, Stat, G, R, A, M, DIM } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 11. VOLATILITY ATTRIBUTION ───────────────────────────────────────────────
// Simplified Euler decomposition: vol_contrib_i = w_i × σ_i / σ_p
// vol_30d_annual is in percent → divide by 100; portfolio_vol_pct same
export function VolatilityAttribution({ data }: { data: DashboardData }) {
  const pi       = data.portfolio_intel
  // portfolio_vol_pct in percent (22.9) → decimal for ratio math
  const portVol  = (pi.portfolio_vol_pct ?? 15) / 100

  type VRow = { sym: string; weightPct: number; volPct: number; volContrib: number; assetType: string; volContribPct: number }

  // Asset-type lookup: prefer snapshot.fund_type (GROWTH/OPTION_INCOME/DIVIDEND/CEF/MONEY_MARKET)
  // over position.asset_type (Schwab categories like EQUITY/ETF → all map to UNKNOWN)
  const assetTypeBySym = useMemo(() => {
    const out: Record<string, string> = {}
    for (const acct of data.accounts) {
      for (const p of acct.positions) {
        if (!(p.symbol in out)) {
          // fund_configs is authoritative: GROWTH/OPTION_INCOME/DIVIDEND/CEF/MONEY_MARKET
          const fundType = data.fund_configs[p.symbol]?.FUND_TYPE
            ?? data.snapshots[p.symbol]?.fund_type
          out[p.symbol] = fundType ?? 'UNKNOWN'
        }
      }
    }
    return out
  }, [data.accounts, data.snapshots, data.fund_configs])

  const { rows, byClass } = useMemo(() => {
    const items: Omit<VRow, 'volContribPct'>[] = []
    let totalContrib = 0
    // pi.weights are PERCENT (server: portfolio_data.py:1929). Convert to
    // decimal for vol-contribution math; display weightPct as-is.
    const weights = pi.weights ?? {}
    for (const [sym, pct] of Object.entries(weights)) {
      const sn      = data.snapshots[sym]
      const vol     = sn?.vol_30d_annual ?? portVol  // decimal, same unit as portVol
      const w       = pct / 100
      const contrib = portVol > 0 ? (w * vol) / portVol : 0
      totalContrib += contrib
      items.push({ sym, weightPct: pct, volPct: vol * 100, volContrib: contrib, assetType: assetTypeBySym[sym] ?? 'UNKNOWN' })
    }

    const rows: VRow[] = items
      .map(r => ({ ...r, volContribPct: totalContrib > 0 ? (r.volContrib / totalContrib) * 100 : 0 }))
      .sort((a, b) => b.volContribPct - a.volContribPct)
      .slice(0, 10)

    const classMap: Record<string, number> = {}
    for (const r of rows) classMap[r.assetType] = (classMap[r.assetType] ?? 0) + r.volContribPct
    const byClass = Object.entries(classMap).sort((a, b) => b[1] - a[1])

    return { rows, byClass }
  }, [data, pi.weights, portVol, assetTypeBySym])

  const volColor = portVol > 0.20 ? R : portVol > 0.15 ? A : G

  return (
    <Panel title="◈ Volatility Attribution" sub="Vol contribution by ticker · simplified Euler decomp" color={volColor}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 10 }}>
        <Stat label="Portfolio Vol (Annual)" value={`${(portVol * 100).toFixed(1)}%`} color={volColor} large metricId="vol_budget" />
        <Stat label="Top Vol Driver" value={rows[0]?.sym ?? '—'} color={R}
          sub={rows[0] ? `${rows[0].volContribPct.toFixed(0)}% of total risk` : 'no vol data'} />
      </div>

      {byClass.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4 }}>By Asset Class</div>
          {byClass.slice(0, 4).map(([cls, pct]) => (
            <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: M, minWidth: 108, textTransform: 'uppercase' }}>{cls}</span>
              <div style={{ flex: 1, height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: R, borderRadius: 0, opacity: 0.6 }} />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: R, minWidth: 34, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4, marginTop: 8 }}>Top Contributors</div>
      {rows.length === 0
        ? <div style={{ fontSize: 12, color: DIM, fontStyle: 'italic' }}>vol_30d_annual not available in snapshots.</div>
        : rows.slice(0, 6).map(r => (
          <div key={r.sym} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', minWidth: 52 }}>{r.sym}</span>
            <span style={{ fontSize: 12, color: M, minWidth: 38, textAlign: 'right' }}>{r.volPct.toFixed(1)}%σ</span>
            <div style={{ flex: 1, height: 3, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, r.volContribPct)}%`, height: '100%', background: R, borderRadius: 0, opacity: 0.6 }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: R, minWidth: 32, textAlign: 'right' }}>{r.volContribPct.toFixed(0)}%</span>
          </div>
        ))
      }
    </Panel>
  )
}
