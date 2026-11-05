"""portfolio_data.splits — infer stock splits from before/after numbers.

A split changes shares and price by the same factor while leaving value
unchanged. Schwab positions/quotes and yfinance history pick up a split at
different times, so any cached per-share number (EOD baseline price, lot
quantity / cost-per-share, the quote's previous close) can be on the wrong
side of the split for a while. These helpers recognise that mismatch so
callers can rescale the stale side instead of reporting a fake ±67% move.

Ratio convention: r = new shares per old share.
  3-for-1 forward split → r = 3.0   (price ÷ 3, shares × 3)
  1-for-10 reverse split → r = 0.1  (price × 10, shares ÷ 10)
"""

from typing import Optional

# Real-world split factors. 1.5 (3-for-2) is deliberately excluded: a ~33%
# one-day drop is a plausible real move, and 3-for-2 splits are rare.
_FORWARD = (2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 15.0, 20.0, 25.0, 50.0, 100.0)
_CANDIDATES = _FORWARD + tuple(1.0 / r for r in _FORWARD)


def infer_split_ratio(old_price: float, new_price: float, tol: float = 0.06) -> Optional[float]:
    """Return r if old_price/new_price matches a split factor within ±tol
    (relative), else None. The tolerance leaves room for a normal day's
    move on top of the split (e.g. 3:1 split + 4% rally → 450/156 ≈ 2.88)."""
    try:
        old_price, new_price = float(old_price), float(new_price)
    except (TypeError, ValueError):
        return None
    if old_price <= 0 or new_price <= 0:
        return None
    observed = old_price / new_price
    for r in _CANDIDATES:
        if abs(observed / r - 1.0) <= tol:
            return r
    return None


def infer_split_from_quantities(old_qty: float, new_qty: float,
                                old_cost: float, new_cost: float,
                                tol: float = 0.01) -> Optional[float]:
    """Stricter two-sided check for cost-basis lots: share count AND per-share
    cost must both have moved by the same split factor. Requiring both keeps a
    plain buy/sell (which changes qty but not cost/share) from looking like a
    split."""
    try:
        old_qty, new_qty = float(old_qty), float(new_qty)
        old_cost, new_cost = float(old_cost), float(new_cost)
    except (TypeError, ValueError):
        return None
    if min(old_qty, new_qty, old_cost, new_cost) <= 0:
        return None
    r_qty = infer_split_ratio(new_qty, old_qty, tol=tol)          # qty grows by r
    r_cost = infer_split_ratio(old_cost, new_cost, tol=0.05)      # cost shrinks by r
    if r_qty is not None and r_qty == r_cost:
        return r_qty
    return None


# Per-share fields in a fetch_all_data snapshot dict that a split rescales.
# Ratios (ttm_yield, premium, returns) are unit-free and left alone.
_PER_SHARE_SNAPSHOT_KEYS = ("price", "nav", "sma_200", "day_low",
                            "annual_div_amount", "last_distribution")


def fix_stale_split_quotes(snapshots: dict, held_shares: dict,
                           position_prices: dict, prev_eod: dict) -> dict:
    """
    Detect quotes still printing the pre-split price while Schwab positions are
    already post-split, and rescale the snapshot's per-share fields in place.

    Signals (either is enough):
      a) Schwab position-implied price (marketValue / shares) differs from the
         quote by a split factor;
      b) total share count jumped by a split factor vs the prior trading day's
         EOD, while the quote did NOT move by that factor (if it had, the quote
         is already post-split and nothing needs fixing).
    Returns {symbol: ratio} for every symbol fixed.
    """
    fixed: dict = {}
    for sym, sh_now in (held_shares or {}).items():
        snap = (snapshots or {}).get(sym)
        q_px = (snap or {}).get("price") or 0.0
        if not q_px:
            continue
        r = infer_split_ratio(q_px, (position_prices or {}).get(sym) or 0.0, tol=0.03)
        if r is None:
            pe = (prev_eod or {}).get(sym) or {}
            r_sh = infer_split_ratio(sh_now, pe.get("shares") or 0.0, tol=0.01)
            if r_sh is not None and infer_split_ratio(pe.get("price") or 0.0, q_px) is None:
                r = r_sh
        if r is None:
            continue
        for k in _PER_SHARE_SNAPSHOT_KEYS:
            v = snap.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v:
                snap[k] = v / r
        snap["price_change"] = 0.0          # unreliable today; EOD baseline takes over
        snap["price_change_pct"] = 0.0
        fixed[sym] = r
        print(f"[split] {sym}: quote {q_px:.2f} is pre-split (ratio {r:g}) — using {snap['price']:.2f}")
    return fixed


def rebase_eod_baseline(eod_by_sym: dict, snapshots: dict) -> dict:
    """
    Rescale EOD day-change baselines saved on the pre-split side (yfinance's
    pre-market "previous close" often isn't split-adjusted yet) to the live
    post-split price basis, in place. A split leaves position value unchanged,
    so market_value = stored shares × adjusted price keeps the shares-
    proportional per-account day-change formula right whether the stored
    share count is pre- or post-split. Returns {symbol: ratio}.
    """
    fixed: dict = {}
    for sym, ev in (eod_by_sym or {}).items():
        cur_px = ((snapshots or {}).get(sym) or {}).get("price") or 0.0
        r = infer_split_ratio(ev.get("price") or 0.0, cur_px)
        if r is None:
            continue
        adj = (ev.get("price") or 0.0) / r
        ev["price"] = adj
        ev["market_value"] = (ev.get("shares") or 0.0) * adj
        fixed[sym] = r
        print(f"[eod] Split detected for {sym}: ratio {r:g} — baseline price rescaled to {adj:.2f}")
    return fixed
