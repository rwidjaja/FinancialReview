"""
outsized_mover — flag positions whose day_change dominates the portfolio's
total day P&L (positive or negative).

When one position contributes >50% of the day's net move, the portfolio is
effectively riding on that ticker. Worth flagging as a warning so the user
sees "today's move was really just SMH" rather than reading the headline
delta as broad participation.

Thresholds (absolute share of total day P&L, ignoring sign):
  ≥ 50%  warn
  ≥ 75%  crit
"""

from typing import Any, Dict, List

_WARN_SHARE = 0.50
_CRIT_SHARE = 0.75


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    summary = (data or {}).get("summary") or {}
    grand_day = summary.get("day_change")
    if grand_day is None or abs(grand_day) < 1.0:
        # Not enough movement to make share meaningful.
        return []
    try:
        grand = float(grand_day)
    except (TypeError, ValueError):
        return []
    if abs(grand) < 1.0:
        return []

    # Aggregate day_change per symbol across accounts (a symbol may appear
    # in multiple accounts).
    by_symbol: Dict[str, float] = {}
    for acct in (data or {}).get("accounts") or []:
        for p in acct.get("positions") or []:
            sym = (p.get("symbol") or "").upper()
            if not sym:
                continue
            try:
                by_symbol[sym] = by_symbol.get(sym, 0.0) + float(p.get("day_change") or 0)
            except (TypeError, ValueError):
                continue
    if not by_symbol:
        return []

    # Find the symbol contributing the largest absolute share of the day's move.
    top_sym = max(by_symbol, key=lambda s: abs(by_symbol[s]))
    top_chg = by_symbol[top_sym]
    share   = abs(top_chg) / abs(grand)

    if share >= _CRIT_SHARE:
        severity = "crit"
    elif share >= _WARN_SHARE:
        severity = "warn"
    else:
        return []

    direction = "up" if top_chg > 0 else "down"
    return [{
        "kind":     "outsized_mover",
        "symbol":   top_sym,
        "severity": severity,
        "headline": (
            f"{top_sym} drove {share * 100:.0f}% of today's "
            f"{'gain' if top_chg > 0 else 'loss'} (${top_chg:+,.0f} of "
            f"${grand:+,.0f})"
        ),
        "details": {
            "symbol":         top_sym,
            "direction":      direction,
            "symbol_day_chg": round(top_chg, 2),
            "grand_day_chg":  round(grand, 2),
            "share_pct":      round(share * 100, 1),
            "threshold_warn": _WARN_SHARE * 100,
            "threshold_crit": _CRIT_SHARE * 100,
        },
        "as_of": ((data or {}).get("timestamp") or "")[:10],
        "tab":   "returns",
    }]
