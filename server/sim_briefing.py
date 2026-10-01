"""
sim_briefing — Deterministic briefing for a paper-trading simulation portfolio.

Builds a compact view from the sim portfolio's current state (holdings,
cash, total value vs seed, recent SPY comparison) and narrates via a
deterministic template — no LLM calls.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def build_view(summary: Dict[str, Any], history: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build the compact narration payload from sim portfolio + history data."""
    total_value  = summary.get("total_value") or 0
    cash         = summary.get("cash") or 0
    invested     = summary.get("invested_value") or (total_value - cash)
    seed         = summary.get("seed_capital") or total_value or 1
    pnl          = total_value - seed
    pnl_pct      = (pnl / seed * 100) if seed > 0 else 0

    holdings = summary.get("holdings") or []
    # Top 3 by unrealised gain %
    top_winners = sorted(
        [h for h in holdings if (h.get("unrealized_pct") or 0) > 0],
        key=lambda h: h.get("unrealized_pct") or 0, reverse=True
    )[:3]
    top_losers = sorted(
        [h for h in holdings if (h.get("unrealized_pct") or 0) < 0],
        key=lambda h: h.get("unrealized_pct") or 0
    )[:2]

    # SPY comparison from latest history point
    spy_return_pct: Optional[float] = None
    port_return_pct: Optional[float] = None
    if history:
        first = history[0]
        last  = history[-1]
        first_val = first.get("total_value") or seed
        last_val  = last.get("total_value") or total_value
        if first_val > 0:
            port_return_pct = round((last_val - first_val) / first_val * 100, 2)
        first_spy = first.get("spy_value")
        last_spy  = last.get("spy_value")
        if first_spy and last_spy and first_spy > 0:
            spy_return_pct = round((last_spy - first_spy) / first_spy * 100, 2)

    return {
        "portfolio_name":   summary.get("name"),
        "total_value":      round(total_value, 0),
        "cash":             round(cash, 0),
        "invested_value":   round(invested, 0),
        "seed_capital":     round(seed, 0),
        "pnl":              round(pnl, 0),
        "pnl_pct":          round(pnl_pct, 2),
        "holding_count":    len([h for h in holdings if (h.get("total_shares") or 0) > 0]),
        "ytd_income":       round(float(summary.get("ytd_income") or 0), 0),
        "top_winners":      [
            {"symbol": h.get("symbol"), "unrealized_gain_pct_since_purchase": round(h.get("unrealized_pct") or 0, 2)}
            for h in top_winners
        ],
        "top_losers":       [
            {"symbol": h.get("symbol"), "unrealized_gain_pct_since_purchase": round(h.get("unrealized_pct") or 0, 2)}
            for h in top_losers
        ],
        "port_return_pct":  port_return_pct,
        "spy_return_pct":   spy_return_pct,
        "alpha_pct":        round(port_return_pct - spy_return_pct, 2)
                            if port_return_pct is not None and spy_return_pct is not None else None,
    }


def _template(view: Dict[str, Any]) -> str:
    name = view.get("portfolio_name") or "Sim Portfolio"
    parts: List[str] = []

    # 1. Today's status: total value vs seed capital
    total_value = view.get("total_value")
    pnl_pct = view.get("pnl_pct")
    seed = view.get("seed_capital")
    if total_value is not None and pnl_pct is not None and seed is not None:
        sign = "+" if pnl_pct >= 0 else ""
        parts.append(
            f"{name}: ${total_value:,.0f} total value, {sign}{pnl_pct:.1f}% vs ${seed:,.0f} seed capital."
        )

    # 2. Top contributors / detractors (up to 2 winners, up to 1 loser)
    winners = view.get("top_winners") or []
    losers = view.get("top_losers") or []
    if winners:
        syms = ", ".join(
            f"{w['symbol']} ({w['unrealized_gain_pct_since_purchase']:+.1f}% unrealized)"
            for w in winners[:2]
        )
        parts.append(f"Top contributors: {syms}.")
    if losers:
        top_loser = losers[0]
        parts.append(
            f"Detractors: {top_loser['symbol']} ({top_loser['unrealized_gain_pct_since_purchase']:+.1f}%)."
        )

    # 3. Key metrics: cash, holding count, YTD income
    cash = view.get("cash")
    holding_count = view.get("holding_count")
    ytd_income = view.get("ytd_income")
    metric_parts: List[str] = []
    if cash is not None:
        metric_parts.append(f"Cash: ${cash:,.0f}")
    if holding_count is not None:
        metric_parts.append(f"{holding_count} holdings")
    if ytd_income is not None:
        metric_parts.append(f"YTD income: ${ytd_income:,.0f}")
    if metric_parts:
        parts.append("; ".join(metric_parts) + ".")

    # 4. No alerts — sim tab does not use the signals system

    # 5. Alpha vs SPY — risk/opportunity statement
    alpha = view.get("alpha_pct")
    spy_r = view.get("spy_return_pct")
    if alpha is not None and spy_r is not None:
        direction = "Outperforming." if alpha > 0 else "Underperforming."
        parts.append(
            f"{alpha:+.1f}pp vs SPY ({spy_r:.1f}% period return). {direction}"
        )

    return " ".join(parts) if parts else "No simulation data available."


def narrate(summary: Dict[str, Any], history: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Produce a briefing for a sim portfolio. Returns:
        {"narrative": str, "source": "template", "cached": False, "view": {...}}
    """
    view = build_view(summary, history)
    return {"narrative": _template(view), "source": "template", "cached": False, "view": view}
