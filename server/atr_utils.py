"""
atr_utils — shared Average True Range + ATR-scaled price-stack helpers.

Single source of truth for the entry/exit price levels shown on the Research
tab and computed by the swing engine. Offsets are expressed as multiples of
ATR-14 (a symbol's own typical dollar range) rather than a fixed percentage of
price, so a low-volatility name and a high-volatility name each get an offset
sized to how far they actually move — the multipliers themselves live in
rules.json's _ATR_PRICE_RULES block, never a hardcoded symbol.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional, Sequence


def compute_atr(highs: Sequence[float], lows: Sequence[float],
                 closes: Sequence[float], period: int = 14) -> Optional[float]:
    """Wilder-smoothed Average True Range."""
    if len(highs) < period + 1:
        return None
    trs = []
    for i in range(1, len(highs)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr


def atr_price_stack(high_ref: Optional[float], live_price: Optional[float],
                     atr: Optional[float], rules: Optional[Dict[str, Any]]) -> Dict[str, Optional[float]]:
    """
    Given a reference high, the live price, and ATR, compute the canonical
    ATR-scaled entry/exit stack using multipliers from rules['entry']/['exit']
    (i.e. rules.json's _ATR_PRICE_RULES block).
    """
    entry_r = (rules or {}).get("entry", {})
    exit_r  = (rules or {}).get("exit", {})
    buy_mult    = entry_r.get("buy_atr_mult", 1.0)
    sbu_mult    = entry_r.get("strong_buy_atr_mult", 2.0)
    limit_mult  = entry_r.get("limit_below_atr_mult", 0.25)
    stop_mult   = exit_r.get("stop_atr_mult", 2.0)
    rr_multiple = exit_r.get("target_rr_multiple", 2.0)

    if atr is None or not atr:
        return {"buy_price": None, "strong_buy_price": None, "limit_price": None,
                "stop_price": None, "take_profit": None, "rr_ratio": None}

    buy_price        = round(high_ref - buy_mult * atr, 2) if high_ref else None
    strong_buy_price = round(high_ref - sbu_mult * atr, 2) if high_ref else None
    # Once the buy/strong-buy threshold is already triggered, "the buy price"
    # is not the current price itself — a limit order sitting AT market is
    # just a market order. It's a small ATR-scaled increment below current
    # price, close enough to fill promptly (mirrors placing a limit buy just
    # under the ask rather than chasing the ask itself).
    limit_price      = round(live_price - limit_mult * atr, 2) if live_price else None
    stop_price       = round(live_price - stop_mult * atr, 2) if live_price else None
    risk             = (live_price - stop_price) if (live_price and stop_price is not None) else None
    take_profit      = round(live_price + risk * rr_multiple, 2) if risk is not None else None
    rr_ratio          = rr_multiple if take_profit is not None else None

    return {
        "buy_price":        buy_price,
        "strong_buy_price": strong_buy_price,
        "limit_price":      limit_price,
        "stop_price":       stop_price,
        "take_profit":      take_profit,
        "rr_ratio":         rr_ratio,
    }
