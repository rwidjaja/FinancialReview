/**
 * ConversionCalendarPanel — Multi-year Rollover → Roth Conversion Schedule
 *
 * Mirrors the Sell & Rebalance calendar in RebalancePlanPanel:
 *   • Step-by-step numbered conversions (year / month)
 *   • Each step: what to SELL from rollover, what to BUY in Roth, tax added to income
 *   • Stacked income bar showing MAGI position each year
 *   • Running rollover depletion + Roth growth
 *   • Stops when rollover is fully depleted
 */

import type { DashboardData } from '../../types/dashboard'
import { fmtFull, fmtM } from '../../utils/formatters'
import { DRAWDOWN_DEFAULTS } from '../../utils/taxConfig'
import { ROLLOVER_DEPLETED_THRESHOLD } from '../../utils/constants'

// ── Colour palette (matches RebalancePlanPanel) ───────────────────────────────
const C = {
  green:  'var(--green)',
  red:    'var(--red)',
  amber:  'var(--amber)',
  blue:   'var(--blue)',
  text:   'var(--text)',
  muted:  'var(--text2)',
  surf:   'var(--surface)',
  orange: 'var(--amber)',
}

const MONTHS_LONG = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// ── Engine types ──────────────────────────────────────────────────────────────

interface ConvSell   { symbol: string; dollars: number; shares: number; pct_of_pos: number }
interface ConvBuy    { symbol: string; dollars: number; pct_of_conv: number }

interface ConvStep {
  step:            number
  year:            number
  month:           number
  label:           string    // "December 2026"
  phase:           'base_remaining' | 'bracket_fill' | 'annual'
  is_current_year: boolean
  amount:          number    // dollars being converted this step
  rollover_sells:  ConvSell[]
  roth_buys:       ConvBuy[]
  tax_added:       number    // amount × marginal_rate
  rollover_before: number
  rollover_after:  number
  roth_before:     number
  roth_after:      number
  // Income picture for the year
  dividends:       number
  conversion_total: number   // total conversion THIS year (may include prior steps)
  fwd_income:      number
  magi_est:        number
  niit_threshold:  number
  ceiling:         number
  why:             string
}

// ── Calendar engine ───────────────────────────────────────────────────────────

function buildCalendar(
  rolloverBal:  number,
  rothBal:      number,
  annualTarget: number,
  ytdConverted: number,
  remaining:    number,
  decAmt:       number,
  margRate:     number,
  fwdIncome:    number,
  cyIncome:     number,
  growthRate:   number,
  niitThreshold:number,
  ceiling:      number,
  convPlanBase: any[],
  convPlanDec:  any[],
  rothPlan:     any[],
  cy:           number,
  cm:           number,
): ConvStep[] {
  const steps: ConvStep[] = []
  let stepNum     = 0
  let rvBal       = rolloverBal
  let roBal       = rothBal
  const MAX_YEARS = 12   // safety cap

  // Proportion of each underweight symbol in the annual conversion
  const totalConvD = rothPlan.reduce((s: number, r: any) => s + (r.conv_dollars ?? 0), 0)
  const convWeights: { symbol: string; weight: number }[] = rothPlan
    .filter((r: any) => (r.conv_dollars ?? 0) > 0)
    .map((r: any) => ({ symbol: r.symbol, weight: (r.conv_dollars ?? 0) / totalConvD }))

  const scaleRothBuys = (amount: number): ConvBuy[] =>
    convWeights.map(w => ({
      symbol:      w.symbol,
      dollars:     Math.round(amount * w.weight),
      pct_of_conv: Math.round(w.weight * 100),
    })).filter(b => b.dollars >= 1)

  const buildSells = (plan: any[]): ConvSell[] =>
    plan.map(cp => ({
      symbol:      cp.symbol,
      dollars:     cp.convert_dollars ?? 0,
      shares:      cp.convert_shares  ?? 0,
      pct_of_pos:  cp.pct_of_position ?? 0,
    })).filter(s => s.dollars >= 1)

  // ── Step builder helper ────────────────────────────────────────────────────
  const addStep = (
    year: number, month: number,
    phase: ConvStep['phase'],
    amount: number,
    sells: ConvSell[],
    buys:  ConvBuy[],
    conv_year_total: number,
    why: string,
  ) => {
    if (amount < ROLLOVER_DEPLETED_THRESHOLD || rvBal < ROLLOVER_DEPLETED_THRESHOLD) return
    stepNum++
    const isCY = year === cy
    // Current year: full non-conversion ordinary income (W2 + divs + STCG from
    // gross_no_ss). Future years: forward portfolio income only.
    const incomeBase = isCY ? cyIncome : fwdIncome
    const magi = incomeBase + conv_year_total  // LTCG sells are 0 here — pure conversion plan
    const before_rv = rvBal
    const before_ro = roBal
    rvBal = Math.max(0, rvBal - amount)
    roBal = roBal + amount
    steps.push({
      step: stepNum, year, month,
      label: `${MONTHS_LONG[month - 1]} ${year}`,
      phase, is_current_year: isCY, amount,
      rollover_sells: sells,
      roth_buys: buys,
      tax_added: Math.round(amount * margRate),
      rollover_before: Math.round(before_rv),
      rollover_after:  Math.round(rvBal),
      roth_before:     Math.round(before_ro),
      roth_after:      Math.round(roBal),
      dividends:       incomeBase,
      conversion_total: conv_year_total,
      fwd_income:      incomeBase,
      magi_est:        magi,
      niit_threshold:  niitThreshold,
      ceiling,
      why,
    })
  }

  // ── Current year: remaining base + December bracket fill ──────────────────
  if (remaining > 0 && convPlanBase.length > 0) {
    addStep(
      cy, 12, 'base_remaining', remaining,
      buildSells(convPlanBase),
      scaleRothBuys(remaining),
      ytdConverted + remaining,
      `Complete annual target: ${fmtFull(remaining)} remaining out of ${fmtFull(annualTarget)} plan. ` +
      `${fmtFull(ytdConverted)} already converted this year. Execute in ${cm <= 11 ? 'December' : 'December'} ` +
      `once full-year income is confirmed.`,
    )
  }

  if (decAmt > 0 && convPlanDec.length > 0) {
    // Only count `remaining` if the base step above was actually emitted
    const baseStepEmitted = remaining > 0 && convPlanBase.length > 0
    const alreadyThisYear = (baseStepEmitted ? remaining : 0) + ytdConverted
    addStep(
      cy, 12, 'bracket_fill', decAmt,
      buildSells(convPlanDec),
      scaleRothBuys(decAmt),
      alreadyThisYear + decAmt,
      `December bracket fill: ${fmtFull(decAmt)} additional conversion to max out ` +
      `${Math.round(margRate * 100)}% bracket. Only execute when income confidence is HIGH ` +
      `and full-year AGI is confirmed below ceiling.`,
    )
  }

  // ── Future years: annual conversion in December ────────────────────────────
  // Use the primary rollover symbol from the current plan (e.g. SMH).
  // Price/shares are unknown at execution time so shares = 0 (shown as —).
  const primaryRvSymbol = (convPlanDec[0] ?? convPlanBase[0])?.symbol ?? 'rollover'

  // Grow balances once for the current-year → first-future-year transition.
  // The loop below grows balances at the END of each future-year iteration
  // (for the NEXT iteration's transition) — without this, the very first
  // year-over-year gap (cy → cy+1) would carry balances forward flat.
  rvBal *= (1 + growthRate)
  roBal *= (1 + growthRate)

  for (let yr = cy + 1; yr <= cy + MAX_YEARS; yr++) {
    if (rvBal < ROLLOVER_DEPLETED_THRESHOLD) break
    const thisYearAmt = Math.min(annualTarget, rvBal)
    const futureSells: ConvSell[] = [{
      symbol:      primaryRvSymbol,
      dollars:     thisYearAmt,
      shares:      0,   // price unknown at execution time — re-evaluate each December
      pct_of_pos:  Math.min(100, Math.round(thisYearAmt / rvBal * 100)),
    }]
    const isLastYear = rvBal - thisYearAmt < ROLLOVER_DEPLETED_THRESHOLD
    addStep(
      yr, 12, 'annual', thisYearAmt,
      futureSells,
      scaleRothBuys(thisYearAmt),
      thisYearAmt,   // this year's total
      isLastYear
        ? `FINAL CONVERSION — rollover IRA fully depleted. Convert remaining ${fmtFull(thisYearAmt)}.`
        : `Annual conversion ${yr}: ${fmtFull(thisYearAmt)} in December after income is confirmed. ` +
          `${fmtFull(Math.max(0, rvBal - thisYearAmt))} rollover remaining after this step.`,
    )
    // Grow remaining balances — same model as the Runway chart and RMD scenarios
    rvBal *= (1 + growthRate)
    roBal *= (1 + growthRate)
  }

  // Two steps can legitimately land in the same year+month (e.g. "complete this
  // year's plan target" + "December bracket fill" both execute in December) —
  // without a suffix they render as two cards with an identical bold "December
  // 2026" heading, reading like a duplicate. Disambiguate with "(1 of 2)".
  const countByPeriod = new Map<string, number>()
  for (const s of steps) countByPeriod.set(`${s.year}-${s.month}`, (countByPeriod.get(`${s.year}-${s.month}`) ?? 0) + 1)
  const seenByPeriod = new Map<string, number>()
  for (const s of steps) {
    const key = `${s.year}-${s.month}`
    const total = countByPeriod.get(key) ?? 1
    if (total > 1) {
      const seen = (seenByPeriod.get(key) ?? 0) + 1
      seenByPeriod.set(key, seen)
      s.label = `${s.label} (${seen} of ${total})`
    }
  }

  return steps
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ children, accent, style }: {
  children: React.ReactNode; accent?: string; style?: React.CSSProperties
}) {
  return (
    <div style={{
      background: C.surf,
      border: `1px solid ${accent ? accent + '33' : 'var(--fd-hairline)'}`,
      borderLeft: accent ? `3px solid ${accent}` : undefined,
      borderRadius: 0, padding: '14px 16px', ...style,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ text, color = C.muted }: { text: string; color?: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
      letterSpacing: '1px', color, marginBottom: 8 }}>{text}</div>
  )
}

// ── Income stacked bar (same as RebalancePlanPanel's YearPictureCard) ─────────

function IncomeBar({ step }: { step: ConvStep }) {
  const ord     = step.dividends + step.conversion_total
  const magi    = ord
  const barMax  = Math.max(step.niit_threshold * 1.1, magi * 1.1, 1)
  const w       = (v: number) => `${Math.min(100, (v / barMax) * 100).toFixed(2)}%`
  const niitOk  = magi <= step.niit_threshold
  const ceilOk  = step.ceiling <= 0 || ord <= step.ceiling
  const status  = !niitOk ? 'over' : !ceilOk ? 'watch' : 'safe'
  const sc      = status === 'safe' ? C.green : status === 'watch' ? C.amber : C.red

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
        fontSize: 12, color: C.muted, marginBottom: 4 }}>
        <span style={{ letterSpacing: '0.5px' }}>{step.year} INCOME PICTURE</span>
        <span style={{ fontWeight: 500, color: sc }}>
          MAGI {fmtM(magi)} · {status === 'safe' ? '✓ under NIIT' : status === 'watch' ? ' near ceiling' : ' over NIIT'}
        </span>
      </div>

      {/* Stacked bar */}
      <div style={{ position: 'relative', height: 18, borderRadius: 0,
        background: 'var(--fd-card)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
          width: w(step.dividends), background: C.blue, opacity: 0.75 }} />
        <div style={{ position: 'absolute', left: w(step.dividends), top: 0, bottom: 0,
          width: w(step.conversion_total), background: C.amber, opacity: 0.8 }} />
      </div>

      {/* Threshold markers */}
      <div style={{ position: 'relative', height: 14 }}>
        {step.ceiling > 0 && (
          <div style={{ position: 'absolute',
            left: `calc(${w(step.ceiling)} - 1px)`, top: 0, bottom: 0,
            width: 2, background: C.amber, opacity: 0.9 }} />
        )}
        <div style={{ position: 'absolute',
          left: `calc(${w(step.niit_threshold)} - 1px)`, top: 0, bottom: 0,
          width: 2, background: C.red, opacity: 0.8 }} />
        {step.ceiling > 0 && (
          <span style={{ position: 'absolute', left: w(step.ceiling),
            top: 2, fontSize: 12, color: C.amber, whiteSpace: 'nowrap',
            transform: 'translateX(-50%)' }}>Ceiling</span>
        )}
        <span style={{ position: 'absolute', left: w(step.niit_threshold),
          top: 2, fontSize: 12, color: C.red, whiteSpace: 'nowrap',
          transform: 'translateX(-50%)' }}>NIIT</span>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.blue }}>■ Base income {fmtM(step.dividends)}</span>
        <span style={{ fontSize: 12, color: C.amber }}>■ Conversion {fmtM(step.conversion_total)}</span>
        <span style={{ fontSize: 12, color: C.red }}>│ NIIT {fmtM(step.niit_threshold)}</span>
        {step.ceiling > 0 && (
          <span style={{ fontSize: 12, color: C.amber }}>│ Ceiling {fmtM(step.ceiling)}</span>
        )}
      </div>
    </div>
  )
}

// ── Single conversion step card ───────────────────────────────────────────────

function StepCard({ step, isToday, dimmed }: { step: ConvStep; isToday: boolean; dimmed?: boolean }) {
  const phaseColor =
    step.phase === 'base_remaining' ? C.amber  :
    step.phase === 'bracket_fill'   ? C.blue   :
    C.green
  const phaseLabel =
    step.phase === 'base_remaining' ? 'COMPLETE ANNUAL TARGET' :
    step.phase === 'bracket_fill'   ? 'DECEMBER BRACKET FILL' :
    'ANNUAL CONVERSION'
  const isFinal = step.rollover_after < ROLLOVER_DEPLETED_THRESHOLD

  return (
    <div style={{ opacity: dimmed ? 0.38 : 1, transition: 'opacity 0.2s' }}>
    <Card accent={isFinal ? C.green : phaseColor}>
      {/* ── Step header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
        paddingBottom: 10, borderBottom: '1px solid var(--fd-hairline)' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 3,
          background: phaseColor + '22', border: `1.5px solid ${phaseColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 500, color: phaseColor, flexShrink: 0,
          fontFamily: 'var(--font-mono)',
        }}>
          {step.step}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{step.label}</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: phaseColor,
            textTransform: 'uppercase', letterSpacing: '0.8px', marginTop: 2 }}>
            {phaseLabel}
            {isFinal && <span style={{ color: C.green, marginLeft: 8 }}> FINAL — ROLLOVER DEPLETED</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: phaseColor,
            fontFamily: 'var(--font-mono)' }}>
            {fmtFull(step.amount)}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>converting</div>
        </div>
        {isToday && (
          <div style={{
            padding: '3px 8px', borderRadius: 0,
            background: C.amber + '22', border: `1px solid ${C.amber}55`,
            fontSize: 12, fontWeight: 500, color: C.amber,
          }}>TODAY'S YEAR</div>
        )}
      </div>

      {/* ── Window status badge — shown below header when card is dimmed ── */}
      {dimmed && (
        <div style={{
          marginBottom: 10,
          padding: '4px 10px', borderRadius: 0, display: 'inline-block',
          background: step.is_current_year ? 'var(--red-dim)' : 'var(--fd-card)',
          border: step.is_current_year ? '1px solid var(--red-border)' : '1px solid rgba(255,255,255,0.15)',
          fontSize: 12, fontWeight: 500,
          color: step.is_current_year ? 'var(--red)' : 'var(--text2)',
          letterSpacing: '0.8px',
        }}>
          {step.is_current_year ? 'WINDOW WAIT — DO NOT EXECUTE' : `PENDING — ${step.year} EXECUTION`}
        </div>
      )}

      {/* ── Income bar ──────────────────────────────────────────────────── */}
      <IncomeBar step={step} />

      {/* ── Two-column: Sell (rollover) + Buy (Roth) ────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 12 }}>

        {/* Rollover outflow */}
        <div>
          <SectionLabel text=" Sell from Rollover IRA" color={C.red} />
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                {['SYM', 'CONVERT', 'SHARES', '% POS'].map(h => (
                  <th key={h} style={{ fontSize: 12, color: C.muted, textAlign: h !== 'SYM' ? 'right' : 'left',
                    padding: '3px 4px', fontWeight: 500, letterSpacing: '0.4px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {step.rollover_sells.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                  <td style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
                    color: C.text, padding: '5px 4px' }}>{s.symbol}</td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                    color: C.red, fontWeight: 500, textAlign: 'right', padding: '5px 4px' }}>
                    {fmtFull(s.dollars)}
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                    color: C.muted, textAlign: 'right', padding: '5px 4px' }}>
                    {s.shares > 0 ? s.shares.toFixed(2) : '—'}
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                    color: C.muted, textAlign: 'right', padding: '5px 4px' }}>
                    {s.pct_of_pos.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            {fmtM(step.rollover_before)} → <span style={{ color: step.rollover_after < ROLLOVER_DEPLETED_THRESHOLD ? C.green : C.red }}>
              {step.rollover_after < ROLLOVER_DEPLETED_THRESHOLD ? '⬛ $0 (depleted)' : fmtM(step.rollover_after)}
            </span>
            {step.rollover_after >= 50 && (
              <span style={{ color: C.muted }}> rollover remaining</span>
            )}
          </div>
          {step.rollover_sells.some(s => s.shares > 0) && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3, fontStyle: 'italic' }}>
              Shares at today's price — actual shares at execution will differ
            </div>
          )}
        </div>

        {/* Roth inflow */}
        <div>
          <SectionLabel text=" Deploy in Roth IRA" color={C.green} />
          {step.roth_buys.length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted }}>No underweight targets configured.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                  {['SYM', 'BUY', '% CONV'].map(h => (
                    <th key={h} style={{ fontSize: 12, color: C.muted, textAlign: h !== 'SYM' ? 'right' : 'left',
                      padding: '3px 4px', fontWeight: 500, letterSpacing: '0.4px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {step.roth_buys.map((b, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                    <td style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
                      color: C.text, padding: '5px 4px' }}>{b.symbol}</td>
                    <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                      color: C.green, fontWeight: 500, textAlign: 'right', padding: '5px 4px' }}>
                      {fmtFull(b.dollars)}
                    </td>
                    <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)',
                      color: C.muted, textAlign: 'right', padding: '5px 4px' }}>
                      {b.pct_of_conv}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            {fmtM(step.roth_before)} → <span style={{ color: C.green }}>{fmtM(step.roth_after)}</span> Roth balance
          </div>
        </div>
      </div>

      {/* ── Tax line ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center',
        padding: '8px 10px', borderRadius: 0,
        background: 'var(--fd-card)',
        borderTop: '1px solid var(--fd-hairline)' }}>
        <span style={{ fontSize: 12, color: C.muted }}>
          Tax on conversion:
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12,
          fontWeight: 500, color: C.red }}>
          {fmtFull(step.tax_added)}
        </span>
        <span style={{ fontSize: 12, color: C.muted }}>
          added to ordinary income — pay from outside funds
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
          Tax due April 15, {step.year + 1}
        </span>
      </div>

      {/* ── Why this month ──────────────────────────────────────────────── */}
      <div style={{ marginTop: 8, fontSize: 12, color: C.muted, lineHeight: 1.6,
        padding: '6px 8px', borderRadius: 0,
        background: phaseColor + '08', borderLeft: `2px solid ${phaseColor}30` }}>
        {step.why}
      </div>
    </Card>
    </div>
  )
}

// ── Summary / depletion card ──────────────────────────────────────────────────

function DepletionSummary({ steps, annualTarget, rolloverBal }: {
  steps: ConvStep[]; annualTarget: number; rolloverBal: number
}) {
  if (steps.length === 0) return null
  const lastStep    = steps[steps.length - 1]
  const totalTax    = steps.reduce((s, t) => s + t.tax_added, 0)
  const finalRoth   = lastStep.roth_after
  const depYear     = lastStep.year
  const yearCount   = new Set(steps.map(s => s.year)).size
  const depleted    = lastStep.rollover_after < ROLLOVER_DEPLETED_THRESHOLD

  return (
    <Card accent={C.green}>
      <SectionLabel text="Conversion runway summary" color={C.green} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {[
          { label: 'Total to Convert',  val: fmtM(rolloverBal), color: C.red,   note: 'current rollover balance' },
          { label: 'Total Tax Bill',    val: fmtM(totalTax),    color: C.red,   note: 'paid from outside funds' },
          { label: 'Final Roth Balance',val: fmtM(finalRoth),   color: C.green, note: `after all ${steps.length} steps` },
          { label: depleted ? 'Depletion Year' : 'Projected Through', val: `${depYear}`, color: C.amber, note: `step calendar · ${yearCount} tax year${yearCount > 1 ? 's' : ''}` },
        ].map((m, i) => (
          <div key={i} style={{ textAlign: 'center', padding: '8px 6px',
            background: 'var(--fd-card)', borderRadius: 0 }}>
            <div style={{ fontSize: 12, color: C.muted, letterSpacing: '0.5px', marginBottom: 3 }}>{m.label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14,
              fontWeight: 500, color: m.color }}>{m.val}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{m.note}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
        Converting {fmtM(annualTarget)}/yr at the base rate, with the remaining rollover growing
        at {(DRAWDOWN_DEFAULTS.expected_return * 100).toFixed(0)}%/yr.
        {depleted
          ? ` All ${fmtM(rolloverBal)} in the rollover IRA will be in the Roth by ${depYear} — fully tax-free forever.`
          : ` ≈${fmtM(lastStep.rollover_after)} still remains in the rollover after ${depYear} — growth outpaces the conversion rate; consider a higher annual target.`}
        {' '}Rebalancing within the Roth (selling overweight positions, buying underweight ones) is
        tax-free and should be done in parallel as target allocations are filled.
      </div>
    </Card>
  )
}

// ── "Not now" banner (mirrors RebalancePlanPanel's NotNowBanner) ──────────────

function ConversionBlockedBanner({
  convWin, blockers, whyNotConvert,
}: {
  convWin:       string
  blockers:      string[]
  whyNotConvert: string[]
}) {
  const isClosed = convWin === 'CLOSED'
  const accent   = isClosed ? C.red : C.amber
  const icon     = isClosed ? '' : ''
  const title    = isClosed
    ? 'Conversion window CLOSED — no bracket room available'
    : 'Conversion window WAITING — do not execute yet'

  // Deduplicate across blockers + whyNotConvert
  const allReasons = [...new Set([...blockers, ...whyNotConvert])]

  // Bucket refill is a Sell & Rebalance concern (funded by controlled-sale
  // proceeds) — a Roth conversion moves money between tax-advantaged accounts
  // and never touches the taxable cash bucket, so it doesn't belong in this
  // tab's blocker list even when the underlying engine flags it. Filter out
  // reasons ABOUT the bucket (they start with "Bucket ...") — not reasons that
  // merely mention "bucket" in passing, e.g. "NIIT ... does not block
  // spending or bucket." would false-positive on a plain /bucket/i test.
  const isBucketReason = (r: string) => /^bucket\b/i.test(r)
  const otherReasons  = allReasons.filter(r => !isBucketReason(r))

  return (
    <Card accent={accent}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: accent, marginBottom: 6 }}>
            {title}
          </div>
          {otherReasons.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {otherReasons.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: C.muted, lineHeight: 1.4 }}>
                  <span style={{ color: accent, flexShrink: 0, fontWeight: 500 }}>•</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{
            marginTop: 10, padding: '6px 8px', borderRadius: 0,
            background: accent + '10', border: `1px solid ${accent}33`,
            fontSize: 12, color: C.muted, lineHeight: 1.5,
          }}>
            The <strong style={{ color: accent }}>depletion runway</strong> above shows the projected
            schedule once the window opens. No action should be taken until ALL blockers are cleared
            and the window shows <strong style={{ color: C.green }}>OPEN</strong>.
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ConversionCalendarPanel({
  tx, data, rolloverBal, rothBal,
  annualTarget, ytdConverted, remaining,
  convPlanBase, convPlanDec,
  rothPlan,
  convWin, windowBlockers, whyNotConvert,
}: {
  tx:             DashboardData['tax_data']
  data:           DashboardData
  rolloverBal:    number
  rothBal:        number
  annualTarget:   number
  ytdConverted:   number
  remaining:      number
  convPlanBase:   any[]
  convPlanDec:    any[]
  rothPlan:       any[]
  convWin:        string          // 'OPEN' | 'WAIT' | 'CLOSED'
  windowBlockers: string[]        // from decision.next_conversion_window.blocked_by
  whyNotConvert:  string[]        // from decision.why_not_convert?.reasons ?? []
}) {
  const margRate  = tx.marginal_rate ?? ((tx.target_bracket_rate ?? 24) / 100)
  // Taxable-account, AGI-relevant (ROC excluded) — NOT portfolio_fwd_12m, which
  // sums forward income across ALL accounts including tax-advantaged Roth/
  // Rollover IRA dividends that never touch any bracket.
  const fwdIncome = (tx.annual_div_for_agi ?? tx.annual_div_total ?? data.income_analytics?.portfolio_fwd_12m ?? 0)
  // Current-year non-conversion income: gross_no_ss already includes W2 + divs
  // + STCG + YTD conversions — strip the conversions so the bar can re-add them
  const cyIncome  = tx.gross_no_ss != null
    ? Math.max(0, tx.gross_no_ss - (tx.converted_ytd ?? 0))
    : fwdIncome
  const growthRate = DRAWDOWN_DEFAULTS.expected_return
  const niitThr   = tx.niit_threshold ?? 250000
  const ceiling   = tx.bracket_ceiling_magi ?? tx.target_bracket_ceiling ?? 0
  const today     = new Date()
  const cy        = today.getFullYear()
  const cm        = today.getMonth() + 1

  const decAmt     = convPlanDec.reduce((s: number, c: any) => s + (c.convert_dollars ?? 0), 0)
  const windowOpen = convWin === 'OPEN'

  if (rolloverBal < ROLLOVER_DEPLETED_THRESHOLD || annualTarget <= 0) {
    return (
      <div style={{ padding: '14px 16px', color: C.muted, fontSize: 12 }}>
        {rolloverBal < ROLLOVER_DEPLETED_THRESHOLD
          ? '✓ Rollover IRA fully depleted — conversion complete.'
          : 'No annual conversion target configured.'}
      </div>
    )
  }

  const steps = buildCalendar(
    rolloverBal, rothBal, annualTarget, ytdConverted, remaining, decAmt,
    margRate, fwdIncome, cyIncome, growthRate, niitThr, ceiling,
    convPlanBase, convPlanDec, rothPlan,
    cy, cm,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Depletion summary always visible — informational ────────────── */}
      <DepletionSummary steps={steps} annualTarget={annualTarget}
        rolloverBal={rolloverBal} />

      {/* ── Window CLOSED / WAIT: blocker banner above dimmed steps ─────── */}
      {!windowOpen && (
        <ConversionBlockedBanner
          convWin={convWin}
          blockers={windowBlockers}
          whyNotConvert={whyNotConvert} />
      )}

      {/* ── Step cards: always visible, dimmed when window is not OPEN ───── */}
      {steps.map(step => (
        <StepCard key={`${step.year}-${step.month}-${step.phase}`}
          step={step} isToday={step.is_current_year} dimmed={!windowOpen} />
      ))}

    </div>
  )
}
