"""
headline_sentiment_drift — flag politically/news-driven market sentiment shocks.

Reads the pre-computed snapshot from headline_sentiment.get_snapshot(), which
fetches and classifies financial RSS headlines and maintains a rolling baseline.

Two severity levels:
  warn → moderate negative/political spike (z-score < -1.5 or neg_pct ≥ 35%)
  crit → large spike (z-score < -2.5) or heavy political load (pol_pct ≥ 40%)
        or majority-negative headlines (neg_pct ≥ 55%)

Signal is portfolio-wide (symbol=None) and routes to the Risk tab.
"""

from typing import Any, Dict, List

from . import headline_sentiment as _hs

_WARN_NEG_PCT  = 35.0   # ≥35% negative/political/geo headlines → warn
_WARN_ZSCORE   = -1.5   # z-score ≤ -1.5 → warn
_CRIT_NEG_PCT  = 55.0   # ≥55% → crit
_CRIT_ZSCORE   = -2.5   # z-score ≤ -2.5 → crit
_CRIT_POL_PCT  = 40.0   # ≥40% political/geo/regulatory → crit on its own
_MIN_HEADLINES = 5      # ignore snapshot if too few headlines classified


def detect(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    as_of = ((data or {}).get("timestamp") or "")[:10]

    try:
        snapshot = _hs.get_snapshot()
    except Exception:
        return []

    if not snapshot or snapshot.get("n", 0) < _MIN_HEADLINES:
        return []

    neg_pct       = float(snapshot.get("neg_pct", 0.0))
    political_pct = float(snapshot.get("political_pct", 0.0))
    zscore        = float(snapshot.get("zscore", 0.0))
    sources       = snapshot.get("sources") or []

    # ── Severity ────────────────────────────────────────────────────────────
    if zscore <= _CRIT_ZSCORE or neg_pct >= _CRIT_NEG_PCT or political_pct >= _CRIT_POL_PCT:
        severity = "crit"
    elif zscore <= _WARN_ZSCORE or neg_pct >= _WARN_NEG_PCT:
        severity = "warn"
    else:
        return []

    # ── Headline copy ────────────────────────────────────────────────────────
    if political_pct >= 20:
        headline = "Political sentiment shock detected in market headlines"
    else:
        headline = "Negative sentiment spike detected in market headlines"

    return [{
        "kind":     "headline_sentiment_drift",
        "symbol":   None,
        "severity": severity,
        "headline": headline,
        "details": {
            "neg_pct":       round(neg_pct, 1),
            "political_pct": round(political_pct, 1),
            "zscore":        round(zscore, 4),
            "n_headlines":   snapshot.get("n", 0),
            "sources":       sources[:3],
        },
        "as_of": as_of,
        "tab":   "risk",
    }]
