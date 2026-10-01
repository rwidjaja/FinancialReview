"""
income_coverage — flag when portfolio income falls short of true spending.

A coverage ratio = projected annual income / true annual spending:

  ≥ 1.20  → fully covered with margin (no signal)
  ≥ 1.00  → covered, but thin (no signal — could add later as info)
  < 1.00  → income alone doesn't cover spending (warn)
  < 0.80  → significant withdrawal pressure (crit)

Reads:
  summary.total_income      — projected annual portfolio income
  tax_data.spending_true_annual — derived from transactions.csv

Both are pre-computed; this detector is pure division.
"""

from typing import Any, Dict, List

_WARN_RATIO = 1.00
_CRIT_RATIO = 0.80


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    summary = (data or {}).get("summary") or {}
    tx      = (data or {}).get("tax_data") or {}
    income  = summary.get("total_income")
    spend   = tx.get("spending_true_annual")
    as_of   = ((data or {}).get("timestamp") or "")[:10]

    try:
        income_v = float(income) if income is not None else None
        spend_v  = float(spend)  if spend  is not None else None
    except (TypeError, ValueError):
        return []
    if not income_v or not spend_v or spend_v <= 0:
        return []

    ratio = income_v / spend_v

    if ratio < _CRIT_RATIO:
        severity = "crit"
    elif ratio < _WARN_RATIO:
        severity = "warn"
    else:
        return []

    gap = spend_v - income_v
    return [{
        "kind":     "income_coverage_gap",
        "symbol":   None,
        "severity": severity,
        "headline": f"Income covers {ratio * 100:.0f}% of true spending (gap ${gap:,.0f}/yr)",
        "details": {
            "ratio":          round(ratio, 3),
            "annual_income":  round(income_v, 0),
            "annual_spending":round(spend_v, 0),
            "gap":            round(gap, 0),
            "threshold_warn": _WARN_RATIO,
            "threshold_crit": _CRIT_RATIO,
        },
        "as_of": as_of,
        "tab":   "cash_flow",
    }]
