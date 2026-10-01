import { fmtMoneyFull } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import { G, R, M, Y, A } from './taxColors'

// ── V3 New Components ──────────────────────────────────────────────────────────

export function BracketMeter({ pressurePct, convRoom, bktColor, ceilGross, grossActual, targetBracketRate, stdDeduction }: {
  pressurePct: number
  convRoom: number | null | undefined
  bktColor: string
  ceilGross: number | null | undefined
  /** gross_actual = divs + ytd-only conversions + STCG — no plan-target inflation */
  grossActual: number | null | undefined
  targetBracketRate?: number | null
  stdDeduction?: number | null
}) {
  // Use gross_actual (not gross_no_ss) so the room figure matches the taxable-basis
  // pressure percentage bar. gross_no_ss inflates by the unexecuted plan target.
  const displayRoom = ceilGross != null && grossActual != null
    ? Math.max(0, ceilGross - grossActual)
    : (convRoom ?? 0)

  const tiers = [
    { key: 'safe',     label: 'SAFE',    max: 40,  color: G },
    { key: 'moderate', label: 'MODERATE',max: 70,  color: Y },
    { key: 'high',     label: 'HIGH',    max: 90,  color: A },
    { key: 'at-limit', label: 'AT LIMIT',max: 9999,color: R },
  ]
  const activeIdx = tiers.findIndex(t => pressurePct < t.max)
  const roomColor = displayRoom > 20000 ? G : displayRoom > 5000 ? Y : R

  return (
    <div style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${bktColor}`, borderRadius: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px' }}>◈ {targetBracketRate ?? DEFAULT_BRACKET_RATE}% BRACKET METER</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: bktColor, fontFamily: 'var(--font-mono)' }}>
          {pressurePct.toFixed(1)}% — taxable income (actual) vs taxable ceiling
        </span>
      </div>
      <div style={{ display: 'flex', gap: 2, marginBottom: 6 }}>
        {tiers.map((t, i) => (
          <div key={t.key} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{
              height: 8, borderRadius: 0,
              background: i <= activeIdx ? t.color : 'var(--surface-3)',
              opacity: i === activeIdx ? 1 : i < activeIdx ? 0.45 : 0.18,
            }} />
            <div style={{ fontSize: 12, marginTop: 2, fontWeight: i === activeIdx ? 700 : 400, color: i === activeIdx ? t.color : M }}>
              {t.label}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
        {grossActual != null && ceilGross != null && (
          <span style={{ color: M }}>Gross income (actual, excl. SS): <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(grossActual)}</span></span>
        )}
        {ceilGross != null && (
          <span style={{ color: M }}>
            Gross ceiling: <span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(ceilGross)}</span>
            {stdDeduction != null && (
              <span style={{ color: M, marginLeft: 6 }}>
                (taxable <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(ceilGross - stdDeduction)}</span>
                {' + '}std ded <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(stdDeduction)}</span>)
              </span>
            )}
          </span>
        )}
        {displayRoom !== 0 && (
          <span style={{ color: M }}>
            Conv Room (actual basis): <span style={{ color: roomColor, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(displayRoom)}</span>
          </span>
        )}
      </div>
    </div>
  )
}
