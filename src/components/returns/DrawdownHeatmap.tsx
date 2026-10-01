import { useState } from 'react'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE } from '../ui/chartTooltip'

const M = 'var(--text2)'

export function DrawdownHeatmap({ data, perfData, period }: {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  const posValues: Record<string, number> = {}
  for (const acct of data.accounts) {
    for (const pos of acct.positions) {
      posValues[pos.symbol] = (posValues[pos.symbol] ?? 0) + pos.value
    }
  }
  const totalValue = Object.values(posValues).reduce((a, b) => a + b, 0) || 1

  const symbols = data.decisions
    .map(d => d.symbol)
    .filter(sym => perfData[sym]?.[period] != null)
    .sort((a, b) => (perfData[a][period].max_drawdown ?? 0) - (perfData[b][period].max_drawdown ?? 0))

  if (symbols.length === 0) return (
    <div style={{ padding: '12px', color: M, fontSize: 12 }}>No drawdown data for selected period.</div>
  )

  const ddLabel = (dd: number) => dd > -10 ? 'MINIMAL' : dd > -20 ? 'MODERATE' : dd > -30 ? 'ELEVATED' : 'SEVERE'
  const ddColor = (dd: number) => dd > -10 ? 'var(--fd-accent)' : dd > -20 ? '#ffd600' : dd > -30 ? 'var(--as-lilac)' : 'var(--fd-negative)'
  const ddBg   = (dd: number) => dd > -10 ? 'var(--fd-card)' : dd > -20 ? 'var(--fd-card)' : dd > -30 ? 'var(--fd-card)' : 'var(--fd-card)'

  // Sort worst → best for the bar chart too
  const worst = symbols[0]
  const worstDd = perfData[worst]?.[period]?.max_drawdown ?? 0

  const hovPd = hovered ? perfData[hovered]?.[period] : null
  const hovW  = hovered ? (posValues[hovered] ?? 0) / totalValue : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px' }}>
      {/* Heatmap grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {symbols.map(sym => {
          const pd = perfData[sym]?.[period]
          const dd = pd?.max_drawdown ?? 0
          const w = (posValues[sym] ?? 0) / totalValue
          const c = ddColor(dd)
          const isHov = hovered === sym
          return (
            <div
              key={sym}
              style={{
                padding: '8px 12px', textAlign: 'center', minWidth: 90,
                background: ddBg(dd),
                border: `1px solid ${c}`, borderBottom: `3px solid ${c}`,
                cursor: 'default',
                outline: isHov ? `1px solid ${c}` : 'none',
                transition: 'outline 0.1s',
              }}
              onMouseEnter={() => setHovered(sym)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{sym}</div>
              <div style={{ fontSize: 18, fontWeight: 500, color: c, fontFamily: 'var(--font-mono)', margin: '3px 0' }}>
                {dd.toFixed(1)}%
              </div>
              <div style={{ fontSize: 12, color: c, fontWeight: 500, letterSpacing: '0.5px' }}>{ddLabel(dd)}</div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{(w * 100).toFixed(1)}% port</div>
              {pd?.sharpe != null && (
                <div style={{ fontSize: 12, color: pd.sharpe >= 1 ? 'var(--fd-accent)' : pd.sharpe >= 0.5 ? '#ffd600' : 'var(--fd-negative)', marginTop: 2 }}>
                  SR {pd.sharpe.toFixed(2)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Worst drawdown relative bar — with hover tooltip */}
      <div>
        <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>
          MAX DRAWDOWN COMPARISON — {period.toUpperCase()} · WORST-FIRST
        </div>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {symbols.map(sym => {
            const pd = perfData[sym]?.[period]
            const dd = pd?.max_drawdown ?? 0
            const barPct = worstDd !== 0 ? (dd / worstDd) * 100 : 0
            const c = ddColor(dd)
            const w = (posValues[sym] ?? 0) / totalValue
            const isHov = hovered === sym
            return (
              <div
                key={sym}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '2px 4px',
                  background: isHov ? 'var(--fd-card)' : 'transparent',
                  borderRadius: 0, cursor: 'default',
                }}
                onMouseEnter={() => setHovered(sym)}
                onMouseLeave={() => setHovered(null)}
              >
                <div style={{ width: 48, fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text)', textAlign: 'right', flexShrink: 0 }}>
                  {sym}
                </div>
                <div style={{ flex: 1, height: 10, background: 'var(--surface)' }}>
                  <div style={{ height: 10, width: `${barPct}%`, background: c, opacity: 0.75, transition: 'width 0.3s' }} />
                </div>
                <div style={{ width: 50, fontSize: 12, fontFamily: 'var(--font-mono)', color: c, fontWeight: 500, textAlign: 'right', flexShrink: 0 }}>
                  {dd.toFixed(1)}%
                </div>
                <div style={{ width: 42, fontSize: 12, color: M, textAlign: 'right', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
                  {(w * 100).toFixed(1)}%
                </div>
              </div>
            )
          })}

          {/* Hover tooltip */}
          {hovered && hovPd && (
            <div style={{
              ...TOOLTIP_STYLE,
              position: 'absolute',
              top: 0,
              right: 0,
              zIndex: 100,
              pointerEvents: 'none',
              borderLeft: `3px solid ${ddColor(hovPd.max_drawdown ?? 0)}`,
            }}>
              <div style={TOOLTIP_LABEL_STYLE}>{hovered}</div>
              <div style={{ color: ddColor(hovPd.max_drawdown ?? 0) }}>
                Max Drawdown: {(hovPd.max_drawdown ?? 0).toFixed(1)}%
              </div>
              <div style={{ color: ddColor(hovPd.max_drawdown ?? 0), fontSize: 12 }}>
                {ddLabel(hovPd.max_drawdown ?? 0)}
              </div>
              {hovPd.sharpe != null && (
                <div style={{ color: M }}>Sharpe: {hovPd.sharpe.toFixed(2)}</div>
              )}
              <div style={{ color: M }}>Port weight: {(hovW * 100).toFixed(1)}%</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: M }}>
        Max drawdown = peak-to-trough loss during period · Sort: worst (most negative) first
      </div>
    </div>
  )
}
