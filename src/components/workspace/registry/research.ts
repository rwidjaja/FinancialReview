import type { SectionMeta } from './types'

// Every section needs a symbol picked in the search bar above the rail content.
const S = 'Symbol overview', A = 'Action engine', F = 'Portfolio fit', D = 'Deep analytics', W = 'Swing signal'

export const sections: SectionMeta[] = [
  { id: 'rs_narrative', group: S, title: 'AI analysis', keys: ['analyse', 'narrative', 'LLM', 'summary'] },
  { id: 'rs_guardrails', group: S, title: 'Guardrails', keys: ['warning', 'data quality', 'guardrail'] },
  { id: 'rs_position', group: S, title: 'Your position', keys: ['shares', 'market value', 'cost basis', 'gain/loss', 'annual income', 'TTM yield', '1Y total return'] },
  { id: 'rs_snapshot', group: S, title: 'Symbol snapshot', keys: ['price', 'day change', 'fair value', 'weighted components', 'NAV', 'P/E', 'trading levels', 'limit price', 'structural status'] },
  { id: 'rs_action_plan', group: S, title: 'Action plan', keys: ['buy at', 'strong buy', 'trim', 'exit', 'buy gates', 'pullback', 'size guidance'] },
  { id: 'rs_etf', group: S, title: 'ETF component engine', keys: ['top-heavy', 'components', 'constituents', 'weighted fair value'] },
  { id: 'rs_decision', group: S, title: 'System assessment', adv: true, keys: ['structural status', 'decision', 'health decision', 'action engine overlay'] },

  { id: 'rs_quality', group: A, sub: 'action', title: 'Quality and signals', adv: true, keys: ['quality score', 'income quality', 'quality breakdown', 'signal detail', 'RSI', 'MACD', 'trend'] },
  { id: 'rs_cycle', group: A, sub: 'action', title: 'Cycle, pressure and torque', adv: true, keys: ['cycle position', 'intraday pressure', 'volatility structure', 'torque', 'buyer pressure'] },

  { id: 'rs_fit', group: F, sub: 'fit', title: 'Portfolio fit', adv: true, keys: ['portfolio role', 'correlation', 'yield impact', 'beta sizing', 'risk contribution', 'portfolio stress', 'sleeve', 'held in', 'guidance'] },

  { id: 'rs_flow', group: D, sub: 'deep', title: 'Liquidity and flow', adv: true, keys: ['liquidity', 'flow engine', 'volume', 'money flow'] },
  { id: 'rs_perf', group: D, sub: 'deep', title: 'Price performance', adv: true, keys: ['compare', 'benchmark', 'chart period', '1y', 'relative return'] },
  { id: 'rs_candle', group: D, sub: 'deep', title: 'Candlestick chart', adv: true, keys: ['OHLC', 'candles', 'price chart'] },
  { id: 'rs_tech', group: D, sub: 'deep', title: 'Trend and momentum', adv: true, keys: ['SMA 50', 'SMA 200', 'RSI', 'MACD', 'momentum', 'technicals'] },
  { id: 'rs_risk', group: D, sub: 'deep', title: 'Volatility and risk', adv: true, keys: ['beta', 'max drawdown', 'volatility', 'sharpe', 'risk stats'] },
  { id: 'rs_nav', group: D, sub: 'deep', title: 'NAV and premium/discount', adv: true, keys: ['NAV', 'premium', 'discount', 'annual NAV change', 'CEF'] },
  { id: 'rs_dist', group: D, sub: 'deep', title: 'Distribution and income', adv: true, keys: ['distribution history', 'dividend', 'yield', 'payout', 'ROC'] },
  { id: 'rs_peers', group: D, sub: 'deep', title: 'Peer comparison', adv: true, keys: ['peers', 'holdings', 'peer value'] },
  { id: 'rs_health', group: D, sub: 'deep', title: 'Fund health analysis', adv: true, keys: ['fund health', 'evaluation engine', 'coverage', 'dist cut', 'AUM', 'expense ratio'] },
  { id: 'rs_qual', group: D, sub: 'deep', title: 'Qualitative analysis', adv: true, keys: ['trend', 'momentum', 'volume', 'volatility'] },

  { id: 'rs_swing', group: W, sub: 'swing', title: 'Swing signal', adv: true, keys: ['swing trade', 'entry', 'stop', 'target', 'regime', 'VIX'] },
]
