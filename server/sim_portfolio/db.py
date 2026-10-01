"""sim_portfolio.db — SQLite connection pool, schema, and tiny row helpers.

init_db() runs on import to ensure the schema exists (preserves the
original module-level call).
"""

import os
import sqlite3
import threading
from datetime import date
from typing import Dict, List, Optional

# DB lives in the server/ directory (parent of this sub-package), matching the
# pre-split location. dirname(__file__) here is server/sim_portfolio/, so go up one.
_DIR  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DB_PATH = os.path.join(_DIR, "sim_portfolios.db")


# ── Thread-safe connection pool ────────────────────────────────────────────────

_local = threading.local()

def _conn() -> sqlite3.Connection:
    if not hasattr(_local, 'conn') or _local.conn is None:
        c = sqlite3.connect(_DB_PATH)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        _local.conn = c
    return _local.conn

def _cur():
    return _conn().cursor()

def _commit():
    conn = _conn()
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(PASSIVE)")


# ── Schema ─────────────────────────────────────────────────────────────────────

def init_db():
    c = _cur()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS portfolios (
            portfolio_id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name           TEXT    NOT NULL UNIQUE,
            description    TEXT    DEFAULT '',
            seed_capital   REAL    DEFAULT 1000000.0,
            current_cash   REAL    DEFAULT 1000000.0,
            created_at     TEXT    DEFAULT (datetime('now')),
            updated_at     TEXT    DEFAULT (datetime('now')),
            is_active      INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS holdings (
            holding_id         INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id       INTEGER NOT NULL,
            symbol             TEXT    NOT NULL,
            total_shares       REAL    DEFAULT 0,
            average_cost       REAL    DEFAULT 0,
            total_cost         REAL    DEFAULT 0,
            current_price      REAL    DEFAULT 0,
            market_value       REAL    DEFAULT 0,
            unrealized_pnl     REAL    DEFAULT 0,
            unrealized_pnl_pct REAL    DEFAULT 0,
            last_updated       TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id),
            UNIQUE(portfolio_id, symbol)
        );

        CREATE TABLE IF NOT EXISTS transactions (
            transaction_id   INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id     INTEGER NOT NULL,
            symbol           TEXT    NOT NULL,
            transaction_type TEXT    CHECK(transaction_type IN ('BUY','SELL')) NOT NULL,
            shares           REAL    NOT NULL,
            price_per_share  REAL    NOT NULL,
            total_amount     REAL    NOT NULL,
            commission       REAL    DEFAULT 0,
            transaction_date TEXT    NOT NULL,
            notes            TEXT    DEFAULT '',
            created_at       TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id)
        );

        CREATE TABLE IF NOT EXISTS dividends (
            dividend_id       INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id      INTEGER NOT NULL,
            symbol            TEXT    NOT NULL,
            dividend_type     TEXT    DEFAULT 'DIVIDEND',
            amount_per_share  REAL    NOT NULL,
            total_shares      REAL    NOT NULL,
            total_amount      REAL    NOT NULL,
            payment_date      TEXT    NOT NULL,
            reinvested        INTEGER DEFAULT 0,
            reinvested_shares REAL    DEFAULT 0,
            reinvested_price  REAL    DEFAULT 0,
            notes             TEXT    DEFAULT '',
            created_at        TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id)
        );

        CREATE TABLE IF NOT EXISTS price_cache (
            symbol       TEXT    PRIMARY KEY,
            price        REAL    NOT NULL DEFAULT 0,
            change_pct   REAL,
            prev_close   REAL,
            volume       INTEGER,
            div_yield    REAL,
            last_updated TEXT    DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
            snapshot_id    INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id   INTEGER NOT NULL,
            snapshot_date  TEXT    NOT NULL,
            total_value    REAL    NOT NULL,
            holdings_value REAL    NOT NULL,
            cash_balance   REAL    NOT NULL,
            total_pnl      REAL    NOT NULL,
            total_pnl_pct  REAL    NOT NULL,
            FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id),
            UNIQUE(portfolio_id, snapshot_date)
        );

        CREATE TABLE IF NOT EXISTS watchlist (
            watchlist_id INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id INTEGER NOT NULL,
            symbol       TEXT    NOT NULL,
            notes        TEXT    DEFAULT '',
            added_at     TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id),
            UNIQUE(portfolio_id, symbol)
        );
    """)
    _commit()
    # ── Migrations (safe to re-run) ──────────────────────────────────────────
    for ddl in [
        "ALTER TABLE holdings ADD COLUMN dividend_yield        REAL DEFAULT NULL",
        "ALTER TABLE holdings ADD COLUMN ex_dividend_date      TEXT DEFAULT NULL",
        "ALTER TABLE holdings ADD COLUMN next_payment_date     TEXT DEFAULT NULL",
        "ALTER TABLE holdings ADD COLUMN next_payment_per_share REAL DEFAULT NULL",
        "ALTER TABLE holdings ADD COLUMN dividend_growth_5y    REAL DEFAULT NULL",
        "ALTER TABLE holdings ADD COLUMN annual_dividend_per_share REAL DEFAULT NULL",
        "ALTER TABLE holdings ADD COLUMN payment_frequency     TEXT DEFAULT NULL",
        "ALTER TABLE holdings ADD COLUMN beta                  REAL DEFAULT NULL",
        "ALTER TABLE holdings ADD COLUMN expense_ratio         REAL DEFAULT NULL",
        "ALTER TABLE price_cache ADD COLUMN name TEXT DEFAULT NULL",
        "ALTER TABLE price_cache ADD COLUMN beta REAL DEFAULT NULL",
        "ALTER TABLE price_cache ADD COLUMN expense_ratio REAL DEFAULT NULL",
        "ALTER TABLE price_cache ADD COLUMN annual_div_per_share REAL DEFAULT NULL",
        "ALTER TABLE price_cache ADD COLUMN ex_dividend_date TEXT DEFAULT NULL",
        "ALTER TABLE price_cache ADD COLUMN next_payment_date TEXT DEFAULT NULL",
        "ALTER TABLE price_cache ADD COLUMN next_payment_per_share REAL DEFAULT NULL",
        "ALTER TABLE price_cache ADD COLUMN dividend_growth_5y REAL DEFAULT NULL",
        "ALTER TABLE price_cache ADD COLUMN payment_frequency TEXT DEFAULT NULL",
        "ALTER TABLE portfolios ADD COLUMN is_default INTEGER DEFAULT 0",
    ]:
        try:
            _cur().execute(ddl)
            _commit()
        except Exception:
            pass  # column already exists

# Run on import
init_db()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row(r) -> Optional[Dict]:
    return dict(r) if r else None

def _rows(rs) -> List[Dict]:
    return [dict(r) for r in rs]

def _today() -> str:
    return date.today().isoformat()
