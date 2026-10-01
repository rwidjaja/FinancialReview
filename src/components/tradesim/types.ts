export interface Portfolio {
  portfolio_id: number
  name: string
  description: string
  seed_capital: number
  current_cash: number
  total_value: number
  total_return: number
  total_return_pct: number
  holdings_value: number
  positions?: number
  ytd_dividends?: number
  all_time_dividends?: number
  unrealized_pnl?: number
  holdings?: Holding[]
  watchlist?: WatchlistItem[]
  created_at: string
  is_default?: number
}

export interface Holding {
  symbol: string
  name?: string
  total_shares: number
  average_cost: number
  total_cost: number
  current_price: number
  market_value: number
  unrealized_pnl: number
  unrealized_pnl_pct: number
  day_change: number
  day_change_pct: number
  portfolio_pct: number
  last_updated: string
  // ── Income & dividend metadata ─────────────────────────────────────────────
  dividend_yield: number | null        // annual yield % (stored or yfinance)
  annual_dividend_per_share: number | null
  ex_dividend_date: string | null
  next_payment_date: string | null
  next_payment_per_share: number | null
  dividend_growth_5y: number | null
  payment_frequency: string | null
  // ── Fundamental / risk metadata ────────────────────────────────────────────
  beta: number | null
  expense_ratio: number | null         // for ETFs, in %
}

export interface Transaction {
  transaction_id: number
  symbol: string
  transaction_type: 'BUY' | 'SELL'
  shares: number
  price_per_share: number
  total_amount: number
  commission: number
  transaction_date: string
  notes: string
}

export interface Dividend {
  dividend_id: number
  symbol: string
  dividend_type: string
  amount_per_share: number
  total_shares: number
  total_amount: number
  payment_date: string
  reinvested: number
  notes: string
}

export interface LimitOrder {
  id: string
  portfolioId: number
  action: 'BUY' | 'SELL'
  symbol: string
  shares: number
  limitPrice: number
  orderType: 'LIMIT_DAY' | 'LIMIT_GTC'
  status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED'
  createdAt: string
  expiresAt: string | null
  filledAt?: string
  filledPrice?: number
  notes?: string
}

export interface SnapshotPoint {
  snapshot_date: string
  total_value: number
  total_pnl: number
  total_pnl_pct: number
  spy_value?: number   // SPY normalised to seed capital
  spy_pct?:   number   // SPY cumulative return % from same start
}

export interface WatchlistItem {
  watchlist_id: number
  symbol: string
  price?: number
  change_pct?: number
  notes: string
}
