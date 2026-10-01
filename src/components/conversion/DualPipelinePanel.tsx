import { PanelHeader } from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { fmtMoneyFull } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'
const Y = 'var(--yellow)'
const B = 'var(--blue)'

interface DualPipelineProps {
  tx: DashboardData['tax_data']
  ytdConverted: number
  grossNoSS: number
  ceiling: number
}

export function DualPipelinePanel({ tx, ytdConverted, grossNoSS, ceiling }: DualPipelineProps) {
  const bktRate = tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE

  // STCG is taxed at the actual current marginal bracket + NIIT, not the
  // target bracket the user is trying to fill up to — same calc as LotAdvisor.
  const rawMarginal  = tx.marginal_rate ?? bktRate
  const baseStcgRate = rawMarginal > 1 ? rawMarginal / 100 : rawMarginal
  const niitAddon     = (tx.niit_applies ?? false) ? (tx.niit_rate ?? 0.038) : 0
  const actualStcgRate = baseStcgRate + niitAddon

  // grossNoSS already = divs(AGI) + STCG + YTD conversions, so it IS the
  // ytd ordinary income. Don't add ytdConverted again (server's own
  // ytd_ordinary_income field also avoids the double-count).
  const ytdOrdinaryIncome  = tx.ytd_ordinary_income  ?? grossNoSS
  // Canonical room = ceiling − grossNoSS (matches actualRoom in TaxTab).
  // Ignore server's remaining_ordinary_room which subtracts safety_buffer
  // and produces a different number from the canonical view.
  const remainOrdinaryRoom = Math.max(0, ceiling - grossNoSS)
  const ordUsedPct = ceiling > 0 ? Math.min(100, (ytdOrdinaryIncome / ceiling) * 100) : 0

  const ytdLTCG   = tx.ytd_ltcg_realized ?? null
  const ytdSTCG   = tx.ytd_stcg_realized ?? null
  const ltcg0Threshold  = tx.ltcg_0pct_threshold
  const ltcg15Threshold = tx.ltcg_15pct_threshold
  const ltcg0Room       = tx.ltcg_0pct_room
  const ltcg15Room      = tx.ltcg_15pct_room
  const ltcg15UsedPct   = ltcg15Threshold && ltcg15Threshold > 0
    ? Math.min(100, ((ltcg15Threshold - (ltcg15Room ?? 0)) / ltcg15Threshold) * 100)
    : 0

  const unrealizedGains  = tx.taxable_unrealized_gains  ?? 0
  const unrealizedLosses = tx.taxable_unrealized_losses ?? 0
  const unrealizedBySymbol = tx.taxable_unrealized_by_symbol ?? {}
  const realizedBySym    = tx.realized_gains_by_symbol   ?? {}

  const topUnrealized = Object.entries(unrealizedBySymbol)
    .filter(([, g]) => g > 0)
    .sort(([, a], [, b]) => b - a)

  const hasLtcgData = ltcg0Threshold != null && ltcg15Threshold != null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

        <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderTop: `3px solid ${A}` }}>
          <PanelHeader>PIPELINE A — ORDINARY INCOME ({bktRate}% CEILING)</PanelHeader>
          <div style={{ fontSize: 12, color: M, marginBottom: 8, lineHeight: 1.5 }}>
            Rollover → Roth conversions consume ordinary income bracket room.
          </div>
          {[
            { label: `${bktRate}% Bracket Ceiling`, val: ceiling,                                                color: G, nullOk: false },
            { label: '− Dividends (AGI portion)',    val: tx.annual_div_for_agi != null ? -tx.annual_div_for_agi : null, color: R, nullOk: true },
            { label: '− STCG Realized',              val: ytdSTCG != null ? -ytdSTCG : null,                     color: R, nullOk: true },
            { label: '− YTD Conversions',            val: -ytdConverted,                                         color: R, nullOk: false },
          ].map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: M }}>{r.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: r.val == null ? M : r.color }}>
                {r.val == null ? '—' : (r.val >= 0 ? '' : '−') + fmtMoneyFull(Math.abs(r.val))}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 500, padding: '6px 0' }}>
            <span>= Remaining Ordinary Room</span>
            <span style={{ color: remainOrdinaryRoom > 20000 ? G : remainOrdinaryRoom > 5000 ? Y : R, fontFamily: 'var(--font-mono)' }}>
              {fmtMoneyFull(remainOrdinaryRoom)}
            </span>
          </div>
          <MiniBar value={ordUsedPct} color={ordUsedPct > 90 ? R : ordUsedPct > 75 ? Y : G} height={5} />
          <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{ordUsedPct.toFixed(0)}% of {bktRate}% bracket consumed</div>
        </div>

        <div style={{ background: 'var(--surface)', padding: '12px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', borderTop: `3px solid ${B}` }}>
          <PanelHeader>PIPELINE B — LTCG CEILING (TAXABLE SALES)</PanelHeader>
          <div style={{ fontSize: 12, color: M, marginBottom: 8, lineHeight: 1.5 }}>
            Taxable → target rebalancing realizes capital gains stacked on top of ordinary income.
          </div>
          {hasLtcgData ? (
            <>
              {[
                { label: '0% LTCG Threshold',   val: ltcg0Threshold ?? 0,  color: G },
                { label: '15% LTCG Threshold',  val: ltcg15Threshold ?? 0, color: Y },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: M }}>{r.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: r.color }}>{fmtMoneyFull(r.val)}</span>
                </div>
              ))}
              {[
                { label: 'Ordinary Taxable Income (incl. qualified div)', val: tx.ordinary_taxable_income ?? null, color: M },
                { label: '+ LTCG Realized YTD',     val: ytdLTCG,                           color: R },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: M }}>{r.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: r.val == null ? M : r.color }}>
                    {r.val == null ? '—' : fmtMoneyFull(r.val)}
                  </span>
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--border2)', margin: '6px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                <span style={{ color: M }}>0% Room Remaining</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: (ltcg0Room ?? 0) > 0 ? G : R }}>
                  {ltcg0Room != null ? fmtMoneyFull(ltcg0Room) : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                <span style={{ color: M }}>15% Room Remaining</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: Y }}>
                  {ltcg15Room != null ? fmtMoneyFull(ltcg15Room) : '—'}
                </span>
              </div>
              <div style={{ marginTop: 8 }}>
                <MiniBar value={ltcg15UsedPct} color={ltcg15UsedPct > 90 ? R : ltcg15UsedPct > 60 ? Y : G} height={5} />
                <div style={{ fontSize: 12, color: M, marginTop: 2 }}>{ltcg15UsedPct.toFixed(0)}% of 15% LTCG bracket consumed</div>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: M }}>No LTCG bracket config — add ltcg_brackets_mfj/single to _TAX_RULE_ENGINE in input.json</div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', padding: '10px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div className="bb-label">LTCG REALIZED YTD</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: ytdLTCG == null ? M : ytdLTCG > 0 ? Y : G, fontFamily: 'var(--font-mono)', margin: '3px 0' }}>
            {ytdLTCG == null ? '—' : fmtMoneyFull(ytdLTCG)}
          </div>
          <div style={{ fontSize: 12, color: M }}>{ytdLTCG == null ? 'Unavailable — no YTD sell transactions found' : 'Long-term capital gains from taxable sells'}</div>
        </div>
        <div style={{ background: 'var(--surface)', padding: '10px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div className="bb-label">STCG REALIZED YTD</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: ytdSTCG == null ? M : ytdSTCG > 0 ? R : G, fontFamily: 'var(--font-mono)', margin: '3px 0' }}>
            {ytdSTCG == null ? '—' : fmtMoneyFull(ytdSTCG)}
          </div>
          <div style={{ fontSize: 12, color: M }}>{ytdSTCG == null ? 'Unavailable — check Schwab transaction API' : 'Short-term gains consumed ordinary bracket'}</div>
        </div>
        <div style={{ background: 'var(--surface)', padding: '10px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
          <div className="bb-label">UNREALIZED GAINS (TAXABLE)</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: unrealizedGains > 0 ? Y : G, fontFamily: 'var(--font-mono)', margin: '3px 0' }}>
            {fmtMoneyFull(unrealizedGains)}
          </div>
          <div style={{ fontSize: 12, color: M }}>
            Losses: <span style={{ color: unrealizedLosses < 0 ? G : M, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(unrealizedLosses)}</span>
          </div>
        </div>
      </div>

      {(topUnrealized.length > 0 || Object.keys(realizedBySym).length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

          {topUnrealized.length > 0 && (
            <div style={{ background: 'var(--surface)', padding: '10px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <PanelHeader>TAXABLE UNREALIZED GAINS BY POSITION</PanelHeader>
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: 340 }}>
                <table className="bb-table">
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                    <tr><th>SYM</th><th className="r">UNREALIZED</th><th className="r">ST GAIN</th><th className="r">LT GAIN</th><th className="r">TAX RATE</th></tr>
                  </thead>
                  <tbody>
                    {topUnrealized.map(([sym, gain]) => {
                      const lotData = (tx.cost_basis_lots ?? {} as Record<string, { stcg_gain?: number; ltcg_gain?: number }>)[sym]
                      const stcgGain = lotData?.stcg_gain ?? 0
                      const ltcgGain = lotData?.ltcg_gain ?? 0
                      const hasStcg  = stcgGain > 0
                      const hasLtcg  = ltcgGain > 0

                      let taxLabel: string
                      let taxColor: string
                      if (hasStcg && !hasLtcg) {
                        taxLabel = `${(actualStcgRate * 100).toFixed(1)}% (ST)`
                        taxColor = R
                      } else if (hasLtcg && !hasStcg) {
                        if (ltcg0Room != null && ltcg0Room > 0) {
                          taxLabel = ltcgGain <= ltcg0Room ? '0% FREE' : '0%→15%'
                          taxColor = G
                        } else {
                          taxLabel = '15% (LT)'
                          taxColor = Y
                        }
                      } else if (hasStcg && hasLtcg) {
                        taxLabel = `MIXED`
                        taxColor = Y
                      } else {
                        taxLabel = ltcg0Room != null && ltcg0Room > 0
                          ? (gain <= ltcg0Room ? '0% FREE' : '0%→15%')
                          : '15% (LT)'
                        taxColor = (ltcg0Room ?? 0) > 0 ? G : Y
                      }

                      return (
                        <tr key={sym}>
                          <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{sym}</td>
                          <td className="r" style={{ fontFamily: 'var(--font-mono)', color: Y, fontWeight: 500 }}>{fmtMoneyFull(gain)}</td>
                          <td className="r" style={{ fontFamily: 'var(--font-mono)', color: stcgGain > 0 ? R : M, fontSize: 12 }}>
                            {stcgGain > 0 ? fmtMoneyFull(stcgGain) : '—'}
                          </td>
                          <td className="r" style={{ fontFamily: 'var(--font-mono)', color: ltcgGain > 0 ? Y : M, fontSize: 12 }}>
                            {ltcgGain > 0 ? fmtMoneyFull(ltcgGain) : '—'}
                          </td>
                          <td className="r" style={{ fontFamily: 'var(--font-mono)', color: taxColor, fontSize: 12, fontWeight: 500 }}>{taxLabel}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {Object.keys(realizedBySym).length > 0 && (
            <div style={{ background: 'var(--surface)', padding: '10px 14px', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <PanelHeader>REALIZED GAINS BY SYMBOL (YTD)</PanelHeader>
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: 340 }}>
                <table className="bb-table">
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                    <tr><th>SYM</th><th className="r">GAIN</th><th className="r">TYPE</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(realizedBySym)
                      .sort(([, a], [, b]) => (b as { gain: number }).gain - (a as { gain: number }).gain)
                      .map(([sym, info]) => {
                        const g = (info as { gain: number; type: string })
                        return (
                          <tr key={sym}>
                            <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{sym}</td>
                            <td className="r" style={{ fontFamily: 'var(--font-mono)', color: g.gain >= 0 ? Y : G, fontWeight: 500 }}>{fmtMoneyFull(g.gain)}</td>
                            <td className="r" style={{ fontFamily: 'var(--font-mono)', color: g.type === 'LTCG' ? Y : R, fontSize: 12 }}>{g.type}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
