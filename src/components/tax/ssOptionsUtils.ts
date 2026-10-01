import { DEFAULT_BRACKET_RATE, DEFAULT_SAFETY_BUFFER, STD_DEDUCTION_MFJ } from '../../utils/constants'
import { MFJ_BRACKETS } from '../../utils/taxConfig'
import type { DashboardData } from '../../types/dashboard'

// Client-side tax recalculation with new SS parameters
export function recalculateTaxWithSS(
  baseTaxData: DashboardData['tax_data'],
  newSSAnnual: number,
  newSSStartAge: number
): DashboardData['tax_data'] {
  // Create a deep copy
  const newTaxData = JSON.parse(JSON.stringify(baseTaxData))

  // Update SS parameters
  newTaxData.ss_annual = newSSAnnual
  newTaxData.ss_start_age = newSSStartAge

  // Update SS years until start
  const currentAge = newTaxData.current_age
  newTaxData.ss_years_until = Math.max(0, newSSStartAge - currentAge)

  // Calculate taxable SS portion based on provisional income
  const grossNoSS = newTaxData.gross_no_ss ?? 0
  const provisionalIncome = grossNoSS + (newSSAnnual * 0.5)
  const filingStatus = newTaxData.filing_status || 'MFJ'
  const baseThreshold = filingStatus === 'MFJ' ? 32000 : 25000
  const upperThreshold = filingStatus === 'MFJ' ? 44000 : 34000

  let taxableSSPct = 0
  if (provisionalIncome > upperThreshold) {
    taxableSSPct = 0.85
  } else if (provisionalIncome > baseThreshold) {
    taxableSSPct = 0.5
  }

  newTaxData.ss_taxable_amt = newSSAnnual * taxableSSPct
  newTaxData.ss_taxable_pct = taxableSSPct

  // Update gross income with SS
  newTaxData.gross_with_ss = grossNoSS + newTaxData.ss_taxable_amt

  // Calculate taxable income
  const stdDeduction = newTaxData.std_deduction ?? STD_DEDUCTION_MFJ
  const taxableIncome = Math.max(0, newTaxData.gross_with_ss - stdDeduction)
  newTaxData.taxable_with_ss = taxableIncome

  // Calculate tax
  let remainingIncome = taxableIncome
  let totalTax = 0
  let prevLimit = 0
  const breakdown = []

  for (const bracket of MFJ_BRACKETS) {
    const bracketAmount = Math.max(0, Math.min(remainingIncome, bracket.max - prevLimit))
    if (bracketAmount > 0) {
      const taxInBracket = bracketAmount * bracket.rate
      totalTax += taxInBracket
      breakdown.push({
        rate: bracket.rate,
        amount_in_bracket: bracketAmount,
        tax_in_bracket: taxInBracket
      })
      remainingIncome -= bracketAmount
    }
    prevLimit = bracket.max
    if (remainingIncome <= 0) break
  }

  newTaxData.tax_with_ss = Math.round(totalTax)
  newTaxData.breakdown_with_ss = breakdown
  newTaxData.eff_rate_with_ss = newTaxData.gross_with_ss > 0
    ? (totalTax / newTaxData.gross_with_ss) * 100
    : 0

  // Update bracket pressure for target bracket.
  // Server semantics (portfolio_data): pressure = AGI / gross bracket ceiling × 100,
  // where ceiling = taxable bracket max + std deduction. Keep the same definition
  // here so the BRACKET PRESSURE tile doesn't change meaning after an SS click.
  const targetBracketRate = newTaxData.target_bracket_rate ?? DEFAULT_BRACKET_RATE
  const targetBracketIndex = MFJ_BRACKETS.findIndex(b => b.rate * 100 >= targetBracketRate)
  const bracketCeilTaxable = MFJ_BRACKETS[targetBracketIndex]?.max
    ?? MFJ_BRACKETS[MFJ_BRACKETS.length - 2]?.max
    ?? 201050
  const grossCeiling = newTaxData.target_bracket_ceiling ?? (bracketCeilTaxable + stdDeduction)

  newTaxData.bracket_pressure_pct = grossCeiling > 0
    ? (newTaxData.gross_with_ss / grossCeiling) * 100
    : 0

  // Add bracket pressure trend label
  if (newTaxData.bracket_pressure_pct >= 90) {
    newTaxData.bracket_pressure_trend = 'At ceiling — conversion window closing'
  } else if (newTaxData.bracket_pressure_pct >= 70) {
    newTaxData.bracket_pressure_trend = 'Elevated — monitor conversion timing'
  } else {
    newTaxData.bracket_pressure_trend = 'Comfortable room for conversions'
  }

  // Update conversion room — server semantics: gross ceiling − AGI − safety buffer
  const safetyBuffer = newTaxData.safety_buffer ?? DEFAULT_SAFETY_BUFFER
  newTaxData.conv_room_real = Math.max(0, grossCeiling - newTaxData.gross_with_ss - safetyBuffer)

  // Update conversion efficiency score
  const marginalRate = MFJ_BRACKETS[targetBracketIndex]?.rate ?? DEFAULT_BRACKET_RATE / 100
  newTaxData.conv_efficiency_score = Math.min(100, Math.max(0,
    100 - (newTaxData.bracket_pressure_pct * 0.6) - (marginalRate * 100 * 0.4)
  ))

  // Update conversion action based on score
  if (newTaxData.conv_efficiency_score >= 70) {
    newTaxData.conv_action = 'CONVERT AGGRESSIVELY'
    newTaxData.conv_action_icon = ''
    newTaxData.conv_score = 8.5
  } else if (newTaxData.conv_efficiency_score >= 40) {
    newTaxData.conv_action = 'CONVERT SELECTIVELY'
    newTaxData.conv_action_icon = '→'
    newTaxData.conv_score = 6.0
  } else {
    newTaxData.conv_action = 'DEFER CONVERSION'
    newTaxData.conv_action_icon = '○'
    newTaxData.conv_score = 3.5
  }

  return newTaxData
}
