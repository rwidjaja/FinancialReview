/**
 * AI chat-context builder + suggestion library.
 *
 * Extracted from AITab.tsx to keep that file under ~600 lines. Pure data:
 * no React, no JSX, no hooks. Reads DashboardData + WellnessData and
 * produces (a) the formatted plain-text context shipped with every AI
 * query, and (b) the suggestion-chip groups shown in the sidebar.
 */

import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import type { DashboardData, WellnessData } from '../../types/dashboard'

// ── Context builder (formatted text, matching V1 quality) ─────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function buildTextContext(data: DashboardData, wellness?: WellnessData): string {
  const { summary, accounts, portfolio_intel: pi, tax_data: tx, income_history: ih,
          income_analytics: ia, snapshots, decisions, spending_intelligence: si,
          vix_current, vix_90d_avg, correlation,
          market_context: mc, decision_strip, fund_configs,
          alerts, income_summary: is_, roth_conversions,
          roth_target_analysis, taxable_target_analysis } = data
  const lines: string[] = []

  // ── Portfolio totals ──────────────────────────────────────────────────
  lines.push('=== PORTFOLIO SUMMARY ===')
  lines.push(`Total Value: $${fmt(summary.total_value)}`)
  lines.push(`Total Cost Basis: $${fmt(summary.total_cost)}`)
  const pnlSign = summary.total_pnl >= 0 ? '+' : '-'
  lines.push(`Unrealized P&L: ${pnlSign}$${fmt(Math.abs(summary.total_pnl))} (${pnlSign}${Math.abs(summary.total_pnl_pct).toFixed(2)}%)`)
  lines.push(`Annual Portfolio Income (TTM): $${fmt(summary.total_income)}`)
  if (ia) lines.push(`Forward 12M Income (projected): $${fmt(ia.portfolio_fwd_12m)}`)
  if (vix_current != null) lines.push(`VIX: ${vix_current.toFixed(2)}${vix_90d_avg != null ? ` (90d avg ${vix_90d_avg.toFixed(2)})` : ''}`)

  // ── Market benchmarks ─────────────────────────────────────────────────
  if (mc) {
    lines.push('')
    lines.push('=== MARKET BENCHMARKS ===')
    Object.entries(mc).forEach(([name, idx]) => {
      lines.push(`${name}: $${fmt(idx.price)} | Mom20d ${idx.momentum_20d >= 0 ? '+' : ''}${(idx.momentum_20d * 100).toFixed(1)}% | Trend90d ${idx.trend_90d >= 0 ? '+' : ''}${(idx.trend_90d * 100).toFixed(1)}% | 1Y Return ${idx.total_return_1y >= 0 ? '+' : ''}${(idx.total_return_1y * 100).toFixed(1)}%`)
    })
  }

  // ── Market intelligence ───────────────────────────────────────────────
  if (pi) {
    lines.push('')
    lines.push('=== MARKET INTELLIGENCE ===')
    lines.push(`Market Regime: ${pi.market_regime}`)
    lines.push(`Volatility Regime: ${pi.vol_regime}`)
    lines.push(`Positioning: ${pi.positioning}`)
    lines.push(`System Confidence: ${pi.system_confidence_score?.toFixed(0) ?? '—'}/100 (${pi.system_confidence_label})`)
    lines.push(`Fragility: ${pi.fragility_score?.toFixed(0) ?? '—'}/100 (${pi.fragility_level})`)
    lines.push(`Weighted Beta: ${pi.weighted_beta?.toFixed(2) ?? '—'}`)
    lines.push(`Income Durability: ${pi.income_durability_score?.toFixed(0) ?? '—'}/100 (${pi.inc_stability_lbl})`)
    lines.push(`Vol Budget Used: ${pi.vol_budget_used.toFixed(1)}% | Risk Budget: ${pi.risk_budget_label}`)
    lines.push(`Allocation: Tech/Growth ${pi.tech_growth_pct?.toFixed(1)}% | Income ${pi.income_pct?.toFixed(1)}% | Defensive ${pi.defensive_pct?.toFixed(1)}%`)
    if (pi.top_risks?.length) {
      lines.push('Top Risks:')
      pi.top_risks.slice(0, 5).forEach(r => lines.push(`  [${r.level.toUpperCase()}] ${r.msg}`))
    }
    if (pi.top_opportunities?.length) {
      lines.push('Top Opportunities:')
      pi.top_opportunities.slice(0, 3).forEach(o => lines.push(`  ${o.msg}`))
    }
    if (pi.watchlist?.length) {
      lines.push('Watchlist:')
      pi.watchlist.slice(0, 5).forEach(w => lines.push(`  [${w.priority.toUpperCase()}] ${w.msg}`))
    }
    // Stress tests
    lines.push(`Stress Test — QQQ -20%: ${pnlSign}$${fmt(Math.abs(pi.stress_qqq_dollar))} (${pi.stress_qqq_pct?.toFixed(1)}%)`)
    lines.push(`Stress Test — VIX spike: ${pnlSign}$${fmt(Math.abs(pi.stress_vix_dollar))} (${pi.stress_vix_pct?.toFixed(1)}%)`)
  }

  // ── Per-account summary ───────────────────────────────────────────────
  lines.push('')
  lines.push('=== ACCOUNTS ===')
  accounts.forEach(a => {
    const pSign = a.pnl >= 0 ? '+' : '-'
    const fwd = ia?.by_account?.[a.key]?.fwd_12m
    lines.push(`${a.label}: $${fmt(a.value)} | Cost $${fmt(a.cost)} | P&L ${pSign}$${fmt(Math.abs(a.pnl))} (${pSign}${Math.abs(a.pnl_pct).toFixed(2)}%) | TTM Income $${fmt(a.income)}/yr${fwd != null ? ` | Fwd12M $${fmt(fwd)}/yr` : ''} | YTD Received $${fmt(a.ytd_income_actual ?? 0)}`)
  })

  // ── All positions ─────────────────────────────────────────────────────
  lines.push('')
  lines.push('=== POSITIONS BY ACCOUNT ===')
  const allPos: Array<{ symbol: string; value: number; cost: number; pnl: number; pnlPct: number; shares: number; income: number; account: string }> = []
  accounts.forEach(a => {
    lines.push(`\n[${a.label}]`)
    a.positions.forEach(pos => {
      const pSign = pos.pnl >= 0 ? '+' : '-'
      const ytdR = pos.ytd_received != null ? ` | YTD Rcvd $${fmt(pos.ytd_received)}` : ''
      lines.push(`  ${pos.symbol} (${pos.fund_type}): ${pos.shares.toFixed(3)} sh = $${fmt(pos.value)} | Cost $${fmt(pos.cost)} | ${pSign}$${fmt(Math.abs(pos.pnl))} (${pSign}${Math.abs(pos.pnl_pct).toFixed(1)}%) | Income $${fmt(pos.annual_income)}/yr${ytdR}`)
      allPos.push({ symbol: pos.symbol, value: pos.value, cost: pos.cost, pnl: pos.pnl, pnlPct: pos.pnl_pct, shares: pos.shares, income: pos.annual_income, account: a.label })
    })
  })

  // ── Cost basis lots (purchase history) ───────────────────────────────
  if (tx?.cost_basis_lots && Object.keys(tx.cost_basis_lots).length) {
    lines.push('')
    lines.push('=== COST BASIS LOTS (PURCHASE HISTORY) ===')
    Object.entries(tx.cost_basis_lots).forEach(([sym, cbs]) => {
      lines.push(`\n${sym} [${cbs.account}] — STCG: ${cbs.stcg_shares.toFixed(0)} sh / $${fmt(cbs.stcg_gain)} gain | LTCG: ${cbs.ltcg_shares.toFixed(0)} sh / $${fmt(cbs.ltcg_gain)} gain`)
      cbs.lots.forEach(lot => {
        const gSign = lot.gain_loss >= 0 ? '+' : '-'
        const term = lot.is_ltcg ? 'LT' : `ST(${lot.days_to_lt}d to LT)`
        lines.push(`  Acquired ${lot.acquired_date}: ${lot.quantity.toFixed(0)} sh @ $${lot.cost_per_share.toFixed(2)}/sh | Cost $${fmt(lot.cost_basis)} | MV $${fmt(lot.market_value)} | G/L ${gSign}$${fmt(Math.abs(lot.gain_loss))} (${gSign}${Math.abs(lot.gain_loss_pct).toFixed(1)}%) [${term}]`)
      })
    })
  }

  // ── Top holdings ─────────────────────────────────────────────────────
  lines.push('')
  lines.push('=== TOP HOLDINGS (by value) ===')
  const sorted = [...allPos].sort((a, b) => b.value - a.value)
  sorted.slice(0, 15).forEach((pos, i) => {
    const pct = summary.total_value > 0 ? (pos.value / summary.total_value * 100) : 0
    const pSign = pos.pnl >= 0 ? '+' : '-'
    lines.push(`${i + 1}. ${pos.symbol}: $${fmt(pos.value)} (${pct.toFixed(1)}%) | ${pSign}$${fmt(Math.abs(pos.pnl))} (${pSign}${Math.abs(pos.pnlPct).toFixed(1)}%) [${pos.account}]`)
  })

  // ── Income analytics (forward projections) ────────────────────────────
  if (ia) {
    lines.push('')
    lines.push('=== INCOME ANALYTICS (FORWARD PROJECTIONS) ===')
    lines.push(`Portfolio Forward 12M: $${fmt(ia.portfolio_fwd_12m)}`)
    if (ia.target_income > 0) lines.push(`Income Target: $${fmt(ia.target_income)}`)
    if (ia.income_gap != null) {
      const gapSign = ia.income_gap <= 0 ? '+' : '-'
      lines.push(`Income Gap vs Target: ${gapSign}$${fmt(Math.abs(ia.income_gap))} (${ia.income_gap <= 0 ? 'surplus' : 'deficit'})`)
    }
    if (ia.projected_eoy != null) lines.push(`Projected EOY Income: $${fmt(ia.projected_eoy)}`)
    if (ia.income_growth_rate != null) lines.push(`Income Growth Rate: ${(ia.income_growth_rate * 100).toFixed(1)}%/yr`)
    if (ia.avg_quality_score != null) lines.push(`Avg Quality Score: ${ia.avg_quality_score.toFixed(0)}/100`)
    if (ia.ceiling_gap != null) lines.push(`Ceiling Gap (bracket headroom): $${fmt(ia.ceiling_gap)}`)
    if (ia.ceiling_over != null) lines.push(`Ceiling Overage: $${fmt(ia.ceiling_over)} OVER`)
    if (ia.months_to_ceiling != null) lines.push(`Months to Bracket Ceiling: ${ia.months_to_ceiling.toFixed(1)}`)
    if (ia.forward_tax_impact != null) lines.push(`Forward Tax Impact: $${fmt(ia.forward_tax_impact as unknown as number)}`)
    if (ia.yield_pct != null) lines.push(`Portfolio Yield (Fwd 12M): ${ia.yield_pct.toFixed(2)}%`)
    if (ia.lifestyle_status) {
      lines.push(`Lifestyle Income Status: ${ia.lifestyle_status}`)
      if (ia.lifestyle_target_min != null) lines.push(`Lifestyle Target: $${fmt(ia.lifestyle_target_min)} – $${fmt(ia.lifestyle_target_max ?? 0)}/yr`)
      if (ia.lifestyle_gap_min != null && ia.lifestyle_gap_min > 0) lines.push(`Lifestyle Gap (to min target): $${fmt(ia.lifestyle_gap_min)}`)
    }
    if (ia.ceiling_drift_trend) lines.push(`Ceiling Drift Trend: ${ia.ceiling_drift_trend}`)
    if (ia.conversion_window) lines.push(`Conversion Window: ${ia.conversion_window}`)
    // Top income contributors
    const top5 = ((ia.income_attribution as unknown as Record<string, unknown>)?.['top5'] as [string, number][] | undefined)
    if (top5?.length) {
      lines.push('Top Income Contributors:')
      top5.slice(0, 8).forEach(([sym, pct], i) => lines.push(`  ${i + 1}. ${sym}: ${pct.toFixed(1)}%`))
    }
    // Per-account forward 12M
    if (ia.by_account && Object.keys(ia.by_account).length) {
      lines.push('Forward 12M by Account:')
      Object.entries(ia.by_account).forEach(([key, d]) => {
        const acct = accounts.find(a => a.key === key)
        lines.push(`  ${acct?.label ?? key}: $${fmt(d.fwd_12m)}/yr | YTD Income $${fmt(d.ytd_income)}`)
      })
    }
  }

  // ── Income summary (actual vs expected vs projected) ─────────────────
  if (is_) {
    lines.push('')
    lines.push('=== INCOME SUMMARY (ACTUAL vs EXPECTED) ===')
    lines.push(`Actual YTD — W2: $${fmt(is_.actual_w2)} | Dividends: $${fmt(is_.actual_div_total)} (Taxable $${fmt(is_.actual_div_taxable)} / Non-taxable $${fmt(is_.actual_div_nontaxable)}) | STCG: $${fmt(is_.actual_stcg)} | LTCG: $${fmt(is_.actual_ltcg)} | Conversion: $${fmt(is_.actual_conversion)} | Taxable Total: $${fmt(is_.actual_taxable_income)}`)
    if (Object.keys(is_.actual_div_by_acct).length) {
      lines.push('  Actual Div by Account: ' + Object.entries(is_.actual_div_by_acct).map(([k, v]) => `${k}: $${fmt(v)}`).join(' | '))
    }
    lines.push(`Expected YTD — W2: $${fmt(is_.expected_w2)} | Dividends: $${fmt(is_.expected_div_total)} | Taxable Income: $${fmt(is_.expected_taxable_income)}`)
    lines.push(`Full-Year Projected — W2: $${fmt(is_.full_year_w2)} | Dividends: $${fmt(is_.full_year_div)} (Taxable $${fmt(is_.full_year_div_taxable)}) | Conversion: $${fmt(is_.full_year_conversion)} | Total: $${fmt(is_.full_year_total)}`)
    lines.push(`Pay Periods: ${is_.pay_periods_elapsed} elapsed / ${is_.pay_periods_remaining} remaining | Avg paycheck: $${fmt(is_.avg_paycheck)}`)
  }

  // ── Income / dividends (history) ──────────────────────────────────────
  if (ih) {
    lines.push('')
    lines.push('=== INCOME RECEIVED (YTD HISTORY) ===')
    lines.push(`YTD Dividend Income: $${fmt(ih.ytd_total)}`)
    const byAcct = ih.by_account ?? {}
    Object.entries(byAcct).forEach(([acct, d]) => {
      if (d && d.total > 0) {
        lines.push(`  ${acct}: $${fmt(d.total)}`)
        // Top symbols in this account
        const topSyms = Object.entries(d.by_symbol ?? {})
          .sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 5)
        topSyms.forEach(([sym, amt]) => lines.push(`    ${sym}: $${fmt(amt as number)}`))
      }
    })
    // Monthly trend (last 12)
    const allTx = ih.transactions ?? []
    const monthTotals: Record<string, number> = {}
    allTx.forEach(t => {
      const m = t.date.slice(0, 7)
      monthTotals[m] = (monthTotals[m] ?? 0) + t.amount
    })
    const months = Object.entries(monthTotals).sort(([a], [b]) => a.localeCompare(b)).slice(-12)
    if (months.length) {
      lines.push('Monthly trend (last 12): ' + months.map(([m, v]) => `${m}: $${fmt(v)}`).join(' | '))
    }
    // Recent transactions (last 10)
    const recentTx = [...allTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)
    if (recentTx.length) {
      lines.push('Recent transactions:')
      recentTx.forEach(t => lines.push(`  ${t.date} | ${t.symbol} | ${t.account ?? t.type} | $${fmt(t.amount)}${t.qualified != null ? (t.qualified ? ' (qualified)' : ' (ordinary)') : ''}`))
    }
  }

  // ── Tax planning ──────────────────────────────────────────────────────
  if (tx) {
    lines.push('')
    lines.push('=== TAX PLANNING ===')
    if (tx.filing_status)               lines.push(`Filing Status: ${tx.filing_status}`)
    if (tx.gross_no_ss != null)          lines.push(`Gross Income ex-SS: $${fmt(tx.gross_no_ss)}`)
    if (tx.agi_real != null)             lines.push(`Actual AGI: $${fmt(tx.agi_real)}`)
    if (tx.full_year_agi_estimate != null) lines.push(`Full-Year AGI Estimate: $${fmt(tx.full_year_agi_estimate)}`)
    if (tx.marginal_rate != null)        lines.push(`Marginal Rate: ${(tx.marginal_rate * 100).toFixed(1)}%`)
    if (tx.eff_rate_no_ss != null)       lines.push(`Effective Rate (ex-SS): ${tx.eff_rate_no_ss.toFixed(1)}%`)
    if (tx.eff_rate_with_ss != null)     lines.push(`Effective Rate (with SS): ${tx.eff_rate_with_ss.toFixed(1)}%`)
    // Dividends
    if (tx.annual_div_total > 0) {
      lines.push(`Annual Dividends: $${fmt(tx.annual_div_total)} | Qualified $${fmt(tx.total_qualified_div)} | Ordinary $${fmt(tx.total_ordinary_div)} | RoC $${fmt(tx.total_roc_div)}`)
      if (tx.qualified_div_rate != null) lines.push(`Qualified Div Rate: ${(tx.qualified_div_rate * 100).toFixed(0)}%`)
    }
    // Bracket info
    if (tx.target_bracket_ceiling != null) lines.push(`${tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}% Bracket Ceiling: $${fmt(tx.target_bracket_ceiling)}`)
    if (tx.conv_room_real != null)        lines.push(`Bracket Room Remaining: $${fmt(tx.conv_room_real)}`)
    // Tax Rule Engine
    if (tx.income_bracket_target != null) lines.push(`Tax Rule Engine Target: $${fmt(tx.income_bracket_target)}`)
    if (tx.bracket_room != null)          lines.push(`Engine Bracket Room: $${fmt(tx.bracket_room)}`)
    if (tx.bracket_pace_pct != null)      lines.push(`Bracket Pace: ${(tx.bracket_pace_pct * 100).toFixed(1)}% of ceiling used YTD`)
    if (tx.bracket_status != null)        lines.push(`Bracket Status: ${tx.bracket_status}`)
    if (tx.soft_limit != null)            lines.push(`Soft Limit: $${fmt(tx.soft_limit)} | Room: $${fmt(tx.soft_limit_room ?? 0)}`)
    if (tx.final_bracket_status != null)  lines.push(`Final Engine Status: ${tx.final_bracket_status} — ${tx.final_bracket_msg ?? ''}`)
    // NIIT
    if (tx.niit_applies != null) {
      if (tx.niit_applies) {
        lines.push(`NIIT (${((tx.niit_rate ?? 0.038) * 100).toFixed(1)}%): APPLIES — Est. $${fmt(tx.niit_amount ?? 0)} | MAGI $${fmt(tx.gross_no_ss ?? 0)} over threshold $${fmt(tx.niit_threshold ?? 0)}`)
      } else {
        lines.push(`NIIT (${((tx.niit_rate ?? 0.038) * 100).toFixed(1)}%): CLEAR — Headroom $${fmt(tx.niit_headroom ?? 0)} before $${fmt(tx.niit_threshold ?? 0)} threshold`)
      }
    }
    // Conversions
    if (tx.converted_ytd != null)         lines.push(`Roth Conversions YTD: $${fmt(tx.converted_ytd)}`)
    if (tx.remaining_to_convert != null)  lines.push(`Remaining to Convert: $${fmt(tx.remaining_to_convert)}`)
    const convTarget = tx.dynamic_conv_recommended ?? tx.optimal_conv ?? tx.annual_conversion
    if (convTarget != null)               lines.push(`Recommended Conversion: $${fmt(convTarget)}`)
    if (tx.dynamic_conv_conservative != null) lines.push(`  Conservative: $${fmt(tx.dynamic_conv_conservative)} | Aggressive: $${fmt(tx.dynamic_conv_aggressive ?? 0)}`)
    lines.push(`Conversion Score: ${tx.conv_score}/100 — ${tx.conv_action}`)
    // Quarterly estimates
    if (tx.quarterly_payments?.length) {
      lines.push('Quarterly Tax Estimates:')
      tx.quarterly_payments.forEach(q => lines.push(`  ${q.quarter} (due ${q.due_label}): $${fmt(q.payment)} | Div income $${fmt(q.div_income)}${q.is_conv_quarter ? ` | Conv $${fmt(q.conv_portion)}` : ''}`))
    }
  }

  // ── Roth conversion candidates ────────────────────────────────────────
  if (roth_conversions?.length) {
    lines.push('')
    lines.push('=== ROTH CONVERSION CANDIDATES ===')
    roth_conversions.forEach(rc => {
      const premStr = rc.premium != null ? ` | Prem/Disc ${rc.premium >= 0 ? '+' : ''}${rc.premium.toFixed(2)}%` : ''
      lines.push(`  ${rc.symbol}: ${rc.shares.toFixed(3)} sh @ $${rc.price.toFixed(2)}${rc.nav != null ? ` (NAV $${rc.nav.toFixed(2)})` : ''}${premStr} | ${rc.status} — ${rc.recommendation}`)
    })
  }

  // ── Target allocation analysis ────────────────────────────────────────
  if (roth_target_analysis?.length) {
    lines.push('')
    lines.push('=== TARGET ALLOCATION — ROTH ===')
    roth_target_analysis.forEach(t => {
      const gap = t.gap_pct >= 0 ? `+${t.gap_pct.toFixed(1)}%` : `${t.gap_pct.toFixed(1)}%`
      const dolStr = t.conv_dollars != null ? ` | Conv needed $${fmt(t.conv_dollars)}` : ''
      lines.push(`  ${t.symbol}: Target ${(t.target_weight * 100).toFixed(1)}% | Actual ${(t.current_weight * 100).toFixed(1)}% | Gap ${gap}${t.action ? ` | ${t.action}` : ''}${dolStr}`)
    })
  }
  if (taxable_target_analysis?.length) {
    lines.push('')
    lines.push('=== TARGET ALLOCATION — TAXABLE ===')
    taxable_target_analysis.forEach(t => {
      const gap = t.gap_pct >= 0 ? `+${t.gap_pct.toFixed(1)}%` : `${t.gap_pct.toFixed(1)}%`
      const dolStr = t.conv_dollars != null ? ` | Buy needed $${fmt(t.conv_dollars)}` : ''
      lines.push(`  ${t.symbol}: Target ${(t.target_weight * 100).toFixed(1)}% | Actual ${(t.current_weight * 100).toFixed(1)}% | Gap ${gap}${t.action ? ` | ${t.action}` : ''}${dolStr}`)
    })
  }

  // ── Social Security & projections ─────────────────────────────────────
  if (tx) {
    lines.push('')
    lines.push('=== SOCIAL SECURITY & PROJECTIONS ===')
    lines.push(`Current Age: ${tx.current_age} | SS Start Age: ${tx.ss_start_age}${tx.ss_years_until != null ? ` (${tx.ss_years_until.toFixed(1)} years away)` : ''}`)
    lines.push(`SS Annual Benefit: $${fmt(tx.ss_annual)}/yr`)
    if (tx.spouse_name && tx.spouse_age != null) lines.push(`Spouse: ${tx.spouse_name}, age ${tx.spouse_age} | SS start age ${tx.spouse_ss_start_age ?? '—'}`)
    if (tx.gross_with_ss != null)    lines.push(`Gross Income with SS: $${fmt(tx.gross_with_ss)}`)
    if (tx.tax_with_ss != null)      lines.push(`Tax with SS: $${fmt(tx.tax_with_ss)} (${tx.eff_rate_with_ss?.toFixed(1) ?? '—'}% eff rate)`)
    if (tx.ss_taxable_pct != null)   lines.push(`SS Taxable Portion: ${(tx.ss_taxable_pct * 100).toFixed(0)}%`)
    // Projection highlights (recommended scenario, first 5 years + age 75/85/target)
    if (tx.projections_recommended?.length) {
      lines.push('Projection (recommended scenario):')
      const key_years = tx.projections_recommended.filter(r => r.age <= (tx.current_age + 5) || [75, 80, 85, tx.target_age].includes(r.age))
      key_years.slice(0, 10).forEach(r => {
        const tag = r.is_actual ? ' [actual]' : r.ss_prorated ? ' [SS partial]' : r.has_ss ? ' [SS]' : ''
        lines.push(`  Age ${r.age} (${r.year}): Gross $${fmt(r.gross_income)} | Tax $${fmt(r.federal_tax)} (${(r.effective_rate * 100).toFixed(1)}%) | Conv $${fmt(r.conversion)} | Rollover $${fmt(r.rollover_value)} | Roth $${fmt(r.roth_value)}${tag}`)
      })
    }
  }

  // ── Withdrawal strategy ───────────────────────────────────────────────
  if (tx?.withdrawal_states) {
    lines.push('')
    lines.push('=== WITHDRAWAL STRATEGY ===')
    lines.push(`Current State: ${tx.withdrawal_current_state ?? '—'} (server-computed ANY_TWO logic)`)
    lines.push(`Gain ratio: ${tx.withdrawal_gain_ratio != null ? (tx.withdrawal_gain_ratio * 100).toFixed(1) + '%' : '—'} | A→B threshold: ${((tx.withdrawal_state_ab_gain_ratio ?? 0.30) * 100).toFixed(0)}% ($${fmt(tx.withdrawal_state_ab_threshold)}) | B→C threshold: ${((tx.withdrawal_state_bc_gain_ratio ?? 0.45) * 100).toFixed(0)}% ($${fmt(tx.withdrawal_state_bc_threshold)})`)
    lines.push(`Forced income ratio: ${tx.withdrawal_forced_income_ratio != null ? (tx.withdrawal_forced_income_ratio * 100).toFixed(0) + '%' : '—'} (income $${fmt(tx.withdrawal_forced_income_num ?? 0)} / spending $${fmt(tx.withdrawal_forced_income_denom ?? 0)}) — status: ${tx.withdrawal_forced_income_status ?? '—'}`)
    lines.push(`STCG ratio: ${tx.stcg_ratio != null ? (tx.stcg_ratio * 100).toFixed(1) + '%' : '—'} — ${tx.stcg_ratio_status ?? '—'}${tx.freeze_rebalance ? '  REBALANCE FROZEN' : ''}`)
    lines.push(`Concentration: top holding ${tx.concentration_top_pct != null ? (tx.concentration_top_pct * 100).toFixed(1) + '%' : '—'} — ${tx.concentration_status ?? '—'}${tx.concentration_freeze_buys ? ' | buys frozen' : ''}${tx.concentration_redirect_dividends ? ' | dividends redirected' : ''}`)
    lines.push(`Dividend Load Alert: $${fmt(tx.withdrawal_dividend_load_alert)}`)
    const ws = tx.withdrawal_states
    ;(['A', 'B', 'C'] as const).forEach(s => {
      const state = ws[s]
      if (state) lines.push(`  State ${s} — ${state.name}: ${state.description}`)
    })
  }

  // ── Spending intelligence ─────────────────────────────────────────────
  if (si?.available) {
    lines.push('')
    lines.push('=== SPENDING ===')
    lines.push(`True Annual Spending: $${fmt(si.true_annual_spending)}`)
    lines.push(`Core: $${fmt(si.core_spending)} (${(100 - si.discretionary_pct).toFixed(1)}%) | Non-Core: $${fmt(si.noncore_spending)} (${si.discretionary_pct.toFixed(1)}% discretionary)`)
    lines.push(`Lifestyle Phase: ${si.lifestyle_label} — ${si.lifestyle_note}`)
    if (si.spending_drift_pct != null) lines.push(`Spending Drift: ${si.spending_drift_pct >= 0 ? '+' : ''}${si.spending_drift_pct.toFixed(1)}% vs prior period`)
    if (si.monthly_stddev > 0) lines.push(`Monthly Volatility: $${fmt(si.monthly_stddev)} stddev (${si.cashflow_vol_pct.toFixed(1)}% of avg)`)
    if (si.shock_events?.length) lines.push(`Shock Events: ${si.shock_count} events`)
    // Extended: categories
    const siExt = si as typeof si & { categories?: Record<string, { is_core: boolean; annual: number; pct: number }> }
    if (siExt.categories && Object.keys(siExt.categories).length) {
      lines.push('Top Spending Categories:')
      Object.entries(siExt.categories)
        .sort(([, a], [, b]) => b.annual - a.annual).slice(0, 8)
        .forEach(([cat, c]) => lines.push(`  ${cat}: $${fmt(c.annual)}/yr (${c.pct.toFixed(1)}%) [${c.is_core ? 'core' : 'non-core'}]`))
    }
    // Calendar year summary
    const siExt2 = si as typeof si & { calendar_years?: Array<{ year: string; lifestyle: number; annualised: number; income: number; months: number }> }
    if (siExt2.calendar_years?.length) {
      lines.push('Spending by Calendar Year:')
      siExt2.calendar_years.slice(-4).forEach(y => lines.push(`  ${y.year}: $${fmt(y.lifestyle)} lifestyle / $${fmt(y.annualised)} annualized | Income $${fmt(y.income)} | ${y.months} months`))
    }
  }

  // ── Wellness / retirement metrics ─────────────────────────────────────
  if (wellness) {
    lines.push('')
    lines.push('=== WELLNESS / RETIREMENT METRICS ===')
    lines.push(`Net Worth: $${fmt(wellness.net_worth)}`)
    lines.push(`Portfolio Income: $${fmt(wellness.portfolio_income)}/yr`)
    lines.push(`Estimated Spending: $${fmt(wellness.estimated_spending)}/yr`)
    if (wellness.income_coverage_pct != null) lines.push(`Income Coverage: ${wellness.income_coverage_pct.toFixed(1)}%`)
    if (wellness.withdrawal_rate != null)     lines.push(`Withdrawal Rate: ${wellness.withdrawal_rate.toFixed(2)}%`)
    if (wellness.buffer_years != null)        lines.push(`Buffer Years: ${wellness.buffer_years.toFixed(1)} years`)
    lines.push(`Success Probability: ${wellness.overall_success.toFixed(0)}% (95% target: ${wellness.success_prob_95.toFixed(0)}% | 100% target: ${wellness.success_prob_100.toFixed(0)}%)`)
    lines.push(`Safe Spending: $${fmt(wellness.safe_spending)}/yr (${wellness.safe_spending_prob.toFixed(0)}% success)`)
    lines.push(`Comfortable Spending: $${fmt(wellness.comfortable_spending)}/yr`)
    lines.push(`Cashflow Surplus: ${wellness.cashflow_surplus >= 0 ? '+' : '-'}$${fmt(Math.abs(wellness.cashflow_surplus))}/yr`)
    lines.push(`Seq Risk: ${wellness.seq_risk_pct.toFixed(1)}% | Seq Penalty: ${wellness.seq_risk_penalty.toFixed(1)}%`)
    if (wellness.median_ending != null)       lines.push(`Median Portfolio at Target Age: $${fmt(wellness.median_ending)}`)
    if (wellness.ruin_threshold != null)      lines.push(`Ruin Threshold: $${fmt(wellness.ruin_threshold)}`)
  }

  // ── Snapshots / technicals ────────────────────────────────────────────
  const snapEntries = Object.entries(snapshots ?? {})
  if (snapEntries.length > 0) {
    lines.push('')
    lines.push('=== TECHNICAL SNAPSHOTS ===')
    snapEntries.slice(0, 20).forEach(([sym, snap]) => {
      const parts: string[] = []
      if (snap.price != null)           parts.push(`Price $${snap.price.toFixed(2)}${snap.price_change_pct != null ? ` (${snap.price_change_pct >= 0 ? '+' : ''}${(snap.price_change_pct * 100).toFixed(2)}% today)` : ''}`)
      if (snap.nav != null && snap.nav !== snap.price) parts.push(`NAV $${snap.nav.toFixed(2)}`)
      if (snap.rsi_14 != null)          parts.push(`RSI ${snap.rsi_14.toFixed(1)}`)
      if (snap.trend_90d != null)       parts.push(`Trend90d ${snap.trend_90d >= 0 ? '+' : ''}${(snap.trend_90d * 100).toFixed(1)}%`)
      if (snap.momentum_20d != null)    parts.push(`Mom20d ${snap.momentum_20d >= 0 ? '+' : ''}${(snap.momentum_20d * 100).toFixed(1)}%`)
      if (snap.ttm_yield != null)       parts.push(`Yield ${(snap.ttm_yield * 100).toFixed(2)}%`)
      if (snap.premium != null)         parts.push(`Prem/Disc ${snap.premium >= 0 ? '+' : ''}${snap.premium.toFixed(2)}%`)
      if (snap.total_return_1y != null) parts.push(`1Y ${(snap.total_return_1y * 100).toFixed(1)}%`)
      if (snap.benchmark_return_1y != null) parts.push(`Bench1Y ${(snap.benchmark_return_1y * 100).toFixed(1)}%`)
      if (snap.relative_return_1y != null) parts.push(`vs Bench ${snap.relative_return_1y >= 0 ? '+' : ''}${(snap.relative_return_1y * 100).toFixed(1)}%`)
      if (snap.vol_30d_annual != null)  parts.push(`Vol ${(snap.vol_30d_annual * 100).toFixed(1)}%`)
      if (snap.beta != null)            parts.push(`Beta ${snap.beta.toFixed(2)}`)
      if (snap.coverage_ratio != null)  parts.push(`Coverage ${snap.coverage_ratio.toFixed(2)}x`)
      if (snap.distribution_cut_pct != null) parts.push(`DistCut ${snap.distribution_cut_pct.toFixed(1)}%`)
      if (snap.max_drawdown_6m != null) parts.push(`MaxDD6m ${(snap.max_drawdown_6m * 100).toFixed(1)}%`)
      if (snap.aum != null)             parts.push(`AUM $${(snap.aum / 1e9).toFixed(2)}B`)
      if (snap.expense_ratio != null)   parts.push(`ER ${(snap.expense_ratio * 100).toFixed(2)}%`)
      if (parts.length) lines.push(`  ${sym}: ${parts.join(' | ')}`)
    })
  }

  // ── Correlation ───────────────────────────────────────────────────────
  if (correlation?.symbols?.length && correlation?.matrix?.length) {
    lines.push('')
    lines.push('=== CORRELATION MATRIX ===')
    lines.push(`Symbols: ${correlation.symbols.join(', ')}`)
    correlation.symbols.forEach((sym, i) => {
      const row = correlation.matrix[i] ?? []
      const pairs = correlation.symbols
        .map((s2, j) => j !== i ? `${s2}: ${(row[j] ?? 0).toFixed(2)}` : null)
        .filter(Boolean)
      lines.push(`  ${sym}: ${pairs.join(' | ')}`)
    })
  }

  // ── Fund decisions / alerts ───────────────────────────────────────────
  if (decisions?.length) {
    lines.push('')
    lines.push('=== FUND DECISIONS / ALERTS ===')
    decisions.slice(0, 15).forEach(d => {
      lines.push(`  [${d.overall}] ${d.symbol} (${d.structural_status}): ${d.summary}`)
    })
  }

  // ── Active alerts ─────────────────────────────────────────────────────
  if (alerts?.length) {
    lines.push('')
    lines.push('=== ACTIVE ALERTS ===')
    alerts.forEach(a => lines.push(`  [${a.level.toUpperCase()}] ${a.symbol}: ${a.message}`))
  }

  // ── Decision strip (action items) ────────────────────────────────────
  if (decision_strip?.length) {
    lines.push('')
    lines.push('=== RECOMMENDED ACTIONS ===')
    decision_strip.forEach(d => lines.push(`  [${d.level.toUpperCase()}] ${d.action}: ${d.text}`))
  }

  // ── Fund configs ──────────────────────────────────────────────────────
  if (fund_configs && Object.keys(fund_configs).length) {
    lines.push('')
    lines.push('=== FUND CONFIGS ===')
    Object.entries(fund_configs).forEach(([sym, cfg]) => {
      lines.push(`  ${sym}: ${cfg.FUND_TYPE} | ${cfg.DISTRIBUTION_FREQUENCY} distributions | Benchmark ${cfg.BENCHMARK}`)
    })
  }

  return lines.join('\n')
}

// ── Suggestion groups ────────────────────────────────────────────────────────

export const SUGGESTION_GROUPS = [
  {
    label: ' Analysis',
    items: [
      { label: 'Portfolio summary',    prompt: 'Give me a concise summary of my portfolio: total value, income, top risks, and one key action item.' },
      { label: '22% bracket room',     prompt: 'How much Roth conversion room do I have left this year before hitting the 22% bracket ceiling? Give me the exact dollar amount.' },
      { label: 'Top holdings',         prompt: 'What are my top 5 holdings by value, their % of portfolio, and how are they performing year to date?' },
      { label: 'Income breakdown',     prompt: 'Break down my projected annual income: which funds contribute most, and is my income pace on track vs my spending?' },
      { label: 'Risk check',           prompt: 'What are the top 3 risks in my portfolio right now and what should I do about each one?' },
      { label: 'Option ETF NAV',       prompt: 'Which of my option-income ETFs are trading at a discount to NAV and are worth adding to?' },
      { label: 'Roth conversion',      prompt: 'What is the optimal Roth conversion amount this year and which funds should I convert first?' },
      { label: 'Spending vs income',   prompt: 'Compare my true annual spending to my portfolio income. What is the coverage ratio and how many buffer years do I have?' },
    ],
  },
  {
    label: ' Charts',
    items: [
      { label: 'Holdings by value',    prompt: 'Bar chart of my top 10 holdings by market value.' },
      { label: 'Unrealized gain %',    prompt: 'Horizontal bar chart of unrealized gain percent by symbol, sorted by magnitude.' },
      { label: 'Monthly income',       prompt: 'Bar chart of my monthly dividend income for the last 12 months.' },
      { label: 'Account allocation',   prompt: 'Pie chart of portfolio allocation by account (Rollover, Roth, Taxable).' },
      { label: 'YTD performance',      prompt: 'Bar chart of YTD performance return by symbol, color-coded green/red.' },
    ],
  },
]
