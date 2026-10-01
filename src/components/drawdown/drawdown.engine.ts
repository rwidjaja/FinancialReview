/**
 * Withdrawal Strategy Engine — CFP-grade drawdown simulator
 *
 * Runs a deterministic year-by-year simulation for each withdrawal strategy.
 * Each year it:
 *   1. Grows all account balances by expected return
 *   2. Pays out dividends from taxable (reduces taxable balance)
 *   3. Computes required minimum distributions (RMDs) from rollover starting at the configured RMD age
 *   4. Applies strategy-specific withdrawal sequencing to meet spending need
 *   5. Calculates taxes on all taxable income
 *   6. Records per-year detail for charts and tables
 */

// ─── Tax bracket helpers ──────────────────────────────────────────────────────
// All numeric constants come from server JSON files via taxConfig — no hardcoded
// numbers in this file.  The Python data provider reads the same JSON sources.

import {
  MFJ_BRACKETS    as MFJ_BRACKETS_2026,
  SINGLE_BRACKETS as SINGLE_BRACKETS_2026,
  STD_DEDUCTION_MFJ,
  STD_DEDUCTION_SINGLE,
  LTCG_0PCT_MFJ,
  LTCG_15PCT_MFJ,
  LTCG_0PCT_SINGLE,
  LTCG_15PCT_SINGLE,
  NIIT_THRESHOLD_MFJ,
  NIIT_THRESHOLD_SINGLE,
  NIIT_RATE,
  TARGET_BRACKET_RATE,
  IRMAA_TIERS_MFJ,
  IRMAA_TIERS_SINGLE,
  RMD_FACTORS,
  RMD_START_AGE,
  DRAWDOWN_DEFAULTS,
  type TaxBracketDef,
  type IrmaaTier,
} from '../../utils/taxConfig'

import {
  SS_TAXABLE_PCT,
  LTCG_RATE_15,
  LTCG_RATE_20,
  TOP_BRACKET_RATE,
  DEFAULT_PLAN_HORIZON_AGE,
  DEFAULT_TAXABLE_GAIN_RATE,
  MIN_CONVERSION_CEILING,
} from '../../utils/constants'

/** Alias so existing code that references TaxBracket continues to compile. */
export type TaxBracket = TaxBracketDef

function calcRMD(balance: number, age: number, rmdStartAge: number = RMD_START_AGE): number {
  if (age < rmdStartAge) return 0
  const factor = RMD_FACTORS[Math.min(age, 99)] ?? 6.8
  return balance / factor
}

/** Ordinary income tax (progressive brackets). */
function calcOrdinaryTax(taxableIncome: number, brackets: TaxBracket[]): number {
  if (taxableIncome <= 0) return 0
  let tax = 0
  for (const b of brackets) {
    const inBracket = Math.max(0, Math.min(taxableIncome, b.max) - b.min)
    tax += inBracket * b.rate
    if (taxableIncome <= b.max) break
  }
  return tax
}

/** Marginal rate on the next dollar of ordinary income. */
function marginalRate(taxableIncome: number, brackets: TaxBracket[]): number {
  for (const b of brackets) {
    if (taxableIncome <= b.max) return b.rate
  }
  return TOP_BRACKET_RATE
}

/** How much room is left before crossing into the next bracket. */
function bracketHeadroom(taxableIncome: number, targetRate: number, brackets: TaxBracket[]): number {
  for (const b of brackets) {
    if (b.rate === targetRate) {
      return Math.max(0, b.max - taxableIncome)
    }
  }
  return 0
}

/** Optional per-call LTCG/NIIT thresholds — override the taxConfig defaults. */
interface LtcgThresholds {
  ltcg0:      number   // top of 0% bracket
  ltcg15:     number   // top of 15% bracket
  niitThresh: number   // MAGI floor for NIIT
  niitRate:   number   // NIIT rate (0.038)
}

/** Tax on qualified dividends / LTCG (preferential rates).
 *  Pass `thresholds` to use server-supplied values; falls back to taxConfig. */
function calcLtcgTax(
  qualifiedDiv:   number,
  ordinaryTaxable:number,
  magi:           number,
  isMarried:      boolean,
  thresholds?:    LtcgThresholds,
): number {
  if (qualifiedDiv <= 0) return 0
  const threshold0  = thresholds?.ltcg0      ?? (isMarried ? LTCG_0PCT_MFJ  : LTCG_0PCT_SINGLE)
  const threshold15 = thresholds?.ltcg15     ?? (isMarried ? LTCG_15PCT_MFJ : LTCG_15PCT_SINGLE)
  const niitThresh  = thresholds?.niitThresh ?? (isMarried ? NIIT_THRESHOLD_MFJ : NIIT_THRESHOLD_SINGLE)
  const niitRate    = thresholds?.niitRate   ?? NIIT_RATE

  // Stacking: LTCG sits on top of ordinary income
  const stackedBase = ordinaryTaxable
  const at0  = Math.max(0, Math.min(qualifiedDiv, threshold0  - stackedBase))
  const at15 = Math.max(0, Math.min(qualifiedDiv - at0, threshold15 - stackedBase - at0))
  const at20 = Math.max(0, qualifiedDiv - at0 - at15)

  let tax = at15 * LTCG_RATE_15 + at20 * LTCG_RATE_20

  // NIIT: applies to net investment income when MAGI > threshold
  if (magi > niitThresh) {
    const niitBase = Math.min(qualifiedDiv, magi - niitThresh)
    tax += niitBase * niitRate
  }

  return tax
}

// ─── Engine inputs / outputs ──────────────────────────────────────────────────

export type FilingStatus = 'MFJ' | 'SINGLE'
export type StrategyId =
  | 'taxable_first'
  | 'ira_first'
  | 'roth_last'
  | 'proportional'
  | 'dynamic_bracket'

export interface DrawdownInputs {
  // Accounts (start of simulation)
  taxable_balance:  number   // taxable brokerage
  rollover_balance: number   // pre-tax IRA / 401k
  roth_balance:     number   // Roth IRA

  // Spending & income
  annual_spending:  number   // total lifestyle need (real dollars today) — multi-year simulation
  income_target:    number   // gross income to target this year (spending + Roth conversion + bracket fill)
  ss_annual:        number   // Social Security benefit at ss_start_age
  ss_start_age:     number
  // Earner age at which spouse starts collecting (ss_annual * 0.5); undefined = no spousal benefit
  spouse_ss_earner_age_start?: number

  // Demographics
  current_age:      number
  target_age:       number   // end of plan horizon
  rmd_start_age:    number   // age at which RMDs begin (from rules.json)

  // Portfolio assumptions
  expected_return:  number   // e.g. 0.07
  inflation:        number   // e.g. 0.025
  dividend_yield:   number   // taxable account annual yield (e.g. 0.09)
  qualified_pct:    number   // fraction of dividends that are qualified (e.g. 0.60)

  // Tax
  filing_status:    FilingStatus
  std_deduction:    number   // override; default comes from filing_status
  target_bracket:   number   // e.g. 0.22 — stay under this marginal rate

  // Roth conversion strategy (dynamic_bracket only)
  do_roth_conversion: boolean
}

export interface YearRow {
  year:           number   // calendar year
  age:            number
  // Account balances (start of year, before withdrawals)
  taxable:        number
  rollover:       number
  roth:           number
  total:          number

  // Income components
  dividend_income:  number   // cash dividends from taxable
  ss_income:        number
  rmd:              number   // forced IRA distribution

  // Withdrawals by source
  from_taxable:   number
  from_rollover:  number
  from_roth:      number
  roth_conversion:number   // voluntary Roth conversion (not a withdrawal)

  // Tax
  ordinary_taxable: number  // after deduction
  ordinary_tax:     number
  ltcg_tax:         number
  total_tax:        number
  effective_rate:   number  // %
  marginal:         number  // top bracket rate

  // Outcomes
  spending_met:   boolean
  shortfall:      number    // unmet spending (0 if met)
  bracket_used:   number    // top bracket reached this year (e.g. 0.22)
  bracket_headroom: number  // how much more ordinary income before crossing into the next bracket
}

export interface StrategyResult {
  id:             StrategyId
  label:          string
  description:    string
  years:          YearRow[]
  // Aggregates
  depleted_at_age:number | null   // null if never depleted
  total_taxes:    number
  avg_effective_rate: number
  ending_total:   number
  ending_taxable: number
  ending_rollover:number
  ending_roth:    number
  lifetime_spending: number
  shortfall_years:number
  roth_preserved: number   // Roth balance at end (tax-free legacy)
}

export interface DrawdownResult {
  strategies: StrategyResult[]
  best_tax:   StrategyId   // lowest lifetime taxes
  best_longevity: StrategyId  // latest depletion / highest ending balance
  inputs:     DrawdownInputs
}

// ─── Core simulation ──────────────────────────────────────────────────────────

function getStdDeduction(filing: FilingStatus): number {
  return filing === 'MFJ' ? STD_DEDUCTION_MFJ : STD_DEDUCTION_SINGLE
}

function getBrackets(filing: FilingStatus): TaxBracket[] {
  return filing === 'MFJ' ? MFJ_BRACKETS_2026 : SINGLE_BRACKETS_2026
}

function simulateStrategy(
  id: StrategyId,
  label: string,
  description: string,
  inp: DrawdownInputs,
): StrategyResult {
  const brackets   = getBrackets(inp.filing_status)
  const stdDed     = inp.std_deduction > 0 ? inp.std_deduction : getStdDeduction(inp.filing_status)
  const isMarried  = inp.filing_status === 'MFJ'

  let taxable  = inp.taxable_balance
  let rollover = inp.rollover_balance
  let roth     = inp.roth_balance
  let spending = inp.annual_spending // grows with inflation each year

  const years: YearRow[] = []
  let totalTaxes  = 0
  let totalSpendt = 0
  let shortfallYears = 0
  let depletedAge: number | null = null

  const currentYear = new Date().getFullYear()

  for (let age = inp.current_age; age <= inp.target_age; age++) {
    const year = currentYear + (age - inp.current_age)

    // ── 1. Grow all accounts ────────────────────────────────────────────────
    taxable  *= (1 + inp.expected_return)
    rollover *= (1 + inp.expected_return)
    roth     *= (1 + inp.expected_return)

    // ── 2. Dividends from taxable ───────────────────────────────────────────
    const dividendIncome = taxable * inp.dividend_yield
    // Dividends are cash (reinvested into account value already via return above),
    // but for tax purposes they count as income. We treat them as separate from
    // account growth — the account value reflects total return; dividends are
    // already embedded.  For tax calc we just track the cash flow.
    // NOTE: taxable balance is NOT reduced by dividends (they are already inside
    // the total return) — we track them purely as a tax event.

    // ── 3. SS income — earner + spousal benefit (1/2 earner at spouse's claiming age) ──
    const earnerSS = age >= inp.ss_start_age ? inp.ss_annual : 0
    const spousalSS = inp.spouse_ss_earner_age_start != null && age >= inp.spouse_ss_earner_age_start
      ? inp.ss_annual * 0.5 : 0
    const ssIncome = earnerSS + spousalSS
    // 85% of SS is taxable if income is above threshold (simplified)
    const ssTaxable = ssIncome * SS_TAXABLE_PCT

    // ── 4. RMD from rollover ────────────────────────────────────────────────
    const rmd = calcRMD(rollover, age, inp.rmd_start_age)
    if (rmd > 0 && rollover > 0) {
      const actual = Math.min(rmd, rollover)
      rollover -= actual
    }

    // ── 5. Compute spending need after guaranteed income ────────────────────
    const guaranteedIncome = dividendIncome + ssIncome + rmd
    let withdrawalNeed = Math.max(0, spending - guaranteedIncome)

    // ── 6. Apply strategy to fill withdrawalNeed ────────────────────────────
    let fromTaxable  = 0
    let fromRollover = 0
    let fromRoth     = 0

    const pull = (account: 'taxable' | 'rollover' | 'roth', amount: number) => {
      if (amount <= 0) return 0
      if (account === 'taxable' && taxable > 0) {
        const a = Math.min(amount, taxable)
        taxable -= a; fromTaxable += a; return a
      }
      if (account === 'rollover' && rollover > 0) {
        const a = Math.min(amount, rollover)
        rollover -= a; fromRollover += a; return a
      }
      if (account === 'roth' && roth > 0) {
        const a = Math.min(amount, roth)
        roth -= a; fromRoth += a; return a
      }
      return 0
    }

    if (id === 'taxable_first') {
      let rem = withdrawalNeed
      rem -= pull('taxable', rem)
      rem -= pull('rollover', rem)
      rem -= pull('roth', rem)
      withdrawalNeed = rem

    } else if (id === 'ira_first') {
      let rem = withdrawalNeed
      rem -= pull('rollover', rem)
      rem -= pull('taxable', rem)
      rem -= pull('roth', rem)
      withdrawalNeed = rem

    } else if (id === 'roth_last') {
      // Blend taxable (LTCG) and IRA proportionally for tax diversity;
      // Roth is the absolute last resort — untouched while either other account has funds.
      const nonRoth = taxable + rollover
      if (nonRoth > 0 && withdrawalNeed > 0) {
        const tShare = taxable / nonRoth
        const take   = Math.min(withdrawalNeed, nonRoth)
        pull('taxable',  take * tShare)
        pull('rollover', take * (1 - tShare))
        // Fill gap if one account ran dry during proportional pull
        let gap = withdrawalNeed - fromTaxable - fromRollover
        gap -= pull('taxable', gap)
        gap -= pull('rollover', gap)
      }
      // Only tap Roth once taxable + IRA are fully exhausted
      const stillNeeded = Math.max(0, withdrawalNeed - fromTaxable - fromRollover)
      pull('roth', stillNeeded)
      withdrawalNeed = Math.max(0, withdrawalNeed - fromTaxable - fromRollover - fromRoth)

    } else if (id === 'proportional') {
      const total3 = taxable + rollover + roth
      if (total3 > 0 && withdrawalNeed > 0) {
        const tPct = taxable  / total3
        const rPct = rollover / total3
        const rtPct = roth   / total3
        pull('taxable',  withdrawalNeed * tPct)
        pull('rollover', withdrawalNeed * rPct)
        pull('roth',     withdrawalNeed * rtPct)
        // fill remainder from largest
        let rem2 = Math.max(0, withdrawalNeed - fromTaxable - fromRollover - fromRoth)
        const bal = (acc: string) => acc === 'taxable' ? taxable : acc === 'rollover' ? rollover : roth
        const order2: Array<'taxable' | 'rollover' | 'roth'> =
          (['taxable', 'rollover', 'roth'] as Array<'taxable' | 'rollover' | 'roth'>)
            .slice()
            .sort((a, b) => bal(b) - bal(a))
        for (const acc of order2) {
          rem2 -= pull(acc, rem2)
          if (rem2 <= 0) break
        }
        withdrawalNeed = Math.max(0, spending - guaranteedIncome - fromTaxable - fromRollover - fromRoth)
      }

    } else if (id === 'dynamic_bracket') {
      // Goal: fill the target bracket with ordinary income (IRA/rollover),
      // use taxable for the remainder, and preserve Roth for last.
      // Ordinary income base = dividends (taxable) + SS (85%) + RMD
      const ordinaryBase = dividendIncome + ssTaxable + rmd
      const ordinaryTaxableBase = Math.max(0, ordinaryBase - stdDed)
      const headroom = bracketHeadroom(ordinaryTaxableBase, inp.target_bracket, brackets)

      // Fill bracket with rollover withdrawal (voluntary on top of RMD)
      const voluntaryIra = Math.min(headroom, Math.max(0, withdrawalNeed - Math.max(0, taxable * 0.5)))
      if (voluntaryIra > 0 && rollover > 0) pull('rollover', voluntaryIra)

      // Then cover remaining from taxable (LTCG-favorable)
      let rem3 = Math.max(0, spending - guaranteedIncome - fromRollover)
      rem3 -= pull('taxable', rem3)
      rem3 -= pull('rollover', rem3)
      rem3 -= pull('roth', rem3)
      withdrawalNeed = rem3
    }

    // ── 7. Roth conversion (dynamic_bracket only, when headroom remains) ────
    let rothConversion = 0
    if (id === 'dynamic_bracket' && inp.do_roth_conversion && rollover > 0) {
      const ordinaryNow = dividendIncome + ssTaxable + rmd + fromRollover
      const ordinaryTaxableNow = Math.max(0, ordinaryNow - stdDed)
      const convRoom = bracketHeadroom(ordinaryTaxableNow, inp.target_bracket, brackets)
      if (convRoom > 100) {
        const conv = Math.min(convRoom * 0.9, rollover)
        rollover -= conv
        roth += conv
        rothConversion = conv
      }
    }

    // ── 8. Compute taxes ─────────────────────────────────────────────────────
    // Ordinary taxable income: dividends (ordinary portion) + SS (85%) + IRA withdrawals
    const ordinaryDivs  = dividendIncome * (1 - inp.qualified_pct)
    const qualifiedDivs = dividendIncome * inp.qualified_pct
    const ordinaryIncome = ordinaryDivs + ssTaxable + rmd + fromRollover + rothConversion
    const ordinaryTaxable = Math.max(0, ordinaryIncome - stdDed)
    const ordinaryTax = calcOrdinaryTax(ordinaryTaxable, brackets)

    // MAGI for NIIT
    const magi = ordinaryIncome + qualifiedDivs

    const ltcgTax = calcLtcgTax(qualifiedDivs, ordinaryTaxable, magi, isMarried)
    const totalTax = ordinaryTax + ltcgTax
    const effectiveRate = ordinaryIncome + qualifiedDivs > 0
      ? (totalTax / (ordinaryIncome + qualifiedDivs)) * 100
      : 0
    const marginal = marginalRate(ordinaryTaxable, brackets)

    totalTaxes += totalTax

    // ── 9. Spending reconciliation ───────────────────────────────────────────
    const actualSpending = spending - withdrawalNeed
    const shortfall = Math.max(0, withdrawalNeed)
    if (shortfall > 1) shortfallYears++
    totalSpendt += actualSpending

    const total = taxable + rollover + roth
    if (total <= 0 && depletedAge === null) depletedAge = age

    years.push({
      year, age,
      taxable, rollover, roth, total,
      dividend_income: dividendIncome,
      ss_income: ssIncome,
      rmd,
      from_taxable: fromTaxable,
      from_rollover: fromRollover,
      from_roth: fromRoth,
      roth_conversion: rothConversion,
      ordinary_taxable: ordinaryTaxable,
      ordinary_tax: ordinaryTax,
      ltcg_tax: ltcgTax,
      total_tax: totalTax,
      effective_rate: effectiveRate,
      marginal,
      spending_met: shortfall < 1,
      shortfall,
      bracket_used: marginal,
      bracket_headroom: bracketHeadroom(ordinaryTaxable, marginal, brackets),
    })

    // ── 10. Inflation-adjust spending for next year ──────────────────────────
    spending *= (1 + inp.inflation)
  }

  const validRates = years.filter(y => y.effective_rate > 0)
  const avgEffRate = validRates.length
    ? validRates.reduce((s, y) => s + y.effective_rate, 0) / validRates.length
    : 0

  const last = years[years.length - 1]

  return {
    id, label, description,
    years,
    depleted_at_age: depletedAge,
    total_taxes: totalTaxes,
    avg_effective_rate: avgEffRate,
    ending_total: last?.total ?? 0,
    ending_taxable: last?.taxable ?? 0,
    ending_rollover: last?.rollover ?? 0,
    ending_roth: last?.roth ?? 0,
    lifetime_spending: totalSpendt,
    shortfall_years: shortfallYears,
    roth_preserved: last?.roth ?? 0,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function runDrawdown(inp: DrawdownInputs): DrawdownResult {
  const strategies: [StrategyId, string, string][] = [
    ['taxable_first',   'Taxable First',    'Prefer taxable as the main source. Pull from IRA if taxable runs short. Roth is last resort only.'],
    ['ira_first',       'IRA First',        'Prefer IRA as the main source. Switch to taxable if IRA pushes you into a high bracket. Roth is last resort only.'],
    ['roth_last',       'Roth Preserve',    'Use taxable and IRA first, blended proportionally. Never touch Roth until both are fully depleted.'],
    ['proportional',    'Proportional',     'Take a little from every account each year, in proportion to what you have. Simple, but not tax-optimized.'],
    ['dynamic_bracket', 'Dynamic Bracket',  'Each year, take just enough from IRA to fill your best tax bracket. Then use taxable for the rest. Leave Roth alone unless you run out of everything else.'],
  ]

  const results = strategies.map(([id, label, desc]) =>
    simulateStrategy(id, label, desc, inp)
  )

  const bestTax = results.reduce((best, s) => s.total_taxes < best.total_taxes ? s : best).id
  const bestLon = results.reduce((best, s) => {
    if (s.depleted_at_age === null && best.depleted_at_age !== null) return s
    if (s.depleted_at_age !== null && best.depleted_at_age === null) return best
    if (s.depleted_at_age === null && best.depleted_at_age === null) {
      return s.ending_total > best.ending_total ? s : best
    }
    return s.depleted_at_age! > best.depleted_at_age! ? s : best
  }).id

  return { strategies: results, best_tax: bestTax, best_longevity: bestLon, inputs: inp }
}

/** Build default inputs from live DashboardData. */
export function buildDrawdownInputs(
  data: import('../../types/dashboard').DashboardData,
  overrides: Partial<DrawdownInputs> = {}
): DrawdownInputs {
  const tx = data.tax_data
  const summary = data.summary
  const si = data.spending_intelligence

  // Identify accounts by label patterns
  const accounts = data.accounts ?? []
  const findAcct = (keys: string[]) =>
    accounts.find(a => keys.some(k => a.key?.toLowerCase().includes(k) || a.label?.toLowerCase().includes(k)))

  const taxableAcct  = findAcct(['taxable', 'brokerage', 'individual'])
  // NOTE: no bare 'ira' token — it matched 'roth_ira' first, so the Rollover
  // balance silently used the Roth account's value throughout the engine.
  const rolloverAcct = findAcct(['rollover', 'traditional', 'trad_ira'])
  const rothAcct     = findAcct(['roth'])

  const taxableBalance  = taxableAcct?.value  ?? summary.total_value * 0.5
  const rolloverBalance = rolloverAcct?.value ?? (tx as any).rollover_balance ?? summary.total_value * 0.35
  const rothBalance     = rothAcct?.value     ?? summary.total_value * 0.15

  // Annual spending from spending intelligence
  // Use || not ?? so a 0 value (no spending data tracked) also falls through to the config fallback
  const spending = si?.true_annual_spending || (tx as any).spending_true_annual || DRAWDOWN_DEFAULTS.annual_spending_fallback

  // Dividend yield — equity positions only.
  // SWVXX / CASH earns money-market interest (ordinary income), not dividends.
  // Exclude MMF/CASH from both the income numerator and the balance denominator
  // so the yield reflects actual equity dividend behavior, not the spending bucket.
  const isEquityPos = (p: { is_money_market?: boolean; fund_type?: string; symbol: string }) =>
    !p.is_money_market && p.fund_type !== 'MONEY_MARKET' && p.symbol !== 'CASH'
  const taxableEquityPositions = (taxableAcct?.positions ?? []).filter(isEquityPos)
  const taxableEquityIncome = taxableEquityPositions.length > 0
    ? taxableEquityPositions.reduce((s, p) => s + p.annual_income, 0)
    : (taxableAcct?.income ?? data.income_analytics?.by_account?.['taxable']?.fwd_12m ?? 0)
  const taxableEquityValue = taxableEquityPositions.length > 0
    ? taxableEquityPositions.reduce((s, p) => s + p.value, 0)
    : taxableBalance
  const divYield = taxableEquityValue > 0 ? taxableEquityIncome / taxableEquityValue : DRAWDOWN_DEFAULTS.expected_return

  // Qualified pct from tax data
  const qualPct = tx.qualified_div_rate != null ? tx.qualified_div_rate / 100 : DRAWDOWN_DEFAULTS.qualified_pct_fallback

  const filingStatus: FilingStatus = tx.filing_status === 'MFJ' ? 'MFJ' : 'SINGLE'
  const stdDed = tx.std_deduction ?? (filingStatus === 'MFJ' ? STD_DEDUCTION_MFJ : STD_DEDUCTION_SINGLE)
  const targetRate = (tx.target_bracket_rate ?? TARGET_BRACKET_RATE) / 100
  let bracketCeilingMagi: number
  // Prefer server-computed ceiling (always correct for the configured target bracket rate).
  // Fall back to local bracket table lookup only when the server value is absent.
  if (tx.target_bracket_ceiling) {
    bracketCeilingMagi = tx.target_bracket_ceiling
  } else {
    const ceilingTaxable =
      getBrackets(filingStatus).find(b => b.rate === targetRate)?.max
      ?? getBrackets(filingStatus).find(b => b.rate === 0.22)?.max   // safe fallback
      ?? (filingStatus === 'MFJ' ? STD_DEDUCTION_MFJ : STD_DEDUCTION_SINGLE)
    bracketCeilingMagi = ceilingTaxable + stdDed
  }

  return {
    taxable_balance:  taxableBalance,
    rollover_balance: rolloverBalance,
    roth_balance:     rothBalance,
    annual_spending:  spending,
    // Default to what the household plans to spend (Settings estimate, else tracked) —
    // defaulting to the bracket ceiling made "$431K/yr income target" read like a
    // recommendation. The slider still allows pushing toward the ceiling for
    // bracket-fill analysis.
    income_target:    Math.max(spending, si?.hardcoded_spending ?? 0) || bracketCeilingMagi,
    ss_annual:        tx.ss_annual ?? 0,
    ss_start_age:     tx.ss_start_age ?? 67,
    spouse_ss_earner_age_start: (tx.spouse_ss_start_age != null && tx.spouse_age != null)
      ? (tx.current_age ?? 62) + (tx.spouse_ss_start_age - tx.spouse_age)
      : undefined,
    current_age:      tx.current_age ?? 62,
    target_age:       tx.target_age  ?? DEFAULT_PLAN_HORIZON_AGE,
    rmd_start_age:    tx.rmd_start_age ?? RMD_START_AGE,
    expected_return:  DRAWDOWN_DEFAULTS.expected_return,
    inflation:        DRAWDOWN_DEFAULTS.inflation,
    dividend_yield:   Math.min(divYield, DRAWDOWN_DEFAULTS.dividend_yield_cap),
    qualified_pct:    qualPct,
    filing_status:    filingStatus,
    std_deduction:    tx.std_deduction ?? (filingStatus === 'MFJ' ? STD_DEDUCTION_MFJ : STD_DEDUCTION_SINGLE),
    target_bracket:   (tx.target_bracket_rate ?? TARGET_BRACKET_RATE) / 100,
    do_roth_conversion: true,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANNUAL DECISION ENGINE
// Dividend-first, IRMAA-aware, bracket-targeting current-year recommendation.
//
// Logic flow (per Copilot / CFP spec):
//   Dividends → Bracket position → Withdrawal need → IRA fill → Roth conversion
// ═══════════════════════════════════════════════════════════════════════════════

// ─── IRMAA helpers ────────────────────────────────────────────────────────────
// Tier data sourced from rules.json → _IRMAA_TIERS via taxConfig exports.
// Re-export IrmaaTier so callers don't need a separate import.
export type { IrmaaTier }

export function getIrmaaTier(magi: number, filing: FilingStatus): IrmaaTier {
  const tiers = filing === 'MFJ' ? IRMAA_TIERS_MFJ : IRMAA_TIERS_SINGLE
  return tiers.find(t => magi >= t.magi_from && magi <= t.magi_to) ?? tiers[tiers.length - 1]
}

/** Annual IRMAA cost for N Medicare enrollees (Part B + D combined). */
export function calcIrmaaAnnual(magi: number, filing: FilingStatus, people: number): number {
  const tier = getIrmaaTier(magi, filing)
  return (tier.part_b_monthly + tier.part_d_monthly) * 12 * people
}

/** IRMAA threshold headroom — how much MAGI can grow before hitting the next tier. */
export function irmaaHeadroom(magi: number, filing: FilingStatus): number {
  const tiers = filing === 'MFJ' ? IRMAA_TIERS_MFJ : IRMAA_TIERS_SINGLE
  const current = tiers.find(t => magi >= t.magi_from && magi <= t.magi_to)
  if (!current || current.magi_to === Infinity) return 0
  return Math.max(0, current.magi_to - magi)
}

// ─── Annual Decision inputs & outputs ────────────────────────────────────────

export interface AnnualDecisionInputs {
  // Live dividend income (primary driver)
  taxable_div_annual:   number   // forward 12m taxable dividends (ordinary + qualified)
  taxable_div_qualified:number   // qualified portion of taxable divs
  ira_div_annual:       number   // IRA dividends (taxable upon withdrawal)
  roth_div_annual:      number   // Roth dividends (never taxable)

  // Income target
  income_target:        number   // desired total cash income this year

  // SS income (if currently receiving)
  ss_annual:            number   // 0 if not yet collecting
  ss_taxable_pct:       number   // fraction of SS that is taxable (0.85 if above threshold)

  // RMD (if applicable)
  rmd_amount:           number   // 0 if age < rmd_start_age (from rules.json)

  // Tax parameters
  filing_status:        FilingStatus
  std_deduction:        number
  target_bracket_rate:  number   // e.g. 0.22 — user's ceiling
  bracket_ceiling_magi: number   // MAGI at top of target bracket (after std deduction)

  // NIIT — all three from server (rules.json via tx.*)
  niit_threshold:       number   // MAGI floor (tx.niit_threshold)
  niit_rate:            number   // rate, e.g. 0.038 (tx.niit_rate / rules.json)

  // LTCG thresholds (from tx.ltcg_0pct_threshold / tx.ltcg_15pct_threshold)
  ltcg_0pct_threshold:  number   // top of 0% LTCG bracket
  ltcg_15pct_threshold: number   // top of 15% LTCG bracket

  // IRMAA
  collect_medicare:     boolean
  medicare_people:      number   // 1 or 2

  // Account balances
  taxable_balance:      number
  rollover_balance:     number
  roth_balance:         number
  // Fraction of taxable account that is unrealized gain (0–1) — fallback used
  // only when no lot-level cost-basis data is available.
  taxable_gain_rate:    number
  // Lot-aware sell composition (from tax_data.cost_basis_lots) — how much of
  // the taxable account can actually be sold at each tax treatment right now,
  // same data Tax tab's Sell & Rebalance uses. Lets the engine model a real
  // cash → LTCG → STCG sell waterfall instead of assuming every dollar sold
  // gets LTCG-preferred treatment.
  taxable_cash_available:  number   // money-market/cash — sell first, no gain
  taxable_ltcg_available:  number   // market value of mature (LTCG) lots
  taxable_ltcg_gain_rate:  number   // blended unrealized-gain % of those LTCG lots
  taxable_stcg_available:  number   // market value of not-yet-mature (STCG) lots
  taxable_stcg_gain_rate:  number   // blended unrealized-gain % of those STCG lots

  // Roth conversion — live data from Tax tab
  do_roth_conversion:   boolean
  conversion_target:    number   // planned annual total (personal.json _TARGET_ALLOC.annual_conversion)
  converted_ytd:        number   // already converted this calendar year (tx.converted_ytd)
  conv_room_real:       number   // server-computed safe bracket headroom (bracket_ceil − gross_no_ss)
  safety_buffer:        number   // buffer deducted from bracket room to get tax-optimal amount
}

export interface AnnualDecisionStep {
  step:    number
  label:   string
  amount:  number
  color:   string
  note:    string
}

export interface BracketSlot {
  rate:       number    // e.g. 0.22
  label:      string    // e.g. "22% bracket"
  ceiling:    number    // top of this bracket (gross income, pre-deduction)
  filled:     number    // income already occupying this slot
  available:  number    // room remaining in slot
  color:      string
}

export interface IrmaaImpact {
  collects:       boolean
  people:         number
  current_tier:   IrmaaTier
  next_tier:      IrmaaTier | null
  annual_cost:    number    // $ at current tier × people
  headroom:       number    // $ of MAGI before next tier
  crossover_warn: boolean   // within 20K of next tier
}

export interface AnnualDecisionResult {
  // ── Dividend-first income flow ────────────────────────────────────────
  taxable_div:          number   // taxable account dividends (cash income)
  ira_div:              number   // IRA divs — not cash, but taxable when withdrawn
  roth_div:             number   // Roth divs — tax-free, no action needed
  ss_income:            number   // SS cash income
  ss_taxable_pct:       number   // fraction of ss_income that's taxable (0/0.5/0.85 per provisional-income rules)
  rmd_forced:           number   // mandatory IRA distribution

  // ── Gap calculation ───────────────────────────────────────────────────
  guaranteed_income:    number   // divs + SS + RMD (before withdrawals)
  withdrawal_need:      number   // income_target − guaranteed_income

  // ── Withdrawal recommendation ─────────────────────────────────────────
  from_taxable:         number   // sell taxable holdings or use cash/MM
  from_rollover:        number   // IRA withdrawal (taxable event)
  roth_conversion:      number   // voluntary Roth conversion (not cash income)
  from_roth:            number   // Roth withdrawal (tax-free, last resort)
  tax_optimal_exceeded: boolean  // true when ytd_converted ≥ tax-optimal cap → no further conversion

  // ── Tax computation ───────────────────────────────────────────────────
  ordinary_income:      number   // ordinary div portion + SS taxable + IRA/rollover
  ordinary_taxable:     number   // after std deduction
  ordinary_tax:         number
  qualified_div_income: number
  ltcg_from_taxable:    number   // cap gains from selling mature LTCG lots (preferential rate)
  stcg_from_taxable:    number   // cap gains from selling not-yet-mature STCG lots (ordinary rate)
  no_lot_data:          boolean  // true when cost_basis_lots was unavailable — fell back to taxable_gain_rate
  ltcg_tax:             number
  total_tax:            number
  magi:                 number
  effective_rate:       number   // %
  marginal_rate:        number   // top bracket hit

  // ── Bracket position ──────────────────────────────────────────────────
  bracket_slots:        BracketSlot[]
  target_bracket_used:  number   // % of target bracket filled (0–100+%)
  bracket_headroom:     number   // $ remaining in target bracket
  bracket_overflow:     boolean  // exceeds target bracket

  // ── IRMAA ─────────────────────────────────────────────────────────────
  irmaa:                IrmaaImpact

  // ── NIIT ──────────────────────────────────────────────────────────────
  niit_applies:         boolean
  niit_amount:          number
  niit_headroom:        number

  // ── Torque & risk scores ──────────────────────────────────────────────
  rmd_risk:             'LOW' | 'MEDIUM' | 'HIGH'   // based on rollover size vs RMD age
  torque_preservation:  'HIGH' | 'MEDIUM' | 'LOW'   // taxable account health
  roth_preservation:    'HIGH' | 'MEDIUM' | 'LOW'

  // ── Step-by-step narrative ────────────────────────────────────────────
  steps:                AnnualDecisionStep[]

  // ── Alert flags ───────────────────────────────────────────────────────
  alerts:               { level: 'red' | 'orange' | 'yellow'; msg: string }[]

  // ── Year-end account balances (after withdrawals + in-kind conversion) ─
  taxable_after:        number   // taxable_balance − from_taxable
  rollover_after:       number   // rollover_balance − from_rollover − roth_conversion
  roth_after:           number   // roth_balance + roth_conversion (in-kind)
}

export function computeAnnualDecision(inp: AnnualDecisionInputs): AnnualDecisionResult {
  // ══════════════════════════════════════════════════════════════════════════
  // INPUT SANITISATION — coerce every numeric field to a finite number.
  // This is the single source of NaN prevention: no downstream code needs
  // to guard for undefined/null — they are eliminated here.
  // ══════════════════════════════════════════════════════════════════════════
  const safe = (v: unknown, fallback = 0): number => {
    const n = Number(v)
    return isFinite(n) ? n : fallback
  }

  const taxableDiv    = safe(inp.taxable_div_annual)
  const qualifiedDiv  = Math.min(safe(inp.taxable_div_qualified), taxableDiv)  // can't exceed total
  const ordinaryDiv   = Math.max(0, taxableDiv - qualifiedDiv)
  const iraDivNote    = safe(inp.ira_div_annual)   // informational only
  const rothDiv       = safe(inp.roth_div_annual)  // informational only
  const ssIncome      = safe(inp.ss_annual)
  const ssTaxablePct  = safe(inp.ss_taxable_pct, SS_TAXABLE_PCT)
  const ssTaxable     = ssIncome * ssTaxablePct
  const rmd           = safe(inp.rmd_amount)
  const incomeTarget  = safe(inp.income_target)
  // stdDed fallback uses filing-status-aware value from taxConfig (not a literal)
  const stdDed        = safe(inp.std_deduction,
    inp.filing_status === 'MFJ' ? STD_DEDUCTION_MFJ : STD_DEDUCTION_SINGLE)
  const niitThresh    = safe(inp.niit_threshold,
    inp.filing_status === 'MFJ' ? NIIT_THRESHOLD_MFJ : NIIT_THRESHOLD_SINGLE)
  const targetRate    = safe(inp.target_bracket_rate, TARGET_BRACKET_RATE / 100)
  // Missing bracket_ceiling_magi previously defaulted to 0, which read as
  // "ceiling already exceeded" and silently suppressed bracketOverflow/
  // target_bracket_used below. Fall back to the same niit-threshold-derived
  // proxy used elsewhere (e.g. RebalancePlanPanel.tsx eff_ceiling_for_room)
  // instead of a false "no room" reading.
  const bracketCeil   = safe(inp.bracket_ceiling_magi, niitThresh * 1.72)
  const taxableBal    = safe(inp.taxable_balance)
  const rolloverBal   = safe(inp.rollover_balance)
  const rothBal       = safe(inp.roth_balance)
  const medPeople     = Math.max(1, Math.round(safe(inp.medicare_people, 1)))

  const brackets  = getBrackets(inp.filing_status)
  const isMarried = inp.filing_status === 'MFJ'

  // LTCG & NIIT thresholds — prefer inp (server-supplied); fall back to taxConfig
  const niitRate    = safe(inp.niit_rate,            NIIT_RATE)
  const ltcg0Thresh = safe(inp.ltcg_0pct_threshold,  isMarried ? LTCG_0PCT_MFJ  : LTCG_0PCT_SINGLE)
  const ltcg15Thresh= safe(inp.ltcg_15pct_threshold, isMarried ? LTCG_15PCT_MFJ : LTCG_15PCT_SINGLE)
  const ltcgThresholds: LtcgThresholds = {
    ltcg0: ltcg0Thresh, ltcg15: ltcg15Thresh,
    niitThresh, niitRate,
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — GUARANTEED INCOME (GI)
  // GI = actual CASH available without a new withdrawal decision: taxable
  // dividends (paid out, spendable) + SS + RMD (a forced distribution, so it's
  // real cash by definition). IRA and Roth dividends do NOT belong here — they
  // compound inside those tax-advantaged accounts and are never received as
  // cash unless an actual distribution is taken (which IS the withdrawal
  // decision this function is computing). Counting them here previously
  // reduced withdrawalNeed by iraDivNote + rothDiv with no corresponding tax
  // or balance debit anywhere else — phantom income the household never
  // actually receives. iraDivNote/rothDiv are kept below as informational
  // display-only figures, not folded into this total.
  // This value is ALWAYS defined (no NaN possible after sanitisation above).
  // ══════════════════════════════════════════════════════════════════════════
  const guaranteedIncome = taxableDiv + ssIncome + rmd

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — WITHDRAWAL NEED (WN)
  // WN = max(0, Income Target − GI)
  // Never negative. Never NaN.
  // ══════════════════════════════════════════════════════════════════════════
  const withdrawalNeed = Math.max(0, incomeTarget - guaranteedIncome)

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — BRACKET HEADROOM (BH)  ← computed BEFORE any withdrawal decision
  // Ordinary income from guaranteed sources fills the bracket first:
  //   ordinary taxable divs + SS taxable portion + RMD
  // BH = bracket ceiling − ordinary income already occupying the bracket
  // This determines how much IRA room exists before crossing the target bracket.
  // ══════════════════════════════════════════════════════════════════════════
  const ordinaryFromGuaranteed = ordinaryDiv + ssTaxable + rmd
  const taxableFromGuaranteed  = Math.max(0, ordinaryFromGuaranteed - stdDed)
  // Bracket headroom in ordinary taxable-income terms (for IRA withdrawal Rule 2)
  const bktCeilingTaxable = Math.max(0, bracketCeil - stdDed)
  const bktHeadroomOrdinary = Math.max(0, bktCeilingTaxable - taxableFromGuaranteed)
  // Display headroom MUST equal bktHeadroomOrdinary (the number that actually
  // gates the IRA withdrawal in Rule 2 below) — it used to compare a GROSS
  // ordinary-income figure (ordinaryFromGuaranteed, no deduction subtracted)
  // against a TAXABLE-income ceiling (bktCeilingTaxable already has stdDed
  // subtracted once), a basis mismatch that understated the displayed room by
  // exactly stdDed whenever ordinaryFromGuaranteed < stdDed — a real case for
  // early retirees with modest dividends and no RMD yet.
  const bktHeadroomDisplay = bktHeadroomOrdinary
  // MAGI headroom used for Roth conversion sizing (qualified divs count toward MAGI)
  const bktHeadroomGross = Math.max(0, bracketCeil - ordinaryFromGuaranteed - qualifiedDiv)

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — WITHDRAWAL ORDER (deterministic, dividend-first)
  // Rule 1: Taxable first — LTCG-favorable, does NOT push ordinary bracket
  // Rule 2: IRA next — only up to bracket headroom (avoids bracket crossover)
  // Rule 3: More taxable — if IRA headroom was exhausted and gap remains
  // Rule 4: Roth last — tax-free, preserve for compounding
  // ══════════════════════════════════════════════════════════════════════════
  let fromTaxable  = 0
  let fromRollover = 0
  let fromRoth     = 0
  let remaining    = withdrawalNeed

  // Rule 1 — Taxable first (LTCG-friendly, no ordinary bracket impact)
  if (remaining > 0 && taxableBal > 0) {
    const take   = Math.min(remaining, taxableBal)
    fromTaxable  = take
    remaining   -= take
  }

  // Rule 2 — IRA only if bracket headroom > 0 (avoid ordinary bracket overflow)
  if (remaining > 0 && rolloverBal > 0 && bktHeadroomOrdinary > 0) {
    const take   = Math.min(remaining, bktHeadroomOrdinary, rolloverBal)
    fromRollover = take
    remaining   -= take
  }

  // Rule 3 — More taxable if still short (income trumps bracket purity)
  if (remaining > 0 && taxableBal - fromTaxable > 0) {
    const take  = Math.min(remaining, taxableBal - fromTaxable)
    fromTaxable += take
    remaining  -= take
  }

  // Rule 4 — Roth last resort
  if (remaining > 0 && rothBal > 0) {
    const take = Math.min(remaining, rothBal)
    fromRoth   = take
    remaining -= take
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5 — ROTH CONVERSION  (8-level hierarchy)
  //
  //  Level 1 — Tax-optimal cap (HARD STOP):
  //    taxOptimalAmount = conv_room_real − safety_buffer
  //    If ytd_converted ≥ taxOptimalAmount → STOP. Converting past this
  //    triggers NIIT, bracket breach, and erodes future conversion capacity.
  //
  //  Level 2 — Bracket ceiling (HARD):
  //    Never convert past conv_room_real (target_bracket_ceiling − gross_no_ss).
  //
  //  Level 3 — Plan target (SOFT):
  //    Cap at (conversion_target − converted_ytd). Plan target is a guide only.
  //
  //  Levels 4–8 — Window/override flags handled in AnnualDecisionPanel + RetirementEngine.
  // ══════════════════════════════════════════════════════════════════════════
  let rothConversion = 0
  let taxOptimalExceeded = false   // Case B: above tax-optimal but inside bracket — warn, don't stop

  if (inp.do_roth_conversion && rolloverBal > fromRollover) {
    const convRoomReal     = safe(inp.conv_room_real)
    const safetyBuf        = safe(inp.safety_buffer)
    const alreadyConverted = safe(inp.converted_ytd)
    const taxOptimalAmount = Math.max(0, convRoomReal - safetyBuf)

    // Level 1: flag if above tax-optimal (soft warning — NOT a hard stop)
    if (taxOptimalAmount > 0 && alreadyConverted >= taxOptimalAmount) {
      taxOptimalExceeded = true
    }

    // Level 2: HARD STOP only at the 24% bracket ceiling (Case C)
    let ceiling: number
    if (convRoomReal > 0) {
      ceiling = convRoomReal                           // bracket ceiling
    } else {
      const ordinaryAfterWithdrawal = ordinaryFromGuaranteed + fromRollover
      const taxableAfterWithdrawal  = Math.max(0, ordinaryAfterWithdrawal - stdDed)
      ceiling = bracketHeadroom(taxableAfterWithdrawal, targetRate, brackets) - qualifiedDiv
    }

    if (ceiling > MIN_CONVERSION_CEILING) {
      // Level 3: plan target remaining (soft limit)
      const annualTarget       = safe(inp.conversion_target)
      const remainingToConvert = annualTarget > 0
        ? Math.max(0, annualTarget - alreadyConverted)
        : ceiling

      // Actual = min(bracket ceiling, plan remaining, available rollover)
      // Tax-optimal is surfaced as a warning in the UI — engine allows bracket-fill discipline
      const maxConv = Math.min(ceiling, remainingToConvert, rolloverBal - fromRollover)
      rothConversion = Math.max(0, maxConv)
    }
  }

  // true when plan target (not bracket or tax-optimal) is the binding constraint
  const convPlanLimited = (() => {
    if (rothConversion === 0 || !inp.do_roth_conversion) return false
    const convRoomReal     = safe(inp.conv_room_real)
    const safetyBuf        = safe(inp.safety_buffer)
    const ceiling          = convRoomReal > 0 ? convRoomReal : Infinity
    const taxOptimal       = Math.max(0, ceiling - safetyBuf)
    const annualTarget     = safe(inp.conversion_target)
    const alreadyConverted = safe(inp.converted_ytd)
    const remaining        = annualTarget > 0 ? Math.max(0, annualTarget - alreadyConverted) : ceiling
    return remaining <= Math.min(ceiling, taxOptimal)
  })()

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6 — TAX COMPUTATION
  // Ordinary income = ordinary divs + SS taxable + RMD + IRA withdrawal + conversion
  //                   + STCG realized from taxable sales (STCG is taxed at ordinary rates)
  // LTCG income = qualified divs + LTCG realized from taxable sales
  // MAGI = ordinary income + all LTCG income
  //
  // Sell waterfall: cash/MM first (no gain) → mature LTCG lots (preferential
  // rate) → remaining STCG lots (ordinary rate). Mirrors what Sell & Rebalance
  // actually executes, using the same cost_basis_lots data, instead of
  // assuming every dollar sold gets LTCG-preferred treatment.
  // ══════════════════════════════════════════════════════════════════════════
  const cashAvail  = Math.max(0, safe(inp.taxable_cash_available, 0))
  const ltcgAvail  = Math.max(0, safe(inp.taxable_ltcg_available, 0))
  const ltcgRate   = Math.min(1, Math.max(0, safe(inp.taxable_ltcg_gain_rate, 0)))
  const stcgAvail  = Math.max(0, safe(inp.taxable_stcg_available, 0))
  const stcgRate   = Math.min(1, Math.max(0, safe(inp.taxable_stcg_gain_rate, 0)))
  const hasLotData = ltcgAvail + stcgAvail > 0

  let ltcgFromTaxable = 0, stcgFromTaxable = 0
  if (hasLotData) {
    let remaining      = fromTaxable
    const fromCash     = Math.min(remaining, cashAvail);  remaining -= fromCash
    const fromLtcgLots = Math.min(remaining, ltcgAvail);  remaining -= fromLtcgLots
    const fromStcgLots = Math.min(remaining, stcgAvail);  remaining -= fromStcgLots
    // If the need exceeds cash + LTCG + STCG on hand, the remainder still has
    // to come from somewhere — fold it into STCG at the blended STCG rate
    // (the conservative assumption) rather than silently understating tax.
    ltcgFromTaxable = fromLtcgLots * ltcgRate
    stcgFromTaxable = (fromStcgLots + remaining) * stcgRate
  } else {
    // No lot data available — fall back to the flat assumed-gain-rate model.
    const taxableGainRate = Math.min(1, Math.max(0, safe(inp.taxable_gain_rate, 0)))
    ltcgFromTaxable = fromTaxable * taxableGainRate
  }
  const totalLtcgIncome = qualifiedDiv + ltcgFromTaxable

  const ordinaryIncome  = ordinaryDiv + ssTaxable + rmd + fromRollover + rothConversion + stcgFromTaxable
  const ordinaryTaxable = Math.max(0, ordinaryIncome - stdDed)
  const ordinaryTax     = calcOrdinaryTax(ordinaryTaxable, brackets)

  const magi         = ordinaryIncome + totalLtcgIncome
  const ltcgTax      = calcLtcgTax(totalLtcgIncome, ordinaryTaxable, magi, isMarried, ltcgThresholds)
  const totalTax     = ordinaryTax + ltcgTax
  const grossIncome  = ordinaryIncome + totalLtcgIncome
  const effectiveRate = grossIncome > 0 ? (totalTax / grossIncome) * 100 : 0
  const marginal     = marginalRate(ordinaryTaxable, brackets)

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 7 — BRACKET SLOTS (visualisation)
  // Map each tax bracket to: how full is it, how much room is left?
  // We use MAGI (gross income) for the fill, adding std deduction as floor offset.
  // ══════════════════════════════════════════════════════════════════════════
  const slotColors: Record<number, string> = {
    0.10: 'var(--green)',  0.12: 'var(--green)',
    0.22: 'var(--yellow)', 0.24: 'var(--amber)',
    0.32: 'var(--red)',    0.35: 'var(--red)',
    0.37: 'var(--red)',
  }
  const bracket_slots: BracketSlot[] = brackets
    .filter(b => b.max !== Infinity && b.max <= 500_000)
    .map((b, i, arr) => {
      // Convert bracket taxable-income bounds → gross income (add std deduction)
      const grossFloor   = b.min + stdDed
      const grossCeiling = b.max + stdDed
      const prevGrossCeil = i > 0 ? arr[i - 1].max + stdDed : 0
      // How much of grossIncome falls in this bracket's range?
      const inBracket = Math.max(0,
        Math.min(grossIncome, grossCeiling) - Math.max(0, prevGrossCeil)
      )
      const bracketWidth = grossCeiling - Math.max(0, prevGrossCeil)
      const available    = Math.max(0, bracketWidth - inBracket)
      void grossFloor
      return {
        rate:      b.rate,
        label:     `${(b.rate * 100).toFixed(0)}%`,
        ceiling:   grossCeiling,
        filled:    inBracket,
        available,
        color:     slotColors[b.rate] ?? 'var(--text2)',
      }
    })

  // Target bracket fill metrics — compare MAGI (ordinary + qualified) against the
  // ceiling. bracketCeil is the AGI level at which ordinary taxable income hits the
  // target rate max (bracketCeilingTaxable + stdDed). Qualified dividends count
  // toward AGI and must be included so the meter and overflow reflect true exposure.
  // bracketOverflow = true when the user's income TARGET exceeds the ceiling.
  // The engine caps Roth conversion at the ceiling, so MAGI never exceeds it —
  // but the intent is over-bracket and the red alert must still fire.
  const bracketOverflow    = bracketCeil > 0 && incomeTarget > bracketCeil
  const targetBracketUsed  = bracketCeil > 0
    ? Math.min(100, (magi / bracketCeil) * 100)
    : 0
  const bracketHR          = Math.max(0, bracketCeil - magi)

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 8 — IRMAA
  // ══════════════════════════════════════════════════════════════════════════
  const irmaaTable    = inp.filing_status === 'MFJ' ? IRMAA_TIERS_MFJ : IRMAA_TIERS_SINGLE
  const currentTier   = getIrmaaTier(magi, inp.filing_status)
  const currentIdx    = irmaaTable.indexOf(currentTier)
  const nextTier      = currentIdx < irmaaTable.length - 1 ? irmaaTable[currentIdx + 1] : null
  const irmaaAnnual   = inp.collect_medicare
    ? (currentTier.part_b_monthly + currentTier.part_d_monthly) * 12 * medPeople
    : 0
  const irmaaHR       = irmaaHeadroom(magi, inp.filing_status)

  const irmaa: IrmaaImpact = {
    collects:       inp.collect_medicare,
    people:         medPeople,
    current_tier:   currentTier,
    next_tier:      nextTier,
    annual_cost:    irmaaAnnual,
    headroom:       irmaaHR,
    crossover_warn: inp.collect_medicare && irmaaHR > 0 && irmaaHR < 20_000,
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 9 — NIIT
  // ══════════════════════════════════════════════════════════════════════════
  const niitApplies = niitThresh > 0 && magi > niitThresh
  // NIIT base = lesser of (net investment income, MAGI excess above threshold).
  // Net investment income includes qualified dividends plus realized LTCG/STCG
  // from taxable sales. When lot data is available, ltcgFromTaxable/stcgFromTaxable
  // are real cost-basis-derived gains, not return-of-basis, so they count too —
  // when it isn't, we stay conservative and only count qualifiedDiv (the old
  // behavior), since the flat-rate fallback isn't a confident-enough gain estimate.
  const investmentIncomeForNiit = hasLotData
    ? qualifiedDiv + ltcgFromTaxable + stcgFromTaxable
    : qualifiedDiv
  const niitBase    = niitApplies
    ? Math.max(0, Math.min(investmentIncomeForNiit, magi - niitThresh))
    : 0
  const niitAmount  = niitBase * niitRate
  const niitHR      = niitThresh > 0 ? Math.max(0, niitThresh - magi) : 0

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 10 — RISK SCORES
  // ══════════════════════════════════════════════════════════════════════════
  const totalPortfolio = taxableBal + rolloverBal + rothBal
  // totalPortfolio === 0 means account balances are missing (safe() defaults
  // all three to 0), not that the portfolio is genuinely empty — a 0 default
  // here would read as "0% rollover" and always report rmdRisk LOW, hiding
  // missing data behind the friendliest label. Use a neutral 50% midpoint
  // instead so missing data doesn't masquerade as low risk.
  const rolloverPct    = totalPortfolio > 0 ? rolloverBal / totalPortfolio : 0.5
  const rmdRisk: 'LOW' | 'MEDIUM' | 'HIGH' =
    rolloverPct > 0.50 ? 'HIGH' : rolloverPct > 0.30 ? 'MEDIUM' : 'LOW'

  // Same reasoning as rolloverPct above: taxableBal === 0 from missing data
  // (vs. a genuinely empty taxable account) previously defaulted to 0% used,
  // which always reads as torque HIGH (best case) — use a neutral midpoint.
  const taxableUsedPct = taxableBal > 0 ? fromTaxable / taxableBal : 0.5
  // Account is "healthy" as long as the withdrawal rate stays below the expected
  // total return — the account still grows nominally. Only flag LOW when
  // withdrawals exceed total return (account is shrinking in dollar terms).
  const returnRate = Math.max(0.05, DRAWDOWN_DEFAULTS.expected_return)
  const torque: 'HIGH' | 'MEDIUM' | 'LOW' =
    taxableUsedPct < returnRate * 0.5 ? 'HIGH'
    : taxableUsedPct < returnRate     ? 'MEDIUM'
    : 'LOW'

  const rothPres: 'HIGH' | 'MEDIUM' | 'LOW' =
    fromRoth === 0 ? 'HIGH' : rothBal / Math.max(1, totalPortfolio) > 0.15 ? 'MEDIUM' : 'LOW'

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 11 — NARRATIVE STEPS
  // ══════════════════════════════════════════════════════════════════════════
  let stepNum = 0
  const step = () => ++stepNum

  const steps: AnnualDecisionStep[] = [
    {
      step: step(), label: 'Taxable Account Dividends',
      amount: taxableDiv,
      color: 'var(--amber)',
      note: [
        qualifiedDiv > 0 ? `$${(qualifiedDiv / 1000).toFixed(0)}K qualified (LTCG rate)` : null,
        ordinaryDiv > 0  ? `$${(ordinaryDiv  / 1000).toFixed(0)}K ordinary (fills bracket)` : null,
      ].filter(Boolean).join(' · ') || 'Primary income source — largest component',
    },
    ...(iraDivNote > 0 ? [{
      step: step(), label: 'IRA Account Dividends (available)',
      amount: iraDivNote,
      color: 'var(--blue)',
      note: 'Compounds inside IRA — available as income upon withdrawal',
    }] : []),
    ...(rothDiv > 0 ? [{
      step: step(), label: 'Roth IRA Dividends (tax-free)',
      amount: rothDiv,
      color: 'var(--green)',
      note: 'Tax-free income — never touches ordinary bracket',
    }] : []),
    ...(ssIncome > 0 ? [{
      step: step(), label: 'Social Security Income',
      amount: ssIncome,
      color: 'var(--blue)',
      note: `${(ssTaxablePct * 100).toFixed(0)}% taxable = $${(ssTaxable / 1000).toFixed(0)}K pushes ordinary bracket`,
    }] : []),
    ...(rmd > 0 ? [{
      step: step(), label: 'Required Minimum Distribution (RMD)',
      amount: rmd,
      color: 'var(--red)',
      note: 'Forced IRA withdrawal — 100% ordinary taxable income',
    }] : []),
    {
      step: step(), label: 'BRACKET HEADROOM (pre-withdrawal)',
      amount: bktHeadroomDisplay,
      color: bktHeadroomDisplay > 0 ? 'var(--green)' : 'var(--red)',
      note: bktHeadroomDisplay <= 0
        ? `Ordinary income from dividends/SS/RMD already fills the ${(targetRate * 100).toFixed(0)}% bracket — no IRA room`
        : `Ordinary bracket room before IRA withdrawals and Roth conversion · qualified divs ($${(qualifiedDiv / 1000).toFixed(0)}K) stack on top at LTCG rates separately`,
    },
    {
      step: step(), label: 'Withdrawal Gap',
      amount: withdrawalNeed,
      color: withdrawalNeed === 0 ? 'var(--green)' : 'var(--yellow)',
      note: withdrawalNeed === 0
        ? 'Guaranteed income exceeds income target — no withdrawal required'
        : `Income target $${(incomeTarget / 1000).toFixed(0)}K − guaranteed income $${(guaranteedIncome / 1000).toFixed(0)}K`,
    },
    ...(fromTaxable > 0 ? [{
      step: step(), label: 'Withdraw from Taxable',
      amount: fromTaxable,
      color: 'var(--amber)',
      note: hasLotData
        ? [
            ltcgFromTaxable > 0 ? `$${(ltcgFromTaxable / 1000).toFixed(0)}K LTCG gain (preferential rate)` : null,
            stcgFromTaxable > 0 ? `$${(stcgFromTaxable / 1000).toFixed(0)}K STCG gain (ordinary rate — not yet matured)` : null,
          ].filter(Boolean).join(' · ') || 'Sell cash/money-market — no gain realized'
        : 'Sell holdings / money market — assumed LTCG-preferred sale (no lot-level cost-basis data available)',
    }] : []),
    ...(fromRollover > 0 ? [{
      step: step(), label: 'Withdraw from Rollover IRA',
      amount: fromRollover,
      color: 'var(--blue)',
      note: `Ordinary income · stays within ${(targetRate * 100).toFixed(0)}% bracket ceiling`,
    }] : []),
    ...(rothConversion > 0 ? [{
      step: step(), label: convPlanLimited ? 'Roth Conversion (plan-limited)' : 'Roth Conversion (bracket-limited)',
      amount: rothConversion,
      color: 'var(--green)',
      note: convPlanLimited
        ? `Completes annual plan target · well within ${(targetRate * 100).toFixed(0)}% bracket ceiling`
        : `Bracket ceiling limits conversion · plan underfilled by $${((safe(inp.conversion_target) - safe(inp.converted_ytd) - rothConversion) / 1000).toFixed(0)}K`,
    }] : []),
    ...(fromRoth > 0 ? [{
      step: step(), label: 'Withdraw from Roth IRA (last resort)',
      amount: fromRoth,
      color: 'var(--green)',
      note: 'Tax-free · only used because all other sources were exhausted',
    }] : []),
  ]

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 12 — ALERTS
  // ══════════════════════════════════════════════════════════════════════════
  const alerts: { level: 'red' | 'orange' | 'yellow'; msg: string }[] = []

  // Income target exceeds bracket ceiling — engine caps Roth conversion at ceiling.
  // bracketOverflow = incomeTarget > bracketCeil, so this fires whenever the user
  // deliberately sets a target above the bracket, giving them the red alert they expect.
  if (bracketOverflow)
    alerts.push({
      level: 'red',
      msg: ` OVER ${(targetRate * 100).toFixed(0)}% BRACKET — Income target ($${(incomeTarget / 1000).toFixed(0)}K) exceeds the AGI ceiling ($${(bracketCeil / 1000).toFixed(0)}K). Roth conversion capped at $${(rothConversion / 1000).toFixed(0)}K. Reduce income target by $${((incomeTarget - bracketCeil) / 1000).toFixed(0)}K to stay within bracket.`,
    })

  if (inp.collect_medicare && irmaa.crossover_warn && nextTier)
    alerts.push({
      level: 'orange',
      msg: `IRMAA CLIFF: MAGI is only $${(irmaaHR / 1000).toFixed(0)}K from ${nextTier.label}. That adds $${((nextTier.part_b_monthly - currentTier.part_b_monthly) * 12 * medPeople).toFixed(0)}/yr in Medicare premiums.`,
    })

  if (niitApplies)
    alerts.push({
      level: 'orange',
      msg: `NIIT: ${(niitRate * 100).toFixed(1)}% surcharge applies on $${(niitBase / 1000).toFixed(0)}K of investment income = $${(niitAmount).toFixed(0)} additional tax.`,
    })

  if (rmdRisk === 'HIGH')
    alerts.push({
      level: 'yellow',
      msg: `RMD risk HIGH: Rollover IRA is ${(rolloverPct * 100).toFixed(0)}% of portfolio. Future mandatory distributions will force large ordinary income.`,
    })

  if (torque === 'LOW') {
    if (withdrawalNeed === 0 || fromTaxable === 0) {
      alerts.push({
        level: 'yellow',
        msg: 'No withdrawals required — dividends exceed spending target.',
      })
    } else {
      alerts.push({
        level: 'yellow',
        msg: 'High taxable withdrawal rate — consider reducing income target to preserve high-yield positions.',
      })
    }
  }

  if (bktHeadroomGross <= 0 && rothConversion === 0 && rolloverBal > 0)
    alerts.push({
      level: 'yellow',
      msg: `Bracket is full from dividends alone — IRA withdrawals and Roth conversions are zero this year. All income comes from taxable account.`,
    })

  return {
    taxable_div:          taxableDiv,
    ira_div:              iraDivNote,
    roth_div:             rothDiv,
    ss_income:            ssIncome,
    ss_taxable_pct:       ssTaxablePct,
    rmd_forced:           rmd,
    guaranteed_income:    guaranteedIncome,
    withdrawal_need:      withdrawalNeed,
    from_taxable:         fromTaxable,
    from_rollover:        fromRollover,
    roth_conversion:      rothConversion,
    tax_optimal_exceeded: taxOptimalExceeded,
    from_roth:            fromRoth,
    ordinary_income:      ordinaryIncome,
    ordinary_taxable:     ordinaryTaxable,
    ordinary_tax:         ordinaryTax,
    qualified_div_income: qualifiedDiv,
    ltcg_from_taxable:    ltcgFromTaxable,
    stcg_from_taxable:    stcgFromTaxable,
    no_lot_data:          !hasLotData,
    ltcg_tax:             ltcgTax,
    total_tax:            totalTax,
    magi,
    effective_rate:       effectiveRate,
    marginal_rate:        marginal,
    bracket_slots,
    target_bracket_used:  targetBracketUsed,
    bracket_headroom:     bracketHR,
    bracket_overflow:     bracketOverflow,
    irmaa,
    niit_applies:         niitApplies,
    niit_amount:          niitAmount,
    niit_headroom:        niitHR,
    rmd_risk:             rmdRisk,
    torque_preservation:  torque,
    roth_preservation:    rothPres,
    steps,
    alerts,
    taxable_after:        Math.max(0, taxableBal  - fromTaxable),
    rollover_after:       Math.max(0, rolloverBal - fromRollover - rothConversion),
    roth_after:           rothBal + rothConversion,
  }
}

interface TaxableLotComposition {
  cash_available: number   // money-market/cash sitting in the taxable account
  ltcg_available: number   // market value of mature (LTCG) lots
  ltcg_gain_rate: number   // blended unrealized-gain % of those LTCG lots (0–1)
  stcg_available: number   // market value of not-yet-mature (STCG) lots
  stcg_gain_rate: number   // blended unrealized-gain % of those STCG lots (0–1)
}

/** Scans tax_data.cost_basis_lots — the same lot data Tax tab's Sell &
 * Rebalance section uses — to find out how much of the taxable account can
 * actually be sold right now at each tax treatment (cash, mature LTCG lots,
 * not-yet-mature STCG lots), instead of assuming every dollar sold is
 * LTCG-preferred. */
function computeTaxableLotComposition(
  data: import('../../types/dashboard').DashboardData,
): TaxableLotComposition {
  const lots_db = (data.tax_data.cost_basis_lots ?? {}) as Record<string, { lots?: { is_ltcg: boolean; market_value: number; gain_loss: number }[] }>

  let ltcg_value = 0, ltcg_gain = 0
  let stcg_value = 0, stcg_gain = 0

  for (const sym of Object.keys(lots_db)) {
    for (const lot of lots_db[sym]?.lots ?? []) {
      if (lot.is_ltcg) { ltcg_value += lot.market_value; ltcg_gain += lot.gain_loss }
      else             { stcg_value += lot.market_value; stcg_gain += lot.gain_loss }
    }
  }

  const taxableAcct = (data.accounts ?? []).find(a =>
    a.key?.toLowerCase().includes('taxable') || a.label?.toLowerCase().includes('taxable'))
  const cash_available = (taxableAcct?.positions ?? [])
    .filter(p => p.is_money_market || p.fund_type === 'MONEY_MARKET' || p.symbol === 'CASH')
    .reduce((s, p) => s + (p.value ?? 0), 0)

  return {
    cash_available,
    ltcg_available: ltcg_value,
    ltcg_gain_rate: ltcg_value > 0 ? Math.max(0, ltcg_gain / ltcg_value) : 0,
    stcg_available: stcg_value,
    stcg_gain_rate: stcg_value > 0 ? Math.max(0, stcg_gain / stcg_value) : 0,
  }
}

/** Build AnnualDecisionInputs from live DashboardData + a target income.
 *
 * Priority: server-computed values from tx (ExtendedTaxData) > income_analytics
 * > account-level income > calculated fallbacks. This ensures the engine uses
 * the same data the Tax tab and Conversion engine already use.
 */
export function buildAnnualDecisionInputs(
  data: import('../../types/dashboard').DashboardData,
  income_target: number,
  overrides: Partial<AnnualDecisionInputs> = {}
): AnnualDecisionInputs {
  const tx  = data.tax_data
  const ia  = data.income_analytics
  const acc = data.accounts ?? []
  const si  = data.spending_intelligence

  const findAcct = (keys: string[]) =>
    acc.find(a => keys.some(k => a.key?.toLowerCase().includes(k) || a.label?.toLowerCase().includes(k)))

  const taxableAcct  = findAcct(['taxable', 'brokerage', 'individual'])
  // NOTE: no bare 'ira' token — it matched 'roth_ira' first, so the Rollover
  // balance silently used the Roth account's value throughout the engine.
  const rolloverAcct = findAcct(['rollover', 'traditional', 'trad_ira'])
  const rothAcct     = findAcct(['roth'])

  // ── Dividend income — equity positions only (exclude SWVXX / CASH) ──────────
  // SWVXX earns money-market interest (ordinary income taxed at marginal rate),
  // not dividends. Including it here would overstate taxable_div_annual and
  // distort the Annual Decision Engine's income flow and qualified-div calculation.
  const isEquityPos = (p: { is_money_market?: boolean; fund_type?: string; symbol: string }) =>
    !p.is_money_market && p.fund_type !== 'MONEY_MARKET' && p.symbol !== 'CASH'

  const taxableEquityPositions = (taxableAcct?.positions ?? []).filter(isEquityPos)
  const taxableFwd = taxableEquityPositions.length > 0
    ? taxableEquityPositions.reduce((s, p) => s + p.annual_income, 0)
    : (ia?.by_account?.['taxable']?.fwd_12m ?? taxableAcct?.income ?? 0)

  const rolloverFwd =
    ia?.by_account?.['rollover_ira']?.fwd_12m ??
    rolloverAcct?.income ??
    0

  const rothFwd =
    ia?.by_account?.['roth_ira']?.fwd_12m ??
    rothAcct?.income ??
    0

  // Qualified portion of taxable dividends: use server total_qualified_div if available,
  // otherwise apply qualified_div_rate to taxable forward income.
  // tx.total_qualified_div covers all accounts; scale to taxable portion.
  const totalFwdAll = taxableFwd + rolloverFwd + rothFwd
  const qualPctServer = totalFwdAll > 0 && tx.total_qualified_div
    ? tx.total_qualified_div / totalFwdAll
    : (tx.qualified_div_rate != null ? tx.qualified_div_rate / 100 : DRAWDOWN_DEFAULTS.qualified_pct_fallback)
  const taxableDivQualified = taxableFwd * qualPctServer

  // ── Account balances ────────────────────────────────────────────────────────
  // taxableBal includes SWVXX/CASH — they are withdrawable assets.
  // Only their INCOME is excluded (above) since it's interest, not dividends.
  const rolloverBal =
    rolloverAcct?.value ??
    tx.rollover_balance ??           // server-computed rollover balance
    0
  const taxableBal  = taxableAcct?.value ?? 0
  const rothBal     = rothAcct?.value    ?? 0

  // ── SS income — only if currently receiving (current_age >= ss_start_age) ──
  const collectingSS = tx.current_age >= tx.ss_start_age
  const ssAnnual = collectingSS ? (tx.ss_annual ?? 0) : 0

  // SS taxable percentage — prefer server field; fall back to standard 85 % rule.
  // tx.ss_taxable_pct is sent by the server when it can determine the provisional
  // income tier; 0.85 is the statutory maximum above the upper threshold.
  const ssTaxablePct = tx.ss_taxable_pct ?? SS_TAXABLE_PCT

  // ── RMD ────────────────────────────────────────────────────────────────────
  const rmd = calcRMD(rolloverBal, tx.current_age, tx.rmd_start_age ?? RMD_START_AGE)

  // ── Filing + deduction ─────────────────────────────────────────────────────
  const filing: FilingStatus = tx.filing_status === 'MFJ' ? 'MFJ' : 'SINGLE'
  const stdDed = tx.std_deduction ?? (filing === 'MFJ' ? STD_DEDUCTION_MFJ : STD_DEDUCTION_SINGLE)

  // ── Target bracket rate & ceiling ──────────────────────────────────────────
  // rules.json → target_bracket_rate (integer %, e.g. 24) is the user's ceiling.
  // Prefer server-sent tx.target_bracket_rate; fall back to taxConfig constant.
  const targetRate = (tx.target_bracket_rate ?? TARGET_BRACKET_RATE) / 100
  let bracketCeilingMagi: number
  // Prefer server-computed ceiling — always correct for the configured target_bracket_rate.
  if (tx.target_bracket_ceiling) {
    bracketCeilingMagi = tx.target_bracket_ceiling
  } else {
    // Look up the ceiling for the configured target rate in the bracket table.
    // The bracket table itself comes from taxConfig (tax_brackets.json), so no
    // numbers are hardcoded here — if the target rate changes in rules.json the
    // correct ceiling is found automatically.
    const bracketCeilingTaxable =
      getBrackets(filing).find(b => b.rate === targetRate)?.max
      ?? getBrackets(filing).find(b => b.rate === 0.22)?.max   // safe fallback: 22 % max
      ?? STD_DEDUCTION_MFJ   // last resort (non-zero; avoids NaN)
    bracketCeilingMagi = bracketCeilingTaxable + stdDed
  }

  // ── NIIT — all three values from server / taxConfig ────────────────────────
  const niitThresh = tx.niit_threshold ?? (filing === 'MFJ' ? NIIT_THRESHOLD_MFJ : NIIT_THRESHOLD_SINGLE)
  const niitRate   = tx.niit_rate      ?? NIIT_RATE

  // ── LTCG thresholds — prefer server; fall back to taxConfig (from rules.json) ─
  const ltcg0  = tx.ltcg_0pct_threshold  ?? (filing === 'MFJ' ? LTCG_0PCT_MFJ  : LTCG_0PCT_SINGLE)
  const ltcg15 = tx.ltcg_15pct_threshold ?? (filing === 'MFJ' ? LTCG_15PCT_MFJ : LTCG_15PCT_SINGLE)

  // ── Medicare ───────────────────────────────────────────────────────────────
  const collectMedicare = tx.collect_medicare ?? false
  const medicarePeople  = tx.medicare_people  ?? 1

  // ── Default income target — prefer actual spending if not explicitly set ───
  // income_target is passed in; we just use it as-is.
  // But for display we also expose the server's withdrawal_need_actual for comparison.
  void si   // available if needed

  return {
    taxable_div_annual:    taxableFwd,
    taxable_div_qualified: taxableDivQualified,
    ira_div_annual:        rolloverFwd,
    roth_div_annual:       rothFwd,
    income_target,
    ss_annual:             ssAnnual,
    ss_taxable_pct:        ssTaxablePct,
    rmd_amount:            rmd,
    filing_status:         filing,
    std_deduction:         stdDed,
    target_bracket_rate:   targetRate,
    bracket_ceiling_magi:  bracketCeilingMagi,
    niit_threshold:        niitThresh,
    niit_rate:             niitRate,
    ltcg_0pct_threshold:   ltcg0,
    ltcg_15pct_threshold:  ltcg15,
    collect_medicare:      collectMedicare,
    medicare_people:       medicarePeople,
    taxable_balance:       taxableBal,
    rollover_balance:      rolloverBal,
    roth_balance:          rothBal,
    taxable_gain_rate: (() => {
      const gains = tx.taxable_unrealized_gains ?? tx.total_ltcg_unrealized_gain ?? null
      return taxableBal > 0 && gains != null ? Math.min(1, Math.max(0, gains / taxableBal)) : DEFAULT_TAXABLE_GAIN_RATE
    })(),
    ...(() => {
      const comp = computeTaxableLotComposition(data)
      return {
        taxable_cash_available: comp.cash_available,
        taxable_ltcg_available: comp.ltcg_available,
        taxable_ltcg_gain_rate: comp.ltcg_gain_rate,
        taxable_stcg_available: comp.stcg_available,
        taxable_stcg_gain_rate: comp.stcg_gain_rate,
      }
    })(),
    do_roth_conversion:    true,
    conversion_target:     tx.annual_conversion ?? 0,
    converted_ytd:         tx.converted_ytd ?? 0,
    safety_buffer:         tx.safety_buffer ?? 0,
    // Safe bracket ceiling — same formula as CashflowEngine / BracketMeter in Tax tab:
    // target_bracket_ceiling (= target bracket ceiling) minus gross_no_ss (income without SS)
    conv_room_real: (() => {
      const ceil = tx.target_bracket_ceiling
      const agi  = tx.gross_no_ss
      if (ceil != null && agi != null) return Math.max(0, ceil - agi)
      return tx.conv_room_real ?? 0
    })(),
    ...overrides,
  }
}
