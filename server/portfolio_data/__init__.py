#!/usr/bin/env python3
"""
Portfolio data layer — config loading, data fetching, tax calculations.
All JSON-serialisable output consumed by the HTTP server.
"""

import json
import os
import sys
import threading
import traceback
from datetime import datetime, timezone, date as _date, timedelta
from typing import Dict, List, Optional, Any

# All filesystem paths must resolve to the server/ directory — NOT the
# server/portfolio_data/ sub-package directory — to preserve pre-split layout
# (config files, target_*.json, ../reports/ all live next to server.py).
_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ensure we can import sibling modules
sys.path.insert(0, _SERVER_DIR)

from models import EtfSnapshot
from evaluation import evaluate_etf
from data_fetcher import get_snapshot, get_vix_snapshot, get_portfolio_correlation

# ── Sub-module imports (split out of the original monolith for clarity) ──
from ._flags import _VERBOSE, _DEBUG_REFRESH
from .time_utils import (
    _et_now, _et_hour, _et_minutes_since_midnight,
    _NYSE_OPEN_MIN, _NYSE_CLOSE_MIN,
)
from .eod import _load_eod_values, _validate_target_symbols, _save_eod_values
from .tax_lot import (
    _load_cost_basis_analysis,
    _read_prev_confidence, _write_confidence,
    _load_trends_cache, _save_trends_cache,
    _save_positions_snapshot, _load_positions_snapshot,
)
from .dividends import (
    _linreg_slope, _build_fund_config,
)
from .config_helpers import (
    _snap_to_dict, _decision_to_dict, _compute_spending_intelligence,
)


# ── Verbose flag ───────────────────────────────────────────────────────────────
# Set to True for progress logging, False for clean output
# ── Debug flag for traceback printing ─────────────────────────────────────────

# ── Global cache state ─────────────────────────────────────────────────────────

_cache_lock = threading.Lock()
_cached_data: Optional[Dict[str, Any]] = None
_last_refresh: Optional[str] = None
_refreshing = False

# ── Refresh progress status (for /api/status progress reporting) ───────────────
import time as _time_mod

_refresh_status: Dict[str, Any] = {
    "phase":      "idle",   # idle | loading | done | error
    "step":       "",
    "pct":        0,
    "elapsed":    0.0,
    "started_at": None,     # internal — not sent to frontend
}
_status_lock = threading.Lock()


def _update_status(phase: str, step: str, pct: int) -> None:
    """Update refresh progress and print a one-liner to stdout."""
    with _status_lock:
        _refresh_status["phase"] = phase
        _refresh_status["step"]  = step
        _refresh_status["pct"]   = pct
        if phase == "loading" and _refresh_status["started_at"] is None:
            _refresh_status["started_at"] = _time_mod.time()
        if _refresh_status["started_at"] is not None:
            _refresh_status["elapsed"] = round(
                _time_mod.time() - _refresh_status["started_at"], 1
            )
        elapsed = _refresh_status["elapsed"]
        if phase in ("done", "idle", "error"):
            _refresh_status["started_at"] = None

    # Always print progress so the terminal shows what the server is doing.
    if phase == "loading":
        print(f"[fetch] {pct:>3}%  {step}  ({elapsed}s)", flush=True)
    elif phase == "done":
        print(f"[fetch] ✓ {step}  ({elapsed}s total)", flush=True)
    elif phase == "error":
        print(f"[fetch] ✗ {step}", flush=True)


# ── Dividend metrics cache (24-hr TTL) ────────────────────────────────────────
_div_metrics_cache: Dict[str, Any] = {}   # {sym: {...}}
_div_metrics_ts: float = 0.0              # unix timestamp of last fetch

_INCOME_CEILING = 160_000.0              # fallback — overridden at runtime by TAX_RULE_ENGINE.soft_limit
_INCOME_TARGET  = 0.0                   # fallback — overridden at runtime by tax bracket calculation

import db_manager as _dbm




# NYSE market open/close in minutes-since-midnight (ET)



# ── Tax lot cost basis ────────────────────────────────────────────────────────
# Lots live in dashboard.db (lots table) — the DB is the source of truth.
# Edits flow in via POST /api/settings → db_manager.lots_replace_from_dict().






def _get_div_metrics_batch(symbols: List[str]) -> Dict[str, Any]:
    """
    Fetch yfinance dividend history for each symbol and compute:
      - stability_score  : 0-100  (100 = perfectly stable; 0 = highly erratic)
      - yield_model      : "ttm" | "forward"
      - last_pay         : most-recent per-share payout
      - freq_per_yr      : estimated payments per year
      - trend            : "Rising" | "Stable" | "Declining"
      - trend_slope      : raw OLS slope ($/payment)
      - trend_pct        : slope as % of mean pay (directional strength)
      - growth_rate_1y   : (last-12-pay sum / prior-12-pay sum) - 1  (or None)

    Results cached for 24 hours; only symbols missing from cache are fetched.
    """
    global _div_metrics_cache, _div_metrics_ts
    import time, yfinance as yf
    import statistics

    now = time.time()
    if now - _div_metrics_ts > 86400:
        _div_metrics_cache = {}
        _div_metrics_ts = now

    missing = [s for s in symbols if s not in _div_metrics_cache]

    for sym in missing:
        try:
            tkr  = yf.Ticker(sym)
            # Fetch ~2 years of data for growth-rate comparison
            divs_all = tkr.dividends
            all_vals  = [float(v) for v in divs_all.values if v > 0]

            # ── Frequency from median gap ──────────────────────────────────
            if len(divs_all) >= 2:
                gaps = [(divs_all.index[i] - divs_all.index[i-1]).days
                        for i in range(1, len(divs_all))]
                med_gap = sorted(gaps)[len(gaps) // 2]
                freq_per_yr = max(1, round(365 / med_gap)) if med_gap > 0 else 12
            else:
                freq_per_yr = 12

            # ── Growth rate (last 12 payments vs prior 12) ─────────────────
            if len(all_vals) >= 24:
                last12  = all_vals[-12:]
                prior12 = all_vals[-24:-12]
                s_last, s_prior = sum(last12), sum(prior12)
                growth_rate_1y = (s_last / s_prior - 1.0) if s_prior > 0 else None
            else:
                growth_rate_1y = None

            # ── Work with last 14 for stability / trend ────────────────────
            recent = all_vals[-14:] if len(all_vals) > 14 else all_vals

            if len(recent) >= 2:
                mean_pay  = statistics.mean(recent)
                std_pay   = statistics.pstdev(recent)
                stability = max(0.0, min(100.0, (1.0 - std_pay / mean_pay) * 100)) if mean_pay > 0 else 0.0
                last_pay  = recent[-1]
                yield_model = "forward" if (mean_pay > 0 and last_pay / mean_pay < 0.5) else "ttm"

                # Linear regression trend
                slope    = _linreg_slope(recent)
                trend_pct = (slope / mean_pay * 100) if mean_pay > 0 else 0.0
                if trend_pct > 1.0:
                    trend = "Rising"
                elif trend_pct < -1.0:
                    trend = "Declining"
                else:
                    trend = "Stable"
            else:
                mean_pay    = recent[0] if recent else 0.0
                stability   = 50.0
                yield_model = "ttm"
                last_pay    = mean_pay
                slope       = 0.0
                trend_pct   = 0.0
                trend       = "Stable"

            _div_metrics_cache[sym] = {
                "stability_score": round(stability, 1),
                "yield_model":     yield_model,
                "last_pay":        round(last_pay, 4),
                "freq_per_yr":     freq_per_yr,
                "trend":           trend,
                "trend_slope":     round(slope, 6),
                "trend_pct":       round(trend_pct, 2),
                "growth_rate_1y":  round(growth_rate_1y, 4) if growth_rate_1y is not None else None,
            }
        except Exception:
            _div_metrics_cache[sym] = {
                "stability_score": None,
                "yield_model":     "ttm",
                "last_pay":        0.0,
                "freq_per_yr":     12,
                "trend":           "Stable",
                "trend_slope":     0.0,
                "trend_pct":       0.0,
                "growth_rate_1y":  None,
            }

    return _div_metrics_cache

# Default dividend tax character by fund type (used if TAX_CHARACTER not in config)
_TAX_CHAR_DEFAULTS: dict = {
    "OPTION_INCOME": {"ordinary": 0.15, "qualified": 0.20, "roc": 0.65},
    "CEF":           {"ordinary": 0.40, "qualified": 0.45, "roc": 0.15},
    "DIVIDEND":      {"ordinary": 0.05, "qualified": 0.90, "roc": 0.05},
    "GROWTH":        {"ordinary": 0.02, "qualified": 0.96, "roc": 0.02},
}

# ── Fund type auto-classification ─────────────────────────────────────────────



_CFG_DIR = _SERVER_DIR
_SPLIT_FILES = ["personal.json", "rules.json", "tax_brackets.json"]


def load_config() -> dict:
    """Merge personal.json + rules.json + tax_brackets.json into one config dict."""
    merged: dict = {}
    for fname in _SPLIT_FILES:
        fpath = os.path.join(_CFG_DIR, fname)
        try:
            with open(fpath) as f:
                merged.update(json.load(f))
        except FileNotFoundError:
            print(f"[config] Warning: {fname} not found — copy from {fname}.sample")
        except Exception as e:
            print(f"[config] Warning: failed to load {fname}: {e}")
    return merged



# ── Cache clearing (called by server refresh endpoint) ─────────────────────────

def clear_all_caches():
    """Clear all internal module-level caches."""
    global _div_metrics_cache, _div_metrics_ts
    _div_metrics_cache = {}
    _div_metrics_ts = 0.0
    
    # Clear data_fetcher caches
    try:
        import data_fetcher as df
        df._SPY_HIST = None
    except Exception:
        pass

def _compute_correlation_map(accounts: List[Dict], fund_configs: Dict) -> Dict[str, Any]:
    """
    Compute a 60-trading-day Pearson correlation map across all portfolio holdings,
    grouped by sleeve (account key).

    Returns a dict with:
      - lookback_days, method, symbols, matrix (symbol×symbol), sleeve_matrix,
        diversification_score, highest_corr_pair, lowest_corr_pair, computed_at
    """
    import yfinance as _yf
    import pandas as _pd
    from datetime import date as _date_cls

    # ── Collect all held positions with their sleeve and market value ─────────
    sym_sleeve: Dict[str, str] = {}   # symbol → sleeve (account key)
    sym_value:  Dict[str, float] = {}  # symbol → total market value across all accounts

    for acct in accounts:
        sleeve = acct["key"]   # "taxable" | "roth_ira" | "rollover_ira" | …
        for pos in acct["positions"]:
            sym = pos["symbol"]
            val = float(pos.get("market_value") or pos.get("value") or 0.0)
            if pos.get("is_money_market") or pos.get("fund_type") == "MONEY_MARKET":
                continue   # skip money-market; $1 NAV carries no price correlation
            if val <= 0:
                continue
            if sym not in sym_value:
                sym_sleeve[sym] = sleeve
                sym_value[sym] = 0.0
            sym_value[sym] += val

    symbols = sorted(sym_value.keys())
    if len(symbols) < 2:
        return {"error": "Not enough symbols for correlation", "computed_at": str(_date_cls.today())}

    # ── Fetch 3 months of adjusted daily closes (≈60 trading days) ───────────
    raw = _yf.download(
        symbols, period="3mo",
        auto_adjust=True, progress=False, threads=False,
    )["Close"]

    # Handle single-symbol edge case
    if isinstance(raw, _pd.Series):
        raw = raw.to_frame(name=symbols[0])

    # Keep only symbols that actually downloaded
    available = [s for s in symbols if s in raw.columns and raw[s].dropna().shape[0] >= 10]
    if len(available) < 2:
        return {"error": "Insufficient price history for correlation", "computed_at": str(_date_cls.today())}

    prices = raw[available].dropna(how="all")
    returns = prices.pct_change().dropna()

    # ── Full Pearson correlation matrix ──────────────────────────────────────
    corr_df = returns[available].corr(method="pearson")

    # Build symbol×symbol matrix as plain Python floats
    matrix: Dict[str, Dict[str, float]] = {}
    for sym_a in available:
        matrix[sym_a] = {}
        for sym_b in available:
            v = corr_df.loc[sym_a, sym_b]
            matrix[sym_a][sym_b] = round(float(v), 4) if not _pd.isna(v) else 0.0

    # ── Identify highest / lowest off-diagonal pair ──────────────────────────
    highest_corr_pair: Optional[Dict] = None
    lowest_corr_pair:  Optional[Dict] = None
    _hi_val = -2.0
    _lo_val =  2.0
    for i, sa in enumerate(available):
        for j, sb in enumerate(available):
            if j <= i:
                continue
            c = matrix[sa][sb]
            if c > _hi_val:
                _hi_val = c
                highest_corr_pair = {"symbols": [sa, sb], "corr": round(c, 4)}
            if c < _lo_val:
                _lo_val = c
                lowest_corr_pair = {"symbols": [sa, sb], "corr": round(c, 4)}

    # ── Diversification score: 1 - avg_pairwise_corr (0-100) ─────────────────
    _pairs_vals = [
        matrix[sa][sb]
        for i, sa in enumerate(available)
        for j, sb in enumerate(available)
        if j > i
    ]
    _avg_corr = sum(_pairs_vals) / len(_pairs_vals) if _pairs_vals else 0.0
    diversification_score = int(round(max(0.0, min(100.0, (1.0 - _avg_corr) * 100))))

    # ── Sleeve-level aggregation (weighted avg pairwise correlation) ──────────
    # Map each available symbol back to its sleeve
    avail_sleeves = {s: sym_sleeve.get(s, "unknown") for s in available}
    sleeves = sorted(set(avail_sleeves.values()))

    sleeve_matrix: Dict[str, Dict[str, float]] = {}
    for sl_a in sleeves:
        sleeve_matrix[sl_a] = {}
        syms_a = [s for s in available if avail_sleeves[s] == sl_a]
        for sl_b in sleeves:
            if sl_a == sl_b:
                sleeve_matrix[sl_a][sl_b] = 1.0
                continue
            syms_b = [s for s in available if avail_sleeves[s] == sl_b]
            if not syms_a or not syms_b:
                sleeve_matrix[sl_a][sl_b] = 0.0
                continue
            # Weighted average of all pairwise correlations across sleeve pair
            _num, _den = 0.0, 0.0
            for sa in syms_a:
                for sb in syms_b:
                    w = float(sym_value.get(sa, 1.0)) * float(sym_value.get(sb, 1.0))
                    c = matrix[sa][sb]
                    _num += c * w
                    _den += w
            sleeve_matrix[sl_a][sl_b] = round(_num / _den, 4) if _den > 0 else 0.0

    return {
        "lookback_days":       60,
        "method":              "pearson_sma",
        "symbols":             available,
        "matrix":              matrix,
        "sleeve_matrix":       sleeve_matrix,
        "diversification_score": diversification_score,
        "highest_corr_pair":   highest_corr_pair,
        "lowest_corr_pair":    lowest_corr_pair,
        "computed_at":         str(_date_cls.today()),
    }


def fetch_all_data() -> Dict[str, Any]:
    """Fetch all portfolio data. Returns a JSON-serializable dict."""
    _update_status("loading", "Loading configuration…", 5)
    cfg = load_config()
    _trends_cache = _load_trends_cache()   # yesterday's analytics for trend arrows
    meta_rules = {}   # directions are hardcoded in evaluation.py; no longer needed in config
    fund_type_rules = cfg.get("_FUND_TYPE_RULES", {})
    symbol_overrides = cfg.get("_SYMBOL_OVERRIDES", {})
    # Start with config-based portfolio (fallback if Schwab unavailable)
    portfolio = {k: dict(v) for k, v in cfg.get("_PORTFOLIO", {}).items()}

    # ── Schwab live data ──────────────────────────────────────────────────────
    _update_status("loading", "Connecting to Schwab…", 10)
    schwab_snap = None
    schwab_status = "unavailable"

    def _apply_positions(acct_accounts: dict, status: str) -> None:
        """Apply account positions dict into portfolio and set schwab_status."""
        nonlocal schwab_status
        for acct_key, acct_data in acct_accounts.items():
            if acct_key not in portfolio:
                portfolio[acct_key] = {"label": acct_key.replace("_", " ").title(), "positions": {}}
            portfolio[acct_key]["positions"] = {
                sym: {
                    "shares":          pos["shares"],
                    "cost_per_share":  pos["cost_per_share"],
                    **({"is_money_market": True} if pos.get("is_money_market") else {}),
                }
                for sym, pos in acct_data.get("positions", {}).items()
            }
        schwab_status = status

    try:
        from schwab_client import get_portfolio_snapshot
        schwab_snap = get_portfolio_snapshot()
        if schwab_snap:
            _apply_positions(schwab_snap["accounts"], "live")
            # Persist positions so we can fall back to them if Schwab is later unavailable
            _save_positions_snapshot(schwab_snap)
            if _VERBOSE:
                print(f"[portfolio] Using Schwab live positions for "
                      f"{len(schwab_snap['accounts'])} accounts.")
        else:
            # Token missing / expired — try last-known-good snapshot
            _cached = _load_positions_snapshot()
            if _cached:
                _apply_positions(_cached, "cached")
            else:
                schwab_status = "no_token"
            if _VERBOSE:
                print(f"[portfolio] Schwab unavailable — status: {schwab_status}.")
    except Exception as _se:
        # API error — try last-known-good snapshot before giving up
        _cached = _load_positions_snapshot()
        if _cached:
            _apply_positions(_cached, "cached")
        else:
            schwab_status = "error"
        if _VERBOSE:
            print(f"[portfolio] Schwab error ({_se}) — status: {schwab_status}.")

    # Load Roth IRA target allocation from target_roth.json
    _troth_path = os.path.join(_SERVER_DIR, "target_roth.json")
    roth_targets_file = {}
    try:
        with open(_troth_path) as _tf:
            import json as _jmod
            _raw_troth = _jmod.load(_tf)
            roth_targets_file = {k: float(v) for k, v in _raw_troth.items() if not k.startswith("_")}
        
        # Validate Roth target symbols
        roth_symbols = list(roth_targets_file.keys())
        invalid_roth = _validate_target_symbols(roth_symbols, "target_roth.json")
        for inv in invalid_roth:
            print(f"[portfolio] Removing invalid symbol '{inv}' from roth_targets")
            del roth_targets_file[inv]
    except Exception as e:
        if _VERBOSE:
            print(f"[portfolio] Failed to load target_roth.json: {e}")
        roth_targets_file = {}

    # Load Taxable account target allocation from target_taxable.json
    _ttax_path = os.path.join(_SERVER_DIR, "target_taxable.json")
    taxable_targets_file = {}
    try:
        with open(_ttax_path) as _tf2:
            import json as _jmod2
            _raw_ttax = _jmod2.load(_tf2)
            taxable_targets_file = {k: float(v) for k, v in _raw_ttax.items() if not k.startswith("_")}
        
        # Validate Taxable target symbols
        taxable_symbols = list(taxable_targets_file.keys())
        invalid_taxable = _validate_target_symbols(taxable_symbols, "target_taxable.json")
        for inv in invalid_taxable:
            print(f"[portfolio] Removing invalid symbol '{inv}' from taxable_targets")
            del taxable_targets_file[inv]
    except Exception as e:
        if _VERBOSE:
            print(f"[portfolio] Failed to load target_taxable.json: {e}")
        taxable_targets_file = {}

    # Collect unique symbols from: live Schwab positions + target alloc targets
    # Money-market symbols get a static stub — no yfinance/Schwab quote needed.
    # Extend this set if you hold other $1-NAV funds (SNSXX, SWRXX, etc.).
    _KNOWN_MMF: set = {"SWVXX", "SNSXX", "SWRXX", "SWYXX", "SNVXX", "VMFXX", "SPAXX", "CASH"}
    _MMF_SYMBOLS: set = set()
    symbols = set()
    for acct in portfolio.values():
        for sym, pos_data in acct.get("positions", {}).items():
            if isinstance(pos_data, dict) and pos_data.get("is_money_market") or sym in _KNOWN_MMF:
                _MMF_SYMBOLS.add(sym)
            else:
                symbols.add(sym)
    for sym in roth_targets_file:
        if sym in _KNOWN_MMF:
            _MMF_SYMBOLS.add(sym)
        elif sym not in _MMF_SYMBOLS:
            symbols.add(sym)
    for sym in taxable_targets_file:
        if sym in _KNOWN_MMF:
            _MMF_SYMBOLS.add(sym)
        elif sym not in _MMF_SYMBOLS:
            symbols.add(sym)
    symbols = sorted(symbols)

    # Fetch VIX and market benchmarks
    _update_status("loading", f"Fetching market data ({len(symbols)} symbols)…", 22)
    vix_current, vix_90d_avg = get_vix_snapshot()

    # Fetch market context (S&P 500, Dow)
    market_context = {}
    for idx, label in [("^GSPC", "S&P 500"), ("^DJI", "Dow Jones")]:
        try:
            snap = get_snapshot(idx, benchmark="SPY", vix_current=vix_current, vix_90d_avg=vix_90d_avg)
            market_context[label] = {
                "price": snap.price,
                "momentum_20d": snap.momentum_20d,
                "trend_90d": snap.trend_90d,
                "total_return_1y": snap.total_return_1y,
            }
        except Exception as e:
            if _VERBOSE:
                print(f"Warning: Could not fetch {label}: {e}")
            market_context[label] = None

    # Fetch snapshots and evaluate
    decisions: List[Dict] = []
    snapshots: Dict[str, Dict] = {}
    raw_snapshots: Dict[str, EtfSnapshot] = {}
    fund_configs: Dict[str, Dict] = {}

    # Pre-inject snapshot stubs for money-market funds (NAV always $1.00, no yfinance needed)
    for _mmf in _MMF_SYMBOLS:
        snapshots[_mmf] = {
            "symbol": _mmf, "price": 1.0,
            "price_change": 0.0, "price_change_pct": 0.0,
            "day_high": 1.0, "day_low": 1.0,
            "52w_high": 1.0, "52w_low": 1.0,
            "annual_div_amount": None, "ttm_yield": None,
            "total_return_1y": None, "max_drawdown_6m": None,
            "beta": 0.0, "pe_ratio": None, "nav": 1.0,
            "is_money_market": True,
        }

    # Pre-fetch all Schwab quotes in one call (reuse if already fetched via portfolio_snapshot)
    schwab_quotes = {}
    if schwab_snap and schwab_snap.get("quotes"):
        schwab_quotes = schwab_snap["quotes"]
    else:
        try:
            from schwab_client import get_quotes as _sq
            if symbols:
                schwab_quotes = _sq(list(symbols))
        except Exception:
            pass

    if _VERBOSE:
        print(f"[portfolio] Fetching data for {len(symbols)} symbols...")
    
    failed_symbols = []  # Track symbols that failed
    _n_sym = max(len(symbols), 1)

    for i, sym in enumerate(symbols, 1):
        _update_status("loading",
                       f"Fetching prices ({i}/{_n_sym}) — {sym}",
                       28 + int(i / _n_sym * 52))   # 28 → 80 %
        # Build dynamic fund config from Schwab data + generic rules + overrides
        fund_cfg = _build_fund_config(sym, schwab_quotes.get(sym, {}),
                                      symbol_overrides, fund_type_rules)
        benchmark = fund_cfg.get("BENCHMARK", "SPY")
        try:
            if _VERBOSE:
                print(f"[portfolio] [{i}/{len(symbols)}] Fetching {sym}...")
            snap = get_snapshot(sym, benchmark=benchmark,
                                vix_current=vix_current, vix_90d_avg=vix_90d_avg,
                                schwab_quote=schwab_quotes.get(sym))
            decision = evaluate_etf(snap, fund_cfg, meta_rules)
            decisions.append(_decision_to_dict(decision))
            snapshots[sym] = _snap_to_dict(snap)
            raw_snapshots[sym] = snap
            fund_configs[sym] = fund_cfg
            if _VERBOSE:
                print(f"[portfolio] [{i}] ✓ {sym}")
        except ValueError as e:
            # Handle "No historical data found" - symbol may be delisted or typo
            error_msg = str(e)
            if "No historical data found" in error_msg:
                print(f"[portfolio] [{i}] ✗ {sym}: Symbol not found (possibly delisted or typo in target file)")
            else:
                print(f"[portfolio] [{i}] ✗ {sym}: {error_msg}")
            failed_symbols.append(sym)
            # Continue with next symbol - don't crash the whole refresh
            continue
        except Exception as e:
            if _VERBOSE:
                print(f"[portfolio] [{i}] ✗ Error fetching {sym}: {e}")
            failed_symbols.append(sym)
            # Only print traceback in debug mode
            if _DEBUG_REFRESH:
                import traceback as tb
                tb.print_exc()
            continue

    # Log failed symbols at the end
    if failed_symbols:
        print(f"[portfolio] Warning: {len(failed_symbols)} symbol(s) failed: {', '.join(failed_symbols)}")
        
    # ── Fetch YTD income transaction history ─────────────────────────────────
    _update_status("loading", "Fetching income & conversion history…", 82)
    income_history = {}
    try:
        from schwab_client import get_income_transactions as _git
        # Build description→symbol reverse map from Schwab quotes (quotes have .description)
        _desc_to_sym: Dict[str, str] = {}
        for _sq_sym, _sq_data in schwab_quotes.items():
            _desc = (_sq_data.get("description") or "").strip()
            if _desc:
                _desc_to_sym[_desc.lower()] = _sq_sym
        # Merge manual overrides from input.json _DESC_OVERRIDES — handles sold/rotated
        # funds whose Schwab transactions carry only a description, no ticker symbol.
        for _desc_key, _desc_sym in cfg.get("_DESC_OVERRIDES", {}).items():
            if not _desc_key.startswith("_"):
                _desc_to_sym[_desc_key.lower()] = _desc_sym
        income_history = _git(desc_to_symbol=_desc_to_sym)
        if income_history and _VERBOSE:
            print(f"[portfolio] YTD income transactions: "
                  f"${income_history.get('ytd_total', 0):,.2f} across "
                  f"{len(income_history.get('transactions', []))} transactions")
    except Exception as _ihe:
        if _VERBOSE:
            print(f"[portfolio] Income history fetch failed: {_ihe}")

    # ── Fetch YTD Roth conversion history ────────────────────────────────────
    conversion_history = {}
    try:
        from schwab_client import get_conversion_transactions as _gct
        conversion_history = _gct()
        if conversion_history and _VERBOSE:
            print(f"[portfolio] YTD conversions tracked: "
                  f"${conversion_history.get('total_converted_ytd', 0):,.2f} across "
                  f"{len(conversion_history.get('conversions', []))} transactions")
    except Exception as _che:
        if _VERBOSE:
            print(f"[portfolio] Conversion history fetch failed: {_che}")

    # ── Fetch YTD realized capital gains from taxable account ────────────────
    realized_gains_history: dict = {}
    try:
        from schwab_client import get_realized_gains as _grg
        realized_gains_history = _grg()
        if realized_gains_history and _VERBOSE:
            print(f"[portfolio] YTD realized gains: "
                  f"LTCG=${realized_gains_history.get('total_ltcg', 0):,.2f} "
                  f"STCG=${realized_gains_history.get('total_stcg', 0):,.2f}")
    except Exception as _rge:
        if _VERBOSE:
            print(f"[portfolio] Realized gains fetch failed: {_rge}")

    # ── Overlay Schwab live fields onto snapshots (price is already set from get_snapshot) ──
    # get_snapshot() already uses Schwab as the primary price source.
    # This overlay updates the snapshot dict with any additional live Schwab fields
    # (div_amount, ttm_yield, last_distribution, next payment date, etc.).
    if schwab_snap and schwab_snap.get("quotes"):
        for sym, q in schwab_snap["quotes"].items():
            if not q.get("price", 0) or sym not in snapshots:
                continue
            s = snapshots[sym]
            s["price"]           = q["price"]
            s["price_change"]    = q["change"]
            s["price_change_pct"] = q["change_pct"]
            s["day_low"]         = q.get("day_low") or s.get("day_low")
            # Use Schwab annual div amount for accurate income calculations
            if q.get("div_amount") and q["div_amount"] > 0:
                s["annual_div_amount"] = q["div_amount"]   # absolute $ per share/year
                s["ttm_yield"] = q["div_amount"] / q["price"] if q["price"] > 0 else s["ttm_yield"]
            elif q.get("div_yield") and q["div_yield"] > 0:
                s["ttm_yield"] = q["div_yield"] / 100.0
            # Schwab live last distribution
            if q.get("div_pay_amount") and q["div_pay_amount"] > 0:
                s["last_distribution"] = q["div_pay_amount"]
            # Store next payment month (authoritative pay DATE, not ex-date) for
            # calendar accuracy — e.g. ADX ex-date is Apr but pays in May.
            if q.get("next_div_pay_date"):
                try:
                    s["next_div_pay_month"] = int(str(q["next_div_pay_date"])[5:7])
                except Exception:
                    pass
        if _VERBOSE:
            print(f"[portfolio] Overlaid Schwab live data on {len(schwab_snap['quotes'])} symbols.")

    # ── Fetch yield data for money-market funds (excluded from main quote call) ─
    # MMF symbols get a $1.00 price stub but DO earn interest that should appear
    # in the payout calendar (e.g. SWVXX 3.8% ≈ $114/mo on $40K).
    if _MMF_SYMBOLS:
        try:
            from schwab_client import get_quotes as _mmf_get_quotes
            _mmf_q_map = _mmf_get_quotes(list(_MMF_SYMBOLS))
            for _mmf_sym, _mmf_q in _mmf_q_map.items():
                if _mmf_sym not in snapshots:
                    continue
                _ms = snapshots[_mmf_sym]
                if _mmf_q.get("div_amount") and _mmf_q["div_amount"] > 0:
                    _ms["annual_div_amount"] = _mmf_q["div_amount"]
                    if _mmf_q.get("div_yield") and _mmf_q["div_yield"] > 0:
                        _ms["ttm_yield"] = _mmf_q["div_yield"] / 100.0
                if _mmf_q.get("next_div_pay_date"):
                    try:
                        _ms["next_div_pay_month"] = int(str(_mmf_q["next_div_pay_date"])[5:7])
                    except Exception:
                        pass
        except Exception:
            pass

    # Correlation matrix
    if _VERBOSE:
        print("[portfolio] Computing correlation matrix...")
    try:
        corr = get_portfolio_correlation(list(snapshots.keys()))
        corr_data = None
        if corr is not None:
            corr_data = {
                "symbols": list(corr.columns),
                "matrix": corr.values.tolist(),
            }
        if _VERBOSE:
            print("[portfolio] ✓ Correlation matrix complete")
    except Exception as e:
        if _VERBOSE:
            print(f"[portfolio] ✗ Correlation calculation failed: {e}")
        corr_data = None

    # ── Pre-fetch dividend stability metrics for all held symbols ────────────────
    _held_symbols = [s for acct in portfolio.values() for s in acct.get("positions", {})]
    _held_symbols = sorted(set(_held_symbols))
    try:
        _div_metrics = _get_div_metrics_batch(_held_symbols)
    except Exception:
        _div_metrics = {}

    # ── Load EOD snapshot for accurate day-change baseline ───────────────────────
    _eod = _load_eod_values()
    _eod_date   = _eod.get("_date", "")          # "YYYY-MM-DD" or ""
    _eod_by_sym = _eod.get("by_symbol", {})      # { sym: {market_value, shares, price} }
    _today_str  = _et_now().isoformat()

    # Determine whether the EOD snapshot needs a fresh yfinance bootstrap.
    # Three stale conditions:
    #   1. Snapshot is from a prior date → must bootstrap.
    #   2. Snapshot is from today but was saved BEFORE market open (9:30 AM ET).
    #      Pre-market API prices can differ from yesterday's official close by 1-3%
    #      (e.g. earnings gaps, overnight news).  We must re-fetch to get the real
    #      official close from yfinance before using it as a day-change baseline.
    #   3. Snapshot is from today, saved during market hours → was already correctly
    #      bootstrapped from yfinance; leave it alone (don't overwrite with live prices).
    _et_min_now = _et_minutes_since_midnight()
    _market_open_now = _NYSE_OPEN_MIN <= _et_min_now < _NYSE_CLOSE_MIN

    if _eod_date != _today_str:
        # Case 1: prior date
        _eod_needs_update = True
    elif _market_open_now:
        # Case 2/3: snapshot is from today during or before market session.
        # Check the saved timestamp to see if it was captured pre-market.
        _saved_ts_str = _eod.get("_timestamp", "")
        try:
            from datetime import timedelta
            import zoneinfo as _zi
            _saved_utc = datetime.fromisoformat(_saved_ts_str.replace("Z", "+00:00"))
            _saved_et  = _saved_utc.astimezone(_zi.ZoneInfo("America/New_York"))
            _saved_min = _saved_et.hour * 60 + _saved_et.minute
            # Stale if saved before market open today
            _eod_needs_update = _saved_min < _NYSE_OPEN_MIN
        except Exception:
            _eod_needs_update = False   # can't parse → trust it
    else:
        _eod_needs_update = False       # market closed, today's snapshot is fine

    _eod_is_valid = bool(_eod_date)  # any date is better than nothing

    # Build account summaries
    _update_status("loading", "Computing portfolio analytics…", 88)
    accounts = []
    grand_total_value = 0.0
    grand_total_cost = 0.0
    grand_total_income = 0.0
    grand_day_change = 0.0   # portfolio-level day P&L (skips money-market)
    taxable_income = 0.0

    for acct_key, acct_data in portfolio.items():
        label = acct_data.get("label", acct_key)
        positions_data = acct_data.get("positions", {})
        acct_positions = []
        acct_value = 0.0
        acct_cost = 0.0
        acct_income = 0.0

        for sym, pos in sorted(positions_data.items()):
            shares = pos["shares"]
            cost_per = pos["cost_per_share"]
            snap_d = snapshots.get(sym, {})
            is_mmf = snap_d.get("is_money_market") or pos.get("is_money_market", False)
            price = snap_d.get("price") or (1.0 if is_mmf else 0.0)
            market_val = shares * price
            cost_basis = shares * cost_per
            pnl = market_val - cost_basis
            pnl_pct = (pnl / cost_basis * 100) if cost_basis > 0 else 0.0

            # ── Day change ────────────────────────────────────────────────────
            # Money-market funds: NAV is fixed at $1.00 — day change is always $0.
            if is_mmf:
                day_chg = 0.0
            else:
                # Priority 1: Schwab API netChange × shares.
                # This is the same number Schwab's own app shows and is always
                # accurate when the API is live.  netChange = 0 only pre-market
                # or when the API returned no data.
                _api_price_chg = snap_d.get("price_change") or 0.0
                if _api_price_chg != 0.0:
                    day_chg = _api_price_chg * shares
                else:
                    # Priority 2: EOD baseline (server offline during market hours,
                    # or pre-market before Schwab API has pushed today's netChange).
                    _eod_sym = _eod_by_sym.get(sym)
                    if _eod_is_valid and _eod_sym:
                        _eod_total_shares = _eod_sym.get("shares", 0.0)
                        _eod_total_mv     = _eod_sym.get("market_value", 0.0)
                        _eod_acct_mv = (
                            (_eod_total_mv * shares / _eod_total_shares)
                            if _eod_total_shares > 0 else 0.0
                        )
                        day_chg = market_val - _eod_acct_mv
                    else:
                        day_chg = 0.0

            # MMF (SWVXX etc.): show $1/share market value but no dividend income tracking
            ann_div_per_share = snap_d.get("annual_div_amount")
            ttm_yield = snap_d.get("ttm_yield") or 0.0
            if is_mmf:
                annual_income = 0.0
            elif ann_div_per_share and ann_div_per_share > 0:
                annual_income = shares * ann_div_per_share
            else:
                annual_income = shares * (price or 0.0) * ttm_yield

            # Div metrics (stability, forward yield)
            _dm = _div_metrics.get(sym, {})
            _stability  = _dm.get("stability_score")   # 0-100 or None
            _ymodel     = _dm.get("yield_model", "ttm")
            _last_pay   = _dm.get("last_pay", 0.0)
            _freq       = _dm.get("freq_per_yr", 12)
            # Forward annual income: last_pay × freq × shares (if forward model detected)
            _fwd_income = shares * _last_pay * _freq if _ymodel == "forward" and _last_pay > 0 else annual_income

            acct_value += market_val
            acct_cost += cost_basis
            acct_income += annual_income

            acct_positions.append({
                "symbol": sym,
                "shares": shares,
                "cost_per_share": cost_per,
                "current_price": price,
                "market_value": market_val,
                "value": market_val,        # frontend alias
                "cost_basis": cost_basis,
                "cost": cost_basis,         # frontend alias
                "pnl": pnl,
                "pnl_pct": pnl_pct,
                "day_change": round(day_chg, 2),   # accurate daily P&L vs prev close
                "annual_income": annual_income,
                "ttm_yield": ttm_yield,
                "stability_score":       _stability,
                "yield_model":           _ymodel,
                "forward_annual_income": round(_fwd_income, 2),
                "trend":                 _dm.get("trend", "Stable"),
                "trend_pct":             _dm.get("trend_pct", 0.0),
                "growth_rate_1y":        _dm.get("growth_rate_1y"),
                "signal_strength":       None,   # filled in after tax section
                "fund_type":             "MONEY_MARKET" if is_mmf else fund_configs.get(sym, {}).get("FUND_TYPE", "UNKNOWN"),
                "benchmark":             fund_configs.get(sym, {}).get("BENCHMARK", "SPY"),
                "is_money_market":       is_mmf,
            })

        acct_pnl = acct_value - acct_cost
        acct_pnl_pct = (acct_pnl / acct_cost * 100) if acct_cost > 0 else 0.0

        # Merge actual YTD income from transaction history
        _ih_acct = income_history.get("by_account", {}).get(acct_key, {})
        ytd_actual = _ih_acct.get("total", None)   # None = not available
        ytd_by_month = _ih_acct.get("by_month", [])
        ytd_by_symbol = _ih_acct.get("by_symbol", {})

        # Merge ytd_by_symbol back into positions so UI can show per-position actual
        for _p in acct_positions:
            _p["ytd_income_actual"] = ytd_by_symbol.get(_p["symbol"])
            _p["ytd_received"] = _p["ytd_income_actual"]   # frontend alias

        accounts.append({
            "key": acct_key,
            "label": label,
            "value": acct_value,
            "cost": acct_cost,
            "pnl": acct_pnl,
            "pnl_pct": acct_pnl_pct,
            "income": acct_income,
            "ytd_income_actual": ytd_actual,
            "ytd_by_month": ytd_by_month,
            "ytd_by_symbol": ytd_by_symbol,
            "positions": acct_positions,
        })

        grand_total_value += acct_value
        grand_total_cost += acct_cost
        grand_total_income += acct_income
        # Accumulate day change — money-market skipped (day_change is None for those)
        for _p in acct_positions:
            grand_day_change += _p.get("day_change") or 0.0
        if acct_key == "taxable":
            taxable_income = acct_income

    grand_pnl = grand_total_value - grand_total_cost
    grand_pnl_pct = (grand_pnl / grand_total_cost * 100) if grand_total_cost > 0 else 0.0

    # ── Save/update EOD values snapshot ──────────────────────────────────────
    # Two-phase strategy so the snapshot is always accurate regardless of whether
    # the server was running at market close:
    #
    # Stale snapshot (date != today):
    #   Fetch previous-session close prices from yfinance.  Works even if the
    #   server was off for multiple days — yfinance always has historical data.
    #   Example: server starts Thursday after Mon-Wed downtime → yfinance
    #   returns Wednesday's close → correct day-change baseline for Thursday.
    #   Fallback: if yfinance fails and we're outside market hours, use current
    #   prices (pre-market prices ≈ previous close).
    _et_h = _et_hour()
    _eod_needs_update = _eod_date != _today_str   # snapshot is from a prior date

    def _build_eod_from_positions(price_map: dict | None = None) -> dict:
        """Aggregate per-symbol EOD values from current positions.
        price_map: optional {sym: price} override (e.g. from yfinance prev-close).
        If None, uses each position's current_price."""
        _out: dict = {}
        for _acct in accounts:
            for _pos in _acct["positions"]:
                _s = _pos["symbol"]
                _p = price_map.get(_s, _pos["current_price"]) if price_map else _pos["current_price"]
                _sh = _pos["shares"]
                if _s not in _out:
                    _out[_s] = {"market_value": 0.0, "shares": 0.0, "price": _p}
                _out[_s]["market_value"] += _p * _sh
                _out[_s]["shares"]       += _sh
        return _out

    # Calendar-aware — a plain time-of-day check can't tell a Sunday afternoon
    # from a Tuesday afternoon. On a non-trading day there is no new session
    # for yfinance to report anyway (today's date can't have a completed bar),
    # so the live bootstrap attempt below is skipped entirely rather than
    # letting it fail (noisily, every refresh) for no possible benefit.
    #
    # Anchored to noon ET on today's ET calendar date (not "now"), since
    # get_market_status() derives its own "today" from UTC — evenings ET
    # (after ~19:00–20:00 local, once UTC has already rolled to tomorrow's
    # date) would otherwise report tomorrow's trading-day status instead of
    # today's, which is the wrong date for a check about *today's* session.
    try:
        import market_calendar as _mcal_eod
        _et_today = _et_now()  # date already, per time_utils
        _noon_et_utc = datetime(_et_today.year, _et_today.month, _et_today.day, 16, tzinfo=timezone.utc)
        _is_trading_day_today = _mcal_eod.get_market_status(_noon_et_utc)['is_trading_day']
    except Exception:
        _is_trading_day_today = True   # unknown → don't suppress the bootstrap

    if _eod_needs_update:
        _eod_bootstrapped = False

        if _is_trading_day_today:
            # Phase 1: bootstrap from yfinance previous-session close.
            try:
                import yfinance as _yf
                _syms_eod = list({
                    _pos["symbol"]
                    for _acct in accounts
                    for _pos in _acct["positions"]
                })
                if _syms_eod:
                    # period="10d" ensures we always get at least 2 completed sessions
                    # even after long weekends or multi-day server downtime.
                    _yf_hist = _yf.download(
                        _syms_eod, period="10d",
                        auto_adjust=True, progress=False, threads=False,
                    )["Close"]

                    def _prev_close_from_col(col):
                        """
                        Return the last COMPLETED session's close price.
                        yfinance can include an in-progress bar for today (even
                        during pre-market) whose date matches today's date.
                        If the last row is dated today, step back one row so we
                        always baseline against yesterday's official close.
                        """
                        col = col.dropna()
                        if col.empty:
                            return None
                        import pandas as _pd
                        _last_idx = col.index[-1]
                        # Normalise to date for comparison
                        _last_date = (
                            _last_idx.date() if hasattr(_last_idx, "date")
                            else _pd.Timestamp(_last_idx).date()
                        )
                        import datetime as _dt
                        _today_date = _dt.date.today()
                        if _last_date >= _today_date and len(col) >= 2:
                            return float(col.iloc[-2])   # yesterday's official close
                        return float(col.iloc[-1])

                    if len(_syms_eod) == 1:
                        _col0 = _yf_hist.squeeze()
                        _pc = _prev_close_from_col(_col0 if hasattr(_col0, "index") else _yf_hist)
                        _prev_map: dict = {_syms_eod[0]: _pc} if _pc is not None else {}
                    else:
                        _prev_map = {}
                        for _s in _syms_eod:
                            if _s in _yf_hist.columns:
                                _pc = _prev_close_from_col(_yf_hist[_s])
                                if _pc is not None:
                                    _prev_map[_s] = _pc
                    if _prev_map:
                        _eod_new = _build_eod_from_positions(_prev_map)
                        if _eod_new:
                            _save_eod_values(_eod_new)
                            _eod_by_sym.update(_eod_new)
                            _eod_date = _today_str
                            _eod_bootstrapped = True
                            if _VERBOSE:
                                print(f"[eod] Bootstrapped prev-close baseline via yfinance "
                                      f"({len(_eod_new)} symbols, ref date ≈ previous session)")
            except Exception as _e:
                if _VERBOSE:
                    print(f"[eod] yfinance prev-close fetch failed: {_e}")

        if not _eod_bootstrapped:
            # Fallback: use current API prices as baseline when market is
            # genuinely closed — a non-trading day (weekend/holiday, any time
            # of day) or after 4 PM ET on a trading day.
            # Pre-market prices can deviate from official close by 1-3% on news
            # gaps — never use them as a day-change baseline.
            _et_min_fb = _et_minutes_since_midnight()
            _after_close = _et_min_fb >= _NYSE_CLOSE_MIN   # 4:00 PM ET or later
            if not _is_trading_day_today or _after_close:
                _eod_new = _build_eod_from_positions()
                _save_eod_values(_eod_new)
                _eod_by_sym.update(_eod_new)
                _eod_date = _today_str
                if _VERBOSE:
                    print(f"[eod] Saved current-price EOD baseline (yfinance skipped/unavailable, "
                          f"market closed, {len(_eod_new)} symbols)")
            else:
                if _VERBOSE:
                    print("[eod] yfinance bootstrap failed during market hours — "
                          "day-change will use API price_change fallback")

    # ── Income analytics ─────────────────────────────────────────────────────
    income_analytics: Dict[str, Any] = {}
    try:
        import statistics as _stats

        # ── Tax Rule Engine: derive income target dynamically from brackets ──
        # Priority: personal.json._TAX_SETTINGS > rules.json._TAX_RULE_ENGINE
        _tre_cfg         = cfg.get("_TAX_RULE_ENGINE", {})
        _tax_settings    = cfg.get("_TAX_SETTINGS", {})   # personal.json — user's target bracket
        _tb_cfg          = cfg.get("_TAX_BRACKETS", {})
        _filing          = cfg.get("_PERSONAL", {}).get("filing_status", "MFJ")
        _bkt_key_ia      = "brackets_mfj"        if _filing == "MFJ" else "brackets_single"
        _std_ded_key_ia  = "standard_deduction_mfj" if _filing == "MFJ" else "standard_deduction_single"
        _std_ded_ia      = float(_tb_cfg.get(_std_ded_key_ia, 32200))
        # Add age-65 bonus: IRS additional deduction + temporary senior deduction (2025–2028)
        try:
            from datetime import date as _d_ia
            def _age_ia(dob_s: str):
                p = dob_s.split("-"); t = _d_ia.today()
                return t.year - int(p[0]) - ((t.month, t.day) < (int(p[1]), int(p[2])))
            _pa_ia  = _age_ia(cfg.get("_PERSONAL", {}).get("dob", ""))
            _sa_ia  = _age_ia(cfg.get("_PERSONAL", {}).get("spouse", {}).get("dob", "")) if cfg.get("_PERSONAL", {}).get("spouse", {}).get("dob") else None
            _q_ia   = sum(1 for a in (_pa_ia, _sa_ia) if a is not None and a >= 65)
            _yr_ia  = _d_ia.today().year
            _std_ded_ia += float(_tb_cfg.get("age_65_additional_deduction_per_person", 1650)) * _q_ia
            if _yr_ia <= int(_tb_cfg.get("senior_deduction_expires_year", 2028)):
                _std_ded_ia += float(_tb_cfg.get("senior_deduction_per_person", 6000)) * _q_ia
        except Exception:
            pass
        # Use personal.json._TAX_SETTINGS.target_bracket_rate if set, else fall back to rules.json
        _target_rate_ia  = float(
            _tax_settings.get("target_bracket_rate") or _tre_cfg.get("target_bracket_rate", 24)
        ) / 100.0
        _ia_brackets     = _tb_cfg.get(_bkt_key_ia, [])
        _ia_bracket_max  = next(
            (b["max"] for b in _ia_brackets if abs(b["rate"] - _target_rate_ia) < 0.001 and b["max"] is not None),
            None
        )
        # gross income target = taxable ceiling + standard deduction
        _income_bracket_target = (_ia_bracket_max + _std_ded_ia) if _ia_bracket_max else 0.0

        # Soft limit: user's personal dividend income constraint (e.g. $160k)
        _ia_soft_limit   = float(_tre_cfg.get("soft_limit", cfg.get("_WITHDRAWAL_STRATEGY", {}).get("dividend_load_alert", 160_000)))

        # Override module-level defaults with live config
        global _INCOME_CEILING, _INCOME_TARGET
        _INCOME_CEILING = _ia_soft_limit
        _INCOME_TARGET  = _income_bracket_target

        # Target income: use explicit override from _PERSONAL if set, otherwise use bracket-derived target
        _target_income = float(cfg.get("_PERSONAL", {}).get("target_income", _income_bracket_target))

        # Per-account volatility scores, forward 12M income, and confidence
        _acct_analytics = {}
        _portfolio_fwd12m = 0.0
        for _acct in accounts:
            _by_month = _acct.get("ytd_by_month") or []
            _nonzero  = [v for v in _by_month if v > 0]
            if len(_nonzero) >= 2:
                _mean = _stats.mean(_nonzero)
                _std  = _stats.pstdev(_nonzero)
                _vol  = round(_std / _mean * 100, 1) if _mean > 0 else 0.0
            elif len(_nonzero) == 1:
                _vol = 0.0
            else:
                _vol = None

            # Weighted average stability across held positions
            _stab_num, _stab_den = 0.0, 0.0
            for _p in _acct["positions"]:
                if _p.get("shares", 0) > 0 and _p.get("stability_score") is not None:
                    _ai = _p.get("forward_annual_income") or _p.get("annual_income", 0.0)
                    _stab_num += _p["stability_score"] * _ai
                    _stab_den += _ai
            _avg_stab = _stab_num / _stab_den if _stab_den > 0 else None

            # Forward confidence = weighted_stability × (1 - vol/100); 0-100
            # Fallbacks when one component is unavailable:
            #   no stability → use vol-only proxy (50 base × (1 - vol/100))
            #   no vol       → use stability alone
            #   neither      → None
            _fwd12 = sum(p.get("forward_annual_income", p.get("annual_income", 0))
                         for p in _acct["positions"] if p.get("shares", 0) > 0)

            if _avg_stab is not None and _vol is not None:
                _conf = round((_avg_stab / 100.0) * (1.0 - min(_vol, 100.0) / 100.0) * 100.0, 1)
            elif _vol is not None:
                # stability data unavailable — use income payment consistency as proxy
                _conf = round((1.0 - min(_vol, 100.0) / 100.0) * 65.0, 1)  # cap at 65
            elif _avg_stab is not None:
                _conf = round(_avg_stab * 0.70, 1)  # penalise unknown vol
            elif _fwd12 > 0:
                # No YTD history and no stability scores — use number of income-paying
                # positions as a diversity proxy (more positions = more reliable)
                _n_paying = sum(1 for p in _acct["positions"]
                                if p.get("shares", 0) > 0
                                and (p.get("forward_annual_income") or p.get("annual_income", 0)) > 0)
                _conf = round(min(55.0, 30.0 + _n_paying * 3.0), 1)
            else:
                _conf = None

            # Pull per-account YTD total and per-symbol breakdown from income_history
            _ih_acct_data   = income_history.get("by_account", {}).get(_acct["key"], {})
            _ytd_acct_total = _ih_acct_data.get("total", 0.0)
            _by_symbol_ytd  = _ih_acct_data.get("by_symbol", {})

            _acct_analytics[_acct["key"]] = {
                "fwd_12m":            round(_fwd12, 2),           # field name UI expects
                "ytd_income":         round(_ytd_acct_total, 2),  # field name UI expects
                "by_symbol":          _by_symbol_ytd,             # per-symbol YTD received
                "volatility_score":   _vol,
                "avg_stability":      round(_avg_stab, 1) if _avg_stab is not None else None,
                "forward_confidence": _conf,
            }
            _portfolio_fwd12m += _fwd12

        # ── Dividend ceiling drift (taxable account only) ─────────────────
        _ytd_taxable = income_history.get("by_account", {}).get("taxable", {}).get("total") or 0.0
        _today_dt    = datetime.now()
        _months_done = _today_dt.month        # months elapsed (include current partial)
        _months_left = 12 - _months_done
        _monthly_avg = _ytd_taxable / _months_done if _months_done > 0 else 0.0
        _projected_eoy = _ytd_taxable + _monthly_avg * _months_left
        _ceiling_gap   = max(0.0, _INCOME_CEILING - _projected_eoy)
        _ceiling_over  = max(0.0, _projected_eoy - _INCOME_CEILING)
        if _monthly_avg > 0:
            _remaining_budget  = _INCOME_CEILING - _ytd_taxable
            _months_to_ceiling = max(0.0, _remaining_budget / _monthly_avg)
        else:
            _months_to_ceiling = None

        # ── Income growth rate (weighted-avg per-symbol 1y growth rates) ──
        _gr_num, _gr_den = 0.0, 0.0
        for _acct in accounts:
            for _p in _acct["positions"]:
                _gr = _p.get("growth_rate_1y")
                _ai = _p.get("forward_annual_income") or _p.get("annual_income", 0.0)
                if _gr is not None and _ai > 0:
                    _gr_num += _gr * _ai
                    _gr_den += _ai
        _portfolio_growth_rate = _gr_num / _gr_den if _gr_den > 0 else None

        # ── Income gap vs target ──────────────────────────────────────────
        _income_gap     = _target_income - _portfolio_fwd12m
        _gap_pct        = _income_gap / _target_income * 100 if _target_income > 0 else None

        # ── Ceiling drift trend (day-over-day) ────────────────────────────────
        _ceiling_drift_raw   = _projected_eoy - _INCOME_CEILING  # negative=under(good), positive=over(bad)
        _yesterday_cdr       = _trends_cache.get("ceiling_drift_raw")
        if _yesterday_cdr is not None:
            _cdr_delta = _ceiling_drift_raw - _yesterday_cdr
            if _cdr_delta < -500:
                _cdr_trend_lbl, _cdr_trend_color = "↓ Improving", "green"
            elif _cdr_delta > 500:
                _cdr_trend_lbl, _cdr_trend_color = "↑ Worsening", "red"
            else:
                _cdr_trend_lbl, _cdr_trend_color = "→ Stable", "muted"
        else:
            _cdr_trend_lbl, _cdr_trend_color = None, None

        # ── Account confidence trends (day-over-day) ──────────────────────────
        _yest_acct_conf = _trends_cache.get("account_confidence", {})
        for _ak, _av in _acct_analytics.items():
            _tc = _av.get("forward_confidence")
            _yc = _yest_acct_conf.get(_ak)
            if _tc is not None and _yc is not None:
                _cd = _tc - _yc
                if _cd > 2:
                    _av["confidence_trend"], _av["confidence_trend_color"] = "↑ Strengthening", "green"
                elif _cd < -2:
                    _av["confidence_trend"], _av["confidence_trend_color"] = "↓ Weakening", "red"
                else:
                    _av["confidence_trend"], _av["confidence_trend_color"] = "→ Stable", "muted"
            else:
                _av["confidence_trend"], _av["confidence_trend_color"] = None, None

        # ── Conversion window status ──────────────────────────────────────────
        _tax_conf_val = _acct_analytics.get("taxable", {}).get("forward_confidence") or 0.0
        if _ceiling_over > 0:
            _conv_window = "CLOSED"
        elif _tax_conf_val < 80:
            _conv_window = "WAIT"
        else:
            _conv_window = "OPEN"

        # ── Lifestyle income target (from _INCOME_TARGET block in input.json) ──
        _it_cfg       = cfg.get("_INCOME_TARGET", {})
        _ls_ann_min   = float(_it_cfg.get("annual_min", 0) or 0) or float(_it_cfg.get("monthly_min", 0) or 0) * 12
        _ls_ann_max   = float(_it_cfg.get("annual_max", 0) or 0) or float(_it_cfg.get("monthly_max", 0) or 0) * 12
        if _ls_ann_min > 0 and _ls_ann_max > 0:
            _ls_prog_min = round(min(_portfolio_fwd12m / _ls_ann_max * 100, 200), 1)
            _ls_prog_max = round(min(_portfolio_fwd12m / _ls_ann_min * 100, 200), 1)
            _ls_gap_min  = round(max(0.0, _ls_ann_min - _portfolio_fwd12m), 2)
            _ls_gap_max  = round(max(0.0, _ls_ann_max - _portfolio_fwd12m), 2)
            if _portfolio_fwd12m >= _ls_ann_max:
                _ls_status = "COVERED"
            elif _portfolio_fwd12m >= _ls_ann_min:
                _ls_status = "PARTIAL"
            else:
                _ls_status = "SHORT"
        else:
            _ls_ann_min = _ls_ann_max = None
            _ls_prog_min = _ls_prog_max = _ls_gap_min = _ls_gap_max = None
            _ls_status = None

        income_analytics = {
            "by_account":            _acct_analytics,
            "portfolio_fwd_12m":     round(_portfolio_fwd12m, 2),
            # Pre-computed ratio so tabs don't re-derive fwd12m / total_value individually
            "yield_pct":             round((_portfolio_fwd12m / grand_total_value * 100) if grand_total_value else 0.0, 3),
            "taxable_ytd":           round(_ytd_taxable, 2),
            "monthly_avg":           round(_monthly_avg, 2),
            "projected_eoy":         round(_projected_eoy, 2),
            "ceiling":               _INCOME_CEILING,
            "ceiling_gap":           round(_ceiling_gap, 2),
            "ceiling_over":          round(_ceiling_over, 2),
            "months_to_ceiling":     round(_months_to_ceiling, 1) if _months_to_ceiling is not None else None,
            "ceiling_drift_raw":     round(_ceiling_drift_raw, 2),
            "ceiling_drift_trend":   _cdr_trend_lbl,
            "ceiling_drift_trend_color": _cdr_trend_color,
            "conversion_window":     _conv_window,
            "avg_quality_score":     None,   # filled in after tax section builds _div_tax_detail
            "income_growth_rate":    round(_portfolio_growth_rate, 4) if _portfolio_growth_rate is not None else None,
            "target_income":         _target_income,
            "income_gap":            round(_income_gap, 2),
            "gap_pct":               round(_gap_pct, 1) if _gap_pct is not None else None,
            # Lifestyle income target (from _INCOME_TARGET block)
            "lifestyle_target_min":   _ls_ann_min,
            "lifestyle_target_max":   _ls_ann_max,
            "lifestyle_progress_min": _ls_prog_min,
            "lifestyle_progress_max": _ls_prog_max,
            "lifestyle_gap_min":      _ls_gap_min,
            "lifestyle_gap_max":      _ls_gap_max,
            "lifestyle_status":       _ls_status,
            # Filled in after tax section:
            "forward_tax_impact":    None,
            "stress_test":           None,
            "income_attribution":    None,
        }
    except Exception as _iae:
        if _VERBOSE:
            print(f"[portfolio] income_analytics error: {_iae}")
        traceback.print_exc()

    # ── Portfolio intelligence ────────────────────────────────────────────────
    portfolio_intel = {}
    try:
        # 1. Position weights (all accounts combined)
        all_pos_values: Dict[str, float] = {}
        for acct in accounts:
            for p in acct["positions"]:
                all_pos_values[p["symbol"]] = all_pos_values.get(p["symbol"], 0.0) + p["market_value"]
        port_total = sum(all_pos_values.values()) or 1.0
        weights = {sym: v / port_total for sym, v in all_pos_values.items()}

        # 2. Top holding
        top_sym  = max(weights, key=weights.get) if weights else "—"
        top_pct  = weights.get(top_sym, 0.0)
        conc_level = "HIGH" if top_pct > 0.25 else "MODERATE" if top_pct > 0.15 else "LOW"

        # 3. High-correlation pairs (from existing corr_data)
        high_corr_pairs = []
        if corr_data:
            syms_c = corr_data["symbols"]
            mat_c  = corr_data["matrix"]
            for i in range(len(syms_c)):
                for j in range(i + 1, len(syms_c)):
                    if mat_c[i][j] >= 0.80:   # matches frontend heuristic threshold
                        high_corr_pairs.append({
                            "a": syms_c[i], "b": syms_c[j],
                            "corr": round(mat_c[i][j], 2)
                        })
        corr_risk = "HIGH" if len(high_corr_pairs) > 6 else "MODERATE" if len(high_corr_pairs) > 0 else "LOW"

        # 4. Factor exposure buckets
        tech_growth_val = sum(
            v for sym, v in all_pos_values.items()
            if fund_configs.get(sym, {}).get("FUND_TYPE") == "GROWTH"
            or fund_configs.get(sym, {}).get("BENCHMARK") in ("QQQ", "SOXX", "QQQM")
        )
        income_val = sum(
            v for sym, v in all_pos_values.items()
            if fund_configs.get(sym, {}).get("FUND_TYPE") in ("OPTION_INCOME", "DIVIDEND", "CEF")
        )
        tech_growth_pct = round(tech_growth_val / port_total * 100, 1)
        income_pct      = round(income_val      / port_total * 100, 1)
        defensive_pct   = round(max(0.0, 100 - tech_growth_pct - income_pct), 1)

        # 5. Beta-weighted stress test: QQQ −20% ≈ SPY −16%
        weighted_beta = sum(
            weights.get(sym, 0.0) * (snapshots.get(sym, {}).get("beta") or 1.0)
            for sym in all_pos_values
        )
        spy_equiv_drop = -0.20 / 1.25   # QQQ -20% → approx SPY -16%
        stress_pct     = round(weighted_beta * spy_equiv_drop * 100, 1)
        stress_dollar  = round(port_total * weighted_beta * spy_equiv_drop, 0)

        # 6. Market regime synthesis
        sp500_data = market_context.get("S&P 500") or {}
        mom20   = sp500_data.get("momentum_20d", 0.0) or 0.0
        trend90 = sp500_data.get("trend_90d",    0.0) or 0.0
        vix_cur = vix_current or 20.0
        if vix_cur > 30:
            vol_regime = "HIGH"
        elif vix_cur < 15:
            vol_regime = "LOW"
        else:
            vol_regime = "NORMAL"
        if vix_cur > 30 or (mom20 < -0.03 and trend90 < -0.05):
            market_regime = "RISK-OFF"
        elif mom20 > 0.03 and trend90 > 0.05:
            market_regime = "EXPANSION"
        else:
            market_regime = "NEUTRAL"
        if mom20 > 0.02:
            trend_signal = "Short-term bullish"
        elif mom20 < -0.02:
            trend_signal = "Short-term bearish"
        else:
            trend_signal = "Flat / consolidating"

        # 7. Income stability (option-income vs stable)
        stable_inc = sum(
            p["annual_income"]
            for acct in accounts for p in acct["positions"]
            if fund_configs.get(p["symbol"], {}).get("FUND_TYPE") not in ("OPTION_INCOME",)
        )
        inc_stability_pct = round(stable_inc / grand_total_income * 100, 1) if grand_total_income > 0 else 0.0
        inc_stability_lbl = "HIGH" if inc_stability_pct > 60 else "MODERATE" if inc_stability_pct > 30 else "LOW"

        # 8. Tax exposure ratio
        tax_free_inc  = sum(p["annual_income"] for acct in accounts if acct["key"] != "taxable" for p in acct["positions"])
        taxable_inc_r = sum(p["annual_income"] for acct in accounts if acct["key"] == "taxable"  for p in acct["positions"])
        tot_inc = (tax_free_inc + taxable_inc_r) or 1.0
        taxable_inc_pct  = round(taxable_inc_r / tot_inc * 100, 1)
        tax_free_inc_pct = round(tax_free_inc  / tot_inc * 100, 1)

        # 9. Fund-level valuation status (for traffic light enhancement)
        #
        # Premium/discount is a SIGNAL only for CEFs — the only fund type where
        # price structurally diverges from NAV (no creation/redemption mechanism).
        #
        # OPTION_INCOME ETFs (SPYI, QDVO, …) are still open-ended ETFs: their
        # creation/redemption keeps price ≈ NAV.  The fallback NAV in fallback_data
        # is only used to detect NAV *decay*, not premium.  Any apparent premium
        # is data-quality noise, not an investment signal.
        #
        # For all ETFs (OPTION_INCOME, GROWTH, DIVIDEND): use 90-day momentum
        # trend as the valuation signal — it captures "stretched" vs "fair" more
        # accurately than a stale NAV comparison ever could.
        fund_valuation = {}
        for sym, snap in snapshots.items():
            fund_type = fund_configs.get(sym, {}).get("FUND_TYPE", "")
            if fund_type == "CEF":
                prem = snap.get("premium")
                if prem is None:
                    val_status = "UNKNOWN"
                else:
                    # CEF: discount is favorable, premium above NAV is expensive
                    val_status = "DISCOUNTED" if prem < -0.05 else "FAIR" if prem < 0.05 else "EXTENDED"
            else:
                # All ETFs (OPTION_INCOME, GROWTH, DIVIDEND, MONEY_MARKET):
                # use 90-day price trend as valuation proxy
                trend = snap.get("trend_90d")
                if trend is None:
                    val_status = "FAIR"
                elif trend > 0.25:
                    val_status = "EXTENDED"   # up >25% in 90d — stretched momentum
                elif trend > 0.12:
                    val_status = "ELEVATED"
                else:
                    val_status = "FAIR"
            fund_valuation[sym] = val_status

        # 10. Fragility Score: concentration × beta × correlation_cluster → 0–100
        _corr_factor = 1.0 + min(1.0, len(high_corr_pairs) / 5.0)
        _fragility_raw = top_pct * weighted_beta * _corr_factor
        fragility_score = int(round(min(100.0, _fragility_raw / 2.2 * 100)))
        # Additive penalties for risk factors that the base formula under-weights
        _frag_penalty = 0
        if top_pct > 0.35:           _frag_penalty += 5   # single-name concentration
        if weighted_beta > 1.3:      _frag_penalty += 5   # high-beta tilt
        if len(high_corr_pairs) > 5: _frag_penalty += 5   # broad correlation cluster
        fragility_score = int(min(100, fragility_score + _frag_penalty))
        fragility_level = "HIGH" if fragility_score > 70 else "MODERATE" if fragility_score > 40 else "LOW"

        # 11. Additional stress scenarios
        # Concentration stress: top 2 largest holdings by combined portfolio weight.
        # Scenario: that position drops -30% while the rest of the portfolio drops -5%.
        # Purely weight-driven — no hardcoded symbols.
        def _calc_position_stress(sym: str) -> tuple:
            """Return (stress_pct, stress_dollar) for a single-position -30% shock."""
            _wt = weights.get(sym, 0.0)
            _rest = 1.0 - _wt
            if _rest > 0.01:
                _beta_ex = sum(
                    w * (snapshots.get(s, {}).get("beta") or 1.0)
                    for s, w in weights.items() if s != sym
                ) / _rest
            else:
                _beta_ex = weighted_beta
            _pct = round((_wt * (-0.30) + _rest * _beta_ex * (-0.05)) * 100, 1)
            _dol = round(port_total * _pct / 100.0, 0)
            return _pct, _dol

        # Sort all positions by portfolio weight descending; take top 2 with ≥ 5%
        _sorted_by_weight = sorted(
            [(s, w) for s, w in weights.items() if w >= 0.05],
            key=lambda x: x[1], reverse=True
        )
        if len(_sorted_by_weight) >= 1:
            _stress_top_sym = _sorted_by_weight[0][0]
            stress_top_pct, stress_top_dollar = _calc_position_stress(_stress_top_sym)
        else:
            _stress_top_sym = None
            stress_top_pct = stress_top_dollar = None

        if len(_sorted_by_weight) >= 2:
            _stress_top2_sym = _sorted_by_weight[1][0]
            stress_top2_pct, stress_top2_dollar = _calc_position_stress(_stress_top2_sym)
        else:
            _stress_top2_sym = None
            stress_top2_pct = stress_top2_dollar = None

        # VIX → 30: growth/tech gets a market hit; option-income gets an NAV hit
        _g_weight = tech_growth_pct / 100.0
        _i_weight = income_pct / 100.0
        stress_vix_pct = round(
            _g_weight * weighted_beta * (-0.15) * 100 + _i_weight * (-0.08) * 100, 1
        )
        stress_vix_dollar = round(port_total * stress_vix_pct / 100.0, 0)

        # 12. Top holding return/drawdown contribution
        _top_snap = snapshots.get(top_sym, {}) if top_sym != "—" else {}
        top_return_1y_pct        = round((_top_snap.get("total_return_1y") or 0.0) * 100, 1)
        top_return_contrib_pct   = round(top_pct * (_top_snap.get("total_return_1y") or 0.0) * 100, 1)
        top_drawdown_contrib_pct = round(top_pct * abs(_top_snap.get("max_drawdown_6m") or 0.0) * 100, 1)

        # 13. Portfolio positioning vs market regime
        if weighted_beta > 1.2 or tech_growth_pct > 50:
            positioning = "AGGRESSIVE"
        elif weighted_beta < 0.8 and tech_growth_pct < 30:
            positioning = "CONSERVATIVE"
        else:
            positioning = "MODERATE"

        # 14. Income forecast / durability
        _option_income_share = max(0.0, 1.0 - (inc_stability_pct / 100.0))
        income_vix_spike_drop_pct = round(-_option_income_share * 30.0, 1)
        income_durability_score = int(round(
            min(100, inc_stability_pct * 0.7 + max(0, 100 - abs(income_vix_spike_drop_pct)) * 0.3)
        ))

        # 15. Target vs Actual per account (descriptive, not prescriptive)
        def _acct_target_vs_actual(acct_key: str, targets: dict) -> list:
            acct = next((a for a in accounts if a["key"] == acct_key), None)
            if not acct or not targets:
                return []
            acct_total = acct["value"] or 1.0
            rows = []
            all_syms = sorted(set(list(targets.keys()) + [p["symbol"] for p in acct["positions"]]))
            for sym in all_syms:
                actual_val = sum(p["market_value"] for p in acct["positions"] if p["symbol"] == sym)
                actual_wt  = actual_val / acct_total
                target_wt  = targets.get(sym, 0.0)
                delta      = actual_wt - target_wt
                snap       = snapshots.get(sym, {})
                stress_30  = round(actual_wt * (-0.30) * 100, 1)  # portfolio impact if sym -30%
                rows.append({
                    "symbol":     sym,
                    "target_pct": round(target_wt * 100, 1),
                    "actual_pct": round(actual_wt * 100, 1),
                    "delta_pct":  round(delta * 100, 1),
                    "stress_30_pct": stress_30,
                    "in_target":  sym in targets,
                    "in_acct":    actual_val > 0,
                })
            rows.sort(key=lambda r: abs(r["delta_pct"]), reverse=True)
            return rows

        taxable_target_vs_actual = _acct_target_vs_actual("taxable", taxable_targets_file)
        roth_target_vs_actual    = _acct_target_vs_actual("roth_ira", roth_targets_file)

        # Rollover: single-position intentional account — just describe it
        rollover_acct = next((a for a in accounts if a["key"] == "rollover_ira"), None)
        rollover_concentration = []
        if rollover_acct and rollover_acct["value"] > 0:
            rv = rollover_acct["value"]
            for p in rollover_acct["positions"]:
                rollover_concentration.append({
                    "symbol":     p["symbol"],
                    "actual_pct": round(p["market_value"] / rv * 100, 1),
                    "stress_30_pct": round(p["market_value"] / rv * (-0.30) * 100, 1),
                })

        # ── System Confidence Score ──────────────────────────────────────────
        # 0.25*(100-fragility) + 0.25*durability + 0.25*stability + 0.25*(100-beta_risk)
        _frag_comp  = max(0.0, 100.0 - (fragility_score or 50))
        _dur_comp   = income_durability_score or 50.0
        _stab_comp  = float(inc_stability_pct or 50)
        _beta_risk  = min(100.0, max(0.0, (weighted_beta - 0.5) * 67.0))   # 0.5β→0, 2.0β→100
        _scs        = round(0.25 * _frag_comp + 0.25 * _dur_comp + 0.25 * _stab_comp + 0.25 * (100.0 - _beta_risk), 1)
        # Signal quality penalty: weak portfolio-weighted signal → -10 confidence
        _sig_cache  = _trends_cache.get("signal_strengths", {})
        _wt_sig_num = sum(weights.get(s, 0) * float(v or 50) for s, v in _sig_cache.items() if s in weights)
        _wt_sig_den = sum(weights.get(s, 0) for s in _sig_cache if s in weights)
        _port_sig   = _wt_sig_num / _wt_sig_den if _wt_sig_den > 0 else 50.0
        if _port_sig < 40.0:
            _scs = max(0.0, round(_scs - 10.0, 1))
        _scs_label  = "Strong" if _scs >= 75 else "Stable" if _scs >= 55 else "Moderate" if _scs >= 35 else "Fragile"

        # ── Portfolio vol estimate (weighted avg of individual vols) ─────────
        _pf_vol_num, _pf_vol_den = 0.0, 0.0
        for _pv_sym, _pv_w in weights.items():
            _pv_snap = snapshots.get(_pv_sym, {})
            _pv_vol  = _pv_snap.get("vol_30d_annual")
            if _pv_vol is not None:
                _pf_vol_num += _pv_w * _pv_vol * 100  # pct
                _pf_vol_den += _pv_w
        _portfolio_vol_pct = round(_pf_vol_num / _pf_vol_den, 1) if _pf_vol_den > 0 else None
        _target_vol_pct    = float(cfg.get("_PERSONAL", {}).get("target_vol_pct", 15.0))
        _vol_budget_used   = round(_portfolio_vol_pct / _target_vol_pct * 100, 1) if _portfolio_vol_pct else None

        # ── Combined stress (QQQ -20% + VIX spike, additive) ────────────────
        _comb_pct    = None
        _comb_dollar = None
        if stress_pct is not None and stress_vix_pct is not None:
            # Partial overlap: assume 70% correlation between scenarios
            _comb_pct    = round(stress_pct + stress_vix_pct * 0.5, 1)
            _comb_dollar = round(grand_total_value * _comb_pct / 100, 0)

        # ── Top risks (ranked list, fully dynamic) ───────────────────────────
        _top_risks: List[dict] = []
        if top_pct >= 0.20:
            _top_risks.append({"level": "red",    "msg": f"Concentration: {top_sym} {round(top_pct*100,1)}% of portfolio ({conc_level})"})
        if corr_risk == "HIGH":
            _top_risks.append({"level": "orange", "msg": f"High correlation cluster detected across {len(high_corr_pairs)} pairs"})
        if fragility_score and fragility_score >= 70:
            _top_risks.append({"level": "orange", "msg": f"Fragility {fragility_score}/100 — concentrated β×correlation risk"})
        if weighted_beta >= 1.3:
            _top_risks.append({"level": "orange", "msg": f"Portfolio β={weighted_beta:.2f} — high market sensitivity"})
        for _fv_sym, _fv_val in (fund_valuation or {}).items():
            if _fv_val == "EXTENDED":
                _top_risks.append({"level": "yellow", "msg": f"Valuation risk: {_fv_sym} at EXTENDED level"})
                break  # show only first
        if income_vix_spike_drop_pct and income_vix_spike_drop_pct < -15:
            _top_risks.append({"level": "yellow", "msg": f"VIX spike risk: income could drop ~{income_vix_spike_drop_pct}% in volatility event"})
        # Sort: red first
        _top_risks = sorted(_top_risks, key=lambda r: ["red","orange","yellow"].index(r["level"]))[:4]

        # ── Top opportunities (ranked, fully dynamic) ────────────────────────
        _top_opps: List[dict] = []
        for _op_dec in decisions:
            _op_sym  = _op_dec.get("symbol", "")
            _op_snap = snapshots.get(_op_sym, {})
            _op_prem = _op_snap.get("premium")
            _op_fv   = (fund_valuation or {}).get(_op_sym, "")
            _op_stab = _div_metrics.get(_op_sym, {}).get("stability_score")
            _op_ft   = fund_configs.get(_op_sym, {}).get("FUND_TYPE", "")
            # Discount-to-NAV opportunity: CEF only.
            # OPTION_INCOME ETFs have creation/redemption — any apparent discount
            # is data-quality noise, not a buying opportunity.
            _op_cef = _op_ft == "CEF"
            if _op_cef and _op_prem is not None and _op_prem < -0.03:
                _top_opps.append({"sym": _op_sym, "score": 3, "msg": f"{_op_sym}: {abs(_op_prem)*100:.1f}% discount to NAV"})
            elif _op_fv in ("FAIR", "DISCOUNTED"):
                _score = 2 if _op_fv == "DISCOUNTED" else 1
                if _op_stab and _op_stab >= 70:
                    _score += 1
                _top_opps.append({"sym": _op_sym, "score": _score, "msg": f"{_op_sym}: {_op_fv} valuation" + (f" + stability {_op_stab:.0f}" if _op_stab else "")})
        _top_opps = sorted(_top_opps, key=lambda o: o["score"], reverse=True)[:3]

        # ── Confidence Trend (vs previous snapshot) ──────────────────────────
        _prev_scs       = _read_prev_confidence()
        _conf_delta     = round(_scs - _prev_scs, 1) if _prev_scs is not None else None
        _conf_trend_lbl: Optional[str]
        if _conf_delta is None:
            _conf_trend_lbl = None
        elif _conf_delta >= 2.0:
            _conf_trend_lbl = "Strengthening"
        elif _conf_delta <= -2.0:
            _conf_trend_lbl = "Weakening"
        else:
            _conf_trend_lbl = "Stable"
        _write_confidence(_scs)   # persist for next run

        # ── Risk Budget (composite throttle) ─────────────────────────────────
        # 0.5 × Vol Budget + 0.5 × Fragility; expressed as % (100 = fully used)
        _rb_vol  = _vol_budget_used if _vol_budget_used is not None else 100.0
        _rb_frag = float(fragility_score or 50)
        _risk_budget_used = round(0.5 * _rb_vol + 0.5 * _rb_frag, 1)
        _risk_budget_label = "Critical" if _risk_budget_used >= 130 else \
                             "Elevated" if _risk_budget_used >= 100 else \
                             "Moderate" if _risk_budget_used >= 70  else "Comfortable"

        # ── Next 7 Days Watchlist (dynamic rules) ─────────────────────────────
        _watchlist: List[dict] = []

        # Rule: premium > 5% → mean reversion watch
        # Only meaningful for fund types where price can structurally diverge from
        # NAV: CEF and OPTION_INCOME.  For GROWTH/DIVIDEND ETFs, price ≈ NAV by
        # the creation/redemption mechanism — premium is always ~0% and the rule
        # would produce nonsense alerts.
        for _wl_dec in decisions:
            _wl_sym  = _wl_dec.get("symbol", "")
            _wl_snap = snapshots.get(_wl_sym, {})
            _wl_prem = _wl_snap.get("premium")
            _wl_beta = _wl_snap.get("beta")
            _wl_fv   = (fund_valuation or {}).get(_wl_sym, "")
            _wl_ft   = fund_configs.get(_wl_sym, {}).get("FUND_TYPE", "")
            # Mean-reversion-to-NAV alert: CEF only.
            # OPTION_INCOME ETFs are open-ended — premium is not a structural
            # signal; it just reflects stale NAV data and should be ignored here.
            if _wl_ft == "CEF" and _wl_prem is not None and _wl_prem > 0.05:
                _watchlist.append({"sym": _wl_sym, "priority": "high",
                    "msg": f"{_wl_sym}: {_wl_prem*100:.1f}% premium — watch for mean-reversion to NAV"})
            if _wl_fv == "EXTENDED":
                _watchlist.append({"sym": _wl_sym, "priority": "high",
                    "msg": f"{_wl_sym}: EXTENDED valuation — avoid adding, watch for pullback"})
            if _wl_beta is not None and _wl_beta > 1.5 and weights.get(_wl_sym, 0) > 0.05:
                _watchlist.append({"sym": _wl_sym, "priority": "med",
                    "msg": f"{_wl_sym}: β={_wl_beta:.2f} high sensitivity — watch VIX for entry/exit signals"})

        # Rule: correlation cluster > 0.85 → regime shift watch
        if corr_risk == "HIGH":
            _watchlist.append({"sym": "CLUSTER", "priority": "high",
                "msg": f"Correlation cluster >{len(high_corr_pairs)} pairs — watch for regime-driven drawdown"})

        # Rule: portfolio beta > 1.3 → VIX sensitivity
        if weighted_beta >= 1.3:
            _watchlist.append({"sym": "VIX", "priority": "high",
                "msg": f"Portfolio β={weighted_beta:.2f} — if VIX crosses 20, expect amplified moves"})

        # Rule: concentration > 20%
        if top_pct >= 0.20:
            _watchlist.append({"sym": top_sym, "priority": "med",
                "msg": f"{top_sym}: {round(top_pct*100,1)}% concentration — monitor relative strength vs benchmark"})

        # Deduplicate by sym+msg prefix, sort by priority, cap at 6
        _seen_wl = set()
        _wl_deduped: List[dict] = []
        for _wli in sorted(_watchlist, key=lambda x: ["high","med","low"].index(x["priority"])):
            _key = _wli["sym"]
            if _key not in _seen_wl:
                _seen_wl.add(_key)
                _wl_deduped.append(_wli)
        _watchlist = _wl_deduped[:6]

        portfolio_intel = {
            "weights":            {sym: round(w * 100, 1) for sym, w in weights.items()},
            "top_holding":        top_sym,
            "top_holding_pct":    round(top_pct * 100, 1),
            "concentration_level": conc_level,
            "high_corr_pairs":       high_corr_pairs[:6],
            "high_corr_pairs_count": len(high_corr_pairs),   # full count for UI consistency
            "corr_risk":             corr_risk,
            "tech_growth_pct":    tech_growth_pct,
            "income_pct":         income_pct,
            "defensive_pct":      defensive_pct,
            "weighted_beta":      round(weighted_beta, 2),
            "stress_qqq_pct":     stress_pct,
            "stress_qqq_dollar":  stress_dollar,
            "market_regime":      market_regime,
            "vol_regime":         vol_regime,
            "trend_signal":       trend_signal,
            "vix_current":        vix_cur,
            "vix_90d_avg":        vix_90d_avg or 0.0,
            "inc_stability_lbl":  inc_stability_lbl,
            "inc_stability_pct":  inc_stability_pct,
            "taxable_inc_pct":    taxable_inc_pct,
            "tax_free_inc_pct":   tax_free_inc_pct,
            "fund_valuation":            fund_valuation,
            "fragility_score":           fragility_score,
            "fragility_level":           fragility_level,
            "stress_top_sym":            _stress_top_sym,
            "stress_top_pct":            stress_top_pct,
            "stress_top_dollar":         stress_top_dollar,
            "stress_top2_sym":           _stress_top2_sym,
            "stress_top2_pct":           stress_top2_pct,
            "stress_top2_dollar":        stress_top2_dollar,
            "stress_vix_pct":            stress_vix_pct,
            "stress_vix_dollar":         stress_vix_dollar,
            "top_return_1y_pct":         top_return_1y_pct,
            "top_return_contrib_pct":    top_return_contrib_pct,
            "top_drawdown_contrib_pct":  top_drawdown_contrib_pct,
            "positioning":               positioning,
            "income_vix_spike_drop_pct":  income_vix_spike_drop_pct,
            "income_durability_score":    income_durability_score,
            "taxable_target_vs_actual":   taxable_target_vs_actual,
            "roth_target_vs_actual":      roth_target_vs_actual,
            "rollover_concentration":     rollover_concentration,
            # ── New fields ──────────────────────────────────────────────────
            "system_confidence_score":  _scs,
            "system_confidence_label":  _scs_label,
            "portfolio_vol_pct":        _portfolio_vol_pct,
            "target_vol_pct":           _target_vol_pct,
            "vol_budget_used":          _vol_budget_used,
            "combined_stress_pct":      _comb_pct,
            "combined_stress_dollar":   _comb_dollar,
            "top_risks":                _top_risks,
            "top_opportunities":        _top_opps,
            "confidence_delta":         _conf_delta,
            "confidence_trend_label":   _conf_trend_lbl,
            "risk_budget_used":         _risk_budget_used,
            "risk_budget_label":        _risk_budget_label,
            "risk_budget_vol":          _rb_vol,
            "risk_budget_frag":         _rb_frag,
            "watchlist":                _watchlist,
        }
    except Exception as _e:
        if _VERBOSE:
            print(f"[portfolio_intel] {_e}")
        import traceback; traceback.print_exc()

    # ── Cross-Sleeve Correlation Map ──────────────────────────────────────────
    # 60-trading-day correlation barely moves session to session, and on a
    # non-trading day there is no new session to move it at all — yet this used
    # to re-hit yfinance on every single refresh (startup, every 5-min cycle
    # during market hours) regardless. Cache once per calendar day; only
    # recompute live when today is a genuine trading day (same noon-ET-anchored
    # check as the EOD bootstrap above) or when no cache exists yet at all.
    try:
        _corr_cache_key = "portfolio:correlation_map"
        _corr_cached = _dbm.cache_get_ts(_corr_cache_key)
        if _is_trading_day_today or _corr_cached is None:
            portfolio_intel["correlation_map"] = _compute_correlation_map(accounts, fund_configs)
            _dbm.cache_set(_corr_cache_key, portfolio_intel["correlation_map"])
        else:
            portfolio_intel["correlation_map"] = _corr_cached[0]
    except Exception as _cme:
        if _VERBOSE:
            print(f"[correlation_map] {_cme}")
        portfolio_intel["correlation_map"] = {"error": str(_cme)}

    # Roth conversion timing
    roth_conversions = []
    rollover = portfolio.get("rollover_ira", {})
    if rollover:
        for sym, pos in sorted(rollover.get("positions", {}).items()):
            if sym not in snapshots:
                continue
            snap = snapshots[sym]
            premium = snap.get("premium")
            ft_rc   = fund_configs.get(sym, {}).get("FUND_TYPE", "")
            # NAV spread is a signal only for CEFs (structural price/NAV divergence).
            # OPTION_INCOME and all other ETF types use creation/redemption —
            # any apparent premium/discount reflects stale fallback NAV, not reality.
            nav_meaningful = ft_rc == "CEF"
            if not nav_meaningful:
                # All ETFs: conversion timing is tax-calendar-driven, not NAV-driven.
                recommendation = "Conversion timing: tax-driven"
                status = "blue"
            elif premium is not None and premium < -0.005:
                recommendation = "FAVORABLE — convert at discount"
                status = "green"
            elif premium is not None and premium > 0.03:
                recommendation = "AVOID — paying premium"
                status = "red"
            elif premium is not None:
                recommendation = "Neutral — near NAV"
                status = "yellow"
            else:
                recommendation = "NAV unavailable"
                status = "gray"
            roth_conversions.append({
                "symbol": sym,
                "shares": pos["shares"],
                "price": snap.get("price", 0),
                "nav": snap.get("nav"),
                "premium": premium,
                "recommendation": recommendation,
                "status": status,
            })

    # Roth IRA target allocation analysis
    roth_target_analysis = []
    target_alloc_cfg = cfg.get("_TARGET_ALLOC", {})
    annual_conversion = target_alloc_cfg.get("annual_conversion", 100000)
    roth_targets = roth_targets_file  # loaded from target_roth.json
    target_roth_total = 0.0
    conversion_sources: dict = {}
    if roth_targets:
        roth_acct = next((a for a in accounts if a["key"] == "roth_ira"), None)
        roth_total = roth_acct["value"] if roth_acct else 0.0
        roth_pos_map = {p["symbol"]: p for p in (roth_acct["positions"] if roth_acct else [])}

        # Conversion sources: use real Schwab rollover balance if available,
        # otherwise fall back to config.  401K accounts excluded — only
        # in-broker Rollover IRA balance is relevant here.
        rollover_live = next((a for a in accounts if a["key"] == "rollover_ira"), None)
        rollover_balance_real = rollover_live["value"] if rollover_live else 0.0
        cfg_sources = target_alloc_cfg.get("conversion_sources", {})
        if rollover_balance_real > 0:
            conversion_sources = {"rollover_ira": round(rollover_balance_real, 0)}
        elif "rollover_ira" in cfg_sources:
            conversion_sources = {"rollover_ira": cfg_sources["rollover_ira"]}
        else:
            conversion_sources = {}
        target_roth_total = roth_total + sum(conversion_sources.values())

        # current_weight, gap_pct, and dollar_gap all use roth_total (what you own today).
        # target_roth_total (roth + rollover) is used only for conv_dollars — it answers
        # "how much of this year's conversion to allocate per symbol," which is a separate
        # forward-looking calculation.  Using target_roth_total as the weight denominator
        # inflates the apparent target dollar amounts and makes every position look ~50%
        # underweight because the rollover balance hasn't arrived in the Roth yet.
        gaps = {sym: wt - (roth_pos_map.get(sym, {}).get("market_value", 0.0) / roth_total if roth_total > 0 else 0.0)
                for sym, wt in roth_targets.items()}
        total_underweight = sum(g for g in gaps.values() if g > 0)

        for sym in sorted(roth_targets):
            target_wt = roth_targets[sym]
            current_val = roth_pos_map.get(sym, {}).get("market_value", 0.0)
            current_wt = current_val / roth_total if roth_total > 0 else 0.0  # % of current Roth
            gap_pct = gaps[sym]          # target % − current %  (positive = underweight = BUY)
            dollar_gap = gap_pct * roth_total  # rebalance gap in today's Roth dollars
            snap_data = snapshots.get(sym, {})
            price = snap_data.get("price") or 0.0
            day_low = snap_data.get("day_low") or 0.0
            shares_needed = dollar_gap / price if price > 0 and dollar_gap > 0 else 0.0
            conv_dollars = (gap_pct / total_underweight) * annual_conversion if gap_pct > 0 and total_underweight > 0 else 0.0
            conv_shares = conv_dollars / price if price > 0 and conv_dollars > 0 else 0.0
            # Volatility-aware buy price points (based on intraday low)
            buy_normal   = round(day_low * 1.0025, 2) if day_low > 0 else None
            buy_high_vol = round(day_low * 1.0050, 2) if day_low > 0 else None
            buy_extreme  = round(day_low * 1.0075, 2) if day_low > 0 else None
            roth_target_analysis.append({
                "symbol": sym,
                "target_weight": target_wt,
                "current_weight": current_wt,
                "gap_pct": gap_pct,
                "current_value": current_val,
                "dollar_gap": dollar_gap,
                "price": price,
                "day_low": day_low,
                "shares_needed": shares_needed,
                "conv_dollars": conv_dollars,
                "conv_shares": conv_shares,
                "buy_normal": buy_normal,
                "buy_high_vol": buy_high_vol,
                "buy_extreme": buy_extreme,
            })

    # ── Taxable account target allocation + capital efficiency ─────────────────
    # Covers ALL taxable holdings — target symbols AND any non-target symbols
    # currently held (implicit 0% target → full SELL).
    taxable_target_analysis = []
    _tax_acct = next((a for a in accounts if a["key"] == "taxable"), None)
    _tax_total = _tax_acct["value"] if _tax_acct else 0.0
    _tax_pos_map = {p["symbol"]: p for p in (_tax_acct["positions"] if _tax_acct else [])}

    # Union of target symbols + actually-held symbols (non-MMF only)
    _all_taxable_syms = sorted(set(list(taxable_targets_file.keys())) | {
        p["symbol"] for p in (_tax_acct["positions"] if _tax_acct else [])
        if not p.get("is_money_market")
    })

    if taxable_targets_file and _tax_total > 0:
        for _tsym in _all_taxable_syms:
                _target_wt  = taxable_targets_file.get(_tsym, 0.0)  # 0% for non-target = full sell
                _cur_val    = _tax_pos_map.get(_tsym, {}).get("market_value", 0.0)
                _cur_wt     = _cur_val / _tax_total
                _gap_pct    = _target_wt - _cur_wt      # positive = underweight (buy)
                _dollar_gap = _gap_pct * _tax_total
                _snp        = snapshots.get(_tsym, {})
                _price      = _snp.get("price") or 0.0
                _day_low    = _snp.get("day_low") or 0.0
                # Capital efficiency
                _income_per_dollar  = round((_snp.get("ttm_yield") or 0.0) * 100, 2)   # yield %
                _return_1y_pct      = round((_snp.get("total_return_1y") or 0.0) * 100, 1)
                # Tax cost per $ sold (overweight only): unrealised gain × assumed 15% LT rate
                _pos_data    = _tax_pos_map.get(_tsym, {})
                _cost_basis  = _pos_data.get("cost_basis", 0.0)
                _gain_ratio  = (_cur_val - _cost_basis) / _cur_val if _cur_val > 0 else 0.0
                _tax_cost    = round(max(0.0, _gain_ratio) * 0.15 * 100, 1) if _gap_pct < -0.001 else 0.0
                # Buy price tiers (same as Roth)
                _buy_normal   = round(_day_low * 1.0025, 2) if _day_low > 0 else None
                _buy_high_vol = round(_day_low * 1.0050, 2) if _day_low > 0 else None
                _buy_extreme  = round(_day_low * 1.0075, 2) if _day_low > 0 else None
                # Capital Efficiency = IncomePerDollar / (1 + TaxDrag)
                # High efficiency = high yield relative to tax cost of owning
                _cap_eff = round(
                    (_income_per_dollar / 100.0) / (1.0 + _tax_cost / 100.0) * 100, 2
                ) if _income_per_dollar > 0 else 0.0

                taxable_target_analysis.append({
                    "symbol":              _tsym,
                    "target_weight":       _target_wt,
                    "current_weight":      _cur_wt,
                    "gap_pct":             _gap_pct,
                    "dollar_gap":          _dollar_gap,
                    "price":               _price,
                    "day_low":             _day_low,
                    "shares_needed":       round(abs(_dollar_gap) / _price, 2) if _price > 0 else 0.0,
                    "buy_normal":          _buy_normal,
                    "buy_high_vol":        _buy_high_vol,
                    "buy_extreme":         _buy_extreme,
                    "income_per_dollar":   _income_per_dollar,
                    "return_1y_pct":       _return_1y_pct,
                    "tax_cost_sell_pct":   _tax_cost,
                    "capital_efficiency":  _cap_eff,
                })

    # ── Tax planning ──────────────────────────────────────────────────────────
    tax_data = {}
    _si      = {"available": False}   # spending intelligence — set inside if block below
    personal_cfg   = cfg.get("_PERSONAL", {})
    tax_bkts_cfg   = cfg.get("_TAX_BRACKETS", {})

    if personal_cfg and tax_bkts_cfg:
        personal_name = personal_cfg.get("name", "")
        filing        = personal_cfg.get("filing_status", "MFJ")
        dob_str       = personal_cfg.get("dob", "")
        ss_start_age  = personal_cfg.get("ss_start_age", 70)
        retirement_year = int(personal_cfg.get("retirement_year", 0) or 0)
        ss_options    = personal_cfg.get("social_security", {})

        # Spending intelligence — computed early so tax metrics can use it
        _si = _compute_spending_intelligence(personal_cfg)

        # ── W2 salary — real earned income that occupies the lowest tax brackets ──
        # first, before dividends/STCG/conversions stack on top of it. Same source
        # as the Income Summary ledger's W2 row (_build_income_summary below);
        # computed here too so the bracket engine (gross_no_ss, marginal_rate,
        # marginal_rate_actual) isn't silently missing a real income source that's
        # already displayed elsewhere on the Tax tab.
        # NOTE: uses datetime.now(), not the module-level `_date` alias — this
        # function later does local `from datetime import date as _date` (see
        # below), which makes `_date` a function-local name for the ENTIRE
        # function body and shadows the global import, raising UnboundLocalError
        # if referenced before that local import line runs.
        _curr_yr_w2    = str(datetime.now().year)
        _actual_w2_ytd = round(sum(
            float(row.get("w2", 0) or 0)
            for row in (_si or {}).get("monthly_income_totals", [])
            if (row.get("month") or "").startswith(_curr_yr_w2)
        ))
        _annual_w2 = float((_si or {}).get("w2_annual", 0) or 0)
        if _annual_w2 <= 0:
            _annual_w2 = _actual_w2_ytd

        # Spouse
        spouse_cfg      = personal_cfg.get("spouse", {})
        spouse_name     = spouse_cfg.get("name", "")
        spouse_dob_str  = spouse_cfg.get("dob", "")
        spouse_ss_start = int(spouse_cfg.get("ss_start_age", 70))

        # Current age (primary)
        current_age = None
        dob_year = None
        try:
            from datetime import date as _date
            dob_parts  = dob_str.split("-")
            dob_year   = int(dob_parts[0])
            today_d    = _date.today()
            dob_d      = _date(int(dob_parts[0]), int(dob_parts[1]), int(dob_parts[2]))
            current_age = (today_d - dob_d).days / 365.25
        except Exception:
            pass

        # Current age (spouse)
        spouse_age = None
        try:
            from datetime import date as _date
            sp = spouse_dob_str.split("-")
            sp_d = _date(int(sp[0]), int(sp[1]), int(sp[2]))
            spouse_age = (_date.today() - sp_d).days / 365.25
        except Exception:
            pass

        bracket_key  = "brackets_mfj"    if filing == "MFJ" else "brackets_single"
        std_ded_key  = "standard_deduction_mfj" if filing == "MFJ" else "standard_deduction_single"
        brackets     = tax_bkts_cfg.get(bracket_key, [])
        std_deduction = float(tax_bkts_cfg.get(std_ded_key, 30000))
        # Add age-65 bonus: IRS additional deduction + temporary senior deduction (2025–2028)
        try:
            from datetime import date as _d_tx
            _q_tx  = sum(1 for a in (current_age, spouse_age) if a is not None and a >= 65)
            _yr_tx = _d_tx.today().year
            std_deduction += float(tax_bkts_cfg.get("age_65_additional_deduction_per_person", 1650)) * _q_tx
            if _yr_tx <= int(tax_bkts_cfg.get("senior_deduction_expires_year", 2028)):
                std_deduction += float(tax_bkts_cfg.get("senior_deduction_per_person", 6000)) * _q_tx
        except Exception:
            pass

        # ── Dividend calendar computed dynamically from live portfolio data ──
        # Generate the next 12 calendar months starting from today's month.
        from datetime import date as _dyn_date
        _today_dyn = _dyn_date.today()
        cal_months = []
        month_nums_window = []   # month numbers 1–12 for each of the 12 slots
        month_years_window = []  # calendar year for each of the 12 slots
        for _i in range(12):
            _total = (_today_dyn.month - 1) + _i
            _y = _today_dyn.year + _total // 12
            _m = _total % 12 + 1
            cal_months.append(f"{_dyn_date(_y, _m, 1).strftime('%b')}-{str(_y)[2:]}")
            month_nums_window.append(_m)
            month_years_window.append(_y)

        # Payments-per-year map by distribution frequency
        _FREQ_PY = {"MONTHLY": 12, "QUARTERLY": 4, "SEMI_ANNUAL": 2, "ANNUAL": 1}
        # Standard fallback month sets for each frequency (when no history available)
        _FREQ_MONTHS = {
            "MONTHLY":     set(range(1, 13)),
            "QUARTERLY":   {3, 6, 9, 12},
            "SEMI_ANNUAL": {6, 12},
            "ANNUAL":      {12},
        }

        taxable_cal: dict = {}
        annual_div_by_ticker: dict = {}
        monthly_totals: list = [0.0] * 12
        _div_tax_detail: dict = {}

        def _pay_months_for(snap: dict, freq: str, ppy: int) -> set:
            """Return the set of 1-based month numbers when this position pays.

            Priority order:
              1. Derive from Schwab's next_div_pay_month (authoritative pay date,
                 not ex-date) — e.g. ADX ex-date Apr but pays May.
              2. Fall back to yfinance dividend_months (ex-dates; acceptable for
                 monthly payers where every month pays anyway).
              3. Standard frequency pattern.
            """
            next_pay_mo = snap.get("next_div_pay_month")
            if next_pay_mo and freq != "MONTHLY":
                # Derive full schedule from next payment date + frequency
                gap = max(1, 12 // ppy)
                months: set = set()
                m = next_pay_mo
                for _ in range(ppy):
                    months.add(m)
                    m = (m - 1 + gap) % 12 + 1
                return months
            hist = set(snap.get("dividend_months", []))
            if hist:
                return hist
            return _FREQ_MONTHS.get(freq, set(range(1, 13)))

        # Use live taxable positions (may be Schwab-sourced)
        _taxable_pos = portfolio.get("taxable", {}).get("positions", {})
        for _sym, _pos in sorted(_taxable_pos.items()):
            if _sym not in snapshots:
                continue
            _snap_s  = snapshots[_sym]
            # Raw uninvested cash earns nothing — exclude. SWVXX/MMF funds do pay interest, keep them.
            if _pos.get("asset_type") == "CASH" or _sym == "CASH":
                continue
            _shares  = _pos["shares"]
            _price   = _snap_s.get("price") or 0.0
            # Prefer Schwab annual div $ per share — avoids yield reconstruction error
            _ann_div_ps = _snap_s.get("annual_div_amount")
            if _ann_div_ps and _ann_div_ps > 0:
                _annual = _shares * _ann_div_ps
            else:
                _ttm_y  = _snap_s.get("ttm_yield") or 0.0
                _annual = _shares * (_price or 0.0) * _ttm_y
            if _annual <= 0:
                continue

            # Tax character — MMF interest is fully ordinary; others from fund_configs
            _fc      = fund_configs.get(_sym, {})
            _ft_key  = _fc.get("FUND_TYPE", "")
            if _snap_s.get("is_money_market"):
                _tc_cfg = {"ordinary": 1.0, "qualified": 0.0, "roc": 0.0}
            else:
                _tc_cfg = _fc.get("TAX_CHARACTER", {})
                if not _tc_cfg:
                    _tc_cfg = _TAX_CHAR_DEFAULTS.get(_ft_key, {"ordinary": 0.50, "qualified": 0.40, "roc": 0.10})
            _ord_pct  = float(_tc_cfg.get("ordinary",  0.0))
            _qual_pct = float(_tc_cfg.get("qualified", 0.0))
            _roc_pct  = float(_tc_cfg.get("roc",       0.0))
            # Normalise so they sum to 1
            _tc_sum = _ord_pct + _qual_pct + _roc_pct
            if _tc_sum > 0:
                _ord_pct /= _tc_sum; _qual_pct /= _tc_sum; _roc_pct /= _tc_sum

            _freq    = _fc.get("DISTRIBUTION_FREQUENCY", "MONTHLY") if not _snap_s.get("is_money_market") else "MONTHLY"
            _ppy     = _FREQ_PY.get(_freq, 12)       # payments per year
            _per_pmt = _annual / _ppy                 # $ per individual payment

            # Determine which month slots in our window pay
            _hist_months = _pay_months_for(_snap_s, _freq, _ppy)
            _pay_idx = [_j for _j, _mn in enumerate(month_nums_window) if _mn in _hist_months]

            if not _pay_idx:
                # Last-resort: treat as monthly
                _pay_idx = list(range(12))

            _monthly = [0.0] * 12
            for _j in _pay_idx:
                _monthly[_j] = round(_per_pmt, 2)

            taxable_cal[_sym] = _monthly
            annual_div_by_ticker[_sym] = round(sum(_monthly), 2)
            for _j, _v in enumerate(_monthly):
                monthly_totals[_j] += _v

            # Store per-ETF tax character details
            # Quality score: penalise ordinary income, reward qualified, neutral on ROC
            _quality_score = round(1.0 * _roc_pct * 100 + 0.7 * _qual_pct * 100 + 0.0 * _ord_pct * 100, 1)
            _div_tax_detail[_sym] = {
                "annual_total":   round(_annual, 2),
                "ordinary_pct":   round(_ord_pct * 100, 1),
                "qualified_pct":  round(_qual_pct * 100, 1),
                "roc_pct":        round(_roc_pct * 100, 1),
                "ordinary_amt":   round(_annual * _ord_pct, 2),
                "qualified_amt":  round(_annual * _qual_pct, 2),
                "roc_amt":        round(_annual * _roc_pct, 2),
                "quality_score":  _quality_score,
            }

        annual_div_total = sum(annual_div_by_ticker.values())

        # ── Per-account rolling-12-month payout calendars ─────────────────────
        # Taxable is already computed above; build Roth + Rollover using same logic.
        _payout_cal: dict = {
            "taxable": {
                "tickers": taxable_cal,
                "monthly_totals": [round(x, 2) for x in monthly_totals],
            }
        }
        for _cal_key in ("roth_ira", "rollover_ira"):
            _cal_pos = portfolio.get(_cal_key, {}).get("positions", {})
            if not _cal_pos:
                continue
            _cal_tickers: dict = {}
            _cal_totals = [0.0] * 12
            for _sym_c, _pos_c in sorted(_cal_pos.items()):
                if _sym_c not in snapshots:
                    continue
                _snap_c   = snapshots[_sym_c]
                # Raw uninvested cash earns nothing — exclude. SWVXX/MMF funds do pay interest, keep them.
                if _pos_c.get("asset_type") == "CASH" or _sym_c == "CASH":
                    continue
                _shares_c = _pos_c.get("shares", 0)
                _ann_ps_c = _snap_c.get("annual_div_amount")
                if _ann_ps_c and _ann_ps_c > 0:
                    _annual_c = _shares_c * _ann_ps_c
                else:
                    _annual_c = _shares_c * (_snap_c.get("price") or 0.0) * (_snap_c.get("ttm_yield") or 0.0)
                if _annual_c <= 0:
                    continue
                _fc_c   = fund_configs.get(_sym_c, {})
                _freq_c = "MONTHLY" if _snap_c.get("is_money_market") else _fc_c.get("DISTRIBUTION_FREQUENCY", "MONTHLY")
                _ppy_c  = _FREQ_PY.get(_freq_c, 12)
                _per_c  = _annual_c / _ppy_c
                _pay_months_c = _pay_months_for(_snap_c, _freq_c, _ppy_c)
                _pidx_c = [_j for _j, _mn in enumerate(month_nums_window) if _mn in _pay_months_c]
                if not _pidx_c:
                    _pidx_c = list(range(12))
                _mo_c = [0.0] * 12
                for _j in _pidx_c:
                    _mo_c[_j] = round(_per_c, 2)
                _cal_tickers[_sym_c] = _mo_c
                for _j, _v in enumerate(_mo_c):
                    _cal_totals[_j] += _v
            if _cal_tickers:
                _payout_cal[_cal_key] = {
                    "tickers": _cal_tickers,
                    "monthly_totals": [round(x, 2) for x in _cal_totals],
                }

        # Aggregate tax character across all taxable positions
        total_ordinary_div  = sum(v["ordinary_amt"]  for v in _div_tax_detail.values())
        total_qualified_div = sum(v["qualified_amt"] for v in _div_tax_detail.values())
        total_roc_div       = sum(v["roc_amt"]       for v in _div_tax_detail.values())
        # AGI-relevant dividends: exclude ROC (not currently taxable)
        annual_div_for_agi  = round(total_ordinary_div + total_qualified_div, 2)

        # Weighted average quality score — backfill income_analytics now that _div_tax_detail is ready
        if income_analytics:
            _qnum, _qden = 0.0, 0.0
            for _acct in accounts:
                if _acct["key"] != "taxable":
                    continue
                for _p in _acct["positions"]:
                    _dtd_q = _div_tax_detail.get(_p["symbol"], {})
                    _qs    = _dtd_q.get("quality_score")
                    _ai    = _p.get("annual_income", 0.0)
                    if _qs is not None and _ai > 0:
                        _qnum += _qs * _ai
                        _qden += _ai
            income_analytics["avg_quality_score"] = round(_qnum / _qden, 1) if _qden > 0 else None

        # ── Signal strength + forward tax impact + stress test + attribution ──
        if income_analytics:
            _ia_by_acct = income_analytics.get("by_account", {})

            # Build symbol→account volatility map for signal strength
            _sym_vol: Dict[str, float] = {}
            for _acct in accounts:
                _vol_a = _ia_by_acct.get(_acct["key"], {}).get("volatility_score")
                for _p in _acct["positions"]:
                    _sym_vol[_p["symbol"]] = _vol_a if _vol_a is not None else 0.0

            # Signal strength per position + forward tax breakdown
            _fwd_ord_total = 0.0
            _fwd_qual_total = 0.0
            _fwd_roc_total = 0.0
            _attribution: Dict[str, float] = {}
            _p_fwd12m = income_analytics.get("portfolio_fwd_12m", 0.0) or 1.0

            for _acct in accounts:
                _vol_a = _ia_by_acct.get(_acct["key"], {}).get("volatility_score") or 0.0
                for _p in _acct["positions"]:
                    _sym   = _p["symbol"]
                    _stab  = _p.get("stability_score")
                    _dtd_s = _div_tax_detail.get(_sym, {})
                    _qs    = _dtd_s.get("quality_score")
                    _fwd   = _p.get("forward_annual_income") or _p.get("annual_income", 0.0)

                    # Signal strength 0-100
                    if _stab is not None and _qs is not None:
                        _sig = round(
                            0.4 * _stab +
                            0.3 * _qs +
                            0.3 * max(0.0, 100.0 - _vol_a),
                            1,
                        )
                    else:
                        _sig = None
                    _p["signal_strength"] = _sig

                    # Signal strength trend (day-over-day)
                    _yest_sig = _trends_cache.get("signal_strengths", {}).get(_sym)
                    if _sig is not None and _yest_sig is not None:
                        _sd = _sig - _yest_sig
                        if _sd > 2:
                            _p["signal_strength_trend"] = "↑ Rising"
                        elif _sd < -2:
                            _p["signal_strength_trend"] = "↓ Falling"
                        else:
                            _p["signal_strength_trend"] = "→ Stable"
                    else:
                        _p["signal_strength_trend"] = None

                    # Valuation trend (premium day-over-day) → stored on snapshot too
                    _cur_prem  = snapshots.get(_sym, {}).get("premium")
                    _yest_prem = _trends_cache.get("premiums", {}).get(_sym)
                    if _cur_prem is not None and _yest_prem is not None:
                        _pd = _cur_prem - _yest_prem
                        if _pd > 0.005:
                            _vt_lbl, _vt_clr = "↑ Rising premium", "red"
                        elif _pd < -0.005:
                            _vt_lbl, _vt_clr = "↓ Falling premium", "green"
                        else:
                            _vt_lbl, _vt_clr = "→ Stable", "muted"
                    else:
                        _vt_lbl, _vt_clr = None, None
                    _p["valuation_trend"] = _vt_lbl
                    if _sym in snapshots:
                        snapshots[_sym]["valuation_trend"]       = _vt_lbl
                        snapshots[_sym]["valuation_trend_color"] = _vt_clr

                    # Forward tax breakdown (taxable account only)
                    if _acct["key"] == "taxable" and _fwd > 0 and _p.get("shares", 0) > 0:
                        _o_pct = _dtd_s.get("ordinary_pct", 0.0) / 100.0
                        _q_pct = _dtd_s.get("qualified_pct", 0.0) / 100.0
                        _r_pct = _dtd_s.get("roc_pct", 0.0) / 100.0
                        _fwd_ord_total  += _fwd * _o_pct
                        _fwd_qual_total += _fwd * _q_pct
                        _fwd_roc_total  += _fwd * _r_pct

                    # Income attribution (all accounts)
                    if _fwd > 0:
                        _attribution[_sym] = _attribution.get(_sym, 0.0) + _fwd

            # Normalise attribution to portfolio total
            _attr_pct = {s: round(v / _p_fwd12m * 100, 2) for s, v in _attribution.items()}

            # Forward tax impact — rates from _TAX_RULE_ENGINE config
            _fwd_ltcg_rate = float(_tre_cfg.get("ltcg_rate", 0.15))
            _fwd_agi    = _fwd_ord_total + _fwd_qual_total  # ROC excluded from AGI
            _fwd_tax    = _target_rate_ia * _fwd_ord_total + _fwd_ltcg_rate * _fwd_qual_total
            income_analytics["forward_tax_impact"] = {
                "fwd_ordinary":   round(_fwd_ord_total, 2),
                "fwd_qualified":  round(_fwd_qual_total, 2),
                "fwd_roc":        round(_fwd_roc_total, 2),
                "fwd_agi_impact": round(_fwd_agi, 2),
                "fwd_tax_est":    round(_fwd_tax, 2),
            }

            # Income stress test: apply shocks to F12M
            _fwd_base = income_analytics.get("portfolio_fwd_12m", 0.0)
            _stress   = {}
            for _shock_pct, _lbl in [(0.10, "down_10"), (0.20, "down_20"), (0.30, "down_30")]:
                _new_fwd  = _fwd_base * (1.0 - _shock_pct)
                _new_ord  = _fwd_ord_total  * (1.0 - _shock_pct)
                _new_qual = _fwd_qual_total * (1.0 - _shock_pct)
                _new_tax  = _target_rate_ia * _new_ord + _fwd_ltcg_rate * _new_qual
                _new_proj = income_analytics.get("projected_eoy", 0.0) * (1.0 - _shock_pct)
                _new_gap  = max(0.0, _INCOME_CEILING - _new_proj)
                _stress[_lbl] = {
                    "shock_pct":    _shock_pct,
                    "fwd_12m":      round(_new_fwd, 2),
                    "agi_impact":   round(_new_ord + _new_qual, 2),
                    "tax_est":      round(_new_tax, 2),
                    "ceiling_gap":  round(_new_gap, 2),
                    "income_gap":   round(income_analytics.get("target_income", 0.0) - _new_fwd, 2),
                }
            income_analytics["stress_test"]       = _stress
            income_analytics["income_attribution"] = {
                "by_symbol":  _attr_pct,
                "top5":       sorted(_attr_pct.items(), key=lambda x: x[1], reverse=True)[:5],
            }
            income_analytics["payout_calendar"] = {
                "col_labels": cal_months,
                "accounts":   _payout_cal,
            }

        # ── Expected YTD income (Jan 1 → today) from Jan-Dec calendar ────────
        # Rebuild a full Jan–Dec monthly breakdown for each taxable symbol,
        # then sum months that have already completed (< today's month).
        _today_cal = _dyn_date.today()
        _jan_dec_by_sym: dict = {}  # sym -> list[float] indexed 0=Jan…11=Dec
        for _sym_e, _pos_e in sorted(_taxable_pos.items()):
            if _sym_e not in snapshots:
                continue
            _snap_e  = snapshots[_sym_e]
            # Raw uninvested cash earns nothing — exclude. SWVXX/MMF funds do pay interest, keep them.
            if _pos_e.get("asset_type") == "CASH" or _sym_e == "CASH":
                continue
            _fc_e    = fund_configs.get(_sym_e, {})
            _is_mmf_e = _snap_e.get("is_money_market", False)
            _freq_e  = "MONTHLY" if _is_mmf_e else _fc_e.get("DISTRIBUTION_FREQUENCY", "MONTHLY")
            _ppy_e   = _FREQ_PY.get(_freq_e, 12)
            _ann_ps_e = _snap_e.get("annual_div_amount")
            _shr_e   = _pos_e["shares"]
            if _ann_ps_e and _ann_ps_e > 0:
                _annual_e = _shr_e * _ann_ps_e
            else:
                _annual_e = _shr_e * (_snap_e.get("price") or 0.0) * (_snap_e.get("ttm_yield") or 0.0)
            if _annual_e <= 0:
                continue
            _per_pmt_e = _annual_e / _ppy_e
            _hist_months_e = _pay_months_for(_snap_e, _freq_e, _ppy_e)
            _pay_mi_e = [m - 1 for m in _hist_months_e if 1 <= m <= 12]
            _jan_dec_e = [0.0] * 12
            for _mi in _pay_mi_e:
                _jan_dec_e[_mi] = round(_per_pmt_e, 2)
            _jan_dec_by_sym[_sym_e] = _jan_dec_e

        # "Expected YTD" — pro-rated from the portfolio's projected annual income.
        # Uses grand_total_income (yield-based, already computed) × fraction of
        # year elapsed through today (day-accurate).  This matches what the user
        # actually receives because it covers the same period as the YTD received
        # figure (Jan 1 → today), not just completed months.
        _day_of_year  = _today_cal.timetuple().tm_yday
        _year_days    = 366 if (_today_cal.year % 4 == 0 and
                                (_today_cal.year % 100 != 0 or _today_cal.year % 400 == 0)) else 365
        _ytd_fraction = _day_of_year / _year_days

        # grand_total_income is available later; use the per-account forward totals
        # already summed in income_analytics to avoid a forward reference.
        _fwd_annual_total = income_analytics.get("by_account", {}).get("taxable", {}).get("fwd_12m", 0.0)

        # Fall back to schedule-model total if fwd_12m not populated yet
        _sched_total = 0.0
        for _jan_dec_e in _jan_dec_by_sym.values():
            _sched_total += sum(_jan_dec_e)

        _annual_basis = _fwd_annual_total if _fwd_annual_total > 0 else _sched_total

        # Per-symbol expected YTD: pro-rate each symbol's annual income
        expected_ytd_by_symbol: dict = {}
        for _sym_e, _jan_dec_e in _jan_dec_by_sym.items():
            _sym_annual = sum(_jan_dec_e)
            expected_ytd_by_symbol[_sym_e] = round(_sym_annual * _ytd_fraction, 2)

        expected_ytd_total = round(_annual_basis * _ytd_fraction, 2)

        # "Remaining this year" = projected income from today through Dec 31
        remaining_income_this_year = round(_annual_basis * (1.0 - _ytd_fraction), 2)

        annual_conv = target_alloc_cfg.get("annual_conversion", 100000)

        # ── Rollover IRA conversion plan ──────────────────────────────────────
        # Use real Schwab rollover positions; compute shares to convert for $annual_conv.
        _rollover_live = next((a for a in accounts if a["key"] == "rollover_ira"), None)
        rollover_balance = _rollover_live["value"] if _rollover_live else 0.0
        rollover_positions_live = _rollover_live["positions"] if _rollover_live else []

        def _build_conv_plan(pos_list, conv_target):
            """Build a rollover→Roth conversion plan for the given target dollar amount."""
            plan = []
            _rem = float(conv_target)
            for _rp in sorted(pos_list, key=lambda p: p["market_value"], reverse=True):
                if _rem <= 0:
                    break
                _price = _rp["current_price"] or 0.0
                _val   = _rp["market_value"]
                _cv    = round(min(_rem, _val), 0)
                _cs    = round(_cv / _price, 3) if _price > 0 else 0.0
                _pct   = round(_cv / _val * 100, 1) if _val > 0 else 0.0
                plan.append({
                    "symbol":          _rp["symbol"],
                    "current_shares":  _rp["shares"],
                    "current_value":   round(_val, 0),
                    "price":           _price,
                    "convert_dollars": _cv,
                    "convert_shares":  _cs,
                    "pct_of_position": _pct,
                    "remaining_after": round(_val - _cv, 0),
                })
                _rem -= _cv
            return plan

        # Configured amount plan (original)
        rollover_conv_plan = _build_conv_plan(rollover_positions_live, annual_conv)

        # ── Apply actual YTD conversions to adjust remaining plan ───────────────
        ytd_converted_total = conversion_history.get("total_converted_ytd", 0.0) if conversion_history else 0.0
        ytd_conversions = conversion_history.get("conversions", []) if conversion_history else []
        
        # Calculate remaining conversion target for the year
        remaining_conv_target = max(0.0, annual_conv - ytd_converted_total)
        
        # Adjust the conversion plan based on what's already been converted
        def _adjust_conv_plan_for_completed(plan, completed_conversions, target_annual_conv):
            """Adjust conversion plan by deducting completed conversions.

            Per-symbol clamping alone (max(0, planned_i - actual_i)) can overstate
            the total whenever a symbol's actual conversions exceeded THAT symbol's
            own planned slice — the negative "overage" is discarded instead of
            offsetting other symbols, so sum(adjusted) can end up larger than the
            correct remaining total. Rescale proportionally so the plan's total
            always reconciles exactly to `target_annual_conv - total_completed_value`
            (the same `remaining_conv_target` shown in the header), regardless of
            which symbols the actual conversions happened to hit.
            """
            if not completed_conversions:
                return plan, 0.0, 0.0

            # Group completed conversions by symbol
            completed_by_symbol = {}
            for conv in completed_conversions:
                sym = conv.get("symbol", "")
                if sym:
                    completed_by_symbol[sym] = completed_by_symbol.get(sym, 0.0) + conv.get("value", 0.0)

            adjusted_plan = []
            total_completed_value = sum(completed_by_symbol.values())
            total_completed_shares = sum(conv.get("shares", 0.0) for conv in completed_conversions)

            for item in plan:
                sym = item["symbol"]
                completed_value = completed_by_symbol.get(sym, 0.0)

                if completed_value > 0:
                    # Reduce the planned conversion by what's already done
                    remaining_value = max(0.0, item["convert_dollars"] - completed_value)
                    remaining_shares = round(remaining_value / item["price"], 3) if item["price"] > 0 else 0.0

                    adjusted_plan.append({
                        "symbol": item["symbol"],
                        "current_shares": item["current_shares"],
                        "current_value": item["current_value"],
                        "price": item["price"],
                        "convert_dollars": round(remaining_value, 0),
                        "convert_shares": remaining_shares,
                        "pct_of_position": round(remaining_value / item["current_value"] * 100, 1) if item["current_value"] > 0 else 0.0,
                        "remaining_after": round(item["current_value"] - remaining_value, 0),
                        "already_converted": round(completed_value, 0),  # Track what's done
                    })
                else:
                    adjusted_plan.append(item)

            target_total = max(0.0, target_annual_conv - total_completed_value)
            adjusted_total = sum(i["convert_dollars"] for i in adjusted_plan)
            if adjusted_total > 0 and abs(adjusted_total - target_total) > 1.0:
                scale = target_total / adjusted_total
                for i in adjusted_plan:
                    i["convert_dollars"]  = round(i["convert_dollars"] * scale, 0)
                    i["convert_shares"]   = round(i["convert_dollars"] / i["price"], 3) if i["price"] > 0 else 0.0
                    i["pct_of_position"]  = round(i["convert_dollars"] / i["current_value"] * 100, 1) if i["current_value"] > 0 else 0.0
                    i["remaining_after"]  = round(i["current_value"] - i["convert_dollars"], 0)

            return adjusted_plan, total_completed_value, total_completed_shares
        
        rollover_conv_plan_adjusted, ytd_converted_value, ytd_converted_shares = _adjust_conv_plan_for_completed(
            rollover_conv_plan, ytd_conversions, annual_conv
        )

        # Dynamic amount plan — will be updated below after dynamic_conv_recommended is computed
        # (placeholder; will be replaced after dynamic calc)
        rollover_conv_plan_dynamic = []  # populated after dynamic_conv_recommended is set

        # SS chosen option
        ss_chosen_key = f"age_{ss_start_age}"
        ss_chosen     = ss_options.get(ss_chosen_key, {})
        ss_annual     = ss_chosen.get("annual", 0)
        ss_start_date = ss_chosen.get("date", "")

        # Years / months until SS from today
        # ss_start_date may be "YYYY-MM-DD" or "YYYY-MM" — normalise to first of month
        _ss_years_until: float | None = None
        _ss_months_until: int | None = None
        if ss_start_date:
            try:
                _parts = ss_start_date.replace("-", "/").split("/")
                _ss_yr_n = int(_parts[0])
                _ss_mo_n = int(_parts[1]) if len(_parts) > 1 else 1
                _ss_dy_n = int(_parts[2]) if len(_parts) > 2 else 1
                _ss_d = _date(_ss_yr_n, _ss_mo_n, _ss_dy_n)
                _delta = (_ss_d - today_d).days
                _ss_years_until  = round(_delta / 365.25, 1)
                _ss_months_until = max(0, round(_delta / 30.44))
            except Exception:
                pass

        def _calc_tax(taxable_inc, bkts):
            tax = 0.0
            rem = taxable_inc
            for b in bkts:
                if rem <= 0:
                    break
                b_max = b["max"] if b["max"] is not None else 1e12
                in_b  = min(rem, b_max - b["min"])
                tax  += in_b * b["rate"]
                rem  -= in_b
            return tax

        def _bracket_breakdown(taxable_inc, bkts):
            result = []
            rem = taxable_inc
            for b in bkts:
                b_max = b["max"] if b["max"] is not None else None
                b_max_f = b_max if b_max is not None else 1e12
                if rem > 0:
                    in_b = min(rem, b_max_f - b["min"])
                    rem -= in_b
                else:
                    in_b = 0.0
                result.append({
                    "rate": b["rate"],
                    "min": b["min"],
                    "max": b_max,
                    "amount_in_bracket": round(in_b, 2),
                    "tax_in_bracket": round(in_b * b["rate"], 2),
                })
            return result

        # Qualified dividend rate — filing-status-aware (applied to qualified_div portion)
        _qdiv_ltcg_key  = "ltcg_brackets_mfj" if _filing == "MFJ" else "ltcg_brackets_single"
        _qdiv_ltcg_list = _tre_cfg.get(_qdiv_ltcg_key, [])
        _qdiv_0pct_max  = next((b["max"] for b in _qdiv_ltcg_list if abs(b["rate"]) < 0.001 and b["max"] is not None), 94_050)
        _qdiv_15pct_max = next((b["max"] for b in _qdiv_ltcg_list if abs(b["rate"] - 0.15) < 0.001 and b["max"] is not None), 583_750)
        _qdiv_test = max(0.0, _annual_w2 + annual_div_for_agi + annual_conv - std_deduction)
        if _qdiv_test <= _qdiv_0pct_max:
            qualified_div_rate = 0.0
        elif _qdiv_test <= _qdiv_15pct_max:
            qualified_div_rate = 0.15
        else:
            qualified_div_rate = 0.20

        # Pre-compute YTD realized gains — needed before tax block so STCG enters AGI
        _realized_gains_available = bool(realized_gains_history)
        # Use net_stcg/net_ltcg (gains + losses netted) so realized losses reduce the tax
        # estimate. Falls back to gross total_stcg/total_ltcg for older cache entries that
        # pre-date the net_stcg field.
        _ytd_stcg_realized  = float(realized_gains_history.get("net_stcg",
                              realized_gains_history.get("total_stcg", 0.0))) if _realized_gains_available else 0.0
        _ytd_ltcg_realized  = float(realized_gains_history.get("net_ltcg",
                              realized_gains_history.get("total_ltcg", 0.0))) if _realized_gains_available else 0.0
        # Gross (positive-only) figures kept for display attribution
        _ytd_stcg_gross     = float(realized_gains_history.get("total_stcg", 0.0)) if _realized_gains_available else 0.0
        _ytd_stcg_loss_amt  = float(realized_gains_history.get("total_stcg_loss", 0.0)) if _realized_gains_available else 0.0
        _ytd_net_gain       = float(realized_gains_history.get("net_gain",   0.0)) if _realized_gains_available else 0.0
        _realized_by_symbol = realized_gains_history.get("by_symbol", {})     if _realized_gains_available else {}

        # Scenario A: No SS (current / near-term)
        # gross_no_ss = W2 + divs + conversions + STCG (all ordinary income sources —
        # W2 wages are included because they occupy the lowest brackets first and
        # push everything stacked on top of them into a higher marginal rate).
        # Uses max(ytd, plan) so tax projections reflect the full planned conversion.
        _actual_conv_total = max(ytd_converted_total, annual_conv) if ytd_converted_total > 0 else annual_conv
        gross_no_ss      = _annual_w2 + annual_div_for_agi + _actual_conv_total + _ytd_stcg_realized
        taxable_no_ss    = max(0.0, gross_no_ss - std_deduction)

        # ── Actual-based income (display metrics only) ────────────────────────
        # Uses ONLY ytd_converted_total (what has actually been executed), NOT the plan
        # target. This prevents unexecuted conversions from inflating bracket-fullness
        # percentages and room calculations shown in the Tax Planning / Roth Conversion UI.
        # Do NOT use this for tax calculations — those need gross_no_ss (with plan target).
        _gross_actual   = _annual_w2 + annual_div_for_agi + ytd_converted_total + _ytd_stcg_realized
        _taxable_actual = max(0.0, _gross_actual - std_deduction)
        # Qualified dividends taxed at preferential rate; ordinary at bracket rates
        _ord_taxable_a   = max(0.0, taxable_no_ss - total_qualified_div)
        _qual_taxable_a  = min(total_qualified_div, taxable_no_ss)
        tax_no_ss        = _calc_tax(_ord_taxable_a, brackets) + _qual_taxable_a * qualified_div_rate
        eff_no_ss        = tax_no_ss / gross_no_ss if gross_no_ss > 0 else 0.0
        breakdown_no_ss  = _bracket_breakdown(_ord_taxable_a, brackets)
        # ROC received but not in AGI — track for reference
        _roc_display     = round(total_roc_div, 0)

        # Tax attribution: four-layer breakdown (W2 → +divs → +STCG → +conversion)
        # Layer -1: W2 wages only — the baseline everything else stacks on top of.
        # Not shown as its own attribution tile, but required so tax_div_only below
        # is the INCREMENTAL tax caused by dividends given real wages already fill
        # the lower brackets, not the tax dividends would owe if they were the only
        # income in the household (which understates their true marginal impact).
        _taxable_w2_only  = max(0.0, _annual_w2 - std_deduction)
        tax_w2_only       = _calc_tax(_taxable_w2_only, brackets)
        # Layer 0: W2 + dividends
        _gross_div_only   = _annual_w2 + annual_div_for_agi
        _taxable_div_only = max(0.0, _gross_div_only - std_deduction)
        _ord_div_only     = max(0.0, _taxable_div_only - total_qualified_div)
        _qual_div_only    = min(total_qualified_div, _taxable_div_only)
        _tax_w2_div       = _calc_tax(_ord_div_only, brackets) + _qual_div_only * qualified_div_rate
        tax_div_only      = round(_tax_w2_div - tax_w2_only, 0)        # marginal tax from dividends alone
        # Layer 1: W2 + divs + STCG (no conversion) — isolates STCG's marginal bracket impact
        _gross_div_stcg   = _annual_w2 + annual_div_for_agi + _ytd_stcg_realized
        _taxable_div_stcg = max(0.0, _gross_div_stcg - std_deduction)
        _ord_div_stcg     = max(0.0, _taxable_div_stcg - total_qualified_div)
        _qual_div_stcg    = min(total_qualified_div, _taxable_div_stcg)
        tax_with_stcg     = _calc_tax(_ord_div_stcg, brackets) + _qual_div_stcg * qualified_div_rate
        tax_stcg_add      = round(tax_with_stcg - _tax_w2_div, 0)      # marginal tax from STCG alone
        # Layer 2: +conversion on top of W2+divs+STCG
        _conv_for_tax_attribution = ytd_converted_total if ytd_converted_total > 0 else annual_conv
        tax_conv_add      = round(tax_no_ss - tax_with_stcg, 0)        # marginal tax from planned conversion

        # Actual conversion tax — based on YTD actual amount (not planned annual target).
        # Used for quarterly display so Q1 card shows tax on $116k actually converted,
        # not $400k planned. Falls back to tax_conv_add when no actual conversion done.
        if ytd_converted_total > 0:
            _ytd_conv_gross     = _annual_w2 + annual_div_for_agi + ytd_converted_total + _ytd_stcg_realized
            _ytd_conv_taxable   = max(0.0, _ytd_conv_gross - std_deduction)
            _ytd_conv_ord       = max(0.0, _ytd_conv_taxable - total_qualified_div)
            _ytd_conv_qual      = min(total_qualified_div, _ytd_conv_taxable)
            _tax_with_ytd_conv  = _calc_tax(_ytd_conv_ord, brackets) + _ytd_conv_qual * qualified_div_rate
            tax_conv_actual     = round(_tax_with_ytd_conv - tax_with_stcg, 0)
        else:
            tax_conv_actual = tax_conv_add

        # Marginal rate & headroom (no SS) — plan-based, used for annual projection & headroom
        marginal_rate = None
        headroom      = 0.0
        for b in breakdown_no_ss:
            b_max_f = b["max"] if b["max"] is not None else 1e12
            if 0 < b["amount_in_bracket"] < (b_max_f - b["min"]):
                marginal_rate = b["rate"]
                headroom      = (b_max_f - b["min"]) - b["amount_in_bracket"]
                break

        # Actual marginal rate — uses only actual YTD conversion (not plan) so quarterly
        # payment estimates are not inflated by a conversion that hasn't happened yet.
        _actual_conv_for_rate = ytd_converted_total if ytd_converted_total > 0 else 0.0
        _gross_actual_rate    = _annual_w2 + annual_div_for_agi + _actual_conv_for_rate + _ytd_stcg_realized
        _taxable_actual_rate  = max(0.0, _gross_actual_rate - std_deduction)
        _ord_actual_rate      = max(0.0, _taxable_actual_rate - total_qualified_div)
        _breakdown_actual     = _bracket_breakdown(_ord_actual_rate, brackets)
        marginal_rate_actual  = marginal_rate  # fallback to plan rate
        for _b in _breakdown_actual:
            _b_max = _b["max"] if _b["max"] is not None else 1e12
            if 0 < _b["amount_in_bracket"] < (_b_max - _b["min"]):
                marginal_rate_actual = _b["rate"]
                break

        # Max total conversion that keeps you in the current marginal bracket.
        # headroom = space remaining in the current bracket AFTER current taxable
        # income (dividends + conversion already applied), so:
        #   optimal_conv = current conversion + remaining headroom
        #
        # BUT: if YTD actual conversions EXCEED the configured annual_conv,
        # use actual YTD as the new baseline (user over-converted beyond plan)
        _base_conv = max(annual_conv, ytd_converted_total) if ytd_converted_total > 0 else annual_conv
        optimal_conv = round(_base_conv + headroom, 0) if marginal_rate is not None else None

        # ── Dynamic conversion recommendation ────────────────────────────────
        # Uses ACTUAL YTD income (from transactions) + projected remaining months
        # to compute exactly how much conversion is needed to fill the 22% bracket.

        # Actual income received Jan 1 → today (from Schwab transaction history)
        _ytd_actual_taxable = float(
            income_history.get("by_account", {}).get("taxable", {}).get("total") or 0.0
        )

        # AGI ratio: fraction of total distributions that hit AGI (excludes ROC)
        _agi_ratio = (annual_div_for_agi / annual_div_total) if annual_div_total > 0 else 0.85

        # Full-year income estimate: actual YTD + projected remaining months
        # We subtract expected_ytd from remaining to avoid double-counting months
        # that actual_ytd already covers; then add projected for remaining months.
        # Simple model: actual + (remaining projected for current..Dec)
        _full_year_income_est  = _ytd_actual_taxable + remaining_income_this_year
        # Add STCG to AGI estimate — it's ordinary income that already happened this year
        _full_year_agi_est     = round(_full_year_income_est * _agi_ratio + _ytd_stcg_realized, 0)

        # Find the target bracket ceiling — personal.json._TAX_SETTINGS takes priority over rules.json
        _tre_cfg_tx          = cfg.get("_TAX_RULE_ENGINE", {})
        _tax_settings_tx     = cfg.get("_TAX_SETTINGS", {})
        _target_rate_tx      = float(
            _tax_settings_tx.get("target_bracket_rate") or _tre_cfg_tx.get("target_bracket_rate", 24)
        ) / 100.0
        _target_rate_tx_pct  = int(round(_target_rate_tx * 100))   # e.g. 24
        _target_bracket_taxable_max = next(
            (b["max"] for b in brackets if abs(b["rate"] - _target_rate_tx) < 0.001 and b["max"] is not None),
            None
        )
        # Gross income to fill the target bracket (taxable cap + std deduction)
        _target_bracket_ceiling = (_target_bracket_taxable_max + std_deduction) if _target_bracket_taxable_max else None

        # Safety buffer: prevents accidental bracket spillover (configurable, default $7,500)
        _safety_buffer = float(personal_cfg.get("conversion_safety_buffer", 7500))

        # ── NIIT (Net Investment Income Tax) ─────────────────────────────────
        # 3.8% surcharge on NII (dividends, cap gains) above MAGI threshold
        _niit_rate      = float(_tre_cfg_tx.get("niit_rate", 0.038))
        _niit_thresh_map = {
            "MFJ":    float(_tre_cfg_tx.get("niit_threshold_mfj",    250_000)),
            "SINGLE": float(_tre_cfg_tx.get("niit_threshold_single", 200_000)),
            "MFS":    float(_tre_cfg_tx.get("niit_threshold_mfs",    125_000)),
        }
        _niit_threshold = _niit_thresh_map.get(_filing.upper(), 200_000)
        # NII = dividends + STCG + LTCG (ROC excluded; conversions are ordinary
        # income from a retirement account, not investment income, so excluded).
        _nii_amount     = annual_div_for_agi + _ytd_stcg_realized + _ytd_ltcg_realized
        # NIIT applies on lesser of: NII, or (MAGI − threshold)
        # MAGI uses actual-basis income (not plan-inflated gross_no_ss)
        _magi           = _gross_actual
        _niit_base      = max(0.0, min(_nii_amount, _magi - _niit_threshold))
        _niit_amount    = round(_niit_base * _niit_rate, 0)
        _niit_applies   = _magi > _niit_threshold
        _niit_headroom  = max(0.0, _niit_threshold - _magi)  # $ until NIIT kicks in

        # ── IRMAA — Medicare Part B/D premium surcharge (only when collect_medicare) ──
        _collect_medicare_now = bool(personal_cfg.get("collect_medicare", False))
        _medicare_people      = int(personal_cfg.get("medicare_people", 1))
        _irmaa_tier_idx       = None
        _irmaa_tier_label     = None
        _irmaa_part_b_mo      = None
        _irmaa_part_d_mo      = None
        _irmaa_monthly_pp     = None
        _irmaa_annual         = None
        _irmaa_headroom       = None
        _irmaa_next_threshold = None
        if _collect_medicare_now and _tre_cfg_tx.get("use_irmaa", True):
            _irmaa_key     = "irmaa_brackets_mfj" if _filing == "MFJ" else "irmaa_brackets_single"
            _irmaa_tiers   = _tre_cfg_tx.get(_irmaa_key, [])
            _irmaa_magi    = _magi  # same MAGI used for NIIT
            for _ti, _tb in enumerate(_irmaa_tiers):
                _tier_max = _tb.get("max")
                if _tier_max is None or _irmaa_magi <= _tier_max:
                    _irmaa_tier_idx   = _ti
                    # part_b_monthly in each tier is the IRMAA surcharge only;
                    # base_part_b_monthly is the standard premium everyone pays
                    # regardless of MAGI — both must be added for the true
                    # out-of-pocket Part B premium.
                    _irmaa_base_part_b = float(_tre_cfg_tx.get("base_part_b_monthly", 0.0))
                    _irmaa_part_b_mo  = _irmaa_base_part_b + float(_tb["part_b_monthly"])
                    _irmaa_part_d_mo  = float(_tb["part_d_monthly"])
                    _irmaa_monthly_pp = _irmaa_part_b_mo + _irmaa_part_d_mo
                    _irmaa_annual     = round(_irmaa_monthly_pp * 12 * _medicare_people, 0)
                    # headroom to next tier (None if already at top tier)
                    if _tier_max is not None:
                        _irmaa_headroom       = round(_tier_max - _irmaa_magi, 0)
                        _irmaa_next_threshold = _tier_max
                    else:
                        _irmaa_headroom       = None
                        _irmaa_next_threshold = None
                    if _ti == 0:
                        _irmaa_tier_label = "TIER 0 — BASE"
                    else:
                        _irmaa_tier_label = f"TIER {_ti}"
                    break

        # ── NIIT effective rate — apportion the capped _niit_base (above) across
        # dividends/STCG/LTCG proportionally, instead of applying the flat 3.8%
        # rate to each income type independently (which overstates NIIT whenever
        # MAGI is only modestly over the threshold — e.g. MAGI $5,000 over with
        # $80,000 of NII: correct NIIT is 3.8% × $5,000 = $190, not 3.8% × $80,000
        # = $3,040 as applying the flat rate to dividends alone would give).
        _niit_eff_rate = (_niit_base / _nii_amount) * _niit_rate if _nii_amount > 0 else 0.0

        # ── LTCG tax layer — preferential rate, separate from ordinary brackets ──
        # LTCG is not part of AGI brackets; taxed at 0%/15%/20%, stacked on top of
        # ordinary + qualified-div taxable income (same stacking convention as
        # qualified_div_rate above) — not a flat 15% regardless of income level.
        _ltcg_rate_yr    = float(_tre_cfg.get("ltcg_rate", 0.15))
        _ltcg_bracket_key = "ltcg_brackets_mfj" if _filing == "MFJ" else "ltcg_brackets_single"
        _ltcg_brackets    = _tre_cfg.get(_ltcg_bracket_key, [])
        if _ltcg_brackets and _ytd_ltcg_realized > 0:
            _ltcg_eff_rate = (_calc_tax(_taxable_actual + _ytd_ltcg_realized, _ltcg_brackets) -
                              _calc_tax(_taxable_actual, _ltcg_brackets)) / _ytd_ltcg_realized
        else:
            _ltcg_eff_rate = _ltcg_rate_yr
        _niit_ltcg_yr  = _niit_eff_rate
        tax_ltcg       = round(_ytd_ltcg_realized * (_ltcg_eff_rate + _niit_ltcg_yr), 0)
        # NIIT on dividends and STCG — same apportioned rate as LTCG just above.
        # Folded into the existing attribution tiles (not a new bucket) so
        # tax_div_only + tax_stcg_add + tax_conv_add + tax_ltcg still telescopes
        # correctly. Previously only tax_ltcg carried any NIIT, so total_tax_with_cg
        # silently omitted NIIT on dividends/STCG whenever MAGI was over threshold.
        _niit_on_div_amt  = round(annual_div_for_agi * _niit_eff_rate, 0)
        _niit_on_stcg_amt = round(_ytd_stcg_realized * _niit_eff_rate, 0)
        tax_div_only      = round(tax_div_only + _niit_on_div_amt, 0)
        tax_stcg_add      = round(tax_stcg_add + _niit_on_stcg_amt, 0)
        # Total tax = W2 + ordinary (divs + STCG + conv) + NIIT (divs+STCG) + LTCG (incl. its own NIIT)
        total_tax_with_cg = round(tax_no_ss + tax_ltcg + _niit_on_div_amt + _niit_on_stcg_amt, 0)
        # Effective rate across ALL income (ordinary + LTCG)
        _total_gross_all  = gross_no_ss + _ytd_ltcg_realized
        eff_no_ss         = total_tax_with_cg / _total_gross_all if _total_gross_all > 0 else 0.0

        # ── Dual-Pipeline Conversion Engine ──────────────────────────────────
        # Pipeline A: Rollover → Roth (ordinary income / target bracket ceiling)
        # Pipeline B: Taxable → Target allocation (LTCG bracket ceiling)
        # Both pipelines share the same tax brackets, so they interact.

        # Pipeline A: YTD ordinary income stack
        # gross_no_ss already includes divs + conv + STCG (all ordinary income)
        _ytd_ordinary_income   = round(gross_no_ss, 0)
        _remaining_ordinary_room = max(0.0, (_target_bracket_ceiling or 0.0) - _ytd_ordinary_income - _safety_buffer)

        # Pipeline B: LTCG bracket analysis
        # LTCG stacks on top of ordinary income — thresholds are on total taxable income
        _ltcg_brackets_key  = "ltcg_brackets_mfj" if _filing == "MFJ" else "ltcg_brackets_single"
        _ltcg_brackets_list = _tre_cfg_tx.get(_ltcg_brackets_key, [])
        _ltcg_0pct_threshold  = next(
            (b["max"] for b in _ltcg_brackets_list if abs(b["rate"] - 0.00) < 0.001 and b["max"] is not None), None
        )
        _ltcg_15pct_threshold = next(
            (b["max"] for b in _ltcg_brackets_list if abs(b["rate"] - 0.15) < 0.001 and b["max"] is not None), None
        )
        # Ordinary taxable income = gross income − standard deduction
        _ordinary_taxable_income = max(0.0, gross_no_ss - std_deduction)
        # Total taxable income including already-realized LTCG this year
        _total_taxable_inc_with_ltcg = _ordinary_taxable_income + (_ytd_ltcg_realized or 0.0)
        # Room before hitting 15% LTCG rate (0% bucket room)
        _ltcg_0pct_room  = (
            max(0.0, _ltcg_0pct_threshold  - _total_taxable_inc_with_ltcg)
            if _ltcg_0pct_threshold  is not None else None
        )
        # Room before hitting 20% LTCG rate (15% bucket room)
        _ltcg_15pct_room = (
            max(0.0, _ltcg_15pct_threshold - _total_taxable_inc_with_ltcg)
            if _ltcg_15pct_threshold is not None else None
        )

        # Taxable account unrealized gains/losses (from already-built account list)
        _taxable_unrealized: dict = {}
        _taxable_gain_total  = 0.0
        _taxable_loss_total  = 0.0
        for _ua in accounts:
            if _ua.get("key") == "taxable":
                for _up in _ua.get("positions", []):
                    _u_pnl = _up.get("pnl", 0.0)
                    _taxable_unrealized[_up["symbol"]] = round(_u_pnl, 2)
                    if _u_pnl >= 0:
                        _taxable_gain_total  += _u_pnl
                    else:
                        _taxable_loss_total  += _u_pnl
                break
        _taxable_unrealized_total  = round(_taxable_gain_total,  0)
        _taxable_unrealized_losses = round(_taxable_loss_total,  0)

        # ── Lot-Level LTCG/STCG Analysis (from lots table in DB) ────────────
        # Build live price map from taxable positions so gain/loss reflects today's prices.
        # active_symbols tracks all currently-held taxable symbols (regardless of whether
        # a live price came back) — used to drop stale lots for fully-sold-out positions
        # without also dropping real holdings just because a price quote was missing.
        _live_prices: dict = {}
        _active_taxable_syms: set = set()
        for _ua in accounts:
            if _ua.get("key") == "taxable":
                for _up in _ua.get("positions", []):
                    _active_taxable_syms.add(_up["symbol"])
                    _p = _up.get("current_price", 0)
                    if _p > 0:
                        _live_prices[_up["symbol"]] = _p
                break
        _cost_basis_analysis = _load_cost_basis_analysis(
            live_prices=_live_prices, active_symbols=_active_taxable_syms)

        # ── Spending-Aware Tax Metrics ────────────────────────────────────────
        # Use actual spending from transactions to compute real withdrawal need,
        # real AGI, and real conversion room.
        _si_available  = _si.get("available", False)
        _si_spend      = _si.get("true_annual_spending", 0) if _si_available else 0
        _si_recent     = _si.get("recent_annual",        0) if _si_available else 0
        _si_prior      = _si.get("prior_annual")           if _si_available else None
        _si_drift      = _si.get("spending_drift_pct")     if _si_available else None

        if _si_available and _si_spend > 0:
            # How much spending exceeds portfolio income → must be withdrawn (taxable)
            _withdrawal_need   = max(0.0, _si_spend - annual_div_for_agi)
            _income_surplus    = annual_div_for_agi - _si_spend  # positive = income > spending
            # Real AGI = base AGI + any forced withdrawal (withdrawal raises AGI)
            _agi_real          = gross_no_ss + _withdrawal_need
            _taxable_agi_real  = max(0.0, _gross_actual + _withdrawal_need - std_deduction)
            # Real conversion room: taxable bracket ceiling minus taxable real AGI minus buffer
            _conv_room_real    = max(0.0, (_target_bracket_taxable_max or 0) - _taxable_agi_real - _safety_buffer)
            _bp_real           = round(_taxable_agi_real / _target_bracket_taxable_max * 100, 1) if _target_bracket_taxable_max else None
            # AGI drift implied by spending drift (spending change → withdrawal change → AGI change)
            # If income > spending already, AGI drift from spending = $0 (no withdrawal either way)
            _agi_drift_dollars = 0.0 if _income_surplus > 0 else round(
                (_si_spend - (_si_prior or _si_spend)) * -1
                if _si_prior else 0.0
            )
        else:
            _withdrawal_need  = None
            _income_surplus   = None
            _agi_real         = None
            _conv_room_real   = None
            _bp_real          = None
            _agi_drift_dollars= None

        # ── Execute Conversion Target (the single source of truth) ───────────
        # = min(Rollover Balance, 22% Ceiling − Projected AGI − Safety Buffer)
        # This is the "set-and-run" number: plug it in and execute.
        if _target_bracket_ceiling and _full_year_agi_est > 0:
            _exec_raw = _target_bracket_ceiling - _full_year_agi_est - _safety_buffer
            exec_conv_target = max(0.0, round(min(_exec_raw, rollover_balance), 0))
        else:
            exec_conv_target = 0.0

        # Recommended conversion (same formula, backward-compat alias)
        # BUT: adjust for YTD conversions already completed
        dynamic_conv_recommended = max(0.0, exec_conv_target - ytd_converted_total)

        # Income confidence: how much of the full-year estimate is already locked in
        # Higher = less projection uncertainty = safer to act
        _income_received_pct = (
            _ytd_actual_taxable / _full_year_agi_est * 100
            if _full_year_agi_est > 0 else 0.0
        )
        _today_m = datetime.now(timezone.utc).month
        if _income_received_pct >= 85 or _today_m >= 11:
            _income_confidence = "HIGH"
        elif _income_received_pct >= 55 or _today_m >= 8:
            _income_confidence = "MEDIUM"
        else:
            _income_confidence = "LOW"

        # Timing trigger: execute when ≥80% of income received OR Dec 1
        # Conversion being "done" doesn't mean stop — it means calculate REAL remaining capacity
        _trigger_pct_threshold = float(personal_cfg.get("conversion_trigger_pct", 80.0))
        _pct_triggered  = _income_received_pct >= _trigger_pct_threshold
        from datetime import date as _date_trigger
        _dec1 = _date_trigger(datetime.now(timezone.utc).year, 12, 1)
        _dec1_triggered = _date_trigger.today() >= _dec1
        
        # Calculate ACTUAL remaining conversion capacity (not just "done" flag)
        # If actual conversions > 0, subtract from exec_conv_target to get true remaining
        _remaining_after_ytd = max(0.0, exec_conv_target - ytd_converted_total)
        
        # Trigger is met if: income threshold reached OR Dec 1 arrived OR no more conversion room
        _no_more_room = _remaining_after_ytd < 100  # less than $100 remaining = essentially done
        _trigger_met    = _pct_triggered or _dec1_triggered or _no_more_room
        _days_to_dec1   = max(0, (_dec1 - _date_trigger.today()).days)

        # Conservative: remaining of user's configured annual amount
        dynamic_conv_conservative = max(0.0, float(annual_conv) - ytd_converted_total)
        # Aggressive: remaining of optimal headroom
        dynamic_conv_aggressive   = max(0.0, round(optimal_conv, 0) - ytd_converted_total) if optimal_conv else dynamic_conv_recommended

        # Future-year projections should use the ORIGINAL target amounts,
        # NOT the remaining after YTD conversions.
        _future_conv_recommended   = exec_conv_target        # original planned: $150,991
        _future_conv_conservative  = float(annual_conv)       # configured annual
        _future_conv_aggressive    = round(optimal_conv, 0) if optimal_conv else exec_conv_target

        # Build the dynamic conversion plan — this becomes "Phase 2" in the UI
        # (AccountImpactPanel / ConversionCalendarPanel), stacked ON TOP OF Phase 1
        # (remaining_conv_target, "complete annual target"). dynamic_conv_recommended
        # is the TOTAL additional amount (from current YTD) needed to reach the full
        # bracket ceiling — it already contains Phase 1's remaining_conv_target, so
        # Phase 2 must subtract it to get the INCREMENT beyond Phase 1. Without this,
        # executing both phases would convert remaining_conv_target + dynamic_conv_recommended,
        # overshooting the bracket ceiling by a full remaining_conv_target.
        _dyn_conv_additional   = max(0.0, dynamic_conv_recommended - remaining_conv_target)
        _rollover_after_phase1 = max(0.0, rollover_balance - remaining_conv_target)
        _dyn_conv_capped = min(_dyn_conv_additional, _rollover_after_phase1)
        rollover_conv_plan_dynamic = _build_conv_plan(rollover_positions_live, _dyn_conv_capped)

        # ── Conversion signals ────────────────────────────────────────────────
        dynamic_conv_factors = []

        # Signal 1: Market trend (SPY / S&P 500 trend_90d)
        _sp_data   = market_context.get("S&P 500") or {}
        _spy_t90   = float(_sp_data.get("trend_90d") or 0.0)
        if _spy_t90 < -0.05:
            dynamic_conv_factors.append({
                "name": "Market Discount",
                "signal": "BULLISH",
                "icon": "📉",
                "description": (
                    f"S&P 500 down {abs(_spy_t90)*100:.1f}% over 90 days — convert at a discount "
                    f"(shares are cheaper, same tax cost buys more Roth value)"
                ),
            })
        elif _spy_t90 > 0.10:
            dynamic_conv_factors.append({
                "name": "Market Extended",
                "signal": "CAUTION",
                "icon": "📈",
                "description": (
                    f"S&P 500 up {_spy_t90*100:.1f}% over 90 days — converting at elevated prices; "
                    f"consider waiting for a pullback if within a few weeks"
                ),
            })
        else:
            dynamic_conv_factors.append({
                "name": "Market Neutral",
                "signal": "NEUTRAL",
                "icon": "📊",
                "description": f"S&P 500 trend {_spy_t90*100:+.1f}% over 90 days — no strong timing signal",
            })

        # Signal 2: Income pace vs expected
        if _ytd_actual_taxable > 0 and expected_ytd_total > 0:
            _pace_ratio = _ytd_actual_taxable / expected_ytd_total
            if _pace_ratio < 0.88:
                dynamic_conv_factors.append({
                    "name": "Income Running Light",
                    "signal": "OPPORTUNITY",
                    "icon": "💡",
                    "description": (
                        f"Received ${_ytd_actual_taxable:,.0f} vs expected ${expected_ytd_total:,.0f} "
                        f"({_pace_ratio*100:.0f}% of pace) — income shortfall creates extra headroom for conversion"
                    ),
                })
            elif _pace_ratio > 1.12:
                dynamic_conv_factors.append({
                    "name": "Income Running Hot",
                    "signal": "CAUTION",
                    "icon": "⚠️",
                    "description": (
                        f"Received ${_ytd_actual_taxable:,.0f} vs expected ${expected_ytd_total:,.0f} "
                        f"({_pace_ratio*100:.0f}% of pace) — strong income may shrink bracket room"
                    ),
                })
            else:
                dynamic_conv_factors.append({
                    "name": "Income On Track",
                    "signal": "NEUTRAL",
                    "icon": "✅",
                    "description": (
                        f"Received ${_ytd_actual_taxable:,.0f} vs expected ${expected_ytd_total:,.0f} "
                        f"({_pace_ratio*100:.0f}%) — income tracking as projected"
                    ),
                })

        # Signal 3: Bracket utilization
        if optimal_conv and optimal_conv > 0:
            _util_pct_sig = round(annual_conv / optimal_conv * 100)
            if _util_pct_sig < 60:
                dynamic_conv_factors.append({
                    "name": "Large Bracket Gap",
                    "signal": "OPPORTUNITY",
                    "icon": "🎯",
                    "description": (
                        f"Configured conversion ${annual_conv:,.0f} uses only {_util_pct_sig}% of "
                        f"available ${optimal_conv:,.0f} bracket capacity — top-off opportunity"
                    ),
                })
            elif _util_pct_sig >= 95:
                dynamic_conv_factors.append({
                    "name": "Bracket Near Full",
                    "signal": "CAUTION",
                    "icon": "⚡",
                    "description": (
                        f"Current plan uses {_util_pct_sig}% of bracket — little room for unexpected income"
                    ),
                })

        # Signal 4 — Q4 Timing via rollover portfolio weighted 52W-high distance
        # Uses actual rollover positions (value-weighted) not any hardcoded symbol.
        # A portfolio down significantly from highs → convert early in Q4 (more shares/dollar)
        # A portfolio near highs → wait for a dip before executing.
        _ro_price_total  = 0.0   # sum of position values
        _ro_weighted_dist = 0.0  # weighted avg % from 52W high (negative = below high)
        _ro_top_sym      = None
        _ro_top_val      = 0.0
        _ro_positions_for_signal = rollover_positions_live if rollover_positions_live else []
        for _rp in _ro_positions_for_signal:
            _rp_sym  = _rp.get("symbol", "")
            _rp_snap = snapshots.get(_rp_sym) or {}
            _rp_val  = float(_rp.get("market_value") or _rp.get("current_value") or 0.0)
            _rp_px   = float(_rp_snap.get("price") or 0.0)
            _rp_high = float(_rp_snap.get("high_52w") or 0.0)
            if _rp_val > 0 and _rp_px > 0 and _rp_high > 0:
                _ro_price_total   += _rp_val
                _ro_weighted_dist += _rp_val * ((_rp_px - _rp_high) / _rp_high)
                if _rp_val > _ro_top_val:
                    _ro_top_val = _rp_val
                    _ro_top_sym = _rp_sym
        _ro_avg_from_high = (_ro_weighted_dist / _ro_price_total) if _ro_price_total > 0 else 0.0
        _today_m_for_ro   = datetime.now(timezone.utc).month
        _top_sym_label    = f" (largest: {_ro_top_sym})" if _ro_top_sym else ""
        if _ro_price_total > 0:
            if _ro_avg_from_high <= -0.10 and _today_m_for_ro >= 10:
                dynamic_conv_factors.append({
                    "name": f"Rollover: Execute Early Q4",
                    "signal": "BULLISH",
                    "icon": "📉",
                    "description": (
                        f"Rollover portfolio is {abs(_ro_avg_from_high)*100:.1f}% below 52W highs "
                        f"(weighted avg{_top_sym_label}) — depressed prices mean the same tax cost "
                        "transfers more shares. Execute in Oct/Nov, not late December."
                    ),
                })
            elif _ro_avg_from_high >= -0.03 and _today_m_for_ro >= 10:
                dynamic_conv_factors.append({
                    "name": f"Rollover: Wait for Pull-Back",
                    "signal": "CAUTION",
                    "icon": "📈",
                    "description": (
                        f"Rollover portfolio near 52W highs ({abs(_ro_avg_from_high)*100:.1f}% off peak"
                        f"{_top_sym_label}) — converting at peak prices transfers fewer shares. "
                        "A 5–10% pullback in late Nov/Dec would improve the transfer."
                    ),
                })
            elif _ro_price_total > 0:
                dynamic_conv_factors.append({
                    "name": "Rollover: Neutral Timing",
                    "signal": "NEUTRAL",
                    "icon": "📊",
                    "description": (
                        f"Rollover portfolio {abs(_ro_avg_from_high)*100:.1f}% below 52W highs"
                        f"{_top_sym_label} — no strong timing signal; standard Q4 execution."
                    ),
                })

        # Pre-Q4 estimate (mid-year awareness snapshot)
        # Shows what you COULD convert today based on ACTUAL remaining capacity
        # Uses exec_conv_target - actual_ytd_converted to show REAL remaining room
        if _target_bracket_ceiling and _ytd_actual_taxable > 0:
            _remaining_agi_est = max(0.0, _full_year_agi_est - _ytd_actual_taxable)
            _remaining_exec_room = max(0.0, round(
                min(
                    _target_bracket_ceiling - _ytd_actual_taxable - _remaining_agi_est - _safety_buffer,
                    rollover_balance
                ), 0
            ))
            # Pre-Q4 = remaining capacity after accounting for any YTD conversions
            _pre_q4_exec = max(0.0, _remaining_exec_room - ytd_converted_total)
        else:
            _pre_q4_exec = 0.0

        # Scenario B: With SS
        ss_combined = gross_no_ss + ss_annual * 0.5
        ss_tax_pct  = 0.85 if ss_combined > 44000 else 0.50
        ss_taxable_amt = ss_annual * ss_tax_pct
        gross_with_ss   = gross_no_ss + ss_annual
        taxable_with_ss = max(0.0, gross_no_ss + ss_taxable_amt - std_deduction)
        _ord_taxable_b  = max(0.0, taxable_with_ss - total_qualified_div)
        _qual_taxable_b = min(total_qualified_div, taxable_with_ss)
        tax_with_ss     = _calc_tax(_ord_taxable_b, brackets) + _qual_taxable_b * qualified_div_rate
        eff_with_ss     = tax_with_ss / gross_with_ss if gross_with_ss > 0 else 0.0
        breakdown_with_ss = _bracket_breakdown(_ord_taxable_b, brackets)

        # ── Year-by-year projection (current year + 14 years) ─────────────────
        # Real starting balances from live portfolio data
        _proj_roth_acct = next((a for a in accounts if a["key"] == "roth_ira"), None)
        _proj_rollover_start = rollover_balance            # live rollover (already computed)
        _proj_roth_start     = _proj_roth_acct["value"] if _proj_roth_acct else 0.0

        # Growth rate assumption (configurable in _PERSONAL.portfolio_growth_rate)
        _growth_rate     = float(personal_cfg.get("portfolio_growth_rate", 0.07))
        # Dividend growth rate for future-year projections (separate from portfolio NAV growth)
        # CEF distributions tend to be more stable; default 3% (configurable via dividend_growth_rate)
        _div_growth_rate = float(personal_cfg.get("dividend_growth_rate", 0.03))
        current_year_num = datetime.now().year

        # ── Annual conversion — auto-calculated recommendation (Settings reference only) ──
        # Uses the SAME target_bracket_rate/_target_bracket_ceiling computed above (~line 2691) —
        # one bracket-rate setting for both bracket-pressure tracking AND this recommendation,
        # not two. This value does NOT feed annual_conv above or any of its downstream consumers —
        # it's shown alongside the manual annual_conversion in Settings so you can apply it by hand.
        # SS only reduces this year's conversion room once actually being received — a future
        # planning scenario (ss_annual) doesn't apply to the current tax year until it starts.
        _has_ss_now         = bool(ss_start_date) and current_year_num >= int(ss_start_date[:4])
        _conv_ss_taxable    = ss_taxable_amt if _has_ss_now else 0.0
        _conv_w2_annualized = _annual_w2   # real W2 income, tracked above from _si

        annual_conversion_recommended = None
        annual_conversion_breakdown   = None
        if _target_bracket_ceiling is not None:
            # This is a STABLE, full-year ceiling-fill target — it must not net out
            # anything that has already happened this year (realized STCG YTD,
            # conversions done so far, etc.), or it drifts every time it's checked
            # as the year progresses, making it useless as a number you set once.
            # Actual-vs-target reconciliation (YTD converted, YTD realized STCG,
            # room left to fill by December) lives in the Tax tab, not here.
            #
            # NOTE: _target_bracket_ceiling is ALREADY a gross-income ceiling —
            # it's defined as taxable_bracket_max + std_deduction (see
            # `_target_bracket_ceiling = _target_bracket_taxable_max + std_deduction`
            # above) specifically so gross-dollar figures (dividends, W2, SS,
            # conversion) can be compared against it directly. Subtracting
            # std_deduction again here double-counts it and understates the
            # safe conversion amount by the full deduction.
            _conv_rec = (
                _target_bracket_ceiling
                - annual_div_for_agi
                - _conv_w2_annualized
                - _conv_ss_taxable
                - _safety_buffer
            )
            annual_conversion_recommended = round(max(0.0, _conv_rec), 0)
            annual_conversion_breakdown = {
                "bracket_rate":    _target_rate_tx_pct,
                "bracket_ceiling": round(_target_bracket_ceiling, 0),
                "dividends":       round(annual_div_for_agi, 0),
                "w2_annualized":   round(_conv_w2_annualized, 0),
                "ss_taxable":      round(_conv_ss_taxable, 0),
                "safety_buffer":   round(_safety_buffer, 0),
                "recommended":     annual_conversion_recommended,
            }

        # Qualified dividend ratio (fraction of AGI divs that are qualified)
        _qual_ratio = (total_qualified_div / annual_div_for_agi) if annual_div_for_agi > 0 else 0.85

        def _make_projections(conv_override: float) -> list:
            """
            Build a 15-year projection array for a given annual conversion target.
            - Current year  : actual YTD received + projected remaining months (_full_year_agi_est)
            - Future years  : TTM base compounded at _div_growth_rate per year
            - Rollover/Roth : grow at _growth_rate per year
            """
            _projs = []
            _yr_ro = float(_proj_rollover_start)
            _yr_rt = float(_proj_roth_start)
            for _yr in range(current_year_num, current_year_num + 15):
                _yr_age = _yr - (dob_year or (current_year_num - 58))
                _has_ss = bool(ss_start_date) and _yr >= int(ss_start_date[:4])
                if _has_ss:
                    _ss_yr = int(ss_start_date[:4])
                    if _yr == _ss_yr:
                        _ss_mo = int(ss_start_date[5:7]) if len(ss_start_date) >= 7 else 1
                        _yr_ss = ss_annual * max(0, 13 - _ss_mo) / 12
                    else:
                        _yr_ss = ss_annual
                else:
                    _yr_ss = 0.0
                # Current year: conversion already happened (live balance is post-conversion)
                # So _yr_conv = 0 for rollover math to avoid double-counting
                # But show actual ytd_converted_total so users see what was converted
                # Future years: use conv_override (planned remaining conversions)
                if _yr == current_year_num:
                    _yr_conv = 0.0
                    # Balance walk: live rollover already nets out YTD conversions.
                    # Deduct the remaining planned conversions so future years start
                    # from a realistic post-2026 balance, not the inflated live balance.
                    _remaining_this_year = max(0.0, conv_override - (ytd_converted_total or 0.0))
                    _yr_conv_balance = min(_remaining_this_year, _yr_ro)
                else:
                    _yr_conv = min(float(conv_override), _yr_ro)
                    _yr_conv_balance = _yr_conv
                # Year 0 (current): actual + projected remaining; future: TTM × (1 + div_growth)^n
                _future_n = _yr - current_year_num          # 0 for current year, 1 for next, …
                if _yr == current_year_num and _full_year_agi_est > 0:
                    _yr_divs  = _full_year_agi_est
                    _yr_qual  = _full_year_agi_est * _qual_ratio
                else:
                    _div_factor = (1.0 + _div_growth_rate) ** _future_n
                    _yr_divs  = annual_div_for_agi * _div_factor
                    _yr_qual  = total_qualified_div * _div_factor
                # Use actual YTD conversion for current year income calculation
                _yr_conv_for_gross = ytd_converted_total if _yr == current_year_num and ytd_converted_total > 0 else _yr_conv
                _yr_gross = _yr_divs + _yr_conv_for_gross + _yr_ss
                if _has_ss:
                    _ss_c2 = _yr_divs + _yr_conv_for_gross + _yr_ss * 0.5
                    _ss_t2 = _yr_ss * (0.85 if _ss_c2 > 44000 else 0.50)
                    _yr_agi2 = _yr_divs + _yr_conv_for_gross + _ss_t2
                else:
                    _yr_agi2 = _yr_divs + _yr_conv_for_gross
                _yr_taxable2 = max(0.0, _yr_agi2 - std_deduction)
                _yr_ord2  = max(0.0, _yr_taxable2 - _yr_qual)
                _yr_qual2 = min(_yr_qual, _yr_taxable2)
                _yr_tax2  = _calc_tax(_yr_ord2, brackets) + _yr_qual2 * qualified_div_rate
                _yr_eff2  = _yr_tax2 / _yr_gross if _yr_gross > 0 else 0.0
                # Current year: show actual YTD conversion; future: planned conversion
                _display_conv = ytd_converted_total if _yr == current_year_num and ytd_converted_total > 0 else _yr_conv
                _projs.append({
                    "year":           _yr,
                    "age":            _yr_age,
                    "has_ss":         _has_ss,
                    "ss_prorated":    _has_ss and _yr == int(ss_start_date[:4]) if ss_start_date else False,
                    "is_actual_year": _yr == current_year_num,
                    "dividends":      round(_yr_divs, 0),
                    "dividends_roc":  round(total_roc_div, 0),
                    "conversion":     round(_display_conv, 0),
                    "ss_income":      round(_yr_ss, 0),
                    "gross_income":   round(_yr_gross, 0),
                    "taxable_income": round(_yr_taxable2, 0),
                    "federal_tax":    round(_yr_tax2, 0),
                    "effective_rate": round(_yr_eff2 * 100, 1),
                    "after_tax":      round(_yr_gross - _yr_tax2, 0),
                    "rollover_value": round(_yr_ro, 0),
                    "roth_value":     round(_yr_rt, 0),
                })
                _yr_ro = max(0.0, _yr_ro - _yr_conv_balance) * (1.0 + _growth_rate)
                _yr_rt = (_yr_rt + _yr_conv_balance) * (1.0 + _growth_rate)
            return _projs

        # Use original planned amounts for future years, not remaining after YTD
        projections              = _make_projections(_future_conv_conservative)
        projections_recommended  = _make_projections(_future_conv_recommended)
        projections_aggressive   = _make_projections(_future_conv_aggressive)

        # ── Estimated future RMD burden ─────────────────────────────────────────
        # Uses the recommended-conversion-pace projection (already nets out planned
        # annual conversions and compounds rollover at _growth_rate) to estimate the
        # first-year RMD and the tax attributable to it, once RMDs begin.
        _rmd_start_age_val   = int(_tre_cfg_tx.get("rmd_start_age", 75))
        _rmd_factors         = cfg.get("_RMD_FACTORS", {})
        _proj_row_at_rmd     = next((r for r in projections_recommended if r["age"] >= _rmd_start_age_val), None)
        _rollover_at_rmd_age = _proj_row_at_rmd["rollover_value"] if _proj_row_at_rmd else None
        _rmd_taxable_baseline = _proj_row_at_rmd["taxable_income"] if _proj_row_at_rmd else None

        # The projection array only covers 15 years — if RMD age is further out than
        # that (e.g. current age well under 60), extrapolate the same balance walk
        # (draw the planned annual conversion, then grow) from the last projected
        # year out to RMD age, using the same _growth_rate as the projection itself.
        if _proj_row_at_rmd is None and projections_recommended:
            _last_row = projections_recommended[-1]
            _ro = float(_last_row["rollover_value"])
            for _ in range(_rmd_start_age_val - _last_row["age"]):
                _ro = max(0.0, _ro - _future_conv_recommended) * (1.0 + _growth_rate)
            _rollover_at_rmd_age = _ro
            _rmd_taxable_baseline = _last_row["taxable_income"]

        _rmd_divisor = float(_rmd_factors.get(str(_rmd_start_age_val), _rmd_factors.get(_rmd_start_age_val, 24.6)))

        estimated_first_year_rmd = (
            round(_rollover_at_rmd_age / _rmd_divisor, 0)
            if _rollover_at_rmd_age is not None and _rmd_divisor > 0 else None
        )

        # Tax attributable to the RMD alone = tax(baseline + RMD) - tax(baseline),
        # where baseline is the projected non-conversion taxable income at that age
        # (conversions stop once RMDs begin, so baseline excludes them).
        estimated_rmd_tax = None
        if estimated_first_year_rmd is not None and _rmd_taxable_baseline is not None:
            _rmd_baseline_taxable = max(0.0, _rmd_taxable_baseline)
            _tax_before_rmd = _calc_tax(_rmd_baseline_taxable, brackets)
            _tax_after_rmd  = _calc_tax(_rmd_baseline_taxable + estimated_first_year_rmd, brackets)
            estimated_rmd_tax = round(_tax_after_rmd - _tax_before_rmd, 0)

        # ── Survivor bracket-compression check (MFJ → Single filing shift) ──────
        # Whatever is left in pre-tax accounts when the first spouse passes gets
        # taxed at Single rates for the survivor's life going forward. This reuses
        # the exact rollover-at-RMD-age projection above (no second projection
        # model) and walks the same _calc_tax()/_bracket_breakdown() bracket logic
        # a second time against brackets_single. Nothing here reads
        # target_bracket_rate directly — it only consumes whatever pre-tax balance
        # that setting already produced upstream via the conversion pace, so
        # changing the target rate in Settings changes this automatically.
        survivor_bracket_projection = None
        if filing == "MFJ" and _rollover_at_rmd_age is not None and current_age is not None:
            _single_brackets   = tax_bkts_cfg.get("brackets_single", [])
            _single_std_ded    = float(tax_bkts_cfg.get("standard_deduction_single", 15000))
            _survivor_age_then = (spouse_age + (_rmd_start_age_val - current_age)) if spouse_age is not None else None
            if _survivor_age_then is not None and _survivor_age_then >= 65:
                _single_std_ded += float(tax_bkts_cfg.get("age_65_additional_deduction_per_person", 1650))
                if today_d.year <= int(tax_bkts_cfg.get("senior_deduction_expires_year", 2028)):
                    _single_std_ded += float(tax_bkts_cfg.get("senior_deduction_per_person", 6000))

            # MFJ comparator ("if the filer hadn't died, both still filing MFJ at
            # this same future year") must project ages forward the same way the
            # Single side does — reusing the module-level `std_deduction` (computed
            # from TODAY's ages) understates it whenever either spouse crosses 65
            # between now and the survivor year, inflating extra_annual_tax_as_single.
            _mfj_std_ded_survivor = float(tax_bkts_cfg.get("standard_deduction_mfj", 30000))
            _filer_age_then = _rmd_start_age_val
            _mfj_qualifying_then = sum(1 for a in (_filer_age_then, _survivor_age_then) if a is not None and a >= 65)
            _mfj_std_ded_survivor += float(tax_bkts_cfg.get("age_65_additional_deduction_per_person", 1650)) * _mfj_qualifying_then
            if today_d.year <= int(tax_bkts_cfg.get("senior_deduction_expires_year", 2028)):
                _mfj_std_ded_survivor += float(tax_bkts_cfg.get("senior_deduction_per_person", 6000)) * _mfj_qualifying_then

            _surv_mfj_taxable    = max(0.0, _rollover_at_rmd_age - _mfj_std_ded_survivor)
            _surv_single_taxable = max(0.0, _rollover_at_rmd_age - _single_std_ded)
            _surv_mfj_tax    = _calc_tax(_surv_mfj_taxable, brackets)
            _surv_single_tax = _calc_tax(_surv_single_taxable, _single_brackets)
            _surv_mfj_rate    = next((b["rate"] for b in reversed(_bracket_breakdown(_surv_mfj_taxable, brackets)) if b["amount_in_bracket"] > 0),
                                      brackets[0]["rate"] if brackets else 0.0)
            _surv_single_rate = next((b["rate"] for b in reversed(_bracket_breakdown(_surv_single_taxable, _single_brackets)) if b["amount_in_bracket"] > 0),
                                      _single_brackets[0]["rate"] if _single_brackets else 0.0)

            survivor_bracket_projection = {
                "projected_pretax_balance_at_survivor_year": round(_rollover_at_rmd_age, 0),
                "survivor_year_estimate": today_d.year + round(_rmd_start_age_val - current_age),
                "mfj_bracket_at_this_income": _surv_mfj_rate,
                "single_bracket_at_this_income": _surv_single_rate,
                "extra_annual_tax_as_single": round(max(0.0, _surv_single_tax - _surv_mfj_tax), 0),
            }

        # ── Analytical scores ─────────────────────────────────────────────────
        # 1. Conversion Efficiency: % of available bracket capacity being used
        # Use ACTUAL conversions if they exist, compared to actual capacity
        _conv_efficiency_denom = exec_conv_target  # actual capacity
        _conv_efficiency_numer = ytd_converted_total if ytd_converted_total > 0 else annual_conv
        conv_efficiency_score = None
        if _conv_efficiency_denom and _conv_efficiency_denom > 0:
            conv_efficiency_score = round(min(100.0, _conv_efficiency_numer / _conv_efficiency_denom * 100), 1)

        # 2. Income Tax Efficiency Score (0–100)
        #    Weights: ROC=tax-deferred(1.0), Qualified=preferred rate(0.70), Ordinary=bracket rate(0.0)
        _inc_total = (total_ordinary_div + total_qualified_div + total_roc_div) or 1.0
        income_tax_score = round(
            total_roc_div  / _inc_total * 100.0 +
            total_qualified_div / _inc_total * 70.0,
            1
        )

        # 3. Sequence Risk: % of projected income from equity-sensitive funds (beta > 0.70)
        _seq_eq_income = 0.0
        _seq_total_income = 0.0
        for _acct3 in accounts:
            for _p3 in _acct3.get("positions", []):
                _b3  = snapshots.get(_p3["symbol"], {}).get("beta") or 0.0
                _i3  = _p3.get("annual_income", 0.0)
                _seq_total_income += _i3
                if abs(_b3) > 0.70:
                    _seq_eq_income += _i3
        seq_risk_score = round(_seq_eq_income / _seq_total_income * 100, 1) if _seq_total_income > 0 else None

        # ── Bracket Pressure trend (day-over-day) ─────────────────────────────
        # bracket_pressure_pct = TAXABLE income (actual) ÷ TAXABLE bracket ceiling.
        # Rules:
        #   1. Numerator: _taxable_actual = (divs + ytd_converted_total + STCG) − std_deduction.
        #      Uses actual executed conversions only — NOT the plan target — so an unexecuted
        #      $400k plan doesn't show bracket as full when only $116k was done.
        #   2. Denominator: _target_bracket_taxable_max (IRS taxable ceiling, e.g. $505,800 for
        #      32% MFJ). NOT the gross ceiling ($538k = taxable + std_deduction). Comparing
        #      taxable income to a gross ceiling produces a systematically understated % because
        #      the std deduction makes the denominator larger than it should be.
        _bracket_pressure_pct = None
        _bracket_pressure_trend = None
        _bracket_pressure_trend_color = None
        if _target_bracket_taxable_max and _target_bracket_taxable_max > 0 and _taxable_actual >= 0:
            _bracket_pressure_pct = round(_taxable_actual / _target_bracket_taxable_max * 100, 1)
            _yest_bp = _trends_cache.get("bracket_pressure_pct")
            if _yest_bp is not None:
                _bp_delta = _bracket_pressure_pct - _yest_bp
                if _bp_delta > 1.0:
                    _bracket_pressure_trend       = "↑ Rising (income pacing hot)"
                    _bracket_pressure_trend_color = "red"
                elif _bp_delta < -1.0:
                    _bracket_pressure_trend       = "↓ Easing (income running light)"
                    _bracket_pressure_trend_color = "green"
                else:
                    _bracket_pressure_trend       = "→ Stable"
                    _bracket_pressure_trend_color = "muted"

        # ── Tax Rule Engine: bracket status + soft limit overlay ─────────────
        _tre              = cfg.get("_TAX_RULE_ENGINE", {})
        _tre_thresholds   = _tre.get("status_thresholds", {"CRITICAL": 1.00, "ACTION": 0.90, "WATCH": 0.75})
        _tre_soft_limit   = float(_tre.get("soft_limit", cfg.get("_WITHDRAWAL_STRATEGY", {}).get("dividend_load_alert", 160_000)))
        _income_brk_tgt   = _target_bracket_ceiling or _income_bracket_target or 244150.0  # dynamic from brackets

        # Bracket pace: taxable actual income ÷ taxable ceiling (matches _bracket_pressure_pct math).
        # _income_brk_tgt kept as gross ceiling for backward-compat display; pace uses taxable.
        _income_brk_tgt_taxable = _target_bracket_taxable_max or max(0.0, _income_brk_tgt - std_deduction)
        _brk_pace         = (_taxable_actual / _income_brk_tgt_taxable) if _income_brk_tgt_taxable > 0 else 0.0
        _brk_room         = max(0.0, _income_brk_tgt_taxable - _taxable_actual)

        _tre_rate_label = f"{_target_rate_tx_pct}%"
        def _tre_status(pace: float) -> tuple:
            if pace >= _tre_thresholds.get("CRITICAL", 1.00):
                return ("CRITICAL", f"{_tre_rate_label} bracket breached — stop all taxable adds and conversions", "red")
            if pace >= _tre_thresholds.get("ACTION",   0.90):
                return ("ACTION",   f"Within 10% of {_tre_rate_label} ceiling — freeze conversions, minimize taxable income", "orange")
            if pace >= _tre_thresholds.get("WATCH",    0.75):
                return ("WATCH",    f"Bracket pressure rising — monitor dividends and conversion pace ({_tre_rate_label} ceiling)", "yellow")
            return ("OK",           f"Comfortable room in {_tre_rate_label} bracket", "green")

        _brk_status, _brk_msg, _brk_color = _tre_status(_brk_pace)

        # Soft-limit is the dividend_load_alert threshold — compare against annual dividends only
        # (annual_div_for_agi), not total gross income. Conversions and STCG are not "dividend load."
        # Using _gross_actual here caused $331K (divs + conv + STCG) vs $160K → false ACTION status
        # while the Tax tab's Dividend Load widget correctly showed $112K divs → comfortable headroom.
        _sl_pace          = (annual_div_for_agi / _tre_soft_limit) if _tre_soft_limit > 0 else 0.0
        _sl_room          = max(0.0, _tre_soft_limit - annual_div_for_agi)
        if _sl_pace >= 1.0:
            _sl_status, _sl_msg, _sl_color = ("ACTION", "Soft limit reached — stop conversions", "orange")
        elif _sl_pace >= 0.85:
            _sl_status, _sl_msg, _sl_color = ("WATCH",  "Approaching soft limit — slow conversion pace", "yellow")
        else:
            _sl_status, _sl_msg, _sl_color = ("OK",     "Well within soft limit", "green")

        # Combined: take whichever is more severe
        _severity = {"OK": 1, "WATCH": 2, "ACTION": 3, "CRITICAL": 4}
        if _severity.get(_sl_status, 1) > _severity.get(_brk_status, 1):
            _final_brk_status, _final_brk_msg, _final_brk_color = _sl_status, _sl_msg, _sl_color
        else:
            _final_brk_status, _final_brk_msg, _final_brk_color = _brk_status, _brk_msg, _brk_color

        # ── Weighted Conversion Score (0–10) ──────────────────────────────────
        # 5 drivers, each normalized to their max, then summed.
        # Driver weights: Bracket(35%) + Income Drift(20%) + Rate Arbitrage(25%)
        #                 + Market Regime(10%) + Rollover Pressure(10%)
        # NOTE: "Rate Arbitrage" compares EFFECTIVE rate now vs FUTURE MARGINAL rate
        # (not nominal bracket vs nominal bracket, which produces a misleading 0% spread).
        _cs_components = []
        _cs_total = 0.0

        # Driver 1 — Bracket Utilization (max 3.5 pts)
        # Low utilization of available bracket = higher opportunity score
        _bkt_util = (annual_conv / optimal_conv) if (optimal_conv and optimal_conv > 0) else 1.0
        if   _bkt_util < 0.40: _bkt_pts = 3.5
        elif _bkt_util < 0.55: _bkt_pts = 3.0
        elif _bkt_util < 0.70: _bkt_pts = 2.5
        elif _bkt_util < 0.85: _bkt_pts = 1.5
        elif _bkt_util < 0.95: _bkt_pts = 0.75
        else:                   _bkt_pts = 0.0
        _cs_components.append({
            "name":   "Bracket Utilization",
            "weight": "35%",
            "points": round(_bkt_pts, 1),
            "max":    3.5,
            "detail": (f"{round(_bkt_util*100)}% used "
                       f"(${annual_conv:,.0f} of ${optimal_conv:,.0f} available)")
                       if optimal_conv is not None else
                       f"{round(_bkt_util*100)}% used (${annual_conv:,.0f} configured)",
            "signal": "OPPORTUNITY" if _bkt_pts >= 2.5 else "PARTIAL" if _bkt_pts >= 1.0 else "OPTIMAL",
        })
        _cs_total += _bkt_pts

        # Driver 2 — Income Drift: actual YTD vs expected (max 2.0 pts)
        # Income running light → more room → higher score; running hot → lower
        if _ytd_actual_taxable > 0 and expected_ytd_total > 0:
            _drift = (_ytd_actual_taxable - expected_ytd_total) / expected_ytd_total
            if   _drift < -0.15: _drift_pts = 2.0
            elif _drift < -0.10: _drift_pts = 1.6
            elif _drift < -0.05: _drift_pts = 1.2
            elif _drift <=  0.05: _drift_pts = 1.0
            elif _drift <=  0.10: _drift_pts = 0.6
            elif _drift <=  0.15: _drift_pts = 0.2
            else:                 _drift_pts = 0.0
            _drift_str = f"{_drift*100:+.1f}%"
        else:
            _drift = 0.0; _drift_pts = 1.0; _drift_str = "n/a"
        _cs_components.append({
            "name":   "Income Drift",
            "weight": "20%",
            "points": round(_drift_pts, 2),
            "max":    2.0,
            "detail": f"YTD received vs expected: {_drift_str}",
            "signal": ("OPPORTUNITY" if _drift_pts >= 1.6
                       else "NEUTRAL" if _drift_pts >= 0.8 else "CAUTION"),
        })
        _cs_total += _drift_pts

        # Driver 3 — Rate Arbitrage: EFFECTIVE rate now vs FUTURE MARGINAL rate with SS (max 2.5 pts)
        # The real arbitrage: you pay ~effective% today per dollar; future dollars face marginal%.
        # Using marginal-vs-marginal is misleading when low-bracket income makes effective << marginal.
        _fut_taxable = max(0.0, annual_div_for_agi + ss_annual * 0.85 - std_deduction)
        _fut_marginal = None
        for _b_fs in brackets:
            if _fut_taxable > _b_fs["min"]:
                _fut_marginal = _b_fs["rate"]
        _cur_eff   = eff_no_ss                         # effective all-in rate today (e.g. 0.117)
        _spread    = max(0.0, (_fut_marginal - _cur_eff) if _fut_marginal else 0.0)
        if   _spread >= 0.12: _spread_pts = 2.5        # 12%+ arbitrage — exceptional
        elif _spread >= 0.08: _spread_pts = 2.0        # 8–12% — strong
        elif _spread >= 0.05: _spread_pts = 1.5        # 5–8% — moderate
        elif _spread >= 0.02: _spread_pts = 1.0        # 2–5% — mild
        elif _spread >= 0.0:  _spread_pts = 0.5        # minimal but positive
        else:                  _spread_pts = 0.0
        _cs_components.append({
            "name":   "Rate Arbitrage",
            "weight": "25%",
            "points": round(_spread_pts, 1),
            "max":    2.5,
            "detail": (f"Effective now: {_cur_eff*100:.1f}% → "
                       f"future marginal: {round((_fut_marginal or _cur_eff)*100)}% with SS "
                       f"(+{_spread*100:.1f}% arbitrage)"),
            "signal": ("OPPORTUNITY" if _spread_pts >= 2.0
                       else "NEUTRAL" if _spread_pts >= 1.0 else "LOW"),
        })
        _cs_total += _spread_pts

        # Driver 4 — Market Regime: S&P 500 90D trend (max 1.0 pts)
        # Market down → convert at discount → higher score
        if   _spy_t90 < -0.10: _mkt_pts = 1.0
        elif _spy_t90 < -0.05: _mkt_pts = 0.75
        elif _spy_t90 <  0.0:  _mkt_pts = 0.50
        elif _spy_t90 <  0.10: _mkt_pts = 0.25
        else:                   _mkt_pts = 0.0
        _cs_components.append({
            "name":   "Market Regime",
            "weight": "10%",
            "points": round(_mkt_pts, 2),
            "max":    1.0,
            "detail": (f"S&P 500 90D: {_spy_t90*100:+.1f}% "
                       f"({'discount — convert cheaper' if _spy_t90 < -0.05 else 'elevated' if _spy_t90 > 0.10 else 'neutral'})"),
            "signal": ("BULLISH" if _mkt_pts >= 0.75 else "NEUTRAL" if _mkt_pts >= 0.25 else "CAUTION"),
        })
        _cs_total += _mkt_pts

        # Driver 5 — Rollover Pressure: urgency from remaining IRA balance (max 1.0 pts)
        _ro_tiers = _tre.get("rollover_pressure_tiers", [
            {"min": 600000, "points": 1.00}, {"min": 400000, "points": 0.75},
            {"min": 200000, "points": 0.50}, {"min": 100000, "points": 0.25},
            {"min": 0,      "points": 0.00},
        ])
        _ro_pts = next((t["points"] for t in _ro_tiers if rollover_balance >= t["min"]), 0.0)
        _cs_components.append({
            "name":   "Rollover Pressure",
            "weight": "10%",
            "points": round(_ro_pts, 2),
            "max":    1.0,
            "detail": f"${rollover_balance:,.0f} rollover balance — RMD clock ticking",
            "signal": "HIGH" if _ro_pts >= 0.75 else "MODERATE" if _ro_pts >= 0.4 else "LOW",
        })
        _cs_total += _ro_pts

        conv_score = round(min(10.0, _cs_total), 1)

        # Score → action mapping
        if   conv_score >= 7.5: conv_action = "AGGRESSIVE TOP-OFF"; conv_action_icon = "🟢"
        elif conv_score >= 5.0: conv_action = "PARTIAL";            conv_action_icon = "🟡"
        else:                    conv_action = "HOLD";               conv_action_icon = "🔴"

        # ── Quarterly estimated tax payment schedule ──────────────────────────
        import json as _json_mod
        import os as _os_mod
        from datetime import date as _date_cls

        def _days_until(ds):
            try:
                return (_date_cls.fromisoformat(ds) - _date_cls.today()).days
            except Exception:
                return None

        def _irs_due(year, month, day):
            """IRS due date shifted to next Monday when it falls on Sat or Sun."""
            d = _date_cls(year, month, day)
            if d.weekday() == 5:   # Saturday → Monday
                d = _date_cls(year, month, day + 2)
            elif d.weekday() == 6: # Sunday → Monday
                d = _date_cls(year, month, day + 1)
            return d.isoformat()

        _yr          = datetime.now().year
        _today_date  = _date_cls.today()
        _curr_month  = _today_date.month

        # Conversion timing config
        conversion_month = int(target_alloc_cfg.get("conversion_month", 12))
        # IRS estimated-tax periods — NOT calendar quarters:
        #   Q1 = Jan–Mar (due Apr 15)   Q2 = Apr–May (due Jun 15, only 2 months)
        #   Q3 = Jun–Aug (due Sep 15)   Q4 = Sep–Dec (due Jan 15)
        _IRS_Q_MAP = {1: {1,2,3}, 2: {4,5}, 3: {6,7,8}, 4: {9,10,11,12}}
        def _q_for_month(m): return next((q for q, ms in _IRS_Q_MAP.items() if m in ms), 4)
        conv_quarter = _q_for_month(conversion_month)
        conv_month_name = {1:"January",2:"February",3:"March",4:"April",5:"May",
                           6:"June",7:"July",8:"August",9:"September",10:"October",
                           11:"November",12:"December"}.get(conversion_month, "December")

        # If a conversion was actually executed, derive conv_quarter from the real transaction
        # date rather than the planned config month — e.g. a March conversion overrides a
        # December plan, putting the tax in Q1 not Q4.
        if ytd_conversions and ytd_converted_total > 0:
            _cv_months = []
            for _cv in ytd_conversions:
                _cv_d = _cv.get("date", "")
                if _cv_d:
                    try:
                        _cv_months.append(int(_cv_d.split("-")[1]))
                    except (ValueError, IndexError):
                        pass
            if _cv_months:
                _actual_conv_month = _cv_months[0]   # earliest conversion this year
                conv_quarter = next((q for q, ms in _IRS_Q_MAP.items() if _actual_conv_month in ms), conv_quarter)

        q_payments_calc = {}

        # ── Quarterly dividend income — same methodology as portfolio forward_tax_impact ──
        # Completed months  : actual Schwab transactions, split by per-symbol fund-config
        #                     ordinary/qualified/ROC ratios (same as _div_tax_detail).
        # Current + future  : projected monthly_totals × portfolio-level ord/qual fractions.
        # Tax computed as   : ordinary × marginal_rate + qualified × ltcg_rate  (not blended).
        _IRS_Q_MONTHS    = _IRS_Q_MAP  # same IRS quarter → month mapping
        _avg_monthly_div = (annual_div_for_agi / 12) if annual_div_for_agi > 0 else 0.0

        def _q_income(quarter_num):
            # Filled in after rate constants are established below; placeholder avoids NameError
            raise RuntimeError("_q_income called before initialised")

        def _q_conv(quarter_num):
            if ytd_conversions and len(ytd_conversions) > 0:
                conv_in_q = 0.0
                for conv in ytd_conversions:
                    conv_date = conv.get("date", "")
                    if conv_date:
                        try:
                            conv_month = int(conv_date.split("-")[1])
                            conv_q = _q_for_month(conv_month)
                            if conv_q == quarter_num:
                                conv_in_q += conv.get("value", 0)
                        except (ValueError, IndexError):
                            pass
                return round(conv_in_q, 0)
            return round(annual_conv, 0) if quarter_num == conv_quarter else 0

        # ── Rate constants needed for both div and CG tax ────────────────────────
        # Use actual marginal rate (based on real YTD conversion) so quarterly payment
        # estimates are not inflated by a conversion that is only planned, not done.
        # LTCG/qualified-div rates and the NIIT rate reuse the same graduated-bracket
        # and threshold-capped calcs as the annual figures above (_ltcg_eff_rate,
        # qualified_div_rate, _niit_eff_rate) instead of a flat 15%/uncapped 3.8% —
        # so quarterly cards can't disagree with the annual total for the same reason.
        _mr           = marginal_rate_actual if marginal_rate_actual is not None else 0.22
        _niit_on_ltcg = _niit_eff_rate
        _niit_on_div  = _niit_on_ltcg   # NIIT applies to all NII

        # Portfolio-level ordinary/qualified fractions (from fund-config tax characters)
        _div_gross = annual_div_total if annual_div_total > 0 else 1.0
        _ord_frac  = total_ordinary_div / _div_gross
        _qual_frac = total_qualified_div / _div_gross

        # ── Build per-quarter actual ord/qual/roc from completed Schwab transactions ──
        # Schwab provides current year + Q4 of prior year, so both are actual data.
        # Per-symbol tax-character ratios from _div_tax_detail (same as portfolio tab).
        _q_actual_ord  = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        _q_actual_qual = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        _q_actual_roc  = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        # Prior year Q4 actual (Oct–Dec of prev year; Schwab includes this in the pull)
        _prev_q4_actual_ord  = 0.0
        _prev_q4_actual_qual = 0.0
        _prev_q4_actual_roc  = 0.0
        _prev_q4_has_actual  = False

        def _apply_txn_split(amt, sym, txn_type=None):
            # If Schwab gave us a definitive type, use it directly — no percentage split needed.
            _t = (txn_type or "").upper()
            if _t == "ROC":
                return 0.0, 0.0, amt          # 100% return of capital
            if _t == "QUAL":
                return 0.0, amt, 0.0          # 100% qualified dividend
            if _t in ("INT", "STCG", "LTCG"):
                return amt, 0.0, 0.0          # 100% ordinary income
            # For DIV / REINVEST / unknown — apply fund-level TAX_CHARACTER split
            _dtd   = _div_tax_detail.get(sym, {})
            _o_pct = _dtd.get("ordinary_pct",  0.0) / 100.0
            _qp    = _dtd.get("qualified_pct", 0.0) / 100.0
            _r_pct = _dtd.get("roc_pct",       0.0) / 100.0
            if not (_o_pct + _qp + _r_pct > 0):
                _o_pct, _qp, _r_pct = _ord_frac, _qual_frac, 0.0
            return amt * _o_pct, amt * _qp, amt * _r_pct

        for _txn in (income_history.get("transactions", []) +
                     income_history.get("prev_q4_transactions", [])):
            if _txn.get("account") != "taxable":
                continue
            _txn_date = _txn.get("date", "")
            _txn_amt  = float(_txn.get("amount", 0.0))
            _txn_sym  = _txn.get("symbol")
            _txn_type = _txn.get("type")
            try:
                _txn_yr = int(_txn_date[:4])
                _txn_m  = int(_txn_date[5:7])
            except (ValueError, IndexError):
                continue

            if _txn_yr == _yr:
                # Include completed months AND the current partial month in actuals.
                if _txn_m > _curr_month:
                    continue
                _txn_q = _q_for_month(_txn_m)
                _to, _tq, _tr = _apply_txn_split(_txn_amt, _txn_sym, _txn_type)
                _q_actual_ord[_txn_q]  += _to
                _q_actual_qual[_txn_q] += _tq
                _q_actual_roc[_txn_q]  += _tr

            elif _txn_yr == _yr - 1 and _txn_m >= 10:
                # Prior year Q4 (Oct–Dec) — Schwab includes this in the data pull
                _to, _tq, _tr = _apply_txn_split(_txn_amt, _txn_sym, _txn_type)
                _prev_q4_actual_ord  += _to
                _prev_q4_actual_qual += _tq
                _prev_q4_actual_roc  += _tr
                _prev_q4_has_actual   = True

        # Forward projection lookup: 1-indexed month → projected monthly total (current year)
        _projected_by_month: dict = {}
        for _j, (_mn, _my) in enumerate(zip(month_nums_window, month_years_window)):
            if _my == _yr:
                _projected_by_month[_mn] = monthly_totals[_j]

        def _q_detail(quarter_num):
            """(ordinary, qualified, roc) for this IRS quarter.
            Completed months + current partial month use actual Schwab data;
            future months use projections."""
            target = _IRS_Q_MONTHS[quarter_num]
            p_ord = p_qual = p_roc = 0.0
            for _m in sorted(target):
                if _m > _curr_month:   # future months only → project
                    _proj   = _projected_by_month.get(_m, _avg_monthly_div)
                    p_ord  += _proj * _ord_frac
                    p_qual += _proj * _qual_frac
                    p_roc  += _proj * max(0.0, 1.0 - _ord_frac - _qual_frac)
            return (
                round(_q_actual_ord[quarter_num]  + p_ord,  0),
                round(_q_actual_qual[quarter_num] + p_qual, 0),
                round(_q_actual_roc[quarter_num]  + p_roc,  0),
            )

        def _q_income(quarter_num):    # noqa: F811 — replaces placeholder above
            _o, _q, _ = _q_detail(quarter_num)
            return _o + _q  # AGI income = ordinary + qualified (ROC not taxable)

        # ── Capital gains per IRS quarter from actual YTD SELL transactions ──────
        # This loop only buckets net STCG/LTCG amounts by quarter. STCG's tax is
        # computed further below via the same cumulative ordinary-bracket stack
        # used for dividends/conversion, so it lands at the correct marginal rate
        # instead of a flat "current marginal rate" approximation. LTCG keeps its
        # own preferential-rate calc here since it's never part of that stack.
        # Only current-year transactions; prev-Q4 gets its own (flat-rate) card.
        _cg_tax_by_q    = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}   # LTCG-only for now; STCG's share folded in below
        _stcg_by_q      = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}  # net (gains + losses)
        _stcg_gain_by_q = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}  # gross gains only (positive)
        _stcg_loss_by_q = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}  # losses only (negative)
        _ltcg_by_q      = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        _ltcg_gain_by_q = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}  # gross LTCG gains only (positive)
        _ltcg_loss_by_q = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}  # LTCG losses only (negative)
        _IRS_QM_CG      = _IRS_Q_MAP  # reuse IRS quarter definition for CG assignment
        for _cg_txn in realized_gains_history.get("transactions", []):
            try:
                _cg_date = _cg_txn["date"]
                if int(_cg_date.split("-")[0]) != _yr:
                    continue
                _cg_m = int(_cg_date.split("-")[1])
                _cg_q = next(q for q, ms in _IRS_QM_CG.items() if _cg_m in ms)
                # Use the per-lot stcg/ltcg split so a sell with both short-
                # and long-term lots is taxed correctly at each respective rate.
                _stcg = float(_cg_txn.get("stcg", 0.0))
                _ltcg = float(_cg_txn.get("ltcg", 0.0))
                if _stcg != 0:
                    _stcg_by_q[_cg_q]   += _stcg
                    if _stcg > 0:
                        _stcg_gain_by_q[_cg_q] += _stcg
                    else:
                        _stcg_loss_by_q[_cg_q] += _stcg
                if _ltcg != 0:
                    _cg_tax_by_q[_cg_q] += _ltcg * (_ltcg_eff_rate + _niit_on_ltcg)
                    _ltcg_by_q[_cg_q]   += _ltcg
                    if _ltcg > 0:
                        _ltcg_gain_by_q[_cg_q] += _ltcg
                    else:
                        _ltcg_loss_by_q[_cg_q] += _ltcg
            except Exception:
                pass
        _total_cg_tax_ytd = sum(_cg_tax_by_q.values())

        # ── Q4 prior-year CG tax (Oct–Dec of prev year; due Jan 15 of current year) ──
        _prev_q4_stcg = float(realized_gains_history.get("prev_q4_stcg", 0.0))
        _prev_q4_ltcg = float(realized_gains_history.get("prev_q4_ltcg", 0.0))
        # Q4 prior year: use actual Schwab transactions if available (Schwab pulls Q4 prior yr)
        if _prev_q4_has_actual:
            _prev_q4_ord  = round(_prev_q4_actual_ord,  0)
            _prev_q4_qual = round(_prev_q4_actual_qual, 0)
            _prev_q4_div_estimated = False
        else:
            # Fallback: estimate from current portfolio (portfolio composition may differ)
            _prev_q4_ord  = round(total_ordinary_div / 4, 0)
            _prev_q4_qual = round(total_qualified_div / 4, 0)
            _prev_q4_div_estimated = True
        _prev_q4_div_income = _prev_q4_ord + _prev_q4_qual

        # This card's income (div/STCG/LTCG amounts) is that quarter's real actuals,
        # but the TAX on it depends on where it landed in *that year's* bracket —
        # which needs that year's own W2/std-deduction/cumulative-income stack, not
        # this year's. We don't reload a full prior year of Schwab history to
        # reconstruct that (only Oct–Dec of last year is ever pulled), so instead we
        # cache the properly-stacked Q4 figures every year right when they're computed
        # as *this* year's Q4 (below) — by the time Q4 rotates into being "prior
        # year" next January, this lookup finds that cached, correctly-stacked value
        # instead of falling back to a flat-rate approximation using the wrong year's
        # marginal rate.
        _prev_q4_cache_key = f"tax_q4_snapshot_{_yr - 1}"
        _prev_q4_cached     = None
        try:
            _prev_q4_cached = _dbm.cache_get(_prev_q4_cache_key)
        except Exception:
            _prev_q4_cached = None

        if isinstance(_prev_q4_cached, dict) and _prev_q4_cached.get("div_tax") is not None:
            _prev_q4_div_tax = round(float(_prev_q4_cached.get("div_tax", 0)), 0)
            _prev_q4_cg_tax  = round(float(_prev_q4_cached.get("cg_tax",  0)), 0)
            _prev_q4_payment = round(_prev_q4_div_tax + _prev_q4_cg_tax, 0)
        else:
            # No cached snapshot for that year (e.g. this feature didn't exist yet,
            # or the cache was cleared) — fall back to the flat-rate approximation.
            _prev_q4_cg_tax = round(
                _prev_q4_stcg * (_mr + _niit_on_ltcg) +
                _prev_q4_ltcg * (_ltcg_eff_rate + _niit_on_ltcg),
                0,
            )
            _prev_q4_div_tax = round(
                _prev_q4_ord  * (_mr + _niit_on_div) +
                _prev_q4_qual * (qualified_div_rate + _niit_on_div), 0
            )
            _prev_q4_payment = round(_prev_q4_div_tax + _prev_q4_cg_tax, 0)

        # ── Ordinary-bracket waterfall, applied cumulatively quarter by quarter ──
        # Mirrors the annual W2 → dividends → STCG → conversion attribution above
        # (tax_div_only / tax_stcg_add / tax_conv_add), re-run at each quarter's
        # cumulative checkpoint via the same telescoping technique a prior version
        # of this code already used for conversion tax alone (a prior-prior version
        # dumped the ENTIRE YTD conversion tax onto whichever quarter the FIRST
        # conversion happened in, understating later quarters). This replaces
        # multiplying each quarter's dividends/STCG by a flat "current marginal
        # rate" — that taxed every dollar as if it were the LAST dollar earned,
        # when only the incremental amount above prior quarters' cumulative income
        # actually sits at that rate. Only ACTUAL (not planned) conversions are
        # stacked in here, so quarterly figures aren't inflated by a conversion
        # that hasn't happened yet (same rule tax_conv_actual follows above).
        def _stack_tax(cum_div_ord, cum_div_qual, cum_stcg, cum_conv):
            _gross   = _annual_w2 + cum_div_ord + cum_div_qual + cum_stcg + cum_conv
            _taxable = max(0.0, _gross - std_deduction)
            _ord     = max(0.0, _taxable - cum_div_qual)
            _qual    = min(cum_div_qual, _taxable)
            return _calc_tax(_ord, brackets) + _qual * qualified_div_rate

        _has_actual_conv = bool(ytd_conversions and ytd_converted_total > 0)

        _cum_div_ord    = 0.0
        _cum_div_qual   = 0.0
        _cum_stcg_stack = 0.0
        _cum_conv_stack = 0.0
        _stack_running  = tax_w2_only

        _q_div_tax_store    = {}
        _q_div_detail_store = {}   # {q: (ordinary, qualified)} for output
        _q_conv_tax_store   = {}
        for _q in range(1, 5):
            _q_ord, _q_qual, _ = _q_detail(_q)
            _q_div_detail_store[_q] = (_q_ord, _q_qual)

            # Step 1: this quarter's dividends, on top of everything before it
            _cum_div_ord  += _q_ord
            _cum_div_qual += _q_qual
            _after_div = _stack_tax(_cum_div_ord, _cum_div_qual, _cum_stcg_stack, _cum_conv_stack)
            _div_tax_bracket, _stack_running = _after_div - _stack_running, _after_div

            # Step 2: this quarter's net STCG (gains net of any TLH), on top of that
            _cum_stcg_stack += _stcg_by_q[_q]
            _after_stcg = _stack_tax(_cum_div_ord, _cum_div_qual, _cum_stcg_stack, _cum_conv_stack)
            _stcg_tax_bracket, _stack_running = _after_stcg - _stack_running, _after_stcg

            # Step 3: this quarter's actual conversion, on top of that
            _q_actual_conv = _q_conv(_q) if _has_actual_conv else 0.0
            _cum_conv_stack += _q_actual_conv
            _after_conv = _stack_tax(_cum_div_ord, _cum_div_qual, _cum_stcg_stack, _cum_conv_stack)
            _conv_tax_bracket, _stack_running = _after_conv - _stack_running, _after_conv

            # NIIT — additive surtax on dividends/STCG only (never W2 or conversions),
            # same apportioned rate as the annual figure.
            _div_niit  = (_q_ord + _q_qual)   * _niit_on_div
            _stcg_niit = _stcg_by_q[_q]       * _niit_on_ltcg

            _q_div_tax_store[_q]  = round(_div_tax_bracket + _div_niit, 0)
            _cg_tax_by_q[_q]      = round(_cg_tax_by_q[_q] + _stcg_tax_bracket + _stcg_niit, 0)
            _q_conv_tax_store[_q] = round(_conv_tax_bracket, 0)

        if not _has_actual_conv:
            # No actual conversion executed yet — planned-only, keep the full
            # estimated tax on the planned conversion month's quarter (matches
            # tax_conv_actual, which falls back to tax_conv_add in this case).
            _q_conv_tax_store = {_q: (round(tax_conv_actual, 0) if _q == conv_quarter else 0.0) for _q in range(1, 5)}

        # ── Per-quarter payment total ─────────────────────────────────────────
        for _q in range(1, 5):
            q_payments_calc[_q] = _q_div_tax_store[_q] + _q_conv_tax_store[_q] + round(_cg_tax_by_q[_q], 0)

        # Snapshot this year's Q4 (properly bracket-stacked, computed above) so that
        # once the year rolls over and this quarter becomes "prior year Q4" on next
        # year's dashboard, it's read back verbatim instead of re-approximated with
        # next year's marginal rate (see the cache lookup earlier in this function).
        # Re-saved on every refresh through year-end so the final save reflects
        # Q4's fully-actualized (not partly-projected) numbers.
        try:
            _dbm.cache_set(f"tax_q4_snapshot_{_yr}", {
                "div_tax": _q_div_tax_store[4],
                "cg_tax":  round(_cg_tax_by_q[4], 0),
            })
        except Exception:
            pass

        _prev_yr  = _yr - 1
        _d_q4prev = _irs_due(_yr,     1, 15)
        _d_q1     = _irs_due(_yr,     4, 15)
        _d_q2     = _irs_due(_yr,     6, 15)
        _d_q3     = _irs_due(_yr,     9, 15)
        _d_q4     = _irs_due(_yr + 1, 1, 15)

        def _fmt_due(iso):
            from datetime import date as _dd
            d = _dd.fromisoformat(iso)
            return d.strftime("%b %-d, %Y")

        quarterly_payments = [
            # Q4 of PRIOR year — income Oct–Dec prev year, tax due Jan 15 current year
            {"quarter": f"Q4 {_prev_yr}", "period": f"Oct–Dec {_prev_yr}",
             "due_date": _d_q4prev, "due_label": _fmt_due(_d_q4prev),
             "div_income":           _prev_q4_div_income,
             "div_income_ordinary":  _prev_q4_ord,
             "div_income_qualified": _prev_q4_qual,
             "div_income_estimated": _prev_q4_div_estimated,
             "div_tax":              _prev_q4_div_tax,
             "conv_portion": 0, "conv_tax": 0,
             "cap_gains_tax": _prev_q4_cg_tax,
             "stcg_realized": round(_prev_q4_stcg, 0),
             "stcg_gain":     round(_prev_q4_stcg, 0),
             "stcg_loss":     0,
             "ltcg_realized": round(_prev_q4_ltcg, 0),
             "ltcg_gain":     round(max(0.0, _prev_q4_ltcg), 0),
             "ltcg_loss":     round(min(0.0, _prev_q4_ltcg), 0),
             "is_conv_quarter": False,
             "payment": _prev_q4_payment, "days_until": _days_until(_d_q4prev)},
            {"quarter": f"Q1 {_yr}", "period": f"Jan–Mar {_yr}",
             "due_date": _d_q1, "due_label": _fmt_due(_d_q1),
             "div_income":           _q_income(1),
             "div_income_actual":    round(_q_actual_ord[1] + _q_actual_qual[1], 0),
             "div_income_projected": round(_q_income(1) - (_q_actual_ord[1] + _q_actual_qual[1]), 0),
             "div_income_ordinary":  _q_div_detail_store[1][0],
             "div_income_qualified": _q_div_detail_store[1][1],
             "div_tax":              _q_div_tax_store[1],
             "conv_portion": _q_conv(1), "conv_tax": _q_conv_tax_store[1],
             "cap_gains_tax": round(_cg_tax_by_q[1], 0),
             "stcg_realized": round(_stcg_by_q[1], 0),
             "stcg_gain":     round(_stcg_gain_by_q[1], 0),
             "stcg_loss":     round(_stcg_loss_by_q[1], 0),
             "ltcg_realized": round(_ltcg_by_q[1], 0),
             "ltcg_gain":     round(_ltcg_gain_by_q[1], 0),
             "ltcg_loss":     round(_ltcg_loss_by_q[1], 0),
             "is_conv_quarter": conv_quarter == 1,
             "payment": q_payments_calc[1], "days_until": _days_until(_d_q1)},
            {"quarter": f"Q2 {_yr}", "period": f"Apr–May {_yr}",
             "due_date": _d_q2, "due_label": _fmt_due(_d_q2),
             "div_income":           _q_income(2),
             "div_income_actual":    round(_q_actual_ord[2] + _q_actual_qual[2], 0),
             "div_income_projected": round(_q_income(2) - (_q_actual_ord[2] + _q_actual_qual[2]), 0),
             "div_income_ordinary":  _q_div_detail_store[2][0],
             "div_income_qualified": _q_div_detail_store[2][1],
             "div_tax":              _q_div_tax_store[2],
             "conv_portion": _q_conv(2), "conv_tax": _q_conv_tax_store[2],
             "cap_gains_tax": round(_cg_tax_by_q[2], 0),
             "stcg_realized": round(_stcg_by_q[2], 0),
             "stcg_gain":     round(_stcg_gain_by_q[2], 0),
             "stcg_loss":     round(_stcg_loss_by_q[2], 0),
             "ltcg_realized": round(_ltcg_by_q[2], 0),
             "ltcg_gain":     round(_ltcg_gain_by_q[2], 0),
             "ltcg_loss":     round(_ltcg_loss_by_q[2], 0),
             "is_conv_quarter": conv_quarter == 2,
             "payment": q_payments_calc[2], "days_until": _days_until(_d_q2)},
            {"quarter": f"Q3 {_yr}", "period": f"Jun–Aug {_yr}",
             "due_date": _d_q3, "due_label": _fmt_due(_d_q3),
             "div_income":           _q_income(3),
             "div_income_actual":    round(_q_actual_ord[3] + _q_actual_qual[3], 0),
             "div_income_projected": round(_q_income(3) - (_q_actual_ord[3] + _q_actual_qual[3]), 0),
             "div_income_ordinary":  _q_div_detail_store[3][0],
             "div_income_qualified": _q_div_detail_store[3][1],
             "div_tax":              _q_div_tax_store[3],
             "conv_portion": _q_conv(3), "conv_tax": _q_conv_tax_store[3],
             "cap_gains_tax": round(_cg_tax_by_q[3], 0),
             "stcg_realized": round(_stcg_by_q[3], 0),
             "stcg_gain":     round(_stcg_gain_by_q[3], 0),
             "stcg_loss":     round(_stcg_loss_by_q[3], 0),
             "ltcg_realized": round(_ltcg_by_q[3], 0),
             "ltcg_gain":     round(_ltcg_gain_by_q[3], 0),
             "ltcg_loss":     round(_ltcg_loss_by_q[3], 0),
             "is_conv_quarter": conv_quarter == 3,
             "payment": q_payments_calc[3], "days_until": _days_until(_d_q3)},
            {"quarter": f"Q4 {_yr}", "period": f"Sep–Dec {_yr}",
             "due_date": _d_q4, "due_label": _fmt_due(_d_q4),
             "div_income":           _q_income(4),
             "div_income_actual":    round(_q_actual_ord[4] + _q_actual_qual[4], 0),
             "div_income_projected": round(_q_income(4) - (_q_actual_ord[4] + _q_actual_qual[4]), 0),
             "div_income_ordinary":  _q_div_detail_store[4][0],
             "div_income_qualified": _q_div_detail_store[4][1],
             "div_tax":              _q_div_tax_store[4],
             "conv_portion": _q_conv(4), "conv_tax": _q_conv_tax_store[4],
             "cap_gains_tax": round(_cg_tax_by_q[4], 0),
             "stcg_realized": round(_stcg_by_q[4], 0),
             "stcg_gain":     round(_stcg_gain_by_q[4], 0),
             "stcg_loss":     round(_stcg_loss_by_q[4], 0),
             "ltcg_realized": round(_ltcg_by_q[4], 0),
             "ltcg_gain":     round(_ltcg_gain_by_q[4], 0),
             "ltcg_loss":     round(_ltcg_loss_by_q[4], 0),
             "is_conv_quarter": conv_quarter == 4,
             "payment": q_payments_calc[4], "days_until": _days_until(_d_q4)},
        ]

        # ── Safe Harbor Test (IRS 110% rule) ──────────────────────────────────
        # For AGI > $150K (MFJ), safe harbor = 110% of prior year's tax liability,
        # paid in equal quarterly installments.
        # W2 withholding counts toward the requirement — enter YTD amount in config.
        _prior_year_tax    = float(_tax_settings_tx.get("prior_year_tax", 0))
        _w2_withholding    = float(_tax_settings_tx.get("w2_withholding_ytd", 0))
        _safe_harbor_rate  = 1.10   # 110% rule applies since AGI > $150K
        _safe_harbor_total = round(_prior_year_tax * _safe_harbor_rate, 0) if _prior_year_tax > 0 else None
        _safe_harbor_qtrly = round(_safe_harbor_total / 4, 0) if _safe_harbor_total else None
        # Quarters whose due date has already passed (i.e. the user should have paid them)
        _curr_quarter      = _q_for_month(_curr_month)
        _due_dates         = {1: _d_q1, 2: _d_q2, 3: _d_q3, 4: _d_q4}
        _quarters_past_due = sum(
            1 for q in range(1, 5)
            if _today_date.isoformat() > _due_dates[q]
        )
        _safe_harbor_required_ytd = round(_safe_harbor_qtrly * _quarters_past_due, 0) if _safe_harbor_qtrly else None
        # Current year payments = projected quarterly estimated payments + W2 withholding
        _safe_harbor_est_payments = round(sum(
            q_payments_calc[q] for q in range(1, 5)
            if _today_date.isoformat() > _due_dates[q]
        ), 0)
        _safe_harbor_paid_ytd = round(_safe_harbor_est_payments + _w2_withholding, 0) if _quarters_past_due > 0 else None
        # Safe harbor met = ytd projected payments >= required ytd installments
        _safe_harbor_met: bool | None = None
        _safe_harbor_gap: float | None = None
        if _safe_harbor_required_ytd is not None and _quarters_past_due > 0:
            _safe_harbor_gap = (_safe_harbor_paid_ytd or 0) - _safe_harbor_required_ytd
            _safe_harbor_met = _safe_harbor_gap >= 0
        elif _safe_harbor_total is None:
            _safe_harbor_met = None   # prior_year_tax not configured

        # ── Conversion alert / done detection ─────────────────────────────────
        # Cache the pre-conversion rollover balance (updated every month except the
        # conversion month, so we have a clean baseline to compare against).
        _conv_cache = _dbm.cache_get("conversion") or {}

        # Reset cache each new year
        if _conv_cache.get("year") != _yr:
            _conv_cache = {}

        # Update cache with current balance when we're NOT in the conversion month
        # (or we haven't stored it yet for this year)
        if _curr_month != conversion_month:
            # Always update if balance is higher (market gains) to keep baseline fresh
            _cached_bal = _conv_cache.get("pre_conversion_balance", 0.0)
            if rollover_balance > 0 and (not _conv_cache or rollover_balance > _cached_bal):
                _conv_cache = {
                    "year":                   _yr,
                    "pre_conversion_balance": round(rollover_balance, 2),
                    "updated":                str(_today_date),
                }
                try:
                    _dbm.cache_set("conversion", _conv_cache)
                except Exception:
                    pass

        pre_conv_balance = _conv_cache.get("pre_conversion_balance", rollover_balance)

        # Conversion done heuristic: live balance has dropped by ≥80% of annual_conv
        # OR actual conversions tracked from transaction history ≥80% of annual_conv
        _balance_drop = pre_conv_balance - rollover_balance
        _tx_based_done = ytd_converted_total >= annual_conv * 0.80 if ytd_converted_total else False
        conversion_done_likely = (_balance_drop >= annual_conv * 0.80) or _tx_based_done

        # Alert: active in the 2 months leading up to conversion month, and IN the month
        # Goes away once conversion is detected as done (by balance OR transactions)
        _months_until_conv = (conversion_month - _curr_month) % 12
        conversion_alert = (not conversion_done_likely) and (_months_until_conv <= 1)
        conversion_imminent = (_curr_month == conversion_month) and (not _tx_based_done)

        _collect_medicare = bool(personal_cfg.get("collect_medicare", True))

        # ── Withdrawal strategy: ratio thresholds → effective dollar thresholds ──
        _ws_cfg       = cfg.get("_WITHDRAWAL_STRATEGY", {})
        _ws_ab_ratio  = float(_ws_cfg.get("state_ab_gain_ratio", 0.30))
        _ws_bc_ratio  = float(_ws_cfg.get("state_bc_gain_ratio", 0.45))
        _ws_ab_thresh = int(grand_total_value * _ws_ab_ratio) if grand_total_value > 0 else 1_000_000
        _ws_bc_thresh = int(grand_total_value * _ws_bc_ratio) if grand_total_value > 0 else 1_500_000

        # ── State machine: compute all ratios used by transition_logic ────────
        # gain_ratio: unrealized gain / total market value
        _sm_gain_ratio = round(grand_pnl / grand_total_value, 4) if grand_total_value > 0 else 0.0

        # forced_income_ratio: (dividends + SS + RMD) / desired_spending
        # Numerator = forward 12-month portfolio income + Social Security annual
        _sm_fwd12m           = income_analytics.get("portfolio_fwd_12m", 0.0) or 0.0
        _sm_ss_annual        = ss_annual  # already computed above
        _sm_forced_income_num = _sm_fwd12m + _sm_ss_annual
        # Desired spending: prefer actual tracked spending, fall back to personal.json estimate
        _sm_desired_spend     = float(_si_spend) if (_si_available and _si_spend and _si_spend > 0) else \
                                float(personal_cfg.get("estimated_spending", 0))
        _sm_forced_income_ratio = round(_sm_forced_income_num / _sm_desired_spend, 4) \
                                  if _sm_desired_spend > 0 else None

        # controlled_sale_ratio: realized cap gains ACTUALLY needed to cover a
        # spending shortfall / desired_spending. Capped at the income gap
        # (desired_spend − forced_income_num) so gains realized for other
        # reasons — rebalancing, Roth conversion funding — aren't miscounted
        # as sales that funded spending. Losses (negative gains) pass through
        # uncapped since they can't overstate sale-funded spending.
        _sm_spending_gap = max(0.0, _sm_desired_spend - _sm_forced_income_num) if _sm_desired_spend > 0 else 0.0
        _sm_ytd_gains = _ytd_stcg_realized + _ytd_ltcg_realized
        _sm_ytd_gains_for_spending = min(_sm_ytd_gains, _sm_spending_gap) if _sm_ytd_gains > 0 else _sm_ytd_gains
        _sm_ctrl_sale_ratio = round(_sm_ytd_gains_for_spending / _sm_desired_spend, 4) \
                              if _sm_desired_spend > 0 else 0.0

        # concentration_ratio: top holding weight — reuses the same single-theme
        # watch/action thresholds as the Risk tab's concentration status (below),
        # computed here so it can also gate state transitions. Rationale: heavy
        # concentration means active trimming is needed regardless of income
        # coverage, which is exactly the behavior States B/C are meant to enable.
        _conc_cfg   = cfg.get("_CONCENTRATION_RULES", {})
        _st_cfg     = _conc_cfg.get("single_theme", {})
        _st_watch   = float(_st_cfg.get("watch",    0.35))
        _st_action  = float(_st_cfg.get("action",   0.50))
        _st_critical= float(_st_cfg.get("critical", 0.60))
        _sm_conc_ratio = float(portfolio_intel.get("top_holding_pct", 0.0)) / 100.0

        # stcg_ratio: short-term unrealized gain / total unrealized gain
        _sm_stcg_unrealized = _cost_basis_analysis.get("total_stcg_unrealized_gain") or 0.0
        _sm_total_unrealized = grand_pnl if grand_pnl > 0 else 0.0
        _sm_stcg_ratio = round(_sm_stcg_unrealized / _sm_total_unrealized, 4) \
                         if _sm_total_unrealized > 0 else 0.0

        # ── ANY_TWO transition evaluator ─────────────────────────────────────
        _ws_tl = _ws_cfg.get("transition_logic", {})

        def _eval_any_two(conditions_met: list) -> bool:
            return sum(conditions_met) >= 2

        # A→B conditions — concentration gate uses the Risk tab's own WATCH
        # threshold (_st_watch), so a portfolio that already needs active
        # trimming counts toward the softer A→B transition.
        _ab_tl       = _ws_tl.get("A_to_B", {})
        _ab_gain_ok  = _sm_gain_ratio >= float(_ab_tl.get("gain_ratio", 0.30))
        _ab_fi_thresh = float(_ab_tl.get("forced_income_ratio", 1.20))
        _ab_fi_ok    = (_sm_forced_income_ratio is not None and
                        _sm_forced_income_ratio >= _ab_fi_thresh)
        _ab_conc_ok  = _sm_conc_ratio >= _st_watch
        _ab_triggered = _eval_any_two([_ab_gain_ok, _ab_fi_ok, _ab_conc_ok])

        # B→C conditions — concentration gate uses the stricter ACTION
        # threshold (_st_action), so only meaningfully-severe concentration
        # counts toward the more aggressive B→C transition.
        _bc_tl        = _ws_tl.get("B_to_C", {})
        _bc_gain_ok   = _sm_gain_ratio >= float(_bc_tl.get("gain_ratio", 0.45))
        _bc_fi_thresh = float(_bc_tl.get("forced_income_ratio", 1.60))
        _bc_fi_ok     = (_sm_forced_income_ratio is not None and
                         _sm_forced_income_ratio >= _bc_fi_thresh)
        _bc_cs_thresh = float(_bc_tl.get("controlled_sale_ratio", 0.50))
        _bc_cs_ok     = _sm_ctrl_sale_ratio >= _bc_cs_thresh
        _bc_conc_ok   = _sm_conc_ratio >= _st_action
        _bc_triggered = _eval_any_two([_bc_gain_ok, _bc_fi_ok, _bc_cs_ok, _bc_conc_ok])

        # Current state: start at A, escalate if triggered
        if _bc_triggered:
            _sm_current_state = "C"
        elif _ab_triggered:
            _sm_current_state = "B"
        else:
            _sm_current_state = "A"

        # Condition breakdown for UI display
        _sm_conditions = {
            "A_to_B": {
                "triggered":    _ab_triggered,
                "gain_ratio":   {"value": _sm_gain_ratio,          "threshold": float(_ab_tl.get("gain_ratio", 0.30)),          "met": _ab_gain_ok},
                "forced_income_ratio": {"value": _sm_forced_income_ratio, "threshold": _ab_fi_thresh, "met": _ab_fi_ok,
                                        "available": _sm_forced_income_ratio is not None},
                "concentration_ratio": {"value": _sm_conc_ratio, "threshold": _st_watch, "met": _ab_conc_ok},
            },
            "B_to_C": {
                "triggered":    _bc_triggered,
                "gain_ratio":   {"value": _sm_gain_ratio,          "threshold": float(_bc_tl.get("gain_ratio", 0.45)),          "met": _bc_gain_ok},
                "forced_income_ratio": {"value": _sm_forced_income_ratio, "threshold": _bc_fi_thresh, "met": _bc_fi_ok,
                                        "available": _sm_forced_income_ratio is not None},
                "controlled_sale_ratio": {"value": _sm_ctrl_sale_ratio, "threshold": _bc_cs_thresh, "met": _bc_cs_ok},
                "concentration_ratio": {"value": _sm_conc_ratio, "threshold": _st_action, "met": _bc_conc_ok},
            },
        }

        # ── Gain maturity status ──────────────────────────────────────────────
        _gm_cfg = cfg.get("_GAIN_MATURITY", {})
        _gm_watch  = float(_gm_cfg.get("stcg_ratio_watch",              0.20))
        _gm_alert  = float(_gm_cfg.get("stcg_ratio_alert",              0.35))
        _gm_freeze = float(_gm_cfg.get("freeze_rebalance_if_stcg_above",0.40))
        if _sm_stcg_ratio >= _gm_freeze:
            _gm_status, _freeze_rebalance = "FREEZE", True
        elif _sm_stcg_ratio >= _gm_alert:
            _gm_status, _freeze_rebalance = "ALERT", False
        elif _sm_stcg_ratio >= _gm_watch:
            _gm_status, _freeze_rebalance = "WATCH", False
        else:
            _gm_status, _freeze_rebalance = "OK", False

        # ── Forced income status ──────────────────────────────────────────────
        _fi_cfg     = cfg.get("_FORCED_INCOME", {})
        _fi_watch   = float(_fi_cfg.get("watch_ratio",    0.80))
        _fi_action  = float(_fi_cfg.get("action_ratio",   1.20))
        _fi_critical= float(_fi_cfg.get("critical_ratio", 1.60))
        if _sm_forced_income_ratio is None:
            _fi_status = None
        elif _sm_forced_income_ratio >= _fi_critical:
            _fi_status = "CRITICAL"
        elif _sm_forced_income_ratio >= _fi_action:
            _fi_status = "ACTION"
        elif _sm_forced_income_ratio >= _fi_watch:
            _fi_status = "WATCH"
        else:
            _fi_status = "OK"

        # ── Concentration status (single-theme = top holding as proxy) ────────
        # _conc_cfg/_st_watch/_st_action/_st_critical/_top_holding_pct (as
        # _sm_conc_ratio) were already computed above for the state machine —
        # reused here so the Risk tab's status and the state machine's
        # concentration gate can never drift out of sync.
        _top_holding_pct = _sm_conc_ratio
        if _top_holding_pct >= _st_critical:
            _conc_status = "CRITICAL"
        elif _top_holding_pct >= _st_action:
            _conc_status = "ACTION"
        elif _top_holding_pct >= _st_watch:
            _conc_status = "WATCH"
        else:
            _conc_status = "OK"
        _conc_rules_raw   = _conc_cfg.get("rules", {})
        _conc_freeze_buys = _conc_rules_raw.get("freeze_new_buys_at_action",      True) and _conc_status in ("ACTION", "CRITICAL")
        _conc_must_trim   = _conc_rules_raw.get("mandatory_trim_at_critical",     True) and _conc_status == "CRITICAL"
        _conc_redir_divs  = _conc_rules_raw.get("redirect_dividends_when_action", True) and _conc_status in ("ACTION", "CRITICAL")

        tax_data = {
            "name":                 personal_name,
            "filing_status":        filing,
            "collect_medicare":     _collect_medicare,
            "dob":                  dob_str,
            "retirement_year":      retirement_year or None,
            "current_age":          round(current_age, 1) if current_age else None,
            "spouse_name":          spouse_name,
            "spouse_dob":           spouse_dob_str,
            "spouse_age":           round(spouse_age, 1) if spouse_age else None,
            "spouse_ss_start_age":  spouse_ss_start,
            # ── Spending-aware tax metrics (from transactions.csv) ──────────
            "spending_true_annual":   _si_spend      if _si_available else None,
            "spending_recent_12":     _si_recent     if _si_available else None,
            "spending_prior_12":      _si_prior,
            "spending_drift_pct":     _si_drift,
            "estimated_spending":     float(personal_cfg.get("estimated_spending", 0)) or None,
            "withdrawal_need_actual": round(_withdrawal_need)   if _withdrawal_need   is not None else None,
            "income_surplus":         round(_income_surplus)    if _income_surplus    is not None else None,
            "agi_real":               round(_agi_real)          if _agi_real          is not None else None,
            "conv_room_real":         round(_conv_room_real)    if _conv_room_real    is not None else None,
            "bracket_pressure_real":  _bp_real,
            "spending_quarterly":     _si.get("recent_quarters", []) if _si_available else [],
            "spending_calendar_years":_si.get("calendar_years",  []) if _si_available else [],
            "spending_data_months":   (_si.get("date_range") or {}).get("months"),
            "spending_data_start":    (_si.get("date_range") or {}).get("start"),
            "spending_data_end":      (_si.get("date_range") or {}).get("end"),
            "ss_start_age":           ss_start_age,
            "ss_options":           ss_options,
            "ss_chosen":            ss_chosen,
            "ss_annual":            ss_annual,
            "ss_start_date":        ss_start_date,
            "ss_years_until":       _ss_years_until,
            "ss_months_until":      _ss_months_until,
            "std_deduction":        std_deduction,
            "annual_div_total":     round(annual_div_total, 0),
            "div_tax_breakdown":    _div_tax_detail,
            "total_ordinary_div":   round(total_ordinary_div, 0),
            "total_qualified_div":  round(total_qualified_div, 0),
            "total_roc_div":        round(total_roc_div, 0),
            "annual_div_for_agi":   round(annual_div_for_agi, 0),
            "qualified_div_rate":   round(qualified_div_rate * 100, 0),
            "roc_display":          round(_roc_display, 0),
            "annual_div_by_ticker": {k: round(v, 0) for k, v in annual_div_by_ticker.items()},
            "monthly_div_totals":   [round(v, 2) for v in monthly_totals],
            "cal_months":           cal_months,
            "taxable_div_calendar": taxable_cal,
            "annual_conversion":    annual_conv,
            "annual_conversion_recommended": annual_conversion_recommended,
            "annual_conversion_breakdown":   annual_conversion_breakdown,
            "brackets":             brackets,
            # No-SS scenario
            "gross_no_ss":          round(gross_no_ss, 0),
            "taxable_no_ss":        round(taxable_no_ss, 0),
            # Actual-based income (ytd conversions only, no plan-target inflation) — for display
            "gross_actual":         round(_gross_actual, 0),
            "taxable_actual":       round(_taxable_actual, 0),
            "tax_no_ss":            round(tax_no_ss, 0),
            "annual_w2":            round(_annual_w2, 0),
            "tax_w2_only":          round(tax_w2_only, 0),
            "tax_div_only":         round(tax_div_only, 0),
            "tax_stcg_add":         round(tax_stcg_add, 0),
            "tax_conv_add":         round(tax_conv_add, 0),
            # Marginal tax on the YTD-ACTUAL conversion only (not the full annual plan
            # target) — use this, not tax_conv_add, anywhere the denominator is also
            # YTD-actual (e.g. converted_ytd), or the resulting "effective rate" mixes
            # a full-year-plan numerator with a YTD-actual denominator.
            "tax_conv_actual":      round(tax_conv_actual, 0),
            "tax_ltcg":             round(tax_ltcg, 0),
            "total_tax_with_cg":    round(total_tax_with_cg, 0),
            "eff_rate_no_ss":       round(eff_no_ss * 100, 2),
            "breakdown_no_ss":      breakdown_no_ss,
            "marginal_rate":        marginal_rate,
            "headroom":             round(headroom, 0),
            "optimal_conv":         round(optimal_conv, 0) if optimal_conv else None,
            # SS scenario
            "ss_taxable_pct":       ss_tax_pct,
            "ss_taxable_amt":       round(ss_taxable_amt, 0),
            "gross_with_ss":        round(gross_with_ss, 0),
            "taxable_with_ss":      round(taxable_with_ss, 0),
            "tax_with_ss":          round(tax_with_ss, 0),
            "eff_rate_with_ss":     round(eff_with_ss * 100, 2),
            "breakdown_with_ss":    breakdown_with_ss,
            # True ordinary-rate income for the WITH-SS scenario (qualified div excluded) —
            # this is what actually fills breakdown_with_ss's brackets. Same relationship as
            # ordinary_rate_taxable_income vs ordinary_taxable_income for the no-SS scenario —
            # exposed so this scenario's bracket table doesn't get compared against the
            # NO-SS scenario's taxable income (different base: this includes SS income).
            "ordinary_rate_taxable_income_with_ss": round(_ord_taxable_b, 0),
            # Projections
            "projections":          projections,
            # Quarterly estimated tax reminders
            "quarterly_payments":        quarterly_payments,
            "quarterly_safe_harbor":     round(total_tax_with_cg / 4, 0),  # equal-split including cap gains
            # ── Safe Harbor (110% prior-year test) ──
            "safe_harbor_met":            _safe_harbor_met,
            "safe_harbor_prior_year_tax": round(_prior_year_tax, 0) if _prior_year_tax > 0 else None,
            "safe_harbor_required_total": _safe_harbor_total,
            "safe_harbor_required_ytd":   _safe_harbor_required_ytd,
            "safe_harbor_paid_ytd":       _safe_harbor_paid_ytd,
            "safe_harbor_w2_withholding": round(_w2_withholding, 0) if _w2_withholding > 0 else None,
            "safe_harbor_gap":            _safe_harbor_gap,
            "conversion_month":          conversion_month,
            "conversion_month_name":     conv_month_name,
            "conv_quarter":              conv_quarter,
            "conversion_alert":          conversion_alert,
            "conversion_imminent":       conversion_imminent,
            # conversion_done_likely is set lower in this same dict literal with
            # the additional `ytd_converted_total >= 80% of annual_conv` heuristic.
            "pre_conv_balance":          round(pre_conv_balance, 0),
            "balance_drop":              round(_balance_drop, 0),
            # Rollover conversion plan (live positions)
            "rollover_balance":     round(rollover_balance, 0),
            "rollover_conv_plan":   rollover_conv_plan,
            # Projection metadata
            "proj_roth_start":      round(_proj_roth_start, 0),
            "proj_rollover_start":  round(_proj_rollover_start, 0),
            "proj_growth_rate":     round(_growth_rate * 100, 1),
            "proj_div_growth_rate": round(_div_growth_rate * 100, 1),
            # Bracket pressure (projected AGI as % of ceiling) + trend
            "bracket_pressure_pct":         _bracket_pressure_pct,
            "bracket_pressure_trend":       _bracket_pressure_trend,
            "bracket_pressure_trend_color": _bracket_pressure_trend_color,
            # Analytical scores
            "conv_efficiency_score": conv_efficiency_score,
            "income_tax_score":      income_tax_score,
            "seq_risk_score":        seq_risk_score,
            # Weighted Conversion Score (0–10)
            "conv_score":            conv_score,
            "conv_action":           conv_action,
            "conv_action_icon":      conv_action_icon,
            "conv_score_components": _cs_components,
            # Expected YTD vs actual comparison
            "expected_ytd_total":       expected_ytd_total,
            "expected_ytd_by_symbol":   expected_ytd_by_symbol,
            "remaining_income_est":     remaining_income_this_year,
            # Dynamic conversion recommendation
            "full_year_agi_estimate":      _full_year_agi_est,
            "full_year_income_estimate":   round(_full_year_income_est, 0),
            "agi_ratio":                   round(_agi_ratio, 3),
            "target_bracket_ceiling":      round(_target_bracket_ceiling, 0) if _target_bracket_ceiling else None,
            "rmd_start_age":               int(_tre_cfg_tx.get("rmd_start_age", 75)),
            "years_to_rmd":                (round(_tre_cfg_tx.get("rmd_start_age", 75) - current_age, 1)
                                             if current_age is not None else None),
            "rollover_balance_at_rmd_age": round(_rollover_at_rmd_age, 0) if _rollover_at_rmd_age is not None else None,
            "estimated_first_year_rmd":    estimated_first_year_rmd,
            "estimated_rmd_tax":           estimated_rmd_tax,
            "survivor_bracket_projection": survivor_bracket_projection,
            "target_bracket_rate":         _target_rate_tx_pct,
            # ── NIIT ────────────────────────────────────────────────────────
            "niit_applies":                _niit_applies,
            "niit_amount":                 _niit_amount,
            "niit_threshold":              _niit_threshold,
            "niit_headroom":               round(_niit_headroom, 0),
            "niit_rate":                   _niit_rate,
            # ── IRMAA ────────────────────────────────────────────────────────
            "magi":                        round(_magi, 0),
            "irmaa_tier_idx":              _irmaa_tier_idx,
            "irmaa_tier_label":            _irmaa_tier_label,
            "irmaa_part_b_monthly":        _irmaa_part_b_mo,
            "irmaa_part_d_monthly":        _irmaa_part_d_mo,
            "irmaa_monthly_per_person":    _irmaa_monthly_pp,
            "irmaa_annual":                _irmaa_annual,
            "irmaa_headroom":              _irmaa_headroom,
            "irmaa_next_threshold":        _irmaa_next_threshold,
            "medicare_people":             _medicare_people if _collect_medicare_now else None,
            # ── Dual-Pipeline Conversion Engine ─────────────────────────────
            # Pipeline A: Ordinary income bracket
            "ytd_ordinary_income":         round(_ytd_ordinary_income,    0),
            "remaining_ordinary_room":     round(_remaining_ordinary_room, 0),
            # Pipeline B: LTCG bracket — includes qualified dividends, since LTCG/QDI
            # bracket thresholds (0%/15%/20%) apply to TOTAL taxable income stacked
            # together (ordinary + qualified div + LTCG), per the IRS Qualified
            # Dividends and Capital Gain Tax Worksheet. Correct base for this purpose.
            "ordinary_taxable_income":     round(_ordinary_taxable_income, 0),
            # True ordinary-RATE income only (qualified div excluded) — this is what
            # actually fills the 10%-37% ordinary brackets in the Bracket Filling Engine
            # below. Will be LESS than ordinary_taxable_income by total_qualified_div,
            # since qualified divs are taxed at LTCG rates, not ordinary bracket rates.
            "ordinary_rate_taxable_income": round(_ord_taxable_a, 0),
            "ytd_ltcg_realized":           round(_ytd_ltcg_realized, 0) if _ytd_ltcg_realized is not None else None,
            "ytd_stcg_realized":           round(_ytd_stcg_realized, 0) if _ytd_stcg_realized is not None else None,
            "ytd_stcg_gross":              round(_ytd_stcg_gross,    0) if _ytd_stcg_gross else None,
            "ytd_stcg_loss":               round(_ytd_stcg_loss_amt, 0) if _ytd_stcg_loss_amt else None,
            "ytd_net_gain":                round(_ytd_net_gain,       0),
            "realized_gains_by_symbol":    _realized_by_symbol,
            "realized_gain_transactions":  realized_gains_history.get("transactions", []),
            "ltcg_rate":                   float(_tre_cfg_tx.get("ltcg_rate", 0.15)),
            "ytd_cap_gains_tax":           round(tax_stcg_add + tax_ltcg, 0),
            "prev_q4_ltcg":                round(float(realized_gains_history.get("prev_q4_ltcg", 0.0)), 0),
            "prev_q4_stcg":                round(float(realized_gains_history.get("prev_q4_stcg", 0.0)), 0),
            "ltcg_0pct_threshold":         _ltcg_0pct_threshold,
            "ltcg_15pct_threshold":        _ltcg_15pct_threshold,
            "ltcg_0pct_room":              round(_ltcg_0pct_room,  0) if _ltcg_0pct_room  is not None else None,
            "ltcg_15pct_room":             round(_ltcg_15pct_room, 0) if _ltcg_15pct_room is not None else None,
            # Taxable unrealized gains
            "taxable_unrealized_gains":    _taxable_unrealized_total,
            "taxable_unrealized_losses":   _taxable_unrealized_losses,
            "taxable_unrealized_by_symbol": _taxable_unrealized,
            # ── Lot-Level LTCG/STCG Analysis ─────────────────────────────────
            # Per-lot acquired dates (from DB) determine ST vs LT
            "cost_basis_lots":             _cost_basis_analysis.get("by_symbol",                  {}),
            "ltcg_maturity_calendar":      _cost_basis_analysis.get("maturity_calendar",           []),
            "total_stcg_unrealized_gain":  _cost_basis_analysis.get("total_stcg_unrealized_gain", None),
            "total_ltcg_unrealized_gain":  _cost_basis_analysis.get("total_ltcg_unrealized_gain", None),
            "total_stcg_unrealized_loss":  _cost_basis_analysis.get("total_stcg_unrealized_loss", None),
            "total_ltcg_unrealized_loss":  _cost_basis_analysis.get("total_ltcg_unrealized_loss", None),
            # ── Tax Rule Engine ──────────────────────────────────────────────
            "income_bracket_target":       round(_income_brk_tgt, 0),
            "bracket_room":                round(_brk_room, 0),
            "bracket_pace_pct":            round(_brk_pace * 100, 1),
            "bracket_status":              _brk_status,
            "bracket_status_msg":          _brk_msg,
            "bracket_status_color":        _brk_color,
            "soft_limit":                  round(_tre_soft_limit, 0),
            "soft_limit_room":             round(_sl_room, 0),
            "soft_limit_pace_pct":         round(_sl_pace * 100, 1),
            "soft_limit_status":           _sl_status,
            "final_bracket_status":        _final_brk_status,
            "final_bracket_msg":           _final_brk_msg,
            "final_bracket_color":         _final_brk_color,
            # ── Execute Conversion Target (set-and-run) ──
            "exec_conv_target":            round(exec_conv_target, 0),
            "safety_buffer":               round(_safety_buffer, 0),
            "income_received_pct":         round(_income_received_pct, 1),
            "income_received_actual":      round(_ytd_actual_taxable, 0),
            "income_received_projected":   round(_full_year_agi_est, 0),
            "income_confidence":           _income_confidence,
            "trigger_pct_threshold":       _trigger_pct_threshold,
            "trigger_met":                 _trigger_met,
            "pct_triggered":               _pct_triggered,
            "dec1_triggered":              _dec1_triggered,
            "days_to_dec1":                _days_to_dec1,
            "pre_q4_exec_estimate":        round(_pre_q4_exec, 0),
            # ── Rollover portfolio Q4 timing ──
            "rollover_from_high_pct":      round(_ro_avg_from_high * 100, 1) if _ro_price_total > 0 else None,
            "rollover_timing_sym":         _ro_top_sym,
            # ── Dynamic conversion recommendation ──
            "dynamic_conv_conservative":   round(dynamic_conv_conservative, 0),
            "dynamic_conv_recommended":    round(dynamic_conv_recommended, 0),
            "dynamic_conv_aggressive":     round(dynamic_conv_aggressive, 0),
            "dynamic_conv_factors":        dynamic_conv_factors,
            # ── YTD Conversion tracking ────────────────────────────────────────────
            "ytd_converted_total":         round(ytd_converted_total, 0),
            "ytd_converted_value":         round(ytd_converted_value, 0),
            "ytd_converted_shares":        round(ytd_converted_shares, 3),
            "ytd_conversions_detail":      ytd_conversions,
            "remaining_conv_target":         round(remaining_conv_target, 0),
            # UI-friendly aliases for dash_tab_tax display
            "converted_ytd":               round(ytd_converted_total, 0),
            "conversions_done_detail":     ytd_conversions,
            "remaining_to_convert":        round(remaining_conv_target, 0),
            "conversion_progress_pct":     round((ytd_converted_total / annual_conv * 100), 1) if annual_conv > 0 else 0,
            "conversion_done_likely":    conversion_done_likely or (ytd_converted_total >= annual_conv * 0.8),
            "rollover_conv_plan_adjusted": rollover_conv_plan_adjusted,
            # Rollover conversion plans
            "rollover_conv_plan_dynamic":  rollover_conv_plan_dynamic,
            # Scenario projections (3 arrays — selectable in UI)
            "projections_conservative":    projections,
            "projections_recommended":     projections_recommended,
            "projections_aggressive":      projections_aggressive,
            # ── Withdrawal Strategy State Machine thresholds + per-state rules ──
            # ── Withdrawal State Machine ──────────────────────────────────────
            "withdrawal_state_ab_threshold":    _ws_ab_thresh,
            "withdrawal_state_bc_threshold":    _ws_bc_thresh,
            "withdrawal_state_ab_gain_ratio":   _ws_ab_ratio,
            "withdrawal_state_bc_gain_ratio":   _ws_bc_ratio,
            "withdrawal_dividend_load_alert":   int(_ws_cfg.get("dividend_load_alert", 160_000)),
            "withdrawal_states":                _ws_cfg.get("states", None),
            "withdrawal_milestones":            _ws_cfg.get("milestones", None),
            "withdrawal_transition_logic":      _ws_cfg.get("transition_logic", None),
            # Computed by state machine (server-side ANY_TWO evaluation)
            "withdrawal_current_state":         _sm_current_state,
            "withdrawal_gain_ratio":            _sm_gain_ratio,
            "withdrawal_forced_income_ratio":   _sm_forced_income_ratio,
            "withdrawal_forced_income_num":     round(_sm_forced_income_num, 0),
            "withdrawal_forced_income_denom":   round(_sm_desired_spend, 0) if _sm_desired_spend > 0 else None,
            "withdrawal_forced_income_status":  _fi_status,
            "withdrawal_ctrl_sale_ratio":       _sm_ctrl_sale_ratio,
            "withdrawal_spending_gap":          round(_sm_spending_gap, 0),
            "withdrawal_concentration_ratio":   round(_sm_conc_ratio, 4),
            "withdrawal_state_conditions":      _sm_conditions,
            # ── Gain Maturity (Risk tab) ──────────────────────────────────────
            "stcg_ratio":                       _sm_stcg_ratio,
            "stcg_ratio_status":                _gm_status,
            "freeze_rebalance":                 _freeze_rebalance,
            # ── Concentration (Risk tab) ──────────────────────────────────────
            "concentration_status":             _conc_status,
            "concentration_freeze_buys":        _conc_freeze_buys,
            "concentration_must_trim":          _conc_must_trim,
            "concentration_redirect_dividends": _conc_redir_divs,
            "concentration_top_pct":            round(_top_holding_pct, 4),
            # ── Config passthrough ────────────────────────────────────────────
            "concentration_rules":              cfg.get("_CONCENTRATION_RULES", None),
            "gain_maturity_rules":              cfg.get("_GAIN_MATURITY", None),
            "forced_income_rules":              cfg.get("_FORCED_INCOME", None),
            "marginal_rate_model":              cfg.get("_MARGINAL_RATE_MODEL", None),
            "cash_flow_routing":                cfg.get("_CASH_FLOW_ROUTING", None),
        }

    # Risk alerts
    alerts = []
    for d in decisions:
        ss = d["structural_status"]
        sym = d["symbol"]
        if ss == "STRUCTURAL_BREAKDOWN":
            reds = [v["message"] for k, v in d["metrics"].items() if v["level"] == "RED"]
            alerts.append({"level": "red", "symbol": sym,
                           "message": f"STRUCTURAL BREAKDOWN — {reds[0] if reds else 'multiple failures'}"})
        elif ss == "INCOME_COMPRESSION":
            alerts.append({"level": "orange", "symbol": sym,
                           "message": "Income compression risk — monitor VIX and coverage"})
        elif ss == "VALUATION_STRETCHED":
            snap = snapshots.get(sym, {})
            pm = snap.get("premium")
            pm_str = f"Premium {pm*100:.1f}%" if pm and pm > 0 else "Valuation stretched"
            alerts.append({"level": "yellow", "symbol": sym,
                           "message": f"{pm_str} — do not add"})

        # Yellow metric flags
        for mkey in ("COVERAGE", "DIST_CUT", "NAV_DECAY_ACCEL"):
            if mkey in d["metrics"] and d["metrics"][mkey]["level"] == "YELLOW":
                alerts.append({"level": "yellow", "symbol": sym,
                               "message": d["metrics"][mkey]["message"]})
            elif mkey in d["metrics"] and d["metrics"][mkey]["level"] == "RED":
                alerts.append({"level": "red", "symbol": sym,
                               "message": d["metrics"][mkey]["message"]})

    if taxable_income > _INCOME_CEILING:
        alerts.append({"level": "red", "symbol": "PORTFOLIO",
                       "message": f"Taxable dividends ${taxable_income:,.0f} exceed ${_INCOME_CEILING:,.0f} ceiling!"})

    # ── Decision Strip: synthesize signals into top actionable items ───────────
    _decision_strip: List[Dict[str, str]] = []
    _pi = portfolio_intel
    if _pi:
        # 1. Concentration drift — largest deviation from plan (advisory, not prescriptive)
        _all_tvsa = (_pi.get("taxable_target_vs_actual") or []) + (_pi.get("roth_target_vs_actual") or [])
        if _all_tvsa:
            _biggest = max(_all_tvsa, key=lambda r: abs(r["delta_pct"]))
            if abs(_biggest["delta_pct"]) >= 5.0:
                _drift_dir = "Overweight" if _biggest["delta_pct"] > 0 else "Underweight"
                _decision_strip.append({
                    "icon": "📊", "action": "CONCENTRATION",
                    "text": (
                        f"{_biggest['symbol']} {_biggest['actual_pct']}% actual vs "
                        f"{_biggest['target_pct']}% target "
                        f"({_biggest['delta_pct']:+.1f}%) \u2014 {_drift_dir}"
                    ),
                    "level": "yellow",
                })

        # 2. Extended valuation — do not add
        _extended = [s for s, v in (_pi.get("fund_valuation") or {}).items() if v == "EXTENDED"]
        if _extended:
            _decision_strip.append({
                "icon": "🚫", "action": "DO NOT ADD",
                "text": f"Do not add to {', '.join(_extended[:3])} — valuation extended",
                "level": "yellow",
            })

        # 3. Income drift — flag if actual YTD < 85% of expected
        _exp_ytd = (tax_data or {}).get("expected_ytd_total", 0)
        _act_ytd = income_history.get("ytd_total", 0)
        if _exp_ytd > 0 and _act_ytd > 0 and _act_ytd < _exp_ytd * 0.85:
            _drift_pct = round((_act_ytd - _exp_ytd) / _exp_ytd * 100, 1)
            _decision_strip.append({
                "icon": "⚠️", "action": "REVIEW",
                "text": f"Income tracking {abs(_drift_pct):.1f}% below pace — review income funds",
                "level": "orange",
            })

        # 4. Roth conversion signal
        _conv_score = (tax_data or {}).get("conv_score")
        _conv_action = (tax_data or {}).get("conv_action", "")
        if _conv_score is not None:
            if _conv_score < 5.0:
                _decision_strip.append({
                    "icon": "⏳", "action": "WAIT",
                    "text": f"Hold Roth conversion — score {_conv_score}/10 (conditions unfavorable)",
                    "level": "orange",
                })
            elif _conv_score >= 7.5:
                _decision_strip.append({
                    "icon": "✅", "action": "CONVERT",
                    "text": f"Execute Roth conversion — score {_conv_score}/10 ({_conv_action})",
                    "level": "green",
                })

        # 5. High fragility — flag concentration + correlation cluster risk
        if _pi.get("fragility_level") == "HIGH":
            _decision_strip.append({
                "icon": "⚡", "action": "REDUCE RISK",
                "text": f"Fragility score {_pi.get('fragility_score')}/100 — high concentration + correlation cluster",
                "level": "red",
            })

    now = datetime.now().astimezone().strftime("%Y-%m-%d %I:%M:%S %p %Z")

    # ── Unified income summary (single source of truth for all tabs) ──────────
    def _build_income_summary(si: dict, ih: dict, ia, td: dict) -> dict:
        """
        Four-column income summary used identically across all tabs.
        Three income buckets, each with distinct tax treatment:
          W2          — earned income (ordinary tax)
          Dividends   — by account: Roth (tax-free), Rollover (deferred), Taxable (qualified/NIIT)
          Conversion  — Roth conversion YTD (ordinary tax, like W2; not a cash inflow but taxable event)

          ACTUAL    = real transactions received / executed this year
          EXPECTED  = what should have arrived by today on schedule
          PROJECTED = remaining to come this year
          FULL YEAR = actual + projected
        """
        from datetime import date as _date
        _today        = _date.today()
        _month        = _today.month
        _day          = _today.day
        _doy          = _today.timetuple().tm_yday
        _year         = _today.year
        _days_in_year = 366 if (_year % 4 == 0 and (_year % 100 != 0 or _year % 400 == 0)) else 365
        _yr_frac      = _doy / _days_in_year

        # ── Pay-period counts (semi-monthly: 1st + 15th = 24/yr) ─────────────
        _pay_elapsed   = max(1, (_month - 1) * 2 + (1 if _day >= 1 else 0) + (1 if _day >= 15 else 0))
        _pay_remaining = max(0, 24 - _pay_elapsed)

        # ── W2 ────────────────────────────────────────────────────────────────
        # actual = current-year W2 only, from monthly_income_totals (current yr rows)
        # si.w2_total spans the full CSV window (can be multi-year) — DO NOT use directly
        _curr_yr   = str(_year)
        actual_w2  = round(sum(
            float(row.get("w2", 0) or 0)
            for row in (si or {}).get("monthly_income_totals", [])
            if (row.get("month") or "").startswith(_curr_yr)
        ))
        # Expected uses the historically-annualised rate (si.w2_annual = all-yr total / all months × 12)
        # This keeps EXPECTED independent of ACTUAL so variance shows up when salary differs
        _w2_annual   = float((si or {}).get("w2_annual", 0) or 0)
        _per_period  = (_w2_annual / 24) if _w2_annual > 0 else (actual_w2 / _pay_elapsed if _pay_elapsed else 0)
        expected_w2  = round(_per_period * _pay_elapsed)
        projected_w2 = round(_per_period * _pay_remaining)
        full_year_w2 = round(_per_period * 24)             # annualised: constant paycheck × 24

        # ── Dividends — pull from income_analytics.by_account (same as Detail tab) ──
        # actual   = ia.by_account[key].ytd_income  (Schwab transactions, same field Detail uses)
        # fwd_12m  = ia.by_account[key].fwd_12m     (forward annual rate)
        # expected = fwd_12m × yr_frac              (smooth expected curve)
        # projected rest = fwd_12m - actual         (what's left based on forward rate)
        # full year = fwd_12m                       (actual + projected rest = fwd_12m)
        _ia_accts = (ia or {}).get("by_account", {}) or {}

        actual_div_by_acct   = {}
        expected_div_by_acct = {}
        projected_div_by_acct = {}
        full_year_div_by_acct = {}

        for _k, _v in _ia_accts.items():
            _ytd    = round(float(_v.get("ytd_income", 0) or 0))
            _fwd    = round(float(_v.get("fwd_12m", 0) or 0))
            _exp    = round(_fwd * _yr_frac)
            _proj   = max(0, _fwd - _ytd)   # remaining = forward rate minus what's received
            actual_div_by_acct[_k]    = _ytd
            expected_div_by_acct[_k]  = _exp
            projected_div_by_acct[_k] = _proj
            # Annual target = fwd_12m unless YTD already exceeds it (front-loaded accounts).
            # Using fwd_12m alone causes nonsensical >100% pace when positions were trimmed
            # mid-year — the target must be at least what has already been received.
            full_year_div_by_acct[_k] = max(_fwd, _ytd)

        # Dividends split: taxable vs non-taxable (Roth + Rollover).
        # Each account is already in actual_div_by_acct; sum the two buckets explicitly
        # so the frontend can display "total income" vs "taxable income" separately.
        _NON_TAXABLE_ACCTS = {"roth_ira", "rollover_ira"}
        actual_div_taxable     = actual_div_by_acct.get("taxable", 0)
        actual_div_nontaxable  = sum(v for k, v in actual_div_by_acct.items() if k in _NON_TAXABLE_ACCTS)
        actual_div_total       = round(actual_div_taxable + actual_div_nontaxable)

        _fwd_12m_taxable    = round(float((ia or {}).get("by_account", {}).get("taxable", {}).get("fwd_12m", 0) or 0))
        _fwd_12m_nontaxable = sum(
            round(float((ia or {}).get("by_account", {}).get(k, {}).get("fwd_12m", 0) or 0))
            for k in _NON_TAXABLE_ACCTS
        )
        _fwd_12m            = _fwd_12m_taxable + _fwd_12m_nontaxable

        expected_div_taxable    = round(_fwd_12m_taxable    * _yr_frac)
        expected_div_nontaxable = round(_fwd_12m_nontaxable * _yr_frac)
        expected_div_total      = expected_div_taxable + expected_div_nontaxable

        projected_div_taxable    = max(0, _fwd_12m_taxable    - actual_div_taxable)
        projected_div_nontaxable = max(0, _fwd_12m_nontaxable - actual_div_nontaxable)
        projected_div_total      = projected_div_taxable + projected_div_nontaxable

        full_year_div_taxable    = _fwd_12m_taxable
        full_year_div_nontaxable = _fwd_12m_nontaxable
        full_year_div            = _fwd_12m

        # ── Capital gains (taxable account only — Roth/Rollover gains not taxable) ──
        actual_stcg    = round(float((td or {}).get("ytd_stcg_realized", 0) or 0))
        actual_ltcg    = round(float((td or {}).get("ytd_ltcg_realized", 0) or 0))
        actual_cap_gains = actual_stcg + actual_ltcg

        # ── Roth Conversion — taxable event (not cash inflow, but raises AGI like W2) ──
        actual_conversion    = round(float((td or {}).get("converted_ytd", 0) or 0))
        _annual_conv         = round(float((td or {}).get("annual_conversion", 0) or 0))
        expected_conversion  = round(_annual_conv * _yr_frac)
        projected_conversion = max(0, _annual_conv - actual_conversion)
        full_year_conversion = _annual_conv

        # ── Taxable income total (what actually hits AGI / generates tax) ──────
        # = W2 + taxable dividends + STCG + LTCG + conversion
        # Non-taxable (Roth/Rollover) dividends are tracked separately for display.
        actual_taxable_income   = actual_w2 + actual_div_taxable + actual_cap_gains + actual_conversion
        expected_taxable_income = expected_w2 + expected_div_taxable + expected_conversion
        projected_taxable_income = projected_w2 + projected_div_taxable + projected_conversion

        # ── Portfolio-wide totals (all sources, all accounts — for display) ───
        actual_total    = actual_w2    + actual_div_total    + actual_cap_gains + actual_conversion
        expected_total  = expected_w2  + expected_div_total  + expected_conversion
        projected_total = projected_w2 + projected_div_total + projected_conversion
        full_year_total = full_year_w2 + full_year_div       + full_year_conversion

        return {
            "actual_w2":                  actual_w2,
            # Dividends — all accounts (for total portfolio income display)
            "actual_div_total":           actual_div_total,
            "actual_div_by_acct":         actual_div_by_acct,
            # Dividends — taxable vs non-taxable split
            "actual_div_taxable":         actual_div_taxable,
            "actual_div_nontaxable":      actual_div_nontaxable,
            # Capital gains — taxable account only
            "actual_stcg":                actual_stcg,
            "actual_ltcg":                actual_ltcg,
            "actual_cap_gains":           actual_cap_gains,
            "actual_conversion":          actual_conversion,
            # Taxable income total (AGI-relevant)
            "actual_taxable_income":      actual_taxable_income,
            "actual_total":               actual_total,
            "expected_w2":                expected_w2,
            "expected_div_total":         expected_div_total,
            "expected_div_by_acct":       expected_div_by_acct,
            "expected_div_taxable":       expected_div_taxable,
            "expected_div_nontaxable":    expected_div_nontaxable,
            "expected_conversion":        expected_conversion,
            "expected_taxable_income":    expected_taxable_income,
            "expected_total":             expected_total,
            "projected_w2":               projected_w2,
            "projected_div_total":        projected_div_total,
            "projected_div_by_acct":      projected_div_by_acct,
            "projected_div_taxable":      projected_div_taxable,
            "projected_div_nontaxable":   projected_div_nontaxable,
            "projected_conversion":       projected_conversion,
            "projected_taxable_income":   projected_taxable_income,
            "projected_total":            projected_total,
            "full_year_w2":               full_year_w2,
            "full_year_div":              full_year_div,
            "full_year_div_by_acct":      full_year_div_by_acct,
            "full_year_div_taxable":      full_year_div_taxable,
            "full_year_div_nontaxable":   full_year_div_nontaxable,
            "full_year_conversion":       full_year_conversion,
            "full_year_total":            full_year_total,
            "pay_periods_elapsed":        _pay_elapsed,
            "pay_periods_remaining":      _pay_remaining,
            "avg_paycheck":               round(_per_period),
        }

    # ── Save trends cache for tomorrow's run ─────────────────────────────────
    _save_trends_cache({
        "ceiling_drift_raw":      (income_analytics or {}).get("ceiling_drift_raw"),
        "bracket_pressure_pct":   (tax_data or {}).get("bracket_pressure_pct"),
        "account_confidence": {
            k: v.get("forward_confidence")
            for k, v in ((income_analytics or {}).get("by_account", {}) or {}).items()
        },
        "signal_strengths": {
            p["symbol"]: p.get("signal_strength")
            for acct in accounts for p in acct["positions"]
            if p.get("signal_strength") is not None
        },
        "premiums": {
            sym: snap.get("premium")
            for sym, snap in snapshots.items()
            if snap.get("premium") is not None
        },
    })

    _update_status("done", "Data loaded", 100)
    result = {
        "timestamp": now,
        "market_context": market_context,
        "summary": {
            "total_value": grand_total_value,
            "total_cost": grand_total_cost,
            "total_pnl": grand_pnl,
            "total_pnl_pct": grand_pnl_pct,
            "total_income": grand_total_income,
            "taxable_income": taxable_income,
            # Pre-computed so tabs don't re-derive from positions individually
            "day_change": round(grand_day_change, 2),
            "day_change_pct": round((grand_day_change / grand_total_value * 100) if grand_total_value else 0.0, 3),
        },
        "accounts": accounts,
        "decisions": decisions,
        "snapshots": snapshots,
        "fund_configs": {sym: {"FUND_TYPE": c.get("FUND_TYPE", "UNKNOWN"),
                                "DISTRIBUTION_FREQUENCY": c.get("DISTRIBUTION_FREQUENCY", "UNKNOWN"),
                                "BENCHMARK": c.get("BENCHMARK", "SPY")}
                         for sym, c in fund_configs.items()},
        "correlation": corr_data,
        "roth_conversions": roth_conversions,
        "roth_target_analysis": roth_target_analysis,
        "annual_conversion": annual_conversion,
        "target_roth_total": target_roth_total if roth_targets else 0.0,
        "conversion_sources": conversion_sources if roth_targets else {},
        "alerts": alerts,
        "vix_current": vix_current,
        "vix_90d_avg": vix_90d_avg,
        "system_health": check_system_health(),
        "tax_data": tax_data,
        "portfolio_intel": portfolio_intel,
        "schwab_status": schwab_status,
        "income_history":          income_history,
        "decision_strip":          _decision_strip,
        "taxable_target_analysis": taxable_target_analysis,
        "income_analytics":        income_analytics,
        "spending_intelligence":   _si,   # already computed earlier in fetch_all_data
        "income_summary":          _build_income_summary(_si, income_history, income_analytics, tax_data),
    }

    # ── Signals layer (deterministic event detectors) ─────────────────────────
    # Runs AFTER the main payload is assembled so the dashboard refresh path
    # never blocks or fails on detector code. Output is attached to `result`
    # and persisted to signals_history for the briefing endpoint.
    try:
        from signals import run_all_detectors
        import db_manager as _dbm_signals
        _sigs = run_all_detectors(result)
        if _sigs:
            _dbm_signals.signals_save(now[:10], _sigs)
        result["signals"] = _sigs
    except Exception as _sig_err:
        if _VERBOSE:
            print(f"[fetch] signals layer failed: {_sig_err}")
        result["signals"] = []

    # ── Analytics history snapshot (drives vs-yesterday diffs) ────────────────
    # Isolated from the refresh path — failure here only loses one day's diff.
    try:
        import db_manager as _dbm_analytics
        _pintel = result.get("portfolio_intel") or {}
        _summary = result.get("summary") or {}
        _tx = result.get("tax_data") or {}
        _ih = result.get("income_history") or {}
        _snapshot = {
            "portfolio_value":   _summary.get("total_value"),
            "day_change_pct":    _summary.get("day_change_pct"),
            "total_pnl":         _summary.get("total_pnl"),
            "total_pnl_pct":     _summary.get("total_pnl_pct"),
            "total_income":      _summary.get("total_income"),
            "vol_budget_used":   _pintel.get("vol_budget_used"),
            "fragility_score":   _pintel.get("fragility_score"),
            "fragility_level":   _pintel.get("fragility_level"),
            "top_holding":       _pintel.get("top_holding"),
            "top_holding_pct":   _pintel.get("top_holding_pct"),
            "vol_regime":        _pintel.get("vol_regime"),
            "market_regime":     _pintel.get("market_regime"),
            "bracket_pressure":  _tx.get("bracket_pressure_real"),
            "agi_real":          _tx.get("agi_real"),
            "conv_room_real":    _tx.get("conv_room_real"),
            "ytd_income":        _ih.get("ytd_total"),
        }
        _dbm_analytics.analytics_save(now[:10], _snapshot)
    except Exception as _an_err:
        if _VERBOSE:
            print(f"[fetch] analytics history snapshot failed: {_an_err}")

    return result


def get_performance_data(force_refresh: bool = False) -> Dict[str, Any]:
    """Fetch price history for multiple timeframes for all portfolio symbols + benchmarks.

    Disk-cached by date: returns the cached file immediately if it was written today,
    so only the first request of the day hits yfinance.  The cache is also busted when
    the symbol set changes (extra symbols are added to the portfolio).
    """
    import yfinance as yf
    import pandas as pd
    from datetime import datetime

    today_str = datetime.now().strftime("%Y-%m-%d")

    cfg = load_config()
    portfolio = cfg.get("_PORTFOLIO", {})
    symbols: set = set()
    for acct in portfolio.values():
        for sym in acct.get("positions", {}).keys():
            symbols.add(sym)

    # Also include any live Schwab symbols not in config
    try:
        from schwab_client import get_all_positions
        live = get_all_positions()
        for acct_data in live.values():
            for sym in acct_data.get("positions", {}):
                symbols.add(sym)
    except Exception:
        pass

    # ── Serve from SQLite cache if it's from today and covers the same symbol set ──
    if not force_refresh:
        try:
            _cached = _dbm.cache_get(f"perf_{today_str}")
            if _cached is not None:
                _cached_syms = set(_cached.pop("_symbols", []))
                has_sym_data = any(k for k in _cached if not k.startswith("_"))
                if symbols <= _cached_syms and has_sym_data:
                    if _VERBOSE:
                        print(f"[perf] Serving from SQLite cache ({today_str})")
                    return _cached
        except Exception:
            pass

    if _VERBOSE:
        print(f"[perf] Starting fetch for {len(symbols)} symbols: {sorted(symbols)}")

    result: Dict[str, Any] = {}
    benchmarks: Dict[str, Dict[str, Any]] = {"SPY": {}, "QQQ": {}}
    failed_symbols: list = []

    # ── Single batch download for all symbols + benchmarks ──────────────────
    # One HTTP request instead of N sequential ones — major speedup on cold start.
    # Exclude money-market symbols (SWVXX etc.) — they have no meaningful price history.
    _perf_cfg     = cfg.get("_MONEY_MARKET_SYMBOLS", {})
    _mmf_like     = set(_perf_cfg.get("symbols", ["SWVXX", "SNSXX", "SWRXX", "CASH"])) | {"CASH"}
    _bench_cfg    = cfg.get("_PERFORMANCE_BENCHMARKS", {})
    _bench_syms   = _bench_cfg.get("symbols", ["SPY", "QQQ"])
    tradeable_syms = sorted(s for s in symbols if s not in _mmf_like)
    all_syms = tradeable_syms + [s for s in _bench_syms if s not in tradeable_syms]
    try:
        raw = yf.download(all_syms, period="1y", auto_adjust=True, progress=False, threads=True)
    except Exception as e:
        if _VERBOSE:
            print(f"[perf] batch download failed: {e}")
        raw = None

    def _extract_closes(sym: str):
        """Extract a clean 1Y Close series for one symbol from the batch result."""
        if raw is None or raw.empty:
            return None
        try:
            # yf.download multi-ticker returns ("Close", sym) columns
            if isinstance(raw.columns, pd.MultiIndex):
                col = ("Close", sym)
                if col not in raw.columns:
                    return None
                s = raw[col].dropna()
            else:
                # single-symbol fallback (shouldn't happen but guard it)
                s = raw["Close"].dropna()
            return s if not s.empty else None
        except Exception:
            return None

    def _build_sym_data(closes_series) -> Dict[str, Any]:
        """Compute all period slices from a Close price Series."""
        sym_data: Dict[str, Any] = {}
        hist_1y = closes_series

        now = pd.Timestamp.now(tz=hist_1y.index.tz)
        ytd_start = pd.Timestamp(datetime(now.year, 1, 1), tz=hist_1y.index.tz)

        slices = {
            "ytd": hist_1y[hist_1y.index >= ytd_start],
            "1m":  hist_1y.tail(21),
            "3m":  hist_1y.tail(63),
            "6m":  hist_1y.tail(126),
            "1y":  hist_1y,
        }

        for label, hist in slices.items():
            if hist.empty:
                continue
            closes_arr = hist.values
            closes     = [round(float(v), 4) for v in closes_arr]
            dates      = [str(d.date()) for d in hist.index]
            base       = closes[0] if closes[0] != 0 else 1.0
            pct        = [round((c / base - 1) * 100, 2) for c in closes]

            daily_rets = hist.pct_change().dropna()
            std        = float(daily_rets.std())
            vol_ann    = std * (252 ** 0.5)
            sharpe_val = float(daily_rets.mean() / std * (252 ** 0.5)) if std > 0 else 0.0

            peak = closes_arr[0]
            max_dd = 0.0
            for c in closes_arr:
                if c > peak:
                    peak = c
                dd = (c - peak) / peak
                if dd < max_dd:
                    max_dd = dd

            sym_data[label] = {
                "dates":        dates,
                "prices":       closes,
                "pct_returns":  pct,
                "total_return": round(pct[-1], 2) if pct else 0,
                "vol_annual":   round(vol_ann * 100, 2),
                "sharpe":       round(sharpe_val, 2),
                "max_drawdown": round(max_dd * 100, 2),
            }
        return sym_data

    # ── Per-symbol result ─────────────────────────────────────────────────────
    for sym in sorted(symbols):
        # Skip money-market symbols — no meaningful price history
        if sym in _mmf_like:
            continue
        try:
            closes_s = _extract_closes(sym)
            # Individual fallback: batch download can miss some ETF types in yfinance 1.x
            if closes_s is None:
                try:
                    from data_fetcher import _fetch_history_with_fallback as _fhwf
                    _fallback_hist = _fhwf(sym)
                    if not _fallback_hist.empty and "Close" in _fallback_hist.columns:
                        closes_s = _fallback_hist["Close"].dropna()
                        if closes_s.empty:
                            closes_s = None
                except Exception:
                    pass
            if closes_s is None:
                failed_symbols.append(f"{sym} (no data)")
                continue
            sym_data = _build_sym_data(closes_s)
            if not sym_data:
                failed_symbols.append(f"{sym} (empty)")
                continue
            closes_1y = closes_s.values
            result[sym] = {
                **sym_data,
                "start_price":  round(float(closes_1y[0]),  2),
                "end_price":    round(float(closes_1y[-1]), 2),
                "total_return": round(sym_data.get("1y", {}).get("total_return", 0), 2),
                "max_drawdown": sym_data.get("1y", {}).get("max_drawdown", 0),
                "sharpe":       sym_data.get("1y", {}).get("sharpe", 0),
                "vol_annual":   sym_data.get("1y", {}).get("vol_annual", 0),
            }
        except Exception as e:
            failed_symbols.append(f"{sym} ({str(e)[:50]})")
            if _VERBOSE:
                print(f"[perf] {sym}: {e}")

    # ── Benchmarks (already in the batch download, fallback individually) ────────
    for bench_sym in ["SPY", "QQQ"]:
        try:
            closes_s = _extract_closes(bench_sym)
            if closes_s is None:
                try:
                    from data_fetcher import _fetch_history_with_fallback as _fhwf
                    _bh = _fhwf(bench_sym)
                    if not _bh.empty and "Close" in _bh.columns:
                        closes_s = _bh["Close"].dropna() or None
                except Exception:
                    pass
            if closes_s is None:
                continue
            bench_data = _build_sym_data(closes_s)
            # Keep pct_returns and dates so the frontend can draw the reference line.
            # Strip only raw prices (large array, not needed by UI).
            benchmarks[bench_sym] = {k: {kk: vv for kk, vv in v.items() if kk != "prices"}
                                     for k, v in bench_data.items()}
        except Exception as e:
            if _VERBOSE:
                print(f"[perf] benchmark {bench_sym}: {e}")

    result["_benchmarks"] = benchmarks

    if _VERBOSE or len(result) == 1:
        print(f"[perf] Complete: {len(result) - 1} symbols, {len(failed_symbols)} failed")
        if failed_symbols:
            print(f"[perf] Failed: {failed_symbols[:10]}")

    # ── Write SQLite cache (only when we got real symbol data) ───────────────
    sym_count = sum(1 for k in result if k != "_benchmarks")
    if sym_count > 0:
        try:
            _dbm.cache_set(f"perf_{today_str}", {"_symbols": sorted(symbols), **result})
        except Exception:
            pass
    elif _VERBOSE:
        print(f"[perf] Skipping cache write — no symbol data (sym_count=0)")

    return result


def check_system_health() -> Dict[str, Any]:
    """Check dashboard service status."""
    health = {"dashboard": "running", "last_report": None, "issues": []}

    # Last report file
    try:
        reports_dir = os.path.join(_SERVER_DIR, "..", "reports")
        if os.path.isdir(reports_dir):
            report_files = sorted([f for f in os.listdir(reports_dir) if f.endswith(".md") and not f.endswith("-alert.txt")])
            if report_files:
                health["last_report"] = report_files[-1].replace(".md", "")
    except Exception:
        pass

    # Load alert history
    alert_history = []
    try:
        alert_log = os.path.join(_SERVER_DIR, "..", "reports", "alert-history.jsonl")
        if os.path.exists(alert_log):
            with open(alert_log) as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            alert_history.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
            # Keep last 50
            alert_history = alert_history[-50:]
    except Exception:
        pass
    health["alert_history"] = alert_history

    return health
