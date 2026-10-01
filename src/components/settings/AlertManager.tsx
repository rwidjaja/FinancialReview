import { useState } from 'react'
import { PanelHeader } from './PanelHeader'
import { SaveBar } from './SaveBar'

const G = 'var(--green)'
const R = 'var(--red)'
const Y = 'var(--yellow)'
const M = 'var(--text2)'
const P = 'var(--panel)'

interface AlertItem {
  id: string
  symbol: string
  direction: 'above' | 'below'
  mode: 'price' | 'percent'
  threshold: number
  base_price: number
  created_at: string
  active: boolean
  triggered: boolean
  triggered_at: string | null
  triggered_price: number | null
  notes: string
}

export function AlertManager({ data, onSaved }: {
  data: { alerts: AlertItem[] }
  onSaved: (key: string, content: unknown) => void
}) {
  const [alerts, setAlerts] = useState<AlertItem[]>(() => data.alerts ?? [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const setAlert = (i: number, patch: Partial<AlertItem>) =>
    setAlerts(prev => prev.map((a, j) => j === i ? { ...a, ...patch } : a))

  const removeAlert = (i: number) =>
    setAlerts(prev => prev.filter((_, j) => j !== i))

  const addAlert = () => {
    setAlerts(prev => [...prev, {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      symbol: '',
      direction: 'above',
      mode: 'price',
      threshold: 0,
      base_price: 0,
      created_at: new Date().toISOString(),
      active: true,
      triggered: false,
      triggered_at: null,
      triggered_price: null,
      notes: '',
    }])
  }

  const save = async () => {
    setSaving(true); setError('')
    try {
      const content = { alerts }
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'price_alerts', content }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Save failed')
      setSaved(true); onSaved('price_alerts', content)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  const toggleMode = (i: number) => {
    setAlert(i, { mode: alerts[i].mode === 'price' ? 'percent' : 'price' })
  }

  return (
    <div>
      <PanelHeader>Price Alerts — Manage</PanelHeader>
      <div style={{ fontSize: 12, color: M, marginBottom: 10 }}>
        Create, edit, or remove price alerts. Alerts fire when price crosses the threshold.
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 12 }}>
        <span style={{ color: G }}>● {alerts.filter(a => a.active && !a.triggered).length} active</span>
        <span style={{ color: Y }}>● {alerts.filter(a => a.triggered).length} triggered</span>
        <span style={{ color: M }}>● {alerts.filter(a => !a.active && !a.triggered).length} disabled</span>
      </div>

      <div style={{ border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', maxHeight: 520, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', color: M, fontSize: 12, fontWeight: 500, width: 30 }}>#</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', color: M, fontSize: 12, fontWeight: 500 }}>SYMBOL</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', color: M, fontSize: 12, fontWeight: 500 }}>DIR</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', color: M, fontSize: 12, fontWeight: 500 }}>MODE</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', color: M, fontSize: 12, fontWeight: 500 }}>THRESHOLD</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', color: M, fontSize: 12, fontWeight: 500 }}>BASE $</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', color: M, fontSize: 12, fontWeight: 500 }}>ACTIVE</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', color: M, fontSize: 12, fontWeight: 500 }}>NOTES</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 && (
              <tr><td colSpan={9} style={{ padding: '20px', textAlign: 'center', color: M, fontSize: 12 }}>
                No alerts configured. Click "+ Add Alert" to create one.
              </td></tr>
            )}
            {alerts.map((a, i) => {
              const triggered = a.triggered
              return (
                <tr key={a.id} style={{ 
                  borderTop: '1px solid var(--border2)',
                  opacity: !a.active && !triggered ? 0.6 : 1,
                  background: triggered ? 'var(--fd-card)' : 'transparent',
                }}>
                  <td style={{ padding: '4px 8px', color: M, fontSize: 12 }}>{i + 1}</td>
                  <td style={{ padding: '4px 8px' }}>
                    <input value={a.symbol} onChange={e => setAlert(i, { symbol: e.target.value.toUpperCase() })}
                      placeholder="SYM" maxLength={10}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text)',
                        fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12,
                        width: 60, outline: 'none', textTransform: 'uppercase' }} />
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <select value={a.direction} onChange={e => setAlert(i, { direction: e.target.value as any })}
                      style={{ background: P, border: '1px solid var(--fd-hairline)',
                        color: a.direction === 'above' ? G : R, fontSize: 12, fontWeight: 500,
                        padding: '2px 4px', borderRadius: 0, outline: 'none', cursor: 'pointer' }}>
                      <option value="above">▲ ABOVE</option>
                      <option value="below">▼ BELOW</option>
                    </select>
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <button onClick={() => toggleMode(i)}
                      style={{ background: a.mode === 'price' ? 'var(--fd-card)' : 'var(--fd-card)',
                        border: `1px solid ${a.mode === 'price' ? G : 'var(--fd-accent)'}`,
                        color: a.mode === 'price' ? G : 'var(--fd-accent)', fontSize: 12, fontWeight: 500,
                        padding: '2px 7px', borderRadius: 0, cursor: 'pointer' }}>
                      {a.mode === 'price' ? '$' : '%'}
                    </button>
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                    <input type="number" value={a.threshold} onChange={e => setAlert(i, { threshold: parseFloat(e.target.value) || 0 })}
                      step={a.mode === 'price' ? 0.01 : 0.1}
                      style={{ background: 'transparent', border: 'none', color: a.direction === 'above' ? G : R,
                        fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12,
                        width: 60, textAlign: 'right', outline: 'none' }} />
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                    <input type="number" value={a.base_price} onChange={e => setAlert(i, { base_price: parseFloat(e.target.value) || 0 })}
                      step={0.01}
                      style={{ background: 'transparent', border: 'none', color: M,
                        fontFamily: 'var(--font-mono)', fontSize: 12, width: 55, textAlign: 'right', outline: 'none' }} />
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <button onClick={() => setAlert(i, { active: !a.active })} disabled={triggered}
                      style={{ background: a.active ? `${G}18` : 'var(--fd-card)',
                        border: `1px solid ${a.active ? G : 'var(--fd-hairline)'}`, color: a.active ? G : M,
                        fontSize: 12, fontWeight: 500, padding: '2px 6px', borderRadius: 0,
                        cursor: triggered ? 'not-allowed' : 'pointer', opacity: triggered ? 0.5 : 1 }}>
                      {triggered ? 'TRIGGERED' : a.active ? 'ACTIVE' : 'DISABLED'}
                    </button>
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input value={a.notes} onChange={e => setAlert(i, { notes: e.target.value })}
                      placeholder="note..." maxLength={60}
                      style={{ background: 'transparent', border: 'none', color: M,
                        fontFamily: 'var(--font-mono)', fontSize: 12, width: 100, outline: 'none' }} />
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <button onClick={() => removeAlert(i)} style={{ background: 'none', border: 'none', color: R, cursor: 'pointer', fontSize: 14 }}>×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        <button onClick={addAlert} style={{ padding: '4px 14px', fontSize: 12, fontWeight: 500,
          background: 'var(--border2)', color: 'var(--text)', border: 'none', borderRadius: 0, cursor: 'pointer' }}>
          + Add Alert
        </button>
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </div>
  )
}