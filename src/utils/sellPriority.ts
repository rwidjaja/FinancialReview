/**
 * Controlled-sale ranking — shared sell-order policy for lot selection.
 *
 * The rule this encodes, in priority order:
 *   1. LTCG before STCG      — explicit `is_ltcg` key, never inferred from a day count
 *   2. Growth before income  — keyed off `fund_type`, so the income engine is preserved
 *   3. Lowest yield first    — within the income tier only; the highest-yielding sleeve
 *                              is the last thing touched
 *   4. Smallest gain first   — existing tiebreak: highest basis raises the most cash
 *                              per taxable dollar of gain
 *
 * Why this exists: a controlled sale funds spending. Ordering lots by age (the
 * previous behavior) is not role-neutral — where the income sleeve was bought
 * before the growth sleeve, oldest-first liquidates exactly the holdings the
 * strategy is meant to protect, destroying dividend income while unrealized
 * growth gains sit untouched.
 *
 * Everything here keys off fund attributes (`fund_type`, yield) and never off
 * literal ticker symbols, so retuning the portfolio needs no code change.
 */

/** Fund roles that exist to produce income — the sleeve a controlled sale protects. */
const INCOME_FUND_TYPES: ReadonlySet<string> = new Set(['DIVIDEND', 'CEF', 'OPTION_INCOME'])

export type SellRole = 'GROWTH' | 'INCOME' | 'CASH' | 'UNKNOWN'

/** Classify a holding's role from its fund_type. Unknown types rank as growth-side
 *  (they are not known income producers, so nothing is protected by default). */
export function sellRole(fundType: string | null | undefined, isMoneyMarket?: boolean): SellRole {
  if (isMoneyMarket || fundType === 'MONEY_MARKET') return 'CASH'
  if (fundType == null) return 'UNKNOWN'
  return INCOME_FUND_TYPES.has(fundType) ? 'INCOME' : 'GROWTH'
}

/** Per-symbol attributes the ranking needs, resolved once from positions. */
export interface SymbolRole {
  role: SellRole
  /** Trailing annual yield as a percent (annual_income ÷ market value × 100). */
  yieldPct: number
}

/** Build a symbol → {role, yieldPct} map from account positions.
 *  Positions for the same symbol across accounts are aggregated so yield reflects
 *  the whole holding rather than whichever account happened to be read last. */
export function buildSymbolRoles(
  accounts: { positions?: { symbol: string; value: number; annual_income: number; fund_type?: string; is_money_market?: boolean }[] }[],
): Record<string, SymbolRole> {
  const agg: Record<string, { value: number; income: number; fundType?: string; mm?: boolean }> = {}
  for (const acct of accounts ?? []) {
    for (const p of acct.positions ?? []) {
      const cur = agg[p.symbol] ?? { value: 0, income: 0 }
      cur.value  += p.value ?? 0
      cur.income += p.annual_income ?? 0
      // fund_type is a property of the fund, identical across accounts; keep the
      // first non-null so a partial position elsewhere can't erase it.
      cur.fundType = cur.fundType ?? p.fund_type
      cur.mm = cur.mm || p.is_money_market
      agg[p.symbol] = cur
    }
  }
  const out: Record<string, SymbolRole> = {}
  for (const [sym, a] of Object.entries(agg)) {
    out[sym] = {
      role: sellRole(a.fundType, a.mm),
      yieldPct: a.value > 0 ? (a.income / a.value) * 100 : 0,
    }
  }
  return out
}

/** Minimum shape the comparator needs from a lot. */
export interface RankableLot {
  symbol: string
  is_ltcg: boolean
  gain_loss: number
}

/** Rank tier for the role key — growth-side sells before income. */
function roleRank(role: SellRole): number {
  if (role === 'INCOME') return 1
  return 0   // GROWTH / UNKNOWN / CASH — cash lots carry no gain and drop out earlier
}

/**
 * Comparator implementing the controlled-sale ladder. Use with `.sort()`.
 * Symbols missing from `roles` fall back to growth-side with zero yield, which
 * keeps unclassified holdings ahead of the known income sleeve.
 */
export function compareSellPriority(
  roles: Record<string, SymbolRole>,
  a: RankableLot,
  b: RankableLot,
): number {
  // 1 — LTCG first (explicit, not a days_held proxy)
  if (a.is_ltcg !== b.is_ltcg) return a.is_ltcg ? -1 : 1

  const ra = roles[a.symbol] ?? { role: 'UNKNOWN' as SellRole, yieldPct: 0 }
  const rb = roles[b.symbol] ?? { role: 'UNKNOWN' as SellRole, yieldPct: 0 }

  // 2 — growth before income
  const tierDiff = roleRank(ra.role) - roleRank(rb.role)
  if (tierDiff !== 0) return tierDiff

  // 3 — inside the income tier, sell the lowest-yielding sleeve first so the
  // highest-yielding one survives longest. Growth lots skip this (yields are
  // incidental there) and fall straight through to the gain tiebreak.
  if (ra.role === 'INCOME' && rb.role === 'INCOME' && ra.yieldPct !== rb.yieldPct) {
    return ra.yieldPct - rb.yieldPct
  }

  // 4 — smallest gain first: highest basis, most proceeds per taxable dollar
  return a.gain_loss - b.gain_loss
}

/** Human-readable description of the active ordering, for display next to results. */
export function sellPriorityExplanation(incomeExcluded: boolean): string {
  return incomeExcluded
    ? 'Order: LTCG first → smallest gain first. Income holdings excluded — the active withdrawal state does not permit trimming them.'
    : 'Order: LTCG first → growth before income → lowest-yielding income last → smallest gain first (highest basis = most cash per taxable dollar).'
}

export { INCOME_FUND_TYPES }
