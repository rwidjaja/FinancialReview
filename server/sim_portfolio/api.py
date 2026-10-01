"""sim_portfolio.api — portfolio CRUD, transactions, holdings, dividends,
history, watchlist, and Schwab import."""

import sqlite3
from datetime import date, timedelta
from typing import Dict, List, Optional

from .db import _commit, _cur, _row, _rows, _today
from .prices import get_price, refresh_prices

# ── Holdings recalculation ─────────────────────────────────────────────────────

def _recalc_holding(portfolio_id: int, symbol: str):
    c = _cur()
    c.execute("""
        SELECT transaction_type, shares, total_amount, commission
        FROM transactions WHERE portfolio_id=? AND symbol=?
        ORDER BY transaction_date, created_at
    """, (portfolio_id, symbol))
    txns = c.fetchall()

    total_shares = 0.0
    total_cost   = 0.0
    for t in txns:
        if t['transaction_type'] == 'BUY':
            total_shares += t['shares']
            total_cost   += t['total_amount'] + t['commission']
        else:
            if total_shares > 0:
                avg = total_cost / total_shares
                total_shares -= t['shares']
                total_cost    = total_shares * avg

    if total_shares < 0.0001:
        c.execute("DELETE FROM holdings WHERE portfolio_id=? AND symbol=?", (portfolio_id, symbol))
        _commit()
        return

    c.execute("SELECT price FROM price_cache WHERE symbol=?", (symbol,))
    pr = c.fetchone()
    current_price = float(pr['price']) if pr else 0.0
    avg_cost      = total_cost / total_shares if total_shares > 0 else 0.0
    market_value  = total_shares * current_price
    upnl          = market_value - total_cost
    upnl_pct      = upnl / total_cost * 100 if total_cost > 0 else 0.0

    c.execute("""
        INSERT INTO holdings
            (portfolio_id, symbol, total_shares, average_cost, total_cost,
             current_price, market_value, unrealized_pnl, unrealized_pnl_pct, last_updated)
        VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(portfolio_id, symbol) DO UPDATE SET
            total_shares=excluded.total_shares, average_cost=excluded.average_cost,
            total_cost=excluded.total_cost, current_price=excluded.current_price,
            market_value=excluded.market_value, unrealized_pnl=excluded.unrealized_pnl,
            unrealized_pnl_pct=excluded.unrealized_pnl_pct,
            last_updated=excluded.last_updated
    """, (portfolio_id, symbol, total_shares, avg_cost, total_cost,
          current_price, market_value, upnl, upnl_pct))
    _commit()


# ── Portfolio CRUD ─────────────────────────────────────────────────────────────

def list_portfolios() -> List[Dict]:
    c = _cur()
    c.execute("SELECT * FROM portfolios WHERE is_active=1 ORDER BY created_at")
    portfolios = _rows(c.fetchall())
    # Attach quick summary
    for p in portfolios:
        pid = p['portfolio_id']
        c.execute("""
            SELECT COALESCE(SUM(market_value),0) as mv,
                   COALESCE(SUM(total_cost),0)   as tc
            FROM holdings WHERE portfolio_id=? AND total_shares>0
        """, (pid,))
        row = c.fetchone()
        mv  = float(row['mv']) if row else 0.0
        tc  = float(row['tc']) if row else 0.0
        p['holdings_value'] = mv
        p['total_value']    = mv + p['current_cash']
        p['total_return']   = p['total_value'] - p['seed_capital']
        p['total_return_pct'] = (p['total_return'] / p['seed_capital'] * 100) \
                                 if p['seed_capital'] > 0 else 0.0
    return portfolios


def create_portfolio(name: str, description: str = '', seed_capital: float = 1_000_000.0) -> Dict:
    c = _cur()
    try:
        c.execute("""
            INSERT INTO portfolios (name, description, seed_capital, current_cash)
            VALUES (?,?,?,?)
        """, (name, description, seed_capital, seed_capital))
        _commit()
        pid = c.lastrowid
        return {'portfolio_id': pid, 'name': name, 'description': description,
                'seed_capital': seed_capital, 'current_cash': seed_capital}
    except sqlite3.IntegrityError:
        raise ValueError(f"Portfolio '{name}' already exists")


def get_portfolio(portfolio_id: int) -> Optional[Dict]:
    c = _cur()
    c.execute("SELECT * FROM portfolios WHERE portfolio_id=? AND is_active=1", (portfolio_id,))
    return _row(c.fetchone())


def update_portfolio(portfolio_id: int, name: str = None, description: str = None,
                     is_default: bool = None) -> bool:
    c = _cur()
    if name:
        try:
            c.execute("UPDATE portfolios SET name=?, updated_at=datetime('now') WHERE portfolio_id=?",
                      (name, portfolio_id))
        except sqlite3.IntegrityError:
            raise ValueError(f"Portfolio '{name}' already exists")
    if description is not None:
        c.execute("UPDATE portfolios SET description=?, updated_at=datetime('now') WHERE portfolio_id=?",
                  (description, portfolio_id))
    if is_default is True:
        c.execute("UPDATE portfolios SET is_default=0")
        c.execute("UPDATE portfolios SET is_default=1 WHERE portfolio_id=?", (portfolio_id,))
    elif is_default is False:
        c.execute("UPDATE portfolios SET is_default=0 WHERE portfolio_id=?", (portfolio_id,))
    _commit()
    return True


def delete_portfolio(portfolio_id: int):
    c = _cur()
    c.execute("UPDATE portfolios SET is_active=0 WHERE portfolio_id=?", (portfolio_id,))
    _commit()


def get_portfolio_summary(portfolio_id: int) -> Optional[Dict]:
    p = get_portfolio(portfolio_id)
    if not p:
        return None
    c = _cur()
    c.execute("""
        SELECT COUNT(*) as positions,
               COALESCE(SUM(total_cost),0)   as total_cost,
               COALESCE(SUM(market_value),0) as market_value,
               COALESCE(SUM(unrealized_pnl),0) as upnl
        FROM holdings WHERE portfolio_id=? AND total_shares>0
    """, (portfolio_id,))
    hs = _row(c.fetchone()) or {}
    # YTD dividends
    yr  = date.today().year
    c.execute("""
        SELECT COALESCE(SUM(total_amount),0) as ytd_div
        FROM dividends WHERE portfolio_id=? AND payment_date LIKE ?
    """, (portfolio_id, f"{yr}%"))
    dr = c.fetchone()
    ytd_div = float(dr['ytd_div']) if dr else 0.0
    # All-time dividends
    c.execute("SELECT COALESCE(SUM(total_amount),0) as all_div FROM dividends WHERE portfolio_id=?",
              (portfolio_id,))
    ar = c.fetchone()
    all_div = float(ar['all_div']) if ar else 0.0

    mv   = float(hs.get('market_value', 0))
    tc   = float(hs.get('total_cost', 0))
    cash = float(p['current_cash'])
    seed = float(p['seed_capital'])
    tv   = mv + cash
    ret  = tv - seed
    ret_pct = ret / seed * 100 if seed > 0 else 0.0
    return {
        **p,
        'positions':          int(hs.get('positions', 0)),
        'total_invested':     tc,
        'holdings_value':     mv,
        'total_value':        tv,
        'total_return':       ret,
        'total_return_pct':   ret_pct,
        'unrealized_pnl':     float(hs.get('upnl', 0)),
        'ytd_dividends':      ytd_div,
        'all_time_dividends': all_div,
    }


# ── Auto-populate dividend / fundamental metadata for a new holding ────────────

def _auto_populate_new_holding(portfolio_id: int, symbol: str) -> None:
    """
    Called after a BUY to fill in dividend schedule and fundamentals.
    Tries Schwab quotes first (richer ex/pay date data), falls back to yfinance.
    Only populates fields the user has not manually set.
    Safe: swallows all errors so a slow or unavailable API never blocks a buy.
    """
    try:
        sched: Dict = {}

        # ── 1. Try Schwab quotes (has next_div_ex_date, next_div_pay_date, etc.)
        try:
            from schwab_client import get_quotes as _sq
            sq = _sq([symbol]).get(symbol, {})
            if sq:
                _FREQ_MAP_INT: Dict[int, str] = {
                    1: 'Annual', 2: 'Semi-Annual', 4: 'Quarterly',
                    12: 'Monthly', 52: 'Weekly',
                }
                freq_int = sq.get('div_freq_int')
                freq_str = sq.get('div_freq') or (_FREQ_MAP_INT.get(freq_int) if freq_int else None)
                if sq.get('div_amount'):
                    sched['annual_dividend_per_share'] = round(float(sq['div_amount']), 4)
                if sq.get('div_yield'):
                    sched['dividend_yield'] = round(float(sq['div_yield']), 4)
                # Per-payment = annualised ÷ freq
                if sq.get('div_pay_amount'):
                    sched['next_payment_per_share'] = round(float(sq['div_pay_amount']), 4)
                elif sched.get('annual_dividend_per_share') and freq_int:
                    sched['next_payment_per_share'] = round(
                        sched['annual_dividend_per_share'] / freq_int, 4)
                # Prefer "next" dates; fall back to most-recent ex/pay
                ex_date  = sq.get('next_div_ex_date')  or sq.get('div_ex_date')
                pay_date = sq.get('next_div_pay_date') or sq.get('div_pay_date')
                if ex_date:
                    sched['ex_dividend_date'] = ex_date[:10]
                if pay_date:
                    sched['next_payment_date'] = pay_date[:10]
                if freq_str:
                    sched['payment_frequency'] = freq_str
                if sq.get('beta'):
                    sched['beta'] = round(float(sq['beta']), 3)
                if sq.get('description'):
                    # store name in price_cache (via a quick upsert below)
                    c2 = _cur()
                    c2.execute(
                        "INSERT INTO price_cache (symbol, name) VALUES (?,?) "
                        "ON CONFLICT(symbol) DO UPDATE SET name=excluded.name",
                        (symbol, sq['description'][:80])
                    )
                    _commit()
        except Exception:
            pass   # Schwab unavailable — fall through to yfinance

        # ── 2. Fill gaps with yfinance
        if not sched:
            sched = fetch_dividend_schedule(symbol)

        if not sched:
            return

        # ── 3. Only write fields not already manually set on the holding
        c = _cur()
        c.execute("""
            SELECT annual_dividend_per_share, dividend_yield, next_payment_per_share,
                   ex_dividend_date, next_payment_date, payment_frequency, beta
            FROM holdings WHERE portfolio_id=? AND symbol=?
        """, (portfolio_id, symbol))
        row = c.fetchone()
        if not row:
            return
        existing = dict(row)

        updates: Dict = {}
        for fld, val in sched.items():
            if fld in _HOLDING_EDITABLE_FIELDS and existing.get(fld) is None and val is not None:
                updates[fld] = val

        if updates:
            set_holding_info(portfolio_id, symbol, updates)

        # Also upsert price_cache schedule columns
        _SCHED_TO_CACHE_MAP: Dict[str, str] = {
            'annual_dividend_per_share': 'annual_div_per_share',
            'ex_dividend_date':          'ex_dividend_date',
            'next_payment_date':         'next_payment_date',
            'next_payment_per_share':    'next_payment_per_share',
            'payment_frequency':         'payment_frequency',
            'beta':                      'beta',
        }
        pairs = [(cv, sched[sk]) for sk, cv in _SCHED_TO_CACHE_MAP.items() if sk in sched]
        if pairs:
            cols = [p[0] for p in pairs]
            vals = [p[1] for p in pairs]
            sql  = (f"INSERT INTO price_cache (symbol, {', '.join(cols)}) "
                    f"VALUES (?, {', '.join('?' * len(cols))}) "
                    f"ON CONFLICT(symbol) DO UPDATE SET "
                    + ', '.join(f"{c}=excluded.{c}" for c in cols))
            c2 = _cur()
            c2.execute(sql, [symbol] + vals)
            _commit()

    except Exception as ex:
        print(f"[sim] _auto_populate_new_holding {symbol}: {ex}")


# ── Transactions ───────────────────────────────────────────────────────────────

def execute_buy(portfolio_id: int, symbol: str, shares: float,
                price: float = None, commission: float = 0.0,
                txn_date: str = None, notes: str = '') -> Dict:
    symbol = symbol.upper()
    if price is None:
        price = get_price(symbol)
        if price == 0:
            raise ValueError(f"Cannot fetch price for {symbol}")

    total = shares * price + commission
    if not get_portfolio(portfolio_id):
        raise ValueError("Portfolio not found")

    txn_date = txn_date or _today()
    c = _cur()

    # Atomic cash deduction: WHERE current_cash >= total prevents overshooting
    # even when two threads read the same balance before either commits.
    c.execute("""
        UPDATE portfolios
        SET current_cash = current_cash - ?, updated_at = datetime('now')
        WHERE portfolio_id = ? AND current_cash >= ?
    """, (total, portfolio_id, total))
    _commit()

    if c.rowcount == 0:
        p = get_portfolio(portfolio_id)
        have = p['current_cash'] if p else 0.0
        raise ValueError(f"Insufficient cash. Need ${total:,.2f}, have ${have:,.2f}")

    c.execute("""
        INSERT INTO transactions (portfolio_id, symbol, transaction_type, shares,
            price_per_share, total_amount, commission, transaction_date, notes)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (portfolio_id, symbol, 'BUY', shares, price, shares * price,
          commission, txn_date, notes))
    _commit()

    # Update price cache and recalculate holding
    c.execute("""
        INSERT INTO price_cache (symbol, price, last_updated) VALUES (?,?,datetime('now'))
        ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, last_updated=excluded.last_updated
    """, (symbol, price))
    _commit()
    _recalc_holding(portfolio_id, symbol)

    # Auto-populate dividend schedule & fundamentals in the background
    _auto_populate_new_holding(portfolio_id, symbol)

    return {'transaction_id': c.lastrowid, 'symbol': symbol,
            'shares': shares, 'price': price, 'total': total}


def execute_sell(portfolio_id: int, symbol: str, shares: float,
                 price: float = None, commission: float = 0.0,
                 txn_date: str = None, notes: str = '') -> Dict:
    symbol = symbol.upper()
    c = _cur()
    c.execute("SELECT total_shares FROM holdings WHERE portfolio_id=? AND symbol=?",
              (portfolio_id, symbol))
    row = c.fetchone()
    if not row or row['total_shares'] < shares:
        avail = float(row['total_shares']) if row else 0
        raise ValueError(f"Insufficient shares. Have {avail:.4f}, selling {shares:.4f}")

    if price is None:
        price = get_price(symbol)
        if price == 0:
            raise ValueError(f"Cannot fetch price for {symbol}")

    total    = shares * price - commission
    txn_date = txn_date or _today()
    c.execute("""
        INSERT INTO transactions (portfolio_id, symbol, transaction_type, shares,
            price_per_share, total_amount, commission, transaction_date, notes)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (portfolio_id, symbol, 'SELL', shares, price, shares * price,
          commission, txn_date, notes))
    _commit()

    p = get_portfolio(portfolio_id)
    if p:
        c.execute("UPDATE portfolios SET current_cash=?, updated_at=datetime('now') WHERE portfolio_id=?",
                  (p['current_cash'] + total, portfolio_id))
        _commit()

    c.execute("""
        INSERT INTO price_cache (symbol, price, last_updated) VALUES (?,?,datetime('now'))
        ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, last_updated=excluded.last_updated
    """, (symbol, price))
    _commit()
    _recalc_holding(portfolio_id, symbol)

    return {'transaction_id': c.lastrowid, 'symbol': symbol,
            'shares': shares, 'price': price, 'proceeds': total}


def get_transactions(portfolio_id: int, symbol: str = None, limit: int = 200) -> List[Dict]:
    c = _cur()
    if symbol:
        c.execute("""
            SELECT * FROM transactions WHERE portfolio_id=? AND symbol=?
            ORDER BY transaction_date DESC, created_at DESC LIMIT ?
        """, (portfolio_id, symbol.upper(), limit))
    else:
        c.execute("""
            SELECT * FROM transactions WHERE portfolio_id=?
            ORDER BY transaction_date DESC, created_at DESC LIMIT ?
        """, (portfolio_id, limit))
    return _rows(c.fetchall())


# ── Holdings ───────────────────────────────────────────────────────────────────

def get_holdings(portfolio_id: int) -> List[Dict]:
    c = _cur()
    c.execute("""
        SELECT h.*,
               pc.change_pct,
               pc.prev_close,
               pc.div_yield             AS cache_div_yield,
               pc.name                  AS cache_name,
               pc.beta                  AS cache_beta,
               pc.expense_ratio         AS cache_expense_ratio,
               pc.annual_div_per_share  AS cache_adps,
               pc.ex_dividend_date      AS cache_ex_date,
               pc.next_payment_date     AS cache_next_pay,
               pc.next_payment_per_share AS cache_next_pay_sh,
               pc.dividend_growth_5y    AS cache_dg5,
               pc.payment_frequency     AS cache_freq
        FROM holdings h
        LEFT JOIN price_cache pc ON h.symbol = pc.symbol
        WHERE h.portfolio_id=? AND h.total_shares>0
        ORDER BY h.market_value DESC
    """, (portfolio_id,))
    rows = _rows(c.fetchall())
    for h in rows:
        pc   = h.get('prev_close') or 0
        chg  = h['current_price'] - pc if pc > 0 else 0
        h['day_change']     = chg * h['total_shares']
        h['day_change_pct'] = h.get('change_pct') or 0.0
        h['portfolio_pct']  = 0.0

        # Name from cache if not set
        h['name'] = h.get('cache_name') or h.get('symbol', '')

        # Resolve effective yield (manual > cache decimal-converted > None)
        manual_yield = h.get('dividend_yield')
        cache_yield  = h.get('cache_div_yield')
        if manual_yield is not None:
            h['dividend_yield'] = manual_yield
        elif cache_yield is not None:
            h['dividend_yield'] = round(float(cache_yield) * 100, 4) \
                if float(cache_yield) < 2 else round(float(cache_yield), 4)
        else:
            h['dividend_yield'] = None

        # Resolve each schedule field: manual (h.*) wins over cache
        def _resolve(manual_key: str, cache_key: str):
            mv = h.get(manual_key)
            cv = h.get(cache_key)
            return mv if mv is not None else cv

        h['beta']                   = _resolve('beta',                   'cache_beta')
        h['expense_ratio']          = _resolve('expense_ratio',          'cache_expense_ratio')
        h['annual_dividend_per_share'] = _resolve('annual_dividend_per_share', 'cache_adps')
        h['ex_dividend_date']       = _resolve('ex_dividend_date',       'cache_ex_date')
        h['next_payment_date']      = _resolve('next_payment_date',      'cache_next_pay')
        h['next_payment_per_share'] = _resolve('next_payment_per_share', 'cache_next_pay_sh')
        h['dividend_growth_5y']     = _resolve('dividend_growth_5y',     'cache_dg5')
        h['payment_frequency']      = _resolve('payment_frequency',      'cache_freq')

        # Remove raw cache columns from output
        for k in list(h.keys()):
            if k.startswith('cache_'):
                del h[k]

    return rows


def set_holding_yield(portfolio_id: int, symbol: str, yield_pct: Optional[float]) -> bool:
    """Manually set or clear the dividend yield % for a holding.
    yield_pct: annual yield as a percentage (e.g. 8.5 for 8.5%).  Pass None to clear.
    Returns True if the holding was found and updated."""
    c = _cur()
    c.execute("""
        UPDATE holdings SET dividend_yield=?, last_updated=datetime('now')
        WHERE portfolio_id=? AND symbol=?
    """, (yield_pct, portfolio_id, symbol.upper()))
    _commit()
    return c.rowcount > 0


_HOLDING_EDITABLE_FIELDS = {
    'dividend_yield', 'ex_dividend_date', 'next_payment_date',
    'next_payment_per_share', 'dividend_growth_5y', 'annual_dividend_per_share',
    'payment_frequency', 'beta', 'expense_ratio',
}


def set_holding_info(portfolio_id: int, symbol: str, fields: Dict) -> bool:
    """Update one or more editable fields on a holding (manual override).
    Returns True if the holding was found and updated."""
    updates = {k: v for k, v in fields.items() if k in _HOLDING_EDITABLE_FIELDS}
    if not updates:
        return False
    set_clause = ', '.join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [portfolio_id, symbol.upper()]
    c = _cur()
    c.execute(
        f"UPDATE holdings SET {set_clause}, last_updated=datetime('now') "
        f"WHERE portfolio_id=? AND symbol=?",
        values,
    )
    _commit()
    return c.rowcount > 0


_FREQ_DAYS = {
    'Weekly': 7.0, 'Monthly': 30.4375,
    'Quarterly': 91.3125, 'Semi-Annual': 182.625, 'Annual': 365.25,
}
_FREQ_DIV = {
    'Weekly': 52, 'Monthly': 12, 'Quarterly': 4, 'Semi-Annual': 2, 'Annual': 1,
}


def auto_roll_and_record_dividends(portfolio_id: int) -> List[Dict]:
    """
    For every holding with a payment schedule:
      1. If next_payment_date has passed, auto-record the dividend (unless already
         recorded within a 14-day window) using stored per-share amount or
         annual_dividend_per_share ÷ frequency divisor.
      2. Roll next_payment_date (and ex_dividend_date if set) forward to the next
         projected occurrence.
    Returns a list of auto-recorded dividend summaries.
    """
    import math as _math

    auto_recorded: List[Dict] = []
    today = date.today()

    c = _cur()
    c.execute("""
        SELECT symbol, next_payment_date, ex_dividend_date, payment_frequency,
               next_payment_per_share, annual_dividend_per_share,
               total_shares, dividend_yield, market_value
        FROM holdings
        WHERE portfolio_id=? AND total_shares>0
          AND next_payment_date IS NOT NULL
          AND payment_frequency IS NOT NULL
    """, (portfolio_id,))
    rows = _rows(c.fetchall())

    for h in rows:
        freq        = h['payment_frequency']
        freq_days   = _FREQ_DAYS.get(freq, 91.3125)
        freq_div    = _FREQ_DIV.get(freq, 4)
        pay_str     = h['next_payment_date'][:10]

        try:
            pay_date = date.fromisoformat(pay_str)
        except Exception:
            continue

        if pay_date > today:
            continue   # Not yet due — nothing to do

        # ── 1. Compute per-share dividend amount ──────────────────────────────
        per_sh = h['next_payment_per_share']
        if per_sh is None and h['annual_dividend_per_share']:
            per_sh = float(h['annual_dividend_per_share']) / freq_div
        if per_sh is None and h['dividend_yield'] and h['total_shares'] > 0 and h['market_value']:
            per_sh = float(h['dividend_yield']) / 100 * float(h['market_value']) / (freq_div * float(h['total_shares']))
        if per_sh is None or per_sh <= 0:
            per_sh = None

        # ── 2. Auto-record if no dividend already exists in ±14-day window ──
        if per_sh is not None:
            window_start = (pay_date - timedelta(days=14)).isoformat()
            window_end   = (pay_date + timedelta(days=14)).isoformat()
            c2 = _cur()
            c2.execute("""
                SELECT COUNT(*) as cnt FROM dividends
                WHERE portfolio_id=? AND symbol=?
                  AND payment_date BETWEEN ? AND ?
            """, (portfolio_id, h['symbol'], window_start, window_end))
            already = c2.fetchone()['cnt']
            if not already:
                try:
                    res = record_dividend(
                        portfolio_id, h['symbol'], per_sh,
                        total_shares=float(h['total_shares']),
                        payment_date=pay_str,
                        notes='Auto-recorded from payment schedule',
                    )
                    auto_recorded.append({
                        'symbol':       h['symbol'],
                        'payment_date': pay_str,
                        'per_share':    per_sh,
                        'total':        res['total_amount'],
                        'auto':         True,
                    })
                except Exception as ex:
                    print(f"[auto_record] {h['symbol']}: {ex}")

        # ── 3. Roll forward next_payment_date to next future occurrence ───────
        days_past = (today - pay_date).days + 1
        intervals = max(1, _math.ceil(days_past / freq_days))
        new_pay   = pay_date + timedelta(days=int(round(intervals * freq_days)))

        updates: Dict = {'next_payment_date': new_pay.isoformat()}

        # Roll ex_dividend_date by same offset if set
        ex_str = h.get('ex_dividend_date')
        if ex_str:
            try:
                ex_date   = date.fromisoformat(ex_str[:10])
                ex_offset = (pay_date - ex_date).days   # days before pay
                new_ex    = new_pay - timedelta(days=ex_offset)
                updates['ex_dividend_date'] = new_ex.isoformat()
            except Exception:
                pass

        set_holding_info(portfolio_id, h['symbol'], updates)

    return auto_recorded


def fetch_dividend_schedule(symbol: str) -> Dict:
    """
    Pull dividend schedule and fundamentals from yfinance for a single symbol.
    Returns a dict with keys matching _HOLDING_EDITABLE_FIELDS (plus 'name').
    Safe to call — never raises; returns {} on failure.
    """
    result: Dict = {}
    try:
        import yfinance as yf
        import pandas as pd
        t = yf.Ticker(symbol)

        # ── Fast info (may raise or return {}) ───────────────────────────────
        info: Dict = {}
        try:
            info = t.info or {}
        except Exception:
            pass

        # Name
        name = info.get('shortName') or info.get('longName') or info.get('displayName')
        if name:
            result['name'] = name

        # Beta
        beta = info.get('beta')
        if beta is not None:
            try:
                result['beta'] = round(float(beta), 3)
            except Exception:
                pass

        # Expense ratio (ETFs store it as a decimal, e.g. 0.0003 = 0.03%)
        er = info.get('annualReportExpenseRatio') or info.get('totalExpenseRatio')
        if er is not None:
            try:
                result['expense_ratio'] = round(float(er) * 100, 4)
            except Exception:
                pass

        # Annual dividend per share (trailing or forward)
        div_rate = info.get('dividendRate') or info.get('trailingAnnualDividendRate')
        if div_rate:
            try:
                result['annual_dividend_per_share'] = round(float(div_rate), 4)
            except Exception:
                pass

        # Div yield (decimal → %)
        dy = info.get('dividendYield') or info.get('trailingAnnualDividendYield')
        if dy is not None:
            try:
                pct = float(dy) * 100 if float(dy) < 2 else float(dy)
                result['dividend_yield'] = round(pct, 4)
            except Exception:
                pass

        # ── Dividend calendar (ex-date / pay date) ────────────────────────────
        try:
            cal = t.calendar
            if cal is not None:
                if isinstance(cal, dict):
                    ex = cal.get('Ex-Dividend Date') or cal.get('exDividendDate')
                    pd_ = cal.get('Dividend Date') or cal.get('dividendDate')
                else:
                    # Older yfinance: DataFrame with columns as dates
                    try:
                        cd = cal.T.to_dict()
                        for k, v in next(iter(cd.values()), {}).items():
                            if 'Ex-Dividend' in str(k):
                                ex = v
                            elif 'Dividend Date' in str(k):
                                pd_ = v
                    except Exception:
                        ex, pd_ = None, None
                for key, var in [('ex_dividend_date', locals().get('ex')),
                                  ('next_payment_date', locals().get('pd_'))]:
                    if var is not None:
                        try:
                            result[key] = str(var)[:10]
                        except Exception:
                            pass
        except Exception:
            pass

        # ── Historical dividends: frequency + 5Y growth ───────────────────────
        try:
            hist_divs = t.dividends
            if hist_divs is not None and len(hist_divs) >= 2:
                # Normalise index to UTC
                try:
                    idx = hist_divs.index
                    if idx.tz is None:
                        hist_divs.index = idx.tz_localize('UTC')
                    else:
                        hist_divs.index = idx.tz_convert('UTC')
                except Exception:
                    pass

                now_ts = pd.Timestamp.now(tz='UTC')

                # Payment frequency from last 12 months
                try:
                    ttm_cut = now_ts - pd.DateOffset(years=1)
                    recent_count = len(hist_divs[hist_divs.index >= ttm_cut])
                    if recent_count >= 10:
                        result['payment_frequency'] = 'Monthly'
                    elif recent_count >= 3:
                        result['payment_frequency'] = 'Quarterly'
                    elif recent_count >= 2:
                        result['payment_frequency'] = 'Semi-Annual'
                    elif recent_count >= 1:
                        result['payment_frequency'] = 'Annual'
                except Exception:
                    pass

                # 5Y dividend growth CAGR
                if len(hist_divs) >= 8:
                    try:
                        ttm_cut   = now_ts - pd.DateOffset(years=1)
                        base_hi   = now_ts - pd.DateOffset(years=5)
                        base_lo   = now_ts - pd.DateOffset(years=6)
                        ttm_sum  = float(hist_divs[hist_divs.index >= ttm_cut].sum())
                        base_sum = float(hist_divs[(hist_divs.index >= base_lo) &
                                                    (hist_divs.index <  base_hi)].sum())
                        if base_sum > 0 and ttm_sum > 0:
                            cagr = ((ttm_sum / base_sum) ** (1 / 5) - 1) * 100
                            result['dividend_growth_5y'] = round(cagr, 2)
                    except Exception:
                        pass
        except Exception:
            pass

        # ── Estimate next payment per share ───────────────────────────────────
        adps = result.get('annual_dividend_per_share')
        if adps:
            freq = result.get('payment_frequency', 'Quarterly')
            div_ = 12 if freq == 'Monthly' else 4 if freq == 'Quarterly' \
                else 2 if freq == 'Semi-Annual' else 1
            result['next_payment_per_share'] = round(adps / div_, 4)

    except Exception as e:
        print(f"[fetch_dividend_schedule] {symbol}: {e}")

    return result


def do_refresh_prices(portfolio_id: int,
                      extra_symbols: Optional[List[str]] = None) -> Dict:
    """
    Refresh holding prices + dividend schedule metadata from yfinance.
    Prices are batch-fetched; schedule info is fetched per-ticker (slower but richer).

    extra_symbols: additional symbols to price (e.g. open limit-order symbols
    that are not yet in holdings or watchlist — passed from the frontend since
    limit orders live in localStorage, not the DB).
    """
    holdings = get_holdings(portfolio_id)
    symbols  = [h['symbol'] for h in holdings]
    # Also refresh watchlist symbols
    c2 = _cur()
    c2.execute("SELECT symbol FROM watchlist WHERE portfolio_id=?", (portfolio_id,))
    wl_syms  = [r['symbol'] for r in c2.fetchall()]
    # Include caller-supplied symbols (e.g. open limit-order targets)
    extra    = [s.upper() for s in (extra_symbols or []) if s]
    all_syms = list(set(symbols + wl_syms + extra))

    # ── 1. Batch price refresh ────────────────────────────────────────────────
    prices = refresh_prices(all_syms)

    # Recalculate all holdings with new prices
    for sym in symbols:
        _recalc_holding(portfolio_id, sym)

    # ── 2. Per-ticker dividend schedule + fundamentals ────────────────────────
    # Map: fetch_dividend_schedule key → price_cache column name
    _SCHED_TO_CACHE: Dict[str, str] = {
        'name':                     'name',
        'beta':                     'beta',
        'expense_ratio':            'expense_ratio',
        'annual_dividend_per_share':'annual_div_per_share',
        'ex_dividend_date':         'ex_dividend_date',
        'next_payment_date':        'next_payment_date',
        'next_payment_per_share':   'next_payment_per_share',
        'dividend_growth_5y':       'dividend_growth_5y',
        'payment_frequency':        'payment_frequency',
    }

    schedule_updated = 0
    for sym in symbols:
        try:
            sched = fetch_dividend_schedule(sym)
            if not sched:
                continue

            # Build lists of (cache_col, value) for fields that were returned
            pairs = [(cache_col, sched[sched_k])
                     for sched_k, cache_col in _SCHED_TO_CACHE.items()
                     if sched_k in sched]

            if pairs:
                cache_cols  = [p[0] for p in pairs]
                cache_vals  = [p[1] for p in pairs]
                insert_cols = ['symbol'] + cache_cols
                insert_vals = [sym]      + cache_vals
                update_sql  = ', '.join(f"{c}=excluded.{c}" for c in cache_cols)
                cc = _cur()
                cc.execute(
                    f"INSERT INTO price_cache ({', '.join(insert_cols)}) "
                    f"VALUES ({', '.join('?' for _ in insert_vals)}) "
                    f"ON CONFLICT(symbol) DO UPDATE SET {update_sql}",
                    insert_vals,
                )
                _commit()

            # Also auto-populate the holding row for fields the user hasn't
            # manually set yet.
            h_row = next((h for h in holdings if h['symbol'] == sym), {})
            auto_updates: Dict = {}
            for fld in _HOLDING_EDITABLE_FIELDS:
                if h_row.get(fld) is None and fld in sched:
                    auto_updates[fld] = sched[fld]
            if auto_updates:
                set_holding_info(portfolio_id, sym, auto_updates)

            schedule_updated += 1
        except Exception as ex:
            print(f"[do_refresh_prices] schedule {sym}: {ex}")

    # ── 3. Auto-roll past payment dates and record due dividends ─────────────
    auto_divs = []
    try:
        auto_divs = auto_roll_and_record_dividends(portfolio_id)
    except Exception as ex:
        print(f"[do_refresh_prices] auto_roll error: {ex}")

    # Return prices for extra (order-watch) symbols so the frontend can update
    # its priceMap without an additional round-trip.
    order_prices = {sym: prices[sym] for sym in extra if sym in prices}

    return {
        'refreshed':       len(prices),
        'symbols':         list(prices.keys()),
        'schedule_updated': schedule_updated,
        'auto_dividends':  auto_divs,
        'order_prices':    order_prices,   # {symbol: price} for caller-supplied syms
    }


# ── Dividends ──────────────────────────────────────────────────────────────────

def record_dividend(portfolio_id: int, symbol: str, amount_per_share: float,
                    total_shares: float = None, payment_date: str = None,
                    reinvest: bool = False, notes: str = '',
                    div_type: str = 'DIVIDEND') -> Dict:
    symbol = symbol.upper()
    if total_shares is None:
        c = _cur()
        c.execute("SELECT total_shares FROM holdings WHERE portfolio_id=? AND symbol=?",
                  (portfolio_id, symbol))
        row = c.fetchone()
        if not row:
            raise ValueError(f"No holding for {symbol}")
        total_shares = float(row['total_shares'])

    total = amount_per_share * total_shares
    payment_date = payment_date or _today()
    c = _cur()
    c.execute("""
        INSERT INTO dividends (portfolio_id, symbol, dividend_type, amount_per_share,
            total_shares, total_amount, payment_date, reinvested, notes)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (portfolio_id, symbol, div_type, amount_per_share, total_shares,
          total, payment_date, int(reinvest), notes))
    _commit()
    div_id = c.lastrowid

    # Always credit dividend to cash first — for DRIP the subsequent BUY deducts it
    # back out, so net cash effect is zero. This ensures total_value always grows
    # by the dividend amount regardless of reinvestment choice.
    p = get_portfolio(portfolio_id)
    if p:
        c.execute("UPDATE portfolios SET current_cash=?, updated_at=datetime('now') WHERE portfolio_id=?",
                  (p['current_cash'] + total, portfolio_id))
        _commit()

    if reinvest:
        price = get_price(symbol)
        if price > 0:
            reinvest_shares = total / price
            c.execute("""
                UPDATE dividends SET reinvested=1, reinvested_shares=?, reinvested_price=?
                WHERE dividend_id=?
            """, (reinvest_shares, price, div_id))
            _commit()
            execute_buy(portfolio_id, symbol, reinvest_shares, price,
                        notes=f"DRIP: ${total:.2f}")

    return {'dividend_id': div_id, 'total_amount': total}


def get_dividends(portfolio_id: int, limit: int = 200) -> List[Dict]:
    c = _cur()
    c.execute("""
        SELECT * FROM dividends WHERE portfolio_id=?
        ORDER BY payment_date DESC, created_at DESC LIMIT ?
    """, (portfolio_id, limit))
    return _rows(c.fetchall())


# ── Value history (computed from transactions + yfinance) ──────────────────────

def get_history(portfolio_id: int) -> List[Dict]:
    """
    Reconstruct daily portfolio value from transactions + yfinance historical prices.

    Algorithm
    ---------
    1. Replay all BUY/SELL transactions in date order to track running shares and cash.
    2. Apply cash dividends (non-reinvested) on their payment dates.
    3. For each calendar day since the first transaction, look up the closing price
       for every held symbol from yfinance (forward-filled for weekends/holidays).
    4. Portfolio value = sum(shares × close_price) + cash.

    No daily snapshots are stored — yfinance supplies the price history on demand.
    Falls back to stored snapshots if yfinance is unavailable.
    """
    import yfinance as yf
    import pandas as pd

    port = get_portfolio(portfolio_id)
    if not port:
        return []

    c = _cur()

    # ── All transactions, oldest first ────────────────────────────────────────
    c.execute("""
        SELECT symbol, transaction_type, shares, total_amount, transaction_date
        FROM transactions
        WHERE portfolio_id=?
        ORDER BY transaction_date ASC, transaction_id ASC
    """, (portfolio_id,))
    txns = [dict(r) for r in c.fetchall()]

    if not txns:
        return []

    # ── All dividends — cash and DRIP ────────────────────────────────────────────
    # Cash dividends: credit goes to cash (net +total to portfolio value).
    # DRIP dividends: credit goes to cash (+total), then the corresponding BUY
    # transaction deducts it (-total), leaving net cash unchanged but holdings
    # increased. Both paths are correctly represented by including all dividends
    # here alongside the transaction replay.
    c.execute("""
        SELECT total_amount, payment_date
        FROM dividends
        WHERE portfolio_id=?
        ORDER BY payment_date ASC
    """, (portfolio_id,))
    cash_divs = [dict(r) for r in c.fetchall()]

    # ── Date range ─────────────────────────────────────────────────────────────
    first_date = txns[0]['transaction_date'][:10]
    today      = date.today()
    symbols    = list(set(t['symbol'] for t in txns))

    # ── Fetch historical closes from yfinance ─────────────────────────────────
    # One Ticker call per symbol — simple and reliable across yfinance versions.
    yf_start   = (date.fromisoformat(first_date) - timedelta(days=7)).isoformat()
    yf_end     = (today + timedelta(days=1)).isoformat()
    sym_prices: Dict[str, Dict[str, float]] = {}   # {symbol: {date_str: close}}

    for sym in symbols + ['SPY']:
        try:
            hist = yf.Ticker(sym).history(start=yf_start, end=yf_end, auto_adjust=True)
            if hist.empty:
                continue
            sym_prices[sym] = {
                idx.date().isoformat(): float(row['Close'])
                for idx, row in hist.iterrows()
                if not pd.isna(row['Close'])
            }
        except Exception as ex:
            print(f"[get_history] yfinance {sym}: {ex}")

    # If yfinance returned nothing at all, fall back to stored snapshots
    if not any(s in sym_prices for s in symbols):
        print("[get_history] yfinance unavailable — falling back to stored snapshots")
        return _get_stored_history(portfolio_id)

    # ── Day-by-day replay ──────────────────────────────────────────────────────
    seed      = float(port['seed_capital'])
    cash      = seed
    holdings: Dict[str, float] = {}          # {symbol: shares}
    last_px:  Dict[str, float] = {}          # forward-fill last known close
    txn_i     = 0
    div_i     = 0
    result:   List[Dict] = []

    # SPY benchmark: normalise SPY to seed_capital on the first transaction date
    spy_start_px: Optional[float] = None
    last_spy_px:  Optional[float] = None

    cur_day = date.fromisoformat(first_date)
    while cur_day <= today:
        d_str = cur_day.isoformat()

        # Apply all transactions on or before today
        while txn_i < len(txns) and txns[txn_i]['transaction_date'][:10] <= d_str:
            t   = txns[txn_i]
            sym = t['symbol']
            if t['transaction_type'] == 'BUY':
                holdings[sym] = holdings.get(sym, 0.0) + t['shares']
                cash          -= t['total_amount']
                # Seed last_px with purchase price so symbols yfinance can't price
                # (newer ETFs, etc.) show cost-basis value instead of $0
                if t['shares'] > 0 and sym not in last_px:
                    last_px[sym] = t['total_amount'] / t['shares']
            elif t['transaction_type'] == 'SELL':
                holdings[sym] = holdings.get(sym, 0.0) - t['shares']
                cash          += t['total_amount']
                if holdings[sym] <= 1e-8:
                    holdings.pop(sym, None)
            txn_i += 1

        # Apply cash dividends on or before today
        while div_i < len(cash_divs) and cash_divs[div_i]['payment_date'][:10] <= d_str:
            cash  += cash_divs[div_i]['total_amount']
            div_i += 1

        # Forward-fill prices: update last_px when yfinance has a close for today
        for sym in holdings:
            if sym in sym_prices and d_str in sym_prices[sym]:
                last_px[sym] = sym_prices[sym][d_str]

        # SPY benchmark forward-fill and anchor
        if 'SPY' in sym_prices and d_str in sym_prices['SPY']:
            last_spy_px = sym_prices['SPY'][d_str]
        if spy_start_px is None and last_spy_px is not None:
            spy_start_px = last_spy_px   # anchor SPY to first available price

        # Compute portfolio value
        holdings_val = sum(
            holdings[sym] * last_px.get(sym, 0.0)
            for sym in holdings
        )
        total_val  = holdings_val + cash
        total_pnl  = total_val - seed
        pnl_pct    = (total_pnl / seed * 100) if seed > 0 else 0.0

        # SPY normalised value (what seed_capital would be worth in SPY)
        spy_val: Optional[float] = None
        spy_pct: Optional[float] = None
        if spy_start_px and last_spy_px:
            spy_val = seed * (last_spy_px / spy_start_px)
            spy_pct = (spy_val - seed) / seed * 100

        result.append({
            'snapshot_date':  d_str,
            'total_value':    round(total_val, 2),
            'holdings_value': round(holdings_val, 2),
            'cash_balance':   round(cash, 2),
            'total_pnl':      round(total_pnl, 2),
            'total_pnl_pct':  round(pnl_pct, 4),
            'spy_value':      round(spy_val, 2) if spy_val is not None else None,
            'spy_pct':        round(spy_pct, 4) if spy_pct is not None else None,
        })

        cur_day += timedelta(days=1)

    return result


def _get_stored_history(portfolio_id: int) -> List[Dict]:
    """Fallback: return any stored daily snapshots (legacy or manual saves)."""
    c = _cur()
    c.execute("""
        SELECT snapshot_date, total_value, holdings_value,
               cash_balance, total_pnl, total_pnl_pct
        FROM portfolio_snapshots
        WHERE portfolio_id=?
        ORDER BY snapshot_date ASC
    """, (portfolio_id,))
    return _rows(c.fetchall())


# ── Watchlist ──────────────────────────────────────────────────────────────────

def get_watchlist(portfolio_id: int) -> List[Dict]:
    c = _cur()
    c.execute("""
        SELECT w.*, pc.price, pc.change_pct, pc.prev_close
        FROM watchlist w
        LEFT JOIN price_cache pc ON w.symbol = pc.symbol
        WHERE w.portfolio_id=?
        ORDER BY w.added_at DESC
    """, (portfolio_id,))
    return _rows(c.fetchall())


def add_to_watchlist(portfolio_id: int, symbol: str, notes: str = '') -> int:
    c = _cur()
    try:
        c.execute("INSERT INTO watchlist (portfolio_id, symbol, notes) VALUES (?,?,?)",
                  (portfolio_id, symbol.upper(), notes))
        _commit()
        return c.lastrowid
    except sqlite3.IntegrityError:
        raise ValueError(f"{symbol} already in watchlist")


def remove_from_watchlist(watchlist_id: int):
    c = _cur()
    c.execute("DELETE FROM watchlist WHERE watchlist_id=?", (watchlist_id,))
    _commit()


# ── Schwab import ──────────────────────────────────────────────────────────────

def list_schwab_accounts() -> List[Dict]:
    """
    Return available Schwab accounts with position counts and total value.
    Used by the UI to let the user choose which account to import from.
    Returns [] if Schwab is not configured or unavailable.
    """
    try:
        from schwab_client import get_all_positions as _gap
        positions_by_acct = _gap()
        if not positions_by_acct:
            return []
        result = []
        for acct_key, acct_data in positions_by_acct.items():
            positions = {
                sym: pos for sym, pos in acct_data.get('positions', {}).items()
                if not pos.get('is_money_market') and float(pos.get('shares', 0)) > 0
            }
            result.append({
                'account': acct_key,
                'label':   acct_key.replace('_', ' ').title(),
                'positions': len(positions),
                'symbols': sorted(positions.keys()),
                'value':   float(acct_data.get('value', 0)),
            })
        return sorted(result, key=lambda x: x['label'])
    except Exception as e:
        print(f"[sim] list_schwab_accounts: {e}")
        return []


def import_from_schwab(portfolio_id: int, cash_override: float = None,
                       account_type: str = None) -> Dict:
    """
    Import current Schwab live positions into a simulated portfolio.
    - account_type: if provided, only import that Schwab account (e.g. 'roth')
    - Uses CURRENT live price as the buy price (not avg cost), so the imported
      position reflects today's market value from day one.
    - Dividend schedule is auto-populated via _auto_populate_new_holding.
    """
    try:
        from schwab_client import get_all_positions as _gap, get_quotes as _sq
        positions_by_acct = _gap()
    except Exception as e:
        raise ValueError(f"Schwab unavailable: {e}")

    if not positions_by_acct:
        raise ValueError("Schwab returned no data — check Schwab connection and account_mapping.json")

    p = get_portfolio(portfolio_id)
    if not p:
        raise ValueError("Portfolio not found")

    # Filter to requested account if specified
    if account_type:
        key = account_type.lower()
        positions_by_acct = {k: v for k, v in positions_by_acct.items() if k.lower() == key}
        if not positions_by_acct:
            available = ', '.join(sorted(positions_by_acct.keys())) if positions_by_acct else 'none found'
            raise ValueError(
                f"Account '{account_type}' not found in Schwab data. "
                f"Available: {available}"
            )

    # Collect all symbols first so we can batch-fetch current prices
    all_positions: List[tuple] = []
    for acct_data in positions_by_acct.values():
        for sym, pos in acct_data.get('positions', {}).items():
            if pos.get('is_money_market'):
                continue
            shares = float(pos.get('shares', 0))
            if shares <= 0:
                continue
            all_positions.append((sym, shares, pos))

    if not all_positions:
        raise ValueError("No eligible positions found in selected account(s)")

    # Batch-fetch live prices once
    syms_to_fetch = list({sym for sym, _, _ in all_positions})
    live_prices: Dict[str, float] = {}
    try:
        quotes = _sq(syms_to_fetch)
        for sym, q in quotes.items():
            p_val = q.get('price') or 0.0
            if p_val > 0:
                live_prices[sym] = float(p_val)
    except Exception as ex:
        print(f"[sim] import_from_schwab: quote fetch error: {ex}")

    imported = 0
    skipped  = []
    symbols  = []

    for sym, shares, pos in all_positions:
        cost  = float(pos.get('cost_per_share', 0))
        # Use live price; fall back to avg cost so the buy doesn't fail
        price = live_prices.get(sym) or get_price(sym) or cost
        if price <= 0:
            skipped.append(sym)
            continue
        try:
            execute_buy(
                portfolio_id, sym, shares, price=price,
                notes=f"Schwab import — {shares:.4f} sh @ ${price:.2f} (cost basis ${cost:.2f})",
            )
            symbols.append(sym)
            imported += 1
        except Exception as ex:
            print(f"[sim] import skip {sym}: {ex}")
            skipped.append(sym)

    # Optionally set cash override
    if cash_override is not None:
        c = _cur()
        c.execute("UPDATE portfolios SET current_cash=? WHERE portfolio_id=?",
                  (cash_override, portfolio_id))
        _commit()

    return {
        'imported': imported,
        'symbols':  symbols,
        'skipped':  skipped,
        'accounts': sorted(positions_by_acct.keys()),
    }
