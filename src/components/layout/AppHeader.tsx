/**
 * AppHeader — replaces layout/Header.tsx + layout/TabNav.tsx + the per-tab
 * SystemRibbon/ModeToggle/TickerStrip. One sticky header for the whole app;
 * Simple/Advanced is GLOBAL (state lives in App.tsx).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Segmented, mono } from '../ui/primitives'
import type { ViewMode } from '../ui/ModeToggle'
import { useMarketStatus } from '../../hooks/useDashboardData'
import type { MarketStatus } from '../../types/dashboard'

export const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'roadmap', label: 'Roadmap' },
  { id: 'portfolio', label: 'Portfolio' }, { id: 'risk', label: 'Risk' },
  { id: 'returns', label: 'Returns' }, { id: 'tax', label: 'Tax' },
  { id: 'cashflow', label: 'Cash flow' }, { id: 'forecast', label: 'Forecast' },
  { id: 'drawdown', label: 'Drawdown' }, { id: 'simulate', label: 'Simulate' },
  { id: 'research', label: 'Research' }, { id: 'trade_sim', label: 'Trade sim' },
  { id: 'ai', label: 'AI' }, { id: 'balance_history', label: 'Balance' },
  { id: 'settings', label: 'Settings' },
  // 'signals' intentionally removed in the redesign
] as const
export type TabId = typeof TABS[number]['id']
const TOOLS = new Set<TabId>(['balance_history', 'settings'])

// Legacy tab IDs stored in localStorage — map to current IDs on load
const LEGACY_MAP: Record<string, TabId> = {
  summary: 'overview', detail: 'portfolio', performance: 'returns', conversion: 'tax',
  spending: 'cashflow', predictions: 'forecast', intelligence: 'risk', simulations: 'simulate',
  signals: 'overview',
}

export function resolveLegacyTabId(id: string): TabId {
  if (LEGACY_MAP[id]) return LEGACY_MAP[id]
  return TABS.some(t => t.id === id) ? (id as TabId) : 'overview'
}

export const tabLabel = (id: string) => TABS.find(t => t.id === id)?.label ?? id

// ── Market clock ─────────────────────────────────────────────────────────────
// Calendar-aware via useMarketStatus(); naive Mon–Fri 9:30–16:00 ET fallback
// only before the first fetch resolves.
function naiveMarketIsOpen(): boolean {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  if (day === 0 || day === 6) return false
  const mins = et.getHours() * 60 + et.getMinutes()
  return mins >= 9 * 60 + 30 && mins < 16 * 60
}

function secondsToNextEvent(status: MarketStatus | undefined): number | null {
  if (!status) return null
  const target = status.is_open ? status.market_close_utc : status.next_open_utc
  return target ? Math.max(0, Math.floor((new Date(target).getTime() - Date.now()) / 1000)) : null
}

function fmtCountdown(secs: number): string {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtNow(d: Date): string {
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'America/New_York' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' })
  return `${day} ${date} · ${time} ET`
}

function useMarketLabel() {
  const { data: status } = useMarketStatus()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  const open = status ? status.is_open : naiveMarketIsOpen()
  const secs = secondsToNextEvent(status)
  const market = `Market ${open ? 'open' : 'closed'}${secs != null ? ` · ${fmtCountdown(secs)}${open ? '' : ' to open'}` : ''}`
  return { clock: fmtNow(now), market }
}

interface Props {
  active: TabId; onTab: (t: TabId) => void
  mode: ViewMode; onMode: (m: ViewMode) => void
  ground: 'light' | 'dark'; onGround: () => void
  updatedTitle?: string; schwabLive?: boolean
  onRefresh: () => void; isRefreshing: boolean
}

export function AppHeader(p: Props) {
  const { clock, market } = useMarketLabel()
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--fd-page)', padding: '0 48px', borderBottom: '5px solid var(--fd-rule)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, height: 64 }}>
        <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.005em', whiteSpace: 'nowrap' }}>Financial Dashboard</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, ...mono, color: 'var(--fd-muted)', whiteSpace: 'nowrap' }}>
          <span title={p.updatedTitle}>{clock}</span>
          <span style={{ color: 'var(--fd-ink)' }}>{market}</span>
          {p.schwabLive !== undefined && <span>Schwab {p.schwabLive ? 'live' : 'config'}</span>}
          <HeaderButton onClick={p.onRefresh} disabled={p.isRefreshing}>{p.isRefreshing ? 'Refreshing…' : 'Refresh'}</HeaderButton>
          <HeaderButton onClick={p.onGround}>{p.ground === 'dark' ? 'Light' : 'Dark'}</HeaderButton>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'space-between', gap: 16 }}>
        <nav className="fd-noscroll" style={{ display: 'flex', overflowX: 'auto', marginLeft: -8 }}>
          {TABS.map((t, i) => {
            const on = t.id === p.active
            return (
              <button key={t.id} className={on ? undefined : 'fd-tab'} onClick={() => p.onTab(t.id)} aria-current={on ? 'page' : undefined} style={{
                display: 'flex', alignItems: 'baseline', gap: 4, height: 44, padding: '0 8px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                paddingTop: 14,
                background: on ? 'var(--fd-ink)' : 'transparent',
                color: on ? 'var(--fd-page)' : TOOLS.has(t.id) ? 'var(--fd-muted)' : 'var(--fd-ink)',
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.03em', opacity: 0.64 }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ fontSize: 13, fontWeight: on ? 500 : 400 }}>{t.label}</span>
              </button>
            )
          })}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <Segmented size="sm" value={p.mode} onChange={p.onMode} options={[{ id: 'simple', label: 'Simple' }, { id: 'advanced', label: 'Advanced' }]} />
        </div>
      </div>
    </header>
  )
}

function HeaderButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="fd-ghost" onClick={onClick} disabled={disabled} style={{
      height: 32, padding: '0 14px', border: '1px solid var(--fd-hairline)', background: 'transparent', color: 'var(--fd-ink)',
      ...mono, cursor: disabled ? 'not-allowed' : 'pointer',
    }}>{children}</button>
  )
}
