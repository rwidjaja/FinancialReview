import { SegBtn } from '../ui/primitives'
import {
  TerminalSection as _TerminalSection, PanelHeader as _PanelHeader, Divider,
} from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'

// v4: segmented-control segment (see ui/primitives SegBtn)
export const ModeBtn = SegBtn

// ─── Module 1: Conversion Status Panel ───────────────────────────────────────
export function ConversionStatusPanel({ tx, ytdConverted, annualTarget, remaining, progressPct,
  convScore, scoreColor, grossNoSS, grossActual, actualRoom, confColor, incConf,
  rolloverBal, rothBal, convWin, bindingAgi, fullYrAgiEst, actualYtdAgi,
  incomeReceivedPct, triggerThreshold, triggerMet, daysTo1Dec, dec1Triggered, rolloverDepleted,
  runwayYearsRemaining, runwayDepletionAge }: {
  tx: DashboardData['tax_data']
  ytdConverted: number; annualTarget: number; remaining: number; progressPct: number
  convScore: number; scoreColor: string; grossNoSS: number; grossActual?: number
  actualRoom: number; confColor: string; incConf: string
  rolloverBal: number; rothBal: number; convWin: string
  bindingAgi: number; fullYrAgiEst: number; actualYtdAgi: number
  incomeReceivedPct: number; triggerThreshold: number; triggerMet: boolean
  daysTo1Dec: number; dec1Triggered: boolean; rolloverDepleted?: boolean
  runwayYearsRemaining?: number | null; runwayDepletionAge?: number | null
}) {
  const windowColor = convWin === 'OPEN' ? G : convWin === 'WAIT' ? Y : R
  const isActualBinding = actualYtdAgi > fullYrAgiEst

  // Room sensitivity: ±5% income impact — must use the ACTUAL income base
  // (gross_actual), not the plan-inflated gross_no_ss (which assumes the full
  // annual conversion target already happened), or the swing is overstated.
  const sensBase   = grossActual ?? grossNoSS
  const sens5pctUp = Math.max(0, actualRoom - sensBase * 0.05)
  const sens5pctDn = Math.max(0, actualRoom + sensBase * 0.05)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Row 1: 4-col hero panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>

        {/* YTD Progress */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px', borderLeft: `3px solid ${A}` }}>
          <div className="bb-label">YTD CONVERSION PROGRESS</div>
          <div style={{ fontSize: 24, fontWeight: 500, color: A, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
            {fmtMoneyFull(ytdConverted)}
          </div>
          <div className="bb-sub">of {fmtMoneyFull(annualTarget)} target</div>
          <div style={{ margin: '8px 0 4px' }}>
            <div style={{ background: 'var(--fd-card)', borderRadius: 0, height: 12, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 0,
                width: `${Math.min(100, progressPct)}%`,
                background: progressPct >= 100 ? G : A,
                transition: 'width 0.3s',
              }} />
              <span style={{
                position: 'absolute', right: 4, top: 0, bottom: 0,
                display: 'flex', alignItems: 'center',
                fontSize: 12, fontWeight: 500, color: 'var(--fd-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                {Math.round(progressPct)}%
              </span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: progressPct >= 100 ? G : M }}>
            {rolloverDepleted
              ? ' ROLLOVER DEPLETED — fully converted'
              : progressPct >= 100
              ? `✓ TARGET MET — ${fmtMoneyFull(ytdConverted)} converted`
              : `${fmtMoneyFull(remaining)} remaining`}
          </div>
          {!rolloverDepleted && runwayYearsRemaining != null && (
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
              ≈{runwayYearsRemaining} {runwayYearsRemaining === 1 ? 'yr' : 'yrs'} left at this pace
              {runwayDepletionAge != null ? ` (depletes age ${runwayDepletionAge})` : ''}
            </div>
          )}
          {/* Target met detailed message — distinguish "this year's plan done" from
               "the whole Rollover IRA is gone, nothing left to ever convert" */}
          {progressPct >= 100 && (
            <div style={{
              marginTop: 8,
              padding: '6px 8px',
              background: 'var(--fd-card)',
              borderLeft: `3px solid ${G}`,
              fontSize: 12,
              color: G,
              lineHeight: 1.4
            }}>
              {rolloverDepleted
                ? ` Rollover IRA fully converted to Roth — lifetime conversion goal achieved. Nothing left to convert.`
                : actualRoom > 0
                ? ` Annual target met — ${fmtMoneyFull(ytdConverted)} converted. ${fmtMoneyFull(actualRoom)} bracket room still available.`
                : ` Annual target met — ${fmtMoneyFull(ytdConverted)} converted.`}
            </div>
          )}
        </div>

        {/* Bracket Room */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
          <div className="bb-label">BRACKET ROOM {tx.target_bracket_rate ? `(${tx.target_bracket_rate}%)` : ''}</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: actualRoom > 20000 ? G : actualRoom > 5000 ? Y : R, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
            {fmtMoneyFull(actualRoom)}
          </div>
          <div className="bb-sub">available before bracket bump</div>
          <Divider />
          <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
            <span style={{ color: Y }}>+5% income → </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(sens5pctUp)}</span>
            <br />
            <span style={{ color: G }}>−5% income → </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(sens5pctDn)}</span>
          </div>
        </div>

        {/* Conversion Window */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px', borderLeft: `2px solid ${windowColor}` }}>
          <div className="bb-label">CONVERSION WINDOW</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: windowColor, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
            {convWin}
          </div>
          <div style={{ fontSize: 12, color: M }}>
            CONFIDENCE: <span style={{ color: confColor, fontWeight: 500 }}>{incConf}</span>
          </div>
          <Divider />
          {/* Trigger checklist */}
          {[
            { label: `Income ≥${triggerThreshold}%`, met: incomeReceivedPct >= triggerThreshold },
            { label: 'Date ≥ Dec 1', met: dec1Triggered },
            { label: 'Confidence HIGH', met: incConf === 'HIGH' },
            { label: 'Room > 0', met: actualRoom > 0 },
          ].map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, marginTop: 2 }}>
              <span style={{ color: c.met ? G : M, fontSize: 12 }}>{c.met ? '✓' : '○'}</span>
              <span style={{ color: c.met ? G : M }}>{c.label}</span>
            </div>
          ))}
        </div>

        {/* Conv Score */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px', borderLeft: `2px solid ${scoreColor}` }}>
          <div className="bb-label">{new Date().getFullYear()} CONVERSION SCORE</div>
          <div style={{ fontSize: 36, fontWeight: 500, color: scoreColor, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
            {convScore}<span style={{ fontSize: 14, fontWeight: 400, color: M }}>/10</span>
          </div>
          <MiniBar value={convScore * 10} color={scoreColor} height={5} />
          {/* Issue 1 fix: WATCH is not a window state — when window is WAIT/CLOSED
               show CONVERSION PAUSED instead to avoid confusing it with the WAIT status.
               Show the score-based action as a dim note so it's still visible. */}
          <div style={{ fontSize: 12, fontWeight: 500, color: convWin !== 'OPEN' ? Y : scoreColor, marginTop: 6 }}>
            {convWin !== 'OPEN' ? ' WAITING FOR TRIGGER' : `${tx.conv_action_icon} ${tx.conv_action}`}
          </div>
          {convWin !== 'OPEN' && tx.conv_action && (
            <div style={{ fontSize: 12, color: M, marginTop: 1 }}>score action: {tx.conv_action}</div>
          )}
          <div style={{ fontSize: 12, color: M, marginTop: 3 }}>
            0–4 Avoid · 4–7 Partial · 7–9 Good · 9–10 Strong
          </div>
        </div>
      </div>

      {/* Row 2: secondary data strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">BINDING AGI</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: A, fontFamily: 'var(--font-mono)', margin: '3px 0' }}>
            {fmtMoneyFull(bindingAgi)}
          </div>
          <div style={{ fontSize: 12, color: M }}>
            {isActualBinding ? 'Actual YTD binding' : 'Full-year est. binding'}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
            Est: {fmtMoneyFull(fullYrAgiEst)} · Actual: {fmtMoneyFull(actualYtdAgi)}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">INCOME CONFIDENCE</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: confColor, fontFamily: 'var(--font-mono)', margin: '3px 0' }}>
            {incConf}
          </div>
          <div style={{ marginTop: 6 }}>
            <MiniBar value={Math.min(100, incomeReceivedPct)} color={incomeReceivedPct >= triggerThreshold ? G : A} height={4} />
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{incomeReceivedPct.toFixed(1)}% income received of projected</div>
            {tx?.income_received_actual != null && tx?.income_received_projected != null && (
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                Actual: {fmtMoneyFull(tx.income_received_actual)} · Full-year est: {fmtMoneyFull(tx.income_received_projected)}
              </div>
            )}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">TIMING TRIGGER</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: triggerMet ? G : daysTo1Dec < 60 ? Y : M, fontFamily: 'var(--font-mono)', margin: '3px 0' }}>
            {triggerMet ? 'TRIGGERED ✓' : dec1Triggered ? 'DEC-1 PASSED' : `${daysTo1Dec}d TO DEC-1`}
          </div>
          <div style={{ fontSize: 12, color: M }}>
            {triggerMet ? 'Execute conversion now' : `Needs income ≥${triggerThreshold}% or Dec 1`}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
          <div className="bb-label">ACCOUNT BALANCES</div>
          <div style={{ fontSize: 12, color: M, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Rollover IRA</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text)' }}>{fmtMoneyFull(rolloverBal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Roth IRA</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: G }}>{fmtMoneyFull(rothBal)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
