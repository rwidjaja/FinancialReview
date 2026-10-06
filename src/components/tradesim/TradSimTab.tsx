/**
 * TradSimTab — Trade Simulation
 * Multi-portfolio paper-trading environment, Snowball-Analytics style.
 *
 * Layout
 * ──────
 *  Left sidebar  : portfolio list → create / import / switch
 *  Main area     : sub-tabs Overview | Holdings | Trades | Income | Watchlist
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { DashboardData } from '../../types/dashboard'
import { fmtMoney, fmtMoneyFull, gainColor } from '../../utils/formatters'
import { PageHero, KpiStrip, Pill, Button, MonoNote, moneyUnit } from '../ui/primitives'
import { SubTabBtn, SubTabBar } from '../ui/SubTabBtn'
import type { Portfolio, SnapshotPoint, Transaction, Dividend } from './types'
import { BASE, GET, POST, DEL } from './constants'
import { fmtPct } from './shared'
import { useLimitOrders } from './useLimitOrders'
import { OverviewTab } from './OverviewTab'
import { HoldingsTab } from './HoldingsTab'
import { OrdersTab } from './OrdersTab'
import { TradesTab } from './TradesTab'
import { IncomeTab } from './IncomeTab'
import { SimPerformanceTab } from './SimPerformanceTab'
import { WatchlistTab } from './WatchlistTab'
import { SwingTradeTab } from './SwingTradeTab'
import { EditModal, CreateModal, ImportModal } from './PortfolioModals'
import { OrderModal } from './OrderModal'
import { WsSection } from '../workspace/WorkspaceContext'
import { useWorkspace, useWsSubTabs } from '../workspace/context'

// ── Main component ─────────────────────────────────────────────────────────────
interface Props {
  data: DashboardData
  onNavigateToResearch?: (symbol: string) => void  // kept for external callers; internally uses window.open
}

type SubTab = 'overview' | 'holdings' | 'orders' | 'trades' | 'income' | 'performance' | 'watchlist' | 'swing'

export function TradSimTab({ data }: Props) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [subTab,     setSubTab]     = useState<SubTab>('overview')
  const wsOn = useWorkspace().enabled   // the rail's view switcher replaces the sub-tab bar
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showEdit,   setShowEdit]   = useState(false)
  const [orderPrices,    setOrderPrices]    = useState<Record<string, number>>({})
  const [orderModalOpen, setOrderModalOpen] = useState(false)
  const [orderModalInit, setOrderModalInit] = useState<{
    symbol: string; action: 'BUY' | 'SELL'; sharesHeld: number
    limitPrice?: number; orderType?: 'MARKET' | 'LIMIT_DAY' | 'LIMIT_GTC'
    showSwing?: boolean
  }>({ symbol: '', action: 'BUY', sharesHeld: 0 })

  const openOrderModal = (symbol: string, action: 'BUY' | 'SELL', sharesHeld = 0) => {
    setOrderModalInit({ symbol, action, sharesHeld })
    setOrderModalOpen(true)
  }

  // Called from SwingTradeTab — opens modal with swing-specific pre-fills
  const openOrderModalFromSwing = (
    symbol: string, limitPrice: number, showSwing: boolean,
    action: 'BUY' | 'SELL' = 'BUY',
    sharesHeld = 0,
  ) => {
    setOrderModalInit({
      symbol, action, sharesHeld,
      limitPrice, orderType: 'LIMIT_GTC', showSwing,
    })
    setOrderModalOpen(true)
  }

  // ── List of all portfolios
  const { data: portfolios = [], isLoading: listLoading } = useQuery<Portfolio[]>({
    queryKey: ['sim-portfolios'],
    queryFn: () => GET(`${BASE}/portfolios`),
    staleTime: 30_000,
  })

  // Auto-select first if none selected
  const activeId = selectedId ?? portfolios[0]?.portfolio_id ?? null

  // ── Active portfolio detail
  const { data: port, isLoading: portLoading } = useQuery<Portfolio>({
    queryKey: ['sim-portfolio', activeId],
    queryFn: () => GET(`${BASE}/portfolios/${activeId}`),
    enabled: activeId != null,
    staleTime: 15_000,
  })

  // ── Transactions
  const { data: txns = [] } = useQuery<Transaction[]>({
    queryKey: ['sim-txns', activeId],
    queryFn: () => GET(`${BASE}/portfolios/${activeId}/transactions`),
    enabled: activeId != null && subTab === 'trades',
    staleTime: 15_000,
  })

  // ── Dividends (needed by both Income and Holdings tabs)
  const { data: divs = [] } = useQuery<Dividend[]>({
    queryKey: ['sim-divs', activeId],
    queryFn: () => GET(`${BASE}/portfolios/${activeId}/dividends`),
    enabled: activeId != null && (subTab === 'income' || subTab === 'holdings'),
    staleTime: 15_000,
  })

  // ── History (needed by overview + performance tabs)
  const { data: history = [] } = useQuery<SnapshotPoint[]>({
    queryKey: ['sim-history', activeId],
    queryFn: () => GET(`${BASE}/portfolios/${activeId}/history`),
    enabled: activeId != null && (subTab === 'overview' || subTab === 'performance'),
    staleTime: 30_000,
  })

  const invalidate = useCallback(() => {
    // Force immediate refetch for the two queries that drive visible UI (positions + cash).
    // Using refetchQueries rather than invalidateQueries so React Query doesn't serve
    // a stale cache hit while the background fetch is still in flight.
    // The 150 ms delay gives the server's WAL checkpoint time to flush before the GET fires.
    setTimeout(() => {
      qc.refetchQueries({ queryKey: ['sim-portfolio', activeId] })
      qc.refetchQueries({ queryKey: ['sim-portfolios'] })
    }, 150)
    qc.invalidateQueries({ queryKey: ['sim-txns', activeId] })
    qc.invalidateQueries({ queryKey: ['sim-divs', activeId] })
    qc.invalidateQueries({ queryKey: ['sim-history', activeId] })
  }, [qc, activeId])

  // ── Limit orders
  const limitOrders = useLimitOrders()

  const limitExecMut = useMutation({
    mutationFn: ({ action, body }: { action: 'buy' | 'sell'; body: Record<string, unknown> }) =>
      POST(`${BASE}/portfolios/${activeId}/${action}`, body),
    onSuccess: () => invalidate(),
  })

  // Tracks order IDs that have already been dispatched this session.
  // A ref (not state) so writes are synchronous — preventing a second fire even
  // if the useEffect re-runs before React commits the 'FILLED' status update.
  const dispatchedOrders = useRef(new Set<string>())

  // Monitor prices and auto-fill limit orders whenever portfolio data refreshes.
  // priceMap priority: holdings (most accurate sim price) → watchlist → live snapshot.
  // This covers BUY orders on symbols not yet owned (not in holdings) and symbols
  // only tracked via the watchlist or the real-portfolio snapshot feed.
  useEffect(() => {
    if (!activeId) return
    const priceMap: Record<string, number> = {}

    // 1. Live snapshot prices (lowest priority — always present)
    Object.entries(data.snapshots ?? {}).forEach(([sym, snap]) => {
      const p = snap?.price ?? snap?.nav
      if (p) priceMap[sym] = p
    })

    // 2. Open limit-order prices fetched on last refresh (symbols not in holdings/watchlist)
    Object.entries(orderPrices).forEach(([sym, p]) => { if (p) priceMap[sym] = p })

    // 3. Watchlist prices (override order prices — refreshed by user)
    port?.watchlist?.forEach(w => { if (w.price != null) priceMap[w.symbol] = w.price })

    // 4. Holdings prices (highest priority — most accurate sim cost basis)
    port?.holdings?.forEach(h => { priceMap[h.symbol] = h.current_price })

    const now = new Date()

    limitOrders.orders
      .filter(o => o.status === 'OPEN' && o.portfolioId === activeId && !dispatchedOrders.current.has(o.id))
      .forEach(o => {
        // Expire LIMIT_DAY orders
        if (o.orderType === 'LIMIT_DAY' && o.expiresAt && new Date(o.expiresAt) < now) {
          limitOrders.updateOrder(o.id, { status: 'EXPIRED' })
          return
        }
        const px = priceMap[o.symbol]
        if (px == null) return
        const hit = o.action === 'BUY' ? px <= o.limitPrice : px >= o.limitPrice
        if (hit) {
          // Mark as dispatched immediately (synchronous) before any async work,
          // so re-runs of this effect can't fire the same order a second time.
          dispatchedOrders.current.add(o.id)
          limitOrders.updateOrder(o.id, { status: 'FILLED', filledAt: now.toISOString(), filledPrice: px })
          limitExecMut.mutate({
            action: o.action.toLowerCase() as 'buy' | 'sell',
            body: { symbol: o.symbol, shares: o.shares, price: px, notes: `Auto-filled limit order @ ${px}` },
          })
        }
      })
  // port?.holdings and port?.watchlist as deps so the check re-runs after any price refresh.
  // limitOrders.orders so a freshly placed order is checked immediately without waiting for a price update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port?.holdings, port?.watchlist, limitOrders.orders, activeId, orderPrices])

  const refreshMut = useMutation({
    mutationFn: () => {
      // Collect symbols from open limit orders that are not already tracked
      // via holdings or watchlist — the server can't know these since they
      // live in localStorage, so we pass them explicitly.
      const tracked = new Set([
        ...(port?.holdings  ?? []).map(h => h.symbol),
        ...(port?.watchlist ?? []).map(w => w.symbol),
      ])
      const extraSymbols = [...new Set(
        limitOrders.orders
          .filter(o => o.portfolioId === activeId && o.status === 'OPEN'
                    && !tracked.has(o.symbol))
          .map(o => o.symbol)
      )]
      return POST<{ order_prices?: Record<string, number> }>(
        `${BASE}/portfolios/${activeId}/refresh-prices`,
        extraSymbols.length ? { extra_symbols: extraSymbols } : {},
      )
    },
    onSuccess: (data) => {
      // Merge order-symbol prices into state so the priceMap effect picks them up
      if (data?.order_prices && Object.keys(data.order_prices).length) {
        setOrderPrices(prev => ({ ...prev, ...data.order_prices }))
      }
      invalidate()
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => DEL(`${BASE}/portfolios/${id}`),
    onSuccess: () => {
      setSelectedId(null)
      qc.invalidateQueries({ queryKey: ['sim-portfolios'] })
    },
  })

  // ── Sub-tab bar
  const openOrderCount = limitOrders.orders.filter(
    o => o.portfolioId === activeId && o.status === 'OPEN'
  ).length
  // The rail's view switcher shows the open-order count the sub-tab bar carries.
  useWsSubTabs(subTab, setSubTab as (s: string) => void, { orders: openOrderCount || undefined })

  const TABS: { id: SubTab; label: string; badge?: number }[] = [
    { id: 'overview',     label: 'Overview'     },
    { id: 'holdings',     label: 'Holdings'     },
    { id: 'orders',       label: 'Orders', badge: openOrderCount || undefined },
    { id: 'trades',       label: 'Transaction History' },
    { id: 'income',       label: 'Income'       },
    { id: 'performance',  label: 'Performance'  },
    { id: 'watchlist',    label: 'Watchlist'    },
    { id: 'swing',        label: ' Swing Trade' },
  ]

  const subNames: Record<SubTab, string> = {
    overview: 'Overview', holdings: 'Holdings', orders: 'Orders', trades: 'History',
    income: 'Income', performance: 'Performance', watchlist: 'Watchlist', swing: 'Swing trade',
  }
  const ret = port?.total_return_pct ?? 0
  const ghost = { height: 32, padding: '0 14px', border: '1px solid var(--fd-hairline)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase' as const, cursor: 'pointer', color: 'var(--fd-ink)' }

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        eyebrow="Trade sim · paper trading · not real money"
        {...(port
          ? { before: `${port.name}, ${ret >= 0 ? 'up' : 'down'} `, em: `${Math.abs(ret).toFixed(1)}%`, after: '.' }
          : { before: 'Pick a ', em: 'book', after: '.' })}
        lead={port?.description ? <span style={{ color: 'var(--fd-muted)' }}>{port.description}</span> : listLoading ? <span style={{ color: 'var(--fd-muted)' }}>Loading portfolios…</span> : portfolios.length === 0 ? <span style={{ color: 'var(--fd-muted)' }}>No portfolios yet — create one to start paper trading.</span> : undefined}
        aside={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
              {portfolios.map(pp => (
                <Pill key={pp.portfolio_id} v={`${pp.is_default === 1 ? '★ ' : ''}${pp.name}`} k={`${pp.total_return >= 0 ? '+' : '−'}${Math.abs(pp.total_return_pct).toFixed(1)}%`}
                  active={pp.portfolio_id === activeId} onClick={() => { setSelectedId(pp.portfolio_id); setSubTab('overview') }} />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
              <button className="fd-ghost" style={ghost} onClick={() => setShowCreate(true)}>+ New book</button>
              {port && <button className="fd-ghost" style={ghost} onClick={() => setShowEdit(true)}>Edit</button>}
              {port && <button className="fd-ghost" style={ghost} onClick={() => setShowImport(true)}>Import Schwab</button>}
              {port && <button className="fd-ghost" style={ghost} onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>{refreshMut.isPending ? 'Fetching…' : 'Refresh prices'}</button>}
              {port && <button className="fd-ghost" style={{ ...ghost, color: 'var(--fd-negative)' }} onClick={() => { if (confirm(`Delete "${port.name}"?`)) deleteMut.mutate(port.portfolio_id) }}>Delete</button>}
              {port && <Button variant="primary" size="sm" onClick={() => openOrderModal('', 'BUY')}>New order</Button>}
            </div>
          </div>
        }
      />

      {port && (
        <KpiStrip size={36} items={[
          { label: 'Total value', value: moneyUnit(port.total_value).value, unit: moneyUnit(port.total_value).unit, sub: `Invested ${fmtMoneyFull(port.holdings_value)}` },
          { label: 'Cash', value: moneyUnit(port.current_cash).value, unit: moneyUnit(port.current_cash).unit, sub: `${port.total_value > 0 ? ((port.current_cash / port.total_value) * 100).toFixed(1) : '0.0'}% of the book` },
          { label: 'Total return', value: `${port.total_return >= 0 ? '+' : '−'}${fmtMoney(Math.abs(port.total_return))}`, valueColor: gainColor(port.total_return), sub: `${fmtPct(port.total_return_pct)} since inception` },
          { label: 'Unrealised', value: port.unrealized_pnl != null ? `${port.unrealized_pnl >= 0 ? '+' : '−'}${fmtMoney(Math.abs(port.unrealized_pnl))}` : '—', valueColor: port.unrealized_pnl != null ? gainColor(port.unrealized_pnl) : undefined, sub: 'Open positions' },
          { label: 'Income YTD', value: moneyUnit(port.ytd_dividends ?? 0).value, unit: moneyUnit(port.ytd_dividends ?? 0).unit, sub: 'Dividends and distributions' },
        ]} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 40, paddingTop: 40 }}>
        {!activeId ? (
          <MonoNote>Select or create a portfolio.</MonoNote>
        ) : portLoading ? (
          <MonoNote>Loading…</MonoNote>
        ) : port ? (
          <>
            {!wsOn && (
            <nav style={{ borderTop: '2px solid var(--fd-rule)', paddingTop: 16 }}>
              <SubTabBar>
                {TABS.map((t, i) => (
                  <SubTabBtn key={t.id} index={i + 1} active={subTab === t.id} onClick={() => setSubTab(t.id)}
                    label={`${subNames[t.id]}${t.badge ? ` · ${t.badge}` : ''}`} />
                ))}
              </SubTabBar>
            </nav>
            )}

            {/* Sub-tab content */}
            <div>
              {subTab === 'overview'    && <OverviewTab    port={port} history={history} portfolioId={activeId} />}
              {subTab === 'holdings'    && <HoldingsTab    port={port} activeId={activeId} onMutate={invalidate} divs={divs}
                                            onLimitOrder={limitOrders.addOrder}
                                            onOpenOrder={openOrderModal} />}
              {subTab === 'orders'      && <WsSection id="ts_orders" value={openOrderCount > 0 ? `${openOrderCount} open` : undefined} status={openOrderCount > 0 ? 'watch' : undefined}><OrdersTab
                                            orders={limitOrders.orders.filter(o => o.portfolioId === activeId)}
                                            onCancel={limitOrders.cancelOrder}
                                            priceMap={(() => {
                                              const m: Record<string, number> = {}
                                              Object.entries(data.snapshots ?? {}).forEach(([s, snap]) => { const p = snap?.price ?? snap?.nav; if (p) m[s] = p })
                                              Object.entries(orderPrices).forEach(([s, p]) => { if (p) m[s] = p })
                                              port?.watchlist?.forEach(w => { if (w.price != null) m[w.symbol] = w.price })
                                              port?.holdings?.forEach(h => { m[h.symbol] = h.current_price })
                                              return m
                                            })()}
                                          /></WsSection>}
              {subTab === 'trades'      && <WsSection id="ts_trades" value={`${txns.length} trades`}><TradesTab      txns={txns} activeId={activeId} onMutate={invalidate} port={port} /></WsSection>}
              {subTab === 'income'      && <IncomeTab      divs={divs} activeId={activeId} port={port} onMutate={invalidate} />}
              {subTab === 'performance' && <SimPerformanceTab port={port} history={history} />}
              {subTab === 'watchlist'   && <WsSection id="ts_watchlist" value={`${port.watchlist?.length ?? 0} symbols`}><WatchlistTab   port={port} activeId={activeId} onMutate={invalidate} /></WsSection>}
              {subTab === 'swing'       && <SwingTradeTab
                                            port={port}
                                            regime={data.portfolio_intel?.market_regime ?? 'CONSOLIDATION'}
                                            vix={data.vix_current ?? 0}
                                            onOpenOrderModal={openOrderModalFromSwing}
                                          />}
            </div>
          </>
        ) : null}
      </div>

      {/* ── Order modal ──────────────────────────────────────────────────── */}
      {orderModalOpen && port && (
        <OrderModal
          isOpen={orderModalOpen}
          onClose={() => setOrderModalOpen(false)}
          port={port}
          activeId={port.portfolio_id}
          initialSymbol={orderModalInit.symbol}
          initialAction={orderModalInit.action}
          initialSharesHeld={orderModalInit.sharesHeld}
          initialLimitPrice={orderModalInit.limitPrice}
          initialOrderType={orderModalInit.orderType}
          showSwingPanel={orderModalInit.showSwing}
          onMutate={invalidate}
          onLimitOrder={limitOrders.addOrder}
          snapshots={data.snapshots}
        />
      )}

      {/* ── Create portfolio modal ────────────────────────────────────────── */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreate={() => {
            setShowCreate(false)
            qc.invalidateQueries({ queryKey: ['sim-portfolios'] })
          }}
        />
      )}

      {/* ── Edit portfolio modal ──────────────────────────────────────────── */}
      {showEdit && port && (
        <EditModal
          port={port}
          onClose={() => setShowEdit(false)}
          onSave={() => {
            setShowEdit(false)
            qc.invalidateQueries({ queryKey: ['sim-portfolios'] })
            invalidate()
          }}
        />
      )}

      {/* ── Import Schwab modal ───────────────────────────────────────────── */}
      {showImport && activeId && (
        <ImportModal
          portfolioId={activeId}
          onClose={() => setShowImport(false)}
          onImport={() => { setShowImport(false); invalidate() }}
        />
      )}
    </div>
  )
}

