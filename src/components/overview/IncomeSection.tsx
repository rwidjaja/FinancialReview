/**
 * Overview › Income — v4 port of the v3 IncomeHero.
 * Left: projected dividends, coverage bar (lifestyle / income target / State C
 * bucket), taxable-income mix, received YTD. Right: the active state's flow
 * rules and the dividend-pacing callout. Bucket detail opens in a Dialog.
 */
import { useState } from 'react'
import type { DashboardData, IncomeSummary } from '../../types/dashboard'
import { computeBucketStatus } from '../../utils/retirementEngine'
import { fmtMoneyFull, fmtFull } from '../../utils/formatters'
import {
  Section, StatusTag, Label, ColHead, Callout, Dialog, RuledList, KeyValueRow, mono, muted, type Status,
} from '../ui/primitives'

const STATE_STATUS: Status[] = ['ok', 'watch', 'alert']
const STATE_NAMES = ['A · Income', 'B · Hybrid', 'C · Capital']

export function IncomeSection({ data, stateIdx }: { data: DashboardData; stateIdx: number }) {
  const [showStates, setShowStates] = useState(false)
  const [showByAccount, setShowByAccount] = useState(false)
  const [showBucketDetail, setShowBucketDetail] = useState(false)

  const ia = data.income_analytics
  const is: IncomeSummary | null = data.income_summary
  const tx = data.tax_data
  const wsConfig = tx?.withdrawal_states

  const fwd12m = ia?.portfolio_fwd_12m ?? 0
  const target = ia?.target_income ?? fwd12m
  const totalValue = data.summary.total_value
  const portYield = ia?.yield_pct ?? (totalValue > 0 ? (fwd12m / totalValue) * 100 : 0)

  // Lifestyle target range (from _INCOME_TARGET block)
  const lsMin = ia?.lifestyle_target_min ?? null
  const lsMax = ia?.lifestyle_target_max ?? null
  const lsProgMin = ia?.lifestyle_progress_min ?? null
  const lsProgMax = ia?.lifestyle_progress_max ?? null
  const lsGapMin = ia?.lifestyle_gap_min ?? null
  const lsGapMax = ia?.lifestyle_gap_max ?? null
  const hasLifestyle = lsMin !== null && lsMax !== null

  // Coverage vs tax-bracket target (fallback when no lifestyle target)
  const coverage = target > 0 ? Math.min((fwd12m / target) * 100, 200) : 100

  // Bucket — canonical taxable-only filter
  const swvxxValue = computeBucketStatus(data).swvxxValue
  // Per-position detail for the bucket dialog (same taxable-only filter)
  const bucketPositions = (data.accounts ?? [])
    .filter(acct => {
      const k = (acct.key ?? '').toLowerCase(), l = (acct.label ?? '').toLowerCase()
      return (k.includes('taxable') || k.includes('brokerage') || k.includes('individual') || l.includes('taxable') || l.includes('brokerage'))
        && !k.includes('rollover') && !k.includes('roth') && !k.includes('ira')
    })
    .flatMap(acct => (acct.positions ?? [])
      .filter(p => p.is_money_market || p.fund_type === 'MONEY_MARKET' || p.symbol === 'CASH')
      .map(p => ({ acct: acct.label ?? acct.key ?? '—', symbol: p.symbol, value: p.value })))
  const annualSpending = data.spending_intelligence?.true_annual_spending ?? 0
  const monthlySpending = annualSpending > 0 ? annualSpending / 12 : 0

  const stateRows = [
    { label: STATE_NAMES[0], desc: wsConfig?.A.description ?? 'Unrealized gains below A→B threshold. Live on dividends; maximize Roth conversions; no controlled sales needed.' },
    { label: STATE_NAMES[1], desc: wsConfig?.B.description ?? 'Unrealized gains between A→B and B→C thresholds. Begin controlled sales; build 1-year SWVXX bucket.' },
    { label: STATE_NAMES[2], desc: wsConfig?.C.description ?? 'Unrealized gains above B→C threshold. Full controlled sale mode; reduce income ETFs gradually; build 1-year SWVXX bucket.' },
  ]

  // Taxable-income mix (salary / dividends / Roth conversion)
  const mixSegments: { label: string; value: number; color: string }[] = []
  if (is) {
    if (fwd12m > 0)                  mixSegments.push({ label: 'Dividends', value: fwd12m, color: 'var(--fd-accent)' })
    if (is.full_year_conversion > 0) mixSegments.push({ label: 'Roth conversion', value: is.full_year_conversion, color: 'var(--fd-lilac-ink)' })
    if (is.full_year_w2 > 0)         mixSegments.push({ label: 'Salary', value: is.full_year_w2, color: 'var(--fd-muted)' })
  }
  const mixTotal = mixSegments.reduce((a, b) => a + b.value, 0) || 1

  // State-specific income flow rules
  const rulesB = wsConfig?.B?.rules
  const rulesC = wsConfig?.C?.rules
  const fmtSaleRange = (min?: number, max?: number) => min != null && max != null ? `${fmtMoneyFull(min)}–${fmtMoneyFull(max)}/yr` : 'per plan'
  const bucketYrsB = rulesB?.required_bucket_years ?? 1
  const bucketYrsC = rulesC?.required_bucket_years ?? 1
  const saleRangeB = fmtSaleRange(rulesB?.controlled_sale_target_min, rulesB?.controlled_sale_target_max)
  const saleRangeC = fmtSaleRange(rulesC?.controlled_sale_target_min, rulesC?.controlled_sale_target_max)
  const flows: { title: string; bullets: string[] }[] = [
    { title: 'Dividends first', bullets: [
      'Your dividends cover spending — no need to sell anything',
      'All dividends get reinvested, across every account',
      'Keep just a small cash cushion on hand',
      'No need to top up your cash reserve',
      "Don't trim any concentrated positions unless a risk alert fires",
      'You can convert to Roth up to your tax bracket limit',
    ] },
    { title: 'Hybrid', bullets: [
      'Dividends cover spending first',
      `Sell investments to cover the rest: ${saleRangeB}`,
      `Build the cash reserve toward ${bucketYrsB} year${bucketYrsB === 1 ? '' : 's'} of spending`,
      'Trim concentrated positions only above target limits',
      'Resume Roth conversions once the cash reserve is topped up',
    ] },
    { title: 'Controlled sales first', bullets: [
      `Planned investment sales: ${saleRangeC}`,
      'Dividends refill the cash reserve, not spending',
      `Top up the cash reserve to ${bucketYrsC} year${bucketYrsC === 1 ? '' : 's'} of spending before anything else`,
      "Don't reinvest dividends until that reserve is full",
      'Roth conversions wait until the reserve is topped up',
      'Trim concentrated positions as lots reach long-term rates — see Next decision',
    ] },
  ]
  const flow = flows[stateIdx]

  // YTD received vs tracked spending + pacing note
  const ytd = data.income_history?.ytd_total ?? 0
  const ytdCovRatio = annualSpending > 0 ? ytd / annualSpending : 0
  const incConf = tx?.income_confidence
  const icRecPct = tx?.income_received_pct ?? 0
  const icTrigPct = tx?.trigger_pct_threshold ?? 0
  const showPacing = incConf === 'LOW' || incConf === 'MEDIUM'

  // State C bucket coverage
  const requiredBucketC = bucketYrsC * annualSpending
  const bucketMonths = swvxxValue > 0 && monthlySpending > 0 ? swvxxValue / monthlySpending : 0
  const bucketPct = requiredBucketC > 0 ? Math.min(100, (swvxxValue / requiredBucketC) * 100) : 100
  const shortfall = Math.max(0, requiredBucketC - swvxxValue)
  const bucketLabel = bucketMonths >= 23 ? `${(bucketMonths / 12).toFixed(1)} yr` : `${bucketMonths.toFixed(1)} mo`

  const barTrack = { height: 12, position: 'relative' as const, background: 'var(--fd-hairline)' }
  const linkBtn = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', ...mono, ...muted, textDecoration: 'underline', textUnderlineOffset: 3 }

  return (
    <Section title="Income" meta={
      <button onClick={() => setShowStates(v => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} title="What the withdrawal states mean">
        <StatusTag status={STATE_STATUS[stateIdx]}>State {STATE_NAMES[stateIdx]}</StatusTag>
      </button>
    }>
      {showStates && (
        <RuledList>
          {stateRows.map((r, i) => (
            <KeyValueRow key={r.label} status={i === stateIdx ? STATE_STATUS[i] : 'info'} k={<span style={{ fontWeight: i === stateIdx ? 500 : 400 }}>State {r.label}</span>} sub={r.desc} v={i === stateIdx ? 'Current' : ''} />
          ))}
        </RuledList>
      )}

      <div style={{ background: 'var(--fd-card)', padding: 40, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Projected dividends · fwd 12m</Label>
            <span style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1 }}>{fmtMoneyFull(fwd12m)}</span>
            <span style={{ fontSize: 14, ...muted }}>{fmtFull(fwd12m / 12)}/mo · yield {portYield.toFixed(2)}%</span>
            {ia?.by_account && <button onClick={() => setShowByAccount(v => !v)} style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }}>{showByAccount ? 'Hide accounts' : 'By account'}</button>}
          </div>

          {showByAccount && ia?.by_account && (
            <RuledList>
              {data.accounts.filter(a => (ia.by_account[a.key]?.fwd_12m ?? 0) > 0).map(a => {
                const v = ia.by_account[a.key]?.fwd_12m ?? 0
                return <KeyValueRow key={a.key} k={a.label} v={`${fmtMoneyFull(v)} · ${(fwd12m > 0 ? (v / fwd12m) * 100 : 0).toFixed(1)}%`} />
              })}
            </RuledList>
          )}

          {stateIdx === 2 ? (
            // State C: dividends fund the bucket, not lifestyle — show bucket coverage
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={muted}>Cash reserve · {fmtMoneyFull(annualSpending)}/yr tracked spending</span>
                <span style={{ fontWeight: 500 }}>{shortfall > 0 ? `Short ${fmtMoneyFull(shortfall)}` : 'Fully funded'}</span>
              </div>
              <div style={barTrack}><div style={{ position: 'absolute', inset: 0, width: `${bucketPct}%`, background: shortfall > 0 ? 'var(--fd-negative)' : 'var(--fd-accent)' }} /></div>
              <button onClick={() => setShowBucketDetail(true)} style={{ ...linkBtn, alignSelf: 'flex-start', textTransform: 'none', fontFamily: 'var(--font-sans)', fontSize: 13 }}>
                Current cash reserve: {swvxxValue > 0 ? `${fmtMoneyFull(swvxxValue)} (${bucketLabel})` : '—'}
              </button>
              <span style={{ fontSize: 13, ...muted }}>All spending is funded by selling investments; dividends top up the cash reserve. Investment sales needed this year: {saleRangeC}.</span>
            </div>
          ) : hasLifestyle ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={muted}>Lifestyle {fmtFull(lsMin!)}–{fmtFull(lsMax!)}/yr</span>
                <span style={{ fontWeight: 500 }}>{Math.min(lsProgMin!, lsProgMax!).toFixed(1)}–{Math.max(lsProgMin!, lsProgMax!).toFixed(1)}%</span>
              </div>
              <div style={barTrack}>
                {/* lilac = coverage vs the low end of the range, accent = vs the high end */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.min(Math.max(lsProgMin!, lsProgMax!), 100)}%`, background: 'var(--fd-lilac-ink)' }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.min(Math.min(lsProgMin!, lsProgMax!), 100)}%`, background: 'var(--fd-accent)' }} />
              </div>
              <span style={{ fontSize: 13, ...muted }}>{lsGapMax! > 0 ? `Gap to lifestyle ${fmtFull(lsGapMin!)}–${fmtFull(lsGapMax!)}/yr` : 'Lifestyle range fully covered'}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={muted}>Income target {fmtFull(target)}/yr</span>
                <span style={{ fontWeight: 500 }}>{coverage.toFixed(1)}%{coverage >= 100 ? '' : ' — short'}</span>
              </div>
              <div style={barTrack}><div style={{ position: 'absolute', inset: 0, width: `${Math.min(coverage, 100)}%`, background: 'var(--fd-accent)' }} /></div>
            </div>
          )}

          {mixSegments.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 14, ...muted }}>Taxable income mix</span>
              <div style={{ display: 'flex', height: 12 }}>
                {mixSegments.map(seg => <div key={seg.label} title={`${seg.label}: ${fmtMoneyFull(seg.value)}`} style={{ width: `${(seg.value / mixTotal) * 100}%`, background: seg.color }} />)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
                {mixSegments.map(seg => <span key={seg.label}>{seg.label} {fmtMoneyFull(seg.value)} · {((seg.value / mixTotal) * 100).toFixed(0)}%</span>)}
              </div>
              {mixSegments.some(m => m.label === 'Roth conversion') && <span style={{ fontSize: 13, ...muted }}>Conversion is taxed as income but not received as cash.</span>}
            </div>
          )}

          {ytd > 0 && annualSpending > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, borderTop: '1px solid var(--fd-hairline)', paddingTop: 12 }}>
              <span style={muted}>Received in {data.income_history?.year ?? ''}</span>
              <span style={{ fontWeight: 500, textAlign: 'right' }}>
                {fmtMoneyFull(ytd)} · {ytdCovRatio >= 1 ? `covers ${fmtMoneyFull(annualSpending)} tracked` : `${(ytdCovRatio * 100).toFixed(0)}% of ${fmtMoneyFull(annualSpending)} tracked`}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <ColHead style={muted}>Income flow rules · {flow.title}</ColHead>
          {flow.bullets.map((b, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 8, fontSize: 14, lineHeight: 1.35, paddingBottom: 12, borderBottom: '1px solid var(--fd-hairline)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
              <span>{b}</span>
            </div>
          ))}
          {showPacing && (
            <Callout>
              {icRecPct.toFixed(1)}% of expected dividends have arrived. The plan waits for {icTrigPct.toFixed(1)}% before naming a Roth conversion amount.
              {ytdCovRatio >= 1 && ' Spending is already covered either way.'}
            </Callout>
          )}
        </div>
      </div>

      {showBucketDetail && (
        <Dialog onClose={() => setShowBucketDetail(false)} width={560} label="Cash reserve detail">
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 44, lineHeight: 0.95, margin: 0 }}>
            {fmtMoneyFull(swvxxValue)} in <em>reserve</em>.
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>Money market positions · taxable</Label>
            <RuledList>
              {bucketPositions.length > 0
                ? bucketPositions.map((p, i) => <KeyValueRow key={i} k={p.symbol} sub={p.acct} v={fmtMoneyFull(p.value)} />)
                : <KeyValueRow k="No money market positions found" v="" />}
              <KeyValueRow k={<span style={{ fontWeight: 500 }}>Total cash reserve</span>} v={fmtMoneyFull(swvxxValue)} />
            </RuledList>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>Coverage math</Label>
            <RuledList>
              <KeyValueRow k="Annual spending" sub="From your tracked transactions" v={fmtMoneyFull(annualSpending)} />
              <KeyValueRow k="Monthly spending" v={fmtMoneyFull(monthlySpending)} />
              <KeyValueRow k="Coverage" v={`${bucketMonths.toFixed(1)} months`} />
              <KeyValueRow k={`Required (${bucketYrsC} yr target)`} v={fmtMoneyFull(requiredBucketC)} />
              <KeyValueRow k={shortfall > 0 ? 'Shortfall' : 'Surplus'} status={shortfall > 0 ? 'alert' : 'ok'} v={fmtMoneyFull(shortfall > 0 ? shortfall : swvxxValue - requiredBucketC)} />
            </RuledList>
          </div>
        </Dialog>
      )}
    </Section>
  )
}
