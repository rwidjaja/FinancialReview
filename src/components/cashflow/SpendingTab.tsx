import React, { useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts'
import { TerminalSection } from '../ui/Terminal'
import { MetricTooltip } from '../ui/MetricTooltip'
import { MiniBar } from '../ui/Sparkline'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import { WITHDRAWAL_AB_THRESHOLD, WITHDRAWAL_BC_THRESHOLD } from '../../utils/constants'
import { COVERAGE_OK_PCT, COVERAGE_WARN_PCT, computeBucketStatus } from '../../utils/retirementEngine'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_CURSOR } from '../ui/chartTooltip'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { PageHero, LeadMuted, KpiStrip, Section, Sections, MainRail, RuledList, TileGrid, GridTile, Button, Label, muted, gain, moneyUnit, signedMoney } from '../ui/primitives'
import { TabBriefingPanel } from '../ui/TabBriefingPanel'
import { MonthlyReviewModal } from '../ui/MonthlyReviewModal'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'



interface Props { data: DashboardData }

export function SpendingTab({ data }: Props) {
  const [mode] = useGlobalViewMode()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const si = data.spending_intelligence

  if (!si?.available) {
    return (
      <div style={{ paddingBottom: 64 }}>
        <PageHero eyebrow="Cash flow · no transactions loaded" before="Spending is " em="unknown" after=" yet."
          lead={<span style={muted}>No transaction data is loaded. Upload a bank or credit card CSV to enable spending analysis — categories, monthly timeline, cash bucket fill, savings rate and shock-event detection.</span>} />
      </div>
    )
  }

  const is = data.income_summary
  const now = new Date()
  const currentMonth = now.getMonth() + 1  // 1-based
  const dr = si.date_range

  // Spendable YTD income: W2 + dividends only. Roth conversions are IRA→Roth transfers
  // counted by the IRS as ordinary income but not cash received — excluding them keeps
  // Net Cashflow, Coverage, and Savings Rate meaningful for spending analysis.
  const ytdIncome = is
    ? (is.actual_total - (is.actual_conversion ?? 0))
    : data.income_history.ytd_total

  // monthly_totals is already filtered to current year + descending by the server
  const ytdSpending = (si.monthly_totals ?? [])
    .filter(mt => parseInt(mt.month.substring(5, 7)) <= currentMonth)
    .reduce((s, mt) => s + mt.amount, 0)

  const netFlow = ytdIncome - ytdSpending
  const coveragePct = ytdSpending > 0 ? (ytdIncome / ytdSpending) * 100 : null

  // Monthly avg SPENDABLE income = W2 + dividends ÷ 12. Roth conversions are in
  // full_year_total but are account transfers, not cash you can spend — including
  // them inflated this card to $36K/mo and pushed savings rate to ~80%.
  const monthlyIncomeAvg = is
    ? (is.full_year_total - (is.full_year_conversion ?? 0)) / 12
    : (si.monthly_income_avg ?? (ytdIncome / Math.max(1, currentMonth)))

  // Monthly avg spending: prefer si.monthly_mean (overall dataset avg), fallback derive from ytd
  const monthlySpendingAvg = si.monthly_mean ?? (ytdSpending / Math.max(1, currentMonth))
  // Actual YTD avg — used only for the "N months tracked" caption so it reflects what was spent this year
  const ytdMonthlyAvg = ytdSpending / Math.max(1, currentMonth)

  // Last-year spending — full prior calendar year actual total, from the server's
  // calendar_years breakdown. dataYear anchors on the transaction data's own end
  // date (matches backend's max_date-based "current year"), not wall-clock today,
  // so this stays correct even when the CSV is stale.
  const dataYear = dr?.end ? parseInt(dr.end.slice(0, 4), 10) : now.getFullYear()
  const lastYearCal = si.calendar_years?.find(cy => cy.year === String(dataYear - 1))
  const lastYearSpending = lastYearCal?.lifestyle ?? null
  const ytdRunRateAnnual = ytdMonthlyAvg * 12
  const yoySpendPct = lastYearSpending ? ((ytdRunRateAnnual - lastYearSpending) / lastYearSpending) * 100 : null

  const monthlySavings = monthlyIncomeAvg - monthlySpendingAvg
  const savingsRate = monthlyIncomeAvg > 0 ? (monthlySavings / monthlyIncomeAvg) * 100 : 0


  // ── v4 derived ─────────────────────────────────────────────────────────────
  const startYr = new Date(now.getFullYear(), 0, 1).getTime()
  const yearElapsedPct = Math.min(100, ((now.getTime() - startYr) / (365.25 * 86400000)) * 100)
  const annualTracked = si.true_annual_spending ?? 0
  const budgetSpentPct = annualTracked > 0 ? (ytdSpending / annualTracked) * 100 : null
  const pace = budgetSpentPct == null ? 'unknown' : budgetSpentPct <= yearElapsedPct + 5 ? 'on' : 'ahead'
  // Spendable divs = taxable + Roth only — Rollover IRA dividends are reinvested
  const cal = data.income_analytics?.payout_calendar
  const spendableFwdDivs = cal?.accounts
    ? Object.entries(cal.accounts).filter(([k]) => !k.includes('rollover')).reduce((t, [, acct]) => t + acct.monthly_totals.reduce((ms, v) => ms + v, 0), 0)
    : (data.income_analytics?.portfolio_fwd_12m ?? null)
  const divCover = spendableFwdDivs != null && annualTracked > 0 ? spendableFwdDivs / annualTracked : null
  // Name the month the transaction data runs through, not today's month
  const monthName = (dr?.end ? new Date(dr.end + 'T12:00:00') : now).toLocaleDateString('en-GB', { month: 'long' })
  const corePct = si.core_pct ?? 0
  const coreAmt = ytdSpending * (corePct / 100)
  const cats = Object.entries(si.categories ?? {}).sort((a, b) => b[1].annual - a[1].annual)
  const catTotal = cats.reduce((t, [, c]) => t + c.annual, 0)
  const catMax = Math.max(1, ...cats.map(([, c]) => c.annual))
  const ys = moneyUnit(ytdSpending)

  return (
    <div style={{ paddingBottom: 64 }}>
      <MonthlyReviewModal open={reviewOpen} onClose={() => setReviewOpen(false)} />
      <CashflowBreakdownModal open={breakdownOpen} onClose={() => setBreakdownOpen(false)} ytdIncome={ytdIncome} ytdSpending={ytdSpending} netFlow={netFlow} is={is ?? null} />

      <PageHero
        eyebrow={`Cash flow · from transactions.csv${dr ? ` · ${dr.start} → ${dr.end} · ${dr.months} months` : ''} · ${si.csv_rows.toLocaleString()} transactions`}
        before="Spending is " em={pace === 'ahead' ? 'running ahead' : 'on pace'} after="."
        lead={<>
          <span>{fmtMoneyFull(ytdSpending)} spent through {monthName}{budgetSpentPct != null ? ` — ${budgetSpentPct.toFixed(0)}% of the ${fmtMoneyFull(annualTracked)} tracked annual figure, with ${yearElapsedPct.toFixed(0)}% of the year gone` : ''}.{divCover != null ? ` Dividends cover it ${divCover.toFixed(1)} times.` : ''}</span>
          {yoySpendPct != null && <LeadMuted>{yoySpendPct >= 0 ? 'Up' : 'Down'} {Math.abs(yoySpendPct).toFixed(1)}% on {dataYear - 1} at the current run rate of {fmtMoney(ytdRunRateAnnual)} a year.</LeadMuted>}
        </>}
        aside={
          <div style={{ background: 'var(--fd-card)', padding: 32, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><Label>Year elapsed</Label><span style={{ fontWeight: 500 }}>{yearElapsedPct.toFixed(0)}%</span></div>
            <div style={{ position: 'relative', height: 12, background: 'var(--fd-hairline)' }}>
              <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${Math.min(100, budgetSpentPct ?? 0)}%`, background: pace === 'ahead' ? 'var(--fd-negative)' : 'var(--fd-accent)' }} />
              <div style={{ position: 'absolute', top: -4, bottom: -4, left: `${yearElapsedPct}%`, width: 2, background: 'var(--fd-ink)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><Label>Budget spent</Label><span style={{ fontWeight: 500 }}>{budgetSpentPct != null ? `${budgetSpentPct.toFixed(1)}%` : '—'}</span></div>
            <Button size="sm" onClick={() => setReviewOpen(true)} style={{ alignSelf: 'flex-start', marginTop: 8 }}>Monthly review →</Button>
          </div>
        }
      />

      <KpiStrip items={[
        { label: `${dataYear} YTD spending`, value: ys.value, unit: ys.unit, sub: `${currentMonth} months · ${fmtMoneyFull(Math.round(ytdMonthlyAvg))}/mo${lastYearSpending != null ? ` · ${dataYear - 1}: ${fmtMoney(lastYearSpending)}` : ''}` },
        { label: 'Net cash flow', value: <button onClick={() => setBreakdownOpen(true)} className="fd-link" style={{ font: 'inherit', color: gain(netFlow), background: 'none', border: 'none', padding: 0 }}>{signedMoney(netFlow, v => fmtMoney(v))}</button>, status: netFlow >= 0 ? 'ok' : 'alert', sub: `${netFlow >= 0 ? 'Surplus' : 'Deficit'} · select for breakdown` },
        { label: 'Coverage', value: divCover != null ? `${Math.round(divCover * 100)}` : coveragePct != null ? coveragePct.toFixed(0) : '—', unit: '%', status: coveragePct == null ? 'info' : coveragePct >= COVERAGE_OK_PCT ? 'ok' : coveragePct >= COVERAGE_WARN_PCT ? 'warn' : 'alert', sub: 'Taxable + Roth fwd dividends ÷ annual spend' },
        { label: 'Monthly spend', value: moneyUnit(monthlySpendingAvg).value, unit: moneyUnit(monthlySpendingAvg).unit, sub: si.monthly_mean != null ? `±${fmtMoney(si.monthly_stddev)} σ · income ${fmtMoney(monthlyIncomeAvg)}/mo` : 'YTD estimate' },
        { label: 'Savings rate', value: savingsRate.toFixed(1), unit: '%', sub: netFlow >= 0 ? 'Of spendable income saved' : 'Deficit' },
      ]} />

      <Sections>
        <Section title="Monthly spending" meta={<span style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <Swatch c="var(--fd-accent)" t="At or below average" /><Swatch c="var(--fd-lilac-ink)" t="Above average" /><Swatch c="var(--fd-negative)" t="Over 1.5× average" />
        </span>}>
          <MonthlyTimeline si={si} showTable={mode === 'advanced'} />
        </Section>

        <MainRail
          main={<>
            {cats.length > 0 && (
              <Section title="Categories" meta="Annualised · core vs discretionary">
                <RuledList>
                  {cats.map(([name, c]) => (
                    <div key={name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,180px) minmax(0,1fr) 110px 110px', gap: 16, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: c.is_core ? 'var(--fd-accent)' : 'var(--fd-lilac-ink)', flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      </span>
                      <div style={{ height: 10, background: 'var(--fd-hairline)' }}><div style={{ height: 10, width: `${(c.annual / catMax) * 100}%`, background: c.is_core ? 'var(--fd-accent)' : 'var(--fd-lilac-ink)' }} /></div>
                      <span style={{ textAlign: 'right', fontWeight: 500 }}>{fmtMoneyFull(c.annual)}</span>
                      <span style={{ textAlign: 'right', ...muted }}>{catTotal > 0 ? `${((c.annual / catTotal) * 100).toFixed(1)}%` : ''} · {c.count} txns</span>
                    </div>
                  ))}
                </RuledList>
              </Section>
            )}
            <BucketPlan data={data} />
          </>}
          rail={<>
            {data.income_analytics?.payout_calendar && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Dividend payout calendar</h3>
                <DividendCalendar data={data} />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Core vs discretionary</h3>
              <div style={{ display: 'flex', height: 16 }}>
                <div style={{ width: `${corePct}%`, background: 'var(--fd-accent)' }} /><div style={{ width: `${100 - corePct}%`, background: 'var(--fd-lilac-ink)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, gap: 12 }}>
                <span>Core {fmtMoneyFull(coreAmt)} · {corePct.toFixed(0)}%</span><span>Discretionary {fmtMoneyFull(ytdSpending - coreAmt)} · {(100 - corePct).toFixed(0)}%</span>
              </div>
            </div>
            <div style={{ background: 'var(--fd-card)', padding: 24 }}>
              <TabBriefingPanel endpoint="/api/briefing/cashflow" title="Cash flow briefing" />
            </div>
          </>}
        />

        {mode === 'advanced' && (<>
          {coveragePct != null && (
            <Section title="YTD income coverage of spending" meta="Excludes Roth conversions · partial year">
              <div style={{ position: 'relative', height: 16, background: 'var(--fd-hairline)' }}>
                <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${Math.min(100, coveragePct)}%`, background: coveragePct >= COVERAGE_OK_PCT ? 'var(--fd-accent)' : 'var(--fd-negative)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span>Income {fmtMoney(ytdIncome)} · spending {fmtMoney(ytdSpending)}</span>
                <span style={{ fontWeight: 500, color: gain(netFlow) }}>{coveragePct.toFixed(0)}% · {netFlow >= 0 ? `surplus +${fmtMoney(netFlow)}` : `deficit −${fmtMoney(Math.abs(netFlow))}`}</span>
              </div>
            </Section>
          )}
          <Section title="Spending profile" meta="Transaction-based">
            <TileGrid cols={4}>
              <GridTile label="Lifestyle spending" value={fmtMoneyFull(si.true_annual_spending)} sub={`${fmtMoney(si.true_annual_spending / 12)}/mo avg · transaction-based`} />
              <GridTile label="Spending volatility" value={`${si.cashflow_vol_pct.toFixed(1)}%`} status={si.cashflow_vol_pct <= 20 ? 'ok' : si.cashflow_vol_pct <= 40 ? 'watch' : 'warn'} sub={`±${fmtMoney(si.monthly_stddev)}/mo`} />
              <GridTile label="Lifestyle phase" value={si.lifestyle_label} sub={si.lifestyle_note} />
              <GridTile label="Monthly savings" value={<span style={{ color: gain(monthlySavings) }}>{signedMoney(Math.round(monthlySavings), fmtMoneyFull)}</span>} sub="Income average − spending average" />
              {si.taxes_annual > 0 && <GridTile label="Taxes paid · annual" value={fmtMoneyFull(si.taxes_annual)} sub={`${fmtMoney(si.taxes_annual / 12)}/mo · includes Roth conversion tax — not recurring`} />}
              <GridTile label="Savings rate" value={`${savingsRate.toFixed(1)}%`} sub="W2-era rate — post-retirement target is 0–10%" />
            </TileGrid>
          </Section>
          {(si.w2_annual ?? 0) > 0 && <IncomeSourceBreakdown data={data} />}
          {data.income_analytics?.payout_calendar && <TerminalSection id="seasonality" title="Income seasonality"><IncomeSeasonality data={data} /></TerminalSection>}
          {cats.length > 0 && <TerminalSection id="categories" title="Category detail"><CategoryBreakdown si={si} /></TerminalSection>}
          {(si.recurring?.length ?? 0) > 0 && <TerminalSection id="recurring" title="Recurring payments"><RecurringPayments si={si} /></TerminalSection>}
          {(si.shock_events?.length ?? 0) > 0 && <TerminalSection id="shocks" title="Shock events"><ShockEvents si={si} /></TerminalSection>}
        </>)}
      </Sections>
    </div>
  )
}

function Swatch({ c, t }: { c: string; t: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{t}</span>
}


// ── Bucket Plan ────────────────────────────────────────────────────────────────

// ── Income Source Breakdown (W2 + Dividend) ───────────────────────────────────
function IncomeSourceBreakdown({ data }: { data: DashboardData }) {
  const si  = data.spending_intelligence
  const ih  = data.income_history
  const is  = data.income_summary

  // All headline numbers from income_summary — single source of truth
  const w2FullYear  = is?.full_year_w2  ?? 0
  const divFullYear = is?.full_year_div ?? 0
  const totalFullYear = is?.full_year_total ?? 0
  const w2Ytd       = is?.actual_w2     ?? 0
  const divYtd      = is?.actual_div_total ?? 0
  const w2Pct  = totalFullYear > 0 ? (w2FullYear  / totalFullYear * 100) : 0
  const divPct = totalFullYear > 0 ? (divFullYear / totalFullYear * 100) : 0

  // Per-month table: W2 from spending_analytics, dividend from income_history.by_account
  const currentMonth = new Date().getMonth() + 1
  const divByMonth: number[] = Array(12).fill(0)
  const reinvested = new Set(data.income_analytics?.reinvested_accounts ?? [])
  for (const [acctKey, acct] of Object.entries(ih?.by_account ?? {})) {
    if (reinvested.has(acctKey)) continue   // DRIP — not cash income
    const bm = (acct as { by_month?: unknown[] }).by_month ?? []
    bm.forEach((v, i) => {
      const val = typeof v === 'number' ? v : (v as { total?: number })?.total ?? 0
      if (i < 12) divByMonth[i] += val
    })
  }
  const w2MonthMap: Record<string, number> = {}
  for (const row of si.monthly_income_totals ?? []) {
    w2MonthMap[row.month] = row.w2
  }
  const incYear = ih?.year ?? new Date().getFullYear()
  const rows: Array<{ month: string; w2: number; div: number }> = []
  for (let m = currentMonth; m >= 1; m--) {
    const monthKey = `${incYear}-${String(m).padStart(2, '0')}`
    const w2  = w2MonthMap[monthKey] ?? 0
    const div = divByMonth[m - 1]   ?? 0
    if (w2 > 0 || div > 0) rows.push({ month: monthKey, w2, div })
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
        ◈ INCOME SOURCES — W2 + DIVIDEND
      </div>

      {/* Summary cards — all from income_summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 }}>
        <div style={{ padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M, marginBottom: 2 }}>W2 SALARY (FULL YEAR)</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fd-accent)', fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(w2FullYear)}</div>
          <div style={{ fontSize: 12, color: M }}>
            {fmtMoney(w2FullYear / 12)}/mo · YTD actual {fmtMoney(w2Ytd)}
          </div>
        </div>
        <div style={{ padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M, marginBottom: 2 }}>DIVIDEND INCOME (FWD 12M)</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(divFullYear)}</div>
          <div style={{ fontSize: 12, color: M }}>
            {fmtMoney(divFullYear / 12)}/mo · YTD actual {fmtMoney(divYtd)}
          </div>
        </div>
        <div style={{ padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M, marginBottom: 2 }}>TOTAL INCOME</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(totalFullYear)}</div>
          <div style={{ fontSize: 12, color: M }}>W2 {w2Pct.toFixed(0)}% · Div {divPct.toFixed(0)}%</div>
        </div>
      </div>

      {/* W2 / Dividend split bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', height: 12, borderRadius: 0, overflow: 'hidden' }}>
          <div style={{ width: `${w2Pct}%`, background: 'var(--blue)', opacity: 0.8 }} title={`W2 ${w2Pct.toFixed(0)}%`} />
          <div style={{ width: `${divPct}%`, background: 'var(--green)', opacity: 0.8 }} title={`Dividend ${divPct.toFixed(0)}%`} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12, color: M }}>
          <span><span style={{ color: 'var(--fd-accent)' }}>■</span> W2 {w2Pct.toFixed(0)}%</span>
          <span><span style={{ color: G }}>■</span> Dividend {divPct.toFixed(0)}%</span>
          <span style={{ marginLeft: 'auto', color: A }}>After W2 ends: 100% dividend</span>
        </div>
      </div>

      {/* Per-month table — W2 from transactions.csv, Dividend from Schwab income_history */}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="bb-table">
            <thead>
              <tr>
                <th>MONTH</th>
                <th className="r" style={{ color: 'var(--fd-accent)' }}>W2</th>
                <th className="r" style={{ color: G }}>DIVIDEND</th>
                <th className="r">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{row.month}</td>
                  <td className="r" style={{ color: row.w2 > 0 ? 'var(--fd-accent)' : M, fontFamily: 'var(--font-mono)' }}>
                    {row.w2 > 0 ? fmtMoneyFull(row.w2) : '—'}
                  </td>
                  <td className="r" style={{ color: row.div > 0 ? G : M, fontFamily: 'var(--font-mono)' }}>
                    {row.div > 0 ? fmtMoneyFull(row.div) : '—'}
                  </td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    {fmtMoneyFull(row.w2 + row.div)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BucketPlan({ data }: { data: DashboardData }) {
  const tx = data.tax_data
  // Use server-computed state (ANY_TWO multi-condition logic); fall back to gain comparison
  const gains = data.summary.total_pnl
  const abThreshold = tx?.withdrawal_state_ab_threshold ?? WITHDRAWAL_AB_THRESHOLD
  const bcThreshold = tx?.withdrawal_state_bc_threshold ?? WITHDRAWAL_BC_THRESHOLD
  const serverState = tx?.withdrawal_current_state
  const stateIdx    = serverState === 'C' ? 2 : serverState === 'B' ? 1 : serverState === 'A' ? 0
                    : gains < abThreshold ? 0 : gains < bcThreshold ? 1 : 2
  const stateLabel  = ['A · Income-Dominant', 'B · Hybrid', 'C · Capital-Gain-Dominant'][stateIdx]
  const stateColor  = ['var(--green)', 'var(--yellow)', 'var(--red)'][stateIdx]

  // Bucket status — shared canonical calc (this component previously
  // received `annualSpending` as a prop with no fallback to
  // tax_data.spending_true_annual, which could produce NaN/undefined bucket
  // math whenever spending_intelligence.true_annual_spending was absent).
  const { swvxxValue, bucketYearsRequired: bucketYears, requiredBucket, bucketMonths } = computeBucketStatus(data)

  // Sale-target display rules from input.json (data-driven), fallback to hardcoded defaults
  const stateKeys = ['A', 'B', 'C'] as const
  const stateRules = tx?.withdrawal_states?.[stateKeys[stateIdx]]?.rules
  const saleMin         = stateRules?.controlled_sale_target_min
  const saleMax         = stateRules?.controlled_sale_target_max
  const allowSale       = stateRules?.allow_controlled_sale ?? (stateIdx > 0)

  const bucketPct       = requiredBucket > 0 ? Math.min(100, (swvxxValue / requiredBucket) * 100) : 100
  const bucketColor     = bucketPct >= 90 ? G : bucketPct >= 60 ? Y : R
  const bucketYearsLabel = bucketMonths >= 23 ? `${(bucketMonths / 12).toFixed(1)}yr` : `${bucketMonths.toFixed(1)}mo`

  // Refill logic — use data-driven sale targets if available
  const saleRange = (allowSale && saleMin != null && saleMax != null)
    ? `${fmtMoney(saleMin)}–${fmtMoney(saleMax)}/yr`
    : null
  const refillLogic = !allowSale
    ? 'State: A — dividend income refills automatically. No active refill needed.'
    : stateIdx === 1
    ? `State: B — refill via controlled sales${saleRange ? ` (${saleRange})` : ''}. Target ${bucketYears}-year buffer in SWVXX.`
    : `State: C — refill via controlled sales (mandatory)${saleRange ? ` (${saleRange})` : ''}. Maintain ${bucketYears}-year buffer in SWVXX. Dividends route to bucket. Avoid selling when market is down >10%.`

  return (
    <div style={{
      background: 'var(--fd-card)',
      border: `1px solid ${stateColor}`,
      borderTop: `2px solid ${stateColor}`,
      borderRadius: 0, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>
        CASH BUCKET PLAN<MetricTooltip metricId="cash_bucket" label="Cash Bucket" size={9} />
      </div>

      {/* State hero */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Withdrawal State</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 500, color: stateColor, lineHeight: 1 }}>State {String.fromCharCode(65 + stateIdx)}</span>
          <span style={{ fontSize: 12, padding: '2px 7px', borderRadius: 0, background: `${stateColor}26`, color: stateColor }}>{stateLabel.split(' · ')[1] ?? ''}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--fd-muted)', marginTop: 4 }}>{stateLabel}</div>
      </div>

      <div style={{ borderTop: '1px solid var(--fd-hairline)', marginBottom: 14 }} />

      {/* Bucket metrics 2×2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Required Bucket</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: M }}>{requiredBucket > 0 ? fmtMoneyFull(requiredBucket) : 'None'}</div>
          <div style={{ fontSize: 12, color: 'var(--fd-muted)', marginTop: 2 }}>{bucketYears === 0 ? 'divs cover spending' : `${bucketYears}-yr spending reserve`}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Current SWVXX</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: swvxxValue > 0 ? bucketColor : M }}>{swvxxValue > 0 ? fmtMoneyFull(swvxxValue) : '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--fd-muted)', marginTop: 2 }}>{swvxxValue > 0 ? `${bucketYearsLabel} covered` : 'no MM position'}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Bucket Fill</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: bucketColor }}>{requiredBucket > 0 ? `${bucketPct.toFixed(0)}%` : '100%'}</div>
          <div style={{ fontSize: 12, color: 'var(--fd-muted)', marginTop: 2 }}>
            {requiredBucket > 0 ? (bucketPct >= 100 ? '✓ fully funded' : `short ${fmtMoneyFull(requiredBucket - swvxxValue)}`) : 'no bucket required'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {requiredBucket > 0 && (
            <>
              <div style={{ height: 8, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ width: `${bucketPct}%`, height: '100%', background: bucketColor, opacity: 0.8, borderRadius: 0, transition: 'width 0.4s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--fd-muted)' }}>
                <span>$0</span><span style={{ color: bucketColor }}>{fmtMoney(swvxxValue)}</span><span>{fmtMoney(requiredBucket)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--fd-hairline)', marginBottom: 12 }} />

      {/* Refill logic */}
      <div style={{
        padding: '8px 12px', background: `${stateColor}0d`,
        borderRadius: 0, borderLeft: `2px solid ${stateColor}`, fontSize: 12, color: 'var(--text1)',
        fontFamily: 'var(--font-mono)', lineHeight: 1.5,
      }}>
        {refillLogic}
      </div>
    </div>
  )
}

// ── Dividend Payout Calendar ───────────────────────────────────────────────────

function DividendCalendar({ data }: { data: DashboardData }) {
  const cal = data.income_analytics?.payout_calendar
  const defaultAcct = cal?.accounts && 'taxable' in cal.accounts ? 'taxable' : Object.keys(cal?.accounts ?? {})[0] ?? 'taxable'
  const [activeAcct, setActiveAcct] = useState<string>(defaultAcct)
  if (!cal?.accounts || Object.keys(cal.accounts).length === 0) return null

  const colLabels = cal.col_labels
  const acctKeys  = Object.keys(cal.accounts)
  const active    = activeAcct in cal.accounts ? activeAcct : acctKeys[0]
  const acct      = cal.accounts[active]

  const ACCT_LABELS: Record<string, string> = {
    taxable:      'Taxable',
    roth_ira:     'Roth IRA',
    rollover_ira: 'Rollover IRA',
  }

  const tickers = Object.entries(acct.tickers)
    .sort(([a], [b]) => a.localeCompare(b))
  const totals     = acct.monthly_totals
  const grandTotal = totals.reduce((s, v) => s + v, 0)

  const fmtAmt = (v: number) =>
    v > 0
      ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : ''

  const cellBase: React.CSSProperties = {
    textAlign: 'right', padding: '5px 8px',
    whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 12,
  }
  const thBase: React.CSSProperties = {
    textAlign: 'right', padding: '6px 8px',
    fontSize: 12, color: M, fontWeight: 500, whiteSpace: 'nowrap', minWidth: 90,
    background: 'var(--surface)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Sub-header: account switcher + date range */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
          {acctKeys.map(k => (
            <button key={k} onClick={() => setActiveAcct(k)} style={{
              fontSize: 12, fontWeight: 500, padding: '3px 10px', cursor: 'pointer',
              border: `1px solid ${active === k ? G : 'var(--border2)'}`,
              borderRadius: 0,
              background: active === k ? 'var(--fd-card)' : 'transparent',
              color: active === k ? G : M,
            }}>{ACCT_LABELS[k] ?? k}</button>
          ))}
          {active === 'rollover_ira' && (
            <span style={{
              fontSize: 12, padding: '2px 7px', borderRadius: 0,
              background: 'var(--fd-card)', color: A,
              fontFamily: 'var(--font-mono)', fontWeight: 500,
            }}>
               REINVESTED · NOT A SPENDING SOURCE
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: M }}>
          {colLabels[0]} → {colLabels[colLabels.length - 1]} · rolling 12-month projection
        </div>
      </div>

      {/* Scrollable grid */}
      <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border2)' }}>
              <th style={{
                textAlign: 'left', padding: '6px 12px', fontSize: 12, color: M,
                fontWeight: 500, position: 'sticky', left: 0,
                background: 'var(--surface)', minWidth: 72, zIndex: 2,
              }}>TICKER</th>
              {colLabels.map(lbl => (
                <th key={lbl} style={thBase}>{lbl}</th>
              ))}
              <th style={{ ...thBase, color: A, paddingRight: 14, minWidth: 100 }}>ANNUAL</th>
            </tr>
          </thead>
          <tbody>
            {tickers.map(([ticker, months]) => {
              const annual = months.reduce((s, v) => s + v, 0)
              return (
                <tr
                  key={ticker}
                  style={{ borderBottom: '1px solid var(--fd-hairline)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--fd-card)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  <td style={{
                    padding: '5px 12px', position: 'sticky', left: 0,
                    background: 'var(--surface)', fontWeight: 500,
                    fontSize: 12, color: 'var(--text)', zIndex: 1,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {ticker}
                  </td>
                  {months.map((v, i) => (
                    <td key={i} style={{
                      ...cellBase,
                      color: v > 0 ? G: 'var(--fd-hairline)',
                      fontWeight: v > 0 ? 600 : 400,
                    }}>
                      {fmtAmt(v)}
                    </td>
                  ))}
                  <td style={{ ...cellBase, color: A, fontWeight: 500, paddingRight: 14 }}>
                    ${annual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${A}` }}>
              <td style={{
                padding: '7px 12px', position: 'sticky', left: 0,
                background: 'var(--surface)', fontWeight: 500,
                fontSize: 12, color: A, fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase', zIndex: 1,
              }}>Total</td>
              {totals.map((v, i) => (
                <td key={i} style={{
                  ...cellBase, fontSize: 12, fontWeight: 500,
                  color: v > 0 ? A : M,
                }}>
                  {v > 0 ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </td>
              ))}
              <td style={{ ...cellBase, fontSize: 12, fontWeight: 500, color: A, paddingRight: 14 }}>
                ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Cashflow Breakdown Modal ────────────────────────────────────────────────────

import type { IncomeSummary } from '../../types/dashboard'

function CashflowBreakdownModal({
  open, onClose, ytdIncome, ytdSpending, netFlow, is,
}: {
  open: boolean
  onClose: () => void
  ytdIncome: number
  ytdSpending: number
  netFlow: number
  is: IncomeSummary | null
}) {
  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const fmt = (n: number) => fmtMoneyFull(Math.abs(n))
  const pct = (n: number) => ytdIncome > 0 ? `${((n / ytdIncome) * 100).toFixed(1)}%` : '—'

  const rows: { label: string; amount: number; note?: string; color?: string; dimIfZero?: boolean }[] = [
    { label: 'W2 / Salary',            amount: is?.actual_w2 ?? 0,          color: G,  dimIfZero: true },
    { label: 'Dividends — all accounts',amount: is?.actual_div_total ?? 0,   color: G },
    {
      label: '  ↳ Taxable account divs', amount: is?.actual_div_taxable ?? 0,
      color: M, dimIfZero: true,
      note: 'Qualified + ordinary dividends from taxable',
    },
    {
      label: '  ↳ Tax-advantaged divs', amount: is?.actual_div_nontaxable ?? 0,
      color: M, dimIfZero: true,
      note: 'Roth + Rollover IRA dividends (reinvested)',
    },
    { label: 'Realized STCG',          amount: is?.actual_stcg ?? 0,         color: Y,  dimIfZero: true },
    { label: 'Realized LTCG',          amount: is?.actual_ltcg ?? 0,         color: G,  dimIfZero: true },
    {
      label: 'Roth Conversion (YTD)',   amount: is?.actual_conversion ?? 0,   color: A,  dimIfZero: true,
      note: 'Taxable event — IRA→Roth transfer, not a cash inflow',
    },
  ]

  const totalInflows = ytdIncome
  const totalOutflows = ytdSpending
  const flowColor = netFlow >= 0 ? G : R

  const rowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '5px 0', borderBottom: '1px solid var(--fd-hairline)',
    gap: 12,
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(22,22,22,.64)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', border: '1px solid var(--fd-hairline)',
          borderTop: `3px solid ${flowColor}`,
          borderRadius: 0, padding: '20px 24px',
          width: '100%', maxWidth: 560, maxHeight: '85vh',
          overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              ◈ NET CASHFLOW BREAKDOWN
            </div>
            <div style={{ fontSize: 22, fontWeight: 500, color: flowColor, fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              {netFlow >= 0 ? '+' : ''}{fmtMoneyFull(netFlow)}
            </div>
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
              YTD inflows minus YTD lifestyle spending — not a statement of cash available
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--fd-hairline)',
              color: M, cursor: 'pointer', borderRadius: 0, padding: '4px 10px',
              fontSize: 12, fontFamily: 'var(--font-mono)',
            }}
          >✕ CLOSE</button>
        </div>

        {/* Inflows */}
        <div>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>
            YTD INFLOWS
          </div>
          {rows.map(r => {
            const isZero = r.amount === 0
            if (isZero && r.dimIfZero && (is?.actual_w2 === 0 && r.label === 'W2 / Salary')) return null
            const textColor = isZero ? 'var(--fd-muted)' : (r.color ?? 'var(--text)')
            return (
              <div key={r.label} style={rowStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 12, color: textColor, fontWeight: isZero ? 400 : 500 }}>{r.label}</span>
                  {r.note && <span style={{ fontSize: 12, color: 'var(--fd-muted)' }}>{r.note}</span>}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexShrink: 0 }}>
                  <span style={{ fontSize: 12, color: 'var(--fd-muted)', fontFamily: 'var(--font-mono)' }}>
                    {isZero ? '' : pct(r.amount)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: textColor, fontFamily: 'var(--font-mono)', minWidth: 110, textAlign: 'right' }}>
                    {isZero ? '—' : `+${fmt(r.amount)}`}
                  </span>
                </div>
              </div>
            )
          })}

          {/* Total inflows */}
          <div style={{ ...rowStyle, borderBottom: 'none', borderTop: '1px solid var(--fd-hairline)', marginTop: 4, paddingTop: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: G }}>Total YTD Inflows</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>+{fmtMoneyFull(totalInflows)}</span>
          </div>
        </div>

        {/* Outflows */}
        <div>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>
            YTD OUTFLOWS
          </div>
          <div style={rowStyle}>
            <span style={{ fontSize: 12, color: 'var(--text)' }}>Lifestyle spending</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: R, fontFamily: 'var(--font-mono)' }}>−{fmt(totalOutflows)}</span>
          </div>
          <div style={{ ...rowStyle, borderBottom: 'none', borderTop: '1px solid var(--fd-hairline)', marginTop: 4, paddingTop: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: R }}>Total YTD Outflows</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: R, fontFamily: 'var(--font-mono)' }}>−{fmtMoneyFull(totalOutflows)}</span>
          </div>
        </div>

        {/* Net */}
        <div style={{
          background: 'var(--fd-card)',
          border: '1px solid var(--fd-hairline)',
          borderRadius: 0, padding: '12px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase' }}>NET CASHFLOW</div>
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>Total inflows − lifestyle spending</div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 500, color: flowColor, fontFamily: 'var(--font-mono)' }}>
            {netFlow >= 0 ? '+' : ''}{fmtMoneyFull(netFlow)}
          </div>
        </div>

        {/* Caveat */}
        <div style={{ fontSize: 12, color: M, lineHeight: 1.6, borderTop: '1px solid var(--fd-hairline)', paddingTop: 10 }}>
          <strong style={{ color: A }}>Note:</strong> This is <em>portfolio cashflow</em>, not lifestyle income.
          Roth conversions are taxable events (IRA→Roth transfers) counted in YTD income by the IRS but are
          not cash you received to spend. Capital gains appear only when lots are actually sold and settled in Schwab.
          Sweeps, internal transfers, and money-market movements are not separately tracked here.
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────


function MonthlyTimeline({ si, showTable = true }: { si: DashboardData['spending_intelligence']; showTable?: boolean }) {
  // monthly_totals arrives newest-first from server; chart shows oldest→newest left→right
  const totals = si.monthly_totals ?? []
  if (totals.length === 0) return <div style={{ padding: 12, color: M, fontSize: 12 }}>No monthly data.</div>

  const mean = si.monthly_mean ?? (totals.reduce((s, m) => s + m.amount, 0) / totals.length)
  const chartTotals = [...totals].reverse()  // oldest first for chart axis

  return (
    <div>
      {/* Monthly spending bar chart — Recharts */}
      {(() => {
        const chartData = chartTotals.map(mt => ({
          month: mt.month.split('-')[1] ?? mt.month.slice(-2),
          fullMonth: mt.month,
          amount: mt.amount,
          color: mt.amount > mean * 1.5 ? 'var(--fd-negative)' : mt.amount > mean ? 'var(--fd-lilac-ink)' : 'var(--fd-accent)',
        }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tip = ({ active, payload }: any) => {
          if (!active || !payload?.length) return null
          const d = payload[0].payload as typeof chartData[0]
          return (
            <div style={TOOLTIP_STYLE}>
              <div style={TOOLTIP_LABEL_STYLE}>{d.fullMonth}</div>
              <div style={{ color: d.color, fontWeight: 500 }}>{fmtMoneyFull(d.amount)}</div>
              <div style={{ color: 'var(--text2)', fontSize: 12 }}>
                Avg: {fmtMoneyFull(mean)} ({d.amount > mean ? '+' : ''}{fmtMoney(d.amount - mean)})
              </div>
            </div>
          )
        }
        return (
          <div style={{ padding: '0 0 16px' }}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 8, right: 40, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" tick={{ fill: 'var(--fd-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--fd-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={42} />
                <ReferenceLine y={mean} stroke="var(--fd-hairline)" strokeDasharray="4 3" label={{ value: 'AVG', position: 'right', fill: 'var(--text2)', fontSize: 12 }} />
                <Tooltip content={tip} cursor={TOOLTIP_CURSOR} />
                <Bar dataKey="amount" radius={[0, 0, 0, 0]} maxBarSize={40}>
                  {chartData.map((d, i) => (
                    <Cell key={`${d.fullMonth}-${i}`} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      })()}

      {/* Table */}
      {showTable && <div style={{ overflowX: 'auto' }}>
        <table className="bb-table">
          <thead>
            <tr>
              <th>MONTH</th>
              <th className="r">AMOUNT</th>
              <th className="r">VS AVG</th>
              <th>RELATIVE</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((mt, i) => {
              const ratio = mean > 0 ? mt.amount / mean : 1
              const diff = mt.amount - mean
              const diffColor = ratio > 1.5 ? A : ratio > 1.0 ? Y : G
              return (
                <tr key={i}>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{mt.month}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(mt.amount)}</td>
                  <td className="r" style={{ color: diffColor, fontFamily: 'var(--font-mono)' }}>
                    {diff >= 0 ? '+' : ''}{fmtMoney(diff)}
                  </td>
                  <td style={{ width: 120, paddingRight: 12 }}>
                    <MiniBar value={Math.min(200, ratio * 100)} color={diffColor} height={5} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>}
    </div>
  )
}

function IncomeSeasonality({ data }: { data: DashboardData }) {
  const cal = data.income_analytics?.payout_calendar
  if (!cal?.accounts || cal.col_labels.length === 0) return null

  // Sum monthly totals across ALL accounts for each column slot
  const combined = cal.col_labels.map((label, i) => {
    const total = Object.values(cal.accounts).reduce(
      (sum, acct) => sum + (acct.monthly_totals[i] ?? 0), 0
    )
    return { label, total }
  })

  const avg     = combined.reduce((s, d) => s + d.total, 0) / combined.length
  const annual  = combined.reduce((s, d) => s + d.total, 0)
  const stddev  = Math.sqrt(
    combined.reduce((s, d) => s + Math.pow(d.total - avg, 2), 0) / combined.length
  )
  // Spike = month more than 0.75σ above mean — adapts to the actual spread
  // rather than a fixed multiplier, so quarterly ADX bumps are correctly caught
  const spikeThreshold = avg + stddev * 0.75

  // Tooltip
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload as typeof combined[0]
    const diff = d.total - avg
    return (
      <div style={TOOLTIP_STYLE}>
        <div style={TOOLTIP_LABEL_STYLE}>{d.label}</div>
        <div style={{ color: G, fontWeight: 500 }}>{fmtMoneyFull(d.total)}</div>
        <div style={{ color: 'var(--text2)', fontSize: 12 }}>
          {diff >= 0 ? '+' : ''}{fmtMoney(diff)} vs avg
        </div>
        {d.total >= spikeThreshold && (
          <div style={{ color: A, fontSize: 12, marginTop: 2 }}>▲ quarterly peak</div>
        )}
      </div>
    )
  }

  const chartData = combined.map(d => ({
    ...d,
    color: d.total >= spikeThreshold          ? A   // spike = amber
          : d.total >= avg                    ? Y   // above avg = yellow
          : G,                                      // normal/low = green
  }))

  // identify spike months for the legend
  const spikeLabels = combined
    .filter(d => d.total >= spikeThreshold)
    .map(d => d.label)

  return (
    <div>
      {/* Chart */}
      <div style={{ padding: '8px 12px 0' }}>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 44 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--text2)', fontSize: 12 }}
              axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--text2)', fontSize: 12 }} axisLine={false} tickLine={false}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={42} />
            <ReferenceLine y={avg} stroke="var(--fd-hairline)" strokeDasharray="4 3"
              label={{ value: 'AVG', position: 'right', fill: 'var(--text2)', fontSize: 12 }} />
            <Tooltip content={tip} cursor={TOOLTIP_CURSOR} />
            <Bar dataKey="total" radius={[2, 2, 0, 0]} maxBarSize={30}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.color} fillOpacity={0.88} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend row */}
      <div style={{ padding: '6px 12px 10px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: M }}>
          {[
            { color: A, label: 'Quarterly peak (>avg+0.75σ)' },
            { color: Y, label: 'Above avg' },
            { color: G, label: 'Normal / low' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 0, background: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
          <span>Annual est. <span style={{ color: G, fontWeight: 500 }}>{fmtMoneyFull(annual)}</span></span>
          <span style={{ marginLeft: 10 }}>Avg/mo <span style={{ color: G, fontWeight: 500 }}>{fmtMoney(avg)}</span></span>
          {spikeLabels.length > 0 && (
            <span style={{ marginLeft: 10, color: A }}>
              Quarterly peaks: {spikeLabels.join(', ')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function CategoryBreakdown({ si }: { si: DashboardData['spending_intelligence'] }) {
  const categories = si.categories ?? {}
  const entries = Object.entries(categories).sort((a, b) => b[1].annual - a[1].annual)
  const totalAnnual = entries.reduce((s, [, c]) => s + c.annual, 0)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="bb-table">
        <thead>
          <tr>
            <th>CATEGORY</th>
            <th>TYPE</th>
            <th className="r">ANNUAL</th>
            <th className="r">MONTHLY</th>
            <th className="r">% OF SPEND</th>
            <th className="r">TXNS</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, cat]) => {
            const pct = totalAnnual > 0 ? (cat.annual / totalAnnual) * 100 : 0
            return (
              <tr key={name}>
                <td>{name}</td>
                <td>
                  <span style={{
                    fontSize: 12, fontWeight: 500, padding: '1px 5px',
                    background: cat.is_core ? 'var(--fd-card)' : 'var(--fd-card)',
                    color: cat.is_core ? G : A, borderRadius: 0,
                  }}>
                    {cat.is_core ? 'CORE' : 'DISC'}
                  </span>
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(cat.annual)}</td>
                <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>{fmtMoney(cat.monthly_avg)}</td>
                <td className="r">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{pct.toFixed(1)}%</span>
                    <MiniBar value={pct} color={cat.is_core ? G : A} width={50} height={4} />
                  </div>
                </td>
                <td className="r" style={{ color: M, fontSize: 12 }}>{cat.count}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RecurringPayments({ si }: { si: DashboardData['spending_intelligence'] }) {
  const recurring = si.recurring ?? []
  if (recurring.length === 0) return <div style={{ padding: 12, color: M, fontSize: 12 }}>No recurring payments detected.</div>

  const totalMonthly = recurring.reduce((s, r) => s + r.monthly_avg, 0)
  const dataYear = si.date_range?.end ? parseInt(si.date_range.end.slice(0, 4), 10) : new Date().getFullYear()

  // Housing double-count: warn if both mortgage and rent appear simultaneously
  const hasMortgage = recurring.some(r =>
    /mortgage/i.test(r.description) || /mortgage/i.test(r.category))
  const hasRent = recurring.some(r =>
    /^rent$/i.test(r.category) || /\brent\b/i.test(r.description))

  // Classify: habitual = discretionary recurring (dining, coffee, subscriptions)
  // Fixed = contractual obligations (mortgage, utilities, insurance, loan)
  const isHabitual = (r: typeof recurring[0]) =>
    /dining|restaurant|food|coffee|subscri/i.test(r.category) ||
    /dining|restaurant|coffee/i.test(r.description)

  return (
    <div>
      <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: M }}>{recurring.length} RECURRING PAYMENTS DETECTED</span>
        <span style={{ color: A, fontWeight: 500 }}>{fmtMoneyFull(totalMonthly)}/mo total (lifetime avg)</span>
      </div>
      {hasMortgage && hasRent && (
        <div style={{
          margin: '0 12px 8px', padding: '6px 10px',
          background: 'var(--fd-card)', borderLeft: `2px solid ${A}`,
          borderRadius: 0, fontSize: 12, color: A,
        }}>
           Both Mortgage and Rent detected — verify this is not a double-count of housing costs
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="bb-table">
          <thead>
            <tr>
              <th>PAYEE</th>
              <th>TYPE</th>
              <th>CATEGORY</th>
              <th className="r">{dataYear} /MO</th>
              <th className="r">{dataYear - 1} /MO</th>
              <th className="r">YoY</th>
              <th className="r">MONTHS SEEN</th>
            </tr>
          </thead>
          <tbody>
            {recurring.sort((a, b) => b.monthly_avg - a.monthly_avg).map((r, i) => {
              const habitual = isHabitual(r)
              const thisYr = r.this_year_avg ?? null
              const lastYr = r.last_year_avg ?? null
              const yoyPct = thisYr != null && lastYr != null && lastYr > 0
                ? ((thisYr - lastYr) / lastYr) * 100
                : null
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{r.description}</td>
                  <td>
                    <span style={{
                      fontSize: 12, fontWeight: 500, padding: '1px 5px', borderRadius: 0,
                      background: habitual ? 'var(--fd-card)' : 'var(--fd-card)',
                      color: habitual ? A : G,
                    }}>
                      {habitual ? 'HABITUAL' : 'FIXED'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: M }}>{r.category}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    {thisYr != null ? fmtMoney(thisYr) : '—'}
                  </td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: M }}>
                    {lastYr != null ? fmtMoney(lastYr) : '—'}
                  </td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: yoyPct == null ? M : yoyPct > 5 ? R : yoyPct < -5 ? G : M }}>
                    {yoyPct == null ? '—' : `${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(0)}%`}
                  </td>
                  <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>{r.months_seen}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ShockEvents({ si }: { si: DashboardData['spending_intelligence'] }) {
  const events = si.shock_events ?? []
  const dataYear = si.date_range?.end ? parseInt(si.date_range.end.slice(0, 4), 10) : new Date().getFullYear()
  const [yearFilter, setYearFilter] = useState<'this' | 'last' | 'all'>('this')

  if (events.length === 0) return <div style={{ padding: 12, color: M, fontSize: 12 }}>No shock events detected.</div>

  const thisYearEvents = events.filter(e => e.date.startsWith(String(dataYear)))
  const lastYearEvents = events.filter(e => e.date.startsWith(String(dataYear - 1)))
  const olderEvents = events.length - thisYearEvents.length - lastYearEvents.length

  const shown = yearFilter === 'this' ? thisYearEvents : yearFilter === 'last' ? lastYearEvents : events
  const totalShocks = shown.reduce((s, e) => s + e.amount, 0)
  const totalAll = events.reduce((s, e) => s + e.amount, 0)

  const TAB = ({ k, label, count }: { k: 'this' | 'last' | 'all'; label: string; count: number }) => (
    <button
      onClick={() => setYearFilter(k)}
      style={{
        fontSize: 12, fontWeight: 500, padding: '3px 10px', cursor: 'pointer',
        border: `1px solid ${yearFilter === k ? R : 'var(--border2)'}`,
        borderRadius: 0,
        background: yearFilter === k ? 'var(--fd-card)' : 'transparent',
        color: yearFilter === k ? R : M,
      }}
    >{label} ({count})</button>
  )

  return (
    <div>
      <div style={{ padding: '8px 12px 4px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <TAB k="this" label={`${dataYear}`} count={thisYearEvents.length} />
        <TAB k="last" label={`${dataYear - 1}`} count={lastYearEvents.length} />
        <TAB k="all" label="ALL" count={events.length} />
        {olderEvents > 0 && (
          <span style={{ fontSize: 12, color: M, alignSelf: 'center', marginLeft: 4 }}>
            +{olderEvents} older
          </span>
        )}
      </div>
      <div style={{ padding: '4px 12px 8px', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: R }}>{shown.length} SHOCK EVENTS (≥$1,500)</span>
        <span style={{ color: R, fontWeight: 500 }}>{fmtMoneyFull(totalShocks)} total</span>
      </div>
      {yearFilter === 'all' && (() => {
        const annualizedShocks = (totalAll / Math.max(si.date_range?.months ?? 12, 1)) * 12
        return (
          <div style={{ padding: '0 12px 8px', fontSize: 12, color: A }}>
             Annualized shock rate: <strong>{fmtMoneyFull(annualizedShocks)}/yr</strong>
            {' '}({(annualizedShocks / si.true_annual_spending * 100).toFixed(1)}% of annual spending)
            <span style={{ color: M, marginLeft: 8 }}>· includes one-time events — review individually to identify structural vs non-recurring</span>
          </div>
        )
      })()}
      {shown.length === 0 ? (
        <div style={{ padding: 12, color: M, fontSize: 12 }}>No shock events in this period.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="bb-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>DESCRIPTION</th>
                <th>CATEGORY</th>
                <th className="r">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {[...shown].sort((a, b) => b.amount - a.amount).map((e, i) => (
                <tr key={i}>
                  <td style={{ color: M, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{e.date}</td>
                  <td>{e.description}</td>
                  <td style={{ fontSize: 12, color: M }}>{e.category}</td>
                  <td className="r" style={{ color: R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    {fmtMoneyFull(e.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
