import { STRUCTURAL_ICON, STRUCTURAL_LABEL } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import type { HealthDecision } from '../research/researchTypes'
import { G, R, A, M } from './DetailTab.constants'

export function FundAnalysis({ data, pi, symbol, healthDecision }: {
  data: DashboardData
  pi: DashboardData['portfolio_intel']
  symbol?: string
  /** Live on-demand evaluation from the research API — used when symbol is not in portfolio */
  healthDecision?: HealthDecision
}) {
  const decisions = symbol ? data.decisions.filter(d => d.symbol === symbol) : data.decisions

  // If no portfolio decision but we have a live health evaluation, render that instead
  if (decisions.length === 0 && healthDecision && !healthDecision.error) {
    const sc = healthDecision.structural_status
    const statusColors: Record<string, string> = {
      ENGINE_HEALTHY: G, VALUATION_STRETCHED: 'var(--yellow)',
      INCOME_COMPRESSION: A, STRUCTURAL_BREAKDOWN: R,
    }
    const color = statusColors[sc] ?? M
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
        <div style={{ border: `1px solid var(--border2)`, borderLeft: `3px solid ${color}`, background: 'var(--surface)', borderRadius: 0, overflow: 'hidden' }}>
          <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border2)' }}>
            <span style={{ fontSize: 14 }}>{STRUCTURAL_ICON[sc] ?? ''}</span>
            <span style={{ fontWeight: 500, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{healthDecision.symbol}</span>
            {healthDecision.fund_type && <span style={{ fontSize: 12, color: M, textTransform: 'uppercase' }}>{healthDecision.fund_type}</span>}
            <span style={{ fontSize: 12, fontWeight: 500, color }}>{STRUCTURAL_LABEL[sc]}</span>
            <span style={{ fontSize: 12, color: M, marginLeft: 'auto' }}>live evaluation</span>
          </div>
          <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
            {healthDecision.summary}
          </div>
          {Object.keys(healthDecision.metrics ?? {}).length > 0 && (
            <div style={{ padding: '6px 10px', display: 'flex', flexWrap: 'wrap', gap: 8, borderTop: '1px solid var(--border2)' }}>
              {Object.entries(healthDecision.metrics).map(([key, m]) => {
                const mc = m.level === 'GREEN' ? G : m.level === 'RED' ? R : 'var(--yellow)'
                return (
                  <div key={key} style={{ fontSize: 12, display: 'flex', gap: 4 }}>
                    <span style={{ color: mc }}>●</span>
                    <span style={{ color: M, textTransform: 'uppercase' }}>{key.replace(/_/g, ' ')}:</span>
                    <span style={{ color: mc }}>{m.message}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (decisions.length === 0) {
    return (
      <div style={{
        padding: '12px 14px', fontSize: 12, color: 'var(--text3)',
        background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
        borderRadius: 0, lineHeight: 1.6,
      }}>
        {symbol
          ? <><strong style={{ color: 'var(--text2)' }}>{symbol}</strong> is not in your portfolio — fund health analysis is only available for holdings tracked in your portfolio config.</>
          : 'Fund health analysis not available — no portfolio decisions loaded.'}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      {decisions.map(dec => {
        const cfg = data.fund_configs[dec.symbol] ?? {}
        const fv = (pi?.fund_valuation ?? {})[dec.symbol] ?? '—'
        const statusColors: Record<string, string> = {
          ENGINE_HEALTHY: G, VALUATION_STRETCHED: 'var(--yellow)',
          INCOME_COMPRESSION: A, STRUCTURAL_BREAKDOWN: R,
        }
        const sc = statusColors[dec.structural_status] ?? M
        return (
          <div key={dec.symbol} style={{ border: `1px solid var(--border2)`, borderLeft: `3px solid ${sc}`, background: 'var(--surface)', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border2)' }}>
              <span style={{ fontSize: 14 }}>{STRUCTURAL_ICON[dec.structural_status] ?? ''}</span>
              <span style={{ fontWeight: 500, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{dec.symbol}</span>
              <span style={{ fontSize: 12, color: M, textTransform: 'uppercase' }}>{cfg.FUND_TYPE}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: sc }}>{STRUCTURAL_LABEL[dec.structural_status]}</span>
              <span style={{ fontSize: 12, color: A, marginLeft: 'auto' }}>{fv}</span>
            </div>
            <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
              {dec.summary}
            </div>
            {Object.keys(dec.metrics ?? {}).length > 0 && (
              <div style={{ padding: '6px 10px', display: 'flex', flexWrap: 'wrap', gap: 8, borderTop: '1px solid var(--border2)' }}>
                {Object.entries(dec.metrics).map(([key, m]) => {
                  const mc = m.level === 'GREEN' ? G : m.level === 'RED' ? R : 'var(--yellow)'
                  return (
                    <div key={key} style={{ fontSize: 12, display: 'flex', gap: 4 }}>
                      <span style={{ color: mc }}>●</span>
                      <span style={{ color: M, textTransform: 'uppercase' }}>{key.replace(/_/g, ' ')}:</span>
                      <span style={{ color: mc }}>{m.message}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
