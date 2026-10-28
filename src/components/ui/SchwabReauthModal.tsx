/**
 * SchwabReauthModal — shown when the Schwab refresh token has expired while the
 * app is running. "Reconnect" asks the server to open the Schwab login in the
 * browser and capture the OAuth callback; once the new token lands we refresh
 * the dashboard so live positions come back without restarting anything.
 */

import { useEffect, useRef, useState } from 'react'
import { mono } from './primitives'
import type { SchwabAuthStatus } from '../../types/dashboard'

interface Props {
  status: SchwabAuthStatus
  /** Ask the server to start the browser login. */
  onReconnect: () => void
  /** Hide for now — the header keeps a "Reconnect Schwab" button. */
  onLater: () => void
  /** Called once a reconnect started here has succeeded. */
  onConnected: () => void
}

export function SchwabReauthModal({ status, onReconnect, onLater, onConnected }: Props) {
  const [started, setStarted] = useState(false)
  const wasInProgress = useRef(false)

  // Detect in_progress → done. Success clears needs_auth; failure sets error.
  useEffect(() => {
    if (status.in_progress) { wasInProgress.current = true; return }
    if (wasInProgress.current) {
      wasInProgress.current = false
      setStarted(false)
      if (!status.needs_auth && !status.error) onConnected()
    }
  }, [status, onConnected])

  const waiting = started || status.in_progress

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="schwab-reauth-title" style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '8px 1fr', background: 'var(--fd-card)', maxWidth: 520, width: '100%' }}>
        <div style={{ background: 'var(--fd-alert)' }} />
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span id="schwab-reauth-title" style={{ ...mono, color: 'var(--fd-ink)' }}>Schwab session expired</span>
          <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--fd-muted)' }}>
            {waiting
              ? 'A Schwab login page opened in your browser. Sign in there; after the redirect (accept the local certificate warning) this window updates on its own.'
              : 'Schwab needs you to sign in again. Until then the dashboard shows the last cached positions with yfinance prices.'}
          </span>
          {status.error && !waiting && (
            <span style={{ fontSize: 13, color: 'var(--fd-alert)' }}>Last attempt failed: {status.error}</span>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="fd-ghost" onClick={onLater} style={btn(false)}>
              {waiting ? 'Hide' : 'Later'}
            </button>
            <button onClick={() => { setStarted(true); onReconnect() }} disabled={waiting} style={btn(true, waiting)}>
              {waiting ? 'Waiting for login…' : status.error ? 'Try again' : 'Reconnect Schwab'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function btn(primary: boolean, disabled = false): React.CSSProperties {
  return {
    height: 34, padding: '0 16px', ...mono, cursor: disabled ? 'wait' : 'pointer',
    border: '1px solid ' + (primary ? 'var(--fd-ink)' : 'var(--fd-hairline)'),
    background: primary ? 'var(--fd-ink)' : 'transparent',
    color: primary ? 'var(--fd-page)' : 'var(--fd-ink)',
    opacity: disabled ? 0.7 : 1,
  }
}
