/**
 * MetricTooltip — small ⓘ icon that reveals a pre-baked explainer on hover/click.
 *
 * The explainer text is generated server-side by `python -m server.explainers
 * --regen` and stored in cache_kv. At runtime we fetch the whole map once via
 * /api/explainers (small payload, cached by react-query) and look up by id.
 *
 * Usage:
 *   <MetricTooltip metricId="fragility" />
 *   <MetricTooltip metricId="fragility" label="Fragility" />
 */

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

interface ExplainerPayload {
  text:         string
  model?:       string
  generated_at?: number
}

interface ExplainersResponse {
  explainers: Record<string, ExplainerPayload>
}

async function fetchExplainers(): Promise<ExplainersResponse> {
  const r = await fetch('/api/explainers')
  if (!r.ok) throw new Error(`explainers fetch failed: ${r.status}`)
  return r.json()
}

/** Shared cache hook so a page with N tooltips makes one network call. */
export function useExplainers() {
  return useQuery({
    queryKey: ['ai-explainers'],
    queryFn:  fetchExplainers,
    // Pre-baked content — refetching is wasteful. Refresh on full page reload.
    staleTime: 60 * 60 * 1000,           // 1 hour
    gcTime:    24 * 60 * 60 * 1000,      // keep in memory for the session
  })
}

interface Props {
  metricId: string
  /** Optional override for the tooltip header — defaults to the server's label. */
  label?: string
  /** Pixel size of the ⓘ glyph. Defaults to 10 (fits inside StatTile labels). */
  size?: number
}

export function MetricTooltip({ metricId, label, size = 10 }: Props) {
  const { data } = useExplainers()
  const entry = data?.explainers?.[metricId]

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)

  // Close on outside click (handles click-to-open usage on touch devices).
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current || !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Don't render the glyph at all if there's no baked explainer for this id —
  // avoids dead "?" affordances that lead nowhere.
  if (!entry?.text) return null

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        title={`What is ${label ?? metricId}?`}
        aria-label={`Explain ${label ?? metricId}`}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: Math.max(12, size) + 4, height: Math.max(12, size) + 4,
          padding: 0, marginLeft: 4,
          background: 'transparent', border: 'none',
          color: 'var(--fd-muted)', fontFamily: 'var(--font-mono)',
          fontSize: Math.max(12, size), fontWeight: 400, lineHeight: 1,
          cursor: 'help', verticalAlign: 'middle',
        }}
      >
        ⓘ
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: '100%', left: '50%',
            transform: 'translateX(-50%) translateY(4px)',
            zIndex: 1000,
            width: 'max-content', maxWidth: 300,
            padding: '12px 14px',
            background: 'var(--fd-page)',
            border: '1px solid var(--fd-rule)',
            borderRadius: 0,
            boxShadow: 'none',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            lineHeight: 1.45,
            color: 'var(--fd-ink)',
            textTransform: 'none', letterSpacing: 0, fontWeight: 400,
            whiteSpace: 'normal',
            textAlign: 'left',
            cursor: 'default',
          }}
        >
          {label && (
            <div style={{
              fontSize: 12, fontWeight: 400, color: 'var(--fd-muted)',
              letterSpacing: '0.03em', fontFamily: 'var(--font-mono)',
              marginBottom: 6,
            }}>
              {label.toUpperCase()}
            </div>
          )}
          {entry.text}
        </span>
      )}
    </span>
  )
}
