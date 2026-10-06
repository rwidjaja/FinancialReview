/**
 * OverviewTab — v4 (AtScale) layout. Spec: redesign/atscale/Tab Overview.dc.html
 *
 *   Hero (verdict + Cobalt "next decision" plane with this week's actions)
 *   → KPI strip (value · dividends · lasts to 100 · confidence)
 *   → main: Needs attention · Income · What changed today · Financial wellness
 *           · [adv] Retirement action engine
 *   → rail: Scorecard · Diagnostics · Holdings today · [adv] Market character
 *
 * Every value the v3 Overview rendered is still here; the computations below
 * are unchanged from v3, only the presentation moved.
 */

import { useState, useMemo } from 'react'
import { useWellnessData } from '../../hooks/useDashboardData'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { WsSection } from '../workspace/WorkspaceContext'
import { useWorkspace } from '../workspace/context'
import { computeRetirementDecision, computeBucketStatus } from '../../utils/retirementEngine'
import { buildUnifiedAlerts, type UnifiedAlert } from '../../utils/unifiedAlerts'
import { RetirementActionPanel } from './RetirementActionPanel'
import { WellnessSnapshot } from './WellnessSnapshot'
import { PlainOverviewSummary } from './PlainOverviewSummary'
import { IncomeSection } from './IncomeSection'
import { MarketCharacterRail } from './MarketCharacter'
import { fmtMoneyFull, fmtFull, fmtK } from '../../utils/formatters'
import { WITHDRAWAL_AB_THRESHOLD, WITHDRAWAL_BC_THRESHOLD, VOL_BUDGET_ALERT, VOL_BUDGET_WARN, VOL_BUDGET_WATCH } from '../../utils/constants'
import type { DashboardData } from '../../types/dashboard'
import { tabLabel, type TabId } from '../layout/AppHeader'
import {
  PageHero, LeadMuted, HeroMeta, DecisionPlane, KpiStrip, Section, MainRail, RuledList, AttentionRow,
  StatusChip, Label, mono, muted, gain, moneyUnit, signedMoney, signedPct, fmtShortDate, type Status,
} from '../ui/primitives'

interface Props {
  data: DashboardData
  onNavigate?: (tab: TabId) => void
}

// ── Status helpers (unchanged thresholds) ─────────────────────────────────────

// Mirrors the canonical severity mapping in retirementEngine.ts's cross-tab
// "Vol budget" driver so this row can't disagree with Needs attention
// (unifiedAlerts.ts) or the Scorecard for the same field.
function riskBudgetStatus(rb: number | null | undefined): Status {
  if (rb == null) return 'info'
  if (rb > VOL_BUDGET_ALERT) return 'alert'
  if (rb > VOL_BUDGET_WARN) return 'warn'
  if (rb > VOL_BUDGET_WATCH) return 'watch'
  return 'ok'
}
const betaStatus = (b: number | null | undefined): Status => b == null ? 'info' : b > 1.4 ? 'warn' : b > 1.1 ? 'watch' : 'ok'
const confidenceStatus = (c: number | null | undefined): Status => c == null ? 'info' : c >= 75 ? 'ok' : c >= 50 ? 'watch' : 'warn'
const fragilityStatus = (f: number | null | undefined): Status => f == null ? 'info' : f >= 70 ? 'alert' : f >= 50 ? 'warn' : 'ok'

const ALERT_STATUS: Record<string, Status> = { red: 'alert', orange: 'warn', yellow: 'watch', green: 'ok' }
const SEVERITY_ORDER: Record<Status, number> = { alert: 0, warn: 1, watch: 2, info: 3, ok: 4 }

/** Which tab explains an alert, by its origin tag. Symbols → Portfolio. */
function alertTab(source: string): TabId | undefined {
  switch (source) {
    case 'VOL': case 'FRAG': case 'RISK': case 'REGIME': case 'WATCH': return 'risk'
    case 'TAX': case 'CONV': return 'tax'
    case 'SYSTEM': return undefined
    default: return /^[A-Z]{1,6}$/.test(source) ? 'portfolio' : undefined
  }
}

const SOURCE_TITLE: Record<string, string> = {
  RISK: 'Portfolio risk', WATCH: 'Watchlist', VOL: 'Volatility budget', FRAG: 'Fragility',
  TAX: 'Tax', CONV: 'Roth conversion', REGIME: 'Market regime', SYSTEM: 'System',
}

/** Split "Headline — detail" alert text into a title + message pair. */
function splitAlert(a: UnifiedAlert & { msg: string }): { title: string; msg: string } {
  const i = a.msg.indexOf(' — ')
  if (i > 0 && i < 72) return { title: a.msg.slice(0, i), msg: a.msg.slice(i + 3) }
  const colon = a.msg.indexOf(': ')
  if (colon > 0 && colon < 40) return { title: a.msg.slice(0, colon), msg: a.msg.slice(colon + 2) }
  return { title: SOURCE_TITLE[a.source] ?? a.source, msg: a.msg }
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function OverviewTab({ data, onNavigate }: Props) {
  const [mode] = useGlobalViewMode()
  const [showAllDiag, setShowAllDiag] = useState(false)
  const [showPlainSummary, setShowPlainSummary] = useState(false)
  const decision = useMemo(() => computeRetirementDecision(data), [data])
  const { data: w } = useWellnessData()

  const s = data.summary
  const pi = data.portfolio_intel
  const tx = data.tax_data

  // ── Health metrics ──
  const beta      = pi?.weighted_beta
  const confScore = pi?.system_confidence_score
  const fragScore = pi?.fragility_score
  const rb        = pi?.vol_budget_used
  const regime    = pi?.market_regime

  // ── Income + spending — two canonical denominators ──
  // fwd12m          = portfolio_fwd_12m (forward-looking dividends)
  // lifestyleSpend  = true_annual_spending (tracked transactions) → bucket, State C, runway
  // totalSpend      = estimated_spending from Settings (all-in) → WR, Monte Carlo, coverage
  const ia = data.income_analytics
  const si = data.spending_intelligence
  const fwd12m = ia?.portfolio_fwd_12m ?? s?.total_income ?? 0
  const lifestyleSpend = si?.true_annual_spending ?? 0
  const totalSpend = tx?.estimated_spending || lifestyleSpend || si?.hardcoded_spending || 0
  const swvxxValue = computeBucketStatus(data).swvxxValue

  // ── Withdrawal state — prefer server ANY_TWO logic; fall back to gain thresholds ──
  const serverState = tx?.withdrawal_current_state
  const stateIdx = serverState === 'C' ? 2 : serverState === 'B' ? 1 : serverState === 'A' ? 0
    : s.total_pnl < (tx?.withdrawal_state_ab_threshold ?? WITHDRAWAL_AB_THRESHOLD) ? 0
    : s.total_pnl < (tx?.withdrawal_state_bc_threshold ?? WITHDRAWAL_BC_THRESHOLD) ? 1 : 2
  const stateLetter = (['A', 'B', 'C'] as const)[stateIdx]
  const stateName = ['income', 'hybrid', 'capital'][stateIdx]

  // Per-symbol weights across denominators — used to enrich server-side
  // concentration messages that mix sleeve vs total-portfolio bases.
  const totalWeights = useMemo(() => {
    const byPos: Record<string, number> = {}
    let portfolioTotal = 0
    for (const acct of data.accounts) {
      for (const pos of acct.positions) {
        // Exclude the cash/money-market bucket — a deliberately-grown spending
        // reserve, not a concentration/beta risk.
        if (pos.is_money_market || pos.fund_type === 'MONEY_MARKET' || pos.symbol === 'CASH') continue
        byPos[pos.symbol] = (byPos[pos.symbol] ?? 0) + pos.value
        portfolioTotal += pos.value
      }
    }
    const out: Record<string, number> = {}
    if (portfolioTotal > 0) for (const [sym, v] of Object.entries(byPos)) out[sym] = (v / portfolioTotal) * 100
    return out
  }, [data.accounts])
  const sleeveWeights = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of [...(pi?.taxable_target_vs_actual ?? []), ...(pi?.roth_target_vs_actual ?? [])])
      if (r.in_acct) out[r.symbol] = Math.max(out[r.symbol] ?? 0, r.actual_pct)
    return out
  }, [pi])

  // Top holding by total-portfolio weight — the concentration driver label
  // used by the risk / fragility rows so both flags trace to one root cause.
  const topConcentrationSym = Object.entries(totalWeights).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null

  // "Concentration: SYM X% of portfolio (...)" → "... · Y% of equities"
  const enrichConcentrationMsg = (msg: string): string => {
    const m = msg.match(/Concentration:\s*([A-Z]{1,6})\s/)
    if (!m) return msg
    const sleevePct = sleeveWeights[m[1]]
    if (sleevePct == null) return msg
    return msg.replace(/of portfolio/, `of portfolio · ${sleevePct.toFixed(1)}% of equities`)
  }
  // "SYM 52.2% actual vs 10% target …" → "SYM 43.6% of total (52.2% of equities) vs 10% target …"
  const enrichConcentrationAction = (text: string): string => {
    const m = text.match(/^([A-Z]{1,6})\s+([\d.]+)%\s+actual\s+vs/)
    if (!m) return text
    const totalPct = totalWeights[m[1]]
    if (totalPct == null) return text
    return text.replace(/^([A-Z]{1,6})\s+[\d.]+%\s+actual\s+vs/, `${m[1]} ${totalPct.toFixed(1)}% of total (${m[2]}% of equities) vs`)
  }
  // Vol-budget-exceeded alerts have no paired action (it falls as concentration
  // lots mature), so soften the raw "exceeded" framing.
  const enrichVolBudgetMsg = (msg: string): string => {
    const lower = msg.toLowerCase()
    if ((lower.includes('volatility budget') || lower.includes('vol budget')) && lower.includes('exceed'))
      return msg.replace(/—.*$/, '') + '— no immediate action needed; reduces as concentration lots mature'
    return msg
  }

  // Same unified, deduped list as every other alert surface.
  const unifiedAll = buildUnifiedAlerts(data).map(a => ({ ...a, msg: enrichVolBudgetMsg(enrichConcentrationMsg(a.msg)) }))
  const topAlerts = unifiedAll.slice(0, 6)

  const actions = (data.decision_strip ?? []).map(a =>
    a.action === 'CONCENTRATION' && a.text ? { ...a, text: enrichConcentrationAction(a.text) } : a)

  // ── Verdict ──
  const tlc = decision.tax_locked_concentration
  const successAt100 = (w?.success_prob_100 ?? 0) * 100
  const incomeCovPct = totalSpend > 0 && fwd12m > 0 ? (fwd12m / totalSpend) * 100 : null
  // Bands mirror the Readiness column's "Lasts to 100" (90/80).
  const isComfortable = successAt100 >= 90 && (incomeCovPct ?? 0) >= 85
  const verdict = isComfortable ? { before: 'Your plan is ', em: 'comfortable', after: '.' }
    : successAt100 >= 80 ? { before: 'Your plan is ', em: 'on track', after: '.' }
    : { before: 'Your plan needs ', em: 'attention', after: '.' }
  const isIncomeFunded = totalSpend > 0 && fwd12m >= totalSpend
  const failingCount = decision.retirement_scorecard.items.filter(i => i.status !== 'ok').length
  const topPct = topConcentrationSym ? (pi?.weights?.[topConcentrationSym] ?? null) : null
  const topDelta = topConcentrationSym ? (pi?.taxable_target_vs_actual?.find(t => t.symbol === topConcentrationSym)?.delta_pct ?? null) : null

  const leadOne = isIncomeFunded && swvxxValue > 0
    ? `Dividends of ${fmtK(fwd12m)} and ${fmtK(swvxxValue)} in cash cover all spending. No forced sale is needed.`
    : incomeCovPct != null
      ? `Dividends cover ${incomeCovPct.toFixed(0)}% of planned spending${stateIdx === 2 ? '; in State C they refill the cash bucket instead.' : '.'}`
      : 'Income coverage is not available yet.'
  const leadTwo = [
    w ? `${successAt100.toFixed(1)}% chance the money lasts to 100.` : null,
    topConcentrationSym
      ? `Biggest risk: ${topConcentrationSym} concentration${topPct != null ? ` at ${topPct.toFixed(1)}% of the portfolio` : ''}${topDelta != null ? `, +${topDelta.toFixed(1)}% vs target` : ''}${tlc?.next_ltcg_date ? ` — the tax-efficient exit begins ${fmtShortDate(tlc.next_ltcg_date)}` : ''}.`
      : 'No critical risk.',
    isComfortable && failingCount > 0 ? 'The long-term plan is sound; near-term items need attention (see Scorecard).' : null,
  ].filter(Boolean).join(' ')

  // ── KPI strip ──
  const pv = moneyUnit(s.total_value)
  const dv = moneyUnit(fwd12m)
  const dayChange = s.day_change ?? 0
  const dayChangePct = s.day_change_pct ?? 0

  // ── Diagnostics (9 rows; first 4 = most severe) ──
  const showBoth = lifestyleSpend > 0 && totalSpend > 0 && Math.abs(totalSpend - lifestyleSpend) > 500
  const lifeCovPct = lifestyleSpend > 0 && fwd12m > 0 ? (fwd12m / lifestyleSpend) * 100 : null
  const ws = decision.thirty_day_outlook.conversion_window_status
  const { bucketMonths, bucketShort, requiredBucket } = decision._derived
  const ic = tx?.income_confidence ?? 'LOW'
  const icPct = tx?.income_received_pct ?? 0
  const icTrig = tx?.trigger_pct_threshold ?? 0
  const diagnostics: { label: string; value: string; status: Status; sub: string }[] = [
    {
      label: 'Risk utilisation', value: rb != null ? `${rb.toFixed(1)}%` : '—', status: riskBudgetStatus(rb),
      sub: rb == null ? 'Vol budget used' : rb > 130 ? `Critical — reduce risk${topConcentrationSym ? ` · driver ${topConcentrationSym}` : ''}` : rb > 100 ? 'Elevated' : 'Within target',
    },
    {
      label: 'Fragility', value: fragScore != null ? fragScore.toFixed(0) : '—', status: fragilityStatus(fragScore),
      sub: fragScore != null && fragScore >= 70 && topConcentrationSym
        ? `${pi?.fragility_level ?? 'High'} · ${topConcentrationSym} concentration`
        : pi?.fragility_level ?? 'Beta × correlation × concentration',
    },
    {
      label: 'Conversion window', value: ws,
      status: ws === 'OPEN' || ws === 'COMPLETE' ? 'ok' : ws === 'WAIT' ? 'warn' : 'alert',
      sub: decision.thirty_day_outlook.conversion_window_note,
    },
    {
      label: 'Cash bucket', value: bucketMonths >= 23 ? `${(bucketMonths / 12).toFixed(1)} yr` : `${bucketMonths.toFixed(1)} mo`,
      status: bucketShort ? 'alert' : bucketMonths < 9 ? 'warn' : 'ok',
      sub: bucketShort ? `Short ${fmtFull(requiredBucket - swvxxValue)} · refill priority` : `SWVXX ${fmtFull(swvxxValue)} · taxable only`,
    },
    { label: 'Beta', value: beta != null ? beta.toFixed(2) : '—', status: betaStatus(beta), sub: 'vs SPY' },
    { label: 'Confidence', value: confScore != null ? confScore.toFixed(0) : '—', status: confidenceStatus(confScore), sub: pi?.system_confidence_label ?? 'Out of 100' },
    {
      label: 'Dividend confidence', value: ic.charAt(0) + ic.slice(1).toLowerCase(),
      status: ic === 'HIGH' ? 'ok' : ic === 'MEDIUM' ? 'watch' : 'warn',
      sub: ic === 'HIGH' ? `${icPct.toFixed(1)}% ≥ ${icTrig.toFixed(1)}% threshold` : `${icPct.toFixed(1)}% of ${icTrig.toFixed(1)}% trigger · dividend pacing`,
    },
    { label: 'Regime', value: regime ?? '—', status: 'info', sub: `VIX ${data.vix_current?.toFixed(1) ?? '—'}${pi?.vol_regime ? ` · ${pi.vol_regime}` : ''}` },
    {
      label: 'Income coverage', value: incomeCovPct != null ? `${incomeCovPct.toFixed(1)}%` : '—',
      status: incomeCovPct == null ? 'info' : incomeCovPct >= 100 ? 'ok' : incomeCovPct >= 75 ? 'warn' : 'alert',
      sub: [
        totalSpend > 0 ? `vs ${fmtFull(totalSpend)}/yr plan spend${incomeCovPct != null && incomeCovPct < 100 ? ` · gap ${fmtFull(totalSpend - fwd12m)}` : ''}` : null,
        showBoth && lifeCovPct != null ? `${lifeCovPct.toFixed(1)}% vs ${fmtFull(lifestyleSpend)}/yr tracked spend` : null,
      ].filter(Boolean).join(' · ') || 'Fwd 12m ÷ plan spending',
    },
  ]
  const diagSorted = [...diagnostics].sort((a, b) => SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status])
  // Advanced workspace shows one section at a time, so all 9 diagnostics fit.
  const { enabled: inWorkspace } = useWorkspace()
  const diagShown = showAllDiag || inWorkspace ? diagSorted : diagSorted.slice(0, 4)
  const diagAlerts = diagnostics.filter(d => d.status === 'alert').length
  const diagWarn = diagnostics.filter(d => d.status === 'warn').length

  const sc = decision.retirement_scorecard
  const SC_WORD: Record<string, string> = { ok: 'Pass', warn: 'Watch', alert: 'Alert' }

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        bleed asideTitle="Next decision"
        eyebrow={`Overview · State ${stateLetter} — ${stateName}`}
        eyebrowRight={<button className="fd-link" onClick={() => setShowPlainSummary(true)} style={{ ...mono, ...muted, background: 'none', border: 'none' }}>In plain English →</button>}
        {...verdict}
        lead={<><span>{leadOne}</span><LeadMuted>{leadTwo}</LeadMuted></>}
        aside={
          <DecisionPlane label="Next decision" pad="56px 48px">
            {tlc?.days_to_first_ltcg != null && tlc.days_to_first_ltcg > 0 ? (<>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 120, lineHeight: 0.8, letterSpacing: '-0.02em' }}>
                {tlc.days_to_first_ltcg}<em style={{ fontSize: 56 }}> days</em>
              </span>
              <span style={{ fontSize: 18, lineHeight: 1.3 }}>
                {tlc.symbol} lots reach long-term rates on {fmtShortDate(tlc.next_ltcg_date)}.
                {tlc.value_per_day != null && ` Waiting saves ${fmtFull(tlc.value_per_day)} a day in tax.`} No action required before then.
              </span>
            </>) : (<>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 72, lineHeight: 0.9, letterSpacing: '-0.02em' }}>No action <em>today</em>.</span>
              <span style={{ fontSize: 18, lineHeight: 1.3 }}>Plan on track. Next check at the dividend cycle.</span>
            </>)}
            {actions.length > 0 && (
              <div style={{ borderTop: '1px solid var(--fd-hairline)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 'auto' }}>
                <span style={mono}>This week</span>
                {actions.map((a, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, fontSize: 14, lineHeight: 1.35 }}>
                    <span style={{ ...mono, paddingTop: 2 }}>{a.action.replace(/_/g, ' ')}</span>
                    <span>{a.text}</span>
                  </div>
                ))}
              </div>
            )}
          </DecisionPlane>
        }
      >
        <HeroMeta items={[
          { k: 'Regime', v: regime ?? '—' },
          { k: 'VIX', v: data.vix_current?.toFixed(1) ?? '—' },
          { k: 'Confidence', v: confScore != null ? `${confScore.toFixed(0)} ${pi?.system_confidence_label ?? ''}`.trim() : '—' },
          ...(beta != null ? [{ k: 'Beta', v: beta.toFixed(2) }] : []),
          ...(ia?.yield_pct != null ? [{ k: 'Yield', v: `${ia.yield_pct.toFixed(2)}%` }] : []),
          ...(s.total_value > 0 ? [{ k: 'Cash', v: `${((swvxxValue / s.total_value) * 100).toFixed(1)}%` }] : []),
        ]} />
      </PageHero>

      {showPlainSummary && <PlainOverviewSummary data={data} decision={decision} onClose={() => setShowPlainSummary(false)} />}

      <KpiStrip bleed items={[
        { label: 'Portfolio value', value: pv.value, unit: pv.unit, subColor: gain(dayChange),
          sub: `${signedMoney(dayChange, fmtFull)} (${signedPct(dayChangePct)}) today · ${signedMoney(s.total_pnl, fmtFull)} (${signedPct(s.total_pnl_pct, 1)}) all-time` },
        { label: 'Dividends · fwd 12m', value: dv.value, unit: dv.unit, subColor: 'var(--fd-ink)',
          sub: incomeCovPct != null ? `Covers ${incomeCovPct.toFixed(0)}% of plan spending` : 'Plan spending not set' },
        { label: 'Lasts to age 100', value: w ? successAt100.toFixed(1) : '—', unit: w ? '%' : undefined,
          sub: w ? `${(w.success_prob_95 * 100).toFixed(1)}% to age 95` : 'Monte Carlo loading…' },
        { label: 'Plan confidence', value: confScore != null ? confScore.toFixed(0) : '—', unit: confScore != null ? '/100' : undefined,
          sub: [pi?.system_confidence_label, pi?.confidence_delta != null ? `${pi.confidence_delta >= 0 ? '+' : '−'}${Math.abs(pi.confidence_delta).toFixed(1)} pts` : null, pi?.confidence_trend_label].filter(Boolean).join(' · ') },
      ]} />

      <div style={{ paddingTop: 56 }}>
        <MainRail
          main={<>
            {topAlerts.length > 0 && (
              <WsSection id="attention" value={`${unifiedAll.length} alerts`}
                status={unifiedAll.some(a => a.level === 'red') ? 'alert' : unifiedAll.some(a => a.level === 'orange') ? 'warn' : 'watch'}>
              <Section title="Needs attention" meta={`${unifiedAll.length} alerts${unifiedAll.length > topAlerts.length ? ` · top ${topAlerts.length}` : ''}`}>
                <RuledList>
                  {topAlerts.map((a, i) => {
                    const t = alertTab(a.source)
                    const { title, msg } = splitAlert(a)
                    return (
                      <AttentionRow key={i} status={ALERT_STATUS[a.level] ?? 'info'} title={title} msg={msg}
                        tab={t ? tabLabel(t) : undefined} onClick={t && onNavigate ? () => onNavigate(t) : undefined} />
                    )
                  })}
                </RuledList>
              </Section>
              </WsSection>
            )}

            <WsSection id="income" value={fwd12m > 0 ? `${dv.value}${dv.unit ?? ''}` : undefined}
              status={incomeCovPct == null ? 'info' : incomeCovPct >= 100 ? 'ok' : incomeCovPct >= 75 ? 'warn' : 'alert'}>
              <IncomeSection data={data} stateIdx={stateIdx} />
            </WsSection>

            <WsSection id="changed" value={signedMoney(dayChange, fmtK)} status={dayChange >= 0 ? 'ok' : 'watch'}>
              <WhatChangedToday data={data} />
            </WsSection>

            <WsSection id="wellness" value={w ? `${successAt100.toFixed(1)}%` : undefined}
              status={!w ? 'info' : successAt100 >= 90 ? 'ok' : successAt100 >= 80 ? 'watch' : 'alert'}>
              <WellnessSnapshot data={data} />
            </WsSection>

            {mode === 'advanced' && <RetirementActionPanel decision={decision} data={data} onNavigate={onNavigate} />}
          </>}
          rail={<>
            <WsSection id="scorecard" value={`${sc.items.filter(i => i.status === 'ok').length} / ${sc.items.length}`}
              status={sc.items.some(i => i.status === 'alert') ? 'alert' : sc.items.some(i => i.status !== 'ok') ? 'warn' : 'ok'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Scorecard</h3>
                <span style={mono}>{sc.items.filter(i => i.status === 'ok').length} / {sc.items.length} pass</span>
              </div>
              <RuledList>
                {sc.items.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 12, alignItems: 'start', padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
                    <span style={{ marginTop: 2, display: 'flex' }}><StatusChip status={item.status} size={14} /></span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</span>
                        <Label>{SC_WORD[item.status]}</Label>
                      </div>
                      <span style={{ fontSize: 13, ...muted }}>{item.note}</span>
                    </div>
                  </div>
                ))}
              </RuledList>
            </div>
            </WsSection>

            <WsSection id="diagnostics" value={diagAlerts ? `${diagAlerts} alert` : diagWarn ? `${diagWarn} warn` : 'All ok'}
              status={diagAlerts ? 'alert' : diagWarn ? 'warn' : 'ok'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button onClick={() => setShowAllDiag(v => !v)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
                <span style={{ fontSize: 18, fontWeight: 500 }}>Diagnostics</span>
                {!inWorkspace && <span style={mono}>{showAllDiag ? `Show 4` : `All ${diagnostics.length}`}</span>}
              </button>
              <RuledList>
                {diagShown.map(t => (
                  <div key={t.label} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
                    <span style={{ fontSize: 14 }}>{t.label}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 500 }}>
                      <StatusChip status={t.status} size={10} />{t.value}
                    </span>
                    <span style={{ gridColumn: '1 / span 2', fontSize: 13, ...muted }}>{t.sub}</span>
                  </div>
                ))}
              </RuledList>
            </div>
            </WsSection>

            <WsSection id="holdings" status="info">
              <HoldingsToday data={data} />
            </WsSection>

            {mode === 'advanced' && (
              <WsSection id="market">
                <MarketCharacterRail data={data} />
              </WsSection>
            )}
          </>}
        />
      </div>
    </div>
  )

}

// ── What changed today ─────────────────────────────────────────────────────────

function WhatChangedToday({ data }: { data: DashboardData }) {
  const dayChange = data.summary?.day_change
  const dayChangePct = data.summary?.day_change_pct

  // Per-symbol day changes aggregated across accounts
  const bySymbol: Record<string, { symbol: string; change: number; changePct: number }> = {}
  for (const acct of data.accounts)
    for (const pos of acct.positions) {
      if (pos.is_money_market || pos.day_change == null) continue
      const snap = data.snapshots?.[pos.symbol]
      // snapshots.price_change_pct is a 0–1 fraction
      const pricePct = snap?.price_change_pct != null ? snap.price_change_pct * 100 : (pos.value > 0 ? (pos.day_change / pos.value) * 100 : 0)
      if (bySymbol[pos.symbol]) bySymbol[pos.symbol].change += pos.day_change
      else bySymbol[pos.symbol] = { symbol: pos.symbol, change: pos.day_change, changePct: pricePct }
    }
  const symChanges = Object.values(bySymbol).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
  const topMovers = symChanges.filter(m => Math.abs(m.changePct) >= 0.3).slice(0, 6)
  const topSyms = new Set(topMovers.map(m => m.symbol))
  const flat = symChanges.filter(m => Math.abs(m.changePct) < 0.3 && !topSyms.has(m.symbol))

  if (dayChange == null && topMovers.length === 0) return null

  const acctRows = data.accounts
    .map(acct => ({
      label: acct.label,
      change: acct.positions.filter(p => !p.is_money_market && p.day_change != null).reduce((t, p) => t + (p.day_change ?? 0), 0),
      value: acct.value,
    }))
    .filter(r => r.change !== 0)

  return (
    <Section title="What changed today" meta={dayChange != null
      ? <span style={{ fontSize: 20, fontWeight: 500, color: gain(dayChange) }}>{signedMoney(dayChange, fmtFull)}{dayChangePct != null ? ` · ${signedPct(dayChangePct)}` : ''}</span>
      : undefined}>
      {topMovers.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(topMovers.length, 3)}, minmax(0,1fr))`, gap: 1, background: 'var(--fd-hairline)', border: '1px solid var(--fd-hairline)' }}>
          {topMovers.map(m => (
            <div key={m.symbol} style={{ background: 'var(--fd-page)', padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', fontWeight: 500 }}>{m.symbol}</span>
              <span style={{ fontSize: 20, fontWeight: 500, color: gain(m.change) }}>{signedMoney(m.change, fmtFull)}</span>
              <span style={{ fontSize: 13, ...muted }}>{signedPct(m.changePct)}</span>
            </div>
          ))}
          {Array.from({ length: Math.max(0, 3 - topMovers.length) }).map((_, i) => <div key={`pad${i}`} style={{ background: 'var(--fd-page)' }} />)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 13, ...muted, flexWrap: 'wrap' }}>
        <span>{acctRows.map(r => `${r.label} ${signedMoney(r.change, fmtFull)} (${signedPct(r.value > 0 ? (r.change / r.value) * 100 : 0)})`).join(' · ')}</span>
        {flat.length > 0 && <span>Unchanged (&lt;0.3%): {flat.map(f => f.symbol).join(', ')}</span>}
      </div>
    </Section>
  )
}

// ── Holdings today (replaces the scrolling TickerStrip) ───────────────────────

function HoldingsToday({ data }: { data: DashboardData }) {
  const { rows, total } = useMemo(() => {
    const by: Record<string, { symbol: string; dayChg: number; dayPct: number; price: number }> = {}
    for (const acct of data.accounts)
      for (const pos of acct.positions) {
        const snap = data.snapshots[pos.symbol]
        if (!snap || pos.is_money_market) continue
        const dayChg = pos.day_change != null ? pos.day_change : (snap.price_change ?? 0) * pos.shares
        if (!by[pos.symbol]) by[pos.symbol] = { symbol: pos.symbol, dayChg: 0, dayPct: (snap.price_change_pct ?? 0) * 100, price: snap.price ?? snap.nav ?? 0 }
        by[pos.symbol].dayChg += dayChg
      }
    const rows = Object.values(by).sort((a, b) => b.dayPct - a.dayPct)
    return { rows, total: rows.reduce((t, r) => t + r.dayChg, 0) }
  }, [data])
  if (rows.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Holdings today</h3>
        <span style={{ fontSize: 14, fontWeight: 500, color: gain(total) }}>{total >= 0 ? '+' : '−'}{fmtK(Math.abs(total))}</span>
      </div>
      <RuledList>
        {rows.map(m => (
          <div key={m.symbol} className="fd-row" title={`${m.symbol} ${signedMoney(m.dayChg, fmtMoneyFull)} today`}
            style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, paddingTop: 2 }}>{m.symbol}</span>
            <span style={muted}>${m.price.toFixed(2)}</span>
            <span style={{ color: gain(m.dayPct), fontWeight: 500 }}>{signedPct(m.dayPct)}</span>
          </div>
        ))}
      </RuledList>
    </div>
  )
}
