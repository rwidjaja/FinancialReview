/**
 * Overview rail › Market character (advanced) — v4 port of the v3
 * PortfolioValueHero 5-session block: open→close bars, daily move summary,
 * buyer/seller stats and buyer pressure. Same session math as v3.
 */
import { useMemo } from 'react'
import { useBalanceHistory } from '../../hooks/useDashboardData'
import { directionInfo, dayScoreSimple } from '../../utils/sessionMetrics'
import { fmtMoneyFull } from '../../utils/formatters'
import type { BalanceSnapshot, DashboardData } from '../../types/dashboard'
import { RuledList, MonoNote, mono, muted, gain, signedPct, signedMoney } from '../ui/primitives'

interface Session {
  dayLabel: string; date: string
  open: number | null; close: number | null
  high: number | null; low: number | null
  delta: number | null; pct: number | null
}

const row = (label: string, value: string, color?: string, title?: string) => (
  <div key={label} title={title} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
    <span style={muted}>{label}</span><span style={{ fontWeight: 500, color }}>{value}</span>
  </div>
)

export function MarketCharacterRail({ data }: { data: DashboardData }) {
  const s = data.summary
  const { data: balHistory } = useBalanceHistory(14)

  // Last 5 unique trading dates, oldest → newest
  const balSnapshots = useMemo<BalanceSnapshot[]>(() => {
    if (!balHistory || balHistory.length === 0) return []
    const all = balHistory.slice().reverse()
    const dates = [...new Set(all.map(r => r.date))].slice(-5)
    return all.filter(r => dates.includes(r.date))
  }, [balHistory])

  const rolling5Data = useMemo<Session[]>(() => {
    const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return [...new Set(balSnapshots.map(r => r.date))].map(date => {
      const openSnap = balSnapshots.find(r => r.date === date && r.label === 'open')
      const closeSnap = balSnapshots.find(r => r.date === date && (r.label === 'close' || r.label === 'manual'))
      const open = openSnap?.total_value ?? null
      const close = closeSnap?.total_value ?? null
      const high = closeSnap?.session_high ?? openSnap?.session_high ?? null
      const low = closeSnap?.session_low ?? openSnap?.session_low ?? null
      const delta = open != null && close != null ? close - open : null
      const pct = open != null && delta != null ? (delta / open) * 100 : null
      return { dayLabel: DAY[new Date(date + 'T12:00:00').getDay()], date, open, close, high, low, delta, pct }
    })
  }, [balSnapshots])

  // Today's close snapshot only exists after the close — fall back to the live
  // value so today isn't silently dropped from the character stats.
  const liveValue = s.total_value > 0 ? s.total_value : null
  const rolling5Live = useMemo<Session[]>(() => rolling5Data.map((d, i) => {
    if (i !== rolling5Data.length - 1 || d.close != null || liveValue == null) return d
    const delta = d.open != null ? liveValue - d.open : null
    const pct = d.open != null && d.open > 0 && delta != null ? (delta / d.open) * 100 : null
    return { ...d, close: liveValue, delta, pct }
  }), [rolling5Data, liveValue])

  const mc = useMemo(() => {
    const withData = rolling5Live.filter(d => d.delta != null)
    const up = withData.filter(d => (d.delta ?? 0) > 0)
    const down = withData.filter(d => (d.delta ?? 0) < 0)
    let streak = 0
    let streakDir: 'buy' | 'sell' | null = null
    for (let i = withData.length - 1; i >= 0; i--) {
      const dir: 'buy' | 'sell' = (withData[i].delta ?? 0) >= 0 ? 'buy' : 'sell'
      if (streakDir === null) { streakDir = dir; streak = 1 } else if (dir === streakDir) streak++; else break
    }
    const closes = rolling5Live.filter(d => d.close != null)
    return {
      n: withData.length, buyerWins: up.length, sellerWins: down.length,
      netIntraday: withData.reduce((t, d) => t + (d.delta ?? 0), 0),
      avgUp: up.length ? up.reduce((t, d) => t + (d.delta ?? 0), 0) / up.length : null,
      avgDown: down.length ? down.reduce((t, d) => t + (d.delta ?? 0), 0) / down.length : null,
      pressure: withData.length ? Math.round((up.length / withData.length) * 100) : null,
      streak, streakDir,
      c2c: closes.length >= 2 ? closes[closes.length - 1].close! - closes[0].close! : null,
    }
  }, [rolling5Live])

  // Daily move (raw rolling5Data so "live" is detectable)
  const today = rolling5Data[rolling5Data.length - 1]
  const prev = rolling5Data.length >= 2 ? rolling5Data[rolling5Data.length - 2] : null
  const isLive = today?.close == null && liveValue != null
  const effClose = today?.close ?? liveValue
  const dovPct = prev?.close != null && effClose != null && prev.close > 0 ? ((effClose - prev.close) / prev.close) * 100 : null
  const gapPct = prev?.close != null && today?.open != null && prev.close > 0 ? ((today.open - prev.close) / prev.close) * 100 : null
  const intradayPct = today?.pct != null ? today.pct
    : today?.open != null && today.open > 0 && effClose != null ? ((effClose - today.open) / today.open) * 100 : null
  const range = today?.high != null && today?.low != null ? today.high - today.low : null
  const closePos = range != null && range > 0 && effClose != null ? ((effClose - today!.low!) / range) * 100 : null
  const score = dayScoreSimple(intradayPct, dovPct)
  const dir = directionInfo(dovPct)

  const maxAbs = Math.max(1, ...rolling5Live.map(d => Math.abs(d.delta ?? 0)))
  const fmtD = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Market character</h3>
        {today && <span style={mono} title="Day score: 0 = weak · 100 = perfect close">Score {score}</span>}
      </div>

      {rolling5Data.every(d => d.close == null) ? (
        <RuledList><MonoNote>Captured at open (9:30 ET) and close (4:00 ET). Appears after the first session.</MonoNote></RuledList>
      ) : (<>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${rolling5Live.length}, 1fr)`, gap: 8, height: 96, borderTop: '2px solid var(--fd-rule)', borderBottom: '1px solid var(--fd-hairline)', position: 'relative' }}>
          {rolling5Live.map(d => {
            const h = d.delta == null ? 0 : (Math.abs(d.delta) / maxAbs) * 40
            return (
              <div key={d.date} title={`${d.date}${d.open != null ? ` · open ${fmtMoneyFull(d.open)}` : ''}${d.close != null ? ` · close ${fmtMoneyFull(d.close)}` : ''}${d.delta != null ? ` · ${signedMoney(d.delta, fmtMoneyFull)} (${signedPct(d.pct)})` : ''}`}
                style={{ position: 'relative' }}>
                {/* zero line at 50%: up bars grow up, down bars grow down */}
                <div style={{ position: 'absolute', left: 0, right: 0, height: h, background: d.delta == null ? 'var(--fd-hairline)' : gain(d.delta),
                  ...(d.delta != null && d.delta < 0 ? { top: '50%' } : { bottom: '50%' }) }} />
              </div>
            )
          })}
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', borderTop: '1px dashed var(--fd-hairline)' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${rolling5Live.length}, 1fr)`, gap: 8, ...mono, ...muted, textAlign: 'center' }}>
          {rolling5Live.map(d => <span key={d.date}>{d.dayLabel}</span>)}
        </div>
        <span style={{ ...mono, ...muted }}>{fmtD(rolling5Data[0].date)} – {fmtD(rolling5Data[rolling5Data.length - 1].date)}{dir.label !== '—' ? ` · ${dir.label}` : ''}</span>

        {row(`vs prior close${isLive ? ', live' : ''}`, signedPct(dovPct), dovPct != null ? gain(dovPct) : undefined)}
        {row('Gap, overnight', signedPct(gapPct), gapPct != null ? gain(gapPct) : undefined, 'Prev close → open')}
        {row(`Intraday${isLive ? ', live' : ''}`, signedPct(intradayPct), intradayPct != null ? gain(intradayPct) : undefined, isLive ? 'Open → now' : 'Open → close')}
        {row('Position in range', closePos != null ? `${closePos.toFixed(0)}%` : '—', undefined, "Where the close sits in the day's high–low range")}

        <div style={{ borderTop: '1px solid var(--fd-hairline)' }} />
        {row('Buyer wins', `${mc.buyerWins} of ${mc.n}`, undefined, 'Sessions with close > open')}
        {row('Seller wins', `${mc.sellerWins} of ${mc.n}`, undefined, 'Sessions with close < open')}
        {row('Net intraday', mc.netIntraday !== 0 ? signedMoney(mc.netIntraday, fmtMoneyFull) : '—', gain(mc.netIntraday), 'Sum of close − open; excludes overnight gaps')}
        {row('Avg up day', mc.avgUp != null ? signedMoney(mc.avgUp, fmtMoneyFull) : '—', 'var(--fd-accent)')}
        {row('Avg down day', mc.avgDown != null ? signedMoney(mc.avgDown, fmtMoneyFull) : '—', 'var(--fd-negative)')}
        {row('Close to close', mc.c2c != null ? signedMoney(mc.c2c, fmtMoneyFull) : '—', mc.c2c != null ? gain(mc.c2c) : undefined, 'True 5-session P&L including gaps')}
        {mc.pressure != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid var(--fd-hairline)', paddingTop: 10 }}>
            <span style={muted}>Buyer pressure</span>
            <span style={{ fontWeight: 500 }}>{mc.pressure}%{mc.streakDir && mc.streak >= 2 ? ` · ${mc.streakDir === 'buy' ? 'buyers' : 'sellers'} won ${mc.streak} in a row` : ''}</span>
          </div>
        )}
      </>)}
    </div>
  )
}
