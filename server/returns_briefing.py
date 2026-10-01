"""
returns_briefing — Returns tab rules-based metric panel.

Returns structured metric chips. No LLM calls.
"""

from __future__ import annotations

from typing import Any, Dict, List

import db_manager as _dbm

# Tab-specific kinds only — the concentration story is canonical on the
# Portfolio and Risk tabs; repeating the same findings on four tabs turns
# them into wallpaper. Returns keeps performance-shaped signals.
_RET_SIGNAL_KINDS = {
    "outsized_mover",
    "vol_budget_breach",
}


def _build_metrics(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    metrics: List[Dict[str, Any]] = []

    summary = (data or {}).get("summary") or {}
    pi      = (data or {}).get("portfolio_intel") or {}

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
        metrics.append({"label": "P&L", "value": f"{sign}${abs(dc_usd):,.0f}", "valence": valence})

    # Top daily movers (aggregate by symbol across accounts)
    sym_dc: Dict[str, float] = {}
    for acct in ((data or {}).get("accounts") or []):
        for pos in (acct.get("positions") or []):
            if pos.get("is_money_market"):
                continue
            dc  = pos.get("day_change")
            sym = pos.get("symbol", "?")
            if dc is None:
                continue
            sym_dc[sym] = sym_dc.get(sym, 0.0) + dc

    movers = sorted(sym_dc.items(), key=lambda kv: abs(kv[1]), reverse=True)
    if movers:
        sym, dc = movers[0]
        sign    = "+" if dc >= 0 else "-"
        valence = "positive" if dc >= 0 else "negative"
        metrics.append({"label": "Top Mover", "value": f"{sym} {sign}${abs(dc):,.0f}", "valence": valence})
    # Biggest drag (most negative)
    neg_movers = [(s, dc) for s, dc in movers if dc < 0]
    if neg_movers:
        sym, dc = neg_movers[-1]
        metrics.append({"label": "Biggest Drag", "value": f"{sym} -${abs(dc):,.0f}", "valence": "negative"})

    # Vol budget
    vb = pi.get("vol_budget_used")
    if vb is not None:
        valence = "negative" if vb > 100 else "warn" if vb >= 70 else None
        metrics.append({"label": "Vol Budget", "value": f"{vb:.0f}%", "valence": valence,
                        "sub": "of your target volatility — >100% = over budget"})

    # Fragility is a risk metric — belongs in the Risk briefing, not here.

    # Market + vol regime
    regime  = pi.get("market_regime")
    vol_reg = pi.get("vol_regime")
    if regime:
        metrics.append({"label": "Regime", "value": regime})
    if vol_reg and vol_reg != "NORMAL":
        metrics.append({"label": "Vol Regime", "value": vol_reg, "valence": "warn"})

    return metrics


def _build_alerts(signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for s in signals:
        kind = s.get("kind")
        if kind not in _RET_SIGNAL_KINDS:
            continue
        # Daily-swing signals (outsized_mover) are expected for a concentrated portfolio
        # with intentional SMH exposure — large moves are noise, not alerts.
        # Downgrade to info so they don't appear as CRITICAL in the briefing chip.
        severity = "info" if kind == "outsized_mover" else s.get("severity", "warn")
        out.append({"kind": kind, "severity": severity})
    return out


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
