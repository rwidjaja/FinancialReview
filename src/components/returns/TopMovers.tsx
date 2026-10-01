import { useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList,
} from 'recharts'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_CURSOR } from '../ui/chartTooltip'

const G = 'var(--green)'
const R = 'var(--red)'
const M = 'var(--text2)'

export function TopMovers({ data, perfData, period, totalValue }: {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
  totalValue: number
}) {
  const { winners, losers, chartData, absMax } = useMemo(() => {
    const posWeights: Record<string, number> = {}
    for (const acct of data.accounts)
      for (const pos of acct.positions)
        posWeights[pos.symbol] = (posWeights[pos.symbol] ?? 0) + pos.value

    const ranked = data.decisions
      .map(d => ({ symbol: d.symbol, pd: perfData[d.symbol]?.[period] }))
      .filter(r => r.pd && typeof r.pd.total_return === 'number' && !isNaN(r.pd.total_return))
      .sort((a, b) => (b.pd?.total_return ?? 0) - (a.pd?.total_return ?? 0))

    const winners = ranked.filter(r => (r.pd?.total_return ?? 0) >= 0)
    const losers = ranked.filter(r => (r.pd?.total_return ?? 0) < 0).reverse()

    const chartData = ranked.map(r => {
      const safeReturn = r.pd?.total_return ?? 0
      const weight = (posWeights[r.symbol] ?? 0) / totalValue * 100
      return {
        symbol: r.symbol,
        return: parseFloat(safeReturn.toFixed(2)),
        weight: parseFloat((isNaN(weight) ? 0 : weight).toFixed(1)),
      }
    })

    const absMax = chartData.length > 0 ? Math.max(...chartData.map(d => Math.abs(d.return)), 0.1) : 0.1
    return { ranked, winners, losers, chartData, absMax }
  }, [data.accounts, data.decisions, perfData, period, totalValue])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload as typeof chartData[0]
    if (!d) return null;

    return (
      <div style={TOOLTIP_STYLE}>
        <div style={TOOLTIP_LABEL_STYLE}>{d.symbol}</div>
        <div style={{ color: d.return >= 0 ? G : R, fontWeight: 500 }}>
          {d.return >= 0 ? '+' : ''}{d.return.toFixed(2)}%
        </div>
        <div style={{ color: M, fontSize: 12 }}>Weight: {d.weight.toFixed(1)}%</div>
      </div>
    )
  }

  // Safe formatter function for labels
  const formatReturnLabel = (v: unknown): string => {
    const num = Number(v);
    if (isNaN(num)) return '0.00%';
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  };

  // Safe formatter for X axis
  const formatXAxisTick = (v: number): string => {
    if (isNaN(v)) return '0.0%';
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  };

  if (chartData.length === 0) {
    return (
      <div style={{ padding: '10px 12px', color: M, fontSize: 12 }}>
        No performance data available for the selected period.
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 12px' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12, color: M }}>
        <span style={{ color: G }}>▲ {winners.length} WINNERS</span>
        <span style={{ color: R }}>▼ {losers.length} LAGGARDS</span>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(chartData.length * 28, 120)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 80, bottom: 2, left: 52 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={[-absMax * 1.1, absMax * 1.1]}
            tick={{ fill: 'var(--text2)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={formatXAxisTick}
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
          <Bar dataKey="return" radius={[0, 2, 2, 0]} maxBarSize={18}>
            {chartData.map(d => (
              <Cell
                key={d.symbol}
                fill={d.return >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)'}
                fillOpacity={0.85}
              />
            ))}
            <LabelList
              dataKey="return"
              position="right"
              style={{ fill: 'var(--text)', fontSize: 12, fontFamily: 'monospace', fontWeight: 500 }}
              formatter={formatReturnLabel}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
