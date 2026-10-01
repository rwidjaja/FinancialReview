/**
 * ModeToggle — canonical Simple/Advanced toggle used by all tabs.
 * Replaces the locally-defined ModeBtn in Summary, Detail, Tax, Spending,
 * Performance, Intelligence, and Predictions.
 */

export type ViewMode = 'simple' | 'advanced'

import { createContext, useContext } from 'react'

/**
 * Global Simple/Advanced mode (DESIGN_GUIDE v4). The toggle lives in AppHeader;
 * App.tsx owns the state (persisted to localStorage `viewMode:global`) and
 * provides it here. Per-tab modes are gone.
 */
export const ViewModeContext = createContext<[ViewMode, (m: ViewMode) => void]>(['simple', () => {}])

export function useGlobalViewMode(): [ViewMode, (m: ViewMode) => void] {
  return useContext(ViewModeContext)
}

/** @deprecated per-tab key is ignored — reads the global mode. Use useGlobalViewMode(). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useViewMode(_tabKey?: string): [ViewMode, (m: ViewMode) => void] {
  return useContext(ViewModeContext)
}

/** @deprecated The toggle is global (AppHeader). Renders nothing. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ModeToggle(_props: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return null
}
