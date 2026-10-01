// ── ETF Component Engine ──────────────────────────────────────────────────────

import { G, R, A, M } from './researchTypes'
import type { EtfComponentData } from './researchTypes'

export function ETFComponentEngine({ ece, onSymbolClick }: { ece: EtfComponentData; onSymbolClick?: (symbol: string) => void }) {
  const components  = ece.components ?? []
  const dir         = ece.direction_score ?? 0
  const str         = ece.strength_score ?? 0
  const label       = ece.action_label ?? ''
  const top10pct    = ece.top10_weight_pct ?? 0

  const labelColor =
    label.startsWith('STRONG UP')   ? G :
    label.startsWith('WEAK UP')     ? 'var(--fd-lilac-ink)' :
    label.startsWith('STRONG DOWN') ? R :
    label.startsWith('WEAK DOWN')   ? 'var(--fd-lilac-ink)' : M

  const maxContrib = Math.max(...components.map(c => Math.abs(c.contribution)), 0.01)

  // ── Cluster calculation (needed for canonical row) ────────────────────────
  const leaders  = components.filter(c => c.change_pct >= 1.0)
  const laggards = components.filter(c => c.change_pct <= -1.0)
  const allUp    = laggards.length === 0 && leaders.length >= 3
  const allDown  = leaders.length === 0 && laggards.length >= 3
  const alignLabel = allUp ? 'Aligned Up' : allDown ? 'Aligned Down' : leaders.length > laggards.length ? 'Mostly Up' : laggards.length > leaders.length ? 'Mostly Down' : 'Mixed'
  const alignColor = allUp ? G : allDown ? R : leaders.length > laggards.length ? 'var(--fd-lilac-ink)' : laggards.length > leaders.length ? 'var(--fd-lilac-ink)' : M
  const clusterStr = allUp || allDown ? 'High' : Math.abs(leaders.length - laggards.length) >= 2 ? 'Moderate' : 'Low'

  return (
    <div style={{ border: `1px solid var(--fd-hairline)`, background: 'var(--surface)', borderRadius: 0, overflow: 'hidden', flexShrink: 0 }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--fd-hairline)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1.2px' }}>
          ◈ ETF COMPONENT ENGINE
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: M }}>TOP-10: <strong style={{ color: A }}>{top10pct.toFixed(1)}%</strong></span>
          {ece.etf_fair_value != null && (
            <span style={{ fontSize: 12, color: M }}>
              ETF FV: <strong style={{ color: A, fontFamily: 'var(--font-mono)' }}>${ece.etf_fair_value.toFixed(2)}</strong>
              {ece.etf_fv_coverage_pct != null && (
                <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 3 }}>({ece.etf_fv_coverage_pct.toFixed(0)}% cov.)</span>
              )}
            </span>
          )}
          {ece.etf_growth_score != null && (
            <span style={{ fontSize: 12, color: M }}>
              GROWTH: <strong style={{ color: ece.etf_growth_regime === 'HIGH-GROWTH' ? G : ece.etf_growth_regime === 'MODERATE' ? 'var(--fd-lilac-ink)' : M }}>
                {ece.etf_growth_score.toFixed(0)}/100
              </strong>
            </span>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          CANONICAL OUTPUT ROW — 3 numbers, one per category
          Direction · Strength · Cluster
          ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0,
        borderBottom: '1px solid var(--border2)' }}>

        {/* 1 — Direction */}
        <div style={{ padding: '14px 16px', borderRight: '1px solid var(--fd-hairline)' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Direction</div>
          <div style={{ fontSize: 26, fontWeight: 500, fontFamily: 'var(--font-mono)', lineHeight: 1,
            color: dir > 0.10 ? G : dir < -0.10 ? R : M }}>
            {dir > 0 ? '+' : ''}{dir.toFixed(3)}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 4 }}>
            {dir > 0.10 ? '▲ lifting' : dir < -0.10 ? '▼ fading' : '↔ chop'}
          </div>
        </div>

        {/* 2 — Strength */}
        <div style={{ padding: '14px 16px', borderRight: '1px solid var(--fd-hairline)' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Strength</div>
          <div style={{ fontSize: 26, fontWeight: 500, fontFamily: 'var(--font-mono)', lineHeight: 1,
            color: str >= 0.40 ? (dir >= 0 ? G : R) : 'var(--fd-lilac-ink)' }}>
            {str.toFixed(3)}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 4 }}>{ece.strength_label ?? (str >= 0.40 ? 'Strong' : str >= 0.20 ? 'Moderate' : 'Weak')}</div>
          {/* Strength bar */}
          <div style={{ marginTop: 6, display: 'flex', height: 4, gap: 1, borderRadius: 0, overflow: 'hidden' }}>
            {[0.20, 0.40, 0.60, 1.0].map((threshold, i) => {
              const prev = [0, 0.20, 0.40, 0.60][i]
              const fill = Math.max(0, Math.min(threshold, str) - prev) / (threshold - prev) * 100
              const c = [M, 'var(--fd-lilac-ink)', G, G][i]
              return (
                <div key={i} style={{ flex: 1, background: 'var(--bg)' }}>
                  <div style={{ height: '100%', width: `${fill}%`, background: c, opacity: 0.85 }} />
                </div>
              )
            })}
          </div>
        </div>

        {/* 3 — Cluster */}
        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Cluster</div>
          <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)', lineHeight: 1,
            color: alignColor }}>{alignLabel}</div>
          <div style={{ fontSize: 12, color: M, marginTop: 4 }}>{clusterStr} Strength</div>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {leaders.slice(0, 3).map(c => (
              <span key={c.symbol} onClick={() => onSymbolClick?.(c.symbol)}
                style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                  color: G, padding: '1px 4px', background: `${G}15`, border: `1px solid ${G}`,
                  cursor: onSymbolClick ? 'pointer' : 'default' }}>{c.symbol}</span>
            ))}
            {laggards.slice(0, 3).map(c => (
              <span key={c.symbol} onClick={() => onSymbolClick?.(c.symbol)}
                style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                  color: R, padding: '1px 4px', background: `${R}15`, border: `1px solid ${R}`,
                  cursor: onSymbolClick ? 'pointer' : 'default' }}>{c.symbol}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Action label + interpretation */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border2)',
        display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ padding: '6px 12px', background: `${labelColor}10`,
          border: `1px solid ${labelColor}`, borderRadius: 0, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: labelColor,
            fontFamily: 'var(--font-mono)' }}>{label}</div>
        </div>
        {ece.interpretation && (
          <div style={{ fontSize: 12, color: M, lineHeight: 1.6 }}>{ece.interpretation}</div>
        )}
      </div>

      {/* ── Component table — inputs / supporting detail ─────────────────── */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            COMPONENT INPUTS
          </div>
          {ece.fv_model_weights && (
            <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
              FV: PE{(ece.fv_model_weights.pe * 100).toFixed(0)}% PS{(ece.fv_model_weights.ps * 100).toFixed(0)}% DCF{(ece.fv_model_weights.dcf * 100).toFixed(0)}%
            </span>
          )}
        </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {/* Header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '52px 40px 50px 1fr 46px 54px 46px',
              fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.5px',
              paddingBottom: 4, borderBottom: '1px solid var(--border2)' }}>
              <span>SYMBOL</span>
              <span style={{ textAlign: 'right' }}>WT%</span>
              <span style={{ textAlign: 'right' }}>CHG%</span>
              <span style={{ paddingLeft: 6 }}>CONTRIB</span>
              <span style={{ textAlign: 'right' }}>PRICE</span>
              <span style={{ textAlign: 'right' }}>FAIR VAL</span>
              <span style={{ textAlign: 'right' }}>OV%</span>
            </div>
            {components.map((c, i) => {
              const barPct = Math.abs(c.contribution) / maxContrib * 100
              const cc = c.contribution > 0 ? G : c.contribution < 0 ? R : M
              const ovPct = c.fair_value && c.fair_value > 0 && c.price
                ? ((c.price - c.fair_value) / c.fair_value * 100) : null
              const fvColor = ovPct == null ? M : ovPct > 20 ? R : ovPct < -20 ? 'var(--fd-accent)' : G
              return (
                <div key={i} style={{ display: 'grid',
                  gridTemplateColumns: '52px 40px 50px 1fr 46px 54px 46px',
                  alignItems: 'center', fontSize: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span
                      onClick={() => onSymbolClick?.(c.symbol)}
                      style={{
                        fontFamily: 'var(--font-mono)', fontWeight: 500,
                        cursor: onSymbolClick ? 'pointer' : 'default',
                        color: onSymbolClick ? A : 'var(--text)',
                        textDecoration: onSymbolClick ? 'underline dotted' : 'none',
                        textUnderlineOffset: 2,
                      }}
                    >{c.symbol}</span>
                    {(c.fv_methods != null && c.fv_methods > 0) && (
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{c.fv_methods}/3 mdl</span>
                    )}
                  </div>
                  <span style={{ textAlign: 'right', color: M, fontSize: 12 }}>{c.weight_pct.toFixed(1)}%</span>
                  <span style={{ textAlign: 'right',
                    color: c.change_pct > 0 ? G : c.change_pct < 0 ? R : M,
                    fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    {c.change_pct > 0 ? '+' : ''}{c.change_pct.toFixed(2)}%
                  </span>
                  {/* Contribution bar */}
                  <div style={{ paddingLeft: 6, position: 'relative' }}>
                    <div style={{ height: 6, background: 'var(--bg)', borderRadius: 0, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barPct}%`,
                        background: cc, opacity: 0.8, borderRadius: 0 }} />
                    </div>
                    <div style={{ fontSize: 12, color: cc, marginTop: 1 }}>
                      {c.contribution > 0 ? '+' : ''}{c.contribution.toFixed(3)}
                    </div>
                  </div>
                  {/* Price — foreign-currency holdings are converted to USD, shown in () */}
                  <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: c.currency && c.currency !== 'USD' ? A : M }}>
                    {c.price != null
                      ? c.currency && c.currency !== 'USD'
                        ? `($${c.price.toFixed(0)})`
                        : `$${c.price.toFixed(0)}`
                      : '—'}
                  </span>
                  {/* Fair Value */}
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: fvColor }}>
                      {c.fair_value != null ? `$${c.fair_value.toFixed(0)}` : '—'}
                    </span>
                    {c.analyst_target != null && (
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                        tgt ${c.analyst_target.toFixed(0)}
                      </span>
                    )}
                  </div>
                  {/* Over/Under % */}
                  <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: fvColor }}>
                    {ovPct != null ? `${ovPct >= 0 ? '+' : ''}${ovPct.toFixed(0)}%` : '—'}
                  </span>
                </div>
              )
            })}
          </div>
      </div>
    </div>
  )
}
