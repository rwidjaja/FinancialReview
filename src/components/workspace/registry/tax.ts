import type { SectionMeta } from './types'

const TY = 'Tax planning · this year', TP = 'Tax planning · profile and accounts'
const TA = 'Tax planning · income tax analysis', TT = 'Tax planning · planning tools'
const RY = 'Roth conversion · this year', RL = 'Roth conversion · lifetime', RE = 'Roth conversion · engine detail'
const SL = 'Sell and rebalance · lots', SP = 'Sell and rebalance · plan'

export const sections: SectionMeta[] = [
  { id: 'tx_income', group: TY, sub: 'tax', title: 'Income summary', keys: ['W2 salary', 'dividends taxable', 'Roth conversion', 'projected gross', 'income mix', 'tax bracket', 'over ceiling', 'marginal rate'] },
  { id: 'tx_briefing', group: TY, sub: 'tax', title: 'Tax briefing', keys: ['bracket fullness', 'AGI estimate', 'qualified dividends', 'ordinary dividends', 'bracket pressure'] },
  { id: 'tx_position', group: TY, sub: 'tax', title: 'Tax position', keys: ['effective tax rate', 'tax drag', 'conversion opportunity', 'conversion room', 'conversion score', 'converted YTD'] },
  { id: 'tx_meter', group: TY, sub: 'tax', title: 'Bracket meter', keys: ['bracket used', 'bracket room', 'safe', 'moderate', 'high', 'gross ceiling', 'std deduction'] },
  { id: 'tx_payments', group: TY, sub: 'tax', title: 'Estimated tax payments', keys: ['safe harbor', 'quarterly', 'Q1', 'Q2', 'Q3', 'Q4', 'due date', 'payment readiness', 'IRS'] },

  { id: 'tx_accounts', group: TP, sub: 'tax', title: 'Account structure', keys: ['tax exposure', 'pre-tax IRA', 'Roth IRA', 'taxable', 'tax cost YTD', 'annual RMD impact', 'breakeven'] },
  { id: 'tx_forward', group: TP, sub: 'tax', title: 'Forward planning', keys: ['RMD start', 'Social Security start', 'IRMAA', 'Medicare start'] },
  { id: 'tx_scores', group: TP, sub: 'tax', title: 'Portfolio tax scores', keys: ['personal profile', 'filing status', 'spouse', 'bracket headroom', 'income tax efficiency', 'sequence risk score', 'conversion efficiency', 'annual conversion target'] },

  { id: 'tx_divchar', group: TA, sub: 'tax', title: 'Dividend tax character', adv: true, keys: ['ordinary', 'qualified', 'return of capital', 'ROC'] },
  { id: 'tx_perfund', group: TA, sub: 'tax', title: 'Per-fund dividend character', adv: true, keys: ['ROC-heavy', 'qualified-heavy', 'ordinary-heavy', 'per fund'] },
  { id: 'tx_calendar', group: TA, sub: 'tax', title: 'Taxable dividend calendar', adv: true, keys: ['monthly dividends', 'payout calendar', 'ex-date'] },
  { id: 'tx_realized', group: TA, sub: 'tax', title: 'Realized sales — capital gains tax', adv: true, keys: ['STCG', 'LTCG', 'realized gains', 'cap gains tax'] },

  { id: 'tx_cashflow', group: TT, sub: 'tax', title: 'Tax-aware cashflow', adv: true, keys: ['after-tax cashflow', 'spending', 'tax reserve'] },
  { id: 'tx_ss', group: TT, sub: 'tax', title: 'Social Security options', adv: true, keys: ['claiming age', 'SS at 62', 'SS at 67', 'SS at 70', 'benefit'] },
  { id: 'tx_with_ss', group: TT, sub: 'tax', title: 'With Social Security — tax scenario', adv: true, keys: ['taxable Social Security', 'provisional income', 'effective rate with SS'] },
  { id: 'tx_rebal_score', group: TT, sub: 'tax', title: 'Tax-efficient rebalance score', adv: true, keys: ['rebalance score', 'tax cost of rebalancing'] },
  { id: 'tx_withdrawal', group: TT, sub: 'tax', title: 'Withdrawal tax sequencing', adv: true, keys: ['withdrawal state', 'withdrawal order', 'sequencing'] },

  { id: 'tx_r_command', group: RY, sub: 'roth', title: 'Conversion command center', keys: ['conversion verdict', 'GO', 'WAIT', 'STOP', 'recommended target', 'income confidence'] },
  { id: 'tx_r_bracket', group: RY, sub: 'roth', title: 'Bracket filling engine', keys: ['bracket room', 'safe room', 'safety buffer', 'target bracket', 'math rule action', 'window status'] },
  { id: 'tx_r_stop', group: RY, sub: 'roth', title: 'Stop verdict', keys: ['stop', 'bracket-fill option', 'not recommended'] },
  { id: 'tx_r_exec', group: RY, sub: 'roth', title: 'Execution month action', keys: ['execution checklist', 'conversion month', 'December'] },
  { id: 'tx_r_window', group: RY, sub: 'roth', title: 'Window status', keys: ['window status', 'blockers', 'income received', 'trigger'] },
  { id: 'tx_r_status', group: RY, sub: 'roth', title: 'Conversion status and progress', keys: ['converted YTD', 'conversion target', 'progress', 'rollover balance', 'max additional'] },
  { id: 'tx_r_scen', group: RY, sub: 'roth', title: 'Conversion scenarios', keys: ['recommended scenario', 'conservative', 'aggressive'] },
  { id: 'tx_r_income', group: RY, sub: 'roth', title: 'Income summary', keys: ['projected gross', 'income mix'] },

  { id: 'tx_r_runway', group: RL, sub: 'roth', title: 'Conversion runway', keys: ['rollover depletion', 'years remaining', 'depletion age'] },
  { id: 'tx_r_rmd', group: RL, sub: 'roth', title: 'RMD-only vs conversion — lifetime', keys: ['RMD', 'lifetime tax', 'partial conversion', 'full conversion', 'age 90'] },
  { id: 'tx_r_calendar', group: RL, sub: 'roth', title: 'Conversion schedule — rollover depletion', adv: true, keys: ['depletion schedule', 'multi-year', 'why not converting'] },
  { id: 'tx_r_proj', group: RL, sub: 'roth', title: 'Long-term projection', adv: true, keys: ['projection', 'Roth balance', 'rollover balance'] },

  { id: 'tx_r_logic', group: RE, sub: 'roth', title: 'Room and AGI calculation engine', adv: true, keys: ['AGI', 'room', 'MAGI', 'actual YTD AGI', 'full-year AGI estimate', 'conversion score', 'timing engine'] },
  { id: 'tx_r_acct', group: RE, sub: 'roth', title: 'Account allocation impact', adv: true, keys: ['account allocation', 'Roth plan', 'safe room'] },
  { id: 'tx_r_taximpact', group: RE, sub: 'roth', title: 'Conversion tax impact', adv: true, keys: ['conversion tax', 'IRMAA', 'marginal'] },

  { id: 'tx_s_lots', group: SL, sub: 'sell', title: 'Lot signals', keys: ['tax lots', 'LTCG unrealized', 'STCG unrealized', 'STCG tax if sold now', 'savings from waiting', 'harvestable loss', 'LTCG room', 'maturity calendar'] },
  { id: 'tx_s_detail', group: SL, sub: 'sell', title: 'Lot details', keys: ['per-position', 'lot table', 'sell signal', 'WAIT', 'HARVEST', 'FREE', 'data coverage'] },
  { id: 'tx_s_gain', group: SL, sub: 'sell', title: 'Gain planner', adv: true, keys: ['manual lot pick', 'gain budget', 'exclude income'] },
  { id: 'tx_s_maturity', group: SL, sub: 'sell', title: 'Lot maturity and gain classification', keys: ['long-term', 'short-term', 'lot maturity'] },
  { id: 'tx_s_pipeline', group: SL, sub: 'sell', title: 'Tax pipeline — ordinary vs capital gains', keys: ['ordinary income', 'capital gains', 'pipeline'] },

  { id: 'tx_s_plan', group: SP, sub: 'sell', title: 'Multi-year rebalance plan', keys: ['sell plan', 'rebalance', 'bracket ceiling', 'NIIT', 'multi-year'] },
]
