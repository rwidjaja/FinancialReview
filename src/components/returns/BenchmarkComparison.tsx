import { PanelHeader, DataRow, Divider } from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { fmtPct, gainColor } from '../../utils/formatters'
import type { PerfPeriod } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'

export function BenchmarkComparison({ portfolio, spy, qqq, period }: {
  portfolio: { total_return: number; vol_annual: number; sharpe: number; max_drawdown: number } | null
  spy: PerfPeriod | null
  qqq: PerfPeriod | null
  period: string
}) {
  const alphaSpy = portfolio && spy ? portfolio.total_return - spy.total_return : null
  const alphaQqq = portfolio && qqq ? portfolio.total_return - qqq.total_return : null

  const rows = [
    { label: 'PORTFOLIO', data: portfolio ? {
      total_return: portfolio.total_return,
      vol_annual: portfolio.vol_annual,
      sharpe: portfolio.sharpe,
      max_drawdown: portfolio.max_drawdown,
    } : null, accent: A },
    { label: 'SPY', data: spy, accent: 'var(--blue)' },
    { label: 'QQQ', data: qqq, accent: 'var(--cyan)' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px' }}>
      {/* Benchmark Spread callout */}
      {(alphaSpy !== null || alphaQqq !== null) && (
        <div style={{ display: 'flex', gap: 8 }}>
          {alphaSpy !== null && (
            <div style={{
              flex: 1, padding: '10px 14px', background: 'var(--surface)',
              border: `1px solid ${alphaSpy >= 0 ? G : R}`,
              borderLeft: `3px solid ${alphaSpy >= 0 ? G : R}`,
              borderRadius: 0,
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', marginBottom: 2 }}>
                ALPHA vs SPY ({period.toUpperCase()})
              </div>
              <div style={{ fontSize: 22, fontWeight: 500, color: alphaSpy >= 0 ? G : R, fontFamily: 'var(--font-mono)' }}>
                {alphaSpy >= 0 ? '+' : ''}{alphaSpy.toFixed(2)}%
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                {alphaSpy >= 0 ? '▲ OUTPERFORMING' : '▼ UNDERPERFORMING'} SPY by {Math.abs(alphaSpy).toFixed(2)}%
              </div>
              <div style={{ marginTop: 4 }}>
                <MiniBar value={Math.min(Math.abs(alphaSpy / 20) * 100, 100)} color={alphaSpy >= 0 ? G : R} width={120} height={4} />
              </div>
            </div>
          )}
          {alphaQqq !== null && (
            <div style={{
              flex: 1, padding: '10px 14px', background: 'var(--surface)',
              border: `1px solid ${alphaQqq >= 0 ? G : R}`,
              borderLeft: `3px solid ${alphaQqq >= 0 ? G : R}`,
              borderRadius: 0,
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', marginBottom: 2 }}>
                ALPHA vs QQQ ({period.toUpperCase()})
              </div>
              <div style={{ fontSize: 22, fontWeight: 500, color: alphaQqq >= 0 ? G : R, fontFamily: 'var(--font-mono)' }}>
                {alphaQqq >= 0 ? '+' : ''}{alphaQqq.toFixed(2)}%
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                {alphaQqq >= 0 ? '▲ OUTPERFORMING' : '▼ UNDERPERFORMING'} QQQ by {Math.abs(alphaQqq).toFixed(2)}%
              </div>
              <div style={{ marginTop: 4 }}>
                <MiniBar value={Math.min(Math.abs(alphaQqq / 20) * 100, 100)} color={alphaQqq >= 0 ? G : R} width={120} height={4} />
              </div>
            </div>
          )}
          {portfolio && (
            <div style={{
              flex: 1, padding: '10px 14px', background: 'var(--surface)',
              border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${A}`,
              borderRadius: 0,
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', marginBottom: 2 }}>
                RISK-ADJ EDGE (SHARPE DIFF)
              </div>
              {spy && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: M }}>vs SPY</span>
                  <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: portfolio.sharpe >= spy.sharpe ? G : R }}>
                    {(portfolio.sharpe - spy.sharpe) >= 0 ? '+' : ''}{(portfolio.sharpe - spy.sharpe).toFixed(2)}
                  </span>
                </div>
              )}
              {qqq && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: M }}>vs QQQ</span>
                  <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: portfolio.sharpe >= qqq.sharpe ? G : R }}>
                    {(portfolio.sharpe - qqq.sharpe) >= 0 ? '+' : ''}{(portfolio.sharpe - qqq.sharpe).toFixed(2)}
                  </span>
                </div>
              )}
              <div style={{ fontSize: 12, color: M, marginTop: 6 }}>
                Portfolio Sharpe: <span style={{ color: portfolio.sharpe >= 1 ? G : portfolio.sharpe >= 0.5 ? Y : R, fontWeight: 500 }}>{portfolio.sharpe.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Side-by-side metric comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {rows.map(({ label, data: d, accent }) => (
          <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${accent}`, borderRadius: 0, padding: '10px 14px' }}>
            <PanelHeader>{label} — {period.toUpperCase()}</PanelHeader>
            {d ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 500, color: gainColor(d.total_return), margin: '4px 0' }}>
                  {fmtPct(d.total_return)}
                </div>
                <Divider />
                <DataRow label="VOLATILITY" value={<span style={{ color: M }}>{fmtPct(d.vol_annual)}</span>} />
                <DataRow label="SHARPE" value={
                  <span style={{ color: d.sharpe >= 1 ? G : d.sharpe >= 0.5 ? Y : R }}>
                    {d.sharpe.toFixed(2)}
                  </span>
                } />
                <DataRow label="MAX DRAWDOWN" value={<span style={{ color: R }}>{fmtPct(d.max_drawdown)}</span>} />
              </>
            ) : (
              <div style={{ color: M, fontSize: 12, marginTop: 8 }}>NO DATA</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
