"""
drawdown_breach — flag when the portfolio has dropped significantly from its
recent high-water mark.

Compares today's total portfolio value against the most recent EOD snapshot
peak to detect an active drawdown. Uses the eod_values table directly so
the signal is grounded in real recorded values, not the live tick.

Thresholds:
  ≥  5% from recent high : warn  (soft pullback — worth monitoring)
  ≥ 10% from recent high : crit  (correction territory)

Falls back to portfolio_intel.max_drawdown_6m when EOD data is unavailable.
"""

from typing import Any, Dict, List

_WARN_PCT = 0.05   # 5% drawdown
_CRIT_PCT = 0.10   # 10% drawdown


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    summary  = (data or {}).get("summary") or {}
    pi       = (data or {}).get("portfolio_intel") or {}
    as_of    = ((data or {}).get("timestamp") or "")[:10]

    current_value = summary.get("total_value")
    try:
        current_v = float(current_value) if current_value is not None else None
    except (TypeError, ValueError):
        return []
    if not current_v or current_v <= 0:
        return []

    # Primary: check against eod peak recorded in db_manager
    peak_v: float | None = None
    try:
        import db_manager as _dbm
        rows = _dbm._conn().execute(
            "SELECT portfolio_value FROM eod_values ORDER BY as_of DESC LIMIT 60"
        ).fetchall()
        if rows:
            peak_v = max(float(r["portfolio_value"]) for r in rows if r["portfolio_value"])
    except Exception:
        pass

    # Fallback: use 6M max-drawdown if eod table unavailable
    if peak_v is None:
        # Reconstruct implied peak from weighted drawdown
        weights   = pi.get("weights") or {}
        snapshots = (data or {}).get("snapshots") or {}
        if weights and snapshots:
            weighted_dd = sum(
                (pct / 100) * abs(float(snapshots.get(sym, {}).get("max_drawdown_6m") or 0))
                for sym, pct in weights.items()
            )
            if weighted_dd > 0:
                peak_v = current_v / (1 - weighted_dd)

    if peak_v is None or peak_v <= current_v:
        return []

    drawdown_pct = (peak_v - current_v) / peak_v
    if drawdown_pct < _WARN_PCT:
        return []

    severity = "crit" if drawdown_pct >= _CRIT_PCT else "warn"
    dollar_drop = peak_v - current_v

    return [{
        "kind":     "drawdown_breach",
        "symbol":   None,
        "severity": severity,
        "headline": f"Portfolio down {drawdown_pct*100:.1f}% from recent high (−${dollar_drop:,.0f})",
        "details": {
            "drawdown_pct":    round(drawdown_pct, 4),
            "current_value":   round(current_v, 0),
            "peak_value":      round(peak_v, 0),
            "dollar_drop":     round(dollar_drop, 0),
            "threshold_warn":  _WARN_PCT,
            "threshold_crit":  _CRIT_PCT,
        },
        "as_of": as_of,
        "tab":   "returns",
    }]
