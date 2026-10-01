/**
 * Portfolio tab — v4 (AtScale). Spec: redesign/atscale/Tab Portfolio.dc.html
 *
 *   Hero (value verdict + briefing card) → account strip (one column per account)
 *   → main: holdings (weight bar + target tick + fund health) · concentration ·
 *           income history (received vs projected) · fund signals
 *           · [adv] allocation, full holdings table, TTM income, position detail,
 *             income intelligence, transactions, conversion allocation,
 *             target tables, risk budget, per-fund analysis, income analytics
 *   → rail: taxable / Roth target vs actual with drift tags · not-in-target note
 *
 * The per-symbol aggregation and the concentration / diversification maths are
 * unchanged from v3.
 */
import { useState } from 'react'
import { fmtMoneyFull, fmtFull, STRUCTURAL_LABEL, STRUCTURAL_STATUS } from '../../utils/formatters'
import type { DashboardData, TargetVsActual } from '../../types/dashboard'
import { SLEEVE_KEYS, SLEEVE_LABEL } from './DetailTab.constants'
import type { HoldingRow } from './DetailTab.constants'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { IncomeTTMSection } from './IncomeTTMSection'
import { TransactionHistory } from './TransactionHistory'
import { IncomeHistory } from './IncomeHistory'
import { HoldingsTable } from './HoldingsTable'
import { PositionDetail } from './PositionDetail'
import { IncomeIntelligence } from './IncomeIntelligence'
import { RothConversionBanner, RothConversionTable } from './RothConversion'
import { DecisionActionStrip } from './DecisionActionStrip'
import { TabBriefingPanel } from '../ui/TabBriefingPanel'
import { PortfolioDonutChart } from './PortfolioDonutChart'
import { PortfolioAllocationChart } from './PortfolioAllocationChart'
import { PortfolioRiskBudget } from './PortfolioRiskBudget'
import { FundAnalysis } from './FundAnalysis'
import { EnhancedTargetAllocationTable } from './EnhancedTargetAllocationTable'
import { PositionNarrative } from './PositionNarrative'
import { DecisionRationale } from './DecisionRationale'
import {
  PageHero, LeadMuted, HeroMeta, Section, Sections, MainRail, RuledList, TileGrid, GridTile, StatusChip,
  Segmented, Label, Callout, mono, muted, gain, moneyUnit, signedMoney, signedPct, type Status,
} from '../ui/primitives'

interface Props { data: DashboardData }

const ACCOUNT_BAR = ['var(--fd-accent)', 'var(--fd-lilac-ink)', 'var(--fd-lime-ink)', 'var(--fd-muted)']

export function DetailTab({ data }: Props) {
  const [mode] = useGlobalViewMode()
  const [vizMode, setVizMode] = useState<'donut' | 'list'>('donut')
  const ia = data.income_analytics
  const pi = data.portfolio_intel
  const s = data.summary
  const totalValue = s.total_value

  // ── Per-account and merged holdings (unchanged aggregation) ──
  const sleeveHoldings: { key: string; label: string; holdings: HoldingRow[]; totalValue: number; dayChg: number; income: number; reinvested: boolean }[] = []
  const holdingsMap: Record<string, HoldingRow & { accts: string[] }> = {}
  for (const acct of data.accounts) {
    const acctMap: Record<string, HoldingRow> = {}
    for (const pos of acct.positions) {
      const snap = data.snapshots[pos.symbol]
      if (!acctMap[pos.symbol]) acctMap[pos.symbol] = { symbol: pos.symbol, shares: 0, value: 0, cost: 0, pnl: 0, annualInc: 0, dayChg: 0, dayPct: (snap?.price_change_pct ?? 0) * 100, acctCount: 0 }
      const h = acctMap[pos.symbol]
      const dc = pos.is_money_market ? 0 : pos.day_change != null ? pos.day_change : (snap?.price_change ?? 0) * pos.shares
      h.shares += pos.shares; h.value += pos.value; h.cost += pos.cost; h.pnl += pos.pnl; h.annualInc += pos.annual_income; h.dayChg += dc; h.acctCount += 1
      const lbl = SLEEVE_LABEL[acct.key] ?? acct.label
      if (!holdingsMap[pos.symbol]) holdingsMap[pos.symbol] = { ...h, dayChg: dc, shares: pos.shares, value: pos.value, cost: pos.cost, pnl: pos.pnl, annualInc: pos.annual_income, acctCount: 1, accts: [lbl] }
      else {
        const g = holdingsMap[pos.symbol]
        g.shares += pos.shares; g.value += pos.value; g.cost += pos.cost; g.pnl += pos.pnl; g.annualInc += pos.annual_income; g.dayChg += dc; g.acctCount += 1
        if (!g.accts.includes(lbl)) g.accts.push(lbl)
      }
    }
    const acctHoldings = Object.values(acctMap).sort((a, b) => b.value - a.value)
    if (acctHoldings.length > 0) {
      sleeveHoldings.push({
        key: acct.key, label: SLEEVE_LABEL[acct.key] ?? acct.label, holdings: acctHoldings,
        totalValue: acctHoldings.reduce((t, h) => t + h.value, 0),
        dayChg: acctHoldings.reduce((t, h) => t + h.dayChg, 0),
        income: ia?.by_account?.[acct.key]?.fwd_12m ?? acctHoldings.reduce((t, h) => t + h.annualInc, 0),
        reinvested: !!ia?.by_account?.[acct.key]?.reinvested,
      })
    }
  }
  sleeveHoldings.sort((a, b) => (SLEEVE_KEYS.indexOf(a.key) + 1 || 99) - (SLEEVE_KEYS.indexOf(b.key) + 1 || 99))
  const holdings = Object.values(holdingsMap).sort((a, b) => b.value - a.value)

  // Portfolio-level target weight per symbol = Σ(sleeve target % × sleeve value) / total.
  // Only taxable and Roth carry targets; symbols with no target in any sleeve get no tick.
  const sleeveVal = (k: 'taxable' | 'roth') => sleeveHoldings.filter(x => k === 'roth' ? x.key.includes('roth') : x.key === 'taxable').reduce((t, x) => t + x.totalValue, 0)
  const targetPortPct: Record<string, number> = {}
  const addTargets = (rows: TargetVsActual[] | undefined, v: number) => {
    for (const r of rows ?? []) if (r.in_target) targetPortPct[r.symbol] = (targetPortPct[r.symbol] ?? 0) + (r.target_pct * v) / (totalValue || 1)
  }
  addTargets(pi?.taxable_target_vs_actual, sleeveVal('taxable'))
  addTargets(pi?.roth_target_vs_actual, sleeveVal('roth'))
  const notInTarget = (pi?.taxable_target_vs_actual ?? []).filter(r => r.in_acct && !r.in_target && r.actual_pct > 0).map(r => r.symbol)
  const outOfBand = [...(pi?.taxable_target_vs_actual ?? []), ...(pi?.roth_target_vs_actual ?? [])].filter(r => r.in_acct && Math.abs(r.delta_pct) > 2).length

  // ── Diversification score + concentration clock (v3 maths) ──
  const fragility = pi?.fragility_score ?? 50
  const volBudget = pi?.vol_budget_used ?? 100
  const fwd12 = ia?.portfolio_fwd_12m ?? 0
  const totalSpend = data.tax_data?.estimated_spending || data.spending_intelligence?.hardcoded_spending || 0
  const covPct = totalSpend > 0 && fwd12 > 0 ? (fwd12 / totalSpend) * 100 : 100
  const wdRate = totalValue > 0 && totalSpend > 0 ? (totalSpend / totalValue) * 100 : 3
  const symsTotal: Record<string, number> = {}
  for (const acct of data.accounts) for (const pos of acct.positions) if (!pos.is_money_market) symsTotal[pos.symbol] = (symsTotal[pos.symbol] ?? 0) + pos.value
  const symsSorted = Object.entries(symsTotal).sort((a, b) => b[1] - a[1])
  const topSym = symsSorted[0]?.[0] ?? '—'
  const topConc = symsSorted.length > 0 ? (symsSorted[0][1] / totalValue) * 100 : 0
  const fragPenalty = (fragility / 100) * 25
  const volPenalty = Math.min(1, Math.max(0, (volBudget - 100) / 150)) * 25
  const concPenalty = Math.min(1, Math.max(0, (topConc - 20) / 50)) * 25
  const covPenalty = Math.max(0, 1 - Math.min(1, covPct / 100)) * 15
  const wdPenalty = Math.min(1, Math.max(0, (wdRate - 3) / 3)) * 10
  const healthScore = Math.round(Math.max(0, Math.min(100, 100 - fragPenalty - volPenalty - concPenalty - covPenalty - wdPenalty)))
  const healthStatus: Status = healthScore >= 75 ? 'ok' : healthScore >= 55 ? 'warn' : 'alert'
  const healthLabel = healthScore >= 75 ? 'Aligned' : healthScore >= 55 ? 'Moderate drift' : 'High drift'
  const top3Conc = symsSorted.slice(0, 3).reduce((t, [, v]) => t + (v / totalValue) * 100, 0)
  const healthDrivers: string[] = []
  if (concPenalty > 8) healthDrivers.push(`${topSym} weight ${topConc.toFixed(1)}%`)
  if (top3Conc > 60) healthDrivers.push(`top 3 holdings ${top3Conc.toFixed(1)}%`)
  if (volPenalty > 8) healthDrivers.push(`vol budget ${volBudget.toFixed(0)}%`)
  if (fragPenalty > 10) healthDrivers.push(`fragility ${fragility}/100`)
  if (covPenalty > 5) healthDrivers.push(`income coverage ${covPct.toFixed(0)}%`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = data.tax_data as any
  const topLotData = tx?.cost_basis_lots?.[topSym]
  const stcgRate = tx ? ((tx.marginal_rate ?? 32) > 1 ? (tx.marginal_rate ?? 32) / 100 : (tx.marginal_rate ?? 0.32)) : 0.32
  const ltcgRate = tx ? ((tx.ltcg_rate ?? 15) > 1 ? (tx.ltcg_rate ?? 15) / 100 : (tx.ltcg_rate ?? 0.15)) : 0.15
  let minDaysToLtcg: number | null = null
  let stcgGain = 0, ltcgGain = 0, stcgShares = 0, ltcgShares = 0
  for (const lot of topLotData?.lots ?? []) {
    const g = (lot.market_value ?? 0) - (lot.cost_basis ?? 0)
    if (lot.days_to_lt > 0) {
      stcgGain += Math.max(0, g); stcgShares += lot.quantity ?? 0
      if (minDaysToLtcg === null || lot.days_to_lt < minDaysToLtcg) minDaysToLtcg = lot.days_to_lt
    } else { ltcgGain += Math.max(0, g); ltcgShares += lot.quantity ?? 0 }
  }
  const rebalanceTaxNow = stcgGain * stcgRate + ltcgGain * ltcgRate
  const taxSavingsWaiting = Math.max(0, rebalanceTaxNow - (stcgGain + ltcgGain) * ltcgRate)

  // Wealth dependency — income share from income_attribution (fwd 12m %), once per symbol
  const attBySym: Record<string, number> = (ia?.income_attribution as { by_symbol?: Record<string, number> } | undefined)?.by_symbol ?? {}
  const topHoldings = symsSorted.slice(0, 2).map(([sym, value]) => ({ sym, value, income: ((attBySym[sym] ?? 0) / 100) * fwd12 }))

  const totalCost = s.total_cost ?? 0
  const yoc = totalCost > 0 && fwd12 > 0 ? (fwd12 / totalCost) * 100 : null
  const mktYield = totalValue > 0 && fwd12 > 0 ? (fwd12 / totalValue) * 100 : null
  const incQuality = pi?.income_durability_score ?? null

  // ── Income history: received per month (this year) + projected for the rest ──
  const hist = data.income_history
  const yr = new Date().getFullYear()
  const nowM = new Date().getMonth()
  const byMonth: number[] = Array(12).fill(0)
  for (const t of hist?.transactions ?? []) {
    const d = new Date(t.date)
    if (d.getFullYear() === yr) byMonth[d.getMonth()] += t.amount
  }
  const projMonthly = fwd12 / 12
  const months = byMonth.map((v, i) => ({ m: 'JFMAMJJASOND'[i], v: i < nowM || v > 0 ? v : projMonthly, projected: i >= nowM && v === 0 }))
  const maxMonth = Math.max(1, ...months.map(x => x.v))

  const pv = moneyUnit(totalValue)
  const growthTilt = (mktYield ?? 0) < 1.5
  const weightScale = 100 / Math.max(25, Math.ceil(((holdings[0]?.value ?? 0) / (totalValue || 1)) * 100 / 5) * 5)

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        eyebrow={`Portfolio · ${data.accounts.length} accounts · ${holdings.length} holdings`}
        before={`${pv.value}${pv.unit ?? ''}, held for `} em={growthTilt ? 'growth' : 'income'} after="."
        lead={<>
          <span>{signedMoney(s.day_change ?? 0, fmtFull)} today · {signedMoney(s.total_pnl, fmtFull)} ({signedPct(s.total_pnl_pct, 1)}) since cost.</span>
          <LeadMuted>Day change uses the end-of-day snapshot baseline, so it matches Schwab. {outOfBand === 0 ? 'Every targeted holding is inside its band.' : `${outOfBand} holding${outOfBand === 1 ? ' is' : 's are'} more than 2 points off target.`}</LeadMuted>
        </>}
        aside={
          <div style={{ background: 'var(--fd-card)', padding: 32, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <TabBriefingPanel endpoint="/api/briefing/portfolio" title="Portfolio briefing" />
          </div>
        }
      >
        <HeroMeta items={[
          { k: 'Fwd 12m', v: fwd12 > 0 ? fmtMoneyFull(fwd12) : '—' },
          { k: 'Yield', v: mktYield != null ? `${mktYield.toFixed(2)}%` : '—' },
          { k: 'Yield on cost', v: yoc != null ? `${yoc.toFixed(2)}%` : '—' },
          { k: 'Cost', v: fmtMoneyFull(totalCost) },
          { k: 'Income durability', v: incQuality != null ? `${incQuality.toFixed(0)}/100${pi?.inc_stability_lbl ? ` ${pi.inc_stability_lbl}` : ''}` : '—' },
        ]} />
      </PageHero>

      {/* Account strip */}
      <section style={{ display: 'grid', gridTemplateColumns: `repeat(${sleeveHoldings.length || 1}, minmax(0,1fr))`, borderTop: '1px solid var(--fd-hairline)', borderBottom: '1px solid var(--fd-hairline)' }}>
        {sleeveHoldings.map((a, i) => {
          const share = totalValue > 0 ? (a.totalValue / totalValue) * 100 : 0
          return (
            <div key={a.key} style={{ padding: '28px 24px 28px 0', marginRight: 24, borderRight: '1px solid var(--fd-hairline)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Label>{a.label}</Label><span style={{ fontSize: 13, ...muted }}>{share.toFixed(1)}%</span>
              </div>
              <span style={{ fontSize: 40, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1 }}>{fmtMoneyFull(a.totalValue)}</span>
              <span style={{ fontSize: 14 }}>
                <span style={{ color: gain(a.dayChg), fontWeight: 500 }}>{signedMoney(a.dayChg, fmtFull)}</span>
                <span style={muted}> today · {a.reinvested ? 'reinvested' : 'income'} {fmtFull(a.income)}/yr</span>
              </span>
              <div style={{ height: 6, background: 'var(--fd-hairline)' }}><div style={{ height: 6, width: `${share}%`, background: ACCOUNT_BAR[i % ACCOUNT_BAR.length] }} /></div>
            </div>
          )
        })}
      </section>

      <Sections>
        <MainRail
          main={<>
            <Section title="Holdings" meta="Sorted by weight · all accounts">
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: HOLD_COLS, gap: 12, padding: '10px 0', borderTop: '2px solid var(--fd-rule)', borderBottom: '1px solid var(--fd-hairline)', ...mono, ...muted }}>
                  <span>Symbol</span><span>Weight</span><span style={{ textAlign: 'right' }}>Value</span><span style={{ textAlign: 'right' }}>Today</span>
                  <span style={{ textAlign: 'right' }}>P&amp;L</span><span style={{ textAlign: 'right' }}>Yield</span><span>Fund health</span>
                </div>
                {holdings.map(h => {
                  const w = totalValue > 0 ? (h.value / totalValue) * 100 : 0
                  const t = targetPortPct[h.symbol]
                  const over = t == null ? notInTarget.includes(h.symbol) : w - t > 2
                  const dec = data.decisions.find(d => d.symbol === h.symbol)
                  const yld = h.value > 0 && h.annualInc > 0 ? (h.annualInc / h.value) * 100 : null
                  const isCash = data.accounts.some(a => a.positions.some(p => p.symbol === h.symbol && p.is_money_market))
                  return (
                    <div key={h.symbol} className="fd-row" style={{ display: 'grid', gridTemplateColumns: HOLD_COLS, gap: 12, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }}>{h.symbol}</span>
                        <span style={{ fontSize: 12, ...muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.accts.join(' · ')}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} title={t != null ? `Target ${t.toFixed(1)}% of portfolio` : 'No target'}>
                        <div style={{ flex: 1, height: 8, background: 'var(--fd-hairline)', position: 'relative' }}>
                          <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${Math.min(100, w * weightScale)}%`, background: over ? 'var(--fd-negative)' : 'var(--fd-accent)' }} />
                          {t != null && <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${Math.min(100, t * weightScale)}%`, width: 2, background: 'var(--fd-ink)' }} />}
                        </div>
                        <span style={{ fontSize: 13, width: 44, textAlign: 'right' }}>{w.toFixed(1)}%</span>
                      </div>
                      <span style={{ textAlign: 'right', fontWeight: 500 }}>{fmtMoneyFull(h.value)}</span>
                      <span style={{ textAlign: 'right', color: isCash ? 'var(--fd-muted)' : gain(h.dayPct) }}>{isCash ? '—' : signedPct(h.dayPct)}</span>
                      <span style={{ textAlign: 'right', color: h.pnl < 0 ? 'var(--fd-negative)' : 'var(--fd-ink)' }}>{isCash ? '—' : signedMoney(h.pnl, fmtFull)}</span>
                      <span style={{ textAlign: 'right' }}>{yld != null ? `${yld.toFixed(2)}%` : '—'}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, minWidth: 0, whiteSpace: 'nowrap' }}>
                        {dec ? (<>
                          <StatusChip status={STRUCTURAL_STATUS[dec.structural_status] ?? 'info'} size={10} />
                          <DecisionRationale symbol={h.symbol} icon={STRUCTURAL_LABEL[dec.structural_status] ?? dec.structural_status} color="var(--fd-ink)" />
                        </>) : <span style={muted}>—</span>}
                        {!isCash && <span style={{ marginLeft: 'auto' }}><PositionNarrative symbol={h.symbol} /></span>}
                      </span>
                    </div>
                  )
                })}
              </div>
              <span style={{ fontSize: 13, ...muted }}>Bar shows current weight; the tick marks the target weight. Vermillion = more than 2 points over target, or held without a target.</span>
            </Section>

            <Section title="Concentration" meta={`${topSym} · ${topConc.toFixed(1)}% of portfolio`}>
              <TileGrid cols={3}>
                <GridTile label="Diversification score" status={healthStatus} value={<>{healthScore}<span style={{ fontSize: 16, ...muted }}> /100</span></>}
                  sub={<>{healthLabel}. {healthDrivers.length ? `Drivers: ${healthDrivers.join(', ')}.` : 'No material detractors.'} Measures deviation from a diversification model, not income safety — high drift is expected for a concentration-by-design portfolio.</>} />
                <GridTile label={`Tax to rebalance ${topSym} now`} value={rebalanceTaxNow > 0 ? fmtMoneyFull(rebalanceTaxNow) : '—'}
                  sub={`${stcgShares > 0 ? `${stcgShares.toFixed(0)} sh short-term (+${fmtMoneyFull(stcgGain)})` : 'No short-term lots'} · ${ltcgShares > 0 ? `${ltcgShares.toFixed(0)} sh long-term (+${fmtMoneyFull(ltcgGain)})` : 'no long-term lots'} · ${(stcgRate * 100).toFixed(0)}% / ${(ltcgRate * 100).toFixed(0)}%`} />
                <GridTile label="Savings by waiting" value={taxSavingsWaiting > 0 ? fmtMoneyFull(taxSavingsWaiting) : '—'}
                  sub={minDaysToLtcg != null ? `Next lot reaches long-term rates in ${minDaysToLtcg} days` : 'All lots are already long-term'} />
              </TileGrid>
              {topHoldings.length > 0 && (
                <RuledList>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(3, 120px)', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--fd-hairline)', ...mono, ...muted }}>
                    <span>Wealth dependency · if it falls</span><span style={{ textAlign: 'right' }}>−20%</span><span style={{ textAlign: 'right' }}>−30%</span><span style={{ textAlign: 'right' }}>−40%</span>
                  </div>
                  {topHoldings.map(h => (
                    <div key={h.sym} style={{ display: 'grid', gridTemplateColumns: '1fr repeat(3, 120px)', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14, alignItems: 'baseline' }}>
                      <span><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{h.sym}</span> <span style={{ fontSize: 13, ...muted }}>{((h.value / totalValue) * 100).toFixed(1)}% of portfolio · {fwd12 > 0 ? ((h.income / fwd12) * 100).toFixed(1) : '0.0'}% of income</span></span>
                      {[0.2, 0.3, 0.4].map(d => (
                        <span key={d} style={{ textAlign: 'right' }}>
                          <span style={{ color: 'var(--fd-negative)', fontWeight: 500 }}>−${((h.value * d) / 1e6).toFixed(2)}M</span>
                          {h.income > 0 && <span style={{ display: 'block', fontSize: 13, ...muted }}>−{fmtFull(h.income * d)}/yr</span>}
                        </span>
                      ))}
                    </div>
                  ))}
                </RuledList>
              )}
            </Section>

            {hist && (
              <Section title={`Income history — ${yr}`} meta={<span style={{ fontSize: 18, fontWeight: 500 }}>{fmtMoneyFull(hist.ytd_total ?? 0)} received</span>}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 8, alignItems: 'end', height: 180, borderBottom: '1px solid var(--fd-hairline)' }}>
                  {months.map((x, i) => (
                    <div key={i} title={`${x.projected ? 'Projected' : 'Received'} ${fmtMoneyFull(x.v)}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, ...muted, whiteSpace: 'nowrap' }}>{x.v > 0 ? `$${(x.v / 1000).toFixed(1)}K` : ''}</span>
                      <div style={{ width: '100%', height: Math.max(x.v > 0 ? 2 : 0, (x.v / maxMonth) * 140), background: x.projected ? 'var(--fd-lilac-ink)' : 'var(--fd-accent)' }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 8, ...mono, ...muted, textAlign: 'center' }}>
                  {months.map((x, i) => <span key={i}>{x.m}</span>)}
                </div>
                <span style={{ fontSize: 13, ...muted }}>Solid bars received. Lilac bars projected from forward 12-month income ({fmtFull(projMonthly)}/mo).</span>
              </Section>
            )}

            {data.decisions.length > 0 && (
              <Section title="Fund signals" meta="Portfolio fit · decision engine">
                <DecisionActionStrip data={data} />
              </Section>
            )}

            {mode === 'advanced' && (<>
              <Section title="Allocation" meta={<Segmented size="sm" value={vizMode} onChange={setVizMode} options={[{ id: 'donut', label: 'Donut' }, { id: 'list', label: 'List' }]} />}>
                {sleeveHoldings.map(sleeve => (
                  <div key={sleeve.key} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--fd-rule)', paddingTop: 12 }}>
                      <span style={{ fontSize: 18, fontWeight: 500 }}>{sleeve.label}</span>
                      <span style={{ fontSize: 14, ...muted }}>{fmtMoneyFull(sleeve.totalValue)} · {sleeve.holdings.length} position{sleeve.holdings.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: vizMode === 'list' ? '220px 1fr' : '1fr 1.5fr', gap: 24 }}>
                      {vizMode === 'donut'
                        ? <PortfolioDonutChart holdings={sleeve.holdings} totalValue={sleeve.totalValue} data={data} accountLabel={sleeve.label} />
                        : <RuledList>{sleeve.holdings.slice(0, 10).map(h => (
                            <div key={h.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14 }}>
                              <span style={{ fontFamily: 'var(--font-mono)' }}>{h.symbol}</span><span>{((h.value / sleeve.totalValue) * 100).toFixed(1)}%</span>
                            </div>))}</RuledList>}
                      <PortfolioAllocationChart holdings={sleeve.holdings} totalValue={sleeve.totalValue} data={data} />
                    </div>
                  </div>
                ))}
              </Section>
              <Section title="All columns" meta={`${holdings.length} holdings`}>
                <HoldingsTable holdings={holdings} totalValue={totalValue} data={data} />
              </Section>
              <IncomeTTMSection data={data} />
              <Section title="Position detail by account"><PositionDetail data={data} /></Section>
              {ia && <Section title="Income intelligence"><IncomeIntelligence ia={ia} data={data} /></Section>}
              {(hist?.transactions?.length ?? 0) > 0 && (
                <Section title="Income transactions" meta={`${hist!.transactions.length} received`}><TransactionHistory data={data} /></Section>
              )}
              {(data.roth_conversions?.length ?? 0) > 0 && (
                <Section title="Rollover conversion allocation"><RothConversionBanner data={data} ia={ia} /><RothConversionTable data={data} /></Section>
              )}
              {(data.roth_target_analysis?.length ?? 0) > 0 && (
                <Section title="Roth IRA target allocation"><EnhancedTargetAllocationTable rows={data.roth_target_analysis} data={data} accountType="roth" /></Section>
              )}
              {(data.taxable_target_analysis?.length ?? 0) > 0 && (
                <Section title="Taxable target allocation"><EnhancedTargetAllocationTable rows={data.taxable_target_analysis} data={data} accountType="taxable" /></Section>
              )}
              <Section title="Portfolio risk budget"><PortfolioRiskBudget holdings={holdings} totalValue={totalValue} data={data} /></Section>
              <Section title="Per-fund analysis"><FundAnalysis data={data} pi={pi} /></Section>
              <Section title="Income analytics" meta="By account · tax composition · stress">
                <IncomeHistory data={data} months={['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']} ia={ia} />
              </Section>
            </>)}
          </>}
          rail={<>
            <TargetRail title="Taxable target" rows={pi?.taxable_target_vs_actual ?? []} />
            <TargetRail title="Roth target" rows={pi?.roth_target_vs_actual ?? []} />
            {notInTarget.length > 0 && (
              <Callout>
                <span style={{ ...mono, display: 'block', marginBottom: 6 }}>Not in target · sell to 0%</span>
                {notInTarget.join(', ')} {notInTarget.length === 1 ? 'sits' : 'sit'} in Taxable without a target. The rebalance plan in Tax schedules {notInTarget.length === 1 ? 'its' : 'their'} exit.
              </Callout>
            )}
          </>}
        />
      </Sections>
    </div>
  )
}

const HOLD_COLS = '72px minmax(0,1.2fr) 104px 72px 96px 64px minmax(0,1.5fr)'

function TargetRail({ title, rows }: { title: string; rows: TargetVsActual[] }) {
  const shown = rows.filter(r => r.in_target || r.in_acct)
  if (shown.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{title}</h3><Label>Actual / target</Label>
      </div>
      <RuledList>
        {shown.map(r => {
          const d = r.delta_pct
          const big = Math.abs(d) > 2, mid = Math.abs(d) > 0.9
          return (
            <div key={r.symbol} title={`30% drawdown stress: ${r.stress_30_pct.toFixed(1)}%`} style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.symbol}</span>
              <span style={muted}>{r.actual_pct.toFixed(1)}% / {r.in_target ? `${r.target_pct.toFixed(1)}%` : 'none'}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, height: 22, display: 'inline-flex', alignItems: 'center', padding: '0 8px', borderRadius: 8,
                background: big ? 'var(--fd-alert)' : mid ? 'var(--as-lilac)' : 'transparent', color: big ? 'var(--as-warm-white)' : mid ? 'var(--as-washed-black)' : 'var(--fd-ink)',
              }}>{d > 0 ? '+' : d < 0 ? '−' : ''}{Math.abs(d).toFixed(1)}</span>
            </div>
          )
        })}
      </RuledList>
    </div>
  )
}
