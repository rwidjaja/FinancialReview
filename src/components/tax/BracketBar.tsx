import { fmtMoneyFull, fmtMoney } from '../../utils/formatters'
import { G, R, M, Y, A } from './taxColors'

export function BracketBar({ brackets }: { brackets: { rate: number; amount_in_bracket: number; tax_in_bracket: number }[] }) {
  const total = brackets.reduce((s, b) => s + b.amount_in_bracket, 0)
  if (total === 0) return null
  const bracketColors = [G, G, Y, A, R, R]
  return (
    <div>
      <div style={{ display: 'flex', height: 16, overflow: 'hidden', gap: 1 }}>
        {brackets.map((b, i) => {
          const pct = (b.amount_in_bracket / total) * 100
          if (pct < 0.1) return null
          return (
            <div key={i} style={{
              width: `${pct}%`, background: bracketColors[i] ?? M,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 12, color: 'var(--fd-ink)', fontWeight: 500 }}>
                {(b.rate * 100).toFixed(0)}%
              </span>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {brackets.map((b, i) => (
          <div key={i} style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ color: bracketColors[i] }}>●</span>
            <span style={{ color: M }}>{(b.rate * 100).toFixed(0)}%:</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{fmtMoneyFull(b.amount_in_bracket)}</span>
            <span style={{ color: R }}>→ {fmtMoney(b.tax_in_bracket)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
