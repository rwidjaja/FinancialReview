import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import { MiniBar } from '../ui/Sparkline'
import { G, R, A, M, Y } from './simTypes'
import { StatBox } from './SimSharedComponents'
import type { SimDefaults } from './simTypes'
import { runSim } from './simTypes'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'

export function SpendingRangePanel({ defaults }: { defaults: SimDefaults }) {
  const { mutate, data: result, isPending } = useMutation({ mutationFn: runSim })

  const buildParams = () => ({
    spending: defaults.spending,
    expected_return: defaults.expected_return,
    volatility: defaults.volatility,
    inflation: defaults.inflation,
    target_age: defaults.target_age,
  })

  const run = () => mutate({ module: 'spending_range', params: buildParams() })

  const prevTargetAge = useRef(defaults.target_age)
  useEffect(() => {
    if (result === undefined) return
    if (defaults.target_age === prevTargetAge.current) return
    prevTargetAge.current = defaults.target_age
    mutate({ module: 'spending_range', params: buildParams() })
  }, [defaults.target_age]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={run} style={{
          padding: '8px 20px',
          background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, letterSpacing: '1px',
          borderRadius: 0,
        }}>
          {isPending ? '⟳ RUNNING…' : '▶ COMPUTE SPENDING RANGE'}
        </button>
        <span style={{ fontSize: 12, color: M }}>
          Grid-search 20 levels — safe (&gt;90% success), comfortable (75–90%), aggressive · current: <span style={{ color: A, fontWeight: 500 }}>{fmtMoneyFull(defaults.spending)}/yr</span>
        </span>
      </div>

      {isPending && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: A }}>
          <div className="anim-blink" style={{ fontSize: 24 }}>█</div>
          <span style={{ marginLeft: 12, fontSize: 12, fontFamily: 'var(--font-mono)' }}>COMPUTING SPENDING RANGE…</span>
        </div>
      )}
      {!result && !isPending && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: M, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          CLICK COMPUTE TO FIND SAFE SPENDING THRESHOLDS
        </div>
      )}
      {result && !isPending && (
        result.error ? (
          <div style={{ color: R, fontSize: 12, padding: 12 }}>{result.error}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              <StatBox label="SAFE SPENDING (≥95%)"    value={fmtMoneyFull(result.thresholds?.safe?.spending ?? 0)}        color={G} metricId="safe_spending" />
              <StatBox label="COMFORTABLE (≥85%)"      value={fmtMoneyFull(result.thresholds?.comfortable?.spending ?? 0)} color={Y} metricId="withdrawal_rate" />
              <StatBox label="AGGRESSIVE (≥70%)"       value={fmtMoneyFull(result.thresholds?.aggressive?.spending ?? 0)}  color={R} />
              <StatBox label="CURRENT SUCCESS RATE"    value={result.current_prob != null ? `${(result.current_prob * 100).toFixed(1)}%` : '—'}
                color={result.current_prob != null ? (result.current_prob >= 0.95 ? G : result.current_prob >= 0.85 ? Y : R) : M} metricId="win_rate" />
            </div>

            {(result.spending_levels ?? []).length > 0 && (() => {
              const levels = result.spending_levels ?? []
              const probs = result.success_probs ?? []
              const currentSpend = result.current_spending ?? defaults.spending
              const chartData = levels.map((lvl: number, i: number) => ({
                spending: Math.round(lvl / 1000),
                success: parseFloat(((probs[i] ?? 0) * 100).toFixed(1)),
                isCurrent: Math.abs(lvl - currentSpend) < 2000,
              }))
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
                    <div className="bb-label" style={{ marginBottom: 8 }}>SPENDING vs SUCCESS CURVE ($K/yr)</div>
                    <ResponsiveContainer width="100%" height={140}>
                      <LineChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                        <XAxis dataKey="spending" tick={{ fill: 'var(--text2)', fontSize: 12 }} label={{ value: '$K/yr', position: 'insideBottomRight', fill: 'var(--text2)', fontSize: 12 }} />
                        <YAxis domain={[0, 100]} tick={{ fill: 'var(--text2)', fontSize: 12 }} />
                        <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR} formatter={(v: unknown) => [`${v}%`, 'Success']} labelFormatter={(l: unknown) => `$${l}K/yr`} />
                        <ReferenceLine y={95} stroke={G} strokeDasharray="3 3" label={{ value: 'Safe 95%', fill: G, fontSize: 12 }} />
                        <ReferenceLine y={85} stroke={Y} strokeDasharray="3 3" label={{ value: 'OK 85%', fill: Y, fontSize: 12 }} />
                        {chartData.find(d => d.isCurrent) && (
                          <ReferenceLine x={chartData.find(d => d.isCurrent)!.spending} stroke={A} strokeDasharray="3 3" label={{ value: 'Current', fill: A, fontSize: 12 }} />
                        )}
                        <Line type="monotone" dataKey="success" stroke="var(--fd-lilac-ink)" strokeWidth={2} dot={(props: any) => {
                          const d = chartData[props.index]
                          return d?.isCurrent
                            ? <circle key={props.index} cx={props.cx} cy={props.cy} r={5} fill={A} stroke="var(--fd-ink)" strokeWidth={1} />
                            : <circle key={props.index} cx={props.cx} cy={props.cy} r={2} fill="var(--fd-lilac-ink)" />
                        }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
                    <div className="bb-label" style={{ marginBottom: 8 }}>SUCCESS RATE BY SPENDING LEVEL</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {levels.map((lvl: number, i: number) => {
                        const rate = (probs[i] ?? 0) * 100
                        const c = rate >= 95 ? G : rate >= 85 ? Y : R
                        const isCurrent = Math.abs(lvl - currentSpend) < 2000
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, width: 80, color: isCurrent ? A : M, fontWeight: isCurrent ? 700 : 400 }}>
                              {fmtMoney(lvl)}
                            </span>
                            <MiniBar value={rate} color={c} width={200} height={6} />
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: c, width: 40 }}>{rate.toFixed(0)}%</span>
                            {isCurrent && <span style={{ fontSize: 12, color: A }}>← CURRENT</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        )
      )}
    </div>
  )
}
