/**
 * Shared fiscal / tax constants — re-exported from taxConfig.
 *
 * All numeric values come from server/tax_brackets.json and server/rules.json
 * via src/utils/taxConfig.ts.  There are NO hardcoded numbers in this file.
 *
 * These are last-resort fallbacks used across ALL tabs when the server hasn't
 * populated a tx.* field (first load, partial payload, legacy cache).
 * Always prefer the server-supplied tx.* value over these.
 *
 * ► To change any value, edit the JSON source file — never this file.
 */

export {
  STD_DEDUCTION_MFJ,
  STD_DEDUCTION_SINGLE,
  LTCG_0PCT_MFJ    as LTCG_0PCT_THRESHOLD_MFJ,
  LTCG_15PCT_MFJ   as LTCG_15PCT_THRESHOLD_MFJ,
  LTCG_0PCT_SINGLE as LTCG_0PCT_THRESHOLD_SINGLE,
  LTCG_15PCT_SINGLE as LTCG_15PCT_THRESHOLD_SINGLE,
  NIIT_RATE,
  NIIT_THRESHOLD_MFJ,
  NIIT_THRESHOLD_SINGLE,
  TARGET_BRACKET_RATE as DEFAULT_BRACKET_RATE,
} from './taxConfig'

// ─── Withdrawal strategy state-machine thresholds ────────────────────────────
// Source: server/rules.json → _WITHDRAWAL_STRATEGY.state_ab_gain_ratio / state_bc_gain_ratio
// The server computes portfolio-size-adjusted dollar thresholds (ratio × total_market_value)
// and sends them as tx.withdrawal_state_ab_threshold / bc_threshold.
// These static fallbacks are only used first-boot before a server response is available.

import rulesJson from '../../server/rules.json'
import personalJson from '../../server/personal.json'
import retirementEngineJson from '../../server/retirement_engine.json'

const _ws = rulesJson._WITHDRAWAL_STRATEGY

/** Gain ratio at which portfolio transitions from State A → B (default 30%). */
export const WITHDRAWAL_AB_GAIN_RATIO: number = _ws.state_ab_gain_ratio

/** Gain ratio at which portfolio transitions from State B → C (default 45%). */
export const WITHDRAWAL_BC_GAIN_RATIO: number = _ws.state_bc_gain_ratio

/** Static dollar fallback for first-boot only — server always returns portfolio-adjusted value. */
export const WITHDRAWAL_AB_THRESHOLD: number = 1_000_000

/** Static dollar fallback for first-boot only — server always returns portfolio-adjusted value. */
export const WITHDRAWAL_BC_THRESHOLD: number = 1_500_000

// ─── Tax warning thresholds ───────────────────────────────────────────────────
// UI-only thresholds used to surface inline warnings. No server equivalent yet;
// update here when the server starts exposing these via tx.*.

/** Realized STCG above this level triggers a "reduces Roth conversion capacity" warning. */
export const STCG_WARNING_THRESHOLD: number = 50_000

/** Dividend income load alert fallback — server sends tx.withdrawal_dividend_load_alert;
 *  this is only used on first boot before the server responds. Source: rules.json → dividend_load_alert */
export const WITHDRAWAL_DIV_LOAD_ALERT: number = 160_000

/** Bar overflow factor: the gain tracker bar scales to this multiple of the B→C threshold
 *  so State C portfolios still have visible bar movement beyond the last threshold. */
export const GAIN_BAR_OVERFLOW_FACTOR: number = 1.5

// ─── Risk-free rate ───────────────────────────────────────────────────────────
// Used for Sharpe ratio computation everywhere. Source: US 3-month T-bill proxy.
// Update annually or source from a server field when available.
export const RISK_FREE_RATE: number = 0.045        // 4.5% annual
export const RISK_FREE_RATE_PCT: number = 4.5      // same value as percent (for display)

// ─── Spending fallback ────────────────────────────────────────────────────────
// Last-resort spending fallback — only used when BOTH si.true_annual_spending AND
// si.hardcoded_spending are null (server not yet responding, no CSV, no personal.json).
// The real source of truth is: personal.json → estimated_spending → si.hardcoded_spending.
// Prefer: si.true_annual_spending ?? si.hardcoded_spending ?? DEFAULT_ANNUAL_SPENDING
export const DEFAULT_ANNUAL_SPENDING: number = 72_000

// ─── Social Security ──────────────────────────────────────────────────────────
// Statutory maximum SS taxable fraction (IRS Publication 915).
// 85% is the permanent statutory cap for MFJ above MAGI $44K; not configurable.
export const SS_TAXABLE_PCT: number = 0.85
// Annual delayed credit rate (8%/yr from FRA to 70, IRS statutory).
export const SS_DELAY_CREDIT_RATE: number = 0.08

// ─── Stress scenario parameters ───────────────────────────────────────────────
// All stress shock magnitudes. Change here, applies to all 4 scenarios.
export const STRESS_MARKET_CRASH_PCT: number = 20      // S&P -20% market crash scenario
export const STRESS_VIX_SPIKE_VOL_FACTOR: number = 0.3 // Vol × 0.3 → portfolio drop on VIX×2
export const STRESS_TOP_HOLDING_DROP_PCT: number = 30  // Top holding -30% scenario
export const STRESS_RATE_SHOCK_VOL_FACTOR: number = 0.15  // Vol × 0.15 → rate shock drop
export const BETA_VOL_DIVISOR: number = 15             // vol/15 → approximate beta
export const BETA_MAX_CAP: number = 2.0                // maximum capped beta for stress

// ─── Drawdown engine ─────────────────────────────────────────────────────────
// Plan horizon default (age 95) — used when tx.target_age is not set.
export const DEFAULT_PLAN_HORIZON_AGE: number = 95
// Default LTCG gain rate when not in portfolio (heuristic for simulation).
export const DEFAULT_TAXABLE_GAIN_RATE: number = 0.30
// Minimum bracket headroom (in $) to trigger a Roth conversion recommendation.
export const MIN_CONVERSION_CEILING: number = 500
// IRMAA cliff warning threshold — warn when headroom is below this.
export const IRMAA_CLIFF_WARN_THRESHOLD: number = 20_000

// Vol budget utilization thresholds (retirementEngine score bands)
export const VOL_BUDGET_ALERT: number = 150   // risk score critical
export const VOL_BUDGET_WARN:  number = 120   // risk score elevated
export const VOL_BUDGET_WATCH: number = 100   // risk score at target

/** Default safety buffer — read from personal.json → _PERSONAL.conversion_safety_buffer
 *  so the frontend fallback can't drift from the configured value. */
export const DEFAULT_SAFETY_BUFFER: number =
  personalJson._PERSONAL?.conversion_safety_buffer ?? 7200

// ─── Rollover conversion ─────────────────────────────────────────────────────
const _re = retirementEngineJson._RETIREMENT_ENGINE

/** Rollover IRA balance at/below this is treated as fully converted (dust/rounding from the
 *  final conversion, not a real remaining balance) — anywhere the engine would otherwise keep
 *  counting down against an empty account should instead report the conversion as complete. */
export const ROLLOVER_DEPLETED_THRESHOLD: number = _re.depleted_threshold ?? 50

// ─── LTCG rates ──────────────────────────────────────────────────────────────
// US LTCG preferential rates (IRS). Source: tax_brackets.json ltcg_brackets.
// Use tx.ltcg_rate for the applicable rate when server provides it.
export const LTCG_RATE_15: number = 0.15
export const LTCG_RATE_20: number = 0.20
// Top ordinary income bracket rate (37% for 2024+).
// Source: tax_brackets.json → brackets_mfj last entry. Not configurable per se.
export const TOP_BRACKET_RATE: number = 0.37
