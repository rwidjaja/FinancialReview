import { M } from './DetailTab.constants'

/** Background fill for a correlation cell — red=high positive, blue=negative, muted=near-zero */
function heatBg(v: number, isDiag: boolean): string {
  if (isDiag) return 'var(--fd-card)'
  if (v >= 0.85) return 'var(--fd-negative)'
  if (v >= 0.70) return 'var(--fd-negative)'
  if (v >= 0.55) return 'var(--as-lilac)'
  if (v >= 0.40) return 'var(--as-lilac)'
  if (v >= 0.20) return 'var(--fd-card)'
  if (v >= 0.0)  return 'var(--fd-card)'
  if (v >= -0.2) return 'var(--fd-card)'
  if (v >= -0.4) return 'var(--fd-accent)'
  return 'var(--fd-accent)'
}

/** Text color that stays readable on the heat background */
function heatText(v: number, isDiag: boolean): string {
  if (isDiag) return 'var(--fd-muted)'
  const abs = Math.abs(v)
  if (abs >= 0.55) return 'var(--fd-muted)'
  if (abs >= 0.30) return 'var(--fd-muted)'
  return 'var(--fd-muted)'
}

export function CorrelationMatrix({ correlation }: { correlation: { symbols: string[]; matrix: number[][] } }) {
  const { symbols, matrix } = correlation

  return (
    <div style={{ overflowX: 'auto', padding: '8px 4px' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 2, width: '100%' }}>
        <thead>
          <tr>
            {/* top-left empty corner */}
            <th style={{ width: 52 }} />
            {symbols.map(s => (
              <th key={s} style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                color: 'var(--fd-muted)', textAlign: 'center',
                paddingBottom: 4, whiteSpace: 'nowrap',
              }}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((rowSym, ri) => (
            <tr key={rowSym}>
              {/* row label */}
              <td style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                color: 'var(--fd-muted)', paddingRight: 6, textAlign: 'right',
                whiteSpace: 'nowrap',
              }}>
                {rowSym}
              </td>
              {symbols.map((_, ci) => {
                const v = matrix[ri]?.[ci] ?? 0
                const isDiag = ri === ci
                const abs = Math.abs(v)
                return (
                  <td key={ci} style={{
                    background: heatBg(v, isDiag),
                    borderRadius: 0,
                    textAlign: 'center',
                    padding: '5px 4px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    fontWeight: abs >= 0.6 ? 700 : 400,
                    color: heatText(v, isDiag),
                    minWidth: 44,
                    transition: 'opacity 0.15s',
                    cursor: 'default',
                  }}>
                    {isDiag ? '—' : v.toFixed(2)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Legend */}
      <div style={{
        marginTop: 10, display: 'flex', alignItems: 'center',
        gap: 0, fontSize: 12, color: M,
      }}>
        <span style={{ marginRight: 6, color: 'var(--fd-muted)', fontWeight: 500 }}>CORR</span>
        {/* gradient bar */}
        <div style={{
          width: 160, height: 8, borderRadius: 0,
          background: 'var(--fd-accent)',
          flexShrink: 0,
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', width: 160, marginLeft: -160 + 0, position: 'relative' }}>
        </div>
        <div style={{ display: 'flex', gap: 10, marginLeft: 8 }}>
          <span style={{ color: 'var(--fd-accent)' }}>−1 neg</span>
          <span style={{ color: 'var(--fd-muted)' }}>0 none</span>
          <span style={{ color: 'var(--fd-ink)' }}>+1 high</span>
        </div>
      </div>
    </div>
  )
}
