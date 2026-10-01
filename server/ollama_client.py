#!/usr/bin/env python3
"""
Ollama API integration for local LLM queries.

API keys are loaded from ai_keys.json (same directory as this file).
Edit ai_keys.json to add/remove/update keys without touching code.
"""

import json
import os
import requests
from typing import Any, Dict, List, Optional

# Set DASHBOARD_DEBUG=1 (via start.sh --debug) to enable verbose startup logs
_DEBUG = os.environ.get("DASHBOARD_DEBUG") == "1"

# ── Ollama API endpoints ──────────────────────────────────────────────────────
_OLLAMA_BASE_URL  = "http://localhost:11434/api"
_OLLAMA_CLOUD_URL = "https://ollama.com/api/tags"

# ── OpenRouter endpoint (used when an API key is available) ───────────────────
_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Mapping from Ollama/short model names → OpenRouter model IDs
_OPENROUTER_MODEL_MAP = {
    "kimi-k2.5":             "moonshotai/kimi-k2",
    "kimi-k2-thinking":      "moonshotai/kimi-k2",
    "gemma3:27b":            "google/gemma-3-27b-it",
    "qwen3:32b":             "qwen/qwen3-32b",
    "llama3.3:70b":          "meta-llama/llama-3.3-70b-instruct",
    "mistral-small3.1:24b":  "mistralai/mistral-small-3.1-24b-instruct",
    "glm-4":                 "thudm/glm-4-9b",
    "qwen3-coder:480b":      "qwen/qwen3-coder-480b-a35b-instruct",
}

# ── Recommended cloud models (shown in UI regardless of cloud API response) ──
_RECOMMENDED_MODELS = [
    {"id": "kimi-k2.5",          "label": "Kimi K2.5 · OpenRouter"},
    {"id": "gemma3:27b",          "label": "Gemma 3 27B · OpenRouter"},
    {"id": "qwen3:32b",           "label": "Qwen 3 32B · OpenRouter"},
    {"id": "llama3.3:70b",        "label": "Llama 3.3 70B · OpenRouter"},
    {"id": "mistral-small3.1:24b","label": "Mistral Small 3.1 · OpenRouter"},
]

_CLOUD_MODEL_IDS = {m["id"] for m in _RECOMMENDED_MODELS} | {
    "kimi-k2-thinking", "glm-4", "glm-5", "glm-5.1", "qwen3-coder:480b", "gemma4:31b"
}

# ── Debug flag ────────────────────────────────────────────────────────────────
_DEBUG_AI = False

# ── Load API keys from external file ─────────────────────────────────────────
def _load_api_keys() -> dict:
    keys_file = os.path.join(os.path.dirname(__file__), "ai_keys.json")
    try:
        with open(keys_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        result = {}
        for k, v in data.items():
            if k.startswith("_"):
                continue
            if isinstance(v, str):
                stripped = v.strip()
                if stripped:
                    result[k] = stripped
                elif _DEBUG:
                    print(f"[ollama] Warning: key '{k}' has empty value — skipping")
            elif _DEBUG:
                print(f"[ollama] Warning: key '{k}' value is not a string (got {type(v).__name__}) — skipping")
        if not result and _DEBUG:
            print("[ollama] Warning: ai_keys.json loaded but no valid string keys found")
        return result
    except FileNotFoundError:
        if _DEBUG:
            print("[ollama] ai_keys.json not found — cloud AI disabled")
        return {}
    except Exception as e:
        print(f"[ollama] Error: could not load ai_keys.json: {e}")  # always print real errors
        return {}

_API_KEYS: dict = _load_api_keys()


def reload_api_keys() -> dict:
    """Hot-reload api keys from disk (useful if file is updated while running)."""
    global _API_KEYS
    _API_KEYS = _load_api_keys()
    return _API_KEYS


def get_api_key_names() -> list:
    """Return list of API key identifiers (no secrets)."""
    return list(_API_KEYS.keys())


def get_available_models() -> List[Dict[str, Any]]:
    """Get list of available models: local Ollama + recommended cloud + cloud API."""
    models = []

    # ── Local Ollama models ───────────────────────────────────────────────
    try:
        resp = requests.get(f"{_OLLAMA_BASE_URL}/tags", timeout=5)
        if resp.status_code == 200:
            for model in resp.json().get("models", []):
                name = model.get("name", "")
                if name:
                    models.append({
                        "id":     name,
                        "name":   name,
                        "size":   model.get("size", 0),
                        "source": "local",
                    })
    except Exception:
        pass

    # ── Recommended cloud models (always shown) ───────────────────────────
    seen_cloud = set()
    for m in _RECOMMENDED_MODELS:
        seen_cloud.add(m["id"])
        models.append({
            "id":          f"cloud:{m['id']}",
            "name":        m["id"],
            "label":       m["label"],
            "source":      "cloud",
            "recommended": True,
        })

    # ── Additional cloud models from ollama.com API ───────────────────────
    try:
        resp = requests.get(_OLLAMA_CLOUD_URL, timeout=10)
        if resp.status_code == 200:
            for model in resp.json().get("models", []):
                name = model.get("name", "")
                if name and name not in seen_cloud:
                    seen_cloud.add(name)
                    models.append({
                        "id":     f"cloud:{name}",
                        "name":   name,
                        "source": "cloud",
                    })
    except Exception:
        pass

    return models


def is_ollama_running() -> bool:
    """Check if local Ollama service is running."""
    try:
        return requests.get(f"{_OLLAMA_BASE_URL}/tags", timeout=2).status_code == 200
    except Exception:
        return False


def query_ollama(
    prompt: str,
    model: str = "kimi-k2.5",
    system_prompt: Optional[str] = None,
    context: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 4096,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Query Ollama (local or cloud) with a prompt."""
    result: Dict[str, Any] = {
        "success": False, "response": "", "model": model, "error": "",
    }

    is_cloud = model.startswith("cloud:") or model in _CLOUD_MODEL_IDS

    if is_cloud:
        actual_key = api_key
        if not actual_key:
            # Model name itself may embed the key id: "cloud:rwidjaja9"
            if model.startswith("cloud:"):
                key_or_model = model.split("cloud:", 1)[1]
                if key_or_model in _API_KEYS:
                    actual_key = _API_KEYS[key_or_model]
                else:
                    # It's a model name like "cloud:kimi-k2.5"; use first available key
                    actual_key = next(iter(_API_KEYS.values()), "")
            else:
                actual_key = next(iter(_API_KEYS.values()), "")
        return _query_cloud(prompt, model, actual_key, system_prompt, temperature, max_tokens, result)

    # ── Local Ollama ──────────────────────────────────────────────────────
    try:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if context:
            messages.append({"role": "user", "content": context})
        messages.append({"role": "user", "content": prompt})

        resp = requests.post(
            f"{_OLLAMA_BASE_URL}/chat",
            json={"model": model, "messages": messages, "stream": False,
                  "options": {"temperature": temperature, "num_predict": max_tokens}},
            timeout=180,
        )
        if resp.status_code == 200:
            data = resp.json()
            result["success"]  = True
            result["response"] = data.get("message", {}).get("content", "")
            usage = data.get("prompt_eval_count", 0), data.get("eval_count", 0)
            result["usage"] = {"prompt_tokens": usage[0], "completion_tokens": usage[1],
                                "total_tokens": usage[0] + usage[1]}
        else:
            result["error"] = f"Ollama error {resp.status_code}: {resp.text[:300]}"
    except requests.exceptions.Timeout:
        result["error"] = "Request timed out — model may be loading"
    except Exception as e:
        result["error"] = f"Connection error: {e}"

    return result


def _query_cloud(
    prompt: str,
    model: str,
    api_key: str,
    system_prompt: Optional[str],
    temperature: float,
    max_tokens: int,
    result: Dict,
) -> Dict:
    """Query ollama.com cloud API with Bearer auth (requires Ollama subscription).
    Falls back gracefully if no key is available.
    """
    try:
        model_name = model.replace("cloud:", "")
        # If model_name is actually a key id (legacy), use the default recommended model
        if model_name in _API_KEYS:
            model_name = _RECOMMENDED_MODELS[0]["id"]

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        # Clean the key (strip whitespace/BOM) and build headers
        key_clean = api_key.strip() if isinstance(api_key, str) else ""
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if key_clean:
            headers["Authorization"] = f"Bearer {key_clean}"
            print(f"[ollama] cloud → model={model_name} key_len={len(key_clean)} key_prefix={key_clean[:8]}…")
        else:
            print(f"[ollama] cloud → model={model_name} (no key — unauthenticated)")

        resp = requests.post(
            "https://ollama.com/api/chat",
            headers=headers,
            json={
                "model":       model_name,
                "messages":    messages,
                "stream":      False,
                "temperature": temperature,
                "max_tokens":  max_tokens,
            },
            timeout=180,
        )
        result["model"] = f"cloud:{model_name}"
        print(f"[ollama] cloud response: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            result["success"]  = True
            result["response"] = data.get("message", {}).get("content", "")
            usage = data.get("usage", {})
            result["usage"] = {
                "prompt_tokens":     usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "total_tokens":      usage.get("total_tokens", 0),
            }
        else:
            result["error"] = f"Cloud API {resp.status_code}: {resp.text[:400]}"
    except Exception as e:
        result["error"] = f"Cloud API error: {e}"

    return result


def query_chart_spec(
    prompt: str,
    model: str = "cloud:kimi-k2.5",
    api_key_id: str = "",
) -> Dict[str, Any]:
    """Ask the AI to return a JSON chart specification for the given prompt.
    Returns {'success': True, 'spec': {...}} or {'success': False, 'error': ...}.
    """
    system_prompt = """\
You are a financial data visualization assistant. When asked to create a chart, respond with ONLY a valid JSON object — no markdown, no explanation, no code fences.

Available data_source values:
  top_holdings      positions sorted by market value (fields: symbol, value, cost, gain, gainPct)
  accounts          account-level totals (fields: label, value, cost, pnl, pnl_pct)
  monthly_income    monthly dividend income (fields: month, value)
  performance_ytd   YTD return % per symbol (fields: symbol, value)
  performance_1m    1-month return % per symbol
  performance_3m    3-month return % per symbol
  gains_by_symbol   unrealized gain % per symbol sorted by magnitude

JSON schema:
{
  "chart_type":  "bar | pie | doughnut | line | horizontal_bar",
  "title":       "human-readable chart title",
  "data_source": "one of the above keys",
  "limit":       10,
  "metric":      "the numeric field to plot (e.g. value, gainPct, pnl_pct)",
  "label":       "the label field (e.g. symbol, label, month)",
  "color_mode":  "pnl | rainbow | blue"
}"""

    api_key = _API_KEYS.get(api_key_id, next(iter(_API_KEYS.values()), "")) if api_key_id else \
              next(iter(_API_KEYS.values()), "")

    result = query_ollama(
        prompt=f"Create a chart for: {prompt}",
        model=model,
        system_prompt=system_prompt,
        temperature=0.1,
        max_tokens=256,
        api_key=api_key,
    )

    if not result["success"]:
        return {"success": False, "error": result.get("error", "AI query failed")}

    raw = result["response"].strip()
    # Strip markdown code fences if model wrapped the JSON
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1].lstrip("json").strip() if len(parts) > 1 else raw

    try:
        import json as _json
        spec = _json.loads(raw)
        return {"success": True, "spec": spec}
    except Exception as exc:
        return {"success": False, "error": f"Bad JSON from AI: {exc}", "raw": raw}


def query_with_data(
    prompt: str,
    data_context: str,
    model: str = "cloud:kimi-k2.5",
    api_key_id: str = "",
    temperature: float = 0.3,
) -> Dict[str, Any]:
    """Main entry point: query with full portfolio context injected."""
    if _DEBUG_AI:
        print(f"[AI] model={model} key={api_key_id} prompt={prompt[:60]!r}")

    # Resolve API key: use named key → fallback to first available key
    api_key = _API_KEYS.get(api_key_id) if api_key_id else None
    if not api_key:
        api_key = next(iter(_API_KEYS.values()), "")

    system_prompt = f"""You are a knowledgeable financial analyst assistant with access to the user's \
complete portfolio data and live market benchmark data.

Guidelines:
- Be specific with numbers ($138,312 not "a lot")
- Use percentages where relevant
- If data is unavailable, say so rather than guessing
- Format dollar amounts with commas ($1,234,567)
- When discussing tax brackets, reference specific dollar amounts
- Keep responses concise but complete
- For market comparison questions (vs SPY, vs QQQ, beta, correlation, etc.) use the
  MARKET BENCHMARKS section in the data below — it contains live prices and returns
  for SPY, QQQ, IWM, SCHD, AGG, VIX, and the 10-year Treasury yield
- When comparing portfolio returns to benchmarks, reference the specific return figures
  from both the PERFORMANCE section (portfolio) and MARKET BENCHMARKS section
- For purchase history, lot details, or cost basis questions use ONLY the
  COST BASIS LOTS section — never invent or estimate lot dates or prices

PORTFOLIO DATA:
{data_context}"""

    return query_ollama(
        prompt=prompt,
        model=model,
        system_prompt=system_prompt,
        temperature=temperature,
        max_tokens=4096,
        api_key=api_key,
    )
