/**
 * Overview "Today" additions:
 *   MarketsToday  — S&P 500 · Dow · Nasdaq · VIX: level, day change, 10-day line
 *   LastSessions  — portfolio value line (dots coloured by day P&L), last 10 sessions
 */
import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useBalanceHistory, useMarketIndices } from '../../hooks/useDashboardData'
import { CHART, AXIS, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTheme'
import { fmtFull, fmtK } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { WsSection } from '../workspace/WorkspaceContext'
import { Section, RuledList, MonoNote, Label, gain, muted, signedMoney, signedPct } from '../ui/primitives'

/** Tiny inline line: no axes, coloured by the 10-day direction. */
function Sparkline({ values, width = 96, height = 28, color }: { values: number[]; width?: number; height?: number; color: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function MarketsToday({ data }: { data: DashboardData }) {
  const { data: mi, isLoading, error } = useMarketIndices()
  const rows = mi?.indices ?? []
  // VIX: higher is worse, so its colours invert.
  const tone = (name: string, n: number) => gain(name === 'VIX' ? -n : n)
  const sp = rows.find(r => r.name === 'S&P 500')

  return (
    <WsSection id="markets" value={sp ? `S&P ${signedPct(sp.change_pct)}` : undefined}
      status={!sp ? 'info' : sp.change_pct >= 0 ? 'ok' : sp.change_pct > -1 ? 'watch' : 'warn'}>
    <Section title="Markets today" meta={data.vix_90d_avg != null ? `VIX 90d avg ${data.vix_90d_avg.toFixed(1)}` : undefined}>
      {isLoading && <MonoNote>Loading indices…</MonoNote>}
      {!isLoading && (error || rows.length === 0) && <MonoNote>Index data unavailable</MonoNote>}
      {rows.length > 0 && (
        <RuledList>
          {rows.map(r => {
            const closes = r.history.map(h => h.close)
            const tenDay = closes.length > 1 ? (closes[closes.length - 1] / closes[0] - 1) * 100 : null
            return (
              <div key={r.ticker} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 96px auto', gap: 16, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{r.name}</span>
                  <span style={{ fontSize: 13, ...muted }}>
                    {r.price.toLocaleString('en-US', { maximumFractionDigits: r.name === 'VIX' ? 2 : 0 })}
                    {tenDay != null && <> · 10d <span style={{ color: tone(r.name, tenDay) }}>{signedPct(tenDay, 1)}</span></>}
                  </span>
                </div>
                <Sparkline values={closes} color={tenDay != null ? tone(r.name, tenDay) : 'var(--fd-muted)'} />
                <span style={{ fontSize: 16, fontWeight: 500, color: tone(r.name, r.change_pct), textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {signedPct(r.change_pct)}
                </span>
              </div>
            )
          })}
        </RuledList>
      )}
    </Section>
    </WsSection>
  )
}

interface DayRow { date: string; label: string; value: number; pnl: number | null }

/** Last 10 sessions: one value per trading date (close preferred), today's live value appended. */
function useLastSessions(data: DashboardData): DayRow[] {
  const { data: snaps } = useBalanceHistory(30)
  const live = data.summary?.total_value
  return useMemo(() => {
    const byDate: Record<string, number> = {}
    const rank: Record<string, number> = {}
    for (const r of snaps ?? []) {
      const k = r.label === 'close' ? 2 : r.label === 'manual' ? 1 : 0
      if (byDate[r.date] == null || k >= rank[r.date]) { byDate[r.date] = r.total_value; rank[r.date] = k }
    }
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    if (live && live > 0) byDate[today] = live           // live value beats an open/intraday snapshot
    const dates = Object.keys(byDate).sort()
    const rows = dates.map((d, i) => ({
      date: d,
      label: new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: byDate[d],
      pnl: i > 0 ? byDate[d] - byDate[dates[i - 1]] : null,
    }))
    return rows.slice(-10)
  }, [snaps, live])
}

export function LastSessions({ data }: { data: DashboardData }) {
  const rows = useLastSessions(data)
  if (rows.length < 2) {
    return <WsSection id="sessions10"><Section title="Last 10 sessions"><MonoNote>Not enough balance history yet</MonoNote></Section></WsSection>
  }
  const first = rows[0].value, last = rows[rows.length - 1].value
  const net = last - first
  const pnls = rows.map(r => r.pnl).filter((v): v is number => v != null)
  const up = pnls.filter(v => v > 0).length

  return (
    <WsSection id="sessions10" value={signedMoney(net, fmtK)} status={net >= 0 ? 'ok' : 'watch'}>
    <Section title="Last 10 sessions" meta={`${up} up · ${pnls.length - up} down`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 24, fontWeight: 500, color: gain(net) }}>{signedMoney(net, fmtFull)}</span>
        <span style={{ fontSize: 13, color: gain(net) }}>{signedPct(first > 0 ? (net / first) * 100 : 0)} since {rows[0].label}</span>
      </div>
      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 10, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
            <YAxis hide domain={[(lo: number) => lo * 0.997, (hi: number) => hi * 1.003]} />
            <ReferenceLine y={first} stroke="var(--fd-hairline)" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS}
              cursor={{ stroke: 'var(--fd-hairline)' }}
              formatter={(v, _n, item) => {
                const pnl = (item?.payload as DayRow | undefined)?.pnl
                return [`${fmtFull(Number(v))}${pnl != null ? ` · day ${signedMoney(pnl, fmtFull)}` : ''}`, 'Portfolio']
              }}
            />
            {/* One line for value; each session's dot is coloured by that day's P&L. */}
            <Line dataKey="value" stroke={gain(net)} strokeWidth={2.5} type="monotone" isAnimationActive={false}
              dot={(p: { cx?: number; cy?: number; index?: number }) => {
                const r = rows[p.index ?? 0]
                const c = r?.pnl == null ? 'var(--fd-muted)' : r.pnl >= 0 ? CHART.positive : CHART.negative
                return <circle key={p.index} cx={p.cx} cy={p.cy} r={3.5} fill="var(--fd-page)" stroke={c} strokeWidth={2} />
              }}
              activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Daily P&L as a compact strip under the line, same order as the dots */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))`, gap: 2 }}>
        {rows.map(r => (
          <div key={r.date} title={`${r.label}: ${r.pnl == null ? '—' : signedMoney(r.pnl, fmtFull)}`} style={{
            height: 6, background: r.pnl == null ? 'var(--fd-hairline)' : r.pnl >= 0 ? CHART.positive : CHART.negative,
            opacity: r.pnl == null ? 1 : 0.35 + 0.65 * Math.min(1, Math.abs(r.pnl) / Math.max(1, ...pnls.map(Math.abs))),
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Label>Value {fmtK(last)} · dashed line = {rows[0].label}</Label>
        <Label>Best day {signedMoney(Math.max(...pnls), fmtK)} · worst {signedMoney(Math.min(...pnls), fmtK)}</Label>
      </div>
      <span style={{ fontSize: 12, ...muted }}>Daily P&L is the change in total value, so deposits and withdrawals show up in it.</span>
    </Section>
    </WsSection>
  )
}
