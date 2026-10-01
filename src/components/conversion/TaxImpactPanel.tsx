import { fmtMoneyFull } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'

/**
 * Conversion tax economics.
 *
 * How a Roth conversion actually works:
 *   • You convert $X from rollover IRA → $X lands in Roth IRA  (gross, pre-tax amount)
 *   • $X is added to ordinary income for the year
 *   • You owe  $X × marginal_rate  in income tax — paid from OUTSIDE funds (bank/taxable)
 *   • The Roth RECEIVES the full $X, not $X minus tax
 *
 * Tax on the conversion is already tracked in the Bracket Filling Engine above.
 * Sell/buy within Roth or rollover IRA = zero tax (tax-advantaged accounts).
 */

interface RothItem { symbol: string; gap_pct: number }

export function TaxImpactPanel({ tx, rothPlan }: { tx: DashboardData['tax_data']; rothPlan?: RothItem[] }) {
  const margRate    = tx.marginal_rate ?? ((tx.target_bracket_rate ?? DEFAULT_BRACKET_RATE) / 100)
  const ratePct     = Math.round(margRate * 100)
  const annualConv  = tx.annual_conversion ?? 0
  const ytdConv     = tx.converted_ytd ?? 0
  const remaining   = Math.max(0, annualConv - ytdConv)

  // Tax cost = conversion amount × marginal rate (paid from outside the IRA)
  const taxOnAnnual    = annualConv  * margRate
  const taxOnYtd       = ytdConv     * margRate
  const taxOnRemaining = remaining   * margRate

  // Rate arbitrage: today's rate vs estimated future rate (SS + RMD onset)
  const FUTURE_BUMP    = 0.03   // conservative ~3pp — update in rules.json when actual data available
  const futureRateEst  = Math.min(0.37, margRate + FUTURE_BUMP)
  const rateArb        = futureRateEst - margRate

  // How much tax this conversion AVOIDS per year once complete
  // (if you drew the same $annualConv from rollover at the future rate instead)
  const futureEscape   = annualConv * rateArb

  return (
    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── How it works callout ───────────────────────────────────────── */}
      <div style={{
        padding: '8px 10px', fontSize: 12, color: M, lineHeight: 1.6,
        background: 'var(--fd-card)',
        border: '1px solid var(--fd-hairline)', borderRadius: 0,
      }}>
        <strong style={{ color: 'var(--blue)' }}>How it works:</strong>{' '}
        The full <strong style={{ color: A }}>{fmtMoneyFull(annualConv)}</strong> goes into your Roth IRA.{' '}
        The tax bill of <strong style={{ color: R }}>{fmtMoneyFull(Math.round(taxOnAnnual))}</strong> is paid{' '}
        from <em>outside funds</em> (bank or taxable account) — not from the converted amount.{' '}
        Sell/buy <em>within</em> Roth or rollover = <strong style={{ color: G }}>zero tax</strong> (tax-advantaged accounts).
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* ── Left: conversion cash flows ──────────────────────────────── */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px', marginBottom: 8 }}>
             CONVERSION TAX — CURRENT YEAR
          </div>

          {/* Annual plan summary */}
          <div style={{ marginBottom: 8, padding: '7px 9px', background: 'var(--fd-card)', borderRadius: 0 }}>
            <div style={{ fontSize: 12, color: M, marginBottom: 4, letterSpacing: '0.5px' }}>ANNUAL PLAN</div>
            {[
              { label: `Annual target → enters Roth`,  val: annualConv,              color: G,  note: 'full amount; Roth receives this' },
              { label: `Tax bill @ ${ratePct}%`,        val: taxOnAnnual,             color: R,  note: 'paid from outside funds' },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ color: M }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: M, marginTop: 1 }}>{r.note}</div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: r.color, alignSelf: 'center' }}>
                  {fmtMoneyFull(Math.round(r.val))}
                </span>
              </div>
            ))}
          </div>

          {/* YTD progress */}
          <div style={{ padding: '7px 9px', background: 'var(--fd-card)', borderRadius: 0 }}>
            <div style={{ fontSize: 12, color: M, marginBottom: 4, letterSpacing: '0.5px' }}>YTD ACTUAL</div>
            {[
              { label: 'Converted YTD → in Roth',  val: ytdConv,       color: G },
              { label: `Tax incurred YTD`,          val: taxOnYtd,      color: R },
              { label: 'Remaining to convert',      val: remaining,     color: A },
              { label: `Est. tax on remaining`,     val: taxOnRemaining, color: remaining > 0 ? R : M },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: M }}>{r.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: r.color }}>
                  {fmtMoneyFull(Math.round(r.val))}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: rate arbitrage ─────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px', marginBottom: 8 }}>
             RATE ARBITRAGE
          </div>

          <div style={{ padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: M }}>Today's rate (locked in)</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: G }}>{ratePct}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: M }}>Est. future rate (SS + RMD)</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: R }}>~{Math.round(futureRateEst * 100)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: M }}>Rate advantage</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: G }}>+{Math.round(rateArb * 100)}%</span>
            </div>
          </div>

          <div style={{ padding: '8px 10px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
            <div style={{ fontSize: 12, color: M, marginBottom: 4 }}>ANNUAL TAX ESCAPE (when complete)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: G }}>
              {fmtMoneyFull(Math.round(futureEscape))}
            </div>
            <div style={{ fontSize: 12, color: M, marginTop: 3, lineHeight: 1.5 }}>
              vs. taking the same {fmtMoneyFull(annualConv)} as rollover withdrawals at {Math.round(futureRateEst * 100)}%
            </div>
          </div>

          {tx.ss_start_age != null && (
            <div style={{
              marginTop: 8, padding: '5px 8px',
              background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
              borderRadius: 0, fontSize: 12, color: 'var(--fd-accent)', lineHeight: 1.5,
            }}>
              SS starts at age {tx.ss_start_age} — stacks on RMD income.
              Conservative estimate: +{Math.round(rateArb * 100)}% (to ~{Math.round(futureRateEst * 100)}%).
              Full SS+RMD+TCJA sunset stack could reach 32%+.
              Converting now locks in {ratePct}%.
            </div>
          )}
        </div>
      </div>

      {/* ── Zero-tax reminder ─────────────────────────────────────────── */}
      {(() => {
        const overSyms  = (rothPlan ?? []).filter(r => r.gap_pct < -0.005).map(r => r.symbol)
        const underSyms = (rothPlan ?? []).filter(r => r.gap_pct >  0.005).map(r => r.symbol)
        const sellPart  = overSyms.length  > 0 ? `Selling ${overSyms.join(' / ')}` : 'Selling overweight positions'
        const buyPart   = underSyms.length > 0 ? `buying ${underSyms.join(' / ')}` : 'buying underweight positions'
        return (
          <div style={{
            padding: '6px 10px', fontSize: 12, color: M, lineHeight: 1.5,
            background: 'var(--fd-card)', borderRadius: 0,
            border: '1px solid var(--fd-hairline)',
          }}>
            <strong style={{ color: G }}>No tax on rebalancing:</strong>{' '}
            {sellPart} and {buyPart} within your Roth or rollover IRA{' '}
            incurs <strong style={{ color: G }}>$0 in tax</strong>. Only the conversion itself
            (rollover → Roth transfer) is a taxable event, already accounted for in the bracket engine above.
          </div>
        )
      })()}
    </div>
  )
}
