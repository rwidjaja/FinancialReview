import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { XAxis, YAxis, ResponsiveContainer, Tooltip, BarChart, Bar, ComposedChart, Area, CartesianGrid } from 'recharts'
import { PieChart, Pie, Cell } from 'recharts'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import type { Dividend, Portfolio } from './types'
import { G, R, A, M, B, BASE, POST, COLORS } from './constants'
import { Btn, Input, StatBox, fmtDate } from './shared'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** Estimate annual payment frequency label from date history. */
function payFreq(dates: string[]): string {
  if (dates.length < 2) return '—'
  const sorted = [...dates].sort()
  const first = new Date(sorted[0]), last = new Date(sorted[sorted.length - 1])
  const months = Math.max((last.getFullYear() - first.getFullYear()) * 12 +
    (last.getMonth() - first.getMonth()), 1)
  const rate = (dates.length / months) * 12
  if (rate >= 48) return 'Weekly'
  if (rate >= 10) return 'Monthly'
  if (rate >= 3)  return 'Quarterly'
  if (rate >= 1.5) return 'Semi-Ann'
  return 'Annual'
}

export function IncomeTab({ divs, activeId, port, onMutate }:
  { divs: Dividend[]; activeId: number; port: Portfolio; onMutate: () => void }) {

  const curYr = new Date().getFullYear()
  const years = [...new Set(divs.map(d => Number(d.payment_date.slice(0, 4))))].sort((a, b) => b - a)
  const [selYear, setSelYear] = useState<number | 'ALL'>(years[0] ?? curYr)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ symbol: '', amount: '', date: '', reinvest: false })
  const [err, setErr]   = useState('')
  const [ok,  setOk]    = useState('')

  const divMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      POST(`${BASE}/portfolios/${activeId}/dividends`, body),
    onSuccess: () => {
      setForm({ symbol: '', amount: '', date: '', reinvest: false })
      setOk('Dividend recorded'); setErr('')
      onMutate()
      setTimeout(() => setOk(''), 3000)
    },
    onError: (e: Error) => setErr(e.message),
  })

  // ── Portfolio-level yield metrics (always LTM, independent of year selector) ──
  const ttmCutoff = new Date(); ttmCutoff.setFullYear(ttmCutoff.getFullYear() - 1)
  const ltmDivs = divs.filter(d => new Date(d.payment_date) >= ttmCutoff)
  const portVal   = port.holdings_value || port.total_value || 1

  // Supplement LTM with stored dividend_yield for holdings that have no recorded divs
  const ltmBySym2: Record<string, number> = {}
  ltmDivs.forEach(d => { ltmBySym2[d.symbol] = (ltmBySym2[d.symbol] ?? 0) + d.total_amount });
  (port.holdings ?? []).forEach(h => {
    if (!ltmBySym2[h.symbol] && h.dividend_yield != null && h.dividend_yield > 0) {
      ltmBySym2[h.symbol] = h.dividend_yield / 100 * h.market_value
    }
  })
  const effectiveLtm = Object.values(ltmBySym2).reduce((s, v) => s + v, 0)

  const portYield = portVal   > 0 ? effectiveLtm / portVal   * 100 : 0
  const totalCost = (port.holdings ?? []).reduce((s, h) => s + h.total_cost, 0)
  const portYoC   = totalCost > 0 ? effectiveLtm / totalCost * 100 : 0
  const annualEst = effectiveLtm
  const monthlyEst = annualEst / 12

  // YoY growth (YTD this year vs same year-ago)
  const thisYrTotal = divs.filter(d => d.payment_date.startsWith(String(curYr)))
    .reduce((s, d) => s + d.total_amount, 0)
  const lastYrTotal = divs.filter(d => d.payment_date.startsWith(String(curYr - 1)))
    .reduce((s, d) => s + d.total_amount, 0)
  const yoyGrowth = lastYrTotal > 0 ? (thisYrTotal - lastYrTotal) / lastYrTotal * 100 : null

  // ── LTM income by symbol (actual divs + stored yield fallback) ──────────
  const ltmBySym = ltmBySym2   // already built above with both sources
  // Use effectiveLtm (recorded divs + yield fallback) as the denominator so
  // pct sums to 100% even when most entries come from the yield-fallback path.
  const ltmBySymSorted = Object.entries(ltmBySym)
    .sort(([, a], [, b]) => b - a)
    .map(([sym, amt]) => ({
      sym, amt,
      pct: effectiveLtm > 0 ? amt / effectiveLtm * 100 : 0,
    }))

  // Yield % per symbol — prefer annualized per-share data to avoid partial-year distortion
  const holdingsBySymbol = Object.fromEntries((port.holdings ?? []).map(h => [h.symbol, h]))
  const yieldBySymSorted = ltmBySymSorted
    .map(({ sym, amt }) => {
      const h = holdingsBySymbol[sym]
      const adps = h?.annual_dividend_per_share
      const mv   = h?.market_value ?? 0
      const yPct = adps != null && mv > 0
        ? adps * (h?.total_shares ?? 0) / mv * 100
        : h?.dividend_yield != null && h.dividend_yield > 0
          ? h.dividend_yield
          : mv > 0 ? amt / mv * 100 : 0
      return { sym, yPct, amt }
    })
    .filter(r => r.yPct > 0)
    .sort((a, b) => b.yPct - a.yPct)

  // Payment frequency per symbol
  const symDates: Record<string, string[]> = {}
  divs.forEach(d => { (symDates[d.symbol] ??= []).push(d.payment_date) })

  // ── Year-scoped data (for charts + table) ────────────────────────────────
  const viewDivs = selYear === 'ALL' ? divs : divs.filter(d => d.payment_date.startsWith(String(selYear)))
  const byMo: Record<number, number> = {}
  viewDivs.forEach(d => { const mo = Number(d.payment_date.slice(5, 7)) - 1; byMo[mo] = (byMo[mo] ?? 0) + d.total_amount })
  let running = 0
  const monthlyChartData = (selYear === 'ALL'
    ? (() => {
        const bk: Record<string, number> = {}
        divs.forEach(d => { const k = d.payment_date.slice(0, 7); bk[k] = (bk[k] ?? 0) + d.total_amount })
        return Object.entries(bk).sort(([a], [b]) => a.localeCompare(b))
          .map(([mo, amount]) => ({ label: mo.slice(2), amount, cumulative: 0 }))
      })()
    : MONTH_LABELS.map((lbl, i) => ({ label: lbl, amount: byMo[i] ?? 0, cumulative: 0 }))
  ).map(row => { running += row.amount; return { ...row, cumulative: running } })

  const byYear: Record<number, number> = {}
  divs.forEach(d => { const y = Number(d.payment_date.slice(0, 4)); byYear[y] = (byYear[y] ?? 0) + d.total_amount })
  const annualData = Object.entries(byYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, amount]) => ({ year, amount }))

  const hasData = divs.length > 0

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12,
      fontFamily: 'var(--font-mono)' }}>

      {/* ── Top KPI banner (Snowball style) ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {/* Yield block */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
          borderRadius: 0, padding: '14px 16px', display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
              letterSpacing: '1px', marginBottom: 4 }}>Portfolio Yield</div>
            <div style={{ fontSize: 28, fontWeight: 500, color: G, lineHeight: 1 }}>
              {portYield.toFixed(2)}%
            </div>
            <div style={{ fontSize: 12, color: M, marginTop: 4 }}>
              {portYoC.toFixed(2)}% yield on cost
            </div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border2)', paddingLeft: 20 }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
              letterSpacing: '1px', marginBottom: 4 }}>Dividends (LTM)</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {yoyGrowth !== null && (
                <span style={{
                  fontSize: 12, fontWeight: 500, padding: '1px 6px', borderRadius: 0,
                  background: yoyGrowth >= 0 ? 'var(--fd-card)' : 'var(--fd-card)',
                  color: yoyGrowth >= 0 ? G : R,
                }}>
                  {yoyGrowth >= 0 ? '▲' : '▼'} {Math.abs(yoyGrowth).toFixed(1)}%
                </span>
              )}
            </div>
            <div style={{ fontSize: 22, fontWeight: 500, color: G, lineHeight: 1.1, marginTop: 2 }}>
              {fmtMoneyFull(annualEst)}
            </div>
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
              {fmtMoneyFull(monthlyEst)} monthly
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          <StatBox label="Income Received YTD"   value={fmtMoneyFull(thisYrTotal)} color={G} />
          <StatBox label="All-Time"     value={fmtMoneyFull(divs.reduce((s,d) => s+d.total_amount,0))} color={G} />
          <StatBox label="# Payments"   value={String(divs.length)} />
        </div>
      </div>

      {/* ── Record dividend toggle ────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn onClick={() => setShowForm(f => !f)} variant="green" small>
          {showForm ? '▲ Hide Form' : '+ Record Dividend'}
        </Btn>
      </div>

      {/* ── Inline record form (collapsible) ─────────────────────────────── */}
      {showForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: A,
            textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            ◈ RECORD DIVIDEND
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ width: 80 }}>
              <Input label="Symbol" value={form.symbol}
                onChange={v => setForm(f => ({ ...f, symbol: v.toUpperCase() }))} />
            </div>
            <div style={{ width: 100 }}>
              <Input label="$/Share" type="number" value={form.amount}
                onChange={v => setForm(f => ({ ...f, amount: v }))} placeholder="0.25" />
            </div>
            <div style={{ width: 120 }}>
              <Input label="Pay Date" type="date" value={form.date}
                onChange={v => setForm(f => ({ ...f, date: v }))} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 12, color: M, cursor: 'pointer', marginBottom: 2 }}>
              <input type="checkbox" checked={form.reinvest}
                onChange={e => setForm(f => ({ ...f, reinvest: e.target.checked }))} />
              DRIP Reinvest
            </label>
            <Btn onClick={() => {
              if (!form.symbol || !form.amount) { setErr('Symbol and amount required'); return }
              divMut.mutate({ symbol: form.symbol, amount_per_share: parseFloat(form.amount),
                date: form.date || undefined, reinvest: form.reinvest })
            }} variant="green" disabled={divMut.isPending}>Record →</Btn>
          </div>
          {err && <div style={{ fontSize: 12, color: R, marginTop: 6 }}> {err}</div>}
          {ok  && <div style={{ fontSize: 12, color: G, marginTop: 6 }}>✓ {ok}</div>}
        </div>
      )}

      {!hasData ? (
        <div style={{ padding: 32, textAlign: 'center', color: M, fontSize: 12 }}>
          No dividends recorded yet. Use the button above to log a payment.
        </div>
      ) : (<>

        {/* ── Diversification donut + Yield/Payout bars ─────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

          {/* Passive Income Diversification */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: A,
              textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
              ◈ PASSIVE INCOME DIVERSIFICATION
            </div>
            {ltmBySymSorted.length > 0 ? (
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                {/* Donut chart */}
                <div style={{ flexShrink: 0, width: 130, height: 130 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={ltmBySymSorted} dataKey="amt" nameKey="sym"
                        cx="50%" cy="50%" innerRadius={34} outerRadius={60}
                        paddingAngle={2} startAngle={90} endAngle={450}>
                        {ltmBySymSorted.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                        formatter={(v: unknown, _n: unknown, props: {payload?: {sym?: string; pct?: number}}) => [
                          `$${Number(v).toFixed(2)} (${(props?.payload?.pct ?? 0).toFixed(1)}%)`,
                          props?.payload?.sym ?? '',
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Sorted legend list */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {ltmBySymSorted.map(({ sym, amt, pct }, i) => (
                    <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, flexShrink: 0,
                        background: COLORS[i % COLORS.length] }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)',
                        minWidth: 44 }}>{sym}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ height: 4, borderRadius: 0,
                          background: `rgba(${COLORS[i % COLORS.length].slice(1).match(/../g)
                            ?.map(h => parseInt(h,16)).join(',')},0.25)`,
                          overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 0,
                            background: COLORS[i % COLORS.length] }} />
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: M, minWidth: 36,
                        textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                      <span style={{ fontSize: 12, color: G,
                        minWidth: 70, textAlign: 'right' }}>{fmtMoneyFull(amt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: M, padding: '20px 0' }}>
                No LTM income data yet.
              </div>
            )}
          </div>

          {/* Yield/Payout per symbol */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: A,
                textTransform: 'uppercase', letterSpacing: '1px' }}>◈ YIELD / PAYOUT</span>
              <span style={{ fontSize: 12, color: M }}>LTM yield on market value</span>
            </div>
            {yieldBySymSorted.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {yieldBySymSorted.map(({ sym, yPct, amt }, i) => (
                  <div key={sym}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      marginBottom: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 500,
                          color: 'var(--text)' }}>{sym}</span>
                        {symDates[sym] && (
                          <span style={{ fontSize: 12, fontWeight: 500, padding: '1px 4px',
                            borderRadius: 0, background: 'var(--fd-card)',
                            color: 'var(--fd-accent)', textTransform: 'uppercase' }}>
                            {payFreq(symDates[sym])}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                        <span style={{ color: G, fontWeight: 500 }}>
                          {yPct.toFixed(2)}%
                        </span>
                        <span style={{ color: M }}>{fmtMoneyFull(amt)}</span>
                      </div>
                    </div>
                    <div style={{ height: 6, borderRadius: 0, background: 'var(--fd-card)',
                      overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(yPct / (yieldBySymSorted[0]?.yPct || 1) * 100, 100)}%`,
                        height: '100%', borderRadius: 0,
                        background: COLORS[i % COLORS.length],
                        opacity: 0.8,
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: M, padding: '20px 0' }}>
                Add holdings to see yield breakdown.
              </div>
            )}
          </div>
        </div>

        {/* ── Year selector ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 1 }}>
          {([...years, 'ALL'] as (number|'ALL')[]).map(y => (
            <button key={y} onClick={() => setSelYear(y)} style={{
              padding: '3px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              background: selYear === y ? 'var(--fd-card)' : 'none',
              border: `1px solid ${selYear === y ? 'var(--fd-hairline)' : 'var(--border2)'}`,
              color: selYear === y ? G : M,
            }}>{y}</button>
          ))}
        </div>

        {/* ── Monthly income + cumulative (ComposedChart) ───────────────── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: A,
              textTransform: 'uppercase', letterSpacing: '1px' }}>
              ◈ MONTHLY INCOME — {selYear}
            </span>
            <div style={{ display: 'flex', gap: 10, fontSize: 12, color: M }}>
              <span><span style={{ color: 'var(--fd-accent)' }}>█</span> Monthly</span>
              <span><span style={{ color: B }}>━━</span> Cumulative</span>
            </div>
          </div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }} />
                <YAxis yAxisId="bar" tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }}
                  tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}K` : v.toFixed(0)}`} />
                <YAxis yAxisId="line" orientation="right" tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }}
                  tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(1)}K` : v.toFixed(0)}`} />
                <Tooltip
                  contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                  formatter={(v: unknown, name: unknown) => {
                    const n = Number(v)
                    return [`$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                      String(name) === 'amount' ? 'Monthly' : 'Cumulative']
                  }}
                />
                <Bar yAxisId="bar" dataKey="amount" fill="var(--fd-accent)"
                  radius={[2, 2, 0, 0]} />
                <Area yAxisId="line" type="monotone" dataKey="cumulative"
                  stroke={B} fill="var(--fd-card)"
                  strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Annual income bar ─────────────────────────────────────────── */}
        {annualData.length > 1 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: A,
              textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
              ◈ ANNUAL INCOME
            </div>
            <div style={{ height: 120 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={annualData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }}
                    tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}`} />
                  <Tooltip
                    contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                    formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, 'Annual Income']}
                  />
                  <Bar dataKey="amount" radius={[2, 2, 0, 0]}>
                    {annualData.map((d, i) => (
                      <Cell key={i}
                        fill={Number(d.year) === curYr ? 'var(--fd-accent)' : 'var(--fd-accent)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── Dividend history table ────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: A,
            textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
            ◈ DIVIDEND HISTORY ({viewDivs.length}{selYear !== 'ALL' ? ` in ${selYear}` : ''})
          </div>
          {viewDivs.length === 0 ? (
            <div style={{ fontSize: 12, color: M }}>No dividends for {selYear}.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border2)' }}>
                  {['Date','Symbol','Freq','$/Sh','Shares','Total','DRIP'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'right',
                      fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      ...(h === 'Date' || h === 'Symbol' ? { textAlign: 'left' } : {}) }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...viewDivs].reverse().map(d => (
                  <tr key={d.dividend_id}
                    style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                    <td style={{ padding: '4px 8px', color: M, fontSize: 12 }}>{fmtDate(d.payment_date)}</td>
                    <td style={{ padding: '4px 8px', fontWeight: 500 }}>{d.symbol}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                      {symDates[d.symbol] ? (
                        <span style={{ fontSize: 12, fontWeight: 500, padding: '1px 4px',
                          borderRadius: 0, background: 'var(--fd-card)',
                          color: 'var(--fd-accent)', textTransform: 'uppercase' }}>
                          {payFreq(symDates[d.symbol])}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                      ${d.amount_per_share.toFixed(4)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right',
                      color: M }}>{d.total_shares.toFixed(2)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right',
                      color: G, fontWeight: 500 }}>{fmtMoney(d.total_amount)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right',
                      color: d.reinvested ? G : M, fontSize: 12 }}>
                      {d.reinvested ? '✓ DRIP' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border2)' }}>
                  <td colSpan={5} style={{ padding: '5px 8px', fontSize: 12, color: M }}>
                    {viewDivs.length} payment{viewDivs.length !== 1 ? 's' : ''}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right',
                    fontWeight: 500, color: G }}>
                    {fmtMoneyFull(viewDivs.reduce((s, d) => s + d.total_amount, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

      </>)}
    </div>
  )
}
