import type { LimitOrder } from './types'
import { G, R, A, M } from './constants'

export function OrdersTab({ orders, onCancel, priceMap = {} }: {
  orders:   LimitOrder[]
  onCancel: (id: string) => void
  priceMap?: Record<string, number>
}) {
  const statusColor = (s: LimitOrder['status']) =>
    s === 'OPEN' ? A : s === 'FILLED' ? G : M

  const statusGroups: LimitOrder['status'][] = ['OPEN', 'FILLED', 'CANCELLED', 'EXPIRED']

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: A,
        textTransform: 'uppercase', letterSpacing: '1px' }}>
        ◈ ORDER STATUS
      </div>
      <div style={{ fontSize: 12, color: M }}>
        Limit orders auto-fill when price hits the limit. Use{' '}
        <strong>↺ Refresh Prices</strong> to update current prices and check distance to fill.
        Prices shown are last close outside market hours.
      </div>
      {orders.length === 0 && (
        <div style={{ fontSize: 12, color: M }}>No limit orders placed yet.</div>
      )}
      {statusGroups.map(status => {
        const group = orders.filter(o => o.status === status)
        if (group.length === 0) return null
        return (
          <div key={status}>
            <div style={{ fontSize: 12, fontWeight: 500, color: statusColor(status),
              textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: 3,
                background: statusColor(status),
              }} />
              {status} ({group.length})
            </div>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border2)' }}>
                  {['Type','Symbol','Shares','Limit $','Current','Distance','Created','Expires / Filled',''].map(h => (
                    <th key={h} style={{ padding: '3px 8px', textAlign: h === 'Type' || h === 'Symbol' || h === '' ? 'left' : 'right',
                      fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
                      letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(o => {
                  const currentPx = priceMap[o.symbol] ?? null
                  const dist = currentPx != null ? currentPx - o.limitPrice : null
                  // For BUY: negative dist = price is below limit (will fill / has filled)
                  // For SELL: positive dist = price is above limit (will fill / has filled)
                  const distToFill = dist != null
                    ? (o.action === 'BUY' ? -dist : dist)   // positive = closer to fill
                    : null
                  const distColor = distToFill == null ? M
                    : distToFill <= 0   ? G    // at or past fill price
                    : distToFill < 5   ? A    // within $5
                    : M
                  return (
                  <tr key={o.id} style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                    <td style={{ padding: '5px 8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ color: o.action === 'BUY' ? G : R, fontWeight: 500, fontSize: 12 }}>
                          {o.action}
                        </span>
                        <span style={{ fontSize: 12, color: statusColor(o.status), fontWeight: 500 }}>
                          {o.orderType === 'LIMIT_DAY' ? 'DAY' : 'GTC'}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontWeight: 500 }}>{o.symbol}</span>
                        {o.status === 'OPEN' && (
                          <button
                            onClick={() => onCancel(o.id)}
                            style={{
                              fontSize: 12, fontWeight: 500, cursor: 'pointer',
                              background: 'var(--fd-card)',
                              border: '1px solid var(--fd-hairline)',
                              color: R, padding: '1px 6px', borderRadius: 0,
                              alignSelf: 'flex-start',
                            }}>
                            ✕ Cancel
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: M }}>
                      {o.shares >= 1000 ? o.shares.toFixed(2) : o.shares.toFixed(4)}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 500 }}>
                      ${o.limitPrice.toFixed(2)}
                      <div style={{ fontSize: 12, color: M }}>
                        {o.action === 'BUY' ? '≤ fill' : '≥ fill'}
                      </div>
                    </td>
                    {/* Current price */}
                    <td style={{ padding: '5px 8px', textAlign: 'right',
                      fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {currentPx != null
                        ? <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                            ${currentPx.toFixed(2)}
                          </span>
                        : <span style={{ color: 'var(--fd-muted)', fontSize: 12 }}>
                            — refresh
                          </span>
                      }
                    </td>
                    {/* Distance to fill */}
                    <td style={{ padding: '5px 8px', textAlign: 'right',
                      fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {distToFill != null ? (
                        distToFill <= 0
                          ? <span style={{ color: G, fontWeight: 500, fontSize: 12 }}>
                              ✓ at fill
                            </span>
                          : <span style={{ color: distColor, fontWeight: 500 }}>
                              ${distToFill.toFixed(2)} away
                            </span>
                      ) : <span style={{ color: 'var(--fd-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: M, fontSize: 12 }}>
                      {o.createdAt.slice(0, 10)}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontSize: 12 }}>
                      {o.status === 'FILLED' && o.filledAt
                        ? <span style={{ color: G }}>Filled @ ${o.filledPrice?.toFixed(2)} · {o.filledAt.slice(0, 10)}</span>
                        : o.status === 'OPEN' && o.expiresAt
                          ? <span style={{ color: A }}>Exp {o.expiresAt.slice(0, 10)}</span>
                          : o.status === 'EXPIRED'
                            ? <span style={{ color: M }}>Expired {o.expiresAt?.slice(0, 10)}</span>
                            : <span style={{ color: M }}>—</span>
                      }
                    </td>
                    <td />
                  </tr>
                )})}
              </tbody>
            </table>
            </div>{/* end overflow-x: auto */}
          </div>
        )
      })}
    </div>
  )
}
