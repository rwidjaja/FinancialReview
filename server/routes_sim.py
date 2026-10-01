"""
routes_sim.py — Trade Simulation HTTP route handler.

All /api/sim/** requests are delegated here from server.py.
This module is entirely self-contained: it imports sim_portfolio
directly and has no dependency back on server.py.

Public interface
────────────────
    handle(handler) -> bool
        Route the current request.  Pass in the BaseHTTPRequestHandler
        instance.  Returns True if the request was handled (response sent),
        False if the path was not recognised (caller should 404).
"""
import json
import math
import re

import sim_portfolio as sp


# ── JSON serialiser (NaN/Inf → null) ──────────────────────────────────────────
def _json(obj: object) -> bytes:
    def _san(o):
        if isinstance(o, float):
            return None if (math.isnan(o) or math.isinf(o)) else o
        if isinstance(o, dict):
            return {k: _san(v) for k, v in o.items()}
        if isinstance(o, list):
            return [_san(v) for v in o]
        return o
    return json.dumps(_san(obj)).encode()


# ── Route handler ──────────────────────────────────────────────────────────────
def handle(handler) -> bool:
    """Route all /api/sim/... requests. Returns True if handled."""
    path = handler.path.split('?')[0]   # strip query string
    meth = handler.command

    # ── response helpers (closures over handler) ──────────────────────────────
    def ok(data):
        body = _json(data)
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Content-Length', len(body))
        handler.end_headers()
        handler.wfile.write(body)
        return True

    def err(msg, code=400):
        body = json.dumps({'error': msg}).encode()
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json')
        handler.end_headers()
        handler.wfile.write(body)
        return True

    def body():
        try:
            n = int(handler.headers.get('Content-Length', 0) or 0)
            return json.loads(handler.rfile.read(n)) if n else {}
        except Exception:
            return {}

    # ── Swing analysis routes (/api/sim/swing/... and /api/sim/swing-setups/...)
    if '/swing' in path:
        result = _handle_swing(handler)
        if result:
            return True

    # ── GET /api/sim/schwab-accounts ─────────────────────────────────────────
    if path == '/api/sim/schwab-accounts' and meth == 'GET':
        return ok(sp.list_schwab_accounts())

    # ── GET /api/sim/quote/{symbol} ───────────────────────────────────────────
    m = re.match(r'^/api/sim/quote/([A-Z0-9.\-^]+)$', path)
    if m and meth == 'GET':
        return ok(sp.get_quote(m.group(1).upper()))

    # ── GET /api/sim/portfolios ───────────────────────────────────────────────
    if path == '/api/sim/portfolios' and meth == 'GET':
        return ok(sp.list_portfolios())

    # ── POST /api/sim/portfolios ──────────────────────────────────────────────
    if path == '/api/sim/portfolios' and meth == 'POST':
        b = body()
        try:
            p = sp.create_portfolio(
                b['name'],
                b.get('description', ''),
                float(b.get('seed_capital', 1_000_000)),
            )
            return ok(p)
        except (KeyError, ValueError) as e:
            return err(str(e))

    # ── DELETE /api/sim/watchlist/{watchlist_id} ──────────────────────────────
    m2 = re.match(r'^/api/sim/watchlist/(\d+)$', path)
    if m2 and meth == 'DELETE':
        sp.remove_from_watchlist(int(m2.group(1)))
        return ok({'success': True})

    # ── PATCH /api/sim/portfolios/{id}/holdings/{symbol} ─────────────────────
    mh = re.match(r'^/api/sim/portfolios/(\d+)/holdings/([A-Z0-9.\-^]+)$', path)
    if mh and meth == 'PATCH':
        pid_h = int(mh.group(1))
        sym_h = mh.group(2).upper()
        b = body()

        # Collect all editable fields from the request body
        _NUM_FIELDS = {
            'dividend_yield', 'next_payment_per_share', 'dividend_growth_5y',
            'annual_dividend_per_share', 'beta', 'expense_ratio',
        }
        _STR_FIELDS = {'ex_dividend_date', 'next_payment_date', 'payment_frequency'}

        fields: dict = {}
        for fld in _NUM_FIELDS:
            if fld in b:
                raw = b[fld]
                fields[fld] = float(raw) if raw is not None else None
        for fld in _STR_FIELDS:
            if fld in b:
                raw = b[fld]
                fields[fld] = str(raw).strip() if raw else None

        if not fields:
            return err('No valid fields provided')

        found = sp.set_holding_info(pid_h, sym_h, fields)
        if not found:
            return err(f'No holding for {sym_h}', 404)
        return ok({'success': True, 'symbol': sym_h, **fields})

    # ── /api/sim/portfolios/{id}[/sub[/sub2]] ────────────────────────────────
    m = re.match(r'^/api/sim/portfolios/(\d+)(/[\w\-]+)?(/\d+)?$', path)
    if not m:
        return False

    pid  = int(m.group(1))
    sub  = m.group(2) or ''

    # GET /api/sim/portfolios/{id}
    if not sub and meth == 'GET':
        s = sp.get_portfolio_summary(pid)
        if not s:
            return err('Portfolio not found', 404)
        s['holdings']  = sp.get_holdings(pid)
        s['watchlist'] = sp.get_watchlist(pid)
        return ok(s)

    # PUT /api/sim/portfolios/{id}
    if not sub and meth == 'PUT':
        b = body()
        try:
            raw_def = b.get('is_default')
            is_def = bool(raw_def) if raw_def is not None else None
            sp.update_portfolio(pid, b.get('name'), b.get('description'), is_default=is_def)
            return ok({'success': True})
        except ValueError as e:
            return err(str(e))

    # DELETE /api/sim/portfolios/{id}
    if not sub and meth == 'DELETE':
        sp.delete_portfolio(pid)
        return ok({'success': True})

    # POST /api/sim/portfolios/{id}/buy
    if sub == '/buy' and meth == 'POST':
        b = body()
        try:
            return ok(sp.execute_buy(
                pid, b['symbol'], float(b['shares']),
                price=b.get('price'),
                commission=float(b.get('commission', 0)),
                txn_date=b.get('date'),
                notes=b.get('notes', ''),
            ))
        except (KeyError, ValueError) as e:
            return err(str(e))

    # POST /api/sim/portfolios/{id}/sell
    if sub == '/sell' and meth == 'POST':
        b = body()
        try:
            return ok(sp.execute_sell(
                pid, b['symbol'], float(b['shares']),
                price=b.get('price'),
                commission=float(b.get('commission', 0)),
                txn_date=b.get('date'),
                notes=b.get('notes', ''),
            ))
        except (KeyError, ValueError) as e:
            return err(str(e))

    # GET /api/sim/portfolios/{id}/transactions
    if sub == '/transactions' and meth == 'GET':
        return ok(sp.get_transactions(pid))

    # GET /api/sim/portfolios/{id}/dividends
    if sub == '/dividends' and meth == 'GET':
        return ok(sp.get_dividends(pid))

    # POST /api/sim/portfolios/{id}/dividends
    if sub == '/dividends' and meth == 'POST':
        b = body()
        try:
            return ok(sp.record_dividend(
                pid, b['symbol'], float(b['amount_per_share']),
                total_shares=b.get('total_shares'),
                payment_date=b.get('date'),
                reinvest=bool(b.get('reinvest', False)),
                notes=b.get('notes', ''),
            ))
        except (KeyError, ValueError) as e:
            return err(str(e))

    # GET /api/sim/portfolios/{id}/history
    if sub == '/history' and meth == 'GET':
        return ok(sp.get_history(pid))

    # GET /api/sim/portfolios/{id}/narrate  — AI briefing for this sim portfolio
    if sub == '/narrate' and meth == 'GET':
        try:
            import sim_briefing
            summary = sp.get_portfolio_summary(pid)
            history = sp.get_history(pid) or []
            if summary is None:
                return err("portfolio not found")
            payload = sim_briefing.narrate(summary, history)
        except Exception as e:
            payload = {"narrative": "", "source": "error", "cached": False, "view": None}
        return ok(payload)

    # POST /api/sim/portfolios/{id}/refresh-prices
    if sub == '/refresh-prices' and meth == 'POST':
        b = body()
        extra = b.get('extra_symbols', []) if isinstance(b, dict) else []
        return ok(sp.do_refresh_prices(pid, extra_symbols=extra))

    # POST /api/sim/portfolios/{id}/import-schwab
    if sub == '/import-schwab' and meth == 'POST':
        b = body()
        try:
            return ok(sp.import_from_schwab(
                pid,
                cash_override=b.get('cash'),
                account_type=b.get('account_type'),
            ))
        except ValueError as e:
            return err(str(e))

    # GET /api/sim/portfolios/{id}/watchlist
    if sub == '/watchlist' and meth == 'GET':
        return ok(sp.get_watchlist(pid))

    # POST /api/sim/portfolios/{id}/watchlist
    if sub == '/watchlist' and meth == 'POST':
        b = body()
        try:
            sym = b['symbol']
            wid = sp.add_to_watchlist(pid, sym, b.get('notes', ''))
            # Seed price_cache immediately so the watchlist table shows live data
            # without waiting for the next manual refresh-prices call.
            try:
                sp.refresh_prices([sym])
            except Exception:
                pass
            return ok({'watchlist_id': wid})
        except (KeyError, ValueError) as e:
            return err(str(e))

    # ── GET /api/sim/portfolios/{id}/swing-setups ─────────────────────────────
    if sub == '/swing-setups' and meth == 'GET':
        return ok(sp.get_swing_setups(pid))

    # ── POST /api/sim/portfolios/{id}/swing-setups ────────────────────────────
    if sub == '/swing-setups' and meth == 'POST':
        b = body()
        try:
            bt = b.get('buy_trigger')
            st = b.get('sell_trigger')
            sid = sp.add_swing_setup(
                portfolio_id = pid,
                symbol       = b['symbol'],
                timeframe    = b.get('timeframe', '1d'),
                entry_price  = float(b['entry_price']),
                stop_loss    = float(b['stop_loss']),
                take_profit  = float(b['take_profit']),
                buy_trigger  = float(bt) if bt is not None else None,
                sell_trigger = float(st) if st is not None else None,
                shares       = float(b.get('shares', 0)),
                signal_score = int(b.get('signal_score', 0)),
                notes        = b.get('notes', ''),
            )
            return ok({'setup_id': sid})
        except (KeyError, ValueError, TypeError) as e:
            return err(str(e))

    return False   # path not recognised


# ── Swing analysis (symbol-level, no portfolio required) ──────────────────────

def _handle_swing(handler) -> bool:
    """Routes under /api/sim/swing/..."""
    path = handler.path.split('?')[0]
    meth = handler.command

    def ok(data):
        import json, math
        def _san(o):
            if isinstance(o, float):
                return None if (math.isnan(o) or math.isinf(o)) else o
            if isinstance(o, dict):  return {k: _san(v) for k, v in o.items()}
            if isinstance(o, list):  return [_san(v) for v in o]
            return o
        body = json.dumps(_san(data)).encode()
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Content-Length', len(body))
        handler.end_headers()
        handler.wfile.write(body)
        return True

    def err(msg, code=400):
        import json
        body = json.dumps({'error': msg}).encode()
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json')
        handler.end_headers()
        handler.wfile.write(body)
        return True

    def body_json():
        try:
            import json
            n = int(handler.headers.get('Content-Length', 0) or 0)
            return json.loads(handler.rfile.read(n)) if n else {}
        except Exception:
            return {}

    # GET /api/sim/swing/{symbol}?interval=1d
    m = re.match(r'^/api/sim/swing/([A-Z0-9.\-^]+)$', path)
    if m and meth == 'GET':
        from urllib.parse import parse_qs, urlparse
        qs       = parse_qs(urlparse(handler.path).query)
        interval = qs.get('interval', ['1d'])[0]
        return ok(sp.analyze_swing(m.group(1).upper(), interval))

    # GET /api/sim/swing/{symbol}/calendar?weeks=6
    m_cal = re.match(r'^/api/sim/swing/([A-Z0-9.\-^]+)/calendar$', path)
    if m_cal and meth == 'GET':
        from urllib.parse import parse_qs, urlparse
        qs     = parse_qs(urlparse(handler.path).query)
        weeks  = int(qs.get('weeks',  ['6'])[0])
        t1     = float(qs.get('t1',   ['0.25'])[0])
        t2     = float(qs.get('t2',   ['0.35'])[0])
        t3     = float(qs.get('t3',   ['0.40'])[0])
        regime = qs.get('regime', ['CONSOLIDATION'])[0]
        vix    = float(qs.get('vix', ['0'])[0])
        return ok(sp.swing_calendar(m_cal.group(1).upper(),
                                    horizon_weeks=weeks,
                                    t1_pct=t1, t2_pct=t2, t3_pct=t3,
                                    regime=regime, vix=vix))

    # POST /api/sim/swing/rank  { symbols: ["SMH","XLK",...] }
    if path == '/api/sim/swing/rank' and meth == 'POST':
        b = body_json()
        syms = b.get('symbols', []) if isinstance(b, dict) else []
        return ok(sp.rank_opportunities(syms))

    # PATCH /api/sim/swing-setups/{id}
    m2 = re.match(r'^/api/sim/swing-setups/(\d+)$', path)
    if m2 and meth == 'PATCH':
        b = body_json()
        sp.update_swing_setup(int(m2.group(1)), b)
        return ok({'ok': True})

    # DELETE /api/sim/swing-setups/{id}
    if m2 and meth == 'DELETE':
        sp.delete_swing_setup(int(m2.group(1)))
        return ok({'ok': True})

    return False
