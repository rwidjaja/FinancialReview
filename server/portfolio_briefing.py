"""
portfolio_briefing — Portfolio tab rules-based metric panel.

Returns structured metric chips (label + value) computed directly from
portfolio data. No LLM calls — every number comes straight from the data dict.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def _fmt(v: float, decimals: int = 0) -> str:
    return f"{abs(v):,.{decimals}f}"


def _build_metrics(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    metrics: List[Dict[str, Any]] = []

    summary  = (data or {}).get("summary") or {}
    pi       = (data or {}).get("portfolio_intel") or {}
    ia       = (data or {}).get("income_analytics") or {}
    accounts = (data or {}).get("accounts") or []

    # Today's change
    dc_pct = summary.get("day_change_pct")
    dc_usd = summary.get("day_change")
    if dc_pct is not None:
        sign    = "+" if dc_pct >= 0 else ""
        valence = "positive" if dc_pct >= 0 else "negative"
        metrics.append({"label": "Today", "value": f"{sign}{dc_pct:.2f}%", "valence": valence})
    if dc_usd is not None:
        sign    = "+" if dc_usd >= 0 else "-"
        valence = "positive" if dc_usd >= 0 else "negative"
        metrics.append({"label": "P&L", "value": f"{sign}${_fmt(dc_usd)}", "valence": valence})

    # Portfolio value
    total = summary.get("total_value")
    if total:
        metrics.append({"label": "Value", "value": f"${_fmt(total)}"})

    # Unrealized total P&L
    total_pnl = summary.get("total_pnl")
    total_pnl_pct = summary.get("total_pnl_pct")
    if total_pnl is not None and total_pnl_pct is not None:
        sign    = "+" if total_pnl >= 0 else "-"
        valence = "positive" if total_pnl >= 0 else "negative"
        metrics.append({
            "label":   "Unrealized",
            "value":   f"{sign}${_fmt(total_pnl)}",
            "valence": valence,
            "sub":     f"{'+' if total_pnl_pct >= 0 else ''}{total_pnl_pct:.1f}%",
        })

    # Forward income + yield
    fwd = ia.get("portfolio_fwd_12m")
    yld = ia.get("yield_pct")
    if fwd:
        sub = f"{yld:.1f}% yield" if yld else None
        metrics.append({"label": "Fwd Income", "value": f"${_fmt(fwd)}/yr", "sub": sub})

    # YTD income
    ytd = ia.get("ytd_income") or summary.get("ytd_income")
    if ytd:
        metrics.append({"label": "YTD Income", "value": f"${_fmt(ytd)}"})

    # Confidence
    conf = pi.get("confidence")
    if conf is not None:
        valence = "positive" if conf >= 70 else "warn" if conf >= 50 else "negative"
        metrics.append({"label": "Confidence", "value": f"{conf:.0f}/100", "valence": valence})

    # Fragility
    frag = pi.get("fragility")
    if frag is not None:
        valence = "negative" if frag > 60 else "warn" if frag > 35 else None
        metrics.append({"label": "Fragility", "value": f"{frag:.0f}/100", "valence": valence})

    # Top 3 holdings by weight (money-market excluded)
    mm_symbols: set = {
        p.get("symbol", "")
        for acct in accounts
        for p in (acct.get("positions") or [])
        if p.get("is_money_market")
    }
    weights = pi.get("weights") or {}
    top3 = sorted(
        [(s, w) for s, w in weights.items() if s not in mm_symbols],
        key=lambda kv: -kv[1],
    )[:3]
    if top3:
        metrics.append({
            "label": "Top Holdings",
            "value": " · ".join(f"{s} {w:.1f}%" for s, w in top3),
        })

    return metrics


def _build_alerts(data: Dict[str, Any], signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Position/income-shaped signals only — vol_budget_breach and drawdown_breach
    # are canonical on the Risk tab; repeating them here (and on Returns/Forecast)
    # made the same five findings appear on four tabs.
    _PORT_SIGNAL_KINDS = {
        "concentration_top1", "concentration_top3",
        "income_reversal", "outsized_mover",
        "nav_discount_widening", "income_coverage_gap",
    }
    return [
        {"kind": s.get("kind"), "severity": s.get("severity", "warn")}
        for s in signals
        if s.get("kind") in _PORT_SIGNAL_KINDS
    ]


def narrate(data: Dict[str, Any]) -> Dict[str, Any]:
    """Produce the Portfolio tab's briefing payload (rules-based, no LLM)."""
    try:
        import db_manager as _dbm
        signals = _dbm.signals_get_latest()
    except Exception:
        signals = []

    return {
        "metrics":   _build_metrics(data),
        "alerts":    _build_alerts(data, signals),
        "narrative": "",
        "source":    "rules",
        "cached":    False,
    }
