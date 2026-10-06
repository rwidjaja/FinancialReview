import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppHeader, type TabId, resolveLegacyTabId } from './components/layout/AppHeader'
import { ViewModeContext, type ViewMode } from './components/ui/ModeToggle'
import { PaletteBar, mono } from './components/ui/primitives'
import { AlertNotification } from './components/alerts/AlertNotification'
import { AdvancedWorkspace } from './components/workspace/AdvancedWorkspace'
import { FindPalette } from './components/workspace/FindPalette'
import type { AdvLayout } from './components/workspace/context'

// Tab components are lazy-loaded so each tab becomes its own chunk instead of
// shipping the entire app in one bundle.
const OverviewTab       = lazy(() => import('./components/overview/OverviewTab').then(m => ({ default: m.OverviewTab })))
const RoadmapTab        = lazy(() => import('./components/roadmap/RoadmapTab').then(m => ({ default: m.RoadmapTab })))
const PortfolioTab      = lazy(() => import('./components/portfolio/PortfolioTab').then(m => ({ default: m.PortfolioTab })))
const ReturnsTab        = lazy(() => import('./components/returns/ReturnsTab').then(m => ({ default: m.ReturnsTab })))
const TaxTab            = lazy(() => import('./components/tax/TaxTab').then(m => ({ default: m.TaxTab })))
const CashFlowTab       = lazy(() => import('./components/cashflow/CashFlowTab').then(m => ({ default: m.CashFlowTab })))
const ResearchTab       = lazy(() => import('./components/research/ResearchTab').then(m => ({ default: m.ResearchTab })))
const ForecastTab       = lazy(() => import('./components/forecast/ForecastTab').then(m => ({ default: m.ForecastTab })))
const RiskTab           = lazy(() => import('./components/risk/RiskTab').then(m => ({ default: m.RiskTab })))
const SimulateTab       = lazy(() => import('./components/simulate/SimulateTab').then(m => ({ default: m.SimulateTab })))
const DrawdownTab       = lazy(() => import('./components/drawdown/DrawdownTab').then(m => ({ default: m.DrawdownTab })))
const TradSimTab        = lazy(() => import('./components/tradesim/TradSimTab').then(m => ({ default: m.TradSimTab })))
const AITab             = lazy(() => import('./components/ai/AITab').then(m => ({ default: m.AITab })))
const SettingsTab       = lazy(() => import('./components/settings/SettingsTab').then(m => ({ default: m.SettingsTab })))
const BalanceHistoryTab = lazy(() => import('./components/balancehistory/BalanceHistoryTab').then(m => ({ default: m.BalanceHistoryTab })))

/** Minimal centered fallback shown while a lazy tab chunk loads. */
function TabLoadingFallback() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: 256, ...mono, color: 'var(--fd-muted)',
    }}>
      Loading…
    </div>
  )
}
import { useDashboardData, useRefresh, useServerStatus, usePrefetchPerformance, activeTabRef } from './hooks/useDashboardData'
import { DrawdownPlanProvider } from './context/DrawdownPlanContext'
import { useAlerts } from './hooks/useAlerts'
import type { ServerStatus, PriceAlert } from './types/dashboard'

const queryClient = new QueryClient()

const TAB_STORAGE_KEY = 'dashboard_active_tab'

// ── Progress bar shown during initial load or manual refresh ──────────────────
function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ width: '100%', height: 3, background: 'var(--fd-hairline)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--fd-accent)', transition: 'width 240ms var(--ease)' }} />
    </div>
  )
}

function LoadingScreen({ status }: { status: ServerStatus | undefined }) {
  const pct     = status?.pct     ?? 0
  const step    = status?.step    ?? 'Connecting to server…'
  const elapsed = status?.elapsed ?? 0

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '60vh', gap: 20, padding: '0 32px',
    }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 44, lineHeight: 1 }}>Loading <em>your</em> plan.</span>
      <span style={{ ...mono, color: 'var(--fd-muted)', minHeight: 16 }}>{step}</span>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <ProgressBar pct={pct} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, ...mono, color: 'var(--fd-muted)' }}>
          <span>{pct}%</span>
          {elapsed > 0 && <span>{elapsed}s</span>}
        </div>
      </div>
    </div>
  )
}

/** Thin progress bar + step label shown under the header during a manual refresh. */
function RefreshBanner({ status }: { status: ServerStatus | undefined }) {
  // Show immediately even before the first /api/status response arrives
  const pct  = status?.pct     ?? 2
  const step = status?.step    ?? 'Refreshing…'
  const elapsed = status?.elapsed ?? 0
  return (
    <div style={{ padding: '10px 48px 8px', borderBottom: '1px solid var(--fd-hairline)' }}>
      <ProgressBar pct={pct} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, ...mono, color: 'var(--fd-muted)' }}>
        <span>{step}</span>
        <span>{pct}%{elapsed > 0 ? ` · ${elapsed}s` : ''}</span>
      </div>
    </div>
  )
}

// Play a short ascending double-beep via Web Audio API when an alert fires.
// count > 1 adds an extra pulse so the user knows multiple alerts triggered.
function playAlertBeep(count = 1) {
  try {
    const ctx = new AudioContext()
    const pulses = Math.min(count, 3)
    for (let i = 0; i < pulses; i++) {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = 880 + i * 110          // ascending pitch per pulse
      const t0 = ctx.currentTime + i * 0.22
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(0.25, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18)
      osc.start(t0)
      osc.stop(t0 + 0.18)
    }
  } catch { /* AudioContext unavailable (e.g. server-side render) */ }
}

function Dashboard() {
  // Check for ?research=SYMBOL query param (opened from TradSim symbol link)
  const _urlResearch = new URLSearchParams(window.location.search).get('research')?.toUpperCase() || undefined

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (_urlResearch) return 'research'
    const stored = localStorage.getItem(TAB_STORAGE_KEY) ?? 'overview'
    return resolveLegacyTabId(stored)
  })
  const [researchSymbol, setResearchSymbol] = useState<string | undefined>(_urlResearch)

  // Global Simple/Advanced mode and light/dark ground (DESIGN_GUIDE v4)
  const [mode, setModeState] = useState<ViewMode>(() => {
    try { return localStorage.getItem('viewMode:global') === 'advanced' ? 'advanced' : 'simple' } catch { return 'simple' }
  })
  const setMode = (m: ViewMode) => {
    setModeState(m)
    try { localStorage.setItem('viewMode:global', m) } catch { /* private mode */ }
  }
  const [ground, setGround] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('ground') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.dataset.ground = ground
    try { localStorage.setItem('ground', ground) } catch { /* private mode */ }
  }, [ground])
  const mainRef = useRef<HTMLElement>(null)

  // Advanced workspace (design_handoff_advanced_workspace): focus/scroll
  // layout, last section per tab, and the global Find palette.
  const [advLayout, setAdvLayoutState] = useState<AdvLayout>(() => {
    try { return localStorage.getItem('advLayout') === 'scroll' ? 'scroll' : 'focus' } catch { return 'focus' }
  })
  const setAdvLayout = (l: AdvLayout) => {
    setAdvLayoutState(l)
    try { localStorage.setItem('advLayout', l) } catch { /* private mode */ }
  }
  const [advSections, setAdvSections] = useState<Partial<Record<TabId, string>>>({})
  const advSectionFor = (tab: TabId): string | null => {
    if (advSections[tab]) return advSections[tab]!
    try { return localStorage.getItem(`advSection:${tab}`) } catch { return null }
  }
  const setAdvSection = useCallback((tab: TabId, id: string) => {
    setAdvSections(prev => (prev[tab] === id ? prev : { ...prev, [tab]: id }))
    try { localStorage.setItem(`advSection:${tab}`, id) } catch { /* private mode */ }
  }, [])
  const onAdvActive = useCallback((id: string) => setAdvSection(activeTab, id), [activeTab, setAdvSection])
  const [find, setFind] = useState<{ q: string } | null>(null)
  const openFind = useCallback((q?: string) => setFind({ q: q ?? '' }), [])

  // ⌘K / Ctrl+K anywhere, "/" when not typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setFind(f => (f ? null : { q: '' })) }
      else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setFind({ q: '' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sync the auto-refresh ref with the tab restored from localStorage/URL —
  // otherwise it stays at its 'summary' default until the first manual tab change.
  useEffect(() => {
    activeTabRef.current = activeTab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { data, isLoading, error } = useDashboardData()
  const { data: alertsData } = useAlerts()
  usePrefetchPerformance()
  const refresh = useRefresh()
  const [isRefreshing, setIsRefreshing] = useState(false)

  // On-demand tabs (research, ai, simulate) must not blank during a background
  // backend refresh, but SHOULD reset when the user manually hits Refresh.
  const lastDataRef = useRef(data)
  if (data) lastDataRef.current = data
  const stableData = data ?? lastDataRef.current
  const [shownAlerts, setShownAlerts] = useState<PriceAlert[]>([])

  // Track which alert IDs have already been surfaced this session so we never
  // re-beep the same alert on auto-refresh (but DO re-surface after a page reload).
  const seenAlertIds = useRef<Set<string>>(new Set())

  // Unified alert detection — three sources, merged and deduplicated:
  //   1. data.triggered_alerts  — server re-evaluates on every /api/data response
  //   2. alertsData triggered=true — /api/alerts polled every 60s, catches triggers
  //      even when the dashboard data hasn't refreshed yet
  //   3. client-side price check — safety net using snapshot prices
  // Runs whenever dashboard data OR alert list changes (alertsData polls every 60s).
  useEffect(() => {
    if (!data && !alertsData) return

    const seen = (id: string) => seenAlertIds.current.has(id)
    const candidates = new Map<string, PriceAlert>()

    // Source 1: backend-flagged via triggered_alerts in dashboard response
    for (const a of data?.triggered_alerts ?? []) {
      if (!seen(a.id)) candidates.set(a.id, a)
    }

    // Source 2: alerts the server has already marked triggered=true in the alerts list
    // (picked up by the 60s /api/alerts poll even between dashboard refreshes)
    for (const a of alertsData ?? []) {
      if (!a.active || !a.triggered) continue
      if (!seen(a.id) && !candidates.has(a.id)) candidates.set(a.id, a)
    }

    // Source 3: client-side price check against current snapshot prices
    if (data) {
      for (const a of alertsData ?? []) {
        if (!a.active || seen(a.id) || candidates.has(a.id)) continue
        const snap = data.snapshots[a.symbol]
        const price = snap?.price || snap?.nav
        if (!price) continue
        let hit: boolean
        if (a.mode === 'price') {
          hit = a.direction === 'above' ? price >= a.threshold : price <= a.threshold
        } else {
          const pct = a.base_price ? ((price - a.base_price) / a.base_price) * 100 : 0
          hit = a.direction === 'above' ? pct >= a.threshold : pct <= a.threshold
        }
        if (hit) candidates.set(a.id, a)
      }
    }

    if (candidates.size === 0) return

    candidates.forEach((_, id) => seenAlertIds.current.add(id))
    const newAlerts = Array.from(candidates.values())
    setShownAlerts(prev => {
      const existingIds = new Set(prev.map(p => p.id))
      const toAdd = newAlerts.filter(a => !existingIds.has(a.id))
      return toAdd.length ? [...prev, ...toAdd] : prev
    })
    playAlertBeep(newAlerts.length)
  }, [data, alertsData])

  // Server is loading (503) when: no data, and either isLoading or query is in retry
  const serverLoading = !data && (isLoading || (error as any)?.isServerLoading === true)
  // Poll /api/status when server is loading OR a manual refresh is running
  const pollStatus = serverLoading || isRefreshing
  const { data: serverStatus } = useServerStatus(pollStatus)

  function handleTabChange(tab: TabId) {
    activeTabRef.current = tab
    setActiveTab(tab)
    localStorage.setItem(TAB_STORAGE_KEY, tab)
    mainRef.current?.scrollTo({ top: 0 })
  }

  function handleFindPick(tab: TabId, sectionId: string, adv: boolean) {
    setAdvSection(tab, sectionId)
    if (tab !== activeTab) handleTabChange(tab)
    // Simple mode has no pager: advanced-only sections need Advanced; others
    // are scrolled to in place once the tab has rendered.
    if (mode === 'simple' && adv) setMode('advanced')
    else if (mode === 'simple') {
      let tries = 0
      const tryScroll = () => {
        const el = document.querySelector(`[data-ws-id="${sectionId}"]`)?.firstElementChild as HTMLElement | null | undefined
        const sc = mainRef.current
        if (el && sc) sc.scrollBy({ top: el.getBoundingClientRect().top - 140 })
        else if (tries++ < 20) setTimeout(tryScroll, 100)   // lazy tab chunk still loading
      }
      requestAnimationFrame(tryScroll)
    }
  }

  function handleNavigateToResearch(symbol: string) {
    setResearchSymbol(symbol)
    handleTabChange('research')
  }

  function handleMuteAlert(id: string) {
    // Session-level snooze: hide from popup but keep alert active on backend.
    // seenAlertIds prevents it from re-surfacing until the next page load.
    seenAlertIds.current.add(id)
    setShownAlerts(prev => {
      const remaining = prev.filter(a => a.id !== id)
      if (remaining.length === 0) return []
      return remaining
    })
  }

  async function handleRefresh() {
    setIsRefreshing(true)
    try { await refresh() } finally { setIsRefreshing(false) }
  }

  // Hard connection error (non-503, non-loading)
  const isHardError = !!error && !data && !serverLoading

  return (
    <ViewModeContext.Provider value={[mode, setMode]}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <main ref={mainRef} style={{ flex: 1, overflowY: 'auto' }}>
      <AppHeader
        active={activeTab} onTab={handleTabChange}
        mode={mode} onMode={setMode}
        ground={ground} onGround={() => setGround(g => (g === 'dark' ? 'light' : 'dark'))}
        updatedTitle={data?.timestamp ? `Data updated ${data.timestamp}` : undefined}
        schwabLive={data?.schwab_status ? data.schwab_status === 'live' : undefined}
        onRefresh={handleRefresh} isRefreshing={isRefreshing}
        onFind={() => openFind()}
      />

      {find && (
        <FindPalette initialQuery={find.q} currentTab={activeTab} onPick={handleFindPick} onClose={() => setFind(null)} />
      )}

      {/* Refresh progress banner — only during manual refresh, not initial load */}
      {isRefreshing && <RefreshBanner status={serverStatus} />}

      {/* Global price alert notification — floats over any tab */}
      {shownAlerts.length > 0 && (
        <AlertNotification
          alerts={shownAlerts}
          onAllDismissed={() => setShownAlerts([])}
          onMute={handleMuteAlert}
        />
      )}

      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '0 48px', minHeight: 'calc(100% - 200px)' }}>
        {/* Initial loading screen with progress */}
        {serverLoading && <LoadingScreen status={serverStatus} />}

        {/* Hard connection failure */}
        {isHardError && (
          <div style={{ margin: '56px 0', display: 'grid', gridTemplateColumns: '8px 1fr', background: 'var(--fd-card)' }}>
            <div style={{ background: 'var(--fd-alert)' }} />
            <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ ...mono }}>Unable to connect to backend</span>
              <span style={{ fontSize: 14, color: 'var(--fd-muted)' }}>
                Make sure the Python dashboard server is running on port 8501.
              </span>
              <pre style={{ ...mono, textTransform: 'none', color: 'var(--fd-ink)' }}>cd server && python server.py</pre>
            </div>
          </div>
        )}

        {(() => {
          const tabs = (
          <Suspense fallback={<TabLoadingFallback />}>
            {activeTab === 'settings' && <SettingsTab onRefresh={handleRefresh} />}
            {activeTab === 'balance_history' && data && <BalanceHistoryTab data={data} />}
  
            {data && activeTab !== 'settings' && activeTab !== 'balance_history' && (
              <DrawdownPlanProvider data={data}>
                {activeTab === 'overview'   && <OverviewTab  data={data} onNavigate={handleTabChange} />}
                {activeTab === 'roadmap'    && <RoadmapTab   data={data} onNavigate={handleTabChange} />}
                {activeTab === 'portfolio'  && <PortfolioTab data={data} />}
                {activeTab === 'returns'    && <ReturnsTab   data={data} />}
                {activeTab === 'tax'        && <TaxTab       data={data} />}
                {activeTab === 'cashflow'   && <CashFlowTab  data={data} />}
                {activeTab === 'research'   && stableData && <ResearchTab  data={stableData} initialSymbol={researchSymbol} />}
                {activeTab === 'forecast'   && <ForecastTab  data={data} />}
                {activeTab === 'risk'       && <RiskTab      data={data} />}
                {activeTab === 'simulate'   && stableData && <SimulateTab  data={stableData} />}
                {activeTab === 'drawdown'   && <DrawdownTab  data={data} />}
                {activeTab === 'trade_sim'  && <TradSimTab   data={data} onNavigateToResearch={handleNavigateToResearch} />}
                {activeTab === 'ai'         && stableData && <AITab        data={stableData} onNavigate={handleTabChange} onNavigateToResearch={handleNavigateToResearch} />}
              </DrawdownPlanProvider>
            )}
          </Suspense>
          )
          return mode === 'advanced' && (data || activeTab === 'settings') ? (
            <AdvancedWorkspace
              key={activeTab} tab={activeTab}
              requestedId={advSectionFor(activeTab)} onActive={onAdvActive}
              layout={advLayout} onLayout={setAdvLayout} scroller={mainRef} onOpenFind={openFind}
            >
              {tabs}
            </AdvancedWorkspace>
          ) : tabs
        })()}
      </div>

      <footer style={{ maxWidth: 1440, margin: '0 auto', padding: '0 48px' }}>
        <div style={{ borderTop: '1px solid var(--fd-hairline)', padding: '20px 0 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <PaletteBar />
        <span style={{ ...mono, color: 'var(--fd-muted)' }}>Schwab · yfinance · local engine</span>
        </div>
      </footer>
      </main>
    </div>
    </ViewModeContext.Provider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  )
}
