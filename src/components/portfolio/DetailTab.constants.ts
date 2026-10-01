export const G = 'var(--green)'
export const R = 'var(--red)'
export const A = 'var(--amber)'
export const M = 'var(--text2)'

export type ViewMode = 'simple' | 'advanced'

export type HoldingRow = { 
  symbol: string
  shares: number
  value: number
  cost: number
  pnl: number
  annualInc: number
  dayChg: number
  dayPct: number
  acctCount: number
}

export const SLEEVE_KEYS = ['taxable', 'rollover', 'roth_ira', 'roth', 'ira', '401k']
export const SLEEVE_LABEL: Record<string, string> = {
  taxable: 'Taxable', 
  rollover: 'Rollover IRA', 
  roth_ira: 'Roth IRA', 
  roth: 'Roth', 
  ira: 'IRA', 
  '401k': '401k',
}
export const SLEEVE_COLOR: Record<string, string> = {
  taxable: 'var(--as-lilac)', 
  rollover: '#2dd4bf', 
  roth_ira: 'var(--as-lilac)', 
  roth: 'var(--as-lilac)', 
  ira: '#7dd3fc', 
  '401k': 'var(--as-lilac)',
}