"""
research_narrate — 3-4 sentence AI summary of a Research deep-dive result.

Unlike position_narrate (which only works for held symbols), this narrates
ANY researched symbol by consuming the pre-computed research payload that
includes quality_engine, action_engine, risk_stats, and portfolio_fit.

The LLM receives a compact structured view; it writes:
  (1) quality tier and headline score
  (2) the action signal and what's driving it
  (3) portfolio-fit context (correlation, income role, whether it's held)

All numbers come from the server — the LLM never derives any.

Usage from server.py:

    import research_narrate
    out = research_narrate.narrate(research_data, portfolio_data)
    # → {"narrative": str, "source": "llm:..." | "template", "cached": bool,
    #    "view": {...}}
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional

import narration

_CACHE_KEY_PREFIX = "research_narrative:"

_SYSTEM_PROMPT = (
    "You are a fund research analyst writing a concise symbol summary. "
    "Given a structured research view of a symbol, write 3-4 short sentences: "
    "(1) the quality tier and what's driving the score, "
    "(2) the current action signal (buy / hold / sell / watch) and why, "
    "(3) how the symbol fits the existing portfolio (correlation, income, weight). "
    "If the symbol is not currently held, note that it is under consideration. "
    "Use ONLY the numbers provided. "
    "Do not predict markets, give investment advice, or invent metrics. "
    "Plain text only — no bullets, no markdown."
)


def build_view(research: Dict[str, Any], portfolio: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Build the compact view the LLM narrates."""
    sym = (research.get("symbol") or "").upper()

    qe  = research.get("quality_engine") or {}
    ae  = (research.get("portfolio_fit") or {}).get("action_engine_overlay") or research.get("action_engine") or {}
    rs  = research.get("risk_stats") or {}
    dist = research.get("distributions") or {}
    pf  = research.get("portfolio_fit") or {}
    sc  = research.get("symbol_class") or {}

    # Is it currently held?
    is_held = False
    weight_pct: Optional[float] = None
    if portfolio:
        total_val = (portfolio.get("summary") or {}).get("total_value") or 0
        for acct in portfolio.get("accounts") or []:
            for p in acct.get("positions") or []:
                if (p.get("symbol") or "").upper() == sym:
                    is_held = True
                    if total_val > 0:
                        mv = float(p.get("market_value") or 0)
                        weight_pct = round(mv / total_val * 100, 2)

    # Correlation guidance from portfolio_fit
    corr_note = None
    corr_guidance = pf.get("correlation_guidance")
    if isinstance(corr_guidance, dict):
        top = corr_guidance.get("top_correlated_holding")
        top_corr = corr_guidance.get("top_correlation")
        if top and top_corr is not None:
            corr_note = f"Highest correlation: {top} ({float(top_corr):.2f})"

    view = {
        "symbol":           sym,
        "fund_type":        sc.get("type"),
        "is_held":          is_held,
        "weight_pct":       weight_pct,
        # Quality engine
        "quality_tier":     qe.get("tier"),
        "quality_score":    qe.get("score"),
        "quality_drivers":  (qe.get("factors") or [])[:3],
        # Action engine
        "action_signal":    ae.get("action"),
        "action_reason":    ae.get("reason"),
        "action_confidence":ae.get("confidence"),
        # Risk
        "sharpe":           rs.get("sharpe"),
        "beta":             rs.get("beta"),
        "max_drawdown":     rs.get("max_drawdown"),
        # Income
        "yield_pct":        (dist.get("forward_yield") or dist.get("ttm_yield") or None),
        "distribution_coverage": dist.get("coverage_ratio"),
        # Portfolio fit
        "income_gap_pct":   pf.get("income_gap_pct"),
        "weight_rec":       pf.get("weight_recommendation"),
        "correlation_note": corr_note,
    }
    return {k: v for k, v in view.items() if v not in (None, "", [], {})}


def _cache_key(view: Dict[str, Any]) -> str:
    blob = json.dumps(view, sort_keys=True, default=str)
    return _CACHE_KEY_PREFIX + hashlib.sha256(blob.encode()).hexdigest()[:24]


def _template(view: Dict[str, Any]) -> str:
    sym   = view.get("symbol") or "?"
    parts = []
    tier  = view.get("quality_tier")
    score = view.get("quality_score")
    if tier or score is not None:
        parts.append(f"{sym} quality tier: {tier or '—'}" + (f" (score {score})" if score is not None else "") + ".")
    action = view.get("action_signal")
    reason = view.get("action_reason")
    if action:
        parts.append(f"Action signal: {action}" + (f" — {reason}" if reason else "") + ".")
    if view.get("is_held") and view.get("weight_pct") is not None:
        parts.append(f"Currently held at {view['weight_pct']:.1f}% portfolio weight.")
    elif not view.get("is_held"):
        parts.append(f"{sym} is not currently in the portfolio.")
    corr = view.get("correlation_note")
    if corr:
        parts.append(corr + ".")
    return " ".join(parts) if parts else f"No research data available for {sym}."


def narrate(research: Dict[str, Any], portfolio: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Produce a 3-4 sentence research summary. Returns:
        {"narrative": str, "source": "llm:..." | "template", "cached": bool, "view": {...}}
    """
    view = build_view(research, portfolio)
    out = narration.cached_narrate(
        cache_key=_cache_key(view),
        system_prompt=_SYSTEM_PROMPT,
        user_payload=view,
        max_tokens=280,
        template_fn=lambda: _template(view),
    )
    return {**out, "view": view}
