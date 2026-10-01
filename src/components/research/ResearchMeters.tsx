// ── V3 Visual Meters ─────────────────────────────────────────────────────────

import { useState } from 'react'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts'
import { G, R, A, M, Y } from './researchTypes'
import type { ResearchApiData } from './researchTypes'

// @ts-ignore
export function TrendRegimeMeter({ price, tl, technicals }: {
  price: number
  tl?: ResearchApiData['trading_levels']
  technicals?: ResearchApiData['technicals']
}) {
  // Regime segments
  const regimeTiers = [
    { key: 'calm', label: 'CALM', color: 'var(--fd-accent)' },
    { key: 'normal', label: 'NORMAL', color: G },
    { key: 'high_vol', label: 'HIGH-VOL', color: Y },
    { key: 'extreme', label: 'EXTREME', color: R },
  ]
  const activeTier = tl?.active_tier ?? 'normal'

  // Trend from MA relationships
  const ma20 = technicals?.ma_20
  const ma50 = technicals?.ma_50
  const ma200 = technicals?.ma_200
  const aboveMa20  = ma20  != null && price > ma20
  const aboveMa50  = ma50  != null && price > ma50
  const aboveMa200 = ma200 != null && price > ma200
  const trendScore = [aboveMa20, aboveMa50, aboveMa200].filter(Boolean).length
  const trendLabel = trendScore === 3 ? 'UPTREND' : trendScore === 0 ? 'DOWNTREND' : 'MIXED'
  const trendColor = trendScore >= 2 ? G : trendScore === 0 ? R : Y

  if (!tl?.active_tier && !ma20 && !ma50) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {/* Regime Meter */}
      {tl?.active_tier && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>VOLATILITY REGIME</div>
          <div style={{ display: 'flex', gap: 1 }}>
            {regimeTiers.map(t => {
              const isActive = t.key === activeTier
              return (
                <div key={t.key} style={{
                  flex: 1, textAlign: 'center', padding: '5px 2px',
                  background: isActive ? `${t.color}22` : 'var(--panel)',
                  border: `1px solid ${isActive ? t.color : 'var(--border2)'}`,
                  borderBottom: isActive ? `3px solid ${t.color}` : '3px solid transparent',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: isActive ? t.color : M, letterSpacing: '0.3px' }}>{t.label}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Trend Meter */}
      {(ma20 != null || ma50 != null || ma200 != null) && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>TREND METER</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: trendColor, fontFamily: 'var(--font-mono)' }}>
              {trendLabel}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { label: 'MA20', above: aboveMa20, val: ma20 },
                { label: 'MA50', above: aboveMa50, val: ma50 },
                { label: 'MA200', above: aboveMa200, val: ma200 },
              ].filter(m => m.val != null).map(m => (
                <div key={m.label} style={{
                  fontSize: 12, padding: '2px 5px', fontWeight: 500,
                  background: m.above ? `${G}18` : `${R}18`,
                  color: m.above ? G : R,
                  border: `1px solid ${m.above ? G : R}`,
                }}>
                  {m.above ? '▲' : '▼'}{m.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SIZING_RULES = [
  {
    val: 100, color: G, label: '100% — Strong Buy',
    rule: 'Price below MA20 AND RSI < 40',
    meaning: 'Deep oversold dip in an uptrend. Maximum conviction entry — full sleeve allocation.',
  },
  {
    val: 50, color: A, label: '50% — Buy',
    rule: 'Price within ±2% of MA20 AND RSI ≤ 70',
    meaning: 'Sitting near support, not overbought. Half-size entry — add more on further dips.',
  },
  {
    val: 25, color: Y, label: '25% — Buy (Hi-Vol)',
    rule: 'Price within 5% of MA20, not overbought',
    meaning: 'Approaching support but not quite there. Starter position only — wait for better entry.',
  },
  {
    val: 0, color: R, label: '0% — No Entry',
    rule: 'RSI > 70 overbought, price near Bollinger upper, or trend broken',
    meaning: 'No buy trigger met. Could be overbought, taking profit, or in a downtrend. Do not add.',
  },
]

export function SizingMeter({ sizingPct }: { sizingPct?: number }) {
  const [showTip, setShowTip] = useState<number | false>(false)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })

  if (sizingPct == null) return null
  const tiers = [
    { label: '0%', val: 0, color: R },
    { label: '25%', val: 25, color: Y },
    { label: '50%', val: 50, color: A },
    { label: '100%', val: 100, color: G },
  ]
  const active = tiers.reduce((prev, cur) =>
    Math.abs(cur.val - sizingPct) < Math.abs(prev.val - sizingPct) ? cur : prev
  )
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>
        SIZING GUIDANCE
      </div>

      {/* Tier buttons — each has its own hover tooltip */}
      <div style={{ display: 'flex', gap: 1 }}>
        {tiers.map(t => {
          const isActive = t.val === active.val
          const rule = SIZING_RULES.find(r => r.val === t.val)!
          return (
            <div
              key={t.val}
              style={{
                flex: 1, textAlign: 'center', padding: '4px 2px', cursor: 'help',
                background: isActive ? `${t.color}20` : 'var(--panel)',
                border: `1px solid ${isActive ? t.color : 'var(--border2)'}`,
              }}
              onMouseMove={e => { setTipPos({ x: e.clientX, y: e.clientY }); setShowTip(t.val) }}
              onMouseLeave={() => setShowTip(false)}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: isActive ? t.color : M }}>{t.label}</div>

              {/* Per-tier tooltip */}
              {showTip === t.val && (
                <div style={{
                  position: 'fixed',
                  left: tipPos.x + 12,
                  top: tipPos.y - 8,
                  transform: tipPos.x > window.innerWidth - 300 ? 'translateX(-100%)' : undefined,
                  zIndex: 9999, width: 260,
                  background: 'var(--bg2)',
                  border: `1px solid ${t.color}`,
                  borderTop: `2px solid ${t.color}`,
                  borderRadius: 0,
                  padding: '10px 12px',
                  boxShadow: 'none',
                  pointerEvents: 'none',
                  textAlign: 'left',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: t.color, marginBottom: 6 }}>
                    {rule.label}
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 6, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text2)' }}>Trigger: </span>
                    <span style={{ color: 'var(--text)' }}>{rule.rule}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                    {rule.meaning}
                  </div>
                  {isActive && (
                    <div style={{ marginTop: 6, padding: '4px 6px',
                      background: `${t.color}10`, border: `1px solid ${t.color}`,
                      borderRadius: 0, fontSize: 12, color: t.color }}>
                      ← Current signal
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 12, color: M, marginTop: 3 }}>
        Suggested: <span style={{ color: active.color, fontWeight: 500 }}>{sizingPct}%</span> of sleeve allocation
      </div>
    </div>
  )
}

export function MomentumScorePanel({ technicals, tl }: {
  technicals?: ResearchApiData['technicals']
  tl?: ResearchApiData['trading_levels']
}) {
  if (!technicals) return null
  const t = technicals

  // Build signal scores (each 0 or 1, then composite)
  const signals: { label: string; bull: boolean | null; weight: number }[] = [
    { label: 'RSI', bull: t.rsi_14 != null ? (t.rsi_14 > 50 && t.rsi_14 < 70) : null, weight: 20 },
    { label: 'MACD', bull: t.macd_bullish ?? null, weight: 25 },
    { label: 'OBV', bull: t.obv_bullish ?? null, weight: 20 },
    { label: 'Stoch', bull: t.stochastic_k != null ? (t.stochastic_k < 80 && t.stochastic_k > 20) : null, weight: 15 },
    { label: 'Signal', bull: tl?.signal_score != null ? (tl.signal_score >= 3) : null, weight: 20 },
  ].filter(s => s.bull !== null)

  if (signals.length === 0) return null

  const bullCount = signals.filter(s => s.bull).length
  const score = Math.round((bullCount / signals.length) * 100)
  const scoreColor = score >= 70 ? G : score >= 45 ? Y : R
  const scoreLabel = score >= 70 ? 'BULLISH' : score >= 45 ? 'NEUTRAL' : 'BEARISH'

  const radarData = signals.map(s => ({
    signal: s.label,
    value: s.bull ? 100 : 0,
  }))

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px', marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>MOMENTUM COMPOSITE SCORE</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Score */}
        <div style={{ textAlign: 'center', minWidth: 70 }}>
          <div style={{ fontSize: 36, fontWeight: 500, color: scoreColor, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: scoreColor }}>{scoreLabel}</div>
        </div>
        {/* Radar chart */}
        <ResponsiveContainer width={120} height={100}>
          <RadarChart data={radarData} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
            <PolarGrid stroke="var(--border2)" />
            <PolarAngleAxis dataKey="signal" tick={{ fill: 'var(--text2)', fontSize: 12 }} />
            <Radar dataKey="value" stroke={scoreColor} fill={scoreColor} fillOpacity={0.3} />
          </RadarChart>
        </ResponsiveContainer>
        {/* Signal list */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {signals.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: s.bull ? G : R, fontSize: 12 }}>{s.bull ? '▲' : '▼'}</span>
              <span style={{ color: M, width: 40 }}>{s.label}</span>
              <div style={{ flex: 1, height: 3, background: 'var(--bg)', borderRadius: 0 }}>
                <div style={{ height: 3, width: s.bull ? '100%' : '0%', background: s.bull ? G : R, borderRadius: 0, transition: 'width 0.3s' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
