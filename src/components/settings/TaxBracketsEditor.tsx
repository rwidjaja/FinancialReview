/**
 * TaxBracketsEditor — edit tax_brackets.json from the UI.
 * Shows the ordinary income brackets for MFJ and Single filing status,
 * standard deductions, and lets the user update thresholds each tax year.
 */

import { useState } from 'react'
import { SaveBar } from './SaveBar'
import { fmtMoneyFull } from '../../utils/formatters'

const M  = 'var(--text2)'
const A  = 'var(--amber)'
const P  = 'var(--panel)'

const LBL: React.CSSProperties = {
  padding: '5px 10px', fontSize: 12, color: M, fontWeight: 500,
  whiteSpace: 'nowrap', width: 180,
}
const VAL: React.CSSProperties = { padding: '3px 10px' }
const CELL_INPUT: React.CSSProperties = {
  background: 'transparent', border: 'none', outline: 'none',
  color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
  width: '100%', padding: '2px 0',
}

interface Bracket { rate: number; min: number; max: number | null }

interface TaxBracketsData {
  _TAX_BRACKETS: {
    year: number
    standard_deduction_single: number
    standard_deduction_mfj: number
    brackets_single: Bracket[]
    brackets_mfj: Bracket[]
  }
}

const RATE_LABELS: Record<number, string> = {
  0.10: '10%', 0.12: '12%', 0.22: '22%', 0.24: '24%',
  0.32: '32%', 0.35: '35%', 0.37: '37%',
}

function BracketTable({
  brackets, onUpdate, targetRate,
}: {
  brackets: Bracket[]
  onUpdate: (i: number, field: 'min' | 'max', val: number | null) => void
  targetRate: number
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: 'var(--fd-card)' }}>
          {['Rate', 'Income From', 'Income To', 'Range'].map(h => (
            <th key={h} style={{
              padding: '5px 10px', textAlign: 'left', fontSize: 12,
              textTransform: 'uppercase', letterSpacing: '0.5px', color: M,
              borderBottom: '1px solid var(--border2)',
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {brackets.map((b, i) => {
          const isTarget = Math.abs(b.rate - targetRate / 100) < 0.001
          const rowStyle: React.CSSProperties = {
            background: isTarget ? `${A}1a` : 'transparent',
            borderLeft: isTarget ? `3px solid ${A}` : '3px solid transparent',
          }
          const width = b.max != null ? b.max - b.min : null
          return (
            <tr key={i} style={rowStyle}>
              <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', fontWeight: 500,
                color: isTarget ? A : 'var(--text)' }}>
                {RATE_LABELS[b.rate] ?? `${(b.rate * 100).toFixed(0)}%`}
                {isTarget && <span style={{ fontSize: 12, color: A, marginLeft: 6 }}>← TARGET</span>}
              </td>
              <td style={{ padding: '4px 6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <span style={{ color: M, fontSize: 12 }}>$</span>
                  <input
                    type="number"
                    value={b.min}
                    onChange={e => onUpdate(i, 'min', Number(e.target.value))}
                    step={1000}
                    style={{ ...CELL_INPUT, width: 110 }}
                  />
                </div>
              </td>
              <td style={{ padding: '4px 6px' }}>
                {b.max != null ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ color: M, fontSize: 12 }}>$</span>
                    <input
                      type="number"
                      value={b.max}
                      onChange={e => onUpdate(i, 'max', Number(e.target.value))}
                      step={1000}
                      style={{ ...CELL_INPUT, width: 110 }}
                    />
                  </div>
                ) : (
                  <span style={{ color: M, fontSize: 12, padding: '2px 10px' }}>No limit</span>
                )}
              </td>
              <td style={{ padding: '4px 10px', color: M, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                {width != null ? fmtMoneyFull(width) : '∞'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function TaxBracketsEditor({ data, onSaved, targetBracketRate }: {
  data: Record<string, unknown>
  onSaved: (key: string, content: unknown) => void
  targetBracketRate?: number
}) {
  const raw = data as unknown as TaxBracketsData
  const tb = raw._TAX_BRACKETS ?? { year: 2026, standard_deduction_single: 15000,
    standard_deduction_mfj: 32200, brackets_single: [], brackets_mfj: [] }

  const [year,    setYear]    = useState(tb.year ?? 2026)
  const [dedMfj,  setDedMfj]  = useState(tb.standard_deduction_mfj ?? 32200)
  const [dedSin,  setDedSin]  = useState(tb.standard_deduction_single ?? 15000)
  const [mfjBkts, setMfjBkts] = useState<Bracket[]>(tb.brackets_mfj ?? [])
  const [sinBkts, setSinBkts] = useState<Bracket[]>(tb.brackets_single ?? [])
  const [view,    setView]    = useState<'mfj' | 'single'>('mfj')

  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  const updateBkt = (set: React.Dispatch<React.SetStateAction<Bracket[]>>) =>
    (i: number, field: 'min' | 'max', val: number | null) =>
      set(prev => prev.map((b, j) => j === i ? { ...b, [field]: val } : b))

  const buildPayload = () => ({
    _TAX_BRACKETS: {
      year: Number(year),
      standard_deduction_mfj:    Number(dedMfj),
      standard_deduction_single: Number(dedSin),
      brackets_mfj:    mfjBkts,
      brackets_single: sinBkts,
    },
  })

  const save = async () => {
    setSaving(true); setError('')
    try {
      const payload = buildPayload()
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'tax_brackets_json', content: payload }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Save failed')
      setSaved(true); onSaved('tax_brackets_json', payload)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  const activeBrackets = view === 'mfj' ? mfjBkts : sinBkts
  const activeUpdate   = view === 'mfj' ? updateBkt(setMfjBkts) : updateBkt(setSinBkts)
  const activeDed      = view === 'mfj' ? dedMfj : dedSin
  const setActiveDed   = view === 'mfj' ? setDedMfj : setDedSin

  return (
    <div>
      {/* Header info */}
      <div style={{ marginBottom: 12, fontSize: 12, color: M, lineHeight: 1.6 }}>
        Edit the IRS ordinary income tax brackets. These are updated annually (usually October/November).
        The <strong style={{ color: A }}>← TARGET</strong> row shows your selected target bracket from Personal Settings.
        Saving updates <code>tax_brackets.json</code> and takes effect on the next server refresh.
      </div>

      {/* Year + filing toggle */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12,
        padding: '8px 12px', background: P, borderRadius: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: M }}>Tax Year</span>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))}
            style={{ ...CELL_INPUT, width: 70, background: 'var(--surface)',
              border: '1px solid var(--fd-hairline)', padding: '2px 6px', borderRadius: 0 }} />
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {(['mfj', 'single'] as const).map(f => (
            <button key={f} onClick={() => setView(f)} style={{
              padding: '4px 12px', cursor: 'pointer', borderRadius: 0,
              border: `1px solid ${view === f ? A : 'var(--border2)'}`,
              background: view === f ? `${A}1a` : 'transparent',
              color: view === f ? A : M, fontSize: 12, fontWeight: 500,
            }}>
              {f === 'mfj' ? 'Married Filing Jointly' : 'Single'}
            </button>
          ))}
        </div>
      </div>

      {/* Standard deduction */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <tbody>
          <tr style={{ background: 'var(--fd-card)' }}>
            <td style={{ ...LBL, borderBottom: '1px solid var(--border2)' }}>
              Standard Deduction ({view === 'mfj' ? 'MFJ' : 'Single'})
            </td>
            <td style={{ ...VAL, borderBottom: '1px solid var(--border2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: M, fontSize: 12 }}>$</span>
                <input type="number" value={activeDed}
                  onChange={e => setActiveDed(Number(e.target.value))}
                  step={100} style={{ ...CELL_INPUT, width: 120 }} />
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Brackets table */}
      <BracketTable
        brackets={activeBrackets}
        onUpdate={activeUpdate}
        targetRate={targetBracketRate ?? 24}
      />

      <div style={{ marginTop: 6, fontSize: 12, color: M, fontStyle: 'italic' }}>
        Note: The "Income To" field uses taxable ordinary income (after standard deduction).
        The bracket ceiling shown in the Tax tab uses gross income (before deduction).
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </div>
  )
}
