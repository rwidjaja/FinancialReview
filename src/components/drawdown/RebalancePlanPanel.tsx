/**
 * RebalancePlanPanel — Taxable Account Rebalance Calendar
 *
 * Designed to be foolproof:
 *   • Plain language — tells you WHAT to do, WHEN, and WHY
 *   • Step-by-step numbered trades — SELL first, BUY with proceeds
 *   • Never shows a BUY before its funding SELL
 *   • STCG lots have their own "waiting room" — do not sell until maturity
 *   • Explains why the current month is (or isn't) the right time
 */

import { useMemo, useState } from 'react'
import type { DashboardData, CostLot } from '../../types/dashboard'
import {
  STD_DEDUCTION_MFJ, STD_DEDUCTION_SINGLE,
  LTCG_0PCT_THRESHOLD_MFJ, LTCG_0PCT_THRESHOLD_SINGLE,
  LTCG_15PCT_THRESHOLD_MFJ, LTCG_15PCT_THRESHOLD_SINGLE,
  NIIT_THRESHOLD_MFJ, NIIT_THRESHOLD_SINGLE,
} from '../../utils/constants'
import { computeBucketStatus } from '../../utils/retirementEngine'
import { useDrawdownPlan } from '../../context/DrawdownPlanContext'

// ── Tiny helpers ─────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_LONG  = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function fmtD(n: number): string {
  return (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString()
}

function fmtK(n: number): string {
  if (n < 0) return `−${fmtK(-n)}`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

// Share counts: "3.990" reads like "3,990" — always use locale separators so
// fractional lots (3.99 sh) can't be misread as thousands.
function fmtShares(n: number): string {
  if (n % 1 === 0) return n.toLocaleString('en-US')
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

function pctStr(n: number): string {
  return `${n.toFixed(1)}%`
}

function addMonths(year: number, month: number, add: number): [number, number] {
  let m = month + add
  let y = year
  while (m > 12) { m -= 12; y++ }
  while (m < 1)  { m += 12; y-- }
  return [y, m]
}

function periodLong(year: number, month: number): string {
  return `${MONTHS_LONG[month - 1]} ${year}`
}

function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

// "2024-01-15" → "Jan 15, 2024"
function fmtAcqDate(iso: string): string {
  if (!iso) return '—'
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  const [y, m, d] = parts
  return `${MONTHS_SHORT[parseInt(m) - 1]} ${parseInt(d)}, ${y}`
}

// ── Engine types ─────────────────────────────────────────────────────────────────

// Full-year income picture for a given trade year
interface YearPicture {
  year:             number
  dividends:        number   // portfolio dividend income (fwd_12m)
  conversion:       number   // planned Roth conversion
  other_ordinary:   number   // other ordinary income (salary, SS, etc.) — residual
  total_ordinary:   number   // dividends + conversion + other_ordinary
  ltcg_this_step:   number   // LTCG gain being realized in this step
  total_magi:       number   // total_ordinary + ltcg_this_step
  ceiling:          number   // bracket ceiling (ordinary target)
  niit_threshold:   number
  ordinary_ok:      boolean  // total_ordinary ≤ ceiling
  niit_ok:          boolean  // total_magi ≤ niit_threshold
  niit_already:     boolean  // ordinary income alone already exceeds NIIT threshold (structural)
  status:           'safe' | 'watch' | 'over'
}

interface TradeStep {
  step_num:       number
  year:           number
  month:          number
  label:          string
  sells:          SellItem[]
  buys:           BuyItem[]
  total_proceeds: number
  total_gain:     number
  total_tax:      number
  tax_due_date:   string
  why_this_month: string
  year_picture:   YearPicture
}

interface SellItem {
  symbol:        string
  shares:        number
  proceeds:      number
  gain:          number
  gain_pct:      number   // unrealized gain % on this lot
  tax_est:       number
  // Lot identification — what to select in Schwab "Choose specific lots"
  acquired_date: string   // "2024-01-15"
  cost_basis_total: number  // total cost basis for shares being sold
  cost_per_sh:   number   // cost per share — Schwab shows this in lot selector
  is_stcg_wait:  boolean  // was STCG, now matured to LTCG
  lot_note:      string
}

interface BuyItem {
  symbol:  string
  amount:  number
  reason:  string
}

interface WaitingLot {
  symbol:       string
  shares:       number
  proceeds_est: number
  gain_est:     number
  maturity_date: string
  sell_after:   string
  days_left:    number
  lot_acq:      string
}

interface AllocationRow {
  symbol:      string
  current_pct: number
  target_pct:  number
  gap_pct:     number
  dollar_gap:  number
  action:      'SELL' | 'BUY' | 'OK'
  done_by:     string
}

interface Budget {
  projected_ordinary:  number
  ceiling:             number
  ceiling_room:        number
  niit_threshold:      number
  niit_headroom:       number
  niit_already:        boolean
  target_rate:         number
  ltcg_0_threshold:    number
  ltcg_15_threshold:   number
  std_ded:             number
  niit_rate:           number
  fwd_income:          number   // portfolio dividends (forward 12m)
  annual_conv_target:  number   // planned Roth conversion per year
  future_ordinary:     number   // fwd_income + annual_conv_target (future years baseline)
  // Cash bucket (SWVXX) status — refilling this is a Sell & Rebalance concern
  // (funded by controlled sale proceeds), not a Roth conversion concern.
  bucket_short:            boolean
  bucket_months:           number
  bucket_required_months:  number
  bucket_shortfall:        number
}

// The shared annual budget — how NIIT headroom is split between conversion and LTCG
interface SharedBudget {
  ceiling:          number   // ordinary bracket ceiling (governs conversion room + bar scale)
  ltcg_15_threshold: number  // top of the 15% LTCG bracket — governs LTCG room, NOT `ceiling`
  niit_threshold:   number
  std_ded:          number   // standard deduction — ltcg_per_year = threshold - div - conv + std_ded
  dividends_est:    number   // portfolio fwd 12m — fixed, can't control
  room_after_divs:  number   // ceiling - dividends (ordinary room left for conversion)
  conv_target:      number   // annual conversion target
  ltcg_per_year:    number   // ltcg_15_threshold - future ordinary (post std-ded) — max LTCG/year at 15%
  years_to_rebalance: number // total_ltcg_needed / ltcg_per_year
  total_ltcg_needed: number
  conv_fits:        boolean  // conv_target <= room_after_divs
  rebalance_years:  number[] // list of years in plan
}

interface Plan {
  ok:              boolean
  reason_skip:     string
  budget:          Budget
  shared:          SharedBudget
  steps:           TradeStep[]
  waiting:         WaitingLot[]
  alloc_rows:      AllocationRow[]
  total_gain:      number
  total_tax:       number
  no_lot_data:     boolean
  today_is_bad:    boolean
  bad_month_reason: string
  // Drawdown tab sync — this year's taxable cash need (Annual Decision Engine's
  // from_taxable), how much of it pure rebalance-drift selling already covers,
  // and how much extra had to be drawn from next-most-overweight positions.
  cash_need:            number
  rebalance_only_need:  number
  withdrawal_draw:      number
}

// ── Budget builder ────────────────────────────────────────────────────────────────

function buildBudget(data: DashboardData): Budget {
  const tx  = data.tax_data
  const inc = data.income_analytics

  const conv_ytd    = tx.converted_ytd ?? 0
  const gross       = tx.gross_no_ss   ?? 0    // ALL gross income minus SS (salary, divs, etc.)
  const rem_div     = tx.remaining_income_est  ?? 0
  const annual_conv = tx.annual_conversion     ?? 0
  const rem_conv    = Math.max(0, annual_conv - conv_ytd)
  const proj_ord    = Math.max(
    tx.full_year_agi_estimate ?? 0,
    gross + rem_div + rem_conv,
  )
  const _isMfj    = tx.filing_status === 'MFJ'
  // bracket_ceiling_magi is the canonical name but the server doesn't always
  // populate it — fall back to target_bracket_ceiling so we never run the
  // "exceeds the $0 bracket ceiling" branch with a missing config.
  const ceiling   = tx.bracket_ceiling_magi ?? tx.target_bracket_ceiling ?? 0
  const niit_thr  = tx.niit_threshold           ?? (_isMfj ? NIIT_THRESHOLD_MFJ    : NIIT_THRESHOLD_SINGLE)
  const niit_hdroom = Math.max(0, niit_thr - proj_ord)
  const std_ded   = tx.std_deduction            ?? (_isMfj ? STD_DEDUCTION_MFJ     : STD_DEDUCTION_SINGLE)
  const ltcg0     = tx.ltcg_0pct_threshold      ?? (_isMfj ? LTCG_0PCT_THRESHOLD_MFJ : LTCG_0PCT_THRESHOLD_SINGLE)
  const ltcg15    = tx.ltcg_15pct_threshold     ?? (_isMfj ? LTCG_15PCT_THRESHOLD_MFJ : LTCG_15PCT_THRESHOLD_SINGLE)
  // Dividend figure used for tax-bracket stacking MUST be taxable-account-only
  // and AGI-relevant (ordinary + qualified, ROC excluded) — NOT portfolio-wide.
  // `income_analytics.portfolio_fwd_12m` sums forward income across ALL
  // accounts, including tax-advantaged Roth/Rollover IRA dividends (which
  // never touch any bracket) and return-of-capital (which isn't taxable).
  // `tx.annual_div_for_agi` is the same forward-12m estimate already computed
  // server-side, but scoped to taxable positions only with ROC stripped out —
  // that's the number that actually stacks against ordinary/LTCG brackets.
  const fwd_income = tx.annual_div_for_agi ?? tx.annual_div_total ?? inc?.portfolio_fwd_12m ?? 0

  // ── Future-year ordinary income — use actual projected data ────────────────────
  // We have the real numbers:
  //   fwd_income       = taxable, AGI-relevant forward 12m dividend income (annual_div_for_agi)
  //   annual_conv      = your annual Roth conversion target     (annual_conversion)
  // Both of these continue every year until the trad IRA is depleted.
  // This IS the correct future-year ordinary income — no proxies needed.
  const future_ordinary = fwd_income + annual_conv

  const bucket = computeBucketStatus(data)
  const bucket_required_months = bucket.annualSpending > 0
    ? (bucket.requiredBucket * 12) / bucket.annualSpending
    : 12

  // ceiling_room must treat a missing ceiling config (ceiling <= 0) the same
  // way `ordinary_ok` does elsewhere — as "unconstrained", not "zero room".
  // Math.max(0, 0 - proj_ord) would otherwise silently force ceiling_room to 0
  // (looks fully blocked) whenever bracket_ceiling_magi/target_bracket_ceiling
  // is absent, exactly the false-positive the fallback chain above exists to avoid.
  const eff_ceiling_for_room = ceiling > 50_000 ? ceiling : niit_thr * 1.72

  return {
    projected_ordinary: proj_ord,
    ceiling,
    ceiling_room: Math.max(0, eff_ceiling_for_room - proj_ord),
    niit_threshold: niit_thr,
    niit_headroom:  niit_hdroom,
    niit_already:   (tx.niit_applies ?? false) || proj_ord >= niit_thr,
    target_rate:    tx.target_bracket_rate ?? 22,
    ltcg_0_threshold: ltcg0,
    ltcg_15_threshold: ltcg15,
    std_ded,
    niit_rate:        tx.niit_rate ?? 0.038,
    fwd_income,
    annual_conv_target: annual_conv,
    future_ordinary,
    bucket_short: bucket.bucketShort,
    bucket_months: bucket.bucketMonths,
    bucket_required_months,
    bucket_shortfall: Math.max(0, bucket.requiredBucket - bucket.swvxxValue),
  }
}

// LTCG lives on its own 0/15/20% ladder — separate from the ordinary income
// brackets. It stacks on top of ordinary income + qualified dividends (after
// the standard deduction), never on top of other LTCG gains taxed elsewhere.
// `priorGainThisYear` is whatever LTCG has already been scheduled into the
// same year before this sell, so multiple sells in one year stack correctly
// against each other instead of each being priced against a $0 baseline.
function ltcgRate(magi_base: number, priorGainThisYear: number, gain: number, b: Budget): number {
  if (gain <= 0) return 0
  const stackStart = Math.max(0, magi_base - b.std_ded) + priorGainThisYear
  const stackEnd   = stackStart + gain
  const in0  = Math.max(0, Math.min(stackEnd, b.ltcg_0_threshold) - stackStart)
  const in15 = Math.max(0, Math.min(stackEnd, b.ltcg_15_threshold) - Math.max(stackStart, b.ltcg_0_threshold))
  const in20 = Math.max(0, stackEnd - Math.max(stackStart, b.ltcg_15_threshold))
  return (in0 * 0 + in15 * 0.15 + in20 * 0.20) / gain
}

function niitCost(magi_base: number, gain: number, b: Budget): number {
  if (gain <= 0) return 0  // losses reduce MAGI — no NIIT surcharge
  const after = magi_base + gain
  if (after <= b.niit_threshold) return 0
  return Math.min(gain, after - b.niit_threshold) * b.niit_rate
}

// ── Main plan engine ──────────────────────────────────────────────────────────────

function buildPlan(data: DashboardData, cashNeed: number = 0): Plan {
  const tx      = data.tax_data
  const budget  = buildBudget(data)
  const targets = data.taxable_target_analysis ?? []
  const lots_db = (tx.cost_basis_lots ?? {}) as Record<string, any>

  const today = new Date()
  const cy    = today.getFullYear()
  const cm    = today.getMonth() + 1

  // taxable_target_analysis from the server already includes ALL taxable positions —
  // both target symbols and non-target holdings (with implicit 0% target = full SELL).
  // No frontend augmentation needed; use targets directly.
  const augmented_targets = targets

  const to_buy  = augmented_targets.filter(t => (t.dollar_gap ?? 0) > 500)

  // ── Sync with Drawdown's Annual Decision Engine ───────────────────────────────
  // Pure rebalance-drift selling may not raise enough cash to fund this year's
  // planned taxable withdrawal (cashNeed = from_taxable). When it falls short,
  // draw the remainder from the next-most-overweight positions — same gap-pct
  // ranking already used for rebalancing, never a symbol/fund-type preference.
  const rebalance_to_sell  = augmented_targets.filter(t => (t.dollar_gap ?? 0) < -500)
  const rebalance_only_need = rebalance_to_sell.reduce((s, t) => s + Math.abs(t.dollar_gap ?? 0), 0)
  const withdrawal_shortfall = Math.max(0, cashNeed - rebalance_only_need)

  const to_sell = rebalance_to_sell.map(t => ({ ...t }))
  let remaining_shortfall = withdrawal_shortfall
  if (remaining_shortfall > 0) {
    const ranked = [...augmented_targets].sort((a, b) => (a.gap_pct ?? 0) - (b.gap_pct ?? 0))
    for (const t of ranked) {
      if (remaining_shortfall <= 0) break
      const value = t.current_value ?? 0
      if (value <= 0) continue
      const existing = to_sell.find(s => s.symbol === t.symbol)
      if (existing) {
        const already = Math.abs(existing.dollar_gap ?? 0)
        const room    = Math.max(0, value - already)
        const extra   = Math.min(room, remaining_shortfall)
        if (extra > 0) {
          existing.dollar_gap = (existing.dollar_gap ?? 0) - extra
          remaining_shortfall -= extra
        }
      } else if ((t.dollar_gap ?? 0) <= 500) {
        // Not already a clear BUY target — at target or only mildly overweight.
        const extra = Math.min(value, remaining_shortfall)
        if (extra > 0) {
          to_sell.push({ ...t, dollar_gap: -extra })
          remaining_shortfall -= extra
        }
      }
    }
  }
  const withdrawal_draw = withdrawal_shortfall - remaining_shortfall

  const empty_shared: SharedBudget = {
    ceiling: budget.ceiling > 50_000 ? budget.ceiling : budget.niit_threshold,
    ltcg_15_threshold: budget.ltcg_15_threshold,
    niit_threshold: budget.niit_threshold,
    std_ded: budget.std_ded,
    dividends_est: budget.fwd_income,
    room_after_divs: Math.max(0, (budget.ceiling > 50_000 ? budget.ceiling : budget.niit_threshold) - budget.fwd_income),
    conv_target: budget.annual_conv_target,
    ltcg_per_year: 0, years_to_rebalance: 0,
    total_ltcg_needed: 0, conv_fits: true, rebalance_years: [],
  }

  if (to_sell.length === 0 && to_buy.length === 0) {
    return {
      ok: false,
      reason_skip: 'Portfolio is already at target — no trades needed.',
      budget, shared: empty_shared, steps: [], waiting: [], alloc_rows: [],
      total_gain: 0, total_tax: 0, no_lot_data: false,
      today_is_bad: false, bad_month_reason: '',
      cash_need: cashNeed, rebalance_only_need, withdrawal_draw: 0,
    }
  }

  // ── Is today a bad month to trade? ────────────────────────────────────────────
  let today_is_bad     = false
  let bad_month_reason = ''

  // NOTE: NIIT being already-on is NOT a reason to block — it's a 3.8% surcharge
  // baked into every tax estimate.  We only block if:
  //   (a) ordinary already exceeds the BRACKET ceiling AND NIIT is on (selling now
  //       means 32%+ ordinary + 3.8% NIIT — meaningfully expensive), OR
  //   (b) it's mid-year and we can't yet know where full-year income lands.
  if (budget.ceiling_room <= 0 && budget.niit_already) {
    today_is_bad     = true
    bad_month_reason =
      `Ordinary income (${fmtD(budget.projected_ordinary)}) already exceeds the ` +
      `${budget.ceiling > 0 ? `${fmtD(budget.ceiling)} bracket ceiling` : 'target bracket ceiling'} AND the NIIT threshold — selling LTCG ` +
      `this year would add the 3.8% NIIT surcharge on top of the 32%+ bracket rate. ` +
      `Next January ordinary income resets to ~${fmtD(budget.future_ordinary)}, leaving ` +
      `~${fmtD(Math.max(0, budget.ltcg_15_threshold - Math.max(0, budget.future_ordinary - budget.std_ded)))} ` +
      `of room before LTCG crosses the ${fmtD(budget.ltcg_15_threshold)} 15%→20% threshold.` +
      (budget.bucket_short
        ? ` Cash bucket is also short: SWVXX covers ${budget.bucket_months.toFixed(1)} of ${budget.bucket_required_months.toFixed(0)} months — ` +
          `${fmtD(budget.bucket_shortfall)} more needed. Prioritize refilling it from this plan's sale proceeds.`
        : '')
  } else if (budget.niit_headroom < 5_000 && cm <= 10) {
    today_is_bad     = true
    bad_month_reason =
      `Only ${fmtD(budget.niit_headroom)} of NIIT headroom remains and it's only ` +
      `${MONTHS_LONG[cm - 1]}. More dividends will arrive before year-end — ` +
      `wait until December when you know exactly where full-year income lands.`
  } else if (cm >= 4 && cm <= 9) {
    today_is_bad     = true
    bad_month_reason =
      `It's ${MONTHS_LONG[cm - 1]} — too early to know where full-year income will land. ` +
      `Selling now risks overshooting the bracket when Q3/Q4 dividends arrive. ` +
      `The right window is October–December once the picture is clear.`
  }

  // ── Collect lot needs ─────────────────────────────────────────────────────────
  interface LotNeed {
    symbol: string; lot: CostLot; sell_val: number; gain: number
  }

  const ltcg_lots:     LotNeed[] = []
  const stcg_maturing: LotNeed[] = []
  let no_lot_data = false

  for (const tgt of to_sell) {
    const sym  = tgt.symbol
    const need = Math.abs(tgt.dollar_gap ?? 0)
    const sdat = lots_db[sym]

    if (!sdat?.lots?.length) {
      no_lot_data = true
      ltcg_lots.push({
        symbol: sym, gain: 0, sell_val: Math.round(need),
        lot: {
          is_ltcg: true, gain_loss: 0, quantity: 0,
          market_value: need, cost_basis: 0,
          days_to_lt: 0, lt_date: '', acquired_date: '',
          cost_per_share: 0, gain_loss_pct: 0,
        },
      })
      continue
    }

    let remaining = need
    const sorted  = [...sdat.lots as CostLot[]].sort((a, b) => {
      if (a.is_ltcg && !b.is_ltcg) return -1
      if (!a.is_ltcg && b.is_ltcg)  return  1
      return a.days_to_lt - b.days_to_lt
    })

    for (const lot of sorted) {
      if (remaining <= 0) break
      const sv   = Math.min(lot.market_value, remaining)
      const pct  = lot.market_value > 0 ? sv / lot.market_value : 1
      const gain = Math.round(lot.gain_loss * pct)

      if (lot.is_ltcg && gain >= 0) {
        // Skip loss lots (gain < 0) — no tax benefit to realizing a loss on an LTCG lot
        ltcg_lots.push({ symbol: sym, lot, sell_val: Math.round(sv), gain })
        remaining -= sv
      } else if (!lot.is_ltcg && lot.days_to_lt > 0) {
        // Include all STCG lots regardless of how long the wait — never drop them silently
        stcg_maturing.push({ symbol: sym, lot, sell_val: Math.round(sv), gain })
        remaining -= sv
      }
      // Lots that match neither branch (LTCG loss lots, or STCG lots with
      // days_to_lt <= 0) are skipped — do NOT decrement `remaining` for them,
      // or the symbol's sell need looks partially satisfied by shares that
      // were never actually scheduled to sell.
    }
  }

  // ── Unified NIIT budget — governs ALL sells (LTCG and matured STCG) ─────────────
  //
  // Rule: every year has a fixed NIIT headroom = niit_threshold − ordinary_income.
  // No sell (or split of a sell) may cause total_magi to exceed niit_threshold.
  // If a lot's gain doesn't fit in the current year, it automatically splits:
  //   • Take what fits this year → schedule remainder in January of next year.
  // This repeats until the full gain is placed. No warnings — the engine enforces it.

  const period_map: Map<string, { year: number; month: number; sells: SellItem[] }> = new Map()
  // Tracks how much LTCG gain has been committed to each period (year-month key).
  const niit_used: Map<string, number> = new Map()

  const ens = (y: number, m: number) => {
    const k = periodKey(y, m)
    if (!period_map.has(k)) period_map.set(k, { year: y, month: m, sells: [] })
    return period_map.get(k)!
  }

  // How much LTCG gain can still be realized in a given period before it
  // spills from the 15% LTCG bracket into the 20% one. LTCG lives on its own
  // 0/15/20% ladder — it stacks on top of ordinary income (after the standard
  // deduction), NOT against the ordinary bracket ceiling (that ceiling only
  // governs conversion room, see `budget.ceiling` / `ordinary_ok` below).
  // This is a SOFT per-year target, not a hard stop: tax law never blocks an
  // LTCG sale, it just prices the excess at 20% instead of 15% (see
  // `ltcgRate`). Rolling the remainder into next year is a spreading
  // preference the engine defaults to, not a correctness requirement.
  const ltcg15Avail = (y: number, m: number): number => {
    const magi_base   = y === cy ? budget.projected_ordinary : budget.future_ordinary
    const stack_start = Math.max(0, magi_base - budget.std_ded)
    const used        = niit_used.get(periodKey(y, m)) ?? 0
    return Math.max(0, budget.ltcg_15_threshold - stack_start - used)
  }

  const markUsed = (y: number, m: number, gain: number) => {
    const k = periodKey(y, m)
    niit_used.set(k, (niit_used.get(k) ?? 0) + gain)
  }

  // Advance to the next sell window:
  //   • Current year, before December → December (Q4, after income is known)
  //   • Current year already at December, or any future year → January of y+1
  //     (income resets, max headroom). Must key off the month we're already
  //     at, not just the year — otherwise a current-year lot that finds no
  //     room in December loops back to December again and gets dropped by
  //     the infinite-loop guard in scheduleLot instead of rolling into next
  //     year.
  const nextWindow = (y: number, m: number): [number, number] =>
    (y === cy && m < 12) ? [cy, 12] : [y + 1, 1]

  // Push a single sell slice into period (sy, sm)
  const pushSell = (
    sy: number, sm: number,
    symbol: string, lot: CostLot,
    shares: number, sv: number, gain: number,
    is_stcg_wait: boolean,
  ) => {
    const magi_base = sy === cy ? budget.projected_ordinary : budget.future_ordinary
    const prior_gain_this_year = niit_used.get(periodKey(sy, sm)) ?? 0
    const rate  = ltcgRate(magi_base, prior_gain_this_year, gain, budget)
    const niit  = niitCost(magi_base, gain, budget)
    const lot_frac = lot.market_value > 0 ? sv / lot.market_value : 1
    const cost_basis_total = lot.cost_basis > 0
      ? Math.round(lot.cost_basis * lot_frac)
      : Math.max(0, sv - gain)
    const gain_pct = cost_basis_total > 0
      ? Math.round((gain / cost_basis_total) * 100) : 0

    ens(sy, sm).sells.push({
      symbol, shares, proceeds: sv, gain, gain_pct,
      tax_est:          Math.round(Math.max(0, gain) * rate + niit),
      acquired_date:    lot.acquired_date ?? '',
      cost_basis_total,
      cost_per_sh:      lot.cost_per_share ?? 0,
      is_stcg_wait,
      lot_note: is_stcg_wait
        ? `Was STCG · matured ${lot.lt_date} · acquired ${lot.acquired_date ?? '—'}`
        : lot.acquired_date ? `Acquired ${lot.acquired_date}` : 'LTCG lot',
    })
    markUsed(sy, sm, Math.max(0, gain))
  }

  // Schedule a lot — splits across years if gain exceeds NIIT room
  const scheduleLot = (
    symbol: string, lot: CostLot,
    total_sv: number, total_gain: number,
    start_year: number, start_month: number,
    is_stcg_wait: boolean,
  ) => {
    let rem_gain = Math.max(0, total_gain)
    let rem_sv   = total_sv
    let [sy, sm] = [start_year, start_month]
    const MAX_ITER = 12  // safety cap

    for (let iter = 0; iter < MAX_ITER && (rem_gain > 1 || (total_gain <= 0 && rem_sv > 0)); iter++) {
      const avail = ltcg15Avail(sy, sm)

      if (total_gain <= 0) {
        // Loss lot or no lot data — no NIIT concern, schedule in first available period.
        // Selling a loss is beneficial (tax-loss harvesting); never block it.
        // Pass the actual (negative) gain so the UI shows the real P&L.
        const sh = lot.quantity > 0 && lot.market_value > 0
          ? Math.round((rem_sv / lot.market_value) * lot.quantity * 100) / 100 : 0
        pushSell(sy, sm, symbol, lot, sh, rem_sv, total_gain, is_stcg_wait)
        break
      }

      if (avail <= 0) {
        // No room this period — advance to next window
        const [ny, nm] = nextWindow(sy, sm)
        if (ny === sy && nm === sm) break  // avoid infinite loop
        ;[sy, sm] = [ny, nm]
        continue
      }

      const take_gain = Math.min(rem_gain, avail)
      const scale     = rem_gain > 0 ? take_gain / rem_gain : 1
      const take_sv   = Math.round(rem_sv * scale)
      const shares    = lot.quantity > 0 && lot.market_value > 0
        ? Math.round((take_sv / lot.market_value) * lot.quantity * 100) / 100 : 0

      pushSell(sy, sm, symbol, lot, shares, take_sv, take_gain, is_stcg_wait)

      rem_gain -= take_gain
      rem_sv   -= take_sv

      if (rem_gain > 1) {
        // Remainder goes to next year's January
        const [ny, nm] = [sy + 1, 1]
        ;[sy, sm] = [ny, nm]
      }
    }
  }

  // ── Schedule LTCG lots — start at Dec of current year ────────────────────────
  for (const ln of ltcg_lots) {
    const [sy, sm] = nextWindow(cy, 1)
    scheduleLot(ln.symbol, ln.lot, ln.sell_val, ln.gain, sy, sm, false)
  }

  // ── STCG maturing lots — waiting list + schedule at maturity ─────────────────
  const waiting: WaitingLot[] = []

  for (const ln of stcg_maturing) {
    const { symbol, lot, sell_val, gain } = ln
    if (!lot.lt_date) continue
    const mat      = new Date(lot.lt_date)
    // Sell the month AFTER the lot matures (confirms it's past 365 days)
    const [base_y, base_m] = addMonths(mat.getFullYear(), mat.getMonth() + 1, 1)
    const shares   = lot.quantity > 0 && lot.market_value > 0
      ? Math.round((sell_val / lot.market_value) * lot.quantity * 100) / 100 : 0

    // Determine the first period where this sell will actually go
    // (after NIIT check — might be deferred past maturity month)
    let first_sell_y = base_y, first_sell_m = base_m
    {
      let [ty, tm] = [base_y, base_m]
      for (let i = 0; i < 8; i++) {
        const avail = ltcg15Avail(ty, tm)
        if (gain <= 0 || avail > 0) { first_sell_y = ty; first_sell_m = tm; break }
        ;[ty, tm] = [ty + 1, 1]
      }
    }

    waiting.push({
      symbol, shares, proceeds_est: sell_val, gain_est: gain,
      maturity_date: lot.lt_date,
      sell_after: `Sell in ${periodLong(first_sell_y, first_sell_m)}`,
      days_left: lot.days_to_lt,
      lot_acq: lot.acquired_date ?? '—',
    })

    scheduleLot(symbol, lot, sell_val, gain, base_y, base_m, true)
  }


  // ── Build trade steps (sell → proceeds → buy per period) ─────────────────────
  const buy_remaining: Record<string, number> = {}
  for (const t of to_buy) buy_remaining[t.symbol] = Math.max(0, t.dollar_gap ?? 0)

  const steps: TradeStep[] = []
  let step_num = 0

  for (const key of [...period_map.keys()].sort()) {
    const ps       = period_map.get(key)!
    const { year, month, sells } = ps
    const proceeds = sells.reduce((s, r) => s + r.proceeds, 0)
    const gain     = sells.reduce((s, r) => s + Math.max(0, r.gain), 0)
    const tax      = sells.reduce((s, r) => s + r.tax_est, 0)

    // Allocate buys proportional to remaining needs, capped at proceeds
    const total_need = Object.values(buy_remaining).reduce((s, v) => s + Math.max(0, v), 0)
    const buys: BuyItem[] = []
    let alloc_total = 0

    if (total_need > 0 && proceeds > 0) {
      for (const sym of Object.keys(buy_remaining)) {
        const rem = buy_remaining[sym]
        if (rem <= 0) continue
        const proportion = rem / total_need
        const amt = Math.min(rem, Math.round(proceeds * proportion))
        if (amt < 50) continue
        const tgt = to_buy.find(t => t.symbol === sym)
        buys.push({
          symbol: sym, amount: amt,
          reason: `Underweight by ${tgt ? Math.abs(tgt.gap_pct ?? 0).toFixed(1) : '?'}% · needs ${fmtK(rem)} total`,
        })
        buy_remaining[sym] = Math.max(0, rem - amt)
        alloc_total += amt
      }
      // Rounding: give leftover to the largest buy
      const leftover = proceeds - alloc_total
      if (leftover > 1 && buys.length > 0) {
        buys.sort((a, b) => b.amount - a.amount)[0].amount += leftover
      }
    }

    // ── Full-year tax picture for this step ─────────────────────────────────────
    // Show every dollar of income so the user can verify nothing blows the bracket.

    const dividends  = budget.fwd_income         // portfolio dividends (same every year)
    const conversion = budget.annual_conv_target  // Roth conversion target (same every year)

    // total_ordinary for this year
    // Current year: use actual projection (YTD actuals included)
    // Future years: use our conservative estimate (max of direct est. and ceiling)
    const total_ordinary = year === cy ? budget.projected_ordinary : budget.future_ordinary

    // other_ordinary: anything in total_ordinary beyond div + conv
    // (e.g. salary, SS, rental — whatever made projected_ordinary > div+conv)
    const other_ordinary = Math.max(0, total_ordinary - dividends - conversion)

    const total_magi  = total_ordinary + gain
    const ordinary_ok = budget.ceiling <= 0 || total_ordinary <= budget.ceiling
    const niit_ok     = total_magi <= budget.niit_threshold
    const niit_already = budget.niit_already
    // 'over' only when the bracket ceiling is blown OR when LTCG itself crosses NIIT
    // (not when ordinary alone was already above NIIT — that's structural/expected)
    const status: YearPicture['status'] =
      !ordinary_ok                                     ? 'over'  :
      (!niit_ok && !niit_already)                      ? 'over'  :
      total_magi > budget.niit_threshold * 0.97 && !niit_already ? 'watch' :
      !ordinary_ok                                     ? 'watch' :
      niit_already                                     ? 'watch' :
      'safe'

    const year_picture: YearPicture = {
      year, dividends, conversion, other_ordinary,
      total_ordinary, ltcg_this_step: gain, total_magi,
      ceiling:        budget.ceiling,
      niit_threshold: budget.niit_threshold,
      ordinary_ok, niit_ok, niit_already, status,
    }

    const niit_room_this_year = Math.max(0, budget.niit_threshold - total_ordinary)
    const why_this_month = (year === cy && month === 12)
      ? `December is the right window: full-year income is known, Q4 estimated ` +
        `taxes aren't due until January 15 next year. NIIT headroom for ${year}: ` +
        `${fmtD(budget.niit_threshold)} − ${fmtD(total_ordinary)} ordinary = ` +
        `${fmtD(niit_room_this_year)} → realizing ${fmtD(gain)} LTCG stays ${niit_ok ? 'under' : ' over'} threshold.`
      : month === 1
      ? `January ${year}: year starts fresh. Ordinary income = ${fmtD(dividends)} dividends ` +
        `+ ${fmtD(conversion)} Roth conversion = ${fmtD(total_ordinary)} projected. ` +
        `NIIT headroom: ${fmtD(niit_room_this_year)} for LTCG.`
      // Sells are scheduled the month AFTER a lot matures (confirms it's past 365
      // days — see scheduleLot/stcg_maturing above), so by the time this step
      // executes the lot matured LAST month, not "this month".
      : `${periodLong(year, month)}: STCG lot matured last month — now qualifies for ` +
        `the long-term rate. Full-year ordinary: ${fmtD(total_ordinary)}, ` +
        `NIIT headroom: ${fmtD(niit_room_this_year)}.`

    step_num++
    steps.push({
      step_num, year, month,
      label: periodLong(year, month),
      sells, buys, total_proceeds: proceeds, total_gain: gain, total_tax: tax,
      tax_due_date: `April 15, ${year + 1}`,
      why_this_month, year_picture,
    })
  }

  const total_gain_val = steps.reduce((s, p) => s + p.total_gain, 0)
  const total_ltcg_needed = ltcg_lots.reduce((s, l) => s + Math.max(0, l.gain), 0)
    + stcg_maturing.reduce((s, l) => s + Math.max(0, l.gain), 0)

  // Ordinary bracket ceiling (with fallback) — governs conversion room ONLY.
  // LTCG never competes with this; it has its own ladder (below).
  const eff_ordinary_ceil = budget.ceiling > 50_000 ? budget.ceiling : budget.niit_threshold * 1.72
  const room_after_divs   = Math.max(0, eff_ordinary_ceil - budget.fwd_income)
  const conv_fits         = budget.annual_conv_target <= room_after_divs

  // LTCG capacity per year = room left before the stack (future ordinary
  // income, after the standard deduction) crosses the 15%→20% LTCG threshold.
  // Governed by the LTCG ladder, NOT the ordinary bracket ceiling.
  const ltcg_per_year = Math.max(
    0, budget.ltcg_15_threshold - Math.max(0, budget.future_ordinary - budget.std_ded),
  )

  const rebalance_years   = steps.map(s => s.year).filter((v, i, a) => a.indexOf(v) === i)
  const years_to_rebalance = ltcg_per_year > 0
    ? Math.ceil(total_ltcg_needed / ltcg_per_year) : 99
  // The scheduled steps only ever cover a bounded look-ahead window — when the
  // simple division estimate needs more years than that window holds, the
  // displayed "completes" dates are a partial schedule, not the full payoff.
  const is_partial_schedule = rebalance_years.length > 0 && years_to_rebalance > rebalance_years.length

  const shared: SharedBudget = {
    ceiling:          eff_ordinary_ceil,
    ltcg_15_threshold: budget.ltcg_15_threshold,
    niit_threshold:   budget.niit_threshold,
    std_ded:          budget.std_ded,
    dividends_est:    budget.fwd_income,
    room_after_divs,
    conv_target:      budget.annual_conv_target,
    ltcg_per_year,
    years_to_rebalance,
    total_ltcg_needed,
    conv_fits,
    rebalance_years,
  }

  // ── Allocation rows ───────────────────────────────────────────────────────────
  const alloc_rows: AllocationRow[] = augmented_targets
    .filter(t => Math.abs(t.dollar_gap ?? 0) > 200)
    .map(t => {
      const action: 'SELL' | 'BUY' | 'OK' =
        (t.dollar_gap ?? 0) < -200 ? 'SELL' :
        (t.dollar_gap ?? 0) >  200 ? 'BUY' : 'OK'
      const last_step = steps.filter(s =>
        s.sells.some(x => x.symbol === t.symbol) ||
        s.buys.some(x => x.symbol === t.symbol)
      ).pop()
      const done_by_base = last_step?.label
        ?? (waiting.some(w => w.symbol === t.symbol) ? 'After STCG matures' : '—')
      return {
        symbol:      t.symbol,
        // current_weight/target_weight/gap_pct are fractions (0–1) from the backend;
        // pctStr() just appends '%' without scaling, so convert to percent here.
        current_pct: (t.current_weight ?? 0) * 100,
        target_pct:  (t.target_weight  ?? 0) * 100,
        gap_pct:     (t.gap_pct        ?? 0) * 100,
        dollar_gap:  t.dollar_gap     ?? 0,
        action,
        done_by: (is_partial_schedule && last_step) ? `${done_by_base}*` : done_by_base,
      }
    })

  return {
    ok: true, reason_skip: '', budget, shared, steps, waiting, alloc_rows,
    total_gain: total_gain_val,
    total_tax:  steps.reduce((s, p) => s + p.total_tax, 0),
    no_lot_data, today_is_bad, bad_month_reason,
    cash_need: cashNeed, rebalance_only_need, withdrawal_draw,
  }
}

// ── UI colours ────────────────────────────────────────────────────────────────────

const C = {
  green:  'var(--green)',
  red:    'var(--red)',
  amber:  'var(--amber)',
  blue:   'var(--blue)',
  text:   'var(--text)',
  muted:  'var(--text2)',
  surf:   'var(--surface)',
}

// ── Card wrapper ──────────────────────────────────────────────────────────────────

function Card({ children, accent, style }: {
  children: React.ReactNode; accent?: string; style?: React.CSSProperties
}) {
  return (
    <div style={{
      background: C.surf,
      border: `1px solid ${accent ? accent + '33' : 'var(--fd-hairline)'}`,
      borderLeft: accent ? `3px solid ${accent}` : undefined,
      borderRadius: 0, padding: '14px 16px',
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ text, color = C.muted }: { text: string; color?: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
      letterSpacing: '1px', color, marginBottom: 8 }}>{text}</div>
  )
}

// ── Shared annual budget — the 360° constraint view ──────────────────────────────
// Shows how bracket-ceiling headroom is split between conversion and LTCG rebalancing.
// The governing constraint is the bracket ceiling (e.g. $538K), not the NIIT threshold.
// NIIT ($250K) is a separate surcharge threshold shown as a marker, not the scale.

function SharedBudgetCard({ s }: { s: SharedBudget }) {
  const bar_max = (s.ceiling > 50_000 ? s.ceiling : s.niit_threshold) * 1.05
  const w = (v: number) => `${Math.min(100, (v / bar_max) * 100).toFixed(2)}%`
  const ltcg_color = s.ltcg_per_year > 0 ? C.green : C.red
  const conv_ok    = s.conv_fits

  return (
    <Card accent={C.blue}>
      <SectionLabel text="Annual income budget — all sources connected" color={C.blue} />

      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, marginBottom: 12 }}>
        Dividends and conversion share the ordinary bracket ceiling ({fmtD(s.ceiling > 50_000 ? s.ceiling : s.niit_threshold)}) —
        dividends come first (you can't control them), conversion is next.
        LTCG has its own separate 0/15/20% ladder that stacks on top of that ordinary income —
        it never competes for the bracket ceiling above. What's shown as "LTCG headroom" below is the room
        left before LTCG crosses the {fmtD(s.ltcg_15_threshold)} threshold into the 20% zone.
        The NIIT threshold ({fmtD(s.niit_threshold)}) is a separate 3.8% surcharge line — shown as a marker below.
      </div>

      {/* Stacked allocation bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ position: 'relative', height: 28, borderRadius: 0,
          background: 'var(--fd-card)', overflow: 'hidden' }}>
          {/* Dividends */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
            width: w(s.dividends_est),
            background: 'var(--blue)', opacity: 0.85,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {s.dividends_est / bar_max > 0.08 && (
              <span style={{ fontSize: 12, color: 'var(--fd-ink)', fontWeight: 500 }}>
                Div
              </span>
            )}
          </div>
          {/* Conversion */}
          <div style={{ position: 'absolute', left: w(s.dividends_est), top: 0, bottom: 0,
            width: w(s.conv_target),
            background: C.blue, opacity: 0.85,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {s.conv_target / bar_max > 0.06 && (
              <span style={{ fontSize: 12, color: 'var(--fd-ink)', fontWeight: 500 }}>
                Conv
              </span>
            )}
          </div>
          {/* LTCG per year */}
          {s.ltcg_per_year > 0 && (
            <div style={{ position: 'absolute',
              left: w(s.dividends_est + s.conv_target), top: 0, bottom: 0,
              width: w(s.ltcg_per_year),
              background: C.green, opacity: 0.8,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {s.ltcg_per_year / bar_max > 0.05 && (
                <span style={{ fontSize: 12, color: 'var(--fd-ink)', fontWeight: 500 }}>
                  LTCG
                </span>
              )}
            </div>
          )}
        </div>
        {/* NIIT threshold marker line */}
        <div style={{ position: 'relative', height: 16 }}>
          <div style={{ position: 'absolute',
            left: `calc(${w(s.niit_threshold)} - 1px)`, top: 0, bottom: 0,
            width: 2, background: C.red, opacity: 0.8 }} />
          <span style={{ position: 'absolute', left: w(s.niit_threshold),
            top: 2, fontSize: 12, color: C.red, whiteSpace: 'nowrap',
            transform: 'translateX(-50%)' }}>
            NIIT ${(s.niit_threshold / 1000).toFixed(0)}K
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
          <span style={{ fontSize: 12, color: 'var(--blue)' }}>
            ■ Dividends {fmtK(s.dividends_est)} — estimated, not controllable
          </span>
          <span style={{ fontSize: 12, color: C.blue }}>
            ■ Roth conversion {fmtK(s.conv_target)} — your annual target
          </span>
          <span style={{ fontSize: 12, color: ltcg_color }}>
            ■ LTCG headroom {fmtK(s.ltcg_per_year)}/yr — what's left for rebalancing
          </span>
          {/* NIIT note — NIIT 3.8% applies to all NII (divs + LTCG) above $250K */}
          {s.dividends_est + s.ltcg_per_year > 0 && (
            <span style={{ fontSize: 12, color: C.muted }}>
              NIIT 3.8% applies to all NII above {fmtD(s.niit_threshold)} threshold ·
              {' '}{fmtD(s.dividends_est)} div + {fmtD(s.ltcg_per_year)} LTCG
              = {fmtD(s.dividends_est + s.ltcg_per_year)} NII × 3.8%
              = ~{fmtD(Math.round((s.dividends_est + s.ltcg_per_year) * 0.038))}/yr
            </span>
          )}
        </div>
      </div>

      {/* Three-column breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr 1px 1fr', gap: '0 12px' }}>

        {/* Col 1: Dividends */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)',
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            Dividends (est.)
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
            fontWeight: 500, color: 'var(--blue)', marginBottom: 4 }}>
            {fmtD(s.dividends_est)}
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            Taxable-account forward 12m income (AGI-relevant, ROC excluded). This
            arrives every year regardless — you can't defer it. It's the baseline
            that eats into your NIIT room first.
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6,
            fontStyle: 'italic' }}>
            Source: annual_div_for_agi
          </div>
        </div>

        <div style={{ background: 'var(--fd-card)', borderRadius: 0 }} />

        {/* Col 2: Conversion */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.blue,
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            Roth Conversion
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
            fontWeight: 500, color: C.blue, marginBottom: 4 }}>
            {fmtD(s.conv_target)}/yr
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            Your annual conversion target. Spreads across multiple years until the
            traditional IRA is depleted. This is a controllable lever — if LTCG
            headroom is too small, reduce the conversion target that year.
          </div>
          {!conv_ok && (
            <div style={{ marginTop: 6, padding: '4px 6px', borderRadius: 0,
              background: C.red + '12', border: `1px solid ${C.red}`,
              fontSize: 12, color: C.red, lineHeight: 1.5 }}>
               Conversion target ({fmtK(s.conv_target)}) exceeds room after
              dividends ({fmtK(s.room_after_divs)}). Reduce conversion by{' '}
              {fmtK(s.conv_target - s.room_after_divs)} or accept NIIT on gains.
            </div>
          )}
        </div>

        <div style={{ background: 'var(--fd-card)', borderRadius: 0 }} />

        {/* Col 3: LTCG headroom */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: ltcg_color,
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            LTCG Headroom
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
            fontWeight: 500, color: ltcg_color, marginBottom: 4 }}>
            {fmtD(s.ltcg_per_year)}/yr
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            {fmtD(s.ltcg_15_threshold)} LTCG 15%→20% threshold
            {' − '}{fmtK(s.dividends_est)} div
            {' − '}{fmtK(s.conv_target)} conv
            {' + '}{fmtK(s.std_ded)} std ded
            {' = '}<strong style={{ color: ltcg_color }}>{fmtK(s.ltcg_per_year)}</strong>
            {' '}max LTCG per year to stay at 15%.{' '}
            {(() => {
              // Use actual scheduled years (rebalance_years.length), not the math
              // estimate (years_to_rebalance) — the estimate overestimates when
              // multiple lots are sold in one year, so it can diverge from the
              // simulated schedule's real date range.
              const actualYrs = s.rebalance_years.length > 0 ? s.rebalance_years.length : s.years_to_rebalance
              return s.total_ltcg_needed > 0 && s.ltcg_per_year > 0
                ? `At this rate, the rebalance takes ~${actualYrs} year${actualYrs > 1 ? 's' : ''}.`
                : s.ltcg_per_year <= 0
                ? 'No room for LTCG this year — conversion fills all headroom.'
                : ''
            })()}
          </div>
          {s.ltcg_per_year > 0 && s.total_ltcg_needed > 0 && (() => {
            const actualYrs = s.rebalance_years.length > 0 ? s.rebalance_years.length : s.years_to_rebalance
            const isPartial = s.rebalance_years.length > 0 && s.years_to_rebalance > s.rebalance_years.length
            return (
              <div style={{ marginTop: 6, padding: '4px 6px', borderRadius: 0,
                background: ltcg_color + '10',
                fontSize: 12, color: ltcg_color, fontWeight: 500 }}>
                Total gain to realize: {fmtD(s.total_ltcg_needed)}
                {' '}÷ {fmtD(s.ltcg_per_year)}/yr
                {' '}= {actualYrs} yr{actualYrs > 1 ? 's' : ''}
                {s.rebalance_years.length > 0
                  ? ` (${s.rebalance_years[0]}–${s.rebalance_years[s.rebalance_years.length - 1]})`
                  : ''}
                {isPartial ? ` — partial schedule, full payoff needs ~${s.years_to_rebalance} yrs` : ''}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Constraint equation */}
      <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 0,
        background: 'var(--fd-card)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.muted }}>Every year:</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
          color: 'var(--blue)', fontWeight: 500 }}>{fmtK(s.dividends_est)}</span>
        <span style={{ fontSize: 12, color: C.muted }}>div</span>
        <span style={{ fontSize: 12, color: C.muted }}>+</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
          color: C.blue, fontWeight: 500 }}>{fmtK(s.conv_target)}</span>
        <span style={{ fontSize: 12, color: C.muted }}>conv</span>
        <span style={{ fontSize: 12, color: C.muted }}>+</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
          color: ltcg_color, fontWeight: 500 }}>{fmtK(s.ltcg_per_year)}</span>
        <span style={{ fontSize: 12, color: C.muted }}>LTCG</span>
        <span style={{ fontSize: 12, color: C.muted }}>=</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
          color: s.ltcg_per_year > 0 ? C.green : C.red, fontWeight: 500 }}>
          {fmtK(s.dividends_est + s.conv_target + s.ltcg_per_year)}
        </span>
        <span style={{ fontSize: 12, color: C.muted }}>MAGI</span>
        <span style={{ fontSize: 12, color: C.muted, marginLeft: 4 }}>
          {(() => {
            // Positive headroom = still under NIIT; negative = over NIIT
            const headroom = s.niit_threshold - s.dividends_est - s.conv_target - s.ltcg_per_year
            return s.ltcg_per_year > 0
              ? `(${headroom > 0 ? `${fmtK(headroom)} NIIT headroom` : headroom === 0 ? 'at NIIT threshold' : `${fmtK(Math.abs(headroom))} NIIT surcharge base`})`
              : '(at NIIT threshold — structural, NIIT on all NII)'
          })()}
        </span>
      </div>
    </Card>
  )
}

// ── Allocation diff table ─────────────────────────────────────────────────────────

function AllocationTable({ rows }: { rows: AllocationRow[] }) {
  const hasPartial = rows.some(r => r.done_by.endsWith('*'))
  return (
    <Card>
      <SectionLabel text="Where you are vs. where you need to be" />
      {hasPartial && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>
          * within the displayed schedule window — see LTCG Headroom for full payoff timeline
        </div>
      )}
      <div style={{ display: 'grid',
        gridTemplateColumns: '80px 60px 60px 60px 80px 80px 1fr',
        gap: '0 8px', paddingBottom: 4,
        borderBottom: '1px solid var(--fd-hairline)' }}>
        {['SYMBOL','NOW','TARGET','GAP %','AMOUNT','ACTION','COMPLETES'].map(h => (
          <span key={h} style={{ fontSize: 12, color: C.muted,
            textTransform: 'uppercase', letterSpacing: '0.3px' }}>{h}</span>
        ))}
      </div>
      {rows.map((r, i) => {
        const ac = r.action === 'SELL' ? C.red : r.action === 'BUY' ? C.green : C.muted
        return (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '80px 60px 60px 60px 80px 80px 1fr',
            gap: '0 8px', padding: '7px 0',
            borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, fontWeight: 500,
              fontFamily: 'var(--font-mono)', color: C.text }}>{r.symbol}</span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: C.muted }}>
              {pctStr(r.current_pct)}
            </span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: C.muted }}>
              {pctStr(r.target_pct)}
            </span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
              color: r.gap_pct > 0 ? C.green : C.red }}>
              {r.gap_pct > 0 ? '+' : ''}{pctStr(r.gap_pct)}
            </span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
              color: r.dollar_gap > 0 ? C.green : C.red }}>
              {r.dollar_gap > 0 ? '+' : ''}{fmtK(r.dollar_gap)}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: ac,
              border: `1px solid ${ac}`, borderRadius: 0, padding: '2px 6px',
              display: 'inline-block', textAlign: 'center',
            }}>
              {r.action === 'SELL' ? '▼ SELL' : r.action === 'BUY' ? '▲ BUY' : '✓ OK'}
            </span>
            <span style={{ fontSize: 12, color: C.amber, fontFamily: 'var(--font-mono)' }}>
              {r.done_by}
            </span>
          </div>
        )
      })}
    </Card>
  )
}

// ── "Don't trade yet" banner ──────────────────────────────────────────────────────

function NotNowBanner({ reason }: { reason: string }) {
  return (
    <Card accent={C.red}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}></span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.red, marginBottom: 5 }}>
            Do not trade this month
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
            {reason}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Full-year tax picture card ─────────────────────────────────────────────────────
// Shows every dollar of income this year so you can see exactly why the LTCG
// amount is what it is and confirm nothing blows past the bracket or NIIT.

function YearPictureCard({ p, is_current_year }: { p: YearPicture; is_current_year: boolean }) {
  const bar_max     = Math.max(p.niit_threshold * 1.08, p.total_magi * 1.08, 1)
  const w           = (v: number) => `${Math.min(100, (v / bar_max) * 100).toFixed(2)}%`
  const statusColor = p.status === 'safe' ? C.green : p.status === 'watch' ? C.amber : C.red
  const statusLabel = p.status === 'safe' ? ' Safe' : p.status === 'watch' ? (p.niit_already ? '○ NIIT active (expected)' : ' Watch') : ' Over limit'
  const margin_left = p.niit_threshold - p.total_magi
  const niit_room   = Math.max(0, p.niit_threshold - p.total_ordinary)

  return (
    <div style={{ padding: '12px 14px', borderRadius: 0, marginBottom: 14,
      background: `${statusColor}08`, border: `1px solid ${statusColor}` }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
        paddingBottom: 8, borderBottom: `1px solid ${statusColor}` }}>
        <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '0.8px', color: statusColor }}>
          {p.year} complete income picture
        </span>
        {!is_current_year && (
          <span style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
            (estimated)
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 500, color: statusColor,
          marginLeft: 'auto', padding: '2px 8px',
          border: `1px solid ${statusColor}`, borderRadius: 0 }}>
          {statusLabel}
        </span>
      </div>

      {/* Stacked bar — every dollar of income visualised */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ position: 'relative', height: 22, borderRadius: 0,
          background: 'var(--fd-card)', overflow: 'hidden' }}>
          {/* Dividends */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
            width: w(p.dividends),
            background: 'var(--blue)', opacity: 0.9 }} />
          {/* Conversion (after dividends) */}
          <div style={{ position: 'absolute', left: w(p.dividends), top: 0, bottom: 0,
            width: w(p.conversion),
            background: C.blue, opacity: 0.9 }} />
          {/* Other ordinary (after div+conv) */}
          {p.other_ordinary > 0 && (
            <div style={{ position: 'absolute',
              left: w(p.dividends + p.conversion), top: 0, bottom: 0,
              width: w(p.other_ordinary),
              background: 'var(--fd-ink)', opacity: 0.85 }} />
          )}
          {/* LTCG gain (after all ordinary) */}
          <div style={{ position: 'absolute', left: w(p.total_ordinary), top: 0, bottom: 0,
            width: w(p.ltcg_this_step),
            background: C.green, opacity: 0.8 }} />
        </div>

        {/* Threshold markers (rendered outside bar so they overflow) */}
        <div style={{ position: 'relative', height: 14 }}>
          {p.ceiling > 0 && p.ceiling < bar_max && (
            <div style={{ position: 'absolute',
              left: `calc(${w(p.ceiling)} - 1px)`, top: 0, bottom: 0,
              width: 2, background: C.amber, opacity: 0.9 }} />
          )}
          <div style={{ position: 'absolute',
            left: `calc(${w(p.niit_threshold)} - 1px)`, top: 0, bottom: 0,
            width: 2, background: C.red, opacity: 0.9 }} />
          {/* Labels */}
          {p.ceiling > 0 && p.ceiling < bar_max && (
            <span style={{ position: 'absolute',
              left: w(p.ceiling), top: 1,
              fontSize: 12, color: C.amber, whiteSpace: 'nowrap',
              transform: 'translateX(-50%)' }}>
              Ceiling
            </span>
          )}
          <span style={{ position: 'absolute',
            left: w(p.niit_threshold), top: 1,
            fontSize: 12, color: C.red, whiteSpace: 'nowrap',
            transform: 'translateX(-50%)' }}>
            NIIT
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
          <span style={{ fontSize: 12, color: 'var(--blue)' }}>■ Dividends</span>
          <span style={{ fontSize: 12, color: C.blue }}>■ Roth conv</span>
          {p.other_ordinary > 0 && (
            <span style={{ fontSize: 12, color: 'var(--fd-ink)' }}>■ Other income</span>
          )}
          <span style={{ fontSize: 12, color: C.green }}>■ LTCG sell</span>
          {p.ceiling > 0 && (
            <span style={{ fontSize: 12, color: C.amber }}>│ Bracket ceiling</span>
          )}
          <span style={{ fontSize: 12, color: C.red }}>│ NIIT threshold</span>
        </div>
      </div>

      {/* Two-column breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>

        {/* Left: ordinary income breakdown */}
        <div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 500,
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
            Ordinary income {!is_current_year ? '(est.)' : '(projected)'}
          </div>
          {[
            ['Portfolio dividends', fmtD(p.dividends), 'var(--blue)',
              is_current_year ? 'YTD + remaining est.' : 'forward 12m estimate'],
            ['Roth conversion', fmtD(p.conversion), C.blue,
              is_current_year ? 'YTD + remaining target' : 'annual target (continues)'],
            ...(p.other_ordinary > 0
              ? [['Other income', fmtD(p.other_ordinary), 'var(--fd-ink)', 'salary, SS, etc.']]
              : []),
          ].map(([label, val, color, note]) => (
            <div key={label as string} style={{ display: 'flex',
              justifyContent: 'space-between', alignItems: 'baseline',
              padding: '3px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
              <div>
                <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
                <span style={{ fontSize: 12, color: C.muted, marginLeft: 4,
                  fontStyle: 'italic' }}>{note}</span>
              </div>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                fontWeight: 500, color: color as string }}>{val}</span>
            </div>
          ))}
          {/* Subtotal ordinary */}
          <div style={{ display: 'flex', justifyContent: 'space-between',
            padding: '4px 0', marginTop: 2,
            borderTop: `1px solid ${p.ordinary_ok ? C.green : C.red}` }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>
              = Ordinary subtotal
            </span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              color: p.ordinary_ok ? C.text : C.red }}>
              {fmtD(p.total_ordinary)}
            </span>
          </div>
          {p.ceiling > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between',
              padding: '2px 0 4px' }}>
              <span style={{ fontSize: 12, color: C.muted }}>
                Bracket ceiling ({p.ordinary_ok ? 'under ' : 'OVER '})
              </span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                color: p.ordinary_ok ? C.muted : C.amber }}>
                {fmtD(p.ceiling)}
              </span>
            </div>
          )}
        </div>

        {/* Right: MAGI stack + NIIT check */}
        <div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 500,
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
            NIIT check (MAGI total)
          </div>
          {[
            ['Ordinary income (above)', fmtD(p.total_ordinary), C.muted],
            ['+ LTCG from this sell', fmtD(p.ltcg_this_step), C.green],
          ].map(([label, val, color]) => (
            <div key={label as string} style={{ display: 'flex',
              justifyContent: 'space-between', padding: '3px 0',
              borderBottom: '1px solid var(--fd-hairline)' }}>
              <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                fontWeight: 500, color: color as string }}>{val}</span>
            </div>
          ))}
          {/* MAGI total */}
          <div style={{ display: 'flex', justifyContent: 'space-between',
            padding: '4px 0', marginTop: 2,
            borderTop: `1px solid ${p.niit_ok ? C.green : p.niit_already ? C.amber : C.red}` }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>
              = Total MAGI
            </span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
              fontWeight: 500, color: p.niit_ok ? C.green : p.niit_already ? C.amber : C.red }}>
              {fmtD(p.total_magi)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between',
            padding: '2px 0' }}>
            <span style={{ fontSize: 12, color: C.muted }}>NIIT threshold</span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
              color: C.muted }}>{fmtD(p.niit_threshold)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between',
            padding: '3px 0',
            borderTop: '1px solid var(--fd-hairline)' }}>
            <span style={{ fontSize: 12, fontWeight: 500,
              color: p.niit_ok ? C.green : p.niit_already ? C.amber : C.red }}>
              {p.niit_ok ? 'NIIT headroom' : p.niit_already ? 'NIIT applies (structural)' : ' NIIT exceeded by'}
            </span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
              fontWeight: 500, color: p.niit_ok ? C.green : p.niit_already ? C.amber : C.red }}>
              {fmtD(Math.abs(margin_left))}
            </span>
          </div>
          <div style={{ marginTop: 5, padding: '3px 6px', borderRadius: 0,
            background: 'var(--fd-card)',
            fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            {p.niit_already
              ? <>NIIT already active · incremental LTCG ({fmtD(p.ltcg_this_step)}) incurs 15% + 3.8% = 18.8% effective rate</>
              : <>NIIT room before sell: {fmtD(niit_room)} → sell {fmtD(p.ltcg_this_step)} → {fmtD(margin_left)} left</>
            }
          </div>
        </div>
      </div>

      {/* Callout messages */}
      {!is_current_year && (
        <div style={{ marginTop: 8, padding: '5px 8px', borderRadius: 0,
          background: 'var(--fd-card)',
          fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
           Estimates: dividends use portfolio forward 12m income.
          Conversion uses your annual target. If either changes, the LTCG headroom shifts.
          Review before executing.
        </div>
      )}
      {!p.ordinary_ok && (
        <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 0,
          background: C.amber + '10', border: `1px solid ${C.amber}`,
          fontSize: 12, color: C.amber, lineHeight: 1.6 }}>
           Ordinary income ({fmtD(p.total_ordinary)}) exceeds the bracket ceiling
          ({fmtD(p.ceiling)}) by {fmtD(p.total_ordinary - p.ceiling)}.
          This is from dividends + conversion — the LTCG sell doesn't change your ordinary
          bracket. Consider trimming the conversion target if you want to stay under.
        </div>
      )}
      {!p.niit_ok && p.niit_already && (
        <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 0,
          background: C.amber + '0d', border: `1px solid ${C.amber}`,
          fontSize: 12, color: C.amber, lineHeight: 1.6 }}>
          ○ NIIT applies every year — your ordinary income ({fmtD(p.total_ordinary)}) already
          exceeds the {fmtD(p.niit_threshold)} threshold before this trade.
          This is expected. A 3.8% NIIT surcharge on the {fmtD(p.ltcg_this_step)} LTCG gain
          is already included in the tax estimate above.
        </div>
      )}
      {!p.niit_ok && !p.niit_already && (
        <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 0,
          background: C.red + '10', border: `1px solid ${C.red}`,
          fontSize: 12, color: C.red, lineHeight: 1.6 }}>
           Total MAGI ({fmtD(p.total_magi)}) exceeds the NIIT threshold by{' '}
          {fmtD(p.total_magi - p.niit_threshold)} — 3.8% NIIT applies to the excess.
          Reduce this step's LTCG sell to minimize the surcharge, or defer to the next year.
        </div>
      )}
      {p.niit_ok && margin_left > 0 && margin_left < p.niit_threshold * 0.04 && (
        <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 0,
          background: C.amber + '0d', border: `1px solid ${C.amber}`,
          fontSize: 12, color: C.amber, lineHeight: 1.6 }}>
           Only {fmtD(margin_left)} before NIIT threshold — one unexpected distribution
          could trigger the 3.8% surcharge. Consider selling {fmtD(margin_left * 0.5)} less
          as a cushion to minimize NIIT exposure.
        </div>
      )}
      {p.niit_ok && margin_left >= p.niit_threshold * 0.04 && (
        <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 0,
          background: C.green + '0c',
          fontSize: 12, color: C.green }}>
           {fmtD(margin_left)} NIIT headroom for {p.year} — NIIT minimized at this income level.
        </div>
      )}
    </div>
  )
}

// ── Group consecutive annual steps into runs for collapsing ───────────────────────

type StepGroup =
  | { type: 'single'; step: TradeStep }
  | { type: 'group';  steps: TradeStep[] }

function groupSteps(steps: TradeStep[]): StepGroup[] {
  const result: StepGroup[] = []
  let i = 0
  while (i < steps.length) {
    let j = i + 1
    while (
      j < steps.length &&
      steps[j].year === steps[j - 1].year + 1 &&
      steps[j].month === steps[i].month
    ) { j++ }
    if (j - i >= 3) {
      result.push({ type: 'group', steps: steps.slice(i, j) })
      i = j
    } else {
      result.push({ type: 'single', step: steps[i] })
      i++
    }
  }
  return result
}

function RepeatingPhaseCard({ steps, total_steps }: { steps: TradeStep[]; total_steps: number }) {
  const [expanded, setExpanded] = useState(false)
  const first = steps[0]
  const last  = steps[steps.length - 1]
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const totalGain = steps.reduce((s, st) => s + st.total_gain, 0)
  const totalTax  = steps.reduce((s, st) => s + st.total_tax, 0)

  return (
    <>
      {/* Show the first step in full */}
      <TradeStepCard step={first} total_steps={total_steps} />

      {/* Collapsible repeating-phase banner */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer', margin: '4px 0', padding: '8px 12px', borderRadius: 0,
          background: 'var(--fd-card)', border: '0.5px dashed var(--fd-hairline)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 500, color: C.amber }}>
            ↺ Repeating Annual Phase
          </span>
          <span style={{ fontSize: 12, color: C.muted, marginLeft: 10 }}>
            {MONTHS_SHORT[first.month - 1]} {first.year + 1} – {MONTHS_SHORT[last.month - 1]} {last.year}
            {' '}· {steps.length - 1} step{steps.length - 1 > 1 ? 's' : ''}
            {' '}· same sell schedule each year
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase' }}>Total gain</div>
            <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: C.green }}>
              {fmtD(totalGain - first.total_gain)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase' }}>Est. tax</div>
            <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: C.amber }}>
              ~{fmtD(totalTax - first.total_tax)}
            </div>
          </div>
          <span style={{ fontSize: 12, color: C.amber }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded: show each remaining step */}
      {expanded && steps.slice(1).map(s => (
        <TradeStepCard key={`${s.year}-${s.month}`} step={s} total_steps={total_steps} />
      ))}
    </>
  )
}

// ── Single numbered trade step ────────────────────────────────────────────────────

function TradeStepCard({ step, total_steps }: { step: TradeStep; total_steps: number }) {
  const buy_total = step.buys.reduce((s, b) => s + b.amount, 0)

  return (
    <Card>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
        paddingBottom: 10, borderBottom: '1px solid var(--fd-hairline)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 3, flexShrink: 0,
          background: C.amber + '1a', border: `2px solid ${C.amber}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: C.amber }}>
          {step.step_num}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: C.text,
            letterSpacing: '-0.3px' }}>
            {step.label.toUpperCase()}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
            Trade {step.step_num} of {total_steps}
            &nbsp;·&nbsp;
            Tax due {step.tax_due_date}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: C.muted }}>Net cash change</div>
          <div style={{ fontSize: 13, fontWeight: 500,
            fontFamily: 'var(--font-mono)', color: C.green }}>$0</div>
          <div style={{ fontSize: 12, color: C.muted }}>proceeds reinvested</div>
        </div>
      </div>

      {/* ── Why this month ── */}
      <div style={{ padding: '8px 10px', borderRadius: 0, marginBottom: 12,
        background: C.amber + '0c', border: `1px solid ${C.amber}`,
        fontSize: 12, color: C.muted, lineHeight: 1.65 }}>
        <span style={{ color: C.amber, fontWeight: 500 }}>
           Why {MONTHS_SHORT[step.month - 1]}?{' '}
        </span>
        {step.why_this_month}
      </div>

      {/* ── Full-year tax picture ── */}
      <YearPictureCard p={step.year_picture} is_current_year={step.year === new Date().getFullYear()} />

      {/* ── STEP 1: SELL ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            background: C.red + '1a', border: `1px solid ${C.red}`,
            borderRadius: 0, padding: '2px 10px', fontSize: 12,
            fontWeight: 500, color: C.red,
          }}>
            STEP 1 — SELL FIRST
          </div>
          <span style={{ fontSize: 12, color: C.muted }}>
            Complete all sells before placing any buy orders
          </span>
        </div>

        {step.sells.map((s, i) => (
          <div key={i} style={{
            padding: '10px 12px', marginBottom: 6, borderRadius: 0,
            background: s.is_stcg_wait
              ? `${C.green}08`
              : 'var(--fd-card)',
            border: `1px solid ${s.is_stcg_wait ? C.green + '30' : 'var(--fd-hairline)'}`,
          }}>
            {/* Top row: symbol + badge + key numbers */}
            <div style={{ display: 'flex', alignItems: 'center',
              gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 500,
                fontFamily: 'var(--font-mono)', color: C.text,
                letterSpacing: '-0.5px' }}>{s.symbol}</span>
              {s.is_stcg_wait && (
                <span style={{ fontSize: 12, fontWeight: 500,
                  color: C.green, border: `1px solid ${C.green}`,
                  borderRadius: 0, padding: '1px 6px' }}>
                  STCG → LTCG
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 16,
                alignItems: 'baseline' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: C.muted }}>Proceeds</div>
                  <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)',
                    fontWeight: 500, color: C.text }}>{fmtD(s.proceeds)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: C.muted }}>LTCG gain</div>
                  <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)',
                    fontWeight: 500,
                    color: s.gain > 0 ? C.green : s.gain < 0 ? C.red : C.muted }}>
                    {s.gain !== 0 ? (s.gain > 0 ? `+${fmtD(s.gain)}` : fmtD(s.gain)) : '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: C.muted }}>Tax est.</div>
                  <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)',
                    fontWeight: 500,
                    color: s.tax_est > 0 ? C.red : C.muted }}>
                    {s.tax_est > 0 ? `~${fmtD(s.tax_est)}` : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Lot detail grid */}
            <div style={{ display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              gap: '4px 12px',
              padding: '8px 10px', borderRadius: 0,
              background: 'var(--fd-card)',
              marginBottom: 8 }}>
              {[
                ['Shares to sell', s.shares > 0 ? `${fmtShares(s.shares)} sh` : '—'],
                ['Acquired date',  s.acquired_date ? fmtAcqDate(s.acquired_date) : '—'],
                ['Cost/share',     s.cost_per_sh > 0 ? `$${s.cost_per_sh.toFixed(2)}` : '—'],
                ['Cost basis',     s.cost_basis_total > 0 ? fmtD(s.cost_basis_total) : '—'],
                ['Gain %',         s.gain_pct !== 0 ? `${s.gain_pct > 0 ? '+' : ''}${s.gain_pct}%` : '—'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 12, color: C.muted,
                    textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                    fontWeight: 500, color: C.text, marginTop: 1 }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Schwab instruction */}
            {s.acquired_date && (
              <div style={{ padding: '5px 8px', borderRadius: 0,
                background: C.blue + '0d', border: `1px solid ${C.blue}`,
                fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
                <span style={{ color: C.blue, fontWeight: 500 }}>
                  In Schwab:{' '}
                </span>
                Sell {s.shares > 0 ? `${fmtShares(s.shares)} shares` : 'required shares'} of{' '}
                <strong style={{ color: C.text }}>{s.symbol}</strong>
                {' '}→ click <em>"Choose Specific Lots"</em>
                {' '}→ select lot acquired{' '}
                <strong style={{ color: C.amber, fontFamily: 'var(--font-mono)' }}>
                  {fmtAcqDate(s.acquired_date)}
                </strong>
                {s.cost_per_sh > 0 && (
                  <> (cost basis <strong style={{ fontFamily: 'var(--font-mono)' }}>
                    ${s.cost_per_sh.toFixed(2)}/sh</strong>)</>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Proceeds total */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          alignItems: 'center', gap: 20,
          paddingTop: 8, borderTop: '1px solid var(--fd-hairline)',
        }}>
          <span style={{ fontSize: 12, color: C.muted }}>Cash in your account after sells</span>
          <span style={{ fontSize: 14, fontWeight: 500,
            fontFamily: 'var(--font-mono)', color: C.green }}>
            {fmtD(step.total_proceeds)}
          </span>
          {step.total_tax > 0 && (
            <span style={{ fontSize: 12, color: C.red }}>
              Tax owed: ~{fmtD(step.total_tax)}
            </span>
          )}
        </div>
      </div>

      {/* ── Arrow connector ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 14px' }}>
        <div style={{ flex: 1, height: 1, background: C.green + '28' }} />
        <div style={{
          fontSize: 12, fontWeight: 500, color: C.green,
          padding: '3px 10px', border: `1px solid ${C.green}`,
          borderRadius: 20, background: C.green + '0c',
          whiteSpace: 'nowrap',
        }}>
          ↓&nbsp; Use {fmtD(step.total_proceeds)} cash to buy below
        </div>
        <div style={{ flex: 1, height: 1, background: C.green + '28' }} />
      </div>

      {/* ── STEP 2: BUY ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            background: C.green + '1a', border: `1px solid ${C.green}`,
            borderRadius: 0, padding: '2px 10px', fontSize: 12,
            fontWeight: 500, color: C.green,
          }}>
            STEP 2 — BUY WITH PROCEEDS
          </div>
          <span style={{ fontSize: 12, color: C.muted }}>
            Only after the sells above have settled (T+1)
          </span>
        </div>

        {step.buys.length === 0 ? (
          <div style={{ padding: '10px', borderRadius: 0,
            background: 'var(--fd-card)',
            fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
            No underweight positions to buy — proceeds stay as cash.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid',
              gridTemplateColumns: '60px 90px 70px 1fr',
              gap: '0 8px', paddingBottom: 4,
              borderBottom: '1px solid var(--fd-hairline)' }}>
              {['SYMBOL','AMOUNT','% OF CASH','WHY THIS SYMBOL'].map(h => (
                <span key={h} style={{ fontSize: 12, color: C.muted,
                  textTransform: 'uppercase', letterSpacing: '0.3px' }}>{h}</span>
              ))}
            </div>
            {step.buys.map((b, i) => {
              const pct = step.total_proceeds > 0
                ? Math.round((b.amount / step.total_proceeds) * 100) : 0
              return (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 90px 70px 1fr',
                  gap: '0 8px', padding: '8px 0',
                  borderBottom: i < step.buys.length - 1
                    ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  alignItems: 'center',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 500,
                    fontFamily: 'var(--font-mono)', color: C.text }}>{b.symbol}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                    fontWeight: 500, color: C.blue }}>{fmtD(b.amount)}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                    color: C.muted }}>{pct}%</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{b.reason}</span>
                </div>
              )
            })}
            <div style={{
              display: 'flex', justifyContent: 'flex-end',
              alignItems: 'center', gap: 20,
              paddingTop: 8, borderTop: '1px solid var(--fd-hairline)',
            }}>
              <span style={{ fontSize: 12, color: C.muted }}>Total invested</span>
              <span style={{ fontSize: 13, fontWeight: 500,
                fontFamily: 'var(--font-mono)', color: C.blue }}>
                {fmtD(buy_total)}
              </span>
              <span style={{ fontSize: 12, color: C.muted }}>
                of {fmtD(step.total_proceeds)} proceeds
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

// ── Action Plan — unified migration plan view ─────────────────────────────────────
// Timeline grid + monthly action cards (grouped by symbol, collapsible lot detail).
// Replaces the old PlanCalendar + WaitingRoom — no duplication.

function ActionPlan({ steps, waiting, today_is_bad, onSelectStep, shared }: {
  steps: TradeStep[]
  waiting: WaitingLot[]
  today_is_bad: boolean
  onSelectStep: (step: TradeStep) => void
  shared: SharedBudget
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const now = new Date()
  const cy  = now.getFullYear()
  const cm  = now.getMonth() + 1

  if (steps.length === 0 && waiting.length === 0) return null

  // Year range to display on the timeline
  const all_years = new Set<number>([cy])
  steps.forEach(s => all_years.add(s.year))
  waiting.forEach(w => {
    if (w.maturity_date) {
      const d = new Date(w.maturity_date)
      all_years.add(d.getFullYear())
    }
  })
  const min_yr = Math.min(...all_years)
  const max_yr = Math.max(...all_years)
  const year_range: number[] = []
  for (let y = min_yr; y <= max_yr; y++) year_range.push(y)

  const total_gain = steps.reduce((s, x) => s + x.total_gain, 0)
  const total_tax  = steps.reduce((s, x) => s + x.total_tax, 0)
  const last_step  = steps[steps.length - 1]

  // Is the first step's window currently open (and today is not a bad month)?
  const first_step = steps[0]
  const action_open = !today_is_bad && !!first_step &&
    (first_step.year < cy || (first_step.year === cy && first_step.month <= cm))

  return (
    <Card accent={C.amber} style={{ padding: '16px 18px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', gap: 16, marginBottom: 14,
        paddingBottom: 12, borderBottom: '1px solid var(--fd-hairline)' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.text,
            letterSpacing: '-0.4px', marginBottom: 4 }}>
             Your Rebalance Calendar
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.65 }}>
            {steps.length} scheduled trade{steps.length !== 1 ? 's' : ''}
            {waiting.length > 0
              ? ` + ${waiting.length} lot${waiting.length !== 1 ? 's' : ''} waiting to mature`
              : ''}
            {last_step
              ? (shared.rebalance_years.length > 0 && shared.years_to_rebalance > shared.rebalance_years.length)
                ? ` · ${last_step.label} completes the scheduled window (full payoff needs ~${shared.years_to_rebalance} yrs total)`
                : ` · Completes ${last_step.label}`
              : ''}
            <span style={{ color: C.amber, marginLeft: 6 }}>
              · Click any amber cell for sell/buy detail
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
          {total_gain > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase',
                letterSpacing: '0.4px', marginBottom: 2 }}>Total gain</div>
              <div style={{ fontSize: 13, fontWeight: 500,
                fontFamily: 'var(--font-mono)', color: C.green }}>{fmtD(total_gain)}</div>
            </div>
          )}
          {total_tax > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase',
                letterSpacing: '0.4px', marginBottom: 2 }}>Est. tax</div>
              <div style={{ fontSize: 13, fontWeight: 500,
                fontFamily: 'var(--font-mono)', color: C.amber }}>~{fmtD(total_tax)}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Visual timeline — one row per year, 12 month cells ── */}
      <div style={{ marginBottom: 16 }}>
        {/* Month header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 5 }}>
          <div style={{ width: 40, flexShrink: 0 }} />
          {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
            <div key={m} style={{ flex: 1, textAlign: 'center', fontSize: 12,
              color: 'var(--fd-muted)', fontWeight: 500,
              letterSpacing: '-0.3px' }}>
              {MONTHS_SHORT[m - 1]}
            </div>
          ))}
        </div>

        {year_range.map(yr => (
          <div key={yr} style={{ display: 'flex', alignItems: 'center',
            gap: 3, marginBottom: 4 }}>
            {/* Year label */}
            <div style={{ width: 40, flexShrink: 0, fontSize: 12,
              fontFamily: 'var(--font-mono)', fontWeight: 500,
              color: yr === cy ? C.amber : C.muted, letterSpacing: '-0.5px' }}>
              {yr}
            </div>

            {/* Month cells */}
            {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
              const is_today   = yr === cy && m === cm
              const is_past    = yr < cy || (yr === cy && m < cm)
              const trade_step = steps.find(s => s.year === yr && s.month === m)
              const stcg_lots  = waiting.filter(w => {
                if (!w.maturity_date) return false
                const d = new Date(w.maturity_date)
                return d.getFullYear() === yr && d.getMonth() + 1 === m
              })
              const has_trade = !!trade_step
              const has_stcg  = stcg_lots.length > 0

              const bg =
                has_trade ? C.amber :
                has_stcg  ? C.blue :
                is_today  ? C.green + '66' :
                is_past   ? 'var(--fd-card)' :
                            'var(--fd-card)'

              return (
                <div key={m}
                  onClick={has_trade ? () => onSelectStep(trade_step!) : undefined}
                  title={
                    has_trade ? `Click — Step ${trade_step!.step_num}: ${MONTHS_SHORT[m-1]} ${yr}` :
                    has_stcg  ? `STCG matures — ${MONTHS_SHORT[m-1]} ${yr}` :
                    is_today  ? 'Today' : `${MONTHS_SHORT[m-1]} ${yr}`
                  } style={{
                  flex: 1, height: 22, borderRadius: 0,
                  background: bg,
                  border: is_today ? `1.5px solid ${C.green}` : '1.5px solid transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative',
                  cursor: has_trade ? 'pointer' : 'default',
                  transition: 'opacity 0.1s',
                }}
                onMouseEnter={e => { if (has_trade) (e.currentTarget as HTMLElement).style.opacity = '0.75' }}
                onMouseLeave={e => { if (has_trade) (e.currentTarget as HTMLElement).style.opacity = '1' }}
                >
                  {has_trade && (
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-ink)',
                      lineHeight: 1 }}>{trade_step!.step_num}</span>
                  )}
                  {!has_trade && has_stcg && (
                    <span style={{ fontSize: 12, lineHeight: 1 }}></span>
                  )}
                  {!has_trade && !has_stcg && is_today && (
                    <span style={{ fontSize: 12, fontWeight: 500,
                      color: C.green, lineHeight: 1 }}>▼</span>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6,
          fontSize: 12, color: C.muted }}>
          <span><span style={{ color: C.amber }}>■</span> Scheduled trade</span>
          <span><span style={{ color: C.blue }}>■</span> STCG matures</span>
          <span style={{ color: C.green }}>▼ Today</span>
          <span style={{ color: 'var(--fd-muted)' }}>■ Future</span>
          <span style={{ color: 'var(--fd-muted)' }}>■ Past</span>
        </div>
      </div>

      {/* ── Step list — rendered in popup, not inline ── */}
      {false && steps.map((step, idx) => {
          const key      = `${step.year}-${step.month}`
          const isExp    = expanded.has(key)
          const is_first = idx === 0
          const is_now   = is_first && action_open
          const margin   = Math.max(0, step.year_picture.niit_threshold - step.year_picture.total_magi)
          const status_c = step.year_picture.status === 'safe' ? C.green
            : step.year_picture.status === 'watch' ? C.amber : C.red

          // Group sells by symbol — collapse individual lots into one row per symbol
          const symMap = new Map<string, { proceeds: number; gain: number; shares: number; tax: number; isWait: boolean; lots: SellItem[] }>()
          step.sells.forEach(sell => {
            if (!symMap.has(sell.symbol)) symMap.set(sell.symbol, { proceeds: 0, gain: 0, shares: 0, tax: 0, isWait: false, lots: [] })
            const g = symMap.get(sell.symbol)!
            g.proceeds += sell.proceeds; g.gain += sell.gain
            g.shares += sell.shares;     g.tax  += sell.tax_est
            g.isWait = g.isWait || sell.is_stcg_wait
            g.lots.push(sell)
          })

          return (
            <div key={key} style={{
              borderRadius: 0, overflow: 'hidden',
              border: `1px solid ${is_now ? C.amber + '60' : is_first ? 'var(--fd-hairline)' : 'var(--fd-hairline)'}`,
              background: is_now ? 'var(--fd-card)' : 'var(--fd-card)',
            }}>
              {/* ── Card header ── */}
              <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center',
                gap: 10, flexWrap: 'wrap',
                borderBottom: '1px solid var(--fd-hairline)' }}>
                <div style={{ width: 24, height: 24, borderRadius: 3, flexShrink: 0,
                  background: C.amber + '20', border: `2px solid ${C.amber}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 500, color: C.amber }}>
                  {step.step_num}
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  color: C.text, letterSpacing: '-0.5px' }}>
                  {step.label.toUpperCase()}
                </span>
                {is_now && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-ink)',
                  background: C.green, borderRadius: 0, padding: '2px 6px' }}>▶ ACT NOW</span>}
                {!is_now && is_first && <span style={{ fontSize: 12, fontWeight: 500, color: C.amber,
                  border: `1px solid ${C.amber}`, borderRadius: 0, padding: '1px 6px' }}>NEXT</span>}
                {/* Totals */}
                <span style={{ fontSize: 12, color: C.muted }}>
                  Sell{' '}
                  <span style={{ color: C.red, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                    {fmtD(step.total_proceeds)}
                  </span>
                </span>
                {step.total_gain > 0 && (
                  <span style={{ fontSize: 12, color: C.muted }}>
                    Gain{' '}
                    <span style={{ color: C.green, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                      +{fmtD(step.total_gain)}
                    </span>
                  </span>
                )}
                {/* NIIT badge right-aligned */}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                  padding: '2px 7px', borderRadius: 0,
                  background: status_c + '12', border: `1px solid ${status_c}` }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: status_c }}>
                    {step.year_picture.status === 'safe' ? '' : ''}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: status_c,
                    fontFamily: 'var(--font-mono)' }}>
                    {fmtK(margin)} NIIT headroom
                  </span>
                </div>
              </div>

              {/* ── Sell + Buy body ── */}
              <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>

                {/* SELL — one row per symbol */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: C.red,
                    textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 5 }}>
                    Sell
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {[...symMap.entries()].map(([sym, g]) => (
                      <div key={sym} style={{ display: 'flex', alignItems: 'center',
                        gap: 10, padding: '6px 10px', borderRadius: 0,
                        background: 'var(--fd-card)',
                        border: '1px solid var(--fd-hairline)', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 500,
                          fontFamily: 'var(--font-mono)', color: C.text, minWidth: 52 }}>
                          {sym}
                        </span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                          color: C.red, fontWeight: 500 }}>
                          {fmtD(g.proceeds)}
                        </span>
                        {g.shares > 0 && (
                          <span style={{ fontSize: 12, color: C.muted }}>
                            {g.shares % 1 === 0 ? g.shares.toFixed(0) : g.shares.toFixed(2)} sh
                          </span>
                        )}
                        {g.gain > 0 && (
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                            color: C.green, fontWeight: 500 }}>
                            +{fmtD(g.gain)} LTCG gain
                          </span>
                        )}
                        {g.isWait && (
                          <span style={{ fontSize: 12, fontWeight: 500, color: C.blue,
                            border: `1px solid ${C.blue}`, borderRadius: 0,
                            padding: '1px 5px' }}>
                             waited for LTCG
                          </span>
                        )}
                        {g.tax > 0 && (
                          <span style={{ fontSize: 12, color: C.amber, marginLeft: 'auto',
                            fontFamily: 'var(--font-mono)' }}>
                            ~{fmtD(g.tax)} tax
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* BUY — chips */}
                {step.buys.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: C.green,
                      textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 5 }}>
                      Buy — funded by {fmtD(step.total_proceeds)} proceeds
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {step.buys.map(b => (
                        <div key={b.symbol} style={{ display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 10px', borderRadius: 0,
                          background: C.green + '07', border: `1px solid ${C.green}` }}>
                          <span style={{ fontSize: 12, fontWeight: 500,
                            fontFamily: 'var(--font-mono)', color: C.text }}>{b.symbol}</span>
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                            color: C.green, fontWeight: 500 }}>{fmtD(b.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer: stats + expand toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                  paddingTop: 6, borderTop: '1px solid var(--fd-hairline)' }}>
                  {([
                    ['Tax due', step.tax_due_date, C.amber] as [string,string,string],
                    ['MAGI', `${fmtD(step.year_picture.total_magi)} / ${fmtD(step.year_picture.niit_threshold)}`, status_c] as [string,string,string],
                    step.total_tax > 0 ? ['Est. tax', `~${fmtD(step.total_tax)}`, C.amber] as [string,string,string] : null,
                  ]).filter((x): x is [string,string,string] => x !== null).map(([lbl, val, clr]) => (
                    <div key={lbl as string}>
                      <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase',
                        letterSpacing: '0.4px' }}>{lbl}</div>
                      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                        fontWeight: 500, color: clr as string }}>{val}</div>
                    </div>
                  ))}
                  <button onClick={() => setExpanded(prev => {
                    const n = new Set(prev); isExp ? n.delete(key) : n.add(key); return n
                  })} style={{
                    marginLeft: 'auto', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    color: isExp ? C.amber : C.muted,
                    background: 'transparent', border: `1px solid var(--fd-hairline)`,
                    borderRadius: 0, padding: '3px 9px',
                  }}>
                    {isExp ? '▲ Hide lots' : `▼ ${step.sells.length} lot${step.sells.length !== 1 ? 's' : ''} — Schwab detail`}
                  </button>
                </div>

                {/* Expandable lot-by-lot detail */}
                {isExp && (
                  <div style={{ borderRadius: 0, overflow: 'hidden',
                    border: '1px solid var(--fd-hairline)' }}>
                    <div style={{ padding: '6px 10px', background: 'var(--fd-card)',
                      fontSize: 12, fontWeight: 500, color: C.muted,
                      textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                      Schwab → "Choose Specific Lots" — select by acquisition date
                    </div>
                    {step.sells.map((s, i) => (
                      <div key={i} style={{ display: 'grid',
                        gridTemplateColumns: '56px 1fr 70px 80px 80px 70px',
                        gap: '0 8px', padding: '5px 10px', alignItems: 'center',
                        background: i % 2 === 0 ? 'var(--fd-card)' : 'transparent',
                        borderTop: '1px solid var(--fd-hairline)' }}>
                        <span style={{ fontSize: 12, fontWeight: 500,
                          fontFamily: 'var(--font-mono)', color: C.text }}>{s.symbol}</span>
                        <span style={{ fontSize: 12, color: C.amber,
                          fontFamily: 'var(--font-mono)' }}>
                          acq {s.acquired_date ? fmtAcqDate(s.acquired_date) : '—'}
                        </span>
                        <span style={{ fontSize: 12, color: C.muted,
                          fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                          {s.shares > 0 ? `${fmtShares(s.shares)} sh` : '—'}
                        </span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                          color: C.red, textAlign: 'right' }}>
                          {fmtD(s.proceeds)}
                        </span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                          color: s.gain > 0 ? C.green : s.gain < 0 ? C.red : C.muted,
                          textAlign: 'right' }}>
                          {s.gain !== 0 ? `${s.gain > 0 ? '+' : ''}${fmtD(s.gain)}` : 'no gain'}
                        </span>
                        {s.is_stcg_wait
                          ? <span style={{ fontSize: 12, color: C.blue }}> STCG→LTCG</span>
                          : <span style={{ fontSize: 12, color: C.muted }}>LTCG</span>
                        }
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}

    </Card>
  )
}

// ── Plan summary footer ───────────────────────────────────────────────────────────

function PlanSummary({ plan }: { plan: Plan }) {
  const { budget: b, shared, steps, total_gain, total_tax, no_lot_data, waiting } = plan
  const cy    = new Date().getFullYear()
  const last  = steps[steps.length - 1]
  const isPartial = shared.rebalance_years.length > 0 && shared.years_to_rebalance > shared.rebalance_years.length

  return (
    <Card>
      <SectionLabel text="Plan snapshot" />
      <div style={{ display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '6px 32px', marginBottom: 10 }}>
        {([
          ['Scheduled LTCG gain', fmtD(total_gain), C.green],
          ['Estimated tax cost',
            total_tax === 0 ? '$0 — stays in 0% LTCG bracket' : `~${fmtD(total_tax)}`,
            total_tax === 0 ? C.green : C.amber],
          ['Effective rate',
            total_gain > 0 ? `${((total_tax / total_gain) * 100).toFixed(1)}% on gains` : '—',
            C.muted],
          ['STCG lots (waiting)',
            waiting.length > 0 ? `${waiting.length} lot${waiting.length > 1 ? 's' : ''} — see above` : 'None',
            waiting.length > 0 ? C.amber : C.green],
          ['Roth conversion room preserved', fmtD(b.ceiling_room), C.green],
          ['Plan completes',
            last
              ? isPartial
                ? `${shared.rebalance_years.length}-yr window shown · full payoff ~${shared.years_to_rebalance} yrs`
                : (last.year > cy ? `${last.label} (multi-year)` : last.label)
              : '—',
            C.amber],
        ] as [string, string, string][]).map(([label, value, color]) => (
          <div key={label} style={{ padding: '5px 0',
            borderBottom: '1px solid var(--fd-hairline)' }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 2,
              textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
              fontWeight: 500, color }}>{value}</div>
          </div>
        ))}
      </div>

      {no_lot_data && (
        <div style={{ padding: '7px 10px', borderRadius: 0, marginBottom: 8,
          background: C.amber + '0c', border: `1px solid ${C.amber}`,
          fontSize: 12, color: C.amber, lineHeight: 1.65 }}>
           Lot-level data is missing for some symbols — gains are estimated.
          Verify actual lot gains and share counts in Schwab before executing.
        </div>
      )}

      <div style={{ padding: '7px 10px', borderRadius: 0,
        background: 'var(--fd-card)',
        fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
        <strong style={{ color: C.text }}>Rules enforced:</strong>
        {' '}(1) No STCG gains will be realized — STCG lots wait for maturity. Loss lots (gain &lt; $0) are excluded from the schedule entirely.
        {' '}(2) Sell first, buy with proceeds — no new cash enters the account.
        {' '}(3) STCG lots wait for maturity before being scheduled.
        {' '}(4) LTCG gains spread across years to minimize NIIT surcharge exposure each year.
      </div>

      {steps.some(st => st.year === cy && st.month === 12) && (
        <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 0,
          background: C.amber + '0a', border: `1px solid ${C.amber}`,
          fontSize: 12, color: C.amber, lineHeight: 1.6 }}>
           <strong>Estimated tax reminder:</strong> December trades generate a tax liability due April 15 next year.
          Consider a Q4 estimated tax payment by <strong>January 15</strong> to avoid the underpayment penalty.
        </div>
      )}
    </Card>
  )
}

// ── Step detail modal — shown when user clicks a calendar cell or year row ────────

function StepDetailModal({ step, onClose }: { step: TradeStep; onClose: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const p = step.year_picture
  const margin   = Math.max(0, p.niit_threshold - p.total_magi)
  const status_c = p.status === 'safe' ? C.green : p.status === 'watch' ? C.amber : C.red

  // Group sells by symbol
  const symMap = new Map<string, { proceeds: number; gain: number; shares: number; tax: number; isWait: boolean; lots: SellItem[] }>()
  step.sells.forEach(sell => {
    if (!symMap.has(sell.symbol)) symMap.set(sell.symbol, { proceeds: 0, gain: 0, shares: 0, tax: 0, isWait: false, lots: [] })
    const g = symMap.get(sell.symbol)!
    g.proceeds += sell.proceeds; g.gain += sell.gain
    g.shares   += sell.shares;   g.tax  += sell.tax_est
    g.isWait    = g.isWait || sell.is_stcg_wait
    g.lots.push(sell)
  })

  return (
    /* Backdrop */
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      {/* Modal panel */}
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg)', borderRadius: 0, width: '100%', maxWidth: 640,
        maxHeight: '80vh', overflowY: 'auto',
        border: `1px solid ${C.amber}`,
        boxShadow: `none`,
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center',
          gap: 12, borderBottom: `1px solid var(--fd-hairline)`,
          position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 2 }}>
          <div style={{ width: 28, height: 28, borderRadius: 3,
            background: C.amber + '22', border: `2px solid ${C.amber}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 500, color: C.amber, flexShrink: 0 }}>
            {step.step_num}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, color: C.text,
              letterSpacing: '-0.4px', fontFamily: 'var(--font-mono)' }}>
              {step.label.toUpperCase()}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
              Tax due {step.tax_due_date}
              {' · '}MAGI {fmtD(p.total_magi)} / {fmtD(p.niit_threshold)} NIIT
              {margin > 0
                ? <span style={{ color: C.green }}> · {fmtD(margin)} headroom</span>
                : <span style={{ color: C.red }}> · NIIT surcharge applies</span>}
            </div>
          </div>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', border: '1px solid var(--fd-hairline)',
            borderRadius: 0, color: C.muted, fontSize: 12, cursor: 'pointer',
            padding: '4px 10px', flexShrink: 0,
          }}>✕ Close</button>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* SELL — per symbol */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: C.red,
              textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>
              Step 1 — Sell
            </div>
            {[...symMap.entries()].map(([sym, g]) => {
              const lotKey = `${step.year}-${step.month}-${sym}`
              const isLotExp = expanded.has(lotKey)
              return (
                <div key={sym} style={{ marginBottom: 6, borderRadius: 0, overflow: 'hidden',
                  border: '1px solid var(--fd-hairline)' }}>
                  {/* Symbol row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', background: 'var(--fd-card)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 500,
                      fontFamily: 'var(--font-mono)', color: C.text, minWidth: 60 }}>{sym}</span>
                    <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)',
                      color: C.red, fontWeight: 500 }}>{fmtD(g.proceeds)}</span>
                    {g.shares > 0 && (
                      <span style={{ fontSize: 12, color: C.muted }}>
                        {fmtShares(g.shares)} sh
                      </span>
                    )}
                    {g.gain > 0 && (
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                        color: C.green, fontWeight: 500 }}>+{fmtD(g.gain)} LTCG</span>
                    )}
                    {g.isWait && (
                      <span style={{ fontSize: 12, color: C.blue,
                        border: `1px solid ${C.blue}`, borderRadius: 0, padding: '1px 6px' }}>
                         waited for LTCG
                      </span>
                    )}
                    {g.tax > 0 && (
                      <span style={{ fontSize: 12, color: C.amber, marginLeft: 'auto' }}>
                        ~{fmtD(g.tax)} tax
                      </span>
                    )}
                    <button onClick={() => setExpanded(prev => {
                      const n = new Set(prev); isLotExp ? n.delete(lotKey) : n.add(lotKey); return n
                    })} style={{
                      fontSize: 12, color: isLotExp ? C.amber : C.muted,
                      background: 'transparent', border: `1px solid var(--fd-hairline)`,
                      borderRadius: 0, padding: '2px 7px', cursor: 'pointer', marginLeft: isLotExp ? 0 : 'auto',
                    }}>
                      {isLotExp ? '▲ Hide lots' : `▼ ${g.lots.length} lot${g.lots.length !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                  {/* Lot detail */}
                  {isLotExp && (
                    <div>
                      <div style={{ padding: '5px 12px', background: 'var(--fd-card)',
                        fontSize: 12, color: C.muted, fontWeight: 500,
                        textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Schwab → "Choose Specific Lots" — select by acquired date
                      </div>
                      {g.lots.map((lot, li) => (
                        <div key={li} style={{ display: 'grid',
                          gridTemplateColumns: '80px 1fr 70px 80px 80px 60px',
                          gap: '0 8px', padding: '5px 12px', alignItems: 'center',
                          background: li % 2 === 0 ? 'var(--fd-card)' : 'transparent',
                          borderTop: '1px solid var(--fd-hairline)' }}>
                          <span style={{ fontSize: 12, fontWeight: 500,
                            color: C.amber, fontFamily: 'var(--font-mono)' }}>
                            {lot.acquired_date ? fmtAcqDate(lot.acquired_date) : '—'}
                          </span>
                          <span style={{ fontSize: 12, color: C.muted }}>
                            acquired · cost {lot.cost_per_sh > 0 ? `$${lot.cost_per_sh.toFixed(2)}/sh` : '—'}
                          </span>
                          <span style={{ fontSize: 12, color: C.muted,
                            fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                            {lot.shares > 0 ? `${fmtShares(lot.shares)} sh` : '—'}
                          </span>
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                            color: C.red, textAlign: 'right' }}>{fmtD(lot.proceeds)}</span>
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                            color: lot.gain > 0 ? C.green : C.muted, textAlign: 'right' }}>
                            {lot.gain !== 0 ? `${lot.gain > 0 ? '+' : ''}${fmtD(lot.gain)}` : '—'}
                          </span>
                          <span style={{ fontSize: 12, color: lot.is_stcg_wait ? C.blue : C.muted }}>
                            {lot.is_stcg_wait ? 'STCG→LT' : 'LTCG'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* BUY */}
          {step.buys.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: C.green,
                textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>
                Step 2 — Buy with proceeds ({fmtD(step.total_proceeds)})
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {step.buys.map(b => (
                  <div key={b.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 14px', borderRadius: 0,
                    background: C.green + '08', border: `1px solid ${C.green}` }}>
                    <span style={{ fontSize: 14, fontWeight: 500,
                      fontFamily: 'var(--font-mono)', color: C.text }}>{b.symbol}</span>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                      color: C.green, fontWeight: 500 }}>{fmtD(b.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tax picture */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {([
              ['Proceeds', fmtD(step.total_proceeds), C.red],
              ['LTCG gain', step.total_gain > 0 ? `+${fmtD(step.total_gain)}` : '$0', C.green],
              ['Est. tax', step.total_tax > 0 ? `~${fmtD(step.total_tax)}` : '$0', step.total_tax > 0 ? C.amber : C.green],
              ['Ordinary', fmtD(p.total_ordinary), C.muted],
              ['NIIT threshold', fmtD(p.niit_threshold), status_c],
              ['Status', p.status.toUpperCase(), status_c],
            ] as [string, string, string][]).map(([lbl, val, clr]) => (
              <div key={lbl} style={{ padding: '7px 10px', borderRadius: 0,
                background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)' }}>
                <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase',
                  letterSpacing: '0.4px', marginBottom: 3 }}>{lbl}</div>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                  fontWeight: 500, color: clr }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Why this month */}
          {step.why_this_month && (
            <div style={{ padding: '8px 12px', borderRadius: 0,
              background: C.blue + '0a', border: `1px solid ${C.blue}`,
              fontSize: 12, color: C.muted, lineHeight: 1.65 }}>
              <span style={{ color: C.blue, fontWeight: 500 }}>Why this month: </span>
              {step.why_this_month}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ── Rebalance Timeline — expanded year+month view ────────────────────────────────

function RebalanceTimeline({ plan, onSelectStep }: { plan: Plan; onSelectStep: (step: TradeStep) => void }) {
  const { steps, shared: s, budget: b, total_gain, waiting } = plan
  const cy    = new Date().getFullYear()
  const total = Math.max(s.total_ltcg_needed, total_gain, 1)

  // Group steps by year
  const byYear = new Map<number, TradeStep[]>()
  steps.forEach(st => {
    if (!byYear.has(st.year)) byYear.set(st.year, [])
    byYear.get(st.year)!.push(st)
  })

  // Year list — prepend current year if blocked (no steps)
  type YrGroup = { year: number; sts: TradeStep[]; blocked: boolean }
  const groups: YrGroup[] = []
  if (!byYear.has(cy)) groups.push({ year: cy, sts: [], blocked: true })
  ;[...byYear.entries()].sort((a, b) => a[0] - b[0])
    .forEach(([yr, sts]) => groups.push({ year: yr, sts, blocked: false }))

  let cumGain = 0

  return (
    <div style={{ background: C.surf, borderRadius: 0, overflow: 'hidden',
      border: '1px solid var(--fd-hairline)' }}>

      {/* Table header */}
      <div style={{ padding: '7px 16px', background: 'var(--fd-card)',
        borderBottom: '1px solid var(--fd-hairline)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '0.8px', color: C.amber, fontFamily: 'var(--font-mono)' }}>
          Rebalance Timeline
        </span>
        <span style={{ fontSize: 12, color: C.muted }}>
          {fmtD(s.total_ltcg_needed)} available LTCG · {fmtD(total_gain)} scheduled
          {s.ltcg_per_year > 0 ? ` · ${fmtD(s.ltcg_per_year)}/yr capacity` : ''}
          {' · '}{s.conv_fits ? ' conversion fits' : ' conversion conflict'}
          {' · '}Click any month row for Schwab lot detail
        </span>
      </div>

      {groups.map(({ year, sts, blocked }) => {
        const yearGain     = sts.reduce((acc, st) => acc + st.total_gain, 0)
        const yearProceeds = sts.reduce((acc, st) => acc + st.total_proceeds, 0)
        const yearTax      = sts.reduce((acc, st) => acc + st.total_tax, 0)
        cumGain += yearGain

        const ordinary   = year === cy ? b.projected_ordinary : b.future_ordinary
        const capPct     = s.ltcg_per_year > 0 ? Math.min(100, (yearGain / s.ltcg_per_year) * 100) : 0
        const cumPct     = Math.min(100, (cumGain / total) * 100)
        const isNow      = year === cy
        const capClr     = capPct > 105 ? C.red : capPct > 90 ? C.amber : C.green

        // Sell symbols across entire year
        const yearSyms = [...new Set(sts.flatMap(st => st.sells.map(x => x.symbol)))]

        return (
          <div key={year} style={{ borderBottom: '1px solid var(--fd-hairline)' }}>

            {/* ── Year header ── */}
            <div style={{ padding: '9px 16px', display: 'flex', alignItems: 'center',
              gap: 10, flexWrap: 'wrap',
              background: isNow ? 'var(--fd-card)' : 'var(--fd-card)',
              borderLeft: `3px solid ${blocked ? C.muted : isNow ? C.amber : C.green}`,
            }}>
              {/* Year badge */}
              <span style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)',
                color: blocked ? C.muted : isNow ? C.amber : C.text,
                letterSpacing: '-1px', minWidth: 44 }}>{year}</span>
              {isNow && (
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-ink)',
                  background: C.amber, borderRadius: 0, padding: '1px 5px' }}>NOW</span>
              )}

              {blocked ? (
                <span style={{ fontSize: 12, color: C.red }}>
                   No sell this year — ordinary income ({fmtD(ordinary)}) exceeds bracket ceiling and NIIT threshold.
                  {b.bucket_short && ` Cash bucket also short: SWVXX ${b.bucket_months.toFixed(1)} of ${b.bucket_required_months.toFixed(0)} mo target, ${fmtD(b.bucket_shortfall)} needed.`}
                  {' '}Plan starts next January.
                </span>
              ) : (
                <>
                  {/* Symbols strip */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {yearSyms.map(sym => (
                      <span key={sym} style={{ fontSize: 12, fontWeight: 500,
                        fontFamily: 'var(--font-mono)', color: C.red,
                        background: C.red + '10', border: `1px solid ${C.red}`,
                        borderRadius: 0, padding: '1px 6px' }}>{sym}</span>
                    ))}
                  </div>

                  {/* Year LTCG total */}
                  <span style={{ fontSize: 12, fontWeight: 500,
                    fontFamily: 'var(--font-mono)', color: C.green }}>
                    +{fmtD(yearGain)}
                  </span>
                  <span style={{ fontSize: 12, color: C.muted }}>
                    {yearProceeds > yearGain ? `${fmtD(yearProceeds)} proceeds` : ''}
                    {yearTax > 0 ? ` · ~${fmtD(yearTax)} tax` : ''}
                  </span>

                  {/* Capacity bar */}
                  <div style={{ flex: 1, minWidth: 100, maxWidth: 180 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      fontSize: 12, color: C.muted, marginBottom: 2 }}>
                      <span style={{ color: capClr }}>{capPct.toFixed(0)}% of annual cap</span>
                      <span>{fmtD(s.ltcg_per_year)} cap</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 0,
                      background: 'var(--fd-card)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${capPct}%`,
                        background: capClr, borderRadius: 0, transition: 'width 0.3s' }} />
                    </div>
                  </div>

                  {/* Cumulative % right-aligned */}
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 500,
                      fontFamily: 'var(--font-mono)',
                      color: cumPct >= 100 ? C.green : C.amber }}>
                      {cumPct.toFixed(0)}%
                    </div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                      {fmtD(cumGain)} / {fmtD(total)} done
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ── Month rows — one per trade step ── */}
            {sts.map((step, si) => {
              // Aggregate sells by symbol for this step
              const symMap = new Map<string, number>()
              step.sells.forEach(sell =>
                symMap.set(sell.symbol, (symMap.get(sell.symbol) ?? 0) + sell.proceeds))

              const monthLabel = step.label   // e.g. "January 2027"
              const isFirst    = si === 0

              return (
                <div key={`${step.year}-${step.month}`}
                  onClick={() => onSelectStep(step)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '7px 16px 7px 28px',
                    background: isFirst ? 'var(--fd-card)' : 'transparent',
                    borderTop: '1px solid var(--fd-hairline)',
                    cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--fd-card)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = isFirst ? 'var(--fd-card)' : 'transparent'}
                >
                  {/* Step number */}
                  <div style={{ width: 20, height: 20, borderRadius: 3, flexShrink: 0,
                    background: C.amber + '1a', border: `1.5px solid ${C.amber}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 500, color: C.amber }}>{step.step_num}</div>

                  {/* Month */}
                  <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
                    color: C.text, minWidth: 120 }}>{monthLabel.toUpperCase()}</span>

                  {/* SELL chips */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: C.red,
                      textTransform: 'uppercase', letterSpacing: '0.4px' }}>SELL</span>
                    {[...symMap.entries()].map(([sym, amt]) => (
                      <span key={sym} style={{ fontSize: 12, fontWeight: 500,
                        fontFamily: 'var(--font-mono)', color: C.text,
                        background: C.red + '12', border: `1px solid ${C.red}`,
                        borderRadius: 0, padding: '2px 7px' }}>
                        {sym} <span style={{ color: C.red }}>{fmtK(amt)}</span>
                      </span>
                    ))}
                  </div>

                  {/* Arrow */}
                  {step.buys.length > 0 && (
                    <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>→</span>
                  )}

                  {/* BUY chips */}
                  {step.buys.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: C.green,
                        textTransform: 'uppercase', letterSpacing: '0.4px' }}>BUY</span>
                      {step.buys.map(b => (
                        <span key={b.symbol} style={{ fontSize: 12, fontWeight: 500,
                          fontFamily: 'var(--font-mono)', color: C.text,
                          background: C.green + '0c', border: `1px solid ${C.green}`,
                          borderRadius: 0, padding: '2px 7px' }}>
                          {b.symbol} <span style={{ color: C.green }}>{fmtK(b.amount)}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* LTCG right-aligned */}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline',
                    gap: 5, flexShrink: 0 }}>
                    {step.total_gain > 0 && (
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                        fontWeight: 500, color: C.green }}>+{fmtD(step.total_gain)}</span>
                    )}
                    <span style={{ fontSize: 12, color: C.muted }}>LTCG</span>
                    <span style={{ fontSize: 12, color: C.muted + '80' }}>↗</span>
                  </div>
                </div>
              )
            })}

          </div>
        )
      })}

      {/* Footer */}
      <div style={{ padding: '7px 16px', background: 'var(--fd-card)',
        display: 'flex', alignItems: 'center', gap: 12,
        borderTop: '1px solid var(--fd-hairline)' }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 500,
          textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: C.green }}>
          +{fmtD(total_gain)} LTCG
        </span>
        <span style={{ fontSize: 12, color: C.muted }}>
          over {groups.filter(g => !g.blocked && g.sts.length > 0).length} years
          · {steps.length} trades
          {waiting.length > 0 ? ` · ${waiting.length} STCG lots scheduled at maturity` : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
          Click any row for Schwab lot selection detail
        </span>
      </div>
    </div>
  )
}

// ── Tax Ceiling Dashboard — compact always-visible header ────────────────────────
// Answers the four key decision questions without any scrolling.

function TaxCeilingCard({ plan }: { plan: Plan }) {
  const { budget: b, shared: s, steps, total_gain, total_tax } = plan

  // ── Key derived values ────────────────────────────────────────────────────────
  // LTCG capacity this year = room before the 15%→20% LTCG threshold, NOT the
  // NIIT threshold — NIIT (3.8%) and the LTCG rate step (15%→20%) are separate
  // thresholds on separate ladders.
  const this_yr_cap   = Math.max(0, b.ltcg_15_threshold - Math.max(0, b.projected_ordinary - b.std_ded))
  const future_cap    = s.ltcg_per_year          // LTCG capacity per year GOING FORWARD
  const total_needed  = s.total_ltcg_needed      // total LTCG across all symbols
  const yrs           = s.years_to_rebalance
  const first_step    = steps[0]

  // ── Status colors ─────────────────────────────────────────────────────────────
  const capThisYrClr  = this_yr_cap <= 0        ? C.red  : this_yr_cap < 30_000 ? C.amber : C.green
  const capFutureClr  = future_cap  <= 0        ? C.red  : future_cap  < 50_000 ? C.amber : C.green
  const yrClr         = yrs <= 3 ? C.green : yrs <= 7 ? C.amber : C.red
  const ordClr        = b.ceiling_room > 0 ? C.green : C.red

  // ── Visual bar: income stack vs NIIT threshold ────────────────────────────────
  const bar_max       = Math.max(b.projected_ordinary * 1.1, b.niit_threshold * 1.05, 1)
  const wPct = (v: number) => `${Math.min(100, (v / bar_max) * 100).toFixed(1)}%`

  const divW   = wPct(b.fwd_income)
  const convW  = wPct(b.annual_conv_target)
  const otherW = wPct(Math.max(0, b.projected_ordinary - b.fwd_income - b.annual_conv_target))
  const niitW  = wPct(b.niit_threshold)
  const ceilW  = wPct(b.ceiling)

  // ── Verdict chips ─────────────────────────────────────────────────────────────
  const chips: { label: string; color: string }[] = []
  if (this_yr_cap <= 0)    chips.push({ label: ' No LTCG this year — 15%→20% LTCG threshold reached', color: C.red })
  else                     chips.push({ label: ` Up to ${fmtD(this_yr_cap)} LTCG this year`, color: C.green })
  if (!s.conv_fits)        chips.push({ label: ' Conversion exceeds NIIT room', color: C.amber })
  if (future_cap <= 0)     chips.push({ label: ' No LTCG budget going forward', color: C.red })
  if (b.bucket_short)      chips.push({ label: ` Bucket short: ${b.bucket_months.toFixed(1)} of ${b.bucket_required_months.toFixed(0)} mo — refill from proceeds first`, color: C.amber })
  if (first_step)          chips.push({ label: `▶ First action: ${first_step.label.toUpperCase()}`, color: C.amber })

  return (
    <div style={{
      background: C.surf, borderRadius: 0, overflow: 'hidden',
      border: '1px solid var(--fd-hairline)',
      borderLeft: `3px solid ${this_yr_cap > 0 ? C.amber : C.red}`,
    }}>
      {/* ── Header ── */}
      <div style={{ padding: '8px 14px 6px', display: 'flex', alignItems: 'baseline',
        gap: 10, borderBottom: '1px solid var(--fd-hairline)' }}>
        <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '0.9px', color: C.amber, fontFamily: 'var(--font-mono)' }}>
          Tax Ceiling Status
        </span>
        <span style={{ fontSize: 12, color: C.muted }}>
          Rebalance Plan · {total_needed > 0 ? `${fmtD(total_needed)} total LTCG · ` : ''}
          {/* Use actual scheduled years (rebalance_years.length) not the math estimate (yrs).
              yrs = ceil(total/capacity) overestimates when multiple lots are sold in one year. */}
          {s.rebalance_years.length > 0
            ? `${s.rebalance_years.length}-yr schedule (${s.rebalance_years[0]}–${s.rebalance_years[s.rebalance_years.length - 1]}) · `
            : yrs > 0 ? `${yrs}-yr plan · ` : ''}
          {total_tax > 0 ? `~${fmtD(total_tax)} est. tax` : 'est. $0 tax'}
        </span>
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* ── Four metric tiles ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {/* 1. LTCG capacity this year */}
          <div style={{ padding: '7px 10px', borderRadius: 0,
            background: capThisYrClr + '0d', border: `1px solid ${capThisYrClr}` }}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase',
              letterSpacing: '0.5px', marginBottom: 3 }}>Planned LTCG Budget · this year</div>
            <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)',
              color: capThisYrClr, lineHeight: 1 }}>
              {this_yr_cap <= 0 ? '$0' : fmtD(this_yr_cap)}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
              {this_yr_cap <= 0
                ? `ordinary income already at/above the ${fmtD(b.ltcg_15_threshold)} LTCG 15%→20% threshold`
                : `before ${fmtD(b.ltcg_15_threshold)} LTCG 15%→20% threshold`}
            </div>
          </div>

          {/* 2. LTCG capacity future years */}
          <div style={{ padding: '7px 10px', borderRadius: 0,
            background: capFutureClr + '0d', border: `1px solid ${capFutureClr}` }}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase',
              letterSpacing: '0.5px', marginBottom: 3 }}>Planned LTCG Budget · per year</div>
            <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)',
              color: capFutureClr, lineHeight: 1 }}>
              {future_cap <= 0 ? '$0' : fmtD(future_cap)}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
              {future_cap <= 0
                ? 'conversion fills all room'
                : `${fmtD(s.dividends_est)} divs + ${fmtD(s.conv_target)} conv`}
            </div>
          </div>

          {/* 3. Total LTCG needed */}
          <div style={{ padding: '7px 10px', borderRadius: 0,
            background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)' }}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase',
              letterSpacing: '0.5px', marginBottom: 3 }}>Total LTCG to realize</div>
            <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)',
              color: C.amber, lineHeight: 1 }}>
              {total_needed > 0 ? fmtD(total_needed) : fmtD(total_gain)}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
              across all sell positions
            </div>
          </div>

          {/* 4. Years to complete */}
          <div style={{ padding: '7px 10px', borderRadius: 0,
            background: yrClr + '0d', border: `1px solid ${yrClr}` }}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase',
              letterSpacing: '0.5px', marginBottom: 3 }}>Plan timeline</div>
            <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)',
              color: yrClr, lineHeight: 1 }}>
              {/* Show actual scheduled years, not the math estimate. */}
              {s.rebalance_years.length > 0 ? `${s.rebalance_years.length} yr` : yrs > 0 ? `${yrs} yr` : '< 1 yr'}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
              {s.rebalance_years.length > 0
                ? `${s.rebalance_years[0]}–${s.rebalance_years[s.rebalance_years.length - 1]}`
                : 'this year'}
            </div>
          </div>
        </div>

        {/* ── Visual income stack bar ── */}
        <div>
          <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase',
            letterSpacing: '0.5px', marginBottom: 4 }}>
            Income stack vs NIIT threshold
            <span style={{ marginLeft: 10, color: ordClr }}>
              {/* ceiling_room is floored at 0 (it's used elsewhere as "room remaining",
                  which can't be negative) — so the overage must be computed from the
                  raw ceiling/projected_ordinary delta, not derived from ceiling_room. */}
              {b.ceiling - b.projected_ordinary > 0
                ? `· ordinary ${fmtD(b.projected_ordinary)} — ${fmtD(b.ceiling - b.projected_ordinary)} under bracket ceiling`
                : `· ordinary ${fmtD(b.projected_ordinary)} — ${fmtD(b.projected_ordinary - b.ceiling)} OVER bracket ceiling`}
            </span>
          </div>
          <div style={{ position: 'relative', height: 16, borderRadius: 0,
            background: 'var(--fd-card)', overflow: 'visible' }}>
            {/* Dividends segment */}
            <div title={`Dividends: ${fmtD(b.fwd_income)}`} style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: divW,
              background: C.green + 'aa', borderRadius: '3px 0 0 3px',
            }} />
            {/* Conversion segment */}
            <div title={`Roth conversion: ${fmtD(b.annual_conv_target)}`} style={{
              position: 'absolute', left: divW, top: 0, bottom: 0, width: convW,
              background: C.amber + 'aa',
            }} />
            {/* Other ordinary segment (W2 + STCG + any remaining ordinary income) */}
            <div title={`W2 + STCG + other ordinary: ${fmtD(Math.max(0, b.projected_ordinary - b.fwd_income - b.annual_conv_target))}`} style={{
              position: 'absolute', left: `calc(${divW} + ${convW})`, top: 0, bottom: 0, width: otherW,
              background: C.red + '77',
            }} />
            {/* NIIT threshold line */}
            <div style={{
              position: 'absolute', left: niitW, top: -3, bottom: -3, width: 1.5,
              background: C.red, zIndex: 2,
            }} />
            <span style={{
              position: 'absolute', left: `calc(${niitW} + 3px)`, top: 0,
              fontSize: 12, fontWeight: 500, color: C.red,
              fontFamily: 'var(--font-mono)', lineHeight: '16px', whiteSpace: 'nowrap',
            }}>NIIT {(b.niit_threshold / 1000).toFixed(0)}K</span>
            {/* Bracket ceiling line */}
            {b.ceiling > 0 && b.ceiling !== b.niit_threshold && (
              <>
                <div style={{
                  position: 'absolute', left: ceilW, top: -3, bottom: -3, width: 1.5,
                  background: C.muted + '88', zIndex: 2,
                }} />
                <span style={{
                  position: 'absolute', left: `calc(${ceilW} + 3px)`, top: 0,
                  fontSize: 12, color: C.muted,
                  fontFamily: 'var(--font-mono)', lineHeight: '16px', whiteSpace: 'nowrap',
                }}>ceil {(b.ceiling / 1000).toFixed(0)}K</span>
              </>
            )}
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            {[
              [C.green + 'aa', `Divs ${fmtD(b.fwd_income)}`],
              [C.amber + 'aa', `Conv ${fmtD(b.annual_conv_target)}`],
              [C.red + '77',   `W2+STCG+Other ${fmtD(Math.max(0, b.projected_ordinary - b.fwd_income - b.annual_conv_target))}`],
            ].map(([clr, lbl]) => (
              <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 0, background: clr as string }} />
                <span style={{ fontSize: 12, color: C.muted }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Verdict chips ── */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {chips.map(ch => (
            <span key={ch.label} style={{
              fontSize: 12, fontWeight: 500, color: ch.color,
              border: `1px solid ${ch.color}`, borderRadius: 0,
              padding: '2px 8px', background: ch.color + '0e',
            }}>{ch.label}</span>
          ))}
        </div>

      </div>
    </div>
  )
}

// ── Market Crash Playbook ────────────────────────────────────────────────────────

function MarketCrashPlaybook() {
  const [open, setOpen] = useState(false)

  const rows: Array<{ trigger: string; action: string; color: string }> = [
    { trigger: 'Decline > 20% (bear market)', action: 'SUSPEND all scheduled LTCG sells · harvest losses in taxable · accelerate Roth conversions at depressed values', color: C.red },
    { trigger: 'Decline 10–20% (correction)', action: 'PAUSE new sells · review lot schedule · if SMH is still above 65%, small trim is acceptable', color: C.amber },
    { trigger: 'Decline < 10% (normal vol)', action: 'HOLD plan · SMH swings of ±10% are expected · do not react to single-day moves', color: C.green },
    { trigger: 'VIX > 35 (panic regime)', action: 'No discretionary sells · refill cash bucket from scheduled liquidations only · wait for VIX < 25 before resuming plan', color: C.red },
    { trigger: 'Growth sleeve < 50% of target', action: 'HALT rebalance sells · let existing income cover spending · reassess 30-day bucket needs', color: C.amber },
    { trigger: 'Cash bucket < 6 months', action: 'Prioritize cash refill over rebalance · sell smallest tax-cost lots first · defer LTCG optimization', color: C.amber },
  ]

  return (
    <Card>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
        <SectionLabel text="Market Crash Playbook" />
        <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>
          {open ? '▲ collapse' : '▼ expand'}
        </span>
      </div>

      {open && (
        <>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.6 }}>
            Decision rules for suspending or modifying the rebalance plan during market stress.
            These override the scheduled plan — preserve capital first, optimize taxes second.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {rows.map(r => (
              <div key={r.trigger} style={{ display: 'flex', gap: 10, padding: '6px 10px', borderRadius: 0,
                background: r.color + '08', borderLeft: `3px solid ${r.color}55` }}>
                <div style={{ minWidth: 180, fontSize: 12, fontWeight: 500, color: r.color, lineHeight: 1.4 }}>
                  {r.trigger}
                </div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, flex: 1 }}>
                  {r.action}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, padding: '7px 10px', borderRadius: 0,
            background: 'var(--fd-card)',
            fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
            <strong style={{ color: C.text }}>Recovery resume checklist:</strong>
            {' '}VIX below 25 · portfolio off lows · no imminent rate decisions · cash bucket ≥ 6 months.
            Resume from the next scheduled step — do not attempt to make up skipped steps.
          </div>
        </>
      )}
    </Card>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────────

export function RebalancePlanPanel({ data, mode }: { data: DashboardData; mode?: string }) {
  // Synced with the Drawdown tab: from_taxable is this year's planned cash
  // need from the taxable account (Annual Decision Engine), shared via
  // context so it reflects whatever income target / Roth conversion toggle
  // the user has set in Drawdown — even after switching tabs.
  const { annualDecision } = useDrawdownPlan()
  const cashNeed = Math.max(0, annualDecision.from_taxable)
  const plan = useMemo(() => buildPlan(data, cashNeed), [data, cashNeed])
  const [selectedStep, setSelectedStep] = useState<TradeStep | null>(null)

  if (!plan.ok) {
    return (
      <div style={{ padding: 24, textAlign: 'center',
        background: C.surf, borderRadius: 0,
        border: '1px solid var(--fd-hairline)',
        fontSize: 12, color: C.green }}>
         {plan.reason_skip}
      </div>
    )
  }

  const hasMains = plan.steps.some(s => s.buys.some(b => b.symbol === 'MAIN'))
  const totalStcgUnrealized = data.tax_data?.total_stcg_unrealized_gain ?? 0
  const totalLtcgUnrealized = data.tax_data?.total_ltcg_unrealized_gain ?? 0
  const firstWaiting        = plan.waiting[0]
  const cy = new Date().getFullYear()
  const maxStepYear = plan.steps.length > 0 ? Math.max(...plan.steps.map(s => s.year)) : cy

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Step detail popup */}
      {selectedStep && (
        <StepDetailModal step={selectedStep} onClose={() => setSelectedStep(null)} />
      )}

      {/* MAIN placeholder blocker */}
      {hasMains && (
        <div style={{ padding: '10px 14px', background: 'var(--fd-card)',
          border: '1px solid var(--fd-hairline)', borderLeft: '4px solid var(--red)',
          borderRadius: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.red, marginBottom: 4 }}>
             MAIN IS A PLACEHOLDER — DO NOT EXECUTE ANY TRADE UNTIL REPLACED
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>
            Every trade step allocates a portion of proceeds to a symbol named "MAIN" — this is a placeholder
            for a planned fund that has not yet been selected. Replace "MAIN" in your target allocation
            configuration with an actual fund ticker before executing any sell or buy.
          </div>
        </div>
      )}

      {/* STCG-only bridging message — shown when no LTCG is available yet */}
      {totalLtcgUnrealized === 0 && totalStcgUnrealized > 0 && plan.waiting.length > 0 && (
        <div style={{ padding: '8px 12px', borderRadius: 0,
          background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
          borderLeft: '3px solid var(--cyan)',
          fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>
          <strong style={{ color: 'var(--cyan)' }}>All {fmtD(totalStcgUnrealized)} in unrealized gains are currently STCG.</strong>{' '}
          As lots mature to LTCG
          {firstWaiting ? ` (first batch: ${firstWaiting.maturity_date})` : ''},
          they become eligible for the rebalance schedule below.
          No trades are scheduled until at least one lot reaches LTCG status.
        </div>
      )}

      {/* Drawdown sync banner — shows how much of this year's taxable cash need
          (from Drawdown's Annual Decision Engine) is covered by rebalance-drift
          selling vs. an additional draw from next-most-overweight positions. */}
      {plan.cash_need > 0 && (
        <div style={{ padding: '8px 12px', borderRadius: 0,
          background: plan.withdrawal_draw > 0 ? 'var(--fd-card)' : 'var(--fd-card)',
          border: `1px solid ${plan.withdrawal_draw > 0 ? 'var(--fd-hairline)' : 'var(--fd-hairline)'}`,
          borderLeft: `3px solid ${plan.withdrawal_draw > 0 ? 'var(--cyan)' : 'var(--green)'}`,
          fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>
          <strong style={{ color: plan.withdrawal_draw > 0 ? 'var(--cyan)' : 'var(--green)' }}>
            Synced with Drawdown plan:
          </strong>{' '}
          this year's plan needs {fmtD(plan.cash_need)} from taxable.{' '}
          {plan.rebalance_only_need > 0 && `Rebalance-drift selling already covers ${fmtD(Math.min(plan.rebalance_only_need, plan.cash_need))}.`}
          {plan.withdrawal_draw > 0
            ? ` An additional ${fmtD(plan.withdrawal_draw)} is drawn from the next most-overweight taxable positions below to fund the withdrawal.`
            : ' Rebalance-drift selling alone covers the full withdrawal need.'}
        </div>
      )}

      {/* 1. Tax Ceiling Status — 4 tiles + income bar + verdict */}
      <TaxCeilingCard plan={plan} />

      {/* 2. Rebalance Timeline — year groups with month rows, click for Schwab detail */}
      <RebalanceTimeline plan={plan} onSelectStep={setSelectedStep} />

      {/* 3. Calendar heatmap — click an amber cell for popup detail */}
      <ActionPlan
        steps={plan.steps}
        waiting={plan.waiting}
        today_is_bad={plan.today_is_bad}
        onSelectStep={setSelectedStep}
        shared={plan.shared}
      />

      {/* 3. Don't trade this month */}
      {plan.today_is_bad && <NotNowBanner reason={plan.bad_month_reason} />}

      {/* 4+. Advanced detail — hidden in simple mode */}
      {mode === 'advanced' && (
        <>
          {/* Annual budget constraint — NIIT vs conversion vs LTCG bar */}
          <SharedBudgetCard s={plan.shared} />

          {/* Where you are vs target allocation */}
          {plan.alloc_rows.length > 0 && <AllocationTable rows={plan.alloc_rows} />}

          {/* ── DRILL-DOWN: full Schwab execution detail for each step ── */}
          <div style={{ fontSize: 12, fontWeight: 500, color: C.muted,
            textTransform: 'uppercase', letterSpacing: '1px',
            padding: '4px 0 0', borderTop: '1px solid var(--fd-hairline)' }}>
            Full execution detail — lot selection + Schwab instructions
          </div>

          {/* 5. Detailed trade step cards — consecutive annual steps collapse into a repeating-phase banner */}
          {plan.steps.length > 0
            ? groupSteps(plan.steps).map((item, idx) =>
                item.type === 'single'
                  ? <TradeStepCard key={`${item.step.year}-${item.step.month}`} step={item.step} total_steps={plan.steps.length} />
                  : <RepeatingPhaseCard key={`group-${idx}`} steps={item.steps} total_steps={plan.steps.length} />
              )
            : (
              <Card accent={C.amber}>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
                  No LTCG lots available to sell right now — all overweight positions are
                  in STCG lots. STCG lots appear in the Action Plan above at their maturity date.
                </div>
              </Card>
            )
          }

          {/* 6. Summary */}
          <PlanSummary plan={plan} />

          {/* TCJA disclaimer — any step scheduled after 2028 uses extrapolated brackets */}
          {maxStepYear > 2028 && (
            <div style={{ padding: '8px 12px', borderRadius: 0,
              background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
              borderLeft: '3px solid var(--amber)',
              fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>
              <strong style={{ color: 'var(--amber)' }}> TCJA note:</strong>{' '}
              This plan uses 2026 tax brackets through {maxStepYear}.
              TCJA provisions (including current bracket structure) were extended to 2028.
              Tax brackets from 2029 onward are subject to legislative change.
              Steps scheduled in 2029+ should be re-evaluated when future-year brackets are known.
            </div>
          )}

          {/* 7. Market Crash Playbook — stress rules that override the schedule */}
          <MarketCrashPlaybook />
        </>
      )}

    </div>
  )
}
