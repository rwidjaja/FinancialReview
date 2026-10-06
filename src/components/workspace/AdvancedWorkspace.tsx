/**
 * AdvancedWorkspace — Advanced-mode container for every tab
 * (design_handoff_advanced_workspace §B–F).
 *
 *   compact hero band (PageHero + KpiStrip portal into it)
 *   ┌ 288px "On this tab" rail ┬ main column ─────────────────────────┐
 *   │ filter · grouped rows    │ focus: 03 / 14 · GROUP  ← Prev Next → │
 *   │ (sticky)                 │        <the tab, one section shown>   │
 *   │                          │        Next · <group> card            │
 *   └──────────────────────────┴───────────────────────────────────────┘
 *
 * The tab itself is rendered unchanged as `children`; sections opt in with
 * <WsSection>. Content outside any WsSection (symbol pickers, sub-tab bars,
 * notes) stays visible above the active section.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { WorkspaceContext, type AdvLayout, type SectionInfo, type WorkspaceCtx } from './context'
import { SECTION_REGISTRY, type SectionMeta } from './registry'
import type { TabId } from '../layout/AppHeader'
import { STATUS_FILL, Segmented, mono, muted, type Status } from '../ui/primitives'

const HEADER_OFFSET = 137   // sticky header (113) + 24

export interface RailEntry extends SectionMeta {
  mounted: boolean
  reachable: boolean        // mounted, or one sub-tab switch away
  value?: string
  status?: Status
  match?: string            // keyword that matched the filter (not the title)
}

function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function AdvancedWorkspace({ tab, requestedId, onActive, layout, onLayout, scroller, onOpenFind, railValues = true, children }: {
  tab: TabId
  requestedId: string | null
  onActive: (id: string) => void
  layout: AdvLayout
  onLayout: (l: AdvLayout) => void
  scroller: RefObject<HTMLElement | null>
  onOpenFind: (q?: string) => void
  railValues?: boolean
  children: ReactNode
}) {
  // ── Registration ──────────────────────────────────────────────────────────
  const [registered, setRegistered] = useState<Map<string, SectionInfo & { seq: number }>>(() => new Map())
  const seq = useRef(0)
  const register = useCallback((id: string, info: SectionInfo) => {
    setRegistered(prev => {
      const cur = prev.get(id)
      if (cur && cur.value === info.value && cur.status === info.status && cur.title === info.title && cur.group === info.group) return prev
      const next = new Map(prev)
      next.set(id, { ...info, seq: cur?.seq ?? seq.current++ })
      return next
    })
  }, [])
  const unregister = useCallback((id: string) => {
    setRegistered(prev => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])
  const [subTabs, setSubTabsState] = useState<{ current: string; set: (s: string) => void } | null>(null)
  const setSubTabs = useCallback((s: { current: string; set: (s: string) => void } | null) => {
    setSubTabsState(prev => (prev?.current === s?.current && prev?.set === s?.set ? prev : s))
  }, [])
  const [heroSlot, setHeroSlot] = useState<HTMLElement | null>(null)

  // ── Rail entries: registry order, then hero/extra sections ────────────────
  const entries: RailEntry[] = useMemo(() => {
    const meta = SECTION_REGISTRY[tab] ?? []
    const known = new Set(meta.map(m => m.id))
    const extras = [...registered.entries()]
      .filter(([id]) => !known.has(id))
      .sort((a, b) => (a[0].startsWith('__') ? -1 : 0) - (b[0].startsWith('__') ? -1 : 0) || a[1].seq - b[1].seq)
      .map(([id, info]): SectionMeta => ({ id, title: info.title ?? id, group: info.group ?? 'More' }))
    const heroFirst = extras.filter(e => e.id.startsWith('__'))
    const rest = extras.filter(e => !e.id.startsWith('__'))
    // A sub-tab switch only helps once the tab is showing content at all
    // (e.g. Research before a symbol is picked has nothing to switch to).
    const anyMounted = registered.size > 0
    return [...heroFirst, ...meta, ...rest].map(m => {
      const r = registered.get(m.id)
      const mounted = !!r
      const reachable = mounted || (anyMounted && !!m.sub && !!subTabs && m.sub !== subTabs.current)
      return { ...m, mounted, reachable, value: r?.value, status: r?.status }
    })
  }, [tab, registered, subTabs])

  const reachable = entries.filter(e => e.reachable)
  const mountedEntries = entries.filter(e => e.mounted)
  const requestedMounted = requestedId != null && registered.has(requestedId)
  const activeId = requestedMounted ? requestedId : (mountedEntries[0]?.id ?? null)

  // ── Selection / navigation ────────────────────────────────────────────────
  const mainColRef = useRef<HTMLDivElement>(null)
  const pendingScroll = useRef<string | null>(null)

  const select = useCallback((e: RailEntry) => {
    if (!e.mounted && e.sub && subTabs && e.sub !== subTabs.current) subTabs.set(e.sub)
    onActive(e.id)
    pendingScroll.current = e.id
  }, [subTabs, onActive])

  // After a selection renders: focus → bring the pager top into view;
  // scroll → bring the section to the top.
  useEffect(() => {
    const id = pendingScroll.current
    if (!id || !registered.has(id)) return
    pendingScroll.current = null
    const sc = scroller.current
    if (!sc) return
    requestAnimationFrame(() => {
      if (layout === 'scroll') {
        const el = document.getElementById(`sec-${id}`)
        if (el) sc.scrollBy({ top: el.getBoundingClientRect().top - 140 })
      } else {
        const top = mainColRef.current?.getBoundingClientRect().top
        if (top != null && top < HEADER_OFFSET) sc.scrollBy({ top: top - HEADER_OFFSET })
      }
    })
  })

  // Charts (ECharts listens to window resize) need a nudge when un-hidden.
  useEffect(() => {
    if (layout !== 'focus') return
    const r = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(r)
  }, [activeId, layout])

  const idx = reachable.findIndex(e => e.id === activeId)
  const step = useCallback((d: 1 | -1) => {
    if (!reachable.length) return
    const i = idx < 0 ? 0 : (idx + d + reachable.length) % reachable.length
    select(reachable[i])
  }, [reachable, idx, select])

  // J/K and ←/→ in focus layout
  useEffect(() => {
    if (layout !== 'focus') return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || isTyping(ev.target)) return
      if (document.querySelector('[data-fd-modal], [role="dialog"], [aria-modal="true"]')) return
      if (ev.key === 'j' || ev.key === 'J' || ev.key === 'ArrowRight') { ev.preventDefault(); step(1) }
      else if (ev.key === 'k' || ev.key === 'K' || ev.key === 'ArrowLeft') { ev.preventDefault(); step(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, step])

  // ── Scroll-spy (scroll layout) ────────────────────────────────────────────
  const [spyId, setSpyId] = useState<string | null>(null)
  useEffect(() => {
    if (layout !== 'scroll') return
    const sc = scroller.current
    if (!sc) return
    const onScroll = () => {
      let cur: string | null = null
      for (const el of document.querySelectorAll<HTMLElement>('[data-ws-id]')) {
        if (el.getBoundingClientRect().top < 200) cur = el.dataset.wsId ?? cur
      }
      setSpyId(cur)
    }
    onScroll()
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [layout, scroller, registered])
  useEffect(() => {
    if (layout === 'scroll' && spyId) onActive(spyId)
  }, [layout, spyId, onActive])

  const highlighted = layout === 'scroll' ? (spyId ?? activeId) : activeId
  const narrow = useMediaQuery('(max-width: 900px)')

  const focusSection = useCallback((id: string) => { onActive(id); pendingScroll.current = id }, [onActive])
  const ctx: WorkspaceCtx = useMemo(() => ({
    enabled: true, layout, activeId, heroSlot, register, unregister, setSubTabs, focusSection,
  }), [layout, activeId, heroSlot, register, unregister, setSubTabs, focusSection])

  const active = entries.find(e => e.id === activeId)
  const next = idx >= 0 && reachable.length > 1 ? reachable[(idx + 1) % reachable.length] : undefined
  const prev = idx >= 0 && reachable.length > 1 ? reachable[(idx - 1 + reachable.length) % reachable.length] : undefined

  return (
    <WorkspaceContext.Provider value={ctx}>
      <div ref={setHeroSlot} className="fd-hero-slot" style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end',
        gap: '24px 48px', padding: '32px 0 28px', borderBottom: '1px solid var(--fd-hairline)',
      }} />

      <div style={narrow
        ? { display: 'flex', flexDirection: 'column', gap: 24, padding: '24px 0 64px' }
        : { display: 'grid', gridTemplateColumns: '288px minmax(0,1fr)', gap: 48, alignItems: 'start', padding: '32px 0 64px' }}>
        {narrow
          ? <RailSelect entries={entries} activeId={highlighted} onSelect={select} />
          : <Rail entries={entries} activeId={highlighted} onSelect={select} layout={layout} onLayout={onLayout}
              railValues={railValues} onOpenFind={onOpenFind} />}

        <div ref={mainColRef} style={{ display: 'flex', flexDirection: 'column', gap: layout === 'focus' ? 40 : 64, minWidth: 0 }}>
          {layout === 'focus' && active && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingBottom: 16, borderBottom: '1px solid var(--fd-hairline)', marginBottom: -24 }}>
              <span style={{ ...mono, ...muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {String(idx + 1).padStart(2, '0')} / {String(reachable.length).padStart(2, '0')} · {active.group}
              </span>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {prev && <PagerButton onClick={() => step(-1)}>← {prev.title}</PagerButton>}
                {next && <PagerButton strong onClick={() => step(1)}>{next.title} →</PagerButton>}
              </div>
            </div>
          )}

          {children}

          {layout === 'focus' && next && (
            <button className="fd-ws-next" onClick={() => step(1)} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, width: '100%',
              padding: '24px 0', border: 'none', borderTop: '2px solid var(--fd-rule)', background: 'transparent',
              color: 'var(--fd-ink)', cursor: 'pointer', textAlign: 'left',
            }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <span style={{ ...mono, ...muted }}>Next · {next.group}</span>
                <span className="fd-ws-title" style={{ fontSize: 20, fontWeight: 500 }}>{next.title}</span>
              </span>
              <span style={{ ...mono, ...muted, flexShrink: 0 }}>J / →</span>
            </button>
          )}
        </div>
      </div>
    </WorkspaceContext.Provider>
  )
}

function PagerButton({ children, onClick, strong }: { children: ReactNode; onClick: () => void; strong?: boolean }) {
  return (
    <button className={strong ? 'fd-ws-fill' : 'fd-ghost'} onClick={onClick} style={{
      height: 32, padding: '0 12px', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      border: `1px solid ${strong ? 'var(--fd-ink)' : 'var(--fd-hairline)'}`, background: 'transparent', color: 'var(--fd-ink)',
      ...mono, cursor: 'pointer',
    }}>{children}</button>
  )
}

// ── Rail ────────────────────────────────────────────────────────────────────

function matchSections<T extends SectionMeta>(list: T[], q: string): (T & { match?: string })[] {
  const s = q.trim().toLowerCase()
  if (!s) return list
  const out: (T & { match?: string })[] = []
  for (const e of list) {
    if (e.title.toLowerCase().includes(s) || e.group.toLowerCase().includes(s)) { out.push(e); continue }
    const k = e.keys?.find(k => k.toLowerCase().includes(s))
    if (k) out.push({ ...e, match: k })
  }
  return out
}

function groupBy<T extends { group: string }>(list: T[]): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const e of list) {
    if (!m.has(e.group)) m.set(e.group, [])
    m.get(e.group)!.push(e)
  }
  return [...m.entries()]
}

function Rail({ entries, activeId, onSelect, layout, onLayout, railValues, onOpenFind }: {
  entries: RailEntry[]; activeId: string | null; onSelect: (e: RailEntry) => void
  layout: AdvLayout; onLayout: (l: AdvLayout) => void; railValues: boolean; onOpenFind: (q?: string) => void
}) {
  const [filter, setFilter] = useState('')
  const shown = matchSections(entries, filter)
  const total = entries.length
  return (
    <nav aria-label="On this tab" style={{
      position: 'sticky', top: HEADER_OFFSET, maxHeight: `calc(100vh - ${HEADER_OFFSET + 24}px)`,
      display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 500 }}>On this tab</span>
        <span style={{ ...mono, ...muted }}>{filter.trim() ? `${shown.length} of ${total}` : `${total} sections`}</span>
      </div>
      <input
        className="fd-ws-filter" value={filter} onChange={e => setFilter(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setFilter('')
          if (e.key === 'Enter' && shown[0]?.reachable) onSelect(shown[0])
        }}
        placeholder={`Filter ${total} sections and metrics`} aria-label="Filter sections and metrics"
        style={{ height: 40, padding: '0 12px', border: 'none', background: 'var(--fd-card)', color: 'var(--fd-ink)', fontSize: 14, flexShrink: 0 }}
      />
      <div className="fd-ws-scroll" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, minHeight: 0, paddingRight: 4 }}>
        {shown.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
            <span style={{ fontSize: 13, ...muted }}>Nothing on this tab matches.</span>
            <button className="fd-link" onClick={() => onOpenFind(filter)} style={{ ...mono, background: 'none', border: 'none', padding: 0, color: 'var(--fd-ink)', textAlign: 'left' }}>
              Search all tabs →
            </button>
          </div>
        )}
        {groupBy(shown).map(([group, rows]) => (
          <div key={group} style={{ borderTop: '2px solid var(--fd-rule)', display: 'flex', flexDirection: 'column' }}>
            <span style={{ ...mono, ...muted, padding: '10px 0 6px' }}>{group}</span>
            {rows.map(e => <RailRow key={e.id} e={e} on={e.id === activeId} onSelect={onSelect} railValues={railValues} />)}
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--fd-hairline)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Segmented size="sm" mono value={layout} onChange={onLayout} options={[{ id: 'focus', label: 'Focus' }, { id: 'scroll', label: 'Scroll' }]} />
        <span style={{ ...mono, ...muted, fontSize: 11 }}>
          {layout === 'focus' ? 'J / K next · ⌘K find anywhere' : 'Click to jump · ⌘K find anywhere'}
        </span>
      </div>
    </nav>
  )
}

function RailRow({ e, on, onSelect, railValues }: { e: RailEntry; on: boolean; onSelect: (e: RailEntry) => void; railValues: boolean }) {
  const dim = !e.reachable
  return (
    <button
      className={on ? undefined : 'fd-ws-row'} disabled={dim} onClick={() => onSelect(e)} aria-current={on ? 'true' : undefined}
      title={dim ? 'Not shown right now (no data, or needs an input above)' : undefined}
      style={{
        display: 'grid', gridTemplateColumns: '10px minmax(0,1fr) auto', gap: 10, alignItems: 'baseline',
        padding: '9px 10px', margin: '0 -10px', border: 'none', borderBottom: '1px solid var(--fd-hairline)',
        background: on ? 'var(--fd-ink)' : 'transparent', color: on ? 'var(--fd-page)' : 'var(--fd-ink)',
        textAlign: 'left', cursor: dim ? 'default' : 'pointer', opacity: dim ? 0.45 : 1,
      }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_FILL[e.status ?? 'info'], alignSelf: 'center', outline: on && (e.status ?? 'info') === 'info' ? '1px solid var(--fd-page)' : undefined }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: on ? 500 : 400 }}>
          <span className="fd-ws-title">{e.title}</span>
          {e.adv && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.03em', opacity: 0.64, marginLeft: 6 }}>ADV</span>}
        </span>
        {e.match && <span style={{ fontSize: 12, opacity: 0.72 }}>matches "{e.match}"</span>}
      </span>
      {railValues && e.value ? <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', textAlign: 'right' }}>{e.value}</span> : <span />}
    </button>
  )
}

/** Under ~900px the rail collapses into a full-width select above the content. */
function RailSelect({ entries, activeId, onSelect }: { entries: RailEntry[]; activeId: string | null; onSelect: (e: RailEntry) => void }) {
  return (
    <select
      value={activeId ?? ''} aria-label="Section"
      onChange={ev => { const e = entries.find(x => x.id === ev.target.value); if (e) onSelect(e) }}
      style={{ height: 44, padding: '0 12px', border: '1px solid var(--fd-rule)', background: 'var(--fd-card)', color: 'var(--fd-ink)', fontSize: 14, width: '100%' }}
    >
      {groupBy(entries).map(([group, rows]) => (
        <optgroup key={group} label={group}>
          {rows.map(e => (
            <option key={e.id} value={e.id} disabled={!e.reachable}>
              {e.title}{e.value ? ` — ${e.value}` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
