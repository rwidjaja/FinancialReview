import { useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { PanelHeader, Divider } from '../ui/Terminal'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import {
  MFJ_BRACKETS, SINGLE_BRACKETS,
  STD_DEDUCTION_MFJ, STD_DEDUCTION_SINGLE,
  AGE_65_ADDITIONAL_DEDUCTION, SENIOR_DEDUCTION_PER_PERSON, SENIOR_DEDUCTION_EXPIRES_YEAR,
  RMD_FACTORS,
  RMD_START_AGE,
  DRAWDOWN_DEFAULTS,
  IRMAA_TIERS_MFJ,
  IRMAA_TIERS_SINGLE,
} from '../../utils/taxConfig'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const B = 'var(--blue)'


interface LifetimeRow {
  age: number
  dividends: number
  rmd: number
  conversion: number
  ss_income: number
  gross_income: number
  federal_tax: number
  irmaa: number
  total_tax: number
  effective_rate: number
  marginal_rate: number
  rollover_value: number
  roth_value: number
}

interface ScenarioPaths {
  label: string
  shortLabel: string
  color: string
  annualConversion: number
  rows: LifetimeRow[]
  lifetimeTaxes: number
  lifetimeIrmaa: number
  lifetimeRmds: number
  avgEffRate: number
  peakMarginalRate: number
  endRollover: number
  endRoth: number
  estateValue: number   // endRoth + endRollover at age 90
}

function computeFederalTax(
  taxableIncome: number,
  brackets: typeof MFJ_BRACKETS,
): { tax: number; marginalRate: number } {
  if (taxableIncome <= 0) return { tax: 0, marginalRate: 0 }
  let remaining = taxableIncome
  let tax = 0
  let marginalRate = brackets[0].rate
  for (const b of brackets) {
    const bandWidth = Math.min(remaining, b.max - b.min)
    if (bandWidth <= 0) continue
    tax += bandWidth * b.rate
    remaining -= bandWidth
    marginalRate = b.rate
    if (remaining <= 0) break
  }
  return { tax, marginalRate }
}

function computeIrmaa(magi: number, isMfj: boolean, age: number): number {
  if (age < 65) return 0
  const tiers = isMfj ? IRMAA_TIERS_MFJ : IRMAA_TIERS_SINGLE
  const base = tiers[0]
  const tier = [...tiers].reverse().find(t => magi >= t.magi_from) ?? tiers[0]
  // Tier values are full premiums per person — surcharge is delta vs Tier 0
  const annualSurcharge = ((tier.part_b_monthly - (base?.part_b_monthly ?? 185))
                         + (tier.part_d_monthly - (base?.part_d_monthly ?? 0))) * 12
  return annualSurcharge * (isMfj ? 2 : 1)
}

function computeLifetimePath(
  rolloverBal: number,
  rothBal: number,
  annualDivs: number,
  ssAnnual: number,
  ssStartAge: number,
  currentAge: number,
  annualConversion: number,
  growthRate: number,
  filingStatus: string,
  collectMedicare: boolean,
  rmdStartAge: number,
  spouseAge: number | null,
): LifetimeRow[] {
  const isMfj = filingStatus === 'MFJ'
  const brackets = isMfj ? MFJ_BRACKETS : SINGLE_BRACKETS
  const baseStdDed = isMfj ? STD_DEDUCTION_MFJ : STD_DEDUCTION_SINGLE
  // Age gap lets us project the spouse's age at each future row (spouseAge
  // moves in lockstep with `age` — filer and spouse both age one year per row).
  const ageGap = spouseAge != null ? currentAge - spouseAge : null
  const currentYear = new Date().getFullYear()

  let rollover = rolloverBal
  let roth = rothBal
  const rows: LifetimeRow[] = []
  const startAge = Math.floor(currentAge) + 1
  const endAge = 90

  for (let age = startAge; age <= endAge; age++) {
    // Standard deduction grows once each qualifying person turns 65: a
    // permanent per-person addition, plus (through SENIOR_DEDUCTION_EXPIRES_YEAR)
    // a temporary additional senior deduction. Both were previously omitted,
    // overstating taxable income (and every downstream tax figure) for the
    // ~30-year span of this projection where the filer (and often spouse) are 65+.
    const yearAtRow      = currentYear + (age - Math.floor(currentAge))
    const spouseAgeAtRow = ageGap != null ? age - ageGap : null
    const seniorCount     = (age >= 65 ? 1 : 0) + (isMfj && spouseAgeAtRow != null && spouseAgeAtRow >= 65 ? 1 : 0)
    let stdDed = baseStdDed + AGE_65_ADDITIONAL_DEDUCTION * seniorCount
    if (yearAtRow <= SENIOR_DEDUCTION_EXPIRES_YEAR) stdDed += SENIOR_DEDUCTION_PER_PERSON * seniorCount

    let rmd = 0
    if (age >= rmdStartAge && rollover > 0) {
      const factor = RMD_FACTORS[age] ?? RMD_FACTORS[99] ?? 6.3
      rmd = Math.min(rollover, rollover / factor)
    }

    const availableForConv = Math.max(0, rollover - rmd)
    const conv = Math.min(annualConversion, availableForConv)

    const ssIncome = age >= ssStartAge ? ssAnnual : 0
    const ssTaxable = ssIncome * 0.85

    const grossIncome = annualDivs + conv + rmd + ssTaxable
    const taxableIncome = Math.max(0, grossIncome - stdDed)
    const { tax: federalTax, marginalRate } = computeFederalTax(taxableIncome, brackets)

    const irmaa = collectMedicare ? computeIrmaa(grossIncome, isMfj, age) : 0
    const totalTax = federalTax + irmaa
    const effRate = grossIncome > 0 ? (totalTax / grossIncome) * 100 : 0

    const rolloverAfter = Math.max(0, rollover - rmd - conv) * (1 + growthRate)
    const rothAfter = (roth + conv) * (1 + growthRate)

    rows.push({
      age,
      dividends: annualDivs,
      rmd,
      conversion: conv,
      ss_income: ssIncome,
      gross_income: grossIncome,
      federal_tax: federalTax,
      irmaa,
      total_tax: totalTax,
      effective_rate: effRate,
      marginal_rate: marginalRate * 100,
      rollover_value: rolloverAfter,
      roth_value: rothAfter,
    })

    rollover = rolloverAfter
    roth = rothAfter
  }

  return rows
}

function buildScenario(
  label: string,
  shortLabel: string,
  color: string,
  annualConversion: number,
  rolloverBal: number,
  rothBal: number,
  annualDivs: number,
  ssAnnual: number,
  ssStartAge: number,
  currentAge: number,
  growthRate: number,
  filingStatus: string,
  collectMedicare: boolean,
  rmdStartAge: number,
  spouseAge: number | null,
): ScenarioPaths {
  const rows = computeLifetimePath(
    rolloverBal, rothBal, annualDivs, ssAnnual, ssStartAge,
    currentAge, annualConversion, growthRate, filingStatus, collectMedicare, rmdStartAge, spouseAge,
  )
  const lifetimeTaxes = rows.reduce((s, r) => s + r.federal_tax, 0)
  const lifetimeIrmaa = rows.reduce((s, r) => s + r.irmaa, 0)
  const lifetimeRmds  = rows.reduce((s, r) => s + r.rmd, 0)
  const taxRows = rows.filter(r => r.gross_income > 0)
  const avgEffRate = taxRows.length > 0
    ? taxRows.reduce((s, r) => s + r.effective_rate, 0) / taxRows.length
    : 0
  const peakMarginalRate = rows.reduce((mx, r) => Math.max(mx, r.marginal_rate), 0)
  const last = rows[rows.length - 1]
  const endRollover = last?.rollover_value ?? 0
  const endRoth = last?.roth_value ?? 0
  return {
    label, shortLabel, color, annualConversion, rows,
    lifetimeTaxes, lifetimeIrmaa, lifetimeRmds, avgEffRate, peakMarginalRate,
    endRollover, endRoth,
    estateValue: endRoth + endRollover,
  }
}

type ActiveScen = 'full' | 'half' | 'rmd'

// ── Simple horizontal bar ──────────────────────────────────────────────────────
function TaxBar({ label, color, value, maxValue, collectMedicare, irmaa }: {
  label: string; color: string; value: number; maxValue: number; collectMedicare: boolean; irmaa: number
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ color: M, width: 80, textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--fd-card)', borderRadius: 0, height: 16, position: 'relative' }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color,
          borderRadius: 0, opacity: 0.8,
        }} />
      </div>
      <span style={{ color, fontFamily: 'var(--font-mono)', fontWeight: 500, width: 90, flexShrink: 0 }}>
        {fmtMoney(value)}
        {collectMedicare && irmaa > 0 && (
          <span style={{ color: M, fontWeight: 400, fontSize: 12 }}> +{fmtMoney(irmaa)}</span>
        )}
      </span>
    </div>
  )
}

export function RmdScenarioPanel({ tx, rolloverBal, rothBal, annualTarget }: {
  tx: DashboardData['tax_data']
  rolloverBal: number
  rothBal: number
  annualTarget: number
}) {
  const [activeScen, setActiveScen] = useState<ActiveScen>('rmd')
  const [showTable, setShowTable] = useState(false)

  const currentAge      = tx?.current_age ?? 60
  const ssAnnual        = tx?.ss_annual ?? 0
  const ssStartAge      = tx?.ss_start_age ?? 70
  const annualDivs      = tx?.projections_recommended?.[0]?.dividends
                       ?? tx?.projections?.[0]?.dividends
                       ?? tx?.annual_div_for_agi
                       ?? tx?.annual_div_total
                       ?? 0
  const filingStatus    = tx?.filing_status ?? 'MFJ'
  const collectMedicare = tx?.collect_medicare ?? false
  const rmdStartAge     = tx?.rmd_start_age ?? RMD_START_AGE
  const growthRate      = DRAWDOWN_DEFAULTS.expected_return
  const spouseAge       = tx?.spouse_age ?? null

  const { full, half, rmdOnly } = useMemo(() => {
    const commonArgs = [
      rolloverBal, rothBal, annualDivs, ssAnnual, ssStartAge,
      currentAge, growthRate, filingStatus, collectMedicare, rmdStartAge, spouseAge,
    ] as const
    return {
      full:    buildScenario('Plan-Target Conversion', 'Plan',    G, annualTarget,     ...commonArgs),
      half:    buildScenario('Partial Conversion',      'Partial', A, annualTarget / 2, ...commonArgs),
      rmdOnly: buildScenario('RMD-Only',                'RMD',     R, 0,                ...commonArgs),
    }
  }, [rolloverBal, rothBal, annualDivs, ssAnnual, ssStartAge, currentAge, annualTarget, filingStatus, collectMedicare, rmdStartAge, spouseAge])

  if (annualDivs === 0 && rolloverBal === 0) return null

  // Determine winning scenario (lowest total lifetime cost)
  const winner = [full, half, rmdOnly].reduce((best, s) =>
    (s.lifetimeTaxes + s.lifetimeIrmaa) < (best.lifetimeTaxes + best.lifetimeIrmaa) ? s : best
  )
  const rmdOnlyTotal = rmdOnly.lifetimeTaxes + rmdOnly.lifetimeIrmaa
  const winnerTotal = winner.lifetimeTaxes + winner.lifetimeIrmaa
  const winnerSavings = rmdOnlyTotal - winnerTotal
  const winnerSavingsPct = rmdOnlyTotal > 0 ? (winnerSavings / rmdOnlyTotal) * 100 : 0
  const winnerPeakSavings = rmdOnly.peakMarginalRate - winner.peakMarginalRate
  const winnerRmdsAvoided = rmdOnly.lifetimeRmds - winner.lifetimeRmds

  const totalFull = rmdOnly.lifetimeTaxes + rmdOnly.lifetimeIrmaa - (full.lifetimeTaxes + full.lifetimeIrmaa)
  const totalHalf = rmdOnly.lifetimeTaxes + rmdOnly.lifetimeIrmaa - (half.lifetimeTaxes + half.lifetimeIrmaa)

  const scenarios = { full, half, rmd: rmdOnly }
  const activeRows = scenarios[activeScen].rows
  const scenList: { key: ActiveScen; s: ScenarioPaths }[] = [
    { key: 'rmd',  s: rmdOnly },
    { key: 'half', s: half },
    { key: 'full', s: full },
  ]

  const maxLifetimeTax = Math.max(full.lifetimeTaxes, half.lifetimeTaxes, rmdOnly.lifetimeTaxes)
  const maxRmd = Math.max(full.lifetimeRmds, half.lifetimeRmds, rmdOnly.lifetimeRmds)

  const chartData = full.rows.map((r, i) => ({
    age: r.age,
    Plan:       Math.round(full.rows[i].marginal_rate),
    Partial:    Math.round(half.rows[i]?.marginal_rate ?? 0),
    'RMD-Only': Math.round(rmdOnly.rows[i]?.marginal_rate ?? 0),
  }))

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── SCORECARD / Winner card ── */}
      <div style={{
        background: 'var(--fd-card)',
        border: `1px solid ${winner.color}`,
        borderLeft: `4px solid ${winner.color}`,
        borderRadius: 0, padding: '12px 16px',
      }}>
        <div style={{ fontSize: 12, color: winner.color, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
          RECOMMENDED LIFETIME STRATEGY
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 500, color: winner.color, fontFamily: 'var(--font-mono)' }}>
             {winner.label.toUpperCase()}
          </span>
          {winner.annualConversion > 0 && (
            <span style={{ fontSize: 12, color: M }}>({fmtMoney(winner.annualConversion)}/yr until rollover depleted)</span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500, marginBottom: 2 }}>Tax Drag Reduction</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: winner.color, fontFamily: 'var(--font-mono)' }}>+{fmtMoney(winnerSavings)}</div>
            <div style={{ fontSize: 12, color: winner.color, fontWeight: 500 }}>{winnerSavingsPct.toFixed(1)}% less tax paid{collectMedicare ? ' incl. IRMAA' : ''}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500, marginBottom: 2 }}>Peak Bracket Reduced</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: winnerPeakSavings > 0 ? G : M, fontFamily: 'var(--font-mono)' }}>
              {winnerPeakSavings > 0 ? `${rmdOnly.peakMarginalRate.toFixed(0)}% → ${winner.peakMarginalRate.toFixed(0)}%` : `${winner.peakMarginalRate.toFixed(0)}%`}
            </div>
            <div style={{ fontSize: 12, color: M }}>lifetime peak marginal rate</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500, marginBottom: 2 }}>Lifetime RMDs Avoided</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: winnerRmdsAvoided >= rmdOnly.lifetimeRmds ? G : A, fontFamily: 'var(--font-mono)' }}>
              {winnerRmdsAvoided >= rmdOnly.lifetimeRmds ? 'ALL — $0' : fmtMoney(winnerRmdsAvoided)}
            </div>
            <div style={{ fontSize: 12, color: M }}>vs {fmtMoney(rmdOnly.lifetimeRmds)} under RMD-Only</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500, marginBottom: 2 }}>Estate @ 90</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoney(winner.estateValue)}</div>
            <div style={{ fontSize: 12, color: M }}>Roth {fmtMoney(winner.endRoth)} + Rollover {fmtMoney(winner.endRollover)}</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: M, lineHeight: 1.6 }}>
          <strong style={{ color: winner.color }}>Why: </strong>
          Current marginal rate ({tx?.target_bracket_rate ?? 24}%) is lower than projected future rate ({rmdOnly.peakMarginalRate.toFixed(0)}% under RMD-Only).
          Converting now locks in a lower rate and eliminates forced distributions starting at age {rmdStartAge}.
        </div>
      </div>

      {/* ── Comparison summary table ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px', padding: '8px 14px 6px', borderBottom: '1px solid var(--fd-hairline)' }}>
          LIFETIME STRATEGY COMPARISON (Age {Math.floor(currentAge) + 1} → 90)
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
              <th style={{ textAlign: 'left', padding: '6px 14px', color: M, fontWeight: 500, fontSize: 12, textTransform: 'uppercase' }}>Metric</th>
              {scenList.map(({ s }) => (
                <th key={s.label} style={{ textAlign: 'right', padding: '6px 14px', color: s.color, fontWeight: 500, fontSize: 12, textTransform: 'uppercase' }}>
                  {s === winner ? ' ' : ''}{s.shortLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              {
                label: 'Lifetime Fed Tax',
                vals: scenList.map(({ s }) => ({ v: s.lifetimeTaxes, winner: s === winner, color: R })),
                format: fmtMoney, lowerIsBetter: true,
              },
              {
                label: 'Peak Marginal Rate',
                vals: scenList.map(({ s }) => ({ v: s.peakMarginalRate, winner: s === winner, color: s.peakMarginalRate >= 32 ? R : s.peakMarginalRate >= 24 ? 'var(--yellow)' : G })),
                format: (v: number) => `${v.toFixed(0)}%`, lowerIsBetter: true,
              },
              {
                label: 'Lifetime RMDs',
                vals: scenList.map(({ s }) => ({ v: s.lifetimeRmds, winner: s === winner, color: s.lifetimeRmds === 0 ? G : s.lifetimeRmds > 2_000_000 ? R : 'var(--yellow)' })),
                format: (v: number) => v === 0 ? '$0' : fmtMoney(v), lowerIsBetter: true,
              },
              {
                label: 'Estate @ 90',
                vals: scenList.map(({ s }) => ({ v: s.estateValue, winner: s === winner, color: G })),
                format: fmtMoney, lowerIsBetter: false,
              },
            ].map((row, i) => {
              const best = row.lowerIsBetter
                ? Math.min(...row.vals.map(v => v.v))
                : Math.max(...row.vals.map(v => v.v))
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                  <td style={{ padding: '5px 14px', color: M }}>{row.label}</td>
                  {row.vals.map((cell, j) => {
                    const isBest = cell.v === best
                    return (
                      <td key={j} style={{ textAlign: 'right', padding: '5px 14px', fontFamily: 'var(--font-mono)', fontWeight: isBest ? 700 : 400, color: isBest ? cell.color : M }}>
                        {isBest ? ' ' : ''}{row.format(cell.v)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Lifetime tax bar chart ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
          TOTAL LIFETIME FEDERAL TAX PAID (Age {Math.floor(currentAge) + 1} → 90)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {scenList.map(({ s }) => (
            <TaxBar key={s.label} label={s.shortLabel} color={s.color}
              value={s.lifetimeTaxes} maxValue={maxLifetimeTax}
              collectMedicare={collectMedicare} irmaa={s.lifetimeIrmaa} />
          ))}
        </div>
        {(totalFull > 0 || totalHalf > 0) && (
          <div style={{ marginTop: 8, fontSize: 12, color: M, display: 'flex', gap: 20 }}>
            <span>Plan-Target saves <strong style={{ color: G }}>{fmtMoneyFull(totalFull)}</strong> vs RMD-Only</span>
            <span>Partial saves <strong style={{ color: A }}>{fmtMoneyFull(totalHalf)}</strong> vs RMD-Only</span>
          </div>
        )}
      </div>

      {/* ── Scenario summary cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {scenList.map(({ key, s }) => {
          const savingsVsRmd = s === rmdOnly ? null
            : (rmdOnly.lifetimeTaxes + rmdOnly.lifetimeIrmaa) - (s.lifetimeTaxes + s.lifetimeIrmaa)
          const isWinner = s === winner
          return (
            <div key={key} style={{
              background: isWinner ? 'var(--fd-card)' : 'var(--surface)',
              border: isWinner ? `1px solid ${s.color}40` : '1px solid rgba(255,255,255,0.07)',
              borderTop: `3px solid ${s.color}`,
              borderRadius: 0, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                <PanelHeader>{s.label.toUpperCase()}</PanelHeader>
                {isWinner && <span style={{ fontSize: 12, color: s.color, fontWeight: 500 }}> BEST</span>}
              </div>
              <div style={{ fontSize: 12, color: M, marginBottom: 8 }}>
                {s.annualConversion > 0
                  ? `${fmtMoney(s.annualConversion)}/yr until rollover depleted`
                  : `No conversions — RMDs from age ${rmdStartAge}`}
              </div>
              <Divider />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: M }}>Lifetime Fed Tax</span>
                  <span style={{ color: R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoney(s.lifetimeTaxes)}</span>
                </div>
                {collectMedicare && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: M }}>Lifetime IRMAA</span>
                      <span style={{ color: 'var(--yellow)', fontFamily: 'var(--font-mono)' }}>{fmtMoney(s.lifetimeIrmaa)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--fd-hairline)', paddingTop: 4, fontWeight: 500 }}>
                      <span style={{ color: M }}>Total Tax Burden</span>
                      <span style={{ color: R, fontFamily: 'var(--font-mono)' }}>{fmtMoney(s.lifetimeTaxes + s.lifetimeIrmaa)}</span>
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: M }}>Avg Eff Rate</span>
                  <span style={{ color: s.avgEffRate >= 25 ? R : s.avgEffRate >= 20 ? 'var(--yellow)' : G, fontFamily: 'var(--font-mono)' }}>
                    {s.avgEffRate.toFixed(1)}%
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: M }}>Peak Marginal Rate</span>
                  <span style={{ color: s.peakMarginalRate >= 32 ? R : s.peakMarginalRate >= 24 ? 'var(--yellow)' : G, fontFamily: 'var(--font-mono)' }}>
                    {s.peakMarginalRate.toFixed(0)}%
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: M }}>Lifetime RMDs</span>
                  <span style={{ color: s.lifetimeRmds === 0 ? G : s.lifetimeRmds > 2_000_000 ? R : 'var(--yellow)', fontFamily: 'var(--font-mono)' }}>
                    {s.lifetimeRmds === 0 ? '$0 — None' : fmtMoney(s.lifetimeRmds)}
                  </span>
                </div>
                <div style={{ borderTop: '1px solid var(--fd-hairline)', paddingTop: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
                    <span style={{ color: M }}>Estate @ 90</span>
                    <span style={{ color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoney(s.estateValue)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: M }}>↳ Roth</span>
                    <span style={{ color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoney(s.endRoth)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: M }}>↳ Rollover</span>
                    <span style={{ color: s.endRollover <= 0 ? G : 'var(--yellow)', fontFamily: 'var(--font-mono)' }}>
                      {s.endRollover <= 0 ? 'DEPLETED' : fmtMoney(s.endRollover)}
                    </span>
                  </div>
                </div>
                {savingsVsRmd != null && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    borderTop: '1px solid var(--fd-hairline)', paddingTop: 4, fontWeight: 500,
                  }}>
                    <span style={{ color: M }}>Tax Savings vs RMD-Only</span>
                    <span style={{ color: savingsVsRmd > 0 ? G : R, fontFamily: 'var(--font-mono)' }}>
                      {savingsVsRmd > 0 ? '+' : ''}{fmtMoney(savingsVsRmd)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Cumulative RMD comparison bar ── */}
      {rmdOnly.lifetimeRmds > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
            CUMULATIVE RMDS TAKEN (Total Forced Distributions Age {rmdStartAge}–90)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scenList.map(({ s }) => (
              <TaxBar key={s.label} label={s.shortLabel} color={s.color}
                value={s.lifetimeRmds} maxValue={maxRmd}
                collectMedicare={false} irmaa={0} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 6 }}>
            {full.lifetimeRmds === 0
              ? 'Plan-Target Conversion eliminates all forced distributions. RMDs stop after rollover is depleted.'
              : 'Partial Conversion reduces but does not eliminate RMDs. Plan-Target Conversion eliminates them entirely.'}
          </div>
        </div>
      )}

      {/* ── Marginal rate chart ── */}
      <div>
        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.8px' }}>
          MARGINAL TAX RATE TRAJECTORY (%) — ALL 3 SCENARIOS
        </div>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <XAxis dataKey="age" tick={{ fill: 'var(--text2)', fontSize: 12 }} label={{ value: 'Age', position: 'insideBottomRight', offset: -4, fill: 'var(--text2)', fontSize: 12 }} />
            <YAxis tick={{ fill: 'var(--text2)', fontSize: 12 }} unit="%" domain={[0, 40]} />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
              formatter={(val: unknown, name: unknown) => [`${val}%`, String(name)]}
              labelFormatter={(v: unknown) => `Age ${v}`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Plan"     stroke="var(--green)" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="Partial"  stroke="var(--amber)" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="RMD-Only" stroke="var(--red)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── IRMAA comparison ── */}
      {collectMedicare && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, color: 'var(--yellow)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.8px' }}>
            IRMAA LIFETIME COST COMPARISON (Medicare Part B/D enrolled)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, fontSize: 12 }}>
            {scenList.map(({ s }) => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: M }}>{s.shortLabel}</span>
                <span style={{ color: s.lifetimeIrmaa > 50000 ? R : 'var(--yellow)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {fmtMoney(s.lifetimeIrmaa)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 6 }}>
            RMD-Only often triggers higher IRMAA tiers in late life due to stacked RMD + dividend + SS income.
          </div>
        </div>
      )}

      {/* ── Detail table ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            YEAR-BY-YEAR DETAIL
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {scenList.map(({ key, s }) => (
              <button key={key} onClick={() => setActiveScen(key)} style={{
                fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500,
                padding: '4px 10px', cursor: 'pointer',
                background: activeScen === key ? 'var(--fd-card)' : 'var(--surface)',
                border: `1px solid ${activeScen === key ? s.color : 'var(--fd-hairline)'}`,
                borderRadius: 0, color: activeScen === key ? s.color : M,
                textTransform: 'uppercase',
              }}>
                {s.shortLabel}
              </button>
            ))}
            <button onClick={() => setShowTable(t => !t)} style={{
              fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500,
              padding: '4px 10px', cursor: 'pointer',
              background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
              borderRadius: 0, color: M,
            }}>
              {showTable ? 'HIDE' : 'SHOW'}
            </button>
          </div>
        </div>

        {showTable && (
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 380 }}>
            <table className="bb-table" style={{ minWidth: 900 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
                <tr>
                  <th>AGE</th>
                  <th className="r">DIVS</th>
                  <th className="r">RMD</th>
                  <th className="r">CONV</th>
                  <th className="r">SS</th>
                  <th className="r">{activeScen === 'full' ? 'GROSS' : 'TOTAL INCOME'}</th>
                  <th className="r">FED TAX</th>
                  {collectMedicare && <th className="r">IRMAA</th>}
                  {activeScen === 'full' && <th className="r">AFTER-TAX</th>}
                  <th className="r">{activeScen === 'full' ? 'EFF RATE' : 'TAX DRAG'}</th>
                  <th className="r">MRG RATE</th>
                  <th className="r">ROLLOVER</th>
                  <th className="r">ROLLOVER %</th>
                  <th className="r">ROTH</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((r, i) => {
                  const isRmdStart = r.age === rmdStartAge
                  const isSsStart  = r.age === ssStartAge
                  return (
                    <tr key={i} style={{
                      background: isRmdStart ? 'var(--fd-card)' : isSsStart ? 'var(--fd-card)' : undefined,
                    }}>
                      <td style={{ fontWeight: (isRmdStart || isSsStart) ? 700 : 400, fontFamily: 'var(--font-mono)' }}>
                        {r.age}
                        {isRmdStart && <span style={{ fontSize: 12, color: A, marginLeft: 4 }}>★RMD</span>}
                        {isSsStart  && <span style={{ fontSize: 12, color: B, marginLeft: 4 }}>★SS</span>}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: G, fontSize: 12 }}>{fmtMoney(r.dividends)}</td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.rmd > 0 ? A : M, fontSize: 12 }}>
                        {r.rmd > 0 ? fmtMoney(r.rmd) : '—'}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.conversion > 0 ? G : M, fontSize: 12 }}>
                        {r.conversion > 0 ? fmtMoney(r.conversion) : '—'}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.ss_income > 0 ? B : M, fontSize: 12 }}>
                        {r.ss_income > 0 ? fmtMoney(r.ss_income) : '—'}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500 }}>{fmtMoney(r.gross_income)}</td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: R, fontWeight: 500, fontSize: 12 }}>{fmtMoney(r.federal_tax)}</td>
                      {collectMedicare && (
                        <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.irmaa > 0 ? 'var(--yellow)' : M, fontSize: 12 }}>
                          {r.irmaa > 0 ? fmtMoney(r.irmaa) : '—'}
                        </td>
                      )}
                      {activeScen === 'full' && (
                        <td className="r" style={{ fontFamily: 'var(--font-mono)', color: G, fontSize: 12 }}>
                          {fmtMoney(r.gross_income - r.federal_tax)}
                        </td>
                      )}
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.effective_rate >= 25 ? R : r.effective_rate >= 20 ? 'var(--yellow)' : G, fontWeight: r.effective_rate >= 25 ? 700 : 400, fontSize: 12 }}>
                        {r.effective_rate.toFixed(1)}%
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.marginal_rate >= 32 ? R : r.marginal_rate >= 24 ? 'var(--yellow)' : G, fontWeight: r.marginal_rate >= 32 ? 700 : 400, fontSize: 12 }}>
                        {r.marginal_rate.toFixed(0)}%
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.rollover_value <= 0 ? G : 'var(--text)', fontSize: 12 }}>
                        {r.rollover_value <= 0 ? 'DEPLETED' : fmtMoney(r.rollover_value)}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {(() => {
                          const total = r.rollover_value + r.roth_value
                          if (total <= 0) return '—'
                          const pct = (r.rollover_value / total) * 100
                          return (
                            <span style={{ color: pct >= 50 ? R : pct >= 25 ? 'var(--yellow)' : pct === 0 ? G : M, fontWeight: pct === 0 ? 700 : 400 }}>
                              {pct === 0 ? '0%' : `${pct.toFixed(0)}%`}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: G, fontWeight: 500, fontSize: 12 }}>{fmtMoney(r.roth_value)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Methodology footnote ── */}
      <div style={{ fontSize: 12, color: M, lineHeight: 1.6, borderTop: '1px solid var(--fd-hairline)', paddingTop: 8 }}>
        Assumptions: {(growthRate * 100).toFixed(0)}% annual portfolio growth (personal.json expected_return) · current-year tax brackets · 85% SS inclusion · dividends from server projection · filing status: {filingStatus}
        {collectMedicare
          ? ' · IRMAA included (Medicare Part B/D elected — Settings)'
          : ' · IRMAA excluded — Medicare not elected (enable in Settings → Medicare)'}
        {' · '}Projection: age {Math.floor(currentAge) + 1} → 90 · Brackets not inflation-adjusted (conservative)
      </div>
    </div>
  )
}
