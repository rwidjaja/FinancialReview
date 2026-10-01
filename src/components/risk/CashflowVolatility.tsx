import { Panel, Stat, G, R, A, M, fmtK, fmtPct } from './shared'
import type { DashboardData } from '../../types/dashboard'

// ─── 5. CASHFLOW VOLATILITY ───────────────────────────────────────────────────
// cashflow_vol_pct and inc_stability_pct are stored as percent (e.g. 44.4 = 44.4%)
export function CashflowVolatility({ data }: { data: DashboardData }) {
  const pi  = data.portfolio_intel
  const si  = data.spending_intelligence
  const ia  = data.income_analytics

  // Fields already in percent form — do NOT multiply by 100
  const cfVol    = si?.cashflow_vol_pct ?? null          // e.g. 68.6 = 68.6%
  const stabPct  = pi.inc_stability_pct ?? 0             // e.g. 44.4 = 44.4%
  const stabLbl  = pi.inc_stability_lbl

  const durScore = pi.income_durability_score
  const durColor  = durScore >= 70 ? G : durScore >= 40 ? A : R
  const stabColor = stabPct >= 70 ? G : stabPct >= 40 ? A : R
  const volColor  = cfVol == null ? M : cfVol < 10 ? G : cfVol < 20 ? A : R

  const totalInc = Math.max(1, ia?.portfolio_fwd_12m ?? 1)

  // Build per-symbol income by aggregating ia.by_account[*].by_symbol
  // This is the correct source — income_attribution object shape differs from the TS array type
  const byAcct = ia?.by_account ?? {}
  const incBySym: Record<string, number> = {}
  for (const acct of Object.values(byAcct)) {
    for (const [sym, amt] of Object.entries((acct as any).by_symbol ?? {})) {
      incBySym[sym] = (incBySym[sym] ?? 0) + (amt as number)
    }
  }

  // Only show currently held positions — exclude sold/stale income data
  const heldSyms = new Set<string>()
  for (const acct of data.accounts)
    for (const p of acct.positions)
      if (!p.is_money_market) heldSyms.add(p.symbol)

  const topContribs = Object.entries(incBySym)
    .filter(([sym, amt]) => amt > 0 && heldSyms.has(sym))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([symbol, amount]) => ({
      symbol,
      amount,
      pct: (amount / totalInc) * 100,
    }))

  // Concentration: % in top 4 tickers
  const top4Sum = topContribs.slice(0, 4).reduce((s, c) => s + c.amount, 0)
  const concPct = (top4Sum / totalInc) * 100

  return (
    <Panel title="◈ Cashflow Volatility" sub="Income stability · concentration risk" color={durColor}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 10 }}>
        <Stat label="Stability Score"   value={`${stabPct.toFixed(0)}% [${stabLbl}]`} color={stabColor} large />
        {cfVol != null && <Stat label="Cashflow Volatility" value={fmtPct(cfVol)} color={volColor} sub="annualized" />}
        <Stat label="Top-4 Concentration" value={isNaN(concPct) ? '—' : `${concPct.toFixed(0)}%`} color={concPct > 70 ? R : concPct > 50 ? A : G} sub="of total income" />
      </div>

      {topContribs.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 5 }}>Income by Ticker</div>
          {topContribs.map(c => (
            <div key={c.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', minWidth: 52 }}>{c.symbol}</span>
              <div style={{ flex: 1, height: 4, background: 'var(--fd-card)', borderRadius: 0, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, c.pct)}%`, height: '100%', background: G, borderRadius: 0, opacity: 0.7 }} />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: G, minWidth: 48, textAlign: 'right' }}>{fmtK(c.amount)}</span>
              <span style={{ fontSize: 12, color: M, minWidth: 32 }}>{c.pct.toFixed(0)}%</span>
            </div>
          ))}
        </>
      )}
    </Panel>
  )
}
