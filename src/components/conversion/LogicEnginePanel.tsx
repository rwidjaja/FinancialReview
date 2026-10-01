import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell,
} from 'recharts'
import { PanelHeader, Divider } from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { fmtMoneyFull } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'

// ─── Module 2: Logic Engine ───────────────────────────────────────────────────

export function RoomCalcPanel({ ceiling, grossNoSS, safetyBuf, convWin, confColor, incConf, targetBracketRate }: {
  ceiling: number; grossNoSS: number; safetyBuf: number
  convWin: string; confColor: string; incConf: string
  targetBracketRate?: number | null
}) {
  // roomBeforeBuffer = ceiling − grossNoSS (matches BracketMeter)
  // safeRoom         = roomBeforeBuffer − safetyBuf (recommended target basis)
  const roomBeforeBuffer = Math.max(0, ceiling - grossNoSS)
  const safeRoom         = Math.max(0, roomBeforeBuffer - safetyBuf)
  // Bracket used = AGI as % of ceiling (no ytdConverted — already in grossNoSS)
  const roomUsedPct = ceiling > 0 ? Math.min(100, (grossNoSS / ceiling) * 100) : 0

  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
      <PanelHeader>A. Room Calculation</PanelHeader>
      {/* Ledger */}
      {[
        { label: `${targetBracketRate ?? DEFAULT_BRACKET_RATE}% Ceiling`, val: ceiling, color: G },
        { label: '− Binding AGI (excl. future conv.)', val: -grossNoSS, color: R },
      ].map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ color: M }}>{r.label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: r.color }}>
            {r.val >= 0 ? '' : '−'}{fmtMoneyFull(Math.abs(r.val))}
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 500, borderBottom: '1px solid var(--border)', background: 'var(--fd-card)', margin: '0 -14px', padding: '5px 14px' }}>
        <span style={{ color: 'var(--text)' }}>= Room before buffer</span>
        <span style={{ color: roomBeforeBuffer > 20000 ? G : roomBeforeBuffer > 5000 ? Y : R, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(roomBeforeBuffer)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
        <span style={{ color: M }}>− Safety Buffer</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: Y }}>−{fmtMoneyFull(safetyBuf)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 500, padding: '6px 14px', background: 'var(--fd-card)', margin: '0 -14px' }}>
        <span style={{ color: 'var(--text)' }}>= Safe Room</span>
        <span style={{ color: safeRoom > 20000 ? G : safeRoom > 5000 ? Y : R, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(safeRoom)}</span>
      </div>
      <div style={{ marginTop: 4 }}>
        <MiniBar value={roomUsedPct} color={roomUsedPct > 90 ? R : roomUsedPct > 75 ? Y : G} height={5} />
        <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{roomUsedPct.toFixed(1)}% of {targetBracketRate ?? DEFAULT_BRACKET_RATE}% bracket used by current gross AGI (no std. deduction subtracted — differs from "bracket used (taxable)" elsewhere)</div>
      </div>
      <Divider label="window logic" />
      <div style={{ fontSize: 12, color: M, lineHeight: 1.6 }}>
        Room ≤ 0 → <span style={{ color: R }}>CLOSED</span>
        {' · '}Confidence &lt; HIGH → <span style={{ color: Y }}>WAIT</span>
        {' · '}else → <span style={{ color: G }}>OPEN</span>
        <br />Status: <span style={{ fontWeight: 500, color: convWin === 'OPEN' ? G : convWin === 'WAIT' ? Y : R }}>{convWin}</span>
        {' · '}Income conf: <span style={{ color: confColor, fontWeight: 500 }}>{incConf}</span>
        {convWin === 'WAIT' && (
          <><br /><span style={{ color: Y }}>Note: bracket room exists but window held until income confidence HIGH</span></>
        )}
      </div>
    </div>
  )
}

export function AgiEnginePanel({ fullYrAgiEst, actualYtdAgi, bindingAgi, ceiling, grossNoSS, safetyBuf, confColor, incConf, isActualBinding }: {
  fullYrAgiEst: number; actualYtdAgi: number; bindingAgi: number
  ceiling: number; grossNoSS: number; safetyBuf: number
  confColor: string; incConf: string; isActualBinding: boolean
}) {
  const safeRoom = Math.max(0, ceiling - grossNoSS - safetyBuf)
  const agiGap = isActualBinding ? actualYtdAgi - fullYrAgiEst : fullYrAgiEst - actualYtdAgi
  const showGapBanner = isActualBinding && agiGap > 10000
  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
      <PanelHeader>B. AGI Engine</PanelHeader>
      {/* Item 1: Prominent gap banner when actual YTD exceeds estimate (causes WAIT) */}
      {showGapBanner && (
        <div style={{
          margin: '0 0 10px', padding: '8px 10px',
          background: 'var(--fd-card)', border: '1px solid var(--fd-lilac-ink)',
          borderLeft: `4px solid ${A}`, borderRadius: 0,
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: A, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
             AGI GAP — {fmtMoneyFull(agiGap)} over estimate
          </div>
          <div style={{ fontSize: 12, color: A, marginTop: 3, lineHeight: 1.5 }}>
            Actual YTD ({fmtMoneyFull(actualYtdAgi)}) exceeds full-year estimate ({fmtMoneyFull(fullYrAgiEst)}) by {fmtMoneyFull(agiGap)}.
            <br />
            <strong>Note:</strong> Actual YTD includes any Q1 Roth conversion income — the full-year estimate typically excludes it.
            Compare base AGI (excl. conversion) for true income pacing. The gap may be a timing artifact, not excess income.
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: M }}>Full-Year AGI Est.</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: isActualBinding ? M : A }}>
            {fmtMoneyFull(fullYrAgiEst)}{!isActualBinding ? ' ← binding' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: M }}>Actual YTD AGI</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: isActualBinding ? A : M }}>
            {fmtMoneyFull(actualYtdAgi)}{isActualBinding ? ' ← binding' : ''}
          </span>
        </div>
        {showGapBanner && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: A }}>
            <span>Gap (actual − est.)</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>+{fmtMoneyFull(agiGap)}</span>
          </div>
        )}
        <div style={{ height: 1, background: 'var(--border2)', margin: '4px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>Binding AGI (higher)</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: A, fontSize: 13 }}>{fmtMoneyFull(bindingAgi)}</span>
        </div>
      </div>
      <Divider label="safe room" />
      <div style={{ fontSize: 12, color: M }}>
        Room after buffer: <span style={{ color: safeRoom > 10000 ? G : safeRoom > 0 ? Y : R, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(safeRoom)}</span>
      </div>
      <div style={{ fontSize: 12, color: M, marginTop: 4, lineHeight: 1.5 }}>
        {isActualBinding
          ? 'Actual YTD exceeds projection — using real received income to calculate room.'
          : 'Full-year estimate controls room — actual is below forecast.'}
      </div>
      <Divider label="income confidence" />
      <div style={{ fontSize: 12, color: confColor, fontWeight: 500 }}>{incConf}</div>
      <MiniBar value={incConf === 'HIGH' ? 90 : incConf === 'MEDIUM' ? 55 : 25} color={confColor} height={4} />
    </div>
  )
}

export function ScorePanel({ tx, convScore, scoreColor }: { tx: DashboardData['tax_data']; convScore: number; scoreColor: string }) {
  const components = tx.conv_score_components ?? []
  const chartData = components.map(c => ({
    name: c.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    pct: c.max > 0 ? Math.round((c.points / c.max) * 100) : 0,
    points: c.points,
    max: c.max,
  }))

  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
      <PanelHeader>C. Conversion Score</PanelHeader>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 32, fontWeight: 500, color: scoreColor, fontFamily: 'var(--font-mono)' }}>{convScore}</div>
        <div style={{ flex: 1 }}>
          <MiniBar value={convScore * 10} color={scoreColor} height={5} />
          <div style={{ fontSize: 12, color: scoreColor, fontWeight: 500, marginTop: 3 }}>
            {tx.conv_action_icon} {tx.conv_action}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {([['0–4', R, 'Avoid', convScore < 4], ['4–7', Y, 'Partial', convScore >= 4 && convScore < 7], ['7–9', G, 'Good', convScore >= 7 && convScore < 9], ['9–10', 'var(--cyan)', 'Strong', convScore >= 9]] as [string, string, string, boolean][]).map(([range, c, lbl, isActive]) => (
              <div key={range} style={{
                fontSize: 12, padding: '2px 6px',
                background: isActive ? c : 'var(--fd-hairline)',
                color: isActive ? 'var(--fd-page)' : c as string,
                border: `1px solid ${isActive ? c : 'var(--fd-hairline)'}`,
                fontWeight: isActive ? 700 : 400,
                borderRadius: 0,
              }}>
                {range} {lbl}
              </div>
            ))}
          </div>
        </div>
      </div>
      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={chartData.length * 22 + 10}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 30, top: 0, bottom: 0 }}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }} />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(val: unknown, _n: unknown, entry: any) =>
                [`${val}% (${entry.payload.points}/${entry.payload.max})`, 'Score']}
            />
            <Bar dataKey="pct" radius={0}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.pct >= 70 ? G : d.pct >= 40 ? Y : R} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export function TimingEnginePanel({ incomeReceivedPct, triggerThreshold, triggerMet, daysTo1Dec, dec1Triggered, incConf, actualRoom, tx, amountExceeded }: {
  incomeReceivedPct: number; triggerThreshold: number; triggerMet: boolean
  daysTo1Dec: number; dec1Triggered: boolean; incConf: string; actualRoom: number
  tx: DashboardData['tax_data']; amountExceeded?: boolean
}) {
  const conditions = [
    { label: `Income ≥ ${triggerThreshold}%`, value: `${incomeReceivedPct.toFixed(1)}%`, met: incomeReceivedPct >= triggerThreshold },
    { label: 'Date ≥ Dec 1', value: dec1Triggered ? 'Passed' : `${daysTo1Dec}d away`, met: dec1Triggered },
    { label: 'Income Confidence', value: incConf, met: incConf === 'HIGH' },
    { label: 'Room > 0', value: actualRoom > 0 ? 'Available' : 'Closed', met: actualRoom > 0 },
  ]
  const metCount = conditions.filter(c => c.met).length

  return (
    <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
      <PanelHeader>D. Timing Engine</PanelHeader>

      {/* Trigger status hero */}
      <div style={{
        padding: '6px 10px', marginBottom: 8,
        background: triggerMet ? 'var(--fd-card)' : 'var(--fd-card)',
        border: `1px solid ${triggerMet ? G : A}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>{triggerMet ? '' : ''}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: triggerMet ? G : A }}>
            {triggerMet ? 'ALL TRIGGERS MET — EXECUTE NOW' : 'MONITORING TRIGGERS'}
          </div>
          <div style={{ fontSize: 12, color: M }}>{metCount}/4 conditions satisfied</div>
        </div>
      </div>

      {/* Income countdown bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: M, marginBottom: 2 }}>
          <span>INCOME RECEIVED</span>
          <span style={{ fontWeight: 500, color: incomeReceivedPct >= triggerThreshold ? G : A }}>
            {incomeReceivedPct.toFixed(1)}% / {triggerThreshold}% needed
          </span>
        </div>
        <div style={{ background: 'var(--surface)', height: 8, position: 'relative' }}>
          <div style={{ height: 8, width: `${Math.min(100, incomeReceivedPct)}%`, background: incomeReceivedPct >= triggerThreshold ? G : A, transition: 'width 0.3s' }} />
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: `${triggerThreshold}%`,
            borderLeft: `1px dashed ${Y}`, pointerEvents: 'none',
          }} />
        </div>
      </div>

      {/* Condition checklist */}
      {conditions.map((c, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '4px 0', borderBottom: i < conditions.length - 1 ? '1px solid var(--border)' : 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: c.met ? G : M, fontSize: 12 }}>{c.met ? '✓' : '○'}</span>
            <span style={{ fontSize: 12, color: c.met ? G : M }}>{c.label}</span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: c.met ? G : M, fontWeight: c.met ? 700 : 400 }}>
            {c.value}
          </span>
        </div>
      ))}

      {tx.conversion_month_name && (
        <div style={{ marginTop: 8, fontSize: 12, color: M }}>
          Target window: <span style={{ color: A, fontWeight: 500 }}>{tx.conversion_month_name}</span>
        </div>
      )}

      {amountExceeded && (
        <div style={{
          marginTop: 8, padding: '5px 8px', fontSize: 12, lineHeight: 1.5,
          background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', borderRadius: 0, color: Y,
        }}>
          Current stance: Even if window opens later, tax‑optimal conversion amount for this year is already exceeded.
          Timing is secondary — the primary brake is tax math.
        </div>
      )}
    </div>
  )
}
