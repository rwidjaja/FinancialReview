import type { SectionMeta } from './types'

export const sections: SectionMeta[] = [
  { id: 'attention', group: 'What needs my attention', title: 'Needs attention', keys: ['alerts', 'NVDA concentration', 'volatility budget', 'fragility', 'cash bucket', 'NIIT', 'short-term gains'] },
  { id: 'scorecard', group: 'What needs my attention', title: 'Scorecard', keys: ['income coverage', 'cash bucket', 'tax flexibility', 'concentration', 'Roth progress', 'sequence risk', 'pass'] },
  { id: 'diagnostics', group: 'What needs my attention', title: 'Diagnostics', keys: ['risk utilisation', 'vol budget', 'fragility', 'conversion window', 'cash bucket', 'beta', 'confidence', 'dividend confidence', 'regime', 'VIX', 'income coverage'] },
  { id: 'markets', group: 'My money today', title: 'Markets today', keys: ['S&P 500', 'Dow Jones', 'Dow', 'Nasdaq', 'VIX', 'index', 'market'] },
  { id: 'sessions10', group: 'My money today', title: 'Last 10 sessions', keys: ['portfolio value', 'daily P&L', '10 days', 'trend', 'up days', 'down days'] },
  { id: 'changed', group: 'My money today', title: 'What changed today', keys: ['day change', 'movers', 'top movers', 'account change'] },
  { id: 'holdings', group: 'My money today', title: 'Holdings today', keys: ['ticker', 'price', 'day %', 'symbols'] },
  { id: 'market', group: 'My money today', title: 'Market character', adv: true, keys: ['buyer pressure', 'buyer wins', 'intraday', 'gap overnight', 'avg up day', 'avg down day', 'close to close', 'position in range', 'rolling 5 sessions'] },
  { id: 'income', group: 'Am I on track?', title: 'Income', keys: ['dividends', 'forward 12 months', 'yield', 'lifestyle coverage', 'taxable income mix', 'flow rules', 'dividend pacing', 'received'] },
  { id: 'wellness', group: 'Am I on track?', title: 'Financial wellness', keys: ['net worth', 'plan spending', 'withdrawal rate', 'cash flow', 'lasts to 95', 'lasts to 100', 'safe spending', 'bad-start risk', 'failure line', 'Social Security', 'Monte Carlo'] },
  { id: 're_primary', group: 'What should I do next?', title: 'Primary action', adv: true, keys: ['controlled sale', 'income reliability', 'tax flexibility', 'execution risk', 'readiness', 'withdrawal state'] },
  { id: 're_overrides', group: 'What should I do next?', title: 'Overrides', adv: true, keys: ['bucket deficit', 'NIIT cap', 'STCG freeze', 'blocks conversion'] },
  { id: 're_triggers', group: 'What should I do next?', title: 'If–then triggers', adv: true, keys: ['if then', 'VIX above 30', 'dividends received', 'lots mature', 'fragility 70'] },
  { id: 're_outlook', group: 'What should I do next?', title: 'Outlook and conversion window', adv: true, keys: ['30-day outlook', 'monthly dividends', 'AGI increase', 'bucket change', 'next conversion window', 'bracket room', 'safe room', 'why not converting'] },
  { id: 're_drivers', group: 'Why the engine says so', title: 'Cross-tab drivers', adv: true, keys: ['bracket room', 'STCG', 'NIIT headroom', 'fragility', 'vol budget', 'regime', 'fwd 12m', 'spending', 'bucket'] },
  { id: 're_compliance', group: 'Why the engine says so', title: 'Risk overrides and State C compliance', adv: true, keys: ['risk overrides', 'State C', 'rule compliance', 'checks'] },
  { id: 're_taxlock', group: 'Why the engine says so', title: 'Tax-locked concentration', adv: true, keys: ['lots', 'LTCG', 'LTCG glidepath', 'value of waiting', 'tax today', 'after LTCG', 'matures', 'excess'] },
  { id: 're_forced', group: 'Why the engine says so', title: 'Forced-sale risk', adv: true, keys: ['cash need 12 months', 'required portfolio sale', 'forced sale'] },
]
