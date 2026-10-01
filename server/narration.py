"""
narration — shared LLM-call helpers used by briefing, position narratives, and
alert context. Single source of truth for the "summarise, never compute" rule.

Public API:

    call(system_prompt, user_payload, max_tokens=300) -> (text, source)
        text:   LLM output (stripped) or None on any failure
        source: "llm:<model>" on success, None on failure

    cached_narrate(cache_key, system_prompt, user_payload, max_tokens=300,
                   template_fn=None) -> {narrative, source, cached}
        Wraps call() with cache_kv read/write + template fallback.
        cache_key is whatever the caller computes (we don't dictate the
        hashing strategy; per-feature keys vary).

The shared `call()` keeps the LLM-discovery logic (local Ollama → cloud →
None) in one place, so adding a new narrated feature doesn't require
re-deriving the model selection or the failure modes.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, Optional, Tuple

import db_manager as _dbm


# ── Shared LLM call ──────────────────────────────────────────────────────────

def call(
    system_prompt: str,
    user_payload: Any,
    max_tokens: int = 300,
    temperature: float = 0.2,
) -> Tuple[Optional[str], Optional[str]]:
    """
    One LLM call with the project's standard model-discovery rules:

      1. Local Ollama if running (first available local model wins)
      2. Cloud (OpenRouter) via the first configured API key
      3. None if neither is reachable

    Returns (text, source) on success, (None, None) on any failure. Errors
    are swallowed — narration is a UX enhancement, never a blocker.
    """
    try:
        from ollama_client import (
            is_ollama_running, get_api_key_names, query_ollama, get_available_models,
        )
    except Exception:
        return None, None

    # Stringify the user payload. Dicts/lists become indented JSON so the LLM
    # can recognise the structure; strings pass through.
    user_msg = (
        user_payload if isinstance(user_payload, str)
        else json.dumps(user_payload, indent=2, default=str)
    )

    model: Optional[str] = None
    if is_ollama_running():
        for m in get_available_models() or []:
            if m.get("source") == "local" and m.get("id"):
                model = m["id"]
                break
    if model is None and get_api_key_names():
        model = "cloud:kimi-k2.5"
    if model is None:
        return None, None

    res = query_ollama(
        prompt=user_msg,
        model=model,
        system_prompt=system_prompt,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if not (res.get("success") and res.get("response")):
        return None, None
    return res["response"].strip(), f"llm:{model}"


# ── Cached narrate (LLM + cache_kv + optional template fallback) ─────────────

def cached_narrate(
    cache_key: str,
    system_prompt: str,
    user_payload: Any,
    max_tokens: int = 300,
    template_fn: Optional[Callable[[], str]] = None,
    temperature: float = 0.2,
) -> Dict[str, Any]:
    """
    Try the cache; fall through to LLM; fall through to a template builder
    if provided. The returned dict is the shape every narrated feature
    serves at its API endpoint:

        {"narrative": str, "source": "llm:<model>" | "template", "cached": bool}

    `narrative` is always a non-empty string when template_fn is provided.
    When template_fn is None and the LLM fails, returns an empty narrative
    and source="error" — the caller decides whether to surface that.
    """
    cached = _dbm.cache_get(cache_key)
    if isinstance(cached, dict) and cached.get("narrative"):
        return {**cached, "cached": True}

    text, source = call(system_prompt, user_payload,
                        max_tokens=max_tokens, temperature=temperature)
    if not text:
        if template_fn is not None:
            text = template_fn()
            source = "template"
        else:
            return {"narrative": "", "source": "error", "cached": False}

    out = {"narrative": text, "source": source, "cached": False}
    try:
        _dbm.cache_set(cache_key, {"narrative": text, "source": source})
    except Exception:
        pass
    return out
