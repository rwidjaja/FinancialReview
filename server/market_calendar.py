"""
NYSE trading-calendar helper — single source of truth for market open/close
times, holidays, and early closes.

Backed by pandas_market_calendars, which encodes the official NYSE calendar
offline (no network calls, no scraping). Holidays are simply absent from the
schedule; early closes come out as the correct close time automatically —
no manual holiday/early-close list to maintain.
"""

from datetime import datetime, timedelta, timezone
from functools import lru_cache

import pandas_market_calendars as mcal

_NYSE = mcal.get_calendar('NYSE')

# Standard NYSE full-day close is 16:00 ET → 20:00 UTC (EDT) or 21:00 UTC (EST).
# Anything earlier than that on a trading day is an early close.
_FULL_DAY_CLOSE_HOUR_UTC = {20, 21}


@lru_cache(maxsize=16)
def _schedule_window(start_date: str, end_date: str):
    """Cached schedule lookup — avoids recomputing on every 60s loop tick."""
    return _NYSE.schedule(start_date=start_date, end_date=end_date)


def get_market_status(now_utc: datetime | None = None) -> dict:
    """Returns the current NYSE trading-day/session status.

    {
      "is_open":         bool,
      "is_trading_day":  bool,
      "is_early_close":  bool,
      "market_open_utc":  str | None,   # ISO 8601
      "market_close_utc": str | None,   # ISO 8601
      "next_open_utc":    str,          # ISO 8601 — next trading day's open,
                                         # skipping holidays automatically
    }
    """
    now_utc = (now_utc or datetime.now(timezone.utc))
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)

    start = now_utc.date().isoformat()
    end = (now_utc.date() + timedelta(days=10)).isoformat()
    schedule = _schedule_window(start, end)

    today_key = now_utc.date().isoformat()
    is_trading_day = today_key in schedule.index.astype(str)

    market_open_utc = None
    market_close_utc = None
    is_open = False
    is_early_close = False

    if is_trading_day:
        row = schedule.loc[schedule.index.astype(str) == today_key].iloc[0]
        open_dt = row['market_open'].to_pydatetime()
        close_dt = row['market_close'].to_pydatetime()
        market_open_utc = open_dt.isoformat()
        market_close_utc = close_dt.isoformat()
        is_open = open_dt <= now_utc < close_dt
        is_early_close = close_dt.hour not in _FULL_DAY_CLOSE_HOUR_UTC

    # Next open strictly after now — skips holidays since they're absent rows,
    # and correctly advances past today if we're already past today's close.
    future_opens = schedule[schedule['market_open'] > now_utc]
    next_open_utc = future_opens.iloc[0]['market_open'].to_pydatetime().isoformat()

    return {
        "is_open": is_open,
        "is_trading_day": is_trading_day,
        "is_early_close": is_early_close,
        "market_open_utc": market_open_utc,
        "market_close_utc": market_close_utc,
        "next_open_utc": next_open_utc,
    }


def is_trading_day(date_str: str) -> bool:
    """True if `date_str` (YYYY-MM-DD, ET calendar date) is an NYSE trading day.

    Single-source-of-truth check for "should this date ever have a balance
    snapshot" — used to guard writers against weekends/holidays rather than
    each caller re-deriving it (or worse, not checking at all).
    """
    anchor = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return get_market_status(anchor)["is_trading_day"]
