"""
forecast_briefing — Forecast tab rules-based metric panel.

Returns structured metric chips. No LLM calls.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import db_manager as _dbm

# Tab-specific kinds only — concentration/vol findings are canonical on the
# Portfolio and Risk tabs. Forecast keeps the signal that changes projections.
_FORECAST_SIGNAL_KINDS = {
    "income_coverage_gap",
}


def _build_metrics(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    metrics: List[Dict[str, Any]] = []

    pi      = (data or {}).get("portfolio_intel") or {}
    tx      = (data or {}).get("tax_data") or {}
    summary = (data or {}).get("summary") or {}

    # Confidence
    conf = pi.get("system_confidence_score")
    if conf is not None:
        valence = "positive" if conf >= 70 else "warn" if conf >= 50 else "negative"
        metrics.append({"label": "Confidence", "value": f"{conf:.0f}/100", "valence": valence})

    # Fragility
    frag       = pi.get("fragility_score")
    frag_level = pi.get("fragility_level")
    if frag is not None:
        valence = "negative" if frag > 60 else "warn" if frag > 35 else None
        metrics.append({
            "label":   "Fragility",
            "value":   f"{frag:.0f}/100",
            "valence": valence,
            "sub":     frag_level or None,
        })

    # Income coverage — labeled "vs tracked" because the 5Y projection below
    # uses PLAN spending (Settings estimate, inflated), so the two can disagree
    # (200% coverage chip above a projected deficit). The sub makes that explicit.
    inc = summary.get("total_income")
    spd = tx.get("spending_true_annual")
    si  = (data or {}).get("spending_intelligence") or {}
    plan_spend = si.get("hardcoded_spending")
    try:
        if inc and spd and float(spd) > 0:
            cov     = float(inc) / float(spd) * 100
            valence = "positive" if cov >= 100 else "negative"
            sub = f"vs tracked spend ${float(spd):,.0f}"
            if plan_spend and float(plan_spend) > 0:
                sub += f" — projection uses plan ${float(plan_spend):,.0f}"
            metrics.append({"label": "Coverage vs tracked", "value": f"{cov:.0f}%", "valence": valence, "sub": sub})
    except Exception:
        pass

    # Weighted beta
    beta = pi.get("weighted_beta")
    if beta is not None:
        metrics.append({"label": "Beta", "value": f"{beta:.2f}"})

    # Regime
    regime  = pi.get("market_regime")
    vol_reg = pi.get("vol_regime")
    if regime:
        metrics.append({"label": "Regime", "value": regime})
    if vol_reg and vol_reg != "NORMAL":
        metrics.append({"label": "Vol Regime", "value": vol_reg, "valence": "warn"})

    # QQQ stress
    stress = pi.get("stress_qqq_pct")
    if stress is not None:
        metrics.append({"label": "QQQ Stress", "value": f"−{abs(stress):.1f}%", "valence": "warn"})

    # Roth conversion room — use target_bracket_ceiling - gross_no_ss (same as BracketMeter)
    _ceil = tx.get("target_bracket_ceiling")
    _gross = tx.get("gross_no_ss")
    room = max(0, _ceil - _gross) if (_ceil is not None and _gross is not None) else tx.get("conv_room_real")
    if room:
        metrics.append({"label": "Roth Room", "value": f"${room:,.0f}"})

    return metrics


def _build_alerts(signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {"kind": s.get("kind"), "severity": s.get("severity", "warn")}
        for s in signals
        if s.get("kind") in _FORECAST_SIGNAL_KINDS
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
