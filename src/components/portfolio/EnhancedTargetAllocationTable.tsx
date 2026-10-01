import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, A, M } from './DetailTab.constants'

export function EnhancedTargetAllocationTable({
  rows,
  data,
  accountType
}: {
  rows: DashboardData['roth_target_analysis'] | DashboardData['taxable_target_analysis']
  data: DashboardData
  accountType: 'roth' | 'taxable'
}) {
  const formatShares = (shares: number) => {
    if (shares === 0 || isNaN(shares)) return '—'
    if (shares < 0.001) return '<0.001'
    if (shares < 1) return shares.toFixed(4)
    return shares.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }

  const accountTotalValue = (() => {
    if (accountType === 'roth') {
      const rothAccount = data.accounts.find(a => a.key === 'roth_ira')
      return rothAccount?.value ?? 0
    } else {
      const taxableAccount = data.accounts.find(a => a.key === 'taxable')
      return taxableAccount?.value ?? 0
    }
  })()

  const getCurrentHolding = (symbol: string) => {
    const account = accountType === 'roth'
      ? data.accounts.find(a => a.key === 'roth_ira')
      : data.accounts.find(a => a.key === 'taxable')

    const position = account?.positions.find(p => p.symbol === symbol)
    const price = data.snapshots[symbol]?.price ?? 0

    return {
      shares: position?.shares ?? 0,
      value: position?.value ?? 0,
      price: price,
    }
  }

  // Build a set of symbols that are in the target allocation
  const targetSymbols = new Set(rows.map(r => r.symbol))

  // Get current positions for this account
  const account = accountType === 'roth'
    ? data.accounts.find(a => a.key === 'roth_ira')
    : data.accounts.find(a => a.key === 'taxable')

  const currentPositions = account?.positions.filter(p => p.shares > 0 && p.value > 0) ?? []

  // Start with target rows (enriched)
  const enhancedFromTarget = rows.map(row => {
    const currentHolding = getCurrentHolding(row.symbol)
    const targetPct = row.target_weight * 100
    const currentPct = row.current_weight * 100
    const gapPct = row.gap_pct * 100  // server guarantees target − current (positive = underweight)

    // Use server-provided current_value and dollar_gap when available.
    // This is critical for the Roth table where the server computes weights against
    // (Roth + Rollover) but the frontend only knows the Roth account balance —
    // recomputing targetValue from accountTotalValue alone would use the wrong denominator
    // and flip every BUY/SELL action.
    const currentValue = row.current_value ?? currentHolding.value
    const gapValue = row.dollar_gap != null
      ? row.dollar_gap                            // server pre-computed: target$ − current$
      : row.target_weight * accountTotalValue - currentValue  // taxable fallback

    const targetValue = currentValue + gapValue   // = target$ in all cases

    const price = currentHolding.price
    const sharesToTrade = price > 0 ? gapValue / price : 0
    const sharesAbs = Math.abs(sharesToTrade)

    let action = 'HOLD'
    let actionColor = M

    if (Math.abs(gapPct) > 0.5) {
      if (gapValue > 0) {
        action = 'BUY'
        actionColor = G
      } else {
        action = 'SELL'
        actionColor = R
      }
    }

    return {
      ...row,
      targetPct,
      currentPct,
      gapPct,
      targetValue,
      currentValue,
      gapValue,
      sharesToTrade,
      sharesAbs,
      price,
      action,
      actionColor,
      isTargetOnly: currentValue === 0,
      isCurrentOnly: false,
    }
  })

  // Add current positions that are NOT in the target (need to fully sell)
  const currentOnlyRows = currentPositions
    .filter(pos => !targetSymbols.has(pos.symbol) && pos.value > 0)
    .map(pos => {
      const price = data.snapshots[pos.symbol]?.price ?? 0
      const sharesToTrade = price > 0 ? -pos.shares : 0

      return {
        symbol: pos.symbol,
        targetPct: 0,
        currentPct: (pos.value / accountTotalValue) * 100,
        gapPct: -(pos.value / accountTotalValue) * 100,
        targetValue: 0,
        currentValue: pos.value,
        gapValue: -pos.value,
        sharesToTrade,
        sharesAbs: Math.abs(pos.shares),
        price,
        action: 'EXIT',
        actionColor: R,
        isTargetOnly: false,
        isCurrentOnly: true,
      }
    })

  const enhancedRows = [...enhancedFromTarget, ...currentOnlyRows]
    .sort((a, b) => {
      if (a.action === 'SELL' && b.action !== 'SELL') return -1
      if (a.action !== 'SELL' && b.action === 'SELL') return 1
      return Math.abs(b.gapValue) - Math.abs(a.gapValue)
    })

  if (enhancedRows.length === 0 || accountTotalValue === 0) {
    return (
      <div style={{ padding: '16px', color: M, fontSize: 12 }}>
        No target allocation data available for {accountType === 'roth' ? 'Roth IRA' : 'Taxable'} account.
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="bb-table" style={{ minWidth: 800 }}>
        <thead>
          <tr>
            <th>SYMBOL</th>
            <th className="r">TARGET %</th>
            <th className="r">CURRENT %</th>
            <th className="r">GAP %</th>
            <th className="r">TARGET $</th>
            <th className="r">CURRENT $</th>
            <th className="r">GAP $</th>
            <th className="r"># SHARES</th>
            <th>ACTION</th>
          </tr>
        </thead>
        <tbody>
          {enhancedRows.map(r => {
            const gapColor = Math.abs(r.gapPct) < 1 ? G : Math.abs(r.gapPct) < 3 ? 'var(--yellow)' : R

            return (
              <tr key={r.symbol}>
                              <td>
                <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                  {r.symbol.toUpperCase().includes('NEW') ? (
                    <span title={r.symbol}>Future position (TBD)</span>
                  ) : r.symbol}
                </span>
                {r.isCurrentOnly && (
                  <span style={{
                    fontSize: 12, fontWeight: 500, color: R,
                    padding: '1px 4px', marginLeft: 6,
                    border: '1px solid var(--fd-hairline)',
                    letterSpacing: '0.4px', borderRadius: 0
                  }}>EXIT</span>
                )}
                {r.isTargetOnly && !r.isCurrentOnly && (
                  <span style={{
                    fontSize: 12, fontWeight: 500, color: G,
                    padding: '1px 4px', marginLeft: 6,
                    border: '1px solid var(--fd-hairline)',
                    letterSpacing: '0.4px', borderRadius: 0
                  }}>NEW</span>
                )}
              </td>

                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{r.targetPct.toFixed(1)}%</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{r.currentPct.toFixed(1)}%</td>
                <td className="r" style={{ color: gapColor, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {r.gapPct >= 0 ? '+' : ''}{r.gapPct.toFixed(1)}%
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: A }}>
                  {fmtMoneyFull(r.targetValue)}
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: M }}>
                  {fmtMoneyFull(r.currentValue)}
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.gapValue >= 0 ? G : R, fontWeight: 500 }}>
                  {r.gapValue >= 0 ? '+' : '−'}{fmtMoneyFull(Math.abs(r.gapValue))}
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.actionColor }}>
                  {Math.abs(r.sharesToTrade) > 0.0001 ? formatShares(r.sharesAbs) : '—'}
                </td>
                <td>
                  <span style={{
                    fontSize: 12, fontWeight: 500, padding: '2px 6px', borderRadius: 0,
                    background: r.action === 'BUY' ? 'var(--fd-card)' : r.action === 'SELL' || r.action === 'EXIT' ? 'var(--fd-card)' : 'transparent',
                    color: r.actionColor,
                  }}>
                    {r.action}
                  </span>
                  {r.action === 'EXIT' && (
                    <div style={{ fontSize: 12, color: M, marginTop: 2, lineHeight: 1.3 }}>
                      {accountType === 'roth' ? 'full exit · tax-free' : 'full exit · CPA pending'}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 500, borderTop: '2px solid var(--border2)', background: 'var(--surface)' }}>
            <td colSpan={8} style={{ padding: '8px 12px' }}>
              {/* ── Rebalance Options ── */}
              {(() => {
                const tx = data.tax_data as any
                const lots = tx?.cost_basis_lots ?? {}
                const stcgRate = tx ? ((tx.marginal_rate ?? 32) > 1 ? (tx.marginal_rate ?? 32) / 100 : (tx.marginal_rate ?? 0.32)) : 0.32
                const ltcgRate = tx ? ((tx.ltcg_rate ?? 15) > 1 ? (tx.ltcg_rate ?? 15) / 100 : (tx.ltcg_rate ?? 0.15)) : 0.15

                const modelBuys  = enhancedRows.filter(r => r.gapValue > 0).reduce((s, r) => s + r.gapValue, 0)
                const modelSells = Math.abs(enhancedRows.filter(r => r.gapValue < 0).reduce((s, r) => s + r.gapValue, 0))
                const modelTotal = (modelBuys + modelSells) / 2

                // Tax-aware: include buys always; for sells only include positions with no STCG lots
                let taxAwareSells = 0
                let taxAwareBuys  = modelBuys
                let deferredStcgTax = 0
                for (const r of enhancedRows) {
                  if (r.gapValue >= 0) continue
                  const symLots = lots[r.symbol]?.lots ?? []
                  const hasStcg = symLots.some((l: any) => (l.days_to_lt ?? 0) > 0 && ((l.market_value ?? 0) - (l.cost_basis ?? 0)) > 0)
                  if (!hasStcg) {
                    taxAwareSells += Math.abs(r.gapValue)
                  } else {
                    // Estimate tax on STCG portion deferred
                    const stcgGain = symLots.filter((l: any) => (l.days_to_lt ?? 0) > 0).reduce((s: number, l: any) => s + Math.max(0, (l.market_value ?? 0) - (l.cost_basis ?? 0)), 0)
                    deferredStcgTax += stcgGain * (stcgRate - ltcgRate)
                  }
                }
                const taxAwareTotal = (taxAwareBuys + taxAwareSells) / 2

                // Do nothing: drift cost estimated as avg drift% × 0.5% annual alpha drag
                const sumAbsGap = enhancedRows.reduce((sum, r) => sum + Math.abs(r.gapPct), 0)
                const avgDrift = enhancedRows.length > 0 ? sumAbsGap / enhancedRows.length : 0
                const annualDriftCost = (avgDrift / 100) * accountTotalValue * 0.005

                if (accountType === 'roth') {
                  const rothOpts = [
                    {
                      label: 'Rebalance Now',
                      sub: 'Tax-free — no STCG or LTCG owed',
                      value: fmtMoneyFull(modelTotal),
                      detail: `${fmtMoneyFull(modelBuys)} buys · ${fmtMoneyFull(modelSells)} sells`,
                      color: G,
                    },
                    {
                      label: 'Do Nothing',
                      sub: 'Estimated annual drift cost',
                      value: `~${fmtMoneyFull(annualDriftCost)}/yr`,
                      detail: `${avgDrift.toFixed(1)}% avg drift · 0.5% alpha drag`,
                      color: R,
                    },
                  ]
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 10 }}>
                      {rothOpts.map(o => (
                        <div key={o.label} style={{
                          padding: '8px 10px', borderRadius: 0,
                          background: 'var(--fd-card)',
                          border: '1px solid var(--fd-hairline)',
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: o.color, letterSpacing: '0.4px', marginBottom: 2 }}>{o.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)', lineHeight: 1.2 }}>{o.value}</div>
                          <div style={{ fontSize: 12, color: M, marginTop: 3 }}>{o.sub}</div>
                          <div style={{ fontSize: 12, color: M, marginTop: 1, opacity: 0.7 }}>{o.detail}</div>
                        </div>
                      ))}
                    </div>
                  )
                }

                const opts = [
                  {
                    label: 'Model Rebalance',
                    sub: 'Full rebalance to target',
                    value: fmtMoneyFull(modelTotal),
                    detail: `${fmtMoneyFull(modelBuys)} buys · ${fmtMoneyFull(modelSells)} sells`,
                    color: A,
                  },
                  {
                    label: 'Tax-Aware',
                    sub: `Defer STCG lots · save ~${fmtMoneyFull(deferredStcgTax)}`,
                    value: fmtMoneyFull(taxAwareTotal),
                    detail: `${fmtMoneyFull(taxAwareBuys)} buys · ${fmtMoneyFull(taxAwareSells)} sells`,
                    color: G,
                  },
                  {
                    label: 'Do Nothing',
                    sub: 'Estimated annual drift cost',
                    value: `~${fmtMoneyFull(annualDriftCost)}/yr`,
                    detail: `${avgDrift.toFixed(1)}% avg drift · 0.5% alpha drag`,
                    color: R,
                  },
                ]

                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                    {opts.map(o => (
                      <div key={o.label} style={{
                        padding: '8px 10px', borderRadius: 0,
                        background: 'var(--fd-card)',
                        border: '1px solid var(--fd-hairline)',
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: o.color, letterSpacing: '0.4px', marginBottom: 2 }}>{o.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)', lineHeight: 1.2 }}>{o.value}</div>
                        <div style={{ fontSize: 12, color: M, marginTop: 3 }}>{o.sub}</div>
                        <div style={{ fontSize: 12, color: M, marginTop: 1, opacity: 0.7 }}>{o.detail}</div>
                      </div>
                    ))}
                  </div>
                )
              })()}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: M }}>TOTAL PORTFOLIO VALUE: <span style={{ color: 'var(--text)', fontWeight: 500 }}>{fmtMoneyFull(accountTotalValue)}</span></span>
                <span style={{ color: A }}>
                  TOTAL REBALANCE: {fmtMoneyFull(enhancedRows.reduce((sum, r) => sum + Math.abs(r.gapValue), 0) / 2)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12 }}>
                <span style={{ color: G }}>
                  BUYS: {fmtMoneyFull(enhancedRows.filter(r => r.gapValue > 0).reduce((s, r) => s + r.gapValue, 0))}
                </span>
                <span style={{ color: R }}>
                  SELLS: {fmtMoneyFull(Math.abs(enhancedRows.filter(r => r.gapValue < 0).reduce((s, r) => s + r.gapValue, 0)))}
                </span>
                <span style={{ color: M }}>
                  NET: {fmtMoneyFull(enhancedRows.reduce((sum, r) => sum + r.gapValue, 0))}
                </span>
              </div>
              {/* ── Drift Accuracy + Summary ── */}
              {(() => {
                // Drift accuracy: 100% − (Σ|gap%| / 2)
                // Dividing by 2 avoids double-counting (overweights mirror underweights).
                // 100% = perfectly on target; matches the formula used by app.passive.com.
                const sumAbsGap = enhancedRows.reduce((sum, r) => sum + Math.abs(r.gapPct), 0)
                const driftAccuracy = Math.max(0, 100 - sumAbsGap / 2)
                const accuracyColor = driftAccuracy >= 95 ? G : driftAccuracy >= 85 ? 'var(--yellow)' : driftAccuracy >= 70 ? A : R
                const accuracyLabel = driftAccuracy >= 95 ? 'EXCELLENT' : driftAccuracy >= 85 ? 'GOOD' : driftAccuracy >= 70 ? 'FAIR' : 'NEEDS REBAL'

                // Average per-position absolute drift
                const totalDriftPct = enhancedRows.length > 0 ? sumAbsGap / enhancedRows.length : 0
                const driftColor = totalDriftPct < 2 ? G : totalDriftPct < 5 ? 'var(--yellow)' : totalDriftPct < 10 ? A : R
                const maxDrift = Math.max(...enhancedRows.map(r => Math.abs(r.gapPct)), 0)
                const maxDriftSym = enhancedRows.find(r => Math.abs(r.gapPct) === maxDrift)?.symbol ?? '—'
                return (
                  <>
                    {/* Drift accuracy — prominent row */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, marginTop: 8,
                      padding: '6px 10px', borderRadius: 0,
                      background: 'var(--fd-card)',
                      border: '1px solid var(--fd-hairline)',
                    }}>
                      <div style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)', color: accuracyColor, lineHeight: 1 }}>
                        {driftAccuracy.toFixed(1)}%
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: accuracyColor, letterSpacing: '0.5px' }}>
                          PLAN ADHERENCE — {accuracyLabel}
                        </div>
                        <div style={{ fontSize: 12, color: M, marginTop: 1 }}>
                          100% − (Σ|gap| ÷ 2) · {sumAbsGap.toFixed(2)}% total deviation across {enhancedRows.length} positions
                          {accountType === 'taxable' && driftAccuracy < 85 && (
                            <span style={{ color: A, marginLeft: 4 }}>· low score expected — tax-constrained exits pending CPA guidance</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Detail drift stats */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12, borderTop: '1px solid var(--border2)', paddingTop: 4 }}>
                      <span style={{ color: M }}>
                        AVG DRIFT: <span style={{ color: driftColor, fontWeight: 500 }}>{totalDriftPct.toFixed(2)}%</span> per position
                      </span>
                      <span style={{ color: M }}>
                        MAX DRIFT: <span style={{ color: driftColor, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{maxDriftSym}</span>
                        {' '}<span style={{ color: driftColor, fontWeight: 500 }}>{maxDrift.toFixed(1)}%</span>
                      </span>
                      <span style={{ color: M }}>
                        DRIFT RATING: <span style={{ color: driftColor, fontWeight: 500 }}>
                          {totalDriftPct < 2 ? 'TIGHT' : totalDriftPct < 5 ? 'MODERATE' : totalDriftPct < 10 ? 'LOOSE' : 'DRIFTED'}
                        </span>
                      </span>
                    </div>
                  </>
                )
              })()}
              <div style={{ fontSize: 12, color: M, marginTop: 4 }}>
                * Positive gap = buy, Negative gap = sell | EXIT = remove from portfolio | Shares calculated at current market price
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
