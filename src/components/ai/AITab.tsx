import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { useWellnessData } from '../../hooks/useDashboardData'
import { BriefingPanel } from './BriefingPanel'
import { WsSection } from '../workspace/WorkspaceContext'

import { buildTextContext, SUGGESTION_GROUPS } from './buildContext'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { StatTile } from '../ui/StatTile'
import { TABS, type TabId } from '../layout/AppHeader'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const M = 'var(--text2)'



interface Props {
  data: DashboardData
  onNavigate?: (tab: TabId) => void
  /** Routes a symbol-bearing chip to the Research tab pre-filtered to that symbol. */
  onNavigateToResearch?: (symbol: string) => void
}
interface AIStatus { ollama_running: boolean; model: string | null }
interface AIModel  { id: string; name: string; label?: string; source: 'local' | 'cloud'; recommended?: boolean; size?: number }
interface AIModels { local_models: AIModel[]; cloud_models: AIModel[] }
interface AIKeys   { keys: string[] }

interface SmartSuggestion {
  label:  string
  prompt: string
  group:  'evergreen' | 'signal'
}

interface SmartSuggestionsResponse {
  suggestions:  SmartSuggestion[]
  signal_count: number
}

async function fetchSuggestions(): Promise<SmartSuggestionsResponse> {
  const r = await fetch('/api/suggestions')
  if (!r.ok) throw new Error(`suggestions fetch failed: ${r.status}`)
  return r.json()
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tokens_used?: number
  model?: string
  error?: boolean
}

interface AIResponse {
  success: boolean
  response: string
  model?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  error?: string
  tokens_prompt?: number
  tokens_completion?: number
}

// ── API fetchers ──────────────────────────────────────────────────────────────

async function fetchAIStatus(): Promise<AIStatus> {
  const res = await fetch('/api/ai/status')
  if (!res.ok) return { ollama_running: false, model: null }
  return res.json()
}

async function fetchModels(): Promise<AIModels> {
  const res = await fetch('/api/ai/models')
  if (!res.ok) return { local_models: [], cloud_models: [] }
  const d = await res.json()
  // API returns { local_models: [...], cloud_models: [...] }
  if (d.local_models != null || d.cloud_models != null) return d
  // Fallback: flat array
  const arr = Array.isArray(d) ? d : []
  return {
    local_models: arr.filter((m: AIModel) => m.source === 'local'),
    cloud_models: arr.filter((m: AIModel) => m.source === 'cloud'),
  }
}

async function fetchKeys(): Promise<AIKeys> {
  const res = await fetch('/api/ai/keys')
  if (!res.ok) return { keys: [] }
  return res.json()
}

async function sendQuery(payload: {
  prompt: string
  model: string
  apiKeyId: string
  context: string      // formatted text string — NOT a JS object
}): Promise<AIResponse> {
  const res = await fetch('/api/ai/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`)
  }
  return res.json()
}


// ── Small UI helpers ─────────────────────────────────────────────────────────

function Divider() {
  return <div style={{ height: 1, background: 'var(--border2)', margin: '6px 0' }} />
}

// ── Main component ────────────────────────────────────────────────────────────

export function AITab({ data, onNavigate, onNavigateToResearch }: Props) {
  // Mode toggle: 'simple' (existing chat-only) | 'advanced' (briefing panel + chat).
  // Persisted to localStorage so the user's preference survives reloads.
  // Global Simple/Advanced (header toggle). Simple = briefing; Advanced = briefing + chat.
  const [mode] = useGlobalViewMode()

  // Chip click → navigate.
  //  - Symbol-bearing chip (e.g. "SMH concentration"): jump to Research with
  //    that symbol pre-loaded. Research is the only tab with a built-in symbol
  //    filter, so this is the most useful destination for "tell me more about
  //    this ticker" intent.
  //  - Portfolio-wide chip (vol budget, tax pressure, top-3): fall back to the
  //    detector-declared `tab` field (e.g. 'tax', 'returns').
  const handleChipClick = useCallback((tab: string, symbol: string | null) => {
    if (symbol && onNavigateToResearch) {
      onNavigateToResearch(symbol)
      return
    }
    if (!onNavigate) return
    // Detector tab names can differ from TabId (e.g. 'cash_flow') — normalise, then
    // only navigate to tabs that exist in the header.
    const norm = tab === 'cash_flow' ? 'cashflow' : tab
    if (TABS.some(t => t.id === norm)) onNavigate(norm as TabId)
  }, [onNavigate, onNavigateToResearch])

  const [model,      setModel]     = useState('cloud:kimi-k2.5')
  const [apiKeyId,  setApiKeyId]  = useState('')
  const [useLocal,  setUseLocal]  = useState(false)
  const autoSwitched = useRef(false)   // only auto-switch once; honour manual override after
  const [input,     setInput]     = useState('')
  const [messages,  setMessages]  = useState<ChatMessage[]>([])
  const [totalPT,   setTotalPT]   = useState(0)
  const [totalCT,   setTotalCT]   = useState(0)
  const [reqCount,  setReqCount]  = useState(0)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const { data: status }     = useQuery({ queryKey: ['ai-status'], queryFn: fetchAIStatus, staleTime: 30_000 })
  const { data: modelsData } = useQuery({ queryKey: ['ai-models'], queryFn: fetchModels,   staleTime: 60_000 })
  const { data: keysData }   = useQuery({ queryKey: ['ai-keys'],   queryFn: fetchKeys,     staleTime: 60_000 })
  // Context-aware starter prompts derived from current signals layer.
  // Refreshes every 60s (cheap deterministic call — no LLM hit on the server).
  const { data: smartData }  = useQuery({ queryKey: ['ai-suggestions'], queryFn: fetchSuggestions, staleTime: 60_000, enabled: mode === 'advanced' })
  const { data: wellness }   = useWellnessData()

  const cloudModels = modelsData?.cloud_models ?? []
  const localModels = modelsData?.local_models ?? []
  const keys        = keysData?.keys ?? []
  const ollamaUp    = status?.ollama_running ?? false

  // Auto-select first key
  useEffect(() => {
    if (keys.length > 0 && !apiKeyId) setApiKeyId(keys[0])
  }, [keys, apiKeyId])

  // Auto-default to local if Ollama is running and has models (matches V1 behaviour).
  // Only fires once on first load — manual toggle afterwards is respected.
  useEffect(() => {
    if (autoSwitched.current) return
    if (ollamaUp && localModels.length > 0) {
      autoSwitched.current = true
      setUseLocal(true)
    } else if (!ollamaUp && modelsData != null) {
      // Ollama confirmed offline — stay on cloud, mark done so we don't flip later
      autoSwitched.current = true
    }
  }, [ollamaUp, localModels.length, modelsData])

  // Auto-select appropriate model when mode switches
  useEffect(() => {
    if (useLocal && localModels.length > 0) {
      setModel(localModels[0].id)
    } else if (!useLocal && cloudModels.length > 0) {
      const rec = cloudModels.find(m => m.recommended)
      setModel((rec ?? cloudModels[0]).id)
    }
  }, [useLocal]) // eslint-disable-line react-hooks/exhaustive-deps

  const { mutate: doQuery, isPending } = useMutation({
    mutationFn: sendQuery,
    onSuccess: (res) => {
      const pt = res.usage?.prompt_tokens     ?? res.tokens_prompt     ?? 0
      const ct = res.usage?.completion_tokens ?? res.tokens_completion ?? 0
      const content = res.success ? res.response : `Error: ${res.error ?? 'Unknown error'}`
      setMessages(prev => [...prev, {
        role: 'assistant', content, timestamp: Date.now(),
        tokens_used: pt + ct, model: res.model,
        error: !res.success,
      }])
      setTotalPT(p => p + pt)
      setTotalCT(p => p + ct)
      setReqCount(p => p + 1)
    },
    onError: (err: Error) => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: ` ${err.message}.\n\nTip: Make sure your API key is selected in the dropdown. If using cloud, select your key from the API KEY dropdown.`,
        timestamp: Date.now(), error: true,
      }])
    },
  })

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = useCallback((prompt: string) => {
    if (!prompt.trim() || isPending) return
    setMessages(prev => [...prev, { role: 'user', content: prompt, timestamp: Date.now() }])
    setInput('')
    const context = buildTextContext(data, wellness)
    doQuery({ prompt, model, apiKeyId, context })
  }, [isPending, model, apiKeyId, data, doQuery])

  const activeModels = useLocal ? localModels : cloudModels

  return (
    <div style={{ paddingBottom: 64, display: 'flex', flexDirection: 'column' }}>
      <BriefingPanel onChipClick={handleChipClick} showDetails={mode === 'simple'} />

      {/* ── Portfolio context tiles (advanced) ── */}
      {mode === 'advanced' && (() => {
        const pnl = data.summary.total_pnl
        const conf = data.portfolio_intel?.system_confidence_score
        const regime = data.portfolio_intel?.market_regime
        const vix = data.vix_current
        const convRoom = data.tax_data?.conv_room_real
        const confBadge = conf == null ? 'none' : conf >= 70 ? 'green' : conf >= 50 ? 'yellow' : 'red'
        const regimeBadge = regime === 'EXPANSION' ? 'green' : regime === 'RISK-OFF' ? 'red' : 'yellow'
        const vixBadge = vix == null ? 'none' : vix > 25 ? 'red' : vix > 18 ? 'orange' : 'green'
        return (
          <WsSection id="ai_context" value={regime ?? undefined} status={regime === 'EXPANSION' ? 'ok' : regime === 'RISK-OFF' ? 'alert' : regime ? 'watch' : undefined}>
          <div style={{ padding: '16px 0' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 0,
            }}>
              <StatTile
                label="PORTFOLIO VALUE"
                value={fmtMoneyFull(data.summary.total_value)}
                color="var(--text)"
                badge="none"
              />
              <StatTile
                label="ANNUAL INCOME"
                value={`${fmtMoney(data.summary.total_income)}/yr`}
                color={G}
                badge="green"
              />
              <StatTile
                label="TOTAL P&L"
                value={`${pnl >= 0 ? '+' : ''}${fmtMoneyFull(pnl)}`}
                color={pnl >= 0 ? G : R}
                badge={pnl >= 0 ? 'green' : 'red'}
                badgeLabel={pnl >= 0 ? '▲ GAIN' : '▼ LOSS'}
                trend={pnl >= 0 ? 'up' : 'down'}
              />
              <StatTile
                label="MARKET REGIME"
                value={regime ?? '—'}
                color={regime === 'EXPANSION' ? G : regime === 'RISK-OFF' ? R : A}
                badge={regimeBadge}
                metricId="market_regime"
              />
              <StatTile
                label="CONFIDENCE"
                value={`${conf?.toFixed(0) ?? '—'}/100`}
                color={conf == null ? M : conf >= 70 ? G : conf >= 50 ? A : R}
                badge={confBadge}
                metricId="confidence"
              />
              {vix != null && (
                <StatTile
                  label="VIX"
                  value={vix.toFixed(2)}
                  color={vix > 25 ? R : vix > 18 ? A : G}
                  badge={vixBadge}
                />
              )}
              {convRoom != null && (
                <StatTile
                  label="CONV ROOM"
                  value={fmtMoney(convRoom)}
                  color={A}
                  badge="orange"
                  metricId="conv_room"
                />
              )}
            </div>
          </div>
          </WsSection>
        )
      })()}

      {mode === 'advanced' && (
      <WsSection id="ai_chat" value={messages.length > 0 ? `${messages.length} messages` : undefined} status="info">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 56, paddingBottom: 16 }}>
          <h2 style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>Ask the portfolio</h2>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--fd-muted)' }}>Full portfolio context is attached to every question</span>
        </div>

      {/* ── Top control bar (Advanced/chat only — Simple is briefing-only) ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        background: 'var(--surface)', borderBottom: '1px solid var(--border2)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {/* Title */}
        <span style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '0.8px', marginRight: 4 }}>◈ AI PORTFOLIO ANALYST</span>

        {/* Local/Cloud toggle — mirrors V1 checkbox: auto-checked when Ollama available */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: ollamaUp ? 'pointer' : 'not-allowed', flexShrink: 0, userSelect: 'none' }}
          title={ollamaUp ? 'Toggle between local Ollama and cloud API' : 'Ollama is not running — start Ollama to enable local mode'}>
          <input
            type="checkbox"
            checked={useLocal}
            disabled={!ollamaUp}
            onChange={e => {
              autoSwitched.current = true   // user explicitly toggled — stop auto-switching
              setUseLocal(e.target.checked)
            }}
            style={{ width: 14, height: 14, accentColor: A, cursor: ollamaUp ? 'pointer' : 'not-allowed' }}
          />
          <span style={{ fontSize: 12, fontWeight: 500, color: useLocal ? A : M, fontFamily: 'var(--font-mono)' }}>
            USE LOCAL OLLAMA
          </span>
        </label>

        {/* Ollama status dot */}
        <span style={{ fontSize: 12, color: ollamaUp ? G : R, flexShrink: 0 }}>
          <span className={ollamaUp ? 'anim-blink' : ''}>●</span>
          {' '}{ollamaUp
            ? (localModels.length > 0 ? `ONLINE — ${localModels.length} model${localModels.length > 1 ? 's' : ''}` : 'ONLINE — no models pulled')
            : 'OFFLINE — using cloud API'}
        </span>

        <div style={{ width: 1, height: 18, background: 'var(--border2)', flexShrink: 0 }} />

        {/* Model selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: M, fontWeight: 500 }}>MODEL:</span>
          <select value={model} onChange={e => setModel(e.target.value)}
            style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--fd-hairline)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '2px 4px', cursor: 'pointer', maxWidth: 200 }}>
            {useLocal
              ? localModels.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.size ? ` (${(m.size / 1e9).toFixed(1)}GB)` : ''}
                  </option>
                ))
              : (() => {
                  const rec    = cloudModels.filter(m => m.recommended)
                  const others = cloudModels.filter(m => !m.recommended)
                  return (
                    <>
                      {rec.length > 0 && (
                        <optgroup label=" Recommended">
                          {rec.map(m => <option key={m.id} value={m.id}>{m.label ?? m.name}</option>)}
                        </optgroup>
                      )}
                      {others.length > 0 && (
                        <optgroup label=" All Cloud">
                          {others.map(m => <option key={m.id} value={m.id}>{m.label ?? m.name}</option>)}
                        </optgroup>
                      )}
                      {activeModels.length === 0 && <option value="cloud:kimi-k2.5">Kimi K2.5 (default)</option>}
                    </>
                  )
                })()
            }
          </select>
        </div>

        {/* API Key selector */}
        {!useLocal && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: M, fontWeight: 500 }}>API KEY:</span>
            <select value={apiKeyId} onChange={e => setApiKeyId(e.target.value)}
              style={{ background: 'var(--bg)', color: keys.length ? 'var(--text)' : R, border: `1px solid ${keys.length ? 'var(--border2)' : R}`, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '2px 4px', cursor: 'pointer', maxWidth: 140 }}>
              {keys.length === 0
                ? <option value=""> No keys in ai_keys.json</option>
                : keys.map(k => <option key={k} value={k}>{k}</option>)
              }
            </select>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Usage stats */}
        <div style={{ display: 'flex', gap: 8, fontSize: 12, color: M }}>
          <span>REQS: <span style={{ color: A, fontWeight: 500 }}>{reqCount}</span></span>
          <span>PROMPT: <span style={{ color: A, fontWeight: 500 }}>{totalPT.toLocaleString()}tk</span></span>
          <span>COMPLETION: <span style={{ color: A, fontWeight: 500 }}>{totalCT.toLocaleString()}tk</span></span>
        </div>
      </div>

      {/* ── Advanced mode = the natural-language Q&A surface (chat + sidebar) */}
      <div style={{ height: '72vh', display: 'flex', gap: 0, overflow: 'hidden', borderTop: '2px solid var(--fd-rule)', borderBottom: '1px solid var(--fd-hairline)' }}>

        {/* ── Left sidebar: suggestion groups ─────────────────────────── */}
        <div style={{ width: 240, flexShrink: 0, background: 'var(--fd-page)', borderRight: '1px solid var(--fd-hairline)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>

          {/* Smart Suggestions — context-aware, derived from current signals.
              Falls back silently if /api/suggestions returns nothing. */}
          {smartData?.suggestions && smartData.suggestions.length > 0 && (
            <div>
              <div style={{
                padding: '8px 12px 6px',
                fontSize: 12, fontWeight: 500, color: A,
                letterSpacing: '0.6px', fontFamily: 'var(--font-mono)',
                borderBottom: '1px solid var(--border2)', background: 'var(--bg)',
                display: 'flex', alignItems: 'baseline', gap: 6,
              }}>
                <span> Smart</span>
                {smartData.signal_count > 0 && (
                  <span style={{ fontSize: 12, color: M, marginLeft: 'auto' }}>
                    {smartData.signal_count} signal{smartData.signal_count > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {smartData.suggestions.map((item, i) => (
                <button
                  key={`smart-${i}-${item.label}`}
                  onClick={() => send(item.prompt)}
                  disabled={isPending}
                  title={item.prompt}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 12px', cursor: 'pointer',
                    border: 'none', borderBottom: '1px solid var(--border2)',
                    background: 'transparent',
                    color: item.group === 'signal' ? A : 'var(--text)',
                    fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: 1.3,
                    fontWeight: item.group === 'signal' ? 600 : 400,
                    opacity: isPending ? 0.5 : 1,
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--fd-card)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {SUGGESTION_GROUPS.map(group => (
            <div key={group.label}>
              <div style={{
                padding: '8px 12px 6px',
                fontSize: 12, fontWeight: 500, color: A,
                letterSpacing: '0.6px', fontFamily: 'var(--font-mono)',
                borderBottom: '1px solid var(--border2)', background: 'var(--bg)',
              }}>
                {group.label}
              </div>
              {group.items.map(item => (
                <button key={item.label} onClick={() => send(item.prompt)} disabled={isPending}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 12px', cursor: 'pointer',
                    border: 'none', borderBottom: '1px solid var(--border2)',
                    background: 'transparent', color: 'var(--text)',
                    fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: 1.3,
                    opacity: isPending ? 0.5 : 1,
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--fd-card)'; (e.currentTarget as HTMLElement).style.color = A }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}

          {/* Context preview */}
          <Divider />
          <div style={{ padding: '10px 12px' }}>
            <div style={{
              fontSize: 12, fontWeight: 500, color: A,
              letterSpacing: '0.6px', fontFamily: 'var(--font-mono)',
              marginBottom: 6,
            }}>
              Context injected
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.55 }}>
              <div>✓ Portfolio totals</div>
              <div>✓ All positions</div>
              <div>✓ Tax planning data</div>
              <div>✓ Income history</div>
              <div>✓ Spending intelligence</div>
              <div>✓ Technical snapshots</div>
              <div>✓ Fund decisions</div>
              <div>✓ Market regime</div>
            </div>
          </div>
        </div>

        {/* ── Chat area ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: M, textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 40, lineHeight: 1, color: 'var(--fd-ink)', marginBottom: 12 }}>Ask <em>anything</em>.</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 420 }}>
                  Ask anything about your portfolio in natural language.<br />
                  Your full portfolio data — positions, income, tax, spending — is automatically included in every query.
                </div>
                {keys.length === 0 && (
                  <div style={{ marginTop: 16, padding: '8px 14px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', fontSize: 12, color: R, maxWidth: 360 }}>
                     No API keys found. Add your key to <code>server/ai_keys.json</code> and restart the server.
                  </div>
                )}
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)' }}>
                  Select a suggestion on the left or type a question below.
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-start' }}>
                {/* Avatar */}
                <div style={{
                  fontSize: 12, fontWeight: 500, color: msg.role === 'user' ? A : M,
                  fontFamily: 'var(--font-mono)', minWidth: 24, marginTop: 4,
                  textAlign: msg.role === 'user' ? 'right' : 'left',
                }}>
                  {msg.role === 'user' ? 'YOU' : 'AI'}
                </div>

                {/* Bubble */}
                <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{
                    padding: '14px 18px', borderRadius: 12,
                    background: msg.role === 'user' ? 'var(--as-cobalt)' : 'var(--fd-card)',
                    color: msg.role === 'user' ? 'var(--as-warm-white)' : msg.error ? 'var(--fd-negative)' : 'var(--fd-ink)',
                    fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {msg.content}
                  </div>
                  {/* Meta line */}
                  <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text3)', paddingLeft: msg.role === 'user' ? 0 : 4 }}>
                    <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    {msg.tokens_used != null && <span>{msg.tokens_used.toLocaleString()} tokens</span>}
                    {msg.model && <span style={{ color: 'var(--text3)' }}>{msg.model.replace('cloud:', '')}</span>}
                  </div>
                </div>
              </div>
            ))}

            {isPending && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 12, color: M, fontFamily: 'var(--font-mono)', minWidth: 24, marginTop: 4 }}>AI</div>
                <div style={{ padding: '14px 18px', background: 'var(--fd-card)', borderRadius: 12 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--fd-muted)' }}>Analysing your portfolio…</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--fd-hairline)', background: 'var(--fd-page)', display: 'flex', gap: 8, flexShrink: 0 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
              placeholder="Ask about your portfolio… (Enter to send, Shift+Enter for newline)"
              disabled={isPending}
              rows={2}
              style={{
                flex: 1, resize: 'none', background: 'var(--fd-card)', border: '1px solid transparent',
                color: 'var(--fd-ink)', fontFamily: 'var(--font-sans)', fontSize: 14,
                padding: '10px 14px', lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button onClick={() => send(input)} disabled={isPending || !input.trim()}
                style={{
                  flex: 1, padding: '0 18px', background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none',
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  opacity: isPending || !input.trim() ? 0.4 : 1, letterSpacing: '1px',
                }}>
                {isPending ? 'Asking…' : 'Ask'}
              </button>
              {messages.length > 0 && (
                <button onClick={() => setMessages([])}
                  style={{
                    padding: '4px 8px', background: 'transparent', border: '1px solid var(--fd-hairline)',
                    color: M, fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer',
                  }}>
                  CLEAR
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      </WsSection>
      )}

    </div>
  )
}
