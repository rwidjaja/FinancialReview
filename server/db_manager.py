"""
db_manager.py — SQLite backing store for all non-config runtime state.

Replaces these JSON files:
  _confidence_cache.json   → cache_kv  key="confidence"
  _trends_cache.json       → cache_kv  key="trends"
  _conversion_cache.json   → cache_kv  key="conversion"
  _perf_cache.json         → cache_kv  key="perf_YYYY-MM-DD"
  _schwab_api_cache.json   → cache_kv  key varies (schwab_client uses key per endpoint)
  _eod_values.json         → eod_values table
  _positions_snapshot.json → positions_snapshot table
  price_alerts.json        → price_alerts table
  lots (cost basis)        → lots table (managed via the Cost Basis Editor UI)

Files intentionally kept as JSON (user-editable config / credentials):
  input.json, account_mapping.json, target_*.json, ai_keys.json,
  schwab_credentials.json, .schwab_token.json,
  fallback_data.json  ← static metadata only (expense_ratio, coverage_ratio, aum)
                         NAVs moved to nav_cache table (refreshed daily from holdings)
"""

import json
import os
import sqlite3
import threading
import time
from typing import Any, Optional

_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard.db")
_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
_local = threading.local()


# ── Connection ────────────────────────────────────────────────────────────────

def _conn() -> sqlite3.Connection:
    if not hasattr(_local, "db") or _local.db is None:
        c = sqlite3.connect(_DB_PATH, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA foreign_keys=ON")
        _local.db = c
    return _local.db


# ── Schema ────────────────────────────────────────────────────────────────────

def _init_schema() -> None:
    c = _conn()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS cache_kv (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            ts    REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS eod_values (
            symbol       TEXT NOT NULL,
            trade_date   TEXT NOT NULL,
            market_value REAL,
            shares       REAL,
            price        REAL,
            updated_at   TEXT NOT NULL,
            PRIMARY KEY (symbol, trade_date)
        );

        CREATE TABLE IF NOT EXISTS positions_snapshot (
            account        TEXT NOT NULL,
            symbol         TEXT NOT NULL,
            shares         REAL,
            cost_per_share REAL,
            ts             REAL NOT NULL,
            updated_at     TEXT NOT NULL,
            PRIMARY KEY (account, symbol)
        );

        CREATE TABLE IF NOT EXISTS price_alerts (
            id              TEXT PRIMARY KEY,
            symbol          TEXT NOT NULL,
            direction       TEXT NOT NULL,
            mode            TEXT NOT NULL,
            threshold       REAL NOT NULL,
            base_price      REAL NOT NULL,
            created_at      TEXT NOT NULL,
            active          INTEGER NOT NULL DEFAULT 1,
            triggered       INTEGER NOT NULL DEFAULT 0,
            triggered_at    TEXT,
            triggered_price REAL,
            notes           TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON price_alerts(symbol);
        CREATE INDEX IF NOT EXISTS idx_alerts_active  ON price_alerts(active, triggered);

        CREATE TABLE IF NOT EXISTS lots (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol         TEXT NOT NULL,
            account        TEXT NOT NULL DEFAULT '',
            acquired_date  TEXT NOT NULL,
            quantity       REAL NOT NULL,
            cost_per_share REAL NOT NULL,
            cost_basis     REAL,
            market_value   REAL,
            gain_loss      REAL,
            gain_loss_pct  REAL,
            holding_period TEXT,
            snapshot_price REAL,
            as_of_date     TEXT,
            imported_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_lots_symbol ON lots(symbol);

        -- Tracks lots removed on each save (= sold shares).
        -- Accumulated over time; combined with current `lots` to reconstruct full
        -- lot history for FIFO gain classification in get_realized_gains().
        CREATE TABLE IF NOT EXISTS lot_sales (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol         TEXT NOT NULL,
            account        TEXT NOT NULL DEFAULT '',
            acquired_date  TEXT NOT NULL,
            quantity       REAL NOT NULL,
            cost_per_share REAL NOT NULL,
            detected_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_lot_sales_symbol ON lot_sales(symbol);
        CREATE INDEX IF NOT EXISTS idx_lot_sales_sym_dt ON lot_sales(symbol, acquired_date);

        -- Append-only history of structured signals produced by server/signals/
        -- after each fetch_all_data refresh. Lets the UI show "today's signals"
        -- and a future longitudinal layer narrate "fragility trended up 9 months".
        CREATE TABLE IF NOT EXISTS signals_history (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            as_of        TEXT NOT NULL,                  -- YYYY-MM-DD from fetch_all_data timestamp
            kind         TEXT NOT NULL,                  -- stable detector identifier
            symbol       TEXT,                           -- nullable for portfolio-wide signals
            severity     TEXT NOT NULL,                  -- info | warn | crit
            headline     TEXT NOT NULL,
            details_json TEXT NOT NULL DEFAULT '{}',
            tab          TEXT,                           -- target UI tab for chip click
            recorded_at  REAL NOT NULL                   -- unix epoch when row was inserted
        );
        CREATE INDEX IF NOT EXISTS idx_signals_as_of ON signals_history(as_of);
        CREATE INDEX IF NOT EXISTS idx_signals_kind  ON signals_history(kind, symbol);

        -- One-row-per-day snapshot of derived analytics (portfolio value,
        -- vol budget, fragility, bracket pressure, regimes, top holding…).
        -- Drives the "vs yesterday" diffs in the AI tab briefing. Primary
        -- key on as_of so a same-day refresh overwrites the row in-place.
        CREATE TABLE IF NOT EXISTS analytics_history (
            as_of         TEXT PRIMARY KEY,            -- YYYY-MM-DD
            snapshot_json TEXT NOT NULL DEFAULT '{}',
            recorded_at   REAL NOT NULL                -- unix epoch of last write
        );

        -- Daily NAV cache for CEFs and option-income ETFs.
        -- Refreshed each market open from current holdings so it automatically
        -- tracks what you actually hold — no manual list needed.
        -- fallback_data.json retains only slow-changing metadata
        -- (expense_ratio, coverage_ratio, aum).
        CREATE TABLE IF NOT EXISTS nav_cache (
            symbol     TEXT PRIMARY KEY,
            nav        REAL NOT NULL,
            source     TEXT NOT NULL DEFAULT 'yfinance',  -- 'yfinance' | 'manual'
            updated_at TEXT NOT NULL                       -- YYYY-MM-DD HH:MM
        );

        -- Portfolio balance captured at market open (9:30 ET) and close (16:00 ET).
        -- One row per trading day per label — INSERT OR REPLACE keeps it idempotent.
        CREATE TABLE IF NOT EXISTS balance_snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          REAL    NOT NULL,       -- Unix epoch (UTC)
            date        TEXT    NOT NULL,       -- YYYY-MM-DD  (ET trading date)
            label       TEXT    NOT NULL,       -- 'open' | 'close'
            total_value REAL    NOT NULL,       -- total portfolio value in USD
            recorded_at TEXT    NOT NULL,       -- ISO-8601 UTC
            UNIQUE(date, label)
        );
        CREATE INDEX IF NOT EXISTS idx_balance_snapshots_date
            ON balance_snapshots(date DESC);

        -- Raw Schwab transactions stored per account so the 60-day API window
        -- doesn't erase history. Upsert by (account_type, tx_date, symbol, shares)
        -- keeps it idempotent across refreshes.
        CREATE TABLE IF NOT EXISTS schwab_transactions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            account_type TEXT    NOT NULL,   -- rollover_ira | roth_ira | taxable
            tx_date      TEXT    NOT NULL,   -- YYYY-MM-DD
            tx_type      TEXT    NOT NULL,   -- JOURNALED_SHARES | DIVIDEND | TRADE …
            symbol       TEXT    NOT NULL,
            description  TEXT    NOT NULL DEFAULT '',
            shares       REAL    NOT NULL DEFAULT 0,
            price        REAL    NOT NULL DEFAULT 0,
            value        REAL    NOT NULL DEFAULT 0,
            tx_id        TEXT    NOT NULL DEFAULT '',
            raw_json     TEXT    NOT NULL DEFAULT '{}',
            fetched_at   TEXT    NOT NULL,   -- ISO-8601 UTC when row was written
            UNIQUE(account_type, tx_date, symbol, shares, tx_type)
        );
        CREATE INDEX IF NOT EXISTS idx_schwab_tx_date
            ON schwab_transactions(tx_date DESC);
        CREATE INDEX IF NOT EXISTS idx_schwab_tx_account
            ON schwab_transactions(account_type, tx_date DESC);

        -- Persistent store for taxable-account TRADE fills (sells: net_amount > 0,
        -- buys: net_amount < 0) used for realized capital gain calculation.  Historical rows (> 2 months old)
        -- are written once and never overwritten; only the rolling window is
        -- refreshed each run.
        CREATE TABLE IF NOT EXISTS realized_trade_txns (
            activity_id  TEXT    PRIMARY KEY,   -- Schwab activityId (unique per fill)
            trade_date   TEXT    NOT NULL,       -- YYYY-MM-DD
            symbol       TEXT    NOT NULL,
            shares       REAL    NOT NULL DEFAULT 0,
            net_amount   REAL    NOT NULL DEFAULT 0,
            raw_json     TEXT    NOT NULL DEFAULT '{}',
            fetched_at   TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rtt_date   ON realized_trade_txns(trade_date DESC);
        CREATE INDEX IF NOT EXISTS idx_rtt_symbol ON realized_trade_txns(symbol, trade_date DESC);

        -- Track which date windows have been fully backfilled so we don't
        -- re-fetch historical ranges on every startup.
        CREATE TABLE IF NOT EXISTS realized_trade_fetch_log (
            period_key  TEXT PRIMARY KEY,   -- e.g. '2025-Q4' or '2026-01' … '2026-04'
            fetched_at  TEXT NOT NULL
        );
    """)
    c.commit()
    # Migration: add accounts JSON column to existing databases that pre-date this column.
    try:
        c.execute("ALTER TABLE balance_snapshots ADD COLUMN accounts TEXT")
        c.commit()
    except Exception:
        pass   # column already exists — safe to ignore
    # Migration: add session_high / session_low for intraday range analysis.
    # Populated by the backfill endpoint using yfinance OHLC High/Low columns.
    for _col in ("session_high REAL", "session_low REAL"):
        try:
            c.execute(f"ALTER TABLE balance_snapshots ADD COLUMN {_col}")
            c.commit()
        except Exception:
            pass


# ── schwab_transactions ───────────────────────────────────────────────────────

def upsert_schwab_transactions(account_type: str, transactions: list) -> int:
    """
    Insert raw Schwab transactions into the DB. Uses INSERT OR IGNORE so existing
    rows (same account/date/symbol/shares/type) are never overwritten.
    Returns the number of newly inserted rows.
    """
    import json as _json
    from datetime import datetime as _dt
    fetched_at = _dt.utcnow().isoformat()
    inserted = 0
    c = _conn()
    for tx in transactions:
        # Schwab API nests symbol under instrument.symbol; also accept top-level
        _instr  = tx.get("instrument") or {}
        tx_date = (
            (tx.get("time")           or "")[:10] or
            (tx.get("tradeDate")      or "")[:10] or
            (tx.get("settlementDate") or "")[:10] or
            (tx.get("date")           or "")[:10] or
            (tx.get("tx_date")        or "")[:10]
        )
        tx_type = (tx.get("tx_type") or tx.get("type") or
                   tx.get("transactionType") or "")
        symbol  = (tx.get("symbol") or _instr.get("symbol") or "")
        # shares: transferItems[0].amount, then netQuantity/quantity
        _ti     = tx.get("transferItems") or []
        shares  = abs(float((_ti[0].get("amount") if _ti else None) or
                            tx.get("shares") or tx.get("netQuantity") or
                            tx.get("quantity") or 0))
        price   = float(tx.get("price") or 0)
        value   = float(tx.get("value") or tx.get("netAmount") or 0)
        tx_id   = str(tx.get("tx_id") or tx.get("transactionId") or
                      tx.get("source_tx_id") or "")
        desc    = tx.get("description") or ""
        raw     = _json.dumps(tx, separators=(",", ":"))
        if not tx_date or not symbol:
            continue
        cur = c.execute(
            """INSERT OR IGNORE INTO schwab_transactions
               (account_type, tx_date, tx_type, symbol, description, shares, price, value,
                tx_id, raw_json, fetched_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (account_type, tx_date, tx_type, symbol, desc, shares, price, value,
             tx_id, raw, fetched_at),
        )
        inserted += cur.rowcount
    c.commit()
    return inserted


def get_schwab_transactions(account_type: str, start_date: str, end_date: str,
                             tx_type_filter: str = None) -> list:
    """
    Retrieve stored transactions for account_type between start_date and end_date
    (both inclusive, YYYY-MM-DD). Optional tx_type_filter is a LIKE pattern
    (e.g. '%JOURNAL%').
    Returns list of dicts.
    """
    c = _conn()
    if tx_type_filter:
        rows = c.execute(
            """SELECT * FROM schwab_transactions
               WHERE account_type=? AND tx_date>=? AND tx_date<=?
               AND tx_type LIKE ?
               ORDER BY tx_date""",
            (account_type, start_date, end_date, tx_type_filter),
        ).fetchall()
    else:
        rows = c.execute(
            """SELECT * FROM schwab_transactions
               WHERE account_type=? AND tx_date>=? AND tx_date<=?
               ORDER BY tx_date""",
            (account_type, start_date, end_date),
        ).fetchall()
    return [dict(r) for r in rows]


def get_schwab_tx_date_range(account_type: str) -> tuple:
    """Return (min_date, max_date) of stored transactions for account_type, or (None, None)."""
    c = _conn()
    row = c.execute(
        "SELECT MIN(tx_date), MAX(tx_date) FROM schwab_transactions WHERE account_type=?",
        (account_type,),
    ).fetchone()
    return (row[0], row[1]) if row else (None, None)


# ── realized_trade_txns ──────────────────────────────────────────────────────

def realized_txns_upsert(rows: list) -> int:
    """Insert raw Schwab TRADE fills (buys and sells). Primary key = activity_id; existing rows are skipped."""
    if not rows:
        return 0
    c = _conn()
    now = __import__('datetime').datetime.utcnow().isoformat()
    c.executemany(
        """INSERT OR IGNORE INTO realized_trade_txns
               (activity_id, trade_date, symbol, shares, net_amount, raw_json, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [(r["activity_id"], r["trade_date"], r["symbol"],
          r["shares"], r["net_amount"], r["raw_json"], now)
         for r in rows],
    )
    c.commit()
    return c.execute("SELECT changes()").fetchone()[0]


def realized_txns_upsert_replace(rows: list) -> int:
    """Upsert (replace) rows — used for the rolling 2-month window to pick up corrections."""
    if not rows:
        return 0
    c = _conn()
    now = __import__('datetime').datetime.utcnow().isoformat()
    c.executemany(
        """INSERT OR REPLACE INTO realized_trade_txns
               (activity_id, trade_date, symbol, shares, net_amount, raw_json, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [(r["activity_id"], r["trade_date"], r["symbol"],
          r["shares"], r["net_amount"], r["raw_json"], now)
         for r in rows],
    )
    c.commit()
    return c.execute("SELECT changes()").fetchone()[0]


def realized_txns_get_all() -> list:
    """Return all stored raw Schwab TRADE rows (buys and sells) as dicts."""
    c = _conn()
    rows = c.execute(
        "SELECT raw_json FROM realized_trade_txns ORDER BY trade_date ASC"
    ).fetchall()
    import json as _json
    return [_json.loads(r[0]) for r in rows]


def realized_txns_period_logged(period_key: str) -> bool:
    c = _conn()
    return bool(c.execute(
        "SELECT 1 FROM realized_trade_fetch_log WHERE period_key=?", (period_key,)
    ).fetchone())


def realized_txns_mark_period(period_key: str) -> None:
    c = _conn()
    now = __import__('datetime').datetime.utcnow().isoformat()
    c.execute(
        "INSERT OR REPLACE INTO realized_trade_fetch_log (period_key, fetched_at) VALUES (?, ?)",
        (period_key, now),
    )
    c.commit()


def realized_txns_clear_period(period_key: str) -> None:
    """Remove a period from the fetch log so it will be re-fetched."""
    c = _conn()
    c.execute("DELETE FROM realized_trade_fetch_log WHERE period_key=?", (period_key,))
    c.commit()


# ── cache_kv ─────────────────────────────────────────────────────────────────

def cache_get(key: str) -> Optional[Any]:
    """Return deserialized value or None."""
    row = _conn().execute("SELECT value FROM cache_kv WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None


def cache_get_ts(key: str) -> Optional[tuple]:
    """Return (value, ts) where ts is unix epoch float, or None if missing."""
    row = _conn().execute("SELECT value, ts FROM cache_kv WHERE key=?", (key,)).fetchone()
    return (json.loads(row["value"]), float(row["ts"])) if row else None


def cache_set(key: str, value: Any) -> None:
    _conn().execute(
        "INSERT OR REPLACE INTO cache_kv(key, value, ts) VALUES(?,?,?)",
        (key, json.dumps(value, separators=(",", ":")), time.time()),
    )
    _conn().commit()


def cache_delete(key: str) -> None:
    _conn().execute("DELETE FROM cache_kv WHERE key=?", (key,))
    _conn().commit()


def cache_delete_prefix(prefix: str) -> int:
    """Delete all cache_kv rows whose key starts with `prefix`. Returns row count deleted."""
    c = _conn()
    cur = c.execute("DELETE FROM cache_kv WHERE key LIKE ?", (prefix + "%",))
    c.commit()
    return cur.rowcount


# ── EOD values ────────────────────────────────────────────────────────────────

def eod_save(trade_date: str, by_symbol: dict) -> None:
    """Persist EOD market values. by_symbol: {sym: {market_value, shares, price}}"""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    c = _conn()
    c.executemany(
        """INSERT OR REPLACE INTO eod_values
               (symbol, trade_date, market_value, shares, price, updated_at)
           VALUES(?,?,?,?,?,?)""",
        [
            (sym, trade_date,
             v.get("market_value"), v.get("shares"), v.get("price"), now)
            for sym, v in by_symbol.items()
        ],
    )
    c.commit()


def eod_load() -> dict:
    """Return latest EOD snapshot as {_date, _timestamp, by_symbol} or {}."""
    rows = _conn().execute(
        """SELECT symbol, trade_date, market_value, shares, price, updated_at
           FROM eod_values
           WHERE trade_date = (SELECT MAX(trade_date) FROM eod_values)"""
    ).fetchall()
    if not rows:
        return {}
    trade_date = rows[0]["trade_date"]
    updated_at = rows[0]["updated_at"]
    by_symbol = {
        r["symbol"]: {
            "market_value": r["market_value"],
            "shares":       r["shares"],
            "price":        r["price"],
        }
        for r in rows
    }
    return {"_date": trade_date, "_timestamp": updated_at, "by_symbol": by_symbol}


# ── Positions snapshot ────────────────────────────────────────────────────────

def snapshot_save(ts: float, timestamp: str, accounts: dict) -> None:
    """
    Replace the entire positions snapshot.
    accounts: {acct_key: {positions: {sym: {shares, cost_per_share}}}}
    """
    c = _conn()
    rows = []
    for acct_key, acct_data in accounts.items():
        for sym, pos in acct_data.get("positions", {}).items():
            rows.append((
                acct_key, sym,
                pos.get("shares"), pos.get("cost_per_share"),
                ts, timestamp,
            ))
    c.execute("DELETE FROM positions_snapshot")
    if rows:
        c.executemany(
            """INSERT INTO positions_snapshot
                   (account, symbol, shares, cost_per_share, ts, updated_at)
               VALUES(?,?,?,?,?,?)""",
            rows,
        )
    c.commit()


def snapshot_clear() -> None:
    """Wipe the positions snapshot so a corrupted fallback can't be re-used."""
    c = _conn()
    c.execute("DELETE FROM positions_snapshot")
    c.commit()


def snapshot_load() -> Optional[tuple]:
    """
    Return (accounts_dict, ts, timestamp_str) or None if missing / > 48h old.
    accounts_dict: {acct_key: {positions: {sym: {shares, cost_per_share}}}}
    """
    rows = _conn().execute(
        "SELECT account, symbol, shares, cost_per_share, ts, updated_at FROM positions_snapshot"
    ).fetchall()
    if not rows:
        return None
    ts = float(rows[0]["ts"])
    timestamp = rows[0]["updated_at"]
    if (time.time() - ts) / 3600 > 48:
        return None
    accounts: dict = {}
    for r in rows:
        acct = r["account"]
        if acct not in accounts:
            accounts[acct] = {"positions": {}}
        accounts[acct]["positions"][r["symbol"]] = {
            "shares":         r["shares"],
            "cost_per_share": r["cost_per_share"],
        }
    return accounts, ts, timestamp


# ── Price alerts ──────────────────────────────────────────────────────────────

def _row_to_alert(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["active"]    = bool(d["active"])
    d["triggered"] = bool(d["triggered"])
    return d


def alerts_get_all() -> list:
    rows = _conn().execute(
        "SELECT * FROM price_alerts ORDER BY created_at DESC"
    ).fetchall()
    return [_row_to_alert(r) for r in rows]


def alert_insert(alert: dict) -> dict:
    c = _conn()
    c.execute(
        """INSERT OR REPLACE INTO price_alerts
               (id, symbol, direction, mode, threshold, base_price,
                created_at, active, triggered, triggered_at, triggered_price, notes)
           VALUES(:id,:symbol,:direction,:mode,:threshold,:base_price,
                  :created_at,:active,:triggered,:triggered_at,:triggered_price,:notes)""",
        {**alert, "active": int(bool(alert.get("active", True))),
                  "triggered": int(bool(alert.get("triggered", False)))},
    )
    c.commit()
    return alert


def alert_update_fields(alert_id: str, **kwargs) -> Optional[dict]:
    c = _conn()
    allowed = {"direction", "mode", "threshold", "notes", "active", "base_price",
               "triggered", "triggered_at", "triggered_price"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return None
    for bk in ("active", "triggered"):
        if bk in updates:
            updates[bk] = int(bool(updates[bk]))
    cols = ", ".join(f"{k}=?" for k in updates)
    vals = list(updates.values()) + [alert_id]
    c.execute(f"UPDATE price_alerts SET {cols} WHERE id=?", vals)
    c.commit()
    row = c.execute("SELECT * FROM price_alerts WHERE id=?", (alert_id,)).fetchone()
    return _row_to_alert(row) if row else None


def alert_delete(alert_id: str) -> bool:
    c = _conn()
    c.execute("DELETE FROM price_alerts WHERE id=?", (alert_id,))
    c.commit()
    return c.execute("SELECT changes()").fetchone()[0] > 0


def alerts_as_json_dict() -> dict:
    """Return alerts in the legacy {alerts: [...]} format (for settings GET endpoint)."""
    return {"alerts": alerts_get_all()}


# ── Lots / cost basis ─────────────────────────────────────────────────────────

def lots_get_raw() -> dict:
    """
    Return lots keyed by symbol:
      {symbol: {symbol, account, lots: [{acquiredDate, quantity, costPerShare,
                                         costBasis, marketValue, gainLoss,
                                         gainLossPercent, holdingPeriod}]}}
    """
    rows = _conn().execute(
        """SELECT symbol, account, acquired_date, quantity, cost_per_share,
                  cost_basis, market_value, gain_loss, gain_loss_pct,
                  holding_period, snapshot_price
           FROM lots ORDER BY symbol, acquired_date"""
    ).fetchall()
    result: dict = {}
    for r in rows:
        sym = r["symbol"]
        if sym not in result:
            result[sym] = {"symbol": sym, "account": r["account"], "lots": []}
        # Derive basis/MV/gain from qty × cost_per_share / snapshot_price — the
        # stored cost_basis/gain_loss columns were corrupted by a legacy import
        # that truncated comma-formatted values. Fall back to stored only when
        # derivation inputs are missing. (Same rule as lots_get_for_editor.)
        qty = r["quantity"] or 0.0
        cps = r["cost_per_share"] or 0.0
        px  = r["snapshot_price"] or 0.0
        cb  = qty * cps if (qty > 0 and cps > 0) else (r["cost_basis"] or 0.0)
        mv  = qty * px  if (qty > 0 and px  > 0) else (r["market_value"] or 0.0)
        gl  = mv - cb
        result[sym]["lots"].append({
            "acquiredDate":    r["acquired_date"],
            "quantity":        qty,
            "costPerShare":    cps,
            "costBasis":       cb,
            "marketValue":     mv,
            "gainLoss":        gl,
            "gainLossPercent": (gl / cb * 100) if cb else 0.0,
            "holdingPeriod":   r["holding_period"] or "",
            "price":           px,
        })
    return result


def lots_get_for_editor() -> dict:
    """
    Return lots in the format SchwabCostEditor expects — includes computed totals
    per symbol so the UI header row shows correct numbers on first load.

      {symbol: {symbol, account, asOfDate, totalQuantity, totalMarketValue,
                totalCostBasis, totalGainLoss, totalGainLossPercent,
                lots: [{acquiredDate, quantity, price, costPerShare, marketValue,
                        costBasis, gainLoss, gainLossPercent, holdingPeriod}]}}
    """
    rows = _conn().execute(
        """SELECT symbol, account, acquired_date, quantity, cost_per_share,
                  cost_basis, market_value, gain_loss, gain_loss_pct,
                  holding_period, snapshot_price, as_of_date
           FROM lots ORDER BY symbol, acquired_date DESC"""
    ).fetchall()
    result: dict = {}
    for r in rows:
        sym = r["symbol"]
        if sym not in result:
            result[sym] = {
                "symbol":              sym,
                "account":             r["account"],
                "asOfDate":            r["as_of_date"] or "",
                "totalQuantity":       0.0,
                "totalMarketValue":    0.0,
                "totalCostBasis":      0.0,
                "totalGainLoss":       0.0,
                "totalGainLossPercent": 0.0,
                "lots":                [],
            }
        qty = r["quantity"] or 0.0
        cps = r["cost_per_share"] or 0.0
        px  = r["snapshot_price"] or 0.0
        # Derive lot economics from first principles (same math as the editor's
        # updateLot): basis = qty × cost/share, MV = qty × price. Stored
        # cost_basis / gain_loss columns are untrusted — a legacy import
        # truncated comma-formatted values (e.g. XLK basis "$99,887" stored as
        # $99), producing absurd display gains. Fall back to stored values only
        # when the inputs needed to derive are missing.
        cb = qty * cps if (qty > 0 and cps > 0) else (r["cost_basis"] or 0.0)
        mv = qty * px  if (qty > 0 and px  > 0) else (r["market_value"] or 0.0)
        gl = mv - cb
        result[sym]["totalQuantity"]    += qty
        result[sym]["totalMarketValue"] += mv
        result[sym]["totalCostBasis"]   += cb
        result[sym]["totalGainLoss"]    += gl
        result[sym]["lots"].append({
            "acquiredDate":    r["acquired_date"],
            "quantity":        qty,
            "price":           px,
            "costPerShare":    cps,
            "marketValue":     mv,
            "costBasis":       cb,
            "gainLoss":        gl,
            "gainLossPercent": (gl / cb * 100) if cb else 0.0,
            "holdingPeriod":   r["holding_period"] or "Short Term",
        })
    # Compute totalGainLossPercent after summing
    for sym_data in result.values():
        tb = sym_data["totalCostBasis"]
        sym_data["totalGainLossPercent"] = (
            sym_data["totalGainLoss"] / tb * 100 if tb else 0.0
        )
    return result


def lots_replace_from_dict(data: dict, source_label: str = "client") -> int:
    """
    Replace all lots data with the contents of `data`:
    {symbol: {account, asOfDate, lots: [{acquiredDate, quantity, costPerShare,
    ...}]}}.  Diffs old vs new and records removed lots in lot_sales.
    Returns number of lot rows written.

    This is the canonical write path — used by /api/settings (POST) and any
    code that needs to atomically replace the lots table from an in-memory dict.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    # ── Snapshot old lots before wiping ─────────────────────────────────────
    c = _conn()
    old_lots: dict = {}  # (symbol, account, acquired_date) → (qty, cost_per_share)
    for row in c.execute(
        "SELECT symbol, account, acquired_date, quantity, cost_per_share FROM lots"
    ):
        key = (row["symbol"], row["account"], row["acquired_date"])
        # Sum qty in case of duplicate rows (shouldn't happen, but guard anyway)
        if key in old_lots:
            old_qty, old_cost = old_lots[key]
            old_lots[key] = (old_qty + row["quantity"], old_cost)
        else:
            old_lots[key] = (row["quantity"], row["cost_per_share"])

    # ── Build new lots from file ─────────────────────────────────────────────
    rows = []
    new_lots: dict = {}  # (symbol, account, acquired_date) → (qty, cost_per_share)
    for sym, entry in data.items():
        if sym.startswith("_"):
            continue
        account = entry.get("account", "")
        as_of   = entry.get("asOfDate", "")
        for lot in entry.get("lots", []):
            adate = (lot.get("acquiredDate") or "")[:10]
            if not adate:
                print(f"[db] Skipping lot for {sym} with missing acquired_date")
                continue
            qty   = float(lot.get("quantity", 0) or 0)
            cost  = float(lot.get("costPerShare", 0) or 0)
            rows.append((
                sym, account, adate, qty, cost,
                float(lot.get("costBasis",   0) or 0),
                float(lot.get("marketValue", 0) or 0),
                float(lot.get("gainLoss",    0) or 0),
                float(lot.get("gainLossPercent", 0) or 0),
                lot.get("holdingPeriod"),
                float(lot.get("price", 0) or 0) or None,
                as_of, now,
            ))
            key = (sym, account, adate)
            if key in new_lots:
                new_qty, _ = new_lots[key]
                new_lots[key] = (new_qty + qty, cost)
            else:
                new_lots[key] = (qty, cost)

    # ── Detect sold lots (old qty > new qty) and record in lot_sales ─────────
    # Only run the diff when there are existing lots to diff against.
    sold_rows = []
    if old_lots:
        for key, (old_qty, old_cost) in old_lots.items():
            sym, account, adate = key
            new_qty = new_lots.get(key, (0.0, 0.0))[0]
            removed_qty = round(old_qty - new_qty, 6)
            if removed_qty > 0.0001:
                sold_rows.append((sym, account, adate, removed_qty, old_cost, now))

        if sold_rows:
            c.executemany(
                """INSERT INTO lot_sales
                       (symbol, account, acquired_date, quantity, cost_per_share, detected_at)
                   VALUES (?,?,?,?,?,?)""",
                sold_rows,
            )
            print(f"[db] Recorded {len(sold_rows)} sold lot(s) in lot_sales")

    # ── Replace lots table ────────────────────────────────────────────────────
    c.execute("DELETE FROM lots")
    if rows:
        c.executemany(
            """INSERT INTO lots
                   (symbol, account, acquired_date, quantity, cost_per_share,
                    cost_basis, market_value, gain_loss, gain_loss_pct,
                    holding_period, snapshot_price, as_of_date, imported_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )
    c.commit()
    print(f"[db] Imported {len(rows)} lots from {source_label}")
    return len(rows)


def reimport_lots(path: str) -> int:
    """
    Import lots from a JSON file on disk and replace the lots table.
    The file must follow the cost-basis editor shape:
      {symbol: {account, asOfDate, lots: [{acquiredDate, quantity, costPerShare, ...}]}}
    Prefer editing via the Cost Basis Editor UI (POST /api/settings → lots_replace_from_dict).
    """
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception:
        return 0
    return lots_replace_from_dict(data, source_label=os.path.basename(path))


def get_lot_sales_map() -> dict:
    """
    Return sold-lot history keyed by symbol.

    Result: { symbol: [ {date, cost, qty}, ... ] } sorted oldest-first.
    Quantities for the same (symbol, acquired_date) are summed across all
    recorded detection events so callers get the total sold qty per lot date.
    """
    rows = _conn().execute(
        """SELECT symbol, acquired_date, cost_per_share, SUM(quantity) AS qty
           FROM lot_sales
           GROUP BY symbol, acquired_date, cost_per_share
           ORDER BY symbol, acquired_date"""
    ).fetchall()
    result: dict = {}
    for row in rows:
        sym = row["symbol"]
        if sym not in result:
            result[sym] = []
        result[sym].append({
            "date": row["acquired_date"],
            "cost": row["cost_per_share"],
            "qty":  row["qty"],
        })
    return result


# ── Signals (deterministic event detector output) ────────────────────────────

def signals_save(as_of: str, signals: list) -> None:
    """
    Append a batch of signals to history. Each signal is a dict shaped per
    server.signals (kind, severity, headline, details, tab, optional symbol).

    No de-duplication here — the detector runs every refresh tick and we keep
    the raw history. The "latest signals" helper below collapses by (kind, symbol).
    """
    if not signals:
        return
    c = _conn()
    now = time.time()
    rows = [
        (
            as_of,
            s.get("kind", ""),
            s.get("symbol"),
            s.get("severity", "info"),
            s.get("headline", ""),
            json.dumps(s.get("details") or {}),
            s.get("tab"),
            now,
        )
        for s in signals
    ]
    c.executemany(
        "INSERT INTO signals_history(as_of, kind, symbol, severity, headline, "
        "details_json, tab, recorded_at) VALUES(?,?,?,?,?,?,?,?)",
        rows,
    )
    c.commit()


def signals_get_latest() -> list:
    """
    Return the most recent batch of signals — i.e. those recorded at the
    highest `recorded_at` for each (kind, symbol) pair.

    A single fetch_all_data tick may insert multiple signals; we want the latest
    snapshot, not the full history. Use signals_get_history() for time series.
    """
    c = _conn()
    rows = c.execute(
        """
        SELECT s.* FROM signals_history s
        INNER JOIN (
            SELECT kind, IFNULL(symbol, '') AS sym_key, MAX(recorded_at) AS max_ts
            FROM signals_history
            GROUP BY kind, sym_key
        ) latest
        ON s.kind = latest.kind
        AND IFNULL(s.symbol, '') = latest.sym_key
        AND s.recorded_at = latest.max_ts
        ORDER BY
            CASE s.severity WHEN 'crit' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
            s.kind, IFNULL(s.symbol, '')
        """
    ).fetchall()
    return [
        {
            "kind":     r["kind"],
            "symbol":   r["symbol"],
            "severity": r["severity"],
            "headline": r["headline"],
            "details":  json.loads(r["details_json"] or "{}"),
            "tab":      r["tab"],
            "as_of":    r["as_of"],
        }
        for r in rows
    ]


def signals_prune(keep_days: int = 90) -> int:
    """Delete signal rows older than `keep_days`. Returns rows deleted."""
    cutoff = time.time() - (keep_days * 86400)
    c = _conn()
    res = c.execute("DELETE FROM signals_history WHERE recorded_at < ?", (cutoff,))
    c.commit()
    return res.rowcount or 0


# ── Analytics history (one-row-per-day derived-metric snapshots) ─────────────

def analytics_save(as_of: str, snapshot: dict) -> None:
    """
    Upsert a snapshot of derived analytics for `as_of` (a YYYY-MM-DD date).
    Same-day refreshes overwrite the row (PRIMARY KEY on as_of).
    """
    if not as_of or not isinstance(snapshot, dict):
        return
    c = _conn()
    c.execute(
        "INSERT OR REPLACE INTO analytics_history(as_of, snapshot_json, recorded_at) "
        "VALUES(?,?,?)",
        (as_of, json.dumps(snapshot, default=str), time.time()),
    )
    c.commit()


def analytics_get_prev(as_of: str) -> Optional[dict]:
    """
    Return the most recent snapshot with as_of < the given date, or None.

    Used by /api/briefing to compute "vs yesterday" diffs. Strictly-less-than
    so today's in-progress row never matches.
    """
    if not as_of:
        return None
    c = _conn()
    row = c.execute(
        "SELECT as_of, snapshot_json FROM analytics_history "
        "WHERE as_of < ? ORDER BY as_of DESC LIMIT 1",
        (as_of,),
    ).fetchone()
    if not row:
        return None
    try:
        snap = json.loads(row["snapshot_json"] or "{}")
    except Exception:
        return None
    return {"as_of": row["as_of"], **snap}


def analytics_prune(keep_days: int = 400) -> int:
    """Delete analytics snapshots older than `keep_days`. Default is a generous
    13-month window so year-over-year comparisons remain possible."""
    cutoff = time.time() - (keep_days * 86400)
    c = _conn()
    res = c.execute("DELETE FROM analytics_history WHERE recorded_at < ?", (cutoff,))
    c.commit()
    return res.rowcount or 0


# ── One-time JSON migration (run on first startup) ────────────────────────────

def migrate_json_files() -> None:
    """
    Import existing JSON files into SQLite on first run.
    Each section is a no-op if data already exists in the target table/key.
    Safe to call on every startup.
    """
    c = _conn()

    def _already(table_or_key: str, is_table: bool) -> bool:
        if is_table:
            return bool(c.execute(f"SELECT 1 FROM {table_or_key} LIMIT 1").fetchone())
        return bool(c.execute("SELECT 1 FROM cache_kv WHERE key=?", (table_or_key,)).fetchone())

    # 1. confidence_cache
    conf_path = os.path.join(_SERVER_DIR, "_confidence_cache.json")
    if os.path.exists(conf_path) and not _already("confidence", False):
        try:
            with open(conf_path) as f:
                d = json.load(f)
            c.execute("INSERT OR REPLACE INTO cache_kv(key,value,ts) VALUES(?,?,?)",
                      ("confidence", json.dumps(d.get("score")), d.get("ts", time.time())))
            c.commit()
            print("[db] Migrated _confidence_cache.json → cache_kv")
        except Exception as e:
            print(f"[db] confidence migration skipped: {e}")

    # 2. trends_cache
    trends_path = os.path.join(_SERVER_DIR, "_trends_cache.json")
    if os.path.exists(trends_path) and not _already("trends", False):
        try:
            with open(trends_path) as f:
                d = json.load(f)
            ts = d.pop("ts", time.time())
            c.execute("INSERT OR REPLACE INTO cache_kv(key,value,ts) VALUES(?,?,?)",
                      ("trends", json.dumps(d), ts))
            c.commit()
            print("[db] Migrated _trends_cache.json → cache_kv")
        except Exception as e:
            print(f"[db] trends migration skipped: {e}")

    # 3. conversion_cache
    conv_path = os.path.join(_SERVER_DIR, "_conversion_cache.json")
    if os.path.exists(conv_path) and not _already("conversion", False):
        try:
            with open(conv_path) as f:
                d = json.load(f)
            c.execute("INSERT OR REPLACE INTO cache_kv(key,value,ts) VALUES(?,?,?)",
                      ("conversion", json.dumps(d), time.time()))
            c.commit()
            print("[db] Migrated _conversion_cache.json → cache_kv")
        except Exception as e:
            print(f"[db] conversion migration skipped: {e}")

    # 4. eod_values
    eod_path = os.path.join(_SERVER_DIR, "_eod_values.json")
    if os.path.exists(eod_path) and not _already("eod_values", True):
        try:
            with open(eod_path) as f:
                d = json.load(f)
            trade_date = d.get("_date", "")
            if trade_date and d.get("by_symbol"):
                eod_save(trade_date, d["by_symbol"])
                print("[db] Migrated _eod_values.json → eod_values")
        except Exception as e:
            print(f"[db] eod_values migration skipped: {e}")

    # 5. positions_snapshot
    snap_path = os.path.join(_SERVER_DIR, "_positions_snapshot.json")
    if os.path.exists(snap_path) and not _already("positions_snapshot", True):
        try:
            with open(snap_path) as f:
                raw = json.load(f)
            ts_val    = raw.get("_ts", time.time())
            timestamp = raw.get("_timestamp", "")
            accounts  = {k: v for k, v in raw.items() if not k.startswith("_")}
            if accounts:
                snapshot_save(ts_val, timestamp, accounts)
                print("[db] Migrated _positions_snapshot.json → positions_snapshot")
        except Exception as e:
            print(f"[db] positions_snapshot migration skipped: {e}")

    # 6. price_alerts
    alerts_path = os.path.join(_SERVER_DIR, "price_alerts.json")
    if os.path.exists(alerts_path) and not _already("price_alerts", True):
        try:
            with open(alerts_path) as f:
                d = json.load(f)
            for a in d.get("alerts", []):
                try:
                    alert_insert(a)
                except Exception:
                    pass
            print(f"[db] Migrated {len(d.get('alerts', []))} alerts → price_alerts")
        except Exception as e:
            print(f"[db] price_alerts migration skipped: {e}")

    # 7. lots table — DB is the source of truth; edits flow via the Cost Basis
    # Editor UI (POST /api/settings → lots_replace_from_dict()).

    # 8. conversion_history_YYYY.json → schwab_transactions (bootstrap seed)
    # These files contain manually verified conversions that pre-date the DB.
    import glob
    for ch_path in sorted(glob.glob(os.path.join(_SERVER_DIR, "conversion_history_*.json"))):
        try:
            with open(ch_path) as f:
                entries = json.load(f)
            if not isinstance(entries, list):
                continue
            inserted = 0
            fetched_at = "2026-06-10T00:00:00"   # bootstrap timestamp
            for entry in entries:
                tx_date = (entry.get("date") or "")[:10]
                symbol  = entry.get("symbol") or ""
                shares  = float(entry.get("shares") or 0)
                price   = float(entry.get("price") or 0)
                value   = float(entry.get("value") or 0)
                tx_id   = str(entry.get("source_tx_id") or "")
                desc    = entry.get("description") or ""
                if not tx_date or not symbol:
                    continue
                cur = c.execute(
                    """INSERT OR IGNORE INTO schwab_transactions
                       (account_type, tx_date, tx_type, symbol, description, shares, price,
                        value, tx_id, raw_json, fetched_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    ("rollover_ira", tx_date, "JOURNALED_SHARES", symbol, desc, shares,
                     price, value, tx_id, json.dumps(entry), fetched_at),
                )
                # Mirror the roth-side entry so matching finds both legs
                c.execute(
                    """INSERT OR IGNORE INTO schwab_transactions
                       (account_type, tx_date, tx_type, symbol, description, shares, price,
                        value, tx_id, raw_json, fetched_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    ("roth_ira", tx_date, "JOURNALED_SHARES", symbol, desc, shares,
                     price, value, tx_id, json.dumps(entry), fetched_at),
                )
                inserted += cur.rowcount
            c.commit()
            if inserted:
                print(f"[db] Seeded {inserted} conversion(s) from {os.path.basename(ch_path)} → schwab_transactions")
        except Exception as e:
            print(f"[db] conversion_history seed skipped ({ch_path}): {e}")

    # 9. schwab_api_cache
    schwab_cache_path = os.path.join(_SERVER_DIR, "_schwab_api_cache.json")
    if os.path.exists(schwab_cache_path):
        try:
            with open(schwab_cache_path) as f:
                d = json.load(f)
            for k, v in d.items():
                if not c.execute("SELECT 1 FROM cache_kv WHERE key=?", (f"schwab:{k}",)).fetchone():
                    c.execute("INSERT OR REPLACE INTO cache_kv(key,value,ts) VALUES(?,?,?)",
                              (f"schwab:{k}", json.dumps(v), time.time()))
            c.commit()
            print("[db] Migrated _schwab_api_cache.json → cache_kv")
        except Exception as e:
            print(f"[db] schwab_api_cache migration skipped: {e}")


# ── nav_cache ─────────────────────────────────────────────────────────────────

def nav_get(symbol: str) -> Optional[float]:
    """Return cached NAV for symbol, or None if not in DB."""
    row = _conn().execute(
        "SELECT nav FROM nav_cache WHERE symbol=?", (symbol,)
    ).fetchone()
    return float(row["nav"]) if row else None


def nav_set(symbol: str, nav: float, source: str = "yfinance") -> None:
    """Upsert a NAV value for symbol."""
    from datetime import datetime
    _conn().execute(
        """INSERT OR REPLACE INTO nav_cache(symbol, nav, source, updated_at)
           VALUES (?, ?, ?, ?)""",
        (symbol, round(nav, 4), source, datetime.now().strftime("%Y-%m-%d %H:%M")),
    )
    _conn().commit()


def nav_get_all() -> dict:
    """Return {symbol: nav} for every row in nav_cache."""
    rows = _conn().execute("SELECT symbol, nav FROM nav_cache").fetchall()
    return {r["symbol"]: float(r["nav"]) for r in rows}


# ── Balance Snapshots ─────────────────────────────────────────────────────────

def balance_snapshot_record(
    date: str, label: str, total_value: float,
    accounts: dict | None = None,
    session_high: float | None = None,
    session_low:  float | None = None,
) -> None:
    """Upsert an open or close balance snapshot for a trading day.

    accounts:     optional {account_key: value} per-sleeve breakdown.
    session_high: portfolio value at position daily highs (backfill from yfinance High).
    session_low:  portfolio value at position daily lows  (backfill from yfinance Low).
    Idempotent: same date+label keeps the latest value.

    Refuses non-trading days (weekends/holidays) — a stale-cache write during
    a Sunday-evening timezone edge case once slipped through here before this
    guard existed (see market_calendar.is_trading_day), producing a bogus
    Balance History row with real-looking but meaningless numbers.
    """
    import time as _time
    from datetime import datetime, timezone
    import market_calendar as _mcal_bal
    if not _mcal_bal.is_trading_day(date):
        print(f"[db] refusing balance snapshot for non-trading day {date} ({label})")
        return
    _conn().execute(
        """INSERT OR REPLACE INTO balance_snapshots
               (ts, date, label, total_value, accounts, session_high, session_low, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            _time.time(), date, label, round(total_value, 2),
            json.dumps(accounts) if accounts else None,
            round(session_high, 2) if session_high is not None else None,
            round(session_low,  2) if session_low  is not None else None,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    _conn().commit()


def _snap_row(r) -> dict:
    def _f(v):
        return float(v) if v is not None else None
    return {
        "ts":           float(r["ts"]),
        "date":         r["date"],
        "label":        r["label"],
        "total_value":  float(r["total_value"]),
        "recorded_at":  r["recorded_at"],
        "accounts":     json.loads(r["accounts"]) if r["accounts"] else {},
        "session_high": _f(r["session_high"]) if "session_high" in r.keys() else None,
        "session_low":  _f(r["session_low"])  if "session_low"  in r.keys() else None,
    }


def balance_snapshots_get(days: int = 30) -> list:
    """Return snapshots from the last *days* calendar days, newest date first."""
    rows = _conn().execute(
        """SELECT ts, date, label, total_value, accounts, session_high, session_low, recorded_at
           FROM balance_snapshots
           WHERE date >= date('now', ?)
           ORDER BY date DESC, label DESC""",
        (f"-{max(1, int(days))} days",),
    ).fetchall()
    return [_snap_row(r) for r in rows]


def balance_snapshots_range(start_date: str, end_date: str) -> list:
    """Return snapshots between start_date and end_date (YYYY-MM-DD), inclusive."""
    rows = _conn().execute(
        """SELECT ts, date, label, total_value, accounts, session_high, session_low, recorded_at
           FROM balance_snapshots
           WHERE date BETWEEN ? AND ?
           ORDER BY date ASC, label ASC""",
        (start_date, end_date),
    ).fetchall()
    return [_snap_row(r) for r in rows]


# ── Init on import ────────────────────────────────────────────────────────────

_init_schema()
