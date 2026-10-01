"""
Sequence-of-Returns Stress Tests.

Each scenario replaces the first N years' returns with a historical or
stress sequence, then reverts to stochastic draws afterwards.
The same random tail is used for all scenarios so differences are purely
due to the early sequence, not Monte Carlo noise.
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

# ── Pre-defined stress sequences (first-N-years returns) ─────────────────────
SCENARIOS: dict[str, dict] = {
    "normal": {
        "label":       "Baseline (Random)",
        "description": "Pure Monte Carlo — no fixed early sequence.",
        "color":       "#00b894",
        "prefix":      [],   # no override; use full random
    },
    "bad_start": {
        "label":       "Bad First 5 Years",
        "description": "Early -20%, -15%, -10%, -5%, +5% then mean-reversion.",
        "color":       "#e17055",
        "prefix":      [-0.20, -0.15, -0.10, -0.05, +0.05],
    },
    "2008": {
        "label":       "2008 Crash",
        "description": "Replicates 2006-2011: +16%, +5%, -37%, +26%, +15%, +2%.",
        "color":       "#d63031",
        "prefix":      [+0.16, +0.05, -0.37, +0.26, +0.15, +0.02],
    },
    "dotcom": {
        "label":       "Dot-com Bust",
        "description": "Replicates 2000-2004: -9%, -12%, -22%, +29%, +11%.",
        "color":       "#fdcb6e",
        "prefix":      [-0.09, -0.12, -0.22, +0.29, +0.11],
    },
    "stagflation": {
        "label":       "Stagflation",
        "description": "Low returns + high inflation (1970s style): 5 years of +3%, -7%, -4%, +2%, +5%.",
        "color":       "#a29bfe",
        "prefix":      [+0.03, -0.07, -0.04, +0.02, +0.05],
    },
    "bull_start": {
        "label":       "Bull Market Start",
        "description": "Lucky first 5 years: +25%, +20%, +15%, +18%, +12%.",
        "color":       "#55efc4",
        "prefix":      [+0.25, +0.20, +0.15, +0.18, +0.12],
    },
}

N_SIMS = 500   # scenarios share a common random tail; 500 is plenty


def run_sequence_stress(
    state: PortfolioState,
    seed: int = 42,
) -> dict:
    """
    Run all stress scenarios and return per-scenario summary + fan paths.

    Returns
    -------
    {
      "scenarios": {
        "normal": {
          "label", "description", "color",
          "success_rates": {85: ..., 90: ..., 95: ...},
          "overall_success": float,
          "median_path": [...],
          "p10_path":    [...],
          "p90_path":    [...],
          "median_ending": float,
        }, ...
      },
      "ages":   [...],
      "inputs": dict,
    }
    """
    n_years = state.target_age - state.current_age

    # Build a shared stochastic tail (same random draws for all scenarios)
    full_random = _lognormal_returns(
        state.expected_return, state.volatility, (N_SIMS, n_years), seed=seed
    )

    results: dict = {"scenarios": {}, "ages": None, "inputs": state.to_dict()}

    for key, meta in SCENARIOS.items():
        prefix = meta["prefix"]
        n_prefix = len(prefix)

        if n_prefix == 0:
            returns = full_random.copy()
        else:
            # Replace first n_prefix columns with deterministic sequence
            fixed = np.tile(np.array(prefix, dtype=np.float64), (N_SIMS, 1))
            tail  = full_random[:, n_prefix:].copy()
            returns = np.concatenate([fixed, tail], axis=1)

        sim   = _sim_kernel(state, returns)
        total = sim["total"]

        if results["ages"] is None:
            results["ages"] = sim["ages"]

        succ    = _success_at_ages(total, state.current_age, threshold=state.ruin_threshold)
        overall = float(np.all(total >= state.ruin_threshold, axis=1).mean())
        ending  = total[:, -1]

        results["scenarios"][key] = {
            "label":           meta["label"],
            "description":     meta["description"],
            "color":           meta["color"],
            "success_rates":   succ,
            "overall_success": overall,
            "median_path":     np.percentile(total, 50, axis=0).tolist(),
            "p10_path":        np.percentile(total, 10, axis=0).tolist(),
            "p90_path":        np.percentile(total, 90, axis=0).tolist(),
            "median_ending":   float(np.median(ending)),
            "p10_ending":      float(np.percentile(ending, 10)),
        }

    return results
