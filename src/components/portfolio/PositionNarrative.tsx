/**
 * PositionNarrative — small "Explain →" text link that lazy-fetches an LLM summary
 * for one holding from /api/position/<sym>/narrate.
 *
 * Renders nothing in the DOM beyond the button until it's clicked, then
 * shows a popover with a 3-sentence narrative. Cached server-side by
 * (symbol + snapshot hash), so re-opening within the same refresh is free.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface NarrateResponse {
  symbol:    string
  narrative: string
  source:    string                       // "llm:<model>" | "template" | "no_position" | "error"
  cached:    boolean
  view:      Record<string, unknown> | null
}

async function fetchNarrate(symbol: string): Promise<NarrateResponse> {
  const r = await fetch(`/api/position/${encodeURIComponent(symbol)}/narrate`)
  // 404 = no_position; we still want to render that gracefully, so don't throw.
  return r.json()
}

interface Props {
  symbol: string
}

const A = 'var(--amber)'
const M = 'var(--text2)'

export function PositionNarrative({ symbol }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)

  // Lazy fetch — only when the popover has been opened at least once.
  // Subsequent opens reuse the react-query cache (no network).
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['position-narrate', symbol],
    queryFn:  () => fetchNarrate(symbol),
    enabled:  open,
    staleTime: 60_000,
  })

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current || !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const hasNarrative = data?.narrative && data.source !== 'no_position'
  const isFallback   = data?.source === 'template'

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <button
        type="button"
        className="fd-link"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        title={`AI summary of ${symbol}`}
        aria-label={`Show AI summary of ${symbol}`}
        aria-expanded={open}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase',
          color: 'var(--fd-accent)', whiteSpace: 'nowrap',
        }}
      >Explain →</button>
      {open && (
        <span
          role="dialog"
          style={{
            position: 'absolute',
            top: '100%', left: 0,
            transform: 'translateY(4px)',
            zIndex: 1000,
            width: 360,
            padding: '10px 12px',
            background: 'var(--bg2)',
            border: '1px solid var(--fd-hairline)',
            borderTop: `2px solid ${A}`,
            boxShadow: 'none',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            lineHeight: 1.55,
            color: 'var(--text)',
            textAlign: 'left',
            whiteSpace: 'normal',
            cursor: 'default',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 6,
            marginBottom: 6,
          }}>
            <span style={{
              fontSize: 12, fontWeight: 500, color: A,
              letterSpacing: '0.6px', fontFamily: 'var(--font-mono)',
            }}>{symbol}</span>
            <span style={{ fontSize: 12, color: M }}>AI summary</span>
            {data?.cached && (
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>cached</span>
            )}
            {isFallback && (
              <span style={{
                marginLeft: data?.cached ? 6 : 'auto',
                fontSize: 12, color: 'var(--text3)',
              }}>rules-based</span>
            )}
          </div>

          {/* Body */}
          {isLoading && (
            <span style={{ color: M, fontSize: 12 }}>
              <span className="anim-blink" style={{ color: A, marginRight: 6 }}>●</span>
              Asking the model…
            </span>
          )}
          {!isLoading && data?.source === 'no_position' && (
            <span style={{ color: M, fontSize: 12 }}>
              No position data for {symbol} in the current snapshot.
            </span>
          )}
          {!isLoading && data?.source === 'error' && (
            <div style={{ color: 'var(--red)', fontSize: 12 }}>
              Failed to fetch summary.
              <button onClick={() => refetch()} style={{
                marginLeft: 8, padding: '2px 8px', background: 'transparent',
                border: `1px solid ${M}`, color: M, fontSize: 12, cursor: 'pointer',
              }}>retry</button>
            </div>
          )}
          {!isLoading && hasNarrative && (
            <div>{data!.narrative}</div>
          )}
        </span>
      )}
    </span>
  )
}
