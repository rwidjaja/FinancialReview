// ── Shared types, interfaces, and palette constants ───────────────────────────

export const G = 'var(--green)'
export const R = 'var(--red)'
export const A = 'var(--amber)'
export const M = 'var(--text2)'
export const Y = 'var(--yellow)'

export interface Props { data: import('../../types/dashboard').DashboardData; initialSymbol?: string }
export type ViewMode = 'simple' | 'advanced'
export type ChartPeriod = '1d' | '5d' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '3y' | '5y'

export const TYPE_COLORS: Record<string, string> = {
  STOCK: '#0984e3', ETF: '#6c5ce7', CEF: '#e17055', BOND_ETF: '#00b894',
  MMF: '#636e72', CRYPTO_ETP: '#fdcb6e', INDEX: '#b2bec3', BDC: '#6c5ce7',
  REIT: '#00b894', PREFERRED: '#e17055',
}

export interface HealthDecision {
  symbol: string
  structural_status: 'ENGINE_HEALTHY' | 'VALUATION_STRETCHED' | 'INCOME_COMPRESSION' | 'STRUCTURAL_BREAKDOWN'
  summary: string
  metrics: Record<string, { level: 'GREEN' | 'YELLOW' | 'RED'; message: string }>
  fund_type?: string
  error?: string
}

export interface ResearchApiData {
  symbol: string; error?: string
  health_decision?: HealthDecision
  profile?: {
    name?: string; exchange?: string; asset_type?: string; category?: string
    fund_company?: string; nav?: number; beta?: number; expense_ratio?: number | null
    is_etf?: boolean; inception_date?: string; total_assets?: number | null; holdings_count?: number
  }
  symbol_class?: {
    type?: string; display_label?: string; subtype_label?: string
    show_technicals?: boolean; show_fundamentals?: boolean; show_nav_analysis?: boolean
  }
  key_stats?: {
    pe_ratio?: number | null; market_cap?: number | null; price_to_book?: number | null
    eps_ttm?: number | null; eps_forward?: number | null; revenue_growth?: number | null
    earnings_growth?: number | null; profit_margin?: number | null
    return_on_equity?: number | null; debt_to_equity?: number | null
    analyst_target?: number | null; analyst_low?: number | null; analyst_high?: number | null
    recommendation?: string | null; num_analyst_opinions?: number | null
    free_cash_flow?: number | null
  }
  events?: { earnings_date?: string; ex_div_date?: string; div_date?: string }
  quote?: {
    last_price?: number; change?: number; change_pct?: number
    bid?: number; ask?: number; prev_close?: number; open?: number
    day_high?: number; day_low?: number; volume?: number
    '52w_high'?: number; '52w_low'?: number; nav?: number
    premium_discount?: number; realtime?: boolean
    currency?: string; native_price?: number | null; native_change?: number | null
  }
  technicals?: {
    rsi_14?: number; stochastic_k?: number; stochastic_d?: number
    macd_histogram?: number; macd_bullish?: boolean; obv_bullish?: boolean
    ma_10?: number; ma_20?: number; ma_50?: number; ma_200?: number
    bollinger_upper?: number; bollinger_mid?: number; bollinger_lower?: number
    avg_volume_10d?: number; avg_volume_90d?: number; hist_vol_10d?: number
  }
  trading_levels?: {
    active_tier?: string
    // ATR-scaled price stack — single source of truth for entry/exit prices
    buy_price?: number; strong_buy_price?: number; limit_price?: number
    entry_anchor?: number; entry_anchor_label?: 'high_20d' | 'ma50' | 'blend'
    take_profit?: number; stop_loss?: number; rr_ratio?: number
    verdict_reason?: string; price_vs_ma20_pct?: number; alert_price?: number
    vol_1h_rate?: number; intraday_move_pct?: number; high_21d?: number
    buy_triggered?: boolean; sell_triggered?: boolean; sizing_pct?: number; signal_score?: number
    // 3-Trigger system
    high_20d?: number; pullback_20d_pct?: number
    trigger_pullback?: number; trigger_breakout?: number; trigger_oversold?: number
    composite_signal?: number; composite_label?: string; active_triggers?: string[]
    avg_vol_20d?: number
  }
  performance_table?: { periods: string[]; rows: { label: string; values: (number | null)[] }[] }
  chart?: Record<string, { dates: string[]; prices: number[]; pct?: number } | null>
  spy_chart?: Record<string, { dates: string[]; prices: number[] } | null>
  risk_stats?: {
    beta?: number; alpha?: number; sharpe?: number; max_drawdown?: number
    upside_capture?: number | null; downside_capture?: number | null
    r_squared?: number; corr_spy?: number; period_years?: number; benchmark?: string
    corr_qqq?: number
  }
  annualized_returns?: { symbol?: Record<string, number | null>; spy?: Record<string, number | null> }
  analysis?: { trend?: string; momentum?: string; volume?: string; volatility?: string }
  pattern_engine?: {
    count: number
    patterns: Array<{
      type:    string   // 'up_channel'|'down_channel'|'bull_flag'|'bear_flag'
      // channel fields
      valid?:              boolean
      upper_line?:         { slope: number; intercept: number }
      lower_line?:         { slope: number; intercept: number }
      upper_price?:        number
      lower_price?:        number
      channel_width_pct?:  number
      touch_count_upper?:  number
      touch_count_lower?:  number
      r2_upper?:           number
      r2_lower?:           number
      // flag fields
      status?:             'forming' | 'confirmed' | 'failed' | 'expired'
      impulse_return_pct?: number
      flag_depth_pct?:     number
      flag_bars?:          number
      breakout_level?:     number
      flag_high?:          number
      flag_low?:           number
      // shared
      strength?: number
      error?:    string
    }>
  }
  mtf_alignment?: {
    alignment_score?: number
    alignment_label?: string
    trend_states?: Record<string, string>   // D1/H4/H1/M30/M15 → 'up'|'down'|'neutral'
    weights_used?: Record<string, number>
    available_tfs?: string[]
    divergence?: { major?: boolean; bullish?: boolean; bearish?: boolean; micro?: boolean }
    swing_gate?: 'ALLOWED' | 'CAUTION' | 'BLOCKED'
    error?: string
  }
  flow_engine?: {
    mfi_14?: number; mfi_signal?: string
    obv_slope_pct?: number; obv_rising?: boolean; obv_falling?: boolean
    ad_slope_pct?: number; ad_rising?: boolean; ad_falling?: boolean
    bearish_div?: boolean; bullish_div?: boolean; divergence?: string
    flow_score?: number; flow_label?: string; error?: string
  }
  cycle_engine?: {
    leg?: string; leg_label?: string
    cycle_score?: number; maturity?: number
    up_run?: number; down_run?: number
    pullback_pct?: number
    trend_up?: boolean; trend_down?: boolean
    rsi_val?: number; atr_pct?: number; atr_elevated?: boolean
    vol_ratio?: number; compressed?: boolean; expanded?: boolean
    is_exhaustion?: boolean; is_ignition?: boolean; is_mature?: boolean
    entry_guidance?: string
    error?: string
  }
  volatility_structure?: {
    nr4?: boolean; nr7?: boolean; wr7?: boolean; wr10?: boolean
    today_range?: number; avg_range_5d?: number; avg_range_10d?: number
    range_pct_today?: number; vol_slope?: number
    compression_score?: number; signal?: string
  }
  torque_engine?: {
    atr_14?: number; atr_20?: number; atr_ratio?: number
    range_pct_today?: number; beta_torque?: number
    vol_slope?: number; shock_day?: boolean
    torque_score?: number; torque_label?: string
  }
  intraday_pressure?: {
    gap_amt?: number; gap_pct?: number; gap_dir?: string; gap_filled?: boolean
    intra_delta?: number; intra_pct?: number
    close_pos_pct?: number; session_range?: number; pressure?: string
  }
  quality_engine?: {
    quality_score?: number; quality_label?: string; security_type?: string
    income_quality_score?: number; income_quality_label?: string
    quality_breakdown?: Record<string, { points: number; max: number; reason: string }>
  }
  action_engine?: { action?: string; size_guidance?: number; tech_verdict?: string; ai_view?: string }
  portfolio_fit?: {
    corr_portfolio?: number; corr_spy?: number; corr_qqq?: number
    corr_sleeve?: number; corr_sleeve_label?: string
    corr_top3?: { symbol: string; corr: number }[]
    beta?: number; weight_pct?: number; sleeve?: string; sleeve_color?: string
    sleeve_existing_weight_pct?: number
    guidance?: { verdict?: string; action?: string }
    total_position_value?: number; portfolio_total_value?: number
    yield_delta_bps?: number; portfolio_yield_pct?: number; symbol_yield_pct?: number
    action_engine_overlay?: { action?: string; size_guidance?: number; ai_view?: string }
    positions?: { account?: string; acct_type?: string; acct_key?: string; shares?: number; value?: number }[]
  }
  nav_metrics?: {
    price_3m_pct?: number; price_6m_pct?: number; price_12m_pct?: number
    price_3y_pct?: number; price_5y_pct?: number
    trend_3m?: string; trend_6m?: string; trend_12m?: string
    trend_3y?: string; trend_5y?: string
    annual_nav_history?: { year: number; change_pct: number }[]
    roc_risk?: boolean; roc_note?: string; note?: string; is_price_proxy?: boolean
  } | null
  guardrails?: { level?: string; msg?: string; code?: string }[]
  fund_strategy?: string
  distributions?: {
    frequency?: string
    ttm_yield?: number | null
    last_amount?: number | null
    ttm_total?: number | null
    ttm_yield_pct?: number | null
    market_yield_pct?: number | null
    last_dividend?: number | null
    last_ex_date?: string
    annual_history?: { year: number; total: number }[]
  }
  peers?: string[]
  holdings?: { symbol?: string; name?: string; weight_pct?: number }[]
  holdings_url?: string
  holdings_is_cef?: boolean
  etf_component_eligible?: boolean
  etf_top10_weight_pct?: number
}

export interface EtfComponentData {
  symbol?: string
  eligible?: boolean
  is_top_heavy?: boolean
  top10_weight_pct?: number
  error?: string | null
  components?: {
    symbol: string
    name?: string
    weight_pct: number
    change_pct: number
    contribution: number
    fair_value?: number | null
    price?: number | null
    currency?: string | null
    pe_ratio?: number | null
    peg_ratio?: number | null
    eps?: number | null
    analyst_target?: number | null
    fv_methods?: number | null
  }[]
  direction_score?: number
  strength_score?: number
  strength_label?: string
  action_label?: string
  action_desc?: string
  interpretation?: string
  etf_fair_value?: number | null
  etf_fv_coverage_pct?: number | null
  etf_growth_score?: number | null
  etf_growth_regime?: string | null
  fv_model_weights?: { dcf: number; pe: number; ps: number } | null
}
