"""
headline_sentiment — fetch financial headlines from free RSS feeds, classify
each headline with an LLM, compute a rolling sentiment score, and detect spikes.

All results are cached in db_manager.cache_kv so the detector
(headline_sentiment_drift.py) remains cheap and free of network I/O.

Public API
----------
get_snapshot() -> Optional[dict]
    Return a fresh (or cached) sentiment snapshot. Refreshes if older than TTL.

refresh() -> Optional[dict]
    Force a fetch-classify-score cycle, update cache, return snapshot.

Snapshot shape
--------------
{
  "score":         float,   # mean label score across headlines (-1..+1)
  "zscore":        float,   # deviation from rolling baseline
  "spike":         bool,    # True when z-score or % thresholds exceeded
  "neg_pct":       float,   # % headlines labelled negative/political/geo
  "political_pct": float,   # % headlines labelled political/geo/regulatory
  "n":             int,     # number of classified headlines
  "sources":       list,    # unique feed URLs that contributed
  "top_headlines": list,    # first 5 headline texts (for narration)
}
"""

from __future__ import annotations

import hashlib
import time
from typing import Any, Dict, List, Optional


def _dbm():
    import db_manager
    return db_manager

# ── Cache keys + TTLs ─────────────────────────────────────────────────────────

_SNAPSHOT_KEY = "headline_sentiment:snapshot"
_BASELINE_KEY = "headline_sentiment:baseline_history"
_SNAPSHOT_TTL = 600    # 10 min — avoid hammering RSS feeds
_CLASSIFY_TTL = 3600   # 1 h  — same headline text → same label

# ── RSS feeds (public, no auth required) ─────────────────────────────────────

_RSS_FEEDS: List[str] = [
    "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
]

# ── Label set + numeric scores ────────────────────────────────────────────────

_LABELS = {"positive", "neutral", "negative", "political", "geopolitical", "regulatory", "macro"}

# Bearish-biased scores: equities dislike political uncertainty more than macro noise.
_LABEL_SCORE: Dict[str, float] = {
    "positive":    1.0,
    "neutral":     0.0,
    "negative":   -1.0,
    "political":  -0.6,
    "geopolitical": -0.8,
    "regulatory": -0.4,
    "macro":      -0.1,
}

_CLASSIFY_SYSTEM = (
    "You are a financial-news sentiment classifier. "
    "Given a headline, return exactly ONE label from: "
    "positive, neutral, negative, political, geopolitical, regulatory, macro. "
    "Return only the single label word. No punctuation, no explanation."
)


# ── Headline fetching ─────────────────────────────────────────────────────────

def _fetch_headlines(max_items: int = 50) -> List[Dict[str, str]]:
    """Pull headlines from RSS feeds. Deduplicates by normalised title prefix."""
    try:
        import urllib.request
        import xml.etree.ElementTree as ET
    except Exception:
        return []

    seen: set = set()
    results: List[Dict[str, str]] = []

    for url in _RSS_FEEDS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = resp.read()
            root = ET.fromstring(body)
            # Support RSS 2.0 <item> and Atom <entry>
            items = root.findall(".//item")
            if not items:
                items = root.findall(".//{http://www.w3.org/2005/Atom}entry")
            for item in items:
                # Use explicit is-not-None checks — ElementTree elements are
                # falsy when they have no children, so `a or b` doesn't work.
                title_el = item.find("title")
                if title_el is None:
                    title_el = item.find("{http://www.w3.org/2005/Atom}title")
                if title_el is None or not (title_el.text or "").strip():
                    continue
                text = title_el.text.strip()
                dedup_key = text.lower()[:80]
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)
                link_el = item.find("link")
                if link_el is None:
                    link_el = item.find("{http://www.w3.org/2005/Atom}link")
                link = ""
                if link_el is not None:
                    link = (link_el.text or link_el.get("href") or "").strip()
                results.append({"text": text, "source": url, "link": link})
                if len(results) >= max_items:
                    break
        except Exception:
            continue
        if len(results) >= max_items:
            break

    return results


# ── LLM classification (per-headline cached) ─────────────────────────────────

def _classify_headlines(headlines: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """Classify each headline; results are individually cached for _CLASSIFY_TTL."""
    try:
        from ollama_client import (
            is_ollama_running, get_api_key_names,
            query_ollama, get_available_models,
        )
    except Exception:
        return [{**h, "label": "neutral"} for h in headlines]

    # Discover model once for the whole batch
    model: Optional[str] = None
    if is_ollama_running():
        for m in get_available_models() or []:
            if m.get("source") == "local" and m.get("id"):
                model = m["id"]
                break
    if model is None and get_api_key_names():
        model = "cloud:kimi-k2.5"

    results: List[Dict[str, Any]] = []
    for h in headlines:
        text = h["text"]
        cache_key = "headline_cls:" + hashlib.md5(text.encode()).hexdigest()[:16]

        cached = _dbm().cache_get_ts(cache_key)
        if cached is not None:
            value, ts = cached
            if time.time() - ts < _CLASSIFY_TTL and isinstance(value, dict) and value.get("label"):
                results.append({**h, "label": value["label"]})
                continue

        label = "neutral"
        if model:
            try:
                res = query_ollama(
                    prompt=text,
                    model=model,
                    system_prompt=_CLASSIFY_SYSTEM,
                    temperature=0.0,
                    max_tokens=10,
                )
                if res.get("success") and res.get("response"):
                    raw = res["response"].strip().lower().split()[0].rstrip(".,;:")
                    if raw in _LABELS:
                        label = raw
            except Exception:
                pass

        try:
            _dbm().cache_set(cache_key, {"label": label})
        except Exception:
            pass
        results.append({**h, "label": label})

    return results


# ── Scoring + spike detection ─────────────────────────────────────────────────

def _compute_snapshot(classified: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Convert label list → numeric score → z-score vs rolling baseline."""
    if not classified:
        return {
            "score": 0.0, "zscore": 0.0, "spike": False,
            "neg_pct": 0.0, "political_pct": 0.0,
            "n": 0, "sources": [], "top_headlines": [],
        }

    n = len(classified)
    scores = [_LABEL_SCORE.get(c.get("label", "neutral"), 0.0) for c in classified]
    current_score = sum(scores) / n

    neg_labels = {"negative", "political", "geopolitical"}
    pol_labels = {"political", "geopolitical", "regulatory"}
    neg_pct     = sum(1 for c in classified if c.get("label") in neg_labels) / n * 100
    political_pct = sum(1 for c in classified if c.get("label") in pol_labels) / n * 100

    # Rolling z-score against stored baseline history
    history = _dbm().cache_get(_BASELINE_KEY) or []
    if not isinstance(history, list):
        history = []

    zscore = 0.0
    if len(history) >= 3:
        hist_scores = [e["score"] for e in history if isinstance(e, dict) and "score" in e]
        if len(hist_scores) >= 2:
            mean = sum(hist_scores) / len(hist_scores)
            variance = sum((s - mean) ** 2 for s in hist_scores) / len(hist_scores)
            std = max(variance ** 0.5, 0.01)
            zscore = (current_score - mean) / std

    spike = zscore < -1.5 or neg_pct > 50 or political_pct > 40

    sources = list({c["source"] for c in classified if c.get("source")})
    top_headlines = [c["text"] for c in classified[:15]]

    return {
        "score":         round(current_score, 4),
        "zscore":        round(zscore, 4),
        "spike":         spike,
        "neg_pct":       round(neg_pct, 1),
        "political_pct": round(political_pct, 1),
        "n":             n,
        "sources":       sources,
        "top_headlines": top_headlines,
    }


def _update_baseline(snapshot: Dict[str, Any]) -> None:
    """Append current score to rolling history (keep last 48 entries ≈ 8 hours)."""
    history = _dbm().cache_get(_BASELINE_KEY) or []
    if not isinstance(history, list):
        history = []
    history.append({"score": snapshot["score"], "ts": time.time()})
    history = history[-48:]
    try:
        _dbm().cache_set(_BASELINE_KEY, history)
    except Exception:
        pass


# ── Public API ────────────────────────────────────────────────────────────────

def refresh() -> Optional[Dict[str, Any]]:
    """Fetch, classify, score. Cache result and update baseline. Return snapshot."""
    try:
        headlines = _fetch_headlines()
        classified = _classify_headlines(headlines)
        snapshot = _compute_snapshot(classified)
        _update_baseline(snapshot)
        # Only cache when we actually got headlines — a zero-result snapshot
        # should never be served stale; we want to retry on the next call.
        if snapshot.get("n", 0) >= 5:
            try:
                _dbm().cache_set(_SNAPSHOT_KEY, snapshot)
            except Exception:
                pass
        return snapshot
    except Exception as e:
        print(f"[headline_sentiment] refresh failed: {e}")
        return None


def get_snapshot() -> Optional[Dict[str, Any]]:
    """Return cached snapshot if fresh (< _SNAPSHOT_TTL seconds old), else refresh."""
    cached = _dbm().cache_get_ts(_SNAPSHOT_KEY)
    if cached is not None:
        value, ts = cached
        if (time.time() - ts < _SNAPSHOT_TTL
                and isinstance(value, dict)
                and value.get("n", 0) >= 5):
            return value
    return refresh()
