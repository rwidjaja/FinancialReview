import { Sparkline } from '../ui/Sparkline'
import { fmtPct, fmtPrice, gainColor } from '../../utils/formatters'
import type { DashboardData, PerfPeriod } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'

export function SymbolCharts({ data, perfData, period }: {
  data: DashboardData
  perfData: Record<string, Record<string, PerfPeriod>>
  period: string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8, padding: 8 }}>
      {data.decisions.map(dec => {
        const pd = perfData[dec.symbol]?.[period]     // period slice (1m, 3m, etc.)
        const ps = perfData[dec.symbol] as any          // parent symbol object (has start_price, end_price)
        if (!pd) return null
        const retColor = gainColor(pd.total_return)
        return (
          <div key={dec.symbol} style={{
            background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
            borderTop: `2px solid ${retColor}`, borderRadius: 0, padding: '8px 10px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{dec.symbol}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: retColor }}>
                {fmtPct(pd.total_return)}
              </span>
            </div>
            {/* Start → End price — use parent symbol object, not period slice */}
            <div style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
              START: {ps?.start_price != null ? fmtPrice(ps.start_price) : '—'} → END: {ps?.end_price != null ? fmtPrice(ps.end_price) : '—'}
            </div>
            {pd.pct_returns.length > 1 && (
              <Sparkline
                data={pd.pct_returns.map(p => 100 + p)}
                color={retColor}
                width={200}
                height={36}
              />
            )}
            <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <div style={{ fontSize: 12, color: M }}>SHARPE</div>
              <div style={{ fontSize: 12, color: pd.sharpe >= 1 ? G : pd.sharpe >= 0.5 ? Y : R, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                {pd.sharpe.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: M }}>VOLATILITY</div>
              <div style={{ fontSize: 12, textAlign: 'right', fontFamily: 'var(--font-mono)', color: M }}>
                {fmtPct(pd.vol_annual)}
              </div>
              <div style={{ fontSize: 12, color: M }}>MAX DD</div>
              <div style={{ fontSize: 12, color: R, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                {fmtPct(pd.max_drawdown)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
