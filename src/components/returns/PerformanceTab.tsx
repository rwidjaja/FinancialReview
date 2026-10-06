import { useState, useMemo, useEffect } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts'
import { TerminalSection } from '../ui/Terminal'
import { fmtMoneyFull, fmtFull } from '../../utils/formatters'
import { usePerformanceData, useRefreshPerformance, useWellnessData } from '../../hooks/useDashboardData'
import type { DashboardData } from '../../types/dashboard'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { TabBriefingPanel } from '../ui/TabBriefingPanel'
import { PeriodBtn } from './PerformanceButtons'
import { MarketContext } from '../overview/MarketContext'
import { ContributionTable } from './ContributionTable'
import { FundVsYouTable } from './FundVsYouTable'
import { BenchmarkComparison } from './BenchmarkComparison'
import { NormalizedReturnChart } from './NormalizedReturnChart'
import { TaxablePortfolioValueChart } from './TaxablePortfolioValueChart'
import { DrawdownHeatmap } from './DrawdownHeatmap'
import { StressScenarioPanel } from './StressScenarioPanel'
import { SymbolCharts } from './SymbolCharts'
import { WsSection } from '../workspace/WorkspaceContext'
import { RISK_FREE_RATE_PCT } from '../../utils/constants'
import { AXIS, LINE_PROPS, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTheme'
import {
  PageHero, LeadMuted, HeroMeta, KpiStrip, Section, Sections, MainRail, RuledList, KeyValueRow, SegGroup, MonoNote,
  mono, muted, gain, moneyUnit, signedMoney, signedPct, fmtShortDate,
} from '../ui/primitives'
// Period length in years — used to annualize CAGR correctly.
// (Old formula used 252/n which over-annualized when pct_returns was downsampled.)
const PERIOD_YEARS: Record<string, number> = {
  '1m': 1 / 12,
  '3m': 0.25,
  '6m': 0.5,
  '1y': 1,
}
function periodYears(period: string): number {
  if (period === 'ytd') {
    const start = new Date(new Date().getFullYear(), 0, 1).getTime()
    const days = (Date.now() - start) / 86400000
    return Math.max(days / 365.25, 1 / 365.25)
  }
  return PERIOD_YEARS[period] ?? 1
}

// Derive Win Rate, Sortino, CAGR from cumulative pct_returns array.
// pct_returns[i] is the cumulative % return from period start through day i.
function derivedMetrics(pctReturns: number[], totalReturn: number, years: number) {
  const n = pctReturns.length
  if (n === 0) return { winRate: 0, sortino: 0, cagr: 0 }
  const daily = pctReturns.map((p, i) => (i === 0 ? p : p - pctReturns[i - 1]))
  const winRate = (daily.filter(d => d > 0).length / n) * 100
  const meanDaily = daily.reduce((s, d) => s + d, 0) / n
  const negatives = daily.filter(d => d < 0)
  const downsideVariance = negatives.length > 0 ? negatives.reduce((s, d) => s + d * d, 0) / negatives.length : 0
  const downsideStd = Math.sqrt(downsideVariance)
  const sortino = downsideStd > 0 ? (meanDaily * 252) / (downsideStd * Math.sqrt(252)) : 0
  // CAGR = (1 + total_return)^(1/years) − 1. For 1y this equals totalReturn.
  const cagr = years > 0 ? (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100 : totalReturn
  return { winRate, sortino, cagr }
}

const G  = 'var(--green)'
const R  = 'var(--red)'
const A  = 'var(--amber)'

type Period = string

interface Props { data: DashboardData }

export function PerformanceTab({ data }: Props) {
  const [mode] = useGlobalViewMode()
  const [period, setPeriod] = useState<Period>('1y')
  const { data: perfData, isLoading: perfLoading, isError: perfError } = usePerformanceData()
  const refreshPerformance = useRefreshPerformance()
  const { data: wellness } = useWellnessData()

  // Silently refresh perf data every time the Returns tab is opened so the
  // numbers are always current without any manual button interaction.
  useEffect(() => { refreshPerformance() }, [])

  const totalValue = data.summary.total_value
  const totalPnl = data.summary.total_pnl
  const totalPnlPct = data.summary.total_pnl_pct

  // Use server-provided position weights (portfolio_intel.weights) — single source of truth.
  // Fallback: build locally from accounts for legacy payloads that pre-date this field.
  const posWeights = useMemo<Record<string, number>>(() => {
    const serverWeights = data.portfolio_intel?.weights ?? {}
    if (Object.keys(serverWeights).length > 0) {
      const tv = data.summary.total_value
      const w: Record<string, number> = {}
      // pi.weights are PERCENT on the wire (server: portfolio_data.py:1929)
      // — convert to decimal before scaling to dollars.
      for (const [sym, pct] of Object.entries(serverWeights)) w[sym] = ((pct as number) / 100) * tv
      return w
    }
    const w: Record<string, number> = {}
    for (const acct of data.accounts)
      for (const pos of acct.positions)
        w[pos.symbol] = (w[pos.symbol] ?? 0) + pos.value
    return w
  }, [data])

  const symbols = useMemo(() => Object.keys(posWeights), [posWeights])

  // Compute weighted portfolio metrics for selected period.
  // All periods — including 1y — use perfData[sym][period].total_return which comes from the
  // yfinance batch download (auto_adjust=True, dividends baked into adjusted closes).
  // This is the ONLY correct source: using data.snapshots[sym].total_return_1y is wrong
  // because that path uses unadjusted prices + raw dividend sums, which double-counts
  // distributions on high-yield CEFs and inflates returns for multi-year holders.
  const weightedMetrics = useMemo(() => {
    if (!perfData) return null
    let wReturn = 0, wVol = 0, wDd = 0, totalW = 0
    for (const sym of symbols) {
      const w = (posWeights[sym] ?? 0) / totalValue
      const pd = perfData[sym]?.[period]
      if (!pd) continue
      wReturn += w * pd.total_return
      wVol    += w * pd.vol_annual
      wDd     += w * pd.max_drawdown
      totalW  += w
    }
    if (totalW === 0) return null
    const portReturn = wReturn / totalW
    const portVol    = wVol    / totalW
    const sharpe = portVol > 0 ? (portReturn - RISK_FREE_RATE_PCT) / portVol : 0
    return {
      total_return: portReturn,
      vol_annual:   portVol,   // weighted-avg of individual vols — used internally only
      sharpe,
      max_drawdown: wDd / totalW,
    }
  }, [perfData, symbols, posWeights, totalValue, period])

  // Authoritative portfolio vol = Risk tab source (portfolio_intel.portfolio_vol_pct).
  // Weighted-avg of per-symbol vols understates true portfolio vol because it ignores
  // correlation — a concentrated portfolio (55% SMH) runs much higher than the average.
  // Use this for both the Volatility display and the Sharpe recalculation so both tabs agree.
  const piVolPct = data.portfolio_intel?.portfolio_vol_pct   // already in % (e.g. 40.5)
  const displayVol   = piVolPct ?? weightedMetrics?.vol_annual
  const displaySharpe = displayVol != null && displayVol > 0 && weightedMetrics != null
    ? (weightedMetrics.total_return - RISK_FREE_RATE_PCT) / displayVol
    : weightedMetrics?.sharpe

  // Weighted advanced metrics: Win Rate and Sortino — weighted average of per-symbol metrics.
  // NOTE: CAGR is NOT computed here — see accountCagrs below.  Averaging per-symbol CAGRs
  // is mathematically wrong: a concentrated position with a large return (e.g. SMH +54% YTD)
  // annualizes to a huge number (~370%) which then inflates the weighted average.
  // CAGR must be derived from the portfolio-level total return, not the symbol level.
  const weightedAdvanced = useMemo(() => {
    if (!perfData) return null
    let wWinRate = 0, wSortino = 0, totalW = 0
    for (const sym of symbols) {
      const w = (posWeights[sym] ?? 0) / totalValue
      const pd = perfData[sym]?.[period]
      if (!pd) continue
      const { winRate, sortino } = derivedMetrics(pd.pct_returns ?? [], pd.total_return, 1)
      wWinRate += w * winRate
      wSortino += w * sortino
      totalW += w
    }
    if (totalW === 0) return null
    return { winRate: wWinRate / totalW, sortino: wSortino / totalW }
  }, [perfData, symbols, posWeights, totalValue, period])

  // Per-account CAGR — each account is treated as its own price-based universe.
  //
  // Why per-account is the only correct approach:
  //   • Each account has a different composition and therefore a different weighted period return.
  //   • CAGR is a nonlinear function: CAGR(weighted_avg_return) ≠ weighted_avg(CAGR(return)).
  //   • Mixing taxable (equity-heavy, high volatility) with Roth (different holdings) produces a
  //     number that matches neither account's actual compound growth rate.
  //
  // For each account we compute:
  //   1. Position weights within that account (using current market values).
  //   2. Price-based weighted return for the selected period (yfinance batch download).
  //   3. CAGR = (1 + weighted_return/100)^(1/years) − 1.
  const accountCagrs = useMemo(() => {
    if (!perfData) return []
    const years = periodYears(period)
    const LABELS: Record<string, string> = { taxable: 'TAXABLE', roth_ira: 'ROTH IRA', rollover_ira: 'ROLLOVER' }

    return data.accounts
      .filter(acct => acct.value > 0)
      .map(acct => {
        let wReturn = 0, totalW = 0
        for (const pos of acct.positions) {
          if (pos.value <= 0) continue
          const w = pos.value / acct.value
          const pd = perfData[pos.symbol]?.[period]
          if (!pd) continue
          wReturn += w * pd.total_return
          totalW += w
        }
        if (totalW === 0) return null
        const weightedReturn = wReturn / totalW
        const cagr = years > 0 ? (Math.pow(1 + weightedReturn / 100, 1 / years) - 1) * 100 : weightedReturn
        return { key: acct.key, label: LABELS[acct.key] ?? acct.label.toUpperCase(), cagr, weightedReturn }
      })
      .filter((a): a is NonNullable<typeof a> => a !== null)
  }, [perfData, data.accounts, period])

  // Benchmarks
  const benchmarks = useMemo(
    () => perfData?.['_benchmarks'] as Record<string, Record<string, import('../../types/dashboard').PerfPeriod>> | undefined,
    [perfData]
  )
  const benchSpy = benchmarks?.['SPY']?.[period]
  const benchQqq = benchmarks?.['QQQ']?.[period]

  // Risk regime indicator
  const riskRegime = useMemo(() => {
    if (!perfData) return null
    let weightedVol = 0, totalW = 0
    for (const dec of data.decisions) {
      const sym = dec.symbol
      const pd = perfData[sym]?.[period]
      if (!pd) continue
      const w = totalValue > 0 ? (posWeights[sym] ?? 0) / totalValue : 0
      weightedVol += w * pd.vol_annual
      totalW += w
    }
    const avgVol = totalW > 0 ? weightedVol / totalW : 0
    let label: string, color: string
    if (avgVol < 12) { label = 'LOW VOLATILITY REGIME'; color = G }
    else if (avgVol < 20) { label = 'NORMAL VOLATILITY'; color = A }
    else { label = 'HIGH VOLATILITY REGIME'; color = R }
    return { avgVol, label, color }
  }, [perfData, data.decisions, posWeights, totalValue, period])

  // Concentration risk
  const concentrationRisk = useMemo(() => {
    const allPos: Record<string, number> = {}
    for (const acct of data.accounts)
      for (const pos of acct.positions)
        allPos[pos.symbol] = (allPos[pos.symbol] ?? 0) + pos.value
    const safeTotal = totalValue > 0 ? totalValue : 1
    const sorted = Object.entries(allPos)
      .sort((a, b) => b[1] - a[1])
      .map(([sym, v]) => ({ sym, portPct: (v / safeTotal) * 100 }))
    const top1 = sorted[0]?.portPct ?? 0
    const top3 = sorted.slice(0, 3).reduce((s, x) => s + x.portPct, 0)
    const top5 = sorted.slice(0, 5).reduce((s, x) => s + x.portPct, 0)
    return { top1, top3, top5 }
  }, [data.accounts, totalValue])

  // ── v4 derived: indexed portfolio vs SPY series (current weights, price return) ──
  const chartSeries = useMemo(() => {
    if (!perfData) return []
    const spy = benchmarks?.['SPY']?.[period]
    const base = Object.entries(posWeights).sort((a, b) => b[1] - a[1])
      .map(([s]) => perfData[s]?.[period]).find(p => p && p.pct_returns?.length)
    const n = base?.pct_returns.length ?? 0
    if (!n) return []
    const rows: { date: string; port: number | null; spy: number | null }[] = []
    for (let i = 0; i < n; i++) {
      let acc = 0, w = 0
      for (const [s, v] of Object.entries(posWeights)) {
        const arr = perfData[s]?.[period]?.pct_returns
        if (!arr || arr.length !== n) continue
        acc += v * arr[i]; w += v
      }
      const sArr = spy?.pct_returns
      const si = sArr ? sArr.length - n + i : -1
      rows.push({
        date: base!.dates?.[i] ?? String(i),
        port: w > 0 ? 100 + acc / w : null,
        spy: sArr && si >= 0 && si < sArr.length ? 100 + sArr[si] : null,
      })
    }
    return rows
  }, [perfData, benchmarks, posWeights, period])

  const contribs = useMemo(() => {
    if (!perfData) return []
    return Object.entries(posWeights)
      .map(([sym, val]) => {
        const w = totalValue > 0 ? val / totalValue : 0
        const ret = perfData[sym]?.[period]?.total_return ?? 0
        return { sym, contrib: w * ret, weight: w * 100, ret }
      })
      .filter(c => Math.abs(c.contrib) > 0.01)
      .sort((a, b) => b.contrib - a.contrib)
  }, [perfData, posWeights, totalValue, period])

  const PERIODS = [{ id: '1m', label: '1M' }, { id: '3m', label: '3M' }, { id: '6m', label: '6M' }, { id: 'ytd', label: 'YTD' }, { id: '1y', label: '1Y' }]
  const periodSeg = (
    <SegGroup>
      {PERIODS.map(p => <PeriodBtn key={p.id} active={period === p.id} onClick={() => setPeriod(p.id)}
        title="Affects returns, volatility, attribution and benchmarks — not Monte Carlo, P&L or account totals">{p.label}</PeriodBtn>)}
    </SegGroup>
  )

  if (perfLoading && !perfData) {
    return <MonoNote>Loading performance data…</MonoNote>
  }

  if (perfError) {
    return <ErrorPanel title="Failed to load performance data" body="Check the server logs for details." />
  }

  const hasSymbolData = perfData ? Object.keys(perfData).some(k => k !== '_benchmarks') : false
  if (!perfData || !hasSymbolData) {
    return <ErrorPanel title="No symbol performance data available"
      body={`${!perfData ? 'yfinance may be unavailable or rate-limited.' : 'The cache holds benchmark data only — the yfinance download may have failed earlier today.'} Data refreshes automatically at the next market open.`} />
  }

  const ret = weightedMetrics?.total_return ?? null
  const spyRet = benchSpy?.total_return ?? null
  const alphaSpy = ret != null && spyRet != null ? ret - spyRet : null
  const alphaQqq = ret != null && benchQqq ? ret - benchQqq.total_return : null
  const periodWord: Record<string, string> = { '1m': 'this month', '3m': 'this quarter', '6m': 'over six months', ytd: 'this year', '1y': 'over the year' }
  const leader = contribs[0]
  const totalPos = contribs.reduce((t, c) => t + Math.max(0, c.contrib), 0)
  const maxAbs = Math.max(...contribs.map(c => Math.abs(c.contrib)), 1)

  const mc = data.market_context
  const spRet1y = (mc?.['S&P 500'] as { '1y_return'?: number } | undefined)?.['1y_return']
  const pi = data.portfolio_intel
  const vb = pi?.vol_budget_used

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        eyebrow={`Returns · price return at current weights · ${period.toUpperCase()}`}
        eyebrowRight={periodSeg}
        before={alphaSpy == null ? 'Tracking the ' : alphaSpy >= 0 ? 'Ahead of the ' : 'Behind the '} em="market" after={` ${periodWord[period] ?? ''}.`}
        lead={<>
          <span>{ret != null ? `${signedPct(ret, 1)} for your holdings against ${spyRet != null ? signedPct(spyRet, 1) : '—'} for the S&P 500${benchQqq ? ` and ${signedPct(benchQqq.total_return, 1)} for QQQ` : ''}.` : 'Returns are not available for this period.'}{leader ? ` ${leader.sym} contributes the most (${signedPct(leader.contrib, 1)} pts).` : ''}</span>
          <LeadMuted>This assumes today's weights were held all period — it shows how the holdings moved, not a money-weighted return. Since funding you are {signedMoney(totalPnl, fmtFull)} ({signedPct(totalPnlPct, 1)}).</LeadMuted>
        </>}
      >
        <HeroMeta items={[
          ...(spRet1y != null ? [{ k: 'S&P 500 1y', v: signedPct(spRet1y, 1) }] : []),
          ...(data.vix_current != null ? [{ k: 'VIX', v: data.vix_current.toFixed(1) }] : []),
          ...(pi?.market_regime ? [{ k: 'Regime', v: pi.market_regime }] : []),
          ...(pi?.positioning ? [{ k: 'Positioning', v: pi.positioning }] : []),
        ]} />
      </PageHero>

      <KpiStrip items={[
        { label: `Portfolio · ${period.toUpperCase()}`, value: ret != null ? signedPct(ret, 1) : '—', valueColor: ret != null ? gain(ret) : undefined, sub: 'Weighted price return' },
        { label: 'S&P 500', value: spyRet != null ? signedPct(spyRet, 1) : '—', sub: 'SPY total return' },
        { label: 'Excess return', value: alphaSpy != null ? `${alphaSpy >= 0 ? '+' : '−'}${Math.abs(alphaSpy).toFixed(1)}` : '—', unit: alphaSpy != null ? ' pts' : undefined, valueColor: alphaSpy != null ? gain(alphaSpy) : undefined, sub: alphaQqq != null ? `vs SPY · ${alphaQqq >= 0 ? '+' : '−'}${Math.abs(alphaQqq).toFixed(1)} pts vs QQQ` : 'vs SPY' },
        { label: 'Since funding', value: moneyUnit(totalPnl).value, unit: moneyUnit(totalPnl).unit, valueColor: gain(totalPnl), sub: `${signedPct(totalPnlPct, 1)} on ${fmtMoneyFull(data.summary.total_cost)} invested` },
      ]} />

      <Sections>
        {chartSeries.length > 1 && (
          <WsSection id="rt_vs_sp500" value={alphaSpy != null ? `${alphaSpy >= 0 ? '+' : '−'}${Math.abs(alphaSpy).toFixed(1)} pts` : undefined} status={alphaSpy == null ? 'info' : alphaSpy >= 0 ? 'ok' : 'watch'}>
          <Section title="Portfolio vs S&P 500" meta={
            <span style={{ display: 'flex', gap: 20, fontSize: 13 }}>
              <Legend color="var(--fd-accent)" label="Portfolio" /><Legend color="var(--fd-lilac-ink)" label="S&P 500" />
            </span>}>
            <div style={{ height: 260, borderTop: '1px solid var(--fd-hairline)', borderBottom: '1px solid var(--fd-hairline)' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSeries} margin={{ top: 16, right: 0, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" {...AXIS} minTickGap={80} tickFormatter={(d: string) => d.length >= 10 ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : d} />
                  <YAxis {...AXIS} width={48} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(0)} />
                  <ReferenceLine y={100} stroke="var(--fd-hairline)" strokeDasharray="4 4" />
                  <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS}
                    formatter={(v: unknown, name: unknown) => [`${((v as number) - 100 >= 0 ? '+' : '−')}${Math.abs((v as number) - 100).toFixed(2)}%`, name === 'port' ? 'Portfolio' : 'S&P 500']} />
                  <Line dataKey="spy" stroke="var(--fd-lilac-ink)" {...LINE_PROPS} connectNulls isAnimationActive={false} />
                  <Line dataKey="port" stroke="var(--fd-accent)" {...LINE_PROPS} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...mono, ...muted }}>
              <span>{fmtShortDate(chartSeries[0].date)}</span><span>Indexed to 100</span><span>{fmtShortDate(chartSeries[chartSeries.length - 1].date)}</span>
            </div>
          </Section>
          </WsSection>
        )}

        <MainRail split="7/5"
          main={<>
            {contribs.length > 0 && (
              <WsSection id="rt_contribution" value={leader ? leader.sym : undefined} status="info">
              <Section title="Contribution by holding" meta={`${period.toUpperCase()} · portfolio points`}>
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr) 72px 84px 120px', gap: 16, padding: '10px 0', borderTop: '2px solid var(--fd-rule)', borderBottom: '1px solid var(--fd-hairline)', ...mono, ...muted }}>
                    <span>Symbol</span><span>Contribution</span><span style={{ textAlign: 'right' }}>Points</span><span style={{ textAlign: 'right' }}>Return</span><span style={{ textAlign: 'right' }}>Share</span>
                  </div>
                  {contribs.map(c => (
                    <div key={c.sym} style={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr) 72px 84px 120px', gap: 16, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }}>{c.sym}</span>
                      <div style={{ height: 10, background: 'var(--fd-hairline)' }}><div style={{ height: 10, width: `${(Math.abs(c.contrib) / maxAbs) * 100}%`, background: c.contrib >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)' }} /></div>
                      <span style={{ textAlign: 'right', fontWeight: 500, color: gain(c.contrib) }}>{c.contrib >= 0 ? '+' : '−'}{Math.abs(c.contrib).toFixed(1)}</span>
                      <span style={{ textAlign: 'right', color: c.ret < 0 ? 'var(--fd-negative)' : undefined }}>{signedPct(c.ret, 1)}</span>
                      <span style={{ textAlign: 'right', whiteSpace: 'nowrap', ...muted }}>{c.contrib > 0 && totalPos > 0 ? `${((c.contrib / totalPos) * 100).toFixed(0)}% · ` : ''}{c.weight.toFixed(0)}% wt</span>
                    </div>
                  ))}
                </div>
              </Section>
              </WsSection>
            )}
            <WsSection id="rt_fund_vs_you">
            <Section title="Fund vs you" meta="Per-holding actual return">
              <FundVsYouTable data={data} perfData={perfData} period={period} totalValue={totalValue} />
            </Section>
            </WsSection>
          </>}
          rail={<>
            {accountCagrs.length > 0 && (
            <WsSection id="rt_account_perf">
            <RailList title="Account performance" rows={[
              ...accountCagrs.map(am => ({
                k: data.accounts.find(a => a.key === am.key)?.label ?? am.label,
                v: `${am.cagr >= 0 ? '+' : '−'}${Math.abs(am.cagr).toFixed(1)}%`,
                sub: am.key === 'rollover_ira' ? 'Includes a mid-year inflow · price return only · not comparable' : period !== '1y' ? `Annualised · raw ${signedPct(am.weightedReturn, 1)}` : 'Annualised',
              })),
            ]} note="Roth conversion flows move account-level CAGRs; benchmark with the portfolio return." />
            </WsSection>
            )}
            {data.accounts.length > 0 && (
            <WsSection id="rt_accounts" value={String(data.accounts.length)} status="info">
            <RailList title="Accounts" rows={[
              ...data.accounts.map(acct => ({
                k: acct.label, v: fmtMoneyFull(acct.value),
                sub: `${signedMoney(acct.pnl, fmtMoneyFull)} (${signedPct(acct.pnl_pct, 1)}) · cost ${fmtMoneyFull(acct.cost)} · ${acct.key?.includes('roth') ? 'tax-free' : acct.key?.includes('rollover') || acct.key?.includes('ira') ? 'tax-deferred' : 'taxable'} · ${((acct.value / totalValue) * 100).toFixed(1)}%`,
              })),
            ]} />
            </WsSection>
            )}
            <WsSection id="rt_risk_context" value={displayVol != null ? `${displayVol.toFixed(1)}% vol` : undefined} status={displayVol == null ? 'info' : displayVol < 20 ? 'ok' : displayVol < 30 ? 'watch' : 'warn'}>
            <RailList title="Risk context" rows={[
              { k: 'Volatility', v: displayVol != null ? `${displayVol.toFixed(1)}%` : '—', sub: [displayVol == null ? null : displayVol < 20 ? 'Low' : displayVol < 30 ? 'Moderate' : displayVol < 40 ? 'High' : 'Extreme', vb != null && displayVol != null ? `${vb.toFixed(0)}% of budget · ${(displayVol / (vb / 100)).toFixed(1)}% target` : null, piVolPct != null ? 'Portfolio-level, same as Risk' : null].filter(Boolean).join(' · ') },
              { k: 'Sharpe', v: displaySharpe != null ? displaySharpe.toFixed(2) : '—', sub: `Trailing ${period} · 4.5% risk-free · ${displaySharpe == null ? '' : displaySharpe > 1 ? 'strong' : displaySharpe > 0.5 ? 'adequate' : 'weak'}` },
              { k: 'Max drawdown', v: weightedMetrics ? `${weightedMetrics.max_drawdown.toFixed(1)}%` : '—', sub: weightedMetrics == null ? undefined : weightedMetrics.max_drawdown > -10 ? 'Shallow' : weightedMetrics.max_drawdown > -20 ? 'Moderate' : 'Deep' },
              { k: 'Win rate', v: weightedAdvanced ? `${weightedAdvanced.winRate.toFixed(1)}%` : '—', sub: 'Up days · SPY reference about 55%' },
              { k: 'Sortino', v: weightedAdvanced ? weightedAdvanced.sortino.toFixed(2) : '—', sub: 'Downside-adjusted return' },
              ...(riskRegime ? [{ k: 'Volatility regime', v: `${riskRegime.avgVol.toFixed(1)}%`, sub: riskRegime.label.charAt(0) + riskRegime.label.slice(1).toLowerCase() }] : []),
              { k: 'Concentration', v: `${concentrationRisk.top1.toFixed(1)}%`, sub: `Top holding · top 3 ${concentrationRisk.top3.toFixed(1)}% · top 5 ${concentrationRisk.top5.toFixed(1)}%` },
            ]} />
            </WsSection>
            {wellness && (
              <WsSection id="rt_plan_context" value={`${(wellness.success_prob_95 * 100).toFixed(1)}%`} status="info">
              <RailList title="Retirement plan context" rows={[
                { k: 'Monte Carlo success', v: `${(wellness.success_prob_95 * 100).toFixed(1)}%`, sub: `Funded through age ${wellness.target_age}` },
                { k: 'Withdrawal rate', v: wellness.withdrawal_rate != null ? `${(wellness.withdrawal_rate * 100).toFixed(2)}%` : '—', sub: wellness.withdrawal_rate != null && wellness.withdrawal_rate < 0.04 ? 'Below the 4% rule' : 'Above the 4% guideline' },
                { k: 'Portfolio runway', v: wellness.buffer_years != null ? `${wellness.buffer_years.toFixed(1)} yrs` : '—', sub: `${fmtFull(wellness.estimated_spending ?? 0)}/yr plan spend` },
                { k: 'Income coverage', v: wellness.income_coverage_pct != null ? `${wellness.income_coverage_pct.toFixed(1)}%` : '—', sub: `${fmtMoneyFull(data.income_analytics?.portfolio_fwd_12m ?? 0)}/yr income vs ${fmtMoneyFull(wellness.estimated_spending ?? 0)}/yr spending` },
              ]} />
              </WsSection>
            )}
            <WsSection id="rt_briefing">
            <div style={{ background: 'var(--fd-card)', padding: 24 }}>
              <TabBriefingPanel endpoint="/api/briefing/returns" title="Returns briefing" />
            </div>
            </WsSection>
          </>}
        />

        {mode === 'advanced' && (<>
          {data.market_context && <WsSection id="rt_market_context"><Section title="Market context" meta="Full detail"><MarketContext data={data} /></Section></WsSection>}
          {(() => {
            const taxableAcct = data.accounts.find(a => a.key?.includes('taxable') && a.value > 0)
            if (!taxableAcct) return null
            const taxableSyms = taxableAcct.positions.filter(p => p.value > 0).map(p => p.symbol)
            return (<>
              <WsSection id="rt_taxable_value"><TerminalSection id="taxable-value" title="Taxable — portfolio value vs S&P 500"><TaxablePortfolioValueChart data={data} perfData={perfData} period={period} /></TerminalSection></WsSection>
              {taxableSyms.length > 0 && <WsSection id="rt_sym_taxable"><TerminalSection id="taxable-normalized" title="Taxable — symbol returns, base 100"><NormalizedReturnChart data={data} perfData={perfData} period={period} symbols={taxableSyms} /></TerminalSection></WsSection>}
            </>)
          })()}
          {(() => {
            const syms = (data.accounts.find(a => a.key?.includes('roth'))?.positions ?? []).filter(p => p.value > 0).map(p => p.symbol)
            return syms.length ? <WsSection id="rt_sym_roth"><TerminalSection id="roth-normalized" title="Roth IRA — symbol returns, base 100"><NormalizedReturnChart data={data} perfData={perfData} period={period} symbols={syms} /></TerminalSection></WsSection> : null
          })()}
          {(() => {
            const syms = (data.accounts.find(a => a.key?.includes('rollover'))?.positions ?? []).filter(p => p.value > 0).map(p => p.symbol)
            return syms.length ? <WsSection id="rt_sym_rollover"><TerminalSection id="rollover-normalized" title="Rollover IRA — symbol returns, base 100"><NormalizedReturnChart data={data} perfData={perfData} period={period} symbols={syms} /></TerminalSection></WsSection> : null
          })()}
          <WsSection id="rt_contrib_lifetime">
          <TerminalSection id="contrib" title="Contribution table — lifetime, since buy">
            <ContributionTable data={data} perfData={perfData} period={period} totalValue={totalValue} />
          </TerminalSection>
          </WsSection>
          {(benchSpy || benchQqq) && (
            <WsSection id="rt_benchmark">
            <TerminalSection id="bench" title="Benchmark comparison">
              <BenchmarkComparison portfolio={weightedMetrics} spy={benchSpy ?? null} qqq={benchQqq ?? null} period={period} />
            </TerminalSection>
            </WsSection>
          )}
          <WsSection id="rt_symbol_charts"><TerminalSection id="sym-charts" title="Per-symbol analysis"><SymbolCharts data={data} perfData={perfData} period={period} /></TerminalSection></WsSection>
          <WsSection id="rt_drawdown"><TerminalSection id="drawdown" title="Drawdown heatmap — per symbol"><DrawdownHeatmap data={data} perfData={perfData} period={period} /></TerminalSection></WsSection>
          <WsSection id="rt_stress"><TerminalSection id="stress" title="Stress scenario engine"><StressScenarioPanel data={data} perfData={perfData} period={period} totalValue={totalValue} /></TerminalSection></WsSection>
        </>)}
      </Sections>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 20, height: 3, background: color }} />{label}</span>
}

function RailList({ title, rows, note }: { title: string; rows: { k: string; v: string; sub?: string }[]; note?: string }) {
  if (rows.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{title}</h3>
      <RuledList>{rows.map(r => <KeyValueRow key={r.k} k={r.k} v={r.v} sub={r.sub} />)}</RuledList>
      {note && <span style={{ fontSize: 13, ...muted }}>{note}</span>}
    </div>
  )
}

function ErrorPanel({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ margin: '56px 0', display: 'grid', gridTemplateColumns: '8px 1fr', background: 'var(--fd-card)' }}>
      <div style={{ background: 'var(--fd-alert)' }} />
      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={mono}>{title}</span>
        <span style={{ fontSize: 14, ...muted }}>{body}</span>
      </div>
    </div>
  )
}
