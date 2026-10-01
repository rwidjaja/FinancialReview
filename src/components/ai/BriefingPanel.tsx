/**
 * BriefingPanel — Advanced AI mode entry point.
 *
 * Renders three sections from /api/briefing:
 *   1. Narrative (LLM-generated prose; phase 1 falls back to a template when null)
 *   2. Signal chips (clickable; click navigates to the relevant tab)
 *   3. Today's key numbers via StatTile, matching the Returns tab style
 *
 * Units: backend stores portfolio weights as PERCENT (0-100). The headline
 * and StatTile values render those values directly — no extra * 100.
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { MonthlyReviewModal } from '../ui/MonthlyReviewModal'
import { PageHero, KpiStrip, RuledList, KeyValueRow, StatusChip, Button, mono, muted, type Status } from '../ui/primitives'

type Severity = 'info' | 'warn' | 'crit'

interface Signal {
  kind:     string
  symbol:   string | null
  severity: Severity
  headline: string
  details:  Record<string, unknown>
  tab:      string | null
  as_of:    string
}

interface BriefingDiffs {
  day_change_pct:      number
  total_value:         number
  top_holding:         string | null
  /** Percent (0-100), already-scaled by the backend. Do not multiply by 100. */
  top_holding_pct:     number | null
  fragility_score:     number | null
  fragility_level:     string | null
  vol_regime:          string | null
  market_regime:       string | null
}

/** One metric's prev/curr/delta from analytics_history. */
interface DiffPair {
  prev:  number
  curr:  number
  delta: number
}

/** Server-computed "vs yesterday" block. Keys are only present when a prior
 *  snapshot exists AND both values were non-null. `as_of` is always present
 *  when the block is non-empty. */
interface VsYesterday {
  as_of?:            string
  portfolio_value?:  DiffPair
  vol_budget_used?:  DiffPair
  fragility_score?:  DiffPair
  bracket_pressure?: DiffPair
  top_holding_pct?:  DiffPair
}

interface SentimentSnapshot {
  score:         number
  zscore:        number
  spike:         boolean
  neg_pct:       number
  political_pct: number
  n:             number
  sources:       string[]
  top_headlines: string[]
}

interface BriefingResponse {
  /** Server always returns a string (LLM output or deterministic template). */
  narrative:        string
  /** 'llm:<model>' or 'template'. Used to render a small hint when fallback was used. */
  narrative_source: string
  /** True when the LLM response was served from cache_kv (no fresh Ollama call). */
  narrative_cached: boolean
  signals:          Signal[]
  diffs:            BriefingDiffs
  vs_yesterday:     VsYesterday
  sentiment:           SentimentSnapshot | null
  sentiment_narrative: string | null
  news_correlations:   string | null
  as_of:               string | null
}

interface Props {
  onChipClick?: (tab: string, symbol: string | null) => void
}


// Per-kind tooltip text shown on chip hover (supplements the headline).
const SIGNAL_KIND_TOOLTIP: Record<string, string> = {
  headline_sentiment_drift:
    'Headline Sentiment Drift: Political or negative news headlines have spiked ' +
    'above the rolling baseline. Indicates elevated headline-driven volatility risk. ' +
    'Click to view details in the Risk tab.',
}


async function fetchBriefing(): Promise<BriefingResponse> {
  const r = await fetch('/api/briefing')
  if (!r.ok) throw new Error(`briefing fetch failed: ${r.status}`)
  return r.json()
}

/** Render a small hint describing which side produced the narrative. */
function sourceHint(source: string, cached: boolean): string {
  if (!source || source === 'error') return ''
  if (source === 'template')         return 'RULES-BASED · LLM UNAVAILABLE'
  // source is "llm:<model>"
  const model = source.startsWith('llm:') ? source.slice(4) : source
  return cached ? `LLM · ${model} · CACHED` : `LLM · ${model}`
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
}

const SEV_STATUS: Record<Severity, Status> = { info: 'info', warn: 'watch', crit: 'alert' }

/** One-sentence verdict from the signal mix (exactly one italic word). */
function verdict(crit: number, warn: number): { before?: string; em: string; after?: string } {
  if (crit === 0 && warn === 0) return { before: 'A ', em: 'quiet', after: ' day.' }
  if (crit === 1) return { before: 'A quiet day with one ', em: 'loud', after: ' signal.' }
  if (crit > 1) return { before: `${crit} signals need `, em: 'attention', after: '.' }
  return { before: 'Mostly calm, a few things to ', em: 'watch', after: '.' }
}

export function BriefingPanel({ onChipClick, showDetails = true }: Props & { showDetails?: boolean }) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ai-briefing'],
    queryFn:  fetchBriefing,
    staleTime: 30_000,
  })

  if (isLoading) return <PageHero eyebrow="AI · today's briefing" before="Reading the " em="day" after="…" lead={<span style={muted}>Loading the briefing.</span>} />
  if (error || !data) {
    return (
      <PageHero eyebrow="AI · today's briefing" before="Briefing " em="unavailable" after="."
        lead={<span style={muted}>{error instanceof Error ? error.message : 'The briefing service did not respond.'}</span>}>
        <Button size="sm" onClick={() => refetch()} style={{ alignSelf: 'flex-start' }}>Retry</Button>
      </PageHero>
    )
  }

  const hint = sourceHint(data.narrative_source, data.narrative_cached)
  const signals = data.signals ?? []
  const d = data.diffs
  const critCount = signals.filter(x => x.severity === 'crit').length
  const warnCount = signals.filter(x => x.severity === 'warn').length
  const vy = data.vs_yesterday
  const fmtUSD = (n: number) => Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`
  const vyRows = vy ? ([
    ['Portfolio value', vy.portfolio_value, fmtUSD],
    ['Vol budget', vy.vol_budget_used, (n: number) => n.toFixed(0)],
    ['Fragility', vy.fragility_score, (n: number) => n.toFixed(0)],
    ['Bracket pressure', vy.bracket_pressure, (n: number) => `${n.toFixed(1)}%`],
    ['Top holding', vy.top_holding_pct, (n: number) => `${n.toFixed(1)}%`],
  ] as [string, DiffPair | undefined, (n: number) => string][]).filter(([, p]) => p) : []

  return (
    <>
      <MonthlyReviewModal open={reviewOpen} onClose={() => setReviewOpen(false)} />
      <PageHero
        eyebrow={`AI · today's briefing${hint ? ` · ${hint.toLowerCase()}` : ''}${data.as_of ? ` · ${data.as_of}` : ''}`}
        {...verdict(critCount, warnCount)}
        lead={<span>{data.narrative || '—'}</span>}
        aside={vyRows.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Versus yesterday{vy?.as_of ? <span style={{ ...mono, ...muted, marginLeft: 8 }}>{vy.as_of}</span> : null}</h3>
            <RuledList>
              {vyRows.map(([k, p, f]) => (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14, alignItems: 'baseline' }}>
                  <span style={muted}>{k}</span>
                  <span>{f(p!.prev)} → <span style={{ fontWeight: 500 }}>{f(p!.curr)}</span></span>
                  <span style={{ fontSize: 13, color: p!.delta > 0 ? 'var(--fd-accent)' : p!.delta < 0 ? 'var(--fd-negative)' : 'var(--fd-muted)' }}>{p!.delta > 0 ? '+' : p!.delta < 0 ? '−' : ''}{f(Math.abs(p!.delta))}</span>
                </div>
              ))}
            </RuledList>
          </div>
        ) : undefined}
      >
        {signals.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {signals.map((x, i) => {
              const clickable = !!x.tab && !!onChipClick
              return (
                <button key={`${x.kind}-${x.symbol ?? ''}-${i}`} className="fd-ghost" disabled={!clickable}
                  onClick={() => clickable && onChipClick?.(x.tab!, x.symbol)} title={SIGNAL_KIND_TOOLTIP[x.kind] ?? x.headline}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 14px', borderRadius: 999, border: '1px solid var(--fd-hairline)', background: 'transparent', fontSize: 13, cursor: clickable ? 'pointer' : 'default', opacity: 1 }}>
                  <StatusChip status={SEV_STATUS[x.severity]} size={10} />
                  {x.symbol && <span style={{ fontWeight: 500 }}>{x.symbol}</span>}
                  <span>{x.headline}</span>
                  {clickable && <span style={{ ...mono, ...muted }}>{x.symbol ? 'Research' : x.tab} →</span>}
                </button>
              )
            })}
          </div>
        )}
      </PageHero>

      <KpiStrip size={32} items={[
        { label: 'Day change', value: fmtPct(d.day_change_pct), valueColor: d.day_change_pct > 0.05 ? 'var(--fd-accent)' : d.day_change_pct < -0.05 ? 'var(--fd-negative)' : undefined },
        { label: 'Top holding', value: d.top_holding ?? '—', sub: d.top_holding_pct != null ? `${d.top_holding_pct.toFixed(1)}% of portfolio` : undefined },
        { label: 'Fragility', value: d.fragility_score != null ? String(d.fragility_score) : '—', sub: d.fragility_level?.toLowerCase(), status: d.fragility_level === 'EXTREME' ? 'alert' : d.fragility_level === 'HIGH' ? 'warn' : d.fragility_level === 'MODERATE' ? 'watch' : d.fragility_level === 'LOW' ? 'ok' : undefined },
        { label: 'Vol regime', value: d.vol_regime ?? '—' },
        { label: 'Market regime', value: d.market_regime ?? '—' },
        { label: 'Signals', value: String(signals.length), sub: `${critCount} critical · ${warnCount} watch` },
      ]} />

      {showDetails && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 40, paddingTop: 56 }}>
          {data.sentiment && data.sentiment.n >= 5 ? (() => {
            const se = data.sentiment!
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Headline sentiment</h3>
                  <span style={{ fontSize: 24, fontWeight: 500, color: se.score < -0.1 ? 'var(--fd-negative)' : se.score > 0.1 ? 'var(--fd-accent)' : undefined }}>{se.score >= 0 ? '+' : '−'}{Math.abs(se.score).toFixed(2)}</span>
                </div>
                <RuledList>
                  <KeyValueRow k="Z-score" v={se.zscore.toFixed(2)} status={se.zscore < -2.5 ? 'alert' : se.zscore < -1.5 ? 'warn' : undefined} />
                  <KeyValueRow k="Negative share" v={`${se.neg_pct.toFixed(0)}%`} />
                  <KeyValueRow k="Political share" v={`${se.political_pct.toFixed(0)}%`} />
                  <KeyValueRow k="Headlines" v={String(se.n)} sub={se.spike ? 'Spike above the rolling baseline' : undefined} />
                </RuledList>
                {data.sentiment_narrative
                  ? <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>{data.sentiment_narrative}</p>
                  : se.top_headlines.slice(0, 3).map((h, i) => <span key={i} style={{ fontSize: 13, ...muted }}>· {h}</span>)}
              </div>
            )
          })() : <div />}
          {data.news_correlations ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Portfolio × news</h3>
              <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0, borderTop: '2px solid var(--fd-rule)', paddingTop: 12 }}>{data.news_correlations.trim()}</p>
            </div>
          ) : <div />}
          <button onClick={() => setReviewOpen(true)} style={{ background: 'var(--as-lilac)', color: 'var(--as-washed-black)', border: 'none', padding: 32, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', cursor: 'pointer', alignSelf: 'start' }}>
            <span style={mono}>Monthly review</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 40, lineHeight: 0.95 }}>Last month, <em>reviewed</em>.</span>
            <span style={{ fontSize: 14 }}>A CIO-style digest of the month. Open the review →</span>
          </button>
        </section>
      )}
    </>
  )
}
