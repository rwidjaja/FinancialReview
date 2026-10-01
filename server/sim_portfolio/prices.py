"""sim_portfolio.prices — price/quote helpers for the simulator."""

from typing import Dict, List

from .db import _commit, _cur, _today

# ── Price helpers ──────────────────────────────────────────────────────────────

def get_price(symbol: str, fallback: float = 0.0) -> float:
    """Return cached price, falling back to yfinance if not cached."""
    c = _cur()
    c.execute("SELECT price, last_updated FROM price_cache WHERE symbol=?", (symbol,))
    row = c.fetchone()
    if row:
        # Use cache if updated today
        if row['last_updated'][:10] == _today():
            return float(row['price'])
    # Fetch from yfinance
    try:
        import yfinance as yf
        t = yf.Ticker(symbol)
        h = t.history(period="2d")
        if not h.empty:
            price = float(h['Close'].iloc[-1])
            prev  = float(h['Close'].iloc[-2]) if len(h) >= 2 else price
            chg   = (price - prev) / prev * 100 if prev > 0 else 0.0
            c.execute("""
                INSERT INTO price_cache (symbol, price, change_pct, prev_close, last_updated)
                VALUES (?,?,?,?,datetime('now'))
                ON CONFLICT(symbol) DO UPDATE SET
                    price=excluded.price, change_pct=excluded.change_pct,
                    prev_close=excluded.prev_close, last_updated=excluded.last_updated
            """, (symbol, price, chg, prev))
            _commit()
            return price
    except Exception:
        pass
    return float(row['price']) if row else fallback


def refresh_prices(symbols: List[str]) -> Dict[str, float]:
    """Batch-refresh prices from yfinance. Returns {symbol: price}."""
    if not symbols:
        return {}
    result: Dict[str, float] = {}
    try:
        import yfinance as yf
        import pandas as pd
        data = yf.download(symbols, period="2d", auto_adjust=True,
                           progress=False, threads=True)
        closes = data["Close"] if len(symbols) > 1 else data["Close"]

        # Normalise single-symbol case
        if len(symbols) == 1:
            closes = closes.rename(lambda _: symbols[0], axis='columns') \
                    if hasattr(closes, 'rename') else \
                    pd.DataFrame({symbols[0]: closes})

        c = _cur()
        for sym in symbols:
            col = closes[sym] if sym in closes.columns else pd.Series(dtype=float)
            col = col.dropna()
            if col.empty:
                continue
            price = float(col.iloc[-1])
            prev  = float(col.iloc[-2]) if len(col) >= 2 else price
            chg   = (price - prev) / prev * 100 if prev > 0 else 0.0
            c.execute("""
                INSERT INTO price_cache (symbol, price, change_pct, prev_close, last_updated)
                VALUES (?,?,?,?,datetime('now'))
                ON CONFLICT(symbol) DO UPDATE SET
                    price=excluded.price, change_pct=excluded.change_pct,
                    prev_close=excluded.prev_close, last_updated=excluded.last_updated
            """, (sym, price, chg, prev))
            result[sym] = price
        _commit()
    except Exception as e:
        print(f"[sim] refresh_prices error: {e}")
    return result


def get_quote(symbol: str) -> Dict:
    """Fetch live quote for a single symbol (uses Schwab if available, else yfinance)."""
    # Try Schwab first
    try:
        from schwab_client import get_quotes as _sq
        sq = _sq([symbol]).get(symbol, {})
        if sq.get('price'):
            return {
                'symbol': symbol,
                'price': sq['price'],
                'change': sq.get('change', 0),
                'change_pct': sq.get('change_pct', 0),
                'prev_close': sq.get('close'),
                'day_high': sq.get('day_high'),
                'day_low': sq.get('day_low'),
                'volume': sq.get('volume'),
                '52w_high': sq.get('52w_high'),
                '52w_low': sq.get('52w_low'),
                'name': sq.get('description', symbol),
                'div_yield': sq.get('ttm_yield'),
            }
    except Exception:
        pass
    # Fallback to yfinance
    try:
        import yfinance as yf
        t = yf.Ticker(symbol)
        h = t.history(period="5d")
        info = {}
        try:
            info = t.info or {}
        except Exception:
            pass
        if not h.empty:
            price = float(h['Close'].iloc[-1])
            prev  = float(h['Close'].iloc[-2]) if len(h) >= 2 else price
            return {
                'symbol': symbol,
                'price': price,
                'change': price - prev,
                'change_pct': (price - prev) / prev * 100 if prev > 0 else 0,
                'prev_close': prev,
                'day_high': float(h['High'].iloc[-1]),
                'day_low': float(h['Low'].iloc[-1]),
                'volume': int(h['Volume'].iloc[-1]),
                '52w_high': info.get('fiftyTwoWeekHigh'),
                '52w_low': info.get('fiftyTwoWeekLow'),
                'name': info.get('shortName') or info.get('longName', symbol),
                'div_yield': info.get('dividendYield'),
            }
    except Exception:
        pass
    return {'symbol': symbol, 'price': 0, 'error': 'Could not fetch quote'}

