import type { SectionMeta } from './types'

// Scenario / horizon / stress toggles live in the hero aside ("Scenario, horizon
// and stress") and drive every section below.
const P = 'Projection', S = 'Scenario detail', I = 'Income, tax and cashflow',
  H = 'Holdings and signals', C = 'Context'

export const sections: SectionMeta[] = [
  { id: 'fc_what_changed', group: P, title: 'What changed since last run', keys: ['what changed', 'since last run', 'portfolio value', 'annual income', 'federal tax', 'net cashflow'] },
  { id: 'fc_growth', group: P, title: 'Portfolio growth projection', keys: ['growth', 'fan chart', 'base', 'bull', 'bear', 'target', 'portfolio value'] },
  { id: 'fc_milestones', group: P, title: 'Milestones by horizon', keys: ['1Y', '3Y', '5Y', '10Y', 'horizon', 'age', 'income', 'net'] },
  { id: 'fc_year_by_year', group: P, title: 'Year by year', keys: ['year', 'age', 'value', 'income', 'SS', 'tax', 'net / yr', '/ mo', 'Roth conversion'] },
  { id: 'fc_scenario_compare', group: P, title: 'Scenario comparison', keys: ['base', 'bull', 'bear', 'div. income', 'federal tax', 'net cashflow', 'monthly net', '+ Roth conv.'] },

  { id: 'fc_scenario_hero', group: S, title: 'Scenario outlook', adv: true, keys: ['portfolio value', 'div. income', 'net cashflow', 'federal tax', 'SS income', 'LTCG 0% room', 'narrative', 'outlook'] },
  { id: 'fc_growth_all', group: S, title: 'Growth projection — all scenarios', adv: true, keys: ['growth chart', 'all scenarios', 'base', 'bull', 'bear', 'target', 'regime'] },
  { id: 'fc_status', group: S, title: 'Projection and market status', adv: true, keys: ['projection', 'income covers expenses', 'cashflow deficit', 'market regime', 'volatility regime', 'fragility', 'income durability', 'sequence risk'] },

  { id: 'fc_income', group: I, title: 'Dividend and income projection', adv: true, keys: ['dividend', 'income projection', 'income goal', 'expenses', 'symbol', 'type', 'annual income', 'monthly average', 'yield on cost', '% total'] },
  { id: 'fc_tax', group: I, title: 'Tax projection — full breakdown', adv: true, keys: ['gross income', 'standard deduction', 'taxable', 'federal tax', 'effective %', 'bracket', 'LTCG 0% room', 'NIIT'] },
  { id: 'fc_cashflow', group: I, title: 'Cashflow projection', adv: true, keys: ['income', 'tax', 'expenses', 'net base', 'net bull', 'net bear', 'monthly base', 'surplus', 'deficit'] },

  { id: 'fc_nav', group: H, title: 'NAV and premium forecast', adv: true, keys: ['structural risk', 'NAV', 'premium', 'discount', 'CEF', 'NAV direction', 'premium heatmap', 'TTM yield', 'mean reversion'] },
  { id: 'fc_symbols', group: H, title: 'Symbol-level forward projection', adv: true, keys: ['symbol', 'type', 'value now', 'trend', 'premium', 'signal'] },
  { id: 'fc_signals', group: H, title: 'Action signals', adv: true, keys: ['action signals', 'opportunity', 'income target', 'bracket crossing', 'SS begins', 'cashflow negative', 'priority'] },

  { id: 'fc_ss_timing', group: C, title: 'Social Security timing', keys: ['Social Security', 'claiming age', 'annual', 'monthly', 'current plan'] },
  { id: 'fc_briefing', group: C, title: 'Forecast briefing', keys: ['briefing', 'AI summary', 'forecast briefing'] },
  { id: 'fc_assumptions', group: C, title: 'Assumptions', adv: true, keys: ['scenario', 'price growth', 'dividend growth', 'expense inflation', 'CEF premium', 'tax', 'stress', 'bear note'] },
]
