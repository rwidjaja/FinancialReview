"""
nav_discount_widening — flag when a closed-end fund's NAV discount widens
past a concern threshold.

For CEFs, a widening discount can indicate structural distribution pressure,
manager redemptions, or sector rotation away from the fund. A wide discount
is not always bad (value opportunity), but rapid widening in a holding that
represents material weight is a structural-health signal.

Reads per-symbol `nav_premium` from snapshots (negative = discount):
  warn : discount > 8% (i.e. nav_premium < -0.08) on a ≥ 3% weight holding
  crit : discount > 15% (i.e. nav_premium < -0.15) on a ≥ 3% weight holding
"""

from typing import Any, Dict, List

_WARN_DISCOUNT = -0.08   # 8% discount
_CRIT_DISCOUNT = -0.15   # 15% discount
_MIN_WEIGHT    =  0.03   # 3% portfolio weight


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    pi        = (data or {}).get("portfolio_intel") or {}
    snapshots = (data or {}).get("snapshots") or {}
    weights   = pi.get("weights") or {}
    as_of     = ((data or {}).get("timestamp") or "")[:10]

    signals: List[Dict[str, Any]] = []

    for sym, pct in weights.items():
        w = pct / 100
        if w < _MIN_WEIGHT:
            continue

        sn = snapshots.get(sym) or {}
        nav_premium = sn.get("nav_premium")
        try:
            nav_v = float(nav_premium) if nav_premium is not None else None
        except (TypeError, ValueError):
            continue
        if nav_v is None or nav_v >= _WARN_DISCOUNT:
            continue

        severity = "crit" if nav_v <= _CRIT_DISCOUNT else "warn"
        discount_pct = abs(nav_v) * 100

        signals.append({
            "kind":     "nav_discount_widening",
            "symbol":   sym,
            "severity": severity,
            "headline": f"{sym} trading at {discount_pct:.1f}% NAV discount",
            "details": {
                "symbol":        sym,
                "weight_pct":    round(pct, 1),
                "nav_premium":   round(nav_v, 4),
                "discount_pct":  round(discount_pct, 2),
                "threshold_warn": abs(_WARN_DISCOUNT) * 100,
                "threshold_crit": abs(_CRIT_DISCOUNT) * 100,
            },
            "as_of": as_of,
            "tab":   "portfolio",
        })

    return signals
