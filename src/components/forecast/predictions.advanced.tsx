import React, { useState, useEffect } from 'react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { TerminalSection, PanelHeader } from '../ui/Terminal'
import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import {
  BASE_C, BULL_C, BEAR_C, EXP_C, TAX_C, M, DIM,
  PRICE_GROWTH, DIV_GROWTH, EXPENSE_INFLATION, SNAP_KEY,
  type Scenario, type Horizon, type ProjYear, type PredSnapshot,
} from './predictions.constants'
import { fmtK, fmtPct, MoneyTooltip } from './predictions.helpers'
import { buildIncomeByType } from './predictions.engine'
import { IncomeExpensesChart, CashflowChart } from './predictions.charts'

// ─── Advanced Mode Sections ────────────────────────────────────────────────────

/** Section B — Income + stacked area by account + YOC table */
export function SectionB_Advanced({ allChartData, baseProj, data }: {
  allChartData: { year: number; base: number; bull: number; bear: number; expenses: number }[]
  baseProj: ProjYear[]; data: DashboardData
}) {
  // Per-symbol income: scan positions for forward annual income + type
  // position.annual_income is the forward income figure (same source as detail tab)
  const tickers: { sym: string; type: string; income: number; value: number }[] = []
  for (const acct of data.accounts) {
    for (const p of acct.positions) {
      if (p.is_money_market) continue
      const fc   = data.fund_configs[p.symbol]
      const type = fc?.FUND_TYPE ?? p.fund_type ?? 'UNKNOWN'
      const ex   = tickers.find(t => t.sym === p.symbol)
      if (ex) { ex.income += p.annual_income; ex.value += p.value }
      else tickers.push({ sym: p.symbol, type, income: p.annual_income, value: p.value })
    }
  }

  tickers.sort((a, b) => b.income - a.income)
  const ia = data.income_analytics
  // Yield-on-cost spans every account's holdings, so include reinvested income too
  const totalIncome = ia?.portfolio_fwd_12m_all ?? ia?.portfolio_fwd_12m ?? tickers.reduce((s, t) => s + t.income, 0)
  // YOC denominator = actual cost basis (what you paid), not portfolio value
  const costBasis = data.summary?.total_cost ?? 0

  // Account-level stacked area data
  // income_analytics.by_account uses key "forward_12m_income" (not fwd_12m)
  // account_mapping.json: keys are taxable | rollover_ira | roth_ira
  const { incByAcct, serverTotal: income0B } = buildIncomeByType(data)
  const txInc0 = incByAcct['taxable']      ?? 0
  const roInc0 = incByAcct['rollover_ira'] ?? 0
  const rtInc0 = incByAcct['roth_ira']     ?? 0
  const txShare = income0B > 0 ? txInc0 / income0B : 0.5
  const roShare = income0B > 0 ? roInc0 / income0B : 0.3
  const rtShare = income0B > 0 ? rtInc0 / income0B : 0.2
  const acctChartData = baseProj.map(r => ({
    year: r.calYear,
    taxable:  r.annualIncome * txShare,
    rollover: r.annualIncome * roShare,
    roth:     r.annualIncome * rtShare,
  }))

  return (
    <TerminalSection id="pred-b" title="B. DIVIDEND & INCOME PROJECTION" defaultOpen>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <IncomeExpensesChart chartData={allChartData} />

        {/* Two-column panel: Income Engine (left) | Quality Risk (right) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

          {/* LEFT — Income Engine */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              padding: '4px 10px', background: 'var(--fd-card)',
              border: '1px solid var(--fd-hairline)', borderLeft: '3px solid var(--green)',
              fontSize: 12, fontWeight: 500, color: 'var(--green)', fontFamily: 'var(--font-mono)',
              letterSpacing: '0.5px', borderRadius: 0,
            }}> INCOME ENGINE</div>

            {/* Income by ticker — primary */}
            <div style={{ background: 'var(--surface)', padding: '10px 12px', border: '1px solid var(--fd-hairline)', borderRadius: 0, flex: 1 }}>
              <PanelHeader>INCOME BY TICKER (FWD 12M)</PanelHeader>
              <table className="bb-table" style={{ width: '100%', marginTop: 4 }}>
                <thead><tr><th>SYM</th><th>TYPE</th><th className="r">ANN. INC</th><th className="r">% TOTAL</th><th className="r">YOC</th></tr></thead>
                <tbody>
                  {tickers.slice(0, 15).map(t => (
                    <tr key={t.sym}>
                      <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{t.sym}</td>
                      <td style={{ color: DIM, fontSize: 12 }}>{t.type}</td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: BULL_C }}>{fmtMoneyFull(t.income)}</td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: M }}>{totalIncome > 0 ? ((t.income / totalIncome) * 100).toFixed(1) : '—'}%</td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: M }}>{t.value > 0 ? ((t.income / t.value) * 100).toFixed(2) : '—'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Income by account — secondary */}
            <div style={{ background: 'var(--surface)', padding: '10px 12px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
              <PanelHeader>INCOME BY ACCOUNT TYPE (BASE, PROJECTED)</PanelHeader>
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={acctChartData} margin={{ top: 4, right: 8, bottom: 0, left: 50 }}>
                  <XAxis dataKey="year" tick={{ fill: M, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: M, fontSize: 12 }} tickFormatter={fmtK} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Area type="monotone" dataKey="taxable"  name="Taxable"               stackId="1" stroke={BASE_C} fill={BASE_C} fillOpacity={0.13} />
                  <Area type="monotone" dataKey="rollover" name="Rollover IRA (reinvested — not spendable)" stackId="1" stroke={DIM}    fill={DIM} fillOpacity={0.09} strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="roth"     name="Roth IRA"              stackId="1" stroke={BULL_C} fill={BULL_C} fillOpacity={0.13} />
                </AreaChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 12, color: DIM, marginTop: 4 }}>
                Rollover IRA income accumulates inside the IRA (not spendable cash) — it becomes accessible only via taxable conversion.
                Spendable projection uses Taxable + Roth only.
              </div>
            </div>
          </div>

          {/* RIGHT — Quality / Risk */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              padding: '4px 10px', background: 'var(--fd-card)',
              border: '1px solid var(--fd-hairline)', borderLeft: '3px solid var(--red)',
              fontSize: 12, fontWeight: 500, color: 'var(--red)', fontFamily: 'var(--font-mono)',
              letterSpacing: '0.5px', borderRadius: 0,
            }}> STRUCTURAL RISK</div>

            {/* YOC table */}
            <div style={{ background: 'var(--surface)', padding: '10px 12px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
              <PanelHeader>YIELD-ON-COST OVER TIME (BASE)</PanelHeader>
              <table className="bb-table" style={{ width: '100%', marginTop: 4 }}>
                <thead><tr><th>YR</th><th className="r">INCOME</th><th className="r">YOC</th><th className="r">MO AVG</th></tr></thead>
                <tbody>
                  {allChartData.slice(1).map(r => {
                    const yoc = costBasis > 0 ? (r.base / costBasis) * 100 : 0
                    return (
                      <tr key={r.year}>
                        <td style={{ color: M, fontSize: 12 }}>{r.year}</td>
                        <td className="r" style={{ fontFamily: 'var(--font-mono)', color: BASE_C }}>{fmtK(r.base)}</td>
                        <td className="r" style={{ fontFamily: 'var(--font-mono)', color: yoc > 6 ? BULL_C : M }}>{yoc.toFixed(2)}%</td>
                        <td className="r" style={{ fontFamily: 'var(--font-mono)', color: DIM }}>{fmtK(r.base / 12)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </TerminalSection>
  )
}

/** Section C — NAV & Premium heatmap grid (like portfolio map in Summary tab) */
export function SectionC_Advanced({ data, scenario, horizon }: { data: DashboardData; scenario: Scenario; horizon: Horizon }) {
  interface NavRow { sym: string; type: string; navNow: number; premNow: number; navProj: number; premProj: number; ttmYield: number; navChg: number }
  const rows: NavRow[] = []
  const seen = new Set<string>()
  for (const acct of data.accounts) {
    for (const p of acct.positions) {
      if (p.is_money_market || seen.has(p.symbol)) continue
      seen.add(p.symbol)
      const sn = data.snapshots[p.symbol]; const fc = data.fund_configs[p.symbol]
      if (!sn) continue
      const type   = fc?.FUND_TYPE ?? p.fund_type ?? 'UNKNOWN'
      const navNow = sn.nav || sn.price; const premNow = sn.premium ?? 0
      const pg     = PRICE_GROWTH[type]?.[scenario] ?? PRICE_GROWTH.UNKNOWN[scenario]
      const navProj = navNow * Math.pow(1 + pg, horizon)
      // Premium mean-reversion: -15%/yr in base/bull (gradual), -35%/yr in bear (crisis speed)
      const premMRV  = scenario === 'bear' ? 0.65 : 0.85
      const premProj = premNow * Math.pow(premMRV, horizon)
      const navChg  = navNow > 0 ? (navProj - navNow) / navNow : 0
      rows.push({ sym: p.symbol, type, navNow, premNow, navProj, premProj, ttmYield: (sn.ttm_yield ?? 0) * 100, navChg })
    }
  }

  // Group by type for zone headers
  const TYPE_ORDER = ['CEF', 'OPTION_INCOME', 'DIVIDEND', 'GROWTH', 'MONEY_MARKET', 'UNKNOWN']
  const TYPE_LABEL: Record<string, string> = {
    CEF: 'CEF', OPTION_INCOME: 'OPTION INCOME', DIVIDEND: 'DIVIDEND ETF',
    GROWTH: 'GROWTH ETF', MONEY_MARKET: 'MONEY MARKET', UNKNOWN: 'OTHER',
  }

  const byType = TYPE_ORDER.map(t => ({ type: t, items: rows.filter(r => r.type === t) })).filter(g => g.items.length > 0)

  return (
    <TerminalSection id="pred-c" title="C. NAV & PREMIUM FORECAST" defaultOpen>
      <div style={{ marginBottom: 6, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: DIM }}>
          Color = projected NAV direction over {horizon}Y · Intensity = magnitude · Premium shown for CEF/Option-income
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 12, color: BULL_C }}>■ GROWING</span>
          <span style={{ fontSize: 12, color: EXP_C  }}>■ FLAT / MANAGED</span>
          <span style={{ fontSize: 12, color: BEAR_C }}>■ DECLINING</span>
        </div>
      </div>

      {byType.map(({ type, items }) => (
        <div key={type} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: DIM, fontWeight: 500, letterSpacing: '1.2px', marginBottom: 5, textTransform: 'uppercase' }}>
            {TYPE_LABEL[type] ?? type} ({items.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {items.sort((a, b) => b.navChg - a.navChg).map(r => {
              // Color by direction + intensity
              const intensity = Math.min(Math.abs(r.navChg), 0.5) / 0.5  // 0–1 scale up to ±50%
              let bg: string, border: string
              if (r.navChg > 0.03) {
                bg = `rgba(0,200,83,${0.07 + intensity * 0.18})`
                border = `rgba(0,200,83,${0.2 + intensity * 0.4})`
              } else if (r.navChg < -0.03) {
                bg = `rgba(255,23,68,${0.07 + intensity * 0.18})`
                border = `rgba(255,23,68,${0.2 + intensity * 0.4})`
              } else {
                bg = 'var(--fd-card)'
                border = 'var(--fd-card)'
              }
              const labelColor = r.navChg > 0.03 ? BULL_C : r.navChg < -0.03 ? BEAR_C : EXP_C
              const hasPrem = type === 'CEF' || type === 'OPTION_INCOME'
              const premAlerted = hasPrem && Math.abs(r.premNow) > 5

              return (
                <div
                  key={r.sym}
                  title={`${r.sym} · NAV ${fmtMoneyFull(r.navNow)} → ${fmtMoneyFull(r.navProj)} (${r.navChg >= 0 ? '+' : ''}${(r.navChg * 100).toFixed(0)}%) · TTM yield ${r.ttmYield.toFixed(2)}%${hasPrem ? ` · Premium ${r.premNow.toFixed(1)}% → ${r.premProj.toFixed(1)}%` : ''}`}
                  style={{
                    padding: '7px 10px', background: bg, border: `1px solid ${border}`,
                    minWidth: 72, maxWidth: 96, textAlign: 'center', cursor: 'default',
                    position: 'relative', borderRadius: 0,
                  }}
                >
                  {/* Premium alert pip */}
                  {premAlerted && (
                    <div style={{ position: 'absolute', top: 2, right: 3, fontSize: 12, color: EXP_C, fontWeight: 500 }}>
                      {r.premNow > 0 ? '↑' : '↓'}P
                    </div>
                  )}
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: labelColor }}>{r.sym}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: labelColor, marginTop: 2 }}>
                    {r.navChg >= 0 ? '+' : ''}{(r.navChg * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 12, color: M, marginTop: 1 }}>{r.ttmYield.toFixed(1)}% yld</div>
                  {hasPrem && r.premNow !== 0 && (
                    <div style={{ fontSize: 12, color: Math.abs(r.premNow) > 5 ? EXP_C : DIM, marginTop: 1 }}>
                      prem {r.premNow > 0 ? '+' : ''}{r.premNow.toFixed(1)}%
                    </div>
                  )}
                  {hasPrem && r.premNow === 0 && (
                    <div style={{ fontSize: 12, color: DIM, marginTop: 1 }}>prem 0% · no impact</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 12, color: DIM, marginTop: 4 }}>
        Hover any tile for NAV path detail. Premium mean-reversion: −15%/yr (base/bull) · −35%/yr (bear).
      </div>
    </TerminalSection>
  )
}

/** Section D — Tax projection as a clear year-by-year table (no chart — was unreadable) */
export function SectionD_Advanced({ baseProj, bullProj, bearProj }: { baseProj: ProjYear[]; bullProj: ProjYear[]; bearProj: ProjYear[] }) {
  return (
    <TerminalSection id="pred-d" title="D. TAX PROJECTION — FULL BREAKDOWN" defaultOpen>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <table className="bb-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>YEAR</th><th>AGE</th>
              <th className="r">GROSS INC</th>
              <th className="r">STD DED</th>
              <th className="r">TAXABLE</th>
              <th className="r" style={{ color: TAX_C }}>FED TAX</th>
              <th className="r">EFF%</th>
              <th className="r">BRACKET</th>
              <th className="r">NIIT</th>
              <th className="r" style={{ color: BULL_C }}>LTCG 0% ROOM</th>
            </tr>
          </thead>
          <tbody>
            {baseProj.map((r, i) => {
              const topBracket  = r.bracketSlices[r.bracketSlices.length - 1]?.rate ?? 0
              const bracketColor = topBracket >= 0.32 ? BEAR_C : topBracket >= 0.24 ? EXP_C : M
              return (
                <React.Fragment key={r.calYear}>
                  <tr>
                    <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{r.calYear}</td>
                    <td style={{ color: M, fontSize: 12 }}>{r.age}</td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)', color: BASE_C }}>
                      {fmtK(r.grossIncome)}
                      {r.ssIncome > 0 && <span style={{ fontSize: 12, color: DIM }}> SS+{fmtK(r.ssIncome)}</span>}
                      {r.convIncome > 0 && <span style={{ fontSize: 12, color: TAX_C }}> (incl. {fmtK(r.convIncome)} conv)</span>}
                    </td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)', color: DIM }}>({fmtK(r.stdDeduction)})</td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{fmtK(r.taxableIncome)}</td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)', color: TAX_C, fontWeight: 500 }}>{fmtK(r.federalTax)}</td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.effectiveRate > 0.24 ? BEAR_C : r.effectiveRate > 0.18 ? EXP_C : M }}>{fmtPct(r.effectiveRate)}</td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: bracketColor }}>{(topBracket * 100).toFixed(0)}%</td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.niitAmount > 0 ? EXP_C : DIM }}>{r.niitAmount > 0 ? fmtK(r.niitAmount) : '—'}</td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.ltcgCapacity > 10_000 ? BULL_C : r.ltcgCapacity > 0 ? EXP_C : DIM }}
                      title={r.ltcgCapacity === 0 ? 'Income exceeds 0% LTCG threshold — all LTCG taxed at 15% + 3.8% NIIT = 18.8%' : undefined}>
                      {r.ltcgCapacity > 0 ? fmtK(r.ltcgCapacity) : 'N/A'}
                    </td>
                  </tr>
                  {/* Bull / Bear comparison sub-row */}
                  <tr style={{ background: 'var(--fd-card)' }}>
                    <td colSpan={2} style={{ fontSize: 12, color: DIM, paddingLeft: 12 }}>▶ bull / bear</td>
                    <td className="r" style={{ fontSize: 12 }}>
                      <span style={{ color: BULL_C }}>{fmtK(bullProj[i]?.grossIncome)}</span>
                      <span style={{ color: DIM }}> / </span>
                      <span style={{ color: BEAR_C }}>{fmtK(bearProj[i]?.grossIncome)}</span>
                    </td>
                    <td />
                    <td className="r" style={{ fontSize: 12 }}>
                      <span style={{ color: BULL_C }}>{fmtK(bullProj[i]?.taxableIncome)}</span>
                      <span style={{ color: DIM }}> / </span>
                      <span style={{ color: BEAR_C }}>{fmtK(bearProj[i]?.taxableIncome)}</span>
                    </td>
                    <td className="r" style={{ fontSize: 12 }}>
                      <span style={{ color: BULL_C }}>{fmtK(bullProj[i]?.federalTax)}</span>
                      <span style={{ color: DIM }}> / </span>
                      <span style={{ color: BEAR_C }}>{fmtK(bearProj[i]?.federalTax)}</span>
                    </td>
                    <td /><td /><td />
                    <td className="r" style={{ fontSize: 12 }}>
                      <span style={{ color: BULL_C }}>{fmtK(bullProj[i]?.ltcgCapacity)}</span>
                      <span style={{ color: DIM }}> / </span>
                      <span style={{ color: BEAR_C }}>{fmtK(bearProj[i]?.ltcgCapacity)}</span>
                    </td>
                  </tr>
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: DIM }}>
          Base case only. Bull/bear sub-rows show gross income and tax comparison per year.
          Bracket = top marginal rate on portfolio income.
          LTCG 0% ROOM = headroom before 15% rate kicks in; N/A = income already exceeds threshold,
          all LTCG taxed at 15% + 3.8% NIIT = <strong style={{ color: EXP_C }}>18.8% effective</strong>.
        </div>
      </div>
    </TerminalSection>
  )
}

/** Section E — Cashflow detail (advanced mode — full table, no line chart) */
export function SectionE_Advanced({ baseProj, bullProj, bearProj, expBase }: {
  baseProj: ProjYear[]; bullProj: ProjYear[]; bearProj: ProjYear[]; expBase: number
}) {
  // Bear case runway: how long the terminal portfolio value lasts at the terminal deficit rate.
  // This is the real risk question — a growing deficit against a declining portfolio.
  const bearLast = bearProj[bearProj.length - 1]
  const bearRunway = bearLast && bearLast.netCashflow < 0 && bearLast.portfolioValue > 0
    ? Math.floor(bearLast.portfolioValue / Math.abs(bearLast.netCashflow))
    : null
  const bearRunwayAge = bearRunway != null && bearLast ? bearLast.age + bearRunway : null

  return (
    <TerminalSection id="pred-e" title="E. CASHFLOW PROJECTION" defaultOpen>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CashflowChart baseProj={baseProj} bullProj={bullProj} bearProj={bearProj} />
        {bearRunway != null && bearLast && (
          <div style={{
            padding: '6px 12px', background: 'var(--fd-card)',
            border: `1px solid ${BEAR_C}`, borderLeft: `3px solid ${BEAR_C}`,
            borderRadius: 0, fontSize: 12, color: BEAR_C,
          }}>
             <strong>Bear case portfolio runway:</strong> at {bearLast.calYear} deficit of{' '}
            <strong>{fmtK(Math.abs(bearLast.netCashflow))}/yr</strong> against a{' '}
            <strong>{fmtK(bearLast.portfolioValue)}</strong> portfolio —{' '}
            ~<strong>{bearRunway} years</strong> until depletion
            {bearRunwayAge != null ? ` (age ${bearRunwayAge})` : ''}.
            {' '}Activate State C controlled-sale plan before bear scenario materializes.
          </div>
        )}
        <div style={{ fontSize: 12, color: DIM }}>
          Expense base: {fmtMoneyFull(expBase)}/yr (lifestyle — travel, medical, discretionary, taxes excluded).
          Inflation: base {(EXPENSE_INFLATION.base * 100).toFixed(1)}% / bull {(EXPENSE_INFLATION.bull * 100).toFixed(1)}% / bear {(EXPENSE_INFLATION.bear * 100).toFixed(1)}%.
        </div>
      </div>
    </TerminalSection>
  )
}

/** Section G — Symbol forward with inline sparklines */
export function SectionG_Advanced({ data, scenario, horizon }: { data: DashboardData; scenario: Scenario; horizon: Horizon }) {
  // Aggregate positions by symbol across all accounts (a symbol may appear in multiple accounts)
  const symMap = new Map<string, { value: number; annual_income: number; fund_type: string | undefined }>()
  for (const acct of data.accounts) {
    for (const p of acct.positions) {
      if (p.is_money_market) continue
      const existing = symMap.get(p.symbol)
      if (existing) {
        existing.value += p.value
        existing.annual_income += p.annual_income
      } else {
        symMap.set(p.symbol, { value: p.value, annual_income: p.annual_income, fund_type: p.fund_type })
      }
    }
  }
  // Symbols with target_weight = 0 are scheduled for full exit — projecting their 5Y income
  // creates a false picture since they'll be sold. Mark them explicitly.
  const exitSymbols = new Set(
    (data.taxable_target_analysis ?? [])
      .filter(t => t.target_weight === 0)
      .map(t => t.symbol)
  )

  const rows: { sym: string; type: string; valNow: number; incNow: number; valProj: number; incProj: number; yocProj: number; premNow: number; premProj: number; signal: string; signalColor: string; spark: { y: number; v: number }[] }[] = []
  for (const [sym, pos] of symMap) {
    const type = pos.fund_type ?? 'UNKNOWN'; const sn = data.snapshots[sym]
    const pg = PRICE_GROWTH[type]?.[scenario] ?? PRICE_GROWTH.UNKNOWN[scenario]
    const dg = DIV_GROWTH[type]?.[scenario]  ?? DIV_GROWTH.UNKNOWN[scenario]
    const spark = Array.from({ length: horizon }, (_, i) => ({ y: i + 1, v: pos.value * Math.pow(1 + pg, i + 1) }))
    let signal = 'HOLD', signalColor = M
    if (exitSymbols.has(sym)) { signal = `EXIT SCHEDULED — reduce to 0%`; signalColor = BEAR_C }
    else if (type === 'OPTION_INCOME' && dg < 0) { signal = 'WATCH — income decay'; signalColor = EXP_C }
    else if (type === 'CEF' && Math.abs(sn?.premium ?? 0) > 10) { signal = (sn?.premium ?? 0) > 0 ? 'OVERPRICED' : 'DISCOUNT OPPTY'; signalColor = (sn?.premium ?? 0) > 0 ? BEAR_C : BULL_C }
    else if (pg < 0) { signal = 'DEFENSIVE'; signalColor = BEAR_C }
    else if (dg > 0.05) { signal = 'INCOME GROWER'; signalColor = BULL_C }
    else if (pg > 0.10) { signal = 'GROWTH ENGINE'; signalColor = BULL_C }
    const valProjG = pos.value * Math.pow(1 + pg, horizon)
    const incProjG = pos.annual_income * Math.pow(1 + dg, horizon)
    // CEF premium: -15%/yr base/bull, -35%/yr bear (mean-reversion is slower outside crisis)
    const premMRV  = scenario === 'bear' ? 0.65 : 0.85
    rows.push({ sym, type, valNow: pos.value, incNow: pos.annual_income, valProj: valProjG, incProj: incProjG, yocProj: valProjG > 0 ? incProjG / valProjG : 0, premNow: sn?.premium ?? 0, premProj: (sn?.premium ?? 0) * Math.pow(premMRV, horizon), signal, signalColor, spark })
  }
  rows.sort((a, b) => b.valNow - a.valNow)

  return (
    <TerminalSection id="pred-g" title="G. SYMBOL-LEVEL FORWARD PROJECTION" defaultOpen>
      <table className="bb-table" style={{ width: '100%' }}>
        <thead><tr><th>SYM</th><th>TYPE</th><th className="r">VAL NOW</th><th className="r">VAL {horizon}Y</th><th className="r">INC {horizon}Y</th><th className="r">YOC {horizon}Y</th><th className="r">PREM→</th><th style={{ width: 80 }}>TREND</th><th>SIGNAL</th></tr></thead>
        <tbody>
          {rows.map(r => {
            const valChg = r.valNow > 0 ? (r.valProj - r.valNow) / r.valNow : 0
            return (
              <tr key={r.sym}>
                <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{r.sym}</td>
                <td style={{ color: DIM, fontSize: 12 }}>{r.type}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{fmtK(r.valNow)}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: valChg >= 0 ? BULL_C : BEAR_C }}>{fmtK(r.valProj)} <span style={{ fontSize: 12 }}>({valChg >= 0 ? '+' : ''}{(valChg * 100).toFixed(0)}%)</span></td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: BULL_C }}>{fmtMoneyFull(r.incProj)}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.yocProj > 0.06 ? BULL_C : M }}>{(r.yocProj * 100).toFixed(2)}%</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: Math.abs(r.premProj) < Math.abs(r.premNow) ? BULL_C : EXP_C }}>{r.premNow.toFixed(1)}%→{r.premProj.toFixed(1)}%</td>
                <td>
                  <ResponsiveContainer width={80} height={28}>
                    <LineChart data={r.spark} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                      <Line type="monotone" dataKey="v" stroke={valChg >= 0 ? BULL_C : BEAR_C} strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </td>
                <td style={{ fontSize: 12, color: r.signalColor }}>{r.signal}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TerminalSection>
  )
}

/** Section H — Action signals */
export function SectionH_Advanced({ data, baseProj, bullProj, bearProj }: {
  data: DashboardData; baseProj: ProjYear[]; bullProj: ProjYear[]; bearProj: ProjYear[]
}) {
  const tx = data.tax_data; const ia = data.income_analytics
  const targets = data.taxable_target_analysis ?? []
  const todayYr = new Date().getFullYear()
  const todayISO = new Date().toISOString().slice(0, 10)
  const targetIncome = ia?.target_income ?? 0
  const abThresh = tx.withdrawal_state_ab_threshold ?? 1_000_000
  const bcThresh = tx.withdrawal_state_bc_threshold ?? 1_500_000
  // Today's portfolio value — used to suppress milestones for thresholds already crossed
  const todayPortfolioValue = data.summary?.total_value ?? 0

  interface Signal { year: number; cat: string; msg: string; color: string; sev: 'HIGH' | 'MEDIUM' | 'LOW' | 'OPPTY' }
  const signals: Signal[] = []

  for (const r of baseProj) {
    const bear = bearProj.find(b => b.calYear === r.calYear)
    const bull = bullProj.find(b => b.calYear === r.calYear)
    const prev = baseProj.find(p => p.calYear === r.calYear - 1)
    const yr   = r.calYear

    if (r.ssIncome > 0 && (prev?.ssIncome ?? 0) === 0)
      signals.push({ year: yr, cat: 'INCOME', msg: `SS begins — +${fmtK(r.ssIncome)}/yr. Gross → ${fmtK(r.grossIncome)}.`, color: BULL_C, sev: 'OPPTY' })
    if (prev && r.bracketSlices.length > prev.bracketSlices.length) {
      const bkt = r.bracketSlices[r.bracketSlices.length - 1]
      signals.push({ year: yr, cat: 'TAX', msg: `Base crosses into ${(bkt.rate * 100).toFixed(0)}% bracket. Taxable: ${fmtK(r.taxableIncome)}.`, color: EXP_C, sev: 'MEDIUM' })
    }
    if (bull && prev && bull.bracketSlices.length > (bullProj.find(p => p.calYear === yr - 1)?.bracketSlices.length ?? 0) && bull.bracketSlices.length > r.bracketSlices.length) {
      const bkt = bull.bracketSlices[bull.bracketSlices.length - 1]
      signals.push({ year: yr, cat: 'TAX', msg: `Bull case hits ${(bkt.rate * 100).toFixed(0)}% bracket — faster income growth. Extra tax drag: +${fmtK(bull.federalTax - r.federalTax)}.`, color: EXP_C, sev: 'MEDIUM' })
    }
    if (r.ltcgCapacity > 20_000 && (prev?.ltcgCapacity ?? 0) <= 20_000)
      signals.push({ year: yr, cat: 'LTCG', msg: `0% harvest window opens — ${fmtK(r.ltcgCapacity)} room (base). Sell eligible lots before income rises.`, color: BULL_C, sev: 'OPPTY' })
    if (r.ltcgCapacity === 0 && (prev?.ltcgCapacity ?? 0) > 0)
      signals.push({ year: yr, cat: 'LTCG', msg: `0% LTCG room exhausted. Income ${fmtK(r.grossIncome)} exceeds threshold. No free harvest.`, color: BEAR_C, sev: 'HIGH' })
    if (targetIncome > 0 && r.annualIncome >= targetIncome && ((prev?.annualIncome ?? 0) < targetIncome))
      signals.push({ year: yr, cat: 'INCOME', msg: `Income reaches target ${fmtK(targetIncome)}/yr — self-sufficient.`, color: BULL_C, sev: 'OPPTY' })
    if (r.netCashflow < 0 && (prev?.netCashflow ?? 0) >= 0)
      signals.push({ year: yr, cat: 'CASHFLOW', msg: `Base cashflow goes negative (${fmtK(r.netCashflow)}/yr). Portfolio withdrawal needed.`, color: BEAR_C, sev: 'HIGH' })
    if (bear && bear.netCashflow < 0 && (bearProj.find(p => p.calYear === yr - 1)?.netCashflow ?? 0) >= 0)
      signals.push({ year: yr, cat: 'CASHFLOW', msg: `Bear case deficit begins (${fmtK(bear.netCashflow)}/yr). Stress-test withdrawal plan.`, color: EXP_C, sev: 'MEDIUM' })
    if (r.niitAmount > 0 && (prev?.niitAmount ?? 0) === 0)
      signals.push({ year: yr, cat: 'TAX', msg: `NIIT activates — ${((tx.niit_rate ?? 0.038) * 100).toFixed(1)}% above ${fmtK(tx.niit_threshold ?? 250000)} MAGI. Extra: ${fmtK(r.niitAmount)}.`, color: EXP_C, sev: 'MEDIUM' })
    // Only show "crosses threshold" if the portfolio hasn't already crossed it today.
    // Without this guard, the first projected year fires when prev is undefined (→ 0 <= thresh)
    // even when todayVal is already above the threshold.
    if (r.portfolioValue > bcThresh && (prev?.portfolioValue ?? 0) <= bcThresh && todayPortfolioValue <= bcThresh)
      signals.push({ year: yr, cat: 'PORTFOLIO', msg: `Crosses B→C threshold (${fmtK(bcThresh)}). State shifts to capital-gain-dominant.`, color: BULL_C, sev: 'OPPTY' })
    if (bear && bear.portfolioValue < abThresh && ((bearProj.find(p => p.calYear === yr - 1)?.portfolioValue ?? 0) >= abThresh))
      signals.push({ year: yr, cat: 'PORTFOLIO', msg: `Bear: drops below A→B threshold (${fmtK(abThresh)}). Conservation risk.`, color: BEAR_C, sev: 'HIGH' })
  }

  // LTCG maturity calendar (30/60/90d)
  const matCal = tx.ltcg_maturity_calendar ?? []
  const mat30 = matCal.filter(e => e.date > todayISO && e.days_away <= 30)
  const mat60 = matCal.filter(e => e.date > todayISO && e.days_away > 30 && e.days_away <= 60)
  const mat90 = matCal.filter(e => e.date > todayISO && e.days_away > 60 && e.days_away <= 90)
  if (mat30.length > 0) signals.push({ year: todayYr, cat: 'LTCG', msg: `${mat30.length} lot(s) flip LTCG in ≤30d — ${mat30.map(e => e.symbol).join(', ')}. Gain: ${fmtMoneyFull(mat30.reduce((s, e) => s + e.gain, 0))}. Hold.`, color: BULL_C, sev: 'OPPTY' })
  if (mat60.length > 0) signals.push({ year: todayYr, cat: 'LTCG', msg: `${mat60.length} lot(s) flip LTCG in 31–60d — ${mat60.map(e => e.symbol).join(', ')}. Gain: ${fmtMoneyFull(mat60.reduce((s, e) => s + e.gain, 0))}. Near-term rebalance trigger.`, color: EXP_C, sev: 'MEDIUM' })
  // 61–90d lots are the starting gun for the multi-year rebalance plan — MEDIUM not LOW
  if (mat90.length > 0) signals.push({ year: todayYr, cat: 'LTCG', msg: `${mat90.length} lot(s) flip LTCG in 61–90d — ${mat90.map(e => e.symbol).join(', ')}. First lots eligible for rebalance calendar.`, color: EXP_C, sev: 'MEDIUM' })

  // Allocation gaps
  const bigGaps = targets.filter(t => Math.abs(t.gap_pct) > 5)
  if (bigGaps.length > 0)
    signals.push({ year: todayYr, cat: 'ALLOCATION', msg: `${bigGaps.length} off-target >5%: ${bigGaps.map(t => `${t.symbol} ${t.gap_pct > 0 ? 'UNDER' : 'OVER'} ${Math.abs(t.gap_pct).toFixed(1)}%`).join(', ')}.`, color: EXP_C, sev: 'MEDIUM' })

  signals.sort((a, b) => a.year - b.year || (['HIGH', 'OPPTY', 'MEDIUM', 'LOW'].indexOf(a.sev) - ['HIGH', 'OPPTY', 'MEDIUM', 'LOW'].indexOf(b.sev)))

  const sevBg: Record<string, string> = { HIGH: 'var(--fd-card)', MEDIUM: 'var(--fd-card)', LOW: 'var(--fd-hairline)', OPPTY: 'var(--fd-card)' }
  const sevBorder: Record<string, string> = { HIGH: BEAR_C, MEDIUM: EXP_C, LOW: M, OPPTY: BULL_C }

  return (
    <TerminalSection id="pred-h" title="H. ACTION SIGNALS" defaultOpen>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {signals.length === 0
          ? <div style={{ color: BULL_C, fontSize: 12 }}>No material signals across projection horizon.</div>
          : signals.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 10px', alignItems: 'flex-start', background: sevBg[s.sev], borderLeft: `3px solid ${sevBorder[s.sev]}`, borderRadius: 0 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12, color: s.color, whiteSpace: 'nowrap', minWidth: 36 }}>{s.year}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: s.color, whiteSpace: 'nowrap', minWidth: 80 }}>[{s.cat}]</div>
              <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>{s.msg}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: s.color, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{s.sev}</div>
            </div>
          ))
        }
      </div>
    </TerminalSection>
  )
}

// ─── Confidence meter ──────────────────────────────────────────────────────────
export function ConfidenceMeter({ data }: { data: DashboardData }) {
  const pi    = data.portfolio_intel
  const score = pi?.system_confidence_score ?? 50
  const label = pi?.system_confidence_label ?? 'CAUTIOUS'
  const color = score >= 70 ? BULL_C : score >= 40 ? EXP_C : BEAR_C

  // Build tooltip: show score components if available
  const fragility = pi?.fragility_score != null ? `Fragility ${pi.fragility_score} (drag)` : null
  const regime    = pi?.market_regime    ? `Regime ${pi.market_regime} (neutral)` : null
  const incDur    = pi?.income_durability_score != null ? `Income durability ${pi.income_durability_score}` : null
  const volR      = pi?.vol_regime       ? `Vol ${pi.vol_regime}` : null
  const parts     = [fragility, regime, incDur, volR].filter(Boolean)
  const tooltip   = parts.length > 0
    ? `Prediction confidence ${score}/100 (${label})\n${parts.join(' · ')}\nHigher = more reliable forward projections`
    : `Prediction confidence ${score}/100 — composite score of fragility, regime, income durability, and data completeness`

  return (
    <div
      title={tooltip}
      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'help' }}
    >
      <span style={{ fontSize: 12, color: M, fontWeight: 500, letterSpacing: '0.8px', whiteSpace: 'nowrap',
        borderBottom: `1px dotted ${M}` }}>PRED CONFIDENCE</span>
      <div style={{ flex: 1, height: 6, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden', minWidth: 80 }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 0, transition: 'width 0.5s' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12, color, minWidth: 28 }}>{score}</span>
      <span style={{ fontSize: 12, color, fontWeight: 500 }}>{label}</span>
    </div>
  )
}

// ─── What Changed panel ────────────────────────────────────────────────────────
export function WhatChanged({ baseProj, horizon }: { baseProj: ProjYear[]; horizon: Horizon }) {
  const row = baseProj[horizon - 1]
  const [prev, setPrev] = useState<PredSnapshot | null>(null)

  useEffect(() => {
    try { const raw = localStorage.getItem(SNAP_KEY); if (raw) setPrev(JSON.parse(raw)) } catch {}
  }, [])

  useEffect(() => {
    if (!row) return
    const snap: PredSnapshot = { ts: Date.now(), horizon, portfolioValue: row.portfolioValue, annualIncome: row.grossIncome, federalTax: row.federalTax, netCashflow: row.netCashflow }
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(snap)) } catch {}
  }, [row, horizon])

  if (!prev || !row || prev.horizon !== horizon) return null
  const age = Math.round((Date.now() - prev.ts) / 3_600_000)
  if (age < 1) return null

  const diffs = [
    { label: 'Portfolio Value', delta: row.portfolioValue  - prev.portfolioValue  },
    { label: 'Annual Income',   delta: row.grossIncome     - prev.annualIncome    },
    { label: 'Federal Tax',     delta: row.federalTax      - prev.federalTax      },
    { label: 'Net Cashflow',    delta: row.netCashflow     - prev.netCashflow     },
  ].filter(d => Math.abs(d.delta) > 100)

  if (!diffs.length) return null
  return (
    <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: BASE_C, letterSpacing: '0.8px', marginBottom: 6 }}>
        ▲ WHAT CHANGED SINCE LAST RUN ({age}h ago) — {horizon}Y BASE
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {diffs.map(d => (
          <div key={d.label} style={{ fontSize: 12 }}>
            <span style={{ color: M }}>{d.label}: </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: d.delta >= 0 ? BULL_C : BEAR_C }}>
              {d.delta >= 0 ? '+' : ''}{fmtK(d.delta)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
