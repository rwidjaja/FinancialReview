import { fmtMoneyFull } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import { G, A, M, Y } from './taxColors'
import type { DashboardData } from '../../types/dashboard'

// ── Tax-Efficient Rebalance Score ───────────────────────────────────────────
export function RebalanceScore({ data, tx }: { data: DashboardData; tx: DashboardData['tax_data'] }) {
  const convAmt = tx.exec_conv_target ?? tx.annual_conversion ?? 0
  const rothPlan = data.roth_target_analysis ?? []
  const txaPlan = data.taxable_target_analysis ?? []
  const margRate = (tx.marginal_rate ?? ((tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE) / 100)) * 100
  const rollPlan = tx.rollover_conv_plan_dynamic ?? tx.rollover_conv_plan ?? []

  // Roth conversion score
  const rothUnder = rothPlan.filter(r => r.gap_pct > 0.005)
  const rothAvgGap = rothUnder.length > 0
    ? rothUnder.reduce((s, r) => s + Math.abs(r.gap_pct) * 100, 0) / rothUnder.length
    : 0
  const convScoreRaw = margRate > 0 ? rothAvgGap / margRate * 10 : null
  const convScore = convScoreRaw != null ? convScoreRaw.toFixed(1) : '∞'
  const convScoreColor = convScoreRaw == null ? G : convScoreRaw >= 3 ? G : convScoreRaw >= 1.5 ? Y : A

  // Taxable rebalance score
  const txaOver = txaPlan.filter(r => r.gap_pct < -0.02)
  const txaUnder = txaPlan.filter(r => r.gap_pct > 0.02)
  const txaAvgGap = txaUnder.length > 0 ? txaUnder.reduce((s, r) => s + Math.abs(r.gap_pct) * 100, 0) / txaUnder.length : 0
  const txaAvgCost = txaOver.length > 0
    ? txaOver.reduce((s, r) => s + ((r as unknown as Record<string, number>)['tax_cost_sell_pct'] ?? 0), 0) / txaOver.length
    : 0
  const txaScoreRaw = txaAvgCost > 0 ? txaAvgGap / txaAvgCost * 10 : null
  const txaScore = txaScoreRaw != null ? txaScoreRaw.toFixed(1) : '—'
  const txaScoreColor = txaScoreRaw == null ? M : txaScoreRaw >= 3 ? G : txaScoreRaw >= 1.5 ? Y : A

  // Flow labels
  const rollSyms = rollPlan.map(r => r.symbol).join(', ') || 'Rollover'
  const rothSyms = rothPlan.filter(r => (r.conv_dollars ?? 0) > 0).map(r => r.symbol).join(', ') || 'Roth'
  const sellSyms = txaOver.map(r => r.symbol).join(', ') || '—'
  const buySyms = txaUnder.map(r => r.symbol).join(', ') || '—'

  const rows = [
    {
      method: 'ROTH CONVERSION', methodColor: G,
      flow: `${rollSyms} → ${rothSyms}`,
      avgGap: rothAvgGap.toFixed(1) + '%',
      taxCost: margRate.toFixed(0) + '% ordinary',
      taxCostColor: Y,
      score: convScore, scoreColor: convScoreColor,
      bestUse: 'Rollover reduction + Roth build',
      borderColor: G,
    },
    {
      method: 'SELL TAXABLE', methodColor: A,
      flow: `${sellSyms} SELL → ${buySyms} BUY`,
      avgGap: txaAvgGap > 0 ? txaAvgGap.toFixed(1) + '%' : '—',
      taxCost: txaAvgCost > 0 ? txaAvgCost.toFixed(1) + '% LT gains (≥1yr hold)' : '—',
      taxCostColor: A,
      score: txaScore, scoreColor: txaScoreColor,
      bestUse: 'Taxable rebalance · wait for LT status where possible',
      borderColor: A,
    },
    {
      method: 'NEW CASH', methodColor: G,
      flow: 'Deploy to underweights',
      avgGap: txaAvgGap > 0 ? txaAvgGap.toFixed(1) + '%' : '—',
      taxCost: '0% (no sale)',
      taxCostColor: G,
      score: '∞', scoreColor: G,
      bestUse: 'Most efficient — limited by cash',
      borderColor: G,
    },
  ]

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      {convAmt > 0 && (
        <div style={{ fontSize: 12, color: M, padding: '6px 8px 10px', fontFamily: 'var(--font-mono)' }}>
          SCORE = (avg % gap closed) ÷ (tax cost %) × 10 · Conv capacity: {fmtMoneyFull(convAmt)}
          <span style={{ opacity: 0.7 }}> — bracket-optimal sizing (ceiling − base AGI − buffer), not a recommendation; see Conversion Command Center</span>
          {tx.target_bracket_ceiling != null && tx.full_year_agi_estimate != null && (() => {
            // Server clamps exec_conv_target at the Rollover IRA balance (can't convert
            // more than the account holds) — when that clamp binds, the three terms
            // below don't actually sum to convAmt, so say so instead of asserting a
            // false equality.
            const rawFormula = tx.target_bracket_ceiling - tx.full_year_agi_estimate - (tx.safety_buffer ?? 0)
            const rolloverClamped = tx.rollover_balance != null && Math.round(Math.max(0, rawFormula)) > Math.round(tx.rollover_balance)
            return (
              <div style={{ opacity: 0.6, fontSize: 12, marginTop: 2 }}>
                {fmtMoneyFull(tx.target_bracket_ceiling)} ceiling − {fmtMoneyFull(tx.full_year_agi_estimate)} full-year AGI est. (base) − {fmtMoneyFull(tx.safety_buffer)} buffer
                {rolloverClamped
                  ? <> = {fmtMoneyFull(Math.max(0, rawFormula))}, capped at {fmtMoneyFull(tx.rollover_balance!)} Rollover IRA balance = {fmtMoneyFull(convAmt)}</>
                  : <> = {fmtMoneyFull(convAmt)}</>}
              </div>
            )
          })()}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="bb-table">
          <thead>
            <tr>
              <th>METHOD</th>
              <th>FLOW</th>
              <th className="r">AVG GAP CLOSED</th>
              <th className="r">TAX COST</th>
              <th className="r">SCORE</th>
              <th>BEST USE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderLeft: `3px solid ${row.borderColor}` }}>
                <td style={{ fontWeight: 500, color: row.methodColor }}>{row.method}</td>
                <td style={{ fontSize: 12, color: M }}>{row.flow}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{row.avgGap}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: row.taxCostColor }}>{row.taxCost}</td>
                <td className="r">
                  <span style={{ fontSize: 18, fontWeight: 500, color: row.scoreColor, fontFamily: 'var(--font-mono)' }}>
                    {row.score}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: M }}>{row.bestUse}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
