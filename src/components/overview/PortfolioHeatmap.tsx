import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import type { DashboardData } from '../../types/dashboard'

const M = 'var(--text2)'

// ─── Portfolio composition pie chart ──────────────────────────────────────────
export function PortfolioHeatmap({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel
  if (!pi) return null
  const segments = [
    { label: 'Growth',    value: pi.tech_growth_pct ?? 0, color: 'var(--fd-accent)' },
    { label: 'Income',    value: pi.income_pct ?? 0,      color: 'var(--fd-accent)' },
    { label: 'Defensive', value: pi.defensive_pct ?? 0,   color: 'var(--fd-ink)' },
  ].filter(s => s.value > 0)
  if (segments.length === 0) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }: any) => {
    if (value < 5) return null
    const RADIAN = Math.PI / 180
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="var(--fd-card)" textAnchor="middle" dominantBaseline="central"
        fontSize={10} fontWeight={700} fontFamily="monospace">
        {`${value.toFixed(0)}%`}
      </text>
    )
  }

  return (
    <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>
        ◈ PORTFOLIO COMPOSITION
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ResponsiveContainer width={110} height={110}>
          <PieChart>
            <Pie data={segments} cx="50%" cy="50%" innerRadius={28} outerRadius={50}
              dataKey="value" labelLine={false} label={renderLabel}>
              {segments.map((s, i) => <Cell key={i} fill={s.color} fillOpacity={0.85} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {segments.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, background: s.color, borderRadius: 0, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text)' }}>
                {s.label}
              </span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: s.color, fontWeight: 500 }}>
                {s.value.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
