// ── MODULE 2: Action Engine sub-panels ────────────────────────────────────────

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts'
import { PanelHeader, DataRow, Divider } from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { G, R, A, M, Y } from './researchTypes'
import type { ResearchApiData } from './researchTypes'
import { qualityColor } from './researchHelpers'
import { SizingMeter } from './ResearchMeters'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS, TOOLTIP_CURSOR } from '../ui/chartTooltip'

export function QualityEnginePanel({ qe, yieldPct }: { qe?: ResearchApiData['quality_engine']; yieldPct?: number | null }) {
  if (!qe?.quality_score) return null
  const qs = qe.quality_score
  const qColor = qualityColor(qs)
  const bkd = qe.quality_breakdown ?? {}

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
      <PanelHeader>A. QUALITY ENGINE</PanelHeader>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ textAlign: 'center', minWidth: 70 }}>
            <div style={{ fontSize: 42, fontWeight: 500, color: qColor, lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{qs}</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: qColor }}>{qe.quality_label}</div>
          </div>
          <div style={{ flex: 1 }}>
            {(() => {
              const chartData = Object.entries(bkd)
                .filter(([, val]) => val && val.max > 0)
                .map(([key, val]) => ({
                  name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                  pct: Math.round(val.points / val.max * 100),
                  pts: `${val.points}/${val.max}`,
                }))
              if (chartData.length === 0) return null
              return (
                <ResponsiveContainer width="100%" height={chartData.length * 24 + 8}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 34, top: 0, bottom: 0 }}>
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fill: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }} />
                    <Tooltip
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_RECHARTS}
                      itemStyle={TOOLTIP_ITEM_RECHARTS}
                      cursor={TOOLTIP_CURSOR}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(val: unknown, _n: unknown, entry: any) => [`${Number(val)}% (${entry.payload.pts})`, 'Score']}
                    />
                    <Bar dataKey="pct" radius={0} label={{ position: 'right', fontSize: 12, fill: 'var(--text2)', formatter: (v: unknown) => `${v}%` }}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={d.pct >= 70 ? 'var(--fd-accent)' : d.pct >= 50 ? '#ffd600' : 'var(--fd-negative)'} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            })()}
          </div>
        </div>
        {qe.income_quality_score != null && (yieldPct == null || yieldPct >= 0.5) && (
          <div style={{ padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500, marginBottom: 2 }}>INCOME QUALITY</div>
              <div style={{ fontSize: 22, fontWeight: 500, color: qualityColor(qe.income_quality_score), fontFamily: 'var(--font-mono)' }}>{qe.income_quality_score}</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: qualityColor(qe.income_quality_score) }}>{qe.income_quality_label}</div>
          </div>
        )}
        {qe.income_quality_score != null && yieldPct != null && yieldPct < 0.5 && (
          <div style={{ padding: '5px 10px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', borderRadius: 0, fontSize: 12, color: M }}>
            Income Quality: N/A — yield {yieldPct.toFixed(2)}% (growth fund, not an income vehicle)
          </div>
        )}
      </div>
    </div>
  )
}

// Replaces the old Entry/Exit/Alert "Engines" — those names didn't mean
// anything to a reader, and the buy/sell prices they used to show now live
// solely in the hero card's Action Price block. What's left here is the
// technical detail that explains *why* the hero verdict is what it is,
// grouped by what it actually measures instead of by an arbitrary engine name.
export function SignalDetailPanel({ r, price, tl, showTech }: { r: ResearchApiData; price: number; tl?: ResearchApiData['trading_levels']; showTech: boolean }) {
  const t = r.technicals
  const rsi = t?.rsi_14
  const rsiColor = rsi == null ? M : rsi >= 70 ? R : rsi <= 30 ? G : M

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
      <PanelHeader>SIGNAL DETAIL</PanelHeader>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>

        {showTech && rsi != null && (
          <>
            <Divider label="MOMENTUM" />
            <DataRow label="RSI (14)" value={<span style={{ color: rsiColor, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{rsi.toFixed(1)} {rsi >= 70 ? 'OB' : rsi <= 30 ? 'OS' : 'NEUTRAL'}</span>} />
            <MiniBar value={rsi} color={rsiColor} height={4} />
            {t?.macd_histogram != null && <DataRow label="MACD" value={<span style={{ color: t.macd_bullish ? G : R, fontWeight: 500 }}>{t.macd_bullish ? '▲ BULLISH' : '▼ BEARISH'} ({t.macd_histogram.toFixed(4)})</span>} />}
          </>
        )}

        {(t?.ma_20 != null || t?.ma_50 != null || t?.ma_200 != null) && (
          <>
            <Divider label="TREND" />
            {t?.ma_20 != null && <DataRow label="vs MA-20" value={<span style={{ color: price >= (t.ma_20 ?? 0) ? G : R, fontFamily: 'var(--font-mono)' }}>{price >= (t.ma_20 ?? 0) ? 'ABOVE' : 'BELOW'} ${t.ma_20?.toFixed(2)}</span>} />}
            {t?.ma_50 != null && <DataRow label="vs MA-50" value={<span style={{ color: price >= (t.ma_50 ?? 0) ? G : R, fontFamily: 'var(--font-mono)' }}>{price >= (t.ma_50 ?? 0) ? 'ABOVE' : 'BELOW'} ${t.ma_50?.toFixed(2)}</span>} />}
            {t?.ma_200 != null && <DataRow label="vs MA-200" value={<span style={{ color: price >= (t.ma_200 ?? 0) ? G : R, fontFamily: 'var(--font-mono)' }}>{price >= (t.ma_200 ?? 0) ? 'ABOVE' : 'BELOW'} ${t.ma_200.toFixed(2)}</span>} />}
          </>
        )}

        {(t?.hist_vol_10d != null || r.risk_stats?.max_drawdown != null || t?.bollinger_upper != null) && (
          <>
            <Divider label="RISK" />
            {t?.hist_vol_10d != null && <DataRow label="HIST VOL" value={<span style={{ color: t.hist_vol_10d > 30 ? R : t.hist_vol_10d > 15 ? Y : G, fontFamily: 'var(--font-mono)' }}>{t.hist_vol_10d.toFixed(1)}%</span>} />}
            {r.risk_stats?.max_drawdown != null && <DataRow label="MAX DRAWDOWN" value={<span style={{ color: R, fontFamily: 'var(--font-mono)' }}>{r.risk_stats.max_drawdown.toFixed(2)}%</span>} />}
            {t?.bollinger_upper != null && <DataRow label="BB UPPER" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${t.bollinger_upper.toFixed(2)}</span>} />}
          </>
        )}

        {tl?.composite_signal != null && (
          <>
            <Divider label="SIGNAL BREAKDOWN" />
            <DataRow
              label="COMPOSITE"
              value={
                <span style={{
                  color: tl.composite_signal === 2 ? G : tl.composite_signal === 1 ? 'var(--amber)' : M,
                  fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12,
                }}>
                  {tl.composite_label ?? 'NO SIGNAL'}
                </span>
              }
            />
            <DataRow
              label="Pullback / Breakout / Oversold"
              value={
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12 }}>
                  <span style={{ color: tl.trigger_pullback === 2 ? G : tl.trigger_pullback === 1 ? 'var(--amber)' : M }}>{tl.trigger_pullback ? '▲' : '—'}</span>{' '}
                  <span style={{ color: tl.trigger_breakout ? G : M }}>{tl.trigger_breakout ? '▲' : '—'}</span>{' '}
                  <span style={{ color: tl.trigger_oversold ? G : M }}>{tl.trigger_oversold ? '▲' : '—'}</span>
                </span>
              }
            />
            {tl.buy_triggered != null && (
              tl.sell_triggered
                ? <DataRow label="BUY TRIGGER" value={<span style={{ color: M, fontWeight: 500, fontSize: 12 }}>SUPPRESSED (sell signal active)</span>} />
                : <DataRow label="BUY TRIGGER" value={<span style={{ color: tl.buy_triggered ? G : M, fontWeight: 500, fontSize: 12 }}>{tl.buy_triggered ? '★ TRIGGERED' : 'NOT TRIGGERED'}</span>} />
            )}
            {tl.sell_triggered != null && <DataRow label="SELL TRIGGER" value={<span style={{ color: tl.sell_triggered ? R : M, fontWeight: 500, fontSize: 12 }}>{tl.sell_triggered ? ' TRIGGERED' : 'NOT TRIGGERED'}</span>} />}
          </>
        )}

        {(tl?.alert_price != null || tl?.vol_1h_rate != null || tl?.intraday_move_pct != null) && (
          <>
            <Divider label="ALERTS & ACTIVITY" />
            {tl?.alert_price != null && <DataRow label="SUGGESTED ALERT" value={<span style={{ color: A, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>${tl.alert_price.toFixed(2)}</span>} sub="price touches buy level trigger" />}
            {tl?.high_21d != null && <DataRow label="21D HIGH" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${tl.high_21d.toFixed(2)}</span>} />}
            {tl?.vol_1h_rate != null && <DataRow label="1H VOL RATE" value={<span style={{ color: tl.vol_1h_rate > 2 ? R : M, fontFamily: 'var(--font-mono)' }}>{tl.vol_1h_rate.toFixed(2)}× avg</span>} />}
            {tl?.intraday_move_pct != null && <DataRow label="INTRADAY MOVE" value={<span style={{ color: Math.abs(tl.intraday_move_pct) > 2 ? Y : M, fontFamily: 'var(--font-mono)' }}>{tl.intraday_move_pct >= 0 ? '+' : ''}{tl.intraday_move_pct.toFixed(2)}%</span>} />}
          </>
        )}

        {tl?.signal_score != null && <DataRow label="SIGNAL SCORE" value={<span style={{ color: A, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{tl.signal_score}/5</span>} />}
        <SizingMeter sizingPct={tl?.sizing_pct} />
      </div>
    </div>
  )
}
