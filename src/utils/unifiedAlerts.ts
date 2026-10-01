/**
 * unifiedAlerts — single source of truth for the dashboard alert list.
 *
 * Every surface that shows an alert count or alert list (App header badge,
 * SystemRibbon pill, Overview alert panel, Risk consolidated panel) must
 * build it from here so the counts always agree.
 *
 * Note: per-tab "BRIEFING" chips (X CRIT / Y WARN) are tab-scoped findings
 * from /api/briefing/<tab> and are intentionally NOT part of this list.
 */
import type { DashboardData } from '../types/dashboard'
import { VOL_BUDGET_ALERT, VOL_BUDGET_WARN, VOL_BUDGET_WATCH } from './constants'
import { FRAGILITY_HIGH, FRAGILITY_ELEVATED } from './retirementEngine'

export type AlertLevel = 'red' | 'orange' | 'yellow' | 'green'

export interface UnifiedAlert {
  level: AlertLevel
  /** short origin tag, e.g. SMH, RISK, WATCH, VOL, FRAG, TAX, CONV, REGIME */
  source: string
  msg: string
}

const LEVEL_ORDER: Record<string, number> = { red: 0, orange: 1, yellow: 2, green: 3 }

export function buildUnifiedAlerts(data: DashboardData): UnifiedAlert[] {
  const pi = data.portfolio_intel
  const tx = data.tax_data
  const all: UnifiedAlert[] = []

  if (pi?.market_regime === 'RISK-OFF')
    all.push({ level: 'red', source: 'REGIME', msg: 'Market regime: RISK-OFF — elevated VIX, deteriorating trend. Review hedges.' })

  for (const a of data.alerts ?? [])
    all.push({ level: a.level as AlertLevel, source: a.symbol || 'SYSTEM', msg: a.message })

  for (const r of pi?.top_risks ?? [])
    all.push({ level: r.level as AlertLevel, source: 'RISK', msg: r.msg })

  for (const w of pi?.watchlist ?? [])
    all.push({ level: w.priority === 'high' ? 'orange' : 'yellow', source: 'WATCH', msg: w.msg })

  // Missing portfolio_intel (partial/stale fetch) previously defaulted both
  // gates to 0 — the SAFEST possible reading — silently suppressing the two
  // most important risk alerts exactly when the data is least trustworthy.
  // Default to the same neutral/watch-level constants and thresholds the
  // canonical engine (retirementEngine.ts) uses, so this panel can't disagree
  // with the Retirement Scorecard/Key Health tiles on the same tab.
  const volBudget = pi?.vol_budget_used ?? VOL_BUDGET_WATCH  // value is already a percent (e.g. 187)
  if (volBudget > VOL_BUDGET_ALERT)
    all.push({ level: 'red', source: 'VOL', msg: `Volatility budget exceeded — ${volBudget.toFixed(0)}% of target` })
  else if (volBudget > VOL_BUDGET_WARN)
    all.push({ level: 'orange', source: 'VOL', msg: `Volatility budget elevated — ${volBudget.toFixed(0)}% of target` })

  const fragility = pi?.fragility_score ?? FRAGILITY_ELEVATED
  if (fragility >= FRAGILITY_HIGH)
    all.push({ level: 'red', source: 'FRAG', msg: `Fragility critical (${fragility}/100) — concentration risk` })
  else if (fragility >= FRAGILITY_ELEVATED)
    all.push({ level: 'orange', source: 'FRAG', msg: `Fragility elevated (${fragility}/100) — concentration risk` })

  if (tx?.niit_applies)
    all.push({ level: 'orange', source: 'TAX', msg: `NIIT applies — ${((tx.niit_rate ?? 0.038) * 100).toFixed(1)}% on net investment income above threshold` })

  if (tx?.bracket_status === 'CRITICAL' || tx?.final_bracket_status === 'CRITICAL')
    all.push({ level: 'red', source: 'TAX', msg: 'Bracket status CRITICAL — income pace exceeding target ceiling' })

  if ((data.income_summary?.actual_conversion ?? 0) > (data.income_summary?.full_year_conversion ?? 0)
      && (data.income_summary?.full_year_conversion ?? 0) > 0)
    all.push({ level: 'orange', source: 'CONV', msg: 'Roth conversion YTD exceeds annual target' })

  // Dedup by message (different sources can surface the same condition),
  // then sort most severe first.
  const seen = new Set<string>()
  return all
    .filter(a => { if (seen.has(a.msg)) return false; seen.add(a.msg); return true })
    .sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9))
}

/** Count of actionable alerts (red + orange). Yellow/green are informational. */
export function unifiedAlertCount(alerts: UnifiedAlert[]): { total: number; critical: number; warning: number } {
  const critical = alerts.filter(a => a.level === 'red').length
  const warning = alerts.filter(a => a.level === 'orange').length
  return { total: alerts.length, critical, warning }
}
