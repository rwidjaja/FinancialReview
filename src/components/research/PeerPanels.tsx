// ── Peer Comparison Components ────────────────────────────────────────────────

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { G, R, A, M, Y } from './researchTypes'
import type { ResearchApiData } from './researchTypes'

export function PeerChip({ sym, selectedPeer, onClick, onSearch }: {
  sym: string
  selectedPeer: string
  onClick: (sym: string) => void
  onSearch?: (sym: string) => void
}) {
  const isSelected = sym === selectedPeer
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <button onClick={() => onClick(sym)} style={{
        fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, padding: '4px 10px', cursor: 'pointer',
        border: `1px solid ${isSelected ? A : 'var(--border2)'}`,
        borderRight: onSearch ? 'none' : undefined,
        borderRadius: onSearch ? '3px 0 0 3px' : 3,
        background: isSelected ? 'var(--fd-card)' : 'var(--panel)',
        color: isSelected ? A : 'var(--text)',
      }}>
        {sym}
      </button>
      {onSearch && (
        <button
          onClick={() => onSearch(sym)}
          title={`Search ${sym}`}
          style={{
            padding: '4px 6px', cursor: 'pointer',
            border: `1px solid ${isSelected ? A : 'var(--border2)'}`,
            borderLeft: `1px solid ${isSelected ? A : 'var(--border2)'}`,
            borderRadius: '0 3px 3px 0',
            background: isSelected ? 'var(--fd-card)' : 'var(--panel)',
            color: isSelected ? A : M,
            fontSize: 12, lineHeight: 1,
          }}
        >↗</button>
      )}
    </div>
  )
}

export function PeerValuePanel({ selectedPeer, onViewDetail }: {
  selectedPeer: string
  onViewDetail: (sym: string) => void
}) {
  const [peerCache, setPeerCache] = useState<Record<string, ResearchApiData>>({})

  const { isLoading: peerLoading } = useQuery({
    queryKey: ['peer-data', selectedPeer],
    queryFn: async () => {
      const res = await fetch(`/api/research?symbol=${encodeURIComponent(selectedPeer)}`)
      if (!res.ok) throw new Error('Failed')
      const d = await res.json()
      setPeerCache(prev => ({ ...prev, [selectedPeer]: d }))
      return d
    },
    enabled: !!selectedPeer,
    staleTime: 5 * 60 * 1000,
  })

  const pd = peerCache[selectedPeer]
  const q2 = pd?.quote || {}
  const rs2 = pd?.risk_stats || {}
  const pf2 = pd?.portfolio_fit || {}
  const di2 = pd?.distributions || {}
  const price2 = q2.last_price
  const yield2 = di2?.ttm_yield
  const sharpe2 = rs2.sharpe
  const corr2 = pf2.corr_portfolio
  const beta2 = rs2.beta
  const sleeve2 = pf2.sleeve

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
      <div style={{
        padding: '8px 12px', background: 'var(--panel2)',
        borderBottom: '1px solid var(--border2)',
        fontSize: 12, fontWeight: 500, color: M,
        textTransform: 'uppercase', letterSpacing: '0.5px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span>PEER VALUE — {selectedPeer}</span>
        {sleeve2 && <span style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 500 }}>{sleeve2}</span>}
      </div>

      <div style={{ padding: '12px 14px' }}>
        {!selectedPeer ? (
          <div style={{ padding: '20px', textAlign: 'center', color: M, fontSize: 12, fontStyle: 'italic' }}>
            Select a peer symbol above to compare
          </div>
        ) : peerLoading && !pd ? (
          <div style={{ padding: '20px', textAlign: 'center', color: M, fontSize: 12 }}>
            <span className="anim-blink">█</span> Loading {selectedPeer}…
          </div>
        ) : pd ? (
          <>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 12
            }}>
              <span style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase' }}>CURRENT VALUE</span>
              <span style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                ${price2?.toFixed(2) ?? '—'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4, fontWeight: 500 }}>Yield</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)', color: G }}>
                  {yield2 != null ? `${yield2.toFixed(2)}%` : '—'}
                </div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4, fontWeight: 500 }}>Sharpe</div>
                <div style={{
                  fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  color: sharpe2 != null ? (sharpe2 > 1 ? G : sharpe2 < 0.5 ? R : 'var(--text)') : M
                }}>
                  {sharpe2 != null ? sharpe2.toFixed(2) : '—'}
                </div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4, fontWeight: 500 }}>vs Portfolio</div>
                <div style={{
                  fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  color: corr2 != null ? (Math.abs(corr2) > 0.8 ? R : Math.abs(corr2) > 0.5 ? Y : G) : M
                }}>
                  {corr2 != null ? `${corr2 >= 0 ? '+' : ''}${corr2.toFixed(2)}` : '—'}
                </div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 4, fontWeight: 500 }}>Beta</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {beta2 != null ? beta2.toFixed(2) : '—'}
                </div>
              </div>
            </div>

            <button onClick={() => onViewDetail(selectedPeer)} style={{
              width: '100%', padding: '7px 14px', cursor: 'pointer',
              background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none',
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
              borderRadius: 0,
            }}>
              VIEW DETAIL →
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
