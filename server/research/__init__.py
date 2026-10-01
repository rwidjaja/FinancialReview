"""
research package — split from the monolithic research.py for maintainability.

Public API is re-exported below so existing call sites keep working:
    from research import get_research, get_chart_data, get_peers,
                         build_portfolio_fit, get_etf_components

Internal layout:
  - indicators.py : Schwab/yfinance fetchers, technical indicators, period
                    helpers, classification, risk stats, behavioral guardrails
  - scoring.py    : quality score engine, action engine, correlation guidance,
                    portfolio action overlay
  - api.py        : public entry points (get_research, get_chart_data, …)
"""

from .api import (
    build_portfolio_fit,
    build_health_evaluation,
    get_chart_data,
    get_peers,
    get_research,
    get_etf_components,
)

__all__ = [
    "build_portfolio_fit",
    "build_health_evaluation",
    "get_chart_data",
    "get_peers",
    "get_research",
    "get_etf_components",
]
