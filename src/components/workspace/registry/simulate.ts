import type { SectionMeta, SubTabMeta } from './types'

// Groups follow the Simulate sub-tabs; "Context" holds the side-rail notes and
// the advanced strategy timeline, which render under every sub-tab.
// The shared-parameter sliders live in the hero aside ("Shared parameters").

export const sections: SectionMeta[] = [
  { id: 'sm_mc_run', group: 'Lifetime projection', sub: 'monte_carlo', title: 'Run lifetime projection', keys: ['run', 'Monte Carlo', 'save as baseline', 'clear baseline', 'spending', 'return', 'volatility', 'inflation', 'target age'] },
  { id: 'sm_mc_success', group: 'Lifetime projection', sub: 'monte_carlo', title: 'Success rates and ending wealth', keys: ['success overall', 'success to 85', 'success to 90', 'success to 95', 'median ending wealth', '25th percentile', '75th percentile'] },
  { id: 'sm_mc_bands', group: 'Lifetime projection', sub: 'monte_carlo', title: 'Percentile bands', keys: ['fan chart', '1,000 paths', 'P90', 'median', 'P10', 'sequence risk penalty', 'longevity interpretation'] },
  { id: 'sm_mc_whatif', group: 'Lifetime projection', sub: 'monte_carlo', title: 'What-if comparison — baseline vs scenario', keys: ['baseline', 'scenario', 'delta', 'success rate', 'median ending wealth', '25th pct ending wealth', 'annual spending'] },
  { id: 'sm_seq_run', group: 'Sequence stress', sub: 'sequence_risk', title: 'Run sequence stress test', keys: ['run', 'historical scenarios', 'bad-start', '2008 crash', 'dot-com bust', 'stagflation', 'secular bull'] },
  { id: 'sm_seq_scenarios', group: 'Sequence stress', sub: 'sequence_risk', title: 'Success rate by scenario', keys: ['sequence risk meter', 'success rate by scenario', 'baseline', 'bad start', 'scenario'] },
  { id: 'sm_seq_penalty', group: 'Sequence stress', sub: 'sequence_risk', title: 'Sequence risk penalty', keys: ['sequence risk penalty', 'worst case', 'baseline success', 'worst scenario', 'max penalty', 'interpretation'] },
  { id: 'sm_seq_detail', group: 'Sequence stress', sub: 'sequence_risk', title: 'Scenario detail', keys: ['success', 'vs base', 'median ending', 'P10', 'scenario description'] },
  { id: 'sm_wd_run', group: 'Withdrawal rules', sub: 'withdrawal', title: 'Compare withdrawal strategies', keys: ['compare strategies', 'income-first', 'total return', 'tax-optimized', 'run'] },
  { id: 'sm_wd_compare', group: 'Withdrawal rules', sub: 'withdrawal', title: 'Strategy comparison — success rate', keys: ['strategy comparison', 'success rate', 'best strategy for your profile', 'winner', '90%'] },
  { id: 'sm_wd_strategies', group: 'Withdrawal rules', sub: 'withdrawal', title: 'Strategy detail', keys: ['recommended', 'success rate', 'median ending', 'P10', 'median path'] },
  { id: 'sm_sr_run', group: 'Safe spending range', sub: 'spending_range', title: 'Compute spending range', keys: ['compute', 'grid search', 'safe', 'comfortable', 'aggressive', 'current spending'] },
  { id: 'sm_sr_thresholds', group: 'Safe spending range', sub: 'spending_range', title: 'Spending thresholds', keys: ['safe spending', '95%', 'comfortable', '85%', 'aggressive', '70%', 'current success rate'] },
  { id: 'sm_sr_curve', group: 'Safe spending range', sub: 'spending_range', title: 'Spending vs success curve', keys: ['spending vs success', 'curve', 'safe 95%', 'OK 85%', 'current'] },
  { id: 'sm_sr_levels', group: 'Safe spending range', sub: 'spending_range', title: 'Success rate by spending level', keys: ['spending level', 'success rate', 'current'] },
  { id: 'sm_sb_inputs', group: 'What-if sandbox', sub: 'sandbox', title: 'Baseline and what-if scenario', keys: ['baseline scenario', 'what-if scenario', 'spending', 'return', 'volatility', 'inflation', 'SS annual', 'target age', 'reset', 'compare vs baseline'] },
  { id: 'sm_sb_results', group: 'What-if sandbox', sub: 'sandbox', title: 'Baseline vs what-if results', keys: ['baseline', 'what-if', 'success rate', 'median ending wealth', 'P10', 'delta success rate', 'delta median ending wealth', 'changes applied'] },
  { id: 'sm_notes', group: 'What it means', title: 'What it means', keys: ['explanation', 'notes', 'how to read', 'success rate', 'failure line'] },
  { id: 'sm_wellness', group: 'What it means', title: 'Financial wellness', keys: ['lasts to 100', 'lasts to 95', 'safe spending', 'portfolio at 95', 'failure line', 'wellness'] },
  { id: 'sm_future', group: 'What it means', title: 'Future strategy timeline', adv: true, keys: ['unrealized gains', 'cost basis', 'market value', 'threshold crossing', 'State A → B', 'State B → C', 'full harvest', 'dividend load alert', 'controlled sale', 'SWVXX bucket'] },
]

export const subTabs: SubTabMeta[] = [
  { id: 'monte_carlo', label: 'Lifetime projection' },
  { id: 'sequence_risk', label: 'Sequence stress' },
  { id: 'withdrawal', label: 'Withdrawal rules' },
  { id: 'spending_range', label: 'Safe spending range' },
  { id: 'sandbox', label: 'What-if sandbox' },
]
