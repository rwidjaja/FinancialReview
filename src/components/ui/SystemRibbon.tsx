/**
 * SystemRibbon — retired in v4 (AppHeader carries the global status).
 * Interim shim while tabs are ported: renders only the `right` slot (e.g. a
 * period selector) so those controls stay reachable. Remove each usage as its
 * tab moves to the PageHero pattern.
 */
import type { ReactNode } from 'react'
import type { DashboardData } from '../../types/dashboard'

interface Props {
  data: DashboardData
  right?: ReactNode
  title?: string
  variant?: 'classic' | 'minimal'
}

export function SystemRibbon({ right }: Props) {
  if (!right) return null
  return <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '16px 0 0' }}>{right}</div>
}
