import type { SectionMeta } from './types'

// Groups mirror the Settings sidebar; `sub` is the sidebar page (the rail switches
// pages). Each editor's SaveBar is deliberately left unwrapped so it stays visible.
const C = 'Config', A = 'Allocations', T = 'Tools'

export const sections: SectionMeta[] = [
  { id: 'st_personal_profile', group: C, sub: 'personal_json', title: 'Personal — profile, tax and Social Security', keys: ['full name', 'date of birth', 'filing status', 'SS collection age', 'retirement year', 'estimated spending', 'target volatility', 'Medicare', 'spouse', 'target bracket rate', 'safety buffer', 'prior year total tax', 'W2 withholding', 'Social Security scenarios'] },
  { id: 'st_personal_lifestyle', group: C, sub: 'personal_json', title: 'Lifestyle income target', keys: ['lifestyle income target', 'monthly min', 'monthly max', 'annual min', 'annual max'] },
  { id: 'st_personal_roth', group: C, sub: 'personal_json', title: 'Roth conversion plan and external accounts', keys: ['Roth conversion plan', 'annual conversion', 'conversion month', 'external accounts', '401(k) Roth', '401(k) Traditional'] },
  { id: 'st_tax_brackets', group: C, sub: 'tax_brackets_json', title: 'Tax brackets', keys: ['tax year', 'married filing jointly', 'single', 'standard deduction', 'brackets', 'income to', 'target bracket', 'rate'] },
  { id: 'st_account_mapping', group: C, sub: 'account_mapping', title: 'Schwab account mapping', keys: ['Schwab accounts', 'last 3 digits', 'account type', 'taxable', 'Roth', 'rollover'] },

  { id: 'st_target_roth', group: A, sub: 'target_roth', title: 'Roth IRA target allocation', keys: ['Roth allocation', 'target weight', 'symbol', 'total', 'must equal 100%'] },
  { id: 'st_target_taxable', group: A, sub: 'target_taxable', title: 'Taxable account target allocation', keys: ['taxable allocation', 'target weight', 'symbol', 'total', 'must equal 100%'] },

  { id: 'st_price_alerts', group: T, sub: 'price_alerts', title: 'Price alerts', keys: ['price alerts', 'symbol', 'direction', 'mode', 'threshold', 'base $', 'active', 'notes', 'add alert'] },
  { id: 'st_ai_keys', group: T, sub: 'ai_keys', title: 'AI and Ollama keys', keys: ['Ollama API keys', 'username', 'API key', 'ai_keys.json'] },
  { id: 'st_schwab_cost', group: T, sub: 'schwab_cost', title: 'Cost basis', keys: ['Schwab cost basis', 'lots', 'acquired', 'qty', 'cost/sh', 'basis', 'G/L', 'long term', 'short term', 'import CSV', 'create symbol'] },
]
