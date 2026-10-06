import type { SectionMeta } from './types'

export const sections: SectionMeta[] = [
  { id: 'cf_monthly', group: 'Where is the money going?', title: 'Monthly spending', keys: ['monthly timeline', 'at or below average', 'above average', 'over 1.5× average', 'vs avg', 'month', 'amount'] },
  { id: 'cf_categories', group: 'Where is the money going?', title: 'Categories', keys: ['annualised', 'core', 'discretionary', 'category', 'txns', '% of spend'] },
  { id: 'cf_core_disc', group: 'Where is the money going?', title: 'Core vs discretionary', keys: ['core', 'discretionary', 'core %', 'split'] },
  { id: 'cf_profile', group: 'Where is the money going?', title: 'Spending profile', adv: true, keys: ['lifestyle spending', 'spending volatility', 'lifestyle phase', 'monthly savings', 'taxes paid', 'savings rate'] },
  { id: 'cf_coverage', group: 'Is income covering spending?', title: 'YTD income coverage of spending', adv: true, keys: ['coverage', 'income', 'spending', 'surplus', 'deficit', 'Roth conversions excluded'] },
  { id: 'cf_income_sources', group: 'Is income covering spending?', title: 'Income sources — W2 + dividend', adv: true, keys: ['W2 salary', 'dividend income', 'fwd 12m', 'total income', 'YTD actual', 'month'] },
  { id: 'cf_div_calendar', group: 'Is income covering spending?', title: 'Dividend payout calendar', keys: ['dividend', 'payout', 'calendar', 'ticker', 'account', 'monthly', 'annual'] },
  { id: 'cf_seasonality', group: 'Is income covering spending?', title: 'Income seasonality', adv: true, keys: ['seasonality', 'quarterly peak', 'above avg', 'normal / low', 'avg/mo', 'dividends'] },
  { id: 'cf_bucket', group: 'Cash bucket', title: 'Cash bucket plan', keys: ['cash bucket', 'withdrawal state', 'required bucket', 'current SWVXX', 'bucket fill', 'refill', 'controlled sales'] },
  { id: 'cf_briefing', group: 'Cash bucket', title: 'Cash flow briefing', keys: ['briefing', 'cash flow summary', 'AI'] },
  { id: 'cf_category_detail', group: 'Spending detail', title: 'Category detail', adv: true, keys: ['category', 'annual', 'monthly', 'YoY', 'txns', 'core', 'disc', '% of spend'] },
  { id: 'cf_recurring', group: 'Spending detail', title: 'Recurring payments', adv: true, keys: ['payee', 'fixed', 'habitual', 'months seen', 'monthly', 'annual'] },
  { id: 'cf_shocks', group: 'Spending detail', title: 'Shock events', adv: true, keys: ['shock events', 'date', 'description', 'category', 'amount', 'relative', 'this year', 'last year'] },
]
