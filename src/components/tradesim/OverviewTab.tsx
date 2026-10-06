import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, CartesianGrid } from 'recharts'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import type { Portfolio, SnapshotPoint } from './types'
import { G, R, A, M, B, COLORS } from './constants'
import { fmtPct, fmtDate } from './shared'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'
import { WsSection } from '../workspace/WorkspaceContext'
import { useWorkspace } from '../workspace/context'

// Internal helpers used only in OverviewTab (projectPayments, freqDivisor, effectiveNextDate are duplicated here
// to keep OverviewTab self-contained; the canonical copies live in HoldingsTab.tsx)
function freqDivisor(freq: string | null): number {
  if (freq === 'Weekly')      return 52
  if (freq === 'Monthly')     return 12
  if (freq === 'Semi-Annual') return 2
  if (freq === 'Annual')      return 1
  return 4
}

function projectPayments(baseDate: string, frequency: string, limit = 8): string[] {
  const base = new Date(baseDate)
  if (isNaN(base.getTime())) return []
  const freqDays = frequency === 'Weekly'      ? 7
    : frequency === 'Monthly'    ? 30.44
    : frequency === 'Quarterly'  ? 91.31
    : frequency === 'Semi-Annual'? 182.625
    : frequency === 'Annual'     ? 365.25
    : 91.31
  const results: string[] = []
  const today = Date.now()
  let d = new Date(base)
  while (d.getTime() < today - freqDays * 86_400_000) {
    d = new Date(d.getTime() + freqDays * 86_400_000)
  }
  for (let i = 0; i < limit * 3 && results.length < limit; i++) {
    if (d.getTime() >= today - 1_000) {
      results.push(d.toISOString().slice(0, 10))
    }
    d = new Date(d.getTime() + freqDays * 86_400_000)
  }
  return results
}

function daysUntilRaw(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.round((d.getTime() - Date.now()) / 86_400_000)
}

function effectiveNextDate(stored: string | null, freq: string | null): string | null {
  if (!stored || !freq) return stored
  const d = daysUntilRaw(stored)
  if (d !== null && d >= 0) return stored
  const upcoming = projectPayments(stored, freq, 1)
  return upcoming[0] ?? stored
}

export function OverviewTab({ port, history, portfolioId }: { port: Portfolio; history: SnapshotPoint[]; portfolioId: number | null }) {
  const holdings = port.holdings ?? []
  const tv = port.total_value || 1
  const [briefVisible, setBriefVisible] = useState(false)
  const { enabled: inWorkspace } = useWorkspace()
  const briefMutation = useMutation({
    mutationFn: (pid: number) =>
      fetch(`/api/sim/portfolios/${pid}/narrate`).then(r => r.json()),
  })
  const chartData = history.map(h => ({
    date: h.snapshot_date.slice(5),  // MM-DD
    value: h.total_value,
    pnl: h.total_pnl,
  }))

  // Allocation pie
  const alloc = [
    ...holdings.map((h, i) => ({
      name: h.symbol,
      value: h.market_value,
      pct: h.market_value / tv * 100,
      fill: COLORS[i % COLORS.length],
    })),
    { name: 'Cash', value: port.current_cash,
      pct: port.current_cash / tv * 100, fill: 'var(--fd-hairline)' },
  ].filter(a => a.value > 0)

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* AI Brief */}
      <WsSection id="ts_ov_brief">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {portfolioId != null && (
          <button
            onClick={() => {
              setBriefVisible(v => !v)
              if (!briefVisible) briefMutation.mutate(portfolioId)
            }}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
              padding: '3px 10px', border: '1px solid var(--green)',
              background: briefVisible ? 'var(--fd-card)' : 'var(--fd-card)',
              color: 'var(--green)', cursor: briefMutation.isPending ? 'wait' : 'pointer',
              letterSpacing: '0.5px',
            }}
          >{briefMutation.isPending ? '⟳ …' : ' BRIEF'}</button>
        )}
      </div>
      {briefVisible && (
        <div style={{
          padding: '10px 14px', background: 'var(--surface)',
          border: '1px solid var(--fd-hairline)', borderTop: '2px solid var(--green)', borderRadius: 0,
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--green)', fontFamily: 'var(--font-mono)', marginBottom: 6, letterSpacing: '0.5px' }}>
             Portfolio Briefing
            {briefMutation.data?.source && briefMutation.data.source !== 'error' && (
              <span style={{ marginLeft: 8, fontSize: 12, color: M, fontWeight: 400 }}>
                {briefMutation.data.source.startsWith('llm:') ? `LLM · ${briefMutation.data.source.slice(4)}` : briefMutation.data.source.toUpperCase()}
                {briefMutation.data.cached ? ' · CACHED' : ''}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text)' }}>
            {briefMutation.isPending
              ? <span style={{ color: M }}>Generating briefing…</span>
              : briefMutation.data?.narrative || '—'
            }
          </div>
        </div>
      )}
      </WsSection>

      {/* Value chart */}
      {chartData.length > 1 && (
        <WsSection id="ts_ov_value" value={fmtMoney(port.total_value)}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: A,
            textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
            ◈ PORTFOLIO VALUE HISTORY
          </div>
          <div style={{ height: 180, background: 'var(--surface)',
            border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 4px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }}
                  tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                <Tooltip
                  contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                  formatter={(v: unknown) => [`$${Number(v).toLocaleString()}`, 'Value']}
                />
                <Line type="monotone" dataKey="value" stroke={B}
                  dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        </WsSection>
      )}

      {/* Allocation + stats side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: inWorkspace ? '1fr' : '240px 1fr', gap: 12 }}>
        {/* Pie */}
        <WsSection id="ts_ov_alloc" value={`${alloc.length} slices`}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: A,
            textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
            ◈ ALLOCATION
          </div>
          <div style={{ height: 140 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={alloc} dataKey="value" cx="50%" cy="50%"
                  innerRadius={35} outerRadius={58} paddingAngle={2}>
                  {alloc.map((a, i) => <Cell key={i} fill={a.fill} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                  formatter={(v: unknown, name: unknown) => [`${(Number(v)/tv*100).toFixed(1)}%`, String(name)]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {alloc.slice(0, 8).map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center',
              gap: 6, marginBottom: 3 }}>
              <div style={{ width: 6, height: 6, borderRadius: 3,
                background: a.fill, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{a.name}</span>
              <span style={{ fontSize: 12, color: M,
                fontFamily: 'var(--font-mono)' }}>{a.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
        </WsSection>

        {/* Top holdings table */}
        <WsSection id="ts_ov_top" value={`${holdings.length} held`}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: A,
            textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
            ◈ TOP HOLDINGS
          </div>
          {holdings.length === 0 ? (
            <div style={{ fontSize: 12, color: M }}>No holdings yet. Use Holdings tab to trade.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border2)' }}>
                  {['Symbol','Shares','Avg Cost','Price','Value','P&L','Wt%'].map(h => (
                    <th key={h} style={{ padding: '3px 6px', textAlign: 'right',
                      fontSize: 12, color: M, fontWeight: 500,
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                      ...(h === 'Symbol' ? { textAlign: 'left' } : {}) }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => {
                  const pct = h.market_value / tv * 100
                  return (
                    <tr key={h.symbol}
                      style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                      <td style={{ padding: '4px 6px', fontWeight: 500,
                        color: 'var(--text)' }}>{h.symbol}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right',
                        color: M }}>{h.total_shares.toFixed(4)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right',
                        color: M }}>${h.average_cost.toFixed(2)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right',
                        color: 'var(--text)' }}>${h.current_price.toFixed(2)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right',
                        fontWeight: 500 }}>{fmtMoney(h.market_value)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right',
                        color: h.unrealized_pnl >= 0 ? G : R }}>
                        {h.unrealized_pnl >= 0 ? '+' : ''}{fmtMoney(h.unrealized_pnl)}
                        <span style={{ fontSize: 12, marginLeft: 3 }}>
                          ({fmtPct(h.unrealized_pnl_pct)})
                        </span>
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right',
                        color: M }}>{pct.toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        </WsSection>
      </div>

      {/* ── Projected Income Calendar ─────────────────────────────────────── */}
      {(() => {
        type PayEvent = { date: string; symbol: string; total: number; perShare: number; daysOut: number }
        const events: PayEvent[] = []
        for (const h of holdings) {
          const baseDate = h.next_payment_date
          const freq     = h.payment_frequency
          if (!baseDate || !freq) continue
          const pps = h.next_payment_per_share
            ?? (h.annual_dividend_per_share != null
                ? h.annual_dividend_per_share / freqDivisor(freq)
                : null)
          if (!pps) continue
          const effectiveBase = effectiveNextDate(baseDate, freq) ?? baseDate
          const projected = projectPayments(effectiveBase, freq, 14)
          projected.forEach(date => {
            const daysOut = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000)
            if (daysOut >= 0 && daysOut <= 365) {
              events.push({ date, symbol: h.symbol, total: pps * h.total_shares, perShare: pps, daysOut })
            }
          })
        }
        events.sort((a, b) => a.date.localeCompare(b.date))

        const listEvents = events.filter(e => e.daysOut <= 60)
        if (events.length === 0) return null

        const totalProjected12m = events.reduce((s, e) => s + e.total, 0)

        const byMonth: Record<string, number> = {}
        events.forEach(e => {
          const k = e.date.slice(0, 7)
          byMonth[k] = (byMonth[k] ?? 0) + e.total
        })
        const maxMonth = Math.max(...Object.values(byMonth))

        return (
          <WsSection id="ts_ov_income" value={fmtMoney(totalProjected12m)} status="info">
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-lilac-ink)',
              textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>◈ PROJECTED INCOME — NEXT 12 MONTHS</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-accent)' }}>
                {fmtMoneyFull(totalProjected12m)} est.
              </span>
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
              {Object.entries(byMonth).slice(0, 12).map(([mo, amt]) => {
                const barPct = maxMonth > 0 ? (amt / maxMonth) * 100 : 0
                const label  = new Date(mo + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                const isCurrentMonth = mo === new Date().toISOString().slice(0, 7)
                return (
                  <div key={mo} style={{ display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 2, minWidth: 42 }}>
                    <div style={{ fontSize: 12, color: 'var(--fd-accent)', fontWeight: 500 }}>
                      {fmtMoney(amt)}
                    </div>
                    <div style={{ width: 36, height: 40, background: 'var(--fd-page)',
                      borderRadius: 0, display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{
                        width: '100%', borderRadius: 0,
                        height: `${barPct}%`, minHeight: 2,
                        background: isCurrentMonth ? 'var(--fd-accent)' : 'var(--fd-accent)',
                        transition: 'height 0.3s',
                      }} />
                    </div>
                    <div style={{ fontSize: 12, color: isCurrentMonth ? 'var(--fd-accent)' : M,
                      fontWeight: isCurrentMonth ? 700 : 400 }}>{label}</div>
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {listEvents.map((ev, i) => {
                const isPast = ev.daysOut < 0
                const isSoon = ev.daysOut >= 0 && ev.daysOut <= 7
                return (
                  <div key={i} style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 60px 1fr 80px 60px',
                    alignItems: 'center', gap: 8,
                    padding: '4px 10px',
                    background: isSoon ? 'var(--fd-card)' : 'var(--fd-card)',
                    border: isSoon ? '1px solid rgba(74,222,128,0.15)' : '1px solid transparent',
                    opacity: isPast ? 0.4 : 1,
                  }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                        {fmtDate(ev.date)}
                      </div>
                      <div style={{ fontSize: 12, color: isSoon ? 'var(--fd-accent)' : M }}>
                        {ev.daysOut === 0 ? 'today' : `in ${ev.daysOut}d`}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 500, padding: '2px 7px',
                      background: 'var(--fd-card)',
                      color: 'var(--fd-lilac-ink)', borderRadius: 0,
                    }}>{ev.symbol}</span>
                    <div style={{ height: 3, background: 'var(--fd-page)', borderRadius: 0 }}>
                      <div style={{
                        height: 3, borderRadius: 0,
                        width: `${Math.min((ev.total / (totalProjected12m / events.length * 3)) * 100, 100)}%`,
                        background: isPast ? 'var(--fd-hairline)' : isSoon ? 'var(--fd-accent)' : 'var(--fd-lilac-ink)',
                      }} />
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 500,
                      color: isPast ? M : 'var(--fd-accent)', fontFamily: 'var(--font-mono)' }}>
                      {fmtMoney(ev.total)}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 12, color: M }}>
                      ${ev.perShare.toFixed(4)}/sh
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          </WsSection>
        )
      })()}
    </div>
  )
}
