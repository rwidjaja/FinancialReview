import { useState } from 'react'
import { PanelHeader, DataRow, Divider } from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { fmtMoneyFull, fmtPrice } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE, LTCG_RATE_15 } from '../../utils/constants'
import { NIIT_RATE } from '../../utils/taxConfig'
import { G, R, A, M, Y } from './taxColors'
import { getWithdrawalStateView, shortfallFundingNote, withdrawalRealizesGains } from '../../utils/withdrawalState'
import type { DashboardData } from '../../types/dashboard'

export function CashflowEngine({ tx }: { tx: DashboardData['tax_data'] }) {
  const spending = tx.spending_true_annual
  const withdrawal = tx.withdrawal_need_actual
  const surplus = tx.income_surplus
  const agi = tx.agi_real ?? tx.annual_div_for_agi
  // Conv room must be ceiling − gross_actual (same actual-basis formula BracketMeter
  // uses via grossActual={tx.gross_actual ?? tx.gross_no_ss} at TaxTab.tsx) so both
  // panels show the same number. gross_no_ss is plan-inflated (uses max(ytd_converted,
  // annual_target)) — using it here understated room by the full remaining-target gap.
  // conv_room_real uses _agi_real which adds a withdrawal-need adjustment not
  // reflected in the displayed AGI figure, so it's kept only as the no-ceiling fallback.
  const _ceil = tx.target_bracket_ceiling
  const _agi  = tx.gross_actual ?? tx.gross_no_ss
  const convRoom = _ceil != null && _agi != null
    ? Math.max(0, _ceil - _agi)
    : tx.conv_room_real
  const bktPct = tx.bracket_pressure_pct
  // Withdrawal state drives every state-dependent claim in this panel. Derived from
  // server config (tx.withdrawal_states) — never assumed. See utils/withdrawalState.ts.
  const ws = getWithdrawalStateView(tx)

  const surplusColor = surplus == null ? M : surplus >= 0 ? G : R
  // Fix 2: rename CASHFLOW GAP → WITHDRAWAL NEED to clarify: this is not a deficit, it's the
  // annual portfolio withdrawal needed after dividends cover most spending. "Gap" implies a
  // problem; "withdrawal need" is accurate whenever the active state actually permits the
  // sales that fund it — which shortfallFundingNote() checks instead of assuming State C.
  const surplusLabel = surplus != null && surplus < 0 ? 'WITHDRAWAL NEED (NET)' : 'CASHFLOW SURPLUS'
  const surplusSub   = surplus != null && surplus < 0 ? shortfallFundingNote(ws) : null
  // A shortfall is routine where controlled sales are allowed, and notable where they
  // aren't (the state assumes income covers spending). Unknown config → neutral.
  const surplusSubColor = ws.allowControlledSale === false ? A : M
  const convRoomColor = convRoom == null ? M : convRoom > 20000 ? G : convRoom > 5000 ? Y : R

  // Safe Harbor
  const [showSHModal, setShowSHModal] = useState(false)
  const safeHarborMet = tx.safe_harbor_met
  const hasPriorYearTax = tx.safe_harbor_prior_year_tax != null && tx.safe_harbor_prior_year_tax > 0
  const safeHarborColor = safeHarborMet == null ? M : safeHarborMet ? G : R
  const safeHarborLabel = safeHarborMet == null
    ? (hasPriorYearTax ? 'NO QUARTERS DUE' : 'NEEDS CONFIG')
    : safeHarborMet ? '✓ MET' : '✗ NOT MET'

  // Underpayment Risk — a withdrawal only moves quarterly AGI if the active state
  // funds it by realizing gains. States that forbid controlled sales fund from cash,
  // which carries no AGI-timing risk, so the label shouldn't escalate there.
  const wdNeed = withdrawal ?? 0
  const wdRealizesGains = withdrawalRealizesGains(ws)   // null = unknown config
  const underpayElevated = wdNeed > 0 && wdRealizesGains !== false
  const underpayColor = underpayElevated ? A : G
  const underpayLabel = underpayElevated ? 'WATCH' : 'LOW'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', padding: '10px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <PanelHeader>SPENDING & WITHDRAWAL</PanelHeader>
            {/* Shows which state drives the wording below — server-computed, not assumed */}
            {ws.label && (
              <span title={ws.def?.description ?? undefined} style={{
                fontSize: 12, fontWeight: 500, letterSpacing: '0.5px', padding: '2px 5px',
                borderRadius: 0, background: 'var(--fd-card)', color: M, whiteSpace: 'nowrap',
              }}>{ws.label}</span>
            )}
          </div>
          {/* No withdrawal-state qualifier: spending_true_annual is measured from
              transactions.csv and is identical in State A/B/C. The old "(STATE C)"
              label was hardcoded and read as false while the server reported State B. */}
          <DataRow label="TOTAL SPENDING · annual" value={<span style={{ color: R }}>{spending ? fmtMoneyFull(spending) : '—'}</span>} />
          {/* Fix 2: clarify withdrawal need = annual portfolio withdrawal after dividends cover spending */}
          <DataRow label="WITHDRAWAL NEED · annual" value={<span style={{ color: withdrawal ? R : M }}>{withdrawal ? `${fmtMoneyFull(withdrawal)}/yr` : 'NONE'}</span>} />
          {surplus != null && (
            <>
              <DataRow label={surplusLabel} value={<span style={{ color: surplusColor, fontWeight: 500 }}>
                {surplus >= 0 ? '+' : ''}{fmtMoneyFull(surplus)}
              </span>} />
              {surplusSub && <div className="bb-sub" style={{ marginTop: 2, color: surplusSubColor }}>{surplusSub}</div>}
            </>
          )}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', padding: '10px 14px' }}>
          <PanelHeader>AGI PROJECTION</PanelHeader>
          <DataRow label="DIVIDENDS (AGI)" value={<span style={{ color: 'var(--text)' }}>{fmtMoneyFull(tx.annual_div_for_agi)}</span>} />
          {tx.ytd_stcg_realized != null && tx.ytd_stcg_realized > 0 && (
            <DataRow label={`+ STCG REALIZED (${tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}%${tx.niit_applies ? ' + NIIT' : ''})`} value={<span style={{ color: R, fontWeight: 500 }}>{fmtMoneyFull(tx.ytd_stcg_realized)}</span>} />
          )}
          {tx.ytd_ltcg_realized != null && tx.ytd_ltcg_realized > 0 && (
            <DataRow label={`+ LTCG REALIZED (${Math.round((tx.ltcg_rate ?? LTCG_RATE_15) * 100)}%)`} value={<span style={{ color: Y }}>{fmtMoneyFull(tx.ytd_ltcg_realized)}</span>} />
          )}
          {agi != null && agi !== tx.annual_div_for_agi && (
            <DataRow label="AGI W/ CONVERSIONS" value={<span style={{ color: A, fontWeight: 500 }}>{fmtMoneyFull(agi)}</span>} />
          )}
          {convRoom != null && (
            <DataRow label="CONV ROOM LEFT" value={<span style={{ color: convRoomColor, fontWeight: 500 }}>{fmtMoneyFull(convRoom)}</span>} />
          )}
          {tx.converted_ytd > 0 && (
            <DataRow label="CONVERTED YTD" value={<span style={{ color: A }}>{fmtMoneyFull(tx.converted_ytd)}</span>} />
          )}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', padding: '10px 14px' }}>
          <PanelHeader>BRACKET PRESSURE (proj. gross ÷ ceiling)</PanelHeader>
          <div style={{ margin: '4px 0 8px' }}>
            <MiniBar value={Math.min(100, bktPct ?? 0)} color={bktPct != null && bktPct >= 90 ? R : bktPct != null && bktPct >= 70 ? Y : G} height={6} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 500, color: bktPct != null && bktPct >= 90 ? R : bktPct != null && bktPct >= 70 ? Y : G }}>
            {bktPct != null ? `${bktPct.toFixed(1)}%` : '—'}
          </div>
          <div className="bb-sub">OF {tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE}% BRACKET USED</div>
          {tx.target_bracket_ceiling != null && (
            <>
              <Divider />
              <DataRow label="CEILING" value={<span style={{ color: M }}>{fmtMoneyFull(tx.target_bracket_ceiling)}</span>} />
            </>
          )}
        </div>
      </div>

      {/* NIIT panel */}
      {(tx.niit_applies != null) && (
        <div style={{
          background: tx.niit_applies ? 'var(--red-dim)' : 'var(--surface)',
          border: `1px solid ${tx.niit_applies ? 'var(--red-border)' : 'var(--fd-hairline)'}`,
          borderRadius: 0,
          padding: '10px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <PanelHeader>NIIT — NET INVESTMENT INCOME TAX ({((tx.niit_rate ?? NIIT_RATE) * 100).toFixed(1)}%)</PanelHeader>
            <span style={{
              fontSize: 12, fontWeight: 500, padding: '2px 6px', borderRadius: 0,
              background: tx.niit_applies ? 'var(--red-dim)' : 'var(--green-dim)',
              color: tx.niit_applies ? 'var(--red)' : 'var(--green)',
            }}>
              {tx.niit_applies ? ' APPLIES' : '✓ CLEAR'}
            </span>
          </div>
          {tx.niit_applies ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
              <DataRow label="ESTIMATED NIIT" value={<span style={{ color: 'var(--red)', fontWeight: 500 }}>{fmtMoneyFull(tx.niit_amount ?? 0)}</span>} />
              {tx.collect_medicare === true && <>
                <DataRow label="MAGI THRESHOLD" value={fmtMoneyFull(tx.niit_threshold ?? 0)} />
                <DataRow label="MAGI OVER THRESHOLD" value={<span style={{ color: 'var(--red)' }}>{fmtMoneyFull(Math.max(0, (tx.magi ?? tx.gross_actual ?? tx.gross_no_ss ?? 0) - (tx.niit_threshold ?? 0)))}</span>} />
              </>}
              {/* Reallocation is a state-gated action: only states whose rules set
                  allow_trimming_income_etfs may shift the income mix. Where they don't,
                  suggesting it would contradict the active strategy. */}
              <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 4 }}>
                {ws.allowTrimmingIncomeEtfs === true
                  ? `Reduce dividend income or increase RoC-heavy ETF allocation to lower NIIT exposure — State ${ws.state} permits trimming income ETFs`
                  : ws.allowTrimmingIncomeEtfs === false
                    ? `State ${ws.state} holds the income mix — NIIT exposure is accepted here; revisit if the state escalates`
                    : 'Reduce dividend income or increase RoC-heavy ETF allocation to lower NIIT exposure'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
              <DataRow label="HEADROOM BEFORE NIIT" value={<span style={{ color: 'var(--green)', fontWeight: 500 }}>{fmtMoneyFull(tx.niit_headroom ?? 0)}</span>} />
              <DataRow label="NIIT THRESHOLD" value={fmtMoneyFull(tx.niit_threshold ?? 0)} />
            </div>
          )}
        </div>
      )}

      {/* IRMAA panel — only when collect_medicare: true */}
      {tx.collect_medicare === true && tx.irmaa_tier_idx != null && (
        <div style={{
          background: tx.irmaa_tier_idx > 0 ? 'var(--amber-dim)' : 'var(--surface)',
          border: `1px solid ${tx.irmaa_tier_idx > 0 ? 'var(--amber-border)' : 'var(--fd-hairline)'}`,
          borderRadius: 0,
          padding: '10px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <PanelHeader>IRMAA — MEDICARE PREMIUM SURCHARGE</PanelHeader>
            <span style={{
              fontSize: 12, fontWeight: 500, padding: '2px 6px', borderRadius: 0,
              background: tx.irmaa_tier_idx > 0 ? 'var(--amber-dim)' : 'var(--green-dim)',
              color: tx.irmaa_tier_idx > 0 ? 'var(--amber)' : 'var(--green)',
            }}>
              {tx.irmaa_tier_label ?? `TIER ${tx.irmaa_tier_idx}`}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
            <DataRow label="MAGI" value={<span style={{ color: 'var(--text)' }}>{tx.magi != null ? fmtMoneyFull(tx.magi) : '—'}</span>} />
            {tx.irmaa_tier_idx === 0 ? (
              <>
                <DataRow label="PART B SURCHARGE" value={<span style={{ color: 'var(--green)' }}>$0 / mo</span>} />
                <DataRow label="PART D SURCHARGE" value={<span style={{ color: 'var(--green)' }}>$0 / mo</span>} />
                {tx.irmaa_headroom != null && (
                  <DataRow label="HEADROOM TO TIER 1" value={<span style={{ color: 'var(--green)', fontWeight: 500 }}>{fmtMoneyFull(tx.irmaa_headroom)}</span>} />
                )}
              </>
            ) : (
              <>
                <DataRow
                  label={`PART B${(tx.medicare_people ?? 1) > 1 ? ` × ${tx.medicare_people}` : ''}`}
                  value={<span style={{ color: 'var(--amber)', fontWeight: 500 }}>{fmtPrice((tx.irmaa_part_b_monthly ?? 0) * (tx.medicare_people ?? 1))} / mo</span>}
                />
                <DataRow
                  label={`PART D${(tx.medicare_people ?? 1) > 1 ? ` × ${tx.medicare_people}` : ''}`}
                  value={<span style={{ color: 'var(--amber)' }}>{fmtPrice((tx.irmaa_part_d_monthly ?? 0) * (tx.medicare_people ?? 1))} / mo</span>}
                />
                <DataRow label="ANNUAL IRMAA COST" value={<span style={{ color: 'var(--amber)', fontWeight: 500 }}>{tx.irmaa_annual != null ? fmtMoneyFull(tx.irmaa_annual) : '—'}</span>} />
                {tx.irmaa_headroom != null && tx.irmaa_next_threshold != null && (
                  <DataRow label={`HEADROOM TO NEXT TIER (${fmtMoneyFull(tx.irmaa_next_threshold)})`} value={<span style={{ color: 'var(--text)' }}>{fmtMoneyFull(tx.irmaa_headroom)}</span>} />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Safe Harbor + Underpayment Risk row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: `1px solid ${safeHarborMet == null ? 'var(--fd-hairline)' : safeHarborMet ? 'var(--fd-hairline)' : 'var(--fd-hairline)'}`, borderRadius: 0, overflow: 'hidden', padding: '10px 14px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <PanelHeader>SAFE HARBOR STATUS — 110% PRIOR-YEAR TEST</PanelHeader>
            <button onClick={() => setShowSHModal(true)} style={{ background: 'none', border: '1px solid var(--fd-hairline)', borderRadius: 3, color: M, cursor: 'pointer', fontSize: 12, fontWeight: 500, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, flexShrink: 0, marginTop: -2 }}>?</button>
          </div>
          <div style={{ fontSize: 20, fontWeight: 500, color: safeHarborColor, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
            {safeHarborLabel}
          </div>
          {!hasPriorYearTax ? (
            <div className="bb-sub" style={{ color: M }}>
              Add <span style={{ color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>prior_year_tax</span> to personal.json → _TAX_SETTINGS to enable this check
            </div>
          ) : safeHarborMet == null ? (
            <div className="bb-sub">No quarters due yet — check back after Apr 15</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
              <DataRow label="PRIOR YEAR TAX" value={<span style={{ color: M }}>{fmtMoneyFull(tx.safe_harbor_prior_year_tax!)}</span>} />
              <DataRow label="REQUIRED (110%)" value={<span style={{ color: M }}>{fmtMoneyFull(tx.safe_harbor_required_total!)}</span>} />
              {tx.safe_harbor_required_ytd != null && (
                <DataRow label="REQUIRED YTD" value={<span style={{ color: M }}>{fmtMoneyFull(tx.safe_harbor_required_ytd)}</span>} />
              )}
              {tx.safe_harbor_paid_ytd != null && (
                <DataRow label="PROJECTED PAID YTD" value={<span style={{ color: safeHarborMet ? G : R, fontWeight: 500 }}>{fmtMoneyFull(tx.safe_harbor_paid_ytd)}</span>} />
              )}
              {tx.safe_harbor_w2_withholding != null && tx.safe_harbor_w2_withholding > 0 && (
                <DataRow label="  ↳ W2 WITHHOLDING" value={<span style={{ color: M, fontSize: 12 }}>{fmtMoneyFull(tx.safe_harbor_w2_withholding)}</span>} />
              )}
              {tx.safe_harbor_gap != null && (
                <DataRow label={tx.safe_harbor_gap >= 0 ? 'CUSHION' : 'GAP'} value={<span style={{ color: safeHarborMet ? G : R, fontWeight: 500 }}>
                  {tx.safe_harbor_gap >= 0 ? '+' : ''}{fmtMoneyFull(tx.safe_harbor_gap)}
                </span>} />
              )}
            </div>
          )}
        </div>

        {/* Safe Harbor Modal */}
        {showSHModal && (
          <div onClick={() => setShowSHModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', border: '1px solid var(--fd-hairline)', borderRadius: 12, padding: '24px 28px', maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
              <button onClick={() => setShowSHModal(false)} style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', color: M, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>

              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', letterSpacing: '0.08em', marginBottom: 16 }}>SAFE HARBOR — 110% PRIOR-YEAR TEST</div>

              {/* What is it */}
              <div style={{ fontSize: 12, color: M, lineHeight: 1.6, marginBottom: 16 }}>
                The IRS requires high-income taxpayers (AGI {'>'} $150K MFJ) to prepay at least <span style={{ color: 'var(--text)', fontWeight: 500 }}>110% of their prior-year total tax</span> through a combination of W2 withholding and estimated quarterly payments. Meeting this threshold protects you from underpayment penalties regardless of what you actually owe in the current year.
              </div>

              {/* Divider */}
              <div style={{ borderTop: '1px solid var(--fd-hairline)', marginBottom: 14 }} />

              {/* Numbers */}
              {hasPriorYearTax && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: M }}>Prior year total tax (2025)</span>
                    <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(tx.safe_harbor_prior_year_tax!)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: M }}>× 110% safe harbor multiplier</span>
                    <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(tx.safe_harbor_required_total!)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: M }}>÷ 4 quarters</span>
                    <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{tx.safe_harbor_required_total != null ? fmtMoneyFull(Math.round(tx.safe_harbor_required_total / 4)) : '—'} / quarter</span>
                  </div>
                  <div style={{ borderTop: '1px solid var(--fd-hairline)', paddingTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: M }}>Quarters past due (of 4)</span>
                      <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                        {tx.safe_harbor_required_ytd != null && tx.safe_harbor_required_total != null
                          ? Math.round(tx.safe_harbor_required_ytd / (tx.safe_harbor_required_total / 4))
                          : '—'}
                      </span>
                    </div>
                    {tx.safe_harbor_required_ytd != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: M }}>Required paid by now</span>
                        <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(tx.safe_harbor_required_ytd)}</span>
                      </div>
                    )}
                    {tx.safe_harbor_paid_ytd != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: M }}>Projected paid YTD</span>
                        <span style={{ color: safeHarborMet ? G : R, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(tx.safe_harbor_paid_ytd)}</span>
                      </div>
                    )}
                    {tx.safe_harbor_w2_withholding != null && tx.safe_harbor_w2_withholding > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, paddingLeft: 12 }}>
                        <span style={{ color: M }}>↳ of which W2 withholding</span>
                        <span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(tx.safe_harbor_w2_withholding)}</span>
                      </div>
                    )}
                    {tx.safe_harbor_gap != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 500, paddingTop: 6, borderTop: '1px solid var(--fd-hairline)' }}>
                        <span style={{ color: safeHarborMet ? G : R }}>{tx.safe_harbor_gap >= 0 ? 'Cushion' : 'Shortfall'}</span>
                        <span style={{ color: safeHarborMet ? G : R, fontFamily: 'var(--font-mono)' }}>{tx.safe_harbor_gap >= 0 ? '+' : ''}{fmtMoneyFull(tx.safe_harbor_gap)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Verdict explanation */}
              <div style={{ borderTop: '1px solid var(--fd-hairline)', paddingTop: 14 }}>
                {safeHarborMet === true && (
                  <div style={{ fontSize: 12, color: G, lineHeight: 1.6 }}>
                    ✓ You are on track. Your projected payments through the quarters that have passed meet or exceed the 110% threshold. Continue paying quarterly estimates on schedule to maintain this through year-end.
                  </div>
                )}
                {safeHarborMet === false && tx.safe_harbor_gap != null && (
                  <div style={{ fontSize: 12, color: R, lineHeight: 1.6 }}>
                    ✗ You are behind. To catch up, you need an additional <span style={{ fontWeight: 500 }}>{fmtMoneyFull(Math.abs(tx.safe_harbor_gap))}</span> paid by the next quarterly due date. Without it, the IRS can assess an underpayment penalty on the shortfall — even if you pay in full by April 15.
                  </div>
                )}
                {safeHarborMet == null && hasPriorYearTax && (
                  <div style={{ fontSize: 12, color: M, lineHeight: 1.6 }}>
                    No quarterly due dates have passed yet. The first check runs after April 15 (Q1). Come back then to see your status.
                  </div>
                )}
              </div>

              {/* Due dates reference */}
              <div style={{ borderTop: '1px solid var(--fd-hairline)', paddingTop: 14, marginTop: 14 }}>
                <div style={{ fontSize: 12, color: M, letterSpacing: '0.06em', marginBottom: 8 }}>IRS ESTIMATED TAX DUE DATES</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                  {[['Q1','Jan–Mar','Apr 15'],['Q2','Apr–May','Jun 15'],['Q3','Jun–Aug','Sep 15'],['Q4','Sep–Dec','Jan 15']].map(([q, period, due]) => (
                    <div key={q} style={{ background: 'var(--fd-card)', borderRadius: 0, padding: '6px 8px', textAlign: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{q}</div>
                      <div style={{ fontSize: 12, color: M }}>{period}</div>
                      <div style={{ fontSize: 12, color: A, marginTop: 2 }}>due {due}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--fd-muted)', lineHeight: 1.5 }}>
                Note: "projected paid YTD" counts estimated quarterly payments the dashboard projects from your dividend/cap gain income, plus any W2 withholding you entered in Settings. Actual amounts paid may differ — verify with your tax advisor.
              </div>
            </div>
          </div>
        )}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden', padding: '10px 14px' }}>
          <PanelHeader>UNDERPAYMENT RISK</PanelHeader>
          <div style={{ fontSize: 20, fontWeight: 500, color: underpayColor, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>
            {underpayLabel}
          </div>
          <div className="bb-sub">
            {wdNeed <= 0
              ? 'Spending covered by income — no withdrawal timing risk'
              : wdRealizesGains === false
                ? `State ${ws.state} funds withdrawals from cash, not sales — no gain-realization timing risk`
                : (tx.ytd_stcg_realized ?? 0) > 0
                  ? 'Realized STCG shifts quarterly AGI — monitor underpayment risk due to STCG timing'
                  : 'Withdrawal timing can shift quarterly AGI'}
          </div>
        </div>
      </div>
    </div>
  )
}
