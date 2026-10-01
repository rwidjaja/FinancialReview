/**
 * Recharts theme — replaces ui/chartTooltip.ts and the per-chart axis props
 * in DESIGN_GUIDE.md. No gradients (brand rule): areas use flat fills.
 */
export const CHART = {
  series: ['var(--fd-accent)', 'var(--as-lilac)', 'var(--as-lime)', 'var(--fd-muted)'], // primary, comparison, third, neutral
  positive: 'var(--fd-accent)',
  negative: 'var(--fd-negative)',
  grid: 'var(--fd-hairline)',
  axisTick: { fontSize: 12, fill: 'var(--fd-muted)', fontFamily: 'var(--font-mono)' },
}

export const TOOLTIP_CONTENT_STYLE = {
  background: 'var(--fd-page)',
  border: '1px solid var(--fd-rule)',
  borderRadius: 0,
  padding: '10px 12px',
  boxShadow: 'none',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
}
export const TOOLTIP_LABEL_RECHARTS = { fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase' as const, color: 'var(--fd-muted)', marginBottom: 4 }
export const TOOLTIP_ITEM_RECHARTS = { color: 'var(--fd-ink)', padding: 0 }
export const TOOLTIP_CURSOR = { fill: 'var(--fd-hairline)' }

/** Standard axis props — spread onto <XAxis>/<YAxis>. */
export const AXIS = { tick: CHART.axisTick, axisLine: false, tickLine: false } as const

/** Bars: square tops (radius 0), opacity 1. Lines: strokeWidth 3, no dots. */
export const BAR_PROPS = { radius: [0, 0, 0, 0] as [number, number, number, number] }
export const LINE_PROPS = { strokeWidth: 3, dot: false, type: 'monotone' as const }
