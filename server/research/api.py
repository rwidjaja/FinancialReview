#!/usr/bin/env python3
"""research.api — public entry points: get_research, get_chart_data, get_peers,
build_portfolio_fit, get_etf_components."""

import logging
import traceback
from datetime import datetime, date
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd
import yfinance as yf

# yfinance logs expected 404s (e.g. "no fundamentals data" for ETFs) via its own
# logger instead of raising — we already handle the missing-data case gracefully
# below, so silence its noisy stderr output.
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

# Helpers from sibling sub-modules. Listed explicitly because they are
# private (underscore-prefixed) — `from .X import *` would skip them.
from .indicators import (
    _safe_corr, _schwab_data,
    _rsi, _stochastic, _obv, _bollinger, _macd,
    _period_idx, _compute_returns,
    _generate_analysis, _align_series, _risk_stats, _annualized_ret,
    _classify_symbol, _behavioral_guardrails,
    _FUND_PROFILE_OVERRIDES,
)
from .scoring import (
    _compute_quality_score, _compute_action,
    _build_correlation_guidance, _portfolio_action_overlay,
)

def build_portfolio_fit(symbol: str, res: dict, portfolio_cache: dict) -> dict:
    """
    Compute portfolio-context metrics for the researched symbol.
    Returns a dict merged into the research response by the server.
    Requires no manual data — everything is derived from the cached portfolio.
    """
    if not portfolio_cache:
        return {}
    try:
        sc   = res.get("symbol_class", {})
        rs   = res.get("risk_stats", {})
        dist = res.get("distributions", {})

        # ── Gather all live portfolio positions ───────────────────────────────
        all_pos = []
        for acct in portfolio_cache.get("accounts", []):
            a_key   = acct.get("key", "")
            a_label = acct.get("label", "") or a_key.replace("_", " ").title()
            # Derive a short display name: "Roth IRA" → "Roth", "Rollover IRA" → "Rollover", etc.
            a_short = (a_label.replace(" IRA", "").replace(" 401k", "").replace(" 401K", "").strip()
                       or a_label or a_key)
            for pos in acct.get("positions", []):
                if float(pos.get("shares", 0) or 0) > 0:
                    all_pos.append({
                        "symbol":     (pos.get("symbol") or "").upper(),
                        "value":      float(pos.get("market_value", 0) or 0),
                        "income":     float(pos.get("annual_income", 0) or 0),
                        "account":    a_short,
                        "acct_key":   a_key,
                        "shares":     pos.get("shares", 0),
                        "cost_basis": pos.get("cost_basis"),
                        "unreal_pct": pos.get("unrealized_gain_pct"),
                    })

        total_value  = sum(p["value"]  for p in all_pos)
        total_income = sum(p["income"] for p in all_pos)
        port_yield   = round(total_income / total_value * 100, 2) if total_value > 0 else 0

        # ── This symbol's current positions ───────────────────────────────────
        sym_upper = symbol.upper()
        own_pos   = [p for p in all_pos if p["symbol"] == sym_upper]
        own_value = sum(p["value"] for p in own_pos)
        own_weight = round(own_value / total_value * 100, 2) if total_value > 0 else 0

        # ── Portfolio sleeve breakdown ─────────────────────────────────────────
        # Derive sleeve from fund type and yield since symbol_class has no sleeve field.
        sleeve = sc.get("sleeve")
        if not sleeve:
            _ttm_yield_s = float(dist.get("ttm_yield_pct") or dist.get("market_yield_pct") or 0)
            _sc_type = sc.get("type", "STOCK")
            _sc_sub  = sc.get("subtype", "")
            if _sc_type in ("BDC", "REIT") or _sc_sub in ("option-income", "dividend") or _ttm_yield_s >= 5.0:
                sleeve = "Income"
            else:
                sleeve = "Growth"

        _SLEEVE_COLORS = {
            "Growth":        "#0984e3",
            "Income":        "#00b894",
            "Stability":     "#74b9ff",
            "International": "#a29bfe",
            "Alternatives":  "#fdcb6e",
        }
        sleeve_color = _SLEEVE_COLORS.get(sleeve, "#636e72")

        # Sleeve weight proxy in portfolio (income positions as Income sleeve)
        same_sleeve_value = sum(
            p["value"] for p in all_pos
            if p["symbol"] != sym_upper and (
                (sleeve == "Income"  and p["income"] > 0) or
                (sleeve == "Growth"  and p["income"] == 0) or
                (sleeve not in ("Income", "Growth"))
            )
        )
        sleeve_weight_pct = round(same_sleeve_value / total_value * 100, 1) if total_value > 0 else 0

        # ── Impact metrics ────────────────────────────────────────────────────
        ttm_yield = float(dist.get("ttm_yield_pct") or dist.get("market_yield_pct") or 0)

        # Yield impact: hypothetical $10K add → how many bps does portfolio yield change?
        hypo = 10_000.0
        new_yield = ((total_income + ttm_yield / 100 * hypo) / (total_value + hypo) * 100)
        yield_delta_bps = round((new_yield - port_yield) * 100, 1)

        # Volatility impact proxy via beta
        beta = rs.get("beta")
        port_beta_proxy = None
        if beta and total_value > 0 and own_value > 0:
            # Estimate incremental beta impact of $10K add
            new_weight = hypo / (total_value + hypo)
            port_beta_proxy = round(new_weight * beta, 3)

        # ── Portfolio composite correlation (top 8 holdings, 1Y) ──────────────
        corr_portfolio = None
        try:
            others = sorted(
                [p for p in all_pos if p["symbol"] != sym_upper and p["value"] > 0],
                key=lambda x: x["value"], reverse=True
            )[:8]
            other_syms = [p["symbol"] for p in others]
            other_vals = [p["value"]  for p in others]

            if other_syms and sum(other_vals) > 0:
                _ph = yf.download(other_syms, period="1y", auto_adjust=True,
                                   progress=False, threads=True)
                if not _ph.empty:
                    if len(other_syms) == 1:
                        close_df = _ph[["Close"]]; close_df.columns = other_syms
                    else:
                        close_df = _ph["Close"] if "Close" in _ph.columns else _ph.xs("Close", axis=1, level=0)

                    total_w = sum(other_vals)
                    port_ret = None
                    for sym_p, val in zip(other_syms, other_vals):
                        if sym_p in close_df.columns:
                            col_ret = close_df[sym_p].dropna().pct_change().dropna()
                            if len(col_ret) > 20:
                                weighted = col_ret * (val / total_w)
                                port_ret = weighted if port_ret is None else port_ret.add(weighted, fill_value=0)

                    if port_ret is not None and len(port_ret) >= 30:
                        sym_h = yf.Ticker(symbol).history(period="1y", auto_adjust=True)
                        if not sym_h.empty:
                            sym_ret = sym_h["Close"].pct_change().dropna()
                            if port_ret.index.tz is not None:
                                port_ret = port_ret.tz_localize(None)
                            if sym_ret.index.tz is not None:
                                sym_ret = sym_ret.tz_localize(None)
                            common = port_ret.index.intersection(sym_ret.index)
                            if len(common) >= 30:
                                corr_portfolio = _safe_corr(sym_ret.loc[common].values,
                                                            port_ret.loc[common].values)
                                if corr_portfolio is not None:
                                    corr_portfolio = round(corr_portfolio, 3)
        except Exception:
            pass

        # ── Sleeve-level correlations (Growth / Income / Stability) ─────────────────
        corr_sleeve = None
        corr_sleeve_label = None
        try:
            # Build sleeve proxies
            growth_syms = [p["symbol"] for p in all_pos if p["symbol"] != sym_upper and p["income"] == 0 and p["value"] > 0]
            income_syms = [p["symbol"] for p in all_pos if p["symbol"] != sym_upper and p["income"] > 0 and p["value"] > 0]
            stability_syms = [p["symbol"] for p in all_pos if p["symbol"] != sym_upper and any(
                s in (portfolio_cache.get("_categories", {}).get(p["symbol"], "") or "").lower()
                for s in ["bond", "treasury", "money market", "fixed income"]
            )]
            # Fallback sleeves using name lookup from portfolio
            if not growth_syms or not income_syms:
                _name_map = portfolio_cache.get("_symbol_names", {})
                for p in all_pos:
                    if p["symbol"] == sym_upper or p["value"] <= 0:
                        continue
                    nm = (_name_map.get(p["symbol"]) or "").lower()
                    inc = p["income"] > 0
                    cat = (portfolio_cache.get("_categories", {}).get(p["symbol"]) or "").lower()
                    if any(x in cat for x in ["bond", "treasury", "money market", "fixed"]):
                        if p["symbol"] not in stability_syms:
                            stability_syms.append(p["symbol"])
                    elif inc and p["symbol"] not in income_syms:
                        income_syms.append(p["symbol"])
                    elif not inc and p["symbol"] not in growth_syms:
                        growth_syms.append(p["symbol"])

            def _corr_to_sleeve(syms_list):
                if len(syms_list) < 1:
                    return None
                syms_h = yf.download(syms_list, period="1y", auto_adjust=True, progress=False, threads=True)
                if syms_h.empty:
                    return None
                close_df = syms_h["Close"] if "Close" in syms_h.columns else syms_h.xs("Close", axis=1, level=0) if len(syms_list) > 1 else syms_h[["Close"]]
                if len(syms_list) == 1:
                    close_df = close_df.rename(columns={close_df.columns[0]: syms_list[0]})
                # Equal-weight sleeve return
                sr = close_df.pct_change().dropna()
                if sr.empty or len(syms_list) == 0:
                    return None
                sleeve_ret = sr.mean(axis=1)
                sym_h = yf.Ticker(symbol).history(period="1y", auto_adjust=True)
                if sym_h.empty:
                    return None
                sym_ret = sym_h["Close"].pct_change().dropna()
                if sleeve_ret.index.tz is not None:
                    sleeve_ret = sleeve_ret.tz_localize(None)
                if sym_ret.index.tz is not None:
                    sym_ret = sym_ret.tz_localize(None)
                common = sleeve_ret.index.intersection(sym_ret.index)
                if len(common) < 20:
                    return None
                c = _safe_corr(sym_ret.loc[common].values, sleeve_ret.loc[common].values)
                return round(c, 3) if c is not None else None

            target_sleeve = sleeve  # this symbol's assigned sleeve
            if target_sleeve == "Growth" and growth_syms:
                corr_sleeve = _corr_to_sleeve(growth_syms[:8])
                corr_sleeve_label = "Growth"
            elif target_sleeve == "Income" and income_syms:
                corr_sleeve = _corr_to_sleeve(income_syms[:8])
                corr_sleeve_label = "Income"
            elif target_sleeve in ("Stability", "Alternatives", "International"):
                # Cross-sleeve: compare to dominant sleeves
                for _sl, _syms in [("Growth", growth_syms), ("Income", income_syms)]:
                    _c = _corr_to_sleeve(_syms[:8])
                    if _c is not None:
                        corr_sleeve = _c
                        corr_sleeve_label = _sl
                        break
            else:
                # Default: compare to both
                gc = _corr_to_sleeve(growth_syms[:8])
                ic = _corr_to_sleeve(income_syms[:8])
                if gc is not None:
                    corr_sleeve = gc
                    corr_sleeve_label = "Growth"
                elif ic is not None:
                    corr_sleeve = ic
                    corr_sleeve_label = "Income"
        except Exception:
            pass

        # ── Top-3 position correlations ─────────────────────────────────────────
        corr_top3 = []
        try:
            top3 = sorted([p for p in all_pos if p["symbol"] != sym_upper and p["value"] > 0],
                          key=lambda x: x["value"], reverse=True)[:3]
            # Preserve order but deduplicate by symbol (same symbol across accounts → list keeps first occurrence)
            seen = set()
            top3_unique = []
            for p in top3:
                if p["symbol"] not in seen:
                    seen.add(p["symbol"])
                    top3_unique.append(p)
            top3 = top3_unique
            if top3:
                top3_syms = [p["symbol"] for p in top3]
                _th = yf.download(top3_syms, period="1y", auto_adjust=True, progress=False, threads=True)
                if not _th.empty:
                    close_df = _th["Close"] if "Close" in _th.columns else _th.xs("Close", axis=1, level=0)
                    sym_h = yf.Ticker(symbol).history(period="1y", auto_adjust=True)
                    if not sym_h.empty and not close_df.empty:
                        sym_ret = sym_h["Close"].pct_change().dropna()
                        for _psym in top3_syms:
                            if _psym in close_df.columns:
                                _pr = close_df[_psym].dropna().pct_change().dropna()
                                if sym_ret.index.tz is not None:
                                    sym_ret = sym_ret.tz_localize(None)
                                if _pr.index.tz is not None:
                                    _pr = _pr.tz_localize(None)
                                common = sym_ret.index.intersection(_pr.index)
                                if len(common) >= 20:
                                    _c = _safe_corr(sym_ret.loc[common].values, _pr.loc[common].values)
                                    if _c is not None:
                                        corr_top3.append({"symbol": _psym, "corr": round(_c, 3)})
        except Exception:
            pass

        return {
            "positions":             own_pos,
            "total_position_value":  round(own_value, 2),
            "portfolio_total_value": round(total_value, 2),
            "weight_pct":            own_weight,
            "sleeve":                sleeve,
            "sleeve_color":          sleeve_color,
            "sleeve_existing_weight_pct": sleeve_weight_pct,
            "portfolio_yield_pct":   port_yield,
            "symbol_yield_pct":      ttm_yield,
            "yield_delta_bps":       yield_delta_bps,
            "beta":                  beta,
            "beta_impact_10k":       port_beta_proxy,
            "corr_spy":              rs.get("corr_spy"),
            "corr_qqq":              rs.get("corr_qqq"),
            "corr_portfolio":        corr_portfolio,
            "corr_sleeve":           corr_sleeve,
            "corr_sleeve_label":     corr_sleeve_label,
            "corr_top3":             corr_top3,
            # ── Correlation-driven sizing guidance ──────────────────────────────
            "guidance":              _build_correlation_guidance({
                "corr_portfolio": corr_portfolio,
                "corr_sleeve":    corr_sleeve,
                "corr_sleeve_label": corr_sleeve_label,
                "corr_top3":      corr_top3,
                "own_weight":     own_weight,
                "own_type":       sc.get("type", "STOCK"),
                "beta":           beta,
            }),
            # ── Portfolio overlay on action engine ─────────────────────────────
            "action_engine_overlay": _portfolio_action_overlay(
                res.get("action_engine", {}),
                own_weight=own_weight,
                corr_portfolio=corr_portfolio,
                beta=beta,
            ),
        }
    except Exception as e:
        return {"error": str(e)}


# ── Lightweight chart data (for compare overlay) ──────────────────────────────

def get_chart_data(symbol: str) -> Dict[str, Any]:
    """
    Returns normalized % return series for all standard periods.
    Used by the frontend for chart comparison overlays.
    """
    symbol = symbol.upper().strip().rstrip(":")
    try:
        ticker = yf.Ticker(_yf_symbol(symbol))
        # Try 10Y; fall back to max available
        hist = ticker.history(period="10y", auto_adjust=True)
        if hist.empty:
            hist = ticker.history(period="max", auto_adjust=True)
        if hist.empty:
            return {"symbol": symbol, "error": "No data"}

        closes = hist["Close"].values.astype(float)
        dates  = [str(d.date()) for d in hist.index]

        today  = date.today()
        PERIODS = {
            "1d":  1, "5d": 5, "1m": 21, "3m": 63,
            "6m": 126, "ytd": None, "1y": 252, "3y": 756, "5y": 1260, "10y": 2520,
        }

        chart = {}
        for label, n in PERIODS.items():
            if label == "ytd":
                idx = _period_idx(dates, from_date=date(today.year, 1, 2))
            else:
                idx = max(0, len(closes) - n) if n else 0
            seg_c = closes[idx:]
            seg_d = dates[idx:]
            if len(seg_c) == 0:
                continue
            base = float(seg_c[0]) if seg_c[0] != 0 else 1.0
            chart[label] = {
                "dates":  list(seg_d),
                "prices": [round(float(v), 2) for v in seg_c],
                "pct":    [round((float(v) / base - 1) * 100, 2) for v in seg_c],
            }

        return {"symbol": symbol, "chart": chart}
    except Exception as e:
        return {"symbol": symbol, "error": str(e)}


# ── Main research function ────────────────────────────────────────────────────

# ── Peer Comparison Engine ─────────────────────────────────────────────────
_PEER_POOLS = {
    "Dividend ETF":       ["SCHD", "VYM", "DGRO", "HDV", "SPYD", "DIVO", "JEPI", "JEPQ"],
    "Growth ETF":         ["VUG", "IWF", "SPYG", "QQQ", "VGT", "XLK"],
    "Bond ETF":           ["AGG", "BND", "TLT", "IEF", "LQD", "HYG", "VCIT"],
    "Sector ETF":         ["SOXX", "XLK", "XLE", "XLF", "XLI", "XLV", "XLU", "XLP"],
    "Option Income ETF":  ["JEPI", "JEPQ", "SPYI", "QQQI", "YMAX", "OARK"],
    "REIT":               ["VNQ", "SCHH", "IYR", "XLRE", "FREL", "USRT"],
    "CEF Income":         ["PTY", "PDI", "PCI", "PCN", "PFN", "PKO", "PHK", "HIX"],
    "CEF Growth":         ["UTF", "GAB", "ETW", "ETG", "EOI", "EOS"],
    "BDC":                ["MAIN", "ARCC", "PSEC", "GBDC", "OBDC", "BXSL"],
    "Stock Dividend":     ["KO", "PEP", "JNJ", "PG", "VZ", "T", "XOM", "CVX"],
    "Stock Growth":       ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"],
    "Broad Market":       ["SPY", "VOO", "IVV", "VTI", "ITOT"],
}

def get_peers(symbol, sym_class, category=""):
    sym_type = sym_class.get("type", "STOCK")
    subtype  = sym_class.get("subtype", "")
    pool = None
    if sym_type == "REIT":
        pool = _PEER_POOLS.get("REIT")
    elif sym_type == "BDC":
        pool = _PEER_POOLS.get("BDC")
    elif sym_type == "CEF":
        pool = _PEER_POOLS.get("CEF Growth") if "growth" in category.lower() else _PEER_POOLS.get("CEF Income")
    elif sym_type == "ETF":
        if subtype == "option-income":   pool = _PEER_POOLS.get("Option Income ETF")
        elif subtype == "dividend":      pool = _PEER_POOLS.get("Dividend ETF")
        elif subtype == "growth":        pool = _PEER_POOLS.get("Growth ETF")
        elif subtype == "sector":        pool = _PEER_POOLS.get("Sector ETF")
        elif "bond" in category.lower() or "fixed" in category.lower(): pool = _PEER_POOLS.get("Bond ETF")
        elif "sector" in category.lower(): pool = _PEER_POOLS.get("Sector ETF")
        else: pool = _PEER_POOLS.get("Broad Market")
    elif sym_type == "STOCK":
        pool = _PEER_POOLS.get("Stock Dividend") if "dividend" in category.lower() else _PEER_POOLS.get("Stock Growth")
    if pool:
        return [s for s in pool if s != symbol][:6]
    return []


def _yf_symbol(symbol: str) -> str:
    """Convert Schwab-style preferred symbol (NLY/PRG or NLY/PRG:) to Yahoo Finance format (NLY-G)."""
    import re
    s = symbol.rstrip(":")
    # Schwab preferred: BASE/PR[A-Z] → Yahoo Finance: BASE-[A-Z]
    m = re.match(r'^([A-Z0-9\.]+)/PR([A-Z])$', s)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return s


def get_research(symbol: str) -> Dict[str, Any]:
    symbol = symbol.upper().strip().rstrip(":")
    result: Dict[str, Any] = {
        "symbol": symbol,
        "timestamp": datetime.now().astimezone().strftime("%Y-%m-%d %I:%M:%S %p %Z"),
        "error": None,
    }

    try:
        # ── 0. Schwab live data (single call — used throughout all steps) ─────
        # Fetch first so all subsequent steps can prefer Schwab over yfinance.
        sq = _schwab_data(symbol)   # quote + fundamental + reference
        sf = sq                     # alias for clarity in distribution/valuation sections

        _yf_sym = _yf_symbol(symbol)
        ticker = yf.Ticker(_yf_sym)
        try:
            info = ticker.info or {}
        except Exception as _yf_info_err:
            print(f"[research] yfinance .info unavailable for {symbol}: {_yf_info_err}")
            info = {}

        # ── 1. Profile ────────────────────────────────────────────────────────
        # Prefer Schwab data — it's live, always available, and doesn't 404.
        # Fall back to yfinance info only when Schwab doesn't carry the field.
        _overrides  = _FUND_PROFILE_OVERRIDES.get(symbol, {})
        name        = (sq.get("description")
                       or info.get("longName") or info.get("shortName") or symbol)
        exchange    = (sq.get("exchange")
                       or info.get("exchange") or "")
        # Schwab asset_sub_type: "ETF", "CEF" — more precise than yfinance quoteType
        asset_type  = (sq.get("asset_sub_type")
                       or info.get("quoteType") or "EQUITY")
        # Apply override for fund_type_label (CEFs show quoteType=EQUITY in yfinance)
        fund_type_label = _overrides.get("fund_type_label") or asset_type
        category    = _overrides.get("category") or info.get("category") or info.get("sectorDisp") or info.get("sector") or ""
        fund_company = _overrides.get("fund_company") or info.get("fundFamily") or ""
        # Inception date: override takes priority, then yfinance unix timestamp
        inception_str = _overrides.get("inception_date") or ""
        if not inception_str:
            inception = info.get("fundInceptionDate")
            if inception:
                try:
                    inception_str = datetime.utcfromtimestamp(inception).strftime("%Y-%m-%d")
                except Exception:
                    pass

        # NAV: yfinance navPrice can be stale/0 for CEFs; use override or fallback
        _yf_nav = round(float(info.get("navPrice") or 0), 2) or None
        _is_cef_check = _FUND_PROFILE_OVERRIDES.get(symbol, {}).get("fund_type_label", "").startswith("Closed-End")
        # For CEFs, fall back to data_fetcher's FALLBACK_DATA (manually maintained values
        # derived from Schwab's published Distribution Rate: NAV = annualDist / distRate)
        from data_fetcher import FALLBACK_DATA as _FALLBACK_NAV
        _fallback_nav = _FALLBACK_NAV.get(symbol, {}).get("nav") or None
        profile_nav = _yf_nav or (_fallback_nav if _is_cef_check else None)

        # total_assets / expense_ratio: override → yfinance (Schwab doesn't carry these)
        total_assets   = (_overrides.get("total_assets")
                          or info.get("totalAssets")
                          or 0)
        expense_ratio  = (_overrides.get("expense_ratio")
                          or info.get("annualReportExpenseRatio")
                          or info.get("totalExpenseRatio"))
        holdings_count = _overrides.get("holdings_count") or 0

        result["profile"] = {
            "name":           name,
            "exchange":       exchange,
            "asset_type":     fund_type_label,
            "category":       category,
            "fund_company":   fund_company,
            "inception_date": inception_str,
            "total_assets":   total_assets,
            "nav":            profile_nav,
            "expense_ratio":  expense_ratio,
            "beta":           info.get("beta3Year") or info.get("beta"),
            "holdings_count": holdings_count,
            # Schwab uses "ETF" / "CEF"; yfinance uses "ETF" / "MUTUALFUND"
            "is_etf":         asset_type in ("ETF", "CEF", "MUTUALFUND"),
        }

        # ── 1b. Symbol classification (needed by later steps) ─────────────────
        result["symbol_class"] = _classify_symbol(
            symbol, info, sq, _FUND_PROFILE_OVERRIDES.get(symbol, {}))
        _sc = result["symbol_class"]   # shorthand

        # ── 2. Key Statistics ─────────────────────────────────────────────────
        result["key_stats"] = {
            "market_cap":          info.get("marketCap"),
            "enterprise_value":    info.get("enterpriseValue"),
            # Prefer Schwab PE/EPS — more current than yfinance
            "pe_ratio":            sq.get("pe_ratio") or info.get("trailingPE"),
            "forward_pe":          info.get("forwardPE"),
            "peg_ratio":           info.get("pegRatio"),
            "price_to_book":       info.get("priceToBook"),
            "price_to_sales":      info.get("priceToSalesTrailing12Months"),
            "eps_ttm":             sq.get("eps") or info.get("trailingEps"),
            "eps_forward":         info.get("forwardEps"),
            "revenue":             info.get("totalRevenue"),
            "revenue_growth":      info.get("revenueGrowth"),
            "earnings_growth":     info.get("earningsGrowth"),
            "gross_margin":        info.get("grossMargins"),
            "profit_margin":       info.get("profitMargins"),
            "return_on_equity":    info.get("returnOnEquity"),
            "return_on_assets":    info.get("returnOnAssets"),
            "debt_to_equity":      info.get("debtToEquity"),
            "current_ratio":       info.get("currentRatio"),
            "short_float_pct":     info.get("shortPercentOfFloat"),
            "short_ratio":         info.get("shortRatio"),
            "inst_ownership_pct":  info.get("institutionPercentHeld"),
            "insider_pct":         info.get("insiderPercentHeld"),
            "analyst_target":      info.get("targetMeanPrice"),
            "analyst_low":         info.get("targetLowPrice"),
            "analyst_high":        info.get("targetHighPrice"),
            "recommendation":      info.get("recommendationKey"),
            "num_analyst_opinions": info.get("numberOfAnalystOpinions"),
            "free_cash_flow":      info.get("freeCashflow"),
            "eps_surprise_pct":    info.get("earningsSurprise"),
            "next_fiscal_year_end": info.get("nextFiscalYearEnd"),
        }

        # ── 3. Upcoming events ────────────────────────────────────────────────
        events: Dict[str, Any] = {}
        try:
            cal = ticker.calendar
            if cal is not None:
                if isinstance(cal, dict):
                    events["earnings_date"] = str(cal.get("Earnings Date", [None])[0] or "")
                    events["ex_div_date"]   = str(cal.get("Ex-Dividend Date", "") or "")
                    events["div_date"]      = str(cal.get("Dividend Date", "") or "")
                elif hasattr(cal, "to_dict"):
                    cal_d = cal.to_dict()
                    for k, v in cal_d.items():
                        events[k.lower().replace(" ", "_")] = str(v)
        except Exception:
            pass
        # Prefer Schwab next ex/pay dates — more timely than yfinance calendar
        if sq.get("next_div_ex_date"):
            events["ex_div_date"] = sq["next_div_ex_date"]
        if sq.get("next_div_pay_date"):
            events["div_date"] = sq["next_div_pay_date"]
        if sq.get("last_earnings_date") and not events.get("earnings_date"):
            events["last_earnings_date"] = sq["last_earnings_date"]
        result["events"] = events

        # ── 4. Analyst recommendations ────────────────────────────────────────
        analyst: Dict[str, Any] = {}
        try:
            recs = ticker.recommendations
            if recs is not None and not recs.empty:
                recent = recs.tail(20)
                counts = {"strongBuy": 0, "buy": 0, "hold": 0, "sell": 0, "strongSell": 0}
                for _, row in recent.iterrows():
                    for k in counts:
                        if k in row.index:
                            counts[k] += int(row[k])
                analyst["firm_counts"] = counts
                analyst["total"] = sum(counts.values())
        except Exception:
            pass
        result["analyst"] = analyst

        # ── 5. Price history (10Y adj for returns, 1Y raw for technicals) ─────
        hist_adj = ticker.history(period="10y", auto_adjust=True)
        if hist_adj.empty:
            hist_adj = ticker.history(period="max", auto_adjust=True)
        if hist_adj.empty:
            result["error"] = f"No price history for {symbol}"
            return result

        hist_raw = ticker.history(period="1y", auto_adjust=False)
        if hist_raw.empty:
            hist_raw = hist_adj.tail(252)

        adj_closes = hist_adj["Close"].values.astype(float)
        adj_dates  = [str(d.date()) for d in hist_adj.index]
        raw_closes = hist_raw["Close"].values.astype(float)
        raw_highs  = hist_raw["High"].values.astype(float)
        raw_lows   = hist_raw["Low"].values.astype(float)
        raw_vols   = hist_raw["Volume"].values.astype(float)

        # ── FX conversion for foreign-listed symbols ─────────────────────────
        # yfinance returns prices in the stock's local currency (e.g. KRW for
        # 000660.KS). Fetch the spot rate and convert all monetary fields so
        # the UI always works in USD.
        _quote_currency = (info.get("currency") or "USD").upper()
        _fx_spot = 1.0
        if _quote_currency != "USD":
            try:
                _fx_hist = yf.Ticker(f"{_quote_currency}USD=X").history(period="1d")
                if not _fx_hist.empty:
                    _fx_spot = float(_fx_hist["Close"].iloc[-1])
            except Exception:
                pass
            # Convert price arrays so technicals (SMA, RSI) are computed in USD
            if _fx_spot != 1.0:
                adj_closes = adj_closes * _fx_spot
                raw_closes = raw_closes * _fx_spot
                raw_highs  = raw_highs  * _fx_spot
                raw_lows   = raw_lows   * _fx_spot

        def _fx(v: float) -> float:
            """Convert a local-currency value to USD using the spot rate."""
            return v * _fx_spot

        # ── 6. Live quote overlay (sq/sf already fetched at step 0) ─────────
        # adj_closes is already in USD; sq values are raw local-currency (Schwab
        # won't quote foreign symbols so sq is usually empty for e.g. 000660.KS).
        live_price  = _fx(float(sq["price"])) if sq.get("price") else float(adj_closes[-1])
        live_change = _fx(float(sq["change"])) if sq.get("change") \
                      else (float(adj_closes[-1]) - float(adj_closes[-2]) if len(adj_closes) > 1 else 0)
        live_chgpct = sq.get("change_pct") or (live_change / float(adj_closes[-2]) if len(adj_closes) > 1 and adj_closes[-2] else 0)
        bid         = _fx(float(sq.get("bid", 0)))
        ask         = _fx(float(sq.get("ask", 0)))
        # Prefer Schwab for all quote fields; fall back to yfinance history
        volume_live = sq.get("volume") or int(raw_vols[-1])
        # raw_highs/lows already converted to USD above; sq values need _fx() too
        w52_high    = _fx(float(sq["52w_high"])) if sq.get("52w_high") else float(np.max(raw_highs))
        w52_low     = _fx(float(sq["52w_low"]))  if sq.get("52w_low")  else float(np.min(raw_lows))
        prev_close  = _fx(float(sq["close"])) if sq.get("close") else (float(adj_closes[-2]) if len(adj_closes) > 1 else live_price)
        day_open    = _fx(float(sq["open"]))  if sq.get("open")  else (float(hist_raw["Open"].values[-1] * _fx_spot) if not hist_raw.empty else live_price)
        day_high    = _fx(float(sq["day_high"])) if sq.get("day_high") else float(raw_highs[-1])
        day_low     = _fx(float(sq["day_low"]))  if sq.get("day_low")  else float(raw_lows[-1])
        after_hours = _fx(float(sq["after_hours_price"])) if sq.get("after_hours_price") else None

        # NAV resolution: Schwab REST doesn't provide NAV directly.
        # CEFs: use profile_nav (from yfinance navPrice or FALLBACK_DATA).
        # ETFs: prev_close ≈ previous-day NAV (creation/redemption keeps gap < 0.5%).
        if result["profile"]["nav"]:
            nav_price = result["profile"]["nav"]
        else:
            nav_price = prev_close
        prem_disc = (live_price - nav_price) / nav_price if nav_price else 0

        result["quote"] = {
            "last_price":        round(live_price, 2),
            "change":            round(live_change, 4),
            "change_pct":        round(live_chgpct * 100, 2),
            "currency":          _quote_currency,   # "USD" for domestic, "KRW" etc. for foreign
            # Native (local-currency) price — non-null only for foreign listings
            "native_price":      round(live_price / _fx_spot, 2) if _fx_spot != 1.0 else None,
            "native_change":     round(live_change / _fx_spot, 4) if _fx_spot != 1.0 else None,
            "bid":               round(bid, 2),
            "ask":               round(ask, 2),
            "prev_close":        round(prev_close, 2),
            "open":              round(day_open, 2),
            "day_high":          round(day_high, 2),
            "day_low":           round(day_low, 2),
            "volume":            volume_live,
            "52w_high":          round(w52_high, 2),
            "52w_low":           round(w52_low, 2),
            "nav":               round(nav_price, 2),
            "premium_discount":  round(prem_disc * 100, 4),
            "after_hours_price": round(after_hours, 2) if after_hours else None,
            "realtime":          sq.get("realtime", False),
        }

        # ── 7. Technicals ─────────────────────────────────────────────────────
        rsi14          = _rsi(raw_closes, 14)
        stoch_k, stoch_d = _stochastic(raw_highs, raw_lows, raw_closes)
        obv_val, obv_bull = _obv(raw_closes, raw_vols)
        bb_upper, bb_mid, bb_lower = _bollinger(raw_closes, 20)
        macd_hist_val, macd_bull   = _macd(raw_closes)
        ma10  = round(float(np.mean(raw_closes[-10:])), 2)  if len(raw_closes) >= 10  else None
        ma20  = round(float(np.mean(raw_closes[-20:])), 2)  if len(raw_closes) >= 20  else None
        ma50  = round(float(np.mean(raw_closes[-50:])), 2)  if len(raw_closes) >= 50  else None
        ma200 = round(float(np.mean(raw_closes[-200:])), 2) if len(raw_closes) >= 200 else None
        avg_v10 = int(np.mean(raw_vols[-10:])) if len(raw_vols) >= 10 else 0
        avg_v20 = int(np.mean(raw_vols[-20:])) if len(raw_vols) >= 20 else 0
        avg_v90 = int(np.mean(raw_vols[-90:])) if len(raw_vols) >= 90 else 0
        daily_rets = np.diff(raw_closes[-12:]) / raw_closes[-12:-1] if len(raw_closes) >= 12 else np.array([])
        hist_vol10 = round(float(np.std(daily_rets) * np.sqrt(252) * 100), 2) if len(daily_rets) > 1 else 0.0

        result["technicals"] = {
            "rsi_14": rsi14, "stochastic_k": stoch_k, "stochastic_d": stoch_d,
            "obv": obv_val, "obv_bullish": obv_bull,
            "macd_histogram": macd_hist_val, "macd_bullish": macd_bull,
            "ma_10": ma10, "ma_20": ma20, "ma_50": ma50, "ma_200": ma200,
            "bollinger_upper": bb_upper, "bollinger_mid": bb_mid, "bollinger_lower": bb_lower,
            "avg_volume_10d": avg_v10, "avg_volume_20d": avg_v20, "avg_volume_90d": avg_v90,
            "hist_vol_10d": hist_vol10,
        }

        # ── 7b. Intraday baseline stats (enhanced by 5m fetch later) ──────────
        _vol_1h = 0
        _vol_1h_rate = volume_live / avg_v90 if avg_v90 > 0 else 1.0
        _intraday_move_pct = abs(live_price - day_open) / day_open * 100 if day_open > 0 else 0.0

        # ── 8. Performance table (price return + total return) ────────────────
        price_returns = _compute_returns(adj_closes, adj_dates)

        # Total return: use adjusted closes (already includes dividends in yfinance)
        total_returns = price_returns  # adj already bakes dividends in yfinance

        # Fetch SPY for comparison
        spy_price_ret = {}
        spy_total_ret = {}
        try:
            spy_hist = yf.Ticker("SPY").history(period="10y", auto_adjust=True)
            if not spy_hist.empty:
                spy_c = spy_hist["Close"].values.astype(float)
                spy_d = [str(d.date()) for d in spy_hist.index]
                spy_price_ret = _compute_returns(spy_c, spy_d)
                spy_total_ret = spy_price_ret  # adj includes dividends
        except Exception:
            pass

        perf_periods = ["1W", "1M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y"]
        result["performance_table"] = {
            "periods": perf_periods,
            "rows": [
                {
                    "label":  "Price Return",
                    "values": [price_returns.get(p) for p in perf_periods],
                },
                {
                    "label":  "S&P 500",
                    "values": [spy_price_ret.get(p) for p in perf_periods],
                },
                {
                    "label":  "Total Return",
                    "values": [total_returns.get(p) for p in perf_periods],
                },
                {
                    "label":  "S&P 500 Total Return",
                    "values": [spy_total_ret.get(p) for p in perf_periods],
                },
            ],
        }

        # ── 9. Chart data (normalized % from period start) ────────────────────
        today = date.today()
        CHART_PERIODS = {
            "1d":  1,   "5d":  5,   "1m":  21,  "3m":  63,
            "6m":  126, "ytd": None, "1y":  252, "3y":  756,
            "5y":  1260, "10y": 2520,
        }

        def _build_series(closes, dates_list, n, ytd=False):
            if ytd:
                idx = _period_idx(dates_list, from_date=date(today.year, 1, 2))
            else:
                idx = max(0, len(closes) - n) if n else 0
            seg_c = closes[idx:]
            seg_d = dates_list[idx:]
            if len(seg_c) == 0:
                return None
            base = float(seg_c[0]) if seg_c[0] != 0 else 1.0
            return {
                "dates":  list(seg_d),
                "prices": [round(float(v), 2) for v in seg_c],
                "pct":    [round((float(v) / base - 1) * 100, 2) for v in seg_c],
            }

        chart = {}
        for label, n in CHART_PERIODS.items():
            s = _build_series(adj_closes, adj_dates, n, ytd=(label == "ytd"))
            if s:
                chart[label] = s

        # Intraday (1d) and 5d from higher-frequency data
        try:
            h1d = ticker.history(period="1d", interval="5m")
            if not h1d.empty:
                c1 = h1d["Close"].values.astype(float)
                d1 = [str(t) for t in h1d.index]
                base = c1[0] if c1[0] != 0 else 1.0
                chart["1d"] = {
                    "dates":  d1,
                    "prices": [round(float(v), 2) for v in c1],
                    "pct":    [round((float(v) / base - 1) * 100, 2) for v in c1],
                }
                # 1-hour volume: last 12 × 5min bars = 60 minutes of trading
                if "Volume" in h1d.columns and len(h1d) >= 1:
                    _vols_1h = h1d["Volume"].values[-12:]
                    _vol_1h  = int(np.sum(_vols_1h))
                    _avg_hourly = avg_v90 / 6.5 if avg_v90 > 0 else 1.0
                    _vol_1h_rate = _vol_1h / _avg_hourly if _avg_hourly > 0 else 1.0
                # Intraday move from first 5m bar open to current price
                if len(c1) >= 2:
                    _intraday_move_pct = abs(float(c1[-1]) - float(c1[0])) / float(c1[0]) * 100 if c1[0] != 0 else 0.0
        except Exception:
            pass

        try:
            h5d = ticker.history(period="5d", interval="30m")
            if not h5d.empty:
                c5 = h5d["Close"].values.astype(float)
                d5 = [str(t) for t in h5d.index]
                base = c5[0] if c5[0] != 0 else 1.0
                chart["5d"] = {
                    "dates":  d5,
                    "prices": [round(float(v), 2) for v in c5],
                    "pct":    [round((float(v) / base - 1) * 100, 2) for v in c5],
                }
        except Exception:
            pass

        # SPY overlay data for each period
        spy_chart = {}
        try:
            spy_hist_full = yf.Ticker("SPY").history(period="10y", auto_adjust=True)
            if not spy_hist_full.empty:
                spy_c_full = spy_hist_full["Close"].values.astype(float)
                spy_d_full = [str(d.date()) for d in spy_hist_full.index]
                for label, n in CHART_PERIODS.items():
                    s = _build_series(spy_c_full, spy_d_full, n, ytd=(label == "ytd"))
                    if s:
                        spy_chart[label] = s
        except Exception:
            pass

        result["chart"] = chart
        result["spy_chart"] = spy_chart

        # ── 10. Holdings ──────────────────────────────────────────────────────
        holdings = []
        _is_cef = _FUND_PROFILE_OVERRIDES.get(symbol, {}).get("fund_type_label", "").startswith("Closed-End")
        _holdings_url = _FUND_PROFILE_OVERRIDES.get(symbol, {}).get("holdings_url", "")

        # yfinance funds_data (works for most ETFs)
        if not holdings:
            try:
                fund_data = ticker.funds_data
                if fund_data is not None:
                    top_h = getattr(fund_data, "top_holdings", None)
                    if top_h is not None and not top_h.empty:
                        for _, row in top_h.head(15).iterrows():
                            raw_w = row.get("Weight", row.get("% Weight", row.get("Holding Percent", 0))) or 0
                            holdings.append({
                                "symbol": str(row.get("Symbol", "") or row.name or ""),
                                "name":   str(row.get("Name", row.get("Holding Name", ""))),
                                "weight": round(float(raw_w), 4),
                            })
            except Exception:
                pass

        # 3) yfinance ticker.info["holdings"] fallback (CEFs)
        if not holdings and _is_cef:
            try:
                _top = info.get("holdings", []) or []
                for h in _top[:15]:
                    holdings.append({
                        "symbol": str(h.get("symbol", "")),
                        "name":   str(h.get("holdingName", "")),
                        "weight": round(float(h.get("holdingPercent", 0)), 4),
                    })
            except Exception:
                pass
        result["holdings"] = holdings
        result["holdings_is_cef"] = _is_cef
        result["holdings_url"] = _holdings_url  # fund website link when API has no data
        # Fallback holdings_count: use actual top_holdings length when override was 0/None
        if not result["profile"].get("holdings_count") and holdings:
            result["profile"]["holdings_count"] = len(holdings)

        # ── 10b. ETF Component Engine eligibility flag ────────────────────────
        # The actual scores/quotes are fetched via /api/research/components
        # (a separate request) to avoid adding Schwab batch-quote latency here.
        _NEVER_TOP_HEAVY = {
            'SPYI', 'JEPI', 'JEPQ', 'QDVO', 'DIVO', 'QYLD', 'RYLD', 'XYLD',
            'NUSI', 'PBDC', 'SVOL', 'NVDY', 'MSFO', 'CONY',
            'RSP', 'QQQE', 'EWSC', 'EQL',
            'TLT', 'IEF', 'SHY', 'AGG', 'BND', 'LQD', 'HYG', 'JNK',
            'VCIT', 'VCSH', 'MUB', 'TIP', 'SCHP',
            'GLD', 'IAU', 'SLV', 'PPLT', 'USO', 'BNO', 'DBO', 'GDX', 'GDXJ',
            'SWVXX', 'VMFXX', 'SPAXX',
        }
        _sc_type = (result.get("symbol_class") or {}).get("type", "")
        _ece_eligible = (
            not _is_cef
            and symbol not in _NEVER_TOP_HEAVY
            and _sc_type not in ("BOND_ETF", "MMF", "COMMODITY_ETF", "CEF")
            and len(holdings) >= 5
        )
        if _ece_eligible:
            def _frac(w: float) -> float:
                return w / 100.0 if w > 1.0 else w
            top10_frac_sum = sum(_frac(h.get("weight", 0)) for h in holdings[:10])
            result["etf_component_eligible"] = top10_frac_sum >= 0.40
            result["etf_top10_weight_pct"]   = round(top10_frac_sum * 100, 1)
        else:
            result["etf_component_eligible"] = False

        # ── 11. Distributions ─────────────────────────────────────────────────
        # Prefer Schwab data (most accurate); yfinance is fallback only.
        dist_info: Dict[str, Any] = {}

        # --- Schwab path (primary) ---
        _sf_div_amount  = sf.get("div_amount")      # annualised $ (e.g. 1.88)
        _sf_div_yield   = sf.get("div_yield")        # annualised % (e.g. 8.086)
        _sf_pay_amount  = sf.get("div_pay_amount")   # last single payment (e.g. 0.47)
        _sf_ex_date     = sf.get("div_ex_date") or ""
        _sf_pay_date    = sf.get("div_pay_date") or ""
        _sf_freq        = sf.get("div_freq") or ""
        _sf_next_ex     = sf.get("next_div_ex_date") or ""
        _sf_next_pay    = sf.get("next_div_pay_date") or ""

        if _sf_pay_amount and _sf_pay_amount > 0:
            # Schwab has authoritative data — use it directly
            _ann_div = round(float(_sf_div_amount), 4) if _sf_div_amount else None

            # Market yield = annualised dist / market price (what investor earns per $ invested)
            _mkt_yield = round(_ann_div / live_price * 100, 2) if (_ann_div and live_price) else None

            # NAV-based dist rate = annualised dist / NAV  (matches Schwab website "Distribution Rate")
            # NAV comes from Schwab quote nAV field (CEFs only) or fallback; None for ETFs.
            _nav_yield = None
            if _is_cef and _ann_div and nav_price and nav_price != live_price:
                _nav_yield = round(_ann_div / nav_price * 100, 2)

            dist_info = {
                "last_dividend":   round(float(_sf_pay_amount), 4),
                "last_ex_date":    _sf_ex_date,
                "last_pay_date":   _sf_pay_date,
                "next_ex_date":    _sf_next_ex,
                "next_pay_date":   _sf_next_pay,
                "annual_total":    _ann_div,
                "market_yield_pct": _mkt_yield,   # annualised dist / price
                "nav_yield_pct":    _nav_yield,    # annualised dist / NAV  (CEF only, matches Schwab website)
                # keep legacy key for backward compat with other parts of the dashboard
                "ttm_total":       _ann_div,
                "ttm_yield_pct":   _nav_yield if _nav_yield else _mkt_yield,
                "frequency":       _sf_freq,
                "source":          "schwab",
            }
            # Still append yfinance history for the history chart
            try:
                divs = ticker.dividends
                if divs is not None and not divs.empty:
                    dist_info["history"] = [
                        {"date": str(d.date()), "amount": round(float(v), 4)}
                        for d, v in divs.tail(8).items()
                    ]
                    # Annual totals for the distribution history table/chart
                    _yr_totals: Dict[int, float] = {}
                    for _dt, _amt in divs.items():
                        _yr = _dt.year
                        _yr_totals[_yr] = round(_yr_totals.get(_yr, 0.0) + float(_amt), 4)
                    dist_info["annual_history"] = [
                        {"year": _yr, "total": _tot}
                        for _yr, _tot in sorted(_yr_totals.items())
                    ]
            except Exception:
                pass

        else:
            # --- yfinance fallback path ---
            try:
                divs = ticker.dividends
                if divs is not None and not divs.empty:
                    recent = divs.tail(4)
                    last_div     = round(float(recent.iloc[-1]), 4)
                    last_ex_date = str(recent.index[-1].date())
                    # TTM = last 12 calendar months, NOT last 12 events
                    cutoff   = pd.Timestamp.now(tz="UTC") - pd.DateOffset(years=1)
                    divs_tz  = divs.copy()
                    if divs_tz.index.tz is None:
                        divs_tz.index = divs_tz.index.tz_localize("UTC")
                    ttm_divs = divs_tz[divs_tz.index >= cutoff]
                    ttm_div  = round(float(ttm_divs.sum()), 4)
                    yf_rate  = float(info.get("trailingAnnualDividendRate") or 0)
                    if ttm_div == 0 and yf_rate > 0:
                        ttm_div = round(yf_rate, 4)
                    ttm_yield = round(ttm_div / live_price * 100, 2) if live_price else 0
                    # Sanity-check against yfinance's own yield
                    yf_yield = float(info.get("trailingAnnualDividendYield") or 0) * 100
                    if yf_yield > 0 and abs(ttm_yield - yf_yield) > 5:
                        ttm_yield = round(yf_yield, 2)
                        ttm_div   = round(ttm_yield / 100 * live_price, 4) if live_price else ttm_div
                    if len(divs) >= 2:
                        gap  = (divs.index[-1] - divs.index[-2]).days
                        freq = "Monthly" if gap < 40 else "Quarterly" if gap < 100 else "Semi-Annual" if gap < 200 else "Annually"
                    else:
                        freq = "Unknown"
                    _yr_totals_yf: Dict[int, float] = {}
                    for _dt, _amt in divs.items():
                        _yr = _dt.year
                        _yr_totals_yf[_yr] = round(_yr_totals_yf.get(_yr, 0.0) + float(_amt), 4)
                    dist_info = {
                        "last_dividend": last_div,
                        "last_ex_date":  last_ex_date,
                        "last_pay_date": "",
                        "ttm_total":     ttm_div,
                        "ttm_yield_pct": ttm_yield,
                        "frequency":     freq,
                        "source":        "yfinance",
                        "history":       [{"date": str(d.date()), "amount": round(float(v), 4)}
                                          for d, v in divs.tail(8).items()],
                        "annual_history": [
                            {"year": _yr, "total": _tot}
                            for _yr, _tot in sorted(_yr_totals_yf.items())
                        ],
                    }
            except Exception:
                pass

        result["distributions"] = dist_info

        # ── 12. Risk statistics vs SPY + QQQ correlation ─────────────────────
        result["risk_stats"] = {}
        spy_c_rs: list = []
        spy_d_rs: list = []
        try:
            spy_hist_rs = yf.Ticker("SPY").history(period="10y", auto_adjust=True)
            if not spy_hist_rs.empty:
                spy_c_rs = spy_hist_rs["Close"].values.astype(float)
                spy_d_rs = [str(d.date()) for d in spy_hist_rs.index]
                result["risk_stats"] = _risk_stats(adj_closes, adj_dates, spy_c_rs, spy_d_rs, years=3)
                result["risk_stats"]["benchmark"] = "SPY"
        except Exception:
            pass

        # QQQ correlation (3Y, same window as SPY risk stats)
        try:
            _qqq = yf.Ticker("QQQ").history(period="3y", auto_adjust=True)
            if not _qqq.empty:
                _qqq_c = _qqq["Close"].values.astype(float)
                _qqq_d = [str(d.date()) for d in _qqq.index]
                _fr, _qr = _align_series(adj_closes[-756:], adj_dates[-756:], _qqq_c, _qqq_d)
                if len(_fr) >= 30:
                    _cq = _safe_corr(_fr, _qr)
                    if _cq is not None:
                        result["risk_stats"]["corr_qqq"] = round(_cq, 3)
        except Exception:
            pass

        # ── 13. Annualized / quarterly returns table ──────────────────────────
        ann_periods = [1, 3, 5, 10]
        symbol_ann = {f"{y}Y": _annualized_ret(adj_closes, adj_dates, y) for y in ann_periods}
        # Inception
        if len(adj_closes) > 0:
            n_years = len(adj_closes) / 252
            if n_years >= 1:
                inc_ret = round(((adj_closes[-1] / adj_closes[0]) ** (1 / n_years) - 1) * 100, 2)
                symbol_ann["Inception"] = inc_ret
        spy_ann = {}
        try:
            spy_c_a = spy_c_rs if 'spy_c_rs' in dir() else []
            spy_d_a = spy_d_rs if 'spy_d_rs' in dir() else []
            spy_ann = {f"{y}Y": _annualized_ret(np.array(spy_c_a), spy_d_a, y) for y in ann_periods} if len(spy_c_a) > 0 else {}
        except Exception:
            pass

        result["annualized_returns"] = {
            "symbol": symbol_ann,
            "spy":    spy_ann,
        }

        # ── 13b. NAV / price trend metrics (ETFs & CEFs only) ────────────────
        # For open-end ETFs the creation/redemption mechanism keeps market price
        # within ~0.1% of NAV, so price trend ≈ NAV trend.
        # For CEFs, price can diverge significantly — treat as a directional proxy.
        nav_metrics: dict = {}
        if _sc.get("show_nav_analysis"):
            def _pct_chg(start_idx: int) -> Optional[float]:
                if start_idx >= len(adj_closes) or adj_closes[start_idx] == 0:
                    return None
                return round((float(adj_closes[-1]) / float(adj_closes[start_idx]) - 1) * 100, 2)

            p3m  = _pct_chg(_period_idx(adj_dates, n_trading_days=63))
            p6m  = _pct_chg(_period_idx(adj_dates, n_trading_days=126))
            p12m = _pct_chg(_period_idx(adj_dates, n_trading_days=252))
            p3y  = _pct_chg(_period_idx(adj_dates, n_trading_days=756))
            p5y  = _pct_chg(_period_idx(adj_dates, n_trading_days=1260))

            def _slope(pct):
                if pct is None: return "N/A"
                return "Up" if pct > 3 else "Down" if pct < -3 else "Flat"

            # Annual NAV history: year-end close → YoY % change
            _yr_close: Dict[int, float] = {}
            for _dt_str, _cl in zip(adj_dates, adj_closes):
                _yr_close[int(_dt_str[:4])] = float(_cl)
            _yr_sorted = sorted(_yr_close.keys())
            _annual_nav: list = []
            for i, yr in enumerate(_yr_sorted[1:], 1):
                prev_yr = _yr_sorted[i - 1]
                if _yr_close[prev_yr] != 0:
                    chg = round((_yr_close[yr] / _yr_close[prev_yr] - 1) * 100, 2)
                    _annual_nav.append({"year": yr, "change_pct": chg})

            nav_metrics = {
                "price_3m_pct":   p3m,
                "price_6m_pct":   p6m,
                "price_12m_pct":  p12m,
                "price_3y_pct":   p3y,
                "price_5y_pct":   p5y,
                "trend_3m":       _slope(p3m),
                "trend_6m":       _slope(p6m),
                "trend_12m":      _slope(p12m),
                "trend_3y":       _slope(p3y),
                "trend_5y":       _slope(p5y),
                "annual_nav_history": _annual_nav,
                "is_price_proxy": _sc.get("type") in ("ETF", "BOND_ETF"),
                "note": ("Price ≈ NAV for open-end ETFs (creation/redemption mechanism)."
                         if _sc.get("type") in ("ETF", "BOND_ETF")
                         else "Price may diverge from NAV for CEFs — treat as directional proxy only."),
            }
            # ROC risk: high yield + declining price → likely return-of-capital
            _ttm_yield = float(
                result["distributions"].get("ttm_yield_pct") or
                result["distributions"].get("market_yield_pct") or 0)
            if p12m is not None and p12m < -5 and _ttm_yield > 10:
                nav_metrics["roc_risk"] = True
                nav_metrics["roc_note"] = (
                    f"Price −{abs(p12m):.1f}% over 12M while yield {_ttm_yield:.1f}% — "
                    f"a significant portion of distributions may be return of capital (NAV erosion).")
            else:
                nav_metrics["roc_risk"] = False

        result["nav_metrics"] = nav_metrics

        # ── 14. Fund strategy / description ───────────────────────────────────
        result["fund_strategy"] = info.get("longBusinessSummary") or info.get("description") or ""

        # ── 15. Trading price levels ──────────────────────────────────────────
        # Active tier determined by 1-hour volume pace + intraday price velocity.
        # vol_1h_rate > 2× avg hourly  →  extreme   (market surging/crashing)
        # vol_1h_rate > 1.5× avg hourly → high_vol  (elevated activity)
        # otherwise                      → normal    (calm session)
        if _vol_1h_rate > 2.0 or _intraday_move_pct > 2.0:
            _active_tier = "extreme"
        elif _vol_1h_rate > 1.5 or _intraday_move_pct > 1.0:
            _active_tier = "high_vol"
        else:
            _active_tier = "normal"

        # ATR (14/20-period Average True Range, Wilder-smoothed) — the single
        # source of volatility scaling for every entry/exit price below,
        # instead of a fixed % of price. Multipliers come from rules.json's
        # _ATR_PRICE_RULES block, never a hardcoded symbol.
        import atr_utils
        import json as _json
        import os as _os
        _atr14 = atr_utils.compute_atr(raw_highs, raw_lows, raw_closes, period=14)
        _atr20 = atr_utils.compute_atr(raw_highs, raw_lows, raw_closes, period=20)
        if _atr14 is not None:
            _atr14 = round(_atr14, 2)
        if _atr20 is not None:
            _atr20 = round(_atr20, 2)
        try:
            _rules_path = _os.path.join(_os.path.dirname(__file__), '..', 'rules.json')
            with open(_rules_path) as _rf:
                _atr_rules = _json.load(_rf).get('_ATR_PRICE_RULES', {})
        except Exception:
            _atr_rules = {}

        # ── Volatility Structure (NR/WR bars) ────────────────────────────────
        # NR4: today's range < min of prior 3 days' ranges → compression
        # NR7: today's range < min of prior 6 days' ranges → strong compression
        # WR7: today's range > max of prior 6 days' ranges → expansion
        # WR10: today's range > max of prior 9 days' ranges → strong expansion
        _vol_structure = {}
        if len(raw_highs) >= 10 and len(raw_lows) >= 10:
            _ranges = [raw_highs[-_i] - raw_lows[-_i] for _i in range(1, 11)]
            _today_range = _ranges[0]
            _nr4  = _today_range < min(_ranges[1:4])  if len(_ranges) >= 4  else None
            _nr7  = _today_range < min(_ranges[1:7])  if len(_ranges) >= 7  else None
            _wr7  = _today_range > max(_ranges[1:7])  if len(_ranges) >= 7  else None
            _wr10 = _today_range > max(_ranges[1:10]) if len(_ranges) >= 10 else None
            # Average daily range over last 5 / 10 days
            _avg_range_5d  = round(float(np.mean(_ranges[:5])),  2) if len(_ranges) >= 5  else None
            _avg_range_10d = round(float(np.mean(_ranges[:10])), 2) if len(_ranges) >= 10 else None
            # Range % of price
            _range_pct_today = round(_today_range / raw_closes[-1] * 100, 2) if raw_closes[-1] > 0 else None
            # Volatility slope: ratio of 5-day avg range to 10-day avg range
            # > 1.0 = expanding  < 1.0 = compressing
            _vol_slope = round(_avg_range_5d / _avg_range_10d, 3) if _avg_range_10d else None
            # Compression score: how tight is today vs the 10-day median range?
            _median_range_10d = float(np.median(_ranges[:10]))
            _compression_score = max(0, min(100, int((1 - _today_range / _median_range_10d) * 100))) \
                if _median_range_10d > 0 else 0
            _vol_structure = {
                "nr4":               bool(_nr4)  if _nr4  is not None else None,
                "nr7":               bool(_nr7)  if _nr7  is not None else None,
                "wr7":               bool(_wr7)  if _wr7  is not None else None,
                "wr10":              bool(_wr10) if _wr10 is not None else None,
                "today_range":       round(_today_range, 2),
                "avg_range_5d":      _avg_range_5d,
                "avg_range_10d":     _avg_range_10d,
                "range_pct_today":   _range_pct_today,
                "vol_slope":         _vol_slope,       # > 1 expanding, < 1 compressing
                "compression_score": _compression_score,  # 0=wide 100=extremely tight
                "signal":            "NR7 — compression (breakout watch)" if _nr7
                                     else "NR4 — mild compression" if _nr4
                                     else "WR10 — strong expansion (high vol)" if _wr10
                                     else "WR7 — expansion" if _wr7
                                     else "Normal range",
            }

        # ── Torque Engine ─────────────────────────────────────────────────────
        # Torque = directional velocity × consistency. Measures how explosive
        # and reliable the ticker's daily moves are relative to its beta.
        _torque_engine = {}
        # Beta from profile (set early) — risk_stats_out not yet computed at this point
        _beta_val = result.get("profile", {}).get("beta")
        if _vol_structure and _atr14 and live_price > 0:
            _rng_pct    = _vol_structure.get("range_pct_today", 0) or 0
            _avg_rng_5d = _vol_structure.get("avg_range_5d", 0) or 0
            _avg_rng_10 = _vol_structure.get("avg_range_10d", 0) or 0
            # Beta-normalized torque: range% ÷ beta → adjusts for market sensitivity
            _beta_n = max(0.1, float(_beta_val)) if _beta_val else 1.0
            _beta_torque = round(_rng_pct / _beta_n, 2)
            # ATR ratio: today's ATR vs 20-day ATR (momentum vs historical)
            _atr_ratio = round(_atr14 / _atr20, 3) if _atr20 and _atr20 > 0 else None
            # Torque score 0–100: blend of compression (NR = low torque opportunity)
            # and recent expansion trend
            _vs = _vol_slope if (_vol_structure.get("vol_slope") is not None) else 1.0
            _raw_torque = min(100, max(0, int(
                _beta_torque * 15              # range relative to beta (0-30 range)
                + (_vs - 1) * 30              # vol slope contribution
                + ((_atr_ratio or 1) - 1) * 20  # ATR acceleration
                + (50 if _rng_pct > (_avg_rng_5d / live_price * 100 * 1.5) else 0)  # shock day bonus
            )))
            _shock_day = bool(_avg_rng_5d > 0 and _today_range > _avg_rng_5d * 2.0) \
                if _vol_structure else False
            _torque_engine = {
                "atr_14":          _atr14,
                "atr_20":          _atr20,
                "atr_ratio":       _atr_ratio,    # > 1 = accelerating, < 1 = decelerating
                "range_pct_today": _rng_pct,
                "beta_torque":     _beta_torque,  # range% ÷ beta
                "vol_slope":       _vol_structure.get("vol_slope"),
                "shock_day":       _shock_day,    # range > 2× 5-day avg
                "torque_score":    _raw_torque,   # 0–100 composite
                "torque_label":    "HIGH" if _raw_torque >= 70
                                   else "MEDIUM" if _raw_torque >= 40
                                   else "LOW",
            }

        # ── Intraday Pressure (Gap + Pressure classification) ─────────────────
        _intraday_pressure = {}
        _q = result.get("quote", {})
        _qopen     = _q.get("open")
        _qhigh     = _q.get("day_high")
        _qlow      = _q.get("day_low")
        _qprev     = _q.get("prev_close")
        _qprice    = live_price
        if _qopen and _qprev and _qhigh and _qlow:
            _gap_amt      = round(_qopen - _qprev, 2)
            _gap_pct      = round(_gap_amt / _qprev * 100, 3) if _qprev > 0 else 0
            _gap_filled   = bool((_gap_amt > 0 and _qprice <= _qprev) or \
                            (_gap_amt < 0 and _qprice >= _qprev))
            _intra_delta  = round(_qprice - _qopen, 2)
            _intra_pct    = round(_intra_delta / _qopen * 100, 3) if _qopen > 0 else 0
            _sess_range   = _qhigh - _qlow
            _close_pos    = round((_qprice - _qlow) / _sess_range * 100, 1) \
                            if _sess_range > 0 else None
            # Pressure classification (same logic as Balance History)
            _is_up   = _qprice > _qopen
            _is_down = _qprice < _qopen
            _dod_pct = (_qprice - _qprev) / _qprev * 100 if _qprev > 0 else 0
            if _qopen < _qprev and _qprice > _qprev:
                _pressure = "Reversal Up"
            elif _qopen > _qprev and _qprice < _qprev:
                _pressure = "Reversal Down"
            elif _is_up and (_gap_amt >= 0 or _dod_pct > 0.5):
                _pressure = "Strong Buy"
            elif _is_up:
                _pressure = "Weak Buy"
            elif _is_down and (_gap_amt <= 0 or _dod_pct < -0.5):
                _pressure = "Strong Sell"
            elif _is_down:
                _pressure = "Weak Sell"
            else:
                _pressure = "Flat"
            _intraday_pressure = {
                "gap_amt":      _gap_amt,
                "gap_pct":      _gap_pct,
                "gap_dir":      "up" if _gap_amt > 0 else "down" if _gap_amt < 0 else "flat",
                "gap_filled":   _gap_filled,
                "intra_delta":  _intra_delta,
                "intra_pct":    _intra_pct,
                "close_pos_pct": _close_pos,  # 0=at low, 100=at high
                "session_range": round(_sess_range, 2),
                "pressure":     _pressure,
            }

        # ── Cycle Position Engine (Leg-1 / Leg-2 / Leg-3 / Chop) ────────────
        # Deterministic spec from Copilot — rules applied in priority order:
        # Step 3 (Leg-3 exhaustion) checked first, then Step 1 (ignition),
        # then Step 2 (mature), then Chop as default.
        _cycle_engine = {}
        try:
            _n = len(raw_closes)
            if _n >= 21 and ma20 and ma50 and rsi14 is not None:

                # ── Step 0: Pre-filters ──────────────────────────────────────
                _c0   = float(raw_closes[-1])
                _ma20f = float(ma20)
                _ma50f = float(ma50)

                _trend_up      = _c0 > _ma20f and _ma20f > _ma50f
                _trend_down    = _c0 < _ma20f and _ma20f < _ma50f
                _trend_neutral = not _trend_up and not _trend_down

                _rsi_val     = float(rsi14)
                _rsi_low     = _rsi_val < 40
                _rsi_extreme = _rsi_val > 75
                _rsi_high    = 60 < _rsi_val <= 75
                _rsi_mid_low = 35 <= _rsi_val <= 55
                _rsi_leg2_up = 50 <= _rsi_val <= 70
                _rsi_leg2_dn = 30 <= _rsi_val <= 50

                # RSI direction: compare current to 3 bars ago using close momentum
                # (full RSI history computation is expensive; use price-momentum proxy)
                _rsi_rising  = bool(_n >= 6 and (raw_closes[-1] > raw_closes[-4]))
                _rsi_falling = bool(_n >= 6 and (raw_closes[-1] < raw_closes[-4]))

                _compressed = bool(_vol_structure.get("nr4") or _vol_structure.get("nr7"))
                _expanded   = bool(_vol_structure.get("wr7") or _vol_structure.get("wr10"))

                # Run counters: consecutive closes in same direction (max 15 bars)
                _up_run   = 0
                _dn_run   = 0
                for _ri in range(1, min(15, _n)):
                    if raw_closes[-_ri] > raw_closes[-_ri - 1]:
                        if _up_run == _ri - 1: _up_run += 1
                    else:
                        break
                for _ri in range(1, min(15, _n)):
                    if raw_closes[-_ri] < raw_closes[-_ri - 1]:
                        if _dn_run == _ri - 1: _dn_run += 1
                    else:
                        break

                # ATR% percentile: is today's ATR in top 20% of last 20 days?
                _atr_pcts = []
                for _ri in range(1, min(22, _n)):
                    _d_atr = max(
                        raw_highs[-_ri] - raw_lows[-_ri],
                        abs(raw_highs[-_ri] - raw_closes[-_ri - 1]) if _ri + 1 < _n else 0,
                        abs(raw_lows[-_ri]  - raw_closes[-_ri - 1]) if _ri + 1 < _n else 0,
                    )
                    _atr_pcts.append(_d_atr / raw_closes[-_ri] * 100 if raw_closes[-_ri] > 0 else 0)
                _atr_pct_now  = (_atr14 / _c0 * 100) if _atr14 and _c0 > 0 else 0
                _atr_p80      = float(np.percentile(_atr_pcts, 80)) if _atr_pcts else _atr_pct_now
                _atr_elevated = bool(_atr_pct_now >= _atr_p80)

                # Volume ratio vs 20-day avg
                _vol_ratio = float(hist_raw["Volume"].iloc[-1]) / avg_v20 if avg_v20 > 0 else 1.0

                # Gap %
                _gap_pct_v = _intraday_pressure.get("gap_pct") or 0.0

                # Pullback depth: max recent drawdown from 20-day high
                _high20 = float(np.max(raw_highs[-20:])) if _n >= 20 else float(np.max(raw_highs))
                _pullback_pct = round((_high20 - _c0) / _high20 * 100, 2) if _high20 > 0 else 0.0

                # Maturity = run_length / max_expected_run (normalised 0–100)
                _current_run = _up_run if (_trend_up or _up_run > _dn_run) else _dn_run
                _maturity    = min(100, int(_current_run / 10 * 100))

                # ── Priority Rule 1: Leg-3 (Exhaustion) — checked first ──────
                _leg = None

                if _trend_up and _rsi_extreme and (_expanded or _atr_elevated) and _up_run >= 3:
                    _leg   = "Leg3_Up"
                    _score = min(100, 70 + _up_run * 3)
                    _flags = {"is_exhaustion": True, "is_ignition": False, "is_mature": False}

                elif _trend_down and _rsi_val < 25 and (_expanded or _atr_elevated) and _dn_run >= 3:
                    _leg   = "Leg3_Down"
                    _score = min(100, 70 + _dn_run * 3)
                    _flags = {"is_exhaustion": True, "is_ignition": False, "is_mature": False}

                # ── Priority Rule 2: Leg-1 (Ignition / Early) ─────────────────
                elif _trend_up and _rsi_mid_low and _rsi_rising and _up_run <= 3 and (
                    (_compressed and not _expanded)           # compression breaking out
                    or (_gap_pct_v >= 0.5 and _vol_ratio >= 1.2)  # gap-up on volume
                ):
                    _leg   = "Leg1_Up"
                    _score = 40 + _up_run * 5
                    _flags = {"is_exhaustion": False, "is_ignition": True, "is_mature": False}

                elif _trend_down and 45 <= _rsi_val <= 65 and _rsi_falling and _dn_run <= 3 and (
                    (_compressed and not _expanded)
                    or (_gap_pct_v <= -0.5 and _vol_ratio >= 1.2)
                ):
                    _leg   = "Leg1_Down"
                    _score = 40 + _dn_run * 5
                    _flags = {"is_exhaustion": False, "is_ignition": True, "is_mature": False}

                # ── Priority Rule 3: Leg-2 (Mature / Main Move) ───────────────
                elif _trend_up and _rsi_leg2_up and _up_run >= 2 and not _atr_elevated:
                    _leg   = "Leg2_Up"
                    _score = min(90, 60 + _up_run * 3)
                    _flags = {"is_exhaustion": False, "is_ignition": False, "is_mature": True}

                elif _trend_down and _rsi_leg2_dn and _dn_run >= 2 and not _atr_elevated:
                    _leg   = "Leg2_Down"
                    _score = min(90, 60 + _dn_run * 3)
                    _flags = {"is_exhaustion": False, "is_ignition": False, "is_mature": True}

                # ── Rule 4: Chop / Neutral (default) ─────────────────────────
                else:
                    _price_vs_ma20_band = abs(_c0 - _ma20f) / _c0 * 100
                    _leg   = "Chop"
                    _score = min(30, int(_price_vs_ma20_band * 3))
                    _flags = {"is_exhaustion": False, "is_ignition": False, "is_mature": False}

                # Leg label (human-readable)
                _leg_labels = {
                    "Leg1_Up":   "Leg 1 — Ignition (Up)",
                    "Leg1_Down": "Leg 1 — Ignition (Down)",
                    "Leg2_Up":   "Leg 2 — Mature Move (Up)",
                    "Leg2_Down": "Leg 2 — Mature Move (Down)",
                    "Leg3_Up":   "Leg 3 — Exhaustion (Up)",
                    "Leg3_Down": "Leg 3 — Exhaustion (Down)",
                    "Chop":      "Chop / Neutral",
                }

                # Entry guidance based on leg
                _entry_guidance = {
                    "Leg1_Up":   "New positions OK — early ignition. Use normal sizing.",
                    "Leg1_Down": "Avoid new longs. Leg-1 decline in progress.",
                    "Leg2_Up":   "Trend intact — add on pullbacks. Sizing: standard.",
                    "Leg2_Down": "Reduce exposure. Main downtrend in progress.",
                    "Leg3_Up":   "No new buys. Trim / take profit. Exhaustion risk.",
                    "Leg3_Down": "Capitulation zone. Watch for reversal signals.",
                    "Chop":      "No directional edge. Wait for leg to form.",
                }

                _cycle_engine = {
                    "leg":           _leg,
                    "leg_label":     _leg_labels.get(_leg, _leg),
                    "cycle_score":   _score,
                    "maturity":      _maturity,
                    "up_run":        _up_run,
                    "down_run":      _dn_run,
                    "pullback_pct":  _pullback_pct,
                    "trend_up":      bool(_trend_up),
                    "trend_down":    bool(_trend_down),
                    "rsi_val":       round(_rsi_val, 1),
                    "atr_pct":       round(float(_atr_pct_now), 2),
                    "atr_elevated":  bool(_atr_elevated),
                    "vol_ratio":     round(float(_vol_ratio), 2),
                    "compressed":    bool(_compressed),
                    "expanded":      bool(_expanded),
                    "entry_guidance": _entry_guidance.get(_leg, ""),
                    **_flags,
                }
        except Exception as _ce:
            _cycle_engine = {"error": str(_ce)}

        # Recent high (21 days) — Alert Engine's 21d-high reference.
        _high_21d = round(float(np.max(raw_highs[-21:])), 2) if len(raw_highs) >= 21 else None

        # Determine overall buy/sell signal based on technicals
        _price_vs_ma20_pct  = ((live_price - ma20) / ma20 * 100) if ma20 else 0
        _price_vs_ma50_pct  = ((live_price - ma50) / ma50 * 100) if ma50 else 0
        _price_vs_ma200_pct = ((live_price - ma200) / ma200 * 100) if ma200 else 0

        # ── Condition-based verdict (strict rules, not just a score) ─────────
        # Each buy tier requires BOTH price position AND RSI conditions to be met.
        # Sell tiers trigger on hard technical breaks.
        # HOLD is the default until a specific condition fires.

        _p20  = _price_vs_ma20_pct   # % vs 20MA (positive = above)
        _p50  = _price_vs_ma50_pct   # % vs 50MA
        _rsi_val = rsi14 if rsi14 is not None else 50.0
        _abv_bbu = (bb_upper is not None and live_price >= bb_upper)

        # Strict buy conditions (evaluated in priority order)
        _cond_strong_buy = (ma20 is not None and live_price < ma20 and _rsi_val < 40)
        _cond_buy_normal = (ma20 is not None and abs(_p20) <= 2.0 and _rsi_val <= 70)
        _cond_buy_hisvol = (ma20 is not None and live_price < ma20 * 1.05 and _rsi_val <= 70
                            and not _cond_strong_buy and not _cond_buy_normal)

        # Sell / exit conditions — 0.25% buffer avoids false signals from 1-cent noise
        _BREAK_BUFFER    = 0.9975   # price must be 0.25% below MA to count as a break
        _cond_sell_all   = (ma50 is not None and live_price < ma50 * _BREAK_BUFFER)
        _cond_sell_50    = (ma20 is not None and live_price < ma20 * _BREAK_BUFFER and _rsi_val >= 40)
        _cond_take_50    = (_rsi_val > 80)
        _cond_take_25    = _abv_bbu

        # Derive today's verdict (first match wins, sell > buy)
        if _cond_sell_all:
            _today_verdict  = "SELL ALL"
            _verdict_color  = "red"
            _sizing_pct     = 0
            _verdict_reason = f"Price {live_price:.2f} below 50MA ({ma50:.2f}) by >0.25% — trend broken"
        elif _cond_sell_50:
            _today_verdict  = "TRIM 50%"
            _verdict_color  = "orange"
            _sizing_pct     = 0
            _verdict_reason = f"Price broke below 20MA (${ma20:.2f})"
        elif _cond_take_50:
            _today_verdict  = "TAKE PROFIT 50%"
            _verdict_color  = "orange"
            _sizing_pct     = 0
            _verdict_reason = f"RSI {_rsi_val:.0f} — extreme overbought (>80)"
        elif _cond_take_25:
            _today_verdict  = "TAKE PROFIT 25%"
            _verdict_color  = "orange"
            _sizing_pct     = 0
            _verdict_reason = f"Price above Bollinger Upper (${bb_upper:.2f})"
        elif _cond_strong_buy:
            _today_verdict  = "STRONG BUY"
            _verdict_color  = "green"
            _sizing_pct     = 100
            _verdict_reason = f"Price below 20MA and RSI {_rsi_val:.0f} < 40 — oversold dip"
        elif _cond_buy_normal:
            _today_verdict  = "BUY"
            _verdict_color  = "green"
            _sizing_pct     = 50
            _verdict_reason = f"Price within ±2% of 20MA (${ma20:.2f}) and RSI neutral"
        elif _cond_buy_hisvol:
            _today_verdict  = "BUY (HI-VOL)"
            _verdict_color  = "green"
            _sizing_pct     = 25
            _verdict_reason = f"Price within 5% of 20MA, not overbought"
        else:
            _today_verdict  = "HOLD"
            _verdict_color  = "neutral"
            _sizing_pct     = 0
            _p20_str = f"{_p20:+.1f}%"
            _verdict_reason = f"No buy trigger met — price {_p20_str} vs 20MA, RSI {_rsi_val:.0f}"

        # Alert price: the nearest buy trigger level
        if ma20 is not None:
            _alert_price = round(ma20, 2)
            _alert_label = "20-day MA (Strong Buy trigger)"
        else:
            _alert_price = None
            _alert_label = ""

        # CEF premium hard-block: never buy a CEF trading at a premium to NAV
        # (overrides any BUY signal — only applies to CEFs, not regular ETFs)
        if (_sc.get("type") == "CEF" and prem_disc > 0.005
                and not _cond_sell_all and not _cond_sell_50):
            if _cond_strong_buy or _cond_buy_normal or _cond_buy_hisvol:
                _today_verdict  = "WAIT (Premium)"
                _verdict_color  = "orange"
                _sizing_pct     = 0
                _verdict_reason = (
                    f"Buy trigger met but CEF at +{prem_disc*100:.1f}% premium to NAV — "
                    f"wait for discount or NAV to catch up to price")
                _cond_strong_buy = False
                _cond_buy_normal = False
                _cond_buy_hisvol = False

        # ETF option-income: soften sell signals — these funds often sit below MAs by design
        if _sc.get("subtype") == "option-income" and _cond_sell_all and not _cond_sell_50:
            _today_verdict  = "MONITOR"
            _verdict_color  = "neutral"
            _sizing_pct     = 0
            _verdict_reason = (
                f"Option-income ETF below 50MA — normal for capped-upside strategy. "
                f"Monitor distribution coverage, not price trend")
            _cond_sell_all = False

        # Buy trigger status checks (for the decision summary table)
        _buy_triggered  = _cond_strong_buy or _cond_buy_normal or _cond_buy_hisvol
        _sell_triggered = _cond_sell_all or _cond_sell_50 or _cond_take_25 or _cond_take_50

        # ── 3-Trigger Entry Signal System ─────────────────────────────────────
        # Independent triggers — any one firing activates a buy signal.
        # Final composite = max(t1, t2, t3):  0=no signal  1=BUY  2=STRONG BUY
        #
        # Trigger 1 — Pullback Rule (primary; gives max share count)
        #   Price at/below the ATR-scaled Buy level        → BUY
        #   Price at/below the ATR-scaled Strong Buy level  → STRONG BUY
        # (levels are high_20d minus a multiple of ATR-14 — see _price_stack
        #  below — so the pullback needed to trigger scales with each
        #  symbol's own volatility instead of a fixed %.)
        _high_20d = round(float(np.max(raw_highs[-20:])), 2) if len(raw_highs) >= 20 else None
        _pullback_20d_pct = (
            (_high_20d - live_price) / _high_20d * 100
            if _high_20d and _high_20d > 0 else 0.0
        )

        # Higher-volatility names get a different anchor, blended in smoothly
        # (not a hard cutoff — a binary switch only fixed the most extreme
        # names and left moderate ones, e.g. ATR ~2-3% of price, unadjusted,
        # which could still coincidentally land the buy price right next to
        # the current price). A name with a large ATR relative to its own
        # price can have a 20d high that was itself a blow-off top with no
        # reversion value, so as ATR% rises from low_vol_atr_pct to
        # high_vol_atr_pct the anchor blends from the 20d high toward MA50
        # (trend-following) with a correspondingly blended ATR. Below
        # low_vol_atr_pct the anchor is purely the 20d high (unchanged for
        # calm names like ADX); at/above high_vol_atr_pct it's purely MA50.
        # Thresholds and behavior are config-driven (rules.json
        # ._ATR_PRICE_RULES.entry) — never keyed off a symbol name.
        _atr_pct_of_price = (_atr14 / live_price * 100) if (_atr14 and live_price) else 0.0
        _entry_cfg    = _atr_rules.get("entry", {})
        _low_vol_pct  = _entry_cfg.get("anchor_blend_low_vol_atr_pct", 1.5)
        _high_vol_pct = _entry_cfg.get("anchor_blend_high_vol_atr_pct", 5.0)
        _atr_blend_val = ((_atr14 + _atr20) / 2) if (_atr14 and _atr20) else _atr14

        if ma50 is not None and _high_vol_pct > _low_vol_pct:
            _ma50_weight = max(0.0, min(1.0, (_atr_pct_of_price - _low_vol_pct) / (_high_vol_pct - _low_vol_pct)))
        else:
            _ma50_weight = 0.0

        if _high_20d is None:
            _entry_anchor, _entry_atr = ma50, _atr_blend_val
        elif _ma50_weight <= 0:
            _entry_anchor, _entry_atr = _high_20d, _atr14
        elif _ma50_weight >= 1:
            _entry_anchor, _entry_atr = ma50, _atr_blend_val
        else:
            _entry_anchor = _ma50_weight * ma50 + (1 - _ma50_weight) * _high_20d
            _entry_atr    = _ma50_weight * _atr_blend_val + (1 - _ma50_weight) * _atr14

        _entry_anchor_label = (
            "ma50" if (_high_20d is None or _ma50_weight >= 1) else
            "high_20d" if _ma50_weight <= 0 else
            "blend"
        )
        _price_stack = atr_utils.atr_price_stack(_entry_anchor, live_price, _entry_atr, _atr_rules)
        if _price_stack["strong_buy_price"] is not None and live_price <= _price_stack["strong_buy_price"]:
            _trigger_pullback = 2
        elif _price_stack["buy_price"] is not None and live_price <= _price_stack["buy_price"]:
            _trigger_pullback = 1
        else:
            _trigger_pullback = 0

        # Trigger 2 — Breakout Rule (momentum; catches new legs up without a dip)
        #   Close ≥ 52-week high (ATH proxy) AND today volume > 20d avg volume
        _price_at_ath   = w52_high > 0 and live_price >= w52_high * 0.9995
        _vol_confirming = avg_v20 > 0 and volume_live > avg_v20
        _trigger_breakout = 1 if (_price_at_ath and _vol_confirming) else 0

        # Trigger 3 — Oversold Rule (mean reversion; catches washed-out shakeouts)
        #   RSI(14) < 40 AND price < 20-day MA
        _trigger_oversold = (
            1 if (rsi14 is not None and rsi14 < 40
                  and ma20 is not None and live_price < ma20)
            else 0
        )

        # Composite signal: max of the three independent triggers
        _composite_signal = max(_trigger_pullback, _trigger_breakout, _trigger_oversold)
        _composite_labels = {0: "NO SIGNAL", 1: "BUY", 2: "STRONG BUY"}
        _composite_label  = _composite_labels[_composite_signal]

        # Which triggers are active (for display)
        _active_triggers: list[str] = []
        if _trigger_pullback == 2:   _active_triggers.append(f"Pullback {_pullback_20d_pct:.1f}% off 20d high → STRONG BUY")
        elif _trigger_pullback == 1: _active_triggers.append(f"Pullback {_pullback_20d_pct:.1f}% off 20d high → BUY")
        if _trigger_breakout:        _active_triggers.append(f"Breakout ≥ 52w high w/ vol {volume_live/avg_v20:.1f}× avg → BUY")
        if _trigger_oversold:        _active_triggers.append(f"Oversold: RSI {rsi14:.0f} < 40 & price < MA20 → BUY")

        # Bullish momentum score (renamed from signal_score — informational only)
        _sig_score = 0
        if rsi14 is not None:
            if rsi14 < 30:   _sig_score += 2
            elif rsi14 < 40: _sig_score += 1
            elif rsi14 > 80: _sig_score -= 2
            elif rsi14 > 70: _sig_score -= 1
        if ma20 and live_price < ma20: _sig_score -= 1
        if ma50 and live_price < ma50: _sig_score -= 1
        if ma20 and live_price > ma20: _sig_score += 1
        if ma50 and live_price > ma50: _sig_score += 1
        if macd_bull:  _sig_score += 1
        else:          _sig_score -= 1

        # Legacy label kept for colour-coding only (NOT used for buy/sell decisions)
        _signal_label = _today_verdict

        result["trading_levels"] = {
            "active_tier":          _active_tier,
            # ── ATR-scaled price stack (single source of truth for the
            # Research tab's entry/exit prices — see atr_utils.atr_price_stack) ──
            "buy_price":            _price_stack["buy_price"],
            "strong_buy_price":     _price_stack["strong_buy_price"],
            "limit_price":          _price_stack["limit_price"],
            "entry_anchor":         _entry_anchor,
            "entry_anchor_label":   _entry_anchor_label,   # "high_20d" | "ma50" | "blend"
            "take_profit":          _price_stack["take_profit"],
            "stop_loss":            _price_stack["stop_price"],
            "rr_ratio":             _price_stack["rr_ratio"],
            "vol_1h":               _vol_1h,
            "vol_1h_rate":          round(_vol_1h_rate, 2),
            "intraday_move_pct":    round(_intraday_move_pct, 2),
            "premium_discount_pct": round(prem_disc * 100, 4),
            "nav":                  nav_price,
            # Decision box data
            "atr_14":               _atr14,
            "high_21d":             _high_21d,
            "price_vs_ma20_pct":    round(_price_vs_ma20_pct, 2),
            "price_vs_ma50_pct":    round(_price_vs_ma50_pct, 2),
            "price_vs_ma200_pct":   round(_price_vs_ma200_pct, 2),
            "signal_score":         _sig_score,
            "signal_label":         _signal_label,
            # Today's decision (condition-based, not score-based)
            "verdict_reason":       _verdict_reason,
            "sizing_pct":           _sizing_pct,
            "alert_price":          _alert_price,
            "alert_label":          _alert_label,
            "buy_triggered":        bool(_buy_triggered),
            "sell_triggered":       bool(_sell_triggered),
            # ── 3-Trigger entry system ──────────────────────────────────────
            "high_20d":             _high_20d,
            "pullback_20d_pct":     round(_pullback_20d_pct, 2),
            "trigger_pullback":     _trigger_pullback,    # 0/1/2
            "trigger_breakout":     _trigger_breakout,   # 0/1
            "trigger_oversold":     _trigger_oversold,   # 0/1
            "composite_signal":     _composite_signal,   # 0=none 1=buy 2=strong buy
            "composite_label":      _composite_label,
            "active_triggers":      _active_triggers,    # human-readable reasons
            "avg_vol_20d":          avg_v20,
        }

        # ── 15b. Volatility Structure / Torque / Intraday Pressure / Cycle ───
        result["volatility_structure"] = _vol_structure
        result["torque_engine"]        = _torque_engine
        result["intraday_pressure"]    = _intraday_pressure
        result["cycle_engine"]         = _cycle_engine

        # ── 15d. Multi-Timeframe Alignment Engine ─────────────────────────────
        # 5 timeframes: D1(50%), H4(20%), H1(15%), M30(10%), M15(5%)
        # Trend rule: Close > MA20 > MA50 → up | Close < MA20 < MA50 → down | else → neutral
        # Score: 50 + 50×Σ(weight×trend) where up=+1, neutral=0, down=-1
        _mtf_engine = {}
        try:
            # Helper: compute trend state from a price series (numpy array of closes)
            def _tf_trend(closes_arr):
                if len(closes_arr) < 52:
                    return None
                _c   = float(closes_arr[-1])
                _m20 = float(np.mean(closes_arr[-20:]))
                _m50 = float(np.mean(closes_arr[-50:]))
                if _c > _m20 and _m20 > _m50: return "up"
                if _c < _m20 and _m20 < _m50: return "down"
                return "neutral"

            # D1 trend — from existing hist_raw (already fetched, no extra call)
            _d1_trend = _tf_trend(raw_closes) if len(raw_closes) >= 52 else None

            # Intraday timeframes — fetch once as 1h data then resample
            # yfinance returns MultiIndex columns for single-ticker downloads,
            # so extract Close via .xs() or ['Close'][symbol] to get a Series.
            def _extract_close(df, sym):
                """Return Close Series regardless of MultiIndex vs flat columns."""
                try:
                    if hasattr(df.columns, 'levels'):  # MultiIndex
                        return df['Close'][sym].dropna()
                    return df['Close'].dropna()
                except Exception:
                    return None

            _intra_states = {}
            try:
                _ih = yf.download(
                    symbol, period="60d", interval="1h",
                    auto_adjust=True, progress=False
                )
                _ih_close = _extract_close(_ih, symbol)
                if _ih_close is not None and len(_ih_close) >= 52:
                    _intra_states["H1"] = _tf_trend(_ih_close.values)
                    # H4 — resample 1h → 4h
                    _h4 = _ih_close.resample("4h").last().dropna()
                    if len(_h4) >= 52:
                        _intra_states["H4"] = _tf_trend(_h4.values)
            except Exception:
                pass

            try:
                _m30h = yf.download(
                    symbol, period="30d", interval="30m",
                    auto_adjust=True, progress=False
                )
                _m30_close = _extract_close(_m30h, symbol)
                if _m30_close is not None and len(_m30_close) >= 52:
                    _intra_states["M30"] = _tf_trend(_m30_close.values)
            except Exception:
                pass

            try:
                _m15h = yf.download(
                    symbol, period="20d", interval="15m",
                    auto_adjust=True, progress=False
                )
                _m15_close = _extract_close(_m15h, symbol)
                if _m15_close is not None and len(_m15_close) >= 52:
                    _intra_states["M15"] = _tf_trend(_m15_close.values)
            except Exception:
                pass

            # Collect all trend states
            _states = {"D1": _d1_trend}
            _states.update(_intra_states)

            # Base weights
            _base_w = {"D1": 0.50, "H4": 0.20, "H1": 0.15, "M30": 0.10, "M15": 0.05}

            # Redistribute weight from missing timeframes
            # Rule: missing weight goes 60% to D1, 40% spread to remaining available
            _avail = [tf for tf in _base_w if _states.get(tf) is not None]
            _missing_w = sum(_base_w[tf] for tf in _base_w if tf not in _avail)
            _weights = {}
            for tf in _avail:
                _weights[tf] = _base_w[tf]
            if _missing_w > 0 and _avail:
                # 60% of missing → D1 (if present), rest proportional to other available
                _d1_boost = _missing_w * 0.6 if "D1" in _avail else 0
                _others_boost = _missing_w - _d1_boost
                _other_avail = [tf for tf in _avail if tf != "D1"]
                _other_total = sum(_base_w[tf] for tf in _other_avail) or 1
                if "D1" in _avail: _weights["D1"] += _d1_boost
                for tf in _other_avail:
                    _weights[tf] += _others_boost * (_base_w[tf] / _other_total)

            # Normalise weights to sum to 1.0
            _wsum = sum(_weights.values()) or 1.0
            _weights = {tf: round(w / _wsum, 4) for tf, w in _weights.items()}

            # Alignment score
            _trend_val = {"up": 1, "neutral": 0, "down": -1}
            _weighted = sum(_weights.get(tf, 0) * _trend_val.get(_states[tf], 0)
                           for tf in _avail)
            _align_score = max(0, min(100, int(50 + 50 * _weighted)))

            # Alignment label
            if   _align_score >= 85: _align_label = "Full Alignment (Strong)"
            elif _align_score >= 70: _align_label = "Aligned (Moderate)"
            elif _align_score >= 55: _align_label = "Weak Alignment"
            elif _align_score >= 45: _align_label = "Neutral / Mixed"
            elif _align_score >= 30: _align_label = "Weak Divergence"
            else:                   _align_label = "Full Divergence (Strong)"

            # Divergence detection
            _d1  = _states.get("D1")
            _h4  = _states.get("H4")
            _h1  = _states.get("H1")
            _m30 = _states.get("M30")
            _m15 = _states.get("M15")

            # Major: D1+H4 both trend one way, H1 breaks
            _major_bull_div = bool(_d1 == "up"   and _h4 == "up"   and _h1 in ("neutral", "down"))
            _major_bear_div = bool(_d1 == "down" and _h4 == "down" and _h1 in ("neutral", "up"))
            _major_div = _major_bull_div or _major_bear_div

            # Micro: M30 and M15 both contradict H1 (persistent = both agree)
            _micro_div = bool(
                _h1 is not None and _h1 != "neutral" and
                _m30 is not None and _m15 is not None and
                _m30 != _h1 and _m15 != _h1
            )

            # Swing gating
            _entry_ok  = bool(_align_score >= 70 and _d1 == "up"   and _h4 == "up"   and not _major_bear_div)
            _entry_no  = bool(_align_score <= 45 or  _d1 == "down" and _h4 in ("down", "neutral"))
            _entry_cau = bool(not _entry_ok and not _entry_no)  # caution zone

            _swing_gate = "ALLOWED"    if _entry_ok  else \
                          "BLOCKED"    if _entry_no   else \
                          "CAUTION"

            _mtf_engine = {
                "alignment_score": _align_score,
                "alignment_label": _align_label,
                "trend_states":    {tf: _states[tf] for tf in _avail},
                "weights_used":    _weights,
                "available_tfs":   _avail,
                "divergence": {
                    "major":      _major_div,
                    "bullish":    _major_bull_div,
                    "bearish":    _major_bear_div,
                    "micro":      _micro_div,
                },
                "swing_gate": _swing_gate,  # ALLOWED | CAUTION | BLOCKED
            }
        except Exception as _mtfe:
            _mtf_engine = {"error": str(_mtfe)}

        result["mtf_alignment"] = _mtf_engine

        # ── 15e. Pattern Recognition Engine (Phase 4 v1) ─────────────────────
        # Scope: Trend Channels (up/down) + Flags (bull/bear)
        # Design: deterministic, auditable, low false-positives
        _patterns_out = []
        try:
            # ── Shared helpers ──────────────────────────────────────────────
            def _swing_highs_idx(highs_arr, N=2):
                """Return list of (index, value) for local swing highs."""
                result_sh = []
                for _si in range(N, len(highs_arr) - N):
                    if all(highs_arr[_si] >= highs_arr[_si - _j] for _j in range(1, N + 1)) and \
                       all(highs_arr[_si] >= highs_arr[_si + _j] for _j in range(1, N + 1)):
                        result_sh.append((_si, float(highs_arr[_si])))
                return result_sh

            def _swing_lows_idx(lows_arr, N=2):
                """Return list of (index, value) for local swing lows."""
                result_sl = []
                for _si in range(N, len(lows_arr) - N):
                    if all(lows_arr[_si] <= lows_arr[_si - _j] for _j in range(1, N + 1)) and \
                       all(lows_arr[_si] <= lows_arr[_si + _j] for _j in range(1, N + 1)):
                        result_sl.append((_si, float(lows_arr[_si])))
                return result_sl

            def _linreg_pts(pts):
                """Linear regression on list of (x, y) pairs. Returns (slope, intercept, r2)."""
                _n = len(pts)
                if _n < 3:
                    return None, None, 0.0
                _xs = [p[0] for p in pts]; _ys = [p[1] for p in pts]
                _sx = sum(_xs); _sy = sum(_ys)
                _sxy = sum(_x * _y for _x, _y in zip(_xs, _ys))
                _sxx = sum(_x * _x for _x in _xs)
                _den = _n * _sxx - _sx * _sx
                if _den == 0:
                    return None, None, 0.0
                _sl = (_n * _sxy - _sx * _sy) / _den
                _ic = (_sy - _sl * _sx) / _n
                _ym = _sy / _n
                _ss_tot = sum((_y - _ym) ** 2 for _y in _ys)
                _ss_res = sum((_y - (_sl * _x + _ic)) ** 2 for _x, _y in zip(_xs, _ys))
                _r2 = float(1 - _ss_res / _ss_tot) if _ss_tot > 0 else 0.0
                return float(_sl), float(_ic), max(0.0, _r2)

            def _count_touches(pts, slope, intercept, atr):
                """Count swing points within 1 ATR of the regression line."""
                return sum(1 for _x, _y in pts if abs(_y - (slope * _x + intercept)) <= atr)

            def _trend_pct(closes_arr, ma20v, ma50v):
                """% of bars where close > ma20 > ma50 (uptrend) or < ma20 < ma50 (downtrend)."""
                _n = len(closes_arr)
                if _n == 0 or not ma20v or not ma50v:
                    return 0.0, 0.0
                _up = sum(1 for _c in closes_arr if _c > ma20v and ma20v > ma50v)
                _dn = sum(1 for _c in closes_arr if _c < ma20v and ma20v < ma50v)
                return _up / _n, _dn / _n

            # ── Only compute if we have enough bars ─────────────────────────
            _PL = 75  # lookback for channel detection (bars)
            _is_nav = _sc.get("type", "") in ("CEF", "ETF", "etf", "cef")
            _vol_filter = not _is_nav  # skip volume filters for NAV-based instruments
            _atr_val = _atr14 if _atr14 else 0.0

            if len(raw_closes) >= _PL and len(raw_highs) >= _PL and _atr_val > 0:
                _c_w = raw_closes[-_PL:]
                _h_w = raw_highs[-_PL:]
                _l_w = raw_lows[-_PL:]
                _price_now = float(raw_closes[-1])

                # Trend % in lookback window
                _up_pct, _dn_pct = _trend_pct(_c_w, ma20, ma50)

                # ── Swing points ────────────────────────────────────────────
                _sh = _swing_highs_idx(_h_w, N=2)
                _sl = _swing_lows_idx(_l_w, N=2)

                # ── Channel detection ───────────────────────────────────────
                for _ch_dir in ("up", "down"):
                    _trend_ok = (_price_now > float(ma20) and float(ma20) > float(ma50)) if _ch_dir == "up" else (_price_now < float(ma20) and float(ma20) < float(ma50))
                    if not _trend_ok:
                        continue

                    _slope_h, _ic_h, _r2_h = _linreg_pts(_sh)
                    _slope_l, _ic_l, _r2_l = _linreg_pts(_sl)

                    if _slope_h is None or _slope_l is None:
                        continue

                    # Direction checks on slopes
                    if _ch_dir == "up"  and not (_slope_h > 0 and _slope_l > 0): continue
                    if _ch_dir == "down" and not (_slope_h < 0 and _slope_l < 0): continue

                    # R² check
                    if _r2_h < 0.6 or _r2_l < 0.6:
                        continue

                    # Touch counts
                    _tc_h = _count_touches(_sh, _slope_h, _ic_h, _atr_val)
                    _tc_l = _count_touches(_sl, _slope_l, _ic_l, _atr_val)
                    if _tc_h < 3 or _tc_l < 3:
                        continue

                    # Channel width at current bar index
                    _idx_now = _PL - 1
                    _upper_now = _slope_h * _idx_now + _ic_h
                    _lower_now = _slope_l * _idx_now + _ic_l
                    if _lower_now <= 0:
                        continue
                    _ch_width_pct = (_upper_now - _lower_now) / _lower_now * 100

                    # Width must be 2–15% of price
                    if not (1.0 <= _ch_width_pct <= 15.0):
                        continue

                    # Direction-aware outside check:
                    # Up channel: only penalise closes BELOW lower support (going above upper = strength)
                    # Down channel: only penalise closes ABOVE upper resistance (going below lower = strength)
                    if _ch_dir == "up":
                        _outside = sum(
                            1 for _i, _cc in enumerate(_c_w)
                            if _cc < (_slope_l * _i + _ic_l)   # below support = breakdown
                        ) / len(_c_w)
                    else:
                        _outside = sum(
                            1 for _i, _cc in enumerate(_c_w)
                            if _cc > (_slope_h * _i + _ic_h)   # above resistance = breakout
                        ) / len(_c_w)
                    _ch_valid = _outside <= 0.20
                    if _outside > 0.35:
                        continue  # too many support/resistance violations — skip

                    # Pattern strength
                    _str = 50
                    if max(_r2_h, _r2_l) >= 0.8: _str += 10
                    if _tc_h >= 4 and _tc_l >= 4:  _str += 10
                    if _ch_width_pct > 12:           _str -= 10
                    if _outside > 0.15:              _str -= 10
                    _str = max(0, min(100, _str))

                    _patterns_out.append({
                        "type":              f"{_ch_dir}_channel",
                        "valid":             bool(_ch_valid),
                        "strength":          _str,
                        "upper_line":        {"slope": round(_slope_h, 4), "intercept": round(_ic_h, 2)},
                        "lower_line":        {"slope": round(_slope_l, 4), "intercept": round(_ic_l, 2)},
                        "channel_width_pct": round(_ch_width_pct, 2),
                        "touch_count_upper": _tc_h,
                        "touch_count_lower": _tc_l,
                        "r2_upper":          round(_r2_h, 3),
                        "r2_lower":          round(_r2_l, 3),
                        "upper_price":       round(_upper_now, 2),
                        "lower_price":       round(_lower_now, 2),
                    })

                # ── Flag detection ──────────────────────────────────────────
                for _fl_dir in ("bull", "bear"):
                    _trend_ok = (_price_now > float(ma20) and float(ma20) > float(ma50)) if _fl_dir == "bull" else (_price_now < float(ma20) and float(ma20) < float(ma50))
                    if not _trend_ok:
                        continue

                    # Try flag windows of 5–15 bars
                    for _fl_len in range(5, 16):
                        if _fl_len + 20 > len(raw_closes):
                            continue

                        _flag_closes = raw_closes[-_fl_len:]
                        _flag_highs  = raw_highs[-_fl_len:]
                        _flag_lows   = raw_lows[-_fl_len:]
                        _imp_closes  = raw_closes[-_fl_len - 20: -_fl_len]
                        _imp_vols    = raw_vols[-_fl_len - 20: -_fl_len] if len(raw_vols) >= _fl_len + 20 else None
                        _flag_vols   = raw_vols[-_fl_len:] if len(raw_vols) >= _fl_len else None

                        # Impulse: % up/down closes
                        if _fl_dir == "bull":
                            _imp_return = (float(np.max(_imp_closes)) - float(np.min(_imp_closes))) / float(np.min(_imp_closes)) * 100
                            _imp_up_pct = sum(1 for _i in range(1, len(_imp_closes)) if _imp_closes[_i] > _imp_closes[_i-1]) / max(1, len(_imp_closes)-1)
                            _imp_ok = _imp_return >= 10.0 and _imp_up_pct >= 0.6
                        else:
                            _imp_return = (float(np.min(_imp_closes)) - float(np.max(_imp_closes))) / float(np.max(_imp_closes)) * 100  # negative
                            _imp_dn_pct = sum(1 for _i in range(1, len(_imp_closes)) if _imp_closes[_i] < _imp_closes[_i-1]) / max(1, len(_imp_closes)-1)
                            _imp_ok = _imp_return <= -10.0 and _imp_dn_pct >= 0.6

                        if not _imp_ok:
                            continue

                        # Flag regression slope
                        _fl_xs = list(range(len(_flag_closes)))
                        _fl_slope, _fl_ic, _fl_r2 = _linreg_pts(list(zip(_fl_xs, [float(c) for c in _flag_closes])))
                        if _fl_slope is None:
                            continue

                        # Bull flag: slope ≤ 0 (downward/flat)
                        # Bear flag: slope ≥ 0 (upward/flat)
                        if _fl_dir == "bull" and _fl_slope > 0.05 * _atr_val: continue
                        if _fl_dir == "bear" and _fl_slope < -0.05 * _atr_val: continue

                        # Flag depth
                        if _fl_dir == "bull":
                            _flag_peak = float(np.max(_imp_closes))
                            _flag_min  = float(np.min(_flag_lows))
                            _fl_depth  = (_flag_peak - _flag_min) / _flag_peak * 100
                            _depth_ok  = 0.5 <= _fl_depth <= 10.0
                        else:
                            _flag_trough = float(np.min(_imp_closes))
                            _flag_max    = float(np.max(_flag_highs))
                            _fl_depth    = (_flag_max - _flag_trough) / abs(_flag_trough) * 100
                            _depth_ok    = 0.5 <= _fl_depth <= 10.0

                        if not _depth_ok:
                            continue

                        # ATR% in flag vs impulse
                        _atr_imp  = float(np.mean(np.array(_imp_closes[1:]) - np.array(_imp_closes[:-1]))) if len(_imp_closes) > 1 else _atr_val
                        _atr_flag = float(np.mean(np.abs(np.array(_flag_closes[1:]) - np.array(_flag_closes[:-1])))) if len(_flag_closes) > 1 else _atr_val
                        _atr_ok   = _atr_flag <= 1.2 * abs(_atr_imp) if abs(_atr_imp) > 0 else True

                        if not _atr_ok:
                            continue

                        # Volume filter (symbols only)
                        _vol_ok = True
                        if _vol_filter and _imp_vols is not None and _flag_vols is not None and avg_v20 > 0:
                            _imp_avg_vol  = float(np.mean(_imp_vols))
                            _flag_avg_vol = float(np.mean(_flag_vols))
                            _vol_ok = _imp_avg_vol >= 1.3 * avg_v20 and _flag_avg_vol <= 1.0 * avg_v20

                        if not _vol_ok:
                            continue

                        # Breakout / status
                        _fl_upper = float(np.max(_flag_highs))
                        _fl_lower = float(np.min(_flag_lows))
                        if _fl_dir == "bull":
                            if _price_now > _fl_upper + _atr_val:
                                _fl_status = "confirmed"
                            elif _price_now < _fl_lower - _atr_val:
                                _fl_status = "failed"
                            else:
                                _fl_status = "forming"
                            _bk_level = round(_fl_upper + _atr_val, 2)
                        else:
                            if _price_now < _fl_lower - _atr_val:
                                _fl_status = "confirmed"
                            elif _price_now > _fl_upper + _atr_val:
                                _fl_status = "failed"
                            else:
                                _fl_status = "forming"
                            _bk_level = round(_fl_lower - _atr_val, 2)

                        # Time invalidation: if flag > 12 bars, expire
                        if _fl_len > 12 and _fl_status == "forming":
                            _fl_status = "expired"

                        # Pattern strength
                        _str = 50
                        _imp_r_abs = abs(_imp_return)
                        if _imp_r_abs >= 15:          _str += 10
                        if 3.0 <= abs(_fl_depth) <= 7.0: _str += 10
                        if _vol_filter and _vol_ok:   _str += 10
                        if _fl_len > 12:              _str -= 10
                        if not _atr_ok:               _str -= 10
                        _str = max(0, min(100, _str))

                        # Only append the first valid flag found for each direction
                        _patterns_out.append({
                            "type":               f"{_fl_dir}_flag",
                            "status":             _fl_status,
                            "strength":           _str,
                            "impulse_return_pct": round(float(_imp_return), 2),
                            "flag_depth_pct":     round(float(_fl_depth), 2),
                            "flag_bars":          _fl_len,
                            "breakout_level":     _bk_level,
                            "flag_high":          round(_fl_upper, 2),
                            "flag_low":           round(_fl_lower, 2),
                        })
                        break  # one flag per direction — take the first valid one

        except Exception as _pe:
            _patterns_out = [{"error": str(_pe)}]

        result["pattern_engine"] = {
            "patterns": _patterns_out,
            "count":    len(_patterns_out),
        }

        # ── 15c. Liquidity & Flow Engine ─────────────────────────────────────
        # MFI(14), OBV trend, A/D line, flow divergence, flow score.
        # All computable from hist_raw (Close, High, Low, Volume).
        _flow_engine = {}
        try:
            _fh = hist_raw["High"].values.astype(float)
            _fl = hist_raw["Low"].values.astype(float)
            _fc = hist_raw["Close"].values.astype(float)
            _fv = hist_raw["Volume"].values.astype(float)
            _fn = len(_fc)

            if _fn >= 20:
                # ── MFI(14) — Money Flow Index ───────────────────────────────
                # Typical price × volume = Money Flow
                _tp   = (_fh + _fl + _fc) / 3.0
                _mf   = _tp * _fv
                _mfi_period = 14
                _pos_mf = sum(_mf[-_i] for _i in range(1, _mfi_period + 1) if _tp[-_i] > _tp[-_i - 1])
                _neg_mf = sum(_mf[-_i] for _i in range(1, _mfi_period + 1) if _tp[-_i] < _tp[-_i - 1])
                _mfi_val = 100.0 - (100.0 / (1.0 + _pos_mf / _neg_mf)) if _neg_mf > 0 else 100.0
                _mfi_val = round(_mfi_val, 1)

                # MFI signal
                _mfi_signal = "Overbought (>80)" if _mfi_val > 80 \
                    else "Oversold (<20)" if _mfi_val < 20 \
                    else "Bullish flow (>60)" if _mfi_val > 60 \
                    else "Bearish flow (<40)" if _mfi_val < 40 \
                    else "Neutral"

                # ── OBV (On-Balance Volume) slope ────────────────────────────
                _obv_arr = np.zeros(_fn)
                for _i in range(1, _fn):
                    if _fc[_i] > _fc[_i - 1]:
                        _obv_arr[_i] = _obv_arr[_i - 1] + _fv[_i]
                    elif _fc[_i] < _fc[_i - 1]:
                        _obv_arr[_i] = _obv_arr[_i - 1] - _fv[_i]
                    else:
                        _obv_arr[_i] = _obv_arr[_i - 1]

                # OBV slope: compare last 5 vs prior 5 average
                _obv_now  = float(np.mean(_obv_arr[-5:]))
                _obv_prev = float(np.mean(_obv_arr[-10:-5]))
                _obv_slope_pct = (_obv_now - _obv_prev) / abs(_obv_prev) * 100 if _obv_prev != 0 else 0.0
                _obv_slope_pct = max(-200.0, min(200.0, _obv_slope_pct))  # cap extreme values
                _obv_rising  = bool(_obv_slope_pct > 1.0)
                _obv_falling = bool(_obv_slope_pct < -1.0)

                # ── A/D Line (Accumulation/Distribution) ─────────────────────
                _ad = np.zeros(_fn)
                for _i in range(_fn):
                    _rng = _fh[_i] - _fl[_i]
                    if _rng > 0:
                        _clv = ((_fc[_i] - _fl[_i]) - (_fh[_i] - _fc[_i])) / _rng
                        _ad[_i] = (_ad[_i - 1] if _i > 0 else 0) + _clv * _fv[_i]
                    else:
                        _ad[_i] = _ad[_i - 1] if _i > 0 else 0

                _ad_now   = float(np.mean(_ad[-5:]))
                _ad_prev  = float(np.mean(_ad[-10:-5]))
                _ad_slope_pct = (_ad_now - _ad_prev) / abs(_ad_prev) * 100 if _ad_prev != 0 else 0.0
                _ad_slope_pct = max(-200.0, min(200.0, _ad_slope_pct))  # cap extreme values
                _ad_rising  = bool(_ad_slope_pct > 1.0)
                _ad_falling = bool(_ad_slope_pct < -1.0)

                # ── Flow Divergence ───────────────────────────────────────────
                # Price trend over last 10 bars
                _price_trend_up = bool(_fc[-1] > _fc[-10])
                # Bearish divergence: price up + OBV down + A/D down
                # Bullish divergence: price down + OBV up + A/D up
                _bearish_div = bool(_price_trend_up and _obv_falling and _ad_falling)
                _bullish_div = bool(not _price_trend_up and _obv_rising and _ad_rising)
                _div_label   = "⚠ Bearish divergence — price up, flow down" if _bearish_div \
                    else "✓ Bullish divergence — price down, flow up" if _bullish_div \
                    else "No significant divergence"

                # ── Flow Confirmation Score (0–100) ───────────────────────────
                # Combines MFI + OBV direction + A/D direction
                # For uptrend: higher = stronger flow confirmation
                _flow_score = 50  # neutral baseline
                if _price_trend_up:
                    if _mfi_val > 60:  _flow_score += 20
                    if _mfi_val > 75:  _flow_score += 10
                    if _obv_rising:    _flow_score += 15
                    if _ad_rising:     _flow_score += 10
                    if _bearish_div:   _flow_score -= 30
                else:
                    if _mfi_val < 40:  _flow_score -= 20
                    if _mfi_val < 25:  _flow_score -= 10
                    if _obv_falling:   _flow_score -= 15
                    if _ad_falling:    _flow_score -= 10
                    if _bullish_div:   _flow_score += 30
                _flow_score = max(0, min(100, _flow_score))

                _flow_label = "Strong confirmation" if _flow_score >= 75 \
                    else "Confirmed" if _flow_score >= 60 \
                    else "Mixed / neutral" if _flow_score >= 40 \
                    else "Weak / diverging" if _flow_score >= 25 \
                    else "No flow support"

                _flow_engine = {
                    "mfi_14":         _mfi_val,
                    "mfi_signal":     _mfi_signal,
                    "obv_slope_pct":  round(_obv_slope_pct, 2),
                    "obv_rising":     _obv_rising,
                    "obv_falling":    _obv_falling,
                    "ad_slope_pct":   round(_ad_slope_pct, 2),
                    "ad_rising":      _ad_rising,
                    "ad_falling":     _ad_falling,
                    "bearish_div":    _bearish_div,
                    "bullish_div":    _bullish_div,
                    "divergence":     _div_label,
                    "flow_score":     _flow_score,
                    "flow_label":     _flow_label,
                }
        except Exception as _fe:
            _flow_engine = {"error": str(_fe)}

        result["flow_engine"] = _flow_engine

        # ── 16. Behavioral guardrails ─────────────────────────────────────────
        result["guardrails"] = _behavioral_guardrails(
            _sc, result["quote"], result["technicals"],
            result["distributions"], result["events"], result["risk_stats"],
            annualized_returns=result["annualized_returns"])

        # ── 17. Analysis text (ETF/CEF-aware) ────────────────────────────────
        result["analysis"] = _generate_analysis(
            symbol, result["quote"], result["technicals"], sym_class=_sc)

        # ── 18. Peer symbols ────────────────────────────────────────────────
        result["peers"] = get_peers(symbol, _sc, result["profile"].get("category", ""))

        # ── 19. Quality Engine ───────────────────────────────────────────────
        try:
            result["quality_engine"] = _compute_quality_score(
                sym_class=_sc,
                profile=result.get("profile", {}),
                key_stats=result.get("key_stats", {}),
                risk_stats=result.get("risk_stats", {}),
                distributions=result.get("distributions", {}),
                annualized_returns=result.get("annualized_returns", {}),
                nav_metrics=result.get("nav_metrics", {}),
                prem_disc_pct=result.get("trading_levels", {}).get("premium_discount_pct"),
            )
        except Exception as _qe:
            result["quality_engine"] = {"error": str(_qe)}

        # ── 20. Action Engine ────────────────────────────────────────────────
        try:
            _tl = result.get("trading_levels", {})
            result["action_engine"] = _compute_action(
                quality_score=result.get("quality_engine", {}).get("quality_score", 50),
                income_quality_score=result.get("quality_engine", {}).get("income_quality_score"),
                sym_class=_sc,
                today_verdict=_tl.get("today_verdict", "HOLD"),
                sizing_pct=_tl.get("sizing_pct", 0),
                guardrails=result.get("guardrails", []),
                buy_triggered=_tl.get("buy_triggered", False),
                sell_triggered=_tl.get("sell_triggered", False),
                annualized_returns=result.get("annualized_returns", {}),
                distributions=result.get("distributions", {}),
            )
        except Exception as _ae:
            result["action_engine"] = {"error": str(_ae)}

    except Exception as e:
        result["error"] = str(e)
        traceback.print_exc()

    return result


def build_health_evaluation(symbol: str, research_data: dict, portfolio_cache: dict = None) -> dict:
    """
    Run the same fund health evaluation engine used for portfolio holdings,
    applied to any searched symbol using its live research API data.

    Returns a dict with structural_status, summary, and metrics — same shape
    as entries in data.decisions — so the frontend can display it identically.
    """
    try:
        import json
        import os
        from models import EtfSnapshot
        from evaluation import evaluate_etf
        from portfolio_data.dividends import _build_fund_config

        # ── Load rules (same source as portfolio pipeline) ─────────────────
        rules_path = os.path.join(os.path.dirname(__file__), '..', 'rules.json')
        with open(rules_path) as _f:
            rules = json.load(_f)
        fund_type_rules  = rules.get('_FUND_TYPE_RULES', {})
        symbol_overrides = rules.get('_SYMBOL_OVERRIDES', {})
        meta_rules: dict = {}   # directions are hardcoded in evaluation.py

        # ── Extract research fields ─────────────────────────────────────────
        tl   = research_data.get('trading_levels',    {}) or {}
        rs   = research_data.get('risk_stats',         {}) or {}
        dist = research_data.get('distributions',      {}) or {}
        prof = research_data.get('profile',            {}) or {}
        ar   = research_data.get('annualized_returns', {}) or {}
        ks   = research_data.get('key_stats',          {}) or {}

        quote = research_data.get('quote', {}) or {}
        tech  = research_data.get('technicals', {}) or {}
        price = float(quote.get('last_price') or tl.get('buy_normal') or 0)
        ttm_yield_pct = float(dist.get('ttm_yield_pct') or dist.get('market_yield_pct') or 0)
        nav           = tl.get('nav') or prof.get('nav')

        # Returns: research stores as % (e.g. 12.3); EtfSnapshot wants decimal (0.123)
        def _pct(v):
            return float(v) / 100.0 if v is not None else None

        sym_ret1y  = _pct((ar.get('symbol') or {}).get('1Y'))
        spy_ret1y  = _pct((ar.get('spy')    or {}).get('1Y'))
        rel_ret1y  = (sym_ret1y - spy_ret1y) if (sym_ret1y is not None and spy_ret1y is not None) else None

        # Days to ex-div from next_ex_date
        _next_ex = dist.get('next_ex_date') or ''
        _days_to_ex = None
        if _next_ex:
            try:
                from datetime import date as _date
                _ex_dt = _date.fromisoformat(str(_next_ex)[:10])
                _days_to_ex = (_ex_dt - _date.today()).days
            except Exception:
                pass

        # Coverage ratio from static FALLBACK_DATA (maintained quarterly)
        from data_fetcher import FALLBACK_DATA as _FALLBACK
        _coverage_ratio = _FALLBACK.get(symbol, {}).get('coverage_ratio')

        snap = EtfSnapshot(
            symbol        = symbol,
            price         = price,
            nav           = nav,
            ttm_yield     = ttm_yield_pct / 100.0,
            nav_drop_30d  = _pct(rs.get('max_drawdown'))  or 0.0,
            trend_90d     = _pct(tl.get('price_vs_ma200_pct')) or 0.0,
            momentum_20d  = _pct(tl.get('price_vs_ma20_pct'))  or 0.0,
            vol_30d_annual= _pct(tech.get('hist_vol_10d')) or 0.0,
            days_to_ex    = _days_to_ex,
            aum           = prof.get('total_assets'),
            expense_ratio = prof.get('expense_ratio'),
            sma_20        = tech.get('ma_20'),
            sma_50        = tech.get('ma_50'),
            sma_200       = tech.get('ma_200'),
            rsi_14        = tech.get('rsi_14'),
            macd_bullish  = tech.get('macd_bullish'),
            total_return_1y     = sym_ret1y,
            benchmark_return_1y = spy_ret1y,
            relative_return_1y  = rel_ret1y,
            beta          = rs.get('beta'),
            max_drawdown_6m = _pct(rs.get('max_drawdown')) or 0.0,
            coverage_ratio  = _coverage_ratio,
        )

        # ── Get schwab quote from portfolio cache if symbol is held ─────────
        schwab_quote: dict = {}
        if portfolio_cache:
            for _acct in portfolio_cache.get('accounts', []):
                for _pos in _acct.get('positions', []):
                    if _pos.get('symbol') == symbol:
                        schwab_quote = _pos
                        break

        # ── Build config and evaluate ──────────────────────────────────────
        fund_cfg = _build_fund_config(symbol, schwab_quote, symbol_overrides, fund_type_rules)
        decision = evaluate_etf(snap, fund_cfg, meta_rules)

        return {
            'symbol':            decision.symbol,
            'structural_status': decision.structural_status,
            'summary':           decision.summary,
            'metrics': {
                k: {'level': v.level, 'message': v.message}
                for k, v in (decision.metrics or {}).items()
            },
            'fund_type': fund_cfg.get('FUND_TYPE', 'UNKNOWN'),
        }

    except Exception as _e:
        import traceback as _tb
        return {'error': str(_e), 'detail': _tb.format_exc()}


def get_etf_components(symbol: str) -> dict:
    """
    Fetch live component quotes for a top-heavy ETF and compute direction/strength.
    Called by /api/research/components — always a separate request from get_research().
    Returns {"eligible": False} immediately if the symbol isn't top-heavy.
    Returns {"eligible": False, "error": str(e)} on unexpected failure.
    """
    symbol = symbol.upper().strip()
    try:
        return _etf_components_compute(symbol)
    except Exception as _top_e:
        traceback.print_exc()
        return {"eligible": False, "error": str(_top_e)}


def _etf_components_compute(symbol: str) -> dict:
    # Re-check eligibility using the cached holdings from a lightweight yfinance call.
    _NEVER_TOP_HEAVY = {
        'SPYI', 'JEPI', 'JEPQ', 'QDVO', 'DIVO', 'QYLD', 'RYLD', 'XYLD',
        'NUSI', 'PBDC', 'SVOL', 'NVDY', 'MSFO', 'CONY',
        'RSP', 'QQQE', 'EWSC', 'EQL',
        'TLT', 'IEF', 'SHY', 'AGG', 'BND', 'LQD', 'HYG', 'JNK',
        'VCIT', 'VCSH', 'MUB', 'TIP', 'SCHP',
        'GLD', 'IAU', 'SLV', 'PPLT', 'USO', 'BNO', 'DBO', 'GDX', 'GDXJ',
        'SWVXX', 'VMFXX', 'SPAXX',
    }
    if symbol in _NEVER_TOP_HEAVY:
        return {"eligible": False}

    _is_cef = _FUND_PROFILE_OVERRIDES.get(symbol, {}).get("fund_type_label", "").startswith("Closed-End")
    if _is_cef:
        return {"eligible": False}

    def _frac(w: float) -> float:
        return w / 100.0 if w > 1.0 else w

    # Pull holdings (fast — yfinance funds_data only, no chart/technicals)
    holdings: list = []
    try:
        import yfinance as yf
        tk = yf.Ticker(symbol)
        fd = tk.funds_data
        if fd is not None:
            th = getattr(fd, "top_holdings", None)
            if th is not None and not th.empty:
                for _, row in th.head(15).iterrows():
                    raw_w = row.get("Weight", row.get("% Weight", row.get("Holding Percent", 0))) or 0
                    holdings.append({
                        "symbol": str(row.get("Symbol", "") or row.name or ""),
                        "name":   str(row.get("Name", row.get("Holding Name", ""))),
                        "weight": round(float(raw_w), 4),
                    })
    except Exception:
        pass

    if len(holdings) < 5:
        return {"eligible": False}

    top10_frac_sum = sum(_frac(h.get("weight", 0)) for h in holdings[:10])
    top10_pct      = round(top10_frac_sum * 100, 1)

    if top10_frac_sum < 0.40:
        return {"eligible": True, "is_top_heavy": False, "top10_weight_pct": top10_pct}

    # Batch-fetch live quotes for top-7 components — the only Schwab call here
    top7      = [h for h in holdings[:7] if h.get("symbol")]
    comp_syms = [h["symbol"] for h in top7]
    comp_quotes: dict = {}
    try:
        from schwab_client import get_quotes as _gq
        comp_quotes = _gq(comp_syms) or {}
    except Exception:
        pass

    # ── Batch-fetch yfinance fundamentals for composite fair value ────────────
    # Uses forward EPS, revenue, shares, analyst target — Schwab quotes alone
    # don't have revenue/analyst targets needed for PS model.
    _yf_info: dict[str, dict] = {}
    try:
        import yfinance as yf
        _tks = yf.Tickers(" ".join(comp_syms))
        for sym in comp_syms:
            try:
                _yf_info[sym] = _tks.tickers[sym].info or {}
            except Exception:
                _yf_info[sym] = {}
    except Exception:
        pass

    # ── FX conversion for foreign-currency components ─────────────────────────
    # yfinance returns EPS / revenue / analyst targets in the stock's local
    # currency (e.g. KRW for 000660.KS).  Detect each component's currency
    # and fetch the spot rate so all monetary values feed into FMV in USD.
    _sym_currency: dict[str, str] = {}
    _fx_rates: dict[str, float] = {}  # currency_code → USD per 1 unit

    for _fsym in comp_syms:
        _cur = ((_yf_info.get(_fsym, {}).get("currency")) or "USD").upper()
        _sym_currency[_fsym] = _cur
        if _cur != "USD" and _cur not in _fx_rates:
            try:
                import yfinance as yf
                _fx_hist = yf.Ticker(f"{_cur}USD=X").history(period="1d")
                if not _fx_hist.empty:
                    _fx_rates[_cur] = float(_fx_hist["Close"].iloc[-1])
            except Exception:
                pass

    def _to_usd(value: float | None, currency: str) -> float | None:
        if value is None or value == 0 or currency == "USD":
            return value
        rate = _fx_rates.get(currency)
        return value * rate if rate else None  # return None if rate unknown

    # ── Step 1: ETF Growth Score ──────────────────────────────────────────────
    # Weighted average across components using revenue growth, EPS growth, beta.
    # Drives model weight selection — high-growth ETFs use more PS/PE, less DCF.
    def _component_growth_score(info: dict, sq: dict) -> float | None:
        rev_g  = float(info.get("revenueGrowth")  or 0) or None   # decimal (0.30 = 30%)
        eps_g  = float(info.get("earningsGrowth") or 0) or None
        beta   = float(info.get("beta") or sq.get("beta") or 0) or None
        scores = []
        if rev_g is not None:
            # 0% rev growth → 20 score;  50%+ → 100
            scores.append(("rev", min(100.0, max(0.0, rev_g * 100 * 1.6 + 20)), 0.40))
        if eps_g is not None:
            scores.append(("eps", min(100.0, max(0.0, eps_g * 100 * 1.0 + 20)), 0.40))
        if beta is not None:
            # β=0.7 → 0;  β=2.0 → 100
            scores.append(("beta", min(100.0, max(0.0, (beta - 0.7) * 77)), 0.20))
        if not scores:
            return None
        total_w = sum(w for _, _, w in scores)
        return round(sum(v * w for _, v, w in scores) / total_w, 1)

    # Compute ETF-level growth score: weight-average of component scores
    _gs_num, _gs_den = 0.0, 0.0
    for h in top7:
        w = _frac(h.get("weight", 0))
        gs = _component_growth_score(_yf_info.get(h["symbol"], {}), comp_quotes.get(h["symbol"], {}))
        if gs is not None:
            _gs_num += w * gs
            _gs_den += w
    etf_growth_score = round(_gs_num / _gs_den, 1) if _gs_den > 0 else 50.0

    # ── Step 2: Select model weights based on ETF Growth Score ───────────────
    # High-growth (≥70): DCF punishes duration — weight PE and PS heavily
    # Moderate (40-69): balanced
    # Value (<40): DCF dominates
    if etf_growth_score >= 70:
        _W_DCF, _W_PE, _W_PS = 0.20, 0.40, 0.40
        _growth_regime = "HIGH-GROWTH"
    elif etf_growth_score >= 40:
        _W_DCF, _W_PE, _W_PS = 0.40, 0.40, 0.20
        _growth_regime = "MODERATE"
    else:
        _W_DCF, _W_PE, _W_PS = 0.60, 0.40, 0.00
        _growth_regime = "VALUE"

    # ── Step 3: Growth-tiered fair-PE and fair-PS tables ─────────────────────
    def _fair_pe(growth_pct: float | None, fwd_pe: float | None) -> float:
        if growth_pct is not None and growth_pct > 0:
            if growth_pct >= 50: return 45.0   # hyper-growth (NVDA, AMD)
            if growth_pct >= 30: return 38.0
            if growth_pct >= 20: return 30.0
            if growth_pct >= 10: return 22.0
            return 16.0
        if fwd_pe and 0 < fwd_pe < 200:
            return round(min(fwd_pe * 0.80, 50), 1)
        return 20.0

    def _fair_ps(rev_growth_pct: float | None) -> float:
        if rev_growth_pct is not None:
            if rev_growth_pct >= 30: return 12.0
            if rev_growth_pct >= 20: return 8.0
            if rev_growth_pct >= 10: return 5.0
            if rev_growth_pct >= 0:  return 3.0
        return 3.0

    # ── Step 4: Composite fair value per component ────────────────────────────
    # Weights (_W_DCF / _W_PE / _W_PS) are ETF-level and apply to every component.
    # DCF proxy = analyst consensus target (street targets embed DCF assumptions).
    # Any missing method drops out; remaining weights renormalize to 1.0.
    def _comp_fair_value(sym: str, sq: dict, ref_price: float = 0) -> float | None:
        info        = _yf_info.get(sym, {})
        currency    = _sym_currency.get(sym, "USD")
        fwd_eps     = float(info.get("forwardEps")  or 0) or None
        ttm_eps     = float(info.get("trailingEps") or sq.get("eps") or 0) or None
        eps         = _to_usd(fwd_eps or ttm_eps, currency)
        fwd_pe_mkt  = float(info.get("forwardPE")  or sq.get("pe_ratio") or 0) or None
        rev_growth  = float(info.get("revenueGrowth")  or 0) or None
        eps_growth  = float(info.get("earningsGrowth") or 0) or None
        growth      = eps_growth or rev_growth
        growth_pct  = growth * 100 if growth is not None else None
        total_rev   = _to_usd(float(info.get("totalRevenue") or 0) or None, currency)
        shares_out  = float(info.get("sharesOutstanding") or sq.get("shares_outstanding") or 0) or None
        analyst_tgt = _to_usd(float(info.get("targetMeanPrice") or 0) or None, currency)
        # Sanity check: analyst targets > 5× current price likely have a currency mismatch
        # (e.g. yfinance returning NT$ Taiwan analyst target for TSM ADR without FX conversion)
        if analyst_tgt and ref_price > 0 and analyst_tgt > ref_price * 5:
            analyst_tgt = None

        estimates: list[tuple[float, float]] = []  # (fair_value, intended_weight)

        # PE model
        if eps and eps > 0:
            fv_pe = eps * _fair_pe(growth_pct, fwd_pe_mkt)
            # Guard: implied PE < 2 means EPS is almost certainly in wrong currency units
            if ref_price > 0 and ref_price / eps < 2:
                fv_pe = None
            if fv_pe and (ref_price <= 0 or fv_pe <= ref_price * 5):
                estimates.append((fv_pe, _W_PE))

        # PS model (only when growth regime calls for it and data exists)
        if _W_PS > 0 and total_rev and total_rev > 0 and shares_out and shares_out > 0:
            rps = total_rev / shares_out
            fv_ps = rps * _fair_ps(rev_growth * 100 if rev_growth else None)
            if ref_price <= 0 or fv_ps <= ref_price * 5:
                estimates.append((fv_ps, _W_PS))

        # DCF proxy: analyst consensus target
        if analyst_tgt and analyst_tgt > 0:
            estimates.append((analyst_tgt, _W_DCF))

        if not estimates:
            return None

        total_w = sum(w for _, w in estimates)
        return round(sum(v * w for v, w in estimates) / total_w, 2)

    components: list   = []
    total_w_frac       = 0.0
    direction_score    = 0.0
    fv_numerator       = 0.0   # sum(weight * comp_fv) for weighted ETF fair value
    fv_weight_sum      = 0.0   # sum of weights that have a valid FV
    for h in top7:
        w_frac  = _frac(h.get("weight", 0))
        q       = comp_quotes.get(h["symbol"], {})
        chg_pct = float(q.get("change_pct", 0) or 0)
        contrib = round(w_frac * chg_pct, 4)   # no threshold — every move contributes
        direction_score += contrib
        total_w_frac    += w_frac
        _sym      = h["symbol"]
        _currency = _sym_currency.get(_sym, "USD")
        _inf      = _yf_info.get(_sym, {})
        # Schwab quotes foreign-listed stocks (e.g. 000660.KS) as 0 — fall back
        # to yfinance currentPrice converted to USD so the FV gate can fire.
        comp_price = float(q.get("price", 0) or q.get("last", 0) or 0)
        if comp_price == 0:
            _yf_price_local = float(_inf.get("currentPrice") or _inf.get("regularMarketPrice") or 0)
            _yf_price_usd   = _to_usd(_yf_price_local, _currency)
            comp_price = _yf_price_usd or 0
        else:
            comp_price = _to_usd(comp_price, _currency) or comp_price
        comp_fv = _comp_fair_value(_sym, q, comp_price) if comp_price > 0 else None
        if comp_fv is not None and comp_fv > 0:
            fv_numerator  += w_frac * comp_fv
            fv_weight_sum += w_frac
        # Surface the inputs used so the UI can show which methods fired.
        # All monetary values shown in USD regardless of listing currency.
        _eps_raw = float(_inf.get("forwardEps") or _inf.get("trailingEps") or q.get("eps") or 0) or None
        _tgt_raw = float(_inf.get("targetMeanPrice") or 0) or None
        components.append({
            "symbol":         _sym,
            "name":           h.get("name", ""),
            "weight_pct":     round(w_frac * 100, 2),
            "change_pct":     round(chg_pct * 100, 2),   # store as % (e.g. -3.38, not -0.0338)
            "contribution":   contrib,
            "fair_value":     comp_fv,
            "price":          round(comp_price, 2) if comp_price else None,
            "currency":       _currency,
            "pe_ratio":       float(q.get("pe_ratio")  or _inf.get("forwardPE")  or 0) or None,
            "peg_ratio":      float(q.get("peg_ratio") or _inf.get("trailingPegRatio") or 0) or None,
            "eps":            round(_to_usd(_eps_raw, _currency), 4) if _to_usd(_eps_raw, _currency) else None,
            "analyst_target": round(_to_usd(_tgt_raw, _currency), 2) if _to_usd(_tgt_raw, _currency) else None,
            "fv_methods":     sum([
                bool(_to_usd(_eps_raw, _currency)),
                bool(_inf.get("totalRevenue") and _inf.get("sharesOutstanding")),
                bool(_to_usd(_tgt_raw, _currency)),
            ]),
        })

    direction_score = round(direction_score, 4)
    strength_score  = round(abs(direction_score) / total_w_frac, 4) if total_w_frac else 0.0
    strength_label  = ("Dominant" if strength_score >= 0.60
                       else "Strong"   if strength_score >= 0.40
                       else "Moderate" if strength_score >= 0.20
                       else "Weak")

    if abs(direction_score) <= 0.10:
        action_label = "NEUTRAL / CHOP"
        action_desc  = "No clear direction — wait for breakout or pullback."
    elif direction_score > 0:
        if strength_score >= 0.40:
            action_label = "STRONG UP";   action_desc = "Trend continuation — breakout possible."
        else:
            action_label = "WEAK UP";     action_desc = "Reflex bounce — pullback still intact. Buy levels unchanged."
    else:
        if strength_score >= 0.40:
            action_label = "STRONG DOWN"; action_desc = "High-probability pullback — watch buy zones."
        else:
            action_label = "WEAK DOWN";   action_desc = "Controlled fade — pullback forming."

    up_c   = sorted([c for c in components if c["contribution"] > 0], key=lambda x: -x["contribution"])
    dn_c   = sorted([c for c in components if c["contribution"] < 0], key=lambda x:  x["contribution"])
    up_str = " · ".join(f"{c['symbol']} {c['change_pct']:+.1f}%" for c in up_c[:3]) or "none"
    dn_str = " · ".join(f"{c['symbol']} {c['change_pct']:+.1f}%" for c in dn_c[:3]) or "none"

    if action_label == "STRONG UP":
        interp = f"Strong upward momentum: {up_str}. Trend continuation likely."
    elif action_label == "WEAK UP":
        interp = f"Lifting from {up_str}; dragged by {dn_str}. Reflex bounce — not a reversal."
    elif action_label == "STRONG DOWN":
        interp = f"Heavy selling: {dn_str}. High-probability pullback in progress."
    elif action_label == "WEAK DOWN":
        interp = f"Fading from {dn_str}, offset by {up_str}. Controlled pullback — buy zones approaching."
    else:
        interp = f"Mixed: {up_str} lifting vs {dn_str} dragging. No directional edge."

    # ETF weighted fair value — scaled up to full ETF if partial coverage
    etf_fair_value = None
    etf_fv_coverage_pct = None
    etf_fv_overval_pct = None
    if fv_weight_sum > 0.15 and fv_numerator > 0:
        # Scale partial coverage: if we have 60% of weights with FVs, divide by 0.60
        etf_fair_value = round(fv_numerator / fv_weight_sum * total_w_frac, 2)
        etf_fv_coverage_pct = round(fv_weight_sum / total_w_frac * 100, 1) if total_w_frac else None

    return {
        "eligible":              True,
        "is_top_heavy":          True,
        "top10_weight_pct":      top10_pct,
        "components":            components,
        "direction_score":       direction_score,
        "strength_score":        strength_score,
        "strength_label":        strength_label,
        "action_label":          action_label,
        "action_desc":           action_desc,
        "interpretation":        interp,
        "etf_fair_value":        etf_fair_value,
        "etf_fv_coverage_pct":   etf_fv_coverage_pct,
        "etf_growth_score":      etf_growth_score,
        "etf_growth_regime":     _growth_regime,
        "fv_model_weights":      {"dcf": _W_DCF, "pe": _W_PE, "ps": _W_PS},
    }


if __name__ == "__main__":
    import json
    r = get_research("SMH")
    safe = {k: v for k, v in r.items() if k not in ("chart", "spy_chart")}
    print(json.dumps(safe, indent=2, default=str))
