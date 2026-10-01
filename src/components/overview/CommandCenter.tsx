import { PanelHeader, Divider } from '../ui/Terminal'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import { MiniBar } from '../ui/Sparkline'
import { alertColor } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const Y = 'var(--yellow)'
const M = 'var(--text2)'

interface Props { data: DashboardData }

export function CommandCenter({ data }: Props) {
  const pi = data.portfolio_intel
  const ia = data.income_analytics
  const td = data.tax_data
  if (!pi) return null

  const topRisks = pi.top_risks ?? []
  const topOpps = pi.top_opportunities ?? []
  const actions = data.decision_strip ?? []
  const watchlist = pi.watchlist ?? []

  const fwd12 = ia?.portfolio_fwd_12m ?? 0
  const monthlyInc = fwd12 / 12

  const rb = pi.risk_budget_used
  const rbColor = rb >= 130 ? R : rb >= 100 ? A : rb >= 70 ? Y : G

  // bracket
  const _bktRate = (td?.target_bracket_rate ?? DEFAULT_BRACKET_RATE) / 100
  const b22 = td?.brackets?.find(b => Math.abs(b.rate - _bktRate) < 0.001)
  const _bktLabel = `${td?.target_bracket_rate ?? DEFAULT_BRACKET_RATE}%`
  const agi = td?.annual_div_for_agi ?? 0
  const bktUsed = b22 ? Math.round(agi / b22.max * 100) : null
  const bktRoom = b22 ? Math.max(0, b22.max - agi) : null
  const bktColor = bktUsed == null ? M : bktUsed >= 90 ? R : bktUsed >= 70 ? Y : G

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* ── Top 3-panel strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>

        {/* Risks */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderLeft: `3px solid ${R}` }}>
          <PanelHeader> Top Risks</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            {topRisks.length === 0
              ? <div style={{ color: G, fontSize: 12 }}>✓ NO ELEVATED RISKS</div>
              : topRisks.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: alertColor(r.level), fontWeight: 500, flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ color: 'var(--text)', lineHeight: 1.4 }}>{r.msg}</span>
                </div>
              ))
            }
          </div>
        </div>

        {/* Opportunities */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderLeft: `3px solid ${G}` }}>
          <PanelHeader> Opportunities</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            {topOpps.length === 0
              ? <div style={{ color: M, fontSize: 12 }}>NO HIGH-CONVICTION SETUPS AT CURRENT VALUATIONS</div>
              : topOpps.map((o, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: G, fontWeight: 500, flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ color: 'var(--text)', lineHeight: 1.4 }}>{o.msg}</span>
                </div>
              ))
            }
          </div>
        </div>

        {/* Next actions */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderLeft: `3px solid var(--blue)` }}>
          <PanelHeader> Next Best Actions</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            {actions.length === 0
              ? <div style={{ color: G, fontSize: 12 }}>✓ ALL SYSTEMS NOMINAL</div>
              : actions.slice(0, 4).map((d, i) => {
                const c = alertColor(d.level)
                return (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, fontSize: 12 }}>
                    <span style={{ flexShrink: 0 }}>{d.icon}</span>
                    <div style={{ lineHeight: 1.4 }}>
                      <span style={{ color: c, fontWeight: 500 }}>{d.action}</span>
                      <span style={{ color: M }}> — {d.text}</span>
                    </div>
                  </div>
                )
              })
            }
          </div>
        </div>
      </div>

      {/* ── Metric strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>

        {/* Monthly Income */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
          <div className="bb-label">MONTHLY CASH FLOW</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: G, margin: '3px 0' }}>
            ${Math.round(monthlyInc).toLocaleString()}
          </div>
          <div className="bb-sub">FORWARD 12M AVERAGE</div>
          <Divider />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: M }}>ANNUAL</span>
            <span style={{ color: G, fontWeight: 500 }}>${Math.round(fwd12).toLocaleString()}</span>
          </div>
        </div>

        {/* Income vs Target */}
        {ia?.target_income != null && ia.target_income > 0
          ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
              <div className="bb-label">INCOME VS {_bktLabel} BRACKET LIMIT</div>
              <div style={{ fontSize: 22, fontWeight: 500, color: (ia.income_gap ?? 0) <= 0 ? G : Y, margin: '3px 0' }}>
                {ia.income_gap != null
                  ? `${ia.income_gap <= 0 ? '+' : '−'}$${Math.round(Math.abs(ia.income_gap)).toLocaleString()}`
                  : '—'}
              </div>
              <div className="bb-sub">{(ia.income_gap ?? 0) <= 0 ? '✓ WITHIN BRACKET' : ' EXCEEDS BRACKET'}</div>
              <Divider />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: M }}>F12M</span>
                <span>${Math.round(fwd12).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: M }}>{_bktLabel} CEILING</span>
                <span>${Math.round(ia.target_income).toLocaleString()}</span>
              </div>
            </div>
          )
          : <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }} />
        }

        {/* Risk Budget */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px', borderLeft: `2px solid ${rbColor}` }}>
          <div className="bb-label">RISK BUDGET</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: rbColor, margin: '3px 0' }}>{rb.toFixed(0)}%</div>
          <MiniBar value={Math.min(100, rb)} color={rbColor} width={100} height={4} />
          <div className="bb-sub" style={{ marginTop: 3, color: rbColor }}>{pi.risk_budget_label}</div>
          <Divider />
          <div style={{ fontSize: 12, color: M }}>
            VOL {(pi.risk_budget_vol ?? 0).toFixed(0)}% · FRAG {(pi.risk_budget_frag ?? 0).toFixed(0)}/100
          </div>
        </div>

        {/* Bracket Pressure */}
        {bktUsed != null && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px', borderLeft: `2px solid ${bktColor}` }}>
            <div className="bb-label">{_bktLabel} BRACKET PRESSURE</div>
            <div style={{ fontSize: 22, fontWeight: 500, color: bktColor, margin: '3px 0' }}>{bktUsed}%</div>
            <MiniBar value={bktUsed} color={bktColor} width={100} height={4} />
            <div className="bb-sub" style={{ marginTop: 3 }}>AGI: ${Math.round(agi).toLocaleString()}</div>
            <div style={{ fontSize: 12, color: bktColor, fontWeight: 500, marginTop: 2 }}>
              ROOM: ${Math.round(bktRoom ?? 0).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* ── Watchlist ── */}
      {watchlist.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <PanelHeader> Next 7 Days Watchlist</PanelHeader>
          <div style={{ padding: '8px 10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 4 }}>
            {watchlist.map((w, i) => {
              const c = w.priority === 'high' ? A : M
              return (
                <div key={i} style={{
                  display: 'flex', gap: 6, fontSize: 12,
                  padding: '4px 8px',
                  borderLeft: `3px solid ${c}`,
                  background: 'var(--surface)',
                }}>
                  <span style={{ color: c, flexShrink: 0 }}>{w.priority === 'high' ? '' : '○'}</span>
                  <span style={{ color: 'var(--text)', lineHeight: 1.4 }}>{w.msg}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
