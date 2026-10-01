// ─── Core portfolio types ─────────────────────────────────────────────────────

export interface Position {
  symbol: string
  shares: number
  value: number
  cost: number
  pnl: number
  pnl_pct: number
  day_change: number | null   // accurate daily P&L vs previous close (from EOD snapshot)
  annual_income: number
  ytd_received: number | null
  fund_type: 'GROWTH' | 'OPTION_INCOME' | 'DIVIDEND' | 'CEF' | 'MONEY_MARKET'
  benchmark: string
  signal_strength: number | null
  growth_rate_1y: number | null
  is_money_market?: boolean
}

export interface Account {
  label: string
  key: string
  value: number
  cost: number
  pnl: number
  pnl_pct: number
  income: number
  ytd_income_actual: number | null
  positions: Position[]
}

export interface Summary {
  total_value: number
  total_cost: number
  total_pnl: number
  total_pnl_pct: number
  total_income: number
  taxable_income: number
  /** Portfolio-level daily P&L (sum of pos.day_change, money-market excluded). Single source of truth — do not recompute in tabs. */
  day_change: number | null
  /** day_change / total_value × 100. Single source of truth. */
  day_change_pct: number | null
}

// ─── Market data ──────────────────────────────────────────────────────────────

export interface MarketIndex {
  price: number
  momentum_20d: number
  trend_90d: number
  total_return_1y: number
}

export interface MarketContext {
  'S&P 500': MarketIndex
  'Dow Jones': MarketIndex
}

// ─── Snapshots (per-fund technical data) ─────────────────────────────────────

export interface Snapshot {
  price: number
  nav: number
  ttm_yield: number
  premium: number | null
  price_change: number
  price_change_pct: number
  trend_90d: number
  momentum_20d: number
  nav_drop_30d: number
  vol_30d_annual: number
  max_drawdown_6m: number
  sma_20: number
  sma_50: number
  sma_200: number
  rsi_14: number
  macd_bullish: boolean
  last_distribution: number
  distribution_cut_pct: number | null
  total_return_1y: number
  benchmark_return_1y: number
  relative_return_1y: number
  beta: number
  coverage_ratio: number | null
  volume_trend: string
  fund_type?: 'GROWTH' | 'OPTION_INCOME' | 'DIVIDEND' | 'CEF' | 'MONEY_MARKET'
  nav_trend_90d: number
  price_nav_divergence_90d: number
  aum: number | null
  expense_ratio: number | null
  market_accel_20d_vs_90d: number | null
  fund_accel_20d_vs_90d: number | null
  accel_vs_market: number | null
  trendline_break_sigma: number | null
}

// ─── Fund decisions ───────────────────────────────────────────────────────────

export type StructuralStatus =
  | 'ENGINE_HEALTHY'
  | 'VALUATION_STRETCHED'
  | 'INCOME_COMPRESSION'
  | 'STRUCTURAL_BREAKDOWN'

export type SignalLevel = 'GREEN' | 'YELLOW' | 'RED'

export interface MetricResult {
  level: SignalLevel
  message: string
}

export interface Decision {
  symbol: string
  overall: SignalLevel
  structural_status: StructuralStatus
  metrics: Record<string, MetricResult>
  summary: string
}

export interface FundConfig {
  FUND_TYPE: 'GROWTH' | 'OPTION_INCOME' | 'DIVIDEND' | 'CEF'
  DISTRIBUTION_FREQUENCY: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  BENCHMARK: string
}

// ─── Portfolio intelligence ───────────────────────────────────────────────────

export type MarketRegime = 'EXPANSION' | 'CONSOLIDATION' | 'RISK-OFF'
export type VolRegime = 'HIGH' | 'NORMAL' | 'LOW'
export type Positioning = 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE'
export type ConfidenceLabel = 'FRAGILE' | 'CAUTIOUS' | 'CONFIDENT' | 'ROBUST'
export type FragilityLevel = 'HIGH' | 'MODERATE' | 'LOW'
export type AlertLevel = 'red' | 'orange' | 'yellow' | 'green'

export interface TargetVsActual {
  symbol: string
  target_pct: number
  actual_pct: number
  delta_pct: number
  stress_30_pct: number
  in_target: boolean
  in_acct: boolean
}

export interface RolloverConcentration {
  symbol: string
  actual_pct: number
  stress_30_pct: number
}

export interface RiskItem { level: AlertLevel; msg: string }
export interface OpportunityItem { msg: string }
export interface WatchlistItem { priority: 'high' | 'normal'; msg: string }

export interface PortfolioIntel {
  top_holding: string
  top_holding_pct: number
  top_return_1y_pct: number
  top_return_contrib_pct: number
  top_drawdown_contrib_pct: number

  weights: Record<string, number>

  market_regime: MarketRegime
  vol_regime: VolRegime
  trend_signal: string
  positioning: Positioning
  weighted_beta: number
  tech_growth_pct: number
  income_pct: number
  defensive_pct: number

  system_confidence_score: number
  system_confidence_label: ConfidenceLabel
  confidence_delta: number | null
  confidence_trend_label: string

  fragility_score: number
  fragility_level: FragilityLevel

  income_durability_score: number
  inc_stability_pct: number
  inc_stability_lbl: 'HIGH' | 'MODERATE' | 'LOW'
  income_vix_spike_drop_pct: number | null

  stress_qqq_pct: number
  stress_qqq_dollar: number
  stress_top_sym: string
  stress_top_pct: number
  stress_top_dollar: number
  stress_top2_sym: string
  stress_top2_pct: number
  stress_top2_dollar: number
  stress_vix_pct: number
  stress_vix_dollar: number
  combined_stress_pct: number
  combined_stress_dollar: number

  vol_budget_used: number
  portfolio_vol_pct: number
  target_vol_pct: number
  risk_budget_used: number
  risk_budget_label: string
  risk_budget_vol: number
  risk_budget_frag: number

  taxable_inc_pct: number
  tax_free_inc_pct: number

  fund_valuation: Record<string, 'FAIR' | 'DISCOUNTED' | 'ELEVATED' | 'EXTENDED'>

  top_risks: RiskItem[]
  top_opportunities: OpportunityItem[]
  watchlist: WatchlistItem[]

  /** Server-computed high correlation pairs (threshold >= 0.80 on real price data) */
  high_corr_pairs?: { a: string; b: string; corr: number }[]
  /** Total count of high-correlation pairs — authoritative source for UI alerts */
  high_corr_pairs_count?: number
  corr_risk?: 'HIGH' | 'MODERATE' | 'LOW'

  taxable_target_vs_actual: TargetVsActual[]
  roth_target_vs_actual: TargetVsActual[]
  rollover_concentration: RolloverConcentration[]

  /** 60-day cross-sleeve correlation map */
  correlation_map?: {
    lookback_days: number
    method: string
    symbols: string[]
    matrix: Record<string, Record<string, number>>
    sleeve_matrix: Record<string, Record<string, number>>
    diversification_score: number
    highest_corr_pair?: { symbols: string[]; corr: number }
    lowest_corr_pair?: { symbols: string[]; corr: number }
    computed_at?: string
    error?: string
  }
}

// ─── Income history ───────────────────────────────────────────────────────────

export interface IncomeTransaction {
  date: string
  symbol: string
  amount: number
  type: string
  account?: string       // acct_key: "taxable" | "roth_ira" | "rollover_ira"
  qualified?: boolean
  description?: string
}

export interface MonthlyIncome { month: number; total: number }

export interface IncomeHistory {
  year: number
  ytd_total: number
  transactions: IncomeTransaction[]
  by_account: Record<string, {
    total: number
    by_month: MonthlyIncome[]
    by_symbol: Record<string, number>
  }>
}

// ─── Tax data ─────────────────────────────────────────────────────────────────

export interface TaxBracket { rate: number; min: number; max: number }

export interface ConversionScoreComponent {
  name: string
  points: number
  max: number
  weight: string
}

export interface TaxData {
  name: string
  filing_status: 'SINGLE' | 'MFJ' | 'MFS'
  dob: string
  current_age: number
  ss_start_age: number
  ss_annual: number
  target_age: number
  annual_div_for_agi: number
  expected_ytd_total: number
  std_deduction: number
  brackets: TaxBracket[]
  bracket_pressure_pct: number
  conv_score: number
  conv_action: string
  conv_action_icon: string
  conv_score_components: ConversionScoreComponent[]
}

// ─── Spending intelligence ────────────────────────────────────────────────────

export interface ShockEvent {
  amount: number
  category: string
  description: string
  date: string
}

export interface SpendingIntelligence {
  available: boolean
  true_annual_spending: number
  spending_drift_pct: number | null
  estimate_delta: number
  estimate_delta_pct: number
  hardcoded_spending: number
  core_spending: number
  noncore_spending: number
  discretionary_pct: number
  monthly_stddev: number
  cashflow_vol_pct: number
  lifestyle_phase: 'go_go' | 'slow_go' | 'no_go'
  lifestyle_icon: string
  lifestyle_label: string
  lifestyle_note: string
  recent_annual: number
  prior_annual: number
  shock_count: number
  shock_events: ShockEvent[]
  date_range: { start: string; end: string; months: number }
  csv_rows: number
  data_complete: boolean
  low_data_months: string[]
  taxes_total: number
  taxes_annual: number
}

// ─── Decision strip ───────────────────────────────────────────────────────────

export interface DecisionItem {
  icon: string
  action: string
  text: string
  level: AlertLevel
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export interface AlertItem {
  level: AlertLevel
  symbol: string
  message: string
}

export interface AlertHistoryItem {
  date: string
  level: AlertLevel
  symbol: string
  message: string
}

// ─── Income analytics ─────────────────────────────────────────────────────────

export interface IncomeAttribution {
  symbol: string
  amount: number
  pct: number
  tax_status: string
}

export interface IncomeAnalytics {
  portfolio_fwd_12m: number            // spendable — excludes reinvested (DRIP) accounts
  portfolio_fwd_12m_all?: number       // every account, incl. reinvested
  reinvested_fwd_12m?: number
  reinvested_accounts?: string[]
  /** Forward 12-month income ÷ total portfolio value × 100. Single source of truth — do not recompute in tabs. */
  yield_pct: number | null
  target_income: number
  income_gap: number | null
  avg_quality_score: number | null
  income_growth_rate: number | null
  projected_eoy: number | null
  ceiling_gap: number | null
  ceiling_over: number | null
  months_to_ceiling: number | null
  ceiling_drift_trend: string | null
  conversion_window: string | null
  forward_tax_impact: number | null
  income_attribution: IncomeAttribution[]
  by_account: Record<string, {
    fwd_12m: number
    ytd_income: number
    by_symbol: Record<string, number>
    /** Dividends reinvested (DRIP) — not counted as spendable income */
    reinvested?: boolean
  }>
  /** Lifestyle income target range (from _INCOME_TARGET block in input.json) */
  lifestyle_target_min: number | null
  lifestyle_target_max: number | null
  /** fwd12m as % of lifestyle_target_max (pessimistic coverage) */
  lifestyle_progress_min: number | null
  /** fwd12m as % of lifestyle_target_min (optimistic coverage) */
  lifestyle_progress_max: number | null
  /** Additional income needed to reach lifestyle_target_min (0 if already covered) */
  lifestyle_gap_min: number | null
  /** Additional income needed to reach lifestyle_target_max */
  lifestyle_gap_max: number | null
  lifestyle_status: 'COVERED' | 'PARTIAL' | 'SHORT' | null
  /** Rolling 12-month dividend payout calendar, per account */
  payout_calendar?: {
    col_labels: string[]  // e.g. ["May-26", "Jun-26", …]
    accounts: Record<string, {
      tickers: Record<string, number[]>  // ticker → [12 monthly $ amounts]
      monthly_totals: number[]           // [12 aggregate totals]
    }>
  }
}

// ─── Roth conversion data ─────────────────────────────────────────────────────

export interface RothConversion {
  symbol: string
  shares: number
  price: number
  nav: number | null
  premium: number | null
  status: string
  recommendation: string
}

export interface TargetAnalysis {
  symbol: string
  target_weight: number
  current_weight: number
  current_value?: number
  gap_pct: number       // target_weight − current_weight (positive = underweight = BUY)
  dollar_gap?: number   // pre-computed by server against correct total (e.g. Roth + Rollover)
  conv_dollars: number | null
  action?: string
}

export interface ConversionPlanRow {
  symbol:            string
  convert_dollars:   number
  current_value:     number
  current_shares?:   number
  price?:            number
  convert_shares?:   number
  pct_of_position?:  number
  remaining_after?:  number
  already_converted?: number
}

export interface ProjectionRow {
  year: number
  age: number
  dividends: number
  conversion: number
  ss_income: number
  gross_income: number
  taxable_income: number
  federal_tax: number
  effective_rate: number
  after_tax: number
  rollover_value: number
  roth_value: number
  is_actual?: boolean
  ss_prorated?: boolean
  has_ss?: boolean
}

export interface Correlation {
  symbols: string[]
  matrix: number[][]
}

// ─── Extended tax data ────────────────────────────────────────────────────────

export interface SSOption {
  label: string
  date: string
  monthly: number
  annual: number
}

export interface QuarterlyPayment {
  quarter: string
  period: string
  due_label: string
  payment: number
  div_income: number              // quarterly dividend income (ordinary + qualified, excl ROC)
  div_income_ordinary?: number    // ordinary portion of div_income
  div_income_qualified?: number   // qualified portion of div_income
  div_income_actual?: number      // actual received so far this quarter
  div_income_projected?: number   // projected remaining months
  div_income_estimated?: boolean  // true when actual data unavailable (prior year card)
  div_tax: number                 // tax on dividends this quarter
  conv_portion: number       // planned conversion amount
  conv_tax: number           // incremental tax from conversion (only in conv_quarter)
  cap_gains_tax: number      // total cap gains tax this quarter (STCG + LTCG)
  stcg_realized: number      // net STCG this quarter (gains − losses)
  stcg_gain: number          // gross STCG gains only (positive)
  stcg_loss: number          // STCG losses only (negative), for TLH display
  ltcg_realized: number      // net LTCG this quarter (gains − losses)
  ltcg_gain: number          // gross LTCG gains only (positive)
  ltcg_loss: number          // LTCG losses only (negative)
  is_conv_quarter: boolean
  days_until: number
}

export interface BracketBreakdown {
  rate: number
  amount_in_bracket: number
  tax_in_bracket: number
}

export interface DivTaxEntry {
  ordinary_amt: number
  qualified_amt: number
  roc_amt: number
  annual_total: number
  ordinary_pct: number
  qualified_pct: number
  roc_pct: number
}

// ─── Cost-basis lot analysis ──────────────────────────────────────────────────

export interface CostLot {
  acquired_date: string       // ISO date, e.g. "2025-09-08"
  lt_date: string             // acquired_date + 365 days — when lot becomes LTCG
  quantity: number
  cost_per_share: number
  gain_loss: number
  gain_loss_pct: number
  market_value: number
  cost_basis: number
  is_ltcg: boolean
  days_to_lt: number          // 0 if already LTCG
}

export interface CostBasisSymbol {
  account: string
  stcg_gain: number
  stcg_loss: number
  ltcg_gain: number
  ltcg_loss: number
  stcg_shares: number
  ltcg_shares: number
  total_unrealized: number
  next_lt_flip_date: string | null   // earliest upcoming LTCG maturity date
  days_to_next_lt: number | null
  lots: CostLot[]
}

export interface RealizedGainTransaction {
  date: string             // ISO trade date
  symbol: string
  shares: number
  proceeds: number         // sale proceeds
  cost: number             // cost basis of sold lots
  gain: number             // proceeds − cost (negative = loss)
  stcg: number             // short-term portion of gain (lot-level FIFO)
  ltcg: number             // long-term portion of gain (lot-level FIFO)
  gain_type: 'LTCG' | 'STCG' | 'LOSS_LTCG' | 'LOSS_STCG'
}

export interface MaturityEvent {
  date: string             // ISO date when this lot becomes LTCG
  symbol: string
  shares: number
  gain: number             // unrealized gain in this lot
  days_away: number
  cost_basis: number
  market_value: number
  acq_date: string         // original acquired date
}

// ─── Withdrawal Strategy State Machine types ──────────────────────────────────

export interface WithdrawalStateRules {
  allow_controlled_sale: boolean
  controlled_sale_target_min?: number
  controlled_sale_target_max?: number
  allow_trimming_income_etfs: boolean
  sell_income_etfs?: boolean
  required_bucket_years: number
  maximize_roth?: boolean
}

export interface WithdrawalStateDef {
  name: string
  description: string
  rules: WithdrawalStateRules
}

// ─── Extended tax data ────────────────────────────────────────────────────────

export interface ExtendedTaxData extends TaxData {
  retirement_year: number | null
  rollover_balance: number
  safety_buffer: number
  rmd_start_age: number | null
  years_to_rmd: number | null
  rollover_balance_at_rmd_age: number | null
  estimated_first_year_rmd: number | null
  estimated_rmd_tax: number | null
  survivor_bracket_projection: {
    projected_pretax_balance_at_survivor_year: number
    survivor_year_estimate: number
    mfj_bracket_at_this_income: number    // decimal, e.g. 0.32
    single_bracket_at_this_income: number // decimal, e.g. 0.35
    extra_annual_tax_as_single: number
  } | null
  income_confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  // Timing trigger fields
  income_received_pct: number | null
  income_received_actual: number | null
  income_received_projected: number | null
  trigger_pct_threshold: number | null
  trigger_met: boolean | null
  pct_triggered: boolean | null
  dec1_triggered: boolean | null
  days_to_dec1: number | null
  // Full year AGI estimate
  full_year_agi_estimate: number | null
  // Conversion status
  conversion_progress_pct: number | null
  conversion_done_likely: boolean | null
  conversion_imminent: boolean | null
  conversion_alert: boolean | null
  balance_drop: number | null
  conversion_month: number | null
  conversion_month_name: string | null
  // Projection starts
  proj_rollover_start: number | null
  proj_roth_start: number | null
  proj_growth_rate: number | null
  proj_div_growth_rate: number | null
  // Remaining income estimate
  remaining_income_est: number | null
  agi_ratio: number | null
  // Dynamic recommendation
  dynamic_conv_recommended_amount: number | null
  dynamic_conv_conservative: number | null
  dynamic_conv_recommended: number | null
  dynamic_conv_aggressive: number | null
  optimal_conv: number | null
  projections_conservative: ProjectionRow[]
  projections_recommended: ProjectionRow[]
  projections_aggressive: ProjectionRow[]
  projections: ProjectionRow[]
  rollover_conv_plan_dynamic:  ConversionPlanRow[]
  rollover_conv_plan:          ConversionPlanRow[]
  rollover_conv_plan_adjusted?: ConversionPlanRow[]
  conversions_done_detail: { date: string; value: number }[]
  spouse_name: string | null
  spouse_dob: string | null
  spouse_age: number | null
  ss_start_date: string | null
  ss_years_until: number | null
  ss_options: Record<string, SSOption>
  spouse_ss_start_age: number | null
  filing_status: 'SINGLE' | 'MFJ' | 'MFS'
  collect_medicare: boolean
  conv_efficiency_score: number | null
  income_tax_score: number | null
  seq_risk_score: number | null
  bracket_pressure_pct: number
  bracket_pressure_trend: string | null
  bracket_pressure_trend_color: string | null
  bracket_pressure_real: number | null
  target_bracket_ceiling: number | null
  bracket_ceiling_magi: number | null  // gross MAGI at top of target bracket (same value, canonical name)
  target_bracket_rate: number | null   // configured target rate, e.g. 24 (integer %)
  // ── NIIT ────────────────────────────────────────────────────────────────
  niit_applies: boolean | null
  niit_amount: number | null           // estimated NIIT owed ($)
  niit_threshold: number | null        // MAGI threshold for this filing status
  niit_headroom: number | null         // $ until NIIT kicks in (0 if already applies)
  niit_rate: number | null             // e.g. 0.038
  // ── IRMAA ────────────────────────────────────────────────────────────────
  magi: number | null
  irmaa_tier_idx: number | null
  irmaa_tier_label: string | null
  irmaa_part_b_monthly: number | null
  irmaa_part_d_monthly: number | null
  irmaa_monthly_per_person: number | null
  irmaa_annual: number | null
  irmaa_headroom: number | null
  irmaa_next_threshold: number | null
  medicare_people: number | null
  converted_ytd: number
  gross_no_ss: number | null
  gross_actual: number | null
  taxable_actual: number | null
  marginal_rate: number | null
  annual_conversion: number | null
  /** Auto-calculated conversion recommendation (bracket ceiling − deductions/income/buffer) — reference only, does not drive annual_conversion. */
  annual_conversion_recommended: number | null
  annual_conversion_breakdown: {
    bracket_rate: number       // e.g. 32 (percent)
    bracket_ceiling: number    // gross income ceiling for bracket_rate (taxable max + std deduction — do NOT subtract std_deduction again below, it's already included)
    dividends: number          // forward-12m taxable dividend estimate
    w2_annualized: number      // always 0 today — no live W2 income source
    ss_taxable: number         // 0 unless SS is actually being received this tax year
    safety_buffer: number
    recommended: number
  } | null
  remaining_to_convert: number | null
  quarterly_payments: QuarterlyPayment[]
  conv_quarter: number | null
  spending_true_annual: number | null
  spending_recent_12: number | null
  spending_prior_12: number | null
  spending_drift_pct: number | null
  spending_data_months: number | null
  estimated_spending: number | null
  withdrawal_need_actual: number | null
  income_surplus: number | null
  agi_real: number | null
  conv_room_real: number | null
  annual_div_total: number
  total_ordinary_div: number
  total_qualified_div: number
  total_roc_div: number
  qualified_div_rate: number | null
  div_tax_breakdown: Record<string, DivTaxEntry>
  taxable_no_ss: number | null
  tax_no_ss: number | null
  /** Stored as a percentage value e.g. 12.5 means 12.5% */
  eff_rate_no_ss: number | null
  annual_w2: number | null        // full-year W2 wages — the base the bracket stack sits on
  tax_w2_only: number | null      // tax on W2 wages alone (bottom layer of the bracket waterfall)
  tax_div_only: number | null     // marginal tax attributable to dividends (on top of W2), incl. their NIIT share
  tax_stcg_add: number | null     // marginal tax attributable to STCG (on top of W2+divs), incl. its NIIT share
  tax_conv_add: number | null     // marginal tax on the full annual PLAN target conversion
  tax_conv_actual: number | null  // marginal tax on the YTD-ACTUAL conversion only — pair with converted_ytd
  tax_ltcg: number | null         // LTCG tax at preferential rate (separate from brackets)
  total_tax_with_cg: number | null  // full year: ordinary (divs+STCG+conv) + LTCG
  breakdown_no_ss: BracketBreakdown[]
  gross_with_ss: number | null
  taxable_with_ss: number | null  // includes qualified div — same relationship as ordinary_taxable_income
  tax_with_ss: number | null
  /** Stored as a percentage value e.g. 14.2 means 14.2% */
  eff_rate_with_ss: number | null
  ss_taxable_amt: number | null
  ss_taxable_pct: number | null
  breakdown_with_ss: BracketBreakdown[]
  ordinary_rate_taxable_income_with_ss: number | null  // qualified div excluded — feeds breakdown_with_ss
  expected_ytd_total: number
  expected_ytd_by_symbol: Record<string, number> | null
  safe_harbor_met: boolean | null
  safe_harbor_prior_year_tax: number | null
  safe_harbor_required_total: number | null
  safe_harbor_required_ytd: number | null
  safe_harbor_paid_ytd: number | null
  safe_harbor_w2_withholding: number | null
  safe_harbor_gap: number | null
  cal_months: string[]
  taxable_div_calendar: Record<string, (number | null)[]>
  monthly_div_totals: (number | null)[]
  exec_conv_target: number | null
  spending_quarterly: { quarter: string; amount: number }[]
  // Withdrawal Strategy State Machine thresholds + per-state rules
  // Thresholds are ratio-based server-side (gain_ratio × portfolio MV); dollar values are dynamic.
  withdrawal_state_ab_threshold: number
  withdrawal_state_bc_threshold: number
  withdrawal_state_ab_gain_ratio: number
  withdrawal_state_bc_gain_ratio: number
  withdrawal_gain_ratio: number | null
  withdrawal_current_state: 'A' | 'B' | 'C'
  withdrawal_forced_income_ratio: number | null
  withdrawal_forced_income_num: number | null
  withdrawal_forced_income_denom: number | null
  withdrawal_forced_income_status: 'OK' | 'WATCH' | 'ACTION' | 'CRITICAL' | null
  withdrawal_ctrl_sale_ratio: number | null
  withdrawal_spending_gap: number | null
  withdrawal_concentration_ratio: number | null
  withdrawal_state_conditions: {
    A_to_B: {
      triggered: boolean
      gain_ratio: { value: number; threshold: number; met: boolean }
      forced_income_ratio: { value: number | null; threshold: number; met: boolean; available: boolean }
      concentration_ratio: { value: number; threshold: number; met: boolean }
    }
    B_to_C: {
      triggered: boolean
      gain_ratio: { value: number; threshold: number; met: boolean }
      forced_income_ratio: { value: number | null; threshold: number; met: boolean; available: boolean }
      controlled_sale_ratio: { value: number; threshold: number; met: boolean }
      concentration_ratio: { value: number; threshold: number; met: boolean }
    }
  } | null
  stcg_ratio: number | null
  stcg_ratio_status: 'OK' | 'WATCH' | 'ALERT' | 'FREEZE' | null
  freeze_rebalance: boolean | null
  concentration_status: 'OK' | 'WATCH' | 'ACTION' | 'CRITICAL' | null
  concentration_freeze_buys: boolean | null
  concentration_must_trim: boolean | null
  concentration_redirect_dividends: boolean | null
  concentration_top_pct: number | null
  withdrawal_dividend_load_alert: number
  withdrawal_states: {
    A: WithdrawalStateDef
    B: WithdrawalStateDef
    C: WithdrawalStateDef
  } | null
  withdrawal_milestones: { gain_value: number; label: string; color: string }[] | null
  withdrawal_transition_logic: {
    A_to_B: { gain_ratio: number; forced_income_ratio: number; logic: string }
    B_to_C: { gain_ratio: number; forced_income_ratio: number; controlled_sale_ratio: number; logic: string }
  } | null
  concentration_rules: {
    single_theme: { watch: number; action: number; critical: number }
    growth_cluster: { watch: number; action: number; critical: number }
    rules: { freeze_new_buys_at_action: boolean; mandatory_trim_at_critical: boolean; redirect_dividends_when_action: boolean }
  } | null
  gain_maturity_rules: {
    stcg_ratio_watch: number
    stcg_ratio_alert: number
    freeze_rebalance_if_stcg_above: number
    prefer_dividend_rebalancing: boolean
  } | null
  forced_income_rules: {
    watch_ratio: number
    action_ratio: number
    critical_ratio: number
  } | null
  marginal_rate_model: {
    include_federal: boolean
    include_niit: boolean
    include_irmaa: boolean
    include_state_tax: boolean
  } | null
  cash_flow_routing: {
    drip_enabled: boolean
    default_destination: string
    concentration_override: { enabled: boolean; redirect_if_theme_above: number }
  } | null
  spending_calendar_years: {
    year: string
    lifestyle: number
    annualised: number
    taxes_paid: number
    income: number
    months: number
  }[]
  // ── Dual-Pipeline Conversion Engine ──────────────────────────────────
  // Pipeline A: ordinary income bracket
  ytd_ordinary_income: number | null
  remaining_ordinary_room: number | null
  // Pipeline B: LTCG bracket — includes qualified dividends (correct base for LTCG/QDI stacking)
  ordinary_taxable_income: number | null
  // True ordinary-rate-only income (qualified div excluded) — feeds the Bracket Filling Engine
  ordinary_rate_taxable_income: number | null
  ytd_ltcg_realized: number | null
  ytd_stcg_realized: number | null   // net STCG (gains + losses); negative when net loss
  ytd_stcg_gross:    number | null   // gross STCG gains only (positive), for display
  ytd_stcg_loss:     number | null   // STCG losses only (negative), for display
  ytd_net_gain: number | null
  realized_gains_by_symbol: Record<string, { gain: number; type: string }> | null
  realized_gain_transactions: RealizedGainTransaction[] | null
  ltcg_rate: number | null
  ytd_cap_gains_tax: number | null    // total estimated cap gains tax due this year
  prev_q4_ltcg: number | null         // LTCG realized Sep–Dec of prior year (due Jan 15)
  prev_q4_stcg: number | null         // STCG realized Sep–Dec of prior year (due Jan 15)
  ltcg_0pct_threshold: number | null
  ltcg_15pct_threshold: number | null
  ltcg_0pct_room: number | null
  ltcg_15pct_room: number | null
  // Taxable unrealized gains
  taxable_unrealized_gains: number | null
  taxable_unrealized_losses: number | null
  taxable_unrealized_by_symbol: Record<string, number> | null
  // ── Lot-Level LTCG/STCG Analysis (from schwab_cost.json) ──────────────
  cost_basis_lots: Record<string, CostBasisSymbol> | null
  ltcg_maturity_calendar: MaturityEvent[] | null
  total_stcg_unrealized_gain: number | null
  total_ltcg_unrealized_gain: number | null
  total_stcg_unrealized_loss: number | null
  total_ltcg_unrealized_loss: number | null
  // ── Tax Rule Engine ────────────────────────────────────────────────────
  income_bracket_target: number | null
  bracket_room: number | null
  bracket_pace_pct: number | null
  bracket_status: 'OK' | 'WATCH' | 'ACTION' | 'CRITICAL' | null
  bracket_status_msg: string | null
  bracket_status_color: string | null
  soft_limit: number | null
  soft_limit_room: number | null
  soft_limit_pace_pct: number | null
  soft_limit_status: 'OK' | 'WATCH' | 'ACTION' | null
  final_bracket_status: 'OK' | 'WATCH' | 'ACTION' | 'CRITICAL' | null
  final_bracket_msg: string | null
  final_bracket_color: string | null
}

// ─── Extended spending data ───────────────────────────────────────────────────

export interface SpendingCategory {
  is_core: boolean
  annual: number
  monthly_avg: number
  pct: number
  count: number
}

export interface RecurringPayment {
  description: string
  category: string
  monthly_avg: number
  annual: number
  months_seen: number
  this_year_avg?: number | null
  this_year_total?: number | null
  last_year_avg?: number | null
  last_year_total?: number | null
}

export interface MonthlyTotal {
  month: string
  amount: number
}

export interface MonthlyIncomeTotal {
  month: string
  w2: number
  other: number
  total: number
}

export interface ExtendedSpendingIntelligence extends SpendingIntelligence {
  monthly_totals: MonthlyTotal[]
  monthly_mean: number
  monthly_stddev: number
  categories: Record<string, SpendingCategory>
  recurring: RecurringPayment[]
  ytd_total: number
  core_pct: number
  monthly_income_avg: number | null
  months_available: number | null
  ytd_income: number | null
  // W2 income fields
  w2_annual?: number
  w2_total?: number
  monthly_income_totals?: MonthlyIncomeTotal[]
  // Calendar year detail
  calendar_years?: Array<{
    year: string
    lifestyle: number
    annualised: number
    taxes_paid: number
    income: number
    w2_income: number
    other_income: number
    months: number
  }>
}

// ─── Performance data ─────────────────────────────────────────────────────────

export interface PerfPeriod {
  total_return: number
  vol_annual: number
  sharpe: number
  max_drawdown: number
  pct_returns: number[]
  dates: string[]
  // Raw daily closes for this period's own date range. Present for held
  // symbols; stripped server-side for benchmarks (SPY/QQQ) to save payload
  // size — those carry pct_returns only. NOT the same as a top-level
  // start_price/end_price (which, on the wire, live one level up on the
  // per-symbol object and are always 1Y-scoped regardless of `period`).
  prices?: number[]
}

export type PerformanceData = Record<string, Record<string, PerfPeriod>>

// ─── Root dashboard data ──────────────────────────────────────────────────────

export interface IncomeSummary {
  // ACTUAL YTD — real transactions received / executed this year
  actual_w2: number
  // Dividends — all accounts (for total portfolio income display)
  actual_div_total: number
  actual_div_by_acct: Record<string, number>
  // Dividends — taxable vs non-taxable split
  actual_div_taxable: number
  actual_div_nontaxable: number
  // Capital gains — taxable account only
  actual_stcg: number
  actual_ltcg: number
  actual_cap_gains: number
  actual_conversion: number        // Roth conversion YTD (taxable event, not cash inflow)
  // Taxable income total = W2 + taxable divs + STCG + LTCG + conversion
  actual_taxable_income: number
  actual_total: number             // all sources, all accounts (display)
  // Expected YTD
  expected_w2: number
  expected_div_total: number
  expected_div_by_acct: Record<string, number>
  expected_div_taxable: number
  expected_div_nontaxable: number
  expected_conversion: number
  expected_taxable_income: number
  expected_total: number
  // Projected remaining this year
  projected_w2: number
  projected_div_total: number
  projected_div_by_acct: Record<string, number>
  projected_div_taxable: number
  projected_div_nontaxable: number
  projected_conversion: number
  projected_taxable_income: number
  projected_total: number
  // Full-year projection
  full_year_w2: number
  full_year_div: number
  full_year_div_by_acct: Record<string, number>
  full_year_div_taxable: number
  full_year_div_nontaxable: number
  full_year_conversion: number
  full_year_total: number
  // Pay period metadata (semi-monthly: 1st + 15th = 24/yr)
  pay_periods_elapsed: number
  pay_periods_remaining: number
  avg_paycheck: number
}

export interface DashboardData {
  timestamp: string
  schwab_status: 'live' | 'config'
  summary: Summary
  accounts: Account[]
  market_context: MarketContext | null
  vix_current: number | null
  vix_90d_avg: number | null
  snapshots: Record<string, Snapshot>
  portfolio_intel: PortfolioIntel
  income_history: IncomeHistory
  tax_data: ExtendedTaxData
  spending_intelligence: ExtendedSpendingIntelligence
  decision_strip: DecisionItem[]
  decisions: Decision[]
  fund_configs: Record<string, FundConfig>
  alerts: AlertItem[]
  system_health: { alert_history: AlertHistoryItem[] }
  income_analytics: IncomeAnalytics | null
  income_summary: IncomeSummary | null
  roth_conversions: RothConversion[]
  roth_target_analysis: TargetAnalysis[]
  taxable_target_analysis: TargetAnalysis[]
  correlation: Correlation | null
  triggered_alerts?: PriceAlert[]
}

// ─── Balance History ─────────────────────────────────────────────────────────

export interface BalanceSnapshot {
  ts:           number                    // Unix epoch (UTC)
  date:         string                    // YYYY-MM-DD (ET trading date)
  label:        'open' | 'close' | 'manual'
  total_value:  number                    // total portfolio value in USD
  accounts:     Record<string, number>    // per-account breakdown {acct_key: value}
  session_high: number | null            // portfolio value at position daily highs (backfill only)
  session_low:  number | null            // portfolio value at position daily lows  (backfill only)
  recorded_at:  string                    // ISO-8601 UTC
}

// ─── Price Alerts ─────────────────────────────────────────────────────────────

export interface PriceAlert {
  id: string
  symbol: string
  direction: 'above' | 'below'
  mode: 'price' | 'pct'
  threshold: number
  base_price: number
  created_at: string
  active: boolean
  triggered: boolean
  triggered_at: string | null
  triggered_price: number | null
  notes: string
}

// ─── Wellness (separate /api/wellness endpoint) ───────────────────────────────

export interface WellnessData {
  net_worth: number
  portfolio_income: number
  estimated_spending: number
  income_coverage_pct: number | null
  withdrawal_rate: number | null
  buffer_years: number | null
  success_prob_95: number
  success_prob_100: number
  overall_success: number
  projected_95_median: number | null
  median_ending: number
  seq_risk_pct: number
  seq_risk_penalty: number
  safe_spending: number
  safe_spending_prob: number
  comfortable_spending: number
  cashflow_surplus: number
  ruin_threshold: number
  current_age: number
  ss_start_age: number
  ss_annual: number
  target_age: number
}


// ─── Server refresh-progress status ───────────────────────────────────────────

export interface ServerStatus {
  phase: 'idle' | 'loading' | 'done' | 'error'
  step: string
  pct: number
  elapsed: number
  refreshing: boolean
}

/** NYSE trading-day status — calendar-aware (holidays, early closes). */
export interface MarketStatus {
  is_open: boolean
  is_trading_day: boolean
  is_early_close: boolean
  market_open_utc: string | null
  market_close_utc: string | null
  next_open_utc: string
}
