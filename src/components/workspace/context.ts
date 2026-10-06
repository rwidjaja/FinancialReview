/**
 * Advanced workspace plumbing (design_handoff_advanced_workspace).
 *
 * Tabs keep rendering exactly as before; each top-level block is wrapped in
 * <WsSection id="…">. In Simple mode the wrapper is `display: contents` (no
 * layout effect at all). Inside <AdvancedWorkspace> it registers itself so the
 * "On this tab" rail, the focus pager and Find can address it, and in focus
 * layout every section except the active one is hidden with `display: none`.
 *
 * Nothing is unmounted when hidden, so tab-local state (inputs, selected
 * symbol, toggles, fetched data) survives paging between sections.
 */
import { createContext, useContext, useLayoutEffect } from 'react'
import type { Status } from '../ui/primitives'

export type AdvLayout = 'focus' | 'scroll'

export interface SectionInfo {
  value?: string
  status?: Status
  /** Only for sections that are not in the static registry. */
  title?: string
  group?: string
  /** The section rendered nothing (e.g. a block that only shows in some months). */
  empty?: boolean
}

/** A tab's sub-tab state; `badges` carry counts the in-page bar showed (e.g. open orders). */
export interface SubTabState { current: string; set: (sub: string) => void; badges?: Record<string, string | number | undefined> }

export interface WorkspaceCtx {
  enabled: boolean
  layout: AdvLayout
  /** Section ids shown in focus layout — the current page (group). null = show all. */
  visibleIds: Set<string> | null
  /** Rail title for a section, so a section without its own heading can show one. */
  titleFor: (id: string) => string | undefined
  /** Rail position, used as CSS `order` so a page reads in the rail's order. */
  orderFor: (id: string) => number
  /** Compact hero band target (PageHero / KpiStrip portal into it). */
  heroSlot: HTMLElement | null
  register: (id: string, info: SectionInfo) => void
  unregister: (id: string) => void
  /** Tabs with internal sub-tabs expose their switcher so the rail can fold them in. */
  setSubTabs: (s: SubTabState | null) => void
  /** Jump to a section (e.g. one a button just revealed). */
  focusSection: (id: string) => void
}

const noop = () => {}
export const WorkspaceContext = createContext<WorkspaceCtx>({
  enabled: false, layout: 'focus', visibleIds: null, titleFor: () => undefined, orderFor: () => 0, heroSlot: null,
  register: noop, unregister: noop, setSubTabs: noop, focusSection: noop,
})

/** True for descendants of a <WsSection> — PageHero/KpiStrip stay inline there. */
export const InsideSectionContext = createContext(false)

export function useWorkspace() {
  return useContext(WorkspaceContext)
}

/** Register a tab's sub-tab state with the workspace (no-op in Simple mode). */
export function useWsSubTabs(current: string, set: (sub: string) => void, badges?: Record<string, string | number | undefined>) {
  const { enabled, setSubTabs } = useContext(WorkspaceContext)
  const badgeKey = badges ? JSON.stringify(badges) : ''
  useLayoutEffect(() => {
    if (!enabled) return
    setSubTabs({ current, set: set as (sub: string) => void, badges: badgeKey ? JSON.parse(badgeKey) : undefined })
  }, [enabled, setSubTabs, current, set, badgeKey])
  useLayoutEffect(() => {
    if (!enabled) return
    return () => setSubTabs(null)
  }, [enabled, setSubTabs])
}
