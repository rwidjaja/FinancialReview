import { fmtMoneyFull, fmtPctAbs } from '../../utils/formatters'
import { STCG_WARNING_THRESHOLD } from '../../utils/constants'
import { R, A, G, M, Y, B } from './taxColors'
import { BracketBar } from './BracketBar'
import type { DashboardData } from '../../types/dashboard'

export function TaxEstimate({ tx, effRateColor }: {
  tx: DashboardData['tax_data']
  effRateColor: (r: number | null) => string
}) {
  const w2Only    = tx.tax_w2_only ?? 0
  const divOnly   = tx.tax_div_only ?? 0
  const stcgAdd   = tx.tax_stcg_add ?? 0
  const convAdd   = tx.tax_conv_add ?? 0
  const ltcgTax   = tx.tax_ltcg ?? 0
  const taxTotal  = tx.total_tax_with_cg ?? tx.tax_no_ss ?? 1
  const w2Pct     = taxTotal > 0 ? Math.round(w2Only   / taxTotal * 100) : 0
  const divPct    = taxTotal > 0 ? Math.round(divOnly  / taxTotal * 100) : 0
  const stcgPct   = taxTotal > 0 ? Math.round(stcgAdd  / taxTotal * 100) : 0
  const convPct   = taxTotal > 0 ? Math.round(convAdd  / taxTotal * 100) : 0
  const ltcgPct   = taxTotal > 0 ? Math.round(ltcgTax  / taxTotal * 100) : 0
  const convForAttr = (tx.converted_ytd && tx.converted_ytd > 0) ? tx.converted_ytd : (tx.annual_conversion ?? 0)

  // Layer 1: Income Summary Ledger rows
  const rocAmt = tx.total_roc_div ?? 0
  type LedgerRow = { label: string; amount: string; sub?: string; subtract?: boolean; total?: boolean; color?: string }
  const ledgerRows: LedgerRow[] = [
    ...((tx.annual_w2 ?? 0) > 0 ? [{
      label: 'W2 Salary',
      amount: fmtMoneyFull(tx.annual_w2 ?? 0),
      sub: 'Earned income — fills the lowest brackets first',
    }] : []),
    {
      label: 'Cash Distributions',
      amount: fmtMoneyFull(tx.annual_div_total ?? 0),
      sub: 'all accounts incl. ROC · Rollover IRA divs reinvest tax-deferred (not spendable)',
    },
    {
      label: 'AGI Dividends',
      amount: fmtMoneyFull(tx.annual_div_for_agi ?? 0),
      sub: `Excludes ${fmtMoneyFull(rocAmt)} ROC`,
    },
    ...((tx.ytd_stcg_gross ?? tx.ytd_stcg_realized ?? 0) > 0 ? [{
      label: 'STCG Realized',
      amount: fmtMoneyFull(tx.ytd_stcg_gross ?? tx.ytd_stcg_realized ?? 0),
      sub: 'Short-term gains — ordinary rate',
      color: Y,
    }] : []),
    ...((tx.ytd_stcg_loss ?? 0) < 0 ? [{
      label: 'Tax Loss Harvesting',
      amount: fmtMoneyFull(tx.ytd_stcg_loss ?? 0),
      sub: `harvested against realized gains · net STCG in AGI: ${fmtMoneyFull(tx.ytd_stcg_realized ?? 0)} · gain/loss computed via FIFO lot basis`,
      subtract: true,
      color: G,
    }] : []),
    ...((tx.ytd_ltcg_realized ?? 0) > 0 ? [{
      label: 'LTCG Realized',
      amount: fmtMoneyFull(tx.ytd_ltcg_realized ?? 0),
      sub: 'Long-term gains — preferential rate (not in bracket)',
      color: G,
    }] : []),
    {
      label: 'Roth Conversion',
      amount: fmtMoneyFull(convForAttr ?? 0),
      sub: 'Rollover → Roth',
    },
    {
      label: 'Gross Ordinary Income',
      amount: fmtMoneyFull(tx.gross_no_ss ?? 0),
      sub: 'W2 + Divs + STCG + Conv (bracket basis)',
      total: true,
    },
    {
      label: 'Standard Deduction',
      amount: `(${fmtMoneyFull(tx.std_deduction ?? 0)})`,
      subtract: true,
    },
    {
      label: 'Taxable Ordinary Income',
      amount: fmtMoneyFull(tx.taxable_no_ss ?? 0),
      total: true,
    },
  ]

  const stcgRealized = tx.ytd_stcg_realized ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* STCG warning — only when realized short-term gains materially reduce conversion room */}
      {stcgRealized >= STCG_WARNING_THRESHOLD && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '8px 12px',
          background: 'var(--fd-card)',
          border: '1px solid var(--fd-hairline)',
          borderLeft: `3px solid ${Y}`,
          borderRadius: 0,
          fontSize: 12,
          color: Y,
        }}>
          <span style={{ fontWeight: 500, flexShrink: 0 }}></span>
          <span>
            Realized STCG {fmtMoneyFull(stcgRealized)} — reduces Roth conversion capacity
          </span>
        </div>
      )}

      {/* Layer 1: Income Summary Ledger */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
          1 · INCOME SUMMARY
        </div>
        <table className="bb-table" style={{ width: '100%' }}>
          <tbody>
            {ledgerRows.map((row, i) => (
              <tr key={i} style={row.total ? { borderTop: '1px solid var(--border2)' } : {}}>
                <td style={{ color: row.total ? 'var(--text)' : M, fontWeight: row.total ? 700 : 400 }}>
                  {row.label}
                  {row.sub && <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400 }}>{row.sub}</div>}
                </td>
                <td className="r" style={{
                  fontFamily: 'var(--font-mono)', fontWeight: row.total ? 700 : 400,
                  color: row.subtract ? M : row.color ?? (row.total ? 'var(--text)' : 'var(--text)'),
                  fontSize: row.total ? 14 : 13,
                }}>
                  {row.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Layer 2: Tax Calculation */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">ORDINARY TAXABLE INCOME</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', margin: '4px 0' }}>{fmtMoneyFull(tx.taxable_no_ss ?? 0)}</div>
          <div className="bb-sub">Gross: {fmtMoneyFull(tx.gross_no_ss ?? 0)} (divs+STCG+conv)</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">TOTAL EST. TAX</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: R, margin: '4px 0' }}>
            {fmtMoneyFull(tx.total_tax_with_cg ?? tx.tax_no_ss ?? 0)}
          </div>
          <div className="bb-sub">
            Ordinary: {fmtMoneyFull(tx.tax_no_ss ?? 0)}
            {(ltcgTax > 0) && <> + LTCG: <span style={{ color: G }}>{fmtMoneyFull(ltcgTax)}</span></>}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">EFFECTIVE RATE</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: effRateColor(tx.eff_rate_no_ss ?? null), margin: '4px 0' }}>
            {tx.eff_rate_no_ss != null ? fmtPctAbs(tx.eff_rate_no_ss) : '—'}
          </div>
          <div className="bb-sub">across all income incl. CG</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">CONVERSION ADD-ON</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: A, margin: '4px 0' }}>
            {tx.tax_conv_add != null ? fmtMoneyFull(tx.tax_conv_add) : '—'}
          </div>
          <div className="bb-sub">marginal conv tax (above div+STCG)</div>
        </div>
      </div>

      {/* Bracket bar */}
      {(tx.breakdown_no_ss ?? []).length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label" style={{ marginBottom: 8 }}>2 · BRACKET BREAKDOWN</div>
          {tx.ordinary_rate_taxable_income != null && (
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
              Filled from {fmtMoneyFull(tx.ordinary_rate_taxable_income)} ordinary-rate income
              {tx.ordinary_taxable_income != null && tx.ordinary_taxable_income > tx.ordinary_rate_taxable_income
                ? ` — excludes ${fmtMoneyFull(tx.ordinary_taxable_income - tx.ordinary_rate_taxable_income)} qualified dividends (taxed at LTCG rates, not ordinary brackets)`
                : ''}
            </div>
          )}
          <BracketBar brackets={tx.breakdown_no_ss} />
        </div>
      )}

      {/* Layer 3: Tax Attribution */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
          3 · TAX ATTRIBUTION
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${w2Only > 0 ? 5 : 4},1fr)`, gap: 8 }}>
          {[
            ...(w2Only > 0 ? [{ label: 'W2 TAX', value: w2Only, pct: w2Pct, color: B, sub: 'earned income — fills the lowest brackets' }] : []),
            { label: 'DIVIDEND TAX',    value: divOnly,  pct: divPct,  color: A,  sub: 'qualified + ordinary divs, incl. NIIT' },
            { label: 'STCG TAX',        value: stcgAdd,  pct: stcgPct, color: Y,  sub: 'incremental, on top of W2+divs, incl. NIIT' },
            { label: 'LTCG TAX',        value: ltcgTax,  pct: ltcgPct, color: G,  sub: ltcgTax === 0 ? 'no LTCG this year (STCG-only) · lots held ≥1 yr convert to 15% LTCG next year' : 'long-term gains (preferential)' },
            { label: 'CONVERSION TAX',  value: convAdd,  pct: convPct, color: R,  sub: convPct > 30 ? `${fmtMoneyFull(convForAttr)} → Roth · tax elevated by conversion · normalized ≈ ${fmtMoneyFull(Math.round(taxTotal - convAdd))}` : `${fmtMoneyFull(convForAttr)} → Roth` },
          ].map(({ label, value, pct, color, sub }) => (
            <div key={label} style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
              <div style={{ fontSize: 12, color: M, marginBottom: 4, textTransform: 'uppercase', fontWeight: 500 }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 500, color }}>{fmtMoneyFull(value)}</div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{pct}% of total · {sub}</div>
              <div style={{ height: 4, background: 'var(--border2)', borderRadius: 0, marginTop: 6 }}>
                <div style={{ height: 4, width: `${pct}%`, background: color, borderRadius: 0 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
