"""
concentration — flag when a single position dominates the portfolio.

Two signals (at most one of each emitted per run):

  - concentration_top1 : top holding weight crosses warn/crit thresholds
  - concentration_top3 : top-3-holding combined weight crosses crit threshold

Both read from `data["portfolio_intel"]["weights"]` which is already stored as
percent (0-100 scale, e.g. SMH=43.6 means 43.6%) — see portfolio_data/__init__.py
where weights are exported as `{sym: round(w * 100, 1)}`. Thresholds below are
in the same percent units; do not multiply by 100 in the headline.
"""

from typing import Any, Dict, List

# Thresholds in PERCENT units (0-100), matching portfolio_intel.weights:
#   - Top single position > 25% : worth noting
#   - Top single position > 40% : critical (one ticker can move the portfolio)
#   - Top three positions > 60% : portfolio is effectively a 3-stock bet
_WARN_TOP1 = 25.0
_CRIT_TOP1 = 40.0
_CRIT_TOP3 = 60.0


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    pi = (data or {}).get("portfolio_intel") or {}
    weights = pi.get("weights") or {}
    as_of = ((data or {}).get("timestamp") or "")[:10]

    # Empty portfolio (e.g. fresh install, no positions loaded) — nothing to flag.
    if not weights:
        return []

    # Sort symbols by weight, largest first. Coerce to float; skip junk.
    items: List[tuple] = []
    for sym, w in weights.items():
        try:
            items.append((sym, float(w)))
        except (TypeError, ValueError):
            continue
    if not items:
        return []
    items.sort(key=lambda kv: kv[1], reverse=True)

    out: List[Dict[str, Any]] = []

    # ── top-1 ────────────────────────────────────────────────────────────────
    top_sym, top_pct = items[0]
    if top_pct >= _CRIT_TOP1:
        severity = "crit"
    elif top_pct >= _WARN_TOP1:
        severity = "warn"
    else:
        severity = None

    if severity:
        out.append({
            "kind":     "concentration_top1",
            "symbol":   top_sym,
            "severity": severity,
            "headline": f"{top_sym} is {top_pct:.1f}% of portfolio",
            "details": {
                "weight_pct":     round(top_pct, 2),
                "threshold_warn": _WARN_TOP1,
                "threshold_crit": _CRIT_TOP1,
            },
            "as_of": as_of,
            "tab":   "portfolio",
        })

    # ── top-3 combined ───────────────────────────────────────────────────────
    if len(items) >= 3:
        top3 = items[:3]
        combined = sum(w for _, w in top3)
        if combined >= _CRIT_TOP3:
            syms = [s for s, _ in top3]
            out.append({
                "kind":     "concentration_top3",
                "symbol":   None,  # portfolio-wide
                "severity": "crit",
                "headline": f"Top 3 holdings ({', '.join(syms)}) are {combined:.1f}% of portfolio",
                "details": {
                    "symbols":        syms,
                    "weights_pct":    [round(w, 2) for _, w in top3],
                    "combined_pct":   round(combined, 2),
                    "threshold_crit": _CRIT_TOP3,
                },
                "as_of": as_of,
                "tab":   "portfolio",
            })

    return out
