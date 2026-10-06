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
}

export interface WorkspaceCtx {
  enabled: boolean
  layout: AdvLayout
  /** Effective section shown in focus layout (null = none registered yet). */
  activeId: string | null
  /** Compact hero band target (PageHero / KpiStrip portal into it). */
  heroSlot: HTMLElement | null
  register: (id: string, info: SectionInfo) => void
  unregister: (id: string) => void
  /** Tabs with internal sub-tabs expose their switcher so the rail can fold them in. */
  setSubTabs: (s: { current: string; set: (sub: string) => void } | null) => void
  /** Jump to a section (e.g. one a button just revealed). */
  focusSection: (id: string) => void
}

const noop = () => {}
export const WorkspaceContext = createContext<WorkspaceCtx>({
  enabled: false, layout: 'focus', activeId: null, heroSlot: null,
  register: noop, unregister: noop, setSubTabs: noop, focusSection: noop,
})

/** True for descendants of a <WsSection> — PageHero/KpiStrip stay inline there. */
export const InsideSectionContext = createContext(false)

export function useWorkspace() {
  return useContext(WorkspaceContext)
}

/** Register a tab's sub-tab state with the workspace (no-op in Simple mode). */
export function useWsSubTabs(current: string, set: (sub: string) => void) {
  const { enabled, setSubTabs } = useContext(WorkspaceContext)
  useLayoutEffect(() => {
    if (!enabled) return
    setSubTabs({ current, set: set as (sub: string) => void })
  }, [enabled, setSubTabs, current, set])
  useLayoutEffect(() => {
    if (!enabled) return
    return () => setSubTabs(null)
  }, [enabled, setSubTabs])
}
