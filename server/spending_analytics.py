#!/usr/bin/env python3
"""
Spending Analytics Engine.

Parses transactions.csv (24-month window) and returns structured spending
intelligence used by the Summary and Detail tabs, and fed into the
simulation engine for more accurate projections.

CSV format: Date,Account,Description,Category,Tags,Amount
  Date:   YYYY-MM-DD
  Amount: negative = expense, positive = income/deposit
"""
from __future__ import annotations
import csv
import os
import statistics
from collections import defaultdict
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

_DIR      = os.path.dirname(os.path.abspath(__file__))
_CSV_PATH = os.path.join(_DIR, "transactions.csv")

# ── Category → spending group mapping ────────────────────────────────────────
CATEGORY_MAP: Dict[str, str] = {
    # Housing (core)
    "Apartment":        "Housing",
    "Mortgages":        "Housing",
    "Rent":             "Housing",
    "HOA":              "Housing",
    "Home Security":    "Housing",
    "Home Improvement": "Housing",
    "Home Maintenance": "Housing",
    # Utilities (core)
    "Utilities":        "Utilities",
    "Telephone":        "Utilities",
    "Cable/Satellite":  "Utilities",
    "Online Services":  "Utilities",
    # Food (core)
    "Groceries":        "Groceries",
    # Insurance (core)
    "Insurance":        "Insurance",
    # Healthcare (variable)
    "Healthcare/Medical": "Healthcare",
    # Transportation (semi-core)
    "Gasoline/Fuel":    "Transportation",
    "Automotive":       "Transportation",
    "Taxi":             "Transportation",
    "Parking":          "Transportation",
    "toll":             "Transportation",
    # Dining (discretionary)
    "Restaurants":      "Dining",
    # Shopping (discretionary)
    "General Merchandise": "Shopping",
    "Clothing/Shoes":   "Shopping",
    "Electronics":      "Shopping",
    # Travel (discretionary)
    "Travel":           "Travel",
    "Airfare":          "Travel",
    "Hotel":            "Travel",
    # Entertainment (discretionary)
    "Entertainment":    "Entertainment",
    # Other lifestyle
    "Other Expenses":   "Other",
    "ATM/Cash":         "Other",
    "Postage & Shipping": "Other",
    "Checks":           "Other",
    "moving":           "Other",
    # Taxes — tracked separately, excluded from lifestyle spending
    "Taxes":            "_taxes",
    # Income / credits — excluded from spending
    "Paychecks/Salary":           "_income",
    "Deposits":                   "_income",
    "Interest":                   "_income",
    "Refunds & Reimbursements":   "_income",
    "Rewards":                    "_income",
    "Other Income":               "_income",
    # Fees (discretionary) — counted as lifestyle spending, unlike Taxes
    "Service Charges/Fees":       "Fees",
}

CORE_CATEGORIES    = {"Housing", "Utilities", "Groceries", "Insurance"}
NONCORE_CATEGORIES = {"Healthcare", "Transportation", "Dining", "Shopping",
                      "Travel", "Entertainment", "Other", "Fees"}

# Accounts whose transactions are internal and should be skipped
_SKIP_ACCT = {"401k", "ira", "brokerage"}

# Minimum single-transaction amount to qualify as a "shock" event
SHOCK_THRESHOLD = 1_500.0


# ── Row parsing ───────────────────────────────────────────────────────────────

def _skip_account(acct: str) -> bool:
    a = acct.lower()
    return any(s in a for s in _SKIP_ACCT)


def _parse_amount(s: str) -> Optional[float]:
    try:
        return float(s.replace(",", "").strip())
    except Exception:
        return None


def _parse_date(s: str) -> Optional[date]:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            pass
    return None


def _parse_row(row: dict) -> Optional[dict]:
    acct    = (row.get("Account") or "").strip()
    if _skip_account(acct):
        return None

    dt = _parse_date(row.get("Date") or "")
    if dt is None:
        return None

    amount = _parse_amount(row.get("Amount") or "0")
    if amount is None:
        return None

    cat_raw = (row.get("Category") or "").strip()
    group   = CATEGORY_MAP.get(cat_raw, "Other")

    return {
        "date":     dt,
        "month":    dt.strftime("%Y-%m"),
        "account":  acct,
        "desc":     (row.get("Description") or "").strip(),
        "category": cat_raw,
        "group":    group,
        "amount":   amount,
        "expense":  max(0.0, -amount),
        "income":   max(0.0, amount),
    }


def _rolling_cutoff(max_date: date, months: int) -> date:
    """First day of the month that is `months-1` months before max_date's month."""
    y, m = max_date.year, max_date.month
    for _ in range(months - 1):
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return date(y, m, 1)


# ── Main analysis ─────────────────────────────────────────────────────────────

def analyze_spending(hardcoded_spending: float = 0.0) -> dict:
    # hardcoded_spending = personal.json → estimated_spending (passed by config_helpers.py).
    # Default is 0 — if not configured, true_annual_spending from CSV is the authoritative value.
    """
    Load transactions.csv and return a full spending intelligence dict.

    Returns {"available": False} if the file doesn't exist or can't be parsed.
    """
    if not os.path.exists(_CSV_PATH):
        return {"available": False}

    raw_rows: List[dict] = []
    try:
        with open(_CSV_PATH, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                raw_rows.append(row)
    except Exception:
        return {"available": False}

    parsed = [p for r in raw_rows if (p := _parse_row(r)) is not None]
    if not parsed:
        return {"available": False}

    # Use ALL data in the file — user controls the window by what they provide
    window     = parsed
    max_date   = max(r["date"] for r in window)
    first_date = min(r["date"] for r in window)

    all_months = sorted({r["month"] for r in window})
    n_months   = len(all_months)

    # ── Buckets ───────────────────────────────────────────────────────────────
    lifestyle  = [r for r in window if r["group"] not in ("_income", "_taxes")]
    tax_rows   = [r for r in window if r["group"] == "_taxes"]
    income_rows= [r for r in window if r["group"] == "_income"]
    # W2 earned income (Paychecks/Salary) tracked separately from other income
    w2_rows         = [r for r in income_rows if r["category"] == "Paychecks/Salary"]
    other_inc_rows  = [r for r in income_rows if r["category"] != "Paychecks/Salary"]

    # ── Monthly lifestyle spending ────────────────────────────────────────────
    monthly_spend: Dict[str, float] = defaultdict(float)
    for r in lifestyle:
        monthly_spend[r["month"]] += r["expense"]
    for m in all_months:
        monthly_spend.setdefault(m, 0.0)

    # Per-month W2 income
    monthly_w2: Dict[str, float] = defaultdict(float)
    for r in w2_rows:
        monthly_w2[r["month"]] += r["income"]

    # Per-month other income (dividends captured from bank deposits, interest, etc.)
    monthly_other_inc: Dict[str, float] = defaultdict(float)
    for r in other_inc_rows:
        monthly_other_inc[r["month"]] += r["income"]

    monthly_list   = [(m, monthly_spend[m]) for m in all_months]
    spend_values   = [v for _, v in monthly_list]
    nonzero_values = [v for v in spend_values if v > 0]

    # 12-month rolling windows
    recent_12 = all_months[-12:] if n_months >= 12 else all_months
    prior_12  = all_months[-24:-12] if n_months >= 24 else []

    recent_sum = sum(monthly_spend.get(m, 0) for m in recent_12)
    prior_sum  = sum(monthly_spend.get(m, 0) for m in prior_12)

    # Annualise if partial window
    recent_annual = round(recent_sum / len(recent_12) * 12) if recent_12 else 0
    prior_annual  = round(prior_sum  / len(prior_12)  * 12) if prior_12  else None

    drift_pct = (
        round((recent_annual - prior_annual) / prior_annual * 100, 1)
        if prior_annual else None
    )

    # True annualised from full window
    total_lifestyle = sum(r["expense"] for r in lifestyle)
    true_annual     = round(total_lifestyle / n_months * 12) if n_months else 0

    monthly_mean   = round(statistics.mean(nonzero_values))   if nonzero_values else 0
    monthly_stddev = round(statistics.stdev(nonzero_values))  if len(nonzero_values) > 1 else 0
    vol_pct        = round(monthly_stddev / monthly_mean * 100, 1) if monthly_mean > 0 else 0

    # ── Category breakdown ────────────────────────────────────────────────────
    cat_spend: Dict[str, float] = defaultdict(float)
    cat_count: Dict[str, int]   = defaultdict(int)
    for r in lifestyle:
        cat_spend[r["group"]] += r["expense"]
        cat_count[r["group"]] += 1

    categories: dict = {}
    for grp, total in sorted(cat_spend.items(), key=lambda x: -x[1]):
        ann = round(total / n_months * 12) if n_months else 0
        categories[grp] = {
            "total":       round(total),
            "annual":      ann,
            "monthly_avg": round(total / n_months) if n_months else 0,
            "pct":         round(total / total_lifestyle * 100, 1) if total_lifestyle else 0,
            "is_core":     grp in CORE_CATEGORIES,
            "count":       cat_count[grp],
        }

    # ── Core vs Non-Core ─────────────────────────────────────────────────────
    core_raw    = sum(v for g, v in cat_spend.items() if g in CORE_CATEGORIES)
    noncore_raw = sum(v for g, v in cat_spend.items() if g in NONCORE_CATEGORIES)
    core_annual    = round(core_raw    / n_months * 12) if n_months else 0
    noncore_annual = round(noncore_raw / n_months * 12) if n_months else 0
    core_pct       = round(core_raw    / total_lifestyle * 100, 1) if total_lifestyle else 0

    # ── Taxes & income ────────────────────────────────────────────────────────
    taxes_total  = sum(r["expense"] for r in tax_rows)
    taxes_annual = round(taxes_total / n_months * 12) if n_months else 0

    # W2 (earned) income — present until retirement
    w2_total  = sum(r["income"] for r in w2_rows)
    w2_annual = round(w2_total / n_months * 12) if n_months and w2_total > 0 else 0

    # All other non-W2 transactional income
    other_inc_total = sum(r["income"] for r in other_inc_rows)

    # Combined income (W2 + other) — backward-compat "income_annual"
    income_total = w2_total + other_inc_total
    income_annual= round(income_total / n_months * 12) if n_months else 0

    # ── Recurring payments (detect first so shocks can exclude them) ──────────
    # A payee is only considered recurring if it is STILL ACTIVE — i.e. it
    # appeared in at least 1 of the last 3 calendar months.  This prevents
    # cancelled subscriptions / paid-off loans from staying on the list.
    desc_months: Dict[str, set]   = defaultdict(set)
    desc_amounts: Dict[str, list] = defaultdict(list)
    desc_rows: Dict[str, list]    = defaultdict(list)
    for r in lifestyle:
        key = r["desc"].lower()[:30]
        desc_months[key].add(r["month"])
        desc_amounts[key].append(r["expense"])
        desc_rows[key].append(r)

    active_window = set(all_months[-3:])  # last 3 months seen in the data

    # This-year / last-year split — so a recurring payment's magnitude can be
    # compared year over year (e.g. a rent increase) instead of blended into
    # one lifetime average.
    this_cal_year = max_date.year
    last_cal_year = max_date.year - 1

    recurring_keys: set = set()   # keys of confirmed active recurring payees
    recurring = []
    for key, months_seen in desc_months.items():
        if len(months_seen) < 3:
            continue
        # Must still be active — at least one hit in the last 3 months
        if not (months_seen & active_window):
            continue
        amts   = desc_amounts[key]
        avg    = sum(amts) / len(amts)
        stddev = statistics.stdev(amts) if len(amts) > 1 else 0
        if avg > 0 and (stddev / avg) < 0.25:   # ≤ 25% variation
            recurring_keys.add(key)
            last_seen = max(months_seen)
            rows_for_key   = desc_rows[key]
            this_yr_rows   = [rr for rr in rows_for_key if rr["date"].year == this_cal_year]
            last_yr_rows   = [rr for rr in rows_for_key if rr["date"].year == last_cal_year]
            this_yr_months = len({rr["month"] for rr in this_yr_rows})
            last_yr_months = len({rr["month"] for rr in last_yr_rows})
            this_yr_total  = sum(rr["expense"] for rr in this_yr_rows)
            last_yr_total  = sum(rr["expense"] for rr in last_yr_rows)
            for r in lifestyle:
                if r["desc"].lower()[:30] == key:
                    recurring.append({
                        "description":  r["desc"],
                        "monthly_avg":  round(avg, 2),
                        "annual":       round(avg * 12),
                        "months_seen":  len(months_seen),
                        "last_seen":    last_seen,
                        "category":     r["group"],
                        "this_year_avg":    round(this_yr_total / this_yr_months, 2) if this_yr_months else None,
                        "this_year_total":  round(this_yr_total) if this_yr_months else None,
                        "last_year_avg":    round(last_yr_total / last_yr_months, 2) if last_yr_months else None,
                        "last_year_total":  round(last_yr_total) if last_yr_months else None,
                    })
                    break
    recurring.sort(key=lambda x: -x["monthly_avg"])
    recurring = recurring[:12]

    # ── Shock events (exclude known recurring payees) ─────────────────────────
    # Only flag shocks from the last 12 months — older one-off events are
    # history, not actionable signals.  Still excludes recurring payees.
    shock_cutoff = _rolling_cutoff(max_date, 13)   # 12 full months back
    shocks = []
    for r in lifestyle:
        if r["date"] < shock_cutoff:
            continue   # too old — not an actionable signal
        if r["expense"] >= SHOCK_THRESHOLD:
            if r["desc"].lower()[:30] in recurring_keys:
                continue   # recurring payment — not a shock
            shocks.append({
                "date":         r["date"].isoformat(),
                "description":  r["desc"],
                "amount":       round(r["expense"]),
                "category":     r["group"],
                "raw_category": r["category"],
            })
    shocks.sort(key=lambda x: -x["amount"])

    # ── Data-completeness flag ─────────────────────────────────────────────────
    # Months whose spend is < 20% of mean are likely incomplete
    low_months = [m for m, v in monthly_list if 0 < v < monthly_mean * 0.20] if monthly_mean > 0 else []
    data_complete = len(low_months) == 0

    # ── Lifestyle phase ───────────────────────────────────────────────────────
    travel_dining  = (cat_spend.get("Travel", 0) + cat_spend.get("Dining", 0)
                      + cat_spend.get("Entertainment", 0))
    healthcare_amt = cat_spend.get("Healthcare", 0)
    discr_pct  = round(travel_dining  / total_lifestyle * 100, 1) if total_lifestyle else 0
    health_pct = round(healthcare_amt / total_lifestyle * 100, 1) if total_lifestyle else 0

    # Per-month discretionary % across recent 12 months → smoothed range
    monthly_discr: Dict[str, float] = defaultdict(float)
    monthly_total_lf: Dict[str, float] = defaultdict(float)
    for r in lifestyle:
        if r["group"] in ("Travel", "Dining", "Entertainment"):
            monthly_discr[r["month"]] += r["expense"]
        monthly_total_lf[r["month"]] += r["expense"]
    recent_discr_pcts = [
        monthly_discr[m] / monthly_total_lf[m] * 100
        for m in recent_12
        if monthly_total_lf.get(m, 0) > 0
    ]
    if len(recent_discr_pcts) >= 2:
        discr_lo = round(min(recent_discr_pcts))
        discr_hi = round(max(recent_discr_pcts))
        discr_range = f"{discr_lo}–{discr_hi}%" if discr_lo != discr_hi else f"{discr_lo}%"
    else:
        discr_range = f"{discr_pct:.0f}%"

    if discr_pct >= 25:
        phase       = "go_go"
        phase_label = "Go-Go"
        phase_icon  = "🟢"
        phase_sim   = 1.10
        phase_note  = f"High discretionary spend: Dining/Travel/Entertainment = {discr_range}"
    elif health_pct >= 15 or discr_pct <= 8:
        phase       = "no_go"
        phase_label = "No-Go"
        phase_icon  = "🔴"
        phase_sim   = 0.75
        phase_note  = f"Low discretionary ({discr_range}), healthcare at {health_pct:.0f}%"
    else:
        phase       = "slow_go"
        phase_label = "Slow-Go"
        phase_icon  = "🟡"
        phase_sim   = 1.00
        phase_note  = f"Moderate discretionary spend ({discr_range}), steady patterns"

    # ── Calendar-year breakdown ───────────────────────────────────────────────
    yr_spend:   Dict[str, float] = defaultdict(float)
    yr_tax:     Dict[str, float] = defaultdict(float)
    yr_income:  Dict[str, float] = defaultdict(float)
    yr_w2:      Dict[str, float] = defaultdict(float)
    for r in lifestyle:
        yr_spend[str(r["date"].year)] += r["expense"]
    for r in tax_rows:
        yr_tax[str(r["date"].year)] += r["expense"]
    for r in income_rows:
        yr_income[str(r["date"].year)] += r["income"]
    for r in w2_rows:
        yr_w2[str(r["date"].year)] += r["income"]

    # Months per year (for annualisation within partial years)
    yr_months: Dict[str, int] = defaultdict(int)
    for m in all_months:
        yr_months[m[:4]] += 1

    calendar_years = []
    for yr in sorted(set(yr_spend) | set(yr_tax) | set(yr_income)):
        mo = yr_months.get(yr, 12)
        total_inc = yr_income.get(yr, 0)
        w2_inc    = yr_w2.get(yr, 0)
        calendar_years.append({
            "year":          yr,
            "lifestyle":     round(yr_spend.get(yr, 0)),
            "annualised":    round(yr_spend.get(yr, 0) / mo * 12) if mo else 0,
            "taxes_paid":    round(yr_tax.get(yr, 0)),
            "income":        round(total_inc),
            "w2_income":     round(w2_inc),
            "other_income":  round(total_inc - w2_inc),
            "months":        mo,
        })

    # ── Quarterly breakdown ────────────────────────────────────────────────────
    qtr_spend: Dict[str, float] = defaultdict(float)
    for r in lifestyle:
        mo = r["date"].month
        q  = f"{r['date'].year}-Q{(mo - 1) // 3 + 1}"
        qtr_spend[q] += r["expense"]

    quarterly_totals = [
        {"quarter": q, "amount": round(v)}
        for q, v in sorted(qtr_spend.items())
    ]

    # Last 4 complete quarters for the tax forecast
    recent_quarters = quarterly_totals[-4:] if len(quarterly_totals) >= 4 else quarterly_totals

    # ── Vs hardcoded estimate ─────────────────────────────────────────────────
    estimate_delta     = true_annual - hardcoded_spending
    estimate_delta_pct = round(estimate_delta / hardcoded_spending * 100, 1) if hardcoded_spending else None

    # ── Monthly income totals (W2 + other, per month) ────────────────────────
    # Used by the cashflow chart to show total income alongside spending
    current_year = str(max_date.year)
    monthly_income_totals = [
        {
            "month":       m,
            "w2":          round(monthly_w2.get(m, 0)),
            "other":       round(monthly_other_inc.get(m, 0)),
            "total":       round(monthly_w2.get(m, 0) + monthly_other_inc.get(m, 0)),
        }
        for m in all_months
        if m.startswith(current_year)
    ]
    monthly_income_totals.sort(key=lambda x: x["month"], reverse=True)  # newest first

    # monthly_totals for the UI: current year only, descending order
    # (stats like mean/stddev use the full historical monthly_list above)
    monthly_totals_display = [
        {"month": m, "amount": round(v)}
        for m, v in monthly_list
        if m.startswith(current_year)
    ]
    monthly_totals_display.sort(key=lambda x: x["month"], reverse=True)  # newest first

    return {
        "available":   True,
        "csv_rows":    len(raw_rows),
        "date_range": {
            "start":  first_date.isoformat(),
            "end":    max_date.isoformat(),
            "months": n_months,
        },
        # ── Spending totals ────────────────────────────────────────────────
        "true_annual_spending":  true_annual,
        "recent_annual":         recent_annual,
        "prior_annual":          prior_annual,
        "spending_drift_pct":    drift_pct,
        "taxes_annual":          taxes_annual,
        "taxes_total":           round(taxes_total),
        "income_annual":         income_annual,
        "w2_annual":             w2_annual,
        "w2_total":              round(w2_total),
        # ── Monthly series ─────────────────────────────────────────────────
        # monthly_totals: current year only, descending (for display/chart)
        "monthly_totals": monthly_totals_display,
        "monthly_mean":   monthly_mean,
        "monthly_stddev": monthly_stddev,
        "cashflow_vol_pct": vol_pct,
        # ── Core / Non-Core ────────────────────────────────────────────────
        "core_spending":    core_annual,
        "noncore_spending": noncore_annual,
        "core_pct":         core_pct,
        # ── Categories ────────────────────────────────────────────────────
        "categories":    categories,
        # ── Shocks ────────────────────────────────────────────────────────
        "shock_events":  shocks,
        "shock_count":   len(shocks),
        "shock_largest": shocks[0]["amount"] if shocks else 0,
        # ── Recurring ─────────────────────────────────────────────────────
        "recurring":     recurring,
        # ── Lifestyle phase ────────────────────────────────────────────────
        "lifestyle_phase":     phase,
        "lifestyle_label":     phase_label,
        "lifestyle_icon":      phase_icon,
        "lifestyle_sim_mult":  phase_sim,
        "lifestyle_note":      phase_note,
        "discretionary_pct":   discr_pct,
        "healthcare_pct":      health_pct,
        # ── Estimate comparison ────────────────────────────────────────────
        "hardcoded_spending":   round(hardcoded_spending),
        "estimate_delta":       round(estimate_delta),
        "estimate_delta_pct":   estimate_delta_pct,
        # ── Income breakdown ──────────────────────────────────────────────
        "monthly_income_totals": monthly_income_totals,   # [{month, w2, other, total}] current yr descending
        # ── Time series ───────────────────────────────────────────────────
        "calendar_years":       calendar_years,
        "quarterly_totals":     quarterly_totals,
        "recent_quarters":      recent_quarters,
        # ── Data quality ──────────────────────────────────────────────────
        "data_complete":        data_complete,
        "low_data_months":      low_months,
    }
