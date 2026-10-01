/**
 * roadmapEngine — pure functions computing the 5-phase retirement roadmap
 * from live settings/data. No React, no hardcoded years: every boundary is
 * derived from `retirement_year`, SS start date, and RMD start age so it
 * stays correct as Settings change or time passes.
 *
 * Phase 2→3 (Bridge → Conversion Tail) is balance-driven, not date-driven —
 * it flips once the live Rollover IRA balance drops under
 * ROLLOVER_DEPLETION_THRESHOLD. The displayed end-year for Phase 2 is an
 * estimate only (current balance ÷ current conversion pace); the actual
 * phase-detection in getCurrentPhase() uses the live balance.
 */
import type { ExtendedTaxData, IncomeAnalytics } from '../types/dashboard'
import type { TabId } from '../components/layout/AppHeader'
import type { PrimaryAction } from './retirementEngine'
import type { ProjYear } from '../components/forecast/predictions.constants'
import { fmtMoney } from './formatters'

export type RoadmapPhaseId = 'final_prep' | 'bridge' | 'conversion_tail' | 'ss_active' | 'rmd'

export interface RoadmapPhase {
  id: RoadmapPhaseId
  index: number                    // 1-5, for "Phase X of 5"
  label: string
  startYear: number
  endYear: number | null           // null = open-ended (final phase)
  isBoundaryDynamic: boolean       // true = end year is an estimate (balance-driven or a computed fallback), not a fixed/live date
  startYearIsDynamic: boolean      // same, but for startYear — a phase's startYear is often the PREVIOUS phase's endYear and must carry the same estimate flag, or adjacent phases display the identical year once tilded (a guess) and once bare (asserted as fact)
  primaryTabs: TabId[]
  summary: string
  actions: string[]
}

const ROLLOVER_DEPLETION_THRESHOLD = 10_000

export function computeAge(dob: string, asOf: Date): number {
  if (!dob) return 0
  const d = new Date(dob)
  return (asOf.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
}

/** Days from `asOf` to Jan 1 of `year` — used for "N days to retirement" display. */
export function daysUntilYearStart(year: number, asOf: Date): number {
  const target = new Date(year, 0, 1)
  return Math.round((target.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Closest Forecast projection row to a phase's boundary year. Phase-end years
 * are estimates, not guaranteed to land exactly on a calYear, so this finds
 * the nearest available row rather than requiring an exact match.
 */
export function projectedBalanceAtYear(projYears: ProjYear[], targetYear: number): ProjYear | null {
  if (!projYears.length) return null
  return projYears.reduce((closest, row) =>
    Math.abs(row.calYear - targetYear) < Math.abs(closest.calYear - targetYear) ? row : closest
  )
}

/**
 * Display string for a phase's year range. Handles the degenerate case where
 * a balance-driven estimate collides with the next fixed boundary (e.g. a
 * slow conversion pace pushes the Bridge depletion estimate out to the same
 * year Social Security starts) — rather than showing a confusing zero-width
 * "2036–2036" range, collapse it to a single estimated year.
 */
export function formatPhaseYears(phase: RoadmapPhase): string {
  const startPrefix = phase.startYearIsDynamic ? '~' : ''
  if (phase.endYear == null) return `${startPrefix}${phase.startYear}+`
  if (phase.endYear <= phase.startYear) return `${startPrefix}${phase.startYear}`
  return `${startPrefix}${phase.startYear}–${phase.isBoundaryDynamic ? '~' : ''}${phase.endYear}`
}

function parseYearFromDateStr(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const y = parseInt(dateStr.slice(0, 4), 10)
  return Number.isFinite(y) ? y : null
}

export function getPhases(taxData: ExtendedTaxData, asOf: Date): RoadmapPhase[] {
  const year = asOf.getFullYear()
  const retirementYearIsGuess = taxData.retirement_year == null
  // Fallback of `year` (not yet retired, so we truly don't know) collapses
  // Final Prep to zero width — `year < finalPrep.endYear` then evaluates to
  // false and getCurrentPhase() skips straight to Bridge/Conversion Tail for
  // someone who hasn't even set a retirement date yet. `year + 1` keeps a
  // real, non-zero Final Prep window until an actual date is configured.
  const retirementYear = taxData.retirement_year ?? (year + 1)

  // Each "IsGuess" flag is true whenever the boundary came from an arithmetic
  // fallback (missing live data) rather than a real configured/live date —
  // it drives the `~` shown in formatPhaseYears so a fabricated year is never
  // displayed with the same visual confidence as a real one.
  const ssStartYearIsGuess = parseYearFromDateStr(taxData.ss_start_date) == null
  const ssStartYear =
    parseYearFromDateStr(taxData.ss_start_date) ??
    (taxData.ss_years_until != null ? year + Math.round(taxData.ss_years_until) : retirementYear + 9)

  const rmdStartYearIsGuess = taxData.years_to_rmd == null
  const rmdStartYear =
    taxData.years_to_rmd != null ? year + Math.round(taxData.years_to_rmd) : ssStartYear + 5

  // Display-only estimate of when the Rollover IRA depletes, from current balance
  // ÷ current conversion pace. Actual phase detection (getCurrentPhase) uses the
  // live balance against ROLLOVER_DEPLETION_THRESHOLD, not this estimate.
  const conversionPace = taxData.annual_conversion ?? taxData.annual_conversion_recommended ?? 0
  const rolloverBalance = taxData.rollover_balance ?? 0
  const yearsToDeplete = conversionPace > 0 ? Math.ceil(rolloverBalance / conversionPace) : null
  const bridgeStartYear = Math.max(year, retirementYear)
  const estimatedBridgeEndYear = yearsToDeplete != null
    ? Math.min(bridgeStartYear + yearsToDeplete, ssStartYear)
    : Math.max(retirementYear + 1, ssStartYear - 3)

  // Whether a Roth conversion plan is even applicable — a Rollover IRA with a
  // real balance to convert down. Without this, the Final Prep/Bridge summary
  // and action text below would unconditionally tell someone with no Rollover
  // IRA (or nothing left in it) to "finish this year's Roth conversion."
  const hasConversionPlan = rolloverBalance > 0

  return [
    {
      id: 'final_prep', index: 1, label: 'Final Prep',
      startYear: Math.min(year, retirementYear), endYear: retirementYear,
      isBoundaryDynamic: retirementYearIsGuess, startYearIsDynamic: false,
      primaryTabs: ['overview', 'forecast', 'tax', 'portfolio'],
      summary: hasConversionPlan
        ? "Confirm the plan is sustainable before the paycheck stops — lock in this year's Roth conversion ahead of retirement."
        : "Confirm the plan is sustainable before the paycheck stops.",
      actions: [
        "Re-run Forecast with post-retirement spending assumptions",
        ...(hasConversionPlan ? ["Finish this year's Roth conversion before Dec 31"] : []),
      ],
    },
    {
      id: 'bridge', index: 2, label: 'Bridge',
      startYear: retirementYear, endYear: estimatedBridgeEndYear,
      isBoundaryDynamic: true, startYearIsDynamic: retirementYearIsGuess,
      primaryTabs: ['cashflow', 'drawdown', 'tax', 'risk'],
      summary: hasConversionPlan
        ? "Retirement income is live, before Social Security starts. Dividends and the cash bucket cover spending while the Rollover IRA converts down toward the target bracket ceiling every year."
        : "Retirement income is live, before Social Security starts. Dividends and the cash bucket cover spending.",
      actions: [
        ...(hasConversionPlan ? ["Confirm this year's conversion amount before Dec 1"] : []),
        "Review bucket/dividend draw vs. actual spending each quarter",
        ...(hasConversionPlan ? ["Watch the Rollover IRA balance trend toward the Phase 3 estimate"] : []),
      ],
    },
    {
      id: 'conversion_tail', index: 3, label: 'Conversion Tail',
      // startYear is the SAME number as Bridge's endYear (estimatedBridgeEndYear),
      // which is always an estimate — carry that same flag here so the identical
      // year isn't shown as a guess once and a fact right next to it.
      startYear: estimatedBridgeEndYear, endYear: ssStartYear,
      isBoundaryDynamic: ssStartYearIsGuess, startYearIsDynamic: true,
      primaryTabs: ['tax', 'drawdown', 'forecast'],
      summary: "The Rollover IRA is mostly converted. Spending now leans more on taxable and Roth accounts until Social Security begins.",
      actions: [
        "Re-check withdrawal order now that the Rollover IRA is thin",
        "Confirm remaining conversion room each year, if any",
        "Track years remaining until Social Security start",
      ],
    },
    {
      id: 'ss_active', index: 4, label: 'SS Active',
      startYear: ssStartYear, endYear: rmdStartYear,
      isBoundaryDynamic: rmdStartYearIsGuess, startYearIsDynamic: ssStartYearIsGuess,
      primaryTabs: ['cashflow', 'tax', 'forecast'],
      summary: "Social Security is now part of the income mix, which makes a portion of it taxable. RMDs are still a few years out.",
      actions: [
        "Confirm the SS benefit is landing as projected",
        "Re-check tax bracket pressure now that SS is taxable income",
        "Start modeling the first RMD a couple years ahead of the start age",
      ],
    },
    {
      id: 'rmd', index: 5, label: 'RMD',
      startYear: rmdStartYear, endYear: null,
      isBoundaryDynamic: false, startYearIsDynamic: rmdStartYearIsGuess,
      primaryTabs: ['forecast', 'tax', 'drawdown'],
      summary: "Required Minimum Distributions are active. Withdrawals from pre-tax accounts are no longer optional — the focus shifts to managing the tax hit and long-run sustainability.",
      actions: [
        "Confirm the RMD amount is withdrawn each year before Dec 31",
        "Re-check tax bracket pressure annually as RMDs grow",
        "Review longevity/sustainability projections in Forecast",
      ],
    },
  ]
}

/**
 * Determines the active phase. Phase 2→3 is balance-driven: Phase 2 (Bridge)
 * persists past its estimated end year as long as the Rollover IRA balance
 * is still meaningful — it only flips to Phase 3 once the balance drops
 * under the depletion threshold.
 */
export function getCurrentPhase(phases: RoadmapPhase[], asOf: Date, rolloverBalance: number): RoadmapPhase {
  const year = asOf.getFullYear()
  const [finalPrep, bridge, conversionTail, ssActive, rmd] = phases

  if (year < finalPrep.endYear!) return finalPrep
  if (year < ssActive.startYear) {
    return rolloverBalance > ROLLOVER_DEPLETION_THRESHOLD ? bridge : conversionTail
  }
  if (year < rmd.startYear) return ssActive
  return rmd
}

// ─── Per-phase "this year's numbers" ────────────────────────────────────────
// Every value here is read from a field some other tab already computes
// (Tax/Drawdown/Risk/Cash Flow) — nothing here re-derives tax, withdrawal,
// or volatility math. This function only selects which existing numbers are
// most relevant to a given phase and which tab to link them back to.
// `explain` is the plain-language "what this means" line shown alongside it —
// this is the receipt behind the advisor-voice paragraph in getPhaseInsight().

export interface PhaseMetric {
  label: string
  value: number | string
  kind: 'money' | 'pct' | 'text'
  tab: TabId
  explain: string
}

/**
 * Roth-conversion room for THIS YEAR specifically — nets YTD conversions
 * against the manual annual_conversion target, same source as the Tax tab's
 * CONVERTED YTD / REMAINING figures. Deliberately not the static bracket-
 * ceiling "recommended" number: that figure never changes once you've
 * already converted, so quoting it after the year's conversion is done
 * ("you can still move up to $X") would contradict the Tax tab showing
 * REMAINING $0 / STATUS COMPLETE. Shared by Final Prep, Bridge, and
 * Conversion Tail so all three phases agree with each other.
 */
function conversionRoomMetric(tx: ExtendedTaxData): PhaseMetric | null {
  const remaining = tx.remaining_to_convert
  if (remaining == null) return null
  const convertedYtd = tx.converted_ytd ?? 0
  const target = tx.annual_conversion ?? null

  if (remaining > 0) {
    return {
      label: 'Remaining conversion room', value: remaining, kind: 'money', tab: 'tax',
      explain: `How much more you can convert from your Rollover IRA to Roth this year before hitting your ${tx.target_bracket_rate ?? '—'}% bracket ceiling. Resets every January.`,
    }
  }
  const isOver = target != null && convertedYtd > target
  return {
    label: isOver ? 'Conversion over plan' : 'Conversion room used',
    value: isOver ? convertedYtd - (target ?? 0) : convertedYtd,
    kind: 'money', tab: 'tax',
    explain: isOver
      ? `You've converted ${fmtMoney(convertedYtd)} this year, about ${fmtMoney(convertedYtd - (target ?? 0))} more than your ${fmtMoney(target ?? 0)} plan — worth checking the Tax tab for the resulting bracket impact.`
      : `You've used all of this year's Roth conversion room (${fmtMoney(convertedYtd)} converted) — nothing more without crossing into a higher bracket. Resets in January.`,
  }
}

/** Same underlying figures as conversionRoomMetric(), as one narrative sentence. */
function conversionRoomSentence(tx: ExtendedTaxData): string | null {
  const remaining = tx.remaining_to_convert
  if (remaining == null) return null
  const convertedYtd = tx.converted_ytd ?? 0
  const target = tx.annual_conversion ?? null

  if (remaining > 0) {
    return `You have about ${fmtMoney(remaining)} of room left to convert to Roth this year without crossing into a higher bracket than your ${tx.target_bracket_rate ?? '—'}% target — that room resets every January, so it's worth using before Dec 31.`
  }
  if (target != null && convertedYtd > target) {
    return `You've already converted ${fmtMoney(convertedYtd)} this year — about ${fmtMoney(convertedYtd - target)} more than your ${fmtMoney(target)} plan — worth checking the Tax tab for the resulting bracket impact.`
  }
  return `You've already used all of this year's Roth conversion room (${fmtMoney(convertedYtd)} converted) — nothing more to convert without crossing into a higher bracket. That room resets in January.`
}

/**
 * Bracket-rate clause for the survivor comparison. The dollar gap
 * (extra_annual_tax_as_single) is always the reliable fact — narrower Single
 * brackets mean more of the balance is taxed at higher rates on the way up,
 * even when the top marginal rate happens to land the same on both sides
 * (e.g. both hit the uncapped top bracket). Only claim "different bracket"
 * when the marginal rates actually differ, so the sentence never says
 * "37% instead of 37%" while still citing a real dollar gap.
 */
function survivorBracketClause(sbp: NonNullable<ExtendedTaxData['survivor_bracket_projection']>): string {
  const mfjPct = Math.round(sbp.mfj_bracket_at_this_income * 100)
  const singlePct = Math.round(sbp.single_bracket_at_this_income * 100)
  return singlePct > mfjPct
    ? `landing in the ${singlePct}% bracket instead of the ${mfjPct}% you're targeting as MFJ`
    : `even at the same ${singlePct}% top bracket, Single's narrower brackets mean more of that balance is taxed at higher rates along the way`
}

/** Survivor bracket-compression metric — shared by conversion_tail and ss_active,
 * the two phases where the pre-tax balance is still material. Only computed
 * server-side for MFJ filers; every number in it (brackets, deduction, projected
 * balance) traces back to Settings, never a hardcoded rate. */
function survivorMetric(tx: ExtendedTaxData): PhaseMetric | null {
  const sbp = tx.survivor_bracket_projection
  if (!sbp || !sbp.extra_annual_tax_as_single) return null
  return {
    label: 'Survivor bracket exposure', value: sbp.extra_annual_tax_as_single, kind: 'money', tab: 'tax',
    explain: `If pre-tax balances aren't drawn down further, a surviving spouse filing Single around ${sbp.survivor_year_estimate} would owe about ${fmtMoney(sbp.extra_annual_tax_as_single)} more per year in tax on the same ${fmtMoney(sbp.projected_pretax_balance_at_survivor_year)} balance — ${survivorBracketClause(sbp)}.`,
  }
}

/** Same underlying figures as survivorMetric(), as one narrative sentence. */
function survivorSentence(tx: ExtendedTaxData): string | null {
  const sbp = tx.survivor_bracket_projection
  if (!sbp || !sbp.extra_annual_tax_as_single) return null
  return `One more thing worth factoring in: at the current pace, about ${fmtMoney(sbp.projected_pretax_balance_at_survivor_year)} would still be pre-tax around ${sbp.survivor_year_estimate} — if a surviving spouse were filing Single by then, that balance would mean about ${fmtMoney(sbp.extra_annual_tax_as_single)} more tax per year, ${survivorBracketClause(sbp)}.`
}

/** Short, plain-language gloss of the A/B/C withdrawal state — matches the rules.json
 * descriptions for each state, simplified. Not shown anywhere else in the UI as prose. */
function withdrawalStateGloss(state: 'A' | 'B' | 'C'): string {
  if (state === 'A') return 'your dividend income alone covers your spending — nothing needs to be sold'
  if (state === 'B') return 'dividends cover most of your spending, with some careful selling on top'
  return "you're relying on planned account sales in addition to dividends, gradually shifting the mix of income-focused funds, and topping up a one-year cash reserve"
}

export function getPhaseMetrics(
  phaseId: RoadmapPhaseId,
  tx: ExtendedTaxData,
  incomeAnalytics: IncomeAnalytics | null | undefined,
  endYear: number | null,
  projYears: ProjYear[],
): PhaseMetric[] {
  const dividendCoveragePct = (incomeAnalytics?.portfolio_fwd_12m != null && tx.estimated_spending)
    ? (incomeAnalytics.portfolio_fwd_12m / tx.estimated_spending) * 100
    : null
  // Matches the "State C: ..." convention already used on Overview — the raw
  // config `name` (e.g. CAPITAL_GAIN_DOMINANT) isn't shown anywhere else in the UI.
  const withdrawalStateLabel = tx.withdrawal_current_state ? `State ${tx.withdrawal_current_state}` : null

  const m: PhaseMetric[] = []

  switch (phaseId) {
    case 'final_prep': {
      const convRoom = conversionRoomMetric(tx)
      if (convRoom) m.push(convRoom)
      if (dividendCoveragePct != null)
        m.push({
          label: 'Baseline spending covered by dividends', value: dividendCoveragePct, kind: 'pct', tab: 'cashflow',
          explain: `Dividends across all your accounts (taxable, Roth, and Rollover IRA) against your ${fmtMoney(tx.estimated_spending ?? 0)} baseline spending plan — before travel/lifestyle extras. This is a broader, all-accounts figure; it's not the same as the Tax tab's taxable-only "Est. dividends (fwd-12m)" used for bracket math, which only counts dividends that actually add to your taxable income.`,
        })
      break
    }
    case 'bridge': {
      if (dividendCoveragePct != null)
        m.push({
          label: 'Baseline spending covered by dividends', value: dividendCoveragePct, kind: 'pct', tab: 'cashflow',
          explain: `Dividends across all your accounts against your ${fmtMoney(tx.estimated_spending ?? 0)} baseline spending plan, before touching the cash bucket or selling anything. Broader than the Tax tab's taxable-only dividend figure used for bracket math.`,
        })
      if (tx.rollover_balance != null) m.push({
        label: 'Rollover IRA balance', value: tx.rollover_balance, kind: 'money', tab: 'portfolio',
        explain: "What's left in your pre-tax Rollover IRA — money from an old 401(k) that hasn't been taxed yet. You're converting it to Roth on purpose, a bit each year, so it doesn't create a big forced tax bill later.",
      })
      const convRoom = conversionRoomMetric(tx)
      if (convRoom) m.push(convRoom)
      if (withdrawalStateLabel != null && tx.withdrawal_current_state) m.push({
        label: 'Withdrawal state', value: withdrawalStateLabel, kind: 'text', tab: 'drawdown',
        explain: `The withdrawal strategy your dashboard has you in right now — ${withdrawalStateGloss(tx.withdrawal_current_state)}.`,
      })
      break
    }
    case 'conversion_tail': {
      if (tx.remaining_to_convert != null) m.push({
        label: 'Remaining conversion room', value: tx.remaining_to_convert, kind: 'money', tab: 'tax',
        explain: `How much more you could still convert to Roth this year before hitting your ${tx.target_bracket_rate ?? '—'}% bracket ceiling.`,
      })
      if (tx.rollover_balance != null) m.push({
        label: 'Rollover IRA balance', value: tx.rollover_balance, kind: 'money', tab: 'portfolio',
        explain: "What's left to convert or eventually draw from — by this phase it should be a small fraction of what it started at.",
      })
      if (tx.ss_years_until != null) m.push({
        label: 'Years until Social Security', value: `${tx.ss_years_until.toFixed(1)} yrs`, kind: 'text', tab: 'forecast',
        explain: `Time left until Social Security starts at the claiming age (${tx.ss_start_age}) you chose in Settings.`,
      })
      const survivorTail = survivorMetric(tx)
      if (survivorTail) m.push(survivorTail)
      break
    }
    case 'ss_active': {
      if (tx.ss_annual != null) m.push({
        label: 'Social Security benefit', value: tx.ss_annual, kind: 'money', tab: 'cashflow',
        explain: `The yearly check you chose to start collecting at age ${tx.ss_start_age} — waiting longer means a bigger check.`,
      })
      if (tx.bracket_pressure_pct != null) m.push({
        label: 'Bracket pressure', value: tx.bracket_pressure_pct, kind: 'pct', tab: 'tax',
        explain: `How much of your ${tx.target_bracket_rate ?? '—'}% target tax bracket you're using up this year. Social Security becomes partly taxable once it starts, which adds to this.`,
      })
      if (tx.years_to_rmd != null) m.push({
        label: 'Years until RMD', value: `${tx.years_to_rmd.toFixed(1)} yrs`, kind: 'text', tab: 'forecast',
        explain: `Years left before the IRS forces yearly withdrawals from your Rollover IRA, starting at age ${tx.rmd_start_age ?? 75}.`,
      })
      const survivorSs = survivorMetric(tx)
      if (survivorSs) m.push(survivorSs)
      break
    }
    case 'rmd': {
      if (tx.estimated_first_year_rmd != null) m.push({
        label: 'Estimated first-year RMD', value: tx.estimated_first_year_rmd, kind: 'money', tab: 'tax',
        explain: tx.estimated_first_year_rmd > 0
          ? `The IRS-required withdrawal from your Rollover IRA the year you turn ${tx.rmd_start_age ?? 75}, estimated from your projected balance at that age.`
          : `Projected near $0 because your Roth conversions are on pace to empty this account before age ${tx.rmd_start_age ?? 75}.`,
      })
      if (tx.estimated_rmd_tax != null) m.push({
        label: 'Estimated RMD tax', value: tx.estimated_rmd_tax, kind: 'money', tab: 'tax',
        explain: 'Extra tax owed because of that forced withdrawal, on top of your other income that year.',
      })
      if (tx.rollover_balance_at_rmd_age != null) m.push({
        label: 'Rollover balance at RMD age (est.)', value: tx.rollover_balance_at_rmd_age, kind: 'money', tab: 'forecast',
        explain: `Your projected Rollover IRA balance the year RMDs begin, based on your current conversion pace.`,
      })
      break
    }
  }

  // Cross-check against Forecast's own base-case projection at this phase's end
  // year — applies to every phase with a concrete boundary (RMD's endYear is null,
  // so it's naturally excluded). Base scenario only, deliberately: this is meant to
  // verify the roadmap's phase-boundary estimate against the same engine that
  // already models it, not to introduce bull/bear range framing into this tab.
  if (endYear != null) {
    const projRow = projectedBalanceAtYear(projYears, endYear)
    if (projRow) m.push({
      label: `Forecast projected balance (${projRow.calYear})`, value: projRow.portfolioValue, kind: 'money', tab: 'forecast',
      explain: `Forecast's base-case year-by-year projection expects roughly this portfolio value by ${projRow.calYear}, when this phase is estimated to end. This is one deterministic path based on today's configured growth assumptions, not a range or probability.`,
    })
  }

  return m
}

/** Plain clause for what a given primary_action means, in the advisor's voice. */
function primaryActionGloss(action: PrimaryAction): string {
  switch (action) {
    case 'EXECUTE_CONVERSION': return "it's a good time to convert more from your Rollover IRA to Roth — you have bracket room and income conditions look right"
    case 'DEFER_CONVERSION': return "hold off converting more to Roth for now, usually because recent short-term gains would push your tax bill up"
    case 'CONTROLLED_SALE': return 'sell some taxable investments carefully to cover spending, managing the tax hit as you go'
    case 'HOLD_INCOME_ONLY': return "your dividend income alone covers spending right now — no need to sell or convert anything"
    case 'REDUCE_RISK': return "Overview's decision engine is currently flagging elevated portfolio risk as today's top signal — see Overview for the full reasoning"
    case 'REFILL_BUCKET': return "your cash reserve is running low and needs topping up before it's needed"
    case 'MONITOR_ONLY': return 'nothing urgent — just keep an eye on things'
    default: return 'keep an eye on things'
  }
}

/**
 * The advisor-voice paragraph for a phase — weaves the live metrics into a
 * few plain sentences instead of a table of numbers. Every figure quoted
 * here also appears in getPhaseMetrics() as a receipt, so nothing is stated
 * without a traceable source.
 */
export function getPhaseInsight(
  phaseId: RoadmapPhaseId,
  tx: ExtendedTaxData,
  incomeAnalytics: IncomeAnalytics | null | undefined,
  primaryAction: PrimaryAction,
  isCurrentPhase: boolean,
): string {
  // Multi-year pace (why the Rollover IRA balance shrinks year over year) is a
  // different fact from THIS year's remaining room — use conversionRoomLine
  // for the latter so it never contradicts the Tax tab's CONVERTED YTD/REMAINING.
  const conversionPace = tx.annual_conversion ?? tx.annual_conversion_recommended ?? null
  const conversionRoomLine = conversionRoomSentence(tx)
  const dividendCoveragePct = (incomeAnalytics?.portfolio_fwd_12m != null && tx.estimated_spending)
    ? (incomeAnalytics.portfolio_fwd_12m / tx.estimated_spending) * 100
    : null
  const bracketRate = tx.target_bracket_rate ?? null
  const survivorLine = survivorSentence(tx)

  const sentences: string[] = []
  const covered = new Set<'conversion' | 'dividend'>()

  switch (phaseId) {
    case 'final_prep':
      if (conversionRoomLine) {
        sentences.push(conversionRoomLine)
        covered.add('conversion')
      }
      if (dividendCoveragePct != null) {
        sentences.push(
          `On the income side: dividends across all your accounts are on pace to cover about ${dividendCoveragePct.toFixed(0)}% of your ${fmtMoney(tx.estimated_spending ?? 0)} baseline spending plan — before travel or lifestyle extras.`
        )
        covered.add('dividend')
      }
      break
    case 'bridge':
      if (dividendCoveragePct != null) {
        sentences.push(`Dividends across all your accounts are covering about ${dividendCoveragePct.toFixed(0)}% of your ${fmtMoney(tx.estimated_spending ?? 0)} baseline spending.`)
        covered.add('dividend')
      }
      if (tx.rollover_balance != null) {
        sentences.push(
          `The rest comes from your cash bucket while you work down the ${fmtMoney(tx.rollover_balance)} left in your Rollover IRA` +
          (conversionPace != null ? ` — you're converting about ${fmtMoney(conversionPace)} of it to Roth each year, which is why the balance is shrinking on purpose, not by accident.` : '.')
        )
      }
      if (conversionRoomLine) {
        sentences.push(conversionRoomLine)
        covered.add('conversion')
      }
      if (tx.withdrawal_current_state) sentences.push(
        `Right now ${withdrawalStateGloss(tx.withdrawal_current_state)}.`
      )
      break
    case 'conversion_tail':
      sentences.push('The heavy lifting on the Rollover IRA is mostly done.')
      if (tx.remaining_to_convert != null) sentences.push(
        tx.remaining_to_convert > 0
          ? `There's still about ${fmtMoney(tx.remaining_to_convert)} of room to convert this year if you want it.`
          : "There's no more room to convert this year without jumping tax brackets."
      )
      if (tx.ss_years_until != null) sentences.push(
        `You have about ${tx.ss_years_until.toFixed(0)} years before Social Security starts, so taxable and Roth accounts pick up more of the spending in the meantime.`
      )
      if (survivorLine) sentences.push(survivorLine)
      break
    case 'ss_active':
      if (tx.ss_annual != null) sentences.push(
        `Social Security is now in the picture, adding ${fmtMoney(tx.ss_annual)} a year.`
      )
      if (tx.bracket_pressure_pct != null) sentences.push(
        `Here's the catch: part of that becomes taxable once it starts, and you're currently using about ${tx.bracket_pressure_pct.toFixed(0)}% of your ${bracketRate}% target bracket.`
      )
      if (tx.years_to_rmd != null) sentences.push(
        `You've got roughly ${tx.years_to_rmd.toFixed(0)} years before Required Minimum Distributions kick in at age ${tx.rmd_start_age ?? 75} and add even more taxable income on top — worth watching your remaining bracket room in the meantime.`
      )
      if (survivorLine) sentences.push(survivorLine)
      break
    case 'rmd':
      sentences.push(
        `Once you hit age ${tx.rmd_start_age ?? 75}, the IRS requires you to pull money out of your Rollover IRA every year, whether you need it or not.`
      )
      if (tx.estimated_first_year_rmd != null) sentences.push(
        tx.estimated_first_year_rmd > 0
          ? `Based on your current pace, that first required withdrawal is projected at about ${fmtMoney(tx.estimated_first_year_rmd)}` +
            (tx.estimated_rmd_tax ? `, adding about ${fmtMoney(tx.estimated_rmd_tax)} in extra tax on top of everything else you're receiving that year.` : '.')
          : "The good news: because you've been converting steadily, your projected balance in that account by then is close to zero — meaning your required withdrawal is expected to be minimal or nothing."
      )
      break
  }

  // The tactical "today" action is a real-time signal, not phase-specific — only
  // surface it when you're actually viewing the phase you're currently in, and
  // only if it's not already restating what the phase narrative just said.
  const actionTopic: Partial<Record<PrimaryAction, 'conversion' | 'dividend'>> = {
    EXECUTE_CONVERSION: 'conversion', DEFER_CONVERSION: 'conversion',
    HOLD_INCOME_ONLY: 'dividend',
  }
  const topic = actionTopic[primaryAction]
  if (isCurrentPhase && (!topic || !covered.has(topic))) {
    sentences.push(`Today's dashboard read: ${primaryActionGloss(primaryAction)}.`)
  }

  return sentences.join(' ')
}
