/**
 * Drawdown Strategy Engine — CFP-grade withdrawal sequencing module
 *
 * Answers: "From which account do I withdraw first, how much, and when —
 * to maximize portfolio longevity and minimize lifetime taxes?"
 *
 * Sub-tabs:
 *  1. Withdrawal Order Optimizer — compare 5 strategies side-by-side
 *  2. Lifetime Tax Minimizer     — bracket drift, conversion opportunities
 *  3. Account Longevity          — when each account depletes
 *  4. Safe Spending Range        — probability-based floor/ceiling
 *  5. What-If Sandbox            — scenario explorer
 */

import { useState, useMemo } from 'react'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { PageHero, LeadMuted, KpiStrip, Section, Sections, SegGroup, SegBtn, MonoNote, mono, muted, moneyUnit } from '../ui/primitives'
import { MetricTooltip } from '../ui/MetricTooltip'
import { SubTabBtn, SubTabBar } from '../ui/SubTabBtn'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import { RMD_START_AGE } from '../../utils/taxConfig'
import type { DashboardData } from '../../types/dashboard'
import {
  runDrawdown,
  type DrawdownResult,
} from './drawdown.engine'
import { useDrawdownPlan } from '../../context/DrawdownPlanContext'
import { AnnualDecisionPanel }  from './AnnualDecisionPanel'
// RebalancePlanPanel moved to TaxTab → "Sell & Rebalance" sub-view
import { type SubTab } from './drawdown.shared'
import { OptimizerPanel }           from './OptimizerPanel'
import { TaxPanel }                 from './TaxPanel'
import { LongevityPanel }           from './LongevityPanel'
import { SpendingPlanPanel }        from './SpendingPlanPanel'
import { RiskDashboardPanel }       from './RiskDashboardPanel'
import { SandboxPanel }             from './SandboxPanel'
import { PersistentActionChecklist } from './PersistentActionChecklist'
import { PlainSummaryPanel }        from './PlainSummaryPanel'
import { WsSection } from '../workspace/WorkspaceContext'
import { useWsSubTabs } from '../workspace/context'

// ─── Main DrawdownTab ─────────────────────────────────────────────────────────
interface Props { data: DashboardData }

export function DrawdownTab({ data }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('decision')
  useWsSubTabs(subTab, setSubTab as (s: string) => void)
  const [mode] = useGlobalViewMode()
  // Editable inputs — shared via context so Tax tab's Sell & Rebalance section
  // sizes its plan to the same taxable withdrawal need shown here.
  const { inputs, updateInput } = useDrawdownPlan()

  // Optimizer / Tax / Longevity / hero cards — use income_target as the withdrawal amount
  // so the income_target slider drives all strategy panels, matching the warning labels.
  const result: DrawdownResult = useMemo(() => runDrawdown({
    ...inputs,
    annual_spending: inputs.income_target,
  }), [inputs])

  // SpendingRange / Guardrails — explicitly based on lifestyle spending, NOT income_target.
  // These panels document this distinction; they get their own simulation result.
  const sspResult: DrawdownResult = useMemo(() => runDrawdown(inputs), [inputs])

  const tx      = data.tax_data

  // SS planning controls — sourced from server ss_options (personal.json → API)
  const ssOptions    = tx.ss_options ?? {}
  const ssOptionKeys = Object.keys(ssOptions)
  const ageToKey = (age: number) =>
    age <= 62 ? 'age_62' : age <= 65 ? 'age_65' : age <= 67 ? 'age_67' : 'age_70'
  const defaultSsKey = ssOptionKeys.includes(ageToKey(tx.ss_start_age ?? 70))
    ? ageToKey(tx.ss_start_age ?? 70)
    : ssOptionKeys[ssOptionKeys.length - 1] ?? 'age_70'
  const [ssCollect, setSsCollect] = useState<boolean>(() => inputs.ss_annual > 0)
  const [ssAgeKey,  setSsAgeKey]  = useState<string>(defaultSsKey)

  // Find account balances for display
  const taxableAcct  = data.accounts.find(a => a.key?.includes('taxable') || a.label?.toLowerCase().includes('taxable'))
  const rothAcct     = data.accounts.find(a => a.key?.includes('roth') || a.label?.toLowerCase().includes('roth'))

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'decision',       label: 'Annual decision' },
    { id: 'optimizer',      label: 'Withdrawal schedule' },
    { id: 'tax',            label: 'Lifetime tax' },
    // 'rebalance' removed — now lives in Tax tab → "Sell & Rebalance" sub-view
    { id: 'guardrails',     label: 'Spending plan' },
    { id: 'longevity',      label: 'Depletion and legacy' },
    { id: 'sandbox',        label: 'What-if sandbox' },
    { id: 'risk',           label: 'Risk' },
    { id: 'summary',        label: 'Summary' },
  ]

  const bestLon = result.strategies.find(s => s.id === result.best_longevity)!
  const bestTax = result.strategies.find(s => s.id === result.best_tax)!
  const lifetimeTaxSavings = Math.max(0,
    result.strategies.reduce((max, s) => Math.max(max, s.total_taxes), 0) - bestTax.total_taxes
  )

  const ia = data.income_analytics as { target_income?: number } | null
  const presets = [
    (ia?.target_income ?? 0) > 0
      ? { label: data.tax_data.bracket_ceiling_magi != null && Math.abs((ia!.target_income ?? 0) - data.tax_data.bracket_ceiling_magi) < 10000
          ? `Bracket ceiling ${fmtMoney(ia!.target_income)}` : `Target ${fmtMoney(ia!.target_income)}`, value: ia!.target_income! }
      : null,
    { label: '−$20K', value: inputs.income_target - 20000 },
    { label: '+$20K', value: inputs.income_target + 20000 },
  ].filter(Boolean) as { label: string; value: number }[]
  const horizonYrs = inputs.target_age - inputs.current_age
  const param = { display: 'flex', flexDirection: 'column' as const, gap: 8, padding: '20px 24px 20px 0', marginRight: 24, borderRight: '1px solid var(--fd-hairline)', minWidth: 0 }

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        eyebrow={`Drawdown strategy · dividend-first · tax-aware · ${horizonYrs.toFixed(0)}-year plan`}
        before={`${bestTax.label} `} em="wins" after={lifetimeTaxSavings > 0 ? ` by ${fmtMoney(lifetimeTaxSavings)}.` : '.'}
        lead={<>
          <span>{bestTax.description}</span>
          <LeadMuted>Lowest lifetime tax of the {result.strategies.length} strategies at {(inputs.expected_return * 100).toFixed(1)}% return. {bestLon.id === bestTax.id ? 'It also lasts longest.' : `${bestLon.label} lasts longest${bestLon.depleted_at_age == null ? ' — through the full plan' : ` — to age ${bestLon.depleted_at_age}`}.`}</LeadMuted>
        </>}
      />

      <KpiStrip size={32} items={[
        { label: 'Taxable', value: taxableAcct ? moneyUnit(inputs.taxable_balance).value : '—', unit: taxableAcct ? moneyUnit(inputs.taxable_balance).unit : undefined, sub: taxableAcct?.label ?? 'Taxable brokerage' },
        { label: 'Rollover IRA', value: inputs.rollover_balance > 0 ? moneyUnit(inputs.rollover_balance).value : '—', unit: inputs.rollover_balance > 0 ? moneyUnit(inputs.rollover_balance).unit : undefined, sub: 'Conversion vehicle only' },
        { label: 'Roth IRA', value: inputs.roth_balance > 0 ? moneyUnit(inputs.roth_balance).value : '—', unit: inputs.roth_balance > 0 ? moneyUnit(inputs.roth_balance).unit : undefined, sub: rothAcct?.label ?? 'Roth IRA' },
        { label: 'Tracked spending', value: moneyUnit(inputs.annual_spending).value, unit: moneyUnit(inputs.annual_spending).unit, sub: `${fmtMoney(inputs.annual_spending / 12)}/mo · transactions` },
        { label: 'Best for longevity', value: bestLon.label, status: bestLon.depleted_at_age == null ? 'ok' : 'warn', sub: bestLon.depleted_at_age == null ? 'Lasts the full plan' : `Depletes at ${bestLon.depleted_at_age}` },
        { label: 'Tax savings', value: moneyUnit(lifetimeTaxSavings).value, unit: moneyUnit(lifetimeTaxSavings).unit, status: lifetimeTaxSavings > 50000 ? 'ok' : undefined, sub: `vs worst strategy · best ${bestTax.label}` },
      ]} />

      <Sections>
        <WsSection id="dd_params" value={fmtMoney(inputs.income_target)} status="info">
        <Section title="Plan parameters" meta={`Return ${(inputs.expected_return * 100).toFixed(1)}% · yield ${(inputs.dividend_yield * 100).toFixed(1)}% · qualified ${Math.round(inputs.qualified_pct * 100)}% — from the portfolio`}>
          <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1.6fr', borderTop: '2px solid var(--fd-rule)', borderBottom: '1px solid var(--fd-hairline)' }}>
            <div style={param}>
              <span style={{ ...mono, ...muted, display: 'inline-flex', alignItems: 'center' }}>Income target<MetricTooltip metricId="income_target_drawdown" label="Income Target" size={12} /></span>
              <span style={{ fontSize: 32, fontWeight: 500, lineHeight: 1 }}>{fmtMoneyFull(inputs.income_target)}</span>
              <span style={{ fontSize: 13, ...muted }}>{fmtMoney(inputs.income_target / 12)}/mo · tracked {fmtMoney(inputs.annual_spending)}/yr</span>
              <input type="range" aria-label="Income target"
                min={Math.max(20000, inputs.annual_spending)}
                max={Math.min(1_000_000, Math.max(inputs.income_target * 1.5, data.tax_data.bracket_ceiling_magi ?? inputs.income_target + 150000))}
                step={5000} value={inputs.income_target} onChange={e => updateInput('income_target', Number(e.target.value))} />
              <SegGroup>
                {presets.map(b => <SegBtn key={b.label} active={Math.abs(b.value - inputs.income_target) < 1000} onClick={() => updateInput('income_target', Math.max(20000, b.value))}>{b.label}</SegBtn>)}
              </SegGroup>
            </div>
            <div style={param}>
              <span style={{ ...mono, ...muted }}>Inflation</span>
              <span style={{ fontSize: 32, fontWeight: 500, lineHeight: 1 }}>{(inputs.inflation * 100).toFixed(1)}%</span>
              <span style={{ fontSize: 13, ...muted }}>Per year assumed</span>
              <input type="range" aria-label="Inflation" min={0.01} max={0.06} step={0.005} value={inputs.inflation} onChange={e => updateInput('inflation', Number(e.target.value))} />
              <div style={{ display: 'flex', justifyContent: 'space-between', ...mono, ...muted }}><span>1%</span><span>6%</span></div>
            </div>
            <div style={param}>
              <span style={{ ...mono, ...muted }}>Plan horizon</span>
              <span style={{ fontSize: 32, fontWeight: 500, lineHeight: 1 }}>Age {inputs.target_age}</span>
              <span style={{ fontSize: 13, ...muted }}>{horizonYrs.toFixed(0)} years from now</span>
              <input type="range" aria-label="Plan horizon" min={75} max={100} step={1} value={inputs.target_age} onChange={e => updateInput('target_age', Number(e.target.value))} />
              <div style={{ display: 'flex', justifyContent: 'space-between', ...mono, ...muted }}><span>75</span><span>100</span></div>
            </div>
            <div style={{ ...param, borderRight: 'none', marginRight: 0 }}>
              <span style={{ ...mono, ...muted }}>Social Security</span>
              {ssCollect && ssOptions[ssAgeKey]
                ? <><span style={{ fontSize: 32, fontWeight: 500, lineHeight: 1 }}>{fmtMoneyFull(ssOptions[ssAgeKey].annual)}<span style={{ fontSize: 14, ...muted }}>/yr</span></span>
                    <span style={{ fontSize: 13, ...muted }}>Age {ssAgeKey.replace('age_', '')} · {ssOptions[ssAgeKey].date} · ${ssOptions[ssAgeKey].monthly.toLocaleString()}/mo</span></>
                : <><span style={{ fontSize: 24, fontWeight: 500, lineHeight: 1 }}>Not collecting</span><span style={{ fontSize: 13, ...muted }}>Select a start age</span></>}
              <SegGroup>
                {[{ key: null as string | null, label: 'None' }, ...ssOptionKeys.map(k => ({ key: k, label: k.replace('age_', '') }))].map(({ key, label }) => (
                  <SegBtn key={label} active={key === null ? !ssCollect : ssCollect && ssAgeKey === key} onClick={() => {
                    if (key === null) { setSsCollect(false); updateInput('ss_annual', 0) }
                    else {
                      setSsCollect(true); setSsAgeKey(key)
                      const opt = ssOptions[key]
                      if (opt) updateInput('ss_annual', opt.annual)
                      updateInput('ss_start_age', parseInt(key.replace('age_', ''), 10))
                    }
                  }}>{label}</SegBtn>
                ))}
              </SegGroup>
            </div>
          </div>
          <span style={{ fontSize: 13, ...muted }}>Balances, return, yield and qualified share come live from Schwab and portfolio analytics · 2026 MFJ brackets · RMDs begin at {data.tax_data.rmd_start_age ?? RMD_START_AGE}. Change the other assumptions in the What-if sandbox.</span>
        </Section>
        </WsSection>

        <PersistentActionChecklist data={data} />

        <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, borderTop: '2px solid var(--fd-rule)', paddingTop: 16 }}>
          <SubTabBar>
            {subTabs.map((t, i) => <SubTabBtn key={t.id} label={t.label} index={i + 1} active={subTab === t.id} onClick={() => setSubTab(t.id)} />)}
          </SubTabBar>
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* AnnualDecisionPanel stays mounted (hidden when inactive) to keep its local state. */}
          <div style={{ display: subTab === 'decision' ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', alignSelf: 'flex-end' }}>
              <input type="checkbox" checked={inputs.do_roth_conversion} onChange={e => updateInput('do_roth_conversion', e.target.checked)} style={{ accentColor: 'var(--fd-accent)' }} />
              Include Roth conversions
            </label>
            <AnnualDecisionPanel data={data} engineSpending={inputs.income_target} doConversion={inputs.do_roth_conversion} mode={mode} />
          </div>
          {subTab === 'optimizer' && <OptimizerPanel result={result} inputs={inputs} data={data} incomeTarget={inputs.income_target} mode={mode} />}
          {subTab === 'tax' && <TaxPanel result={result} data={data} incomeTarget={inputs.income_target} mode={mode} />}
          {subTab === 'guardrails' && (mode === 'advanced'
            ? <SpendingPlanPanel result={sspResult} inputs={inputs} data={data} mode={mode} />
            : <MonoNote>Switch the header to Advanced to see the safe spending range and guardrails.</MonoNote>)}
          {subTab === 'longevity' && <LongevityPanel result={result} data={data} inputs={inputs} mode={mode} />}
          {subTab === 'sandbox' && <SandboxPanel baseInputs={inputs} data={data} />}
          {subTab === 'risk' && <RiskDashboardPanel result={result} inputs={inputs} data={data} />}
          {subTab === 'summary' && <PlainSummaryPanel result={result} inputs={inputs} data={data} />}
        </div>
      </Sections>
    </div>
  )
}
