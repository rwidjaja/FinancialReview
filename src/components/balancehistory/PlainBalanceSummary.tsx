/**
 * PlainBalanceSummary — "What happened?" popup for the Balance tab.
 *
 * Same pattern as Overview's PlainOverviewSummary and Drawdown's
 * PlainSummaryPanel: no new calculations, just the exact numbers already
 * computed in BalanceHistoryTab, re-told in plain English with a short
 * glossary. Passed in as plain values (not `data`) since the parent already
 * derives all of this from its own local state.
 */
import { fmtMoneyFull } from '../../utils/formatters'

interface AccountShare { label: string; pct: number }

interface Props {
  onClose: () => void
  currentVal:      number
  hwm:              number
  hwmDate:          string | null
  atHwm:            boolean
  drawdownPct:      number
  daysSinceHwm:     number
  periodDelta:      number | null
  periodPct:        number | null
  periodLabel:      string
  cagr:             number | null
  bestMonth:        { label: string; momDelta: number | null; momPct: number | null } | null
  worstMonth:       { label: string; momDelta: number | null; momPct: number | null } | null
  avgDailyChange:   number | null
  nextMilestone:    number
  distToNext:       number | null
  proj30d:          number | null
  proj90d:          number | null
  accounts:         AccountShare[]
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--fd-hairline)',
      borderLeft: accent ? `3px solid ${accent}` : undefined,
      borderRadius: 0, padding: '12px 14px',
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--text2)', margin: '0 0 6px' }}>{children}</p>
}

export function PlainBalanceSummary(props: Props) {
  const {
    onClose, currentVal, hwm, hwmDate, atHwm, drawdownPct, daysSinceHwm,
    periodDelta, periodPct, periodLabel, cagr, bestMonth, worstMonth,
    avgDailyChange, nextMilestone, distToNext, proj30d, proj90d, accounts,
  } = props

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg)', borderRadius: 0, width: '100%', maxWidth: 640,
        maxHeight: '85vh', overflowY: 'auto',
        border: '1px solid var(--fd-hairline)',
        boxShadow: 'none',
      }}>
        <div style={{
          position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--fd-hairline)',
        }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text1)' }}>
            What happened? — Balance History, in plain English
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text2)',
            fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 4,
          }}>×</button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>

          <Section title="Where things stand right now" accent="var(--green)">
            <P>Your accounts are worth <strong>{fmtMoneyFull(currentVal)}</strong> today.</P>
            <P>
              {atHwm
                ? "That's an all-time high — the most this portfolio has ever been worth."
                : <>Your all-time high was <strong>{fmtMoneyFull(hwm)}</strong>{hwmDate ? ` on ${hwmDate}` : ''}.
                    You're currently about <strong>{Math.abs(drawdownPct).toFixed(1)}%</strong> below
                    that peak, {daysSinceHwm} day{daysSinceHwm === 1 ? '' : 's'} since you last hit it.</>}
            </P>
          </Section>

          <Section title={`What happened ${periodLabel}`}>
            {periodDelta != null && periodPct != null ? (
              <P>
                Your balance went <strong style={{ color: periodDelta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {periodDelta >= 0 ? 'up' : 'down'} {fmtMoneyFull(Math.abs(periodDelta))}
                </strong> ({periodPct >= 0 ? '+' : ''}{periodPct.toFixed(1)}%) {periodLabel}.
              </P>
            ) : (
              <P>Not enough history yet to show a change for this period.</P>
            )}
            {avgDailyChange != null && (
              <P>
                On a typical trading day, your balance moves about <strong>{fmtMoneyFull(Math.abs(avgDailyChange))}</strong>,
                up or down — that's the normal day-to-day wobble, not a signal of anything wrong.
              </P>
            )}
          </Section>

          <Section title="The bigger picture — 12-month return">
            {cagr != null ? (
              <P>
                Looking back a full year, your balance has grown about{' '}
                <strong style={{ color: cagr >= 0 ? 'var(--green)' : 'var(--red)' }}>{cagr.toFixed(1)}%</strong>.
              </P>
            ) : (
              <P>Not enough history yet for a 12-month comparison.</P>
            )}
            {(bestMonth?.momDelta != null || worstMonth?.momDelta != null) && (
              <P>
                {bestMonth?.momDelta != null && <>Best month so far: <strong>{bestMonth.label}</strong>, up {fmtMoneyFull(bestMonth.momDelta)}
                  {bestMonth.momPct != null ? ` (+${bestMonth.momPct.toFixed(1)}%)` : ''}. </>}
                {worstMonth?.momDelta != null && <>Worst month: <strong>{worstMonth.label}</strong>, down {fmtMoneyFull(Math.abs(worstMonth.momDelta))}
                  {worstMonth.momPct != null ? ` (${worstMonth.momPct.toFixed(1)}%)` : ''}.</>}
              </P>
            )}
          </Section>

          {(proj30d != null || proj90d != null) && (
            <Section title="If this pace continues" accent="var(--amber)">
              <P>
                This is a straight-line guess based on the recent trend — not a forecast or a
                promise, just "if nothing changes." At the current pace, your balance would be
                around {proj30d != null && <strong>{fmtMoneyFull(proj30d)}</strong>} in 30 days
                {proj90d != null && <> and around <strong>{fmtMoneyFull(proj90d)}</strong> in 90 days</>}.
              </P>
            </Section>
          )}

          {distToNext != null && distToNext > 0 && (
            <Section title="Next milestone">
              <P>
                You're <strong>{fmtMoneyFull(distToNext)}</strong> away from your
                next <strong>{fmtMoneyFull(nextMilestone)}</strong> milestone.
              </P>
            </Section>
          )}

          {accounts.length > 0 && (
            <Section title="How your money is split">
              <P>
                {accounts.map((a, i) => (
                  <span key={a.label}>
                    {i > 0 && ' · '}
                    <strong>{a.label}</strong> {a.pct.toFixed(0)}%
                  </span>
                ))}
              </P>
            </Section>
          )}

          <Section title="Quick glossary">
            <P><strong>All-time high (HWM)</strong> — the highest your balance has ever reached.</P>
            <P><strong>Drawdown</strong> — how far below that peak you are right now.</P>
            <P><strong>12-month return</strong> — how much your balance grew (or shrank) over the last year.</P>
          </Section>

        </div>
      </div>
    </div>
  )
}
