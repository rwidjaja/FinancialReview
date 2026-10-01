"""
Lifetime Projection — Monte Carlo simulation.

Runs N independent paths, returns percentile fan-chart data and
probability-of-success at multiple ages.
"""

from __future__ import annotations
import numpy as np

from .core import (
    PortfolioState,
    _sim_kernel,
    _lognormal_returns,
    _percentile_paths,
    _success_at_ages,
    RUIN_THRESHOLD,
)

# Bad-start stress prefix: first 5 years of returns before random tail
_BAD_START_PREFIX = np.array([-0.20, -0.15, -0.10, -0.05, +0.05], dtype=np.float64)


def run_monte_carlo(
    state: PortfolioState,
    n_sims: int = 1000,
    seed: int = 42,
) -> dict:
    """
    Run N lifetime simulations and compute the sequence-of-returns risk penalty.

    Returns
    -------
    {
      "ages": [...],
      "percentiles": {"5": [...], "10": [...], "25": [...], "50": [...],
                       "75": [...], "90": [...], "95": [...]},
      "success_rates": {85: 0.92, 90: 0.87, 95: 0.79, 100: 0.61},
      "overall_success": float,
      "median_ending": float,
      "p10_ending": float, "p25_ending": float,
      "p75_ending": float, "p90_ending": float,
      "sequence_risk_penalty": float,   # Δ median ending: baseline − bad_start
      "sequence_risk_pct":     float,   # penalty as % of starting portfolio
      "n_sims":        int,
      "inputs":        dict,
      "ruin_threshold": float,
      "account_split": dict,
    }
    """
    n_years = state.target_age - state.current_age
    returns = _lognormal_returns(state.expected_return, state.volatility, (n_sims, n_years), seed=seed)

    # ── Baseline simulation ───────────────────────────────────────────────────
    sim   = _sim_kernel(state, returns)
    total = sim["total"]   # (n_sims, n_years+1)

    ruin = state.ruin_threshold   # dynamic: max($25K, 50% of annual spending)

    pcts   = _percentile_paths(total)
    succ   = _success_at_ages(total, state.current_age, threshold=ruin)
    ending = total[:, -1]
    overall_success = float(np.all(total >= ruin, axis=1).mean())
    median_end      = float(np.median(ending))

    # ── Sequence-risk penalty: same tail, bad first 5 years ──────────────────
    n_prefix = len(_BAD_START_PREFIX)
    fixed    = np.tile(_BAD_START_PREFIX, (n_sims, 1))
    tail     = returns[:, n_prefix:].copy()
    returns_bad = np.concatenate([fixed, tail], axis=1)

    sim_bad     = _sim_kernel(state, returns_bad)
    median_bad  = float(np.median(sim_bad["total"][:, -1]))
    penalty     = median_end - median_bad
    port_total  = state.total_portfolio or 1.0

    return {
        "ages":             sim["ages"],
        "percentiles":      pcts,
        "success_rates":    succ,
        "overall_success":  overall_success,
        "median_ending":    median_end,
        "p10_ending":       float(np.percentile(ending, 10)),
        "p25_ending":       float(np.percentile(ending, 25)),
        "p75_ending":       float(np.percentile(ending, 75)),
        "p90_ending":       float(np.percentile(ending, 90)),
        "sequence_risk_penalty": penalty,
        "sequence_risk_pct":     penalty / port_total,
        "n_sims":           n_sims,
        "inputs":           state.to_dict(),
        "ruin_threshold":   ruin,
        # Account breakdown at median
        "account_split": {
            "taxable":  np.percentile(sim["taxable"][:, -1],  50).tolist(),
            "rollover": np.percentile(sim["rollover"][:, -1], 50).tolist(),
            "roth":     np.percentile(sim["roth"][:, -1],     50).tolist(),
        },
    }
