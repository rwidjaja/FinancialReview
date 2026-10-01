import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { Portfolio } from './types'
import { G, R, M, BASE, POST, DEL } from './constants'
import { Btn, Input } from './shared'

export function WatchlistTab({ port, activeId, onMutate }:
  { port: Portfolio; activeId: number; onMutate: () => void }) {
  const watchlist = port.watchlist ?? []
  const [sym, setSym]   = useState('')
  const [note, setNote] = useState('')
  const [err, setErr]   = useState('')

  const addMut = useMutation({
    mutationFn: () => POST(`${BASE}/portfolios/${activeId}/watchlist`,
      { symbol: sym.toUpperCase(), notes: note }),
    onSuccess: () => { setSym(''); setNote(''); setErr(''); onMutate() },
    onError: (e: Error) => setErr(e.message),
  })

  const delMut = useMutation({
    mutationFn: (id: number) => DEL(`${BASE}/watchlist/${id}`),
    onSuccess: () => onMutate(),
  })

  // Stale-price guard: show hint when a symbol has never been priced.
  const stalePrices = watchlist.some(w => w.price == null)

  return (
    <div style={{ padding: '12px 16px' }}>
      {/* Add form */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
        <div style={{ width: 80 }}>
          <Input label="Symbol" value={sym}
            onChange={v => setSym(v.toUpperCase())} placeholder="AAPL" />
        </div>
        <div style={{ flex: 1, maxWidth: 200 }}>
          <Input label="Notes (opt)" value={note} onChange={setNote} />
        </div>
        <Btn onClick={() => {
          if (!sym) { setErr('Symbol required'); return }
          addMut.mutate()
        }} variant="blue" disabled={addMut.isPending}>+ Watch</Btn>
      </div>
      {err && <div style={{ fontSize: 12, color: R, marginBottom: 8 }}> {err}</div>}
      {stalePrices && (
        <div style={{ fontSize: 12, color: M, marginBottom: 8 }}>
          Some prices not yet loaded — use <strong>↺ Refresh Prices</strong> in the header.
        </div>
      )}

      {/* Watchlist table */}
      {watchlist.length === 0 ? (
        <div style={{ fontSize: 12, color: M }}>Watchlist empty.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border2)' }}>
              {['Symbol', 'Price', 'Day Chg', 'Day Chg %', 'Notes', ''].map(h => (
                <th key={h} style={{
                  padding: '4px 8px', textAlign: 'right',
                  fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  ...(h === 'Symbol' || h === 'Notes' ? { textAlign: 'left' } : {}),
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {watchlist.map(w => {
              const chgPct = w.change_pct ?? null
              const chgColor = chgPct == null ? M : chgPct >= 0 ? G : R
              // Derive day change in dollars from price and prev_close if available
              const prevClose = (w as any).prev_close as number | undefined
              const dayChgDollar = w.price != null && prevClose != null
                ? w.price - prevClose : null

              return (
                <tr key={w.watchlist_id}
                  style={{ borderBottom: '1px solid var(--fd-hairline)' }}>
                  <td style={{ padding: '5px 8px' }}>
                    <span
                      onClick={() => {
                        const url = new URL(window.location.href)
                        url.searchParams.set('research', w.symbol)
                        window.open(url.toString(), '_blank', 'noopener')
                      }}
                      title={`Open ${w.symbol} in Research (new tab)`}
                      style={{
                        fontWeight: 500, fontSize: 12, color: 'var(--fd-accent)',
                        cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2,
                      }}>{w.symbol}</span>
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    {w.price != null ? `$${w.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: chgColor }}>
                    {dayChgDollar != null
                      ? `${dayChgDollar >= 0 ? '+' : ''}$${dayChgDollar.toFixed(2)}`
                      : '—'}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, color: chgColor }}>
                    {chgPct != null ? `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%` : '—'}
                  </td>
                  <td style={{ padding: '5px 8px', color: M, fontSize: 12 }}>{w.notes || '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                    <Btn small variant="red"
                      onClick={() => delMut.mutate(w.watchlist_id)}>✕</Btn>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
