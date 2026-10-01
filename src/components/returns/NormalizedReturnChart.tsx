import { useMemo } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE } from '../ui/chartTooltip'

const G = 'var(--green)'
const R = 'var(--red)'
const M = 'var(--text2)'

export function NormalizedReturnChart({ data, perfData, period, symbols: symbolsFilter }: {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
  /** If provided, only show these symbols instead of all decisions. */
  symbols?: string[]
}) {
  const COLORS = ['var(--fd-accent)', 'var(--as-lilac)', 'var(--as-lime)', 'var(--fd-muted)', 'var(--fd-ink)',
                  'var(--fd-negative)', 'var(--fd-accent)', 'var(--as-lilac)', 'var(--as-lime)', 'var(--fd-muted)']

  type SeriesMeta = { symbol: string; color: string; finalReturn: number; len: number }

  const seriesMeta = useMemo<SeriesMeta[]>(() => {
    const allDecisionSyms = data.decisions.map(d => d.symbol)
    const syms = (symbolsFilter ?? allDecisionSyms).filter(s => perfData[s]?.[period]?.pct_returns?.length)
    return syms.slice(0, 10).map((sym, idx) => {
      const pcts = perfData[sym]?.[period]?.pct_returns ?? []
      const finalReturn = pcts.length > 0 ? pcts[pcts.length - 1] : 0
      return { symbol: sym, color: COLORS[idx % COLORS.length], finalReturn, len: pcts.length }
    }).filter(s => s.len > 0)
  }, [data.decisions, perfData, period])

  const { chartData, yMin, yMax } = useMemo(() => {
    if (seriesMeta.length === 0) return { chartData: [], yMin: 99, yMax: 101 }
    const maxLen = Math.max(...seriesMeta.map(s => s.len), 0)
    const data_out = Array.from({ length: maxLen }, (_, i) => {
      const point: Record<string, number | null> = { idx: i }
      for (const s of seriesMeta) {
        const pcts = perfData[s.symbol]?.[period]?.pct_returns ?? []
        point[s.symbol] = i < pcts.length ? 100 + pcts[i] : null
      }
      return point
    })
    const allVals = seriesMeta.flatMap(s => {
      const pcts = perfData[s.symbol]?.[period]?.pct_returns ?? []
      return pcts.map(p => 100 + p)
    })
    return {
      chartData: data_out,
      yMin: Math.floor(Math.min(...(allVals.length > 0 ? allVals : [100]), 100) * 0.99),
      yMax: Math.ceil(Math.max(...(allVals.length > 0 ? allVals : [100]), 100) * 1.01),
    }
  }, [seriesMeta, perfData, period])

  if (seriesMeta.length === 0) return <div style={{ padding: 16, color: M, fontSize: 12 }}>No return data for this period.</div>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const typedPayload = payload as { dataKey: string; value: number; color: string }[]
    return (
      <div style={TOOLTIP_STYLE}>
        <div style={TOOLTIP_LABEL_STYLE}>Day {label as number}</div>
        {typedPayload
          .filter(p => p.value != null)
          .sort((a, b) => b.value - a.value)
          .map(p => (
            <div key={p.dataKey} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: p.color, fontWeight: 500 }}>{p.dataKey}</span>
              <span style={{ color: p.value >= 100 ? G : R }}>
                {p.value >= 100 ? '+' : ''}{(p.value - 100).toFixed(2)}%
              </span>
            </div>
          ))}
      </div>
    )
  }

  const sorted = [...seriesMeta].sort((a, b) => b.finalReturn - a.finalReturn)

  return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          BASE 100 · {period.toUpperCase()} · ALL HOLDINGS
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
          {sorted.map(s => {
            const safeReturn = typeof s.finalReturn === 'number' && isFinite(s.finalReturn) ? s.finalReturn : 0
            return (
            <div key={s.symbol} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <div style={{ width: 18, height: 2, background: s.color, borderRadius: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{s.symbol}</span>
              <span style={{ color: safeReturn >= 0 ? G : R, fontWeight: 500 }}>
                {safeReturn >= 0 ? '+' : ''}{safeReturn.toFixed(2)}%
              </span>
            </div>
            )
          })}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 48 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
          <XAxis
            dataKey="idx"
            tick={{ fill: 'var(--text2)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={v => `${v}`}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fill: 'var(--text2)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={v => `${v}`}
            width={44}
          />
          <ReferenceLine y={100} stroke="var(--fd-hairline)" strokeDasharray="4 3" />
          <Tooltip content={customTooltip} />
          {seriesMeta.map(s => (
            <Line
              key={s.symbol}
              type="monotone"
              dataKey={s.symbol}
              stroke={s.color}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
