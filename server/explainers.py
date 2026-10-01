"""
explainers — plain-English "what is this metric?" tooltips, pre-baked with the LLM.

Why a separate module:
  - Tooltip text is dashboard-wide static content, not per-user. It belongs in
    the same SQLite store as everything else runtime-cached (cache_kv), keyed
    by metric id. Same pattern as briefing_narrative and the Schwab caches.
  - Bake-once-then-serve: each metric gets exactly one Ollama call (ever),
    triggered manually via the CLI below. At request time the API just reads
    from cache_kv — no LLM dependency on hover.
  - To audit the generated text, run the CLI with --dump after baking; it
    prints the full registry so you can review before/after a regeneration.

Adding a metric:
  - Append an entry to METRICS below.
  - Run `python -m server.explainers --regen`.

Regenerating an existing metric (e.g. better prompt):
  - Run `python -m server.explainers --regen --force --only fragility`.

Storage layout in cache_kv:
  key   = "explainer:<metric_id>"
  value = {"text": str, "model": str, "generated_at": float}
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any, Dict, List, Optional

import db_manager as _dbm

_CACHE_PREFIX = "explainer:"

# ── System prompt locked to "explain a metric in plain language" ─────────────

_SYSTEM_PROMPT = (
    "You are a financial-dashboard glossary writer. "
    "Given a metric, write a 2-3 sentence plain-English explanation that covers: "
    "(1) what it measures, (2) what a reader should look for, "
    "(3) what high or low values typically mean. "
    "Use everyday language. Avoid jargon when possible. "
    "Do not give advice. Do not predict markets. Do not include disclaimers. "
    "Plain text only — no headings, no bullets, no markdown."
)

# ── Metric registry ──────────────────────────────────────────────────────────
#
# Each entry is the *prompt context* the LLM sees, not the output text. The
# `id` is the cache key suffix and the value the frontend passes when asking
# for an explainer. Keep ids stable — renaming an id is a data migration.
#
# `hint` is short context the LLM uses to anchor its writing. It's not shown
# to the user. Keep it factual.

METRICS: List[Dict[str, str]] = [
    {
        "id":    "fragility",
        "label": "Fragility Score",
        "hint":  "A 0-100 composite score measuring how vulnerable a portfolio is "
                 "to drawdowns. Higher = more fragile. Combines concentration, "
                 "volatility, correlation clustering, and downside capture.",
    },
    {
        "id":    "vol_budget",
        "label": "Volatility Budget",
        "hint":  "The portfolio's volatility expressed as a percent of the user's "
                 "configured target. 100% means exactly on budget; 150% means the "
                 "portfolio is taking 50% more risk than its target allows.",
    },
    {
        "id":    "nav_premium",
        "label": "NAV Premium / Discount",
        "hint":  "For closed-end funds and similar instruments, the percent above "
                 "(premium) or below (discount) net asset value the fund is trading. "
                 "Premiums often mean-revert; persistent discounts can indicate "
                 "structural problems or value opportunities.",
    },
    {
        "id":    "market_regime",
        "label": "Market Regime",
        "hint":  "A coarse classification of the current market state: EXPANSION "
                 "(broad-based gains, low vol), TRANSITION (mixed signals), or "
                 "RISK-OFF (drawdown, elevated vol).",
    },
    {
        "id":    "vol_regime",
        "label": "Volatility Regime",
        "hint":  "Whether current volatility is LOW, NORMAL, or HIGH relative to "
                 "its 90-day average. Distinct from the broader market regime.",
    },
    {
        "id":    "confidence",
        "label": "System Confidence Score",
        "hint":  "A 0-100 score reflecting how confident the dashboard is in its "
                 "current analytics. Lower values can mean stale data, missing "
                 "fields, or conflicting signals.",
    },
    {
        "id":    "correlation_cluster",
        "label": "Correlation Cluster",
        "hint":  "A group of holdings whose returns move together. Tight clusters "
                 "reduce real diversification — when one drops, the others tend "
                 "to drop too.",
    },
    {
        "id":    "beta",
        "label": "Beta",
        "hint":  "How much a position tends to move relative to its benchmark. "
                 "Beta 1.0 means it moves with the benchmark; >1.0 amplifies "
                 "moves; <1.0 dampens them.",
    },
    {
        "id":    "income_coverage",
        "label": "Income Coverage Ratio",
        "hint":  "Annual portfolio income divided by annual spending. Above 1.0 "
                 "means income alone covers spending; below 1.0 means principal "
                 "withdrawal is required to make up the gap.",
    },
    {
        "id":    "bracket_pressure",
        "label": "Tax Bracket Pressure",
        "hint":  "Projected annual AGI as a percent of the 22% federal income "
                 "tax bracket ceiling. Higher values mean less room to absorb "
                 "additional Roth conversions or capital gains without pushing "
                 "into the next bracket.",
    },
    {
        "id":    "sequence_risk",
        "label": "Sequence-of-Returns Risk",
        "hint":  "The risk that a bad market right at the start of retirement "
                 "permanently impairs the portfolio. The same average return "
                 "produces very different outcomes depending on the order of "
                 "returns.",
    },
    {
        "id":    "concentration_top1",
        "label": "Top Holding Concentration",
        "hint":  "The portfolio weight of the single largest position. "
                 "Over 25% is notable, over 40% means one position can move "
                 "the entire portfolio.",
    },
    {
        "id":    "distribution_coverage",
        "label": "Distribution Coverage",
        "hint":  "For income funds, the ratio of underlying earnings to "
                 "distributions paid. Above 1.0 = distributions are funded "
                 "by earnings; below 1.0 = distributions partially return "
                 "capital, which erodes NAV over time.",
    },
    {
        "id":    "conv_room",
        "label": "Conversion Room",
        "hint":  "How many dollars of additional Roth conversion can be done "
                 "this year before projected AGI breaches the 22% bracket "
                 "ceiling. Calculated against real spending-aware AGI, not just "
                 "current AGI.",
    },
    {
        "id":    "fund_decision",
        "label": "Fund Decision Tier",
        "hint":  "A four-tier structural-health rating per fund: GOOD (no "
                 "concerns), WATCH (one or two warnings), CAUTION (multiple "
                 "warnings), AVOID (critical issues like sustained NAV erosion).",
    },
    {
        "id":    "cagr",
        "label": "CAGR (Compound Annual Growth Rate)",
        "hint":  "The constant annual return that would produce the same end "
                 "value over a given period. Smooths out year-to-year volatility "
                 "into a single annualised figure. Useful for comparing returns "
                 "over different time windows.",
    },
    {
        "id":    "max_drawdown",
        "label": "Maximum Drawdown",
        "hint":  "The largest peak-to-trough decline observed in the lookback "
                 "window, expressed as a percent loss. Tells you how deep the "
                 "worst loss has been historically — a key risk measure that "
                 "average volatility hides.",
    },
    {
        "id":    "sharpe_ratio",
        "label": "Sharpe Ratio",
        "hint":  "Excess return per unit of volatility. Higher is better; "
                 "above 1.0 is considered good, above 2.0 excellent. Lets you "
                 "compare strategies with different risk levels on the same "
                 "scale.",
    },
    {
        "id":    "portfolio_yield",
        "label": "Portfolio Yield",
        "hint":  "The weighted-average annual income yield of the portfolio, "
                 "expressed as a percent of total value. Combines dividend "
                 "yields, distribution yields, and any other recurring income.",
    },
    {
        "id":    "effective_tax_rate",
        "label": "Effective Tax Rate",
        "hint":  "Total federal income tax owed divided by total taxable income, "
                 "expressed as a percent. Distinct from the marginal bracket — "
                 "the effective rate is always lower than the marginal rate due "
                 "to the standard deduction and bracketed structure.",
    },
    {
        "id":    "alpha",
        "label": "Alpha",
        "hint":  "The portfolio's return in excess of what its beta-adjusted "
                 "benchmark exposure would predict. Positive alpha means it "
                 "outperformed the benchmark for the risk taken; negative "
                 "means it underperformed.",
    },
    {
        "id":    "income_stability",
        "label": "Income Stability",
        "hint":  "How consistent the portfolio's income stream is month-to-"
                 "month. High = predictable distributions across the year; "
                 "low = lumpy or concentrated in a few quarterly payers. "
                 "Derived from distribution-frequency analysis of held funds.",
    },
    {
        "id":    "win_rate",
        "label": "Win Rate",
        "hint":  "The percentage of simulated paths that meet or exceed the "
                 "target outcome (e.g. ending balance above zero, or income "
                 "fully covering spending). Higher win rates indicate more "
                 "robust outcomes across the modelled return scenarios.",
    },
    {
        "id":    "conv_score",
        "label": "Conversion Score",
        "hint":  "A 0-10 score reflecting how favourable conditions are for "
                 "executing a Roth conversion right now. Combines bracket "
                 "pressure, market drawdown depth, premium/NAV positioning, "
                 "and remaining annual conversion target.",
    },
    {
        "id":    "safe_harbor",
        "label": "Safe Harbor Status",
        "hint":  "Whether the user has paid enough in estimated taxes (or "
                 "withholding) to avoid an underpayment penalty. The IRS "
                 "safe-harbor rules require paying either 100% of last year's "
                 "tax (110% if AGI > $150K) OR 90% of this year's tax, "
                 "whichever is smaller.",
    },
    {
        "id":    "regime_transition",
        "label": "Regime Transition Risk",
        "hint":  "The probability that the current market regime (e.g. Expansion, "
                 "Consolidation, Risk-Off) shifts to a different regime over a "
                 "given horizon. Higher tension between bull and bear signals "
                 "reduces persistence and raises transition probability. "
                 "Based on historical NBER/GS regime duration data.",
    },
    {
        "id":    "liquidity_risk",
        "label": "Liquidity Risk",
        "hint":  "How well the portfolio's cash and money-market holdings cover "
                 "near-term spending needs. Low cash runway (under 6 months) or "
                 "low coverage ratio means the portfolio may need to liquidate "
                 "positions at an inconvenient time to meet expenses.",
    },
    {
        "id":    "stress_correlation",
        "label": "Stress Correlation",
        "hint":  "How much correlations between holdings rise during a market "
                 "shock (VIX > 25). Historically correlations jump 15–30% in "
                 "high-volatility regimes, reducing the diversification benefit "
                 "exactly when you need it most.",
    },
    {
        "id":    "withdrawal_rate",
        "label": "Withdrawal Rate",
        "hint":  "Annual portfolio withdrawals expressed as a percent of total "
                 "portfolio value. The classic '4% rule' suggests 4% is "
                 "historically sustainable over a 30-year retirement. Rates "
                 "above 5% carry meaningfully higher depletion risk.",
    },
    {
        "id":    "safe_spending",
        "label": "Safe Spending Range",
        "hint":  "The annual spending amount at which Monte Carlo simulations "
                 "show at least a 95% success rate (portfolio survives to age 100). "
                 "Spending above this threshold reduces the odds of a successful "
                 "retirement outcome below the 95% safety threshold.",
    },
    {
        "id":    "twrr",
        "label": "Time-Weighted Rate of Return (TWRR)",
        "hint":  "A performance measure that eliminates the distorting effect of "
                 "cash flows (deposits and withdrawals). It chains together the "
                 "returns of each sub-period between cash-flow events, giving a "
                 "true picture of how the portfolio itself performed, independent "
                 "of the investor's timing decisions.",
    },
    {
        "id":    "conversion_verdict",
        "label": "Conversion Verdict",
        "hint":  "The single Roth-conversion decision used across every tab. "
                 "Tax-optimal = bracket room minus the safety buffer; once YTD "
                 "conversions exceed it the verdict is STOP. Any remaining "
                 "plan-target amount is shown as a 'bracket-fill option' — it "
                 "still fits inside the bracket, but converting it is a choice, "
                 "not a recommendation.",
    },
    {
        "id":    "bracket_room",
        "label": "Bracket Room",
        "hint":  "Bracket ceiling minus projected gross income (which already "
                 "includes YTD conversions). How many more ordinary-income "
                 "dollars fit inside the target bracket before spilling into "
                 "the next rate.",
    },
    {
        "id":    "safe_room",
        "label": "Safe Room",
        "hint":  "Bracket room minus the configured safety buffer. The buffer "
                 "absorbs year-end dividend surprises and capital-gain "
                 "distributions so a December surprise doesn't push income "
                 "over the bracket ceiling.",
    },
    {
        "id":    "coverage_tracked",
        "label": "Coverage vs Tracked Spending",
        "hint":  "Forward 12-month dividends (all accounts) divided by tracked "
                 "annual spending from imported transactions. Over 100% means "
                 "dividends alone cover the lifestyle you actually live. Note "
                 "this differs from plan-spending coverage used in projections.",
    },
    {
        "id":    "taxable_div_gap",
        "label": "Taxable-Dividend Gap",
        "hint":  "Tracked spending minus dividends from TAXABLE accounts only. "
                 "IRA dividends are excluded because spending them requires a "
                 "withdrawal. A small gap means a small forced sale or IRA draw "
                 "covers the difference — this is the source of the withdrawal "
                 "number shown next to it.",
    },
    {
        "id":    "savings_rate",
        "label": "Savings Rate",
        "hint":  "Share of spendable income (W2 + dividends; Roth conversions "
                 "excluded because they are account transfers, not cash) that "
                 "is not spent. Above 20% is generally considered strong.",
    },
    {
        "id":    "cash_bucket",
        "label": "Cash Bucket (SWVXX Reserve)",
        "hint":  "A money-market reserve targeted at one year of tracked "
                 "spending. It decouples lifestyle spending from market moves: "
                 "spending draws from the bucket, dividends and controlled "
                 "sales refill it. 'Short' means the bucket is below the "
                 "1-year target and refilling takes priority.",
    },
    {
        "id":    "expense_basis",
        "label": "Expense Basis (Plan vs Tracked)",
        "hint":  "Which spending number a projection uses. PLAN = the Settings "
                 "estimate (deliberately conservative, includes buffer). "
                 "TRACKED = actual spending annualized from transactions. A "
                 "projection can show a deficit against PLAN while you run a "
                 "surplus against TRACKED — both are shown so they can't be "
                 "confused.",
    },
    {
        "id":    "income_target_drawdown",
        "label": "Income Target (Drawdown)",
        "hint":  "The annual income the drawdown strategies aim to generate. "
                 "Defaults to plan spending from Settings. Raising it toward "
                 "the bracket ceiling models aggressive bracket-fill harvesting "
                 "— useful for analysis, but it is a lever, not a target you "
                 "must hit.",
    },
    {
        "id":    "diversification_score",
        "label": "Diversification Score",
        "hint":  "100 = fully diversified, 0 = maximally concentrated. Measures "
                 "deviation from the diversification model (top-holding weight, "
                 "top-3 weight, volatility budget, fragility) — it says nothing "
                 "about income safety.",
    },
]


# ── Public API ────────────────────────────────────────────────────────────────

def get(metric_id: str) -> Optional[Dict[str, Any]]:
    """Return cached explainer for `metric_id`, or None if not yet baked."""
    if not metric_id:
        return None
    row = _dbm.cache_get(_CACHE_PREFIX + metric_id)
    if isinstance(row, dict) and row.get("text"):
        return row
    return None


def get_all() -> Dict[str, Dict[str, Any]]:
    """Return every explainer as a {metric_id: payload} dict.

    Prefers the LLM-baked version; falls back to the hand-written `hint` so a
    newly registered metric gets a working tooltip immediately (bake later to
    upgrade the copy).
    """
    out: Dict[str, Dict[str, Any]] = {}
    for m in METRICS:
        cached = get(m["id"])
        if cached:
            out[m["id"]] = cached
        elif m.get("hint"):
            out[m["id"]] = {"text": m["hint"], "model": "static-hint"}
    return out


def metric_ids() -> List[str]:
    """Stable list of registered metric ids."""
    return [m["id"] for m in METRICS]


def metric_label(metric_id: str) -> Optional[str]:
    """Display label for a metric (used in the tooltip header)."""
    for m in METRICS:
        if m["id"] == metric_id:
            return m["label"]
    return None


# ── Bake (LLM call → cache_kv) ───────────────────────────────────────────────

def _call_llm_for(metric: Dict[str, str], verbose: bool = False) -> Optional[Dict[str, Any]]:
    """One Ollama call for one metric. Returns the payload or None on failure.

    Set verbose=True to print the exact failure reason instead of just
    swallowing it — useful when the bake CLI reports "LLM unavailable"
    and you need to know WHY.
    """
    try:
        from ollama_client import is_ollama_running, get_api_key_names, query_ollama, get_available_models
    except Exception as e:
        if verbose:
            print(f"      └─ ollama_client import failed: {e}")
        return None

    user_msg = f"Metric: {metric['label']}\nDefinition: {metric['hint']}\n\nExplain it."

    # Prefer local Ollama; fall back to cloud if available. Same strategy as
    # briefing.narrate() — keep the user's existing config working.
    model: Optional[str] = None
    if is_ollama_running():
        all_models = get_available_models() or []
        local_models = [m for m in all_models if m.get("source") == "local" and m.get("id")]
        if local_models:
            model = local_models[0]["id"]
        elif verbose:
            print(f"      └─ Ollama running but get_available_models() returned no local entries "
                  f"({len(all_models)} total)")
    elif verbose:
        print(f"      └─ is_ollama_running() returned False — check localhost:11434")

    if model is None and get_api_key_names():
        model = "cloud:kimi-k2.5"
        if verbose:
            print(f"      └─ falling back to cloud:kimi-k2.5")
    if model is None:
        if verbose:
            print(f"      └─ no local Ollama model AND no cloud key in ai_keys.json")
        return None

    res = query_ollama(
        prompt=user_msg,
        model=model,
        system_prompt=_SYSTEM_PROMPT,
        temperature=0.2,
        max_tokens=220,
    )
    if not (res.get("success") and res.get("response")):
        if verbose:
            print(f"      └─ query_ollama({model}) returned: success={res.get('success')} "
                  f"error={res.get('error', '')[:120]}")
        return None
    return {
        "text":         res["response"].strip(),
        "model":        model,
        "generated_at": time.time(),
    }


def bake_all(force: bool = False, only: Optional[List[str]] = None,
             on_progress=None, verbose: bool = False) -> Dict[str, str]:
    """
    Generate explainers for every registered metric (or just `only`) and
    persist to cache_kv. Idempotent by default — skips metrics that already
    have a cached explainer. Pass force=True to regenerate.

    Set verbose=True to print the LLM-call failure reason under each
    failed metric (useful when debugging "LLM unavailable").

    Returns a {metric_id: status} dict where status is one of:
        "ok"      — generated and stored
        "cached"  — skipped, already present
        "failed"  — LLM call did not return text
    """
    target_ids = set(only) if only else None
    result: Dict[str, str] = {}
    for m in METRICS:
        mid = m["id"]
        if target_ids is not None and mid not in target_ids:
            continue
        cached = get(mid)
        if cached and not force:
            result[mid] = "cached"
            if on_progress:
                on_progress(mid, "cached", cached.get("text", ""))
            continue
        payload = _call_llm_for(m, verbose=verbose)
        if payload is None:
            result[mid] = "failed"
            if on_progress:
                on_progress(mid, "failed", "")
            continue
        _dbm.cache_set(_CACHE_PREFIX + mid, payload)
        result[mid] = "ok"
        if on_progress:
            on_progress(mid, "ok", payload["text"])
    return result


# ── CLI entrypoint ────────────────────────────────────────────────────────────

def _cli(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        prog="python -m server.explainers",
        description="Bake metric-explainer tooltips into cache_kv via the LLM.",
    )
    p.add_argument("--regen",  action="store_true", help="generate any missing explainers")
    p.add_argument("--force",  action="store_true", help="regenerate even if already cached")
    p.add_argument("--only",   nargs="+", help="restrict to these metric ids")
    p.add_argument("--dump",   action="store_true", help="print all baked explainers as JSON and exit")
    p.add_argument("--list",   action="store_true", help="print registered metric ids and exit")
    p.add_argument("--verbose","-v", action="store_true",
                   help="print the LLM-call failure reason under each failed metric")
    args = p.parse_args(argv)

    if args.list:
        for mid in metric_ids():
            print(mid)
        return 0

    if args.dump:
        print(json.dumps(get_all(), indent=2, default=str))
        return 0

    if not args.regen:
        p.print_help()
        return 1

    def _progress(mid: str, status: str, text: str) -> None:
        if status == "ok":
            print(f"  ✓ {mid:30s}  {text[:80]}...")
        elif status == "cached":
            print(f"  · {mid:30s}  (already cached)")
        else:
            print(f"  ✗ {mid:30s}  (LLM unavailable)")

    print(f"Baking {len(args.only) if args.only else len(METRICS)} explainer(s)…")
    result = bake_all(force=args.force, only=args.only, on_progress=_progress,
                      verbose=args.verbose)
    ok      = sum(1 for v in result.values() if v == "ok")
    cached  = sum(1 for v in result.values() if v == "cached")
    failed  = sum(1 for v in result.values() if v == "failed")
    print(f"Done. ok={ok} cached={cached} failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(_cli())
