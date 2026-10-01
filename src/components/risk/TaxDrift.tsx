import { Panel, G, R, A, M, DIM, TAX_C, fmtK } from './shared'
import { fmtMoney } from '../../utils/formatters'
import { MFJ_BRACKETS } from '../../utils/taxConfig'
import type { DashboardData } from '../../types/dashboard'

// ─── 3. TAX DRIFT ─────────────────────────────────────────────────────────────
export function TaxDrift({ data }: { data: DashboardData }) {
  const tx  = data.tax_data
  const rows = (tx.projections_recommended ?? tx.projections ?? []).slice(0, 4)

  function topBracket(taxable: number): number {
    for (let i = MFJ_BRACKETS.length - 1; i >= 0; i--) {
      if (taxable > MFJ_BRACKETS[i].min) return MFJ_BRACKETS[i].rate
    }
    return 0.10
  }

  const niitLabel = tx.niit_applies ? `YES — ${fmtMoney(tx.niit_amount ?? 0)}` : (tx.niit_headroom != null ? `${fmtMoney(tx.niit_headroom)} headroom` : 'N/A')
  const niitColor = tx.niit_applies ? R : G

  return (
    <Panel title="◈ Tax Drift" sub="Forward bracket pressure · 3-year outlook" color={TAX_C}>
      {rows.length > 0 ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${rows.length}, 1fr)`, gap: '0 8px', marginBottom: 8 }}>
            <div />
            {rows.map(r => (
              <div key={r.year} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: M, textAlign: 'center' }}>{r.year}</div>
            ))}

            <div style={{ fontSize: 12, color: DIM, paddingTop: 4 }}>BRACKET</div>
            {rows.map(r => {
              const stdDed  = tx.std_deduction ?? 30_000
              const taxable = Math.max(0, (r.gross_income ?? (r.dividends + r.ss_income + (r.conversion ?? 0))) - stdDed)
              const br = topBracket(taxable)
              return (
                <div key={r.year} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: br >= 0.32 ? R : br >= 0.24 ? A : G, textAlign: 'center', paddingTop: 2 }}>
                  {(br * 100).toFixed(0)}%
                </div>
              )
            })}

            <div style={{ fontSize: 12, color: DIM, paddingTop: 6 }}>CONV CAP</div>
            {rows.map(r => {
              const cap = r.conversion ?? 0
              return (
                <div key={r.year} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: cap > 0 ? TAX_C : DIM, textAlign: 'center', paddingTop: 4 }}>
                  {cap > 0 ? fmtK(cap) : '—'}
                </div>
              )
            })}

            <div style={{ fontSize: 12, color: DIM, paddingTop: 6 }}>0% ROOM</div>
            {rows.map((r, i) => {
              const ltcgRoom = i === 0 ? tx.ltcg_0pct_room : null
              return (
                <div key={r.year} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: ltcgRoom != null ? (ltcgRoom > 0 ? G : R) : M, textAlign: 'center', paddingTop: 4 }}>
                  {ltcgRoom != null ? (ltcgRoom <= 0 ? 'NONE' : fmtK(ltcgRoom)) : '—'}
                </div>
              )
            })}
          </div>

          <div style={{ borderTop: '1px solid var(--border2)', paddingTop: 8, display: 'flex', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 2 }}>NIIT Exposure</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: niitColor }}>{niitLabel}</div>
            </div>
            {tx.bracket_status && (
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 2 }}>Bracket Status</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: tx.bracket_status === 'OK' ? G : tx.bracket_status === 'CRITICAL' ? R : A }}>{tx.bracket_status}</div>
              </div>
            )}
            {tx.bracket_pace_pct != null && (
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 2 }}>Bracket Pace</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: tx.bracket_pace_pct > 100 ? R : A }}>{tx.bracket_pace_pct.toFixed(0)}%</div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: DIM }}>No projection data available.</div>
      )}
    </Panel>
  )
}
