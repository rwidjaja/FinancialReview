#!/usr/bin/env python3
"""
HTTP server for the Portfolio Dashboard.
Handles routing, cache management, and request serving.
"""

import json
import os
import sys
import queue
import threading
import time
import traceback
import importlib
import gc
import resource
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler

import market_calendar

# ── Server-side auto-refresh interval ─────────────────────────────────────────
# During market hours:  refresh every 5 min so prices stay live.
# Outside market hours: sleep until the next 9:30 AM ET open; no wasted fetches.
_SERVER_REFRESH_INTERVAL_MARKET = 5 * 60    # 5 min during market hours
_DEBUG_REFRESH = os.environ.get("DASHBOARD_DEBUG", "0") == "1"
_START_TIME = time.time()


def _raise_fd_limit() -> None:
    """Take real fd headroom at startup.

    macOS ships a 256 soft limit for launchd-spawned shells (`launchctl limit
    maxfiles`), which this process has exhausted before — once accept() starts
    failing with EMFILE the vite proxy sees socket hang up / ECONNRESET while
    the server still looks alive. The hard limit is unlimited, so raise the
    soft limit; kern.maxfilesperproc caps how far, hence the descending retry.
    """
    try:
        soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    except Exception as ex:
        print(f"[init] could not read fd limit: {ex}")
        return
    for want in (10240, 4096, 1024):
        if soft >= want:
            return
        try:
            resource.setrlimit(resource.RLIMIT_NOFILE, (want, hard))
            print(f"[init] fd soft limit raised {soft} -> {want}")
            return
        except Exception:
            continue
    print(f"[init] fd soft limit left at {soft} (could not raise)")


def _open_fd_count() -> int:
    """Open-fd count for this process; -1 when unavailable.

    /dev/fd is the macOS equivalent of /proc/self/fd. The listdir itself holds
    one fd open, so the count reads ~1 high — fine for spotting a leak trend.
    """
    try:
        return len(os.listdir('/dev/fd'))
    except Exception:
        return -1


def _fd_soft_limit() -> int:
    try:
        return int(resource.getrlimit(resource.RLIMIT_NOFILE)[0])
    except Exception:
        return -1


def _et_now():
    """Return current time as a naive ET datetime."""
    import zoneinfo
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    try:
        return now.astimezone(zoneinfo.ZoneInfo("America/New_York")).replace(tzinfo=None)
    except Exception:
        return (now - timedelta(hours=4)).replace(tzinfo=None)


def _is_market_open() -> bool:
    """Return True when NYSE is open right now — calendar-aware (holidays,
    early closes) via market_calendar, not a hardcoded Mon–Fri 9:30–16:00 check."""
    return market_calendar.get_market_status()['is_open']


def _secs_until_next_open() -> float:
    """Seconds from now until the next NYSE open — skips holidays automatically."""
    next_open = datetime.fromisoformat(market_calendar.get_market_status()['next_open_utc'])
    now_utc = datetime.now(timezone.utc)
    return max((next_open - now_utc).total_seconds(), 60)


_SLEEP_POLL_CHUNK = 60  # seconds

def _sleep_until_open() -> None:
    """Sleep until the next market open, in short chunks rather than one
    long time.sleep(secs).

    time.sleep() only counts time the process is actually running — a
    laptop that suspends overnight (Power Nap / dark-wake cycles, lid
    closed, etc.) freezes a long sleep mid-countdown, so it can finish far
    later than the intended wall-clock open time, or not at all before the
    next check. Re-deriving the real open time every ~60s of runtime means
    the loop notices "market's open now" on the first wake after the open,
    instead of waiting out a single stale multi-hour countdown.
    """
    while not _is_market_open():
        time.sleep(min(_secs_until_next_open(), _SLEEP_POLL_CHUNK))


def _secs_until_next_et(hour: int, minute: int) -> float:
    """Seconds from now until the next weekday occurrence of HH:MM ET.

    If that time is still in the future today (and today is a weekday),
    returns seconds to today's occurrence.  Otherwise advances to the next
    weekday.
    """
    from datetime import timedelta
    et = _et_now()
    candidate = et.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= et or et.weekday() >= 5:
        candidate += timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return max((candidate - et).total_seconds(), 1)


def _refresh_nav_cache_safe() -> None:
    """Call data_fetcher.refresh_nav_cache(), swallowing any import/runtime errors."""
    try:
        import data_fetcher as _df
        _df.refresh_nav_cache()
    except Exception as e:
        print(f"[nav-refresh] Failed: {e}")


def _auto_refresh_loop() -> None:
    """Background loop: re-fetches data only during market hours.

    - Market open  → refresh every 5 min.
    - Market closed → sleep until next 9:30 AM ET open, then refresh once.
      No wasted fetches overnight or on weekends.

    NAV cache (fallback_data.json) is refreshed once per day at market open so
    CEF/option-income ETF NAVs never drift stale.
    """
    _last_nav_refresh_date: str = ""
    _was_market_open = False   # tracks open→closed transition

    while True:
        # Whole body is guarded — an unhandled exception here (e.g. from
        # _is_market_open()/_secs_until_next_open()) used to escape the loop
        # entirely and silently kill this daemon thread, so refreshing would
        # only resume after a full server restart. Log and retry instead.
        try:
            if _is_market_open():
                _was_market_open = True
                time.sleep(_SERVER_REFRESH_INTERVAL_MARKET)
                if _DEBUG_REFRESH:
                    print(f"[auto-refresh] Market-hours refresh firing...")
                do_refresh()
            else:
                # ── Close-session capture ─────────────────────────────────
                # First iteration after market closes: _was_market_open flips
                # True → False.  Wait 5 min for Schwab quotes to fully settle,
                # then do one final refresh to lock in official closing prices
                # before the loop sleeps overnight.
                if _was_market_open:
                    _was_market_open = False
                    print("[auto-refresh] Market closed — waiting 5 min for quotes to settle...")
                    time.sleep(5 * 60)
                    print("[auto-refresh] Capturing closing prices...")
                    do_refresh()
                    print("[auto-refresh] ✓ Closing prices captured")

                secs = _secs_until_next_open()
                if _DEBUG_REFRESH:
                    print(f"[auto-refresh] Sleeping {secs/3600:.1f}h until next open")
                else:
                    print(f"[auto-refresh] Market closed — next refresh at market open "
                          f"({secs/3600:.1f}h from now)")
                _sleep_until_open()
                # Refresh NAV cache once per trading day, right at the open
                today = _et_now().strftime("%Y-%m-%d")
                if today != _last_nav_refresh_date:
                    _refresh_nav_cache_safe()
                    _last_nav_refresh_date = today
                # Do one refresh right at the open so the cache is fresh when users arrive
                do_refresh()
        except Exception as _e:
            print(f"[auto-refresh] scheduler error: {_e}")
            traceback.print_exc()
            time.sleep(60)

_WATCHLIST_REFRESH_INTERVAL = 5 * 60   # same cadence as the main engine

# ── Balance snapshot capture ──────────────────────────────────────────────────
# Runs in a dedicated 60-second tick loop — no impact on the main refresh cycle.
# Records total portfolio value at two moments each trading day:
#   "open"  — first capture in the 9:30–9:44 ET window
#   "close" — first capture in the 16:00–16:14 ET window
# Uses INSERT OR REPLACE so re-running never creates duplicates.

_MMF_SYMBOLS = {'CASH', 'SWVXX', 'VMFXX', 'SPAXX'}

def _fetch_session_hl(date_str: str, cached_data: dict) -> tuple:
    """Fetch session High/Low for date_str using positions from cached_data.

    Computes portfolio H/L as sum(shares × daily_high/low) + cash positions.
    Returns (session_high, session_low) floats, or (None, None) on any error.
    date_str must be a completed trading session for yfinance to have OHLC data.
    """
    try:
        import yfinance as _yf_hl
        from datetime import datetime as _dt_hl, timedelta as _td_hl
        _pm: dict[str, float] = {}   # symbol → total shares
        _cash = 0.0
        for _a in (cached_data.get('accounts') or []):
            for _p in (_a.get('positions') or []):
                _s  = _p.get('symbol', '')
                _sh = float(_p.get('shares', 0) or 0)
                _v  = float(_p.get('value',  0) or 0)
                if not _s:
                    continue
                if (_p.get('is_money_market') or
                        _p.get('fund_type') == 'MONEY_MARKET' or
                        _s in _MMF_SYMBOLS):
                    _cash += _v
                elif _sh > 0:
                    _pm[_s] = _pm.get(_s, 0.0) + _sh
        if not _pm:
            return None, None
        _end = (_dt_hl.strptime(date_str, "%Y-%m-%d") + _td_hl(days=1)).strftime("%Y-%m-%d")
        _hist = _yf_hl.download(
            list(_pm.keys()), start=date_str, end=_end,
            auto_adjust=True, progress=False, threads=False,
        )
        if _hist.empty:
            return None, None

        def _px(col: str) -> dict:
            out: dict[str, float] = {}
            if col not in _hist.columns:
                return out
            _df = _hist[col]
            for _sx in _pm:
                _cx = _df[_sx] if _sx in _df.columns else None
                if _cx is not None and len(_cx) > 0:
                    _pv = float(_cx.iloc[0])
                    if _pv > 0:
                        out[_sx] = _pv
            return out

        _hi_map = _px('High')
        _lo_map = _px('Low')
        s_high = round(sum(_pm[s] * _hi_map[s] for s in _hi_map if s in _pm) + _cash, 2) if _hi_map else None
        s_low  = round(sum(_pm[s] * _lo_map[s] for s in _lo_map if s in _pm) + _cash, 2) if _lo_map else None
        return s_high, s_low
    except Exception:
        return None, None


def _balance_snapshot_loop() -> None:
    """Single scheduler — DB is the source of truth, no in-memory state.

    Every 60 seconds it checks today's DATE + TIME together:
      - today after 09:31 ET  → open missing for TODAY's date  → capture open
                               → yesterday's close missing H/L  → back-fill H/L
      - today after 16:10 ET  → close missing for TODAY's date  → capture close + H/L
                               → close exists but H/L null       → update H/L only

    The DB record for TODAY's date is the only gate — server restarts, manual
    Capture Now, and mid-day restarts are all handled without any in-memory state.
    """
    import db_manager as _dbm
    from datetime import timedelta as _td_bal

    def _acct_breakdown(cached: dict) -> dict:
        bk: dict = {}
        for _a in (cached.get("accounts") or []):
            _k = _a.get("key") or _a.get("label", "unknown")
            _v = float(_a.get("value") or 0)
            if _k and _v > 0:
                bk[_k] = round(_v, 2)
        return bk

    def _get_record(rows: list, date: str, label: str):
        """Return the row dict for (date, label) or None — checks BOTH fields."""
        return next((r for r in rows if r.get("date") == date and r.get("label") == label), None)

    while True:
        time.sleep(60)
        try:
            et    = _et_now()
            today = et.strftime("%Y-%m-%d")   # ET date — used for ALL DB comparisons
            mins  = et.hour * 60 + et.minute

            # Calendar-aware status — holidays and early closes both come from
            # market_calendar, not a hardcoded weekday/16:00 assumption.
            #
            # Anchored to noon on `et`'s own date, not "now" — get_market_status()
            # derives its "today" from UTC, and US evenings (roughly after 19:00–
            # 20:00 local, once UTC has already rolled to tomorrow's date) would
            # otherwise report TOMORROW's trading-day/schedule while `today`
            # (ET-based, line above) still correctly shows the actual current
            # date. That mismatch let this loop believe a Sunday evening was
            # already "past Monday's close," triggering a same-day H/L fetch
            # for a date with no session — failing every tick, forever, since
            # the missing-H/L condition it retries on can never resolve.
            _noon_et_utc = datetime(et.year, et.month, et.day, 16, tzinfo=timezone.utc)
            status         = market_calendar.get_market_status(_noon_et_utc)
            is_trading_day = status['is_trading_day']
            # is_open still needs the REAL current moment, not the noon anchor —
            # only meaningful once we know today is genuinely a trading day.
            market_open    = is_trading_day and market_calendar.get_market_status()['is_open']

            close_et_mins = None
            if is_trading_day and status['market_close_utc']:
                import zoneinfo as _zi_bal
                close_dt_et = datetime.fromisoformat(status['market_close_utc']).astimezone(
                    _zi_bal.ZoneInfo("America/New_York"))
                close_et_mins = close_dt_et.hour * 60 + close_dt_et.minute

            # Skip entirely on non-trading days, or before market opens / well
            # before today's actual close (early-close-aware, not hardcoded 16:00).
            if not is_trading_day:
                continue
            if not market_open and (close_et_mins is None or mins < close_et_mins + 10):
                continue

            cached = _pd._cached_data if hasattr(_pd, '_cached_data') else None
            if not cached:
                if _DEBUG_REFRESH:
                    print(f"[balance] {today} {et.strftime('%H:%M')} ET — data cache not ready, waiting")
                continue
            total = (cached.get("summary") or {}).get("total_value", 0.0)
            if not total or total <= 0:
                if _DEBUG_REFRESH:
                    print(f"[balance] {today} {et.strftime('%H:%M')} ET — total_value={total}, waiting")
                continue

            # Single DB read — all checks use today's date explicitly
            rows = _dbm.balance_snapshots_get(days=3)

            # ── Morning: market is open + 09:31–09:44 ET → open ──────────────
            # Tight window mirrors the live data pull — only fires while the
            # market is actually open and prices are genuine opening values.
            if market_open and 9 * 60 + 31 <= mins <= 9 * 60 + 44:
                open_row = _get_record(rows, today, "open")
                if open_row is None:
                    bk = _acct_breakdown(cached)
                    _dbm.balance_snapshot_record(today, "open", total, bk or None)
                    print(f"[balance] ✓ Open  {today} {et.strftime('%H:%M')} ET  ${total:,.0f}")

                    # Back-fill yesterday's H/L if saved without it — but only when
                    # yesterday was actually a trading day. A close row dated a
                    # weekend/holiday (e.g. a legacy bad row) can never get H/L from
                    # yfinance since no session ever ran, so without this guard the
                    # fetch below retries and fails on every single market open.
                    yesterday  = (et - _td_bal(days=1)).strftime("%Y-%m-%d")
                    prev_close = _get_record(rows, yesterday, "close")
                    if (prev_close and prev_close.get("session_high") is None
                            and market_calendar.is_trading_day(yesterday)):
                        _sh, _sl = _fetch_session_hl(yesterday, cached)
                        if _sh is not None:
                            _dbm.balance_snapshot_record(
                                yesterday, "close",
                                prev_close["total_value"],
                                prev_close.get("accounts") or None,
                                session_high=_sh, session_low=_sl,
                            )
                            print(f"[balance] ✓ Back-filled H/L {yesterday}  H=${_sh:,.0f} L=${_sl:,.0f}")

            # ── Evening: market closed + today's actual close + 10 min ───────
            # close_et_mins reflects today's real scheduled close (early-close
            # days included) — the settle window always lands 10 min after the
            # actual close, not a hardcoded 16:00.
            if not market_open and close_et_mins is not None and mins >= close_et_mins + 10:
                close_row = _get_record(rows, today, "close")
                if close_row is None:
                    # No close yet — capture with H/L
                    bk = _acct_breakdown(cached)
                    _sh, _sl = _fetch_session_hl(today, cached)
                    _dbm.balance_snapshot_record(
                        today, "close", total, bk or None,
                        session_high=_sh, session_low=_sl,
                    )
                    hl = f"  H=${_sh:,.0f} L=${_sl:,.0f}" if _sh else "  H/L=unavailable"
                    print(f"[balance] ✓ Close {today} {et.strftime('%H:%M')} ET  ${total:,.0f}{hl}")

                elif close_row.get("session_high") is None:
                    # Close exists but H/L is missing — update it
                    _sh, _sl = _fetch_session_hl(today, cached)
                    if _sh is not None:
                        _dbm.balance_snapshot_record(
                            today, "close",
                            close_row["total_value"],
                            close_row.get("accounts") or None,
                            session_high=_sh, session_low=_sl,
                        )
                        print(f"[balance] ✓ Updated H/L {today}  H=${_sh:,.0f} L=${_sl:,.0f}")

        except Exception as _e:
            print(f"[balance] scheduler error: {_e}")


def _watchlist_refresh_loop() -> None:
    """Refresh sim-portfolio watchlist prices and check price alerts — market hours only.

    Mirrors _auto_refresh_loop: sleeps until the next 9:30 ET open when the
    market is closed so no yfinance calls are wasted overnight or on weekends.

    After each price refresh:
    - Builds a snapshot dict from price_cache for all watchlist symbols
    - Runs check_alerts against it so alerts on watchlist-only symbols
      (not held in the main portfolio) can also trigger
    - Merges any new triggers into the cached dashboard data so the frontend
      picks them up on the next /api/data poll
    """
    import sim_portfolio as sp

    def _refresh_all_watchlists():
        try:
            portfolios = sp.list_portfolios()
            all_syms: list = []
            for p in portfolios:
                c = sp._cur()
                c.execute("SELECT symbol FROM watchlist WHERE portfolio_id=?",
                          (p['portfolio_id'],))
                all_syms.extend(r['symbol'] for r in c.fetchall())

            if not all_syms:
                return

            unique_syms = list(set(all_syms))
            prices = sp.refresh_prices(unique_syms)  # {symbol: price}

            # Build minimal snapshot dict compatible with check_alerts
            wl_snapshots: dict = {}
            for sym, price in prices.items():
                if price:
                    wl_snapshots[sym] = {"price": price}

            # Check alerts against freshly-refreshed watchlist prices.
            # Merges with the existing cached snapshots so portfolio symbols
            # already covered by do_refresh() are not double-counted.
            try:
                from price_alerts import check_alerts as _check_alerts
                with _pd._cache_lock:
                    cached = _pd._cached_data or {}
                existing_snaps = cached.get("snapshots", {})
                combined = {**wl_snapshots, **existing_snaps}  # portfolio prices win
                triggered = _check_alerts(combined)
                if triggered:
                    with _pd._cache_lock:
                        if _pd._cached_data is not None:
                            _pd._cached_data["triggered_alerts"] = triggered
            except Exception as ae:
                print(f"[watchlist-refresh] alert check error: {ae}")

        except Exception as e:
            print(f"[watchlist-refresh] Error: {e}")

    while True:
        # Guarded for the same reason as _auto_refresh_loop: an unhandled
        # exception used to escape the loop and kill this daemon thread
        # silently, so refresh only resumed after a server restart.
        try:
            if _is_market_open():
                time.sleep(_WATCHLIST_REFRESH_INTERVAL)
                _refresh_all_watchlists()
            else:
                _sleep_until_open()
                _refresh_all_watchlists()   # one refresh right at open
        except Exception as _e:
            print(f"[watchlist-refresh] scheduler error: {_e}")
            traceback.print_exc()
            time.sleep(60)


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from portfolio_data import (
    _cache_lock, _cached_data, _last_refresh, _refreshing,
    fetch_all_data, get_performance_data,
)
import portfolio_data as _pd
from research import get_research, get_chart_data, build_portfolio_fit, get_etf_components, build_health_evaluation


def _sanitize(obj):
    """Recursively replace float NaN/Inf with None so json.dumps produces valid JSON."""
    import math
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj


def _json(obj) -> bytes:
    """Serialize to JSON-safe bytes (NaN/Inf → null)."""
    return json.dumps(_sanitize(obj)).encode()


# ── Earnings cache (6-hour TTL — dates don't change intraday) ────────────────
_earnings_cache: dict = {}
_earnings_cache_ts: float = 0.0
_EARNINGS_CACHE_TTL = 6 * 60 * 60  # 6 hours


def do_refresh():
    """Perform a data refresh and update the cache."""
    with _pd._cache_lock:
        if _pd._refreshing:
            return
        _pd._refreshing = True
    try:
        # ── Clear caches before fetch (same as manual refresh) ──────────
        _pd._div_metrics_cache = {}
        _pd._div_metrics_ts = 0.0
        
        try:
            import data_fetcher as df
            df._SPY_HIST = None
        except Exception:
            pass
        
        try:
            import yfinance as yf
            if hasattr(yf, '_tkr_map'):
                yf._tkr_map.clear()
        except Exception:
            pass
        
        try:
            import schwab_client
            schwab_client.clear_caches()
        except Exception:
            pass

        # ── Clear realized-gains disk cache so same-day sells appear ────
        # clear_caches() resets the in-memory cache but the SQLite
        # cache_kv entry (keyed by today's date) survives it and
        # would be returned as-is, hiding any sells made since the last fetch.
        try:
            import db_manager as _dbm
            from datetime import date as _date
            _rg_key = f"schwab:realized_gains_v13_{_date.today().isoformat()}"
            _dbm.cache_delete(_rg_key)
        except Exception:
            pass

        try:
            import gc
            gc.collect()
        except Exception:
            pass

        # ── Fetch ────────────────────────────────────────────────────────
        start = time.time()
        if _DEBUG_REFRESH:
            print(f"[auto-refresh] {datetime.now(timezone.utc).strftime('%H:%M:%S')} Fetching...")
        
        data = fetch_all_data()

        # ── Check price alerts against fresh snapshots ──────────────────
        try:
            from price_alerts import check_alerts as _check_alerts
            triggered = _check_alerts(data.get("snapshots", {}))
            data["triggered_alerts"] = triggered
        except Exception as _ae:
            print(f"[alerts] check error: {_ae}")
            data["triggered_alerts"] = []

        elapsed = time.time() - start
        with _pd._cache_lock:
            _pd._cached_data = data
            _pd._last_refresh = data["timestamp"]
        
        if _DEBUG_REFRESH:
            print(f"[auto-refresh] ✓ {elapsed:.1f}s | "
                  f"Schwab: {data.get('schwab_status', '?')} | "
                  f"{len(data.get('snapshots', {}))} symbols")
        else:
            print(f"[auto-refresh] {elapsed:.1f}s | "
                  f"Schwab: {data.get('schwab_status', '?')} | "
                  f"{len(data.get('snapshots', {}))} symbols")
    except Exception as e:
        print(f"[auto-refresh] ✗ Error: {e}")
        traceback.print_exc()
        _pd._update_status("error", f"Error: {e}", 0)
    finally:
        with _pd._cache_lock:
            _pd._refreshing = False


class DashboardHandler(BaseHTTPRequestHandler):
    # Bound every socket read. Without this, StreamRequestHandler leaves the
    # connection blocking with no deadline, so a half-open TCP connection —
    # exactly what a Mac sleep/wake cycle leaves behind — parks a pool worker
    # in rfile.readline() forever. Sixteen of those and the pool is gone while
    # the process still holds :8501. handle_one_request() turns the timeout
    # into a clean close_connection.
    timeout = 30

    def do_GET(self):
        # Trade Simulation routes
        if self.path.startswith('/api/sim/'):
            from routes_sim import handle as _sim
            try:
                if not _sim(self):
                    self.send_response(404); self.end_headers()
            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(ex)}).encode())
            return
        if self.path == '/':
            msg = b'Financial Dashboard API server. Open the React app on port 3000.'
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', len(msg))
            self.end_headers()
            self.wfile.write(msg)
        elif self.path.startswith('/api/performance'):
            try:
                from urllib.parse import urlparse, parse_qs
                _qs = parse_qs(urlparse(self.path).query)
                force_refresh = _qs.get('refresh', [''])[0] == '1'
                perf = get_performance_data(force_refresh=force_refresh)
                body = _json(perf)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(ex)}).encode())

        elif self.path == '/api/signals':
            try:
                import yfinance as yf
                import os as _os
                from price_utils import fetch_price_data

                _cfg_path = _os.path.join(_os.path.dirname(__file__), 'signals_config.json')
                with open(_cfg_path) as _f:
                    _sig_cfg = json.load(_f)

                # Build _SIGNAL_META from config (targets + all chain layers)
                _SIGNAL_META = {}
                for _t in _sig_cfg['targets']:
                    _SIGNAL_META[_t['sym']] = {'name': _t['name'], 'layer': _t['layer']}
                for _layer, _syms in _sig_cfg['chain'].items():
                    for _s in _syms:
                        _SIGNAL_META[_s['sym']] = {'name': _s['name'], 'layer': _layer}

                syms = list(_SIGNAL_META.keys())

                _null_ticker = lambda sym: {**_SIGNAL_META[sym],
                    'price': None, 'change': None, 'change_pct': None,
                    'change_5d_pct': None, 'drawdown_20d': None,
                    'drawdown_label': None, 'signal': 'unknown'}

                _price_data = fetch_price_data(syms)
                tickers_out = {
                    sym: ({**_SIGNAL_META[sym], **_price_data[sym]}
                          if _price_data.get(sym) else _null_ticker(sym))
                    for sym in syms
                }

                # MA context (informational only — not a gate)
                trend_filter: dict = {'sma50': None, 'sma200': None, 'smh_price': None, 'trend': 'unknown'}
                try:
                    _tf_dl  = yf.download('SMH', period='200d', auto_adjust=True, progress=False)
                    _tf_c   = _tf_dl['Close'].squeeze().dropna()
                    _tf_px  = float(_tf_c.iloc[-1]) if not _tf_c.empty else None
                    _tf_50  = float(_tf_c.tail(50).mean())  if len(_tf_c) >= 50  else None
                    _tf_200 = float(_tf_c.tail(200).mean()) if len(_tf_c) >= 200 else None
                    if _tf_px and _tf_50 and _tf_200:
                        if _tf_px > _tf_50 and _tf_50 > _tf_200:
                            _tf_trend = 'bullish'
                        elif _tf_px < _tf_50:
                            _tf_trend = 'caution'
                        else:
                            _tf_trend = 'neutral'
                    else:
                        _tf_trend = 'unknown'
                    trend_filter = {
                        'sma50':     round(_tf_50,  2) if _tf_50  else None,
                        'sma200':    round(_tf_200, 2) if _tf_200 else None,
                        'smh_price': round(_tf_px,  2) if _tf_px  else None,
                        'trend':     _tf_trend,
                    }
                except Exception as _tfe:
                    print(f"[signals] trend filter error: {_tfe}")

                # ── Macro / rate context ──────────────────────────────────────────
                # ^TNX = 10Y yield (bps change + 30d MA regime)
                # TLT  = long-bond ETF (live inverse proxy during market hours)
                # ^VIX = fear gauge (size modifier: ≥25 FEAR, ≥18 ELEVATED, <18 CALM)
                macro_out: dict = {}
                try:
                    import numpy as _np_macro
                    # 10Y yield — fetch 35d so we can compute 30d MA + buffer
                    _tnx = yf.Ticker('^TNX')
                    _tnx_h = _tnx.history(period='35d', auto_adjust=True)
                    if not _tnx_h.empty and len(_tnx_h) >= 2:
                        _tnx_c   = _tnx_h['Close'].dropna()
                        _tnx_cur = float(_tnx_c.iloc[-1])
                        _tnx_prv = float(_tnx_c.iloc[-2])
                        _tnx_ma30 = float(_tnx_c.tail(30).mean()) if len(_tnx_c) >= 30 else float(_tnx_c.mean())
                        _tnx_bps  = round((_tnx_cur - _tnx_prv) * 100, 1)  # basis points change today
                        # Regime: how far current yield sits vs 30-day MA
                        _tnx_diff = _tnx_cur - _tnx_ma30
                        _tnx_regime = (
                            'PRESSURE' if _tnx_diff >  0.08 else   # yield >8bps above 30d MA
                            'TAILWIND' if _tnx_diff < -0.08 else   # yield >8bps below 30d MA
                            'NEUTRAL'
                        )
                        # Today's signal: rising fast = red headwind, falling fast = green tailwind
                        _tnx_sig = (
                            'red'    if _tnx_bps >=  6 else   # rising fast → SOXX headwind
                            'green'  if _tnx_bps <= -6 else   # falling fast → SOXX tailwind
                            'yellow' if _tnx_bps >=  3 else   # drifting up → caution
                            'green'                            # stable/falling
                        )
                        macro_out['TNX'] = {
                            'price':      round(_tnx_cur, 3),
                            'change_bps': _tnx_bps,
                            'ma30':       round(_tnx_ma30, 3),
                            'regime':     _tnx_regime,
                            'signal':     _tnx_sig,
                        }
                except Exception as _me:
                    print(f'[signals] TNX error: {_me}')
                # 60-day rolling SOXX-vs-ΔTNX beta — read-only supplementary stat,
                # does NOT feed the discrete threshold logic above (kept mechanical/rule-based).
                try:
                    _bs_c = yf.Ticker('SOXX').history(period='4mo', auto_adjust=True)['Close'].dropna()
                    _bt_c = yf.Ticker('^TNX').history(period='4mo', auto_adjust=True)['Close'].dropna()
                    _bs_c.index = _bs_c.index.tz_localize(None)
                    _bt_c.index = _bt_c.index.tz_localize(None)
                    _soxx_ret = _bs_c.pct_change().dropna()
                    _tnx_chg  = _bt_c.diff().dropna()
                    _common   = _soxx_ret.index.intersection(_tnx_chg.index)
                    _soxx_ret = _soxx_ret.loc[_common].tail(60)
                    _tnx_chg  = _tnx_chg.loc[_common].tail(60)
                    _tnx_var  = _tnx_chg.var()
                    if 'TNX' in macro_out and len(_tnx_chg) >= 20 and _tnx_var:
                        _beta_raw = _tnx_chg.cov(_soxx_ret) / _tnx_var
                        # _beta_raw is fractional SOXX return per 1.00 percentage-point (100bps) yield move;
                        # *10 rescales to "% SOXX move per 10bps" for readability.
                        macro_out['TNX']['beta_60d_per_10bps'] = round(_beta_raw * 10, 2)
                        macro_out['TNX']['beta_n'] = int(len(_tnx_chg))
                except Exception as _be:
                    print(f'[signals] SOXX beta error: {_be}')
                try:
                    _tlt = yf.Ticker('TLT')
                    _tlt_h = _tlt.history(period='2d', auto_adjust=True)
                    if len(_tlt_h) >= 2:
                        _tlt_c   = _tlt_h['Close'].dropna()
                        _tlt_cur = float(_tlt_c.iloc[-1])
                        _tlt_prv = float(_tlt_c.iloc[-2])
                        _tlt_chg = round((_tlt_cur - _tlt_prv) / _tlt_prv * 100, 2)
                        macro_out['TLT'] = {
                            'price':      round(_tlt_cur, 2),
                            'change_pct': _tlt_chg,
                            'signal':     'green' if _tlt_chg >= 0.5 else 'red' if _tlt_chg <= -0.5 else 'yellow',
                        }
                except Exception as _me:
                    print(f'[signals] TLT error: {_me}')
                try:
                    _vix = yf.Ticker('^VIX')
                    _vix_h = _vix.history(period='2d', auto_adjust=True)
                    if not _vix_h.empty:
                        _vix_cur = float(_vix_h['Close'].dropna().iloc[-1])
                        macro_out['VIX'] = {
                            'price':  round(_vix_cur, 1),
                            'signal': 'red' if _vix_cur >= 25 else 'yellow' if _vix_cur >= 18 else 'green',
                            'label':  'FEAR' if _vix_cur >= 25 else 'ELEVATED' if _vix_cur >= 18 else 'CALM',
                        }
                except Exception as _me:
                    print(f'[signals] VIX error: {_me}')

                # ── L0.2 Earnings Expectation Pressure — price-only RED/YELLOW/GREEN ─
                # gate (parabolic run + SMH/SOXX/DRAM correlation spike). Slow-moving by
                # design — cached 1h so a 6mo history pull for ~15 tickers doesn't run
                # on every 5-min signals poll.
                earnings_pressure_out: dict = {
                    'level': 'GREEN', 'parabolic_run': False, 'parabolic_tickers': [],
                    'correlation_spike': False, 'corr_smh_soxx': None, 'corr_dram_smh': None, 'corr_dram_soxx': None,
                }
                _ep_key = 'signals:earnings_pressure_v1'
                try:
                    import db_manager as _dbm_ep
                    import time as _time_ep
                    from price_utils import compute_earnings_pressure
                    _ep_cached = _dbm_ep.cache_get_ts(_ep_key)
                    if _ep_cached and (_time_ep.time() - _ep_cached[1]) < 60 * 60:
                        earnings_pressure_out = _ep_cached[0]
                    else:
                        _ep_syms = list(dict.fromkeys(
                            _sig_cfg['earnings_watch'] + [s['sym'] for s in _sig_cfg['chain']['hbm']]
                        ))
                        earnings_pressure_out = compute_earnings_pressure(_ep_syms)
                        _dbm_ep.cache_set(_ep_key, earnings_pressure_out)
                except Exception as _epe:
                    print(f'[signals] earnings pressure error: {_epe}')
                    try:
                        import db_manager as _dbm_ep2
                        earnings_pressure_out = _dbm_ep2.cache_get(_ep_key) or earnings_pressure_out
                    except Exception:
                        pass

                # ── Signal backtest — empirical hit rate per candidate trigger ──────
                # Historical stat, not live data — a multi-year multi-symbol download
                # recomputed on every 5-min poll would be wasteful and slow. Cached ~24h.
                signal_backtest_out: dict = {'rows': [], 'baseline': {}}
                _cb_key = 'signals:signal_backtest_v3'   # v3 — shape changed to {rows, baseline}
                try:
                    import db_manager as _dbm_cb
                    import time as _time_cb
                    _cb_cached = _dbm_cb.cache_get_ts(_cb_key)
                    if _cb_cached and (_time_cb.time() - _cb_cached[1]) < 24 * 60 * 60:
                        signal_backtest_out = _cb_cached[0]
                    else:
                        from chain_backtest import compute_signal_backtest
                        signal_backtest_out = compute_signal_backtest()
                        _dbm_cb.cache_set(_cb_key, signal_backtest_out)
                except Exception as _cbe:
                    print(f'[signals] signal backtest error: {_cbe}')
                    try:
                        import db_manager as _dbm_cb2
                        signal_backtest_out = _dbm_cb2.cache_get(_cb_key) or {'rows': [], 'baseline': {}}
                    except Exception:
                        signal_backtest_out = {'rows': [], 'baseline': {}}

                _sig_body = _json({
                    'tickers':           tickers_out,
                    'trend_filter':      trend_filter,
                    'macro':             macro_out,
                    'signal_backtest':   signal_backtest_out,
                    'earnings_pressure': earnings_pressure_out,
                    'config':            _sig_cfg,
                    'timestamp':         datetime.now().isoformat(),
                })
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(_sig_body))
                self.end_headers()
                try:
                    self.wfile.write(_sig_body)
                except BrokenPipeError:
                    pass  # client navigated away mid-response — not an error
            except BrokenPipeError:
                pass  # client disconnected before response started — harmless
            except Exception as _ex:
                try:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': str(_ex)}).encode())
                except BrokenPipeError:
                    pass

        elif self.path.startswith('/api/chart'):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            symbol = (qs.get("symbol", [""])[0] or "").strip().upper()
            if not symbol:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "symbol required"}).encode())
            else:
                try:
                    data = get_chart_data(symbol)
                    body = _json(data)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', len(body))
                    self.end_headers()
                    self.wfile.write(body)
                except Exception as ex:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": str(ex)}).encode())

        elif self.path.startswith('/api/research/') and self.path.endswith('/narrate'):
            # AI summary of a research deep-dive result (quality, action, portfolio fit).
            # Works for any symbol — not just held positions.
            from urllib.parse import urlparse
            raw_sym = self.path[len('/api/research/'):-len('/narrate')].strip('/')
            sym = raw_sym.upper()
            if not sym:
                self.send_response(400); self.send_header('Content-Type', 'application/json')
                self.end_headers(); self.wfile.write(json.dumps({"error": "symbol required"}).encode())
            else:
                try:
                    research_data = get_research(sym)
                    with _pd._cache_lock:
                        _portfolio = _pd._cached_data
                    if _portfolio:
                        research_data["portfolio_fit"] = build_portfolio_fit(sym, research_data, _portfolio)
                    import research_narrate
                    payload = research_narrate.narrate(research_data, _portfolio)
                except Exception as e:
                    if _DEBUG_REFRESH:
                        print(f"[GET /api/research/{sym}/narrate] failed: {e}")
                    payload = {"narrative": "", "source": "error", "cached": False, "view": None}
                body = _json({"symbol": sym, **payload})
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)

        elif self.path.startswith('/api/research/components'):
            from urllib.parse import urlparse, parse_qs
            qs     = parse_qs(urlparse(self.path).query)
            symbol = (qs.get("symbol", [""])[0] or "").strip().upper()
            if not symbol:
                self.send_response(400); self.send_header('Content-Type', 'application/json')
                self.end_headers(); self.wfile.write(json.dumps({"error": "symbol required"}).encode())
            else:
                try:
                    data = get_etf_components(symbol)
                    body = _json(data)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', len(body))
                    self.end_headers()
                    self.wfile.write(body)
                except Exception as ex:
                    self.send_response(500); self.send_header('Content-Type', 'application/json')
                    self.end_headers(); self.wfile.write(json.dumps({"error": str(ex)}).encode())

        elif self.path.startswith('/api/research'):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            symbol = (qs.get("symbol", [""])[0] or "").strip().upper()
            if not symbol:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "symbol parameter required"}).encode())
            else:
                try:
                    data = get_research(symbol)
                    # Augment with portfolio-fit context and fund health evaluation
                    with _pd._cache_lock:
                        _portfolio = _pd._cached_data
                    if _portfolio:
                        data["portfolio_fit"] = build_portfolio_fit(symbol, data, _portfolio)
                    # Run on-demand fund health evaluation (same engine as portfolio pipeline)
                    data["health_decision"] = build_health_evaluation(symbol, data, _portfolio)
                    body = _json(data)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', len(body))
                    self.end_headers()
                    self.wfile.write(body)
                except Exception as ex:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": str(ex)}).encode())

        elif self.path == '/api/health':
            # Liveness + wedge diagnostics. Poll this first when the dashboard
            # goes unresponsive: workers_live below workers_target means the
            # pool is decaying, queue_depth pinned at queue_limit means the
            # workers are blocked, and fds_open near fds_limit means the old
            # fd-exhaustion mode is back.
            try:
                health = self.server.health()
            except Exception as ex:
                health = {"error": str(ex)}
            health['fds_open'] = _open_fd_count()
            health['fds_limit'] = _fd_soft_limit()
            health['threads'] = threading.active_count()
            health['uptime_s'] = round(time.time() - _START_TIME, 1)
            body = _json(health)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == '/api/status':
            # Live refresh-progress status — safe to poll frequently
            with _pd._cache_lock:
                refreshing = _pd._refreshing
            with _pd._status_lock:
                status = {k: v for k, v in _pd._refresh_status.items()
                          if k != 'started_at'}   # don't expose internal timestamp
            status['refreshing'] = refreshing
            body = _json(status)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == '/api/market_status':
            # NYSE trading-day status — calendar-aware (holidays, early closes).
            # Safe to poll frequently; schedule lookups are cached per-day.
            body = _json(market_calendar.get_market_status())
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path.startswith('/api/briefing/'):
            # Per-tab briefing — one route per tab, all sharing the same shape
            # via narration.cached_narrate. Tab key is the path suffix.
            tab = self.path[len('/api/briefing/'):].strip('/').lower()
            _modules = {
                'cashflow':  'cashflow_briefing',
                'tax':       'tax_briefing',
                'returns':   'returns_briefing',
                'forecast':  'forecast_briefing',
                'risk':      'risk_briefing',
                'portfolio': 'portfolio_briefing',
            }
            mod_name = _modules.get(tab)
            if mod_name is None:
                body = _json({"error": f"unknown tab: {tab}"})
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            else:
                try:
                    mod = importlib.import_module(mod_name)
                    importlib.reload(mod)
                    with _pd._cache_lock:
                        cached = _pd._cached_data or {}
                    payload = mod.narrate(cached)
                except Exception as e:
                    if _DEBUG_REFRESH:
                        print(f"[GET /api/briefing/{tab}] failed: {e}")
                    payload = {"narrative": "", "source": "error", "cached": False, "view": None}
                body = _json(payload)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)

        elif self.path == '/api/suggestions':
            # Context-aware starter prompts for the AI chat sidebar. Pure
            # deterministic templating over the current signal set — no LLM call.
            try:
                import suggestions
                with _pd._cache_lock:
                    cached = _pd._cached_data or {}
                payload = suggestions.build(cached)
            except Exception as e:
                if _DEBUG_REFRESH:
                    print(f"[GET /api/suggestions] failed: {e}")
                payload = {"suggestions": [], "signal_count": 0}
            body = _json(payload)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path.startswith('/api/monthly-review'):
            # Month-end digest + LLM narrative.
            # Query params: ?year=YYYY&month=MM. Defaults to last calendar month.
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            from datetime import date as _d
            today = _d.today()
            prev_year  = today.year - 1 if today.month == 1 else today.year
            prev_month = 12 if today.month == 1 else today.month - 1
            try:
                year  = int(qs.get("year",  [str(prev_year)])[0])
                month = int(qs.get("month", [str(prev_month)])[0])
            except (TypeError, ValueError):
                year, month = prev_year, prev_month
            try:
                import monthly_review
                payload = monthly_review.narrate(year, month)
                # If no explicit month requested and prev month has no data,
                # fall back to current month so the UI is never empty.
                if (payload.get("source") == "no_data"
                        and "month" not in qs and "year" not in qs):
                    cur_payload = monthly_review.narrate(today.year, today.month)
                    if cur_payload.get("digest"):
                        year, month, payload = today.year, today.month, cur_payload
            except Exception as e:
                if _DEBUG_REFRESH:
                    print(f"[GET /api/monthly-review] failed: {e}")
                payload = {"narrative": "", "source": "error", "cached": False, "digest": None}
            status = 200 if payload.get("digest") else 404
            body = _json({"year": year, "month": month, **payload})
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path.startswith('/api/decision/') and self.path.endswith('/narrate'):
            # 2-3 sentence "why this status" rationale for a fund's structural
            # decision. Drives the click-the-status-icon popover.
            sym = self.path[len('/api/decision/'):-len('/narrate')].strip('/').upper()
            try:
                import decision_narrate
                with _pd._cache_lock:
                    cached = _pd._cached_data or {}
                payload = decision_narrate.narrate(sym, cached)
            except Exception as e:
                if _DEBUG_REFRESH:
                    print(f"[GET /api/decision/{sym}/narrate] failed: {e}")
                payload = {"narrative": "", "source": "error", "cached": False,
                           "view": None, "status": None}
            status = 200 if payload.get("view") else 404
            body = _json({"symbol": sym, **payload})
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path.startswith('/api/position/') and self.path.endswith('/narrate'):
            # 3-sentence LLM summary for one holding. Symbol must be currently
            # held in any account; otherwise returns 404 with a structured stub.
            sym = self.path[len('/api/position/'):-len('/narrate')].strip('/').upper()
            try:
                import position_narrate
                with _pd._cache_lock:
                    cached = _pd._cached_data or {}
                payload = position_narrate.narrate(sym, cached)
            except Exception as e:
                if _DEBUG_REFRESH:
                    print(f"[GET /api/position/{sym}/narrate] failed: {e}")
                payload = {"narrative": "", "source": "error", "cached": False, "view": None}
            status = 200 if payload.get("view") else 404
            body = _json({"symbol": sym, **payload})
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path.startswith('/api/alert/') and self.path.endswith('/narrate'):
            # One-sentence LLM context for a triggered alert. The frontend
            # passes the alert id; we look up the alert via price_alerts so
            # we don't trust client-supplied fields.
            alert_id = self.path[len('/api/alert/'):-len('/narrate')].strip('/')
            try:
                import price_alerts as _pa
                alert = next((a for a in _pa.get_alerts() if a.get('id') == alert_id), None)
            except Exception:
                alert = None
            if not alert:
                body = _json({"error": f"unknown alert id: {alert_id}"})
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            else:
                try:
                    import alert_narrate
                    with _pd._cache_lock:
                        cached = _pd._cached_data or {}
                    payload = alert_narrate.narrate(alert, cached)
                except Exception as e:
                    if _DEBUG_REFRESH:
                        print(f"[GET /api/alert/{alert_id}/narrate] failed: {e}")
                    payload = {"narrative": "", "source": "error", "cached": False}
                body = _json({"alert_id": alert_id, **payload})
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)

        elif self.path == '/api/explainers':
            # Full {metric_id: {text, model, generated_at}} map. Tiny payload;
            # frontend can fetch once on dashboard load and cache client-side.
            try:
                import explainers as _ex
                payload = _ex.get_all()
            except Exception as e:
                if _DEBUG_REFRESH:
                    print(f"[GET /api/explainers] failed: {e}")
                payload = {}
            body = _json({"explainers": payload})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path.startswith('/api/explainer/'):
            # Single explainer by metric id. Returns 404 with a stub when the
            # metric is registered but hasn't been baked yet (user needs to
            # run `python -m server.explainers --regen`).
            metric_id = self.path[len('/api/explainer/'):].strip('/')
            try:
                import explainers as _ex
                payload = _ex.get(metric_id)
                label   = _ex.metric_label(metric_id)
            except Exception:
                payload = None
                label   = None
            if payload is None and label is None:
                body = _json({"error": f"unknown metric id: {metric_id}"})
                self.send_response(404)
            elif payload is None:
                body = _json({
                    "metric_id": metric_id, "label": label,
                    "text":      None,
                    "error":     "not yet baked — run `python -m server.explainers --regen`",
                })
                self.send_response(404)
            else:
                body = _json({"metric_id": metric_id, "label": label, **payload})
                self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == '/api/signals/detectors':
            # Latest deterministic event detectors output. One row per
            # (kind, symbol) collapsed via db_manager.signals_get_latest().
            # Separate path from /api/signals (semiconductor-chain dashboard,
            # above) — both were '/api/signals' until 2026-07, which silently
            # shadowed this handler since Python's elif chain only ever
            # matched the first one.
            try:
                import db_manager as _dbm
                signals = _dbm.signals_get_latest()
            except Exception as e:
                signals = []
                if _DEBUG_REFRESH:
                    print(f"[GET /api/signals/detectors] failed: {e}")
            body = _json({"signals": signals})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == '/api/briefing':
            # Structured briefing: latest signals + diffs from the cached
            # fetch_all_data result + a "vs yesterday" delta block from
            # analytics_history, plus an LLM-generated narrative (with
            # template fallback when Ollama/cloud aren't reachable).
            try:
                import db_manager as _dbm
                signals = _dbm.signals_get_latest()
            except Exception:
                signals = []
            with _pd._cache_lock:
                cached = _pd._cached_data or {}
            summary = cached.get('summary') or {}
            pintel  = cached.get('portfolio_intel') or {}
            tx      = cached.get('tax_data') or {}
            today_ts = cached.get('timestamp') or ''
            diffs = {
                "day_change_pct":      summary.get('day_change_pct', 0.0),
                "total_value":         summary.get('total_value', 0.0),
                "top_holding":         pintel.get('top_holding'),
                "top_holding_pct":     pintel.get('top_holding_pct'),
                "fragility_score":     pintel.get('fragility_score'),
                "fragility_level":     pintel.get('fragility_level'),
                "vol_regime":          pintel.get('vol_regime'),
                "market_regime":       pintel.get('market_regime'),
            }
            # ── vs yesterday — pull prior snapshot from analytics_history ──
            vs_yesterday = {}
            try:
                import db_manager as _dbm_a
                prev = _dbm_a.analytics_get_prev(today_ts[:10])
            except Exception:
                prev = None
            if prev:
                def _pair(curr_v, prev_v):
                    if curr_v is None or prev_v is None:
                        return None
                    try:
                        delta = float(curr_v) - float(prev_v)
                    except (TypeError, ValueError):
                        return None
                    return {"prev": prev_v, "curr": curr_v, "delta": round(delta, 2)}
                vs_yesterday = {
                    "as_of":           prev.get("as_of"),
                    "portfolio_value": _pair(summary.get('total_value'), prev.get('portfolio_value')),
                    "vol_budget_used": _pair(pintel.get('vol_budget_used'), prev.get('vol_budget_used')),
                    "fragility_score": _pair(pintel.get('fragility_score'), prev.get('fragility_score')),
                    "bracket_pressure": _pair(tx.get('bracket_pressure_real'), prev.get('bracket_pressure')),
                    "top_holding_pct": _pair(pintel.get('top_holding_pct'), prev.get('top_holding_pct')),
                }
                # Strip None pairs so the UI only renders metrics with data.
                vs_yesterday = {k: v for k, v in vs_yesterday.items()
                                if k == 'as_of' or v is not None}
            try:
                import briefing
                # Pass vs_yesterday into the briefing so the LLM can mention
                # deltas (it's still constrained to "summarise, don't compute").
                briefing_diffs = {**diffs, "vs_yesterday": vs_yesterday}
                narration = briefing.narrate(signals, briefing_diffs)
            except Exception as _be:
                if _DEBUG_REFRESH:
                    print(f"[/api/briefing] narrate failed: {_be}")
                narration = {"narrative": "", "source": "error", "cached": False}
            # ── Headline sentiment snapshot + LLM narrative (best-effort) ──
            sentiment_snapshot = None
            sentiment_narrative = None
            try:
                from signals.headline_sentiment import get_snapshot as _get_sentiment
                sentiment_snapshot = _get_sentiment()
            except Exception:
                pass
            if sentiment_snapshot and sentiment_snapshot.get("top_headlines"):
                try:
                    import hashlib as _hl
                    import narration as _narration
                    _headlines = sentiment_snapshot.get("top_headlines") or []
                    _ck = "sentiment_narrative_v2:" + _hl.sha256(
                        "|".join(_headlines).encode()
                    ).hexdigest()[:20]
                    _sys = (
                        "You are summarising today's financial news for a private investor. "
                        "You will be given a numbered list of real headlines pulled from "
                        "financial news feeds. Write 2–3 sentences that summarise what is "
                        "actually happening across these specific stories. "
                        "Reference the real topics in the headlines (companies, events, "
                        "policy moves). Do NOT write generic market commentary. "
                        "Do not predict prices or give investment advice. "
                        "Plain text only — no bullets, no markdown."
                    )
                    _numbered = "\n".join(
                        f"{i+1}. {h}" for i, h in enumerate(_headlines)
                    )
                    _res = _narration.cached_narrate(
                        cache_key=_ck,
                        system_prompt=_sys,
                        user_payload=_numbered,
                        max_tokens=180,
                    )
                    sentiment_narrative = _res.get("narrative") or None
                except Exception:
                    pass
            # ── News × portfolio correlation (best-effort) ───────────────────
            # Correlates today's headlines to the user's specific holdings so
            # the AI can explain WHAT is happening, HOW each position is
            # affected, and WHY it matters — grounded in real news, not generic
            # market commentary.
            news_correlations = None
            _headlines_for_corr = (
                sentiment_snapshot.get("top_headlines") or []
                if sentiment_snapshot else []
            )
            # Build holdings list: top 15 by weight, sorted descending.
            _weights = pintel.get("weights") or {}
            _holdings = sorted(
                [{"symbol": s, "weight_pct": round(float(w), 1)}
                 for s, w in _weights.items()
                 if w is not None],
                key=lambda x: x["weight_pct"], reverse=True
            )[:15]
            if _holdings and _headlines_for_corr:
                try:
                    import hashlib as _hl2
                    import narration as _narration2
                    _syms_key = ",".join(h["symbol"] for h in _holdings)
                    _ck2 = "news_correlation_v5:" + _hl2.sha256(
                        (_syms_key + "|" + "|".join(_headlines_for_corr)).encode()
                    ).hexdigest()[:20]
                    _corr_sys = (
                        "You are a portfolio impact analyst for a private investor. "
                        "The portfolio is mostly ETFs that track sectors and themes.\n\n"
                        "Write 3-5 sentences explaining how today's headlines affect this portfolio. "
                        "For each point, name the specific holding(s) affected and reference the "
                        "actual headline driving it — do not make up events. "
                        "Consider sector exposure: e.g. a tech selloff affects SMH/XLK/QQQM; "
                        "geopolitical news affects IDVO; oil moves affect broad equity ETFs; "
                        "rate/bond news affects income ETFs like SPYI/QQQI/QDVO; "
                        "crypto news affects BTCI.\n\n"
                        "Rules:\n"
                        "- Reference specific headlines and tickers, not vague generalities.\n"
                        "- If a headline has zero connection to any holding, skip it.\n"
                        "- Plain prose, no bullets, no markdown."
                    )
                    _holdings_txt = "\n".join(
                        f"{h['symbol']} ({h['weight_pct']}%)" for h in _holdings
                    )
                    _headlines_txt = "\n".join(
                        f"{i+1}. {h}" for i, h in enumerate(_headlines_for_corr)
                    )
                    _corr_payload = (
                        f"HOLDINGS:\n{_holdings_txt}\n\n"
                        f"TODAY'S HEADLINES:\n{_headlines_txt}"
                    )
                    _corr_res = _narration2.cached_narrate(
                        cache_key=_ck2,
                        system_prompt=_corr_sys,
                        user_payload=_corr_payload,
                        max_tokens=350,
                    )
                    _corr_raw = (_corr_res.get("narrative") or "").strip()
                    # Suppress section only when there is genuinely no content:
                    # check if every non-empty line is a NONE/no-match signal.
                    import re as _re
                    _lines = [l.strip() for l in _corr_raw.splitlines() if l.strip()]
                    _real = [l for l in _lines
                             if not _re.search(r'no relevant news|^none[:\s]', l, _re.I)]
                    news_correlations = _corr_raw if _real else None
                except Exception:
                    pass
            body = _json({
                "narrative":          narration.get("narrative", ""),
                "narrative_source":   narration.get("source", "template"),
                "narrative_cached":   narration.get("cached", False),
                "signals":            signals,
                "diffs":              diffs,
                "vs_yesterday":       vs_yesterday,
                "sentiment":          sentiment_snapshot,
                "sentiment_narrative": sentiment_narrative,
                "news_correlations":  news_correlations,
                "as_of":              today_ts,
            })
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == '/api/earnings':
            global _earnings_cache, _earnings_cache_ts
            try:
                import yfinance as yf
                import datetime as _dt

                now_ts = time.time()
                if _earnings_cache and (now_ts - _earnings_cache_ts) < _EARNINGS_CACHE_TTL:
                    body = _json({'earnings': _earnings_cache,
                                  'cached': True,
                                  'timestamp': _dt.datetime.now().isoformat()})
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', len(body))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    _EARN_META = {
                        'NVDA': {'name': 'NVIDIA',   'layer': 'ai'},
                        'AVGO': {'name': 'Broadcom', 'layer': 'networking'},
                        'MU':   {'name': 'Micron',   'layer': 'hbm'},
                        'TSM':  {'name': 'TSMC',     'layer': 'foundry'},
                        'ASML': {'name': 'ASML',     'layer': 'equipment'},
                    }
                    today = _dt.date.today()
                    # Last upcoming earnings date we ever saw per symbol, persisted
                    # across restarts. yfinance only returns FUTURE dates, so the
                    # morning after a print the calendar already shows next quarter
                    # — without this file days_until can never go negative and the
                    # POST_EARNINGS stabilization day never engages.
                    import os as _os
                    _seen_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'earnings_dates_seen.json')
                    try:
                        with open(_seen_path) as _sf:
                            _seen = json.load(_sf)
                    except Exception:
                        _seen = {}
                    results: dict = {}
                    for _sym, _meta in _EARN_META.items():
                        try:
                            _t = yf.Ticker(_sym)
                            _cal = _t.calendar  # dict or DataFrame depending on yfinance version
                            _next: _dt.date | None = None

                            if isinstance(_cal, dict):
                                _dates = _cal.get('Earnings Date', [])
                                if not hasattr(_dates, '__iter__'):
                                    _dates = [_dates]
                                for _d in _dates:
                                    if hasattr(_d, 'date'):
                                        _d = _d.date()
                                    elif isinstance(_d, str):
                                        try: _d = _dt.date.fromisoformat(_d[:10])
                                        except ValueError: continue
                                    elif isinstance(_d, _dt.datetime):
                                        _d = _d.date()
                                    if isinstance(_d, _dt.date) and _d >= today:
                                        _next = _d
                                        break
                            elif _cal is not None and hasattr(_cal, 'columns'):
                                # DataFrame: columns are date labels, rows are metric names
                                for _col in _cal.columns:
                                    try:
                                        _cd = _col.date() if hasattr(_col, 'date') else _dt.date.fromisoformat(str(_col)[:10])
                                        if _cd >= today:
                                            _next = _cd
                                            break
                                    except Exception:
                                        continue

                            # Post-earnings window: the previously-seen date just
                            # passed (yesterday, or Fri→Mon over a weekend) and no
                            # new event is imminent → report negative days_until at
                            # HIGH risk so the frontend shows the POST_EARNINGS
                            # stabilization session instead of instantly clearing.
                            _prev_date = None
                            try:
                                _prev_raw = _seen.get(_sym)
                                if _prev_raw:
                                    _prev_date = _dt.date.fromisoformat(_prev_raw)
                            except Exception:
                                _prev_date = None
                            if _next:
                                _seen[_sym] = _next.isoformat()

                            _post_days = None
                            if _prev_date and _prev_date < today:
                                _since = (today - _prev_date).days
                                if _since == 1 or (today.weekday() == 0 and _since <= 3):
                                    _post_days = -_since

                            if _post_days is not None and (_next is None or (_next - today).days > 3):
                                _days = _post_days
                                _risk = 'high'
                                _next_out = _prev_date
                            elif _next:
                                _days = (_next - today).days
                                # HIGH: today through +3 (3 days before); MEDIUM: 4-7 days before
                                _risk = 'high' if (0 <= _days <= 3) else 'medium' if (4 <= _days <= 7) else 'low'
                                _next_out = _next
                            else:
                                _days = None
                                _risk = 'unknown'
                                _next_out = None
                            results[_sym] = {
                                **_meta,
                                'next_earnings': _next_out.isoformat() if _next_out else None,
                                'days_until':    _days,
                                'risk':          _risk,
                            }
                        except Exception as _ee:
                            print(f"[earnings] {_sym} error: {_ee}")
                            results[_sym] = {**_meta, 'next_earnings': None, 'days_until': None, 'risk': 'unknown'}

                    try:
                        with open(_seen_path, 'w') as _sf:
                            json.dump(_seen, _sf)
                    except Exception as _se:
                        print(f"[earnings] could not persist seen dates: {_se}")

                    _earnings_cache = results
                    _earnings_cache_ts = now_ts
                    body = _json({'earnings': results, 'cached': False,
                                  'timestamp': _dt.datetime.now().isoformat()})
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', len(body))
                    self.end_headers()
                    self.wfile.write(body)
            except Exception as _ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(_ex)}).encode())

        elif self.path == '/api/data':
            with _pd._cache_lock:
                payload = _pd._cached_data
            if payload is None:
                # Include current progress so the frontend can show it inline
                with _pd._status_lock:
                    progress = {k: v for k, v in _pd._refresh_status.items()
                                if k != 'started_at'}
                if _DEBUG_REFRESH:
                    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] GET /api/data → 503 (data not ready)")
                body = json.dumps({"error": "Data not yet loaded. Please wait...",
                                   "progress": progress}).encode()
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            else:
                # Re-evaluate alerts on every request so triggered_alerts is
                # always fresh regardless of when the last auto-refresh ran.
                # Uses the already-cached snapshots — no extra network calls.
                try:
                    from price_alerts import check_alerts as _check_alerts
                    _fresh_triggered = _check_alerts(payload.get("snapshots", {}))
                    payload = {**payload, "triggered_alerts": _fresh_triggered}
                except Exception:
                    pass
                body = _json(payload)
                if _DEBUG_REFRESH:
                    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] GET /api/data → 200 ({len(body):,} bytes)")
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)

        elif self.path.startswith('/api/candlestick'):
            from urllib.parse import urlparse, parse_qs
            import yfinance as yf
            import numpy as np
            
            qs = parse_qs(urlparse(self.path).query)
            symbol = (qs.get("symbol", [""])[0] or "").strip().upper()
            if not symbol:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "symbol required"}).encode())
                return
            
            try:
                ticker = yf.Ticker(symbol)
                hist = ticker.history(period="3mo")
                if hist.empty:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "No data found"}).encode())
                    return
                
                # Format data
                dates = [d.strftime('%Y-%m-%d') for d in hist.index]
                closes = [round(c, 2) for c in hist['Close'].values]
                
                # OHLC for candlestick
                ohlc = []
                for i, (idx, row) in enumerate(hist.iterrows()):
                    ohlc.append([
                        dates[i],
                        round(row['Open'], 2),
                        round(row['High'], 2),
                        round(row['Low'], 2),
                        round(row['Close'], 2)
                    ])
                
                # Moving averages
                closes_array = np.array(closes)
                ma20 = []
                ma50 = []
                
                if len(closes_array) >= 20:
                    ma20_raw = np.convolve(closes_array, np.ones(20)/20, mode='valid')
                    ma20 = [None] * (len(dates) - len(ma20_raw)) + [round(x, 2) for x in ma20_raw]
                else:
                    ma20 = [None] * len(dates)
                
                if len(closes_array) >= 50:
                    ma50_raw = np.convolve(closes_array, np.ones(50)/50, mode='valid')
                    ma50 = [None] * (len(dates) - len(ma50_raw)) + [round(x, 2) for x in ma50_raw]
                else:
                    ma50 = [None] * len(dates)
                
                result = {
                    "symbol": symbol,
                    "dates": dates,
                    "ohlc": ohlc,
                    "closes": closes,
                    "ma20": ma20,
                    "ma50": ma50,
                    "currentPrice": closes[-1]
                }
                
                body = json.dumps(result).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
                
            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(ex)}).encode())        

        elif self.path == '/api/wellness':
            # GET: Financial Wellness Snapshot — lightweight MC + safe-spending run
            try:
                with _pd._cache_lock:
                    _portfolio = _pd._cached_data
                if _portfolio is None:
                    self.send_response(503)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "data not ready"}).encode())
                    return
                from simulation_engine import (
                    load_from_app_data, run_monte_carlo, find_safe_spending,
                )
                import json as _json_mod, os as _os
                state = load_from_app_data(_portfolio)

                # Read estimated_spending from personal.json via load_config()
                try:
                    import portfolio_data as _pd_cfg
                    _est_spend = float(_pd_cfg.load_config().get("_PERSONAL", {}).get("estimated_spending", 0) or 0)
                except Exception:
                    _est_spend = 0.0
                estimated_spending = _est_spend if _est_spend > 0 else state.annual_spending

                # Run MC (500 sims — fast, ~100 ms) and safe-spending grid
                mc   = run_monte_carlo(state, n_sims=500, seed=42)
                safe = find_safe_spending(state, seed=42)

                ia            = (_portfolio or {}).get("income_analytics", {})
                portfolio_income = float((ia.get("portfolio_fwd_12m") or 0))
                net_worth     = state.total_portfolio

                success_100  = mc["success_rates"].get(100, mc.get("overall_success", 0))
                success_95   = mc["success_rates"].get(95,  mc.get("overall_success", 0))

                # Projected wealth at age 95: find that year in the ages list
                proj_95 = None
                if mc.get("ages") and mc.get("percentiles"):
                    ages = mc["ages"]
                    if 95 in ages:
                        idx = ages.index(95)
                        proj_95 = mc["percentiles"]["50"][idx]

                income_coverage = (portfolio_income / estimated_spending * 100) if estimated_spending > 0 else None
                withdrawal_rate = (estimated_spending / net_worth) if net_worth > 0 else None
                cashflow_surplus = portfolio_income - estimated_spending
                buffer_years    = (net_worth / estimated_spending) if estimated_spending > 0 else None

                result = {
                    "net_worth":            round(net_worth),
                    "portfolio_income":     round(portfolio_income),
                    "estimated_spending":   round(estimated_spending),
                    "income_coverage_pct":  round(income_coverage, 1) if income_coverage is not None else None,
                    "withdrawal_rate":      round(withdrawal_rate, 4) if withdrawal_rate is not None else None,
                    "buffer_years":         round(buffer_years, 1) if buffer_years is not None else None,
                    "success_prob_95":      round(success_95, 4),
                    "success_prob_100":     round(success_100, 4),
                    "overall_success":      round(mc["overall_success"], 4),
                    "projected_95_median":  round(proj_95) if proj_95 is not None else None,
                    "median_ending":        round(mc["median_ending"]),
                    "seq_risk_pct":         round(mc.get("sequence_risk_pct", 0), 4),
                    "seq_risk_penalty":     round(mc.get("sequence_risk_penalty", 0)),
                    "safe_spending":        round(safe["thresholds"]["safe"]["spending"]),
                    "safe_spending_prob":   safe["thresholds"]["safe"]["prob"],
                    "comfortable_spending": round(safe["thresholds"]["comfortable"]["spending"]),
                    "cashflow_surplus":     round(cashflow_surplus),
                    "ruin_threshold":       round(state.ruin_threshold),
                    "current_age":          state.current_age,
                    "ss_start_age":         state.ss_start_age,
                    "ss_annual":            round(state.ss_annual),
                    "target_age":           state.target_age,
                }
                body = _json(result)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            except Exception as ex:
                traceback.print_exc()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(ex)}).encode())

        elif self.path.startswith('/api/balance-history'):
            # GET /api/balance-history?days=30&start=YYYY-MM-DD&end=YYYY-MM-DD
            # Returns open/close portfolio snapshots for charting and history views.
            # NOTE: uses _bal_dbm alias — other handlers in do_GET assign `_dbm`
            # locally which would make Python treat the module-level _dbm as unbound.
            try:
                import db_manager as _bal_dbm
                from urllib.parse import urlparse, parse_qs
                _qs    = parse_qs(urlparse(self.path).query)
                _start = (_qs.get('start') or [None])[0]
                _end   = (_qs.get('end')   or [None])[0]
                _days  = int((_qs.get('days') or ['60'])[0])
                if _start and _end:
                    _rows = _bal_dbm.balance_snapshots_range(_start, _end)
                else:
                    _rows = _bal_dbm.balance_snapshots_get(min(_days, 365))
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(_rows).encode())
            except Exception as _bhe:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(_bhe)}).encode())

        elif self.path == '/api/settings':
            # GET: return all editable config files
            import os as _os
            _sdir = _os.path.dirname(_os.path.abspath(__file__))
            _cfg_files = {
                "account_mapping":  "account_mapping.json",
                "target_roth":      "target_roth.json",
                "target_taxable":   "target_taxable.json",
                "ai_keys":          "ai_keys.json",
                "personal_json":    "personal.json",
                "tax_brackets_json": "tax_brackets.json",
                "retirement_engine_json": "retirement_engine.json",
            }
            _out = {}
            for _key, _fname in _cfg_files.items():
                _fpath = _os.path.join(_sdir, _fname)
                try:
                    with open(_fpath) as _f:
                        _out[_key] = json.load(_f)
                except FileNotFoundError:
                    _out[_key] = {}
                except Exception as _e:
                    _out[_key] = {"_error": str(_e)}
            # schwab_cost and price_alerts served from SQLite
            import db_manager as _dbm
            _out["schwab_cost"]  = _dbm.lots_get_for_editor()
            _out["price_alerts"] = _dbm.alerts_as_json_dict()
            body = _json(_out)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path.startswith('/api/simulate'):
            # GET: return current portfolio state defaults for the UI to pre-fill
            with _pd._cache_lock:
                _portfolio = _pd._cached_data
            from simulation_engine import load_from_app_data
            state = load_from_app_data(_portfolio)
            body = _json(state.to_dict())
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == '/api/alerts':
            from price_alerts import get_alerts as _get_alerts
            body = _json({"alerts": _get_alerts()})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path.startswith('/api/ai'):
            from dash_tab_ai import handle_ai_request
            if self.command == 'GET':
                result = handle_ai_request(self.path, 'GET')
            elif self.command == 'POST':
                body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                data = json.loads(body) if body else {}
                result = handle_ai_request(self.path, 'POST', data)
            else:
                result = None
            if result is not None:
                body = _json(result)
                self.send_response(200 if result.get('success', True) else 400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(404)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_PUT(self):
        if self.path.startswith('/api/alerts/'):
            # PUT /api/alerts/:id — update threshold/direction/mode/active
            import re as _re
            _m = _re.match(r'^/api/alerts/([^/]+)$', self.path)
            if _m:
                _aid = _m.group(1)
                try:
                    _body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                    _req  = json.loads(_body) if _body else {}
                    from price_alerts import update_alert as _upd
                    _updated = _upd(_aid, **{k: v for k, v in _req.items()
                                             if k in ('direction','mode','threshold','notes','active','base_price')})
                    if _updated:
                        body = _json(_updated)
                        self.send_response(200)
                    else:
                        body = _json({"error": "not found"})
                        self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', len(body))
                    self.end_headers()
                    self.wfile.write(body)
                except Exception as ex:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': str(ex)}).encode())
            return
        if self.path.startswith('/api/sim/'):
            from routes_sim import handle as _sim
            try:
                if not _sim(self):
                    self.send_response(404); self.end_headers()
            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(ex)}).encode())

    def do_PATCH(self):
        if self.path.startswith('/api/sim/'):
            from routes_sim import handle as _sim
            try:
                if not _sim(self):
                    self.send_response(404); self.end_headers()
            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(ex)}).encode())

    def do_DELETE(self):
        if self.path.startswith('/api/alerts/'):
            import re as _re
            _m = _re.match(r'^/api/alerts/([^/]+)$', self.path)
            if _m:
                _aid = _m.group(1)
                from price_alerts import delete_alert as _del
                _ok = _del(_aid)
                body = _json({"success": _ok})
                self.send_response(200 if _ok else 404)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            return
        if self.path.startswith('/api/sim/'):
            from routes_sim import handle as _sim
            try:
                if not _sim(self):
                    self.send_response(404); self.end_headers()
            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(ex)}).encode())

    def do_POST(self):

        # ── Balance snapshot: capture now ────────────────────────────────────────
        if self.path == '/api/balance-history/capture':
            # POST — record current portfolio value as close/manual, and also
            # back-fill today's open (shares × yfinance session-open prices) if
            # the open snapshot is missing.  One button always fills both.
            try:
                import db_manager as _cap_dbm
                import pytz as _pytz
                import yfinance as _cap_yf
                from datetime import datetime as _dt2, timedelta as _cap_td
                _cached = _pd._cached_data or {}
                _val = (_cached.get('summary') or {}).get('total_value', 0.0)
                if not _val:
                    self.send_response(503)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'portfolio data not loaded yet'}).encode())
                    return
                _et    = _dt2.now(_pytz.timezone('US/Eastern'))
                _date  = _et.strftime('%Y-%m-%d')
                _mins  = _et.hour * 60 + _et.minute
                # Label based on ET time of day:
                #   open    — 9:30–9:44  (first 15 min of session)
                #   close   — 16:00 onwards on a weekday (Schwab shows official close prices)
                #   manual  — intraday (9:45–15:59), or weekend
                _is_weekday = _et.weekday() < 5
                if 9*60+30 <= _mins < 9*60+45:
                    _label = 'open'
                elif _mins >= 16*60 and _is_weekday:
                    _label = 'close'
                else:
                    _label = 'manual'
                _acct_bk: dict = {}
                for _a in (_cached.get('accounts') or []):
                    _k = _a.get('key') or _a.get('label', 'unknown')
                    _v = float(_a.get('value') or 0)
                    if _k and _v > 0:
                        _acct_bk[_k] = round(_v, 2)

                # ── Record current value (close / manual / open) ──────────
                # For close (after 16:00 ET): fetch today's session H/L from
                # yfinance so the row is fully populated in one button press.
                _cap_sh: float | None = None
                _cap_sl: float | None = None
                if _label == 'close' and _is_weekday:
                    _cap_sh, _cap_sl = _fetch_session_hl(_date, _cached)
                _cap_dbm.balance_snapshot_record(
                    _date, _label, _val, _acct_bk or None,
                    session_high=_cap_sh, session_low=_cap_sl,
                )
                _captured = [{'label': _label, 'total_value': round(_val, 2),
                               'session_high': _cap_sh, 'session_low': _cap_sl}]

                # ── Back-fill today's open if missing ─────────────────────
                # Always attempt on a weekday when the session has started
                # (9:30 ET or later). Uses yfinance session-open prices × current
                # share counts so the open is reconstructed even if the server
                # wasn't running at 9:30 ET.
                _open_inserted = False
                if _is_weekday and _mins >= 9*60+30 and _label != 'open':
                    _existing = _cap_dbm.balance_snapshots_get(3)
                    _has_open_today = any(
                        r['date'] == _date and r['label'] == 'open' for r in _existing
                    )
                    if not _has_open_today:
                        try:
                            _MONEY_MKT = {'CASH', 'SWVXX', 'VMFXX', 'SPAXX'}
                            _oa: dict[str, dict] = {}   # acct → {sym: shares, '_cash': $}
                            _pm: dict[str, float] = {}  # sym  → total shares (equity)
                            for _a2 in (_cached.get('accounts') or []):
                                _ak = _a2.get('key') or _a2.get('label', 'unknown')
                                _oa[_ak] = {'_cash': 0.0}
                                for _p2 in (_a2.get('positions') or []):
                                    _s2    = _p2.get('symbol', '')
                                    _sh2   = float(_p2.get('shares', 0) or 0)
                                    _v2    = float(_p2.get('value',  0) or 0)
                                    if not _s2: continue
                                    if (_p2.get('is_money_market') or
                                            _p2.get('fund_type') == 'MONEY_MARKET' or
                                            _s2 in _MONEY_MKT):
                                        _oa[_ak]['_cash'] += _v2
                                    elif _sh2 > 0:
                                        _oa[_ak][_s2] = _oa[_ak].get(_s2, 0.0) + _sh2
                                        _pm[_s2] = _pm.get(_s2, 0.0) + _sh2
                            if _pm:
                                _yf_end   = (_et + _cap_td(days=1)).strftime('%Y-%m-%d')
                                _hist_raw = _cap_yf.download(
                                    list(_pm.keys()), start=_date, end=_yf_end,
                                    auto_adjust=True, progress=False
                                )
                                def _extract_prices(col_name):
                                    _out: dict[str, float] = {}
                                    if not _hist_raw.empty and col_name in _hist_raw.columns:
                                        _df = _hist_raw[col_name]
                                        for _sx in _pm:
                                            _cx = _df[_sx] if _sx in _df.columns else None
                                            if _cx is not None and len(_cx) > 0:
                                                _px = float(_cx.iloc[0])
                                                if _px > 0:
                                                    _out[_sx] = _px
                                    return _out
                                _op  = _extract_prices('Open')
                                _hi  = _extract_prices('High')
                                _lo  = _extract_prices('Low')

                                def _port_value(prices):
                                    """Return (total, acct_bk) or (None, None) if any price missing."""
                                    _bk: dict[str, float] = {}
                                    _tot = 0.0
                                    for _ak2, _ap2 in _oa.items():
                                        _av2 = _ap2.get('_cash', 0.0)
                                        for _s4, _sh4 in _ap2.items():
                                            if _s4 == '_cash': continue
                                            _p4 = prices.get(_s4)
                                            if _p4 is None:
                                                return None, None
                                            _av2 += _sh4 * _p4
                                        _bk[_ak2] = round(_av2, 2)
                                        _tot += _av2
                                    return (round(_tot, 2), _bk) if _tot > 0 else (None, None)

                                _open_total, _oa_bk = _port_value(_op)
                                _high_total, _      = _port_value(_hi) if _hi else (None, None)
                                _low_total,  _      = _port_value(_lo) if _lo else (None, None)

                                if _open_total and _oa_bk:
                                    _cap_dbm.balance_snapshot_record(
                                        _date, 'open', _open_total, _oa_bk,
                                        session_high=_high_total,
                                        session_low=_low_total,
                                    )
                                    _captured.append({'label': 'open', 'total_value': _open_total,
                                                      'session_high': _high_total, 'session_low': _low_total})
                                    _open_inserted = True
                                    print(f"[balance] ✓ Open backfilled  {_date}  ${_open_total:,.0f}"
                                          + (f"  H=${_high_total:,.0f}" if _high_total else "")
                                          + (f"  L=${_low_total:,.0f}"  if _low_total  else ""))
                        except Exception as _oe:
                            print(f"[balance] open backfill failed: {_oe}")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'status': 'ok', 'date': _date,
                    'captured': _captured,
                    'open_backfilled': _open_inserted,
                }).encode())
                if _DEBUG_REFRESH:
                    print(f"[balance] ✓ Manual capture  {_date}  {_label}  ${_val:,.0f}"
                          + (f"  + open backfilled" if _open_inserted else ""))
            except Exception as _ce:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(_ce)}).encode())
            return

        # ── Balance snapshot: backfill from yfinance ─────────────────────────────
        if self.path == '/api/balance-history/backfill':
            # POST body: {"days": 30}
            # Reconstructs approximate past portfolio values using current share counts
            # × historical daily close prices from yfinance.
            # LIMITATION: assumes position sizes were the same on past dates.
            # Cash / SWVXX positions are included at face value (no price history needed).
            try:
                import db_manager as _bf_dbm
                import yfinance as _yf
                import pytz as _bftz
                from datetime import datetime as _bfdt, timedelta as _bftd
                _body = self.rfile.read(int(self.headers.get('Content-Length', 0) or 0))
                _req  = json.loads(_body) if _body else {}
                _days_back = min(int(_req.get('days', 30)), 365)

                # Gather positions per account for sleeve-level breakdown
                _cached = _pd._cached_data or {}
                # acct_data: {acct_key: {sym: shares, '_cash': cash_face_value}}
                _acct_data: dict[str, dict] = {}
                _pos_map: dict[str, float] = {}   # symbol → total shares (all accounts)
                for _acct in (_cached.get('accounts') or []):
                    _akey = _acct.get('key') or _acct.get('label', 'unknown')
                    _acct_data[_akey] = {'_cash': 0.0}
                    for _pos in (_acct.get('positions') or []):
                        _sym    = _pos.get('symbol', '')
                        _shares = float(_pos.get('shares', 0) or 0)
                        _val2   = float(_pos.get('value',  0) or 0)
                        if not _sym:
                            continue
                        if _pos.get('is_money_market') or _pos.get('fund_type') == 'MONEY_MARKET' or _sym == 'CASH':
                            _acct_data[_akey]['_cash'] = _acct_data[_akey].get('_cash', 0) + _val2
                        elif _shares > 0:
                            _acct_data[_akey][_sym] = _acct_data[_akey].get(_sym, 0.0) + _shares
                            _pos_map[_sym] = _pos_map.get(_sym, 0) + _shares

                if not _pos_map and all(v.get('_cash', 0) == 0 for v in _acct_data.values()):
                    raise ValueError('no positions found in cached data')

                # Fetch price history for all equity symbols.
                # yfinance end= is exclusive, so pass tomorrow to include today's OHLC.
                _et_now  = _bfdt.now(_bftz.timezone('US/Eastern'))
                _end_dt  = _et_now.strftime('%Y-%m-%d')           # used as loop filter
                _yf_end  = (_et_now + _bftd(days=1)).strftime('%Y-%m-%d')  # inclusive today
                _start_dt= (_et_now - _bftd(days=_days_back + 10)).strftime('%Y-%m-%d')
                _syms    = list(_pos_map.keys())

                # Fetch full OHLC — Open, High, Low, Close all in one download
                _hist_close: dict[str, dict[str, float]] = {}
                _hist_open:  dict[str, dict[str, float]] = {}
                _hist_high:  dict[str, dict[str, float]] = {}
                _hist_low:   dict[str, dict[str, float]] = {}
                if _syms:
                    try:
                        _tickers = _yf.download(
                            _syms, start=_start_dt, end=_yf_end,
                            auto_adjust=True, progress=False
                        )
                        for _price_col, _store in [
                            ('Close', _hist_close), ('Open', _hist_open),
                            ('High',  _hist_high),  ('Low',  _hist_low),
                        ]:
                            _df = _tickers[_price_col] if _price_col in _tickers.columns else None
                            if _df is None:
                                continue
                            for _sym in _syms:
                                _col = _df[_sym] if _sym in _df.columns else None
                                if _col is not None:
                                    _store[_sym] = {
                                        str(idx.date()): float(val)
                                        for idx, val in _col.items()
                                        if val is not None and not (isinstance(val, float) and val != val)
                                    }
                    except Exception as _yfe:
                        if _DEBUG_REFRESH: print(f"[backfill] yfinance error: {_yfe}")

                def _compute_port(hist_prices, acct_data, cash_only=False):
                    """Return (total, acct_breakdown) or None if prices incomplete."""
                    _acct_bk: dict[str, float] = {}
                    _total = 0.0
                    for _ak, _ap in acct_data.items():
                        _av = _ap.get('_cash', 0.0)
                        for _s, _sh in _ap.items():
                            if _s == '_cash':
                                continue
                            _p = (hist_prices.get(_s) or {}).get(_date2)
                            if _p is None:
                                return None
                            _av += _sh * _p
                        _acct_bk[_ak] = round(_av, 2)
                        _total += _av
                    return (_total, _acct_bk) if _total > 0 else None

                # Existing snapshots — track date → row so we can update missing H/L
                _existing_rows = _bf_dbm.balance_snapshots_get(_days_back + 30)
                _close_rows = {r['date']: r for r in _existing_rows if r['label'] in ('close', 'manual')}
                _has_open   = {r['date'] for r in _existing_rows if r['label'] == 'open'}

                _inserted = 0
                _updated  = 0
                _skipped  = 0
                _all_dates: set[str] = set()
                for _prices in list(_hist_close.values()) + list(_hist_open.values()):
                    _all_dates.update(_prices.keys())
                # Only add "today" if it's actually a trading day — yfinance's own
                # date keys already exclude weekends/holidays, but this explicit
                # add bypassed that when the endpoint is called on a non-trading day.
                if market_calendar.is_trading_day(_et_now.strftime('%Y-%m-%d')):
                    _all_dates.add(_et_now.strftime('%Y-%m-%d'))

                for _date2 in sorted(_all_dates):
                    if _date2 > _end_dt:
                        continue

                    # Portfolio High/Low from yfinance OHLC
                    _res_h = _compute_port(_hist_high, _acct_data) if _hist_high else None
                    _res_l = _compute_port(_hist_low,  _acct_data) if _hist_low  else None

                    # ── Close snapshot ──────────────────────────────────────
                    _existing_close = _close_rows.get(_date2)
                    if _existing_close is None:
                        # New date — insert full row
                        _res = _compute_port(_hist_close, _acct_data)
                        if _res:
                            _bf_dbm.balance_snapshot_record(
                                _date2, 'close', _res[0], _res[1],
                                session_high=_res_h[0] if _res_h else None,
                                session_low =_res_l[0] if _res_l else None,
                            )
                            _inserted += 1
                        else:
                            _skipped += 1
                    elif _existing_close.get('session_high') is None and (_res_h or _res_l):
                        # Existing row missing H/L — patch it in via INSERT OR REPLACE
                        # Preserve the original total_value and accounts
                        _bf_dbm.balance_snapshot_record(
                            _date2,
                            _existing_close['label'],
                            _existing_close['total_value'],
                            _existing_close.get('accounts') or None,
                            session_high=_res_h[0] if _res_h else None,
                            session_low =_res_l[0] if _res_l else None,
                        )
                        _updated += 1
                    else:
                        _skipped += 1

                    # ── Open snapshot ───────────────────────────────────────
                    if _date2 not in _has_open and _hist_open:
                        _res = _compute_port(_hist_open, _acct_data)
                        if _res:
                            _bf_dbm.balance_snapshot_record(_date2, 'open', _res[0], _res[1])
                            _inserted += 1

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'status': 'ok',
                    'inserted': _inserted,
                    'updated_hl': _updated,
                    'skipped': _skipped,
                    'symbols': len(_syms),
                    'note': 'Approximate — assumes current share counts unchanged for past dates',
                }).encode())
                if _DEBUG_REFRESH: print(f"[backfill] ✓ {_inserted} inserted, {_updated} updated with H/L, {_skipped} skipped")
            except Exception as _bfe:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(_bfe)}).encode())
                if _DEBUG_REFRESH: print(f"[backfill] ✗ {_bfe}")
            return

        # Trade Simulation routes
        if self.path.startswith('/api/sim/'):
            from routes_sim import handle as _sim
            try:
                if not _sim(self):
                    self.send_response(404); self.end_headers()
            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(ex)}).encode())
            return
        if self.path == '/api/whatif/narrate':
            # POST /api/whatif/narrate — narrate a sandbox/simulation delta.
            # Body is the full sandbox result dict (must include `delta`).
            try:
                _body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                sandbox_result = json.loads(_body) if _body else {}
                import whatif_narrate
                payload = whatif_narrate.narrate(sandbox_result)
            except Exception as e:
                if _DEBUG_REFRESH:
                    print(f"[POST /api/whatif/narrate] failed: {e}")
                payload = {"narrative": "", "source": "error", "cached": False}
            body = _json(payload)
            self.send_response(200 if payload.get("source") != "error" else 400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path == '/api/alerts':
            # POST /api/alerts — create a new price alert
            try:
                _body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                _req  = json.loads(_body) if _body else {}
                from price_alerts import create_alert as _create
                _alert = _create(
                    symbol    = _req.get('symbol', ''),
                    direction = _req.get('direction', 'above'),
                    mode      = _req.get('mode', 'price'),
                    threshold = float(_req.get('threshold', 0)),
                    base_price= float(_req.get('base_price', 0)),
                    notes     = _req.get('notes', ''),
                )
                body = _json(_alert)
                self.send_response(201)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            except Exception as ex:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(ex)}).encode())
            return

        if self.path.startswith('/api/alerts/') and self.path.endswith('/dismiss'):
            # POST /api/alerts/:id/dismiss
            import re as _re
            _m = _re.match(r'^/api/alerts/([^/]+)/dismiss$', self.path)
            if _m:
                _aid = _m.group(1)
                from price_alerts import dismiss_alert as _dismiss
                _updated = _dismiss(_aid)
                body = _json(_updated or {"error": "not found"})
                self.send_response(200 if _updated else 404)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            return

        if self.path.startswith('/api/ai'):
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            data = json.loads(body) if body else {}
            from dash_tab_ai import handle_ai_request
            result = handle_ai_request(self.path, 'POST', data)
            if result is None:
                self.send_response(404); self.end_headers(); return
            body = _json(result)
            self.send_response(200 if result.get('success', True) else 400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == '/api/simulate':
            # POST: run a simulation module
            try:
                body_bytes = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                req = json.loads(body_bytes) if body_bytes else {}
                module   = req.get('module', 'monte_carlo')
                overrides = req.get('params', {})

                with _pd._cache_lock:
                    _portfolio = _pd._cached_data

                from simulation_engine import (
                    load_from_app_data,
                    run_monte_carlo, run_sequence_stress,
                    run_withdrawal_comparison, find_safe_spending, run_sandbox,
                )
                state = load_from_app_data(_portfolio, overrides)

                if module == 'monte_carlo':
                    result = run_monte_carlo(state)
                elif module == 'sequence_risk':
                    result = run_sequence_stress(state)
                elif module == 'withdrawal':
                    result = run_withdrawal_comparison(state)
                elif module == 'spending_range':
                    result = find_safe_spending(state)
                elif module == 'sandbox':
                    sandbox_overrides = req.get('sandbox_overrides', {})
                    result = run_sandbox(state, sandbox_overrides)
                else:
                    result = {"error": f"Unknown module: {module}"}

                body = _json(result)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            except Exception as ex:
                traceback.print_exc()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(ex)}).encode())

        elif self.path == '/api/refresh':
            import time

            if _DEBUG_REFRESH:
                print(f"{'='*60}")
                print(f"[refresh] {datetime.now().strftime('%H:%M:%S')} Manual refresh triggered")
                print(f"{'='*60}")

            # Reset progress status so the frontend sees a fresh loading sequence
            _pd._update_status("loading", "Starting refresh…", 2)

            # ── Step 1: Clear all internal caches ─────────────────────────
            with _pd._cache_lock:
                _pd._cached_data = None
                _pd._last_refresh = None
                _pd._refreshing = False
            
            _pd._div_metrics_cache = {}
            _pd._div_metrics_ts = 0.0
            if _DEBUG_REFRESH:
                print("[refresh] ✓ Cleared portfolio_data caches")
            
            # ── Step 1b: Wipe DB positions snapshot + stale Schwab caches ──
            # After an account remap the old schwab:positions_{old_key} and
            # schwab:account_hashes entries survive in cache_kv and can be
            # served as stale fallback data, causing multiplied values.
            # Nuking them here forces a clean re-fetch from Schwab.
            try:
                _dbm.snapshot_clear()
                n_pos  = _dbm.cache_delete_prefix("schwab:positions_")
                _dbm.cache_delete("schwab:account_hashes")
                if _DEBUG_REFRESH:
                    print(f"[refresh] ✓ Cleared positions_snapshot, "
                          f"{n_pos} schwab:positions_* cache(s), and account_hashes")
            except Exception as e:
                if _DEBUG_REFRESH:
                    print(f"[refresh] ⚠ DB snapshot/cache clear: {e}")

            # ── Step 2: Clear schwab_client's session-level caches ────────
            # Was importlib.reload(schwab_client) — that also nuked the
            # cached authenticated client, and with multiple background
            # loops able to trigger this concurrently, racing token
            # refreshes against Schwab's rotating refresh token made a
            # perfectly valid token look expired. clear_caches() drops the
            # stale data caches without touching the client.
            try:
                import schwab_client
                schwab_client.clear_caches()
                if _DEBUG_REFRESH:
                    print("[refresh] ✓ Cleared schwab_client caches")
            except Exception as e:
                if _DEBUG_REFRESH:
                    print(f"[refresh] ⚠ schwab_client cache clear: {e}")

            # ── Step 2b: Clear realized-gains disk cache ─────────────────
            # The SQLite cache_kv entry survives module reloads; delete the
            # today-keyed entry so the next fetch recomputes from Schwab.
            try:
                import db_manager as _dbm
                from datetime import date as _date
                _rg_key = f"schwab:realized_gains_v13_{_date.today().isoformat()}"
                _dbm.cache_delete(_rg_key)
            except Exception:
                pass
            
            # ── Step 3: Clear data_fetcher's SPY cache ───────────────────
            try:
                import data_fetcher as df
                df._SPY_HIST = None
                if _DEBUG_REFRESH:
                    print("[refresh] ✓ Cleared data_fetcher SPY history cache")
            except Exception as e:
                if _DEBUG_REFRESH:
                    print(f"[refresh] ⚠ data_fetcher cache: {e}")
            
            # ── Step 4: Clear yfinance's internal cache ──────────────────
            try:
                import yfinance as yf
                if hasattr(yf, '_tkr_map'):
                    yf._tkr_map.clear()
                    if _DEBUG_REFRESH:
                        print("[refresh] ✓ Cleared yfinance ticker map cache")
            except Exception:
                pass
            
            # ── Step 5: Force garbage collection ─────────────────────────
            try:
                import gc
                gc.collect()
            except Exception:
                pass
            
            # ── Step 6: Fetch fresh data ─────────────────────────────────
            try:
                start_time = time.time()
                if _DEBUG_REFRESH:
                    print("[refresh] ⏳ Calling fetch_all_data()...")
                
                new_data = fetch_all_data()
                
                elapsed = time.time() - start_time
                
                if _DEBUG_REFRESH:
                    schwab_status = new_data.get('schwab_status', 'unknown')
                    print(f"[refresh] ✓ Completed in {elapsed:.1f}s")
                    print(f"[refresh]   Timestamp:     {new_data.get('timestamp', 'unknown')}")
                    print(f"[refresh]   Schwab status: {schwab_status}")
                    print(f"[refresh]   Accounts:      {len(new_data.get('accounts', []))}")
                    print(f"[refresh]   Snapshots:     {len(new_data.get('snapshots', {}))}")
                    if schwab_status != 'live':
                        print(f"[refresh] ⚠ WARNING: status is '{schwab_status}', NOT 'live'!")
                    print(f"[refresh] ✓ Server cache updated")
                    print(f"{'='*60}")
                else:
                    # Quiet mode: one-line summary
                    print(f"[refresh] Completed in {elapsed:.1f}s | "
                          f"Schwab: {new_data.get('schwab_status', '?')} | "
                          f"{len(new_data.get('snapshots', {}))} snapshots")
                
                # Update cache
                with _pd._cache_lock:
                    _pd._cached_data = new_data
                    _pd._last_refresh = new_data["timestamp"]
                
                # Return fresh data to frontend
                body = _json(new_data)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
                
            except Exception as ex:
                print(f"[refresh] ✗ ERROR: {ex}")
                traceback.print_exc()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(ex)}).encode())

        elif self.path == '/api/settings':
            # POST: save a single config file (with automatic backup)
            import os as _os, shutil as _shutil
            _sdir = _os.path.dirname(_os.path.abspath(__file__))
            # File-backed config (gets a .bak_TS backup before each overwrite)
            _ALLOWED = {
                "account_mapping":  "account_mapping.json",
                "target_roth":      "target_roth.json",
                "target_taxable":   "target_taxable.json",
                "ai_keys":          "ai_keys.json",
                "personal_json":    "personal.json",
                "tax_brackets_json": "tax_brackets.json",
                "retirement_engine_json": "retirement_engine.json",
            }
            try:
                _body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                _req  = json.loads(_body) if _body else {}
                _key  = _req.get("file", "")
                _content = _req.get("content")
                if _key not in _ALLOWED and _key != "schwab_cost":
                    raise ValueError(f"Unknown config file: {_key!r}")
                if _content is None:
                    raise ValueError("Missing 'content' in request body")
                # schwab_cost is DB-backed (lots table) — no file write at all
                if _key == "schwab_cost":
                    import db_manager as _dbm
                    n = _dbm.lots_replace_from_dict(_content, source_label="POST /api/settings")
                    _resp = {"success": True, "lots_written": n}
                    body = json.dumps(_resp).encode()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', len(body))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                _fpath = _os.path.join(_sdir, _ALLOWED[_key])
                # Backup before overwrite
                _backup = None
                if _os.path.exists(_fpath):
                    from datetime import datetime as _dt
                    _ts = _dt.now().strftime("%Y%m%d_%H%M%S")
                    _backup = _fpath + f".bak_{_ts}"
                    _shutil.copy2(_fpath, _backup)
                with open(_fpath, "w", encoding="utf-8") as _f:
                    json.dump(_content, _f, indent=2, ensure_ascii=False)
                _resp = {"success": True, "file": _ALLOWED[_key]}
                if _backup:
                    _resp["backup"] = _os.path.basename(_backup)
                body = json.dumps(_resp).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.end_headers()
                self.wfile.write(body)
            except Exception as ex:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(ex)}).encode())

    def log_message(self, format, *args):
        # Suppress per-request logging noise
        pass


class ThreadedHTTPServer(HTTPServer):
    """Handle requests on a small pool of supervised, long-lived worker threads.

    db_manager caches one sqlite connection per thread (threading.local), never
    explicitly closed. Spawning a fresh thread per request — as this used to do —
    meant every DB-touching request permanently leaked a handful of fds (main db
    + WAL + SHM) since the thread (and its cached connection) was discarded right
    after. That leak eventually exhausted the process's fd limit (macOS defaults
    to a soft limit of 256 per process), which surfaced as "Too many open files"
    on config loads and the vite proxy seeing socket hang up / ECONNRESET once the
    server could no longer accept() new connections. A fixed pool of persistent
    workers reuses the same threads (and their cached connections) across requests
    instead of leaking one per request.

    The pool is supervised because a fixed pool has the opposite failure mode: a
    worker that dies is never replaced. Only finish_request() used to be guarded,
    so an exception raised *by* handle_error() (it writes a traceback to stderr —
    BrokenPipeError once the launching terminal is gone) or by shutdown_request()
    escaped _worker_loop and ended that thread for good. The pool decayed
    16 -> 15 -> ... -> 0 and the server went silently deaf: process alive, :8501
    still bound, every request queued forever. Same failure class already fixed
    once for _auto_refresh_loop. Now each worker decrements a live count on exit
    and a supervisor respawns it within seconds.

    The queue is bounded for the same reason: an unbounded queue let the acceptor
    keep swallowing connections that would never be answered, so saturation was
    invisible until clients timed out. Overflow now gets an immediate 503.
    """
    _POOL_SIZE = 16
    _QUEUE_LIMIT = 64
    _SUPERVISE_INTERVAL = 5

    def handle_error(self, request, client_address):
        """Quiet the traceback dump for a client disconnecting mid-response.

        A browser tab closing or navigating away while a worker is still
        writing a response is normal and frequent, not a bug — the default
        BaseServer.handle_error() prints a full traceback for it every time,
        drowning out real errors in dashboard.log. Only these expected
        disconnect exceptions are quieted; anything else still gets the full
        traceback.
        """
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            print(f"[http] client {client_address} disconnected mid-response", file=sys.stderr)
            return
        super().handle_error(request, client_address)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._request_queue = queue.Queue(maxsize=self._QUEUE_LIMIT)
        self._worker_lock = threading.Lock()
        self._live_workers = 0
        self._workers_respawned = 0
        self._requests_shed = 0
        for _ in range(self._POOL_SIZE):
            self._spawn_worker()
        threading.Thread(target=self._supervisor_loop, daemon=True,
                         name="worker-supervisor").start()

    # ── worker lifecycle ─────────────────────────────────────────────────────
    def _spawn_worker(self) -> None:
        with self._worker_lock:
            self._live_workers += 1
        threading.Thread(target=self._worker_loop, daemon=True,
                         name="http-worker").start()

    def _supervisor_loop(self) -> None:
        """Restore the pool to _POOL_SIZE whenever a worker exits."""
        while True:
            time.sleep(self._SUPERVISE_INTERVAL)
            try:
                with self._worker_lock:
                    missing = self._POOL_SIZE - self._live_workers
                for _ in range(max(0, missing)):
                    self._workers_respawned += 1
                    try:
                        print("[http] worker exited — respawning "
                              f"(total respawns: {self._workers_respawned})",
                              file=sys.stderr, flush=True)
                    except Exception:
                        pass
                    self._spawn_worker()
            except Exception:
                try:
                    traceback.print_exc()
                except Exception:
                    pass

    def _worker_loop(self) -> None:
        try:
            while True:
                request, client_address = self._request_queue.get()
                try:
                    self.finish_request(request, client_address)
                except Exception:
                    # handle_error() writes to stderr and can itself raise once
                    # the launching terminal is gone — never let it kill the
                    # worker.
                    try:
                        self.handle_error(request, client_address)
                    except Exception:
                        pass
                finally:
                    try:
                        self.shutdown_request(request)
                    except Exception:
                        pass
        except BaseException:
            try:
                traceback.print_exc()
            except Exception:
                pass
        finally:
            with self._worker_lock:
                self._live_workers -= 1

    # ── request intake ───────────────────────────────────────────────────────
    def process_request(self, request, client_address):
        try:
            self._request_queue.put_nowait((request, client_address))
        except queue.Full:
            self._requests_shed += 1
            try:
                print(f"[http] request queue full ({self._QUEUE_LIMIT}) — "
                      f"shedding request from {client_address}",
                      file=sys.stderr, flush=True)
            except Exception:
                pass
            self._reject(request)
            self.shutdown_request(request)

    @staticmethod
    def _reject(request) -> None:
        """Answer an over-queue connection with 503 instead of leaving it to hang."""
        body = b'{"error":"server queue saturated"}'
        head = (b"HTTP/1.0 503 Service Unavailable\r\n"
                b"Content-Type: application/json\r\n"
                b"Content-Length: " + str(len(body)).encode() + b"\r\n"
                b"Connection: close\r\n\r\n")
        try:
            request.settimeout(2)
            request.sendall(head + body)
        except Exception:
            pass

    # ── introspection ────────────────────────────────────────────────────────
    def health(self) -> dict:
        with self._worker_lock:
            live = self._live_workers
        return {
            "workers_live": live,
            "workers_target": self._POOL_SIZE,
            "workers_respawned": self._workers_respawned,
            "queue_depth": self._request_queue.qsize(),
            "queue_limit": self._QUEUE_LIMIT,
            "requests_shed": self._requests_shed,
        }


def main():
    port = int(os.environ.get("DASHBOARD_PORT", "8501"))
    host = os.environ.get("DASHBOARD_HOST", "0.0.0.0")

    print(f"Portfolio Dashboard starting on http://{host}:{port}")
    _raise_fd_limit()
    import db_manager as _dbm
    _dbm.migrate_json_files()
    print("Loading initial data (this may take a minute)...")

    # Refresh CEF/option-income ETF NAVs in fallback_data.json before the first
    # data load, so premium/discount calculations are always based on today's NAV.
    nav_thread = threading.Thread(target=_refresh_nav_cache_safe, daemon=True)
    nav_thread.start()

    # Initial data load in background so server starts immediately
    init_thread = threading.Thread(target=do_refresh, daemon=True)
    init_thread.start()

    # Server-side auto-refresh: keeps prices live without manual button presses.
    # Fires every 5 min during market hours, sleeps until next open otherwise.
    refresh_thread = threading.Thread(target=_auto_refresh_loop, daemon=True)
    refresh_thread.start()

    # Watchlist price refresh: same market-hours gate, separate thread so it
    # doesn't block or interact with the main portfolio refresh.
    wl_thread = threading.Thread(target=_watchlist_refresh_loop, daemon=True)
    wl_thread.start()

    # Balance snapshot scheduler — DB-driven, single thread.
    # Checks every 60s; DB record presence is the only gate.
    # Open captured at/after 09:31 ET, close at/after 16:10 ET.
    bal_thread = threading.Thread(target=_balance_snapshot_loop, daemon=True, name="bal-scheduler")
    bal_thread.start()
    if _is_market_open():
        print(f"Auto-refresh: every {_SERVER_REFRESH_INTERVAL_MARKET//60} min (market is open)")
    else:
        secs = _secs_until_next_open()
        print(f"Auto-refresh: market closed — next refresh at open ({secs/3600:.1f}h from now)")

    server = ThreadedHTTPServer((host, port), DashboardHandler)
    print(f"Server running at http://{host}:{port}")
    print(f"Worker pool: {ThreadedHTTPServer._POOL_SIZE} threads, "
          f"queue limit {ThreadedHTTPServer._QUEUE_LIMIT}, "
          f"fd limit {_fd_soft_limit()} — health at /api/health")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
