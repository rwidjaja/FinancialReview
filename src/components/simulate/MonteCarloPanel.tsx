import { useState, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts'
import { fmtMoneyFull } from '../../utils/formatters'
import { GaugeRing } from '../ui/Sparkline'
import { G, R, A, M, Y, roundTo2 } from './simTypes'
import { StatBox, InterpretationPanel } from './SimSharedComponents'
import type { SimDefaults } from './simTypes'
import { runSim } from './simTypes'
import { WsSection } from '../workspace/WorkspaceContext'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS, TOOLTIP_CURSOR } from '../ui/chartTooltip'

export function MonteCarloPanel({ defaults }: { defaults: SimDefaults }) {
  const [hasRun, setHasRun] = useState(false)
  const [baseline, setBaseline] = useState<{ result: any; params: any } | null>(null)
  const { mutate, data: result, isPending } = useMutation({ mutationFn: runSim })

  const buildParams = () => ({
    spending: defaults.spending,
    expected_return: roundTo2(defaults.expected_return),
    volatility: roundTo2(defaults.volatility),
    inflation: roundTo2(defaults.inflation),
    target_age: defaults.target_age,
  })

  const run = () => {
    setHasRun(true)
    mutate({ module: 'monte_carlo', params: buildParams() })
  }

  // Auto-re-run when target_age changes — but only after the first manual run
  const prevTargetAge = useRef(defaults.target_age)
  useEffect(() => {
    if (!hasRun) return
    if (defaults.target_age === prevTargetAge.current) return
    prevTargetAge.current = defaults.target_age
    mutate({ module: 'monte_carlo', params: buildParams() })
  }, [defaults.target_age]) // eslint-disable-line react-hooks/exhaustive-deps

  const getSuccessRate = (result: any, age?: number): number | null => {
    if (!result) return null
    if (age === 85) {
      const rate = result.success_rates?.['85'] ?? result.success_rate_85
      return rate !== undefined ? (rate > 1 ? rate : rate * 100) : null
    } else if (age === 90) {
      const rate = result.success_rates?.['90'] ?? result.success_rate_90
      return rate !== undefined ? (rate > 1 ? rate : rate * 100) : null
    } else if (age === 95) {
      const rate = result.success_rates?.['95'] ?? result.success_rate_95
      return rate !== undefined ? (rate > 1 ? rate : rate * 100) : null
    } else {
      const rate = result.overall_success ?? result.success_rate
      return rate !== undefined ? (rate > 1 ? rate : rate * 100) : null
    }
  }

  const successColor = (rate: number | null) => {
    if (rate === null) return M
    if (rate >= 90) return G
    if (rate >= 75) return Y
    return R
  }

  const overallRate = getSuccessRate(result)
  const rate85 = getSuccessRate(result, 85)
  const rate90 = getSuccessRate(result, 90)
  const rate95 = getSuccessRate(result, 95)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <WsSection id="sm_mc_run" value={isPending ? 'Running' : hasRun ? 'Done' : 'Not run'} status={hasRun && !isPending ? 'ok' : 'info'}>
      {/* Run button — params come from the shared parameter bar above */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={run} style={{
          padding: '8px 20px',
          background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, letterSpacing: '1px',
          borderRadius: 0,
        }}>
          {isPending ? '⟳ RUNNING…' : '▶ RUN LIFETIME PROJECTION'}
        </button>
        {result && !isPending && !result.error && (
          <button onClick={() => setBaseline({ result, params: buildParams() })} style={{
            padding: '8px 14px',
            background: 'transparent', color: M,
            border: `1px solid ${baseline ? 'var(--fd-hairline)' : 'var(--fd-hairline)'}`,
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.6px',
            borderRadius: 0,
          }}>
            {baseline ? '↺ UPDATE BASELINE' : '⊞ SAVE AS BASELINE'}
          </button>
        )}
        {baseline && (
          <button onClick={() => setBaseline(null)} style={{
            padding: '8px 10px', background: 'transparent', color: R,
            border: '1px solid var(--fd-hairline)', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 12, borderRadius: 0,
          }}>CLEAR BASELINE</button>
        )}
        <span style={{ fontSize: 12, color: M }}>
          Spending {fmtMoneyFull(defaults.spending)}/yr · Return {(defaults.expected_return * 100).toFixed(1)}% · Vol {(defaults.volatility * 100).toFixed(1)}% · Inflation {(defaults.inflation * 100).toFixed(1)}% · To age {defaults.target_age}
        </span>
      </div>

      {!hasRun && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: M, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          ADJUST PARAMETERS ABOVE AND CLICK RUN
        </div>
      )}
      {isPending && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: A }}>
          <div className="anim-blink" style={{ fontSize: 24 }}>█</div>
          <span style={{ marginLeft: 12, fontSize: 12, fontFamily: 'var(--font-mono)' }}>RUNNING 1,000 PATHS…</span>
        </div>
      )}
      </WsSection>
      {result && !isPending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {result.error ? (
            <WsSection id="sm_mc_success" value="Error" status="alert">
            <div style={{ color: R, fontSize: 12, padding: 12 }}>{result.error}</div>
            </WsSection>
          ) : (
            <>
              <WsSection id="sm_mc_success" value={overallRate != null ? `${Math.round(overallRate)}%` : undefined} status={overallRate == null ? undefined : overallRate >= 90 ? 'ok' : overallRate >= 75 ? 'watch' : 'alert'}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                {[
                  { label: 'SUCCESS OVERALL', rate: overallRate },
                  { label: 'SUCCESS TO 85', rate: rate85 },
                  { label: 'SUCCESS TO 90', rate: rate90 },
                  { label: 'SUCCESS TO 95', rate: rate95 },
                ].map(({ label, rate }) => (
                  <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 12px', textAlign: 'center' }}>
                    <div className="bb-label" style={{ marginBottom: 4 }}>{label}</div>
                    <GaugeRing value={rate ?? 0} color={successColor(rate)} size={52} label={rate !== null ? `${Math.round(rate)}%` : '—'} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                <StatBox label="MEDIAN ENDING WEALTH" value={fmtMoneyFull(result.median_ending ?? 0)} color={G} metricId="win_rate" />
                <StatBox label="25TH PERCENTILE" value={fmtMoneyFull(result.p25_ending ?? 0)} color={Y} metricId="sequence_risk" />
                <StatBox label="75TH PERCENTILE" value={fmtMoneyFull(result.p75_ending ?? 0)} color={G} />
              </div>
              </WsSection>
              {result.percentiles && (() => {
                const p10Path = result.percentiles['10'] ?? []
                const medPath = result.percentiles['50'] ?? []
                const p90Path = result.percentiles['90'] ?? []
                const len = Math.max(p10Path.length, medPath.length, p90Path.length)
                const chartData = Array.from({ length: len }, (_, i) => ({
                  yr: i,
                  p10: p10Path[i] != null ? Math.round(p10Path[i] / 1000) : undefined,
                  med: medPath[i] != null ? Math.round(medPath[i] / 1000) : undefined,
                  p90: p90Path[i] != null ? Math.round(p90Path[i] / 1000) : undefined,
                }))
                return (
                  <WsSection id="sm_mc_bands">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div className="bb-label">1,000-PATH FAN CHART ($K)</div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                          <span><span style={{ color: 'var(--green)' }}>■</span> P90</span>
                          <span><span style={{ color: 'var(--amber)' }}>■</span> Median</span>
                          <span><span style={{ color: 'var(--red)' }}>■</span> P10</span>
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={130}>
                        <LineChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                          <XAxis dataKey="yr" tick={{ fill: 'var(--text2)', fontSize: 12 }} label={{ value: 'Year', position: 'insideBottomRight', fill: 'var(--text2)', fontSize: 12 }} />
                          <YAxis tick={{ fill: 'var(--text2)', fontSize: 12 }} />
                          <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown) => [`$${v}K`]} />
                          <ReferenceLine y={0} stroke="var(--red)" strokeDasharray="3 3" />
                          <Line type="monotone" dataKey="p90" stroke="var(--fd-accent)" strokeWidth={1} dot={false} strokeOpacity={0.6} />
                          <Line type="monotone" dataKey="med" stroke="var(--fd-lilac-ink)" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="p10" stroke="var(--fd-negative)" strokeWidth={1} dot={false} strokeOpacity={0.6} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <InterpretationPanel title="LONGEVITY INTERPRETATION" items={[
                      { label: 'Sequence Risk Penalty', value: result.sequence_risk_pct != null ? `${(result.sequence_risk_pct * 100).toFixed(1)}%` : '—', color: R, note: 'Reduction in success rate from bad early returns vs. average-return scenario' },
                    ]} />
                  </div>
                  </WsSection>
                )
              })()}

              {/* ── What-If Delta Table ─────────────────────────────── */}
              {baseline && baseline.result && !baseline.result.error && (() => {
                const bRate    = baseline.result.overall_success ?? baseline.result.success_rate
                const bNorm    = bRate !== undefined ? (bRate > 1 ? bRate : bRate * 100) : null
                const cNorm    = overallRate
                const deltaRate = cNorm != null && bNorm != null ? cNorm - bNorm : null
                const bMedian  = baseline.result.median_ending ?? 0
                const cMedian  = result.median_ending ?? 0
                const bP25     = baseline.result.p25_ending ?? 0
                const cP25     = result.p25_ending ?? 0

                const fmtDelta = (v: number) => `${v >= 0 ? '+' : ''}${fmtMoneyFull(v)}`
                const fmtPctDelta = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp`
                const dColor = (v: number | null) => v == null ? M : v >= 0 ? G : R

                type DeltaRow = { metric: string; baseline: string; scenario: string; delta: string; deltaColor: string }
                const rows: DeltaRow[] = [
                  {
                    metric: 'Success Rate (overall)',
                    baseline: bNorm != null ? `${Math.round(bNorm)}%` : '—',
                    scenario: cNorm != null ? `${Math.round(cNorm)}%` : '—',
                    delta: fmtPctDelta(deltaRate),
                    deltaColor: dColor(deltaRate),
                  },
                  {
                    metric: 'Median Ending Wealth',
                    baseline: fmtMoneyFull(bMedian),
                    scenario: fmtMoneyFull(cMedian),
                    delta: fmtDelta(cMedian - bMedian),
                    deltaColor: dColor(cMedian - bMedian),
                  },
                  {
                    metric: '25th Pct Ending Wealth',
                    baseline: fmtMoneyFull(bP25),
                    scenario: fmtMoneyFull(cP25),
                    delta: fmtDelta(cP25 - bP25),
                    deltaColor: dColor(cP25 - bP25),
                  },
                  {
                    metric: 'Annual Spending',
                    baseline: fmtMoneyFull(baseline.params.spending),
                    scenario: fmtMoneyFull(buildParams().spending),
                    delta: fmtDelta(buildParams().spending - baseline.params.spending),
                    deltaColor: dColor(-(buildParams().spending - baseline.params.spending)),
                  },
                ]
                return (
                  <WsSection id="sm_mc_whatif" value={fmtPctDelta(deltaRate)} status={deltaRate == null ? 'info' : deltaRate >= 0 ? 'ok' : 'watch'}>
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px', borderLeft: '3px solid var(--amber)' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', color: M, marginBottom: 8 }}>
                      WHAT-IF COMPARISON — Baseline vs Scenario
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['METRIC', 'BASELINE', 'SCENARIO', 'DELTA'].map(h => (
                            <th key={h} style={{ textAlign: h === 'METRIC' ? 'left' : 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: M, paddingBottom: 6, letterSpacing: '0.05em' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => (
                          <tr key={row.metric} style={{ borderTop: '1px solid var(--fd-hairline)' }}>
                            <td style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fd-muted)', padding: '5px 0' }}>{row.metric}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: M, padding: '5px 0' }}>{row.baseline}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', padding: '5px 0' }}>{row.scenario}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: row.deltaColor, padding: '5px 0' }}>{row.delta}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </WsSection>
                )
              })()}
            </>
          )}
        </div>
      )}
    </div>
  )
}
