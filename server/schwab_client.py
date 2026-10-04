#!/usr/bin/env python3
"""
Schwab API integration layer.

Wraps schwab-py to provide real-time account positions, balances, quotes,
and fundamentals.  All market data comes from a single get_quotes() call
which returns the full response including quote, fundamental, reference,
extended, and regular sections.

Falls back gracefully if token is missing or expired
(requires running setup_schwab_auth.py first).

Account mapping (last 3 digits → tax-shelter type) is stored in account_mapping.json.
Valid type values: taxable | rollover_ira | roth_ira

Run discover_accounts() once after first login to auto-populate account_mapping.json
with all linked Schwab accounts, then set the type for each entry.
"""

import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

# ── Debug/Verbose flags ──────────────────────────────────────────────────────────
# _DEBUG  = True: dump full API responses (transferItems, raw JSON, etc.)
# _VERBOSE = False: show progress logging (account mapping, symbol fetching, etc.)
# Controlled by DASHBOARD_DEBUG env var — set via: ./start.sh --debug
import os as _os
_DEBUG   = _os.environ.get("DASHBOARD_DEBUG", "0") == "1"
_VERBOSE = _os.environ.get("DASHBOARD_VERBOSE", "0") == "1"

# ── Config ────────────────────────────────────────────────────────────────────

_DIR = os.path.dirname(os.path.abspath(__file__))
_CRED_PATH    = os.path.join(_DIR, "schwab_credentials.json")
_ACCT_MAP_PATH = os.path.join(_DIR, "account_mapping.json")

# Valid account type labels
_VALID_ACCT_TYPES = {"taxable", "rollover_ira", "roth_ira"}

def _load_rules() -> dict:
    try:
        with open(os.path.join(_DIR, "rules.json")) as f:
            return json.load(f)
    except Exception:
        return {}

_rules = _load_rules()
# Single authoritative MMF symbol set — loaded from rules.json _MONEY_MARKET_SYMBOLS
_KNOWN_MMF: set = set(_rules.get("_MONEY_MARKET_SYMBOLS", {}).get("symbols",
    ["SWVXX", "SNSXX", "SWRXX", "SWYXX", "SNVXX", "SPRXX", "SNOXX", "FDRXX"]))


def _load_creds() -> dict:
    with open(_CRED_PATH) as f:
        return json.load(f)


def _token_path() -> str:
    creds = _load_creds()
    return os.path.join(_DIR, creds.get("token_path", ".schwab_token.json"))


# ── Account mapping file helpers ──────────────────────────────────────────────

def _load_account_mapping() -> dict:
    """Load account_mapping.json, returning {} if missing or corrupt."""
    try:
        with open(_ACCT_MAP_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_account_mapping(mapping: dict) -> None:
    """Write account_mapping.json atomically."""
    tmp = _ACCT_MAP_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(mapping, f, indent=2)
    os.replace(tmp, _ACCT_MAP_PATH)


def _account_map() -> Dict[str, str]:
    """Returns {last_3_digits: account_type} for all mapped accounts.

    Single source of truth: account_mapping.json (populated by discover_accounts()
    after first login via start.sh).

    Only entries whose value is a valid type (taxable / rollover_ira / roth_ira)
    are returned — null / unknown entries are skipped so unmapped accounts
    are handled gracefully rather than crashing.
    """
    # Primary — account_mapping.json (written by discover_accounts() on auth)
    try:
        raw = _load_account_mapping()
        acct_map = {
            str(k): v for k, v in raw.items()
            if not str(k).startswith("_") and v in _VALID_ACCT_TYPES
        }
        if acct_map:
            return acct_map
    except Exception:
        pass

    raise RuntimeError(
        "Schwab account mapping not found.\n"
        "Run start.sh to authenticate — discover_accounts() will auto-populate\n"
        "account_mapping.json with all linked Schwab accounts.\n"
        "Then set each account type (taxable / rollover_ira / roth_ira) in\n"
        "Settings → Schwab Account Mapping."
    )


def _register_new_accounts(suffix_list: List[str]) -> None:
    """Add any newly-seen account suffixes to account_mapping.json with null type.

    Called automatically by get_account_hashes() so unmapped accounts appear
    in Settings → Schwab Account Mapping for the user to label.
    """
    mapping = _load_account_mapping()
    changed = False

    if "_comment" not in mapping:
        mapping["_comment"] = (
            "Map the last 3 digits of each Schwab account number to its type. "
            "Valid types: taxable | rollover_ira | roth_ira"
        )
        mapping["_valid_types"] = list(_VALID_ACCT_TYPES)
        changed = True

    for suffix in suffix_list:
        if suffix not in mapping:
            mapping[suffix] = None   # null → user must set type in Settings
            changed = True
            print(
                f"[schwab] New account ...{suffix} added to account_mapping.json — "
                f"set its type in Settings → Schwab Account Mapping"
            )

    if changed:
        mapping["_last_updated"] = datetime.now().isoformat(timespec="seconds")
        try:
            _save_account_mapping(mapping)
        except Exception as e:
            print(f"[schwab] ⚠ Could not write account_mapping.json: {e}")


# ── Public setup helper ───────────────────────────────────────────────────────

def discover_accounts() -> Dict[str, Optional[str]]:
    """Fetch all linked Schwab accounts and write them to account_mapping.json.

    Returns {last_3_digits: current_type_or_None} for every account found.
    Existing type assignments are preserved; new accounts get null type.

    Call this once after first login, then edit account_mapping.json to
    assign the correct type to each account suffix.
    """
    client = get_client()
    if client is None:
        print("[schwab] Not authenticated — run setup_schwab_auth.py first.")
        return {}

    try:
        resp = client.get_account_numbers()
        resp.raise_for_status()
        acct_numbers = resp.json()
    except Exception as e:
        print(f"[schwab] discover_accounts: API error — {e}")
        return {}

    mapping = _load_account_mapping()
    if "_comment" not in mapping:
        mapping["_comment"] = (
            "Map the last 3 digits of each Schwab account number to its type. "
            "Valid types: taxable | rollover_ira | roth_ira"
        )
        mapping["_valid_types"] = list(_VALID_ACCT_TYPES)

    result: Dict[str, Optional[str]] = {}
    for item in acct_numbers:
        acct_num = item.get("accountNumber", "")
        suffix = acct_num[-3:] if len(acct_num) >= 3 else acct_num
        existing_type = mapping.get(suffix)
        if suffix not in mapping:
            mapping[suffix] = None
        result[suffix] = existing_type

    mapping["_last_updated"] = datetime.now().isoformat(timespec="seconds")
    _save_account_mapping(mapping)

    print(f"[schwab] discover_accounts: found {len(result)} account(s):")
    for suffix, acct_type in result.items():
        status = acct_type if acct_type else "⚠ NOT MAPPED — edit account_mapping.json"
        print(f"   ...{suffix}  →  {status}")

    unmapped = [s for s, t in result.items() if not t]
    if unmapped:
        print(
            f"\n[schwab] Action required: open account_mapping.json and set the type "
            f"for: {unmapped}\n"
            f"  Valid types: taxable | rollover_ira | roth_ira"
        )

    return result


# ── Client factory ────────────────────────────────────────────────────────────

_client = None
_account_hashes_cache: Optional[Dict[str, str]] = None
_position_snapshot_cache: Optional[Dict[str, Any]] = None
_income_tx_cache: Optional[Dict[str, Any]] = None
_conv_history_cache: Optional[Dict[str, Any]] = None
_conv_history_cache_date: Optional[str] = None  # date the cache was built

# Serializes client (re)creation and token refresh. Several daemon threads
# (auto-refresh loop, watchlist loop, balance-snapshot loop, HTTP workers
# handling manual /api/refresh) can all call get_client() around the same
# moment. Schwab rotates the refresh token on every use, so two concurrent,
# unsynchronized refreshes against the same on-disk token race: the loser
# gets "invalid_grant" and looks like a genuinely dead 7-day-old token even
# though the winner already wrote a valid new one to disk. This lock makes
# concurrent callers wait for one in-flight (re)load instead of racing.
_client_lock = threading.Lock()


def clear_caches() -> None:
    """Reset session-level data caches so the next fetch pulls fresh from Schwab.

    Does NOT touch the authenticated client (_client) — that must survive
    across refresh cycles so token refresh stays serialized through
    get_client()/_client_lock instead of being rebuilt (and potentially
    racing) on every periodic refresh.
    """
    global _account_hashes_cache, _position_snapshot_cache
    global _income_tx_cache, _conv_history_cache, _conv_history_cache_date
    _account_hashes_cache = None
    _position_snapshot_cache = None
    _income_tx_cache = None
    _conv_history_cache = None
    _conv_history_cache_date = None


def _print_auth_instructions(reason: str) -> None:
    """Print a clear one-time message telling the user to run auth setup manually."""
    token_file = _token_path()
    print(f"[schwab] {reason}")
    print(f"[schwab] Run this in a separate terminal to authenticate:")
    print(f"[schwab]   cd {_DIR} && python3 setup_schwab_auth.py")
    print(f"[schwab] Dashboard will operate in fallback mode (yfinance data only) until then.")


def _patch_token_expiry(token_file: str) -> None:
    """
    authlib computes expires_at = time.time() + expires_in when it reads a
    token that lacks expires_at — regardless of when the token was actually
    issued. If the server starts with an already-aged token, authlib thinks
    it has a full 30 min left when it may have only seconds. This causes 401s
    because the proactive refresh (leeway=300) never fires in time.

    Fix: write the correct expires_at = creation_timestamp + expires_in into
    the token file before schwab-py loads it, so authlib sees the real expiry
    and refreshes proactively (or immediately if already expired).
    """
    try:
        with open(token_file) as f:
            raw = json.load(f)
        inner = raw.get("token", {})
        if "expires_at" not in inner and "expires_in" in inner:
            created = raw.get("creation_timestamp", time.time())
            inner["expires_at"] = created + inner["expires_in"]
            raw["token"] = inner
            with open(token_file, "w") as f:
                json.dump(raw, f)
            age_min = (time.time() - created) / 60
            exp_min = inner["expires_in"] / 60
            print(f"[schwab] Patched token expiry: age={age_min:.1f}m / lifetime={exp_min:.0f}m "
                  f"({'EXPIRED' if time.time() > inner['expires_at'] else 'valid'})")
    except Exception as e:
        print(f"[schwab] Warning: could not patch token expiry: {e}")


def get_client(force_reload: bool = False):
    """
    Returns an authenticated schwab-py client, loading token from disk.
    Returns None gracefully if the token is missing or expired — callers
    fall back to yfinance data.  Auth must be run manually via
    setup_schwab_auth.py (the server has no TTY to run it interactively).
    """
    global _client
    if _client is not None and not force_reload:
        return _client

    with _client_lock:
        # Re-check now that we hold the lock: another thread may have just
        # (re)loaded a good client while we were waiting, in which case we
        # should use it instead of racing a second refresh against Schwab.
        if _client is not None and not force_reload:
            return _client

        token_file = _token_path()

        if not os.path.exists(token_file):
            _print_auth_instructions(f"Token file not found: {token_file}")
            return None

        try:
            import schwab.auth as auth
            # Patch expires_at before loading so authlib sees the real token age
            # and proactively refreshes instead of using a stale access token.
            _patch_token_expiry(token_file)
            creds = _load_creds()
            _client = auth.client_from_token_file(
                token_path=token_file,
                api_key=creds["app_key"],
                app_secret=creds["app_secret"],
            )
            if _VERBOSE:
                print("[schwab] Client loaded from token file.")
            return _client
        except Exception as e:
            msg = str(e).lower()
            if _is_refresh_token_error(e):
                _print_auth_instructions("Schwab refresh token expired — re-authentication required.")
            elif any(k in msg for k in ("token", "expired", "invalid_grant", "401", "refresh", "oauth")):
                _print_auth_instructions("Token expired or invalid — re-authentication required.")
            else:
                print(f"[schwab] Failed to load client: {e}")
            _client = None
            return None


# ── Resilience helpers ────────────────────────────────────────────────────────

import db_manager as _dbm


def _is_5xx(exc: Exception) -> bool:
    """True when exc is an httpx HTTPStatusError with a 5xx status code."""
    resp = getattr(exc, "response", None)
    if resp is None:
        return False
    status = getattr(resp, "status_code", 0)
    return 500 <= status < 600


def _is_401(exc: Exception) -> bool:
    """True when exc is an httpx HTTPStatusError with a 401 status code."""
    resp = getattr(exc, "response", None)
    if resp is None:
        return False
    return getattr(resp, "status_code", 0) == 401


def _is_timeout(exc: Exception) -> bool:
    """True when exc is a network read/connect timeout (httpx or httpcore)."""
    return 'Timeout' in type(exc).__name__


def _is_refresh_token_error(exc: Exception) -> bool:
    """True when authlib raises an OAuthError due to an expired/invalid refresh token.

    Schwab refresh tokens expire after 7 days — authlib raises OAuthError
    (not an HTTP error) when the /oauth/token endpoint rejects the refresh.
    """
    msg = str(exc).lower()
    return any(k in msg for k in (
        "refresh_token_authentication_error",
        "unsupported_token_type",
        "failed refresh token authentication",
    ))


# Schwab's /transactions endpoint rejects any range longer than one year
# (400 Bad Request). Our income/conversion windows start Oct 1 of the prior
# year, so from Oct 1 onward they exceed a year — split into ≤ 360-day chunks.
_TXN_MAX_SPAN = timedelta(days=360)


def _get_transactions_chunked(client, account_hash, start_dt, end_dt,
                              transaction_types, *, label: str = "") -> list:
    """Fetch transactions over [start_dt, end_dt] in ≤ 360-day windows."""
    out: list = []
    s = start_dt
    while s < end_dt:
        e = min(s + _TXN_MAX_SPAN, end_dt)

        def _fetch(_s=s, _e=e):
            resp = client.get_transactions(
                account_hash,
                start_date=_s,
                end_date=_e,
                transaction_types=transaction_types,
            )
            resp.raise_for_status()
            return resp.json()

        result = _http_request(_fetch, label=label)
        if isinstance(result, list):
            out.extend(result)
        s = e
    return out


def _http_request(fn, *, label: str = "", retries: int = 2, delay: float = 1.5):
    """
    Call fn() which must execute an httpx request AND call raise_for_status().
    Automatically retries on:
      - 5xx responses (transient Schwab server errors) — up to `retries` times
      - 401 Unauthorized (expired access token) — once, after forcing a token
        refresh by reloading the client with the corrected expires_at patch

    Raises the final exception if all attempts fail.

    Args:
        fn:      zero-arg callable that performs the HTTP call
        label:   descriptive name for log messages
        retries: number of extra attempts after the first failure
        delay:   base sleep in seconds (multiplied by attempt number)
    """
    _401_retried = False
    for attempt in range(retries + 1):
        try:
            # Serialize actual Schwab HTTP calls, not just get_client(). authlib
            # proactively refreshes the access token *inside* fn() (via
            # ensure_active_token) whenever it's near expiry, using whatever
            # refresh token is currently in memory. Two threads hitting that
            # check at the same moment on the shared client would both refresh
            # with the same (soon-to-be-rotated) token — one wins, the other
            # gets invalid_grant and looks like a dead 7-day-old token. Holding
            # this lock for the whole call, not just client creation, is what
            # actually closes the race.
            with _client_lock:
                return fn()
        except Exception as exc:
            resp   = getattr(exc, "response", None)
            status = getattr(resp, "status_code", 0)

            if _is_refresh_token_error(exc):
                # Schwab refresh token expired (7-day lifetime) — cannot auto-recover.
                # Invalidate the cached client so subsequent calls don't retry and fail.
                global _client
                _client = None
                _print_auth_instructions(
                    f"{label}: Schwab refresh token expired — re-authentication required."
                )
                raise

            elif _is_401(exc) and not _401_retried:
                # Access token expired — force client reload so _patch_token_expiry
                # writes correct expires_at and authlib proactively refreshes.
                _401_retried = True
                print(f"[schwab] ⚠ {label}: 401 Unauthorized — forcing token refresh…")
                get_client(force_reload=True)
                # No sleep — retry immediately with refreshed token
                continue

            elif _is_5xx(exc) and attempt < retries:
                wait = delay * (attempt + 1)
                print(f"[schwab] ⚠ {label}: HTTP {status} (attempt {attempt + 1}/{retries + 1})"
                      f" — retrying in {wait:.0f}s…")
                time.sleep(wait)
            elif _is_timeout(exc) and attempt < retries:
                wait = delay * (attempt + 1)
                print(f"[schwab] ⚠ {label}: read timeout (attempt {attempt + 1}/{retries + 1})"
                      f" — retrying in {wait:.0f}s…")
                time.sleep(wait)
            else:
                raise


def _cache_save(key: str, data: Any) -> None:
    """Persist API response data to SQLite so we can serve stale data on 5xx."""
    try:
        _dbm.cache_set(f"schwab:{key}", {"data": data, "saved_at": datetime.now().isoformat()})
    except Exception:
        pass   # cache write failure is non-fatal


def _cache_load(key: str) -> Optional[Any]:
    """Load last-good API response from SQLite cache. Returns None if unavailable."""
    try:
        entry = _dbm.cache_get(f"schwab:{key}")
        if entry:
            age_h = (datetime.now() - datetime.fromisoformat(entry["saved_at"])).seconds / 3600
            if _VERBOSE:
                print(f"[schwab] 📦 Serving cached '{key}' from {age_h:.1f}h ago")
            return entry["data"]
    except Exception:
        pass
    return None


# ── Helpers ───────────────────────────────────────────────────────────────────

_FREQ_MAP = {1: "Annually", 2: "Semi-Annual", 4: "Quarterly", 12: "Monthly"}
# CEF detection uses Schwab assetSubType ("CEF") from the live API — no hardcoded symbol list needed.


def _trim_date(s) -> Optional[str]:
    """'2026-01-26T00:00:00Z' or '2026-01-26 00:00:00.0' → '2026-01-26'"""
    if not s:
        return None
    return str(s).replace("Z", "").split("T")[0].split(" ")[0]


def _parse_full_quote(symbol: str, q: dict) -> dict:
    """
    Parse one symbol's full Schwab quote response (all sections) into a
    unified dict with quote + fundamental + reference data.

    Schwab quote response sections:
      quote       — bid/ask/last/volume/open/close/52w range
      fundamental — div data, PE, EPS, shares, next dates, leverage
      reference   — description, exchange, cusip
      extended    — after-hours price/volume
      regular     — regular-session last price/change
    """
    quote   = q.get("quote", {})
    fund    = q.get("fundamental", {})
    ref     = q.get("reference", {})
    ext     = q.get("extended", {})
    regular = q.get("regular", {})

    # ── Price ──────────────────────────────────────────────────────────────────
    last_price = float(
        quote.get("lastPrice") or quote.get("mark") or quote.get("closePrice") or 0
    )
    prev_close = float(quote.get("closePrice") or last_price)
    net_change = float(quote.get("netChange") or 0)
    # netPercentChange is always a whole-number percent (0.219 = 0.219%)
    net_pct    = float(quote.get("netPercentChange") or 0) / 100.0

    # After-hours price (non-zero only when extended session is active)
    after_hours_price = float(ext.get("lastPrice") or 0) or None

    # Regular market (excludes pre/post)
    reg_price  = float(regular.get("regularMarketLastPrice") or 0) or None
    reg_change = float(regular.get("regularMarketNetChange") or 0)
    reg_pct    = float(regular.get("regularMarketPercentChange") or 0) / 100.0

    # ── Dividend / fundamentals ────────────────────────────────────────────────
    freq_int = fund.get("divFreq")
    freq_str = _FREQ_MAP.get(int(freq_int), f"Every {freq_int}x/yr") if freq_int else None

    ann_div     = float(fund.get("divAmount") or 0) or None   # annualised $
    div_yield   = float(fund.get("divYield")  or 0) or None   # annualised yield % (price-based)
    pay_amount  = float(fund.get("divPayAmount") or 0) or None # last single payment $

    # NAV-based distribution rate for CEFs: ann_div / NAV
    # NAV is not in the REST quote response (only in Streamer field 24).
    # We expose the pieces; callers compute nav_yield = ann_div / nav_price.

    return {
        # ── Quote ──────────────────────────────────────────────────────────
        "price":           last_price,
        "change":          net_change,
        "change_pct":      net_pct,
        "bid":             float(quote.get("bidPrice") or 0),
        "ask":             float(quote.get("askPrice") or 0),
        "volume":          int(quote.get("totalVolume") or 0),
        "open":            float(quote.get("openPrice") or 0),
        "close":           prev_close,
        "day_high":        float(quote.get("highPrice") or 0),
        "day_low":         float(quote.get("lowPrice") or 0),
        "52w_high":        float(quote.get("52WeekHigh") or 0),
        "52w_low":         float(quote.get("52WeekLow")  or 0),
        "after_hours_price": after_hours_price,
        "reg_price":       reg_price,
        "reg_change":      reg_change,
        "reg_change_pct":  reg_pct,
        "asset_sub_type":  q.get("assetSubType", ""),   # e.g. "CEF", "ETF", "COE"
        "realtime":        q.get("realtime", False),
        # ── Fundamentals ───────────────────────────────────────────────────
        "description":     ref.get("description", ""),
        "exchange":        ref.get("exchangeName", ref.get("exchange", "")),
        "cusip":           ref.get("cusip", ""),
        "pe_ratio":        float(fund.get("peRatio") or 0) or None,
        "eps":             float(fund.get("eps") or 0) or None,
        "shares_outstanding": float(fund.get("sharesOutstanding") or 0) or None,
        "fund_leverage_factor": float(fund.get("fundLeverageFactor") or 0) or None,
        "avg10d_volume":   float(fund.get("avg10DaysVolume") or 0) or None,
        "avg1y_volume":    float(fund.get("avg1YearVolume")  or 0) or None,
        # ── Risk / fundamentals ───────────────────────────────────────────
        "beta":            float(fund.get("beta") or 0) or None,
        "vol3m_avg":       float(fund.get("vol3MonthAvg") or 0) or None,
        "return_on_equity": float(fund.get("returnOnEquity") or 0) or None,
        "return_on_assets": float(fund.get("returnOnAssets") or 0) or None,
        "net_profit_margin": float(fund.get("netProfitMarginTTM") or 0) or None,
        "operating_margin": float(fund.get("operatingMarginTTM") or 0) or None,
        "total_debt_to_cap": float(fund.get("totalDebtToCapital") or 0) or None,
        "lt_debt_to_equity": float(fund.get("ltDebtToEquity") or 0) or None,
        "pb_ratio":        float(fund.get("pbRatio") or 0) or None,
        "pcf_ratio":       float(fund.get("pcfRatio") or 0) or None,
        "peg_ratio":       float(fund.get("pegRatio") or 0) or None,
        "short_float_pct": float(fund.get("shortIntToFloat") or 0) or None,
        "market_cap":      float(fund.get("marketCap") or 0) or None,
        # ── Dividend ───────────────────────────────────────────────────────
        "div_amount":      ann_div,        # annualised $ distribution
        "div_yield":       div_yield,      # annualised yield % (dist / price × 100)
        "div_pay_amount":  pay_amount,     # most recent single payment
        "div_ex_date":     _trim_date(fund.get("divExDate")),
        "div_pay_date":    _trim_date(fund.get("divPayDate")),
        "div_freq":        freq_str,
        "div_freq_int":    int(freq_int) if freq_int else None,
        "next_div_ex_date":  _trim_date(fund.get("nextDivExDate")),
        "next_div_pay_date": _trim_date(fund.get("nextDivPayDate")),
        "declaration_date":  _trim_date(fund.get("declarationDate")),
        "last_earnings_date": _trim_date(fund.get("lastEarningsDate")),
        # NAV: not in REST quote — callers must use FALLBACK_DATA for CEFs
        "nav": None,
    }


# ── Account discovery ─────────────────────────────────────────────────────────

def get_account_hashes(force_reload: bool = False) -> Dict[str, str]:
    """Returns {portfolio_key: hash_value} for all linked accounts. Cached for session reuse."""
    global _account_hashes_cache
    if not force_reload and _account_hashes_cache is not None:
        return _account_hashes_cache
    client = get_client()
    if client is None:
        return {}

    try:
        def _fetch_acct_nums():
            resp = client.get_account_numbers()
            resp.raise_for_status()
            return resp.json()

        acct_numbers = _http_request(_fetch_acct_nums, label="account_numbers")
        acct_map = _account_map()
        result = {}
        unknown_suffixes: List[str] = []
        for item in acct_numbers:
            acct_num = item.get("accountNumber", "")
            hash_val = item.get("hashValue", "")
            suffix = acct_num[-3:] if len(acct_num) >= 3 else acct_num
            key = acct_map.get(suffix)
            if key:
                result[key] = hash_val
                if _VERBOSE:
                    print(f"[schwab] Mapped account ...{suffix} → {key}")
            else:
                unknown_suffixes.append(suffix)
                if _VERBOSE:
                    print(f"[schwab] Unknown account ...{suffix} — not in account_mapping.json")

        # Auto-register any unseen account suffixes so the user knows to map them
        if unknown_suffixes:
            _register_new_accounts(unknown_suffixes)

        _cache_save("account_hashes", result)   # persist so retry fallback has the hashes
        _account_hashes_cache = result  # session-level cache
        return result
    except Exception as e:
        if _is_5xx(e):
            cached = _cache_load("account_hashes")
            if cached:
                print(f"[schwab] ⚠ account_numbers: using cached hashes (Schwab 5xx)")
                return cached
            status = getattr(getattr(e, "response", None), "status_code", 0)
            print(f"[schwab] ✗ account_numbers: HTTP {status} and no cache")
        else:
            if _VERBOSE:
                print(f"[schwab] Error fetching account numbers: {e}")
        return {}


# ── Positions ─────────────────────────────────────────────────────────────────

def _parse_positions_from_acct_data(acct_data: dict) -> tuple:
    """
    Parse a single Schwab securitiesAccount dict into (positions_dict, liquidation_value).
    Shared by both get_all_positions strategies (bulk vs. per-account).
    """
    raw_positions = acct_data.get("positions", [])
    positions = {}
    for pos in raw_positions:
        instrument = pos.get("instrument", {})
        symbol    = instrument.get("symbol", "")
        asset_type = instrument.get("assetType", "EQUITY")
        # Allow standard equity/ETF types plus MUTUAL_FUND (covers money-market funds)
        if asset_type not in ("EQUITY", "ETF", "COLLECTIVE_INVESTMENT", "MUTUAL_FUND"):
            continue
        if not symbol or symbol.startswith("$"):
            continue
        long_qty  = float(pos.get("longQuantity", 0))
        avg_price = float(pos.get("averagePrice", 0))
        mkt_val   = float(pos.get("marketValue", 0))
        cur_price = (mkt_val / long_qty) if long_qty > 0 else avg_price
        # Identify money-market funds: known symbol list OR MUTUAL_FUND with $1 NAV
        is_mmf = symbol in _KNOWN_MMF or (
            asset_type == "MUTUAL_FUND" and 0.99 <= cur_price <= 1.01
        )
        positions[symbol] = {
            "shares":          long_qty,
            "cost_per_share":  avg_price,
            "market_value":    mkt_val,
            "current_price":   1.0 if is_mmf else cur_price,
            "asset_type":      asset_type,
            "is_money_market": is_mmf,
        }
    current_bal = acct_data.get("currentBalances", {})
    liq_value = float(
        current_bal.get("liquidationValue",
        current_bal.get("accountValue", 0))
    )

    # Add uninvested cash as a synthetic position (separate from SWVXX/MMF shares).
    # cashBalance = total cash settled + unsettled per Schwab API.
    cash_balance = float(current_bal.get("cashBalance", 0) or 0)
    if cash_balance > 0:
        positions["CASH"] = {
            "shares":          cash_balance,
            "cost_per_share":  1.0,
            "market_value":    cash_balance,
            "current_price":   1.0,
            "asset_type":      "CASH",
            "is_money_market": True,
        }

    return positions, liq_value


def get_all_positions() -> Dict[str, Dict]:
    """
    Returns {portfolio_key: {"value": float, "positions": {symbol: {...}}}}
    for all mapped accounts.

    Strategy: first tries ONE bulk call (get_accounts) which is a single API
    round-trip. Falls back to per-account calls if the bulk endpoint fails.
    Either way, caches each account's data for resilience against 5xx outages.
    """
    client = get_client()
    if client is None:
        return {}

    hashes = get_account_hashes()
    if not hashes:
        return {}

    # Invert hash→key map for bulk response parsing (hash → portfolio_key)
    hash_to_key = {v: k for k, v in hashes.items()}

    import schwab.client as sc
    result: Dict[str, Dict] = {}

    # ── Strategy 1: single bulk call (get_accounts) ───────────────────────────
    try:
        def _fetch_all_accounts():
            resp = client.get_accounts(fields=sc.Client.Account.Fields.POSITIONS)
            resp.raise_for_status()
            return resp.json()

        raw_all = _http_request(_fetch_all_accounts, label="get_accounts(bulk)",
                                retries=2, delay=1.5)

        # raw_all is a list of account objects
        if not isinstance(raw_all, list):
            raw_all = [raw_all]

        for acct_obj in raw_all:
            acct_data = acct_obj.get("securitiesAccount", acct_obj)
            # Match account to portfolio key via hash (accountNumber field has the hash)
            acct_hash = acct_data.get("accountNumber", "")
            acct_key  = hash_to_key.get(acct_hash)
            if not acct_key:
                # Try matching by last 3 digits of accountNumber as fallback
                suffix = acct_hash[-3:] if len(acct_hash) >= 3 else ""
                acct_key = _account_map().get(suffix)
            if not acct_key:
                continue

            positions, liq_value = _parse_positions_from_acct_data(acct_data)
            acct_result = {"value": liq_value, "positions": positions}
            result[acct_key] = acct_result
            _cache_save(f"positions_{acct_key}", acct_result)
            if _VERBOSE:
                print(f"[schwab] {acct_key}: {len(positions)} positions, "
                  f"value=${liq_value:,.0f} (bulk)")

        if result:
            return result   # success — skip per-account fallback

    except Exception as e:
        if _is_5xx(e):
            status = getattr(getattr(e, "response", None), "status_code", 0)
            print(f"[schwab] ⚠ bulk get_accounts HTTP {status} — falling back to per-account calls")
        else:
            if _VERBOSE:
                print(f"[schwab] get_accounts error: {e} — falling back to per-account calls")

    # ── Strategy 2: per-account fallback ─────────────────────────────────────
    for acct_key, hash_val in hashes.items():
        if acct_key in result:
            continue   # already populated by bulk call (partial success)
        try:
            def _fetch_one(_hv=hash_val, _ak=acct_key):
                resp = client.get_account(_hv, fields=sc.Client.Account.Fields.POSITIONS)
                resp.raise_for_status()
                return resp.json()

            data      = _http_request(_fetch_one, label=f"positions/{acct_key}")
            acct_data = data.get("securitiesAccount", data)
            positions, liq_value = _parse_positions_from_acct_data(acct_data)
            acct_result = {"value": liq_value, "positions": positions}
            result[acct_key] = acct_result
            _cache_save(f"positions_{acct_key}", acct_result)
            if _VERBOSE:
                print(f"[schwab] {acct_key}: {len(positions)} positions, "
                  f"value=${liq_value:,.0f}")

        except Exception as e:
            if _is_5xx(e):
                cached = _cache_load(f"positions_{acct_key}")
                if cached:
                    result[acct_key] = cached
                    print(f"[schwab] ⚠ {acct_key}: serving cached positions (Schwab 5xx)")
                else:
                    status = getattr(getattr(e, "response", None), "status_code", 0)
                    print(f"[schwab] ✗ {acct_key}: HTTP {status} — no cache available")
            else:
                if _VERBOSE:
                    print(f"[schwab] Error fetching positions for {acct_key}: {e}")
                traceback.print_exc()

    return result


# ── Real-time quotes + fundamentals (single call) ─────────────────────────────

def get_quotes(symbols: List[str]) -> Dict[str, Dict]:
    """
    Returns {symbol: full_data_dict} for all requested symbols.

    Each dict contains quote data (price, bid/ask, volume, 52w range, day range,
    after-hours) PLUS fundamentals (PE, EPS, all dividend fields, next ex/pay dates)
    extracted from the single Schwab get_quotes API response.

    Falls back to empty dict on error.
    """
    client = get_client()
    if client is None or not symbols:
        return {}

    try:
        resp = client.get_quotes(symbols)
        resp.raise_for_status()
        raw = resp.json()

        quotes = {}
        for symbol, q in raw.items():
            quotes[symbol] = _parse_full_quote(symbol, q)

        if _VERBOSE:
            print(f"[schwab] Fetched quotes+fundamentals for {len(quotes)}/{len(symbols)} symbols.")
        return quotes

    except Exception as e:
        if _VERBOSE:
            print(f"[schwab] Error fetching quotes: {e}")
        return {}


def get_instrument_fundamentals(symbol: str) -> Dict:
    """
    Convenience wrapper: fetch fundamentals for a single symbol via get_quotes().
    The full fundamental data is already embedded in the quote response —
    no separate API call needed.
    """
    result = get_quotes([symbol])
    data = result.get(symbol, {})
    if data:
        if _VERBOSE:
            print(f"[schwab] Fundamentals for {symbol} extracted from quote response.")
    return data


# ── Convenience: full portfolio snapshot ─────────────────────────────────────

def get_portfolio_snapshot(force_reload: bool = False) -> Optional[Dict]:
    """
    Returns a merged dict combining real positions and real-time quotes+fundamentals.
    Returns None if Schwab is unavailable. Cached for session reuse.
    """
    global _position_snapshot_cache
    if not force_reload and _position_snapshot_cache is not None:
        return _position_snapshot_cache
    positions_by_acct = get_all_positions()
    if not positions_by_acct:
        return None

    all_symbols = set()
    mmf_symbols = set()
    for acct in positions_by_acct.values():
        for sym, pos in acct["positions"].items():
            if pos.get("is_money_market"):
                mmf_symbols.add(sym)
            else:
                all_symbols.add(sym)

    quotes = get_quotes(sorted(all_symbols))

    # Inject stable $1.00 stub quotes for money-market funds — no API call needed
    for sym in mmf_symbols:
        quotes[sym] = {
            "price": 1.0, "change": 0.0, "change_pct": 0.0,
            "bid": 1.0, "ask": 1.0, "volume": 0,
            "day_high": 1.0, "day_low": 1.0,
            "52w_high": 1.0, "52w_low": 1.0,
            "realtime": False, "is_money_market": True,
        }

    for acct_key, acct in positions_by_acct.items():
        for symbol, pos in acct["positions"].items():
            q = quotes.get(symbol, {})
            if pos.get("is_money_market"):
                # NAV is always $1.00 — no price update needed
                pos["change"] = 0.0
                pos["change_pct"] = 0.0
            elif q:
                live_price = q["price"]
                pos["current_price"] = live_price
                pos["market_value"] = pos["shares"] * live_price
                pos["change"] = q["change"]
                pos["change_pct"] = q["change_pct"]
            else:
                pos["change"] = 0.0
                pos["change_pct"] = 0.0

    result = {
        "accounts": positions_by_acct,
        "quotes": quotes,
        "all_symbols": sorted(all_symbols),
    }
    _position_snapshot_cache = result
    return result


# ── Income transaction history ────────────────────────────────────────────────

def get_income_transactions(
    year: int = None,
    desc_to_symbol: Dict[str, str] = None,
) -> Dict[str, Any]:
    """
    Fetch YTD DIVIDEND_OR_INTEREST transactions for all mapped accounts.

    desc_to_symbol: optional {description_lower: symbol} map built from quote data
    so we can reverse-map fund names back to tickers.

    Returns:
    {
        "year": 2026,
        "transactions": [
            {
                "account":     "taxable",
                "date":        "2026-02-28",
                "description": "ADAMS DIVERSIFIED EQUITY",
                "symbol":      "ADX",   # mapped; None if unknown
                "amount":      3974.91,
                "qualified":   False,
            }, ...
        ],
        "by_account": {
            "taxable": {
                "total":    12345.0,
                "by_month": [0.0] * 12,   # index 0 = Jan
                "by_symbol": {"ADX": 5048.21, ...},
            }, ...
        },
        "ytd_total": 12345.0,
    }
    """
    global _income_tx_cache
    if _income_tx_cache is not None:
        return _income_tx_cache
    from datetime import date, datetime as _dt
    import schwab.client as sc

    client = get_client()
    if client is None:
        return {}

    hashes = get_account_hashes()
    if not hashes:
        return {}

    _year = year or date.today().year
    # Prior-year Q4 (Oct 1) + full current year, end = now() not future date.
    # Consistent with get_realized_gains() and get_conversion_transactions().
    start_dt = _dt(_year - 1, 10, 1)
    end_dt   = _dt.now()

    desc_map = {k.lower(): v for k, v in (desc_to_symbol or {}).items()}

    def _norm(s: str) -> str:
        """Normalize a fund description for fuzzy matching.
        Strips spaces, replaces & with 'and', lowercases.
        Handles Schwab API quirks like 'HIGH INCOMEETF' vs 'HIGH INCOME ETF'.
        """
        return s.lower().replace("&", "and").replace(" ", "")

    # Pre-build normalized lookup for steps 3+
    _norm_map = {_norm(k): v for k, v in desc_map.items()}

    all_txns: list = []
    by_account: Dict[str, Any] = {}
    _seen_tx_ids: set = set()   # global dedup across all accounts by transactionId

    for acct_key, hash_val in hashes.items():
        acct_total = 0.0
        acct_by_month = [0.0] * 12
        acct_by_sym: Dict[str, float] = {}
        acct_txns: list = []

        try:
            raw_list = _get_transactions_chunked(
                client, hash_val, start_dt, end_dt,
                sc.Client.Transactions.TransactionType.DIVIDEND_OR_INTEREST,
                label=f"transactions/{acct_key}",
            )

            for tx in raw_list:
                # Dedup by Schwab transactionId (most reliable key).
                # Falls back to (account+date+amount) if id absent.
                _tx_id = tx.get("transactionId")
                _dedup_key = (_tx_id,) if _tx_id else (acct_key, tx.get("time", "")[:10], tx.get("netAmount", 0))
                if _dedup_key in _seen_tx_ids:
                    continue
                _seen_tx_ids.add(_dedup_key)

                desc  = tx.get("description", "")
                time_s = tx.get("time", "")[:10]   # "YYYY-MM-DD"
                qual  = bool(tx.get("qualifiedDividend", False))
                _desc_l = desc.lower()

                if _DEBUG:
                    print(f"[schwab DEBUG txn] {time_s} {acct_key} amt={tx.get('netAmount')} qual={qual} desc={desc!r} transferItems={tx.get('transferItems')}")


                # Determine income amount — normal path is positive netAmount.
                # "Reinvest Dividend" is real taxable income even though Schwab may
                # report netAmount=0 (dividend credited + shares bought in same entry).
                # In that case recover the income from the positive transferItem amount.
                net = float(tx.get("netAmount", 0))
                _is_reinvest = "reinvest" in _desc_l and "shares" not in _desc_l
                if net <= 0 and _is_reinvest:
                    for _ti in tx.get("transferItems", []):
                        _ti_amt = float(_ti.get("amount") or 0)
                        if _ti_amt > 0:
                            net = _ti_amt
                            break
                # Skip pure negative entries (e.g. "Reinvest Shares" buy side)
                if net <= 0:
                    continue

                # Try to find symbol — multiple strategies to handle Schwab API quirks:
                # 1. Exact description → symbol from desc_map (includes _DESC_OVERRIDES
                #    from input.json + live quote descriptions). Takes priority over
                #    transferItems so a known-correct mapping beats a wrong Schwab instrument.
                sym = desc_map.get(desc.lower())
                # 2. transferItems instrument.symbol — only used when description lookup
                #    fails (Schwab sometimes puts wrong symbols here, e.g. ACV for SPYI).
                if not sym:
                    for item in tx.get("transferItems", []):
                        item_sym = (item.get("instrument", {}).get("symbol") or "").strip()
                        if item_sym and item_sym not in ("CURRENCY_USD", "USD", ""):
                            sym = item_sym
                            break
                # 3. Normalized match: strip spaces, replace & → and
                #    Handles "HIGH INCOMEETF" vs "HIGH INCOME ETF", "& " vs "AND"
                if not sym and desc:
                    norm_desc = _norm(desc)
                    sym = _norm_map.get(norm_desc)
                # 4. Prefix match on normalized form (first 20 chars, min 10 to avoid false positives)
                #    Handles truncated descriptions like "ABRDN STNDRD GLB INFR IN" vs full name
                if not sym and desc:
                    norm_prefix = _norm(desc)[:20]
                    if len(norm_prefix) >= 10:
                        for norm_key, map_sym in _norm_map.items():
                            if norm_key.startswith(norm_prefix) or norm_prefix.startswith(norm_key[:20]):
                                sym = map_sym
                                break

                # 5. Cash / money-market interest → label as "CASH_INT"
                if not sym and desc:
                    dl = desc.lower()
                    if any(k in dl for k in ("schwab", "bank int", "interest")):
                        sym = "CASH_INT"

                # 6. Persistent desc→symbol cache (survives position sales).
                #    When a symbol is newly resolved above, we write it back so
                #    future refreshes can find it even after the position is sold.
                _desc_cache_path = os.path.join(os.path.dirname(__file__), ".desc_symbol_cache.json")
                if not hasattr(get_income_transactions, "_desc_cache"):
                    try:
                        with open(_desc_cache_path) as _f:
                            get_income_transactions._desc_cache = json.load(_f)
                    except Exception:
                        get_income_transactions._desc_cache = {}
                _dc = get_income_transactions._desc_cache
                if sym and desc:
                    # Newly resolved — persist for future use
                    if _dc.get(desc.lower()) != sym:
                        _dc[desc.lower()] = sym
                        try:
                            with open(_desc_cache_path, "w") as _f:
                                json.dump(_dc, _f, indent=2)
                        except Exception:
                            pass
                elif not sym and desc and desc.lower() in _dc:
                    # Previously resolved but now sold — recover from cache
                    sym = _dc[desc.lower()]

                # 7. Still unresolved — add a _DESC_OVERRIDES entry in input.json
                #    mapping the Schwab description to the correct ticker symbol.

                # Month index from date
                month_idx = 0
                try:
                    month_idx = int(time_s[5:7]) - 1   # 0 = Jan
                except Exception:
                    pass

                # Classify income type for display and tax routing
                if qual:
                    _inc_type = "QUAL"
                elif "return of capital" in _desc_l or " roc" in _desc_l:
                    _inc_type = "ROC"
                elif "short term cap gain" in _desc_l or "st cap gain" in _desc_l:
                    _inc_type = "STCG"
                elif "long term cap gain" in _desc_l or "lt cap gain" in _desc_l:
                    _inc_type = "LTCG"
                elif "interest" in _desc_l:
                    _inc_type = "INT"
                elif _is_reinvest:
                    _inc_type = "REINVEST"
                else:
                    _inc_type = "DIV"

                txn_obj = {
                    "account":     acct_key,
                    "date":        time_s,
                    "description": desc,
                    "symbol":      sym,
                    "amount":      round(net, 2),
                    "qualified":   qual,
                    "type":        _inc_type,
                }
                acct_txns.append(txn_obj)
                # Accumulate current-year totals only (not prior-Q4)
                _is_curr_yr = time_s >= f"{_year}-01-01"
                if _is_curr_yr:
                    acct_total += net
                    if 0 <= month_idx < 12:
                        acct_by_month[month_idx] += net
                    if sym:
                        acct_by_sym[sym] = acct_by_sym.get(sym, 0.0) + net

            # Current-year-only aggregates — safe to cache and use downstream
            acct_result_t = {
                "total":     round(acct_total, 2),
                "by_month":  [round(v, 2) for v in acct_by_month],
                "by_symbol": {k: round(v, 2) for k, v in acct_by_sym.items()},
            }
            by_account[acct_key] = acct_result_t
            all_txns.extend(acct_txns)
            _cache_save(f"transactions_{acct_key}_{_year}", acct_result_t)
            if _VERBOSE:
                print(f"[schwab] {acct_key}: {len(acct_txns)} income txns, "
                  f"YTD=${acct_total:,.2f}")

        except Exception as e:
            if _is_5xx(e) or _is_timeout(e):
                cached = _cache_load(f"transactions_{acct_key}_{_year}")
                if cached:
                    by_account[acct_key] = cached
                    # Re-hydrate all_txns from cache so detail tab stays populated
                    # (cached result doesn't store raw txn list, only aggregates)
                    reason = "timeout" if _is_timeout(e) else "Schwab 5xx"
                    print(f"[schwab] ⚠ {acct_key}: using cached transactions ({reason})")
                else:
                    resp = getattr(e, "response", None)
                    status = getattr(resp, "status_code", 0)
                    reason = "timeout" if _is_timeout(e) else f"HTTP {status}"
                    print(f"[schwab] ✗ {acct_key}: {reason} — no transaction cache available")
                    by_account[acct_key] = {"total": 0.0, "by_month": [0.0]*12, "by_symbol": {}}
            else:
                if _VERBOSE:
                    print(f"[schwab] Error fetching transactions for {acct_key}: {e}")
                traceback.print_exc()
                by_account[acct_key] = {"total": 0.0, "by_month": [0.0]*12, "by_symbol": {}}

    # Split chronologically — by_account is already current-year-only
    all_txns.sort(key=lambda t: t["date"])
    _curr_year_str = f"{_year}-01-01"
    curr_txns    = [t for t in all_txns if t["date"] >= _curr_year_str]
    prev_q4_txns = [t for t in all_txns if t["date"] <  _curr_year_str]

    result = {
        "year":                 _year,
        "transactions":         curr_txns,
        "prev_q4_transactions": prev_q4_txns,
        "by_account":           by_account,      # current-year only, built in loop
        "ytd_total":            round(sum(t["amount"] for t in curr_txns), 2),
        "prev_q4_total":        round(sum(t["amount"] for t in prev_q4_txns), 2),
    }
    _income_tx_cache = result
    return result


# ── Roth Conversion tracking via JOURNAL transactions ───────────────────────

# schwab_client.py - Add Journaled Shares support to get_conversion_transactions()

# schwab_client.py - Replace get_conversion_transactions() with this version

def get_conversion_transactions(
    year: int = None,
) -> Dict[str, Any]:
    """Fetch and track rollover-to-Roth conversions. Cached per calendar day.

    Strategy:
    - Schwab API only returns the last 60 days.
    - On every call, fetch the last 60 days from both IRA accounts and store
      ALL transactions in the schwab_transactions DB table (INSERT OR IGNORE,
      so existing rows are never overwritten).
    - Run conversion matching against the full DB history for the target date
      range (prior-year Q4 + current year), not just the live API window.
    - This way the DB grows incrementally and historical transactions are never
      lost regardless of the API's rolling window.
    """
    global _conv_history_cache, _conv_history_cache_date
    from datetime import date as _date_cls
    _today_str = str(_date_cls.today())
    if _conv_history_cache is not None and _conv_history_cache_date == _today_str:
        return _conv_history_cache

    from datetime import date, datetime as _dt
    import json as _json
    import re

    client = get_client()
    if client is None:
        return {}

    hashes = get_account_hashes()
    if not hashes:
        return {}

    _year = year or date.today().year

    # Map account keys
    rollover_hash = None
    roth_hash = None
    for acct_key, hash_val in hashes.items():
        if acct_key == "rollover_ira":
            rollover_hash = hash_val
        elif acct_key == "roth_ira":
            roth_hash = hash_val

    if not rollover_hash or not roth_hash:
        if _VERBOSE:
            print("[schwab] Conversion tracking: need both rollover_ira and roth_ira accounts")
        return {}

    # ── Step 1: Fetch prior-year Q4 + full current year from Schwab API ────────
    # Same date range used by get_realized_gains() which successfully pulls
    # Oct 1 prior year data. Key: end_date must be now(), NOT a future date —
    # Schwab rejects requests with end_date in the future (400 Bad Request).
    _fetch_start = _dt(_year - 1, 10, 1)
    _fetch_end   = _dt.now()

    def _fetch_range(_hv, label):
        return _get_transactions_chunked(
            client, _hv, _fetch_start, _fetch_end,
            [
                sc.Client.Transactions.TransactionType.RECEIVE_AND_DELIVER,
                sc.Client.Transactions.TransactionType.JOURNAL,
            ],
            label=label,
        )

    try:
        from db_manager import upsert_schwab_transactions as _upsert

        rollover_all = _fetch_range(rollover_hash, "tx/rollover")
        _upsert("rollover_ira", rollover_all)

        roth_all = _fetch_range(roth_hash, "tx/roth")
        _upsert("roth_ira", roth_all)

        if _VERBOSE:
            print(f"[schwab] Fetched {len(rollover_all)} rollover + {len(roth_all)} roth transactions")

    except Exception as e:
        if _VERBOSE:
            print(f"[schwab] API fetch failed ({e}); loading from DB")
        # Fall back to whatever is in the DB
        try:
            from db_manager import get_schwab_transactions as _get_tx
            _hist_start = f"{_year - 1}-10-01"
            _hist_end   = f"{_year}-12-31"
            rollover_all = [_json.loads(r["raw_json"]) for r in
                            _get_tx("rollover_ira", _hist_start, _hist_end)]
            roth_all     = [_json.loads(r["raw_json"]) for r in
                            _get_tx("roth_ira",     _hist_start, _hist_end)]
            if _VERBOSE:
                print(f"[schwab] DB fallback: {len(rollover_all)} rollover + {len(roth_all)} roth records")
        except Exception as e2:
            if _VERBOSE:
                print(f"[schwab] DB fallback also failed ({e2}); returning empty")
            return {}

    # Helper to detect journaled share transactions on the ROLLOVER (sending) side.
    # Must say "Journaled" so we don't count non-conversion journals.
    def _is_rollover_journaled(tx):
        desc    = tx.get("description", "").upper()
        tx_type = (tx.get("type", "") or tx.get("transactionType", "") or "").upper()
        return (
            "JOURNALED" in desc
            or tx_type in ("JOURNALED_SHARES",)
            or bool(re.search(r'JOURNAL.*SHARES', desc, re.IGNORECASE))
        )

    # Helper to detect any INCOMING share transfer on the ROTH (receiving) side.
    # Schwab records the receiving leg under different descriptions depending on
    # account type and transaction origination — "Journaled Shares", "Received",
    # "Transfer of Assets", "RECEIVE_AND_DELIVER", etc. We accept any incoming
    # equity transfer; the authoritative confirmation is the matching rollover OUT leg.
    def _is_roth_incoming(tx):
        desc    = tx.get("description", "").upper()
        tx_type = (tx.get("type", "") or tx.get("transactionType", "") or "").upper()
        # Explicit matches
        if "JOURNALED" in desc:
            return True
        if tx_type in ("JOURNALED_SHARES", "RECEIVE_AND_DELIVER", "TRANSFER_OF_ASSETS"):
            return True
        if any(kw in desc for kw in ("RECEIVED", "TRANSFER", "JOURNAL", "IN KIND", "IN-KIND")):
            return True
        # Catch-all: any transaction that brings shares in (positive quantity)
        # Inline share extraction to avoid forward-reference of _tx_shares
        ti = tx.get("transferItems", [])
        raw_shares = abs(float(ti[0].get("amount", 0) or 0)) if ti else 0
        if raw_shares == 0:
            raw_shares = abs(float(tx.get("netQuantity") or tx.get("quantity", 0)))
        return raw_shares > 0

    # Filter for journaled transactions
    rollover_journaled = [tx for tx in rollover_all if _is_rollover_journaled(tx)]
    roth_journaled     = [tx for tx in roth_all     if _is_roth_incoming(tx)]
    
    if _VERBOSE:
        print(f"[schwab] Found {len(rollover_journaled)} journaled transactions in Rollover IRA")
    if _VERBOSE:
        print(f"[schwab] Found {len(roth_journaled)} journaled transactions in Roth IRA")
    
    # Debug: Dump full transferItems for first transaction
    if rollover_journaled:
        tx = rollover_journaled[0]
        ti = tx.get('transferItems', [])
        if ti:
            item = ti[0]
            if _DEBUG:
                if _VERBOSE:
                    print(f"[schwab] transferItems[0] keys: {list(item.keys())}")
                if _VERBOSE:
                    print(f"[schwab] transferItems[0]: {json.dumps(item, default=str)}")
    if roth_journaled:
        tx = roth_journaled[0]
        ti = tx.get('transferItems', [])
        if ti:
            item = ti[0]
            if _DEBUG:
                if _VERBOSE:
                    print(f"[schwab] Roth transferItems[0] keys: {list(item.keys())}")
                if _VERBOSE:
                    print(f"[schwab] Roth transferItems[0]: {json.dumps(item, default=str)}")

    # Helper to extract symbol from transaction
    def _extract_symbol(tx):
        """Extract symbol from transaction using multiple strategies."""
        # Strategy 1: transferItems instrument symbol
        for item in tx.get("transferItems", []):
            instrument = item.get("instrument", {})
            sym = instrument.get("symbol", "")
            if sym:
                return sym
        
        # Strategy 2: Parse from description
        desc = tx.get("description", "")
        
        # Pattern: "JOURNALED SHARES SMH" or "SMH VANECK SEMICONDUCTOR"
        # Common pattern: symbol at beginning, 1-5 uppercase letters
        words = desc.split()
        for word in words:
            # Look for uppercase ticker pattern
            if re.match(r'^[A-Z]{1,5}$', word):
                return word
            # Some have @ symbol: "SMH@380.11"
            if '@' in word:
                parts = word.split('@')
                if parts and re.match(r'^[A-Z]{1,5}$', parts[0]):
                    return parts[0]
        
        # Strategy 3: Extract from description using regex
        match = re.search(r'([A-Z]{1,5})\s+(?:ETF|FUND|INC|CORP)', desc, re.IGNORECASE)
        if match:
            return match.group(1)
        
        return None

    # Cache historical prices so we don't re-fetch yfinance for same symbol/date
    _hist_price_cache: Dict[str, float] = {}

    def _get_historical_close(symbol: str, date_str: str) -> float:
        """
        Fetch the closing price for symbol on date_str via yfinance.
        Returns 0.0 on any failure. Results are cached within this call.
        This is the authoritative source for conversion value — Schwab's
        instrument.closingPrice is the *current* close, not the historical one.
        """
        cache_key = f"{symbol}:{date_str}"
        if cache_key in _hist_price_cache:
            return _hist_price_cache[cache_key]
        try:
            import yfinance as yf
            from datetime import datetime as _dtt, timedelta as _td
            dt = _dtt.strptime(date_str, "%Y-%m-%d")
            # Fetch a 7-day window before + 2 days after to cover weekends/holidays
            start = (dt - _td(days=7)).strftime("%Y-%m-%d")
            end   = (dt + _td(days=2)).strftime("%Y-%m-%d")
            hist = yf.Ticker(symbol).history(start=start, end=end, auto_adjust=True)
            if hist.empty:
                _hist_price_cache[cache_key] = 0.0
                return 0.0
            # Strip timezone so comparison works
            hist.index = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
            # Take the last close on or before the target date
            prior = hist[hist.index <= dt]
            if prior.empty:
                prior = hist
            price = float(prior["Close"].iloc[-1])
            _hist_price_cache[cache_key] = price
            return price
        except Exception:
            _hist_price_cache[cache_key] = 0.0
            return 0.0

    def _extract_price_fallback(tx) -> float:
        """
        Extract price from Schwab transaction fields only (no yfinance).
        Returns 0.0 if transaction fields don't contain a usable price — caller
        will then try yfinance historical close.
        NEVER reads instrument.closingPrice — that is the *current* market close,
        not the historical price at time of journal.
        """
        # transferItems: cost/amount gives total-value ÷ shares = per-share price
        for item in tx.get("transferItems", []):
            cost = abs(float(item.get("cost", 0) or 0))
            amt  = abs(float(item.get("amount", 0) or 0))
            if cost > 0 and amt > 0:
                return cost / amt
            # direct per-share price field on transfer item
            p = item.get("price", 0)
            if p:
                return float(p)

        # Top-level price fields (present on some transaction types)
        for field in ("price", "transactionPrice", "unitPrice"):
            val = tx.get(field)
            if val:
                return float(val)

        # netAmount / shares — reliable only when netAmount is non-zero
        shares  = abs(float(tx.get("netQuantity") or tx.get("quantity", 0)))
        net_amt = abs(float(tx.get("netAmount", 0)))
        if shares > 0 and net_amt > 0:
            return net_amt / shares

        # Explicitly do NOT fall back to instrument.closingPrice here.
        # Schwab returns today's close in that field for all transactions.
        # If we get here, caller will use yfinance instead.
        return 0.0

    # ── Two-pass conversion matching ─────────────────────────────────────────
    # Pass 1 (Roth account — RECEIVING side):
    #   Schwab records the IRS cost basis and conversion price on the Roth side.
    #   Build a lookup map: (date, symbol, shares_rounded) → price
    #   This is the authoritative price source for in-kind conversions.
    #
    # Pass 2 (Rollover account — SENDING side):
    #   Schwab records shares leaving but typically no price (no cash exchanged).
    #   Look up price from the Roth map; fall back to Roth tx fields, then
    #   rollover tx fields; only use yfinance as a true last resort.

    def _tx_date(tx) -> str:
        """Extract date string from a Schwab transaction, trying all date fields."""
        # Use (field or "")[:10] — if Schwab returns null the key exists with value
        # None, so .get("field", "") returns None, not "". The `or ""` guards that.
        return (
            (tx.get("time")           or "")[:10] or
            (tx.get("tradeDate")      or "")[:10] or
            (tx.get("settlementDate") or "")[:10] or
            (tx.get("date")           or "")[:10] or
            str(_dt.now().date())
        )

    def _tx_shares(tx) -> float:
        """Extract share count from a Schwab transaction."""
        ti = tx.get("transferItems") or []
        if ti:
            amt = abs(float(ti[0].get("amount") or 0))
            if amt > 0:
                return amt
        return abs(float(tx.get("netQuantity") or tx.get("quantity") or tx.get("shares") or 0))

    # Pass 1: build Roth price map
    # key = (date, symbol, shares_rounded_0dp) → {price, cost, description}
    roth_price_map: Dict[tuple, Dict] = {}
    for tx in roth_journaled:
        sym    = _extract_symbol(tx)
        shares = _tx_shares(tx)
        date   = _tx_date(tx)
        if not sym or shares == 0 or not date:
            continue
        price = _extract_price_fallback(tx)
        # Round shares to 0 dp for matching tolerance
        key = (date, sym, round(shares))
        roth_price_map[key] = {
            "price":       price,
            "shares":      shares,
            "description": tx.get("description", ""),
        }
        if _VERBOSE:
            print(f"[schwab] Roth map: {key} → price=${price:.4f}")

    # Pass 2: process Rollover (source) — REQUIRE a matching Roth-side entry.
    #
    # Guardrail: a conversion is only counted when BOTH sides of the journal
    # are present and match on (date, symbol, shares_rounded). This prevents
    # the YTD total from being inflated by:
    #   • Journals out of the rollover IRA to destinations other than the
    #     tracked Roth IRA (e.g. another external account)
    #   • Journals into the Roth IRA from accounts we don't track (e.g. a
    #     closed prior-custodian rollover account) — these have no matching
    #     out-leg in our data and must NOT be counted alone
    # A true in-kind rollover→Roth conversion always produces two legs
    # (one OUT, one IN) with identical symbol/date/shares.
    conversions = []
    by_symbol: Dict[str, float] = {}
    total_shares_by_symbol: Dict[str, float] = {}
    total_converted_value = 0.0
    matched_roth_keys: set = set()
    unmatched_rollover: list = []

    SHARE_TOLERANCE = 0.5  # shares matched after round(); allow tiny drift

    for tx in rollover_journaled:
        sym    = _extract_symbol(tx)
        shares = _tx_shares(tx)
        date   = _tx_date(tx)

        if not sym:
            if _VERBOSE:
                print(f"[schwab] SKIP rollover tx (no symbol): {tx.get('description','')}")
            continue
        if shares == 0:
            if _VERBOSE:
                print(f"[schwab] SKIP rollover tx (no shares): {sym}")
            continue

        if _VERBOSE:
            print(f"[schwab] Rollover tx: {sym} {shares} shares on {date}")

        # Require a matching Roth-side leg (same date/symbol/shares). No match → skip.
        key = (date, sym, round(shares))
        roth_entry = roth_price_map.get(key)
        if not roth_entry or abs(roth_entry["shares"] - shares) > SHARE_TOLERANCE:
            unmatched_rollover.append({"date": date, "symbol": sym, "shares": shares})
            if _VERBOSE:
                print(f"[schwab]   SKIP — no matching Roth-in leg for {sym} {shares}@{date} "
                      f"(out-only journal; not counted as conversion)")
            continue

        matched_roth_keys.add(key)

        # ── Price resolution ──
        # Source 1: Roth account — IRS cost basis recorded by Schwab (authoritative)
        price = roth_entry["price"]

        # Source 2: Rollover tx fields (cost/amount, price, netAmount/shares)
        if price == 0.0:
            price = _extract_price_fallback(tx)

        # Source 3: yfinance historical close on conversion date — last resort only
        if price == 0.0:
            price = _get_historical_close(sym, date)
            if _VERBOSE and price > 0:
                print(f"[schwab]   yfinance fallback for {sym} on {date}: ${price:.4f}")

        if _VERBOSE:
            src = "roth-map" if roth_entry["price"] > 0 else \
                  "rollover-tx" if price > 0 else "yfinance"
            print(f"[schwab]   matched ✓ price={price:.4f} (source: {src})")

        conversion_value = round(price * shares, 2) if price > 0 else 0

        record = {
            "date":        date,
            "symbol":      sym,
            "description": tx.get("description", ""),
            "shares":      shares,
            "price":       price,
            "value":       conversion_value,
            "from_account": "rollover_ira",
            "to_account":   "roth_ira",
            "source_tx_id": tx.get("transactionId", ""),
            "matched":     True,
        }
        conversions.append(record)
        total_shares_by_symbol[sym] = total_shares_by_symbol.get(sym, 0) + shares
        by_symbol[sym] = by_symbol.get(sym, 0) + conversion_value
        total_converted_value += conversion_value

    # Diagnostics: log unmatched legs on either side. These are deliberately
    # NOT counted toward total_converted_ytd to avoid inflation.
    unmatched_roth = [
        {"date": d, "symbol": s, "shares": e["shares"]}
        for (d, s, _), e in roth_price_map.items()
        if (d, s, round(e["shares"])) not in matched_roth_keys
    ]
    if _VERBOSE and (unmatched_rollover or unmatched_roth):
        print(f"[schwab] Conversion guardrail: {len(unmatched_rollover)} unmatched rollover-out, "
              f"{len(unmatched_roth)} unmatched roth-in (NOT counted)")
        for u in unmatched_rollover:
            print(f"[schwab]   unmatched OUT: {u['symbol']} {u['shares']}@{u['date']}")
        for u in unmatched_roth:
            print(f"[schwab]   unmatched IN:  {u['symbol']} {u['shares']}@{u['date']} "
                  f"(likely journal from an untracked/closed account — ignored)")

    # Split current-year vs prior-Q4 conversions — only current-year counts
    # toward total_converted_ytd (the YTD figure used for tax planning).
    _conv_year_str = f"{_year}-01-01"
    curr_conversions    = sorted([c for c in conversions if c["date"] >= _conv_year_str],
                                  key=lambda c: c["date"])
    prev_q4_conversions = sorted([c for c in conversions if c["date"] <  _conv_year_str],
                                  key=lambda c: c["date"])

    # Recompute totals from current-year only
    total_converted_value    = sum(c["value"] for c in curr_conversions)
    total_shares_by_symbol   = {}
    by_symbol                = {}
    for c in curr_conversions:
        sym = c["symbol"]
        total_shares_by_symbol[sym] = total_shares_by_symbol.get(sym, 0) + c["shares"]
        by_symbol[sym]              = by_symbol.get(sym, 0) + c["value"]

    conversions = curr_conversions

    # Calculate average conversion price per symbol
    avg_price_by_symbol = {}
    for symbol, shares in total_shares_by_symbol.items():
        total_value = by_symbol.get(symbol, 0)
        if shares > 0:
            avg_price_by_symbol[symbol] = round(total_value / shares, 2)

    if _VERBOSE:
        print(f"[schwab] Matched {len(conversions)} conversions YTD, total=${total_converted_value:,.2f}")
    for c in conversions:
        if _VERBOSE:
            print(f"[schwab]   {c['date']}: {c['shares']:.3f} {c['symbol']} @ ${c['price']:.2f} = ${c['value']:,.2f}")

    result = {
        "year": _year,
        "conversions": conversions,
        "total_converted_ytd": round(total_converted_value, 2),
        "total_shares_converted": total_shares_by_symbol,
        "by_symbol": {k: round(v, 2) for k, v in by_symbol.items()},
        "avg_price_by_symbol": avg_price_by_symbol,
        "unmatched_rollover_out": unmatched_rollover,
        "unmatched_roth_in": unmatched_roth,
    }
    _conv_history_cache = result
    _conv_history_cache_date = _today_str
    return result


# ── Realized Capital Gains (SELL transactions, taxable account only) ──────────

_realized_gains_cache: dict = {}
_realized_gains_cache_date: str = ""
# How far back the one-time trade-history backfill reaches for BUY cost basis.
_TRADE_HISTORY_YEARS = 6

def get_realized_gains(year: int = None, force: bool = False) -> Dict[str, Any]:
    """
    Fetch YTD SELL transactions from the taxable account and compute
    realized capital gains (LTCG / STCG).

    Schwab's SELL transactions include `transferItems` with `cost` and
    `amount` (proceeds). We compute gain = proceeds − cost per item.
    Tax character (LTCG vs STCG) is approximated from the `description`
    field ("LONG TERM" / "SHORT TERM") if present; otherwise we check
    positions for average holding period heuristic.

    Returns:
    {
        "year": 2026,
        "total_ltcg":   12345.0,   # YTD realized long-term capital gains
        "total_stcg":    1234.0,   # YTD realized short-term capital gains
        "total_loss":    -500.0,   # YTD realized losses (negative)
        "net_gain":     13079.0,   # ltcg + stcg + losses
        "transactions": [
            {"date": "2026-04-15", "symbol": "SMH", "shares": 10.0,
             "proceeds": 5000.0, "cost": 4000.0, "gain": 1000.0,
             "gain_type": "LTCG"},
            ...
        ],
        "by_symbol": {"SMH": 1000.0, ...},
    }
    """
    import schwab.client as sc   # needs local import — not available at module load

    global _realized_gains_cache, _realized_gains_cache_date

    _today_str = datetime.now().strftime("%Y-%m-%d")
    if not force and _realized_gains_cache and _realized_gains_cache_date == _today_str:
        return _realized_gains_cache

    _cache_key = f"realized_gains_v13_{_today_str}"
    if force:
        # Bust both memory cache and disk cache so we re-fetch from Schwab
        _realized_gains_cache = {}
        _realized_gains_cache_date = ""
        try:
            _dbm.cache_delete(f"schwab:{_cache_key}")
        except Exception:
            pass
    _disk = _cache_load(_cache_key)
    if _disk and not force:
        if _VERBOSE:
            print(f"[schwab] realized gains: returning DISK cache "
                  f"(stcg=${_disk.get('total_stcg', 0):,.0f} "
                  f"ltcg=${_disk.get('total_ltcg', 0):,.0f}, "
                  f"{len(_disk.get('transactions', []))} txns)")
        _realized_gains_cache = _disk
        _realized_gains_cache_date = _today_str
        return _realized_gains_cache
    if _VERBOSE:
        print(f"[schwab] realized gains: no cache — running fresh fetch")

    client = get_client()
    if not client:
        # Fall back to most recent disk cache if live API unavailable
        _any = _cache_load("realized_gains_latest")
        return _any or {}

    hashes = get_account_hashes()
    taxable_hash = hashes.get("taxable")
    if not taxable_hash:
        return {}

    _year = year or datetime.now().year
    _curr_year_start = datetime(_year, 1, 1)
    _today = datetime.now()
    # end_dt = start of tomorrow so Schwab includes all of today's transactions
    _end_dt = datetime(_today.year, _today.month, _today.day) + timedelta(days=1)

    # ── Batched fetch strategy ────────────────────────────────────────────────
    # Historical data (Q4 prev year + months > 2 months ago) is fetched once
    # and stored in DB.  Only the rolling 2-month window is re-fetched each run.
    # This keeps each individual Schwab API call small (< 100 txns) and avoids
    # the ~400-transaction cap that silently drops recent trades on busy days.

    _fetch_errors: list = []

    def _fetch_range(s_dt, e_dt, label=""):
        """Fetch one date window from Schwab; return list of raw tx dicts."""
        try:
            resp = client.get_transactions(
                taxable_hash,
                start_date=s_dt,
                end_date=e_dt,
                transaction_types=sc.Client.Transactions.TransactionType.TRADE,
            )
            resp.raise_for_status()
            result = resp.json()
            txns = result if isinstance(result, list) else []
            if _VERBOSE:
                print(f"[schwab] realized_gains fetch {label}: {len(txns)} txns")
            return txns
        except Exception as _fe:
            print(f"[schwab] realized_gains fetch {label} error: {_fe}")
            _fetch_errors.append(label)
            return []

    def _raw_to_store_row(tx):
        """Extract the fields we need to store from a raw Schwab tx dict.

        Both SELL fills (net_amount > 0) and BUY fills (net_amount < 0) are
        kept: buys are the FIFO cost basis for positions that have since been
        sold and therefore no longer appear in the lots table.
        """
        import json as _j
        act_id = str(tx.get("activityId") or "")
        date_s = (tx.get("tradeDate") or tx.get("settleDate") or tx.get("time") or "")[:10]
        sym    = None
        shares = 0.0
        for item in tx.get("transferItems", []):
            instr = item.get("instrument", {})
            if instr.get("assetType") == "CURRENCY":
                continue
            s = instr.get("symbol") or instr.get("cusip")
            if s and not sym:
                sym = s
            shares += abs(float(item.get("amount", 0) or 0))
        net = float(tx.get("netAmount") or 0)
        if net == 0:
            # fallback: find positive CURRENCY cash leg
            for item in tx.get("transferItems", []):
                try:
                    if item.get("instrument", {}).get("assetType") == "CURRENCY":
                        cash = float(item.get("amount", 0) or 0)
                        if cash > 0:
                            net = cash
                            break
                except Exception:
                    pass
        if not act_id or not date_s or not sym or net == 0 or shares == 0:
            return None
        return {"activity_id": act_id, "trade_date": date_s, "symbol": sym,
                "shares": shares, "net_amount": net, "raw_json": _j.dumps(tx)}

    try:
        # ── 1. Backfill historical periods if not yet stored ─────────────────
        # Q4 of prior year
        _q4_key = f"{_year - 1}-Q4"
        if not _dbm.realized_txns_period_logged(_q4_key):
            _q4_txns = _fetch_range(
                datetime(_year - 1, 10, 1),
                datetime(_year, 1, 1),
                label=_q4_key,
            )
            _rows = [r for r in (_raw_to_store_row(t) for t in _q4_txns) if r]
            _dbm.realized_txns_upsert(_rows)
            _dbm.realized_txns_mark_period(_q4_key)

        # Each completed month of the current year up to 2 months ago
        _cutoff_month = _today.month - 2   # months strictly older than this are "historical"
        _cutoff_year  = _today.year
        if _cutoff_month <= 0:
            _cutoff_month += 12
            _cutoff_year  -= 1
        for _m in range(1, 13):
            _mk = f"{_year}-{_m:02d}"
            if _dbm.realized_txns_period_logged(_mk):
                continue
            # Only fetch months that are fully in the past (before cutoff)
            if (_year > _cutoff_year) or (_year == _cutoff_year and _m >= _cutoff_month):
                break
            _ms = datetime(_year, _m, 1)
            _me = datetime(_year, _m + 1, 1) if _m < 12 else datetime(_year + 1, 1, 1)
            _m_txns = _fetch_range(_ms, _me, label=_mk)
            _rows = [r for r in (_raw_to_store_row(t) for t in _m_txns) if r]
            _dbm.realized_txns_upsert(_rows)
            _dbm.realized_txns_mark_period(_mk)

        # ── 1b. One-time trade-history backfill (buys + sells) ───────────────
        # Sold positions need their original BUY fills for cost basis, and FIFO
        # needs every earlier sell to know which lots were already consumed.
        # Schwab serves several years of history but rejects ranges > 1 year,
        # so walk back in 360-day windows up to the rolling window.
        _hist_key = "trades-history-v1"
        if not _dbm.realized_txns_period_logged(_hist_key):
            _errs_before = len(_fetch_errors)
            _h_end = datetime(_cutoff_year, _cutoff_month, 1)
            _h_start = datetime(_year - _TRADE_HISTORY_YEARS, 1, 1)
            _s = _h_start
            while _s < _h_end:
                _e = min(_s + timedelta(days=360), _h_end)
                _h_txns = _fetch_range(_s, _e, label=f"history {_s.date()}→{_e.date()}")
                _dbm.realized_txns_upsert(
                    [r for r in (_raw_to_store_row(t) for t in _h_txns) if r])
                _s = _e
            if len(_fetch_errors) == _errs_before:
                _dbm.realized_txns_mark_period(_hist_key)

        # ── 2. Rolling window: always re-fetch last 2 months ─────────────────
        # Use INSERT OR REPLACE so corrections/late-settling trades are updated.
        _roll_start = datetime(
            _cutoff_year, _cutoff_month, 1
        )
        _roll_txns = _fetch_range(_roll_start, _end_dt, label="rolling-2mo")
        _rows = [r for r in (_raw_to_store_row(t) for t in _roll_txns) if r]
        _dbm.realized_txns_upsert_replace(_rows)

    except Exception as e:
        print(f"[schwab] realized gains fetch error: {e}")
        import traceback as _tb; _tb.print_exc()
        # Fall through — use whatever is in the DB

    # ── Load all stored raw txns and process them ────────────────────────────
    try:
        raw = _dbm.realized_txns_get_all()
    except Exception as e:
        print(f"[schwab] realized gains DB load error: {e}")
        raw = []

    # ── Build lot map from DB (single source of truth) ───────────────────────
    # Only symbols with lot data in the DB are eligible for gain calculation.
    # Sales of symbols not in _lot_map are ignored — no fallback guessing.
    _lot_map: Dict[str, list] = {}   # symbol → [{date, cost, qty}] oldest-first (FIFO)

    def _iso_date(raw: str) -> str:
        """Normalize any lot acquiredDate to YYYY-MM-DD for safe string comparison.
        Handles ISO format ('2026-01-12'), M/D/YY ('5/15/26'), and M/D/YYYY ('5/15/2026').
        """
        s = (raw or "").strip()[:10]
        if not s:
            return ""
        if len(s) >= 8 and s[4:5] == "-":   # already ISO
            return s[:10]
        try:                                  # M/D/YY or MM/DD/YY
            return datetime.strptime(s, "%m/%d/%y").strftime("%Y-%m-%d")
        except ValueError:
            pass
        try:                                  # M/D/YYYY or MM/DD/YYYY
            return datetime.strptime(s, "%m/%d/%Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
        return s  # return as-is; comparisons may be unreliable but won't crash

    try:
        _cb_data = _dbm.lots_get_for_editor()
        for _sym, _sym_data in _cb_data.items():
            _lots = []
            for _l in _sym_data.get("lots", []):
                _lqty  = float(_l.get("quantity", 0) or 0)
                _lcost = float(_l.get("costPerShare", 0) or 0)
                _ldate = _iso_date(_l.get("acquiredDate") or "")
                if _lqty > 0 and _lcost > 0 and _ldate:
                    _lots.append({"date": _ldate, "cost": _lcost, "qty": _lqty})
            if _lots:
                _lot_map[_sym] = sorted(_lots, key=lambda l: l["date"])
    except Exception as _e:
        import traceback
        print(f"[schwab] realized gains: lots table load FAILED: {_e}")
        traceback.print_exc()

    # Merge sold-lot history so FIFO can match shares that are no longer held.
    try:
        _sold_map = _dbm.get_lot_sales_map()
        for _sym, _sold_lots in _sold_map.items():
            existing = _lot_map.get(_sym, [])
            existing_dates = {l["date"] for l in existing}
            added = [l for l in _sold_lots if l["date"] not in existing_dates]
            if added:
                _lot_map[_sym] = sorted(existing + added, key=lambda l: l["date"])
    except Exception as _e:
        import traceback
        print(f"[schwab] realized gains: lot_sales merge FAILED: {_e}")
        traceback.print_exc()

    # Rebuild lots from stored BUY fills. The lots table only holds what is
    # held today (plus sold lots captured by lot_sales), so a position that
    # was fully sold — or bought and sold between lot syncs — has no basis
    # there. On a date the lots table already covers, only the bought shares
    # beyond what it holds are added (the lots table keeps the *remaining*
    # quantity of a partly-sold lot), so a share is never counted twice.
    _buy_lots: Dict[str, list] = {}
    for tx in (raw if isinstance(raw, list) else []):
        try:
            if float(tx.get("netAmount") or 0) >= 0:
                continue
            _bdate = (tx.get("tradeDate") or tx.get("settleDate") or tx.get("time") or "")[:10]
            for item in tx.get("transferItems", []):
                instr = item.get("instrument", {})
                if instr.get("assetType") == "CURRENCY":
                    continue
                _bsym = instr.get("symbol") or instr.get("cusip")
                _bqty = float(item.get("amount", 0) or 0)
                _bpx  = float(item.get("price", 0) or 0)
                if not _bsym or _bqty <= 0 or _bsym in _KNOWN_MMF:
                    continue
                if _bpx <= 0:
                    _bpx = abs(float(tx.get("netAmount") or 0)) / _bqty
                if _bpx <= 1.10:          # stable-NAV money market
                    continue
                _buy_lots.setdefault(_bsym, []).append({"date": _bdate, "cost": _bpx, "qty": _bqty})
                break
        except (TypeError, ValueError):
            continue
    for _sym, _blots in _buy_lots.items():
        existing = _lot_map.get(_sym, [])
        _have: Dict[str, float] = {}
        for l in existing:
            _have[l["date"]] = _have.get(l["date"], 0.0) + l["qty"]
        _by_date: Dict[str, list] = {}
        for l in _blots:
            _by_date.setdefault(l["date"], []).append(l)
        added = []
        for _d, _ls in _by_date.items():
            _bought = sum(l["qty"] for l in _ls)
            _extra  = _bought - _have.get(_d, 0.0)
            if _extra > 0.001:
                _avg = sum(l["qty"] * l["cost"] for l in _ls) / _bought
                added.append({"date": _d, "cost": _avg, "qty": _extra})
        if added:
            _lot_map[_sym] = sorted(existing + added, key=lambda l: l["date"])

    def _safe_net(tx):
        try:
            return float(tx.get("netAmount") or 0)
        except (TypeError, ValueError):
            return 0.0

    if _VERBOSE:
        print(f"[schwab] realized gains: {len(_lot_map)} symbols with lot data")

    transactions = []          # current-year transactions only
    prev_q4_transactions = []  # Sep–Dec of prior year
    # Current-year totals (used for annual tax estimate)
    total_ltcg      = 0.0
    total_stcg      = 0.0
    total_loss      = 0.0
    total_stcg_loss = 0.0   # STCG losses only (negative); tracked separately for net netting
    total_ltcg_loss = 0.0   # LTCG losses only (negative)
    by_symbol: Dict[str, float] = {}
    by_symbol_ltcg: Dict[str, float] = {}
    by_symbol_stcg: Dict[str, float] = {}
    # Prior-Q4 totals (Sep–Dec of prev year; due Jan 15 of current year)
    prev_q4_ltcg = 0.0
    prev_q4_stcg = 0.0
    prev_q4_loss = 0.0
    _curr_year_str = _curr_year_start.strftime("%Y-%m-%d")
    _prev_q4_str   = f"{_year - 1}-10-01"
    unmatched: Dict[str, float] = {}   # symbol → shares sold with no lot to match

    # Stateful FIFO: build a mutable lot queue per symbol (deep-copy so we can
    # consume shares).  Sells are processed in chronological order so each
    # consumption correctly reflects which lots were still available at the time.
    _lot_queue: Dict[str, list] = {
        sym: [dict(l) for l in lots]
        for sym, lots in _lot_map.items()
    }

    # Sort all transactions oldest-first so FIFO consumption is correct across
    # multiple sells of the same symbol within the reporting window.
    # Each tx is wrapped in a try/except: Schwab occasionally returns
    # `netAmount: null` for special transactions, and a single bad row must
    # not crash the entire pre-filter (which would drop ALL sells).
    def _sell_net_amt(tx):
        """Return the net proceeds for a sell transaction.

        Schwab returns netAmount=null for some ETF types (e.g. COLLECTIVE_INVESTMENT).
        Fall back to: sum of positive CURRENCY legs, then abs(shares)×price from the
        CLOSING security leg, so those transactions are not silently dropped.
        """
        try:
            net = float(tx.get("netAmount") or 0)
            if net > 0:
                return net
        except (TypeError, ValueError):
            pass
        # Fallback 1: cash leg (CURRENCY item with positive amount = proceeds received)
        for item in tx.get("transferItems", []):
            try:
                if item.get("instrument", {}).get("assetType") == "CURRENCY":
                    cash = float(item.get("amount", 0) or 0)
                    if cash > 0:
                        return cash
            except (TypeError, ValueError):
                pass
        # Fallback 2: derive from CLOSING security leg (shares × sale price)
        for item in tx.get("transferItems", []):
            try:
                if item.get("positionEffect") == "CLOSING":
                    shares = abs(float(item.get("amount", 0) or 0))
                    price  = float(item.get("price", 0) or 0)
                    if shares > 0 and price > 0:
                        return shares * price
            except (TypeError, ValueError):
                pass
        return 0.0

    _raw_sells = sorted(
        [tx for tx in (raw if isinstance(raw, list) else [])
         if _sell_net_amt(tx) > 0],
        key=lambda tx: (tx.get("tradeDate") or tx.get("settleDate") or tx.get("time") or ""),
    )
    if _DEBUG:
        print(f"[schwab] realized gains: {len(_raw_sells)} SELL transactions to process "
              f"(stored range {_raw_sells[0].get('tradeDate','')[:10] if _raw_sells else '?'} → {_raw_sells[-1].get('tradeDate','')[:10] if _raw_sells else '?'})")
        for _dbg_tx in _raw_sells:
            _dbg_sym = None
            for _dbg_item in _dbg_tx.get("transferItems", []):
                if _dbg_item.get("instrument", {}).get("assetType") != "CURRENCY":
                    _dbg_sym = _dbg_item.get("instrument", {}).get("symbol") or _dbg_item.get("instrument", {}).get("cusip")
                    break
            print(f"[schwab] sell: {(_dbg_tx.get('tradeDate') or '')[:10]} "
                  f"sym={_dbg_sym} net=${_dbg_tx.get('netAmount',0):,.2f} "
                  f"in_lots={'yes' if _dbg_sym in _lot_map else 'NO'}")

    for tx in _raw_sells:
        try:
            # Sells have positive netAmount (cash received); buys are negative.
            # Use _sell_net_amt for consistency — handles null netAmount fallback.
            net_amt = _sell_net_amt(tx)
            if net_amt <= 0:
                continue

            date_str = (tx.get("tradeDate") or tx.get("settleDate") or tx.get("time") or "")[:10]

            # Find the security leg — skip CURRENCY_USD fee/settlement items.
            # The security item has positionEffect=CLOSING and a non-CURRENCY assetType.
            symbol     = None
            sym_atype  = None   # assetType of the security leg
            shares     = 0.0
            for item in tx.get("transferItems", []):
                instr = item.get("instrument", {})
                atype = instr.get("assetType", "")
                if atype == "CURRENCY":
                    continue   # skip cash legs (fees, settlement)
                sym_cand = instr.get("symbol") or instr.get("cusip")
                if not sym_cand:
                    continue
                if not symbol:
                    symbol    = sym_cand
                    sym_atype = atype
                # Shares are reported as negative `amount` (outgoing = sold)
                item_amt = float(item.get("amount", 0) or 0)
                if item_amt < 0:
                    shares += abs(item_amt)

            if not symbol or shares == 0:
                continue

            # Skip money-market redemptions — not a taxable capital-gains event.
            # Three detection layers:
            #   1. Known MMF tickers (same set used by position parsing)
            #   2. MUTUAL_FUND asset type with proceeds/share ≤ $1.10 (stable $1 NAV)
            #   3. Any symbol whose computed price is ≤ $1.10 (catches CUSIPs)
            price_per_share = net_amt / shares if shares > 0 else 0
            if (symbol in _KNOWN_MMF
                    or (sym_atype == "MUTUAL_FUND" and price_per_share <= 1.10)
                    or price_per_share <= 1.10):
                continue

            proceeds    = net_amt   # netAmount = sale proceeds net of fees
            sale_price  = proceeds / shares if shares > 0 else 0.0

            # Skip if no lot data — only holdings tracked in the DB are counted.
            if symbol not in _lot_map:
                continue

            _sale_dt   = datetime.strptime(date_str, "%Y-%m-%d") if date_str else None
            _st_cutoff = (_sale_dt.replace(year=_sale_dt.year - 1).strftime("%Y-%m-%d")
                          if _sale_dt else "")

            _stcg_gain = 0.0
            _ltcg_gain = 0.0

            # Stateful FIFO: consume oldest lots first, mutating qty in-place.
            # Guard: only consume lots acquired ON OR BEFORE the sale date.
            # This prevents a prior-era sell (before a re-purchase) from
            # incorrectly consuming lots from the new ownership period.
            # e.g. sold SPYI Oct 2025, re-bought Dec 2025; May 2026 sell
            # must not have its lots consumed by the Oct 2025 sell.
            remaining = shares
            for lot in _lot_queue.get(symbol, []):
                if remaining <= 0:
                    break
                if lot["qty"] <= 0:
                    continue
                if lot["date"] > date_str:   # lot acquired after this sell — skip
                    continue
                matched  = min(lot["qty"], remaining)
                lot_gain = (sale_price - lot["cost"]) * matched
                if lot["date"] > _st_cutoff:   # held ≤ 365 days → STCG
                    _stcg_gain += lot_gain
                else:
                    _ltcg_gain += lot_gain
                lot["qty"]  -= matched
                remaining   -= matched
            # Shares beyond available lots are skipped (no fallback guessing) —
            # surfaced in `unmatched_sells` so missing basis is visible.
            if remaining > 0.001 and date_str >= _prev_q4_str:
                unmatched[symbol] = unmatched.get(symbol, 0.0) + remaining

            # Older sells only exist to consume FIFO lots; they aren't reported.
            if date_str < _prev_q4_str:
                continue

            gain      = _stcg_gain + _ltcg_gain
            cost      = proceeds - gain   # implied cost for display
            gain_type = ("LTCG" if _ltcg_gain >= abs(_stcg_gain) else "STCG") if gain >= 0 else (
                         "LOSS_LTCG" if _ltcg_gain <= _stcg_gain else "LOSS_STCG")

            txn_rec = {
                "date":      date_str,
                "symbol":    symbol,
                "shares":    round(shares, 3),
                "proceeds":  round(proceeds, 2),
                "cost":      round(cost, 2),
                "gain":      round(gain, 2),
                "stcg":      round(_stcg_gain, 2),
                "ltcg":      round(_ltcg_gain, 2),
                "gain_type": gain_type,
            }

            if _VERBOSE:
                print(f"[schwab] realized gains: ACCEPT {symbol} {date_str} "
                      f"shares={shares:.0f} proceeds=${proceeds:,.0f} cost=${cost:,.0f} "
                      f"stcg=${_stcg_gain:,.0f} ltcg=${_ltcg_gain:,.0f} type={gain_type}")

            # Split into current-year vs prior-Q4 (Sep–Dec of previous year)
            is_prev_q4 = bool(date_str) and date_str < _curr_year_str
            if is_prev_q4:
                prev_q4_transactions.append(txn_rec)
                if _stcg_gain > 0: prev_q4_stcg += _stcg_gain
                if _ltcg_gain > 0: prev_q4_ltcg += _ltcg_gain
                if _stcg_gain < 0 or _ltcg_gain < 0:
                    prev_q4_loss += min(_stcg_gain, 0) + min(_ltcg_gain, 0)
            else:
                transactions.append(txn_rec)
                by_symbol[symbol] = by_symbol.get(symbol, 0.0) + gain
                if _stcg_gain > 0:
                    total_stcg += _stcg_gain
                    by_symbol_stcg[symbol] = by_symbol_stcg.get(symbol, 0.0) + _stcg_gain
                elif _stcg_gain < 0:
                    total_loss      += _stcg_gain
                    total_stcg_loss += _stcg_gain
                if _ltcg_gain > 0:
                    total_ltcg += _ltcg_gain
                    by_symbol_ltcg[symbol] = by_symbol_ltcg.get(symbol, 0.0) + _ltcg_gain
                elif _ltcg_gain < 0:
                    total_loss      += _ltcg_gain
                    total_ltcg_loss += _ltcg_gain

        except Exception as _ex:
            import traceback
            print(f"[schwab] realized gains PARSE ERROR: {_ex}")
            traceback.print_exc()
            continue

    result = {
        "year":         _year,
        # Current-year totals — used for annual tax estimate
        "total_ltcg":   round(total_ltcg, 2),       # gross LTCG gains only (positive)
        "total_stcg":   round(total_stcg, 2),       # gross STCG gains only (positive)
        "total_loss":   round(total_loss, 2),        # all losses combined (negative)
        "total_stcg_loss": round(total_stcg_loss, 2),  # STCG losses only (negative)
        "total_ltcg_loss": round(total_ltcg_loss, 2),  # LTCG losses only (negative)
        # Net figures: gains + matching losses — used for correct tax calculation
        "net_stcg":     round(total_stcg + total_stcg_loss, 2),
        "net_ltcg":     round(total_ltcg + total_ltcg_loss, 2),
        "net_gain":     round(total_ltcg + total_stcg + total_loss, 2),
        "transactions": sorted(transactions, key=lambda x: x["date"], reverse=True),
        "by_symbol": {
            k: {
                "gain": round(v, 2),
                "type": "LTCG" if by_symbol_ltcg.get(k, 0) >= by_symbol_stcg.get(k, 0) else "STCG",
            }
            for k, v in by_symbol.items()
        },
        # Prior-Q4 totals — Sep–Dec of previous year; tax due Jan 15 of current year
        "prev_q4_ltcg":         round(prev_q4_ltcg, 2),
        "prev_q4_stcg":         round(prev_q4_stcg, 2),
        "prev_q4_loss":         round(prev_q4_loss, 2),
        "prev_q4_transactions": sorted(prev_q4_transactions, key=lambda x: x["date"], reverse=True),
        # Shares sold (prior Q4 onward) that had no lot or BUY fill to match — gain understated
        "unmatched_sells":      {k: round(v, 3) for k, v in unmatched.items()},
    }
    _realized_gains_cache = result
    _realized_gains_cache_date = _today_str
    # Persist to disk so realized gains survive server restarts
    _cache_save(_cache_key, result)
    _cache_save("realized_gains_latest", result)
    prev_q4_count = len(prev_q4_transactions)
    if _VERBOSE:
        print(f"[schwab] realized gains: {len(transactions)} curr-year SELL tx — "
              f"LTCG ${total_ltcg:,.0f} / STCG ${total_stcg:,.0f} / Loss ${total_loss:,.0f}"
              + (f" | prev-Q4: {prev_q4_count} tx LTCG ${prev_q4_ltcg:,.0f} STCG ${prev_q4_stcg:,.0f}" if prev_q4_count else ""))
    return result