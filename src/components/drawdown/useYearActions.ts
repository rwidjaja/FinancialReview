/**
 * useYearActions — the literal, dollar-amount "what to do this year" list.
 *
 * Single source of truth shared by Drawdown tab's PersistentActionChecklist
 * and Roadmap tab's current-phase checklist, both reading the same
 * DrawdownPlanContext so the two tabs can never show different numbers for
 * the same year.
 */
import type { DashboardData } from '../../types/dashboard'
import { computeBucketStatus } from '../../utils/retirementEngine'
import { useDrawdownPlan } from '../../context/DrawdownPlanContext'
import { fmtMoney } from '../../utils/formatters'

export type ActionPriority = 'urgent' | 'high' | 'medium' | 'low'
export interface YearAction {
  icon: string
  text: string
  sub: string
  priority: ActionPriority
}

export function useYearActions(data: DashboardData): YearAction[] {
  const { inputs, annualDecision: annual } = useDrawdownPlan()

  const { swvxxValue, bucketYearsRequired: bucketYears, requiredBucket } = computeBucketStatus(data)
  const bucketShortfall = Math.max(0, requiredBucket - swvxxValue)

  const totalPortfolio = inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance
  const allPositions = (data.accounts ?? []).flatMap(a => a.positions ?? [])
  const topConc = allPositions
    .filter(p => !p.is_money_market && (p.value ?? 0) > 0)
    .map(p => ({ symbol: p.symbol ?? '?', pct: totalPortfolio > 0 ? p.value / totalPortfolio * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct)[0] as { symbol: string; pct: number } | undefined
  const hasConc = topConc && topConc.pct > 15

  // Roth conversion — differentiate required stop vs optional headroom.
  // conv_room_real/converted_ytd come straight off `inputs`-derived server
  // fields, same as computeAnnualDecision uses internally.
  const convSafetyBuf = (data.tax_data.safety_buffer as number | null | undefined) ?? 0
  const convRoomReal = (data.tax_data.target_bracket_ceiling != null && data.tax_data.gross_no_ss != null)
    ? Math.max(0, data.tax_data.target_bracket_ceiling - data.tax_data.gross_no_ss)
    : (data.tax_data.conv_room_real ?? 0)
  const convertedYtd = data.tax_data.converted_ytd ?? 0
  const taxOptimalAmount = Math.max(0, convRoomReal - convSafetyBuf)
  const conversionHeadroom = Math.max(0, taxOptimalAmount - convertedYtd)
  const currentYear = new Date().getFullYear()

  const actions: YearAction[] = []

  if (bucketShortfall > 0)
    actions.push({ icon: '→', text: `Refill SWVXX by ${fmtMoney(bucketShortfall)}`, sub: `${bucketYears}-yr cash reserve underfunded`, priority: 'high' })

  if (annual.from_taxable > 0)
    actions.push({ icon: '✓', text: `Withdraw ${fmtMoney(annual.from_taxable)} from taxable`,
      sub: annual.no_lot_data
        ? 'controlled sale — taxable first (no lot-level cost-basis data available)'
        : annual.ltcg_from_taxable > 0 && annual.stcg_from_taxable > 0
          ? `mixed sale — ${fmtMoney(annual.ltcg_from_taxable)} LTCG + ${fmtMoney(annual.stcg_from_taxable)} STCG · taxable first`
          : annual.stcg_from_taxable > 0
            ? `no mature LTCG lots available — ${fmtMoney(annual.stcg_from_taxable)} STCG gain at ordinary rate`
            : 'controlled LTCG harvest — taxable first',
      priority: 'high' })

  if (annual.tax_optimal_exceeded)
    actions.push({ icon: '', text: 'STOP additional Roth conversions', sub: `${fmtMoney(convertedYtd)} already done · above ${currentYear} optimal`, priority: 'urgent' })
  else if (inputs.do_roth_conversion && annual.roth_conversion > 0 && annual.bracket_headroom > 5000)
    actions.push({ icon: '✓', text: `Convert ${fmtMoney(annual.roth_conversion)} to Roth`, sub: `by Dec 31 · ${fmtMoney(conversionHeadroom)} headroom remaining`, priority: 'medium' })
  else if (inputs.do_roth_conversion && conversionHeadroom > 0)
    actions.push({ icon: '→', text: `Optional: convert up to ${fmtMoney(conversionHeadroom)} to Roth`, sub: 'fills 24% bracket · not required', priority: 'low' })

  if (hasConc && topConc)
    actions.push({ icon: '', text: `Reduce ${topConc.symbol} (${topConc.pct.toFixed(0)}% of portfolio)`, sub: 'single position above 15% threshold', priority: 'medium' })

  actions.push({ icon: '→', text: 'Route all dividends to SWVXX', sub: 'keep cash reserve funded automatically', priority: 'low' })

  return actions
}
