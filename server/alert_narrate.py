"""
alert_narrate — one-line LLM context for a triggered price alert.

The existing alert popup shows the threshold, the triggered price, and any
manual notes. This module adds a single sentence of portfolio context:

    "BLD crossed $250 (your alert level). Up 8% YTD. Sits at 4% of your
     real-estate sleeve."

Numbers all come from `alert`, `snapshot[symbol]`, and the user's holdings —
the LLM only stitches them into prose. Cached by (alert_id + snapshot hash)
so a refresh that doesn't change the underlying numbers hits the cache.

Usage:
    import alert_narrate
    out = alert_narrate.narrate(alert_dict, dashboard_data)
    # → {"narrative": str, "source": "llm:..." | "template", "cached": bool}
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional

import narration

_CACHE_KEY_PREFIX = "alert_narrative:"

_SYSTEM_PROMPT = (
    "You are a portfolio analyst adding context to a triggered price alert. "
    "Given the alert details and a snapshot of the underlying position, write "
    "EXACTLY ONE sentence that explains what just happened and why it matters "
    "for this portfolio. "
    "Use ONLY the numbers provided. "
    "Do not predict, do not recommend, do not add disclaimers."
)


# ── View builder ──────────────────────────────────────────────────────────────

def build_view(alert: Dict[str, Any], data: Dict[str, Any]) -> Dict[str, Any]:
    """Compact JSON view of one alert + its position context."""
    sym = (alert.get("symbol") or "").upper()
    snap = (data.get("snapshots") or {}).get(sym) or {}

    # Aggregate the symbol across accounts (may be in Rollover + Roth + Taxable)
    total_value  = 0.0
    total_shares = 0.0
    for acct in (data.get("accounts") or []):
        for p in (acct.get("positions") or []):
            if (p.get("symbol") or "").upper() == sym:
                total_value  += float(p.get("market_value") or 0)
                total_shares += float(p.get("quantity") or 0)

    summary = data.get("summary") or {}
    portfolio_value = float(summary.get("total_value") or 0)
    weight_pct = (total_value / portfolio_value * 100) if portfolio_value > 0 else 0.0

    view = {
        "symbol":           sym,
        "direction":        alert.get("direction"),
        "threshold":        alert.get("threshold"),
        "triggered_price":  alert.get("triggered_price"),
        "mode":             alert.get("mode"),
        "base_price":       alert.get("base_price"),
        "current_price":    snap.get("price"),
        "ytd_return_pct":   snap.get("ytd_return_pct") or snap.get("ytd"),
        "nav":              snap.get("nav"),
        "premium_pct":      snap.get("premium"),
        "rsi":              snap.get("rsi"),
        "position_value":   round(total_value, 0) if total_value else 0,
        "position_shares":  round(total_shares, 3) if total_shares else 0,
        "position_weight_pct": round(weight_pct, 2),
        "user_note":        alert.get("notes") or None,
    }
    return {k: v for k, v in view.items() if v not in (None, "", 0) or k == "triggered_price"}


# ── Cache key ─────────────────────────────────────────────────────────────────

def _cache_key(alert_id: str, view: Dict[str, Any]) -> str:
    blob = json.dumps({"id": alert_id, "view": view}, sort_keys=True, default=str)
    return _CACHE_KEY_PREFIX + hashlib.sha256(blob.encode()).hexdigest()[:24]


# ── Template fallback ─────────────────────────────────────────────────────────

def _template(view: Dict[str, Any]) -> str:
    sym  = view.get("symbol") or "?"
    dirn = view.get("direction") or "crossed"
    thr  = view.get("threshold")
    trg  = view.get("triggered_price")
    weight = view.get("position_weight_pct")

    parts = [f"{sym} {dirn} its alert level"]
    if thr is not None:
        thr_str = f"${thr:.2f}" if (view.get("mode") != "pct") else f"{thr:+.1f}%"
        parts[-1] += f" of {thr_str}"
    parts[-1] += "."
    if trg is not None:
        parts.append(f"Triggered at ${trg:.2f}.")
    if weight:
        parts.append(f"This position is {weight:.1f}% of the portfolio.")
    return " ".join(parts)


# ── Public API ────────────────────────────────────────────────────────────────

def narrate(alert: Dict[str, Any], data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Produce one-sentence context for a triggered alert. Returns:

        {"narrative": str, "source": "llm:..." | "template", "cached": bool}

    Safe to call without `data` — falls back to the template using just the
    alert fields. Always returns a non-empty narrative.
    """
    data = data or {}
    view = build_view(alert, data)
    return narration.cached_narrate(
        cache_key=_cache_key(alert.get("id", ""), view),
        system_prompt=_SYSTEM_PROMPT,
        user_payload=view,
        max_tokens=120,
        template_fn=lambda: _template(view),
    )
