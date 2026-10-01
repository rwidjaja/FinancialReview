"""
Withdrawal Strategy Optimizer.

Compares three strategies across the same set of Monte Carlo paths:
  income_first   — Use portfolio income first; sell taxable → rollover → roth
  total_return   — Sell proportionally across all accounts (classic)
  tax_optimized  — Rollover IRA first (shrinks RMDs) → taxable → roth last

All strategies run on identical return sequences so differences are purely
due to withdrawal order, not random variation.
"""

from __future__ import annotations
import numpy as np

from .core import (
    PortfolioState,
    _sim_kernel,
    _lognormal_returns,
    _success_at_ages,
    RUIN_THRESHOLD,
)

N_SIMS = 1000
STRATEGIES = {
    "income_first":  {"label": "Income-First",    "color": "#00b894", "description": "Use dividends & distributions first; sell taxable → rollover → Roth."},
    "total_return":  {"label": "Total Return",     "color": "#0984e3", "description": "Sell proportionally across all accounts regardless of income."},
    "tax_optimized": {"label": "Tax-Optimised",    "color": "#a29bfe", "description": "Rollover IRA first (shrinks future RMDs) → taxable → Roth last; maximises Roth tax-free compounding."},
}


def run_withdrawal_comparison(
    state: PortfolioState,
    seed: int = 42,
) -> dict:
    """
    Run all three withdrawal strategies and return comparison metrics.

    Returns
    -------
    {
      "strategies": {
        "income_first": {
          "label", "description", "color",
          "success_rates": {85: ..., 90: ..., 95: ...},
          "overall_success": float,
          "median_ending":   float,
          "median_roth_ending": float,
          "median_rollover_ending": float,
          "p10_ending": float, "p90_ending": float,
          "median_path": [...],
        }, ...
      },
      "ages":   [...],
      "inputs": dict,
      "winner": "income_first" | "total_return" | "tax_optimized",
    }
    """
    n_years = state.target_age - state.current_age
    returns = _lognormal_returns(state.expected_return, state.volatility, (N_SIMS, n_years), seed=seed)

    results: dict = {"strategies": {}, "ages": None, "inputs": state.to_dict()}

    for key, meta in STRATEGIES.items():
        sim   = _sim_kernel(state, returns, withdrawal_strategy=key)
        total = sim["total"]

        if results["ages"] is None:
            results["ages"] = sim["ages"]

        succ    = _success_at_ages(total, state.current_age, threshold=state.ruin_threshold)
        overall = float(np.all(total >= state.ruin_threshold, axis=1).mean())
        ending  = total[:, -1]

        results["strategies"][key] = {
            "label":                  meta["label"],
            "description":            meta["description"],
            "color":                  meta["color"],
            "success_rates":          succ,
            "overall_success":        overall,
            "median_ending":          float(np.median(ending)),
            "p10_ending":             float(np.percentile(ending, 10)),
            "p90_ending":             float(np.percentile(ending, 90)),
            "median_roth_ending":     float(np.median(sim["roth"][:, -1])),
            "median_rollover_ending": float(np.median(sim["rollover"][:, -1])),
            "median_taxable_ending":  float(np.median(sim["taxable"][:, -1])),
            "median_path":            np.percentile(total, 50, axis=0).tolist(),
            "p10_path":               np.percentile(total, 10, axis=0).tolist(),
            "p90_path":               np.percentile(total, 90, axis=0).tolist(),
        }

    # Identify winner by highest overall_success, break ties by median ending
    best = max(
        results["strategies"],
        key=lambda k: (
            results["strategies"][k]["overall_success"],
            results["strategies"][k]["median_ending"],
        ),
    )
    results["winner"] = best
    return results
