import type { SectionMeta } from './types'

// Groups follow the Drawdown sub-tabs (the rail switches sub-tab when a section
// lives on another one). "Plan" holds the blocks above the sub-tab bar.
const P = 'Plan', D = 'Annual decision', W = 'Withdrawal schedule', T = 'Lifetime tax',
  S = 'Spending plan', L = 'Depletion and legacy', X = 'What-if sandbox', R = 'Risk', U = 'Summary'

export const sections: SectionMeta[] = [
  { id: 'dd_params', group: P, title: 'Plan parameters', keys: ['income target', 'inflation', 'plan horizon', 'Social Security', 'SS start age', 'bracket ceiling', 'expected return', 'dividend yield', 'qualified', 'RMD'] },
  { id: 'dd_checklist', group: P, title: 'Annual action plan', keys: ['action plan', 'checklist', 'action required', 'high priority', 'next review', 'Dynamic Bracket', 'MFJ'] },

  { id: 'dd_dec_overview', group: D, sub: 'decision', title: 'This year’s decision', keys: ['alerts', 'state action plan', 'controlled sale band', 'bucket refill', 'SWVXX', 'conversion positioning', 'tax-optimal', 'guaranteed income', 'income target gap', 'lifestyle gap', 'Roth conversion', 'STOP', 'include Roth conversions'] },
  { id: 'dd_income_flow', group: D, sub: 'decision', title: 'Income flow', adv: true, keys: ['dividends first', 'controlled sales', 'State A', 'State B', 'State C', 'income sources breakdown', 'waterfall', 'IRA dividends'] },
  { id: 'dd_withdrawal_rec', group: D, sub: 'decision', title: 'This year’s withdrawal recommendation', adv: true, keys: ['from taxable', 'from IRA', 'from Roth', 'Roth conversion', 'plan remaining', 'bracket headroom', 'LTCG', 'STCG', 'guaranteed income', 'income target gap'] },
  { id: 'dd_balance_impact', group: D, sub: 'decision', title: 'Year-end account balance impact', adv: true, keys: ['taxable', 'rollover IRA', 'Roth IRA', 'year-end balance', 'in-kind conversion', 'optional bracket-fill', 'conversion target', 'YTD converted'] },
  { id: 'dd_bracket', group: D, sub: 'decision', title: 'Tax and bracket position', adv: true, keys: ['bracket fill', 'bracket meter', 'MAGI breakdown', 'total MAGI', 'ordinary tax', 'LTCG / qualified', 'NIIT', 'RMD risk', 'conversion leverage', 'Roth opportunity', 'bracket headroom', 'bracket room', 'server data'] },
  { id: 'dd_irmaa', group: D, sub: 'decision', title: 'IRMAA — Medicare surcharge', adv: true, keys: ['IRMAA', 'Medicare', 'Part B', 'Part D', 'tier', 'surcharge', 'IRMAA headroom', 'crossover'] },
  { id: 'dd_niit', group: D, sub: 'decision', title: 'NIIT — net investment income tax', adv: true, keys: ['NIIT', 'NIIT status', 'NIIT amount', 'MAGI headroom', '3.8%', 'net investment income', 'data sources'] },

  { id: 'dd_opt_action_plan', group: W, sub: 'optimizer', title: 'This year’s action plan — live portfolio state', keys: ['cash bucket', 'SWVXX', 'cash sources', 'dividends', 'taxable sales', 'IRA / RMD', 'Roth conversion', 'Roth spending', 'quarterly payments', 'marginal rate', 'RMDs begin', 'taxable depletes', 'IRA depletes'] },
  { id: 'dd_withdrawal_table', group: W, sub: 'optimizer', title: 'Year-by-year withdrawal schedule', keys: ['age', 'dividends', 'taxable', 'IRA', 'conversion', 'Roth', 'bracket', 'eff rate', 'headroom', 'taxable bal', 'IRA bal', 'Roth bal', 'total'] },
  { id: 'dd_balance_trajectory', group: W, sub: 'optimizer', title: 'Account balance trajectory', adv: true, keys: ['account balances over time', 'taxable', 'rollover', 'Roth', 'withdrawal sources by year', 'Divs'] },
  { id: 'dd_strategy_compare', group: W, sub: 'optimizer', title: 'Why Dynamic Bracket — strategy comparison', adv: true, keys: ['strategy', 'lifetime tax', 'vs Dynamic Bracket', 'ending wealth', 'Roth preserved', 'survives plan', 'your plan'] },

  { id: 'dd_tax_summary', group: T, sub: 'tax', title: 'Tax strategy summary and key future events', keys: ['saves vs worst', 'avg eff rate', 'Dynamic Bracket optimal', 'key future events', 'Social Security starts', 'RMDs begin', 'IRA depletes', 'bracket drift begins'] },
  { id: 'dd_tax_why', group: T, sub: 'tax', title: 'Why Dynamic Bracket wins', keys: ['converts IRA early', 'avoids 32%+ bracket', 'RMD spike impact', 'more Roth assets', 'worst alternative'] },
  { id: 'dd_tax_strategies', group: T, sub: 'tax', title: 'Lifetime tax by strategy', keys: ['lifetime taxes', 'avg eff rate', 'lowest taxes', 'taxable first', 'IRA first', 'Roth last', 'proportional', 'Dynamic Bracket'] },
  { id: 'dd_annual_tax', group: T, sub: 'tax', title: 'Annual tax breakdown', adv: true, keys: ['ordinary income tax', 'LTCG tax', 'SS start', 'RMD onset', 'annual tax'] },
  { id: 'dd_bracket_drift', group: T, sub: 'tax', title: 'Bracket drift — effective rate vs marginal rate', adv: true, keys: ['bracket drift', 'effective rate', 'marginal rate', 'top bracket', '22%', '24%'] },
  { id: 'dd_tax_table', group: T, sub: 'tax', title: 'Year-by-year tax detail', adv: true, keys: ['age', 'ord income', 'taxable inc', 'ord tax', 'LTCG tax', 'total tax', 'eff rate', 'bracket'] },

  { id: 'dd_ssr_concepts', group: S, sub: 'guardrails', title: 'Lifestyle spending vs income target', adv: true, keys: ['lifestyle spending', 'income target', 'withdrawal rate', 'underspending', 'recommended baseline', 'floor', 'ceiling'] },
  { id: 'dd_ssr_tiers', group: S, sub: 'guardrails', title: 'Safe spending range', adv: true, keys: ['conservative', 'moderate', 'maximum', 'success rate', 'SS two-phase', 'plan horizon', 'portfolio survives', 'ending wealth ratio', 'shortfall years'] },
  { id: 'dd_spending_coverage', group: S, sub: 'guardrails', title: 'Spending coverage — met vs shortfall', adv: true, keys: ['spending met', 'shortfall', 'conservative', 'moderate', 'maximum', 'inflation'] },
  { id: 'dd_guardrail_summary', group: S, sub: 'guardrails', title: 'Spending guardrails', adv: true, keys: ['Guyton-Klinger', 'guardrails', 'SSR foundation', 'initial portfolio', 'upper guardrail', 'lower guardrail', 'current status', 'rollover IRA', 'spendable portfolio'] },
  { id: 'dd_guardrail_params', group: S, sub: 'guardrails', title: 'Guardrail parameters', adv: true, keys: ['trigger thresholds', 'upper guardrail', 'lower guardrail', 'raise %', 'cut %', 'ceiling', 'floor'] },
  { id: 'dd_guardrail_portfolio', group: S, sub: 'guardrails', title: 'Portfolio vs guardrail corridors', adv: true, keys: ['portfolio', 'upper rail', 'lower rail', 'corridor'] },
  { id: 'dd_guardrail_spending', group: S, sub: 'guardrails', title: 'Guardrail-adaptive vs fixed spending', adv: true, keys: ['adaptive spending', 'fixed spending', 'spending range', 'first raise', 'min', 'max'] },
  { id: 'dd_guardrail_table', group: S, sub: 'guardrails', title: 'Year-by-year guardrail status', adv: true, keys: ['% of initial', 'upper rail', 'lower rail', 'status', 'spending/yr', 'real $', 'action', 'upper guardrail crossed', 'lower guardrail crossed'] },

  { id: 'dd_lon_questions', group: L, sub: 'longevity', title: 'Will I run out of money?', keys: ['run out', 'IRA disappear', 'what remains', 'ending total', 'Roth', 'do not withdraw from Roth', 'strategies overlap'] },
  { id: 'dd_depletion_ages', group: L, sub: 'longevity', title: 'Account depletion ages', adv: true, keys: ['depletion', 'taxable', 'rollover IRA', 'Roth IRA', 'total', 'intentional', 'dominant'] },
  { id: 'dd_total_trajectory', group: L, sub: 'longevity', title: 'Portfolio total — all strategies', adv: true, keys: ['portfolio total', 'all strategies', 'rollover depletes by design', 'RMD age'] },
  { id: 'dd_roth_legacy', group: L, sub: 'longevity', title: 'Roth IRA legacy at end of plan', adv: true, keys: ['Roth IRA legacy', 'end of plan horizon', 'Roth preserved', 'tax-free legacy'] },
  { id: 'dd_depletion_schedule', group: L, sub: 'longevity', title: 'Dividend-aware depletion schedule', adv: true, keys: ['depletion schedule', 'withdrawal', 'NAV growth', 'dividend growth', 'solve', 'end balance', 'yield'] },

  { id: 'dd_sandbox_impact', group: X, sub: 'sandbox', title: 'Plan impact summary', keys: ['plan impact', 'annual decision', 'Roth conversion', 'SS impact', 'lifetime SS income', 'scenario'] },
  { id: 'dd_sandbox_controls', group: X, sub: 'sandbox', title: 'Scenario controls', keys: ['bear case', 'early retire', 'inflation shock', 'portfolio shock', 'spending delta', 'return', 'inflation', 'SS start age', 'horizon'] },
  { id: 'dd_sandbox_outcomes', group: X, sub: 'sandbox', title: 'Baseline vs scenario outcomes', keys: ['baseline', 'scenario', 'best longevity strategy', 'best tax strategy', 'ending total', 'lifetime taxes', 'depletes at', 'Roth preserved'] },
  { id: 'dd_sandbox_chart', group: X, sub: 'sandbox', title: 'Portfolio total — baseline vs scenario', keys: ['portfolio total', 'baseline', 'scenario', 'chart'] },

  { id: 'dd_risk_overview', group: R, sub: 'risk', title: 'Risk dashboard', keys: ['risk dashboard', 'risk dimensions', 'stress test', 'rating'] },
  { id: 'dd_risk_concentration', group: R, sub: 'risk', title: 'Concentration risk', keys: ['concentration', 'top 5 positions', 'weight', 'trim'] },
  { id: 'dd_risk_sequence', group: R, sub: 'risk', title: 'Sequence-of-returns risk', keys: ['sequence risk', 'bad start', 'early bear market', 'cash bucket'] },
  { id: 'dd_risk_tax', group: R, sub: 'risk', title: 'Tax rate risk', keys: ['tax rate risk', 'higher taxes', 'bracket creep', 'lifetime tax'] },
  { id: 'dd_risk_dividend', group: R, sub: 'risk', title: 'Dividend yield risk', keys: ['dividend yield', 'yield compression', 'passive cash flow', 'SWVXX'] },

  { id: 'dd_sum_picture', group: U, sub: 'summary', title: 'The big picture', keys: ['plain English', 'what this page is', 'big picture', 'money last', 'recommended strategy'] },
  { id: 'dd_sum_this_year', group: U, sub: 'summary', title: 'What to actually do this year', keys: ['this year', 'plain steps', 'sell', 'convert', 'bucket', 'concentration'] },
  { id: 'dd_sum_chart', group: U, sub: 'summary', title: 'Your money over time, at a glance', keys: ['money over time', 'portfolio total', 'chart'] },
  { id: 'dd_sum_tax', group: U, sub: 'summary', title: 'Your tax situation, simply put', keys: ['tax situation', 'lifetime tax savings', 'bracket', 'Roth conversion'] },
  { id: 'dd_sum_legacy', group: U, sub: 'summary', title: 'Will my money last, and what’s left over?', keys: ['money last', 'legacy', 'left over', 'Roth'] },
  { id: 'dd_sum_safe_spending', group: U, sub: 'summary', title: 'How safe spending works', keys: ['safe spending', 'guardrails', 'spending plan'] },
  { id: 'dd_sum_glossary', group: U, sub: 'summary', title: 'Quick glossary', keys: ['glossary', 'RMD', 'Roth conversion', 'NIIT', 'LTCG', 'STCG', 'tax bracket'] },
]
