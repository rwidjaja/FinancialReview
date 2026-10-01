/**
 * TaxPanel — Lifetime Tax Minimizer
 * Lines ~797–1084 of the original DrawdownTab.tsx
 */

import { useState } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine,
  Legend,
} from 'recharts'
import { TerminalSection } from '../ui/Terminal'
import { fmtMoney } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import { RMD_START_AGE } from '../../utils/taxConfig'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import type { ViewMode } from '../ui/ModeToggle'
import type { DashboardData } from '../../types/dashboard'
import type { DrawdownResult, StrategyId } from './drawdown.engine'
import { G, R, A, M, Y, BL, MU, STRATEGY_COLORS, fmt, pct, SectionLabel, InlineTooltip } from './drawdown.shared'

export function TaxPanel({ result, data, incomeTarget, mode }: { result: DrawdownResult; data: DashboardData; incomeTarget?: number; mode: ViewMode }) {
  const tx = data.tax_data
  const [focused, setFocused] = useState<StrategyId>('dynamic_bracket')
  const lifestyleSpend = data.spending_intelligence?.true_annual_spending ?? 0
  const targetMult = lifestyleSpend > 0 && incomeTarget ? incomeTarget / lifestyleSpend : null
  const staticIds: StrategyId[] = ['taxable_first', 'ira_first', 'roth_last', 'proportional']
  const staticStrategies = result.strategies.filter(s => staticIds.includes(s.id))
  const taxRange = staticStrategies.length > 1
    ? Math.max(...staticStrategies.map(s => s.total_taxes)) - Math.min(...staticStrategies.map(s => s.total_taxes))
    : 0
  const isConverged = taxRange < 50_000

  // Display order: recommended first, "account X first" strategies last
  const TAX_ORDER: StrategyId[] = ['dynamic_bracket', 'proportional', 'roth_last', 'taxable_first', 'ira_first']
  const sortedStrategies = [...result.strategies].sort(
    (a, b) => TAX_ORDER.indexOf(a.id) - TAX_ORDER.indexOf(b.id)
  )

  const sel = result.strategies.find(s => s.id === focused)!

  // Action summary data — always computed from Dynamic Bracket
  const dynTax = result.strategies.find(s => s.id === 'dynamic_bracket')!
  const worstTax = Math.max(...result.strategies.map(s => s.total_taxes))
  const worstStrat = result.strategies.find(s => s.total_taxes === worstTax)
  const taxActionSavings = worstTax - dynTax.total_taxes
  const avgEffRate = dynTax.years.length > 0
    ? (dynTax.years.reduce((s, y) => s + y.effective_rate, 0) / dynTax.years.length).toFixed(1)
    : '—'
  const taxIraDepletesAge = dynTax.years.find(y => y.rollover < 1000)?.age ?? null
  const bracketDriftAge   = dynTax.years.find(y => y.marginal > 0.30)?.age ?? null
  const rmdStartAge       = dynTax.years.find(y => y.rmd > 0)?.age ?? (tx.rmd_start_age as number | null) ?? RMD_START_AGE
  const currentDivsTax    = dynTax.years[0]?.dividend_income ?? 0
  const finalDivsTax      = dynTax.years[dynTax.years.length - 1]?.dividend_income ?? 0
  const lastAgeTax        = dynTax.years[dynTax.years.length - 1]?.age ?? 0
  const extraRothVsWorst  = dynTax.ending_roth - (worstStrat?.ending_roth ?? 0)
  const highBracketYears  = dynTax.years.filter(y => y.marginal >= 0.32).length
  const rmdSpikeAvoided   = rmdStartAge != null
    ? dynTax.years.find(y => y.age === rmdStartAge)?.rmd ?? 0
    : 0

  const taxData = sel.years.map(y => ({
    age: y.age,
    Ordinary: Math.round(y.ordinary_tax),
    LTCG:     Math.round(y.ltcg_tax),
    Effective: parseFloat(y.effective_rate.toFixed(1)),
  }))

  const bracketData = sel.years.map(y => ({
    age: y.age,
    eff: parseFloat(y.effective_rate.toFixed(1)),
    top: parseFloat((y.marginal * 100).toFixed(0)),
  }))


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* ── Tax Strategy Summary + Key Future Events ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

        {/* Left: Tax Strategy Summary */}
        <div style={{ background: 'var(--surface)', borderRadius: 0, border: `1px solid ${G}`, overflow: 'hidden' }}>
          <div style={{ background: `${G}0e`, borderBottom: `1px solid ${G}`, padding: '6px 12px' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: G }}>TAX STRATEGY SUMMARY</span>
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Saves vs Worst</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)', color: G }}>{fmt(taxActionSavings)}</div>
                <div style={{ fontSize: 12, color: M }}>lifetime taxes</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Avg Eff Rate</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)', color: Y }}>{avgEffRate}%</div>
                <div style={{ fontSize: 12, color: M }}>{dynTax.years.length}-yr plan</div>
              </div>
            </div>
            <div style={{ padding: '6px 8px', borderRadius: 0, background: `${G}0a`, border: `1px solid ${G}` }}>
              <div style={{ fontSize: 12, color: G, fontWeight: 500 }}>★ Dynamic Bracket — optimal</div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                Converts IRA early · harvests LTCG · defers Roth.
                No switch needed — every other strategy costs more.
              </div>
            </div>
          </div>
        </div>

        {/* Right: Key Future Events timeline */}
        <div style={{ background: 'var(--surface)', borderRadius: 0, border: `1px solid ${BL}`, overflow: 'hidden' }}>
          <div style={{ background: `${BL}0c`, borderBottom: `1px solid ${BL}`, padding: '6px 12px' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: BL }}>KEY FUTURE EVENTS</span>
          </div>
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {([
              ...(result.inputs.ss_start_age ? [{ age: result.inputs.ss_start_age, label: 'Social Security starts', color: G }] : []),
              { age: rmdStartAge, label: 'RMDs begin', color: R },
              ...(taxIraDepletesAge != null ? [{ age: taxIraDepletesAge, label: 'IRA depletes (by design)', color: BL }] : []),
              ...(bracketDriftAge != null ? [{ age: bracketDriftAge, label: 'Bracket drift begins', color: A }] : []),
              ...(finalDivsTax > currentDivsTax * 1.5 ? [{ age: lastAgeTax, label: `Dividends → ${fmt(finalDivsTax)}/yr`, color: A }] : []),
            ] as { age: number; label: string; color: string }[])
              .sort((a, b) => a.age - b.age)
              .map((evt, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: evt.color, minWidth: 28, flexShrink: 0 }}>
                    {evt.age}
                  </div>
                  <div style={{ flex: 1, height: 1, background: `${evt.color}30` }} />
                  <div style={{ fontSize: 12, color: M, textAlign: 'right' }}>{evt.label}</div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Why Dynamic Bracket Wins ── */}
      <div style={{ background: 'var(--surface)', borderRadius: 0, border: `1px solid ${MU}`, overflow: 'hidden' }}>
        <div style={{ background: `${MU}0c`, borderBottom: `1px solid ${MU}`, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: MU }}>WHY DYNAMIC BRACKET WINS</span>
          <span style={{ fontSize: 12, color: M, fontStyle: 'italic' }}>vs. {worstStrat?.label ?? 'worst alternative'}</span>
        </div>
        <div style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <div style={{ padding: '8px 10px', borderRadius: 0, background: `${G}0a`, border: `1px solid ${G}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: G, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Converts IRA Early</div>
            <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: G }}>{fmt(taxActionSavings)}</div>
            <div style={{ fontSize: 12, color: M }}>lifetime tax saved vs worst strategy. Fills bracket each year before RMDs force higher rates.</div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 0, background: `${R}0a`, border: `1px solid ${R}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: R, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avoids 32%+ Bracket</div>
            <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: highBracketYears === 0 ? G : R }}>
              {highBracketYears === 0 ? 'Zero years' : `${highBracketYears} yr${highBracketYears > 1 ? 's' : ''}`}
            </div>
            <div style={{ fontSize: 12, color: M }}>
              {highBracketYears === 0
                ? 'No year crosses into 32%+ territory — bracket discipline holds throughout.'
                : `${highBracketYears} years projected above 32% — RMD spikes or large income events.`}
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 0, background: `${A}0a`, border: `1px solid ${A}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: A, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>RMD Spike Impact</div>
            <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: A }}>Age {rmdStartAge}</div>
            <div style={{ fontSize: 12, color: M }}>
              {rmdSpikeAvoided > 0
                ? `RMD at ${rmdStartAge}: ${fmt(rmdSpikeAvoided)}/yr. Converting now shrinks the IRA so forced distributions stay manageable.`
                : `RMD onset at ${rmdStartAge}. Converting early keeps IRA balance smaller — smaller mandatory distributions later.`}
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 0, background: `${BL}0a`, border: `1px solid ${BL}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: BL, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>More Roth Assets</div>
            <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: extraRothVsWorst > 0 ? BL : M }}>
              {extraRothVsWorst > 0 ? `+${fmt(extraRothVsWorst)}` : '—'}
            </div>
            <div style={{ fontSize: 12, color: M }}>
              {extraRothVsWorst > 0
                ? `More Roth at age ${result.inputs.target_age} vs worst alt. Tax-free legacy. No RMDs in Roth.`
                : `Roth balance similar across strategies at age ${result.inputs.target_age}.`}
            </div>
          </div>
        </div>
      </div>

      {/* ── Strategy tiles — lead with the comparison, same as Optimizer ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
        {sortedStrategies.map(s => (
          <div key={s.id} onClick={() => setFocused(s.id)} style={{
            background: s.id === focused ? 'var(--panel2)' : 'var(--panel)',
            border: `1px solid ${s.id === focused ? STRATEGY_COLORS[s.id] : 'var(--border2)'}`,
            borderTop: `2px solid ${STRATEGY_COLORS[s.id]}`,
            borderRadius: 0, padding: '8px 10px', cursor: 'pointer',
            transition: 'background 0.15s, border 0.15s',
          }}
            onMouseEnter={e => { if (s.id !== focused) e.currentTarget.style.background = 'var(--panel2)' }}
            onMouseLeave={e => { if (s.id !== focused) e.currentTarget.style.background = 'var(--panel)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: STRATEGY_COLORS[s.id],
              fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {s.id === focused && <span style={{ marginRight: 4 }}>▶</span>}
              {s.label}
              <InlineTooltip text={s.description} label={s.label} color={STRATEGY_COLORS[s.id]} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)', color: R, marginTop: 4 }}>
              {fmt(s.total_taxes)}
            </div>
            <div style={{ fontSize: 12, color: M }}>lifetime taxes</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: Y, marginTop: 3 }}>
              {pct(s.avg_effective_rate)} avg eff rate
            </div>
            {s.id === result.best_tax && (
              <div style={{ fontSize: 12, color: G, marginTop: 3, fontWeight: 500 }}>★ LOWEST TAXES</div>
            )}
          </div>
        ))}
      </div>

      {/* Inline warnings — only when meaningful */}
      {targetMult != null && targetMult >= 2 && (
        <div style={{ padding: '6px 10px', borderRadius: 0,
          background: 'var(--fd-card)', borderLeft: `2px solid ${Y}`, fontSize: 12, color: Y }}>
          Income target is {targetMult.toFixed(0)}× lifestyle spending —
          projections reflect {fmtMoney(incomeTarget!)}/yr withdrawals, not {fmtMoney(lifestyleSpend)}/yr actual.
        </div>
      )}
      {isConverged && (
        <div style={{ padding: '6px 10px', borderRadius: 0,
          background: 'var(--fd-card)', borderLeft: `2px solid ${M}`, fontSize: 12, color: M }}>
          Static strategies converge at this income target — lifetime tax differences are minimal.
          Dynamic Bracket retains its advantage through tax-aware harvesting.
        </div>
      )}

      {/* ── Multi-year charts — for selected strategy ───────────────────── */}
      {mode === 'advanced' && (
        <TerminalSection id="annual-tax" title={`Annual Tax Breakdown — ${sel.label}`} defaultOpen accent={R}>
          <SectionLabel text={`Ordinary income tax + LTCG tax by year · reference lines at SS start and RMD onset (${rmdStartAge})`} color={R} />
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={taxData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }} barSize={8}>
              <XAxis dataKey="age" tick={{ fontSize: 12, fill: M }} />
              <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown, name: unknown) => [`$${(Number(v)/1000).toFixed(1)}K`, String(name)]} />
              <Legend wrapperStyle={{ fontSize: 12, color: M }} />
              <Bar dataKey="Ordinary" stackId="t" fill={R}  opacity={0.85} />
              <Bar dataKey="LTCG"     stackId="t" fill={Y}  opacity={0.85} />
              <ReferenceLine x={result.inputs.ss_start_age} stroke={G} strokeDasharray="3 2"
                label={{ value: `SS (${result.inputs.ss_start_age})`, position: 'top', fontSize: 12, fill: G }} />
              <ReferenceLine x={rmdStartAge} stroke={A} strokeDasharray="3 2"
                label={{ value: `RMD (${rmdStartAge})`, position: 'top', fontSize: 12, fill: A }} />
            </BarChart>
          </ResponsiveContainer>
        </TerminalSection>
      )}

      {mode === 'advanced' && (
        <TerminalSection id="bracket-drift" title="Bracket Drift — Effective Rate vs Marginal Rate" defaultOpen accent={Y}>
          <SectionLabel text="Solid = effective rate (% of all income paid in tax) · Dashed = highest bracket reached that year (last-dollar marginal rate)" color={Y} />
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={bracketData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <XAxis dataKey="age" tick={{ fontSize: 12, fill: M }} />
              <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => `${v}%`} domain={[0, 40]} />
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown, name: unknown) => [`${v}%`, String(name)]} />
              <Legend wrapperStyle={{ fontSize: 12, color: M }} />
              <Line type="monotone" dataKey="eff" name="Eff Rate" stroke={G}  strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="top" name="Top Bracket" stroke={R} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              <ReferenceLine y={22} stroke={A} strokeDasharray="3 3" label={{ value: '22%', position: 'right', fontSize: 12, fill: A }} />
              <ReferenceLine y={tx?.target_bracket_rate ?? DEFAULT_BRACKET_RATE} stroke={Y} strokeDasharray="3 3" label={{ value: `${tx?.target_bracket_rate ?? DEFAULT_BRACKET_RATE}%`, position: 'right', fontSize: 12, fill: Y }} />
            </LineChart>
          </ResponsiveContainer>
        </TerminalSection>
      )}

      {mode === 'advanced' && (
        <TerminalSection id="tax-table" title="Year-by-Year Tax Detail" defaultOpen={false} accent={M}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ background: 'var(--panel2)', color: M }}>
                  {['Age','Yr','Ord Income','Taxable Inc','Ord Tax','LTCG Tax','Total Tax','Eff Rate','Bracket'].map(h => (
                    <th key={h} style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 500,
                      letterSpacing: '0.5px', textTransform: 'uppercase', borderBottom: '1px solid var(--border2)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sel.years.map((y, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--panel)' }}>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: M }}>{y.age}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: M }}>{y.year}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right' }}>{fmt(y.dividend_income + (y.ss_income * 0.85) + y.rmd + y.from_rollover)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right' }}>{fmt(y.ordinary_taxable)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: R }}>{fmt(y.ordinary_tax)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: Y }}>{fmt(y.ltcg_tax)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: R, fontWeight: 500 }}>{fmt(y.total_tax)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: G }}>{pct(y.effective_rate)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: y.marginal >= 0.32 ? R : y.marginal >= 0.24 ? Y : G }}>
                      {pct(y.marginal * 100, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TerminalSection>
      )}

    </div>
  )
}
