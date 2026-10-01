"""portfolio_data.config_helpers — snapshot/decision serialization and
spending-intelligence summary (pure functions, no module state)."""

from models import EtfSnapshot, EtfDecision
# spending_analytics is imported lazily inside _compute_spending_intelligence

def _snap_to_dict(snap: EtfSnapshot) -> dict:
    return {
        "symbol": snap.symbol,
        "price": snap.price,
        "nav": snap.nav,
        "ttm_yield": snap.ttm_yield,
        # annual_div_amount populated post-fetch from Schwab overlay (div_amount field)
        "annual_div_amount": None,
        "premium": snap.premium,
        "nav_drop_30d": snap.nav_drop_30d,
        "trend_90d": snap.trend_90d,
        "momentum_20d": snap.momentum_20d,
        "vol_30d_annual": snap.vol_30d_annual,
        "total_return_1y": snap.total_return_1y,
        "benchmark_return_1y": snap.benchmark_return_1y,
        "relative_return_1y": snap.relative_return_1y,
        "beta": snap.beta,
        "aum": snap.aum,
        "expense_ratio": snap.expense_ratio,
        "coverage_ratio": snap.coverage_ratio,
        "sma_200": snap.sma_200,
        "max_drawdown_6m": snap.max_drawdown_6m,
        "vix_current": snap.vix_current,
        "vix_90d_avg": snap.vix_90d_avg,
        "rsi_14": snap.rsi_14,
        "macd_bullish": snap.macd_bullish,
        "last_distribution": snap.last_distribution,
        "distribution_cut_pct": snap.distribution_cut_pct,
        "price_change": snap.price_change,
        "price_change_pct": snap.price_change_pct,
        "day_low": snap.day_low,
        "name": snap.name or "",
        "dividend_months": snap.dividend_months or [],
    }


def _decision_to_dict(d: EtfDecision) -> dict:
    return {
        "symbol": d.symbol,
        "overall": d.overall,
        "structural_status": d.structural_status,
        "metrics": {k: {"level": v.level, "message": v.message} for k, v in d.metrics.items()},
        "explanation": d.explanation,
        "summary": d.summary,
    }


def _compute_spending_intelligence(personal_cfg: dict) -> dict:
    """Load transactions.csv and return spending analytics dict."""
    try:
        from spending_analytics import analyze_spending
        # estimated_spending from personal.json is the single source of truth for spending baseline.
        # Do not fall back to a hardcoded number — if not set, pass 0 and let the analytics
        # derive true_annual_spending from actual transaction data instead.
        hardcoded = float((personal_cfg or {}).get("estimated_spending", 0) or 0)
        return analyze_spending(hardcoded_spending=hardcoded)
    except Exception:
        return {"available": False}
