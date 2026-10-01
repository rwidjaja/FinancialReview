import { PanelHeader, DataRow, Divider, TermBadge } from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { gainColor, fmtPct } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const Y = 'var(--yellow)'
const M = 'var(--text2)'

interface Props { data: DashboardData }

export function MarketContext({ data }: Props) {
  const mc = data.market_context
  const pi = data.portfolio_intel
  if (!mc) return null

  const sp = mc['S&P 500']
  const dow = mc['Dow Jones']
  const vix = data.vix_current
  const vixAvg = data.vix_90d_avg

  const vixColor = vix == null ? M : vix > 25 ? R : vix > 18 ? A : vix < 14 ? 'var(--blue)' : G
  const regimeColor = pi?.market_regime === 'EXPANSION' ? G : pi?.market_regime === 'RISK-OFF' ? R : Y
  const posColor = pi?.positioning === 'AGGRESSIVE' ? R : pi?.positioning === 'CONSERVATIVE' ? G : Y
  const mismatch = (pi?.market_regime === 'RISK-OFF' && pi?.positioning === 'AGGRESSIVE') ||
    (pi?.market_regime === 'EXPANSION' && pi?.positioning === 'CONSERVATIVE')

  const vixPct = vix ? Math.min(100, (vix / 40) * 100) : 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>

      {/* S&P 500 */}
      {sp && sp.price != null && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <PanelHeader>S&amp;P 500</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>
              {sp.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <DataRow label="20D MOM"
              value={<span style={{ color: gainColor(sp.momentum_20d) }}>{fmtPct(sp.momentum_20d != null ? sp.momentum_20d * 100 : null)}</span>} />
            <DataRow label="90D TREND"
              value={<span style={{ color: gainColor(sp.trend_90d) }}>{fmtPct(sp.trend_90d != null ? sp.trend_90d * 100 : null)}</span>} />
            <DataRow label="1Y TOTAL RET"
              value={<span style={{ color: gainColor(sp.total_return_1y) }}>{fmtPct(sp.total_return_1y != null ? sp.total_return_1y * 100 : null)}</span>} />
          </div>
        </div>
      )}

      {/* Dow */}
      {dow && dow.price != null && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <PanelHeader>Dow Jones</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>
              {dow.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <DataRow label="20D MOM"
              value={<span style={{ color: gainColor(dow.momentum_20d) }}>{fmtPct(dow.momentum_20d != null ? dow.momentum_20d * 100 : null)}</span>} />
            <DataRow label="90D TREND"
              value={<span style={{ color: gainColor(dow.trend_90d) }}>{fmtPct(dow.trend_90d != null ? dow.trend_90d * 100 : null)}</span>} />
            <DataRow label="1Y TOTAL RET"
              value={<span style={{ color: gainColor(dow.total_return_1y) }}>{fmtPct(dow.total_return_1y != null ? dow.total_return_1y * 100 : null)}</span>} />
          </div>
        </div>
      )}

      {/* VIX */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
        <PanelHeader>Volatility (VIX)</PanelHeader>
        <div style={{ padding: '8px 10px' }}>
          <div style={{ fontSize: 28, fontWeight: 500, color: vixColor, letterSpacing: -1, marginBottom: 2 }}>
            {vix != null ? vix.toFixed(1) : '—'}
          </div>
          <MiniBar value={vixPct} color={vixColor} width={120} height={4} />
          <div className="bb-sub" style={{ marginTop: 4 }}>
            90D AVG: <span style={{ fontWeight: 500 }}>{vixAvg?.toFixed(1) ?? '—'}</span>
          </div>
          <Divider />
          <div style={{ fontSize: 12, color: vixColor }}>
            {vix == null ? '—'
              : vix < 14 ? ' SUPPRESSED · LOW PREMIUMS'
              : vix < 18 ? 'LOW-NORMAL RANGE'
              : vix < 25 ? '✓ HEALTHY RANGE'
              : ' ELEVATED · MARKET STRESS'}
          </div>
        </div>
      </div>

      {/* Regime */}
      {pi && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderLeft: mismatch ? `2px solid ${A}` : undefined }}>
          <PanelHeader>Market Regime</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontSize: 18, fontWeight: 500, color: regimeColor, marginBottom: 2 }}>
              {pi.market_regime}
            </div>
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: M }}>VIX REGIME: </span>
              <span style={{ fontWeight: 500, color: pi.vol_regime === 'HIGH' ? R : pi.vol_regime === 'LOW' ? G : M }}>
                {pi.vol_regime}
              </span>
            </div>
            <div className="bb-sub" style={{ marginBottom: 6 }}>{pi.trend_signal}</div>
            <Divider label="positioning" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <TermBadge color={posColor}>{pi.positioning}</TermBadge>
              <span className="bb-sub">β {pi.weighted_beta}</span>
            </div>
            <div className="bb-sub" style={{ marginTop: 4 }}>GROWTH {pi.tech_growth_pct}%</div>
            {mismatch && (
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 500, color: A }}>
                 REGIME MISMATCH
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
