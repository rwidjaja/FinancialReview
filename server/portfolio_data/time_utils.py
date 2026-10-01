"""portfolio_data.time_utils — Eastern-time helpers and NYSE session bounds."""

from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:
    _ET = None

# NYSE session bounds in minutes-since-midnight (Eastern Time)
_NYSE_OPEN_MIN  = 9 * 60 + 30   # 9:30 AM
_NYSE_CLOSE_MIN = 16 * 60        # 4:00 PM


def _et_dt() -> datetime:
    """Current datetime in US/Eastern (zoneinfo if available, else UTC−4 fallback)."""
    if _ET is not None:
        return datetime.now(_ET)
    return datetime.now(timezone.utc) - timedelta(hours=4)


def _et_now() -> date:
    """Current date in US/Eastern time (handles EST/EDT automatically)."""
    return _et_dt().date()


def _et_hour() -> int:
    """Current hour (0-23) in US/Eastern time."""
    return _et_dt().hour


def _et_minutes_since_midnight() -> int:
    """Current ET time as minutes since midnight (0–1439)."""
    n = _et_dt()
    return n.hour * 60 + n.minute
