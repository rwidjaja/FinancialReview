import { TerminalSection, DataRow, Divider } from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, A } from './DetailTab.constants'

export function IncomeTTMSection({ data }: { data: DashboardData }) {
  const ia = data.income_analytics
  const pi = data.portfolio_intel
  if (!ia) return null
  const fwd12 = ia.portfolio_fwd_12m
  const taxablePct = pi?.taxable_inc_pct ?? 0
  const taxFreePct = pi?.tax_free_inc_pct ?? 0
  const taxableAmt = fwd12 * (taxablePct / 100)
  const taxFreeAmt = fwd12 * (taxFreePct / 100)
  // Server sends forward_tax_impact as an object {fwd_tax_est, fwd_ordinary, ...}
  // TypeScript type says number|null — unwrap the scalar safely
  const _fwdTaxRaw = ia.forward_tax_impact as unknown
  const fwdTax: number | null = (
    typeof _fwdTaxRaw === 'number' ? _fwdTaxRaw
    : _fwdTaxRaw && typeof _fwdTaxRaw === 'object' ? ((_fwdTaxRaw as any).fwd_tax_est ?? null)
    : null
  )

  // Income attribution — server sends { by_symbol: {SYM: pct}, top5: [[SYM, pct], ...] }
  // top5 pct values are already percentages (e.g. 26.3 = 26.3%).
  // UI renders attr.pct * 100, so we store as fraction (0.263).
  const _top5Raw: [string, number][] = (ia.income_attribution as any)?.top5 ?? []
  const attrs = _top5Raw.slice(0, 8).map(([sym, pct]) => ({
    symbol: sym,
    pct: pct / 100,        // convert 26.3 → 0.263 for display multiply
    tax_status: '',
  }))

  return (
    <TerminalSection id="income-ttm" title="◈ INCOME PROJECTION — TTM" defaultOpen={true} accent={G}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Row 1: 3 headline cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {/* Forward 12M */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${G}`, borderRadius: 0, padding: '12px 14px' }}>
            <div className="bb-label">FWD 12M INCOME</div>
            <div style={{ fontSize: 26, fontWeight: 500, color: G, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
              {fmtMoneyFull(fwd12)}
            </div>
            <div className="bb-sub">{fmtMoney(fwd12 / 12)}/mo avg</div>
            <Divider />
            {(() => {
              const _td   = data.tax_data
              const _ceil = _td?.target_bracket_ceiling
              if (_ceil == null) return null
              const _room = Math.max(0, _ceil - fwd12)
              const _color = _room > 0 ? G : R
              const _rate  = _td?.target_bracket_rate ?? 24
              return (
                <DataRow label="DIV. HEADROOM" value={
                  <span style={{ color: _color, fontWeight: 500 }}>
                    {fmtMoney(_room)}
                  </span>
                } sub={`vs ${_rate}% bracket ceiling`} />
              )
            })()}
          </div>

          {/* Tax Status */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
            <div className="bb-label">DIVIDEND TAX COMPOSITION</div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: R }}>TAXABLE DIVIDENDS</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: R, fontFamily: 'var(--font-mono)' }}>{fmtMoney(taxableAmt)}</span>
                </div>
                <MiniBar value={taxablePct} color={R} height={4} />
                <div className="bb-sub" style={{ marginTop: 2 }}>{taxablePct.toFixed(1)}% of total</div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: G }}>TAX-FREE INCOME</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoney(taxFreeAmt)}</span>
                </div>
                <MiniBar value={taxFreePct} color={G} height={4} />
                <div className="bb-sub" style={{ marginTop: 2 }}>{taxFreePct.toFixed(1)}% of total</div>
              </div>
              {fwdTax != null && (
                <>
                  <Divider />
                  <DataRow label="EST FWD TAX IMPACT" value={<span style={{ color: R }}>-{fmtMoney(fwdTax)}</span>} />
                  <DataRow label="AFTER-TAX INCOME" value={<span style={{ color: G, fontWeight: 500 }}>{fmtMoneyFull(fwd12 - fwdTax)}</span>} />
                </>
              )}
            </div>
          </div>

          {/* Attribution */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
            <div className="bb-label" style={{ marginBottom: 8 }}>TOP INCOME CONTRIBUTORS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {attrs.map((attr, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12, minWidth: 52 }}>{attr.symbol}</span>
                  <MiniBar value={(attr.pct ?? 0) * 100} color={attr.tax_status === 'tax_free' ? G : R} width={80} height={5} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: G, minWidth: 36 }}>{((attr.pct ?? 0) * 100).toFixed(1)}%</span>
                  <span style={{ fontSize: 12, color: attr.tax_status === 'tax_free' ? G : R }}>{attr.tax_status === 'tax_free' ? 'ROC' : 'ORD'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Per-account income projection */}
        {ia.by_account && Object.keys(ia.by_account).length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
            <div className="bb-label" style={{ marginBottom: 6 }}>BY ACCOUNT — FWD 12M vs YTD INCOME</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {Object.entries(ia.by_account).map(([key, acct]) => {
                const rawPace     = acct.fwd_12m > 0 ? (acct.ytd_income / acct.fwd_12m * 100) : 0
                const isFrontLoad = rawPace > 100
                const pace        = Math.min(100, rawPace)
                const paceColor   = pace >= 90 ? G : pace >= 60 ? 'var(--yellow)' : 'var(--amber)'
                return (
                  <div key={key} style={{ padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>{key}</div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoney(acct.fwd_12m)}/yr</div>
                    {!isFrontLoad && (
                      <div style={{ marginTop: 4 }}>
                        <MiniBar value={pace} color={paceColor} height={4} />
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: isFrontLoad ? A : paceColor, marginTop: 2 }}>
                      YTD: {fmtMoney(acct.ytd_income)}{isFrontLoad ? ` · ${rawPace.toFixed(0)}% — front-loaded` : ` (${pace.toFixed(0)}% pace)`}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </TerminalSection>
  )
}
