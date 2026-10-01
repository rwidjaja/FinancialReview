"""
vol_budget — flag when portfolio volatility usage exceeds the configured target.

Reads `data["portfolio_intel"]["vol_budget_used"]` which fetch_all_data exposes
as a percentage of the user's target vol (100 = exactly on budget, 150 = 50%
over). Higher values mean the portfolio is taking more risk than its
configured vol budget allows.

Thresholds are conservative to match user expectation:
  - ≥ 120% : warn  (noticeably over budget)
  - ≥ 150% : crit  (significantly over budget — concentration / drawdown risk)

Notes:
  - The field is None when the portfolio is empty (fresh install, no positions)
    or when target_vol is unconfigured. Detector returns [] in that case.
  - Field is documented as a percent (0-200 typical range), not a decimal.
"""

from typing import Any, Dict, List

_WARN_PCT = 120.0
_CRIT_PCT = 150.0


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    pi = (data or {}).get("portfolio_intel") or {}
    used = pi.get("vol_budget_used")
    as_of = ((data or {}).get("timestamp") or "")[:10]

    # Defensive: None / non-numeric → nothing to flag.
    try:
        used_pct = float(used) if used is not None else None
    except (TypeError, ValueError):
        return []
    if used_pct is None:
        return []

    if used_pct >= _CRIT_PCT:
        severity = "crit"
    elif used_pct >= _WARN_PCT:
        severity = "warn"
    else:
        return []

    target_vol = pi.get("target_vol_pct")
    actual_vol = pi.get("portfolio_vol_pct")

    return [{
        "kind":     "vol_budget_breach",
        "symbol":   None,                       # portfolio-wide
        "severity": severity,
        "headline": f"Vol budget at {used_pct:.0f}% of target",
        "details": {
            "used_pct":        round(used_pct, 1),
            "target_vol_pct":  target_vol,
            "portfolio_vol_pct": actual_vol,
            "threshold_warn":  _WARN_PCT,
            "threshold_crit":  _CRIT_PCT,
        },
        "as_of": as_of,
        "tab":   "returns",   # Returns tab hosts the risk/vol view
    }]
