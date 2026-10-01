import { useState, useEffect } from 'react'
import { DataRow, Divider } from '../ui/Terminal'
import { fmtMoneyFull } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import { G, R, A, M, Y } from './taxColors'
import { computeConversionVerdict, verdictTone } from '../../utils/conversionVerdict'
import type { DashboardData } from '../../types/dashboard'

export function PortfolioScores({ tx, bktColor }: { tx: DashboardData['tax_data']; bktColor: string }) {
  const [animated, setAnimated] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 60)
    return () => clearTimeout(t)
  }, [])

  const _bktRateLbl = `${tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}%`
  const b22max = tx.target_bracket_ceiling ?? tx.optimal_conv ?? 0
  const convYtd = tx.converted_ytd ?? 0
  // Use gross_actual (divs + ytd-only conversions + STCG) — matches the taxable-basis
  // percentage bar above. gross_no_ss uses max(ytd, annual_plan) which inflates AGI
  // by the unexecuted plan target, contradicting the actual-basis % bar.
  const grossActual = tx.gross_actual ?? tx.gross_no_ss ?? 0
  const totalConvRoom = b22max - grossActual
  const detailLine = b22max > 0
    ? `Ceiling ${fmtMoneyFull(b22max)} − AGI (actual) ${fmtMoneyFull(grossActual)} = ${fmtMoneyFull(Math.round(totalConvRoom))} room · ${fmtMoneyFull(convYtd)} converted`
    : null

  const convEff = tx.conv_efficiency_score
  const convEffColor = convEff == null ? M : convEff >= 70 ? G : convEff >= 40 ? Y : R

  const scores = [
    {
      label: `${_bktRateLbl} bracket headroom`,
      value: tx.bracket_pressure_pct != null ? `${(100 - tx.bracket_pressure_pct).toFixed(0)}%` : '—',
      color: bktColor,
      bar: 100 - (tx.bracket_pressure_pct ?? 0),
      detail: detailLine
        ? `${detailLine} · bracket pressure ${tx.bracket_pressure_pct?.toFixed(0)}%`
        : null,
    },
    {
      label: 'Income tax efficiency',
      value: tx.income_tax_score != null ? `${tx.income_tax_score}/100` : '—',
      color: tx.income_tax_score != null ? (tx.income_tax_score >= 70 ? G : tx.income_tax_score >= 40 ? Y : R) : M,
      bar: tx.income_tax_score ?? 0,
      detail: 'higher = better · 100 = minimal tax drag on income',
    },
    {
      label: 'SEQ risk score',
      value: tx.seq_risk_score != null ? `${tx.seq_risk_score}/100` : '—',
      color: tx.seq_risk_score != null ? (tx.seq_risk_score >= 70 ? G : tx.seq_risk_score >= 40 ? Y : R) : M,
      bar: tx.seq_risk_score ?? 0,
      detail: 'higher = better · 100 = no sequence-of-returns risk',
    },
    {
      label: 'Conversion efficiency',
      value: convEff != null ? `${convEff}/100` : '—',
      color: convEffColor,
      bar: convEff ?? 0,
      detail: 'higher = better · 100 = converting at optimal bracket pace',
    },
  ]

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--fd-hairline)',
      borderRadius: 0,
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {scores.map(s => (
        <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: M }}>{s.label}</span>
            <span style={{ fontWeight: 500, color: s.color }}>{s.value}</span>
          </div>
          <div style={{ height: 3, background: 'var(--fd-card)', borderRadius: 0 }}>
            <div style={{
              height: 3,
              borderRadius: 0,
              background: s.color,
              width: animated ? `${Math.min(100, Math.max(0, s.bar))}%` : '0%',
              transition: 'width 0.8s ease',
            }} />
          </div>
          {s.detail && (
            <div style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)' }}>{s.detail}</div>
          )}
        </div>
      ))}
      {tx.bracket_pressure_trend && (
        <div style={{ fontSize: 12, color: A, marginTop: 2 }}>{tx.bracket_pressure_trend}</div>
      )}
      {tx.annual_conversion != null && tx.annual_conversion > 0 && (() => {
        const verdict = computeConversionVerdict(tx)
        const vColor = verdict == null ? M
          : verdictTone(verdict.status) === 'good' ? G
          : verdictTone(verdict.status) === 'bad' ? R : Y
        const stopWithOption = verdict?.status === 'STOP' && verdict.bracketFillRemaining > 0
        return (
          <>
            <Divider label="conversion" />
            <DataRow label="ANNUAL CONV TARGET" value={<span style={{ color: A, fontWeight: 500 }}>{fmtMoneyFull(tx.annual_conversion!)}</span>} />
            {tx.remaining_to_convert != null && (
              <DataRow
                label={stopWithOption ? 'REMAINING (PLAN)' : 'REMAINING'}
                value={<span style={{ color: A }}>{fmtMoneyFull(tx.remaining_to_convert)}{stopWithOption ? ' — bracket-fill option' : ''}</span>}
              />
            )}
            {verdict && (
              <DataRow label="VERDICT" value={<span style={{ color: vColor, fontWeight: 500 }}>{verdict.headline}</span>} />
            )}
          </>
        )
      })()}
    </div>
  )
}
