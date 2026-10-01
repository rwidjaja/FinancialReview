"""
position_narrate — 3-line LLM summary for one holding.

Given a symbol and the current dashboard payload, builds a compact
JSON view of the position (weight, gain/loss, technicals, structural
decision, fund-config metadata) and asks the LLM to narrate it.

Constraints (same as briefing.narrate):
  - LLM only narrates pre-computed values; it never derives new numbers
  - Cache keyed on (symbol + snapshot hash) so a refresh that leaves the
    relevant fields unchanged hits the cache
  - Template fallback when no LLM is reachable

Usage from server.py:

    import position_narrate
    out = position_narrate.narrate(symbol, cached_data)
    # → {"narrative": str, "source": "llm:..." | "template", "cached": bool,
    #    "view": {...}  ← the structured payload the LLM saw}
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional

import narration

_CACHE_KEY_PREFIX = "position_narrative:"

_SYSTEM_PROMPT = (
    "You are a portfolio analyst writing a position note. "
    "Given a structured view of one holding, write 3 short sentences: "
    "(1) its size and gain/loss, (2) how it's behaving (technicals, premium/"
    "discount, structural status), (3) one observation about its role in the "
    "portfolio. "
    "Use ONLY the numbers provided. "
    "Do not compute, predict, or recommend. "
    "No bullets, no markdown, no disclaimers."
)


# ── View builder ──────────────────────────────────────────────────────────────

def build_view(symbol: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Assemble the structured payload the LLM (and the frontend) see for one
    symbol. Returns None if the symbol isn't held anywhere.

    Aggregates per-position numbers across accounts (a symbol may appear in
    Rollover, Roth, and Taxable). Pulls per-symbol analytics from
    `snapshots` and `decisions`.
    """
    if not symbol:
        return None
    sym = symbol.upper()

    # ── Position aggregation across accounts ────────────────────────────────
    accounts = data.get("accounts") or []
    total_value = 0.0
    total_cost = 0.0
    total_shares = 0.0
    annual_income = 0.0
    day_change = 0.0
    acct_count = 0
    held = False
    for acct in accounts:
        for p in acct.get("positions") or []:
            if (p.get("symbol") or "").upper() != sym:
                continue
            held = True
            acct_count += 1
            total_value  += float(p.get("market_value") or 0)
            total_cost   += float(p.get("cost_basis")   or 0)
            total_shares += float(p.get("quantity")     or 0)
            annual_income += float(p.get("annual_income") or 0)
            day_change   += float(p.get("day_change")   or 0)
    if not held:
        return None

    pnl     = total_value - total_cost
    pnl_pct = (pnl / total_cost * 100) if total_cost > 0 else 0.0

    # ── Snapshot (analytics) ────────────────────────────────────────────────
    snap = (data.get("snapshots") or {}).get(sym) or {}

    # ── Structural decision ─────────────────────────────────────────────────
    decisions = data.get("decisions") or []
    dec = next((d for d in decisions if (d.get("symbol") or "").upper() == sym), None)

    # ── Portfolio context ───────────────────────────────────────────────────
    summary = data.get("summary") or {}
    portfolio_value = float(summary.get("total_value") or 0)
    weight_pct = (total_value / portfolio_value * 100) if portfolio_value > 0 else 0.0

    fund_cfg = (data.get("fund_configs") or {}).get(sym) or {}

    # Strip None and empty-string fields to keep the LLM prompt tight.
    view = {
        "symbol":          sym,
        "weight_pct":      round(weight_pct, 2),
        "market_value":    round(total_value, 0),
        "shares":          round(total_shares, 3),
        "cost_basis":      round(total_cost, 0),
        "pnl":             round(pnl, 0),
        "pnl_pct":         round(pnl_pct, 2),
        "day_change":      round(day_change, 2),
        "annual_income":   round(annual_income, 0),
        "account_count":   acct_count,
        # Snapshot fields are optional — only include if non-null
        "price":           snap.get("price"),
        "nav":             snap.get("nav"),
        "premium_pct":     snap.get("premium"),
        "rsi":             snap.get("rsi"),
        "beta":            snap.get("beta"),
        "vol_30d_annual":  snap.get("vol_30d_annual"),
        "trend":           snap.get("trend"),
        "above_200ma_pct": snap.get("above_200ma_pct"),
        # Structural / decision
        "fund_type":       fund_cfg.get("FUND_TYPE"),
        "structural":      (dec or {}).get("structural_status"),
        "action":          (dec or {}).get("action"),
    }
    return {k: v for k, v in view.items() if v not in (None, "")}


# ── Cache key (stable hash over the view) ────────────────────────────────────

def _cache_key(view: Dict[str, Any]) -> str:
    blob = json.dumps(view, sort_keys=True, default=str)
    return _CACHE_KEY_PREFIX + hashlib.sha256(blob.encode()).hexdigest()[:24]


# ── Template fallback ─────────────────────────────────────────────────────────

def _template(view: Dict[str, Any]) -> str:
    sym = view.get("symbol") or "?"
    parts = []
    weight = view.get("weight_pct")
    value  = view.get("market_value")
    if weight is not None and value is not None:
        parts.append(f"{sym} is {weight:.1f}% of the portfolio (${value:,.0f}).")

    pnl_pct = view.get("pnl_pct")
    pnl     = view.get("pnl")
    if pnl_pct is not None and pnl is not None:
        sign = "+" if pnl >= 0 else ""
        parts.append(f"Unrealised P&L: {sign}${pnl:,.0f} ({sign}{pnl_pct:.1f}%).")

    extras = []
    rsi   = view.get("rsi")
    if rsi is not None: extras.append(f"RSI {rsi:.0f}")
    prem  = view.get("premium_pct")
    if prem is not None: extras.append(f"premium {prem:+.1f}%")
    ab200 = view.get("above_200ma_pct")
    if ab200 is not None: extras.append(f"{ab200:+.1f}% vs 200-day")
    if extras:
        parts.append("Indicators: " + ", ".join(extras) + ".")

    return " ".join(parts) if parts else f"No data available for {sym}."


# ── Public API ────────────────────────────────────────────────────────────────

def narrate(symbol: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Produce a 3-sentence position summary. Returns:

        {
          "narrative": str,                # always non-empty when the symbol is held
          "source":    "llm:..." | "template",
          "cached":    bool,
          "view":      {...} | None,       # the structured payload (also useful to UI)
        }

    Returns {"narrative": "", "source": "no_position", ...} when the symbol
    isn't held anywhere in the portfolio.
    """
    view = build_view(symbol, data)
    if view is None:
        return {"narrative": "", "source": "no_position", "cached": False, "view": None}

    result = narration.cached_narrate(
        cache_key=_cache_key(view),
        system_prompt=_SYSTEM_PROMPT,
        user_payload=view,
        max_tokens=240,
        template_fn=lambda: _template(view),
    )
    return {**result, "view": view}
