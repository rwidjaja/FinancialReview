/**
 * FindPalette — global ⌘K / "/" search over every tab's section registry
 * (design_handoff_advanced_workspace §G). Picking a result switches tab and
 * opens that section.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { SECTION_REGISTRY, type SectionMeta } from './registry'
import { TABS, tabLabel, type TabId } from '../layout/AppHeader'
import { mono, muted } from '../ui/primitives'

interface Hit extends SectionMeta { tab: TabId; match?: string; score: number }

const ALL: (SectionMeta & { tab: TabId })[] = TABS.flatMap(t => (SECTION_REGISTRY[t.id] ?? []).map(s => ({ ...s, tab: t.id })))

function search(q: string, currentTab: TabId): Hit[] {
  const s = q.trim().toLowerCase()
  if (!s) return ALL.filter(e => e.tab === currentTab).map(e => ({ ...e, score: 0 }))
  const out: Hit[] = []
  for (const e of ALL) {
    const title = e.title.toLowerCase()
    let score = 0
    let match: string | undefined
    if (title.startsWith(s)) score = 3
    else if (title.includes(s)) score = 2
    else {
      const k = e.keys?.find(k => k.toLowerCase().includes(s))
      if (k) { score = 1; match = k }
      else if (e.group.toLowerCase().includes(s)) score = 0.75
      else if (tabLabel(e.tab).toLowerCase().startsWith(s)) score = 0.5
    }
    if (!score) continue
    if (e.tab === currentTab) score += 0.1
    out.push({ ...e, match, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 14)
}

export function FindPalette({ initialQuery = '', currentTab, onPick, onClose }: {
  initialQuery?: string; currentTab: TabId
  onPick: (tab: TabId, sectionId: string, adv: boolean) => void
  onClose: () => void
}) {
  const [q, setQ] = useState(initialQuery)
  const [sel, setSel] = useState(0)
  const hits = useMemo(() => search(q, currentTab), [q, currentTab])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (h: Hit | undefined) => { if (h) { onPick(h.tab, h.id, !!h.adv); onClose() } }

  return (
    <div data-fd-modal onMouseDown={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(22,22,22,0.64)',
      display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh',
    }}>
      <div role="dialog" aria-label="Find" onMouseDown={e => e.stopPropagation()} style={{
        width: 'min(760px, 94vw)', maxHeight: '72vh', background: 'var(--fd-page)', color: 'var(--fd-ink)',
        border: '1px solid var(--fd-ink)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ flexShrink: 0, height: 64, padding: '0 20px', borderBottom: '2px solid var(--fd-rule)', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'center' }}>
          <span style={{ ...mono, ...muted }}>Find</span>
          <input
            autoFocus className="fd-find-input" value={q} onChange={e => { setQ(e.target.value); setSel(0) }}
            placeholder="IRMAA, bracket room, NVDA lots, guardrail…" aria-label="Find a section or metric"
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); pick(hits[sel]) }
            }}
            style={{ fontSize: 20, border: 'none', background: 'transparent', color: 'var(--fd-ink)', outline: 'none', minWidth: 0 }}
          />
          <span style={{ ...mono, ...muted, border: '1px solid var(--fd-hairline)', padding: '2px 6px' }}>Esc</span>
        </div>

        <div ref={listRef} style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          {hits.length === 0 && (
            <div style={{ padding: '20px', fontSize: 14, ...muted }}>
              No section or metric matches "{q}". It is not in the dashboard yet.
            </div>
          )}
          {hits.map((h, i) => {
            const on = i === sel
            return (
              <button key={`${h.tab}:${h.id}`} data-i={i} onMouseMove={() => setSel(i)} onClick={() => pick(h)} style={{
                display: 'grid', gridTemplateColumns: '112px minmax(0,1fr)', gap: 16, alignItems: 'baseline',
                width: '100%', padding: '12px 20px', border: 'none', borderBottom: '1px solid var(--fd-hairline)',
                background: on ? 'var(--fd-ink)' : 'transparent', color: on ? 'var(--fd-page)' : 'var(--fd-ink)',
                textAlign: 'left', cursor: 'pointer',
              }}>
                <span style={{ ...mono, opacity: 0.72 }}>{tabLabel(h.tab)}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{h.title}</span>
                  <span style={{ fontSize: 13, opacity: 0.72 }}>
                    {h.group}{h.match ? ` · Contains "${h.match}"` : ''}{h.adv ? ' · Advanced' : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 20px', borderTop: '1px solid var(--fd-hairline)', ...mono, ...muted, fontSize: 11 }}>
          <span>↑ ↓ move · Enter open</span>
          <span>{q.trim() ? `${hits.length} matches · ${ALL.length} sections indexed` : `This tab · type to search all ${ALL.length}`}</span>
        </div>
      </div>
    </div>
  )
}
