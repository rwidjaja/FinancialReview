import type { SectionMeta } from './types'

const M = 'Market regime', A = 'Attribution and drawdown', S = 'Structure and correlation', C = 'Cash and execution', T = 'Tax and income'

export const sections: SectionMeta[] = [
  { id: 'rk_regime', group: M, title: 'Market regime and positioning', keys: ['regime', 'VIX', 'alignment', 'growth vs income', 'positioning', 'expansion', 'risk-off'] },
  { id: 'rk_regime_transition', group: M, title: 'Regime transition risk', adv: true, keys: ['current regime', 'transition probabilities', 'est. half-life', '20D momentum', '90D trend', 'signal tension', 'fragility', 'consolidation', 'acceleration'] },
  { id: 'rk_regime_alignment', group: M, title: 'Regime alignment', adv: true, keys: ['alignment score', 'positioning', 'regime', 'aggressive', 'balanced', 'conservative'] },
  { id: 'rk_risk_adjusted', group: M, title: 'Risk-adjusted returns', adv: true, keys: ['sharpe', 'risk-adjusted', 'top holdings by weight', 'return', 'volatility'] },

  { id: 'rk_attribution', group: A, title: 'Return and risk attribution', keys: ['high-vol driver', 'sharpe (1y)', 'realised vol', '1σ swing', 'risk-adjusted'] },
  { id: 'rk_dollar_risk', group: A, title: 'Dollar risk', keys: ['1σ swing', 'correction', 'bear market', 'crash', 'SPX −15%', 'SPX −30%', 'SPX −45%', 'beta'] },
  { id: 'rk_vol_attribution', group: A, title: 'Volatility attribution', keys: ['share of portfolio variance', 'volatility', 'weight', 'σ', 'vol driver', 'other'] },
  { id: 'rk_beta', group: A, title: 'Beta decomposition', adv: true, keys: ['beta', 'weighted beta', 'beta contribution', 'vs SPY'] },
  { id: 'rk_drawdown_path', group: A, title: 'Drawdown path', adv: true, keys: ['drawdown', 'top DD contributors (6M)', 'max drawdown', 'recovery'] },

  { id: 'rk_structure', group: S, title: 'Portfolio structure', keys: ['top holding', 'top 5 weight', 'effective holdings', 'correlation risk', 'concentration', 'overlap'] },
  { id: 'rk_stress_corr', group: S, title: 'Stress correlation', adv: true, keys: ['cluster risk', 'highest stress pairs', 'stress uplift', 'vs normal regime', 'growth', 'CEF', 'dividend'] },
  { id: 'rk_corr_matrix', group: S, title: 'Correlation clusters', adv: true, keys: ['correlation matrix', 'correlation clusters', 'growth', 'CEF', 'dividend'] },
  { id: 'rk_cross_sleeve', group: S, title: 'Cross-sleeve correlation', adv: true, keys: ['cross-sleeve', 'correlation', 'diversification score', 'sleeve'] },
  { id: 'rk_heatmap', group: S, title: 'Portfolio heatmap', adv: true, keys: ['return vs risk contribution', 'contribution detail', 'RET%', 'RISK%', 'INC%'] },

  { id: 'rk_cash', group: C, title: 'Cash and execution', keys: ['cash runway', 'withdrawal mode', 'monthly need', 'active alerts', 'spendable', 'money market'] },
  { id: 'rk_alerts', group: C, title: 'System alerts', keys: ['alerts', 'active alerts', 'unified alerts', 'red', 'warning'] },
  { id: 'rk_execution', group: C, title: 'Execution signals', keys: ['execution signals', 'BUY', 'TRIM', 'REDUCE', 'HOLD', 'EXIT', 'WATCH', 'overweight', 'target drift'] },
  { id: 'rk_liquidity', group: C, title: 'Liquidity', adv: true, keys: ['liquidity', 'cash locations', 'taxable', 'Roth', 'rollover', 'IRA'] },
  { id: 'rk_vol_budget_trend', group: C, title: 'Vol budget trend', adv: true, keys: ['vol budget', 'current', '1M est.', '3M est.', '6M est.', 'top vol drivers'] },

  { id: 'rk_tax_income', group: T, title: 'Tax and income', keys: ['income durability', 'tax status', 'income per month', 'spending per month', 'bracket'] },
  { id: 'rk_tax_drift', group: T, title: 'Tax drift', adv: true, keys: ['bracket pace', 'bracket status', 'NIIT exposure', 'conv cap', 'bracket', 'critical'] },
  { id: 'rk_cashflow_vol', group: T, title: 'Cashflow volatility', adv: true, keys: ['cashflow volatility', 'income by ticker', 'dividend variability', 'monthly income'] },
]
