/**
 * Estimated tax payments — v4 (AtScale). Spec: README "Estimated-tax quarter
 * detail" + redesign/atscale/Tab Tax.dc.html.
 *
 *   method note → payment-readiness bar → 4 clickable quarter cards → dialog
 *   (header · how we get to $X · income breakdown · dividends received with a
 *   reconciliation footer · Roth conversions · realised gains)
 *
 * Data logic (IRS quarter mapping, reconciliation, banner text) is v3's.
 */
import { useState } from 'react'
import { fmtMoneyFull, fmtFull } from '../../utils/formatters'
import { computeConversionVerdict } from '../../utils/conversionVerdict'
import type { Account, DashboardData } from '../../types/dashboard'
import { Dialog, StatusTag, Label, mono, muted, type Status } from '../ui/primitives'

type QuarterPayment = DashboardData['tax_data']['quarterly_payments'][number]

function parseQuarter(quarter: string): { qNum: number; qYear: number } {
  const qNum  = parseInt(quarter.match(/Q(\d)/)?.[1] ?? '0', 10)
  const qYear = parseInt(quarter.match(/\d{4}/)?.[0] ?? '0', 10)
  return { qNum, qYear }
}

// IRS estimated-tax quarters — NOT calendar quarters:
//   Q1 = Jan–Mar (due Apr 15)   Q2 = Apr–May (due Jun 15, only 2 months)
//   Q3 = Jun–Aug (due Sep 15)   Q4 = Sep–Dec (due Jan 15)
function irsQuarterForMonth(month: number): number {
  if (month <= 3) return 1
  if (month <= 5) return 2
  if (month <= 8) return 3
  return 4
}

function inQuarter(dateStr: string, qNum: number, qYear: number): boolean {
  // Parse YYYY-MM-DD directly to avoid UTC-midnight → previous-day shift in
  // US timezones, which would misclassify e.g. April 1 as Q1 instead of Q2.
  const parts = dateStr.split('-')
  const year  = parseInt(parts[0] ?? '0', 10)
  const month = parseInt(parts[1] ?? '0', 10)
  return year === qYear && irsQuarterForMonth(month) === qNum
}

/** Rates arrive as either 0.24 or 24 depending on field — normalise to a fraction. */
const asRate = (r: number | null | undefined, fallback: number) => r == null ? fallback : r > 1 ? r / 100 : r
const pct = (r: number) => `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`
const $ = fmtMoneyFull

const quarterIncome = (p: QuarterPayment) => (p.div_income ?? 0) + (p.stcg_realized ?? 0) + (p.ltcg_realized ?? 0) + (p.conv_portion ?? 0)
const effRate = (p: QuarterPayment) => { const inc = quarterIncome(p); return inc > 0 ? (p.payment / inc) * 100 : null }

function quarterStatus(p: QuarterPayment, currentQ: string | undefined, currentYear: number) {
  const { qYear } = parseQuarter(p.quarter)
  const isPast = p.days_until != null && p.days_until < 0
  const isCurrent = !isPast && currentQ === p.quarter
  const urgent = p.days_until != null && p.days_until >= 0 && p.days_until <= 30
  const word = isPast ? '✓ Paid' : p.days_until === 0 ? 'Due today' : p.days_until != null ? `${p.days_until} days` : '—'
  return { isPast, isCurrent, urgent, word, priorYear: qYear < currentYear }
}

// ── Rollup rows (How we get to $X) ───────────────────────────────────────────

function rollupRows(p: QuarterPayment, tx: DashboardData['tax_data'], hasActualConv: boolean) {
  const marg = asRate(tx.marginal_rate, (tx.target_bracket_rate ?? 24) / 100)
  const ltcg = asRate(tx.ltcg_rate, 0.15)
  const niit = tx.niit_applies ? asRate(tx.niit_rate, 0.038) : 0
  const niitTxt = niit > 0 ? ` + ${pct(niit)} NIIT` : ''
  const rows: { k: string; calc: string; v: number }[] = []

  if ((p.div_tax ?? 0) !== 0 || (p.div_income ?? 0) > 0) {
    const ord = p.div_income_ordinary ?? 0, qual = p.div_income_qualified ?? 0
    rows.push({
      k: (p.div_income_projected ?? 0) > 0 ? 'Dividend tax · projected' : 'Dividend tax',
      calc: ord > 0 || qual > 0
        ? `${$(ord)} ordinary × ${pct(marg)} + ${$(qual)} qualified × ${pct(ltcg)}${niitTxt ? `${niitTxt} on ${$(p.div_income)}` : ''}`
        : `${$(p.div_income)} dividends at the blended ordinary / qualified rate${niitTxt}`,
      v: p.div_tax ?? 0,
    })
  }
  const cg = p.cap_gains_tax ?? 0
  if (cg !== 0) {
    const hasSt = (p.stcg_gain ?? 0) > 0 || (p.stcg_loss ?? 0) < 0
    const hasLt = (p.ltcg_gain ?? 0) > 0 || (p.ltcg_loss ?? 0) < 0
    const onlyLoss = (p.stcg_gain ?? 0) <= 0 && (p.stcg_loss ?? 0) < 0 && (p.ltcg_gain ?? 0) <= 0
    rows.push({
      k: onlyLoss ? 'Tax-loss harvest offset' : hasSt && !hasLt ? 'Short-term gains tax' : !hasSt && hasLt ? 'Long-term gains tax' : 'Capital gains tax',
      calc: onlyLoss
        ? `${$(p.stcg_loss ?? 0)} harvested loss offsets dividend income`
        : [hasSt ? `net ${$(p.stcg_realized ?? 0)} short-term × (${pct(marg)}${niitTxt})` : null, hasLt ? `net ${$(p.ltcg_realized ?? 0)} long-term × (${pct(ltcg)}${niitTxt})` : null].filter(Boolean).join(' + '),
      v: cg,
    })
  }
  if ((p.conv_tax ?? 0) > 0) {
    rows.push({ k: hasActualConv ? 'Conversion tax' : 'Conversion tax · planned', calc: `marginal ${pct(marg)} on ${$(p.conv_portion ?? 0)}`, v: p.conv_tax ?? 0 })
  }
  return rows
}

// ── Quarter detail dialog ────────────────────────────────────────────────────

function QuarterDetailModal({ payment: p, tx, data, status, hasActualConv, actualConv, onClose }: {
  payment: QuarterPayment
  tx: DashboardData['tax_data']
  data: DashboardData
  status: ReturnType<typeof quarterStatus>
  hasActualConv: boolean
  actualConv: number
  onClose: () => void
}) {
  const { qNum, qYear } = parseQuarter(p.quarter)

  // Dividends — taxable account only (Rollover and Roth are tax-deferred/free)
  const divTxns = (data.income_history?.transactions ?? [])
    .filter(t => t.amount > 0 && t.account === 'taxable' && inQuarter(t.date, qNum, qYear))
    .sort((a, b) => b.date.localeCompare(a.date))
  const divTotalCash = divTxns.reduce((s, t) => s + t.amount, 0)
  const divProjected = p.div_income_projected ?? null
  const divHasProjected = (divProjected ?? 0) > 0.5
  const divTaxableIncome = p.div_income ?? 0
  const divImpliedRoc = !divHasProjected ? Math.max(0, divTotalCash - divTaxableIncome) : 0

  const convTxns = (tx.conversions_done_detail ?? [])
    .filter(c => c.date && inQuarter(c.date, qNum, qYear))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const gainTxns = (data.tax_data?.realized_gain_transactions ?? [])
    .filter(t => inQuarter(t.date, qNum, qYear))
    .sort((a, b) => b.date.localeCompare(a.date))

  const rollup = rollupRows(p, tx, hasActualConv)
  const inc = quarterIncome(p)
  const rate = effRate(p)

  const head = { ...mono, paddingBottom: 10, borderBottom: '2px solid var(--fd-rule)' }
  const row = { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14, gap: 12 } as const
  const GAIN_TAG: Record<string, Status> = { STCG: 'watch', LTCG: 'ok' }

  const gainsRows: { k: string; v: string; strong?: boolean; tax?: boolean }[] = []
  if ((p.stcg_gain ?? 0) > 0) gainsRows.push({ k: 'Short-term realised', v: $(p.stcg_gain) })
  if ((p.stcg_loss ?? 0) < 0) gainsRows.push({ k: 'Short-term harvested loss', v: $(p.stcg_loss) })
  if ((p.ltcg_gain ?? 0) > 0) gainsRows.push({ k: 'Long-term realised', v: $(p.ltcg_gain) })
  if ((p.ltcg_loss ?? 0) < 0) gainsRows.push({ k: 'Long-term realised loss', v: $(p.ltcg_loss) })
  if (hasActualConv || p.is_conv_quarter) gainsRows.push({ k: hasActualConv ? 'Converted' : 'Conversion · planned', v: $(hasActualConv ? actualConv : (p.conv_portion ?? 0)) })
  gainsRows.push({ k: 'Tax', v: $((p.cap_gains_tax ?? 0) + (p.conv_tax ?? 0)), tax: true })

  const divRows: { k: string; v: string; strong?: boolean; tax?: boolean }[] = divHasProjected
    ? [
        ...((p.div_income_actual ?? 0) > 0 ? [{ k: 'Received (actual)', v: $(p.div_income_actual) }] : []),
        { k: 'Projected (est.)', v: $(divProjected) },
        { k: 'Total (projected)', v: $(p.div_income), strong: true },
        { k: 'Tax on projected total', v: $(p.div_tax ?? 0), tax: true },
      ]
    : [
        ...((p.div_income_ordinary ?? 0) > 0 ? [{ k: 'Ordinary', v: $(p.div_income_ordinary) }] : []),
        ...((p.div_income_qualified ?? 0) > 0 ? [{ k: 'Qualified', v: $(p.div_income_qualified) }] : []),
        { k: 'Total income', v: $(p.div_income), strong: true },
        { k: 'Tax', v: $(p.div_tax ?? 0), tax: true },
      ]

  return (
    <Dialog onClose={onClose} width={760} label={`${p.quarter} tax detail`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ ...mono, color: 'var(--fd-accent)' }}>{p.quarter} · {p.period} · due {p.due_label} · {status.isPast ? 'paid' : status.word.toLowerCase()}</span>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 56, lineHeight: 0.85, letterSpacing: '-0.02em', margin: 0 }}>{fmtFull(p.payment)}, and <em>why</em>.</h2>
        <span style={{ fontSize: 15, ...muted }}>
          {rate != null ? `${rate.toFixed(1)}% effective on ${$(inc)} of taxable income earned in this IRS quarter.` : 'No taxable income recorded in this IRS quarter.'}
          {divHasProjected || (!hasActualConv && p.is_conv_quarter) ? ' Figures include projected dividends and the planned conversion.' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={head}>How we get to {$(p.payment)}</span>
        {rollup.map(r => (
          <div key={r.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15 }}>{r.k}</span>
              <span style={{ fontSize: 13, ...muted }}>{r.calc}</span>
            </div>
            <span style={{ fontSize: 15, fontWeight: 500, color: r.v < 0 ? 'var(--fd-accent)' : undefined }}>{$(r.v)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', fontSize: 18, fontWeight: 500 }}>
          <span>Total payment</span><span>{$(p.payment)}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 24 }}>
        {[{ t: divHasProjected || p.div_income_estimated ? 'Dividends · estimated' : 'Dividends', rows: divRows }, { t: 'Gains and conversions', rows: gainsRows }].map(g => (
          <div key={g.t} style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={head}>{g.t}</span>
            {g.rows.map(r => (
              <div key={r.k} style={{ ...row, fontWeight: r.strong ? 500 : 400 }}>
                <span style={{ color: r.strong ? 'var(--fd-ink)' : 'var(--fd-muted)' }}>{r.k}</span>
                <span style={{ color: r.tax ? 'var(--fd-negative)' : undefined }}>{r.v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={head}>Dividends received · taxable account</span>
        {divTxns.length === 0 ? <span style={{ fontSize: 14, ...muted, padding: '8px 0' }}>No dividends this quarter.</span> : (<>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 80px 1fr 120px', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--fd-hairline)', ...mono, ...muted }}>
            <span>Date</span><span>Symbol</span><span>Account</span><span style={{ textAlign: 'right' }}>Amount</span>
          </div>
          {divTxns.map((t, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 80px 1fr 120px', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14 }}>
              <span style={muted}>{t.date}</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{t.symbol}</span>
              <span style={muted}>Taxable</span><span style={{ textAlign: 'right' }}>{$(t.amount)}</span>
            </div>
          ))}
          {(divHasProjected
            ? [{ k: 'Received so far (actual)', v: $(divTotalCash) }, { k: 'Projected remaining (est.)', v: `+ ${$(divProjected)}` }, { k: 'Projected taxable total (est.)', v: $(divTaxableIncome), total: true }]
            : [{ k: 'Total cash received', v: $(divTotalCash) }, ...(divImpliedRoc > 0.5 ? [{ k: 'Return of capital · not taxable', v: `− ${$(divImpliedRoc)}` }] : []), { k: 'Taxable income', v: $(divTaxableIncome), total: true }]
          ).map(r => (
            <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 14, fontWeight: 'total' in r ? 500 : 400, borderTop: 'total' in r ? '1px solid var(--fd-hairline)' : 'none' }}>
              <span style={{ color: 'total' in r ? 'var(--fd-ink)' : 'var(--fd-muted)' }}>{r.k}</span><span>{r.v}</span>
            </div>
          ))}
        </>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={head}>Roth conversions</span>
          {convTxns.length > 0
            ? convTxns.map((c, i) => <div key={i} style={row}><span style={muted}>{c.date}</span><span style={{ fontWeight: 500 }}>{$(c.value)}</span></div>)
            : p.is_conv_quarter && (p.conv_portion ?? 0) > 0
              ? <div style={row}><span style={muted}>Planned this quarter</span><span style={{ fontWeight: 500 }}>{$(p.conv_portion)}</span></div>
              : <span style={{ fontSize: 14, ...muted, padding: '8px 0' }}>No conversions this quarter.</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={head}>Realised gains</span>
          {gainTxns.length === 0 ? <span style={{ fontSize: 14, ...muted, padding: '8px 0' }}>No realised gains this quarter.</span>
            : gainTxns.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 64px 70px 1fr 84px', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14, alignItems: 'center' }}>
                <span style={muted}>{t.date}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{t.symbol}</span>
                <span style={{ ...muted, textAlign: 'right' }}>{t.shares.toFixed(3)}</span>
                <span style={{ textAlign: 'right', color: t.gain < 0 ? 'var(--fd-negative)' : undefined }}>{$(t.gain)}</span>
                <span style={{ justifySelf: 'end' }}><StatusTag status={t.gain_type.startsWith('LOSS') ? 'alert' : GAIN_TAG[t.gain_type] ?? 'info'}>{t.gain_type.startsWith('LOSS') ? 'Loss' : t.gain_type}</StatusTag></span>
              </div>
            ))}
        </div>
      </div>
    </Dialog>
  )
}

// ── Readiness (cash + MM in taxable vs next payment) ─────────────────────────

function TaxReadiness({ accounts, upcoming }: { accounts: Account[]; upcoming: QuarterPayment | undefined }) {
  const taxableAcct = accounts.find(a => a.key === 'taxable')
  if (!taxableAcct || !upcoming) return null
  // Tax liquidity = MMF + uninvested CASH (unlike the spending bucket, CASH counts here)
  const liquid = taxableAcct.positions.filter(p => p.is_money_market || p.fund_type === 'MONEY_MARKET' || p.symbol === 'CASH').reduce((s, p) => s + p.value, 0)
  const due = upcoming.payment
  const surplus = liquid - due
  const covered = surplus >= 0
  const fill = due > 0 ? Math.min(100, (liquid / due) * 100 / 1.5) : 100
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 24, alignItems: 'center', background: 'var(--fd-card)', padding: '20px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 14, flexWrap: 'wrap' }}>
          <Label>Payment readiness · {upcoming.quarter} · due {upcoming.due_label} · {upcoming.days_until === 0 ? 'today' : `${upcoming.days_until} days`}</Label>
          <span style={{ fontWeight: 500 }}>{$(liquid)} liquid vs {$(due)} due</span>
        </div>
        <div style={{ height: 8, background: 'var(--fd-hairline)' }}><div style={{ height: 8, width: `${fill}%`, background: covered ? 'var(--fd-accent)' : 'var(--fd-negative)' }} /></div>
        <span style={{ fontSize: 13, ...muted }}>Liquid means cash and money market in the taxable account only.</span>
      </div>
      <StatusTag status={covered ? 'ok' : 'alert'}>{covered ? `✓ Funded · ${$(surplus)} buffer` : `✗ Short ${$(Math.abs(surplus))}`}</StatusTag>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function QuarterlyPayments({ tx, accounts, data }: { tx: DashboardData['tax_data']; accounts: Account[]; data: DashboardData }) {
  const payments = tx.quarterly_payments ?? []
  const [detail, setDetail] = useState<QuarterPayment | null>(null)
  const currentYear = new Date().getFullYear()

  // Quarters with recorded conversions
  const actualConvByQuarter: Record<number, number> = {}
  for (const c of tx.conversions_done_detail ?? []) {
    if (!c.date) continue
    const q = irsQuarterForMonth(parseInt(c.date.split('-')[1] ?? '0', 10))
    actualConvByQuarter[q] = (actualConvByQuarter[q] ?? 0) + c.value
  }
  const convQs = Object.keys(actualConvByQuarter).map(Number).sort()
  const plannedConvQ = tx.conv_quarter ?? 4

  // "Current" = next upcoming IRS payment (smallest non-negative days_until)
  const upcoming = payments.filter(p => p.days_until != null && p.days_until >= 0).sort((a, b) => (a.days_until ?? 0) - (b.days_until ?? 0))[0]

  // Method note (v3 logic)
  let method: string
  if (convQs.length > 0) {
    const actualTotal = tx.converted_ytd || Object.values(actualConvByQuarter).reduce((a, b) => a + b, 0)
    const remaining = tx.remaining_to_convert ?? 0
    const target = actualTotal + remaining
    const v = computeConversionVerdict(tx)
    method = `Method: income when earned. Conversions were recorded in ${convQs.map(q => `Q${q}`).join(' and ')} — ${$(actualTotal)}${target > 0 ? ` of the ${$(target)} target` : ''}`
      + (remaining > 0
        ? v?.status === 'STOP' ? ` — and ${$(remaining)} of plan remains as a bracket-fill option only (verdict: stop, above tax-optimal).` : ` — and ${$(remaining)} remains.`
        : ' — the target is complete.')
  } else {
    // tax_no_ss already includes STCG; show LTCG-only alongside it (no double count)
    const ytdLtcgTax = tx.total_tax_with_cg != null && tx.tax_no_ss != null ? Math.max(0, tx.total_tax_with_cg - tx.tax_no_ss) : 0
    const prevQ4Cg = (tx.prev_q4_ltcg ?? 0) + (tx.prev_q4_stcg ?? 0)
    method = `Method: income when earned. The conversion quarter is Q${plannedConvQ}. Total for the year: ${$(tx.total_tax_with_cg ?? tx.tax_no_ss ?? 0)}`
      + (ytdLtcgTax > 0 ? `, including ${$(ytdLtcgTax)} of long-term gains tax (short-term is inside the ordinary total)` : '') + '.'
      + (prevQ4Cg > 0 ? ` Prior-year Q4 gains of ${$(prevQ4Cg)} fall in the January payment.` : '')
  }
  method += ' IRS quarters are not calendar quarters: Q2 is only April and May.'

  const yearTotal = payments.filter(p => parseQuarter(p.quarter).qYear === currentYear || p.quarter.includes(String(currentYear))).reduce((t, p) => t + p.payment, 0)
    || payments.reduce((t, p) => t + p.payment, 0)

  const detailStatus = detail ? quarterStatus(detail, upcoming?.quarter, currentYear) : null
  const detailQ = detail ? parseQuarter(detail.quarter).qNum : 0

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
        <h2 style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>Estimated tax payments</h2>
        <Label>{$(yearTotal)} for {currentYear} · select a quarter for detail</Label>
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.45, ...muted, margin: 0, maxWidth: 820 }}>{method}</p>

      <TaxReadiness accounts={accounts} upcoming={upcoming} />

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(5, payments.length || 1)}, minmax(0,1fr))`, gap: 16 }}>
        {payments.map(p => {
          const st = quarterStatus(p, upcoming?.quarter, currentYear)
          const { qNum } = parseQuarter(p.quarter)
          const hasConv = (actualConvByQuarter[qNum] ?? 0) > 0
          const rate = effRate(p)
          const lines = [
            { k: 'Dividend tax', v: $(p.div_tax ?? 0) },
            ...((p.cap_gains_tax ?? 0) !== 0 ? [{ k: 'Capital gains tax', v: $(p.cap_gains_tax) }] : []),
            ...((p.conv_tax ?? 0) > 0 ? [{ k: hasConv ? 'Conversion tax' : 'Conversion tax · planned', v: $(p.conv_tax) }] : []),
          ]
          return (
            <button key={p.quarter} className="fd-quarter" onClick={() => setDetail(p)} style={{
              border: 'none', borderTop: `5px solid ${st.isPast ? 'var(--fd-muted)' : st.urgent ? 'var(--fd-negative)' : 'var(--fd-accent)'}`,
              background: 'var(--fd-card)', color: 'var(--fd-ink)', padding: 20, display: 'flex', flexDirection: 'column', gap: 10,
              textAlign: 'left', cursor: 'pointer', minWidth: 0,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 8 }}>
                <span style={mono}>{p.quarter.replace(/\s*\d{4}$/, '')} · {p.period}</span>
                <span style={{ ...mono, color: st.isPast ? 'var(--fd-muted)' : 'var(--fd-accent)', whiteSpace: 'nowrap' }}>{st.priorYear ? 'Prior year' : st.isCurrent ? `Current · ${st.word}` : st.word}</span>
              </div>
              <span style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.005em', lineHeight: 1 }}>{fmtFull(p.payment)}</span>
              <span style={{ fontSize: 13, ...muted }}>Due {p.due_label}{rate != null ? ` · effective rate ${rate.toFixed(1)}%` : ''}</span>
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', borderTop: '1px solid var(--fd-hairline)' }}>
                {lines.map(l => (
                  <div key={l.k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 13, gap: 8 }}>
                    <span style={muted}>{l.k}</span><span>{l.v}</span>
                  </div>
                ))}
              </div>
              <span style={{ ...mono, color: 'var(--fd-accent)' }}>Why {fmtFull(p.payment)} →</span>
            </button>
          )
        })}
      </div>

      {detail && detailStatus && (
        <QuarterDetailModal payment={detail} tx={tx} data={data} status={detailStatus}
          hasActualConv={(actualConvByQuarter[detailQ] ?? 0) > 0} actualConv={actualConvByQuarter[detailQ] ?? 0}
          onClose={() => setDetail(null)} />
      )}
    </section>
  )
}
