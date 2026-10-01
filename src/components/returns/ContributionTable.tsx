import { useMemo } from 'react'
import { MiniBar } from '../ui/Sparkline'
import { fmtPct, gainColor, fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'

const PERIOD_YEARS: Record<string, number> = {
  '1m': 1 / 12, '3m': 0.25, '6m': 0.5, '1y': 1, '3y': 3, '5y': 5,
}
function periodYears(period: string): number {
  if (period === 'ytd') {
    const start = new Date(new Date().getFullYear(), 0, 1).getTime()
    const days = (Date.now() - start) / 86400000
    return Math.max(days / 365.25, 1 / 365.25)
  }
  return PERIOD_YEARS[period] ?? 1
}

function derivedMetrics(pctReturns: number[], totalReturn: number, years: number) {
  const n = pctReturns.length
  if (n === 0) return { winRate: 0, sortino: 0, cagr: 0 }
  const daily = pctReturns.map((p, i) => (i === 0 ? p : p - pctReturns[i - 1]))
  const winRate = (daily.filter(d => d > 0).length / n) * 100
  const meanDaily = daily.reduce((s, d) => s + d, 0) / n
  const negatives = daily.filter(d => d < 0)
  const downsideVariance = negatives.length > 0 ? negatives.reduce((s, d) => s + d * d, 0) / negatives.length : 0
  const downsideStd = Math.sqrt(downsideVariance)
  const sortino = downsideStd > 0 ? (meanDaily * 252) / (downsideStd * Math.sqrt(252)) : 0
  const cagr = years > 0 ? (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100 : totalReturn
  return { winRate, sortino, cagr }
}

export function ContributionTable({ data, perfData, period, totalValue }: {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
  totalValue: number
}) {
  // Aggregate value, cost, and pnl per symbol across all accounts
  const posBySymbol = useMemo<Record<string, { value: number; cost: number; pnl: number }>>(() => {
    const m: Record<string, { value: number; cost: number; pnl: number }> = {}
    for (const acct of data.accounts)
      for (const pos of acct.positions) {
        const e = m[pos.symbol] ?? { value: 0, cost: 0, pnl: 0 }
        e.value += pos.value
        e.cost  += pos.cost
        e.pnl   += pos.pnl
        m[pos.symbol] = e
      }
    return m
  }, [data.accounts])

  const safeTotal     = totalValue > 0 ? totalValue : 1
  const totalCost     = data.summary.total_cost > 0 ? data.summary.total_cost : safeTotal

  const rows = useMemo(() => {
    const years = periodYears(period)
    return data.decisions.map(d => {
      const pd  = perfData[d.symbol]?.[period]
      const pos = posBySymbol[d.symbol]
      if (!pos || pos.value <= 0) return null
      const w            = pos.value / safeTotal
      // Actual return since purchase (cost-basis return)
      const actualReturn = pos.cost > 0 ? (pos.pnl / pos.cost) * 100 : 0
      // Contribution to portfolio return (symbol gain / total portfolio cost)
      const actualContrib = (pos.pnl / totalCost) * 100
      const advanced     = pd ? derivedMetrics(pd.pct_returns ?? [], pd.total_return, years) : null
      return { symbol: d.symbol, weight: w, pos, pd, advanced, actualReturn, actualContrib }
    }).filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.actualReturn - a.actualReturn)
  }, [data.decisions, perfData, period, posBySymbol, safeTotal, totalCost])

  if (rows.length === 0) {
    return <div style={{ padding: '16px', color: 'var(--text2)', fontSize: 12 }}>No performance data available for the selected period.</div>
  }

  const returnRankOf = (sym: string) => rows.findIndex(r => r.symbol === sym) + 1

  return (
    <div style={{ overflowX: 'auto', padding: '8px 12px' }}>
      <div style={{
        fontSize: 12, marginBottom: 8, fontFamily: 'var(--font-mono)',
        padding: '6px 10px', background: 'var(--fd-card)',
        border: '1px solid var(--fd-hairline)', borderLeft: '3px solid var(--yellow)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px',
      }}>
        <span style={{ color: 'var(--yellow)', fontWeight: 500 }}>
           RETURN (SINCE BUY) &amp; CONTRIBUTION — lifetime cost-basis, not a {period.toUpperCase()} window
        </span>
        <span style={{ color: M }}>
          VOL / SHARPE / MAX DD / WIN RATE — {period.toUpperCase()} price history
        </span>
      </div>
      <table className="bb-table" style={{ minWidth: 1100 }}>
        <thead>
          {/* Section separator row */}
          <tr>
            <th colSpan={2} />
            <th colSpan={5} style={{ textAlign: 'center', fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', color: A, paddingBottom: 2, borderBottom: `2px solid ${A}44` }}>
              ── LIFETIME (SINCE BUY) ──
            </th>
            <th colSpan={6} style={{ textAlign: 'center', fontSize: 12, fontWeight: 500, letterSpacing: '0.08em', color: M, paddingBottom: 2, borderBottom: `2px solid ${M}33` }}>
              ── {period.toUpperCase()} WINDOW ──
            </th>
          </tr>
          <tr>
            <th>RANK</th>
            <th>SYMBOL</th>
            <th className="r">WEIGHT</th>
            <th className="r">COST BASIS</th>
            <th className="r">RETURN %</th>
            <th className="r">$ GAIN</th>
            <th className="r">PORT CONTRIB</th>
            <th className="r">MAX DD</th>
            <th
              className="r"
              title="Per-symbol Sharpe from yfinance data — NOT portfolio Sharpe. Symbols with little downside vol score very high; interpret with caution. Use Portfolio Performance card for canonical portfolio-level Sharpe."
            >SYM SHARPE<span style={{ color: M, fontWeight: 400 }}> ⓘ</span></th>
            <th className="r">SORTINO</th>
            <th className="r">WIN RATE</th>
            <th className="r">VOL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const retRank  = returnRankOf(r.symbol)
            const medalColor = retRank === 1 ? A : retRank === 2 ? 'var(--text2)' : retRank === 3 ? 'var(--fd-ink)' : M
            const adv = r.advanced
            return (
              <tr key={r.symbol}>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-block', width: 24, height: 24, lineHeight: '24px', textAlign: 'center',
                    borderRadius: 0, background: retRank <= 3 ? medalColor : 'var(--border2)',
                    color: retRank <= 3 ? 'var(--fd-page)' : M, fontWeight: 500, fontSize: 12, fontFamily: 'var(--font-mono)',
                  }}>#{retRank}</span>
                </td>
                <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{r.symbol}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <span>{fmtPct(r.weight * 100)}</span>
                    <MiniBar value={r.weight * 100} color={A} width={40} height={4} />
                  </div>
                </td>
                <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {fmtMoneyFull(r.pos.cost)}
                </td>
                <td className="r" style={{ color: gainColor(r.actualReturn), fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {fmtPct(r.actualReturn)}
                </td>
                <td className="r" style={{ color: gainColor(r.pos.pnl), fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {r.pos.pnl >= 0 ? '+' : ''}{fmtMoneyFull(r.pos.pnl)}
                </td>
                <td className="r" style={{ color: gainColor(r.actualContrib), fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {fmtPct(r.actualContrib)}
                </td>
                <td className="r" style={{ color: R, fontFamily: 'var(--font-mono)' }}>
                  {r.pd ? fmtPct(r.pd.max_drawdown) : '—'}
                </td>
                <td className="r" style={{
                  color: r.pd ? (r.pd.sharpe >= 1 ? G : r.pd.sharpe >= 0.5 ? Y : R) : M,
                  fontFamily: 'var(--font-mono)',
                }}>
                  {r.pd ? r.pd.sharpe.toFixed(2) : '—'}
                </td>
                <td className="r" style={{
                  color: adv == null ? M : adv.sortino >= 1 ? G : adv.sortino >= 0.5 ? Y : R,
                  fontFamily: 'var(--font-mono)',
                }}>
                  {adv != null ? adv.sortino.toFixed(2) : '—'}
                </td>
                <td className="r" style={{
                  color: adv == null ? M : adv.winRate >= 55 ? G : adv.winRate >= 48 ? Y : R,
                  fontFamily: 'var(--font-mono)',
                }}>
                  {adv != null ? `${adv.winRate.toFixed(1)}%` : '—'}
                </td>
                <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>
                  {r.pd ? fmtPct(r.pd.vol_annual) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
