"""
decision_narrate — LLM-narrated "why this status" for a fund decision.

The evaluation engine in `evaluation.py` already produces deterministic prose
(`EtfDecision.summary` + `.explanation`). This module's job is different:
given the same decision payload, produce a TIGHT 2-3 sentence rationale that
focuses specifically on the red/yellow metrics that drove the status. Users
click a fund's status icon → see exactly why it's that colour.

LLM gets a structured view (decision + reds + yellows + key snapshot fields)
and is locked to "summarise the why, don't invent reasons".
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional

import narration

_CACHE_KEY_PREFIX = "decision_narrative:"

_SYSTEM_PROMPT = (
    "You are a portfolio analyst explaining why a fund has been assigned a "
    "specific structural status. "
    "Given the decision payload, write EXACTLY 2-3 short sentences that "
    "explain the status in plain language, naming the specific metrics that "
    "drove it. "
    "Use ONLY the numbers and messages provided. "
    "Do not predict, recommend an action, or speculate about future moves. "
    "No bullets, no markdown."
)


# ── View builder ──────────────────────────────────────────────────────────────

def build_view(symbol: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Compact view of one fund's decision + its red/yellow metric messages."""
    if not symbol:
        return None
    sym = symbol.upper()

    decisions = data.get("decisions") or []
    dec = next((d for d in decisions if (d.get("symbol") or "").upper() == sym), None)
    if not dec:
        return None

    metrics = dec.get("metrics") or {}
    # Each metric is {level: GREEN|YELLOW|RED, message: "..."}. Surface only
    # the not-green ones — that's what drives the status.
    reds: list = []
    yellows: list = []
    for name, m in metrics.items():
        level = (m or {}).get("level")
        msg   = (m or {}).get("message")
        if not msg:
            continue
        if level == "RED":
            reds.append({"metric": name, "message": msg})
        elif level == "YELLOW":
            yellows.append({"metric": name, "message": msg})

    snap = (data.get("snapshots") or {}).get(sym) or {}

    view = {
        "symbol":           sym,
        "overall":          dec.get("overall"),            # GREEN / YELLOW / RED roll-up
        "structural_status": dec.get("structural_status"), # ENGINE_HEALTHY etc.
        "red_metrics":      reds,
        "yellow_metrics":   yellows,
        # Sparse snapshot context — keep small, only what evaluation cares about
        "price":            snap.get("price"),
        "nav":              snap.get("nav"),
        "premium_pct":      snap.get("premium"),
        "vol_30d_annual":   snap.get("vol_30d_annual"),
        "ytd_distribution_yield": snap.get("ytd_distribution_yield"),
    }
    return {k: v for k, v in view.items() if v not in (None, "", [])}


# ── Cache key ─────────────────────────────────────────────────────────────────

def _cache_key(view: Dict[str, Any]) -> str:
    blob = json.dumps(view, sort_keys=True, default=str)
    return _CACHE_KEY_PREFIX + hashlib.sha256(blob.encode()).hexdigest()[:24]


# ── Template fallback ─────────────────────────────────────────────────────────

def _template(view: Dict[str, Any]) -> str:
    sym = view.get("symbol") or "?"
    status = view.get("structural_status") or "UNKNOWN"
    overall = view.get("overall")

    parts = [f"{sym} is rated {status}"]
    if overall and overall != status:
        parts[-1] += f" ({overall} roll-up)"
    parts[-1] += "."

    reds = view.get("red_metrics") or []
    yells = view.get("yellow_metrics") or []
    if reds:
        msgs = "; ".join(r["message"] for r in reds[:2])
        parts.append(f"Critical: {msgs}.")
    if yells:
        msgs = "; ".join(y["message"] for y in yells[:2])
        parts.append(f"Watch: {msgs}.")
    if not reds and not yells:
        parts.append("All structural metrics are within healthy ranges.")
    return " ".join(parts)


# ── Public API ────────────────────────────────────────────────────────────────

def narrate(symbol: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Produce a 2-3 sentence rationale for a fund's decision status.

    Returns the standard narration shape plus the `view` and `status` fields:

        {
          "narrative": str,
          "source":    "llm:..." | "template" | "no_decision",
          "cached":    bool,
          "view":      {...} | None,
          "status":    "GREEN" | "YELLOW" | "RED" | None,  # the overall roll-up
        }
    """
    view = build_view(symbol, data)
    if view is None:
        return {
            "narrative": "", "source": "no_decision",
            "cached": False, "view": None, "status": None,
        }

    out = narration.cached_narrate(
        cache_key=_cache_key(view),
        system_prompt=_SYSTEM_PROMPT,
        user_payload=view,
        max_tokens=200,
        template_fn=lambda: _template(view),
    )
    return {**out, "view": view, "status": view.get("overall")}
