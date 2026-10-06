import React, { useState, useEffect } from 'react'
import { WsSection } from '../workspace/WorkspaceContext'
import { useWorkspace, useWsSubTabs } from '../workspace/context'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE } from '../ui/chartTooltip'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { SetAlertModal } from '../alerts/SetAlertModal'
import { TerminalSection } from '../ui/Terminal'
import { gainColor, fmtMoneyFull } from '../../utils/formatters'

import { A, M } from './researchTypes'
import type { Props, ChartPeriod } from './researchTypes'
import { useResearch, useEtfComponents } from './researchHooks'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { SubTabBtn, SubTabBar } from '../ui/SubTabBtn'
import { PageHero, LeadMuted, Button, Pill, Label } from '../ui/primitives'
import { SnapshotModule } from './SnapshotModule'
import { SimpleActionSummary } from './ActionSummary'
import { ETFComponentEngine } from './ETFComponentEngine'
import { QualityEnginePanel, SignalDetailPanel } from './ActionEnginePanels'
import { PortfolioRolePanel, CorrelationPanel, YieldImpactPanel } from './PortfolioFitPanels'
import { SymbolVsSleevePanel } from './CrossSleevePanel'
import { ChartPanelCompare, AnnualizedReturnsCompare, CandlestickChart } from './ChartPanels'
import { PeerChip, PeerValuePanel } from './PeerPanels'
import {
  NavTrendPanel, TechPanelAdvanced, RiskPanelAdvanced, DrawdownPanel,
  PerfTable, FundPanel, FundProfilePanel, AnalystPanel, EarningsPanel, HoldingsPanel,
} from './DeepAnalyticsPanels'
import { PositionBlock, FundDecision } from './PositionBlock'
import { FundAnalysis } from '../portfolio/FundAnalysis'
import { SwingSignalPanel } from './SwingSignalPanel'
import {
  IntradayPressurePanel,
  VolatilityStructurePanel,
  TorqueEnginePanel,
  BetaSizingPanel,
  CyclePositionPanel,
  LiquidityFlowPanel,
  RiskContributionPanel,
  PortfolioStressPanel,
} from './PhaseOnePanels'

export function ResearchTab({ data, initialSymbol }: Props) {
  const ownedSymbols = [...new Set(
    data.accounts.flatMap(a => a.positions
      .filter(p => !p.is_money_market && p.fund_type !== 'MONEY_MARKET' && p.symbol !== 'CASH')
      .map(p => p.symbol))
  )]
  const decisionSymbols = data.decisions.map(d => d.symbol)
  const watchlist = ownedSymbols.length > 0 ? ownedSymbols : decisionSymbols
  const [active, setActive] = useState<string>(initialSymbol?.toUpperCase() ?? '')
  const [manualInput, setManualInput] = useState('')
  const [mode] = useGlobalViewMode()
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('1y')
  const [advTab, setAdvTab] = useState<'action' | 'fit' | 'deep' | 'swing'>('action')
  // Advanced workspace: the four module tabs fold into the "On this tab" rail.
  const ws = useWorkspace()
  useWsSubTabs(advTab, setAdvTab as (s: string) => void)
  const [compareSymbols, setCompareSymbols] = useState<string[]>([])
  const [compareInput, setCompareInput] = useState('')
  const [showAlertModal, setShowAlertModal] = useState(false)
  const [watchlistMsg, setWatchlistMsg] = useState<string | null>(null)
  const [compareChartData, setCompareChartData] = useState<Record<string, any>>({})
  const [narrativeVisible, setNarrativeVisible] = useState(false)

  const narrateMutation = useMutation({
    mutationFn: (sym: string) =>
      fetch(`/api/research/${encodeURIComponent(sym)}/narrate`).then(r => r.json()),
  })

  // ── Sim portfolio list (for "Add to Watchlist") ───────────────────────────
  const qc = useQueryClient()
  const { data: simPortfolios = [] } = useQuery<{ portfolio_id: number; name: string; is_default?: boolean }[]>({
    queryKey: ['sim-portfolios'],
    queryFn: () => fetch('/api/sim/portfolios').then(r => r.json()),
    staleTime: 60_000,
  })
  const defaultPortfolio = simPortfolios.find(p => p.is_default) ?? simPortfolios[0] ?? null
  const hasPortfolios = simPortfolios.length > 0

  const addToWatchlist = useMutation({
    mutationFn: (symbol: string) =>
      fetch(`/api/sim/portfolios/${defaultPortfolio!.portfolio_id}/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      }).then(async r => {
        if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? 'Failed') }
        return r.json()
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sim-portfolio', defaultPortfolio?.portfolio_id] })
      setWatchlistMsg('Added ✓')
      setTimeout(() => setWatchlistMsg(null), 2500)
    },
    onError: (e: Error) => {
      const msg = e.message.toLowerCase().includes('already') ? 'Already watching' : ' ' + e.message
      setWatchlistMsg(msg)
      setTimeout(() => setWatchlistMsg(null), 2500)
    },
  })
  const benchmark = data.fund_configs?.[active]?.BENCHMARK || 'SPY'

  const snap = active ? data.snapshots[active] : undefined
  const activePositions = active
    ? data.accounts.flatMap(a => a.positions.filter(p => p.symbol === active))
    : []
  const { data: r, isLoading, isError } = useResearch(active || null)
  const { data: ece, isLoading: eceLoading, isError: eceError } = useEtfComponents(
    active || null,
    r?.etf_component_eligible === true
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const sym = manualInput.trim().toUpperCase()
    if (sym) { setActive(sym); setManualInput(''); setNarrativeVisible(false) }
  }

  const [selectedPeer, setSelectedPeer] = useState<string>('')

  // ── Comparison handlers ───────────────────────────────────────────────
  const fetchCompareChart = async (sym: string) => {
    if (compareChartData[sym]) return
    try {
      const res = await fetch(`/api/chart?symbol=${encodeURIComponent(sym)}`)
      const result = await res.json()
      if (!result.error && result.chart) {
        setCompareChartData(prev => ({ ...prev, [sym]: result.chart }))
      }
    } catch (e) {
      console.error(`Failed to fetch chart for ${sym}:`, e)
    }
  }

  const handleAddCompare = () => {
    const sym = compareInput.trim().toUpperCase()
    if (!sym || sym === active || compareSymbols.includes(sym)) return
    setCompareSymbols(prev => [...prev, sym])
    fetchCompareChart(sym)
    setCompareInput('')
  }

  const handleRemoveCompare = (sym: string) => {
    setCompareSymbols(prev => prev.filter(s => s !== sym))
    setCompareChartData(prev => {
      const next = { ...prev }
      delete next[sym]
      return next
    })
  }

  // Fetch benchmark chart data automatically.
  const { data: benchmarkQueryResult } = useQuery<Record<string, any> | null>({
    queryKey: ['benchmark-chart', benchmark],
    queryFn: async () => {
      const res = await fetch(`/api/chart?symbol=${encodeURIComponent(benchmark)}`)
      const result = await res.json()
      return (!result.error && result.chart) ? result.chart : null
    },
    enabled: !!active && benchmark !== active,
    staleTime: 10 * 60 * 1000,
  })

  useEffect(() => {
    if (benchmarkQueryResult && benchmark) {
      setCompareChartData(prev =>
        prev[benchmark] === benchmarkQueryResult
          ? prev
          : { ...prev, [benchmark]: benchmarkQueryResult }
      )
    }
  }, [benchmarkQueryResult, benchmark])

  useEffect(() => {
    if (r?.peers && r.peers.length > 0 && !selectedPeer) {
      setSelectedPeer(r.peers[0])
    }
  }, [r?.peers, selectedPeer])


  const q = r?.quote
  const tl = r?.trading_levels
  const sc = r?.symbol_class
  // Prefer the live portfolio snapshot (same Schwab feed as the ticker tape /
  // Portfolio tab) so Research never shows a different price than the rest of
  // the app. The research API quote (yfinance, can lag) is the fallback for
  // symbols not held in the portfolio.
  const price = snap?.price ?? q?.last_price ?? 0
  const change = snap?.price_change ?? q?.change ?? 0
  const changePct = snap != null ? snap.price_change_pct * 100 : (q?.change_pct ?? 0)
  const chgColor = gainColor(changePct / 100)
  const quoteCurrency = q?.currency ?? 'USD'
  const isForeignQuote = quoteCurrency !== 'USD'
  const nativePrice = q?.native_price ?? null
  const nativeChange = q?.native_change ?? null
  const isCef = r?.holdings_is_cef === true || sc?.type === 'CEF'
  const showTech = sc?.show_technicals !== false && sc?.type !== 'MMF'
  const ae = (r?.portfolio_fit?.action_engine_overlay) ?? r?.action_engine
  const qe = r?.quality_engine
  const pf = r?.portfolio_fit


  // ── Recent searches (last 4, per browser) ──
  const RECENT_KEY = 'research_recent'
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
  })
  useEffect(() => {
    if (!active) return
    setRecent(prev => {
      const next = [active, ...prev.filter(x => x !== active)].slice(0, 4)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }, [active])

  const held = ownedSymbols.includes(active)
  const weightPct = pf?.weight_pct ?? (held && data.summary.total_value > 0 ? (activePositions.reduce((t, p) => t + p.value, 0) / data.summary.total_value) * 100 : null)
  const verdictWord = (() => {
    const act = (ae?.action ?? '').toUpperCase()
    if (/STRONG.?BUY|ACCUMULATE|ADD|BUY/.test(act)) return 'a buy'
    if (/TRIM|REDUCE|SELL|EXIT/.test(act)) return 'a trim'
    if (/HOLD/.test(act)) return 'steady'
    if (/WATCH|WAIT/.test(act)) return 'on watch'
    return changePct >= 0 ? 'steady' : 'under pressure'
  })()
  const fitValue = data.summary.total_value * 0.05
  const ghost = { height: 32, padding: '0 14px', border: '1px solid var(--fd-hairline)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase' as const, cursor: 'pointer', color: 'var(--fd-ink)' }

  const actions = active && r && !r.error ? (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="fd-ghost" style={ghost} onClick={() => { setNarrativeVisible(v => !v); if (!narrativeVisible) { narrateMutation.mutate(active); ws.focusSection('rs_narrative') } }} title={`AI summary for ${active}`}>
        {narrateMutation.isPending ? 'Analysing…' : narrativeVisible ? 'Hide analysis' : 'Analyse'}
      </button>
      {price > 0 && <button className="fd-ghost" style={ghost} onClick={() => setShowAlertModal(true)} title={`Set price alert for ${active}`}>Alert</button>}
      {price > 0 && (hasPortfolios
        ? <button className="fd-ghost" style={ghost} onClick={() => addToWatchlist.mutate(active)} disabled={addToWatchlist.isPending} title={`Add ${active} to "${defaultPortfolio?.name}"`}>{watchlistMsg ?? '+ Watchlist'}</button>
        : <button style={ghost} disabled title="Create a portfolio in Trade sim first">+ Watchlist</button>)}
    </div>
  ) : null

  return (
    <div style={{ paddingBottom: 64 }}>
      {showAlertModal && active && (
        <SetAlertModal symbol={active} currentPrice={price > 0 ? price : null} onClose={() => setShowAlertModal(false)} />
      )}

      {/* Search + symbol pills */}
      <section style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '40px 0 0' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex' }}>
          <input value={manualInput} onChange={e => setManualInput(e.target.value.toUpperCase().slice(0, 10))} maxLength={10}
            placeholder="Any symbol — e.g. VOO, MSFT, O" aria-label="Look up a symbol" className="fd-input" style={{ width: 320, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }} />
          <Button variant="primary" type="submit" style={{ height: 44 }}>Research</Button>
        </form>
        <Label style={{ marginLeft: 8 }}>Held</Label>
        {watchlist.map(sym => <Pill key={sym} v={sym} active={sym === active} onClick={() => { setActive(sym); setNarrativeVisible(false) }} />)}
        {recent.filter(x => !watchlist.includes(x)).length > 0 && <Label style={{ marginLeft: 8 }}>Recent</Label>}
        {recent.filter(x => !watchlist.includes(x)).map(sym => <Pill key={sym} v={sym} active={sym === active} onClick={() => { setActive(sym); setNarrativeVisible(false) }} />)}
      </section>

      {active && r && !r.error && (
        <PageHero
          asideTitle="Quote"
          eyebrow={`${sc?.display_label ?? r.profile?.asset_type ?? 'Security'}${r.profile?.name ? ` · ${r.profile.name}` : ''} · ${held && weightPct != null ? `${weightPct.toFixed(1)}% of portfolio` : 'Not in portfolio'}`}
          eyebrowRight={actions}
          before={`${active} is `} em={verdictWord} after="."
          lead={<>
            <span>{price > 0 ? `${isForeignQuote && nativePrice != null ? `${nativePrice.toFixed(2)} ${quoteCurrency} · ` : ''}$${price.toFixed(2)}, ${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(2)}% today.` : ''}{ae?.action ? ` Action engine: ${ae.action.toLowerCase()}${ae.size_guidance != null ? ` · size ${ae.size_guidance}%` : ''}.` : ''}</span>
            {(ae?.ai_view || tl?.verdict_reason) && <LeadMuted>{ae?.ai_view ?? tl?.verdict_reason}</LeadMuted>}
            {!held && data.summary.total_value > 0 && (
              <LeadMuted>Not in portfolio · a 5% position would be {fmtMoneyFull(fitValue)}{pf?.yield_delta_bps != null ? `, moving portfolio yield ${pf.yield_delta_bps >= 0 ? '+' : '−'}${Math.abs(pf.yield_delta_bps).toFixed(0)} bps` : ''}{pf?.corr_portfolio != null ? ` with ${pf.corr_portfolio.toFixed(2)} correlation to the portfolio` : ''}.</LeadMuted>
            )}
          </>}
          aside={
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 1, background: 'var(--fd-hairline)', border: '1px solid var(--fd-hairline)' }}>
              {[
                { k: 'Price', v: price > 0 ? `$${price.toFixed(2)}` : '—', c: undefined as string | undefined },
                { k: 'Today', v: `${changePct >= 0 ? '+' : '−'}${Math.abs(changePct).toFixed(2)}%`, c: changePct >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)' },
                { k: 'Yield', v: r.distributions?.ttm_yield_pct != null ? `${r.distributions.ttm_yield_pct.toFixed(2)}%` : r.distributions?.ttm_yield != null ? `${(r.distributions.ttm_yield * 100).toFixed(2)}%` : '—', c: undefined },
                { k: '12 months', v: r.nav_metrics?.price_12m_pct != null ? `${r.nav_metrics.price_12m_pct >= 0 ? '+' : '−'}${Math.abs(r.nav_metrics.price_12m_pct).toFixed(1)}%` : '—', c: r.nav_metrics?.price_12m_pct != null ? (r.nav_metrics.price_12m_pct >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)') : undefined },
              ].map(t => (
                <div key={t.k} style={{ background: 'var(--fd-page)', padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Label>{t.k}</Label><span style={{ fontSize: 26, fontWeight: 500, color: t.c }}>{t.v}</span>
                </div>
              ))}
            </div>
          }
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 40, paddingTop: active && r && !r.error ? 0 : 40 }}>
          {!active && (
            <PageHero eyebrow="Research · fund and stock analysis" before="Pick a " em="symbol" after="."
              lead={<span style={{ color: 'var(--fd-muted)' }}>Select a holding above or type any ticker — up to 10 characters. Symbols you don't hold get a 5% position fit preview.</span>} />
          )}
          {active && isLoading && (
            <div style={{ padding: '8px 12px', color: A, fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
              <span className="anim-blink">█</span> LOADING {active}…
            </div>
          )}
          {active && isError && !isLoading && (
            <div style={{ padding: '8px 12px', color: 'var(--red)', fontSize: 12, background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
               Failed to load research data for {active}. Check server logs.
            </div>
          )}

          {active && r?.error && !isLoading && (
            <div style={{ padding: '8px 12px', color: 'var(--red)', fontSize: 12, background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)' }}>
               Research error for {active}: {r.error}
            </div>
          )}

          {active && r && !r.error && (
            <>
              {/* ── AI Narrative ── */}
              {narrativeVisible && (
                <WsSection id="rs_narrative" value={narrateMutation.isPending ? '…' : undefined}>
                <div style={{
                  padding: '10px 14px',
                  background: 'var(--surface)',
                  border: '1px solid var(--fd-hairline)',
                  borderTop: '2px solid var(--green)',
                  borderRadius: 0,
                  boxShadow: 'none',
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--green)', fontFamily: 'var(--font-mono)', letterSpacing: '0.6px' }}>
                       {active} Analysis
                    </span>
                    {narrateMutation.data?.source && narrateMutation.data.source !== 'error' && (
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: M, padding: '1px 6px', border: '1px solid var(--fd-hairline)', fontFamily: 'var(--font-mono)', letterSpacing: '0.5px' }}>
                        {narrateMutation.data.source.startsWith('llm:') ? `LLM · ${narrateMutation.data.source.slice(4)}` : narrateMutation.data.source.toUpperCase()}
                        {narrateMutation.data.cached ? ' · CACHED' : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text)' }}>
                    {narrateMutation.isPending
                      ? <span style={{ color: M }}>Analyzing {active}…</span>
                      : narrateMutation.data?.narrative || '—'
                    }
                  </div>
                </div>
                </WsSection>
              )}

              {/* ── Guardrails ── */}
              {(r.guardrails?.length ?? 0) > 0 && (
                <WsSection id="rs_guardrails" value={String(r.guardrails!.length)} status={r.guardrails!.some(g => g.level === 'WARN') ? 'warn' : 'info'}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {r.guardrails!.map((g, i) => (
                    <div key={i} style={{ padding: '6px 10px', background: g.level === 'WARN' ? 'var(--fd-card)' : 'var(--fd-card)', border: g.level === 'WARN' ? '1px solid rgba(214,48,49,0.35)' : '1px solid var(--border2)', display: 'flex', gap: 8 }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{g.level === 'WARN' ? '' : 'ℹ'}</span>
                      <div>
                        {g.code && <span style={{ fontSize: 12, fontWeight: 500, color: g.level === 'WARN' ? 'var(--red)' : M, textTransform: 'uppercase', marginRight: 6 }}>{g.code.replace(/_/g, ' ')}</span>}
                        <span style={{ fontSize: 12, color: 'var(--text)' }}>{g.msg}</span>
                      </div>
                    </div>
                  ))}
                </div>
                </WsSection>
              )}

              {/* ══════════ YOUR POSITION — shown first when holding this symbol ══════════ */}
              {activePositions.reduce((t, p) => t + (p.value ?? 0), 0) > 0 && (
                <WsSection id="rs_position" value={weightPct != null ? `${weightPct.toFixed(1)}%` : undefined} status="info">
                  <PositionBlock snap={snap} pf={pf} advanced positions={activePositions} />
                </WsSection>
              )}

              {/* ══════════ MODULE 1: SYMBOL SNAPSHOT (always shown) ══════════ */}
              <WsSection id="rs_snapshot" value={price > 0 ? `$${price.toFixed(2)}` : undefined} status={changePct >= 0 ? 'ok' : 'watch'}>
              <SnapshotModule
                r={r} data={data} symbol={active}
                price={price} change={change} changePct={changePct}
                chgColor={chgColor} ae={ae} qe={qe} isCef={isCef}
                showTech={showTech} tl={tl} sc={sc} snap={snap}
                ece={ece} eceLoading={eceLoading}
                isForeignQuote={isForeignQuote} quoteCurrency={quoteCurrency}
                nativePrice={nativePrice} nativeChange={nativeChange}
                />
              </WsSection>

              {/* ══════════ ACTION PLAN (always shown) ══════════ */}
              <WsSection id="rs_action_plan" value={ae?.action ? ae.action.toLowerCase() : undefined}>
                <SimpleActionSummary ae={ae} qe={qe} tl={tl} ece={ece} price={price} r={r} />
              </WsSection>

              {/* ══════════ ETF COMPONENT ENGINE (top-heavy ETFs only) ══════════ */}
              {r.etf_component_eligible && (eceLoading || eceError || ece?.error || ece?.is_top_heavy) && (
                <WsSection id="rs_etf">{
                eceLoading
                  ? <div style={{ padding: '12px 16px', fontSize: 12, color: M, border: '1px solid var(--fd-hairline)', borderRadius: 0, background: 'var(--surface)', flexShrink: 0 }}>
                      ◈ ETF COMPONENT ENGINE — loading component data…
                    </div>
                  : eceError || ece?.error
                    ? <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--amber)', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, flexShrink: 0 }}>
                        ◈ ETF COMPONENT ENGINE — {ece?.error ?? 'component data unavailable'}
                      </div>
                    : ece?.is_top_heavy
                      ? <ETFComponentEngine ece={ece} onSymbolClick={sym => setActive(sym)} />
                      : null
                }</WsSection>
              )}

              {/* ══════════ ADVANCED MODE — tabbed modules ══════════ */}
              {mode === 'advanced' && (
                <>
                  {!ws.enabled && <nav style={{ borderTop: '2px solid var(--fd-rule)', paddingTop: 16 }}>
                    <SubTabBar>
                      {([
                        { key: 'action', label: 'Action engine' },
                        { key: 'fit',    label: 'Portfolio fit' },
                        { key: 'deep',   label: 'Deep analytics' },
                        { key: 'swing',  label: 'Swing signal' },
                      ] as const).map((tab, i) => (
                        <SubTabBtn key={tab.key} label={tab.label} index={i + 1} active={advTab === tab.key} onClick={() => setAdvTab(tab.key)} />
                      ))}
                    </SubTabBar>
                  </nav>}

                  {/* ── Tab content — minHeight prevents scroll jump when switching to short tabs ── */}
                  <div style={ws.enabled ? { display: 'contents' } : { minHeight: '72vh' }}>

                  {/* ── Tab: ACTION ENGINE ── */}
                  {advTab === 'action' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <WsSection id="rs_quality" value={qe?.quality_score != null ? `${qe.quality_score.toFixed(0)} / 100` : undefined}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                        <QualityEnginePanel qe={qe} yieldPct={r?.distributions?.ttm_yield} />
                        <SignalDetailPanel r={r} price={price} tl={tl} showTech={showTech} />
                      </div>
                      </WsSection>
                      {/* Phase 1 — Intraday Pressure, Volatility Structure, Torque */}
                      <WsSection id="rs_cycle">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                        <CyclePositionPanel r={r} />
                        <IntradayPressurePanel r={r} />
                        <VolatilityStructurePanel r={r} />
                        <TorqueEnginePanel r={r} />
                      </div>
                      </WsSection>
                    </div>
                  )}

                  {/* ── Tab: PORTFOLIO FIT ── */}
                  {advTab === 'fit' && (
                    <WsSection id="rs_fit">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                        <PortfolioRolePanel pf={pf} />
                        <CorrelationPanel pf={pf} />
                        <YieldImpactPanel pf={pf} />
                        <BetaSizingPanel r={r} />
                        <RiskContributionPanel r={r} />
                        <PortfolioStressPanel r={r} />
                        <SymbolVsSleevePanel symbol={active} data={data} />
                      </div>
                      {pf?.guidance && (
                        <div style={{ padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
                          {pf.guidance.verdict && <div style={{ fontSize: 12, color: A, fontWeight: 500, marginBottom: 2 }}>{pf.guidance.verdict}</div>}
                          {pf.guidance.action && <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>{pf.guidance.action}</div>}
                        </div>
                      )}
                      {pf?.positions && pf.positions.length > 0 && (
                        <div style={{ paddingTop: 4 }}>
                          <div style={{ fontSize: 12, color: M, fontWeight: 500, marginBottom: 6 }}>HELD IN:</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {pf.positions.map((pos, i) => {
                              const ak = (pos.acct_key ?? '').toLowerCase()
                              const tc = ak.includes('roth') ? 'var(--fd-lilac-ink)' : ak.includes('rollover') ? 'var(--fd-ink)' : 'var(--fd-accent)'
                              return (
                                <div key={i} style={{ padding: '5px 10px', background: `${tc}15`, border: `1px solid ${tc}`, fontSize: 12 }}>
                                  <strong style={{ color: tc }}>{pos.account ?? pos.acct_type ?? '—'}</strong>
                                  {pos.shares && <> · {pos.shares.toFixed(2)} sh</>}
                                  {pos.value && <> · {fmtMoneyFull(pos.value)}</>}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    </WsSection>
                  )}

                  {/* ── Tab: DEEP ANALYTICS ── */}
                  {advTab === 'deep' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {/* Phase 2 — Flow Engine at top of Deep Analytics.
                          (Volatility Structure already appears in the Action
                          Engine tab alongside its sibling technical panels —
                          not repeated here.) */}
                      <WsSection id="rs_flow">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginBottom: 8 }}>
                        <LiquidityFlowPanel r={r} />
                      </div>
                      </WsSection>
                      {/* A. Price Performance */}
                      <WsSection id="rs_perf">
                      <TerminalSection id="perf" title="A. PRICE PERFORMANCE" defaultOpen={true} accent={A}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 4px' }}>

                          {/* ── Comparison Bar ── */}
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                            padding: '6px 10px', background: 'var(--surface)',
                            border: '1px solid var(--fd-hairline)', borderRadius: 0
                          }}>
                            <span style={{ fontSize: 12, color: M, fontWeight: 500, whiteSpace: 'nowrap' }}>COMPARE:</span>
                            <input
                              value={compareInput}
                              onChange={e => setCompareInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAddCompare()}
                              placeholder="TICKER..."
                              style={{
                                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                                padding: '3px 8px', background: 'var(--surface)',
                                border: '1px solid var(--fd-hairline)', color: 'var(--text)',
                                textTransform: 'uppercase', width: 80,
                              }}
                            />
                            <button onClick={handleAddCompare} style={{
                              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                              padding: '3px 10px', background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none', cursor: 'pointer',
                            }}>ADD</button>
                            <span style={{
                              fontSize: 12, fontWeight: 500, color: 'var(--fd-muted)',
                              background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)',
                              padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
                            }}>
                              ● {benchmark} (benchmark)
                            </span>
                            {compareSymbols.map((sym, i) => {
                              const COLORS = ['var(--fd-accent)', 'var(--fd-lilac-ink)', 'var(--fd-lime-ink)', 'var(--fd-muted)', 'var(--fd-ink)', 'var(--fd-negative)']
                              const color = COLORS[i % COLORS.length]
                              return (
                                <span key={sym} onClick={() => handleRemoveCompare(sym)} style={{
                                  fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
                                  padding: '2px 8px', borderRadius: 12, cursor: 'pointer',
                                  background: `${color}18`, border: `1px solid ${color}`, color,
                                }}>
                                  ● {sym} <span style={{ marginLeft: 2, opacity: 0.6 }}>×</span>
                                </span>
                              )
                            })}
                          </div>

                          {r.performance_table && <PerfTable pt={r.performance_table} />}
                          {r.annualized_returns && (
                            <AnnualizedReturnsCompare
                              ar={r.annualized_returns}
                              symbol={active}
                              benchmark={benchmark}
                              compareSymbols={compareSymbols}
                            />
                          )}
                          <ChartPanelCompare
                            r={r}
                            period={chartPeriod}
                            onPeriod={setChartPeriod}
                            chgColor={chgColor}
                            benchmark={benchmark}
                            compareSymbols={compareSymbols}
                            compareChartData={compareChartData}
                            active={active}
                          />
                        </div>
                      </TerminalSection>
                      </WsSection>

                      {/* A2. CANDLESTICK CHART */}
                      <WsSection id="rs_candle">
                      <TerminalSection id="candlestick" title="CANDLESTICK CHART" defaultOpen={false} accent={A}>
                        <div style={{ padding: '8px 4px' }}>
                          <CandlestickChart symbol={active} />
                        </div>
                      </TerminalSection>
                      </WsSection>

                      {/* B. Trend & Momentum */}
                      {showTech && r.technicals && (
                        <WsSection id="rs_tech">
                        <TerminalSection id="tech" title="B. TREND & MOMENTUM" defaultOpen={false} accent={A}>
                          <div style={{ padding: '8px 4px' }}>
                            <TechPanelAdvanced r={r} />
                          </div>
                        </TerminalSection>
                        </WsSection>
                      )}

                      {/* C. Volatility & Risk */}
                      {r.risk_stats && (
                        <WsSection id="rs_risk">
                        <TerminalSection id="risk" title="C. VOLATILITY & RISK" defaultOpen={false} accent={A}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 4px' }}>
                            <RiskPanelAdvanced r={r} />
                            {r.risk_stats.beta != null && <DrawdownPanel beta={r.risk_stats.beta} maxDD={r.risk_stats.max_drawdown} />}
                          </div>
                        </TerminalSection>
                        </WsSection>
                      )}

                      {/* D. NAV & Premium/Discount (CEF only) */}
                      {isCef && sc?.show_nav_analysis && r.nav_metrics && (
                        <WsSection id="rs_nav">
                        <TerminalSection id="nav" title="D. NAV & PREMIUM/DISCOUNT" defaultOpen={false} accent={A}>
                          <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <NavTrendPanel nm={r.nav_metrics} />
                            {/* Annual NAV history: table + chart */}
                            {(() => {
                              const hist = r.nav_metrics!.annual_nav_history
                              if (!hist || hist.length < 2) return null
                              const pctColor = (p: number) => p > 0 ? 'var(--green)' : p < 0 ? 'var(--red)' : 'var(--text)'
                              const fmt = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`
                              const firstYr = hist[0].year
                              const lastYr  = hist[hist.length - 1].year
                              const trend   = hist[hist.length - 1].change_pct - hist[0].change_pct
                              const trendClr = trend >= 0 ? 'var(--green)' : 'var(--red)'
                              return (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                  {/* Table */}
                                  <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Annual NAV Change</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                                      <div style={{ fontSize: 12, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 4, borderBottom: '1px solid var(--fd-hairline)' }}>Year</div>
                                      <div style={{ fontSize: 12, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 4, borderBottom: '1px solid var(--fd-hairline)', textAlign: 'right' }}>NAV Change</div>
                                      {[...hist].reverse().map(h => [
                                        <div key={`y-${h.year}`} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--fd-muted)', padding: '5px 0', borderBottom: '1px solid var(--fd-hairline)' }}>{h.year}</div>,
                                        <div key={`v-${h.year}`} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: pctColor(h.change_pct), padding: '5px 0', borderBottom: '1px solid var(--fd-hairline)', textAlign: 'right' }}>{fmt(h.change_pct)}</div>,
                                      ])}
                                    </div>
                                  </div>
                                  {/* Chart */}
                                  <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{firstYr}–{lastYr}</div>
                                    </div>
                                    <ResponsiveContainer width="100%" height={Math.max(110, hist.length * 10)}>
                                      <AreaChart data={hist} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                                        <defs>
                                          <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={trendClr} stopOpacity={0.18} />
                                            <stop offset="95%" stopColor={trendClr} stopOpacity={0.01} />
                                          </linearGradient>
                                        </defs>
                                        <XAxis dataKey="year" tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }} tickLine={false} axisLine={false} />
                                        <YAxis tick={{ fontSize: 12, fill: 'var(--fd-card)' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`} width={38} domain={['auto', 'auto']} />
                                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} formatter={(v: unknown) => [`${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(1)}%`, 'NAV Change']} />
                                        <Area type="monotone" dataKey="change_pct" stroke={trendClr} strokeWidth={1.5} fill="url(#navGrad)" dot={{ r: 2.5, fill: trendClr, strokeWidth: 0 }} activeDot={{ r: 4 }} />
                                      </AreaChart>
                                    </ResponsiveContainer>
                                  </div>
                                </div>
                              )
                            })()}
                          </div>
                        </TerminalSection>
                        </WsSection>
                      )}

                      {/* E. Distribution */}
                      <WsSection id="rs_dist">
                      <TerminalSection id="dist" title="E. DISTRIBUTION & INCOME" defaultOpen={false} accent={A}>
                        <div style={{ padding: '8px 4px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
                            <FundPanel r={r} data={data} symbol={active} advanced />
                            <FundProfilePanel r={r} />
                          </div>
                          {(sc?.show_fundamentals || (r.key_stats?.pe_ratio != null)) && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8, marginTop: 8 }}>
                              <AnalystPanel r={r} price={price} />
                              <EarningsPanel r={r} />
                            </div>
                          )}
                          {/* Distribution History — table + line chart */}
                          {(() => {
                            const hist = r.distributions?.annual_history
                            if (!hist || hist.length < 2) return null
                            const firstYr  = hist[0].year
                            const lastYr   = hist[hist.length - 1].year
                            const trend    = hist[hist.length - 1].total - hist[0].total
                            const trendClr = trend >= 0 ? 'var(--green)' : 'var(--red)'
                            const trendLbl = trend >= 0 ? `+$${trend.toFixed(2)} since ${firstYr}` : `−$${Math.abs(trend).toFixed(2)} since ${firstYr}`
                            return (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                                {/* Table */}
                                <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
                                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                                    Annual Distribution History
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                                    <div style={{ fontSize: 12, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 4, borderBottom: '1px solid var(--fd-hairline)' }}>Year</div>
                                    <div style={{ fontSize: 12, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 4, borderBottom: '1px solid var(--fd-hairline)', textAlign: 'right' }}>Distribution</div>
                                    {[...hist].reverse().map((h, i) => {
                                      const prev = hist[hist.length - 2 - i]
                                      const chg  = prev ? h.total - prev.total : null
                                      const clr  = chg == null ? 'var(--text)' : chg >= 0 ? 'var(--green)' : 'var(--red)'
                                      return [
                                        <div key={`y-${h.year}`} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--fd-muted)', padding: '5px 0', borderBottom: '1px solid var(--fd-hairline)' }}>{h.year}</div>,
                                        <div key={`v-${h.year}`} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: clr, padding: '5px 0', borderBottom: '1px solid var(--fd-hairline)', textAlign: 'right' }}>${h.total.toFixed(2)}</div>,
                                      ]
                                    })}
                                  </div>
                                </div>
                                {/* Line chart */}
                                <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fd-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                      {firstYr}–{lastYr}
                                    </div>
                                    <div style={{ fontSize: 12, color: trendClr, fontFamily: 'var(--font-mono)' }}>{trendLbl}</div>
                                  </div>
                                  <ResponsiveContainer width="100%" height={110}>
                                    <AreaChart data={hist} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                                      <defs>
                                        <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
                                          <stop offset="5%" stopColor={trendClr} stopOpacity={0.18} />
                                          <stop offset="95%" stopColor={trendClr} stopOpacity={0.01} />
                                        </linearGradient>
                                      </defs>
                                      <XAxis dataKey="year" tick={{ fontSize: 12, fill: 'var(--fd-hairline)' }} tickLine={false} axisLine={false} />
                                      <YAxis tick={{ fontSize: 12, fill: 'var(--fd-card)' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v.toFixed(2)}`} width={42} domain={['auto', 'auto']} />
                                      <Tooltip
                                        contentStyle={TOOLTIP_STYLE}
                                        labelStyle={TOOLTIP_LABEL_STYLE}
                                        formatter={(v: unknown) => [`$${(v as number).toFixed(2)}`, 'Distribution']}
                                      />
                                      <Area type="monotone" dataKey="total" stroke={trendClr} strokeWidth={1.5} fill="url(#distGrad)" dot={{ r: 2.5, fill: trendClr, strokeWidth: 0 }} activeDot={{ r: 4 }} />
                                    </AreaChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      </TerminalSection>
                      </WsSection>

                      {/* F. Peer Comparison */}
                      {r.peers && r.peers.length > 0 && (
                        <WsSection id="rs_peers">
                        <TerminalSection id="peers" title="F. PEER COMPARISON" defaultOpen={false} accent={A}>
                          <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {r.peers.map((sym) => (
                                <PeerChip
                                  onSearch={(sym) => setActive(sym)}
                                  key={sym}
                                  sym={sym}
                                  selectedPeer={selectedPeer}
                                  onClick={(sym) => setSelectedPeer(sym)}
                                />
                              ))}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: r.holdings && r.holdings.length > 0 ? '1fr 1fr' : '1fr', gap: 8 }}>

                              {r.holdings && r.holdings.length > 0 && (
                                <HoldingsPanel holdings={r.holdings} holdingsUrl={r.holdings_url} onSymbolClick={(sym) => setActive(sym)} />
                              )}

                              <div>
                                <PeerValuePanel
                                  selectedPeer={selectedPeer}
                                  onViewDetail={(sym: string) => setActive(sym)}
                                />
                              </div>
                            </div>
                          </div>
                        </TerminalSection>
                        </WsSection>
                      )}

                      {/* G. Fund Health Analysis — runs live evaluation engine for any symbol */}
                      <WsSection id="rs_health">
                      <TerminalSection id="fund-analysis" title="G. FUND HEALTH ANALYSIS" defaultOpen={true} accent={A}>
                        <div style={{ padding: '8px 4px' }}>
                          <FundAnalysis
                            data={data}
                            pi={data.portfolio_intel}
                            symbol={active}
                            healthDecision={r.health_decision}
                          />
                        </div>
                      </TerminalSection>
                      </WsSection>

                      {/* Analysis text */}
                      {r.analysis && Object.values(r.analysis).some(Boolean) && (
                        <WsSection id="rs_qual">
                        <TerminalSection id="analysis" title="QUALITATIVE ANALYSIS" defaultOpen={false} accent={A}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, padding: '8px 4px' }}>
                            {[{ k: 'trend', icon: '' }, { k: 'momentum', icon: '' }, { k: 'volume', icon: '' }, { k: 'volatility', icon: '〰' }]
                              .filter(s => r.analysis![s.k as keyof typeof r.analysis])
                              .map(s => (
                                <div key={s.k} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 10px' }}>
                                  <div style={{ fontSize: 12, color: A, fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>{s.icon} {s.k}</div>
                                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{r.analysis![s.k as keyof typeof r.analysis]}</div>
                                </div>
                              ))}
                          </div>
                        </TerminalSection>
                        </WsSection>
                      )}
                    </div>
                  )}

                  {/* ── Tab: SWING SIGNAL ── */}
                  {advTab === 'swing' && (
                    <WsSection id="rs_swing">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <SwingSignalPanel
                        symbol={active}
                        price={price}
                        limitPrice={tl?.limit_price}
                        portfolioSymbols={watchlist}
                        regime={data.portfolio_intel?.market_regime ?? 'CONSOLIDATION'}
                        vix={data.vix_current ?? 0}
                      />
                    </div>
                    </WsSection>
                  )}

                  </div>{/* end minHeight tab content wrapper */}

                  {/* System decision */}
                  {data.decisions.some(d => d.symbol === active) && (
                    <WsSection id="rs_decision">
                      <FundDecision data={data} symbol={active} r={r} />
                    </WsSection>
                  )}
                </>
              )}
            </>
          )}
      </div>
    </div>
  )
}
