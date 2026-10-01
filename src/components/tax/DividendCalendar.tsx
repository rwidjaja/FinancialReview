import { fmtMoneyFull } from '../../utils/formatters'
import { G, A, M } from './taxColors'
import type { DashboardData } from '../../types/dashboard'

export function DividendCalendar({ tx }: { tx: DashboardData['tax_data'] }) {
  const calendar = tx.taxable_div_calendar ?? {}
  const symbols = Object.keys(calendar)
  const months = tx.cal_months ?? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const totals = tx.monthly_div_totals ?? []

  if (symbols.length === 0) return <div style={{ padding: 12, color: M, fontSize: 12 }}>No dividend calendar available.</div>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="bb-table" style={{ minWidth: 600 }}>
        <thead>
          <tr>
            <th>SYMBOL</th>
            {months.map((m, i) => <th key={i} className="r" style={{ fontSize: 12 }}>{m}</th>)}
            <th className="r">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map(sym => {
            const row = calendar[sym] ?? []
            const total = row.reduce((s: number, v) => s + (v ?? 0), 0)
            return (
              <tr key={sym}>
                <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{sym}</td>
                {row.map((v, i) => (
                  <td key={i} className="r" style={{ color: v ? G : 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {v ? fmtMoneyFull(v) : '—'}
                  </td>
                ))}
                <td className="r" style={{ color: G, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(total)}</td>
              </tr>
            )
          })}
          {totals.length > 0 && (
            <tr style={{ borderTop: '2px solid var(--border2)' }}>
              <td style={{ fontWeight: 500, color: A }}>TOTAL</td>
              {totals.map((v, i) => (
                <td key={i} className="r" style={{ color: A, fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {v ? fmtMoneyFull(v) : '—'}
                </td>
              ))}
              <td className="r" style={{ color: A, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                {fmtMoneyFull(totals.reduce((s: number, v) => s + (v ?? 0), 0))}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
