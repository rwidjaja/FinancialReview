"""
chain_backtest — empirical lead-lag statistics for candidate early-warning
signals in the DRAM/SMH/SOXX chain, backtested against how often each target
actually declines with NO trigger at all (baseline) — plain hit rate is
misleading on its own: in a 3-year window where SMH/SOXX are up ~290%, the
baseline 2-session decline rate is already ~40%, so a "46.7% hit rate"
signal is a modest ~6pt edge, not the strong predictor it looks like read in
isolation. `edge_pts` (hit_rate - baseline) is the number that actually
answers "is this signal worth anything."

This isn't a predictive model — it's backward-looking frequency over real
price history — but the edge numbers ARE what let the frontend synthesize a
live "how many of these confirming signals are firing right now, and what's
their combined track record" readout, instead of leaving the user to
cross-reference a static table against today's numbers themselves.
"""
from typing import Dict, List, Optional

LOOKAHEAD_SESSIONS = 2      # matches "1-2 sessions later" in the existing UI copy
LOOKBACK_PERIOD     = '3y'  # ~750 trading sessions — enough for a meaningful sample

# Each signal: does `trigger_symbol` crossing `threshold` (return % for
# 'return' triggers, absolute level for 'level' triggers, e.g. VIX) predict a
# decline in each of `targets` within LOOKAHEAD_SESSIONS sessions?
SIGNAL_DEFS = [
    {'label': 'DRAM ≤ -1.5%', 'trigger_symbol': 'DRAM', 'kind': 'return', 'threshold': -1.5, 'targets': ['SMH', 'SOXX']},
    {'label': 'NVDA ≤ -2%',   'trigger_symbol': 'NVDA', 'kind': 'return', 'threshold': -2.0, 'targets': ['SMH', 'SOXX']},
    {'label': 'AMAT ≤ -2%',   'trigger_symbol': 'AMAT', 'kind': 'return', 'threshold': -2.0, 'targets': ['SMH', 'SOXX']},
    {'label': 'TSM ≤ -2%',    'trigger_symbol': 'TSM',  'kind': 'return', 'threshold': -2.0, 'targets': ['SMH', 'SOXX']},
    {'label': 'MU ≤ -2%',     'trigger_symbol': 'MU',   'kind': 'return', 'threshold': -2.0, 'targets': ['DRAM']},
    {'label': 'VIX ≥ 20',     'trigger_symbol': '^VIX', 'kind': 'level',  'threshold': 20.0, 'targets': ['SMH', 'SOXX']},
]

TARGET_SYMBOLS = sorted({t for d in SIGNAL_DEFS for t in d['targets']})
ALL_SYMBOLS    = sorted({d['trigger_symbol'] for d in SIGNAL_DEFS} | set(TARGET_SYMBOLS))


def _trigger_days(close: 'object', threshold: float, kind: str) -> 'object':
    """Return the index of sessions where the trigger condition fires."""
    if kind == 'level':
        return close[close >= threshold].index
    chg = close.pct_change() * 100
    return chg[chg <= threshold].index


def _forward_declines(target_close, positions) -> List[float]:
    """% change from each position to LOOKAHEAD_SESSIONS later, for every
    position that has a full lookahead window remaining."""
    out = []
    for pos in positions:
        end_pos = pos + LOOKAHEAD_SESSIONS
        if end_pos >= len(target_close):
            continue
        out.append((target_close.iloc[end_pos] - target_close.iloc[pos]) / target_close.iloc[pos] * 100)
    return out


def _measure(trigger_days, target_close) -> Optional[Dict]:
    """Hit rate + avg decline for target_close over LOOKAHEAD_SESSIONS after
    each trigger day. Returns None if there's no usable sample."""
    positions = [target_close.index.get_loc(d) for d in trigger_days if d in target_close.index]
    fwd = _forward_declines(target_close, positions)
    if not fwd:
        return None
    hits = [f for f in fwd if f < 0]
    return {
        'sample':          len(fwd),
        'hit_rate_pct':    round(len(hits) / len(fwd) * 100, 1),
        'avg_decline_pct': round(sum(hits) / len(hits), 2) if hits else 0.0,
    }


def _baseline(target_close) -> Dict:
    """Unconditional hit rate — every session used as a 'trigger', no
    condition at all. What the signal has to beat to mean anything."""
    fwd = _forward_declines(target_close, range(len(target_close)))
    hits = [f for f in fwd if f < 0]
    return {
        'hit_rate_pct': round(len(hits) / len(fwd) * 100, 1) if fwd else 0.0,
        'sample':       len(fwd),
    }


def compute_signal_backtest() -> Dict:
    """
    Backtest every definition in SIGNAL_DEFS against its target(s), one batch
    download for all symbols involved, plus each target's unconditional
    baseline rate.

    Returns {'rows': [...], 'baseline': {sym: hit_rate_pct}} — rows sorted by
    edge_pts (hit_rate - baseline) descending, since that's the number that
    actually says whether a signal beats doing nothing, not raw hit rate.
    """
    import yfinance as yf

    raw = yf.download(ALL_SYMBOLS, period=LOOKBACK_PERIOD, auto_adjust=True, progress=False, threads=False)['Close']

    baseline: Dict[str, float] = {}
    for target in TARGET_SYMBOLS:
        if target in raw.columns:
            baseline[target] = _baseline(raw[target].dropna())['hit_rate_pct']

    rows: List[Dict] = []
    for sig in SIGNAL_DEFS:
        trig_sym = sig['trigger_symbol']
        if trig_sym not in raw.columns:
            continue
        trig_close = raw[trig_sym].dropna()
        days = _trigger_days(trig_close, sig['threshold'], sig['kind'])

        for target in sig['targets']:
            if target not in raw.columns or target not in baseline:
                continue
            stat = _measure(days, raw[target].dropna())
            if stat is None:
                continue
            rows.append({
                'signal':             sig['label'],
                'trigger_symbol':     trig_sym,
                'trigger_kind':       sig['kind'],
                'trigger_threshold':  sig['threshold'],
                'target':             target,
                'baseline_pct':       baseline[target],
                'edge_pts':           round(stat['hit_rate_pct'] - baseline[target], 1),
                'lookahead_sessions': LOOKAHEAD_SESSIONS,
                'lookback_period':    LOOKBACK_PERIOD,
                **stat,
            })

    rows.sort(key=lambda r: r['edge_pts'], reverse=True)
    return {'rows': rows, 'baseline': baseline}
