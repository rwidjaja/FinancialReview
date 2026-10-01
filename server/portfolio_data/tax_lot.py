"""portfolio_data.tax_lot — persistent caches for cost basis, confidence,
trends, and positions snapshots (file-backed)."""

from datetime import datetime, timezone, timedelta, date as _date
from typing import Any, Dict, Optional

import db_manager as _dbm

def _load_cost_basis_analysis(live_prices: dict = None, active_symbols: set = None) -> dict:
    """
    Read the lots table and compute:
      - Per-symbol LTCG/STCG split (gains & shares)
      - Maturity calendar: sorted list of dates when each lot flips to LTCG
      - Aggregate totals

    live_prices: optional {symbol: current_price} from live positions data.
    When provided, gain/loss is computed as (live_price - costPerShare) * quantity
    so the amounts reflect today's market rather than the snapshot in the file.

    active_symbols: optional set of symbols currently held in the taxable account.
    When provided (non-empty), scopes this analysis to those symbols only — the
    lots table is an append/update cache and can retain rows for positions that
    have since been fully sold, which would otherwise overstate unrealized
    STCG/LTCG gain used in real tax-bracket and sale-timing decisions. Deliberately
    NOT keyed off live_prices, since a missing price quote shouldn't make a real
    holding disappear from these totals — only an actual zero share count should.
    """
    _raw = _dbm.lots_get_raw()
    if not _raw:
        return {}

    _today = datetime.now(timezone.utc).date()
    # IRS: long-term = held MORE than 12 months.
    # The first day you can sell for LTCG is acquisition_date + 366 days
    # (e.g. buy Jan 1 → first LTCG sale: Jan 2 of the following year).
    _lt_threshold = timedelta(days=366)

    _by_symbol: dict = {}
    _maturity_events: list = []

    _active_syms = active_symbols or set()

    for _sym, _sym_data in _raw.items():
        if _active_syms and _sym not in _active_syms:
            continue
        _stcg_gain  = 0.0
        _stcg_loss  = 0.0
        _ltcg_gain  = 0.0
        _ltcg_loss  = 0.0
        _stcg_shares = 0
        _ltcg_shares = 0
        _next_flip: _date | None = None
        _lots_out: list = []

        # Live price for this symbol (None if unavailable — fall back to file value)
        _live_price = (live_prices or {}).get(_sym)

        for _lot in _sym_data.get("lots", []):
            _acq_str = _lot.get("acquiredDate", "")
            if not _acq_str:
                continue
            try:
                _acq_date = _date.fromisoformat(_acq_str[:10])
            except ValueError:
                try:
                    _acq_date = datetime.strptime(_acq_str.strip(), "%m/%d/%y").date()
                except ValueError:
                    continue

            _lt_date    = _acq_date + _lt_threshold
            _is_lt      = _today >= _lt_date
            _days_to_lt = max(0, (_lt_date - _today).days)
            _qty        = float(_lot.get("quantity", 0))
            if _qty <= 0:
                continue

            # Prefer live gain (current price − cost basis × shares) over file snapshot.
            _cost_per_share = float(_lot.get("costPerShare", 0.0))
            if _live_price and _live_price > 0 and _cost_per_share > 0:
                _gain = (_live_price - _cost_per_share) * _qty
            else:
                _gain = float(_lot.get("gainLoss", 0.0))

            if _is_lt:
                _ltcg_shares += _qty
                if _gain >= 0:
                    _ltcg_gain += _gain
                else:
                    _ltcg_loss += _gain
            else:
                _stcg_shares += _qty
                if _gain >= 0:
                    _stcg_gain += _gain
                else:
                    _stcg_loss += _gain
                # Track upcoming maturity event
                if _next_flip is None or _lt_date < _next_flip:
                    _next_flip = _lt_date
                _maturity_events.append({
                    "date":         _lt_date.isoformat(),
                    "symbol":       _sym,
                    "shares":       _qty,
                    "gain":         round(_gain, 2),
                    "days_away":    _days_to_lt,
                    "cost_basis":   round(float(_lot.get("costBasis",    0.0)), 2),
                    "market_value": round((_live_price * _qty) if _live_price else float(_lot.get("marketValue", 0.0)), 2),
                    "acq_date":     _acq_date.isoformat(),
                })

            _live_mkt_val = round((_live_price * _qty) if _live_price else float(_lot.get("marketValue", 0.0)), 2)
            _cost_basis_lot = round(float(_lot.get("costBasis", 0.0)), 2)
            _gain_pct = round((_gain / _cost_basis_lot * 100) if _cost_basis_lot else 0.0, 2)
            _lots_out.append({
                "acquired_date":   _acq_date.isoformat(),
                "lt_date":         _lt_date.isoformat(),
                "quantity":        _qty,
                "cost_per_share":  round(_cost_per_share, 2),
                "gain_loss":       round(_gain, 2),
                "gain_loss_pct":   _gain_pct,
                "market_value":    _live_mkt_val,
                "cost_basis":      _cost_basis_lot,
                "is_ltcg":         _is_lt,
                "days_to_lt":      _days_to_lt,
            })

        _by_symbol[_sym] = {
            "account":           _sym_data.get("account", ""),
            "stcg_gain":         round(_stcg_gain,  0),
            "stcg_loss":         round(_stcg_loss,  0),
            "ltcg_gain":         round(_ltcg_gain,  0),
            "ltcg_loss":         round(_ltcg_loss,  0),
            "stcg_shares":       _stcg_shares,
            "ltcg_shares":       _ltcg_shares,
            "total_unrealized":  round(_stcg_gain + _ltcg_gain + _stcg_loss + _ltcg_loss, 0),
            "next_lt_flip_date": _next_flip.isoformat() if _next_flip else None,
            "days_to_next_lt":   (_next_flip - _today).days if _next_flip else None,
            "lots":              _lots_out,
        }

    _maturity_events.sort(key=lambda x: x["date"])

    return {
        "by_symbol":                  _by_symbol,
        "maturity_calendar":          _maturity_events,
        "total_stcg_unrealized_gain": round(sum(v["stcg_gain"]  for v in _by_symbol.values()), 0),
        "total_ltcg_unrealized_gain": round(sum(v["ltcg_gain"]  for v in _by_symbol.values()), 0),
        "total_stcg_unrealized_loss": round(sum(v["stcg_loss"]  for v in _by_symbol.values()), 0),
        "total_ltcg_unrealized_loss": round(sum(v["ltcg_loss"]  for v in _by_symbol.values()), 0),
    }


def _read_prev_confidence() -> Optional[float]:
    """Return yesterday's system confidence score (None if unavailable or stale > 30 h)."""
    import time
    result = _dbm.cache_get_ts("confidence")
    if result is None:
        return None
    val, ts = result
    if (time.time() - ts) < 108000:   # 30-hour window
        return float(val) if val is not None else None
    return None


def _write_confidence(score: float) -> None:
    """Persist today's confidence score for trend comparison."""
    try:
        _dbm.cache_set("confidence", score)
    except Exception:
        pass


def _load_trends_cache() -> Dict[str, Any]:
    """Load yesterday's analytics for trend comparisons. Returns {} if unavailable or > 48h old."""
    import time
    result = _dbm.cache_get_ts("trends")
    if result is None:
        return {}
    data, ts = result
    if (time.time() - ts) > 172800:   # 48-hour TTL
        return {}
    return data if isinstance(data, dict) else {}


def _save_trends_cache(data: Dict[str, Any]) -> None:
    """Persist today's analytics metrics so tomorrow's run can compute trend arrows."""
    try:
        _dbm.cache_set("trends", data)
    except Exception:
        pass


def _save_positions_snapshot(schwab_snap: dict) -> None:
    """Persist live Schwab positions to database after every successful fetch (daily fallback)."""
    import time
    try:
        ts = time.time()
        timestamp = datetime.now(timezone.utc).isoformat()
        accounts: Dict[str, Any] = {
            acct_key: {
                "positions": {
                    sym: {"shares": pos["shares"], "cost_per_share": pos["cost_per_share"]}
                    for sym, pos in acct_data.get("positions", {}).items()
                }
            }
            for acct_key, acct_data in schwab_snap.get("accounts", {}).items()
        }
        _dbm.snapshot_save(ts, timestamp, accounts)
    except Exception:
        pass


def _load_positions_snapshot() -> Optional[Dict[str, Any]]:
    """Return cached positions {acct_key: {positions: {...}}} if available and < 48 hours old."""
    import time
    result = _dbm.snapshot_load()
    if result is None:
        return None
    accounts, ts, timestamp = result
    age_hours = (time.time() - ts) / 3600
    print(f"[portfolio] Loaded cached positions from {timestamp} ({age_hours:.1f}h ago).")
    return accounts
