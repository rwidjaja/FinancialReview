"""
Simulation engine for retirement/survival projections.

Modules:
  core.py               — PortfolioState dataclass + shared simulation kernel
  portfolio_loader.py   — Load PortfolioState from live app cache + input.json
  monte_carlo.py        — Lifetime projection (Monte Carlo fan chart)
  sequence_risk.py      — Sequence-of-returns stress scenarios
  withdrawal_optimizer.py — Income-first / total-return / tax-optimised comparison
  spending_range.py     — Safe spending range (grid search → probability curve)
  sandbox.py            — What-if sandbox (param overrides → baseline vs scenario)
"""

from .core import PortfolioState
from .portfolio_loader import load_from_app_data
from .monte_carlo import run_monte_carlo
from .sequence_risk import run_sequence_stress
from .withdrawal_optimizer import run_withdrawal_comparison
from .spending_range import find_safe_spending
from .sandbox import run_sandbox

__all__ = [
    "PortfolioState",
    "load_from_app_data",
    "run_monte_carlo",
    "run_sequence_stress",
    "run_withdrawal_comparison",
    "find_safe_spending",
    "run_sandbox",
]
