import type { SectionMeta } from './types'

export const sections: SectionMeta[] = [
  { id: 'bh_summary', group: 'How has the balance grown?', title: 'Period summary', keys: ['balance change', '12-month return', 'since first capture', 'wealth velocity', 'best month', 'worst month', 'CAGR', 'trend'] },
  { id: 'bh_milestones', group: 'How has the balance grown?', title: 'Balance milestones', keys: ['milestone', 'reached', 'next milestone', 'to go'] },
  { id: 'bh_trend', group: 'How has the balance grown?', title: 'Trend projection', adv: true, keys: ['30-day slope', 'projected 30d', 'projected 90d', 'linear regression', 'trend'] },
  { id: 'bh_monthly', group: 'Month by month', title: 'Monthly performance', adv: true, keys: ['monthly close', 'growth line', 'month-over-month change', 'MoM', 'total', 'rolling'] },
  { id: 'bh_monthly_table', group: 'Month by month', title: 'Monthly summary', adv: true, keys: ['month', 'month open', 'month close', 'MoM Δ', 'MoM %', 'new high'] },
  { id: 'bh_sessions', group: 'Recent sessions', title: 'Last sessions — open → close', keys: ['session Δ', 'open', 'close', 'last 5 sessions'] },
  { id: 'bh_daily_price', group: 'Recent sessions', title: 'Daily price-action', adv: true, keys: ['daily close', 'volatility', 'pullback', 'momentum drift', 'cycle detection'] },
  { id: 'bh_daily_pnl', group: 'Recent sessions', title: 'Daily P&L — full history', adv: true, keys: ['day P&L', 'close-to-close', 'daily returns', 'sessions'] },
  { id: 'bh_accounts', group: 'By account', title: 'Account distribution', keys: ['account', 'Rollover IRA', 'Roth', 'taxable', 'share', 'conversion vehicle'] },
  { id: 'bh_acct_growth', group: 'By account', title: 'Account growth comparison', adv: true, keys: ['indexed to 100', 'base 100', 'balance growth', 'incl. transfers', 'monthly sleeve attribution'] },
  { id: 'bh_daily_detail', group: 'Session detail', title: 'Daily detail — session analysis', adv: true, keys: ['date', 'open', 'close', 'high', 'low', 'range', 'close pos %', 'intraday Δ', 'DoD Δ', 'direction', 'day score', 'gap', 'filled', 'pressure'] },
]
