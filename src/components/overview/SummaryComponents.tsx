import { Treemap, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { gainColor } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const A = 'var(--amber)'
const M = 'var(--text2)'

export function MarketStrip({ data }: { data: DashboardData }) {
  const mc = data.market_context
  const pi = data.portfolio_intel
  if (!mc) return null
  const sp = mc['S&P 500']
  const dow = mc['Dow Jones']
  const vix = data.vix_current
  const vixColor = vix == null ? M : vix > 25 ? 'var(--red)' : vix > 18 ? A : vix < 14 ? 'var(--blue)' : G
  const regimeColor = pi?.market_regime === 'EXPANSION' ? G : pi?.market_regime === 'RISK-OFF' ? 'var(--red)' : 'var(--yellow)'

  type Item = { label: string; value: string; color: string }
  const items: Item[] = [
    sp ? { label: 'S&P', value: `${sp.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}  ${sp.momentum_20d >= 0 ? '+' : ''}${(sp.momentum_20d * 100).toFixed(1)}% 20D`, color: gainColor(sp.momentum_20d) } : null,
    dow ? { label: 'DOW', value: `${dow.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}  ${dow.momentum_20d >= 0 ? '+' : ''}${(dow.momentum_20d * 100).toFixed(1)}% 20D`, color: gainColor(dow.momentum_20d) } : null,
    vix != null ? { label: 'VIX', value: `${vix.toFixed(1)}  ${vix < 18 ? 'Healthy' : vix < 25 ? 'Elevated' : 'Stressed'}`, color: vixColor } : null,
    pi?.market_regime ? { label: 'REGIME', value: pi.market_regime, color: regimeColor } : null,
    pi?.positioning ? { label: 'POSITIONING', value: pi.positioning, color: pi.positioning === 'AGGRESSIVE' ? 'var(--red)' : pi.positioning === 'CONSERVATIVE' ? G : 'var(--yellow)' } : null,
  ].filter((x): x is Item => x != null)

  if (items.length === 0) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', height: 26,
      background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
      borderRadius: 0, overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{
        padding: '0 10px', fontSize: 12, fontWeight: 500, color: M,
        borderRight: '1px solid var(--border2)', whiteSpace: 'nowrap',
        display: 'flex', alignItems: 'center',
      }}>
        MARKET
      </div>
      {items.map((item, i) => (
        <div key={i} style={{
          padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
          borderRight: i < items.length - 1 ? '1px solid var(--border2)' : 'none',
        }}>
          <span style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase' }}>{item.label}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: item.color, fontFamily: 'var(--font-mono)' }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}

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

// @ts-ignore
function MapTreemap({ title, treeData, uniqueKeyField = 'name' }: {
  title: string
  treeData: { name: string; size: number; pct: string; fill: string; sub?: string; uniqueKey?: string }[]
  uniqueKeyField?: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomContent = (props: any) => {
    const { x, y, width, height, name, pct, fill, sub } = props as {
      x: number; y: number; width: number; height: number
      name: string; pct: string; fill: string; sub?: string
    }
    if (width < 20 || height < 16) return <g />
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.78} stroke="var(--bg)" strokeWidth={2} />
        {width > 48 && height > 30 && (
          <>
            <text x={x + width / 2} y={y + height / 2 - (sub ? 8 : 4)} textAnchor="middle" fill="var(--fd-card)"
              fontSize={Math.min(12, width / 5)} fontWeight="bold" fontFamily="monospace">{name}</text>
            <text x={x + width / 2} y={y + height / 2 + 8} textAnchor="middle" fill="var(--fd-hairline)"
              fontSize={Math.min(9, width / 7)} fontFamily="monospace">{pct}%</text>
            {sub && (
              <text x={x + width / 2} y={y + height / 2 + 19} textAnchor="middle" fill="var(--fd-hairline)"
                fontSize={7} fontFamily="monospace">{sub}</text>
            )}
          </>
        )}
        {(width <= 48 || height <= 30) && width > 22 && height > 16 && (
          <text x={x + width / 2} y={y + height / 2 + 4} textAnchor="middle"
            fill="var(--fd-card)" fontSize={8} fontWeight="bold" fontFamily="monospace">{name}</text>
        )}
      </g>
    )
  }

  return (
    <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <Treemap data={treeData} dataKey="size" content={<CustomContent />} />
      </ResponsiveContainer>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {treeData.slice(0, 10).map((d, idx) => (
          <div key={d.uniqueKey || `${d.name}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <div style={{ width: 8, height: 8, background: d.fill, opacity: 0.85, borderRadius: 0, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{d.name}</span>
            <span style={{ color: M }}>{d.pct}%</span>
            {d.sub && <span style={{ color: 'var(--text3)', fontSize: 12 }}>{d.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function SleeveMap({ label, color, acctValue, positions, targetVsActual, isRoth }: {
  label: string
  color: string
  acctValue: number
  positions: { symbol: string; value: number }[]
  targetVsActual: { symbol: string; target_pct: number; actual_pct: number; delta_pct: number }[]
  isRoth: boolean
}) {
  const deltaMap: Record<string, number> = {}
  for (const t of targetVsActual) deltaMap[t.symbol] = t.delta_pct

  const onC  = isRoth ? 'var(--fd-lime-ink)' : 'var(--fd-accent)'
  const overC = isRoth ? 'var(--fd-ink)' : 'var(--fd-lilac-ink)'
  const undC  = isRoth ? 'var(--fd-lilac-ink)' : 'var(--fd-accent)'

  const currentData = positions
    .filter(p => p.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((p, idx) => {
      const pct = acctValue > 0 ? p.value / acctValue * 100 : 0
      const delta = deltaMap[p.symbol]
      const fill = delta == null ? 'var(--fd-muted)' : Math.abs(delta) < 2 ? onC : delta > 0 ? overC : undC
      return {
        name: p.symbol,
        uniqueKey: `cur-${label}-${p.symbol}-${idx}`,
        size: Math.round(p.value),
        pct: pct.toFixed(1),
        fill,
        sub: delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs tgt` : undefined,
      }
    })

  const targetData = targetVsActual
    .filter(t => t.target_pct > 0)
    .sort((a, b) => b.target_pct - a.target_pct)
    .map((t, idx) => {
      const delta = t.delta_pct
      const fill = Math.abs(delta) < 2 ? onC : delta > 0 ? overC : undC
      return {
        name: t.symbol,
        uniqueKey: `tgt-${label}-${t.symbol}-${idx}`,
        size: Math.round(t.target_pct * 100),
        pct: t.target_pct.toFixed(1),
        fill,
        sub: `now ${t.actual_pct.toFixed(1)}%`,
      }
    })

  const legend = [
    { color: onC,  label: 'On target (±2%)' },
    { color: overC, label: 'Over target' },
    { color: undC,  label: 'Under target' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ padding: '4px 12px', background: 'var(--surface)', border: `1px solid var(--border2)`, borderTop: `2px solid ${color}` }}>
        <div style={{ fontSize: 12, fontWeight: 500, color, textTransform: 'uppercase', letterSpacing: '1px' }}>
          {label}
        </div>
        {acctValue > 0 && (
          <div style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)' }}>
            ${(acctValue / 1000).toFixed(0)}K sleeve total
          </div>
        )}
      </div>
      <MapTreemap title="CURRENT HOLDINGS (% of sleeve)" treeData={currentData} uniqueKeyField="uniqueKey" />
      <MapTreemap title="TARGET ALLOCATION (% of sleeve)" treeData={targetData} uniqueKeyField="uniqueKey" />
      <div style={{ display: 'flex', gap: 8, paddingLeft: 12, flexWrap: 'wrap' }}>
        {legend.map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: M }}>
            <div style={{ width: 8, height: 8, background: l.color, borderRadius: 0, opacity: 0.85 }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CrossSleeveMismatch({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel
  const taxableTargets = pi?.taxable_target_vs_actual ?? []
  const rothTargets    = pi?.roth_target_vs_actual    ?? []

  const crossSleeveRows = rothTargets
    .filter(r => r.target_pct > 0)
    .map(r => {
      const taxRow = taxableTargets.find(t => t.symbol === r.symbol)
      if (!taxRow || taxRow.actual_pct === 0) return null
      return { symbol: r.symbol, taxActual: taxRow.actual_pct, rothTarget: r.target_pct, rothActual: r.actual_pct }
    })
    .filter(Boolean) as { symbol: string; taxActual: number; rothTarget: number; rothActual: number }[]

  if (crossSleeveRows.length === 0) return null

  return (
    <div style={{ padding: '6px 12px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
      <div style={{ color: 'var(--fd-ink)', fontWeight: 500, letterSpacing: '0.8px', marginBottom: 4 }}> CROSS-SLEEVE MISMATCH — held in Taxable, targeted in Roth</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {crossSleeveRows.map(r => (
          <div key={r.symbol} style={{ display: 'flex', gap: 8, color: 'var(--text2)' }}>
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>{r.symbol}</span>
            <span>Tax: <span style={{ color: 'var(--fd-ink)' }}>{r.taxActual.toFixed(1)}%</span></span>
            <span>Roth: <span style={{ color: 'var(--fd-lilac-ink)' }}>{r.rothActual.toFixed(1)}%</span> / tgt <span style={{ color: 'var(--fd-lime-ink)' }}>{r.rothTarget.toFixed(1)}%</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}
