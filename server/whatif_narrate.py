"""
whatif_narrate — narrate a sandbox/Monte-Carlo what-if delta in plain English.

The sandbox engine (`simulation_engine.sandbox.run_sandbox`) produces a
baseline-vs-scenario payload with success rates, median outcomes, and a
delta block. This module takes that payload and asks the LLM to write
3-4 short sentences describing the impact in plain language.

Same constraints as everywhere else: the LLM only narrates numbers we
hand it; it never derives new ones.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict

import narration

_CACHE_KEY_PREFIX = "whatif_narrative:"

_SYSTEM_PROMPT = (
    "You are a portfolio analyst summarising the impact of a what-if scenario. "
    "Given a baseline result, a scenario result, the delta between them, and "
    "the overrides that produced the scenario, write 3-4 short sentences: "
    "(1) what changed in the inputs, (2) the impact on success rate and "
    "median outcome, (3) whether the change improved or worsened the "
    "portfolio's resilience. "
    "Use ONLY the numbers provided. "
    "Do not predict, recommend, or invent metrics. No bullets, no markdown."
)


# ── Cache key ─────────────────────────────────────────────────────────────────

def _cache_key(sandbox_result: Dict[str, Any]) -> str:
    """Stable hash over the relevant fields only — ages array is unstable."""
    canon = {
        "baseline":         sandbox_result.get("baseline"),
        "scenario":         sandbox_result.get("scenario"),
        "delta":            sandbox_result.get("delta"),
        "overrides":        sandbox_result.get("overrides"),
        "baseline_inputs":  sandbox_result.get("baseline_inputs"),
        "scenario_inputs":  sandbox_result.get("scenario_inputs"),
    }
    blob = json.dumps(canon, sort_keys=True, default=str)
    return _CACHE_KEY_PREFIX + hashlib.sha256(blob.encode()).hexdigest()[:24]


# ── Template fallback ─────────────────────────────────────────────────────────

def _template(sandbox_result: Dict[str, Any]) -> str:
    base = sandbox_result.get("baseline") or {}
    scen = sandbox_result.get("scenario") or {}
    delta = sandbox_result.get("delta") or {}
    overrides = sandbox_result.get("overrides") or {}

    parts: list = []
    if overrides:
        changes = "; ".join(f"{k}: {v}" for k, v in list(overrides.items())[:3])
        parts.append(f"Scenario: {changes}.")

    base_succ = base.get("overall_success")
    scen_succ = scen.get("overall_success")
    if base_succ is not None and scen_succ is not None:
        delta_pp = (scen_succ - base_succ) * 100
        sign = "+" if delta_pp >= 0 else ""
        parts.append(
            f"Success rate {base_succ*100:.1f}% → {scen_succ*100:.1f}% "
            f"({sign}{delta_pp:.1f} pp)."
        )

    base_med = base.get("median_ending")
    scen_med = scen.get("median_ending")
    if isinstance(base_med, (int, float)) and isinstance(scen_med, (int, float)):
        diff = scen_med - base_med
        sign = "+" if diff >= 0 else ""
        parts.append(
            f"Median ending balance ${base_med:,.0f} → ${scen_med:,.0f} "
            f"({sign}${diff:,.0f})."
        )

    return " ".join(parts) if parts else "No simulation data available."


# ── Public API ────────────────────────────────────────────────────────────────

def narrate(sandbox_result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Produce a 3-4 sentence narrative of a sandbox run.

    Returns:
        {"narrative": str, "source": "llm:..." | "template", "cached": bool}
    """
    if not isinstance(sandbox_result, dict) or "delta" not in sandbox_result:
        return {"narrative": "", "source": "error", "cached": False}

    return narration.cached_narrate(
        cache_key=_cache_key(sandbox_result),
        system_prompt=_SYSTEM_PROMPT,
        user_payload={
            "overrides":      sandbox_result.get("overrides"),
            "baseline":       sandbox_result.get("baseline"),
            "scenario":       sandbox_result.get("scenario"),
            "delta":          sandbox_result.get("delta"),
            "baseline_inputs": sandbox_result.get("baseline_inputs"),
            "scenario_inputs": sandbox_result.get("scenario_inputs"),
        },
        max_tokens=240,
        template_fn=lambda: _template(sandbox_result),
    )
