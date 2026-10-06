import { useState, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { fmtMoneyFull } from '../../utils/formatters'
import { PanelHeader, Divider } from '../ui/Terminal'
import { G, R, A, M, roundTo2 } from './simTypes'
import { Slider } from './SimSharedComponents'
import type { SimDefaults } from './simTypes'
import { runSim } from './simTypes'
import { WsSection } from '../workspace/WorkspaceContext'
import { useWorkspace } from '../workspace/context'

// Compact read-only display row
function BaselineRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
      <span style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

export function SandboxPanel({ defaults }: { defaults: SimDefaults }) {
  // Custom scenario sliders — initialized to shared baseline values
  const [customSpending, setCustomSpending] = useState(defaults.spending)
  const [customRet, setCustomRet]  = useState(roundTo2(defaults.expected_return * 100))
  const [customVol, setCustomVol]  = useState(roundTo2(defaults.volatility * 100))
  const [customSS, setCustomSS]    = useState(defaults.ss_annual)

  const { mutate, data: result, isPending } = useMutation({ mutationFn: runSim })

  const buildMutateArgs = () => ({
    module: 'sandbox' as const,
    params: {
      spending: defaults.spending,
      expected_return: roundTo2(defaults.expected_return),
      volatility: roundTo2(defaults.volatility),
      inflation: roundTo2(defaults.inflation),
      ss_annual: defaults.ss_annual,
      target_age: defaults.target_age,
    },
    sandbox_overrides: {
      spending: customSpending,
      expected_return: roundTo2(customRet / 100),
      volatility: roundTo2(customVol / 100),
      ss_annual: customSS,
    },
  })

  const run = () => mutate(buildMutateArgs())

  const prevTargetAge = useRef(defaults.target_age)
  useEffect(() => {
    if (result === undefined) return
    if (defaults.target_age === prevTargetAge.current) return
    prevTargetAge.current = defaults.target_age
    mutate(buildMutateArgs())
  }, [defaults.target_age]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetToBaseline = () => {
    setCustomSpending(defaults.spending)
    setCustomRet(roundTo2(defaults.expected_return * 100))
    setCustomVol(roundTo2(defaults.volatility * 100))
    setCustomSS(defaults.ss_annual)
  }

  const baseline = result?.baseline
  const custom = result?.scenario

  const basePct = baseline?.overall_success != null
    ? (baseline.overall_success > 1 ? baseline.overall_success : baseline.overall_success * 100)
    : null
  const custPct = custom?.overall_success != null
    ? (custom.overall_success > 1 ? custom.overall_success : custom.overall_success * 100)
    : null

  const deltaPct  = basePct !== null && custPct !== null ? custPct - basePct : null
  const deltaEnd  = baseline?.median_ending && custom?.median_ending
    ? custom.median_ending - baseline.median_ending : null

  // Check how different custom is from baseline
  const { enabled: inWorkspace } = useWorkspace()
  const hasChanges = (
    customSpending !== defaults.spending ||
    Math.abs(customRet - roundTo2(defaults.expected_return * 100)) > 0.01 ||
    Math.abs(customVol - roundTo2(defaults.volatility * 100)) > 0.01 ||
    customSS !== defaults.ss_annual
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: inWorkspace ? '1fr' : '280px 1fr', gap: 8 }}>

      {/* ── Left: Baseline summary + Custom scenario sliders ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <WsSection id="sm_sb_inputs" value={hasChanges ? 'Modified' : 'Baseline'} status={hasChanges ? 'watch' : 'info'}>

        {/* Baseline (read-only) */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
          borderRadius: 0, padding: '10px 12px', borderTop: `3px solid ${M}`,
        }}>
          <PanelHeader>BASELINE SCENARIO</PanelHeader>
          <div style={{ fontSize: 12, color: M, marginBottom: 6, lineHeight: 1.5 }}>
            From shared simulation parameters above
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <BaselineRow label="Spending"   value={`${fmtMoneyFull(defaults.spending)}/yr`} />
            <BaselineRow label="Return"     value={`${(defaults.expected_return * 100).toFixed(1)}%`} />
            <BaselineRow label="Volatility" value={`${(defaults.volatility * 100).toFixed(1)}%`} />
            <BaselineRow label="Inflation"  value={`${(defaults.inflation * 100).toFixed(1)}%`} />
            <BaselineRow label="SS Annual"  value={fmtMoneyFull(defaults.ss_annual)} />
            <BaselineRow label="Target Age" value={`age ${defaults.target_age}`} />
          </div>
        </div>

        {/* Custom scenario sliders */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
          borderRadius: 0, padding: '10px 12px', borderTop: `3px solid ${A}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <PanelHeader>WHAT-IF SCENARIO</PanelHeader>
            <button onClick={resetToBaseline} style={{
              fontSize: 12, color: M, background: 'transparent',
              border: '1px solid var(--fd-hairline)', borderRadius: 0,
              padding: '2px 6px', cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}>RESET</button>
          </div>
          <div>
            <Slider label="Spending" value={customSpending} min={20000} max={250000} step={1000} unit="$" onChange={setCustomSpending} />
            <Slider label="Return" value={customRet} min={3} max={14} step={0.5} unit="%" onChange={v => setCustomRet(roundTo2(v))} />
            <Slider label="Volatility" value={customVol} min={5} max={30} step={0.5} unit="%" onChange={v => setCustomVol(roundTo2(v))} />
            <Slider label="SS Annual" value={customSS} min={0} max={60000} step={500} unit="$" onChange={setCustomSS} />
          </div>
          {!hasChanges && (
            <div style={{ fontSize: 12, color: M, marginBottom: 4, fontStyle: 'italic' }}>
              Adjust sliders above to create a different scenario
            </div>
          )}
          <button onClick={run} style={{
            width: '100%', marginTop: 6, padding: '8px 0',
            background: hasChanges ? A : 'var(--fd-card)',
            color: 'var(--fd-ink)', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, letterSpacing: '1px',
          }}>
            {isPending ? '⟳ RUNNING…' : '▶ COMPARE VS BASELINE'}
          </button>
        </div>
        </WsSection>
      </div>

      {/* ── Right: Results ── */}
      <div>
        <WsSection id="sm_sb_results" value={deltaPct != null ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : undefined} status={deltaPct == null ? undefined : deltaPct >= 0 ? 'ok' : 'warn'}>
        {result && !isPending && (
          result.error ? (
            <div style={{ color: R, fontSize: 12, padding: 12 }}>{result.error}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

              {/* Side-by-side comparison */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderTop: `3px solid ${M}`, padding: '12px 14px' }}>
                  <PanelHeader>BASELINE</PanelHeader>
                  <div style={{ fontSize: 24, fontWeight: 500, color: basePct !== null && basePct >= 90 ? G : basePct !== null && basePct >= 75 ? 'var(--yellow)' : R, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
                    {basePct !== null ? `${basePct.toFixed(1)}%` : '—'}
                  </div>
                  <div className="bb-sub">SUCCESS RATE</div>
                  <Divider />
                  <div style={{ fontSize: 14, fontWeight: 500, color: G }}>{fmtMoneyFull(baseline?.median_ending ?? 0)}</div>
                  <div className="bb-sub">MEDIAN ENDING WEALTH</div>
                  {baseline?.p10_ending != null && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 500, color: R, marginTop: 4 }}>{fmtMoneyFull(baseline.p10_ending)}</div>
                      <div className="bb-sub">P10 (WORST 10%)</div>
                    </>
                  )}
                </div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderTop: `3px solid ${A}`, padding: '12px 14px' }}>
                  <PanelHeader>WHAT-IF SCENARIO</PanelHeader>
                  <div style={{ fontSize: 24, fontWeight: 500, color: custPct !== null && custPct >= 90 ? G : custPct !== null && custPct >= 75 ? 'var(--yellow)' : R, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
                    {custPct !== null ? `${custPct.toFixed(1)}%` : '—'}
                  </div>
                  <div className="bb-sub">SUCCESS RATE</div>
                  <Divider />
                  <div style={{ fontSize: 14, fontWeight: 500, color: G }}>{fmtMoneyFull(custom?.median_ending ?? 0)}</div>
                  <div className="bb-sub">MEDIAN ENDING WEALTH</div>
                  {custom?.p10_ending != null && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 500, color: R, marginTop: 4 }}>{fmtMoneyFull(custom.p10_ending)}</div>
                      <div className="bb-sub">P10 (WORST 10%)</div>
                    </>
                  )}
                </div>
              </div>

              {/* Delta strip */}
              {deltaPct !== null && deltaEnd !== null && (
                <div style={{
                  padding: '10px 14px', background: 'var(--surface)',
                  border: `1px solid ${deltaPct >= 0 ? G : R}`,
                  borderLeft: `4px solid ${deltaPct >= 0 ? G : R}`,
                  borderRadius: 0,
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 2 }}>DELTA SUCCESS RATE</div>
                    <span style={{ color: deltaPct >= 0 ? G : R, fontWeight: 500, fontSize: 20, fontFamily: 'var(--font-mono)' }}>
                      {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%
                    </span>
                    <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                      {deltaPct >= 0 ? 'Scenario improves survival odds' : 'Scenario reduces survival odds'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 2 }}>DELTA MEDIAN ENDING WEALTH</div>
                    <span style={{ color: deltaEnd >= 0 ? G : R, fontWeight: 500, fontSize: 18, fontFamily: 'var(--font-mono)' }}>
                      {deltaEnd >= 0 ? '+' : '−'}{fmtMoneyFull(Math.abs(deltaEnd))}
                    </span>
                    <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                      {deltaEnd >= 0 ? 'More wealth at target age' : 'Less wealth at target age'}
                    </div>
                  </div>
                </div>
              )}

              {/* What-if changes summary */}
              <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, fontSize: 12, color: M }}>
                <span style={{ fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>What-if changes applied: </span>
                {customSpending !== defaults.spending && (
                  <span style={{ color: 'var(--text)', marginRight: 10 }}>
                    Spending {customSpending > defaults.spending ? '+' : '−'}{fmtMoneyFull(Math.abs(customSpending - defaults.spending))}
                  </span>
                )}
                {Math.abs(customRet - roundTo2(defaults.expected_return * 100)) > 0.01 && (
                  <span style={{ color: 'var(--text)', marginRight: 10 }}>
                    Return {customRet > roundTo2(defaults.expected_return * 100) ? '+' : ''}{(customRet - roundTo2(defaults.expected_return * 100)).toFixed(1)}%
                  </span>
                )}
                {Math.abs(customVol - roundTo2(defaults.volatility * 100)) > 0.01 && (
                  <span style={{ color: 'var(--text)', marginRight: 10 }}>
                    Volatility {customVol > roundTo2(defaults.volatility * 100) ? '+' : ''}{(customVol - roundTo2(defaults.volatility * 100)).toFixed(1)}%
                  </span>
                )}
                {customSS !== defaults.ss_annual && (
                  <span style={{ color: 'var(--text)', marginRight: 10 }}>
                    SS {customSS > defaults.ss_annual ? '+' : '−'}{fmtMoneyFull(Math.abs(customSS - defaults.ss_annual))}/yr
                  </span>
                )}
              </div>

            </div>
          )
        )}
        {!result && !isPending && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: M, gap: 8 }}>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>ADJUST WHAT-IF PARAMETERS AND CLICK COMPARE</div>
            <div style={{ fontSize: 12, color: M, opacity: 0.6 }}>Baseline uses shared simulation parameters · What-if overrides specific assumptions</div>
          </div>
        )}
        </WsSection>
      </div>
    </div>
  )
}
