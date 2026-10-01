/**
 * InfoTooltip — reusable ⓘ hover tooltip for research panels.
 *
 * Usage:
 *   <InfoTooltip term="nr7" />          → uses built-in glossary
 *   <InfoTooltip text="Custom text." /> → inline custom explanation
 *   <InfoTooltip term="atr" inline />   → renders inline (no line-break)
 */

import { useState } from 'react'

// ── Glossary ─────────────────────────────────────────────────────────────────

export const GLOSSARY: Record<string, { title: string; body: string }> = {
  // ── Trend & Cycle ────────────────────────────────────────────────────────
  trend_age: {
    title: 'Trend Age',
    body: 'How long the current trend has been running. Normal = early or mid-trend. Extended = trend has been running long enough that a pullback becomes more likely. Mature = late-stage — caution on new entries.',
  },
  leg1: {
    title: 'Leg 1 — Ignition',
    body: 'The first push of a new trend off a base or reversal. RSI is recovering from oversold (35–55), price just crossed above MA20/MA50. Best time for new entries — highest potential, lowest risk.',
  },
  leg2: {
    title: 'Leg 2 — Mature Move',
    body: 'The main body of the trend. Price is above both MA20 and MA50, RSI is in the 50–70 range. Trend is confirmed and running. Add on pullbacks but be aware it\'s no longer early.',
  },
  leg3: {
    title: 'Leg 3 — Exhaustion',
    body: 'Late-stage trend. RSI above 75, volatility expanding, run length 3+ bars. Blow-off territory — do not add new positions. Consider trimming. A reversal is increasingly likely.',
  },
  chop: {
    title: 'Chop / Neutral',
    body: 'No clear directional trend. Price is oscillating around the MAs without conviction. Wait for a leg to form before taking a position.',
  },
  maturity: {
    title: 'Cycle Maturity (0–100)',
    body: 'How far along the current leg is. 0 = just started. 100 = fully extended. High maturity means the move has already been running for a while — lower-quality entry point.',
  },
  pullback_pct: {
    title: 'Pullback from 20-day High',
    body: 'How far price has fallen from its recent 20-day peak. A small pullback (1–5%) in an uptrend is normal noise. A 5–15% pullback starts to offer better entry points. Over 15% may signal a deeper correction.',
  },

  // ── Volatility ────────────────────────────────────────────────────────────
  nr4: {
    title: 'NR4 — Narrow Range 4',
    body: 'Today\'s price range (High minus Low) is the smallest of the last 4 days. Indicates compression. The market is coiling — a breakout in either direction often follows. Watch for the next large-range day as a signal.',
  },
  nr7: {
    title: 'NR7 — Narrow Range 7',
    body: 'Today\'s range is the smallest of the last 7 days. Stronger compression signal than NR4. The tighter the coil, the more energy stored. A breakout from NR7 compression has higher follow-through probability.',
  },
  wr7: {
    title: 'WR7 — Wide Range 7',
    body: 'Today\'s range is the widest of the last 7 days. Volatility expansion after compression. Often marks the start of a new directional move — or exhaustion if it occurs after a long trend.',
  },
  wr10: {
    title: 'WR10 — Wide Range 10',
    body: 'Today\'s range is the widest of the last 10 days. Strong volatility expansion. In an uptrend this can be a blow-off. In a downtrend, capitulation. Watch close position % to determine who won the day.',
  },
  compression_score: {
    title: 'Compression Score (0–100)',
    body: 'Measures how tight today\'s range is relative to the 10-day median range. 100 = extremely tight (maximum compression). 0 = wide range (expanded). High scores precede breakouts. Low scores signal the breakout has already happened.',
  },
  vol_slope: {
    title: 'Volatility Slope (5d/10d)',
    body: 'Ratio of the 5-day average range to the 10-day average range. Above 1.0 = volatility is expanding (recent days more volatile than average). Below 1.0 = compressing (recent days quieter). Expansion above 1.15 often precedes a strong directional move.',
  },

  // ── Torque ────────────────────────────────────────────────────────────────
  atr: {
    title: 'ATR — Average True Range',
    body: 'The average daily price swing (High to Low, adjusted for gaps) over the last N days. A measure of how volatile the stock is. Used for stop-loss placement (e.g. stop = price − 2×ATR) and position sizing.',
  },
  atr_ratio: {
    title: 'ATR Ratio (14/20)',
    body: 'ATR-14 divided by ATR-20. Above 1.0 = recent volatility is HIGHER than the 20-day baseline (momentum accelerating). Below 1.0 = recent volatility is LOWER (momentum fading). 1.1+ = accelerating, 0.9 or below = decelerating.',
  },
  beta_torque: {
    title: 'Beta-Normalized Torque',
    body: 'Today\'s price range as a % of price, divided by the stock\'s beta. Adjusts explosive range behavior for how market-sensitive the stock is. A high-beta stock naturally has big ranges — this metric tells you if today\'s range is large even accounting for that.',
  },
  shock_day: {
    title: 'Shock Day',
    body: 'Today\'s range is more than 2× the 5-day average range. An unusually large single-day move. Can mark a climax (Leg-3 exhaustion) or an ignition (Leg-1 breakout). Context matters — check direction and close position.',
  },
  torque_score: {
    title: 'Torque Score (0–100)',
    body: 'Composite measure of directional velocity and volatility. Combines range %, beta-adjusted range, ATR acceleration, and vol slope. HIGH (70+) = explosive, volatile, fast-moving. LOW (under 40) = quiet, compressed, waiting.',
  },

  // ── Intraday ──────────────────────────────────────────────────────────────
  close_pos_pct: {
    title: 'Close Position % (0–100)',
    body: 'Where the close sits inside today\'s range. 0% = closed at the session low (sellers dominated all day). 100% = closed at the session high (buyers dominated all day). 60%+ = bullish close. 40% or below = bearish close.',
  },
  gap_fill: {
    title: 'Gap Fill',
    body: 'Whether price returned to and crossed yesterday\'s close after opening with a gap. A gap up that fills = sellers rejected the gap (bearish). A gap down that fills = buyers rejected the gap (bullish Reversal Up). A gap that does NOT fill = the market accepted the new level.',
  },
  pressure: {
    title: 'Session Pressure Label',
    body: 'Mechanical classification of the day\'s buyer/seller behavior. Strong Buy = close > open, move ≥ 0.5%. Weak Buy = close > open but small move. Reversal Up = opened below yesterday\'s close, recovered above it. Strong/Weak Sell and Reversal Down are mirrors.',
  },

  // ── Flow ─────────────────────────────────────────────────────────────────
  mfi: {
    title: 'MFI — Money Flow Index (14)',
    body: 'Like RSI but weighted by volume — measures whether money is flowing into or out of the stock. Above 80 = overbought (too much money in, expect pullback). Below 20 = oversold (money flowing out, potential reversal). 40–60 = neutral.',
  },
  obv_slope: {
    title: 'OBV Slope — On-Balance Volume',
    body: 'OBV adds volume on up-days and subtracts on down-days. The slope measures whether cumulative volume is trending up or down. Rising OBV = buyers are absorbing shares (bullish). Falling OBV = sellers are distributing (bearish). Divergence from price is a warning signal.',
  },
  ad_slope: {
    title: 'A/D Line — Accumulation/Distribution',
    body: 'Measures whether a stock is being accumulated (bought) or distributed (sold) based on where price closes within the day\'s range, weighted by volume. Rising A/D = buying pressure even on down days. Falling A/D = selling pressure even on up days.',
  },
  flow_divergence: {
    title: 'Flow Divergence',
    body: 'When price and money flow disagree. Bearish divergence: price is rising but OBV and A/D are falling — smart money is selling into strength. Bullish divergence: price is falling but flow indicators are rising — smart money is accumulating on dips.',
  },
  flow_score: {
    title: 'Flow Confirmation Score (0–100)',
    body: 'Composite of MFI, OBV direction, and A/D direction. 75+ = flow strongly confirms the price trend (institutional participation). 40–60 = mixed, no clear confirmation. Below 40 = flow diverging — move may be unsustainable.',
  },

  // ── MTF ───────────────────────────────────────────────────────────────────
  alignment_score: {
    title: 'Alignment Score (0–100)',
    body: 'Weighted average of all timeframe trends. 100 = all timeframes (Daily, 4H, 1H, 30M, 15M) pointing the same direction. 50 = neutral/mixed. 0 = all pointing opposite direction. Daily carries 50% of the weight — it cannot be overridden by lower timeframes.',
  },
  swing_gate: {
    title: 'Swing Gate',
    body: 'Entry permission based on alignment. ALLOWED = score ≥70, Daily + 4H both up, no bearish divergence. Swing entries are permitted. CAUTION = mixed signals, wait for alignment. BLOCKED = score ≤45 or downtrend, no new entries.',
  },
  mtf_divergence: {
    title: 'MTF Divergence',
    body: 'When shorter timeframes break from the longer-term trend. Major: Daily and 4H are trending up but 1H is turning down — possible short-term pullback coming. Micro: 30M and 15M both contradict the 1H — noise or very early warning.',
  },

  // ── Risk ─────────────────────────────────────────────────────────────────
  component_var: {
    title: 'Component VaR',
    body: 'The estimated daily dollar loss this position contributes to the portfolio in a bad 5% scenario. Calculated as position weight × beta × portfolio daily VaR. Measures how much this one holding affects total portfolio risk.',
  },
  marginal_var: {
    title: 'Marginal VaR',
    body: 'How much additional daily VaR is added if you increase the position by 1%. If marginal VaR is high, adding to this position meaningfully increases portfolio risk. Used to decide whether a position is already large enough.',
  },
  beta_contrib: {
    title: 'Beta Contribution',
    body: 'Position weight × beta = how much market sensitivity this holding adds to the portfolio. A 5% position with beta 1.5 contributes 0.075 beta units. Keep total portfolio beta near 1.0 for market-neutral positioning.',
  },

  // ── Pattern ───────────────────────────────────────────────────────────────
  up_channel: {
    title: 'Uptrend Channel',
    body: 'A rising channel formed by connecting swing highs (resistance) and swing lows (support) with parallel trendlines. Price oscillates between the two lines. Buy near the lower line, take profit near the upper. A break above the upper line is a strong bullish signal. A break below the lower line may end the channel.',
  },
  down_channel: {
    title: 'Downtrend Channel',
    body: 'A falling channel where both resistance and support lines slope down. Price bounces between them on the way down. Avoid longs inside a down channel. A break above the upper line is the first signal the downtrend may be ending.',
  },
  bull_flag: {
    title: 'Bull Flag',
    body: 'A continuation pattern in an uptrend. After a strong up-move (the flagpole), price consolidates in a slight downward drift (the flag). Low volume during the flag signals accumulation. A breakout above the flag with expanding volume targets a move equal to the flagpole length.',
  },
  bear_flag: {
    title: 'Bear Flag',
    body: 'Mirror of the bull flag in a downtrend. After a sharp decline, price drifts up slightly before breaking down again. A breakdown below the flag\'s lower boundary confirms the continuation of the downtrend.',
  },
  pattern_strength: {
    title: 'Pattern Strength (0–100)',
    body: 'Confidence score for the detected pattern. Higher = cleaner geometry, more touchpoints, better R², appropriate volume behavior. 70+ = high confidence. 50–70 = moderate, use as context. Below 50 = marginal, treat as background noise only.',
  },

  // ── General ───────────────────────────────────────────────────────────────
  expected_edge: {
    title: 'Expected Edge',
    body: 'The statistical advantage the setup provides based on historical behavior of similar patterns, trend, and signal combinations. Positive edge = the setup has historically produced more gains than losses. Does not guarantee outcome — it\'s a probability, not a certainty.',
  },
  rsi: {
    title: 'RSI — Relative Strength Index (14)',
    body: 'Measures momentum on a 0–100 scale. Above 70 = overbought (price has risen too fast, pullback likely). Below 30 = oversold (price has fallen too fast, bounce likely). 40–60 = neutral. RSI works best in trending markets as a timing tool, not as a standalone buy/sell signal.',
  },
  r2: {
    title: 'R² (R-Squared)',
    body: 'How well the data fits a straight line (0 to 1). 0.9 = 90% of the price movement follows a clean linear trend. 0.6 = moderate fit. Below 0.5 = messy, pattern is unreliable. Used here to validate channel and flag trendlines.',
  },
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  term?: keyof typeof GLOSSARY
  title?: string
  text?: string
  inline?: boolean
}

export function InfoTooltip({ term, title, text, inline = false }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const entry = term ? GLOSSARY[term] : null
  const tipTitle = title ?? entry?.title ?? ''
  const tipBody  = text  ?? entry?.body  ?? ''

  if (!tipBody) return null

  return (
    <span
      style={{
        display: inline ? 'inline' : 'inline-block',
        marginLeft: 4,
        fontSize: 12,
        color: 'var(--fd-muted)',
        cursor: 'help',
        verticalAlign: 'middle',
        userSelect: 'none',
      }}
      onMouseMove={e => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      ⓘ
      {pos && (
        <span style={{
          position: 'fixed',
          left: pos.x + 12,
          top: pos.y - 8,
          transform: pos.x > window.innerWidth - 300 ? 'translateX(-100%)' : undefined,
          zIndex: 9999,
          display: 'block',
          width: 260,
          background: 'var(--bg2)',
          border: '1px solid var(--fd-hairline)',
          borderRadius: 0,
          padding: '10px 12px',
          boxShadow: 'none',
          pointerEvents: 'none',
          textAlign: 'left',
          fontStyle: 'normal',
          whiteSpace: 'normal',
          wordBreak: 'break-word',
        }}>
          {tipTitle && (
            <span style={{ display: 'block', fontSize: 12, fontWeight: 500,
              color: 'var(--text)', marginBottom: 5, fontFamily: 'var(--font-sans)' }}>
              {tipTitle}
            </span>
          )}
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text2)',
            lineHeight: 1.6, fontFamily: 'var(--font-sans)', fontWeight: 400 }}>
            {tipBody}
          </span>
        </span>
      )}
    </span>
  )
}
