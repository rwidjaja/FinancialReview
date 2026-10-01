/**
 * SubTabBtn — numbered section navigation ("01 Tax planning"), v4: a segment
 * of a Segmented control (ink fill when active, square, 40px). Wrap a row of
 * these in <SubTabBar> for the 1px ink frame.
 */
import type { ReactNode } from 'react'

export function SubTabBtn({ label, index, active, onClick }: {
  label: string; index: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        height: 40, padding: '0 16px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 6,
        paddingTop: 12, whiteSpace: 'nowrap', fontSize: 14, fontWeight: 500,
        background: active ? 'var(--fd-ink)' : 'transparent', color: active ? 'var(--fd-page)' : 'var(--fd-ink)',
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.64 }}>{String(index).padStart(2, '0')}</span>
      {label}
    </button>
  )
}

export function SubTabBar({ children }: { children: ReactNode }) {
  return <div role="tablist" style={{ display: 'inline-flex', border: '1px solid var(--fd-rule)', flexWrap: 'wrap' }}>{children}</div>
}
