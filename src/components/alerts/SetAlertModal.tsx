/**
 * SetAlertModal — triggered from the Research tab symbol header.
 * Lets the user set a price or % alert for a symbol above/below a threshold.
 */

import { useState } from 'react'
import { useCreateAlert } from '../../hooks/useAlerts'

interface Props {
  symbol: string
  currentPrice: number | null | undefined
  onClose: () => void
}

const A = 'var(--amber)'
const M = 'var(--text2)'
const G = 'var(--green)'
const R = 'var(--red)'
const BORDER = 'var(--border2)'

export function SetAlertModal({ symbol, currentPrice, onClose }: Props) {
  const [direction, setDirection] = useState<'above' | 'below'>('above')
  const [mode, setMode]           = useState<'price' | 'pct'>('price')
  const [threshold, setThreshold] = useState('')
  const [notes, setNotes]         = useState('')
  const [error, setError]         = useState('')

  const create = useCreateAlert()

  const price = currentPrice ?? 0

  // Compute what the threshold would mean in the opposite unit (for reference)
  const thresholdNum = parseFloat(threshold) || 0
  let hint = ''
  if (price > 0 && thresholdNum > 0) {
    if (mode === 'price') {
      const pct = ((thresholdNum - price) / price) * 100
      hint = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% from current`
    } else {
      const targetPrice = price * (1 + thresholdNum / 100)
      hint = `≈ $${targetPrice.toFixed(2)} target price`
    }
  }

  const handleSubmit = async () => {
    const t = parseFloat(threshold)
    if (isNaN(t) || t === 0) { setError('Enter a valid threshold'); return }
    if (!symbol) { setError('No symbol'); return }
    setError('')
    try {
      await create.mutateAsync({
        symbol,
        direction,
        mode,
        threshold: t,
        base_price: price,
        notes,
      })
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create alert')
    }
  }

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      {/* Panel — stop propagation so clicks inside don't close */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', border: `1px solid ${BORDER}`,
          borderTop: `2px solid ${A}`,
          padding: '20px 24px', minWidth: 320, maxWidth: 400,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: M, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 3 }}>
               SET PRICE ALERT
            </div>
            <div style={{ fontSize: 16, fontWeight: 500, color: A }}>{symbol}</div>
          </div>
          {price > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Current</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>${price.toFixed(2)}</div>
            </div>
          )}
        </div>

        {/* Direction toggle */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: M, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 5 }}>Alert when price is</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['above', 'below'] as const).map(d => (
              <button key={d} onClick={() => setDirection(d)} style={{
                flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                padding: '6px 0', border: `1px solid ${direction === d ? (d === 'above' ? G : R) : BORDER}`,
                background: direction === d ? (d === 'above' ? 'var(--fd-card)' : 'var(--fd-card)') : 'transparent',
                color: direction === d ? (d === 'above' ? G : R) : M,
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1px',
              }}>
                {d === 'above' ? '▲ ABOVE' : '▼ BELOW'}
              </button>
            ))}
          </div>
        </div>

        {/* Mode toggle + threshold input */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: M, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 5 }}>Threshold</div>
          <div style={{ display: 'flex', gap: 0 }}>
            {/* $ / % toggle */}
            <div style={{ display: 'flex', border: `1px solid ${BORDER}`, borderRight: 'none' }}>
              {(['price', 'pct'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)} style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                  padding: '6px 12px', border: 'none', cursor: 'pointer',
                  background: mode === m ? A : 'transparent',
                  color: mode === m ? 'var(--fd-page)' : M,
                }}>
                  {m === 'price' ? '$' : '%'}
                </button>
              ))}
            </div>
            {/* Threshold input */}
            <input
              type="number"
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              placeholder={mode === 'price' ? 'e.g. 155.00' : 'e.g. 5  (for +5%)'}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={{
                flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                padding: '6px 10px', background: 'var(--bg)',
                border: `1px solid ${BORDER}`, color: 'var(--text)',
                outline: 'none', minWidth: 0,
              }}
            />
          </div>
          {hint && (
            <div style={{ fontSize: 12, color: M, marginTop: 4 }}>{hint}</div>
          )}
          {mode === 'pct' && (
            <div style={{ fontSize: 12, color: M, marginTop: 3 }}>
              % change from current ${price.toFixed(2)}.
              {direction === 'below' ? ' Use negative for drops (e.g. −5 for −5%).' : ''}
            </div>
          )}
        </div>

        {/* Notes (optional) */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: M, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 5 }}>Notes (optional)</div>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Buy signal, earnings play…"
            style={{
              width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12,
              padding: '5px 8px', background: 'var(--bg)',
              border: `1px solid ${BORDER}`, color: 'var(--text)',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 12, color: R, marginBottom: 10, fontWeight: 500 }}> {error}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSubmit}
            disabled={create.isPending}
            style={{
              flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
              padding: '8px 0', background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none',
              cursor: create.isPending ? 'wait' : 'pointer', letterSpacing: '0.8px',
            }}
          >
            {create.isPending ? 'SAVING…' : ' CREATE ALERT'}
          </button>
          <button
            onClick={onClose}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
              padding: '8px 14px', background: 'transparent', color: M,
              border: `1px solid ${BORDER}`, cursor: 'pointer',
            }}
          >CANCEL</button>
        </div>
      </div>
    </div>
  )
}
