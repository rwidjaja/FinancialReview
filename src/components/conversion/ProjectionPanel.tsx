import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, Legend } from 'recharts'
import { fmtMoney } from '../../utils/formatters'
import type { DashboardData, ProjectionRow } from '../../types/dashboard'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'

const G = 'var(--green)'
const M = 'var(--text2)'
const R = 'var(--red)'
const A = 'var(--amber)'

type ProjScenario = 'conservative' | 'recommended' | 'aggressive'

const SCEN_META: Record<ProjScenario, { color: string; source: string; explain: (bracket: number) => string }> = {
  conservative: {
    color: G,
    source: 'Source: Input JSON (annual target)',
    explain: () => 'Your configured annual conversion target — plan logic only, no tax math.',
  },
  recommended: {
    color: A,
    source: 'Source: Selected tax bracket',
    explain: (b) => `min(annual target, bracket room − buffer) based on ${b}% ceiling.`,
  },
  aggressive: {
    color: R,
    source: 'Source: Selected tax bracket',
    explain: (b) => `Full bracket room with no safety buffer — converts up to the ${b}% ceiling.`,
  },
}

function ScenTile({ scen, amount, bracket, active, onClick }: {
  scen: ProjScenario; amount: number; bracket: number; active: boolean; onClick: () => void
}) {
  const { color, source, explain } = SCEN_META[scen]
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)',
      padding: '10px 12px',
      background: active ? 'var(--fd-card)' : 'var(--surface)',
      border: `1px solid ${active ? color : 'var(--fd-hairline)'}`,
      borderTop: `3px solid ${active ? color : 'var(--fd-hairline)'}`,
      borderRadius: 0, transition: 'border-color 0.15s',
      width: '100%',
    }}>
      <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 }}>
        {scen}
      </div>
      <div style={{ fontSize: 18, fontWeight: 500, color: active ? color : 'var(--text)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
        {fmtMoney(amount)}<span style={{ fontSize: 12, fontWeight: 400, color: M }}>/yr</span>
      </div>
      <div style={{ fontSize: 12, color: active ? color : M, fontWeight: 500, marginBottom: 2 }}>{source}</div>
      <div style={{ fontSize: 12, color: M, lineHeight: 1.4 }}>{explain(bracket)}</div>
    </button>
  )
}

export function ProjectionPanel({ tx, scenarios }: {
  tx: DashboardData['tax_data']
  scenarios: Record<ProjScenario, { label: string; amount: number; rows: ProjectionRow[] }>
}) {
  const [projScen, setProjScen] = useState<ProjScenario>('recommended')
  const activeScen = scenarios[projScen]
  const rows = activeScen.rows

  if (rows.length === 0) return <div style={{ padding: 16, color: M, fontSize: 12 }}>No projection data available.</div>

  const chartData = rows.map(r => ({
    year: r.year,
    Roth: Math.round(r.roth_value / 1000),
    Rollover: Math.round(r.rollover_value / 1000),
    EffRate: r.effective_rate,
  }))

  const depletionYear = rows.find(r => r.rollover_value <= 0)?.year
  const rothDominanceYear = rows.find((r, i) => i > 0 && rows[i - 1].roth_value <= rows[i - 1].rollover_value && r.roth_value > r.rollover_value)?.year
  const projRolloverStart = tx.proj_rollover_start ?? 0
  const projRothStart = tx.proj_roth_start ?? 0
  const bracket = tx?.target_bracket_rate ?? 24

  return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        {(['conservative', 'recommended', 'aggressive'] as ProjScenario[]).map(s => (
          <ScenTile key={s} scen={s} amount={scenarios[s].amount} bracket={bracket}
            active={projScen === s} onClick={() => setProjScen(s)} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
        <div style={{ padding: '8px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500 }}>Starting Rollover</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmtMoney(projRolloverStart)}</div>
        </div>
        <div style={{ padding: '8px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500 }}>Starting Roth</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoney(projRothStart)}</div>
        </div>
        <div style={{ padding: '8px', background: 'var(--surface)', border: `1px solid ${depletionYear ? G : 'var(--fd-hairline)'}`, borderRadius: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500 }}>Rollover Depletes</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: depletionYear ? G : M, fontFamily: 'var(--font-mono)' }}>
            {depletionYear ?? '> 15yr'}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>long-term model · step calendar may differ</div>
        </div>
        <div style={{ padding: '8px', background: 'var(--surface)', border: `1px solid ${rothDominanceYear ? G : 'var(--fd-hairline)'}`, borderRadius: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500 }}>Roth Dominance</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: rothDominanceYear ? G : M, fontFamily: 'var(--font-mono)' }}>
            {rothDominanceYear ?? '—'}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>yr Roth bal &gt; Rollover</div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 2 }}>ROTH vs ROLLOVER TRAJECTORY ($K)</div>
        <div style={{ fontSize: 12, color: M, marginBottom: 4, fontStyle: 'italic' }}>
          Chart shows conversion period only — long-term Roth growth (tax-free compounding) extends well beyond chart range
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <XAxis dataKey="year" tick={{ fill: 'var(--text2)', fontSize: 12 }} />
            <YAxis tick={{ fill: 'var(--text2)', fontSize: 12 }} />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
              formatter={(val: unknown, name: unknown) => [`$${val}K`, String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Roth" stroke={G} strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="Rollover" stroke={A} strokeWidth={1.5} dot={false} />
            {rothDominanceYear && <ReferenceLine x={rothDominanceYear} stroke={G} strokeDasharray="3 3" label={{ value: 'Roth>', fill: G, fontSize: 12 }} />}
          </LineChart>
        </ResponsiveContainer>
      </div>

    </div>
  )
}
