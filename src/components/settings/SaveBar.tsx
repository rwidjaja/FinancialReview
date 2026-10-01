/** Sticky save bar (v4): primary Cobalt button + status text. Every save writes a timestamped .bak server-side. */
export function SaveBar({ onSave, saving, saved, error }: {
  onSave: () => void; saving: boolean; saved: boolean; error?: string
}) {
  return (
    <div style={{
      position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 16,
      marginTop: 24, padding: '16px 0', background: 'var(--fd-page)', borderTop: '1px solid var(--fd-hairline)',
    }}>
      <button onClick={onSave} disabled={saving} className="fd-primary" style={{
        height: 40, padding: '0 20px', background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none',
        fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase',
        cursor: saving ? 'not-allowed' : 'pointer',
      }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && !error && <span style={{ fontSize: 14 }}><span style={{ fontFamily: 'var(--font-mono)' }}>✓</span> Saved · backup written</span>}
      {error && <span style={{ fontSize: 14, color: 'var(--fd-negative)' }}><span style={{ fontFamily: 'var(--font-mono)' }}>✗</span> {error}</span>}
      <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--fd-muted)' }}>Every save writes a timestamped .bak</span>
    </div>
  )
}
