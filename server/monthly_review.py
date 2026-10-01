"""
monthly_review — month-end CIO-style digest of the portfolio.

Queries analytics_history (one row per day) and signals_history (every
detected event) for a calendar month, derives:

  - start-of-month and end-of-month analytics snapshots
  - month-over-month deltas on key metrics
  - signal counts by severity, and the top recurring kinds

Then narrates the digest in 5-7 sentences using the same constrained-LLM
pattern as the rest of the AI layer. Pure narration over pre-computed
deltas — the LLM never derives a number.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import db_manager as _dbm
import narration

_CACHE_KEY_PREFIX = "monthly_review:"

_SYSTEM_PROMPT = (
    "You are a portfolio analyst writing a month-end review. "
    "Given a structured month digest (start/end snapshots, month-over-month "
    "deltas, signal counts, top issues), write 5-7 short sentences covering: "
    "headline portfolio change, risk-metric drift, tax-pressure drift, "
    "income trajectory, the dominant signal themes, and one closing "
    "observation. "
    "Use ONLY the numbers provided. "
    "Do not predict markets, give advice, or invent metrics. "
    "Plain text only — no headings, no bullets, no markdown."
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _month_bounds(year: int, month: int) -> Tuple[str, str]:
    """Return (YYYY-MM-01, YYYY-MM-last). Uses date arithmetic — no calendar lib."""
    start = date(year, month, 1)
    end   = date(year + (1 if month == 12 else 0), 1 if month == 12 else month + 1, 1)
    last_of_month = date.fromordinal(end.toordinal() - 1)
    return start.isoformat(), last_of_month.isoformat()


def _query_analytics(start_iso: str, end_iso: str) -> List[Dict[str, Any]]:
    """Pull every analytics_history row within [start, end] (inclusive)."""
    c = _dbm._conn()
    rows = c.execute(
        "SELECT as_of, snapshot_json FROM analytics_history "
        "WHERE as_of >= ? AND as_of <= ? ORDER BY as_of ASC",
        (start_iso, end_iso),
    ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        try:
            data = json.loads(r["snapshot_json"] or "{}")
            out.append({"as_of": r["as_of"], **data})
        except Exception:
            continue
    return out


def _query_signals(start_iso: str, end_iso: str) -> List[Dict[str, Any]]:
    """Pull every signal recorded within [start, end] (inclusive)."""
    c = _dbm._conn()
    rows = c.execute(
        "SELECT as_of, kind, symbol, severity, headline FROM signals_history "
        "WHERE as_of >= ? AND as_of <= ? ORDER BY recorded_at ASC",
        (start_iso, end_iso),
    ).fetchall()
    return [{"as_of": r["as_of"], "kind": r["kind"], "symbol": r["symbol"],
             "severity": r["severity"], "headline": r["headline"]} for r in rows]


def _pair(curr_v, prev_v) -> Optional[Dict[str, Any]]:
    """Compute a delta pair {prev, curr, delta} or None when either side is missing."""
    if curr_v is None or prev_v is None:
        return None
    try:
        delta = float(curr_v) - float(prev_v)
    except (TypeError, ValueError):
        return None
    return {"prev": prev_v, "curr": curr_v, "delta": round(delta, 2)}


def _summarise_signals(signals: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Counts + top recurring (kind, symbol) tuples for the LLM payload."""
    counts = {"info": 0, "warn": 0, "crit": 0}
    by_kind: Dict[str, int] = {}
    for s in signals:
        counts[s.get("severity", "info")] = counts.get(s.get("severity", "info"), 0) + 1
        key = s["kind"] if not s.get("symbol") else f"{s['kind']}:{s['symbol']}"
        by_kind[key] = by_kind.get(key, 0) + 1
    top_recurring = sorted(by_kind.items(), key=lambda kv: kv[1], reverse=True)[:5]
    # Distinct latest headlines (one per kind+symbol) for narrative grounding
    seen: set = set()
    sample_headlines: List[str] = []
    for s in reversed(signals):  # reversed = newest first
        key = s["kind"] if not s.get("symbol") else f"{s['kind']}:{s['symbol']}"
        if key in seen:
            continue
        seen.add(key)
        if s.get("headline"):
            sample_headlines.append(s["headline"])
        if len(sample_headlines) >= 5:
            break
    return {
        "counts":           counts,
        "top_recurring":    [{"key": k, "count": c} for k, c in top_recurring],
        "sample_headlines": sample_headlines,
    }


# ── Digest builder ───────────────────────────────────────────────────────────

def build_digest(year: int, month: int) -> Optional[Dict[str, Any]]:
    """Build the structured month digest the LLM (and the API) consume."""
    start_iso, end_iso = _month_bounds(year, month)
    rows = _query_analytics(start_iso, end_iso)
    if not rows:
        return None  # caller surfaces this as "no data for month"

    first = rows[0]
    last  = rows[-1]

    deltas = {
        "portfolio_value":   _pair(last.get("portfolio_value"),  first.get("portfolio_value")),
        "vol_budget_used":   _pair(last.get("vol_budget_used"),  first.get("vol_budget_used")),
        "fragility_score":   _pair(last.get("fragility_score"),  first.get("fragility_score")),
        "bracket_pressure":  _pair(last.get("bracket_pressure"), first.get("bracket_pressure")),
        "top_holding_pct":   _pair(last.get("top_holding_pct"),  first.get("top_holding_pct")),
        "ytd_income":        _pair(last.get("ytd_income"),       first.get("ytd_income")),
    }
    deltas = {k: v for k, v in deltas.items() if v is not None}

    signals = _query_signals(start_iso, end_iso)
    signal_summary = _summarise_signals(signals)

    return {
        "month":          f"{year:04d}-{month:02d}",
        "start_as_of":    first.get("as_of"),
        "end_as_of":      last.get("as_of"),
        "snapshot_count": len(rows),
        "start_snapshot": first,
        "end_snapshot":   last,
        "deltas":         deltas,
        "signals":        signal_summary,
    }


# ── Cache key ─────────────────────────────────────────────────────────────────

def _cache_key(digest: Dict[str, Any]) -> str:
    canon = {
        "month":     digest.get("month"),
        "end_as_of": digest.get("end_as_of"),
        "deltas":    digest.get("deltas"),
        "signals":   digest.get("signals"),
    }
    blob = json.dumps(canon, sort_keys=True, default=str)
    return _CACHE_KEY_PREFIX + hashlib.sha256(blob.encode()).hexdigest()[:24]


# ── Template fallback ─────────────────────────────────────────────────────────

def _template(digest: Dict[str, Any]) -> str:
    parts: List[str] = [f"Review for {digest.get('month', '?')}."]
    d = digest.get("deltas") or {}
    pv = d.get("portfolio_value")
    if pv:
        sign = "+" if pv["delta"] >= 0 else ""
        parts.append(f"Portfolio value {pv['prev']:,.0f} → {pv['curr']:,.0f} ({sign}{pv['delta']:,.0f}).")
    frag = d.get("fragility_score")
    if frag and frag["delta"]:
        parts.append(f"Fragility moved {frag['prev']:.0f} → {frag['curr']:.0f}.")
    vb = d.get("vol_budget_used")
    if vb and vb["delta"]:
        parts.append(f"Vol budget {vb['prev']:.0f} → {vb['curr']:.0f}.")
    bp = d.get("bracket_pressure")
    if bp and bp["delta"]:
        parts.append(f"Bracket pressure {bp['prev']:.1f} → {bp['curr']:.1f}.")
    sig = (digest.get("signals") or {}).get("counts") or {}
    if sig:
        parts.append(
            f"Signals: {sig.get('crit', 0)} critical, {sig.get('warn', 0)} warnings, "
            f"{sig.get('info', 0)} info."
        )
    return " ".join(parts)


# ── Public API ────────────────────────────────────────────────────────────────

def narrate(year: int, month: int) -> Dict[str, Any]:
    """
    Produce a month-end narrative + the structured digest it was generated from.

    Returns:
        {
          "narrative": str,           # 5-7 sentences (or "" if no data)
          "source":    "llm:..." | "template" | "no_data",
          "cached":    bool,
          "digest":    {...} | None,
        }
    """
    digest = build_digest(year, month)
    if digest is None:
        return {"narrative": "", "source": "no_data", "cached": False, "digest": None}

    out = narration.cached_narrate(
        cache_key=_cache_key(digest),
        system_prompt=_SYSTEM_PROMPT,
        user_payload=digest,
        max_tokens=400,
        template_fn=lambda: _template(digest),
    )
    return {**out, "digest": digest}
