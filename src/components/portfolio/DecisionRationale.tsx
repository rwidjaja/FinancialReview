/**
 * DecisionRationale — click the fund's status icon to get a 2-3 sentence
 * LLM rationale for why the fund landed at that structural status.
 *
 * Reuses the same lazy-fetch + popover pattern as PositionNarrative,
 * keyed on /api/decision/<sym>/narrate.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface NarrateResponse {
  symbol:    string
  narrative: string
  source:    string
  cached:    boolean
  view:      Record<string, unknown> | null
  status:    string | null              // GREEN | YELLOW | RED
}

async function fetchDecision(symbol: string): Promise<NarrateResponse> {
  const r = await fetch(`/api/decision/${encodeURIComponent(symbol)}/narrate`)
  return r.json()
}

interface Props {
  symbol: string
  /** The plain-text status icon (e.g. ✓  ✗) — rendered as the click target. */
  icon:   string
  /** Optional color override for the icon. */
  color?: string
}

const A = 'var(--amber)'
const M = 'var(--text2)'

export function DecisionRationale({ symbol, icon, color }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['decision-narrate', symbol],
    queryFn:  () => fetchDecision(symbol),
    enabled:  open,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current || !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (!icon) return null

  const hasNarrative = data?.narrative && data.source !== 'no_decision'
  const statusColor  =
    data?.status === 'RED'    ? 'var(--red)'   :
    data?.status === 'YELLOW' ? 'var(--amber)' :
    data?.status === 'GREEN'  ? 'var(--green)' :
    (color ?? 'var(--text)')

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        title={`Why is ${symbol} flagged ${data?.status ?? ''}?`}
        aria-label={`Decision rationale for ${symbol}`}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          color: color ?? 'var(--text)',
          fontSize: 12, lineHeight: 1, cursor: 'pointer',
          textDecoration: open ? 'underline' : 'none',
          textDecorationStyle: 'dotted',
        }}
      >{icon}</button>
      {open && (
        <span
          role="dialog"
          style={{
            position: 'absolute', top: '100%', left: 0,
            transform: 'translateY(4px)', zIndex: 1000,
            width: 340, padding: '10px 12px',
            background: 'var(--bg2)',
            border: '1px solid var(--fd-hairline)',
            borderTop: `2px solid ${statusColor}`,
            boxShadow: 'none',
            fontFamily: 'var(--font-sans)',
            fontSize: 12, lineHeight: 1.55, color: 'var(--text)',
            textAlign: 'left', whiteSpace: 'normal', cursor: 'default',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
            <span style={{
              fontSize: 12, fontWeight: 500, color: statusColor,
              letterSpacing: '0.6px', fontFamily: 'var(--font-mono)',
            }}>{symbol}</span>
            <span style={{ fontSize: 12, color: M }}>Why this status</span>
            {data?.cached && (
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>cached</span>
            )}
            {data?.source === 'template' && (
              <span style={{
                marginLeft: data?.cached ? 6 : 'auto',
                fontSize: 12, color: 'var(--text3)',
              }}>rules-based</span>
            )}
          </div>

          {isLoading && (
            <span style={{ color: M, fontSize: 12 }}>
              <span className="anim-blink" style={{ color: A, marginRight: 6 }}>●</span>
              Building rationale…
            </span>
          )}
          {!isLoading && data?.source === 'no_decision' && (
            <span style={{ color: M, fontSize: 12 }}>
              No structural decision recorded for {symbol}.
            </span>
          )}
          {!isLoading && data?.source === 'error' && (
            <div style={{ color: 'var(--red)', fontSize: 12 }}>
              Failed to fetch rationale.
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
