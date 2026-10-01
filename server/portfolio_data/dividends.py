"""portfolio_data.dividends — small helpers: linear regression for trends,
frequency-int mapping, ETF auto-classification, and per-fund config builder."""

from typing import List

def _linreg_slope(vals: List[float]) -> float:
    """Simple OLS slope of a 1-D sequence (x = index 0,1,2,...)."""
    n = len(vals)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(vals) / n
    num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(vals))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den != 0 else 0.0

_FREQ_INT_TO_STR = {12: "MONTHLY", 4: "QUARTERLY", 2: "SEMI_ANNUAL", 1: "ANNUAL"}

def _auto_classify_fund(symbol: str, schwab_quote: dict) -> dict:
    """
    Infer FUND_TYPE, DISTRIBUTION_FREQUENCY, and BENCHMARK from Schwab live data.
    Returns a partial config dict — caller merges with generic rules + overrides.

    Classification logic mirrors research.py _classify_symbol so both engines
    agree on every symbol without any hardcoded symbol names:
      CEF          — Schwab asset_sub_type == "CEF", or "closed-end" in description
      OPTION_INCOME — ETF/unknown with div_yield ≥ 7%
      DIVIDEND     — ETF/unknown with 2% ≤ div_yield < 7%
      GROWTH       — everything else (low/no yield equity ETF)
    """
    sub_type      = schwab_quote.get("asset_sub_type", "")   # "CEF", "ETF", ""
    div_yield_pct = float(schwab_quote.get("div_yield") or 0) # whole-number % e.g. 10.5
    freq_int      = schwab_quote.get("div_freq_int")          # 1/2/4/12 or None
    description   = (schwab_quote.get("description") or "").lower()

    # ── Fund type ─────────────────────────────────────────────────────────────
    if sub_type == "CEF":
        fund_type = "CEF"
    elif "closed-end" in description or "closed end" in description:
        # Name-heuristic fallback: some CEFs don't report asset_sub_type="CEF"
        # (matches research.py _classify_symbol step 2)
        fund_type = "CEF"
    elif sub_type in ("ETF", "") :
        # Same yield thresholds as research.py _classify_symbol dynamic fallback
        if div_yield_pct >= 7.0:
            fund_type = "OPTION_INCOME"
        elif div_yield_pct >= 2.0:
            fund_type = "DIVIDEND"
        else:
            fund_type = "GROWTH"
    else:
        # Plain equity, index, or unrecognised
        fund_type = "GROWTH"

    # ── Distribution frequency ────────────────────────────────────────────────
    if freq_int:
        dist_freq = _FREQ_INT_TO_STR.get(int(freq_int), "MONTHLY")
    else:
        dist_freq = "MONTHLY" if fund_type in ("OPTION_INCOME", "CEF", "DIVIDEND") else "QUARTERLY"

    return {
        "FUND_TYPE": fund_type,
        "DISTRIBUTION_FREQUENCY": dist_freq,
        "BENCHMARK": "SPY",   # default; overrides can change
    }


def _build_fund_config(
    symbol: str,
    schwab_quote: dict,
    symbol_overrides: dict,
    fund_type_rules: dict,
) -> dict:
    """
    Build a complete per-symbol config dict by layering:
      1. Auto-classification from Schwab data (FUND_TYPE, DIST_FREQ, BENCHMARK)
      2. Generic thresholds for the detected fund type (from _FUND_TYPE_RULES)
      3. Symbol-specific overrides (from _SYMBOL_OVERRIDES)

    Any symbol not in overrides gets sensible defaults automatically.
    Adding a new position to Schwab requires zero config changes.
    """
    auto = _auto_classify_fund(symbol, schwab_quote)

    # Start with auto-detected values
    cfg = dict(auto)

    # Layer generic rules for this fund type
    ft = cfg["FUND_TYPE"]
    type_rules = dict(fund_type_rules.get(ft, fund_type_rules.get("GROWTH", {})))
    # Merge type-level TAX_CHARACTER into cfg (without overwriting FUND_TYPE/DIST_FREQ/BENCHMARK)
    for k, v in type_rules.items():
        if not k.startswith("_"):
            cfg.setdefault(k, v)

    # Layer symbol-specific overrides (highest priority)
    overrides = symbol_overrides.get(symbol, {})
    for k, v in overrides.items():
        if not k.startswith("_"):
            cfg[k] = v

    return cfg
