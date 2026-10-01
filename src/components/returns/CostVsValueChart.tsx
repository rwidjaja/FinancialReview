import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts'
import { fmtMoneyFull, fmtPct } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_CURSOR } from '../ui/chartTooltip'

const G = 'var(--green)'
const R = 'var(--red)'
const M = 'var(--text2)'

export function CostVsValueChart({ data }: { data: DashboardData }) {
  const accounts = data.accounts.filter(a => a.value > 0)
  if (accounts.length === 0) return null

  const chartData = accounts.map(a => ({
    name: a.label.length > 18 ? a.label.slice(0, 16) + '…' : a.label,
    fullName: a.label,
    Cost: Math.round(a.cost),
    Value: Math.round(a.value),
    pnl: a.pnl,
    pnl_pct: a.pnl_pct,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload as typeof chartData[0]
    return (
      <div style={TOOLTIP_STYLE}>
        <div style={TOOLTIP_LABEL_STYLE}>{d.fullName}</div>
        <div style={{ color: M }}>Cost Basis: {fmtMoneyFull(d.Cost)}</div>
        <div style={{ color: d.pnl >= 0 ? G : R, fontWeight: 500 }}>Value: {fmtMoneyFull(d.Value)}</div>
        <div style={{ color: d.pnl >= 0 ? G : R }}>
          P&L: {d.pnl >= 0 ? '+' : ''}{fmtMoneyFull(d.pnl)} ({fmtPct(d.pnl_pct)})
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 12px' }}>
      <ResponsiveContainer width="100%" height={Math.max(accounts.length * 52 + 40, 160)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 100, bottom: 4, left: 120 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: 'var(--text2)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: 'var(--text)', fontSize: 12, fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
            width={118}
          />
          <Tooltip content={customTooltip} cursor={TOOLTIP_CURSOR} />
          <Bar dataKey="Cost" fill="var(--fd-card)" radius={[0, 2, 2, 0]} maxBarSize={14} name="Cost Basis" />
          <Bar dataKey="Value" radius={[0, 2, 2, 0]} maxBarSize={14} name="Current Value">
            {chartData.map(d => (
              <Cell key={d.name} fill={d.pnl >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)'} fillOpacity={0.85} />
            ))}
            <LabelList
              dataKey="Value"
              position="right"
              style={{ fill: 'var(--text)', fontSize: 12, fontFamily: 'monospace' }}
              formatter={(v: unknown) => fmtMoneyFull(Number(v))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: M, marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 3, background: 'var(--fd-accent)' }} />
          <span>Cost Basis</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 3, background: G }} />
          <span>Value (Gain)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 3, background: R }} />
          <span>Value (Loss)</span>
        </div>
      </div>
    </div>
  )
}
