/**
 * taxConfig.ts — Single source-of-truth for all tax / rule constants.
 *
 * Values are derived DIRECTLY from the three server JSON data files:
 *   server/tax_brackets.json  — IRS ordinary-income brackets & std deductions
 *   server/rules.json         — LTCG brackets, NIIT, target bracket, IRMAA tiers
 *   server/personal.json      — Filing status, Medicare election, SS settings
 *
 * The Python data provider (portfolio_data.py) reads the same files and sends
 * the values to the frontend via the `tax_data` object (tx.*).  These exports
 * are used ONLY as last-resort fallbacks when a tx.* field is absent or null
 * (first load, partial payload, or legacy cache).
 *
 * ► To change any constant, edit the JSON file — never edit this file directly.
 * ► Vite resolves JSON imports at build time; TypeScript infers full types.
 */

import taxBracketsJson from '../../server/tax_brackets.json'
import rulesJson        from '../../server/rules.json'
import personalJson     from '../../server/personal.json'

// ─── Raw JSON references ──────────────────────────────────────────────────────

const _brackets  = taxBracketsJson._TAX_BRACKETS
const _rules     = rulesJson._TAX_RULE_ENGINE
const _irmaa     = (rulesJson as any)._IRMAA_TIERS  as { mfj: IrmaaTierRaw[], single: IrmaaTierRaw[] }
const _rmdRaw    = (rulesJson as any)._RMD_FACTORS  as Record<string, number>
const _ddefs     = (personalJson as any)._DRAWDOWN_DEFAULTS as Record<string, number>

// ─── Bracket type (max is null for the top bracket → convert to Infinity) ────

export interface TaxBracketDef {
  rate: number
  min:  number
  max:  number   // Infinity for the top bracket
}

function normaliseBrackets(
  raw: ReadonlyArray<{ rate: number; min: number; max: number | null }>
): TaxBracketDef[] {
  return raw.map(b => ({ rate: b.rate, min: b.min, max: b.max ?? Infinity }))
}

// ─── Ordinary-income tax brackets ────────────────────────────────────────────

/** MFJ ordinary-income brackets (from tax_brackets.json). */
export const MFJ_BRACKETS: TaxBracketDef[]    = normaliseBrackets(_brackets.brackets_mfj)

/** Single ordinary-income brackets (from tax_brackets.json). */
export const SINGLE_BRACKETS: TaxBracketDef[] = normaliseBrackets(_brackets.brackets_single)

// ─── Standard deductions ──────────────────────────────────────────────────────

/** MFJ standard deduction (tax_brackets.json → standard_deduction_mfj). */
export const STD_DEDUCTION_MFJ:    number = _brackets.standard_deduction_mfj

/** Single standard deduction (tax_brackets.json → standard_deduction_single). */
export const STD_DEDUCTION_SINGLE: number = _brackets.standard_deduction_single

/** Permanent additional deduction per person age 65+ (tax_brackets.json → age_65_additional_deduction_per_person). */
export const AGE_65_ADDITIONAL_DEDUCTION: number = (_brackets as any).age_65_additional_deduction_per_person ?? 0

/** Temporary senior deduction per qualifying person (tax_brackets.json → senior_deduction_per_person). Expires after SENIOR_DEDUCTION_EXPIRES_YEAR. */
export const SENIOR_DEDUCTION_PER_PERSON: number = (_brackets as any).senior_deduction_per_person ?? 0

/** Last tax year the temporary senior deduction applies (tax_brackets.json → senior_deduction_expires_year). */
export const SENIOR_DEDUCTION_EXPIRES_YEAR: number = (_brackets as any).senior_deduction_expires_year ?? 0

// ─── LTCG bracket thresholds ──────────────────────────────────────────────────
// Source: rules.json → _TAX_RULE_ENGINE.ltcg_brackets_mfj / ltcg_brackets_single

/** Top of the 0 % LTCG bracket for MFJ — income below this is tax-free LTCG. */
export const LTCG_0PCT_MFJ: number =
  _rules.ltcg_brackets_mfj.find(b => b.rate === 0.0)?.max ?? 0

/** Top of the 15 % LTCG bracket for MFJ — income above this is taxed at 20 %. */
export const LTCG_15PCT_MFJ: number =
  _rules.ltcg_brackets_mfj.find(b => b.rate === 0.15)?.max ?? 0

/** Top of the 0 % LTCG bracket for Single filers. */
export const LTCG_0PCT_SINGLE: number =
  _rules.ltcg_brackets_single.find(b => b.rate === 0.0)?.max ?? 0

/** Top of the 15 % LTCG bracket for Single filers. */
export const LTCG_15PCT_SINGLE: number =
  _rules.ltcg_brackets_single.find(b => b.rate === 0.15)?.max ?? 0

// ─── NIIT ─────────────────────────────────────────────────────────────────────

/** Net Investment Income Tax rate (rules.json → niit_rate). */
export const NIIT_RATE: number = _rules.niit_rate

/** MAGI threshold above which NIIT applies for MFJ (rules.json → niit_threshold_mfj). */
export const NIIT_THRESHOLD_MFJ: number = _rules.niit_threshold_mfj

/** MAGI threshold above which NIIT applies for Single (rules.json → niit_threshold_single). */
export const NIIT_THRESHOLD_SINGLE: number = _rules.niit_threshold_single

// ─── Target bracket rate ──────────────────────────────────────────────────────

/** User's target bracket ceiling — lives in personal.json → _TAX_SETTINGS.target_bracket_rate.
 *  (rules.json no longer carries this field.) Falls back to 24. */
export const TARGET_BRACKET_RATE: number =
  personalJson._TAX_SETTINGS?.target_bracket_rate ?? 24

// ─── IRMAA tiers ──────────────────────────────────────────────────────────────
// Source: rules.json → _IRMAA_TIERS (full monthly premiums per person, base + surcharge)

interface IrmaaTierRaw {
  label:          string
  magi_from:      number
  magi_to:        number | null
  part_b_monthly: number
  part_d_monthly: number
}

export interface IrmaaTier {
  label:          string
  magi_from:      number
  magi_to:        number   // Infinity for the last tier
  part_b_monthly: number
  part_d_monthly: number
}

function normaliseIrmaaTiers(raw: IrmaaTierRaw[]): IrmaaTier[] {
  return raw.map(t => ({ ...t, magi_to: t.magi_to ?? Infinity }))
}

/** MFJ IRMAA tiers — total Part B + D monthly premiums per person (rules.json → _IRMAA_TIERS.mfj). */
export const IRMAA_TIERS_MFJ:    IrmaaTier[] = normaliseIrmaaTiers(_irmaa?.mfj    ?? [])

/** Single IRMAA tiers — total Part B + D monthly premiums per person (rules.json → _IRMAA_TIERS.single). */
export const IRMAA_TIERS_SINGLE: IrmaaTier[] = normaliseIrmaaTiers(_irmaa?.single ?? [])

// ─── RMD factors ──────────────────────────────────────────────────────────────
// Source: rules.json → _RMD_FACTORS (IRS Uniform Lifetime Table, Pub 590-B)

/** Age → distribution period factor for RMD calculation. Keys are ages 72–99. */
export const RMD_FACTORS: Record<number, number> = Object.fromEntries(
  Object.entries(_rmdRaw ?? {}).map(([age, factor]) => [Number(age), factor])
)

/** RMD start age from rules.json → _TAX_RULE_ENGINE.rmd_start_age */
export const RMD_START_AGE: number = (_rules as Record<string, unknown>).rmd_start_age as number ?? 75

// ─── Drawdown planning defaults ───────────────────────────────────────────────
// Source: personal.json → _DRAWDOWN_DEFAULTS

export const DRAWDOWN_DEFAULTS = {
  expected_return:          (_ddefs?.expected_return          ?? 0.07)    as number,
  inflation:                (_ddefs?.inflation                ?? 0.025)   as number,
  volatility:               (_ddefs?.volatility               ?? 0.15)    as number,
  qualified_pct_fallback:   (_ddefs?.qualified_pct_fallback   ?? 0.60)    as number,
  dividend_yield_cap:       (_ddefs?.dividend_yield_cap       ?? 0.20)    as number,
  annual_spending_fallback: (_ddefs?.annual_spending_fallback ?? 130_000) as number,
}
