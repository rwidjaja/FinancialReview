"""portfolio_data.eod — end-of-day value cache I/O (NAV history per symbol)."""

from typing import List

import db_manager as _dbm

from ._flags import _VERBOSE
from .time_utils import _et_now

def _load_eod_values() -> dict:
    """
    Load EOD values from database.
    Returns dict with keys:
      "_date"      : "YYYY-MM-DD" — trading date this snapshot covers
      "by_symbol"  : { sym: {"market_value": float, "shares": float, "price": float} }
    Returns {} if no data available.
    """
    return _dbm.eod_load()

def _validate_target_symbols(symbols_list: List[str], target_file_name: str) -> List[str]:
    """
    Validate that symbols in target files exist in the market data.
    Returns list of invalid symbols.
    """
    import yfinance as yf
    invalid = []
    
    for sym in symbols_list:
        try:
            ticker = yf.Ticker(sym)
            # Quick check - just see if we can get basic info
            hist = ticker.history(period="5d")
            if hist.empty:
                invalid.append(sym)
                print(f"[portfolio] Warning: Symbol '{sym}' in {target_file_name} has no market data - may be typo or delisted")
        except Exception:
            invalid.append(sym)
            print(f"[portfolio] Warning: Symbol '{sym}' in {target_file_name} - error checking market data")
    
    return invalid

def _save_eod_values(by_symbol: dict) -> None:
    """
    Persist end-of-day position market values to database.
    by_symbol: { sym: {"market_value": float, "shares": float, "price": float} }
    """
    try:
        _trade_date = _et_now().isoformat()
        _dbm.eod_save(_trade_date, by_symbol)
        if _VERBOSE:
            print(f"[eod] Saved end-of-day snapshot for {_trade_date} ({len(by_symbol)} symbols)")
    except Exception as _e:
        if _VERBOSE:
            print(f"[eod] Failed to save EOD snapshot: {_e}")
