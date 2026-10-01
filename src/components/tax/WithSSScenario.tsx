import { fmtMoneyFull, fmtPctAbs } from '../../utils/formatters'
import { G, R, Y } from './taxColors'
import { BracketBar } from './BracketBar'
import type { DashboardData } from '../../types/dashboard'

export function WithSSScenario({ tx, effRateColor }: {
  tx: DashboardData['tax_data']
  effRateColor: (r: number | null) => string
}) {
  const ssAmt = tx.ss_taxable_amt
  const ssPct = tx.ss_taxable_pct
  const taxIncrease = (tx.tax_with_ss ?? 0) - (tx.tax_no_ss ?? 0)
  const afterTaxIncomeWithSS = (tx.gross_with_ss ?? 0) - (tx.tax_with_ss ?? 0)
  const afterTaxIncomeNoSS = (tx.gross_no_ss ?? 0) - (tx.tax_no_ss ?? 0)
  const netBenefit = afterTaxIncomeWithSS - afterTaxIncomeNoSS

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">GROSS WITH SS</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text)', margin: '4px 0' }}>{fmtMoneyFull(tx.gross_with_ss ?? 0)}</div>
          <div className="bb-sub">SS + other income</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">SS TAXABLE PORTION</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: Y, margin: '4px 0' }}>{fmtMoneyFull(ssAmt ?? 0)}</div>
          {ssPct != null && <div className="bb-sub">{fmtPctAbs(ssPct * 100)} of SS benefit</div>}
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">ESTIMATED TAX</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: R, margin: '4px 0' }}>{fmtMoneyFull(tx.tax_with_ss ?? 0)}</div>
          <div className="bb-sub">
            vs {fmtMoneyFull(tx.tax_no_ss ?? 0)} without SS
            {taxIncrease > 0 && <span style={{ color: R }}> (+{fmtMoneyFull(taxIncrease)})</span>}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">EFFECTIVE RATE</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: effRateColor(tx.eff_rate_with_ss ?? null), margin: '4px 0' }}>
            {tx.eff_rate_with_ss != null ? fmtPctAbs(tx.eff_rate_with_ss) : '—'}
          </div>
          <div className="bb-sub">of total income</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">AFTER-TAX INCOME</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: G, margin: '4px 0' }}>
            {fmtMoneyFull(afterTaxIncomeWithSS)}
          </div>
          <div className="bb-sub">
            net spendable income
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, borderLeft: netBenefit >= 0 ? `3px solid ${G}` : `3px solid ${R}`, padding: '10px 14px' }}>
          <div className="bb-label">NET BENEFIT OF SS</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: netBenefit >= 0 ? G : R, margin: '4px 0' }}>
            {netBenefit >= 0 ? '+' : ''}{fmtMoneyFull(netBenefit)}
          </div>
          <div className="bb-sub">
            after-tax gain from SS
            {netBenefit >= 0 ? ' ✓' : ' '}
          </div>
        </div>
      </div>
      {(tx.breakdown_with_ss ?? []).length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label" style={{ marginBottom: 8 }}>BRACKET BREAKDOWN — WITH SOCIAL SECURITY SCENARIO</div>
          {tx.ordinary_rate_taxable_income_with_ss != null && (
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
              Filled from {fmtMoneyFull(tx.ordinary_rate_taxable_income_with_ss)} ordinary-rate income (incl. SS)
              {tx.taxable_with_ss != null && tx.taxable_with_ss > tx.ordinary_rate_taxable_income_with_ss
                ? ` — excludes ${fmtMoneyFull(tx.taxable_with_ss - tx.ordinary_rate_taxable_income_with_ss)} qualified dividends (taxed at LTCG rates). Do not compare to the no-SS scenario's Ordinary Taxable Income — different base (includes SS).`
                : ''}
            </div>
          )}
          <BracketBar brackets={tx.breakdown_with_ss} />
        </div>
      )}
    </div>
  )
}
