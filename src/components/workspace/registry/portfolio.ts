import type { SectionMeta } from './types'

export const sections: SectionMeta[] = [
  { id: 'pf_accounts', group: 'Holdings and allocation', title: 'Accounts', keys: ['Taxable', 'Roth IRA', 'Rollover IRA', 'account value', 'share', 'today', 'reinvested', 'income/yr'] },
  { id: 'pf_holdings', group: 'Holdings and allocation', title: 'Holdings', keys: ['symbol', 'weight', 'value', 'today', 'P&L', 'yield', 'fund health', 'target weight', 'over target'] },
  { id: 'pf_allocation', group: 'Holdings and allocation', title: 'Allocation', adv: true, keys: ['donut', 'list', 'allocation', 'positions', 'sleeve', 'weight'] },
  { id: 'pf_position_detail', group: 'Holdings and allocation', title: 'Position detail by account', adv: true, keys: ['shares', 'cost basis', 'cost per share', 'price', 'P&L%', 'yield', 'annual income', 'tax', 'QUAL', 'ROC'] },
  { id: 'pf_taxable_target', group: 'Drift from target', title: 'Taxable target', keys: ['actual / target', 'drift', 'off band', 'target %', '30% drawdown stress'] },
  { id: 'pf_roth_target', group: 'Drift from target', title: 'Roth target', keys: ['actual / target', 'drift', 'off band', 'Roth IRA', 'target %'] },
  { id: 'pf_not_in_target', group: 'Drift from target', title: 'Not in target', keys: ['not in target', 'sell to 0%', 'exit', 'rebalance plan'] },
  { id: 'pf_taxable_target_alloc', group: 'Rebalance trades', title: 'Taxable target allocation', adv: true, keys: ['plan adherence', 'to buy', 'to sell', 'trade', 'shares', 'BUY', 'SELL', 'HOLD', 'EXIT', 'needs rebalance'] },
  { id: 'pf_roth_target_alloc', group: 'Rebalance trades', title: 'Roth IRA target allocation', adv: true, keys: ['plan adherence', 'to buy', 'to sell', 'trade', 'shares', 'BUY', 'SELL', 'HOLD', 'NEW'] },
  { id: 'pf_conversion_alloc', group: 'Rebalance trades', title: 'Rollover conversion allocation', adv: true, keys: ['Roth conversion', 'rollover', 'NAV', 'prem/disc', 'recommendation', 'status', 'shares'] },
  { id: 'pf_concentration', group: 'Concentration and risk budget', title: 'Concentration', keys: ['diversification score', 'tax to rebalance', 'savings by waiting', 'short-term lots', 'long-term lots', 'wealth dependency', '−20%', '−30%', '−40%', 'drift'] },
  { id: 'pf_risk_budget', group: 'Concentration and risk budget', title: 'Portfolio risk budget', adv: true, keys: ['weighted beta', 'weighted vol', 'diversification', 'top risk driver', 'risk contribution', 'high correlation', 'concentrated'] },
  { id: 'pf_fund_signals', group: 'Fund health', title: 'Fund signals', keys: ['portfolio fit', 'decision signals', 'healthy', 'stretched', 'breakdown', 'decision engine'] },
  { id: 'pf_fund_analysis', group: 'Fund health', title: 'Per-fund analysis', adv: true, keys: ['fund health', 'live evaluation', 'structural status', 'decision', 'per-fund'] },
  { id: 'pf_income_history', group: 'Income', title: 'Income history', keys: ['received', 'projected', 'monthly income', 'YTD', 'forward 12-month', 'dividends'] },
  { id: 'pf_income_ttm', group: 'Income', title: 'Income projection — TTM', adv: true, keys: ['fwd 12M income', 'div. headroom', 'dividend tax composition', 'taxable dividends', 'tax-free income', 'after-tax income', 'est fwd tax impact', 'top income contributors'] },
  { id: 'pf_income_intel', group: 'Income', title: 'Income intelligence', adv: true, keys: ['received YTD', 'annualized pace', 'proj annual', 'vs projected', 'est tax', 'after-tax', 'shortfall', 'growth rate', 'projected EOY', 'tax drag', 'scenario'] },
  { id: 'pf_income_analytics', group: 'Income detail', title: 'Income analytics', adv: true, keys: ['by account', 'tax quality', 'income stress test', 'dividend headroom', 'portfolio yield', 'growth 1Y', 'proj end-of-year', 'bracket ceiling', 'qualified div', 'ROC / tax-free'] },
  { id: 'pf_income_tx', group: 'Income detail', title: 'Income transactions', adv: true, keys: ['date', 'symbol', 'account', 'type', 'amount', 'DIV', 'INT', 'REINVEST', 'QUAL', 'ROC'] },
  { id: 'pf_all_columns', group: 'Holdings · every column', title: 'All columns', adv: true, keys: ['qty', 'price', 'cost', 'day chg', 'chg%', 'P&L%', 'div yld%', 'YOC%', 'annual income', 'core', 'satellite', 'CEF'] },
]
