import { useState, useMemo, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS, TOOLTIP_CURSOR } from '../ui/chartTooltip'
import { SectionHeader } from '../ui/SectionHeader'
import { TerminalSection } from '../ui/Terminal'
import { fmtMoneyFull, fmtFull } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE, DEFAULT_SAFETY_BUFFER, ROLLOVER_DEPLETED_THRESHOLD } from '../../utils/constants'
import { RMD_START_AGE, RMD_FACTORS, IRMAA_TIERS_MFJ, IRMAA_TIERS_SINGLE, DRAWDOWN_DEFAULTS } from '../../utils/taxConfig'
import { StatTile } from '../ui/StatTile'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { IncomeBanner } from '../ui/IncomeBanner'
import { TabBriefingPanel } from '../ui/TabBriefingPanel'
import { SubTabBtn, SubTabBar } from '../ui/SubTabBtn'
import { PageHero, LeadMuted, DecisionPlane, KpiStrip, Label, mono, moneyUnit, type Kpi } from '../ui/primitives'
import type { DashboardData, ProjectionRow } from '../../types/dashboard'
import { A, G, M, R, Y } from './taxColors'
import { computeRetirementDecision } from '../../utils/retirementEngine'
import { computeConversionVerdict, verdictTone } from '../../utils/conversionVerdict'
import { ConversionStatusPanel } from '../conversion/ConversionStatusPanel'
import { RoomCalcPanel, AgiEnginePanel, ScorePanel, TimingEnginePanel } from '../conversion/LogicEnginePanel'
import { AccountImpactPanel } from '../conversion/AccountImpactPanel'
import { TaxImpactPanel } from '../conversion/TaxImpactPanel'
import { ConversionCalendarPanel } from '../conversion/ConversionCalendarPanel'
import { ProjectionPanel } from '../conversion/ProjectionPanel'
import { ConversionScenarios } from '../conversion/ConversionScenarios'
import { RmdScenarioPanel } from '../conversion/RmdScenarioPanel'
import { PersonalInfo } from './PersonalInfo'
import { PortfolioScores } from './PortfolioScores'
import { QuarterlyPayments } from './QuarterlyPayments'
import { CashflowEngine } from './CashflowEngine'
import { DividendCharacter } from './DividendCharacter'
import { WithSSScenario } from './WithSSScenario'
import { DividendCalendar } from './DividendCalendar'
import { RebalanceScore } from './RebalanceScore'
import { DivBreakdownTable } from './DivBreakdownTable'
import { BracketMeter } from './BracketMeter'
import { WithdrawalStrategyPanel } from './WithdrawalStrategyPanel'
import { SSOptions } from './SSOptions'
import { recalculateTaxWithSS } from './ssOptionsUtils'
import { RealizedSalesTaxPanel } from './RealizedSalesTaxPanel'
import { LotAdvisor } from '../portfolio/LotAdvisor'
import { RebalancePlanPanel } from '../drawdown/RebalancePlanPanel'

type SubView = 'tax' | 'roth' | 'sell'

interface Props { data: DashboardData }

// Sub-nav pills come from the shared ui/SubTabBtn — one implementation for all tabs.

export function TaxTab({ data }: Props) {
  const [mode] = useGlobalViewMode()
  const [subView, setSubView] = useState<SubView>('tax')
  const [_selectedSSAge, setSelectedSSAge] = useState<number | null>(null)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [dynamicTaxData, setDynamicTaxData] = useState(data.tax_data)

  // Reset the client-side SS scenario whenever fresh server data arrives —
  // otherwise a refetch leaves the whole tab stuck on the stale what-if data.
  useEffect(() => {
    setDynamicTaxData(data.tax_data)
    setSelectedSSAge(null)
  }, [data.tax_data])

  // Use dynamic data if available, otherwise use original
  const tx = dynamicTaxData || data.tax_data

  // ── Roth conversion derived values (for sub-view) ──────────────────────────
  const ytdConverted   = tx?.converted_ytd ?? 0
  const annualTarget   = tx?.annual_conversion ?? 0
  const rolloverBal    = tx?.rollover_balance ?? 0
  // The annual target is a fixed plan figure — it doesn't know the Rollover IRA
  // can run out mid-plan. Once the account is (near) empty there is nothing left
  // to convert regardless of what the nominal target says, so treat depletion as
  // the real completion signal rather than blindly counting down against a
  // balance that no longer exists.
  const rolloverDepleted = rolloverBal <= ROLLOVER_DEPLETED_THRESHOLD
  const remaining      = rolloverDepleted ? 0 : Math.max(0, Math.min(annualTarget - ytdConverted, rolloverBal))
  const progressPct    = rolloverDepleted ? 100
    : annualTarget > 0 ? Math.min(100, (ytdConverted / annualTarget) * 100) : 0
  const convScore      = tx?.conv_score ?? 0   // 0–10 scale from backend
  const scoreColor     = convScore >= 7 ? G : convScore >= 4 ? Y : R
  const ceiling        = tx?.target_bracket_ceiling ?? 0
  const grossNoSS      = tx?.gross_no_ss ?? tx?.annual_div_for_agi
  // gross_actual = divs + ytd_converted_total + STCG (no plan-target inflation).
  // ceiling − gross_actual == taxable_ceiling − taxable_actual (std_ded cancels),
  // so room dollar amount is correct using gross_actual vs gross ceiling.
  const grossActual    = tx?.gross_actual ?? grossNoSS
  const safetyBuf      = tx?.safety_buffer ?? DEFAULT_SAFETY_BUFFER
  const actualRoom     = Math.max(0, (ceiling ?? 0) - (grossActual ?? 0))
  const incConf        = tx?.income_confidence ?? 'LOW'
  const confColor      = incConf === 'HIGH' ? G : incConf === 'MEDIUM' ? Y : R
  const convWin        = actualRoom <= 0 ? 'CLOSED' : incConf !== 'HIGH' ? 'WAIT' : 'OPEN'
  const rothPlan       = data.roth_target_analysis ?? []
  const rothAcct       = data.accounts.find(a => a.key === 'roth_ira')
  const rothBal        = rothAcct?.value ?? 0
  // ── Roth conversion runway — years until the Rollover IRA is fully converted ──
  // Projects forward at the current annual target, compounding growth on what's
  // left each year (not a naive balance ÷ target division). Computed once here
  // so the summary tile (ConversionStatusPanel) and the runway chart below never
  // disagree on "how long is left".
  const runwayCurrentAge   = tx?.current_age ?? 0
  const runwayRmdAge       = tx?.rmd_start_age ?? RMD_START_AGE
  const runwayGrowthRate   = DRAWDOWN_DEFAULTS.expected_return
  const runwayHorizonYears = Math.max(1, Math.min(30, runwayRmdAge - runwayCurrentAge + 5))
  const runwayRows: { age: number; roll: number; roth: number; conv: number }[] = []
  let runwayDepletionAge: number | null = null
  {
    let roll = rolloverBal
    let roth = rothBal
    for (let i = 0; i < runwayHorizonYears; i++) {
      const age_i  = runwayCurrentAge + i
      const conv_i = roll > 0 ? Math.min(annualTarget, roll) : 0
      roll = Math.max(0, (roll - conv_i) * (1 + runwayGrowthRate))
      roth = (roth + conv_i) * (1 + runwayGrowthRate)
      runwayRows.push({ age: Math.round(age_i + 1), roll, roth, conv: conv_i })
      if (conv_i > 0 && roll <= 0 && runwayDepletionAge == null) runwayDepletionAge = Math.round(age_i + 1)
    }
  }
  const runwayYearsRemaining = runwayDepletionAge != null ? Math.round(runwayDepletionAge - runwayCurrentAge) : null
  // Lifetime Rollover → Roth progress — current balances, not YTD/annual-target
  // scoped. Answers "how far along is the whole multi-year shift", separate
  // from this year's conversion progress.
  const lifetimeRolloverRothTotal = rolloverBal + rothBal
  const lifetimeConvertedPct = rolloverDepleted ? 100
    : lifetimeRolloverRothTotal > 0 ? (rothBal / lifetimeRolloverRothTotal) * 100 : 0
  // Phase-separated conversion plans for AccountImpactPanel
  const convPlanBase   = tx?.rollover_conv_plan_adjusted ?? tx?.rollover_conv_plan ?? []
  const convPlanDec    = tx?.rollover_conv_plan_dynamic  ?? []
  const incomeReceivedPct = tx?.income_received_pct ?? 0
  const triggerThreshold  = tx?.trigger_pct_threshold ?? 85
  const triggerMet        = tx?.trigger_met ?? (incomeReceivedPct >= triggerThreshold)
  const todayDate         = new Date()
  const dec1              = new Date(todayDate.getFullYear(), 11, 1)
  const daysTo1Dec        = tx?.days_to_dec1 ?? Math.max(0, Math.round((dec1.getTime() - todayDate.getTime()) / 86400000))
  const dec1Triggered     = tx?.dec1_triggered ?? (daysTo1Dec <= 0)
  // Respect the configured conversion_month from Settings (default 12 = December).
  // conversion_month is 1-based (12 = December); JS getMonth() is 0-based.
  const conversionMonth    = tx?.conversion_month ?? 12                              // 1-based
  const conversionMonthName = tx?.conversion_month_name ?? 'December'
  // Day 0 of next month = last day of conversionMonth; roll to next year if already past
  let convMonthLastDay     = new Date(todayDate.getFullYear(), conversionMonth, 0)
  if (convMonthLastDay.getTime() < todayDate.getTime()) {
    convMonthLastDay = new Date(todayDate.getFullYear() + 1, conversionMonth, 0)
  }
  const daysToDec31        = Math.max(0, Math.round((convMonthLastDay.getTime() - todayDate.getTime()) / 86400000))
  // Show action block when: currently IN the execution month, OR conversion_imminent flag set by backend.
  // Suppressed when verdict is STOP — no point showing an execution checklist the user shouldn't act on.
  const isConversionMonth  = todayDate.getMonth() + 1 === conversionMonth
  // Canonical verdict — single source for every conversion recommendation on this tab
  // Must be declared before showDecActionBlock which references verdict.status
  const verdict          = computeConversionVerdict(tx)
  const showDecActionBlock = (isConversionMonth || (tx?.conversion_imminent ?? false)) && verdict?.status !== 'STOP'
  const fullYrAgiEst      = tx?.full_year_agi_estimate ?? tx?.agi_real ?? tx?.annual_div_for_agi
  // Use gross_actual (divs + ytd-only conversions + STCG) not agi_real.
  // agi_real = gross_no_ss + withdrawal_need — still plan-inflated via gross_no_ss.
  const actualYtdAgi      = tx?.gross_actual ?? tx?.agi_real ?? 0
  const bindingAgi        = Math.max(fullYrAgiEst ?? 0, actualYtdAgi)
  const isActualBinding   = actualYtdAgi > (fullYrAgiEst ?? 0)
  // Scenario amounts computed from first principles — do NOT trust dynamic_conv_*
  // from the server; those fields mix "remaining this year" with "annual rate" and
  // produce incorrect numbers (e.g. aggressive = $177K when bracket room is $107K).
  //
  //  Conservative = annual target from JSON  (the plan)
  //  Recommended  = min(annualTarget, actualRoom − safetyBuf)  (tax-safe)
  //  Aggressive   = actualRoom  (full bracket room, no buffer)
  //
  // "Remaining this year" on each card = max(0, amount − ytdConverted).
  const convRecommended = annualTarget > 0
    ? Math.min(annualTarget, Math.max(0, actualRoom - safetyBuf))
    : Math.max(0, actualRoom - safetyBuf)
  const convAggressive  = Math.max(0, actualRoom)
  const scenarios: Record<string, { label: string; amount: number; rows: ProjectionRow[] }> = {
    conservative: { label: 'CONSERVATIVE', amount: annualTarget,       rows: tx?.projections_conservative ?? tx?.projections ?? [] },
    recommended:  { label: 'RECOMMENDED',  amount: convRecommended,    rows: tx?.projections_recommended  ?? tx?.projections ?? [] },
    aggressive:   { label: 'AGGRESSIVE',   amount: convAggressive,     rows: tx?.projections_aggressive   ?? tx?.projections ?? [] },
  }
  const isComplete       = rolloverDepleted || (ytdConverted >= annualTarget && annualTarget > 0)
  const convExceeded     = convRecommended > 0 && ytdConverted >= convRecommended
  // Engine decision — used for blocker list in WINDOW STATUS tile.
  // data.tax_data (not dynamicTaxData) intentionally — engine uses the original data shape.
  const decision         = useMemo(() => computeRetirementDecision(data), [data])
  const windowBlockers   = decision.next_conversion_window.blocked_by
  // Urgent when the conversion-month deadline is within ~60 days (was hardcoded Nov/Dec)
  const isUrgent         = convWin === 'OPEN' && remaining > 0 && daysToDec31 <= 60
  const bannerVisible    = (isUrgent || convWin === 'OPEN') && !isComplete
  const bannerColor      = isUrgent ? R : A
  const bannerText       = isUrgent
    ? ` YEAR-END APPROACHING — ${fmtMoneyFull(remaining)} remaining. Act before ${conversionMonthName} 31.`
    : ` WINDOW OPEN — ${fmtMoneyFull(actualRoom)} available. Income confidence: ${incConf}.`
  const statusProps = {
    tx, ytdConverted, annualTarget, remaining, progressPct, convScore, scoreColor,
    ceiling, grossNoSS, grossActual, actualRoom, safetyBuf, confColor, incConf, rolloverBal, rothBal,
    convWin, bindingAgi, fullYrAgiEst, actualYtdAgi, incomeReceivedPct, triggerThreshold,
    triggerMet, daysTo1Dec, dec1Triggered, rolloverDepleted,
    runwayYearsRemaining, runwayDepletionAge,
  }

  // Handle SS option selection - client-side only!
  const handleSSChange = (ssOptionKey: string, ssOption: any) => {
    setIsRecalculating(true)
    const newSSAge = parseInt(ssOptionKey.split('_')[1] || '70')
    setSelectedSSAge(newSSAge)

    // Simulate processing delay for visual feedback
    setTimeout(() => {
      const recalculatedTaxData = recalculateTaxWithSS(
        data.tax_data,
        ssOption.annual,
        newSSAge
      )
      setDynamicTaxData(recalculatedTaxData)
      setIsRecalculating(false)
    }, 150)
  }

  if (!tx || Object.keys(tx).length === 0) {
    return (
      <div style={{ padding: 32, color: M, fontSize: 12 }}>
        No tax data available. Add _PERSONAL and _TAX_BRACKETS to input.json.
      </div>
    )
  }

  const bktColor = tx.bracket_pressure_pct >= 90 ? R : tx.bracket_pressure_pct >= 70 ? Y : G
  const effRateColor = (r: number | null) => r == null ? M : r < 15 ? G : r < 25 ? Y : R

  return (
    <div style={{ paddingBottom: 64 }}>
      {(() => {
        const year = new Date().getFullYear()
        const room = moneyUnit(actualRoom)
        const vStatus = verdict?.status ?? (convWin === 'OPEN' ? 'GO' : 'WAIT')
        const VERB: Record<string, string> = { GO: 'Convert', WAIT: 'Wait', STOP: 'Stop', COMPLETE: 'Done' }
        return (
          <PageHero
            eyebrow={`Tax · ${year} · ${tx.filing_status} · ${tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}% target bracket · federal only`}
            {...(actualRoom > 0
              ? { before: `${room.value}${room.unit ?? ''} of `, em: 'room', after: ' left.' }
              : { before: 'The bracket is ', em: 'full', after: '.' })}
            lead={<>
              <span>Projected gross income is {fmtMoneyFull(grossActual ?? 0)} against a {fmtMoneyFull(ceiling)} ceiling at {tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}%.</span>
              <LeadMuted>{incomeReceivedPct.toFixed(1)}% of expected dividends have arrived; the conversion trigger is {triggerThreshold.toFixed(1)}%. State income tax is not modelled.</LeadMuted>
            </>}
            aside={
              <DecisionPlane label="Conversion verdict" pad="36px">
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 64, lineHeight: 0.85, letterSpacing: '-0.02em' }}><em>{VERB[vStatus] ?? vStatus}</em>.</span>
                <span style={{ fontSize: 15, lineHeight: 1.4 }}>
                  {verdict?.detail ?? `Income confidence is ${incConf} — wait for more income data.`} Window: {convWin.toLowerCase()}.
                  {' '}Recommended target {fmtMoneyFull(convRecommended)} — min(annual target, room − {fmtMoneyFull(safetyBuf)} buffer).
                </span>
                {windowBlockers.length > 0 && <span style={{ ...mono, opacity: 0.8 }}>Blocked by {windowBlockers.join(' · ')}</span>}
              </DecisionPlane>
            }
          />
        )
      })()}

      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, borderTop: '2px solid var(--fd-rule)', paddingTop: 16, marginBottom: 0 }}>
        <SubTabBar>
          <SubTabBtn label="Tax planning"     index={1} active={subView === 'tax'}  onClick={() => setSubView('tax')}  />
          <SubTabBtn label="Roth conversion"  index={2} active={subView === 'roth'} onClick={() => setSubView('roth')} />
          <SubTabBtn label="Sell and rebalance" index={3} active={subView === 'sell'} onClick={() => setSubView('sell')} />
        </SubTabBar>
        <Label>Federal tax only — no state income tax modelled</Label>
      </nav>

      {(() => {
        const kpis: Record<SubView, Kpi[]> = {
          tax: [
            { label: 'Bracket room', value: moneyUnit(actualRoom).value, unit: moneyUnit(actualRoom).unit, status: actualRoom > 20000 ? 'ok' : actualRoom > 0 ? 'warn' : 'alert', sub: `${tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}% ceiling ${fmtMoneyFull(ceiling)}` },
            { label: 'Bracket used', value: `${tx.bracket_pressure_pct.toFixed(1)}`, unit: '%', status: tx.bracket_pressure_pct >= 90 ? 'alert' : tx.bracket_pressure_pct >= 70 ? 'warn' : 'ok', sub: 'Taxable income ÷ taxable ceiling' },
            { label: 'Effective rate', value: tx.eff_rate_no_ss != null ? tx.eff_rate_no_ss.toFixed(1) : '—', unit: tx.eff_rate_no_ss != null ? '%' : undefined, sub: 'Excluding Social Security' },
            { label: 'Safe harbor', value: tx.safe_harbor_met == null ? '—' : tx.safe_harbor_met ? 'Met' : 'Unmet', status: tx.safe_harbor_met == null ? 'info' : tx.safe_harbor_met ? 'ok' : 'alert', sub: 'Estimated payments vs requirement' },
          ],
          roth: [
            { label: 'Converted YTD', value: moneyUnit(ytdConverted).value, unit: moneyUnit(ytdConverted).unit, sub: annualTarget > 0 ? `of ${fmtMoneyFull(annualTarget)} target` : 'No target set', status: isComplete ? 'ok' : convExceeded ? 'alert' : 'info' },
            { label: 'Progress', value: annualTarget > 0 ? progressPct.toFixed(0) : '—', unit: annualTarget > 0 ? '%' : undefined, sub: annualTarget > 0 ? (verdict?.status === 'STOP' && verdict.bracketFillRemaining > 0 ? `+${fmtMoneyFull(verdict.bracketFillRemaining)} bracket-fill option, not recommended` : `${fmtMoneyFull(remaining)} remaining`) : 'No annual target' },
            { label: 'Safe room', value: moneyUnit(convRecommended).value, unit: moneyUnit(convRecommended).unit, status: convRecommended > 0 ? 'ok' : 'alert', sub: `After a ${fmtMoneyFull(safetyBuf)} buffer` },
            { label: 'Rollover IRA', value: moneyUnit(rolloverBal).value, unit: moneyUnit(rolloverBal).unit, sub: runwayYearsRemaining != null ? `Depletes in about ${runwayYearsRemaining} years (age ${runwayDepletionAge})` : `${lifetimeConvertedPct.toFixed(0)}% of pre-tax moved to Roth` },
          ],
          sell: [
            { label: 'Realised gains YTD', value: moneyUnit(tx.ytd_net_gain ?? 0).value, unit: moneyUnit(tx.ytd_net_gain ?? 0).unit, sub: `Short-term ${fmtMoneyFull(tx.ytd_stcg_realized ?? 0)} · long-term ${fmtMoneyFull(tx.ytd_ltcg_realized ?? 0)}` },
            { label: 'Cap gains tax', value: moneyUnit(tx.ytd_cap_gains_tax ?? 0).value, unit: moneyUnit(tx.ytd_cap_gains_tax ?? 0).unit, sub: 'Estimated for the year' },
            { label: 'LTCG rate', value: `${(((tx.ltcg_rate ?? 0.15) > 1 ? (tx.ltcg_rate ?? 15) / 100 : (tx.ltcg_rate ?? 0.15)) * 100).toFixed(0)}`, unit: '%', sub: tx.niit_applies ? '+3.8% NIIT applies' : 'NIIT does not apply' },
            { label: 'Bracket room', value: moneyUnit(actualRoom).value, unit: moneyUnit(actualRoom).unit, sub: 'Caps how much can be realised this year' },
          ],
        }
        return <div style={{ paddingTop: 24 }}><KpiStrip items={kpis[subView]} /></div>
      })()}

      {/* ── TAX PLANNING sub-view ── */}
      {subView === 'tax' && (
      <div style={{ paddingTop: 56, display: 'flex', flexDirection: 'column', gap: 56 }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,7fr) minmax(0,5fr)', gap: 56, alignItems: 'start' }}>
          <IncomeBanner data={data} />
          <div style={{ background: 'var(--fd-card)', padding: 32 }}>
            <TabBriefingPanel endpoint="/api/briefing/tax" title="Tax briefing" />
          </div>
        </div>

        {/* ── Three ruled columns: tax position · account structure · forward planning ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 32 }}>

          {/* Card 1: Tax Position */}
          {(() => {
            const totalValue  = data.summary?.total_value ?? 0
            const estTax      = tx.eff_rate_no_ss != null && tx.gross_no_ss != null
              ? (tx.eff_rate_no_ss / 100) * tx.gross_no_ss : null
            const drag        = estTax != null && totalValue > 0 ? (estTax / totalValue) * 100 : null
            const dragColor   = drag == null ? M : drag < 0.5 ? G : drag < 1.0 ? Y : R
            const effRateClr  = tx.eff_rate_no_ss == null ? M : tx.eff_rate_no_ss < 15 ? G : tx.eff_rate_no_ss < 25 ? Y : R
            const scoreColor  = tx.conv_score >= 8 ? R : tx.conv_score >= 6 ? Y : tx.conv_score >= 4 ? G : M
            const _room       = ceiling > 0 && grossActual != null ? Math.max(0, ceiling - grossActual) : null
            const roomColor   = _room != null && _room > 10000 ? G : _room != null && _room > 0 ? Y : M
            const convProg    = annualTarget > 0 ? Math.min(100, (ytdConverted / annualTarget) * 100) : 0
            const bktLabel    = tx.bracket_pressure_pct >= 90 ? 'NEAR LIMIT' : tx.bracket_pressure_pct >= 70 ? 'WATCH' : 'OK'
            const bktPillBg   = tx.bracket_pressure_pct >= 90 ? 'var(--tint-red)' : tx.bracket_pressure_pct >= 70 ? 'var(--tint-amber)' : 'var(--tint-green)'
            return (
              <div style={{ borderTop: '2px solid var(--fd-rule)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-label)', fontWeight: 500, color: 'var(--text3)' }}>
                  Tax position · {new Date().getFullYear()}
                </span>
                {/* Hero: bracket pressure */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                    <div className="v2-display" style={{ color: bktColor }}>{tx.bracket_pressure_pct.toFixed(1)}%</div>
                    <span className="v2-pill" style={{ background: bktPillBg, color: bktColor, border: `1px solid ${bktColor}33` }}>{bktLabel}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>
                    taxable income (actual) ÷ {tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}% taxable ceiling
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, tx.bracket_pressure_pct)}%`, background: bktColor, borderRadius: 999, transition: 'width 0.6s cubic-bezier(.4,0,.2,1)' }} />
                </div>
                {/* Tax rates */}
                <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {[
                    { label: 'Effective tax rate', value: tx.eff_rate_no_ss != null ? `${tx.eff_rate_no_ss.toFixed(1)}%` : '—', color: effRateClr, note: 'excl. Social Security' },
                    { label: 'Tax drag', value: drag != null ? `${drag.toFixed(2)}%/yr` : '—', color: dragColor, note: estTax != null ? `${fmtFull(estTax)}/yr est. · typical 0.5–2.0%` : 'typical range 0.5–2.0%' },
                    { label: `Conv opportunity ${new Date().getFullYear()}`, value: `${tx.conv_score}/10`, color: scoreColor, note: 'market/timing conditions · verdict is the operative directive' },
                  ].map(({ label, value, color, note }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>{label}</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
                        {note && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>{note}</span>}
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs2-body)', fontWeight: 500, color }}>{value}</span>
                      </span>
                    </div>
                  ))}
                </div>
                {/* Conversion progress */}
                <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>Conv room @ {tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}%</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs2-body)', fontWeight: 500, color: roomColor }}>{_room != null ? fmtFull(_room) : '—'}</span>
                  </div>
                  {/* Primary guidance — canonical verdict (conversionVerdict.ts), same everywhere */}
                  {verdict && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)', flexShrink: 0 }}>Conversion verdict</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs2-small)', fontWeight: 500, textAlign: 'right',
                        color: verdictTone(verdict.status) === 'good' ? G : verdictTone(verdict.status) === 'bad' ? R : Y }}>
                        {verdict.headline}
                      </span>
                    </div>
                  )}
                  {annualTarget > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>Converted YTD</span>
                        <span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs2-body)', fontWeight: 500, color: G }}>{fmtFull(ytdConverted)}</span>
                          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}> / {fmtFull(annualTarget)}</span>
                        </span>
                      </div>
                      <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${convProg}%`, background: G, borderRadius: 999, transition: 'width 0.6s cubic-bezier(.4,0,.2,1)' }} />
                      </div>
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>Safe harbor</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs2-body)', fontWeight: 500, color: tx.safe_harbor_met == null ? M : tx.safe_harbor_met ? G : R }}>
                      {tx.safe_harbor_met == null ? '—' : tx.safe_harbor_met ? 'MET ✓' : 'UNMET ✗'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Card 2: Account Structure */}
          {(() => {
            const taxableBkt = data.accounts.filter(a => a.key === 'taxable').reduce((s, a) => s + a.value, 0)
            const rothBkt    = data.accounts.filter(a => a.key === 'roth_ira').reduce((s, a) => s + a.value, 0)
            const rollBkt    = data.accounts.filter(a => a.key === 'rollover_ira').reduce((s, a) => s + a.value, 0)
            const total      = taxableBkt + rothBkt + rollBkt
            if (total === 0) return null
            const txPct = taxableBkt / total * 100
            const rtPct = rothBkt    / total * 100
            const rlPct = rollBkt    / total * 100

            const rmdAge     = tx?.rmd_start_age ?? RMD_START_AGE
            const rmdFactor  = RMD_FACTORS[rmdAge] ?? 26.5
            const estRmdElim = ytdConverted > 0 ? ytdConverted / rmdFactor : null

            const margRateDecimal = tx?.marginal_rate ?? ((tx?.target_bracket_rate ?? 24) / 100)
            // tax_conv_actual is scoped to ytdConverted (YTD-actual conversion) — must use
            // this, not tax_conv_add (scoped to the full-year PLAN target), since taxCost
            // is divided by ytdConverted below to get an "effective rate". Mismatched
            // scopes there previously inflated the rate to ~89% and broke breakeven-age.
            const taxCost = tx?.tax_conv_actual != null && tx.tax_conv_actual > 0
              ? tx.tax_conv_actual : (ytdConverted > 0 ? ytdConverted * margRateDecimal : null)

            const projAtRmd     = (tx?.projections_recommended ?? []).find(r => r.age >= rmdAge)
            const rolloverAtRmd = projAtRmd?.rollover_value ?? null
            const rothAtRmd     = projAtRmd?.roth_value     ?? null
            const rmdGone       = rolloverAtRmd != null && rolloverAtRmd < 1000

            // Use target bracket rate as the "what RMDs would have been taxed at" — cleaner
            // than projected effective rate which is near zero when rollover depletes early.
            const futureRate      = (tx?.target_bracket_rate ?? 24) / 100
            const annualRmdReduced = estRmdElim ?? 0
            const annualTaxSaved   = annualRmdReduced * futureRate
            const breakevenYears   = !rmdGone && taxCost != null && taxCost > 0 && annualTaxSaved > 0
              ? taxCost / annualTaxSaved : null
            const breakevenAge     = breakevenYears != null && (tx?.current_age ?? 0) > 0
              ? Math.round((tx?.current_age ?? 0) + breakevenYears) : null

            type EconRow = { label: string; value: string; color: string; note: string }
            const econRows: EconRow[] = []
            // Effective rate on the conversion itself — conversions stack on top of
            // W2 + dividends, so the true cost is usually above the bracket's nominal rate.
            const convEffRate = ytdConverted > 0 && taxCost != null ? (taxCost / ytdConverted) * 100 : null
            if (taxCost != null) econRows.push({
              label: 'Tax cost YTD', value: fmtFull(taxCost), color: A,
              note: convEffRate != null
                ? `≈${convEffRate.toFixed(1)}% effective — stacks on W2+divs already in the ${(margRateDecimal * 100).toFixed(0)}% zone`
                : `${(margRateDecimal * 100).toFixed(0)}% marginal`,
            })
            if (annualRmdReduced > 0) econRows.push({ label: 'Annual RMD impact', value: `${fmtFull(annualRmdReduced)}/yr`, color: G, note: 'from YTD conversion · current balance basis' })
            if (rmdGone) econRows.push({ label: 'RMD exposure', value: 'Eliminated ✓', color: G, note: 'rollover depletes before RMD age' })
            else if (breakevenAge != null) econRows.push({ label: 'Breakeven', value: `Age ${breakevenAge}`, color: breakevenAge < rmdAge ? G : Y, note: `${breakevenYears!.toFixed(1)} yrs` })
            if (rolloverAtRmd != null) econRows.push({
              label: `Rollover @ age ${rmdAge}`,
              value: rolloverAtRmd <= 0 ? 'Depleted ✓' : fmtFull(rolloverAtRmd),
              color: rolloverAtRmd <= 0 ? G : A,
              note: rothAtRmd != null && rolloverAtRmd <= 0 ? `Roth ${fmtFull(rothAtRmd)}` : '',
            })

            return (
              <div style={{ borderTop: '2px solid var(--fd-rule)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-label)', fontWeight: 500, color: 'var(--text3)' }}>
                  Account structure
                </span>
                {/* Hero: pre-tax exposure */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                    <div className="v2-display" style={{ color: rollBkt > 0 ? A : G }}>{fmtFull(rollBkt)}</div>
                    <span className="v2-pill" style={{ background: rollBkt > 0 ? 'var(--tint-amber)' : 'var(--tint-green)', color: rollBkt > 0 ? A : G, border: `1px solid ${(rollBkt > 0 ? A : G)}33` }}>
                      {rollBkt > 0 ? 'TAX EXPOSURE' : 'CLEAR'}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>
                    {rmdGone
                      ? 'pre-tax IRA · conversion vehicle · RMD eliminated via conversion timeline'
                      : `pre-tax IRA · future ordinary income · RMD at ${rmdAge}`}
                  </span>
                </div>
                {/* Stacked ratio bar */}
                <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', gap: 1 }}>
                  <div style={{ width: `${txPct}%`, background: 'var(--blue)' }} title={`Taxable ${txPct.toFixed(1)}%`} />
                  <div style={{ width: `${rtPct}%`, background: 'var(--green)' }} title={`Roth ${rtPct.toFixed(1)}%`} />
                  <div style={{ width: `${rlPct}%`, background: 'var(--amber)' }} title={`Pre-tax ${rlPct.toFixed(1)}%`} />
                </div>
                {/* Bucket rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {([
                    { label: 'Taxable', value: taxableBkt, pct: txPct, color: 'var(--blue)' },
                    { label: 'Roth IRA', value: rothBkt,    pct: rtPct, color: 'var(--green)' },
                    { label: 'Pre-tax IRA', value: rollBkt, pct: rlPct, color: 'var(--amber)' },
                  ]).map(b => (
                    <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 0, background: b.color, display: 'inline-block', flexShrink: 0 }} />
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>{b.label}</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>{b.pct.toFixed(1)}%</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs2-body)', fontWeight: 500, color: b.color }}>{fmtFull(b.value)}</span>
                      </span>
                    </div>
                  ))}
                </div>
                {/* Conversion economics */}
                {econRows.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-label)', fontWeight: 500, color: 'var(--text3)' }}>Conversion economics</span>
                    {econRows.map(row => (
                      <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>{row.label}</span>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
                          {row.note && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>{row.note}</span>}
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs2-body)', fontWeight: 500, color: row.color }}>{row.value}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Card 3: Forward Planning */}
          {(() => {
            const is = data.income_summary
            // MAGI/IRMAA must use taxable-account-only dividends — full_year_div
            // includes Roth/Rollover IRA dividends (tax-free/tax-deferred, not
            // part of AGI), which would inflate the IRMAA tier lookup below.
            const projectedGross = is ? (is.full_year_w2 + (is.full_year_div_taxable ?? 0) + (is.full_year_conversion ?? 0)) : 0
            const agi = projectedGross > 0 ? projectedGross : (fullYrAgiEst ?? 0)
            const age = tx.current_age ?? 0
            const filingMfj = tx.filing_status === 'MFJ'
            const yearsToMedicare = Math.max(0, 65 - age)
            const yearsToRmd = tx?.years_to_rmd ?? Math.max(0, (tx?.rmd_start_age ?? RMD_START_AGE) - age)
            const rmdAgeFlag = tx?.rmd_start_age ?? RMD_START_AGE
            const rolloverBalFwd = tx.rollover_balance ?? 0

            const tiers = filingMfj ? IRMAA_TIERS_MFJ : IRMAA_TIERS_SINGLE
            const irmaaTier = [...tiers].reverse().find(t => agi >= t.magi_from) ?? tiers[0]
            const personCount = filingMfj ? 2 : 1
            const baseTier = tiers[0]
            const annualIrmaa = ((irmaaTier.part_b_monthly - baseTier.part_b_monthly)
                               + (irmaaTier.part_d_monthly - baseTier.part_d_monthly)) * 12 * personCount
            const irmaaTierNum = tiers.indexOf(irmaaTier)

            const rmdEstimate = tx?.estimated_first_year_rmd ?? null

            if (agi === 0 && rolloverBalFwd === 0) return null

            type FwdRow = { label: string; value: string; color: string; sub: string }
            const fwdRows: FwdRow[] = []

            if (rolloverBalFwd > 0) fwdRows.push({
              label: 'RMD start',
              value: yearsToRmd === 0 ? 'Now' : `Age ${rmdAgeFlag}`,
              color: rmdEstimate != null && rmdEstimate > 50000 ? Y : G,
              sub: yearsToRmd > 0
                ? `${yearsToRmd.toFixed(1)} yrs${rmdEstimate != null ? ` · est. ${fmtFull(rmdEstimate)}/yr at ${rmdAgeFlag} (projected balance)` : ''}`
                : rmdEstimate != null ? `est. ${fmtFull(rmdEstimate)}/yr at ${rmdAgeFlag} (projected balance)` : '',
            })

            fwdRows.push({
              label: 'SS start',
              value: `Age ${tx.ss_start_age}`,
              color: M,
              sub: `${Math.max(0, tx.ss_start_age - age).toFixed(1)} yrs · ${fmtFull(tx.ss_annual ?? 0)}/yr`,
            })

            fwdRows.push({
              label: 'IRMAA',
              value: tx.collect_medicare ? (irmaaTierNum === 0 ? 'Clear' : irmaaTier.label) : 'N/A',
              color: tx.collect_medicare ? (irmaaTierNum === 0 ? G : irmaaTierNum <= 2 ? Y : R) : M,
              sub: tx.collect_medicare
                ? (annualIrmaa > 0 ? `${fmtFull(annualIrmaa)}/yr surcharge at current AGI` : 'below IRMAA threshold')
                : 'Medicare not elected — IRMAA does not apply',
            })

            fwdRows.push({
              label: 'Medicare start',
              value: yearsToMedicare === 0 ? 'Active' : `${yearsToMedicare.toFixed(1)} yrs`,
              color: yearsToMedicare <= 2 ? Y : M,
              sub: tx.collect_medicare
                ? 'elected — IRMAA premiums apply · lookback 2 yrs prior'
                : 'not elected — electing activates IRMAA (Settings)',
            })

            const nextMilestone = fwdRows[0]

            return (
              <div style={{ borderTop: '2px solid var(--fd-rule)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-label)', fontWeight: 500, color: 'var(--text3)' }}>Forward planning</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                    <div className="v2-display" style={{ color: nextMilestone.color }}>{nextMilestone.value}</div>
                    <span className="v2-pill" style={{ background: 'var(--surface-3)', color: 'var(--text3)', border: '1px solid var(--line)' }}>
                      {nextMilestone.label}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>
                    {nextMilestone.sub}
                  </span>
                </div>
                <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {fwdRows.slice(1).map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>{row.label}</span>
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text2)', lineHeight: 1.4, maxWidth: 160 }}>{row.sub}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs2-body)', fontWeight: 500, color: row.color, whiteSpace: 'nowrap', flexShrink: 0 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Bracket meter — full width */}
        <BracketMeter
          pressurePct={tx.bracket_pressure_pct}
          convRoom={tx.conv_room_real}
          bktColor={bktColor}
          ceilGross={tx.target_bracket_ceiling}
          grossActual={tx.gross_actual ?? tx.gross_no_ss}
          targetBracketRate={tx.target_bracket_rate}
          stdDeduction={tx.std_deduction}
        />

        <SectionHeader title="Portfolio tax scores" />

        {/* Personal info + scores */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <PersonalInfo tx={tx} />
          <PortfolioScores tx={tx} bktColor={bktColor} />
        </div>

        {/* Quarterly payments */}
        {(tx.quarterly_payments?.length ?? 0) > 0 && (
          <QuarterlyPayments tx={tx} accounts={data.accounts} data={data} />
        )}

        {mode === 'advanced' && (
          <>
            {/* ── GROUP A — Income Tax Analysis ── */}
            <Label style={{ color: 'var(--fd-accent)' }}>Group A · Income tax analysis</Label>

            <TerminalSection id="divchar" title="◈ DIVIDEND TAX CHARACTER" defaultOpen={true}>
              <DividendCharacter tx={tx} />
            </TerminalSection>

            {tx.div_tax_breakdown && Object.keys(tx.div_tax_breakdown).length > 0 && (
              <TerminalSection id="div-breakdown" title="◈ PER-FUND DIVIDEND CHARACTER" defaultOpen={false}>
                <DivBreakdownTable tx={tx} />
              </TerminalSection>
            )}

            {tx.taxable_div_calendar && Object.keys(tx.taxable_div_calendar).length > 0 && (
              <TerminalSection id="div-cal" title="◈ TAXABLE DIVIDEND CALENDAR" defaultOpen={false}>
                <DividendCalendar tx={tx} />
              </TerminalSection>
            )}

            {/* ── GROUP B — Tax Projections ── */}
            <Label style={{ color: 'var(--fd-accent)' }}>Group B · Tax projections</Label>

            <TerminalSection id="realized-sales" title="◈ REALIZED SALES — CAPITAL GAINS TAX" defaultOpen={false} accent={R}>
              <RealizedSalesTaxPanel tx={tx} />
            </TerminalSection>

            {/* ── GROUP C — Planning Tools ── */}
            <Label style={{ color: 'var(--fd-accent)' }}>Group C · Planning tools</Label>

            <TerminalSection id="cashflow" title="◈ TAX-AWARE CASHFLOW" defaultOpen={true} accent={G}>
              <CashflowEngine tx={tx} />
            </TerminalSection>

            {tx.ss_options && Object.keys(tx.ss_options).length > 0 && (
              <TerminalSection id="ss-options" title="◈ SOCIAL SECURITY OPTIONS" defaultOpen={false} accent={A}>
                <SSOptions
                  tx={tx}
                  onSSChange={handleSSChange}
                  isRecalculating={isRecalculating}
                />
              </TerminalSection>
            )}

            {tx.gross_with_ss != null && (
              <TerminalSection id="with-ss" title="◈ WITH SOCIAL SECURITY — TAX SCENARIO" defaultOpen={false}>
                <WithSSScenario tx={tx} effRateColor={effRateColor} />
              </TerminalSection>
            )}

            {((tx.exec_conv_target ?? 0) > 0 || (data.roth_target_analysis?.length ?? 0) > 0 || (data.taxable_target_analysis?.length ?? 0) > 0) && (
              <TerminalSection id="rebalance-score" title="◈ TAX-EFFICIENT REBALANCE SCORE" defaultOpen={false} accent={G}>
                <RebalanceScore data={data} tx={tx} />
              </TerminalSection>
            )}

            <TerminalSection id="withdrawal-state" title="◈ WITHDRAWAL TAX SEQUENCING" defaultOpen={false} accent={A}>
              <WithdrawalStrategyPanel data={data} />
            </TerminalSection>
          </>
        )}
      </div>
      )} {/* end subView==='tax' */}

      {/* ── ROTH CONVERSION sub-view ── */}
      {subView === 'roth' && tx && (
        <div style={{ paddingTop: 56, display: 'flex', flexDirection: 'column', gap: 56 }}>

          <IncomeBanner data={data} />

          {/* ── Roth Conversion Command Center ── */}
          {(() => {
            // Use canonical verdict — same object used by Tax Planning sub-view.
            // Local derivation mapped isComplete → 'STOP' (red) instead of 'COMPLETE' (green).
            const cmdStatus = verdict?.status ?? (convWin === 'OPEN' ? 'GO' : 'WAIT')
            const cmdStatusColor = cmdStatus === 'GO' || cmdStatus === 'COMPLETE' ? G : cmdStatus === 'STOP' ? R : Y
            const cmdWinColor = convWin === 'OPEN' ? G : convWin === 'CLOSED' ? R : Y
            const cmdReason = verdict?.detail ?? `Income confidence is ${incConf} — wait for more income data.`
            return (
              <div style={{
                background: 'var(--surface)',
                border: `1px solid ${cmdStatusColor}44`,
                borderLeft: `4px solid ${cmdStatusColor}`,
                borderRadius: 'var(--r-lg)',
                padding: '16px 20px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text3)' }}>
                    Roth Conversion Command Center
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                      textTransform: 'uppercase', letterSpacing: '1px',
                      padding: '3px 10px', borderRadius: 0,
                      background: `${cmdStatusColor}22`, color: cmdStatusColor,
                      border: `1px solid ${cmdStatusColor}55`,
                    }}>STATUS: {cmdStatus}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                      textTransform: 'uppercase', letterSpacing: '1px',
                      padding: '3px 10px', borderRadius: 0,
                      background: `${cmdWinColor}22`, color: cmdWinColor,
                      border: `1px solid ${cmdWinColor}55`,
                    }}>WINDOW: {convWin}</span>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 14 }}>
                  {([
                    {
                      label: 'BRACKET ROOM',
                      value: fmtMoneyFull(actualRoom),
                      sub: `${tx?.target_bracket_rate ?? DEFAULT_BRACKET_RATE}% ceiling`,
                      color: actualRoom > 20000 ? G : actualRoom > 0 ? Y : R,
                    },
                    {
                      label: 'SAFE ROOM',
                      value: fmtMoneyFull(convRecommended),
                      sub: `after ${fmtMoneyFull(safetyBuf)} buffer`,
                      color: convRecommended > 0 ? G : R,
                    },
                    {
                      label: 'CONVERTED YTD',
                      value: fmtMoneyFull(ytdConverted),
                      sub: annualTarget > 0 ? `of ${fmtMoneyFull(annualTarget)} target` : 'no target set',
                      color: isComplete ? G : convExceeded ? R : ytdConverted > 0 ? Y : M,
                    },
                    {
                      label: 'PROGRESS',
                      value: annualTarget > 0 ? `${progressPct.toFixed(0)}%` : '—',
                      sub: annualTarget > 0 ? `${fmtMoneyFull(remaining)} remaining` : 'no annual target',
                      color: isComplete ? G : progressPct >= 50 ? Y : M,
                    },
                    {
                      label: 'ROLLOVER → ROTH',
                      value: `${lifetimeConvertedPct.toFixed(0)}%`,
                      sub: rolloverDepleted
                        ? `${fmtMoneyFull(rothBal)} — fully shifted`
                        : `${fmtMoneyFull(rolloverBal)} left${runwayYearsRemaining != null ? ` · ~${runwayYearsRemaining} ${runwayYearsRemaining === 1 ? 'yr' : 'yrs'} to go` : ''}`,
                      color: lifetimeConvertedPct >= 90 ? G : lifetimeConvertedPct >= 50 ? Y : M,
                    },
                  ] as { label: string; value: string; sub: string; color: string }[]).map(({ label, value, sub, color }) => (
                    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text3)' }}>{label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color }}>{value}</span>
                      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text3)' }}>{sub}</span>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text3)', whiteSpace: 'nowrap', paddingTop: 2 }}>NEXT ACTION</span>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: cmdStatusColor, fontWeight: 500 }}>{cmdReason}</span>
                </div>
              </div>
            )
          })()}

          {/* ── Roth Conversion Runway ── */}
          {rolloverBal > 0 && annualTarget > 0 && (() => {
            const currentAge   = runwayCurrentAge
            const convAmt      = annualTarget
            const rmdAge       = runwayRmdAge
            const rows         = runwayRows
            const depletionAge = runwayDepletionAge
            const atRmd     = rows.reduce((best, r) => Math.abs(r.age - rmdAge) < Math.abs(best.age - rmdAge) ? r : best, rows[0])
            const milestone = rows.filter((_, i) => i === 4 || i === 9 || i === 14)
            const beforeRmd = depletionAge != null && depletionAge < rmdAge
            return (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-label)', fontWeight: 500, color: 'var(--text3)' }}>
                      Roth conversion runway
                    </span>
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Converting', value: fmtFull(convAmt) + '/yr', color: G },
                        { label: depletionAge ? `Depletes age ${depletionAge}` : 'Remaining', value: depletionAge ? `${Math.round(depletionAge - currentAge)} yrs` : fmtFull(atRmd.roll), color: beforeRmd ? G : Y },
                        { label: `Roth @ ${rmdAge}`, value: fmtFull(atRmd.roth), color: G },
                        { label: 'Total legacy', value: fmtFull(atRmd.roll + atRmd.roth), color: 'var(--text)' },
                      ].map(({ label, value, color }) => (
                        <span key={label} style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs2-small)', color: 'var(--text3)' }}>
                          {label}&nbsp;<span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color }}>{value}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="v2-pill" style={{ flexShrink: 0, background: beforeRmd ? 'var(--tint-green)' : 'var(--tint-amber)', color: beforeRmd ? G : Y, border: `1px solid ${beforeRmd ? G : Y}33` }}>
                    {beforeRmd ? 'BEFORE RMD ✓' : 'WATCH'}
                  </span>
                </div>
                <div style={{ padding: '8px 4px 4px' }}>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={rows} margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
                      <XAxis dataKey="age" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: 'var(--text2)', fontSize: 12 }} label={{ value: 'Age', position: 'insideBottomRight', offset: -2, fill: 'var(--text2)', fontSize: 12 }} />
                      <YAxis tick={{ fill: 'var(--text2)', fontSize: 12 }} tickFormatter={(v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K`} />
                      <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown) => fmtFull(v as number)} labelFormatter={(a: unknown) => `Age ${a}`} />
                      {depletionAge && <ReferenceLine x={depletionAge} stroke="var(--green)" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: 'Depleted', position: 'top', fill: 'var(--green)', fontSize: 12 }} />}
                      <Line type="monotone" dataKey="roll" name="Rollover" stroke="var(--yellow)" strokeWidth={1.5} dot={false} />
                      <Line type="monotone" dataKey="roth" name="Roth" stroke="var(--green)" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ overflowX: 'auto', borderTop: '1px solid var(--fd-hairline)' }}>
                  <table className="bb-table">
                    <thead><tr><th>AGE</th><th className="r">CONVERT</th><th className="r">ROLLOVER</th><th className="r">ROTH</th><th className="r">COMBINED</th></tr></thead>
                    <tbody>
                      {milestone.map(r => (
                        <tr key={r.age} style={r.age === rmdAge ? { background: 'var(--fd-card)' } : {}}>
                          <td style={{ fontWeight: r.age === rmdAge ? 700 : 400, color: r.age === rmdAge ? A : 'var(--text)' }}>{r.age}{r.age === rmdAge ? ' ★ RMD' : ''}</td>
                          <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{fmtFull(r.conv)}</td>
                          <td className="r" style={{ color: r.roll <= 0 ? M : Y, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.roll > 0 ? fmtFull(r.roll) : 'DEPLETED'}</td>
                          <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{fmtFull(r.roth)}</td>
                          <td className="r" style={{ fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{fmtFull(r.roll + r.roth)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* ── BRACKET FILLING ENGINE ──────────────────────────────────────────── */}
          {/* Math → Rule → Action. This block explains WHY window status is what it is. */}
          <TerminalSection id="bracket-fill" title={`◈ BRACKET FILLING ENGINE · ${tx.target_bracket_rate ?? 24}% TARGET BRACKET`} defaultOpen={true} accent={A}>
            {(() => {
              const targetRate    = tx.target_bracket_rate ?? 24
              // Derive the next bracket rate from the actual brackets array — no hardcoding
              const brackets_    = tx.brackets ?? []
              const targetDecimal = targetRate / 100
              const nextBracket  = brackets_.find(b => b.rate > targetDecimal + 0.001)
              const nextRate     = nextBracket ? Math.round(nextBracket.rate * 100) : targetRate + 8
              const netRoom       = Math.max(0, actualRoom - safetyBuf)
              const bracketPct    = tx.bracket_pressure_pct
              const projAgi       = bindingAgi
              const agiColor      = projAgi >= ceiling ? R : projAgi >= ceiling * 0.9 ? Y : G
              const roomColor     = netRoom > 20000 ? G : netRoom > 5000 ? Y : R
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                  {/* Purpose */}
                  <div style={{ fontSize: 12, color: M, lineHeight: 1.5, padding: '6px 10px', background: `${A}0d`, borderLeft: `2px solid ${A}40`, borderRadius: '0 4px 4px 0' }}>
                    Pre-pay taxes at <strong style={{ color: A }}>{targetRate}%</strong> today to avoid{' '}
                    <strong style={{ color: R }}>{nextRate}%+</strong> later when SS + RMD + sunset stack.
                    Fill the bracket with Roth conversions until AGI ceiling. Stop before {nextRate}%.
                    Minimizes <em>lifetime taxes</em>, not current-year taxes.
                  </div>

                  {/* Bracket fill bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: M, marginBottom: 4 }}>
                      <span style={{ letterSpacing: '0.5px' }}>BRACKET FULLNESS</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: bktColor }}>
                        {bracketPct.toFixed(1)}% full
                        {bracketPct >= 90 ? ' — NEAR LIMIT' : bracketPct >= 70 ? ' — WATCH' : ' — SAFE'}
                      </span>
                    </div>
                    <div style={{ background: 'var(--fd-card)', borderRadius: 0, height: 14, position: 'relative', overflow: 'hidden' }}>
                      {/* YTD conversion fill (nested bar) */}
                      {ceiling > 0 && ytdConverted > 0 && grossActual != null && (
                        <div style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: `${Math.min(100, ((grossActual - ytdConverted) / ceiling) * 100)}%`,
                          background: 'var(--fd-card)',
                        }} />
                      )}
                      {/* Bracket pressure bar */}
                      <div style={{
                        height: '100%', borderRadius: 0,
                        width: `${Math.min(100, bracketPct)}%`,
                        background: bktColor,
                        transition: 'width 0.3s',
                      }} />
                      {/* Ceiling marker */}
                      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 2, background: R, opacity: 0.6 }} />
                      <span style={{
                        position: 'absolute', right: 4, top: 0, bottom: 0,
                        display: 'flex', alignItems: 'center',
                        fontSize: 12, fontWeight: 500, color: 'var(--fd-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}>{bracketPct.toFixed(0)}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--fd-muted)', marginTop: 2 }}>
                      <span>0%</span>
                      <span style={{ color: Y }}>WATCH 70%</span>
                      <span style={{ color: R }}>NEAR LIMIT 90%</span>
                      <span>CEILING 100%</span>
                    </div>
                  </div>

                  {/* Metrics grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {[
                      { label: `CEILING (${targetRate}% GROSS MAX)`, value: fmtMoneyFull(ceiling), color: M },
                      { label: 'PROJECTED AGI', value: fmtMoneyFull(projAgi), color: agiColor, note: projAgi >= ceiling ? ' at/over ceiling' : projAgi >= ceiling * 0.9 ? 'approaching ceiling' : 'within safe range' },
                      { label: 'NET CAPACITY (−BUFFER)', value: fmtMoneyFull(netRoom), color: roomColor, note: `${fmtMoneyFull(actualRoom)} room · ${fmtMoneyFull(safetyBuf)} buffer` },
                      { label: 'CONVERTED YTD', value: fmtMoneyFull(ytdConverted), color: ytdConverted > 0 ? G : M, note: annualTarget > 0 ? `of ${fmtMoneyFull(annualTarget)} target` : 'no target set' },
                      { label: 'SAFETY BUFFER', value: fmtMoneyFull(safetyBuf), color: M, note: 'prevents bracket creep if income estimates diverge' },
                      { label: 'BRACKET PRESSURE', value: `${bracketPct.toFixed(1)}%`, color: bktColor, note: 'projected gross ÷ ceiling' },
                    ].map((m, i) => (
                      <div key={i} style={{ background: 'var(--fd-card)', borderRadius: 0, padding: '8px 10px' }}>
                        <div style={{ fontSize: 12, color: M, letterSpacing: '0.5px', marginBottom: 3 }}>{m.label}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: m.color }}>{m.value}</div>
                        {m.note && <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{m.note}</div>}
                      </div>
                    ))}
                  </div>

                  {/* Rules + Interpretation */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, color: A, fontWeight: 500, letterSpacing: '1px', marginBottom: 6 }}>FILL RULES</div>
                      {[
                        `Fill with Roth conversions until AGI hits ${targetRate}% ceiling (${fmtMoneyFull(ceiling)})`,
                        `Never spill into the ${nextRate}% bracket — hard stop`,
                        'Open window only when: pacing ≥ 80% · STCG within acceptable range',
                        'Suspend if: AGI ≥ ceiling · fragility > 90',
                        `Keep dividends in target range to preserve ${fmtMoneyFull(netRoom)} conversion room`,
                        'Use controlled sales to manage basis and avoid bracket creep',
                      ].map((r, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: M, marginBottom: 3, lineHeight: 1.4 }}>
                          <span style={{ color: A, flexShrink: 0, fontWeight: 500 }}>{i + 1}.</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: G, fontWeight: 500, letterSpacing: '1px', marginBottom: 6 }}>WHY THIS WORKS</div>
                      <div style={{ fontSize: 12, color: M, lineHeight: 1.6 }}>
                        Today's {targetRate}% rate is a <strong style={{ color: G }}>tax window</strong> before SS, RMDs,
                        and TCJA sunset stack your income into {nextRate}%+.
                        <br /><br />
                        Converting now means future Roth withdrawals are{' '}
                        <strong style={{ color: G }}>tax-free</strong> — no RMD, no SS interaction,
                        no bracket creep at 73+.
                        <br /><br />
                        <strong style={{ color: A }}>Bracket escape:</strong> each $1 at {targetRate}% now vs {nextRate}% if AGI spills over saves{' '}
                        <strong style={{ color: G }}>{nextRate - targetRate}¢ per dollar</strong>.{' '}
                        Future rate vs today (SS+RMD stack): see Rate Arbitrage in Conversion Impact below.
                      </div>
                    </div>
                  </div>

                  {/* ── Timing rationale: why the execution month matters ─────── */}
                  <div style={{ borderTop: '1px solid var(--fd-hairline)', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--cyan)', fontWeight: 500, letterSpacing: '1px', marginBottom: 8 }}>
                      TIMING RATIONALE — WHY {conversionMonthName.toUpperCase()} IS THE EXECUTION MONTH
                    </div>

                    {/* Variable checklist */}
                    <div style={{ fontSize: 12, color: M, marginBottom: 10, lineHeight: 1.5 }}>
                      Bracket filling requires locking in these numbers before pulling the trigger:{' '}
                      {['Actual AGI', 'Actual dividends', 'Actual STCG', 'Actual W2', 'Controlled sales', 'NIIT exposure', 'Final bracket room'].map((v, i, arr) => (
                        <span key={v}><strong style={{ color: 'var(--text)' }}>{v}</strong>{i < arr.length - 1 ? ' · ' : '.'}</span>
                      ))}
                      {' '}None of these are final until late in the year.
                    </div>

                    {/* Three-phase timeline */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {[
                        {
                          phase: 'JAN – OCT',
                          color: M,
                          status: 'TRACK & HOLD',
                          items: [
                            'Track AGI drift monthly',
                            'Track dividend pacing',
                            'Track STCG accumulation',
                            'Trim concentration if fragility > 90',
                            'Do NOT convert — variables unresolved',
                          ],
                        },
                        {
                          phase: 'NOVEMBER',
                          color: Y,
                          status: 'CONFIDENCE RISING',
                          items: [
                            'Most dividends declared',
                            'Most STCG known',
                            'W2 nearly complete',
                            'AGI estimate firms up',
                            'Window may open early if pacing ≥ 80%',
                          ],
                        },
                        {
                          phase: conversionMonthName.toUpperCase(),
                          color: G,
                          status: 'EXECUTE',
                          items: [
                            'Lock actual AGI',
                            'Lock actual dividends',
                            'Lock actual STCG',
                            'Compute final bracket room',
                            'Apply safety buffer',
                            'Execute conversion (if room > $0)',
                          ],
                        },
                      ].map(({ phase, color, status, items }) => (
                        <div key={phase} style={{
                          background: 'var(--fd-card)',
                          borderRadius: 0,
                          padding: '8px 10px',
                          borderLeft: `2px solid ${color}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color }}>{phase}</span>
                            <span style={{ fontSize: 12, color, letterSpacing: '0.5px' }}>{status}</span>
                          </div>
                          {items.map((item, i) => (
                            <div key={i} style={{ display: 'flex', gap: 5, fontSize: 12, color: M, marginBottom: 2, lineHeight: 1.4 }}>
                              <span style={{ color, flexShrink: 0 }}>·</span>
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>

                    {/* Risk of converting too early */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                      <div style={{ background: `${R}0d`, borderLeft: `2px solid ${R}60`, borderRadius: '0 4px 4px 0', padding: '8px 10px' }}>
                        <div style={{ fontSize: 12, color: R, fontWeight: 500, marginBottom: 4 }}> CONVERT TOO EARLY</div>
                        {[
                          'Dividends come in higher → AGI creeps over ceiling',
                          'Unexpected STCG event eats your room',
                          'Accidentally cross into ' + nextRate + '% bracket',
                          'Entire purpose of bracket filling is lost',
                        ].map((r, i) => (
                          <div key={i} style={{ fontSize: 12, color: M, marginBottom: 2 }}>· {r}</div>
                        ))}
                      </div>
                      <div style={{ background: `${G}0d`, borderLeft: `2px solid ${G}60`, borderRadius: '0 4px 4px 0', padding: '8px 10px' }}>
                        <div style={{ fontSize: 12, color: G, fontWeight: 500, marginBottom: 4 }}>✓ CONVERT IN {conversionMonthName.toUpperCase()}</div>
                        {[
                          'All income variables locked — no surprises',
                          'Convert exactly the safe amount',
                          'Stay in ' + targetRate + '% bracket with precision',
                          'Minimize lifetime taxes, not just current year',
                        ].map((r, i) => (
                          <div key={i} style={{ fontSize: 12, color: M, marginBottom: 2 }}>· {r}</div>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--fd-card)', borderLeft: '2px solid var(--fd-hairline)', borderRadius: '0 4px 4px 0', fontSize: 12, color: 'var(--fd-accent)', lineHeight: 1.5 }}>
                      Your dashboard enforces this automatically: Window trigger = <strong>Dec 1</strong> · Income pacing gate = <strong>≥ 80%</strong> · Confidence = <strong>HIGH</strong> required.
                      All three converge in {conversionMonthName}. This is why the window shows <strong>WAIT</strong> all year and opens only when the math is final.
                    </div>
                  </div>

                </div>
              )
            })()}
          </TerminalSection>

          {/* ── STOP verdict info block — shown instead of execution checklist when verdict is STOP ── */}
          {(isConversionMonth || (tx?.conversion_imminent ?? false)) && verdict?.status === 'STOP' && verdict && (
            <div style={{
              border: `1px solid ${R}60`, borderLeft: `4px solid ${R}`,
              borderRadius: 0, background: `${R}08`, padding: '14px 16px',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: R, letterSpacing: '1.5px' }}>
                ✗ CONVERSION SUSPENDED — VERDICT: STOP
              </div>
              <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
                {verdict.detail}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  {
                    label: 'CONVERTED YTD',
                    value: fmtMoneyFull(ytdConverted),
                    color: R,
                    sub: `of ${fmtMoneyFull(annualTarget)} plan target`,
                  },
                  {
                    label: 'EXCEEDED BY',
                    value: fmtMoneyFull(verdict.excessOverOptimal),
                    color: R,
                    sub: 'above tax-optimal — already in next bracket territory',
                  },
                  {
                    label: 'BRACKET-FILL OPTION',
                    value: verdict.bracketFillRemaining > 0 ? fmtMoneyFull(verdict.bracketFillRemaining) : 'None',
                    color: verdict.bracketFillRemaining > 0 ? A : M,
                    sub: verdict.bracketFillRemaining > 0
                      ? 'remaining bracket room — consult CPA before using'
                      : 'bracket fully utilized',
                  },
                ].map(m => (
                  <div key={m.label} style={{ background: 'var(--fd-card)', borderRadius: 0, padding: '8px 10px' }}>
                    <div style={{ fontSize: 12, color: M, letterSpacing: '0.5px', marginBottom: 3 }}>{m.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: m.color }}>{m.value}</div>
                    <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{m.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: M, padding: '6px 10px', background: `${A}0d`, borderLeft: `2px solid ${A}40`, borderRadius: '0 4px 4px 0' }}>
                Planning for {new Date().getFullYear() + 1}: review bracket room in November with fresh income data.
                Next conversion window opens when projected AGI clears the {tx.target_bracket_rate ?? 24}% ceiling.
              </div>
            </div>
          )}

          {/* ── EXECUTION MONTH ACTION BLOCK — only rendered in the configured conversion month ── */}
          {showDecActionBlock && (() => {
            const netRoom     = Math.max(0, actualRoom - safetyBuf)
            const convAmt     = convRecommended   // already computed: min(annualTarget, netRoom)
            const hasRoom     = netRoom > 0
            const alreadyDone = isComplete
            const urgency     = daysToDec31 <= 7 ? 'critical' : daysToDec31 <= 14 ? 'high' : 'normal'
            const urgencyColor = urgency === 'critical' ? R : urgency === 'high' ? Y : A
            const decWinState = alreadyDone ? 'COMPLETE' : !hasRoom ? 'NO ROOM' : convWin === 'OPEN' ? 'OPEN — ACT NOW' : incomeReceivedPct >= triggerThreshold ? 'OPEN — ACT NOW' : 'REVIEW'
            const decWinColor = alreadyDone ? G : !hasRoom ? M : (convWin === 'OPEN' || incomeReceivedPct >= triggerThreshold) ? G : Y

            return (
              <div style={{
                border: `1px solid ${urgencyColor}60`,
                borderLeft: `4px solid ${urgencyColor}`,
                borderRadius: 0,
                background: `${urgencyColor}0a`,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: urgencyColor, letterSpacing: '1.5px', marginBottom: 3 }}>
                      {alreadyDone
                        ? `✓ ${conversionMonthName.toUpperCase()} CONVERSION COMPLETE`
                        : ` ${conversionMonthName.toUpperCase()} ACTION REQUIRED — FINAL BRACKET FILL`}
                    </div>
                    <div style={{ fontSize: 12, color: M, lineHeight: 1.4 }}>
                      {alreadyDone
                        ? `Annual target met. ${fmtMoneyFull(ytdConverted)} converted — no further action needed this year.`
                        : `All income variables are now locked. Compute final bracket room and execute the safe conversion amount before ${conversionMonthName} 31.`}
                    </div>
                  </div>
                  {/* Deadline countdown badge */}
                  <div style={{
                    flexShrink: 0, marginLeft: 16,
                    background: daysToDec31 <= 7 ? `${R}20` : 'var(--fd-card)',
                    border: `1px solid ${urgencyColor}40`,
                    borderRadius: 0,
                    padding: '6px 12px',
                    textAlign: 'center',
                    minWidth: 80,
                  }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500, color: urgencyColor, lineHeight: 1 }}>
                      {daysToDec31}
                    </div>
                    <div style={{ fontSize: 12, color: M, letterSpacing: '0.5px', marginTop: 2 }}>DAYS LEFT</div>
                    <div style={{ fontSize: 12, color: M }}>END OF {conversionMonthName.toUpperCase().slice(0, 3)}</div>
                  </div>
                </div>

                {/* Status + metrics row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {[
                    {
                      label: 'DEC WINDOW',
                      value: decWinState,
                      color: decWinColor,
                      sub: alreadyDone ? 'target met' : convWin === 'OPEN' ? 'all gates satisfied' : `income at ${incomeReceivedPct.toFixed(0)}% · need ${triggerThreshold}% · ${conversionMonthName}`,
                    },
                    {
                      label: 'FINAL BRACKET ROOM',
                      value: hasRoom ? fmtMoneyFull(netRoom) : '$0',
                      color: hasRoom ? G : M,
                      sub: hasRoom ? `${fmtMoneyFull(actualRoom)} − ${fmtMoneyFull(safetyBuf)} buffer` : 'bracket full — no conversion',
                    },
                    {
                      label: 'RECOMMENDED CONVERSION',
                      value: alreadyDone ? 'COMPLETE ✓' : convAmt > 0 ? fmtMoneyFull(convAmt) : '$0 — room exhausted',
                      color: alreadyDone ? G : convAmt > 0 ? A : M,
                      sub: alreadyDone ? `${fmtMoneyFull(ytdConverted)} already converted` : convAmt > 0 ? `execute before ${conversionMonthName} 31` : 'no additional conversion',
                    },
                    {
                      label: 'YTD PROGRESS',
                      value: `${Math.round(progressPct)}%`,
                      color: progressPct >= 100 ? G : progressPct >= 75 ? Y : R,
                      sub: `${fmtMoneyFull(ytdConverted)} of ${fmtMoneyFull(annualTarget)} target`,
                    },
                  ].map((m, i) => (
                    <div key={i} style={{
                      background: 'var(--fd-card)',
                      borderRadius: 0,
                      padding: '8px 10px',
                      borderTop: `2px solid ${m.color}40`,
                    }}>
                      <div style={{ fontSize: 12, color: M, letterSpacing: '0.5px', marginBottom: 3 }}>{m.label}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: m.color }}>{m.value}</div>
                      <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{m.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Action checklist */}
                {!alreadyDone && (
                  <div>
                    <div style={{ fontSize: 12, color: urgencyColor, fontWeight: 500, letterSpacing: '1px', marginBottom: 6 }}>
                      {conversionMonthName.toUpperCase()} EXECUTION CHECKLIST
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>
                      {[
                        { label: 'Confirm actual AGI is final',             met: incomeReceivedPct >= 95 },
                        { label: `Income pacing ≥ ${triggerThreshold}%`,   met: incomeReceivedPct >= triggerThreshold },
                        { label: 'STCG/LTCG events complete',               met: incomeReceivedPct >= 90 },
                        { label: 'Bracket room confirmed positive',         met: hasRoom },
                        { label: `Convert ${fmtMoneyFull(convAmt)} before ${conversionMonthName} 31`, met: alreadyDone },
                      ].map((c, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: c.met ? G : M, padding: '2px 0' }}>
                          <span style={{ flexShrink: 0, marginTop: 1 }}>{c.met ? '✓' : '○'}</span>
                          <span style={{ color: c.met ? G : 'var(--text)' }}>{c.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )
          })()}

          {/* Roth summary — unique values only; ROLLOVER BAL / MAX ADDITIONAL / CONV SCORE / CONVERTED YTD
               all appear in ConversionStatusPanel below so they are omitted here */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {/* Issue 4 fix: show all active blockers, not just income confidence */}
            <StatTile label="WINDOW STATUS" value={rolloverDepleted ? 'COMPLETE' : convWin}
              color={rolloverDepleted ? G : convWin === 'OPEN' ? G : convWin === 'WAIT' ? Y : R}
              badge={rolloverDepleted ? 'green' : convWin === 'OPEN' ? 'green' : convWin === 'WAIT' ? 'yellow' : 'red'}
              badgeLabel={rolloverDepleted ? 'GOAL MET' : undefined}
              sub={rolloverDepleted
                ? 'Rollover IRA fully converted — no further conversions possible'
                : convWin === 'WAIT' && windowBlockers.length > 0
                ? windowBlockers.slice(0, 3).join(' · ')
                : `${incConf.toLowerCase()} confidence`} />
            {/* Issue 2 fix: rename to PLAN REMAINDER, flag not recommended when window ≠ OPEN */}
            <StatTile label="PLAN REMAINDER" value={remaining > 0 ? fmtMoneyFull(remaining) : 'COMPLETE ✓'}
              color={remaining > 0 ? (convWin !== 'OPEN' ? R : A) : G}
              badge={remaining === 0 ? 'green' : convWin !== 'OPEN' ? 'red' : 'orange'}
              badgeLabel={rolloverDepleted ? 'ROLLOVER DEPLETED' : remaining === 0 ? 'DONE' : convWin !== 'OPEN' ? 'NOT RECOMMENDED' : 'REMAINING'}
              sub={rolloverDepleted
                ? 'entire Rollover IRA converted to Roth — lifetime goal achieved'
                : remaining > 0
                ? (convWin !== 'OPEN'
                    ? `plan remainder — DO NOT CONVERT · window ${convWin}${convExceeded ? ' + tax-optimal exceeded' : ''}`
                    : `of ${fmtMoneyFull(annualTarget)} annual plan target`)
                : undefined} />
            <StatTile label="TRIGGER" value={triggerMet ? '✓ TRIGGERED' : dec1Triggered ? 'DEC-1' : 'PENDING'}
              color={triggerMet ? G : dec1Triggered ? Y : M}
              badge={triggerMet ? 'green' : dec1Triggered ? 'yellow' : 'none'}
              sub={tx.conversion_month_name ?? 'income trigger'} />
            {/* TAX-OPTIMAL TARGET — mirrors PLAN REMAINDER: flag WAIT so both tiles agree */}
            <StatTile label="TAX-OPTIMAL TARGET" value={convRecommended > 0 ? fmtMoneyFull(convRecommended) : '—'}
              color={convExceeded ? M : convWin !== 'OPEN' ? Y : A}
              badge={convExceeded ? 'none' : convWin !== 'OPEN' ? 'yellow' : convRecommended > 0 ? 'orange' : 'none'}
              badgeLabel={convExceeded ? undefined : convWin !== 'OPEN' ? 'NOT YET — WAIT' : convRecommended > 0 ? 'TARGET' : undefined}
              sub={convExceeded
                ? 'already exceeded — no additional conversion this year'
                : convWin !== 'OPEN'
                ? `safe amount once window opens — window is ${convWin}`
                : `based on ${tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}% bracket room minus buffer`} />
          </div>

          {bannerVisible && (
            <div style={{ padding: '10px 14px', background: `${bannerColor}14`, border: `1px solid ${bannerColor}40`, borderRadius: 0, fontSize: 12, color: bannerColor, fontWeight: 500 }}>
              {bannerText}
            </div>
          )}

          <TerminalSection id="conv-status" title="◈ CONVERSION STATUS & PROGRESS" defaultOpen={true} accent={A}>
            <ConversionStatusPanel {...statusProps} />
          </TerminalSection>

          {/* ── LIFETIME STRATEGY label ── */}
          <div style={{ padding: '3px 12px', background: 'transparent', borderTop: '1px solid var(--fd-hairline)', borderBottom: '1px solid var(--fd-hairline)', fontSize: 12, color: 'var(--fd-negative)', fontWeight: 500, letterSpacing: '1.5px' }}>
            LIFETIME STRATEGY (Age {Math.floor(tx?.current_age ?? 60)} → 90) — RMD · Partial · Full Conversion
          </div>

          {rolloverBal > 0 && annualTarget > 0 && (
            <TerminalSection id="rmd-scenario" title="◈ RMD-ONLY vs. CONVERSION — LIFETIME COMPARISON" defaultOpen={true} accent={R}>
              <RmdScenarioPanel tx={tx} rolloverBal={rolloverBal} rothBal={rothBal} annualTarget={annualTarget} />
            </TerminalSection>
          )}

          {/* ── ANNUAL EXECUTION label ── */}
          <div style={{ padding: '3px 12px', background: 'transparent', borderTop: '1px solid var(--fd-hairline)', borderBottom: '1px solid var(--fd-hairline)', fontSize: 12, color: 'var(--fd-ink)', fontWeight: 500, letterSpacing: '1.5px' }}>
            ANNUAL EXECUTION (This Year) — Conversion window · bracket math · YTD progress
          </div>

          <TerminalSection id="conv-scen" title="◈ CONVERSION SCENARIOS" defaultOpen={true} accent={A}>
            <ConversionScenarios tx={tx} ytdConverted={ytdConverted} actualRoom={actualRoom} convWin={convWin} scenarios={scenarios}
              grossNoSS={grossNoSS} ceiling={ceiling} safetyBuf={safetyBuf} />
          </TerminalSection>

          {mode === 'advanced' && (
            <>
              <TerminalSection id="conv-logic" title="◈ ROOM & AGI CALCULATION ENGINE" defaultOpen={false} accent={Y}>
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <RoomCalcPanel ceiling={ceiling} grossNoSS={grossActual ?? grossNoSS}
                      safetyBuf={safetyBuf} convWin={convWin} confColor={confColor} incConf={incConf}
                      targetBracketRate={tx.target_bracket_rate} />
                    <AgiEnginePanel fullYrAgiEst={fullYrAgiEst} actualYtdAgi={actualYtdAgi} bindingAgi={bindingAgi}
                      ceiling={ceiling} grossNoSS={grossActual ?? grossNoSS} safetyBuf={safetyBuf}
                      confColor={confColor} incConf={incConf} isActualBinding={isActualBinding} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <ScorePanel tx={tx} convScore={convScore} scoreColor={scoreColor} />
                    <TimingEnginePanel incomeReceivedPct={incomeReceivedPct} triggerThreshold={triggerThreshold}
                      triggerMet={triggerMet} daysTo1Dec={daysTo1Dec} dec1Triggered={dec1Triggered}
                      incConf={incConf} actualRoom={actualRoom} tx={tx}
                      amountExceeded={ytdConverted >= convRecommended && convRecommended > 0} />
                  </div>
                </div>
              </TerminalSection>

              <TerminalSection id="conv-impact" title="◈ CONVERSION IMPACT" defaultOpen={false} accent={G}>
                <TerminalSection id="conv-calendar" title="   A. Conversion Schedule — Multi-Year Rollover Depletion" defaultOpen={true}>
                  <ConversionCalendarPanel
                    tx={tx} data={data}
                    rolloverBal={rolloverBal} rothBal={rothBal}
                    annualTarget={annualTarget} ytdConverted={ytdConverted} remaining={remaining}
                    convPlanBase={convPlanBase} convPlanDec={convPlanDec}
                    rothPlan={rothPlan}
                    convWin={convWin}
                    windowBlockers={windowBlockers}
                    whyNotConvert={decision.why_not_convert?.reasons ?? []} />
                </TerminalSection>
                <TerminalSection id="conv-acct" title="   B. Account Allocation Impact" defaultOpen={false}>
                  <AccountImpactPanel
                    convPlanBase={convPlanBase} convPlanDec={convPlanDec}
                    rothPlan={rothPlan}
                    rolloverBal={rolloverBal} rothBal={rothBal}
                    annualTarget={annualTarget} ytdConverted={ytdConverted} remaining={remaining}
                    convWin={convWin} safeRoom={Math.max(0, actualRoom - safetyBuf)} />
                </TerminalSection>
                <TerminalSection id="conv-tax" title="   C. Tax Impact" defaultOpen={false}>
                  <TaxImpactPanel tx={tx} rothPlan={rothPlan} />
                </TerminalSection>
                {scenarios.recommended.rows.length > 0 && (
                  <TerminalSection id="conv-proj" title="   D. Long-Term Projection" defaultOpen={false}>
                    <ProjectionPanel tx={tx} scenarios={scenarios} />
                  </TerminalSection>
                )}
              </TerminalSection>
            </>
          )}
        </div>
      )} {/* end subView==='roth' */}

      {/* ── SELL & REBALANCE sub-view ── */}
      {/* Unified engine: LotAdvisor (lot-level micro signals) + RebalancePlanPanel (multi-year macro schedule).
          These share the same lots, STCG/LTCG logic, NIIT constraints, and bracket ceilings.
          LotAdvisor answers "which lots, sell now or wait?" — RebalancePlanPanel answers "when over multiple years, in what order, with what budget?". */}
      {subView === 'sell' && (
        <div style={{ paddingTop: 56, display: 'flex', flexDirection: 'column', gap: 56 }}>

          {/* ── 1. Lot-Level Tax Signals ── */}
          <SectionHeader
            title="Lot-level tax signals"
            hint="STCG / LTCG · maturity · value of waiting"
          />
          <LotAdvisor data={data} mode={mode} />

          {/* ── 2. Multi-Year Rebalance Plan ── */}
          <div>
            <SectionHeader
              title="Multi-year rebalance plan"
              hint="Respects bracket ceiling · NIIT priced as cost"
            />
            <RebalancePlanPanel data={data} mode={mode} />
          </div>

        </div>
      )}
    </div>
  )
}
