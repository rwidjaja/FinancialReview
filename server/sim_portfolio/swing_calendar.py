"""
swing_calendar.py — Swing Trade Calendar Engine

Deterministic, mechanical analysis. No ML, no feel — just counting.

Pipeline:
  1. Fetch 120+ days of daily OHLCV
  2. Detect swing highs/lows (ZigZag with configurable reversal threshold)
  3. Label each segment: rally | pause | pullback
  4. Compute cycle statistics (median durations, ranges)
  5. Detect current phase and how many days into it we are
  6. Project forward date windows for pause → pullback → recovery
  7. Assign probabilities from historical cycle counts
  8. Define price bands from recent structure (highs, MAs, prior lows)
  9. Map bands → entry tranches (T1/T2/T3)
  10. Return calendar table + scenario matrix + entry ladder
"""

from __future__ import annotations

import json
import os
import statistics
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple   # noqa: F401


# ── Rules loader ───────────────────────────────────────────────────────────────
def _load_rules() -> dict:
    try:
        path = os.path.join(os.path.dirname(__file__), "..", "rules.json")
        with open(os.path.normpath(path)) as f:
            return json.load(f)
    except Exception:
        return {}


_rules = _load_rules()
_regime_atr_mult = _rules.get("_ATR_PRICE_RULES", {}).get("swing_calendar_regime_atr_mult", {})


# ── Swing point detection (ZigZag) ────────────────────────────────────────────

def _detect_swing_points(
    highs:  List[float],
    lows:   List[float],
    closes: List[float],
    reversal_pct: float = 0.03,
) -> List[Dict[str, Any]]:
    """
    ZigZag-style swing point detector.

    Returns a list of dicts:
        { "idx": int, "price": float, "type": "high" | "low" }
    Consecutive points alternate high/low.
    """
    if len(closes) < 10:
        return []

    points: List[Dict[str, Any]] = []
    # Start from first direction
    last_type: Optional[str] = None
    last_price: float = closes[0]
    last_idx:   int   = 0

    for i in range(1, len(closes)):
        c = closes[i]
        if last_type is None:
            # Determine first direction
            if c > last_price * (1 + reversal_pct):
                # Started going up → last_idx was a low
                points.append({"idx": last_idx, "price": last_price, "type": "low"})
                last_type = "low"
            elif c < last_price * (1 - reversal_pct):
                points.append({"idx": last_idx, "price": last_price, "type": "high"})
                last_type = "high"
            # Track extremes while direction not set
            if c < last_price:
                last_price = c; last_idx = i
            elif c > last_price:
                last_price = c; last_idx = i

        elif last_type == "low":
            # Looking for next high
            if c > last_price:
                last_price = c; last_idx = i
            elif c < last_price * (1 - reversal_pct):
                # Confirmed high
                points.append({"idx": last_idx, "price": last_price, "type": "high"})
                last_type  = "high"
                last_price = c; last_idx = i

        else:  # last_type == "high"
            # Looking for next low
            if c < last_price:
                last_price = c; last_idx = i
            elif c > last_price * (1 + reversal_pct):
                # Confirmed low
                points.append({"idx": last_idx, "price": last_price, "type": "low"})
                last_type  = "low"
                last_price = c; last_idx = i

    # Add in-progress extreme
    if last_type == "low" and (not points or last_idx > points[-1]["idx"]):
        points.append({"idx": last_idx, "price": last_price, "type": "high"})
    elif last_type == "high" and (not points or last_idx > points[-1]["idx"]):
        points.append({"idx": last_idx, "price": last_price, "type": "low"})

    return points


# ── Phase labelling ────────────────────────────────────────────────────────────

def _label_segments(
    points: List[Dict[str, Any]],
    pause_threshold_pct: float = 0.015,   # < 1.5% move = pause
) -> List[Dict[str, Any]]:
    """
    Given alternating swing points, label each segment.
    Returns list of { from_idx, to_idx, from_price, to_price,
                      days, pct_move, phase }
    phase ∈ { "rally", "pullback", "pause" }
    """
    segments = []
    for i in range(len(points) - 1):
        a = points[i]
        b = points[i + 1]
        days     = b["idx"] - a["idx"]
        pct_move = (b["price"] - a["price"]) / a["price"]
        if abs(pct_move) < pause_threshold_pct:
            phase = "pause"
        elif pct_move > 0:
            phase = "rally"
        else:
            phase = "pullback"
        segments.append({
            "from_idx":   a["idx"],
            "to_idx":     b["idx"],
            "from_price": a["price"],
            "to_price":   b["price"],
            "days":       days,
            "pct_move":   round(pct_move * 100, 2),
            "phase":      phase,
        })
    return segments


# ── Cycle statistics ───────────────────────────────────────────────────────────

def _cycle_stats(segments: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute median and range for each phase type."""
    def stats_for(phase: str) -> Dict[str, Any]:
        days = [s["days"] for s in segments if s["phase"] == phase]
        if not days:
            return {"count": 0, "median": 0, "mean": 0, "min": 0, "max": 0}
        return {
            "count":  len(days),
            "median": int(statistics.median(days)),
            "mean":   round(statistics.mean(days), 1),
            "min":    min(days),
            "max":    max(days),
        }
    return {
        "rally":    stats_for("rally"),
        "pause":    stats_for("pause"),
        "pullback": stats_for("pullback"),
        "cycles_analyzed": len(segments),
    }


# ── Calendar projection ────────────────────────────────────────────────────────

def _business_days_from(start: datetime, n: int) -> datetime:
    """Advance n business days from start."""
    d = start
    added = 0
    while added < n:
        d += timedelta(days=1)
        if d.weekday() < 5:   # Mon-Fri
            added += 1
    return d


def _fmt_window(start: datetime, end: datetime) -> str:
    if start.month == end.month:
        return f"{start.strftime('%b %-d')}–{end.strftime('%-d')}"
    return f"{start.strftime('%b %-d')}–{end.strftime('%b %-d')}"


def _project_calendar(
    current_phase:     str,
    phase_day:         int,
    cycle_stats:       Dict[str, Any],
    today:             datetime,
    horizon_weeks:     int = 6,
    t1_price:          float = 0.0,
    t2_price:          float = 0.0,
    t3_price:          float = 0.0,
) -> List[Dict[str, Any]]:
    """
    Project weekly calendar windows.
    Returns list of { window, behavior, prob, action, phase }.
    """
    rally_med    = cycle_stats["rally"]["median"]    or 12
    pause_med    = cycle_stats["pause"]["median"]    or 4
    pullback_med = cycle_stats["pullback"]["median"] or 6

    # Remaining days in current phase
    phase_seq = ["rally", "pause", "pullback", "rally"]   # repeating cycle
    try:
        cur_phase_idx = phase_seq.index(current_phase)
    except ValueError:
        cur_phase_idx = 0

    phase_dur = {"rally": rally_med, "pause": pause_med, "pullback": pullback_med}

    # Days remaining in current phase
    cur_dur   = phase_dur.get(current_phase, rally_med)
    remaining = max(0, cur_dur - phase_day)

    # Build a timeline: (start_day_offset, end_day_offset, phase_name)
    timeline: List[Tuple[int, int, str]] = []
    offset = 0

    # Remainder of current phase
    if remaining > 0:
        timeline.append((offset, offset + remaining, current_phase))
        offset += remaining

    # Next phases in cycle
    for step in range(6):   # up to 6 phase transitions
        next_phase_idx = (cur_phase_idx + 1 + step) % len(phase_seq)
        next_phase     = phase_seq[next_phase_idx]
        dur = phase_dur.get(next_phase, rally_med)
        timeline.append((offset, offset + dur, next_phase))
        offset += dur
        if offset > horizon_weeks * 5:
            break

    # Map probability from cycle stats counts
    def phase_prob(phase: str) -> float:
        stats = cycle_stats.get(phase, {})
        count = stats.get("count", 1)
        total = cycle_stats.get("cycles_analyzed", 4)
        p = count / max(total, 1)
        # Clamp to realistic range
        return round(max(0.25, min(0.80, p)), 2)

    # Phase descriptions and actions
    BEHAVIOR = {
        "rally":    "Momentum / minor consolidation",
        "pause":    "Profit-taking / distribution wave",
        "pullback": "Pullback — statistical entry window",
    }
    def action_for(phase: str, start_day: int) -> str:
        if phase == "rally":
            return "Hold / wait"
        if phase == "pause":
            return f"Watch — prepare entries"
        if phase == "pullback":
            if t1_price > 0:
                return f"Buy 25% near ${t1_price:.0f}"
            return "First tranche entry"
        return "—"

    # Build weekly windows
    weeks: List[Dict[str, Any]] = []
    week_size = 5   # trading days per week

    horizon_days = horizon_weeks * week_size
    week_start = 0
    week_num   = 0

    while week_start < horizon_days:
        week_end  = week_start + week_size
        week_num += 1

        # Find dominant phase for this week
        dominant_phase = "rally"
        max_overlap    = 0
        for (t_start, t_end, phase) in timeline:
            overlap = min(week_end, t_end) - max(week_start, t_start)
            if overlap > max_overlap:
                max_overlap    = overlap
                dominant_phase = phase

        # Date window
        date_start = _business_days_from(today, week_start)
        date_end   = _business_days_from(today, week_end - 1)
        window_str = _fmt_window(date_start, date_end)

        prob = phase_prob(dominant_phase)
        action = action_for(dominant_phase, week_start)

        # Refine action with price for pullback weeks
        if dominant_phase == "pullback":
            if t1_price > 0 and t2_price > 0:
                if week_num <= 2:
                    action = f"Buy 25% if ${t1_price:.0f}–${(t1_price * 1.02):.0f}"
                else:
                    action = f"Buy 35% if ${t2_price:.0f}–${(t2_price * 1.01):.0f}"
        elif dominant_phase == "pause" and t1_price > 0:
            action = f"Watch — prepare for ${t1_price:.0f} entry"

        weeks.append({
            "window":   window_str,
            "behavior": BEHAVIOR.get(dominant_phase, "—"),
            "prob":     prob,
            "action":   action,
            "phase":    dominant_phase,
        })
        week_start = week_end

    return weeks


# ── Price band calculator (% from recent high) ────────────────────────────────

def _price_bands(
    closes:  List[float],
    ma20:    Optional[float],
    ma50:    Optional[float],
    atr:     float,
    t1_pct:  float = 0.25,
    t2_pct:  float = 0.35,
    t3_pct:  float = 0.40,
    ext_pct: float = 0.03,
    watch_atr_mult:  float = 0.5,   # Watch:      0.5× ATR below anchor
    buy_atr_mult:    float = 1.5,   # Buy:        1.5× ATR below anchor
    strong_atr_mult: float = 2.5,   # Strong Buy: 2.5× ATR below anchor
    panic_atr_mult:  float = 3.5,   # Panic Buy:  3.5× ATR below anchor
    ladder_anchor: Optional[float] = None,   # None → default to recent_high
    anchor_label:  str = "high",
) -> Dict[str, Any]:
    """
    Entry ladder defined as an ATR multiple pullback from an anchor price —
    not a fixed % of price. A low-volatility symbol needs only a small
    pullback to reach each tier; a high-volatility symbol needs a
    proportionally larger one, since ATR is each symbol's own typical dollar
    range (see rules.json._ATR_PRICE_RULES.swing_calendar_regime_atr_mult).

    The anchor itself is the recent high by default, but the caller can pass
    MA50 instead (ladder_anchor) for high-volatility names — a name with a
    large ATR relative to its price can have a 20d high that was itself a
    blow-off top with no reversion value, so MA50 (trend-following) is a more
    honest reference than the peak (see rules.json._ATR_PRICE_RULES.entry
    .high_vol_atr_pct_threshold, applied by the caller).

    Extended zone : above recent_high * (1 + ext_pct) → no buy (always tied
                    to the actual peak, regardless of ladder anchor)
    Watch         : start monitoring
    Buy           : first tranche T1
    Strong Buy    : preferred entry T2
    Panic Buy     : heavy buy T3
    """
    n20  = min(20, len(closes))
    n60  = min(60, len(closes))
    recent_high = max(closes[-n20:])
    recent_low  = min(closes[-n60:])
    current     = closes[-1]
    anchor      = ladder_anchor if ladder_anchor is not None else recent_high
    anchor_desc = {"high": "high", "ma50": "MA50", "blend": "blended anchor"}.get(anchor_label, anchor_label)
    s1 = ma20 if ma20 else anchor - buy_atr_mult * atr
    s2 = ma50 if ma50 else anchor - strong_atr_mult * atr

    extended     = round(recent_high * (1 + ext_pct), 2)
    watch_price  = round(anchor - watch_atr_mult  * atr, 2)
    buy_price    = round(anchor - buy_atr_mult    * atr, 2)
    strong_price = round(anchor - strong_atr_mult * atr, 2)
    panic_price  = round(anchor - panic_atr_mult  * atr, 2)

    current_pct_from_high = (current - recent_high) / recent_high * 100

    def _drop_pct(price: float) -> float:
        return (anchor - price) / anchor * 100 if anchor > 0 else 0.0

    watch_drop_pct  = _drop_pct(watch_price)
    buy_drop_pct    = _drop_pct(buy_price)
    strong_drop_pct = _drop_pct(strong_price)
    panic_drop_pct  = _drop_pct(panic_price)

    # Current zone
    if current > extended:
        current_zone = "extended"
    elif current > watch_price:
        current_zone = "no_buy"
    elif current > buy_price:
        current_zone = "watch"
    elif current > strong_price:
        current_zone = "buy"
    elif current > panic_price:
        current_zone = "strong_buy"
    else:
        current_zone = "panic_buy"

    return {
        "extended_above":        extended,
        "recent_high":           round(recent_high, 2),
        "ladder_anchor":         round(anchor, 2),
        "ladder_anchor_label":   anchor_label,   # "high" | "ma50" | "blend"
        "support1":              round(s1, 2),
        "support2":              round(s2, 2),
        "recent_low":            round(recent_low, 2),
        "current":               round(current, 2),
        "current_pct_from_high": round(current_pct_from_high, 2),
        "current_zone":          current_zone,
        "entry_ladder": [
            {
                "label":    "Watch",
                "price":    watch_price,
                "drop_pct": round(watch_drop_pct, 1),
                "desc":     f"-{watch_drop_pct:.1f}% from {anchor_desc} ({watch_atr_mult:.1f}x ATR)",
                "size_pct": 0,
                "action":   "WATCH",
                "zone":     "watch",
            },
            {
                "label":    "Buy",
                "price":    buy_price,
                "drop_pct": round(buy_drop_pct, 1),
                "desc":     f"-{buy_drop_pct:.1f}% from {anchor_desc} ({buy_atr_mult:.1f}x ATR)",
                "size_pct": int(t1_pct * 100),
                "action":   "BUY",
                "zone":     "buy",
            },
            {
                "label":    "Strong Buy",
                "price":    strong_price,
                "drop_pct": round(strong_drop_pct, 1),
                "desc":     f"-{strong_drop_pct:.1f}% from {anchor_desc} ({strong_atr_mult:.1f}x ATR)",
                "size_pct": int(t2_pct * 100),
                "action":   "STRONG BUY",
                "zone":     "strong_buy",
            },
            {
                "label":    "Panic Buy",
                "price":    panic_price,
                "drop_pct": round(panic_drop_pct, 1),
                "desc":     f"-{panic_drop_pct:.1f}% from {anchor_desc} ({panic_atr_mult:.1f}x ATR)",
                "size_pct": int(t3_pct * 100),
                "action":   "PANIC BUY",
                "zone":     "panic_buy",
            },
        ],
        "scenario_matrix": [
            {
                "condition":  "Anytime",
                "price_desc": f"> ${extended:.0f} (+{ext_pct*100:.0f}% from high)",
                "action":     "No buy — too extended",
                "zone":       "extended",
            },
            {
                "condition":  "Minor pullback",
                "price_desc": f"~${watch_price:.0f}  (-{watch_drop_pct:.1f}%)",
                "action":     "Watch — prepare entries",
                "zone":       "watch",
            },
            {
                "condition":  "First tranche",
                "price_desc": f"~${buy_price:.0f}  (-{buy_drop_pct:.1f}%)",
                "action":     f"Buy {int(t1_pct*100)}% position",
                "zone":       "buy",
            },
            {
                "condition":  "Preferred entry",
                "price_desc": f"~${strong_price:.0f}  (-{strong_drop_pct:.1f}%)",
                "action":     f"Add {int(t2_pct*100)}% position",
                "zone":       "strong_buy",
            },
            {
                "condition":  "Correction",
                "price_desc": f"~${panic_price:.0f}  (-{panic_drop_pct:.1f}%)",
                "action":     f"Heavy buy {int(t3_pct*100)}%",
                "zone":       "panic_buy",
            },
        ],
    }


# ── Trend age ─────────────────────────────────────────────────────────────────

def _trend_age(
    points:    List[Dict[str, Any]],
    closes:    List[float],
    cycle_stats: Dict[str, Any],
) -> Dict[str, Any]:
    """
    How old is the current uptrend?
    Defined as: trading days since the last significant swing LOW.
    Compared against historical rally median to determine if trend is extended.
    """
    n = len(closes)
    # Find last swing low
    last_low_idx = 0
    for pt in reversed(points):
        if pt["type"] == "low":
            last_low_idx = pt["idx"]
            break

    trend_age_days = n - 1 - last_low_idx
    rally_median   = cycle_stats["rally"]["median"] or 12
    rally_max      = cycle_stats["rally"]["max"]    or 25

    ratio = trend_age_days / max(rally_median, 1)

    if ratio < 0.5:
        status = "EARLY"
        status_color = "green"
    elif ratio < 1.0:
        status = "NORMAL"
        status_color = "green"
    elif ratio < 1.5:
        status = "EXTENDED"
        status_color = "amber"
    else:
        status = "VERY EXTENDED"
        status_color = "red"

    return {
        "trend_age_days":  trend_age_days,
        "rally_median":    rally_median,
        "rally_max":       rally_max,
        "ratio":           round(ratio, 2),
        "status":          status,
        "status_color":    status_color,
    }


# ── Confidence score ───────────────────────────────────────────────────────────

def _confidence_score(
    segments:    List[Dict[str, Any]],
    cycle_stats: Dict[str, Any],
    closes:      List[float],
) -> Dict[str, Any]:
    """
    Calendar confidence 0–100.
    Based on:
      Cycle count     — more cycles = more evidence          (0-30 pts)
      Consistency     — low CV in rally/pullback durations   (0-30 pts)
      Trend strength  — MA alignment, clean direction        (0-25 pts)
      Volatility regime — lower = more predictable           (0-15 pts)
    """
    score = 0
    reasons: List[str] = []

    # ── 1. Cycle count (0-30) ────────────────────────────────────────────────
    n_cycles = cycle_stats.get("cycles_analyzed", 0)
    cycle_pts = min(30, n_cycles * 5)
    score += cycle_pts
    if n_cycles >= 6:
        reasons.append(f"✅ {n_cycles} cycles — strong sample")
    elif n_cycles >= 3:
        reasons.append(f"⚠️ {n_cycles} cycles — moderate sample")
    else:
        reasons.append(f"❌ {n_cycles} cycles — small sample")

    # ── 2. Pattern consistency — coefficient of variation (0-30) ─────────────
    def cv(phase: str) -> float:
        durations = [s["days"] for s in segments if s["phase"] == phase]
        if len(durations) < 2:
            return 1.0
        mean_ = statistics.mean(durations)
        if mean_ == 0:
            return 1.0
        return statistics.stdev(durations) / mean_

    rally_cv    = cv("rally")
    pullback_cv = cv("pullback")
    avg_cv      = (rally_cv + pullback_cv) / 2
    consistency_pts = int((1 - min(avg_cv, 1.0)) * 30)
    score += consistency_pts
    if avg_cv < 0.3:
        reasons.append("✅ Highly consistent cycle rhythm")
    elif avg_cv < 0.6:
        reasons.append("⚠️ Moderately consistent cycles")
    else:
        reasons.append("❌ Irregular cycle durations")

    # ── 3. Trend strength — MA alignment (0-25) ───────────────────────────────
    n = len(closes)
    ma20 = sum(closes[-20:]) / 20 if n >= 20 else None
    ma50 = sum(closes[-50:]) / 50 if n >= 50 else None
    current = closes[-1]
    if ma20 and ma50 and current > ma20 > ma50:
        trend_pts = 25
        reasons.append("✅ Price > MA20 > MA50 — clean uptrend")
    elif ma20 and current > ma20:
        trend_pts = 15
        reasons.append("⚠️ Price > MA20 — moderate uptrend")
    else:
        trend_pts = 5
        reasons.append("❌ Mixed MA alignment")
    score += trend_pts

    # ── 4. Volatility regime — recent ATR/price (0-15) ────────────────────────
    if n >= 15:
        recent_moves = [abs(closes[i] - closes[i-1]) / closes[i-1]
                        for i in range(-14, 0)]
        avg_daily_move = statistics.mean(recent_moves) * 100   # as %
        if avg_daily_move < 1.0:
            vol_pts = 15
            reasons.append("✅ Low volatility — predictable moves")
        elif avg_daily_move < 2.0:
            vol_pts = 10
            reasons.append("⚠️ Moderate volatility")
        else:
            vol_pts = 3
            reasons.append("❌ High volatility — calendar less reliable")
        score += vol_pts

    score = min(100, score)

    if score >= 80:
        label = "Strong"
        meaning = "Strong recurring pattern — high trust"
    elif score >= 60:
        label = "Useful"
        meaning = "Useful pattern — treat as guide"
    elif score >= 40:
        label = "Weak"
        meaning = "Weak evidence — use with caution"
    else:
        label = "Unreliable"
        meaning = "Too little data — ignore calendar"

    return {
        "score":   score,
        "label":   label,
        "meaning": meaning,
        "reasons": reasons,
    }


# ── Regime-aware ATR multiples ─────────────────────────────────────────────────
# Regime → (watch_mult, buy_mult, strong_mult, panic_mult), all in units of ATR.
# Bull markets: shallower pullbacks are fine — a smaller ATR multiple triggers a buy.
# Neutral: be slightly more patient.
# Bear / Risk-Off: require a deeper, wider-ATR-multiple discount.
# Values come from rules.json._ATR_PRICE_RULES.swing_calendar_regime_atr_mult;
# these are only the fallback if that block is missing.
_DEFAULT_REGIME_ATR_MULT: Dict[str, float] = {"watch": 0.5, "buy": 1.5, "strong": 2.5, "panic": 3.5}

def _regime_atr_mults(regime: str) -> Tuple[float, float, float, float]:
    r = _regime_atr_mult.get(regime.upper()) \
        or _regime_atr_mult.get("CONSOLIDATION") \
        or _DEFAULT_REGIME_ATR_MULT
    return (
        r.get("watch",  _DEFAULT_REGIME_ATR_MULT["watch"]),
        r.get("buy",    _DEFAULT_REGIME_ATR_MULT["buy"]),
        r.get("strong", _DEFAULT_REGIME_ATR_MULT["strong"]),
        r.get("panic",  _DEFAULT_REGIME_ATR_MULT["panic"]),
    )


# ── Expected edge ──────────────────────────────────────────────────────────────

def _expected_edge(
    closes:    List[float],
    buy_drop:  float = 0.05,
    hold_days: int   = 30,
) -> Dict[str, Any]:
    """
    Back-test the BUY signal across the historical window.

    A BUY signal fires at bar i when:
        closes[i] <= max(closes[i-20:i]) * (1 - buy_drop)

    Measures what happened `hold_days` later.
    Returns: { win_rate, avg_gain_pct, avg_loss_pct, expected_value, avg_hold, sample }
    """
    wins: List[float]   = []
    losses: List[float] = []
    in_trade = False
    entry_bar = 0

    for i in range(20, len(closes) - hold_days):
        if in_trade:
            continue
        recent_high = max(closes[i - 20:i])
        buy_level   = recent_high * (1 - buy_drop)
        if closes[i] <= buy_level:
            in_trade  = True
            entry_bar = i
            exit_bar  = min(i + hold_days, len(closes) - 1)
            gain      = (closes[exit_bar] - closes[i]) / closes[i] * 100
            if gain >= 0:
                wins.append(gain)
            else:
                losses.append(gain)
            in_trade = False   # simple: one trade at a time, no overlap

    total = len(wins) + len(losses)
    if total == 0:
        return {
            "win_rate": None, "avg_gain_pct": None, "avg_loss_pct": None,
            "expected_value": None, "avg_hold": hold_days, "sample": 0,
        }

    all_gains  = wins + losses
    avg_gain   = sum(wins)   / len(wins)   if wins   else 0.0
    avg_loss   = sum(losses) / len(losses) if losses else 0.0
    win_rate   = len(wins) / total
    # Expected value: probability-weighted outcome
    ev         = win_rate * avg_gain + (1 - win_rate) * avg_loss

    return {
        "win_rate":       round(win_rate * 100, 1),
        "avg_gain_pct":   round(avg_gain, 1),
        "avg_loss_pct":   round(avg_loss, 1),
        "expected_value": round(ev, 1),
        "avg_hold":       hold_days,
        "sample":         total,
    }


# ── Phase enrichment ───────────────────────────────────────────────────────────

_PHASE_META = {
    "rally": {
        "description":   "Momentum / price expansion",
        "next_event":    "Pause or profit-taking wave",
        "action_hint":   "Hold existing positions — avoid chasing",
    },
    "pause": {
        "description":   "Distribution / profit-taking",
        "next_event":    "Pullback — entry window approaching",
        "action_hint":   "Prepare entries — watch buy levels",
    },
    "pullback": {
        "description":   "Price correction / retracement",
        "next_event":    "Recovery rally",
        "action_hint":   "Entry zone active — deploy tranches",
    },
}

def _phase_expected_duration(phase: str, cycle_stats: Dict[str, Any]) -> str:
    stats = cycle_stats.get(phase, {})
    count = stats.get("count", 0)
    lo    = stats.get("min", 0)
    hi    = stats.get("max", 0)

    if count > 0 and hi > 0:
        return f"{lo}–{hi} days"

    # No pause segments detected by the ZigZag — derive a sensible estimate.
    # Pauses are typically 20-40% of rally length; pullbacks 30-60%.
    rally_median = cycle_stats.get("rally", {}).get("median", 12) or 12
    pullback_med = cycle_stats.get("pullback", {}).get("median", 6) or 6
    if phase == "pause":
        lo_est = max(2, rally_median // 5)
        hi_est = max(5, rally_median // 3)
        return f"{lo_est}–{hi_est} days (est.)"
    if phase == "pullback":
        lo_est = max(3, pullback_med - 2)
        hi_est = max(8, pullback_med + 3)
        return f"{lo_est}–{hi_est} days (est.)"
    if phase == "rally":
        lo_est = max(5, rally_median - 4)
        hi_est = rally_median + 6
        return f"{lo_est}–{hi_est} days (est.)"
    return "3–7 days (est.)"


# ── Opportunity ranking ────────────────────────────────────────────────────────

def rank_opportunities(symbols: List[str]) -> List[Dict[str, Any]]:
    """
    Run swing analysis on each symbol and rank by setup_score.
    Returns list sorted best→worst: { symbol, setup_score, signal_text,
                                       entry_price, trend, rsi }.
    """
    from .swing import analyze_swing   # local import to avoid circular
    results = []
    for sym in symbols:
        try:
            r = analyze_swing(sym, "1d")
            if r.get("error"):
                continue
            results.append({
                "symbol":      sym,
                "setup_score": r.get("setup_score", 0),
                "signal_text": r.get("signal_text", ""),
                "signal_icon": r.get("signal_icon", ""),
                "is_buyable":  r.get("is_buyable", False),
                "entry_price": r.get("entry_price", 0),
                "trend":       r.get("trend", ""),
                "rsi":         r.get("rsi", 50),
                "price":       r.get("price", 0),
            })
        except Exception:
            pass
    results.sort(key=lambda x: x["setup_score"], reverse=True)
    return results


# ── Main entry point ───────────────────────────────────────────────────────────

def swing_calendar(
    symbol:        str,
    horizon_weeks: int   = 6,
    lookback_days: int   = 120,
    reversal_pct:  float = 0.03,
    t1_pct:        float = 0.25,
    t2_pct:        float = 0.35,
    t3_pct:        float = 0.40,
    ext_pct:       float = 0.03,
    regime:        str   = "CONSOLIDATION",   # EXPANSION | CONSOLIDATION | RISK-OFF
    vix:           float = 0.0,               # current VIX (0 = unknown)
    hold_days:     int   = 30,                # expected-edge hold window
) -> Dict[str, Any]:
    """
    Full swing calendar analysis for a symbol.

    Returns:
        symbol, current_price, current_phase, phase_day,
        cycle_stats, price_bands (with entry_ladder + scenario_matrix),
        calendar (weekly windows)
    """
    try:
        import yfinance as yf
        import numpy as np
    except ImportError:
        return {"error": "yfinance not installed", "symbol": symbol}

    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from atr_utils import compute_atr

    try:
        tk   = yf.Ticker(symbol.upper())
        hist = tk.history(period=f"{lookback_days}d", interval="1d")
        if hist.empty or len(hist) < 20:
            return {"error": f"Insufficient data for {symbol}", "symbol": symbol}

        closes = hist["Close"].tolist()
        highs  = hist["High"].tolist()
        lows   = hist["Low"].tolist()
        dates  = [d.strftime("%Y-%m-%d") for d in hist.index]
        n      = len(closes)

        # ── MA20 / MA50 ──────────────────────────────────────────────────────
        ma20 = float(np.mean(closes[-20:])) if n >= 20 else None
        ma50 = float(np.mean(closes[-50:])) if n >= 50 else None

        # ── Swing points ─────────────────────────────────────────────────────
        points = _detect_swing_points(highs, lows, closes, reversal_pct)

        # ── Segments + stats ─────────────────────────────────────────────────
        segments = _label_segments(points)
        stats    = _cycle_stats(segments)

        # ── Current phase detection ──────────────────────────────────────────
        current_phase = "rally"
        phase_day     = 0

        if points:
            last_pt    = points[-1]
            phase_day  = n - 1 - last_pt["idx"]   # days since last swing point

            # If last swing point is a high → we're in pullback/pause territory
            # If last swing point is a low  → we're in rally territory
            if last_pt["type"] == "high":
                pct_drop = (closes[-1] - last_pt["price"]) / last_pt["price"]
                current_phase = "pause" if abs(pct_drop) < 0.015 else "pullback"
            else:
                current_phase = "rally"

        # ── ATR — scales the entry ladder to this symbol's own volatility ────
        atr = compute_atr(highs, lows, closes) or (max(highs) - min(lows)) * 0.01

        # ── Regime-aware ATR multiples ────────────────────────────────────────
        watch_mult, buy_mult, strong_mult, panic_mult = _regime_atr_mults(regime)

        # VIX overlay: high volatility → widen thresholds further
        if vix >= 30:
            buy_mult    = min(buy_mult + 0.5, 4.0)
            strong_mult = min(strong_mult + 0.5, 5.0)
            panic_mult  = min(panic_mult + 1.0, 7.0)

        # Higher-volatility names anchor the ladder toward MA50 instead of the
        # recent high, blended smoothly by ATR% of price (not a hard cutoff —
        # same reasoning and same config as the main Research hero card, see
        # rules.json._ATR_PRICE_RULES.entry): a large-ATR name that's fallen
        # hard can have a 20d high that was itself a blow-off top, so the
        # trend-following MA50 becomes the better reference as ATR% rises.
        # Calm names (ATR% below the low threshold) keep today's recent-high
        # anchor unchanged.
        _atr_pct_sc   = (atr / closes[-1] * 100) if closes[-1] else 0.0
        _entry_cfg_sc = _rules.get("_ATR_PRICE_RULES", {}).get("entry", {})
        _low_vol_pct_sc  = _entry_cfg_sc.get("anchor_blend_low_vol_atr_pct", 1.5)
        _high_vol_pct_sc = _entry_cfg_sc.get("anchor_blend_high_vol_atr_pct", 5.0)
        if ma50 is not None and _high_vol_pct_sc > _low_vol_pct_sc:
            _ma50_weight_sc = max(0.0, min(1.0, (_atr_pct_sc - _low_vol_pct_sc) / (_high_vol_pct_sc - _low_vol_pct_sc)))
        else:
            _ma50_weight_sc = 0.0

        if _ma50_weight_sc <= 0 or ma50 is None:
            _ladder_anchor       = None   # _price_bands defaults to recent_high internally
            _ladder_anchor_label = "high"
        elif _ma50_weight_sc >= 1:
            _ladder_anchor       = ma50
            _ladder_anchor_label = "ma50"
        else:
            _n20_for_blend  = min(20, len(closes))
            _recent_high_sc = max(closes[-_n20_for_blend:])
            _ladder_anchor       = _ma50_weight_sc * ma50 + (1 - _ma50_weight_sc) * _recent_high_sc
            _ladder_anchor_label = "blend"

        # ── Price bands (regime-adjusted ATR multiples from anchor) ─────────
        bands = _price_bands(
            closes, ma20, ma50, atr, t1_pct, t2_pct, t3_pct, ext_pct,
            watch_atr_mult=watch_mult, buy_atr_mult=buy_mult,
            strong_atr_mult=strong_mult, panic_atr_mult=panic_mult,
            ladder_anchor=_ladder_anchor, anchor_label=_ladder_anchor_label,
        )

        # Buy/strong-buy prices for calendar actions (index 1 = Buy, 2 = Strong Buy)
        ladder = bands["entry_ladder"]
        buy_price    = ladder[1]["price"] if len(ladder) > 1 else 0.0
        strong_price = ladder[2]["price"] if len(ladder) > 2 else 0.0

        # ── Trend age ────────────────────────────────────────────────────────
        trend_age = _trend_age(points, closes, stats)

        # ── Confidence score ─────────────────────────────────────────────────
        confidence = _confidence_score(segments, stats, closes)

        # ── Calendar projection ───────────────────────────────────────────────
        today    = datetime.today()
        calendar = _project_calendar(
            current_phase, phase_day, stats, today,
            horizon_weeks, buy_price, strong_price,
        )

        # ── Pullback probability ──────────────────────────────────────────────
        pullback_segs = [s for s in segments if s["phase"] == "pullback"]
        pullback_prob = round(min(0.80, len(pullback_segs) / max(stats["cycles_analyzed"], 1)), 2)

        # ── Statistical entry window ──────────────────────────────────────────
        rally_med    = stats["rally"]["median"]    or 12
        pause_med    = stats["pause"]["median"]    or 4
        pullback_med = stats["pullback"]["median"] or 6

        days_to_pause    = max(0, rally_med - phase_day) if current_phase == "rally" else 0
        days_to_pullback = (days_to_pause + pause_med) if current_phase == "rally" else \
                           max(0, pause_med - phase_day) if current_phase == "pause" else 0
        days_pb_end      = days_to_pullback + pullback_med

        pb_start    = _business_days_from(today, days_to_pullback)
        pb_end      = _business_days_from(today, days_pb_end)
        stat_window = _fmt_window(pb_start, pb_end) if days_to_pullback >= 0 else "Now"

        # ── Master action ─────────────────────────────────────────────────────
        current_zone = bands["current_zone"]
        zone_actions = {
            "extended":   ("ENTRY DISABLED", "Price too extended — wait for pullback"),
            "no_buy":     ("WAIT",            "Minor pullback only — watch for deeper entry"),
            "watch":      ("WATCH",           f"Approaching Buy zone — watch ${buy_price:.0f}"),
            "buy":        ("BUY",             f"First tranche — {int(t1_pct*100)}% position"),
            "strong_buy": ("STRONG BUY",      f"Preferred entry — {int(t2_pct*100)}% position"),
            "panic_buy":  ("PANIC BUY",       f"Heavy buy — {int(t3_pct*100)}% position"),
        }
        master_action, master_detail = zone_actions.get(
            current_zone, ("WAIT", "No clear signal"))

        # ── Expected edge ─────────────────────────────────────────────────────
        # Backtest the same ATR-derived Buy level used above, expressed as its
        # effective % drop for this symbol (varies by volatility/regime, no
        # longer a fixed 5% for every symbol).
        buy_drop_pct = bands["entry_ladder"][1]["drop_pct"] / 100.0
        edge = _expected_edge(closes, buy_drop_pct, hold_days)

        # ── Phase enrichment ──────────────────────────────────────────────────
        phase_meta = _PHASE_META.get(current_phase, {})
        phase_expected_dur = _phase_expected_duration(current_phase, stats)

        # ── Macro overlay summary ─────────────────────────────────────────────
        regime_label = {
            "EXPANSION":    "Bull — tighter buy levels",
            "CONSOLIDATION":"Neutral — standard levels",
            "RISK-OFF":     "Bear — wider buy levels required",
        }.get(regime.upper(), "Neutral — standard levels")
        vix_label = (
            f"VIX {vix:.0f} — elevated, thresholds widened" if vix >= 30
            else f"VIX {vix:.0f} — normal" if vix > 0
            else "VIX unknown"
        )

        return {
            "symbol":              symbol.upper(),
            "current_price":       round(closes[-1], 2),
            "current_phase":       current_phase,
            "phase_day":           phase_day,
            "phase_pct":           round(
                (closes[-1] - (points[-1]["price"] if points else closes[-1]))
                / max(points[-1]["price"] if points else closes[-1], 1) * 100, 2
            ) if points else 0,
            "ma20":                round(ma20, 2) if ma20 else None,
            "ma50":                round(ma50, 2) if ma50 else None,
            "cycle_stats":         stats,
            "trend_age":           trend_age,
            "confidence":          confidence,
            "stat_entry_window":   stat_window,
            "pullback_probability": pullback_prob,
            "price_bands":         bands,
            "master_action":       master_action,
            "master_detail":       master_detail,
            "phase_meta": {
                "description":      phase_meta.get("description", ""),
                "next_event":       phase_meta.get("next_event", ""),
                "action_hint":      phase_meta.get("action_hint", ""),
                "expected_duration": phase_expected_dur,
            },
            "macro_overlay": {
                "regime":       regime.upper(),
                "regime_label": regime_label,
                "vix":          round(vix, 1) if vix > 0 else None,
                "vix_label":    vix_label,
                "buy_drop_pct":    bands["entry_ladder"][1]["drop_pct"],
                "strong_drop_pct": bands["entry_ladder"][2]["drop_pct"],
                "panic_drop_pct":  bands["entry_ladder"][3]["drop_pct"],
            },
            "expected_edge":       edge,
            "calendar":            calendar,
            "lookback_days":       n,
            "swing_points_found":  len(points),
        }

    except Exception as exc:
        import traceback
        return {
            "error":  str(exc),
            "detail": traceback.format_exc(),
            "symbol": symbol,
        }
