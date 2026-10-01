from dataclasses import dataclass
from typing import Dict, Optional

@dataclass
class EtfSnapshot:
    symbol: str
    price: float
    nav: Optional[float]
    ttm_yield: float
    nav_drop_30d: float
    trend_90d: float
    momentum_20d: float
    vol_30d_annual: float
    days_to_ex: Optional[int]
    aum: Optional[float]
    expense_ratio: Optional[float]

    # Technical indicators
    sma_20: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    max_drawdown_6m: Optional[float] = None
    volume_trend: Optional[str] = None

    # Momentum indicators
    rsi_14: Optional[float] = None
    macd_bullish: Optional[bool] = None
    last_distribution: Optional[float] = None
    distribution_cut_pct: Optional[float] = None

    # Day change (vs previous close)
    price_change: Optional[float] = None      # $ change vs prev close
    price_change_pct: Optional[float] = None  # % change vs prev close

    # Intraday low (most recent session)
    day_low: Optional[float] = None

    # Fund name
    name: Optional[str] = None

    # Distribution payment months (set of month numbers 1–12 that historically paid)
    dividend_months: Optional[list] = None

    # ── Institutional-grade metrics (v2) ──────────────────────────────────────
    # NAV vs price divergence
    nav_trend_90d: Optional[float] = None            # 90D NAV return (ETF: ≈ price; CEF: estimated)
    price_nav_divergence_90d: Optional[float] = None  # price trend - NAV trend (positive = premium inflation)

    # Income sustainability
    coverage_ratio: Optional[float] = None           # NII or realised gains / annual distribution
                                                      # (CEF / option-income; requires quarterly report data)

    # Total return vs benchmark
    total_return_1y: Optional[float] = None          # 1Y total return including reinvested distributions
    benchmark_return_1y: Optional[float] = None      # configured benchmark's 1Y total return
    relative_return_1y: Optional[float] = None       # total_return_1y - benchmark_return_1y

    # Risk
    beta: Optional[float] = None                     # 1Y beta vs SPY (Schwab or yfinance)
    vol_3m_avg: Optional[float] = None                # 3-month average volume (Schwab)
    return_on_equity: Optional[float] = None           # ROE % (Schwab FundamentalInst)
    return_on_assets: Optional[float] = None           # ROA % (Schwab FundamentalInst)
    net_profit_margin: Optional[float] = None          # Net profit margin % TTM (Schwab)
    operating_margin: Optional[float] = None           # Operating margin % TTM (Schwab)
    total_debt_to_cap: Optional[float] = None          # Total debt / capital % (Schwab)
    lt_debt_to_equity: Optional[float] = None         # LT debt / equity % (Schwab)
    pb_ratio: Optional[float] = None                   # Price/book ratio (Schwab)
    pcf_ratio: Optional[float] = None                 # Price/cash flow ratio (Schwab)
    peg_ratio: Optional[float] = None                  # PEG ratio (Schwab)
    short_float_pct: Optional[float] = None           # Short interest as % of float (Schwab)
    market_cap: Optional[float] = None                 # Market cap (Schwab FundamentalInst)
    div_yield: Optional[float] = None                  # Annual dividend yield % (Schwab)
    div_amount: Optional[float] = None                # Annual dividend amount $/share (Schwab)

    # Split detection
    split_mode: Optional[bool] = None        # True = recent split detected; freeze SELL signals
    split_ratio: Optional[float] = None      # e.g. 2.0 for a 2-for-1 split
    split_type: Optional[str] = None         # "CONFIRMED" | "POSSIBLE"

    # Volatility regime (market-wide; injected once per portfolio run)
    vix_current: Optional[float] = None
    vix_90d_avg: Optional[float] = None
    
    # ── Professional-grade alert metrics (multi-layer confirmation) ──────────
    # Market context filter
    market_accel_20d_vs_90d: Optional[float] = None  # SPY 20D momentum - SPY 90D trend
    fund_accel_20d_vs_90d: Optional[float] = None    # Fund 20D momentum - fund 90D trend
    accel_vs_market: Optional[float] = None          # fund_accel - market_accel (negative = worse than market)
    
    # Trendline slope break (statistical)
    nav_slope_20d: Optional[float] = None            # Linear slope of 20D NAV
    nav_slope_200d: Optional[float] = None           # Linear slope of 200D NAV
    nav_slope_200d_std: Optional[float] = None       # Std dev of 200D NAV slope
    trendline_break_sigma: Optional[float] = None    # (20D slope - 200D slope) / std_dev
    
    # Fund-specific benchmark comparison
    fund_vs_benchmark_20d: Optional[float] = None    # Fund 20D momentum - Benchmark 20D momentum

    @property
    def premium(self) -> Optional[float]:
        if self.nav is None or self.nav == 0:
            return None
        return self.price / self.nav - 1.0


@dataclass
class MetricResult:
    level: str   # "GREEN" | "YELLOW" | "RED"
    message: str


@dataclass
class EtfDecision:
    symbol: str
    overall: str           # "GREEN" | "YELLOW" | "RED" — metric checklist roll-up
    structural_status: str # "ENGINE_HEALTHY" | "VALUATION_STRETCHED" |
                           # "INCOME_COMPRESSION" | "STRUCTURAL_BREAKDOWN"
    metrics: Dict[str, MetricResult]
    explanation: str
    summary: str = ""      # Plain-English narrative for non-technical readers
