import { useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine,
} from 'recharts'
import { MiniBar } from '../ui/Sparkline'
import { fmtMoney, fmtMoneyFull } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { G, R, A, M } from './DetailTab.constants'
import { SCORE_GREEN, SCORE_AMBER } from '../../utils/retirementEngine'
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_CURSOR } from '../ui/chartTooltip'

// ── Per-account income detail modal ──────────────────────────────────────────

function AccountDetailModal({ accountKey, data, onClose }: {
  accountKey: string
  data: DashboardData
  onClose: () => void
}) {
  const acctHist  = data.income_history?.by_account?.[accountKey]
  const acctLabel = data.accounts.find(a => a.key === accountKey)?.label ?? accountKey

  const ytdBySymbol = Object.entries(acctHist?.by_symbol ?? {})
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)

  const receivedTxns = (data.income_history?.transactions ?? [])
    .filter(t => t.amount > 0 && t.account === accountKey)
    .sort((a, b) => b.date.localeCompare(a.date))

  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }
  const labelCss: React.CSSProperties = {
    fontSize: 12, fontWeight: 500, textTransform: 'uppercase' as const,
    letterSpacing: '1px', color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginBottom: 4,
  }
  const thCss: React.CSSProperties = {
    fontSize: 12, fontWeight: 500, color: 'var(--text3)', fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase' as const, letterSpacing: '0.8px',
    padding: '2px 4px', borderBottom: '1px solid var(--fd-hairline)', textAlign: 'left' as const,
  }
  const tdCss: React.CSSProperties = {
    fontSize: 12, fontFamily: 'var(--font-mono)', padding: '2px 4px',
    borderBottom: '1px solid var(--fd-hairline)', color: 'var(--text2)',
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)', zIndex: 999 }} />
      <div style={{
        position: 'fixed', top: '10vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(580px, 94vw)', maxHeight: '80vh', overflowY: 'auto',
        background: 'var(--bg)', border: '1px solid var(--fd-hairline)',
        borderRadius: 0, zIndex: 1000, padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', ...mono }}>
            {acctLabel} — Income Detail
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>

        {/* Summary */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 2, ...mono }}>YTD RECEIVED</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: G, ...mono }}>{fmtMoneyFull(acctHist?.total ?? 0)}</div>
        </div>

        <div style={{ borderTop: '1px solid var(--fd-hairline)' }} />

        {/* YTD by symbol */}
        <div>
          <div style={labelCss}>By Symbol — YTD Received</div>
          {ytdBySymbol.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--text3)', ...mono }}>No income data.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCss}>Symbol</th>
                    <th style={{ ...thCss, textAlign: 'right' as const }}>YTD Received</th>
                  </tr>
                </thead>
                <tbody>
                  {ytdBySymbol.map(([sym, amt]) => (
                    <tr key={sym}>
                      <td style={{ ...tdCss, color: 'var(--text)', fontWeight: 500 }}>{sym}</td>
                      <td style={{ ...tdCss, textAlign: 'right', color: G, fontWeight: 500 }}>{fmtMoneyFull(amt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>

        <div style={{ borderTop: '1px solid var(--fd-hairline)' }} />

        {/* Individual transactions */}
        <div>
          <div style={labelCss}>Transactions Received (YTD)</div>
          {receivedTxns.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--text3)', ...mono }}>No transactions recorded.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCss}>Date</th>
                    <th style={thCss}>Symbol</th>
                    <th style={{ ...thCss, textAlign: 'right' as const }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {receivedTxns.map((t, i) => (
                    <tr key={i}>
                      <td style={tdCss}>{t.date}</td>
                      <td style={{ ...tdCss, color: 'var(--text)', fontWeight: 500 }}>{t.symbol}</td>
                      <td style={{ ...tdCss, textAlign: 'right', color: G, fontWeight: 500 }}>{fmtMoneyFull(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      </div>
    </>
  )
}

const Q_MONTHS = [[0,1,2], [3,4,5], [6,7,8], [9,10,11]]

// ── Shared micro-components ───────────────────────────────────────────────────
function Lbl({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>{children}</div>
}
function StatRow({ label, value, color = 'var(--text)', mono = true }: { label: string; value: React.ReactNode; color?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--text2)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color, fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function IncomeHistory({ data, months, ia }: { data: DashboardData; months: string[]; ia: DashboardData['income_analytics'] }) {
  const [detailAccount, setDetailAccount] = useState<string | null>(null)
  const hist = data.income_history
  if (!hist) return <div style={{ padding: 16, color: 'var(--text2)', fontSize: 12 }}>No income history data.</div>

  // Monthly aggregation — current year only
  const currentYear = new Date().getFullYear()
  const byMonth: Record<number, number> = {}
  for (const tx of hist.transactions ?? []) {
    const txDate = new Date(tx.date)
    if (txDate.getFullYear() !== currentYear) continue
    byMonth[txDate.getMonth()] = (byMonth[txDate.getMonth()] ?? 0) + tx.amount
  }
  const vals = Array.from({ length: 12 }, (_, i) => byMonth[i] ?? 0)
  const ytd  = hist.ytd_total ?? 0

  // Analytics
  const fwd12        = ia?.portfolio_fwd_12m ?? 0
  const yieldPct     = ia?.yield_pct ?? 0
  const growthRate   = ia?.income_growth_rate ?? 0
  const qualScore    = ia?.avg_quality_score ?? 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iaAny        = ia as any
  const monthlyAvg   = (iaAny?.monthly_avg ?? Math.round(fwd12 / 12)) as number
  const ceiling      = (iaAny?.ceiling ?? 0) as number

  // Bracket ceiling — used only for dividend-only headroom (Portfolio tab is a dividend view)
  const td         = data.tax_data
  const totalValue = data.summary.total_value
  const taxCeiling = td?.target_bracket_ceiling ?? ceiling

  // FWD 12M yield (FWD income / portfolio value) — more accurate than TTM yield_pct
  const fwdYield   = totalValue > 0 ? (fwd12 / totalValue) * 100 : yieldPct

  // Correct EOY projection: YTD received + FWD run rate for remaining days in year
  const _startYr   = new Date(new Date().getFullYear(), 0, 1)
  const _endYr     = new Date(new Date().getFullYear() + 1, 0, 1)
  const _daysInYr  = Math.round((_endYr.getTime() - _startYr.getTime()) / 86400000)
  const _dayOfYr   = Math.round((Date.now() - _startYr.getTime()) / 86400000)
  const projEoyFwd = ytd + (fwd12 / _daysInYr) * (_daysInYr - _dayOfYr)

  // Tax composition
  const ti       = iaAny?.forward_tax_impact as { fwd_ordinary?: number; fwd_qualified?: number; fwd_roc?: number; fwd_tax_est?: number } | null
  const fwdOrd   = ti?.fwd_ordinary  ?? 0
  const fwdQual  = ti?.fwd_qualified ?? 0
  const fwdRoc   = ti?.fwd_roc       ?? 0
  const fwdTax   = ti?.fwd_tax_est   ?? 0
  const compSum  = Math.max(fwdOrd + fwdQual + fwdRoc, 1)
  const ordPct   = Math.round(fwdOrd  / compSum * 100)
  const qualPct  = Math.round(fwdQual / compSum * 100)
  const rocPct   = Math.round(fwdRoc  / compSum * 100)

  // Stress test
  type SR = { fwd_12m: number; tax_est?: number; ceiling_gap: number; income_gap: number }
  const stress = iaAny?.stress_test as { down_10?: SR; down_20?: SR; down_30?: SR } | null

  // Top contributors
  const top5raw: [string, number][] = (ia?.income_attribution as any)?.top5 ?? []
  const top5 = top5raw.slice(0, 6).map(([sym, pct]) => ({ sym, pct: pct / 100 }))

  // Derived
  const qualColor   = qualScore >= SCORE_GREEN ? G : qualScore >= SCORE_AMBER ? A : R
  const qualRating  = qualScore >= SCORE_GREEN ? 'HIGH' : qualScore >= SCORE_AMBER ? 'MIXED' : 'ORD-HEAVY'
  const growthColor = growthRate >= 0.02 ? G : growthRate >= 0 ? A : R
  const nowMonth    = new Date().getMonth()
  const pctDone     = fwd12 > 0 ? Math.min(100, ytd / fwd12 * 100) : 0
  // Portfolio tab uses dividend-only basis throughout — no AGI mixing.
  const divCeilingRoom = taxCeiling > 0 ? Math.max(0, taxCeiling - fwd12) : 0
  const bracketPct  = taxCeiling > 0 ? Math.min(100, fwd12 / taxCeiling * 100) : 0

  const chartData = vals.map((v, i) => ({
    month: months[i]?.slice(0, 3) ?? '',
    value: v,
    fill: i < nowMonth ? G : i === nowMonth ? A: 'var(--fd-hairline)',
  }))

  // ── Stacked-by-account chart data ────────────────────────────────────────
  // Assign a color per account based on its key pattern
  const acctColor = (key: string) =>
    key.includes('roth')     ? G
    : key.includes('rollover') || (key.includes('ira') && !key.includes('roth')) ? 'var(--fd-accent)'
    : A   // taxable / individual / joint

  const stackAccounts = data.accounts.filter(acct => {
    const ah = hist.by_account?.[acct.key]
    if (!ah) return false
    return Array.from({ length: 12 }, (_, i) => {
      const raw = (ah.by_month ?? [])[i]
      return typeof raw === 'number' ? raw : (raw as { total?: number })?.total ?? 0
    }).some(v => v > 0)
  })

  const stackedData = Array.from({ length: 12 }, (_, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: Record<string, any> = {
      month: months[i]?.slice(0, 3) ?? '',
      isCurrent: i === nowMonth,
      isPast:    i < nowMonth,
    }
    for (const acct of stackAccounts) {
      const ah  = hist.by_account?.[acct.key]
      const raw = (ah?.by_month ?? [])[i]
      row[acct.key] = typeof raw === 'number' ? raw : (raw as { total?: number })?.total ?? 0
    }
    return row
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ChartTip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const total = (payload as { value: number }[]).reduce((s, p) => s + (p.value ?? 0), 0)
    return (
      <div style={TOOLTIP_STYLE}>
        <div style={TOOLTIP_LABEL_STYLE}>{label}</div>
        {[...payload].reverse().map((p: any) => (
          p.value > 0 && (
            <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
              <span style={{ color: p.fill }}>{p.name}</span>
              <span style={{ color: 'var(--text)' }}>{fmtMoneyFull(p.value)}</span>
            </div>
          )
        ))}
        {payload.length > 1 && total > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--border2)', marginTop: 4, paddingTop: 4, fontWeight: 500 }}>
            <span style={{ color: 'var(--text2)' }}>Total</span>
            <span style={{ color: G }}>{fmtMoneyFull(total)}</span>
          </div>
        )}
      </div>
    )
  }

  // Shared panel style
  const panel = {
    background: 'var(--surface)',
    border: '1px solid var(--fd-hairline)',
    borderRadius: 0,
    padding: '12px 14px',
  } as const

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {detailAccount && (
        <AccountDetailModal
          accountKey={detailAccount}
          data={data}
          onClose={() => setDetailAccount(null)}
        />
      )}

      {/* ── 1. KPI HEADER — 5-col cards ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        <div style={{ ...panel, borderLeft: `3px solid ${G}` }}>
          <Lbl>YTD RECEIVED</Lbl>
          <div style={{ fontSize: 22, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(ytd)}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>{fmtMoney(monthlyAvg)}/mo avg</div>
        </div>
        <div style={panel}>
          <Lbl>FWD 12 MONTHS</Lbl>
          <div style={{ fontSize: 22, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(fwd12)}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>{fmtMoney(fwd12 / 12)}/mo</div>
        </div>
        <div style={panel}>
          <Lbl>PROJ END-OF-YEAR</Lbl>
          <div style={{ fontSize: 22, fontWeight: 500, color: A, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(projEoyFwd)}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>{pctDone.toFixed(0)}% complete</div>
        </div>
        <div style={panel}>
          <Lbl>PORTFOLIO YIELD</Lbl>
          <div style={{ fontSize: 22, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fwdYield.toFixed(2)}%</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>FWD yield</div>
        </div>
        <div style={panel}>
          <Lbl>GROWTH 1Y</Lbl>
          <div style={{ fontSize: 22, fontWeight: 500, color: growthColor, fontFamily: 'var(--font-mono)' }}>
            {growthRate >= 0 ? '+' : ''}{(growthRate * 100).toFixed(1)}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>year-over-year</div>
        </div>
      </div>

      {/* ── 2. BY ACCOUNT — QUARTERLY & MONTHLY BREAKDOWN ─────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Lbl>BY ACCOUNT — QUARTERLY &amp; MONTHLY BREAKDOWN</Lbl>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>

          {/* Per-account cards */}
          {data.accounts.map(acct => {
            const ah = hist.by_account?.[acct.key]
            if (!ah) return null
            const acctVals = Array.from({ length: 12 }, (_, i) => {
              const raw = (ah.by_month ?? [])[i]
              return typeof raw === 'number' ? raw : (raw as { total?: number })?.total ?? 0
            })
            if (!acctVals.some(v => v > 0)) return null
            const acctData = acctVals.map((v, i) => ({ month: months[i]?.slice(0, 1) ?? '', value: v }))
            const ia2      = iaAny?.by_account?.[acct.key] as { fwd_12m?: number; ytd_income?: number } | undefined
            const acctFwd  = ia2?.fwd_12m    ?? 0
            const acctYtd  = ah.total ?? ia2?.ytd_income ?? 0
            const rawPace  = acctFwd > 0 ? (acctYtd / acctFwd * 100) : 0
            const isFront  = rawPace > 100
            const isRoth   = acct.key === 'roth_ira'
            const dot      = acctColor(acct.key)

            return (
              <div key={acct.key} style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Header: dot + label + YTD + Detail button */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: 3, background: dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase' as const, color: 'var(--text2)', letterSpacing: '0.5px' }}>{acct.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(acctYtd)}</span>
                    <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>YTD</span>
                    <button
                      onClick={() => setDetailAccount(acct.key)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)', padding: '0 2px', textDecoration: 'underline', textUnderlineOffset: 2, lineHeight: 1 }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--text2)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
                    >Detail ▸</button>
                  </div>
                </div>

                {/* FWD + pacing note */}
                {acctFwd > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                    FWD{' '}
                    <span style={{ color: 'var(--text2)', fontWeight: 500 }}>{fmtMoneyFull(acctFwd)}/yr</span>
                    {!isFront && !isRoth && (
                      <span style={{ marginLeft: 6, color: rawPace >= 80 ? G : A }}>{rawPace.toFixed(0)}% pacing</span>
                    )}
                    {isFront && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>front-loaded</span>}
                    {isRoth  && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>ROC-heavy</span>}
                  </div>
                )}

                {/* Mini monthly sparkbar */}
                <ResponsiveContainer width="100%" height={38}>
                  <BarChart data={acctData} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                    <XAxis dataKey="month" tick={{ fill: 'var(--text3)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={14}>
                      {acctData.map((d, i) => (
                        <Cell key={i} fill={i < nowMonth ? dot : i === nowMonth ? A : d.value > 0 ? dot: 'var(--fd-hairline)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                {/* Q1–Q4 mini grid — 2×2 so amounts have room */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  {Q_MONTHS.map((qm, q) => {
                    const qTotal  = qm.reduce((s, m) => s + acctVals[m], 0)
                    const qDone   = Math.max(...qm) < nowMonth
                    const qCurr   = qm.includes(nowMonth)
                    const qColor  = qDone ? G : qCurr ? A : 'var(--text3)'
                    const badge   = qDone ? '✓' : qCurr ? '◄' : 'UPCOMING'
                    return (
                      <div key={q} style={{ background: 'var(--fd-card)', borderRadius: 0, padding: '5px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>Q{q + 1}</span>
                        <div style={{ fontSize: 12, fontWeight: 500, color: qColor, fontFamily: 'var(--font-mono)', textAlign: 'center' as const }}>
                          {qTotal > 0 ? fmtMoneyFull(qTotal) : '—'}
                        </div>
                        <div style={{ fontSize: 12, color: qColor }}>{qTotal > 0 ? badge : (qCurr ? '◄ NOW' : qDone ? '' : 'SOON')}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* TOTAL summary card */}
          <div style={{ ...panel, borderLeft: `3px solid ${G}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 7, height: 7, borderRadius: 3, background: G, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase' as const, color: 'var(--text2)', letterSpacing: '0.5px' }}>All Accounts</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 500, color: G, fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(ytd)}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
              FWD{' '}
              <span style={{ color: 'var(--text2)', fontWeight: 500 }}>{fmtMoneyFull(fwd12)}/yr</span>
              <span style={{ marginLeft: 6, color: pctDone >= 80 ? G : A }}>{pctDone.toFixed(0)}% done</span>
            </div>
            <ResponsiveContainer width="100%" height={38}>
              <BarChart data={chartData} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                <XAxis dataKey="month" tick={{ fill: 'var(--text3)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={14}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {Q_MONTHS.map((qm, q) => {
                const qTotal = qm.reduce((s, m) => s + vals[m], 0)
                const qDone  = Math.max(...qm) < nowMonth
                const qCurr  = qm.includes(nowMonth)
                const qColor = qDone ? G : qCurr ? A : 'var(--text3)'
                const badge  = qDone ? '✓' : qCurr ? '◄ CURRENT' : 'UPCOMING'
                return (
                  <div key={q} style={{ background: 'var(--fd-card)', borderRadius: 0, padding: '5px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>Q{q + 1}</span>
                    <div style={{ fontSize: 12, fontWeight: 500, color: qColor, fontFamily: 'var(--font-mono)', textAlign: 'center' as const }}>
                      {qTotal > 0 ? fmtMoneyFull(qTotal) : '—'}
                    </div>
                    <div style={{ fontSize: 12, color: qColor }}>{qTotal > 0 ? badge : (qCurr ? '◄ NOW' : qDone ? '' : 'SOON')}</div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>

      {/* ── 3. MONTHLY CHART ───────────────────────────────────────────── */}
      <div style={{ ...panel, border: '1px solid var(--fd-hairline)', borderRadius: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Lbl>MONTHLY INCOME — {new Date().getFullYear()}</Lbl>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--text2)' }}>YTD&nbsp;
              <span style={{ color: G, fontWeight: 500 }}>{fmtMoneyFull(ytd)}</span>
            </span>
            <span style={{ color: 'var(--text2)' }}>AVG&nbsp;
              <span style={{ color: A, fontWeight: 500 }}>{fmtMoney(monthlyAvg)}/mo</span>
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={stackedData} margin={{ top: 4, right: 4, bottom: 0, left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: 'var(--text2)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: 'var(--text2)', fontSize: 12 }} axisLine={false} tickLine={false}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={38}
              domain={[0, 'auto']} allowDataOverflow={false}
            />
            <Tooltip content={<ChartTip />} cursor={TOOLTIP_CURSOR} />
            <ReferenceLine y={monthlyAvg} stroke={A} strokeDasharray="4 2" strokeWidth={1} />
            {stackAccounts.length > 0
              ? stackAccounts.map((acct) => {
                  const color = acctColor(acct.key)
                  return (
                    <Bar
                      key={acct.key}
                      dataKey={acct.key}
                      name={acct.label}
                      fill={color}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={18}
                      opacity={0.85}
                    />
                  )
                })
              : (
                <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={32} name="Income">
                  {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              )
            }
          </BarChart>
        </ResponsiveContainer>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
          {stackAccounts.map(acct => (
            <span key={acct.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, background: acctColor(acct.key), display: 'inline-block', borderRadius: 0 }} />
              {acct.label}
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 24, height: 1, background: A, display: 'inline-block', borderTop: `1px dashed ${A}` }} />
            Monthly avg
          </span>
        </div>
      </div>

      {/* ── 4. ANALYSIS — Composition · Quality · Bracket (unified band) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>

        {/* Tax Composition */}
        <div style={panel}>
          <Lbl>TAX COMPOSITION — FWD 12M</Lbl>
          {/* Stacked proportion bar */}
          <div style={{ display: 'flex', height: 7, borderRadius: 0, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ width: `${ordPct}%`,  background: R,        opacity: 0.8 }} />
            <div style={{ width: `${qualPct}%`, background: G,        opacity: 0.8 }} />
            <div style={{ width: `${rocPct}%`,  background: 'var(--fd-accent)', opacity: 0.8 }} />
          </div>
          {/* Rows */}
          {([
            { label: 'ORDINARY',       amount: fwdOrd,  pct: ordPct,  color: R        },
            { label: 'QUALIFIED DIV',  amount: fwdQual, pct: qualPct, color: G        },
            { label: 'ROC / TAX-FREE', amount: fwdRoc,  pct: rocPct,  color: 'var(--fd-accent)'},
          ] as { label: string; amount: number; pct: number; color: string }[]).map(row => (
            <div key={row.label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 7, height: 7, background: row.color, borderRadius: 0, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 500 }}>{row.label}</span>
                </div>
                <div style={{ display: 'flex', gap: 10, fontFamily: 'var(--font-mono)' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: row.color }}>{fmtMoneyFull(row.amount)}</span>
                  <span style={{ fontSize: 12, color: 'var(--text3)', minWidth: 26, textAlign: 'right' }}>{row.pct}%</span>
                </div>
              </div>
              <MiniBar value={row.pct} color={row.color} height={3} />
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border2)', paddingTop: 8, marginTop: 4 }}>
            <StatRow label="Est. annual tax"  value={`−${fmtMoneyFull(fwdTax)}`}         color={R} />
            <StatRow label="After-tax income" value={fmtMoneyFull(fwd12 - fwdTax)} color={G} />
          </div>
        </div>

        {/* Distribution Quality */}
        <div style={panel}>
          <Lbl>TAX QUALITY</Lbl>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 38, fontWeight: 500, color: qualColor, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
              {qualScore.toFixed(0)}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: qualColor, border: `1px solid ${qualColor}`, padding: '2px 7px', borderRadius: 0, alignSelf: 'flex-start' }}>
              {qualRating}
            </div>
          </div>
          <MiniBar value={qualScore} color={qualColor} height={5} />
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10, lineHeight: 1.6 }}>
            Tax efficiency — higher = more qualified dividends &amp; ROC, less ordinary income drag.
            <span style={{ display: 'block', marginTop: 4, color: 'var(--fd-muted)' }}>
              Distinct from Income Durability (consistency) and Forecast Confidence (predictability).
            </span>
          </div>
        </div>

        {/* Dividend Headroom — dividend-only basis (Tax tab owns the AGI view) */}
        <div style={panel}>
          <Lbl>DIVIDEND HEADROOM</Lbl>

          {/* FWD 12M dividends vs bracket ceiling */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              <span style={{ color: 'var(--text2)' }}>FWD 12M dividends</span>
              <span style={{ color: G, fontWeight: 500 }}>{fmtMoneyFull(fwd12)}</span>
            </div>
            <MiniBar value={bracketPct} color={bracketPct < 70 ? G : A} height={6} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
              <span>$0</span>
              <span>{fmtMoney(taxCeiling)} ceiling</span>
            </div>
          </div>

          <div style={{ fontSize: 14, fontWeight: 500, color: divCeilingRoom > 0 ? G : R, fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
            {fmtMoneyFull(divCeilingRoom)} <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 400 }}>div. headroom</span>
          </div>

          <div style={{ borderTop: '1px solid var(--border2)', paddingTop: 8 }}>
            <StatRow label="Bracket ceiling" value={fmtMoneyFull(taxCeiling)} />
            <StatRow label="FWD 12M dividends" value={fmtMoneyFull(fwd12)} color={M} />
            <StatRow label="Dividend room" value={fmtMoneyFull(divCeilingRoom)} color={divCeilingRoom > 0 ? G : R} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8, lineHeight: 1.5 }}>
            Dividend-only view. See Tax tab for AGI-based bracket room (W2 + dividends + conversions).
          </div>
        </div>
      </div>

      {/* ── 5. CONTRIBUTORS + STRESS TEST (unified band) ─────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.8fr', gap: 8 }}>

        {/* Top Contributors */}
        <div style={panel}>
          <Lbl>TOP INCOME CONTRIBUTORS</Lbl>
          {top5.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {top5.map(({ sym, pct }) => (
                <div key={sym}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{sym}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)', color: G }}>{(pct * 100).toFixed(1)}%</span>
                  </div>
                  <MiniBar value={pct * 100} color={G} height={3} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>No attribution data</div>
          )}
        </div>

        {/* Stress Test */}
        <div style={panel}>
          <Lbl>INCOME STRESS TEST</Lbl>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border2)' }}>
                {['SCENARIO', 'FWD 12M', 'EST TAX', 'DIV. HEADROOM'].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '4px 8px', color: 'var(--text3)', fontWeight: 500, fontSize: 12, letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                { label: 'Base', divDrop: 0,    fwd12m: fwd12,                                               taxEst: fwdTax },
                { label: '−10%', divDrop: 0.10, fwd12m: stress?.down_10?.fwd_12m ?? fwd12 * 0.90, taxEst: stress?.down_10?.tax_est },
                { label: '−20%', divDrop: 0.20, fwd12m: stress?.down_20?.fwd_12m ?? fwd12 * 0.80, taxEst: stress?.down_20?.tax_est },
                { label: '−30%', divDrop: 0.30, fwd12m: stress?.down_30?.fwd_12m ?? fwd12 * 0.70, taxEst: stress?.down_30?.tax_est },
              ]).map(({ label, fwd12m, taxEst }, idx) => {
                // Dividend-only headroom: ceiling minus FWD 12M dividends under this scenario
                const room = taxCeiling > 0 ? Math.max(0, taxCeiling - fwd12m) : 0
                const roomColor = room >= 200000 ? G : room >= 100000 ? A : room >= 0 ? 'var(--yellow)' : R
                return (
                  <tr key={label} style={{ background: idx === 0 ? 'var(--fd-card)' : idx % 2 ? 'transparent' : 'var(--fd-card)' }}>
                    <td style={{ padding: '6px 8px', color: idx === 0 ? G : 'var(--text2)', fontWeight: idx === 0 ? 700 : 400 }}>{label}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: G, fontWeight: 500 }}>{fmtMoneyFull(fwd12m)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: R }}>{fmtMoneyFull(taxEst ?? 0)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: roomColor, fontWeight: 500 }}>{fmtMoneyFull(room)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>


    </div>
  )
}
