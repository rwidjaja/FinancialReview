import { fmtMoneyFull } from '../../utils/formatters'
import { G, R, B, Y } from './taxColors'
import type { DashboardData } from '../../types/dashboard'

export function DivBreakdownTable({ tx }: { tx: DashboardData['tax_data'] }) {
  const breakdown = tx.div_tax_breakdown ?? {}
  const symbols = Object.keys(breakdown)
  if (symbols.length === 0) return null

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="bb-table">
        <thead>
          <tr>
            <th>SYMBOL</th>
            <th className="r">ANNUAL DIST</th>
            <th className="r">ORDINARY</th>
            <th className="r">QUALIFIED</th>
            <th className="r">ROC</th>
            <th>PROFILE</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map(sym => {
            const e = breakdown[sym]
            const profile = e.qualified_pct >= 60 ? { label: 'QUALIFIED-HEAVY', color: G }
              : e.roc_pct >= 40 ? { label: 'ROC-HEAVY', color: B }
              : e.ordinary_pct >= 70 ? { label: 'ORDINARY-HEAVY', color: R }
              : { label: 'MIXED', color: Y }
            return (
              <tr key={sym}>
                <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{sym}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: G }}>{fmtMoneyFull(e.annual_total)}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: R }}>
                  {fmtMoneyFull(e.ordinary_amt)} <span style={{ color: 'var(--text3)', fontSize: 12 }}>({e.ordinary_pct.toFixed(0)}%)</span>
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: G }}>
                  {fmtMoneyFull(e.qualified_amt)} <span style={{ color: 'var(--text3)', fontSize: 12 }}>({e.qualified_pct.toFixed(0)}%)</span>
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: B }}>
                  {fmtMoneyFull(e.roc_amt)} <span style={{ color: 'var(--text3)', fontSize: 12 }}>({e.roc_pct.toFixed(0)}%)</span>
                </td>
                <td>
                  <span style={{ fontSize: 12, fontWeight: 500, color: profile.color }}>{profile.label}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
