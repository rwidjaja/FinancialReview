const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'

export function VolRegimeMeter({ avgVol, label, color }: { avgVol: number; label: string; color: string }) {
  const tiers = [
    { key: 'low',     label: 'LOW',     max: 12,  color: G },
    { key: 'normal',  label: 'NORMAL',  max: 20,  color: Y },
    { key: 'high',    label: 'HIGH VOL',max: 40,  color: A },
    { key: 'extreme', label: 'EXTREME', max: 9999,color: R },
  ]
  const activeIdx = tiers.findIndex(t => avgVol < t.max)
  return (
    <div style={{
      padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
      borderLeft: `3px solid ${color}`, borderRadius: 0, height: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px' }}>◈ VOLATILITY REGIME</span>
        <span style={{ fontSize: 12, fontWeight: 500, color, fontFamily: 'var(--font-mono)' }}>{label}</span>
        <span style={{ fontSize: 12, color: M }}>
          AVG VOL: <span style={{ color, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{avgVol.toFixed(1)}%</span>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {tiers.map((t, i) => (
          <div key={t.key} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{
              height: 6, borderRadius: 0,
              background: i <= activeIdx ? t.color : 'var(--border2)',
              opacity: i === activeIdx ? 1 : i < activeIdx ? 0.45 : 0.18,
            }} />
            <div style={{ fontSize: 12, marginTop: 2, fontWeight: i === activeIdx ? 700 : 400, color: i === activeIdx ? t.color : M }}>
              {t.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ConcentrationMeter({ top1, top3, top5 }: { top1: number; top3: number; top5: number }) {
  // Composite concentration score 0-100
  const score = Math.min(100, top1 * 1.5 + (top3 - top1) * 0.8 + (top5 - top3) * 0.4)
  const divScore = Math.max(0, Math.min(100, Math.round(100 - score)))
  const tiers = [
    { key: 'safe',     label: 'SAFE',     max: 25,  color: G },
    { key: 'moderate', label: 'MODERATE', max: 45,  color: Y },
    { key: 'high',     label: 'HIGH',     max: 65,  color: A },
    { key: 'critical', label: 'CRITICAL', max: 9999,color: R },
  ]
  const activeIdx = tiers.findIndex(t => score < t.max)
  const activeColor = tiers[activeIdx]?.color ?? R
  return (
    <div style={{
      padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
      borderRadius: 0, height: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px' }}>◈ CONCENTRATION RISK</span>
        {([
          { label: 'TOP 1', val: top1, rT: 30, aT: 20 },
          { label: 'TOP 3', val: top3, rT: 60, aT: 50 },
          { label: 'TOP 5', val: top5, rT: 80, aT: 70 },
        ] as { label: string; val: number; rT: number; aT: number }[]).map(({ label, val, rT, aT }) => {
          const c = val > rT ? R : val > aT ? A : G
          return (
            <span key={label} style={{ fontSize: 12, color: M }}>
              {label}: <span style={{ color: c, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{val.toFixed(1)}%</span>
            </span>
          )
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{ fontSize: 12, color: M, textTransform: 'uppercase' }}
            title="Diversity score: 100 = fully diversified, 0 = maximally concentrated. Computed from weighted top-N holdings."
          >DIVERSITY</span>
          <span style={{
            fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)',
            color: divScore >= 60 ? G : divScore >= 40 ? Y : R,
          }}>{divScore}</span>
          <span style={{ fontSize: 12, color: M }}>/100</span>
          <span style={{
            fontSize: 12, fontWeight: 500, padding: '1px 5px', borderRadius: 0,
            background: `${activeColor}22`, color: activeColor, border: `1px solid ${activeColor}`,
            fontFamily: 'var(--font-mono)',
          }}>{tiers[activeIdx]?.label ?? 'CRITICAL'}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {tiers.map((t, i) => (
          <div key={t.key} style={{ flex: 1 }}>
            <div style={{
              height: 6, borderRadius: 0,
              background: i <= activeIdx ? t.color : 'var(--border2)',
              opacity: i === activeIdx ? 1 : i < activeIdx ? 0.45 : 0.18,
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: M }}>
        <span>Low</span>
        <span style={{ fontWeight: 500, color: activeColor }}>{tiers[activeIdx]?.label ?? 'CRITICAL'}</span>
        <span>Extreme</span>
      </div>
      {activeIdx >= 2 && (
        <div style={{ marginTop: 4, fontSize: 12, color: activeColor }}>
           {activeIdx === 3
            ? `Single-symbol risk dominates portfolio${divScore === 0 ? ' · DIVERSITY 0/100 is correct — concentration score = 100' : ''}`
            : 'Top holdings represent outsized portfolio weight'}
        </div>
      )}
    </div>
  )
}
