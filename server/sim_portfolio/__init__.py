"""
sim_portfolio package — split from the monolithic sim_portfolio.py.

Re-exports the names that external callers (server.py, routes_sim.py) use:

    import sim_portfolio as sp
    sp.list_portfolios(), sp.execute_buy(...), sp._cur(), ...

Layout:
  - db.py      : SQLite connection pool, schema (init_db runs on import),
                 row helpers (_row, _rows, _today)
  - prices.py  : get_price, refresh_prices, get_quote
  - api.py     : portfolio/holding/transaction/dividend/history/watchlist
                 CRUD, plus Schwab import
"""

# DB plumbing — server.py reaches into sp._cur(), so we re-export it.
from .db import (
    _conn,
    _cur,
    _commit,
    _row,
    _rows,
    _today,
    init_db,
)

from .prices import (
    get_price,
    refresh_prices,
    get_quote,
)

from .swing_calendar import swing_calendar, rank_opportunities

from .swing import (
    analyze_swing,
    get_swing_setups,
    add_swing_setup,
    update_swing_setup,
    delete_swing_setup,
)

from .api import (
    # Portfolio CRUD
    list_portfolios,
    create_portfolio,
    get_portfolio,
    update_portfolio,
    delete_portfolio,
    get_portfolio_summary,
    # Transactions
    execute_buy,
    execute_sell,
    get_transactions,
    # Holdings
    get_holdings,
    set_holding_yield,
    set_holding_info,
    # Dividends + refresh
    auto_roll_and_record_dividends,
    fetch_dividend_schedule,
    do_refresh_prices,
    record_dividend,
    get_dividends,
    # History
    get_history,
    # Watchlist
    get_watchlist,
    add_to_watchlist,
    remove_from_watchlist,
    # Schwab import
    list_schwab_accounts,
    import_from_schwab,
)

# All re-exports above are intentional public API; declare them so lint tools
# (and `from sim_portfolio import *`) treat them as such.
__all__ = [
    # db
    "_conn", "_cur", "_commit", "_row", "_rows", "_today", "init_db",
    # prices
    "get_price", "refresh_prices", "get_quote",
    # portfolio CRUD
    "list_portfolios", "create_portfolio", "get_portfolio",
    "update_portfolio", "delete_portfolio", "get_portfolio_summary",
    # transactions
    "execute_buy", "execute_sell", "get_transactions",
    # holdings
    "get_holdings", "set_holding_yield", "set_holding_info",
    # dividends + refresh
    "auto_roll_and_record_dividends", "fetch_dividend_schedule",
    "do_refresh_prices", "record_dividend", "get_dividends",
    # history
    "get_history",
    # watchlist
    "get_watchlist", "add_to_watchlist", "remove_from_watchlist",
    # Schwab import
    "list_schwab_accounts", "import_from_schwab",
    # swing trading
    "analyze_swing", "get_swing_setups", "add_swing_setup",
    "update_swing_setup", "delete_swing_setup",
    "swing_calendar", "rank_opportunities",
]
