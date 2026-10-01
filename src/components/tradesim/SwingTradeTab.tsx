/**
 * SwingTradeTab — Swing Trade Research
 *
 * Pure analysis layer. Enter a symbol → get RSI, ATR, MA20/50, pullback,
 * setup score, entry/stop/target. Click "Place Order" → opens the standard
 * OrderModal pre-filled with the suggested limit price and swing signal panel
 * already open. One order flow, one execution engine.
 */

import { useState } from 'react'
import type { Portfolio } from './types'
import { G, R, A, M, B, BASE, GET } from './constants'
import { Btn, Input } from './shared'
import { fmtMoney } from '../../utils/formatters'
import { SwingCalendarPanel } from '../research/SwingCalendarPanel'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ContextScores { LCS: number; TCS: number; RCS: number }

export interface SwingAnalysis {
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
  vol_ratio:     number
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

// ── Helpers ────────────────────────────────────────────────────────────────────

const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' }
const PANEL: React.CSSProperties = {
  background: 'var(--panel)', borderRadius: 0,
  padding: '10px 12px', marginBottom: 8,
}

function SL({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
      letterSpacing: '0.6px', color: M, marginBottom: 6 }}>
      {children}
    </div>
  )
}

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

function CtxBar({ val, label }: { val: number; label: string }) {
  const color = val >= 70 ? G : val >= 45 ? A : R
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span style={{ width: 30, color: M, fontSize: 12 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: 'var(--fd-card)',
        borderRadius: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${val}%`, background: color, borderRadius: 0 }} />
      </div>
      <span style={{ width: 26, textAlign: 'right', ...MONO, color, fontSize: 12 }}>{val}</span>
    </div>
  )
}

// ── Mini candlestick chart ─────────────────────────────────────────────────────

function MiniChart({ bars, entry, stop, target, current }: {
  bars:    SwingAnalysis['bars']
  entry:   number; stop: number; target: number; current: number
}) {
  if (!bars || bars.length === 0) return null

  const n        = Math.min(bars.length, 60)
  const allClose = bars.map(b => b.c)
  const slice    = bars.slice(bars.length - n)
  const startIdx = bars.length - n
  const H = 130, W = 520

  const rollingMA = (period: number) =>
    allClose.map((_, i) =>
      i < period - 1 ? null
        : allClose.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period
    )
  const ma20 = rollingMA(20).slice(startIdx)
  const ma50 = rollingMA(50).slice(startIdx)

  const extras = [entry, stop, target, current]
  const lo    = Math.min(...slice.map(b => b.l), ...extras)
  const hi    = Math.max(...slice.map(b => b.h), ...extras)
  const rng   = hi - lo || 1
  const bw    = Math.max(1, (W / n) - 1)
  const toY   = (p: number) => H - ((p - lo) / rng) * H
  const maPoints = (series: (number | null)[]) =>
    series.map((v, i) => v == null ? null : `${(i + 0.5) * (W / n)},${toY(v)}`)
      .filter(Boolean).join(' ')

  const HLine = ({ price, color, label, dash = '3,3', bold = false }: {
    price: number; color: string; label: string; dash?: string; bold?: boolean
  }) => {
    const y = toY(price)
    return (
      <g>
        <line x1={0} y1={y} x2={W} y2={y} stroke={color}
          strokeWidth={bold ? 1.5 : 1} strokeDasharray={dash} strokeOpacity={0.8} />
        <text x={W - 3} y={y - 2} fill={color} fontSize={7}
          textAnchor="end" fontWeight={bold ? 700 : 400}>
          {label} ${price.toFixed(2)}
        </text>
      </g>
    )
  }

  return (
    <div style={{ overflowX: 'auto', marginTop: 6 }}>
      <svg width={W} height={H + 2} style={{ display: 'block' }}>
        <rect width={W} height={H} fill="var(--fd-page)" rx={4} />
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={0} y1={H * f} x2={W} y2={H * f}
            stroke="var(--fd-hairline)" strokeWidth={0.5} />
        ))}
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
        {maPoints(ma20) && (
          <polyline points={maPoints(ma20)} fill="none"
            stroke="var(--fd-ink)" strokeWidth={1.2} strokeOpacity={0.8}
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {maPoints(ma50) && (
          <polyline points={maPoints(ma50)} fill="none"
            stroke="var(--fd-negative)" strokeWidth={1.2} strokeOpacity={0.8}
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        <HLine price={target}  color="var(--fd-accent)" label=" Target" bold />
        <HLine price={current} color="var(--fd-ink)" label="◆ Now" dash="2,2" />
        <HLine price={entry}   color="var(--fd-accent)" label="⬇ Entry" bold />
        <HLine price={stop}    color="var(--fd-negative)" label=" Stop" />
      </svg>
      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--fd-muted)',
        display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span><span style={{ color: 'var(--fd-accent)' }}>━</span> Target</span>
        <span><span style={{ color: 'var(--fd-ink)' }}>╌</span> Current</span>
        <span><span style={{ color: 'var(--fd-accent)' }}>━</span> Suggested entry</span>
        <span><span style={{ color: 'var(--fd-negative)' }}>━</span> Stop-loss</span>
      </div>
    </div>
  )
}

// ── Timeframes ─────────────────────────────────────────────────────────────────

const TIMEFRAMES = [
  { id: '1d',  label: 'Daily',   note: '← best for swings' },
  { id: '1h',  label: '1 hr',   note: 'intraday'           },
  { id: '30m', label: '30 min', note: ''                    },
  { id: '15m', label: '15 min', note: ''                    },
  { id: '5m',  label: '5 min',  note: 'scalp only'         },
]

// ── Main component ─────────────────────────────────────────────────────────────

export function SwingTradeTab({ port, regime = 'CONSOLIDATION', vix = 0, onOpenOrderModal }: {
  port?:            Portfolio
  regime?:          string
  vix?:             number
  onOpenOrderModal: (
    symbol: string, limitPrice: number, showSwing: boolean,
    action?: 'BUY' | 'SELL',
    sharesHeld?: number,
  ) => void
}) {
  const [symbol,    setSymbol]    = useState('')
  const [timeframe, setTimeframe] = useState('1d')
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState<SwingAnalysis | null>(null)
  const [err,       setErr]       = useState('')

  const analyze = async () => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    setLoading(true); setErr(''); setResult(null)
    try {
      const data = await GET<SwingAnalysis>(`${BASE}/swing/${sym}?interval=${timeframe}`)
      if (data.error) { setErr(data.error); return }
      setResult(data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }

  // Look up current holding for the analyzed symbol
  const holding = result
    ? (port?.holdings ?? []).find(h => h.symbol === result.symbol)
    : undefined

  const scoreColor    = result ? (result.symbol_score >= 4 ? G : result.symbol_score >= 3 ? A : R) : M
  const signalColor   = result ? (result.entry_signal >= 1 ? G : result.signal_text?.includes('WATCH') ? A : R) : M
  const trendColor    = result ? (result.trend === 'uptrend' ? G : result.trend === 'downtrend' ? R : A) : M
  const rsiColor      = result ? (result.rsi < 30 ? A : result.rsi > 70 ? R : result.rsi <= 55 ? G : A) : M
  const chgColor      = result ? (result.change_pct >= 0 ? G : R) : M
  const decisionColor = result ? (result.is_buyable ? G : result.setup_score >= 45 ? A : R) : M

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '12px 16px',
      maxWidth: 860, margin: '0 auto' }}>

        {/* Search + timeframe */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
          marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <div style={{ width: 88 }}>
              <Input label="Symbol" value={symbol}
                onChange={v => setSymbol(v.toUpperCase())} placeholder="AAPL"
                onKeyDown={e => { if (e.key === 'Enter') analyze() }} />
            </div>
            <Btn variant="blue" onClick={analyze} disabled={loading || !symbol.trim()}>
              {loading ? '⟳' : ' Analyze'}
            </Btn>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
              letterSpacing: '0.5px', color: M, marginBottom: 4 }}>
              Timeframe (bar size)
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {TIMEFRAMES.map(tf => (
                <div key={tf.id} style={{ textAlign: 'center' }}>
                  <button onClick={() => setTimeframe(tf.id)} style={{
                    padding: '3px 9px', fontSize: 12, cursor: 'pointer', borderRadius: 0,
                    border: `1px solid ${timeframe === tf.id ? B : 'var(--border2)'}`,
                    background: timeframe === tf.id ? `${B}22` : 'transparent',
                    color: timeframe === tf.id ? 'var(--fd-accent)' : M,
                    fontWeight: timeframe === tf.id ? 700 : 400, display: 'block',
                  }}>
                    {tf.label}
                  </button>
                  {tf.note && (
                    <div style={{ fontSize: 12, color: 'var(--fd-muted)', marginTop: 1 }}>{tf.note}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {err && (
          <div style={{ padding: '8px 12px', background: `${R}15`, borderRadius: 0,
            border: `1px solid ${R}`, color: R, fontSize: 12, marginBottom: 10 }}>
             {err}
          </div>
        )}

        {loading && (
          <div style={{ padding: 28, textAlign: 'center', color: M, fontSize: 12 }}>
            Fetching {symbol} data…
          </div>
        )}

        {!loading && !result && !err && (
          <div style={{ padding: 36, textAlign: 'center', color: M,
            fontSize: 12, lineHeight: 2 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}></div>
            <strong>Swing Trade Analyzer</strong><br />
            Enter a symbol → Analyze → click <strong>Place Order</strong><br />
            The order modal opens with your entry price pre-filled<br />
            and the <span style={{ color: 'var(--fd-accent)' }}> Swing Signal</span> panel already open.<br />
            <span style={{ fontSize: 12, color: 'var(--fd-muted)' }}>
              Same limit order engine as Holdings and Watchlist.
            </span>
          </div>
        )}

        {result && !loading && (
          <>
            {/* Price header */}
            <div style={{ ...PANEL, display: 'flex', alignItems: 'center',
              gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 500, ...MONO }}>{result.symbol}</div>
                <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                  {result.timeframe} bars · {result.bar_count} candles
                </div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 21, fontWeight: 500, ...MONO }}>
                  ${result.price.toFixed(2)}
                </div>
                <div style={{ fontSize: 12, ...MONO, color: chgColor }}>
                  {result.change_pct >= 0 ? '+' : ''}{result.change_pct.toFixed(2)}%
                  <span style={{ color: M, marginLeft: 6, fontSize: 12 }}>
                    prev ${result.prev_close.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Position & cash context ──────────────────────────────────── */}
            <div style={{ ...PANEL, display: 'grid',
              gridTemplateColumns: holding ? '1fr 1fr' : '1fr', gap: 8 }}>

              {/* Cash available */}
              <div style={{ padding: '8px 10px',
                background: 'var(--fd-card)',
                border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
                  letterSpacing: '0.5px', marginBottom: 3 }}>Cash Available</div>
                <div style={{ fontSize: 14, fontWeight: 500,
                  fontFamily: 'var(--font-mono)', color: 'var(--fd-accent)' }}>
                  {port ? fmtMoney(port.current_cash) : '—'}
                </div>
                {result && port && port.current_cash > 0 && (
                  <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                    ≈ {Math.floor(port.current_cash / result.entry_price).toLocaleString()} sh
                    @ entry ${result.entry_price.toFixed(2)}
                  </div>
                )}
              </div>

              {/* Current holding (only if you own the symbol) */}
              {holding && (
                <div style={{ padding: '8px 10px',
                  background: holding.unrealized_pnl >= 0
                    ? 'var(--fd-card)' : 'var(--fd-card)',
                  border: `1px solid ${holding.unrealized_pnl >= 0
                    ? 'var(--fd-card)' : 'var(--fd-card)'}`,
                  borderRadius: 0 }}>
                  <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
                    letterSpacing: '0.5px', marginBottom: 3 }}>
                    You Hold — {holding.symbol}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500,
                    fontFamily: 'var(--font-mono)' }}>
                    {holding.total_shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
                  </div>
                  <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                    Avg cost ${holding.average_cost.toFixed(2)} ·{' '}
                    {fmtMoney(holding.market_value)}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 1,
                    color: holding.unrealized_pnl >= 0 ? G : R, fontWeight: 500 }}>
                    {holding.unrealized_pnl >= 0 ? '+' : ''}
                    {fmtMoney(holding.unrealized_pnl)}
                    {' '}({holding.unrealized_pnl_pct >= 0 ? '+' : ''}
                    {holding.unrealized_pnl_pct.toFixed(2)}%)
                  </div>
                </div>
              )}
            </div>

            {/* Symbol score */}
            <div style={PANEL}>
              <SL>Symbol Worthiness</SL>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <ScoreDots value={result.symbol_score} color={scoreColor} />
                <span style={{ fontSize: 12, fontWeight: 500, color: scoreColor }}>
                  {result.symbol_score}/5 — {result.symbol_interpretation}
                </span>
              </div>
              {result.score_reasons.map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: M }}>{r}</div>
              ))}
            </div>

            {/* Entry signal */}
            <div style={{ ...PANEL, borderLeft: `3px solid ${signalColor}` }}>
              <SL>Entry Signal</SL>
              <div style={{ fontSize: 13, fontWeight: 500,
                color: signalColor, marginBottom: 3 }}>
                {result.signal_icon} {result.signal_text}
              </div>
              <div style={{ fontSize: 12, color: 'var(--fd-muted)', marginBottom: 6 }}>
                {result.signal_type}
              </div>
              <div style={{ display: 'flex', gap: 20 }}>
                <div>
                  {result.entry_conditions_met.map((c, i) => (
                    <div key={i} style={{ fontSize: 12, color: G }}> {c}</div>
                  ))}
                </div>
                {result.entry_conditions_missing.length > 0 && (
                  <div>
                    {result.entry_conditions_missing.map((c, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--fd-muted)' }}> {c}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Suggested levels */}
            <div style={PANEL}>
              <SL>Engine Suggestions — Score {result.setup_score}/100</SL>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
                gap: 6, marginBottom: 8 }}>
                {[
                  { label: '⬇ Entry',   price: result.entry_price, color: 'var(--fd-accent)' },
                  { label: ' Stop',   price: result.stop_loss,   color: R         },
                  { label: ' Target', price: result.take_profit, color: G         },
                ].map(({ label, price, color }) => (
                  <div key={label} style={{
                    background: `${color}15`, border: `1px solid ${color}`,
                    borderRadius: 0, padding: '7px 10px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 12, color: M, marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color, ...MONO }}>
                      ${price.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                <span style={{ color: M }}>Risk/share <strong style={{ color: R }}>
                  ${(result.entry_price - result.stop_loss).toFixed(2)}
                </strong></span>
                <span style={{ color: M }}>Reward/share <strong style={{ color: G }}>
                  ${(result.take_profit - result.entry_price).toFixed(2)}
                </strong></span>
                <span style={{ color: M }}>R:R <strong style={{ color: A }}>
                  {result.rr_ratio.toFixed(1)}:1
                </strong></span>
              </div>
            </div>

            {/* ── THE ACTION: opens the standard OrderModal ───────────────── */}
            <div style={{ ...PANEL, border: `1px solid ${B}`,
              background: 'var(--fd-card)' }}>
              <SL>Place Order</SL>
              <div style={{ fontSize: 12, color: M, marginBottom: 10, lineHeight: 1.7 }}>
                Opens the standard order modal with the price pre-filled and the{' '}
                <strong style={{ color: 'var(--fd-accent)' }}> Swing Signal</strong> panel expanded.
                Adjust shares, GTC/Day, and confirm. Same engine as every other order.
              </div>

              {/* BUY row */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: G,
                  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>
                  BUY — enter a position
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Btn variant="green"
                    onClick={() => onOpenOrderModal(result.symbol, result.entry_price, true, 'BUY')}>
                    ⬇ BUY @ suggested entry ${result.entry_price.toFixed(2)}
                  </Btn>
                  <Btn variant="default"
                    onClick={() => onOpenOrderModal(result.symbol, result.price, true, 'BUY')}>
                    BUY @ current ${result.price.toFixed(2)}
                  </Btn>
                </div>
              </div>

              {/* SELL row */}
              <div style={{ paddingTop: 8, borderTop: '1px solid var(--border2)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline',
                  gap: 8, marginBottom: 5 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: R,
                    textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    SELL — exit or take profit
                  </div>
                  {holding ? (
                    <div style={{ fontSize: 12, color: M }}>
                      {holding.total_shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares available
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--fd-muted)' }}>
                      No position held
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Btn variant="red" disabled={!holding}
                    onClick={() => onOpenOrderModal(
                      result.symbol, result.take_profit, true, 'SELL',
                      holding?.total_shares ?? 0)}>
                     SELL @ target ${result.take_profit.toFixed(2)}
                  </Btn>
                  <Btn variant="red" disabled={!holding}
                    onClick={() => onOpenOrderModal(
                      result.symbol, result.stop_loss, true, 'SELL',
                      holding?.total_shares ?? 0)}>
                     SELL @ stop ${result.stop_loss.toFixed(2)}
                  </Btn>
                  <Btn variant="default" disabled={!holding}
                    onClick={() => onOpenOrderModal(
                      result.symbol, result.price, true, 'SELL',
                      holding?.total_shares ?? 0)}>
                    SELL @ current ${result.price.toFixed(2)}
                  </Btn>
                </div>
                {!holding && (
                  <div style={{ fontSize: 12, color: 'var(--fd-muted)', marginTop: 5, fontStyle: 'italic' }}>
                    Buy the position first — SELL buttons activate once you hold shares.
                  </div>
                )}
              </div>
            </div>

            {/* Indicators + context */}
            <div style={{ ...PANEL, display: 'grid',
              gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <SL>Indicators</SL>
                {[
                  { label: 'RSI(14)',   val: `${result.rsi.toFixed(1)}`,           color: rsiColor   },
                  { label: 'Pullback',  val: `${result.pullback_pct.toFixed(1)}%`, color: result.pullback_pct >= 1 ? G : M },
                  { label: 'Vol Ratio', val: `${result.vol_ratio.toFixed(1)}x`,    color: result.vol_ratio > 2 ? R : result.vol_ratio > 1 ? A : G },
                  { label: 'Trend',     val: result.trend.replace('_', ' '),       color: trendColor },
                  ...(result.ma20 ? [{ label: 'MA20', val: `$${result.ma20.toFixed(2)}`, color: 'var(--fd-muted)' as string }] : []),
                  ...(result.ma50 ? [{ label: 'MA50', val: `$${result.ma50.toFixed(2)}`, color: 'var(--fd-muted)' as string }] : []),
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ display: 'flex',
                    justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: M }}>{label}</span>
                    <span style={{ ...MONO, color, fontWeight: 500 }}>{val}</span>
                  </div>
                ))}
              </div>
              <div>
                <SL>Context Scores</SL>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <CtxBar val={result.context_scores.LCS} label="LCS" />
                  <CtxBar val={result.context_scores.TCS} label="TCS" />
                  <CtxBar val={result.context_scores.RCS} label="RCS" />
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fd-muted)', lineHeight: 1.6 }}>
                  LCS = Liquidity Confidence<br />
                  TCS = Trend Confirmation<br />
                  RCS = Risk Compression
                </div>
              </div>
            </div>

            {/* Verdict */}
            <div style={{ ...PANEL, borderLeft: `3px solid ${decisionColor}` }}>
              <div style={{ fontSize: 12, fontWeight: 500,
                color: decisionColor, marginBottom: 5 }}>
                {result.final_decision}
              </div>
              <div style={{ fontSize: 12, color: 'var(--fd-muted)', lineHeight: 1.6 }}>
                {result.recommendation}
              </div>
            </div>

            {/* Chart */}
            {result.bars.length > 0 && (
              <div style={PANEL}>
                <SL>
                  Candlestick — {Math.min(result.bars.length, 60)} {result.timeframe} bars
                </SL>
                <MiniChart
                  bars={result.bars}
                  entry={result.entry_price}
                  stop={result.stop_loss}
                  target={result.take_profit}
                  current={result.price}
                />
              </div>
            )}

            {/* ── Buying Calendar ─────────────────────────────────────────── */}
            <div style={{ ...PANEL, border: `1px solid ${A}` }}>
              <SL> Buying Calendar</SL>
              <div style={{ fontSize: 12, color: M, marginBottom: 8, lineHeight: 1.6 }}>
                Detects rally → pause → pullback cycles and projects the
                highest-probability entry windows. Click Generate to run.
              </div>
              <SwingCalendarPanel
                symbol={result.symbol}
                regime={regime}
                vix={vix}
                portfolioSymbols={[
                  ...(port?.holdings  ?? []).map(h => h.symbol),
                  ...(port?.watchlist ?? []).map(w => w.symbol),
                ].filter((v, i, a) => a.indexOf(v) === i)}
              />
            </div>
          </>
        )}
    </div>
  )
}
