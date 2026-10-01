"""
tax_briefing — Tax tab rules-based metric panel.

Returns structured metric chips computed directly from tax_data.
No LLM calls.
"""

from __future__ import annotations

from typing import Any, Dict, List

import db_manager as _dbm

_TAX_SIGNAL_KINDS = {
    "tax_bracket_pressure",
    "income_coverage_gap",
}


def _build_metrics(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    metrics: List[Dict[str, Any]] = []
    tx = (data or {}).get("tax_data") or {}

    # Bracket pressure + AGI
    # Use bracket_pressure_pct (taxable_actual ÷ taxable_bracket_ceiling, actual conversions only).
    # bracket_pressure_real uses gross_no_ss (plan-inflated) ÷ gross ceiling — wrong both ways.
    bp  = tx.get("bracket_pressure_pct") or tx.get("bracket_pressure_real")
    agi = tx.get("agi_real")
    if bp is not None:
        valence = "negative" if bp > 90 else "warn" if bp > 70 else None
        metrics.append({"label": "Bracket fullness", "value": f"{bp:.0f}%", "valence": valence,
                        "sub": "taxable income (actual) ÷ taxable bracket ceiling"})
    if agi is not None:
        metrics.append({"label": "AGI Est. (w/ sales)", "value": f"${agi:,.0f}",
                        "sub": "full-year, incl. realized gains & conversions"})

    # YTD dividends
    qual = tx.get("total_qualified_div")
    ord_ = tx.get("total_ordinary_div")
    if qual is not None:
        metrics.append({"label": "Qual Divs", "value": f"${qual:,.0f}", "sub": "YTD"})
    if ord_ is not None:
        metrics.append({"label": "Ord Divs", "value": f"${ord_:,.0f}", "sub": "YTD"})

    # Roth conversion room — taxable_actual vs taxable ceiling (actual conversions, not plan target).
    _ceil_gross = tx.get("target_bracket_ceiling")
    _std        = tx.get("std_deduction", 32_200)
    _taxable_ceil = (_ceil_gross - _std) if _ceil_gross is not None else None
    _taxable_act  = tx.get("taxable_actual")
    conv_room = max(0, _taxable_ceil - _taxable_act) if (_taxable_ceil is not None and _taxable_act is not None) else tx.get("conv_room_real")
    annual_conv = tx.get("annual_conversion")
    if conv_room is not None:
        valence = "positive" if conv_room > 10_000 else None
        metrics.append({"label": "Roth Room", "value": f"${conv_room:,.0f}", "valence": valence,
                        "sub": "bracket headroom — not a recommendation (see verdict)"})
    if annual_conv and annual_conv > 0:
        metrics.append({"label": "Roth Plan", "value": f"${annual_conv:,.0f}/yr",
                        "sub": "your configured annual target (Settings)"})

    # LTCG bracket room — separate from the ordinary bracket ceiling above.
    # LTCG/qualified dividends stack on top of ordinary taxable income (actual
    # basis, same as Roth Room) — room here is how much more LTCG/STCG-that-
    # becomes-LTCG/conversion-driven-stacking you can realize before crossing
    # from the 15% to the 20% LTCG rate (e.g. ~$613,700 MFJ), not the ordinary
    # bracket ceiling Roth Room tracks.
    _ltcg_thresh = tx.get("ltcg_15pct_threshold")
    _ytd_ltcg    = tx.get("ytd_ltcg_realized") or 0
    if _ltcg_thresh is not None and _taxable_act is not None:
        ltcg_room = max(0, _ltcg_thresh - (_taxable_act + _ytd_ltcg))
        valence = "negative" if ltcg_room < 25_000 else "warn" if ltcg_room < 100_000 else "positive"
        metrics.append({"label": "LTCG Bracket Room", "value": f"${ltcg_room:,.0f}", "valence": valence,
                        "sub": f"before 20% LTCG rate (ceiling ${_ltcg_thresh:,.0f}) — actual basis"})

    # Standard deduction
    std = tx.get("std_deduction")
    if std:
        metrics.append({"label": "Std Deduct.", "value": f"${std:,.0f}"})

    return metrics


def _build_alerts(signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {"kind": s.get("kind"), "severity": s.get("severity", "warn")}
        for s in signals
        if s.get("kind") in _TAX_SIGNAL_KINDS
    ]


def build_view(data: Dict[str, Any], signals: List[Dict[str, Any]]) -> Dict[str, Any]:
    tax_signals = [s for s in signals if s.get("kind") in _TAX_SIGNAL_KINDS]
    tx = (data or {}).get("tax_data") or {}
    return {
        "signals": [
            {"kind": s.get("kind"), "severity": s.get("severity"), "headline": s.get("headline")}
            for s in tax_signals
        ],
        "headline": {
            "binding_agi_annualized":           tx.get("agi_real"),
            "bracket_pressure_pct_of_ceiling":  tx.get("bracket_pressure_real"),
            "remaining_roth_conversion_room":   tx.get("conv_room_real"),
            "annual_roth_conversion_plan":      tx.get("annual_conversion"),
            "ytd_qualified_dividends":          tx.get("total_qualified_div"),
            "ytd_ordinary_dividends":           tx.get("total_ordinary_div"),
            "standard_deduction":               tx.get("std_deduction"),
        },
    }


def _template(view: Dict[str, Any]) -> str:
    return ""


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
