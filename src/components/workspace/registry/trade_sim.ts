import type { SectionMeta } from './types'

// Groups follow the Trade sim sub-tabs; `sub` lets the rail switch sub-tab.
const O = 'Overview', H = 'Holdings', OR = 'Orders', T = 'History', I = 'Income',
  P = 'Performance', W = 'Watchlist', S = 'Swing trade'

export const sections: SectionMeta[] = [
  { id: 'ts_ov_brief', group: O, sub: 'overview', title: 'Portfolio briefing', keys: ['brief', 'AI briefing', 'narrative', 'LLM'] },
  { id: 'ts_ov_value', group: O, sub: 'overview', title: 'Portfolio value history', keys: ['value', 'history', 'chart', 'total value'] },
  { id: 'ts_ov_alloc', group: O, sub: 'overview', title: 'Allocation', keys: ['allocation', 'pie', 'cash', 'weight'] },
  { id: 'ts_ov_top', group: O, sub: 'overview', title: 'Top holdings', keys: ['symbol', 'shares', 'avg cost', 'price', 'value', 'P&L', 'wt%'] },
  { id: 'ts_ov_income', group: O, sub: 'overview', title: 'Projected income — next 12 months', keys: ['projected income', 'payments', 'per share', 'next 12 months', 'calendar'] },

  { id: 'ts_hold_income', group: H, sub: 'holdings', title: 'Income summary', keys: ['portfolio yield', 'yield on cost', 'est annual income', 'monthly income'] },
  { id: 'ts_hold_positions', group: H, sub: 'holdings', title: 'Positions', keys: ['holding', 'shares', 'avg cost', 'price', 'day chg', 'market value', 'P&L', 'wt %', 'annual $', 'yield %', 'YoC %', 'freq', 'ex-div date', 'next pay', 'place order'] },

  { id: 'ts_orders', group: OR, sub: 'orders', title: 'Order status', keys: ['limit orders', 'open', 'filled', 'cancelled', 'expired', 'limit $', 'distance', 'expires'] },

  { id: 'ts_trades', group: T, sub: 'trades', title: 'Transaction history', keys: ['transactions', 'date', 'type', 'symbol', 'shares', 'price/sh', 'amount', 'commission', 'notes'] },

  { id: 'ts_inc_summary', group: I, sub: 'income', title: 'Income summary', keys: ['portfolio yield', 'yield on cost', 'dividends LTM', 'income received YTD', 'all-time', 'payments'] },
  { id: 'ts_inc_record', group: I, sub: 'income', title: 'Record dividend', keys: ['record dividend', '$/share', 'pay date', 'DRIP reinvest'] },
  { id: 'ts_inc_diversification', group: I, sub: 'income', title: 'Passive income diversification', keys: ['diversification', 'donut', 'LTM income', 'share of income'] },
  { id: 'ts_inc_yield', group: I, sub: 'income', title: 'Yield / payout', keys: ['yield', 'payout', 'LTM yield', 'frequency'] },
  { id: 'ts_inc_monthly', group: I, sub: 'income', title: 'Monthly income', keys: ['monthly income', 'cumulative', 'year'] },
  { id: 'ts_inc_annual', group: I, sub: 'income', title: 'Annual income', keys: ['annual income', 'by year'] },
  { id: 'ts_inc_history', group: I, sub: 'income', title: 'Dividend history', keys: ['dividend history', 'date', 'symbol', 'freq', '$/sh', 'shares', 'total', 'DRIP'] },

  { id: 'ts_perf_kpis', group: P, sub: 'performance', title: 'Performance summary', keys: ['total return', 'CAGR', 'max drawdown', 'best day', 'worst day', 'seed'] },
  { id: 'ts_perf_chart', group: P, sub: 'performance', title: 'Portfolio vs SPY', keys: ['portfolio value', 'cumulative return', 'drawdown', 'SPY', 'benchmark', 'period'] },
  { id: 'ts_perf_monthly', group: P, sub: 'performance', title: 'Monthly P&L', keys: ['monthly P&L', 'month', 'gain', 'loss'] },
  { id: 'ts_perf_heatmap', group: P, sub: 'performance', title: 'Holding performance map', keys: ['heatmap', 'performance map', 'unrealized %', 'weight', 'cash'] },

  { id: 'ts_watchlist', group: W, sub: 'watchlist', title: 'Watchlist', keys: ['watch', 'symbol', 'price', 'day chg', 'day chg %', 'notes'] },

  { id: 'ts_sw_setup', group: S, sub: 'swing', title: 'Price and position', keys: ['price', 'change', 'prev close', 'cash available', 'you hold', 'avg cost'] },
  { id: 'ts_sw_signal', group: S, sub: 'swing', title: 'Symbol worthiness and entry signal', keys: ['symbol worthiness', 'score', 'entry signal', 'conditions met', 'conditions missing'] },
  { id: 'ts_sw_levels', group: S, sub: 'swing', title: 'Engine suggestions and order', keys: ['entry', 'stop', 'target', 'risk/share', 'reward/share', 'R:R', 'setup score', 'buy', 'sell', 'place order'] },
  { id: 'ts_sw_indicators', group: S, sub: 'swing', title: 'Indicators and verdict', keys: ['RSI', 'pullback', 'vol ratio', 'trend', 'MA20', 'MA50', 'LCS', 'TCS', 'RCS', 'context scores', 'verdict', 'recommendation'] },
  { id: 'ts_sw_chart', group: S, sub: 'swing', title: 'Candlestick chart', keys: ['candlestick', 'bars', 'entry', 'stop', 'target'] },
  { id: 'ts_sw_calendar', group: S, sub: 'swing', title: 'Buying calendar', keys: ['buying calendar', 'rally', 'pullback', 'entry windows', 'cycles'] },
]
