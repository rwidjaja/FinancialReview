"""
spending_pace — flag when recent-12-month spending diverges from prior-12.

Reads `tax_data.spending_true_annual` and `tax_data.spending_recent_12`
(the rolling-12-month spending vs prior-rolling-12). A meaningful divergence
indicates lifestyle inflation or a one-off spike worth flagging.

Thresholds:
  - drift > +8%   warn  (spending is rising)
  - drift > +15%  crit  (significant jump — likely category spike)
  - drift < -8%   info  (spending dropped — usually benign but worth knowing)
"""

from typing import Any, Dict, List

_WARN_PCT  = 8.0
_CRIT_PCT  = 15.0
_DROP_PCT  = -8.0


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    tx = (data or {}).get("tax_data") or {}
    recent = tx.get("spending_recent_12")
    annual = tx.get("spending_true_annual")
    drift  = tx.get("spending_drift_pct")
    as_of  = ((data or {}).get("timestamp") or "")[:10]

    # Drift is the canonical signal. If missing, derive from the two annuals.
    try:
        drift_val = float(drift) if drift is not None else None
    except (TypeError, ValueError):
        drift_val = None
    if drift_val is None and recent is not None and annual:
        try:
            drift_val = (float(recent) - float(annual)) / float(annual) * 100
        except (TypeError, ValueError, ZeroDivisionError):
            return []
    if drift_val is None:
        return []

    if drift_val >= _CRIT_PCT:
        severity, headline = "crit", f"Recent-12 spending up {drift_val:.1f}% vs prior-12"
    elif drift_val >= _WARN_PCT:
        severity, headline = "warn", f"Spending pace running {drift_val:+.1f}% above prior 12 months"
    elif drift_val <= _DROP_PCT:
        severity, headline = "info", f"Spending pace down {abs(drift_val):.1f}% vs prior 12 months"
    else:
        return []

    return [{
        "kind":     "spending_pace_drift",
        "symbol":   None,
        "severity": severity,
        "headline": headline,
        "details": {
            "drift_pct":      round(drift_val, 2),
            "recent_12":      recent,
            "prior_12":       annual,
            "threshold_warn": _WARN_PCT,
            "threshold_crit": _CRIT_PCT,
            "threshold_drop": _DROP_PCT,
        },
        "as_of": as_of,
        "tab":   "cash_flow",
    }]
