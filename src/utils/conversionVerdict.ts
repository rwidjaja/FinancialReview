import type { DashboardData } from '../types/dashboard'
import { DEFAULT_SAFETY_BUFFER } from './constants'
import { fmtMoneyFull } from './formatters'

// ── Canonical Roth-conversion verdict ────────────────────────────────────────
// Single source of truth for "should I convert more?" — every tab that shows a
// conversion recommendation (Overview signal card, Tax command center, Tax
// guidance chip, conversion tracker, withdrawal-state rules, Drawdown chips)
// must render THIS verdict, never re-derive its own.
//
// Two disciplines, one verdict:
//   tax-optimal  = bracket room − safety buffer (capped at plan target)
//   bracket-fill = plan target, allowed only while inside the bracket
// When YTD conversions exceed tax-optimal the verdict is STOP; the remaining
// plan-target amount is surfaced as an explicit "bracket-fill option", not a
// recommendation.
//
// Deliberately NOT bucket-aware: refilling the SWVXX cash bucket is a Sell &
// Rebalance concern (funded by controlled-sale proceeds) — a Roth conversion
// moves money between tax-advantaged accounts and never touches the taxable
// cash bucket, so bucket status has no bearing on this verdict.

export type ConversionVerdictStatus = 'GO' | 'WAIT' | 'STOP' | 'COMPLETE'

export interface ConversionVerdict {
  status: ConversionVerdictStatus
  window: 'OPEN' | 'WAIT' | 'CLOSED'
  /** One-line verdict, identical everywhere: "STOP — $42,339 above tax-optimal · bracket-fill option: +$33,802" */
  headline: string
  /** Full-sentence explanation for command-center style panels */
  detail: string
  ytdConverted: number
  planTarget: number
  /** bracket room − safety buffer, capped at plan target (same math as Drawdown's tax-optimal) */
  taxOptimal: number
  /** ceiling − gross_no_ss (gross already includes YTD conversions) */
  bracketRoom: number
  excessOverOptimal: number
  /** plan target remaining that still fits inside the bracket — the "option", not a recommendation */
  bracketFillRemaining: number
}

export function computeConversionVerdict(
  tx: DashboardData['tax_data'] | null | undefined,
): ConversionVerdict | null {
  if (!tx) return null
  const ytdConverted = tx.converted_ytd ?? 0
  const planTarget = tx.annual_conversion ?? 0
  const ceiling = tx.target_bracket_ceiling ?? 0
  // Use gross_actual (divs + ytd_converted_total + STCG, no plan-target inflation) so the
  // verdict reflects what has actually been executed. gross_no_ss uses max(ytd, annual_plan)
  // which can treat an unexecuted $400k plan as already done, producing bracketRoom=0 and a
  // STOP verdict when the user has only converted $116k and still has $200k+ of real room.
  const grossActual = tx.gross_actual ?? tx.gross_no_ss ?? tx.annual_div_for_agi ?? 0
  const safetyBuf = tx.safety_buffer ?? DEFAULT_SAFETY_BUFFER
  if (ceiling <= 0) return null

  const bracketRoom = Math.max(0, ceiling - grossActual)
  const taxOptimal = planTarget > 0
    ? Math.min(planTarget, Math.max(0, bracketRoom - safetyBuf))
    : Math.max(0, bracketRoom - safetyBuf)
  const incConf = tx.income_confidence ?? 'LOW'
  const window: ConversionVerdict['window'] =
    bracketRoom <= 0 ? 'CLOSED' : incConf !== 'HIGH' ? 'WAIT' : 'OPEN'

  const isComplete = planTarget > 0 && ytdConverted >= planTarget
  const exceeded = taxOptimal >= 0 && ytdConverted > 0 && ytdConverted >= taxOptimal
  const excessOverOptimal = Math.max(0, ytdConverted - taxOptimal)
  const bracketFillRemaining = Math.max(0, Math.min(planTarget - ytdConverted, bracketRoom))

  let status: ConversionVerdictStatus
  let headline: string
  let detail: string

  if (isComplete) {
    status = 'COMPLETE'
    headline = `COMPLETE — plan target ${fmtMoneyFull(planTarget)} met`
    detail = `Annual plan target met — ${fmtMoneyFull(ytdConverted)} converted. No further conversions needed this year.`
  } else if (bracketRoom <= 0) {
    status = 'STOP'
    headline = 'STOP — no bracket room remaining'
    detail = 'No bracket room remaining — any further conversion would push income into the next bracket.'
  } else if (exceeded) {
    status = 'STOP'
    headline = `STOP — ${fmtMoneyFull(excessOverOptimal)} above tax-optimal`
      + (bracketFillRemaining > 0 ? ` · bracket-fill option: +${fmtMoneyFull(bracketFillRemaining)}` : '')
    detail = `Converted ${fmtMoneyFull(ytdConverted)} YTD vs tax-optimal ${fmtMoneyFull(taxOptimal)} (bracket room − buffer). `
      + `Tax-optimal discipline: stop to avoid bracket creep.`
      + (bracketFillRemaining > 0
        ? ` Bracket-fill discipline: converting +${fmtMoneyFull(bracketFillRemaining)} more would reach the ${fmtMoneyFull(planTarget)} plan target while staying inside the bracket — an option, not a recommendation.`
        : '')
  } else if (window === 'OPEN') {
    status = 'GO'
    headline = `GO — up to ${fmtMoneyFull(Math.max(0, taxOptimal - ytdConverted))} within tax-optimal`
    detail = `Window open — income confidence HIGH. Convert up to ${fmtMoneyFull(Math.max(0, taxOptimal - ytdConverted))} more and stay within tax-optimal (${fmtMoneyFull(taxOptimal)}).`
  } else {
    status = 'WAIT'
    headline = `WAIT — income confidence ${incConf}`
    detail = `Income confidence is ${incConf} — wait for more income data before committing to a conversion amount. Tax-optimal room: ${fmtMoneyFull(Math.max(0, taxOptimal - ytdConverted))}.`
  }

  return {
    status, window, headline, detail,
    ytdConverted, planTarget, taxOptimal, bracketRoom,
    excessOverOptimal, bracketFillRemaining,
  }
}

/** Status → color key used by all renderers (maps onto each tab's palette) */
export function verdictTone(status: ConversionVerdictStatus): 'good' | 'warn' | 'bad' {
  return status === 'GO' || status === 'COMPLETE' ? 'good' : status === 'WAIT' ? 'warn' : 'bad'
}
