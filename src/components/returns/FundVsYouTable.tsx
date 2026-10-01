import { useMemo } from 'react'
import { MiniBar } from '../ui/Sparkline'
import { fmtPct, gainColor, fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'

interface Row {
  symbol: string
  weight: number
  cost: number
  pnl: number
  actualReturn: number   // your real return: pnl / your real cost basis
  fundReturn: number | null  // the symbol's own price return over the selected window
  gap: number | null     // fundReturn - actualReturn
  flag: { label: string; color: string } | null
}

export function FundVsYouTable({ data, perfData, period, totalValue }: {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
  totalValue: number
}) {
  const rows = useMemo<Row[]>(() => {
    const bySymbol: Record<string, { value: number; cost: number; pnl: number }> = {}
    for (const acct of data.accounts)
      for (const pos of acct.positions) {
        if (pos.is_money_market) continue
        const e = bySymbol[pos.symbol] ?? { value: 0, cost: 0, pnl: 0 }
        e.value += pos.value
        e.cost  += pos.cost
        e.pnl   += pos.pnl
        bySymbol[pos.symbol] = e
      }

    const safeTotal = totalValue > 0 ? totalValue : 1

    return Object.entries(bySymbol)
      .filter(([, v]) => v.value > 0)
      .map(([symbol, v]) => {
        const actualReturn = v.cost > 0 ? (v.pnl / v.cost) * 100 : 0
        const fundReturn = perfData[symbol]?.[period]?.total_return ?? null
        const gap = fundReturn != null ? fundReturn - actualReturn : null

        let flag: Row['flag'] = null
        if (fundReturn != null && actualReturn < 0 && fundReturn > 5) {
          flag = { label: 'BOUGHT NEAR HIGH', color: R }
        } else if (gap != null && gap > 15) {
          flag = { label: 'TIMING DRAG', color: A }
        } else if (gap != null && gap < -10) {
          flag = { label: 'BOUGHT THE DIP', color: G }
        }

        return {
          symbol, weight: v.value / safeTotal, cost: v.cost, pnl: v.pnl,
          actualReturn, fundReturn, gap, flag,
        }
      })
      .sort((a, b) => b.weight - a.weight)
  }, [data.accounts, perfData, period, totalValue])

  if (rows.length === 0) {
    return <div style={{ padding: '16px', color: M, fontSize: 12 }}>No holdings available for comparison.</div>
  }

  return (
    <div style={{ padding: '4px 4px 12px' }}>
      <div style={{
        fontSize: 12, marginBottom: 10, fontFamily: 'var(--font-mono)', lineHeight: 1.5,
        padding: '8px 10px', background: 'var(--fd-card)',
        border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${A}`,
        color: 'var(--fd-muted)',
      }}>
        <b style={{ color: 'var(--text)' }}>YOUR ACTUAL RETURN</b> is what you really made or lost on this holding — what you paid vs. what it's worth now. If you bought near a high, this shows a loss even if the stock itself is up.{' '}
        <b style={{ color: 'var(--text)' }}>FUND RETURN ({period.toUpperCase()})</b> is just how much the stock's price moved over this stretch — it has nothing to do with when you actually bought it. A big gap between the two means timing (not the stock) explains the difference.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="bb-table" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th>SYMBOL</th>
              <th className="r">WEIGHT</th>
              <th className="r">YOUR COST BASIS</th>
              <th className="r">YOUR ACTUAL RETURN</th>
              <th className="r">$ GAIN/LOSS</th>
              <th className="r">FUND RETURN ({period.toUpperCase()})</th>
              <th className="r">GAP</th>
              <th>NOTE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.symbol}>
                <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{r.symbol}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <span>{fmtPct(r.weight * 100)}</span>
                    <MiniBar value={r.weight * 100} color={A} width={36} height={4} />
                  </div>
                </td>
                <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {fmtMoneyFull(r.cost)}
                </td>
                <td className="r" style={{ color: gainColor(r.actualReturn), fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {fmtPct(r.actualReturn)}
                </td>
                <td className="r" style={{ color: gainColor(r.pnl), fontFamily: 'var(--font-mono)' }}>
                  {r.pnl >= 0 ? '+' : ''}{fmtMoneyFull(r.pnl)}
                </td>
                <td className="r" style={{ color: r.fundReturn == null ? M : gainColor(r.fundReturn), fontFamily: 'var(--font-mono)' }}>
                  {r.fundReturn != null ? fmtPct(r.fundReturn) : '—'}
                </td>
                <td className="r" style={{ color: r.gap == null ? M : (r.gap > 0 ? A : G), fontFamily: 'var(--font-mono)' }}>
                  {r.gap != null ? `${r.gap >= 0 ? '+' : ''}${r.gap.toFixed(1)}pp` : '—'}
                </td>
                <td>
                  {r.flag && (
                    <span style={{
                      fontSize: 12, fontWeight: 500, padding: '2px 6px', borderRadius: 0,
                      background: `${r.flag.color}1a`, color: r.flag.color, border: `1px solid ${r.flag.color}44`,
                      whiteSpace: 'nowrap',
                    }}>{r.flag.label}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
