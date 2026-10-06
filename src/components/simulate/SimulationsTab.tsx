import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TerminalSection } from '../ui/Terminal'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import { useWellnessData } from '../../hooks/useDashboardData'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { PageHero, LeadMuted, KpiStrip, Sections, MainRail, RuledList, KeyValueRow, Label, Button, moneyUnit, type Status } from '../ui/primitives'
import type { DashboardData } from '../../types/dashboard'
import { roundTo2 } from './simTypes'
import type { SimDefaults } from './simTypes'
import { fetchSimDefaults } from './simTypes'
import { DRAWDOWN_DEFAULTS } from '../../utils/taxConfig'
import { DEFAULT_ANNUAL_SPENDING } from '../../utils/constants'
import { LongevityMeter, Slider } from './SimSharedComponents'
import { FutureStrategyTimeline } from './FutureStrategyTimeline'
import { MonteCarloPanel } from './MonteCarloPanel'
import { SequenceRiskPanel } from './SequenceRiskPanel'
import { WithdrawalPanel } from './WithdrawalPanel'
import { SpendingRangePanel } from './SpendingRangePanel'
import { SandboxPanel } from './SandboxPanel'
import { SubTabBtn, SubTabBar } from '../ui/SubTabBtn'
import { WsSection } from '../workspace/WorkspaceContext'
import { useWorkspace, useWsSubTabs } from '../workspace/context'

type SubTab = 'monte_carlo' | 'sequence_risk' | 'withdrawal' | 'spending_range' | 'sandbox'
interface Props { data: DashboardData }

interface SharedParams {
  spending: number
  ret: number     // % (e.g. 7.0)
  vol: number     // % (e.g. 12.0)
  inf: number     // % (e.g. 3.0)
  ss: number      // $
  targetAge: number
}

// Sub-nav pills come from the shared ui/SubTabBtn — one implementation for all tabs.

export function SimulationsTab({ data }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('monte_carlo')
  useWsSubTabs(subTab, setSubTab as (s: string) => void)
  const wsOn = useWorkspace().enabled   // the rail's view switcher replaces the sub-tab bar
  const [mode] = useGlobalViewMode()
  const { data: w } = useWellnessData()
  const { data: defaults } = useQuery<SimDefaults>({
    queryKey: ['sim-defaults'],
    queryFn: fetchSimDefaults,
    staleTime: 60 * 1000,
    retry: 1,
  })

  const tx = data.tax_data
  const summary = data.summary

  const si = data.spending_intelligence as any
  const spendingFallback = si?.hardcoded_spending
    ?? (summary.total_income > 0 ? summary.total_income * 1.1 : DEFAULT_ANNUAL_SPENDING)
  const fallbackDefaults: SimDefaults = {
    spending: spendingFallback,
    expected_return: DRAWDOWN_DEFAULTS.expected_return,
    volatility: DRAWDOWN_DEFAULTS.volatility,
    inflation: DRAWDOWN_DEFAULTS.inflation,
    ss_annual: tx.ss_annual ?? 0,
    ss_start_age: tx.ss_start_age ?? 70,
    current_age: tx.current_age ?? 65,
    target_age: tx.target_age ?? 95,
    portfolio_value: summary.total_value > 0 ? summary.total_value : 1000000,
  }

  const livePortfolio = summary.total_value > 0 ? summary.total_value : undefined
  const liveSpending = si?.hardcoded_spending ?? undefined
  const base = defaults ?? fallbackDefaults
  const d: SimDefaults = {
    ...base,
    portfolio_value: livePortfolio ?? base.portfolio_value,
    spending: liveSpending ?? base.spending,
  }

  // ── Shared simulation parameters (lifted from MonteCarloPanel) ────────────
  const [sharedParams, setSharedParams] = useState<SharedParams>(() => ({
    spending: fallbackDefaults.spending,
    ret: roundTo2(fallbackDefaults.expected_return * 100),
    vol: roundTo2(fallbackDefaults.volatility * 100),
    inf: roundTo2(fallbackDefaults.inflation * 100),
    ss: fallbackDefaults.ss_annual,
    targetAge: fallbackDefaults.target_age,
  }))
  const [paramsSeeded, setParamsSeeded] = useState(false)

  // Seed from server defaults once loaded
  useEffect(() => {
    if (defaults && !paramsSeeded) {
      setSharedParams({
        spending: liveSpending ?? defaults.spending,
        ret: roundTo2(defaults.expected_return * 100),
        vol: roundTo2(defaults.volatility * 100),
        inf: roundTo2(defaults.inflation * 100),
        ss: defaults.ss_annual,
        targetAge: defaults.target_age,
      })
      setParamsSeeded(true)
    }
  }, [defaults]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build effective defaults merging live non-param fields + shared params
  const effectiveDefaults: SimDefaults = {
    ...d,
    spending: sharedParams.spending,
    expected_return: sharedParams.ret / 100,
    volatility: sharedParams.vol / 100,
    inflation: sharedParams.inf / 100,
    ss_annual: sharedParams.ss,
    target_age: sharedParams.targetAge,
  }

  const sp = (p: keyof SharedParams) => (v: number) =>
    setSharedParams(prev => ({ ...prev, [p]: p === 'spending' || p === 'ss' ? v : roundTo2(v) }))
  const resetParams = () =>
    setSharedParams({
      spending: d.spending,
      ret: roundTo2(d.expected_return * 100),
      vol: roundTo2(d.volatility * 100),
      inf: roundTo2(d.inflation * 100),
      ss: d.ss_annual,
      targetAge: d.target_age,
    })

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'monte_carlo',    label: 'Lifetime projection' },
    { id: 'sequence_risk',  label: 'Sequence stress' },
    { id: 'withdrawal',     label: 'Withdrawal rules' },
    { id: 'spending_range', label: 'Safe spending range' },
    { id: 'sandbox',        label: 'What-if sandbox' },
  ]

  const pi = data.portfolio_intel
  const withdrawalRate = d.portfolio_value > 0 ? (sharedParams.spending / d.portfolio_value) * 100 : null
  const wrStatus: Status | undefined = withdrawalRate == null ? undefined : withdrawalRate < 3 ? 'ok' : withdrawalRate < 4 ? 'watch' : withdrawalRate < 5 ? 'warn' : 'alert'
  const success = w ? w.success_prob_100 * 100 : null
  const conf = pi?.system_confidence_score

  const NOTES: Record<SubTab, string> = {
    monte_carlo: 'Each path draws a random return sequence from the expected return and volatility you set. The band shows where most futures land; the success rate is the share of paths that never fall below the failure line before the target age.',
    sequence_risk: 'The same average return can end very differently depending on the order. A bad first few years while you are withdrawing does the most damage — this replays that case.',
    withdrawal: 'Compares withdrawal rules on the same simulated markets so the difference comes from the rule, not luck.',
    spending_range: 'The floor and ceiling are the spending levels that keep the chosen success probability — a range to plan within, not a single number.',
    sandbox: 'Change any input here without touching the shared parameters above.',
  }

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        eyebrow={`Simulate · Monte Carlo to age ${sharedParams.targetAge}`}
        before={success != null ? `${success.toFixed(1)}% of futures ` : 'Futures that '} em="last" after="."
        lead={<>
          <span>Withdrawing {fmtMoneyFull(sharedParams.spending)} a year from {fmtMoneyFull(d.portfolio_value)}{withdrawalRate != null ? ` — a ${withdrawalRate.toFixed(1)}% rate` : ''} — at {sharedParams.ret}% expected return and {sharedParams.vol}% volatility.</span>
          <LeadMuted>The headline uses the plan's Monte Carlo (wellness engine); the panels below re-run live with the parameters on the right.</LeadMuted>
        </>}
        asideTitle="Shared parameters"
        aside={
          <div style={{ background: 'var(--fd-card)', padding: 32, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Label>Shared parameters</Label>
              <Button size="sm" onClick={resetParams}>Reset</Button>
            </div>
            <Slider label="Gross withdrawal target" value={sharedParams.spending} min={20000} max={250000} step={1000} unit="$" onChange={sp('spending')} />
            <Slider label="Expected return" value={sharedParams.ret} min={3} max={14} step={0.5} unit="%" onChange={sp('ret')} />
            <Slider label="Volatility" value={sharedParams.vol} min={5} max={30} step={0.5} unit="%" onChange={sp('vol')} />
            <Slider label="Inflation" value={sharedParams.inf} min={1} max={6} step={0.25} unit="%" onChange={sp('inf')} />
            <Slider label="Social Security (earner)" value={sharedParams.ss} min={0} max={90000} step={500} unit="$" onChange={sp('ss')} />
          </div>
        }
      />

      <KpiStrip size={32} items={[
        { label: 'Portfolio', value: d.portfolio_value > 0 ? moneyUnit(d.portfolio_value).value : '—', unit: d.portfolio_value > 0 ? moneyUnit(d.portfolio_value).unit : undefined, sub: 'Total investable assets' },
        { label: 'Withdrawal target', value: moneyUnit(sharedParams.spending).value, unit: moneyUnit(sharedParams.spending).unit, sub: `${fmtMoney(sharedParams.spending / 12)}/mo · incl. taxes${si?.true_annual_spending != null ? ` · tracked ${fmtMoney(si.true_annual_spending)}` : ''}` },
        { label: 'Withdrawal rate', value: withdrawalRate != null ? withdrawalRate.toFixed(1) : '—', unit: withdrawalRate != null ? '%' : undefined, status: wrStatus, sub: 'Of the portfolio each year' },
        { label: 'Age', value: `${d.current_age}`, sub: `Target age ${sharedParams.targetAge}` },
        { label: 'Social Security', value: sharedParams.ss > 0 ? moneyUnit(sharedParams.ss).value : '—', unit: sharedParams.ss > 0 ? moneyUnit(sharedParams.ss).unit : undefined, sub: `Earner · age ${d.ss_start_age} · spousal +${fmtMoney(sharedParams.ss * 0.5)} separately` },
        { label: 'Confidence', value: conf != null ? conf.toFixed(0) : '—', unit: conf != null ? '/100' : undefined, status: conf == null ? undefined : conf >= 70 ? 'ok' : conf >= 50 ? 'watch' : 'alert', sub: pi?.system_confidence_label ?? 'Portfolio metrics' },
      ]} />

      <Sections>
        <LongevityMeter currentAge={d.current_age} targetAge={sharedParams.targetAge} onTargetAgeChange={age => setSharedParams(prev => ({ ...prev, targetAge: age }))} />

        {!wsOn && (
        <nav style={{ borderTop: '2px solid var(--fd-rule)', paddingTop: 16 }}>
          <SubTabBar>
            {subTabs.map((t, i) => <SubTabBtn key={t.id} label={t.label} index={i + 1} active={subTab === t.id} onClick={() => setSubTab(t.id)} />)}
          </SubTabBar>
        </nav>
        )}

        <MainRail
          main={<>
            {subTab === 'monte_carlo'    && <MonteCarloPanel    defaults={effectiveDefaults} />}
            {subTab === 'sequence_risk'  && <SequenceRiskPanel  defaults={effectiveDefaults} />}
            {subTab === 'withdrawal'     && <WithdrawalPanel    defaults={effectiveDefaults} />}
            {subTab === 'spending_range' && <SpendingRangePanel defaults={effectiveDefaults} />}
            {subTab === 'sandbox'        && <SandboxPanel       defaults={effectiveDefaults} />}
          </>}
          rail={<>
            <WsSection id="sm_notes">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>What it means</h3>
              <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0 }}>{NOTES[subTab]}</p>
            </div>
            </WsSection>
            {w && (
              <WsSection id="sm_wellness" value={`${(w.success_prob_100 * 100).toFixed(1)}%`} status={w.success_prob_100 >= 0.9 ? 'ok' : w.success_prob_100 >= 0.75 ? 'watch' : 'alert'}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Financial wellness</h3>
                <RuledList>
                  <KeyValueRow k="Lasts to 100" v={`${(w.success_prob_100 * 100).toFixed(1)}%`} />
                  <KeyValueRow k="Lasts to 95" v={`${(w.success_prob_95 * 100).toFixed(1)}%`} />
                  <KeyValueRow k="Safe spending" sub="95% chance the money lasts" v={`${fmtMoney(w.safe_spending)}/yr`} />
                  <KeyValueRow k="Portfolio at 95" sub="Median outcome" v={fmtMoney(w.projected_95_median)} />
                  <KeyValueRow k="Failure line" v={fmtMoney(w.ruin_threshold)} />
                </RuledList>
              </div>
              </WsSection>
            )}
          </>}
        />

        {mode === 'advanced' && data.summary.total_value > 0 && (
          <WsSection id="sm_future">
          <TerminalSection id="future-strategy" title="Future strategy timeline">
            <FutureStrategyTimeline data={data} />
          </TerminalSection>
          </WsSection>
        )}
      </Sections>
    </div>
  )
}
