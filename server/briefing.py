"""
briefing — LLM narration layer over the deterministic signals layer.

Given a list of signals + a diffs dict (from /api/briefing), produces a
short 3-5 sentence prose summary suitable for the AI tab's Advanced view.

Design constraints (deliberate):

  - The LLM NEVER computes numbers. It receives pre-computed signals and
    diffs as structured JSON and is instructed to summarise without
    calculating, predicting, or recommending. This eliminates the
    "LLM hallucinates a stat" failure mode.

  - Narration is cached keyed on a content hash of (signals, diffs). If the
    user opens the AI tab repeatedly without a refresh, we call the LLM
    exactly once. The cache lives in db_manager.cache_kv (TTL handled
    implicitly — the hash changes when signals change).

  - Three fallback rungs:
      1. Local Ollama (preferred — free, private, fast on a warm model)
      2. Cloud (OpenRouter) if a key is configured
      3. Template (deterministic prose built from signals + diffs)
    The API contract is "narrative is always a string"; clients never
    receive `null` from this module.

  - The output dict includes `source` ('llm:<model>' | 'template') so the
    frontend can show a small hint when the LLM didn't run.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List

import narration

# Module-level system prompt. Locked down to "summarise, don't compute".
_SYSTEM_PROMPT = (
    "You are a portfolio briefing writer. "
    "Given a structured list of signals and a diffs object, write 3-5 short sentences "
    "summarising the day's portfolio state. "
    "Use ONLY the numbers provided. "
    "CRITICAL time-period rules: "
    "'day_change_pct' is TODAY's portfolio move only. "
    "Signal headlines reference total/unrealized position metrics — "
    "never describe a signal headline dollar amount as today's gain or loss. "
    "Do not compute, predict, or recommend. "
    "Do not add advice or disclaimers. "
    "Plain text only — no bullets, no markdown."
)

_CACHE_KEY_PREFIX = "briefing_narrative:"


# ── Public API ────────────────────────────────────────────────────────────────

def narrate(signals: List[Dict[str, Any]], diffs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Produce a narrative summary for the given signals + diffs.

    Returns:
        {
          "narrative": str,           # always a non-empty string
          "source":    str,           # "llm:<model>" | "template"
          "cached":    bool,          # True if served from cache_kv
        }
    """
    return narration.cached_narrate(
        cache_key=_cache_key(signals, diffs),
        system_prompt=_SYSTEM_PROMPT,
        user_payload={"signals": signals, "diffs": diffs},
        max_tokens=300,
        template_fn=lambda: _template(signals, diffs),
    )


# ── Cache key ─────────────────────────────────────────────────────────────────

def _cache_key(signals: List[Dict[str, Any]], diffs: Dict[str, Any]) -> str:
    """
    Stable hash over the inputs. We deliberately include only the fields the
    LLM actually sees so that adding new keys to a signal/diff (without changing
    the user-visible content) doesn't invalidate the cache.
    """
    canon_signals = [
        {
            "kind":             s.get("kind"),
            "symbol":           s.get("symbol"),
            "severity":         s.get("severity"),
            "headline":         s.get("headline"),
            "headline_context": "total_or_unrealized_position_metric__not_todays_move",
        }
        for s in (signals or [])
    ]
    canon_diffs = {k: diffs.get(k) for k in sorted((diffs or {}).keys())}
    blob = json.dumps({"s": canon_signals, "d": canon_diffs}, sort_keys=True, default=str)
    return _CACHE_KEY_PREFIX + hashlib.sha256(blob.encode()).hexdigest()[:24]


# ── Template fallback ─────────────────────────────────────────────────────────

def _template(signals: List[Dict[str, Any]], diffs: Dict[str, Any]) -> str:
    """
    Deterministic prose built from the same inputs the LLM would see. Used when
    no LLM is reachable. Stays close to what a tuned LLM prompt would emit.
    """
    sigs = signals or []
    diffs = diffs or {}
    crit = [s for s in sigs if s.get("severity") == "crit"]
    warn = [s for s in sigs if s.get("severity") == "warn"]

    parts: List[str] = []

    if not crit and not warn:
        parts.append("No critical or warning signals today.")
    else:
        if crit:
            parts.append(
                f"{len(crit)} critical signal" + ("s" if len(crit) > 1 else "") + ": "
                + "; ".join(s.get("headline", "") for s in crit) + "."
            )
        if warn:
            parts.append(
                f"{len(warn)} warning" + ("s" if len(warn) > 1 else "") + ": "
                + "; ".join(s.get("headline", "") for s in warn) + "."
            )

    move = diffs.get("day_change_pct")
    if isinstance(move, (int, float)) and abs(move) > 0.001:
        parts.append(f"Portfolio {'+' if move >= 0 else ''}{move:.2f}% today.")

    # ── vs yesterday (only when analytics_history has a prior snapshot) ──
    vy = diffs.get("vs_yesterday") or {}
    vb = vy.get("vol_budget_used")
    if isinstance(vb, dict) and vb.get("delta") not in (None, 0):
        parts.append(f"Vol budget {vb['prev']:.0f} → {vb['curr']:.0f}.")
    fr = vy.get("fragility_score")
    if isinstance(fr, dict) and fr.get("delta") not in (None, 0):
        parts.append(f"Fragility {fr['prev']} → {fr['curr']}.")
    elif diffs.get("fragility_score") is not None and diffs.get("fragility_level"):
        # Fall back to current-only label when no prior snapshot exists.
        parts.append(f"Fragility {diffs['fragility_score']} ({diffs['fragility_level']}).")

    vol_regime = diffs.get("vol_regime")
    if vol_regime and vol_regime != "NORMAL":
        parts.append(f"Vol regime: {vol_regime}.")

    return " ".join(parts) if parts else "No portfolio data available."
