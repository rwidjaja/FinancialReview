/**
 * MonthlyReviewModal — month-end CIO-style review.
 *
 * Lazy-fetches /api/monthly-review for the previous calendar month (or a
 * user-selected month), renders the LLM narrative + a grid of MoM deltas
 * and a signal-count summary. Closes on backdrop click or Esc.
 *
 * Self-contained: opens itself, manages its own data, renders nothing
 * when closed.
 */

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

interface DiffPair { prev: number; curr: number; delta: number }

interface MonthlyReviewResponse {
  year:      number
  month:     number
  narrative: string
  source:    string
  cached:    boolean
  digest: {
    month:          string
    start_as_of:    string
    end_as_of:      string
    snapshot_count: number
    deltas:         Record<string, DiffPair>
    signals: {
      counts: { info?: number; warn?: number; crit?: number }
      top_recurring: { key: string; count: number }[]
      sample_headlines: string[]
    }
  } | null
}

const A = 'var(--amber)'
const G = 'var(--green)'
const R = 'var(--red)'
const M = 'var(--text2)'

interface Props {
  open: boolean
  onClose: () => void
  /** Optional override; defaults to previous calendar month. */
  year?:  number
  month?: number
}

async function fetchReview(year?: number, month?: number): Promise<MonthlyReviewResponse> {
  const qs: string[] = []
  if (year)  qs.push(`year=${year}`)
  if (month) qs.push(`month=${month}`)
  const url = `/api/monthly-review${qs.length ? '?' + qs.join('&') : ''}`
  const r = await fetch(url)
  return r.json()
}

function fmtPair(p: DiffPair, fmt: (n: number) => string): React.ReactNode {
  const color = p.delta > 0 ? G : p.delta < 0 ? R : M
  const sign  = p.delta >= 0 ? '+' : ''
  return (
    <>
      <span style={{ color: 'var(--text2)' }}>{fmt(p.prev)}</span>
      <span style={{ margin: '0 4px', color: M }}>→</span>
      <span style={{ color: 'var(--text)', fontWeight: 500 }}>{fmt(p.curr)}</span>
      <span style={{ marginLeft: 6, color, fontSize: 12 }}>({sign}{fmt(p.delta)})</span>
    </>
  )
}

const fmtUSD = (n: number) =>
  Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M`
    : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}k`
    : `$${n.toFixed(0)}`

export function MonthlyReviewModal({ open, onClose, year, month }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['monthly-review', year ?? 'prev', month ?? 'prev'],
    queryFn:  () => fetchReview(year, month),
    enabled:  open,
    staleTime: 5 * 60 * 1000,
  })

  // Esc to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const noData = data?.source === 'no_data' || data?.digest == null
  const digest = data?.digest

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(22,22,22,.64)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--fd-hairline)',
          borderTop: `3px solid ${A}`,
          borderRadius: 0,
          boxShadow: 'none',
          width: 720, maxWidth: '100%', maxHeight: '85vh',
          overflowY: 'auto',
          padding: '20px 24px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{
            fontSize: 14, fontWeight: 500, color: A,
            letterSpacing: '0.8px', fontFamily: 'var(--font-mono)',
          }}>
             MONTHLY REVIEW
          </span>
          {digest && (
            <span style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)' }}>
              {digest.month}
            </span>
          )}
          <button onClick={onClose} aria-label="Close" style={{
            marginLeft: 'auto', padding: '2px 10px',
            background: 'transparent', border: `1px solid var(--border2)`,
            color: M, fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer',
          }}>×</button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div style={{ color: M, fontSize: 12 }}>
            <span className="anim-blink" style={{ color: A, marginRight: 6 }}>●</span>
            Building review…
          </div>
        )}

        {/* No data */}
        {!isLoading && noData && (
          <div style={{
            padding: '12px 14px', background: 'var(--surface)',
            border: '1px solid var(--fd-hairline)', borderRadius: 0,
            fontSize: 12, color: M, lineHeight: 1.6,
          }}>
            No snapshot data available for {data?.year}-{String(data?.month).padStart(2, '0')}.
            Data is collected from the first day you ran the dashboard — earlier months
            won't appear until the app has been running through them.
          </div>
        )}

        {/* Error */}
        {!isLoading && error && (
          <div style={{ color: R, fontSize: 12 }}>
            Failed to load review. {error instanceof Error ? error.message : ''}
          </div>
        )}

        {/* Narrative */}
        {!isLoading && !noData && data?.narrative && (
          <div style={{
            padding: '12px 14px', background: 'var(--surface)',
            border: '1px solid var(--fd-hairline)', borderRadius: 0,
            borderLeft: `3px solid ${A}`,
            fontSize: 12, lineHeight: 1.7, color: 'var(--text)',
          }}>
            {data.narrative}
          </div>
        )}

        {/* Deltas grid */}
        {digest && Object.keys(digest.deltas ?? {}).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{
              fontSize: 12, fontWeight: 500, color: A,
              letterSpacing: '0.6px', fontFamily: 'var(--font-mono)',
            }}>
              Month-over-month deltas
            </span>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
            }}>
              {digest.deltas.portfolio_value && (
                <DiffTile label="VALUE" pair={digest.deltas.portfolio_value} fmt={fmtUSD} />
              )}
              {digest.deltas.vol_budget_used && (
                <DiffTile label="VOL BUDG" pair={digest.deltas.vol_budget_used} fmt={(n) => `${n.toFixed(0)}%`} />
              )}
              {digest.deltas.fragility_score && (
                <DiffTile label="FRAGILITY" pair={digest.deltas.fragility_score} fmt={(n) => n.toFixed(0)} />
              )}
              {digest.deltas.bracket_pressure && (
                <DiffTile label="BRACKET %" pair={digest.deltas.bracket_pressure} fmt={(n) => `${n.toFixed(1)}%`} />
              )}
              {digest.deltas.top_holding_pct && (
                <DiffTile label="TOP-1 %" pair={digest.deltas.top_holding_pct} fmt={(n) => `${n.toFixed(1)}%`} />
              )}
              {digest.deltas.ytd_income && (
                <DiffTile label="YTD INCOME" pair={digest.deltas.ytd_income} fmt={fmtUSD} />
              )}
            </div>
          </div>
        )}

        {/* Signal counts */}
        {digest?.signals && (digest.signals.counts.crit || digest.signals.counts.warn) && (
          <div style={{
            padding: '10px 12px', background: 'var(--surface)',
            border: '1px solid var(--fd-hairline)', borderRadius: 0,
            display: 'flex', alignItems: 'baseline', gap: 12,
            fontSize: 12, fontFamily: 'var(--font-mono)',
          }}>
            <span style={{ color: A, fontWeight: 500 }}>SIGNALS:</span>
            <span style={{ color: R }}>{digest.signals.counts.crit ?? 0} crit</span>
            <span style={{ color: 'var(--amber)' }}>{digest.signals.counts.warn ?? 0} warn</span>
            <span style={{ color: M }}>{digest.signals.counts.info ?? 0} info</span>
            <span style={{ marginLeft: 'auto', color: M, fontSize: 12 }}>
              from {digest.snapshot_count} daily snapshots
            </span>
          </div>
        )}

        {/* Sample headlines */}
        {digest?.signals?.sample_headlines && digest.signals.sample_headlines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{
              fontSize: 12, fontWeight: 500, color: M,
              letterSpacing: '0.6px', fontFamily: 'var(--font-mono)',
            }}>
              RECENT SIGNALS
            </span>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: 'var(--text2)' }}>
              {digest.signals.sample_headlines.slice(0, 5).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Provenance footer */}
        {data && (
          <div style={{
            marginTop: 4, fontSize: 12, color: 'var(--text3)',
            fontFamily: 'var(--font-mono)', textAlign: 'right',
          }}>
            {data.source === 'template' ? 'rules-based · LLM unavailable' :
             data.source.startsWith('llm:') ? `${data.source}${data.cached ? ' · cached' : ''}` :
             ''}
          </div>
        )}
      </div>
    </div>
  )
}

function DiffTile({ label, pair, fmt }: { label: string; pair: DiffPair; fmt: (n: number) => string }) {
  return (
    <div style={{
      padding: '8px 10px', background: 'var(--surface)',
      border: '1px solid var(--fd-hairline)', borderRadius: 0,
    }}>
      <div style={{
        fontSize: 12, fontWeight: 500, color: M,
        letterSpacing: '0.6px', marginBottom: 4,
      }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
        {fmtPair(pair, fmt)}
      </div>
    </div>
  )
}
