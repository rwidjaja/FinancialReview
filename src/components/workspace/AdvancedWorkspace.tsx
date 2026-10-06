/**
 * AdvancedWorkspace — Advanced-mode container for every tab
 * (design_handoff_advanced_workspace §B–F).
 *
 *   compact hero band (PageHero + KpiStrip portal into it)
 *   ┌ 288px "On this tab" rail ┬ main column ─────────────────────────┐
 *   │ filter · grouped rows    │ focus: 02 / 05 · Group  ← Prev Next → │
 *   │ (sticky)                 │        <the tab, one GROUP shown —    │
 *   │                          │         its sections stacked>         │
 *   │                          │        Next page card                 │
 *   └──────────────────────────┴───────────────────────────────────────┘
 *
 * The tab itself is rendered unchanged as `children`; sections opt in with
 * <WsSection>. Content outside any WsSection (symbol pickers, sub-tab bars,
 * notes) stays visible above the active section.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { WorkspaceContext, type AdvLayout, type SectionInfo, type SubTabState, type WorkspaceCtx } from './context'
import { SECTION_REGISTRY, SUBTAB_REGISTRY, type SectionMeta, type SubTabMeta } from './registry'
import type { TabId } from '../layout/AppHeader'
import { STATUS_FILL, Segmented, mono, muted, type Status } from '../ui/primitives'

const HEADER_OFFSET = 137   // sticky header (113) + 24

export interface RailEntry extends SectionMeta {
  mounted: boolean
  reachable: boolean        // mounted, or one sub-tab switch away
  value?: string
  status?: Status
  match?: string            // keyword that matched the filter (not the title)
  groupLabel: string        // group as shown in a sub-tab-scoped rail (sub-tab prefix dropped)
  subLabel?: string         // the sub-tab this section lives on
  inScope: boolean          // on the current sub-tab (or shared by all of them)
  empty: boolean            // rendered but has nothing to show right now
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
      if (cur && cur.value === info.value && cur.status === info.status && cur.title === info.title && cur.group === info.group && cur.empty === info.empty) return prev
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
  const [subTabs, setSubTabsState] = useState<SubTabState | null>(null)
  const setSubTabs = useCallback((s: SubTabState | null) => {
    setSubTabsState(prev => (prev?.current === s?.current && prev?.set === s?.set && JSON.stringify(prev?.badges) === JSON.stringify(s?.badges) ? prev : s))
  }, [])
  const [heroSlot, setHeroSlot] = useState<HTMLElement | null>(null)

  // ── Rail entries: registry order; hero/extra sections join the first page ─
  const subDefs = subTabs ? SUBTAB_REGISTRY[tab] : undefined
  const entries: RailEntry[] = useMemo(() => {
    const meta = SECTION_REGISTRY[tab] ?? []
    const scoped = !!subDefs && !!subTabs
    const inScopeMeta = (m: SectionMeta) => !scoped || !m.sub || m.sub === subTabs!.current
    const known = new Set(meta.map(m => m.id))
    const firstMeta = meta.find(inScopeMeta)
    const firstGroup = firstMeta?.group ?? 'Overview'
    const extras = [...registered.entries()]
      .filter(([id]) => !known.has(id))
      .sort((a, b) => a[1].seq - b[1].seq)
      .map(([id, info]): SectionMeta => (id.startsWith('__')
        // The hero panel joins the first page of the current view (same group and sub-tab).
        ? { id, title: info.title ?? id, group: firstGroup, sub: firstMeta?.sub }
        : { id, title: info.title ?? id, group: info.group ?? 'More' }))
    const heroFirst = extras.filter(e => e.id.startsWith('__'))
    const rest = extras.filter(e => !e.id.startsWith('__'))
    // A sub-tab switch only helps once the tab is showing content at all
    // (e.g. Research before a symbol is picked has nothing to switch to).
    const anyMounted = registered.size > 0
    return [...heroFirst, ...meta, ...rest].map(m => {
      const r = registered.get(m.id)
      const mounted = !!r && !r.empty
      const reachable = mounted || (anyMounted && !!m.sub && !!subTabs && m.sub !== subTabs.current)
      const subLabel = m.sub ? subDefs?.find(sd => sd.id === m.sub)?.label : undefined
      const groupLabel = scoped && subLabel && m.group.startsWith(`${subLabel} · `) ? m.group.slice(subLabel.length + 3)
        : scoped && subLabel && m.group === subLabel ? subLabel : m.group
      return { ...m, mounted, reachable, empty: !!r?.empty, value: r?.value, status: r?.status, groupLabel, subLabel, inScope: inScopeMeta(m) }
    })
  }, [tab, registered, subTabs, subDefs])

  // Pages = the groups of the current scope that have something to show.
  // Sections that rendered nothing (empty) or are not mounted drop out.
  const pages = useMemo(() => {
    const out: { group: string; label: string; items: RailEntry[] }[] = []
    for (const e of entries) {
      if (!e.inScope || !e.mounted) continue
      let pg = out.find(p => p.group === e.group)
      if (!pg) { pg = { group: e.group, label: e.groupLabel, items: [] }; out.push(pg) }
      pg.items.push(e)
    }
    return out
  }, [entries])

  const requested = requestedId != null ? entries.find(e => e.id === requestedId && e.mounted && e.inScope) : undefined
  const activeEntry = requested ?? pages[0]?.items[0]
  const activeId = activeEntry?.id ?? null
  const pageIdx = activeEntry ? pages.findIndex(p => p.group === activeEntry.group) : -1
  const page = pageIdx >= 0 ? pages[pageIdx] : undefined
  const visibleIds = useMemo(
    () => (layout === 'focus' ? new Set(page?.items.map(e => e.id) ?? []) : null),
    [layout, page],
  )

  // ── Selection / navigation ────────────────────────────────────────────────
  const mainColRef = useRef<HTMLDivElement>(null)
  const pendingScroll = useRef<string | null>(null)

  const select = useCallback((e: RailEntry) => {
    if (!e.inScope && e.sub && subTabs && e.sub !== subTabs.current) subTabs.set(e.sub)
    onActive(e.id)
    pendingScroll.current = e.id
  }, [subTabs, onActive])

  const selectSub = useCallback((id: string) => {
    if (!subTabs || id === subTabs.current) return
    subTabs.set(id)
    const first = entries.find(e => e.sub === id)
    if (first) { onActive(first.id); pendingScroll.current = '__top' }
  }, [subTabs, entries, onActive])

  const goPage = useCallback((i: number) => {
    const pg = pages[i]
    if (!pg) return
    onActive(pg.items[0].id)
    pendingScroll.current = '__top'
  }, [pages, onActive])

  // After a selection renders: the first section of a page (or a page change)
  // brings the page top into view; any other section scrolls to itself.
  useEffect(() => {
    const id = pendingScroll.current
    if (!id) return
    if (id !== '__top' && !registered.has(id)) return
    pendingScroll.current = null
    const sc = scroller.current
    if (!sc) return
    requestAnimationFrame(() => {
      const firstOfPage = layout === 'focus' && page?.items[0]?.id === id
      if (id === '__top' || firstOfPage) {
        const top = mainColRef.current?.getBoundingClientRect().top
        if (top != null && top < HEADER_OFFSET) sc.scrollBy({ top: top - HEADER_OFFSET })
      } else {
        const el = document.getElementById(`sec-${id}`)
        if (el) sc.scrollBy({ top: el.getBoundingClientRect().top - 140 })
      }
    })
  })

  // Charts (ECharts listens to window resize) need a nudge when un-hidden.
  useEffect(() => {
    if (layout !== 'focus') return
    const r = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(r)
  }, [pageIdx, layout])

  const step = useCallback((d: 1 | -1) => {
    if (!pages.length) return
    goPage(pageIdx < 0 ? 0 : (pageIdx + d + pages.length) % pages.length)
  }, [pages, pageIdx, goPage])

  // J/K and ←/→ in focus layout page between groups
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

  // ── Scroll-spy: which visible section is under the header ────────────────
  const [spyId, setSpyId] = useState<string | null>(null)
  useEffect(() => {
    const sc = scroller.current
    if (!sc) return
    const onScroll = () => {
      let cur: string | null = null
      for (const el of document.querySelectorAll<HTMLElement>('[data-ws-id]')) {
        if (el.style.display === 'none') continue
        if (el.getBoundingClientRect().top < 200) cur = el.dataset.wsId ?? cur
      }
      setSpyId(cur)
    }
    onScroll()
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [layout, scroller, registered, pageIdx])
  useEffect(() => {
    if (layout === 'scroll' && spyId) onActive(spyId)
  }, [layout, spyId, onActive])

  const highlighted = spyId && (layout === 'scroll' || page?.items.some(e => e.id === spyId)) ? spyId : activeId
  const narrow = useMediaQuery('(max-width: 900px)')

  const focusSection = useCallback((id: string) => { onActive(id); pendingScroll.current = id }, [onActive])
  const titleFor = useCallback((id: string) => entries.find(e => e.id === id)?.title, [entries])
  const orderFor = useCallback((id: string) => { const i = entries.findIndex(e => e.id === id); return i < 0 ? 999 : i }, [entries])
  const ctx: WorkspaceCtx = useMemo(() => ({
    enabled: true, layout, visibleIds, titleFor, orderFor, heroSlot, register, unregister, setSubTabs, focusSection,
  }), [layout, visibleIds, titleFor, orderFor, heroSlot, register, unregister, setSubTabs, focusSection])

  const nextPage = pages.length > 1 && pageIdx >= 0 ? pages[(pageIdx + 1) % pages.length] : undefined
  const prevPage = pages.length > 1 && pageIdx >= 0 ? pages[(pageIdx - 1 + pages.length) % pages.length] : undefined

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
          ? <RailSelect entries={entries.filter(e => e.inScope)} activeId={highlighted} onSelect={select} />
          : <Rail entries={entries} activeId={highlighted} activeGroup={layout === 'focus' ? page?.group : undefined}
              onSelect={select} onGroup={g => { const i = pages.findIndex(p => p.group === g); if (i >= 0) goPage(i) }}
              layout={layout} onLayout={onLayout} railValues={railValues} onOpenFind={onOpenFind}
              subDefs={subDefs} currentSub={subTabs?.current} subBadges={subTabs?.badges} onSub={selectSub} />}

        <div ref={mainColRef} style={{ display: 'flex', flexDirection: 'column', gap: layout === 'focus' ? 48 : 64, minWidth: 0 }}>
          {layout === 'focus' && page && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingBottom: 16, borderBottom: '2px solid var(--fd-rule)', marginBottom: -16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ ...mono, ...muted }}>
                  {String(pageIdx + 1).padStart(2, '0')} / {String(pages.length).padStart(2, '0')}{subDefs && subTabs ? ` · ${subDefs.find(sd => sd.id === subTabs.current)?.label ?? ''}` : ''}
                </span>
                <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.1 }}>{page.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {prevPage && <PagerButton onClick={() => step(-1)}>← {prevPage.label}</PagerButton>}
                {nextPage && <PagerButton strong onClick={() => step(1)}>{nextPage.label} →</PagerButton>}
              </div>
            </div>
          )}

          {children}

          {layout === 'focus' && nextPage && (
            <button className="fd-ws-next" onClick={() => step(1)} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, width: '100%',
              padding: '24px 0', border: 'none', borderTop: '2px solid var(--fd-rule)', background: 'transparent',
              color: 'var(--fd-ink)', cursor: 'pointer', textAlign: 'left',
            }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <span style={{ ...mono, ...muted }}>Next page</span>
                <span className="fd-ws-title" style={{ fontSize: 20, fontWeight: 500 }}>{nextPage.label}</span>
                <span style={{ fontSize: 13, ...muted }}>{nextPage.items.map(e => e.title).join(' · ')}</span>
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

function Rail({ entries, activeId, activeGroup, onSelect, onGroup, layout, onLayout, railValues, onOpenFind, subDefs, currentSub, subBadges, onSub }: {
  entries: RailEntry[]; activeId: string | null; activeGroup?: string; onSelect: (e: RailEntry) => void; onGroup: (group: string) => void
  layout: AdvLayout; onLayout: (l: AdvLayout) => void; railValues: boolean; onOpenFind: (q?: string) => void
  subDefs?: SubTabMeta[]; currentSub?: string; subBadges?: Record<string, string | number | undefined>; onSub: (id: string) => void
}) {
  const [filter, setFilter] = useState('')
  const filtering = !!filter.trim()
  // Unfiltered: only the current sub-tab. Filtering searches the whole tab and
  // labels hits that live on another sub-tab.
  // Sections that rendered nothing are left out; ones that need an input
  // (e.g. a Research symbol) stay, dimmed.
  const scope = entries.filter(e => e.inScope && !e.empty && (e.mounted || !e.reachable))
  const shown = matchSections(filtering ? entries.filter(e => !e.empty && (e.mounted || e.reachable || e.inScope)) : scope, filter)
  const total = scope.length
  return (
    <nav aria-label="On this tab" style={{
      position: 'sticky', top: HEADER_OFFSET, maxHeight: `calc(100vh - ${HEADER_OFFSET + 24}px)`,
      display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
    }}>
      {subDefs && subDefs.length > 0 && (
        <div role="tablist" aria-label="View" style={{ display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--fd-rule)', flexShrink: 0 }}>
          {subDefs.map((sd, i) => {
            const on = sd.id === currentSub
            const n = entries.filter(e => e.sub === sd.id && (e.mounted || e.sub !== currentSub)).length
            return (
              <button key={sd.id} role="tab" aria-selected={on} className={on ? undefined : 'fd-ws-row'} onClick={() => onSub(sd.id)} style={{
                display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) auto', gap: 8, alignItems: 'baseline',
                padding: '7px 10px', margin: '0 -10px', border: 'none', borderBottom: '1px solid var(--fd-hairline)',
                background: on ? 'var(--fd-ink)' : 'transparent', color: on ? 'var(--fd-page)' : 'var(--fd-ink)', textAlign: 'left', cursor: 'pointer',
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.64 }}>{String(i + 1).padStart(2, '0')}</span>
                <span className="fd-ws-title" style={{ fontSize: 14, fontWeight: on ? 500 : 400 }}>
                  {sd.label}{subBadges?.[sd.id] ? <span style={{ fontWeight: 500 }}> · {subBadges[sd.id]}</span> : null}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.64 }}>{n}</span>
              </button>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 500 }}>{subDefs ? subDefs.find(sd => sd.id === currentSub)?.label ?? 'On this tab' : 'On this tab'}</span>
        <span style={{ ...mono, ...muted }}>{filtering ? `${shown.length} match${shown.length === 1 ? '' : 'es'}` : `${total} sections`}</span>
      </div>
      <input
        className="fd-ws-filter" value={filter} onChange={e => setFilter(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setFilter('')
          if (e.key === 'Enter' && shown[0]?.reachable) onSelect(shown[0])
        }}
        placeholder={subDefs ? 'Filter this tab' : `Filter ${total} sections and metrics`} aria-label="Filter sections and metrics"
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
        {groupBy(shown.map(e => ({ ...e, key: e.group, group: filtering && !e.inScope ? (e.subLabel ?? e.group) : e.groupLabel }))).map(([group, rows]) => {
          const pageOn = !filtering && activeGroup != null && rows[0]?.key === activeGroup
          const canOpen = !filtering && rows.some(r => r.mounted)
          return (
            <div key={group} style={{ borderTop: '2px solid var(--fd-rule)', display: 'flex', flexDirection: 'column' }}>
              {/* Group = one page in focus layout */}
              <button className={canOpen ? 'fd-ws-row' : undefined} disabled={!canOpen} onClick={() => onGroup(rows[0].key)} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '10px 0 6px',
                border: 'none', background: 'transparent', color: pageOn ? 'var(--fd-ink)' : 'var(--fd-muted)', cursor: canOpen ? 'pointer' : 'default', textAlign: 'left',
              }}>
                <span className="fd-ws-title" style={{ ...mono, fontWeight: pageOn ? 500 : 400 }}>{pageOn ? '▸ ' : ''}{group}</span>
                <span style={{ ...mono, fontSize: 11, opacity: 0.64 }}>{rows.length}</span>
              </button>
              {rows.map(e => <RailRow key={e.id} e={e} on={e.id === activeId} onSelect={onSelect} railValues={railValues} />)}
            </div>
          )
        })}
      </div>
      <div style={{ borderTop: '1px solid var(--fd-hairline)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Segmented size="sm" mono value={layout} onChange={onLayout} options={[{ id: 'focus', label: 'Focus' }, { id: 'scroll', label: 'Scroll' }]} />
        <span style={{ ...mono, ...muted, fontSize: 11 }}>
          {layout === 'focus' ? 'One page per group · J / K next page · ⌘K find' : 'Click to jump · ⌘K find anywhere'}
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
      data-rail-id={e.id}
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
        {!e.inScope && e.subLabel && <span style={{ fontSize: 12, opacity: 0.72 }}>Opens {e.subLabel} →</span>}
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
