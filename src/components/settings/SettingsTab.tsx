/**
 * Settings Tab — manage JSON config files from the UI.
 * Replaces the standalone json_manager.py Tkinter app.
 */

import { useState, useEffect, useCallback } from 'react'
import { SchwabCostEditor } from './SchwabCostEditor'
import { AlertManager } from './AlertManager'
import { PersonalEditor } from './PersonalEditor'
import { TaxBracketsEditor } from './TaxBracketsEditor'
import { WsSection } from '../workspace/WorkspaceContext'
import { useWorkspace, useWsSubTabs } from '../workspace/context'
import { PageHero } from '../ui/primitives'

// ── palette ──────────────────────────────────────────────────────────────────
const G  = 'var(--green)'
const R  = 'var(--red)'
const M  = 'var(--text2)'
const BG = 'var(--bg)'
const P  = 'var(--panel)'

// ── types ─────────────────────────────────────────────────────────────────────
type Section =
  | 'target_roth' | 'target_taxable' | 'ai_keys'
  | 'schwab_cost' | 'price_alerts'
  | 'personal_json' | 'account_mapping'
  | 'tax_brackets_json'

interface SettingsData {
  target_roth?: Record<string, number>
  target_taxable?: Record<string, number>
  ai_keys?: Record<string, string>
  schwab_cost?: Record<string, unknown>
  personal_json?: Record<string, unknown>
  tax_brackets_json?: Record<string, unknown>
  account_mapping?: Record<string, string>

  price_alerts?: { alerts: AlertItem[] }
}

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

// ── helpers ───────────────────────────────────────────────────────────────────
function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase',
      letterSpacing: '0.8px', marginBottom: 12, borderBottom: '1px solid var(--border2)',
      paddingBottom: 6 }}>
      {children}
    </div>
  )
}

function SaveBar({ onSave, saving, saved, error }: {
  onSave: () => void; saving: boolean; saved: boolean; error?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
      <button
        onClick={onSave}
        disabled={saving}
        style={{
          padding: '6px 18px', fontSize: 12, fontWeight: 500,
          background: saving ? 'var(--border2)' : G, color: saving ? 'var(--fd-ink)' : 'var(--fd-page)',
          border: 'none', borderRadius: 0, cursor: saving ? 'not-allowed' : 'pointer',
          letterSpacing: '0.5px', textTransform: 'uppercase',
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && !error && <span style={{ fontSize: 12, color: G }}>✓ Saved</span>}
      {error && <span style={{ fontSize: 12, color: R }}>✗ {error}</span>}
    </div>
  )
}

// ── Allocation editor ─────────────────────────────────────────────────────────
function AllocationEditor({ fileKey, data, onSaved }: {
  fileKey: 'target_roth' | 'target_taxable'
  data: Record<string, number>
  onSaved: (key: Section, content: unknown) => void
}) {
  const [rows, setRows] = useState<[string, string][]>(() =>
    Object.entries(data)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => [k.toUpperCase(), (v * 100).toFixed(2)])
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  const [newSym, setNewSym] = useState('')

  const total = rows.reduce((s, [, v]) => s + (parseFloat(v) || 0), 0)
  const totalOk = Math.abs(total - 100) < 0.01

  const setRow = (i: number, field: 0 | 1, val: string) =>
    setRows(prev => prev.map((r, j) => j === i ? (field === 0 ? [val.toUpperCase(), r[1]] : [r[0], val]) : r))

  const removeRow = (i: number) => setRows(prev => prev.filter((_, j) => j !== i))

  const addRow = () => {
    const s = newSym.trim().toUpperCase()
    if (!s) return
    setRows(prev => [...prev, [s, '0.00']])
    setNewSym('')
  }

  const save = async () => {
    if (!totalOk) { setError('Weights must sum to 100%'); return }
    setSaving(true); setError('')
    try {
      const content: Record<string, unknown> = {
        _comment: fileKey === 'target_roth'
          ? 'Roth IRA target allocation. Weights sum to 1.0.'
          : 'Taxable account target allocation. Weights sum to 1.0.',
      }
      rows.forEach(([k, v]) => { content[k] = parseFloat((parseFloat(v) / 100).toFixed(6)) })
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fileKey, content }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Save failed')
      setSaved(true)
      onSaved(fileKey, content)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <WsSection id={`st_${fileKey}`} value={`${total.toFixed(1)}%`} status={totalOk ? 'ok' : 'alert'}>
      <PanelHeader>
        {fileKey === 'target_roth' ? 'Roth IRA Target Allocation' : 'Taxable Account Target Allocation'}
      </PanelHeader>
      <div style={{ fontSize: 12, color: totalOk ? G : R, fontFamily: 'var(--font-mono)',
        fontWeight: 500, marginBottom: 10 }}>
        Total: {total.toFixed(2)}% {totalOk ? '✓' : '← must equal 100%'}
      </div>
      <div style={{ border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', maxHeight: 420, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg)', position: 'sticky', top: 0 }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: M, fontSize: 12, fontWeight: 500 }}>SYMBOL</th>
              <th style={{ padding: '6px 10px', textAlign: 'right', color: M, fontSize: 12, fontWeight: 500 }}>WEIGHT %</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(([sym, pct], i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border2)' }}>
                <td style={{ padding: '4px 10px' }}>
                  <input value={sym} onChange={e => setRow(i, 0, e.target.value)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text)',
                      fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12,
                      width: 80, outline: 'none' }} />
                </td>
                <td style={{ padding: '4px 10px', textAlign: 'right' }}>
                  <input value={pct} onChange={e => setRow(i, 1, e.target.value)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text)',
                      fontFamily: 'var(--font-mono)', fontSize: 12,
                      width: 60, textAlign: 'right', outline: 'none' }} />
                  <span style={{ color: M, fontSize: 12 }}>%</span>
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                  <button onClick={() => removeRow(i)} style={{
                    background: 'none', border: 'none', color: R, cursor: 'pointer',
                    fontSize: 12, lineHeight: 1,
                  }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        <input value={newSym} onChange={e => setNewSym(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && addRow()}
          placeholder="SYMBOL"
          style={{ padding: '4px 8px', background: P, border: '1px solid var(--fd-hairline)',
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
            width: 80, borderRadius: 0, outline: 'none' }} />
        <button onClick={addRow} style={{
          padding: '4px 12px', fontSize: 12, fontWeight: 500, background: 'var(--border2)',
          color: 'var(--text)', border: 'none', borderRadius: 0, cursor: 'pointer',
        }}>+ Add</button>
      </div>
      </WsSection>
      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </div>
  )
}

// ── AI Keys editor ────────────────────────────────────────────────────────────
function AIKeysEditor({ data, onSaved }: {
  data: Record<string, string>
  onSaved: (key: Section, content: unknown) => void
}) {
  const [rows, setRows] = useState<[string, string][]>(() =>
    Object.entries(data).filter(([k]) => !k.startsWith('_'))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [newUser, setNewUser] = useState('')
  const [newKey, setNewKey]  = useState('')

  const setRow = (i: number, field: 0 | 1, val: string) =>
    setRows(prev => prev.map((r, j) => j === i ? (field === 0 ? [val, r[1]] : [r[0], val]) : r))

  const toggleReveal = (i: number) =>
    setRevealed(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s })

  const addRow = () => {
    if (!newUser.trim()) return
    setRows(prev => [...prev, [newUser.trim(), newKey.trim()]])
    setNewUser(''); setNewKey('')
  }

  const save = async () => {
    setSaving(true); setError('')
    try {
      const content: Record<string, string> = { _comment: 'Ollama.com API keys.' }
      rows.forEach(([k, v]) => { content[k] = v })
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'ai_keys', content }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Save failed')
      setSaved(true); onSaved('ai_keys', content)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  return (
    <div>
      <WsSection id="st_ai_keys">
      <PanelHeader>Ollama API Keys</PanelHeader>
      <div style={{ border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: BG, position: 'sticky', top: 0 }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: M, fontSize: 12 }}>USERNAME</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: M, fontSize: 12 }}>API KEY</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(([user, key], i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border2)' }}>
                <td style={{ padding: '4px 10px' }}>
                  <input value={user} onChange={e => setRow(i, 0, e.target.value)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text)',
                      fontFamily: 'var(--font-mono)', fontSize: 12, width: 160, outline: 'none' }} />
                </td>
                <td style={{ padding: '4px 10px' }}>
                  <input value={revealed.has(i) ? key : '••••••••••••••••••••'}
                    onChange={e => revealed.has(i) && setRow(i, 1, e.target.value)}
                    readOnly={!revealed.has(i)}
                    style={{ background: 'transparent', border: 'none', color: revealed.has(i) ? 'var(--text)' : M,
                      fontFamily: 'var(--font-mono)', fontSize: 12, width: 260, outline: 'none' }} />
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', display: 'flex', gap: 4 }}>
                  <button onClick={() => toggleReveal(i)} title="Toggle visibility"
                    style={{ background: 'none', border: 'none', color: M, cursor: 'pointer', fontSize: 12 }}>
                    {revealed.has(i) ? '' : ''}
                  </button>
                  <button onClick={() => setRows(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: R, cursor: 'pointer', fontSize: 12 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={newUser} onChange={e => setNewUser(e.target.value)}
          placeholder="username"
          style={{ padding: '4px 8px', background: P, border: '1px solid var(--fd-hairline)',
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
            width: 140, borderRadius: 0, outline: 'none' }} />
        <input value={newKey} onChange={e => setNewKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addRow()}
          placeholder="api key"
          style={{ padding: '4px 8px', background: P, border: '1px solid var(--fd-hairline)',
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
            width: 240, borderRadius: 0, outline: 'none' }} />
        <button onClick={addRow} style={{ padding: '4px 12px', fontSize: 12, fontWeight: 500,
          background: 'var(--border2)', color: 'var(--text)', border: 'none',
          borderRadius: 0, cursor: 'pointer' }}>+ Add</button>
      </div>
      </WsSection>
      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </div>
  )
}

// ── Schwab Account Mapping editor ─────────────────────────────────────────────
const VALID_ACCT_TYPES = ['taxable', 'rollover_ira', 'roth_ira']

function AccountMappingEditor({ data, onSaved }: {
  data: Record<string, string>
  onSaved: (key: Section, content: unknown) => void
}) {
  const [rows, setRows] = useState<[string, string][]>(() =>
    Object.entries(data).filter(([k]) => !k.startsWith('_'))
  )
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')
  const [newSuffix, setNewSuffix] = useState('')
  const [newType,   setNewType]   = useState('taxable')

  const addRow = () => {
    const s = newSuffix.trim()
    if (!s || rows.some(([k]) => k === s)) return
    setRows(prev => [...prev, [s, newType]])
    setNewSuffix('')
  }

  const save = async () => {
    setSaving(true); setError('')
    try {
      const content: Record<string, string | string[]> = {
        _comment: 'Map the last 3 digits of each Schwab account number to its type. Valid types: taxable | rollover_ira | roth_ira',
        _valid_types: VALID_ACCT_TYPES,
      }
      rows.forEach(([k, v]) => { content[k] = v })
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'account_mapping', content }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Save failed')
      setSaved(true); onSaved('account_mapping', content)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  return (
    <div>
      <WsSection id="st_account_mapping">
      <PanelHeader>Schwab Account Mapping</PanelHeader>
      <div style={{ fontSize: 12, color: M, marginBottom: 12, padding: '6px 10px',
        background: 'var(--amber)12', border: '1px solid var(--amber)40', borderRadius: 0 }}>
        Maps the last 3 digits of each Schwab account number to its tax-shelter type.
        This is the single source of truth — populated automatically on first login via start.sh.
      </div>
      <div style={{ border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: BG }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: M, fontSize: 12, fontWeight: 500 }}>LAST 3 DIGITS</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: M, fontSize: 12, fontWeight: 500 }}>TYPE</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(([suffix, type], i) => (
              <tr key={suffix} style={{ borderTop: '1px solid var(--border2)' }}>
                <td style={{ padding: '4px 10px' }}>
                  <input value={suffix}
                    onChange={e => setRows(prev => prev.map((r, j) => j === i ? [e.target.value, r[1]] : r))}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text)',
                      fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12, width: 80, outline: 'none' }} />
                </td>
                <td style={{ padding: '4px 10px' }}>
                  <select value={type}
                    onChange={e => setRows(prev => prev.map((r, j) => j === i ? [r[0], e.target.value] : r))}
                    style={{ background: P, border: '1px solid var(--fd-hairline)', outline: 'none',
                      color: 'var(--text)', fontSize: 12, borderRadius: 0, padding: '2px 6px', cursor: 'pointer' }}>
                    {VALID_ACCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                  <button onClick={() => setRows(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: R, cursor: 'pointer', fontSize: 12 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        <input value={newSuffix} onChange={e => setNewSuffix(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addRow()}
          placeholder="e.g. 632"
          style={{ padding: '4px 8px', background: P, border: '1px solid var(--fd-hairline)',
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
            width: 80, borderRadius: 0, outline: 'none' }} />
        <select value={newType} onChange={e => setNewType(e.target.value)}
          style={{ padding: '4px 8px', background: P, border: '1px solid var(--fd-hairline)',
            color: 'var(--text)', fontSize: 12, borderRadius: 0, outline: 'none', cursor: 'pointer' }}>
          {VALID_ACCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={addRow} style={{ padding: '4px 12px', fontSize: 12, fontWeight: 500,
          background: 'var(--border2)', color: 'var(--text)', border: 'none',
          borderRadius: 0, cursor: 'pointer' }}>+ Add</button>
      </div>
      </WsSection>
      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </div>
  )
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────
const SECTIONS: { id: Section; label: string; group: string; file: string }[] = [
  { id: 'personal_json',     label: 'Personal',           group: 'Config',      file: 'personal.json' },
  { id: 'tax_brackets_json', label: 'Tax brackets',       group: 'Config',      file: 'tax_brackets.json' },
  { id: 'account_mapping',   label: 'Schwab accounts',    group: 'Config',      file: 'account_mapping.json' },
  { id: 'target_roth',       label: 'Roth allocation',    group: 'Allocations', file: 'target_roth.json' },
  { id: 'target_taxable',    label: 'Taxable allocation', group: 'Allocations', file: 'target_taxable.json' },
  { id: 'price_alerts',      label: 'Price alerts',       group: 'Tools',       file: 'price alerts' },
  { id: 'ai_keys',           label: 'AI and Ollama keys', group: 'Tools',       file: 'ai_keys.json' },
  { id: 'schwab_cost',       label: 'Cost basis',         group: 'Tools',       file: 'schwab_cost.json' },
]

// ── Main SettingsTab ──────────────────────────────────────────────────────────
export function SettingsTab({ onRefresh }: { onRefresh?: () => void }) {
  const [active, setActive] = useState<Section>('personal_json')
  useWsSubTabs(active, setActive as (s: string) => void)
  const { enabled: inWorkspace } = useWorkspace()
  const [cfg, setCfg] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('')
    try {
      const res = await fetch('/api/settings')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setCfg(await res.json())
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const onSaved = useCallback((key: Section, content: unknown) => {
    setCfg(prev => prev ? { ...prev, [key]: content } : prev)
    // Refresh main dashboard data so Tax tab picks up new filing status / brackets
    if ((key === 'personal_json' || key === 'tax_brackets_json') && onRefresh) {
      onRefresh()
    }
  }, [onRefresh])

  const page = SECTIONS.find(x => x.id === active)!
  return (
    <div style={{ paddingBottom: 64 }}>
      {inWorkspace ? (
        // Advanced workspace: same eyebrow + headline, compacted into the hero band.
        <PageHero eyebrow="Settings · every save backs up the file" before="The " em="inputs" after=" behind every tab." />
      ) : (
      <section style={{ padding: '56px 0 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--fd-accent)' }}>Settings · every save backs up the file</span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 80, lineHeight: 0.85, letterSpacing: '-0.02em', margin: 0 }}>The <em>inputs</em> behind every tab.</h1>
      </section>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: '240px minmax(0,1fr)', gap: 56, alignItems: 'start', borderTop: '1px solid var(--fd-hairline)', paddingTop: 40 }}>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 28, position: 'sticky', top: 140 }}>
          {['Config', 'Allocations', 'Tools'].map(g => (
            <div key={g} style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--fd-muted)', paddingBottom: 8, borderBottom: '2px solid var(--fd-rule)' }}>{g}</span>
              {SECTIONS.filter(x => x.group === g).map(x => {
                const on = active === x.id
                return (
                  <button key={x.id} onClick={() => setActive(x.id)} className="fd-row" aria-current={on ? 'page' : undefined} style={{
                    display: 'grid', gridTemplateColumns: '8px 1fr', gap: 12, alignItems: 'stretch', padding: 0, minHeight: 44,
                    background: 'transparent', border: 'none', borderBottom: '1px solid var(--fd-hairline)', cursor: 'pointer', textAlign: 'left',
                    fontSize: 14, fontWeight: on ? 500 : 400, color: 'var(--fd-ink)',
                  }}>
                    <span style={{ background: on ? 'var(--fd-accent)' : 'transparent' }} />
                    <span style={{ alignSelf: 'center' }}>{x.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
          <button className="fd-ghost" onClick={load} style={{ height: 36, border: '1px solid var(--fd-hairline)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase', cursor: 'pointer' }}>Reload files</button>
        </nav>

      <div className="fd-settings" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
          <h2 style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>{page.label}</h2>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--fd-muted)' }}>{page.file}</span>
        </div>
        {loading && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--fd-muted)' }}>Loading config files…</div>}
        {loadErr && <div style={{ color: 'var(--fd-negative)', fontSize: 14 }}>Error: {loadErr}</div>}

        {!loading && !loadErr && cfg && (
          <>
            {active === 'personal_json' && (
              <PersonalEditor
                data={cfg.personal_json ?? {}}
                onSaved={onSaved as (key: string, content: unknown) => void}
                taxBracketsData={cfg.tax_brackets_json ?? {}}
              />
            )}
            {active === 'tax_brackets_json' && (
              <TaxBracketsEditor
                data={cfg.tax_brackets_json ?? {}}
                onSaved={onSaved as (key: string, content: unknown) => void}
                targetBracketRate={
                  (cfg.personal_json as any)?._TAX_SETTINGS?.target_bracket_rate ?? 24
                }
              />
            )}
            {active === 'account_mapping' && (
              <AccountMappingEditor data={cfg.account_mapping ?? {}} onSaved={onSaved} />
            )}
            {active === 'target_roth' && cfg.target_roth && (
              <AllocationEditor fileKey="target_roth" data={cfg.target_roth} onSaved={onSaved} />
            )}
            {active === 'target_taxable' && cfg.target_taxable && (
              <AllocationEditor fileKey="target_taxable" data={cfg.target_taxable} onSaved={onSaved} />
            )}
            {active === 'price_alerts' && (
              <AlertManager data={cfg.price_alerts ?? { alerts: [] }} onSaved={onSaved as (key: string, content: unknown) => void} />
            )}
            {active === 'ai_keys' && cfg.ai_keys && (
              <AIKeysEditor data={cfg.ai_keys} onSaved={onSaved} />
            )}
            {active === 'schwab_cost' && (
              <SchwabCostEditor
                data={cfg.schwab_cost as Record<string, any>}
                accountMapping={cfg.account_mapping ?? {}}
                onSaved={onSaved as (key: string, content: unknown) => void}
              />
            )}
          </>
        )}
      </div>
      </section>
    </div>
  )
}