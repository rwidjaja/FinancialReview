"""
What-If Sandbox.

Runs the Monte Carlo engine twice — baseline vs user-defined overrides —
and returns side-by-side comparison so the impact of each change is clear.
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

N_SIMS = 1000

# Same bad-start prefix used in monte_carlo.py for consistency
_BAD_START_PREFIX = np.array([-0.20, -0.15, -0.10, -0.05, +0.05], dtype=np.float64)


def _run_one(state: PortfolioState, returns: np.ndarray) -> dict:
    """Run a single scenario and return a compact summary."""
    sim   = _sim_kernel(state, returns)
    total = sim["total"]
    succ  = _success_at_ages(total, state.current_age, threshold=state.ruin_threshold)
    overall = float(np.all(total >= state.ruin_threshold, axis=1).mean())
    ending  = total[:, -1]
    return {
        "success_rates":   succ,
        "overall_success": overall,
        "median_ending":   float(np.median(ending)),
        "p10_ending":      float(np.percentile(ending, 10)),
        "p25_ending":      float(np.percentile(ending, 25)),
        "p75_ending":      float(np.percentile(ending, 75)),
        "p90_ending":      float(np.percentile(ending, 90)),
        "median_path":     np.percentile(total, 50, axis=0).tolist(),
        "p10_path":        np.percentile(total, 10, axis=0).tolist(),
        "p90_path":        np.percentile(total, 90, axis=0).tolist(),
        "median_roth":     float(np.median(sim["roth"][:, -1])),
    }


def run_sandbox(
    state: PortfolioState,
    overrides: dict,
    seed: int = 42,
) -> dict:
    """
    Compare baseline PortfolioState vs the state with `overrides` applied.

    Parameters
    ----------
    state     : baseline PortfolioState (already loaded from app data)
    overrides : dict of field→new_value to apply for the scenario

    Returns
    -------
    {
      "ages":     [...],
      "baseline": { success_rates, overall_success, median_ending, ... },
      "scenario": { success_rates, overall_success, median_ending, ... },
      "delta": {
        "overall_success": float,
        "median_ending":   float,
        "p10_ending":      float,
      },
      "scenario_inputs":  dict,
      "baseline_inputs":  dict,
      "overrides":        dict,
    }
    """
    scenario_state = state.apply_overrides(overrides)
    n_years        = state.target_age - state.current_age
    returns        = _lognormal_returns(state.expected_return, state.volatility, (N_SIMS, n_years), seed=seed)

    # Use the same return matrix for both so delta is purely from overrides
    # (For return/vol changes, regenerate returns for scenario only)
    ret_changed = (
        overrides.get("expected_return") is not None
        or overrides.get("volatility") is not None
    )
    if ret_changed:
        returns_scenario = _lognormal_returns(
            scenario_state.expected_return,
            scenario_state.volatility,
            (N_SIMS, n_years),
            seed=seed,
        )
    else:
        returns_scenario = returns

    baseline = _run_one(state, returns)
    scenario = _run_one(scenario_state, returns_scenario)

    delta = {
        "overall_success": round(scenario["overall_success"] - baseline["overall_success"], 4),
        "median_ending":   round(scenario["median_ending"]   - baseline["median_ending"],   2),
        "p10_ending":      round(scenario["p10_ending"]      - baseline["p10_ending"],      2),
    }

    # ── Sequence-risk sensitivity ─────────────────────────────────────────────
    # Replace the first N years with the bad-start prefix, keep the same random
    # tail so the delta is purely from the early sequence, not Monte Carlo noise.
    n_prefix = len(_BAD_START_PREFIX)
    fixed_rows = np.tile(_BAD_START_PREFIX, (N_SIMS, 1))

    returns_bad_base = np.concatenate([fixed_rows, returns[:, n_prefix:]], axis=1)
    sim_bad_base     = _sim_kernel(state, returns_bad_base)
    median_bad_base  = float(np.median(sim_bad_base["total"][:, -1]))

    # For scenario: use returns_scenario tail (may differ if ret/vol overridden)
    returns_bad_scen = np.concatenate([fixed_rows, returns_scenario[:, n_prefix:]], axis=1)
    sim_bad_scen     = _sim_kernel(scenario_state, returns_bad_scen)
    median_bad_scen  = float(np.median(sim_bad_scen["total"][:, -1]))

    seq_penalty_base = baseline["median_ending"] - median_bad_base   # $ lost to bad sequence
    seq_penalty_scen = scenario["median_ending"] - median_bad_scen
    delta_penalty    = seq_penalty_scen - seq_penalty_base            # + = scenario more fragile

    seq_risk = {
        "baseline_penalty":  round(seq_penalty_base, 2),
        "scenario_penalty":  round(seq_penalty_scen, 2),
        "delta_penalty":     round(delta_penalty,    2),
        "baseline_pct":      round(seq_penalty_base / max(baseline["median_ending"], 1), 4),
        "scenario_pct":      round(seq_penalty_scen / max(scenario["median_ending"], 1), 4),
    }

    # Build sim["ages"] from baseline state
    ages = list(range(state.current_age, state.target_age + 1))

    return {
        "ages":             ages,
        "baseline":         baseline,
        "scenario":         scenario,
        "delta":            delta,
        "seq_risk":         seq_risk,
        "baseline_inputs":  state.to_dict(),
        "scenario_inputs":  scenario_state.to_dict(),
        "overrides":        overrides,
    }
