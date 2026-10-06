import type { SectionMeta, SubTabMeta } from './types'

// Every section needs a symbol picked in the search bar above.

export const sections: SectionMeta[] = [
  { id: 'rs_narrative', group: 'Symbol overview', title: 'AI analysis', keys: ['analyse', 'narrative', 'LLM', 'summary'] },
  { id: 'rs_guardrails', group: 'Symbol overview', title: 'Guardrails', keys: ['warning', 'data quality', 'guardrail'] },
  { id: 'rs_snapshot', group: 'Symbol overview', title: 'Symbol snapshot', keys: ['price', 'day change', 'fair value', 'weighted components', 'NAV', 'P/E', 'trading levels', 'limit price', 'structural status'] },
  { id: 'rs_action_plan', group: 'Symbol overview', title: 'Action plan', keys: ['buy at', 'strong buy', 'trim', 'exit', 'buy gates', 'pullback', 'size guidance'] },
  { id: 'rs_position', group: 'Position and system view', title: 'Your position', keys: ['shares', 'market value', 'cost basis', 'gain/loss', 'annual income', 'TTM yield', '1Y total return'] },
  { id: 'rs_decision', group: 'Position and system view', title: 'System assessment', adv: true, keys: ['structural status', 'decision', 'health decision', 'action engine overlay'] },
  { id: 'rs_etf', group: 'Position and system view', title: 'ETF component engine', keys: ['top-heavy', 'components', 'constituents', 'weighted fair value'] },
  { id: 'rs_quality', group: 'Action engine', sub: 'action', title: 'Quality and signals', adv: true, keys: ['quality score', 'income quality', 'quality breakdown', 'signal detail', 'RSI', 'MACD', 'trend'] },
  { id: 'rs_cycle', group: 'Action engine', sub: 'action', title: 'Cycle, pressure and torque', adv: true, keys: ['cycle position', 'intraday pressure', 'volatility structure', 'torque', 'buyer pressure'] },
  { id: 'rs_fit', group: 'Portfolio fit', sub: 'fit', title: 'Portfolio fit', adv: true, keys: ['portfolio role', 'correlation', 'yield impact', 'beta sizing', 'risk contribution', 'portfolio stress', 'sleeve', 'held in', 'guidance'] },
  { id: 'rs_flow', group: 'Deep analytics · Price and trend', sub: 'deep', title: 'Liquidity and flow', adv: true, keys: ['liquidity', 'flow engine', 'volume', 'money flow'] },
  { id: 'rs_perf', group: 'Deep analytics · Price and trend', sub: 'deep', title: 'Price performance', adv: true, keys: ['compare', 'benchmark', 'chart period', '1y', 'relative return'] },
  { id: 'rs_candle', group: 'Deep analytics · Price and trend', sub: 'deep', title: 'Candlestick chart', adv: true, keys: ['OHLC', 'candles', 'price chart'] },
  { id: 'rs_tech', group: 'Deep analytics · Price and trend', sub: 'deep', title: 'Trend and momentum', adv: true, keys: ['SMA 50', 'SMA 200', 'RSI', 'MACD', 'momentum', 'technicals'] },
  { id: 'rs_risk', group: 'Deep analytics · Risk and income', sub: 'deep', title: 'Volatility and risk', adv: true, keys: ['beta', 'max drawdown', 'volatility', 'sharpe', 'risk stats'] },
  { id: 'rs_nav', group: 'Deep analytics · Risk and income', sub: 'deep', title: 'NAV and premium/discount', adv: true, keys: ['NAV', 'premium', 'discount', 'annual NAV change', 'CEF'] },
  { id: 'rs_dist', group: 'Deep analytics · Risk and income', sub: 'deep', title: 'Distribution and income', adv: true, keys: ['distribution history', 'dividend', 'yield', 'payout', 'ROC'] },
  { id: 'rs_peers', group: 'Deep analytics · Peers and health', sub: 'deep', title: 'Peer comparison', adv: true, keys: ['peers', 'holdings', 'peer value'] },
  { id: 'rs_health', group: 'Deep analytics · Peers and health', sub: 'deep', title: 'Fund health analysis', adv: true, keys: ['fund health', 'evaluation engine', 'coverage', 'dist cut', 'AUM', 'expense ratio'] },
  { id: 'rs_qual', group: 'Deep analytics · Peers and health', sub: 'deep', title: 'Qualitative analysis', adv: true, keys: ['trend', 'momentum', 'volume', 'volatility'] },
  { id: 'rs_swing', group: 'Swing signal', sub: 'swing', title: 'Swing signal', adv: true, keys: ['swing trade', 'entry', 'stop', 'target', 'regime', 'VIX'] },
]

export const subTabs: SubTabMeta[] = [
  { id: 'action', label: 'Action engine' },
  { id: 'fit', label: 'Portfolio fit' },
  { id: 'deep', label: 'Deep analytics' },
  { id: 'swing', label: 'Swing signal' },
]
