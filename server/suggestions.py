"""
suggestions — context-aware starter prompts for the AI chat sidebar.

The existing Advanced-mode chat sidebar shows 13 static suggestions. This
module builds 3-6 prompts that reference what's *actually happening* in
the portfolio right now, derived from the signals layer.

Notes on design:
  - The LLM is NOT used here. These are deterministic prompt templates
    filled from signals + diffs. The LLM is what *answers* the prompts
    later, not what generates them.
  - The output is purely text suggestions; clicking one sends the
    pre-filled prompt to /api/ai/query via the existing chat flow.
  - We always include 1-2 evergreen suggestions ("Portfolio summary",
    "Top risks today") so the panel isn't empty when there are no signals.
"""

from __future__ import annotations

from typing import Any, Dict, List


def _evergreen() -> List[Dict[str, str]]:
    """Universally-applicable starter prompts. Always shown."""
    return [
        {
            "label":  "Portfolio summary",
            "prompt": "Give me a concise summary of my portfolio: total value, income, top risks, and one key action item.",
            "group":  "evergreen",
        },
        {
            "label":  "Top 3 risks today",
            "prompt": "What are my top three portfolio risks right now and what should I review first?",
            "group":  "evergreen",
        },
    ]


def _from_signal(sig: Dict[str, Any]) -> Dict[str, str] | None:
    """Translate one signal into a focused starter prompt."""
    kind = sig.get("kind")
    symbol = sig.get("symbol")
    headline = sig.get("headline") or ""

    if kind == "concentration_top1" and symbol:
        return {
            "label":  f"Reduce {symbol}?",
            "prompt": (
                f"My {symbol} position is currently {headline.lower()}. "
                f"Walk me through what would change in my fragility, vol budget, "
                f"and income if I trimmed {symbol} down to 25%."
            ),
            "group":  "signal",
        }
    if kind == "concentration_top3":
        return {
            "label":  "Diversify top 3",
            "prompt": (
                f"My top three holdings are heavily concentrated ({headline.lower()}). "
                f"What lower-correlation funds could I add to spread risk without "
                f"sacrificing income?"
            ),
            "group":  "signal",
        }
    if kind == "vol_budget_breach":
        return {
            "label":  "Explain vol budget",
            "prompt": (
                f"My volatility budget is breached ({headline.lower()}). "
                f"Which of my positions are the biggest contributors and what would "
                f"happen if I trimmed each of them by half?"
            ),
            "group":  "signal",
        }
    if kind == "tax_bracket_pressure":
        return {
            "label":  "Tax bracket plan",
            "prompt": (
                f"My tax-bracket pressure is elevated ({headline.lower()}). "
                f"How much conversion room do I have left, and what timing would "
                f"keep me inside the 22% bracket?"
            ),
            "group":  "signal",
        }
    return None


def build(data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """
    Produce the suggestion list for the current dashboard state.

    Args:
        data: the cached fetch_all_data result. Pass None to get evergreens only.

    Returns:
        {
          "suggestions": [{label, prompt, group}, ...],
          "signal_count": int,
        }
    """
    suggestions: List[Dict[str, str]] = list(_evergreen())
    signals: List[Dict[str, Any]] = ((data or {}).get("signals") or [])
    for sig in signals:
        item = _from_signal(sig)
        if item:
            suggestions.append(item)
    # Cap at 8 — keeps the sidebar from sprawling
    return {
        "suggestions":  suggestions[:8],
        "signal_count": len(signals),
    }
