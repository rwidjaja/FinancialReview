/**
 * SwingCalendarPanel — Swing Trade Calendar, Entry Ladder & Opportunity Ranking
 *
 * Sections:
 *   1. Engine Summary Card  — single-glance action + levels
 *   2. Phase + Trend Age    — where in the cycle + how old + EXTENDED warning
 *   3. Calendar Confidence  — how much to trust the projections
 *   4. Weekly Calendar      — projected windows with probability
 *   5. Entry Ladder         — % from high tiers (Watch/Buy/Strong/Panic)
 *   6. Scenario Matrix      — date × price → action
 *   7. Opportunity Ranking  — best deployment of cash vs other portfolio symbols
 */

import { useState, useEffect } from 'react'
import { InfoTooltip } from './InfoTooltip'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CyclePhaseStats { count: number; median: number; mean: number; min: number; max: number }

interface TrendAge {
  trend_age_days: number; rally_median: number; rally_max: number
  ratio: number; status: string; status_color: string
}

interface Confidence {
  score: number; label: string; meaning: string; reasons: string[]
}

interface CalendarWeek {
  window: string; behavior: string; prob: number; action: string
  phase: 'rally' | 'pause' | 'pullback'
}

interface EntryLadderRow {
  label: string; price: number; drop_pct: number; desc: string
  size_pct: number; action: string; zone: string
}

interface ScenarioRow { condition: string; price_desc: string; action: string; zone: string }

interface PhaseMeta {
  description: string; next_event: string
  action_hint: string; expected_duration: string
}

interface MacroOverlay {
  regime: string; regime_label: string
  vix: number | null; vix_label: string
  buy_drop_pct: number; strong_drop_pct: number; panic_drop_pct: number
}

interface ExpectedEdge {
  win_rate: number | null; avg_gain_pct: number | null
  avg_loss_pct: number | null; expected_value: number | null
  avg_hold: number; sample: number
}

interface CalendarResult {
  symbol:                string
  current_price:         number
  current_phase:         string
  phase_day:             number
  phase_pct:             number
  ma20:                  number | null
  ma50:                  number | null
  cycle_stats:           { rally: CyclePhaseStats; pause: CyclePhaseStats; pullback: CyclePhaseStats; cycles_analyzed: number }
  trend_age:             TrendAge
  confidence:            Confidence
  stat_entry_window:     string
  pullback_probability:  number
  master_action:         string
  master_detail:         string
  phase_meta:            PhaseMeta
  macro_overlay:         MacroOverlay
  expected_edge:         ExpectedEdge
  price_bands: {
    extended_above: number; recent_high: number
    ladder_anchor?: number; ladder_anchor_label?: 'high' | 'ma50' | 'blend'
    support1: number; support2: number; current: number
    current_zone: string; current_pct_from_high: number
    entry_ladder: EntryLadderRow[]
    scenario_matrix: ScenarioRow[]
  }
  calendar:             CalendarWeek[]
  lookback_days:        number
  swing_points_found:   number
  error?: string
}

interface RankRow {
  symbol: string; setup_score: number; signal_text: string; signal_icon: string
  is_buyable: boolean; trend: string; rsi: number; price: number; entry_price: number
}

// ── Palette ────────────────────────────────────────────────────────────────────
const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

// ── Helpers ────────────────────────────────────────────────────────────────────

function phaseColor(phase: string) {
  return phase === 'rally' ? G : phase === 'pullback' ? R : A
}

function zoneColor(zone: string) {
  if (zone === 'extended' || zone === 'no_buy') return R
  if (zone === 'watch')      return A
  if (zone === 'buy')        return 'var(--fd-accent)'
  if (zone === 'strong_buy') return G
  if (zone === 'panic_buy')  return 'var(--as-lilac)'
  return M
}

function actionColor(action: string) {
  if (action.includes('DISABLED') || action === 'WAIT') return R
  if (action === 'WATCH') return A
  if (action === 'BUY')   return 'var(--fd-accent)'
  if (action === 'STRONG BUY') return G
  if (action === 'PANIC BUY')  return 'var(--as-lilac)'
  return M
}

function ProbBar({ p }: { p: number }) {
  const pct   = Math.round(p * 100)
  const color = p >= 0.6 ? G : p >= 0.4 ? A : R
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 56, height: 4, background: 'var(--fd-card)',
        borderRadius: 0, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${pct}%`, background: color, borderRadius: 0 }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 500, ...MONO }}>{pct}%</span>
    </div>
  )
}

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 22, stroke = 4
  const circ = 2 * Math.PI * r
  const pct  = score / 100
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={54} height={54} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={27} cy={27} r={r} fill="none"
          stroke="var(--fd-hairline)" strokeWidth={stroke} />
        <circle cx={27} cy={27} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" />
        <text x={27} y={27} textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize={11} fontWeight={700}
          style={{ transform: 'rotate(90deg)', transformOrigin: '27px 27px' }}>
          {score}
        </text>
      </svg>
      <span style={{ fontSize: 12, color, fontWeight: 500 }}>{label}</span>
    </div>
  )
}

function TH({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{ padding: '4px 10px', textAlign: right ? 'right' : 'left',
      fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
      letterSpacing: '0.5px', borderBottom: '1px solid var(--border2)',
      background: 'var(--fd-card)', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  )
}
function TD({ children, right, color }: { children: React.ReactNode; right?: boolean; color?: string }) {
  return (
    <td style={{ padding: '6px 10px', fontSize: 12, textAlign: right ? 'right' : 'left',
      color: color ?? 'var(--text)', borderBottom: '1px solid var(--fd-hairline)' }}>
      {children}
    </td>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SwingCalendarPanel({
  symbol, portfolioSymbols = [], regime = 'CONSOLIDATION', vix = 0, onData,
}: {
  symbol:            string
  portfolioSymbols?: string[]
  regime?:           string
  vix?:              number
  onData?:           (d: CalendarResult) => void
}) {
  const [data,    setData]    = useState<CalendarResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')
  const [weeks,   setWeeks]   = useState(6)

  const [ranking,     setRanking]     = useState<RankRow[] | null>(null)
  const [rankLoading, setRankLoading] = useState(false)

  const fetchCalendar = async (w = weeks) => {
    if (!symbol) return
    setLoading(true); setErr(''); setData(null)
    try {
      const res = await fetch(`/api/sim/swing/${symbol.toUpperCase()}/calendar?weeks=${w}&regime=${encodeURIComponent(regime)}&vix=${vix}`)
      const d: CalendarResult = await res.json()
      if (d.error) { setErr(d.error); return }
      setData(d)
      onData?.(d)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Fetch failed')
    } finally { setLoading(false) }
  }

  // Auto-fetch on mount and when symbol changes — default 6 weeks
  useEffect(() => {
    if (symbol) fetchCalendar(6)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

  const fetchRanking = async () => {
    const syms = portfolioSymbols.length > 0
      ? portfolioSymbols
      : [symbol]
    if (syms.length < 2) return
    setRankLoading(true)
    try {
      const res  = await fetch('/api/sim/swing/rank', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: syms }),
      })
      const rows: RankRow[] = await res.json()
      setRanking(rows)
    } catch { /* ignore */ }
    finally { setRankLoading(false) }
  }

  const confColor = !data ? M
    : data.confidence.score >= 80 ? G
    : data.confidence.score >= 60 ? A : R

  const trendStatusColor = !data ? M
    : data.trend_age.status_color === 'green' ? G
    : data.trend_age.status_color === 'amber' ? A : R

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Controls ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: M }}>Horizon</span>
          {[4, 6, 8].map(w => (
            <button key={w} onClick={() => { setWeeks(w); fetchCalendar(w) }} style={{
              padding: '2px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 0,
              border: `1px solid ${weeks === w ? A : 'var(--border2)'}`,
              background: weeks === w ? `${A}18` : 'transparent',
              color: weeks === w ? A : M, fontWeight: weeks === w ? 700 : 400,
            }}>{w}w</button>
          ))}
        </div>
        <button onClick={() => fetchCalendar()} disabled={loading || !symbol} style={{
          padding: '4px 16px', cursor: 'pointer', borderRadius: 0,
          border: `1px solid ${A}60`, background: `${A}18`, color: A,
          fontSize: 12, fontWeight: 500, opacity: loading || !symbol ? 0.5 : 1,
        }}>
          {loading ? '⟳ Analyzing…' : ' Generate Calendar'}
        </button>
        {data && (
          <span style={{ fontSize: 12, color: 'var(--fd-muted)', marginLeft: 'auto' }}>
            {data.lookback_days}d · {data.swing_points_found} swing points
          </span>
        )}
      </div>

      {err && (
        <div style={{ fontSize: 12, color: R, padding: '6px 10px',
          background: `${R}15`, borderRadius: 0 }}> {err}</div>
      )}

      {data && (
        <>
          {/* ── 1. ENGINE SUMMARY CARD ─────────────────────────────────────── */}
          <div style={{
            background: 'var(--surface)',
            border: `1px solid ${actionColor(data.master_action)}40`,
            borderLeft: `4px solid ${actionColor(data.master_action)}`,
            borderRadius: 0, padding: '14px 16px',
          }}>
            <div style={{ fontSize: 12, color: A, fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
               Swing Engine — {data.symbol}
            </div>
            <div style={{ display: 'grid',
              gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'start' }}>

              {/* Action + detail */}
              <div>
                <div style={{ fontSize: 18, fontWeight: 500,
                  color: actionColor(data.master_action), letterSpacing: 1 }}>
                  {data.master_action}
                </div>
                <div style={{ fontSize: 12, color: M, marginTop: 3, lineHeight: 1.5 }}>
                  {data.master_detail}
                </div>
              </div>

              {/* Buy levels */}
              <div>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
                  letterSpacing: '0.5px', marginBottom: 6 }}>Buy Levels</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {data.price_bands.entry_ladder.filter(e => e.size_pct > 0).map(e => (
                    <div key={e.zone} style={{
                      padding: '4px 10px', borderRadius: 0,
                      background: `${zoneColor(e.zone)}15`,
                      border: `1px solid ${zoneColor(e.zone)}40`,
                    }}>
                      <div style={{ fontSize: 12, color: M }}>{e.action} {e.desc}</div>
                      <div style={{ fontSize: 13, fontWeight: 500,
                        color: zoneColor(e.zone), ...MONO }}>
                        ${e.price.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 12, color: M }}>{e.size_pct}% position</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Meta: phase + window + confidence */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: M, marginBottom: 4 }}>Phase</div>
                  <div style={{ fontSize: 12, fontWeight: 500,
                    color: phaseColor(data.current_phase),
                    textTransform: 'uppercase' }}>
                    {data.current_phase}
                  </div>
                  <div style={{ fontSize: 12, color: M }}>day {data.phase_day}</div>
                  <div style={{ marginTop: 4, fontSize: 12, fontWeight: 500,
                    color: trendStatusColor,
                    padding: '1px 6px', borderRadius: 0,
                    background: `${trendStatusColor}18`,
                    border: `1px solid ${trendStatusColor}40` }}>
                    {data.trend_age.status}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: M, marginBottom: 4 }}>Entry Window</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: G }}>
                    {data.stat_entry_window}
                  </div>
                  <ProbBar p={data.pullback_probability} />
                </div>
                <ScoreRing
                  score={data.confidence.score}
                  label="Confidence"
                  color={confColor}
                />
              </div>
            </div>
          </div>

          {/* ── 1b. Opportunity ranking — right after summary ─────────────────── */}
          {portfolioSymbols.length >= 2 && portfolioSymbols.includes(symbol.toUpperCase()) && (
            <div style={{ background: 'var(--surface)',
              border: `1px solid ${A}30`,
              borderLeft: `3px solid ${A}`,
              borderRadius: 0, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: A, fontWeight: 500,
                  textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                   Best Deployment of Cash
                </div>
                <div style={{ fontSize: 12, color: M }}>
                  — where should the next dollar go among your {portfolioSymbols.length} holdings?
                </div>
                <button onClick={fetchRanking} disabled={rankLoading} style={{
                  marginLeft: 'auto', padding: '3px 12px', fontSize: 12,
                  cursor: 'pointer', borderRadius: 0, fontWeight: 500,
                  border: `1px solid ${A}50`, background: `${A}12`, color: A,
                  opacity: rankLoading ? 0.5 : 1,
                }}>
                  {rankLoading ? '⟳ Scoring…' : '↻ Rank All'}
                </button>
              </div>
              {!ranking && !rankLoading && (
                <div style={{ fontSize: 12, color: M }}>
                  Click <strong>↻ Rank All</strong> to score all {portfolioSymbols.length} symbols
                  and find the highest-probability swing entry right now.
                </div>
              )}
              {ranking && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>#</TH><TH>Symbol</TH><TH>Score</TH>
                      <TH>Signal</TH><TH>Trend</TH>
                      <TH right>RSI</TH><TH right>Price</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((row, i) => {
                      const isActive   = row.symbol === symbol.toUpperCase()
                      const scoreColor = row.setup_score >= 60 ? G
                        : row.setup_score >= 40 ? A : R
                      return (
                        <tr key={row.symbol} style={{
                          background: isActive ? 'var(--fd-card)' : 'transparent',
                        }}>
                          <TD color={M}>{i + 1}</TD>
                          <TD>
                            <span style={{ fontWeight: 500,
                              color: isActive ? A : 'var(--text)' }}>
                              {row.symbol}
                              {isActive && <span style={{ marginLeft: 4,
                                fontSize: 12, color: A }}>← current</span>}
                            </span>
                          </TD>
                          <TD>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 40, height: 4,
                                background: 'var(--fd-card)', borderRadius: 0,
                                position: 'relative', overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', left: 0, top: 0,
                                  height: '100%', width: `${row.setup_score}%`,
                                  background: scoreColor, borderRadius: 0 }} />
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 500,
                                color: scoreColor, ...MONO }}>{row.setup_score}</span>
                            </div>
                          </TD>
                          <TD color={row.is_buyable ? G : M}>
                            {row.signal_icon} {row.signal_text}
                          </TD>
                          <TD color={row.trend === 'uptrend' ? G
                            : row.trend === 'downtrend' ? R : A}>
                            {row.trend.replace('_', ' ')}
                          </TD>
                          <TD right color={row.rsi < 30 ? A : row.rsi > 70 ? R : G}>
                            {row.rsi.toFixed(0)}
                          </TD>
                          <TD right>
                            <span style={{ ...MONO }}>${row.price.toFixed(2)}</span>
                          </TD>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── 2. Context row: Phase / Trend Age / Confidence / Edge ──────── */}
          <div style={{ display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>

            {/* Phase card — with next event */}
            <div style={{ background: 'var(--surface)',
              border: `1px solid ${phaseColor(data.current_phase)}55`,
              borderLeft: `3px solid ${phaseColor(data.current_phase)}`,
              borderRadius: 0, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: A, fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Current Phase
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, textTransform: 'uppercase',
                color: phaseColor(data.current_phase) }}>
                {data.current_phase}
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                {data.phase_meta.description}
              </div>
              <div style={{ marginTop: 8, paddingTop: 6,
                borderTop: '1px solid var(--fd-hairline)' }}>
                <div style={{ fontSize: 12, color: 'var(--fd-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  Expected duration
                </div>
                <div style={{ fontSize: 12, color: M, marginTop: 1 }}>
                  {data.phase_meta.expected_duration}
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--fd-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  Next likely event
                </div>
                <div style={{ fontSize: 12, color: G, fontWeight: 500, marginTop: 1 }}>
                  → {data.phase_meta.next_event}
                </div>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: A, fontStyle: 'italic' }}>
                {data.phase_meta.action_hint}
              </div>
            </div>

            {/* Trend Age — visual progress bar */}
            <div style={{ background: 'var(--surface)',
              border: `1px solid ${trendStatusColor}55`,
              borderLeft: `3px solid ${trendStatusColor}`,
              borderRadius: 0, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: A, fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Trend Age<InfoTooltip term="trend_age" inline />
              </div>
              {/* Segmented progress bar */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', height: 12, borderRadius: 0,
                  overflow: 'hidden', background: 'var(--fd-card)',
                  border: '1px solid var(--fd-hairline)' }}>
                  <div style={{
                    width: `${Math.min(100, data.trend_age.ratio * 100)}%`,
                    background: trendStatusColor,
                    transition: 'width 0.5s',
                    minWidth: 2,
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  marginTop: 3, fontSize: 12, color: 'var(--fd-muted)' }}>
                  <span>0</span>
                  <span>{data.trend_age.rally_median}d median</span>
                  <span>{data.trend_age.rally_max}d max</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 500,
                  color: trendStatusColor, ...MONO }}>
                  {data.trend_age.trend_age_days}d
                </span>
                <span style={{ fontSize: 12, color: M }}>
                  / {data.trend_age.rally_median}d
                </span>
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                {Math.round(data.trend_age.ratio * 100)}% mature
              </div>
              <div style={{ marginTop: 6, display: 'inline-block',
                fontSize: 12, fontWeight: 500, color: trendStatusColor,
                padding: '2px 8px', borderRadius: 0,
                background: `${trendStatusColor}18`,
                border: `1px solid ${trendStatusColor}40` }}>
                {data.trend_age.status}
              </div>
            </div>

            {/* Confidence + cycle count */}
            <div style={{ background: 'var(--surface)',
              border: '1px solid var(--fd-hairline)',
              borderRadius: 0, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: A, fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Calendar Confidence
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 26, fontWeight: 500, color: confColor, ...MONO }}>
                  {data.confidence.score}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: confColor }}>
                    {data.confidence.label}
                  </div>
                  <div style={{ fontSize: 12, color: M }}>{data.confidence.meaning}</div>
                </div>
              </div>
              {data.confidence.reasons.map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>{r}</div>
              ))}
            </div>

            {/* Expected edge */}
            <div style={{ background: 'var(--surface)',
              border: '1px solid var(--fd-hairline)',
              borderRadius: 0, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: A, fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Expected Edge<InfoTooltip term="expected_edge" inline /> (after BUY signal)
              </div>
              {data.expected_edge.sample === 0 ? (
                <div style={{ fontSize: 12, color: M }}>
                  Insufficient BUY signal history
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4,
                    marginBottom: 6 }}>
                    <span style={{ fontSize: 22, fontWeight: 500,
                      color: (data.expected_edge.expected_value ?? 0) >= 0 ? G : R,
                      ...MONO }}>
                      {(data.expected_edge.expected_value ?? 0) >= 0 ? '+' : ''}
                      {data.expected_edge.expected_value?.toFixed(1) ?? '—'}%
                    </span>
                    <span style={{ fontSize: 12, color: M }}>expected</span>
                  </div>
                  {[
                    { label: 'Win Rate',   val: `${data.expected_edge.win_rate?.toFixed(0) ?? '—'}%`,     color: G },
                    { label: 'Avg Gain',   val: `+${data.expected_edge.avg_gain_pct?.toFixed(1) ?? '—'}%`, color: G },
                    { label: 'Avg Loss',   val: `${data.expected_edge.avg_loss_pct?.toFixed(1) ?? '—'}%`, color: R },
                    { label: 'Avg Hold',   val: `${data.expected_edge.avg_hold}d`,                        color: M },
                    { label: 'Signals',    val: `${data.expected_edge.sample}`,                           color: M },
                  ].map(({ label, val, color }) => (
                    <div key={label} style={{ display: 'flex',
                      justifyContent: 'space-between', fontSize: 12,
                      marginBottom: 3, padding: '1px 0',
                      borderBottom: '1px solid var(--fd-hairline)' }}>
                      <span style={{ color: M }}>{label}</span>
                      <span style={{ ...MONO, color, fontWeight: 500 }}>{val}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* ── 2b. Macro overlay ──────────────────────────────────────────────── */}
          <div style={{ background: 'var(--fd-card)',
            border: '1px solid var(--fd-hairline)', borderRadius: 0,
            padding: '8px 12px', display: 'flex', gap: 16, alignItems: 'center',
            flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: A,
              textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Macro Overlay
            </div>
            <div style={{ fontSize: 12, color: M }}>
              Regime: <strong style={{ color: data.macro_overlay.regime === 'EXPANSION' ? G
                : data.macro_overlay.regime === 'RISK-OFF' ? R : A }}>
                {data.macro_overlay.regime_label}
              </strong>
            </div>
            {data.macro_overlay.vix != null && (
              <div style={{ fontSize: 12, color: M }}>
                {data.macro_overlay.vix_label}
              </div>
            )}
            <div style={{ fontSize: 12, color: M, marginLeft: 'auto' }}>
              Buy levels: <strong style={{ ...MONO, color: 'var(--fd-accent)' }}>
                -{data.macro_overlay.buy_drop_pct}%
              </strong> /
              <strong style={{ ...MONO, color: G }}> -{data.macro_overlay.strong_drop_pct}%</strong> /
              <strong style={{ ...MONO, color: 'var(--fd-ink)' }}> -{data.macro_overlay.panic_drop_pct}%</strong>
            </div>
          </div>

          {/* ── 3. Calendar table ────────────────────────────────────────────── */}
          <div style={{ background: 'var(--surface)',
            border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: A, fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
               Projected Calendar — Next {weeks} Weeks
            </div>
            {data.cycle_stats.cycles_analyzed === 0 && (
              <div style={{ marginBottom: 8, padding: '6px 10px',
                background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
                borderRadius: 0, fontSize: 12, color: A, lineHeight: 1.5 }}>
                 0 cycles detected — probabilities below are theoretical defaults, not back-tested.
                Minimum 3 cycles required for statistical estimates. Use as directional guidance only.
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <TH>Week</TH>
                  <TH>Expected Behavior</TH>
                  <TH>Probability</TH>
                  <TH>Action</TH>
                </tr>
              </thead>
              <tbody>
                {data.calendar.map((row, i) => (
                  <tr key={i} style={{
                    background: row.phase === 'pullback'
                      ? 'var(--fd-card)' : 'transparent',
                    opacity: data.cycle_stats.cycles_analyzed === 0 ? 0.6 : 1,
                  }}>
                    <TD>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3,
                          background: phaseColor(row.phase), display: 'inline-block',
                          flexShrink: 0 }} />
                        <span style={{ ...MONO, fontSize: 12, fontWeight: 500 }}>
                          {row.window}
                        </span>
                      </div>
                    </TD>
                    <TD color={M}>{row.behavior}</TD>
                    <TD>
                      {data.cycle_stats.cycles_analyzed === 0
                        ? <span style={{ fontSize: 12, color: M, fontStyle: 'italic' }}>N/A</span>
                        : <ProbBar p={row.prob} />}
                    </TD>
                    <TD color={row.phase === 'pullback' ? G : row.phase === 'pause' ? A : M}>
                      {row.action}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── 4. Entry ladder + scenario matrix ───────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

            {/* Entry ladder — % from high */}
            <div style={{ background: 'var(--surface)',
              border: '1px solid var(--fd-hairline)',
              borderRadius: 0, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: A, fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Entry Ladder — % from {
                  data.price_bands.ladder_anchor_label === 'ma50' ? 'MA50'
                  : data.price_bands.ladder_anchor_label === 'blend' ? 'Blended Anchor'
                  : 'High'
                } $
                {(data.price_bands.ladder_anchor ?? data.price_bands.recent_high).toFixed(0)}
              </div>
              {data.price_bands.entry_ladder.map((row, i) => {
                const active = data.price_bands.current_zone === row.zone
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 10px', borderRadius: 0, marginBottom: 5,
                    background: active ? `${zoneColor(row.zone)}18` : `${zoneColor(row.zone)}08`,
                    border: `1px solid ${zoneColor(row.zone)}${active ? '60' : '25'}`,
                    outline: active ? `1px solid ${zoneColor(row.zone)}30` : 'none',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500,
                        color: zoneColor(row.zone) }}>
                        {row.action}
                        {active && (
                          <span style={{ marginLeft: 6, fontSize: 12,
                            background: `${zoneColor(row.zone)}30`,
                            padding: '1px 5px', borderRadius: 0 }}>
                            ← NOW
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: M, marginTop: 1 }}>{row.desc}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 500,
                        color: zoneColor(row.zone), ...MONO }}>
                        ${row.price.toFixed(2)}
                      </div>
                      {row.size_pct > 0 && (
                        <div style={{ fontSize: 12, color: M }}>{row.size_pct}%</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Scenario matrix */}
            <div style={{ background: 'var(--surface)',
              border: '1px solid var(--fd-hairline)',
              borderRadius: 0, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: A, fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Scenario Matrix
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <TH>Condition</TH>
                    <TH>Price</TH>
                    <TH>Action</TH>
                  </tr>
                </thead>
                <tbody>
                  {data.price_bands.scenario_matrix.map((row, i) => (
                    <tr key={i}>
                      <TD color={M}>{row.condition}</TD>
                      <TD>
                        <span style={{ ...MONO, fontWeight: 500,
                          color: zoneColor(row.zone), fontSize: 12 }}>
                          {row.price_desc}
                        </span>
                      </TD>
                      <TD color={zoneColor(row.zone)}>
                        <strong>{row.action}</strong>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Disclaimer ───────────────────────────────────────────────────── */}
          <div style={{ fontSize: 12, color: 'var(--fd-muted)', lineHeight: 1.6,
            padding: '6px 10px', background: 'var(--fd-card)', borderRadius: 0 }}>
            Cycle windows are projected from median durations detected in the last{' '}
            {data.lookback_days} trading days. Probabilities count how often past cycles
            matched the projected offset — not a guarantee. Confidence reflects sample
            size, cycle consistency, MA alignment, and volatility regime.
          </div>
        </>
      )}

      {!data && !loading && !err && (
        <div style={{ padding: '16px 8px', fontSize: 12, color: M,
          textAlign: 'center', lineHeight: 1.8 }}>
          Click <strong style={{ color: A }}>Generate Calendar</strong> to run cycle
          detection on {symbol || 'this symbol'} and produce the entry ladder.
        </div>
      )}
    </div>
  )
}
