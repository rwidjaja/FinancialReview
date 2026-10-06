import type { SectionMeta } from './types'

const M = 'Versus the market', A = 'Attribution', R = 'Risk', P = 'Accounts and plan'

export const sections: SectionMeta[] = [
  { id: 'rt_vs_sp500', group: M, title: 'Portfolio vs S&P 500', keys: ['S&P 500', 'SPY', 'indexed to 100', 'excess return', 'alpha', 'price return', 'portfolio'] },
  { id: 'rt_benchmark', group: M, title: 'Benchmark comparison', adv: true, keys: ['SPY', 'QQQ', 'vs SPY', 'vs QQQ', 'sharpe', 'volatility', 'max drawdown'] },
  { id: 'rt_taxable_value', group: M, title: 'Taxable — portfolio value vs S&P 500', adv: true, keys: ['value on day 1', 'value today', 'if it were S&P 500 instead', 'you vs. S&P 500', 'alpha', 'taxable'] },
  { id: 'rt_market_context', group: M, title: 'Market context', adv: true, keys: ['S&P 500', 'Dow Jones', 'VIX', 'volatility', 'market regime', 'risk-off', 'expansion'] },

  { id: 'rt_contribution', group: A, title: 'Contribution by holding', keys: ['contribution', 'points', 'return', 'share', 'weight', 'portfolio points'] },
  { id: 'rt_fund_vs_you', group: A, title: 'Fund vs you', keys: ['your actual return', 'your cost basis', 'gap', 'timing drag', 'bought the dip', 'bought near high', 'weight'] },
  { id: 'rt_contrib_lifetime', group: A, title: 'Contribution table — lifetime, since buy', adv: true, keys: ['rank', 'port contrib', 'return %', 'cost basis', 'sym sharpe', 'sortino', 'win rate', 'max DD', 'vol', 'lifetime'] },
  { id: 'rt_sym_taxable', group: A, title: 'Taxable — symbol returns, base 100', adv: true, keys: ['taxable', 'symbol returns', 'base 100', 'normalized'] },
  { id: 'rt_sym_roth', group: A, title: 'Roth IRA — symbol returns, base 100', adv: true, keys: ['Roth IRA', 'symbol returns', 'base 100', 'normalized'] },
  { id: 'rt_sym_rollover', group: A, title: 'Rollover IRA — symbol returns, base 100', adv: true, keys: ['Rollover IRA', 'symbol returns', 'base 100', 'normalized'] },
  { id: 'rt_symbol_charts', group: A, title: 'Per-symbol analysis', adv: true, keys: ['per-symbol', 'sharpe', 'volatility', 'max DD', 'price chart'] },

  { id: 'rt_risk_context', group: R, title: 'Risk context', keys: ['volatility', 'vol budget', 'sharpe', 'max drawdown', 'win rate', 'sortino', 'volatility regime', 'concentration', 'top 3', 'top 5'] },
  { id: 'rt_drawdown', group: R, title: 'Drawdown heatmap — per symbol', adv: true, keys: ['drawdown', 'heatmap', 'severe', 'elevated', 'moderate', 'minimal'] },
  { id: 'rt_stress', group: R, title: 'Stress scenario engine', adv: true, keys: ['stress scenario', 'market crash', 'VIX spike', 'rate shock', 'interest rates rise sharply', 'est. impact', 'scenario'] },

  { id: 'rt_account_perf', group: P, title: 'Account performance', keys: ['CAGR', 'annualised', 'Taxable', 'Roth IRA', 'Rollover', 'raw return'] },
  { id: 'rt_accounts', group: P, title: 'Accounts', keys: ['account value', 'P&L', 'cost', 'tax-free', 'tax-deferred', 'taxable'] },
  { id: 'rt_plan_context', group: P, title: 'Retirement plan context', keys: ['Monte Carlo success', 'withdrawal rate', 'portfolio runway', 'income coverage', '4% rule', 'plan spend'] },
  { id: 'rt_briefing', group: P, title: 'Returns briefing', keys: ['briefing', 'summary', 'returns briefing'] },
]
