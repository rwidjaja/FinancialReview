/**
 * IncomeBanner — income panel shown at the top of every tab.
 *
 * Layout (2 columns):
 *   LEFT:  aligned income table (SOURCE | YTD | TARGET | PROGRESS | % DONE | TAX CLASS)
 *   RIGHT: [donut + proj annual] / [tax bracket] / [dynamic notes]
 */
import { PieChart, Pie, Cell, Tooltip, Sector } from 'recharts'
import { TOOLTIP_STYLE } from './chartTooltip'
import type { DashboardData, IncomeSummary } from '../../types/dashboard'
import { fmtMoneyFull, fmtMoney } from '../../utils/formatters'

const G = 'var(--green)'
const M = 'var(--text2)'
const R = 'var(--red)'
const A = 'var(--amber)'

const BUCKET_COLOR: Record<string, string> = {
  w2:         'var(--fd-accent)',
  taxable:    'var(--as-lilac)',
  roth:       'var(--fd-accent)',
  roth_ira:   'var(--as-lilac)',
  rollover:   '#2dd4bf',
  ira:        '#7dd3fc',
  '401k':     'var(--as-lilac)',
  conversion: 'var(--as-lilac)',
}
const bucketColor = (k: string) => BUCKET_COLOR[k] ?? 'var(--fd-hairline)'

const ACCT_LABEL: Record<string, string> = {
  taxable: 'Taxable', roth: 'Roth', rollover: 'Rollover',
  ira: 'IRA', roth_ira: 'Roth IRA', '401k': '401k',
}
const acctLabel = (k: string) =>
  ACCT_LABEL[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const ACCT_ORDER = ['taxable', 'roth', 'rollover', 'roth_ira', 'ira', '401k']
const sortAccts = (keys: string[]) =>
  [...keys].sort((a, b) => (ACCT_ORDER.indexOf(a) + 1 || 99) - (ACCT_ORDER.indexOf(b) + 1 || 99))

const TAX_TAG: Record<string, string> = {
  w2: 'EARNED', taxable: 'TAXABLE', roth: 'TAX-FREE', roth_ira: 'TAX-FREE',
  rollover: 'DEFERRED', ira: 'DEFERRED', '401k': 'DEFERRED', conversion: 'TAX EVENT',
}

// Grid template — shared by header + every data row for pixel-perfect alignment
// dot(8) | source(152) | ytd(82) | arrow(10) | target(82) | bar(90) | %(38) | tag(72)
const COL = '8px 152px 82px 10px 82px 90px 38px 72px'

function DonutTooltip({ active, payload }: {
  active?: boolean
  payload?: { name: string; value: number; payload: { color: string } }[]
}) {
  if (!active || !payload?.length) return null
  const { name, value, payload: p } = payload[0]
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '8px 12px', minWidth: 130, whiteSpace: 'nowrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 0, background: p.color, flexShrink: 0 }} />
        <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 500 }}>{name}</span>
      </div>
      <div style={{ color: 'var(--green)', fontWeight: 500, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
        {fmtMoneyFull(value)}
      </div>
    </div>
  )
}

export function IncomeBanner({ data }: { data: DashboardData }) {
  const is: IncomeSummary | null = data.income_summary
  if (!is) return null

  const td                  = data.tax_data
  const marginalRate        = td?.marginal_rate
  const targetBracketRate   = td?.target_bracket_rate
  const incomeBracketTarget = td?.income_bracket_target

  const hasW2         = is.actual_w2 > 0 || is.full_year_w2 > 0
  const hasConversion = is.full_year_conversion > 0
  // Only include accounts that have an active forward projection.
  // Accounts that appear only in actual_div_by_acct (closed positions, stray lots)
  // have fwd_12m = 0 and would inflate the YTD total without a matching target.
  const acctKeys      = sortAccts(
    Object.keys(is.full_year_div_by_acct).filter(k => (is.full_year_div_by_acct[k] ?? 0) > 0)
  )

  const rows: { key: string; label: string; tag: string; ytd: number; proj: number }[] = [
    ...(hasW2 ? [{ key: 'w2', label: 'W2 SALARY', tag: 'EARNED', ytd: is.actual_w2, proj: is.full_year_w2 }] : []),
    ...acctKeys.map(k => ({
      key: k,
      label: `DIV – ${acctLabel(k).toUpperCase()}`,
      tag: TAX_TAG[k] ?? 'PASSIVE',
      ytd: is.actual_div_by_acct[k] ?? 0,
      proj: is.full_year_div_by_acct[k] ?? 0,
    })),
    ...(hasConversion ? [{ key: 'conversion', label: 'ROTH CONVERSION', tag: 'TAX EVENT', ytd: is.actual_conversion, proj: is.full_year_conversion }] : []),
  ]

  const pieData = rows.filter(r => r.proj > 0)
    .map(r => ({ name: r.label, value: r.proj, color: bucketColor(r.key) }))

  // Row-derived totals — authoritative sums that match exactly what the table shows.
  // Both sum raw dollars (stray/closed accounts already excluded by acctKeys filter) —
  // rows display via fmtMoneyFull (full dollars), so the total must too, or it drifts
  // from the sum of the visible line items (was K-rounding each row before summing,
  // which no longer matches the unrounded per-row display).
  const ytdRowTotal    = rows.reduce((s, r) => s + r.ytd, 0)
  const annualRowTotal = rows.reduce((s, r) => s + r.proj, 0)

  // Bracket headroom must compare taxable income vs taxable ceiling — NOT gross vs gross ceiling.
  // Use taxable_actual (divs_AGI + ytd_converted + STCG − std_deduction): only actual executed
  // conversions, no plan-target inflation. Compare to taxable bracket ceiling (gross ceil − std ded).
  // This prevents the plan target ($400k) from making it look like the bracket is already full
  // when only $116k was actually converted.
  const stdDed_ib   = td?.std_deduction ?? 0
  const ordinaryAgi = td?.taxable_actual
    ?? Math.max(0, (td?.gross_no_ss ?? annualRowTotal) - stdDed_ib)
  const grossCeiling_ib = td?.target_bracket_ceiling ?? incomeBracketTarget
  const roomCeiling = grossCeiling_ib != null ? grossCeiling_ib - stdDed_ib : null
  const projRoom    = roomCeiling != null ? roomCeiling - ordinaryAgi : null
  const overCeiling = projRoom != null && projRoom < 0
  const roomColor   = projRoom == null ? M : overCeiling ? R : projRoom < 20_000 ? A : G
  const bracketLabel = targetBracketRate != null ? `${targetBracketRate}%`
    : marginalRate != null ? `${(marginalRate * 100).toFixed(0)}%` : '—'

  const totalPctDone = annualRowTotal > 0 ? (ytdRowTotal / annualRowTotal) * 100 : null

  // ── Dynamic note chips shown inline in the title bar ─────────────────────
  const noteChips: { text: string; color: string; bg: string }[] = []

  noteChips.push({ text: '% DONE = YTD ÷ annual target', color: M, bg: 'var(--fd-hairline)' })

  const overRows = rows.filter(r => r.proj > 0 && r.ytd > r.proj)
  for (const r of overRows) {
    const pct = Math.round(r.ytd / r.proj * 100)
    noteChips.push({ text: `${r.label} at ${pct}% — target exceeded`, color: R, bg: 'var(--fd-card)' })
  }

  noteChips.push({ text: 'Bracket uses projected annual, not YTD', color: M, bg: 'var(--fd-hairline)' })

  if (projRoom != null) {
    if (!overCeiling) {
      noteChips.push({
        text: `Inside ${bracketLabel} bracket · ${fmtMoneyFull(projRoom)} to ceiling`,
        color: projRoom < 20_000 ? A : G,
        bg: projRoom < 20_000 ? 'var(--fd-card)' : 'var(--fd-card)',
      })
    } else {
      noteChips.push({
        text: ` Projected income exceeds ${bracketLabel} ceiling by ${fmtMoneyFull(Math.abs(projRoom))}`,
        color: R,
        bg: 'var(--fd-card)',
      })
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

      {/* Title + notes (v4: SectionTitle + muted note line) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '2px solid var(--fd-rule)', paddingBottom: 12 }}>
        <h2 style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>Income summary</h2>
        {noteChips.length > 0 && (
          <span style={{ fontSize: 13, color: 'var(--fd-muted)' }}>{noteChips.map(c => c.text).join(' · ')}</span>
        )}
      </div>

      {/* Body: responsive columns - changed from fixed widths to flex with wrapping */}
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap', // Allow wrapping on smaller screens
        gap: 0, 
        alignItems: 'stretch' 
      }}>

        {/* ══ LEFT: Income table ══════════════════════════════════════ */}
        <div style={{ flex: '1 1 560px', padding: '0 24px 0 0', minWidth: 0, overflowX: 'auto' }}>

          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: COL, gap: '0 8px', alignItems: 'center',
            marginBottom: 6, paddingBottom: 5, borderBottom: '1px solid var(--border2)',
          }}>
            <div />
            <span style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px' }}>SOURCE</span>
            <span style={{ fontSize: 12, color: M, textAlign: 'right' }}>YTD ACTUAL</span>
            <div />
            <span style={{ fontSize: 12, fontWeight: 500, color: M, textAlign: 'right' }}>ANNUAL TARGET</span>
            <span style={{ fontSize: 12, color: M, textAlign: 'center' }}>PROGRESS</span>
            <span style={{ fontSize: 12, color: M, textAlign: 'right' }}>% DONE</span>
            <span style={{ fontSize: 12, color: M, textAlign: 'center' }}>TAX CLASS</span>
          </div>

          {/* Data rows */}
          {rows.map(row => {
            const color = bucketColor(row.key)
            const pct   = row.proj > 0 ? (row.ytd / row.proj) * 100 : null
            const barW  = row.proj > 0 ? Math.min(100, (row.ytd / row.proj) * 100) : 0
            const over  = pct != null && pct > 100
            const pctColor = pct == null ? M : over ? R : pct >= 85 ? A : M

            return (
              <div key={row.key} style={{
                display: 'grid', gridTemplateColumns: COL, gap: '0 8px',
                alignItems: 'center', marginBottom: 5, padding: '1px 0',
              }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: color, justifySelf: 'center' }} />

                <span style={{
                  fontSize: 12, fontWeight: 500, color: 'var(--text)',
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.3px',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {row.label}
                </span>

                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: row.ytd > 0 ? 'var(--text)' : M, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {row.ytd > 0 ? fmtMoneyFull(row.ytd) : '—'}
                </span>

                <span style={{ fontSize: 12, color: M, textAlign: 'center' }}>→</span>

                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: row.proj > 0 ? 'var(--text)' : M, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {row.proj > 0 ? fmtMoneyFull(row.proj) : '—'}
                </span>

                <div style={{ height: 5, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
                  <div style={{ width: `${barW}%`, height: '100%', background: over ? R : color, borderRadius: 0, opacity: 0.85 }} />
                </div>

                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right',
                  color: pctColor, fontWeight: over ? 700 : 400, whiteSpace: 'nowrap',
                }}>
                  {pct == null
                    ? (row.proj === 0 && row.ytd > 0 ? 'N/A' : '—')
                    : over ? `${pct.toFixed(0)}%↑` : `${pct.toFixed(0)}%`}
                </span>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <span style={{
                    fontSize: 12, color, border: `1px solid ${color}`,
                    padding: '1px 5px', letterSpacing: '0.3px',
                    background: `${color}18`, whiteSpace: 'nowrap',
                  }}>
                    {row.tag}
                  </span>
                </div>
              </div>
            )
          })}

          {/* Total row */}
          <div style={{
            display: 'grid', gridTemplateColumns: COL, gap: '0 8px',
            alignItems: 'center', paddingTop: 7, marginTop: 3,
            borderTop: '1px solid var(--border2)',
          }}>
            <div />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PROJECTED GROSS</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: G, textAlign: 'right' }}>
              {fmtMoneyFull(ytdRowTotal)}
            </span>
            <span style={{ fontSize: 12, color: M, textAlign: 'center' }}>→</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', textAlign: 'right' }}>
              {fmtMoneyFull(annualRowTotal)}
            </span>
            <div style={{ gridColumn: '6 / -1', display: 'flex', alignItems: 'center', gap: 6 }}>
              {totalPctDone != null && (
                <>
                  <div style={{ flex: 1, height: 5, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, totalPctDone)}%`, height: '100%', background: G, borderRadius: 0, opacity: 0.7 }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: G, whiteSpace: 'nowrap' }}>
                    {totalPctDone.toFixed(0)}%
                  </span>
                  <span style={{ fontSize: 12, color: M, whiteSpace: 'nowrap' }}>of annual target</span>
                </>
              )}
            </div>
          </div>

        </div>

        {/* ── Divider ── */}
        <div style={{ width: 1, background: 'var(--border2)', flexShrink: 0, alignSelf: 'stretch' }} />

        {/* ══ CENTER: Donut chart - changed from fixed width to responsive ════════════════════════════ */}
        <div style={{
          flex: '1 1 380px', // Changed from fixed 426px to flexible with min width
          minWidth: 320, // Minimum width before wrapping
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          gap: 20,
          padding: '10px 24px',
        }}>
          {/* Donut */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <PieChart width={160} height={160}>
              <Pie data={pieData} cx={76} cy={76} innerRadius={42} outerRadius={70}
                dataKey="value" strokeWidth={1} stroke="var(--panel)"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                activeShape={(props: any) => (
                  <Sector {...props} outerRadius={props.outerRadius + 4}
                    stroke={props.fill} strokeWidth={2} strokeOpacity={0.6} />
                )}>
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip
                content={<DonutTooltip />}
                wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', outline: 'none' }}
              />
            </PieChart>
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', lineHeight: 1 }}>
                {fmtMoney(annualRowTotal / 1000).replace('$', '')}K
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>gross · pre-deduction</div>
            </div>
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2 }}>
              INCOME MIX (gross · not taxable)
            </div>
            {pieData.map((d, i) => {
              const sharePct = annualRowTotal > 0 ? (d.value / annualRowTotal * 100) : 0
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text3)', flex: 1, whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>{fmtMoneyFull(d.value)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: M, minWidth: 28, textAlign: 'right' }}>({sharePct.toFixed(0)}%)</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Divider ── */}
        <div style={{ width: 1, background: 'var(--border2)', flexShrink: 0, alignSelf: 'stretch' }} />

        {/* ══ RIGHT: Tax Bracket box - changed from fixed width to responsive ═════════════════════════ */}
        {(targetBracketRate != null || incomeBracketTarget != null) && (
          <div style={{
            flex: '1 1 400px', // Changed from fixed 494px to flexible
            minWidth: 280, // Minimum width before wrapping
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'center',
            padding: '14px 28px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 14 }}>
              TAX BRACKET
            </div>

            {/* 2×2 grid of stat tiles */}
            {(() => {
              const stdDed      = td?.std_deduction ?? null
              const grossCeil   = incomeBracketTarget ?? null
              const taxableCeil = grossCeil != null && stdDed != null ? grossCeil - stdDed : null
              const tiles: { label: string; value: string; vc: string; large: boolean; sub?: string }[] = [
                { label: 'Target Bracket',   value: bracketLabel,                 vc: 'var(--text)', large: true  },
                { label: 'Projected Gross',  value: fmtMoneyFull(annualRowTotal), vc: 'var(--text)', large: false },
                {
                  label: `${bracketLabel} Bracket Ceiling`,
                  value: grossCeil != null ? fmtMoneyFull(grossCeil) : '—',
                  vc: M, large: false,
                  sub: taxableCeil != null && stdDed != null
                    ? `taxable ${fmtMoneyFull(taxableCeil)} + std ded ${fmtMoneyFull(stdDed)}`
                    : undefined,
                },
                // Conversion guidance must match ConversionScenarios / Drawdown:
                // once converted YTD exceeds (room − safety buffer) the primary
                // recommendation is STOP — never show the headroom as a green
                // "safe to convert" number.
                ...(() => {
                  const buf = td?.safety_buffer ?? 0
                  const netRoom = projRoom != null ? Math.max(0, projRoom - buf) : null
                  const ytdConv = is.actual_conversion ?? 0
                  const convStopped = netRoom != null && ytdConv >= netRoom && ytdConv > 0
                  if (overCeiling) return [{
                    label: ' Over Ceiling',
                    value: `+${fmtMoneyFull(Math.abs(projRoom!))}`,
                    vc: roomColor, large: true,
                  }]
                  if (convStopped) return [{
                    label: `Roth Conversion (${bracketLabel})`,
                    value: 'STOP',
                    vc: R, large: true,
                    sub: `tax-optimal exceeded — bracket headroom ${projRoom != null ? fmtMoneyFull(projRoom) : '—'} is not a conversion recommendation`,
                  }]
                  return [{
                    label: `Safe Conv Room (${bracketLabel})`,
                    value: projRoom != null ? fmtMoneyFull(projRoom) : '—',
                    vc: roomColor, large: true,
                  }]
                })(),
              ]
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 32px' }}>
                  {tiles.map(kv => (
                    <div key={kv.label}>
                      <div style={{ fontSize: 12, color: M, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        {kv.label}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: kv.large ? 20 : 14, fontWeight: 500, color: kv.vc, lineHeight: 1 }}>
                        {kv.value}
                      </div>
                      {kv.sub && (
                        <div style={{ fontSize: 12, color: M, marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                          {kv.sub}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Footer: YTD marginal + headroom bar */}
            {(marginalRate != null || projRoom != null) && (
              <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border2)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                {marginalRate != null && (
                  <span style={{ fontSize: 12, color: M }}>
                    YTD marginal rate:{' '}
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text3)', fontWeight: 500 }}>
                      {(marginalRate * 100).toFixed(0)}%
                    </span>
                  </span>
                )}
                {projRoom != null && roomCeiling != null && roomCeiling > 0 && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
                    <span style={{ fontSize: 12, color: M, whiteSpace: 'nowrap' }}>bracket used (taxable)</span>
                    <div style={{ flex: 1, height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(100, (ordinaryAgi / roomCeiling) * 100)}%`,
                        height: '100%', background: roomColor, borderRadius: 0, opacity: 0.85,
                      }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: roomColor, fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {((ordinaryAgi / roomCeiling) * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </section>
  )
}