/**
 * RoadmapTab — v4 (AtScale). Spec: redesign/atscale/Tab Roadmap.dc.html
 * "What phase am I in, and what changes at each transition." Reuses
 * computeRetirementDecision (tactical move today) and the Forecast base-case
 * projection (balance at each boundary) rather than re-deriving either.
 *
 *   Hero (phase verdict + Cobalt primary action from Overview)
 *   → 5-segment phase bar (current = accent, estimate = dashed outline)
 *   → main: one article per phase (insight + receipts linking to source tabs)
 *   → rail: not fully on track · survivor bracket · forecast at each boundary
 *           · [adv] this year's checklist
 */
import { useMemo, useRef } from 'react'
import type { DashboardData } from '../../types/dashboard'
import { tabLabel, type TabId } from '../layout/AppHeader'
import { computeRetirementDecision } from '../../utils/retirementEngine'
import { useWellnessData } from '../../hooks/useDashboardData'
import { fmtMoney, fmtMoneyFull, fmtPctAbs } from '../../utils/formatters'
import { buildPositions, computeProjection } from '../forecast/predictions.engine'
import {
  getPhases, getCurrentPhase, computeAge, daysUntilYearStart, formatPhaseYears,
  getPhaseMetrics, getPhaseInsight, projectedBalanceAtYear,
  type RoadmapPhase, type PhaseMetric,
} from '../../utils/roadmapEngine'
import type { ProjYear } from '../forecast/predictions.constants'
import type { RetirementDecision } from '../../utils/retirementEngine'
import { useDrawdownPlan } from '../../context/DrawdownPlanContext'
import { useYearActions } from '../drawdown/useYearActions'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { YearActionChecklist } from './YearActionChecklist'
import {
  PageHero, DecisionPlane, MainRail, RuledList, StatusChip, Label, mono, muted,
} from '../ui/primitives'

const HEADLINES: Record<RoadmapPhase['id'], { before?: string; em: string; after?: string }> = {
  final_prep:      { before: 'You are in ', em: 'final', after: ' prep.' },
  bridge:          { before: 'You are in the ', em: 'bridge', after: ' years.' },
  conversion_tail: { before: 'You are in the conversion ', em: 'tail', after: '.' },
  ss_active:       { before: 'Social Security is ', em: 'active', after: '.' },
  rmd:             { before: 'You are in the ', em: 'RMD', after: ' years.' },
}

function formatMetric(m: PhaseMetric): string {
  if (m.kind === 'money') return fmtMoney(m.value as number)
  if (m.kind === 'pct') return fmtPctAbs(m.value as number)
  return String(m.value)
}

/** Serif action headline, last word italic (one <em> rule). */
function ActionHeadline({ text }: { text: string }) {
  const t = text.trim().replace(/[.]$/, '')
  const i = t.lastIndexOf(' ')
  return (
    <span style={{ fontFamily: 'var(--font-display)', fontSize: 44, lineHeight: 0.9 }}>
      {i > 0 ? <>{t.slice(0, i + 1)}<em>{t.slice(i + 1)}</em>.</> : <em>{t}.</em>}
    </span>
  )
}

export function RoadmapTab({ data, onNavigate }: { data: DashboardData; onNavigate?: (tab: TabId) => void }) {
  const [mode] = useGlobalViewMode()
  const asOf = useMemo(() => new Date(), [])
  const tx = data.tax_data
  const { data: wellness } = useWellnessData()
  const articleRefs = useRef<Record<string, HTMLElement | null>>({})

  const phases = useMemo(() => getPhases(tx, asOf), [tx, asOf])
  const currentPhase = useMemo(() => getCurrentPhase(phases, asOf, tx.rollover_balance ?? 0), [phases, asOf, tx.rollover_balance])
  const currentIdx = phases.findIndex(p => p.id === currentPhase.id)
  const decision = useMemo(() => computeRetirementDecision(data), [data])

  // Forecast's base-case projection, computed once and read at each boundary
  // year — base scenario only, deliberately no bull/bear ranges.
  const rmdPhase = phases.find(p => p.id === 'rmd')
  const horizonYears = Math.max(1, (rmdPhase?.startYear ?? asOf.getFullYear() + 25) - asOf.getFullYear() + 5)
  const positions = useMemo(() => buildPositions(data), [data])
  const projYears = useMemo(() => computeProjection(data, 'base', horizonYears, positions), [data, horizonYears, positions])

  const age = tx.dob ? Math.floor(computeAge(tx.dob, asOf)) : null
  const retirementYear = tx.retirement_year
  const daysToRetirement = retirementYear != null ? daysUntilYearStart(retirementYear, asOf) : null
  const firstName = tx.name?.split(' ')[0] || null
  // net_worth/withdrawal_rate come from the shared wellness calc; total_value is the fallback while it loads.
  const totalSaved = wellness?.net_worth ?? data.summary.total_value
  const withdrawalRatePct = wellness?.withdrawal_rate != null ? wellness.withdrawal_rate * 100 : null

  const lead = [
    firstName && age != null ? `${firstName}, you're ${age} with about ${fmtMoney(totalSaved)} saved.` : age != null ? `You're ${age} with about ${fmtMoney(totalSaved)} saved.` : null,
    withdrawalRatePct != null && tx.estimated_spending != null ? `Planned spending of ${fmtMoney(tx.estimated_spending)}/yr is a ${fmtPctAbs(withdrawalRatePct)} withdrawal rate.` : null,
    daysToRetirement != null && retirementYear != null
      ? daysToRetirement > 0 ? `${daysToRetirement} days until retirement in ${retirementYear}.` : `Retired since ${retirementYear}.`
      : null,
  ].filter(Boolean).join(' ')

  const offTrack = decision.retirement_scorecard?.items?.filter(i => i.status !== 'ok') ?? []
  const sbp = tx.survivor_bracket_projection

  // Base-case balance at each phase boundary (end of each phase with a fixed end)
  const boundaries = phases
    .filter(p => p.endYear != null && p.endYear > asOf.getFullYear())
    .map(p => ({ label: `End of ${p.label} · ${p.isBoundaryDynamic ? '~' : ''}${p.endYear}`, row: projectedBalanceAtYear(projYears, p.endYear!) }))
    .filter(b => b.row != null)

  const phaseState = (i: number, p: RoadmapPhase): 'done' | 'now' | 'est' | 'next' =>
    i < currentIdx ? 'done' : i === currentIdx ? 'now' : (p.isBoundaryDynamic || p.startYearIsDynamic) ? 'est' : 'next'

  const yearActions = useYearActions(data)

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        eyebrow={`Roadmap · Phase ${currentPhase.index} of ${phases.length} — ${currentPhase.label.toLowerCase()}`}
        {...HEADLINES[currentPhase.id]}
        lead={<span style={muted}>{lead}</span>}
        aside={
          <DecisionPlane label="Primary action today · from Overview" pad="36px">
            <ActionHeadline text={decision.action_label} />
            <span style={{ fontSize: 15, lineHeight: 1.4 }}>{decision.action_detail}</span>
            <button className="fd-link" onClick={() => onNavigate?.('overview')} style={{ ...mono, background: 'none', border: 'none', padding: 0, alignSelf: 'flex-start', cursor: 'pointer' }}>Overview →</button>
          </DecisionPlane>
        }
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', ...mono, ...muted }}>
          <span>Filing <span style={{ color: 'var(--fd-ink)' }}>{tx.filing_status}</span></span>
          {tx.target_bracket_rate != null && <span>Target bracket <span style={{ color: 'var(--fd-ink)' }}>{tx.target_bracket_rate}%</span></span>}
          {tx.rmd_start_age != null && <span>RMD at <span style={{ color: 'var(--fd-ink)' }}>{tx.rmd_start_age}</span></span>}
        </div>
      </PageHero>

      {/* Phase bar */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 56 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${phases.length}, minmax(0,1fr))`, gap: 4 }}>
          {phases.map((p, i) => {
            const st = phaseState(i, p)
            return (
              <button key={p.id} onClick={() => articleRefs.current[p.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
                <div style={{
                  height: 14, width: '100%',
                  background: st === 'done' ? 'var(--fd-muted)' : st === 'now' ? 'var(--fd-accent)' : st === 'est' ? 'transparent' : 'var(--fd-hairline)',
                  outline: st === 'est' ? '2px dashed var(--fd-accent)' : 'none', outlineOffset: -2,
                }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 12 }}>
                  <Label>{String(p.index).padStart(2, '0')} · {formatPhaseYears(p)}</Label>
                  <span style={{ fontSize: 18, fontWeight: st === 'now' ? 500 : 400 }}>{p.label}</span>
                  <span style={{ fontSize: 13, ...muted }}>{p.summary}</span>
                </div>
              </button>
            )
          })}
        </div>
        <span style={{ fontSize: 13, ...muted }}>Outlined segments are estimates. Fixed boundaries come from Settings → Personal.</span>
      </section>

      <MainRail
        main={phases.map((p, i) => (
          <PhaseArticle key={p.id} phase={p} state={phaseState(i, p)} isCurrent={p.id === currentPhase.id}
            data={data} decision={decision} projYears={projYears} mode={mode} onNavigate={onNavigate}
            refEl={el => { articleRefs.current[p.id] = el }} />
        ))}
        rail={<>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{offTrack.length ? 'Not fully on track' : 'On track'}</h3>
            <RuledList>
              {offTrack.length === 0
                ? <div style={{ padding: '12px 0', fontSize: 14 }}>Nothing flagged — the scorecard is on track across the board.</div>
                : offTrack.map(item => (
                  <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
                    <span style={{ marginTop: 2, display: 'flex' }}><StatusChip status={item.status} size={14} /></span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</span>
                      <span style={{ fontSize: 13, ...muted }}>{item.note}</span>
                    </div>
                  </div>
                ))}
            </RuledList>
          </div>

          {sbp && sbp.extra_annual_tax_as_single > 0 && (
            <div style={{ background: 'var(--as-lilac)', color: 'var(--as-washed-black)', padding: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={mono}>Survivor bracket check · MFJ → single</span>
              <span style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.005em' }}>+{fmtMoneyFull(sbp.extra_annual_tax_as_single)}/yr</span>
              <span style={{ fontSize: 14, lineHeight: 1.4 }}>
                Extra tax a surviving spouse would owe filing single around {sbp.survivor_year_estimate}, on a projected {fmtMoney(sbp.projected_pretax_balance_at_survivor_year)} pre-tax balance
                {Math.round(sbp.single_bracket_at_this_income * 100) > Math.round(sbp.mfj_bracket_at_this_income * 100)
                  ? ` — the ${Math.round(sbp.single_bracket_at_this_income * 100)}% bracket instead of ${Math.round(sbp.mfj_bracket_at_this_income * 100)}%.`
                  : '. Single brackets are narrower at every rate.'}
              </span>
            </div>
          )}

          {boundaries.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Forecast at each boundary</h3>
              <RuledList>
                {boundaries.map(b => (
                  <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)', fontSize: 14 }}>
                    <span style={muted}>{b.label}</span><span style={{ fontWeight: 500 }}>{fmtMoneyFull(b.row!.portfolioValue)}</span>
                  </div>
                ))}
              </RuledList>
              <span style={{ fontSize: 13, ...muted }}>Base case only — one deterministic path, not a range or probability.</span>
            </div>
          )}

          {mode === 'advanced' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>This year's checklist</h3>
              <YearActionChecklist key={`${currentPhase.id}-${asOf.getFullYear()}`} phaseId={currentPhase.id} year={asOf.getFullYear()}
                actions={yearActions.map(a => ({ text: a.text, sub: a.sub }))} />
            </div>
          )}
        </>}
      />
    </div>
  )
}

const STATE_TAG: Record<'done' | 'now' | 'est' | 'next', string> = { done: 'Complete', now: 'You are here', est: 'Estimate', next: 'Upcoming' }

function PhaseArticle({ phase, state, isCurrent, data, decision, projYears, mode, onNavigate, refEl }: {
  phase: RoadmapPhase; state: 'done' | 'now' | 'est' | 'next'; isCurrent: boolean
  data: DashboardData; decision: RetirementDecision; projYears: ProjYear[]; mode: string
  onNavigate?: (tab: TabId) => void; refEl: (el: HTMLElement | null) => void
}) {
  const tx = data.tax_data
  const metrics = getPhaseMetrics(phase.id, tx, data.income_analytics, phase.endYear, projYears)
  const insight = getPhaseInsight(phase.id, tx, data.income_analytics, decision.primary_action, isCurrent)
  const shown = mode === 'advanced' ? metrics : metrics.slice(0, 3)
  // This year's dividend-vs-draw split — same lot-aware numbers as Drawdown's
  // Annual Decision Engine (shared DrawdownPlanContext). Current phase only.
  const { annualDecision: ad } = useDrawdownPlan()

  return (
    <article ref={refEl} style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: '2px solid var(--fd-rule)', paddingTop: 20, scrollMarginTop: 140 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ ...mono, color: 'var(--fd-accent)' }}>{String(phase.index).padStart(2, '0')}</span>
          <h2 style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>{phase.label}</h2>
          <span style={{ fontSize: 15, ...muted }}>{formatPhaseYears(phase)}</span>
        </div>
        {state === 'now'
          ? <span style={{ ...mono, height: 24, display: 'inline-flex', alignItems: 'center', padding: '0 10px', borderRadius: 8, background: 'var(--fd-accent)', color: 'var(--fd-page)', whiteSpace: 'nowrap' }}>{STATE_TAG[state]}</span>
          : <span style={{ ...mono, ...muted, whiteSpace: 'nowrap' }}>{STATE_TAG[state]}</span>}
      </div>

      <p style={{ fontSize: 16, lineHeight: 1.45, maxWidth: 760, margin: 0 }}>{insight}</p>

      {isCurrent && (
        <div style={{ background: 'var(--fd-card)', padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Label>This year's cash plan · dividends vs draw</Label>
          <span style={{ fontSize: 15, lineHeight: 1.45 }}>
            {ad.from_taxable <= 0
              ? `Dividends and other guaranteed income (${fmtMoney(ad.guaranteed_income)}) already cover this year's spending target — no draw from taxable is needed.`
              : <>Dividends give about <b>{fmtMoney(ad.guaranteed_income)}</b> toward this year's plan; the remaining <b>{fmtMoney(ad.from_taxable)}</b> comes from selling in the taxable account.{' '}
                {ad.no_lot_data
                  ? 'Lot data is unavailable, so the long-term share is unknown.'
                  : ad.ltcg_from_taxable > 0 && ad.stcg_from_taxable > 0
                    ? <>About <b>{fmtMoney(ad.ltcg_from_taxable)}</b> qualifies for long-term rates and <b>{fmtMoney(ad.stcg_from_taxable)}</b> is still short-term.</>
                    : ad.stcg_from_taxable > 0
                      ? <>None qualifies for long-term rates yet — all <b>{fmtMoney(ad.stcg_from_taxable)}</b> of gain is taxed as income until those lots mature (see Tax → Sell and rebalance).</>
                      : ad.ltcg_from_taxable > 0 ? 'All of it qualifies for long-term rates.' : 'Most of it is cash already in the account, so there is little or no tax.'}</>}
          </span>
        </div>
      )}

      {shown.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 1, background: 'var(--fd-hairline)', border: '1px solid var(--fd-hairline)' }}>
          {shown.map(m => (
            <button key={m.label} className="fd-row" onClick={() => onNavigate?.(m.tab)} title={m.explain}
              style={{ background: 'var(--fd-page)', padding: 16, display: 'flex', flexDirection: 'column', gap: 4, border: 'none', textAlign: 'left', cursor: onNavigate ? 'pointer' : 'default' }}>
              <span style={{ fontSize: 20, fontWeight: 500 }}>{formatMetric(m)}</span>
              <span style={{ fontSize: 13, ...muted }}>{m.label}</span>
              {mode === 'advanced' && <span style={{ fontSize: 13, lineHeight: 1.35 }}>{m.explain}</span>}
              <span style={{ ...mono, color: 'var(--fd-accent)', marginTop: 'auto' }}>{tabLabel(m.tab)} →</span>
            </button>
          ))}
          {Array.from({ length: (3 - (shown.length % 3)) % 3 }).map((_, i) => <div key={i} style={{ background: 'var(--fd-page)' }} />)}
        </div>
      )}

      {mode === 'advanced' && !isCurrent && phase.actions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Label style={{ paddingBottom: 8 }}>What to do in this phase</Label>
          {phase.actions.map((a, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, padding: '10px 0', borderTop: '1px solid var(--fd-hairline)', fontSize: 14 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>→</span><span>{a}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', ...mono, ...muted }}>
        <span>Primary tabs</span>
        {phase.primaryTabs.map(t => (
          <button key={t} className="fd-link" onClick={() => onNavigate?.(t)} style={{ ...mono, background: 'none', border: 'none', padding: 0, color: 'var(--fd-ink)' }}>{tabLabel(t)} →</button>
        ))}
      </div>
    </article>
  )
}
