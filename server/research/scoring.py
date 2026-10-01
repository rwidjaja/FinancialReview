#!/usr/bin/env python3
"""research.scoring — quality score engine, action engine, correlation guidance,
and portfolio action overlay. Self-contained (operates on pre-computed values)."""

from typing import Optional


# ── Quality Scoring Engine ─────────────────────────────────────────────────────

def _compute_quality_score(
    sym_class: dict,
    profile: dict,
    key_stats: dict,
    risk_stats: dict,
    distributions: dict,
    annualized_returns: dict,
    nav_metrics: dict = None,
    prem_disc_pct: float = None,
) -> dict:
    """
    Type-specific quality score (0-100) + income quality score.
    Inputs are all already-computed dicts from get_research().
    Returns quality_engine dict consumed by both backend and frontend.
    """
    sym_type = sym_class.get("type", "STOCK")
    subtype  = sym_class.get("subtype", "")
    nm       = nav_metrics or {}
    sym_ann  = (annualized_returns or {}).get("symbol", {})
    spy_ann  = (annualized_returns or {}).get("spy", {})
    ks       = key_stats or {}

    # Fine-grained security_type for UI display
    if sym_type == "ETF":
        if subtype == "option-income": security_type = "etf_option_income"
        elif subtype == "dividend":    security_type = "etf_dividend"
        elif subtype == "growth":      security_type = "etf_growth"
        elif subtype == "sector":      security_type = "etf_sector"
        else:                          security_type = "etf_equity"
    elif sym_type == "BOND_ETF":   security_type = "etf_bond"
    elif sym_type == "CEF":        security_type = "cef"
    elif sym_type == "STOCK":      security_type = "stock"
    elif sym_type == "BDC":        security_type = "bdc"
    elif sym_type == "REIT":       security_type = "reit"
    elif sym_type == "PREFERRED":  security_type = "preferred"
    else:                          security_type = sym_type.lower()

    breakdown = {}
    total = 0
    max_possible = 0

    def _add(key, pts, max_pts, reason=""):
        nonlocal total, max_possible
        pts = max(0, min(pts, max_pts))
        total += pts
        max_possible += max_pts
        breakdown[key] = {"points": pts, "max": max_pts, "reason": reason}

    sharpe       = risk_stats.get("sharpe")
    beta         = risk_stats.get("beta")
    alpha        = risk_stats.get("alpha")
    max_dd       = risk_stats.get("max_drawdown")
    up_cap       = risk_stats.get("upside_capture")
    down_cap     = risk_stats.get("downside_capture")
    expense      = profile.get("expense_ratio")
    total_assets = profile.get("total_assets")
    ttm_yield    = float(distributions.get("ttm_yield_pct") or distributions.get("market_yield_pct") or 0)
    ret_1y  = sym_ann.get("1Y")
    ret_3y  = sym_ann.get("3Y")
    ret_5y  = sym_ann.get("5Y")
    spy_1y  = spy_ann.get("1Y")
    spy_3y  = spy_ann.get("3Y")
    spy_5y  = spy_ann.get("5Y")

    # ── ETF Equity (growth / sector / dividend / broad) ───────────────────
    if security_type in ("etf_equity", "etf_growth", "etf_sector", "etf_dividend"):
        # Long-term return vs benchmark (30 pts)
        pts = 0
        if ret_3y is not None and spy_3y is not None:
            a3 = ret_3y - spy_3y
            pts += 20 if a3 > 5 else 12 if a3 > 0 else 6 if a3 > -5 else 0
        elif ret_3y is not None and ret_3y > 8:
            pts += 10
        if ret_5y is not None and spy_5y is not None:
            a5 = ret_5y - spy_5y
            pts += 10 if a5 > 3 else 6 if a5 > 0 else 0
        elif ret_5y is not None and ret_5y > 6:
            pts += 5
        _add("Long-term Return", pts, 30)

        # Risk-adjusted quality (30 pts)
        pts = 0
        if sharpe is not None:
            pts += 15 if sharpe > 1.2 else 10 if sharpe > 0.8 else 5 if sharpe > 0.4 else 0
        if max_dd is not None:
            pts += 10 if max_dd > -15 else 7 if max_dd > -25 else 3 if max_dd > -40 else 0
        if up_cap is not None and down_cap is not None and up_cap > down_cap:
            pts += 5
        _add("Risk-Adjusted Quality", pts, 30)

        # Cost efficiency (20 pts)
        if expense is not None:
            pts = 20 if expense < 0.001 else 17 if expense < 0.002 else 13 if expense < 0.004 else 9 if expense < 0.007 else 5 if expense < 0.01 else 2
        else:
            pts = 10
        _add("Cost Efficiency", pts, 20)

        # Liquidity (10 pts)
        pts = 0
        vol3m = risk_stats.get("vol_3m_avg")
        if total_assets:
            pts = 10 if total_assets >= 10e9 else 7 if total_assets >= 1e9 else 4 if total_assets >= 100e6 else 1
        elif vol3m:
            pts = 10 if vol3m > 5e6 else 7 if vol3m > 1e6 else 4 if vol3m > 100e3 else 1
        _add("Liquidity", pts, 10)

        # Diversification (10 pts)
        hc = profile.get("holdings_count")
        pts = (10 if hc > 100 else 7 if hc > 30 else 4 if hc > 10 else 1) if hc else 5
        _add("Diversification", pts, 10)

    # ── ETF Option-Income ─────────────────────────────────────────────────
    elif security_type == "etf_option_income":
        # NAV / price trend (40 pts) — primary signal for option-income
        pts = 0
        p1y = nm.get("price_12m_pct")
        p3m = nm.get("price_3m_pct")
        p6m = nm.get("price_6m_pct")
        pts += (20 if (p1y or 0) > -5 else 12 if (p1y or 0) > -10 else 5) if p1y is not None else 10
        pts += (10 if (p3m or 0) > -2 else 5) if p3m is not None else 5
        pts += (10 if (p6m or 0) > -3 else 5) if p6m is not None else 5
        _add("NAV / Price Trend", pts, 40)

        # Yield reasonableness (20 pts)
        pts = (20 if 8 <= ttm_yield <= 20 else 15 if 5 <= ttm_yield < 8 else 10 if 20 < ttm_yield <= 30 else 3 if ttm_yield > 30 else 10) if ttm_yield > 0 else 0
        _add("Yield Sustainability", pts, 20)

        # Fund size (10 pts)
        pts = (10 if (total_assets or 0) >= 5e9 else 7 if (total_assets or 0) >= 1e9 else 4 if (total_assets or 0) >= 500e6 else 1) if total_assets else 3
        _add("Fund Size", pts, 10)

        # Cost (10 pts)
        pts = (10 if (expense or 1) < 0.005 else 7 if (expense or 1) < 0.009 else 4 if (expense or 1) < 0.015 else 1) if expense is not None else 5
        _add("Expense Ratio", pts, 10)

        # Risk-adjusted return (20 pts)
        pts = 0
        if sharpe is not None:
            pts += 10 if sharpe > 0.8 else 6 if sharpe > 0.4 else 3 if sharpe > 0 else 0
        if max_dd is not None:
            pts += 10 if max_dd > -15 else 6 if max_dd > -25 else 3 if max_dd > -35 else 0
        _add("Risk-Adjusted Return", pts, 20)

    # ── CEF ───────────────────────────────────────────────────────────────
    elif security_type == "cef":
        # Long-term total return / NAV trend (35 pts)
        pts = 0
        p3m = nm.get("price_3m_pct")
        p6m = nm.get("price_6m_pct")
        if ret_5y is not None:
            pts += 15 if ret_5y > 5 else 8 if ret_5y > 0 else 3 if ret_5y > -5 else 0
        elif nm.get("price_12m_pct") is not None:
            pts += 10 if nm["price_12m_pct"] > 0 else 5 if nm["price_12m_pct"] > -10 else 0
        else:
            pts += 5
        pts += (10 if (p3m or 0) > -1 else 5) if p3m is not None else 5
        pts += (10 if (p6m or 0) > -3 else 5) if p6m is not None else 5
        _add("NAV / Long-term Trend", pts, 35)

        # Premium/discount (25 pts)
        if prem_disc_pct is None:
            pts = 12
        elif prem_disc_pct < -5:   pts = 25
        elif prem_disc_pct < -2:   pts = 20
        elif prem_disc_pct < 0:    pts = 15
        elif prem_disc_pct < 2:    pts = 10
        elif prem_disc_pct < 5:    pts = 5
        else:                      pts = 2
        _add("Premium / Discount", pts, 25)

        # Yield level (20 pts)
        pts = (20 if 5 <= ttm_yield <= 12 else 12 if 12 < ttm_yield <= 18 else 5 if ttm_yield > 18 else 15) if ttm_yield > 0 else 0
        _add("Distribution Level", pts, 20)

        # Fund history / management (10 pts)
        inc_date = profile.get("inception_date", "") or ""
        try:
            age_yrs = 2026 - int(inc_date[:4])
            pts = 10 if age_yrs > 15 else 6 if age_yrs > 5 else 3
        except Exception:
            pts = 5
        _add("Fund History", pts, 10)

        # Expense ratio (10 pts)
        pts = (10 if (expense or 1) < 0.005 else 7 if (expense or 1) < 0.010 else 4 if (expense or 1) < 0.015 else 2) if expense is not None else 5
        _add("Expense Ratio", pts, 10)

    # ── ETF Bond ──────────────────────────────────────────────────────────
    elif security_type == "etf_bond":
        pts = 0
        if sharpe is not None:
            pts += 15 if sharpe > 0.6 else 9 if sharpe > 0.3 else 4 if sharpe > 0 else 0
        if max_dd is not None:
            pts += 15 if max_dd > -10 else 8 if max_dd > -20 else 4 if max_dd > -30 else 0
        _add("Risk-Adjusted Return", pts, 30)

        pts = (25 if ttm_yield > 6 else 18 if ttm_yield > 4 else 12 if ttm_yield > 2 else 6) if ttm_yield > 0 else 0
        _add("Current Yield", pts, 25)

        pts = (25 if (expense or 1) < 0.001 else 20 if (expense or 1) < 0.002 else 13 if (expense or 1) < 0.005 else 7 if (expense or 1) < 0.01 else 3) if expense is not None else 12
        _add("Cost Efficiency", pts, 25)

        pts = (20 if (total_assets or 0) >= 20e9 else 15 if (total_assets or 0) >= 5e9 else 10 if (total_assets or 0) >= 1e9 else 5 if (total_assets or 0) >= 100e6 else 1) if total_assets else 5
        _add("Liquidity", pts, 20)

    # ── Stock ─────────────────────────────────────────────────────────────
    elif security_type == "stock":
        roe         = ks.get("return_on_equity")
        profit_marg = ks.get("profit_margin")
        d_to_e      = ks.get("debt_to_equity")
        cur_ratio   = ks.get("current_ratio")
        eps_g       = ks.get("earnings_growth")
        rev_g       = ks.get("revenue_growth")
        fwd_pe      = ks.get("forward_pe")
        pe          = ks.get("pe_ratio")
        peg         = ks.get("peg_ratio")
        rec         = ks.get("recommendation", "")

        pts = 0
        if roe is not None:      pts += 12 if roe > 0.20 else 8 if roe > 0.10 else 4 if roe > 0 else 0
        if profit_marg is not None: pts += 8 if profit_marg > 0.20 else 5 if profit_marg > 0.08 else 2 if profit_marg > 0 else 0
        if alpha is not None and alpha > 0: pts += 5
        _add("Profitability", pts, 25)

        pts = 0
        if eps_g is not None:    pts += 12 if eps_g > 0.20 else 8 if eps_g > 0.10 else 4 if eps_g > 0 else 0
        if rev_g is not None:    pts += 8 if rev_g > 0.15 else 5 if rev_g > 0.05 else 2 if rev_g > 0 else 0
        if ret_1y is not None and spy_1y is not None and ret_1y > spy_1y: pts += 5
        _add("Growth", pts, 25)

        pts = 0
        if d_to_e is not None:   pts += 12 if d_to_e < 50 else 8 if d_to_e < 100 else 4 if d_to_e < 200 else 0
        else:                     pts += 6
        if cur_ratio is not None: pts += 8 if cur_ratio > 2 else 5 if cur_ratio > 1 else 0
        else:                     pts += 4
        _add("Balance Sheet", pts, 20)

        pts = 0
        if fwd_pe is not None:   pts += 15 if fwd_pe < 15 else 10 if fwd_pe < 20 else 6 if fwd_pe < 30 else 2 if fwd_pe < 50 else 0
        elif pe is not None:     pts += 12 if pe < 15 else 8 if pe < 25 else 4 if pe < 40 else 0
        if peg is not None and peg < 1.5: pts += 5
        _add("Valuation", pts, 20)

        pts = 10 if rec == "strong_buy" else 7 if rec == "buy" else 4 if rec == "hold" else 0 if rec in ("sell", "strong_sell") else 4
        _add("Analyst View", pts, 10)

    # ── BDC / REIT ────────────────────────────────────────────────────────
    elif security_type in ("bdc", "reit"):
        pts = 0
        if ttm_yield > 0:        pts += 20 if 5 <= ttm_yield <= 15 else 10
        if ret_3y is not None:   pts += 10 if ret_3y > 5 else 5 if ret_3y > 0 else 0
        _add("Distribution Quality", pts, 30)

        pts = 0
        if ret_5y is not None:   pts += 15 if ret_5y > 10 else 10 if ret_5y > 5 else 5 if ret_5y > 0 else 0
        if ret_3y is not None:   pts += 10 if ret_3y > 8 else 6 if ret_3y > 3 else 0
        _add("Long-term Return", pts, 25)

        pts = 0
        dte = ks.get("debt_to_equity")
        if dte is not None:      pts += 15 if dte < 100 else 8 if dte < 200 else 4 if dte < 300 else 0
        else:                    pts += 8
        if sharpe is not None:   pts += 10 if sharpe > 0.8 else 6 if sharpe > 0.4 else 3 if sharpe > 0 else 0
        _add("Leverage / Risk", pts, 25)

        pts = 0
        if max_dd is not None:   pts += 10 if max_dd > -20 else 5 if max_dd > -35 else 0
        if ret_1y is not None:   pts += 10 if ret_1y > 5 else 5 if ret_1y > 0 else 0
        _add("Price Trend", pts, 20)

    # ── Fallback (MMF / CRYPTO / INDEX / ETN / PREFERRED) ────────────────
    else:
        pts = min(int(((sharpe or 0) + 1) * 25), 50) if sharpe is not None else 25
        _add("Risk-Adjusted", pts, 50)
        pts = min(int((ret_1y or 0) * 2), 50) if (ret_1y or 0) > 0 else 20
        _add("1Y Return", pts, 50)

    # Normalize to 0-100
    quality_score = round(total / max_possible * 100) if max_possible > 0 else 50
    quality_score = max(0, min(100, quality_score))
    quality_label = ("Strong" if quality_score >= 75 else "Good" if quality_score >= 60
                     else "Average" if quality_score >= 45 else "Weak" if quality_score >= 30 else "Speculative")

    # ── Income Quality Score (0-100) ──────────────────────────────────────
    income_quality_score = None
    income_quality_label = None

    if ttm_yield > 0 and sym_type not in ("MMF", "INDEX"):
        iq = 0; iq_max = 0

        def _iadd(pts, mp):
            nonlocal iq, iq_max
            iq += max(0, min(pts, mp)); iq_max += mp

        # Yield in sustainable range
        _iadd(25 if 4 <= ttm_yield <= 20 else 8 if ttm_yield > 20 else 15, 25)

        # NAV / price trend — key indicator income isn't funded by NAV erosion
        p1y = nm.get("price_12m_pct")
        if p1y is not None:
            _iadd(25 if p1y > -5 else 12 if p1y > -15 else 3, 25)
        elif ret_1y is not None:
            adj = ret_1y + ttm_yield  # approximate total return proxy
            _iadd(20 if adj > 0 else 12 if adj > -5 else 5, 25)
        else:
            _iadd(12, 25)

        # Risk-adjusted consistency
        _iadd((25 if sharpe > 1.0 else 17 if sharpe > 0.6 else 10 if sharpe > 0.3 else 4) if sharpe is not None else 12, 25)

        # Max drawdown (income funds should be stable)
        _iadd((25 if max_dd > -15 else 15 if max_dd > -25 else 8 if max_dd > -40 else 2) if max_dd is not None else 12, 25)

        # Distribution cut penalty — large cuts signal income deterioration
        _ann_hist = (distributions or {}).get("annual_history") or []
        if len(_ann_hist) >= 2:
            _recent_tot = _ann_hist[-1].get("total", 0) or 0
            _prior_tot  = _ann_hist[-2].get("total", 0) or 0
            if _prior_tot > 0 and _recent_tot < _prior_tot:
                _cut_pct = (_recent_tot - _prior_tot) / _prior_tot * 100
                if _cut_pct <= -50:
                    iq = max(0, iq - 35)   # major cut (e.g. −61%): severe penalty
                elif _cut_pct <= -25:
                    iq = max(0, iq - 20)   # significant cut
                elif _cut_pct <= -10:
                    iq = max(0, iq - 10)   # moderate cut

        income_quality_score = max(0, min(100, round(iq / iq_max * 100))) if iq_max > 0 else None
        if income_quality_score is not None:
            income_quality_label = ("Sustainable" if income_quality_score >= 70
                                    else "Neutral" if income_quality_score >= 45 else "At Risk")

    return {
        "security_type":        security_type,
        "quality_score":        quality_score,
        "quality_label":        quality_label,
        "quality_breakdown":    breakdown,
        "income_quality_score": income_quality_score,
        "income_quality_label": income_quality_label,
    }


def _compute_action(
    quality_score: int,
    income_quality_score: Optional[int],
    sym_class: dict,
    today_verdict: str,
    sizing_pct: int,
    guardrails: list,
    buy_triggered: bool,
    sell_triggered: bool,
    annualized_returns: dict = None,
    distributions: dict = None,
) -> dict:
    """
    Unified action engine: quality × technicals × event risk → Action + Size + AI view.
    Returns action_engine dict; may be further refined by portfolio overlay.
    """
    sym_type = sym_class.get("type", "STOCK")
    subtype  = sym_class.get("subtype", "")

    # Guardrail flags
    earn_imm  = any(g.get("code") == "EARNINGS_IMMINENT"  for g in guardrails)
    earn_near = any(g.get("code") == "EARNINGS_NEAR"      for g in guardrails)
    leveraged = any(g.get("code") == "LEVERAGED"          for g in guardrails)
    ext_yield = any(g.get("code") == "EXTREME_YIELD"      for g in guardrails)
    neg_5y    = any(g.get("code") == "NEGATIVE_5Y_RETURN" for g in guardrails)

    q = quality_score
    quality_tier = ("strong" if q >= 75 else "good" if q >= 60 else "average" if q >= 45
                    else "weak" if q >= 30 else "speculative")

    tech = today_verdict.upper()

    # Map technical signal → base action
    if "SELL ALL" in tech or "TRIM 50" in tech:
        base_action, base_size = "TRIM",       0
    elif "TAKE PROFIT" in tech:
        base_action, base_size = "TRIM",       0
    elif "STRONG BUY" in tech:
        base_action, base_size = "STRONG_BUY", 100
    elif "BUY" in tech and "WAIT" not in tech and "MONITOR" not in tech:
        base_action, base_size = "BUY",        sizing_pct
    else:
        base_action, base_size = "HOLD",       0

    # Quality modifier
    final_action, final_size = base_action, base_size

    if base_action == "STRONG_BUY":
        if quality_tier in ("weak", "speculative"):
            final_action, final_size = "BUY", 25
        elif quality_tier == "average":
            final_size = 50
        # strong / good → keep STRONG_BUY at 100
    elif base_action == "BUY":
        if quality_tier == "speculative":
            final_action, final_size = "HOLD", 0
        elif quality_tier == "weak":
            final_size = max(10, final_size // 2)
        elif quality_tier == "strong":
            final_size = min(100, final_size + 25)
    elif base_action == "TRIM" and quality_tier == "speculative":
        final_action = "AVOID"

    # Event risk caps
    if earn_imm and final_action in ("STRONG_BUY", "BUY"):
        final_action, final_size = "BUY", min(10, final_size)
    elif earn_near and final_action in ("STRONG_BUY", "BUY"):
        final_size = min(25, final_size)

    # Hard overrides
    if leveraged:                       final_size = min(25, final_size)
    if ext_yield and final_action in ("STRONG_BUY", "BUY"):
        final_action, final_size = "BUY", min(25, final_size)
    if neg_5y and final_action in ("STRONG_BUY", "BUY"):
        final_action, final_size = "HOLD", 0

    # AI View
    sym_ann   = (annualized_returns or {}).get("symbol", {})
    ret_1y    = sym_ann.get("1Y")
    yield_v   = float((distributions or {}).get("ttm_yield_pct") or 0)
    qp = {"strong": "High-quality", "good": "Good-quality", "average": "Average-quality",
          "weak": "Low-quality", "speculative": "Speculative"}[quality_tier]

    if final_action == "AVOID":
        ai = "Speculative quality + failing technicals — exit position, do not re-add."
    elif final_action == "TRIM":
        ai = "Exit/trim signal triggered — reduce or exit regardless of quality."
    elif final_action == "STRONG_BUY":
        ai = f"{qp} + oversold dip — strong entry, full size appropriate."
    elif final_action == "BUY":
        if earn_imm:
            ai = f"{qp} with buy signal but earnings <7 days — starter size only; wait for report."
        elif final_size <= 25:
            ai = f"Buy trigger present but {('low quality' if quality_tier in ('weak','speculative') else 'event/risk constraint')} limits size — small starter only."
        else:
            ai = f"{qp} — technical conditions met, standard size appropriate."
    else:
        if quality_tier in ("strong", "good") and not sell_triggered:
            ai = f"{qp} — hold existing; add more on pullback to buy trigger."
        elif quality_tier in ("weak", "speculative"):
            ai = "Low-quality holding — no add; consider trimming on any rally."
        else:
            ai = "No entry trigger met — hold existing position, watch buy zone."

    return {
        "action":       final_action,
        "size_guidance": final_size,
        "ai_view":      ai,
        "tech_verdict": today_verdict,
        "quality_tier": quality_tier,
    }


# ── Correlation-driven sizing guidance ──────────────────────────────────────────

def _build_correlation_guidance(p: dict) -> dict:
    """
    Returns sizing guidance dict driven by correlation analysis.
    Called from build_portfolio_fit which has all correlation data.
    """
    corr_port = p.get("corr_portfolio")
    corr_sl   = p.get("corr_sleeve")
    corr_sl_lbl = p.get("corr_sleeve_label") or ""
    corr_top3 = p.get("corr_top3") or []
    own_w     = p.get("own_weight", 0)
    beta      = p.get("beta")
    sym_type  = p.get("own_type", "STOCK")

    verdict   = "NEUTRAL"
    action    = ""
    strength  = ""

    if corr_port is not None:
        c = corr_port
        if c >= 0.9:
            verdict  = "CONCENTRATION"
            action   = (
                "Correlation to your portfolio is very high — this is a refinement of existing risk, "
                "not diversification. No need to size this aggressively. "
                + (f"You already have {own_w:.1f}% in this position. " if own_w > 0 else "")
                + "Treat any add as a conviction size-up, not a new position."
            )
            strength = "very_high"
        elif c >= 0.8:
            verdict  = "HIGH_CORRELATION"
            action   = (
                f"High correlation ({c:.2f}) — this fund moves closely with your portfolio. "
                "Diversification benefit is limited; treat as a conviction add within existing risk, not a new position. "
                + (f"You already have {own_w:.1f}% in this position. " if own_w > 0 else "")
                + "Size conservatively."
            )
            strength = "high"
        elif c >= 0.6:
            verdict  = "MODERATE"
            action   = (
                f"Moderate correlation ({c:.2f}) — adds some diversification but still broadly moves with your book. "
                "A modest allocation can add yield or exposure without dominating portfolio risk. "
                "Sizing is the main lever — keep it proportional."
            )
            strength = "moderate"
        elif c <= 0.4:
            verdict  = "DIVERSIFIER"
            action   = (
                f"Genuine diversifier ({c:.2f} correlation) — useful if you want to smooth portfolio volatility. "
                "This can justify a more meaningful size if the risk/reward is attractive."
            )
            strength = "low"
        else:
            verdict  = "NEUTRAL"
            action   = "No strong correlation signal — use other metrics to guide sizing."
            strength = "neutral"

    # Cross-sleeve duplicate warning
    sleeve_warning = ""
    if corr_sl is not None:
        if corr_sl >= 0.9 and own_w > 3:
            sleeve_warning = f"{corr_sl:.2f} correlation to your {corr_sl_lbl} sleeve — near-duplicate risk. "
            if verdict == "CONCENTRATION":
                action += (" Also: " + sleeve_warning + "Consolidating this position further increases concentration.")
        elif corr_sl >= 0.75 and own_w > 5:
            sleeve_warning = f"{corr_sl:.2f} correlation to {corr_sl_lbl} sleeve — meaningful overlap."

    # Top-holding overlap
    top_overlap = ""
    for ct3 in corr_top3:
        if ct3["corr"] >= 0.9 and own_w > 3:
            top_overlap = f"{ct3['symbol']} is one of your largest positions and correlates {ct3['corr']:.2f} with this — high overlap."
            break

    return {
        "verdict":         verdict,
        "action":          action,
        "strength":        strength,
        "sleeve_warning":   sleeve_warning,
        "top_overlap":     top_overlap,
        "corr_portfolio":  corr_port,
        "corr_sleeve":     corr_sl,
        "corr_sleeve_label": corr_sl_lbl,
    }


def _portfolio_action_overlay(action_engine: dict, own_weight: float,
                               corr_portfolio: float, beta: float) -> dict:
    """Apply portfolio-level risk to refine the base action_engine output."""
    if not action_engine or "action" not in action_engine:
        return action_engine or {}

    action   = action_engine.get("action", "HOLD")
    size     = action_engine.get("size_guidance", 0)
    ai       = action_engine.get("ai_view", "")
    overrides = []

    # Concentration block: already >25% with high beta
    if own_weight > 25 and (beta or 1.0) > 1.5 and action in ("STRONG_BUY", "BUY"):
        action = "HOLD"
        size   = 0
        overrides.append(f"Already {own_weight:.0f}% of portfolio + beta {beta:.1f} — no new adds")

    # Very high correlation → cut size in half
    if corr_portfolio is not None and corr_portfolio > 0.9 and action in ("STRONG_BUY", "BUY"):
        size = max(0, size // 2)
        overrides.append(f"Portfolio corr {corr_portfolio:.2f} — size reduced (near-duplicate risk)")

    # Concentration awareness for HOLD: flag large existing position even when not adding
    if action == "HOLD" and own_weight > 15:
        if own_weight > 25:
            overrides.append(f"Already {own_weight:.0f}% of portfolio — oversized; consider trimming on any technical sell signal")
        else:
            overrides.append(f"Existing {own_weight:.0f}% position is sizeable — do not add; only hold or trim")

    if overrides:
        ai = ai + " | Portfolio overlay: " + "; ".join(overrides) + "."

    return {**action_engine, "action": action, "size_guidance": size, "ai_view": ai,
            "portfolio_overrides": overrides}


# ── Portfolio-fit computation (called from server.py after get_research) ─────
