import {
  AreaChart, Area, Line,
  XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import {
  BASE_C, BULL_C, BEAR_C, TARGET_C, EXP_C, TAX_C, M, DIM,
  SCENARIO_META, HORIZONS,
  type Scenario, type Horizon, type ProjYear,
} from './predictions.constants'
import { fmtK, MoneyTooltip } from './predictions.helpers'

// ─── Simple Mode Components (new) ─────────────────────────────────────────────

export function BigMetric({ label, value, sub, color }: {
  label: string; value: string; sub: string; color: string; border?: boolean
}) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--fd-hairline)',
      borderRadius: 0,
      padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 500, color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: M, lineHeight: 1.4 }}>{sub}</div>
    </div>
  )
}

export function ScenarioHero({ proj, scenario, horizon, todayVal, fwd12m }: {
  proj: ProjYear[]; scenario: Scenario; horizon: Horizon
  todayVal: number; fwd12m: number
}) {
  const meta = SCENARIO_META[scenario]
  const yr   = proj[horizon - 1]
  if (!yr) return null

  const valueGrowth  = (yr.portfolioValue - todayVal) / todayVal
  const incomeGrowth = fwd12m > 0 ? (yr.annualIncome - fwd12m) / fwd12m : 0
  const monthly      = yr.netCashflow / 12

  // Use a ±0.5% dead-band so we never say "falls" while showing "−0%"
  const incomeDir = Math.abs(incomeGrowth) < 0.005 ? 'stays flat at'
    : incomeGrowth > 0 ? 'rises to' : 'falls to'
  const incomePctStr = Math.abs(incomeGrowth * 100) < 0.5
    ? '≈0% vs today'
    : `${incomeGrowth >= 0 ? '+' : ''}${(incomeGrowth * 100).toFixed(0)}% vs today`
  // Conversion note: base scenario AGI includes Roth conversion income which drives higher tax
  const convNote = yr.convIncome > 0
    ? ` Includes ${fmtK(yr.convIncome)} Roth conversion → AGI ${fmtK(yr.grossIncome)} → ${(yr.effectiveRate * 100).toFixed(0)}% eff. tax rate.`
    : ''

  const narrative =
    scenario === 'bull'
      ? `At elevated growth rates, your portfolio surges to ${fmtK(yr.portfolioValue)} — ${fmtK(yr.portfolioValue - todayVal)} above today in ${horizon} years. Dividend income climbs to ${fmtK(yr.annualIncome)}/yr (${fmtK(yr.annualIncome / 12)}/mo). After tax and expenses, net surplus reaches ${fmtK(yr.netCashflow)}/yr. Watch for higher tax bracket exposure — federal tax reaches ${fmtK(yr.federalTax)}.`
    : scenario === 'bear'
      ? `Under a bear scenario, portfolio value ${valueGrowth >= 0 ? 'still grows to' : 'contracts to'} ${fmtK(yr.portfolioValue)}${valueGrowth < 0 ? ` — ${fmtK(todayVal - yr.portfolioValue)} below today` : ''}. Dividend income compresses to ${fmtK(yr.annualIncome)}/yr. ${yr.netCashflow >= 0 ? `Cashflow stays positive at ${fmtK(yr.netCashflow)}/yr — portfolio is resilient.` : `Cashflow goes negative at ${fmtK(yr.netCashflow)}/yr — principal drawdown required. Stress-test your withdrawal plan.`}`
      : `At historical-average returns, your portfolio ${valueGrowth >= 0 ? 'grows' : 'declines'} to ${fmtK(yr.portfolioValue)} in ${horizon} years (${valueGrowth >= 0 ? '+' : ''}${(valueGrowth * 100).toFixed(0)}%). Dividend income ${incomeDir} ${fmtK(yr.annualIncome)}/yr (${fmtK(yr.annualIncome / 12)}/mo).${convNote} ${yr.netCashflow >= 0 ? `After expenses and tax, you run a surplus of ${fmtK(yr.netCashflow)}/yr.` : `Cashflow turns negative against ${yr.expenseBasis === 'plan' ? 'plan spending from Settings' : 'tracked spending'} (${fmtK(yr.expenses)}/yr) — you'd draw ${fmtK(Math.abs(yr.netCashflow))}/yr from principal.`}`

  const metrics = [
    { label: 'PORTFOLIO VALUE', value: fmtK(yr.portfolioValue), sub: `${valueGrowth >= 0 ? '+' : ''}${(valueGrowth * 100).toFixed(0)}% from ${fmtK(todayVal)} today`, color: meta.color },
    { label: 'DIV. INCOME',     value: fmtK(yr.annualIncome),   sub: `${fmtK(yr.annualIncome / 12)}/mo · ${incomePctStr}`, color: BULL_C },
    { label: 'NET CASHFLOW',    value: fmtK(yr.netCashflow),    sub: `${fmtK(monthly)}/mo ${yr.netCashflow >= 0 ? 'surplus' : ' DEFICIT'} · vs ${yr.expenseBasis === 'plan' ? 'plan spend (Settings)' : 'tracked spend'} ${fmtK(yr.expenses)}`, color: yr.netCashflow >= 0 ? BULL_C : BEAR_C },
    { label: 'FEDERAL TAX',     value: fmtK(yr.federalTax),     sub: `${(yr.effectiveRate * 100).toFixed(1)}% eff · AGI ${fmtK(yr.grossIncome)}${yr.convIncome > 0 ? ` (incl. ${fmtK(yr.convIncome)} conv.)` : ''}`, color: TAX_C },
    ...(yr.ssIncome > 0 ? [{ label: 'SS INCOME', value: fmtK(yr.ssIncome), sub: 'Social Security included in gross', color: BULL_C }] : []),
    ...(yr.ltcgCapacity > 0 ? [{ label: 'LTCG 0% ROOM', value: fmtK(yr.ltcgCapacity), sub: 'harvest window open', color: yr.ltcgCapacity > 20_000 ? BULL_C : EXP_C }] : []),
  ]

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${meta.color}80`, borderRadius: 0, overflow: 'hidden', flexShrink: 0 }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--fd-hairline)', background: `${meta.color}06`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: meta.color, letterSpacing: '1.5px', fontFamily: 'var(--font-mono)' }}>
            ◈ {meta.label} SCENARIO
          </span>
          <span style={{ fontSize: 12, color: M }}>{meta.desc}</span>
        </div>
        <span style={{ fontSize: 12, color: meta.color, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
          {horizon}Y OUTLOOK · {yr.calYear} · AGE {yr.age}
        </span>
      </div>
      {/* Big metrics grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(metrics.length, 4)}, 1fr)`,
        gap: 8,
        padding: '10px 12px',
      }}>
        {metrics.map((m) => (
          <BigMetric key={m.label} {...m} />
        ))}
      </div>
      {/* Narrative */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--fd-hairline)',
        fontSize: 12, color: 'var(--text)', lineHeight: 1.7,
        background: `${meta.color}04` }}>
        {narrative}
      </div>
    </div>
  )
}

export function YearMilestones({ projs, scenario, horizon, onHorizonChange }: {
  projs: Record<Scenario, ProjYear[]>; scenario: Scenario
  horizon: Horizon; onHorizonChange: (h: Horizon) => void
}) {
  const meta = SCENARIO_META[scenario]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
      {HORIZONS.map((h) => {
        const yr = projs[scenario][h - 1]
        if (!yr) return null
        const isSelected = h === horizon
        return (
          <button key={h} onClick={() => onHorizonChange(h)} style={{
            border: `1px solid ${isSelected ? meta.color : 'var(--fd-hairline)'}`,
            borderRadius: 0,
            background: isSelected ? `${meta.color}12` : 'var(--fd-card)',
            padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
            display: 'flex', flexDirection: 'column', gap: 3, outline: 'none',
          }}>
            <div style={{ fontSize: 12, color: isSelected ? meta.color : M, fontWeight: 500, letterSpacing: '0.8px' }}>
              {h}Y · {yr.calYear} · AGE {yr.age}
            </div>
            <div style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)',
              color: isSelected ? meta.color : 'var(--text)', lineHeight: 1 }}>
              {fmtK(yr.portfolioValue)}
            </div>
            <div style={{ fontSize: 12, color: M }}>{fmtK(yr.annualIncome)}/yr income</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: yr.netCashflow >= 0 ? BULL_C : BEAR_C }}>
              {yr.netCashflow >= 0 ? '+' : ''}{fmtK(yr.netCashflow)} net
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function ScenarioFanChart({ chartData, scenario, horizon, todayYr }: {
  chartData: { year: number; base: number; bull: number; bear: number; target: number }[]
  scenario: Scenario; horizon: Horizon; todayYr: number
}) {
  const meta     = SCENARIO_META[scenario]
  const horizonYr = todayYr + horizon
  const last     = chartData[chartData.length - 1]
  type Row = typeof chartData[0]

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <XAxis dataKey="year" tick={{ fill: M, fontSize: 12, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: M, fontSize: 12, fontFamily: 'var(--font-mono)' }} tickFormatter={fmtK} axisLine={false} tickLine={false} width={65} />
          <Tooltip content={<MoneyTooltip />} />
          <ReferenceLine x={horizonYr} stroke={meta.color} strokeDasharray="4 4" strokeWidth={1.5}
            label={{ value: `${horizon}Y`, fill: meta.color, fontSize: 12, position: 'insideTopRight' }} />
          {/* Ghost lines for non-selected scenarios */}
          {scenario !== 'bull' && <Line type="monotone" dataKey="bull" stroke={BULL_C} strokeWidth={1} dot={false} strokeOpacity={0.22} strokeDasharray="4 3" name="Bull" />}
          {scenario !== 'bear' && <Line type="monotone" dataKey="bear" stroke={BEAR_C} strokeWidth={1} dot={false} strokeOpacity={0.22} strokeDasharray="4 3" name="Bear" />}
          {scenario !== 'base' && <Line type="monotone" dataKey="base" stroke={BASE_C} strokeWidth={1} dot={false} strokeOpacity={0.22} strokeDasharray="4 3" name="Base" />}
          {/* Selected scenario — bold fill */}
          <Area type="monotone" dataKey={scenario as keyof Row} name={meta.label}
            stroke={meta.color} fill="none" strokeWidth={3} dot={false} />
          {/* Target allocation reference */}
          <Line type="monotone" dataKey="target" name="Target Alloc"
            stroke={TARGET_C} strokeDasharray="5 3" strokeWidth={1.5} dot={false} strokeOpacity={0.6} />
        </AreaChart>
      </ResponsiveContainer>
      {last && (
        <div style={{ display: 'flex', gap: 18, marginTop: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {scenario !== 'bull' && <span style={{ fontSize: 12, color: BULL_C, opacity: 0.45, fontFamily: 'var(--font-mono)' }}>BULL {fmtK(last.bull)}</span>}
          {scenario !== 'base' && <span style={{ fontSize: 12, color: BASE_C, opacity: 0.45, fontFamily: 'var(--font-mono)' }}>BASE {fmtK(last.base)}</span>}
          {scenario !== 'bear' && <span style={{ fontSize: 12, color: BEAR_C, opacity: 0.45, fontFamily: 'var(--font-mono)' }}>BEAR {fmtK(last.bear)}</span>}
          <span style={{ fontSize: 12, color: meta.color, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
            ▶ {meta.label} {fmtK((last as Record<string, number>)[scenario])}
          </span>
          <span style={{ fontSize: 12, color: TARGET_C, opacity: 0.6, fontFamily: 'var(--font-mono)' }}>TARGET {fmtK(last.target)}</span>
        </div>
      )}
    </div>
  )
}

export function YearProjectionTable({ proj, scenario }: { proj: ProjYear[]; scenario: Scenario }) {
  const meta = SCENARIO_META[scenario]
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="bb-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>YEAR</th><th style={{ color: M, fontSize: 12 }}>AGE</th>
            <th className="r" style={{ color: meta.color }}>VALUE</th>
            <th className="r">INCOME</th>
            <th className="r">SS</th>
            <th className="r" style={{ color: TAX_C }}>TAX</th>
            <th className="r" style={{ color: EXP_C }}>EXPENSES{proj[0]?.expenseBasis === 'plan' ? ' (PLAN)' : ' (TRACKED)'}</th>
            <th className="r">NET / YR</th>
            <th className="r">/ MO</th>
          </tr>
        </thead>
        <tbody>
          {proj.map((r, i) => {
            const prev    = proj[i - 1]
            const ssStart = r.ssIncome > 0 && (!prev || prev.ssIncome === 0)
            const nc      = r.netCashflow
            return (
              <tr key={r.calYear} style={{
                background: 'transparent', boxShadow: ssStart ? 'inset 4px 0 0 var(--as-lilac)' : undefined,
              }}>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {r.calYear}
                  {ssStart && <span style={{ fontSize: 12, color: BULL_C, marginLeft: 4 }}>SS↑</span>}
                </td>
                <td style={{ color: M, fontSize: 12 }}>{r.age}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: meta.color, fontWeight: 500 }}>{fmtK(r.portfolioValue)}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: BULL_C }}>{fmtK(r.annualIncome)}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: r.ssIncome > 0 ? BULL_C : DIM, fontSize: 12 }}>
                  {r.ssIncome > 0 ? fmtK(r.ssIncome) : '—'}
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: TAX_C }}>({fmtK(r.federalTax)})</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: EXP_C }}>({fmtK(r.expenses)})</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: nc >= 0 ? BULL_C : BEAR_C }}>
                  {nc >= 0 ? '+' : ''}{fmtK(nc)}
                </td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)', color: M, fontSize: 12 }}>
                  {fmtK(nc / 12)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ScenarioComparison({ projs, horizon, scenario, todayVal }: {
  projs: Record<Scenario, ProjYear[]>; horizon: Horizon
  scenario: Scenario; todayVal: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* 3 individual rounded cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {(['bear', 'base', 'bull'] as Scenario[]).map((sc) => {
          const yr   = projs[sc][horizon - 1]
          if (!yr) return null
          const meta = SCENARIO_META[sc]
          const sel  = sc === scenario
          const growth = (yr.portfolioValue - todayVal) / todayVal
          return (
            <div key={sc} style={{
              background: sel ? `${meta.color}08` : 'var(--surface)',
              border: sel ? `1px solid ${meta.color}60` : '1px solid rgba(255,255,255,0.07)',
              borderTop: `3px solid ${meta.color}${sel ? '' : '60'}`,
              borderRadius: 0,
              padding: '12px 14px',
              display: 'flex', flexDirection: 'column', gap: 0,
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: meta.color, fontFamily: 'var(--font-mono)' }}>
                  {meta.icon} {meta.label}
                </span>
                <span style={{ fontSize: 12, color: meta.color, background: `${meta.color}18`,
                  padding: '1px 6px', border: `1px solid ${meta.color}40`, borderRadius: 0 }}>
                  {growth >= 0 ? '+' : ''}{(growth * 100).toFixed(0)}%
                </span>
              </div>
              {/* Portfolio value */}
              <div style={{ fontSize: 26, fontWeight: 500, fontFamily: 'var(--font-mono)',
                color: meta.color, lineHeight: 1, marginBottom: 10 }}>
                {fmtK(yr.portfolioValue)}
              </div>
              {/* Metrics */}
              {[
                { label: 'Div. Income',  val: yr.annualIncome,      color: BULL_C },
                ...(yr.convIncome > 0 ? [{ label: '+ Roth Conv.', val: yr.convIncome, color: TAX_C }] : []),
                { label: 'Federal Tax',  val: yr.federalTax,        color: TAX_C },
                { label: 'Net Cashflow', val: yr.netCashflow,       color: yr.netCashflow >= 0 ? BULL_C : BEAR_C },
                { label: 'Monthly Net',  val: yr.netCashflow / 12,  color: yr.netCashflow >= 0 ? BULL_C : BEAR_C },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: M }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color }}>{fmtK(val)}</span>
                </div>
              ))}
              {/* Description */}
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8, lineHeight: 1.5,
                borderTop: '1px solid var(--fd-hairline)', paddingTop: 6 }}>
                {meta.desc}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
