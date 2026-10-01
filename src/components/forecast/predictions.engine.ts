import {
  STD_DEDUCTION_MFJ, STD_DEDUCTION_SINGLE,
  LTCG_0PCT_THRESHOLD_MFJ, LTCG_0PCT_THRESHOLD_SINGLE,
  NIIT_RATE, NIIT_THRESHOLD_MFJ,
  DEFAULT_ANNUAL_SPENDING,
} from '../../utils/constants'
import { DRAWDOWN_DEFAULTS } from '../../utils/taxConfig'
import type { DashboardData } from '../../types/dashboard'
import {
  PRICE_GROWTH, DIV_GROWTH, EXPENSE_INFLATION,
  type Scenario, type PosInfo, type ProjYear,
} from './predictions.constants'

// ─── Engine ────────────────────────────────────────────────────────────────────

/**
 * Build position buckets for value-growth projection.
 * Uses flexible key matching so any account key variant is included.
 * Unknown account types fall into rollover bucket (IRA-like).
 */
export function buildPositions(data: DashboardData) {
  const r = { taxable: [] as PosInfo[], rollover: [] as PosInfo[], roth: [] as PosInfo[] }
  for (const acct of data.accounts) {
    const k      = acct.key.toLowerCase()
    const bucket = k.includes('taxable') ? r.taxable
                 : k.includes('roth')    ? r.roth
                 : r.rollover            // rollover_ira + anything else tax-deferred
    for (const p of acct.positions)
      bucket.push({ symbol: p.symbol, value: p.value, income: p.annual_income, type: p.fund_type ?? 'UNKNOWN' })
  }
  return r
}

/**
 * Build TARGET position buckets using taxable + roth target analyses.
 * Includes target Roth allocation so the "target" projection curve
 * reflects both taxable rebalancing AND Roth conversion targets.
 */
export function buildTargetPositions(data: DashboardData) {
  const taxableAcct = data.accounts.find(a => a.key.toLowerCase().includes('taxable'))
  const rothAcct    = data.accounts.find(a => a.key.toLowerCase().includes('roth'))
  const rolloverAcct= data.accounts.find(a => !a.key.toLowerCase().includes('taxable') && !a.key.toLowerCase().includes('roth'))
  const tv = taxableAcct?.value ?? 0
  const rv = rothAcct?.value    ?? 0

  const taxable = (data.taxable_target_analysis ?? [])
    .filter(t => t.target_weight > 0)
    .map(t => {
      const sn = data.snapshots[t.symbol]; const fc = data.fund_configs[t.symbol]
      const v  = tv * t.target_weight
      return { symbol: t.symbol, value: v, income: v * (sn?.ttm_yield ?? 0), type: fc?.FUND_TYPE ?? 'GROWTH' }
    })

  const roth = (data.roth_target_analysis ?? [])
    .filter(t => t.target_weight > 0)
    .map(t => {
      const sn = data.snapshots[t.symbol]; const fc = data.fund_configs[t.symbol]
      const v  = rv * t.target_weight
      return { symbol: t.symbol, value: v, income: v * (sn?.ttm_yield ?? 0), type: fc?.FUND_TYPE ?? 'GROWTH' }
    })

  // Rollover stays as-is (it drains via conversions — server models that)
  const rollover: PosInfo[] = rolloverAcct?.positions.map(p => ({
    symbol: p.symbol, value: p.value, income: p.annual_income, type: p.fund_type ?? 'UNKNOWN',
  })) ?? []

  return { taxable, rollover, roth }
}

/**
 * Compute PROJECTED income by fund-type for the TARGET allocation.
 * Uses taxable_target_analysis + roth_target_analysis to compute what income
 * would be if both accounts were fully rebalanced to target allocations today.
 * Rollover IRA uses current positions (not rebalanced — conversions handle that).
 */
export function buildTargetIncomeByType(data: DashboardData): { byType: Record<string, number>; targetTotal: number } {
  const byType: Record<string, number> = {}

  const taxableAcct  = data.accounts.find(a => a.key.toLowerCase().includes('taxable'))
  const rothAcct     = data.accounts.find(a => a.key.toLowerCase().includes('roth'))
  const rolloverAcct = data.accounts.find(a => !a.key.toLowerCase().includes('taxable') && !a.key.toLowerCase().includes('roth'))
  const tv = taxableAcct?.value ?? 0
  const rv = rothAcct?.value    ?? 0

  // Target taxable income: apply target weights to account value, use TTM yield
  for (const t of (data.taxable_target_analysis ?? []).filter(t => t.target_weight > 0)) {
    const sn = data.snapshots[t.symbol]
    const fc = data.fund_configs[t.symbol]
    if (!sn) continue
    const type   = fc?.FUND_TYPE ?? 'UNKNOWN'
    const income = tv * t.target_weight * (sn.ttm_yield ?? 0)
    byType[type] = (byType[type] ?? 0) + income
  }

  // Target Roth income: apply target weights to Roth account value, use TTM yield
  for (const t of (data.roth_target_analysis ?? []).filter(t => t.target_weight > 0)) {
    const sn = data.snapshots[t.symbol]
    const fc = data.fund_configs[t.symbol]
    if (!sn) continue
    const type   = fc?.FUND_TYPE ?? 'UNKNOWN'
    const income = rv * t.target_weight * (sn.ttm_yield ?? 0)
    byType[type] = (byType[type] ?? 0) + income
  }

  // Rollover IRA: current positions (conversion model drains this separately)
  for (const p of rolloverAcct?.positions ?? []) {
    if (p.is_money_market) continue
    const fc   = data.fund_configs[p.symbol]
    const type = fc?.FUND_TYPE ?? p.fund_type ?? 'UNKNOWN'
    byType[type] = (byType[type] ?? 0) + p.annual_income
  }

  const targetTotal = Object.values(byType).reduce((s, v) => s + v, 0)
  return { byType, targetTotal }
}

/**
 * Compute income by fund-type, scaled to income_analytics.portfolio_fwd_12m.
 *
 * Source: position.annual_income gives per-position forward income (same source
 * the detail tab uses). We use these as TYPE PROPORTIONS, then scale the total
 * to match portfolio_fwd_12m ($144,380) — the single authoritative income figure.
 *
 * income_analytics.by_account has forward_12m_income per account (keyed by the
 * account_mapping.json type: taxable | rollover_ira | roth_ira), but no by_symbol.
 * Do NOT try to read by_account.by_symbol — that key does not exist.
 */
export function buildIncomeByType(data: DashboardData): { byType: Record<string, number>; serverTotal: number; incByAcct: Record<string, number>; rolloverFwd: number } {
  const ia = data.income_analytics

  // Per-account forward income — available from income_analytics.by_account.forward_12m_income
  // (keys: taxable | rollover_ira | roth_ira per account_mapping.json)
  const incByAcct: Record<string, number> = {}
  for (const acct of data.accounts) {
    // income_analytics.by_account uses "forward_12m_income" key (Python server field name)
    // TypeScript type says fwd_12m but server sends forward_12m_income — use unknown cast
    const serverAcct = (ia?.by_account as unknown as Record<string, Record<string, number>>)?.[acct.key]
    incByAcct[acct.key] = serverAcct?.['forward_12m_income'] ?? acct.income ?? 0
  }

  // Per fund-type income — EXCLUDE rollover IRA (dividends reinvest inside the IRA;
  // they become spendable only after conversion, which is modeled separately as convIncome).
  const byTypeRaw: Record<string, number> = {}
  for (const acct of data.accounts) {
    const k = acct.key.toLowerCase()
    const isRollover = !k.includes('taxable') && !k.includes('roth')
    if (isRollover) continue
    for (const p of acct.positions) {
      if (p.is_money_market) continue
      const type = p.fund_type ?? 'UNKNOWN'
      byTypeRaw[type] = (byTypeRaw[type] ?? 0) + p.annual_income
    }
  }

  // Spendable server total: portfolio_fwd_12m minus rollover IRA forward income.
  // Rollover IRA income is pre-tax deferred accumulation, not cash available to spend.
  const rolloverFwd = incByAcct['rollover_ira'] ?? 0
  const allTotal    = ia?.portfolio_fwd_12m ?? Object.values(byTypeRaw).reduce((s, v) => s + v, 0)
  const serverTotal = allTotal - rolloverFwd  // spendable-only anchor

  const posTotal    = Object.values(byTypeRaw).reduce((s, v) => s + v, 0)
  const scale       = posTotal > 0 ? serverTotal / posTotal : 1
  const byType: Record<string, number> = {}
  for (const [type, v] of Object.entries(byTypeRaw)) byType[type] = v * scale

  return { byType, serverTotal, incByAcct, rolloverFwd }
}

/** Grow value of a position list — used only for portfolio VALUE projection.
 *  stress.price is an immediate shock to the current value (e.g. 0.80 = −20% crash
 *  applied now), after which normal scenario growth compounds. This keeps the
 *  stress semantics clean: crash/rally affects the starting point, not the rate.
 */
export function growPositions(positions: PosInfo[], sc: Scenario, years: number, stress: { price: number; div: number } = { price: 1, div: 1 }) {
  let val = 0
  for (const p of positions) {
    const pg = PRICE_GROWTH[p.type]?.[sc] ?? PRICE_GROWTH.UNKNOWN[sc]
    val += p.value * stress.price * Math.pow(1 + pg, years)
  }
  return val
}

/**
 * Project annual income for year y by growing each fund-type's share.
 * Anchored to income_analytics.portfolio_fwd_12m at Year-0.
 * DIV_GROWTH tracks PRICE_GROWTH for most types (income = yield × value, yield stable).
 *
 * stress.div is an immediate cut to the BASE income level (e.g. 0.60 = −40% cut
 * applied to the starting income, after which normal scenario growth compounds).
 * Previously this was applied to the growth RATE, which had no effect on types
 * with DIV_GROWTH = 0.0 (CEFs) and near-zero effect on all others.
 */
export function projectIncome(
  incByType: Record<string, number>,
  sc: Scenario, y: number, stress: { div: number },
): number {
  let inc = 0
  for (const [type, typeInc] of Object.entries(incByType)) {
    const dg = DIV_GROWTH[type]?.[sc] ?? DIV_GROWTH.UNKNOWN[sc]
    inc += typeInc * stress.div * Math.pow(1 + dg, y)
  }
  return Math.max(inc, 0)
}

export function computeProjection(
  data: DashboardData, sc: Scenario, horizonYears: number,
  positions: ReturnType<typeof buildPositions>,
  stress: { price: number; div: number } = { price: 1, div: 1 },
): ProjYear[] {
  const tx  = data.tax_data
  const si  = data.spending_intelligence
  const yr0 = new Date().getFullYear()

  const age0   = tx.current_age  ?? 65
  const ssAge  = tx.ss_start_age ?? 70
  const ssAnnl = tx.ss_annual    ?? 0
  // Spousal SS: 1/2 of earner benefit starting when earner reaches the age-equivalent of spouse's claiming age
  const spousalSsEarnerAge = (tx.spouse_ss_start_age != null && tx.spouse_age != null)
    ? age0 + (tx.spouse_ss_start_age - tx.spouse_age) : null
  const spousalBenefit = ssAnnl * 0.5
  const _isMfj = tx.filing_status === 'MFJ'
  const stdDed = tx.std_deduction       ?? (_isMfj ? STD_DEDUCTION_MFJ       : STD_DEDUCTION_SINGLE)
  const ltcg0  = tx.ltcg_0pct_threshold ?? (_isMfj ? LTCG_0PCT_THRESHOLD_MFJ : LTCG_0PCT_THRESHOLD_SINGLE)
  const bkts   = tx.brackets ?? []
  // Server projection rows — ONLY used for: ss_income, rollover_value, roth_value.
  // NEVER use srow.dividends (includes conversion income) or srow.federal_tax (includes
  // conversion tax — would show $74K tax on $88K income, which is mathematically impossible).
  const srv = tx.projections_recommended ?? tx.projections ?? []

  // Lifestyle + inflation-adjusted expenses (forecast basis).
  // NOTE: This is the TOTAL expense base including medical buffer and inflation runway —
  // it differs from Cash Flow tab "Annual Spending" which is actual lifestyle spending only.
  // Fallback chain: CSV-derived → tax_data embedded → configured → hardcoded minimum
  // Fallback chain: CSV-derived → tax_data → personal.json estimate → last-resort constant
  const rawSpend = si?.true_annual_spending ?? tx.spending_true_annual ?? si?.hardcoded_spending ?? DEFAULT_ANNUAL_SPENDING
  const _trackedNetOfTax = Math.max(0, rawSpend - (si?.taxes_annual ?? 0))
  const expBase  = _trackedNetOfTax || Math.abs(si?.hardcoded_spending ?? DEFAULT_ANNUAL_SPENDING)
  // Which spending number actually drives the projection — surfaced on every row
  // so the UI can say "deficit vs PLAN spending" instead of contradicting the
  // Cash Flow tab's tracked-spend coverage. Falls back to plan when tracked
  // spend nets to $0 after the tax adjustment.
  const expenseBasis: 'plan' | 'tracked' =
    _trackedNetOfTax > 0 && rawSpend !== si?.hardcoded_spending ? 'tracked' : 'plan'
  const expInf   = EXPENSE_INFLATION[sc]

  // Income anchor — built once, used for all years.
  // byType is scaled to portfolio_fwd_12m so Year-0 total = server authoritative figure.
  const { byType: incByType } = buildIncomeByType(data)

  // ── Rollover/Roth extrapolation beyond the server's window ──────────────────
  // The server (`_make_projections`) only returns 15 years. Roadmap/Forecast often
  // request longer horizons (20-25+ years to reach RMD/SS phase boundaries). Once
  // `calYear` exceeds server coverage, falling back to growPositions(...) would
  // re-compound the ORIGINAL (year-0) rollover/Roth balances with no conversions
  // ever applied — the balance visibly jumps back up at the 15/16-year boundary.
  // Instead, continue the SAME drain-into-Roth walk the server uses, starting
  // from its last known row, so the trajectory stays continuous.
  const lastServerRow = srv.length > 0 ? srv[srv.length - 1] : null
  let extrapRollover = lastServerRow?.rollover_value ?? null
  let extrapRoth     = lastServerRow?.roth_value ?? null
  const growthRate   = DRAWDOWN_DEFAULTS.expected_return

  // ── Taxable-value withdrawal drag ────────────────────────────────────────────
  // growPositions() alone compounds the ORIGINAL positions with no withdrawals —
  // it never reflects a negative netCashflow (spending exceeding dividend income,
  // funded by controlled sales from the taxable account, as State B/C explicitly
  // does elsewhere in this app). Track a running taxable balance instead, so a
  // deficit year actually reduces the base future years compound from.
  const taxableBaseVal = positions.taxable.reduce((s, p) => s + p.value, 0)
  const taxableGrowthRate = taxableBaseVal > 0
    ? positions.taxable.reduce((s, p) => s + p.value * (PRICE_GROWTH[p.type]?.[sc] ?? PRICE_GROWTH.UNKNOWN[sc]), 0) / taxableBaseVal
    : PRICE_GROWTH.UNKNOWN[sc]
  let taxableValueState = growPositions(positions.taxable, sc, 0, stress)

  const rows: ProjYear[] = []
  for (let i = 0; i < horizonYears; i++) {
    const y       = i + 1
    const calYear = yr0 + y
    const age     = age0 + y
    const srow    = srv.find(r => r.year === calYear)

    // Rollover/Roth values + this year's conversion — from the server while its
    // window covers this year, extrapolated with the same model afterward.
    const planConvCap = tx.annual_conversion ?? 0
    let rolloverValueOut: number
    let rothValueOut: number
    let rawConvIncome: number
    if (srow) {
      rolloverValueOut = srow.rollover_value
      rothValueOut     = srow.roth_value
      rawConvIncome    = srow.conversion ?? 0
      extrapRollover   = srow.rollover_value
      extrapRoth       = srow.roth_value
    } else if (extrapRollover != null && extrapRoth != null) {
      const convThisYear = Math.min(planConvCap, extrapRollover)
      extrapRollover = Math.max(0, extrapRollover - convThisYear) * (1 + growthRate)
      extrapRoth     = (extrapRoth + convThisYear) * (1 + growthRate)
      rolloverValueOut = extrapRollover
      rothValueOut     = extrapRoth
      rawConvIncome    = convThisYear
    } else {
      // No server rollover/Roth data at all — fall back to pure price growth.
      rolloverValueOut = growPositions(positions.rollover, sc, y, stress)
      rothValueOut     = growPositions(positions.roth,     sc, y, stress)
      rawConvIncome    = 0
    }

    // Investment income — anchored to real portfolio_fwd_12m, grown by type.
    // NEVER use srow.dividends — it bundles conversion income and inflates the figure.
    const annualIncome = projectIncome(incByType, sc, y, stress)

    // Roth conversion income — adds to AGI/taxable income but is NOT cash received.
    // Only included in base scenario (the recommended planned path); bull/bear are
    // market-shock what-ifs that don't model conversion execution.
    // Cap at current Tax tab plan target (tx.annual_conversion) to avoid using stale
    // legacy plan values (e.g. old $217K/yr) that no longer match the Tax tab recommendation.
    const convIncome = sc === 'base'
      ? (planConvCap > 0 ? Math.min(planConvCap, rawConvIncome) : rawConvIncome)
      : 0

    // SS income — earner (from server row when available) + spousal benefit (1/2 earner)
    const earnerSsIncome = srow?.ss_income ?? (age >= ssAge ? ssAnnl : 0)
    const spousalSsIncome = spousalSsEarnerAge != null && age >= spousalSsEarnerAge ? spousalBenefit : 0
    const ssIncome = earnerSsIncome + spousalSsIncome

    // grossIncome = full AGI for tax bracket computation (includes conversion ordinary income)
    const grossIncome = annualIncome + ssIncome + convIncome
    // cashIncome = actual money received (conversion is an account move, not cash)
    const cashIncome  = annualIncome + ssIncome

    // Tax is computed on full AGI (including conversion). This is correct — conversion
    // is taxable ordinary income even though it produces no cash inflow.
    const taxableIncome = Math.max(0, grossIncome - stdDed)
    const bracketSlices: import('./predictions.constants').BracketSlice[] = []
    let federalTax = 0
    for (const b of bkts) {
      const slice = Math.min(Math.max(0, taxableIncome - b.min), b.max - b.min)
      if (slice > 0) { const tax = slice * b.rate; bracketSlices.push({ rate: b.rate, slice, tax }); federalTax += tax }
    }
    // Sanity guard: tax must be < taxable income (if brackets produce impossible result, cap at 35%)
    federalTax = Math.min(federalTax, taxableIncome * 0.37)

    const niitAmount   = grossIncome > NIIT_THRESHOLD_MFJ ? (grossIncome - NIIT_THRESHOLD_MFJ) * NIIT_RATE : 0
    const ltcgCapacity = Math.max(0, ltcg0 - taxableIncome)
    const expenses     = Math.max(0, expBase * Math.pow(1 + expInf, y))

    // netCashflow uses cash income only — conversion is an account move, not cash received.
    // The tax ON the conversion IS a real cash cost, correctly reducing net cashflow.
    const netCashflow = cashIncome - federalTax - expenses

    // Grow the taxable bucket, then withdraw this year's deficit (if any) before
    // it compounds into next year's base — so a State B/C shortfall visibly and
    // permanently reduces the projected taxable balance instead of vanishing.
    taxableValueState = taxableValueState * (1 + taxableGrowthRate)
    if (netCashflow < 0) taxableValueState = Math.max(0, taxableValueState + netCashflow)
    const txVal = taxableValueState

    rows.push({
      calYear, age,
      portfolioValue: txVal + rolloverValueOut + rothValueOut,
      taxableValue:   txVal,
      rolloverValue:  rolloverValueOut,
      rothValue:      rothValueOut,
      annualIncome, convIncome, ssIncome, grossIncome,
      stdDeduction: stdDed, taxableIncome,
      bracketSlices, federalTax,
      effectiveRate: grossIncome > 0 ? federalTax / grossIncome : 0,
      niitAmount, ltcgCapacity, expenses, expenseBasis,
      netCashflow,
    })
  }
  return rows
}
