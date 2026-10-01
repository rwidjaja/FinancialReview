import { useState } from 'react'
import { fmtFull, fmtMoneyFull } from '../../utils/formatters'
import { STD_DEDUCTION_MFJ, DEFAULT_BRACKET_RATE } from '../../utils/constants'
import { G, R, A, M } from './taxColors'
import type { DashboardData } from '../../types/dashboard'

export function SSOptions({ tx, onSSChange, isRecalculating }: {
  tx: DashboardData['tax_data']
  onSSChange?: (key: string, option: any) => void
  isRecalculating?: boolean
}) {
  const options = Object.entries(tx.ss_options ?? {})
  const [selectedKey, setSelectedKey] = useState<string>(`age_${tx.ss_start_age}`)

  if (options.length === 0) return <div style={{ padding: 12, color: M, fontSize: 12 }}>No SS options available.</div>

  const handleSelect = (key: string, option: any) => {
    setSelectedKey(key)
    if (onSSChange) {
      onSSChange(key, option)
    }
  }

  // Get the baseline (Age 70) annual amount for comparison; fall back to the
  // largest annual benefit among available options (no hardcoded dollar amount)
  const baselineAnnual = tx.ss_options?.['age_70']?.annual
    ?? Math.max(...options.map(([, opt]) => opt.annual))
  const grossIncomeNoSS = tx.gross_no_ss ?? 0
  const marginalRate = tx.marginal_rate ?? (DEFAULT_BRACKET_RATE / 100)

  // Function to calculate estimated tax for a given SS annual amount
  const calculateEstimatedTax = (ssAnnual: number) => {
    // Approximate taxable SS portion (up to 85%)
    const taxableSS = Math.min(ssAnnual * 0.85, ssAnnual)
    const totalAGI = grossIncomeNoSS + taxableSS
    const stdDeduction = tx.std_deduction ?? STD_DEDUCTION_MFJ
    const taxableIncome = Math.max(0, totalAGI - stdDeduction)
    // Simplified tax calculation using marginal rate
    return taxableIncome * marginalRate
  }

  const baselineTax = calculateEstimatedTax(baselineAnnual)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isRecalculating && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--fd-card)',
          border: `1px solid ${A}`,
          fontSize: 12,
          color: A,
          textAlign: 'center'
        }}>
          ⟳ RECALCULATING TAX SCENARIO…
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="bb-table" style={{ minWidth: 800 }}>
          <thead>
            <tr>
              <th>START AGE</th>
              <th>DATE</th>
              <th className="r">MONTHLY</th>
              <th className="r">ANNUAL</th>
              <th className="r">VS AGE 70</th>
              <th className="r">EST. TAX</th>
              <th className="r">ANNUAL AFTER-TAX</th>
              <th className="r">SELECT</th>
            </tr>
          </thead>
          <tbody>
            {options.map(([key, opt]) => {
              const vsAge70 = ((opt.annual - baselineAnnual) / baselineAnnual) * 100
              const isRecommended = key === `age_${tx.ss_start_age}`
              const isSelected = selectedKey === key

              const estimatedTax = calculateEstimatedTax(opt.annual)
              const afterTaxIncome = opt.annual + grossIncomeNoSS - estimatedTax
              const baselineAfterTax = baselineAnnual + grossIncomeNoSS - baselineTax
              const vsBaselineAfterTax = afterTaxIncome - baselineAfterTax

              return (
                <tr key={key} style={isSelected ? { background: 'var(--fd-card)' } : isRecommended ? { background: 'var(--fd-card)' } : {}}>
                  <td style={{ fontWeight: isRecommended ? 700 : 400, color: isRecommended ? A : 'var(--text)' }}>
                    {opt.label} {isRecommended && '★'}
                  </td>
                  <td style={{ color: M, fontSize: 12 }}>{opt.date}</td>
                  <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(opt.monthly)}</td>
                  <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(opt.annual)}</td>
                  <td className="r" style={{ color: vsAge70 >= 0 ? G : R, fontFamily: 'var(--font-mono)' }}>
                    {vsAge70 >= 0 ? '+' : ''}{vsAge70.toFixed(1)}%
                   </td>
                  <td className="r" style={{ color: estimatedTax < baselineTax ? G : R, fontFamily: 'var(--font-mono)' }}>
                    {fmtFull(estimatedTax)}
                    {!isSelected && (
                      <span style={{ fontSize: 12, color: M }}>
                        {estimatedTax < baselineTax ? ' ↓' : estimatedTax > baselineTax ? ' ↑' : ''}
                      </span>
                    )}
                   </td>
                  <td className="r" style={{ color: vsBaselineAfterTax >= 0 ? G : R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    {fmtFull(afterTaxIncome)}
                    {!isSelected && (
                      <span style={{ fontSize: 12, color: M }}>
                        {vsBaselineAfterTax >= 0 ? ' ↑' : ' ↓'}
                      </span>
                    )}
                   </td>
                  <td className="r">
                    <button
                      onClick={() => handleSelect(key, opt)}
                      disabled={isRecalculating || isSelected}
                      style={{
                        padding: '4px 12px',
                        background: isSelected ? A : 'transparent',
                        color: isSelected ? 'var(--fd-page)' : M,
                        border: `1px solid ${isSelected ? A : 'var(--border2)'}`,
                        cursor: (isRecalculating || isSelected) ? 'not-allowed' : 'pointer',
                        fontSize: 12,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 500,
                        borderRadius: 0,
                        minWidth: 70,
                      }}
                    >
                      {isSelected ? 'ACTIVE ✓' : 'SELECT'}
                    </button>
                   </td>
                 </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: M, padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
         <strong>After-Tax Income</strong> = SS + other income - estimated tax. Higher after-tax income is what matters for your lifestyle.<br/>
        Delaying SS increases total lifetime wealth despite higher taxes.
        {tx.spouse_ss_start_age != null && (
          <><br/> <strong>Spousal benefit</strong> (non-working spouse) = 1/2 of the earner&apos;s benefit, starting at spouse&apos;s age {tx.spouse_ss_start_age}
          {(() => {
            const sel = tx.ss_options?.[`age_${tx.ss_start_age}`]?.annual ?? tx.ss_annual
            return sel ? <> — adds ≈${Math.round(sel * 0.5).toLocaleString()}/yr household (already modeled in Forecast &amp; Drawdown projections)</> : null
          })()}.</>
        )}
      </div>
    </div>
  )
}
