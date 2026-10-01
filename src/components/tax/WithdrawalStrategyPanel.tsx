import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE, WITHDRAWAL_AB_THRESHOLD, WITHDRAWAL_BC_THRESHOLD, WITHDRAWAL_DIV_LOAD_ALERT, GAIN_BAR_OVERFLOW_FACTOR } from '../../utils/constants'
import { NIIT_RATE } from '../../utils/taxConfig'
import { computeConversionVerdict, type ConversionVerdict } from '../../utils/conversionVerdict'
import { G, R, M, Y } from './taxColors'
import type { DashboardData } from '../../types/dashboard'
import type { WithdrawalStateRules } from '../../types/dashboard'

// ── Withdrawal Strategy State Machine ────────────────────────────────────────

// Converts a state's rules object into display-ready icon+text rows
function buildRules(
  state: 'A' | 'B' | 'C',
  rules: WithdrawalStateRules,
  ctx: { abThreshold: number; bcThreshold: number; divLoadAlert: number; topHolding: string; targetBracketRate?: number; annualSpending?: number; stcgRealized?: number; niitApplies?: boolean; convVerdict?: ConversionVerdict | null }
): { icon: string; text: string }[] {
  const { divLoadAlert, topHolding, annualSpending, stcgRealized, niitApplies, convVerdict } = ctx
  const icon = state === 'A' ? '✓' : state === 'B' ? '' : ''
  const rows: { icon: string; text: string }[] = []

  if (!rules.allow_controlled_sale) {
    rows.push({ icon, text: 'No controlled sales — let capital gains compound untaxed' })
    rows.push({ icon, text: 'Live on dividends — income ETFs cover all lifestyle costs' })
  } else {
    const min = rules.controlled_sale_target_min ?? 0
    const max = rules.controlled_sale_target_max ?? 0
    const ytdNote = stcgRealized != null && stcgRealized > 0
      ? ` · YTD realized: ${fmtMoneyFull(stcgRealized)}${stcgRealized >= min && stcgRealized <= max ? ' ✓ within target' : stcgRealized > max ? '  above target' : ' (target not yet reached)'}`
      : ''
    rows.push({ icon, text: `Controlled sales target: ${fmtMoneyFull(min)}–${fmtMoneyFull(max)}/yr in realized gains${ytdNote}` })
  }

  if (rules.allow_trimming_income_etfs) {
    // Compute the multiple — asserting "2×" as literal text goes stale the
    // moment the configured load alert or tracked spending changes.
    const spendNote = annualSpending && annualSpending > 0
      ? ` (≈ ${(divLoadAlert / annualSpending).toFixed(1)}× tracked spending of ${fmtMoneyFull(annualSpending)})`
      : ''
    rows.push({ icon, text: `Trim income ETFs only if annual dividends exceed ${fmtMoneyFull(divLoadAlert)} load alert${spendNote}` })
  } else {
    rows.push({ icon, text: niitApplies
      ? `Keep annual dividend income below ${fmtMoneyFull(divLoadAlert)} to minimize NIIT surcharge (3.8% already applies — reduce the taxable base)`
      : `Keep annual dividend income below ${fmtMoneyFull(divLoadAlert)} to stay under NIIT threshold` })
  }

  if (rules.sell_income_etfs) {
    rows.push({ icon, text: 'Sell most income ETFs — remove forced income to control AGI' })
  }

  const bucketYrs = rules.required_bucket_years
  if (bucketYrs === 0) {
    rows.push({ icon, text: 'No cash bucket required — dividends provide steady monthly cashflow' })
  } else {
    rows.push({ icon, text: `Build ${bucketYrs}-year SWVXX buffer — ${bucketYrs * 12} months of spending in money market` })
  }

  if (state === 'B') {
    rows.push({ icon, text: `Reduce ${topHolding} concentration slowly — trim overweight position` })
  }

  if (state === 'C') {
    rows.push({ icon, text: niitApplies
      ? `${(NIIT_RATE * 100).toFixed(1)}% NIIT applies to net investment income — minimize impact by controlling realized gains and income ETF distributions`
      : `Keep taxable income in ${ctx.targetBracketRate ?? DEFAULT_BRACKET_RATE}% bracket to stay below ${(NIIT_RATE * 100).toFixed(1)}% NIIT threshold` })
  }

  if (rules.maximize_roth !== false) {
    // Defer to the canonical verdict — a static "maximize conversions" rule
    // contradicts the command center when YTD is already above tax-optimal.
    rows.push({
      icon,
      text: convVerdict
        ? convVerdict.status === 'STOP'
          ? `Roth conversions: STOP for this year — at/above bracket target · may resume 2027 if STCG normalizes, bucket refilled, and fragility reduced · see Conversion Command Center`
          : state === 'A'
            ? `Roth conversions: ${convVerdict.headline} — dividends-only income leaves full bracket room available (see Conversion Command Center)`
            : `Roth conversions: ${convVerdict.headline} — check STCG headroom before executing; bracket space shared with realized gains (see Conversion Command Center)`
        : state === 'A'
          ? 'Roth conversions: convert to bracket ceiling — dividends-only income leaves full room available'
          : 'Roth conversions: verify STCG before executing — bracket space is shared with realized gains',
    })
  }

  return rows
}

export function WithdrawalStrategyPanel({ data }: { data: DashboardData }) {
  const gains = data.summary.total_pnl
  const totalMV = data.summary.total_value
  const totalCost = data.summary.total_cost
  const tx = data.tax_data

  // Thresholds from input.json _WITHDRAWAL_STRATEGY (fallback to defaults if server is old)
  const abThreshold  = tx.withdrawal_state_ab_threshold  ?? WITHDRAWAL_AB_THRESHOLD
  const bcThreshold  = tx.withdrawal_state_bc_threshold  ?? WITHDRAWAL_BC_THRESHOLD
  const divLoadAlert = tx.withdrawal_dividend_load_alert ?? WITHDRAWAL_DIV_LOAD_ALERT
  const topHolding   = data.portfolio_intel?.top_holding ?? 'top holding'

  // Build WS_STATES entirely from data — withdrawal_states is always present when rules.json is loaded
  const wsConfig = tx.withdrawal_states
  const annualSpending = (data.spending_intelligence as any)?.true_annual_spending || tx.spending_true_annual || 0
  const stcgRealized = tx.ytd_stcg_realized ?? 0
  const convVerdict = computeConversionVerdict(tx)
  const ctx = { abThreshold, bcThreshold, divLoadAlert, topHolding, targetBracketRate: tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE, annualSpending, stcgRealized, niitApplies: tx.niit_applies === true, convVerdict }
  const WS_STATES = [
    {
      key: 'A' as const,
      label: `A · ${wsConfig?.A.name.replace(/_/g, '-') ?? 'INCOME-DOMINANT'}`,
      desc: wsConfig?.A.description ?? `Gains < ${fmtMoneyFull(abThreshold)} · Live on dividends`,
      bgColor: 'var(--green-dim)',
      borderColor: 'var(--green)',
      rules: wsConfig?.A ? buildRules('A', wsConfig.A.rules, ctx) : [],
    },
    {
      key: 'B' as const,
      label: `B · ${wsConfig?.B.name.replace(/_/g, '-') ?? 'HYBRID'}`,
      desc: wsConfig?.B.description ?? `Gains ${fmtMoneyFull(abThreshold)}–${fmtMoneyFull(bcThreshold)} · Balance income + harvesting`,
      bgColor: 'var(--yellow-dim)',
      borderColor: 'var(--yellow)',
      rules: wsConfig?.B ? buildRules('B', wsConfig.B.rules, ctx) : [],
    },
    {
      key: 'C' as const,
      label: `C · ${wsConfig?.C.name.replace(/_/g, '-') ?? 'CAPITAL-GAIN-DOMINANT'}`,
      desc: wsConfig?.C.description ?? `Gains ≥ ${fmtMoneyFull(bcThreshold)} · Full harvest mode`,
      bgColor: 'var(--red-dim)',
      borderColor: 'var(--red)',
      rules: wsConfig?.C ? buildRules('C', wsConfig.C.rules, ctx) : [],
    },
  ]

  const serverState = tx.withdrawal_current_state
  const stateIdx    = serverState === 'C' ? 2 : serverState === 'B' ? 1 : serverState === 'A' ? 0
                    : gains < abThreshold ? 0 : gains < bcThreshold ? 1 : 2
  const current = WS_STATES[stateIdx]
  const stateColors = ['var(--green)', 'var(--yellow)', 'var(--red)']
  const stateColor = stateColors[stateIdx]

  const toNext = stateIdx === 0 ? abThreshold - gains
               : stateIdx === 1 ? bcThreshold - gains
               : null

  const barMax = bcThreshold * GAIN_BAR_OVERFLOW_FACTOR
  const barPct = Math.min(100, (Math.max(0, gains) / barMax) * 100)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* 3-state step bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {WS_STATES.map((s, i) => {
          const isActive = i === stateIdx
          const isPast = i < stateIdx
          return (
            <div key={i} style={{
              padding: '8px 12px',
              borderRadius: 0,
              background: isActive ? s.bgColor : 'var(--surface)',
              border: `1px solid ${isActive ? s.borderColor : 'var(--fd-hairline)'}`,
              borderBottom: `3px solid ${isActive ? s.borderColor : isPast ? 'var(--border2)' : 'transparent'}`,
              opacity: isPast ? 0.55 : 1,
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.7px', marginBottom: 3,
                color: isActive ? s.borderColor : M }}>
                STATE {s.label}
              </div>
              <div style={{ fontSize: 12, color: isActive ? 'var(--text1)' : M }}>{s.desc}</div>
              {isActive && <div style={{ fontSize: 12, color: s.borderColor, marginTop: 4, fontWeight: 500 }}>◄ CURRENT STATE</div>}
            </div>
          )
        })}
      </div>

      {/* Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 3 }}>TOTAL UNREALIZED GAINS</div>
          <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: gains >= 0 ? G : R }}>
            {gains >= 0 ? '+' : ''}{fmtMoneyFull(gains)}
          </div>
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
            {totalCost > 0 ? `${((gains / totalCost) * 100).toFixed(1)}% gain on ${fmtMoneyFull(totalCost)} cost` : 'total portfolio cost basis'}
          </div>
        </div>
        {(() => {
          // beyondGain: State C confirmed AND gains crossed the gain-ratio threshold
          // stateC_other: State C confirmed by server's ANY_TWO logic, but gains alone
          //   haven't crossed bcThreshold — other conditions (vol, income load, etc.) triggered it
          const beyondGain   = stateIdx === 2 && gains >= bcThreshold
          const stateC_other = stateIdx === 2 && gains < bcThreshold && serverState === 'C'

          const stateCOtherSub = (() => {
            const triggers: string[] = []
            if (stcgRealized > 0) triggers.push(`STCG ${fmtMoneyFull(stcgRealized)}`)
            if (tx.niit_applies) triggers.push('NIIT active')
            if ((data.portfolio_intel?.fragility_score ?? 0) > 60) triggers.push(`fragility ${data.portfolio_intel?.fragility_score}/100`)
            if ((tx.annual_div_total ?? 0) > divLoadAlert) triggers.push('div load above threshold')
            return triggers.length > 0
              ? `Active triggers: ${triggers.join(' · ')}`
              : 'State C via multi-condition (non-gain triggers)'
          })()

          const label  = toNext != null  ? 'DISTANCE TO NEXT STATE'
                       : beyondGain      ? 'BEYOND FINAL THRESHOLD'
                       : stateC_other    ? 'STATE C — MULTI-CONDITION'
                       :                  'GAIN THRESHOLD DISTANCE'

          const value  = toNext != null  ? `${fmtMoneyFull(toNext)} away`
                       : beyondGain      ? `+${fmtMoneyFull(gains - bcThreshold)} over`
                       : stateC_other    ? `${fmtMoneyFull(bcThreshold - gains)} below gain threshold`
                       :                  `${fmtMoneyFull(bcThreshold - gains)} below B→C`

          const sub    = toNext != null  ? `until State ${stateIdx === 0 ? 'B' : 'C'} triggers`
                       : beyondGain      ? 'Gains crossed B→C threshold · full harvest mode'
                       : stateC_other    ? stateCOtherSub
                       :                  ''

          const col    = toNext != null ? Y : beyondGain ? R : Y
          return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: col }}>{value}</div>
              <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{sub}</div>
            </div>
          )
        })()}
        {(() => {
          const fwdDiv = tx.annual_div_total ?? 0
          const divColor = fwdDiv > divLoadAlert ? R : fwdDiv > divLoadAlert * 0.625 ? Y : G
          const divStatus = fwdDiv > divLoadAlert
            ? ' above threshold — trim income ETF positions'
            : fwdDiv > divLoadAlert * 0.625
            ? ' approaching threshold — monitor'
            : '✓ below threshold'
          return (
            <div style={{ background: 'var(--surface)', border: `1px solid ${fwdDiv > divLoadAlert ? 'var(--red-border)' : 'var(--fd-hairline)'}`, borderRadius: 0, padding: '8px 12px' }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>DIVIDEND LOAD STATUS</div>
              <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: divColor }}>
                {fwdDiv > 0 ? fmtMoneyFull(fwdDiv) : '—'}
              </div>
              <div style={{ fontSize: 12, color: M, marginTop: 3 }}>Current load (fwd 12m) · taxable accounts only — drives AGI</div>
              <div style={{ height: '0.5px', background: 'var(--fd-card)', margin: '5px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: M }}>Load alert threshold <span style={{ fontSize: 12, opacity: 0.65 }}>NIIT + W2 income stacking</span></span>
                <span style={{ fontFamily: 'var(--font-mono)', color: M }}>{fmtMoneyFull(divLoadAlert)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2 }}>
                <span style={{ color: M }}>Headroom</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: divColor, fontWeight: 500 }}>
                  {fwdDiv > 0 ? (fwdDiv > divLoadAlert ? `−${fmtMoneyFull(fwdDiv - divLoadAlert)} over` : `${fmtMoneyFull(divLoadAlert - fwdDiv)} remaining`) : '—'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: divColor, marginTop: 3, fontWeight: 500 }}>{divStatus}</div>
            </div>
          )
        })()}
      </div>

      {/* Recommended actions for current state */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: stateColor, letterSpacing: '0.8px', marginBottom: 8 }}>
          ACTIVE RULES · STATE {String.fromCharCode(65 + stateIdx)} — {current.label}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* State accent stays in the section header — coloring every rule's border
              red in State C made routine rules look like alarms. */}
          {current.rules.map((rule, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '6px 10px', background: 'var(--surface)',
              borderRadius: 0, borderLeft: '2px solid var(--border2)',
            }}>
              <span style={{ fontSize: 12, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{rule.icon}</span>
              <span style={{ fontSize: 12, color: 'var(--text1)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>{rule.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3-column ALL STATES REFERENCE — always visible for quick comparison */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px', marginBottom: 8 }}>
          ALL STATES REFERENCE
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {WS_STATES.map((s, i) => {
            const isActive = i === stateIdx
            return (
              <div key={i} style={{
                padding: '8px 10px',
                background: isActive ? s.bgColor : 'transparent',
                border: `1px solid ${isActive ? s.borderColor : 'var(--border2)'}`,
                opacity: isActive ? 1 : 0.55,
              }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: s.borderColor, letterSpacing: '0.6px', marginBottom: 5 }}>
                  STATE {s.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {s.rules.map((r, j) => (
                    <div key={j} style={{ display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 12, flexShrink: 0 }}>{r.icon}</span>
                      <span style={{ fontSize: 12, color: isActive ? 'var(--text1)' : M, lineHeight: 1.35 }}>{r.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Threshold progress bar */}
      {(() => {
        // stateC_other: server confirmed State C via multi-condition logic (ANY_TWO),
        // but gains alone haven't crossed bcThreshold — bar marker will be in B-zone.
        const stateC_other = stateIdx === 2 && gains < bcThreshold && serverState === 'C'
        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                GAINS THRESHOLD TRACKER
              </div>
              {stateC_other && (
                <div style={{ fontSize: 12, color: Y, background: 'var(--yellow-dim)', border: '1px solid var(--yellow-border)', padding: '2px 7px', borderRadius: 0 }}>
                   State C via multi-condition — marker below B→C threshold
                </div>
              )}
            </div>
            <div style={{ position: 'relative', height: 14, background: 'var(--surface)', borderRadius: 0, overflow: 'visible', marginTop: 14 }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 0,
                width: `${barPct}%`,
                background: 'var(--green)',
                opacity: 0.7,
              }} />
              {[
                { v: abThreshold, label: `${fmtMoney(abThreshold)} · A→B` },
                { v: bcThreshold, label: `${fmtMoney(bcThreshold)} · B→C` },
              ].map(t => (
                <div key={t.v} style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${(t.v / barMax) * 100}%`,
                  width: 1, background: 'var(--fd-hairline)',
                }}>
                  <div style={{ position: 'absolute', bottom: 18, left: -18, fontSize: 12, color: M, whiteSpace: 'nowrap' }}>{t.label}</div>
                </div>
              ))}
              {/* Current position marker — colored by active state */}
              <div style={{
                position: 'absolute', top: -4, bottom: -4,
                left: `${barPct}%`, width: 2,
                background: stateColor, borderRadius: 0,
              }}>
                {stateC_other && (
                  <div style={{
                    position: 'absolute', top: -18, left: 4,
                    fontSize: 12, color: Y, whiteSpace: 'nowrap', fontWeight: 500,
                  }}>State C ACTIVE</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: M }}>
              <span>$0</span>
              <span>{fmtMoney(abThreshold)} · A→B</span>
              <span>{fmtMoney(bcThreshold)} · B→C</span>
              <span>{fmtMoney(barMax)}+</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: M }}>
              Portfolio MV: {fmtMoneyFull(totalMV)} · Cost: {fmtMoneyFull(totalCost)} · Thresholds from input.json
            </div>
          </div>
        )
      })()}
    </div>
  )
}
