/**
 * Annual Decision Panel — Dividend-First, IRMAA-Aware CFP Decision Engine
 *
 * Answers: "This year — given my $X in dividends — where do I withdraw from,
 * how much do I convert to Roth, and what is my exact tax and IRMAA impact?"
 *
 * The income target slider is the primary control. Everything reacts
 * deterministically: dividends fill first, then bracket space is measured,
 * then IRA / taxable / Roth fills the gap, then Roth conversion uses
 * whatever bracket headroom remains.
 */

import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts'
import { TerminalSection, Divider } from '../ui/Terminal'
import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { BracketMeter } from '../tax/BracketMeter'
import {
  computeAnnualDecision,
  buildAnnualDecisionInputs,
  type AnnualDecisionResult,
  type AnnualDecisionInputs,
} from './drawdown.engine'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import { DRAWDOWN_DEFAULTS } from '../../utils/taxConfig'
import { computeBucketStatus } from '../../utils/retirementEngine'

// ─── Colours (match codebase palette) ─────────────────────────────────────────
const G  = 'var(--green)'
const R  = 'var(--red)'
const A  = 'var(--amber)'
const M  = 'var(--text2)'
const Y  = 'var(--yellow)'
const BL = 'var(--blue)'

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(digits)}K`
  return `$${n.toFixed(digits)}`
}

function pct(n: number | null | undefined, d = 1): string {
  if (n == null) return '—'
  return `${n.toFixed(d)}%`
}

// Score badge (LOW/MED/HIGH, colored)
function ScoreBadge({ value, invert = false }: { value: 'LOW' | 'MEDIUM' | 'HIGH'; invert?: boolean }) {
  const c = invert
    ? value === 'LOW' ? R : value === 'MEDIUM' ? Y : G
    : value === 'HIGH' ? G : value === 'MEDIUM' ? Y : R
  return (
    <span style={{
      fontSize: 12, fontWeight: 500, padding: '2px 6px',
      border: `1px solid ${c}`, color: c, textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>{value}</span>
  )
}

// Bracket fill bar — shows which bracket each dollar of income lands in
function BracketFillBar({ result }: { result: AnnualDecisionResult }) {
  const slots = result.bracket_slots
  const totalWidth = slots.reduce((s, b) => s + b.ceiling, 0)
  const maxSlot = Math.max(...slots.map(b => b.ceiling))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {slots.map((slot, i) => {
        const filledPct = (slot.filled / (slot.ceiling - (slots[i-1]?.ceiling ?? 0) + (slot.filled + slot.available))) * 100
        const isTarget  = Math.abs(slot.rate - result.marginal_rate) < 0.001
        const grossFill = Math.min(result.magi, slot.ceiling)
        const grossBase = i > 0 ? slots[i - 1].ceiling : 0
        const inThisBracket = Math.max(0, Math.min(grossFill, slot.ceiling) - grossBase)
        const bracketWidth   = slot.ceiling - grossBase
        const fillPct = bracketWidth > 0 ? Math.min(100, (inThisBracket / bracketWidth) * 100) : 0
        void filledPct; void totalWidth; void maxSlot

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, fontSize: 12, fontFamily: 'var(--font-mono)',
              fontWeight: isTarget ? 700 : 400, color: isTarget ? slot.color : M, textAlign: 'right' }}>
              {slot.label}
            </div>
            <div style={{ flex: 1, position: 'relative', height: 16,
              background: 'var(--surface)', border: `1px solid ${isTarget ? slot.color : 'var(--border2)'}` }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${fillPct}%`,
                background: slot.color, opacity: isTarget ? 0.7 : 0.35,
                transition: 'width 0.3s ease',
              }} />
              <div style={{ position: 'absolute', right: 4, top: 0, bottom: 0,
                display: 'flex', alignItems: 'center', fontSize: 12, color: M }}>
                {fmt(slot.ceiling)}
              </div>
            </div>
            <div style={{ width: 42, fontSize: 12, fontFamily: 'var(--font-mono)',
              color: fillPct >= 100 ? R : fillPct >= 70 ? Y : G, textAlign: 'right' }}>
              {fillPct.toFixed(0)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

// IRMAA tier row visualization
function IrmaaPanel({ result }: { result: AnnualDecisionResult }) {
  const { irmaa } = result
  if (!irmaa.collects) {
    return (
      <div style={{ padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
        <div style={{ fontSize: 12, color: M }}>
          Medicare not collected — IRMAA does not apply.
          {result.magi > 212_000 && (
            <span style={{ color: Y }}>
              {' '}Note: MAGI ${(result.magi/1000).toFixed(0)}K would trigger Tier 1 surcharges if enrolled.
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>CURRENT IRMAA TIER</div>
          <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)',
            color: irmaa.current_tier.part_b_monthly <= 185 ? G : irmaa.crossover_warn ? Y : R }}>
            {irmaa.current_tier.label}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
            Part B: ${irmaa.current_tier.part_b_monthly}/mo per person
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>ANNUAL IRMAA COST</div>
          <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: irmaa.annual_cost > 0 ? R : G }}>
            {fmtMoneyFull(irmaa.annual_cost)}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
            {irmaa.people} person{irmaa.people > 1 ? 's' : ''} × Part B + D
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: `1px solid ${irmaa.crossover_warn ? Y : 'var(--fd-hairline)'}`, borderRadius: 0, padding: '8px 10px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>HEADROOM TO NEXT TIER</div>
          <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)',
            color: irmaa.headroom === 0 ? M : irmaa.crossover_warn ? Y : G }}>
            {irmaa.headroom === 0 ? 'At ceiling' : fmtMoneyFull(irmaa.headroom)}
          </div>
          {irmaa.next_tier && (
            <div style={{ fontSize: 12, color: irmaa.crossover_warn ? Y : M, marginTop: 2 }}>
              {irmaa.crossover_warn ? ' CLOSE — ' : ''}{irmaa.next_tier.label}
            </div>
          )}
        </div>
      </div>
      {irmaa.crossover_warn && irmaa.next_tier && (
        <div style={{ padding: '6px 10px', background: 'var(--fd-card)',
          border: `1px solid ${Y}`, fontSize: 12, color: Y, lineHeight: 1.5 }}>
           IRMAA TIER CLIFF: Your MAGI of {fmt(result.magi)} is only {fmt(irmaa.headroom)} away from
          {' '}{irmaa.next_tier.label}. That adds{' '}
          ${((irmaa.next_tier.part_b_monthly - irmaa.current_tier.part_b_monthly) * 12 * irmaa.people).toFixed(0)}/yr.
          Reduce IRA withdrawals or Roth conversions to stay below the threshold.
        </div>
      )}
    </div>
  )
}

// Single action row in the state action plan
function ActionRow({ color, label, detail }: { color: string; label: string; detail: string }) {
  // Muted rows (standing rules) keep a readable label — only the dot is muted.
  const labelColor = color === M ? 'var(--text)' : color
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, background: color, marginTop: 3, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: labelColor }}>{label}</div>
        <div style={{ fontSize: 12, color: M, marginTop: 1, lineHeight: 1.4 }}>{detail}</div>
      </div>
    </div>
  )
}

// Income flow waterfall
function IncomeWaterfall({ result }: { result: AnnualDecisionResult }) {
  const items = [
    { label: 'Taxable Dividends', amount: result.taxable_div,     color: A,  type: 'income' },
    { label: 'SS Income',         amount: result.ss_income,        color: BL, type: 'income' },
    { label: 'RMD (forced)',      amount: result.rmd_forced,       color: R,  type: 'income' },
    { label: 'From Taxable',      amount: result.from_taxable,     color: A,  type: 'withdrawal' },
    { label: 'From IRA',          amount: result.from_rollover,    color: BL, type: 'withdrawal' },
    { label: 'Roth Conversion',   amount: result.roth_conversion,  color: G,  type: 'conversion' },
    { label: 'From Roth',         amount: result.from_roth,        color: G,  type: 'withdrawal' },
  ].filter(i => i.amount > 0)

  const barData = items.map(i => ({ name: i.label, value: Math.round(i.amount / 1000), color: i.color }))

  return (
    <ResponsiveContainer width="100%" height={items.length * 36 + 20}>
      <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 50, top: 4, bottom: 4 }}>
        <XAxis type="number" tick={{ fontSize: 12, fill: M }} tickFormatter={v => `$${v}K`} />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: M, fontFamily: 'monospace' }} />
        <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown) => [`$${Number(v).toLocaleString()}K`, 'Amount']} />
        <Bar dataKey="value" radius={[0, 2, 2, 0]}
          label={{ position: 'right', fontSize: 12, fill: M, formatter: (v: unknown) => `$${v}K` }}>
          {barData.map((d, i) => (
            <Cell key={i} fill={d.color} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  data: DashboardData
  /** Current annual spending / income target from the DrawdownTab shared parameters panel. */
  engineSpending?: number
  /** Whether Roth conversions should be included — controlled by the shared parameters panel. */
  doConversion: boolean
  /** Simple = key metrics only; Advanced = also shows Income Flow, bracket, IRMAA, NIIT sections. */
  mode?: 'simple' | 'advanced'
}

export function AnnualDecisionPanel({ data, engineSpending, doConversion, mode = 'simple' }: Props) {
  const tx  = data.tax_data
  const ia  = data.income_analytics
  const si  = data.spending_intelligence

  // Sensible default income target: engine spending > server target > true spending
  const defaultTarget = (() => {
    if (engineSpending != null && engineSpending > 0) return engineSpending
    if (ia?.target_income && ia.target_income > 0) return ia.target_income
    const spending = si?.true_annual_spending || tx.spending_true_annual || DRAWDOWN_DEFAULTS.annual_spending_fallback
    return Math.round(spending / 5000) * 5000
  })()

  // Income target comes directly from the shared DrawdownTab parameters panel.
  const incomeTarget = defaultTarget
  const [rmdOverride] = useState<number | null>(null)   // null = auto-computed

  const baseInputs: AnnualDecisionInputs = useMemo(() =>
    buildAnnualDecisionInputs(data, incomeTarget, {
      do_roth_conversion: doConversion,
      rmd_amount: rmdOverride ?? undefined,
    }),
    [data, incomeTarget, doConversion, rmdOverride]
  )

  const result: AnnualDecisionResult = useMemo(() =>
    computeAnnualDecision(baseInputs),
    [baseInputs]
  )

  // Live data display for informational context
  const serverMagi     = tx.magi ?? null
  const serverBktRoom  = tx.bracket_room ?? null
  const serverIrmaaHR  = tx.irmaa_headroom ?? null
  const serverNiitHR   = tx.niit_headroom ?? null
  const serverWdrawNeed = tx.withdrawal_need_actual ?? null

  // Conversion plan vs bracket — hoisted so both RECOMMENDED tile and withdrawal row share them
  const convPlanRemaining   = Math.max(0, baseInputs.conversion_target - baseInputs.converted_ytd)
  const convBracketHeadroom = baseInputs.conv_room_real
  const convBracketCeilK    = baseInputs.bracket_ceiling_magi > 0
    ? Math.round(baseInputs.bracket_ceiling_magi / 1000) : null
  const convLimitedByPlan   = doConversion && convPlanRemaining <= convBracketHeadroom

  // Tax-optimal cap check (Level 1 of the conversion hierarchy)
  // taxOptimalAmount = bracket room − safety buffer
  const convSafetyBuf       = tx.safety_buffer ?? 0
  const taxOptimalAmount    = Math.max(0, convBracketHeadroom - convSafetyBuf)
  const taxOptimalExceeded  = result.tax_optimal_exceeded
  const excessOverOptimal   = taxOptimalExceeded
    ? Math.max(0, baseInputs.converted_ytd - taxOptimalAmount) : 0

  // ── State-dependent action plan ──────────────────────────────────────────────
  const wsState   = tx.withdrawal_current_state as 'A' | 'B' | 'C' | undefined
  const wsRules   = wsState ? tx.withdrawal_states?.[wsState]?.rules : undefined
  const annualSpending = (si as any)?.true_annual_spending ?? tx.spending_true_annual ?? 0
  // totalSpending = full estimated annual cost of living from Settings (includes taxes etc.)
  // annualSpending = tracked lifestyle transactions only (used for bucket sizing)
  const totalSpending = tx.estimated_spending || annualSpending
  const allPositions = (data.accounts ?? []).flatMap(a => a.positions ?? [])
  const incomeEtfSymbols = [...new Set(
    allPositions
      .filter(p => p.fund_type === 'DIVIDEND' || p.fund_type === 'CEF' || p.fund_type === 'OPTION_INCOME')
      .map(p => p.symbol)
  )]
  // Bucket status — shared canonical calc (was previously reimplemented inline
  // here with a `?? 0` bucketYears fallback instead of computeBucketStatus's
  // state-aware `?? (wsState === 'A' ? 0 : 1)`, which could show "no bucket
  // required" for States B/C when the real requirement is 1 year).
  const { swvxxValue, bucketYearsRequired: bucketYears, requiredBucket } = computeBucketStatus(data)
  const bucketShortfall = Math.max(0, requiredBucket - swvxxValue)
  const bucketPct      = requiredBucket > 0 ? Math.min(100, (swvxxValue / requiredBucket) * 100) : 100
  const saleMin        = wsRules?.controlled_sale_target_min
  const saleMax        = wsRules?.controlled_sale_target_max
  const allowSale      = wsRules?.allow_controlled_sale ?? false
  const allowTrimEtfs  = wsRules?.allow_trimming_income_etfs ?? false
  const concTopPct      = tx.concentration_top_pct != null ? Math.round(tx.concentration_top_pct * 100) : null
  const concMustTrim    = tx.concentration_must_trim ?? false
  const concWatchThresh = Math.round((tx.concentration_rules?.single_theme?.watch ?? 0.30) * 100)


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* ── Alerts ───────────────────────────────────────────────────── */}
      {result.alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {result.alerts.map((a, i) => (
            <div key={i} style={{
              padding: '6px 12px', fontSize: 12, lineHeight: 1.5,
              background: `rgba(${a.level==='red'?'255,23,68':a.level==='orange'?'255,152,0':'255,214,0'},0.08)`,
              border: `1px solid ${a.level==='red'?R:a.level==='orange'?A:Y}`,
              color: a.level==='red'?R:a.level==='orange'?A:Y,
            }}>{a.msg}</div>
          ))}
        </div>
      )}

      {/* ── State action plan (B/C only) ─────────────────────────────── */}
      {/* Color discipline: the state accent lives in the header + left border ONLY.
          Row colors mean urgency — red = act now, amber = caution, muted = standing
          rule. Painting every State C rule red made a checklist read like an alarm. */}
      {wsState && wsState !== 'A' && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          borderLeft: `3px solid ${wsState === 'C' ? R : A}`,
          borderRadius: 0, padding: '10px 14px',
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.8px', color: wsState === 'C' ? R : A, marginBottom: 8 }}>
            ◈ STATE {wsState} ACTION PLAN — {wsState === 'C' ? 'CAPITAL-GAIN-DOMINANT' : 'HYBRID'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>

            {/* 1 — Controlled sale band (standing rule, not an alarm) */}
            {allowSale && saleMin != null && saleMax != null && (
              <ActionRow
                color={M}
                label={`Controlled sale band: ${fmtMoneyFull(saleMin)}–${fmtMoneyFull(saleMax)}/yr`}
                detail="Prioritize LTCG lots · avoid STCG · sell highest-cost lots first · avoid selling when market is down >10%"
              />
            )}

            {/* 2 — Bucket refill */}
            {bucketYears > 0 && (
              <ActionRow
                color={bucketShortfall > 0 ? R : G}
                label={bucketShortfall > 0
                  ? `Bucket refill required — short ${fmtMoneyFull(bucketShortfall)} (${Math.round(bucketPct)}% filled · need ${bucketYears}-yr reserve)`
                  : `${bucketYears}-year SWVXX bucket funded ✓`}
                detail={bucketShortfall > 0
                  ? `Current SWVXX ${fmtMoneyFull(swvxxValue)} vs required ${fmtMoneyFull(requiredBucket)} — ${wsState === 'C' ? 'refill immediately' : 'refill via controlled sales'}`
                  : `SWVXX ${fmtMoneyFull(swvxxValue)} covers ${bucketYears} yr of tracked spending`}
              />
            )}

            {/* 3 — Dividend routing */}
            {bucketShortfall > 0 && (
              <ActionRow
                color={Y}
                label="Route all dividends → SWVXX until bucket is full"
                detail={`No reinvestment until SWVXX reaches ${fmtMoneyFull(requiredBucket)}`}
              />
            )}

            {/* 4 — Income ETF trimming (a permission, not an alarm) */}
            {allowTrimEtfs && (
              <ActionRow
                color={M}
                label={wsState === 'C' ? 'Income ETF trimming allowed (aggressive)' : 'Income ETF trimming allowed if bucket underfilled'}
                detail={`${incomeEtfSymbols.length > 0 ? incomeEtfSymbols.join(' · ') : 'income ETFs'} — trim to raise cash for bucket refill`}
              />
            )}

            {/* 5 — Concentration trimming */}
            {concTopPct != null && concTopPct >= concWatchThresh && (
              <ActionRow
                color={concMustTrim ? R : A}
                label={concMustTrim
                  ? `Concentration trim required — top holding at ${concTopPct}%`
                  : `Concentration trim allowed — top holding at ${concTopPct}%`}
                detail={`${wsState === 'C' ? 'Required' : 'Allowed'} — reduce via controlled sales within the sale band`}
              />
            )}

            {/* 6 — Gain harvesting */}
            <ActionRow
              color={M}
              label={wsState === 'C' ? 'Gain harvesting encouraged within sale band' : 'Gain harvesting allowed within sale band'}
              detail="Harvest LTCG opportunistically · avoid wash sales · use highest-cost lots"
            />

            {/* 7 — Conversion sequencing — must agree with the canonical verdict */}
            <ActionRow
              color={doConversion ? (taxOptimalExceeded ? A : G) : M}
              label={doConversion
                ? taxOptimalExceeded
                  ? result.roth_conversion > 0
                    ? `Roth: STOP recommended · Optional bracket-fill: ${fmtMoneyFull(result.roth_conversion)} (intentional override only)`
                    : 'Roth conversion: STOP — tax-optimal cap exceeded'
                  : `Roth conversion: ${result.roth_conversion > 0 ? fmtMoneyFull(result.roth_conversion) : 'none — bracket full or target met'}`
                : 'Roth conversion: excluded from plan'}
              detail={doConversion
                ? `After bucket refill · bracket headroom ${convBracketHeadroom > 0 ? fmtMoneyFull(convBracketHeadroom) : '—'} · ${convLimitedByPlan ? 'plan-limited' : 'bracket-limited'}${taxOptimalExceeded ? ` · already ${fmtMoneyFull(excessOverOptimal)} above tax-optimal` : ''}`
                : 'Toggle "Include Roth conversions" to include conversions in the decision engine'}
            />

          </div>
        </div>
      )}

      {/* ── Conversion Positioning — 3-case mechanical block ────────── */}
      {doConversion && (() => {
        const ytd         = baseInputs.converted_ytd
        const planTarget  = baseInputs.conversion_target
        const bracketRoom = convBracketHeadroom        // R₂₄ — 24% ceiling room
        const taxOptimal  = taxOptimalAmount           // tax-optimal = bracket − buffer
        const planRem     = Math.max(0, planTarget - ytd)
        const bracketRem  = bracketRoom                // R₂₄ is defined before future conversion

        // 3-case classification
        const caseC = bracketRoom <= 0 || ytd >= bracketRoom + ytd  // at/above 24% ceiling
        const caseB = !caseC && taxOptimalExceeded                  // above tax-optimal, inside bracket
        const caseA = !caseC && !caseB                              // below tax-optimal

        const caseColor  = caseC ? R : caseB ? A : G
        const bracketRateLabel = `${tx.target_bracket_rate ?? 24}%`
        const caseLabel  = caseC ? `CASE C — ${bracketRateLabel} BRACKET FULL · STOP`
                         : caseB ? `CASE B — ABOVE TAX-OPTIMAL · INSIDE ${bracketRateLabel}`
                         :         'CASE A — BELOW TAX-OPTIMAL · CONVERT'

        return (
          <div style={{
            padding: '10px 14px', borderRadius: 0,
            background: caseC ? 'var(--fd-card)' : caseB ? 'var(--fd-card)' : 'var(--fd-card)',
            border: `1px solid ${caseColor}44`,
            borderLeft: `3px solid ${caseColor}`,
          }}>
            {/* Header */}
            <div style={{ fontSize: 12, fontWeight: 500, color: caseColor, letterSpacing: '0.8px', marginBottom: 8 }}>
              ◈ CONVERSION POSITIONING — {caseLabel}
            </div>

            {/* Metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 8 }}>
              {[
                { label: 'Plan target',              value: fmtMoneyFull(planTarget),  color: M },
                { label: `Tax-optimal (${bracketRateLabel} − buf)`,  value: fmtMoneyFull(taxOptimal),  color: caseA ? G : A },
                { label: `${bracketRateLabel} bracket room`,         value: fmtMoneyFull(bracketRem),  color: G },
                { label: 'YTD converted',            value: fmtMoneyFull(ytd),         color: caseC ? R : caseB ? A : G },
              ].map(r => (
                <div key={r.label} style={{ background: 'var(--fd-card)', borderRadius: 0, padding: '5px 8px' }}>
                  <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{r.label}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: r.color }}>{r.value}</div>
                </div>
              ))}
            </div>

            {/* Classification */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: M }}>
                Tax-optimal zone: <strong style={{ color: caseA ? G : R }}>
                  {caseA ? `${fmtMoneyFull(Math.max(0, taxOptimal - ytd))} remaining` : `exceeded by ${fmtMoneyFull(excessOverOptimal)}`}
                </strong>
              </div>
              <div style={{ fontSize: 12, color: M }}>
                {bracketRateLabel} bracket: <strong style={{ color: G }}>{fmtMoneyFull(bracketRem)} available</strong>
              </div>
              <div style={{ fontSize: 12, color: M }}>
                Plan target: <strong style={{ color: planRem > 0 ? A : G }}>
                  {planRem > 0 ? `${fmtMoneyFull(planRem)} short of ${fmtMoneyFull(planTarget)}` : 'met ✓'}
                </strong>
              </div>
            </div>

            {/* Action labels */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {caseA && (
                <div style={{ fontSize: 12, color: G }}>
                  ✓ <strong>Tax-optimal discipline:</strong> convert up to {fmtMoneyFull(Math.min(Math.max(0, taxOptimal - ytd), planRem))} more.
                </div>
              )}
              {caseB && (
                <>
                  <div style={{ fontSize: 12, color: A }}>
                     <strong>Tax-optimal discipline:</strong> STOP — already {fmtMoneyFull(excessOverOptimal)} above optimal. No further conversion.
                  </div>
                  {planRem > 0 && (
                    <div style={{ fontSize: 12, color: M }}>
                      ◈ <strong>Bracket-fill discipline:</strong> may convert {fmtMoneyFull(Math.min(planRem, bracketRem))} more to reach plan target — still inside {bracketRateLabel} bracket with room for STCG.
                    </div>
                  )}
                </>
              )}
              {caseC && (
                <div style={{ fontSize: 12, color: R }}>
                  ✗ <strong>STOP — {bracketRateLabel} bracket full.</strong> No additional conversion allowed.
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Conversion + withdrawal summary — always visible ───────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>GUARANTEED INCOME</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: G }}>{fmtMoneyFull(result.guaranteed_income)}</div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
            {[
              'dividends',
              result.ss_income > 0 ? 'SS' : null,
              result.rmd_forced > 0 ? 'RMD' : null,
            ].filter(Boolean).join(' + ')}
            {result.ss_income === 0 && result.rmd_forced === 0 ? ' · SS/RMD not active' : ''}
          </div>
          {result.ira_div > 0 && (
            <div style={{ fontSize: 12, color: A, marginTop: 3, borderTop: '1px solid var(--fd-hairline)', paddingTop: 3 }}>
              incl. {fmtMoneyFull(result.ira_div)} IRA divs — reinvested, NOT spendable
              <span style={{ color: G }}> · spendable: {fmtMoneyFull(result.guaranteed_income - result.ira_div)}</span>
            </div>
          )}
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>INCOME TARGET GAP</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: result.withdrawal_need === 0 ? G : Y }}>
            {result.withdrawal_need === 0 ? 'None' : fmtMoneyFull(result.withdrawal_need)}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>income target − guaranteed income
            <span style={{ color: A }}> · income target = Roth sizing target (not lifestyle spending)</span>
          </div>
          {annualSpending > 0 && (() => {
            const lifestyleGap = Math.max(0, annualSpending - result.guaranteed_income)
            const totalGap     = Math.max(0, totalSpending - result.guaranteed_income)
            const showBoth     = totalSpending > annualSpending
            return (
              <div style={{ fontSize: 12, marginTop: 3, borderTop: '1px solid var(--fd-hairline)', paddingTop: 3 }}>
                <div style={{ color: lifestyleGap === 0 ? G : A }}>
                  Lifestyle gap: {lifestyleGap === 0
                    ? `$0 (divs cover ${fmtMoneyFull(annualSpending)} tracked)`
                    : `${fmtMoneyFull(lifestyleGap)} of ${fmtMoneyFull(annualSpending)} tracked`}
                </div>
                {showBoth && (
                  <div style={{ color: totalGap === 0 ? G : Y, marginTop: 2 }}>
                    Total spending gap: {totalGap === 0
                      ? `$0 (divs cover ${fmtMoneyFull(totalSpending)} est.)`
                      : `${fmtMoneyFull(totalGap)} of ${fmtMoneyFull(totalSpending)} est.`}
                  </div>
                )}
                {serverWdrawNeed != null && (
                  <div style={{ color: M, marginTop: 1 }}>Tax tab withdrawal need: {fmtMoneyFull(serverWdrawNeed)}</div>
                )}
              </div>
            )
          })()}
        </div>
        <div style={{ background: 'var(--surface)', border: `1px solid ${taxOptimalExceeded ? `${A}30` : doConversion && result.roth_conversion > 0 ? 'var(--fd-card)' : 'var(--fd-card)'}`, borderRadius: 0, padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>ROTH CONVERSION</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: taxOptimalExceeded ? R : doConversion && result.roth_conversion > 0 ? G : M }}>
            {taxOptimalExceeded ? 'STOP' : doConversion ? (result.roth_conversion > 0 ? fmtMoneyFull(result.roth_conversion) : '—') : 'excluded'}
          </div>
          {taxOptimalExceeded ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
              <div style={{ fontSize: 12, color: R, fontWeight: 500 }}>Recommended: do not convert</div>
              <div style={{ fontSize: 12, color: M }}>exceeded by {fmtMoneyFull(excessOverOptimal)}</div>
              {result.roth_conversion > 0 && (
                <div style={{ fontSize: 12, color: A, marginTop: 1, borderTop: `1px solid ${A}25`, paddingTop: 2 }}>
                  Optional only: {fmtMoneyFull(result.roth_conversion)} fills bracket — intentional override, not recommended
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
              {doConversion
                ? result.roth_conversion > 0
                  ? convLimitedByPlan ? 'plan-limited' : 'bracket-limited'
                  : 'no headroom remaining'
                : 'toggle on to include'}
            </div>
          )}
        </div>
      </div>

      {/* ── Advanced sections: Income Flow, Bracket, IRMAA, NIIT ──────── */}
      {mode === 'advanced' && (<>
      {(() => {
        const ws = tx.withdrawal_current_state
        const stateColor = ws === 'C' ? R : ws === 'B' ? A : G
        const flowTitle = ws === 'C'
          ? 'Income Flow — Controlled Sales First'
          : ws === 'B'
          ? 'Income Flow — Dividends + Controlled Sales'
          : 'Income Flow — Dividends First'
        const stateDesc = ws === 'C'
          ? <><strong style={{ color: R }}>State C — Capital-Gain-Dominant</strong>. Asset sales fund spending; income ETFs may be trimmed. Avoid selling when market is down &gt;10%.</>
          : ws === 'B'
          ? <><strong style={{ color: A }}>State B — Hybrid</strong>. Dividends + controlled sales fund spending. Build 1-year SWVXX bucket.</>
          : <><strong style={{ color: G }}>State A — Income-Dominant</strong>. Dividends are the primary source — withdrawals only fill the gap.</>
        return (
      <TerminalSection id="div-first" title={flowTitle} defaultOpen accent={stateColor}>
        <div style={{ fontSize: 12, color: M, marginBottom: 10, lineHeight: 1.6 }}>
          {stateDesc}{' '}
          All figures are forward 12-month estimates using live portfolio data.
        </div>

        {/* Step-by-step breakdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {result.steps.map((step, i) => {
            const isIraDiv = step.label.includes('IRA Account Dividends')
            return (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '8px 12px',
              background: isIraDiv ? 'var(--fd-card)' : i === 0 ? 'var(--fd-card)' : 'var(--panel)',
              border: `1px solid ${isIraDiv ? A : i === 0 ? A : 'var(--border2)'}`,
              borderLeft: `3px solid ${isIraDiv ? A : step.color}`,
              opacity: isIraDiv ? 0.75 : 1,
            }}>
              <div style={{
                minWidth: 20, height: 20, borderRadius: 3,
                background: isIraDiv ? A : step.color, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 12, fontWeight: 500, color: 'var(--fd-ink)', flexShrink: 0,
              }}>{step.step}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: isIraDiv ? A : step.color }}>
                    {isIraDiv ? 'IRA Dividends (reinvested)' : step.label}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: isIraDiv ? A : step.color }}>
                    {fmtMoneyFull(step.amount)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: M, marginTop: 2, lineHeight: 1.4 }}>
                  {isIraDiv
                    ? ' Reinvests inside IRA — conversion vehicle only. NOT a spendable income source. Cannot directly fund spending; must be withdrawn (taxable event) to use.'
                    : step.note}
                </div>
              </div>
            </div>
            )
          })}
        </div>

        {/* Waterfall bar chart */}
        <SectionLabel text="Income sources breakdown" color={A} />
        <IncomeWaterfall result={result} />
      </TerminalSection>
        )
      })()}

      {/* ── Key metric tiles ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        <MetricTile label="GUARANTEED INCOME"  value={fmt(result.guaranteed_income)}  color={G}
          sub={`Dividends${result.ss_income > 0 ? ' + SS' : ''}${result.rmd_forced > 0 ? ' + RMD' : ''}${result.ss_income === 0 && result.rmd_forced === 0 ? ' only · SS/RMD not active' : ''}${result.ira_div > 0 ? ` · IRA ${fmt(result.ira_div)} reinvested (not spendable) · spendable ${fmt(result.guaranteed_income - result.ira_div)}` : ''}`} />
        <MetricTile label="INCOME TARGET GAP"  value={fmt(result.withdrawal_need)}    color={result.withdrawal_need === 0 ? G : Y}
          sub={result.withdrawal_need === 0 ? 'Income target met' : `Target gap · spending gap: ${fmt(Math.max(0, annualSpending - result.guaranteed_income))}`} />

        {/* Roth conversion — two-system breakdown */}
        {(() => {
          const planRemaining   = convPlanRemaining
          const bracketHeadroom = convBracketHeadroom
          const recommended     = result.roth_conversion
          const limitedByPlan   = convLimitedByPlan
          return (
            <div style={{ background: 'var(--surface)', border: `1px solid ${doConversion ? G : 'var(--fd-hairline)'}`,
              borderRadius: 0, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>

              {/* Recommended output */}
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                  RECOMMENDED CONVERSION
                </div>
                <div style={{ fontSize: 20, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  color: doConversion && recommended > 0 ? G : M }}>
                  {doConversion ? fmt(recommended) : '—'}
                </div>
                {doConversion && (
                  <div style={{ fontSize: 12, color: limitedByPlan ? A : Y, marginTop: 1 }}>
                    {limitedByPlan ? '← plan limited (completes target)' : '← bracket limited'}
                  </div>
                )}
              </div>

              {doConversion && (
                <>
                  {/* Plan section */}
                  <div style={{ padding: '5px 7px', background: 'var(--fd-card)',
                    border: '1px solid var(--fd-hairline)' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: A, letterSpacing: '0.6px', marginBottom: 3 }}>
                      PERSONAL PLAN · personal.json
                    </div>
                    {[
                      { label: 'Annual Target', value: fmt(baseInputs.conversion_target) },
                      { label: 'Converted YTD', value: fmt(baseInputs.converted_ytd), color: baseInputs.converted_ytd > 0 ? G : M },
                      { label: 'Remaining',     value: fmt(planRemaining), color: Y },
                    ].map(r => (
                      <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: M }}>{r.label}</span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: r.color ?? A }}>{r.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Bracket section */}
                  <div style={{ padding: '5px 7px', background: 'var(--fd-card)',
                    border: '1px solid var(--fd-hairline)' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: BL, letterSpacing: '0.6px', marginBottom: 3 }}>
                      TAX BRACKET LIMIT · simulated (actual from Tax tab: {baseInputs.conv_room_real > 0 ? fmt(baseInputs.conv_room_real) : '—'})
                    </div>
                    {[
                      { label: `${(baseInputs.target_bracket_rate * 100).toFixed(0)}% Bracket Headroom (Simulated)`, value: fmt(bracketHeadroom), color: bracketHeadroom > planRemaining ? G : R },
                      { label: `Max Conversion Before ${(baseInputs.target_bracket_rate * 100).toFixed(0)}% Ceiling (Simulated MAGI)`, value: fmt(bracketHeadroom), color: BL },
                    ].map(r => (
                      <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: M }}>{r.label}</span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: r.color }}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })()}

        <MetricTile label="SIMULATED TAX (12-MO)"    value={fmt(result.total_tax)}           color={R}
          sub={`Eff rate ${pct(result.effective_rate)} · ${(result.marginal_rate * 100).toFixed(0)}% marginal`} />
      </div>

      {/* ── Decision output tiles ────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: `1px solid ${G}`, padding: '10px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: G, letterSpacing: '0.8px', marginBottom: 10 }}>
          ◈ THIS YEAR'S WITHDRAWAL RECOMMENDATION · complete by December tax-year deadline
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {[
            { label: 'FROM TAXABLE',    amount: result.from_taxable,    color: A,
              note: result.no_lot_data
                ? 'Sales / money market · assumed LTCG-preferred (no lot-level cost-basis data)'
                : [
                    result.ltcg_from_taxable > 0 ? `${fmt(result.ltcg_from_taxable)} LTCG` : null,
                    result.stcg_from_taxable > 0 ? `${fmt(result.stcg_from_taxable)} STCG (ordinary rate)` : null,
                  ].filter(Boolean).join(' · ') || 'Cash / money-market — no gain realized',
              detail: null },
            { label: 'FROM IRA',        amount: result.from_rollover,   color: BL, note: 'Ordinary taxable · bracket-filling',  detail: null },
            { label: 'ROTH CONVERSION', amount: taxOptimalExceeded ? 0 : result.roth_conversion, color: taxOptimalExceeded ? R : G,
              note: !doConversion ? 'Conversion off' : taxOptimalExceeded ? 'STOP — recommended · tax-optimal exceeded' : convLimitedByPlan ? '← plan limited (completes target)' : '← bracket limited',
              detail: doConversion && !taxOptimalExceeded && result.roth_conversion > 0 ? [
                `plan rem: ${fmt(convPlanRemaining)} of ${fmt(baseInputs.conversion_target)}`,
                `bracket: ${fmt(convBracketHeadroom)} headroom${convBracketCeilK ? ` · $${convBracketCeilK}k ceil` : ''}`,
              ] : taxOptimalExceeded && result.roth_conversion > 0 ? [
                `Optional only: bracket-fill up to ${fmt(result.roth_conversion)}`,
                `Exceeded by ${fmt(excessOverOptimal)} — not recommended`,
              ] : null,
            },
            { label: 'FROM ROTH',       amount: result.from_roth,       color: G,  note: 'Tax-free · last resort only',         detail: null },
          ].map(m => (
            <div key={m.label} style={{
              background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
              borderTop: `2px solid ${m.color}`, borderRadius: 0, padding: '10px 12px',
            }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: m.amount > 0 ? 22 : 14, fontWeight: 500,
                fontFamily: 'var(--font-mono)', color: m.amount > 0 ? m.color : M }}>
                {m.amount > 0 ? fmtMoneyFull(m.amount) : '—'}
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 3, lineHeight: 1.3 }}>{m.note}</div>
              {m.detail && m.detail.map((d, di) => (
                <div key={di} style={{ fontSize: 12, color: M, marginTop: 2, lineHeight: 1.3,
                  paddingTop: di === 0 ? 4 : 0, borderTop: di === 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  {d}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Year-end Account Balance Impact ─────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: `1px solid ${BL}`, padding: '10px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: BL, letterSpacing: '0.8px', marginBottom: 10 }}>
          ◈ YEAR-END ACCOUNT BALANCE IMPACT
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[
            {
              label: 'TAXABLE ACCT',
              before: baseInputs.taxable_balance,
              after:  result.taxable_after,
              change: result.from_taxable,
              note:   result.from_taxable > 0 ? `−${fmt(result.from_taxable)} withdrawn` : 'No withdrawal',
              color:  A,
            },
            {
              label: 'ROLLOVER IRA',
              before: baseInputs.rollover_balance,
              after:  result.rollover_after,
              change: result.from_rollover + result.roth_conversion,
              note:   [
                result.from_rollover  > 0 ? `−${fmt(result.from_rollover)} withdrawn` : null,
                result.roth_conversion > 0 ? `−${fmt(result.roth_conversion)} converted` : null,
              ].filter(Boolean).join(' · ') || 'No change',
              color:  BL,
            },
            {
              label: 'ROTH IRA',
              before: baseInputs.roth_balance,
              after:  result.roth_after,
              change: -(result.roth_conversion - result.from_roth),
              note:   taxOptimalExceeded && result.roth_conversion > 0
                ? `No conversion (STOP) · Optional bracket-fill: +${fmt(result.roth_conversion)} if overriding`
                : !taxOptimalExceeded && result.roth_conversion > 0
                ? `+${fmt(result.roth_conversion)} in-kind conversion (planned)`
                : taxOptimalExceeded
                  ? 'No conversion — STOP verdict (tax-optimal exceeded)'
                  : result.from_roth > 0
                    ? `−${fmt(result.from_roth)} withdrawn (last resort)`
                    : 'No change',
              color:  G,
            },
          ].map(m => {
            const delta = m.after - m.before
            return (
              <div key={m.label} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${m.color}`, borderRadius: 0, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{m.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: M }}>{fmt(m.before)}</span>
                  <span style={{ fontSize: 12, color: M }}>→</span>
                  <span style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)', color: m.color }}>{fmt(m.after)}</span>
                </div>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                  color: delta >= 0 ? G : R, marginBottom: 3, fontWeight: 500 }}>
                  {delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(delta))}
                </div>
                <div style={{ fontSize: 12, color: M, lineHeight: 1.3 }}>{m.note}</div>
              </div>
            )
          })}
        </div>
        {result.roth_conversion > 0 && (() => {
          const planRemaining = Math.max(0, baseInputs.conversion_target - baseInputs.converted_ytd)
          const limitedByPlan = planRemaining <= baseInputs.conv_room_real
          if (taxOptimalExceeded) {
            return (
              <div style={{ padding: '6px 10px', background: `${A}09`,
                border: `1px solid ${A}50`, fontSize: 12, color: A, lineHeight: 1.6, borderRadius: 0 }}>
                 OPTIONAL BRACKET-FILL ONLY: up to {fmtMoneyFull(result.roth_conversion)} available inside the {(baseInputs.target_bracket_rate * 100).toFixed(0)}% bracket.
                {' '}<span style={{ color: R, fontWeight: 500 }}>Recommendation: STOP</span>
                <span style={{ color: M }}>
                  {' '}— already {fmtMoneyFull(excessOverOptimal)} above tax-optimal.
                  Converting {fmtMoneyFull(result.roth_conversion)} would add ~{fmtMoneyFull(result.roth_conversion * (baseInputs.target_bracket_rate ?? 0.24))} in tax without the tax-cost benefit.
                  Only proceed as an intentional bracket-fill override.
                </span>
              </div>
            )
          }
          return (
            <div style={{ padding: '6px 10px', background: 'var(--fd-card)',
              border: `1px solid ${G}`, fontSize: 12, color: G, lineHeight: 1.6, borderRadius: 0 }}>
               PLANNED IN-KIND CONVERSION: {fmtMoneyFull(result.roth_conversion)} moves from Rollover IRA → Roth IRA as securities.
              Tax ({fmt(result.ordinary_tax)}) paid from other income — assets carry over at cost basis.
              {' '}<span style={{ color: M }}>
                Plan target {fmtMoneyFull(baseInputs.conversion_target)} ·{' '}
                YTD {fmtMoneyFull(baseInputs.converted_ytd)} (Schwab) ·{' '}
                Remaining {fmtMoneyFull(planRemaining)} ·{' '}
                {(baseInputs.target_bracket_rate * 100).toFixed(0)}% headroom {fmtMoneyFull(baseInputs.conv_room_real)} →{' '}
              </span>
              <span style={{ color: limitedByPlan ? A : Y, fontWeight: 500 }}>
                {limitedByPlan
                  ? `recommends ${fmtMoneyFull(result.roth_conversion)} (completes plan, within bracket)`
                  : `bracket limits to ${fmtMoneyFull(result.roth_conversion)} (plan underfilled by ${fmtMoneyFull(planRemaining - result.roth_conversion)})`}
              </span>
            </div>
          )
        })()}
      </div>

      {/* ── Tax & Bracket Position ───────────────────────────────────── */}
      <TerminalSection id="bracket-pos" title="Tax & Bracket Position" defaultOpen accent={Y}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Left: bracket meter */}
          <div>
            <SectionLabel text={(() => {
              if (result.roth_conversion <= 0) return 'Bracket fill (simulated, fwd 12-mo) — income stacking'
              const planRemaining = Math.max(0, baseInputs.conversion_target - baseInputs.converted_ytd)
              const isPlanLimited = planRemaining <= baseInputs.conv_room_real
              return isPlanLimited
                ? 'Bracket fill (simulated, fwd 12-mo) — plan-limited conversion'
                : 'Bracket fill (simulated, fwd 12-mo) — income stacking'
            })()} color={Y} />
            <BracketFillBar result={result} />

            {/* BracketMeter — mirrors Tax tab view using engine-computed values */}
            <div style={{ marginTop: 8 }}>
              <BracketMeter
                pressurePct={result.bracket_overflow
                  ? 100
                  : baseInputs.bracket_ceiling_magi > 0
                    ? Math.min(100, (result.magi / baseInputs.bracket_ceiling_magi) * 100)
                    : 0}
                convRoom={result.roth_conversion}
                bktColor={result.bracket_overflow ? 'var(--red)' : result.bracket_headroom < 20000 ? 'var(--amber)' : 'var(--green)'}
                ceilGross={baseInputs.bracket_ceiling_magi}
                grossActual={result.magi}
                targetBracketRate={baseInputs.target_bracket_rate * 100}
              />
            </div>

            <Divider label="MAGI breakdown" />
            {[
              { label: 'Ordinary dividends (bracket)',   value: result.ordinary_income - (result.ss_income * result.ss_taxable_pct) - result.rmd_forced - result.from_rollover - result.roth_conversion - result.stcg_from_taxable, color: A },
              { label: `SS taxable (${(result.ss_taxable_pct * 100).toFixed(0)}%)`, value: result.ss_income * result.ss_taxable_pct, color: BL },
              { label: 'IRA withdrawal + conversion',    value: result.from_rollover + result.roth_conversion, color: BL },
              { label: 'Qualified dividends (LTCG)',     value: result.qualified_div_income, color: G },
              { label: result.no_lot_data ? 'Taxable sales — est. cap gain' : 'Taxable sales — LTCG (mature lots)', value: result.ltcg_from_taxable, color: G },
              { label: 'Taxable sales — STCG (ordinary rate)', value: result.stcg_from_taxable, color: A },
            ].filter(r => r.value > 0).map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between',
                padding: '4px 0', borderBottom: '1px solid var(--border2)' }}>
                <span style={{ fontSize: 12, color: M }}>{r.label}</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: r.color, fontWeight: 500 }}>
                  {fmtMoneyFull(r.value)}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between',
              padding: '5px 0', borderTop: `1px solid ${Y}`, marginTop: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: Y }}>TOTAL MAGI</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                color: result.bracket_overflow ? R : G }}>
                {fmtMoneyFull(result.magi)}
              </span>
            </div>
          </div>

          {/* Right: key figures */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SectionLabel text="Simulated forward-12-month tax — excludes YTD conversions + realized gains already in Tax tab" color={R} />
            {[
              { label: 'Ordinary tax',      value: result.ordinary_tax,    color: R },
              { label: 'LTCG / qualified',  value: result.ltcg_tax,        color: Y },
              { label: 'NIIT',              value: result.niit_amount,     color: result.niit_applies ? R : M },
              ...(result.irmaa.collects ? [
                { label: 'IRMAA (Medicare)', value: result.irmaa.annual_cost, color: result.irmaa.annual_cost > 0 ? Y : M },
              ] : []),
              { label: result.irmaa.collects ? 'TOTAL TAX + IRMAA' : 'TOTAL TAX',
                value: result.total_tax + result.irmaa.annual_cost + result.niit_amount, color: R },
            ].map(m => (
              <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '5px 8px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                <span style={{ fontSize: 12, color: M }}>{m.label}</span>
                <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: m.color }}>
                  {fmt(m.value)}
                </span>
              </div>
            ))}

            <Divider label="Risk scores" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ background: 'var(--bg)', padding: '6px 10px', flex: 1, border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                <div style={{ fontSize: 12, color: M, marginBottom: 3 }}>RMD RISK</div>
                <ScoreBadge value={result.rmd_risk} invert />
              </div>
              <div style={{ background: 'var(--bg)', padding: '6px 10px', flex: 1, border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                <div style={{ fontSize: 12, color: M, marginBottom: 3, cursor: 'help' }} title="Conversion Leverage: how much further you can convert before hitting the tax-optimal cap or bracket ceiling. HIGH = substantial remaining headroom for tax-efficient conversions.">CONVERSION LEVERAGE</div>
                <ScoreBadge value={result.torque_preservation} />
              </div>
              <div style={{ background: 'var(--bg)', padding: '6px 10px', flex: 1, border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                <div style={{ fontSize: 12, color: M, marginBottom: 3, cursor: 'help' }} title="Roth Opportunity: health of the Roth IRA relative to projected tax-free income needs. HIGH = strong Roth balance with meaningful compounding runway ahead.">ROTH OPPORTUNITY</div>
                <ScoreBadge value={result.roth_preservation} />
              </div>
            </div>

            {/* Bracket headroom callout */}
            <div style={{
              padding: '8px 10px',
              background: result.bracket_overflow ? 'var(--fd-card)' : 'var(--fd-card)',
              border: `1px solid ${result.bracket_overflow ? R : G}`,
              borderRadius: 0,
            }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>
                {(baseInputs.target_bracket_rate * 100).toFixed(0)}% BRACKET HEADROOM — SIMULATED
              </div>
              <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)',
                color: result.bracket_overflow ? R : G }}>
                {result.bracket_overflow ? `−${fmt(result.magi - baseInputs.bracket_ceiling_magi)}` : fmt(result.bracket_headroom)}
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                {result.bracket_overflow ? 'OVER ceiling — reduce target or IRA withdrawal' : 'remaining before next bracket · fwd 12-mo estimate'}
              </div>
              {serverBktRoom != null && (
                <div style={{ fontSize: 12, color: BL, marginTop: 3, borderTop: '1px solid var(--fd-hairline)', paddingTop: 3 }}>
                  Tax tab actual: {fmtMoneyFull(serverBktRoom)}
                  {' · '}diff {serverBktRoom > result.bracket_headroom ? '+' : ''}{fmt(serverBktRoom - result.bracket_headroom)} vs sim (YTD gains/conversions not reflected in sim)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Server-sourced comparison */}
        {(serverMagi || serverBktRoom || serverIrmaaHR || serverWdrawNeed) && (
          <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--panel2)',
            border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${BL}`, borderRadius: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: BL, letterSpacing: '0.6px', marginBottom: 5 }}>
              SERVER DATA (CURRENT YEAR ACTUALS — FROM TAX TAB)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {[
                { label: 'Actual MAGI', value: serverMagi, note: 'current year est.' },
                { label: 'Bracket room', value: serverBktRoom, note: 'per tax engine' },
                { label: 'IRMAA headroom', value: serverIrmaaHR, note: 'per tax tab' },
                { label: 'Withdrawal need', value: serverWdrawNeed, note: 'per spending data' },
                { label: 'NIIT headroom', value: serverNiitHR, note: 'per tax tab' },
              ].filter(d => d.value != null).map(d => (
                <div key={d.label} style={{ background: 'var(--bg)', padding: '5px 8px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                  <div style={{ fontSize: 12, color: M }}>{d.label}</div>
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: BL, fontWeight: 500 }}>
                    {fmtMoneyFull(d.value!)}
                  </div>
                  <div style={{ fontSize: 12, color: M }}>{d.note}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </TerminalSection>

      {/* ── IRMAA — only shown when Medicare is elected in personal.json ── */}
      {baseInputs.collect_medicare && (
        <TerminalSection id="irmaa" title="IRMAA — Medicare Surcharge"
          defaultOpen accent={result.irmaa.crossover_warn ? Y : BL}>
          <IrmaaPanel result={result} />
        </TerminalSection>
      )}

      {/* ── NIIT ─────────────────────────────────────────────────────── */}
      <TerminalSection id="niit" title="NIIT — Net Investment Income Tax"
        defaultOpen={result.niit_applies} accent={result.niit_applies ? R : M}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[
            { label: 'NIIT STATUS',    value: result.niit_applies ? ' APPLIES' : '✓ NOT TRIGGERED',
              color: result.niit_applies ? R : G },
            { label: 'NIIT AMOUNT',    value: result.niit_applies ? fmt(result.niit_amount) : '—',
              color: R },
            { label: 'MAGI HEADROOM',  value: result.niit_headroom > 0 ? fmt(result.niit_headroom) : 'At ceiling',
              color: result.niit_applies ? R : G },
          ].map(m => (
            <div key={m.label} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{m.label}</div>
              <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: M, lineHeight: 1.5, padding: '6px 10px', background: 'var(--panel2)', border: '1px solid var(--fd-hairline)' }}>
          NIIT = 3.8% on net investment income when MAGI exceeds{' '}
          {fmtMoneyFull(baseInputs.niit_threshold)} (MFJ). Your qualified dividends
          ({fmt(result.qualified_div_income)}) are subject to NIIT if MAGI exceeds the threshold.
          {result.niit_applies && ` Currently APPLIES — income target is over threshold by ${fmt(result.magi - baseInputs.niit_threshold)}.`}
        </div>
      </TerminalSection>

      {/* ── Data sources reference ───────────────────────────────────── */}
      <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
        borderLeft: `2px solid ${M}`, borderRadius: 0, fontSize: 12, color: M, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text2)' }}>DATA SOURCES:</strong>{' '}
        Taxable dividends from income_analytics.by_account (fwd 12m) ·
        IRMAA from tax_data.collect_medicare / medicare_people / irmaa_* fields ·
        Bracket ceiling from tax_data.target_bracket_ceiling / target_bracket_rate ·
        NIIT from tax_data.niit_threshold / niit_headroom ·
        RMD auto-computed from rollover balance and current age (IRS Uniform Lifetime Table) ·
        SS from tax_data.ss_annual / ss_start_age · All values update live on income target change.
      </div>
      </>)}
    </div>
  )
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function MetricTile({ label, value, color = 'var(--text)', sub }: {
  label: string; value: string; color?: string; sub?: string
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
      <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)', color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: M, marginTop: 2, lineHeight: 1.3 }}>{sub}</div>}
    </div>
  )
}

function SectionLabel({ text, color = A }: { text: string; color?: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.8px',
      color, textTransform: 'uppercase', marginBottom: 6 }}>{text}</div>
  )
}
