/**
 * SandboxPanel — What-If Sandbox
 * Lines ~2330–2972 of the original DrawdownTab.tsx
 */

import { useState, useMemo } from 'react'
import {
  LineChart, Line,
  XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine,
  Legend,
} from 'recharts'
import { TerminalSection } from '../ui/Terminal'
import { WsSection } from '../workspace/WorkspaceContext'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import type { DashboardData } from '../../types/dashboard'
import {
  runDrawdown,
  computeAnnualDecision,
  buildAnnualDecisionInputs,
  type DrawdownInputs,
  type StrategyId,
} from './drawdown.engine'
import { G, R, A, M, BL, STRATEGY_COLORS, fmt, pct, InputRow } from './drawdown.shared'

type SandboxDelta = {
  spending_delta:   number
  return_delta:     number
  inflation_delta:  number
  div_yield_delta:  number
  qualified_delta:  number
  ss_start_age:     number
  target_age:       number
  portfolio_shock:  number
}
type SandboxPreset = { label: string; icon: string; d: SandboxDelta }

export function SandboxPanel({ baseInputs, data }: { baseInputs: DrawdownInputs; data: DashboardData }) {
  const [delta, setDelta] = useState<SandboxDelta>({
    spending_delta:   50000,
    return_delta:     -2,
    inflation_delta:  0,
    div_yield_delta:  0,
    qualified_delta:  0,
    ss_start_age:     baseInputs.ss_start_age,
    target_age:       baseInputs.target_age,
    portfolio_shock:  0,
  })
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyId>('dynamic_bracket')

  // Baseline uses income_target as spending — same as Optimizer/Tax/Longevity panels
  const baseResult = useMemo(() => runDrawdown({
    ...baseInputs,
    annual_spending: baseInputs.income_target,
  }), [baseInputs])

  const scenarioInputs: DrawdownInputs = useMemo(() => ({
    ...baseInputs,
    annual_spending:  baseInputs.income_target + delta.spending_delta,
    expected_return:  Math.max(0.01, baseInputs.expected_return + delta.return_delta / 100),
    inflation:        Math.max(0.005, baseInputs.inflation + delta.inflation_delta / 100),
    dividend_yield:   Math.max(0.005, Math.min(0.20, baseInputs.dividend_yield + delta.div_yield_delta / 100)),
    qualified_pct:    Math.max(0, Math.min(1, baseInputs.qualified_pct + delta.qualified_delta / 100)),
    ss_start_age:     delta.ss_start_age,
    target_age:       delta.target_age,
    taxable_balance:  baseInputs.taxable_balance  * (1 - delta.portfolio_shock / 100),
    rollover_balance: baseInputs.rollover_balance * (1 - delta.portfolio_shock / 100),
    roth_balance:     baseInputs.roth_balance     * (1 - delta.portfolio_shock / 100),
  }), [baseInputs, delta])

  const scenarioResult = useMemo(() => runDrawdown(scenarioInputs), [scenarioInputs])

  const scenarios = [
    { label: 'Baseline',  result: baseResult },
    { label: 'Scenario',  result: scenarioResult },
  ]

  // Selected strategy comparison (for chart)
  const baseSel = baseResult.strategies.find(s => s.id === selectedStrategy) ?? baseResult.strategies.find(s => s.id === 'dynamic_bracket')!
  const scenSel = scenarioResult.strategies.find(s => s.id === selectedStrategy) ?? scenarioResult.strategies.find(s => s.id === 'dynamic_bracket')!

  const compData = baseSel.years.map((y, i) => ({
    age: y.age,
    Baseline: Math.round(y.total / 1000),
    Scenario: Math.round((scenSel.years[i]?.total ?? 0) / 1000),
  }))

  // ── Action-level diffs for all 5 sections ────────────────────────────────
  const baseDyn = baseResult.strategies.find(s => s.id === 'dynamic_bracket')!
  const scenDyn = scenarioResult.strategies.find(s => s.id === 'dynamic_bracket')!

  // Section 2: Withdrawal Schedule
  const baseIRADepletion = baseDyn.years.find(y => y.rollover < 1000)?.age ?? null
  const scenIRADepletion = scenDyn.years.find(y => y.rollover < 1000)?.age ?? null
  const baseStrategiesSurvive = baseResult.strategies.filter(s => !s.depleted_at_age).length
  const scenStrategiesSurvive = scenarioResult.strategies.filter(s => !s.depleted_at_age).length

  // Section 3: Tax
  const baseTotalTax = baseDyn.total_taxes
  const scenTotalTax = scenDyn.total_taxes
  const taxDelta = scenTotalTax - baseTotalTax
  const baseAvgEff = baseDyn.years.length > 0
    ? baseDyn.years.reduce((s, y) => s + y.effective_rate, 0) / baseDyn.years.length : 0
  const scenAvgEff = scenDyn.years.length > 0
    ? scenDyn.years.reduce((s, y) => s + y.effective_rate, 0) / scenDyn.years.length : 0
  const baseBracketDrift = baseDyn.years.find(y => y.marginal > 0.30)?.age ?? null
  const scenBracketDrift = scenDyn.years.find(y => y.marginal > 0.30)?.age ?? null

  // Section 4: Spending Plan — SSR tier classification using lifestyle spending as base
  const baseLifestyle = baseInputs.annual_spending
  const baseShortfallFree = baseDyn.shortfall_years === 0
  const baseSSR = {
    conservative: baseLifestyle * (baseShortfallFree ? 1.0  : 0.85),
    moderate:     baseLifestyle * (baseShortfallFree ? 1.10 : 0.95),
    aggressive:   baseLifestyle * (baseShortfallFree ? 1.20 : 1.05),
  }
  const getSpendTier = (spend: number, ssr: typeof baseSSR) =>
    spend <= ssr.conservative ? 'Conservative'
    : spend <= ssr.moderate   ? 'Moderate'
    : spend <= ssr.aggressive ? 'Aggressive'
    : 'Above Maximum'
  const baseIncomeTier = getSpendTier(baseInputs.income_target, baseSSR)
  const scenIncomeTier = getSpendTier(scenarioInputs.annual_spending, baseSSR)

  // Section 5: Depletion & Legacy
  const baseEndingTotal = baseDyn.ending_total
  const scenEndingTotal = scenDyn.ending_total
  const endingDiff = scenEndingTotal - baseEndingTotal
  const baseEndRoth = baseDyn.ending_roth
  const scenEndRoth = scenDyn.ending_roth
  const rothDiff = scenEndRoth - baseEndRoth

  // Section 1: Annual Decision — does scenario spending shift the conversion recommendation?
  const baseLiveAnnualInputs = useMemo(() =>
    buildAnnualDecisionInputs(data, baseInputs.income_target, {
      do_roth_conversion: baseInputs.do_roth_conversion,
    }), [data, baseInputs.income_target, baseInputs.do_roth_conversion])
  const baseLiveAnnual = useMemo(() =>
    computeAnnualDecision(baseLiveAnnualInputs), [baseLiveAnnualInputs])
  const scenLiveAnnualInputs = useMemo(() =>
    buildAnnualDecisionInputs(data, scenarioInputs.annual_spending, {
      do_roth_conversion: baseInputs.do_roth_conversion,
    }), [data, scenarioInputs.annual_spending, baseInputs.do_roth_conversion])
  const scenLiveAnnual = useMemo(() =>
    computeAnnualDecision(scenLiveAnnualInputs), [scenLiveAnnualInputs])

  // Scenario description tags
  const scenTags: string[] = []
  if (delta.spending_delta !== 0) scenTags.push(`${delta.spending_delta > 0 ? '+' : ''}${fmtMoney(delta.spending_delta)} spending`)
  if (delta.return_delta !== 0) scenTags.push(`${delta.return_delta > 0 ? '+' : ''}${delta.return_delta}% return`)
  if (delta.inflation_delta !== 0) scenTags.push(`${delta.inflation_delta > 0 ? '+' : ''}${delta.inflation_delta}% inflation`)
  if (delta.portfolio_shock > 0) scenTags.push(`${delta.portfolio_shock}% shock`)
  if (delta.ss_start_age !== baseInputs.ss_start_age) scenTags.push(`SS at ${delta.ss_start_age}`)
  if (delta.target_age !== baseInputs.target_age) scenTags.push(`horizon to ${delta.target_age}`)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <WsSection id="dd_sandbox_impact" value={scenTags.length > 0 ? `${scenTags.length} change${scenTags.length > 1 ? 's' : ''}` : 'Baseline'} status={scenTags.length > 0 ? 'watch' : 'info'}>
      {/* ── Action Impact Card ───────────────────────────────────────────── */}
      <div style={{ background: 'var(--fd-card)', border: `1px solid ${A}`,
        borderTop: `3px solid ${A}`, padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: A, letterSpacing: '0.8px', marginBottom: 2 }}>
          SANDBOX · PLAN IMPACT SUMMARY
        </div>
        <div style={{ fontSize: 12, color: M, marginBottom: 10 }}>
          {scenTags.length > 0
            ? <>Testing: <strong style={{ color: 'var(--text2)' }}>{scenTags.join(' · ')}</strong> — here's what changes from your recommended plan</>
            : 'Adjust the sliders below to stress-test your plan. Impact on each section updates live.'
          }
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>

          {/* Section 1: Annual Decision */}
          {(() => {
            const baseConv = baseLiveAnnual.roth_conversion
            const scenConv = scenLiveAnnual.roth_conversion
            const baseStop = baseLiveAnnual.tax_optimal_exceeded
            const scenStop = scenLiveAnnual.tax_optimal_exceeded
            const convChanged = Math.abs(scenConv - baseConv) > 1000 || baseStop !== scenStop
            const sev = convChanged ? A : G
            return (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, minWidth: 14, color: sev, paddingTop: 1 }}>{convChanged ? '' : '✓'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)', marginBottom: 2 }}>Annual Decision (Section 1)</div>
                  <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text2)' }}>Baseline:</span>{' '}
                    {baseStop
                      ? <span style={{ color: R }}>STOP conversions — above optimal</span>
                      : baseConv > 0
                        ? <span>Convert <strong style={{ color: 'var(--text2)' }}>{fmtMoney(baseConv)}</strong> to Roth before Dec 31</span>
                        : <span>No conversion — bracket full</span>
                    }
                    {' '}&rarr;{' '}
                    {convChanged
                      ? scenStop
                          ? <span style={{ color: R }}>Conversion stop still applies in scenario</span>
                          : scenConv > baseConv
                            ? <span style={{ color: R }}>Scenario spending pushes bracket — conversion drops to <strong>{fmtMoney(scenConv)}</strong></span>
                            : <span style={{ color: A }}>Scenario changes conversion to <strong style={{ color: 'var(--text2)' }}>{fmtMoney(scenConv)}</strong></span>
                      : <span style={{ color: G }}>Same instruction applies — no change this year</span>
                    }
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Section 2: Withdrawal Schedule */}
          {(() => {
            const dbFails = scenDyn.depleted_at_age != null
            const iraShift = baseIRADepletion !== scenIRADepletion
            const survivalDrop = scenStrategiesSurvive < baseStrategiesSurvive
            const anyChange = dbFails || iraShift || survivalDrop
            const sev = dbFails ? R : anyChange ? A : G
            return (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, minWidth: 14, color: sev, paddingTop: 1 }}>{dbFails ? '' : anyChange ? '' : '✓'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)', marginBottom: 2 }}>Withdrawal Schedule (Section 2)</div>
                  <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text2)' }}>Baseline:</span>{' '}
                    Dynamic Bracket survives · IRA depletes {baseIRADepletion ? `at ${baseIRADepletion}` : 'never'} · {baseStrategiesSurvive}/5 strategies intact
                    {' '}&rarr;{' '}
                    {dbFails
                      ? <span style={{ color: R }}>Dynamic Bracket depletes at age {scenDyn.depleted_at_age} — plan fails</span>
                      : anyChange
                        ? <>
                            {iraShift && <span style={{ color: A }}>IRA depletion {scenIRADepletion ? `moves to age ${scenIRADepletion}` : 'removed'}</span>}
                            {survivalDrop && <span style={{ color: A }}>{iraShift ? ' · ' : ''}{scenStrategiesSurvive}/5 strategies survive (down from {baseStrategiesSurvive})</span>}
                          </>
                        : <span style={{ color: G }}>All strategies survive — same account timeline</span>
                    }
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Section 3: Tax Outlook */}
          {(() => {
            const taxUp = taxDelta > 10000
            const rateUp = scenAvgEff - baseAvgEff > 0.3
            const bracketEarlier = scenBracketDrift != null && (baseBracketDrift == null || scenBracketDrift < baseBracketDrift)
            const anyChange = taxUp || rateUp || bracketEarlier
            const sev = taxDelta > 50000 ? R : anyChange ? A : G
            return (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, minWidth: 14, color: sev, paddingTop: 1 }}>{taxDelta > 50000 ? '' : anyChange ? '' : '✓'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)', marginBottom: 2 }}>Tax Outlook (Section 3)</div>
                  <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text2)' }}>Baseline:</span>{' '}
                    <strong style={{ color: 'var(--text2)' }}>{fmtMoney(baseTotalTax)}</strong> lifetime · avg <strong>{baseAvgEff.toFixed(1)}%</strong> eff. rate
                    {baseBracketDrift ? ` · bracket drift at ${baseBracketDrift}` : ''}
                    {' '}&rarr;{' '}
                    {anyChange
                      ? <span style={{ color: sev }}>
                          {taxDelta >= 0 ? '+' : ''}{fmtMoney(taxDelta)} lifetime ·{' '}
                          {scenAvgEff.toFixed(1)}% avg rate
                          {bracketEarlier ? <span style={{ color: A }}> · bracket drift moves to {scenBracketDrift}</span> : null}
                        </span>
                      : <span style={{ color: G }}>No material change in tax trajectory</span>
                    }
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Section 4: Spending Plan */}
          {(() => {
            const tierChanged = scenIncomeTier !== baseIncomeTier
            const planFails = scenDyn.depleted_at_age != null
            const sev = (tierChanged && (scenIncomeTier === 'Above Maximum' || planFails)) ? R : tierChanged ? A : G
            return (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, minWidth: 14, color: sev, paddingTop: 1 }}>{sev === R ? '' : sev === A ? '' : '✓'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)', marginBottom: 2 }}>Spending Plan (Section 4)</div>
                  <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text2)' }}>Baseline:</span>{' '}
                    <strong style={{ color: 'var(--text2)' }}>{fmtMoneyFull(baseInputs.income_target)}/yr</strong> → <strong>{baseIncomeTier}</strong> tier
                    {' '}&rarr;{' '}
                    {tierChanged
                      ? <span style={{ color: sev }}>
                          <strong>{fmtMoneyFull(scenarioInputs.annual_spending)}/yr</strong> moves to <strong>{scenIncomeTier}</strong> tier
                          {planFails ? ' — portfolio cannot sustain this level' : ''}
                        </span>
                      : <span style={{ color: G }}>Stays in <strong>{baseIncomeTier}</strong> tier — no plan adjustment needed</span>
                    }
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Section 5: Depletion & Legacy */}
          {(() => {
            const depletes = scenDyn.depleted_at_age != null
            const endingDown = endingDiff < -100000
            const rothDown = rothDiff < -50000
            const anyChange = depletes || endingDown || rothDown
            const sev = depletes ? R : endingDown || rothDown ? A : G
            return (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, minWidth: 14, color: sev, paddingTop: 1 }}>{depletes ? '' : anyChange ? '' : '✓'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)', marginBottom: 2 }}>Depletion &amp; Legacy (Section 5)</div>
                  <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text2)' }}>Baseline:</span>{' '}
                    ending <strong style={{ color: 'var(--text2)' }}>{fmtMoney(baseEndingTotal)}</strong> · Roth <strong>{fmtMoney(baseEndRoth)}</strong>
                    {' '}&rarr;{' '}
                    {depletes
                      ? <span style={{ color: R }}>Depletes at age {scenDyn.depleted_at_age} — Roth is last reserve, do not touch it</span>
                      : anyChange
                        ? <span style={{ color: sev }}>
                            Ending {endingDiff >= 0 ? '+' : ''}{fmtMoney(endingDiff)} · Roth {rothDiff >= 0 ? '+' : ''}{fmtMoney(rothDiff)}
                          </span>
                        : <span style={{ color: G }}>Minimal impact — legacy preserved</span>
                    }
                  </div>
                </div>
              </div>
            )
          })()}

        </div>

        {/* SS impact footer (only if SS age changed) */}
        {data.tax_data.ss_annual > 0 && delta.ss_start_age !== baseInputs.ss_start_age && (() => {
          const baseSSLifetime = data.tax_data.ss_annual * (baseInputs.target_age - baseInputs.ss_start_age)
          const scenSSLifetime = data.tax_data.ss_annual
            * (1 + 0.08 * Math.max(0, delta.ss_start_age - baseInputs.ss_start_age))
            * Math.max(0, baseInputs.target_age - delta.ss_start_age)
          const ssDiff = scenSSLifetime - baseSSLifetime
          return (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid var(--fd-hairline)`,
              fontSize: 12, color: M, lineHeight: 1.5 }}>
              <strong style={{ color: A }}>SS Impact:</strong>{' '}
              Claiming at {delta.ss_start_age} vs {baseInputs.ss_start_age} →{' '}
              Lifetime SS income: <strong style={{ color: 'var(--text2)' }}>{fmtMoney(Math.round(scenSSLifetime))}</strong>{' '}
              (baseline: {fmtMoney(baseSSLifetime)}) ·{' '}
              <span style={{ color: ssDiff >= 0 ? G : R, fontWeight: 500 }}>
                {ssDiff >= 0 ? '+' : ''}{fmtMoney(Math.round(ssDiff))}
              </span>{' '}
              over {baseInputs.target_age - Math.min(delta.ss_start_age, baseInputs.ss_start_age)} years
            </div>
          )
        })()}
      </div>

      </WsSection>

      {/* ── Scenario Controls ─────────────────────────────────────────────── */}
      <WsSection id="dd_sandbox_controls">
      <TerminalSection id="sandbox-controls" title="Scenario Controls — adjust parameters to stress-test your plan · all changes update the impact summary above" defaultOpen accent={A}>
        {/* Preset scenario buttons */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {([
            { label: 'Bear Case',      icon: '', d: { spending_delta: 50000, return_delta: -3, inflation_delta: 1,  div_yield_delta: 0, qualified_delta: 0, ss_start_age: baseInputs.ss_start_age, target_age: baseInputs.target_age, portfolio_shock: 20 } },
            { label: 'Early Retire',   icon: '', d: { spending_delta: 100000, return_delta: 0, inflation_delta: 0,  div_yield_delta: 0, qualified_delta: 0, ss_start_age: 62, target_age: baseInputs.target_age, portfolio_shock: 0 } },
            { label: 'Inflation Shock',icon: '', d: { spending_delta: 0, return_delta: -1, inflation_delta: 2,  div_yield_delta: 1, qualified_delta: 0, ss_start_age: baseInputs.ss_start_age, target_age: baseInputs.target_age, portfolio_shock: 0 } },
            { label: 'Sequence Risk',  icon: '', d: { spending_delta: 0, return_delta: -2, inflation_delta: 0,  div_yield_delta: 0, qualified_delta: 0, ss_start_age: baseInputs.ss_start_age, target_age: baseInputs.target_age, portfolio_shock: 30 } },
            { label: 'High Yield',     icon: '', d: { spending_delta: 0, return_delta: 0,  inflation_delta: 0,  div_yield_delta: 4, qualified_delta: -20, ss_start_age: baseInputs.ss_start_age, target_age: baseInputs.target_age, portfolio_shock: 0 } },
          ] as SandboxPreset[]).map(p => (
            <button key={p.label} onClick={() => setDelta(p.d)} style={{
              fontFamily: 'var(--font-sans)', fontSize: 12, padding: '3px 10px',
              border: `1px solid ${A}`, borderRadius: 'var(--r-sm)',
              background: 'transparent', color: A, cursor: 'pointer',
            }}>{p.icon} {p.label}</button>
          ))}
          <button onClick={() => setDelta({ spending_delta: 0, return_delta: 0, inflation_delta: 0, div_yield_delta: 0, qualified_delta: 0, ss_start_age: baseInputs.ss_start_age, target_age: baseInputs.target_age, portfolio_shock: 0 })} style={{
            fontFamily: 'var(--font-sans)', fontSize: 12, padding: '3px 10px',
            border: `1px solid ${M}`, borderRadius: 'var(--r-sm)',
            background: 'transparent', color: M, cursor: 'pointer',
          }}>↺ Reset</button>
        </div>

        {/* Two-column layout for sliders */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 24px' }}>
          <div>
            <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>INCOME &amp; RETURNS</div>
            <InputRow
              label={`Spending delta → total: ${fmtMoney(baseInputs.income_target + delta.spending_delta)}/yr (base: ${fmtMoney(baseInputs.income_target)} income target)`}
              value={delta.spending_delta}
              onChange={v => setDelta(d => ({ ...d, spending_delta: v }))}
              min={-100000} max={300000} step={5000} format="dollar" />
            <InputRow
              label={`Return delta → effective: ${(baseInputs.expected_return * 100 + delta.return_delta).toFixed(1)}% (base: ${(baseInputs.expected_return * 100).toFixed(1)}%)`}
              value={delta.return_delta}
              onChange={v => setDelta(d => ({ ...d, return_delta: v }))}
              min={-6} max={6} step={0.5} />
            <InputRow
              label={`Inflation delta → effective: ${((baseInputs.inflation + delta.inflation_delta / 100) * 100).toFixed(1)}% (base: ${(baseInputs.inflation * 100).toFixed(1)}%)`}
              value={delta.inflation_delta}
              onChange={v => setDelta(d => ({ ...d, inflation_delta: v }))}
              min={-2} max={4} step={0.5} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>PORTFOLIO &amp; STRUCTURE</div>
            <InputRow
              label={`Div yield delta → effective: ${((baseInputs.dividend_yield + delta.div_yield_delta / 100) * 100).toFixed(1)}% (base: ${(baseInputs.dividend_yield * 100).toFixed(1)}%)`}
              value={delta.div_yield_delta}
              onChange={v => setDelta(d => ({ ...d, div_yield_delta: v }))}
              min={-5} max={10} step={0.5} />
            <InputRow
              label={`Qualified div % delta → effective: ${Math.round((baseInputs.qualified_pct + delta.qualified_delta / 100) * 100)}% (base: ${Math.round(baseInputs.qualified_pct * 100)}%)`}
              value={delta.qualified_delta}
              onChange={v => setDelta(d => ({ ...d, qualified_delta: v }))}
              min={-50} max={50} step={5} />
            <InputRow
              label={`Portfolio shock — one-time drop at start (0=none · 20=moderate · 40=severe)`}
              value={delta.portfolio_shock}
              onChange={v => setDelta(d => ({ ...d, portfolio_shock: v }))}
              min={0} max={80} step={5} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 24px', marginTop: 2 }}>
          <div>
            <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, marginTop: 8 }}>SOCIAL SECURITY &amp; HORIZON</div>
            <InputRow label="SS start age" value={delta.ss_start_age}
              onChange={v => setDelta(d => ({ ...d, ss_start_age: v }))}
              min={62} max={70} step={1} format="age" />
            <InputRow label="Plan horizon" value={delta.target_age}
              onChange={v => setDelta(d => ({ ...d, target_age: v }))}
              min={75} max={100} step={1} format="age" />
          </div>
        </div>

        {/* Strategy selector */}
        <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: M }}>Chart strategy:</span>
          {baseResult.strategies.map(s => (
            <button key={s.id} onClick={() => setSelectedStrategy(s.id)} style={{
              fontFamily: 'var(--font-sans)', fontSize: 12, padding: '2px 8px', cursor: 'pointer',
              border: `1px solid ${selectedStrategy === s.id ? STRATEGY_COLORS[s.id] : 'var(--border2)'}`,
              borderRadius: 'var(--r-sm)', background: 'transparent',
              color: selectedStrategy === s.id ? STRATEGY_COLORS[s.id] : M,
            }}>{s.label}</button>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: M, lineHeight: 1.5 }}>
          Scenario: <strong style={{ color: 'var(--text2)' }}>{fmtMoneyFull(scenarioInputs.annual_spending)}/yr</strong> ·{' '}
          <strong style={{ color: 'var(--text2)' }}>{pct(scenarioInputs.expected_return * 100)}</strong> return ·{' '}
          <strong style={{ color: 'var(--text2)' }}>{pct(scenarioInputs.inflation * 100)}</strong> inflation ·{' '}
          SS at {scenarioInputs.ss_start_age}
          {delta.portfolio_shock > 0 && <> · <span style={{ color: R }}>{delta.portfolio_shock}% shock</span></>}
          <span style={{ marginLeft: 8, color: M, opacity: 0.6 }}>
            Baseline = income target ({fmtMoney(baseInputs.income_target)}) · same engine as all plan sections
          </span>
        </div>
        {delta.portfolio_shock > 40 && delta.return_delta < -3 && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--yellow)' }}>
             Extreme scenario: {delta.portfolio_shock}% shock + {(baseInputs.expected_return * 100 + delta.return_delta).toFixed(1)}% return — outside realistic planning range.
          </div>
        )}
      </TerminalSection>
      </WsSection>

      {/* ── Outcome comparison cards ─────────────────────────────────────── */}
      <WsSection id="dd_sandbox_outcomes">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {scenarios.map(({ label, result }) => {
          const best = result.strategies.find(s => s.id === result.best_longevity)!
          const tax  = result.strategies.find(s => s.id === result.best_tax)!
          return (
            <div key={label} style={{
              background: 'var(--surface)', border: `1px solid ${label === 'Scenario' ? A : 'var(--border2)'}`,
              borderTop: `3px solid ${label === 'Scenario' ? A : BL}`, padding: '10px 12px',
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: label === 'Scenario' ? A : BL,
                textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>{label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  { label: 'Best Longevity Strategy', value: best.label, color: G },
                  { label: 'Best Tax Strategy', value: tax.label, color: 'var(--yellow)' },
                  { label: 'Ending Total — Nominal', value: fmt(best.ending_total), color: G },
                  { label: 'Lifetime Taxes (Min)', value: fmt(tax.total_taxes), color: R },
                  { label: 'Depletes At (Best)', value: best.depleted_at_age ? `Age ${best.depleted_at_age}` : 'Never', color: best.depleted_at_age ? R : G },
                  { label: 'Roth Preserved (Best)', value: fmt(best.ending_roth), color: G },
                ].map(m => (
                  <div key={m.label} style={{ background: 'var(--bg)', padding: '5px 7px' }}>
                    <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{m.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      </WsSection>

      {/* ── Comparison chart ──────────────────────────────────────────────── */}
      <WsSection id="dd_sandbox_chart">
      <TerminalSection id="sandbox-chart" title={`Portfolio Total — Baseline vs Scenario (${baseSel.label})`} defaultOpen accent={A}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={compData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="age" tick={{ fontSize: 12, fill: M }}
              label={{ value: 'Age', position: 'insideBottomRight', fontSize: 12, fill: M, offset: -4 }} />
            <YAxis tick={{ fontSize: 12, fill: M }} tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}M` : `$${v}K`} />
            <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown, name: unknown) => [`$${Number(v).toLocaleString()}K`, String(name)]} />
            <Legend wrapperStyle={{ fontSize: 12, color: M }} />
            <ReferenceLine y={0} stroke={R} strokeDasharray="3 3" />
            <Line type="monotone" dataKey="Baseline" stroke={BL} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Scenario" stroke={A}  strokeWidth={2} dot={false} strokeDasharray="5 3" />
          </LineChart>
        </ResponsiveContainer>
      </TerminalSection>
      </WsSection>

    </div>
  )
}
