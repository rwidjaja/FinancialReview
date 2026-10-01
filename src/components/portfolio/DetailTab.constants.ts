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
  taxable: 'var(--fd-lilac-ink)', 
  rollover: 'var(--fd-lime-ink)', 
  roth_ira: 'var(--fd-lilac-ink)', 
  roth: 'var(--fd-lilac-ink)', 
  ira: 'var(--fd-accent)', 
  '401k': 'var(--fd-lilac-ink)',
}