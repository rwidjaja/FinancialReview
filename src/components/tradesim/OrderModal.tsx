import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fmtMoneyFull } from '../../utils/formatters'
import type { Portfolio, LimitOrder } from './types'
import type { Snapshot } from '../../types/dashboard'
import { G, R, A, M, BASE, POST } from './constants'
import { Btn, Label } from './shared'

// ── Swing signal types (mirrored from SwingTradeTab) ──────────────────────────
interface SwingSignal {
  symbol:        string
  price:         number
  rsi:           number
  trend:         string
  pullback_pct:  number
  setup_score:   number
  symbol_score:  number
  entry_price:   number
  stop_loss:     number
  take_profit:   number
  rr_ratio:      number
  signal_icon:   string
  signal_text:   string
  final_decision: string
  is_buyable:    boolean
  atr:           number
  vol_ratio:     number
  error?:        string
}

// ── Inline swing intelligence panel ───────────────────────────────────────────
function SwingPanel({ symbol, onUsePrice }: {
  symbol:       string
  onUsePrice:   (price: number, label: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [signal,  setSignal]  = useState<SwingSignal | null>(null)
  const [err,     setErr]     = useState('')
  const [fetched, setFetched] = useState('')   // symbol last fetched

  const fetch_ = async (sym: string) => {
    if (!sym) return
    setLoading(true); setErr(''); setSignal(null)
    try {
      const r = await fetch(`${BASE}/swing/${sym}?interval=1d`)
      const d: SwingSignal = await r.json()
      if (d.error) { setErr(d.error); return }
      setSignal(d); setFetched(sym)
    } catch { setErr('Fetch failed') }
    finally { setLoading(false) }
  }

  const sym = symbol.trim().toUpperCase()
  const stale = fetched && fetched !== sym

  const scoreColor = !signal ? M
    : signal.symbol_score >= 4 ? 'var(--green)'
    : signal.symbol_score >= 3 ? 'var(--amber)' : 'var(--red)'

  const trendColor = !signal ? M
    : signal.trend === 'uptrend' ? 'var(--green)'
    : signal.trend === 'downtrend' ? 'var(--red)' : 'var(--amber)'

  return (
    <div style={{
      background: 'var(--fd-card)',
      border: '1px solid var(--fd-hairline)',
      padding: '10px 12px', marginBottom: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-accent)',
          textTransform: 'uppercase', letterSpacing: '0.7px' }}>
           Swing Intelligence
        </span>
        <span style={{ fontSize: 12, color: M }}>Daily timeframe</span>
        <Btn small variant="blue"
          onClick={() => fetch_(sym)} disabled={loading || !sym}>
          {loading ? '⟳' : stale ? `↻ Refresh (${sym})` : 'Get Signal'}
        </Btn>
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 4 }}> {err}</div>}

      {loading && <div style={{ fontSize: 12, color: M }}>Analyzing {sym}…</div>}

      {signal && !loading && (
        <>
          {/* Score + decision */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
            padding: '6px 8px',
            background: signal.is_buyable ? 'var(--fd-card)' : 'var(--fd-card)',
            borderRadius: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: scoreColor }}>
              {signal.symbol_score}/5
            </span>
            <span style={{ fontSize: 12, color: signal.is_buyable ? 'var(--green)' : M,
              fontWeight: signal.is_buyable ? 700 : 400 }}>
              {signal.signal_icon} {signal.signal_text}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: M }}>
              Score {signal.setup_score}/100
            </span>
          </div>

          {/* Quick stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
            gap: 4, fontSize: 12, marginBottom: 8 }}>
            {[
              { label: 'RSI', value: signal.rsi.toFixed(1),
                color: signal.rsi < 30 ? 'var(--amber)' : signal.rsi > 70 ? 'var(--red)' : 'var(--green)' },
              { label: 'Trend', value: signal.trend.replace('_',' '), color: trendColor },
              { label: 'Pullback', value: `${signal.pullback_pct.toFixed(1)}%`,
                color: signal.pullback_pct >= 1 ? 'var(--green)' : M },
              { label: 'Vol', value: `${signal.vol_ratio.toFixed(1)}x`, color: M },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: 'center', padding: '4px 2px',
                background: 'var(--fd-card)', borderRadius: 0 }}>
                <div style={{ color: M, fontSize: 12, marginBottom: 1 }}>{label}</div>
                <div style={{ color, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Suggested prices with "Use" buttons */}
          <div style={{ fontSize: 12, fontWeight: 500, color: M,
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
            Suggested Levels — click to pre-fill limit price
          </div>
          {[
            { label: '⬇ Entry (buy zone)', price: signal.entry_price, color: 'var(--fd-accent)' },
            { label: ' Take-profit',     price: signal.take_profit, color: 'var(--green)' },
            { label: ' Stop-loss',       price: signal.stop_loss,   color: 'var(--red)'   },
          ].map(({ label, price, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center',
              gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: M, flex: 1 }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 500,
                color, fontFamily: 'var(--font-mono)' }}>
                ${price.toFixed(2)}
              </span>
              <button onClick={() => onUsePrice(price, label)} style={{
                fontSize: 12, padding: '2px 7px', cursor: 'pointer', borderRadius: 0,
                background: `${color}18`, border: `1px solid ${color}`,
                color, fontWeight: 500,
              }}>← Use</button>
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--fd-muted)', marginTop: 4 }}>
            R:R {signal.rr_ratio.toFixed(1)}:1 · ATR ${signal.atr.toFixed(2)} · GTC recommended for swing entries
          </div>
        </>
      )}

      {!signal && !loading && !err && (
        <div style={{ fontSize: 12, color: M }}>
          Click <strong>Get Signal</strong> to load RSI, trend, entry/stop/target for {sym || 'this symbol'}.
        </div>
      )}
    </div>
  )
}

interface OrderModalProps {
  isOpen: boolean
  onClose: () => void
  port: Portfolio
  activeId: number
  initialSymbol: string
  initialAction: 'BUY' | 'SELL'
  initialSharesHeld: number
  onMutate: () => void
  onLimitOrder: (o: LimitOrder) => void
  snapshots: Record<string, Snapshot>
  initialLimitPrice?: number          // pre-fill from swing analysis
  initialOrderType?: 'MARKET' | 'LIMIT_DAY' | 'LIMIT_GTC'
  showSwingPanel?: boolean            // open swing panel automatically
}

export function OrderModal({
  isOpen, onClose, port, activeId,
  initialSymbol, initialAction, initialSharesHeld,
  onMutate, onLimitOrder, snapshots,
  initialLimitPrice, initialOrderType, showSwingPanel: initShowSwing = false,
}: OrderModalProps) {
  const [symbol,      setSymbol]      = useState(initialSymbol)
  const [action,      setAction]      = useState<'BUY' | 'SELL'>(initialAction)
  const [unit,        setUnit]        = useState<'SHARES' | 'DOLLARS'>('SHARES')
  const [qtyInput,    setQtyInput]    = useState('1')
  const [orderType,   setOrderType]   = useState<'MARKET' | 'LIMIT_DAY' | 'LIMIT_GTC'>(initialOrderType ?? 'LIMIT_DAY')
  const [priceInput,  setPriceInput]  = useState('')
  const [priceLocked, setPriceLocked] = useState(true)
  const [notes,       setNotes]       = useState('')
  const [showCalc,    setShowCalc]    = useState(false)
  const [calcBudget,  setCalcBudget]  = useState('')
  const [calcShares,  setCalcShares]  = useState('')
  const [showSpecial, setShowSpecial] = useState(false)
  const [showSwing,   setShowSwing]   = useState(initShowSwing)
  const [step,        setStep]        = useState<'form' | 'review'>('form')
  const [err,         setErr]         = useState('')
  const [ok,          setOk]          = useState('')

  // ── Live quote via /api/sim/quote/{symbol} (same module used by Research tab)
  // Mirrors the useResearch pattern: useQuery enabled when symbol is non-empty.
  // Only fetches when the local cache (holdings + snapshots) has no price.
  const symUpperForQuery = symbol.trim().toUpperCase()
  const localCachePrice =
    (port.holdings?.find(h => h.symbol === symUpperForQuery)?.current_price ?? 0) ||
    (snapshots[symUpperForQuery]?.price ?? snapshots[symUpperForQuery]?.nav ?? 0)

  const { data: quoteData, isFetching: quoteLoading } = useQuery<{ price: number; change_pct?: number }>({
    queryKey: ['sim-quote', symUpperForQuery],
    queryFn: () => fetch(`${BASE}/quote/${symUpperForQuery}`).then(r => r.json()),
    enabled: isOpen && symUpperForQuery.length >= 1 && localCachePrice === 0,
    staleTime: 2 * 60 * 1000,
    retry: 0,
  })

  // Seed price input whenever a fresh quote arrives and the field is still empty
  useEffect(() => {
    const p = quoteData?.price ?? 0
    if (p > 0 && !priceInput) setPriceInput(p.toFixed(2))
  }, [quoteData?.price]) // eslint-disable-line react-hooks/exhaustive-deps

  // Helper: best local price for any symbol
  const seedPrice = (sym: string) => {
    const h = port.holdings?.find(hh => hh.symbol === sym)
    const sp = snapshots[sym]?.price ?? snapshots[sym]?.nav ?? 0
    return h?.current_price ?? sp
  }

  // Sync state when modal opens
  useEffect(() => {
    if (!isOpen) return
    setSymbol(initialSymbol)
    setAction(initialAction)
    setUnit('SHARES')
    setOrderType(initialOrderType ?? 'LIMIT_DAY')
    setNotes('')
    setShowCalc(false); setCalcBudget(''); setCalcShares('')
    setShowSpecial(false)
    setShowSwing(initShowSwing)
    setStep('form')
    setErr(''); setOk('')
    const initQty = initialSharesHeld > 0 && initialAction === 'SELL'
      ? String(initialSharesHeld) : '1'
    setQtyInput(initQty)
    // Priority: explicit initialLimitPrice (from swing) → local cache price
    const p = initialLimitPrice ?? seedPrice(initialSymbol.toUpperCase())
    setPriceInput(p > 0 ? p.toFixed(2) : '')
    setPriceLocked(!initialLimitPrice)   // unlock when pre-filled from swing
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialSymbol, initialAction, initialSharesHeld,
      initialLimitPrice, initialOrderType, initShowSwing])

  // ── Early return AFTER all hooks ──────────────────────────────────────────
  if (!isOpen) return null

  const symUpper  = symbol.trim().toUpperCase()
  const holding   = port.holdings?.find(h => h.symbol === symUpper)
  const snapData  = snapshots[symUpper] ?? {} as Snapshot
  const fetchedPrice = quoteData?.price ?? 0
  // livePrice priority: sim holding → real snapshot → live quote from API
  const livePrice = holding?.current_price ?? snapData.price ?? snapData.nav ?? fetchedPrice
  const chgPct    = snapData.price_change_pct ?? 0

  const onSymbolChange = (v: string) => {
    const sym = v.toUpperCase()
    setSymbol(sym)
    if (priceLocked) {
      const p = seedPrice(sym)
      setPriceInput(p > 0 ? p.toFixed(2) : '')
      // If no local price, useQuery above will auto-fetch once sym is valid
    }
  }

  const qtyNum   = parseFloat(qtyInput)  || 0
  const priceNum = parseFloat(priceInput) || 0
  // refPrice: for MARKET use livePrice (falls back to seeded priceInput);
  //           for LIMIT use entered limit price (falls back to livePrice)
  const refPrice = orderType === 'MARKET'
    ? (livePrice || priceNum)
    : (priceNum || livePrice)

  const sharesForOrder = unit === 'SHARES'
    ? qtyNum
    : (refPrice > 0 ? qtyNum / refPrice : 0)
  const estAmount = sharesForOrder * refPrice

  // Calculator
  const calcBudgetNum = parseFloat(calcBudget) || 0
  const calcSharesNum = parseFloat(calcShares) || 0
  const calcRef       = priceNum || livePrice
  const calcDerivedShares = (calcBudgetNum > 0 && calcRef > 0) ? Math.floor(calcBudgetNum / calcRef) : null
  const calcDerivedCost   = (calcSharesNum > 0 && calcRef > 0) ? calcSharesNum * calcRef : null

  const tradeMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      POST(`${BASE}/portfolios/${activeId}/${action.toLowerCase()}`, body),
    onSuccess: () => {
      setOk(`${action} executed ✓`); setErr('')
      onMutate()
      setTimeout(() => { setOk(''); onClose() }, 1500)
    },
    onError: (e: Error) => { setErr(e.message); setStep('form') },
  })

  const handleClear = () => {
    setQtyInput('1')
    const p = seedPrice(symUpper)
    setPriceInput(p > 0 ? p.toFixed(2) : '')
    setNotes(''); setErr(''); setOk('')
    setOrderType('LIMIT_DAY'); setUnit('SHARES')
    setCalcBudget(''); setCalcShares('')
  }

  const handleReview = () => {
    setErr('')
    if (!symUpper) { setErr('Enter a symbol'); return }

    if (unit === 'DOLLARS') {
      if (qtyNum <= 0) { setErr('Enter a dollar amount'); return }
      if (refPrice <= 0) { setErr(`No price available for ${symUpper} — enter a limit price manually`); return }
    } else {
      if (sharesForOrder <= 0) { setErr('Enter a valid quantity'); return }
      if (orderType !== 'MARKET' && priceNum <= 0) { setErr('Enter a limit price'); return }
    }

    if (action === 'BUY' && orderType === 'MARKET' && refPrice > 0) {
      if (sharesForOrder * refPrice > port.current_cash)
        { setErr(`Insufficient cash — need ~${fmtMoneyFull(sharesForOrder * refPrice)}`); return }
    }
    if (action === 'SELL' && holding && sharesForOrder > holding.total_shares)
      { setErr(`Only ${holding.total_shares.toFixed(4)} shares held`); return }
    setStep('review')
  }

  const handlePlaceOrder = () => {
    if (orderType !== 'MARKET') {
      const now = new Date()
      const expiresAt = orderType === 'LIMIT_DAY'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0, 0).toISOString()
        : null
      onLimitOrder({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        portfolioId: activeId, action, symbol: symUpper,
        shares: sharesForOrder, limitPrice: priceNum, orderType,
        status: 'OPEN', createdAt: now.toISOString(), expiresAt,
        notes: notes || undefined,
      })
      setOk(`${orderType === 'LIMIT_DAY' ? 'Limit Day' : 'Limit GTC'} order placed ✓`)
      setTimeout(() => { setOk(''); onClose() }, 1500)
    } else {
      tradeMut.mutate({
        symbol: symUpper, shares: sharesForOrder,
        price: refPrice > 0 ? refPrice : undefined, notes,
      })
    }
  }

  const timingLabel = orderType === 'LIMIT_DAY' ? 'Day — expires 4:00 PM ET'
    : orderType === 'LIMIT_GTC' ? 'Good Till Cancelled'
    : 'Day (Market)'

  const actionColor  = action === 'BUY' ? G : R
  const actionBg     = action === 'BUY' ? 'var(--fd-card)' : 'var(--fd-card)'
  const actionBorder = action === 'BUY' ? 'var(--fd-card)' : 'var(--fd-card)'
  const B = 'var(--fd-accent)'

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--fd-page)', border: '1px solid var(--fd-hairline)',
        width: 440, maxHeight: '90vh', overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
        boxShadow: 'none',
      }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--fd-accent)' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: A,
              textTransform: 'uppercase', letterSpacing: '1px' }}>
              ◈ {step === 'review' ? 'Order Review' : 'Place Order'}
            </div>
            <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
              {port.name}
              <span style={{ marginLeft: 8, color: 'var(--fd-accent)', fontWeight: 500 }}>
                {fmtMoneyFull(port.current_cash)} available
              </span>
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: M,
              cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {step === 'review' ? (
          /* ── Review screen ──────────────────────────────────────────────── */
          <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: actionBg, border: `1px solid ${actionBorder}`,
              padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{
                  fontSize: 12, fontWeight: 500, color: actionColor,
                  padding: '3px 12px',
                  background: action === 'BUY' ? 'var(--fd-card)' : 'var(--fd-card)',
                  border: `1px solid ${actionBorder}`,
                }}>{action}</span>
                <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)' }}>
                  {sharesForOrder >= 1 ? sharesForOrder.toFixed(2) : sharesForOrder.toFixed(4)} shares of{' '}
                  <span style={{ color: actionColor }}>{symUpper}</span>
                </span>
              </div>

              {[
                { l: 'Order Type',  v: orderType === 'MARKET' ? 'Market' : orderType === 'LIMIT_DAY' ? 'Limit — Day' : 'Limit — GTC' },
                ...(orderType !== 'MARKET' ? [{ l: 'Limit Price', v: `$${priceNum.toFixed(2)} (${action === 'BUY' ? '≤ fill' : '≥ fill'})` }] : []),
                { l: 'Est. Amount', v: fmtMoneyFull(estAmount) },
                { l: 'Cash After',  v: fmtMoneyFull(action === 'BUY' ? port.current_cash - estAmount : port.current_cash + estAmount) },
                ...(notes ? [{ l: 'Notes', v: notes }] : []),
              ].map(row => (
                <div key={row.l} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12 }}>
                  <span style={{ color: M, fontSize: 12, textTransform: 'uppercase',
                    letterSpacing: '0.5px', minWidth: 88 }}>{row.l}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 500,
                    fontFamily: 'var(--font-mono)' }}>{row.v}</span>
                </div>
              ))}
            </div>

            {err && <div style={{ fontSize: 12, color: R }}> {err}</div>}
            {ok  && <div style={{ fontSize: 12, color: G }}>{ok}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn onClick={() => setStep('form')} disabled={tradeMut.isPending}>← Back</Btn>
              <Btn onClick={handlePlaceOrder} disabled={tradeMut.isPending}
                variant={action === 'BUY' ? 'green' : 'red'}>
                {tradeMut.isPending ? ' …' : `Place ${action} Order`}
              </Btn>
            </div>
          </div>

        ) : (
          /* ── Order form ─────────────────────────────────────────────────── */
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 11 }}>

            {/* Symbol + live price */}
            <div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 6 }}>
                <div>
                  <Label>Symbol</Label>
                  <input
                    value={symbol}
                    onChange={e => onSymbolChange(e.target.value)}
                    placeholder="e.g. AAPL"
                    style={{
                      marginTop: 3, background: 'var(--fd-card)',
                      color: 'var(--text)', border: '1px solid var(--fd-hairline)',
                      padding: '6px 10px', fontSize: 14, fontWeight: 500,
                      fontFamily: 'var(--font-mono)', width: 110,
                      textTransform: 'uppercase', outline: 'none', letterSpacing: '1px',
                    }}
                  />
                </div>
                {quoteLoading && (
                  <div style={{ fontSize: 12, color: M, fontStyle: 'italic', paddingBottom: 4 }}>
                     fetching price…
                  </div>
                )}
                {!quoteLoading && livePrice > 0 && (
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)',
                      fontFamily: 'var(--font-mono)' }}>
                      ${livePrice.toFixed(2)}
                      {fetchedPrice > 0 && localCachePrice === 0 && (
                        <span style={{ fontSize: 12, color: M, marginLeft: 5, fontWeight: 400 }}>live</span>
                      )}
                    </div>
                    {chgPct !== 0 && (
                      <div style={{ fontSize: 12, color: chgPct >= 0 ? G : R }}>
                        {chgPct >= 0 ? '+' : ''}{(chgPct * 100).toFixed(2)}%
                      </div>
                    )}
                  </div>
                )}
              </div>
              {holding && (
                <div style={{ fontSize: 12, color: M }}>
                  Held: <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                    {holding.total_shares.toFixed(4)} sh
                  </span>
                  {' · '}{fmtMoneyFull(holding.market_value)}
                </div>
              )}
            </div>

            {/* Swing intelligence toggle */}
            <div>
              <button onClick={() => setShowSwing(s => !s)} style={{
                background: showSwing ? 'var(--fd-card)' : 'none',
                border: `1px solid ${showSwing ? 'var(--fd-hairline)' : 'var(--border2)'}`,
                color: showSwing ? 'var(--fd-accent)' : M,
                cursor: 'pointer', padding: '3px 10px', fontSize: 12,
                fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span></span>
                <span>Swing Signal</span>
                <span style={{ fontSize: 12, fontWeight: 400, color: M }}>
                  {showSwing ? '▲ hide' : '▼ show analysis'}
                </span>
              </button>
              {showSwing && symUpper && (
                <div style={{ marginTop: 6 }}>
                  <SwingPanel
                    symbol={symUpper}
                    onUsePrice={(price, label) => {
                      setPriceInput(price.toFixed(2))
                      setPriceLocked(false)
                      if (orderType === 'MARKET') setOrderType('LIMIT_GTC')
                      setNotes(prev => prev ? prev : `Swing: ${label} $${price.toFixed(2)}`)
                    }}
                  />
                </div>
              )}
            </div>

            {/* Action */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label>Action</Label>
              <div style={{ display: 'flex', gap: 1 }}>
                {(['BUY', 'SELL'] as const).map(a => (
                  <button key={a} onClick={() => setAction(a)} style={{
                    flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.7px',
                    background: action === a
                      ? (a === 'BUY' ? 'var(--fd-card)' : 'var(--fd-card)')
                      : 'var(--fd-card)',
                    border: `1px solid ${action === a
                      ? (a === 'BUY' ? 'var(--fd-accent)' : 'var(--fd-negative)')
                      : 'var(--border2)'}`,
                    color: action === a ? (a === 'BUY' ? G : R) : M,
                    transition: 'all 0.1s',
                  }}>{a}</button>
                ))}
              </div>
            </div>

            {/* Unit */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label>Unit</Label>
              <div style={{ display: 'flex', gap: 1 }}>
                {(['SHARES', 'DOLLARS'] as const).map(u => (
                  <button key={u} onClick={() => {
                    if (u === unit) return
                    setUnit(u)
                    setErr('')
                    if (u === 'DOLLARS') {
                      // Seed a round dollar default: ~5× share price, capped to available cash
                      const defaultDollars = refPrice > 0
                        ? String(Math.min(Math.round(refPrice * 5 / 100) * 100 || 100, Math.floor(port.current_cash / 100) * 100 || 100))
                        : '100'
                      setQtyInput(defaultDollars)
                    } else {
                      setQtyInput(holding ? String(Math.floor(holding.total_shares)) || '1' : '1')
                    }
                  }} style={{
                    flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
                    background: unit === u ? 'var(--fd-card)' : 'var(--fd-card)',
                    border: `1px solid ${unit === u ? 'var(--fd-hairline)' : 'var(--border2)'}`,
                    color: unit === u ? B : M,
                    transition: 'all 0.1s',
                  }}>{u}</button>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Label>Quantity {unit === 'DOLLARS' ? '($)' : ''}</Label>
                <button title="Share calculator" onClick={() => setShowCalc(c => !c)}
                  style={{
                    background: showCalc ? 'var(--fd-card)' : 'none',
                    border: `1px solid ${showCalc ? 'var(--fd-accent)' : 'var(--border2)'}`,
                    color: showCalc ? 'var(--fd-lilac-ink)' : M,
                    cursor: 'pointer', padding: '2px 8px', fontSize: 13,
                  }}>⊞</button>
              </div>
              <div style={{ display: 'flex', gap: 0 }}>
                <button
                  onClick={() => setQtyInput(q => String(Math.max(0, (parseFloat(q) || 0) - (unit === 'DOLLARS' ? 100 : 1))))}
                  style={{ width: 34, background: 'var(--fd-card)',
                    border: '1px solid var(--fd-hairline)', borderRight: 'none',
                    color: M, cursor: 'pointer', fontSize: 16 }}>−</button>
                <input type="number" value={qtyInput} onChange={e => setQtyInput(e.target.value)}
                  style={{
                    flex: 1, textAlign: 'center', background: 'var(--fd-card)',
                    border: '1px solid var(--fd-hairline)', color: 'var(--text)',
                    fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)',
                    outline: 'none', padding: '7px 0',
                  }} />
                <button
                  onClick={() => setQtyInput(q => String((parseFloat(q) || 0) + (unit === 'DOLLARS' ? 100 : 1)))}
                  style={{ width: 34, background: 'var(--fd-card)',
                    border: '1px solid var(--fd-hairline)', borderLeft: 'none',
                    color: M, cursor: 'pointer', fontSize: 16 }}>+</button>
              </div>
              {unit === 'DOLLARS' && sharesForOrder > 0 && (
                <div style={{ fontSize: 12, color: M }}>
                  ≈ <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                    {sharesForOrder >= 1 ? sharesForOrder.toFixed(2) : sharesForOrder.toFixed(4)}
                  </span> shares @ ${refPrice.toFixed(2)}
                </div>
              )}
            </div>

            {/* Order Type */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label>Order Type</Label>
              <select value={orderType}
                onChange={e => {
                  const v = e.target.value as typeof orderType
                  setOrderType(v)
                  if (v === 'MARKET') setPriceLocked(false)
                }}
                style={{
                  background: 'var(--fd-page)', color: 'var(--text)',
                  border: `1px solid ${orderType === 'MARKET' ? 'var(--border2)' : A}`,
                  padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font-mono)',
                  cursor: 'pointer', outline: 'none',
                }}>
                <option value="MARKET">Market</option>
                <option value="LIMIT_DAY">Limit – Day</option>
                <option value="LIMIT_GTC">Limit – GTC</option>
              </select>
            </div>

            {/* Limit price (hidden for MARKET) */}
            {orderType !== 'MARKET' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Label>Price</Label>
                  <button title={priceLocked ? 'Locked to current — click to unlock' : 'Unlocked — click to reset to current'}
                    onClick={() => {
                      if (!priceLocked && livePrice > 0) setPriceInput(livePrice.toFixed(2))
                      setPriceLocked(p => !p)
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: priceLocked ? 'var(--fd-accent)' : M, padding: 0 }}>
                    {priceLocked ? '' : ''}
                  </button>
                  <span style={{ fontSize: 12, color: M }}>
                    {action === 'BUY' ? '≤ fill price' : '≥ fill price'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 0 }}>
                  <button disabled={priceLocked}
                    onClick={() => setPriceInput(p => Math.max(0.01, (parseFloat(p) || 0) - 0.01).toFixed(2))}
                    style={{ width: 34, background: 'var(--fd-card)',
                      border: '1px solid var(--fd-hairline)', borderRight: 'none',
                      color: priceLocked ? 'var(--fd-page)' : M,
                      cursor: priceLocked ? 'not-allowed' : 'pointer', fontSize: 16 }}>−</button>
                  <input type="number" step="0.01" value={priceInput}
                    readOnly={priceLocked}
                    onChange={e => !priceLocked && setPriceInput(e.target.value)}
                    style={{
                      flex: 1, textAlign: 'center',
                      background: priceLocked ? 'var(--fd-card)' : 'var(--fd-card)',
                      border: '1px solid var(--fd-hairline)',
                      color: priceLocked ? 'var(--fd-hairline)' : 'var(--text)',
                      fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)',
                      outline: 'none', padding: '7px 0',
                      cursor: priceLocked ? 'not-allowed' : 'text',
                    }} />
                  <button disabled={priceLocked}
                    onClick={() => setPriceInput(p => ((parseFloat(p) || 0) + 0.01).toFixed(2))}
                    style={{ width: 34, background: 'var(--fd-card)',
                      border: '1px solid var(--fd-hairline)', borderLeft: 'none',
                      color: priceLocked ? 'var(--fd-page)' : M,
                      cursor: priceLocked ? 'not-allowed' : 'pointer', fontSize: 16 }}>+</button>
                </div>
              </div>
            )}
            {orderType === 'MARKET' && livePrice > 0 && (
              <div style={{ fontSize: 12, color: M }}>
                Market price ≈ <span style={{ color: 'var(--text)', fontWeight: 500 }}>${livePrice.toFixed(2)}</span>
              </div>
            )}

            {/* Timing */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Label>Timing</Label>
              <div style={{ fontSize: 12, fontWeight: 500, color: M,
                padding: '6px 10px', background: 'var(--surface)',
                border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                {timingLabel}
              </div>
            </div>

            {/* Special instructions */}
            <div>
              <button onClick={() => setShowSpecial(s => !s)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: M, display: 'flex', alignItems: 'center', gap: 4,
                  padding: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <span style={{ fontSize: 12 }}>{showSpecial ? '▼' : '▶'}</span>
                Special Instructions
              </button>
              {showSpecial && (
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Notes / instructions..."
                  style={{
                    marginTop: 6, width: '100%', background: 'var(--bg)',
                    border: '1px solid var(--fd-hairline)', color: 'var(--text)',
                    fontSize: 12, padding: '6px 8px', resize: 'vertical', minHeight: 50,
                    fontFamily: 'var(--font-mono)', outline: 'none', boxSizing: 'border-box',
                  }} />
              )}
            </div>

            {/* Estimated amount */}
            <div style={{ padding: '10px 12px', background: 'var(--surface)',
              border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
                letterSpacing: '0.5px', marginBottom: 3 }}>Estimated Amount</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text)',
                fontFamily: 'var(--font-mono)' }}>
                {estAmount > 0 ? fmtMoneyFull(estAmount) : '—'}
              </div>
              {orderType !== 'MARKET' && estAmount > 0 && (
                <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
                  Based on limit price · does not include commission or fees
                </div>
              )}
              {estAmount > 0 && (
                <div style={{ fontSize: 12, marginTop: 3,
                  color: action === 'BUY' && port.current_cash < estAmount ? R : G }}>
                  Cash after: {fmtMoneyFull(
                    action === 'BUY' ? port.current_cash - estAmount : port.current_cash + estAmount
                  )}
                  {action === 'BUY' && port.current_cash < estAmount ? '  insufficient' : ''}
                </div>
              )}
            </div>

            {/* Share calculator */}
            {showCalc && (
              <div style={{ padding: '10px 12px',
                background: 'var(--fd-card)',
                border: '1px solid var(--fd-hairline)' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-lilac-ink)',
                  textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
                  ⊞ Share Calculator
                  {symUpper && <span style={{ fontWeight: 400, color: M }}> — {symUpper} @ ${calcRef.toFixed(2)}</span>}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
                      letterSpacing: '0.5px', marginBottom: 3 }}>$ to spend</div>
                    <input type="number" value={calcBudget}
                      onChange={e => { setCalcBudget(e.target.value); setCalcShares('') }}
                      placeholder="e.g. 5000"
                      style={{ width: 110, background: 'var(--fd-page)', color: 'var(--text)',
                        border: '1px solid var(--fd-hairline)', fontSize: 12,
                        padding: '4px 8px', fontFamily: 'var(--font-mono)', outline: 'none' }} />
                  </div>
                  <div style={{ fontSize: 12, color: M, paddingBottom: 6 }}>or</div>
                  <div>
                    <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
                      letterSpacing: '0.5px', marginBottom: 3 }}># shares</div>
                    <input type="number" value={calcShares}
                      onChange={e => { setCalcShares(e.target.value); setCalcBudget('') }}
                      placeholder="e.g. 25"
                      style={{ width: 90, background: 'var(--fd-page)', color: 'var(--text)',
                        border: '1px solid var(--fd-hairline)', fontSize: 12,
                        padding: '4px 8px', fontFamily: 'var(--font-mono)', outline: 'none' }} />
                  </div>
                </div>
                {(calcDerivedShares !== null || calcDerivedCost !== null) && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    {calcDerivedShares !== null && (
                      <div>
                        <span style={{ fontSize: 12, color: M, textTransform: 'uppercase' }}>You can buy </span>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--fd-lilac-ink)',
                          fontFamily: 'var(--font-mono)' }}>{calcDerivedShares.toLocaleString()}</span>
                        <span style={{ fontSize: 12, color: M }}> sh</span>
                      </div>
                    )}
                    {calcDerivedCost !== null && (
                      <div>
                        <span style={{ fontSize: 12, color: M, textTransform: 'uppercase' }}>Total </span>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--fd-ink)',
                          fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(calcDerivedCost)}</span>
                      </div>
                    )}
                    <div style={{ marginLeft: 'auto' }}>
                      <button
                        onClick={() => {
                          const s = calcShares || (calcDerivedShares !== null ? String(calcDerivedShares) : '')
                          if (s) { setQtyInput(s); setUnit('SHARES'); setShowCalc(false) }
                        }}
                        disabled={!calcDerivedShares && !calcShares}
                        style={{ fontSize: 12, padding: '3px 10px', cursor: 'pointer',
                          background: 'var(--fd-card)', color: G,
                          border: '1px solid var(--fd-hairline)', fontWeight: 500,
                          textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Use shares →
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 12, color: M }}>
                  Available cash: <span style={{ color: 'var(--fd-ink)' }}>{fmtMoneyFull(port.current_cash)}</span>
                </div>
              </div>
            )}

            {err && <div style={{ fontSize: 12, color: R }}> {err}</div>}
            {ok  && <div style={{ fontSize: 12, color: G }}>{ok}</div>}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end',
              paddingTop: 8, borderTop: '1px solid var(--border2)' }}>
              <Btn onClick={handleClear}>Clear</Btn>
              <Btn onClick={handleReview} variant={action === 'BUY' ? 'green' : 'red'}>
                Review →
              </Btn>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
