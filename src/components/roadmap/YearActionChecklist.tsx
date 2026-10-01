/**
 * YearActionChecklist — this calendar year's action items for a phase.
 * Checked state persists per phase+year in localStorage so it naturally
 * resets when the year (or phase) changes.
 */
import { useState } from 'react'
import { RuledList, muted } from '../ui/primitives'

function storageKey(phaseId: string, year: number) {
  return `roadmap_checklist_${phaseId}_${year}`
}

/** Render with `key={`${phaseId}-${year}`}` from the parent so switching
 * phase/year remounts this component and re-reads localStorage fresh. */
export function YearActionChecklist({ phaseId, year, actions }: { phaseId: string; year: number; actions: { text: string; sub?: string }[] }) {
  const key = storageKey(phaseId, year)
  const [checked, setChecked] = useState<Record<number, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
  })

  const toggle = (i: number) => {
    const next = { ...checked, [i]: !checked[i] }
    setChecked(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* private mode */ }
  }

  return (
    <RuledList>
      {actions.map((a, i) => (
        <button key={i} className="fd-row" onClick={() => toggle(i)} aria-pressed={!!checked[i]} style={{
          display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, padding: '10px 0',
          background: 'transparent', border: 'none', borderBottom: '1px solid var(--fd-hairline)', textAlign: 'left', cursor: 'pointer', fontSize: 14,
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{checked[i] ? '✓' : '→'}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, color: checked[i] ? 'var(--fd-muted)' : 'var(--fd-ink)' }}>
            <span style={{ textDecoration: checked[i] ? 'line-through' : 'none' }}>{a.text}</span>
            {a.sub && <span style={{ fontSize: 13, ...muted }}>{a.sub}</span>}
          </span>
        </button>
      ))}
    </RuledList>
  )
}
