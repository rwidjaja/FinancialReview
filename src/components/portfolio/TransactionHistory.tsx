import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, M } from './DetailTab.constants'

export function TransactionHistory({ data }: { data: DashboardData }) {
  // Build set of currently-held symbols across all accounts
  const currentSymbols = new Set<string>(
    (data.accounts ?? []).flatMap(a => a.positions.map(p => p.symbol))
  )

  const transactions = (data.income_history?.transactions ?? [])
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (transactions.length === 0) {
    return <div style={{ padding: '12px 14px', color: 'var(--text2)', fontSize: 12 }}>No transaction history available.</div>
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="bb-table">
        <thead>
          <tr>
            <th>DATE</th>
            <th>SYMBOL</th>
            <th>ACCOUNT</th>
            <th>TYPE</th>
            <th className="r">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {transactions.slice(0, 100).map((tx, i) => {
            const txType   = tx.type?.toUpperCase() ?? 'DIV'
            const isQual   = txType === 'QUAL'
            const isROC    = txType === 'ROC'
            const isInt    = txType === 'INT'
            const isReinvest = txType === 'REINVEST'
            const typeColor = isROC ? 'var(--blue)'
              : isQual    ? G
              : isInt     ? 'var(--cyan)'
              : isReinvest ? 'var(--amber)'
              : 'var(--red)'
            // A position is "sold" if:
            //   a) symbol field is absent (description-only — never had a live ticker), OR
            //   b) symbol is known but no longer in the current portfolio
            const hasTicker  = !!tx.symbol
            const isSynthetic = tx.symbol === 'CASH_INT'  // interest income, not a tradeable position
            const isSold     = !isSynthetic && (!hasTicker || (hasTicker && !currentSymbols.has(tx.symbol!)))
            const displaySymbol = tx.symbol || tx.description || '—'
            const isTruncated   = !hasTicker && displaySymbol.length > 22
            return (
              <tr key={i}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: M, whiteSpace: 'nowrap' }}>{tx.date}</td>
                <td style={{ fontWeight: hasTicker ? 700 : 400, fontFamily: 'var(--font-mono)',
                             color: isSold ? M : 'var(--text)',
                             fontStyle: hasTicker ? 'normal' : 'italic', maxWidth: 180 }}
                    title={!hasTicker && tx.description ? tx.description : undefined}>
                  {isTruncated ? displaySymbol.slice(0, 22) + '…' : displaySymbol}
                  {isSold && <span style={{ fontSize: 12, color: 'var(--amber)', marginLeft: 4, fontStyle: 'normal' }}>SOLD</span>}
                </td>
                <td style={{ fontSize: 12, color: M }}>{
                  tx.account?.includes('roth') ? 'Roth IRA'
                  : tx.account?.includes('rollover') ? 'Rollover IRA'
                  : tx.account?.includes('taxable') ? 'Taxable'
                  : (tx.account ?? 'Unknown')
                }</td>
                <td>
                  <span style={{ fontSize: 12, fontWeight: 500, color: typeColor, padding: '1px 5px',
                    background: isROC      ? 'var(--fd-card)'
                              : isQual     ? 'var(--fd-card)'
                              : isInt      ? 'var(--fd-card)'
                              : isReinvest ? 'var(--fd-card)'
                              : 'var(--fd-card)' }}>
                    {txType}
                  </span>
                </td>
                <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {fmtMoneyFull(tx.amount)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {transactions.length > 100 && (
        <div style={{ padding: '6px 12px', fontSize: 12, color: M }}>
          Showing 100 of {transactions.length} transactions
        </div>
      )}
    </div>
  )
}
