import { fmtMoney } from '../../utils/formatters'
import type { Transaction, Portfolio } from './types'
import { G, R, A, M } from './constants'
import { fmtDate } from './shared'

export function TradesTab({ txns }:
  { txns: Transaction[]; activeId: number; onMutate: () => void; port: Portfolio }) {
  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: A,
        textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
        ◈ TRANSACTION HISTORY ({txns.length})
      </div>
      {txns.length === 0 ? (
        <div style={{ fontSize: 12, color: M }}>No transactions yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border2)' }}>
              {['Date','Type','Symbol','Shares','Price/Sh','Amount','Comm.','Notes'].map(h => (
                <th key={h} style={{
                  padding: '4px 8px', textAlign: 'right', fontSize: 12,
                  color: M, fontWeight: 500, textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  ...(h === 'Date' || h === 'Type' || h === 'Notes'
                      ? { textAlign: 'left' } : {}),
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txns.map(t => (
              <tr key={t.transaction_id}
                style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                <td style={{ padding: '4px 8px', color: M,
                  fontSize: 12 }}>{fmtDate(t.transaction_date)}</td>
                <td style={{ padding: '4px 8px',
                  color: t.transaction_type === 'BUY' ? G : R,
                  fontWeight: 500, fontSize: 12 }}>{t.transaction_type}</td>
                <td style={{ padding: '4px 8px', fontWeight: 500 }}>{t.symbol}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right',
                  color: M }}>{t.shares.toFixed(4)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                  ${t.price_per_share.toFixed(2)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right',
                  fontWeight: 500 }}>{fmtMoney(t.total_amount)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right',
                  color: M }}>{t.commission > 0 ? `$${t.commission.toFixed(2)}` : '—'}</td>
                <td style={{ padding: '4px 8px', color: M,
                  fontSize: 12, maxWidth: 160, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
