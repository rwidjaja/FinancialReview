import type { SectionMeta } from './types'

const P = 'Phases', H = 'Plan health'

const phaseKeys = ['insight', 'receipts', 'primary tabs', 'what to do in this phase']

export const sections: SectionMeta[] = [
  { id: 'rm_phase_bar', group: P, title: 'Phase bar', keys: ['phase', 'you are here', 'estimate', 'complete', 'upcoming', 'boundaries'] },
  { id: 'rm_phase_final_prep', group: P, title: 'Final Prep', keys: [...phaseKeys, 'this year\'s cash plan', 'dividends vs draw', 'baseline spending covered by dividends', 'remaining conversion room', 'conversion room used'] },
  { id: 'rm_phase_bridge', group: P, title: 'Bridge', keys: [...phaseKeys, 'Rollover IRA balance', 'withdrawal state', 'Roth conversion', 'baseline spending covered by dividends'] },
  { id: 'rm_phase_conversion_tail', group: P, title: 'Conversion Tail', keys: [...phaseKeys, 'remaining conversion room', 'Rollover IRA balance', 'years until Social Security'] },
  { id: 'rm_phase_ss_active', group: P, title: 'SS Active', keys: [...phaseKeys, 'Social Security benefit', 'bracket pressure', 'years until RMD'] },
  { id: 'rm_phase_rmd', group: P, title: 'RMD', keys: [...phaseKeys, 'estimated first-year RMD', 'estimated RMD tax', 'rollover balance at RMD age'] },

  { id: 'rm_on_track', group: H, title: 'Not fully on track', keys: ['on track', 'scorecard', 'flagged', 'status'] },
  { id: 'rm_survivor', group: H, title: 'Survivor bracket check', keys: ['survivor', 'MFJ → single', 'extra tax', 'bracket', 'pre-tax balance'] },
  { id: 'rm_boundaries', group: H, title: 'Forecast at each boundary', keys: ['forecast', 'base case', 'end of phase', 'portfolio value', 'boundary'] },
  { id: 'rm_checklist', group: H, title: "This year's checklist", adv: true, keys: ['checklist', 'year actions', 'to do', 'done'] },
]
