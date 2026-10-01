import { PanelHeader } from '../ui/Terminal'
import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'

function daysColor(days: number | null) {
  if (days === null) return G
  if (days <= 30)    return 'var(--cyan)'
  if (days <= 90)    return Y
  return M
}

function daysLabel(days: number | null) {
  if (days === null || days === 0) return 'LTCG ✓'
  if (days <= 7)  return `${days}d `
  return `${days}d`
}

export function LotMaturityPanel({ tx }: { tx: DashboardData['tax_data'] }) {
  const lots      = tx.cost_basis_lots ?? {}
  const calendar  = tx.ltcg_maturity_calendar ?? []
  const hasData   = Object.keys(lots).length > 0

  if (!hasData) {
    return (
      <div style={{ padding: '16px 14px', color: M, fontSize: 12 }}>
        No lot data — add a <code>schwab_cost.json</code> file to the server directory with per-lot acquired dates.
      </div>
    )
  }

  const totalStcgGain = tx.total_stcg_unrealized_gain ?? 0
  const totalLtcgGain = tx.total_ltcg_unrealized_gain ?? 0
  const totalStcgLoss = tx.total_stcg_unrealized_loss ?? 0
  const totalLtcgLoss = tx.total_ltcg_unrealized_loss ?? 0
  const totalUnrealized = totalStcgGain + totalLtcgGain + totalStcgLoss + totalLtcgLoss

  const symRows = Object.entries(lots)
    .map(([sym, s]) => ({ sym, ...s }))
    .sort((a, b) => b.total_unrealized - a.total_unrealized)

  const upcomingFlips = calendar

  const flipsByMonth: Record<string, typeof upcomingFlips> = {}
  for (const ev of upcomingFlips) {
    const d = new Date(ev.date + 'T00:00:00')
    const key = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    if (!flipsByMonth[key]) flipsByMonth[key] = []
    flipsByMonth[key].push(ev)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        {[
          { label: 'STCG UNREALIZED GAIN',  val: totalStcgGain, color: 'var(--red)', note: 'taxed as ordinary income if sold' },
          { label: 'LTCG UNREALIZED GAIN',  val: totalLtcgGain, color: Y, note: 'taxed at 0–20% LTCG rate if sold' },
          { label: 'STCG UNREALIZED LOSS',  val: totalStcgLoss, color: G, note: 'unrealized loss — informational' },
          { label: 'TOTAL UNREALIZED (COST BASIS)', val: totalUnrealized, color: totalUnrealized > 0 ? Y : G, note: 'net across all lots' },
        ].map((t, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
            <div className="bb-label">{t.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: t.color, fontFamily: 'var(--font-mono)', margin: '4px 0' }}>
              {fmtMoneyFull(t.val)}
            </div>
            <div style={{ fontSize: 12, color: M }}>{t.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

        <div style={{ background: 'var(--surface)', padding: '10px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <PanelHeader>UNREALIZED GAIN CLASSIFICATION BY SYMBOL</PanelHeader>
          <div style={{ fontSize: 12, color: M, marginBottom: 8 }}>
            Based on acquired dates — lots held &gt; 365 days are LTCG
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 400 }}>
            <table className="bb-table">
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                <tr>
                  <th>SYM</th>
                  <th className="r" style={{ color: 'var(--red)' }}>STCG GAIN</th>
                  <th className="r" style={{ color: Y }}>LTCG GAIN</th>
                  <th className="r" style={{ color: G }}>LOSS</th>
                  <th className="r">NEXT FLIP</th>
                  <th className="r">DAYS</th>
                </tr>
              </thead>
              <tbody>
                {symRows.map(s => {
                  const lossTotal = s.stcg_loss + s.ltcg_loss
                  return (
                    <tr key={s.sym}>
                      <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{s.sym}</td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: s.stcg_gain > 0 ? 'var(--red)' : M, fontWeight: s.stcg_gain > 0 ? 700 : 400 }}>
                        {s.stcg_gain > 0 ? fmtMoneyFull(s.stcg_gain) : '—'}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: s.ltcg_gain > 0 ? Y : M, fontWeight: s.ltcg_gain > 0 ? 700 : 400 }}>
                        {s.ltcg_gain > 0 ? fmtMoneyFull(s.ltcg_gain) : '—'}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', color: lossTotal < 0 ? G : M }}>
                        {lossTotal < 0 ? fmtMoneyFull(lossTotal) : '—'}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: daysColor(s.days_to_next_lt) }}>
                        {s.next_lt_flip_date ?? '—'}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: daysColor(s.days_to_next_lt) }}>
                        {daysLabel(s.days_to_next_lt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ background: 'var(--surface)', padding: '10px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <PanelHeader>LTCG MATURITY CALENDAR</PanelHeader>
          <div style={{ fontSize: 12, color: M, marginBottom: 8 }}>
            Each lot flips from STCG → LTCG on its maturity date. Do not sell before this date.
          </div>

          {Object.entries(flipsByMonth).length === 0 ? (
            <div style={{ fontSize: 12, color: G, padding: '8px 0' }}>
              ✓ All lots are already LTCG — no upcoming ST→LT transitions.
            </div>
          ) : (
            <div style={{ overflowY: 'auto', maxHeight: 340, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Object.entries(flipsByMonth).map(([month, events]) => {
                const totalGainFlipping = events.reduce((s, e) => s + (e.gain > 0 ? e.gain : 0), 0)
                return (
                  <div key={month}>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '3px 6px', background: 'var(--surface)',
                      borderLeft: `3px solid ${daysColor(events[0].days_away)}`,
                      marginBottom: 4,
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: daysColor(events[0].days_away), fontFamily: 'var(--font-mono)' }}>
                        {month}
                      </span>
                      <span style={{ fontSize: 12, color: M }}>
                        {events.length} lot{events.length > 1 ? 's' : ''} · {fmtMoneyFull(totalGainFlipping)} flipping to LTCG
                      </span>
                    </div>
                    {events.map((ev, i) => (
                      <div key={i} style={{
                        display: 'grid', gridTemplateColumns: '70px 1fr 80px 70px 60px',
                        fontSize: 12, padding: '3px 6px',
                        borderBottom: i < events.length - 1 ? '1px solid var(--border)' : 'none',
                        alignItems: 'center',
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text)' }}>{ev.symbol}</span>
                        <span style={{ color: M }}>{ev.shares.toLocaleString()} sh · acq {ev.acq_date}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', color: ev.gain >= 0 ? Y : G, fontWeight: 500 }}>
                          {fmtMoneyFull(ev.gain)}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', color: M, fontSize: 12 }}>
                          {ev.date}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', fontWeight: 500, color: daysColor(ev.days_away) }}>
                          {daysLabel(ev.days_away)}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          {symRows.length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--border2)', margin: '10px 0' }} />
              <PanelHeader>LOT DETAIL</PanelHeader>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {symRows.map(s => (
                  <div key={s.sym} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: A, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                      {s.sym} — {s.lots.length} lot{s.lots.length > 1 ? 's' : ''}
                    </div>
                    {s.lots.map((lot, i) => (
                      <div key={i} style={{
                        display: 'grid', gridTemplateColumns: '80px 50px 70px 75px 1fr',
                        fontSize: 12, padding: '2px 4px',
                        background: i % 2 === 0 ? 'transparent' : 'var(--panel)',
                        color: M, alignItems: 'center',
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{lot.acquired_date}</span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{lot.quantity.toLocaleString()} sh</span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: lot.gain_loss >= 0 ? Y : G, fontWeight: 500 }}>
                          {fmtMoneyFull(lot.gain_loss)}
                        </span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: daysColor(lot.days_to_lt) }}>
                          {lot.is_ltcg ? '✓ LTCG' : `→ ${lot.lt_date}`}
                        </span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, color: daysColor(lot.days_to_lt) }}>
                          {daysLabel(lot.days_to_lt)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
