import { fmtMoneyFull } from '../../utils/formatters'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'

function fmtK(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

function pBar(pct: number, color: string, height = 6) {
  return (
    <div style={{ background: 'var(--fd-card)', borderRadius: 0, height, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 0, transition: 'width 0.3s' }} />
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ConvPlanItem {
  symbol:           string
  current_value:    number
  convert_dollars:  number
  convert_shares?:  number
  pct_of_position?: number
  already_converted?: number
}

interface RothItem {
  symbol:         string
  target_weight:  number
  current_weight: number
  gap_pct:        number
  current_value?: number
  dollar_gap?:    number
  price?:         number
  conv_dollars:   number | null
}

export function AccountImpactPanel({
  convPlanBase, convPlanDec,
  rothPlan,
  rolloverBal, rothBal,
  annualTarget, ytdConverted, remaining,
  convWin,
}: {
  convPlanBase:  ConvPlanItem[]
  convPlanDec:   ConvPlanItem[]
  rothPlan:      RothItem[]
  rolloverBal:   number
  rothBal:       number
  annualTarget:  number
  ytdConverted:  number
  remaining:     number
  convWin:       string
  safeRoom:      number  // kept in signature for call-site compatibility; used by window logic
}) {
  const windowOpen = convWin === 'OPEN'

  // ── Annual progress ───────────────────────────────────────────────────────
  const progressPct = annualTarget > 0 ? Math.min(100, (ytdConverted / annualTarget) * 100) : 0
  const progressColor = progressPct >= 100 ? G : progressPct >= 60 ? A : M

  // ── Scale conv_dollars from annual target to a specific conversion amount ─
  const totalAnnualConvD = rothPlan.reduce((s, r) => s + (r.conv_dollars ?? 0), 0)
  const scaleInflows = (amount: number): RothItem[] => {
    if (totalAnnualConvD <= 0 || amount <= 0) return []
    const scale = amount / totalAnnualConvD
    return rothPlan
      .filter(r => (r.conv_dollars ?? 0) > 0)
      .map(r => ({ ...r, conv_dollars: Math.round((r.conv_dollars ?? 0) * scale) }))
      .filter(r => r.conv_dollars >= 1)
  }

  const baseAmt   = convPlanBase.reduce((s, c) => s + (c.convert_dollars ?? 0), 0)
  const decAmt    = convPlanDec.reduce((s, c) => s + (c.convert_dollars ?? 0), 0)
  const baseInflows = scaleInflows(baseAmt)
  const decInflows  = scaleInflows(decAmt)

  // ── Roth after base conversion ────────────────────────────────────────────
  const rothAfterBase = rothBal + baseAmt
  const rothAfterDec  = rothBal + baseAmt + decAmt

  // ── Helpers ───────────────────────────────────────────────────────────────
  const noData = annualTarget === 0 && convPlanBase.length === 0 && rothPlan.length === 0
  if (noData) {
    return (
      <div style={{ padding: '12px 14px', color: M, fontSize: 12 }}>
        No conversion plan configured. Set annual_conversion in config.
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Annual Progress Bar ─────────────────────────────────────────── */}
      <div style={{ background: 'var(--fd-card)', borderRadius: 0, padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px' }}>
            ANNUAL CONVERSION PROGRESS
          </span>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: progressColor, fontWeight: 500 }}>
            {fmtMoneyFull(ytdConverted)} / {fmtMoneyFull(annualTarget)} ({progressPct.toFixed(0)}%)
          </span>
        </div>
        {pBar(progressPct, progressColor, 8)}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginTop: 8 }}>
          {[
            { label: 'ANNUAL TARGET',   val: fmtMoneyFull(annualTarget),  color: M },
            { label: 'CONVERTED YTD',   val: fmtMoneyFull(ytdConverted),  color: ytdConverted > 0 ? G : M },
            { label: 'REMAINING',        val: fmtMoneyFull(remaining),    color: remaining > 0 ? A : G, note: remaining <= 0 ? '✓ complete' : undefined },
          ].map((m, i) => (
            <div key={i} style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--fd-card)', borderRadius: 0 }}>
              <div style={{ fontSize: 12, color: M, letterSpacing: '0.5px', marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: m.color }}>{m.val}</div>
              {m.note && <div style={{ fontSize: 12, color: G }}>{m.note}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Phase 1: Complete Annual Target ─────────────────────────────── */}
      {remaining > 0 && (
        <div style={{ border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '7px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--fd-card)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: A, letterSpacing: '0.8px' }}>
              PHASE 1 — COMPLETE ANNUAL TARGET · {fmtMoneyFull(remaining)} remaining
            </span>
            <span style={{ fontSize: 12, color: M }}>
              {convPlanBase.some(c => c.already_converted) ? `${fmtMoneyFull(ytdConverted)} already done` : 'remaining from annual plan'}
            </span>
          </div>
          <div style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Outflow */}
            <PhaseTable
              title=" ROLLOVER IRA — OUTFLOW"
              titleColor={windowOpen ? R : M}
              windowOpen={windowOpen}
              plan={convPlanBase}
              totalBal={rolloverBal}
              empty="No remaining conversion needed"
            />
            {/* Inflow */}
            <RothInflowTable
              title=" ROTH IRA — INFLOW"
              titleColor={windowOpen ? G : M}
              windowOpen={windowOpen}
              inflows={baseInflows}
              rothBal={rothBal}
              rothAfter={rothAfterBase}
              convAmt={baseAmt}
            />
          </div>
        </div>
      )}

      {/* ── Phase 2: December Bracket Fill ──────────────────────────────── */}
      {decAmt > 0 && (
        <div style={{ border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '7px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--fd-card)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)', letterSpacing: '0.8px' }}>
              PHASE 2 — DECEMBER BRACKET FILL · {fmtMoneyFull(decAmt)} additional
            </span>
            <span style={{ fontSize: 12, color: M }}>max out bracket in December</span>
          </div>
          <div style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <PhaseTable
              title=" ROLLOVER IRA — OUTFLOW"
              titleColor="var(--blue)"
              windowOpen={false}
              plan={convPlanDec}
              totalBal={rolloverBal - baseAmt}
              empty="No bracket fill needed"
              dimmed={!windowOpen}
            />
            <RothInflowTable
              title=" ROTH IRA — INFLOW (PROJECTED)"
              titleColor="var(--blue)"
              windowOpen={false}
              inflows={decInflows}
              rothBal={rothAfterBase}
              rothAfter={rothAfterDec}
              convAmt={decAmt}
              dimmed
            />
          </div>
        </div>
      )}

      {/* ── Full Roth Target Allocation ──────────────────────────────────── */}
      {rothPlan.length > 0 && (
        <div style={{ border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', background: 'var(--fd-card)' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px' }}>
              ROTH IRA — CURRENT vs TARGET ALLOCATION
            </span>
            <span style={{ fontSize: 12, color: M, marginLeft: 10 }}>
              {fmtMoneyFull(rothBal)} current · {fmtMoneyFull(rothAfterBase)} after phase 1
              {decAmt > 0 ? ` · ${fmtMoneyFull(rothAfterDec)} after phase 2` : ''}
            </span>
          </div>
          <table className="bb-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>SYM</th>
                <th className="r">TARGET</th>
                <th className="r">CURRENT</th>
                <th className="r">AFTER P1</th>
                {decAmt > 0 && <th className="r">AFTER P2</th>}
                <th className="r">GAP $</th>
                <th className="r">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {[...rothPlan].sort((a, b) => b.target_weight - a.target_weight).map(r => {
                const tgt   = r.target_weight * 100
                const cur   = r.current_weight * 100
                const gap   = r.gap_pct * 100  // positive=underweight, negative=overweight

                const p1D   = baseInflows.find(x => x.symbol === r.symbol)?.conv_dollars ?? 0
                const p2D   = decInflows.find(x => x.symbol === r.symbol)?.conv_dollars ?? 0

                const curVal  = r.current_value ?? 0
                const aft1Pct = rothAfterBase > 0 ? ((curVal + p1D) / rothAfterBase) * 100 : 0
                const aft2Pct = rothAfterDec  > 0 ? ((curVal + p1D + p2D) / rothAfterDec) * 100 : 0

                const isOver  = gap < -0.5
                const isUnder = gap > 0.5

                const statusColor = isOver ? R : isUnder ? A : G
                const statusLabel = isOver
                  ? `▼ OVER ${Math.abs(gap).toFixed(1)}%`
                  : isUnder
                  ? `▲ SHORT ${gap.toFixed(1)}%`
                  : '✓ ON TARGET'

                return (
                  <tr key={r.symbol}>
                    <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{r.symbol}</td>
                    <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>{tgt.toFixed(1)}%</td>
                    <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>
                      {cur.toFixed(1)}%
                      {curVal > 0 && (
                        <span style={{ fontSize: 12, color: M, marginLeft: 3 }}>
                          {fmtK(curVal)}
                        </span>
                      )}
                    </td>
                    <td className="r" style={{
                      fontFamily: 'var(--font-mono)',
                      color: Math.abs(aft1Pct - tgt) < Math.abs(cur - tgt) ? G : M,
                    }}>
                      {aft1Pct.toFixed(1)}%
                    </td>
                    {decAmt > 0 && (
                      <td className="r" style={{
                        fontFamily: 'var(--font-mono)',
                        color: Math.abs(aft2Pct - tgt) < Math.abs(aft1Pct - tgt) ? G : M,
                      }}>
                        {aft2Pct.toFixed(1)}%
                      </td>
                    )}
                    <td className="r" style={{
                      fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                      color: isOver ? R : isUnder ? A : G,
                    }}>
                      {isOver ? '−' : '+'}{fmtK(Math.abs(r.dollar_gap ?? 0))}
                    </td>
                    <td className="r" style={{ fontSize: 12, fontWeight: 500, color: statusColor }}>
                      {statusLabel}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ padding: '6px 10px', fontSize: 12, color: M }}>
            Note: OVER symbols can be rebalanced by selling in Roth (no tax) and redeploying to SHORT symbols.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PhaseTable({ title, titleColor, windowOpen, plan, totalBal, empty, dimmed }: {
  title: string; titleColor: string; windowOpen: boolean
  plan: ConvPlanItem[]; totalBal: number; empty: string; dimmed?: boolean
}) {
  const total = plan.reduce((s, c) => s + (c.convert_dollars ?? 0), 0)
  return (
    <div style={{ opacity: dimmed ? 0.55 : 1 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: titleColor, letterSpacing: '0.7px', marginBottom: 6 }}>
        {title}
      </div>
      {plan.length === 0 ? (
        <div style={{ fontSize: 12, color: M }}>{empty}</div>
      ) : (
        <>
          <table className="bb-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>SYM</th>
                <th className="r">CONVERT</th>
                <th className="r">SHARES</th>
                <th className="r">% OF POS</th>
                {plan.some(p => p.already_converted) && <th className="r">DONE</th>}
              </tr>
            </thead>
            <tbody>
              {plan.map(cp => (
                <tr key={cp.symbol}>
                  <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{cp.symbol}</td>
                  <td className="r" style={{ color: windowOpen ? R : M, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    {fmtMoneyFull(cp.convert_dollars)}
                  </td>
                  <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>
                    {(cp.convert_shares ?? 0).toFixed(2)}
                  </td>
                  <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>
                    {(cp.pct_of_position ?? 0).toFixed(1)}%
                  </td>
                  {plan.some(p => p.already_converted) && (
                    <td className="r" style={{ color: G, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {cp.already_converted ? fmtMoneyFull(cp.already_converted) : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: M, marginTop: 4 }}>
            {fmtMoneyFull(totalBal)} rollover balance →{' '}
            <span style={{ color: windowOpen ? R : M }}>{fmtMoneyFull(Math.max(0, totalBal - total))}</span>
            {!windowOpen && (
              <span style={{ color: A }}> · window {convWin_display(windowOpen)}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function convWin_display(open: boolean) { return open ? 'open' : 'not yet open' }

function RothInflowTable({ title, titleColor, windowOpen, inflows, rothBal, rothAfter, convAmt, dimmed }: {
  title: string; titleColor: string; windowOpen: boolean
  inflows: RothItem[]; rothBal: number; rothAfter: number; convAmt: number; dimmed?: boolean
}) {
  return (
    <div style={{ opacity: dimmed ? 0.55 : 1 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: titleColor, letterSpacing: '0.7px', marginBottom: 6 }}>
        {title}
      </div>
      {inflows.length === 0 ? (
        <div style={{ fontSize: 12, color: M }}>No underweight symbols to deploy to.</div>
      ) : (
        <>
          <table className="bb-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>SYM</th>
                <th className="r">BUYING</th>
                <th className="r">OF CONV</th>
                <th className="r">TARGET</th>
              </tr>
            </thead>
            <tbody>
              {inflows.map(r => {
                const pctOfConv = convAmt > 0 ? ((r.conv_dollars ?? 0) / convAmt) * 100 : 0
                return (
                  <tr key={r.symbol}>
                    <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{r.symbol}</td>
                    <td className="r" style={{ color: windowOpen ? G : M, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                      {fmtMoneyFull(r.conv_dollars)}
                    </td>
                    <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>
                      {pctOfConv.toFixed(1)}%
                    </td>
                    <td className="r" style={{ color: M, fontFamily: 'var(--font-mono)' }}>
                      {(r.target_weight * 100).toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: M, marginTop: 4 }}>
            {fmtMoneyFull(rothBal)} → <span style={{ color: windowOpen ? G : M }}>{fmtMoneyFull(rothAfter)}</span>
            {!windowOpen && <span style={{ color: A }}> (projected)</span>}
          </div>
        </>
      )}
    </div>
  )
}
