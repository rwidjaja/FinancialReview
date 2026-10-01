"""
price_utils — shared per-ticker price/change/drawdown/RSI/ATR fetcher.

Uses yf.Ticker().history() per symbol (same path as the research engine)
rather than yf.download() batch.  Benefits:
  • Each Ticker manages its own crumb/cookie renewal — no stale-crumb 401s.
  • Foreign-exchange symbols (KRX, TSE, …) work without special-casing.
  • ThreadPoolExecutor keeps total latency ≈ slowest single ticker.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pandas as pd
import yfinance as yf

# Exchange suffixes whose live 1m feed is unreliable or unavailable
# during US market hours (market closed on their exchange).
_NON_US_SUFFIXES = ('.KS', '.KQ', '.T', '.HK', '.L', '.PA', '.DE', '.AS')


def ticker_metrics(
    close_series: pd.Series,
    live_price: float = None,
    high_series: pd.Series = None,
    low_series: pd.Series = None,
) -> dict:
    """
    Compute price, change_pct, change_5d_pct, drawdown_20d, RSI(14), ATR(14)
    from daily OHLC series.

    When the US market is open, yfinance includes today's partial bar as the
    last row (iloc[-1]).  A live_price quote covers that same session, so the
    previous-session reference must be one bar back (iloc[-2]).

    Without a live quote (foreign listings, or the 1m fetch failed) the last
    bar itself IS the price.  Crucially, a bar dated "today" is NOT skipped in
    that path: for foreign exchanges it is usually a *completed* session (KRX
    closes 2:30am ET) — discarding it froze .KS change_pct at exactly 0.00%
    for the whole US trading day and left the price a session stale.

    live_price:   override the price field with a fresh 1m quote (pre/post
                  market or intraday).  When None, falls back to iloc[-1].
    high_series:  daily High series aligned to close_series index (for ATR).
    low_series:   daily Low series aligned to close_series index (for ATR).
    """
    col = close_series.dropna()
    if col.empty:
        return {}

    last_date  = col.index[-1].date() if hasattr(col.index[-1], 'date') else None
    today_bar  = last_date is not None and last_date >= datetime.now().date()

    # iloc[-6] gives the correct 5-session reference in all cases: the price
    # corresponds to the iloc[-1] session, and iloc[-6] is 5 sessions earlier.
    five_ago = float(col.iloc[-6]) if len(col) >= 6 else float(col.iloc[0])

    if live_price and live_price > 0:
        price = live_price
        prev  = float(col.iloc[-2]) if (today_bar and len(col) >= 2) else float(col.iloc[-1])
    else:
        price = float(col.iloc[-1])
        prev  = float(col.iloc[-2]) if len(col) >= 2 else price
    prev_close = prev

    chg  = (price - prev)     / prev     * 100 if prev     > 0 else 0.0
    chg5 = (price - five_ago) / five_ago * 100 if five_ago > 0 else 0.0
    # Color blends today's move with the 5-session move so a slow bleed
    # (−1.2%/day for a week) still trips the chain, and a signal that fired
    # late Friday doesn't evaporate over the weekend.
    sig  = ('red'    if chg <= -3.0 or chg5 <= -6.0 else
            'yellow' if chg <= -1.5 or chg5 <= -4.0 else
            'green')

    window = col.iloc[-20:] if len(col) >= 20 else col
    high20 = float(window.max())
    dd20   = (price - high20) / high20 * 100 if high20 > 0 else 0.0
    if   dd20 > -5:  dd_label = 'NORMAL'
    elif dd20 > -10: dd_label = 'DIP'
    elif dd20 > -20: dd_label = 'DEEP DIP'
    else:            dd_label = 'STRESS'

    # ── RSI(14) — Wilder's smoothing (EMA with alpha = 1/14) ─────────────────
    # Needs ≥15 sessions: 1 for diff + 14 for the initial average.
    rsi14          = None
    rsi_was_os     = False   # RSI < 30 in any of the last 5 sessions
    rsi_recovering = False   # RSI just crossed back above 30 today
    if len(col) >= 15:
        delta    = col.diff().dropna()
        gain     = delta.clip(lower=0)
        loss     = (-delta).clip(lower=0)
        avg_gain = gain.ewm(alpha=1/14, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/14, adjust=False).mean()
        # Protect div-by-zero: replace 0 avg_loss with NaN → RSI = 100 (no losses)
        rs    = avg_gain / avg_loss.replace(0, float('nan'))
        rsi_s = (100 - (100 / (1 + rs))).fillna(100)
        rsi14 = round(float(rsi_s.iloc[-1]), 1)
        recent5        = rsi_s.iloc[-5:]
        rsi_was_os     = bool((recent5 < 30).any())
        rsi_recovering = bool(rsi14 > 30 and float(rsi_s.iloc[-2]) <= 30)

    # ── ATR(14) — Wilder's smoothing ─────────────────────────────────────────
    # True Range = max(H−L, |H−C_prev|, |L−C_prev|)
    atr14 = None
    if high_series is not None and low_series is not None and len(col) >= 2:
        h     = high_series.reindex(col.index)
        l     = low_series.reindex(col.index)
        c_prv = col.shift(1)
        # Only include dates where all three series have values
        idx = (
            h.dropna().index
            .intersection(l.dropna().index)
            .intersection(c_prv.dropna().index)
        )
        if len(idx) >= 14:
            tr = pd.concat([
                (h.loc[idx] - l.loc[idx]),
                (h.loc[idx] - c_prv.loc[idx]).abs(),
                (l.loc[idx] - c_prv.loc[idx]).abs(),
            ], axis=1).max(axis=1)
            atr14 = round(float(tr.ewm(alpha=1/14, adjust=False).mean().iloc[-1]), 2)

    return {
        'price':           round(price, 2),
        'prev_close':      round(prev_close, 2),
        'change':          round(price - prev, 2),
        'change_pct':      round(chg, 2),
        'change_5d_pct':   round(chg5, 2),
        'drawdown_20d':    round(dd20, 2),
        'drawdown_label':  dd_label,
        'signal':          sig,
        'rsi14':           rsi14,
        'rsi_was_os':      rsi_was_os,
        'rsi_recovering':  rsi_recovering,
        'atr14':           atr14,
    }


def fetch_price_data(symbols: list) -> dict:
    """
    Fetch price metrics for each symbol using yf.Ticker().history().

    Runs all tickers in parallel (ThreadPoolExecutor) so total latency ≈
    slowest single ticker.  Returns {sym: metrics_dict}; failed symbols
    map to {}.
    """
    def _fetch_one(sym: str) -> tuple:
        try:
            tk   = yf.Ticker(sym)
            hist = tk.history(period='1mo', auto_adjust=True)
            if hist.empty:
                return sym, {}

            closes = hist['Close'].dropna()
            if closes.empty:
                return sym, {}

            highs = hist['High'].dropna() if 'High' in hist.columns else None
            lows  = hist['Low'].dropna()  if 'Low'  in hist.columns else None

            # Live intraday price for US-listed tickers only (pre/post market).
            # Foreign tickers fall back to the daily close — their 1m feed is
            # unavailable or unreliable during US hours.
            live_price = None
            if not any(sym.endswith(sfx) for sfx in _NON_US_SUFFIXES):
                try:
                    lh = tk.history(period='1d', interval='1m', prepost=True)
                    if not lh.empty:
                        lc = lh['Close'].dropna()
                        if not lc.empty:
                            live_price = float(lc.iloc[-1])
                except Exception:
                    pass

            return sym, ticker_metrics(closes, live_price, highs, lows)

        except Exception as exc:
            print(f"[price_utils] {sym}: {exc}")
            return sym, {}

    result = {s: {} for s in symbols}
    with ThreadPoolExecutor(max_workers=min(len(symbols), 16)) as pool:
        for sym, metrics in pool.map(lambda s: _fetch_one(s), symbols):
            result[sym] = metrics

    return result


# ── L0.2 Earnings Expectation Pressure ──────────────────────────────────────
# Price-only gate: fires when the chain has run too far (parabolic gain over
# 20d/60d/120d) AND/OR the target ETFs are moving in lockstep with each other
# and with DRAM (correlation spike — a broad, undifferentiated rally where a
# single earnings miss ripples sector-wide). Deliberately excludes valuation
# multiples (unreliable for .KS tickers / ETFs via yfinance) and options
# positioning (no reliable free data source) — see 2026-07 signals-tab
# scoping decision.
_PARABOLIC_THRESHOLDS = {20: 18.0, 60: 35.0, 120: 60.0}   # {n_sessions: min_pct_gain}
_CORR_SMH_SOXX_THRESHOLD = 0.85
_CORR_DRAM_THRESHOLD     = 0.75


def _pct_n_sessions_ago(close: pd.Series, n: int):
    """% change from n sessions ago to the latest close. None if not enough history."""
    if len(close) < n + 1:
        return None
    ref = float(close.iloc[-(n + 1)])
    if ref <= 0:
        return None
    return (float(close.iloc[-1]) - ref) / ref * 100


def _trailing_returns(close: pd.Series, n: int = 20) -> pd.Series:
    return close.pct_change().dropna().tail(n)


def _corr(a: pd.Series, b: pd.Series):
    idx = a.index.intersection(b.index)
    if len(idx) < 10:
        return None
    v = float(a.loc[idx].corr(b.loc[idx]))
    return None if pd.isna(v) else round(v, 2)


def compute_earnings_pressure(run_symbols: list, corr_symbols=('SMH', 'SOXX', 'DRAM')) -> dict:
    """
    RED/YELLOW/GREEN pressure gate from two price-only factors:
      1. parabolic run — any of `run_symbols` up ≥18%/35%/60% over 20/60/120 sessions
      2. correlation spike — SMH/SOXX 20d-return corr > 0.85, or DRAM vs either > 0.75
    2 factors true → RED, 1 → YELLOW, 0 → GREEN.
    """
    all_syms = list(dict.fromkeys(list(run_symbols) + list(corr_symbols)))

    def _fetch(sym: str):
        try:
            hist = yf.Ticker(sym).history(period='7mo', auto_adjust=True)
            return sym, hist['Close'].dropna()
        except Exception as exc:
            print(f"[price_utils] pressure fetch {sym}: {exc}")
            return sym, pd.Series(dtype=float)

    closes = {}
    with ThreadPoolExecutor(max_workers=min(len(all_syms), 16)) as pool:
        for sym, c in pool.map(_fetch, all_syms):
            closes[sym] = c

    parabolic_tickers = []
    for sym in run_symbols:
        c = closes.get(sym, pd.Series(dtype=float))
        if c.empty:
            continue
        pcts = {n: _pct_n_sessions_ago(c, n) for n in _PARABOLIC_THRESHOLDS}
        hit = any(pcts[n] is not None and pcts[n] >= thresh for n, thresh in _PARABOLIC_THRESHOLDS.items())
        if hit:
            parabolic_tickers.append({
                'sym': sym,
                'pct_20d':  round(pcts[20], 1)  if pcts[20]  is not None else None,
                'pct_60d':  round(pcts[60], 1)  if pcts[60]  is not None else None,
                'pct_120d': round(pcts[120], 1) if pcts[120] is not None else None,
            })

    r_smh  = _trailing_returns(closes.get('SMH',  pd.Series(dtype=float)))
    r_soxx = _trailing_returns(closes.get('SOXX', pd.Series(dtype=float)))
    r_dram = _trailing_returns(closes.get('DRAM', pd.Series(dtype=float)))

    corr_smh_soxx  = _corr(r_smh, r_soxx)
    corr_dram_smh  = _corr(r_dram, r_smh)
    corr_dram_soxx = _corr(r_dram, r_soxx)
    corr_dram_vals = [v for v in (corr_dram_smh, corr_dram_soxx) if v is not None]
    corr_dram      = max(corr_dram_vals) if corr_dram_vals else None

    parabolic_run     = len(parabolic_tickers) > 0
    correlation_spike = (
        (corr_smh_soxx is not None and corr_smh_soxx > _CORR_SMH_SOXX_THRESHOLD)
        or (corr_dram is not None and corr_dram > _CORR_DRAM_THRESHOLD)
    )
    factor_count = (1 if parabolic_run else 0) + (1 if correlation_spike else 0)
    level = 'RED' if factor_count >= 2 else 'YELLOW' if factor_count == 1 else 'GREEN'

    return {
        'level':              level,
        'parabolic_run':      parabolic_run,
        'parabolic_tickers':  parabolic_tickers,
        'correlation_spike':  correlation_spike,
        'corr_smh_soxx':      corr_smh_soxx,
        'corr_dram_smh':      corr_dram_smh,
        'corr_dram_soxx':     corr_dram_soxx,
    }
