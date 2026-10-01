/**
 * SpendingPlanPanel — Safe Spending Range + Spending Guardrails
 * Lines ~1572–2328 of the original DrawdownTab.tsx
 */

import { useState, useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine,
  Legend,
} from 'recharts'
import { TerminalSection } from '../ui/Terminal'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import type { ViewMode } from '../ui/ModeToggle'
import type { DashboardData } from '../../types/dashboard'
import type { DrawdownResult, DrawdownInputs } from './drawdown.engine'
import { G, R, A, M, Y, BL, TL, fmt, SectionLabel, InputRow } from './drawdown.shared'

// ─── Spending Guardrails types ────────────────────────────────────────────────

interface GuardrailParams {
  upper_trigger_pct: number
  lower_trigger_pct: number
  raise_pct:         number
  cut_pct:           number
  ceiling_pct:       number
  floor_pct:         number
}

type GuardrailStatus = 'upper_crossed' | 'approaching_upper' | 'safe' | 'approaching_lower' | 'lower_crossed'

interface GuardrailYear {
  age:     number
  year:    number
  portfolio: number
  spending:  number
  upper_rail: number
  lower_rail: number
  status:    GuardrailStatus
  action:    string
  pct_of_initial: number
}

function computeGuardrailsSim(inputs: DrawdownInputs, params: GuardrailParams): GuardrailYear[] {
  const initialPortfolio = inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance
  const initialSpending  = inputs.annual_spending

  let portfolio = initialPortfolio
  let spending  = initialSpending
  const currentYear = new Date().getFullYear()
  const rows: GuardrailYear[] = []

  for (let age = inputs.current_age; age <= inputs.target_age; age++) {
    const year = currentYear + (age - inputs.current_age)

    // Grow portfolio
    portfolio *= (1 + inputs.expected_return)

    // Add SS income (reduces withdrawal need) — earner + spousal (1/2 earner
    // benefit, starting when the earner reaches the spouse's claiming-age
    // equivalent). Previously omitted spousal SS entirely even though the
    // sibling SpendingRangePanel in this same file narrates it as increasing
    // post-SS spending capacity, and drawdown.engine.ts's simulateStrategy
    // includes it — the guardrails sim understated guaranteed income and
    // would show earlier/more-frequent lower-rail crossings than the primary
    // engine for the same household.
    const earnerSS = age >= inputs.ss_start_age ? inputs.ss_annual : 0
    const spousalSS = inputs.spouse_ss_earner_age_start != null && age >= inputs.spouse_ss_earner_age_start
      ? inputs.ss_annual * 0.5 : 0
    const ss = earnerSS + spousalSS

    // Guardrail bounds (fixed $ rails tied to initial portfolio)
    const upperRail = initialPortfolio * (1 + params.upper_trigger_pct)
    const lowerRail = initialPortfolio * (1 - params.lower_trigger_pct)

    // Approach zones: within 10% of a rail
    const approachBand = initialPortfolio * 0.10

    // Check guardrail and adjust spending
    let status: GuardrailStatus = 'safe'
    let action = 'No change'

    if (portfolio >= upperRail) {
      const raised = Math.min(spending * (1 + params.raise_pct), initialSpending * params.ceiling_pct)
      if (raised > spending) {
        action = `Raise spending +${(params.raise_pct * 100).toFixed(0)}% → ${fmtMoney(raised)}/yr`
        spending = raised
      }
      status = 'upper_crossed'
    } else if (portfolio <= lowerRail) {
      const cut = Math.max(spending * (1 - params.cut_pct), initialSpending * params.floor_pct)
      if (cut < spending) {
        action = `Cut spending −${(params.cut_pct * 100).toFixed(0)}% → ${fmtMoney(cut)}/yr`
        spending = cut
      }
      status = 'lower_crossed'
    } else if (portfolio >= upperRail - approachBand) {
      status = 'approaching_upper'
      action = `Approaching upper rail — ${fmtMoney(upperRail - portfolio)} buffer`
    } else if (portfolio <= lowerRail + approachBand) {
      status = 'approaching_lower'
      action = `Approaching lower rail — ${fmtMoney(portfolio - lowerRail)} buffer`
    }

    // Withdraw spending (net of SS) from portfolio
    const netWithdrawal = Math.max(0, spending - ss)
    portfolio = Math.max(0, portfolio - netWithdrawal)

    rows.push({
      age, year, portfolio, spending,
      upper_rail: upperRail,
      lower_rail: lowerRail,
      status,
      action,
      pct_of_initial: initialPortfolio > 0 ? portfolio / initialPortfolio : 0,
    })

    spending *= (1 + inputs.inflation)  // inflation-adjust base for next year's comparison
  }

  return rows
}

const GUARDRAIL_STATUS_COLOR: Record<GuardrailStatus, string> = {
  upper_crossed:     G,
  approaching_upper: G,
  safe:              M,
  approaching_lower: A,
  lower_crossed:     R,
}

const GUARDRAIL_STATUS_LABEL: Record<GuardrailStatus, string> = {
  upper_crossed:     'UPPER CROSSED — Raise OK',
  approaching_upper: 'APPROACHING UPPER',
  safe:              'WITHIN GUARDRAILS',
  approaching_lower: 'APPROACHING LOWER',
  lower_crossed:     'LOWER CROSSED — Cut Required',
}

interface SSRBands { conservative: number; moderate: number; aggressive: number }

// ─── SpendingRangePanel ───────────────────────────────────────────────────────
function SpendingRangePanel({ result, inputs, mode, selectedTier, onSelectTier }: {
  result: DrawdownResult; inputs: DrawdownInputs; mode: ViewMode
  selectedTier?: string; onSelectTier?: (id: string) => void
}) {
  // Use dynamic_bracket as the reference strategy (most tax-optimal)
  const ref = result.strategies.find(s => s.id === 'dynamic_bracket') ?? result.strategies[0]
  const depletes = ref.depleted_at_age
  const horizon  = inputs.target_age - inputs.current_age
  const shortfallFree = ref.shortfall_years === 0
  const endingRatio = ref.ending_total / (inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance)

  // Safe / comfortable / aggressive bands
  const tiers = [
    { id: 'conservative', label: 'CONSERVATIVE',  pct: 90, desc: 'Works in nearly all market environments, including a prolonged early-retirement downturn.',  color: G },
    { id: 'moderate',     label: 'MODERATE',      pct: 75, desc: 'Works in most conditions — may need a modest spending cut in a prolonged early-retirement bear market.', color: Y },
    { id: 'maximum',      label: 'MAXIMUM',       pct: 50, desc: 'Spending ceiling only — fails in half of modeled scenarios. Not recommended as a primary planning target.', color: R },
  ]

  // Scale spending recommendations from ending ratio
  const baseSpend = inputs.annual_spending
  const safeSpend       = baseSpend * (shortfallFree ? 1.0 : 0.85)
  const moderateSpend   = baseSpend * (shortfallFree ? 1.10 : 0.95)
  const aggressiveSpend = baseSpend * (shortfallFree ? 1.20 : 1.05)

  const tierValues = [safeSpend, moderateSpend, aggressiveSpend]

  // Annual totals chart for reference strategy
  const spendData = ref.years.filter((_, i) => i % 2 === 0).map(y => ({
    age: y.age,
    Met: Math.round(y.spending_met ? inputs.annual_spending * Math.pow(1 + inputs.inflation, y.age - inputs.current_age) / 1000 : 0),
    Shortfall: Math.round(y.shortfall / 1000),
  }))

  const totalPortfolioSP = inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance
  const withdrawalRateSP = totalPortfolioSP > 0 ? (baseSpend / totalPortfolioSP * 100) : 0
  const isUnderspendingSP = endingRatio > 3
  const isVeryLowWithdrawal = withdrawalRateSP < 2

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* ── Two concepts: Lifestyle Spending vs Income Target ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: 'var(--surface)', borderRadius: 0, border: `1px solid ${G}`, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>Lifestyle Spending</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500, color: 'var(--text1)' }}>
            {fmtMoney(inputs.annual_spending)}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>per year · actual tracked spending</div>
          <div style={{ fontSize: 12, color: M, marginTop: 8, lineHeight: 1.5, borderTop: '1px solid var(--border2)', paddingTop: 7 }}>
            Your <strong style={{ color: 'var(--text1)' }}>real cost of living.</strong>{' '}
            The three Safe Spending Range tiers are built entirely from this number — Conservative, Moderate, and Maximum all scale from here.
          </div>
        </div>
        <div style={{ background: 'var(--surface)', borderRadius: 0, border: `1px solid ${BL}`, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>Income Target (Drawdown)</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500, color: BL }}>
            {fmtMoney(inputs.income_target)}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>per year · bracket &amp; Roth sizing target</div>
          <div style={{ fontSize: 12, color: M, marginTop: 8, lineHeight: 1.5, borderTop: '1px solid var(--border2)', paddingTop: 7 }}>
            Set higher than lifestyle to <strong style={{ color: 'var(--text1)' }}>fill the 24% bracket</strong> and fund Roth conversions.
            This is not your living expenses — it's a tax-management tool. Safe Spending Range ignores it.
          </div>
        </div>
      </div>

      {/* ── Key insights ── */}
      <div style={{ padding: '8px 12px', borderRadius: 0, background: 'var(--surface)',
        border: `1px solid ${isUnderspendingSP ? `${Y}` : `${G}25`}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            ...(isUnderspendingSP ? [
              { icon: '→', color: Y, text: `Underspending at ${withdrawalRateSP.toFixed(1)}% withdrawal rate — portfolio grows faster than you spend it. You can safely spend more.` },
              { icon: '✓', color: G, text: `Recommended: start at Moderate ${fmtMoney(moderateSpend)}/yr (${fmtMoney(moderateSpend / 12)}/mo). No lifestyle sacrifice required.` },
            ] : [
              { icon: '✓', color: G, text: `Recommended baseline: ${fmtMoney(moderateSpend)}/yr. Portfolio supports this across most market scenarios.` },
            ]),
            { icon: '→', color: A, text: `Floor: ${fmtMoney(safeSpend)}/yr — never cut below this. Ceiling: ${fmtMoney(aggressiveSpend)}/yr.` },
            ...(isVeryLowWithdrawal ? [
              { icon: '→', color: Y, text: `${withdrawalRateSP.toFixed(1)}% withdrawal rate is very low — guardrails will trigger automatic spending raises most years.` },
            ] : []),
            ...(isUnderspendingSP ? [
              { icon: '→', color: M, text: `Ending portfolio: ${fmt(ref.ending_total)} at age ${inputs.target_age} (${endingRatio.toFixed(0)}× today). You are building generational wealth.` },
            ] : []),
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 12, color: item.color, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
              <span style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Income target does not affect this tab */}
      <div style={{
        padding: '7px 12px', borderRadius: 0,
        background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
        fontSize: 12, color: M, lineHeight: 1.5,
      }}>
        Safe Spending Range is based on <strong style={{ color: 'var(--text2)' }}>lifestyle spending, portfolio longevity, and inflation</strong> —
        not the income target. The income target slider (used in Decision Engine / Optimizer / Tax Minimizer) does not affect these bands.
        {' '}Conservative band = current tracked spending ({fmtMoney(baseSpend)}) — portfolio can actually support significantly higher withdrawals at this {((baseSpend / (inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance)) * 100).toFixed(1)}% withdrawal rate.
        Success rates are scenario-based (bear/base/bull), not full Monte Carlo — see Overview tab for probability-based analysis.
      </div>

      {/* Tier cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {tiers.map((t, i) => {
          const isSelected = selectedTier === t.id
          return (
            <div key={t.id}
              onClick={() => onSelectTier?.(t.id)}
              style={{
                background: isSelected ? 'var(--panel2)' : 'var(--surface)',
                border: isSelected ? `1px solid ${t.color}` : '1px solid rgba(255,255,255,0.07)',
                borderTop: `3px solid ${t.color}`, borderRadius: 0, padding: '12px 14px',
                cursor: onSelectTier ? 'pointer' : 'default',
                transition: 'background 0.15s, border 0.15s',
              }}
              onMouseEnter={e => { if (!isSelected && onSelectTier) e.currentTarget.style.background = 'var(--panel)' }}
              onMouseLeave={e => { if (!isSelected && onSelectTier) e.currentTarget.style.background = 'var(--surface)' }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: t.color, textTransform: 'uppercase',
                letterSpacing: '0.7px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                {isSelected && <span>▶</span>}
                {t.label} · {t.pct}% SUCCESS
              </div>
              <div style={{ fontSize: 24, fontWeight: 500, fontFamily: 'var(--font-mono)', color: t.color }}>
                {fmtMoneyFull(tierValues[i])}
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>per year · inflation-adjusted</div>
              <div style={{ fontSize: 12, color: M, marginTop: 6, lineHeight: 1.5 }}>{t.desc}</div>
              <div style={{ fontSize: 12, color: M, marginTop: 4, opacity: 0.65 }}>
                {shortfallFree
                  ? `${t.pct}% scenario — bands are illustrative (±10%/±20% of tracked spending)`
                  : `${t.pct}% scenario — sub-optimal (portfolio has shortfall years)`}
              </div>
              {isSelected && onSelectTier && (
                <div style={{ fontSize: 12, color: t.color, marginTop: 6, fontWeight: 500 }}>
                  ↓ Guardrails set to this spending
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* SS two-phase context */}
      {inputs.ss_annual > 0 && (
        <div style={{
          padding: '8px 12px', borderRadius: 0,
          background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
          borderLeft: `3px solid ${G}`, fontSize: 12, lineHeight: 1.6,
        }}>
          <span style={{ color: G, fontWeight: 500 }}>SS at {inputs.ss_start_age} adds {fmtMoneyFull(inputs.ss_annual)}/yr</span>
          <span style={{ color: M }}> · Pre-SS (ages {inputs.current_age.toFixed(0)}–{inputs.ss_start_age}): portfolio funds full spending · Post-SS (ages {inputs.ss_start_age}+): portfolio supplement drops to <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(Math.max(0, safeSpend - inputs.ss_annual))}</span>/yr — conservative band is well within SS coverage</span>
          {inputs.spouse_ss_earner_age_start != null && (
            <span style={{ color: M }}> · Spousal SS (~{fmtMoneyFull(inputs.ss_annual * 0.5)}/yr) adds when you reach age {inputs.spouse_ss_earner_age_start} — increases post-{inputs.spouse_ss_earner_age_start} spending capacity further</span>
          )}
        </div>
      )}

      {/* Key insight tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>PLAN HORIZON</div>
          <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)', color: A }}>{horizon} yrs</div>
          <div style={{ fontSize: 12, color: M }}>age {inputs.current_age.toFixed(0)} → {inputs.target_age}</div>
          <div style={{ fontSize: 12, color: M, marginTop: 1 }}>adjust in Drawdown Parameters if targeting age 100</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>PORTFOLIO SURVIVES</div>
          <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)',
            color: depletes == null ? G : depletes >= inputs.target_age - 2 ? Y : R }}>
            {depletes == null ? 'FULL PLAN' : `TO AGE ${depletes}`}
          </div>
          <div style={{ fontSize: 12, color: M }}>dynamic bracket strategy</div>
          {(() => {
            const initPort = inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance
            const wRate = initPort > 0 ? (inputs.annual_spending / initPort * 100).toFixed(1) : null
            return wRate && <div style={{ fontSize: 12, color: G, marginTop: 1 }}>{wRate}% withdrawal rate · all strategies survive</div>
          })()}
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>ENDING WEALTH RATIO</div>
          <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)',
            color: endingRatio >= 1 ? G : endingRatio >= 0.5 ? Y : R }}>
            {(endingRatio * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: 12, color: M }}>nominal · Dynamic Bracket · median outcome</div>
          <div style={{ fontSize: 12, color: M, marginTop: 1 }}>
            real (today's $): ~{(endingRatio / Math.pow(1 + inputs.inflation, horizon) * 100).toFixed(0)}% · not a guarantee
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>SHORTFALL YEARS</div>
          <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)',
            color: ref.shortfall_years === 0 ? G : ref.shortfall_years < 3 ? Y : R }}>
            {ref.shortfall_years}
          </div>
          <div style={{ fontSize: 12, color: M }}>years spending not fully met</div>
        </div>
      </div>

      {/* Spending met vs shortfall chart */}
      {mode === 'advanced' && (
        <TerminalSection id="spending-met" title="Spending Coverage — Met vs Shortfall" defaultOpen accent={G}>
          <SectionLabel text={`Annual spending (dynamic bracket, nominal $) — bars grow with inflation: $${Math.round(safeSpend/1000)}K today → ~$${Math.round(safeSpend * Math.pow(1 + inputs.inflation, horizon) / 1000)}K by age ${inputs.target_age}`} color={G} />
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={spendData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }} barSize={8}>
              <XAxis dataKey="age" tick={{ fontSize: 12, fill: M }} />
              <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => `$${v}K`} />
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown, name: unknown) => [`$${Number(v).toLocaleString()}K`, String(name)]} />
              <Legend wrapperStyle={{ fontSize: 12, color: M }} />
              <Bar dataKey="Met"       stackId="s" fill={G}  opacity={0.85} />
              <Bar dataKey="Shortfall" stackId="s" fill={R}  opacity={0.85} />
              <ReferenceLine y={safeSpend / 1000} stroke={G} strokeDasharray="3 2"
                label={{ value: `Conserv. ${fmtMoney(safeSpend)} today`, position: 'right', fontSize: 12, fill: G }} />
              <ReferenceLine y={moderateSpend / 1000} stroke={Y} strokeDasharray="3 2"
                label={{ value: `Moderate ${fmtMoney(moderateSpend)} today`, position: 'right', fontSize: 12, fill: Y }} />
              <ReferenceLine y={aggressiveSpend / 1000} stroke={R} strokeDasharray="3 2"
                label={{ value: `Maximum ${fmtMoney(aggressiveSpend)} today`, position: 'right', fontSize: 12, fill: R }} />
            </BarChart>
          </ResponsiveContainer>
        </TerminalSection>
      )}
    </div>
  )
}

// ─── SpendingGuardrailsPanel ──────────────────────────────────────────────────
function SpendingGuardrailsPanel({ inputs, ssrBands, mode, initialSpendOverride }: {
  inputs: DrawdownInputs
  data?: DashboardData
  ssrBands: SSRBands
  mode: ViewMode
  initialSpendOverride?: number
}) {
  const initialPortfolio = inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance
  const initialSpending  = initialSpendOverride ?? inputs.annual_spending

  // Default ceiling/floor derived from SSR bands so guardrails are anchored to SSR analysis
  const defaultCeilingPct = initialSpending > 0 ? ssrBands.aggressive / initialSpending : 1.20
  const defaultFloorPct   = initialSpending > 0 ? ssrBands.conservative / initialSpending : 0.85

  const [params, setParams] = useState<GuardrailParams>({
    upper_trigger_pct: 0.20,
    lower_trigger_pct: 0.20,
    raise_pct:         0.10,
    cut_pct:           0.10,
    ceiling_pct:       Math.round(defaultCeilingPct * 20) / 20,  // round to nearest 0.05
    floor_pct:         Math.round(defaultFloorPct   * 20) / 20,
  })

  const rows = useMemo(() => computeGuardrailsSim({ ...inputs, annual_spending: initialSpending }, params), [inputs, params, initialSpending])

  const currentRow   = rows[0]
  const currentStatus = currentRow?.status ?? 'safe'
  const statusColor   = GUARDRAIL_STATUS_COLOR[currentStatus]
  const upperRail     = initialPortfolio * (1 + params.upper_trigger_pct)
  const lowerRail     = initialPortfolio * (1 - params.lower_trigger_pct)

  // Chart data
  const chartData = rows.filter((_, i) => i % 2 === 0).map(r => ({
    age:       r.age,
    Portfolio: Math.round(r.portfolio / 1000),
    Upper:     Math.round(r.upper_rail  / 1000),
    Lower:     Math.round(r.lower_rail  / 1000),
  }))

  const spendData = rows.filter((_, i) => i % 2 === 0).map(r => ({
    age:      r.age,
    Guardrail: Math.round(r.spending / 1000),
    Fixed:     Math.round(inputs.annual_spending * Math.pow(1 + inputs.inflation, r.age - inputs.current_age) / 1000),
  }))

  // Stats
  const guardRaisedYears  = rows.filter(r => r.status === 'upper_crossed').length
  const guardCutYears     = rows.filter(r => r.status === 'lower_crossed').length
  const finalSpending     = rows[rows.length - 1]?.spending ?? initialSpending
  const finalPortfolio    = rows[rows.length - 1]?.portfolio ?? 0
  const spendRange        = { min: Math.min(...rows.map(r => r.spending)), max: Math.max(...rows.map(r => r.spending)) }
  const withdrawalRate    = initialPortfolio > 0 ? (initialSpending / initialPortfolio) * 100 : 0
  const isLowWithdrawal   = withdrawalRate < 2.5
  const isOverSaving      = finalPortfolio / initialPortfolio > 5
  const spendablePortfolio = inputs.taxable_balance + inputs.roth_balance
  const hasRollover        = inputs.rollover_balance > 0

  const setParam = <K extends keyof GuardrailParams>(k: K, v: number) =>
    setParams(p => ({ ...p, [k]: v }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Explainer */}
      <div style={{
        padding: '8px 14px', borderRadius: 0,
        background: 'var(--fd-card)', border: `1px solid ${TL}`,
        borderLeft: `3px solid ${TL}`, fontSize: 12, color: M, lineHeight: 1.7,
      }}>
        <strong style={{ color: TL }}>◈ SPENDING GUARDRAILS — Modern Guardrails Method</strong>
        <span style={{ marginLeft: 6, fontSize: 12, color: M, fontStyle: 'italic' }}>Based on Guyton-Klinger framework (2006)</span>
        <span style={{ marginLeft: 10 }}>
          Spending is fixed until a portfolio guardrail is crossed.
          Upper rail crossed → raise spending. Lower rail crossed → cut spending.
          Adjustments are mechanical, not annual — only when a rail is breached.
        </span>
      </div>

      {/* Low withdrawal rate calibration warning */}
      {isLowWithdrawal && (
        <div style={{
          padding: '8px 12px', borderRadius: 0,
          background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
          borderLeft: `3px solid ${Y}`, fontSize: 12, color: Y, lineHeight: 1.6,
        }}>
          <strong> Withdrawal rate {withdrawalRate.toFixed(1)}% — guardrails designed for ~4% rate</strong>
          <span style={{ color: M, fontWeight: 400 }}> · At {withdrawalRate.toFixed(1)}%, the portfolio compounds far faster than spending adjustments can keep pace.
          Upper rail will cross nearly every year, making the system a one-sided spending escalator rather than a two-sided guardrail.
          Guardrails work best starting at $196K–$224K/yr spending (3.5–4% of {fmtMoney(initialPortfolio)} portfolio).
          Consider increasing the initial spending target to use guardrails effectively.</span>
        </div>
      )}

      {/* Rollover IRA note */}
      {hasRollover && (
        <div style={{
          padding: '7px 12px', borderRadius: 0,
          background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
          fontSize: 12, color: M, lineHeight: 1.5,
        }}>
          <strong style={{ color: A }}>Portfolio base includes {fmtMoney(inputs.rollover_balance)} Rollover IRA</strong>
          <span> (conversion vehicle — not freely spendable). Spendable portfolio: </span>
          <strong style={{ color: 'var(--text2)' }}>{fmtMoneyFull(spendablePortfolio)}</strong>
          <span> · Adjusted rails: </span>
          <span style={{ color: G }}>{fmtMoney(spendablePortfolio * (1 + params.upper_trigger_pct))} upper</span>
          <span> / </span>
          <span style={{ color: R }}>{fmtMoney(spendablePortfolio * (1 - params.lower_trigger_pct))} lower</span>
        </div>
      )}

      {/* SSR Foundation — the link between Safe Spending Range (analysis) and Guardrails (policy) */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
        borderRadius: 0, padding: '10px 14px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase',
          letterSpacing: '0.7px', marginBottom: 8 }}>
          FOUNDATION — SAFE SPENDING RANGE  ·  <span style={{ color: M, fontWeight: 400 }}>Analysis layer · What is safe</span>
          <span style={{ marginLeft: 16, color: TL }}>↓  Guardrails use these bands as ceiling / floor anchors</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[
            { label: 'CONSERVATIVE · 90% success', value: ssrBands.conservative, color: G,
              note: 'SSR floor → Guardrails spending floor' },
            { label: 'MODERATE · 75% success',     value: ssrBands.moderate,     color: Y,
              note: 'SSR midpoint → Target spending baseline' },
            { label: 'MAXIMUM · 50% success',   value: ssrBands.aggressive,   color: R,
              note: 'SSR ceiling → Guardrails spending ceiling' },
          ].map(b => (
            <div key={b.label} style={{
              background: 'var(--panel)', border: `1px solid var(--fd-hairline)`,
              borderTop: `2px solid ${b.color}`, borderRadius: 0, padding: '8px 10px',
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: b.color, textTransform: 'uppercase',
                letterSpacing: '0.5px', marginBottom: 3 }}>{b.label}</div>
              <div style={{ fontSize: 20, fontWeight: 500, fontFamily: 'var(--font-mono)', color: b.color }}>
                {fmt(b.value)}
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 3 }}>{b.note}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: M, lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text2)' }}>Safe Spending Range = diagnosis.</strong>
          {' '}It tells you what is statistically safe. Guardrails = policy.
          They tell you when to act. Start spending at the Moderate band and let guardrails
          govern future adjustments — no judgment calls required.
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
        {[
          { label: 'INITIAL PORTFOLIO',   value: fmt(initialPortfolio), color: A },
          { label: 'UPPER GUARDRAIL',     value: fmt(upperRail),        color: G, sub: `+${(params.upper_trigger_pct*100).toFixed(0)}% of initial` },
          { label: 'LOWER GUARDRAIL',     value: fmt(lowerRail),        color: R, sub: `−${(params.lower_trigger_pct*100).toFixed(0)}% of initial` },
          { label: 'CURRENT STATUS',      value: GUARDRAIL_STATUS_LABEL[currentStatus], color: statusColor, small: true },
          { label: `SPENDING AT AGE ${inputs.target_age}`, value: fmt(finalSpending), color: finalSpending > initialSpending ? G : finalSpending < initialSpending ? R : M },
        ].map(t => (
          <div key={t.label} style={{
            background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
            borderRadius: 0, padding: '8px 10px',
            borderTop: `2px solid ${t.color}`,
          }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{t.label}</div>
            <div style={{ fontSize: t.small ? 13 : 16, fontWeight: 500, fontFamily: t.small ? 'var(--font-sans)' : 'var(--font-mono)', color: t.color, lineHeight: 1.3 }}>
              {t.value}
            </div>
            {t.sub && <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* Guardrail parameter controls */}
      {mode === 'advanced' && (<>
      <TerminalSection id="guardrail-params" title="Guardrail Parameters" defaultOpen accent={TL}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <SectionLabel text="Trigger Thresholds" color={TL} />
            <InputRow label="Upper guardrail (portfolio % above initial)"
              value={params.upper_trigger_pct} onChange={v => setParam('upper_trigger_pct', v)}
              min={0.05} max={0.50} step={0.05} format="pct" />
            <InputRow label="Lower guardrail (portfolio % below initial)"
              value={params.lower_trigger_pct} onChange={v => setParam('lower_trigger_pct', v)}
              min={0.05} max={0.50} step={0.05} format="pct" />
          </div>
          <div>
            <SectionLabel text="Spending Adjustments" color={TL} />
            <InputRow label="Raise amount when upper crossed"
              value={params.raise_pct} onChange={v => setParam('raise_pct', v)}
              min={0.05} max={0.25} step={0.05} format="pct" />
            <InputRow label="Cut amount when lower crossed"
              value={params.cut_pct} onChange={v => setParam('cut_pct', v)}
              min={0.05} max={0.25} step={0.05} format="pct" />
            <InputRow label="Per-raise ceiling (× initial) — not a lifetime cap"
              value={params.ceiling_pct} onChange={v => setParam('ceiling_pct', v)}
              min={1.10} max={2.00} step={0.05} format="pct" />
            <InputRow label="Spending floor (× initial) — based on tracked spending"
              value={params.floor_pct} onChange={v => setParam('floor_pct', v)}
              min={0.40} max={0.95} step={0.05} format="pct" />
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: M, lineHeight: 1.5, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span>Upper rail: <strong style={{ color: G }}>{fmt(upperRail)}</strong></span>
          <span>Lower rail: <strong style={{ color: R }}>{fmt(lowerRail)}</strong></span>
          <span>Per-raise ceiling: <strong style={{ color: G }}>{fmt(initialSpending * params.ceiling_pct)}/yr</strong> <span style={{ fontSize: 12, opacity: 0.7 }}>(spending grows with inflation from ceiling level)</span></span>
          <span>Floor: <strong style={{ color: R }}>{fmt(initialSpending * params.floor_pct)}/yr</strong> <span style={{ fontSize: 12, opacity: 0.7 }}>(based on tracked spending — adjust if minimum lifestyle differs)</span></span>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ color: isLowWithdrawal && guardRaisedYears > rows.length * 0.7 ? Y : G }}>
            Rail years raised: <strong>{guardRaisedYears}</strong>
            {isLowWithdrawal && guardRaisedYears > rows.length * 0.7 && <span style={{ color: Y }}> — upper rail crosses annually (low withdrawal rate, not a guardrail signal)</span>}
          </span>
          <span style={{ color: guardCutYears > 0 ? R : M }}>Rail years cut: <strong>{guardCutYears}</strong></span>
          <span style={{ color: isOverSaving ? Y : finalPortfolio > 0 ? G : R }}>
            Final portfolio: <strong>{fmt(finalPortfolio)}</strong>
            {isOverSaving && <span style={{ color: Y }}> — undersaving signal · guardrails designed for ~4% withdrawal rate</span>}
          </span>
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: M, opacity: 0.7 }}>
          Rails are fixed at initial values ({fmt(upperRail)}/{fmt(lowerRail)}) and do not adjust for portfolio growth —
          illustrative only. For active management, reset parameters annually.
        </div>
      </TerminalSection>

      {/* Portfolio vs rails chart */}
      <TerminalSection id="guardrail-portfolio" title="Portfolio vs Guardrail Corridors" defaultOpen accent={TL}>
        <SectionLabel text="Portfolio total (solid) · Upper rail (green dashed) · Lower rail (red dashed) · Rails are fixed at initial values" color={TL} />
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="age" tick={{ fontSize: 12, fill: M }}
              label={{ value: 'Age', position: 'insideBottomRight', fontSize: 12, fill: M, offset: -4 }} />
            <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}M` : `$${v}K`} />
            <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
              formatter={(v: unknown, name: unknown) => [`$${Number(v).toLocaleString()}K`, String(name)]} />
            <Legend wrapperStyle={{ fontSize: 12, color: M }} />
            <ReferenceLine y={0} stroke={R} strokeDasharray="3 3" />
            <Line type="monotone" dataKey="Upper"     stroke={G}  strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
            <Line type="monotone" dataKey="Lower"     stroke={R}  strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
            <Line type="monotone" dataKey="Portfolio" stroke={TL} strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </TerminalSection>

      {/* Guardrail spending vs fixed spending */}
      <TerminalSection id="guardrail-spending" title="Spending: Guardrail-Adaptive vs Fixed · $K/yr" defaultOpen accent={G}>
        <SectionLabel text="Adaptive spending (guardrails) vs fixed inflation-adjusted spending" color={G} />
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={spendData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="age" tick={{ fontSize: 12, fill: M }} />
            <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => `$${v}K`} />
            <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
              formatter={(v: unknown, name: unknown) => [`$${Number(v).toLocaleString()}K`, String(name)]} />
            <Legend wrapperStyle={{ fontSize: 12, color: M }} />
            <Line type="monotone" dataKey="Guardrail" stroke={TL} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Fixed"     stroke={M}  strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ marginTop: 6, fontSize: 12, color: M, lineHeight: 1.5 }}>
          Spending range over plan horizon:
          <strong style={{ color: G, marginLeft: 6 }}>{fmt(spendRange.min)}/yr min</strong>
          <strong style={{ color: G, marginLeft: 6 }}>{fmt(spendRange.max)}/yr max</strong>
          <span style={{ marginLeft: 12 }}>· {fmtMoney(spendRange.min / 12)}/mo floor · {fmtMoney(spendRange.max / 12)}/mo ceiling</span>
        </div>
        {(() => {
          const firstRaise = rows.find(r => r.status === 'upper_crossed' && r.action !== 'No change')
          return firstRaise ? (
            <div style={{ marginTop: 4, fontSize: 12, color: TL }}>
              First raise at age {firstRaise.age.toFixed(1)}: {firstRaise.action} · Fixed line tracks inflation only — guardrail line raises at each trigger event
            </div>
          ) : null
        })()}
      </TerminalSection>

      {/* Year-by-year guardrail table */}
      <TerminalSection id="guardrail-table" title="Year-by-Year Guardrail Status" defaultOpen={false} accent={M}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{ background: 'var(--panel2)', color: M }}>
                {['Age', 'Year', 'Portfolio', '% of Initial', 'Upper Rail', 'Lower Rail', 'Status', 'Spending/yr', `Real $/yr (${new Date().getFullYear()}$)`, 'Action'].map(h => (
                  <th key={h} style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 500,
                    letterSpacing: '0.4px', textTransform: 'uppercase', borderBottom: '1px solid var(--border2)',
                    whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const sc = GUARDRAIL_STATUS_COLOR[r.status]
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--panel)' }}>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: M }}>{r.age}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: M }}>{r.year}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500,
                      color: r.portfolio > lowerRail ? G : R }}>{fmt(r.portfolio)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right',
                      color: r.pct_of_initial >= 1 ? G : r.pct_of_initial >= 0.8 ? Y : R }}>
                      {(r.pct_of_initial * 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: G }}>{fmt(r.upper_rail)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: R }}>{fmt(r.lower_rail)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: sc, fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {r.status === 'safe' ? '✓ Safe' :
                       r.status === 'upper_crossed' ? '▲ Raise' :
                       r.status === 'lower_crossed' ? '▼ Cut' :
                       r.status === 'approaching_upper' ? '↗ Near Upper' : '↘ Near Lower'}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500,
                      color: r.spending > initialSpending * 1.01 ? G : r.spending < initialSpending * 0.99 ? R : 'var(--text1)' }}>
                      {fmt(r.spending)}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: M, fontSize: 12 }}>
                      {fmt(r.spending / Math.pow(1 + inputs.inflation, r.age - inputs.current_age))}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: M, fontSize: 12, whiteSpace: 'nowrap' }}>
                      {r.status === 'upper_crossed'
                        ? (r.action === 'No change' ? '▲ at ceiling — auto-raise blocked' : r.action)
                        : r.status === 'lower_crossed'
                        ? (r.action === 'No change' ? '▼ at floor — auto-cut blocked' : r.action)
                        : r.action === 'No change' ? '—' : r.action}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </TerminalSection>

      {/* How guardrails work */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        padding: '10px 14px',
        background: 'var(--fd-card)', border: `1px solid ${TL}`,
        borderRadius: 0, fontSize: 12, color: M, lineHeight: 1.7,
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: G, letterSpacing: '0.8px', marginBottom: 4 }}>▲ UPPER GUARDRAIL CROSSED</div>
          Portfolio grew {(params.upper_trigger_pct*100).toFixed(0)}%+ above initial ({fmt(upperRail)}).
          Raise spending by {(params.raise_pct*100).toFixed(0)}% (max {fmt(initialSpending * params.ceiling_pct)}/yr).
          This rewards strong performance — spend more, don't just accumulate.
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: R, letterSpacing: '0.8px', marginBottom: 4 }}>▼ LOWER GUARDRAIL CROSSED</div>
          Portfolio fell {(params.lower_trigger_pct*100).toFixed(0)}%+ below initial ({fmt(lowerRail)}).
          Cut spending by {(params.cut_pct*100).toFixed(0)}% (floor {fmt(initialSpending * params.floor_pct)}/yr).
          This is the safety valve — a mechanical response that extends longevity without judgment calls.
        </div>
      </div>
      </>)}
    </div>
  )
}

// ─── Spending Plan (merged SSR + Guardrails) ─────────────────────────────────
export function SpendingPlanPanel({ result, inputs, data, mode }: {
  result: DrawdownResult; inputs: DrawdownInputs; data: DashboardData; mode: ViewMode
}) {
  const [selectedTier, setSelectedTier] = useState<'conservative' | 'moderate' | 'maximum'>('moderate')

  const ref = result.strategies.find(s => s.id === 'dynamic_bracket') ?? result.strategies[0]
  const shortfallFree = ref.shortfall_years === 0
  const base = inputs.annual_spending
  const ssrBands: SSRBands = {
    conservative: base * (shortfallFree ? 1.0  : 0.85),
    moderate:     base * (shortfallFree ? 1.10 : 0.95),
    aggressive:   base * (shortfallFree ? 1.20 : 1.05),
  }

  const selectedSpend = selectedTier === 'conservative' ? ssrBands.conservative
    : selectedTier === 'maximum' ? ssrBands.aggressive
    : ssrBands.moderate

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Purpose statement */}
      <div style={{ fontSize: 12, color: M, lineHeight: 1.6, padding: '6px 10px',
        borderLeft: `3px solid ${TL}`, background: `${TL}0a` }}>
        <strong style={{ color: 'var(--text1)' }}>How much can you spend — and how do you adjust over time?</strong>{' '}
        Select a spending tier below. Guardrails will show how that starting level adjusts when the market moves.
      </div>

      {/* ── Part 1: Safe Spending Range ────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: G, letterSpacing: '0.8px',
          textTransform: 'uppercase', marginBottom: 8, paddingBottom: 4,
          borderBottom: '1px solid var(--border2)' }}>
          SAFE SPENDING RANGE — Pick a starting level
        </div>
        <SpendingRangePanel result={result} inputs={inputs} mode={mode}
          selectedTier={selectedTier} onSelectTier={t => setSelectedTier(t as typeof selectedTier)} />
      </div>

      {/* ── Part 2: Spending Guardrails ────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: TL, letterSpacing: '0.8px',
          textTransform: 'uppercase', marginBottom: 8, paddingBottom: 4,
          borderBottom: '1px solid var(--border2)' }}>
          SPENDING GUARDRAILS — Adaptive policy starting from {selectedTier} ({fmtMoney(selectedSpend)}/yr)
        </div>
        <SpendingGuardrailsPanel key={selectedTier} inputs={inputs} data={data} ssrBands={ssrBands}
          mode={mode} initialSpendOverride={selectedSpend} />
      </div>
    </div>
  )
}
