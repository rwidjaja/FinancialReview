// ── Chart Comparison Components + Candlestick Chart ──────────────────────────

import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, CartesianGrid, ReferenceLine, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { useQuery } from '@tanstack/react-query'
import * as echarts from 'echarts/core'
import { CandlestickChart as EChartsCandlestickChart, LineChart as EChartsLineChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, GridComponent, LegendComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  EChartsCandlestickChart,
  EChartsLineChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
])
import { PanelHeader } from '../ui/Terminal'
import { gainColor } from '../../utils/formatters'
import { G, R, M } from './researchTypes'
import type { ResearchApiData, ChartPeriod } from './researchTypes'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE } from '../ui/chartTooltip'
import { cssVar, useGround } from '../ui/chartTheme'

export function ChartPanelCompare({ r, period, onPeriod, chgColor, benchmark, compareSymbols, compareChartData, active }: {
  r: ResearchApiData
  period: ChartPeriod
  onPeriod: (p: ChartPeriod) => void
  chgColor: string
  benchmark: string
  compareSymbols: string[]
  compareChartData: Record<string, any>
  active: string
}) {
  const chartData   = r.chart?.[period]
  // Full period object — includes both prices and dates for date-alignment
  const benchmarkData = compareChartData[benchmark]?.[period] as { prices: number[]; dates?: string[] } | undefined
  const periods: ChartPeriod[] = ['1d', '5d', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y']
  const COLORS = ['var(--fd-accent)', 'var(--fd-lilac-ink)', 'var(--fd-lime-ink)', 'var(--fd-muted)', 'var(--fd-ink)', 'var(--fd-negative)']

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>PRICE CHART (%)</PanelHeader>
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
          {periods.map(p => (
            <button key={p} onClick={() => onPeriod(p)} style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, padding: '3px 8px', cursor: 'pointer',
              border: `1px solid ${'var(--amber)'}`,
              background: p === period ? 'var(--fd-card)' : 'var(--panel)',
              color: p === period ? 'var(--amber)' : M,
            }}>{p.toUpperCase()}</button>
          ))}
        </div>
        {chartData?.prices && chartData.prices.length > 1 ? (
          <>
            <MultiLineChartWithBenchmark
              mainSymbol={active}
              mainData={chartData.prices}
              mainDates={chartData.dates ?? []}
              mainColor={chgColor}
              benchmark={benchmark}
              benchmarkData={benchmarkData}
              compareSymbols={compareSymbols}
              compareChartData={compareChartData}
              period={period}
              colors={COLORS}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: M, marginTop: 6 }}>
              <span>{chartData.dates[0]}</span>
              <span>{chartData.dates[chartData.dates.length - 1]}</span>
            </div>
          </>
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', color: M, fontSize: 12 }}>No chart data for {period.toUpperCase()} period.</div>
        )}
      </div>
    </div>
  )
}

export function MultiLineChartWithBenchmark({ mainSymbol, mainData, mainDates, mainColor, benchmark, benchmarkData, compareSymbols, compareChartData, period, colors }: {
  mainSymbol: string
  mainData: number[]
  mainDates: string[]
  mainColor: string
  benchmark: string
  benchmarkData: { prices: number[]; dates?: string[] } | null | undefined
  compareSymbols: string[]
  compareChartData: Record<string, any>
  period: string
  colors: string[]
}) {
  // ── Build date-keyed series so series with different lengths stay aligned ──
  interface Series { symbol: string; color: string; dashed: boolean; endPct: number | null; dateMap: Map<string, number> }
  const allSeries: Series[] = []

  // Main symbol
  const mainBase = mainData[0] || 1
  const mainMap = new Map<string, number>()
  mainDates.forEach((d, i) => {
    if (mainData[i] != null) mainMap.set(d, parseFloat(((mainData[i] / mainBase) - 1) * 100 as unknown as string))
  })
  const mainEnd = mainData.length > 1 ? ((mainData[mainData.length - 1] / mainBase) - 1) * 100 : null
  allSeries.push({ symbol: mainSymbol, color: mainColor, dashed: false, endPct: mainEnd, dateMap: mainMap })

  // Benchmark — align by date when dates are available, fall back to index
  if (benchmarkData?.prices && benchmarkData.prices.length > 1) {
    const benchBase = benchmarkData.prices[0]
    const benchMap = new Map<string, number>()
    const bDates: string[] = benchmarkData.dates ?? []
    if (bDates.length > 0) {
      bDates.forEach((d, i) => {
        if (benchmarkData.prices[i] != null)
          benchMap.set(d, parseFloat(((benchmarkData.prices[i] / benchBase) - 1) * 100 as unknown as string))
      })
    } else {
      mainDates.forEach((d, i) => {
        if (i < benchmarkData.prices.length && benchmarkData.prices[i] != null)
          benchMap.set(d, parseFloat(((benchmarkData.prices[i] / benchBase) - 1) * 100 as unknown as string))
      })
    }
    const bLast = benchmarkData.prices[benchmarkData.prices.length - 1]
    const benchEnd = bLast != null ? ((bLast / benchBase) - 1) * 100 : null
    allSeries.push({ symbol: benchmark, color: 'var(--fd-muted)', dashed: true, endPct: benchEnd, dateMap: benchMap })
  }

  // Compare symbols — same date-keyed approach
  compareSymbols.forEach((sym, i) => {
    const cd = compareChartData[sym]?.[period]
    if (cd?.prices && cd.prices.length > 1) {
      const base = cd.prices[0]
      const cMap = new Map<string, number>()
      const cDates: string[] = cd.dates ?? []
      if (cDates.length > 0) {
        cDates.forEach((d: string, j: number) => {
          if (cd.prices[j] != null)
            cMap.set(d, parseFloat(((cd.prices[j] / base) - 1) * 100 as unknown as string))
        })
      } else {
        mainDates.forEach((d, j) => {
          if (j < cd.prices.length && cd.prices[j] != null)
            cMap.set(d, parseFloat(((cd.prices[j] / base) - 1) * 100 as unknown as string))
        })
      }
      const cLast = cd.prices[cd.prices.length - 1]
      const cEnd = cLast != null ? ((cLast / base) - 1) * 100 : null
      allSeries.push({ symbol: sym, color: colors[i % colors.length], dashed: true, endPct: cEnd, dateMap: cMap })
    }
  })

  // Build chart data keyed by main symbol's dates (canonical time axis)
  const chartData = mainDates.map(d => {
    const point: Record<string, number | null | string> = { __date: d }
    allSeries.forEach(s => { point[s.symbol] = s.dateMap.get(d) ?? null })
    return point
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ ...TOOLTIP_STYLE }}>
        {label && <div style={{ ...TOOLTIP_LABEL_STYLE }}>{label}</div>}
        {payload
          .filter((p: any) => p.value != null)
          .sort((a: any, b: any) => b.value - a.value)
          .map((p: any) => (
            <div key={p.dataKey} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <span style={{ color: p.color, fontWeight: 500 }}>{p.dataKey}</span>
              <span style={{ color: p.value >= 0 ? G : R }}>
                {p.value >= 0 ? '+' : ''}{p.value.toFixed(2)}%
              </span>
            </div>
          ))}
      </div>
    )
  }

  const allValues = allSeries.flatMap(s => [...s.dateMap.values()])
  const yMin = Math.floor(Math.min(...allValues, 0) - 2)
  const yMax = Math.ceil(Math.max(...allValues, 0) + 2)

  const fmtEndPct = (v: number | null) => v == null ? '' : ` ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  return (
    <>
      {/* Endpoint % in legend — lets user compare chart total return vs annualized table */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        {allSeries.map(s => (
          <span key={s.symbol} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: s.color, fontWeight: s.dashed ? 400 : 700 }}>
            {s.dashed ? '- -' : '—'} {s.symbol}
            <span style={{ color: s.endPct == null ? M : s.endPct >= 0 ? G : R }}>
              {fmtEndPct(s.endPct)}
            </span>
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 48 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
          <XAxis dataKey="__date" hide />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fill: 'var(--text2)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border2)' }}
            tickLine={false}
            tickFormatter={v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
            width={44}
          />
          <ReferenceLine y={0} stroke="var(--fd-hairline)" strokeDasharray="4 3" />
          <Tooltip content={customTooltip} />
          {allSeries.map(s => (
            <Line
              key={s.symbol}
              type="monotone"
              dataKey={s.symbol}
              stroke={s.color}
              strokeWidth={s.dashed ? 1.5 : 2.5}
              strokeDasharray={s.dashed ? '4 3' : undefined}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </>
  )
}

export function AnnualizedReturnsCompare({ ar, symbol, benchmark, compareSymbols }: {
  ar: NonNullable<ResearchApiData['annualized_returns']>
  symbol: string
  benchmark: string
  compareSymbols: string[]
}) {
  const sym = ar.symbol ?? {}
  const spyReturns = ar.spy ?? {}
  const periods = ['1Y', '3Y', '5Y', '10Y']
  const fmtAnn = (v: number | null | undefined) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v}%`

  const { data: benchmarkReturns } = useQuery<Record<string, number | null> | null>({
    queryKey: ['benchmark-annual', benchmark],
    queryFn: async () => {
      const res = await fetch(`/api/research?symbol=${encodeURIComponent(benchmark)}`)
      if (!res.ok) return null
      const d = await res.json()
      return d.annualized_returns?.symbol ?? null
    },
    enabled: benchmark !== 'SPY' && !!benchmark,
    staleTime: 10 * 60 * 1000,
  })

  const benchReturns: Record<string, number | null | undefined> =
    benchmark === 'SPY' ? spyReturns : (benchmarkReturns ?? spyReturns)

  const { data: compareData } = useQuery<Record<string, Record<string, number | null>>>({
    queryKey: ['compare-annual', ...compareSymbols],
    queryFn: async () => {
      const results: Record<string, Record<string, number | null>> = {}
      for (const cs of compareSymbols) {
        try {
          const res = await fetch(`/api/research?symbol=${encodeURIComponent(cs)}`)
          if (res.ok) {
            const d = await res.json()
            results[cs] = d.annualized_returns?.symbol ?? {}
          }
        } catch {}
      }
      return results
    },
    enabled: compareSymbols.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const COLORS = ['var(--fd-accent)', 'var(--fd-lilac-ink)', 'var(--fd-lime-ink)', 'var(--fd-muted)', 'var(--fd-ink)', 'var(--fd-negative)']

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>ANNUALIZED RETURNS</PanelHeader>
      <div style={{ marginTop: 8, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 12, color: M, borderBottom: '1px solid var(--border2)' }}>PERIOD</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 12, color: 'var(--amber)', borderBottom: '1px solid var(--border2)' }}>{symbol}</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 12, color: 'var(--fd-muted)', borderBottom: '1px solid var(--border2)' }}>{benchmark}</th>
              {compareSymbols.map((cs, i) => (
                <th key={cs} style={{ textAlign: 'right', padding: '4px 8px', fontSize: 12, color: COLORS[i % COLORS.length], borderBottom: '1px solid var(--border2)' }}>
                  {cs}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map(p => (
              <tr key={p} style={{ borderBottom: '1px solid var(--border2)' }}>
                <td style={{ padding: '4px 8px', color: M, fontSize: 12 }}>{p}</td>
                <td style={{ textAlign: 'right', padding: '4px 8px', color: sym[p] != null ? gainColor((sym[p] ?? 0) / 100) : M, fontWeight: 500, fontSize: 12 }}>
                  {fmtAnn(sym[p])}
                </td>
                <td style={{ textAlign: 'right', padding: '4px 8px', color: benchReturns[p] != null ? gainColor((benchReturns[p] ?? 0) / 100) : M, fontSize: 12 }}>
                  {fmtAnn(benchReturns[p])}
                </td>
                {compareSymbols.map((cs) => {
                  const val = compareData?.[cs]?.[p]
                  return (
                    <td key={cs} style={{ textAlign: 'right', padding: '4px 8px', color: val != null ? gainColor(val / 100) : M, fontWeight: 500, fontSize: 12 }}>
                      {fmtAnn(val)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function CandlestickChart({ symbol }: { symbol: string }) {
  const chartRef = useRef<HTMLDivElement>(null)
  const ground = useGround()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    if (!symbol) return

    const fetchData = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/candlestick?symbol=${symbol}`)
        const json = await res.json()
        if (json.error) {
          setError(json.error)
        } else {
          setData(json)
        }
      } catch (err) {
        setError('Failed to load chart data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [symbol])

  useEffect(() => {
    if (!chartRef.current || !data) return

    const chart = echarts.init(chartRef.current)
    const ink = cssVar('--fd-ink'), muted = cssVar('--fd-muted'), hair = cssVar('--fd-hairline')
    const up = cssVar('--fd-accent'), down = cssVar('--fd-negative')
    const ma20 = cssVar('--fd-lilac-ink'), ma50 = cssVar('--fd-lime-ink')

    const option = {
      backgroundColor: 'transparent',
      title: {
        text: `${symbol} — Candlestick (Last 60 days)`,
        left: 'center',
        textStyle: { color: ink, fontSize: 12 }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' }
      },
      grid: {
        left: '10%',
        right: '8%',
        top: '15%',
        bottom: '10%'
      },
      xAxis: {
        type: 'category',
        data: data.dates,
        axisLabel: { rotate: 45, color: muted, fontSize: 12 },
        axisLine: { lineStyle: { color: hair } }
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: muted, fontSize: 12 },
        splitLine: { lineStyle: { color: hair } }
      },
      series: [
        {
          name: 'Candlestick',
          type: 'candlestick',
          data: data.ohlc.map((d: any) => [d[1], d[2], d[3], d[4]]),
          itemStyle: {
            color: up,
            color0: down,
            borderColor: up,
            borderColor0: down
          }
        },
        {
          name: 'MA20',
          type: 'line',
          data: data.ma20,
          lineStyle: { color: ma20, width: 2 },
          symbol: 'none'
        },
        {
          name: 'MA50',
          type: 'line',
          data: data.ma50,
          lineStyle: { color: ma50, width: 2 },
          symbol: 'none'
        },
        {
          name: 'Current Price',
          type: 'line',
          data: Array(data.dates.length).fill(data.currentPrice),
          lineStyle: { color: ink, width: 1, type: 'dashed' },
          symbol: 'none'
        }
      ],
      legend: {
        data: ['Candlestick', 'MA20', 'MA50', 'Current Price'],
        orient: 'horizontal',
        left: 'left',
        top: 0,
        textStyle: { color: muted, fontSize: 12 }
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { start: 0, end: 100 }
      ]
    }

    chart.setOption(option)

    const handleResize = () => chart.resize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.dispose()
    }
  }, [data, symbol, ground])

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fd-muted)' }}>
        Loading candlestick chart...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fd-negative)', fontSize: 12 }}>
        Error: {error}
      </div>
    )
  }

  return (
    <div style={{ height: 400, width: '100%' }}>
      <div ref={chartRef} style={{ height: '100%', width: '100%' }} />
    </div>
  )
}
