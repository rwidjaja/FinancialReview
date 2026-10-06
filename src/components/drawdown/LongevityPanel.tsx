/**
 * LongevityPanel + DepletionScheduleSection — Account Longevity
 * Lines ~1087–1569 of the original DrawdownTab.tsx
 */

import { useState, useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine,
  Cell, Legend,
} from 'recharts'
import { TerminalSection } from '../ui/Terminal'
import { WsSection } from '../workspace/WorkspaceContext'
import { fmtMoney } from '../../utils/formatters'
import { RMD_START_AGE, DRAWDOWN_DEFAULTS } from '../../utils/taxConfig'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import type { ViewMode } from '../ui/ModeToggle'
import type { DashboardData } from '../../types/dashboard'
import type { DrawdownResult, DrawdownInputs, StrategyId } from './drawdown.engine'
import { G, R, A, M, Y, BL, STRATEGY_COLORS, fmt, SectionLabel, InlineTooltip } from './drawdown.shared'

// ─── Depletion Schedule ────────────────────────────────────────────────────────
function DepletionScheduleSection({ result, data, inputs }: { result: DrawdownResult; data: DashboardData; inputs: DrawdownInputs }) {
  // Use simulation inputs so sliders (dividend_yield, target_age, etc.) are reactive.
  const startBalance  = inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance
  const currentYield  = inputs.dividend_yield
  // Default withdrawal = tracked lifestyle spending (annual_spending), not income_target
  const planSpending  = inputs.annual_spending || data.spending_intelligence?.true_annual_spending || 0
  const currentAge    = result.inputs.current_age
  const targetAge     = result.inputs.target_age
  // Inclusive of targetAge itself — `years = targetAge - currentAge` alone
  // stops one year short (last row's age = targetAge - 1), so "Balance at Age
  // {targetAge}" and "Solve → $0 at age {targetAge}" were both reading a
  // balance actually computed for targetAge - 1.
  const years         = targetAge - currentAge + 1

  const [withdrawal,    setWithdrawal]    = useState(() => Math.round(planSpending))
  // Seeded from the app's canonical growth/inflation assumptions (taxConfig.ts
  // DRAWDOWN_DEFAULTS) so this panel's default projection agrees with
  // drawdown.engine.ts / predictions.engine.ts / SpendingPlanPanel instead of
  // silently using its own different starting assumption (was hardcoded 4%/2%).
  const [navGrowth,     setNavGrowth]     = useState(DRAWDOWN_DEFAULTS.expected_return * 100)   // % per year
  const [divGrowth,     setDivGrowth]     = useState(DRAWDOWN_DEFAULTS.inflation * 100)          // % per year

  // Period-by-period depletion engine. Grows the balance first, then
  // withdraws — same order as drawdown.engine.ts's runDrawdown/simulateStrategy
  // and SpendingPlanPanel's computeGuardrailsSim, so depletion-age estimates
  // are comparable across panels instead of silently using the opposite
  // convention (this used to withdraw first, then grow the reduced balance).
  // The withdrawal itself is also inflated each year, matching how every
  // other engine in the app escalates spending over time.
  function runDepletion(w0: number, navGr: number, divGr: number) {
    const rows: { year: number; age: number; startBal: number; dividends: number; withdrawal: number; growth: number; endBal: number }[] = []
    let bal = startBalance
    let yld = currentYield
    let w   = w0
    for (let y = 0; y < years; y++) {
      if (bal <= 0) { rows.push({ year: y + 1, age: currentAge + y, startBal: 0, dividends: 0, withdrawal: 0, growth: 0, endBal: 0 }); w *= (1 + DRAWDOWN_DEFAULTS.inflation); continue }
      const growth    = bal * (navGr / 100)
      const divs      = bal * yld
      const endBal    = Math.max(bal + growth + divs - w, 0)
      rows.push({ year: y + 1, age: currentAge + y, startBal: bal, dividends: divs, withdrawal: w, growth, endBal })
      bal = endBal
      yld = yld * (1 + divGr / 100)
      w   = w * (1 + DRAWDOWN_DEFAULTS.inflation)
    }
    return rows
  }

  // Binary search: find withdrawal that drives ending balance to ~0 at target age
  function solveMaxWithdrawal() {
    let lo = 0, hi = startBalance * 2
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      const rows = runDepletion(mid, navGrowth, divGrowth)
      const end = rows[rows.length - 1]?.endBal ?? 0
      if (end > 0) lo = mid; else hi = mid
    }
    setWithdrawal(Math.round((lo + hi) / 2))
  }

  const rows    = useMemo(() => runDepletion(withdrawal, navGrowth, divGrowth), [withdrawal, navGrowth, divGrowth, startBalance, currentYield, years])
  const deplRow = rows.find(r => r.endBal <= 0)
  const endBal  = rows[rows.length - 1]?.endBal ?? 0
  const depletesAge = deplRow ? deplRow.age : null

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border2)', color: 'var(--text)',
    fontFamily: 'var(--font-mono)', fontSize: 12, padding: '3px 6px', borderRadius: 0, width: 90,
  }

  return (
    <TerminalSection id="depletion-schedule" title="Dividend-Aware Depletion Schedule" defaultOpen={false} accent={R}>
      <div style={{ fontSize: 12, color: M, marginBottom: 10, lineHeight: 1.6 }}>
        Period-by-period simulation using your actual portfolio yield ({(currentYield * 100).toFixed(2)}%).
        Dividends shrink as principal depletes — the depletion curve is non-linear.
        Adjust inputs below or solve for the exact withdrawal that reaches $0 at age {targetAge}.
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12,
        padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 0 }}>
        {[
          { label: 'Annual Withdrawal', value: withdrawal, set: setWithdrawal, prefix: '$', step: 1000 },
          { label: 'NAV Growth Rate %', value: navGrowth,  set: setNavGrowth,  prefix: '',  step: 0.5  },
          { label: 'Div Growth Rate %', value: divGrowth,  set: setDivGrowth,  prefix: '',  step: 0.5  },
        ].map(({ label, value, set, prefix, step }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {prefix && <span style={{ fontSize: 12, color: M }}>{prefix}</span>}
              <input
                type="number"
                value={value}
                step={step}
                onChange={e => set(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
          </div>
        ))}
        <button
          onClick={solveMaxWithdrawal}
          style={{
            padding: '4px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            background: `${R}22`, color: R, border: `1px solid ${R}`, borderRadius: 0,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}
        >
          Solve → $0 at age {targetAge}
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        {[
          {
            label: 'Depletes At',
            value: depletesAge ? `Age ${depletesAge}` : `≥ ${targetAge}`,
            color: depletesAge ? R : G,
          },
          {
            label: `Balance at Age ${targetAge}`,
            value: fmtMoney(endBal),
            color: endBal <= 0 ? R : endBal < startBalance * 0.2 ? Y : G,
          },
          {
            label: 'Starting Yield',
            value: `${(currentYield * 100).toFixed(2)}%`,
            color: M,
          },
          {
            label: 'Year-1 Dividends',
            value: fmtMoney(rows[0]?.dividends ?? 0),
            color: G,
          },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 0, padding: '6px 10px', flex: 1 }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Year-by-year table */}
      <div style={{ overflowX: 'auto' }}>
        <table className="bb-table">
          <thead>
            <tr>
              <th className="r">YEAR</th>
              <th className="r">AGE</th>
              <th className="r">START BALANCE</th>
              <th className="r">DIVIDENDS</th>
              <th className="r">WITHDRAWAL</th>
              <th className="r">GROWTH</th>
              <th className="r">END BALANCE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const depleted  = r.endBal <= 0
              const divCovers = r.dividends >= r.withdrawal
              const rowColor  = depleted ? R : divCovers ? G : 'var(--text)'
              return (
                <tr key={r.year} style={depleted ? { background: `${R}11` } : {}}>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: M }}>{r.year}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: rowColor }}>{r.age}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoney(r.startBal)}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: G }}>{fmtMoney(r.dividends)}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: R }}>{fmtMoney(r.withdrawal)}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.growth >= 0 ? G : R }}>{fmtMoney(r.growth)}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: depleted ? R : r.endBal < startBalance * 0.3 ? Y : 'var(--text)' }}>
                    {depleted ? '$0 (depleted)' : fmtMoney(r.endBal)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 6, fontSize: 12, color: M, lineHeight: 1.5 }}>
        Green age = dividends cover full withdrawal (no principal needed) ·
        Rows highlighted red = portfolio depleted ·
        NAV growth applied after dividends and withdrawal each year ·
        Dividend yield shrinks proportionally as principal depletes
      </div>
    </TerminalSection>
  )
}

// ─── Account Longevity ────────────────────────────────────────────────────────
export function LongevityPanel({ result, data, inputs, mode }: { result: DrawdownResult; data: DashboardData; inputs: DrawdownInputs; mode: ViewMode }) {

  // Display order: recommended strategy first, "account X first" strategies last
  const LONGEVITY_ORDER: StrategyId[] = ['dynamic_bracket', 'proportional', 'roth_last', 'taxable_first', 'ira_first']
  const sortedStrategies = [...result.strategies].sort(
    (a, b) => LONGEVITY_ORDER.indexOf(a.id) - LONGEVITY_ORDER.indexOf(b.id)
  )

  // For each strategy: find when each account hits zero
  const longevityRows = sortedStrategies.map(s => {
    const taxableDeplete  = s.years.find(y => y.taxable  < 1000)?.age ?? null
    const rolloverDeplete = s.years.find(y => y.rollover < 1000)?.age ?? null
    const rothDeplete     = s.years.find(y => y.roth     < 1000)?.age ?? null
    return {
      id: s.id, label: s.label, description: s.description,
      taxableDeplete, rolloverDeplete, rothDeplete,
      totalDeplete: s.depleted_at_age,
      endingRoth: s.ending_roth,
    }
  })

  // Multi-line chart: ending total for each strategy (sorted so Dynamic Bracket renders on top)
  const longevityData = result.strategies[0].years.map((_, i) => {
    const row: Record<string, number | string> = { age: result.strategies[0].years[i].age }
    for (const s of sortedStrategies) {
      row[s.label] = Math.round((s.years[i]?.total ?? 0) / 1000)
    }
    return row
  })

  const lifestyleSpend = data.spending_intelligence?.true_annual_spending ?? 0
  const staticIds: StrategyId[] = ['taxable_first', 'ira_first', 'roth_last', 'proportional']
  const staticStrategies = result.strategies.filter(s => staticIds.includes(s.id))
  const rothRange = staticStrategies.length > 1
    ? Math.max(...staticStrategies.map(s => s.ending_roth)) - Math.min(...staticStrategies.map(s => s.ending_roth))
    : 0
  const isConverged = rothRange < 500_000  // within $500K ending Roth = effectively same path

  // Detect Dynamic Bracket's rollover depletion for labeling
  const dynBracket = result.strategies.find(s => s.id === 'dynamic_bracket')
  const dynRolloverDeplete = dynBracket?.years.find(y => y.rollover < 1000)?.age ?? null
  const longevityRmdAge = dynBracket?.years.find(y => y.rmd > 0)?.age ?? RMD_START_AGE

  // Selected strategy — drives chart highlight and card focus
  const [selected, setSelected] = useState<StrategyId>('dynamic_bracket')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <WsSection id="dd_lon_questions" value={dynBracket ? (dynBracket.depleted_at_age != null ? `Age ${dynBracket.depleted_at_age}` : 'Lasts') : undefined} status={dynBracket ? (dynBracket.depleted_at_age != null ? 'alert' : 'ok') : undefined}>
      {/* ── 3 Key Questions ── */}
      {dynBracket && (() => {
        const totalPortfolioLon = inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance
        const withdrawalRateLon = totalPortfolioLon > 0 ? (inputs.annual_spending / totalPortfolioLon * 100).toFixed(1) : '—'
        const isUnderspending = dynBracket.ending_total > totalPortfolioLon * 3
        const taxableLastAge = dynBracket.years.findLast ? dynBracket.years.findLast((y: any) => y.taxable >= 1000)?.age : null
        const runsOut = dynBracket.depleted_at_age != null
        const runsOutColor = runsOut ? R : G
        return (
          <>
            {/* 3 Q&A boxes */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {/* Q1: Will I run out? */}
              <div style={{ background: 'var(--surface)', borderRadius: 0,
                border: `1px solid ${runsOutColor}`, borderTop: `3px solid ${runsOutColor}`,
                padding: '12px 14px' }}>
                <div style={{ fontSize: 12, color: M, lineHeight: 1.4, marginBottom: 8 }}>
                  Will I run out of money?
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 500, color: runsOutColor }}>
                  {runsOut ? 'YES' : 'NO'}
                </div>
                <div style={{ fontSize: 12, color: M, marginTop: 3 }}>
                  {runsOut
                    ? `Depletes at age ${dynBracket.depleted_at_age} — adjust income target or spending`
                    : `Survives the full ${inputs.target_age - inputs.current_age}-year plan`}
                </div>
              </div>

              {/* Q2: When does IRA disappear? */}
              <div style={{ background: 'var(--surface)', borderRadius: 0,
                border: `1px solid ${BL}`, borderTop: `3px solid ${BL}`,
                padding: '12px 14px' }}>
                <div style={{ fontSize: 12, color: M, lineHeight: 1.4, marginBottom: 8 }}>
                  When does IRA disappear?
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 500, color: BL }}>
                  {dynRolloverDeplete != null ? `Age ${dynRolloverDeplete}` : 'Never'}
                </div>
                <div style={{ fontSize: 12, color: M, marginTop: 3 }}>
                  {dynRolloverDeplete != null
                    ? 'By design — Dynamic Bracket depletes IRA before RMDs force it'
                    : 'IRA survives through the full plan'}
                </div>
              </div>

              {/* Q3: What remains at target age? */}
              <div style={{ background: 'var(--surface)', borderRadius: 0,
                border: `1px solid ${G}`, borderTop: `3px solid ${G}`,
                padding: '12px 14px' }}>
                <div style={{ fontSize: 12, color: M, lineHeight: 1.4, marginBottom: 8 }}>
                  What remains at age {inputs.target_age}?
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: G }}>
                  {fmt(dynBracket.ending_total)}
                </div>
                <div style={{ fontSize: 12, color: M, marginTop: 3 }}>
                  total · Roth: <span style={{ color: G, fontWeight: 500 }}>{fmt(dynBracket.ending_roth)}</span>
                </div>
              </div>
            </div>

            {/* Supporting bullets */}
            <div style={{ padding: '8px 12px', borderRadius: 0, background: 'var(--surface)',
              border: `1px solid ${BL}` }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  ...(dynRolloverDeplete != null
                    ? [{ icon: '→', color: BL, text: `IRA depletes at age ${dynRolloverDeplete} — intentional. Dynamic Bracket converts/withdraws the IRA before RMDs force it. Do NOT try to preserve the IRA.` }]
                    : []),
                  { icon: '', color: R, text: `Do not withdraw from Roth. Roth grows to ${fmt(dynBracket.ending_roth)} — preserving it is the entire point of Dynamic Bracket.` },
                  { icon: '✓', color: G, text: `Taxable account${taxableLastAge ? ` survives to age ${taxableLastAge}+` : ' is your primary lifetime source'} — continue controlled LTCG sales and concentration trimming.` },
                  ...(isUnderspending
                    ? [{ icon: '→', color: Y, text: `Portfolio ends at ${fmt(dynBracket.ending_total)} at ${withdrawalRateLon}% withdrawal rate — you are dramatically underspending. See Spending Plan to raise your baseline.` }]
                    : []),
                  { icon: '✓', color: G, text: `Dynamic Bracket is the correct strategy — portfolio survives the full plan. Stay the course.` },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 12, color: item.color, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                    <span style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      })()}

      {/* Purpose statement */}
      <div style={{ fontSize: 12, color: M, lineHeight: 1.6, padding: '6px 10px',
        borderLeft: `3px solid ${R}`, background: `${R}0a` }}>
        <strong style={{ color: 'var(--text1)' }}>See when each account runs out.</strong>{' '}
        All 5 strategies are shown together so you can compare depletion timing, Roth legacy, and
        how long each account type survives. Depletion ages reflect the income target set in the left panel.
        For tax efficiency and year-by-year withdrawal detail, see <em>Withdrawal Schedule</em>.
      </div>

      {/* Convergence inline note — compact, inside the chart section not a separate banner */}
      {isConverged && (
        <div style={{ fontSize: 12, color: Y, padding: '4px 10px',
          background: 'var(--fd-card)', borderLeft: `2px solid ${Y}` }}>
           Strategies overlap at current income target — reduce to {fmtMoney(lifestyleSpend)} (tracked spending) to see separation.
        </div>
      )}

      </WsSection>

      {/* Depletion table */}
      {mode === 'advanced' && (
      <WsSection id="dd_depletion_ages">
      <TerminalSection id="depletion-table" title="Account Depletion Ages" defaultOpen accent={R}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
          {longevityRows.map(row => {
            const isSel = row.id === selected
            return (
            <div key={row.id}
              onClick={() => setSelected(row.id as StrategyId)}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--panel2)' }}
              onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'var(--surface)' }}
              style={{
                background: isSel ? 'var(--panel2)' : 'var(--surface)',
                border: isSel ? `1px solid ${STRATEGY_COLORS[row.id]}` : '1px solid rgba(255,255,255,0.07)',
                borderTop: `2px solid ${STRATEGY_COLORS[row.id]}`,
                borderRadius: 0, padding: '8px 10px',
                cursor: 'pointer', transition: 'background 0.15s, border 0.15s',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 500, color: STRATEGY_COLORS[row.id],
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                {isSel && <span style={{ marginRight: 4 }}>▶</span>}
                {row.label}
                <InlineTooltip text={row.description} label={row.label} color={STRATEGY_COLORS[row.id]} />
              </div>
              {[
                { label: 'Taxable', age: row.taxableDeplete, color: A, id: 'taxable' },
                { label: 'Rollover IRA', age: row.rolloverDeplete, color: BL, id: 'rollover' },
                { label: 'Roth IRA', age: row.rothDeplete, color: G, id: 'roth' },
                { label: 'TOTAL', age: row.totalDeplete, color: R, id: 'total' },
              ].map(({ label, age, id }) => {
                const isIntentionalRollover = id === 'rollover' && row.id === 'dynamic_bracket' && age != null
                const isDomRoth = id === 'roth' && row.id === 'dynamic_bracket' && age == null
                const isTaxableNonDiff = id === 'taxable' && isConverged && age == null
                return (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                    padding: '3px 0', borderBottom: '1px solid var(--border2)' }}>
                    <span style={{ fontSize: 12, color: M }}>
                      {label}
                      {isIntentionalRollover && (
                        <span style={{ color: G, marginLeft: 4 }} title={`Converted to Roth before RMD age ${longevityRmdAge} — locks in 24% rate, avoids 32%+ forced distributions`}>✓ intentional</span>
                      )}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                      color: isIntentionalRollover ? G : age == null ? G : age < result.inputs.target_age - 5 ? R : Y }}>
                      {isDomRoth
                        ? `≥ ${result.inputs.target_age} · dominant`
                        : isTaxableNonDiff
                        ? `≥ ${result.inputs.target_age}`
                        : age == null ? '≥ '+result.inputs.target_age : `age ${age}`}
                    </span>
                  </div>
                )
              })}
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: M }}>Roth legacy at age {result.inputs.target_age}</div>
                <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: G }}>
                  {fmt(row.endingRoth)}
                </div>
                <div style={{ fontSize: 12, color: M, marginTop: 1 }}>end of plan horizon · not near-term · nominal</div>
              </div>
            </div>
            )
          })}
        </div>
      </TerminalSection>
      </WsSection>
      )}

      {/* Portfolio trajectory — all strategies */}
      {mode === 'advanced' && <WsSection id="dd_total_trajectory"><TerminalSection id="total-trajectory" title="Portfolio Total — All Strategies" defaultOpen accent={A}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={longevityData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="age" tick={{ fontSize: 12, fill: M }}
              label={{ value: 'Age', position: 'insideBottomRight', fontSize: 12, fill: M, offset: -4 }} />
            <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}M` : `$${v}K`} />
            <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown, name: unknown) => [`$${Number(v).toLocaleString()}K`, String(name)]} />
            <Legend wrapperStyle={{ fontSize: 12, color: M }} />
            <ReferenceLine y={0} stroke={R} strokeDasharray="3 3" />
            <ReferenceLine x={result.inputs.ss_start_age} stroke={G} strokeDasharray="3 2"
              label={{ value: `SS ${result.inputs.ss_start_age} (+${fmtMoney(result.inputs.ss_annual)}/yr)`, position: 'top', fontSize: 12, fill: G }} />
            {sortedStrategies.map(s => (
              <Line key={s.id} type="monotone" dataKey={s.label}
                stroke={STRATEGY_COLORS[s.id]}
                strokeWidth={s.id === selected ? 2.5 : 1}
                dot={false}
                strokeOpacity={s.id === selected ? 1 : 0.25} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </TerminalSection>

      {/* Rollover intentional depletion note */}
      {dynRolloverDeplete != null && (
        <div style={{
          padding: '8px 12px', borderRadius: 0,
          background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
          borderLeft: `3px solid ${G}`, fontSize: 12, color: M, lineHeight: 1.6,
        }}>
          <strong style={{ color: G }}>✓ Dynamic Bracket: Rollover IRA depletes at age {dynRolloverDeplete} by design</strong> —
          Rollover IRA is converted to Roth before RMD age {longevityRmdAge}, locking in the 24% bracket rate and eliminating
          future 32%+ forced distributions. This is the core tax advantage of Dynamic Bracket, not a failure.
          <span style={{ color: M, marginLeft: 8, fontSize: 12 }}>
            Note: depletion age in this engine may differ from Tax → Roth Conversion calendar
            (different projection methods) — see Tax tab for step-by-step conversion schedule.
          </span>
        </div>
      )}
      </WsSection>}

      {/* Roth preservation comparison */}
      {mode === 'advanced' && (
        <WsSection id="dd_roth_legacy" value={dynBracket ? fmt(dynBracket.ending_roth) : undefined} status="ok">
        <TerminalSection id="roth-preserved" title={`Roth IRA Legacy at Age ${result.inputs.target_age} — End of Plan Horizon`} defaultOpen accent={G}>
          <SectionLabel text={`Projected Roth balance at age ${result.inputs.target_age} — not near-term trajectory. For 5-year Roth path, see Tax → Roth Conversion → Roth vs Rollover Trajectory chart.`} color={G} />
          <ResponsiveContainer width="100%" height={120}>
            <BarChart
              data={sortedStrategies.map(s => ({ name: s.label, roth: Math.round(s.ending_roth / 1000) }))}
              margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
              layout="vertical"
            >
              <XAxis type="number" tick={{ fontSize: 12, fill: M }} tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}M` : `$${v}K`} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: M }} />
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown) => [`$${Number(v).toLocaleString()}K`, 'Roth ending']} />
              <Bar dataKey="roth" radius={[0, 2, 2, 0]}>
                {sortedStrategies.map((s, i) => (
                  <Cell key={i} fill={STRATEGY_COLORS[s.id]}
                    fillOpacity={s.id === selected ? 1 : 0.3} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {(() => {
            const dynRoth = result.strategies.find(s => s.id === 'dynamic_bracket')?.ending_roth ?? 0
            const roth5pct = dynRoth / Math.pow(1.07 / 1.05, result.inputs.target_age - result.inputs.current_age)
            const roth9pct = dynRoth * Math.pow(1.09 / 1.07, result.inputs.target_age - result.inputs.current_age)
            return dynRoth > 0 ? (
              <div style={{ marginTop: 6, fontSize: 12, color: M, lineHeight: 1.5 }}>
                Dynamic Bracket Roth sensitivity: at <span style={{ color: Y }}>5% return ≈ {fmt(roth5pct)}</span>
                {' · '}at <span style={{ color: G }}>7% (base) = {fmt(dynRoth)}</span>
                {' · '}at <span style={{ color: G }}>9% ≈ {fmt(roth9pct)}</span>
                <span style={{ marginLeft: 8 }}>— highly sensitive to long-term return assumption over {result.inputs.target_age - result.inputs.current_age} years</span>
              </div>
            ) : null
          })()}
          {isConverged && (
            <div style={{ marginTop: 4, fontSize: 12, color: M, opacity: 0.7 }}>
              IRA First and Proportional also {fmt(result.strategies.find(s => s.id === 'ira_first')?.ending_roth ?? 0)} (omitted — identical to Taxable First at current income target).
              Roth Preserve should show higher Roth legacy than Taxable First; reduce income target to ${ fmtMoney(lifestyleSpend) } to see meaningful separation.
            </div>
          )}
        </TerminalSection>
        </WsSection>
      )}

      {mode === 'advanced' && <WsSection id="dd_depletion_schedule"><DepletionScheduleSection result={result} data={data} inputs={inputs} /></WsSection>}
    </div>
  )
}
