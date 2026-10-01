"""
sim_portfolio/swing.py — Swing Trading Analysis Engine

Computes technical signals for swing-trade suitability:
  - RSI(14), ATR(14), MA20, MA50, trend detection
  - Pullback % from recent high
  - Volume ratio vs 20-day average
  - Symbol Score (0-5): how worthy the symbol is for swing trading
  - Entry Signal: is timing right now?
  - Setup score (0-100) with entry/stop/target prices
  - Context scores: LCS / TCS / RCS
  - CRUD for saved swing setups (per portfolio, in sim_portfolios.db)
"""

from __future__ import annotations
import json
import math
import os
from typing import Any, Dict, List, Optional

# ── DB helpers ─────────────────────────────────────────────────────────────────
from .db import _commit, _cur

# ── Rules loader ───────────────────────────────────────────────────────────────
def _load_rules() -> dict:
    try:
        path = os.path.join(os.path.dirname(__file__), "..", "rules.json")
        with open(os.path.normpath(path)) as f:
            return json.load(f)
    except Exception:
        return {}

_rules = _load_rules()
_vr    = _rules.get("_VOLUME_RULES",   {})
_vs    = _rules.get("_VOLUME_SCORING", {})
_apr   = _rules.get("_ATR_PRICE_RULES", {}).get("swing", {})


def _ensure_table() -> None:
    """Create swing_setups table if missing; migrate older tables to add new columns."""
    c = _cur()
    c.execute("""
        CREATE TABLE IF NOT EXISTS swing_setups (
            setup_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id  INTEGER NOT NULL,
            symbol        TEXT    NOT NULL,
            timeframe     TEXT    NOT NULL DEFAULT '1d',
            entry_price   REAL    NOT NULL,
            stop_loss     REAL    NOT NULL,
            take_profit   REAL    NOT NULL,
            buy_trigger   REAL,
            sell_trigger  REAL,
            shares        REAL    NOT NULL DEFAULT 0,
            signal_score  INTEGER NOT NULL DEFAULT 0,
            status        TEXT    NOT NULL DEFAULT 'WATCHING',
            triggered     TEXT,
            notes         TEXT    NOT NULL DEFAULT '',
            created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
            closed_at     TEXT,
            closed_price  REAL
        )
    """)
    # Migrate: add columns if table already exists without them
    existing = {row[1] for row in c.execute("PRAGMA table_info(swing_setups)")}
    migrations = [
        ("buy_trigger",  "REAL"),
        ("sell_trigger", "REAL"),
        ("triggered",    "TEXT"),
        ("timeframe",    "TEXT NOT NULL DEFAULT '1d'"),
    ]
    for col, defn in migrations:
        if col not in existing:
            c.execute(f"ALTER TABLE swing_setups ADD COLUMN {col} {defn}")
    # Copy interval → timeframe for rows created before migration
    if "interval" in existing and "timeframe" not in existing:
        c.execute("UPDATE swing_setups SET timeframe = interval WHERE timeframe IS NULL")
    _commit()


# ── Technical indicator helpers ────────────────────────────────────────────────

def _compute_rsi(closes: List[float], period: int = 14) -> float:
    """Wilder RSI."""
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains  = [max(d, 0.0) for d in deltas]
    losses = [abs(min(d, 0.0)) for d in deltas]
    avg_g  = sum(gains[:period]) / period
    avg_l  = sum(losses[:period]) / period
    for i in range(period, len(deltas)):
        avg_g = (avg_g * (period - 1) + gains[i])  / period
        avg_l = (avg_l * (period - 1) + losses[i]) / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100.0 - (100.0 / (1.0 + rs))


def _compute_ma(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def _detect_trend(price: float, ma20: Optional[float],
                  ma50: Optional[float]) -> str:
    if ma20 is None:
        return "insufficient_data"
    if ma50 is None:
        return "uptrend" if price > ma20 else "downtrend"
    if price > ma20 and ma20 > ma50:
        return "uptrend"
    if price < ma20 and ma20 < ma50:
        return "downtrend"
    return "sideways"


# ── Core analysis ──────────────────────────────────────────────────────────────

def analyze_swing(symbol: str, interval: str = "1d") -> Dict[str, Any]:
    """
    Fetch OHLCV data and compute full swing-trade analysis.
    Returns a dict ready to JSON-serialise.
    """
    try:
        import yfinance as yf
        import numpy as np
    except ImportError:
        return {"error": "yfinance not installed"}

    # Map interval → yfinance period
    _period_map = {
        "5m":  "5d",
        "15m": "5d",
        "30m": "10d",
        "1h":  "30d",
        "1d":  "90d",
    }
    period = _period_map.get(interval, "90d")

    try:
        tk   = yf.Ticker(symbol)
        hist = tk.history(period=period, interval=interval)
        if hist.empty:
            return {"error": f"No data returned for {symbol}"}

        closes  = hist["Close"].tolist()
        opens   = hist["Open"].tolist()
        highs   = hist["High"].tolist()
        lows    = hist["Low"].tolist()
        volumes = hist["Volume"].tolist()

        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
        from price_utils import ticker_metrics as _tm
        from atr_utils import compute_atr as _compute_atr
        _pm       = _tm(hist["Close"])
        price     = _pm.get('price',      closes[-1])
        prev_close = _pm.get('prev_close', closes[-2] if len(closes) > 1 else closes[-1])
        change_pct = _pm.get('change_pct', 0.0)

        # ── Indicators ──────────────────────────────────────────────────────
        rsi  = _compute_rsi(closes)
        atr  = _compute_atr(highs, lows, closes) or (max(highs) - min(lows)) * 0.01
        ma20 = _compute_ma(closes, 20)
        ma50 = _compute_ma(closes, 50)
        trend = _detect_trend(price, ma20, ma50)

        # Pullback from 20-bar high
        n20 = min(20, len(closes))
        recent_high = max(closes[-n20:]) if n20 > 0 else price
        pullback_pct = (recent_high - price) / recent_high * 100 if recent_high > 0 else 0.0

        # Volume ratio (current vs 20-bar avg)
        n_vol = min(20, len(volumes) - 1)
        avg_vol = float(np.mean(volumes[-n_vol:])) if n_vol > 0 else volumes[-1]
        vol_ratio = volumes[-1] / avg_vol if avg_vol > 0 else 1.0

        # ── Volume primitives (_VOLUME_RULES) ───────────────────────────────
        _vt  = _vr.get("volume_trend",    {})
        _spk = _vr.get("spike_definition", {})
        _rvl = _vr.get("relative_volume",  {})

        up_thresh   = _vt.get("up_threshold",   1.10)
        down_thresh = _vt.get("down_threshold",  0.90)

        # Trend: recent 5 bars vs prior 5 bars
        if len(volumes) >= 10:
            rec5 = float(np.mean(volumes[-5:]))
            pri5 = float(np.mean(volumes[-10:-5]))
            vol_trend = "up" if rec5 > pri5 * up_thresh else "down" if rec5 < pri5 * down_thresh else "flat"
        else:
            vol_trend = "flat"

        # Spike: RVOL ≥ spike_definition.rvol_min AND highest in last lookback_bars
        spike_rvol_min  = _spk.get("rvol_min",      2.00)
        spike_lookback  = _spk.get("lookback_bars",   10)
        n_lookback      = min(spike_lookback, len(volumes))
        vol_spike       = bool(vol_ratio >= spike_rvol_min and volumes[-1] == max(volumes[-n_lookback:]))

        # Regime label
        cap_min = _rvl.get("capitulation_min", 2.00)
        brk_min = _rvl.get("breakout_min",     1.50)
        vol_regime = "extreme" if vol_ratio >= cap_min else "elevated" if vol_ratio >= brk_min else "normal"

        # Is price below MA20? (used in distribution detection)
        below_ma20 = (ma20 is not None and price < ma20)

        # ── Symbol Score (0-5) — worthiness ─────────────────────────────────
        symbol_score = 0
        score_reasons: List[str] = []

        # Criterion 1: Trend aligned (uptrend preferred)
        if trend == "uptrend":
            symbol_score += 1
            score_reasons.append("✅ Uptrend confirmed (price > MA20 > MA50)")
        elif trend == "sideways":
            score_reasons.append("⚠️ Sideways — no clear direction")
        else:
            score_reasons.append("❌ Downtrend — risky for longs")

        # Criterion 2: RSI in buyable zone (30–65)
        if 30 <= rsi <= 65:
            symbol_score += 1
            score_reasons.append(f"✅ RSI {rsi:.1f} in swing zone (30-65)")
        elif rsi < 30:
            symbol_score += 1  # oversold bounce opportunity
            score_reasons.append(f"⚠️ RSI {rsi:.1f} oversold — bounce play")
        else:
            score_reasons.append(f"❌ RSI {rsi:.1f} overbought — wait for pullback")

        # Criterion 3: Healthy pullback (0.5–8%)
        if 0.5 <= pullback_pct <= 8:
            symbol_score += 1
            score_reasons.append(f"✅ Pullback {pullback_pct:.1f}% — good entry zone")
        elif pullback_pct < 0.5:
            score_reasons.append("⚠️ At/near high — wait for dip")
        else:
            score_reasons.append(f"⚠️ Pullback {pullback_pct:.1f}% — deep, check support")

        # Criterion 4: Volume quality (RVOL + trend; rising vol on pullback = distribution risk)
        distributional = vol_trend == "up" and pullback_pct >= 1.0
        if vol_ratio <= cap_min and not distributional:
            symbol_score += 1
            if vol_trend == "down" and pullback_pct >= 1.0:
                score_reasons.append(f"✅ Volume {vol_ratio:.1f}x avg — declining on pullback (healthy)")
            else:
                score_reasons.append(f"✅ Volume {vol_ratio:.1f}x avg — orderly")
        elif vol_ratio > cap_min:
            score_reasons.append(f"⚠️ High volume {vol_ratio:.1f}x avg — potential exhaustion")
        else:
            score_reasons.append(f"⚠️ Volume {vol_ratio:.1f}x avg rising on pullback — distribution risk")

        # Criterion 5: ATR/price ratio (volatility suitable for swing: 0.5–5%)
        atr_pct = (atr / price) * 100 if price > 0 else 0
        if 0.5 <= atr_pct <= 5.0:
            symbol_score += 1
            score_reasons.append(f"✅ ATR {atr_pct:.1f}% of price — good swing range")
        elif atr_pct < 0.5:
            score_reasons.append("⚠️ Low volatility — small swing potential")
        else:
            score_reasons.append(f"⚠️ High volatility {atr_pct:.1f}% — size position carefully")

        score_labels = ["Avoid", "Weak", "Neutral", "Moderate", "Good", "Strong"]
        symbol_interpretation = score_labels[min(symbol_score, 5)]

        # ── Entry Signal — is NOW a good entry? ─────────────────────────────
        entry_conditions_met:     List[str] = []
        entry_conditions_missing: List[str] = []

        if trend == "uptrend":
            entry_conditions_met.append("Uptrend")
        else:
            entry_conditions_missing.append("Uptrend needed")

        if 30 <= rsi <= 55:
            entry_conditions_met.append(f"RSI sweet spot ({rsi:.0f})")
        elif rsi < 30:
            entry_conditions_met.append(f"Oversold RSI ({rsi:.0f}) — bounce candidate")
        else:
            entry_conditions_missing.append(f"RSI too high ({rsi:.0f})")

        if 1 <= pullback_pct <= 6:
            entry_conditions_met.append(f"Pullback {pullback_pct:.1f}%")
        elif pullback_pct > 6:
            entry_conditions_missing.append("Pullback too deep")
        else:
            entry_conditions_missing.append("No pullback yet")

        # Volume gate (uses _VOLUME_RULES.entry_gate thresholds)
        _eg          = _vr.get("entry_gate", {})
        gate_rvol    = _eg.get("disable_if_rvol_above",       brk_min)
        gate_low_liq = _rvl.get("low_liquidity_max",            0.50)
        if vol_ratio >= gate_rvol and below_ma20 and _eg.get("disable_requires_below_ma20", True):
            entry_conditions_missing.append(f"High volume ({vol_ratio:.1f}x) below MA20 — distribution risk")
        elif vol_trend == "down" and pullback_pct >= 1.0:
            entry_conditions_met.append(f"Volume declining on pullback ({vol_ratio:.1f}x) — healthy")
        elif vol_ratio < gate_low_liq:
            entry_conditions_missing.append(f"Low volume ({vol_ratio:.1f}x)")
        else:
            entry_conditions_met.append(f"Volume OK ({vol_ratio:.1f}x avg)")

        entry_signal = 1 if len(entry_conditions_met) >= 3 else 0
        entry_score  = len(entry_conditions_met) / max(len(entry_conditions_met) + len(entry_conditions_missing), 1)

        if entry_signal == 1:
            signal_text = "ENTRY SIGNAL"
            signal_icon = "🟢"
        elif entry_score >= 0.5:
            signal_text = "WATCH — ALMOST THERE"
            signal_icon = "🟡"
        else:
            signal_text = "NO SIGNAL — WAIT"
            signal_icon = "🔴"

        # ── Setup score (0-100) and price levels ─────────────────────────────
        raw_score = 0
        if trend == "uptrend":             raw_score += 30
        elif trend == "sideways":          raw_score += 10
        if 30 <= rsi <= 50:                raw_score += 25
        elif 50 < rsi <= 65:               raw_score += 15
        elif rsi < 30:                     raw_score += 20   # oversold bounce
        if 1 <= pullback_pct <= 5:         raw_score += 20
        elif 0.5 <= pullback_pct <= 8:     raw_score += 10
        _ss = _vs.get("setup_score", {})
        _ss_norm_min = _ss.get("rvol_normal_min",    0.80)
        _ss_norm_max = _ss.get("rvol_normal_max",    1.50)
        _ss_pts_norm = _ss.get("rvol_normal_points",   15)
        _ss_pts_thin = _ss.get("rvol_thin_points",      8)
        _ss_pts_elev = _ss.get("rvol_elevated_points",  5)
        _ss_pts_clim = _ss.get("rvol_climactic_points", 0)
        _ss_pts_pb   = _ss.get("pullback_trend_bonus",  5)

        if _ss_norm_min <= vol_ratio <= _ss_norm_max:
            raw_score += _ss_pts_norm
        elif vol_ratio < _ss_norm_min:
            raw_score += _ss_pts_thin
        elif vol_ratio <= cap_min:
            raw_score += _ss_pts_elev
        else:
            raw_score += _ss_pts_clim   # climactic — no credit
        if vol_trend == "down" and pullback_pct >= 1.0:
            raw_score += _ss_pts_pb    # healthy pullback volume confirmation
        if 0.5 <= atr_pct <= 3:            raw_score += 10
        setup_score = min(raw_score, 100)

        # ── Volume gates (_VOLUME_RULES effects) ────────────────────────────
        panic_min = _rvl.get("panic_exit_min", 3.00)
        vol_exit_urgency = (
            "panic"  if vol_ratio >= panic_min else
            "high"   if vol_ratio >= cap_min   else
            "normal"
        )

        strong_pb_min = _eg.get("strong_pullback_min_pct",  7.0)
        strong_pb_max = _eg.get("strong_pullback_max_pct", 12.0)
        if vol_ratio >= gate_rvol and below_ma20 and _eg.get("disable_requires_below_ma20", True):
            vol_entry_gate = "closed"    # distributional volume below MA20
        elif vol_trend == "down" and strong_pb_min <= pullback_pct <= strong_pb_max:
            vol_entry_gate = "strong"    # volume drying up + healthy dip = ideal
        else:
            vol_entry_gate = "open"

        # Confidence delta (applied to setup_score)
        _cd = _vs.get("confidence_delta", {})
        pb1_min = _rvl.get("pullback_max",  1.00)
        if vol_ratio < pb1_min:
            vol_confidence_delta = _cd.get("rvol_below_1_delta",    5)
        elif vol_ratio <= brk_min:
            vol_confidence_delta = _cd.get("rvol_1_to_1_5_delta",   0)
        elif vol_ratio <= cap_min:
            vol_confidence_delta = _cd.get("rvol_above_1_5_delta", -5)
        else:
            vol_confidence_delta = _cd.get("rvol_above_2_delta",  -10)
        setup_score = min(100, max(0, setup_score + vol_confidence_delta))

        # Entry: ATR-scaled pullback below current for pullback setups; at
        # current if already pulled back. ATR-scaled (not a flat %) so the
        # suggested discount scales with how much this symbol actually moves.
        if pullback_pct >= 2:
            entry_price = price  # already in pullback — enter now
        else:
            entry_price = price - (_apr.get("entry_pullback_atr_mult", 0.5) * atr)

        # Stop: config-driven ATR multiple below entry
        stop_loss   = entry_price - (_apr.get("stop_atr_mult", 1.5) * atr)

        # Target: config-driven risk-reward multiple
        risk        = entry_price - stop_loss
        take_profit = entry_price + (risk * _apr.get("target_rr_multiple", 2.0))

        # Risk/Reward ratio
        rr_ratio = (take_profit - entry_price) / (entry_price - stop_loss) if (entry_price - stop_loss) > 0 else 0

        # Signal type label
        if trend == "uptrend" and 30 <= rsi <= 50:
            signal_type = "Pullback to MA — Momentum Continuation"
        elif rsi < 35:
            signal_type = "Oversold Bounce — Mean Reversion"
        elif trend == "uptrend" and pullback_pct >= 3:
            signal_type = "Dip Buy — Trend Continuation"
        else:
            signal_type = "Speculative Setup"

        # Final decision
        is_buyable = setup_score >= 55 and entry_signal == 1
        if is_buyable:
            final_decision = f"✅ BUY — Score {setup_score}/100 | {signal_type}"
        elif setup_score >= 45:
            final_decision = f"👀 WATCH — Score {setup_score}/100 | Wait for better entry"
        else:
            final_decision = f"❌ AVOID — Score {setup_score}/100 | Conditions not met"

        # ── Context Scores ───────────────────────────────────────────────────
        # LCS: Liquidity Confidence Score (volume-based)
        if vol_ratio >= 1.5:      lcs = 85
        elif vol_ratio >= 0.8:    lcs = 65
        else:                     lcs = 35

        # TCS: Trend Confirmation Score (MA alignment)
        if trend == "uptrend" and ma20 and ma50:
            tcs_raw = min(100, int((ma20 - ma50) / ma50 * 1000 + 60))
            tcs = max(10, min(tcs_raw, 90))
        elif trend == "sideways":
            tcs = 45
        else:
            tcs = 20

        # RCS: Risk Compression Score (tighter ATR = less risk per $ risked)
        if atr_pct < 1.0:         rcs = 80
        elif atr_pct < 2.0:       rcs = 65
        elif atr_pct < 3.5:       rcs = 50
        else:                     rcs = 30

        # ── Recommendation text ──────────────────────────────────────────────
        if is_buyable:
            recommendation = (
                f"Consider entering near ${entry_price:.2f} with a stop at ${stop_loss:.2f} "
                f"({((entry_price - stop_loss) / entry_price * 100):.1f}% risk). "
                f"Target ${take_profit:.2f} for {rr_ratio:.1f}:1 R/R. "
                f"RSI at {rsi:.0f} in sweet spot. {signal_type}."
            )
        elif setup_score >= 45:
            recommendation = (
                f"Setup is forming but not quite there. "
                f"Watch for RSI to cool or price to pull back another "
                f"{max(0, 2 - pullback_pct):.1f}% toward ${entry_price:.2f}. "
                f"Trend is {trend}. Check again in 1-2 sessions."
            )
        else:
            recommendation = (
                f"Current conditions don't support a swing entry. "
                f"RSI {rsi:.0f}, pullback {pullback_pct:.1f}%, trend {trend}. "
                f"Wait for a cleaner setup or consider a different symbol."
            )

        # ── Bars for chart rendering (last 60 bars) ──────────────────────────
        n_bars = min(60, len(closes))
        bars = [
            {
                "o": round(opens[-(n_bars - i)],  4),
                "h": round(highs[-(n_bars - i)],  4),
                "l": round(lows[-(n_bars - i)],   4),
                "c": round(closes[-(n_bars - i)],  4),
                "v": int(volumes[-(n_bars - i)]),
            }
            for i in range(n_bars)
        ]

        return {
            "symbol":        symbol,
            "timeframe":     interval,
            "price":         round(price, 4),
            "prev_close":    round(prev_close, 4),
            "change_pct":    round(change_pct, 3),
            "rsi":           round(rsi, 2),
            "atr":           round(atr, 4),
            "atr_pct":       round(atr_pct, 2),
            "ma20":          round(ma20, 4) if ma20 else None,
            "ma50":          round(ma50, 4) if ma50 else None,
            "trend":         trend,
            "pullback_pct":  round(pullback_pct, 2),
            "recent_high":   round(recent_high, 4),
            "vol_ratio":           round(vol_ratio, 2),
            "vol_trend":           vol_trend,
            "vol_spike":           vol_spike,
            "vol_regime":          vol_regime,
            "vol_entry_gate":      vol_entry_gate,
            "vol_exit_urgency":    vol_exit_urgency,
            "vol_confidence_delta": vol_confidence_delta,
            "symbol_score":  symbol_score,
            "symbol_interpretation": symbol_interpretation,
            "score_reasons": score_reasons,
            "entry_signal":  entry_signal,
            "signal_text":   signal_text,
            "signal_icon":   signal_icon,
            "signal_type":   signal_type,
            "entry_conditions_met":     entry_conditions_met,
            "entry_conditions_missing": entry_conditions_missing,
            "setup_score":   setup_score,
            "entry_price":   round(entry_price, 4),
            "stop_loss":     round(stop_loss, 4),
            "take_profit":   round(take_profit, 4),
            "rr_ratio":      round(rr_ratio, 2),
            "is_buyable":    is_buyable,
            "final_decision": final_decision,
            "recommendation": recommendation,
            "context_scores": {"LCS": lcs, "TCS": tcs, "RCS": rcs},
            "bars":          bars,
            "bar_count":     len(bars),
        }

    except Exception as exc:
        return {"error": str(exc), "symbol": symbol}


# ── Swing Setup CRUD ───────────────────────────────────────────────────────────

def get_swing_setups(portfolio_id: int) -> List[Dict[str, Any]]:
    _ensure_table()
    c    = _cur()
    rows = c.execute("""
        SELECT setup_id, portfolio_id, symbol, timeframe,
               entry_price, stop_loss, take_profit,
               buy_trigger, sell_trigger,
               shares, signal_score, status, triggered, notes,
               created_at, closed_at, closed_price
        FROM swing_setups
        WHERE portfolio_id = ?
        ORDER BY created_at DESC
    """, (portfolio_id,)).fetchall()
    return [
        {
            "setup_id":     r[0],  "portfolio_id": r[1],
            "symbol":       r[2],  "timeframe":    r[3],
            "entry_price":  r[4],  "stop_loss":    r[5],
            "take_profit":  r[6],
            "buy_trigger":  r[7],  "sell_trigger": r[8],
            "shares":       r[9],  "signal_score": r[10],
            "status":       r[11], "triggered":    r[12],
            "notes":        r[13], "created_at":   r[14],
            "closed_at":    r[15], "closed_price": r[16],
        }
        for r in rows
    ]


def add_swing_setup(portfolio_id: int, symbol: str, timeframe: str,
                    entry_price: float, stop_loss: float,
                    take_profit: float,
                    buy_trigger: Optional[float] = None,
                    sell_trigger: Optional[float] = None,
                    shares: float = 0,
                    signal_score: int = 0, notes: str = "") -> int:
    _ensure_table()
    c = _cur()
    c.execute("""
        INSERT INTO swing_setups
          (portfolio_id, symbol, timeframe, entry_price, stop_loss,
           take_profit, buy_trigger, sell_trigger,
           shares, signal_score, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WATCHING', ?)
    """, (portfolio_id, symbol.upper(), timeframe,
          entry_price, stop_loss, take_profit,
          buy_trigger, sell_trigger,
          shares, signal_score, notes))
    sid = c.lastrowid
    _commit()
    return sid


def update_swing_setup(setup_id: int, updates: Dict[str, Any]) -> None:
    """Update status, triggers, shares, notes, or close a setup."""
    _ensure_table()
    allowed = {"status", "shares", "notes", "buy_trigger", "sell_trigger",
               "triggered", "closed_at", "closed_price"}
    fields  = {k: v for k, v in updates.items() if k in allowed}
    if not fields:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [setup_id]
    _cur().execute(f"UPDATE swing_setups SET {set_clause} WHERE setup_id = ?", vals)
    _commit()


def delete_swing_setup(setup_id: int) -> None:
    _ensure_table()
    _cur().execute("DELETE FROM swing_setups WHERE setup_id = ?", (setup_id,))
    _commit()
