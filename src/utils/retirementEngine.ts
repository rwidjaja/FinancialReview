/**
 * Retirement Action Engine — deterministic, pure function.
 * No React, no side effects, no hardcoded numbers.
 * All thresholds come from tx.*, pi.*, wsConfig.*, or derived math.
 *
 * Call: computeRetirementDecision(data: DashboardData) → RetirementDecision
 */

import type { DashboardData } from '../types/dashboard'
import { VOL_BUDGET_ALERT, VOL_BUDGET_WARN, VOL_BUDGET_WATCH } from './constants'

// ─── Output types ─────────────────────────────────────────────────────────────

export type PrimaryAction =
  | 'EXECUTE_CONVERSION'
  | 'DEFER_CONVERSION'
  | 'CONTROLLED_SALE'
  | 'HOLD_INCOME_ONLY'
  | 'REDUCE_RISK'
  | 'REFILL_BUCKET'
  | 'MONITOR_ONLY'

export type DriverSeverity = 'ok' | 'watch' | 'warn' | 'alert'

export interface CrossTabDriver {
  tab: 'tax' | 'risk' | 'cashflow' | 'portfolio'
  label: string
  value: string
  severity: DriverSeverity
  field: string   // source field name for debugging
}

export interface OverrideFlag {
  id: string
  active: boolean
  label: string
  reason: string
  suppresses: PrimaryAction[]
}

export interface IfThenTrigger {
  id: string
  condition: string
  consequence: string
  triggered: boolean
  severity: 'watch' | 'warn' | 'alert'
}

export type ConfidenceDriver =
  | 'income_confidence_high' | 'income_confidence_medium' | 'income_confidence_low'
  | 'fragility_low' | 'fragility_elevated' | 'fragility_high'
  | 'bracket_room_ample' | 'bracket_room_tight' | 'bracket_room_exceeded'
  | 'withdrawal_state_a' | 'withdrawal_state_b' | 'withdrawal_state_c'
  | 'niit_applies' | 'niit_clear'
  | 'stcg_elevated' | 'stcg_high'
  | 'regime_risk_off'
  | 'vol_budget_high'
  | 'bucket_short' | 'bucket_ok'
  | 'income_durability_low' | 'income_durability_ok'

// ── Sub-score types (replaces raw confidence number) ─────────────────────────

export interface RetirementSubScores {
  income_reliability: number   // 0-100  — how dependably income covers spending
  tax_flexibility: number      // 0-100  — bracket headroom + NIIT/STCG status
  execution_risk: number       // 0-100  — 100 = low risk; lower = riskier
  retirement_readiness: number // 0-100  — weighted composite
}

// ── Tax-locked concentration ──────────────────────────────────────────────────

export interface TaxLockedConcentration {
  symbol: string
  current_pct: number
  target_pct: number | null
  excess_pct: number | null
  stcg_gain: number
  ltcg_gain: number
  tax_cost_today: number       // tax if sold today (STCG rate on STCG + LTCG rate on LTCG)
  tax_cost_after_ltcg: number  // tax once all lots mature (LTCG rate on everything)
  tax_savings_waiting: number  // difference — value of patience
  days_to_first_ltcg: number | null
  next_ltcg_date: string | null
  value_per_day: number | null // tax_savings_waiting / days_to_first_ltcg
}

// ── LTCG glidepath ────────────────────────────────────────────────────────────

export interface LtcgGlidepathMonth {
  month: string     // "Sep 2026"
  gain: number      // total unrealized gain unlocking this month
  event_count: number
}

export interface LtcgGlidepath {
  total_stcg_exposure: number
  events_count: number
  by_month: LtcgGlidepathMonth[]
}

// ── Retirement scorecard ──────────────────────────────────────────────────────

export interface ScorecardItem {
  label: string
  status: 'ok' | 'warn' | 'alert'
  note: string
}

export interface RetirementScorecard {
  overall: 'ok' | 'warn' | 'alert'
  items: ScorecardItem[]
}

// ── Forced-sale risk ──────────────────────────────────────────────────────────

export interface ForcedSaleRisk {
  cash_need_12m: number
  required_portfolio_sale: number
  risk_level: 'VERY LOW' | 'LOW' | 'MODERATE' | 'HIGH'
  note: string
}

// ── Refinement types ──────────────────────────────────────────────────────────

export interface ThirtyDayOutlook {
  expected_monthly_dividends: number
  expected_agi_delta: number        // +monthly divs added to AGI projection
  expected_bucket_change: number    // State C: +monthly divs → bucket; A: 0
  conversion_window_status: 'OPEN' | 'WAIT' | 'CLOSED' | 'COMPLETE'
  days_to_next_window: number | null
  conversion_window_note: string
}

export interface WhyNotConvert {
  reasons: string[]   // ordered by impact, most important first
}

export interface NextConversionWindow {
  estimated_month: string | null   // e.g. "November" or "December 1"
  projected_room: number | null
  projected_safe_room: number | null
  blocked_by: string[]
}

export interface RiskOverrideSummary {
  active_count: number
  lines: string[]   // one line per active override
}

export interface StateCCompliance {
  compliant: boolean
  score: number   // 0–100 (each check is equal weight)
  checks: { label: string; pass: boolean; note: string }[]
}

export interface RetirementDecision {
  primary_action: PrimaryAction
  action_label: string
  action_detail: string
  action_amount: number | null
  confidence: number            // 0–100
  confidence_drivers: ConfidenceDriver[]
  cross_tab_drivers: CrossTabDriver[]
  override_flags: OverrideFlag[]
  if_then_triggers: IfThenTrigger[]
  withdrawal_state: 'A' | 'B' | 'C'
  // Sub-scores (human-readable confidence components)
  sub_scores: RetirementSubScores
  // Refinements
  thirty_day_outlook: ThirtyDayOutlook
  why_not_convert: WhyNotConvert | null
  next_conversion_window: NextConversionWindow
  risk_override_summary: RiskOverrideSummary
  state_c_compliance: StateCCompliance | null
  // New additions
  tax_locked_concentration: TaxLockedConcentration | null
  ltcg_glidepath: LtcgGlidepath | null
  retirement_scorecard: RetirementScorecard
  forced_sale_risk: ForcedSaleRisk
  // Derived inputs surfaced for the UI
  _derived: {
    swvxxValue: number
    requiredBucket: number
    bucketMonths: number
    bucketShort: boolean
    bracketRoom: number | null
    annualSpending: number
    convRecommended: number | null
  }
}

// ─── Engine thresholds (named constants — change here, applies everywhere) ────
// UI/scoring thresholds that have no server-supplied equivalent.
// These are the ONLY numbers permitted to appear outside a tx.*/pi.* field.

/** Fragility score bands */
export const FRAGILITY_HIGH      = 70   // ≥ this → critical / block deployment
export const FRAGILITY_ELEVATED  = 50   // ≥ this → warn
const FRAGILITY_LOW       = 40   // < this → healthy


/** Bracket pressure % that triggers "critical" defer */
const BRACKET_CRITICAL_PCT = 90

/** Income coverage % (fwd12m / annualSpending × 100) */
export const COVERAGE_OK_PCT     = 100
export const COVERAGE_WARN_PCT   = 75

/** Bucket fill: warn when below this fraction of target */
const BUCKET_MIN_COVERAGE_RATIO = 0.6

/** Roth conversion progress % bands */
const ROTH_PROGRESS_OK    = 80
const ROTH_PROGRESS_WARN  = 40

/** Income durability score bands */
const DURABILITY_OK       = 70
const DURABILITY_LOW      = 50

/** Days before Dec 1 that triggers year-end urgency */
const DEC1_WARNING_DAYS   = 30

/** Forced-sale risk: HIGH if required sale > this fraction of annual spending */
const FORCED_SALE_HIGH_RATIO = 0.5
/** Forced-sale risk: LOW if SWVXX covers at least this many months */
const FORCED_SALE_LOW_RUNWAY_MONTHS = 3

/** Number of future months shown in LTCG glidepath bar chart */
const GLIDEPATH_MONTHS_SHOWN = 18

/** Sub-score weighting coefficients (must sum to 1.0 per composite) */
const W_INCOME_RELIABILITY = { durability: 0.6, coverage: 0.4 }
const W_EXEC_RISK          = { base: 0.5, regime: 0.2, vol: 0.3 }
const W_READINESS          = { income: 0.4, execution: 0.3, tax: 0.3 }

/** Sub-score regime adjustment points */
const REGIME_EXPANSION_BONUS = 10
const REGIME_RISK_OFF_PENALTY = 20

/** Vol budget penalty per % over 100 (for executionRisk computation) */
const VOL_PENALTY_MAX     = 30
const VOL_PENALTY_RATE    = 5   // lose 1 point per VOL_PENALTY_RATE% over budget

/** LTCG rate fallback when tx.ltcg_rate is not populated */
const LTCG_DEFAULT_RATE   = 0.15  // 15% — US long-term capital gains rate for most brackets

/** Sub-score display color thresholds */
export const SCORE_GREEN  = 70
export const SCORE_AMBER  = 45

/** Compliance scorecard color thresholds */
export const COMPLIANCE_GREEN = 80
export const COMPLIANCE_AMBER = 60


// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtPct(n: number): string { return `${n.toFixed(1)}%` }


// ─── Main engine ──────────────────────────────────────────────────────────────

// ── Bucket math (mirrors IncomeHero) ────────────────────────────────────────
// Bucket = SWVXX/money-market + uninvested CASH, taxable account only.
// Rollover IRA and Roth IRA cash/MMF are excluded — not the spending bucket.
// Extracted as a standalone helper (rather than inlined in computeRetirementDecision)
// so other callers — e.g. computeConversionVerdict — can get bucket status cheaply,
// without running the full retirement-decision engine just to read one field.
export function computeBucketStatus(data: DashboardData): {
  swvxxValue: number
  annualSpending: number
  monthlySpending: number
  bucketYearsRequired: number
  requiredBucket: number
  bucketMonths: number
  bucketShort: boolean
} {
  const tx = data.tax_data
  const si = data.spending_intelligence
  const wsState = (tx.withdrawal_current_state ?? 'A') as 'A' | 'B' | 'C'
  const wsRules = tx.withdrawal_states?.[wsState]?.rules

  const swvxxValue = (data.accounts ?? [])
    .filter(acct => {
      const k = (acct.key   ?? '').toLowerCase()
      const l = (acct.label ?? '').toLowerCase()
      return (k.includes('taxable') || k.includes('brokerage') || k.includes('individual') ||
              l.includes('taxable') || l.includes('brokerage')) &&
             !k.includes('rollover') && !k.includes('roth') && !k.includes('ira')
    })
    .reduce((sum, acct) =>
      sum + (acct.positions ?? [])
        .filter(p => p.is_money_market || p.fund_type === 'MONEY_MARKET' || p.symbol === 'CASH')
        .reduce((s, p) => s + p.value, 0)
    , 0)
  const annualSpending = si?.true_annual_spending ?? tx.spending_true_annual ?? 0
  const monthlySpending = annualSpending > 0 ? annualSpending / 12 : 0
  const bucketYearsRequired = wsRules?.required_bucket_years ?? (wsState === 'A' ? 0 : 1)
  const requiredBucket = bucketYearsRequired * annualSpending
  const bucketMonths = swvxxValue > 0 && monthlySpending > 0 ? swvxxValue / monthlySpending : 0
  const bucketShort = requiredBucket > 0 && swvxxValue < requiredBucket
  return { swvxxValue, annualSpending, monthlySpending, bucketYearsRequired, requiredBucket, bucketMonths, bucketShort }
}

export function computeRetirementDecision(data: DashboardData): RetirementDecision {
  const tx  = data.tax_data
  const pi  = data.portfolio_intel
  const ia  = data.income_analytics

  // ── Withdrawal state ───────────────────────────────────────────────────────
  const wsState = (tx.withdrawal_current_state ?? 'A') as 'A' | 'B' | 'C'
  const wsRules = tx.withdrawal_states?.[wsState]?.rules

  const { swvxxValue, annualSpending, monthlySpending, bucketYearsRequired, requiredBucket, bucketMonths, bucketShort } = computeBucketStatus(data)

  // ── Bracket room (same as BracketMeter / OverviewTab) ─────────────────────
  // Use gross_actual (divs + ytd-only conversions + STCG) — not gross_no_ss which
  // inflates by the unexecuted plan target and produces $0 room / CLOSED window.
  const bracketRoom: number | null = (() => {
    const ceil = tx.target_bracket_ceiling
    const agi  = tx.gross_actual ?? tx.gross_no_ss
    if (ceil != null && agi != null) return Math.max(0, ceil - agi)
    return tx.conv_room_real ?? null
  })()

  const safetyBuf = tx.safety_buffer ?? 0

  // ── Conversion math ────────────────────────────────────────────────────────
  const annualTarget = tx.annual_conversion ?? 0
  const ytdConverted = tx.converted_ytd ?? 0
  const convRecommended = bracketRoom != null
    ? Math.min(annualTarget > 0 ? annualTarget : Infinity, Math.max(0, bracketRoom - safetyBuf))
    : null
  const convRemaining = convRecommended != null ? Math.max(0, convRecommended - ytdConverted) : null
  const incConf = tx.income_confidence ?? 'LOW'
  const convWindowOpen = bracketRoom != null && bracketRoom > safetyBuf && incConf === 'HIGH'

  // ── Risk metrics ───────────────────────────────────────────────────────────
  // `portfolio_intel` is typed as required, but accessed defensively here in
  // case of a partial/stale fetch. Defaulting to the SAFEST possible reading
  // (fragility 0, vol budget 0, durability 100) would silently disable Rule 1's
  // REDUCE_RISK check and the fragility_block override — the single most
  // important risk gate — exactly when the underlying data is least trustworthy.
  // Default to neutral/watch-level values instead: real uncertainty, not "all clear".
  const fragility   = pi?.fragility_score ?? FRAGILITY_ELEVATED
  const volBudget   = pi?.vol_budget_used ?? VOL_BUDGET_WATCH
  const regime      = pi?.market_regime ?? 'CONSOLIDATION'
  const durability  = pi?.income_durability_score ?? DURABILITY_LOW

  // ── STCG status ────────────────────────────────────────────────────────────
  const stcgRealized = tx.ytd_stcg_realized ?? 0
  const stcgStatus   = tx.stcg_ratio_status
  const stcgHigh     = stcgStatus === 'ALERT' || stcgStatus === 'FREEZE'
  const stcgWatch    = stcgStatus === 'WATCH'

  // ── LTCG availability — is there any mature lot to sell right now, or is
  // the taxable account still entirely STCG? Drives whether "harvest LTCG
  // first" is an instruction the user can actually follow today.
  const ltcgAvailable = Object.values(tx.cost_basis_lots ?? {})
    .some(sym => (sym?.ltcg_shares ?? 0) > 0)

  // ── Income coverage ────────────────────────────────────────────────────────
  const fwd12m      = ia?.portfolio_fwd_12m ?? 0
  const coveragePct = annualSpending > 0 ? (fwd12m / annualSpending) * 100 : 100

  // ── IRMAA (only relevant when Medicare is elected) ─────────────────────────
  // Effective conversion room = min(bracketRoom, irmaaHeadroom) to avoid tier bump.
  const onMedicare      = tx.collect_medicare === true
  const irmaaHeadroom   = onMedicare ? (tx.irmaa_headroom ?? null) : null
  const irmaaAnnual     = onMedicare ? (tx.irmaa_annual ?? 0) : 0
  const irmaaTierIdx    = onMedicare ? (tx.irmaa_tier_idx ?? 0) : 0
  const irmaaNextThresh = onMedicare ? (tx.irmaa_next_threshold ?? null) : null
  // Converting past irmaaHeadroom would bump to next IRMAA tier
  const irmaaLimits     = onMedicare && irmaaHeadroom != null && irmaaHeadroom < (bracketRoom ?? Infinity)
  // Effective room: if Medicare active, cap at IRMAA headroom
  const effectiveRoom   = irmaaLimits && irmaaHeadroom != null
    ? Math.min(bracketRoom ?? 0, irmaaHeadroom)
    : bracketRoom
  // Block conversion if IRMAA headroom is below safety buffer
  const irmaaBlocking   = onMedicare && irmaaHeadroom != null && irmaaHeadroom < safetyBuf

  // ─────────────────────────────────────────────────────────────────────────
  // OVERRIDE FLAGS
  // ─────────────────────────────────────────────────────────────────────────

  // Names of the conversion-suppressing overrides that are actually firing —
  // used in the Conversion Paused reason instead of asserting a fixed list.
  // Bucket refill is deliberately NOT included here — it's a Sell & Rebalance
  // concern (funded by controlled-sale proceeds), not a reason a Roth
  // conversion (a transfer between tax-advantaged accounts) is blocked.
  const convBlockerNames = [
    stcgHigh && 'STCG',
    tx.niit_applies === true && bracketRoom != null && bracketRoom < safetyBuf && 'NIIT',
    irmaaBlocking && 'IRMAA',
    fragility >= FRAGILITY_HIGH && 'fragility',
  ].filter(Boolean) as string[]

  const overrides: OverrideFlag[] = [
    {
      id: 'stcg_freeze',
      active: stcgHigh,
      label: 'STCG Elevated',
      reason: `YTD STCG ${fmtK(stcgRealized)} — rebalancing and conversion constrained`,
      suppresses: ['EXECUTE_CONVERSION', 'CONTROLLED_SALE'],
    },
    {
      id: 'niit_cap',
      active: tx.niit_applies === true && bracketRoom != null && bracketRoom < safetyBuf,
      label: 'NIIT Active',
      reason: `NIIT applies — bracket headroom ${bracketRoom != null ? fmtK(bracketRoom) : '—'} below safety buffer ${fmtK(safetyBuf)}`,
      suppresses: ['EXECUTE_CONVERSION'],
    },
    {
      id: 'irmaa_tier_bump',
      active: irmaaBlocking,
      label: 'IRMAA Limit',
      reason: onMedicare && irmaaHeadroom != null
        ? `Medicare elected — converting more than ${fmtK(irmaaHeadroom)} would trigger IRMAA tier bump${irmaaNextThresh != null ? ` (next threshold: ${fmtK(irmaaNextThresh)})` : ''}`
        : 'Medicare not elected — IRMAA not applicable',
      suppresses: ['EXECUTE_CONVERSION'],
    },
    {
      id: 'regime_hold',
      active: regime === 'RISK-OFF',
      label: 'Risk-Off Regime',
      reason: 'Market regime RISK-OFF — controlled sales suppressed',
      suppresses: ['CONTROLLED_SALE'],
    },
    {
      id: 'fragility_block',
      active: fragility >= FRAGILITY_HIGH,
      label: 'High Fragility',
      reason: `Fragility ${fragility}/100 — new deployment blocked`,
      suppresses: ['EXECUTE_CONVERSION', 'CONTROLLED_SALE'],
    },
    {
      id: 'conversion_done',
      active: tx.conversion_done_likely === true,
      // Use "Paused" label when progress hasn't actually reached 100% — "Complete" at 80%
      // contradicts the progress percentage shown in the 30-Day Outlook and Why Not Convert.
      label: (tx.conversion_progress_pct ?? 0) >= 100 ? 'Conversion Complete' : 'Conversion Paused',
      reason: (tx.conversion_progress_pct ?? 0) >= 100
        ? `Annual conversion target met (${fmtPct(tx.conversion_progress_pct ?? 0)} done)`
        : `Conversion ${fmtPct(tx.conversion_progress_pct ?? 0)} done${convBlockerNames.length > 0 ? ` — blocked by active overrides (${convBlockerNames.join(' + ')})` : ' — paused pending year-end income confirmation'}`,
      suppresses: ['EXECUTE_CONVERSION'],
    },
    {
      id: 'bucket_deficit',
      active: bucketShort && wsState !== 'A',
      label: 'Bucket Deficit',
      reason: `SWVXX ${fmtK(swvxxValue)} below ${bucketYearsRequired}yr target ${fmtK(requiredBucket)}`,
      // Informational only (surfaces in the Overview risk summary) — does NOT
      // suppress EXECUTE_CONVERSION. Refilling the bucket is a Sell & Rebalance
      // concern (controlled-sale proceeds); a Roth conversion moves money
      // between tax-advantaged accounts and never touches the taxable bucket.
      suppresses: [],
    },
  ]

  const activeOverrides = new Set(
    overrides.filter(o => o.active).flatMap(o => o.suppresses)
  )

  // ─────────────────────────────────────────────────────────────────────────
  // DECISION TREE  (first match wins)
  // ─────────────────────────────────────────────────────────────────────────

  let primary_action: PrimaryAction = 'MONITOR_ONLY'
  let action_label   = 'No Action Required'
  let action_detail  = 'All systems within normal parameters. Continue current strategy.'
  let action_amount: number | null = null

  // Rule 1 — REDUCE_RISK (critical fragility)
  if (fragility >= FRAGILITY_HIGH && (volBudget > VOL_BUDGET_WATCH || regime === 'RISK-OFF')) {
    primary_action = 'REDUCE_RISK'
    action_label   = 'Reduce Portfolio Risk'
    action_detail  = `Fragility ${fragility}/100 with ${volBudget.toFixed(0)}% vol budget — risk exposure exceeds target before any new actions.`
  }
  // Rule 2 — REFILL_BUCKET (liquidity priority)
  else if (bucketShort && wsState === 'C' && (wsRules?.allow_controlled_sale || wsRules?.allow_trimming_income_etfs)) {
    const shortfall = requiredBucket - swvxxValue
    primary_action = 'REFILL_BUCKET'
    action_label   = 'Refill Cash Bucket'
    action_detail  = `SWVXX ${bucketMonths.toFixed(1)} months — below ${bucketYearsRequired}-year target. Sell to close ${fmtK(shortfall)} gap.`
    action_amount  = shortfall
  }
  // Rule 3 — DEFER_CONVERSION (STCG freeze)
  else if (stcgHigh && !activeOverrides.has('DEFER_CONVERSION')) {
    primary_action = 'DEFER_CONVERSION'
    action_label   = 'Defer Conversion — STCG Elevated'
    action_detail  = `Realized STCG ${fmtK(stcgRealized)} constrains additional AGI. Hold until STCG ratio normalizes.`
  }
  // Rule 4 — CONTROLLED_SALE (State C, bucket healthy)
  else if (wsState === 'C' && wsRules?.allow_controlled_sale && !activeOverrides.has('CONTROLLED_SALE')) {
    const saleMin = wsRules.controlled_sale_target_min ?? 0
    const saleMax = wsRules.controlled_sale_target_max ?? saleMin
    primary_action = 'CONTROLLED_SALE'
    action_label   = 'Execute Controlled Sale'
    action_detail  = ltcgAvailable
      ? `State C: spending funded by sales. Target ${fmtK(saleMin)}–${fmtK(saleMax)}/yr from taxable — harvest LTCG first.`
      : `State C: spending funded by sales. Target ${fmtK(saleMin)}–${fmtK(saleMax)}/yr from taxable — no mature LTCG lots yet; sales will realize STCG at ordinary rates until lots mature.`
    action_amount  = saleMin
  }
  // Rule 5 — EXECUTE_CONVERSION (window open, room available, IRMAA not blocking)
  else if (
    convWindowOpen &&
    convRemaining != null &&
    convRemaining > 0 &&
    !irmaaBlocking &&
    !activeOverrides.has('EXECUTE_CONVERSION')
  ) {
    const safeConv = effectiveRoom != null ? Math.min(convRemaining, Math.max(0, effectiveRoom - safetyBuf)) : convRemaining
    const irmaaNote = irmaaLimits && irmaaHeadroom != null ? ` · IRMAA cap ${fmtK(irmaaHeadroom)}` : ''
    primary_action = 'EXECUTE_CONVERSION'
    action_label   = 'Execute Roth Conversion'
    action_detail  = `Conversion window OPEN. Safe room ${effectiveRoom != null ? fmtK(effectiveRoom - safetyBuf) : '—'} remaining${irmaaNote} — convert ${fmtK(safeConv)} before year-end.`
    action_amount  = safeConv
  }
  // Rule 6 — State B hybrid
  else if (wsState === 'B' && wsRules?.allow_controlled_sale) {
    const saleMin = wsRules.controlled_sale_target_min ?? 0
    primary_action = 'CONTROLLED_SALE'
    action_label   = 'Hybrid: Dividends + Controlled Sales'
    action_detail  = `State B: supplement dividends with controlled sales toward ${fmtK(saleMin)}/yr target. Build SWVXX buffer.`
    action_amount  = saleMin
  }
  // Rule 7 — DEFER low confidence
  // Note: income_received_pct is DIVIDEND PACING only (% of annual dividends received YTD).
  // Actual income received (W2 + all sources) is in income_history.ytd_total — shown in IncomeHero
  // as a separate context row. Low pacing confidence ≠ low actual income coverage.
  else if (incConf === 'LOW' || !convWindowOpen) {
    primary_action = 'DEFER_CONVERSION'
    action_label   = 'Wait — Dividend Pacing Below Trigger'
    action_detail  = `Dividend pacing ${fmtPct(tx.income_received_pct ?? 0)} of ${fmtPct(tx.trigger_pct_threshold ?? 0)} threshold (YTD dividends ÷ annual dividend target). Window WAIT. Note: this is pacing-based — check IncomeHero for actual total received vs spending.`
  }
  // Rule 8 — State A default
  else if (wsState === 'A') {
    primary_action = 'HOLD_INCOME_ONLY'
    action_label   = 'Hold — Dividends Cover Spending'
    action_detail  = `State A: fwd 12m dividends cover ${fmtPct(coveragePct)} of total annual spending (${fmtK(annualSpending)}). No withdrawal needed. Reinvest dividends.`
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIDENCE SCORING
  // ─────────────────────────────────────────────────────────────────────────

  const confDrivers: ConfidenceDriver[] = []
  let conf = 50

  const add = (pts: number, tag: ConfidenceDriver) => { conf += pts; confDrivers.push(tag) }

  if (incConf === 'HIGH')        add(+20, 'income_confidence_high')
  else if (incConf === 'MEDIUM') add(+10, 'income_confidence_medium')
  else                           add(-20, 'income_confidence_low')

  if (durability >= DURABILITY_OK)   add(+10, 'income_durability_ok')
  else if (durability < DURABILITY_LOW) add(-10, 'income_durability_low')

  if (fragility < FRAGILITY_LOW)        add(+10, 'fragility_low')
  else if (fragility >= FRAGILITY_HIGH) add(-20, 'fragility_high')
  else if (fragility >= FRAGILITY_ELEVATED) add(-10, 'fragility_elevated')

  if (bracketRoom != null) {
    if (bracketRoom > safetyBuf * 2)  add(+10, 'bracket_room_ample')
    else if (bracketRoom < 0)         add(-15, 'bracket_room_exceeded')
    else if (bracketRoom < safetyBuf) add(-10, 'bracket_room_tight')
  }

  if (wsState === 'A')      add(+5,  'withdrawal_state_a')
  else if (wsState === 'C') add(-5,  'withdrawal_state_c')
  else                      add(0,   'withdrawal_state_b')

  if (!tx.niit_applies)     add(+5,  'niit_clear')
  else                      add(-10, 'niit_applies')

  if (!bucketShort)         add(+5,  'bucket_ok')
  else                      add(-10, 'bucket_short')

  if (regime === 'RISK-OFF')                     add(-10, 'regime_risk_off')
  if (volBudget > VOL_BUDGET_WARN)               add(-10, 'vol_budget_high')
  if (stcgHigh)                      add(-10, 'stcg_high')
  else if (stcgWatch)                add(-5,  'stcg_elevated')

  const confidence = Math.min(100, Math.max(0, conf))

  // ─────────────────────────────────────────────────────────────────────────
  // CROSS-TAB DRIVERS
  // ─────────────────────────────────────────────────────────────────────────

  const drivers: CrossTabDriver[] = []

  // Tax
  if (bracketRoom != null) {
    const bktPct = tx.bracket_pressure_pct ?? 0
    drivers.push({ tab: 'tax', label: 'Bracket pressure', value: fmtPct(bktPct), severity: bktPct > BRACKET_CRITICAL_PCT ? 'alert' : bktPct > FRAGILITY_ELEVATED ? 'warn' : bktPct > 50 ? 'watch' : 'ok', field: 'bracket_pressure_pct' })
    drivers.push({ tab: 'tax', label: 'Bracket room', value: fmtK(bracketRoom), severity: bracketRoom < 0 ? 'alert' : bracketRoom < safetyBuf ? 'warn' : bracketRoom < safetyBuf * 3 ? 'watch' : 'ok', field: 'target_bracket_ceiling' })
  }
  drivers.push({ tab: 'tax', label: 'NIIT', value: tx.niit_applies ? 'Applies' : 'Clear', severity: tx.niit_applies ? 'warn' : 'ok', field: 'niit_applies' })
  if (onMedicare) {
    const irmaaSev: DriverSeverity = irmaaBlocking ? 'alert' : irmaaLimits ? 'warn' : irmaaTierIdx > 0 ? 'watch' : 'ok'
    drivers.push({
      tab: 'tax',
      label: irmaaTierIdx > 0 ? `IRMAA ${tx.irmaa_tier_label ?? `Tier ${irmaaTierIdx}`}` : 'IRMAA Base',
      value: irmaaAnnual > 0 ? `${fmtK(irmaaAnnual)}/yr` : 'Base tier',
      severity: irmaaSev,
      field: 'irmaa_tier_idx',
    })
    if (irmaaHeadroom != null) {
      drivers.push({
        tab: 'tax',
        label: 'IRMAA headroom',
        value: fmtK(irmaaHeadroom),
        severity: irmaaBlocking ? 'alert' : irmaaLimits ? 'warn' : 'ok',
        field: 'irmaa_headroom',
      })
    }
  }
  if (stcgRealized > 0) {
    drivers.push({ tab: 'tax', label: 'STCG realized', value: fmtK(stcgRealized), severity: stcgHigh ? 'alert' : stcgWatch ? 'warn' : 'ok', field: 'ytd_stcg_realized' })
  }

  // Risk
  drivers.push({ tab: 'risk', label: 'Fragility', value: `${fragility}/100`, severity: fragility >= FRAGILITY_HIGH ? 'alert' : fragility >= FRAGILITY_ELEVATED ? 'warn' : fragility >= 35 ? 'watch' : 'ok', field: 'fragility_score' })
  drivers.push({ tab: 'risk', label: 'Vol budget', value: fmtPct(volBudget), severity: volBudget > VOL_BUDGET_ALERT ? 'alert' : volBudget > VOL_BUDGET_WARN ? 'warn' : volBudget > VOL_BUDGET_WATCH ? 'watch' : 'ok', field: 'vol_budget_used' })

  // Cash flow
  const bucketWarnMonths = bucketYearsRequired * 12 * BUCKET_MIN_COVERAGE_RATIO
  // Bucket = SWVXX vs (bucketYears × total_spending). Total_spending = true_annual_spending.
  drivers.push({ tab: 'cashflow', label: 'Bucket (SWVXX)', value: `${bucketMonths.toFixed(1)} mo`, severity: bucketMonths < bucketWarnMonths ? 'alert' : bucketMonths < (bucketYearsRequired * 12) ? 'warn' : 'ok', field: 'swvxx_positions' })
  // Income coverage = portfolio_fwd_12m ÷ true_annual_spending (total spending, not lifestyle estimate)
  // Same thresholds/labels as the retirement_scorecard item below for this exact
  // metric (line ~972) — they used to diverge (this driver said 'warn' for the
  // same coveragePct the scorecard called 'alert'), showing two different
  // severities for one number depending which panel you looked at.
  drivers.push({ tab: 'cashflow', label: 'Income ÷ total spend', value: fmtPct(coveragePct), severity: coveragePct >= COVERAGE_OK_PCT ? 'ok' : coveragePct >= COVERAGE_WARN_PCT ? 'warn' : 'alert', field: 'portfolio_fwd_12m' })

  // Portfolio
  drivers.push({ tab: 'portfolio', label: 'Income durability', value: `${durability}/100`, severity: durability < DURABILITY_LOW ? 'warn' : durability < DURABILITY_OK ? 'watch' : 'ok', field: 'income_durability_score' })

  // ─────────────────────────────────────────────────────────────────────────
  // IF-THEN TRIGGERS
  // ─────────────────────────────────────────────────────────────────────────

  const triggers: IfThenTrigger[] = [
    {
      id: 'bracket_pressure_90',
      condition: `Bracket pressure > ${tx.target_bracket_rate ?? 24}% ceiling`,
      consequence: 'Defer all conversion — bracket headroom critical',
      triggered: (tx.bracket_pressure_pct ?? 0) > BRACKET_CRITICAL_PCT,
      severity: 'alert',
    },
    {
      id: 'bucket_refill',
      condition: `SWVXX < ${bucketYearsRequired}-year spending target`,
      consequence: 'Prioritize bucket refill via controlled sale before conversion',
      triggered: bucketShort,
      severity: 'warn',
    },
    {
      id: 'pct_trigger_met',
      condition: `Income received ≥ ${fmtPct(tx.trigger_pct_threshold ?? 0)} threshold`,
      consequence: 'Income confidence elevated — execute conversion now',
      triggered: tx.pct_triggered === true,
      severity: 'watch',
    },
    {
      id: 'dec1_approaching',
      condition: 'Days to Dec 1 ≤ 30 and conversion not complete',
      consequence: 'Accelerate conversion — year-end deadline approaching',
      triggered: tx.days_to_dec1 != null && tx.days_to_dec1 <= DEC1_WARNING_DAYS && tx.conversion_done_likely !== true,
      severity: 'warn',
    },
    {
      id: 'niit_imminent',
      condition: `NIIT threshold headroom < safety buffer ${fmtK(safetyBuf)}`,
      consequence: 'Cap conversions — approaching NIIT threshold',
      triggered: tx.niit_applies !== true && tx.niit_headroom != null && tx.niit_headroom < safetyBuf,
      severity: 'warn',
    },
    {
      id: 'fragility_spike',
      condition: `Fragility score ≥ ${FRAGILITY_HIGH}`,
      consequence: 'Hold — reduce risk exposure before deploying capital',
      triggered: fragility >= FRAGILITY_HIGH,
      severity: 'alert',
    },
    {
      id: 'stcg_watch',
      condition: 'Realized STCG crosses watch/alert threshold',
      consequence: 'STCG realizations reducing conversion capacity — review rebalancing',
      triggered: stcgWatch || stcgHigh,
      severity: stcgHigh ? 'alert' : 'warn',
    },
    {
      id: 'regime_risk_off',
      condition: 'Market regime shifts to RISK-OFF',
      consequence: 'Suspend controlled sales — hold cash, avoid realizing losses',
      triggered: regime === 'RISK-OFF',
      severity: 'alert',
    },
    {
      id: 'irmaa_tier_bump',
      condition: onMedicare
        ? `Medicare elected — IRMAA headroom ${irmaaHeadroom != null ? fmtK(irmaaHeadroom) : '—'} < bracket room`
        : 'Medicare not elected — IRMAA not applicable (enable in Settings → Medicare)',
      consequence: `Cap conversion at IRMAA headroom to avoid tier bump${irmaaNextThresh != null ? ` (next tier at ${fmtK(irmaaNextThresh)})` : ''}`,
      triggered: irmaaLimits,
      severity: irmaaBlocking ? 'alert' : 'warn',
    },
  ]

  // ─────────────────────────────────────────────────────────────────────────
  // REFINEMENT 1 — 30-DAY OUTLOOK
  // ─────────────────────────────────────────────────────────────────────────

  const monthlyDivs = (ia?.portfolio_fwd_12m ?? 0) / 12
  // COMPLETE only when the target is genuinely reached (≥ 100%).
  // If conversion_done_likely is set but progress < 100%, the window is
  // WAIT/CLOSED due to other blockers — not "complete." Labelling it COMPLETE
  // at 80% contradicts the progress percentage shown next to it.
  const windowStatus: ThirtyDayOutlook['conversion_window_status'] =
    tx.conversion_done_likely && (tx.conversion_progress_pct ?? 0) >= 100 ? 'COMPLETE'
    : !convWindowOpen && (bracketRoom ?? 0) <= 0 ? 'CLOSED'
    : !convWindowOpen ? 'WAIT'
    : 'OPEN'

  const daysToWindow = windowStatus === 'WAIT'
    ? (tx.days_to_dec1 ?? null)
    : null

  const thirty_day_outlook: ThirtyDayOutlook = {
    expected_monthly_dividends: monthlyDivs,
    expected_agi_delta: monthlyDivs,
    expected_bucket_change: wsState === 'C' ? monthlyDivs : 0,
    conversion_window_status: windowStatus,
    days_to_next_window: daysToWindow,
    conversion_window_note: windowStatus === 'OPEN'
      ? 'Window is open — income confidence HIGH'
      : windowStatus === 'COMPLETE'
      ? 'Annual conversion target already met'
      : windowStatus === 'CLOSED'
      ? 'Bracket room exhausted'
      : `WAIT — income received ${fmtPct(tx.income_received_pct ?? 0)} of ${fmtPct(tx.trigger_pct_threshold ?? 0)} trigger${daysToWindow != null ? ` · ${daysToWindow}d to Dec 1` : ''}`,
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REFINEMENT 2 — WHY NOT CONVERT?
  // ─────────────────────────────────────────────────────────────────────────

  const why_not_convert: WhyNotConvert | null = primary_action === 'EXECUTE_CONVERSION' ? null : (() => {
    const reasons: string[] = []
    if (tx.conversion_done_likely) {
      if ((tx.conversion_progress_pct ?? 0) >= 100)
        reasons.push(`Conversion complete — ${fmtPct(tx.conversion_progress_pct ?? 0)} of annual target done`)
      else
        reasons.push(`Conversion progress: ${fmtPct(tx.conversion_progress_pct ?? 0)} of annual target${convBlockerNames.length > 0 ? ` — blocked by active overrides (${convBlockerNames.join(' + ')})` : ''}`)
    }
    if (stcgHigh)                  reasons.push(`STCG ${fmtK(stcgRealized)} YTD — fills AGI bracket room, reducing conversion capacity.`)
    if (tx.niit_applies)           reasons.push(`NIIT active — ${fmtPct((tx.niit_rate ?? 0.038) * 100)} surcharge on conversion income above threshold. NIIT is a cost, not a ceiling — does not block spending.`)
    if (irmaaBlocking)             reasons.push(`IRMAA limit — converting past ${irmaaHeadroom != null ? fmtK(irmaaHeadroom) : 'headroom'} would bump Medicare premiums${irmaaAnnual > 0 ? ` (current: ${fmtK(irmaaAnnual)}/yr)` : ''}`)
    if (irmaaLimits && !irmaaBlocking) reasons.push(`IRMAA headroom ${irmaaHeadroom != null ? fmtK(irmaaHeadroom) : '—'} limits conversion below bracket room — use effective room`)
    // Bucket refill is a Sell & Rebalance concern, not a reason a conversion is blocked — see REFILL_BUCKET rule / RebalancePlanPanel instead.
    if (incConf === 'LOW')         reasons.push(`Income confidence LOW — conversion window WAIT until ≥${fmtPct(tx.trigger_pct_threshold ?? 0)} received`)
    if (incConf === 'MEDIUM')      reasons.push(`Income confidence MEDIUM — window opens at HIGH confidence`)
    if (fragility >= FRAGILITY_HIGH) reasons.push(`Fragility ${fragility}/100 — risk reduction required first`)
    if (bracketRoom != null && bracketRoom < safetyBuf)
                                   reasons.push(`Bracket room ${fmtK(bracketRoom)} below safety buffer ${fmtK(safetyBuf)}`)
    if (regime === 'RISK-OFF')     reasons.push(`Market regime RISK-OFF — controlled actions suspended`)
    if (reasons.length === 0)      reasons.push('No immediate conversion opportunity — monitor triggers')
    return { reasons }
  })()

  // ─────────────────────────────────────────────────────────────────────────
  // REFINEMENT 3 — NEXT CONVERSION WINDOW
  // ─────────────────────────────────────────────────────────────────────────

  const convBlockers: string[] = []
  // Income confidence is the actual gate for convWin WAIT/OPEN — push first so
  // it survives any slice-based truncation regardless of how many informational
  // flags (STCG, NIIT) happen to also be true.
  if (incConf === 'LOW')     convBlockers.push(`Income confidence LOW (${fmtPct(tx.income_received_pct ?? 0)} received)`)
  if (incConf === 'MEDIUM')  convBlockers.push(`Income confidence MEDIUM (${fmtPct(tx.income_received_pct ?? 0)} received — need HIGH)`)
  if (stcgHigh)              convBlockers.push(`STCG ${fmtK(stcgRealized)} elevated`)
  if (tx.niit_applies)       convBlockers.push('NIIT applies')
  if (irmaaBlocking)         convBlockers.push(`IRMAA limit (${irmaaHeadroom != null ? fmtK(irmaaHeadroom) : '—'} headroom)`)
  // Bucket refill is a Sell & Rebalance concern, not a conversion-window blocker.
  if (fragility >= FRAGILITY_HIGH) convBlockers.push(`Fragility ${fragility}/100`)

  const next_conversion_window: NextConversionWindow = {
    estimated_month: tx.conversion_done_likely ? null : (tx.conversion_month_name ?? (tx.days_to_dec1 != null ? 'December' : null)),
    // Show effective room (IRMAA-capped if Medicare elected), not raw bracket room
    projected_room: effectiveRoom,
    projected_safe_room: effectiveRoom != null ? Math.max(0, effectiveRoom - safetyBuf) : null,
    blocked_by: convBlockers,
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REFINEMENT 4 — RISK OVERRIDE SUMMARY
  // ─────────────────────────────────────────────────────────────────────────

  const activeOvr = overrides.filter(o => o.active)
  const risk_override_summary: RiskOverrideSummary = {
    active_count: activeOvr.length,
    lines: activeOvr.map(o => `${o.label}: ${o.reason}`),
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REFINEMENT 5 — STATE C COMPLIANCE
  // ─────────────────────────────────────────────────────────────────────────

  const state_c_compliance: StateCCompliance | null = wsState !== 'C' ? null : (() => {
    const checks: StateCCompliance['checks'] = [
      {
        label: 'Bucket at target',
        pass: !bucketShort,
        note: bucketShort
          ? `SWVXX ${bucketMonths.toFixed(1)} mo — needs ${fmtK(requiredBucket - swvxxValue)} refill`
          : `SWVXX ${bucketMonths.toFixed(1)} mo — target met`,
      },
      {
        label: 'Controlled sales executing',
        pass: wsRules?.allow_controlled_sale === true,
        note: wsRules?.allow_controlled_sale
          ? `Allowed: ${fmtK(wsRules.controlled_sale_target_min ?? 0)}–${fmtK(wsRules.controlled_sale_target_max ?? 0)}/yr`
          : 'Controlled sales not allowed by current rules',
      },
      {
        label: 'Conversions deferred until bucket full',
        pass: bucketShort ? primary_action !== 'EXECUTE_CONVERSION' : true,
        note: bucketShort
          ? primary_action !== 'EXECUTE_CONVERSION'
            ? 'Conversion correctly deferred — bucket refill prioritized'
            : 'Conversion should be deferred until bucket is full'
          : 'Bucket full — conversion can proceed',
      },
      {
        label: 'Dividends routed to bucket (not reinvested)',
        pass: wsState === 'C',   // State C rule itself enforces this
        note: 'State C: all dividends allocated to SWVXX refill by rule',
      },
      {
        label: 'Concentration risk acknowledged',
        pass: (tx.concentration_status === 'OK' || tx.concentration_status === 'WATCH'),
        note: tx.concentration_status === 'OK'
          ? 'Concentration within plan targets'
          : tx.concentration_status === 'WATCH'
          ? 'Concentration breach acknowledged — tax cost to fix exceeds risk-reduction benefit; defer major trim until LTCG maturity'
          : 'Concentration requires action — trim aggressively',
      },
    ]
    const passed = checks.filter(c => c.pass).length
    return {
      compliant: passed === checks.length,
      score: Math.round((passed / checks.length) * 100),
      checks,
    }
  })()

  // ─────────────────────────────────────────────────────────────────────────
  // SUB-SCORES (human-readable confidence components)
  // ─────────────────────────────────────────────────────────────────────────

  const incomeReliability = Math.min(100, Math.max(0,
    Math.round(W_INCOME_RELIABILITY.durability * (durability ?? 50) + W_INCOME_RELIABILITY.coverage * Math.min(100, coveragePct))
  ))

  const bracketUsedPct = tx.bracket_pressure_pct ?? 50
  const taxFlexBase = Math.max(0, 100 - bracketUsedPct)
  const taxFlexibility = Math.min(100, Math.max(0, Math.round(
    taxFlexBase
    - (tx.niit_applies ? REGIME_RISK_OFF_PENALTY : 0)
    - (stcgHigh ? REGIME_EXPANSION_BONUS : stcgWatch ? 5 : 0)
  )))

  const execRiskBase = 100 - (fragility ?? 0)
  const execRiskRegime = regime === 'EXPANSION' ? REGIME_EXPANSION_BONUS : regime === 'CONSOLIDATION' ? 0 : -REGIME_RISK_OFF_PENALTY
  const execRiskVol = Math.max(0, VOL_PENALTY_MAX - Math.max(0, (volBudget - VOL_BUDGET_WATCH) / VOL_PENALTY_RATE))
  const executionRisk = Math.min(100, Math.max(0, Math.round(
    W_EXEC_RISK.base * execRiskBase + W_EXEC_RISK.regime * execRiskRegime + W_EXEC_RISK.vol * execRiskVol
  )))

  const retirementReadiness = Math.round(
    W_READINESS.income * incomeReliability + W_READINESS.execution * executionRisk + W_READINESS.tax * taxFlexibility
  )

  const sub_scores: RetirementSubScores = {
    income_reliability: incomeReliability,
    tax_flexibility: taxFlexibility,
    execution_risk: executionRisk,
    retirement_readiness: retirementReadiness,
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAX-LOCKED CONCENTRATION
  // ─────────────────────────────────────────────────────────────────────────

  const tax_locked_concentration: TaxLockedConcentration | null = (() => {
    const lots = tx.cost_basis_lots
    if (!lots) return null

    // Find top holding by weight
    const weights = pi?.weights ?? {}
    const topSym = Object.entries(weights)
      .filter(([sym]) => lots[sym])
      .sort(([, a], [, b]) => b - a)[0]?.[0]
    if (!topSym) return null

    const lot = lots[topSym]
    const currentPct = (weights[topSym] ?? 0)
    // Target from server concentration_rules if available
    const concRules = (tx as unknown as { concentration_rules?: { target_max?: number } }).concentration_rules
    const targetPct = concRules?.target_max ?? null

    const stcgGain = lot.stcg_gain > 0 ? lot.stcg_gain : 0
    const ltcgGain = lot.ltcg_gain > 0 ? lot.ltcg_gain : 0
    const ordinaryRate = (tx.marginal_rate ?? ((tx.target_bracket_rate ?? 24) / 100))
    const ltcgRate     = tx.ltcg_rate ?? LTCG_DEFAULT_RATE

    const taxCostToday      = stcgGain * ordinaryRate + ltcgGain * ltcgRate
    const taxCostAfterLtcg  = (stcgGain + ltcgGain) * ltcgRate
    const taxSavings        = Math.max(0, taxCostToday - taxCostAfterLtcg)
    const daysToLt          = lot.days_to_next_lt ?? null
    const valuePerDay       = daysToLt != null && daysToLt > 0 ? taxSavings / daysToLt : null

    return {
      symbol: topSym,
      current_pct: currentPct,
      target_pct: targetPct,
      excess_pct: targetPct != null ? Math.max(0, currentPct - targetPct) : null,
      stcg_gain: stcgGain,
      ltcg_gain: ltcgGain,
      tax_cost_today: taxCostToday,
      tax_cost_after_ltcg: taxCostAfterLtcg,
      tax_savings_waiting: taxSavings,
      days_to_first_ltcg: daysToLt,
      next_ltcg_date: lot.next_lt_flip_date ?? null,
      value_per_day: valuePerDay,
    }
  })()

  // ─────────────────────────────────────────────────────────────────────────
  // LTCG GLIDEPATH
  // ─────────────────────────────────────────────────────────────────────────

  const ltcg_glidepath: LtcgGlidepath | null = (() => {
    const cal = tx.ltcg_maturity_calendar
    if (!cal || cal.length === 0) return null

    // Group by calendar month (next 18 months)
    const monthMap: Record<string, LtcgGlidepathMonth> = {}
    let totalStcg = 0

    for (const ev of cal) {
      if (ev.days_away < 0) continue
      const d = new Date(ev.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      if (!monthMap[key]) monthMap[key] = { month: label, gain: 0, event_count: 0 }
      monthMap[key].gain += ev.gain
      monthMap[key].event_count += 1
      if (ev.gain > 0) totalStcg += ev.gain
    }

    return {
      total_stcg_exposure: totalStcg,
      events_count: cal.length,
      by_month: Object.values(monthMap).slice(0, GLIDEPATH_MONTHS_SHOWN),
    }
  })()

  // ─────────────────────────────────────────────────────────────────────────
  // RETIREMENT SCORECARD
  // ─────────────────────────────────────────────────────────────────────────

  const scorecardItems: ScorecardItem[] = [
    {
      label: 'Income Coverage',
      status: coveragePct >= COVERAGE_OK_PCT ? 'ok' : coveragePct >= COVERAGE_WARN_PCT ? 'warn' : 'alert',
      note: `${fmtPct(coveragePct)} of tracked spending covered by dividends`,
    },
    {
      label: 'Cash Bucket',
      status: !bucketShort ? 'ok' : bucketMonths >= (bucketYearsRequired * 12 * BUCKET_MIN_COVERAGE_RATIO) ? 'warn' : 'alert',
      note: `${bucketMonths.toFixed(1)} mo of ${bucketYearsRequired * 12} mo target${wsState === 'C' ? ' · State C — refill via controlled sales, not emergency' : ''}`,
    },
    {
      label: 'Tax Flexibility',
      status: bracketRoom != null && bracketRoom > safetyBuf * 2 ? 'ok' : bracketRoom != null && bracketRoom > 0 ? 'warn' : 'alert',
      note: bracketRoom != null ? `${fmtK(bracketRoom)} bracket room remaining` : 'Bracket data unavailable',
    },
    {
      label: 'Concentration Risk',
      status: tx.concentration_status === 'OK' ? 'ok' : tx.concentration_status === 'WATCH' ? 'warn' : 'alert',
      note: tx.concentration_status === 'OK' ? 'Within plan targets'
        : tx.concentration_status === 'WATCH' ? 'Elevated — defer trim until LTCG maturity'
        : 'Action required — trim overweight position',
    },
    {
      label: 'Roth Progress',
      status: (tx.conversion_progress_pct ?? 0) >= ROTH_PROGRESS_OK ? 'ok' : (tx.conversion_progress_pct ?? 0) >= ROTH_PROGRESS_WARN ? 'warn' : 'alert',
      note: `${fmtPct(tx.conversion_progress_pct ?? 0)} of annual conversion target`,
    },
    {
      label: 'Sequence Risk',
      status: wsState === 'A' ? 'ok' : wsState === 'B' ? 'warn' : bucketShort ? 'alert' : 'warn',
      note: wsState === 'A' ? 'State A — dividends cover spending'
        : wsState === 'B' ? 'State B — hybrid; monitor bucket'
        : bucketShort ? 'State C — bucket below target; refill needed'
        : 'State C — bucket sufficient',
    },
  ]

  const alertCount = scorecardItems.filter(i => i.status === 'alert').length
  const warnCount  = scorecardItems.filter(i => i.status === 'warn').length
  const retirement_scorecard: RetirementScorecard = {
    overall: alertCount > 0 ? 'alert' : warnCount > 1 ? 'warn' : 'ok',
    items: scorecardItems,
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FORCED-SALE RISK
  // ─────────────────────────────────────────────────────────────────────────

  const cashNeed12m = Math.max(0, annualSpending - fwd12m)
  const requiredSale = Math.max(0, cashNeed12m - swvxxValue)
  const forcedRiskLevel: ForcedSaleRisk['risk_level'] =
    requiredSale > annualSpending * FORCED_SALE_HIGH_RATIO ? 'HIGH'
    : requiredSale > 0 ? 'MODERATE'
    : swvxxValue < monthlySpending * FORCED_SALE_LOW_RUNWAY_MONTHS ? 'LOW'
    : 'VERY LOW'

  const forced_sale_risk: ForcedSaleRisk = {
    cash_need_12m: cashNeed12m,
    required_portfolio_sale: requiredSale,
    risk_level: forcedRiskLevel,
    note: requiredSale === 0
      ? `Dividends ${fmtK(fwd12m)} + SWVXX ${fmtK(swvxxValue)} cover all spending — no forced sale needed`
      : `Income gap ${fmtK(cashNeed12m)} after dividends; ${fmtK(requiredSale)} must come from portfolio sales`,
  }

  return {
    primary_action,
    action_label,
    action_detail,
    action_amount,
    confidence,
    confidence_drivers: confDrivers,
    cross_tab_drivers: drivers,
    override_flags: overrides,
    if_then_triggers: triggers,
    withdrawal_state: wsState,
    sub_scores,
    thirty_day_outlook,
    why_not_convert,
    next_conversion_window,
    risk_override_summary,
    state_c_compliance,
    tax_locked_concentration,
    ltcg_glidepath,
    retirement_scorecard,
    forced_sale_risk,
    _derived: { swvxxValue, requiredBucket, bucketMonths, bucketShort, bracketRoom, annualSpending, convRecommended },
  }
}
