import { PanelHeader } from '../ui/Terminal'
import { fmtMoneyFull } from '../../utils/formatters'
import { G, R, A, M, Y, roundTo2 } from './simTypes'
import { MetricTooltip } from '../ui/MetricTooltip'

// ── V3 Visual Components ──────────────────────────────────────────────────────

export function LongevityMeter({ currentAge, targetAge, onTargetAgeChange }: {
  currentAge: number
  targetAge: number
  onTargetAgeChange?: (age: number) => void
}) {
  const ages = [85, 90, 95, 100]
  const interactive = !!onTargetAgeChange
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px' }}>LONGEVITY HORIZON</div>
        {interactive && <div style={{ fontSize: 12, color: M, opacity: 0.6 }}>click to set target age</div>}
      </div>
      <div style={{ display: 'flex', gap: 1 }}>
        {ages.map(age => {
          const canonicalAge = age === 100 ? 100 : age
          const isTarget = age === targetAge || (targetAge > 95 && age === 100) || (targetAge <= 87 && age === 85)
          const isPast = age < targetAge
          return (
            <div
              key={age}
              onClick={() => onTargetAgeChange?.(canonicalAge)}
              style={{
                flex: 1, textAlign: 'center', padding: '5px 2px',
                background: isTarget ? 'var(--fd-card)' : isPast ? 'var(--panel)' : 'var(--bg)',
                border: `1px solid ${isTarget ? A : 'var(--border2)'}`,
                borderBottom: isTarget ? `3px solid ${A}` : '3px solid transparent',
                cursor: interactive ? 'pointer' : 'default',
                transition: 'background 0.12s ease, border-color 0.12s ease',
              }}
              onMouseEnter={e => {
                if (interactive && !isTarget) (e.currentTarget as HTMLDivElement).style.background = 'var(--fd-card)'
              }}
              onMouseLeave={e => {
                if (interactive && !isTarget) (e.currentTarget as HTMLDivElement).style.background = isPast ? 'var(--panel)' : 'var(--bg)'
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: isTarget ? A : M }}>
                {age === 100 ? '100+' : `${age}`}
              </div>
              <div style={{ fontSize: 12, color: M }}>{age - currentAge}y</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SequenceRiskMeter({ withdrawalRate, seqRiskPct }: {
  withdrawalRate?: number | null
  seqRiskPct?: number | null  // actual simulation penalty (0–1 fraction); required when withdrawalRate not provided
}) {
  if (withdrawalRate == null && seqRiskPct == null) return null

  // When a simulation result is available, derive level from the actual penalty.
  // seqRiskPct is the drop in success rate caused by bad early returns (0–1).
  // Thresholds: <5% = LOW, <12% = MODERATE, <20% = HIGH, ≥20% = CRITICAL
  const fromSim = seqRiskPct != null
  const simPenalty = fromSim ? (seqRiskPct! * 100) : null
  const simLevel = simPenalty == null ? null
    : simPenalty < 5  ? 'LOW'
    : simPenalty < 12 ? 'MODERATE'
    : simPenalty < 20 ? 'HIGH'
    : 'CRITICAL'

  // Fallback: withdrawal-rate proxy (only when no sim result)
  const wrLevel = withdrawalRate == null ? null
    : withdrawalRate < 3 ? 'LOW' : withdrawalRate < 4 ? 'MODERATE' : withdrawalRate < 5 ? 'HIGH' : 'CRITICAL'

  const level = (simLevel ?? wrLevel) ?? 'LOW'
  const color = level === 'LOW' ? G : level === 'MODERATE' ? Y : level === 'HIGH' ? A : R

  const tiers = [
    { label: 'LOW',      color: G },
    { label: 'MODERATE', color: Y },
    { label: 'HIGH',     color: A },
    { label: 'CRITICAL', color: R },
  ]

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px' }}>SEQUENCE RISK METER</div>
        <div style={{ fontSize: 12, color: fromSim ? color : M, fontWeight: fromSim ? 700 : 400 }}>
          {fromSim ? `sim · worst-case −${simPenalty!.toFixed(1)}pp` : withdrawalRate != null ? `proxy · WR ${withdrawalRate.toFixed(1)}%` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 1 }}>
        {tiers.map(t => {
          const isActive = t.label === level
          return (
            <div key={t.label} style={{
              flex: 1, textAlign: 'center', padding: '5px 2px',
              background: isActive ? `${t.color}20` : 'var(--panel)',
              border: `1px solid ${isActive ? t.color : 'var(--border2)'}`,
              borderBottom: isActive ? `3px solid ${t.color}` : '3px solid transparent',
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: isActive ? t.color : M }}>{t.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function InterpretationPanel({ title, items }: { title: string; items: { label: string; value: string; color: string; note?: string }[] }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', padding: '12px 14px' }}>
      <PanelHeader>{title}</PanelHeader>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div>
              <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase' }}>{item.label}</div>
              {item.note && <div style={{ fontSize: 12, color: M, marginTop: 2, lineHeight: 1.4 }}>{item.note}</div>}
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: item.color, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Slider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string
  onChange: (v: number) => void
}) {
  // Round the displayed value to 2 decimal places
  const displayValue = unit === '%' ? roundTo2(value) : Math.round(value)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 500 }}>
          {unit === '$' ? fmtMoneyFull(displayValue) : `${displayValue}${unit ?? ''}`}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        aria-label={label}
        style={{ width: '100%' }}
      />
    </div>
  )
}

export function StatBox({ label, value, color, metricId }: { label: string; value: string; color: string; metricId?: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 12px' }}>
      <div className="bb-label" style={{ marginBottom: 4, display: 'inline-flex', alignItems: 'center' }}>
        {label}
        {metricId && <MetricTooltip metricId={metricId} label={label} />}
      </div>
      <div style={{ fontSize: 18, fontWeight: 500, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  )
}
