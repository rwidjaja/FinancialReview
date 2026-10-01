import { fmtPct } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, A, M } from './DetailTab.constants'

export function RothConversionBanner({ data, ia }: { data: DashboardData; ia: DashboardData['income_analytics'] }) {
  const convWindow = (data.tax_data as unknown as Record<string, unknown>)?.['conv_window'] as string | undefined
    ?? ia?.conversion_window ?? null

  if (!convWindow) return null

  const isOpen = convWindow === 'OPEN'
  const isWatch = convWindow === 'WATCH'
  const bannerColor = isOpen ? G : isWatch ? A : M
  const bannerBg = isOpen ? 'var(--fd-card)' : isWatch ? 'var(--fd-card)' : 'var(--fd-card)'
  const bannerText = isOpen
    ? 'CONVERSION WINDOW OPEN — Conditions favorable, conversion recommended'
    : isWatch
    ? 'MONITOR BRACKET PRESSURE — Wait for a cleaner window'
    : 'WINDOW CURRENTLY CLOSED — Defer conversions'

  return (
    <div style={{
      margin: '0 0 8px',
      padding: '8px 14px',
      border: `1px solid ${bannerColor}`,
      borderLeft: `4px solid ${bannerColor}`,
      background: bannerBg,
      fontSize: 12,
      fontWeight: 500,
      color: bannerColor,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <span>{isOpen ? '●' : isWatch ? '◐' : '○'}</span>
      <span>{bannerText}</span>
    </div>
  )
}

export function RothConversionTable({ data }: { data: DashboardData }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="bb-table">
        <thead>
          <tr>
            <th>SYMBOL</th>
            <th className="r">SHARES</th>
            <th className="r">PRICE</th>
            <th className="r">NAV</th>
            <th className="r">PREM/DISC</th>
            <th>STATUS</th>
            <th>RECOMMENDATION</th>
          </tr>
        </thead>
        <tbody>
          {(data.roth_conversions ?? []).map(rc => {
            const premColor = rc.premium != null
              ? (rc.premium < -0.005 ? G : rc.premium > 0.02 ? R : M)
              : M
            return (
              <tr key={rc.symbol}>
                <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{rc.symbol}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>{rc.shares.toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
                <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>${rc.price.toFixed(2)}</td>
                <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>{rc.nav != null ? `$${rc.nav.toFixed(2)}` : '—'}</td>
                <td className="r" style={{ color: premColor, fontFamily: 'var(--font-mono)' }}>
                  {rc.premium != null ? fmtPct(rc.premium * 100, 2) : '—'}
                </td>
                <td style={{ fontSize: 12 }}>{rc.status}</td>
                <td style={{ fontSize: 12, color: A }}>{rc.recommendation}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
