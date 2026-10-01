// ── PositionBlock + FundDecision ─────────────────────────────────────────────

import { TerminalSection } from '../ui/Terminal'
import { fmtMoneyFull, fmtPct, gainColor } from '../../utils/formatters'
import { G, R, A, M } from './researchTypes'
import type { ResearchApiData } from './researchTypes'
import type { DashboardData } from '../../types/dashboard'

export function PositionBlock({ snap, pf: _pf, advanced, positions }: { snap: any; pf?: ResearchApiData['portfolio_fit']; advanced?: boolean; positions?: import('../../types/dashboard').Position[] }) {
  const totalValue   = positions?.reduce((s, p) => s + (p.value ?? 0), 0) ?? 0
  const totalShares  = positions?.reduce((s, p) => s + (p.shares ?? 0), 0) ?? 0
  const totalCost    = positions?.reduce((s, p) => s + (p.cost ?? 0), 0) ?? 0
  const totalPnl     = positions?.reduce((s, p) => s + (p.pnl ?? 0), 0) ?? 0
  const totalIncome  = positions?.reduce((s, p) => s + (p.annual_income ?? 0), 0) ?? 0
  const pnlPct       = totalCost > 0 ? (totalPnl / totalCost) : null
  const hasPosition  = positions && positions.length > 0 && totalValue > 0

  if (!hasPosition) return null

  const tiles = [
    { label: 'MARKET VALUE',  val: fmtMoneyFull(totalValue),                                                             color: A },
    { label: 'SHARES',        val: totalShares > 0 ? totalShares.toFixed(3) : '—' },
    { label: 'COST BASIS',    val: totalCost > 0 ? fmtMoneyFull(totalCost) : '—' },
    { label: 'GAIN/LOSS $',   val: totalPnl !== 0 ? fmtMoneyFull(totalPnl) : '—',                                        color: gainColor(totalPnl) },
    { label: 'GAIN/LOSS %',   val: pnlPct != null ? fmtPct(pnlPct * 100) : '—',                                          color: pnlPct != null ? gainColor(pnlPct) : M },
    { label: 'ANNUAL INCOME', val: totalIncome > 0 ? fmtMoneyFull(totalIncome) : '—',                                    color: G },
    { label: 'TTM YIELD',     val: snap?.ttm_yield != null ? fmtPct(snap.ttm_yield * 100) : '—',                         color: G },
    ...(advanced && snap?.total_return_1y != null
      ? [{ label: '1Y TOTAL RET', val: fmtPct(snap.total_return_1y * 100), color: gainColor(snap.total_return_1y) }]
      : []),
  ]

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${A}`,
      borderLeft: `3px solid ${A}`,
      borderRadius: 0,
      padding: '10px 14px',
    }}>
      {/* Header */}
      <div style={{
        fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
        letterSpacing: '0.8px', color: A, marginBottom: 10,
      }}>
        ◈ YOUR POSITION
      </div>
      {/* Tile grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6 }}>
        {tiles.map(c => (
          <div key={c.label} style={{
            background: 'var(--bg)',
            border: '1px solid var(--fd-hairline)',
            borderRadius: 0,
            padding: '6px 8px',
          }}>
            <div style={{ fontSize: 12, color: M, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c.label}</div>
            <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: (c as any).color ?? 'var(--text)' }}>{c.val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FundDecision({ data, symbol, r }: { data: DashboardData; symbol: string; r?: import('./researchTypes').ResearchApiData }) {
  const dec = data.decisions.find(d => d.symbol === symbol)
  if (!dec) return null

  const ae = (r?.portfolio_fit as any)?.action_engine_overlay ?? r?.action_engine
  const aeAction = (ae?.action ?? '').toUpperCase()
  const isExitSignal = aeAction.includes('TRIM') || aeAction.includes('SELL') || aeAction.includes('REDUCE') || aeAction.includes('AVOID')

  // Override RELATIVE_RETURN with live research API annualized returns when available.
  // Portfolio snapshot data can be stale (computed at server startup); research API
  // fetches fresh price history on every request.
  const metrics = { ...dec.metrics } as Record<string, { level: string; message: string }>
  let relReturnRefreshed = false
  if (r?.annualized_returns?.symbol && 'RELATIVE_RETURN' in metrics) {
    const symRet = r.annualized_returns.symbol['1Y']
    const spyRet = r.annualized_returns.spy?.['1Y']
    if (symRet != null && spyRet != null) {
      const relPct = symRet - spyRet
      const bm = r.risk_stats?.benchmark ?? 'SPY'
      const level = relPct >= 5 ? 'GREEN' : relPct >= -6 ? 'YELLOW' : 'RED'
      const msg = relPct >= 5
        ? `1Y return outperforms ${bm} by +${relPct.toFixed(1)}%.`
        : relPct >= -6
          ? `1Y return within range of ${bm} (${relPct >= 0 ? '+' : ''}${relPct.toFixed(1)}%).`
          : `1Y return trails ${bm} by ${Math.abs(relPct).toFixed(1)}%.`
      if (metrics['RELATIVE_RETURN'].message !== msg) relReturnRefreshed = true
      metrics['RELATIVE_RETURN'] = { level, message: msg }
    }
  }

  return (
    <TerminalSection id="decision" title="◈ SYSTEM ASSESSMENT" defaultOpen={true} accent={A}>
      <div style={{ padding: '10px 14px' }}>
        {isExitSignal && (
          <div style={{ marginBottom: 10, padding: '6px 10px',
            background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
            borderRadius: 0, fontSize: 12, color: R, lineHeight: 1.5 }}>
             TECHNICAL OVERRIDE — Key Action: <strong>{aeAction}</strong>.
            Fundamental assessment below does not reflect the current technical exit signal.
            Follow Key Action for near-term position management.
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, marginBottom: relReturnRefreshed ? 4 : 10 }}>{dec.summary}</div>
        {relReturnRefreshed && (
          <div style={{ fontSize: 12, color: M, marginBottom: 10, fontStyle: 'italic' }}>
            ↻ Relative return refreshed from live data — metric chip below reflects current performance.
          </div>
        )}
        {Object.keys(metrics).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(metrics).map(([key, m]) => {
              const mc = m.level === 'GREEN' ? G : m.level === 'RED' ? R : 'var(--yellow)'
              return (
                <div key={key} style={{ fontSize: 12, display: 'flex', gap: 4, padding: '3px 8px', background: 'var(--surface)', border: `1px solid ${mc}` }}>
                  <span style={{ color: mc }}>●</span>
                  <span style={{ color: M, textTransform: 'uppercase' }}>{key.replace(/_/g, ' ')}:</span>
                  <span style={{ color: mc }}>{m.message}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </TerminalSection>
  )
}
