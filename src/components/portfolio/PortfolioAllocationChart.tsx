import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, LabelList,
} from 'recharts'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_CURSOR } from '../ui/chartTooltip'
import { G, R, A, M } from './DetailTab.constants'

export function PortfolioAllocationChart({ holdings, totalValue, data }: {
  holdings: { symbol: string; value: number; annualInc: number; pnl: number; cost: number }[]
  totalValue: number
  data: DashboardData
}) {
  const safeTotal = totalValue > 0 ? totalValue : 1

  // Show ALL holdings, no filtering
  const chartData = holdings.map(h => {
    const pct = (h.value / safeTotal) * 100
    const dec = data.decisions?.find(d => d.symbol === h.symbol)
    return {
      symbol: h.symbol,
      portPct: parseFloat(pct.toFixed(2)),
      value: h.value,
      annualInc: h.annualInc,
      pnl: h.pnl,
      status: dec?.structural_status ?? '',
    }
  })

  if (chartData.length === 0) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
          ◈ WEIGHT ALLOCATION — BAR
        </div>
        <div style={{ padding: '20px', textAlign: 'center', color: M, fontSize: 12 }}>
          No allocation data available
        </div>
      </div>
    )
  }

  const statusColors: Record<string, string> = {
    ENGINE_HEALTHY: G,
    VALUATION_STRETCHED: 'var(--yellow)',
    INCOME_COMPRESSION: A,
    STRUCTURAL_BREAKDOWN: R,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload as typeof chartData[0]
    return (
      <div style={TOOLTIP_STYLE}>
        <div style={TOOLTIP_LABEL_STYLE}>{d.symbol}</div>
        <div style={{ color: A }}>{d.portPct.toFixed(1)}% of portfolio</div>
        <div style={{ color: M }}>Value: {fmtMoneyFull(d.value)}</div>
        <div style={{ color: G }}>Annual Inc: {fmtMoney(d.annualInc)}</div>
        <div style={{ color: d.pnl >= 0 ? G : R }}>P&L: {d.pnl >= 0 ? '+' : ''}{fmtMoneyFull(d.pnl)}</div>
      </div>
    )
  }

  const maxPct = Math.max(...chartData.map(d => d.portPct), 20)
  const barHeight = Math.max(chartData.length * 24, 120)

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
        ◈ WEIGHT ALLOCATION — BAR ({chartData.length} holdings)
      </div>
      <ResponsiveContainer width="100%" height={barHeight}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 80, bottom: 2, left: 52 }}>
          <XAxis
            type="number"
            domain={[0, maxPct]}
            tick={{ fill: 'var(--text2)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={v => `${Number(v).toFixed(0)}%`}
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
          <ReferenceLine x={10} stroke="var(--fd-hairline)" strokeDasharray="4 3" />
          <ReferenceLine x={20} stroke="var(--fd-hairline)" strokeDasharray="4 3" />
          <Tooltip content={customTooltip} cursor={TOOLTIP_CURSOR} />
          <Bar dataKey="portPct" maxBarSize={16} radius={[0, 2, 2, 0]}>
            {chartData.map(d => (
              <Cell
                key={d.symbol}
                fill={statusColors[d.status] ?? A}
                fillOpacity={0.85}
              />
            ))}
            <LabelList
              dataKey="portPct"
              position="right"
              style={{ fill: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }}
              formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: M, marginTop: 8, flexWrap: 'wrap' }}>
        <span><span style={{ color: 'var(--fd-ink)' }}>┈</span> 10% warning</span>
        <span><span style={{ color: 'var(--fd-negative)' }}>┈</span> 20% concentration</span>
        <span><span style={{ color: G }}>■</span> Healthy</span>
        <span><span style={{ color: 'var(--yellow)' }}>■</span> Stretched</span>
        <span><span style={{ color: R }}>■</span> Breakdown</span>
      </div>
    </div>
  )
}
