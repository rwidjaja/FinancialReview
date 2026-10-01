import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, BarChart, Bar, CartesianGrid } from 'recharts'
import { Cell } from 'recharts'
import { fmtMoneyFull } from '../../utils/formatters'
import type { Portfolio, SnapshotPoint } from './types'
import { G, R, A, M, B } from './constants'
import { StatBox, fmtPct } from './shared'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'

type PerfPeriod = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'

export function SimPerformanceTab({ port, history }: { port: Portfolio; history: SnapshotPoint[] }) {
  const [view,   setView]   = useState<'value' | 'return' | 'drawdown'>('value')
  const [period, setPeriod] = useState<PerfPeriod>('1Y')

  const seed     = port.seed_capital || 1
  const holdings = port.holdings ?? []
  const tv       = port.total_value || 1

  // ── Period filter ─────────────────────────────────────────────────────────
  const cutoff = (() => {
    const d = new Date()
    if (period === '1M')  { d.setMonth(d.getMonth() - 1);          return d.toISOString().slice(0, 10) }
    if (period === '3M')  { d.setMonth(d.getMonth() - 3);          return d.toISOString().slice(0, 10) }
    if (period === '6M')  { d.setMonth(d.getMonth() - 6);          return d.toISOString().slice(0, 10) }
    if (period === 'YTD') { d.setMonth(0, 1);                      return d.toISOString().slice(0, 10) }
    if (period === '1Y')  { d.setFullYear(d.getFullYear() - 1);    return d.toISOString().slice(0, 10) }
    return null
  })()
  const filtered = cutoff ? history.filter(h => h.snapshot_date >= cutoff) : history

  // ── Enrich filtered history ───────────────────────────────────────────────
  const periodSeed = filtered[0]?.total_value ?? seed
  const enriched = filtered.map((h, i) => {
    const prev = i > 0 ? filtered[i - 1].total_value : h.total_value
    return {
      ...h,
      date_short:   h.snapshot_date.slice(5),
      return_pct:   ((h.total_value - periodSeed) / periodSeed) * 100,
      spy_ret_pct:  h.spy_value != null
                      ? ((h.spy_value - (filtered[0]?.spy_value ?? h.spy_value)) /
                         (filtered[0]?.spy_value ?? h.spy_value)) * 100
                      : null,
      daily_pnl:    h.total_value - prev,
      daily_pct:    prev > 0 ? ((h.total_value - prev) / prev) * 100 : 0,
    }
  })

  // Running drawdown over filtered period
  let peak = periodSeed
  const withDD = enriched.map(h => {
    if (h.total_value > peak) peak = h.total_value
    return { ...h, drawdown: peak > 0 ? ((h.total_value - peak) / peak) * 100 : 0 }
  })

  // KPI metrics (always all-time)
  const allDays   = history.length
  const nowVal    = history[history.length - 1]?.total_value ?? port.total_value
  let runPk = seed, maxDD = 0
  history.forEach(h => {
    if (h.total_value > runPk) runPk = h.total_value
    const dd = runPk > 0 ? (h.total_value - runPk) / runPk * 100 : 0
    if (dd < maxDD) maxDD = dd
  })
  const allEnriched = history.map((h, i) => {
    const prev = i > 0 ? history[i - 1].total_value : h.total_value
    return { daily_pct: prev > 0 ? ((h.total_value - prev) / prev) * 100 : 0 }
  })
  const dailies  = allEnriched.slice(1).map(h => h.daily_pct)
  const bestDay  = dailies.length ? Math.max(...dailies) : 0
  const worstDay = dailies.length ? Math.min(...dailies) : 0
  const cagr     = allDays >= 2
    ? (Math.pow(nowVal / seed, 365 / allDays) - 1) * 100
    : null

  // Monthly P&L within selected period
  const byMonth: Record<string, number> = {}
  enriched.forEach((h, i) => {
    if (i === 0) return
    const mo = h.snapshot_date.slice(0, 7)
    byMonth[mo] = (byMonth[mo] ?? 0) + h.daily_pnl
  })
  const monthlyData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnl]) => ({ month: month.slice(5), pnl }))

  // Holding heatmap color
  function heatColor(pct: number): string {
    if (pct >  15) return 'var(--fd-accent)'
    if (pct >   8) return 'var(--fd-accent)'
    if (pct >   2) return 'var(--fd-accent)'
    if (pct >  -2) return 'var(--fd-accent)'
    if (pct >  -8) return 'var(--fd-negative)'
    if (pct > -15) return 'var(--fd-negative)'
    return 'var(--fd-negative)'
  }

  const hasSpy = enriched.some(h => h.spy_ret_pct != null)
  const chartData = view === 'drawdown' ? withDD : enriched

  if (history.length < 2) {
    return (
      <div style={{ padding: 24, color: M, fontSize: 12, textAlign: 'center' }}>
        No history yet — buy some positions and come back.<br />
        <span style={{ fontSize: 12 }}>Performance is computed from your transactions + yfinance historical prices.</span>
      </div>
    )
  }

  const PERIODS: PerfPeriod[] = ['1M','3M','6M','YTD','1Y','ALL']

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12,
      fontFamily: 'var(--font-mono)' }}>

      {/* ── KPI row (all-time) ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <StatBox label="Total Return"
          color={port.total_return >= 0 ? G : R}
          value={`${port.total_return >= 0 ? '+' : ''}${fmtMoneyFull(port.total_return)}`}
          sub={fmtPct(port.total_return_pct)} />
        {cagr !== null && (
          <StatBox label="Ann. CAGR" color={cagr >= 0 ? G : R}
            value={fmtPct(cagr)} sub={`${allDays}d tracked`} />
        )}
        <StatBox label="Max Drawdown"
          color={maxDD < -10 ? R : maxDD < -5 ? A : M}
          value={fmtPct(maxDD, 2)} />
        <StatBox label="Best Day"  color={G} value={fmtPct(bestDay,  2)} />
        <StatBox label="Worst Day" color={R} value={fmtPct(worstDay, 2)} />
        <StatBox label="Seed" value={fmtMoneyFull(seed)} />
      </div>

      {/* ── Period selector + chart type ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        {/* Period pills */}
        <div style={{ display: 'flex', gap: 1 }}>
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding: '3px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              background: period === p ? 'var(--fd-card)' : 'none',
              border: `1px solid ${period === p ? 'var(--fd-accent)' : 'var(--border2)'}`,
              color: period === p ? B : M,
            }}>{p}</button>
          ))}
        </div>
        {/* View toggle */}
        <div style={{ display: 'flex', gap: 1 }}>
          {(['value','return','drawdown'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '3px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              background: view === v ? 'var(--fd-card)' : 'none',
              border: `1px solid ${view === v ? 'var(--border2)' : 'transparent'}`,
              color: view === v ? 'var(--text)' : M,
            }}>{v === 'value' ? 'Value $' : v === 'return' ? 'Return %' : 'Drawdown'}</button>
          ))}
        </div>
      </div>

      {/* ── Main chart: portfolio + SPY ───────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: A,
            textTransform: 'uppercase', letterSpacing: '1px' }}>
            ◈ {view === 'value' ? 'PORTFOLIO VALUE' : view === 'return' ? 'CUMULATIVE RETURN' : 'DRAWDOWN'} — {period}
          </span>
          {hasSpy && (
            <div style={{ display: 'flex', gap: 10, fontSize: 12, color: M }}>
              <span><span style={{ color: B }}>━━</span> Portfolio</span>
              <span><span style={{ color: 'var(--fd-muted)' }}>━━</span> SPY</span>
            </div>
          )}
        </div>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" />
              <XAxis dataKey="date_short" tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }}
                interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }} tickFormatter={v =>
                view === 'value' ? `$${(v/1000).toFixed(0)}K` : `${v.toFixed(1)}%`
              } />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                labelFormatter={l => String(l)}
                formatter={(v: unknown, name: unknown) => {
                  const n = Number(v)
                  const lbl = String(name)
                  if (view === 'value')
                    return [`$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, lbl]
                  return [`${n.toFixed(2)}%`, lbl]
                }}
              />
              {/* Portfolio line */}
              <Line type="monotone" name="Portfolio"
                dataKey={view === 'value' ? 'total_value' : view === 'return' ? 'return_pct' : 'drawdown'}
                stroke={view === 'drawdown' ? R : B}
                dot={false} strokeWidth={2} />
              {/* SPY benchmark line */}
              {hasSpy && view !== 'drawdown' && (
                <Line type="monotone" name="SPY"
                  dataKey={view === 'value' ? 'spy_value' : 'spy_ret_pct'}
                  stroke="var(--fd-muted)" strokeDasharray="4 3"
                  dot={false} strokeWidth={1.5} />
              )}
              {/* Seed capital baseline on value view */}
              {view === 'value' && (
                <Line type="monotone" name="Seed"
                  dataKey={() => seed}
                  stroke="var(--fd-muted)" strokeDasharray="2 4"
                  dot={false} strokeWidth={1} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Monthly P&L bars ─────────────────────────────────────────────── */}
      {monthlyData.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: A,
            textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
            ◈ MONTHLY P&L — {period}
          </div>
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }}
                  tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                <Tooltip
                  contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                  formatter={(v: unknown) => {
                    const n = Number(v)
                    return [`${n >= 0 ? '+' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 'P&L']
                  }}
                />
                <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                  {monthlyData.map((_d, i) => (
                    <Cell key={i} fill={_d.pnl >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Holding performance heatmap ───────────────────────────────────── */}
      {holdings.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: A,
            textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            ◈ HOLDING PERFORMANCE MAP
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {[...holdings]
              .sort((a, b) => b.market_value - a.market_value)
              .map(h => {
                const wt   = h.market_value / tv
                const minW = 60, maxW = 200
                const w    = Math.max(minW, Math.min(maxW, wt * 1200))
                const bg   = heatColor(h.unrealized_pnl_pct)
                return (
                  <div key={h.symbol} style={{
                    width: w, height: 56,
                    background: bg,
                    border: '1px solid var(--fd-hairline)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    padding: '4px 6px', overflow: 'hidden',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)',
                      letterSpacing: '0.5px' }}>{h.symbol}</div>
                    <div style={{ fontSize: 12, fontWeight: 500,
                      color: h.unrealized_pnl_pct >= 0 ? 'var(--fd-accent)' : 'var(--fd-lilac-ink)' }}>
                      {fmtPct(h.unrealized_pnl_pct, 1)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--fd-muted)' }}>
                      {(wt * 100).toFixed(1)}%
                    </div>
                  </div>
                )
              })
            }
            {/* Cash tile */}
            {port.current_cash > 0 && (() => {
              const wt = port.current_cash / tv
              const w  = Math.max(48, Math.min(160, wt * 1200))
              return (
                <div style={{
                  width: w, height: 56,
                  background: 'var(--fd-card)',
                  border: '1px solid var(--fd-hairline)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: M }}>CASH</div>
                  <div style={{ fontSize: 12, color: M }}>{(wt * 100).toFixed(1)}%</div>
                </div>
              )
            })()}
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {[['> +15%','var(--fd-accent)'],['> +8%','var(--fd-accent)'],
              ['> +2%','var(--fd-accent)'],['± 2%','var(--fd-accent)'],
              ['< -2%','var(--fd-negative)'],['< -8%','var(--fd-negative)'],
              ['< -15%','var(--fd-negative)']].map(([lbl, bg]) => (
              <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ width: 10, height: 10, background: bg,
                  border: '1px solid var(--fd-hairline)' }} />
                <span style={{ fontSize: 12, color: M }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
