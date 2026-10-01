/**
 * RetirementActionPanel — Overview advanced section (v4).
 * Renders computeRetirementDecision(): lime primary-action plane + sub-scores,
 * overrides, cross-tab drivers (link to their tab), if–then triggers, 30-day
 * outlook / next window / why-not, risk overrides, State C compliance,
 * tax-locked concentration, LTCG glidepath, forced-sale risk.
 * (The scorecard lives in the Overview rail.)
 */
import type { RetirementDecision, StateCCompliance } from '../../utils/retirementEngine'
import { COMPLIANCE_GREEN, COMPLIANCE_AMBER } from '../../utils/retirementEngine'
import type { DashboardData } from '../../types/dashboard'
import { tabLabel, type TabId } from '../layout/AppHeader'
import { fmtMoneyFull } from '../../utils/formatters'
import { Section, Capsule, StatusChip, StatusTag, Label, mono, muted, fmtShortDate, type Status } from '../ui/primitives'

const card = { background: 'var(--fd-card)', padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 10 }
const kv = (k: string, v: string) => (
  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
    <span style={muted}>{k}</span><span style={{ fontWeight: 500 }}>{v}</span>
  </div>
)

/** Serif headline with the last word italicised (one <em> rule). */
function ActionHeadline({ text }: { text: string }) {
  const t = text.trim().replace(/[.]$/, '')
  const i = t.lastIndexOf(' ')
  return (
    <span style={{ fontFamily: 'var(--font-display)', fontSize: 48, lineHeight: 0.95, letterSpacing: '-0.01em' }}>
      {i > 0 ? <>{t.slice(0, i + 1)}<em>{t.slice(i + 1)}</em>.</> : <em>{t}.</em>}
    </span>
  )
}

const NOT_BLOCKED: Record<string, string> = {
  stcg_freeze: 'bucket, fragility and rebalance plan unaffected',
  niit_cap: 'NIIT is a cost (3.8% surcharge), not a ceiling',
  bucket_deficit: 'spending and lifestyle income unaffected',
}

export function RetirementActionPanel({ decision, onNavigate }: {
  decision: RetirementDecision
  data: DashboardData
  onNavigate?: (tab: TabId) => void
}) {
  const activeOverrides = decision.override_flags.filter(o => o.active)
  const triggers = [...decision.if_then_triggers].sort((a, b) => Number(b.triggered) - Number(a.triggered))
  const activeCount = triggers.filter(t => t.triggered).length
  const o = decision.thirty_day_outlook
  const nw = decision.next_conversion_window
  const tlc = decision.tax_locked_concentration
  const g = decision.ltcg_glidepath
  const f = decision.forced_sale_risk
  const subScores = [
    ['Income reliability', decision.sub_scores.income_reliability],
    ['Tax flexibility', decision.sub_scores.tax_flexibility],
    ['Execution risk', decision.sub_scores.execution_risk],
    ['Readiness', decision.sub_scores.retirement_readiness],
  ] as const

  return (
    <Section title="Retirement action engine" meta="Deterministic · reads every tab" gap={24}>
      {/* Primary action — lime plane */}
      <div style={{ background: 'var(--as-lime)', color: 'var(--as-washed-black)', padding: 40, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={mono}>Primary action · {decision.primary_action.replace(/_/g, ' ').toLowerCase()} · State {decision.withdrawal_state}</span>
          <ActionHeadline text={decision.action_label} />
          {decision.action_amount != null && <span style={{ fontSize: 24, fontWeight: 500 }}>{fmtMoneyFull(decision.action_amount)}</span>}
          <span style={{ fontSize: 15, lineHeight: 1.4 }}>{decision.action_detail}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center' }}>
          {subScores.map(([label, v]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', ...mono }}><span>{label}</span><span>{v}</span></div>
              <div style={{ height: 8, background: 'rgba(22,22,22,.16)' }}><div style={{ height: 8, width: `${Math.min(100, v)}%`, background: 'var(--as-washed-black)' }} /></div>
            </div>
          ))}
        </div>
      </div>

      {activeOverrides.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 24 }}>
          {activeOverrides.map(ov => (
            <div key={ov.id} style={{ ...card, borderLeft: '8px solid var(--as-lilac)' }}>
              <span style={mono}>Override · {ov.label}</span>
              <span style={{ fontSize: 14, lineHeight: 1.4 }}>{ov.reason}</span>
              <span style={{ fontSize: 13, ...muted }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>✗</span> Blocks {ov.suppresses.map(x => x.replace(/_/g, ' ').toLowerCase()).join(', ')}
                {NOT_BLOCKED[ov.id] && <> · <span style={{ fontFamily: 'var(--font-mono)' }}>✓</span> {NOT_BLOCKED[ov.id]}</>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Cross-tab drivers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 1, background: 'var(--fd-hairline)', border: '1px solid var(--fd-hairline)' }}>
        {decision.cross_tab_drivers.map((d, i) => (
          <button key={i} className="fd-row" title={`field: ${d.field}`} onClick={() => onNavigate?.(d.tab as TabId)} style={{
            background: 'var(--fd-page)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            border: 'none', textAlign: 'left', cursor: onNavigate ? 'pointer' : 'default',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <Label>{tabLabel(d.tab)} · {d.label}</Label>
              <span style={{ fontSize: 18, fontWeight: 500 }}>{d.value}</span>
            </div>
            <StatusChip status={d.severity as Status} />
          </button>
        ))}
      </div>

      {/* If–then triggers */}
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--fd-rule)' }}>
        <span style={{ ...mono, padding: '12px 0' }}>If–then triggers · {activeCount} active</span>
        {triggers.map(t => (
          <div key={t.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 96px', gap: 16, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--fd-hairline)', fontSize: 14, color: t.triggered ? 'var(--fd-ink)' : 'var(--fd-muted)' }}>
            <span>If {t.condition}</span>
            <span style={muted}>→ {t.consequence}</span>
            <span style={{ justifySelf: 'end' }}>
              {t.triggered ? <StatusTag status={t.severity}>Active</StatusTag> : <span style={{ ...mono, ...muted, padding: '0 10px' }}>Inactive</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Outlook · next window · why not */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 24 }}>
        <div style={card}>
          <Label>30-day outlook</Label>
          {kv('Monthly dividends', fmtMoneyFull(o.expected_monthly_dividends))}
          {kv('AGI increase', `+${fmtMoneyFull(o.expected_agi_delta)}`)}
          {kv('Bucket change', o.expected_bucket_change > 0 ? `+${fmtMoneyFull(o.expected_bucket_change)}` : 'No change')}
          {kv('Window', o.conversion_window_status)}
          <span style={{ fontSize: 13, ...muted }}>{o.conversion_window_note}</span>
        </div>
        <div style={card}>
          <Label>Next conversion window</Label>
          <span style={{ fontSize: 28, fontWeight: 500 }}>{nw.estimated_month ?? 'TBD'}</span>
          {kv('Bracket room', nw.projected_room != null ? fmtMoneyFull(nw.projected_room) : '—')}
          {kv('Safe room', nw.projected_safe_room != null ? fmtMoneyFull(nw.projected_safe_room) : '—')}
          {nw.blocked_by.length > 0 && <span style={{ fontSize: 13, ...muted }}>Blocked by {nw.blocked_by.join(', ')}</span>}
        </div>
        <div style={card}>
          <Label>Why not converting</Label>
          {decision.why_not_convert && decision.why_not_convert.reasons.length > 0
            ? decision.why_not_convert.reasons.map((r, i) => <span key={i} style={{ fontSize: 14, lineHeight: 1.35 }}>→ {r}</span>)
            : <span style={{ fontSize: 14 }}>Nothing is blocking a conversion.</span>}
        </div>
      </div>

      {(decision.risk_override_summary.active_count > 0 || decision.state_c_compliance) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 24 }}>
          {decision.risk_override_summary.active_count > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--fd-rule)' }}>
              <span style={{ ...mono, padding: '12px 0' }}>Risk overrides · {decision.risk_override_summary.active_count} active</span>
              {decision.risk_override_summary.lines.map((line, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '8px 1fr', gap: 12, padding: '12px 0', borderTop: '1px solid var(--fd-hairline)', fontSize: 14 }}>
                  <div style={{ background: 'var(--fd-alert)' }} /><span>{line}</span>
                </div>
              ))}
            </div>
          )}
          {decision.state_c_compliance && (() => {
            const c = decision.state_c_compliance as StateCCompliance
            const st: Status = c.score >= COMPLIANCE_GREEN ? 'ok' : c.score >= COMPLIANCE_AMBER ? 'warn' : 'alert'
            return (
              <div style={{ display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--fd-rule)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
                  <span style={mono}>State C rule compliance</span><StatusTag status={st}>{c.score}%</StatusTag>
                </div>
                {c.checks.map((chk, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 8, padding: '12px 0', borderTop: '1px solid var(--fd-hairline)', fontSize: 14 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: chk.pass ? 'var(--fd-ink)' : 'var(--fd-negative)' }}>{chk.pass ? '✓' : '✗'}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontWeight: chk.pass ? 400 : 500 }}>{chk.label}</span>
                      <span style={{ fontSize: 13, ...muted }}>{chk.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 24 }}>
        {tlc && (
          <div style={card}>
            <Label>Tax-locked concentration · {tlc.symbol}</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                ['Current', `${tlc.current_pct.toFixed(1)}%`],
                ['Target', tlc.target_pct != null ? `${tlc.target_pct.toFixed(1)}%` : '—'],
                ['Excess', tlc.excess_pct != null ? `+${tlc.excess_pct.toFixed(1)}%` : '—'],
                ['Tax today', fmtMoneyFull(tlc.tax_cost_today)],
                ['After LTCG', fmtMoneyFull(tlc.tax_cost_after_ltcg)],
                ['Matures', fmtShortDate(tlc.next_ltcg_date)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, ...muted }}>{k}</span><span style={{ fontSize: 16, fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
            <Capsule right={tlc.value_per_day != null ? `${fmtMoneyFull(Math.round(tlc.value_per_day))}/day` : undefined}>
              Wait — value of waiting {fmtMoneyFull(tlc.tax_savings_waiting)}{tlc.days_to_first_ltcg != null && tlc.days_to_first_ltcg > 0 ? ` · ${tlc.days_to_first_ltcg} days` : ''}
            </Capsule>
          </div>
        )}
        {g && g.by_month.length > 0 && (() => {
          const maxGain = Math.max(...g.by_month.map(m => m.gain), 1)
          return (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Label>LTCG glidepath</Label>
                <span style={{ fontSize: 13, ...muted }}>{g.events_count} lots · {fmtMoneyFull(g.total_stcg_exposure)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.by_month.length}, 1fr)`, gap: 8, alignItems: 'end', height: 88, borderBottom: '1px solid var(--fd-hairline)' }}>
                {g.by_month.map((m, i) => <div key={i} title={`${m.month}: ${fmtMoneyFull(m.gain)}`} style={{ height: Math.max(4, (m.gain / maxGain) * 84), background: 'var(--fd-accent)' }} />)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.by_month.length}, 1fr)`, gap: 8, ...mono, ...muted, textAlign: 'center' }}>
                {g.by_month.map((m, i) => <span key={i} style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>{m.month.split(' ')[0]}</span>)}
              </div>
            </div>
          )
        })()}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--fd-rule)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
          <span style={mono}>Forced-sale risk</span>
          <StatusTag status={f.risk_level === 'VERY LOW' || f.risk_level === 'LOW' ? 'ok' : f.risk_level === 'MODERATE' ? 'warn' : 'alert'}>{f.risk_level.toLowerCase()}</StatusTag>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 24, padding: '12px 0', borderTop: '1px solid var(--fd-hairline)' }}>
          {kv('Cash need, 12 months', f.cash_need_12m > 0 ? fmtMoneyFull(f.cash_need_12m) : '$0')}
          {kv('Required portfolio sale', f.required_portfolio_sale > 0 ? fmtMoneyFull(f.required_portfolio_sale) : '$0')}
        </div>
        <span style={{ fontSize: 13, ...muted }}>{f.note}</span>
      </div>
    </Section>
  )
}
