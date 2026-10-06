/**
 * PredictionsTab — mechanical forward simulator.
 * Spec: docs/predictions-tab-spec.md
 *
 * UX: Simple / Advanced toggle — mirrors rest of terminal.
 *   Simple  → 5 hero charts + 3 scenario cards. No tables.
 *   Advanced → A–H collapsible sections with mini-charts, stress test,
 *              confidence meter, regime overlay, "what changed" panel.
 *
 * Engine: deterministic, server-data-driven.
 *   Model assumptions (PRICE_GROWTH, DIV_GROWTH) are the only hardcoded values.
 */

import { useState, useMemo } from 'react'
import { TerminalSection } from '../ui/Terminal'
import { TabBriefingPanel } from '../ui/TabBriefingPanel'
import type { DashboardData } from '../../types/dashboard'

import {
  PRICE_GROWTH, DIV_GROWTH, EXPENSE_INFLATION, STRESS_MODS, SCENARIO_META,
  type Scenario, type Horizon, type StressTest,
} from './predictions.constants'
import {
  buildPositions, buildTargetPositions, computeProjection, buildIncomeByType,
} from './predictions.engine'
import { DEFAULT_ANNUAL_SPENDING } from '../../utils/constants'
import {
  ScenarioHero, YearMilestones, ScenarioFanChart,
  YearProjectionTable, ScenarioComparison,
} from './predictions.simple'
import {
  GrowthChart, SummaryStatusBar,
} from './predictions.charts'
import {
  SectionB_Advanced, SectionC_Advanced, SectionD_Advanced,
  SectionE_Advanced, SectionG_Advanced, SectionH_Advanced,
  ConfidenceMeter, WhatChanged,
} from './predictions.advanced'
import {
  ScenarioToggle, HorizonToggle,
} from './predictions.controls'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { WsSection } from '../workspace/WorkspaceContext'
import { PageHero, LeadMuted, HeroMeta, KpiStrip, Section, Sections, MainRail, RuledList, Label, SegGroup, SegBtn, mono, muted, moneyUnit } from '../ui/primitives'

// ─── Main ──────────────────────────────────────────────────────────────────────
interface Props { data: DashboardData }

export function PredictionsTab({ data }: Props) {
  const [mode] = useGlobalViewMode()
  const [scenario,  setScenario]  = useState<Scenario>('base')
  const [horizon,   setHorizon]   = useState<Horizon>(5)
  const [stress,    setStress]    = useState<StressTest>('none')

  const positions = useMemo(() => buildPositions(data), [data])
  const targetPos = useMemo(() => buildTargetPositions(data), [data])
  const stressMod = STRESS_MODS[stress]

  // Compute all three scenarios with current stress modifier
  const baseProj   = useMemo(() => computeProjection(data, 'base', horizon, positions, stressMod), [data, horizon, positions, stressMod])
  const bullProj   = useMemo(() => computeProjection(data, 'bull', horizon, positions, stressMod), [data, horizon, positions, stressMod])
  const bearProj   = useMemo(() => computeProjection(data, 'bear', horizon, positions, stressMod), [data, horizon, positions, stressMod])
  const projs      = useMemo(() => ({ base: baseProj, bull: bullProj, bear: bearProj }), [baseProj, bullProj, bearProj])

  // Fixed-length (max horizon) projections — independent of the currently
  // selected `horizon`. YearMilestones renders a tile for every entry in
  // HORIZONS (1/3/5/10) and indexes into this array by year; if it were fed
  // the horizon-sized `projs` above, selecting e.g. 1YR would shrink the
  // array to 1 row and silently drop the 3/5/10YR tiles until a refresh
  // reset `horizon` back to a longer value.
  const MAX_HORIZON: Horizon = 10
  const baseProjMax = useMemo(() => computeProjection(data, 'base', MAX_HORIZON, positions, stressMod), [data, positions, stressMod])
  const bullProjMax = useMemo(() => computeProjection(data, 'bull', MAX_HORIZON, positions, stressMod), [data, positions, stressMod])
  const bearProjMax = useMemo(() => computeProjection(data, 'bear', MAX_HORIZON, positions, stressMod), [data, positions, stressMod])
  const projsMax    = useMemo(() => ({ base: baseProjMax, bull: bullProjMax, bear: bearProjMax }), [baseProjMax, bullProjMax, bearProjMax])
  const scenarioProj = projs[scenario]
  // Target projection: value uses target taxable+roth positions, rollover stays current
  const targetProj = useMemo(() => computeProjection(data, 'base', horizon, { taxable: targetPos.taxable, rollover: positions.rollover, roth: targetPos.roth }, stressMod), [data, horizon, targetPos, positions, stressMod])

  const todayYr  = new Date().getFullYear()
  const todayVal = data.summary.total_value
  // Spendable fwd12m: taxable + Roth only — Rollover IRA dividends reinvest inside the IRA
  // and are not available cash. The server already leaves them out of portfolio_fwd_12m.
  const { serverTotal: spendableFwd12m } = useMemo(() => buildIncomeByType(data), [data])
  const fwd12m   = spendableFwd12m > 0 ? spendableFwd12m : (data.income_analytics?.portfolio_fwd_12m ?? 0)
  // Use the canonical portfolio_fwd_12m for the "today" display label so it matches
  // every other tab. The chart anchor (fwd12m) stays on the spendable-only figure.
  const fwd12mDisplay = data.income_analytics?.portfolio_fwd_12m ?? fwd12m
  // Income goal: the configured target income (from income_analytics), inflation-adjusted
  // each year at 2.5%/yr so it stays meaningful in real terms and diverges clearly from base.
  const incomeGoalBase = data.income_analytics?.target_income ?? fwd12m

  // Chart data
  const growthChartData = useMemo(() => [
    { year: todayYr, base: todayVal, bull: todayVal, bear: todayVal, target: todayVal },
    ...baseProj.map((r, i) => ({ year: r.calYear, base: r.portfolioValue, bull: bullProj[i].portfolioValue, bear: bearProj[i].portfolioValue, target: targetProj[i].portfolioValue })),
  ], [baseProj, bullProj, bearProj, targetProj, todayYr, todayVal])

  // Income chart: base/bull/bear from current allocation + inflation-adjusted income goal line.
  // The goal line shows what you NEED to earn each year in nominal dollars (target × 2.5%/yr),
  // not the target-allocation projection which was visually identical to base.
  const incomeChartData = useMemo(() => [
    {
      year: todayYr, base: fwd12m, bull: fwd12m, bear: fwd12m,
      target: incomeGoalBase,
      expenses: baseProj[0]?.expenses ?? 0,
    },
    ...baseProj.map((r, i) => ({
      year:     r.calYear,
      base:     r.annualIncome + r.ssIncome,
      bull:     (bullProj[i]?.annualIncome ?? 0) + (bullProj[i]?.ssIncome ?? 0),
      bear:     (bearProj[i]?.annualIncome ?? 0) + (bearProj[i]?.ssIncome ?? 0),
      // Income goal grows at 2.5%/yr (base inflation) to maintain real purchasing power
      target:   incomeGoalBase * Math.pow(1 + EXPENSE_INFLATION.base, i + 1),
      expenses: r.expenses,
    })),
  ], [baseProj, bullProj, bearProj, incomeGoalBase, fwd12m, todayYr])

  const si = data.spending_intelligence
  // Expense base = PLAN spending from Settings (estimated_spending, mirrored as
  // si.hardcoded_spending). Taxes are modeled separately in the TAX column, so
  // do NOT subtract them here. Tracked lifestyle spend is the fallback only.
  // (The old `tracked − taxes` formula went ≤ 0 and silently flipped to the
  // plan number anyway, while the footnote claimed "lifestyle".)
  const expBase = si?.hardcoded_spending
    ?? si?.true_annual_spending
    ?? data.tax_data.spending_true_annual
    ?? DEFAULT_ANNUAL_SPENDING

  const regime    = data.portfolio_intel?.market_regime
  const volRegime = data.portfolio_intel?.vol_regime

  const last = scenarioProj[scenarioProj.length - 1]
  const endVal = last ? moneyUnit(last.portfolioValue) : { value: '—' }
  const annDiv = last ? last.annualIncome + last.ssIncome : 0
  const surplus = last?.netCashflow ?? 0
  const effTaxPct = (last?.effectiveRate ?? 0) * 100
  const pctChange = last && todayVal > 0 ? ((last.portfolioValue - todayVal) / todayVal) * 100 : 0
  const fmtS = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n.toFixed(0)}`
  const tracked = data.spending_intelligence?.true_annual_spending ?? data.tax_data?.spending_true_annual
  const vsTracked = last && last.expenseBasis === 'plan' && tracked && tracked > 0
    ? (last.netCashflow + last.federalTax + last.expenses) - last.federalTax - tracked : null
  const ssOpts = Object.values(data.tax_data?.ss_options ?? {}).sort((a, b) => a.annual - b.annual)
  const ssAge = data.tax_data?.ss_start_age

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        eyebrow={`Forecast · ${horizon}-year · ${scenario} scenario${stress !== 'none' ? ` · stress ${STRESS_MODS[stress].label}` : ''}`}
        before={`${endVal.value}${endVal.unit ?? ''} by `} em={String(todayYr + horizon)} after="."
        lead={<>
          <span>{pctChange >= 0 ? 'Up' : 'Down'} {Math.abs(pctChange).toFixed(0)}% from {fmtS(todayVal)} today. Annual dividends reach {fmtS(annDiv)} against {fmtS(fwd12mDisplay)} today.</span>
          <LeadMuted>{SCENARIO_META[scenario].desc}. Mechanical and deterministic — no AI in the projection.</LeadMuted>
        </>}
        asideTitle="Scenario, horizon and stress"
        aside={
          <div style={{ background: 'var(--fd-card)', padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Label>Scenario</Label><ScenarioToggle value={scenario} onChange={setScenario} />
            <Label>Horizon</Label><HorizonToggle value={horizon} onChange={setHorizon} />
            <Label>Stress overlay</Label>
            <SegGroup>
              {(Object.keys(STRESS_MODS) as StressTest[]).map(s => (
                <SegBtn key={s} active={stress === s} onClick={() => setStress(s)}>{s === 'none' ? 'None' : STRESS_MODS[s].label}</SegBtn>
              ))}
            </SegGroup>
          </div>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <HeroMeta items={[{ k: 'Regime', v: regime ?? '—' }, { k: 'Vol', v: volRegime ?? '—' }]} />
          <ConfidenceMeter data={data} />
        </div>
      </PageHero>

      {last && (
        <KpiStrip items={[
          { label: `Portfolio · ${todayYr + horizon}`, value: endVal.value, unit: endVal.unit, sub: `${pctChange >= 0 ? '+' : '−'}${Math.abs(pctChange).toFixed(0)}% from ${fmtS(todayVal)} today` },
          { label: 'Annual dividends', value: moneyUnit(annDiv).value, unit: moneyUnit(annDiv).unit, sub: `${fmtS(annDiv / 12)}/mo · ${annDiv > fwd12mDisplay ? 'above' : 'below'} today` },
          { label: surplus >= 0 ? 'Annual surplus' : last.expenseBasis === 'plan' ? 'Principal draw' : 'Annual deficit', value: `${surplus >= 0 ? '+' : '−'}${fmtS(Math.abs(surplus))}`, valueColor: surplus >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)',
            sub: `vs ${last.expenseBasis === 'plan' ? 'plan' : 'tracked'} spending ${fmtS(last.expenses)}/yr${vsTracked != null ? ` · vs tracked ${vsTracked >= 0 ? '+' : '−'}${fmtS(Math.abs(vsTracked))}` : ''}` },
          { label: 'Effective tax rate', value: effTaxPct.toFixed(0), unit: '%', status: effTaxPct > 22 ? 'alert' : effTaxPct > 17 ? 'warn' : 'ok', sub: `AGI ${fmtS(last.grossIncome)} · ${effTaxPct > 22 ? 'check conversions' : effTaxPct > 17 ? 'moderate bracket' : 'room for conversions'}` },
        ]} />
      )}

      <Sections>
        <WhatChanged baseProj={baseProj} horizon={horizon} />

        <WsSection id="fc_growth" value={`${endVal.value}${endVal.unit ?? ''}`} status={pctChange >= 0 ? 'ok' : 'warn'}>
        <Section title="Portfolio growth projection" meta={<span style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          {(['base', 'bull', 'bear'] as Scenario[]).map(s => <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, opacity: s === scenario ? 1 : 0.6 }}><span style={{ width: 20, height: 3, background: SCENARIO_META[s].color }} />{s}</span>)}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 20, height: 0, borderTop: '2px dashed var(--fd-muted)' }} />target</span>
        </span>}>
          <ScenarioFanChart chartData={growthChartData} scenario={scenario} horizon={horizon} todayYr={todayYr} />
        </Section>
        </WsSection>

        <WsSection id="fc_milestones" value={`${horizon}-year`}>
        <YearMilestones projs={projsMax} scenario={scenario} horizon={horizon} onHorizonChange={setHorizon} />
        </WsSection>

        <MainRail
          main={<>
            <WsSection id="fc_year_by_year" value={`${scenarioProj.length} years`}>
            <Section title="Year by year" meta={`${scenario} scenario`}>
              <YearProjectionTable proj={scenarioProj} scenario={scenario} />
            </Section>
            </WsSection>
            <WsSection id="fc_scenario_compare">
            <Section title="Scenario comparison" meta={`${horizon}-year`}>
              <ScenarioComparison projs={projs} horizon={horizon} scenario={scenario} todayVal={todayVal} />
            </Section>
            </WsSection>
          </>}
          rail={<>
            {ssOpts.length > 0 && (
              <WsSection id="fc_ss_timing" value={ssAge != null ? `Age ${ssAge}` : undefined}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Social Security timing</h3>
                <RuledList>
                  {ssOpts.map(o => {
                    const chosen = ssAge != null && o.label.includes(String(ssAge))
                    return (
                      <div key={o.label} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14 }}>
                        <span style={{ fontWeight: chosen ? 500 : 400, color: chosen ? 'var(--fd-accent)' : undefined }}>{o.label}</span>
                        <span style={{ fontWeight: 500, color: chosen ? 'var(--fd-accent)' : undefined }}>{fmtS(o.annual)}/yr</span>
                        <span style={{ gridColumn: '1 / span 2', fontSize: 13, ...muted }}>{fmtS(o.monthly)}/mo from {o.date}{chosen ? ' · current plan' : ''}</span>
                      </div>
                    )
                  })}
                </RuledList>
              </div>
              </WsSection>
            )}
            <WsSection id="fc_briefing">
            <div style={{ background: 'var(--fd-card)', padding: 24 }}>
              <TabBriefingPanel endpoint="/api/briefing/forecast" title="Forecast briefing" />
            </div>
            </WsSection>
            {mode === 'advanced' && (
              <WsSection id="fc_assumptions">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.5 }}>
                <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Assumptions</h3>
                <RuledList>
                  {[
                    ['Scenario', SCENARIO_META[scenario].desc],
                    ['Price growth', Object.entries(PRICE_GROWTH).filter(([k]) => k !== 'UNKNOWN').map(([k, v]) => `${k.toLowerCase()} ${v[scenario] >= 0 ? '+' : ''}${(v[scenario] * 100).toFixed(0)}%`).join(' · ')],
                    ['Dividend growth', Object.entries(DIV_GROWTH).filter(([k]) => k !== 'UNKNOWN').map(([k, v]) => `${k.toLowerCase()} ${v[scenario] >= 0 ? '+' : ''}${(v[scenario] * 100).toFixed(0)}%`).join(' · ')],
                    ['Expense inflation', `${(EXPENSE_INFLATION[scenario] * 100).toFixed(1)}%/yr general; healthcare typically 5–6%`],
                    ['CEF premium', `${scenario === 'bear' ? '−35%' : '−15%'}/yr mean reversion (no impact at 0% premium)`],
                    ['Tax', 'Planned Roth conversions in AGI · 2026 MFJ brackets'],
                    ...(scenario === 'bear' ? [['Bear note', 'Rates apply continuously, not as a one-time crash — layer the −20% crash stress for an immediate shock']] : []),
                    ...(stress !== 'none' ? [['Stress', `${STRESS_MODS[stress].label} applied`]] : []),
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
                      <span style={{ ...mono, ...muted }}>{k}</span><span>{v}</span>
                    </div>
                  ))}
                </RuledList>
              </div>
              </WsSection>
            )}
          </>}
        />

        {mode === 'advanced' && (<>
          <ScenarioHero proj={scenarioProj} scenario={scenario} horizon={horizon} todayVal={todayVal} fwd12m={fwd12m} />
          <WsSection id="fc_growth_all">
          <TerminalSection id="pred-a" title="Portfolio growth projection — all scenarios">
            <GrowthChart chartData={growthChartData} regime={regime} />
          </TerminalSection>
          </WsSection>
          <WsSection id="fc_status" value={regime ?? undefined}>
          <SummaryStatusBar baseProj={baseProj} data={data} />
          </WsSection>
          <WsSection id="fc_income">
          <Label style={{ color: 'var(--fd-accent)' }}>Portfolio and income projection</Label>
          <SectionB_Advanced allChartData={incomeChartData} baseProj={baseProj} data={data} />
          </WsSection>
          <WsSection id="fc_nav">
          <Label style={{ color: 'var(--fd-accent)' }}>Structural risk — factors that could change the projection</Label>
          <SectionC_Advanced data={data} scenario={scenario} horizon={horizon} />
          </WsSection>
          <WsSection id="fc_tax" value={`${effTaxPct.toFixed(0)}% eff`} status={effTaxPct > 22 ? 'alert' : effTaxPct > 17 ? 'warn' : 'ok'}>
          <SectionD_Advanced baseProj={baseProj} bullProj={bullProj} bearProj={bearProj} />
          </WsSection>
          <WsSection id="fc_cashflow" value={last ? `${surplus >= 0 ? '+' : '−'}${fmtS(Math.abs(surplus))}` : undefined} status={last ? (surplus >= 0 ? 'ok' : 'warn') : undefined}>
          <SectionE_Advanced baseProj={baseProj} bullProj={bullProj} bearProj={bearProj} expBase={expBase} />
          </WsSection>
          <WsSection id="fc_symbols">
          <SectionG_Advanced data={data} scenario={scenario} horizon={horizon} />
          </WsSection>
          <WsSection id="fc_signals">
          <SectionH_Advanced data={data} baseProj={baseProj} bullProj={bullProj} bearProj={bearProj} />
          </WsSection>
        </>)}
      </Sections>
    </div>
  )
}
