import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList,
} from 'recharts'
import type { DashboardData } from '../../types/dashboard'
import { G, R, A, M } from './DetailTab.constants'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'

export function PortfolioRiskBudget({ holdings, totalValue, data }: {
  holdings: { symbol: string; value: number; pnl: number; annualInc: number; cost: number }[]
  totalValue: number
  data: DashboardData
}) {
  const safeTotal = totalValue > 0 ? totalValue : 1

  const riskData = holdings.map(h => {
    const snap = data.snapshots[h.symbol]
    const vol = snap?.vol_30d_annual ?? 0.2 // default 20%
    const beta = snap?.beta ?? 1.0
    const weight = h.value / safeTotal
    // Risk contribution = weight × vol (simplified)
    const riskContrib = weight * vol * 100
    return {
      symbol: h.symbol,
      weight: parseFloat((weight * 100).toFixed(2)),
      vol: parseFloat((vol * 100).toFixed(1)),
      beta: parseFloat(beta.toFixed(2)),
      riskContrib: parseFloat(riskContrib.toFixed(3)),
      value: h.value,
    }
  }).sort((a, b) => b.riskContrib - a.riskContrib)

  // Average absolute off-diagonal correlation — tells us whether "13 holdings" is
  // genuinely diversified or just 13 highly correlated positions.
  const avgCorr = (() => {
    const m = data.correlation?.matrix ?? []
    const n = m.length
    if (n < 2) return 0
    let sum = 0, count = 0
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (i !== j) { sum += Math.abs(m[i]?.[j] ?? 0); count++ }
    return count > 0 ? sum / count : 0
  })()
  // Label: concentration-first, then correlation-aware.
  // Holding count alone is misleading in two ways:
  //   1. A single dominant holding (e.g. SMH at 78% of risk) is concentrated regardless
  //      of how many other names are in the portfolio.
  //   2. When most positions are correlated (QQQI, QQQM, XLK, SMH all ≥0.8), count is also misleading.
  // Check for single-name dominance first, then fall through to correlation / count logic.
  const totalRisk = riskData.reduce((s, d) => s + d.riskContrib, 0)
  const topRiskPct = totalRisk > 0 ? (riskData[0]?.riskContrib ?? 0) / totalRisk : 0
  const topSym = riskData[0]?.symbol ?? ''

  const diversLabel = topRiskPct > 0.50
    ? `HIGH CONCENTRATION (${topSym})`
    : avgCorr >= 0.70 ? 'HIGH CORRELATION'
    : avgCorr >= 0.50 ? 'MOD. CORRELATION'
    : riskData.length >= 8 ? 'WELL DIVERSIFIED'
    : riskData.length >= 5 ? 'MODERATE'
    : 'CONCENTRATED'
  const diversColor = topRiskPct > 0.50 ? R
    : avgCorr >= 0.70 ? R
    : avgCorr >= 0.50 ? A
    : riskData.length >= 8 ? G
    : riskData.length >= 5 ? A
    : R

  void Math.max(...riskData.map(d => d.riskContrib), 0.1) // reserved for future use

  // Weighted portfolio beta
  const wBeta = riskData.reduce((s, d) => s + (d.weight / 100) * d.beta, 0)
  // Weighted portfolio vol
  const wVol = riskData.reduce((s, d) => s + (d.weight / 100) * d.vol, 0)

  const volMeter = [
    { label: 'LOW', max: 12, color: G },
    { label: 'NORMAL', max: 20, color: 'var(--yellow)' },
    { label: 'HIGH', max: 35, color: A },
    { label: 'EXTREME', max: 9999, color: R },
  ]
  const volTierIdx = volMeter.findIndex(t => wVol < t.max)

  const chartData = riskData.slice(0, 12)
  const absMax = Math.max(...chartData.map(d => d.riskContrib), 0.1)

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* Portfolio summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 10 }}>
        <div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>WEIGHTED BETA</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: wBeta > 1.3 ? R : wBeta > 1.0 ? A : G, fontFamily: 'var(--font-mono)' }}>
            {wBeta.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{wBeta > 1.3 ? 'HIGH MARKET SENS.' : wBeta > 1.0 ? 'ABOVE MARKET' : 'DEFENSIVE'}</div>
        </div>
        <div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>WEIGHTED VOL</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: volMeter[volTierIdx]?.color ?? R, fontFamily: 'var(--font-mono)' }}>
            {wVol.toFixed(1)}%
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{volMeter[volTierIdx]?.label} REGIME</div>
        </div>
        <div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>TOP RISK DRIVER</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: A, fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            {riskData[0]?.symbol ?? '—'}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
            {totalRisk > 0 ? `${((riskData[0]?.riskContrib ?? 0) / totalRisk * 100).toFixed(0)}% of portfolio risk` : ''}
          </div>
        </div>
        <div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>DIVERSIFICATION</div>
          <div style={{ fontSize: 20, fontWeight: 500, fontFamily: 'var(--font-mono)', color: diversColor }}>
            {riskData.length}
          </div>
          <div style={{ fontSize: 12, color: diversColor, marginTop: 2, fontWeight: 500 }}>holdings · {diversLabel}</div>
          {avgCorr > 0 && (
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>avg corr {avgCorr.toFixed(2)}</div>
          )}
        </div>
      </div>

      {/* Risk contribution bar chart */}
      <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>
        RISK CONTRIBUTION BY SYMBOL (WEIGHT × VOL)
      </div>
      <ResponsiveContainer width="100%" height={Math.max(chartData.length * 24, 100)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 80, bottom: 2, left: 52 }}>
          <XAxis
            type="number"
            domain={[0, absMax * 1.15]}
            tick={{ fill: 'var(--text2)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={v => `${v.toFixed(1)}`}
          />
          <YAxis
            type="category"
            dataKey="symbol"
            tick={{ fill: 'var(--text)', fontSize: 12, fontWeight: 500, fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
            width={50}
            interval={0}
          />
          <Tooltip
            formatter={(v: unknown) => [`${Number(v).toFixed(3)}`, 'Risk Contribution']}
            contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS}
            cursor={TOOLTIP_CURSOR}
          />
          <Bar dataKey="riskContrib" maxBarSize={14} radius={[0, 2, 2, 0]}>
            {chartData.map((d, i) => {
              const pctOfTotal = totalRisk > 0 ? d.riskContrib / totalRisk : 0
              const fill = pctOfTotal > 0.3 ? R : pctOfTotal > 0.2 ? A : i === 0 ? A : 'var(--blue)'
              return <Cell key={d.symbol} fill={fill} fillOpacity={0.85} />
            })}
            <LabelList
              dataKey="riskContrib"
              position="right"
              style={{ fill: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }}
              formatter={(v: unknown) => `${Number(v).toFixed(2)}`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: M, fontStyle: 'italic', marginTop: 4 }}>
        * Risk contribution = portfolio weight × 30-day annualized vol. Beta from snapshot data.
      </div>
    </div>
  )
}
