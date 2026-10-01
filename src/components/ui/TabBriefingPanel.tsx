/**
 * TabBriefingPanel — rules-based metric chips for any tab.
 *
 * Critical findings show plain-English labels on the pill.
 * Each pill has a "Detail" button that opens an overlay with a full explanation.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, RuledList, Label, Button, mono } from './primitives'

interface Metric {
  label:    string
  value:    string
  valence?: 'positive' | 'negative' | 'warn' | 'neutral'
  sub?:     string
}

interface Alert {
  kind:     string
  severity: string  // 'crit' | 'warn'
  message?: string
}

interface BriefingResponse {
  metrics?:  Metric[]
  alerts?:   Alert[]
  narrative: string
  source:    string
  cached:    boolean
}

interface Props {
  endpoint: string
  title:    string
  staleMs?: number
  /** Cap metrics/findings shown inline (hero asides); the rest open in the detail dialog list. */
  compact?: boolean
}

// Number colour only: gains accent, losses Vermillion, everything else ink.
function valenceColor(v?: string): string {
  if (v === 'positive') return 'var(--fd-accent)'
  if (v === 'negative') return 'var(--fd-negative)'
  return 'var(--fd-ink)'
}

// Short plain-English label shown on each pill
const KIND_PLAIN: Record<string, string> = {
  concentration_top1:       'One position is over half your portfolio',
  concentration_top3:       'Your top 3 holdings control 70%+ of the portfolio',
  concentration_top5:       'Your top 5 holdings control 85%+ of the portfolio',
  vol_budget_breach:        'Volatility is far above your risk target',
  outsized_mover:           'Several positions had unusually large swings today',
  outlized_mover:           'Several positions had unusually large swings today',
  drawdown_breach:          'Recent decline exceeds your allowed drawdown',
  high_drawdown:            'Recent decline exceeds your allowed drawdown',
  income_coverage_low:      'Portfolio income does not cover your spending target',
  withdrawal_rate_high:     'You are withdrawing more than the 4% safe-rate guideline',
  seq_risk_elevated:        'You are exposed to sequence-of-returns risk',
  stcg_threshold:           'Short-term gains are near your annual limit',
  sector_concentration:     'One sector dominates your exposure',
  headline_sentiment_drift: 'Market sentiment has shifted against your recent trend',
}

// Full detail for the popup — what / why / implication
interface Detail { what: string; why: string; implication: string }
const KIND_DETAIL: Record<string, Detail> = {
  concentration_top1: {
    what:        'Your single largest position is worth more than 50% of your entire portfolio. If that one holding dropped sharply, your portfolio would feel nearly all of it.',
    why:         'The system flags this when any single holding exceeds 50% of total portfolio value. The threshold exists because a position that large gives you almost no protection from a stock-specific event.',
    implication: 'This is a structural condition, not a one-day event. Reducing it would lower risk but may trigger significant capital gains taxes. The Concentration Clock section shows the exact tax cost to rebalance.',
  },
  concentration_top3: {
    what:        'Your three largest holdings together make up more than 70% of your portfolio. In practice, your overall returns are almost entirely driven by just three tickers.',
    why:         'Triggered when the top 3 positions combined exceed 70% of total portfolio value.',
    implication: 'Any bad news in one of those three positions will hit your whole portfolio hard. Diversification reduces volatility, but the tax cost of trimming concentrated positions is real.',
  },
  concentration_top5: {
    what:        'Your five largest holdings together account for more than 85% of your portfolio. The remaining holdings have almost no influence on performance.',
    why:         'Triggered when the top 5 positions combined exceed 85% of total portfolio value.',
    implication: 'Extremely high fragility to any concentrated position. The tail risk is that one position unravels and you have nowhere to hide.',
  },
  vol_budget_breach: {
    what:        'Your portfolio\'s daily price swings are running far above the volatility level your plan targets. The "Vol budget used" metric shows how far over budget you are — 200%+ means you are taking more than twice the planned risk.',
    why:         'Triggered when realized portfolio volatility exceeds the target set in your risk settings. High-beta holdings like semiconductor ETFs inflate this significantly.',
    implication: 'Higher volatility means bigger drawdowns are possible in bad markets. This is directly linked to the concentration issue — reducing the oversized position would also bring volatility closer to target.',
  },
  outsized_mover: {
    what:        'Six or more of your positions moved by more than the system\'s normal daily volatility threshold today. This is common when markets are moving sharply and you hold high-beta ETFs.',
    why:         'Triggered when multiple holdings individually exceed the single-day price movement threshold. Not necessarily a problem — it is informational.',
    implication: 'This alert fires frequently in volatile markets. It is a signal to check whether any individual position moved for a stock-specific reason rather than just following the market.',
  },
  outlized_mover: {
    what:        'One or more positions moved by an unusually large amount today compared to their normal range.',
    why:         'Triggered when a position\'s daily price change exceeds the system\'s volatility threshold.',
    implication: 'Check whether the move was market-wide or specific to that holding. A stock-specific move on heavy volume can signal something has changed fundamentally.',
  },
  drawdown_breach: {
    what:        'Your portfolio\'s decline from its recent peak is larger than the system\'s allowed drawdown band. In plain terms: you are down more than your plan expected you to be.',
    why:         'Triggered when the peak-to-trough decline exceeds your configured drawdown threshold. A high-beta, concentrated portfolio will breach this more often than a diversified one.',
    implication: 'This is a risk warning, not a failure. It means your portfolio is behaving as a concentrated, high-volatility portfolio would — because it is one. The fix is structural (reduce concentration), not reactive (do not sell in a panic).',
  },
  high_drawdown: {
    what:        'Your portfolio has declined more from its peak than the allowed threshold in your risk settings.',
    why:         'Triggered when drawdown exceeds the configured limit.',
    implication: 'Review whether this is a broad market move or concentrated-position-specific. If SMH is driving the drawdown, the portfolio\'s structural concentration is the root cause.',
  },
  income_coverage_low: {
    what:        'The forward income your portfolio is expected to generate over the next 12 months is less than your annual spending target. You would need to sell assets to cover the gap.',
    why:         'Triggered when projected annual income divided by annual spending falls below 100%.',
    implication: 'A coverage ratio below 100% means you are drawing down principal, not just income. In early retirement this increases sequence-of-returns risk significantly.',
  },
  withdrawal_rate_high: {
    what:        'The rate at which you are withdrawing from your portfolio exceeds 4% of its total value per year. Research suggests 4% is the long-run sustainable rate for a 30-year retirement.',
    why:         'Triggered when annual withdrawals exceed 4% of total portfolio value.',
    implication: 'Above 4%, there is meaningful probability your portfolio runs out before your plan horizon. The risk increases in down markets where the portfolio value drops but spending stays constant.',
  },
  seq_risk_elevated: {
    what:        'You are withdrawing from the portfolio during a period of negative or flat returns. When you sell depressed assets to cover spending, those assets cannot recover when the market bounces back.',
    why:         'Triggered when withdrawals are occurring alongside drawdown or high volatility — the combination is the risk, not either one alone.',
    implication: 'Sequence risk is the #1 retirement risk in the first 5-10 years. If spending can be reduced temporarily, or if cash can cover expenses without selling, that dramatically improves long-run outcomes.',
  },
  stcg_threshold: {
    what:        'Your realized short-term capital gains are approaching the threshold where the tax bite becomes material for this year.',
    why:         'Triggered when year-to-date short-term gains are within range of the configured limit.',
    implication: 'Short-term gains are taxed as ordinary income — significantly higher than the long-term rate. Any further realizations should be evaluated carefully before executing.',
  },
  sector_concentration: {
    what:        'One single sector makes up an outsized share of your exposure. If news hits that sector, it affects a disproportionate amount of your portfolio.',
    why:         'Triggered when a single GICS sector exceeds the concentration threshold in your settings.',
    implication: 'Sector concentration is often an unintended side effect of holding a few large positions. Check whether the concentration is intentional or a drift that happened over time.',
  },
  headline_sentiment_drift: {
    what:        'The overall news and analyst sentiment for your holdings has shifted noticeably compared to the recent baseline.',
    why:         'Triggered when the sentiment score for the portfolio\'s key holdings moves outside its normal range.',
    implication: 'Sentiment shifts can precede price moves. This is a soft signal — worth reading the recent headlines for your top holdings, but not actionable on its own.',
  },
}

function normalizeKind(kind: string): string {
  return kind.replace(/\s+/g, '_').toLowerCase()
}

function kindPlainLabel(a: Alert): string {
  if (a.message) return a.message
  const nk = normalizeKind(a.kind)
  return KIND_PLAIN[nk] ?? a.kind.replace(/_/g, ' ')
}

function kindDetail(a: Alert): Detail | null {
  const nk = normalizeKind(a.kind)
  return KIND_DETAIL[nk] ?? null
}

// Legacy technical label (kept for reference in popup)
const KIND_LABELS: Record<string, string> = {
  concentration_top1:       'Top holding >50% of portfolio',
  concentration_top3:       'Top 3 holdings >70% of portfolio',
  concentration_top5:       'Top 5 holdings >85% of portfolio',
  vol_budget_breach:        'Volatility exceeds risk budget',
  outsized_mover:           'Outsized daily mover(s)',
  outlized_mover:           'Outsized daily mover(s)',
  drawdown_breach:          'Drawdown exceeds threshold',
  high_drawdown:            'Drawdown exceeds threshold',
  income_coverage_low:      'Income coverage below 100%',
  withdrawal_rate_high:     'Withdrawal rate above 4% guideline',
  seq_risk_elevated:        'Sequence-of-returns risk elevated',
  stcg_threshold:           'Short-term gains near annual limit',
  sector_concentration:     'Single sector dominates exposure',
  headline_sentiment_drift: 'Sentiment drift vs recent trend',
}

function kindTechnicalLabel(a: Alert): string {
  const nk = normalizeKind(a.kind)
  return KIND_LABELS[nk] ?? a.kind.replace(/_/g, ' ')
}

async function fetchBriefing(endpoint: string): Promise<BriefingResponse> {
  const r = await fetch(endpoint)
  if (!r.ok) throw new Error(`${endpoint} → ${r.status}`)
  return r.json()
}

// ── Detail dialog ─────────────────────────────────────────────────────────────

interface ModalProps {
  label:    string
  techLabel: string
  count:    number
  severity: string
  detail:   Detail | null
  metrics:  Metric[]
  onClose:  () => void
}

function DetailModal({ label, techLabel, count, severity, detail, metrics, onClose }: ModalProps) {
  return (
    <Dialog onClose={onClose} width={620} label={label}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ ...mono, color: 'var(--fd-accent)' }}>
          {severity === 'crit' ? 'Critical finding' : 'Warning'}{count > 1 ? ` · ×${count} occurrences` : ''} · {techLabel}
        </span>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 40, lineHeight: 0.95, letterSpacing: '-0.01em', margin: 0 }}>{label}.</h2>
      </div>
      {detail ? (
        <RuledList>
          {[['What it means', detail.what], ['Why it triggered', detail.why], ['What this means for you', detail.implication]].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
              <Label>{k}</Label>
              <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0 }}>{v}</p>
            </div>
          ))}
        </RuledList>
      ) : (
        <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0, color: 'var(--fd-muted)' }}>No additional detail is available for this finding.</p>
      )}
      {metrics.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Label>Current readings</Label>
          <MetricGrid metrics={metrics} />
        </div>
      )}
    </Dialog>
  )
}

function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', columnGap: 24, borderTop: '2px solid var(--fd-rule)' }}>
      {metrics.map((m, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 0', borderBottom: '1px solid var(--fd-hairline)', minWidth: 0 }}>
          <Label>{m.label}</Label>
          <span style={{ fontSize: 18, fontWeight: 500, color: valenceColor(m.valence) }}>{m.value}</span>
          {m.sub != null && <span style={{ fontSize: 13, color: 'var(--fd-muted)' }}>{m.sub}</span>}
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
// Flat by design: the host decides the ground (a snow card in the hero aside).

export function TabBriefingPanel({ endpoint, title, staleMs = 60_000, compact = true }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tab-briefing', endpoint],
    queryFn:  () => fetchBriefing(endpoint),
    staleTime: staleMs,
  })

  const [activeAlert, setActiveAlert] = useState<{
    alert: Alert; label: string; techLabel: string; count: number
  } | null>(null)

  if (isLoading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Label>{title}</Label><span style={{ ...mono, color: 'var(--fd-muted)' }}>Loading…</span></div>
  }

  if (error || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Label>{title}</Label>
        <span style={{ fontSize: 14 }}>{title} is unavailable.</span>
        <Button size="sm" onClick={() => refetch()} style={{ alignSelf: 'flex-start' }}>Retry</Button>
      </div>
    )
  }

  const metrics = data.metrics ?? []
  const rawAlerts = (data.alerts ?? []).filter(a => a.severity === 'crit' || a.severity === 'warn')

  // Deduplicate by normalized kind + severity, count duplicates
  const dedupMap = new Map<string, { alert: Alert; count: number; label: string; techLabel: string }>()
  for (const a of rawAlerts) {
    const key = `${a.severity}:${normalizeKind(a.kind)}`
    const existing = dedupMap.get(key)
    if (existing) existing.count++
    else dedupMap.set(key, { alert: a, count: 1, label: kindPlainLabel(a), techLabel: kindTechnicalLabel(a) })
  }
  const deduped = Array.from(dedupMap.values()).sort((a, b) => {
    if (a.alert.severity !== b.alert.severity) return a.alert.severity === 'crit' ? -1 : 1
    return b.count - a.count
  })

  const critItems = deduped.filter(d => d.alert.severity === 'crit')
  const warnItems = deduped.filter(d => d.alert.severity === 'warn')
  const FINDINGS_MAX = compact ? 4 : 99
  const findings = [...critItems, ...warnItems]
  const shownFindings = findings.slice(0, FINDINGS_MAX)
  const hiddenFindings = findings.length - shownFindings.length
  const shownMetrics = compact ? metrics.slice(0, 4) : metrics

  return (
    <>
      {activeAlert && (
        <DetailModal
          label={activeAlert.label}
          techLabel={activeAlert.techLabel}
          count={activeAlert.count}
          severity={activeAlert.alert.severity}
          detail={kindDetail(activeAlert.alert)}
          metrics={metrics}
          onClose={() => setActiveAlert(null)}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <Label>{title}</Label>
          {(critItems.length > 0 || warnItems.length > 0) && (
            <span style={mono}>
              {critItems.length > 0 && `${critItems.length} critical`}
              {critItems.length > 0 && warnItems.length > 0 && ' · '}
              {warnItems.length > 0 && `${warnItems.length} watch`}
            </span>
          )}
        </div>

        {shownMetrics.length > 0 && <MetricGrid metrics={shownMetrics} />}

        {shownFindings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {shownFindings.map(({ alert, label, techLabel, count }, i) => (
              <button key={i} className="fd-row" onClick={() => setActiveAlert({ alert, label, techLabel, count })} style={{
                display: 'grid', gridTemplateColumns: '8px 1fr auto', gap: 14, padding: '10px 0', textAlign: 'left',
                background: 'transparent', border: 'none', borderBottom: '1px solid var(--fd-hairline)', cursor: 'pointer',
              }}>
                <span style={{ background: alert.severity === 'crit' ? 'var(--fd-alert)' : 'var(--fd-watch)' }} />
                <span style={{ fontSize: 14, lineHeight: 1.35 }}>{label}{count > 1 && <span style={{ color: 'var(--fd-muted)' }}> ×{count}</span>}</span>
                <span style={{ ...mono, color: 'var(--fd-muted)', alignSelf: 'center' }}>Detail →</span>
              </button>
            ))}
            {hiddenFindings > 0 && <span style={{ fontSize: 13, color: 'var(--fd-muted)', paddingTop: 8 }}>+{hiddenFindings} more findings{compact && metrics.length > shownMetrics.length ? ` · all ${metrics.length} readings inside each Detail` : ''}</span>}
          </div>
        )}

        {metrics.length === 0 && deduped.length === 0 && data.narrative && (
          <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0 }}>{data.narrative}</p>
        )}
      </div>
    </>
  )
}
