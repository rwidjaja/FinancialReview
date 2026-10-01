/**
 * RiskDashboardPanel — Risk Dashboard
 * Lines ~2345–2500 of the original DrawdownTab.tsx
 */

import { useMemo } from 'react'
import type { DashboardData } from '../../types/dashboard'
import { runDrawdown, type DrawdownResult, type DrawdownInputs } from './drawdown.engine'
import { G, R, A, M } from './drawdown.shared'

export function RiskDashboardPanel({ result, inputs, data }: { result: DrawdownResult; inputs: DrawdownInputs; data: DashboardData }) {
  const fmt = (v: number) => {
    const av = Math.abs(v); const sign = v < 0 ? '-' : ''
    return av >= 1_000_000 ? `${sign}$${(av / 1_000_000).toFixed(2)}M` : av >= 1000 ? `${sign}$${Math.round(av / 1000)}K` : `${sign}$${Math.round(av)}`
  }

  const baseInputsSpend: DrawdownInputs = { ...inputs, annual_spending: inputs.income_target }
  const baseDyn = result.strategies.find(s => s.id === 'dynamic_bracket')!

  // Pre-compute 3 stress scenarios
  const seqResult  = useMemo(() => runDrawdown({
    ...baseInputsSpend,
    taxable_balance:  inputs.taxable_balance  * 0.70,
    rollover_balance: inputs.rollover_balance * 0.70,
    roth_balance:     inputs.roth_balance     * 0.70,
  }), [inputs])
  const taxResult  = useMemo(() => runDrawdown({
    ...baseInputsSpend,
    expected_return: Math.max(0.01, inputs.expected_return - 0.05),
  }), [inputs])
  const divResult  = useMemo(() => runDrawdown({
    ...baseInputsSpend,
    dividend_yield: 0.020,
  }), [inputs])

  const seqDyn = seqResult.strategies.find(s => s.id === 'dynamic_bracket')!
  const taxDyn = taxResult.strategies.find(s => s.id === 'dynamic_bracket')!
  const divDyn = divResult.strategies.find(s => s.id === 'dynamic_bracket')!

  // Concentration data
  const totalPortfolio = inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance
  const allPositions = (data.accounts ?? []).flatMap((a: any) => a.positions ?? [])
  const symbolMap = new Map<string, number>()
  for (const p of allPositions) {
    if (p.is_money_market || (p.value ?? 0) <= 0) continue
    const sym = p.symbol ?? '?'
    symbolMap.set(sym, (symbolMap.get(sym) ?? 0) + (p.value ?? 0))
  }
  const concPositions = Array.from(symbolMap.entries())
    .map(([symbol, value]) => ({ symbol, value, pct: totalPortfolio > 0 ? value / totalPortfolio * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)
  const topConc = concPositions[0]

  const concRisk = topConc && topConc.pct > 20 ? 'HIGH' : topConc && topConc.pct > 10 ? 'MODERATE' : 'LOW'
  const concColor = concRisk === 'HIGH' ? R : concRisk === 'MODERATE' ? A : G

  const seqImpact    = seqDyn.ending_total - baseDyn.ending_total
  const taxImpact    = taxDyn.ending_total - baseDyn.ending_total
  const divTaxImpact = divDyn.total_taxes  - baseDyn.total_taxes
  const seqDepleted  = seqDyn.depleted_at_age
  const baseDepleted = baseDyn.depleted_at_age

  const divYieldCur = (inputs.dividend_yield * 100).toFixed(1)

  const riskItems = [
    {
      key: 'concentration',
      title: 'Concentration Risk',
      rating: concRisk,
      color: concColor,
      icon: '',
      headline: topConc ? `${topConc.symbol} ${topConc.pct.toFixed(0)}% of portfolio` : 'No dominant position',
      detail: topConc && topConc.pct > 10
        ? `Single position ${topConc.symbol} = ${fmt(topConc.value)} (${topConc.pct.toFixed(1)}%). Guideline: ≤10% per position. A 50% drop in ${topConc.symbol} alone would reduce total portfolio by ~${(topConc.pct / 2).toFixed(0)}%.`
        : 'No single position exceeds 10% of portfolio — concentration risk within guidelines.',
      action: topConc && topConc.pct > 15
        ? `Trim ${topConc.symbol} toward 10–15% over 2–3 years using controlled LTCG harvesting. Harvest gains up to the 0% LTCG bracket first.`
        : 'Continue monitoring. Rebalance if any position drifts above 15%.',
    },
    {
      key: 'sequence',
      title: 'Sequence-of-Returns Risk',
      rating: seqDepleted != null && baseDepleted == null ? 'HIGH' : seqImpact < -500_000 ? 'MODERATE' : 'LOW',
      color: seqDepleted != null && baseDepleted == null ? R : seqImpact < -500_000 ? A : G,
      icon: '',
      headline: `-30% Year-1 shock → ${fmt(seqImpact)} vs base at age ${inputs.target_age}`,
      detail: seqDepleted != null && baseDepleted == null
        ? `A 30% crash in year 1 causes portfolio depletion at age ${seqDepleted} (base plan survives to ${inputs.target_age}). This is the most dangerous risk — early losses force selling depressed assets to fund withdrawals.`
        : `A 30% year-1 crash reduces end-of-plan assets by ${fmt(Math.abs(seqImpact))} vs baseline. Plan still survives${seqDepleted ? ` but depletes at ${seqDepleted}` : ' to target age'}.`,
      action: 'Maintain 3–5 year SWVXX cash reserve. In a downturn: draw from cash first, delay optional spending, pause Roth conversions if bracket shifts.',
    },
    {
      key: 'tax',
      title: 'Tax Rate Risk',
      rating: taxImpact < -400_000 ? 'MODERATE' : 'LOW',
      color: taxImpact < -400_000 ? A : G,
      icon: '',
      headline: `-5% return drag → ${fmt(taxImpact)} end-portfolio impact`,
      detail: `Modeling a persistent 5% lower return (e.g. from higher capital gains taxes or bracket creep) reduces the end portfolio by ${fmt(Math.abs(taxImpact))}. Dynamic Bracket already front-loads conversions to hedge against future rate increases — ${fmt(result.strategies.find(s => s.id === 'dynamic_bracket')?.total_taxes ?? 0)} total lifetime tax already locked in at current rates.`,
      action: 'Accelerate Roth conversions in years when your bracket is predictably low (pre-SS, pre-RMD window). Convert now rather than later.',
    },
    {
      key: 'dividend',
      title: 'Dividend Yield Risk',
      rating: divTaxImpact > 20_000 ? 'MODERATE' : 'LOW',
      color: divTaxImpact > 20_000 ? A : G,
      icon: '',
      headline: `Yield ${divYieldCur}% → 2.0% · ${fmt(Math.abs(divTaxImpact))} less lifetime tax`,
      detail: `If dividend yield compresses from ${divYieldCur}% to 2.0% (e.g. via position changes or market repricing), annual dividend income falls. This actually lowers dividend taxes by ${fmt(Math.abs(divTaxImpact))} — but reduces passive cash flow that offsets required withdrawals. Net spending need rises.`,
      action: 'Route all dividends to SWVXX to fund bucket. If yield compresses, compensate by slightly increasing taxable account withdrawals — still tax-advantaged via LTCG rates.',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderRadius: 0, border: `1px solid ${R}30`, overflow: 'hidden' }}>
        <div style={{ background: `${R}0c`, borderBottom: `1px solid ${R}25`, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: R }}>RISK DASHBOARD</span>
          <span style={{ fontSize: 12, color: M }}>Four key risk dimensions stress-tested against your plan</span>
        </div>
        <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {riskItems.map(r => (
            <div key={r.key} style={{ padding: '6px 8px', borderRadius: 0, background: `${r.color}0a`, border: `1px solid ${r.color}40`, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>{r.icon}</span>
              <div>
                <div style={{ fontSize: 12, color: M }}>{r.title}</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: r.color }}>{r.rating}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Risk cards */}
      {riskItems.map(r => (
        <div key={r.key} style={{ background: 'var(--surface)', borderRadius: 0, border: `1px solid ${r.color}30`, overflow: 'hidden' }}>
          <div style={{ background: `${r.color}0c`, borderBottom: `1px solid ${r.color}25`, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14 }}>{r.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: r.color }}>{r.title}</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 500, color: r.color,
              background: `${r.color}18`, border: `1px solid ${r.color}40`, borderRadius: 0, padding: '1px 6px' }}>
              {r.rating}
            </span>
          </div>
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: r.color }}>{r.headline}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>{r.detail}</div>
            <div style={{ padding: '6px 10px', borderRadius: 0, background: `${G}08`, border: `1px solid ${G}30` }}>
              <span style={{ fontSize: 12, color: G, fontWeight: 500 }}>ACTION: </span>
              <span style={{ fontSize: 12, color: M }}>{r.action}</span>
            </div>
            {r.key === 'concentration' && concPositions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Top 5 positions by weight</div>
                {concPositions.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: p.pct > 20 ? R : p.pct > 10 ? A : G, minWidth: 50 }}>{p.symbol}</span>
                    <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 0, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, p.pct)}%`, height: '100%', background: p.pct > 20 ? R : p.pct > 10 ? A : G, borderRadius: 0 }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: M, minWidth: 40, textAlign: 'right' }}>{p.pct.toFixed(1)}%</span>
                    <span style={{ fontSize: 12, color: M }}>{fmt(p.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
