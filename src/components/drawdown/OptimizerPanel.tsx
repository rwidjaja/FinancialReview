/**
 * OptimizerPanel — Withdrawal Schedule / Action Plan
 * Lines ~183–794 of the original DrawdownTab.tsx
 */

import { useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
  Cell, Legend,
} from 'recharts'
import { TerminalSection } from '../ui/Terminal'
import { fmtMoney } from '../../utils/formatters'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import type { ViewMode } from '../ui/ModeToggle'
import type { DashboardData } from '../../types/dashboard'
import {
  computeAnnualDecision,
  buildAnnualDecisionInputs,
  type DrawdownInputs,
  type DrawdownResult,
  type StrategyId,
} from './drawdown.engine'
import { G, R, A, M, Y, BL, MU, STRATEGY_COLORS, fmt, SectionLabel } from './drawdown.shared'
import { computeBucketStatus } from '../../utils/retirementEngine'

export function OptimizerPanel({ result, inputs, data, incomeTarget, mode }: {
  result: DrawdownResult
  inputs: DrawdownInputs
  data: DashboardData
  incomeTarget?: number
  mode: ViewMode
}) {
  // Primary plan: always Dynamic Bracket — the recommended strategy
  const plan = result.strategies.find(s => s.id === 'dynamic_bracket')!
  const lifestyleSpend = data.spending_intelligence?.true_annual_spending ?? 0
  const targetMult = lifestyleSpend > 0 && incomeTarget ? incomeTarget / lifestyleSpend : null

  const inp = result.inputs
  const totalPortfolio = inp.taxable_balance + inp.rollover_balance + inp.roth_balance
  const withdrawal     = incomeTarget ?? inp.annual_spending

  // Comparison data (Advanced)
  const OPTIMIZER_ORDER: StrategyId[] = ['dynamic_bracket', 'proportional', 'roth_last', 'taxable_first', 'ira_first']
  const sortedStrategies = [...result.strategies].sort(
    (a, b) => OPTIMIZER_ORDER.indexOf(a.id) - OPTIMIZER_ORDER.indexOf(b.id)
  )
  const staticIds: StrategyId[] = ['taxable_first', 'ira_first', 'roth_last', 'proportional']
  const staticStrategies = result.strategies.filter(s => staticIds.includes(s.id))
  const taxRange = staticStrategies.length > 1
    ? Math.max(...staticStrategies.map(s => s.total_taxes)) - Math.min(...staticStrategies.map(s => s.total_taxes))
    : 0
  const isConverged = taxRange < 50_000
  const worstTax = Math.max(...result.strategies.map(s => s.total_taxes))
  const taxSavings = worstTax - plan.total_taxes

  // Chart data — always Dynamic Bracket
  const areaData = plan.years.map(y => ({
    age: y.age,
    Taxable:  Math.round(y.taxable  / 1000),
    Rollover: Math.round(y.rollover / 1000),
    Roth:     Math.round(y.roth     / 1000),
  }))
  const wdrawData = plan.years.map(y => ({
    age: y.age,
    Divs:     Math.round(y.dividend_income / 1000),
    Taxable:  Math.round(y.from_taxable    / 1000),
    IRA:      Math.round((y.from_rollover + y.rmd) / 1000),
    Roth:     Math.round(y.from_roth       / 1000),
  }))
  const barData = sortedStrategies.map(s => ({
    name: s.label, taxes: Math.round(s.total_taxes / 1000), id: s.id,
  }))

  const fmtK = (v: number) => !isFinite(v) ? 'N/A' : v === 0 ? '—' : v < 1000 ? `$${Math.round(v)}` : `$${(v / 1000).toFixed(0)}K`

  // ── Live annual decision — same engine as Section 1 (Annual Decision Engine) ──
  const liveAnnualInputs = useMemo(() =>
    buildAnnualDecisionInputs(data, incomeTarget ?? inp.annual_spending, {
      do_roth_conversion: inputs.do_roth_conversion,
    }),
    [data, incomeTarget, inp.annual_spending, inputs.do_roth_conversion]
  )
  const liveAnnual = useMemo(() => computeAnnualDecision(liveAnnualInputs), [liveAnnualInputs])

  const currentYear = new Date().getFullYear()
  const convSafetyBuf = (data.tax_data.safety_buffer as number | null | undefined) ?? 0
  const taxOptimalAmount = Math.max(0, liveAnnualInputs.conv_room_real - convSafetyBuf)
  const excessOverOptimal = liveAnnual.tax_optimal_exceeded
    ? Math.max(0, liveAnnualInputs.converted_ytd - taxOptimalAmount) : 0
  const isRMDAge = liveAnnual.rmd_forced > 0
  const wsState = data.tax_data.withdrawal_current_state as 'A' | 'B' | 'C' | undefined
  const wsRules = wsState ? (data.tax_data.withdrawal_states as any)?.[wsState]?.rules : undefined

  // Bucket shortfall — shared canonical calc (was previously reimplemented
  // inline with a `?? 0` bucketYears fallback instead of computeBucketStatus's
  // state-aware `?? (wsState === 'A' ? 0 : 1)`, and no fallback at all for
  // annualSpending, either of which could silently show "no bucket needed"
  // when the canonical logic would flag a real shortfall).
  const { swvxxValue, bucketYearsRequired: bucketYears, requiredBucket } = computeBucketStatus(data)
  const bucketShortfall = Math.max(0, requiredBucket - swvxxValue)

  // Upcoming milestones from the simulation plan (forward-looking, still correct)
  const y0 = plan.years[0]
  const rmdStartYear = plan.years.find(y => y.rmd > 0)
  const taxableDepletesYear = plan.years.find((y, i) => i > 0 && plan.years[i-1].taxable >= 1000 && y.taxable < 1000)
  const iraDepletesYear = plan.years.find((y, i) => i > 0 && plan.years[i-1].rollover >= 1000 && y.rollover < 1000)
  const yearsToRMD = rmdStartYear ? rmdStartYear.age - (y0?.age ?? inp.current_age) : null
  const milestoneAges = new Set<number>([
    ...(rmdStartYear ? [rmdStartYear.age] : []),
    ...(taxableDepletesYear ? [taxableDepletesYear.age] : []),
    ...(iraDepletesYear ? [iraDepletesYear.age] : []),
  ])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* ── THIS YEAR ACTION PLAN — powered by live portfolio state ── */}
      <div style={{ background: 'var(--surface)', borderRadius: 0, border: `1px solid ${A}`, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ background: `${A}14`, borderBottom: `1px solid ${A}`,
          padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 500, color: A }}>
              {currentYear} Action Plan — Live Portfolio State
            </span>
            <span style={{ fontSize: 12, color: M, marginLeft: 12 }}>
              {(liveAnnual.marginal_rate * 100).toFixed(0)}% marginal · {liveAnnual.effective_rate.toFixed(1)}% effective · same engine as Annual Decision
            </span>
          </div>
          <span style={{ fontSize: 12, color: G, fontWeight: 500, background: `${G}15`, padding: '2px 8px', borderRadius: 12 }}>
            ★ LIVE DATA
          </span>
        </div>

        {/* ── Cash Bucket Status ── */}
        {bucketYears > 0 && (() => {
          const bucketTarget = requiredBucket
          const pctFunded = bucketTarget > 0 ? Math.min(1, swvxxValue / bucketTarget) : 1
          return (
            <div style={{ padding: '8px 12px', borderRadius: 0,
              background: bucketShortfall > 0 ? `${Y}08` : `${G}06`,
              border: `1px solid ${bucketShortfall > 0 ? `${Y}` : `${G}25`}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: bucketShortfall > 0 ? Y : G }}>
                  {bucketShortfall > 0 ? '' : '✓'} SWVXX Cash Bucket — {bucketYears}-yr reserve
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: bucketShortfall > 0 ? Y : G }}>
                  {fmtK(swvxxValue)} / {fmtK(bucketTarget)}
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden', marginBottom: 5 }}>
                <div style={{ height: '100%', width: `${(pctFunded * 100).toFixed(0)}%`,
                  background: bucketShortfall > 0 ? Y : G, borderRadius: 0 }} />
              </div>
              {bucketShortfall > 0 && (
                <div style={{ fontSize: 12, color: Y }}>
                  Short by {fmtK(bucketShortfall)} — route dividends + sale proceeds to SWVXX first
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Cash Sources — execution order ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 72px 80px', gap: 8,
            padding: '3px 12px 5px', borderBottom: '1px solid var(--border2)' }}>
            <span />
            <span style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Source</span>
            <span style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Amount</span>
            <span style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Action</span>
          </div>

          {/* Row 1: Dividends */}
          <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 72px 80px', gap: 8,
            padding: '7px 12px', borderBottom: '1px solid var(--fd-hairline)', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: A, background: `${A}20`, borderRadius: 3,
              width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>1</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)' }}>Dividends</div>
              <div style={{ fontSize: 12, color: M }}>Reinvest OFF → SWVXX</div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: A, textAlign: 'right' }}>
              {fmtK(liveAnnual.taxable_div)}
            </div>
            <span style={{ fontSize: 12, color: G, background: `${G}15`, padding: '2px 7px', borderRadius: 0, width: 'fit-content' }}>AUTO</span>
          </div>

          {/* Row 2: Taxable sales */}
          {(() => {
            const amt = liveAnnual.from_taxable
            const rc = amt > 0 ? Y : M
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 72px 80px', gap: 8,
                padding: '7px 12px', borderBottom: '1px solid var(--fd-hairline)', alignItems: 'center',
                opacity: amt === 0 ? 0.45 : 1 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: rc, background: `${rc}20`, borderRadius: 3,
                  width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>2</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: amt > 0 ? 'var(--text1)' : M }}>Taxable sales</div>
                  <div style={{ fontSize: 12, color: M }}>LTCG lots · highest cost basis
                    {wsRules?.controlled_sale_target_min != null && ` · ${fmtK(wsRules.controlled_sale_target_min)}–${fmtK(wsRules.controlled_sale_target_max)} band`}</div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: rc, textAlign: 'right' }}>
                  {amt > 0 ? fmtK(amt) : '—'}
                </div>
                {amt > 0
                  ? <span style={{ fontSize: 12, color: Y, background: `${Y}15`, padding: '2px 7px', borderRadius: 0, width: 'fit-content' }}>EXECUTE</span>
                  : <span style={{ fontSize: 12, color: M }}>not needed</span>}
              </div>
            )
          })()}

          {/* Row 3: IRA / RMD */}
          {(() => {
            const amt = liveAnnual.from_rollover + liveAnnual.rmd_forced
            const rc = amt > 0 ? (isRMDAge ? R : BL) : M
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 72px 80px', gap: 8,
                padding: '7px 12px', borderBottom: '1px solid var(--fd-hairline)', alignItems: 'center',
                opacity: amt === 0 ? 0.45 : 1,
                background: isRMDAge && amt > 0 ? `${R}06` : 'transparent' }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: rc, background: `${rc}20`, borderRadius: 3,
                  width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>3</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: amt > 0 ? 'var(--text1)' : M }}>
                    {isRMDAge ? 'RMD — required by Dec 31' : 'IRA withdrawal'}
                  </div>
                  <div style={{ fontSize: 12, color: M }}>
                    {isRMDAge
                      ? '25% IRS penalty if missed · call Schwab to schedule'
                      : `Bracket-optimized · up to ${(liveAnnual.marginal_rate * 100).toFixed(0)}% ceiling`}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: rc, textAlign: 'right' }}>
                  {amt > 0 ? fmtK(amt) : '—'}
                </div>
                {amt > 0
                  ? <span style={{ fontSize: 12, color: rc, background: `${rc}15`, padding: '2px 7px', borderRadius: 0, width: 'fit-content' }}>
                      {isRMDAge ? 'REQUIRED' : 'EXECUTE'}
                    </span>
                  : <span style={{ fontSize: 12, color: M }}>not needed</span>}
              </div>
            )
          })()}

          {/* Row 4: Roth conversion */}
          {(() => {
            const isStop = liveAnnual.tax_optimal_exceeded
            const excl  = !inputs.do_roth_conversion
            const amt   = liveAnnual.roth_conversion
            const rc    = isStop ? R : excl ? M : amt > 0 ? MU : M
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 72px 80px', gap: 8,
                padding: '7px 12px', borderBottom: '1px solid var(--fd-hairline)', alignItems: 'center',
                background: isStop ? `${R}06` : amt > 0 && !excl ? `${MU}05` : 'transparent',
                opacity: excl ? 0.45 : 1 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: rc, background: `${rc}20`, borderRadius: 3,
                  width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>4</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: isStop ? R : amt > 0 && !excl ? 'var(--text1)' : M }}>
                    Roth conversion
                  </div>
                  <div style={{ fontSize: 12, color: M }}>
                    {isStop
                      ? `${fmtK(excessOverOptimal)} above tax-optimal · ${fmtK(liveAnnual.bracket_headroom)} bracket room remains`
                      : excl
                        ? 'Toggle "Include Roth conversions" to enable'
                        : amt > 0
                          ? `${fmtK(liveAnnual.bracket_headroom)} bracket headroom · before Dec 31`
                          : 'No headroom — bracket full or target met'}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: rc, textAlign: 'right' }}>
                  {isStop ? '$0' : amt > 0 && !excl ? fmtK(amt) : '—'}
                </div>
                <span style={{ fontSize: 12, color: rc, background: `${rc}15`, padding: '2px 7px', borderRadius: 0, width: 'fit-content' }}>
                  {isStop ? 'STOP' : excl ? 'OFF' : amt > 0 ? 'CONVERT' : 'skip'}
                </span>
              </div>
            )
          })()}

          {/* Row 5: Roth spending */}
          <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 72px 80px', gap: 8,
            padding: '7px 12px', alignItems: 'center', opacity: 0.5 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: G, background: `${G}20`, borderRadius: 3,
              width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>5</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: G }}>Roth spending</div>
              <div style={{ fontSize: 12, color: M }}>Do not withdraw — compound tax-free</div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: G, textAlign: 'right' }}>$0</div>
            <span style={{ fontSize: 12, color: G }}>✓ skip</span>
          </div>
        </div>

        {/* Tax footer */}
          <div style={{ borderTop: '1px solid var(--border2)', marginTop: 4, paddingTop: 8,
            display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Estimated {currentYear} Tax</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: Y, fontFamily: 'var(--font-mono)' }}>~{fmtK(liveAnnual.total_tax)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Quarterly Payments</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: Y, fontFamily: 'var(--font-mono)' }}>~{fmtK(Math.round(liveAnnual.total_tax / 4))}/qtr</div>
              <div style={{ fontSize: 12, color: M }}>Apr 15 · Jun 15 · Sep 15 · Jan 15</div>
            </div>
            {!liveAnnual.tax_optimal_exceeded && liveAnnual.bracket_headroom > 0 && (
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Bracket Headroom</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtK(liveAnnual.bracket_headroom)}</div>
                <div style={{ fontSize: 12, color: M }}>below {(liveAnnual.marginal_rate * 100).toFixed(0)}% — review Dec</div>
              </div>
            )}
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Portfolio Survives</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: plan.depleted_at_age == null ? G : R, fontFamily: 'var(--font-mono)' }}>
                {plan.depleted_at_age == null ? 'FULL PLAN' : `AGE ${plan.depleted_at_age}`}
              </div>
              <div style={{ fontSize: 12, color: M }}>Dynamic Bracket · {(inp.target_age - inp.current_age).toFixed(0)}-yr horizon</div>
            </div>
          </div>
      </div>

      {/* Upcoming milestones */}
      {(yearsToRMD !== null || taxableDepletesYear || iraDepletesYear) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {yearsToRMD !== null && yearsToRMD > 0 && (
            <div style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 0,
              background: 'var(--fd-card)', borderLeft: `2px solid ${R}` }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>RMDs Begin</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: R }}>Age {rmdStartYear!.age} — in {yearsToRMD} yr{yearsToRMD !== 1 ? 's' : ''}</div>
              <div style={{ fontSize: 12, color: M }}>Required IRA withdrawals start · must begin by Apr 1 of that year</div>
            </div>
          )}
          {taxableDepletesYear && (
            <div style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 0,
              background: 'var(--fd-card)', borderLeft: `2px solid ${Y}` }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Taxable Depletes</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: Y }}>
                Age {taxableDepletesYear.age} — in {taxableDepletesYear.age - Math.round(y0?.age ?? inp.current_age)} yrs
              </div>
              <div style={{ fontSize: 12, color: M }}>Shift to IRA + Roth · no more long-term gains harvesting</div>
            </div>
          )}
          {iraDepletesYear && (
            <div style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 0,
              background: 'var(--fd-card)', borderLeft: `2px solid ${BL}` }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>IRA Depletes</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: BL }}>
                Age {iraDepletesYear.age} — in {iraDepletesYear.age - Math.round(y0?.age ?? inp.current_age)} yrs
              </div>
              <div style={{ fontSize: 12, color: M }}>Roth becomes primary source · all withdrawals tax-free</div>
            </div>
          )}
        </div>
      )}

      {/* Income target vs lifestyle warning */}
      {targetMult != null && targetMult >= 2 && (
        <div style={{ fontSize: 12, color: Y, padding: '5px 10px',
          background: 'var(--fd-card)', borderLeft: `2px solid ${Y}` }}>
          <strong>Income target is {targetMult.toFixed(0)}× lifestyle spending</strong> — table reflects {fmtMoney(incomeTarget!)}/yr withdrawals vs {fmtMoney(lifestyleSpend)}/yr actual spending.
        </div>
      )}

      {/* ── Year-by-year table with milestone annotations ── */}
      <TerminalSection id="withdrawal-table" title="Full Year-by-Year Withdrawal Schedule" defaultOpen accent={A}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 400 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)', minWidth: '100%' }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--panel2)', zIndex: 1 }}>
                <th colSpan={1} style={{ padding: '2px 8px', fontSize: 12, textTransform: 'uppercase',
                  letterSpacing: '0.6px', color: M, borderBottom: '1px solid var(--border2)',
                  textAlign: 'center' }}>&nbsp;</th>
                <th colSpan={6} style={{ padding: '2px 8px', fontSize: 12, textTransform: 'uppercase',
                  letterSpacing: '0.6px', color: A, borderBottom: '1px solid var(--border2)',
                  textAlign: 'center', borderRight: '1px solid var(--border2)' }}>
                  Income &amp; Withdrawals
                </th>
                <th colSpan={3} style={{ padding: '2px 8px', fontSize: 12, textTransform: 'uppercase',
                  letterSpacing: '0.6px', color: Y, borderBottom: '1px solid var(--border2)',
                  textAlign: 'center', borderRight: '1px solid var(--border2)' }}>
                  Tax
                </th>
                <th colSpan={4} style={{ padding: '2px 8px', fontSize: 12, textTransform: 'uppercase',
                  letterSpacing: '0.6px', color: M, borderBottom: '1px solid var(--border2)',
                  textAlign: 'center' }}>
                  Balances
                </th>
              </tr>
              <tr style={{ position: 'sticky', top: 18, background: 'var(--panel2)', zIndex: 1 }}>
                {[
                  { label: '',           color: M },
                  { label: 'Age',        color: 'var(--text1)' },
                  { label: 'Dividends',  color: A, title: 'Dividend income from taxable — counts toward spending' },
                  { label: 'Taxable',    color: Y, title: 'Sold from taxable brokerage' },
                  { label: 'IRA',        color: BL, title: 'IRA withdrawals + forced RMDs' },
                  { label: 'Conversion', color: MU, title: 'Roth conversion — tax-paid transfer, not spending' },
                  { label: 'Roth',       color: G, border: true, title: 'Roth withdrawals — last resort only' },
                  { label: 'Bracket',    color: Y, title: 'Marginal bracket this year' },
                  { label: 'Eff Rate',   color: Y, title: 'Effective tax rate = total tax ÷ gross income' },
                  { label: 'Headroom',   color: G, border: true, title: 'Room left in bracket — Roth conversion opportunity' },
                  { label: 'Taxable Bal',color: Y },
                  { label: 'IRA Bal',    color: BL },
                  { label: 'Roth Bal',   color: G },
                  { label: 'Total',      color: M },
                ].map(({ label, color, border, title }, idx) => (
                  <th key={idx} title={title} style={{
                    padding: '3px 8px', textAlign: 'right', fontWeight: 500,
                    fontSize: 12, letterSpacing: '0.4px', textTransform: 'uppercase',
                    color, borderBottom: '2px solid var(--border2)', whiteSpace: 'nowrap',
                    borderRight: border ? '1px solid var(--border2)' : undefined,
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.years.map((y, i) => {
                const depleted = y.total < 1000
                const isCurrentYear = i === 0
                const bktColor = y.marginal <= 0.22 ? G : y.marginal <= 0.24 ? Y : R
                const headroomColor = y.bracket_headroom > 50_000 ? G : y.bracket_headroom > 15_000 ? Y : R
                const milestone = milestoneAges.has(y.age)
                  ? (y.age === rmdStartYear?.age ? { label: 'RMDs Begin', color: R }
                    : y.age === taxableDepletesYear?.age ? { label: 'Taxable Gone', color: Y }
                    : { label: 'IRA Gone', color: BL })
                  : null
                return (
                  <tr key={y.age} style={{
                    background: isCurrentYear
                      ? `${A}12`
                      : milestone ? `${milestone.color}08`
                      : i % 2 === 0 ? 'transparent' : 'var(--fd-card)',
                    opacity: depleted ? 0.4 : 1,
                    outline: isCurrentYear ? `1px solid ${A}` : undefined,
                  }}>
                    <td style={{ padding: '3px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                      {isCurrentYear && (
                        <span style={{ fontSize: 12, fontWeight: 500, color: A,
                          background: `${A}25`, padding: '1px 5px', borderRadius: 0 }}>NOW</span>
                      )}
                      {milestone && !isCurrentYear && (
                        <span style={{ fontSize: 12, fontWeight: 500, color: milestone.color,
                          background: `${milestone.color}20`, padding: '1px 5px', borderRadius: 0 }}>
                          {milestone.label}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '3px 8px', color: isCurrentYear ? A : 'var(--text1)', fontWeight: 500, textAlign: 'right' }}>{y.age}</td>
                    <td style={{ padding: '3px 8px', color: y.dividend_income > 0 ? A : M, textAlign: 'right' }}>{fmtK(y.dividend_income)}</td>
                    <td style={{ padding: '3px 8px', color: y.from_taxable > 0 ? Y : M, textAlign: 'right' }}>{fmtK(y.from_taxable)}</td>
                    <td style={{ padding: '3px 8px', color: (y.from_rollover + y.rmd) > 0 ? BL : M, textAlign: 'right' }}>{fmtK(y.from_rollover + y.rmd)}</td>
                    <td style={{ padding: '3px 8px', color: y.roth_conversion > 0 ? MU : M, textAlign: 'right' }}>{fmtK(y.roth_conversion)}</td>
                    <td style={{ padding: '3px 8px', color: y.from_roth > 0 ? G : M, textAlign: 'right', borderRight: '1px solid var(--border2)' }}>{fmtK(y.from_roth)}</td>
                    <td style={{ padding: '3px 8px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-block', padding: '1px 5px', borderRadius: 0,
                        background: `${bktColor}18`, color: bktColor, fontWeight: 500, fontSize: 12 }}>
                        {y.marginal > 0 ? `${(y.marginal * 100).toFixed(0)}%` : '—'}
                      </span>
                    </td>
                    <td style={{ padding: '3px 8px', color: y.effective_rate > 25 ? R : y.effective_rate > 18 ? Y : G, textAlign: 'right' }}>
                      {y.effective_rate > 0 ? `${y.effective_rate.toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ padding: '3px 8px', color: headroomColor, textAlign: 'right', fontWeight: 500, borderRight: '1px solid var(--border2)' }}>
                      {y.bracket_headroom > 0 ? fmtK(y.bracket_headroom) : '—'}
                    </td>
                    <td style={{ padding: '3px 8px', color: y.taxable  < 1000 ? R : Y,  textAlign: 'right' }}>{y.taxable  < 1000 ? '—' : fmtK(y.taxable)}</td>
                    <td style={{ padding: '3px 8px', color: y.rollover < 1000 ? R : BL, textAlign: 'right' }}>{y.rollover < 1000 ? '—' : fmtK(y.rollover)}</td>
                    <td style={{ padding: '3px 8px', color: y.roth     < 1000 ? R : G,  textAlign: 'right' }}>{y.roth     < 1000 ? '—' : fmtK(y.roth)}</td>
                    <td style={{ padding: '3px 8px', color: depleted ? R : 'var(--text1)', fontWeight: 500, textAlign: 'right' }}>{depleted ? 'DEPLETED' : fmtK(y.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </TerminalSection>

      {/* Account balance trajectory */}
      {mode === 'advanced' && (
        <TerminalSection id="balance-trajectory" title="Account Balance Trajectory" defaultOpen accent={A}>
          <SectionLabel text="Account balances over time — Dynamic Bracket · $K" color={A} />
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={areaData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="gtTaxable" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={A}  stopOpacity={0.3} /><stop offset="95%" stopColor={A}  stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gtRollover" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={BL} stopOpacity={0.3} /><stop offset="95%" stopColor={BL} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gtRoth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={G}  stopOpacity={0.3} /><stop offset="95%" stopColor={G}  stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="age" tick={{ fontSize: 12, fill: M }} />
              <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => `$${v}K`} />
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown, name: unknown) => [`$${Number(v).toLocaleString()}K`, String(name)]} />
              <Legend wrapperStyle={{ fontSize: 12, color: M }} />
              <Area type="monotone" dataKey="Taxable"  stroke={A}  fill="url(#gtTaxable)"  strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="Rollover" stroke={BL} fill="url(#gtRollover)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="Roth"     stroke={G}  fill="url(#gtRoth)"     strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <SectionLabel text="Withdrawal sources by year · $K" color={A} />
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={wdrawData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }} barSize={6}>
              <XAxis dataKey="age" tick={{ fontSize: 12, fill: M }} />
              <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => `$${v}K`} />
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown, name: unknown) => [`$${Number(v).toLocaleString()}K`, String(name)]} />
              <Legend wrapperStyle={{ fontSize: 12, color: M }} />
              <Bar dataKey="Divs"    stackId="w" fill={A}  opacity={0.8} />
              <Bar dataKey="IRA"     stackId="w" fill={BL} opacity={0.8} />
              <Bar dataKey="Taxable" stackId="w" fill={Y}  opacity={0.8} />
              <Bar dataKey="Roth"    stackId="w" fill={G}  opacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </TerminalSection>
      )}

      {/* Strategy comparison — read-only, explains why Dynamic Bracket is the recommendation */}
      {mode === 'advanced' && (
        <TerminalSection id="strategy-compare" title="Why Dynamic Bracket — Strategy Comparison" defaultOpen={false} accent={MU}>
          <div style={{ fontSize: 12, color: M, marginBottom: 10, lineHeight: 1.6 }}>
            {isConverged
              ? `Your portfolio is self-funding at a ${(withdrawal / totalPortfolio * 100).toFixed(1)}% withdrawal rate — all strategies produce similar outcomes. Dynamic Bracket is still used because it stays tax-optimal as conditions change.`
              : `Dynamic Bracket saves ${fmt(taxSavings)} in lifetime taxes vs the worst alternative by filling your lowest available bracket each year before pulling from other accounts.`}
          </div>

          {/* Read-only comparison table */}
          <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)', width: '100%', marginBottom: 12 }}>
            <thead>
              <tr>
                {['Strategy', 'Lifetime Tax', 'vs Dynamic Bracket', 'Ending Wealth', 'Roth Preserved', 'Survives Plan'].map((h, i) => (
                  <th key={h} style={{
                    padding: '4px 10px', textAlign: i === 0 ? 'left' : 'right',
                    fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px',
                    color: M, borderBottom: '1px solid var(--border2)', whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedStrategies.map(s => {
                const isDynamic = s.id === 'dynamic_bracket'
                const taxDiff = s.total_taxes - plan.total_taxes
                const survives = s.depleted_at_age == null
                const rowColor = isDynamic ? `${A}10` : 'transparent'
                return (
                  <tr key={s.id} style={{ background: rowColor }}>
                    <td style={{ padding: '5px 10px', fontWeight: isDynamic ? 700 : 400,
                      color: isDynamic ? A : 'var(--text1)', whiteSpace: 'nowrap' }}>
                      {isDynamic && <span style={{ color: A, marginRight: 5 }}>★</span>}
                      {s.label}
                      {isDynamic && <span style={{ fontSize: 12, color: A, marginLeft: 6,
                        background: `${A}20`, padding: '1px 5px', borderRadius: 0 }}>YOUR PLAN</span>}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right',
                      color: isDynamic ? G : 'var(--text1)', fontWeight: isDynamic ? 700 : 400 }}>
                      {fmt(s.total_taxes)}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                      {isDynamic
                        ? <span style={{ color: G, fontSize: 12 }}>— baseline —</span>
                        : <span style={{ color: taxDiff > 0 ? R : G, fontWeight: 500 }}>
                            {taxDiff > 0 ? '+' : ''}{fmt(taxDiff)} more tax
                          </span>
                      }
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right',
                      color: isDynamic ? 'var(--text1)' : M }}>
                      {fmt(s.ending_total)}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right',
                      color: isDynamic ? G : M }}>
                      {fmt(s.ending_roth)}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                      <span style={{
                        fontSize: 12, fontWeight: 500, padding: '2px 6px', borderRadius: 0,
                        background: survives ? `${G}15` : `${R}15`,
                        color: survives ? G : R,
                      }}>
                        {survives ? 'FULL PLAN' : `AGE ${s.depleted_at_age}`}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Lifetime tax bar chart — visual reinforcement */}
          <SectionLabel text="Lifetime taxes paid · $K — lower is better" color={R} />
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={barData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: M }} />
              <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => `$${v}K`} />
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown) => [`$${Number(v).toLocaleString()}K`, 'Lifetime taxes']} />
              <Bar dataKey="taxes" radius={[2, 2, 0, 0]}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={STRATEGY_COLORS[d.id as StrategyId]}
                    fillOpacity={d.id === 'dynamic_bracket' ? 1 : 0.35} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </TerminalSection>
      )}
    </div>
  )
}
