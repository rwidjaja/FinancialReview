"""
signals — deterministic event detectors over the fetch_all_data() payload.

Each detector is a pure function:

    detect(data: dict) -> list[Signal]

where Signal is a plain dict shaped like:

    {
      "kind":     "concentration_top1",      # stable identifier (kind, symbol) for de-dup
      "symbol":   "SMH",                      # optional — None for portfolio-wide signals
      "severity": "info" | "warn" | "crit",
      "headline": "SMH at 43.6% of portfolio",
      "details":  {...},                      # detector-specific numeric backing
      "as_of":    "YYYY-MM-DD",
      "tab":      "portfolio",                # which UI tab a chip click should jump to
    }

Detectors are deliberately:
  - Pure (no I/O, no module state)
  - Independent (no detector-to-detector imports)
  - Cheap (run on every fetch_all_data tick)
  - Defensive (return [] on missing/malformed input rather than raising)

Anything that needs the LLM goes elsewhere — this layer is calculator, not narrator.
"""

from typing import Any, Dict, List

from .concentration         import detect as _detect_concentration
from .vol_budget             import detect as _detect_vol_budget
from .tax_pressure           import detect as _detect_tax_pressure
from .spending_pace          import detect as _detect_spending_pace
from .income_coverage        import detect as _detect_income_coverage
from .outsized_mover         import detect as _detect_outsized_mover
from .drawdown_breach        import detect as _detect_drawdown_breach
from .income_reversal        import detect as _detect_income_reversal
from .nav_discount_widening    import detect as _detect_nav_discount_widening
from .headline_sentiment_drift import detect as _detect_headline_sentiment_drift

# Registered detectors. Add new entries here; everything else picks them up
# automatically (the run-all helper, the schema docs, etc.).
_DETECTORS = [
    _detect_concentration,
    _detect_vol_budget,
    _detect_tax_pressure,
    _detect_spending_pace,
    _detect_income_coverage,
    _detect_outsized_mover,
    _detect_drawdown_breach,
    _detect_income_reversal,
    _detect_nav_discount_widening,
    _detect_headline_sentiment_drift,
]


def run_all_detectors(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Run every registered detector over the fetch_all_data() payload.

    Each detector is isolated: a crash in one does not affect the others, and the
    failure is logged silently so it cannot break the main refresh path.
    """
    out: List[Dict[str, Any]] = []
    for fn in _DETECTORS:
        try:
            sigs = fn(data) or []
        except Exception as e:
            # Detectors must never break the dashboard. Log and continue.
            print(f"[signals] detector {fn.__module__}.{fn.__name__} failed: {e}")
            continue
        out.extend(sigs)
    return out


__all__ = ["run_all_detectors"]
