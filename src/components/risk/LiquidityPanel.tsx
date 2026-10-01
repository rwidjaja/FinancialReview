import { useMemo } from 'react'
import { Panel, Stat, G, R, A, M, DIM, TAX_C, TECH_C, fmtK } from './shared'
import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { DEFAULT_ANNUAL_SPENDING } from '../../utils/constants'

// ─── 6. LIQUIDITY ─────────────────────────────────────────────────────────────
// hardcoded_spending is non-tax spend; add taxes_annual for total cash-out
export function LiquidityPanel({ data }: { data: DashboardData }) {
  const si = data.spending_intelligence
  const ia = data.income_analytics

  const { mmValue, mmValueTotal } = useMemo(() => {
    let spendable = 0
    let total = 0
    for (const acct of data.accounts) {
      const k = (acct.key ?? '').toLowerCase()
      const isTaxable = !k.includes('rollover') && !k.includes('roth') && !k.includes('ira')
      for (const p of acct.positions) {
        if (p.is_money_market) {
          total += p.value
          if (isTaxable) spendable += p.value
        }
      }
    }
    return { mmValue: spendable, mmValueTotal: total }
  }, [data])

  // true_annual_spending includes taxes; hardcoded_spending typically does not → add taxes_annual
  const annualSpend = si?.true_annual_spending != null
    ? si.true_annual_spending
    : (si?.hardcoded_spending ?? DEFAULT_ANNUAL_SPENDING) + (si?.taxes_annual ?? 0)
  const monthlySpend  = annualSpend / 12

  const monthlyIncome = (ia?.portfolio_fwd_12m ?? 0) / 12
  const withdrawNeed  = Math.max(0, monthlySpend - monthlyIncome)

  const cashRunwayMos = monthlySpend > 0 ? mmValue / monthlySpend : null
  const bufferYrs     = withdrawNeed > 0 ? mmValue / (withdrawNeed * 12) : null
  const covPct        = annualSpend > 0 ? (mmValue / annualSpend) * 100 : null

  const runwayColor = cashRunwayMos == null ? M : cashRunwayMos >= 18 ? G : cashRunwayMos >= 6 ? A : R
  const covColor    = covPct == null ? M : covPct >= 150 ? G : covPct >= 80 ? A : R

  // Preserve account label so we know where each cash bucket lives
  const mmPositions = data.accounts.flatMap(a =>
    a.positions
      .filter(p => p.is_money_market)
      .map(p => ({ ...p, acctLabel: a.label, acctKey: a.key }))
  )

  // Account-type color hint
  function acctColor(key: string): string {
    const k = key.toLowerCase()
    if (k.includes('roth'))    return TAX_C
    if (k.includes('roll') || k.includes('ira') || k.includes('trad')) return A
    return TECH_C   // taxable / brokerage
  }
  function acctBadge(key: string): string {
    const k = key.toLowerCase()
    if (k.includes('roth'))    return 'ROTH'
    if (k.includes('roll'))    return 'ROLLOVER'
    if (k.includes('ira'))     return 'IRA'
    if (k.includes('tax'))     return 'TAXABLE'
    return 'TAXABLE'
  }

  return (
    <Panel title="◈ Liquidity" sub="Cash runway · money market buffer · coverage" color={runwayColor} metricId="liquidity_risk">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 10 }}>
        <Stat label="Spendable MM (Taxable)" value={fmtK(mmValue)} color={G} large sub={mmValueTotal > mmValue ? `${fmtK(mmValueTotal)} total · IRA = conversion vehicle` : undefined} />
        <Stat label="Liquidity Coverage" value={covPct != null ? `${covPct.toFixed(0)}%` : '—'} color={covColor} large sub="of annual expenses" />
        <Stat label="Cash Runway"
          value={cashRunwayMos != null ? `${cashRunwayMos.toFixed(1)} months` : '—'}
          color={runwayColor}
          sub="at current spend rate" />
        <Stat label="Withdrawal Buffer"
          value={bufferYrs != null ? `${bufferYrs.toFixed(1)} years` : withdrawNeed === 0 ? 'N/A — self-funded' : '—'}
          color={bufferYrs == null ? (withdrawNeed === 0 ? G : M) : bufferYrs >= 2 ? G : bufferYrs >= 1 ? A : R}
          sub={withdrawNeed > 0 ? `need ${fmtK(withdrawNeed)}/mo from portfolio` : 'income exceeds expenses'} />
      </div>

      {mmPositions.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border2)', paddingTop: 8 }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 6 }}>Cash Locations</div>
          {mmPositions.map((p, i) => {
            const aColor = acctColor(p.acctKey)
            const badge  = acctBadge(p.acctKey)
            const pct    = mmValueTotal > 0 ? (p.value / mmValueTotal) * 100 : 0
            return (
              <div key={`${p.acctKey}-${p.symbol}-${i}`} style={{ marginBottom: 7 }}>
                {/* Account label row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: aColor, background: `${aColor}18`, padding: '1px 5px', borderRadius: 0, letterSpacing: '0.6px' }}>
                      {badge}
                    </span>
                    <span style={{ fontSize: 12, color: M }}>{p.acctLabel}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: G }}>{fmtMoneyFull(p.value)}</span>
                </div>
                {/* Symbol + share bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: DIM, minWidth: 52 }}>{p.symbol}</span>
                  <div style={{ flex: 1, height: 3, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: aColor, borderRadius: 0, opacity: 0.55 }} />
                  </div>
                  <span style={{ fontSize: 12, color: DIM, minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
