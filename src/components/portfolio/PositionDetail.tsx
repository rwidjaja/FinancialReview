import { fmtMoneyFull, gainColor } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, A, M } from './DetailTab.constants'

function taxBadge(acctKey: string) {
  if (acctKey === 'roth_ira')    return { label: 'ROC',  color: 'var(--blue)', bg: 'var(--fd-card)' }
  if (acctKey === 'rollover_ira') return { label: 'QUAL', color: G,             bg: 'var(--fd-card)' }
  return                                 { label: 'ORD',  color: 'var(--red)',  bg: 'var(--fd-card)' }
}

export function PositionDetail({ data }: { data: DashboardData }) {
  const accountsWithPositions = data.accounts.filter(a => a.positions.length > 0)
  if (accountsWithPositions.length === 0) {
    return <div style={{ padding: '16px', color: 'var(--text2)', fontSize: 12 }}>No position data available — Schwab may be offline or no positions held.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      {accountsWithPositions.map(acct => (
        <div key={acct.key} style={{ border: '1px solid var(--fd-hairline)' }}>
          <div style={{
            padding: '4px 10px', background: 'var(--panel2)',
            borderBottom: '1px solid var(--border2)',
            fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span style={{ color: A }}>{acct.label}</span>
            <span style={{ color: M }}>VALUE: <span style={{ color: 'var(--text)', fontWeight: 500 }}>{fmtMoneyFull(acct.value)}</span></span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="bb-table">
              <thead>
                <tr>
                  <th>SYMBOL</th>
                  <th className="r">SHARES</th>
                  <th className="r">COST PER SHARE</th>
                  <th className="r">PRICE</th>
                  <th className="r">VALUE</th>
                  <th className="r">COST BASIS</th>
                  <th className="r">P&L</th>
                  <th className="r">P&L%</th>
                  <th className="r">ANNUAL INCOME</th>
                  <th className="r">YIELD</th>
                  <th>TAX</th>
                </tr>
              </thead>
              <tbody>
                {acct.positions.map(pos => {
                  const snap = data.snapshots[pos.symbol]
                  const costPerShare = pos.shares > 0 ? pos.cost / pos.shares : 0
                  const pnlPct = pos.cost > 0 ? (pos.pnl / pos.cost) * 100 : 0
                  const ttmYield = (snap?.ttm_yield ?? 0) * 100
                  const computedIncome = pos.annual_income > 0
                    ? pos.annual_income
                    : (pos.is_money_market || pos.fund_type === 'MONEY_MARKET') && ttmYield > 0 && pos.value > 0
                      ? (ttmYield / 100) * pos.value
                      : 0
                  const isEstimated = pos.annual_income === 0 && computedIncome > 0
                  const tax = taxBadge(acct.key)
                  return (
                    <tr key={pos.symbol}>
                      <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{pos.symbol}</td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{pos.shares.toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
                      <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>${costPerShare.toFixed(2)}</td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{snap?.price != null ? `$${snap.price.toFixed(2)}` : '—'}</td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(pos.value)}</td>
                      <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(pos.cost)}</td>
                      <td className="r" style={{ color: gainColor(pos.pnl), fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        {pos.pnl >= 0 ? '+' : ''}{fmtMoneyFull(pos.pnl)}
                      </td>
                      <td className="r" style={{ color: gainColor(pnlPct), fontFamily: 'var(--font-mono)' }}>
                        {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                      </td>
                      <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)' }}>
                        {fmtMoneyFull(computedIncome)}
                        {isEstimated && <span style={{ fontSize: 12, color: M, marginLeft: 3 }}>est.</span>}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: M }}>
                        {ttmYield > 0 ? `${ttmYield.toFixed(1)}%` : '—'}
                      </td>
                      <td>
                        <span style={{ fontSize: 12, fontWeight: 500, color: tax.color, padding: '1px 5px', borderRadius: 0, background: tax.bg }}>
                          {tax.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {(() => {
                  const totValue = acct.positions.reduce((s, p) => s + p.value, 0)
                  const totCost = acct.positions.reduce((s, p) => s + p.cost, 0)
                  const totPnl = acct.positions.reduce((s, p) => s + p.pnl, 0)
                  const totPnlPct = totCost > 0 ? (totPnl / totCost) * 100 : 0
                  const totIncome = acct.positions.reduce((s, p) => s + (p.annual_income ?? 0), 0)
                  return (
                    <tr style={{ borderTop: '1px solid var(--border2)', background: 'var(--fd-card)' }}>
                      <td style={{ fontWeight: 500, fontSize: 12, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text2)' }}>TOTAL</td>
                      <td className="r" />
                      <td className="r" />
                      <td className="r" />
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(totValue)}</td>
                      <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(totCost)}</td>
                      <td className="r" style={{ color: gainColor(totPnl), fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        {totPnl >= 0 ? '+' : ''}{fmtMoneyFull(totPnl)}
                      </td>
                      <td className="r" style={{ color: gainColor(totPnlPct), fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        {totPnlPct >= 0 ? '+' : ''}{totPnlPct.toFixed(1)}%
                      </td>
                      <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(totIncome)}</td>
                      <td className="r" />
                      <td />
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
