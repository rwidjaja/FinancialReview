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
