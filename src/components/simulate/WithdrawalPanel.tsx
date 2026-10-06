import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, Cell, LineChart, Line } from 'recharts'
import { fmtMoneyFull } from '../../utils/formatters'
import { PanelHeader, Divider } from '../ui/Terminal'
import { G, R, A, M } from './simTypes'
import type { SimDefaults } from './simTypes'
import { runSim } from './simTypes'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import { WsSection } from '../workspace/WorkspaceContext'

export function WithdrawalPanel({ defaults }: { defaults: SimDefaults }) {
  const { mutate, data: result, isPending } = useMutation({ mutationFn: runSim })

  const buildParams = () => ({
    spending: defaults.spending,
    expected_return: defaults.expected_return,
    volatility: defaults.volatility,
    inflation: defaults.inflation,
    target_age: defaults.target_age,
  })

  const run = () => mutate({ module: 'withdrawal', params: buildParams() })

  const prevTargetAge = useRef(defaults.target_age)
  useEffect(() => {
    if (result === undefined) return
    if (defaults.target_age === prevTargetAge.current) return
    prevTargetAge.current = defaults.target_age
    mutate({ module: 'withdrawal', params: buildParams() })
  }, [defaults.target_age]) // eslint-disable-line react-hooks/exhaustive-deps
  const COLORS = [G, A, 'var(--blue)', 'var(--purple, #9b59b6)', 'var(--orange, #e17055)']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <WsSection id="sm_wd_run" value={isPending ? 'Running' : result ? 'Done' : 'Not run'} status={result && !isPending ? 'ok' : 'info'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={run} style={{
          padding: '8px 20px',
          background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, letterSpacing: '1px',
          borderRadius: 0,
        }}>
          {isPending ? '⟳ RUNNING…' : '▶ COMPARE STRATEGIES'}
        </button>
        <span style={{ fontSize: 12, color: M }}>
          Income-First vs Total Return vs Tax-Optimized — which strategy maximizes long-run survival odds
        </span>
      </div>

      {isPending && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: A }}>
          <div className="anim-blink" style={{ fontSize: 24 }}>█</div>
          <span style={{ marginLeft: 12, fontSize: 12, fontFamily: 'var(--font-mono)' }}>COMPARING STRATEGIES…</span>
        </div>
      )}
      {!result && !isPending && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: M, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          CLICK COMPARE TO EVALUATE WITHDRAWAL STRATEGIES
        </div>
      )}
      </WsSection>
      {result && !isPending && (
        result.error ? (
          <WsSection id="sm_wd_compare" value="Error" status="alert">
          <div style={{ color: R, fontSize: 12, padding: 12 }}>{result.error}</div>
          </WsSection>
        ) : (() => {
          const strategies = Object.entries(result.strategies ?? {})
          const chartData = strategies.map(([key, s]: [string, any], i) => ({
            name: (s.label ?? key).replace(/_/g, ' '),
            success: parseFloat(((s.overall_success ?? 0) * 100).toFixed(1)),
            ending: Math.round((s.median_ending ?? 0) / 1000),
            isWinner: key === result.winner,
            color: COLORS[i] ?? M,
          }))
          const winner = strategies.find(([k]) => k === result.winner)
          const winnerData = winner?.[1] as any

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <WsSection id="sm_wd_compare" value={winnerData ? `${((winnerData.overall_success ?? 0) * 100).toFixed(1)}%` : undefined} status="ok">
              <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
                <div className="bb-label" style={{ marginBottom: 8 }}>STRATEGY COMPARISON — SUCCESS RATE (%)</div>
                <ResponsiveContainer width="100%" height={chartData.length * 34 + 16}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 50, top: 0, bottom: 0 }}>
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fill: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown) => [`${v}%`, 'Success']} />
                    <ReferenceLine x={90} stroke={G} strokeDasharray="3 3" />
                    <Bar dataKey="success" radius={0} label={{ position: 'right', fontSize: 12, fill: 'var(--text2)', formatter: (v: unknown) => `${v}%` }}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={d.isWinner ? 'var(--fd-accent)' : d.color as string} fillOpacity={d.isWinner ? 1 : 0.65} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {winnerData && (
                <div style={{ padding: '10px 14px', background: 'var(--fd-card)', border: `1px solid ${G}`, borderRadius: 0, display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ fontSize: 20 }}>★</span>
                  <div>
                    <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase' }}>BEST STRATEGY FOR YOUR PROFILE</div>
                    <div style={{ fontSize: 16, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>
                      {(winnerData.label ?? result.winner ?? '').replace(/_/g, ' ').toUpperCase()}
                    </div>
                    {winnerData.description && <div style={{ fontSize: 12, color: M, marginTop: 2, lineHeight: 1.4 }}>{winnerData.description}</div>}
                  </div>
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div style={{ fontSize: 22, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>
                      {((winnerData.overall_success ?? 0) * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 12, color: M }}>SUCCESS RATE</div>
                  </div>
                </div>
              )}
              </WsSection>

              <WsSection id="sm_wd_strategies" value={`${strategies.length} strategies`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                {strategies.map(([key, s]: [string, any], i) => {
                  const c = COLORS[i] ?? M
                  const successPct = (s.overall_success ?? 0) * 100
                  const best = key === result.winner
                  return (
                    <div key={key} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderTop: `3px solid ${c}`, padding: '10px 12px' }}>
                      <PanelHeader>{(s.label ?? key).toUpperCase()}</PanelHeader>
                      {best && <div style={{ fontSize: 12, color: G, marginBottom: 2 }}>★ RECOMMENDED</div>}
                      <div style={{ fontSize: 20, fontWeight: 500, color: c, margin: '3px 0' }}>{successPct.toFixed(1)}%</div>
                      <div className="bb-sub">SUCCESS RATE</div>
                      <Divider />
                      <div style={{ fontSize: 14, fontWeight: 500, color: G }}>{fmtMoneyFull(s.median_ending ?? 0)}</div>
                      <div className="bb-sub">MEDIAN ENDING</div>
                      {s.p10_ending != null && <div style={{ fontSize: 12, color: R, marginTop: 2 }}>P10: {fmtMoneyFull(s.p10_ending)}</div>}
                      {s.description && <div style={{ fontSize: 12, color: M, marginTop: 4, lineHeight: 1.4 }}>{s.description}</div>}
                      {s.median_path && s.median_path.length > 1 && (() => {
                        const pathData = s.median_path.map((v: number, idx: number) => ({ yr: idx, val: Math.round(v / 1000) }))
                        return (
                          <div style={{ marginTop: 6 }}>
                            <ResponsiveContainer width="100%" height={40}>
                              <LineChart data={pathData} margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
                                <Line type="monotone" dataKey="val" stroke={c} strokeWidth={1.5} dot={false} />
                                <ReferenceLine y={0} stroke={R} strokeDasharray="2 2" />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )
                      })()}
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
