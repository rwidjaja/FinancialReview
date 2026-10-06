/**
 * Risk tab — v4 (AtScale). Spec: redesign/atscale/Tab Risk.dc.html
 *
 *   Hero (verdict + briefing card) → KPI strip (vol budget · fragility · beta ·
 *   seq risk · withdrawal need) → five 4-up tile groups (regime, attribution,
 *   structure, cash & execution, tax & income) + dollar risk → volatility
 *   attribution bars + system alerts → [adv] every v3 deep-dive panel.
 *
 * All values derive from DashboardData; the maths is the v3 SimpleView's.
 */
import { useMemo } from 'react'
import type { DashboardData } from '../../types/dashboard'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { TabBriefingPanel } from '../ui/TabBriefingPanel'
import { RISK_FREE_RATE, DEFAULT_ANNUAL_SPENDING } from '../../utils/constants'
import { buildUnifiedAlerts } from '../../utils/unifiedAlerts'
import { fmtMoneyFull } from '../../utils/formatters'
import { fmtK } from './shared'
import { ExecutionSignals } from './ExecutionSignals'
import { RegimeAlignment } from './RegimeAlignment'
import { RiskAdjustedReturns } from './RiskAdjustedReturns'
import { TaxDrift } from './TaxDrift'
import { CashflowVolatility } from './CashflowVolatility'
import { LiquidityPanel } from './LiquidityPanel'
import { RegimeTransition } from './RegimeTransition'
import { DrawdownPath } from './DrawdownPath'
import { StressCorrelation } from './StressCorrelation'
import { VolBudgetTrend } from './VolBudgetTrend'
import { BetaDecomposition } from './BetaDecomposition'
import { CorrelationMatrix } from './CorrelationMatrix'
import { WsSection } from '../workspace/WorkspaceContext'
import { useWorkspace } from '../workspace/context'
import { CrossSleeveMapPanel } from '../research/CrossSleevePanel'
import { PortfolioHeatmap } from './PortfolioHeatmap'
import {
  PageHero, KpiStrip, Section, Sections, TileGrid, GridTile, RuledList, Label, muted, type Status,
} from '../ui/primitives'

const ALERT_STATUS: Record<string, Status> = { red: 'alert', orange: 'warn', yellow: 'watch', green: 'ok' }

export function IntelligenceTab({ data }: { data: DashboardData }) {
  const [mode] = useGlobalViewMode()
  const { enabled: inWorkspace } = useWorkspace()
  // In the workspace each half is its own section; let them flow as direct children.
  const g2 = inWorkspace ? { display: 'contents' } as const : grid2
  const pi = data.portfolio_intel
  const si = data.spending_intelligence
  const ia = data.income_analytics
  const tx = data.tax_data
  const totalVal = data.summary.total_value

  const regime = pi.market_regime
  const frag = pi.fragility_score ?? 0
  const fragStatus: Status = frag >= 75 ? 'alert' : frag >= 60 ? 'warn' : frag >= 40 ? 'watch' : 'ok'
  const fragLabel = frag >= 75 ? 'Critical' : frag >= 60 ? 'Elevated' : frag >= 40 ? 'Moderate' : 'Robust'

  const volBudgetPct = pi.vol_budget_used ?? 0   // server sends percent (e.g. 174.7)
  const volStatus: Status = volBudgetPct > 150 ? 'alert' : volBudgetPct > 120 ? 'warn' : volBudgetPct > 100 ? 'watch' : 'ok'
  const volLabel = volBudgetPct > 150 ? 'Severely breached' : volBudgetPct > 120 ? 'Breached' : volBudgetPct > 100 ? 'At limit' : 'Within budget'

  // Alignment score (v3 rules)
  const techPct = pi.tech_growth_pct ?? 0
  const incomePct = pi.income_pct ?? 0
  const alignScore = Math.min(100, Math.max(0, (() => {
    let s = 50
    if (regime === 'EXPANSION') {
      if (pi.positioning === 'AGGRESSIVE') s += 25
      else if (pi.positioning === 'BALANCED') s += 10
      else s -= 10
      if (techPct > 30) s += 15
      if (incomePct > 50) s -= 10
      if (volBudgetPct > 150) s -= 20
      else if (volBudgetPct > 130) s -= 10
      if (frag > 60) s -= 5
    } else if (regime === 'RISK-OFF') {
      if (pi.positioning === 'CONSERVATIVE') s += 25
      else if (pi.positioning === 'BALANCED') s += 5
      else s -= 20
      if (incomePct > 40) s += 15
      if (techPct > 30) s -= 15
    } else if (pi.positioning === 'BALANCED') s += 15
    return s
  })()))
  const alignStatus: Status = alignScore >= 70 ? 'ok' : alignScore >= 45 ? 'warn' : 'alert'

  // Sharpe (1y)
  let portRet = 0
  for (const acct of data.accounts)
    for (const p of acct.positions) {
      if (p.is_money_market) continue
      const sn = data.snapshots[p.symbol]
      if (sn) portRet += (p.value / totalVal) * (sn.total_return_1y ?? 0)
    }
  const portVol = (pi.portfolio_vol_pct ?? 15) / 100
  const sharpe = portVol > 0 ? (portRet - RISK_FREE_RATE) / portVol : null

  // Liquidity — spendable = taxable MM only; IRA MM is a conversion vehicle
  let mmValue = 0, mmValueTotal = 0
  for (const acct of data.accounts) {
    const k = (acct.key ?? '').toLowerCase()
    const isTaxable = !k.includes('rollover') && !k.includes('roth') && !k.includes('ira')
    for (const p of acct.positions) if (p.is_money_market) { mmValueTotal += p.value; if (isTaxable) mmValue += p.value }
  }
  const annualSpend = si?.true_annual_spending != null ? si.true_annual_spending : (si?.hardcoded_spending ?? DEFAULT_ANNUAL_SPENDING) + (si?.taxes_annual ?? 0)
  const monthlySpend = annualSpend / 12
  const monthlyIncome = (ia?.portfolio_fwd_12m ?? 0) / 12
  const cashRunwayMos = monthlySpend > 0 ? mmValue / monthlySpend : null

  // Withdrawal state (canonical — mirrors Overview)
  const serverState = tx?.withdrawal_current_state
  const gains = data.summary.total_pnl
  const stateIdx = serverState === 'C' ? 2 : serverState === 'B' ? 1 : serverState === 'A' ? 0
    : gains < (tx?.withdrawal_state_ab_threshold ?? 0) ? 0 : gains < (tx?.withdrawal_state_bc_threshold ?? 0) ? 1 : 2
  const withdrawNeed = Math.max(0, monthlySpend - monthlyIncome)
  const isIncomeFunded = monthlySpend > 0 && monthlyIncome >= monthlySpend
  const withdrawLabel = isIncomeFunded ? 'Income-funded' : stateIdx === 2 ? 'Controlled sales' : stateIdx === 1 ? 'Partial sales' : withdrawNeed > 0 ? `${fmtK(withdrawNeed)}/mo` : 'Self-funded'
  const withdrawSub = isIncomeFunded ? 'Dividends cover spending; sales only refill the bucket'
    : stateIdx === 2 ? 'Sales fund spending; dividends refill the bucket'
    : stateIdx === 1 ? 'Dividends plus controlled sales' : withdrawNeed > 0 ? 'From the portfolio' : 'Income is sufficient'
  const withdrawStatus: Status = isIncomeFunded ? 'ok' : stateIdx === 2 ? 'alert' : stateIdx === 1 ? 'warn' : 'ok'
  // Seq risk: LOW when income-funded, but high fragility adds mark-to-market risk
  const seqLabel = isIncomeFunded && frag >= 70 ? 'Moderate' : isIncomeFunded ? 'Low' : stateIdx === 2 ? 'High' : stateIdx === 1 ? 'Moderate' : 'Low'
  const seqStatus: Status = seqLabel === 'High' ? 'alert' : seqLabel === 'Moderate' ? 'warn' : 'ok'

  // Dollar risk
  const beta = pi.weighted_beta ?? 1.0
  const dollarOneSD = portVol * totalVal
  const betaStatus: Status = beta > 1.3 ? 'alert' : beta > 1.0 ? 'warn' : 'ok'

  const bracketStatus = tx.final_bracket_status ?? tx.bracket_status
  const alerts = buildUnifiedAlerts(data)

  // Structure
  const weights = Object.entries(pi.weights ?? {}).sort((a, b) => b[1] - a[1])
  const top1 = weights[0]
  const top5 = weights.slice(0, 5).reduce((t, [, v]) => t + v, 0)
  const effHoldings = (() => { const h = weights.reduce((t, [, v]) => t + (v / 100) ** 2, 0); return h > 0 ? 1 / h : null })()

  // Volatility attribution (Euler simplification: w·σ / σp, as v3 VolatilityAttribution)
  const volRows = useMemo(() => {
    const items = Object.entries(pi.weights ?? {}).map(([sym, pct]) => {
      // Money-market funds have no meaningful volatility; v3 fell back to portVol for them.
      const isMM = data.fund_configs[sym]?.FUND_TYPE === ('MONEY_MARKET' as string) || data.snapshots[sym]?.fund_type === 'MONEY_MARKET'
        || data.accounts.some(a => a.positions.some(p => p.symbol === sym && p.is_money_market))
      const vol = isMM ? 0 : data.snapshots[sym]?.vol_30d_annual ?? portVol
      return { sym, weightPct: pct, volPct: vol * 100, contrib: portVol > 0 ? ((pct / 100) * vol) / portVol : 0 }
    })
    const total = items.reduce((t, r) => t + r.contrib, 0)
    return items.map(r => ({ ...r, share: total > 0 ? (r.contrib / total) * 100 : 0 })).sort((a, b) => b.share - a.share)
  }, [pi.weights, data.snapshots, data.fund_configs, data.accounts, portVol])
  const topVol = volRows[0]
  const volShown = volRows.slice(0, 6)
  const volOther = volRows.slice(6).reduce((t, r) => t + r.share, 0)

  const concentrated = (top1?.[1] ?? 0) > 15 || frag >= 70
  const verdict = concentrated ? { before: 'Risk is ', em: 'concentrated', after: ', not broad.' }
    : volBudgetPct > 120 ? { before: 'Risk is ', em: 'elevated', after: '.' }
    : { before: 'Risk is ', em: 'contained', after: '.' }
  const lead = [
    topVol ? `${topVol.sym} drives ${topVol.share.toFixed(0)}% of portfolio volatility.` : null,
    `Income durability is ${pi.income_durability_score}/100${cashRunwayMos != null ? ` and the spendable cash covers ${cashRunwayMos.toFixed(0)} months` : ''}.`,
    concentrated ? 'The fix is time, as concentrated lots reach long-term rates.' : null,
  ].filter(Boolean).join(' ')

  const fmtPctS = (v: number, d = 1) => `${v.toFixed(d)}%`

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        eyebrow={`Risk · Regime ${regime?.toLowerCase() ?? '—'} · VIX ${data.vix_current?.toFixed(1) ?? '—'}`}
        {...verdict}
        lead={<span style={muted}>{lead}</span>}
        aside={
          <div style={{ background: 'var(--fd-card)', padding: 32, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <TabBriefingPanel endpoint="/api/briefing/risk" title="Risk briefing" />
          </div>
        }
      />

      <KpiStrip size={40} items={[
        { label: 'Vol budget', value: `${volBudgetPct.toFixed(0)}%`, status: volStatus, sub: `${volLabel}${topVol ? ` · driver ${topVol.sym}` : ''}` },
        { label: 'Fragility', value: frag.toFixed(0), status: fragStatus, sub: `${fragLabel} · ${pi.positioning?.toLowerCase() ?? '—'} positioning` },
        { label: 'Beta', value: beta.toFixed(2), status: betaStatus, sub: `vs SPY · vol ${(portVol * 100).toFixed(1)}%` },
        { label: 'Seq risk', value: seqLabel, status: seqStatus, sub: isIncomeFunded ? 'Income-funded' : stateIdx > 0 ? 'Sales supplement dividends' : 'Dividends first' },
        { label: 'Withdrawal need', value: withdrawLabel, status: withdrawStatus, sub: `State ${['A', 'B', 'C'][stateIdx]}` },
      ]} />

      <Sections>
        <WsSection id="rk_regime" value={regime ?? undefined} status={regime === 'RISK-OFF' ? 'alert' : regime === 'EXPANSION' ? 'ok' : 'watch'}>
        <Group n="01" title="Market regime and positioning" hint="Where the market is and how you are aligned">
          <GridTile label="Regime" value={regime ?? '—'} status={regime === 'RISK-OFF' ? 'alert' : regime === 'EXPANSION' ? 'ok' : 'watch'} sub={`${pi.positioning ?? '—'} positioning`} />
          <GridTile label="VIX" value={data.vix_current?.toFixed(1) ?? '—'} status={(data.vix_current ?? 0) > 30 ? 'alert' : (data.vix_current ?? 0) > 20 ? 'warn' : 'ok'} sub={pi.vol_regime ?? 'Volatility regime'} />
          <GridTile label="Alignment" value={`${alignScore}/100`} status={alignStatus} sub={alignScore >= 70 ? 'Aligned with the regime' : alignScore >= 45 ? 'Partially aligned' : 'Mismatched to the regime'} />
          <GridTile label="Growth vs income" value={`${techPct.toFixed(0)}% / ${incomePct.toFixed(0)}%`} status="info" sub="Tech-growth share vs income share" />
        </Group>
        </WsSection>

        <WsSection id="rk_attribution" value={topVol?.sym} status={topVol && topVol.share > 40 ? 'alert' : 'watch'}>
        <Group n="02" title="Return and risk attribution" hint="What drives the portfolio">
          <GridTile label="High-vol driver" value={topVol?.sym ?? '—'} status={topVol && topVol.share > 40 ? 'alert' : 'watch'} sub={topVol ? `${topVol.weightPct.toFixed(1)}% weight · ${topVol.share.toFixed(0)}% of volatility` : undefined} />
          <GridTile label="Sharpe (1y)" value={sharpe != null ? sharpe.toFixed(2) : '—'} status={sharpe == null ? 'info' : sharpe >= 1 ? 'ok' : sharpe >= 0.5 ? 'warn' : 'alert'} sub={`${(portRet * 100).toFixed(1)}% return · risk-adjusted`} />
          <GridTile label="Realised vol" value={`${(portVol * 100).toFixed(1)}%`} status={portVol > 0.2 ? 'alert' : portVol > 0.15 ? 'warn' : 'ok'} sub="Annualised, 30-day" />
          <GridTile label="1σ swing" value={`±${fmtK(dollarOneSD)}`} status="info" sub="68% of years land inside this" />
        </Group>
        </WsSection>

        <WsSection id="rk_structure" value={top1 ? fmtPctS(top1[1]) : undefined} status={(top1?.[1] ?? 0) > 20 ? 'alert' : (top1?.[1] ?? 0) > 15 ? 'warn' : 'ok'}>
        <Group n="03" title="Portfolio structure" hint="Concentration and overlap">
          <GridTile label="Top holding" value={top1 ? fmtPctS(top1[1]) : '—'} status={(top1?.[1] ?? 0) > 20 ? 'alert' : (top1?.[1] ?? 0) > 15 ? 'warn' : 'ok'} sub={top1?.[0]} />
          <GridTile label="Top 5 weight" value={fmtPctS(top5)} status={top5 > 85 ? 'alert' : top5 > 60 ? 'warn' : 'ok'} sub="Of total portfolio" />
          <GridTile label="Effective holdings" value={effHoldings != null ? effHoldings.toFixed(1) : '—'} status={effHoldings != null && effHoldings < 8 ? 'warn' : 'ok'} sub="1 ÷ Σ weight² (diversification count)" />
          <GridTile label="Correlation risk" value={pi.corr_risk ? pi.corr_risk.charAt(0) + pi.corr_risk.slice(1).toLowerCase() : '—'} status={pi.corr_risk === 'HIGH' ? 'alert' : pi.corr_risk === 'MODERATE' ? 'warn' : 'ok'} sub="Cross-holding correlation" />
        </Group>
        </WsSection>

        <WsSection id="rk_cash" value={cashRunwayMos != null ? `${cashRunwayMos.toFixed(0)} mo` : undefined} status={cashRunwayMos == null ? 'info' : cashRunwayMos >= 18 ? 'ok' : cashRunwayMos >= 6 ? 'warn' : 'alert'}>
        <Group n="04" title="Cash and execution" hint="Liquidity to act">
          <GridTile label="Cash runway" value={cashRunwayMos != null ? `${cashRunwayMos.toFixed(0)} mo` : '—'} status={cashRunwayMos == null ? 'info' : cashRunwayMos >= 18 ? 'ok' : cashRunwayMos >= 6 ? 'warn' : 'alert'} sub={`${fmtK(mmValue)} spendable · ${fmtK(mmValueTotal)} total MM`} />
          <GridTile label="Withdrawal mode" value={withdrawLabel} status={withdrawStatus} sub={withdrawSub} />
          <GridTile label="Monthly need" value={withdrawNeed > 0 ? fmtK(withdrawNeed) : '$0'} status="info" sub={`${fmtK(monthlySpend)} spend − ${fmtK(monthlyIncome)} income`} />
          <GridTile label="Active alerts" value={alerts.length === 0 ? 'Clear' : String(alerts.length)} status={alerts.length === 0 ? 'ok' : alerts.some(a => a.level === 'red') ? 'alert' : 'warn'} sub="Unified across every tab" />
        </Group>
        </WsSection>

        <WsSection id="rk_tax_income" value={`${pi.income_durability_score} / 100`} status={pi.income_durability_score >= 70 ? 'ok' : pi.income_durability_score >= 40 ? 'warn' : 'alert'}>
        <Group n="05" title="Tax and income" hint="Durability under stress">
          <GridTile label="Income durability" value={`${pi.income_durability_score}`} status={pi.income_durability_score >= 70 ? 'ok' : pi.income_durability_score >= 40 ? 'warn' : 'alert'} sub={pi.inc_stability_lbl ?? 'Out of 100'} />
          <GridTile label="Tax status" value={bracketStatus ? bracketStatus.charAt(0) + bracketStatus.slice(1).toLowerCase() : '—'} status={bracketStatus === 'OK' ? 'ok' : bracketStatus === 'CRITICAL' ? 'alert' : 'warn'} sub={tx.final_bracket_msg ?? tx.bracket_status_msg ?? ''} />
          <GridTile label="Income per month" value={fmtK(monthlyIncome)} status="info" sub="Forward 12 months ÷ 12" />
          <GridTile label="Spending per month" value={fmtK(monthlySpend)} status="info" sub="Tracked annual spending ÷ 12" />
        </Group>
        </WsSection>

        <WsSection id="rk_dollar_risk" value={`±${fmtK(dollarOneSD)}`} status={betaStatus}>
        <Section title="Dollar risk" meta={`β ${beta.toFixed(2)} · vol ${(portVol * 100).toFixed(1)}% · ${fmtMoneyFull(totalVal)}`} rule>
          <TileGrid cols={4}>
            {[
              { k: '1σ swing', m: `±${(portVol * 100).toFixed(0)}%`, v: `±${fmtMoneyFull(dollarOneSD)}`, s: '68% of years' },
              { k: 'Correction', m: 'SPX −15%', v: `−${fmtMoneyFull(beta * 0.15 * totalVal)}`, s: 'Typical pullback' },
              { k: 'Bear market', m: 'SPX −30%', v: `−${fmtMoneyFull(beta * 0.3 * totalVal)}`, s: 'Historical average' },
              { k: 'Crash', m: 'SPX −45%', v: `−${fmtMoneyFull(beta * 0.45 * totalVal)}`, s: '2008 / 2020' },
            ].map(d => (
              <GridTile key={d.k} label={`${d.k} · ${d.m}`} value={<span style={{ color: d.k === '1σ swing' ? undefined : 'var(--fd-negative)' }}>{d.v}</span>} sub={d.s} />
            ))}
          </TileGrid>
        </Section>
        </WsSection>

        <div style={inWorkspace ? { display: 'contents' } : { display: 'grid', gridTemplateColumns: 'minmax(0,7fr) minmax(0,5fr)', gap: 56, alignItems: 'start' }}>
          <WsSection id="rk_vol_attribution" value={topVol ? `${topVol.sym} ${topVol.share.toFixed(0)}%` : undefined} status={topVol && topVol.share > 40 ? 'alert' : 'watch'}>
          <Section title="Volatility attribution" meta="Share of portfolio variance">
            <RuledList>
              {[...volShown, ...(volOther > 0 ? [{ sym: `Other ${volRows.length - 6}`, share: volOther, weightPct: NaN, volPct: NaN, contrib: 0 }] : [])].map((v, i) => (
                <div key={v.sym} style={{ display: 'grid', gridTemplateColumns: '84px minmax(0,1fr) 56px 150px', gap: 16, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }}>{v.sym}</span>
                  <div style={{ height: 10, background: 'var(--fd-hairline)' }}>
                    <div style={{ height: 10, width: `${Math.min(100, v.share)}%`, background: i === 0 && v.share > 40 ? 'var(--fd-negative)' : v.share > 10 ? 'var(--fd-lilac-ink)' : 'var(--fd-accent)' }} />
                  </div>
                  <span style={{ textAlign: 'right', fontWeight: 500 }}>{v.share.toFixed(0)}%</span>
                  <span style={{ fontSize: 13, ...muted, textAlign: 'right' }}>{Number.isFinite(v.weightPct) ? `${v.weightPct.toFixed(1)}% wt · σ ${v.volPct.toFixed(0)}%` : 'combined'}</span>
                </div>
              ))}
            </RuledList>
          </Section>
          </WsSection>
          <WsSection id="rk_alerts" value={alerts.length === 0 ? 'Clear' : `${alerts.length} active`} status={alerts.length === 0 ? 'ok' : alerts.some(a => a.level === 'red') ? 'alert' : 'warn'}>
          <Section title="System alerts" meta={`${alerts.length} active`}>
            <RuledList>
              {alerts.length === 0
                ? <div style={{ padding: '14px 0', fontSize: 14 }}>No active alerts across all systems.</div>
                : alerts.map((a, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '8px 1fr', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
                    <div style={{ background: `var(--fd-${ALERT_STATUS[a.level] === 'alert' ? 'alert' : ALERT_STATUS[a.level] === 'ok' ? 'ok' : 'watch'})` }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Label>{a.source}</Label>
                      <span style={{ fontSize: 14, lineHeight: 1.4 }}>{a.msg}</span>
                    </div>
                  </div>
                ))}
            </RuledList>
          </Section>
          </WsSection>
        </div>

        <WsSection id="rk_execution">
        <Section title="Execution signals" meta="Per holding · decision engine + target drift">
          <ExecutionSignals data={data} />
        </Section>
        </WsSection>

        {mode === 'advanced' && (<>
          <AdvGroup title="Market regime and positioning">
            <WsSection id="rk_regime_transition"><RegimeTransition data={data} /></WsSection>
            <div style={g2}><WsSection id="rk_regime_alignment"><RegimeAlignment data={data} /></WsSection><WsSection id="rk_risk_adjusted"><RiskAdjustedReturns data={data} /></WsSection></div>
          </AdvGroup>
          <AdvGroup title="Return and risk attribution">
            <div style={g2}><WsSection id="rk_beta"><BetaDecomposition data={data} /></WsSection><WsSection id="rk_drawdown_path"><DrawdownPath data={data} /></WsSection></div>
          </AdvGroup>
          <AdvGroup title="Portfolio structure">
            <div style={g2}><WsSection id="rk_stress_corr"><StressCorrelation data={data} /></WsSection><WsSection id="rk_corr_matrix"><CorrelationMatrix data={data} /></WsSection></div>
            <WsSection id="rk_cross_sleeve"><CrossSleeveMapPanel data={data} /></WsSection>
            <WsSection id="rk_heatmap"><PortfolioHeatmap data={data} /></WsSection>
          </AdvGroup>
          <AdvGroup title="Cash and execution">
            <div style={g2}><WsSection id="rk_liquidity"><LiquidityPanel data={data} /></WsSection><WsSection id="rk_vol_budget_trend"><VolBudgetTrend data={data} /></WsSection></div>
          </AdvGroup>
          <AdvGroup title="Tax and income">
            <div style={g2}><WsSection id="rk_tax_drift"><TaxDrift data={data} /></WsSection><WsSection id="rk_cashflow_vol"><CashflowVolatility data={data} /></WsSection></div>
          </AdvGroup>
        </>)}
      </Sections>
    </div>
  )
}

const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 40 } as const

function Group({ n, title, hint, children }: { n: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <Section index={n} title={title} meta={hint} rule>
      <TileGrid cols={4}>{children}</TileGrid>
    </Section>
  )
}

/**
 * Advanced deep-dive group. In the Advanced workspace each panel inside is its
 * own WsSection (the rail supplies the grouping), so the group heading drops
 * away; elsewhere it renders exactly as before.
 */
function AdvGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const { enabled } = useWorkspace()
  if (enabled) return <>{children}</>
  return (
    <Section title={title} meta="Advanced · full breakdown" gap={32}>
      {children}
    </Section>
  )
}
