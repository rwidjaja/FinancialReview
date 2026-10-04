import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, M } from './DetailTab.constants'
import { TileGrid, GridTile, StatusTag, Label, mono, muted, type Status } from '../ui/primitives'

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
    .sort((a, b) => (ACTION_ORDER[a.action] ?? 9) - (ACTION_ORDER[b.action] ?? 9) || Math.abs(b.gapValue) - Math.abs(a.gapValue))

  if (enhancedRows.length === 0 || accountTotalValue === 0) {
    return (
      <span style={{ fontSize: 14, ...muted }}>
        No target allocation data available for {accountType === 'roth' ? 'Roth IRA' : 'Taxable'} account.
      </span>
    )
  }

  // ── Totals ──
  const buys  = enhancedRows.filter(r => r.gapValue > 0).reduce((s, r) => s + r.gapValue, 0)
  const sells = Math.abs(enhancedRows.filter(r => r.gapValue < 0).reduce((s, r) => s + r.gapValue, 0))
  const nBuy  = enhancedRows.filter(r => r.action === 'BUY').length
  const nSell = enhancedRows.filter(r => r.action === 'SELL' || r.action === 'EXIT').length

  // Drift accuracy: 100% − (Σ|gap%| ÷ 2). Dividing by 2 avoids double-counting
  // (overweights mirror underweights). Same formula as app.passive.com.
  const sumAbsGap = enhancedRows.reduce((sum, r) => sum + Math.abs(r.gapPct), 0)
  const adherence = Math.max(0, 100 - sumAbsGap / 2)
  const adherenceStatus: Status = adherence >= 95 ? 'ok' : adherence >= 85 ? 'watch' : 'alert'
  const adherenceLabel = adherence >= 95 ? 'Excellent' : adherence >= 85 ? 'Good' : adherence >= 70 ? 'Fair' : 'Needs rebalance'
  const maxRow = enhancedRows.reduce((m, r) => (Math.abs(r.gapPct) > Math.abs(m.gapPct) ? r : m), enhancedRows[0])

  // Tax-aware (taxable only): sells on positions with unrealised short-term gains are deferred
  const tx = data.tax_data as unknown as { marginal_rate?: number; ltcg_rate?: number; cost_basis_lots?: Record<string, { lots?: Lot[] }> } | undefined
  const lots = tx?.cost_basis_lots ?? {}
  const rate = (v: number | undefined, d: number) => { const x = v ?? d; return x > 1 ? x / 100 : x }
  const stcgRate = rate(tx?.marginal_rate, 32)
  const ltcgRate = rate(tx?.ltcg_rate, 15)
  let sellNow = 0, deferredTaxSaved = 0
  const deferred: string[] = []
  for (const r of enhancedRows) {
    if (r.gapValue >= 0) continue
    const symLots = lots[r.symbol]?.lots ?? []
    const stLots = symLots.filter((l: Lot) => (l.days_to_lt ?? 0) > 0 && ((l.market_value ?? 0) - (l.cost_basis ?? 0)) > 0)
    if (stLots.length === 0) { sellNow += Math.abs(r.gapValue); continue }
    deferred.push(r.symbol)
    deferredTaxSaved += stLots.reduce((s: number, l: Lot) => s + ((l.market_value ?? 0) - (l.cost_basis ?? 0)), 0) * (stcgRate - ltcgRate)
  }

  const sellSub = accountType === 'roth'
    ? `${nSell} position${nSell !== 1 ? 's' : ''} · tax-free inside the Roth`
    : deferred.length === 0
      ? `${nSell} position${nSell !== 1 ? 's' : ''} · no short-term lots in the way`
      : `${fmtMoneyFull(sellNow)} can go now. Waiting on ${deferred.join(', ')} for long-term rates saves ~${fmtMoneyFull(deferredTaxSaved)}.`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TileGrid cols={3}>
        <GridTile label="To sell" value={<span style={{ color: sells > 0 ? 'var(--fd-negative)' : undefined }}>{fmtMoneyFull(sells)}</span>} sub={sellSub} />
        <GridTile label="To buy" value={fmtMoneyFull(buys)} sub={`${nBuy} position${nBuy !== 1 ? 's' : ''} · account ${fmtMoneyFull(accountTotalValue)}`} />
        <GridTile label="Plan adherence" status={adherenceStatus} value={`${adherence.toFixed(1)}%`}
          sub={`${adherenceLabel}. Largest gap ${maxRow.symbol} ${Math.abs(maxRow.gapPct).toFixed(1)} pts.${accountType === 'taxable' && adherence < 85 ? ' Low score expected while tax-constrained exits wait.' : ''}`} />
      </TileGrid>

      <div>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '10px 0', borderTop: '2px solid var(--fd-rule)', borderBottom: '1px solid var(--fd-hairline)', ...mono, ...muted }}>
          <span>Symbol</span><span>Current → target</span><span style={{ textAlign: 'right' }}>Trade</span><span style={{ textAlign: 'right' }}>Shares</span><span style={{ textAlign: 'right' }}>Action</span>
        </div>
        {enhancedRows.map(r => {
          const hold = r.action === 'HOLD'
          const label = r.symbol.toUpperCase().includes('NEW') ? 'Future (TBD)' : r.symbol
          return (
            <div key={r.symbol} className="fd-row"
              title={`Current ${fmtMoneyFull(r.currentValue)} → target ${fmtMoneyFull(r.targetValue)}${r.price > 0 ? ` · @ ${fmtMoneyFull(r.price)}` : ''}`}
              style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14, color: hold ? 'var(--fd-muted)' : undefined }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }} title={r.symbol}>{label}</span>
              <span>
                {r.currentPct.toFixed(1)}% <span style={muted}>→</span> {r.targetPct.toFixed(1)}%
                {r.isTargetOnly && !r.isCurrentOnly && <span style={{ fontSize: 13, ...muted }}> · new</span>}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 500, color: hold ? undefined : r.gapValue >= 0 ? 'var(--fd-ink)' : 'var(--fd-negative)' }}>
                {hold ? '—' : `${r.gapValue >= 0 ? '+' : '−'}${fmtMoneyFull(Math.abs(r.gapValue))}`}
              </span>
              <span style={{ textAlign: 'right' }}>{!hold && r.sharesAbs > 0.0001 ? formatShares(r.sharesAbs) : '—'}</span>
              <span style={{ textAlign: 'right' }}>
                {hold ? <Label>Hold</Label> : <StatusTag status={r.action === 'BUY' ? 'ok' : 'alert'}>{r.action}</StatusTag>}
              </span>
            </div>
          )
        })}
      </div>

      <span style={{ fontSize: 13, ...muted }}>
        Shares at current price. Hold = within 0.5 pts of target. Exit = held without a target{accountType === 'taxable' ? ' (CPA pending)' : ''}. Hover a row for dollar values.
      </span>
    </div>
  )
}

type Lot = { days_to_lt?: number; market_value?: number; cost_basis?: number }

const COLS = '88px minmax(0,1fr) 120px 88px 72px'
const ACTION_ORDER: Record<string, number> = { EXIT: 0, SELL: 0, BUY: 1, HOLD: 2 }
