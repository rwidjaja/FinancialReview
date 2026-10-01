import { MiniBar } from '../ui/Sparkline'
import { fmtMoney, fmtMoneyFull, gainColor, STRUCTURAL_ICON } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, A, M } from './DetailTab.constants'
import { PositionNarrative } from './PositionNarrative'
import { DecisionRationale } from './DecisionRationale'

export function HoldingsTable({ holdings, totalValue, data }: {
  holdings: { symbol: string; shares: number; value: number; cost: number; pnl: number; annualInc: number; dayChg: number; dayPct: number; acctCount: number }[]
  totalValue: number
  data: DashboardData
}) {
  // Grand totals
  const grandCost = holdings.reduce((s, h) => s + h.cost, 0)
  const grandPnl = holdings.reduce((s, h) => s + h.pnl, 0)
  const grandDayChg = holdings.reduce((s, h) => s + h.dayChg, 0)
  const grandInc = holdings.reduce((s, h) => s + h.annualInc, 0)
  const grandPnlPct = grandCost > 0 ? (grandPnl / grandCost) * 100 : 0

  const grandDivYld = totalValue > 0 ? (grandInc / totalValue) * 100 : 0
  const grandYoC    = grandCost  > 0 ? (grandInc / grandCost)  * 100 : 0

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="bb-table" style={{ minWidth: 1140 }}>
        <thead>
          <tr>
            <th>SYM / NAME</th>
            <th className="r">QTY</th>
            <th className="r">PRICE</th>
            <th className="r">CHG%</th>
            <th className="r">VALUE</th>
            <th className="r">DAY CHG</th>
            <th className="r">COST</th>
            <th className="r">P&L</th>
            <th className="r">P&L%</th>
            <th className="r">DIV YLD%</th>
            <th className="r">YOC%</th>
            <th className="r">β</th>
            <th className="r">ANNUAL INCOME</th>
            <th style={{ textAlign: 'center' }}>% Portfolio</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map(h => {
            const snap = data.snapshots[h.symbol]
            const pnlPct = h.cost > 0 ? (h.pnl / h.cost) * 100 : 0
            const portPct = (h.value / totalValue) * 100
            const dec = data.decisions.find(d => d.symbol === h.symbol)
            const statusIcon = dec ? (STRUCTURAL_ICON[dec.structural_status] ?? '') : ''
            const fundName = data.fund_configs[h.symbol]?.FUND_TYPE ?? ''
            const beta = snap?.beta
            const concColor = portPct >= 20 ? R : portPct >= 10 ? A : undefined
            const concBadge = portPct >= 20
              ? <span style={{ color: R, fontSize: 12, fontWeight: 500 }}>●HIGH</span>
              : portPct >= 10
              ? <span style={{ color: A, fontSize: 12, fontWeight: 500 }}>●MED</span>
              : null
            const acctLabel = h.acctCount > 1 ? `×${h.acctCount}` : ''
            // Portfolio Fit role tag
            const fitRole = portPct >= 15 ? 'CORE'
              : (fundName === 'GROWTH') ? 'SATELLITE'
              : (fundName === 'DIVIDEND' || fundName === 'OPTION_INCOME' || fundName === 'CEF') ? 'INCOME'
              : null
            const fitColor = fitRole === 'CORE' ? A : fitRole === 'SATELLITE' ? 'var(--blue)' : fitRole === 'INCOME' ? G : M
            const divYld    = h.value > 0 && h.annualInc > 0 ? (h.annualInc / h.value) * 100 : null
            const yoc       = h.cost  > 0 && h.annualInc > 0 ? (h.annualInc / h.cost)  * 100 : null
            const divYldClr = divYld == null ? M : divYld >= 8 ? G : divYld >= 4 ? A : M
            const yocClr    = yoc    == null ? M : yoc    >= 8 ? G : yoc    >= 5 ? A : M
            return (
              <tr key={h.symbol}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {statusIcon && (
                      <DecisionRationale symbol={h.symbol} icon={statusIcon} />
                    )}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{h.symbol}</span>
                        <PositionNarrative symbol={h.symbol} />
                        {acctLabel && <span style={{ fontSize: 12, color: M }}>{acctLabel}</span>}
                        {concBadge}
                        {fitRole && (
                          <span style={{
                            fontSize: 12, fontWeight: 500, padding: '1px 4px',
                            border: `1px solid ${fitColor}`, color: fitColor,
                            letterSpacing: '0.4px',
                          }}>{fitRole}</span>
                        )}
                      </div>
                      {fundName && <div className="bb-sub">{fundName}</div>}
                    </div>
                  </div>
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{h.shares.toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{snap?.price != null ? `$${snap.price.toFixed(2)}` : '—'}</td>
                <td className="r" style={{ color: gainColor(h.dayPct), fontFamily: 'var(--font-mono)' }}>
                  {h.dayPct >= 0 ? '+' : ''}{h.dayPct.toFixed(2)}%
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(h.value)}</td>
                <td className="r" style={{ color: gainColor(h.dayChg), fontFamily: 'var(--font-mono)' }}>
                  {h.dayChg >= 0 ? '+' : ''}{fmtMoney(h.dayChg)}
                </td>
                <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(h.cost)}</td>
                <td className="r" style={{ color: gainColor(h.pnl), fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {h.pnl >= 0 ? '+' : ''}{fmtMoneyFull(h.pnl)}
                </td>
                <td className="r" style={{ color: gainColor(pnlPct), fontFamily: 'var(--font-mono)' }}>
                  {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                </td>
                <td className="r" style={{ color: divYldClr, fontFamily: 'var(--font-mono)' }}>
                  {divYld != null ? `${divYld.toFixed(2)}%` : '—'}
                </td>
                <td className="r" style={{ color: yocClr, fontFamily: 'var(--font-mono)' }}>
                  {yoc != null ? `${yoc.toFixed(2)}%` : '—'}
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: M }}>
                  {beta != null ? beta.toFixed(2) : '—'}
                </td>
                <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(h.annualInc)}</td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: concColor }}>{portPct.toFixed(1)}%</span>
                    <MiniBar value={portPct} color={concColor ?? A} width={36} height={4} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
        {/* Grand total footer */}
        <tfoot>
          <tr style={{ fontWeight: 500, borderTop: '2px solid var(--border2)', background: 'var(--surface)' }}>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>TOTAL</td>
            <td></td><td></td><td></td>
            <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(totalValue)}</td>
            <td className="r" style={{ color: gainColor(grandDayChg), fontFamily: 'var(--font-mono)' }}>
              {grandDayChg >= 0 ? '+' : ''}{fmtMoney(grandDayChg)}
            </td>
            <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(grandCost)}</td>
            <td className="r" style={{ color: gainColor(grandPnl), fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
              {grandPnl >= 0 ? '+' : ''}{fmtMoneyFull(grandPnl)}
            </td>
            <td className="r" style={{ color: gainColor(grandPnlPct), fontFamily: 'var(--font-mono)' }}>
              {grandPnlPct >= 0 ? '+' : ''}{grandPnlPct.toFixed(1)}%
            </td>
            <td className="r" style={{ color: grandDivYld >= 8 ? G : grandDivYld >= 4 ? A : M, fontFamily: 'var(--font-mono)' }}>
              {grandDivYld > 0 ? `${grandDivYld.toFixed(2)}%` : '—'}
            </td>
            <td className="r" style={{ color: grandYoC >= 8 ? G : grandYoC >= 5 ? A : M, fontFamily: 'var(--font-mono)' }}>
              {grandYoC > 0 ? `${grandYoC.toFixed(2)}%` : '—'}
            </td>
            <td></td>
            <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(grandInc)}</td>
            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
