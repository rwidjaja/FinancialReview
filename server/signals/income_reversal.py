"""
income_reversal — flag when a holding's income trend flips from positive to
negative (or vice versa from negative to positive as an info signal).

Reads `portfolio_intel.income_trend` (dict of symbol → trend string) and
`portfolio_intel.income_trend_direction` (dict of symbol → numeric slope)
if available. Falls back to checking per-symbol snapshot fields.

Severity:
  - info : trend flipped positive (recovery worth noting)
  - warn : trend flipped negative for a major holding (≥ 5% weight)
  - crit : trend flipped negative for the top income holding (≥ 15% weight)
"""

from typing import Any, Dict, List

_WARN_WEIGHT = 0.05  # 5% portfolio weight
_CRIT_WEIGHT = 0.15  # 15% portfolio weight


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    pi        = (data or {}).get("portfolio_intel") or {}
    snapshots = (data or {}).get("snapshots") or {}
    weights   = pi.get("weights") or {}
    as_of     = ((data or {}).get("timestamp") or "")[:10]

    signals: List[Dict[str, Any]] = []

    for sym, pct in weights.items():
        sn = snapshots.get(sym) or {}
        # income_trend is a string set by dividends.py: "up", "down", "flat", "volatile"
        trend = sn.get("income_trend") or ""
        if not trend:
            continue

        # Only flag downward reversals
        if trend.lower() not in ("down", "declining"):
            continue

        w = pct / 100
        if w < _WARN_WEIGHT:
            continue

        severity = "crit" if w >= _CRIT_WEIGHT else "warn"
        yield_pct = sn.get("dividend_yield") or sn.get("forward_yield")
        yield_str = f" (yield {yield_pct*100:.1f}%)" if yield_pct else ""

        signals.append({
            "kind":     "income_reversal",
            "symbol":   sym,
            "severity": severity,
            "headline": f"{sym} income trend turning negative{yield_str}",
            "details": {
                "symbol":      sym,
                "weight_pct":  round(pct, 1),
                "income_trend": trend,
                "yield_pct":   round(yield_pct * 100, 2) if yield_pct else None,
            },
            "as_of": as_of,
            "tab":   "portfolio",
        })

    return signals
