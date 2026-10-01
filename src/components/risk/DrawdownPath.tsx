import { useMemo } from 'react'
import { Panel, Stat, G, R, A, M, DIM, fmtK, fmtPct } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 13. DRAWDOWN PATH ────────────────────────────────────────────────────────
export function DrawdownPath({ data }: { data: DashboardData }) {
  const pi       = data.portfolio_intel
  const totalVal = data.summary.total_value

  const { portMaxDD, portRet, topContribs } = useMemo(() => {
    let portMaxDD = 0
    let portRet   = 0
    const items: { sym: string; contrib: number }[] = []
    // pi.weights are PERCENT (server: portfolio_data.py:1929). Use decimal
    // for weighted-avg math.
    const weights = pi.weights ?? {}
    for (const [sym, pct] of Object.entries(weights)) {
      const sn = data.snapshots[sym]
      const dd = sn?.max_drawdown_6m ?? 0
      const w  = pct / 100
      portMaxDD += w * dd
      portRet   += w * (sn?.total_return_1y ?? 0)
      if (dd < 0) items.push({ sym, contrib: w * Math.abs(dd) })
    }
    const totalContrib = items.reduce((s, x) => s + x.contrib, 0)
    return {
      portMaxDD,
      portRet,
      topContribs: items
        .map(r => ({ sym: r.sym, sharePct: totalContrib > 0 ? (r.contrib / totalContrib) * 100 : 0 }))
        .sort((a, b) => b.sharePct - a.sharePct)
        .slice(0, 5),
    }
  }, [data, pi.weights])

  const portVol       = (pi.portfolio_vol_pct ?? 15) / 100
  const ddAbs         = Math.abs(portMaxDD)
  // Recovery time estimate: drawdown / monthly return rate
  const monthlyRet    = Math.max(0.002, portRet / 12)                // floor at 0.2%/mo to avoid Inf
  void (ddAbs / monthlyRet)  // recovery rate computed but not displayed — removed per CFP review

  // Trough depth in dollars (what the portfolio would look like at the worst point)
  const troughVal     = totalVal * (1 + portMaxDD)
  const dollarDrop    = totalVal - troughVal

  // Severity bands
  const ddColor = ddAbs > 0.20 ? R : ddAbs > 0.10 ? A : G

  // Vol-implied forward risk (annual vol → potential 1-sigma drawdown range)
  const oneSigmaDD    = portVol * Math.sqrt(0.25)   // 3-month 1-sigma (annualVol × sqrt(0.25yr))

  return (
    <Panel title="◈ Drawdown Path" sub="6M max drawdown · vol-implied risk · attribution" color={ddColor}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 10 }}>
        <Stat label="6M Max Drawdown" value={fmtPct(portMaxDD * 100)} color={ddColor} large metricId="max_drawdown" />
        <Stat label="Peak-to-Trough" value={fmtK(-dollarDrop)} color={ddColor} large sub="estimated dollar drop" />
        <Stat label="1σ Forward Risk (3M)" value={fmtPct(-oneSigmaDD * 100)} color={A} sub="vol-implied downside" />
        <Stat label="Trough Value Est." value={fmtK(troughVal)} color={ddColor} sub="at worst 6M point" />
      </div>

      {topContribs.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 5 }}>Top DD Contributors (6M)</div>
          {topContribs.map(d => (
            <div key={d.sym} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', minWidth: 52 }}>{d.sym}</span>
              <div style={{ flex: 1, height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, d.sharePct)}%`, height: '100%', background: R, borderRadius: 0, opacity: 0.75 }} />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: R, minWidth: 36, textAlign: 'right' }}>
                {d.sharePct.toFixed(0)}%
              </span>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 12, color: DIM, marginTop: 8, fontStyle: 'italic' }}>
        Recovery estimate based on current portfolio return rate. Actual path depends on sequencing and future returns.
      </div>
    </Panel>
  )
}
