/**
 * CrossSleevePanel — 60-day Pearson correlation map across sleeves and symbols.
 * Exports:
 *   CrossSleeveMapPanel  — sleeve×sleeve heatmap (used in Risk/Intelligence tab)
 *   SymbolVsSleevePanel  — researched symbol vs each sleeve (used in Research tab)
 */

import type { DashboardData } from '../../types/dashboard'

// ─── Colour helpers ────────────────────────────────────────────────────────────
const G   = 'var(--green)'
const R   = 'var(--red)'
const A   = 'var(--amber)'
const BL  = 'var(--blue)'
const M   = 'var(--text2)'
const DIM = 'var(--fd-muted)'

function corrColor(c: number): string {
  if (c < 0)    return BL
  if (c >= 0.75) return R
  if (c >= 0.40) return A
  return G
}

function corrBg(c: number, isSelf = false): string {
  if (isSelf) return 'var(--fd-card)'
  if (c < 0)    return 'var(--fd-card)'
  if (c >= 0.75) return 'var(--fd-card)'
  if (c >= 0.40) return 'var(--fd-card)'
  return 'var(--fd-card)'
}

function sleeveLabel(key: string): string {
  switch (key) {
    case 'taxable':      return 'Taxable'
    case 'roth_ira':     return 'Roth IRA'
    case 'rollover_ira': return 'Rollover'
    default:             return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}

/** Shared card wrapper */
function Card({ children, title, sub }: { children: React.ReactNode; title: string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--fd-hairline)',
      borderRadius: 0,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: M, marginTop: 1 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

/** Correlation badge chip */
function CorrBadge({ value }: { value: number }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 0,
      background: corrBg(value),
      color: corrColor(value),
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      fontWeight: 500,
    }}>
      {value >= 0 ? value.toFixed(2) : value.toFixed(2)}
    </span>
  )
}

/** Threshold legend row */
function Legend() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
      {([
        { label: 'High ≥0.75', color: R, bg: 'var(--fd-accent)' },
        { label: 'Moderate 0.40–0.74', color: A, bg: 'var(--as-lilac)' },
        { label: 'Low <0.40', color: G, bg: 'var(--as-lime)' },
        { label: 'Hedge <0', color: BL, bg: 'var(--fd-muted)' },
      ] as const).map(({ label, color, bg }) => (
        <span key={label} style={{ fontSize: 12, color, background: bg, padding: '1px 5px', borderRadius: 0, fontWeight: 500 }}>
          {label}
        </span>
      ))}
    </div>
  )
}

// ─── CrossSleeveMapPanel ───────────────────────────────────────────────────────

export function CrossSleeveMapPanel({ data }: { data: DashboardData }) {
  const cm = data.portfolio_intel?.correlation_map

  if (!cm) {
    return (
      <Card title="◈ Cross-Sleeve Correlation" sub="60-day Pearson · sleeve×sleeve">
        <div style={{ fontSize: 12, color: DIM }}>Correlation map not available — refresh portfolio data.</div>
      </Card>
    )
  }

  if (cm.error) {
    return (
      <Card title="◈ Cross-Sleeve Correlation" sub="60-day Pearson · sleeve×sleeve">
        <div style={{ fontSize: 12, color: R }}>Error: {cm.error}</div>
      </Card>
    )
  }

  const sleeves = Object.keys(cm.sleeve_matrix ?? {})
  const score   = cm.diversification_score ?? 0
  const scoreColor = score >= 60 ? G : score >= 35 ? A : R

  return (
    <Card title="◈ Cross-Sleeve Correlation" sub={`60-day Pearson · ${cm.symbols?.length ?? 0} symbols · computed ${cm.computed_at ?? ''}`}>

      {/* Diversification Score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Diversification Score</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: scoreColor, lineHeight: 1.1 }}>{score}<span style={{ fontSize: 12, fontWeight: 400, color: M }}>/100</span></div>
          <div style={{ fontSize: 12, color: M }}>higher = better diversified</div>
        </div>
        <div style={{ flex: 1, height: 4, borderRadius: 0, background: 'var(--fd-card)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${score}%`, background: scoreColor, borderRadius: 0, transition: 'width 0.4s' }} />
        </div>
      </div>

      {/* Sleeve×Sleeve Heatmap */}
      {sleeves.length >= 2 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 70 }} />
                {sleeves.map(sl => (
                  <th key={sl} style={{ fontSize: 12, color: M, fontWeight: 500, padding: '0 4px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {sleeveLabel(sl)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sleeves.map(rowSl => (
                <tr key={rowSl}>
                  <td style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', paddingRight: 6, whiteSpace: 'nowrap' }}>{sleeveLabel(rowSl)}</td>
                  {sleeves.map(colSl => {
                    const c = cm.sleeve_matrix?.[rowSl]?.[colSl] ?? 0
                    const isSelf = rowSl === colSl
                    return (
                      <td key={colSl} style={{
                        textAlign: 'center',
                        padding: '3px 5px',
                        background: corrBg(c, isSelf),
                        borderRadius: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        fontWeight: 500,
                        color: isSelf ? DIM : corrColor(c),
                      }}>
                        {isSelf ? '—' : c.toFixed(2)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Extreme pairs */}
      <div style={{ display: 'flex', gap: 8 }}>
        {cm.highest_corr_pair && (
          <div style={{ flex: 1, background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '5px 8px' }}>
            <div style={{ fontSize: 12, color: R, fontWeight: 500, marginBottom: 2 }}>HIGHEST CORR</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>
              {cm.highest_corr_pair.symbols.join(' ↔ ')}
            </div>
            <CorrBadge value={cm.highest_corr_pair.corr} />
          </div>
        )}
        {cm.lowest_corr_pair && (
          <div style={{ flex: 1, background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '5px 8px' }}>
            <div style={{ fontSize: 12, color: G, fontWeight: 500, marginBottom: 2 }}>LOWEST CORR</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>
              {cm.lowest_corr_pair.symbols.join(' ↔ ')}
            </div>
            <CorrBadge value={cm.lowest_corr_pair.corr} />
          </div>
        )}
      </div>

      <Legend />
    </Card>
  )
}

// ─── SymbolVsSleevePanel ──────────────────────────────────────────────────────

export function SymbolVsSleevePanel({ symbol, data }: { symbol: string; data: DashboardData }) {
  const cm = data.portfolio_intel?.correlation_map
  const sym = symbol?.toUpperCase() ?? ''

  // Determine if symbol is present in the correlation matrix
  const hasMatrix = cm && !cm.error && cm.matrix && sym in cm.matrix

  // Build sleeve → representative correlation value
  // Use avg of correlations from `symbol` to each symbol in the sleeve
  type SleeveRow = { sleeve: string; label: string; corr: number | null; symbols: string[] }
  const rows: SleeveRow[] = []

  if (hasMatrix && cm.sleeve_matrix) {
    // Group available symbols by sleeve
    const sleeveSyms: Record<string, string[]> = {}
    for (const acct of data.accounts) {
      const sleeve = acct.key
      for (const pos of acct.positions) {
        if (!pos.is_money_market && pos.symbol !== sym && pos.symbol in cm.matrix) {
          if (!sleeveSyms[sleeve]) sleeveSyms[sleeve] = []
          sleeveSyms[sleeve].push(pos.symbol)
        }
      }
    }

    for (const [sleeve, slSyms] of Object.entries(sleeveSyms)) {
      const vals = slSyms
        .map(s => cm.matrix?.[sym]?.[s])
        .filter((v): v is number => v !== undefined && !isNaN(v))
      const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      rows.push({ sleeve, label: sleeveLabel(sleeve), corr: avg !== null ? parseFloat(avg.toFixed(4)) : null, symbols: slSyms })
    }
    rows.sort((a, b) => (b.corr ?? -2) - (a.corr ?? -2))
  }

  if (!sym) return null

  if (!cm || cm.error) {
    return (
      <Card title={`◈ ${sym} vs Sleeves`} sub="60-day Pearson correlation">
        <div style={{ fontSize: 12, color: DIM }}>
          {cm?.error ? `Error: ${cm.error}` : 'Correlation data not available yet.'}
        </div>
      </Card>
    )
  }

  if (!hasMatrix) {
    return (
      <Card title={`◈ ${sym} vs Sleeves`} sub="60-day Pearson correlation">
        <div style={{ fontSize: 12, color: DIM }}>
          {sym} not in correlation matrix (may not be held or lacks price history).
        </div>
      </Card>
    )
  }

  return (
    <Card title={`◈ ${sym} vs Sleeves`} sub="60-day Pearson — avg correlation to each sleeve">
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: DIM }}>No cross-sleeve correlations found.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ fontSize: 12, color: M, fontWeight: 500, textAlign: 'left', paddingBottom: 4 }}>Sleeve</th>
              <th style={{ fontSize: 12, color: M, fontWeight: 500, textAlign: 'left', paddingBottom: 4 }}>Holdings</th>
              <th style={{ fontSize: 12, color: M, fontWeight: 500, textAlign: 'center', paddingBottom: 4 }}>Avg Corr</th>
              <th style={{ fontSize: 12, color: M, fontWeight: 500, textAlign: 'center', paddingBottom: 4 }}>Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const c = row.corr ?? 0
              const signal = c < 0 ? 'Hedge' : c >= 0.75 ? 'High' : c >= 0.40 ? 'Moderate' : 'Low'
              return (
                <tr key={row.sleeve} style={{ borderTop: '1px solid var(--fd-hairline)' }}>
                  <td style={{ padding: '5px 0', fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{row.label}</td>
                  <td style={{ padding: '5px 4px', fontSize: 12, color: M, fontFamily: 'var(--font-mono)' }}>
                    {row.symbols.join(', ')}
                  </td>
                  <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                    {row.corr !== null ? <CorrBadge value={row.corr} /> : <span style={{ fontSize: 12, color: DIM }}>—</span>}
                  </td>
                  <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: corrColor(c) }}>{signal}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <Legend />
    </Card>
  )
}
