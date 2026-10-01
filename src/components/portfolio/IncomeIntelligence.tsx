import { fmtMoney, fmtMoneyFull, fmtPct, gainColor } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, A, M } from './DetailTab.constants'
import { SCORE_GREEN, SCORE_AMBER } from '../../utils/retirementEngine'
import { WITHDRAWAL_AB_THRESHOLD, WITHDRAWAL_BC_THRESHOLD } from '../../utils/constants'

const BL  = 'var(--blue)'
const W   = 'var(--text)'

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px',
      textTransform: 'uppercase', marginBottom: 6 }}>
      {text}
    </div>
  )
}

function StatRow({ label, value, valueColor = W, sub }: {
  label: string; value: React.ReactNode; valueColor?: string; sub?: string
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 8, marginBottom: 3 }}>
      <span style={{ fontSize: 12, color: M }}>{label}</span>
      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: valueColor,
        textAlign: 'right' }}>
        {value}
        {sub && <span style={{ fontSize: 12, fontWeight: 400, color: M, marginLeft: 4 }}>{sub}</span>}
      </span>
    </div>
  )
}

/** Thin horizontal bar, 0-100 */
function Bar({ pct, color, height = 4 }: { pct: number; color: string; height?: number }) {
  return (
    <div style={{ height, background: 'var(--border2)', borderRadius: 999, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${Math.min(Math.max(pct, 0), 100)}%`,
        background: color, borderRadius: 999, transition: 'width 0.3s ease' }} />
    </div>
  )
}

/** Stacked 3-segment bar for ord/qual/roc */
function CompositionBar({ ord, qual, roc, height = 6 }: {
  ord: number; qual: number; roc: number; height?: number
}) {
  const total = ord + qual + roc || 1
  return (
    <div style={{ display: 'flex', height, borderRadius: 999, overflow: 'hidden', width: '100%' }}>
      <div style={{ width: `${ord / total * 100}%`, background: R }} />
      <div style={{ width: `${qual / total * 100}%`, background: G }} />
      <div style={{ width: `${roc / total * 100}%`, background: BL }} />
    </div>
  )
}

function Card({ children, borderColor, style }: {
  children: React.ReactNode; borderColor?: string
  style?: React.CSSProperties
}) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 0, padding: '10px 12px',
      border: `1px solid ${borderColor ?? 'var(--fd-hairline)'}`,
      ...style,
    }}>
      {children}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function IncomeIntelligence({ ia, data }: {
  ia: NonNullable<DashboardData['income_analytics']>; data: DashboardData
}) {
  const fwd12 = ia.portfolio_fwd_12m
  const _td   = data.tax_data
  const byAcct = ia.by_account ?? {}

  // Tax impact object
  const _taxRaw = ia.forward_tax_impact as unknown
  const taxObj = _taxRaw && typeof _taxRaw === 'object' ? (_taxRaw as Record<string, number>) : null
  const taxEst     = taxObj?.fwd_tax_est  ?? (typeof _taxRaw === 'number' ? _taxRaw : null)
  const fwdOrd     = taxObj?.fwd_ordinary  ?? 0
  const fwdQual    = taxObj?.fwd_qualified ?? 0
  const fwdRoc     = taxObj?.fwd_roc       ?? 0
  const fwdOrdPct  = fwd12 > 0 ? Math.round(fwdOrd  / fwd12 * 100) : 0
  const fwdQualPct = fwd12 > 0 ? Math.round(fwdQual / fwd12 * 100) : 0
  const fwdRocPct  = fwd12 > 0 ? Math.round(fwdRoc  / fwd12 * 100) : 0

  // Bracket / headroom
  const _taxCeiling   = _td?.target_bracket_ceiling ?? null
  const bktRate       = _td?.target_bracket_rate ?? 24
  const ceilingGap    = _taxCeiling != null ? Math.max(0, _taxCeiling - fwd12) : (ia.ceiling_gap ?? null)
  const bracketUsePct = _taxCeiling != null && _taxCeiling > 0
    ? Math.min(Math.round(fwd12 / _taxCeiling * 100), 100) : null
  const headroomColor = ceilingGap == null ? M : ceilingGap <= 0 ? R : ceilingGap < 50000 ? A : G

  // Attribution
  const _top5Raw: [string, number][] = (ia.income_attribution as any)?.top5 ?? []
  // Use all available top tickers (up to 5) for concentration — not capped at 4
  const topNCount = _top5Raw.length
  const topNCum   = _top5Raw.reduce((s, [, p]) => s + p, 0)
  const concRisk  = topNCum >= 80
  // Keep legacy aliases for the existing concentration display
  const top4Count = topNCount
  const top4Cum   = topNCum

  // Quality / tax label
  const qualScore = ia.avg_quality_score
  const qualColor = qualScore == null ? M : qualScore >= SCORE_GREEN ? G : qualScore >= SCORE_AMBER ? A : R
  const qualLabel = qualScore == null ? '—'
    : qualScore >= SCORE_GREEN ? 'HIGH — Qualified/ROC'
    : qualScore >= SCORE_AMBER ? 'MIXED'
    : 'ORDINARY-HEAVY'

  // Account roles
  const ACCT_ROLES: Record<string, string> = {
    taxable:      'income sleeve',
    roth_ira:     'tax-free / ROC sleeve',
    rollover_ira: 'conversion source',
  }

  // Stress test
  const stressTest = (ia as any)['stress_test'] as Record<string, { fwd_12m?: number; income_gap?: number }> | undefined

  const today     = new Date()
  const dayOfYear = Math.ceil((today.getTime() - new Date(today.getFullYear(), 0, 1).getTime()) / 86400000)
  // Projected EOY: YTD received + FWD run rate for remaining days — same formula as IncomeHistory
  const _daysInYr = (today.getFullYear() % 4 === 0 ? 366 : 365)
  const _ytdTotal = Object.values((ia as any).by_account ?? {}).reduce((s: number, a: any) => s + (a.ytd_income ?? 0), 0) as number
  const projEoyConsistent = _ytdTotal + (fwd12 / _daysInYr) * Math.max(0, _daysInYr - dayOfYear)

  // Withdrawal state — used to add State C context to Lifestyle section
  const _serverState = _td?.withdrawal_current_state
  const _gains = data.summary.total_pnl
  const _stateIdx = _serverState === 'C' ? 2 : _serverState === 'B' ? 1 : _serverState === 'A' ? 0
                  : _gains < (_td?.withdrawal_state_ab_threshold ?? WITHDRAWAL_AB_THRESHOLD) ? 0
                  : _gains < (_td?.withdrawal_state_bc_threshold ?? WITHDRAWAL_BC_THRESHOLD) ? 1 : 2
  const _isStateC = _stateIdx === 2

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* ══ ROW 1 — Forward Income Snapshot ══════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>

        {/* 1a — FWD 12M */}
        <Card>
          <SectionLabel text="① Forward Income Snapshot" />
          <div style={{ fontSize: 24, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)',
            lineHeight: 1, marginBottom: 2 }}>
            {fmtMoneyFull(fwd12)}
          </div>
          <div style={{ fontSize: 12, color: M, marginBottom: 8 }}>FWD 12M · all accounts</div>
          <StatRow label="Monthly avg"   value={fmtMoney(fwd12 / 12)} valueColor={G} />
          {ia.income_growth_rate != null && (
            <StatRow label="Growth rate"
              value={fmtPct(ia.income_growth_rate * 100)}
              valueColor={gainColor(ia.income_growth_rate)}
              sub="YoY — reflects composition changes" />
          )}
          <StatRow label="Projected EOY" value={fmtMoneyFull(projEoyConsistent)} />
        </Card>

        {/* 1b — After-Tax */}
        <Card>
          <SectionLabel text="② After-Tax Income" />
          {taxEst != null ? (
            <>
              <div style={{ fontSize: 24, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)',
                lineHeight: 1, marginBottom: 2 }}>
                {fmtMoneyFull(fwd12 - taxEst)}
              </div>
              <div style={{ fontSize: 12, color: M, marginBottom: 8 }}>net after estimated tax</div>
              <StatRow label="Est. tax drag"  value={`−${fmtMoney(taxEst)}`}  valueColor={R} />
              <StatRow label="Effective drag" value={fmtPct(taxEst / fwd12 * 100)} valueColor={R}
                sub="of gross income" />
            </>
          ) : (
            <div style={{ fontSize: 12, color: M, marginTop: 12 }}>No tax estimate available</div>
          )}
        </Card>

        {/* 1c — Tax Quality */}
        <Card>
          <SectionLabel text="③ Tax Quality" />
          <div style={{ fontSize: 14, fontWeight: 500, color: qualColor, marginBottom: 4 }}>
            {qualLabel}
          </div>
          {qualScore != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Bar pct={qualScore} color={qualColor} height={5} />
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                color: qualColor, whiteSpace: 'nowrap' }}>{qualScore}/100</span>
            </div>
          )}
          {/* Dividend composition */}
          {(fwdOrd + fwdQual + fwdRoc) > 0 && (
            <>
              <CompositionBar ord={fwdOrdPct} qual={fwdQualPct} roc={fwdRocPct} />
              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                {[
                  { label: 'Ordinary', pct: fwdOrdPct, color: R },
                  { label: 'Qualified', pct: fwdQualPct, color: G },
                  { label: 'ROC', pct: fwdRocPct, color: BL },
                ].map(seg => (
                  <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <div style={{ width: 6, height: 6, borderRadius: 0, background: seg.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: M }}>{seg.label}</span>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                      color: seg.color }}>{seg.pct}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ══ ROW 2 — Headroom Gauge ════════════════════════════════════════════ */}
      {_taxCeiling != null && (
        <Card borderColor={headroomColor} style={{ borderLeft: `3px solid ${headroomColor}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            marginBottom: 8 }}>
            <SectionLabel text={`④ Dividend Headroom vs ${bktRate}% Bracket`} />
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                color: headroomColor }}>{ceilingGap != null ? fmtMoney(ceilingGap) : '—'}</span>
              <span style={{ fontSize: 12, color: M, marginLeft: 4 }}>headroom</span>
            </div>
          </div>

          {/* Bar */}
          <div style={{ position: 'relative', marginBottom: 6 }}>
            <div style={{ height: 10, background: 'var(--border2)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 999,
                width: `${bracketUsePct ?? 0}%`,
                background: headroomColor,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: M }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: headroomColor }}>
              {bracketUsePct != null ? `${bracketUsePct}% used` : '—'}
            </span>
            <span>
              FWD 12M <span style={{ color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoney(fwd12)}</span>
              {' '}· Ceiling <span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${(_taxCeiling / 1000).toFixed(0)}k</span>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', color: headroomColor }}>
              {bracketUsePct != null ? `${100 - bracketUsePct}% free` : '—'}
            </span>
          </div>
          {bracketUsePct != null && (
            <div style={{ marginTop: 4, fontSize: 12, color: M }}>
              Bracket utilization: <span style={{ color: headroomColor, fontWeight: 500 }}>{bracketUsePct}%</span>
              {' '}of {bktRate}% bracket consumed by dividends
            </div>
          )}
        </Card>
      )}

      {/* ══ ROW 3 — Attribution + Lifestyle ══════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: ia.lifestyle_target_min != null ? '1fr 1fr' : '1fr', gap: 8 }}>

        {/* 3a — Income Attribution */}
        <Card>
          <SectionLabel text="⑤ Income Attribution — Top Drivers" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {_top5Raw.slice(0, 5).map(([sym, pct], i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 12,
                  minWidth: 50, color: W }}>{sym}</span>
                <Bar pct={pct} color={G} height={5} />
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                  color: G, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          {_top5Raw.length >= 4 && (
            <div style={{ marginTop: 8, padding: '4px 8px', borderRadius: 0,
              background: concRisk ? 'var(--fd-card)' : 'var(--fd-card)',
              border: `1px solid ${concRisk ? A : 'var(--fd-hairline)'}`,
              fontSize: 12, color: concRisk ? A : M }}>
              Concentration: <span style={{ fontWeight: 500 }}>
                {top4Count} tickers = {top4Cum.toFixed(0)}% of income
              </span>
              {concRisk && ' — core income positions (intended — see target allocation)'}
            </div>
          )}
        </Card>

        {/* 3b — Lifestyle Target */}
        {ia.lifestyle_target_min != null && ia.lifestyle_target_max != null && (() => {
          const statusColor = ia.lifestyle_status === 'COVERED' ? G
            : ia.lifestyle_status === 'PARTIAL' ? A : R
          return (
            <Card>
              <SectionLabel text="⑥ Lifestyle Income Target" />

              {/* Coverage bar */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: M }}>Coverage ratio (low target → high target)</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                    color: statusColor }}>
                    {(ia.lifestyle_progress_min ?? 0).toFixed(0)}%–{(ia.lifestyle_progress_max ?? 0).toFixed(0)}%
                  </span>
                </div>
                {/* Dual bar: min coverage (solid) + max coverage (dim) */}
                <div style={{ position: 'relative', height: 8, background: 'var(--border2)', borderRadius: 999 }}>
                  <div style={{
                    position: 'absolute', height: '100%', borderRadius: 999,
                    width: `${Math.min(ia.lifestyle_progress_max ?? 0, 100)}%`,
                    background: `${statusColor}44`,
                  }} />
                  <div style={{
                    position: 'absolute', height: '100%', borderRadius: 999,
                    width: `${Math.min(ia.lifestyle_progress_min ?? 0, 100)}%`,
                    background: statusColor,
                  }} />
                </div>
              </div>

              <StatRow label="Target range"
                value={`${fmtMoney(ia.lifestyle_target_min)} – ${fmtMoney(ia.lifestyle_target_max)}/yr`} />
              <StatRow label="Current FWD 12M" value={fmtMoney(fwd12)} valueColor={G} />
              {(ia.lifestyle_gap_max ?? 0) > 0 && (
                <StatRow label="Shortfall"
                  value={`${fmtMoney(ia.lifestyle_gap_min ?? 0)} – ${fmtMoney(ia.lifestyle_gap_max ?? 0)}`}
                  valueColor={R} />
              )}
              <div style={{ marginTop: 6, textAlign: 'center', padding: '3px 8px', borderRadius: 0,
                background: `${statusColor}18`,
                fontSize: 12, fontWeight: 500, color: statusColor }}>
                {ia.lifestyle_status ?? '—'}
              </div>
              {_isStateC && ia.lifestyle_status !== 'COVERED' && (
                <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 0,
                  background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
                  fontSize: 12, color: A, lineHeight: 1.4 }}>
                  State C: dividend shortfall is by design — controlled sales supplement income. See Cash Flow tab.
                </div>
              )}
            </Card>
          )
        })()}
      </div>

      {/* ══ ROW 4 — Confidence by Account ════════════════════════════════════ */}
      {Object.keys(byAcct).length > 0 && (
        <Card>
          <SectionLabel text="⑦ Forecast Confidence by Account" />
          <div style={{ fontSize: 12, color: M, marginBottom: 8, lineHeight: 1.5 }}>
            Predictability of forward income — based on payout history, distribution frequency, and ROC%.
            Equity-growth ETFs (e.g. SMH) score lower than dividend-focused funds regardless of income amount.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.accounts.map(acct => {
              const acctData = byAcct[acct.key]
              if (!acctData) return null
              const confRaw = (acctData as any).forward_confidence as number | undefined
              // Apply a floor of 20 for any account that has positive forward income
              // (a score of 0 is only valid when there is truly no income)
              const conf = confRaw != null
                ? (acctData.fwd_12m != null && acctData.fwd_12m > 0 ? Math.max(20, confRaw) : confRaw)
                : undefined
              const confColor = conf == null ? M : conf >= SCORE_GREEN ? G : conf >= SCORE_AMBER ? A : R
              const role = ACCT_ROLES[acct.key] ?? acct.key
              return (
                <div key={acct.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'baseline', marginBottom: 4 }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 500, color: W }}>{acct.label}</span>
                      <span style={{ fontSize: 12, color: M, marginLeft: 8 }}>{role}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                        color: G }}>
                        {acctData.fwd_12m != null ? fmtMoneyFull(acctData.fwd_12m) : '—'}
                      </span>
                      {conf != null && (
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500,
                          color: confColor, marginLeft: 12 }}>
                          {conf.toFixed(1)}/100
                        </span>
                      )}
                    </div>
                  </div>
                  <Bar pct={conf ?? 0} color={confColor} height={5} />
                  {conf != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ fontSize: 12, color: M, fontStyle: 'italic' }}>
                        {acct.key === 'rollover_ira'
                          ? 'Low confidence: minimal dividend income (SMH-only)'
                          : acct.key === 'roth_ira' && conf < SCORE_AMBER
                          ? 'Low confidence: ROC-adjusted scoring reduces signal — income is actually stable'
                          : 'payout history · distribution stability · ROC%'}
                      </span>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: confColor }}>
                        {conf >= SCORE_GREEN ? '≥70 · sustainable' : conf >= SCORE_AMBER ? '40–69 · mixed signals' : '<40 · low confidence'}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ══ ROW 5 — Actual vs Projected ══════════════════════════════════════ */}
      <div style={{ background: 'var(--bg)', padding: '10px 12px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px',
          textTransform: 'uppercase', marginBottom: 8 }}>
          ⑧ Actual vs Projected
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="bb-table">
            <thead>
              <tr>
                <th>ACCOUNT / SYMBOL</th>
                <th className="r">RECEIVED YTD</th>
                <th className="r">PROJ ANNUAL</th>
                <th className="r">FWD 12M</th>
                <th className="r">ANNUALIZED PACE</th>
                <th className="r">VS PROJECTED</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map(acct => {
                const acctBySymbolLocal = byAcct[acct.key]?.by_symbol ?? {}
                const ytdTotalReceived = acct.ytd_income_actual ?? 0
                const currentSyms = new Set(acct.positions.filter(p => p.shares > 0).map(p => p.symbol))
                const ytdCurrentOnly = Object.entries(acctBySymbolLocal)
                  .filter(([sym]) => currentSyms.has(sym))
                  .reduce((sum, [, v]) => sum + (v as number), 0)
                const projected = acct.income
                const usingProjAsPace = ytdCurrentOnly === 0 && projected > 0
                const paceAnnual = ytdCurrentOnly > 0 && dayOfYear > 0
                  ? ytdCurrentOnly / dayOfYear * 365
                  : usingProjAsPace ? projected : null
                const paceVsProj = !usingProjAsPace && paceAnnual != null && projected > 0
                  ? ((paceAnnual / projected - 1) * 100) : null
                const acctFwd12 = byAcct[acct.key]?.fwd_12m
                const paceColor = paceVsProj == null ? M : paceVsProj >= -5 ? G : paceVsProj >= -15 ? A : R
                const hasSoldIncome = ytdTotalReceived > ytdCurrentOnly && ytdTotalReceived > 0
                const acctRows = [
                  <tr key={acct.key} style={{ fontWeight: 500 }}>
                    <td style={{ fontWeight: 500 }}>{acct.label}</td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>
                      <span style={{ color: G }}>{ytdTotalReceived > 0 ? fmtMoneyFull(ytdTotalReceived) : '—'}</span>
                      {hasSoldIncome && ytdCurrentOnly > 0 && (
                        <div style={{ fontSize: 12, color: M }}>
                          {fmtMoneyFull(ytdCurrentOnly)} from current holdings
                        </div>
                      )}
                    </td>
                    <td className="r" style={{ fontFamily: 'var(--font-mono)' }}>
                      {projected > 0 ? fmtMoneyFull(projected) : '—'}
                    </td>
                    <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)' }}>
                      {acctFwd12 != null ? fmtMoneyFull(acctFwd12) : '—'}
                    </td>
                    <td className="r" style={{ color: usingProjAsPace ? M : paceColor, fontFamily: 'var(--font-mono)' }}>
                      {paceAnnual != null ? (
                        <>{fmtMoneyFull(paceAnnual)}/yr
                          {usingProjAsPace && (
                            <div style={{ fontSize: 12, color: M, letterSpacing: '0.5px' }}>PROJ BASIS</div>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td className="r" style={{ color: paceColor, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                      {paceVsProj != null ? `${paceVsProj >= 0 ? '+' : ''}${paceVsProj.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ]
                const acctBySymbol = byAcct[acct.key]?.by_symbol ?? {}
                const symSet = new Set([
                  ...Object.keys(acctBySymbol).filter(s => (acctBySymbol[s] ?? 0) > 0),
                  ...acct.positions.filter(p => p.shares > 0 && p.annual_income > 0).map(p => p.symbol),
                ])
                const symsSorted = [...symSet].sort((a, b) => {
                  const pa = acct.positions.find(p => p.symbol === a)
                  const pb = acct.positions.find(p => p.symbol === b)
                  // Current holdings first, then sold positions
                  const aIsCurrent = !!pa
                  const bIsCurrent = !!pb
                  if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1
                  return ((pb?.annual_income ?? 0) - (pa?.annual_income ?? 0))
                })
                let addedSoldHeader = false
                for (const sym of symsSorted) {
                  const ytdSym = acctBySymbol[sym] ?? null
                  const pos = acct.positions.find(p => p.symbol === sym && p.shares > 0)
                  const isSold = !pos && (ytdSym ?? 0) > 0
                  // Insert a visual divider before the first SOLD row
                  if (isSold && !addedSoldHeader) {
                    addedSoldHeader = true
                    acctRows.push(
                      <tr key={`${acct.key}-sold-header`}>
                        <td colSpan={6} style={{ paddingLeft: 24, paddingTop: 6, paddingBottom: 2, fontSize: 12,
                          fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px',
                          borderTop: '1px dashed var(--fd-hairline)' }}>
                          Sold Positions — YTD income from prior holdings (not forward projections)
                        </td>
                      </tr>
                    )
                  }
                  const projAmt = pos && pos.annual_income > 0 ? pos.annual_income : null
                  const symUsingProj = (ytdSym == null || ytdSym === 0) && projAmt != null && projAmt > 0
                  const pace = ytdSym != null && ytdSym > 0 && pos != null && dayOfYear > 0
                    ? ytdSym / dayOfYear * 365
                    : symUsingProj ? projAmt : null
                  const symDiff = !symUsingProj && pace != null && projAmt != null && projAmt > 0
                    ? ((pace / projAmt - 1) * 100) : null
                  const diffColor = symDiff == null ? M : symDiff >= -5 ? G : symDiff >= -20 ? A : R
                  const symFwd = (byAcct[acct.key]?.by_symbol ?? {})[sym] ?? null
                  acctRows.push(
                    <tr key={`${acct.key}-${sym}`} style={{ opacity: isSold ? 0.65 : 1 }}>
                      <td style={{ paddingLeft: 24, color: M, fontSize: 12 }}>
                        {sym}
                        {isSold && (
                          <span style={{ fontSize: 12, color: M, background: 'var(--panel2)',
                            padding: '1px 4px', marginLeft: 4 }}>SOLD</span>
                        )}
                      </td>
                      <td className="r" style={{ color: ytdSym ? G : M, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {ytdSym != null ? fmtMoneyFull(ytdSym) : '—'}
                      </td>
                      <td className="r" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {projAmt != null ? fmtMoneyFull(projAmt) : '—'}
                      </td>
                      <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {symFwd != null ? fmtMoneyFull(symFwd) : '—'}
                      </td>
                      <td className="r" style={{ color: symUsingProj ? M : 'inherit', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {pace != null ? (
                          <>{fmtMoneyFull(Math.round(pace))}/yr
                            {symUsingProj && (
                              <div style={{ fontSize: 12, color: M, letterSpacing: '0.5px' }}>PROJ BASIS</div>
                            )}
                          </>
                        ) : '—'}
                      </td>
                      <td className="r" style={{ color: diffColor, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {symDiff != null ? `${symDiff >= 0 ? '+' : ''}${symDiff.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  )
                }
                return acctRows
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══ ROW 6 — Income Stress Test ════════════════════════════════════════ */}
      <div style={{ background: 'var(--bg)', padding: '10px 12px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px',
          textTransform: 'uppercase', marginBottom: 8 }}>
          ⑨ Income Stress Test
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="bb-table">
            <thead>
              <tr>
                <th>SCENARIO</th>
                <th className="r">FWD 12M</th>
                {taxEst != null && <th className="r">EST TAX</th>}
                {taxEst != null && <th className="r">AFTER-TAX</th>}
                <th className="r">DIV. HEADROOM <span style={{ fontSize: 12, fontWeight: 400, color: M }}>↑ as income falls (fixed ceiling)</span></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>Baseline</td>
                <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(fwd12)}</td>
                {taxEst != null && <td className="r" style={{ color: R, fontFamily: 'var(--font-mono)' }}>-{fmtMoney(taxEst)}</td>}
                {taxEst != null && <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(fwd12 - taxEst)}</td>}
                <td className="r" style={{ color: ceilingGap != null && ceilingGap > 0 ? G : R, fontFamily: 'var(--font-mono)' }}>
                  {ceilingGap != null ? fmtMoney(ceilingGap) : '—'}
                </td>
              </tr>
              {(['down_10', 'down_20', 'down_30'] as const).map((key, i) => {
                const pct = [0.10, 0.20, 0.30][i]
                const label = ['-10% SHOCK', '-20% SHOCK', '-30% SHOCK'][i]
                const stData = stressTest?.[key]
                const stressed = stData?.fwd_12m ?? (fwd12 * (1 - pct))
                const stressedTax = taxEst != null && fwd12 > 0 ? taxEst * (stressed / fwd12) : null
                const afterTax = stressedTax != null ? stressed - stressedTax : null
                const room = _taxCeiling != null ? Math.max(0, _taxCeiling - stressed) : null
                return (
                  <tr key={key} style={{ opacity: 0.85 }}>
                    <td style={{ color: R, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{label}</td>
                    <td className="r" style={{ color: R, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(stressed)}</td>
                    {taxEst != null && <td className="r" style={{ color: R, fontFamily: 'var(--font-mono)' }}>{stressedTax != null ? `-${fmtMoney(stressedTax)}` : '—'}</td>}
                    {taxEst != null && <td className="r" style={{ color: R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{afterTax != null ? fmtMoneyFull(afterTax) : '—'}</td>}
                    <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)' }}>
                      {room != null ? fmtMoney(room) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
