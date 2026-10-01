/**
 * SectionHeader — v4: Inter 24/500 title with a mono meta line on the right.
 * Same API as v3.
 */
import type { ReactNode } from 'react'

interface Props {
  title: string
  /** Right-aligned content, e.g. count or "View all →" */
  right?: ReactNode
  /** Short description, shown as the mono meta line */
  hint?: string
}

export function SectionHeader({ title, right, hint }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, margin: '8px 0 16px' }}>
      <h2 style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>{title}</h2>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 }}>
        {hint && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--fd-muted)' }}>{hint}</span>}
        {right}
      </div>
    </div>
  )
}
