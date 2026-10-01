import { useMemo, useState } from 'react'
import { fmtMoneyFull } from '../../utils/formatters'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import type { DashboardData, RealizedGainTransaction } from '../../types/dashboard'
import { A, G, M, R, Y } from './taxColors'

const B = 'var(--blue)'

function GainBadge({ type }: { type: RealizedGainTransaction['gain_type'] }) {
  const isLoss = type.startsWith('LOSS')
  const isLT   = type.includes('LTCG')
  const label  = isLoss ? (isLT ? 'LT LOSS' : 'ST LOSS') : (isLT ? 'LTCG' : 'STCG')
  const bg     = isLoss ? R : isLT ? G : Y
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', fontSize: 12, fontWeight: 500,
      fontFamily: 'var(--font-mono)', borderRadius: 0,
      background: bg, color: isLoss ? 'var(--fd-card)' : 'var(--fd-page)', letterSpacing: '0.5px',
    }}>{label}</span>
  )
}

export function RealizedSalesTaxPanel({ tx }: { tx: DashboardData['tax_data'] }) {
  const [sortCol, setSortCol] = useState<'date' | 'gain' | 'tax'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const txns = tx?.realized_gain_transactions ?? []
  const marginalRate = tx?.marginal_rate ?? ((tx?.target_bracket_rate ?? DEFAULT_BRACKET_RATE) / 100)
  const ltcgRate     = tx?.ltcg_rate ?? 0.15
  const niitRate     = tx?.niit_applies ? (tx?.niit_rate ?? 0.038) : 0

  const enriched = useMemo(() => txns.map(t => {
    const isGain = t.gain >= 0
    const isLT   = t.gain_type === 'LTCG' || t.gain_type === 'LOSS_LTCG'
    const baseRate = isGain ? (isLT ? ltcgRate : marginalRate) : 0
    const niit = (isGain && isLT) ? niitRate : 0
    const estTax = isGain ? t.gain * (baseRate + niit) : 0
    return { ...t, estTax, baseRate, niit }
  }), [txns, marginalRate, ltcgRate, niitRate])

  const sorted = useMemo(() => {
    const key = sortCol
    return [...enriched].sort((a, b) => {
      const av = key === 'date' ? a.date : key === 'gain' ? a.gain : a.estTax
      const bv = key === 'date' ? b.date : key === 'gain' ? b.gain : b.estTax
      return sortDir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1)
    })
  }, [enriched, sortCol, sortDir])

  const totals = useMemo(() => {
    let ltcg = 0, stcg = 0, ltcgLoss = 0, stcgLoss = 0, estTax = 0, proceeds = 0
    for (const t of enriched) {
      proceeds += t.proceeds
      estTax += t.estTax
      if (t.gain_type === 'LTCG')      ltcg     += t.gain
      else if (t.gain_type === 'STCG') stcg     += t.gain
      else if (t.gain_type === 'LOSS_LTCG') ltcgLoss += t.gain
      else stcgLoss += t.gain
    }
    return { ltcg, stcg, ltcgLoss, stcgLoss, netGain: ltcg + stcg + ltcgLoss + stcgLoss, estTax, proceeds }
  }, [enriched])

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  if (txns.length === 0) {
    return (
      <div style={{ padding: '16px 14px', color: M, fontSize: 12 }}>
        No realized gain transactions found for this year.{' '}
        <span style={{ color: 'var(--text3)' }}>
          (Data comes from Schwab SELL transactions — requires Schwab API connection.)
        </span>
      </div>
    )
  }

  const sortKeyDown = (col: typeof sortCol) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleSort(col)
    }
  }

  const SortHdr = ({ col, label }: { col: typeof sortCol; label: string }) => (
    <th className="r" onClick={() => toggleSort(col)}
        role="button" tabIndex={0} onKeyDown={sortKeyDown(col)}
        aria-sort={sortCol === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
        style={{ cursor: 'pointer', color: sortCol === col ? A : M, userSelect: 'none' }}>
      {label}{sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <div style={{ padding: '10px 12px' }}>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'TOTAL PROCEEDS',  value: fmtMoneyFull(totals.proceeds),      color: 'var(--text)', accent: B },
          { label: 'LTCG REALIZED',   value: fmtMoneyFull(totals.ltcg),           color: G,             accent: G },
          { label: 'STCG REALIZED',   value: fmtMoneyFull(totals.stcg),           color: Y,             accent: Y },
          { label: 'REALIZED LOSSES', value: fmtMoneyFull(totals.ltcgLoss + totals.stcgLoss), color: R, accent: R },
          { label: 'NET GAIN',        value: fmtMoneyFull(totals.netGain),        color: totals.netGain >= 0 ? G : R, accent: totals.netGain >= 0 ? G : R },
          { label: 'EST. TAX DUE',    value: fmtMoneyFull(totals.estTax),         color: R,             accent: R },
        ].map(({ label, value, color, accent }) => (
          <div key={label} style={{ padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${accent}`, borderRadius: 0, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500, marginBottom: 3, letterSpacing: '0.6px' }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Rate legend */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: M, marginBottom: 8 }}>
        <span>STCG rate: <span style={{ color: Y, fontWeight: 500 }}>{(marginalRate * 100).toFixed(0)}%</span> (ordinary)</span>
        <span>LTCG rate: <span style={{ color: G, fontWeight: 500 }}>{(ltcgRate * 100).toFixed(0)}%</span></span>
        {niitRate > 0 && (
          <span>NIIT surcharge: <span style={{ color: R, fontWeight: 500 }}>+{(niitRate * 100).toFixed(1)}%</span> on LTCG</span>
        )}
      </div>

      {/* Transaction table */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 480 }}>
        <table className="bb-table" style={{ minWidth: 780 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
            <tr>
              <th style={{ cursor: 'pointer', color: sortCol === 'date' ? A : M, userSelect: 'none' }}
                  role="button" tabIndex={0} onKeyDown={sortKeyDown('date')}
                  aria-sort={sortCol === 'date' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={() => toggleSort('date')}>
                DATE{sortCol === 'date' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th>SYMBOL</th>
              <th className="r">SHARES</th>
              <th className="r">PROCEEDS</th>
              <th className="r">COST BASIS</th>
              <SortHdr col="gain" label="GAIN / LOSS" />
              <th>TYPE</th>
              <th className="r">RATE</th>
              <SortHdr col="tax" label="EST. TAX" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const isGain = t.gain >= 0
              const gainColor = isGain ? G : R
              const effectiveRate = t.baseRate + t.niit
              return (
                <tr key={i}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: M }}>{t.date}</td>
                  <td style={{ fontWeight: 500, fontFamily: 'var(--font-mono)', color: A }}>{t.symbol}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: M }}>{t.shares.toFixed(0)}</td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                    {fmtMoneyFull(t.proceeds)}
                  </td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: M }}>
                    {fmtMoneyFull(t.cost)}
                  </td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: gainColor, fontWeight: 500 }}>
                    {t.gain >= 0 ? '+' : ''}{fmtMoneyFull(t.gain)}
                    <span style={{ fontSize: 12, color: M, marginLeft: 4 }}>
                      ({t.cost > 0 ? ((t.gain / t.cost) * 100).toFixed(1) : '—'}%)
                    </span>
                    {/* Show STCG/LTCG split when a transaction has both */}
                    {t.stcg != null && t.ltcg != null && Math.abs(t.stcg) > 0 && Math.abs(t.ltcg) > 0 && (
                      <div style={{ fontSize: 12, color: M, fontWeight: 400, marginTop: 1 }}>
                        <span style={{ color: Y }}>ST {fmtMoneyFull(t.stcg)}</span>
                        {' / '}
                        <span style={{ color: G }}>LT {fmtMoneyFull(t.ltcg)}</span>
                      </div>
                    )}
                  </td>
                  <td><GainBadge type={t.gain_type} /></td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: M }}>
                    {isGain ? `${(effectiveRate * 100).toFixed(1)}%` : '—'}
                    {t.niit > 0 && <span style={{ color: R }}> +NIIT</span>}
                  </td>
                  <td className="r" style={{ fontFamily: 'var(--font-mono)', color: isGain ? R : G, fontWeight: 500 }}>
                    {isGain ? fmtMoneyFull(t.estTax) : <span style={{ color: G }}>− offset</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--fd-card)', borderTop: '1px solid var(--border2)' }}>
              <td colSpan={3} style={{ fontWeight: 500, fontSize: 12, color: A }}>TOTAL</td>
              <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtMoneyFull(totals.proceeds)}</td>
              <td />
              <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: totals.netGain >= 0 ? G : R }}>
                {totals.netGain >= 0 ? '+' : ''}{fmtMoneyFull(totals.netGain)}
              </td>
              <td />
              <td />
              <td className="r" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: R }}>
                {fmtMoneyFull(totals.estTax)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: M, fontStyle: 'italic' }}>
        * Tax estimates use configured rates ({(marginalRate * 100).toFixed(0)}% ordinary / {(ltcgRate * 100).toFixed(0)}% LTCG).
        LTCG vs STCG split uses FIFO lot matching against acquired dates from schwab_cost.json.
        Losses offset gains but no cross-lot netting is applied here.
      </div>
    </div>
  )
}
