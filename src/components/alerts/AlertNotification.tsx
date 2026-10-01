/**
 * AlertNotification — floating popup shown when one or more price alerts trigger.
 * Rendered globally from App.tsx so it appears on any tab.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDismissAlert } from '../../hooks/useAlerts'
import type { PriceAlert } from '../../types/dashboard'

interface Props {
  alerts: PriceAlert[]
  /** Called after all alerts dismissed so parent can clear state */
  onAllDismissed: () => void
  /** Mute this alert for the session — hides popup without deactivating on backend */
  onMute: (id: string) => void
}

const A = 'var(--amber)'
const M = 'var(--text2)'
const G = 'var(--green)'
const R = 'var(--red)'

function fmtThreshold(alert: PriceAlert): string {
  if (alert.mode === 'price') return `$${alert.threshold.toFixed(2)}`
  const sign = alert.threshold >= 0 ? '+' : ''
  return `${sign}${alert.threshold.toFixed(1)}%`
}

function fmtPrice(p: number | null | undefined): string {
  return p != null ? `$${p.toFixed(2)}` : '—'
}

interface AlertNarrate {
  alert_id:  string
  narrative: string
  source:    string                 // "llm:<model>" | "template" | "error"
  cached:    boolean
}

async function fetchAlertNarrate(id: string): Promise<AlertNarrate> {
  const r = await fetch(`/api/alert/${encodeURIComponent(id)}/narrate`)
  return r.json()
}

/** One-sentence AI portfolio context for a triggered alert. Lazy-fetched. */
function AlertContextLine({ alertId }: { alertId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['alert-narrate', alertId],
    queryFn:  () => fetchAlertNarrate(alertId),
    staleTime: 5 * 60 * 1000,
  })
  if (isLoading) {
    return (
      <div style={{ fontSize: 12, color: M, marginBottom: 8 }}>
        <span className="anim-blink" style={{ color: A, marginRight: 6 }}>●</span>
        AI context loading…
      </div>
    )
  }
  if (!data?.narrative || data.source === 'error') return null
  return (
    <div style={{
      marginBottom: 8, padding: '6px 8px',
      background: 'var(--fd-card)',
      borderLeft: `2px solid ${A}`,
      fontSize: 12, lineHeight: 1.5, color: 'var(--text)',
    }}>
      <span style={{
        fontSize: 12, fontWeight: 500, color: A, letterSpacing: '0.6px',
        fontFamily: 'var(--font-mono)', marginRight: 6,
      }}> AI</span>
      {data.narrative}
    </div>
  )
}

export function AlertNotification({ alerts, onAllDismissed, onMute }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const dismiss = useDismissAlert()

  const visible = alerts.filter(a => !dismissed.has(a.id))
  if (visible.length === 0) return null

  const handleDismiss = async (id: string) => {
    await dismiss.mutateAsync(id)
    const next = new Set(dismissed).add(id)
    setDismissed(next)
    if (next.size >= alerts.length) onAllDismissed()
  }

  const handleDismissAll = async () => {
    for (const a of visible) {
      try { await dismiss.mutateAsync(a.id) } catch {}
    }
    onAllDismissed()
  }

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9998,
      display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360,
    }}>
      {visible.map(alert => {
        const dirColor = alert.direction === 'above' ? G : R
        const dirLabel = alert.direction === 'above' ? '▲ ABOVE' : '▼ BELOW'
        return (
          <div key={alert.id} style={{
            background: 'var(--bg2)',
            border: `1px solid ${dirColor}`,
            borderLeft: `4px solid ${dirColor}`,
            padding: '12px 14px',
            fontFamily: 'var(--font-mono)',
            boxShadow: `none`,
            animation: 'fadeInUp 0.2s ease',
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 12, color: dirColor, fontWeight: 500, letterSpacing: '1px', marginBottom: 2 }}>
                   PRICE ALERT TRIGGERED
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, color: A }}>{alert.symbol}</div>
              </div>
              <button onClick={() => handleDismiss(alert.id)} style={{
                background: 'transparent', border: 'none', color: M,
                cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
              }}>×</button>
            </div>

            {/* Alert details */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Condition</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: dirColor }}>
                  {dirLabel} {fmtThreshold(alert)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Triggered at</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
                  {fmtPrice(alert.triggered_price)}
                </div>
              </div>
              {alert.mode === 'pct' && alert.base_price > 0 && alert.triggered_price != null && (
                <div>
                  <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Change</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: dirColor }}>
                    {(((alert.triggered_price - alert.base_price) / alert.base_price) * 100).toFixed(1)}%
                  </div>
                </div>
              )}
            </div>

            {alert.notes && (
              <div style={{ fontSize: 12, color: M, marginBottom: 8, borderTop: '1px solid var(--border2)', paddingTop: 6 }}>
                {alert.notes}
              </div>
            )}

            {/* LLM-generated portfolio context (one sentence). Lazy-fetched the
                first time this popup mounts; cached server-side by alert id +
                snapshot, so a re-trigger of the same alert is free. */}
            <AlertContextLine alertId={alert.id} />

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.set('research', alert.symbol)
                  window.open(url.toString(), '_blank', 'noopener')
                }}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                  padding: '4px 10px', background: 'transparent',
                  border: `1px solid ${A}`, color: A, cursor: 'pointer',
                }}
              >VIEW RESEARCH ↗</button>
              <button
                onClick={() => onMute(alert.id)}
                title="Hide this alert for the session — it will reappear on next page load"
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                  padding: '4px 10px', background: 'transparent',
                  border: '1px solid var(--fd-hairline)', color: 'var(--amber)', cursor: 'pointer',
                }}
              >MUTE </button>
              <button
                onClick={() => handleDismiss(alert.id)}
                title="Permanently deactivate this alert"
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                  padding: '4px 10px', background: 'transparent',
                  border: `1px solid var(--border2)`, color: M, cursor: 'pointer',
                }}
              >DISMISS</button>
            </div>
          </div>
        )
      })}

      {/* Dismiss all — only show when 2+ alerts */}
      {visible.length > 1 && (
        <button onClick={handleDismissAll} style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
          padding: '6px 12px', background: 'var(--bg2)',
          border: '1px solid var(--fd-hairline)', color: M, cursor: 'pointer',
          alignSelf: 'flex-end',
        }}>DISMISS ALL ({visible.length})</button>
      )}
    </div>
  )
}
