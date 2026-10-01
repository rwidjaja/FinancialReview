/** Settings panel heading (v4): mono caps label over a 2px ink rule. */
export function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase',
      color: 'var(--fd-ink)', margin: '8px 0 12px', borderTop: '2px solid var(--fd-rule)', paddingTop: 12 }}>
      {children}
    </div>
  )
}
