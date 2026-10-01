import { STRUCTURAL_ICON, STRUCTURAL_LABEL } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, M } from './DetailTab.constants'

export function DecisionActionStrip({ data }: { data: DashboardData }) {
  if (data.decisions.length === 0) return null

  const statusColors: Record<string, string> = {
    ENGINE_HEALTHY: G,
    VALUATION_STRETCHED: 'var(--yellow)',
    INCOME_COMPRESSION: 'var(--amber)',
    STRUCTURAL_BREAKDOWN: R,
  }

  const criticalCount = data.decisions.filter(d => d.structural_status === 'STRUCTURAL_BREAKDOWN').length
  const stretchedCount = data.decisions.filter(d => d.structural_status === 'VALUATION_STRETCHED').length
  const healthyCount = data.decisions.filter(d => d.structural_status === 'ENGINE_HEALTHY').length

  return (
    <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px' }}>◈ PORTFOLIO FIT — DECISION SIGNALS</span>
        <span style={{ fontSize: 12, color: G }}>✓ {healthyCount} HEALTHY</span>
        {stretchedCount > 0 && <span style={{ fontSize: 12, color: 'var(--yellow)' }}> {stretchedCount} STRETCHED</span>}
        {criticalCount > 0 && <span style={{ fontSize: 12, color: R }}> {criticalCount} BREAKDOWN</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {data.decisions.map(dec => {
          const c = statusColors[dec.structural_status] ?? M
          const icon = STRUCTURAL_ICON[dec.structural_status] ?? ''
          const label = STRUCTURAL_LABEL[dec.structural_status] ?? dec.structural_status
          const snap = data.snapshots[dec.symbol]
          const dayPct = (snap?.price_change_pct ?? 0) * 100  // server sends a 0–1 fraction
          const heldValue = data.accounts
            .flatMap(a => a.positions)
            .filter(p => p.symbol === dec.symbol)
            .reduce((s, p) => s + p.value, 0)
          const isHeld = heldValue > 0
          return (
            <div key={dec.symbol} style={{
              padding: '6px 10px', background: 'var(--bg)',
              border: `1px solid var(--border2)`, borderTop: `2px solid ${c}`,
              minWidth: 108, opacity: isHeld ? 1 : 0.65,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: 12 }}>{icon}</span>
                <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{dec.symbol}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: c, textTransform: 'uppercase', marginBottom: 3 }}>
                {label.split(' ')[0]}
              </div>
              {snap?.price != null ? (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>
                  ${snap.price.toFixed(2)}
                  <span style={{ fontSize: 12, fontWeight: 400, color: dayPct >= 0 ? G : R, marginLeft: 4 }}>
                    {dayPct >= 0 ? '+' : ''}{dayPct.toFixed(2)}%
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)', marginBottom: 1 }}>no price data</div>
              )}
              {isHeld ? (
                <div style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)' }}>
                  {heldValue >= 1000 ? `$${(heldValue / 1000).toFixed(1)}k` : `$${heldValue.toFixed(0)}`}
                </div>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)', letterSpacing: '0.4px' }}>TARGET ONLY</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
