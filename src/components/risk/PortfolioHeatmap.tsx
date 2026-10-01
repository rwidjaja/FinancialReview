import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts'
import { Panel, G, R, A, M, DIM, TECH_C } from './shared'
import type { DashboardData, IncomeAttribution } from '../../types/dashboard'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'

// ─── 8. PORTFOLIO HEATMAP ─────────────────────────────────────────────────────
// portfolio_vol_pct and vol_30d_annual are in percent form → divide by 100 for ratio math
export function PortfolioHeatmap({ data }: { data: DashboardData }) {
  const ia = data.income_analytics
  const pi = data.portfolio_intel

  const heatRows = useMemo(() => {
    const rawInc   = ia?.income_attribution
    const incAttrib: IncomeAttribution[] = Array.isArray(rawInc) ? rawInc : Object.values(rawInc ?? {})

    // portfolio_vol_pct is in percent (e.g. 22.9) → convert to decimal
    const portVol = (pi.portfolio_vol_pct ?? 15) / 100
    // pi.weights are PERCENT (server: portfolio_data.py:1929) — convert to
    // decimal for contribution math; display as percent directly.
    const weights = pi.weights ?? {}

    let portRet = 0
    for (const [sym, pct] of Object.entries(weights)) {
      const sn = data.snapshots[sym]
      if (sn) portRet += (pct / 100) * (sn.total_return_1y ?? 0)
    }

    const rows: { sym: string; weightPct: number; retContrib: number; riskContrib: number; incContrib: number }[] = []
    for (const [sym, pct] of Object.entries(weights)) {
      const sn  = data.snapshots[sym]
      const ret = sn?.total_return_1y ?? 0
      const vol = sn?.vol_30d_annual ?? portVol  // decimal, same unit as portVol
      const w   = pct / 100
      const rc  = portRet !== 0 ? (w * ret / portRet) * 100 : 0
      const rk  = portVol > 0 ? (w * vol / portVol) * 100 : 0
      const inc = incAttrib.find(a => a.symbol === sym)?.pct ?? 0
      const incPct = inc > 1 ? inc : inc * 100   // normalise pct field
      rows.push({ sym, weightPct: pct, retContrib: rc, riskContrib: rk, incContrib: incPct })
    }
    return rows.sort((a, b) => b.retContrib - a.retContrib).slice(0, 12)
  }, [data, ia, pi])

  const chartData = heatRows.map(r => ({
    name:   r.sym,
    return: Math.max(0, r.retContrib),
    risk:   Math.max(0, r.riskContrib),
    income: Math.max(0, r.incContrib),
  }))

  return (
    <Panel title="◈ Portfolio Heatmap" sub="Contribution to return · risk · income (top 12 holdings)" color={TECH_C}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 6 }}>Return vs Risk Contribution</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="name" tick={{ fill: M as string, fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: M as string, fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={v => `${(v as number).toFixed(0)}%`} width={28} />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                formatter={(v: unknown) => [`${(Number(v)).toFixed(1)}%`]}
              />
              <Bar dataKey="return" name="Return %" fill={G} opacity={0.7} radius={[2,2,0,0]}>
                {chartData.map((entry, i) => <Cell key={i} fill={entry.return > entry.risk ? G : R} />)}
              </Bar>
              <Bar dataKey="risk" name="Risk %" fill={R} opacity={0.5} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 6 }}>Contribution Detail</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ fontSize: 12, color: DIM, textAlign: 'left', paddingBottom: 4, fontWeight: 400 }}>SYM</th>
                <th style={{ fontSize: 12, color: G,   textAlign: 'right', paddingBottom: 4, fontWeight: 500 }}>RET%</th>
                <th style={{ fontSize: 12, color: R,   textAlign: 'right', paddingBottom: 4, fontWeight: 500 }}>RISK%</th>
                <th style={{ fontSize: 12, color: A,   textAlign: 'right', paddingBottom: 4, fontWeight: 500 }}>INC%</th>
              </tr>
            </thead>
            <tbody>
              {heatRows.slice(0, 8).map(r => (
                <tr key={r.sym}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', paddingBottom: 3 }}>{r.sym}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right', color: r.retContrib > r.riskContrib ? G : R }}>
                    {r.retContrib > 0 ? '+' : ''}{r.retContrib.toFixed(0)}%
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right', color: R }}>
                    {r.riskContrib.toFixed(0)}%
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right', color: r.incContrib > 0 ? A : DIM }}>
                    {r.incContrib > 0 ? `${r.incContrib.toFixed(0)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  )
}
