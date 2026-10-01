"""
cashflow_briefing — Cash Flow tab rules-based metric panel.

Returns structured metric chips. No LLM calls.
"""

from __future__ import annotations

from typing import Any, Dict, List

import db_manager as _dbm

_CF_SIGNAL_KINDS = {
    "spending_pace_drift",
    "income_coverage_gap",
    "tax_bracket_pressure",
}


def _build_metrics(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    metrics: List[Dict[str, Any]] = []

    summary = (data or {}).get("summary") or {}
    tx      = (data or {}).get("tax_data") or {}

    income   = summary.get("total_income")
    # Canonical TRACKED spending = full-window annualized from transactions
    # (spending_true_annual). spending_recent_12 is a rolling window that can
    # disagree with every other tab — use it only as a fallback.
    spending = tx.get("spending_true_annual") or tx.get("spending_recent_12")

    if income:
        metrics.append({"label": "Fwd Dividends", "value": f"${income:,.0f}",
                        "sub": "all accounts · 12m projection"})
    if spending:
        metrics.append({"label": "Spend (tracked)", "value": f"${spending:,.0f}",
                        "sub": "annualized from transactions"})

    if income and spending and float(spending) > 0:
        coverage = float(income) / float(spending) * 100
        valence  = "positive" if coverage >= 100 else "negative"
        metrics.append({
            "label": "Coverage vs tracked", "value": f"{coverage:.0f}%", "valence": valence,
            "sub": "all-account fwd dividends ÷ tracked spend",
        })

    # income_surplus = taxable-account dividends − tracked spending (IRA divs
    # excluded — they can't fund spending without a withdrawal). This is NOT
    # the same as the all-account coverage chip above, so label it precisely.
    surplus = tx.get("income_surplus")
    if surplus is not None:
        sign    = "+" if surplus >= 0 else "-"
        valence = "positive" if surplus >= 0 else "negative"
        label   = "Taxable-Div Surplus" if surplus >= 0 else "Taxable-Div Gap"
        metrics.append({
            "label": label, "value": f"{sign}${abs(surplus):,.0f}", "valence": valence,
            "sub": "tracked spend vs taxable divs only — IRA divs excluded",
        })

    drift = tx.get("spending_drift_pct")
    if drift is not None:
        sign    = "+" if drift >= 0 else ""
        valence = "negative" if drift > 20 else "warn" if drift > 10 else None
        metrics.append({"label": "Spend Drift", "value": f"{sign}{drift:.1f}%", "valence": valence})

    withdrawal = tx.get("withdrawal_need_actual")
    if withdrawal and withdrawal > 0:
        metrics.append({
            "label": "Withdrawal", "value": f"${withdrawal:,.0f}/yr", "valence": "warn",
            "sub": "sale/IRA draw to cover spending above taxable divs",
        })

    conv_room = tx.get("conv_room_real")
    if conv_room:
        metrics.append({"label": "Roth Room", "value": f"${conv_room:,.0f}"})

    return metrics


def _build_alerts(signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {"kind": s.get("kind"), "severity": s.get("severity", "warn")}
        for s in signals
        if s.get("kind") in _CF_SIGNAL_KINDS
    ]


def narrate(data: Dict[str, Any]) -> Dict[str, Any]:
    try:
        signals = _dbm.signals_get_latest()
    except Exception:
        signals = []

    return {
        "metrics":   _build_metrics(data),
        "alerts":    _build_alerts(signals),
        "narrative": "",
        "source":    "rules",
        "cached":    False,
    }
