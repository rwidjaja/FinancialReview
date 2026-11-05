"""portfolio_data.splits — stock-split detection and rescaling.

A split changes shares and price by the same factor while leaving value
unchanged. Schwab positions, Schwab quotes and yfinance history pick up a
split at different times, so a cached per-share number (EOD baseline price,
quote, lot quantity / cost-per-share) can sit on the wrong side of the split
for a while.

Design rule — learned the hard way on the SOXX 3:1 split (2026-11-05):
  * The split RATIO is never inferred from prices. Prices move: SOXX fell ~10%
    on split day, so "is 465 → 139 a 3:1 split within 6%?" said no, and
    "is 450 → 46 a 10:1 split?" said yes. Both wrong.
  * The ratio comes from SHARE COUNTS (Schwab's post-split share count vs the
    prior session's) — an exact factor with no market noise — or from two
    Schwab numbers taken at the same instant (position marketValue/shares vs
    the quote), where a 3× gap cannot be a market move.
  * Once the ratio is known, any price is classified as pre- or post-split by
    which level it is NEARER to (log distance). That is robust to any
    realistic day move, and idempotent: an already-adjusted price is never
    adjusted again.

Ratio convention: r = new shares per old share.
  3-for-1 forward split → r = 3.0   (price ÷ 3, shares × 3)
  1-for-10 reverse split → r = 0.1  (price × 10, shares ÷ 10)
"""

import math
from typing import Optional

# Real-world split factors. 1.5 (3-for-2) is excluded so a ~33% share-count
# change from a large trade can't be mistaken for a split.
_FORWARD = (2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 15.0, 20.0, 25.0, 50.0, 100.0)
_CANDIDATES = _FORWARD + tuple(1.0 / r for r in _FORWARD)


def _pos(x) -> float:
    try:
        x = float(x)
    except (TypeError, ValueError):
        return 0.0
    return x if x > 0 and math.isfinite(x) else 0.0


def infer_split_ratio(old: float, new: float, tol: float = 0.01) -> Optional[float]:
    """Return r if old/new matches a split factor within ±tol (relative), else
    None. Use only on quantities that do NOT drift with the market — share
    counts, or two same-instant Schwab prices. Never on prices from different
    days."""
    old, new = _pos(old), _pos(new)
    if not old or not new:
        return None
    observed = old / new
    for r in _CANDIDATES:
        if abs(observed / r - 1.0) <= tol:
            return r
    return None


def is_pre_split(price: float, post_split_ref: float, ratio: float) -> bool:
    """True if `price` is nearer the pre-split level (post_split_ref × ratio)
    than the post-split level (post_split_ref). Log distance, so a ±30% day
    move on either side still classifies correctly for any r ≥ 2."""
    price, ref = _pos(price), _pos(post_split_ref)
    if not price or not ref or not ratio or ratio == 1.0:
        return False
    return abs(math.log(price / (ref * ratio))) < abs(math.log(price / ref))


def infer_split_from_quantities(old_qty: float, new_qty: float,
                                old_cost: float, new_cost: float,
                                tol: float = 0.01) -> Optional[float]:
    """Cost-basis lots vs live Schwab position: share count AND per-share cost
    must both have moved by the same split factor. Requiring both keeps a plain
    buy/sell (which changes qty but not avg cost much) from looking like a
    split. Both inputs are Schwab/broker numbers, not market prices."""
    r_qty = infer_split_ratio(new_qty, old_qty, tol=tol)          # qty grows by r
    r_cost = infer_split_ratio(old_cost, new_cost, tol=0.05)      # cost shrinks by r
    if r_qty is not None and r_qty == r_cost:
        return r_qty
    return None


def detect_splits(held_shares: dict, prev_eod: dict,
                  position_prices: dict, snapshots: dict) -> dict:
    """
    Return {symbol: ratio} for symbols that split since the prior session.

      a) Share count: total held shares now vs the prior session's EOD share
         count moved by an exact split factor (±1%). Primary signal.
      b) Same-instant Schwab mismatch: position-implied price (marketValue /
         shares) vs the quote differ by a split factor (±3%). Catches the
         window where Schwab positions are post-split but its quote is not,
         even without a prior EOD row.
    """
    out: dict = {}
    for sym, sh_now in (held_shares or {}).items():
        pe = (prev_eod or {}).get(sym) or {}
        r = infer_split_ratio(sh_now, pe.get("shares"), tol=0.01)
        if r is None:
            q = ((snapshots or {}).get(sym) or {}).get("price")
            r = infer_split_ratio(q, (position_prices or {}).get(sym), tol=0.03)
        if r is not None:
            out[sym] = r
    return out


# Per-share fields in a fetch_all_data snapshot dict that a split rescales.
# Ratios (ttm_yield, premium, returns) are unit-free and left alone.
_PER_SHARE_SNAPSHOT_KEYS = ("price", "nav", "sma_200", "day_low",
                            "annual_div_amount", "last_distribution")


def fix_stale_split_quotes(snapshots: dict, splits: dict,
                           prev_eod: dict, position_prices: dict) -> dict:
    """
    For each split symbol, rescale the snapshot's per-share fields in place
    ONLY if the quote is still on the pre-split side. Reference post-split
    level: Schwab's position-implied price if available, else the prior
    session close ÷ ratio. Returns {symbol: ratio} for quotes rescaled.
    """
    fixed: dict = {}
    for sym, r in (splits or {}).items():
        snap = (snapshots or {}).get(sym)
        q = _pos((snap or {}).get("price"))
        if not q:
            continue
        ref = _pos((position_prices or {}).get(sym))
        if not ref:
            prev_px = _pos(((prev_eod or {}).get(sym) or {}).get("price"))
            ref = prev_px / r if prev_px else 0.0
        if not is_pre_split(q, ref, r):
            continue
        for k in _PER_SHARE_SNAPSHOT_KEYS:
            v = snap.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v:
                snap[k] = v / r
        fixed[sym] = r
        print(f"[split] {sym}: quote {q:.2f} is pre-split (ratio {r:g}) — using {snap['price']:.2f}")
    return fixed


def rebase_eod_baseline(eod_by_sym: dict, snapshots: dict, splits: dict) -> dict:
    """
    For each split symbol whose day-change baseline price is still on the
    pre-split side of the (already corrected) live quote, rescale it in place.
    A split leaves value unchanged, so market_value = stored shares × adjusted
    price keeps the shares-proportional per-account day-change formula right
    whether the stored share count is pre- or post-split.
    Returns {symbol: ratio} for baselines rescaled.
    """
    fixed: dict = {}
    for sym, r in (splits or {}).items():
        ev = (eod_by_sym or {}).get(sym)
        if not ev:
            continue
        b = _pos(ev.get("price"))
        q = _pos(((snapshots or {}).get(sym) or {}).get("price"))
        if not is_pre_split(b, q, r):
            continue
        ev["price"] = b / r
        ev["market_value"] = _pos(ev.get("shares")) * ev["price"]
        fixed[sym] = r
        print(f"[eod] {sym}: baseline {b:.2f} is pre-split (ratio {r:g}) — rescaled to {ev['price']:.2f}")
    return fixed


# ── Recorded splits + yfinance history adjustment ─────────────────────────────
# yfinance (Yahoo) can take a day or more to back-adjust history after a split.
# Meanwhile it serves unadjusted past bars with post-split bars on the end — a
# fake −67% cliff that breaks the Returns chart, SMAs, momentum, drawdown and
# volatility signals. Splits detected from Schwab share counts are recorded
# here, and every yfinance history result is post-adjusted for them. The
# adjustment is self-disabling: once Yahoo catches up, pre-split bars are
# already at the post-split level, is_pre_split() is False, nothing changes.

_RECENT_KEY = "splits:recent"
_RECENT_MAX_AGE_DAYS = 30
_recent_memo: dict = {"t": 0.0, "v": {}}


def record_splits(splits: dict, date_str: str, ref_prices: dict) -> list:
    """Persist {sym: ratio} detected on `date_str` (YYYY-MM-DD) with the live
    post-split price as reference. Idempotent across refreshes on the same
    split. Returns list of newly recorded symbols."""
    if not splits:
        return []
    import db_manager as _dbm
    cur = _dbm.cache_get(_RECENT_KEY) or {}
    new = []
    for sym, r in splits.items():
        old = cur.get(sym)
        if old and abs(float(old.get("ratio", 0)) - r) < 1e-9:
            continue
        cur[sym] = {"ratio": r, "date": date_str, "ref_price": _pos((ref_prices or {}).get(sym))}
        new.append(sym)
    if new:
        _dbm.cache_set(_RECENT_KEY, cur)
        _recent_memo["t"] = 0.0
        print(f"[split] Recorded split(s): " + ", ".join(f"{s} {splits[s]:g}:1 on {date_str}" for s in new))
    return new


def load_recent_splits() -> dict:
    """{sym: {ratio, date, ref_price}} for splits in the last 30 days.
    Memoised for 60s — this runs on every yfinance call."""
    import time
    now = time.time()
    if now - _recent_memo["t"] < 60:
        return _recent_memo["v"]
    out: dict = {}
    try:
        import db_manager as _dbm
        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=_RECENT_MAX_AGE_DAYS)).isoformat()
        for sym, rec in (_dbm.cache_get(_RECENT_KEY) or {}).items():
            if str(rec.get("date", "")) >= cutoff and rec.get("ratio"):
                out[sym.upper()] = rec
    except Exception:
        out = {}
    _recent_memo.update(t=now, v=out)
    return out


_PRICE_COLS = ("Open", "High", "Low", "Close", "Adj Close")


def _bar_dates(index):
    try:
        return [d.date() if hasattr(d, "date") else d for d in index]
    except Exception:
        return None


def _adjust_ohlcv(get_col, set_col, cols, index, rec) -> bool:
    """Shared core: divide price columns (× volume) for bars before the split
    date, only if they are still on the pre-split side. Returns True if
    adjusted."""
    from datetime import date as _date
    r = float(rec["ratio"])
    try:
        split_day = _date.fromisoformat(str(rec["date"])[:10])
    except ValueError:
        return False
    days = _bar_dates(index)
    if not days:
        return False
    before = [i for i, d in enumerate(days) if d < split_day]
    after = [i for i, d in enumerate(days) if d >= split_day]
    if not before or "Close" not in cols:
        return False
    close = get_col("Close")
    last_pre = _pos(close.iloc[before[-1]])
    ref = _pos(close.iloc[after[0]]) if after else _pos(rec.get("ref_price"))
    if not is_pre_split(last_pre, ref, r):
        return False
    mask = [d < split_day for d in days]
    for c in cols:
        if c in _PRICE_COLS:
            s = get_col(c).copy()
            s[mask] = s[mask] / r
            set_col(c, s)
        elif c == "Volume":
            s = get_col(c).astype(float).copy()
            s[mask] = s[mask] * r
            set_col(c, s)
    return True


def adjust_history(df, symbol: str):
    """Adjust a single-ticker yfinance history DataFrame for recorded splits."""
    rec = load_recent_splits().get(str(symbol or "").upper())
    if rec is None or df is None or getattr(df, "empty", True):
        return df
    df = df.copy()
    cols = [c for c in df.columns if isinstance(c, str)]
    _adjust_ohlcv(lambda c: df[c], lambda c, s: df.__setitem__(c, s), cols, df.index, rec)
    return df


def adjust_download(df, tickers):
    """Adjust a yf.download() result (single or multi-ticker) for recorded splits."""
    recs = load_recent_splits()
    if not recs or df is None or getattr(df, "empty", True):
        return df
    import pandas as pd
    if not isinstance(df.columns, pd.MultiIndex):
        syms = [tickers] if isinstance(tickers, str) else list(tickers or [])
        if isinstance(tickers, str) and " " in tickers:
            syms = tickers.split()
        return adjust_history(df, syms[0]) if len(syms) == 1 else df
    df = df.copy()
    lv0, lv1 = df.columns.get_level_values(0), df.columns.get_level_values(1)
    field_first = any(f in set(lv0) for f in _PRICE_COLS + ("Volume",))
    syms = set(lv1 if field_first else lv0)
    for sym in syms:
        rec = recs.get(str(sym).upper())
        if rec is None:
            continue
        fields = [f for f in (set(lv0) if field_first else set(lv1)) if isinstance(f, str)]
        key = (lambda f: (f, sym)) if field_first else (lambda f: (sym, f))
        fields = [f for f in fields if key(f) in df.columns]
        _adjust_ohlcv(lambda c: df[key(c)], lambda c, s: df.__setitem__(key(c), s),
                      fields, df.index, rec)
    return df


def install_yfinance_split_patch() -> None:
    """Wrap yf.Ticker.history and yf.download once so every caller gets
    split-consistent history. Failures fall back to the raw result."""
    try:
        import yfinance as yf
    except Exception:
        return
    if getattr(yf, "_split_patch_installed", False):
        return
    _orig_history = yf.Ticker.history
    _orig_download = yf.download

    def history(self, *args, **kwargs):
        df = _orig_history(self, *args, **kwargs)
        try:
            return adjust_history(df, getattr(self, "ticker", ""))
        except Exception:
            return df

    def download(tickers, *args, **kwargs):
        df = _orig_download(tickers, *args, **kwargs)
        try:
            return adjust_download(df, tickers)
        except Exception:
            return df

    yf.Ticker.history = history
    yf.download = download
    yf._split_patch_installed = True
