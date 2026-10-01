/**
 * SwingSignalPanel — read-only swing trade analysis for the Research tab.
 *
 * Auto-fetches when mounted (or when symbol changes). Displays everything
 * from the swing engine — score, signal, levels, indicators, context scores,
 * candlestick chart — but no order-placement UI.
 */

import { useState, useEffect, useRef } from 'react'
import { SwingCalendarPanel } from './SwingCalendarPanel'
import { PanelHeader, DataRow, Divider } from '../ui/Terminal'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ContextScores { LCS: number; TCS: number; RCS: number }

interface SwingAnalysis {
  symbol:        string
  timeframe:     string
  price:         number
  prev_close:    number
  change_pct:    number
  rsi:           number
  atr:           number
  atr_pct:       number
  ma20:          number | null
  ma50:          number | null
  trend:         string
  pullback_pct:  number
  recent_high:   number
  vol_ratio:           number
  vol_trend:           string
  vol_spike:           boolean
  vol_regime:          string
  vol_entry_gate:      string
  vol_exit_urgency:    string
  vol_confidence_delta: number
  symbol_score:  number
  symbol_interpretation: string
  score_reasons: string[]
  entry_signal:  number
  signal_text:   string
  signal_icon:   string
  signal_type:   string
  entry_conditions_met:     string[]
  entry_conditions_missing: string[]
  setup_score:   number
  entry_price:   number
  stop_loss:     number
  take_profit:   number
  rr_ratio:      number
  is_buyable:    boolean
  final_decision: string
  recommendation: string
  context_scores: ContextScores
  bars:      Array<{ o: number; h: number; l: number; c: number; v: number }>
  bar_count: number
  error?: string
}

// ── Palette (mirrors Research tab style) ──────────────────────────────────────

const A  = 'var(--amber)'
const G  = 'var(--green)'
const R  = 'var(--red)'
const M  = 'var(--text2)'


// ── Sub-components ─────────────────────────────────────────────────────────────


function ScoreDots({ value, max = 5, color }: { value: number; max?: number; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} style={{ width: 9, height: 9, borderRadius: 0,
          background: i < value ? color: 'var(--fd-muted)' }} />
      ))}
    </div>
  )
}


// ── Responsive candlestick chart ──────────────────────────────────────────────

function MiniChart({ bars, entry, stop, target, current }: {
  bars:    SwingAnalysis['bars']
  entry:   number; stop: number; target: number; current: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(800)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setW(Math.floor(w))
    })
    obs.observe(el)
    // Initial measure
    if (el.clientWidth > 0) setW(el.clientWidth)
    return () => obs.disconnect()
  }, [])

  if (!bars || bars.length === 0) return null

  const H = 220
  const n     = Math.min(bars.length, 30)  // 6 weeks of daily bars
  // Use the full bars array for MA computation so early bars have enough history,
  // then slice to the last n for display.
  const allCloses = bars.map(b => b.c)
  const slice  = bars.slice(bars.length - n)
  const startIdx = bars.length - n   // index into bars/allCloses where display starts

  // ── Compute rolling MAs over full history ────────────────────────────────
  const rollingMA = (period: number): (number | null)[] =>
    allCloses.map((_, i) =>
      i < period - 1 ? null
        : allCloses.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period
    )
  const ma20all = rollingMA(20)
  const ma50all = rollingMA(50)

  // Slice to display window
  const ma20 = ma20all.slice(startIdx)   // length = n
  const ma50 = ma50all.slice(startIdx)

  const extras = [entry, stop, target, current]
  const lo    = Math.min(...slice.map(b => b.l), ...extras)
  const hi    = Math.max(...slice.map(b => b.h), ...extras)
  const rng   = hi - lo || 1
  const bw    = Math.max(2, (W / n) - 1.5)
  const toY   = (p: number) => H - ((p - lo) / rng) * H

  // Build SVG polyline points string from a nullable series
  const maPoints = (series: (number | null)[]): string =>
    series
      .map((v, i) => v == null ? null : `${(i + 0.5) * (W / n)},${toY(v)}`)
      .filter(Boolean)
      .join(' ')

  const HLine = ({ price, color, label, dash = '3,3', bold = false }: {
    price: number; color: string; label: string; dash?: string; bold?: boolean
  }) => {
    const y = toY(price)
    return (
      <g>
        <line x1={0} y1={y} x2={W} y2={y} stroke={color}
          strokeWidth={bold ? 1.5 : 1} strokeDasharray={dash} strokeOpacity={0.85} />
        <text x={W - 4} y={y - 3} fill={color} fontSize={9}
          textAnchor="end" fontWeight={bold ? 700 : 400}>
          {label} ${price.toFixed(2)}
        </text>
      </g>
    )
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg width={W} height={H + 4} style={{ display: 'block', width: '100%' }}>
        <rect width={W} height={H} fill="#0d1117" rx={4} />
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={0} y1={H * f} x2={W} y2={H * f}
            stroke="var(--fd-hairline)" strokeWidth={0.5} />
        ))}
        {/* Candles */}
        {slice.map((b, i) => {
          const x = i * (W / n), up = b.c >= b.o
          const col = up ? 'var(--fd-accent)' : 'var(--fd-negative)'
          const bt = toY(Math.max(b.o, b.c))
          const bh = Math.max(1, Math.abs(toY(b.o) - toY(b.c)))
          return (
            <g key={i}>
              <line x1={x + bw / 2} y1={toY(b.h)} x2={x + bw / 2} y2={toY(b.l)}
                stroke={col} strokeWidth={0.8} />
              <rect x={x + 0.5} y={bt} width={Math.max(bw - 1, 1)}
                height={bh} fill={col} fillOpacity={0.85} />
            </g>
          )
        })}

        {/* MA lines — drawn on top of candles */}
        {maPoints(ma20) && (
          <polyline points={maPoints(ma20)} fill="none"
            stroke="#f9e2af" strokeWidth={1.5} strokeOpacity={0.85}
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {maPoints(ma50) && (
          <polyline points={maPoints(ma50)} fill="none"
            stroke="#f38ba8" strokeWidth={1.5} strokeOpacity={0.85}
            strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Price level overlays */}
        <HLine price={target}  color="var(--fd-accent)" label="Target" bold />
        <HLine price={current} color="#f9e2af" label="Current" dash="2,2" />
        <HLine price={entry}   color="var(--fd-accent)" label="Entry"   bold />
        <HLine price={stop}    color="var(--fd-negative)" label="Stop" />
      </svg>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--fd-muted)',
        display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span><span style={{ color: '#f9e2af' }}>━━</span> MA 20</span>
        <span><span style={{ color: '#f38ba8' }}>━━</span> MA 50</span>
        <span style={{ marginLeft: 4 }}>|</span>
        <span><span style={{ color: 'var(--fd-accent)' }}>━━</span> Target</span>
        <span><span style={{ color: '#f9e2af', opacity: 0.6 }}>╌╌</span> Current</span>
        <span><span style={{ color: 'var(--fd-accent)' }}>━━</span> Entry</span>
        <span><span style={{ color: 'var(--fd-negative)' }}>━━</span> Stop</span>
      </div>
    </div>
  )
}

// ── Timeframe selector ─────────────────────────────────────────────────────────

const TIMEFRAMES = [
  { id: '1d',  label: 'Daily'  },
  { id: '1h',  label: '1 hr'   },
  { id: '30m', label: '30 min' },
  { id: '15m', label: '15 min' },
  { id: '5m',  label: '5 min'  },
]

// ── Main component ─────────────────────────────────────────────────────────────

// Calendar result type (mirrors SwingCalendarPanel's CalendarResult — subset we use)
interface CalendarData {
  master_action: string; master_detail: string
  current_phase: string; phase_day: number
  stat_entry_window: string; pullback_probability: number
  confidence: { score: number; label: string; reasons: string[] }
  price_bands: {
    recent_high: number; current_zone: string; current_pct_from_high: number
    ladder_anchor?: number; ladder_anchor_label?: 'high' | 'ma50' | 'blend'
    entry_ladder: Array<{ label: string; price: number; drop_pct: number; size_pct: number; zone: string; desc?: string }>
  }
  expected_edge: { win_rate: number | null; avg_gain_pct: number | null; avg_hold: number; sample: number }
  macro_overlay: { regime_label: string; vix: number | null; buy_drop_pct: number; strong_drop_pct: number; panic_drop_pct: number }
}

export function SwingSignalPanel({ symbol, price: livePrice, limitPrice, portfolioSymbols = [], regime = 'CONSOLIDATION', vix = 0 }: {
  symbol:            string
  // The same live quote shown everywhere else on the Research tab (Schwab
  // live, falling back to last close). The swing engine fetches its own
  // yfinance bars independently and can lag this by a dollar or more —
  // using it (not data.price) for "current price" keeps this panel from
  // ever showing a number that visibly contradicts the rest of the page.
  price:             number
  // The hero card's ATR-scaled limit price (live price minus a small ATR
  // increment) — reused here so both cards agree on the one number that
  // matters. A "buy" at exactly the current price is a market order, not a
  // limit order, so once already in a buy zone this — not livePrice — is
  // the actionable number.
  limitPrice?:       number
  portfolioSymbols?: string[]
  regime?:           string
  vix?:              number
}) {
  const [timeframe, setTimeframe] = useState('1d')
  const [data,      setData]      = useState<SwingAnalysis | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [err,       setErr]       = useState('')
  const [lastSym,   setLastSym]   = useState('')
  const [lastTf,    setLastTf]    = useState('')
  // Calendar data lifted from SwingCalendarPanel — drives the verdict + A/B/C/D detail
  const [cal, setCal] = useState<CalendarData | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  const fetch_ = async (sym: string, tf: string) => {
    if (!sym) return
    setLoading(true); setErr(''); setData(null)
    try {
      const res = await fetch(`/api/sim/swing/${sym.toUpperCase()}?interval=${tf}`)
      const d: SwingAnalysis = await res.json()
      if (d.error) { setErr(d.error); return }
      setData(d)
      setLastSym(sym); setLastTf(tf)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Fetch failed')
    } finally { setLoading(false) }
  }

  // Auto-fetch when symbol changes or timeframe changes
  useEffect(() => {
    if (symbol && (symbol !== lastSym || timeframe !== lastTf)) {
      fetch_(symbol, timeframe)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe])

  const scoreColor    = data ? (data.symbol_score >= 4 ? G : data.symbol_score >= 3 ? A : R) : M
  const decisionColor = data ? (data.is_buyable ? G : data.setup_score >= 45 ? A : R) : M

  // ── Loading / error states ──────────────────────────────────────────────────
  if (!symbol) return (
    <div style={{ padding: 20, fontSize: 12, color: M }}>Select a symbol to see swing signal.</div>
  )

  if (loading) return (
    <div style={{ padding: 20, fontSize: 12, color: M }}>
      Analyzing {symbol} ({timeframe})…
    </div>
  )

  if (err) return (
    <div style={{ padding: '10px 12px', color: R, fontSize: 12 }}> {err}</div>
  )

  // ── Timeframe bar (always shown) ────────────────────────────────────────────
  const TfBar = () => (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 12,
      flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: M, textTransform: 'uppercase',
        letterSpacing: '0.5px', marginRight: 4 }}>Timeframe</span>
      {TIMEFRAMES.map(tf => (
        <button key={tf.id} onClick={() => setTimeframe(tf.id)} style={{
          padding: '2px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 0,
          border: `1px solid ${timeframe === tf.id ? A : 'var(--border2)'}`,
          background: timeframe === tf.id ? `${A}18` : 'transparent',
          color: timeframe === tf.id ? A : M,
          fontWeight: timeframe === tf.id ? 700 : 400,
        }}>
          {tf.label}
        </button>
      ))}
      {data && (
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fd-muted)' }}>
          {data.bar_count} bars · last close ${data.price.toFixed(2)}
        </span>
      )}
    </div>
  )

  if (!data) return <div style={{ padding: '8px 4px' }}><TfBar /></div>

  // ── Full analysis display ───────────────────────────────────────────────────
  const rrColor        = data.rr_ratio >= 2 ? G : data.rr_ratio >= 1.5 ? A : R
  const targetAchieved = data.take_profit <= livePrice

  // ── Swing Verdict — the ONE buy/sell number ─────────────────────────────
  // Same fix as the main hero card, in two parts: (1) the calendar's entry
  // ladder is anchored to the recent high, so once price has already
  // dropped into a buy tier, showing that stale ladder level is wrong; (2)
  // once triggered, the actionable price still isn't livePrice itself — a
  // limit order sitting exactly at market is a market order, not a limit
  // buy, so it uses the same small-ATR-below-market limitPrice as the hero
  // card (falling back to livePrice only if that's unavailable).
  const currentZone     = cal?.price_bands?.current_zone
  const alreadyInBuyZone = currentZone === 'buy' || currentZone === 'strong_buy' || currentZone === 'panic_buy'
  const nextTier         = cal?.price_bands?.entry_ladder?.find(row => row.zone === 'buy')

  let verdictLabel: string
  let verdictPrice: number | null
  let verdictSub: string
  let verdictColor: string
  if (cal) {
    if (alreadyInBuyZone) {
      verdictLabel = cal.master_action || 'IN ZONE'
      verdictPrice = limitPrice ?? livePrice
      verdictSub   = `already ${Math.abs(cal.price_bands.current_pct_from_high).toFixed(1)}% off the recent high — ${currentZone!.replace('_', ' ')} zone active`
      verdictColor = G
    } else if (nextTier) {
      verdictLabel = 'Buy Trigger'
      verdictPrice = nextTier.price
      const anchorLabel = cal.price_bands.ladder_anchor_label === 'ma50' ? 'MA50'
        : cal.price_bands.ladder_anchor_label === 'blend' ? 'the blended anchor'
        : 'recent high'
      const anchorValue  = cal.price_bands.ladder_anchor ?? cal.price_bands.recent_high
      verdictSub   = `need a ${nextTier.drop_pct.toFixed(1)}% pullback from ${anchorLabel} ($${anchorValue.toFixed(2)})`
      verdictColor = A
    } else {
      verdictLabel = cal.master_action || 'WATCH'
      verdictPrice = null
      verdictSub   = cal.master_detail
      verdictColor = M
    }
  } else {
    verdictLabel = data.is_buyable ? 'Buy' : data.setup_score >= 45 ? 'Watch' : 'Avoid'
    verdictPrice = data.entry_price
    verdictSub   = data.signal_text
    verdictColor = data.is_buyable ? G : data.setup_score >= 45 ? A : R
  }
  const verdictRationale = cal?.master_detail ?? data.recommendation

  return (
    <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <TfBar />

      {/* ══════════ SWING VERDICT — the one buy/sell number ══════════ */}
      <div style={{ border: `2px solid ${verdictColor}`, borderRadius: 0, overflow: 'hidden', background: 'var(--surface)' }}>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
            letterSpacing: '1.2px', marginBottom: 8 }}>◈ SWING VERDICT</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 500, color: verdictColor, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                {verdictLabel}
              </div>
              <div style={{ fontSize: 20, fontWeight: 500, color: verdictColor, fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                {verdictPrice != null ? `$${verdictPrice.toFixed(2)}` : '—'}
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 4, maxWidth: 340 }}>{verdictSub}</div>
            </div>
            <div style={{ display: 'flex', gap: 18 }}>
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4 }}>Stop</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: R, fontFamily: 'var(--font-mono)' }}>${data.stop_loss.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4 }}>Target</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>
                  {targetAchieved ? '✓ hit' : `$${data.take_profit.toFixed(2)}`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4 }}>R:R</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: rrColor, fontFamily: 'var(--font-mono)' }}>1:{data.rr_ratio.toFixed(1)}</div>
              </div>
            </div>
          </div>
          {verdictRationale && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text)', lineHeight: 1.6,
              padding: '8px 10px', background: 'var(--fd-card)',
              borderLeft: `3px solid ${verdictColor}70` }}>
              {verdictRationale}
            </div>
          )}
        </div>
      </div>

      {/* ── Candlestick chart — 6 weeks of daily bars, always visible ────── */}
      {data.bars.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
          <PanelHeader>CANDLESTICK — 6 WEEKS · {data.timeframe.toUpperCase()}</PanelHeader>
          <div style={{ marginTop: 10 }}>
            <MiniChart
              bars={data.bars}
              entry={data.entry_price}
              stop={data.stop_loss}
              target={data.take_profit}
              current={livePrice}
            />
          </div>
        </div>
      )}

      {/* ── Toggle — everything below is supporting detail ────────────────── */}
      <button onClick={() => setShowDetail(s => !s)} style={{
        alignSelf: 'flex-start', padding: '6px 12px', fontSize: 12, fontWeight: 500,
        cursor: 'pointer', borderRadius: 0, border: '1px solid var(--border2)',
        background: 'transparent', color: M, textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        {showDetail ? '▾ Hide full swing calendar & detail' : '▸ Show full swing calendar & detail'}
      </button>

      {/* SwingCalendarPanel stays mounted regardless of the toggle — it's the
          source of `cal`, which drives the verdict above. Only its visible
          container (and the A–D/Volume panels) are hidden when collapsed. */}
      <div style={{ display: showDetail ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>

      {/* ── Row 1: A–D panels — calendar data drives the numbers ─────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>

        {/* A. SWING QUALITY — symbol worthiness */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
          <PanelHeader>A. SWING QUALITY</PanelHeader>
          <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'center', minWidth: 60 }}>
              <div style={{ fontSize: 42, fontWeight: 500, color: scoreColor, lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{data.symbol_score}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: scoreColor }}>/5</div>
              <ScoreDots value={data.symbol_score} color={scoreColor} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: scoreColor, marginBottom: 4 }}>{data.symbol_interpretation}</div>
              {data.score_reasons.map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: M, lineHeight: 1.4 }}>· {r}</div>
              ))}
            </div>
          </div>
        </div>

        {/* B. SWING ENTRY — calendar entry ladder (canonical levels) */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
          <PanelHeader>B. SWING ENTRY</PanelHeader>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cal ? (<>
              <DataRow label="RECENT HIGH"
                value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${cal.price_bands.recent_high.toFixed(2)}</span>} />
              <DataRow label="CURRENT ZONE"
                value={<span style={{ color: A, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{cal.price_bands.current_zone.replace('_', ' ').toUpperCase()}</span>} />
              <DataRow label="PULLBACK"
                value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{cal.price_bands.current_pct_from_high.toFixed(1)}% from high</span>} />
              <Divider />
              {cal.price_bands.entry_ladder.map((row, i) => {
                const priceColor = row.zone === 'buy' ? 'var(--fd-accent)' : row.zone === 'strong_buy' ? G : row.zone === 'panic_buy' ? 'var(--as-lilac)' : A
                return (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '1fr auto auto',
                    alignItems: 'baseline', gap: '0 8px',
                    padding: '3px 0', borderBottom: '1px solid var(--fd-hairline)',
                  }}>
                    <span style={{ fontSize: 12, color: M }}>{row.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: priceColor,
                      fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                      ${row.price.toFixed(2)}
                    </span>
                    <span style={{ fontSize: 12, color: M, textAlign: 'right', minWidth: 28 }}>
                      {row.size_pct > 0 ? `${row.size_pct}%` : ''}
                    </span>
                  </div>
                )
              })}
            </>) : (<>
              <DataRow label="ENTRY PRICE"
                value={<span style={{ color: data.is_buyable ? 'var(--fd-accent)' : M, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  ${data.entry_price.toFixed(2)}{data.is_buyable ? ' ★' : ''}</span>} />
              <DataRow label="RECENT HIGH"
                value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${data.recent_high.toFixed(2)}</span>} />
              <DataRow label="PULLBACK"
                value={<span style={{ color: data.pullback_pct >= 3 ? G : M, fontFamily: 'var(--font-mono)' }}>{data.pullback_pct.toFixed(1)}% off high</span>} />
              <Divider />
              <DataRow label="VOL GATE"
                value={<span style={{
                  color: data.vol_entry_gate === 'closed' ? R : data.vol_entry_gate === 'strong' ? G : A,
                  fontFamily: 'var(--font-mono)', fontWeight: 500,
                }}>{data.vol_entry_gate === 'closed' ? '⊘ CLOSED' : data.vol_entry_gate === 'strong' ? '★ STRONG' : '✓ OPEN'}</span>} />
              <div style={{ fontSize: 12, color: M, marginTop: 4, fontStyle: 'italic' }}>Loading calendar levels…</div>
            </>)}
          </div>
        </div>

        {/* C. SWING EXIT — calendar expected edge + phase */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
          <PanelHeader>C. SWING EXIT</PanelHeader>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cal ? (<>
              <DataRow label="EXPECTED GAIN"
                value={<span style={{ color: G, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {cal.expected_edge.avg_gain_pct != null ? `+${cal.expected_edge.avg_gain_pct.toFixed(1)}%` : '—'}
                </span>} />
              <DataRow label="WIN RATE"
                value={<span style={{ color: cal.expected_edge.win_rate != null && cal.expected_edge.win_rate >= 60 ? G : A,
                  fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {cal.expected_edge.win_rate != null ? `${cal.expected_edge.win_rate.toFixed(0)}%` : '—'}
                  {cal.expected_edge.win_rate != null && cal.expected_edge.win_rate >= 80 && cal.expected_edge.sample < 25
                    ? <span style={{ fontSize: 12, color: A, marginLeft: 4 }}> small sample</span> : null}
                </span>} />
              <DataRow label="AVG HOLD"
                value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{cal.expected_edge.avg_hold}d</span>} />
              <DataRow label="SIGNALS"
                value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{cal.expected_edge.sample}</span>} />
              <Divider />
              <DataRow label="ENTRY WINDOW"
                value={<span style={{ color: A, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{cal.stat_entry_window}</span>} />
              <DataRow label="PROBABILITY"
                value={<span style={{ color: cal.pullback_probability >= 0.5 ? G : A, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {(cal.pullback_probability * 100).toFixed(0)}%
                </span>} />
            </>) : (<>
              <DataRow label="TAKE PROFIT"
                value={<span style={{ color: G, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {targetAchieved ? '✓ Achieved' : `$${data.take_profit.toFixed(2)}`}</span>} />
              <DataRow label="STOP LOSS"
                value={<span style={{ color: R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>${data.stop_loss.toFixed(2)}</span>} />
              <DataRow label="R:R RATIO"
                value={<span style={{ color: rrColor, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{data.rr_ratio.toFixed(1)}:1</span>} />
              <div style={{ fontSize: 12, color: M, marginTop: 4, fontStyle: 'italic' }}>Loading calendar levels…</div>
            </>)}
          </div>
        </div>

        {/* D. SWING VERDICT — calendar master action + confidence */}
        <div style={{ background: 'var(--surface)',
          border: `1px solid ${cal ? A : decisionColor}55`, borderRadius: 0, padding: '12px 14px' }}>
          <PanelHeader>D. SWING VERDICT</PanelHeader>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cal ? (<>
              <DataRow label="ACTION"
                value={<span style={{ color: A, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{cal.master_action}</span>} />
              <DataRow label="PHASE"
                value={<span style={{ color: cal.current_phase === 'rally' ? G : cal.current_phase === 'pullback' ? R : A,
                  fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {cal.current_phase.toUpperCase()} · day {cal.phase_day}
                </span>} />
              <Divider />
              <DataRow label="CONFIDENCE"
                value={<span style={{ color: cal.confidence.score >= 80 ? G : cal.confidence.score >= 60 ? A : R,
                  fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{cal.confidence.score} {cal.confidence.label}</span>} />
              <DataRow label="REGIME"
                value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{cal.macro_overlay.regime_label}</span>} />
              <DataRow label="BUY LEVELS"
                value={<span style={{ color: M, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  -{cal.macro_overlay.buy_drop_pct}% / -{cal.macro_overlay.strong_drop_pct}% / -{cal.macro_overlay.panic_drop_pct}%
                </span>} />
              <Divider />
              <div style={{ fontSize: 12, color: M, lineHeight: 1.6, marginTop: 2 }}>{cal.master_detail}</div>
            </>) : (<>
              <DataRow label="DECISION"
                value={<span style={{ color: decisionColor, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{data.final_decision}</span>} />
              <DataRow label="LCS"
                value={<span style={{ color: data.context_scores.LCS >= 70 ? G : data.context_scores.LCS >= 45 ? A : R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{data.context_scores.LCS}</span>} />
              <DataRow label="TCS"
                value={<span style={{ color: data.context_scores.TCS >= 70 ? G : data.context_scores.TCS >= 45 ? A : R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{data.context_scores.TCS}</span>} />
              <DataRow label="RCS"
                value={<span style={{ color: data.context_scores.RCS >= 70 ? G : data.context_scores.RCS >= 45 ? A : R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{data.context_scores.RCS}</span>} />
              <Divider />
              <DataRow label="VOL Δ SCORE"
                value={<span style={{
                  color: data.vol_confidence_delta > 0 ? G : data.vol_confidence_delta < 0 ? R : M,
                  fontFamily: 'var(--font-mono)', fontWeight: 500,
                }}>{data.vol_confidence_delta > 0 ? `+${data.vol_confidence_delta}` : `${data.vol_confidence_delta}`}</span>} />
              <div style={{ fontSize: 12, color: M, marginTop: 4, fontStyle: 'italic' }}>Loading calendar…</div>
            </>)}
          </div>
        </div>
      </div>

      {/* ── E. VOLUME SIGNAL panel ────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
        <PanelHeader>E. VOLUME SIGNAL</PanelHeader>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px 24px' }}>

          {/* Left col: primitives */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Primitives</div>
            <DataRow label="RVOL"
              value={<span style={{
                color: data.vol_ratio >= 2.0 ? R : data.vol_ratio >= 1.5 ? A : G,
                fontFamily: 'var(--font-mono)', fontWeight: 500,
              }}>{data.vol_ratio.toFixed(2)}× avg</span>} />
            <DataRow label="REGIME"
              value={<span style={{
                color: data.vol_regime === 'extreme' ? R : data.vol_regime === 'elevated' ? A : G,
                fontFamily: 'var(--font-mono)', fontWeight: 500, textTransform: 'uppercase',
              }}>{data.vol_regime}</span>} />
            <DataRow label="TREND"
              value={<span style={{
                color: data.vol_trend === 'up' ? A : data.vol_trend === 'down' ? G : M,
                fontFamily: 'var(--font-mono)', fontWeight: 500,
              }}>{data.vol_trend === 'up' ? '▲ rising' : data.vol_trend === 'down' ? '▼ falling' : '— flat'}</span>} />
            <DataRow label="SPIKE"
              value={<span style={{
                color: data.vol_spike ? R : G,
                fontFamily: 'var(--font-mono)', fontWeight: 500,
              }}>{data.vol_spike ? ' YES — exhaustion' : 'no'}</span>} />
          </div>

          {/* Right col: mechanical rule effects */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Rule Effects</div>
            <DataRow label="ENTRY GATE"
              value={<span style={{
                color: data.vol_entry_gate === 'closed' ? R : data.vol_entry_gate === 'strong' ? G : A,
                fontFamily: 'var(--font-mono)', fontWeight: 500, textTransform: 'uppercase',
              }}>{data.vol_entry_gate === 'closed' ? '⊘ CLOSED' : data.vol_entry_gate === 'strong' ? '★ STRONG' : '✓ OPEN'}</span>} />
            <DataRow label="EXIT URGENCY"
              value={<span style={{
                color: data.vol_exit_urgency === 'panic' ? R : data.vol_exit_urgency === 'high' ? A : G,
                fontFamily: 'var(--font-mono)', fontWeight: 500, textTransform: 'uppercase',
              }}>{data.vol_exit_urgency}</span>} />
            <DataRow label="CONFIDENCE Δ"
              value={<span style={{
                color: data.vol_confidence_delta > 0 ? G : data.vol_confidence_delta < 0 ? R : M,
                fontFamily: 'var(--font-mono)', fontWeight: 500,
              }}>{data.vol_confidence_delta > 0 ? `+${data.vol_confidence_delta}` : data.vol_confidence_delta}</span>} />
          </div>

          {/* Context: what this means */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
            <div style={{ height: '0.5px', background: 'var(--fd-card)', margin: '2px 0' }} />
            {data.vol_regime === 'extreme' && (
              <div style={{ fontSize: 12, color: R, lineHeight: 1.5 }}>
                 Extreme volume ({data.vol_ratio.toFixed(1)}×) — {data.vol_spike ? 'capitulation spike detected, potential reversal' : 'potential exhaustion or distribution'}. Exit urgency: {data.vol_exit_urgency.toUpperCase()}.
              </div>
            )}
            {data.vol_regime === 'elevated' && (
              <div style={{ fontSize: 12, color: A, lineHeight: 1.5 }}>
                Volume elevated ({data.vol_ratio.toFixed(1)}×) — valid breakout threshold requires RVOL ≥ 1.5. Entry gate: {data.vol_entry_gate}.
              </div>
            )}
            {data.vol_regime === 'normal' && data.vol_trend === 'down' && (
              <div style={{ fontSize: 12, color: G, lineHeight: 1.5 }}>
                Volume declining ({data.vol_ratio.toFixed(1)}×, trend down) — healthy pullback signature. Confidence +{Math.abs(data.vol_confidence_delta) || 0}.
              </div>
            )}
            {data.vol_regime === 'normal' && data.vol_trend !== 'down' && (
              <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
                Volume orderly ({data.vol_ratio.toFixed(1)}×) — no significant volume signal. Entry gate open.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Buying Calendar ────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
        <PanelHeader>BUYING CALENDAR</PanelHeader>
        <div style={{ fontSize: 12, color: M, margin: '6px 0 10px', lineHeight: 1.6 }}>
          Entry window forecast based on rally → pause → pullback cycle detection.
        </div>
        <SwingCalendarPanel symbol={symbol} portfolioSymbols={portfolioSymbols}
          regime={regime} vix={vix} onData={d => setCal(d as CalendarData)} />
      </div>

      </div>

    </div>
  )
}
