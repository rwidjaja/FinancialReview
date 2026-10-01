// ── MODULE 1: Symbol Snapshot, FairValueSection ──

import { StatTile } from '../ui/StatTile'
import { STRUCTURAL_ICON, STRUCTURAL_LABEL, valuationColor } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, A, M, Y, TYPE_COLORS } from './researchTypes'
import type { ResearchApiData, EtfComponentData } from './researchTypes'
import { qualityColor, qualityBadge } from './researchHelpers'

export function SnapshotModule({ r, data, symbol, price, change, changePct, chgColor, ae, qe, isCef, showTech, tl, sc, snap, ece, eceLoading, isForeignQuote, quoteCurrency, nativePrice, nativeChange }: {
  r: ResearchApiData; data: DashboardData; symbol: string
  price: number; change: number; changePct: number; chgColor: string
  ae?: ResearchApiData['action_engine']; qe?: ResearchApiData['quality_engine']
  isCef: boolean; showTech: boolean
  tl?: ResearchApiData['trading_levels']; sc?: ResearchApiData['symbol_class']
  snap: any
  ece?: EtfComponentData | null
  eceLoading?: boolean
  isForeignQuote?: boolean; quoteCurrency?: string
  nativePrice?: number | null; nativeChange?: number | null
}) {
  const dec = data.decisions.find(d => d.symbol === symbol)
  const pi = data.portfolio_intel
  const fv = (pi?.fund_valuation ?? {})[symbol]
  const fvColor = valuationColor(fv ?? '—')
  const badgeType = sc?.type ?? ''
  const badgeColor = TYPE_COLORS[badgeType] ?? '#636e72'
  const q = r.quote
  const prem = q?.premium_discount
  const aeAction = (ae?.action ?? '').toUpperCase()
  const isExitTrim = aeAction.includes('TRIM') || aeAction.includes('SELL') || aeAction.includes('REDUCE') || aeAction.includes('AVOID')

  const vol = q?.volume
  const avgVol = r.technicals?.avg_volume_10d ?? r.technicals?.avg_volume_90d
  const volRatio = vol && avgVol ? vol / avgVol : null

  // Get trend info for compact display
  const ma20 = r.technicals?.ma_20
  const ma50 = r.technicals?.ma_50
  const ma200 = r.technicals?.ma_200
  const aboveMa20 = ma20 != null && price > ma20
  const aboveMa50 = ma50 != null && price > ma50
  const aboveMa200 = ma200 != null && price > ma200
  const trendScore = [aboveMa20, aboveMa50, aboveMa200].filter(Boolean).length
  const trendLabel = trendScore === 3 ? 'Uptrend' : trendScore === 0 ? 'Downtrend' : 'Mixed'
  const trendColor = trendScore >= 2 ? G : trendScore === 0 ? R : Y

  // Get pullback info
  const pullbackPct = tl?.pullback_20d_pct ?? 0
  const signal = tl?.composite_signal ?? 0
  // The header chip must agree with the verdict in the hero card below — a raw
  // composite_signal "STRONG BUY" while a real downtrend is active would be
  // misleading. Signal Score and same-session volume are deliberately NOT
  // gates here (see SimpleActionSummary) — only a genuine downtrend is.
  const entryGated = signal > 0 && trendScore === 0
  const gateReason = 'this looks like a real downtrend'
  const signalLabel = signal === 2 ? 'Strong Buy Signal' : signal === 1 ? 'Buy Signal' : 'No Signal Yet'
  const signalColor = entryGated ? Y : signal === 2 ? G : signal === 1 ? Y : M

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderTop: `3px solid ${A}`, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
      {/* Symbol header - unchanged */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {dec && <span style={{ fontSize: 18 }}>{STRUCTURAL_ICON[dec.structural_status]}</span>}
            <span style={{ fontSize: 28, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{symbol}</span>
            {badgeType && (
              <span style={{ fontSize: 12, fontWeight: 500, padding: '2px 7px', border: `1px solid ${badgeColor}55`, color: badgeColor, background: `${badgeColor}22` }}>
                {sc?.display_label ?? r.profile?.asset_type ?? badgeType}
                {sc?.subtype_label ? ` · ${sc.subtype_label}` : ''}
              </span>
            )}
            {fv && <span style={{ fontSize: 12, fontWeight: 500, color: fvColor, padding: '2px 6px', border: `1px solid ${fvColor}40` }}>{fv}</span>}
          </div>
          {r.profile?.name && <div style={{ fontSize: 12, color: M, marginBottom: 2 }}>{r.profile.name}</div>}
          {r.profile?.fund_company && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{r.profile.fund_company}{r.profile.exchange ? ` · ${r.profile.exchange}` : ''}</div>}
          {dec && <div style={{ fontSize: 12, color: M, marginTop: 4 }}>{STRUCTURAL_LABEL[dec.structural_status]}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <div style={{ fontSize: 32, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
              {isForeignQuote ? `($${price.toFixed(2)})` : `$${price.toFixed(2)}`}
            </div>
            {isForeignQuote && (
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                {quoteCurrency}→USD
              </span>
            )}
          </div>
          {isForeignQuote && nativePrice != null && (
            <div style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
              {quoteCurrency} {nativePrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              {nativeChange != null && (
                <span style={{ marginLeft: 6, color: nativeChange >= 0 ? G : R }}>
                  {nativeChange >= 0 ? '+' : ''}{nativeChange.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
          )}
          <div style={{ fontSize: 14, color: chgColor, fontWeight: 500 }}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
          </div>
          {isCef && prem != null && (
            <div style={{ fontSize: 12, color: prem < -0.5 ? G : prem > 2 ? R : M, fontWeight: 500, marginTop: 2 }}>
              {prem >= 0 ? '+' : ''}{prem.toFixed(2)}% {prem < 0 ? 'DISCOUNT' : 'PREMIUM'} to NAV
            </div>
          )}
          {r.events?.ex_div_date && <div style={{ fontSize: 12, color: G, marginTop: 2 }}>ex-div {r.events.ex_div_date}</div>}
        </div>
      </div>

      {/* Compact 6-tile row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
        <StatTile
          label="DAY CHANGE"
          value={`${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
          sub={`${change >= 0 ? '+' : ''}$${change.toFixed(2)}`}
          color={chgColor}
          badge={changePct > 0 ? 'green' : changePct < 0 ? 'red' : 'none'}
          badgeLabel={changePct > 0 ? '▲ UP' : changePct < 0 ? '▼ DOWN' : undefined}
          trend={changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat'}
        />

        {qe?.quality_score != null && (
          <StatTile
            label="QUALITY SCORE"
            value={`${qe.quality_score}/100`}
            sub={qe.quality_label}
            color={qualityColor(qe.quality_score)}
            badge={qualityBadge(qe.quality_score)}
            badgeLabel={qe.quality_score >= 80 ? 'HIGH' : qe.quality_score >= 60 ? 'MID' : 'LOW'}
          />
        )}

        {(r.distributions?.ttm_yield != null || snap?.ttm_yield != null) && (
          <StatTile
            label="TTM YIELD"
            value={`${((r.distributions?.ttm_yield ?? snap?.ttm_yield * 100) || 0).toFixed(2)}%`}
            sub={r.distributions?.frequency ?? 'est.'}
            color={G}
            badge="green"
            badgeLabel="INCOME"
          />
        )}

        {(ma20 != null || ma50 != null || ma200 != null) && (
          <StatTile
            label="TREND"
            value={trendLabel}
            sub={`${aboveMa20 ? '▲' : '▼'}20 ${aboveMa50 ? '▲' : '▼'}50 ${aboveMa200 ? '▲' : '▼'}200`}
            color={trendColor}
            badge={trendScore >= 2 ? 'green' : trendScore === 0 ? 'red' : 'yellow'}
            badgeLabel={trendScore >= 2 ? 'UPTREND' : trendScore === 0 ? 'DOWNTREND' : 'MIXED'}
          />
        )}

        <StatTile
          label="PRICE SWINGS"
          value={tl?.active_tier === 'extreme' ? 'Very Active' : tl?.active_tier === 'high_vol' ? 'Active' : 'Calm'}
          sub={volRatio != null ? `${volRatio.toFixed(1)}× avg volume` : undefined}
          color={tl?.active_tier === 'extreme' ? R : tl?.active_tier === 'high_vol' ? Y : G}
          badge={tl?.active_tier === 'extreme' ? 'red' : tl?.active_tier === 'high_vol' ? 'orange' : 'green'}
          badgeLabel={tl?.active_tier === 'extreme' ? 'VERY ACTIVE' : tl?.active_tier === 'high_vol' ? 'ACTIVE' : 'CALM'}
        />

        {isExitTrim
          ? <StatTile
              label="BUY SIGNAL"
              value="Not Right Now"
              sub="a sell signal is active"
              color={R}
              badge="red"
              badgeLabel="SELL ACTIVE"
            />
          : <StatTile
              label="BUY SIGNAL"
              value={signalLabel}
              sub={entryGated
                ? `on hold: ${gateReason}`
                : pullbackPct > 0 ? `${pullbackPct.toFixed(1)}% off its recent high` : 'near its recent high'}
              color={signalColor}
              badge={entryGated ? 'orange' : signal === 2 ? 'green' : signal === 1 ? 'orange' : 'none'}
              badgeLabel={entryGated ? 'ON HOLD' : signal === 2 ? 'STRONG BUY' : signal === 1 ? 'PULLING BACK' : undefined}
            />
        }
      </div>

      {/* Entry/exit price levels live in the hero card's Unified Price Stack —
          this card sticks to valuation + status, not a second price display. */}
      {isExitTrim && showTech && (
        <div style={{ padding: '8px 12px', background: `${R}0d`, border: `1px solid ${R}40`,
          fontSize: 12, color: R, fontWeight: 500, letterSpacing: '0.5px' }}>
          ⊘ ENTRY DISABLED — exit/trim signal active. Wait for price to pull back before re-entry.
        </div>
      )}

      <FairValueSection
        ks={r.key_stats}
        price={price}
        analystTarget={r.key_stats?.analyst_target ?? null}
        ece={ece}
        eceLoading={eceLoading}
        isEtf={!!(r.etf_component_eligible || (sc?.type && (sc.type.includes('ETF') || sc.type === 'CEF')))}
        isCef={isCef}
        nav={q?.nav ?? null}
      />

    </div>
  )
}

export function FairValueSection({ ks, price, analystTarget, ece, eceLoading, isEtf, isCef, nav }: {
  ks?: ResearchApiData['key_stats']
  price: number
  analystTarget: number | null
  ece?: EtfComponentData | null
  eceLoading?: boolean
  isEtf?: boolean
  isCef?: boolean
  nav?: number | null
}) {
  // ── ETF path: weighted component fair value ──────────────────────────────────
  if (isEtf) {
    const etfFV = ece?.etf_fair_value ?? null
    const coverage = ece?.etf_fv_coverage_pct ?? null
    const growthScore = ece?.etf_growth_score ?? null
    const growthRegime = ece?.etf_growth_regime ?? null
    const weights = ece?.fv_model_weights ?? null
    const overPct = etfFV != null && etfFV > 0 && price > 0
      ? +((price - etfFV) / etfFV * 100).toFixed(1) : null
    const isOver = overPct != null && overPct > 20
    const isUnder = overPct != null && overPct < -20
    const isFair = overPct != null && !isOver && !isUnder
    const isBubble = overPct != null && overPct >= 100
    const valColor = isBubble ? 'var(--fd-negative)' : isOver ? R : isUnder ? 'var(--fd-accent)' : G
    const valLabel = isBubble ? 'VERY EXPENSIVE' : isOver ? 'OVERVALUED' : isUnder ? 'UNDERVALUED' : isFair ? 'FAIRLY VALUED' : '—'
    const regimeColor = growthRegime === 'HIGH-GROWTH' ? G : growthRegime === 'MODERATE' ? 'var(--as-lilac)' : M

    // ── CEF fallback: use NAV as fair value when component FV is unavailable ──
    const navPremPct = (isCef && nav && nav > 0 && price > 0)
      ? +((price - nav) / nav * 100).toFixed(2) : null
    const navFvColor = navPremPct == null ? M : navPremPct > 5 ? R : navPremPct < -5 ? 'var(--fd-accent)' : G
    const navFvLabel = navPremPct == null ? '—'
      : navPremPct > 5 ? 'PREMIUM — above NAV'
      : navPremPct < -5 ? 'DISCOUNT — below NAV'
      : 'NEAR NAV'

    return (
      <div style={{ borderTop: '1px solid var(--border2)', padding: '12px 16px',
        background: 'var(--fd-card)', height: '100%', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '1.2px', marginBottom: 10 }}>◈ FAIR VALUE — {isCef && etfFV == null ? 'NAV' : 'WEIGHTED COMPONENTS'}</div>

        {eceLoading && <div style={{ fontSize: 12, color: M }}>Computing component fair values…</div>}

        {!eceLoading && etfFV == null && isCef && nav && nav > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: navFvColor, fontFamily: 'var(--font-mono)' }}>
                ${nav.toFixed(2)}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: navFvColor }}>{navFvLabel}</div>
                <div style={{ fontSize: 12, color: M }}>
                  {navPremPct != null ? `${navPremPct >= 0 ? '+' : ''}${navPremPct}% vs NAV` : ''}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>
              CEF fair value = NAV. Price above NAV means paying a premium for assets — favorable only if justified by manager alpha or distribution quality.
            </div>
          </div>
        )}

        {!eceLoading && etfFV == null && !(isCef && nav && nav > 0) && (
          <div style={{ fontSize: 12, color: M }}>
            {ece?.is_top_heavy === false
              ? 'Not top-heavy — component valuation unavailable.'
              : 'Insufficient component fundamental data.'}
          </div>
        )}

        {etfFV != null && (
          <>
            {/* Blended verdict */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: valColor, fontFamily: 'var(--font-mono)' }}>
                ${etfFV.toFixed(2)}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: valColor }}>{valLabel}</div>
                {overPct != null && (
                  <div style={{ fontSize: 12, color: M }}>
                    {overPct >= 0 ? `+${overPct.toFixed(1)}% above FV` : `${overPct.toFixed(1)}% below FV`}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
              {growthScore != null && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>GROWTH SCORE</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: regimeColor, fontFamily: 'var(--font-mono)' }}>
                    {growthScore.toFixed(0)}/100
                  </span>
                  {growthRegime && (
                    <span style={{ fontSize: 12, color: regimeColor, background: `${regimeColor}18`,
                      padding: '0 4px', border: `1px solid ${regimeColor}40` }}>
                      {growthRegime}
                    </span>
                  )}
                </div>
              )}
              {weights && (
                <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                  DCF {(weights.dcf * 100).toFixed(0)}% · PE {(weights.pe * 100).toFixed(0)}% · PS {(weights.ps * 100).toFixed(0)}%
                  {coverage != null ? ` · ${coverage.toFixed(0)}% cov · detail ↓` : ' · detail ↓'}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Stock path: PE / PEG / analyst model ─────────────────────────────────────
  if (!ks || price <= 0) return (
    <div style={{ borderTop: '1px solid var(--border2)', padding: '12px 16px', background: 'var(--fd-card)', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 6 }}>◈ FAIR VALUE</div>
      <div style={{ fontSize: 12, color: M }}>No fundamental data available.</div>
    </div>
  )

  // PE-based fair value: forward (or trailing) EPS × normalized PE
  // Normalized PE: growth-adjusted heuristic — not DCF, but mechanical
  const eps = ks.eps_forward ?? ks.eps_ttm
  const growthRate = ks.earnings_growth ?? ks.revenue_growth  // 0-1 decimal
  const growthPct = growthRate != null ? growthRate * 100 : null

  // Reasonable PE based on growth rate
  let normalizedPe: number | null = null
  if (growthPct != null) {
    if (growthPct >= 30)      normalizedPe = 35
    else if (growthPct >= 20) normalizedPe = 28
    else if (growthPct >= 10) normalizedPe = 20
    else if (growthPct >= 0)  normalizedPe = 15
    else                      normalizedPe = 12
  } else if (ks.pe_ratio != null) {
    // Fallback: 75% of current PE as "fair" multiple
    normalizedPe = Math.round(ks.pe_ratio * 0.75)
  }

  const fvPE = eps != null && normalizedPe != null && eps > 0
    ? +(eps * normalizedPe).toFixed(2) : null

  // PEG-based fair value: PEG = 1 → FV = EPS × growth% (classic Lynch rule)
  // Cap at 50% — base-effect recoveries (e.g. MU +2200% from near-zero) inflate this 10×+
  const pegGrowthPct = growthPct != null ? Math.min(growthPct, 50) : null
  const fvPEG = eps != null && pegGrowthPct != null && eps > 0 && pegGrowthPct > 0
    ? +(eps * pegGrowthPct).toFixed(2) : null

  // Blended fair value: average of available estimates
  const estimates = [fvPE, fvPEG, analystTarget].filter((v): v is number => v != null && v > 0)
  const blended = estimates.length > 0
    ? +(estimates.reduce((s, v) => s + v, 0) / estimates.length).toFixed(2) : null

  // Margin of safety vs blended
  const overPct = blended != null && blended > 0
    ? +((price - blended) / blended * 100).toFixed(1) : null
  const isOver = overPct != null && overPct > 0
  const isFair = overPct != null && Math.abs(overPct) <= 10
  const valColor = isFair ? G : isOver ? R : 'var(--fd-accent)'
  const valLabel = isFair ? 'FAIRLY VALUED' : isOver ? 'OVERVALUED' : 'UNDERVALUED'

  const fmtFV = (v: number | null) => v != null ? `$${v.toFixed(2)}` : '—'

  return (
    <div style={{ borderTop: '1px solid var(--border2)', padding: '12px 16px',
      background: 'var(--fd-card)', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
        letterSpacing: '1.2px', marginBottom: 10 }}>◈ FAIR VALUE</div>

      {/* Verdict bar */}
      {blended != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: valColor, fontFamily: 'var(--font-mono)' }}>
            {fmtFV(blended)}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: valColor }}>{valLabel}</div>
            {overPct != null && (
              <div style={{ fontSize: 12, color: M }}>
                {isOver ? `+${overPct.toFixed(1)}% above fair value` : `${overPct.toFixed(1)}% below fair value`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Method breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {fvPE != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: M }}>PE Model <span style={{ color: 'var(--text3)' }}>({normalizedPe}×)</span></span>
            <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtFV(fvPE)}</span>
          </div>
        )}
        {fvPEG != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: M }}>PEG=1 <span style={{ color: 'var(--text3)' }}>(Lynch rule)</span></span>
            <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtFV(fvPEG)}</span>
          </div>
        )}
        {analystTarget != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: M }}>Analyst Target</span>
            <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtFV(analystTarget)}</span>
          </div>
        )}
        {estimates.length === 0 && (
          <div style={{ fontSize: 12, color: M }}>Insufficient data — need EPS or analyst target.</div>
        )}
        {blended != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 3,
            paddingTop: 3, borderTop: '1px solid var(--border2)' }}>
            <span style={{ color: M }}>Blended ({estimates.length} models)</span>
            <span style={{ color: valColor, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtFV(blended)}</span>
          </div>
        )}
      </div>

      {/* EPS context */}
      {eps != null && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
          {ks.eps_forward != null ? 'Fwd' : 'TTM'} EPS ${eps.toFixed(2)}
          {growthPct != null ? ` · Growth ${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(0)}%` : ''}
          {normalizedPe != null ? ` · Norm PE ${normalizedPe}×` : ''}
        </div>
      )}
    </div>
  )
}
