"""
risk_briefing — Risk tab rules-based metric panel.

Returns structured metric chips. No LLM calls.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import db_manager as _dbm

# Risk is the canonical home for risk-shaped findings (vol budget, drawdown,
# concentration). Other tabs carry only their tab-specific kinds.
_RISK_SIGNAL_KINDS = {
    "concentration_top1",
    "concentration_top3",
    "vol_budget_breach",
    "drawdown_breach",
    "outsized_mover",
    "headline_sentiment_drift",
}


def _build_metrics(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    metrics: List[Dict[str, Any]] = []

    pi        = (data or {}).get("portfolio_intel") or {}
    weights   = pi.get("weights") or {}
    snapshots = (data or {}).get("snapshots") or {}

    # Vol + vol budget
    vol = pi.get("portfolio_vol_pct")
    vb  = pi.get("vol_budget_used")
    if vol is not None:
        metrics.append({"label": "Vol", "value": f"{vol:.1f}%",
                        "sub": "annualized portfolio volatility"})
    if vb is not None:
        valence = "negative" if vb > 100 else "warn" if vb >= 70 else None
        metrics.append({"label": "Vol Budget", "value": f"{vb:.0f}%", "valence": valence,
                        "sub": "of your target volatility — >100% = over budget"})

    # Weighted beta
    beta = pi.get("weighted_beta")
    if beta is not None:
        metrics.append({"label": "Beta", "value": f"{beta:.2f}",
                        "sub": "market sensitivity vs SPY (1.0 = market)"})

    # Fragility
    frag = pi.get("fragility_score")
    if frag is not None:
        valence = "negative" if frag > 60 else "warn" if frag > 35 else None
        metrics.append({"label": "Fragility", "value": f"{frag:.0f}/100", "valence": valence,
                        "sub": "drawdown vulnerability — concentration × correlation"})

    # 6M drawdown (portfolio-weight-average)
    port_dd      = 0.0
    top_beta_sym = None
    top_beta_val: Optional[float] = None
    for sym, pct in weights.items():
        sn = snapshots.get(sym) or {}
        dd = sn.get("max_drawdown_6m") or 0
        port_dd += (pct / 100) * dd
        b = sn.get("beta")
        if b is not None and (top_beta_val is None or b > top_beta_val):
            top_beta_val = b
            top_beta_sym = sym

    if port_dd:
        metrics.append({"label": "6M Drawdown", "value": f"−{abs(port_dd) * 100:.1f}%", "valence": "warn",
                        "sub": "weight-avg peak-to-trough over 6 months"})

    # Highest-beta position
    if top_beta_sym and top_beta_val is not None:
        metrics.append({"label": "High-β", "value": f"{top_beta_sym} {top_beta_val:.2f}",
                        "sub": "most market-sensitive holding"})

    # Market regime
    regime = pi.get("market_regime")
    if regime:
        metrics.append({"label": "Regime", "value": regime,
                        "sub": "market state from VIX + trend"})

    # Income durability
    dur = pi.get("income_durability_score")
    if dur is not None:
        metrics.append({"label": "Inc Durability", "value": f"{dur:.0f}/100",
                        "sub": "dividend consistency & payout stability"})

    return metrics


def _build_alerts(signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {"kind": s.get("kind"), "severity": s.get("severity", "warn")}
        for s in signals
        if s.get("kind") in _RISK_SIGNAL_KINDS
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
