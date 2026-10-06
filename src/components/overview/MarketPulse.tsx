/**
 * Overview "Today" additions:
 *   MarketsToday  — S&P 500 · Dow · Nasdaq · VIX: level, day change, 10-day line
 *   LastSessions  — portfolio value (line) and daily P&L (bars), last 10 sessions
 */
import { useMemo } from 'react'
import { ComposedChart, Line, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useBalanceHistory, useMarketIndices } from '../../hooks/useDashboardData'
import { CHART, AXIS, LINE_PROPS, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS, TOOLTIP_CURSOR } from '../ui/chartTheme'
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
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
            <YAxis yAxisId="v" hide domain={['dataMin', 'dataMax']} />
            <YAxis yAxisId="p" hide orientation="right" domain={([lo, hi]: readonly [number, number]): [number, number] => {
              const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1
              return [-m * 2.2, m * 2.2]      // keep the bars in the lower band, under the value line
            }} />
            <ReferenceLine yAxisId="p" y={0} stroke="var(--fd-hairline)" />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
              formatter={(v, name) => [name === 'pnl' ? signedMoney(Number(v), fmtFull) : fmtFull(Number(v)), name === 'pnl' ? 'Day P&L' : 'Portfolio']}
            />
            <Bar yAxisId="p" dataKey="pnl" maxBarSize={14} isAnimationActive={false}>
              {rows.map((r, i) => <Cell key={i} fill={(r.pnl ?? 0) >= 0 ? CHART.positive : CHART.negative} />)}
            </Bar>
            <Line yAxisId="v" dataKey="value" stroke="var(--fd-ink)" {...LINE_PROPS} strokeWidth={2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', gap: 20 }}>
        <Label><span style={{ display: 'inline-block', width: 12, height: 2, background: 'var(--fd-ink)', verticalAlign: 'middle', marginRight: 6 }} />Portfolio value · {fmtK(last)}</Label>
        <Label><span style={{ display: 'inline-block', width: 8, height: 8, background: CHART.positive, verticalAlign: 'middle', marginRight: 6 }} />Daily P&L</Label>
      </div>
      <span style={{ fontSize: 12, ...muted }}>Daily P&L is the change in total value, so deposits and withdrawals show up in it.</span>
    </Section>
    </WsSection>
  )
}
