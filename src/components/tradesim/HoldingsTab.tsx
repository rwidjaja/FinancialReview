import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import type { Portfolio, Dividend, LimitOrder } from './types'
import { G, R, A, M, BASE } from './constants'
import { Btn, fmtPct, fmtDate } from './shared'

/**
 * Project future payment dates from a known base date + frequency.
 * Returns up to `limit` upcoming dates (after today).
 */
function projectPayments(
  baseDate: string,
  frequency: string,
  limit = 8,
): string[] {
  const base = new Date(baseDate)
  if (isNaN(base.getTime())) return []

  const freqDays = frequency === 'Weekly'      ? 7
    : frequency === 'Monthly'    ? 30.44
    : frequency === 'Quarterly'  ? 91.31
    : frequency === 'Semi-Annual'? 182.625
    : frequency === 'Annual'     ? 365.25
    : 91.31  // default quarterly

  const results: string[] = []
  const today = Date.now()
  let d = new Date(base)

  // Wind forward to today's vicinity so the first projected date is near
  while (d.getTime() < today - freqDays * 86_400_000) {
    d = new Date(d.getTime() + freqDays * 86_400_000)
  }
  // Then collect upcoming dates
  for (let i = 0; i < limit * 3 && results.length < limit; i++) {
    if (d.getTime() >= today - 1_000) {   // allow today
      results.push(d.toISOString().slice(0, 10))
    }
    d = new Date(d.getTime() + freqDays * 86_400_000)
  }
  return results
}

/** Annual-to-per-payment divisor for a frequency string. */
function freqDivisor(freq: string | null): number {
  if (freq === 'Weekly')      return 52
  if (freq === 'Monthly')     return 12
  if (freq === 'Semi-Annual') return 2
  if (freq === 'Annual')      return 1
  return 4   // Quarterly default
}

/**
 * Return the next upcoming pay date.
 * If the stored date is still in the future, return it as-is.
 * If it's past, fast-forward using the frequency to find the next occurrence.
 */
function effectiveNextDate(stored: string | null, freq: string | null): string | null {
  if (!stored || !freq) return stored
  const d = daysUntilRaw(stored)
  if (d !== null && d >= 0) return stored   // already upcoming
  const upcoming = projectPayments(stored, freq, 1)
  return upcoming[0] ?? stored
}

/** Raw days until (needed before daysUntil is defined, so factored out). */
function daysUntilRaw(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.round((d.getTime() - Date.now()) / 86_400_000)
}

/** Days until a date string (positive = future, negative = past). */
function daysUntil(dateStr: string | null): number | null { return daysUntilRaw(dateStr) }

/** Date picker that only commits on blur or Enter — avoids premature save mid-typing. */
function InlineDateEdit({ value, onSave }:
  { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  return (
    <input
      type="date"
      autoFocus
      value={v}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter')  onSave(v)
        if (e.key === 'Escape') onSave(value)   // revert to original
      }}
      onBlur={() => onSave(v)}
      style={{
        background: 'var(--fd-page)', color: 'var(--text)',
        border: '1px solid var(--fd-accent)',
        fontSize: 12, padding: '3px 6px', width: 130,
        colorScheme: 'dark',
      }}
    />
  )
}

function InlineNumEdit({ value, onSave, suffix = '' }:
  { value: string; onSave: (v: string) => void; suffix?: string }) {
  const [v, setV] = useState(value)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <input
        autoFocus
        type="number" step="0.01"
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onSave(v)
          if (e.key === 'Escape') onSave(value)   // revert
        }}
        onBlur={() => onSave(v)}
        style={{
          width: 64, padding: '2px 4px', fontSize: 12,
          background: 'var(--fd-card)',
          border: '1px solid var(--fd-hairline)',
          color: 'var(--text)', textAlign: 'right',
        }}
      />
      {suffix && <span style={{ fontSize: 12, color: M }}>{suffix}</span>}
    </div>
  )
}

export function TradePicklist({ symbol, name, sharesHeld, onResearch, onBuy, onSell, onSellAll }:
  { symbol: string; name?: string; sharesHeld: number
    onResearch: () => void
    onBuy: () => void; onSell: () => void; onSellAll: () => void }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState<{ x: number; y: number; above: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleOpen = () => {
    if (open) { setOpen(false); return }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const menuH = sharesHeld > 0 ? 108 : 72   // approx height of 3 or 2 items
      const above = r.bottom + menuH > window.innerHeight - 8
      setPos({ x: r.left, y: above ? r.top : r.bottom + 2, above })
    }
    setOpen(true)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* Two-zone trigger: symbol → Research, ▾ → trade menu */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <button
          onClick={onResearch}
          title={`Research ${symbol}`}
          style={{
            fontSize: 12, fontWeight: 500, cursor: 'pointer',
            background: 'none',
            border: '1px solid var(--fd-hairline)', borderRight: 'none',
            color: 'var(--fd-accent)', padding: '3px 7px',
            textTransform: 'uppercase', letterSpacing: '0.5px',
            textDecoration: 'underline', textUnderlineOffset: 2,
          }}>
          {symbol}
        </button>
        <button
          ref={btnRef}
          onClick={handleOpen}
          title="Trade actions"
          style={{
            fontSize: 12, cursor: 'pointer',
            background: open ? 'var(--fd-card)' : 'var(--fd-card)',
            border: `1px solid ${open ? 'var(--fd-hairline)' : 'var(--border2)'}`,
            color: open ? 'var(--fd-accent)' : M,
            padding: '3px 6px', lineHeight: 1,
          }}>
          ▾
        </button>
      </div>
      {name && name !== symbol && (
        <div style={{ fontSize: 12, color: M, marginTop: 2,
          maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' }}>
          {name}
        </div>
      )}
      {open && pos && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)} />
          <div style={{
            position: 'fixed',
            left: pos.x,
            ...(pos.above ? { bottom: window.innerHeight - pos.y } : { top: pos.y }),
            zIndex: 100,
            background: 'var(--fd-page)', border: '1px solid var(--fd-hairline)',
            minWidth: 110,
            boxShadow: 'none',
          }}>
            {([
              { label: 'Buy',      color: G, fn: onBuy  },
              { label: 'Sell',     color: R, fn: onSell },
              ...(sharesHeld > 0
                ? [{ label: 'Sell All', color: R, fn: onSellAll }]
                : []),
            ] as { label: string; color: string; fn: () => void }[]).map(item => (
              <button key={item.label}
                onClick={() => { setOpen(false); item.fn() }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', fontSize: 12, fontWeight: 500,
                  color: item.color, background: 'none',
                  border: 'none', borderBottom: '1px solid var(--fd-hairline)',
                  cursor: 'pointer', textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function HoldingsTab({ port, activeId, onMutate, divs = [], onLimitOrder: _onLimitOrder, onOpenOrder }:
  { port: Portfolio; activeId: number; onMutate: () => void; divs?: Dividend[]
    onLimitOrder: (o: LimitOrder) => void
    onOpenOrder: (symbol: string, action: 'BUY' | 'SELL', sharesHeld: number) => void }) {
  const holdings = port.holdings ?? []
  const tv = port.total_value || 1

  // LTM income per symbol from recorded dividends
  const ttmCutoff = new Date(); ttmCutoff.setFullYear(ttmCutoff.getFullYear() - 1)
  const ltmBySym: Record<string, number> = {}
  divs.filter(d => new Date(d.payment_date) >= ttmCutoff)
    .forEach(d => { ltmBySym[d.symbol] = (ltmBySym[d.symbol] ?? 0) + d.total_amount })

  // Local price/shares overrides for realtime recalculation (resets on refresh)
  const [priceOverrides,  setPriceOverrides]  = useState<Record<string, number>>({})
  const [sharesOverrides, setSharesOverrides] = useState<Record<string, number>>({})
  // annual_dividend_per_share drives both the "Annual $" and "Yield %" columns
  // (see adpsRow below), so both edit paths write here for instant recalculation
  const [adpsOverrides, setAdpsOverrides] = useState<Record<string, number>>({})

  // Effective total portfolio value using local overrides
  const effectiveTv = holdings.length > 0
    ? Math.max(holdings.reduce((sum, h) => {
        const ep = priceOverrides[h.symbol]  ?? h.current_price
        const es = sharesOverrides[h.symbol] ?? h.total_shares
        return sum + ep * es
      }, 0), 1)
    : tv

  // Inline edit state: maps "symbol:field" → edit value
  const [editing, setEditing] = useState<Record<string, string>>({})

  const [editErr, setEditErr] = useState('')

  const patchMut = useMutation({
    mutationFn: ({ symbol, fields }: { symbol: string; fields: Record<string, unknown> }) =>
      fetch(`${BASE}/portfolios/${activeId}/holdings/${symbol}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      }).then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data?.error ?? `Failed to save (${r.status})`)
        return data
      }),
    onSuccess: () => { setEditErr(''); onMutate() },
    onError: (e: Error) => setEditErr(e.message),
  })

  const startEdit = (sym: string, field: string, cur: string) =>
    setEditing(s => ({ ...s, [`${sym}:${field}`]: cur }))
  const cancelEdit = (sym: string, field: string) =>
    setEditing(s => { const n = { ...s }; delete n[`${sym}:${field}`]; return n })
  const commitEdit = (sym: string, field: string, raw: string, isNum = true) => {
    cancelEdit(sym, field)
    const val = isNum ? (raw === '' ? null : parseFloat(raw)) : (raw === '' ? null : raw)
    // Update local overrides for instant recalculation
    if (field === 'current_price' && typeof val === 'number' && val > 0)
      setPriceOverrides(s => ({ ...s, [sym]: val }))
    if (field === 'total_shares' && typeof val === 'number' && val > 0)
      setSharesOverrides(s => ({ ...s, [sym]: val }))
    if (field === 'annual_dividend_per_share') {
      if (typeof val === 'number' && val >= 0)
        setAdpsOverrides(s => ({ ...s, [sym]: val }))
      else
        setAdpsOverrides(s => { const n = { ...s }; delete n[sym]; return n })
    }
    if (field === 'dividend_yield') {
      // The Yield% and Annual $/sh cells describe the same income, and the
      // display always derives from annual_dividend_per_share (adpsRow) —
      // so a plain `dividend_yield` write is silently shadowed by the
      // existing ADPS value. Convert the typed yield into $/sh using the
      // effective price and update both fields together.
      const ep = priceOverrides[sym] ?? holdings.find(x => x.symbol === sym)?.current_price ?? 0
      if (typeof val === 'number' && val >= 0 && ep > 0) {
        const adps = val / 100 * ep
        setAdpsOverrides(s => ({ ...s, [sym]: adps }))
        patchMut.mutate({ symbol: sym, fields: { dividend_yield: val, annual_dividend_per_share: adps } })
      } else {
        setAdpsOverrides(s => { const n = { ...s }; delete n[sym]; return n })
        patchMut.mutate({ symbol: sym, fields: { dividend_yield: null, annual_dividend_per_share: null } })
      }
      return
    }
    patchMut.mutate({ symbol: sym, fields: { [field]: val } })
  }
  const isEditing = (sym: string, field: string) => editing[`${sym}:${field}`] !== undefined
  const editVal   = (sym: string, field: string) => editing[`${sym}:${field}`] ?? ''

  // Portfolio-level income aggregate (actual LTM + ADPS + yield fallback,
  // same precedence as the per-row Yield%/Annual $ calc below)
  const incByHolding = holdings.map(h => {
    const ltm = ltmBySym[h.symbol] ?? 0
    const adps = adpsOverrides[h.symbol] ?? h.annual_dividend_per_share
    const es = sharesOverrides[h.symbol] ?? h.total_shares
    const fromAdps = adps != null ? adps * es : 0
    const fromYield = (h.dividend_yield ?? 0) / 100 * h.market_value
    const annual = ltm > 0 ? ltm : fromAdps > 0 ? fromAdps : fromYield
    return { h, annual }
  })
  const totalAnnual = incByHolding.reduce((s, { annual }) => s + annual, 0)
  const portYield = port.holdings_value > 0 ? totalAnnual / port.holdings_value * 100 : 0
  const totalCost = holdings.reduce((s, h) => s + h.total_cost, 0)
  const portYoC = totalCost > 0 ? totalAnnual / totalCost * 100 : 0

  // Column header group styles
  const posHdr  = { background: 'var(--fd-card)',  color: 'var(--fd-accent)' }
  const incHdr  = { background: 'var(--fd-card)',   color: 'var(--fd-accent)' }
  const schHdr  = { background: 'var(--fd-card)',  color: 'var(--fd-lilac-ink)' }
  const cellR   = { padding: '5px 10px', textAlign: 'right'  as const }
  const cellL   = { padding: '5px 10px', textAlign: 'left'   as const }

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Place Order ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {editErr
          ? <div style={{ fontSize: 12, color: R }}> {editErr}</div>
          : <div />}
        <Btn onClick={() => onOpenOrder('', 'BUY', 0)} variant="green">+ Place Order</Btn>
      </div>
      {/* ── Income KPI banner ────────────────────────────────────────────── */}
      {totalAnnual > 0 && (
        <div style={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {[
            { label: 'Portfolio Yield',  value: `${portYield.toFixed(2)}%`,         color: 'var(--fd-accent)' },
            { label: 'Yield on Cost',    value: `${portYoC.toFixed(2)}%`,           color: 'var(--fd-accent)' },
            { label: 'Est Annual Income',value: fmtMoneyFull(totalAnnual),          color: 'var(--fd-accent)' },
            { label: 'Monthly Income',   value: fmtMoneyFull(totalAnnual / 12),     color: 'var(--fd-lime-ink)' },
          ].map(kpi => (
            <div key={kpi.label} style={{
              flex: '1 1 120px', background: 'var(--surface)',
              borderTop: `2px solid ${kpi.color}`,
              border: `1px solid var(--fd-hairline)`, borderTopColor: kpi.color,
              borderRadius: 0, padding: '8px 14px',
            }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
                letterSpacing: '0.8px', marginBottom: 2 }}>{kpi.label}</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: kpi.color,
                fontFamily: 'var(--font-mono)' }}>{kpi.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Holdings table ────────────────────────────────────────────────── */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: A,
          textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
          ◈ POSITIONS ({holdings.length}) — click  to override any field · refresh prices to auto-populate
        </div>
        {holdings.length === 0 ? (
          <div style={{ fontSize: 12, color: M, padding: '20px 0' }}>No positions.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 1000, width: '100%' }}>
            <thead>
              {/* ── Group header row ──────────────────────────────────── */}
              <tr>
                <th colSpan={7} style={{ ...posHdr, padding: '3px 10px', fontSize: 12,
                  fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px',
                  textAlign: 'left', borderBottom: '1px solid var(--fd-hairline)' }}>
                  ◈ POSITION
                </th>
                <th colSpan={4} style={{ ...incHdr, padding: '3px 10px', fontSize: 12,
                  fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px',
                  textAlign: 'left', borderBottom: '1px solid var(--fd-hairline)',
                  borderLeft: '1px solid var(--fd-hairline)' }}>
                  ◈ INCOME
                </th>
                <th colSpan={3} style={{ ...schHdr, padding: '3px 10px', fontSize: 12,
                  fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.8px',
                  textAlign: 'left', borderBottom: '1px solid var(--fd-hairline)',
                  borderLeft: '1px solid var(--fd-hairline)' }}>
                  ◈ SCHEDULE 
                </th>
              </tr>
              {/* ── Column label row ──────────────────────────────────── */}
              <tr style={{ borderBottom: '2px solid var(--border2)' }}>
                {[
                  /* POSITION */
                  { l: 'Holding',         align: 'left'  as const, bg: posHdr.background },
                  { l: 'Shares ',        align: 'right' as const, bg: posHdr.background },
                  { l: 'Avg Cost',        align: 'right' as const, bg: posHdr.background },
                  { l: 'Price ',         align: 'right' as const, bg: posHdr.background },
                  { l: 'Day Chg',         align: 'right' as const, bg: posHdr.background },
                  { l: 'Mkt Value / P&L', align: 'right' as const, bg: posHdr.background },
                  { l: 'Wt %',            align: 'right' as const, bg: posHdr.background },
                  /* INCOME */
                  { l: 'Annual $ ',      align: 'right' as const, bg: incHdr.background, bl: 'var(--fd-card)' },
                  { l: 'Yield % ',       align: 'right' as const, bg: incHdr.background },
                  { l: 'YoC %',           align: 'right' as const, bg: incHdr.background },
                  { l: 'Freq ',          align: 'right' as const, bg: incHdr.background },
                  /* SCHEDULE */
                  { l: 'Ex-Div Date ',   align: 'right' as const, bg: schHdr.background, bl: 'var(--fd-card)' },
                  { l: 'Next Pay ',      align: 'right' as const, bg: schHdr.background },
                  { l: 'Next Pay $',      align: 'right' as const, bg: schHdr.background },
                ].map((col, i) => (
                  <th key={i} style={{
                    padding: '4px 10px', textAlign: col.align, fontSize: 12,
                    color: 'var(--fd-muted)', fontWeight: 500, textTransform: 'uppercase',
                    letterSpacing: '0.5px', whiteSpace: 'nowrap',
                    background: col.bg ?? 'transparent',
                    borderLeft: col.bl ? `1px solid ${col.bl}` : undefined,
                  }}>{col.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incByHolding.map(({ h, annual }, ri) => {
                const rowBg = ri % 2 === 0 ? 'transparent' : 'var(--fd-card)'
                const ltmInc   = ltmBySym[h.symbol] ?? 0
                // Effective values using local overrides
                const ep       = priceOverrides[h.symbol]  ?? h.current_price
                const es       = sharesOverrides[h.symbol] ?? h.total_shares
                const ec       = h.average_cost
                const effMktVal    = ep * es
                const effTotalCost = ec * es
                const effPnL       = effMktVal - effTotalCost
                const effPnLPct    = effTotalCost > 0 ? effPnL / effTotalCost * 100 : 0
                // Scale annual income proportionally if shares overridden
                const effAnnual    = sharesOverrides[h.symbol] != null && h.total_shares > 0
                  ? annual * (es / h.total_shares) : annual
                // Yield%: prefer annualized per-share data (matches Annual Income column),
                // then stored yield, then LTM actual (may be partial-year if portfolio is new)
                const adpsRow  = adpsOverrides[h.symbol] ?? h.annual_dividend_per_share
                const yieldPct = adpsRow != null && effMktVal > 0
                  ? adpsRow * es / effMktVal * 100
                  : h.dividend_yield != null
                    ? h.dividend_yield
                    : ltmInc > 0 && effMktVal > 0
                      ? ltmInc / effMktVal * 100
                      : 0
                const yieldSrc = ltmInc > 0 ? 'actual' : h.dividend_yield != null ? 'stored' : 'none'
                // YoC: use same annualized income as Yield% to avoid partial-year distortion
                const annualizedIncome = adpsRow != null ? adpsRow * es
                  : h.dividend_yield != null ? h.dividend_yield / 100 * effMktVal
                  : effAnnual
                const yocPct   = effTotalCost > 0 && annualizedIncome > 0 ? annualizedIncome / effTotalCost * 100 : 0
                const wt       = effMktVal / effectiveTv * 100
                // Effective dates — auto-roll forward if past
                const displayExDate  = h.ex_dividend_date
                  ? effectiveNextDate(h.ex_dividend_date,  h.payment_frequency) : null
                const displayPayDate = h.next_payment_date
                  ? effectiveNextDate(h.next_payment_date, h.payment_frequency) : null
                const exDays   = daysUntil(displayExDate)
                const payDays  = daysUntil(displayPayDate)
                // Auto-compute per-payment amount from available data
                const payPerSh: number | null =
                  h.next_payment_per_share
                  ?? (h.annual_dividend_per_share != null && h.payment_frequency
                      ? h.annual_dividend_per_share / freqDivisor(h.payment_frequency)
                      : null)
                const nextPayTotal = payPerSh != null ? payPerSh * es : null
                const hasInc   = effAnnual > 0

                return (
                  <tr key={h.symbol} style={{ borderBottom: '1px solid var(--fd-hairline)',
                    background: rowBg }}>

                    {/* ── POSITION columns ─────────────────────────────── */}
                    {/* Holding */}
                    <td style={{ ...cellL, whiteSpace: 'nowrap' }}>
                      <TradePicklist
                        symbol={h.symbol}
                        name={h.name}
                        sharesHeld={h.total_shares}
                        onResearch={() => {
                          const url = new URL(window.location.href)
                          url.searchParams.set('research', h.symbol)
                          window.open(url.toString(), '_blank', 'noopener')
                        }}
                        onBuy={() => onOpenOrder(h.symbol, 'BUY', h.total_shares)}
                        onSell={() => onOpenOrder(h.symbol, 'SELL', h.total_shares)}
                        onSellAll={() => onOpenOrder(h.symbol, 'SELL', h.total_shares)}
                      />
                    </td>
                    {/* Shares  */}
                    <td style={{ ...cellR, color: M }}>
                      {isEditing(h.symbol, 'total_shares')
                        ? <InlineNumEdit
                            value={editVal(h.symbol, 'total_shares')}
                            onSave={raw => commitEdit(h.symbol, 'total_shares', raw)}
                          />
                        : <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                            <span>{es >= 1000 ? es.toFixed(2) : es.toFixed(4)}</span>
                            <span
                              onClick={() => startEdit(h.symbol, 'total_shares', String(es))}
                              style={{ cursor: 'pointer', fontSize: 12, color: M, textDecoration: 'underline', textUnderlineOffset: 3 }}>Edit</span>
                          </div>
                      }
                    </td>
                    {/* Avg Cost */}
                    <td style={{ ...cellR, color: M }}>${ec.toFixed(2)}</td>
                    {/* Price  */}
                    <td style={{ ...cellR, color: 'var(--text)', fontWeight: 500 }}>
                      {isEditing(h.symbol, 'current_price')
                        ? <InlineNumEdit
                            value={editVal(h.symbol, 'current_price')}
                            onSave={raw => commitEdit(h.symbol, 'current_price', raw)}
                          />
                        : <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                              <span>${ep.toFixed(2)}</span>
                              <span
                                onClick={() => startEdit(h.symbol, 'current_price', String(ep))}
                                style={{ cursor: 'pointer', fontSize: 12, color: M, textDecoration: 'underline', textUnderlineOffset: 3 }}>Edit</span>
                            </div>
                            {h.day_change_pct !== 0 && (
                              <div style={{ fontSize: 12, color: h.day_change_pct >= 0 ? G : R }}>
                                {h.day_change_pct >= 0 ? '+' : ''}{h.day_change_pct.toFixed(2)}%
                              </div>
                            )}
                          </div>
                      }
                    </td>
                    {/* Day Chg $ */}
                    <td style={{ ...cellR, color: h.day_change >= 0 ? G : R, fontSize: 12 }}>
                      {h.day_change >= 0 ? '+' : ''}{fmtMoney(h.day_change)}
                    </td>
                    {/* Mkt Value + P&L */}
                    <td style={{ ...cellR }}>
                      <div style={{ fontWeight: 500 }}>{fmtMoney(effMktVal)}</div>
                      <div style={{ fontSize: 12, color: effPnL >= 0 ? G : R }}>
                        {effPnL >= 0 ? '+' : ''}{fmtMoney(effPnL)}
                        <span style={{ color: M, marginLeft: 3 }}>
                          ({fmtPct(effPnLPct)})
                        </span>
                      </div>
                    </td>
                    {/* Weight % */}
                    <td style={{ ...cellR, color: M }}>
                      <div>{wt.toFixed(1)}%</div>
                      <div style={{ height: 2, borderRadius: 0, marginTop: 2,
                        background: 'var(--fd-page)', width: 40, marginLeft: 'auto' }}>
                        <div style={{ height: 2, borderRadius: 0,
                          width: `${Math.min(wt, 100)}%`, background: 'var(--fd-accent)' }} />
                      </div>
                    </td>

                    {/* ── INCOME columns ────────────────────────────────── */}
                    {/* Annual $ */}
                    {(() => {
                      // Use stored annual_dividend_per_share if available, else back-compute
                      const adps = adpsOverrides[h.symbol] ?? h.annual_dividend_per_share
                      const annualDisp = adps != null ? adps * es : (hasInc ? effAnnual : null)
                      return (
                        <td style={{ ...cellR, background: incHdr.background,
                          borderLeft: '1px solid var(--fd-hairline)' }}>
                          {isEditing(h.symbol, 'annual_dividend_per_share')
                            ? <InlineNumEdit
                                value={editVal(h.symbol, 'annual_dividend_per_share')}
                                suffix="/sh"
                                onSave={raw => commitEdit(h.symbol, 'annual_dividend_per_share', raw)}
                              />
                            : <div style={{ display: 'flex', alignItems: 'center',
                                gap: 4, justifyContent: 'flex-end' }}>
                                <div>
                                  <div style={{ color: hasInc ? G : M, fontWeight: hasInc ? 700 : 400 }}>
                                    {annualDisp != null ? fmtMoney(annualDisp) : '—'}
                                  </div>
                                  {adps != null && (
                                    <div style={{ fontSize: 12, color: 'var(--fd-accent)' }}>
                                      ${adps.toFixed(4)}/sh
                                    </div>
                                  )}
                                </div>
                                <span onClick={() => startEdit(h.symbol, 'annual_dividend_per_share',
                                    adps != null ? String(adps) : '')}
                                  style={{ cursor: 'pointer', fontSize: 12, color: M, textDecoration: 'underline', textUnderlineOffset: 3 }}>Edit</span>
                              </div>
                          }
                        </td>
                      )
                    })()}
                    {/* Yield % */}
                    <td style={{ ...cellR, background: incHdr.background }}>
                      {isEditing(h.symbol, 'dividend_yield')
                        ? <InlineNumEdit
                            value={editVal(h.symbol, 'dividend_yield')}
                            suffix="%"
                            onSave={raw => commitEdit(h.symbol, 'dividend_yield', raw)}
                          />
                        : <div style={{ display: 'flex', alignItems: 'center',
                            gap: 3, justifyContent: 'flex-end' }}>
                            <div>
                              <span style={{
                                color: hasInc ? 'var(--fd-accent)' : M,
                                fontWeight: hasInc ? 700 : 400,
                              }}>
                                {hasInc ? `${yieldPct.toFixed(2)}%` : '—'}
                              </span>
                              {yieldSrc === 'actual' && (
                                <span title="From recorded dividends"
                                  style={{ fontSize: 12, color: G, marginLeft: 3 }}>✓</span>
                              )}
                              {yieldSrc === 'stored' && (
                                <span title="From yfinance / manual"
                                  style={{ fontSize: 12, color: 'var(--fd-accent)', marginLeft: 3 }}>~</span>
                              )}
                            </div>
                            <span onClick={() => startEdit(h.symbol, 'dividend_yield',
                                yieldSrc !== 'none' ? yieldPct.toFixed(2) : '')}
                              style={{ cursor: 'pointer', fontSize: 12, color: M, textDecoration: 'underline', textUnderlineOffset: 3 }}>Edit</span>
                          </div>
                      }
                    </td>
                    {/* YoC % */}
                    <td style={{ ...cellR, background: incHdr.background,
                      color: hasInc ? 'var(--fd-accent)' : M }}>
                      {hasInc ? `${yocPct.toFixed(2)}%` : '—'}
                    </td>
                    {/* Frequency — click badge to change via dropdown */}
                    <td style={{ ...cellR, background: incHdr.background }}>
                      {(() => {
                        const FREQ_OPTIONS = ['Weekly','Monthly','Quarterly','Semi-Annual','Annual']
                        const freq = h.payment_frequency || null
                        const freqColor = (f: string | null) =>
                          f === 'Monthly'     ? 'var(--fd-accent)'
                          : f === 'Weekly'    ? 'var(--fd-lilac-ink)'
                          : f === 'Quarterly' ? 'var(--fd-accent)'
                          : f === 'Semi-Annual' ? 'var(--fd-accent)'
                          : f === 'Annual'    ? 'var(--fd-hairline)'
                          : 'var(--fd-hairline)'

                        if (isEditing(h.symbol, 'payment_frequency')) {
                          return (
                            <select
                              autoFocus
                              value={editVal(h.symbol, 'payment_frequency')}
                              onChange={e => {
                                patchMut.mutate({ symbol: h.symbol,
                                  fields: { payment_frequency: e.target.value } })
                                cancelEdit(h.symbol, 'payment_frequency')
                              }}
                              onBlur={() => cancelEdit(h.symbol, 'payment_frequency')}
                              onKeyDown={e => {
                                if (e.key === 'Escape') cancelEdit(h.symbol, 'payment_frequency')
                              }}
                              style={{
                                background: 'var(--fd-page)', color: 'var(--text)',
                                border: '1px solid var(--fd-accent)',
                                fontSize: 12, padding: '2px 4px',
                              }}
                            >
                              <option value="">— clear —</option>
                              {FREQ_OPTIONS.map(o => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          )
                        }

                        const col = freqColor(freq)
                        return (
                          <div style={{ display: 'flex', alignItems: 'center',
                            gap: 4, justifyContent: 'flex-end' }}>
                            <span
                              title="Click to change frequency"
                              onClick={() => startEdit(h.symbol, 'payment_frequency', freq ?? '')}
                              style={{
                                fontSize: 12, fontWeight: 500, padding: '2px 6px',
                                borderRadius: 0, background: `${col}20`,
                                color: freq ? col : 'var(--fd-hairline)',
                                textTransform: 'uppercase', letterSpacing: '0.3px',
                                cursor: 'pointer', border: `1px solid ${col}`,
                              }}>
                              {freq ?? '—'}
                            </span>
                            <span
                              onClick={() => startEdit(h.symbol, 'payment_frequency', freq ?? '')}
                              style={{ cursor: 'pointer', fontSize: 12, color: M, textDecoration: 'underline', textUnderlineOffset: 3 }}>Edit</span>
                          </div>
                        )
                      })()}
                    </td>

                    {/* ── SCHEDULE columns ──────────────────────────────── */}
                    {/* Ex-Dividend Date — editable */}
                    <td style={{ ...cellR, background: schHdr.background,
                      borderLeft: '1px solid var(--fd-hairline)' }}>
                      {isEditing(h.symbol, 'ex_dividend_date') ? (
                        <InlineDateEdit
                          value={h.ex_dividend_date ?? ''}
                          onSave={v => {
                            patchMut.mutate({ symbol: h.symbol,
                              fields: { ex_dividend_date: v || null } })
                            cancelEdit(h.symbol, 'ex_dividend_date')
                          }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                          <div>
                            {displayExDate
                              ? <>
                                  <div style={{ color: 'var(--text)', fontSize: 12 }}>
                                    {fmtDate(displayExDate)}
                                  </div>
                                  {exDays != null && (
                                    <div style={{ fontSize: 12,
                                      color: exDays < 0 ? M : exDays <= 7 ? 'var(--fd-lilac-ink)' : 'var(--fd-lilac-ink)' }}>
                                      {exDays < 0 ? `${Math.abs(exDays)}d ago` : `in ${exDays}d`}
                                    </div>
                                  )}
                                </>
                              : <span style={{ color: M }}>—</span>
                            }
                          </div>
                          <span onClick={() => startEdit(h.symbol, 'ex_dividend_date', '')}
                            style={{ cursor: 'pointer', fontSize: 12, color: M, textDecoration: 'underline', textUnderlineOffset: 3 }}>Edit</span>
                        </div>
                      )}
                    </td>
                    {/* Next Payment Date — editable */}
                    <td style={{ ...cellR, background: schHdr.background }}>
                      {isEditing(h.symbol, 'next_payment_date') ? (
                        <InlineDateEdit
                          value={h.next_payment_date ?? ''}
                          onSave={v => {
                            patchMut.mutate({ symbol: h.symbol,
                              fields: { next_payment_date: v || null } })
                            cancelEdit(h.symbol, 'next_payment_date')
                          }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                          <div>
                            {displayPayDate
                              ? <>
                                  <div style={{ color: 'var(--text)', fontSize: 12 }}>
                                    {fmtDate(displayPayDate)}
                                  </div>
                                  {payDays != null && (
                                    <div style={{ fontSize: 12,
                                      color: payDays < 0 ? M : payDays <= 14 ? 'var(--fd-accent)' : 'var(--fd-lilac-ink)' }}>
                                      {payDays < 0 ? `${Math.abs(payDays)}d ago` : `in ${payDays}d`}
                                    </div>
                                  )}
                                </>
                              : <span style={{ color: M }}>—</span>
                            }
                          </div>
                          <span onClick={() => startEdit(h.symbol, 'next_payment_date', '')}
                            style={{ cursor: 'pointer', fontSize: 12, color: M, textDecoration: 'underline', textUnderlineOffset: 3 }}>Edit</span>
                        </div>
                      )}
                    </td>
                    {/* Next Payment $ — auto-computed from per-share or annual ÷ freq */}
                    <td style={{ ...cellR, background: schHdr.background }}>
                      {nextPayTotal != null ? (
                        <div>
                          <div style={{ color: 'var(--fd-lilac-ink)', fontWeight: 500, fontSize: 12 }}>
                            {fmtMoney(nextPayTotal)}
                          </div>
                          <div style={{ fontSize: 12, color: M }}>
                            ${payPerSh!.toFixed(4)}/sh
                          </div>
                        </div>
                      ) : <span style={{ color: M }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border2)',
                background: 'var(--fd-card)' }}>
                <td style={{ ...cellL, fontWeight: 500, color: M, fontSize: 12 }}>
                  {holdings.length} pos · cash {fmtMoney(port.current_cash)}
                </td>
                <td colSpan={5} />
                <td style={{ ...cellR, fontWeight: 500, color: 'var(--text)' }}>
                  {fmtMoney(port.holdings_value)}
                </td>
                <td style={{ ...cellR, fontWeight: 500,
                  background: incHdr.background,
                  color: totalAnnual > 0 ? G : M,
                  borderLeft: '1px solid var(--fd-hairline)' }}>
                  {totalAnnual > 0 ? fmtMoney(totalAnnual) : '—'}
                </td>
                <td style={{ ...cellR, fontWeight: 500,
                  background: incHdr.background, color: 'var(--fd-accent)' }}>
                  {portYield > 0 ? `${portYield.toFixed(2)}%` : '—'}
                </td>
                <td style={{ ...cellR, background: incHdr.background, color: 'var(--fd-accent)' }}>
                  {portYoC > 0 ? `${portYoC.toFixed(2)}%` : '—'}
                </td>
                <td colSpan={3} style={{ background: incHdr.background }} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

    </div>
  )
}
