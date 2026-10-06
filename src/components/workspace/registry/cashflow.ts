import type { SectionMeta } from './types'

const S = 'Spending', I = 'Income and coverage', B = 'Cash bucket and briefing', D = 'Spending detail'

export const sections: SectionMeta[] = [
  { id: 'cf_monthly', group: S, title: 'Monthly spending', keys: ['monthly timeline', 'at or below average', 'above average', 'over 1.5× average', 'vs avg', 'month', 'amount'] },
  { id: 'cf_categories', group: S, title: 'Categories', keys: ['annualised', 'core', 'discretionary', 'category', 'txns', '% of spend'] },
  { id: 'cf_core_disc', group: S, title: 'Core vs discretionary', keys: ['core', 'discretionary', 'core %', 'split'] },
  { id: 'cf_profile', group: S, title: 'Spending profile', adv: true, keys: ['lifestyle spending', 'spending volatility', 'lifestyle phase', 'monthly savings', 'taxes paid', 'savings rate'] },

  { id: 'cf_div_calendar', group: I, title: 'Dividend payout calendar', keys: ['dividend', 'payout', 'calendar', 'ticker', 'account', 'monthly', 'annual'] },
  { id: 'cf_coverage', group: I, title: 'YTD income coverage of spending', adv: true, keys: ['coverage', 'income', 'spending', 'surplus', 'deficit', 'Roth conversions excluded'] },
  { id: 'cf_income_sources', group: I, title: 'Income sources — W2 + dividend', adv: true, keys: ['W2 salary', 'dividend income', 'fwd 12m', 'total income', 'YTD actual', 'month'] },
  { id: 'cf_seasonality', group: I, title: 'Income seasonality', adv: true, keys: ['seasonality', 'quarterly peak', 'above avg', 'normal / low', 'avg/mo', 'dividends'] },

  { id: 'cf_bucket', group: B, title: 'Cash bucket plan', keys: ['cash bucket', 'withdrawal state', 'required bucket', 'current SWVXX', 'bucket fill', 'refill', 'controlled sales'] },
  { id: 'cf_briefing', group: B, title: 'Cash flow briefing', keys: ['briefing', 'cash flow summary', 'AI'] },

  { id: 'cf_category_detail', group: D, title: 'Category detail', adv: true, keys: ['category', 'annual', 'monthly', 'YoY', 'txns', 'core', 'disc', '% of spend'] },
  { id: 'cf_recurring', group: D, title: 'Recurring payments', adv: true, keys: ['payee', 'fixed', 'habitual', 'months seen', 'monthly', 'annual'] },
  { id: 'cf_shocks', group: D, title: 'Shock events', adv: true, keys: ['shock events', 'date', 'description', 'category', 'amount', 'relative', 'this year', 'last year'] },
]
