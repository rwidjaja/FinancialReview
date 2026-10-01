import { useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, LabelList,
} from 'recharts'
import { MiniBar } from '../ui/Sparkline'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import { fmtMoneyFull } from '../../utils/formatters'
import { STRESS_MARKET_CRASH_PCT, STRESS_VIX_SPIKE_VOL_FACTOR, STRESS_TOP_HOLDING_DROP_PCT,
         STRESS_RATE_SHOCK_VOL_FACTOR, BETA_VOL_DIVISOR, BETA_MAX_CAP } from '../../utils/constants'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'

const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'

export function StressScenarioPanel({ data, perfData, period, totalValue }: {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
  totalValue: number
}) {
  const { scenarios, chartData } = useMemo(() => {
    const posValues: Record<string, number> = {}
    for (const acct of data.accounts)
      for (const pos of acct.positions)
        posValues[pos.symbol] = (posValues[pos.symbol] ?? 0) + pos.value
    const safeTotal = totalValue > 0 ? totalValue : 1

    // Fragility amplifier: fragility >= 70 adds 10–25% uplift to stress impacts.
    // Source: portfolio_intel.fragility_score (0–100). No amplification below 50.
    const FRAGILITY_HIGH = 70
    const FRAGILITY_ELEVATED = 60
    const FRAGILITY_MODERATE = 50
    const FRAG_AMP_HIGH = 1.20
    const FRAG_AMP_ELEVATED = 1.12
    const FRAG_AMP_MODERATE = 1.06
    const fragScore = data.portfolio_intel?.fragility_score ?? 0
    const fragAmplifier = fragScore >= FRAGILITY_HIGH ? FRAG_AMP_HIGH
                        : fragScore >= FRAGILITY_ELEVATED ? FRAG_AMP_ELEVATED
                        : fragScore >= FRAGILITY_MODERATE ? FRAG_AMP_MODERATE
                        : 1.0

    const holdings = data.decisions.map(d => {
      const pd = perfData[d.symbol]?.[period]
      const w = (posValues[d.symbol] ?? 0) / safeTotal
      const vol = pd?.vol_annual ?? 20
      const approxBeta = Math.min(vol / BETA_VOL_DIVISOR, BETA_MAX_CAP)
      return { symbol: d.symbol, weight: w, vol, approxBeta, value: posValues[d.symbol] ?? 0 }
    }).filter(h => h.weight > 0)

    const topHolding = [...holdings].sort((a, b) => b.weight - a.weight)[0]

    const scenarios = [
      {
        name: 'MARKET CRASH',
        detail: `S&P 500 drops −${STRESS_MARKET_CRASH_PCT}%${fragScore >= FRAGILITY_ELEVATED ? ` · fragility ×${fragAmplifier.toFixed(2)}` : ''}`,
        color: R,
        pct:    holdings.reduce((s, h) => s + h.weight * (-STRESS_MARKET_CRASH_PCT * h.approxBeta), 0) * fragAmplifier,
        dollar: holdings.reduce((s, h) => s + h.value  * (-(STRESS_MARKET_CRASH_PCT / 100) * h.approxBeta), 0) * fragAmplifier,
      },
      {
        name: 'VIX SPIKE ×2',
        detail: `Volatility doubles → VIX 30${fragScore >= FRAGILITY_ELEVATED ? ` · fragility ×${fragAmplifier.toFixed(2)}` : ''}`,
        color: A,
        pct:    holdings.reduce((s, h) => s + h.weight * (-h.vol * STRESS_VIX_SPIKE_VOL_FACTOR), 0) * fragAmplifier,
        dollar: holdings.reduce((s, h) => s + h.value  * (-h.vol / 100 * STRESS_VIX_SPIKE_VOL_FACTOR), 0) * fragAmplifier,
      },
      {
        name: `TOP HOLDING −${STRESS_TOP_HOLDING_DROP_PCT}%`,
        detail: (() => {
          const sym = topHolding?.symbol ?? 'N/A'
          const vol = topHolding?.vol ?? 0
          const sigmas = vol > 0 ? (STRESS_TOP_HOLDING_DROP_PCT / vol).toFixed(1) : null
          const fragNote = fragScore >= FRAGILITY_ELEVATED ? ` · fragility ×${fragAmplifier.toFixed(2)}` : ''
          const volNote = sigmas != null ? ` · ~${sigmas}σ move (not extreme at ${vol.toFixed(0)}% vol)` : ''
          return `${sym} drops ${STRESS_TOP_HOLDING_DROP_PCT}%${volNote}${fragNote}`
        })(),
        color: Y,
        pct:    topHolding ? topHolding.weight * (-STRESS_TOP_HOLDING_DROP_PCT) * fragAmplifier : 0,
        dollar: topHolding ? topHolding.value  * (-(STRESS_TOP_HOLDING_DROP_PCT / 100)) * fragAmplifier : 0,
      },
      {
        name: 'RATE SHOCK +200bps',
        detail: 'Interest rates rise sharply',
        color: 'var(--blue)',
        pct:    holdings.reduce((s, h) => s + h.weight * (-h.vol * STRESS_RATE_SHOCK_VOL_FACTOR), 0),
        dollar: holdings.reduce((s, h) => s + h.value  * (-h.vol / 100 * STRESS_RATE_SHOCK_VOL_FACTOR), 0),
      },
    ]

    const chartData = scenarios.map(s => ({ name: s.name, impact: parseFloat(Math.abs(s.pct).toFixed(2)), raw: s.pct }))
    return { holdings, topHolding, scenarios, chartData }
  }, [data.accounts, data.decisions, perfData, period, totalValue])

  return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
        STRESS TEST — ESTIMATED PORTFOLIO IMPACT (BETA-ADJUSTED VOL MODEL)
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 12 }}>
        {scenarios.map(s => (
          <div key={s.name} style={{
            padding: '10px 12px', background: 'var(--surface)',
            border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${s.color}`,
            borderRadius: 0,
          }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: s.color, textTransform: 'uppercase', marginBottom: 2 }}>{s.name}</div>
            <div style={{ fontSize: 12, color: M, marginBottom: 6 }}>{s.detail}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: R, fontFamily: 'var(--font-mono)' }}>
              {s.pct.toFixed(1)}%
            </div>
            <div style={{ fontSize: 12, color: R, marginTop: 2 }}>≈ {fmtMoneyFull(s.dollar)}</div>
            <div style={{ marginTop: 6 }}>
              <MiniBar value={Math.min(Math.abs(s.pct / 50) * 100, 100)} color={s.color} width={120} height={4} />
            </div>
          </div>
        ))}
      </div>

      {/* Summary bar chart */}
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={chartData} margin={{ top: 4, right: 60, bottom: 4, left: 100 }} layout="vertical">
          <XAxis
            type="number"
            tick={{ fill: 'var(--text2)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={v => `−${v.toFixed(1)}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: 'var(--text)', fontSize: 12, fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
            width={98}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_RECHARTS}
            itemStyle={TOOLTIP_ITEM_RECHARTS}
            cursor={TOOLTIP_CURSOR}
            formatter={(v: unknown, _name: unknown, entry: { payload?: { name?: string } }) => {
              const pct = Number(v)
              const dollar = scenarios.find(s => s.name === entry?.payload?.name)?.dollar
              return [
                `−${pct.toFixed(1)}%${dollar != null ? `  ≈ ${fmtMoneyFull(dollar)}` : ''}`,
                'Est. Impact',
              ]
            }}
          />
          <Bar dataKey="impact" maxBarSize={14} radius={[0, 2, 2, 0]}>
            {chartData.map((_d, i) => (
              <Cell key={i} fill={scenarios[i].color as string} fillOpacity={0.8} />
            ))}
            <LabelList
              dataKey="impact"
              position="right"
              style={{ fill: R, fontSize: 12, fontFamily: 'monospace', fontWeight: 500 }}
              formatter={(v: unknown) => `−${Number(v).toFixed(1)}%`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: M, fontStyle: 'italic', marginTop: 4 }}>
        * Beta estimated from historical annualized vol. Scenarios are illustrative — not a guarantee of actual losses.
      </div>
    </div>
  )
}
