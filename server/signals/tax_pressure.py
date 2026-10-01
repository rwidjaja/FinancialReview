"""
tax_pressure — flag when projected AGI approaches the 22% bracket ceiling.

Reads `data["tax_data"]["bracket_pressure_real"]` which fetch_all_data exposes
as the percent of the 22% bracket ceiling consumed by projected AGI
(e.g. 87.5 means AGI is at 87.5% of the ceiling). Higher values mean less
room to absorb additional Roth conversions, capital gains, or other taxable
income without spilling into the next bracket.

Thresholds chosen to give the user lead time:
  - ≥ 75% : warn  (still room but tight — review before late-year conversions)
  - ≥ 90% : crit  (very tight — any late-year income may breach the bracket)

Notes:
  - `bracket_pressure_real` is None when tax_data is empty (no personal.json,
    fresh install) or when the bracket computation can't run. Detector
    returns [] in that case.
  - Field stores a percentage value (0-100+), not a decimal.
"""

from typing import Any, Dict, List

_WARN_PCT = 75.0
_CRIT_PCT = 90.0


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    tx = (data or {}).get("tax_data") or {}
    pressure = tx.get("bracket_pressure_real")
    as_of = ((data or {}).get("timestamp") or "")[:10]

    try:
        pct = float(pressure) if pressure is not None else None
    except (TypeError, ValueError):
        return []
    if pct is None:
        return []

    if pct >= _CRIT_PCT:
        severity = "crit"
    elif pct >= _WARN_PCT:
        severity = "warn"
    else:
        return []

    return [{
        "kind":     "tax_bracket_pressure",
        "symbol":   None,                       # portfolio-wide
        "severity": severity,
        "headline": f"AGI at {pct:.0f}% of 22% bracket ceiling",
        "details": {
            "pressure_pct":   round(pct, 1),
            "agi_real":       tx.get("agi_real"),
            "conv_room_real": tx.get("conv_room_real"),
            "threshold_warn": _WARN_PCT,
            "threshold_crit": _CRIT_PCT,
        },
        "as_of": as_of,
        "tab":   "tax",
    }]
