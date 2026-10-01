import React from 'react'
import { PanelHeader, Divider, DataRow } from '../ui/Terminal'
import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData, ProjectionRow } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const B = 'var(--blue)'
const Y = 'var(--yellow)'

// ── Small inline math row ────────────────────────────────────────────────────
function MathRow({ label, value, color = M, indent = false, separator = false, bold = false }: {
  label: string; value: string; color?: string
  indent?: boolean; separator?: boolean; bold?: boolean
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      paddingTop: separator ? 4 : 0,
      borderTop: separator ? '1px solid rgba(255,255,255,0.07)' : undefined,
      fontWeight: bold ? 700 : 400,
    }}>
      <span style={{ color: M, paddingLeft: indent ? 10 : 0 }}>{label}</span>
      <span style={{ color, fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}

// ── Section subheading inside a card ────────────────────────────────────────
function CalcHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
      letterSpacing: '0.8px', marginTop: 10, marginBottom: 5,
      paddingTop: 8, borderTop: '1px solid var(--fd-hairline)',
    }}>
      {children}
    </div>
  )
}

// ── Status helpers ────────────────────────────────────────────────────────────
// Returns { label, color, note } for the REMAINING row — deterministic, no
// subjective wording. Based purely on bracket math, not emotions.

function conservativeStatus(ytd: number, target: number, rawRoom: number, taxOptimalExceeded = false): { label: string; color: string; note?: string } {
  const remaining = Math.max(0, target - ytd)
  if (remaining > 0) {
    // Plan target still has room, but if the tax-optimal amount is already
    // exceeded the primary recommendation is STOP — don't show this as a
    // green "go convert more" number.
    if (taxOptimalExceeded)
      return { label: fmtMoneyFull(remaining), color: Y,
        note: 'Above tax-optimal — STOP is the primary recommendation; converting this adds avoidable tax' }
    return { label: fmtMoneyFull(remaining), color: G }
  }
  // ytd >= target
  const roomAfterTarget = Math.max(0, rawRoom - ytd)
  if (roomAfterTarget > 0)
    return { label: 'Plan target met', color: G,
      note: `${fmtMoneyFull(roomAfterTarget)} bracket room still available` }
  return { label: 'Plan target met', color: G, note: 'No additional conversion recommended this year' }
}

function recommendedStatus(ytd: number, netRoom: number, rawRoom: number): { label: string; color: string; note?: string } {
  const remaining = Math.max(0, netRoom - ytd)
  if (remaining > 0) return { label: fmtMoneyFull(remaining), color: A }
  // ytd >= netRoom (safe amount exceeded)
  const roomToCeiling = Math.max(0, rawRoom - ytd)
  if (roomToCeiling > 0)
    return { label: 'Safe amt exceeded', color: Y,
      note: `${fmtMoneyFull(roomToCeiling)} still available to bracket ceiling` }
  return { label: 'Recommended amount already exceeded', color: Y, note: 'No additional conversion recommended this year' }
}

function aggressiveStatus(ytd: number, rawRoom: number): { label: string; color: string; note?: string } {
  const remaining = Math.max(0, rawRoom - ytd)
  if (remaining > 0) return { label: fmtMoneyFull(remaining), color: R }
  return { label: 'Recommended amount already exceeded', color: Y, note: 'No additional conversion recommended this year' }
}

export function ConversionScenarios({ tx, ytdConverted, actualRoom, convWin, scenarios, grossNoSS, ceiling, safetyBuf }: {
  tx: DashboardData['tax_data']
  ytdConverted: number; actualRoom: number; convWin: string
  scenarios: Record<string, { label: string; amount: number; rows: ProjectionRow[] }>
  grossNoSS?: number | null; ceiling?: number | null; safetyBuf?: number
}) {
  const annualTarget  = tx?.annual_conversion ?? 0
  const alreadyMet    = ytdConverted >= annualTarget && annualTarget > 0

  // Income math inputs — use gross_actual (divs + ytd_converted + STCG, no plan-target inflation)
  // so bracketRoom reflects what has actually been executed, not the unexecuted $400k plan.
  const gross   = tx?.gross_actual ?? grossNoSS ?? tx?.gross_no_ss ?? 0
  const ceil    = ceiling   ?? tx?.target_bracket_ceiling ?? 0
  const buf     = safetyBuf ?? tx?.safety_buffer ?? 0
  const bracket = tx?.target_bracket_rate ?? 24
  const rawRoom = Math.max(0, ceil - gross)          // bracket room before buffer
  const netRoom = Math.max(0, rawRoom - buf)          // recommended headroom

  // Primary recommendation: STOP once the tax-optimal (net room) amount is
  // exceeded. This is the single source of truth shown here, in Overview and
  // in the Drawdown decision engine.
  const taxOptimalExceeded = ytdConverted >= netRoom && netRoom >= 0 && gross > 0 && ceil > 0
  const exceededBy = Math.max(0, ytdConverted - netRoom)

  const windowColor = convWin === 'OPEN' ? G : convWin === 'WAIT' ? Y : R
  const windowNote  = convWin === 'CLOSED'
    ? 'Bracket room exhausted — no conversion possible this year.'
    : convWin === 'WAIT'
    ? 'Window is WAIT — income confidence not yet HIGH. Amounts shown are maximums if window opens.'
    : null

  if (alreadyMet) {
    return (
      <div style={{ padding: '16px 14px', color: G, fontSize: 12, fontWeight: 500 }}>
        ✓ ANNUAL TARGET MET — {fmtMoneyFull(ytdConverted)} converted this year.
        {actualRoom > 0 && (
          <div style={{ color: Y, marginTop: 4 }}>
            {fmtMoneyFull(actualRoom)} additional bracket room available if you wish to convert more.
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {taxOptimalExceeded && (
        <div style={{
          padding: '8px 14px', fontSize: 12, fontWeight: 500,
          color: R, background: 'var(--fd-card)',
          border: `1px solid ${R}`, borderLeft: `4px solid ${R}`,
        }}>
          ■ PRIMARY RECOMMENDATION: STOP — converted {fmtMoneyFull(ytdConverted)} YTD,
          {' '}{fmtMoneyFull(exceededBy)} above the tax-optimal amount. No further conversion this year.
          The cards below show the scenario math only.
        </div>
      )}
      {windowNote && (
        <div style={{
          padding: '8px 14px', fontSize: 12, fontWeight: 500,
          color: windowColor, background: 'var(--fd-card)',
          border: `1px solid ${windowColor}`, borderLeft: `4px solid ${windowColor}`,
        }}>
           {windowNote}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>

        {/* ── CONSERVATIVE ── */}
        {(() => {
          const s   = scenarios.conservative
          const st  = conservativeStatus(ytdConverted, s.amount, rawRoom, taxOptimalExceeded)
          return (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
              borderRadius: 0, padding: '12px 14px', borderTop: `3px solid ${G}`,
              opacity: convWin === 'CLOSED' ? 0.5 : 1,
            }}>
              <PanelHeader>PLAN TARGET</PanelHeader>
              <div style={{ fontSize: 22, fontWeight: 500, color: G, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
                {fmtMoneyFull(s.amount)}<span style={{ fontSize: 12, fontWeight: 400, color: M }}>/yr</span>
              </div>
              <div style={{ fontSize: 12, color: M, marginBottom: 8, lineHeight: 1.5 }}>
                Your configured annual target — plan logic only, no tax math.
              </div>
              <Divider />
              <DataRow label="CONVERTED YTD" value={
                <span style={{ color: ytdConverted > 0 ? G : M, fontWeight: 500 }}>
                  {fmtMoneyFull(ytdConverted)}
                </span>
              } />
              <DataRow label="REMAINING" value={
                <div>
                  <span style={{ color: st.color, fontWeight: 500 }}>{st.label}</span>
                  {st.note && <div style={{ color: M, fontSize: 12, marginTop: 2 }}>{st.note}</div>}
                </div>
              } />
              {s.rows.length > 0 && (
                <DataRow label="15Y PROJECTION" value={<span style={{ color: M }}>✓ {s.rows.length} years</span>} />
              )}

              <CalcHeader>Plan math (JSON input)</CalcHeader>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                <MathRow label="Annual target" value={fmtMoneyFull(annualTarget)} color="var(--text)" />
                <MathRow label="Converted YTD" value={`−${fmtMoneyFull(ytdConverted)}`} />
                <MathRow label="→ Remaining" value={st.label} color={st.color} bold separator />
                {st.note && <div style={{ fontSize: 12, color: M, paddingLeft: 10 }}>{st.note}</div>}
              </div>
            </div>
          )
        })()}

        {/* ── RECOMMENDED ── */}
        {(() => {
          const s  = scenarios.recommended
          const st = recommendedStatus(ytdConverted, netRoom, rawRoom)
          return (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
              borderRadius: 0, padding: '12px 14px', borderTop: `3px solid ${A}`,
              opacity: convWin === 'CLOSED' ? 0.5 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <PanelHeader>TAX-OPTIMAL — PRIMARY</PanelHeader>
                {ytdConverted > s.amount && s.amount > 0 && (
                  <span style={{ fontSize: 12, padding: '2px 6px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', color: Y, borderRadius: 0, fontWeight: 500, whiteSpace: 'nowrap' }}>
                     Already exceeded
                  </span>
                )}
              </div>
              <div style={{ fontSize: 22, fontWeight: 500, color: A, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
                {fmtMoneyFull(s.amount)}<span style={{ fontSize: 12, fontWeight: 400, color: M }}>/yr</span>
              </div>
              <div style={{ fontSize: 12, color: M, marginBottom: 8, lineHeight: 1.5 }}>
                min(annual target, bracket room − buffer) — based on {bracket}% bracket.
              </div>
              {annualTarget > s.amount && ytdConverted > s.amount && (
                <div style={{
                  fontSize: 12, color: Y, background: 'var(--fd-card)',
                  border: '1px solid var(--fd-hairline)', borderRadius: 0,
                  padding: '5px 8px', marginBottom: 8, lineHeight: 1.5,
                }}>
                  Note: Plan target {fmtMoneyFull(annualTarget)} &gt; tax‑optimal {fmtMoneyFull(s.amount)}.
                  You've already converted {fmtMoneyFull(ytdConverted)}, above the tax‑optimal amount — no additional conversion recommended.
                </div>
              )}
              <Divider />
              <DataRow label="CONVERTED YTD" value={
                <span style={{ color: ytdConverted > 0 ? G : M, fontWeight: 500 }}>
                  {fmtMoneyFull(ytdConverted)}
                </span>
              } />
              <DataRow label="REMAINING" value={
                <div>
                  <span style={{ color: st.color, fontWeight: 500 }}>{st.label}</span>
                  {st.note && <div style={{ color: M, fontSize: 12, marginTop: 2 }}>{st.note}</div>}
                </div>
              } />
              {s.rows.length > 0 && (
                <DataRow label="15Y PROJECTION" value={<span style={{ color: M }}>✓ {s.rows.length} years</span>} />
              )}

              {gross > 0 && ceil > 0 && (
                <>
                  <CalcHeader>Tax math ({bracket}% bracket)</CalcHeader>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                    <MathRow label="Bracket ceiling" value={fmtMoneyFull(ceil)} color={B} />
                    <MathRow label="Gross income (actual)" value={`−${fmtMoneyFull(gross)}`} />
                    <MathRow label="Bracket room" value={fmtMoneyFull(rawRoom)} color={rawRoom > 0 ? G : R} separator />
                    {buf > 0 && <MathRow label="Safety buffer" value={`−${fmtMoneyFull(buf)}`} />}
                    <MathRow label="Net room" value={fmtMoneyFull(netRoom)} color={netRoom > 0 ? A : R} bold separator />
                    <MathRow label="vs annual target" value={fmtMoneyFull(annualTarget)} color={M} />
                    <MathRow label="→ Recommended" value={fmtMoneyFull(s.amount)} color={A} bold separator />
                    <MathRow label="Converted YTD" value={`−${fmtMoneyFull(ytdConverted)}`} color={G} />
                    <MathRow label="→ Remaining" value={st.label} color={st.color} bold separator />
                    {st.note && <div style={{ fontSize: 12, color: M, paddingLeft: 10 }}>{st.note}</div>}
                  </div>
                </>
              )}
            </div>
          )
        })()}

        {/* ── AGGRESSIVE ── */}
        {(() => {
          const s  = scenarios.aggressive
          const st = aggressiveStatus(ytdConverted, rawRoom)
          return (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
              borderRadius: 0, padding: '12px 14px', borderTop: `3px solid ${R}`,
              opacity: convWin === 'CLOSED' ? 0.5 : 1,
            }}>
              <PanelHeader>MAX {bracket}% BRACKET</PanelHeader>
              <div style={{ fontSize: 22, fontWeight: 500, color: R, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
                {fmtMoneyFull(s.amount)}<span style={{ fontSize: 12, fontWeight: 400, color: M }}>/yr</span>
              </div>
              <div style={{ fontSize: 12, color: M, marginBottom: 8, lineHeight: 1.5 }}>
                Full bracket room, no safety buffer — converts up to the {bracket}% ceiling.
              </div>
              <Divider />
              <DataRow label="CONVERTED YTD" value={
                <span style={{ color: ytdConverted > 0 ? G : M, fontWeight: 500 }}>
                  {fmtMoneyFull(ytdConverted)}
                </span>
              } />
              <DataRow label="REMAINING" value={
                <div>
                  <span style={{ color: st.color, fontWeight: 500 }}>{st.label}</span>
                  {st.note && <div style={{ color: M, fontSize: 12, marginTop: 2 }}>{st.note}</div>}
                </div>
              } />
              {s.rows.length > 0 && (
                <DataRow label="15Y PROJECTION" value={<span style={{ color: M }}>✓ {s.rows.length} years</span>} />
              )}

              {gross > 0 && ceil > 0 && (
                <>
                  <CalcHeader>Tax math ({bracket}% bracket)</CalcHeader>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                    <MathRow label="Bracket ceiling" value={fmtMoneyFull(ceil)} color={B} />
                    <MathRow label="Gross income (actual)" value={`−${fmtMoneyFull(gross)}`} />
                    <MathRow label="→ Bracket room" value={fmtMoneyFull(rawRoom)}
                      color={rawRoom > 0 ? R : M} bold separator />
                    <MathRow label="Converted YTD" value={`−${fmtMoneyFull(ytdConverted)}`} color={G} />
                    <MathRow label="→ Remaining" value={st.label} color={st.color} bold separator />
                    {st.note && <div style={{ fontSize: 12, color: M, paddingLeft: 10 }}>{st.note}</div>}
                  </div>
                </>
              )}
            </div>
          )
        })()}

      </div>
    </div>
  )
}
