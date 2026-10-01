import type { DashboardData } from '../../types/dashboard'
import { DRAWDOWN_DEFAULTS } from '../../utils/taxConfig'
import { DEFAULT_ANNUAL_SPENDING } from '../../utils/constants'

export const G = 'var(--green)'
export const R = 'var(--red)'
export const A = 'var(--amber)'
export const M = 'var(--text2)'
export const Y = 'var(--yellow)'

export const roundTo2 = (num: number): number => Math.round(num * 100) / 100

export type SubTab = 'monte_carlo' | 'sequence_risk' | 'withdrawal' | 'spending_range' | 'sandbox'

export interface Props { data: DashboardData }

export interface ScenarioEntry {
  label?: string
  description?: string
  overall_success?: number
  median_ending?: number
  p10_ending?: number
}

export interface StrategyEntry {
  label?: string
  description?: string
  overall_success?: number
  median_ending?: number
  p10_ending?: number
  median_path?: number[]
}

export interface SimResult {
  success_rate?: number
  success_rate_85?: number
  success_rate_90?: number
  success_rate_95?: number
  median_ending?: number
  p25_ending?: number
  p75_ending?: number
  sequence_risk_pct?: number;  // ← ADD THIS
  percentiles?: {              // ← ADD THIS
    '10'?: number[];
    '50'?: number[];
    '90'?: number[];
  };
  seq_risk_penalty?: number
  safe_spending?: number
  comfortable_spending?: number
  paths?: number[][]
  spending_levels?: number[]
  success_rates?: number[]
  success_probs?: number[]
  current_prob?: number
  current_spending?: number
  winner?: string
  strategies?: Record<string, StrategyEntry>
  scenarios?: Record<string, ScenarioEntry>
  thresholds?: {
    safe?: { spending?: number }
    comfortable?: { spending?: number }
    aggressive?: { spending?: number }
  }
  baseline?: { overall_success?: number; median_ending?: number; p10_ending?: number }
  scenario?: { overall_success?: number; median_ending?: number; p10_ending?: number }
  custom?: { overall_success?: number; median_ending?: number; p10_ending?: number }
  error?: string
}

export interface SimDefaults {
  spending: number
  expected_return: number
  volatility: number
  inflation: number
  ss_annual: number
  ss_start_age: number
  current_age: number
  target_age: number
  portfolio_value: number
}

export async function fetchSimDefaults(): Promise<SimDefaults> {
  const res = await fetch('/api/simulate')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const d = await res.json()
  return {
    spending: d.spending ?? d.annual_spending ?? DEFAULT_ANNUAL_SPENDING,
    expected_return: d.expected_return ?? DRAWDOWN_DEFAULTS.expected_return,
    volatility: d.volatility ?? DRAWDOWN_DEFAULTS.volatility,
    inflation: d.inflation ?? DRAWDOWN_DEFAULTS.inflation,
    ss_annual: d.ss_annual ?? 0,
    ss_start_age: d.ss_start_age ?? 70,
    current_age: d.current_age ?? 65,
    target_age: d.target_age ?? 95,
    portfolio_value: d.portfolio_value ?? d.total ?? 0,
  }
}

export async function runSim(payload: {
  module: string
  params: Record<string, number | string>
  sandbox_overrides?: Record<string, number>
}): Promise<SimResult> {
  const res = await fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
