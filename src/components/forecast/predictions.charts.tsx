import {
  AreaChart, Area, LineChart, Line, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import {
  BASE_C, BULL_C, BEAR_C, TARGET_C, EXP_C, TAX_C, M,
  SCENARIO_META,
  type Scenario, type Horizon, type ProjYear,
} from './predictions.constants'
import { fmtK, MoneyTooltip, SectionLabel } from './predictions.helpers'
import type { DashboardData } from '../../types/dashboard'

// Color shorthands used only in SummaryStatusBar
const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'

// ─── Legacy chart components (kept for advanced mode) ─────────────────────────

/** Chart A — used by advanced mode only */
export function GrowthChart({ chartData, regime }: {
  chartData: { year: number; base: number; bull: number; bear: number; target: number }[]
  regime?: string
}) {
  const regimeArea = regime === 'EXPANSION' ? 'var(--fd-card)'
    : regime === 'RISK-OFF' ? 'var(--fd-card)'
    : 'var(--fd-card)'
  const regimeBorder = regime === 'EXPANSION' ? BULL_C : regime === 'RISK-OFF' ? BEAR_C : 'transparent'
  const last = chartData[chartData.length - 1]
  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${regimeBorder}`, borderRadius: 0 }}>
      <SectionLabel sub={`Regime: ${regime ?? 'NEUTRAL'} · Solid = current · Dashed = target allocation`}>
        A. PORTFOLIO GROWTH — BASE / BULL / BEAR
      </SectionLabel>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 70 }}>
          <defs>
            <linearGradient id="bullGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={BULL_C}  stopOpacity={0.12} />
              <stop offset="95%" stopColor={BULL_C}  stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={BASE_C}  stopOpacity={0.12} />
              <stop offset="95%" stopColor={BASE_C}  stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id="bearGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={BEAR_C}  stopOpacity={0.10} />
              <stop offset="95%" stopColor={BEAR_C}  stopOpacity={0.01} />
            </linearGradient>
          </defs>
          {regime && regime !== 'CONSOLIDATION' && (
            <ReferenceArea x1={chartData[0]?.year} x2={chartData[chartData.length - 1]?.year} fill={regimeArea} />
          )}
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: M, fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: M, fontSize: 12 }} tickFormatter={fmtK} axisLine={false} tickLine={false} width={65} />
          <Tooltip content={<MoneyTooltip />} />
          <Area type="monotone" dataKey="bull"   name="Bull"           stroke={BULL_C}   fill="url(#bullGrad)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="base"   name="Base"           stroke={BASE_C}   fill="var(--fd-card)"  strokeWidth={2.5} dot={false} />
          <Area type="monotone" dataKey="bear"   name="Bear"           stroke={BEAR_C}   fill="url(#bearGrad)" strokeWidth={2} dot={false} />
          <Line  type="monotone" dataKey="target" name="Target (base)" stroke={TARGET_C} strokeDasharray="5 3"  strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
      {/* Endpoint legend — separate row so labels never collide */}
      {last && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 4, paddingRight: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: BULL_C, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>▲ BULL {fmtK(last.bull)}</span>
          <span style={{ fontSize: 12, color: BASE_C, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>— BASE {fmtK(last.base)}</span>
          <span style={{ fontSize: 12, color: BEAR_C, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>▼ BEAR {fmtK(last.bear)}</span>
          <span style={{ fontSize: 12, color: TARGET_C, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>◇ TARGET {fmtK(last.target)}</span>
        </div>
      )}
    </div>
  )
}

/** Chart B simplified (simple mode) */
export function IncomeExpensesChart({ chartData }: {
  chartData: { year: number; base: number; bull: number; bear: number; target?: number; expenses: number }[]
}) {
  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
      <SectionLabel sub="Income (all 3 scenarios) vs. Income Goal (inflation-adj.) vs. Lifestyle + inflation-adjusted expenses (forecast basis — higher than Cash Flow actual spending)">
        B. INCOME vs GOAL vs EXPENSES
      </SectionLabel>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 70 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: M, fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: M, fontSize: 12 }} tickFormatter={fmtK} axisLine={false} tickLine={false} width={65} />
          <Tooltip content={<MoneyTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="bull"     name="Income (Bull)"          stroke={BULL_C}   strokeWidth={2}   dot={false} />
          <Line type="monotone" dataKey="base"     name="Income (Base)"          stroke={BASE_C}   strokeWidth={2}   dot={false} />
          <Line type="monotone" dataKey="bear"     name="Income (Bear)"          stroke={BEAR_C}   strokeWidth={2}   dot={false} />
          <Line type="monotone" dataKey="target"   name="Income Goal (+2.5%/yr)" stroke={TARGET_C} strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
          <Line type="monotone" dataKey="expenses" name="Expenses"               stroke={EXP_C}    strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Chart D simplified — AGI + bracket step */
export function TaxBracketChart({ baseProj }: { baseProj: ProjYear[] }) {
  const data = baseProj.map(r => ({
    year: r.calYear, agi: r.grossIncome,
    tax: r.federalTax, bracket: (r.bracketSlices[r.bracketSlices.length - 1]?.rate ?? 0) * 100,
  }))
  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
      <SectionLabel sub="Projected AGI (bar) · Federal Tax (line) · Top bracket % (dashed) — base case">
        D. TAX BRACKET TRAJECTORY
      </SectionLabel>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={data} margin={{ top: 4, right: 50, bottom: 4, left: 70 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: M, fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="money" tick={{ fill: M, fontSize: 12 }} tickFormatter={fmtK} axisLine={false} tickLine={false} width={65} />
          <YAxis yAxisId="pct" orientation="right" tick={{ fill: M, fontSize: 12 }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} width={40} domain={[0, 40]} />
          <Tooltip content={<MoneyTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar  yAxisId="money" dataKey="agi"     name="AGI"           fill={BASE_C} fillOpacity={0.2} radius={[2,2,0,0]} />
          <Line yAxisId="money" dataKey="tax"     name="Fed Tax"       stroke={TAX_C}   strokeWidth={2}   dot={false} type="monotone" />
          <Line yAxisId="pct"   dataKey="bracket" name="Top Bracket %" stroke={EXP_C}   strokeWidth={1.5} strokeDasharray="4 3" dot={false} type="stepAfter" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Chart E simplified — cashflow as color-coded surplus/deficit table rows */
export function CashflowChart({ baseProj, bullProj, bearProj }: { baseProj: ProjYear[]; bullProj: ProjYear[]; bearProj: ProjYear[] }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
      <SectionLabel sub="Gross income − federal tax − lifestyle expenses. Green = surplus · Red = deficit.">
        E. NET CASHFLOW PROJECTION
      </SectionLabel>
      <table className="bb-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>YEAR</th>
            <th className="r">INCOME</th>
            <th className="r">TAX</th>
            <th className="r" title="Lifestyle + inflation-adjusted (forecast basis, not actual Cash Flow spending)">EXPENSES ⓘ</th>
            <th className="r" style={{ color: BASE_C }}>NET BASE</th>
            <th className="r" style={{ color: BULL_C }}>NET BULL</th>
            <th className="r" style={{ color: BEAR_C }}>NET BEAR</th>
            <th className="r">MO/BASE</th>
          </tr>
        </thead>
        <tbody>
          {baseProj.map((r, i) => {
            const bull = bullProj[i]; const bear = bearProj[i]
            const bc   = r.netCashflow >= 0 ? BULL_C : BEAR_C
            const bullC = (bull?.netCashflow ?? 0) >= 0 ? BULL_C : BEAR_C
            const bearC = (bear?.netCashflow ?? 0) >= 0 ? BULL_C : BEAR_C
            return (
              <tr key={r.calYear} style={{ background: r.netCashflow < 0 ? 'var(--fd-card)' : 'transparent' }}>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{r.calYear}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: BULL_C }}>{fmtK(r.grossIncome)}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: TAX_C }}>({fmtK(r.federalTax)})</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: EXP_C }}>({fmtK(r.expenses)})</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: bc }}>{r.netCashflow >= 0 ? '+' : ''}{fmtK(r.netCashflow)}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: bullC }}>{bull ? (bull.netCashflow >= 0 ? '+' : '') + fmtK(bull.netCashflow) : '—'}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: bearC }}>{bear ? (bear.netCashflow >= 0 ? '+' : '') + fmtK(bear.netCashflow) : '—'}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: M }}>{fmtK(r.netCashflow / 12)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Scenario Cards — Simple mode F */
export function ScenarioCards({ baseProj, bullProj, bearProj, horizon }: {
  baseProj: ProjYear[]; bullProj: ProjYear[]; bearProj: ProjYear[]; horizon: Horizon
}) {
  const idx  = horizon - 1
  const base = baseProj[idx], bull = bullProj[idx], bear = bearProj[idx]
  if (!base || !bull || !bear) return null

  const cards: { sc: Scenario; row: ProjYear }[] = [
    { sc: 'bull', row: bull },
    { sc: 'base', row: base },
    { sc: 'bear', row: bear },
  ]
  const risk: Record<Scenario, string> = { bull: 'LOW', base: 'MEDIUM', bear: 'HIGH' }

  return (
    <div>
      <SectionLabel>F. SCENARIO SUMMARY AT YEAR {horizon} ({base.calYear}, AGE {base.age})</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {cards.map(({ sc, row }) => {
          const meta = SCENARIO_META[sc]
          const cashColor = row.netCashflow >= 0 ? BULL_C : BEAR_C
          return (
            <div key={sc} style={{
              padding: '14px 16px', border: `1px solid ${meta.color}`,
              borderRadius: 0,
              background: `${meta.color}08`, display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: meta.color, letterSpacing: '1px' }}>
                  {meta.icon} {meta.label}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: meta.color, background: `${meta.color}20`, padding: '2px 6px', borderRadius: 0 }}>
                  RISK: {risk[sc]}
                </span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)', color: meta.color }}>
                {fmtK(row.portfolioValue)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { label: 'Annual Income',  val: row.grossIncome,   color: BULL_C },
                  { label: 'Federal Tax',    val: row.federalTax,    color: TAX_C },
                  { label: 'Net Cashflow',   val: row.netCashflow,   color: cashColor },
                  { label: 'LTCG 0% Room',  val: row.ltcgCapacity,  color: row.ltcgCapacity > 0 ? BULL_C : BEAR_C },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: M }}>{label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color }}>{fmtK(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Summary Status Bar ────────────────────────────────────────────────────────

export function SummaryStatusBar({ baseProj, data }: { baseProj: ProjYear[]; data: DashboardData }) {
  const fwd12m    = data.income_analytics?.portfolio_fwd_12m ?? 0
  const pi        = data.portfolio_intel

  // ── Projection metrics ──────────────────────────────────────────────────────
  const yr5  = baseProj[4]
  const yr1  = baseProj[0]
  const coverage5  = yr5 ? Math.round((yr5.annualIncome + yr5.ssIncome) / Math.max(yr5.expenses + yr5.federalTax, 1) * 100) : null
  const incomeGrow = yr1 && fwd12m > 0 ? Math.round(((yr1.annualIncome / fwd12m) - 1) * 100) : null
  const firstDeficit = baseProj.find(r => r.netCashflow < 0)
  const coverageColor = coverage5 != null ? (coverage5 >= 100 ? G : coverage5 >= 80 ? A : R) : M

  // ── Market state interpretation ─────────────────────────────────────────────
  const regime    = pi?.market_regime
  const volRegime = pi?.vol_regime
  const regimeColor = regime === 'EXPANSION' ? G : regime === 'RISK-OFF' ? R : A
  const regimeInterp =
    regime === 'EXPANSION'    && volRegime !== 'HIGH' ? 'Bull scenario has elevated probability · base likely underestimates growth'
    : regime === 'EXPANSION'  && volRegime === 'HIGH' ? 'Expansion with high vol — growth likely but with sharp pullbacks'
    : regime === 'RISK-OFF'                           ? 'Bear scenario probability elevated · stress-test cashflow and withdrawal plan'
    : regime === 'CONSOLIDATION'                      ? 'Range-bound · all three scenarios roughly equiprobable'
    : '—'

  // ── Fragility interpretation ────────────────────────────────────────────────
  const fragScore  = pi?.fragility_score ?? null
  const fragLevel  = pi?.fragility_level ?? null
  const durScore   = pi?.income_durability_score ?? null
  // stress_qqq_pct is already a percentage (e.g., -23.0 means -23%) — don't ×100
  const seqRiskPct = pi?.stress_qqq_pct != null ? Math.abs(pi.stress_qqq_pct).toFixed(1) : null

  const fragColor  = fragLevel === 'LOW' ? G : fragLevel === 'MODERATE' ? A : R
  const durColor   = durScore == null ? M : durScore >= 70 ? G : durScore >= 40 ? A : R
  const fragInterp =
    fragLevel === 'LOW'      ? 'Portfolio well-diversified · income streams resilient to shocks'
    : fragLevel === 'MODERATE' ? 'Moderate concentration · monitor option-income and CEF premiums'
    : fragLevel === 'HIGH'   ? 'High fragility · single-name or sector concentration risk elevated'
    : '—'

  return (
    <div style={{ borderBottom: '1px solid var(--fd-hairline)', display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Row 1 — Projection summary */}
      <div style={{ padding: '7px 14px', background: 'var(--fd-card)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: A, letterSpacing: '1px', whiteSpace: 'nowrap', paddingTop: 1 }}>
           PROJECTION
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 20px', flex: 1 }}>
          {coverage5 != null && (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: coverageColor }}>
              {coverage5 >= 100 ? '✔' : ''} Base income covers {coverage5}% of expenses + tax by {yr5?.calYear ?? '—'}
            </span>
          )}
          {incomeGrow != null && (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: incomeGrow >= 0 ? G : R }}>
              {incomeGrow >= 0 ? '✔' : ''} Investment income {incomeGrow >= 0 ? `+${incomeGrow}` : incomeGrow}% yr-1 base
            </span>
          )}
          {firstDeficit ? (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: R }}>
               Cashflow deficit projected in {firstDeficit.calYear}
            </span>
          ) : (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: G }}>
              ✔ No cashflow deficit in projection window
            </span>
          )}
        </div>
      </div>

      {/* Row 2 — Market state */}
      {regime && (
        <div style={{ padding: '5px 14px', background: `${regimeColor}06`, borderTop: '1px solid var(--fd-hairline)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: regimeColor, letterSpacing: '1px', whiteSpace: 'nowrap' }}>
             MARKET STATE
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: regimeColor, background: `${regimeColor}18`, padding: '1px 7px', border: `1px solid ${regimeColor}`, borderRadius: 0 }}>
            {regime}
          </span>
          {volRegime && (
            <span style={{ fontSize: 12, color: M }}>
              VOL: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: volRegime === 'HIGH' ? R : volRegime === 'LOW' ? G : M }}>{volRegime}</span>
            </span>
          )}
          <span style={{ fontSize: 12, color: regimeColor }}>→ {regimeInterp}</span>
        </div>
      )}

      {/* Row 3 — Fragility & income durability */}
      {(fragScore != null || durScore != null) && (
        <div style={{ padding: '5px 14px', background: `${fragColor}05`, borderTop: '1px solid var(--fd-hairline)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: fragColor, letterSpacing: '1px', whiteSpace: 'nowrap' }}>
             RISK PROFILE
          </div>
          {fragScore != null && (
            <span style={{ fontSize: 12, color: fragColor, fontFamily: 'var(--font-mono)' }}>
              FRAGILITY {fragScore}/100 <span style={{ fontWeight: 500 }}>[{fragLevel}]</span>
            </span>
          )}
          {durScore != null && (
            <span style={{ fontSize: 12, color: durColor, fontFamily: 'var(--font-mono)' }}>
              INCOME DURABILITY {durScore}/100
            </span>
          )}
          {seqRiskPct && (
            <span style={{ fontSize: 12, color: M }}>
              QQQ shock: <span style={{ fontFamily: 'var(--font-mono)', color: R }}>−{seqRiskPct}%</span> portfolio impact
            </span>
          )}
          <span style={{ fontSize: 12, color: M, fontStyle: 'italic' }}>{fragInterp}</span>
        </div>
      )}

    </div>
  )
}
