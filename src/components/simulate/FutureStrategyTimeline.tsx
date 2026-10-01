import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer,
  Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import { WITHDRAWAL_AB_THRESHOLD, WITHDRAWAL_BC_THRESHOLD } from '../../utils/constants'
import { A, M, G, R } from './simTypes'
import type { DashboardData } from '../../types/dashboard'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS, TOOLTIP_CURSOR } from '../ui/chartTooltip'

// ── Future Strategy Timeline ──────────────────────────────────────────────────

const FST_CAGRS = [
  { rate: 0.08, key: 'g8', label: '8% CAGR', color: 'var(--text2)', dash: '4 3' },
  { rate: 0.10, key: 'g10', label: '10% CAGR', color: 'var(--blue)', dash: '' },
  { rate: 0.12, key: 'g12', label: '12% CAGR', color: 'var(--amber)', dash: '' },
  { rate: 0.15, key: 'g15', label: '15% CAGR', color: 'var(--red)', dash: '' },
]

export function FutureStrategyTimeline({ data }: { data: DashboardData }) {
  const totalMV = data.summary.total_value
  const totalCost = data.summary.total_cost
  const currentGains = data.summary.total_pnl

  // Thresholds from input.json _WITHDRAWAL_STRATEGY (via tax_data), with safe fallbacks
  const abThreshold = data.tax_data.withdrawal_state_ab_threshold ?? WITHDRAWAL_AB_THRESHOLD
  const bcThreshold = data.tax_data.withdrawal_state_bc_threshold ?? WITHDRAWAL_BC_THRESHOLD

  const milestones = data.tax_data.withdrawal_milestones ?? []
  const FST_THRESHOLDS = [
    { value: abThreshold, label: `${fmtMoney(abThreshold)} · State A→B`, color: 'var(--fd-accent)' },
    { value: bcThreshold, label: `${fmtMoney(bcThreshold)} · State B→C`, color: '#ffd600' },
    ...milestones.map(m => ({ value: m.gain_value, label: `${fmtMoney(m.gain_value)} · ${m.label}`, color: m.color })),
  ]

  function projectGains(cagr: number, years: number): number {
    return totalMV * Math.pow(1 + cagr, years) - totalCost
  }

  function findThresholdYear(cagr: number, threshold: number): number | null {
    if (currentGains >= threshold) return 0
    for (let y = 1; y <= 20; y++) {
      if (projectGains(cagr, y) >= threshold) return y
    }
    return null
  }

  // Build data for years 0–20
  const chartData = Array.from({ length: 21 }, (_, y) => ({
    year: y,
    g8:  Math.max(0, projectGains(0.08, y)),
    g10: Math.max(0, projectGains(0.10, y)),
    g12: Math.max(0, projectGains(0.12, y)),
    g15: Math.max(0, projectGains(0.15, y)),
  }))

  // Threshold crossing years: [threshold][cagr] → year|null
  const crossings = FST_THRESHOLDS.map(t => ({
    ...t,
    years: FST_CAGRS.map(c => ({ label: c.label, color: c.color, year: findThresholdYear(c.rate, t.value) })),
  }))

  const yearCellColor = (y: number | null) =>
    y === 0 ? 'var(--fd-accent)' : y == null ? 'var(--text2)' : y <= 5 ? 'var(--fd-negative)' : y <= 10 ? '#ffd600' : 'var(--fd-accent)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Context tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[
          { label: 'PORTFOLIO MARKET VALUE', value: fmtMoneyFull(totalMV), color: A, sub: 'current total across all accounts' },
          { label: 'TOTAL COST BASIS', value: fmtMoneyFull(totalCost), color: M, sub: 'sum of all position cost bases' },
          {
            label: 'CURRENT UNREALIZED GAINS', sub: `${totalCost > 0 ? ((currentGains / totalCost) * 100).toFixed(1) : '—'}% gain on cost`,
            value: `${currentGains >= 0 ? '+' : ''}${fmtMoneyFull(currentGains)}`,
            color: currentGains >= 0 ? G : R,
          },
        ].map(tile => (
          <div key={tile.label} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 3 }}>{tile.label}</div>
            <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: tile.color }}>{tile.value}</div>
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* Growth projection chart */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px' }}>
        <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 8 }}>
          UNREALIZED GAINS PROJECTION — 4 GROWTH SCENARIOS (YEARS 0–20)
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 14, right: 36, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="2 6" stroke="var(--fd-hairline)" vertical={false} />
            <XAxis dataKey="year"
              tick={{ fontSize: 12, fill: 'var(--text2)', fontFamily: 'var(--font-mono)' }}
              tickFormatter={(v: unknown) => `Y${v}`} interval={4}
            />
            <YAxis
              tick={{ fontSize: 12, fill: 'var(--text2)', fontFamily: 'var(--font-mono)' }}
              tickFormatter={(v: unknown) => `$${(Number(v) / 1_000_000).toFixed(1)}M`}
              width={44}
            />
            {/* Strategy threshold reference lines */}
            {FST_THRESHOLDS.map(t => (
              <ReferenceLine key={t.value} y={t.value}
                stroke={t.color} strokeDasharray="3 4" strokeOpacity={0.5}
                label={{ value: t.label, fill: t.color, fontSize: 12, position: 'insideTopRight' }}
              />
            ))}
            {/* Current gains baseline */}
            {currentGains > 0 && (
              <ReferenceLine y={currentGains}
                stroke="var(--fd-hairline)" strokeDasharray="2 2"
                label={{ value: '▶ NOW', fill: 'var(--text2)', fontSize: 12, position: 'insideTopLeft' }}
              />
            )}
            <Tooltip
              formatter={(v: unknown, name: unknown) => {
                const labels: Record<string, string> = { g8: '8% CAGR', g10: '10% CAGR', g12: '12% CAGR', g15: '15% CAGR' }
                return [fmtMoneyFull(Number(v)), labels[String(name)] ?? String(name)]
              }}
              labelFormatter={(l: unknown) => `Year ${l}`}
              contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS}
              cursor={TOOLTIP_CURSOR}
            />
            {FST_CAGRS.map(c => (
              <Line key={c.key} type="monotone" dataKey={c.key}
                stroke={c.color} strokeWidth={c.dash ? 1.5 : 2}
                strokeDasharray={c.dash} dot={false} name={c.key}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 6 }}>
          {FST_CAGRS.map(c => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: c.color, opacity: c.dash ? 0.6 : 1 }} />
              <span style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)' }}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Threshold crossing matrix */}
      <div>
        <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>
          YEARS TO STRATEGY THRESHOLD CROSSING — BY GROWTH SCENARIO
        </div>
        {/* Header row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(4,1fr)', gap: 1, marginBottom: 1 }}>
          <div style={{ padding: '5px 8px', background: 'var(--surface)', fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase' }}>
            THRESHOLD
          </div>
          {FST_CAGRS.map(c => (
            <div key={c.key} style={{ padding: '5px 8px', background: 'var(--surface)', fontSize: 12, fontWeight: 500,
              color: c.color, textAlign: 'center', textTransform: 'uppercase' }}>
              {c.label}
            </div>
          ))}
        </div>
        {/* Data rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {crossings.map(t => (
            <div key={t.value} style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(4,1fr)', gap: 1 }}>
              <div style={{ padding: '7px 10px', background: 'var(--bg)', border: '1px solid var(--fd-hairline)',
                fontSize: 12, color: t.color, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                {t.label}
              </div>
              {t.years.map((y, i) => (
                <div key={i} style={{
                  padding: '7px 4px', background: 'var(--bg)', border: '1px solid var(--fd-hairline)',
                  textAlign: 'center', fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  color: yearCellColor(y.year),
                }}>
                  {y.year === 0 ? 'NOW ✓' : y.year == null ? '>20yr' : `${y.year}yr`}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 5, fontSize: 12, color: M }}>
          NOW ✓ = already exceeded · Red ≤5yr · Yellow ≤10yr · Green &gt;10yr · Projection: portfolio MV compounds at stated CAGR
        </div>
      </div>

      {/* Strategy Events — State A→B and B→C switching years at baseline 10% CAGR */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px', marginBottom: 8 }}>
          STRATEGY SWITCHING EVENTS · 10% CAGR BASELINE
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {[
            {
              label: 'STATE A → B',
              sublabel: 'Begin controlled sale ($60K–80K/yr)',
              threshold: abThreshold,
              color: 'var(--fd-accent)',
              targetColor: 'var(--fd-accent)',
            },
            {
              label: 'STATE B → C',
              sublabel: 'Full harvest + 2yr SWVXX bucket (~$260K)',
              threshold: bcThreshold,
              color: 'var(--as-lilac)',
              targetColor: 'var(--as-lime)',
            },
            {
              label: 'DIVIDEND LOAD ALERT',
              sublabel: `When dividend income may trigger NIIT`,
              threshold: null as number | null,
              color: 'var(--fd-ink)',
              targetColor: 'var(--fd-muted)',
              isDiv: true,
            },
            {
              label: 'FULL HARVEST',
              sublabel: 'Estate-level gains — maximize Roth + sales',
              threshold: 2_000_000,
              color: 'var(--fd-negative)',
              targetColor: 'var(--fd-ink)',
            },
          ].map((ev, i) => {
            const yr = ev.threshold != null ? findThresholdYear(0.10, ev.threshold) : null
            const divLoadAlert = data.tax_data.withdrawal_dividend_load_alert ?? 160_000
            const annualDiv = data.tax_data.annual_div_total ?? 0
            const divGrowthRate = (data?.tax_data?.proj_div_growth_rate ?? 3) / 100
            // For div load: estimate years until dividend income (growing at proj_div_growth_rate) hits alert
            let divYr: number | null = null
            if (ev.isDiv) {
              if (annualDiv >= divLoadAlert) divYr = 0
              else {
                for (let y = 1; y <= 20; y++) {
                  if (annualDiv * Math.pow(1 + divGrowthRate, y) >= divLoadAlert) { divYr = y; break }
                }
              }
            }
            const displayYr = ev.isDiv ? divYr : yr
            const alreadyHere = displayYr === 0
            const never = displayYr == null
            return (
              <div key={i} style={{
                padding: '10px 12px', background: 'var(--surface)',
                border: `1px solid ${alreadyHere ? ev.targetColor : 'var(--fd-hairline)'}`,
                borderRadius: 0,
              }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: ev.color, letterSpacing: '0.6px', marginBottom: 4 }}>
                  {ev.label}
                </div>
                <div style={{
                  fontSize: alreadyHere ? 20 : 24, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  color: alreadyHere ? ev.targetColor : never ? M : displayYr! <= 5 ? 'var(--fd-negative)' : displayYr! <= 10 ? '#ffd600' : 'var(--fd-accent)',
                  marginBottom: 2,
                }}>
                  {alreadyHere ? 'NOW ✓' : never ? '>20yr' : `${displayYr}yr`}
                </div>
                <div style={{ fontSize: 12, color: M, lineHeight: 1.3 }}>{ev.sublabel}</div>
                {ev.threshold != null && (
                  <div style={{ fontSize: 12, color: M, marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    trigger: {fmtMoney(ev.threshold)} gains
                  </div>
                )}
                {ev.isDiv && (
                  <div style={{ fontSize: 12, color: M, marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    current: {fmtMoney(annualDiv)} · alert: {fmtMoney(divLoadAlert)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: M }}>
          Gain crossings use 10% CAGR projection · Dividend load assumes 3% annual dividend growth
        </div>
      </div>
    </div>
  )
}
