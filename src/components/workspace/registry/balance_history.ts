import type { SectionMeta } from './types'

const B = 'Balance and growth', D = 'Daily sessions', A = 'Accounts', M = 'Milestones and trend'

export const sections: SectionMeta[] = [
  { id: 'bh_summary', group: B, title: 'Period summary', keys: ['balance change', '12-month return', 'since first capture', 'wealth velocity', 'best month', 'worst month', 'CAGR', 'trend'] },
  { id: 'bh_monthly', group: B, title: 'Monthly performance', adv: true, keys: ['monthly close', 'growth line', 'month-over-month change', 'MoM', 'total', 'rolling'] },
  { id: 'bh_monthly_table', group: B, title: 'Monthly summary', adv: true, keys: ['month', 'month open', 'month close', 'MoM Δ', 'MoM %', 'new high'] },

  { id: 'bh_sessions', group: D, title: 'Last sessions — open → close', keys: ['session Δ', 'open', 'close', 'last 5 sessions'] },
  { id: 'bh_daily_price', group: D, title: 'Daily price-action', adv: true, keys: ['daily close', 'volatility', 'pullback', 'momentum drift', 'cycle detection'] },
  { id: 'bh_daily_pnl', group: D, title: 'Daily P&L — full history', adv: true, keys: ['day P&L', 'close-to-close', 'daily returns', 'sessions'] },
  { id: 'bh_daily_detail', group: D, title: 'Daily detail — session analysis', adv: true, keys: ['date', 'open', 'close', 'high', 'low', 'range', 'close pos %', 'intraday Δ', 'DoD Δ', 'direction', 'day score', 'gap', 'filled', 'pressure'] },

  { id: 'bh_accounts', group: A, title: 'Account distribution', keys: ['account', 'Rollover IRA', 'Roth', 'taxable', 'share', 'conversion vehicle'] },
  { id: 'bh_acct_growth', group: A, title: 'Account growth comparison', adv: true, keys: ['indexed to 100', 'base 100', 'balance growth', 'incl. transfers', 'monthly sleeve attribution'] },

  { id: 'bh_milestones', group: M, title: 'Balance milestones', keys: ['milestone', 'reached', 'next milestone', 'to go'] },
  { id: 'bh_trend', group: M, title: 'Trend projection', adv: true, keys: ['30-day slope', 'projected 30d', 'projected 90d', 'linear regression', 'trend'] },
]
