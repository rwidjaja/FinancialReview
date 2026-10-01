/**
 * Legacy chart tooltip exports — now re-pointed at the AtScale chart theme
 * (chartTheme.ts). New code should import from './chartTheme' directly.
 */
import type { CSSProperties } from 'react'
export { TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS, TOOLTIP_CURSOR } from './chartTheme'

/** Root container for hand-written tooltip components */
export const TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--fd-page)',
  border: '1px solid var(--fd-rule)',
  borderRadius: 0,
  padding: '10px 12px',
  boxShadow: 'none',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  minWidth: 140,
  color: 'var(--fd-ink)',
}

/** Label row inside a hand-written tooltip component */
export const TOOLTIP_LABEL_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: 'var(--fd-muted)',
  marginBottom: 4,
}
