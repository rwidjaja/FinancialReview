/**
 * LotAdvisor — "when can I sell this?" panel for the Portfolio tab.
 *
 * Per position: STCG vs LTCG split, sell signal, maturity calendar.
 * Per lot (expanded): tax consequence — sell now vs wait, savings, breakeven.
 */

import React, { useState } from 'react'
import { fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData, CostBasisSymbol, CostLot } from '../../types/dashboard'
import { buildSymbolRoles, compareSellPriority, sellPriorityExplanation, type SymbolRole } from '../../utils/sellPriority'
import { getWithdrawalStateView } from '../../utils/withdrawalState'
import { TerminalSection } from '../ui/Terminal'
import { DualPipelinePanel } from '../conversion/DualPipelinePanel'
import { LotMaturityPanel } from '../conversion/LotMaturityPanel'

const G  = 'var(--green)'
const R  = 'var(--red)'
const A  = 'var(--amber)'
const Y  = 'var(--yellow)'
const C  = 'var(--cyan)'
const M  = 'var(--text2)'
const M3 = 'var(--text3)'

// ── Helpers ────────────────────────────────────────────────────────────────────
function daysColor(days: number | null): string {
  if (days === null || days === 0) return G
  if (days <= 14)  return C
  if (days <= 60)  return Y
  if (days <= 180) return A
  return M
}

function daysLabel(days: number | null): string {
  if (days === null || days === 0) return 'LTCG ✓'
  if (days === 1) return '1 day'
  if (days <= 7)  return `${days}d `
  if (days <= 60) return `${days}d`
  const months = Math.round(days / 30)
  return `~${months}mo`
}

function fmtPct(v: number) {
  return `${(v * 100).toFixed(0)}%`
}

// ── Tax consequence math ───────────────────────────────────────────────────────
interface TaxConsequence {
  taxNow: number        // estimated tax if sold now (STCG rate on STCG gains)
  taxIfLtcg: number     // estimated tax if waited until LTCG (LTCG rate on same gain)
  savings: number       // taxNow - taxIfLtcg
  stcgRate: number      // fraction e.g. 0.32
  ltcgRate: number      // fraction e.g. 0.15
  breakEvenDropPct: number  // % the stock can drop before waiting is no longer worth it
}

function calcTaxConsequence(
  stcgGain: number,
  ltcgGain: number,
  stcgRate: number,
  ltcgRate: number,
  marketValue: number,
): TaxConsequence {
  const taxNow    = stcgGain * stcgRate + ltcgGain * ltcgRate
  const taxIfLtcg = (stcgGain + ltcgGain) * ltcgRate
  const savings   = Math.max(0, taxNow - taxIfLtcg)
  // Break-even: stock can drop by `savings` before you're worse off for waiting
  const breakEvenDropPct = marketValue > 0 ? savings / marketValue : 0
  return { taxNow, taxIfLtcg, savings, stcgRate, ltcgRate, breakEvenDropPct }
}

// ── Sell signal ────────────────────────────────────────────────────────────────
type Signal = 'FREE' | 'SOON' | 'WAIT' | 'HARVEST' | 'MIXED'

function sellSignal(sym: CostBasisSymbol): Signal {
  const hasStcgGain  = sym.stcg_gain  > 0
  const hasStcgLoss  = sym.stcg_loss  < 0
  const hasLtcgGain  = sym.ltcg_gain  > 0
  const hasLtcgLoss  = sym.ltcg_loss  < 0
  const hasAnyLoss   = hasStcgLoss || hasLtcgLoss

  if (sym.stcg_shares === 0 && sym.ltcg_shares > 0) return 'FREE'
  if (hasAnyLoss && !hasStcgGain && !hasLtcgGain) return 'HARVEST'
  if (hasStcgGain && sym.days_to_next_lt !== null && sym.days_to_next_lt > 0 && sym.days_to_next_lt <= 60) return 'SOON'
  if (hasStcgGain && sym.stcg_shares > 0) return 'WAIT'
  if (hasStcgGain && hasLtcgGain) return 'MIXED'
  return 'FREE'
}

const SIGNAL_META: Record<Signal, { label: string; color: string; bg: string; desc: string }> = {
  FREE:    { label: 'FREE TO SELL',  color: G, bg: 'var(--fd-card)',   desc: 'All lots are LTCG — preferred tax rate applies' },
  SOON:    { label: 'WAIT A BIT',    color: C, bg: 'var(--fd-card)',  desc: 'Lot flips to LTCG soon — consider waiting' },
  WAIT:    { label: 'HOLD — STCG',  color: A, bg: 'var(--fd-card)',  desc: 'Selling now triggers ordinary income rates' },
  HARVEST: { label: 'LOSS LOT', color: Y, bg: 'var(--fd-card)',  desc: 'Unrealized loss — informational only (no loss-harvesting recommended)' },
  MIXED:   { label: 'SPLIT LOTS',   color: Y, bg: 'var(--fd-card)', desc: 'Some STCG, some LTCG — choose lots carefully' },
}

// ── Per-lot tax callout (inside expanded row) ──────────────────────────────────
function LotTaxCallout({ lot, stcgRate, ltcgRate }: { lot: CostLot; stcgRate: number; ltcgRate: number }) {
  if (lot.gain_loss <= 0) {
    // Loss lot — informational only. Loss-harvesting is intentionally NOT
    // recommended (user preference: a loss is a loss).
    return (
      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
        padding: '6px 12px', background: 'var(--fd-card)',
        borderTop: '1px solid var(--fd-hairline)',
        fontSize: 12,
      }}>
        <span style={{ color: M3, fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>LOSS LOT</span>
        <span style={{ color: Y }}>
          Selling this lot realizes a <span style={{ fontWeight: 500 }}>{fmtMoneyFull(Math.abs(lot.gain_loss))}</span> loss
        </span>
        <span style={{ color: M3 }}>— informational only; loss-harvesting is not part of this plan</span>
      </div>
    )
  }

  if (lot.is_ltcg) {
    const taxDue = lot.gain_loss * ltcgRate
    return (
      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
        padding: '6px 12px', background: 'var(--fd-card)',
        borderTop: '1px solid var(--fd-hairline)',
        fontSize: 12,
      }}>
        <span style={{ color: M3, fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>TAX IF SOLD</span>
        <span style={{ color: G, fontWeight: 500 }}>LTCG ✓</span>
        <span style={{ color: M }}>
          Tax: ~<span style={{ fontWeight: 500, color: G }}>{fmtMoneyFull(taxDue)}</span>
          <span style={{ color: M3 }}> at {fmtPct(ltcgRate)} LTCG rate</span>
        </span>
        <span style={{ color: M3 }}>·</span>
        <span style={{ color: M3 }}>Already preferred rate — no benefit from waiting</span>
      </div>
    )
  }

  // STCG gain lot — show full sell-now vs wait analysis
  const taxNow    = lot.gain_loss * stcgRate
  const taxLater  = lot.gain_loss * ltcgRate
  const savings   = taxNow - taxLater
  const breakEven = lot.market_value > 0 ? savings / lot.market_value : 0

  return (
    <div style={{
      padding: '8px 12px',
      background: 'var(--fd-card)',
      borderTop: '1px solid var(--fd-hairline)',
    }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Sell now */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12, color: M3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Sell Now (STCG)</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: R, fontVariantNumeric: 'tabular-nums' }}>
            −{fmtMoneyFull(taxNow)}
          </span>
          <span style={{ fontSize: 12, color: M3 }}>at {fmtPct(stcgRate)} ordinary rate</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', color: M3, fontSize: 14, paddingTop: 10 }}>→</div>

        {/* Wait for LTCG */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12, color: M3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Wait {lot.days_to_lt != null ? daysLabel(lot.days_to_lt) : '?'} (LTCG)
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, color: G, fontVariantNumeric: 'tabular-nums' }}>
            −{fmtMoneyFull(taxLater)}
          </span>
          <span style={{ fontSize: 12, color: M3 }}>at {fmtPct(ltcgRate)} LTCG rate · {lot.lt_date}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', color: M3, fontSize: 14, paddingTop: 10 }}>=</div>

        {/* Savings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', padding: '5px 10px' }}>
          <span style={{ fontSize: 12, color: G, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Tax Savings</span>
          <span style={{ fontSize: 15, fontWeight: 500, color: G, fontVariantNumeric: 'tabular-nums' }}>
            +{fmtMoneyFull(savings)}
          </span>
          <span style={{ fontSize: 12, color: M3 }}>by waiting for LTCG</span>
        </div>

        {/* Break-even */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12, color: M3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Break-Even Drop</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: breakEven < 0.05 ? C : breakEven < 0.15 ? Y : A, fontVariantNumeric: 'tabular-nums' }}>
            {(breakEven * 100).toFixed(1)}%
          </span>
          <span style={{ fontSize: 12, color: M3, maxWidth: 160, lineHeight: 1.4 }}>
            Stock can fall {(breakEven * 100).toFixed(1)}% before waiting is no longer worth it
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Per-lot row ────────────────────────────────────────────────────────────────
function LotRow({ lot, index, stcgRate, ltcgRate, symbol, manualSelected, onManualToggle }: {
  lot: CostLot; index: number; stcgRate: number; ltcgRate: number
  symbol?: string; manualSelected?: Set<string>; onManualToggle?: (id: string) => void
}) {
  const [showTax, setShowTax] = useState(false)
  const lotId = symbol ? `${symbol}::${lot.acquired_date}` : null
  const isChecked = lotId != null && (manualSelected?.has(lotId) ?? false)
  const isManualMode = onManualToggle != null
  const gainCol  = lot.gain_loss >= 0 ? (lot.is_ltcg ? G : Y) : R
  const statusColor = lot.is_ltcg ? G : daysColor(lot.days_to_lt)
  const taxNow   = lot.gain_loss > 0 && !lot.is_ltcg ? lot.gain_loss * stcgRate : null
  const taxLater = lot.gain_loss > 0 && !lot.is_ltcg ? lot.gain_loss * ltcgRate : null
  const savings  = taxNow != null && taxLater != null ? taxNow - taxLater : null

  return (
    <>
      <tr
        style={{ borderBottom: '1px solid var(--border)', background: isChecked ? 'var(--fd-card)' : index % 2 === 0 ? 'transparent' : 'var(--fd-card)', cursor: 'pointer' }}
        onClick={() => setShowTax(s => !s)}
      >
        {isManualMode && (
          <td style={{ padding: '5px 8px 5px 12px', textAlign: 'center', width: 28 }}
            onClick={e => { e.stopPropagation(); if (lotId) onManualToggle!(lotId) }}>
            <input type="checkbox" checked={isChecked} readOnly
              style={{ cursor: 'pointer', accentColor: 'var(--green)', width: 13, height: 13 }} />
          </td>
        )}
        <td style={{ padding: '5px 10px 5px 32px', fontSize: 12, color: M3, fontVariantNumeric: 'tabular-nums' }}>
          {lot.acquired_date}
        </td>
        <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: M }}>
          {lot.quantity.toLocaleString()} sh
        </td>
        <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: M }}>
          {fmtMoneyFull(lot.cost_basis)}
        </td>
        <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: M }}>
          {fmtMoneyFull(lot.market_value)}
        </td>
        <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: gainCol }}>
          {lot.gain_loss >= 0 ? '+' : ''}{fmtMoneyFull(lot.gain_loss)}
          <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4, color: M3 }}>
            ({lot.gain_loss_pct >= 0 ? '+' : ''}{lot.gain_loss_pct.toFixed(1)}%)
          </span>
        </td>
        {/* Tax impact preview */}
        <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {taxNow != null ? (
            <span style={{ color: R }}>−{fmtMoneyFull(taxNow)}</span>
          ) : lot.is_ltcg && lot.gain_loss > 0 ? (
            <span style={{ color: G }}>−{fmtMoneyFull(lot.gain_loss * ltcgRate)}</span>
          ) : lot.gain_loss < 0 ? (
            <span style={{ color: Y }}>loss lot</span>
          ) : (
            <span style={{ color: M3 }}>—</span>
          )}
          {savings != null && savings > 0 && (
            <span style={{ display: 'block', fontSize: 12, color: G }}>save {fmtMoneyFull(savings)}</span>
          )}
        </td>
        <td style={{ padding: '5px 10px', textAlign: 'center' }}>
          <span style={{
            fontSize: 12, fontWeight: 500, padding: '2px 6px',
            background: statusColor + '22', border: `1px solid ${statusColor}`, color: statusColor,
            whiteSpace: 'nowrap',
          }}>
            {lot.is_ltcg ? 'LTCG ✓' : 'STCG'}
          </span>
        </td>
        <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', color: daysColor(lot.days_to_lt), fontWeight: 500, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {lot.is_ltcg ? '—' : (
            <>
              {daysLabel(lot.days_to_lt)}
              <span style={{ display: 'block', fontSize: 12, color: M3, fontWeight: 400 }}>{lot.lt_date}</span>
            </>
          )}
        </td>
        <td style={{ padding: '5px 8px', textAlign: 'center', width: 28 }}>
          <span style={{ fontSize: 12, color: M3, display: 'inline-block', transform: showTax ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}>▼</span>
        </td>
      </tr>

      {/* Expandable tax detail */}
      {showTax && (
        <tr style={{ borderBottom: '1px solid var(--border2)' }}>
          <td colSpan={isManualMode ? 10 : 9} style={{ padding: 0 }}>
            <LotTaxCallout lot={lot} stcgRate={stcgRate} ltcgRate={ltcgRate} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Per-symbol summary row ─────────────────────────────────────────────────────
function SymbolRow({
  symbol, symData, expanded, onToggle, stcgRate, ltcgRate, manualSelected, onManualToggle,
}: {
  symbol: string
  symData: CostBasisSymbol
  expanded: boolean
  onToggle: () => void
  stcgRate: number
  ltcgRate: number
  manualSelected?: Set<string>
  onManualToggle?: (id: string) => void
}) {
  const sig      = sellSignal(symData)
  const meta     = SIGNAL_META[sig]
  const netGain  = symData.total_unrealized
  const ltcgShares  = symData.ltcg_shares
  const stcgShares  = symData.stcg_shares
  const totalShares = ltcgShares + stcgShares
  const ltcgPct  = totalShares > 0 ? (ltcgShares / totalShares) * 100 : 0
  const hasLots  = symData.lots.length > 0

  // Tax consequence at symbol level
  const stcgGain = symData.stcg_gain ?? 0
  const ltcgGain = symData.ltcg_gain ?? 0

  // Market value estimate from lots
  const mktValue = symData.lots.reduce((s, l) => s + l.market_value, 0)
  const tc = stcgGain > 0
    ? calcTaxConsequence(stcgGain, ltcgGain, stcgRate, ltcgRate, mktValue)
    : null

  return (
    <>
      <tr
        onClick={hasLots ? onToggle : undefined}
        style={{
          borderBottom: expanded ? 'none' : '1px solid var(--border2)',
          background: expanded ? 'var(--fd-card)' : 'var(--panel)',
          cursor: hasLots ? 'pointer' : 'default',
          transition: 'background 0.1s ease',
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = 'var(--panel2)' }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'var(--panel)' }}
      >
        {/* Symbol */}
        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {hasLots && (
              <span style={{
                fontSize: 12, color: A,
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.2s ease', display: 'inline-block', flexShrink: 0,
              }}>▼</span>
            )}
            <span style={{ fontSize: 12, fontWeight: 500, color: A }}>{symbol}</span>
            <span style={{ fontSize: 12, color: M3 }}>{symData.account}</span>
          </div>
        </td>

        {/* Unrealized net */}
        <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: netGain >= 0 ? G : R }}>
            {netGain >= 0 ? '+' : ''}{fmtMoneyFull(netGain)}
          </span>
        </td>

        {/* LTCG / STCG split bar */}
        <td style={{ padding: '9px 12px', minWidth: 120 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
              {ltcgShares > 0 && <span style={{ color: G, fontWeight: 500 }}>{ltcgShares.toLocaleString()} sh LTCG</span>}
              {stcgShares > 0 && <span style={{ color: Y, fontWeight: 500 }}>{stcgShares.toLocaleString()} sh STCG</span>}
            </div>
            <div style={{ height: 4, background: 'var(--border2)', display: 'flex', overflow: 'hidden' }}>
              <div style={{ width: `${ltcgPct}%`, background: G, transition: 'width 0.6s ease' }} />
              <div style={{ width: `${100 - ltcgPct}%`, background: stcgShares > 0 ? Y : 'transparent' }} />
            </div>
          </div>
        </td>

        {/* Tax consequence */}
        <td style={{ padding: '9px 12px', fontSize: 12, minWidth: 180 }}>
          {tc != null && tc.savings > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: M3 }}>Now:</span>
                <span style={{ color: R, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>−{fmtMoneyFull(tc.taxNow)}</span>
                <span style={{ color: M3 }}>({fmtPct(stcgRate)} ordinary)</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: M3 }}>If LTCG:</span>
                <span style={{ color: G, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>−{fmtMoneyFull(tc.taxIfLtcg)}</span>
                <span style={{ color: M3 }}>({fmtPct(ltcgRate)} LTCG)</span>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 1 }}>
                <span style={{ color: G, fontWeight: 500 }}>Save {fmtMoneyFull(tc.savings)}</span>
                <span style={{ color: M3 }}>· stock can drop {(tc.breakEvenDropPct * 100).toFixed(1)}%</span>
              </div>
            </div>
          ) : tc != null && ltcgGain > 0 && stcgGain === 0 ? (
            <span style={{ color: G, fontSize: 12 }}>
              −{fmtMoneyFull(ltcgGain * ltcgRate)} at {fmtPct(ltcgRate)} LTCG
            </span>
          ) : (symData.stcg_loss < 0 || symData.ltcg_loss < 0) ? (
            <span style={{ color: Y, fontSize: 12 }}>
              Offsets {fmtMoneyFull(Math.abs((symData.stcg_loss ?? 0) + (symData.ltcg_loss ?? 0)))} in gains
            </span>
          ) : (
            <span style={{ color: M3 }}>—</span>
          )}
        </td>

        {/* Next flip */}
        <td style={{ padding: '9px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
          {symData.days_to_next_lt != null && symData.days_to_next_lt > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: daysColor(symData.days_to_next_lt) }}>
                {daysLabel(symData.days_to_next_lt)}
              </span>
              <span style={{ fontSize: 12, color: M3 }}>{symData.next_lt_flip_date}</span>
            </div>
          ) : (
            <span style={{ fontSize: 12, fontWeight: 500, color: G }}>All LTCG</span>
          )}
        </td>

        {/* Signal */}
        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <span style={{
              fontSize: 12, fontWeight: 500, padding: '3px 8px',
              background: meta.bg, border: `1px solid ${meta.color}`, color: meta.color, whiteSpace: 'nowrap',
            }}>
              {meta.label}
            </span>
            <span style={{ fontSize: 12, color: M3, textAlign: 'right', maxWidth: 180 }}>{meta.desc}</span>
          </div>
        </td>
      </tr>

      {/* Expandable lot detail */}
      {expanded && hasLots && (
        <>
          <tr style={{ background: 'var(--fd-card)', borderBottom: '1px solid var(--border2)' }}>
            <td colSpan={6} style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--fd-card)' }}>
                    {[
                      ...(onManualToggle ? [{ label: '✓', align: 'center', pad: '4px 8px 4px 12px' }] : []),
                      { label: 'Acquired',        align: 'left',   pad: '4px 10px 4px 32px' },
                      { label: 'Shares',           align: 'right',  pad: '4px 10px' },
                      { label: 'Cost Basis',       align: 'right',  pad: '4px 10px' },
                      { label: 'Market Value',     align: 'right',  pad: '4px 10px' },
                      { label: 'Unrealized G/L',   align: 'right',  pad: '4px 10px' },
                      { label: 'Tax If Sold Now',  align: 'right',  pad: '4px 10px' },
                      { label: 'Tax Type',         align: 'center', pad: '4px 10px' },
                      { label: 'Flips to LTCG',   align: 'right',  pad: '4px 10px' },
                      { label: '',                 align: 'center', pad: '4px 8px'  },
                    ].map((h, i) => (
                      <th key={i} style={{
                        padding: h.pad, fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
                        letterSpacing: '0.7px', color: i === 0 ? A : M3,
                        textAlign: h.align as React.CSSProperties['textAlign'], whiteSpace: 'nowrap',
                      }}>
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {symData.lots
                    .slice()
                    .sort((a, b) => {
                      if (!a.is_ltcg && b.is_ltcg) return -1
                      if (a.is_ltcg && !b.is_ltcg) return 1
                      return (a.days_to_lt ?? 0) - (b.days_to_lt ?? 0)
                    })
                    .map((lot, i) => (
                      <LotRow key={i} lot={lot} index={i} stcgRate={stcgRate} ltcgRate={ltcgRate}
                        symbol={symbol} manualSelected={manualSelected} onManualToggle={onManualToggle} />
                    ))
                  }
                </tbody>
              </table>
            </td>
          </tr>
          <tr style={{ background: 'var(--border2)', height: 1 }}>
            <td colSpan={6} style={{ padding: 0 }} />
          </tr>
        </>
      )}
    </>
  )
}

// ── Maturity calendar strip ────────────────────────────────────────────────────
function MaturityCalendar({ events, stcgRate, ltcgRate }: {
  events: DashboardData['tax_data']['ltcg_maturity_calendar']
  stcgRate: number
  ltcgRate: number
}) {
  if (!events || events.length === 0) return null
  const upcoming = events.filter(e => e.days_away <= 120).sort((a, b) => a.days_away - b.days_away).slice(0, 8)
  if (upcoming.length === 0) return null

  const totalSavings = upcoming.reduce((s, e) => s + (e.gain > 0 ? e.gain * (stcgRate - ltcgRate) : 0), 0)

  return (
    <div style={{
      padding: '8px 12px', background: 'var(--fd-card)',
      border: '1px solid var(--fd-hairline)', borderLeft: '3px solid var(--cyan)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: C, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
          UPCOMING LTCG MATURITIES — next 120 days
        </span>
        {totalSavings > 0 && (
          <span style={{ fontSize: 12, color: G }}>
            These {upcoming.length} lots save ~<span style={{ fontWeight: 500 }}>{fmtMoneyFull(totalSavings)}</span> by waiting
            ({fmtPct(stcgRate)} → {fmtPct(ltcgRate)}) — partial; full STCG below.
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {upcoming.map((e, i) => {
          const taxSavings = e.gain > 0 ? e.gain * (stcgRate - ltcgRate) : 0
          return (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '6px 10px', background: 'var(--surface)',
              border: `1px solid ${daysColor(e.days_away)}`,
              borderTop: `2px solid ${daysColor(e.days_away)}`, minWidth: 110, gap: 2,
            }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: A }}>{e.symbol}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: daysColor(e.days_away) }}>
                {daysLabel(e.days_away)}
              </span>
              <span style={{ fontSize: 12, color: M3 }}>{e.date}</span>
              <span style={{ fontSize: 12, color: M, fontVariantNumeric: 'tabular-nums' }}>
                {e.shares.toLocaleString()} sh
              </span>
              {e.gain > 0 && (
                <>
                  <span style={{ fontSize: 12, color: G, fontVariantNumeric: 'tabular-nums' }}>+{fmtMoneyFull(e.gain)}</span>
                  {taxSavings > 0 && (
                    <span style={{ fontSize: 12, color: G, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>
                      save {fmtMoneyFull(taxSavings)}
                    </span>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Gain Planner types & helpers ───────────────────────────────────────────────
interface FlatLot {
  symbol: string; acquired_date: string; lt_date: string | null
  quantity: number; gain_loss: number; is_ltcg: boolean
  days_to_lt: number | null; market_value: number; cost_basis: number
  days_held: number; gain_per_share: number; price: number; id: string
}

interface SellResult {
  symbol: string; acquired_date: string; days_held: number; is_ltcg: boolean
  shares_to_sell: number; price: number; cost_per_share: number
  gain_realized: number; proceeds: number; id: string
  days_to_lt: number | null; lt_date: string | null
}

function buildFlatLots(lots: Record<string, CostBasisSymbol>): FlatLot[] {
  const today = Date.now()
  const flat: FlatLot[] = []
  for (const [symbol, symData] of Object.entries(lots)) {
    for (const lot of symData.lots) {
      if (lot.quantity <= 0) continue
      const acqMs = new Date(lot.acquired_date).getTime()
      const days_held = isNaN(acqMs) ? 0 : Math.floor((today - acqMs) / 86400000)
      const price = lot.market_value / lot.quantity
      flat.push({
        symbol, acquired_date: lot.acquired_date, lt_date: lot.lt_date,
        quantity: lot.quantity, gain_loss: lot.gain_loss, is_ltcg: lot.is_ltcg,
        days_to_lt: lot.days_to_lt, market_value: lot.market_value, cost_basis: lot.cost_basis,
        days_held, gain_per_share: lot.gain_loss / lot.quantity,
        price, id: `${symbol}::${lot.acquired_date}`,
      })
    }
  }
  return flat
}

/**
 * Auto-pick lots to hit a gain target, ordered by the controlled-sale ladder in
 * utils/sellPriority.ts (LTCG → growth before income → lowest-yielding income
 * last → smallest gain first).
 *
 * Previously this sorted by days_held descending, which is not role-neutral: in a
 * portfolio whose income sleeve predates its growth sleeve, oldest-first sells the
 * income holdings first and destroys the dividend stream the controlled sale exists
 * to protect. `excludeIncome` reflects the withdrawal state's
 * allow_trimming_income_etfs rule — where trimming isn't permitted, income lots are
 * dropped outright rather than merely deprioritized.
 */
function autoPickLots(
  flat: FlatLot[],
  targetGain: number,
  gainType: 'ltcg' | 'all',
  roles: Record<string, SymbolRole>,
  excludeIncome: boolean,
): SellResult[] {
  const eligible = flat.filter(l =>
    l.gain_loss > 0 &&
    (gainType === 'all' || l.is_ltcg) &&
    !(excludeIncome && roles[l.symbol]?.role === 'INCOME')
  )
  eligible.sort((a, b) => compareSellPriority(roles, a, b))
  const results: SellResult[] = []
  let remaining = targetGain
  // Epsilon guard: breaking on `> 0` let float residue admit a final ~0-share lot,
  // rendering a $0.00 row. A cent of gain is below any actionable threshold.
  for (const lot of eligible) {
    if (remaining <= 0.01) break
    if (lot.gain_per_share <= 0) continue
    const sharesToSell = Math.min(lot.quantity, remaining / lot.gain_per_share)
    const gainRealized = sharesToSell * lot.gain_per_share
    results.push({
      symbol: lot.symbol, acquired_date: lot.acquired_date, days_held: lot.days_held,
      is_ltcg: lot.is_ltcg, shares_to_sell: sharesToSell, price: lot.price,
      cost_per_share: lot.cost_basis / lot.quantity, gain_realized: gainRealized,
      proceeds: sharesToSell * lot.price, id: lot.id,
      days_to_lt: lot.days_to_lt, lt_date: lot.lt_date,
    })
    remaining -= gainRealized
  }
  return results
}

/**
 * Lot picker for symbol-level manual planning: the user chooses which symbols are
 * in play, the controlled-sale ladder decides the order within that universe.
 *
 * Replaces a per-symbol picker that was called with the target split *evenly*
 * across the chosen symbols. That split had two defects: it ignored how much gain
 * each symbol could actually supply (a symbol short of its even share left the
 * target unmet), and it applied no LTCG filter at all — so a manual plan could
 * silently realize STCG at ordinary rates. Both are fixed by running one ranked
 * pass over the selected symbols with the same gainType filter auto mode uses.
 */
function pickForSymbols(
  flat: FlatLot[],
  symbols: string[],
  targetGain: number,
  gainType: 'ltcg' | 'all',
  roles: Record<string, SymbolRole>,
  excludeIncome: boolean,
): SellResult[] {
  const chosen = new Set(symbols)
  const eligible = flat
    .filter(l =>
      chosen.has(l.symbol) &&
      l.gain_loss > 0 && l.gain_per_share > 0 &&
      (gainType === 'all' || l.is_ltcg) &&
      !(excludeIncome && roles[l.symbol]?.role === 'INCOME')
    )
    .sort((a, b) => compareSellPriority(roles, a, b))
  const results: SellResult[] = []
  let remaining = targetGain
  for (const lot of eligible) {
    if (remaining <= 0.01) break   // see epsilon note in autoPickLots
    const sharesToSell = Math.min(lot.quantity, remaining / lot.gain_per_share)
    const gainRealized = sharesToSell * lot.gain_per_share
    results.push({
      symbol: lot.symbol, acquired_date: lot.acquired_date, days_held: lot.days_held,
      is_ltcg: lot.is_ltcg, shares_to_sell: sharesToSell, price: lot.price,
      cost_per_share: lot.cost_basis / lot.quantity, gain_realized: gainRealized,
      proceeds: sharesToSell * lot.price, id: lot.id,
      days_to_lt: lot.days_to_lt, lt_date: lot.lt_date,
    })
    remaining -= gainRealized
  }
  return results
}

// ── Gain Planner results table ─────────────────────────────────────────────────
function PlanResultsTable({ results, ltcgRate, stcgRate, roles }: {
  results: SellResult[]; ltcgRate: number; stcgRate: number
  roles: Record<string, SymbolRole>
}) {
  if (results.length === 0) return null

  const ltcgResults = results.filter(r => r.is_ltcg)
  const stcgResults = results.filter(r => !r.is_ltcg)
  const totalGain     = results.reduce((s, r) => s + r.gain_realized, 0)
  const totalProceeds = results.reduce((s, r) => s + r.proceeds, 0)
  const ltcgTax  = ltcgResults.reduce((s, r) => s + r.gain_realized * ltcgRate, 0)
  const stcgTax  = stcgResults.reduce((s, r) => s + r.gain_realized * stcgRate, 0)
  const totalTax = ltcgTax + stcgTax
  // How much could be saved if the STCG lots were waited on
  const waitSavings = stcgResults.reduce((s, r) => s + r.gain_realized * (stcgRate - ltcgRate), 0)
  // Annual dividend income this plan gives up — the cost the growth-first ordering
  // exists to minimize. Surfaced so a plan that eats the income sleeve is visible
  // before it's executed, not after.
  const incomeLost = results.reduce((s, r) => {
    const role = roles[r.symbol]
    return role?.role === 'INCOME' ? s + r.proceeds * (role.yieldPct / 100) : s
  }, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--fd-hairline)', overflow: 'hidden' }}>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 20, padding: '8px 12px', background: 'var(--fd-card)', borderBottom: '1px solid var(--fd-hairline)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12, color: M3, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Gain Realized</span>
          <span style={{ fontSize: 15, fontWeight: 500, color: G, fontVariantNumeric: 'tabular-nums' }}>+{fmtMoneyFull(totalGain)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12, color: M3, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Est. Tax</span>
          <span style={{ fontSize: 15, fontWeight: 500, color: R, fontVariantNumeric: 'tabular-nums' }}>−{fmtMoneyFull(totalTax)}</span>
          {ltcgResults.length > 0 && stcgResults.length > 0 && (
            <span style={{ fontSize: 12, color: M3 }}>
              <span style={{ color: G }}>{fmtMoneyFull(ltcgTax)}</span> LTCG · <span style={{ color: Y }}>{fmtMoneyFull(stcgTax)}</span> STCG
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12, color: M3, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Proceeds</span>
          <span style={{ fontSize: 15, fontWeight: 500, color: M, fontVariantNumeric: 'tabular-nums' }}>{fmtMoneyFull(totalProceeds)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12, color: M3, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Lots</span>
          <span style={{ fontSize: 15, fontWeight: 500, color: A, fontVariantNumeric: 'tabular-nums' }}>{results.length}</span>
          {stcgResults.length > 0 && (
            <span style={{ fontSize: 12, color: Y }}>{stcgResults.length} STCG</span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12, color: M3, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Income Given Up</span>
          <span style={{ fontSize: 15, fontWeight: 500, color: incomeLost > 0 ? R : G, fontVariantNumeric: 'tabular-nums' }}>
            {incomeLost > 0 ? `−${fmtMoneyFull(incomeLost)}` : '$0'}
          </span>
          <span style={{ fontSize: 12, color: M3 }}>{incomeLost > 0 ? 'annual dividends lost' : 'income sleeve untouched'}</span>
        </div>
        {waitSavings > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderLeft: '2px solid var(--fd-hairline)', paddingLeft: 12 }}>
            <span style={{ fontSize: 12, color: Y, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 500 }}> Wait Savings</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: Y, fontVariantNumeric: 'tabular-nums' }}>+{fmtMoneyFull(waitSavings)}</span>
            <span style={{ fontSize: 12, color: M3 }}>if STCG lots waited for LTCG</span>
          </div>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--panel2)', borderBottom: '1px solid var(--border2)' }}>
            {['Symbol', 'Acquired', 'Role', 'Days Held', 'Type', 'Shares to Sell', 'Price', 'Proceeds', 'Gain Realized', 'Est. Tax'].map((h, i) => (
              <th key={i} style={{
                padding: '5px 10px', fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
                letterSpacing: '0.6px', color: i === 0 ? A : M3,
                textAlign: i <= 1 ? 'left' : 'right',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const tax = r.gain_realized * (r.is_ltcg ? ltcgRate : stcgRate)
            const isPartial = r.shares_to_sell % 1 !== 0
            // STCG tax consequence math
            const taxIfLtcg  = !r.is_ltcg ? r.gain_realized * ltcgRate : null
            const stcgSaving = taxIfLtcg != null ? tax - taxIfLtcg : null
            const breakEven  = stcgSaving != null && r.proceeds > 0 ? stcgSaving / r.proceeds : null
            return (
              <React.Fragment key={i}>
                <tr style={{ borderBottom: r.is_ltcg ? '1px solid var(--border)' : 'none', background: i % 2 === 0 ? 'transparent' : 'var(--fd-card)' }}>
                  <td style={{ padding: '5px 10px', fontSize: 12, fontWeight: 500, color: A }}>{r.symbol}</td>
                  <td style={{ padding: '5px 10px', fontSize: 12, color: M3, fontVariantNumeric: 'tabular-nums' }}>{r.acquired_date}</td>
                  {/* Role + yield: shows why this lot ranked where it did */}
                  <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {(() => {
                      const role = roles[r.symbol]
                      if (!role) return <span style={{ color: M3 }}>—</span>
                      const isIncome = role.role === 'INCOME'
                      return (
                        <span style={{ color: isIncome ? Y : M3 }}>
                          {isIncome ? 'INCOME' : role.role === 'GROWTH' ? 'GROWTH' : role.role}
                          {role.yieldPct > 0 && (
                            <span style={{ color: M3 }}> {role.yieldPct.toFixed(2)}%</span>
                          )}
                        </span>
                      )
                    })()}
                  </td>
                  <td style={{ padding: '5px 10px', fontSize: 12, color: M, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.days_held}d</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, padding: '2px 5px', background: (r.is_ltcg ? G : Y) + '22', color: r.is_ltcg ? G : Y }}>
                      {r.is_ltcg ? 'LTCG ✓' : 'STCG'}
                    </span>
                  </td>
                  <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: M }}>
                    {isPartial ? r.shares_to_sell.toFixed(3) : r.shares_to_sell.toFixed(0)} sh
                    {isPartial && <span style={{ fontSize: 12, color: M3, marginLeft: 4 }}>partial</span>}
                  </td>
                  <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: M }}>{fmtMoneyFull(r.price)}</td>
                  <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: M }}>{fmtMoneyFull(r.proceeds)}</td>
                  <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: G }}>+{fmtMoneyFull(r.gain_realized)}</td>
                  <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.is_ltcg ? G : R }}>−{fmtMoneyFull(tax)}</td>
                </tr>

                {/* STCG callout — sell now vs wait analysis */}
                {!r.is_ltcg && stcgSaving != null && taxIfLtcg != null && (
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {/* 10 columns since the Role column was added */}
                    <td colSpan={10} style={{ padding: 0 }}>
                      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start', padding: '7px 12px 7px 32px', background: 'var(--fd-card)', borderTop: '1px solid var(--fd-hairline)' }}>
                        <span style={{ fontSize: 12, color: M3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px', alignSelf: 'center' }}>STCG Tax Analysis</span>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 12, color: M3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sell Now (STCG)</span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: R, fontVariantNumeric: 'tabular-nums' }}>−{fmtMoneyFull(tax)}</span>
                          <span style={{ fontSize: 12, color: M3 }}>at {fmtPct(stcgRate)} ordinary rate</span>
                        </div>

                        <span style={{ color: M3, fontSize: 14, alignSelf: 'center' }}>→</span>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 12, color: M3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Wait {r.days_to_lt != null ? daysLabel(r.days_to_lt) : '?'} (LTCG)
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: G, fontVariantNumeric: 'tabular-nums' }}>−{fmtMoneyFull(taxIfLtcg)}</span>
                          <span style={{ fontSize: 12, color: M3 }}>at {fmtPct(ltcgRate)} LTCG rate{r.lt_date ? ` · ${r.lt_date}` : ''}</span>
                        </div>

                        <span style={{ color: M3, fontSize: 14, alignSelf: 'center' }}>=</span>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', padding: '5px 10px' }}>
                          <span style={{ fontSize: 12, color: G, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tax Savings</span>
                          <span style={{ fontSize: 14, fontWeight: 500, color: G, fontVariantNumeric: 'tabular-nums' }}>+{fmtMoneyFull(stcgSaving)}</span>
                          <span style={{ fontSize: 12, color: M3 }}>by waiting for LTCG</span>
                        </div>

                        {breakEven != null && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: 12, color: M3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Break-Even Drop</span>
                            <span style={{ fontSize: 13, fontWeight: 500, color: breakEven < 0.05 ? C : breakEven < 0.15 ? Y : A, fontVariantNumeric: 'tabular-nums' }}>
                              {(breakEven * 100).toFixed(1)}%
                            </span>
                            <span style={{ fontSize: 12, color: M3, maxWidth: 140, lineHeight: 1.4 }}>
                              stock can drop {(breakEven * 100).toFixed(1)}% before waiting loses value
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Gain Planner Panel ─────────────────────────────────────────────────────────
function GainPlannerPanel({
  lots, stcgRate, ltcgRate,
  manualSelected,
  pickMode, setPickMode,
  missingSymbols, shareMismatches,
  roles, excludeIncome, stateLabel,
}: {
  lots: Record<string, CostBasisSymbol>
  stcgRate: number; ltcgRate: number
  manualSelected: Set<string>
  pickMode: 'auto' | 'manual'; setPickMode: (m: 'auto' | 'manual') => void
  missingSymbols: string[]
  shareMismatches: { symbol: string; posShares: number; lotShares: number; diff: number }[]
  /** symbol → {role, yieldPct}, drives the growth-before-income ordering */
  roles: Record<string, SymbolRole>
  /** true when the active withdrawal state forbids trimming income holdings */
  excludeIncome: boolean
  stateLabel: string | null
}) {
  const [targetInput, setTargetInput] = useState('')
  const [gainType, setGainType] = useState<'ltcg' | 'all'>('ltcg')
  const [results, setResults] = useState<SellResult[] | null>(null)
  const [manualSymbols, setManualSymbols] = useState<string[]>([])
  const [symInput, setSymInput] = useState('')

  const flatLots = buildFlatLots(lots)
  const availableSymbols = Object.keys(lots).sort()

  const handleCalc = () => {
    const target = parseFloat(targetInput.replace(/[,$]/g, ''))
    if (isNaN(target) || target <= 0) return
    setResults(autoPickLots(flatLots, target, gainType, roles, excludeIncome))
  }

  const addManualSym = () => {
    const sym = symInput.trim().toUpperCase()
    if (sym && lots[sym] && !manualSymbols.includes(sym)) {
      setManualSymbols(prev => [...prev, sym])
    }
    setSymInput('')
  }

  // Symbol-level pick: the chosen symbols define the universe; the controlled-sale
  // ladder orders it and fills the whole target (no even per-symbol split).
  const targetGain = parseFloat(targetInput.replace(/[,$]/g, ''))
  const symbolPickResults: SellResult[] = manualSymbols.length > 0 && targetGain > 0
    ? pickForSymbols(flatLots, manualSymbols, targetGain, gainType, roles, excludeIncome)
    : []
  // Coverage: how much of the target the selected symbols can actually supply. Replaces
  // a "$X per symbol" hint that described the removed even-split allocation.
  const symbolPickGain = symbolPickResults.reduce((sum, r) => sum + r.gain_realized, 0)
  const symbolPickShort = Math.max(0, targetGain - symbolPickGain)

  // Individual lot checkboxes (from the table below)
  const checkedResults: SellResult[] = flatLots
    .filter(l => manualSelected.has(l.id))
    .map(l => ({
      symbol: l.symbol, acquired_date: l.acquired_date, days_held: l.days_held,
      is_ltcg: l.is_ltcg, shares_to_sell: l.quantity, price: l.price,
      cost_per_share: l.cost_basis / l.quantity, gain_realized: l.gain_loss,
      proceeds: l.market_value, id: l.id,
      days_to_lt: l.days_to_lt, lt_date: l.lt_date,
    }))

  // Combined: symbol auto-picks + checked lots (checked lots deduplicated against auto-picks)
  const autoPickedIds = new Set(symbolPickResults.map(r => r.id))
  const extraChecked = checkedResults.filter(r => !autoPickedIds.has(r.id))
  const combinedManualResults = [...symbolPickResults, ...extraChecked]

  const btnStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, padding: '4px 12px',
    cursor: 'pointer', border: `1px solid ${active ? 'var(--line-strong)' : 'var(--line-soft)'}`,
    borderRadius: 'var(--r-sm)', background: active ? 'var(--surface-2)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text3)',
    transition: 'background 0.15s ease, color 0.15s ease',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'transparent', border: '1px solid var(--fd-hairline)', borderLeft: '3px solid var(--cyan)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: C, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
          GAIN PLANNER
        </span>

        {/* Gain type toggle — applies to both auto and manual symbol picks. It used to
            render only in auto mode, which left manual picks silently unfiltered and able
            to realize STCG at ordinary rates. */}
        <div style={{ display: 'flex', gap: 2 }}>
          <button style={btnStyle(gainType === 'ltcg')} onClick={() => setGainType('ltcg')}>LTCG Only</button>
          <button style={btnStyle(gainType === 'all')} onClick={() => setGainType('all')}>All Holdings</button>
        </div>

        {/* Pick mode toggle */}
        <div style={{ display: 'flex', gap: 2 }}>
          <button style={btnStyle(pickMode === 'auto')} onClick={() => setPickMode('auto')}>Auto Pick</button>
          <button style={btnStyle(pickMode === 'manual')} onClick={() => setPickMode('manual')}>Manual Pick</button>
        </div>
      </div>

      {/* Sell-order policy — makes the ranking auditable instead of implicit */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: M3, lineHeight: 1.5 }}>
        <span style={{ color: C, flexShrink: 0, fontWeight: 500 }}>ORDER</span>
        <span>
          {sellPriorityExplanation(excludeIncome)}
          {stateLabel && <span style={{ color: M3 }}> · {stateLabel}</span>}
        </span>
      </div>

      {/* Data quality warnings */}
      {missingSymbols.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', borderRadius: 'var(--r-sm)' }}>
          <span style={{ fontSize: 12, color: Y, flexShrink: 0, marginTop: 1 }}></span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 12, color: Y, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              Missing Lot Data — {missingSymbols.length} symbol{missingSymbols.length !== 1 ? 's' : ''} excluded from planner
            </span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {missingSymbols.map(sym => (
                <span key={sym} style={{ fontSize: 12, fontWeight: 500, padding: '1px 6px', background: 'var(--fd-card)', color: Y, border: '1px solid var(--fd-hairline)' }}>{sym}</span>
              ))}
            </div>
            <span style={{ fontSize: 12, color: M3, lineHeight: 1.5 }}>
              These symbols appear in your holdings but have no lot entries in <code style={{ color: A }}>schwab_cost.json</code>. Add lot data to include them in gain planning.
            </span>
          </div>
        </div>
      )}
      {shareMismatches.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', borderRadius: 'var(--r-sm)' }}>
          <span style={{ fontSize: 12, color: R, flexShrink: 0, marginTop: 1 }}></span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: R, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              Stale Lot Data — {shareMismatches.length} symbol{shareMismatches.length !== 1 ? 's' : ''} with share count mismatch
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {shareMismatches.map(m => {
                const short = m.diff < 0  // lot file has fewer shares than held
                return (
                  <div key={m.symbol} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: A, minWidth: 48 }}>{m.symbol}</span>
                    <span style={{ fontSize: 12, color: M3 }}>Held: <span style={{ color: M, fontWeight: 500 }}>{m.posShares.toFixed(3).replace(/\.?0+$/, '')} sh</span></span>
                    <span style={{ fontSize: 12, color: M3 }}>Lots: <span style={{ color: M, fontWeight: 500 }}>{m.lotShares.toFixed(3).replace(/\.?0+$/, '')} sh</span></span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: short ? Y : M3 }}>
                      {short
                        ? `${Math.abs(m.diff).toFixed(3).replace(/\.?0+$/, '')} sh missing from lot file`
                        : `${m.diff.toFixed(3).replace(/\.?0+$/, '')} sh extra in lot file`}
                    </span>
                  </div>
                )
              })}
            </div>
            <span style={{ fontSize: 12, color: M3, lineHeight: 1.5 }}>
              Share counts in <code style={{ color: A }}>schwab_cost.json</code> don't match your current holdings.
              Gain planning results for these symbols may be inaccurate — update the file to reflect recent buys or sells.
            </span>
          </div>
        </div>
      )}

      {pickMode === 'auto' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: M3 }}>Target gain ($):</span>
            <input
              type="text"
              value={targetInput}
              onChange={e => { setTargetInput(e.target.value); setResults(null) }}
              placeholder="e.g. 50000"
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                padding: '5px 10px', width: 140,
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)', color: 'var(--text)', outline: 'none',
              }}
              onKeyDown={e => { if (e.key === 'Enter') handleCalc() }}
            />
            <button
              onClick={handleCalc}
              style={{
                fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, padding: '5px 16px',
                cursor: 'pointer', border: '1px solid var(--cyan)', borderRadius: 'var(--r-sm)',
                background: 'var(--fd-card)', color: C,
              }}
            >
              Calculate
            </button>
            <span style={{ fontSize: 12, color: M3 }}>
              {excludeIncome ? 'Growth only' : 'Growth before income'} · {gainType === 'ltcg' ? 'LTCG lots only' : 'all lots with gains'} · partial lots supported
            </span>
          </div>

          {results !== null && results.length === 0 && (
            <div style={{ fontSize: 12, color: M3, padding: '6px 0' }}>
              No eligible lots found for selected gain type.
            </div>
          )}
          {results !== null && results.length > 0 && (
            <PlanResultsTable results={results} ltcgRate={ltcgRate} stcgRate={stcgRate} roles={roles} />
          )}
        </div>
      )}

      {pickMode === 'manual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Target gain input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: M3 }}>Target gain ($):</span>
            <input
              type="text"
              value={targetInput}
              onChange={e => setTargetInput(e.target.value)}
              placeholder="e.g. 50000"
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                padding: '5px 10px', width: 140,
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)', color: 'var(--text)', outline: 'none',
              }}
            />
            {manualSymbols.length > 0 && targetGain > 0 && (
              symbolPickShort > 0.01 ? (
                <span style={{ fontSize: 12, color: Y }}>
                   selected symbols supply only <span style={{ fontWeight: 500 }}>{fmtMoneyFull(symbolPickGain)}</span>
                  {' '}— <span style={{ fontWeight: 500 }}>{fmtMoneyFull(symbolPickShort)}</span> short. Add symbols
                  {gainType === 'ltcg' ? ' or switch to All Holdings' : ''}.
                </span>
              ) : (
                <span style={{ fontSize: 12, color: M3 }}>
                  = <span style={{ color: C, fontWeight: 500 }}>{fmtMoneyFull(symbolPickGain)}</span> sourced across{' '}
                  {manualSymbols.length} symbol{manualSymbols.length !== 1 ? 's' : ''} by sell priority
                </span>
              )
            )}
          </div>

          {/* Symbol picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: M3, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
              {manualSymbols.length} Symbol{manualSymbols.length !== 1 ? 's' : ''}
            </span>

            {/* Symbol chips */}
            {manualSymbols.map(sym => (
              <span key={sym} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 6px 2px 9px',
                background: `${A}15`, border: `1px solid ${A}`,
                fontSize: 12, fontWeight: 500, color: A,
              }}>
                {sym}
                <button
                  onClick={() => setManualSymbols(prev => prev.filter(s => s !== sym))}
                  style={{ background: 'none', border: 'none', color: M3, cursor: 'pointer', fontSize: 13, padding: '0 0 0 2px', lineHeight: 1 }}
                >×</button>
              </span>
            ))}

            {/* Add symbol input with datalist autocomplete */}
            <input
              list="sym-datalist"
              value={symInput}
              onChange={e => setSymInput(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') addManualSym() }}
              placeholder="+ symbol"
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                padding: '3px 8px', width: 90,
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)', color: 'var(--text)', outline: 'none',
              }}
            />
            <datalist id="sym-datalist">
              {availableSymbols.filter(s => !manualSymbols.includes(s)).map(s => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <button
              onClick={addManualSym}
              style={{
                fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, padding: '3px 10px',
                cursor: 'pointer', border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', color: 'var(--text)',
              }}
            >+ Add</button>
            {manualSymbols.length > 0 && (
              <button
                onClick={() => setManualSymbols([])}
                style={{ fontFamily: 'var(--font-sans)', fontSize: 12, padding: '3px 8px', cursor: 'pointer', border: 'none', background: 'none', color: M3 }}
              >Clear all</button>
            )}
          </div>

          <span style={{ fontSize: 12, color: M3 }}>
            Selected symbols ranked by sell priority ({gainType === 'ltcg' ? 'LTCG only' : 'all gains'}) · or expand rows below and check individual lots to add to the plan
          </span>

          {/* Combined results: symbol auto-picks + any individually checked lots */}
          {combinedManualResults.length > 0 && (
            <>
              {extraChecked.length > 0 && (
                <span style={{ fontSize: 12, color: M3 }}>
                  + {extraChecked.length} manually checked lot{extraChecked.length !== 1 ? 's' : ''} from table
                </span>
              )}
              <PlanResultsTable results={combinedManualResults} ltcgRate={ltcgRate} stcgRate={stcgRate} roles={roles} />
            </>
          )}
          {combinedManualResults.length === 0 && (
            <span style={{ fontSize: 12, color: M3, fontStyle: 'italic' }}>
              {manualSymbols.length > 0 && targetGain > 0
                ? 'No lots with gains found for selected symbols.'
                : 'Add symbols above and enter a target gain, or check individual lots in the table below.'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
interface Props { data: DashboardData; mode: 'simple' | 'advanced' }

export function LotAdvisor({ data, mode }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pickMode, setPickMode] = useState<'auto' | 'manual'>('auto')
  const [manualSelected, setManualSelected] = useState<Set<string>>(new Set())
  const [showDetails, setShowDetails] = useState(false)

  const handleManualToggle = (id: string) => {
    setManualSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const tx   = data.tax_data
  const lots = tx?.cost_basis_lots ?? {}

  // Sell-order inputs: fund role + yield per symbol (from positions), and whether the
  // active withdrawal state permits trimming income holdings at all. Keyed off fund
  // attributes — no ticker literals — so retuning the portfolio needs no code change.
  const symbolRoles = buildSymbolRoles(data.accounts ?? [])
  const ws = getWithdrawalStateView(tx)
  // Only exclude on an explicit `false`. Unknown config (null) must not silently
  // drop the income sleeve — it deprioritizes it via the ladder instead.
  const excludeIncome = ws.allowTrimmingIncomeEtfs === false

  // Cross-reference positions vs lot file
  const lotSymbols = new Set(Object.keys(lots))

  // Coverage check: taxable account only — Roth/Rollover are tax-free, STCG/LTCG irrelevant
  const positionShares: Record<string, number> = {}
  for (const acct of data.accounts) {
    if (acct.key !== 'taxable') continue
    for (const pos of acct.positions) {
      if (!pos.is_money_market && pos.value > 100) {
        positionShares[pos.symbol] = (positionShares[pos.symbol] ?? 0) + pos.shares
      }
    }
  }

  // Sum shares per symbol from lot file
  const lotShares: Record<string, number> = {}
  for (const [sym, symData] of Object.entries(lots)) {
    lotShares[sym] = symData.lots.reduce((s, l) => s + l.quantity, 0)
  }

  const missingSymbols: string[] = Object.keys(positionShares).filter(sym => !lotSymbols.has(sym))

  interface ShareMismatch { symbol: string; posShares: number; lotShares: number; diff: number }
  const shareMismatches: ShareMismatch[] = Object.keys(positionShares)
    .filter(sym => lotSymbols.has(sym))
    .map(sym => ({ symbol: sym, posShares: positionShares[sym], lotShares: lotShares[sym] ?? 0, diff: (lotShares[sym] ?? 0) - positionShares[sym] }))
    .filter(m => Math.abs(m.diff) > 0.01)

  if (!tx || Object.keys(lots).length === 0) {
    return (
      <div style={{ padding: '16px', color: M3, fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 500, color: M, marginBottom: 4 }}>NO LOT DATA AVAILABLE</div>
        Add a <code style={{ color: A }}>schwab_cost.json</code> file to the server with per-lot acquired dates.
      </div>
    )
  }

  // Tax rates — marginal_rate stored as pct (e.g. 32), convert to fraction.
  // NIIT (3.8%) applies to all NII (dividends, STCG, LTCG) when MAGI > $250K MFJ.
  const rawMarginal  = tx.marginal_rate ?? 32
  const baseStcgRate = rawMarginal > 1 ? rawMarginal / 100 : rawMarginal
  const rawLtcg      = tx.ltcg_rate ?? 15
  const baseLtcgRate = rawLtcg > 1 ? rawLtcg / 100 : rawLtcg
  const niitApplies  = tx.niit_applies ?? false
  const niitAddon    = niitApplies ? ((tx.niit_rate ?? 0.038) as number) : 0
  const stcgRate     = baseStcgRate + niitAddon   // e.g. 24% + 3.8% = 27.8%
  const ltcgRate     = baseLtcgRate + niitAddon   // e.g. 15% + 3.8% = 18.8%

  const toggle = (sym: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(sym) ? next.delete(sym) : next.add(sym)
      return next
    })

  const signalOrder: Record<Signal, number> = { WAIT: 0, SOON: 1, MIXED: 2, HARVEST: 3, FREE: 4 }
  const sorted = Object.entries(lots).sort(([, a], [, b]) =>
    signalOrder[sellSignal(a)] - signalOrder[sellSignal(b)]
  )

  const totalLtcgGain   = tx.total_ltcg_unrealized_gain  ?? 0
  const totalStcgGain   = tx.total_stcg_unrealized_gain  ?? 0
  const totalStcgLoss   = tx.total_stcg_unrealized_loss  ?? 0
  const totalLtcgLoss   = tx.total_ltcg_unrealized_loss  ?? 0
  const harvestableLoss = (totalStcgLoss ?? 0) + (totalLtcgLoss ?? 0)
  const ltcgRoom        = tx.ltcg_15pct_room ?? null

  // Aggregate tax exposure
  const stcgTaxNow    = totalStcgGain * stcgRate
  const stcgTaxLater  = totalStcgGain * ltcgRate
  const totalSavings  = Math.max(0, stcgTaxNow - stcgTaxLater)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Taxable account scope note */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${A}` }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: A, textTransform: 'uppercase', letterSpacing: '0.6px' }}>TAXABLE ACCOUNT ONLY</span>
        <span style={{ fontSize: 12, color: M3 }}>Roth IRA and Rollover IRA are tax-advantaged — STCG/LTCG distinctions don't apply to those accounts.</span>
      </div>

      {/* Summary header — 5 tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {/* LTCG unrealized */}
        <div style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${G}`, borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>LTCG Unrealized</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: G, fontVariantNumeric: 'tabular-nums' }}>+{fmtMoneyFull(totalLtcgGain)}</div>
          <div style={{ fontSize: 12, color: M3 }}>preferred rate: {fmtPct(ltcgRate)}</div>
        </div>
        {/* STCG unrealized */}
        <div style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${Y}`, borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>STCG Unrealized</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: Y, fontVariantNumeric: 'tabular-nums' }}>+{fmtMoneyFull(totalStcgGain)}</div>
          <div style={{ fontSize: 12, color: M3 }}>ordinary rate: {fmtPct(stcgRate)}</div>
        </div>
        {/* STCG tax cost if sold now */}
        <div style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${R}`, borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>STCG Tax If Sold Now</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: R, fontVariantNumeric: 'tabular-nums' }}>−{fmtMoneyFull(stcgTaxNow)}</div>
          <div style={{ fontSize: 12, color: M3 }}>
            {niitApplies
              ? `${(baseStcgRate * 100).toFixed(0)}% ordinary + 3.8% NIIT = ${(stcgRate * 100).toFixed(1)}%`
              : `at ${fmtPct(stcgRate)} ordinary income`}
          </div>
        </div>
        {/* Savings from waiting */}
        <div style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${G}`, borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>Savings by Waiting</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: G, fontVariantNumeric: 'tabular-nums' }}>+{fmtMoneyFull(totalSavings)}</div>
          <div style={{ fontSize: 12, color: M3 }}>
            {niitApplies
              ? `${(stcgRate * 100).toFixed(1)}% STCG → ${(ltcgRate * 100).toFixed(1)}% LTCG, both incl. 3.8% NIIT`
              : `vs selling STCG today`}
          </div>
        </div>
        {/* Harvestable loss / LTCG room */}
        <div style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${C}`, borderRadius: 0 }}>
          <div style={{ fontSize: 12, color: M3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>
            {harvestableLoss < 0 ? 'Unrealized Loss Lots' : '15% LTCG Room'}
          </div>
          <div style={{ fontSize: 18, fontWeight: 500, color: harvestableLoss < 0 ? Y : ltcgRoom != null && ltcgRoom > 50000 ? G : Y, fontVariantNumeric: 'tabular-nums' }}>
            {harvestableLoss < 0 ? fmtMoneyFull(Math.abs(harvestableLoss)) : ltcgRoom != null ? fmtMoneyFull(ltcgRoom) : '—'}
          </div>
          <div style={{ fontSize: 12, color: M3 }}>
            {harvestableLoss < 0 ? 'informational — no harvest recommended' : 'before 20% LTCG rate'}
          </div>
        </div>
      </div>

      {/* Upcoming maturity calendar */}
      <MaturityCalendar events={tx.ltcg_maturity_calendar} stcgRate={stcgRate} ltcgRate={ltcgRate} />

      {/* Gain Planner — advanced mode only */}
      {mode === 'advanced' && (
        <GainPlannerPanel
          lots={lots}
          stcgRate={stcgRate}
          ltcgRate={ltcgRate}
          manualSelected={manualSelected}
          pickMode={pickMode}
          setPickMode={setPickMode}
          missingSymbols={missingSymbols}
          shareMismatches={shareMismatches}
          roles={symbolRoles}
          excludeIncome={excludeIncome}
          stateLabel={ws.label}
        />
      )}

      {/* Data coverage strip — always visible */}
      {(missingSymbols.length > 0 || shareMismatches.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {missingSymbols.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: Y, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px', flexShrink: 0 }}> No lot data:</span>
              {missingSymbols.map(sym => (
                <span key={sym} style={{ fontSize: 12, fontWeight: 500, padding: '1px 6px', background: 'var(--fd-card)', color: Y, border: '1px solid var(--fd-hairline)', whiteSpace: 'nowrap' }}>{sym}</span>
              ))}
              <span style={{ fontSize: 12, color: M3 }}>— not in schwab_cost.json · excluded from gain planning · add entries to include</span>
            </div>
          )}
          {shareMismatches.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 10px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: R, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px', flexShrink: 0, marginTop: 1 }}> Stale lot data:</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {shareMismatches.map(m => (
                  <span key={m.symbol} style={{ fontSize: 12, padding: '2px 7px', background: 'var(--fd-card)', color: R, border: '1px solid var(--fd-hairline)', whiteSpace: 'nowrap' }}>
                    {m.symbol} · held {m.posShares.toFixed(3).replace(/\.?0+$/, '')} sh · lots {m.lotShares.toFixed(3).replace(/\.?0+$/, '')} sh · <span style={{ color: m.diff < 0 ? A : M3 }}>{m.diff > 0 ? '+' : ''}{m.diff.toFixed(3).replace(/\.?0+$/, '')} sh</span>
                  </span>
                ))}
              </div>
              <span style={{ fontSize: 12, color: M3 }}>— schwab_cost.json shares don't match holdings · update the file for accurate gain planning</span>
            </div>
          )}
        </div>
      )}

      {/* Progressive disclosure toggle */}
      <button
        onClick={() => setShowDetails(v => !v)}
        style={{
          alignSelf: 'flex-start',
          padding: '6px 14px',
          background: showDetails ? 'var(--fd-card)' : 'var(--surface)',
          border: `1px solid ${showDetails ? 'var(--fd-hairline)' : 'var(--fd-hairline)'}`,
          color: showDetails ? A : M,
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, letterSpacing: '0.7px',
          cursor: 'pointer', borderRadius: 0,
          textTransform: 'uppercase',
        }}
      >
        {showDetails ? '▲ HIDE LOT DETAILS' : '▼ SHOW LOT DETAILS'} · {Object.keys(lots).length} positions
      </button>

      {/* Per-position table — progressive disclosure */}
      {showDetails && <><div style={{ border: '1px solid var(--fd-hairline)', overflow: 'hidden' }}>
        <div style={{
          padding: '6px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border2)',
          display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: M3, fontWeight: 500, letterSpacing: '0.8px' }}>
            {mode === 'advanced' && pickMode === 'manual'
              ? 'CLICK ROW TO EXPAND · CHECK LOTS TO ADD TO PLAN'
              : 'CLICK ROW TO SEE LOTS · CLICK LOT FOR TAX DETAIL'}
          </span>
          {(Object.entries(SIGNAL_META) as [Signal, typeof SIGNAL_META[Signal]][]).map(([sig, meta]) => (
            <span key={sig} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, background: meta.color, display: 'inline-block' }} />
              <span style={{ fontSize: 12, color: M3 }}>{meta.label}</span>
            </span>
          ))}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--panel2)', borderBottom: '2px solid var(--border2)' }}>
              {[
                { label: 'Symbol',               align: 'left' },
                { label: 'Unrealized G/L',        align: 'right' },
                { label: 'LTCG / STCG Shares',   align: 'left' },
                { label: 'Tax Consequences',      align: 'left' },
                { label: 'Next LTCG Flip',        align: 'center' },
                { label: 'Sell Signal',           align: 'right' },
              ].map((h, i) => (
                <th key={i} style={{
                  padding: '6px 12px', fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
                  letterSpacing: '0.7px', color: i === 0 ? A : M3,
                  textAlign: h.align as React.CSSProperties['textAlign'],
                }}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(([sym, symData]) => (
              <SymbolRow
                key={sym}
                symbol={sym}
                symData={symData}
                expanded={expanded.has(sym)}
                onToggle={() => toggle(sym)}
                stcgRate={stcgRate}
                ltcgRate={ltcgRate}
                manualSelected={mode === 'advanced' && pickMode === 'manual' ? manualSelected : undefined}
                onManualToggle={mode === 'advanced' && pickMode === 'manual' ? handleManualToggle : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: M3, lineHeight: 1.6, padding: '2px 0' }}>
        LTCG = held &gt;365 days — taxed at 0%, 15%, or 20%. &nbsp;
        STCG = held ≤365 days — taxed as ordinary income ({fmtPct(stcgRate)} marginal). &nbsp;
        Break-even: how far the stock can drop before waiting for LTCG is no longer worth it. &nbsp;
        Estimates only — consult a tax advisor before selling.
      </div>
      </> }

      {/* ── Tax pipeline + lot maturity — relevant to LTCG/STCG sell decisions ── */}
      {tx && (
        <>
          <TerminalSection id="sell-pipeline" title="◈ TAX PIPELINE (ORDINARY vs CAPITAL GAINS)" defaultOpen={false} accent="var(--blue)">
            <div style={{ padding: '8px 12px' }}>
              <DualPipelinePanel
                tx={tx}
                ytdConverted={tx.converted_ytd ?? 0}
                grossNoSS={tx.gross_no_ss ?? tx.annual_div_for_agi}
                ceiling={tx.target_bracket_ceiling ?? 0}
              />
            </div>
          </TerminalSection>

          <TerminalSection id="sell-lot-maturity" title="◈ LOT MATURITY & GAIN CLASSIFICATION" defaultOpen={false} accent="var(--cyan)">
            <div style={{ padding: '8px 12px' }}>
              <LotMaturityPanel tx={tx} />
            </div>
          </TerminalSection>
        </>
      )}
    </div>
  )
}
