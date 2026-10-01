from typing import Dict, Any, List, Optional
from models import EtfSnapshot, MetricResult, EtfDecision

# ── Display labels ─────────────────────────────────────────────────────────────

METRIC_LABELS: Dict[str, str] = {
    "YIELD":           "TTM Yield",
    "PREMIUM":         "Premium/Discount to NAV",
    "NAV_DROP":        "30D Price Drawdown",
    "TREND":           "90D Price Trend",
    "MOMENTUM":        "20D Momentum",
    "AUM":             "AUM",
    "EXPENSE":         "Expense Ratio",
    "SMA_200":         "200-Day MA",
    "DRAWDOWN_6M":     "6M Max Drawdown",
    "VOLUME_TREND":    "Volume Trend",
    "DIST_CUT":        "Distribution Trend",
    "NAV_DECAY_ACCEL": "NAV Decay Acceleration",
    # Institutional (v2)
    "COVERAGE":        "Distribution Coverage Ratio",
    "RELATIVE_RETURN": "1Y Return vs Benchmark",
}

STATUS_ICON = {"GREEN": "✓", "YELLOW": "⚠", "RED": "✗"}

FUND_TYPE_LABEL = {
    "CEF":          "Closed-End Fund (CEF)",
    "OPTION_INCOME":"Option-Income ETF",
    "DIVIDEND":     "Dividend ETF",
    "GROWTH":       "Growth ETF",
}

# ── 4-tier structural status ───────────────────────────────────────────────────

STRUCTURAL_STATUS_ICON = {
    "ENGINE_HEALTHY":       "🟢",
    "VALUATION_STRETCHED":  "🟡",
    "INCOME_COMPRESSION":   "🟠",
    "STRUCTURAL_BREAKDOWN": "🔴",
}

STRUCTURAL_STATUS_LABEL = {
    "ENGINE_HEALTHY":       "Structural Engine Healthy",
    "VALUATION_STRETCHED":  "Valuation Stretched",
    "INCOME_COMPRESSION":   "Income / Volatility Risk",
    "STRUCTURAL_BREAKDOWN": "Structural Breakdown",
}


# ── Classify / summarize helpers ───────────────────────────────────────────────

def classify_metric(value: float, watch: float, alert: float, direction: str) -> str:
    """
    direction:
      'HIGH_GOOD' — higher is better (yield, trend, momentum)
      'LOW_GOOD'  — lower is better (premium, nav_drop)
    """
    if direction == "LOW_GOOD":
        if value >= alert: return "RED"
        if value >= watch: return "YELLOW"
        return "GREEN"
    else:  # HIGH_GOOD
        if value <= alert: return "RED"
        if value <= watch: return "YELLOW"
        return "GREEN"


def summarize_levels(levels: List[str]) -> str:
    if "RED" in levels:    return "RED"
    if "YELLOW" in levels: return "YELLOW"
    return "GREEN"


def format_value(name: str, value: float) -> str:
    if name == "AUM": return f"{value:,.0f}"
    return f"{value * 100:.2f}%"


# ── Section header ─────────────────────────────────────────────────────────────

def _section(title: str) -> str:
    dashes = "─" * max(0, 67 - len(title))
    return f"─ {title} {dashes}"


# ── Narrative helpers ──────────────────────────────────────────────────────────

def _rsi_label(rsi: float) -> str:
    if rsi >= 70: return f"{rsi:.0f} (overbought)"
    if rsi >= 60: return f"{rsi:.0f} (approaching overbought)"
    if rsi <= 30: return f"{rsi:.0f} (oversold)"
    if rsi <= 40: return f"{rsi:.0f} (approaching oversold)"
    return f"{rsi:.0f} (neutral)"


def _premium_lines(snapshot: EtfSnapshot, cfg: Dict) -> List[str]:
    """
    NAV premium/discount analysis.

    Rule: premium is an INVESTMENT SIGNAL only for CEFs.
    All open-ended ETFs (including option-income overlay ETFs like SPYI/QDVO)
    have creation/redemption arbitrage that keeps price ≈ NAV.  Any apparent
    premium above ±1% is stale/bad NAV data, not a structural divergence.

    For CEFs: full discount/premium zone analysis.
    For ETFs: data-quality sanity note only — no buy/sell signal generated.
    """
    fund_type = cfg.get("FUND_TYPE", "UNKNOWN")
    if snapshot.premium is None or "PREMIUM" not in cfg:
        return ["  No premium/NAV data available."]

    pm    = snapshot.premium * 100
    watch = cfg["PREMIUM"]["WATCH"] * 100
    alert = cfg["PREMIUM"]["ALERT"] * 100
    is_cef_type = fund_type == "CEF"

    lines: List[str] = []

    if is_cef_type:
        # CEF: price can structurally diverge 5–15% — premium/discount IS the signal
        lines.append(f"  {snapshot.symbol} is a closed-end fund — discount to NAV is the key valuation signal.")
        lines.append(f"  NAV: ${snapshot.nav:.2f}  →  Price: ${snapshot.price:.2f}  ({pm:+.2f}%)")
        lines.append("")
        lines.append("  Discount zones:")
        lines.append(f"    < {abs(watch):.0f}% discount    → acceptable")
        lines.append(f"    {abs(watch):.0f}–{abs(alert):.0f}% discount  → watch (discount widening)")
        lines.append(f"    > {abs(alert):.0f}% discount    → red flag (structural concern / loss of demand)")
        lines.append("")
        if pm > abs(watch) * -1:
            lines.append(f"  Currently at a discount within acceptable range ({abs(pm):.2f}%).")
        elif pm > alert:
            lines.append(f"  Discount has widened to {abs(pm):.2f}% — in the watch zone.")
        else:
            lines.append(f"  Discount of {abs(pm):.2f}% exceeds the {abs(alert):.0f}% red-flag level.")
        lines.append("")
        lines.append("  For CEFs, a persistent or deepening discount signals loss of investor demand")
        lines.append("  and is a major sell trigger independent of price action.")
    else:
        # Open-ended ETF (OPTION_INCOME, GROWTH, DIVIDEND):
        # Creation/redemption keeps price ≈ NAV — premium is NOT a signal.
        # Show as a data-quality note only.
        nav_str = f"${snapshot.nav:.2f}" if snapshot.nav else "prev close"
        lines.append(f"  NAV proxy: {nav_str}  →  Price: ${snapshot.price:.2f}  ({pm:+.2f}%)")
        lines.append("")
        if fund_type == "OPTION_INCOME":
            lines.append("  This is an open-ended option-income ETF.  Creation/redemption keeps")
            lines.append("  price within pennies of NAV — premium/discount is not an investment signal.")
            lines.append("  The NAV here is a reference point for yield/coverage analysis, not for")
            lines.append("  timing entries or exits.")
        else:
            lines.append("  This is an open-ended ETF.  Creation/redemption arbitrage keeps price")
            lines.append("  within ±0.1% of NAV intraday — premium/discount is not a signal.")
        lines.append("")
        if abs(pm) > 1.0:
            lines.append(f"  ⚠ Computed spread of {pm:+.2f}% exceeds ±1% — NAV source is likely stale.")
            lines.append("  This is a data-quality flag, not a valuation concern.")
        else:
            lines.append(f"  Spread is {pm:+.2f}% — within normal arbitrage range (data looks fresh).")

    return lines


def _price_action_lines(snapshot: EtfSnapshot) -> List[str]:
    lines: List[str] = []

    smas = [(snapshot.sma_200, "200-day"), (snapshot.sma_50, "50-day"), (snapshot.sma_20, "20-day")]
    available = [(v, lbl) for v, lbl in smas if v is not None]
    if available:
        lines.append("  Moving averages:")
        for val, lbl in available:
            icon = "✓" if snapshot.price > val else "⚠"
            rel  = "above" if snapshot.price > val else "below"
            lines.append(f"    {icon} {rel} {lbl} (${val:.2f})")

        if all(v is not None for v, _ in smas):
            a20, a50, a200 = (snapshot.price > snapshot.sma_20,
                              snapshot.price > snapshot.sma_50,
                              snapshot.price > snapshot.sma_200)
            if a20 and a50 and a200:
                lines.append("  → Bullish across all timeframes — trend is intact.")
            elif a200 and a50 and not a20:
                lines.append("  → Short-term pullback inside an otherwise healthy uptrend.")
            elif a200 and not a50 and not a20:
                lines.append("  → Medium-term correction — 200-day trend still intact but weakening.")
            elif not a200:
                lines.append("  → Below the 200-day MA — sustained downtrend in progress.")

    if snapshot.rsi_14 is not None:
        lines.append(f"  RSI(14): {_rsi_label(snapshot.rsi_14)}")

    if snapshot.macd_bullish is not None:
        macd_txt = "bullish (MACD line above signal)" if snapshot.macd_bullish else "bearish (MACD line below signal)"
        lines.append(f"  MACD: {macd_txt}")

    if snapshot.trend_90d is not None:
        t = snapshot.trend_90d * 100
        if   t >  5: context = "positive momentum"
        elif t >  0: context = "mildly positive"
        elif t > -5: context = "mildly negative"
        elif t > -10: context = "under pressure"
        else:         context = "significant decline"
        lines.append(f"  90D trend: {t:+.1f}% — {context}")

    if snapshot.momentum_20d is not None:
        m = snapshot.momentum_20d * 100
        if   m >  2: context = "accelerating"
        elif m > -1: context = "stable"
        elif m > -3: context = "softening"
        else:        context = "declining"
        lines.append(f"  20D momentum: {m:+.1f}% — {context}")

    if snapshot.volume_trend:
        if "Surging" in snapshot.volume_trend:
            lines.append("  Volume: Surging — suggests institutional accumulation.")
        elif "Decreasing" in snapshot.volume_trend:
            lines.append("  Volume: Fading — declining conviction behind the price move.")
        else:
            lines.append("  Volume: Stable — in line with the 90-day average.")

    return lines


def _income_lines(snapshot: EtfSnapshot, cfg: Dict) -> List[str]:
    dist_freq = cfg.get("DISTRIBUTION_FREQUENCY", "UNKNOWN")
    freq_mult = {"MONTHLY": 12, "QUARTERLY": 4, "ANNUAL": 1}.get(dist_freq, 12)
    fund_type = cfg.get("FUND_TYPE", "UNKNOWN")

    lines: List[str] = []
    lines.append(f"  Frequency: {dist_freq}  |  Fund type: {FUND_TYPE_LABEL.get(fund_type, fund_type)}")
    lines.append(f"  TTM Yield: {snapshot.ttm_yield * 100:.2f}%")

    if snapshot.last_distribution is not None:
        lines.append(f"  Last distribution: ${snapshot.last_distribution:.4f}/share")
        run_rate = snapshot.last_distribution * freq_mult / snapshot.price * 100 if snapshot.price > 0 else 0
        lines.append(f"  Run-rate yield at current price: {run_rate:.2f}%")

    if snapshot.distribution_cut_pct is not None:
        chg = snapshot.distribution_cut_pct * 100
        if chg >= 0:
            lines.append(f"  Distribution vs prior 3 payments: {chg:+.1f}% (stable/growing)")
        else:
            lines.append(f"  Distribution vs prior 3 payments: {chg:.1f}% (down from recent average)")

    lines.append(f"  30D price drawdown from recent high: {snapshot.nav_drop_30d * 100:.2f}%")

    if "YIELD" in cfg:
        watch_y = cfg["YIELD"]["WATCH"] * 100
        alert_y = cfg["YIELD"]["ALERT"] * 100
        ttm_pct = snapshot.ttm_yield * 100
        if ttm_pct >= watch_y:
            lines.append(f"  Income engine is performing — yield is above your {watch_y:.1f}% watch floor.")
        elif ttm_pct >= alert_y:
            lines.append(f"  Yield has dipped toward your {watch_y:.1f}% watch floor — monitor for distribution cuts.")
        else:
            lines.append(f"  Yield is below your {alert_y:.1f}% alert floor — distribution may have been cut.")

    # NAV decay context (fund-type-aware)
    t = snapshot.trend_90d * 100 if snapshot.trend_90d is not None else None
    m = snapshot.momentum_20d * 100 if snapshot.momentum_20d is not None else None
    is_accelerating = (
        t is not None and t < 0 and
        m is not None and m < 0 and
        m < t * 0.5
    )

    lines.append("")
    lines.append("  NAV decay context:")
    if fund_type == "CEF":
        lines.append("  CEFs rely on NAV to sustain distributions — decay is a critical warning.")
        lines.append("  Sell signal: NAV trending down for 6–12 consecutive months.")
        if t is not None and t < -5:
            accel = " Decay is accelerating — rate of decline is worsening recently." if is_accelerating else ""
            lines.append(f"  ⚠ NAV proxy (90D price trend) is {t:+.1f}%.{accel}")
        elif t is not None and t >= 0:
            lines.append(f"  NAV trend is flat-to-positive ({t:+.1f}%) — no decay concern at this time.")
        else:
            lines.append(f"  Mild NAV softness ({t:+.1f}%) — watch for trend continuation beyond 2–3 months.")

    elif fund_type == "OPTION_INCOME":
        lines.append("  Moderate NAV erosion is structurally expected due to capped upside and call-writing drag.")
        lines.append("  Only act if decay is accelerating beyond the strategy's normal pace.")
        if is_accelerating:
            lines.append(f"  ⚠ Acceleration detected: 20D momentum ({m:+.1f}%) is worse than 90D trend ({t:+.1f}%).")
            lines.append("    Check option premium environment — low volatility shrinks income and slows NAV recovery.")
        else:
            lines.append(f"  Decay rate is not accelerating (90D: {t:+.1f}%, 20D: {m:+.1f}%) — within expected range.")

    elif fund_type == "DIVIDEND":
        lines.append("  NAV decay is not normal for dividend ETFs — underlying companies should grow.")
        lines.append("  Sustained NAV decline signals weakening dividends at the holdings level.")
        if t is not None and t < -5:
            lines.append(f"  ⚠ NAV proxy down {abs(t):.1f}% over 90 days — investigate dividend coverage at holdings level.")
            if is_accelerating:
                lines.append("    Acceleration detected — situation is worsening. Consider reducing position.")
        else:
            lines.append(f"  NAV proxy is stable ({t:+.1f}%) — no structural concern at this time.")

    elif fund_type == "GROWTH":
        lines.append("  NAV decay for growth ETFs is market-driven, not structural.")
        lines.append("  Price/NAV dips reflect market corrections — rotate only if the sector thesis breaks.")
        if t is not None and t < -10:
            lines.append(f"  Current 90D decline is {t:+.1f}%. Evaluate whether this is market noise")
            lines.append("  or a genuine shift in the underlying sector's fundamentals.")

    return lines


# ── Structural indicators section (v2) ────────────────────────────────────────

def _structural_indicators_lines(snapshot: EtfSnapshot, cfg: Dict) -> List[str]:
    """
    Covers the five institutional-grade checks that matter more than price noise:
      1. NAV vs price divergence (premium expansion detection)
      2. Distribution coverage ratio
      3. Total return vs benchmark
      4. Volatility regime / VIX (option-income funds)
      5. Beta / risk profile
    """
    fund_type = cfg.get("FUND_TYPE", "UNKNOWN")
    lines: List[str] = []

    # 1. NAV vs price divergence
    if fund_type in ("CEF", "OPTION_INCOME"):
        div = snapshot.price_nav_divergence_90d
        if div is not None:
            div_pct = div * 100
            if abs(div_pct) < 0.5:
                lines.append("  Price/NAV divergence (90D): negligible — no premium inflation detected.")
            elif div_pct > 0:
                lines.append(f"  Price/NAV divergence (90D): +{div_pct:.1f}% — price outpacing NAV.")
                lines.append("  Part of the 90D price move is premium expansion, not real NAV growth.")
                if div_pct >= 5.0:
                    lines.append("  ⚠ Divergence above 5% — this is a valuation-stretch signal, not income risk.")
            else:
                lines.append(f"  Price/NAV divergence (90D): {div_pct:.1f}% — NAV outpacing price (discount narrowing).")
        pm = snapshot.premium
        if pm is not None:
            pm_pct = pm * 100
            nav_trend = snapshot.nav_trend_90d * 100 if snapshot.nav_trend_90d is not None else None
            price_trend = snapshot.trend_90d * 100 if snapshot.trend_90d is not None else None
            if nav_trend is not None and price_trend is not None:
                lines.append(f"  90D NAV trend: {nav_trend:+.1f}%  |  90D price trend: {price_trend:+.1f}%  |  Current premium: {pm_pct:+.2f}%")

    # 2. Distribution coverage ratio
    if snapshot.coverage_ratio is not None:
        cr_pct = snapshot.coverage_ratio * 100
        if cr_pct >= 100:
            lines.append(f"  Distribution coverage: {cr_pct:.0f}% — fully covered. Income is self-sustaining.")
        elif cr_pct >= 85:
            lines.append(f"  Distribution coverage: {cr_pct:.0f}% — adequate, but below 100%. Monitor quarterly.")
        elif cr_pct >= 70:
            lines.append(f"  Distribution coverage: {cr_pct:.0f}% ⚠ — below 85%. Elevated sustainability risk.")
        else:
            lines.append(f"  Distribution coverage: {cr_pct:.0f}% ✗ — critically low. Distribution cut probable.")
    elif fund_type in ("CEF", "OPTION_INCOME", "DIVIDEND"):
        lines.append("  Distribution coverage: not available (update FALLBACK_DATA from fund's quarterly report).")

    # 3. Total return vs benchmark
    if snapshot.total_return_1y is not None:
        tr_pct = snapshot.total_return_1y * 100
        lines.append("")
        lines.append(f"  1Y total return (price + distributions): {tr_pct:+.1f}%")
        if snapshot.benchmark_return_1y is not None:
            br_pct  = snapshot.benchmark_return_1y * 100
            rel_pct = (snapshot.relative_return_1y or 0.0) * 100
            ahead   = rel_pct >= 0
            lines.append(f"  Benchmark ({cfg.get('BENCHMARK','?')}): {br_pct:+.1f}%  |  Relative: {rel_pct:+.1f}%  ({'ahead of' if ahead else 'behind'} benchmark)")
            if fund_type == "OPTION_INCOME" and rel_pct < -5:
                lines.append("  Note: Underperformance is structurally expected — call premiums replace capped upside.")
                lines.append("  Evaluate on income-adjusted total return, not raw alpha.")
            elif fund_type == "GROWTH" and rel_pct < -5:
                lines.append("  ⚠ Underperforming benchmark by > 5% — verify holdings-level thesis is intact.")
            elif fund_type == "CEF" and rel_pct < -8:
                lines.append("  ⚠ Lagging benchmark significantly — check if NAV is eroding faster than income compensates.")

    # 4. Volatility regime (option-income only)
    if fund_type == "OPTION_INCOME" and snapshot.vix_current is not None:
        lines.append("")
        vix_c = snapshot.vix_current
        vix_a = snapshot.vix_90d_avg or vix_c
        lines.append(f"  Volatility regime: VIX {vix_c:.1f}  |  90D avg {vix_a:.1f}")
        if vix_c < 14:
            lines.append("  ⚠ VIX in suppressed regime (<14). Option premiums are compressed — income at risk.")
        elif vix_c < 18:
            lines.append("  VIX in low-normal range (14–18). Premiums adequate but below historical average.")
        elif vix_c < 25:
            lines.append("  VIX in healthy range (18–25). Option premiums well-support distribution targets.")
        else:
            lines.append("  VIX elevated (>25). High premiums boost income, but market stress may weigh on NAV.")
        if vix_a > 0 and vix_c < vix_a * 0.85:
            lines.append("  Trend: VIX compressing below its 90D average — watch for sustained income compression.")

    # 5. Beta / risk profile
    if snapshot.beta is not None:
        b = snapshot.beta
        lines.append("")
        if b > 1.3:
            lines.append(f"  Beta vs SPY: {b:.2f}  — high. Drawdowns are amplified vs the broad market.")
            lines.append("  Normalised: a -12% move on a beta-1.5 fund equals only -8% on a beta-1.0 fund.")
        elif b < 0.6:
            lines.append(f"  Beta vs SPY: {b:.2f}  — defensive. Lower drawdowns and lower correlation to market.")
        else:
            lines.append(f"  Beta vs SPY: {b:.2f}  — moderate market sensitivity.")

    return lines


# ── 4-tier structural status computation ───────────────────────────────────────

def _compute_structural_status(
    snapshot: EtfSnapshot,
    cfg: Dict,
    metrics: Dict,
) -> str:
    """
    Returns one of:
      ENGINE_HEALTHY       — 🟢 all structural pillars intact
      VALUATION_STRETCHED  — 🟡 premium inflation or significant benchmark underperformance
      INCOME_COMPRESSION   — 🟠 income/volatility risk (VIX suppressed, coverage low, high-beta drawdown)
      STRUCTURAL_BREAKDOWN — 🔴 engine-level failure (coverage collapse + NAV decay + dist cut)
    """
    fund_type = cfg.get("FUND_TYPE", "UNKNOWN")
    reds = [k for k, v in metrics.items() if v.level == "RED"]

    # ── STRUCTURAL_BREAKDOWN ──────────────────────────────────────────────────
    # Engine-level failure: NAV decay accelerating AND distribution cut simultaneously
    if "NAV_DECAY_ACCEL" in reds and "DIST_CUT" in reds:
        return "STRUCTURAL_BREAKDOWN"
    # Coverage ratio collapse
    if snapshot.coverage_ratio is not None and snapshot.coverage_ratio < 0.65:
        return "STRUCTURAL_BREAKDOWN"

    # ── INCOME_COMPRESSION ───────────────────────────────────────────────────
    if fund_type == "OPTION_INCOME":
        # VIX regime sustained suppression → premiums dried up
        if (snapshot.vix_current is not None and snapshot.vix_90d_avg is not None
                and snapshot.vix_current < 14 and snapshot.vix_90d_avg < 16):
            return "INCOME_COMPRESSION"
        # Yield dropping toward alert floor
        alert_y = cfg.get("YIELD", {}).get("ALERT", 0)
        if snapshot.ttm_yield < alert_y * 1.1:
            return "INCOME_COMPRESSION"

    if fund_type == "GROWTH":
        # High-beta fund in sustained drawdown → amplified volatility risk
        if (snapshot.beta is not None and snapshot.beta > 1.3
                and snapshot.max_drawdown_6m is not None and snapshot.max_drawdown_6m < -0.15):
            return "INCOME_COMPRESSION"
        # Price meaningfully below 200D SMA → sustained downtrend territory
        if (snapshot.sma_200 is not None
                and snapshot.price < snapshot.sma_200 * 0.93):
            return "INCOME_COMPRESSION"

    if fund_type in ("CEF", "DIVIDEND"):
        if snapshot.coverage_ratio is not None and snapshot.coverage_ratio < 0.80:
            return "INCOME_COMPRESSION"

    # ── VALUATION_STRETCHED ──────────────────────────────────────────────────
    if fund_type == "CEF":
        # Positive premium on a CEF is unusual — watch if above your WATCH level
        pm = snapshot.premium
        if pm is not None and pm > 0:
            watch_pm = cfg.get("PREMIUM", {}).get("WATCH", 0.05)
            if pm >= watch_pm:
                return "VALUATION_STRETCHED"

    if fund_type == "OPTION_INCOME":
        pm = snapshot.premium
        if pm is not None:
            alert_pm = cfg.get("PREMIUM", {}).get("ALERT", 0.03)
            if pm >= alert_pm:
                return "VALUATION_STRETCHED"

    # Price materially outpacing NAV over 90D (premium expansion)
    if (snapshot.price_nav_divergence_90d is not None
            and snapshot.price_nav_divergence_90d > 0.05):
        return "VALUATION_STRETCHED"

    # Significant relative underperformance vs benchmark (capital leakage risk)
    if (snapshot.relative_return_1y is not None
            and fund_type in ("CEF", "OPTION_INCOME")
            and snapshot.relative_return_1y < -0.15):
        return "VALUATION_STRETCHED"

    return "ENGINE_HEALTHY"


# ── Synthesis section ──────────────────────────────────────────────────────────

def _synthesis_lines(
    snapshot: EtfSnapshot, cfg: Dict,
    metrics: Dict, overall: str,
    reds: List[str], yellows: List[str],
    structural_status: str,
) -> List[str]:
    lines: List[str] = []
    fund_type = cfg.get("FUND_TYPE", "UNKNOWN")
    pm = snapshot.premium * 100 if snapshot.premium is not None else None
    watch_pm = cfg.get("PREMIUM", {}).get("WATCH", 0.01) * 100

    # Structural status banner
    icon  = STRUCTURAL_STATUS_ICON[structural_status]
    label = STRUCTURAL_STATUS_LABEL[structural_status]
    lines.append(f"  {icon}  {label}")
    lines.append("")

    # Action recommendation driven by structural status
    if structural_status == "ENGINE_HEALTHY":
        if pm is not None and pm < 0:
            lines.append(f"  At a {abs(pm):.2f}% discount — favorable entry. Recommendation: HOLD / ADD freely.")
        elif pm is not None and pm < watch_pm:
            lines.append(f"  No premium distortion. Recommendation: HOLD / ADD within allocation plan.")
        else:
            lines.append("  Recommendation: HOLD — engine intact, no structural concerns.")

    elif structural_status == "VALUATION_STRETCHED":
        lines.append("  Price or premium has expanded beyond fair-value zone.")
        lines.append("  Recommendation: HOLD current position — do NOT add at these levels.")
        if reds:
            for r in reds:
                lines.append(f"    ✗ {metrics[r].message}")
        if yellows:
            for y in yellows:
                lines.append(f"    ⚠ {metrics[y].message}")

    elif structural_status == "INCOME_COMPRESSION":
        lines.append("  Income or volatility risk elevated — monitor closely.")
        lines.append("  Recommendation: HOLD, reduce on strength if risk increases.")
        for r in reds:
            lines.append(f"    ✗ {metrics[r].message}")
        for y in yellows:
            lines.append(f"    ⚠ {metrics[y].message}")

    else:  # STRUCTURAL_BREAKDOWN
        lines.append("  Engine-level failure detected. Primary concerns:")
        for r in reds:
            lines.append(f"    ✗ {metrics[r].message}")
        if yellows:
            lines.append("  Secondary issues:")
            for y in yellows:
                lines.append(f"    ⚠ {metrics[y].message}")
        lines.append("  Recommendation: TRIM or ROTATE to a better-valued alternative.")

    # Structural sell triggers (fund-type-specific reminder)
    lines.append("")
    lines.append(f"  Structural engine ({FUND_TYPE_LABEL.get(fund_type, fund_type)}):")
    lines.append("  A fund is a sell only when its structural engine breaks — not on price dips.")
    lines.append("")

    if fund_type == "CEF":
        lines.append("  Sell triggers:")
        lines.append("    • NAV trends down for 6–12 consecutive months                  → Critical")
        lines.append("    • Distribution coverage collapses below 70% for multiple quarters → Critical")
        lines.append("    • Discount deepens persistently (loss of investor demand)        → Critical")
        lines.append("    • Distribution cut of 25%+ (earnings collapse / leverage stress) → Sell")

    elif fund_type == "OPTION_INCOME":
        lines.append("  Sell triggers:")
        lines.append("    • NAV decay accelerates beyond normal call-writing drag          → Watch → Rotate")
        lines.append("    • Distribution cut >35% sustained 6–12 months (premiums gone)   → Evaluate + Rotate")
        lines.append("    • VIX structurally suppressed below 14 for 6+ months            → Rotate")
        lines.append("  Note: moderate NAV erosion is expected; only act on acceleration.")

    elif fund_type == "DIVIDEND":
        lines.append("  Sell triggers:")
        lines.append("    • Underlying companies cut dividends 25%+ across holdings       → Sell")
        lines.append("    • Sector fundamentals weaken materially (not just price dip)    → Important")
        lines.append("    • NAV decays without recovery — underlying companies weakening  → Sell")

    elif fund_type == "GROWTH":
        lines.append("  Sell triggers:")
        lines.append("    • Sector thesis breaks (structural shift, not market correction) → Rotate")
        lines.append("    • Fundamental change in competitive dynamics of the sector      → Rotate")
        lines.append("  Note: price/NAV decline is market-driven. Do not rotate on corrections.")

    return lines


# ── Plain-English summary ──────────────────────────────────────────────────────

def _plain_english_summary(
    snapshot: EtfSnapshot,
    cfg: Dict,
    metrics: Dict,
    structural_status: str,
) -> str:
    """
    1–2 sentence plain-English digest any investor can read at a glance.
    Pattern: "[SYMBOL] is [status], [key highlight], trading at [price/NAV context]
              — [action] [despite/due to concern]."
    """
    fund_type = cfg.get("FUND_TYPE", "UNKNOWN")
    reds = [k for k, v in metrics.items() if v.level == "RED"]

    # ── Structural status phrase ──────────────────────────────────────────────
    status_phrase = {
        "ENGINE_HEALTHY":       "structurally healthy",
        "VALUATION_STRETCHED":  "overvalued at current price",
        "INCOME_COMPRESSION":   "showing income/volatility stress",
        "STRUCTURAL_BREAKDOWN": "showing structural breakdown",
    }.get(structural_status, "under review")

    # ── Key highlight (best positive signal) ─────────────────────────────────
    highlight = ""
    if snapshot.coverage_ratio is not None and snapshot.coverage_ratio >= 1.0:
        highlight = f"fully covered ({snapshot.coverage_ratio * 100:.0f}%)"
    elif (snapshot.relative_return_1y is not None and snapshot.relative_return_1y >= 0.05):
        benchmark = cfg.get("BENCHMARK", "SPY")
        highlight = f"outperforming {benchmark} by {snapshot.relative_return_1y * 100:+.1f}% (1Y)"
    elif snapshot.ttm_yield is not None:
        highlight = f"yielding {snapshot.ttm_yield * 100:.1f}%"

    # ── Price vs NAV context ──────────────────────────────────────────────────
    nav_context = ""
    if snapshot.premium is not None:
        pm = snapshot.premium * 100
        if pm < -10:
            nav_context = f"trading at an unusually wide {pm:.1f}% discount"
        elif pm < -3:
            nav_context = f"at a {pm:.1f}% discount to NAV"
        elif pm > 5:
            nav_context = f"at a stretched {pm:.1f}% premium to NAV"
        elif pm > 2:
            nav_context = f"at a {pm:.1f}% premium to NAV"
        else:
            nav_context = "near fair value"

    # ── Concern / caveat ─────────────────────────────────────────────────────
    concern = ""
    concern_map = {
        "DIST_CUT":        "distribution has been cut",
        "COVERAGE":        "coverage is critically low",
        "NAV_DECAY_ACCEL": "NAV decay accelerating",
        "MOMENTUM":        "short-term momentum weakness",
    }
    for key in ("DIST_CUT", "COVERAGE", "NAV_DECAY_ACCEL", "MOMENTUM"):
        if key in reds:
            concern = concern_map[key]
            break

    # PREMIUM concern is fund-type-aware — ETFs and CEFs behave differently:
    #
    # • CEF at a discount  → "discount widening — potential loss of investor demand"
    #   (CEF price CAN diverge from NAV; a deepening discount is a real sell signal)
    # • CEF at a premium   → "premium elevated — demand strong but valuation stretched"
    #   (unusual for CEFs; stretched premium = risk of mean-reversion)
    # • Open-ended ETF     → premium/discount is NOT an investment signal.
    #   Creation/redemption arbitrage keeps price within ±0.1% of NAV intraday.
    #   Any apparent spread > ±1% is stale NAV data, not a structural divergence.
    #   Applying CEF-style demand language to ETFs is incorrect.
    if not concern and "PREMIUM" in reds:
        pm_val = snapshot.premium * 100 if snapshot.premium is not None else None
        if fund_type == "CEF":
            if pm_val is not None and pm_val < 0:
                concern = "discount widening — potential loss of investor demand"
            else:
                concern = "premium elevated — demand strong but valuation stretched"
        else:
            # Open-ended ETF: don't generate a demand signal — show data note only
            concern = "premium/discount not meaningful for open-ended ETFs (creation/redemption arbitrage)"

    if not concern and snapshot.sma_200 is not None and snapshot.price < snapshot.sma_200:
        concern = "short-term price weakness"

    # ── Action ───────────────────────────────────────────────────────────────
    action = {
        "ENGINE_HEALTHY":       "HOLD/ADD",
        "VALUATION_STRETCHED":  "HOLD — avoid adding",
        "INCOME_COMPRESSION":   "HOLD — monitor closely",
        "STRUCTURAL_BREAKDOWN": "TRIM/ROTATE",
    }.get(structural_status, "HOLD")

    # ── Assemble sentence ────────────────────────────────────────────────────
    parts = [f"{snapshot.symbol} is {status_phrase}"]
    if highlight:
        parts.append(highlight)
    if nav_context:
        parts.append(nav_context)

    sentence = ", ".join(parts) + f" — {action}"
    if concern:
        connector = "despite" if structural_status == "ENGINE_HEALTHY" else "due to"
        sentence += f" {connector} {concern}"
    sentence += "."

    return sentence


# ── Main evaluation ────────────────────────────────────────────────────────────

def evaluate_etf(snapshot: EtfSnapshot, cfg: Dict[str, Any], meta_rules: Dict[str, Any]) -> EtfDecision:
    metrics: Dict[str, MetricResult] = {}
    levels: List[str] = []
    fund_type = cfg.get("FUND_TYPE", "UNKNOWN")

    def add_metric(name: str, value: Optional[float], direction_override: Optional[str] = None) -> None:
        if value is None or name not in cfg:
            return
        thresholds = cfg[name]
        direction = direction_override or (meta_rules.get("DEFAULT", {}).get(name, {}).get("direction", "HIGH_GOOD"))
        level = classify_metric(value, thresholds["WATCH"], thresholds["ALERT"], direction)
        levels.append(level)
        label   = METRIC_LABELS.get(name, name)
        val_str = format_value(name, value)
        if level == "GREEN":
            msg = f"{label} is healthy at {val_str}."
        elif direction == "HIGH_GOOD":
            msg = f"{label} has dropped too low to {val_str}."
        else:
            msg = f"{label} has climbed too high to {val_str}."
        metrics[name] = MetricResult(level=level, message=msg)

    # ── Core metrics ───────────────────────────────────────────────────────────
    add_metric("YIELD",    snapshot.ttm_yield,   direction_override="HIGH_GOOD")
    if snapshot.premium is not None and "PREMIUM" in cfg:
        premium_direction = "HIGH_GOOD" if cfg["PREMIUM"]["ALERT"] < 0 else "LOW_GOOD"
        add_metric("PREMIUM", snapshot.premium, direction_override=premium_direction)
    add_metric("NAV_DROP",  snapshot.nav_drop_30d,  direction_override="LOW_GOOD")
    add_metric("TREND",     snapshot.trend_90d,     direction_override="HIGH_GOOD")
    add_metric("MOMENTUM",  snapshot.momentum_20d,  direction_override="HIGH_GOOD")

    # ── AUM guardrail ──────────────────────────────────────────────────────────
    if "AUM" in cfg and snapshot.aum is not None:
        a = cfg["AUM"]
        if snapshot.aum < a["RED_MIN"]:
            level, msg = "RED",    f"AUM is dangerously low at {snapshot.aum:,.0f}, indicating potential liquidation risk."
        elif snapshot.aum < a["YELLOW_MIN"]:
            level, msg = "YELLOW", f"AUM is shrinking to {snapshot.aum:,.0f}, needing close monitor."
        elif snapshot.aum < a["GREEN_MIN"]:
            level, msg = "YELLOW", f"AUM has plateaued/shrunk to {snapshot.aum:,.0f}."
        else:
            level, msg = "GREEN",  f"AUM is healthy at {snapshot.aum:,.0f}."
        levels.append(level)
        metrics["AUM"] = MetricResult(level=level, message=msg)

    # ── Expense ratio ──────────────────────────────────────────────────────────
    if "EXPENSE" in cfg and snapshot.expense_ratio is not None:
        e = cfg["EXPENSE"]
        if snapshot.expense_ratio > e["RED_MAX"]:
            level, msg = "RED",    f"Expense ratio is far too high at {snapshot.expense_ratio * 100:.2f}%, rotate out."
        elif snapshot.expense_ratio > e["YELLOW_MAX"]:
            level, msg = "YELLOW", f"Expense ratio is elevated at {snapshot.expense_ratio * 100:.2f}%, concerning."
        elif snapshot.expense_ratio > e["GREEN_MAX"]:
            level, msg = "YELLOW", f"Expense ratio is slightly high at {snapshot.expense_ratio * 100:.2f}%."
        else:
            level, msg = "GREEN",  f"Expense ratio is acceptable at {snapshot.expense_ratio * 100:.2f}%."
        levels.append(level)
        metrics["EXPENSE"] = MetricResult(level=level, message=msg)

    # ── 200-day MA ─────────────────────────────────────────────────────────────
    if snapshot.sma_200 is not None:
        if snapshot.price < snapshot.sma_200:
            level = "YELLOW"
            msg = f"Price ({snapshot.price:.2f}) is below its 200-day MA ({snapshot.sma_200:.2f}), indicating a sustained downtrend."
        else:
            level = "GREEN"
            msg = f"Price ({snapshot.price:.2f}) is above its 200-day MA ({snapshot.sma_200:.2f})."
        levels.append(level)
        metrics["SMA_200"] = MetricResult(level=level, message=msg)

    # ── 6M max drawdown ────────────────────────────────────────────────────────
    if snapshot.max_drawdown_6m is not None:
        dd = snapshot.max_drawdown_6m * 100
        # Normalise by beta: a high-beta fund's drawdown is expected to be larger.
        beta_adj = snapshot.beta if snapshot.beta is not None else 1.0
        dd_normalised = dd / beta_adj  # effective drawdown on a beta-1 equivalent
        if dd_normalised <= -15:
            level = "RED"
            msg = f"6M max drawdown {dd:.2f}% (beta-normalised: {dd_normalised:.1f}%) — severe capital risk."
        elif dd_normalised <= -8:
            level = "YELLOW"
            msg = f"6M max drawdown {dd:.2f}% (beta-normalised: {dd_normalised:.1f}%) — notable volatility."
        else:
            level = "GREEN"
            msg = f"6M max drawdown {dd:.2f}% — contained (beta-normalised: {dd_normalised:.1f}%)."
        levels.append(level)
        metrics["DRAWDOWN_6M"] = MetricResult(level=level, message=msg)

    # ── Volume trend ───────────────────────────────────────────────────────────
    if snapshot.volume_trend:
        if "Decreasing" in snapshot.volume_trend:
            level = "YELLOW"
            msg = "Volume Trend: fading institutional conviction (10-day volume below 90-day baseline)."
        elif "Surging" in snapshot.volume_trend:
            level = "GREEN"
            msg = "Volume Trend: strong accumulation (10-day volume surging over 90-day baseline)."
        else:
            level = "GREEN"
            msg = "Volume Trend: stable — trading normally."
        levels.append(level)
        metrics["VOLUME_TREND"] = MetricResult(level=level, message=msg)

    # ── Distribution cut guardrail (income funds) ──────────────────────────────
    if fund_type != "GROWTH" and snapshot.distribution_cut_pct is not None:
        cut = snapshot.distribution_cut_pct
        if fund_type == "OPTION_INCOME":
            watch_cut, alert_cut = -0.15, -0.35
            alert_context = "Option premiums may have collapsed or volatility regime shifted — evaluate NAV trend."
        else:
            watch_cut, alert_cut = -0.10, -0.25
            if fund_type == "CEF":
                alert_context = "CEF earnings collapse or leverage stress — treat as a sell signal."
            else:
                alert_context = "Underlying companies have cut dividends — sector stress. Review holdings."

        if cut <= alert_cut:
            level = "RED"
            msg = f"Distribution cut of {abs(cut)*100:.0f}% detected vs prior average. {alert_context}"
        elif cut <= watch_cut:
            level = "YELLOW"
            msg = f"Distribution is down {abs(cut)*100:.0f}% vs prior average — monitor for further cuts."
        elif cut < 0:
            level = "GREEN"
            msg = f"Distribution is down {abs(cut)*100:.0f}% vs prior average — within normal variation."
        else:
            level = "GREEN"
            msg = f"Distribution is stable or growing ({cut*100:+.0f}% vs prior average)."
        levels.append(level)
        metrics["DIST_CUT"] = MetricResult(level=level, message=msg)

    # ── NAV decay acceleration (CEF and DIVIDEND) ──────────────────────────────
    if fund_type in ("CEF", "DIVIDEND"):
        t = snapshot.trend_90d
        m = snapshot.momentum_20d
        relative_return = snapshot.relative_return_1y
        
        # Multi-layer NAV decay detection system
        # Layer 1: Basic acceleration check
        # Layer 2: Market context filter (MCF)
        # Layer 3: Fund-specific benchmark comparison
        # Layer 4: Statistical trendline break
        
        if t is not None and m is not None and t < -0.03 and m < 0:
            if m < t * 0.5:
                # Start with assumption: not a concern
                alert_level = "GREEN"
                alert_reasons = []
                
                # Quick check: if fund is crushing benchmark over 1Y, short-term wobbles don't matter
                if relative_return is not None and relative_return > 0.10:
                    alert_level = "GREEN"
                    msg = f"Short-term NAV volatility (20D {m*100:+.1f}%, 90D {t*100:+.1f}%) but fund outperforming benchmark by {relative_return*100:+.1f}% (1Y) — healthy long-term performance."
                    metrics["NAV_DECAY_ACCEL"] = MetricResult(level=alert_level, message=msg)
                else:
                    # Run multi-layer checks
                    
                    # Layer 2: Market Context Filter (MCF)
                    mcf_concern = False
                    if snapshot.accel_vs_market is not None:
                        if snapshot.accel_vs_market < -0.015:  # Fund decaying >1.5% worse than market
                            mcf_concern = True
                            alert_reasons.append(f"decaying {abs(snapshot.accel_vs_market)*100:.1f}% faster than market")
                    
                    # Layer 3: Fund-specific benchmark comparison
                    benchmark_concern = False
                    if snapshot.fund_vs_benchmark_20d is not None:
                        if snapshot.fund_vs_benchmark_20d < -0.02:  # Underperforming benchmark by >2% (20D)
                            benchmark_concern = True
                            alert_reasons.append(f"underperforming benchmark by {abs(snapshot.fund_vs_benchmark_20d)*100:.1f}% (20D)")
                    
                    # Layer 4: Statistical trendline break
                    trendline_concern = False
                    if snapshot.trendline_break_sigma is not None:
                        if snapshot.trendline_break_sigma < -2.0:  # 20D slope < 200D slope by 2 std devs
                            trendline_concern = True
                            alert_reasons.append(f"breaking 200D trendline ({snapshot.trendline_break_sigma:.1f}σ)")
                    
                    # Determine alert level based on confirmed layers
                    confirmed_layers = sum([mcf_concern, benchmark_concern, trendline_concern])
                    
                    if confirmed_layers >= 2:
                        # Two or more layers confirm structural weakness
                        alert_level = "RED"
                        msg = (f"NAV decay accelerating: 20D ({m*100:+.1f}%) vs 90D ({t*100:+.1f}%). "
                               f"STRUCTURAL CONCERN — {', '.join(alert_reasons)}. {fund_type} distributions at risk.")
                    elif confirmed_layers == 1:
                        # One layer confirms concern
                        alert_level = "YELLOW"
                        msg = (f"NAV decay accelerating: 20D ({m*100:+.1f}%) vs 90D ({t*100:+.1f}%). "
                               f"Monitoring: {', '.join(alert_reasons)}.")
                    else:
                        # No layers confirm — likely market-wide movement
                        alert_level = "GREEN"
                        if snapshot.market_accel_20d_vs_90d is not None:
                            msg = f"NAV volatility (20D {m*100:+.1f}%, 90D {t*100:+.1f}%) tracking broader market (SPY accel: {snapshot.market_accel_20d_vs_90d*100:+.1f}%) — normal market behavior."
                        else:
                            msg = f"NAV volatility (20D {m*100:+.1f}%, 90D {t*100:+.1f}%) — no confirmed structural concerns."
                    
                    if alert_level in ("YELLOW", "RED"):
                        levels.append(alert_level)
                    metrics["NAV_DECAY_ACCEL"] = MetricResult(level=alert_level, message=msg)

    # ── Distribution coverage ratio (v2) ──────────────────────────────────────
    if fund_type in ("CEF", "OPTION_INCOME", "DIVIDEND") and snapshot.coverage_ratio is not None:
        cr = snapshot.coverage_ratio
        watch_cr = cfg.get("COVERAGE", {}).get("WATCH", 0.85)
        alert_cr = cfg.get("COVERAGE", {}).get("ALERT", 0.75)
        if cr < alert_cr:
            level = "RED"
            msg = f"Distribution coverage {cr*100:.0f}% critically low — cut very likely without NAV recovery."
        elif cr < watch_cr:
            level = "YELLOW"
            msg = f"Distribution coverage {cr*100:.0f}% below {watch_cr*100:.0f}% — monitor sustainability."
        elif cr < 1.0:
            level = "YELLOW"
            msg = f"Distribution coverage {cr*100:.0f}% — partially covered; some distributions supplemented by capital gains."
        else:
            level = "GREEN"
            msg = f"Distribution coverage {cr*100:.0f}% — income engine self-sustaining."
        levels.append(level)
        metrics["COVERAGE"] = MetricResult(level=level, message=msg)

    # ── Relative return vs benchmark (v2) ─────────────────────────────────────
    if snapshot.relative_return_1y is not None:
        rel = snapshot.relative_return_1y
        if fund_type == "OPTION_INCOME":
            watch_rel, alert_rel = -0.08, -0.15  # wider tolerance: income offsets capped upside
        elif fund_type == "GROWTH":
            watch_rel, alert_rel = -0.05, -0.10
        else:
            watch_rel, alert_rel = -0.06, -0.12
        if rel < alert_rel:
            level = "RED"
            msg = f"1Y return trails benchmark by {abs(rel)*100:.1f}% — possible structural capital leakage."
        elif rel < watch_rel:
            level = "YELLOW"
            msg = f"1Y return trails benchmark by {abs(rel)*100:.1f}% — monitor for persistent drag."
        else:
            level = "GREEN"
            msg = f"1Y return is within range of benchmark ({rel*100:+.1f}%)."
        levels.append(level)
        metrics["RELATIVE_RETURN"] = MetricResult(level=level, message=msg)

    # ── Split guard: freeze SELL/panic signals when a recent split is detected ─
    split_note = ""
    if snapshot.split_mode:
        split_label = snapshot.split_type or "DETECTED"
        split_note  = (
            f"⚠ SPLIT {split_label} (ratio ≈{snapshot.split_ratio:.2f}x) — "
            f"historical metrics are being rebased. All SELL signals suppressed "
            f"until price history is fully adjusted. Monitor for 3–5 trading days."
        )
        # Downgrade any RED metrics that relate to price action / momentum to YELLOW
        price_metrics = {"TREND", "MOMENTUM", "NAV_DROP", "RELATIVE_RETURN"}
        for key in list(metrics.keys()):
            if key in price_metrics and metrics[key].level == "RED":
                metrics[key] = MetricResult(
                    level="YELLOW",
                    message=f"[SPLIT HOLD] {metrics[key].message}",
                )
        # Force levels list to exclude RED from price metrics so roll-up isn't RED
        levels = [
            (lvl if lvl != "RED" else "YELLOW")
            if idx < len(levels) else lvl
            for idx, lvl in enumerate(levels)
        ]

    # ── Final roll-up ──────────────────────────────────────────────────────────
    overall  = summarize_levels(levels)
    reds_    = [k for k, v in metrics.items() if v.level == "RED"]
    yellows_ = [k for k, v in metrics.items() if v.level == "YELLOW"]

    structural_status = _compute_structural_status(snapshot, cfg, metrics)
    # Split guard: ENGINE_HEALTHY or VALUATION_STRETCHED only — never STRUCTURAL_BREAKDOWN during split
    if snapshot.split_mode and structural_status == "STRUCTURAL_BREAKDOWN":
        structural_status = "INCOME_COMPRESSION"  # downgrade panic to monitor

    # ── Build explanation ──────────────────────────────────────────────────────
    lines: List[str] = []

    nav_str = f"  |  NAV: ${snapshot.nav:.2f}" if snapshot.nav else ""
    ft_str  = FUND_TYPE_LABEL.get(fund_type, fund_type)
    dist_freq = cfg.get("DISTRIBUTION_FREQUENCY", "UNKNOWN")
    lines.append(f"Price: ${snapshot.price:.2f}{nav_str}  |  {ft_str}  |  {dist_freq}")
    if snapshot.premium is not None:
        pm_pct  = snapshot.premium * 100
        pm_lbl  = "Discount" if pm_pct < 0 else "Premium"
        aum_str = f"  |  AUM: ${snapshot.aum/1e9:.2f}B" if snapshot.aum else ""
        lines.append(f"{pm_lbl} to NAV: {pm_pct:+.2f}%  |  TTM Yield: {snapshot.ttm_yield*100:.2f}%{aum_str}")
    else:
        aum_str = f"  |  AUM: ${snapshot.aum/1e9:.2f}B" if snapshot.aum else ""
        lines.append(f"TTM Yield: {snapshot.ttm_yield*100:.2f}%{aum_str}")

    lines.append("")
    lines.append(_section("VALUATION STATE"))
    lines.extend(_premium_lines(snapshot, cfg))

    lines.append("")
    lines.append(_section("PRICE ACTION"))
    lines.extend(_price_action_lines(snapshot))

    lines.append("")
    lines.append(_section("INCOME ENGINE & NAV HEALTH"))
    lines.extend(_income_lines(snapshot, cfg))

    lines.append("")
    lines.append(_section("STRUCTURAL INDICATORS"))
    lines.extend(_structural_indicators_lines(snapshot, cfg))

    lines.append("")
    lines.append(_section("METRIC CHECKLIST"))
    for key, m in metrics.items():
        icon = STATUS_ICON.get(m.level, "?")
        lines.append(f"  {icon} {m.message}")

    if snapshot.split_mode:
        lines.insert(0, split_note)
        lines.insert(1, "")

    lines.append("")
    lines.append(_section("SYNTHESIS"))
    lines.extend(_synthesis_lines(snapshot, cfg, metrics, overall, reds_, yellows_, structural_status))

    explanation = "\n".join(lines)
    summary = _plain_english_summary(snapshot, cfg, metrics, structural_status)
    if snapshot.split_mode:
        summary = f"[SPLIT {snapshot.split_type}] {summary}"

    return EtfDecision(
        symbol=snapshot.symbol,
        overall=overall,
        structural_status=structural_status,
        metrics=metrics,
        explanation=explanation,
        summary=summary,
    )
