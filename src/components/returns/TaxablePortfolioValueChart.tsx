/**
 * TaxablePortfolioValueChart
 * ---------------------------
 * Lot-aware dollar value chart for the taxable account. Shows the ACTUAL value
 * of the shares you actually held on each day, alongside a hypothetical S&P 500
 * line that invests the same dollars on the same days you actually bought in.
 *
 * Data path:
 *   - Per-symbol daily prices     → perfData[sym][period].prices (real $ closes)
 *   - Real lot acquisition dates  → data.tax_data.cost_basis_lots[sym].lots
 *   - S&P 500 reference           → perfData['_benchmarks']['SPY'][period].pct_returns
 *     (benchmarks have raw prices stripped server-side, so SPY is reconstructed
 *     as a ratio series anchored at 1 — fine since it's only ever used in ratio
 *     form: hypothetical units bought = cost basis ÷ ratio-at-purchase.)
 *
 * For each lot: contributes $0 to the portfolio line on every day BEFORE its
 * acquisition date (you didn't own it yet), then quantity × price_i from the
 * acquisition date onward. This is what fixes the old approach, which assumed
 * every currently-held share had been held — and growing — since day one of
 * the window, wildly overstating gains on anything bought partway through
 * (e.g. bought near a recent high right before a pullback).
 *
 * The S&P 500 line mirrors that same timing: each lot's real cost basis buys
 * hypothetical SPY shares on the lot's actual acquisition date, not on day one
 * of the window — so it answers "if I'd put this same money into SPY when I
 * actually invested it, would I be ahead?"
 *
 * Symbols with no matching lot data (or a lot/share-count mismatch) fall back
 * to the old whole-period assumption for that symbol only, and are called out
 * in the footnote.
 */

import { useMemo } from 'react'
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE } from '../ui/chartTooltip'

const G  = 'var(--green)'
const R  = 'var(--red)'
const A  = 'var(--amber)'
const BL = 'var(--blue)'
const M  = 'var(--text2)'

const PERIOD_LABELS: Record<string, string> = {
  '1m':  'over the last month',
  '3m':  'over the last 3 months',
  '6m':  'over the last 6 months',
  'ytd': 'since the beginning of the year',
  '1y':  'over the last year',
  '3y':  'over the last 3 years',
  '5y':  'over the last 5 years',
}

function fmtDollar(v: number): string {
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDollarSigned(v: number): string {
  const sign = v >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Axis labels stay abbreviated so the chart axis doesn't overflow
function fmtAxisDollar(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(2)}`
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Daily price series for this period. Prefers the real $ close array (held
// symbols); falls back to a ratio series anchored at 1 when raw prices aren't
// present (benchmarks) — valid whenever the series is only used in ratio form.
// Holds at the last known value if a series is shorter than refLen.
function priceSeries(pd: PerfPeriod, refLen: number): number[] {
  const raw = pd.prices
  const out: number[] = new Array(refLen)
  if (raw && raw.length > 0) {
    for (let i = 0; i < refLen; i++) out[i] = i < raw.length ? raw[i] : raw[raw.length - 1]
    return out
  }
  const pcts = pd.pct_returns ?? []
  for (let i = 0; i < refLen; i++) {
    const pct = i < pcts.length ? pcts[i] : (pcts[pcts.length - 1] ?? 0)
    out[i] = 1 + pct / 100
  }
  return out
}

// First index in refDates on/after the given ISO date. Clamps to the last
// index if the date falls after the whole window (e.g. bought today, data lag).
function acquisitionIndex(acquiredIso: string, refDates: string[]): number {
  if (refDates.length === 0) return 0
  const day = acquiredIso.slice(0, 10)
  for (let i = 0; i < refDates.length; i++) {
    if (refDates[i].slice(0, 10) >= day) return i
  }
  return refDates.length - 1
}

interface Props {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
}

export function TaxablePortfolioValueChart({ data, perfData, period }: Props) {
  const taxableAcct = data.accounts.find(
    a => a.key?.includes('taxable') || a.label?.toLowerCase().includes('taxable')
  )

  // S&P 500 benchmark — try benchmarks sub-key first, then direct symbol key (held as position)
  const benchmarks = (perfData['_benchmarks'] as unknown) as Record<string, Record<string, PerfPeriod>> | undefined
  const spyPerf = (benchmarks?.['SPY']?.[period]?.pct_returns?.length
    ? benchmarks['SPY'][period]
    : perfData['SPY']?.[period]) ?? null

  const costBasisLots = data.tax_data?.cost_basis_lots ?? null

  const { chartData, portfolioStart, portfolioEnd, spyEnd, outperformDollar, outperformPct, missingDataValue = 0, fallbackValue = 0 } =
    useMemo(() => {
      const empty = { chartData: [] as Record<string, number | string | null>[], portfolioStart: 0, portfolioEnd: 0, spyEnd: 0, outperformDollar: 0, outperformPct: 0, missingDataValue: 0, fallbackValue: 0 }
      if (!taxableAcct || taxableAcct.positions.length === 0) return empty

      const positions = taxableAcct.positions.filter(p => p.value > 0 && p.shares > 0)

      // Determine reference date grid from SPY or longest position series
      let refDates: string[] = spyPerf?.dates ?? []
      let refLen = spyPerf?.pct_returns?.length ?? 0
      if (refLen === 0) {
        for (const pos of positions) {
          const pd = perfData[pos.symbol]?.[period]
          if ((pd?.dates?.length ?? 0) > refLen) {
            refLen = pd!.dates!.length
            refDates = pd!.dates!
          }
        }
      }
      if (refLen === 0) return empty

      // Per-day dollar value contribution for each position, respecting real
      // lot acquisition dates. lots[]=null signals "no price history" (flat-line
      // fallback); lots=[] with a numeric fallbackVal signals "no reliable lot
      // match" (whole-period fallback, same math as the old implementation).
      type PosSeries =
        | { kind: 'flat'; val: number }
        | { kind: 'fallback'; startVal: number; prices: number[] }
        | { kind: 'lots'; entries: { qty: number; acqIdx: number; costBasis: number }[]; prices: number[] }

      let missingDataValue = 0
      let fallbackValue = 0
      const series: PosSeries[] = []

      for (const pos of positions) {
        const pd = perfData[pos.symbol]?.[period]
        if (!pd || !pd.pct_returns || pd.pct_returns.length === 0) {
          series.push({ kind: 'flat', val: pos.value })
          missingDataValue += pos.value
          continue
        }
        const prices = priceSeries(pd, refLen)
        const lots = costBasisLots?.[pos.symbol]?.lots ?? []
        const lotQty = lots.reduce((s, l) => s + (l.quantity ?? 0), 0)
        const reliable = lots.length > 0 && lotQty > 0 && Math.abs(lotQty - pos.shares) / pos.shares < 0.1
        if (reliable) {
          series.push({
            kind: 'lots',
            entries: lots.map(l => ({
              qty: l.quantity,
              acqIdx: acquisitionIndex(l.acquired_date, refDates),
              costBasis: l.cost_basis,
            })),
            prices,
          })
        } else {
          // No reliable lot match — fall back to whole-period assumption for this symbol.
          const totalRet = pd.total_return / 100
          const startVal = totalRet === -1 ? pos.value : pos.value / (1 + totalRet)
          series.push({ kind: 'fallback', startVal, prices })
          fallbackValue += pos.value
        }
      }

      if (series.length === 0) return empty

      const spyPrices = spyPerf ? priceSeries(spyPerf, refLen) : null

      // Pre-compute each 'lots' position's hypothetical SPY share count per lot,
      // bought on the lot's own acquisition day (or day 0 if it predates the window).
      const lotSpyUnits: number[][] = series.map(s => {
        if (s.kind !== 'lots' || !spyPrices) return []
        return s.entries.map(e => {
          const buyPrice = spyPrices[e.acqIdx] || spyPrices[0]
          return buyPrice > 0 ? e.costBasis / buyPrice : 0
        })
      })

      const out: Record<string, number | string | null>[] = []
      for (let i = 0; i < refLen; i++) {
        let portVal = 0
        let spyVal = spyPrices ? 0 : null

        series.forEach((s, si) => {
          if (s.kind === 'flat') {
            // No price history to distinguish timing — treat as already owned at day 0.
            portVal += s.val
            if (spyVal != null) spyVal += s.val
          } else if (s.kind === 'fallback') {
            // No reliable lot match — same whole-period assumption as the old implementation.
            const base = s.prices[0] || 1
            const val = s.startVal * (s.prices[i] / base)
            portVal += val
            if (spyVal != null) spyVal += val
          } else {
            s.entries.forEach((e, ei) => {
              if (i < e.acqIdx) return   // not owned yet on this day
              portVal += e.qty * s.prices[i]
              if (spyVal != null) spyVal += lotSpyUnits[si][ei] * (spyPrices as number[])[i]
            })
          }
        })

        out.push({
          date: refDates[i] ?? String(i),
          portfolio: parseFloat(portVal.toFixed(2)),
          spy: spyVal != null ? parseFloat(spyVal.toFixed(2)) : null,
        })
      }

      const lastPoint = out[out.length - 1]
      const portEnd = Number(lastPoint?.portfolio ?? 0)
      const spyEndVal = lastPoint?.spy != null ? Number(lastPoint.spy) : 0
      const firstPoint = out[0]
      const portStart = Number(firstPoint?.portfolio ?? 0)

      return {
        chartData: out,
        portfolioStart: portStart,
        portfolioEnd: portEnd,
        spyEnd: spyEndVal,
        outperformDollar: portEnd - spyEndVal,
        outperformPct: spyEndVal > 0 ? ((portEnd - spyEndVal) / spyEndVal) * 100 : 0,
        missingDataValue,
        fallbackValue,
      }
    }, [taxableAcct, perfData, period, spyPerf, costBasisLots])

  const periodLabel   = PERIOD_LABELS[period] ?? `over ${period}`
  const isAhead       = outperformDollar >= 0
  const gainColor     = isAhead ? G : R

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const portRow = payload.find((p: any) => p.dataKey === 'portfolio')
    const spyRow  = payload.find((p: any) => p.dataKey === 'spy')
    const date    = typeof label === 'string' ? fmtDate(label) : `Day ${label}`
    const diff    = portRow && spyRow ? Number(portRow.value) - Number(spyRow.value) : null
    return (
      <div style={TOOLTIP_STYLE}>
        <div style={TOOLTIP_LABEL_STYLE}>{date}</div>
        {portRow && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
            <span style={{ color: A, fontWeight: 500 }}>Portfolio</span>
            <span style={{ color: A }}>{fmtDollar(Number(portRow.value))}</span>
          </div>
        )}
        {spyRow && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
            <span style={{ color: BL, fontWeight: 500 }}>S&P 500</span>
            <span style={{ color: BL }}>{fmtDollar(Number(spyRow.value))}</span>
          </div>
        )}
        {diff != null && (
          <div style={{ borderTop: '1px solid var(--fd-hairline)', marginTop: 4, paddingTop: 4,
            display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: M, fontSize: 12 }}>Alpha</span>
            <span style={{ color: diff >= 0 ? G : R, fontWeight: 500 }}>
              {fmtDollarSigned(diff)}
            </span>
          </div>
        )}
      </div>
    )
  }

  if (chartData.length === 0) {
    return (
      <div style={{ padding: 16, color: M, fontSize: 12 }}>
        No performance data available for the taxable account in this period.
      </div>
    )
  }

  // Y-axis domain with padding
  const allVals = chartData.flatMap(d => [Number(d.portfolio), d.spy != null ? Number(d.spy) : NaN]).filter(v => !isNaN(v))
  const yMin = Math.min(...allVals) * 0.985
  const yMax = Math.max(...allVals) * 1.015

  // X-axis: show every Nth label to avoid crowding
  const totalPoints = chartData.length
  const xInterval   = totalPoints <= 30 ? 4 : totalPoints <= 90 ? 10 : totalPoints <= 180 ? 20 : 40

  return (
    <div style={{ padding: '12px 16px' }}>

      {/* Banner */}
      <div style={{
        padding: '10px 16px', marginBottom: 12, borderRadius: 0,
        background: isAhead ? 'var(--fd-card)' : 'var(--fd-card)',
        border: `1px solid ${gainColor}33`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: gainColor, fontFamily: 'var(--font-mono)' }}>
            Taxable account is {isAhead ? 'ahead of' : 'behind'} S&P 500 by{' '}
            {fmtDollar(Math.abs(outperformDollar))} ({Math.abs(outperformPct).toFixed(2)}%)
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
            {periodLabel} · Portfolio {fmtDollar(portfolioStart)} → {fmtDollar(portfolioEnd)}
            {spyPerf && <> · if that same money had gone into S&P 500 on the days you actually bought: {fmtDollar(spyEnd)}</>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fd-muted)', marginTop: 2 }}>
            actual value of the shares you actually held each day — lots bought partway through the window count from $0 until their purchase date
          </div>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 60 }}>
          <defs>
            <linearGradient id="gPortfolio" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={A}  stopOpacity={0.18} />
              <stop offset="95%" stopColor={A}  stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gSpy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={BL} stopOpacity={0.10} />
              <stop offset="95%" stopColor={BL} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: M, fontSize: 12, fontFamily: 'var(--font-mono)' }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            interval={xInterval}
            tickFormatter={fmtDate}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fill: M, fontSize: 12, fontFamily: 'var(--font-mono)' }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={fmtAxisDollar}
            width={58}
          />
          <ReferenceLine y={portfolioStart} stroke="var(--fd-hairline)" strokeDasharray="3 4"
            label={{ value: 'Start', position: 'insideTopLeft', fontSize: 12, fill: M }} />
          <Tooltip content={customTooltip} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }}
            formatter={(v: string) => v === 'portfolio' ? 'Portfolio (taxable, actual)' : 'S&P 500 (same $, same timing)'} />
          {spyPerf && (
            <Area type="monotone" dataKey="spy" name="spy"
              stroke={BL} strokeWidth={1.5} strokeDasharray="4 3"
              fill="url(#gSpy)" dot={false} activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls={false} />
          )}
          <Area type="monotone" dataKey="portfolio" name="portfolio"
            stroke={A} strokeWidth={2}
            fill="url(#gPortfolio)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: A }}
            connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>

      {/* Period summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 10 }}>
        {[
          { label: 'VALUE ON DAY 1', value: fmtDollar(portfolioStart), color: M, sub: 'what you already owned counted then — nothing bought later is included' },
          { label: 'VALUE TODAY',   value: fmtDollar(portfolioEnd),   color: portfolioEnd >= portfolioStart ? G : R,
            sub: `${fmtDollarSigned(portfolioEnd - portfolioStart)} change` },
          { label: 'IF IT WERE S&P 500 INSTEAD', value: spyPerf ? fmtDollar(spyEnd) : '—', color: BL,
            sub: spyPerf ? 'same dollars, same purchase dates, but in the S&P 500' : 'no benchmark data' },
          { label: 'YOU VS. S&P 500', value: spyEnd > 0 ? fmtDollarSigned(outperformDollar) : '—', color: gainColor,
            sub: spyEnd > 0 ? `${outperformPct >= 0 ? '+' : ''}${outperformPct.toFixed(2)}% ${isAhead ? 'ahead' : 'behind'}` : 'refresh perf data for S&P ref' },
        ].map(t => (
          <div key={t.label} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
            borderRadius: 0, padding: '8px 10px' }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 }}>{t.label}</div>
            <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: t.color }}>{t.value}</div>
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* Footnotes for positions that couldn't use lot-level timing */}
      {missingDataValue > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: M, fontStyle: 'italic' }}>
          ⓘ {fmtDollar(missingDataValue)} shown as a flat line — no price history available for this fund (e.g. a money-market fund)
        </div>
      )}
      {fallbackValue > 0 && (
        <div style={{ marginTop: 4, fontSize: 12, color: A, fontStyle: 'italic' }}>
           {fmtDollar(fallbackValue)} couldn't be matched to real purchase dates, so it's assumed you've held it the whole time — this may overstate its gain if you actually bought in partway through
        </div>
      )}
    </div>
  )
}
