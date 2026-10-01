import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DashboardData, WellnessData, PerformanceData, ServerStatus, MarketStatus, BalanceSnapshot } from '../types/dashboard'

/**
 * Mutable ref that App.tsx writes on every tab change.
 * refetchInterval reads it to skip auto-refresh on static tabs.
 */
export const activeTabRef = { current: 'summary' as string }

/** Tabs that display point-in-time data — auto-refresh would wipe in-progress work. */
const STATIC_TABS = new Set(['research', 'forecast', 'simulate', 'trade_sim', 'ai', 'settings'])

/**
 * Mirrors the latest useMarketStatus() fetch so the plain isMarketOpen()
 * function below (used inside a refetchInterval callback, not a hook) can
 * read it synchronously. Null until the first /api/market_status fetch resolves.
 */
export const marketStatusRef = { current: null as MarketStatus | null }

/** Calendar-aware (holidays, early closes) via /api/market_status; falls back
 *  to a naive Mon–Fri 9:30–16:00 ET check only before the first fetch resolves. */
function isMarketOpen(): boolean {
  if (marketStatusRef.current) return marketStatusRef.current.is_open
  const now = new Date()
  const day = now.getDay() // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const mins = et.getHours() * 60 + et.getMinutes()
  return mins >= 9 * 60 + 30 && mins < 16 * 60
}

/** Error subtype that carries server-loading state so we can retry gracefully. */
class ServerLoadingError extends Error {
  readonly isServerLoading = true
}

async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch('/api/data')
  if (res.status === 503) throw new ServerLoadingError('server_loading')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchServerStatus(): Promise<ServerStatus> {
  const res = await fetch('/api/status')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchMarketStatus(): Promise<MarketStatus> {
  const res = await fetch('/api/market_status')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchWellness(): Promise<WellnessData> {
  const res = await fetch('/api/wellness')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchPerformance(forceRefresh = false): Promise<PerformanceData> {
  const url = forceRefresh ? '/api/performance?refresh=1' : '/api/performance'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function triggerRefresh(): Promise<DashboardData> {
  const res = await fetch('/api/refresh', { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function useDashboardData() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
    staleTime: 5 * 60 * 1000,
    refetchInterval: () => {
      if (!isMarketOpen()) return false
      if (STATIC_TABS.has(activeTabRef.current)) return false
      return 5 * 60 * 1000
    },
    // Keep retrying indefinitely on 503 (server still loading), stop after 2
    // failures on any other error.
    retry: (failureCount, error) => {
      if (error instanceof ServerLoadingError) return failureCount < 90 // up to ~3 min
      return failureCount < 2
    },
    retryDelay: (_failureCount, error) => {
      if (error instanceof ServerLoadingError) return 2000  // poll every 2s while loading
      return Math.min(1000 * 2 ** _failureCount, 30_000)
    },
  })
}

/**
 * Poll /api/status for live refresh progress.
 * Enable only while the server is loading (503 phase) or a manual refresh is in-flight.
 */
export function useServerStatus(enabled: boolean) {
  return useQuery<ServerStatus>({
    queryKey: ['server-status'],
    queryFn: fetchServerStatus,
    refetchInterval: enabled ? 1500 : false,
    enabled,
    staleTime: 0,
    gcTime: 0,
  })
}

/**
 * Poll /api/market_status for calendar-aware (holidays, early closes) NYSE
 * trading-day status. Mirrors the result into marketStatusRef so the plain
 * isMarketOpen() function above can read it outside React.
 */
export function useMarketStatus() {
  const query = useQuery<MarketStatus>({
    queryKey: ['market-status'],
    queryFn: fetchMarketStatus,
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
    retry: 2,
  })
  useEffect(() => {
    if (query.data) marketStatusRef.current = query.data
  }, [query.data])
  return query
}

export function useWellnessData() {
  return useQuery<WellnessData>({
    queryKey: ['wellness'],
    queryFn: fetchWellness,
    staleTime: 10 * 60 * 1000,
    retry: 2,
  })
}

async function fetchBalanceHistory(days: number): Promise<BalanceSnapshot[]> {
  const res = await fetch(`/api/balance-history?days=${days}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  return Array.isArray(json) ? (json as BalanceSnapshot[]) : []
}

/**
 * Shared balance-history query — cached per `days` window so multiple
 * components (OverviewTab hero, WellnessSnapshot sparkline) don't each
 * re-fetch on every mount.
 */
export function useBalanceHistory(days: number) {
  return useQuery<BalanceSnapshot[]>({
    queryKey: ['balance-history', days],
    queryFn: () => fetchBalanceHistory(days),
    staleTime: 5 * 60_000,
    // Poll alongside the main dashboard query — without this, a page opened
    // before the market-open snapshot is captured shows yesterday's Daily Move
    // all day (staleTime alone never triggers a refetch while the tab sits open).
    refetchInterval: 5 * 60_000,
    retry: 2,
  })
}

export function usePerformanceData() {
  return useQuery<PerformanceData>({
    queryKey: ['performance'],
    queryFn: () => fetchPerformance(),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,   // keep in memory for 1 hour after last subscriber unmounts
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

/** Call once at app startup to warm the performance cache before the tab is opened. */
export function usePrefetchPerformance() {
  const qc = useQueryClient()
  // Read dashboard directly from cache — no queryFn needed, avoids the "no queryFn" warning
  const dashboard = qc.getQueryData<DashboardData>(['dashboard'])
  const dashboardReady = !!dashboard
  // Fire after dashboard is ready — no point fetching perf before we have positions.
  // Runs in an effect (not during render) so prefetch is a side effect, not a render hazard.
  useEffect(() => {
    if (dashboardReady && !qc.getQueryData(['performance'])) {
      qc.prefetchQuery({ queryKey: ['performance'], queryFn: () => fetchPerformance(), staleTime: 5 * 60 * 1000 })
    }
  }, [dashboardReady, qc])
}

export function useRefreshPerformance() {
  const queryClient = useQueryClient()
  return async () => {
    try {
      const fresh = await fetchPerformance(true)
      queryClient.setQueryData(['performance'], fresh)
    } catch (error) {
      console.error('[perf-refresh] Failed:', error)
      queryClient.invalidateQueries({ queryKey: ['performance'] })
    }
  }
}

export function useRefresh() {
  const queryClient = useQueryClient()

  return async () => {
    // Nuke all portfolio cache before fetching so corrupted/multiplied data
    // doesn't survive into the new result set.
    queryClient.removeQueries({ queryKey: ['dashboard'] })
    queryClient.removeQueries({ queryKey: ['performance'] })

    try {
      // POST to /api/refresh — server returns fresh data directly.
      // While this is in-flight the caller can poll useServerStatus() for progress.
      const freshData = await triggerRefresh()
      queryClient.setQueryData(['dashboard'], freshData)
    } catch (error) {
      console.error('[refresh] Failed:', error)
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    }
  }
}