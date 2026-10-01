// ── SimpleActionSummary — the hero "action plan" card ────────────────────────

import { G, R, A, M } from './researchTypes'
import type { ResearchApiData, EtfComponentData } from './researchTypes'
import { qualityColor } from './researchHelpers'

export function SimpleActionSummary({ ae, qe, tl, ece, price, r }: {
  ae?: ResearchApiData['action_engine']
  qe?: ResearchApiData['quality_engine']
  tl?: ResearchApiData['trading_levels']
  ece?: EtfComponentData
  price: number
  r: ResearchApiData
}) {
  const action      = (ae?.action ?? '').toUpperCase()
  const pullback    = tl?.pullback_20d_pct ?? 0
  const high20      = tl?.high_20d
  // ATR-scaled buy/strong-buy/R:R come straight from the backend — no
  // client-side recompute, no hardcoded 0.95/0.90.
  const buyAt       = tl?.buy_price ?? null
  const sbuAt       = tl?.strong_buy_price ?? null
  const sigScore    = tl?.signal_score ?? 0
  const stop        = tl?.stop_loss
  const target      = tl?.take_profit
  const rrRaw       = tl?.rr_ratio ?? null
  // % pullback the ATR-scaled Buy level represents for this symbol — varies
  // by volatility, so "how much more decline is needed" can't be a flat 5%.
  const buyPullbackPct = (high20 && buyAt) ? ((high20 - buyAt) / high20 * 100) : null

  // ── Gate conditions (each one can independently block entry) ───────────
  const isExitTrim   = action.includes('TRIM') || action.includes('SELL') || action.includes('REDUCE') || action.includes('AVOID')
  const isExtreme    = tl?.active_tier === 'extreme'
  const eceLabel     = ece?.action_label ?? ''
  const eceIsChop    = !!(ece) && (eceLabel.startsWith('NEUTRAL') || eceLabel.startsWith('WEAK'))
  const eceIsDown    = eceLabel.startsWith('WEAK DOWN') || eceLabel.startsWith('STRONG DOWN')
  const eceAligned   = !!(ece) && (eceLabel.startsWith('STRONG UP') || eceLabel.startsWith('WEAK UP'))
  const t            = r.technicals
  const ma20 = t?.ma_20; const ma50 = t?.ma_50; const ma200 = t?.ma_200
  const trendScore   = [ma20, ma50, ma200].filter(v => v != null && price > v!).length
  const isBearish    = trendScore === 0
  const rrPoor       = rrRaw != null && rrRaw < 1
  const priceInBuy   = buyAt != null && price <= buyAt
  const priceInSbu   = sbuAt != null && price <= sbuAt
  // ── Collect failing gate reasons for BUY ZONE ──────────────────────────
  // Signal Score is deliberately NOT a gate here: it's a momentum measure
  // (built from price-vs-MA20/50 position), and the whole point of this
  // pullback strategy is to buy when price is below its short-term MAs —
  // gating on momentum would block the exact setups the price zone exists
  // to catch. "Extreme" same-session volume is also not a hard block for
  // the same reason (a big-volume drop into a pullback is often the
  // capitulation you'd want to buy, not a reason to sit out) — it still
  // matters, so it reduces suggested size instead (see sizeGuidance below).
  const buyGates: { label: string; color: string }[] = []
  if (isExitTrim)                        buyGates.push({ label: 'A sell signal is active, which overrides any buy signal', color: R })
  if (eceIsChop && !priceInBuy)          buyGates.push({ label: 'The underlying holdings aren’t showing clear direction, and price hasn’t pulled back enough yet', color: R })
  if (eceIsDown)                         buyGates.push({ label: 'The underlying holdings are trending down', color: R })
  if (isBearish)                         buyGates.push({ label: 'This looks like a real downtrend, not just a dip — we’re not calling this a buy', color: R })
  if (rrPoor)                            buyGates.push({ label: 'The potential reward doesn’t outweigh the risk right now', color: R })
  if (!priceInBuy && !isExitTrim)        buyGates.push({ label: `Price hasn’t pulled back enough yet — needs to reach $${buyAt?.toFixed(2) ?? '—'}`, color: M })

  // ── Additional gates for STRONG BUY ────────────────────────────────────
  const sbuExtraGates: { label: string; color: string }[] = []
  if (!priceInSbu)        sbuExtraGates.push({ label: `Price hasn’t dropped to our strong-buy level yet ($${sbuAt?.toFixed(2) ?? '—'})`, color: M })
  if (!eceAligned && ece) sbuExtraGates.push({ label: 'The underlying holdings aren’t showing clear upward direction yet', color: 'var(--fd-ink)' })

  // ── Decision tree ──────────────────────────────────────────────────────
  const allBuyGatesClear = buyGates.length === 0
  const allSbuGatesClear = allBuyGatesClear && sbuExtraGates.length === 0

  type Verdict = 'EXIT_TRIM' | 'STRONG_BUY' | 'BUY_ACTIVE' | 'BUY_INACTIVE' | 'HOLD' | 'WAIT'
  let state: Verdict
  if (isExitTrim)                               state = 'EXIT_TRIM'
  else if (allSbuGatesClear && priceInSbu)       state = 'STRONG_BUY'
  else if (allBuyGatesClear && priceInBuy)       state = 'BUY_ACTIVE'
  else if (buyAt != null && buyGates.length > 0) state = 'BUY_INACTIVE'
  else if (action.includes('HOLD') || action.includes('CORE')) state = 'HOLD'
  else                                           state = 'WAIT'

  // Plain-English label for whatever exit/trim action fired
  const exitVerdictLabel =
    action.includes('SELL') && action.includes('ALL') ? 'Consider Selling All' :
    action.includes('TRIM') || action.includes('REDUCE')  ? 'Consider Selling Some' :
    action.includes('AVOID')                               ? 'Avoid For Now' :
    action.includes('SELL')                                ? 'Consider Selling' :
    'Consider Reducing'

  const verdictMap: Record<Verdict, { label: string; color: string; bg: string; sub: string }> = {
    EXIT_TRIM:   { label: exitVerdictLabel,   color: R,        bg: 'var(--fd-card)',      sub: 'this overrides any buy signal' },
    STRONG_BUY:  { label: 'Great Time to Buy', color: G,        bg: 'var(--fd-card)',       sub: 'everything lines up for a full-size buy' },
    BUY_ACTIVE:  { label: 'Good Time to Buy',  color: 'var(--fd-ink)',bg: 'var(--fd-card)',     sub: 'it has pulled back enough to be a reasonable entry' },
    BUY_INACTIVE:{ label: 'Not Yet',           color: M,        bg: 'var(--fd-card)',    sub: 'we’re holding off — see why below' },
    HOLD:        { label: 'Hold What You Have',color: A,        bg: 'var(--fd-card)',     sub: 'no buy or sell signal right now' },
    WAIT:        { label: 'Keep Watching',     color: M,        bg: 'var(--fd-card)',    sub: 'no clear signal yet — check back after a pullback' },
  }
  const { label: verdict, color: vColor, bg: vBg, sub: verdictSub } = verdictMap[state]

  // ── Size guidance (formal rules) ───────────────────────────────────────
  let sizeGuidance: number | null = ae?.size_guidance ?? null
  if (state === 'EXIT_TRIM')   sizeGuidance = 0
  if (state === 'BUY_INACTIVE') sizeGuidance = 0
  if (state === 'STRONG_BUY' && eceAligned) sizeGuidance = sizeGuidance ?? 150
  if (eceIsChop && state === 'BUY_ACTIVE') sizeGuidance = sizeGuidance ? Math.round(sizeGuidance * 0.5) : null
  // Extreme same-session volume: not a block, but worth sizing down for.
  const sizedDownForVolume = isExtreme && (state === 'STRONG_BUY' || state === 'BUY_ACTIVE')
  if (sizedDownForVolume) sizeGuidance = sizeGuidance ? Math.round(sizeGuidance / 2) : 50

  // ── Rationale text ────────────────────────────────────────────────────
  const rationale = ae?.ai_view ?? tl?.verdict_reason ?? (
    state === 'STRONG_BUY'  ? `It's dropped ${pullback.toFixed(1)}% from its recent high — a strong entry point.` :
    state === 'BUY_ACTIVE'  ? `It's pulled back ${pullback.toFixed(1)}% from its recent high — a reasonable entry point.` :
    state === 'BUY_INACTIVE'? (priceInBuy
      ? `The price has already dropped enough to buy — we're just holding off for other reasons below.`
      : `We'd want to see it drop to $${buyAt?.toFixed(2) ?? '—'} before calling this a buy.`) :
    state === 'HOLD'        ? 'Hold what you have. No clear buy or sell signal right now.' :
    state === 'EXIT_TRIM'   ? 'A sell signal is active — consider reducing or exiting regardless of quality.' :
    buyPullbackPct != null && pullback < buyPullbackPct && pullback > 0 ? `It's dropped ${pullback.toFixed(1)}% from its recent high — needs about ${(buyPullbackPct - pullback).toFixed(1)}% more to become a buy.` :
    'No clear signal right now. Worth checking back after a pullback.'
  )

  // ── Action Price — the ONE number to act on right now ──────────────────
  // Fixes two bugs in sequence:
  // 1) buyAt/sbuAt are historical-high-anchored trigger thresholds. Once
  //    price has already fallen past one, showing that stale higher anchor
  //    as "the buy price" reads as buying at a worse price than what's
  //    actually available.
  // 2) Once triggered, the actionable price still can't just be the current
  //    price — a limit order sitting exactly at market is a market order,
  //    not a buy limit. It needs to sit a small ATR-scaled increment below
  //    current price (same idea as placing a limit buy just under the ask
  //    instead of chasing it) — that's tl.limit_price, computed server-side.
  const limitPrice = tl?.limit_price ?? price
  let actionLabel: string
  let actionPrice: number | null
  let actionSub: string
  if (state === 'EXIT_TRIM') {
    actionLabel = 'Suggested Action'
    actionPrice = price
    actionSub  = 'sell at the current market price'
  } else if (state === 'STRONG_BUY' || state === 'BUY_ACTIVE') {
    actionLabel = 'Suggested Buy Price'
    actionPrice = limitPrice
    actionSub  = state === 'STRONG_BUY' ? 'everything lines up for a full-size buy' : 'it has pulled back enough to be a reasonable entry'
  } else if (state === 'BUY_INACTIVE' && priceInBuy) {
    actionLabel = 'Ready, But We’re Cautious'
    actionPrice = limitPrice
    actionSub  = 'the price has dropped enough — see why we’re still holding off below'
  } else if (state === 'BUY_INACTIVE') {
    actionLabel = 'Target Buy Price'
    actionPrice = buyAt
    actionSub  = buyPullbackPct != null ? `needs to drop about ${Math.max(0, buyPullbackPct - pullback).toFixed(1)}% more — also blocked below` : 'waiting for a pullback'
  } else if (state === 'WAIT' && buyAt != null) {
    actionLabel = 'Target Buy Price'
    actionPrice = buyAt
    actionSub  = buyPullbackPct != null ? `needs to drop about ${Math.max(0, buyPullbackPct - pullback).toFixed(1)}% more` : 'keep an eye out for a pullback'
  } else {
    actionLabel = state === 'HOLD' ? 'Holding' : 'No Target Yet'
    actionPrice = null
    actionSub  = 'no buy or sell signal right now'
  }

  const qs     = qe?.quality_score
  const qLabel = qe?.quality_label ?? ''
  const qColor = qualityColor(qs)
  const qPct   = qs ?? 0

  return (
    <div style={{ border: `2px solid ${vColor}`, borderRadius: 0, overflow: 'hidden', background: 'var(--surface)', flexShrink: 0 }}>

      {/* ── Verdict header ─────────────────────────────────────────────── */}
      <div style={{ padding: '16px 20px', background: vBg,
        borderBottom: '1px solid var(--border2)' }}>

        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '1.5px', marginBottom: 10 }}>◈ ACTION PLAN</div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 34, fontWeight: 500, color: vColor,
              fontFamily: 'var(--font-mono)', letterSpacing: '-0.5px', lineHeight: 1 }}>
              {verdict}
            </div>
            <div style={{ fontSize: 12, color: M, marginTop: 4, fontStyle: 'italic' }}>{verdictSub}</div>
            <div style={{ fontSize: 12, color: M, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {sizeGuidance != null && (
                <span>Suggested size: <strong style={{ color: sizeGuidance === 0 ? R : vColor }}>{sizeGuidance}%</strong> of position</span>
              )}
              {tl?.signal_score != null && (
                <span>Momentum: <strong style={{ color: sigScore >= 4 ? G : sigScore >= 2 ? 'var(--fd-lilac-ink)' : M }}>{sigScore}/5</strong></span>
              )}
            </div>
            {sizedDownForVolume && (
              <div style={{ fontSize: 12, color: 'var(--fd-ink)', marginTop: 4, fontStyle: 'italic' }}>
                Trading is unusually heavy today, so we’re suggesting a smaller position size.
              </div>
            )}
          </div>

          {qs != null && (
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
                letterSpacing: '0.8px', marginBottom: 4 }}>QUALITY</div>
              <div style={{ fontSize: 30, fontWeight: 500, color: qColor,
                fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{qs}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: qColor }}>{qLabel}</div>
              <div style={{ marginTop: 6, display: 'flex', height: 5, width: 80, borderRadius: 0,
                overflow: 'hidden', gap: 1 }}>
                {[{ threshold: 40, color: R }, { threshold: 60, color: A },
                  { threshold: 80, color: 'var(--yellow)' }, { threshold: 100, color: G }
                ].map((seg, i, arr) => {
                  const segStart = arr[i - 1]?.threshold ?? 0
                  const fill = Math.max(0, Math.min(seg.threshold, qPct) - segStart) / (seg.threshold - segStart) * 100
                  return (
                    <div key={i} style={{ flex: 1, background: 'var(--bg)' }}>
                      <div style={{ height: '100%', width: `${fill}%`, background: seg.color, opacity: 0.9 }} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {rationale && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text)', lineHeight: 1.65,
            padding: '8px 12px', background: 'var(--fd-card)',
            borderLeft: `3px solid ${vColor}70` }}>
            {rationale}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
           ACTION PRICE — the one number to act on right now, always
           anchored to reality (current price once triggered; a genuine
           forward target only when price hasn't reached it yet)
          ══════════════════════════════════════════════════════════════ */}
      <div style={{ borderTop: '1px solid var(--border2)', padding: '14px 16px',
        background: 'var(--fd-card)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
              letterSpacing: '0.8px', marginBottom: 6 }}>{actionLabel}</div>
            <div style={{ fontSize: 26, fontWeight: 500, color: vColor, fontFamily: 'var(--font-mono)' }}>
              {actionPrice != null ? `$${actionPrice.toFixed(2)}` : '—'}
            </div>
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{actionSub}</div>
          </div>

          {(stop != null || target != null || rrRaw != null) && (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {stop != null && (
                <div>
                  <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4 }}>Sell if it drops to</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: R, fontFamily: 'var(--font-mono)' }}>${stop.toFixed(2)}</div>
                </div>
              )}
              {target != null && (
                <div>
                  <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4 }}>Take profit around</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>${target.toFixed(2)}</div>
                </div>
              )}
              {rrRaw != null && (
                <div>
                  <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4 }}>Reward vs. Risk</div>
                  <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)',
                    color: rrRaw >= 2 ? G : rrRaw >= 1.5 ? A : R }}>{rrRaw.toFixed(1)}x</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Reference levels — de-emphasized, for anyone who wants the raw ATR anchors.
            Higher-volatility names blend the Buy/Strong Buy anchor toward MA50
            instead of the 20d high (a blown-off peak has no reversion value) —
            show the resolved anchor whenever it differs from the raw 20d high,
            so it's clear which reference the prices below are actually from. */}
        {(high20 || buyAt || sbuAt) && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--fd-hairline)',
            fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
            {high20 != null && `Recent High $${high20.toFixed(2)}`}
            {tl?.entry_anchor_label && tl.entry_anchor_label !== 'high_20d' && tl?.entry_anchor != null &&
              ` · Trend-Adjusted Reference $${tl.entry_anchor.toFixed(2)}`}
            {buyAt != null && ` · Buy $${buyAt.toFixed(2)}`}
            {sbuAt != null && ` · Strong Buy $${sbuAt.toFixed(2)}`}
          </div>
        )}
      </div>

      {/* ── Why ────────────────────────────────────────────────────────── */}
      {state === 'BUY_INACTIVE' && buyGates.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border2)',
          background: `${R}07` }}>
          <div style={{ fontSize: 12, color: R, fontWeight: 500, textTransform: 'uppercase',
            letterSpacing: '1px', marginBottom: 6 }}>◈ WHY WE’RE HOLDING OFF</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {buyGates.map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: g.color, flexShrink: 0 }}>✗</span>
                <span style={{ fontSize: 12, color: M }}>{g.label}</span>
              </div>
            ))}
          </div>
          {priceInBuy && sbuExtraGates.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--fd-hairline)' }}>
              <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
                letterSpacing: '0.8px', marginBottom: 6 }}>To reach our top rating, we’d also need</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {sbuExtraGates.map((g, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: g.color, flexShrink: 0 }}>✗</span>
                    <span style={{ fontSize: 12, color: M }}>{g.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {state === 'BUY_ACTIVE' && sbuExtraGates.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border2)' }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
            letterSpacing: '1px', marginBottom: 6 }}>◈ TO REACH OUR TOP RATING</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {sbuExtraGates.map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: g.color, flexShrink: 0 }}>✗</span>
                <span style={{ fontSize: 12, color: M }}>{g.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
