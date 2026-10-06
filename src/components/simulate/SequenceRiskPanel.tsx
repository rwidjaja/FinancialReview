import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, Cell } from 'recharts'
import { fmtMoneyFull } from '../../utils/formatters'
import { MiniBar } from '../ui/Sparkline'
import { G, R, A, M, Y } from './simTypes'
import { InterpretationPanel, SequenceRiskMeter } from './SimSharedComponents'
import type { SimDefaults } from './simTypes'
import { runSim } from './simTypes'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import { WsSection } from '../workspace/WorkspaceContext'

export function SequenceRiskPanel({ defaults }: { defaults: SimDefaults }) {
  const { mutate, data: result, isPending } = useMutation({ mutationFn: runSim })

  const buildParams = () => ({
    spending: defaults.spending,
    expected_return: defaults.expected_return,
    volatility: defaults.volatility,
    inflation: defaults.inflation,
    target_age: defaults.target_age,
  })

  const run = () => mutate({ module: 'sequence_risk', params: buildParams() })

  const prevTargetAge = useRef(defaults.target_age)
  useEffect(() => {
    if (result === undefined) return
    if (defaults.target_age === prevTargetAge.current) return
    prevTargetAge.current = defaults.target_age
    mutate({ module: 'sequence_risk', params: buildParams() })
  }, [defaults.target_age]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <WsSection id="sm_seq_run" value={isPending ? 'Running' : result ? 'Done' : 'Not run'} status={result && !isPending ? 'ok' : 'info'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={run} style={{
          padding: '8px 20px',
          background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, letterSpacing: '1px',
          borderRadius: 0,
        }}>
          {isPending ? '⟳ RUNNING…' : '▶ RUN SEQUENCE STRESS TEST'}
        </button>
        <span style={{ fontSize: 12, color: M }}>
          Compare 6 historical scenarios: bad-start, 2008 crash, dot-com bust, stagflation, and secular bull — vs baseline
        </span>
      </div>

      {isPending && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: A }}>
          <div className="anim-blink" style={{ fontSize: 24 }}>█</div>
          <span style={{ marginLeft: 12, fontSize: 12, fontFamily: 'var(--font-mono)' }}>RUNNING STRESS SCENARIOS…</span>
        </div>
      )}
      {!result && !isPending && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: M, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          CLICK RUN TO COMPARE HISTORICAL SEQUENCE SCENARIOS
        </div>
      )}
      </WsSection>
      {result && !isPending && (
        result.error ? (
          <WsSection id="sm_seq_scenarios" value="Error" status="alert">
          <div style={{ color: R, fontSize: 12, padding: 12 }}>{result.error}</div>
          </WsSection>
        ) : (() => {
          const scenarios = Object.entries(result.scenarios ?? {})
          const basePct = (result.scenarios?.normal?.overall_success ?? 0) * 100
          const chartData = scenarios.map(([key, s]: [string, any]) => ({
            name: (s.label ?? key).replace(/_/g, ' '),
            success: parseFloat(((s.overall_success ?? 0) * 100).toFixed(1)),
            isBase: key === 'normal',
          }))
          const worstScenario = scenarios.reduce((prev, [key, s]: [string, any]) =>
            key !== 'normal' && (s.overall_success ?? 1) < ((prev[1] as any)?.overall_success ?? 1) ? [key, s] : prev
          , scenarios[0] ?? ['', {}])
          const worstPct = ((worstScenario[1] as any)?.overall_success ?? 0) * 100
          const penalty = basePct - worstPct
          const penaltyColor = penalty > 20 ? R : penalty > 10 ? A : G

          const seqRiskPct = penalty > 0 ? penalty / 100 : 0

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <WsSection id="sm_seq_scenarios" value={`${basePct.toFixed(0)}% base`} status={basePct >= 90 ? 'ok' : basePct >= 75 ? 'watch' : 'alert'}>
              <SequenceRiskMeter seqRiskPct={seqRiskPct} />
              <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
                <div className="bb-label" style={{ marginBottom: 8 }}>SUCCESS RATE BY SCENARIO (%)</div>
                <ResponsiveContainer width="100%" height={chartData.length * 32 + 16}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 50, top: 0, bottom: 0 }}>
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fill: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown) => [`${v}%`, 'Success Rate']} />
                    <ReferenceLine x={basePct} stroke={A} strokeDasharray="3 3" />
                    <Bar dataKey="success" radius={0} label={{ position: 'right', fontSize: 12, fill: 'var(--text2)', formatter: (v: unknown) => `${v}%` }}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={d.isBase ? 'var(--fd-lilac-ink)' : d.success >= 90 ? 'var(--fd-accent)' : d.success >= 75 ? 'var(--fd-ink)' : 'var(--fd-negative)'} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </WsSection>

              <WsSection id="sm_seq_penalty" value={`−${penalty.toFixed(1)}%`} status={penalty > 20 ? 'alert' : penalty > 10 ? 'watch' : 'ok'}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 12px' }}>
                  <div className="bb-label">SEQUENCE RISK PENALTY (WORST CASE)</div>
                  <div style={{ fontSize: 22, fontWeight: 500, color: penaltyColor, fontFamily: 'var(--font-mono)', margin: '4px 0' }}>
                    −{penalty.toFixed(1)}%
                  </div>
                  <MiniBar value={Math.min(100, penalty * 2)} color={penaltyColor} height={5} />
                  <div style={{ fontSize: 12, color: M, marginTop: 3 }}>
                    {penalty > 20 ? 'Severe — sequence timing is critical to survival' : penalty > 10 ? 'Moderate — bad timing hurts but recoverable' : 'Low — portfolio resilient to sequence variation'}
                  </div>
                </div>
                <InterpretationPanel title="SEQUENCE RISK INTERPRETATION" items={[
                  { label: 'Baseline Success', value: `${basePct.toFixed(1)}%`, color: G },
                  { label: 'Worst Scenario', value: `${worstPct.toFixed(1)}%`, color: penaltyColor },
                  { label: 'Max Penalty', value: `−${penalty.toFixed(1)}%`, color: penaltyColor, note: 'Retire into a bad sequence and success drops this much' },
                ]} />
              </div>
              </WsSection>

              <WsSection id="sm_seq_detail" value={`${scenarios.length} scenarios`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {scenarios.map(([key, s]: [string, any]) => {
                  const isBase = key === 'normal'
                  const successPct = (s.overall_success ?? 0) * 100
                  const diffVsBase = isBase ? 0 : successPct - basePct
                  const c = successPct >= 90 ? G : successPct >= 75 ? Y : R
                  return (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr', gap: 8 }}>
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${isBase ? A : c}`, borderRadius: 0, padding: '8px 12px' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: isBase ? A : 'var(--text)', textTransform: 'uppercase' }}>{s.label ?? key}</div>
                        <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{isBase ? 'BASELINE' : (s.description ?? '')}</div>
                      </div>
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
                        <div className="bb-label">SUCCESS</div>
                        <div style={{ fontSize: 16, fontWeight: 500, color: c }}>{successPct.toFixed(1)}%</div>
                        {!isBase && <div style={{ fontSize: 12, color: diffVsBase >= 0 ? G : R }}>{diffVsBase >= 0 ? '+' : ''}{diffVsBase.toFixed(1)}% vs base</div>}
                      </div>
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
                        <div className="bb-label">MEDIAN ENDING</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: G }}>{fmtMoneyFull(s.median_ending ?? 0)}</div>
                        {s.p10_ending != null && <div style={{ fontSize: 12, color: R }}>P10: {fmtMoneyFull(s.p10_ending)}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
              </WsSection>
            </div>
          )
        })()
      )}
    </div>
  )
}
