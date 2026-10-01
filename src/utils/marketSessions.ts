/**
 * marketSessions — single source of truth for "what part of the trading day
 * is it right now," across every exchange the Signals tab reads from. Pure
 * functions, no React — same pattern as roadmapEngine/retirementEngine.
 *
 * Two exchanges matter here:
 *  - NYSE (US targets + most of the chain) — session comes from the
 *    calendar-aware /api/market_status payload (holidays, early closes).
 *  - KRX (Samsung 005930.KS) — no backend calendar for this one; computed
 *    client-side from fixed hours since Korea has no DST. Holiday-naive
 *    (Korean market holidays aren't modeled) — acceptable since a stale
 *    "open" read only means the pre-warning framing below is silently
 *    skipped on those days, not wrong in the other direction. SK Hynix is
 *    tracked via its US OTC listing (SKHYV), which trades on US hours
 *    alongside the rest of the chain — it does not use this KRX clock.
 *
 * Why this matters for a pre-warning system: KRX's 9:00–15:30 KST session
 * closes at 1:30–2:30 AM ET — hours before the US premarket window even
 * opens (~4 AM ET). So on a morning when KRX has already closed, Samsung's
 * number is a *settled* read, not a still-moving one — it is, structurally,
 * the earliest confirmed data point in the whole chain.
 */
import type { MarketStatus } from '../types/dashboard'

export type UsMarketSession = 'premarket' | 'regular' | 'afterhours' | 'closed'

/** Derives premarket/regular/afterhours/closed from the NYSE calendar payload.
 * 'afterhours' relies on market_open_utc/market_close_utc staying populated
 * with *today's* (already-passed) open/close on a trading day — see
 * server/market_calendar.py's get_market_status — so "not open" + "past
 * close" is unambiguous without a separate flag. */
export function computeUsSession(marketStatus: MarketStatus | null | undefined): UsMarketSession {
  if (!marketStatus) return 'closed'
  if (marketStatus.is_open) return 'regular'
  if (!marketStatus.is_trading_day || !marketStatus.market_open_utc || !marketStatus.market_close_utc) return 'closed'
  const minsToOpen = (new Date(marketStatus.market_open_utc).getTime() - Date.now()) / 60000
  if (minsToOpen > 0 && minsToOpen <= 330) return 'premarket'
  const minsSinceClose = (Date.now() - new Date(marketStatus.market_close_utc).getTime()) / 60000
  if (minsSinceClose >= 0) return 'afterhours'
  return 'closed'
}

export type KrxSession = 'open' | 'closed'

const KRX_OPEN_MIN  = 9 * 60        // 9:00 KST
const KRX_CLOSE_MIN = 15 * 60 + 30  // 15:30 KST

function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
}

/** KRX hours: 9:00–15:30 KST (UTC+9), weekdays. Holiday-naive — see module note. */
export function computeKrxSession(): KrxSession {
  const kst = kstNow()
  const day = kst.getUTCDay()
  if (day === 0 || day === 6) return 'closed'
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  return mins >= KRX_OPEN_MIN && mins < KRX_CLOSE_MIN ? 'open' : 'closed'
}

/** Hours since KRX's most recent close — null while KRX is open or on a KST
 * weekend (no "close" to measure from without holiday-aware lookback). Used
 * to frame Korea data as a settled, already-final pre-warning read once
 * enough time has passed for it to be confidently "today's session." */
export function hoursSinceKrxClose(): number | null {
  const kst = kstNow()
  const day = kst.getUTCDay()
  if (day === 0 || day === 6) return null
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  if (mins < KRX_CLOSE_MIN) return null
  return (mins - KRX_CLOSE_MIN) / 60
}
