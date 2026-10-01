import { useState } from 'react'
import { fmtPct } from '../../utils/formatters'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE } from '../ui/chartTooltip'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'

export function ConcentrationDriverDecomposition({ data, perfData, period, totalValue }: {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
  totalValue: number
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  // Position weights
  const posValues: Record<string, number> = {}
  for (const acct of data.accounts) {
    for (const pos of acct.positions) {
      posValues[pos.symbol] = (posValues[pos.symbol] ?? 0) + pos.value
    }
  }
  const safeTotal = totalValue > 0 ? totalValue : 1

  type ContribEntry = { contrib: number; weight: number; ret: number }
  const contribs: Record<string, ContribEntry> = {}
  let totalRet = 0

  for (const sym of data.decisions.map(d => d.symbol)) {
    const pd = perfData[sym]?.[period]
    if (!pd) continue
    const w = (posValues[sym] ?? 0) / safeTotal
    const ret = pd.total_return
    contribs[sym] = { contrib: w * ret, weight: w * 100, ret }
    totalRet += w * ret
  }

  const sorted = Object.entries(contribs)
    .sort((a, b) => Math.abs(b[1].contrib) - Math.abs(a[1].contrib))

  if (sorted.length === 0) {
    return <div style={{ padding: 16, color: M, fontSize: 12 }}>No data for this period.</div>
  }

  const topSym  = sorted[0][0]
  const topC    = contribs[topSym].contrib
  const restC   = totalRet - topC
  const topPct  = totalRet !== 0 ? Math.round(Math.abs(topC / totalRet) * 100) : 0
  const maxBar  = Math.max(0.01, sorted.reduce((s, [, c]) => Math.max(s, Math.abs(c.contrib)), 0))

  // contrib = weight(fraction) × return(percent) → result is percent contribution (e.g. 2.79%)
  const fmtR = (v: number) => fmtPct(v)

  const hoveredEntry = hovered ? contribs[hovered] : null

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* Top callout */}
      <div style={{ fontSize: 12, color: M, marginBottom: 10 }}>
        Price-weighted {period.toUpperCase()} return: <strong style={{ color: 'var(--text)', fontSize: 13 }}>{fmtR(totalRet)}</strong>
        {' '} — Top driver: <strong style={{ color: A }}>{topSym}</strong> contributed{' '}
        <strong style={{ color: topC >= 0 ? G : R }}>{fmtR(topC)}</strong>
      </div>

      {/* Horizontal bars per symbol — with hover tooltip */}
      <div style={{ marginBottom: 12, position: 'relative' }}>
        {sorted.map(([sym, c]) => {
          const barW = Math.max(1, Math.abs(c.contrib / maxBar) * 100)
          const barCol = c.contrib >= 0 ? (sym === topSym ? A : G) : R
          const isHov = hovered === sym
          return (
            <div
              key={sym}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5,
                padding: '2px 4px',
                background: isHov ? 'var(--fd-card)' : 'transparent',
                borderRadius: 0, cursor: 'default',
              }}
              onMouseEnter={() => setHovered(sym)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{ width: 52, fontSize: 12, fontWeight: 500, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{sym}</div>
              <div style={{ flex: 1, height: 14, background: 'var(--border2)', borderRadius: 0, overflow: 'hidden' }}>
                <div style={{ width: `${barW}%`, height: '100%', background: barCol, borderRadius: 0 }} />
              </div>
              <div style={{ width: 64, fontSize: 12, fontWeight: 500, color: barCol, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtR(c.contrib)}</div>
              <div style={{ width: 48, fontSize: 12, color: M, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{c.weight.toFixed(1)}%</div>
            </div>
          )
        })}

        {/* Hover tooltip */}
        {hovered && hoveredEntry && (
          <div style={{
            ...TOOLTIP_STYLE,
            position: 'absolute',
            top: 0,
            right: 0,
            zIndex: 100,
            pointerEvents: 'none',
            borderLeft: `3px solid ${hoveredEntry.contrib >= 0 ? (hovered === topSym ? A : G) : R}`,
          }}>
            <div style={TOOLTIP_LABEL_STYLE}>{hovered}</div>
            <div style={{ color: hoveredEntry.contrib >= 0 ? G : R }}>
              Contribution: {fmtR(hoveredEntry.contrib)}
            </div>
            <div style={{ color: M }}>Individual return: {fmtR(hoveredEntry.ret)}</div>
            <div style={{ color: M }}>Portfolio weight: {hoveredEntry.weight.toFixed(1)}%</div>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: '10px 12px', background: 'var(--surface)', border: `1px solid var(--border2)`, borderTop: `2px solid ${A}` }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>{topSym} CONTRIBUTION</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: A, fontFamily: 'var(--font-mono)' }}>{fmtR(topC)}</div>
          <div style={{ fontSize: 12, color: M, marginTop: 4 }}>{topPct}% of total return from one symbol</div>
        </div>
        <div style={{ padding: '10px 12px', background: 'var(--surface)', border: `1px solid var(--border2)`, borderTop: `2px solid var(--blue)` }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>EVERYTHING ELSE ({sorted.length - 1} SYMBOLS)</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--blue)', fontFamily: 'var(--font-mono)' }}>{fmtR(restC)}</div>
          <div style={{ fontSize: 12, color: M, marginTop: 4 }}>{100 - topPct}% from remaining holdings</div>
        </div>
      </div>

      {/* What-if card */}
      <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--surface)', border: `1px solid var(--border2)` }}>
        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>WHAT IF {topSym} WAS FLAT?</div>
        <div style={{ fontSize: 22, fontWeight: 500, color: restC >= 0 ? G : R, fontFamily: 'var(--font-mono)' }}>{fmtR(restC)}</div>
        <div style={{ fontSize: 12, color: M, marginTop: 4 }}>
          Portfolio return with {topSym} contribution removed.{' '}
          Concentration {topC >= 0 ? 'added' : 'cost'}{' '}
          <strong style={{ color: A }}>{fmtR(Math.abs(topC))}</strong>{' '}
          to the {period.toUpperCase()} price-weighted result of {fmtR(totalRet)}.
        </div>
      </div>
    </div>
  )
}
