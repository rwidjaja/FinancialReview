#!/usr/bin/env python3
"""research.indicators — Schwab/yfinance fetch helpers, technical indicators,
period helpers, classification, risk stats, behavioral guardrails."""

from datetime import date
from typing import Optional

import numpy as np


def _safe_corr(a, b) -> float | None:
    """np.corrcoef wrapper that returns None instead of NaN/RuntimeWarning
    when either series has zero variance (constant prices, misaligned calendars)."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if len(a) < 2 or np.std(a) == 0 or np.std(b) == 0:
        return None
    with np.errstate(invalid='ignore', divide='ignore'):
        c = float(np.corrcoef(a, b)[0, 1])
    return None if np.isnan(c) or np.isinf(c) else c


# ── Static fund profile overrides (supplements yfinance for CEFs/specialty funds) ──
# yfinance returns sparse/wrong data for CEFs (quoteType="EQUITY", empty fundFamily, etc.)
# These values are sourced from fund websites / Schwab fund pages.
_FUND_PROFILE_OVERRIDES: dict = {
    "ASGI": {
        "fund_type_label": "Closed-End Fund (CEF)",
        "category":        "Infrastructure",
        "fund_company":    "abrdn Inc.",
        "inception_date":  "2020-07-28",
        "total_assets":    735_530_000,
        "expense_ratio":   0.0165,
        "holdings_count":  54,
        "holdings_url":    "https://www.aberdeenasgi.com/",
    },
    "ADX": {
        "fund_type_label": "Closed-End Fund (CEF)",
        "category":        "Large Blend",
        "fund_company":    "Adams Funds",
        "inception_date":  "1929-07-01",
        "total_assets":    2_980_000_000,
        "expense_ratio":   0.0059,
        "holdings_count":  None,
        "holdings_url":    "https://www.adamsfunds.com/adx/",
    },
    "SPYI": {
        "fund_type_label": "Option Income ETF",
        "category":        "Derivative Income",
        "fund_company":    "NEOS Investments",
        "inception_date":  "2022-08-30",
        "total_assets":    8_060_000_000,
        "expense_ratio":   0.0068,
        "holdings_count":  None,
    },
    "QDVO": {
        "fund_type_label": "Option Income ETF",
        "category":        "Derivative Income",
        "fund_company":    "Amplify ETFs",
        "inception_date":  "2023-05-02",
        "total_assets":    607_250_000,
        "expense_ratio":   0.0056,
        "holdings_count":  None,
    },
    "QQQI": {
        "fund_type_label": "Option Income ETF",
        "category":        "Derivative Income",
        "fund_company":    "NEOS Investments",
        "inception_date":  "2023-12-20",
        "total_assets":    8_930_000_000,
        "expense_ratio":   0.0068,
        "holdings_count":  None,
    },
    "BTCI": {
        "fund_type_label": "Option Income ETF",
        "category":        "Digital Assets",
        "fund_company":    "NEOS Investments",
        "inception_date":  "2023-12-20",
        "expense_ratio":   0.0095,
        "holdings_count":  None,
    },
    "IDVO": {
        "fund_type_label": "Dividend ETF",
        "category":        "Intl Dividend",
        "fund_company":    "Amplify ETFs",
        "inception_date":  "2021-10-07",
        "total_assets":    1_070_000_000,
        "expense_ratio":   0.0065,
        "holdings_count":  None,
    },
    "IYRI": {
        "fund_type_label": "Dividend ETF",
        "category":        "Real Assets / Intl Income",
        "fund_company":    "iShares / BlackRock",
        "expense_ratio":   0.0068,
        "holdings_count":  None,
    },
    "QQQM": {
        "fund_type_label": "Growth ETF",
        "category":        "Large Cap Growth",
        "fund_company":    "Invesco",
        "inception_date":  "2020-10-13",
        "total_assets":    70_710_000_000,
        "expense_ratio":   0.0015,
        "holdings_count":  101,
    },
    "SMH": {
        "fund_type_label": "Sector ETF",
        "category":        "Technology / Semiconductors",
        "fund_company":    "VanEck",
        "inception_date":  "2011-12-20",
        "total_assets":    46_250_000_000,
        "expense_ratio":   0.0035,
        "holdings_count":  26,
    },
}

# ── Schwab data (single call: quote + fundamentals + reference) ───────────────

def _schwab_data(symbol: str) -> dict:
    """
    Single Schwab API call returning quote + fundamental + reference data.
    Replaces the old separate _schwab_quote() + _schwab_fundamentals() calls.
    Returns {} if Schwab is unavailable.
    """
    try:
        from schwab_client import get_quotes
        quotes = get_quotes([symbol])
        return quotes.get(symbol, {})
    except Exception:
        return {}

# Back-compat aliases (callers will be migrated to use sq/sf from the same dict)
def _schwab_quote(symbol: str) -> dict:
    return _schwab_data(symbol)

def _schwab_fundamentals(symbol: str) -> dict:
    return _schwab_data(symbol)


# ── Technical indicators ──────────────────────────────────────────────────────

def _rsi(closes: np.ndarray, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    return round(100 - 100 / (1 + avg_gain / avg_loss), 2)


def _stochastic(highs, lows, closes, k_period=14, d_period=3):
    if len(closes) < k_period:
        return 50.0, 50.0
    k_vals = []
    for i in range(k_period - 1, len(closes)):
        h = np.max(highs[i - k_period + 1:i + 1])
        l = np.min(lows[i - k_period + 1:i + 1])
        k = (closes[i] - l) / (h - l) * 100 if (h - l) > 0 else 50.0
        k_vals.append(k)
    k_smooth = np.convolve(k_vals, np.ones(d_period) / d_period, mode='valid')
    return (round(float(k_vals[-1]), 2) if k_vals else 50.0,
            round(float(k_smooth[-1]), 2) if len(k_smooth) > 0 else 50.0)


def _obv(closes, volumes):
    if len(closes) < 2:
        return 0, True
    obv = [0]
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            obv.append(obv[-1] + volumes[i])
        elif closes[i] < closes[i - 1]:
            obv.append(obv[-1] - volumes[i])
        else:
            obv.append(obv[-1])
    obv = np.array(obv)
    return int(obv[-1]), bool(obv[-1] > obv[-min(20, len(obv))])


def _bollinger(closes, period=20):
    if len(closes) < period:
        c = float(closes[-1]) if len(closes) > 0 else 0
        return c, c, c
    sma = np.mean(closes[-period:])
    std = np.std(closes[-period:])
    return round(float(sma + 2 * std), 2), round(float(sma), 2), round(float(sma - 2 * std), 2)


def _macd(closes):
    if len(closes) < 26:
        return 0.0, False
    # Drop leading NaN/zero prices that corrupt EMA initialization (e.g. new funds, data gaps)
    clean = closes[~np.isnan(closes) & (closes > 0)]
    if len(clean) < 26:
        return 0.0, False
    def ema(arr, n):
        k = 2 / (n + 1)
        e = [arr[0]]
        for v in arr[1:]:
            e.append(v * k + e[-1] * (1 - k))
        return np.array(e)
    ema12 = ema(clean, 12)
    ema26 = ema(clean, 26)
    hist  = (ema12 - ema26)[-1] - ema(ema12 - ema26, 9)[-1]
    import math
    if math.isnan(hist) or math.isinf(hist):
        return 0.0, False
    return round(float(hist), 4), bool(hist > 0)


# ── Period return helpers ─────────────────────────────────────────────────────

def _period_idx(hist_dates: list, n_trading_days: int = None, from_date: date = None) -> int:
    """Return the index into hist_dates for a given lookback."""
    if from_date is not None:
        for i, d in enumerate(hist_dates):
            try:
                if date.fromisoformat(d) >= from_date:
                    return i
            except Exception:
                pass
        return 0
    if n_trading_days is not None:
        return max(0, len(hist_dates) - n_trading_days)
    return 0


def _compute_returns(closes: np.ndarray, dates: list) -> dict:
    """Return % price return for standard periods."""
    today = date.today()
    periods = {
        "1W":  _period_idx(dates, n_trading_days=5),
        "1M":  _period_idx(dates, n_trading_days=21),
        "6M":  _period_idx(dates, n_trading_days=126),
        "YTD": _period_idx(dates, from_date=date(today.year, 1, 2)),
        "1Y":  _period_idx(dates, n_trading_days=252),
        "3Y":  _period_idx(dates, n_trading_days=756),
        "5Y":  _period_idx(dates, n_trading_days=1260),
        "10Y": _period_idx(dates, n_trading_days=2520),
    }
    result = {}
    end = float(closes[-1])
    for label, idx in periods.items():
        if idx >= len(closes):
            result[label] = None
            continue
        start = float(closes[idx])
        result[label] = round((end / start - 1) * 100, 2) if start != 0 else None
    return result


def _normalized_pct(closes: np.ndarray, n: int) -> list:
    """Return last-n closes as % change from first value."""
    if n > len(closes):
        n = len(closes)
    seg = closes[-n:]
    base = float(seg[0]) if seg[0] != 0 else 1.0
    return [round((float(v) / base - 1) * 100, 2) for v in seg]


# ── Analysis text generation ──────────────────────────────────────────────────

def _generate_analysis(symbol, quote, technicals, sym_class=None) -> dict:
    t = technicals
    q = quote
    price    = q.get("last_price", 0)
    ma200    = t.get("ma_200", 0) or 0
    macd_hist = t.get("macd_histogram", 0)
    stoch_k  = t.get("stochastic_k", 50)
    obv_bull = t.get("obv_bullish", False)
    bb_upper = t.get("bollinger_upper", price * 1.05)
    bb_lower = t.get("bollinger_lower", price * 0.95)
    bb_mid   = t.get("bollinger_mid", price)
    hist_vol = t.get("hist_vol_10d", 0)
    vol_today = q.get("volume", 0)
    vol_avg90 = t.get("avg_volume_90d", vol_today or 1)

    above_200 = price > ma200 if ma200 else None
    macd_rising = macd_hist > 0
    _sc     = sym_class or {}
    sym_type = _sc.get("type", "STOCK")
    subtype  = _sc.get("subtype", "")
    _is_income_etf = sym_type in ("ETF", "CEF", "BOND_ETF") or subtype == "option-income"

    if _is_income_etf:
        # ETF/CEF-specific trend language — MAs are weaker signals for income funds
        if above_200 and macd_rising:
            trend_tone = "constructive"
            trend_crs  = "Price is above its 200-day moving average with positive MACD momentum — distribution environment is supportive."
        elif above_200:
            trend_tone = "stable"
            if subtype == "option-income" or sym_type in ("CEF", "BOND_ETF"):
                trend_crs = "Price is above its 200-day moving average. MACD momentum is fading, but that is normal for income-oriented funds."
            else:
                trend_crs = "Price is above its 200-day moving average. MACD momentum is fading — common after extended uptrends."
        elif above_200 is False:
            if subtype == "option-income":
                trend_tone = "income-focused (below MA)"
                trend_crs  = ("Price is below its 200-day moving average, which is typical for option-income strategies that cap "
                               "upside in exchange for yield. Moving averages are weaker signals here — "
                               "focus on distribution stability and NAV trend instead of price momentum.")
            elif sym_type == "CEF":
                trend_tone = "under pressure"
                trend_crs  = ("Price is below its 200-day moving average. For CEFs, this may reflect a widening discount rather than "
                               "fundamental deterioration — verify NAV trend and distribution coverage before drawing conclusions.")
            else:
                trend_tone = "under pressure"
                trend_crs  = "Price is below its 200-day moving average. Monitor NAV trend and distribution sustainability."
        else:
            trend_tone = "mixed"
            trend_crs  = "Trend data limited."
        rs_str = "outperforming" if above_200 else "lagging"
        trend_text = f"{symbol} shows a {trend_tone} price trend. {trend_crs} Price is {rs_str} the S&P 500 on a trend basis."
    else:
        # Stock-specific trend language
        if above_200 and macd_rising:
            trend_tone = "strong bullish"
            trend_crs  = "Its 200-day moving average is upwards sloping and the MACD histogram is above 0 and rising."
        elif above_200:
            trend_tone = "cautiously bullish"
            trend_crs  = "It's trading above its 200-day moving average but MACD momentum is fading."
        elif above_200 is False:
            trend_tone = "bearish"
            trend_crs  = "It's below both its 50-day and 200-day moving averages."
        else:
            trend_tone = "mixed"
            trend_crs  = "Trend data limited."
        trend_text = (
            f"{symbol} appears to be in a {trend_tone} trend. {trend_crs} "
            f"Comparative Relative Strength analysis shows that this issue "
            + ("is outperforming" if above_200 else "is underperforming") + " the S&P 500."
        )

    if stoch_k > 80:
        mom_detail = f"The 14-period Slow Stochastic ({stoch_k:.0f}) is above 80 (overbought). Buyers are actively driving price higher."
    elif stoch_k < 20:
        mom_detail = f"The 14-period Slow Stochastic ({stoch_k:.0f}) is below 20 (oversold). A reversal rally is possible."
    else:
        mom_detail = f"The Stochastic oscillator is at {stoch_k:.0f} — neutral territory with no clear directional bias."
    mom_text = f"Momentum for {symbol}: {mom_detail}"

    if vol_today and vol_avg90:
        vol_ratio = vol_today / vol_avg90
        vol_desc  = "lighter than usual" if vol_ratio < 0.85 else "heavier than usual" if vol_ratio > 1.15 else "near average"
        obv_str   = "bullish (buyers dominant)" if obv_bull else "bearish (sellers dominant)"
        vol_text  = (f"Volume is {vol_desc} ({vol_today:,.0f} vs {vol_avg90:,.0f} 90-day avg). OBV is {obv_str}.")
    else:
        vol_text = "Volume data unavailable."

    bb_width = (bb_upper - bb_lower) / bb_mid if bb_mid else 0
    if bb_width > 0.12:
        bb_desc = f"wider than usual ({hist_vol:.1f}% annualized vol). A pause or reversal may follow."
    elif bb_width < 0.04:
        bb_desc = f"in a Squeeze ({hist_vol:.1f}% annualized vol). A large move may be imminent."
    else:
        bb_desc = f"near normal ({hist_vol:.1f}% annualized vol). No unusual volatility signal."
    vol_text2 = f"Bollinger Bands® are {bb_desc}"

    return {"trend": trend_text, "momentum": mom_text, "volume": vol_text, "volatility": vol_text2}


# ── Risk statistics vs benchmark ──────────────────────────────────────────────

def _align_series(a_closes, a_dates, b_closes, b_dates):
    """Align two price series by matching dates, return (a_rets, b_rets)."""
    b_map = {d: float(b_closes[i]) for i, d in enumerate(b_dates)}
    a_rets, b_rets = [], []
    prev_a = prev_b = None
    for i, d in enumerate(a_dates):
        if d in b_map:
            ca = float(a_closes[i])
            cb = b_map[d]
            if prev_a is not None and prev_b is not None and prev_a != 0 and prev_b != 0:
                a_rets.append(ca / prev_a - 1)
                b_rets.append(cb / prev_b - 1)
            prev_a, prev_b = ca, cb
    return np.array(a_rets), np.array(b_rets)


def _risk_stats(fund_closes, fund_dates, bench_closes, bench_dates, years=3) -> dict:
    """
    Compute Alpha, Beta, R-Squared, Upside/Downside Capture Ratio.
    Uses last `years` years of aligned daily returns.
    """
    n = years * 252
    fc = fund_closes[-n:]; fd = fund_dates[-n:]
    bc = bench_closes[-n:]; bd = bench_dates[-n:]
    f_rets, b_rets = _align_series(fc, fd, bc, bd)
    if len(f_rets) < 30:
        return {}
    cov_matrix = np.cov(f_rets, b_rets)
    beta = cov_matrix[0, 1] / cov_matrix[1, 1] if cov_matrix[1, 1] != 0 else 1.0
    alpha_daily = np.mean(f_rets) - beta * np.mean(b_rets)
    alpha_annual = round(float(alpha_daily * 252 * 100), 2)
    corr = _safe_corr(f_rets, b_rets) or 0.0
    r_squared = round(corr ** 2 * 100, 2)
    # Upside / Downside Capture
    up_mask   = b_rets > 0
    down_mask = b_rets < 0
    up_cap   = round(float(np.mean(f_rets[up_mask])   / np.mean(b_rets[up_mask])   * 100), 2) if up_mask.any()   else None
    down_cap = round(float(np.mean(f_rets[down_mask]) / np.mean(b_rets[down_mask]) * 100), 2) if down_mask.any() else None
    # Annualized Sharpe (rf=0)
    sharpe = round(float(np.mean(f_rets) / np.std(f_rets) * np.sqrt(252)), 2) if np.std(f_rets) > 0 else None
    # Max drawdown over period
    cum = np.cumprod(1 + f_rets)
    peak = np.maximum.accumulate(cum)
    dd = (cum - peak) / peak
    max_dd = round(float(np.min(dd) * 100), 2)
    return {
        "beta":                round(float(beta), 3),
        "alpha":               alpha_annual,
        "r_squared":           r_squared,
        "corr_spy":            round(corr, 3),   # signed Pearson correlation vs benchmark
        "upside_capture":      up_cap,
        "downside_capture":    down_cap,
        "sharpe":              sharpe,
        "max_drawdown":        max_dd,
        "period_years":        years,
    }


def _annualized_ret(closes, dates, years) -> Optional[float]:
    n = int(years * 252)
    if len(closes) < n:
        return None
    start = float(closes[-n])
    end   = float(closes[-1])
    if start <= 0:
        return None
    return round(((end / start) ** (1 / years) - 1) * 100, 2)


# ── Symbol classifier ─────────────────────────────────────────────────────────

def _classify_symbol(symbol: str, info: dict, sq: dict, overrides: dict) -> dict:
    """
    Classify a symbol into a canonical type/subtype.
    Priority: Schwab asset_sub_type > override fund_type_label > yfinance quoteType > name heuristics.
    Returns a dict consumed by the frontend for conditional rendering and guardrails.
    """
    qt         = (sq.get("asset_sub_type") or info.get("quoteType") or "EQUITY").upper()
    name       = (sq.get("description") or info.get("longName") or info.get("shortName") or "").lower()
    cat        = (info.get("category") or info.get("sectorDisp") or "").lower()
    fund_label = (overrides.get("fund_type_label") or "").lower()

    # Step 1: base type from Schwab/yfinance quoteType
    if qt in ("CEF",):
        sym_type = "CEF"
    elif qt in ("ETF", "MUTUALFUND"):
        sym_type = "ETF"
    elif qt in ("CRYPTO", "CRYPTOCURRENCY"):
        sym_type = "CRYPTO_ETP"
    elif qt in ("INDEX",):
        sym_type = "INDEX"
    else:
        sym_type = "STOCK"

    # Step 2: CEF detection (yfinance returns quoteType="EQUITY" for CEFs)
    if "closed-end" in fund_label or "closed-end" in name or "closed end" in name:
        sym_type = "CEF"

    # Step 3: MMF detection
    if "money market" in name or "money mkt" in name or qt == "MMF":
        sym_type = "MMF"

    # Step 4: Bond ETF detection (refinement within ETF)
    if sym_type == "ETF" and any(x in name for x in ["treasury", " bond ", "bonds", "fixed income", "aggregate", " credit "]):
        sym_type = "BOND_ETF"
    if sym_type == "ETF" and "fixed income" in cat:
        sym_type = "BOND_ETF"

    # Step 5: Crypto ETP (some show up as ETF or EQUITY)
    if any(x in name for x in ["bitcoin", "ethereum", "btc trust", "crypto", "digital asset", "blockchain etf"]):
        if sym_type in ("ETF", "STOCK", "BOND_ETF"):
            sym_type = "CRYPTO_ETP"
    if "digital assets" in cat or "cryptocurrency" in cat:
        sym_type = "CRYPTO_ETP"

    # Step 6: BDC detection
    if "business development" in name or "bdc" in name or "bdc" in fund_label:
        sym_type = "BDC"

    # Step 7: REIT detection
    if "reit" in cat or "real estate investment trust" in name or " real estate " in name:
        sym_type = "REIT"

    # Step 8: Preferred Stock detection
    if sym_type == "STOCK" and ("preferred" in name or "preferred" in cat or symbol.endswith("-p") or symbol.startswith("pf")):
        sym_type = "PREFERRED"

    # Step 9: ETN detection
    if "etn" in name or "exchange-traded note" in name or "etn" in fund_label:
        sym_type = "ETN"

    # Subtype (informational; does not change type)
    # Priority:
    #   1. _FUND_PROFILE_OVERRIDES label (known specialty funds with sparse yfinance data)
    #   2. yfinance category text heuristics
    #   3. Schwab live div_yield — mirrors _auto_classify_fund() thresholds so both
    #      engines agree without hardcoding any symbol names
    subtype = ""
    if sym_type in ("ETF", "CEF"):
        if any(x in fund_label for x in ["option income", "covered call", "derivative income", "yieldmax"]):
            subtype = "option-income"
        elif any(x in fund_label for x in ["leveraged", "2x", "3x", "ultra short", "ultrashort"]):
            subtype = "leveraged"
        elif any(x in fund_label for x in ["dividend", "div etf", "div fund"]):
            subtype = "dividend"
        elif "growth" in fund_label or "growth" in cat:
            subtype = "growth"
        elif "sector" in fund_label:
            subtype = "sector"

    # Dynamic yield-based fallback — same thresholds as portfolio_data._auto_classify_fund
    # so any new symbol is auto-classified without manual override entries.
    if sym_type == "ETF" and not subtype:
        _dyn_yield = float(sq.get("div_yield") or 0)   # Schwab: whole-number % (e.g. 10.5)
        if _dyn_yield >= 7.0:
            subtype = "option-income"
        elif _dyn_yield >= 2.0:
            subtype = "dividend"
        elif any(x in cat for x in [
            "technology", "semiconductor", "communication", "health",
            "energy", "consumer", "financial", "industrial", "material",
            "real estate", "utilities", "sector"
        ]):
            subtype = "sector"
        else:
            subtype = "growth"   # generic equity ETF default

    _LABELS = {
        "STOCK":      "Stock",
        "ETF":        "ETF",
        "CEF":        "Closed-End Fund",
        "BOND_ETF":   "Bond ETF",
        "MMF":        "Money Market Fund",
        "CRYPTO_ETP": "Crypto ETP",
        "INDEX":      "Index",
        "BDC":        "BDC",
        "REIT":       "REIT",
        "PREFERRED":  "Preferred Stock",
        "ETN":        "ETN",
    }
    _SUBTYPE_LABELS = {
        "option-income": "Option Income",
        "leveraged":     "Leveraged",
        "dividend":      "Dividend",
        "growth":        "Growth",
        "sector":        "Sector",
    }

    sleeve = _classify_sleeve({"type": sym_type, "subtype": subtype}, info)

    return {
        "type":              sym_type,
        "subtype":           subtype,
        "display_label":     _LABELS.get(sym_type, sym_type),
        "subtype_label":     _SUBTYPE_LABELS.get(subtype, ""),
        "sleeve":            sleeve,
        "show_technicals":   sym_type not in ("MMF", "INDEX", "BDC", "PREFERRED"),
        "show_fundamentals": sym_type in ("STOCK", "BDC", "REIT"),
        "show_nav_analysis": sym_type in ("ETF", "CEF", "BOND_ETF"),
        "show_bdc_metrics":  sym_type == "BDC",
        "show_reit_metrics": sym_type == "REIT",
    }


def _classify_sleeve(sym_class: dict, info: dict) -> str:
    """
    Auto-classify a symbol into portfolio sleeve.
    Uses asset type + category + name heuristics — no manual data required.
    """
    sym_type = sym_class.get("type", "STOCK")
    subtype  = sym_class.get("subtype", "")
    cat      = (info.get("category") or info.get("sectorDisp") or info.get("sector") or "").lower()
    name_l   = (info.get("longName") or info.get("shortName") or "").lower()

    # Alternatives (most specific — override everything)
    if sym_type == "CRYPTO_ETP":
        return "Alternatives"
    if any(x in cat for x in ["real estate", "reit", "infrastructure", "commodity",
                                "commodities", "alternatives", "digital asset", "cryptocurrency"]):
        return "Alternatives"

    # International
    if any(x in cat for x in ["international", "global", "emerging market", "foreign",
                                "world", "europe", "asia", "ex-us", "ex us", "intl"]):
        return "International"
    if any(x in name_l for x in ["international", "emerging market", " global ", "foreign"]):
        return "International"

    # Stability
    if sym_type in ("BOND_ETF", "MMF"):
        return "Stability"
    if any(x in cat for x in ["bond", "treasury", "fixed income", "money market",
                                "short-term", "ultrashort", "stable value"]):
        return "Stability"

    # Income
    if sym_type == "CEF":
        return "Income"
    if subtype in ("option-income", "dividend"):
        return "Income"
    if any(x in cat for x in ["dividend", "income", "high yield", "derivative income", "high-yield"]):
        return "Income"
    if any(x in name_l for x in ["income fund", "dividend fund", "high yield"]):
        return "Income"

    # Growth (default for stocks and most ETFs)
    return "Growth"


def _behavioral_guardrails(sym_class: dict, quote: dict, technicals: dict,
                            distributions: dict, events: dict, risk_stats: dict,
                            annualized_returns: dict = None) -> list:
    """
    Generate type-aware behavioral guardrail warnings.
    Each entry: {"level": "WARN"|"INFO", "code": str, "msg": str}
    """
    warnings_list = []
    sym_type = sym_class.get("type", "STOCK")
    subtype  = sym_class.get("subtype", "")
    price    = quote.get("last_price", 0) or 0
    beta     = float(risk_stats.get("beta") or 0)
    prem_disc = float(quote.get("premium_discount", 0) or 0)

    # ── ETF / CEF / Bond ETF guardrails ───────────────────────────────────────
    if sym_type in ("ETF", "CEF", "BOND_ETF"):
        ttm_yield = float(distributions.get("ttm_yield_pct") or distributions.get("market_yield_pct") or 0)
        if ttm_yield > 25:
            warnings_list.append({"level": "WARN", "code": "EXTREME_YIELD",
                "msg": f"Yield {ttm_yield:.1f}% is extremely high — likely includes significant return of capital. Verify NAV trend before adding."})
        elif ttm_yield > 15:
            warnings_list.append({"level": "WARN", "code": "HIGH_YIELD",
                "msg": f"Yield {ttm_yield:.1f}% — verify distribution sustainability. High yields often reflect NAV erosion or ROC."})

    if sym_type == "CEF":
        if prem_disc > 2.5:
            warnings_list.append({"level": "WARN", "code": "CEF_PREMIUM",
                "msg": f"CEF trading at +{prem_disc:.1f}% premium to NAV — elevated entry risk; wait for discount or NAV to catch up."})
        elif prem_disc < -8.0:
            warnings_list.append({"level": "INFO", "code": "CEF_DEEP_DISCOUNT",
                "msg": f"CEF at {prem_disc:.1f}% discount — potential value opportunity; verify distribution is not being cut."})

    if subtype == "leveraged":
        warnings_list.append({"level": "WARN", "code": "LEVERAGED",
            "msg": "Leveraged ETF — volatility decay makes long holds destructive. Use only for short-term tactical trades."})

    if sym_type == "CRYPTO_ETP":
        warnings_list.append({"level": "WARN", "code": "CRYPTO_VOLATILITY",
            "msg": "Crypto ETP — extreme volatility is normal; standard technicals apply but size very small and use tight stops."})

    # ── Beta warnings (all types) ─────────────────────────────────────────────
    if beta > 2.0:
        warnings_list.append({"level": "WARN", "code": "HIGH_BETA",
            "msg": f"Beta {beta:.2f} — over 2× market sensitivity. Size small only and set volatility-based stops."})
    elif beta > 1.5:
        warnings_list.append({"level": "INFO", "code": "ELEVATED_BETA",
            "msg": f"Beta {beta:.2f} — above-average market sensitivity. Monitor position size relative to portfolio."})

    # ── Earnings proximity (stocks only) ─────────────────────────────────────
    if sym_type == "STOCK":
        earnings_date_str = (events or {}).get("earnings_date", "") or ""
        if earnings_date_str and earnings_date_str not in ("None", "nan", ""):
            try:
                ed = date.fromisoformat(earnings_date_str[:10])
                days_away = (ed - date.today()).days
                if 0 <= days_away <= 7:
                    warnings_list.append({"level": "WARN", "code": "EARNINGS_IMMINENT",
                        "msg": f"Earnings in {days_away} day(s) — expect elevated volatility; avoid new adds until after the report."})
                elif 8 <= days_away <= 21:
                    warnings_list.append({"level": "WARN", "code": "EARNINGS_NEAR",
                        "msg": f"Earnings in {days_away} days — reduce size or avoid new adds until results are known."})
            except Exception:
                pass

    # ── MMF notice ────────────────────────────────────────────────────────────
    if sym_type == "MMF":
        warnings_list.append({"level": "INFO", "code": "MMF",
            "msg": "Money market fund — no price trend or momentum signals apply. Evaluate yield vs T-bills and alternatives."})

    # ── Long-term performance filter ──────────────────────────────────────────
    if annualized_returns:
        sym_ann = annualized_returns.get("symbol", {})
        ret_5y  = sym_ann.get("5Y")
        ret_3y  = sym_ann.get("3Y")
        if ret_5y is not None and ret_5y < 0 and sym_type in ("CEF", "ETF"):
            warnings_list.append({"level": "WARN", "code": "NEGATIVE_5Y_RETURN",
                "msg": f"5-year annualized return is {ret_5y:.1f}% — negative long-term price trend. Verify distribution is not funded by NAV erosion."})
        elif ret_5y is not None and ret_5y < 3 and sym_type == "CEF":
            warnings_list.append({"level": "WARN", "code": "WEAK_5Y_RETURN",
                "msg": f"5-year annualized return is only {ret_5y:.1f}% — weak for a CEF. Verify the high yield is not masking total return destruction."})
        if ret_3y is not None and ret_3y < -10 and sym_type in ("CEF", "ETF"):
            warnings_list.append({"level": "WARN", "code": "POOR_3Y_RETURN",
                "msg": f"3-year annualized return is {ret_3y:.1f}% — significant capital erosion over medium term."})

    return warnings_list


