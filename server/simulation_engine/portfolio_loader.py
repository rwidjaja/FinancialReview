"""
Load a PortfolioState from the live app cache + input.json.

Called by the /api/simulate endpoint so simulations always start from
the actual current portfolio—no hardcoding needed.
"""

from __future__ import annotations
import json
import os
from datetime import date
from typing import Any, Dict, Optional

from .core import PortfolioState

_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_input() -> dict:
    path = os.path.join(_DIR, "input.json")
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def _current_age(dob_str: str) -> int:
    """Return age today given 'YYYY-MM-DD'."""
    try:
        dob = date.fromisoformat(dob_str)
        today = date.today()
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    except Exception:
        return 59


def _age_deduction_bonus(tb_cfg: dict, primary_age, spouse_age) -> float:
    """Additional standard deduction for age-65+ filers.

    Two components (both per qualifying person):
      1. IRS age-65 additional deduction — permanent, indexed annually.
      2. Temporary senior deduction (TCJA-era provision, 2025–2028).
    Both values live in tax_brackets.json so they can be updated each year
    without touching code.
    """
    age_65_add  = float(tb_cfg.get("age_65_additional_deduction_per_person", 1650))
    senior_add  = float(tb_cfg.get("senior_deduction_per_person", 6000))
    senior_exp  = int(tb_cfg.get("senior_deduction_expires_year", 2028))
    qualifying  = sum(1 for a in (primary_age, spouse_age) if a is not None and a >= 65)
    bonus       = age_65_add * qualifying
    bonus      += senior_add * qualifying if date.today().year <= senior_exp else 0
    return bonus


def _account_balance(cached_data: dict, key: str) -> float:
    """Sum market value for a given account key from cached portfolio data."""
    if not cached_data:
        return 0.0
    for acct in (cached_data.get("accounts") or []):
        if (acct.get("key") or "").lower() == key.lower():
            return float(acct.get("value", 0) or 0)
    return 0.0


def load_from_app_data(
    cached_data: Optional[dict] = None,
    overrides: Optional[dict] = None,
) -> PortfolioState:
    """
    Build a PortfolioState from the live portfolio cache and input.json.

    Parameters
    ----------
    cached_data : the dict returned by portfolio_data.fetch_all_data()
    overrides   : optional dict of field→value to override after loading

    Returns
    -------
    PortfolioState ready for simulation
    """
    cfg = _load_input()
    personal = cfg.get("_PERSONAL", {})
    target   = cfg.get("_TARGET_ALLOC", {})
    external = target.get("external_accounts", {})

    # ── Personal ─────────────────────────────────────────────────────────────
    dob             = personal.get("dob", "1966-12-31")
    current_age     = _current_age(dob)
    ss_start        = int(personal.get("ss_start_age", 70))
    retirement_year = int(personal.get("retirement_year", 0) or 0)

    # SS benefit at chosen start age
    ss_data    = personal.get("social_security", {})
    ss_key_map = {62: "age_62", 65: "age_65", 67: "age_67", 70: "age_70"}
    ss_entry   = ss_data.get(ss_key_map.get(ss_start, "age_70"), {})
    ss_annual  = float(ss_entry.get("annual", 60084))

    # Spousal SS: 1/2 earner benefit starting at spouse's claiming age
    spouse_cfg       = personal.get("spouse", {})
    spouse_dob       = spouse_cfg.get("dob", "")
    spouse_ss_start  = int(spouse_cfg.get("ss_start_age", 70))
    spouse_ss_annual = ss_annual * 0.5 if spouse_dob else 0.0
    # Convert spouse claiming age to earner-age-equivalent
    spouse_current_age = _current_age(spouse_dob) if spouse_dob else None
    spouse_ss_earner_start = int(current_age + (spouse_ss_start - spouse_current_age)) if spouse_current_age else 999

    # Filing status → standard deduction + target marginal rate
    # Priority: personal.json._TAX_SETTINGS > rules.json._TAX_RULE_ENGINE
    tax_cfg      = cfg.get("_TAX_BRACKETS", {})
    tre_cfg      = cfg.get("_TAX_RULE_ENGINE", {})
    tax_settings = cfg.get("_TAX_SETTINGS", {})   # personal.json — user's target bracket
    filing       = personal.get("filing_status", "MFJ")
    std_ded      = float(
        tax_cfg.get("standard_deduction_mfj", 32200)
        if filing == "MFJ"
        else tax_cfg.get("standard_deduction_single", 15000)
    )
    std_ded += _age_deduction_bonus(tax_cfg, current_age, spouse_current_age)
    # Marginal rate = user's target bracket from personal.json (fallback to rules.json, then 24)
    _target_rate_pct = float(
        tax_settings.get("target_bracket_rate") or tre_cfg.get("target_bracket_rate", 24)
    )
    marginal_rate    = _target_rate_pct / 100.0

    # ── Account balances ──────────────────────────────────────────────────────
    schwab_taxable  = _account_balance(cached_data, "taxable")
    schwab_rollover = _account_balance(cached_data, "rollover_ira")
    schwab_roth     = _account_balance(cached_data, "roth_ira")
    schwab_total    = schwab_taxable + schwab_rollover + schwab_roth

    # External non-Schwab accounts (from input.json _TARGET_ALLOC.external_accounts)
    ext_k401_roth  = float(external.get("k401_roth", 0) or 0)
    ext_k401       = float(external.get("k401",      0) or 0)
    external_total = ext_k401_roth + ext_k401

    taxable  = schwab_taxable
    rollover = schwab_rollover + ext_k401       # merge external pre-tax 401k
    roth     = schwab_roth     + ext_k401_roth  # merge external Roth 401k

    # ── Portfolio income ──────────────────────────────────────────────────────
    ia = (cached_data or {}).get("income_analytics", {})
    portfolio_income = float((ia.get("portfolio_fwd_12m") or 0))

    # ── Volatility from live portfolio (weighted 30-day annualised vol) ────────
    # NOTE: we intentionally do NOT use 1Y trailing return as expected return.
    #       Trailing return can be extreme (108 % last year) and is not a forward
    #       predictor. We compute it for display-only metadata (live_expected_return)
    #       and use a conventional 7 % forward assumption for the simulation default.
    snapshots = (cached_data or {}).get("snapshots", {})
    accounts  = (cached_data or {}).get("accounts", [])

    weighted_return = 0.0   # trailing 1Y — stored as metadata only
    weighted_vol    = 0.0   # 30-day annualised — used for vol default
    weight_sum      = 0.0
    for acct in accounts:
        for pos in (acct.get("positions") or []):
            val  = float(pos.get("market_value", 0) or 0)
            snap = snapshots.get(pos.get("symbol", ""), {})
            ret  = snap.get("total_return_1y")
            vol  = snap.get("vol_30d_annual")
            if vol is not None and val > 0:
                weighted_vol += vol * val
                weight_sum   += val
            if ret is not None and val > 0:
                weighted_return += ret * val

    if weight_sum > 0:
        trailing_return_raw = weighted_return / weight_sum   # display-only
        vol_est_raw         = weighted_vol    / weight_sum
        vol_est = max(0.05, min(0.60, vol_est_raw))
    else:
        trailing_return_raw = 0.0
        vol_est_raw = 0.15
        vol_est     = 0.15

    # Forward-looking expected return: conventional 7 % equity assumption.
    # The slider lets the user override this; the trailing 1Y figure is shown
    # as informational metadata only (live_expected_return).
    exp_ret = float(personal.get("_DRAWDOWN_DEFAULTS", {}).get("expected_return", 0.07))

    # ── Roth conversion ───────────────────────────────────────────────────────
    roth_conv = float(target.get("annual_conversion", 100_000) or 100_000)

    # ── Spending — use estimated_spending from input.json when provided ───────
    # Falls back to 110% of portfolio income (or $120K floor) if not set.
    estimated_spending = float(personal.get("estimated_spending", 0) or 0)
    default_spending   = estimated_spending if estimated_spending > 0 else max(float(personal.get("_DRAWDOWN_DEFAULTS", {}).get("annual_spending_fallback", 130_000)), portfolio_income * 1.1)

    state = PortfolioState(
        taxable      = taxable,
        rollover_ira = rollover,
        roth_ira     = roth,
        cash         = 0.0,
        current_age  = current_age,
        target_age   = 100,
        retirement_year = retirement_year,
        portfolio_income_annual  = portfolio_income,
        ss_annual                = ss_annual,
        ss_start_age             = ss_start,
        spouse_ss_annual         = spouse_ss_annual,
        spouse_ss_start_age      = spouse_ss_earner_start,
        annual_spending          = default_spending,
        expected_return          = exp_ret,          # 7 % forward-looking default
        volatility               = vol_est,          # weighted 30-day vol from live holdings
        inflation                = 0.025,
        roth_conversion_annual   = roth_conv,
        rmd_start_age            = int(tre_cfg.get("rmd_start_age", 75)),
        marginal_rate            = marginal_rate,
        filing_status            = filing,
        standard_deduction       = std_ded,
        external_total           = external_total,   # for UI breakdown display
        live_expected_return     = trailing_return_raw,  # trailing 1Y — display-only
        live_volatility          = vol_est_raw,          # raw vol before clamping
    )

    if overrides:
        state = state.apply_overrides(overrides)

    return state
