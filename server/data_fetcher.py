import os
import json as _json_mod
import yfinance as yf
import pandas as pd
import numpy as np
from typing import Optional, Tuple

from models import EtfSnapshot

# Point yfinance's SQLite cache to the server directory so it survives across
# macOS temp-dir cleanups (/var/folders gets wiped → OperationalError on .db open).
_YF_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".yfinance_cache")
os.makedirs(_YF_CACHE_DIR, exist_ok=True)
try:
    yf.set_tz_cache_location(_YF_CACHE_DIR)
except Exception:
    pass

# CEF detection is now done via Schwab assetSubType ("CEF") — no hardcoded list needed.
# FALLBACK_DATA is loaded from fallback_data.json so it can be updated without code changes.
_FALLBACK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fallback_data.json")
try:
    with open(_FALLBACK_PATH) as _f:
        FALLBACK_DATA: dict = {k: v for k, v in _json_mod.load(_f).items() if not k.startswith("_")}
except Exception:
    FALLBACK_DATA = {}

# ── Daily NAV cache refresh ───────────────────────────────────────────────────
def refresh_nav_cache() -> None:
    """Refresh NAVs for every CEF and option-income ETF in the current portfolio.

    Strategy
    --------
    1. Read current holdings from schwab_client (what you actually hold today).
    2. Identify CEFs (asset_sub_type == "CEF") and income funds (div_yield ≥ 5%: ETFs, BDCs, REITs).
    3. Fetch navPrice from yfinance for each candidate.
    4. Write results to nav_cache table in dashboard.db.
       - yfinance success  → stored with source='yfinance'
       - yfinance failure  → fall back to existing DB row (no overwrite)

    Called at server startup and once per trading day at market open so the
    cache always reflects current holdings — no manual list required.
    """
    import db_manager as _dbm

    # ── 1. Get current symbols + Schwab quote metadata ────────────────────────
    try:
        import schwab_client as _sc
        sq_map: dict = {}
        try:
            quotes = _sc.get_quotes()   # {symbol: schwab_quote_dict}
            sq_map = quotes if isinstance(quotes, dict) else {}
        except Exception:
            pass
    except Exception as e:
        print(f"[refresh_nav_cache] Could not load schwab_client: {e}")
        sq_map = {}

    # If Schwab quotes unavailable, only re-refresh symbols already in nav_cache
    # (from a prior Schwab-informed run).  We cannot correctly identify new CEFs
    # or high-yield ETFs without Schwab's asset_sub_type / div_yield fields.
    if sq_map:
        candidates = [
            sym for sym, q in sq_map.items()
            if q.get("asset_sub_type") == "CEF"
            or float(q.get("div_yield") or 0) >= 5.0
        ]
    else:
        # Refresh only what's already known — avoids mis-classifying standard ETFs
        candidates = list(_dbm.nav_get_all().keys())

    if not candidates:
        print("[refresh_nav_cache] No CEF/option-income ETF candidates found — skipping.")
        return

    # ── 2. Fetch navPrice from yfinance and upsert into DB ───────────────────
    updated, kept, failed = [], [], []
    for sym in sorted(candidates):
        if sym in ("CASH", "SWVXX"):       # money-market / cash — no NAV concept
            continue
        try:
            info    = yf.Ticker(sym).info
            new_nav = info.get("navPrice")

            if new_nav and isinstance(new_nav, (int, float)) and new_nav > 0:
                # Candidates are pre-filtered to CEF/high-yield ETF by Schwab metadata,
                # or are already in nav_cache from a prior run — safe to store directly.
                old_nav = _dbm.nav_get(sym)
                _dbm.nav_set(sym, float(new_nav), source="yfinance")
                if old_nav != round(float(new_nav), 4):
                    updated.append(f"{sym}: {old_nav} → {new_nav:.4f}")
                else:
                    kept.append(sym)
            else:
                # yfinance has no navPrice — preserve existing DB row if any
                if _dbm.nav_get(sym) is not None:
                    kept.append(f"{sym}(cached)")
                # Note: no fallback from JSON — JSON no longer stores nav
        except Exception as e:
            failed.append(sym)
            print(f"[refresh_nav_cache] {sym}: {e}")

    parts = []
    if updated: parts.append(f"updated {len(updated)}: {', '.join(updated)}")
    if kept:    parts.append(f"unchanged {len(kept)}")
    if failed:  parts.append(f"failed {len(failed)}: {', '.join(failed)}")
    print(f"[refresh_nav_cache] {' | '.join(parts) or 'nothing to do'}")


# ── Module-level cache: SPY 1Y history fetched once for all beta computations ──
_SPY_HIST: Optional[pd.DataFrame] = None


def _fetch_history_with_fallback(symbol: str, preferred_period: str = "1y") -> pd.DataFrame:
    """
    Fetch ticker history, falling back to shorter periods if the preferred one
    returns empty (yfinance 1.x can return empty for some ETF types on period='1y').
    """
    fallback_periods = ["1y", "11mo", "6mo", "3mo"]
    if preferred_period not in fallback_periods:
        fallback_periods.insert(0, preferred_period)
    # De-dupe while preserving order
    seen: set = set()
    ordered: list = []
    for p in fallback_periods:
        if p not in seen:
            seen.add(p)
            ordered.append(p)

    for period in ordered:
        try:
            hist = yf.Ticker(symbol).history(period=period)
            if not hist.empty:
                return hist
        except Exception:
            continue
    return pd.DataFrame()  # all periods failed


def _get_spy_hist() -> pd.DataFrame:
    global _SPY_HIST
    if _SPY_HIST is None:
        _SPY_HIST = _fetch_history_with_fallback("SPY")
    return _SPY_HIST


# ── Cache clearing ────────────────────────────────────────────────────────────

def clear_caches():
    """Clear all module-level caches to force fresh data on next fetch."""
    global _SPY_HIST
    _SPY_HIST = None

# ── VIX snapshot ───────────────────────────────────────────────────────────────

def get_vix_snapshot() -> Tuple[Optional[float], Optional[float]]:
    """Returns (vix_current, vix_90d_avg). Both may be None on network failure."""
    try:
        hist = yf.Ticker("^VIX").history(period="6mo")
        if hist.empty:
            return None, None
        vix_current = float(hist["Close"].iloc[-1])
        vix_90d_avg = float(hist["Close"].tail(63).mean()) if len(hist) >= 63 \
                      else float(hist["Close"].mean())
        return vix_current, vix_90d_avg
    except Exception:
        return None, None


# ── Benchmark 1Y total return ──────────────────────────────────────────────────

def get_benchmark_return(benchmark_symbol: str) -> Optional[float]:
    """1Y total return (price appreciation + dividends) for a benchmark ticker."""
    try:
        hist = _fetch_history_with_fallback(benchmark_symbol)
        if hist.empty or len(hist) < 2:
            return None
        price_start = float(hist["Close"].iloc[0])
        price_end   = float(hist["Close"].iloc[-1])
        div_sum     = float(hist["Dividends"].sum()) if "Dividends" in hist else 0.0
        return (price_end - price_start + div_sum) / price_start if price_start > 0 else None
    except Exception:
        return None


# ── Portfolio correlation matrix ───────────────────────────────────────────────

def get_portfolio_correlation(symbols: list) -> Optional[pd.DataFrame]:
    """
    Compute a correlation matrix of 6M daily price returns for the given symbols.
    Returns a pd.DataFrame or None if data is insufficient.
    """
    try:
        series = {}
        for sym in symbols:
            hist = yf.Ticker(sym).history(period="6mo")
            if not hist.empty:
                series[sym] = hist["Close"].pct_change().dropna()
        if len(series) < 2:
            return None
        df = pd.DataFrame(series).dropna()
        return df.corr().round(2)
    except Exception:
        return None


# ── Split detection ────────────────────────────────────────────────────────────

def detect_split(symbol: str) -> Tuple[bool, Optional[float], Optional[str]]:
    """
    Returns (split_mode, split_ratio, split_type) by fetching unadjusted history.

    Rule 1 (Confirmed): recent Close/AdjClose ratio shift > 1.5x in the last 5 days.
    Rule 2 (Possible):  most recent 1-day return < -50% on normal volume (±30% of 90d avg).

    When split_mode=True, callers should rebase historical prices and freeze SELL signals.
    """
    try:
        ticker = yf.Ticker(symbol)
        # auto_adjust=False gives raw Close + Adj Close so we can compute the split ratio.
        # Fall back to shorter periods if 1y returns empty (yfinance 1.x quirk).
        hist = pd.DataFrame()
        for _p in ["1y", "6mo", "3mo"]:
            try:
                _h = ticker.history(period=_p, auto_adjust=False)
                if not _h.empty:
                    hist = _h
                    break
            except Exception:
                continue
        if hist.empty or "Close" not in hist or "Adj Close" not in hist:
            return False, None, None

        close = hist["Close"]
        adj   = hist["Adj Close"]

        # Build daily ratio (raw/adjusted). For fully adjusted data ratio ≈ 1 all the time.
        # A split makes Close jump while Adj Close stays smooth → ratio spikes.
        ratio = (close / adj).replace([float("inf"), float("-inf")], None).dropna()
        if len(ratio) < 6:
            return False, None, None

        recent_ratio  = float(ratio.iloc[-1])
        baseline_ratio = float(ratio.iloc[:-5].median())

        if baseline_ratio > 0:
            ratio_change = recent_ratio / baseline_ratio
        else:
            ratio_change = 1.0

        # Rule 1: confirmed split — ratio shifted by >1.5x in last 5 trading days
        if ratio_change > 1.5:
            return True, round(ratio_change, 4), "CONFIRMED"

        # Rule 2: possible split — raw 1-day return < -50% with normal volume
        if len(close) >= 2:
            day_ret = float(close.iloc[-1]) / float(close.iloc[-2]) - 1
            if day_ret < -0.50 and "Volume" in hist:
                vol_today = float(hist["Volume"].iloc[-1])
                vol_90d   = float(hist["Volume"].tail(90).mean()) if len(hist) >= 90 else vol_today
                vol_ratio = vol_today / vol_90d if vol_90d > 0 else 1.0
                # Normal volume = within ±30% of the 90-day average
                if 0.70 <= vol_ratio <= 1.30:
                    implied_ratio = 1.0 / (1.0 + day_ret)  # e.g. -50% → 2.0
                    return True, round(implied_ratio, 4), "POSSIBLE"

        return False, None, None
    except Exception:
        return False, None, None


# ── Per-fund snapshot ──────────────────────────────────────────────────────────

def _calculate_linear_slope(series: pd.Series) -> Tuple[float, float]:
    """
    Calculate linear regression slope and std dev of residuals.
    Returns (slope_per_day, std_dev_of_residuals)
    """
    if len(series) < 2:
        return 0.0, 0.0
    x = np.arange(len(series))
    y = series.values
    # Linear regression: y = mx + b
    coeffs = np.polyfit(x, y, 1)
    slope = coeffs[0]
    # Calculate residuals
    y_pred = np.polyval(coeffs, x)
    residuals = y - y_pred
    std_dev = np.std(residuals)
    return slope, std_dev


def get_snapshot(
    symbol: str,
    benchmark: str = "SPY",
    vix_current: Optional[float] = None,
    vix_90d_avg: Optional[float] = None,
    schwab_quote: Optional[dict] = None,  # pre-fetched Schwab data (avoids double-fetch)
) -> EtfSnapshot:
    ticker = yf.Ticker(symbol)
    sq = schwab_quote or {}

    # ── Price resolution — Schwab is primary, yfinance is fallback ───────────
    # Schwab has authoritative real-time prices for every holding in the account.
    # yfinance is only needed for historical indicators (SMA, RSI, MACD, etc.).
    # If yfinance fails for a symbol (e.g. smaller CEFs with spotty coverage),
    # we still proceed with the Schwab price and leave historical fields as None.

    # 1. Fetch 1Y of daily history for technical indicators (best-effort).
    hist = _fetch_history_with_fallback(symbol)
    hist_available = not hist.empty

    # Need at least one price source — prefer Schwab, fall back to yfinance last close.
    schwab_price = sq.get("price")
    if not schwab_price and not hist_available:
        raise ValueError(f"No price data for {symbol} — Schwab quote unavailable and yfinance returned no history")

    current_price    = float(schwab_price) if schwab_price else float(hist["Close"].iloc[-1])
    prev_close       = sq.get("close") or (float(hist["Close"].iloc[-2]) if hist_available and len(hist) >= 2 else current_price)
    price_change     = sq.get("change") or (current_price - prev_close)
    price_change_pct = sq.get("change_pct") or (price_change / prev_close if prev_close > 0 else 0.0)
    day_low          = sq.get("day_low") or (float(hist["Low"].iloc[-1]) if hist_available and "Low" in hist.columns else None)

    # 2. Moving averages (yfinance history required)
    sma_20  = float(hist["Close"].rolling(20).mean().iloc[-1])  if hist_available and len(hist) >= 20  else None
    sma_50  = float(hist["Close"].rolling(50).mean().iloc[-1])  if hist_available and len(hist) >= 50  else None
    sma_200 = float(hist["Close"].rolling(200).mean().iloc[-1]) if hist_available and len(hist) >= 200 else None

    # 3. 6M max drawdown
    if hist_available:
        hist_6m     = hist.tail(126)
        rolling_max = hist_6m["Close"].cummax()
        drawdown    = (hist_6m["Close"] - rolling_max) / rolling_max
        max_drawdown_6m = float(drawdown.min())
    else:
        max_drawdown_6m = None

    # 4. Volume trend
    if hist_available:
        vol_10d = float(hist["Volume"].tail(10).mean()) if len(hist) >= 10 else 0.0
        vol_90d = float(hist["Volume"].tail(90).mean()) if len(hist) >= 90 else 0.0
        if   vol_10d > vol_90d * 1.2: volume_trend = "Surging (Institutional Activity)"
        elif vol_10d < vol_90d * 0.8: volume_trend = "Fading (Decreasing Conviction)"
        else:                          volume_trend = "Stable"
    else:
        volume_trend = "Unavailable"

    # 5. 30D price drawdown from local high
    if hist_available:
        recent_30d   = hist.tail(21)
        high_30d     = float(recent_30d["High"].max())
        nav_drop_30d = (high_30d - current_price) / high_30d if high_30d > 0 else 0.0
    else:
        recent_30d   = pd.DataFrame()
        nav_drop_30d = 0.0

    # 6. 90D price trend and 20D momentum
    trend_90d    = (current_price / float(hist["Close"].iloc[-63]) - 1) if hist_available and len(hist) >= 63 else 0.0
    momentum_20d = (current_price / float(hist["Close"].iloc[-14]) - 1) if hist_available and len(hist) >= 14 else 0.0

    # 7. Annualised 30D volatility
    if hist_available and len(recent_30d) > 1:
        vol_30d_annual = float(recent_30d["Close"].pct_change().dropna().std() * np.sqrt(252))
    else:
        vol_30d_annual = 0.0

    # 8. RSI(14) and MACD
    rsi_14 = None
    if hist_available and len(hist) >= 15:
        delta    = hist["Close"].diff()
        avg_gain = delta.clip(lower=0).ewm(com=13, min_periods=14).mean().iloc[-1]
        avg_loss = (-delta).clip(lower=0).ewm(com=13, min_periods=14).mean().iloc[-1]
        rsi_14   = float(100 - 100 / (1 + avg_gain / avg_loss)) if avg_loss > 0 else 100.0

    macd_bullish = None
    if hist_available and len(hist) >= 35:
        macd_line   = hist["Close"].ewm(span=12, adjust=False).mean() - \
                      hist["Close"].ewm(span=26, adjust=False).mean()
        signal_line = macd_line.ewm(span=9, adjust=False).mean()
        macd_bullish = bool(macd_line.iloc[-1] > signal_line.iloc[-1])

    # 9. Distribution history
    last_distribution = None
    distribution_cut_pct = None
    dividend_months: list = []
    # Schwab is authoritative for last payment amount
    if sq.get("div_pay_amount") and sq["div_pay_amount"] > 0:
        last_distribution = float(sq["div_pay_amount"])
    if hist_available and "Dividends" in hist:
        paid = hist[hist["Dividends"] > 0]["Dividends"]
        if last_distribution is None and len(paid) > 0:
            last_distribution = float(paid.iloc[-1])
        if len(paid) >= 4 and last_distribution is not None:
            prior_median = float(paid.iloc[-4:-1].median())
            if prior_median > 0:
                distribution_cut_pct = (last_distribution - prior_median) / prior_median
        if not paid.empty:
            dividend_months = sorted(set(int(d) for d in paid.index.month.tolist()))

    # 10. Info + fallback metadata (yfinance best-effort — None fields are fine)
    try:
        info = ticker.info if hist_available else {}
    except Exception:
        info = {}
    fund_name  = info.get("longName") or info.get("shortName") or sq.get("description") or ""
    fallback   = FALLBACK_DATA.get(symbol, {})

    # ── NAV resolution ────────────────────────────────────────────────────────
    yahoo_nav    = info.get("navPrice")
    is_cef       = sq.get("asset_sub_type") == "CEF"
    # Schwab doesn't always return asset_sub_type="CEF" for closed-end funds;
    # cross-check against our fund profile overrides (which use fund_type_label).
    if not is_cef:
        try:
            from research.indicators import _FUND_PROFILE_OVERRIDES as _FPO
            if "closed-end" in _FPO.get(symbol, {}).get("fund_type_label", "").lower():
                is_cef = True
        except Exception:
            pass
    div_yield_pct = float(sq.get("div_yield") or 0)
    is_option_income_etf = (not is_cef) and div_yield_pct >= 5.0

    if is_cef or is_option_income_etf:
        import db_manager as _dbm
        db_nav = _dbm.nav_get(symbol)
        nav = yahoo_nav or db_nav or current_price
    else:
        if yahoo_nav and abs(yahoo_nav / prev_close - 1) <= 0.02:
            nav = yahoo_nav
        else:
            nav = prev_close

    if nav and not is_cef:
        _implied_prem = abs(current_price / nav - 1)
        if _implied_prem > 0.01:
            nav = prev_close

    expense_ratio  = info.get("expenseRatio") or fallback.get("expense_ratio")
    aum            = info.get("totalAssets") or fallback.get("aum")
    coverage_ratio = fallback.get("coverage_ratio")

    # 11. Annual yield — Schwab first, yfinance fallback
    if sq.get("div_amount") and sq["div_amount"] > 0 and current_price > 0:
        ttm_yield = sq["div_amount"] / current_price
    elif sq.get("div_yield") and sq["div_yield"] > 0:
        ttm_yield = sq["div_yield"] / 100.0
    elif hist_available and "Dividends" in hist:
        cutoff  = pd.Timestamp.now(tz="UTC") - pd.DateOffset(years=1)
        divs_tz = hist["Dividends"].copy()
        if divs_tz.index.tz is None:
            divs_tz.index = divs_tz.index.tz_localize("UTC")
        ttm_div   = float(divs_tz[divs_tz.index >= cutoff].sum())
        ttm_yield = ttm_div / current_price if current_price > 0 else 0.0
        if ttm_yield == 0.0 and info.get("trailingAnnualDividendYield"):
            ttm_yield = float(info["trailingAnnualDividendYield"])
    else:
        ttm_yield = float(info.get("trailingAnnualDividendYield") or 0.0)

    # 12. 1Y total return
    total_return_1y = None
    if hist_available and len(hist) >= 2:
        p_start = float(hist["Close"].iloc[0])
        p_end   = current_price
        divs    = float(hist["Dividends"].sum()) if "Dividends" in hist else 0.0
        if p_start > 0:
            total_return_1y = (p_end - p_start + divs) / p_start

    # 13. Benchmark 1Y total return and relative return
    benchmark_return_1y = get_benchmark_return(benchmark)
    relative_return_1y  = None
    if total_return_1y is not None and benchmark_return_1y is not None:
        relative_return_1y = total_return_1y - benchmark_return_1y

    # 14. Beta — Schwab first, yfinance calculation fallback
    beta = sq.get("beta") if sq else None
    if beta is None and hist_available:
        spy_hist = _get_spy_hist()
        if not spy_hist.empty and len(hist) >= 63:
            fund_rets = hist["Close"].pct_change().dropna().rename(symbol)
            spy_rets  = spy_hist["Close"].pct_change().dropna().rename("SPY")
            aligned   = pd.concat([fund_rets, spy_rets], axis=1, join="inner").dropna()
            if len(aligned) >= 30 and aligned.shape[1] == 2:
                var_spy = float(aligned["SPY"].var())
                if var_spy > 0:
                    beta = float(aligned.cov().iloc[0, 1] / var_spy)

    # 15. NAV trend and divergence
    nav_trend_90d            = trend_90d
    price_nav_divergence_90d = 0.0

    # 16. Professional-grade alert metrics
    spy_hist_recent = _get_spy_hist()
    market_accel_20d_vs_90d = None
    if not spy_hist_recent.empty and len(spy_hist_recent) >= 63:
        spy_20d = (float(spy_hist_recent["Close"].iloc[-1]) / float(spy_hist_recent["Close"].iloc[-14]) - 1) if len(spy_hist_recent) >= 14 else 0.0
        spy_90d = (float(spy_hist_recent["Close"].iloc[-1]) / float(spy_hist_recent["Close"].iloc[-63]) - 1) if len(spy_hist_recent) >= 63 else 0.0
        market_accel_20d_vs_90d = spy_20d - spy_90d

    fund_accel_20d_vs_90d = momentum_20d - trend_90d
    accel_vs_market = None
    if market_accel_20d_vs_90d is not None:
        accel_vs_market = fund_accel_20d_vs_90d - market_accel_20d_vs_90d

    nav_slope_20d = None
    nav_slope_200d = None
    nav_slope_200d_std = None
    trendline_break_sigma = None
    if hist_available and len(hist) >= 200:
        slope_20d, _ = _calculate_linear_slope(hist["Close"].tail(20))
        slope_200d, std_200d = _calculate_linear_slope(hist["Close"].tail(200))
        nav_slope_20d = slope_20d
        nav_slope_200d = slope_200d
        nav_slope_200d_std = std_200d
        if std_200d > 0:
            trendline_break_sigma = (slope_20d - slope_200d) / std_200d

    fund_vs_benchmark_20d = None
    if hist_available and benchmark and len(hist) >= 14:
        try:
            bench_hist = yf.Ticker(benchmark).history(period="1mo")
            if not bench_hist.empty and len(bench_hist) >= 14:
                bench_20d = (float(bench_hist["Close"].iloc[-1]) / float(bench_hist["Close"].iloc[-14]) - 1)
                fund_vs_benchmark_20d = momentum_20d - bench_20d
        except Exception:
            pass

    # 17. Split detection
    split_mode, split_ratio, split_type = detect_split(symbol)
    if split_mode and split_ratio and split_ratio > 1.0:
        sr = split_ratio
        trend_90d    = ((1 + trend_90d)    / sr - 1) if trend_90d    is not None else trend_90d
        momentum_20d = ((1 + momentum_20d) / sr - 1) if momentum_20d is not None else momentum_20d
        sma_20  = sma_20  / sr if sma_20  is not None else sma_20
        sma_50  = sma_50  / sr if sma_50  is not None else sma_50
        sma_200 = sma_200 / sr if sma_200 is not None else sma_200

    return EtfSnapshot(
        symbol=symbol,
        price=current_price,
        nav=nav,
        ttm_yield=ttm_yield,
        nav_drop_30d=nav_drop_30d,
        trend_90d=trend_90d,
        momentum_20d=momentum_20d,
        vol_30d_annual=vol_30d_annual,
        days_to_ex=None,
        aum=aum,
        expense_ratio=expense_ratio,
        sma_20=sma_20,
        sma_50=sma_50,
        sma_200=sma_200,
        max_drawdown_6m=max_drawdown_6m,
        volume_trend=volume_trend,
        rsi_14=rsi_14,
        macd_bullish=macd_bullish,
        last_distribution=last_distribution,
        distribution_cut_pct=distribution_cut_pct,
        # Institutional metrics
        nav_trend_90d=nav_trend_90d,
        price_nav_divergence_90d=price_nav_divergence_90d,
        coverage_ratio=coverage_ratio,
        total_return_1y=total_return_1y,
        benchmark_return_1y=benchmark_return_1y,
        relative_return_1y=relative_return_1y,
        beta=beta,
        vol_3m_avg=(sq.get("vol3m_avg") if sq else None),
        return_on_equity=(sq.get("return_on_equity") if sq else None),
        return_on_assets=(sq.get("return_on_assets") if sq else None),
        net_profit_margin=(sq.get("net_profit_margin") if sq else None),
        operating_margin=(sq.get("operating_margin") if sq else None),
        total_debt_to_cap=(sq.get("total_debt_to_cap") if sq else None),
        lt_debt_to_equity=(sq.get("lt_debt_to_equity") if sq else None),
        pb_ratio=(sq.get("pb_ratio") if sq else None),
        pcf_ratio=(sq.get("pcf_ratio") if sq else None),
        peg_ratio=(sq.get("peg_ratio") if sq else None),
        short_float_pct=(sq.get("short_float_pct") if sq else None),
        market_cap=(sq.get("market_cap") if sq else None),
        div_yield=(sq.get("div_yield") if sq else None),
        div_amount=(sq.get("div_amount") if sq else None),
        vix_current=vix_current,
        vix_90d_avg=vix_90d_avg,
        # Professional alert metrics
        market_accel_20d_vs_90d=market_accel_20d_vs_90d,
        fund_accel_20d_vs_90d=fund_accel_20d_vs_90d,
        accel_vs_market=accel_vs_market,
        nav_slope_20d=nav_slope_20d,
        nav_slope_200d=nav_slope_200d,
        nav_slope_200d_std=nav_slope_200d_std,
        trendline_break_sigma=trendline_break_sigma,
        fund_vs_benchmark_20d=fund_vs_benchmark_20d,
        price_change=price_change,
        price_change_pct=price_change_pct,
        day_low=day_low,
        name=fund_name,
        dividend_months=dividend_months,
        split_mode=split_mode,
        split_ratio=split_ratio,
        split_type=split_type,
    )

# data_fetcher.py - Add this function

def get_historical_price(symbol: str, date_str: str) -> Optional[float]:
    """
    Get closing price for a symbol on a specific date.
    Used to fill missing conversion prices.
    
    Args:
        symbol: Ticker symbol
        date_str: Date in YYYY-MM-DD format
    
    Returns:
        Closing price, or None if not available
    """
    try:
        ticker = yf.Ticker(symbol)
        # Get data around that date (extra days to ensure we have data)
        start_date = pd.Timestamp(date_str) - pd.Timedelta(days=5)
        end_date = pd.Timestamp(date_str) + pd.Timedelta(days=1)
        
        hist = ticker.history(start=start_date, end=end_date)
        if hist.empty:
            return None
        
        # Try exact date first
        target_date = pd.Timestamp(date_str).date()
        for idx in hist.index:
            if idx.date() == target_date:
                return float(hist.loc[idx, "Close"])
        
        # Fall back to nearest available
        return float(hist["Close"].iloc[-1])
    except Exception:
        return None


def fill_conversion_prices(conversions: list) -> list:
    """
    Fill missing prices in conversion records using historical data.
    Returns updated conversions list.
    """
    for conv in conversions:
        if conv["price"] == 0:
            price = get_historical_price(conv["symbol"], conv["date"])
            if price:
                conv["price"] = price
                conv["value"] = round(price * conv["shares"], 2)
    return conversions