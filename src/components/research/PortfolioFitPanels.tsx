// ── MODULE 3: Portfolio Fit sub-panels ────────────────────────────────────────

import { PanelHeader, DataRow } from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { fmtMoneyFull } from '../../utils/formatters'
import { G, R, M, Y } from './researchTypes'
import type { ResearchApiData } from './researchTypes'
import { corrColor } from './researchHelpers'

export function PortfolioRolePanel({ pf }: { pf?: ResearchApiData['portfolio_fit'] }) {
  if (!pf) return null
  const SLEEVE_COLORS: Record<string, string> = { Growth: 'var(--fd-accent)', Income: 'var(--fd-lime-ink)', Stability: 'var(--fd-accent)', International: 'var(--fd-lilac-ink)', Alternatives: 'var(--fd-ink)' }
  const sleeveColor = pf.sleeve_color ?? SLEEVE_COLORS[pf.sleeve ?? ''] ?? 'var(--fd-muted)'

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
      <PanelHeader>A. PORTFOLIO ROLE</PanelHeader>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pf.sleeve && (
          <div style={{ padding: '8px 10px', background: `${sleeveColor}11`, border: `1px solid ${sleeveColor}`, marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500 }}>SLEEVE</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: sleeveColor }}>{pf.sleeve}</div>
            {pf.sleeve_existing_weight_pct != null && <div style={{ fontSize: 12, color: M, marginTop: 1 }}>{pf.sleeve_existing_weight_pct.toFixed(1)}% of portfolio in {pf.sleeve} sleeve (sleeve total)</div>}
          </div>
        )}
        {pf.weight_pct != null && <DataRow label="CURRENT WEIGHT" value={<span style={{ color: pf.weight_pct > 0 ? G : M, fontFamily: 'var(--font-mono)' }}>{pf.weight_pct > 0 ? `${pf.weight_pct.toFixed(2)}%` : 'Not held'}</span>} />}
        {pf.total_position_value != null && pf.total_position_value > 0 && <DataRow label="POSITION VALUE" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(pf.total_position_value)}</span>} />}
      </div>
    </div>
  )
}

export function CorrelationPanel({ pf }: { pf?: ResearchApiData['portfolio_fit'] }) {
  if (!pf) return null
  const corrLabel = (v?: number | null) => v == null ? '' : Math.abs(v) > 0.8 ? 'High' : Math.abs(v) > 0.5 ? 'Moderate' : 'Low'
  const corrBadge = (v?: number | null): 'green' | 'yellow' | 'red' | 'none' => {
    if (v == null) return 'none'
    const a = Math.abs(v)
    return a > 0.8 ? 'red' : a > 0.6 ? 'yellow' : a < 0.4 ? 'green' : 'none'
  }

  const pairs = [
    ['vs SPY', pf.corr_spy],
    ['vs QQQ', pf.corr_qqq],
    ['vs Portfolio', pf.corr_portfolio],
    [`vs ${pf.corr_sleeve_label ?? 'Sleeve'}`, pf.corr_sleeve],
  ].filter(([, v]) => v != null) as [string, number][]

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
      <PanelHeader>B. CORRELATION & DIVERSIFICATION</PanelHeader>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pairs.length === 0 && <div style={{ fontSize: 12, color: M }}>No correlation data available.</div>}
        {pairs.map(([label, v]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', background: 'var(--bg)', border: `1px solid ${corrColor(v)}` }}>
            <span style={{ fontSize: 12, color: M }}>{label}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: corrColor(v), fontFamily: 'var(--font-mono)' }}>
                {v >= 0 ? '+' : ''}{v.toFixed(2)}
              </span>
              <span style={{ fontSize: 12, padding: '1px 5px', background: `${corrColor(v)}15`, border: `1px solid ${corrColor(v)}`, color: corrColor(v) }}>
                {corrBadge(v).toUpperCase()} · {corrLabel(v)}
              </span>
            </div>
          </div>
        ))}
        {/* Diversification Score */}
        {pairs.length > 0 && (() => {
          const avgAbsCorr = pairs.reduce((s, [, v]) => s + Math.abs(v), 0) / pairs.length
          const divScore = Math.round((1 - avgAbsCorr) * 100)
          const divColor = divScore >= 50 ? G : divScore >= 30 ? Y : R
          return (
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase' }}>Diversification Score</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: divColor, fontFamily: 'var(--font-mono)' }}>{divScore}/100</span>
              </div>
              <MiniBar value={divScore} color={divColor} height={4} />
              <div style={{ fontSize: 12, color: M, marginTop: 3 }}>
                {divScore >= 50 ? 'Low overlap — good diversifier' : divScore >= 30 ? 'Moderate overlap — partial diversifier' : 'High overlap — limited diversification'}
              </div>
            </div>
          )
        })()}
        {pairs.length > 0 && (
          <div style={{ fontSize: 12, color: M, padding: '4px 6px', borderTop: '1px solid var(--border2)' }}>
             Correlations spike toward 1.0 in crashes — diversification shrinks in selloffs.
          </div>
        )}
      </div>
    </div>
  )
}

export function YieldImpactPanel({ pf }: { pf?: ResearchApiData['portfolio_fit'] }) {
  if (!pf) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
      <PanelHeader>C. YIELD & IMPACT</PanelHeader>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pf.symbol_yield_pct != null && <DataRow label="SYMBOL YIELD" value={<span style={{ color: G, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{pf.symbol_yield_pct.toFixed(2)}%</span>} />}
        {pf.portfolio_yield_pct != null && <DataRow label="PORTFOLIO YIELD" value={<span style={{ color: G, fontFamily: 'var(--font-mono)' }}>{pf.portfolio_yield_pct.toFixed(2)}%</span>} />}
        {pf.yield_delta_bps != null && (
          <DataRow label="YIELD IMPACT (+$10K)" value={
            <span style={{ color: pf.yield_delta_bps > 0 ? G : pf.yield_delta_bps < 0 ? R : M, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
              {pf.yield_delta_bps >= 0 ? '+' : ''}{pf.yield_delta_bps.toFixed(1)} bps
            </span>
          } />
        )}
        {pf.corr_sleeve != null && pf.sleeve && (
          <DataRow label={`${pf.sleeve} SLEEVE IMPACT`} value={<span style={{ color: corrColor(pf.corr_sleeve), fontFamily: 'var(--font-mono)' }}>{pf.corr_sleeve >= 0 ? '+' : ''}{pf.corr_sleeve.toFixed(2)} corr</span>} />
        )}
        {/* Yield Tradeoff Meter */}
        {pf.symbol_yield_pct != null && pf.portfolio_yield_pct != null && (() => {
          const symY = pf.symbol_yield_pct!
          const portY = pf.portfolio_yield_pct!
          const delta = symY - portY
          const max = Math.max(symY, portY, 1) * 1.1
          return (
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
              <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 6 }}>YIELD TRADEOFF</div>
              {[
                { label: 'THIS SYMBOL', val: symY, color: delta >= 0 ? G : Y },
                { label: 'PORTFOLIO AVG', val: portY, color: M },
              ].map(row => (
                <div key={row.label} style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                    <span style={{ color: M }}>{row.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: row.color }}>{row.val.toFixed(2)}%</span>
                  </div>
                  <MiniBar value={(row.val / max) * 100} color={row.color} height={5} />
                </div>
              ))}
              <div style={{ fontSize: 12, marginTop: 4, color: delta >= 0 ? G : R, fontWeight: 500 }}>
                {delta >= 0 ? `▲ +${delta.toFixed(2)}% yield boost vs portfolio` : `▼ ${delta.toFixed(2)}% yield drag vs portfolio`}
              </div>
            </div>
          )
        })()}
        {!pf.symbol_yield_pct && !pf.portfolio_yield_pct && !pf.yield_delta_bps && (
          <div style={{ fontSize: 12, color: M }}>No yield data available.</div>
        )}
      </div>
    </div>
  )
}
