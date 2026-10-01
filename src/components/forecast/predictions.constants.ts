// ─── Color system ──────────────────────────────────────────────────────────────
// Consistent across all tabs — green / amber / red traffic-light palette
export const BASE_C   = 'var(--fd-accent)'    // base scenario — accent (Cobalt light / Lime dark)
export const BULL_C   = 'var(--fd-lilac-ink)'     // bull — comparison series
export const BEAR_C   = 'var(--fd-negative)'  // bear — Vermillion
export const TARGET_C = 'var(--fd-muted)'     // target allocation reference
export const EXP_C    = 'var(--text2)'   // muted gray  — expenses (neutral cost line)
export const TAX_C    = 'var(--text2)'   // muted  — taxes (neutral cost, matches secondary text)
export const M        = 'var(--text2)'   // muted text
export const DIM      = 'var(--text3)'   // dimmer text

// ─── Prediction model (ONLY hardcoded values in this file) ────────────────────
// These are scenario assumptions, not predictions. Update in constants file annually.
export const PRICE_GROWTH: Record<string, Record<string, number>> = {
  GROWTH:        { base: 0.08,  bull: 0.18,  bear: -0.20 },
  DIVIDEND:      { base: 0.05,  bull: 0.10,  bear: -0.12 },
  OPTION_INCOME: { base: 0.01,  bull: 0.04,  bear: -0.08 },
  CEF:           { base: 0.04,  bull: 0.08,  bear: -0.15 },
  MONEY_MARKET:  { base: 0.045, bull: 0.052, bear:  0.035 },
  UNKNOWN:       { base: 0.06,  bull: 0.12,  bear: -0.15 },
}
// Income growth tracks portfolio VALUE growth (income = yield × value; yield is stable).
// Exception: OPTION_INCOME ETFs have managed distributions that may not grow with NAV.
// Exception: CEFs have fixed/semi-fixed distributions; income growth is more modest.
// Exception: MONEY_MARKET yield is rate-driven, not portfolio-driven.
export const DIV_GROWTH: Record<string, Record<string, number>> = {
  GROWTH:        { base: 0.08,  bull: 0.18,  bear: -0.20 },  // tracks NAV (DRIP/reinvestment)
  DIVIDEND:      { base: 0.05,  bull: 0.10,  bear: -0.12 },  // tracks NAV, slight lag
  OPTION_INCOME: { base: -0.01, bull: 0.02,  bear: -0.10 },  // covered-call premium erosion; flat-to-declining in base
  CEF:           { base: 0.00,  bull: 0.04,  bear: -0.12 },  // semi-fixed/managed payout; flat in base
  MONEY_MARKET:  { base: -0.01, bull: 0.01,  bear: -0.02 },  // rate-dependent
  UNKNOWN:       { base: 0.05,  bull: 0.10,  bear: -0.12 },
}
export const EXPENSE_INFLATION = { base: 0.025, bull: 0.020, bear: 0.035 }

// Stress test modifiers — applied as immediate shocks to the BASE value/income level,
// after which normal scenario growth compounds. price/div = 1.0 means no shock.
export const STRESS_MODS = {
  none:         { price: 1.00, div: 1.00, label: '' },
  crash:        { price: 0.80, div: 0.80, label: '−20% CRASH' },
  rally:        { price: 1.20, div: 1.10, label: '+20% RALLY' },
  div_cut:      { price: 1.00, div: 0.60, label: 'DIV CUT −40%' },
  prem_collapse:{ price: 0.90, div: 1.00, label: 'PREM COLLAPSE' },
}
export type StressTest = keyof typeof STRESS_MODS

export type Scenario = 'base' | 'bull' | 'bear'
export type Horizon  = 1 | 3 | 5 | 10
export type Mode     = 'simple' | 'advanced'

export const SCENARIO_META: Record<Scenario, { label: string; color: string; desc: string; icon: string }> = {
  base: { label: 'BASE',  color: BASE_C, desc: 'Historical-average returns · 2.5% inflation', icon: '' },
  bull: { label: 'BULL',  color: BULL_C, desc: '+20% growth shock · lower rates · 2.0% inflation', icon: '' },
  bear: { label: 'BEAR',  color: BEAR_C, desc: 'Annual growth rates: GROWTH −20%, DIVIDEND −12%, CEF −15% · 3.5% inflation · no crash modifier (crash = STRESS overlay)', icon: '' },
}
export const HORIZONS: Horizon[] = [1, 3, 5, 10]

// localStorage key for "what changed" snapshots
export const SNAP_KEY = 'pred_snapshot_v1'

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface PosInfo { symbol: string; value: number; income: number; type: string }

export interface BracketSlice { rate: number; slice: number; tax: number }

export interface ProjYear {
  calYear: number; age: number
  portfolioValue: number; taxableValue: number; rolloverValue: number; rothValue: number
  annualIncome: number; convIncome: number; ssIncome: number; grossIncome: number
  stdDeduction: number; taxableIncome: number
  bracketSlices: BracketSlice[]; federalTax: number; effectiveRate: number; niitAmount: number
  ltcgCapacity: number; expenses: number; netCashflow: number
  /** which spending number drives `expenses`: Settings plan estimate or tracked transactions */
  expenseBasis: 'plan' | 'tracked'
}

export interface PredSnapshot {
  ts: number; horizon: number
  portfolioValue: number; annualIncome: number; federalTax: number; netCashflow: number
}
