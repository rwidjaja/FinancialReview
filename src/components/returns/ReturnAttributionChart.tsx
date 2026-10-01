import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ReferenceLine, LabelList,
} from 'recharts'
import { gainColor } from '../../utils/formatters'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_CURSOR } from '../ui/chartTooltip'

const G = 'var(--green)'
const R = 'var(--red)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'

export function ReturnAttributionChart({ data, perfData, period, totalValue }: {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
  totalValue: number
}) {
  const posValues: Record<string, number> = {}
  for (const acct of data.accounts) {
    for (const pos of acct.positions) {
      posValues[pos.symbol] = (posValues[pos.symbol] ?? 0) + pos.value
    }
  }
  const safeTotal = totalValue > 0 ? totalValue : 1

  const chartData = data.decisions
    .map(d => {
      const pd = perfData[d.symbol]?.[period]
      if (!pd) return null
      const w = (posValues[d.symbol] ?? 0) / safeTotal
      return {
        symbol: d.symbol,
        contrib: parseFloat((w * pd.total_return).toFixed(3)),
        ret: pd.total_return,
        weight: parseFloat((w * 100).toFixed(1)),
        sharpe: pd.sharpe,
      }
    })
    .filter((d): d is NonNullable<typeof d> => d !== null && d.weight > 0)
    .sort((a, b) => b.contrib - a.contrib)

  if (chartData.length === 0) return (
    <div style={{ padding: '16px', color: M, fontSize: 12 }}>No return attribution data for the selected period.</div>
  )

  const absMax = Math.max(...chartData.map(d => Math.abs(d.contrib)), 0.1)
  const totalContrib = chartData.reduce((s, d) => s + d.contrib, 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload as typeof chartData[0]
    return (
      <div style={TOOLTIP_STYLE}>
        <div style={TOOLTIP_LABEL_STYLE}>{d.symbol}</div>
        <div style={{ color: M, fontSize: 12 }}>Weight: {d.weight.toFixed(1)}%</div>
        <div style={{ color: d.ret >= 0 ? G : R }}>Return: {d.ret >= 0 ? '+' : ''}{d.ret.toFixed(2)}%</div>
        <div style={{ color: d.contrib >= 0 ? G : R, fontWeight: 500 }}>
          Contribution: {d.contrib >= 0 ? '+' : ''}{d.contrib.toFixed(3)}%
        </div>
        <div style={{ color: M, fontSize: 12, marginTop: 2 }}>
          Sharpe: <span style={{ color: d.sharpe >= 1 ? G : d.sharpe >= 0.5 ? Y : R }}>{d.sharpe.toFixed(2)}</span>
        </div>
      </div>
    )
  }

  const winners = chartData.filter(d => d.contrib >= 0)
  const losers  = chartData.filter(d => d.contrib <  0)

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          WEIGHTED CONTRIBUTION BY SYMBOL · {period.toUpperCase()}
        </span>
        <span style={{ fontSize: 12, color: G }}>▲ {winners.length} positive</span>
        <span style={{ fontSize: 12, color: R }}>▼ {losers.length} drag</span>
        <span style={{ fontSize: 12, color: M }}>
          Total: <span style={{ color: gainColor(totalContrib), fontWeight: 500 }}>
            {totalContrib >= 0 ? '+' : ''}{totalContrib.toFixed(3)}%
          </span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(chartData.length * 26, 100)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 90, bottom: 2, left: 52 }}>
          <XAxis
            type="number"
            domain={[-absMax * 1.2, absMax * 1.2]}
            tick={{ fill: 'var(--text2)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
          />
          <YAxis
            type="category"
            dataKey="symbol"
            tick={{ fill: 'var(--text)', fontSize: 12, fontWeight: 500, fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <ReferenceLine x={0} stroke="var(--fd-hairline)" />
          <Tooltip content={customTooltip} cursor={TOOLTIP_CURSOR} />
          <Bar dataKey="contrib" maxBarSize={16}>
            {chartData.map(d => (
              <Cell key={d.symbol} fill={d.contrib >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)'} fillOpacity={0.85} />
            ))}
            <LabelList
              dataKey="contrib"
              position="right"
              style={{ fill: 'var(--text)', fontSize: 12, fontFamily: 'monospace', fontWeight: 500 }}
              formatter={(v: unknown) => { const n = Number(v); return `${n >= 0 ? '+' : ''}${n.toFixed(3)}%` }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
