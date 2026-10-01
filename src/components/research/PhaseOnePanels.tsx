/**
 * PhaseOnePanels — Phase 1 & 2 Research tab upgrades
 *
 * 1. IntradayPressurePanel  — gap, close position %, pressure classifier
 * 2. VolatilityStructurePanel — NR4/NR7/WR7/WR10, compression score
 * 3. TorqueEnginePanel       — ATR, range%, beta-normalized torque, shock day
 * 4. BetaSizingPanel         — beta-adjusted position sizing (Portfolio Fit)
 */

import type { ResearchApiData } from './researchTypes'
import { InfoTooltip } from './InfoTooltip'

// ── Palette ───────────────────────────────────────────────────────────────────
const G  = 'var(--green)'
const R  = 'var(--red)'
const A  = 'var(--amber)'
const Y  = 'var(--yellow)'
const M  = 'var(--text2)'

const card: React.CSSProperties = {
  background:   'var(--surface)',
  border: '1px solid var(--fd-hairline)',
  borderRadius: 0,
  padding:      '10px 12px',
}

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)',
      textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
      {children}
    </div>
  )
}

function Row({ label, value, color = 'var(--text)', mono = true }:
  { label: React.ReactNode; value: React.ReactNode; color?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between',
      alignItems: 'baseline', padding: '3px 0',
      borderBottom: '1px solid var(--fd-hairline)' }}>
      <span style={{ fontSize: 12, color: M }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color,
        fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value}</span>
    </div>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 500, padding: '2px 7px',
      border: `1px solid ${color}`, color,
      background: `${color}12`, borderRadius: 0,
      whiteSpace: 'nowrap', letterSpacing: '0.3px',
    }}>{label}</span>
  )
}

// ── 1. Intraday Pressure ──────────────────────────────────────────────────────

export function IntradayPressurePanel({ r }: { r: ResearchApiData }) {
  const ip = r.intraday_pressure
  if (!ip || (!ip.gap_amt && ip.gap_amt !== 0)) return null

  const pressureColor: Record<string, string> = {
    'Strong Buy':    G,
    'Weak Buy':      G,
    'Strong Sell':   R,
    'Weak Sell':     R,
    'Reversal Up':   A,
    'Reversal Down': Y,
    'Flat':          M,
  }
  const pColor = pressureColor[ip.pressure ?? ''] ?? M
  const gapColor = (ip.gap_amt ?? 0) >= 0 ? G : R
  const intraColor = (ip.intra_delta ?? 0) >= 0 ? G : R

  // Close position color: > 70 strong, 40-70 neutral, < 40 weak
  const cpColor = ip.close_pos_pct != null
    ? ip.close_pos_pct >= 70 ? G : ip.close_pos_pct >= 40 ? A : R
    : M

  const fmt = (n: number, prefix = true) =>
    `${prefix && n >= 0 ? '+' : ''}${n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(2)}`}`

  const dataError = ip.close_pos_pct != null && ip.close_pos_pct > 100
  const headline = dataError
    ? ' Data error — close exceeds session range, signal unreliable'
    : ip.close_pos_pct != null && ip.close_pos_pct >= 70
    ? 'Closing near session high — buyers in control'
    : ip.close_pos_pct != null && ip.close_pos_pct <= 30
    ? 'Closing near session low — sellers in control'
    : 'Mid-range close — no decisive control'
  const headlineColor = dataError ? R : cpColor

  return (
    <div style={{ ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl>Intraday Pressure</Lbl>
        {ip.pressure && <Badge label={ip.pressure} color={pColor} />}
      </div>

      {/* Headline — the takeaway, up front */}
      <div style={{ fontSize: 12, fontWeight: 500, color: headlineColor, lineHeight: 1.35, marginBottom: 8 }}>
        {headline}
      </div>

      {/* Close position bar */}
      {ip.close_pos_pct != null && !dataError && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: M, marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
            <span>Low</span><span>High</span>
          </div>
          <div style={{ height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${ip.close_pos_pct}%`,
              background: cpColor, borderRadius: 0, transition: 'width 0.4s',
            }} />
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>Details</div>
      <Row label={<>Gap from prev close<InfoTooltip term="gap_fill" inline /></>}
        value={ip.gap_amt != null ? `${fmt(ip.gap_amt)} (${ip.gap_pct?.toFixed(2)}%)` : '—'}
        color={gapColor} />
      <Row label="Gap direction"
        value={ip.gap_dir === 'up' ? '↑ Gap Up' : ip.gap_dir === 'down' ? '↓ Gap Down' : '— Flat'}
        color={ip.gap_dir === 'up' ? G : ip.gap_dir === 'down' ? R : M} />
      <Row label={<>Gap filled<InfoTooltip term="gap_fill" inline /></>}
        value={ip.gap_filled == null ? '—' : ip.gap_filled ? '✓ Yes' : '✗ No'}
        color={ip.gap_filled ? G : ip.gap_filled === false ? R : M} />
      <Row label="Intraday Δ (open→now)"
        value={ip.intra_delta != null ? `${fmt(ip.intra_delta)} (${ip.intra_pct?.toFixed(2)}%)` : '—'}
        color={intraColor} />
      <Row label="Session range"
        value={ip.session_range != null ? `$${ip.session_range.toFixed(2)}` : '—'} />
      <Row label={<>Close position %<InfoTooltip term="close_pos_pct" inline /></>}
        value={ip.close_pos_pct != null ? `${ip.close_pos_pct.toFixed(1)}%` : '—'}
        color={headlineColor} />
    </div>
  )
}

// ── 2. Volatility Structure ───────────────────────────────────────────────────

export function VolatilityStructurePanel({ r }: { r: ResearchApiData }) {
  const vs = r.volatility_structure
  if (!vs || vs.today_range == null) return null

  const compColor = vs.compression_score != null
    ? vs.compression_score >= 70 ? A   // tight → watch for breakout
    : vs.compression_score >= 40 ? Y
    : G                                // wide → expansion
    : M

  const slopeColor = vs.vol_slope != null
    ? vs.vol_slope > 1.15 ? R   // expanding fast
    : vs.vol_slope > 1.0  ? A   // mild expansion
    : vs.vol_slope < 0.85 ? G   // compressing
    : M
    : M

  const badges: { label: string; color: string; tip: string }[] = [
    ...(vs.nr7  ? [{ label: 'NR7',  color: A,  tip: 'Narrowest range in 7 days — breakout watch' }] : []),
    ...(vs.nr4  ? [{ label: 'NR4',  color: Y,  tip: 'Narrowest range in 4 days — mild compression' }] : []),
    ...(vs.wr10 ? [{ label: 'WR10', color: R,  tip: 'Widest range in 10 days — high volatility expansion' }] : []),
    ...(vs.wr7  ? [{ label: 'WR7',  color: R,  tip: 'Widest range in 7 days — volatility expansion' }] : []),
  ]

  const expanding = vs.vol_slope != null && vs.vol_slope < 0.85

  return (
    <div style={{ ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl>Volatility Structure</Lbl>
        <div style={{ display: 'flex', gap: 4 }}>
          {badges.map(b => (
            <span key={b.label} style={{ display: 'inline-flex', alignItems: 'center',
              fontSize: 12, fontWeight: 500, padding: '1px 5px',
              border: `1px solid ${b.color}`, color: b.color,
              background: `${b.color}12`, borderRadius: 0 }}>
              {b.label}
              <InfoTooltip term={b.label.toLowerCase() as 'nr4' | 'nr7' | 'wr7' | 'wr10'} inline />
            </span>
          ))}
          {badges.length === 0 && (
            <span style={{ fontSize: 12, color: M }}>Normal range</span>
          )}
        </div>
      </div>

      {/* Headline — the takeaway, up front */}
      <div style={{ fontSize: 12, fontWeight: 500, color: compColor, lineHeight: 1.35, marginBottom: 8 }}>
        {vs.signal}{expanding && ' — breakout probability rising'}
      </div>

      {/* Compression bar */}
      {vs.compression_score != null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: M, marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
            <span>Wide</span><span>Tight</span>
          </div>
          <div style={{ height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${vs.compression_score}%`,
              background: compColor, borderRadius: 0, transition: 'width 0.4s',
            }} />
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>Details</div>
      <Row label="Today's range"
        value={`$${vs.today_range?.toFixed(2)} (${vs.range_pct_today?.toFixed(2)}%)`} />
      <Row label="5-day avg range"
        value={vs.avg_range_5d != null ? `$${vs.avg_range_5d.toFixed(2)}` : '—'} />
      <Row label="10-day avg range"
        value={vs.avg_range_10d != null ? `$${vs.avg_range_10d.toFixed(2)}` : '—'} />
      <Row label={<>Vol slope<InfoTooltip term="vol_slope" inline /></>}
        value={vs.vol_slope != null ? `${vs.vol_slope.toFixed(3)}` : '—'}
        color={slopeColor} />
      <Row label={<>Compression score<InfoTooltip term="compression_score" inline /></>}
        value={vs.compression_score != null ? `${vs.compression_score}/100` : '—'}
        color={compColor} />
    </div>
  )
}

// ── 3. Torque Engine ──────────────────────────────────────────────────────────

export function TorqueEnginePanel({ r }: { r: ResearchApiData }) {
  const te = r.torque_engine
  if (!te || te.atr_14 == null) return null

  const scoreColor = te.torque_score != null
    ? te.torque_score >= 70 ? G
    : te.torque_score >= 40 ? A
    : R
    : M

  const atrRatioColor = te.atr_ratio != null
    ? te.atr_ratio > 1.1 ? G   // accelerating
    : te.atr_ratio < 0.9 ? R   // decelerating
    : M
    : M

  const price = r.quote?.last_price ?? 0

  return (
    <div style={{ ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl>Torque Engine</Lbl>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {te.shock_day && (
            <Badge label=" SHOCK DAY" color={A} />
          )}
          <span style={{
            fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
            color: scoreColor,
          }}>{te.torque_score ?? '—'}</span>
          <span style={{ fontSize: 12, color: M }}>/100</span>
        </div>
      </div>

      {/* Headline — the takeaway, up front */}
      <div style={{ fontSize: 12, fontWeight: 500, color: atrRatioColor, lineHeight: 1.35, marginBottom: 8 }}>
        {te.atr_ratio != null && te.atr_ratio > 1.1
          ? 'ATR accelerating — momentum building'
          : te.atr_ratio != null && te.atr_ratio < 0.9
          ? 'ATR decelerating — momentum fading'
          : 'ATR stable — no acceleration signal'}
        {te.shock_day && ' · shock day detected (range > 2× 5-day avg)'}
      </div>

      {/* Torque score bar */}
      {te.torque_score != null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${te.torque_score}%`,
              background: scoreColor, borderRadius: 0, transition: 'width 0.4s',
            }} />
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>Details</div>
      <Row label={<>Torque label<InfoTooltip term="torque_score" inline /></>}
        value={te.torque_label ?? '—'}
        color={scoreColor} />
      <Row label={<>ATR-14<InfoTooltip term="atr" inline /></>}
        value={te.atr_14 != null ? `$${te.atr_14.toFixed(2)} (${price > 0 ? (te.atr_14 / price * 100).toFixed(2) : '—'}%)` : '—'} />
      <Row label={<>ATR-20 baseline<InfoTooltip term="atr" inline /></>}
        value={te.atr_20 != null ? `$${te.atr_20.toFixed(2)}` : '—'} />
      <Row label={<>ATR ratio (14/20)<InfoTooltip term="atr_ratio" inline /></>}
        value={te.atr_ratio != null ? te.atr_ratio.toFixed(3) : '—'}
        color={atrRatioColor} />
      <Row label="Today's range %"
        value={te.range_pct_today != null ? `${te.range_pct_today.toFixed(2)}%` : '—'} />
      <Row label={<>Beta-normalized torque<InfoTooltip term="beta_torque" inline /></>}
        value={te.beta_torque != null ? `${te.beta_torque.toFixed(2)}` : '—'}
        color={te.beta_torque != null && te.beta_torque > 1.5 ? G : M} />
      <Row label={<>Vol slope<InfoTooltip term="vol_slope" inline /></>}
        value={te.vol_slope != null ? te.vol_slope.toFixed(3) : '—'}
        color={te.vol_slope != null && te.vol_slope > 1.0 ? G : te.vol_slope != null && te.vol_slope < 0.9 ? R : M} />
    </div>
  )
}

// ── 7. Risk Contribution ─────────────────────────────────────────────────────

export function RiskContributionPanel({ r }: { r: ResearchApiData }) {
  const pf   = r.portfolio_fit
  const rs   = r.risk_stats
  const beta = pf?.beta ?? rs?.beta
  const weight = pf?.weight_pct   // as %
  const histVol = r.technicals?.hist_vol_10d   // annualised %
  const portVol = 0.12   // assumed portfolio vol 12% (standard moderate)
  const corrPort = pf?.corr_portfolio   // correlation to whole portfolio

  if (!beta || !weight) return null

  const wt = weight / 100   // fraction

  // Component VaR (simplified): w × β × portfolio_daily_VaR
  // 95% daily VaR of a 12% vol portfolio ≈ 12% / sqrt(252) × 1.645
  const PORT_DAILY_VAR_95 = portVol / Math.sqrt(252) * 1.645
  const componentVaR = wt * beta * PORT_DAILY_VAR_95 * 100   // as %

  // Marginal VaR: additional VaR from a small increase in position
  const marginalVaR = beta * PORT_DAILY_VAR_95 * 100

  // Beta contribution to portfolio: w × β
  const betaContrib = wt * beta

  // Vol contribution: w × symbol_vol × corr / port_vol
  const symbolVol = histVol ? histVol / 100 : null
  const volContrib = symbolVol && corrPort != null && portVol > 0
    ? (wt * symbolVol * corrPort) / portVol * 100
    : null

  const pctOfPortBeta = betaContrib * 100   // % of beta=1 portfolio

  const riskColor = componentVaR > 2 ? R : componentVaR > 1 ? A : G

  return (
    <div style={{ ...card }}>
      <Lbl>Risk Contribution</Lbl>

      {/* Component VaR bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 12, color: M }}>Component VaR (95%, daily)</span>
          <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: riskColor }}>
            {componentVaR.toFixed(2)}%
          </span>
        </div>
        <div style={{ height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, componentVaR * 20)}%`,
            background: riskColor, borderRadius: 0 }} />
        </div>
        <div style={{ fontSize: 12, color: M, marginTop: 3 }}>
          At a 5% shock, this position risks losing ~{componentVaR.toFixed(2)}% of portfolio value.
        </div>
      </div>

      <Row label={<>Marginal VaR<InfoTooltip term="marginal_var" inline /></>}
        value={`${marginalVaR.toFixed(3)}%`}
        color={marginalVaR > 3 ? R : A} />
      <Row label={<>Beta contribution<InfoTooltip term="beta_contrib" inline /></>}
        value={`${betaContrib.toFixed(3)}  (${pctOfPortBeta.toFixed(1)}% of β=1)`}
        color={betaContrib > 0.05 ? R : betaContrib > 0.02 ? A : G} />
      {volContrib != null && (
        <Row label="Vol contribution"
          value={`${volContrib.toFixed(2)}%`}
          color={volContrib > 20 ? R : volContrib > 10 ? A : G} />
      )}
      {corrPort != null && (
        <Row label="Corr to portfolio"
          value={corrPort.toFixed(3)}
          color={corrPort > 0.8 ? R : corrPort > 0.5 ? A : G} />
      )}

      <div style={{ marginTop: 8, fontSize: 12, color: M, lineHeight: 1.5 }}>
        {volContrib != null && volContrib > 100
          ? <span style={{ color: R }}>EXTREME — vol contribution {volContrib.toFixed(0)}% exceeds portfolio vol budget. Primary driver of portfolio concentration risk.</span>
          : componentVaR > 2
          ? `High risk concentration — this position contributes ${componentVaR.toFixed(1)}% daily VaR. Consider trimming.`
          : componentVaR > 1
          ? `Moderate risk contribution — within watch range. Monitor if position grows.`
          : `Low risk contribution. Position sized conservatively.`}
      </div>
    </div>
  )
}

// ── 8. Portfolio Stress Impact ────────────────────────────────────────────────

export function PortfolioStressPanel({ r }: { r: ResearchApiData }) {
  const pf   = r.portfolio_fit
  const beta = pf?.beta ?? r.risk_stats?.beta
  const weight = pf?.weight_pct
  const portTotal = pf?.portfolio_total_value
  const posValue  = pf?.total_position_value

  if (!beta || !weight) return null

  const scenarios = [
    { label: '−10% shock', drop: 0.10, color: A },
    { label: '−20% shock', drop: 0.20, color: R },
    { label: '−30% shock', drop: 0.30, color: R },
  ]

  const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n.toFixed(0)}`

  return (
    <div style={{ ...card }}>
      <Lbl>Portfolio Stress Impact</Lbl>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
        Estimated portfolio loss if this position drops. Uses beta × position weight.
      </div>

      {scenarios.map(({ label, drop, color }) => {
        // Position loss = drop × beta (beta-adjusted move)
        const posDrop  = drop * beta
        // Portfolio impact = position_weight% × posDrop
        const portImpact = (weight / 100) * posDrop * 100
        // Dollar impact if we have portfolio total
        const dollarImpact = portTotal ? portTotal * (weight / 100) * posDrop : null
        const positionDollar = posValue ? posValue * posDrop : null

        return (
          <div key={label} style={{ marginBottom: 6, padding: '6px 8px',
            background: `${color}06`, border: `1px solid ${color}`,
            borderRadius: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color }}>{label}</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color }}>
                {positionDollar ? `−${fmt(positionDollar)} pos` : `−${(posDrop * 100).toFixed(1)}% pos`}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: M }}>Portfolio impact</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: M }}>
                −{portImpact.toFixed(2)}%
                {dollarImpact ? ` (−${fmt(dollarImpact)})` : ''}
              </span>
            </div>
          </div>
        )
      })}

      <div style={{ marginTop: 6, fontSize: 12, color: M, lineHeight: 1.5 }}>
        Beta {beta.toFixed(2)} — position {beta > 1.0 ? 'amplifies' : 'cushions'} market moves.
        {beta > 1.5 && ' High-beta position — stress impact is amplified vs market.'}
        {beta < 0.8 && beta > 0 && ' Below-market beta — stress impact is reduced vs index.'}
      </div>
    </div>
  )
}

// ── 4. Beta-Adjusted Position Sizing ─────────────────────────────────────────

export function BetaSizingPanel({ r }: { r: ResearchApiData }) {
  const pf   = r.portfolio_fit
  const beta = pf?.beta ?? r.risk_stats?.beta
  const currentWt = pf?.weight_pct

  if (!beta || !currentWt) return null

  // Target weights under different frameworks
  const PORTFOLIO_TARGET_VOL = 0.12   // 12% annual vol target (configurable)
  const symbolVol = r.technicals?.hist_vol_10d   // annualized %

  // Beta-neutral: scale so position contributes same beta as if beta=1
  const betaNeutralWt = parseFloat((currentWt / Math.abs(beta)).toFixed(2))

  // Vol-neutral: scale so position contributes same vol as a 1%-weighted position at target vol
  const volNeutralWt = symbolVol && symbolVol > 0
    ? parseFloat((currentWt * PORTFOLIO_TARGET_VOL / (symbolVol / 100)).toFixed(2))
    : null

  // Risk-parity: sqrt(1/beta) weighting
  const riskParityWt = parseFloat((currentWt / Math.sqrt(Math.abs(beta))).toFixed(2))

  const sizingColor = (target: number) =>
    Math.abs(target - currentWt) < 0.3 ? G
    : Math.abs(target - currentWt) < 1.0 ? A
    : R

  const fmt = (n: number) => `${n.toFixed(2)}%`

  return (
    <div style={{ ...card }}>
      <Lbl>Beta-Adjusted Position Sizing</Lbl>

      <Row label="Current weight" value={fmt(currentWt)} color={A} />
      <Row label="Beta" value={beta.toFixed(2)}
        color={beta > 1.5 ? R : beta > 1.0 ? A : G} />
      {symbolVol != null && (
        <Row label="10-day hist vol" value={`${symbolVol.toFixed(1)}%`} />
      )}

      <div style={{ marginTop: 8, height: 1, background: 'var(--fd-card)' }} />
      <div style={{ marginTop: 6, marginBottom: 4, fontSize: 12, fontWeight: 500,
        color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
        Target weights
      </div>

      <Row label="Beta-neutral"
        value={fmt(betaNeutralWt)}
        color={sizingColor(betaNeutralWt)} />
      {volNeutralWt != null && (
        <Row label="Vol-neutral"
          value={fmt(Math.min(volNeutralWt, 20))}
          color={sizingColor(Math.min(volNeutralWt, 20))} />
      )}
      <Row label="Risk-parity"
        value={fmt(riskParityWt)}
        color={sizingColor(riskParityWt)} />

      <div style={{ marginTop: 8, fontSize: 12, color: M, lineHeight: 1.5 }}>
        {beta > 1.2
          ? `High-β position (${beta.toFixed(2)}×). Beta-neutral target is ${fmt(betaNeutralWt)} — lower than current to offset elevated sensitivity.`
          : beta < 0.8
          ? `Low-β position (${beta.toFixed(2)}×). Beta-neutral target is ${fmt(betaNeutralWt)} — could hold more without excess beta exposure.`
          : `Market-β position. Current weight is within normal sizing range.`}
      </div>
    </div>
  )
}

// ── P4. Pattern Recognition Engine ───────────────────────────────────────────

const PATTERN_META: Record<string, { label: string; color: string; icon: string }> = {
  up_channel:   { label: 'Uptrend Channel',   color: G,  icon: '' },
  down_channel: { label: 'Downtrend Channel', color: R,  icon: '' },
  bull_flag:    { label: 'Bull Flag',          color: G,  icon: '' },
  bear_flag:    { label: 'Bear Flag',          color: R,  icon: '' },
}

const STATUS_COLOR: Record<string, string> = {
  forming:   A, confirmed: G, failed: R, expired: M,
}

export function PatternEnginePanel({ r }: { r: ResearchApiData }) {
  const pe = r.pattern_engine
  if (!pe) return null

  const patterns = pe.patterns?.filter(p => !p.error) ?? []

  return (
    <div style={{ ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl>Pattern Recognition<InfoTooltip term="pattern_strength" /></Lbl>
        <span style={{ fontSize: 12, color: M }}>
          {patterns.length === 0 ? 'No qualifying patterns' : `${patterns.length} pattern${patterns.length > 1 ? 's' : ''} detected`}
        </span>
      </div>

      {patterns.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, padding: '6px 0' }}>
          No channels or flags meet the strict detection rules on this symbol right now.
          Strict rules = low false positives.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {patterns.map((p, i) => {
            const meta     = PATTERN_META[p.type] ?? { label: p.type, color: M, icon: '◈' }
            const isFlag   = p.type.endsWith('_flag')
            const isChan   = p.type.endsWith('_channel')
            const strColor = (p.strength ?? 0) >= 70 ? G : (p.strength ?? 0) >= 50 ? A : R

            return (
              <div key={i} style={{ padding: '8px 10px',
                background: `${meta.color}06`, border: `1px solid ${meta.color}`,
                borderLeft: `3px solid ${meta.color}`, borderRadius: 0 }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>{meta.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: meta.color }}>{meta.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {isFlag && p.status && (
                      <Badge label={p.status.toUpperCase()} color={STATUS_COLOR[p.status] ?? M} />
                    )}
                    {isChan && (
                      <Badge label={p.valid ? '✓ VALID' : ' WATCH'} color={p.valid ? G : A} />
                    )}
                  </div>
                </div>

                {/* Strength bar */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Strength</span>
                    <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: strColor }}>{p.strength ?? 0}/100</span>
                  </div>
                  <div style={{ height: 3, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${p.strength ?? 0}%`, background: strColor, borderRadius: 0 }} />
                  </div>
                </div>

                {/* Channel details */}
                {isChan && (<>
                  <Row label="Channel width" value={p.channel_width_pct != null ? `${p.channel_width_pct.toFixed(1)}%` : '—'} />
                  <Row label="Upper touches" value={String(p.touch_count_upper ?? '—')} />
                  <Row label="Lower touches" value={String(p.touch_count_lower ?? '—')} />
                  <Row label={<>R²<InfoTooltip term="r2" inline /></>}
                    value={`${(p.r2_upper ?? 0).toFixed(2)} / ${(p.r2_lower ?? 0).toFixed(2)}`}
                    color={(Math.min(p.r2_upper ?? 0, p.r2_lower ?? 0)) >= 0.8 ? G : A} />
                  {p.upper_price != null && p.lower_price != null && (
                    <Row label="Channel now"
                      value={`$${p.lower_price.toFixed(2)} – $${p.upper_price.toFixed(2)}`}
                      color={meta.color} />
                  )}
                </>)}

                {/* Flag details */}
                {isFlag && (<>
                  <Row label="Impulse return" value={p.impulse_return_pct != null ? `${p.impulse_return_pct >= 0 ? '+' : ''}${p.impulse_return_pct.toFixed(1)}%` : '—'}
                    color={meta.color} />
                  <Row label="Flag depth" value={p.flag_depth_pct != null ? `${p.flag_depth_pct.toFixed(1)}%` : '—'}
                    color={(p.flag_depth_pct ?? 0) >= 3 && (p.flag_depth_pct ?? 0) <= 7 ? G : A} />
                  <Row label="Flag length" value={p.flag_bars != null ? `${p.flag_bars} bars` : '—'} />
                  {p.breakout_level != null && (
                    <Row label="Breakout level" value={`$${p.breakout_level.toFixed(2)}`} color={meta.color} />
                  )}
                </>)}
              </div>
            )
          })}
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)', lineHeight: 1.4, opacity: 0.7 }}>
        Channels + flags only (Phase 4 v1). Strict geometric rules — each pattern either fully qualifies or doesn't appear.
        Use as context, not hard triggers.
      </div>
    </div>
  )
}

// ── MTF. Multi-Timeframe Alignment Engine ────────────────────────────────────

const TF_LABELS: Record<string, string> = {
  D1: 'Daily', H4: '4-Hour', H1: '1-Hour', M30: '30-Min', M15: '15-Min',
}
const TF_ORDER = ['D1', 'H4', 'H1', 'M30', 'M15']

export function MultiTimeframeAlignmentPanel({ r }: { r: ResearchApiData }) {
  const mtf = r.mtf_alignment
  if (!mtf || mtf.error || mtf.alignment_score == null) return null

  const score = mtf.alignment_score
  const gate  = mtf.swing_gate ?? 'CAUTION'

  const scoreColor = score >= 70 ? G : score >= 55 ? A : score >= 45 ? M : R
  const gateColor  = gate === 'ALLOWED' ? G : gate === 'BLOCKED' ? R : A
  const gateIcon   = gate === 'ALLOWED' ? '✓' : gate === 'BLOCKED' ? '✗' : ''

  const trendColor = (t: string | undefined) =>
    t === 'up' ? G : t === 'down' ? R : M

  const div = mtf.divergence
  const hasDivergence = div?.major || div?.micro

  return (
    <div style={{ ...card }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <Lbl>Multi-Timeframe Alignment<InfoTooltip term="alignment_score" /></Lbl>
        <Badge label={`${gateIcon} ${gate}`} color={gateColor} />
      </div>

      {/* Score + label */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)', color: scoreColor, lineHeight: 1 }}>
            {score}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{mtf.alignment_label}</div>
        </div>
        {/* Score bar */}
        <div style={{ width: 80 }}>
          <div style={{ height: 6, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${score}%`, background: scoreColor, borderRadius: 0, transition: 'width 0.4s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={{ fontSize: 12, color: M }}>0</span>
            <span style={{ fontSize: 12, color: M }}>100</span>
          </div>
        </div>
      </div>

      {/* Timeframe badges — compact grid, no bars (bars are noise when all same direction) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginBottom: 8 }}>
        {TF_ORDER.map(tf => {
          const available = mtf.available_tfs?.includes(tf)
          const trend = available ? (mtf.trend_states?.[tf] ?? 'neutral') : null
          const wt    = mtf.weights_used?.[tf]
          const isD1  = tf === 'D1'
          const tColor = trend ? trendColor(trend) : 'var(--fd-card)'
          const icon   = trend === 'up' ? '▲' : trend === 'down' ? '▼' : trend === 'neutral' ? '→' : '—'
          return (
            <div key={tf} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              padding: '6px 4px', borderRadius: 0,
              background: available ? `${tColor}10` : 'var(--fd-card)',
              border: `1px solid ${available ? tColor + '40' : 'var(--fd-hairline)'}`,
              opacity: available ? 1 : 0.4,
            }}>
              {/* Timeframe label */}
              <span style={{ fontSize: 12, fontWeight: isD1 ? 800 : 600,
                color: isD1 ? 'var(--text)' : 'var(--text3)',
                textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {TF_LABELS[tf] ?? tf}
              </span>
              {/* Trend icon */}
              <span style={{ fontSize: 13, color: tColor, lineHeight: 1 }}>{icon}</span>
              {/* Weight */}
              <span style={{ fontSize: 12, color: available ? tColor : M, fontFamily: 'var(--font-mono)' }}>
                {wt != null ? `${(wt * 100).toFixed(0)}%` : 'n/a'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Divergence warnings */}
      {hasDivergence && (
        <div style={{ padding: '6px 8px', background: 'var(--fd-card)',
          border: '1px solid var(--fd-hairline)', borderRadius: 0, marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: A, marginBottom: 3 }}> DIVERGENCE DETECTED</div>
          {div?.bullish && <div style={{ fontSize: 12, color: M }}>Bullish div: D1+H4 up, H1 weakening</div>}
          {div?.bearish && <div style={{ fontSize: 12, color: M }}>Bearish div: D1+H4 down, H1 strengthening</div>}
          {div?.micro   && <div style={{ fontSize: 12, color: M }}>Micro div: M30/M15 contradict H1</div>}
        </div>
      )}

      {/* Swing gate interpretation */}
      <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
        {gate === 'ALLOWED'
          ? 'D1 + H4 aligned up, score ≥ 70. Swing entries permitted.'
          : gate === 'BLOCKED'
          ? 'Score < 45 or D1/H4 trending down. No new entries.'
          : 'Mixed signals. Wait for alignment before entering.'}
      </div>
    </div>
  )
}

// ── 6. Liquidity & Flow Engine ───────────────────────────────────────────────

export function LiquidityFlowPanel({ r }: { r: ResearchApiData }) {
  const fe = r.flow_engine
  if (!fe || fe.error || fe.flow_score == null) return null

  const scoreColor = (fe.flow_score ?? 50) >= 75 ? G
    : (fe.flow_score ?? 50) >= 60 ? G
    : (fe.flow_score ?? 50) >= 40 ? M
    : (fe.flow_score ?? 50) >= 25 ? A
    : R

  const mfiColor = (fe.mfi_14 ?? 50) > 80 ? R
    : (fe.mfi_14 ?? 50) > 60 ? G
    : (fe.mfi_14 ?? 50) < 20 ? G    // oversold = bullish opportunity
    : (fe.mfi_14 ?? 50) < 40 ? R
    : M

  const slopeDir = (_slope: number | undefined, rising: boolean | undefined, falling: boolean | undefined) => {
    if (rising)  return { label: '↑ Rising',  color: G }
    if (falling) return { label: '↓ Falling', color: R }
    return { label: '→ Flat', color: M }
  }

  const obv = slopeDir(fe.obv_slope_pct, fe.obv_rising, fe.obv_falling)
  const ad  = slopeDir(fe.ad_slope_pct,  fe.ad_rising,  fe.ad_falling)

  const divColor = fe.bearish_div ? R : fe.bullish_div ? G : M

  return (
    <div style={{ ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl>Liquidity &amp; Flow<InfoTooltip term="flow_score" /></Lbl>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)', color: scoreColor }}>
            {fe.flow_score}
          </span>
          <span style={{ fontSize: 12, color: M }}>/100</span>
        </div>
      </div>

      {/* Score label */}
      <div style={{ fontSize: 12, fontWeight: 500, color: scoreColor, marginBottom: 8 }}>
        {fe.flow_label}
      </div>

      {/* Flow score bar */}
      <div style={{ height: 4, background: 'var(--fd-card)', borderRadius: 0, marginBottom: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${fe.flow_score}%`, background: scoreColor, borderRadius: 0 }} />
      </div>

      <Row label={<>MFI(14)<InfoTooltip term="mfi" inline /></>} value={fe.mfi_14?.toFixed(1) ?? '—'} color={mfiColor} />
      <div style={{ fontSize: 12, color: M, marginBottom: 4, paddingLeft: 2 }}>{fe.mfi_signal}</div>

      <Row label={<>OBV slope<InfoTooltip term="obv_slope" inline /></>}
        value={`${obv.label}  ${fe.obv_slope_pct != null ? `(${fe.obv_slope_pct >= 0 ? '+' : ''}${fe.obv_slope_pct.toFixed(1)}%)` : ''}`}
        color={obv.color} />
      <Row label={<>A/D slope<InfoTooltip term="ad_slope" inline /></>}
        value={`${ad.label}  ${fe.ad_slope_pct != null ? `(${fe.ad_slope_pct >= 0 ? '+' : ''}${fe.ad_slope_pct.toFixed(1)}%)` : ''}`}
        color={ad.color} />

      {/* Divergence */}
      <div style={{ marginTop: 8, padding: '6px 8px',
        background: fe.bearish_div ? 'var(--fd-card)' : fe.bullish_div ? 'var(--fd-card)' : 'transparent',
        border: `1px solid ${divColor}`,
        borderRadius: 0, fontSize: 12, color: divColor, lineHeight: 1.5 }}>
        {fe.divergence}
      </div>

      {/* Interpretation */}
      <div style={{ marginTop: 8, fontSize: 12, color: M, lineHeight: 1.5 }}>
        {fe.bearish_div
          ? 'Price rising but money flowing out — caution. Smart money may be distributing.'
          : fe.bullish_div
          ? 'Price falling but money flowing in — accumulation signal. Potential reversal.'
          : fe.flow_score >= 60
          ? 'Flow confirms the move. Institutional participation likely.'
          : fe.flow_score <= 35
          ? 'Flow diverging. Move may lack conviction.'
          : 'Mixed flow signals. Wait for confirmation.'}
      </div>
    </div>
  )
}

// ── 5. Cycle Position Engine ──────────────────────────────────────────────────

const LEG_COLORS: Record<string, string> = {
  Leg1_Up:   G,
  Leg1_Down: R,
  Leg2_Up:   G,
  Leg2_Down: R,
  Leg3_Up:   A,
  Leg3_Down: A,
  Chop:      M,
}

const LEG_ICON: Record<string, string> = {
  Leg1_Up:   '', Leg1_Down: '',
  Leg2_Up:   '', Leg2_Down: '⬇',
  Leg3_Up:   '', Leg3_Down: '',
  Chop:      '↔',
}

export function CyclePositionPanel({ r }: { r: ResearchApiData }) {
  const ce = r.cycle_engine
  if (!ce || ce.error || !ce.leg) return null

  const leg    = ce.leg
  const color  = LEG_COLORS[leg] ?? M
  const icon   = LEG_ICON[leg] ?? '—'
  const isUp   = leg.endsWith('_Up')
  const isDown = leg.endsWith('_Down')

  // Maturity color: low = green (early), high = red (late/risky)
  const matColor = (ce.maturity ?? 0) >= 75 ? R
    : (ce.maturity ?? 0) >= 50 ? A
    : G

  // Score bar segments
  const score = ce.cycle_score ?? 0

  return (
    <div style={{ ...card }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <Lbl>Cycle Position Engine<InfoTooltip term="leg1" /></Lbl>
        {ce.is_exhaustion && (
          <Badge label=" EXHAUSTION" color={A} />
        )}
        {ce.is_ignition && (
          <Badge label=" IGNITION" color={G} />
        )}
      </div>

      {/* Headline — the takeaway, up front */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color, lineHeight: 1.35 }}>
          {ce.entry_guidance || `${icon} ${ce.leg_label}`}
        </div>
        <div style={{ fontSize: 12, color: M, marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          {icon} {ce.leg_label}
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>Details</div>

      {/* Score + maturity bars */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase',
            letterSpacing: '0.8px', marginBottom: 3 }}>Cycle Score</div>
          <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)', color }}>{score}</div>
          <div style={{ height: 3, background: 'var(--fd-card)', borderRadius: 0, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 0 }} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase',
            letterSpacing: '0.8px', marginBottom: 3 }}>Maturity</div>
          <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-mono)', color: matColor }}>
            {ce.maturity ?? 0}
          </div>
          <div style={{ height: 3, background: 'var(--fd-card)', borderRadius: 0, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${ce.maturity ?? 0}%`, background: matColor, borderRadius: 0 }} />
          </div>
        </div>
      </div>

      {/* Metrics */}
      {(isUp || isDown) && (
        <Row label={isUp ? 'Up-run (consecutive ↑)' : 'Down-run (consecutive ↓)'}
          value={isUp ? `${ce.up_run ?? 0} bars` : `${ce.down_run ?? 0} bars`}
          color={color} />
      )}
      <Row label="RSI(14)" value={ce.rsi_val?.toFixed(1) ?? '—'}
        color={(ce.rsi_val ?? 50) > 75 ? R : (ce.rsi_val ?? 50) > 60 ? A : G} />
      <Row label="ATR%" value={ce.atr_pct != null ? `${ce.atr_pct.toFixed(2)}%` : '—'}
        color={ce.atr_elevated ? A : M} />
      <Row label="Vol ratio (vs 20d avg)" value={ce.vol_ratio != null ? `${ce.vol_ratio.toFixed(2)}×` : '—'}
        color={(ce.vol_ratio ?? 1) >= 1.5 ? G : (ce.vol_ratio ?? 1) < 0.7 ? R : M} />
      <Row label={<>Pullback from 20d high<InfoTooltip term="pullback_pct" inline /></>} value={ce.pullback_pct != null ? `${ce.pullback_pct.toFixed(2)}%` : '—'}
        color={(ce.pullback_pct ?? 0) > 10 ? R : (ce.pullback_pct ?? 0) > 5 ? A : M} />

      {/* Condition flags */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
        {ce.compressed && <Badge label="NR compressed" color={A} />}
        {ce.expanded   && <Badge label="WR expanded"   color={R} />}
        {ce.atr_elevated && <Badge label="ATR elevated" color={A} />}
        {(ce.vol_ratio ?? 1) >= 1.5 && <Badge label="High volume" color={G} />}
      </div>
    </div>
  )
}
