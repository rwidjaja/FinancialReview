/**
 * WhatIfNarrative — LLM-narrated summary of a sandbox/what-if result.
 *
 * Auto-fires when a sandbox result arrives. POSTs the full sandbox payload
 * to /api/whatif/narrate, which builds the prose (cached server-side by
 * content hash so re-running the same scenario doesn't re-call the LLM).
 *
 * Stays silent until a result is available. Renders nothing on error.
 */

import { useEffect, useState } from 'react'

interface NarrateResponse {
  narrative: string
  source:    string                   // "llm:<model>" | "template" | "error"
  cached:    boolean
}

interface Props {
  /** The full sandbox response payload — must include `delta`. Pass undefined while loading. */
  result: Record<string, unknown> | null | undefined
}

const A = 'var(--amber)'
const M = 'var(--text2)'

export function WhatIfNarrative({ result }: Props) {
  const [data, setData] = useState<NarrateResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    // Only narrate when we have a proper sandbox shape (delta present).
    if (!result || typeof result !== 'object' || !('delta' in result)) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    fetch('/api/whatif/narrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(result),
    })
      .then((r) => r.json())
      .then((j: NarrateResponse) => { if (!cancelled) setData(j) })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [result])

  if (!result || (!loading && !data && !err)) return null

  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--surface)',
      border: '1px solid var(--fd-hairline)',
      borderTop: `2px solid ${A}`,
      borderRadius: 0, boxShadow: 'none',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontSize: 12, fontWeight: 500, color: A,
          letterSpacing: '0.6px', fontFamily: 'var(--font-mono)',
        }}>
           AI Scenario Summary
        </span>
        {data && data.source.startsWith('llm:') && (
          <span style={{
            marginLeft: 'auto', fontSize: 12, color: M,
            padding: '1px 6px', border: '1px solid var(--fd-hairline)',
            fontFamily: 'var(--font-mono)', letterSpacing: '0.5px',
          }}>
            LLM · {data.source.slice(4)}{data.cached ? ' · CACHED' : ''}
          </span>
        )}
        {data && data.source === 'template' && (
          <span style={{
            marginLeft: 'auto', fontSize: 12, color: M,
            padding: '1px 6px', border: '1px solid var(--fd-hairline)',
            fontFamily: 'var(--font-mono)', letterSpacing: '0.5px',
          }}>RULES-BASED · LLM UNAVAILABLE</span>
        )}
      </div>
      {loading && (
        <div style={{ fontSize: 12, color: M }}>
          <span className="anim-blink" style={{ color: A, marginRight: 6 }}>●</span>
          Summarising the scenario…
        </div>
      )}
      {err && (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>
          Failed to summarise: {err}
        </div>
      )}
      {data?.narrative && (
        <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text)' }}>
          {data.narrative}
        </div>
      )}
    </div>
  )
}
