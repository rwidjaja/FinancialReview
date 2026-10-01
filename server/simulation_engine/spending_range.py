"""
Safe Spending Range Calculator.

Grid-searches spending levels and maps each to a probability of success,
then finds the thresholds for Safe (95%), Comfortable (85%), Aggressive (70%).
"""

from __future__ import annotations
import numpy as np

from .core import (
    PortfolioState,
    _sim_kernel,
    _lognormal_returns,
    RUIN_THRESHOLD,
)

N_SIMS = 500   # enough for 5 % resolution on probability


def find_safe_spending(
    state: PortfolioState,
    seed: int = 42,
    grid_min: float | None = None,
    grid_max: float | None = None,
    n_steps: int = 20,
) -> dict:
    """
    Run Monte Carlo at each spending level in the grid and return
    the probability-of-success curve plus labelled thresholds.

    Returns
    -------
    {
      "spending_levels": [float, ...],
      "success_probs":   [float, ...],   # fraction 0–1
      "thresholds": {
        "safe":        {"spending": float, "prob": float},   # ≥ 95 %
        "comfortable": {"spending": float, "prob": float},   # ≥ 85 %
        "aggressive":  {"spending": float, "prob": float},   # ≥ 70 %
      },
      "current_spending": float,
      "current_prob":     float,
      "inputs":           dict,
    }
    """
    total_port = state.total_portfolio
    if grid_min is None:
        grid_min = max(60_000.0,  total_port * 0.02)
    if grid_max is None:
        grid_max = min(500_000.0, total_port * 0.12)

    levels = np.linspace(grid_min, grid_max, n_steps)
    n_years = state.target_age - state.current_age
    returns = _lognormal_returns(state.expected_return, state.volatility, (N_SIMS, n_years), seed=seed)

    probs: list[float] = []
    import dataclasses

    for spend in levels:
        s2 = dataclasses.replace(state, annual_spending=float(spend))
        sim   = _sim_kernel(s2, returns)
        total = sim["total"]
        surv  = float(np.all(total >= state.ruin_threshold, axis=1).mean())
        probs.append(round(surv, 4))

    # Find thresholds (highest spending where prob ≥ threshold)
    def _threshold(target_prob: float) -> dict:
        candidates = [(l, p) for l, p in zip(levels, probs) if p >= target_prob]
        if not candidates:
            return {"spending": float(levels[0]), "prob": float(probs[0])}
        lv, pr = max(candidates, key=lambda x: x[0])
        return {"spending": float(round(lv)), "prob": float(pr)}

    # Compute success prob at the current spending level
    s2 = dataclasses.replace(state, annual_spending=state.annual_spending)
    sim_cur = _sim_kernel(s2, returns)
    current_prob = float(np.all(sim_cur["total"] >= state.ruin_threshold, axis=1).mean())

    return {
        "spending_levels": [float(round(l)) for l in levels],
        "success_probs":   probs,
        "thresholds": {
            "safe":        _threshold(0.95),
            "comfortable": _threshold(0.85),
            "aggressive":  _threshold(0.70),
        },
        "current_spending": state.annual_spending,
        "current_prob":     round(current_prob, 4),
        "inputs":           state.to_dict(),
    }
