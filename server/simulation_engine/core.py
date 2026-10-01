"""
Core data structures and shared simulation kernel.

PortfolioState holds all inputs shared by every module.
_sim_kernel() runs the inner year-by-year loop given a pre-built returns matrix.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import numpy as np


RUIN_THRESHOLD = 25_000.0   # portfolio < $25K → consider ruined


@dataclass
class PortfolioState:
    # ── Account balances ─────────────────────────────────────────────────────
    taxable:      float = 0.0     # taxable brokerage
    rollover_ira: float = 0.0     # pre-tax IRA / 401k
    roth_ira:     float = 0.0     # Roth IRA (incl. external Roth 401k)
    cash:         float = 0.0     # money-market / savings

    # ── Personal ─────────────────────────────────────────────────────────────
    current_age:  int   = 59
    target_age:   int   = 100     # simulate to this age
    retirement_year: int = 0      # calendar year of retirement; 0 = not set

    # ── Income sources ────────────────────────────────────────────────────────
    portfolio_income_annual: float = 0.0    # annual dividends/distributions
    ss_annual:               float = 60084.0
    ss_start_age:            int   = 70
    spouse_ss_annual:        float = 0.0    # spousal benefit (1/2 earner); 0 = not modeled
    spouse_ss_start_age:     int   = 70     # earner's age when spouse starts collecting
    pension_annual:          float = 0.0    # any fixed pension / annuity

    # ── Spending ──────────────────────────────────────────────────────────────
    annual_spending: float = 150_000.0
    spending_phases: bool  = True           # go-go/slow-go/no-go multipliers

    # ── Market assumptions ────────────────────────────────────────────────────
    expected_return: float = 0.07    # annualised nominal return
    volatility:      float = 0.15    # annualised std-dev
    inflation:       float = 0.025

    # ── Roth conversion ───────────────────────────────────────────────────────
    roth_conversion_annual: float = 100_000.0
    rmd_start_age:          int   = 75  # SECURE 2.0: born 1960+ starts at 75

    # ── Income growth ─────────────────────────────────────────────────────────
    portfolio_income_growth: float = 0.03   # fixed annual growth on portfolio income (default 3 %)

    # ── Tax (simplified flat rate for simulation) ─────────────────────────────
    # Default is overridden at load time by portfolio_loader using _TAX_RULE_ENGINE config
    marginal_rate:      float = 0.24
    filing_status:      str   = "MFJ"
    standard_deduction: float = 32_200.0

    # ── Display metadata (not used in simulation math) ────────────────────────
    external_total:       float = 0.0   # non-Schwab accounts included in total (for UI breakdown)
    live_expected_return: float = 0.0   # trailing 1Y return from live holdings (informational only)
    live_volatility:      float = 0.0   # weighted vol before clamping (informational)

    @property
    def total_portfolio(self) -> float:
        return self.taxable + self.rollover_ira + self.roth_ira + self.cash

    @property
    def ruin_threshold(self) -> float:
        """Minimum portfolio considered solvent: max($25K floor, 50% of annual spending)."""
        return max(RUIN_THRESHOLD, 0.5 * self.annual_spending)

    def apply_overrides(self, overrides: dict) -> "PortfolioState":
        """Return a *new* state with the given key→value overrides applied."""
        import dataclasses
        vals = dataclasses.asdict(self)
        vals.update({k: v for k, v in overrides.items() if k in vals})
        return PortfolioState(**vals)

    def to_dict(self) -> dict:
        return {
            "taxable":      self.taxable,
            "rollover_ira": self.rollover_ira,
            "roth_ira":     self.roth_ira,
            "cash":         self.cash,
            "total":        self.total_portfolio,
            "current_age":  self.current_age,
            "target_age":   self.target_age,
            "annual_spending":          self.annual_spending,
            "expected_return":          self.expected_return,
            "volatility":               self.volatility,
            "inflation":                self.inflation,
            "ss_annual":                self.ss_annual,
            "ss_start_age":             self.ss_start_age,
            "spouse_ss_annual":         self.spouse_ss_annual,
            "spouse_ss_start_age":      self.spouse_ss_start_age,
            "portfolio_income_annual":  self.portfolio_income_annual,
            "roth_conversion_annual":   self.roth_conversion_annual,
            "marginal_rate":            self.marginal_rate,
            "external_total":           self.external_total,
            "schwab_total":             self.total_portfolio - self.external_total,
            "live_expected_return":     self.live_expected_return,
            "live_volatility":          self.live_volatility,
            "ruin_threshold":           self.ruin_threshold,
        }


# ── Shared simulation kernel ──────────────────────────────────────────────────

def _sim_kernel(
    state: PortfolioState,
    returns_matrix: np.ndarray,
    withdrawal_strategy: str = "income_first",
) -> dict:
    """
    Year-by-year simulation loop.

    Parameters
    ----------
    state            : PortfolioState inputs
    returns_matrix   : (n_sims, n_years) float array of annual returns
    withdrawal_strategy : "income_first" | "total_return" | "tax_optimized"

    Returns
    -------
    dict with keys:
      ages, total, taxable, rollover, roth   — (n_sims, n_years+1) arrays
      ruin_threshold
    """
    n_sims, n_years = returns_matrix.shape

    # Initialise per-account balance vectors
    bal_tx  = np.full(n_sims, state.taxable,      dtype=np.float64)
    bal_ro  = np.full(n_sims, state.rollover_ira, dtype=np.float64)
    bal_rth = np.full(n_sims, state.roth_ira,     dtype=np.float64)

    # History storage
    hist_tx  = np.zeros((n_sims, n_years + 1))
    hist_ro  = np.zeros((n_sims, n_years + 1))
    hist_rth = np.zeros((n_sims, n_years + 1))

    hist_tx[:, 0]  = bal_tx
    hist_ro[:, 0]  = bal_ro
    hist_rth[:, 0] = bal_rth

    ss_delay = max(0, state.ss_start_age - state.current_age)

    for yr in range(n_years):
        age = state.current_age + yr
        r   = returns_matrix[:, yr]

        # ── Grow accounts ──────────────────────────────────────────────────
        bal_tx  = np.maximum(0.0, bal_tx  * (1.0 + r))
        bal_ro  = np.maximum(0.0, bal_ro  * (1.0 + r))
        bal_rth = np.maximum(0.0, bal_rth * (1.0 + r))

        inf_factor    = (1.0 + state.inflation) ** yr
        income_factor = (1.0 + state.portfolio_income_growth) ** yr   # fixed 3 % income growth

        # ── Income ────────────────────────────────────────────────────────
        income = state.portfolio_income_annual * income_factor   # dividends grow at portfolio_income_growth
        if age >= state.ss_start_age:
            ss_yr   = yr - ss_delay
            income += state.ss_annual * ((1.0 + state.inflation) ** ss_yr)  # SS COLA = inflation from SS-start age
        if state.spouse_ss_annual > 0 and age >= state.spouse_ss_start_age:
            sp_ss_yr = age - state.spouse_ss_start_age
            income += state.spouse_ss_annual * ((1.0 + state.inflation) ** sp_ss_yr)
        income += state.pension_annual * inf_factor

        # ── Spending with phase adjustment ─────────────────────────────────
        mult = 1.0
        if state.spending_phases:
            if   age < 75: mult = 1.10
            elif age < 85: mult = 1.00
            else:          mult = 0.75
        spending = state.annual_spending * inf_factor * mult

        # ── Net withdrawal after income ────────────────────────────────────
        net_need = np.maximum(0.0, spending - income)

        if withdrawal_strategy == "total_return":
            # Pro-rata across all accounts by current balance
            total = bal_tx + bal_ro + bal_rth + 1e-9
            w_tx  = net_need * bal_tx  / total
            w_ro  = net_need * bal_ro  / total
            w_rth = net_need * bal_rth / total
            bal_tx  = np.maximum(0.0, bal_tx  - w_tx)
            bal_ro  = np.maximum(0.0, bal_ro  - w_ro)
            bal_rth = np.maximum(0.0, bal_rth - w_rth)

        elif withdrawal_strategy == "tax_optimized":
            # Rollover IRA → Taxable → Roth: drain pre-tax first to reduce future
            # RMD burden; Roth stays last for tax-free compounding.
            from_ro  = np.minimum(bal_ro, net_need)
            rem      = net_need - from_ro
            bal_ro  -= from_ro
            from_tx  = np.minimum(bal_tx, rem)
            rem     -= from_tx
            bal_tx  -= from_tx
            from_rth = np.minimum(bal_rth, rem)
            bal_rth -= from_rth

        else:  # income_first (default)
            # Taxable first (income already subtracted), then rollover, then roth
            from_tx  = np.minimum(bal_tx, net_need)
            rem      = net_need - from_tx
            bal_tx  -= from_tx
            from_ro  = np.minimum(bal_ro, rem)
            rem     -= from_ro
            bal_ro  -= from_ro
            from_rth = np.minimum(bal_rth, rem)
            bal_rth -= from_rth

        # ── Roth conversion (pre-RMD age only) ────────────────────────────
        if age < state.rmd_start_age and state.roth_conversion_annual > 0:
            conv    = np.minimum(bal_ro, state.roth_conversion_annual)
            bal_ro -= conv
            bal_rth += conv

        hist_tx[:, yr + 1]  = np.maximum(0.0, bal_tx)
        hist_ro[:, yr + 1]  = np.maximum(0.0, bal_ro)
        hist_rth[:, yr + 1] = np.maximum(0.0, bal_rth)

    ages = list(range(state.current_age, state.current_age + n_years + 1))
    return {
        "ages":     ages,
        "total":    hist_tx + hist_ro + hist_rth,
        "taxable":  hist_tx,
        "rollover": hist_ro,
        "roth":     hist_rth,
    }


def _lognormal_returns(mu: float, sigma: float, shape: tuple, seed: int = 42) -> np.ndarray:
    """Draw lognormal returns E[R] ≈ mu with std-dev ≈ sigma."""
    rng   = np.random.default_rng(seed)
    mu_ln = np.log(1.0 + mu) - 0.5 * sigma ** 2
    return rng.lognormal(mu_ln, sigma, shape) - 1.0


def _percentile_paths(total: np.ndarray, pcts=(5, 10, 25, 50, 75, 90, 95)) -> dict:
    """Compute percentile fan-chart data from (n_sims, n_years+1) array."""
    return {str(p): np.percentile(total, p, axis=0).tolist() for p in pcts}


def _success_at_ages(
    total: np.ndarray,
    current_age: int,
    check_ages=(85, 90, 95, 100),
    threshold: float = RUIN_THRESHOLD,
) -> dict:
    """Fraction of paths still solvent at each check age."""
    out = {}
    for chk in check_ages:
        yr = chk - current_age
        if yr < 0 or yr >= total.shape[1]:
            continue
        survived = np.all(total[:, : yr + 1] >= threshold, axis=1)
        out[chk] = float(survived.mean())
    return out
