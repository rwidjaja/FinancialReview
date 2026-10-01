import { PanelHeader, Divider } from '../ui/Terminal'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import { MiniBar } from '../ui/Sparkline'
import { gainColor } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const M = 'var(--text2)'

interface Props { data: DashboardData }

export function TodayMovement({ data }: Props) {
  const bySymbol: Record<string, { dayChg: number; dayPct: number; symbol: string }> = {}

  for (const acct of data.accounts) {
    for (const p of acct.positions) {
      const snap = data.snapshots[p.symbol]
      if (!snap) continue
      const dayChg = (snap.price_change ?? 0) * p.shares
      if (!bySymbol[p.symbol]) {
        bySymbol[p.symbol] = { symbol: p.symbol, dayChg: 0, dayPct: (snap.price_change_pct ?? 0) * 100 }
      }
      bySymbol[p.symbol].dayChg += dayChg
    }
  }

  const movers = Object.values(bySymbol).sort((a, b) => Math.abs(b.dayChg) - Math.abs(a.dayChg))
  const totalDayChg = movers.reduce((s, m) => s + m.dayChg, 0)
  const maxAbs = movers[0] ? Math.abs(movers[0].dayChg) : 1

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${totalDayChg >= 0 ? G : R}` }}>
      <PanelHeader>Today's Movement</PanelHeader>
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 28, fontWeight: 500, color: gainColor(totalDayChg), letterSpacing: -1 }}>
          {totalDayChg >= 0 ? '+' : ''}${Math.abs(totalDayChg).toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </div>
        <div className="bb-sub" style={{ marginBottom: 8 }}>PORTFOLIO DAY CHANGE</div>

        {movers.slice(0, 5).map(m => {
          const c = m.dayChg >= 0 ? G : R
          const barPct = (Math.abs(m.dayChg) / maxAbs) * 100
          return (
            <div key={m.symbol} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                <span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{m.symbol}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--text3)' }}>{m.dayPct >= 0 ? '+' : ''}{m.dayPct.toFixed(2)}%</span>
                  <span style={{ color: c, fontWeight: 500 }}>
                    {m.dayChg >= 0 ? '+' : ''}${Math.abs(m.dayChg).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
              <MiniBar value={barPct} color={m.dayChg >= 0 ? G : R} height={2} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function IncomePace({ data }: Props) {
  const ytdActual   = data.income_history?.ytd_total ?? 0
  const ytdExpected = data.tax_data?.expected_ytd_total ?? 0
  const paceRatio   = ytdExpected > 0 ? ytdActual / ytdExpected : null
  const pacePct     = paceRatio != null ? Math.round(paceRatio * 100) : null

  const paceColor = paceRatio == null ? M
    : paceRatio >= 0.95 ? G : paceRatio >= 0.80 ? 'var(--yellow)' : R

  const paceLabel = paceRatio == null ? 'NO DATA'
    : paceRatio >= 1.05 ? '▲ RUNNING HOT'
    : paceRatio >= 0.95 ? '✓ ON PACE'
    : paceRatio >= 0.80 ? ' SLIGHTLY BEHIND'
    : ' SIGNIFICANTLY BEHIND'

  // ── Tax Rule Engine fields ────────────────────────────────────────────
  const tx = data.tax_data
  const bracketTarget   = tx?.income_bracket_target ?? 0
  const bracketRoom     = tx?.bracket_room          ?? 0
  const bracketPacePct  = tx?.bracket_pace_pct      ?? 0
  const finalStatus     = tx?.final_bracket_status  ?? 'OK'
  const finalMsg        = tx?.final_bracket_msg      ?? ''
  const softLimit       = tx?.soft_limit             ?? 0
  const softLimitRoom   = tx?.soft_limit_room        ?? 0
  const softLimitPct    = tx?.soft_limit_pace_pct    ?? 0

  const statusColorMap: Record<string, string> = {
    OK:       'var(--green)',
    WATCH:    'var(--yellow)',
    ACTION:   'var(--amber)',
    CRITICAL: 'var(--red)',
  }
  const bracketStatusColor = statusColorMap[finalStatus] ?? M

  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${paceColor}` }}>
      <PanelHeader>Income Pace</PanelHeader>
      <div style={{ padding: '8px 10px' }}>

        {/* YTD pace vs expected */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 28, fontWeight: 500, color: paceColor, letterSpacing: -1 }}>
            {pacePct != null ? `${pacePct}%` : '—'}
          </span>
          <span className="bb-sub">OF EXPECTED YTD</span>
        </div>
        <MiniBar value={pacePct ?? 0} color={paceColor} width={200} height={5} />
        <div style={{ fontSize: 12, fontWeight: 500, color: paceColor, marginTop: 4, marginBottom: 8 }}>
          {paceLabel}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: M }}>RECEIVED YTD</span>
            <span style={{ color: G, fontWeight: 500 }}>${fmt(ytdActual)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: M }}>EXPECTED YTD</span>
            <span style={{ fontWeight: 500 }}>${fmt(ytdExpected)}</span>
          </div>
        </div>

        <Divider />

        {/* Tax Bracket Rule Engine — rate from _TAX_RULE_ENGINE config */}
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: M, fontWeight: 500, letterSpacing: 1 }}>{tx?.target_bracket_rate ?? DEFAULT_BRACKET_RATE}% BRACKET ENGINE</span>
            <span style={{
              fontSize: 12, fontWeight: 500, padding: '1px 5px',
              background: bracketStatusColor + '22', color: bracketStatusColor,
              border: `1px solid ${bracketStatusColor}`, borderRadius: 0,
            }}>{finalStatus}</span>
          </div>

          {/* Bracket pressure bar */}
          <div style={{ position: 'relative', height: 5, background: 'var(--border2)', borderRadius: 0, marginBottom: 3 }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, height: '100%',
              width: `${Math.min(100, bracketPacePct)}%`,
              background: bracketStatusColor, borderRadius: 0,
              transition: 'width 0.4s',
            }} />
            {/* Soft limit marker */}
            {bracketTarget > 0 && softLimit > 0 && (
              <div style={{
                position: 'absolute', top: -2, bottom: -2,
                left: `${Math.min(100, (softLimit / bracketTarget) * 100)}%`,
                width: 1, background: 'var(--amber)', opacity: 0.7,
              }} />
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: M }}>BRACKET CEILING</span>
              <span style={{ fontWeight: 500 }}>${fmt(bracketTarget)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: M }}>PROJ. FULL-YEAR AGI</span>
              <span style={{ fontWeight: 500, color: bracketStatusColor }}>
                ${fmt(tx?.full_year_agi_estimate ?? 0)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: M }}>BRACKET PRESSURE</span>
              <span style={{ fontWeight: 500, color: bracketStatusColor }}>{bracketPacePct.toFixed(1)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: M }}>ROOM TO CEILING</span>
              <span style={{ fontWeight: 500, color: G }}>${fmt(bracketRoom)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: M }}>SOFT LIMIT ($)</span>
              <span style={{ fontWeight: 500, color: 'var(--amber)' }}>${fmt(softLimit)} · {softLimitPct.toFixed(1)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: M }}>SOFT LIMIT ROOM</span>
              <span style={{ fontWeight: 500 }}>${fmt(softLimitRoom)}</span>
            </div>
          </div>

          {finalMsg && (
            <div style={{
              marginTop: 6, padding: '4px 6px', fontSize: 12,
              color: bracketStatusColor, background: bracketStatusColor + '11',
              border: `1px solid ${bracketStatusColor}`, borderRadius: 0,
            }}>{finalMsg}</div>
          )}
        </div>
      </div>
    </div>
  )
}
