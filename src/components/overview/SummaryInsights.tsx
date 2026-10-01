import React from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { QuadrantPanel } from '../ui/StatTile'
import { RadialGauge } from '../ui/RadialGauge'
import { fmtMoneyFull, confidenceColor } from '../../utils/formatters'
import { WITHDRAWAL_AB_THRESHOLD, WITHDRAWAL_BC_THRESHOLD } from '../../utils/constants'
import type { DashboardData } from '../../types/dashboard'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR , TOOLTIP_LABEL_RECHARTS, TOOLTIP_ITEM_RECHARTS } from '../ui/chartTooltip'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const Y = 'var(--yellow)'
const M = 'var(--text2)'

export function SystemHealthPanel({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel
  if (!pi) return null
  const confColor = confidenceColor(pi.system_confidence_score)
  const fragColor = pi.fragility_score >= 70 ? R : pi.fragility_score >= 50 ? A : G
  const durColor = pi.income_durability_score > 70 ? G : pi.income_durability_score > 40 ? Y : R
  const volColor = pi.vol_budget_used > 130 ? R : pi.vol_budget_used > 100 ? Y : G
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 300px' }}>
        <QuadrantPanel
          title="◈ SYSTEM HEALTH MATRIX"
          titleColor={confColor}
          items={[
            { label: 'Confidence', value: `${pi.system_confidence_score.toFixed(0)}/100`, color: confColor },
            { label: 'Fragility',  value: `${pi.fragility_score.toFixed(0)}/100`,         color: fragColor },
            { label: 'Durability', value: `${pi.income_durability_score.toFixed(0)}/100`, color: durColor },
            { label: 'Vol Budget', value: `${pi.vol_budget_used.toFixed(0)}%`,             color: volColor },
          ]}
        />
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', paddingTop: 4 }}>
        <RadialGauge
          value={Math.round(pi.vol_budget_used)} max={200}
          label="VOL BUDGET"
          sublabel={pi.vol_budget_used > 130 ? 'CRITICAL' : pi.vol_budget_used > 100 ? 'ELEVATED' : 'OK'}
          size={100}
          zones={[{ max: 80, color: 'var(--fd-accent)' },{ max: 120, color: 'var(--fd-ink)' },{ max: 150, color: 'var(--fd-ink)' },{ max: 200, color: 'var(--fd-negative)' }]}
        />
        <RadialGauge
          value={Math.round(pi.fragility_score)} max={100}
          label="FRAGILITY"
          sublabel={pi.fragility_level}
          size={100}
          zones={[{ max: 30, color: 'var(--fd-accent)' },{ max: 50, color: 'var(--fd-ink)' },{ max: 70, color: 'var(--fd-ink)' },{ max: 100, color: 'var(--fd-negative)' }]}
        />
      </div>
    </div>
  )
}

export function MiniAIInsight({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel
  const insight = pi?.top_opportunities?.[0]?.msg
    ?? data.decision_strip?.[0]?.text
    ?? pi?.top_risks?.[0]?.msg
    ?? null
  const source = pi?.top_opportunities?.[0]?.msg ? 'OPPORTUNITY'
    : data.decision_strip?.[0]?.text ? data.decision_strip[0].action
    : 'RISK ALERT'
  const sourceColor = pi?.top_opportunities?.[0]?.msg ? G
    : data.decision_strip?.[0]?.level === 'red' ? R
    : data.decision_strip?.[0]?.level === 'orange' ? A : Y
  if (!insight) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 14px', background: 'var(--surface)',
      border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${sourceColor}`, borderRadius: 0,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}></span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: sourceColor, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2 }}>
          AI INSIGHT · [{source}]
        </div>
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>{insight}</div>
      </div>
      {pi?.system_confidence_label && (
        <div style={{ fontSize: 12, fontWeight: 500, color: M, flexShrink: 0, textAlign: 'right' }}>
          <div style={{ color: confidenceColor(pi.system_confidence_score) }}>{pi.system_confidence_score.toFixed(0)}/100</div>
          <div>CONFIDENCE</div>
        </div>
      )}
    </div>
  )
}

export function CashflowSparkline({ data }: { data: DashboardData }) {
  const si = data.spending_intelligence
  if (!si?.available || !si.monthly_totals || si.monthly_totals.length === 0) return null

  const incomeHistory = data.income_history
  const incomeYear = incomeHistory?.year ?? new Date().getFullYear()
  const monthlyIncomeByYearMonth: Record<string, number> = {}
  for (const acct of Object.values(incomeHistory?.by_account ?? {})) {
    const byMonth = acct.by_month ?? []
    byMonth.forEach((v, idx) => {
      const val = typeof v === 'number' ? v : (v as { total?: number }).total ?? 0
      if (val > 0) {
        const key = `${incomeYear}-${String(idx + 1).padStart(2, '0')}`
        monthlyIncomeByYearMonth[key] = (monthlyIncomeByYearMonth[key] ?? 0) + val
      }
    })
  }

  const chartData = si.monthly_totals.slice(-12).map((mt) => {
    const income = monthlyIncomeByYearMonth[mt.month] ?? 0
    return {
      month: mt.month.slice(5),
      spending: Math.round(mt.amount),
      income: Math.round(income),
      net: Math.round(income - mt.amount),
    }
  })

  const avgSpend = chartData.reduce((s, d) => s + d.spending, 0) / Math.max(chartData.length, 1)
  const maxSpend = Math.max(...chartData.map(d => Math.max(d.spending, d.income)))

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          ◈ MONTHLY CASHFLOW — LAST 12 MONTHS
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
          <span style={{ color: R }}>■ Spending</span>
          <span style={{ color: G }}>■ Income</span>
          <span style={{ color: M }}>— Avg Spend</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
          <XAxis dataKey="month" tick={{ fill: 'var(--text2)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis hide domain={[0, maxSpend * 1.15]} />
          <Tooltip
            formatter={(v: unknown, name: unknown) => [
              `$${Number(v).toLocaleString('en-US')}`,
              name === 'spending' ? 'Spending' : 'Income'
            ]}
            contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
          />
          <ReferenceLine y={avgSpend} stroke="var(--fd-hairline)" strokeDasharray="3 3" />
          <Bar dataKey="income" fill="var(--fd-accent)" fillOpacity={0.6} radius={1} />
          <Bar dataKey="spending" fill="var(--fd-negative)" fillOpacity={0.6} radius={1} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12 }}>
        <span style={{ color: M }}>Avg spend: <span style={{ color: R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>${Math.round(avgSpend).toLocaleString()}/mo</span></span>
        {data.income_summary != null && (
          <span style={{ color: M }}>Avg income: <span style={{ color: G, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>${Math.round(data.income_summary.full_year_total / 12).toLocaleString()}/mo</span></span>
        )}
        {si.cashflow_vol_pct != null && (
          <span style={{ color: M }}>Cashflow vol: <span style={{ color: A, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{si.cashflow_vol_pct.toFixed(1)}%</span></span>
        )}
      </div>
    </div>
  )
}

export function ActionBar({ data }: { data: DashboardData }) {
  const actions = data.decision_strip ?? []
  if (actions.length === 0) return null
  const lc = (lvl: string) => lvl === 'red' ? R : lvl === 'orange' ? A : lvl === 'green' ? G : Y
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6, padding: '8px 12px' }}>
      {actions.slice(0, 6).map((d, i) => {
        const c = lc(d.level)
        return (
          <div key={i} style={{
            display: 'flex', gap: 8, padding: '6px 10px',
            background: 'var(--bg)', border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${c}`,
          }}>
            <span style={{ fontSize: 12, flexShrink: 0 }}>{d.icon}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: c, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                [{d.action}]
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>{d.text}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function WithdrawalStateSignal({ data }: { data: DashboardData }) {
  const tx   = data.tax_data
  const gains = data.summary.total_pnl
  if (!tx || gains == null) return null

  const abThreshold  = tx.withdrawal_state_ab_threshold  ?? WITHDRAWAL_AB_THRESHOLD
  const bcThreshold  = tx.withdrawal_state_bc_threshold  ?? WITHDRAWAL_BC_THRESHOLD
  const serverState  = tx.withdrawal_current_state
  const stateIdx     = serverState === 'C' ? 2 : serverState === 'B' ? 1 : serverState === 'A' ? 0
                     : gains < abThreshold ? 0 : gains < bcThreshold ? 1 : 2
  const stateColor   = ['var(--fd-accent)', 'var(--fd-ink)', 'var(--fd-negative)'][stateIdx]
  const stateLabel   = ['A · INCOME-DOMINANT', 'B · HYBRID', 'C · CAPITAL-GAIN-DOMINANT'][stateIdx]
  const nextThreshold = stateIdx === 0 ? abThreshold : stateIdx === 1 ? bcThreshold : null
  const distToNext    = nextThreshold != null ? nextThreshold - gains : null
  const stateKeys = ['A', 'B', 'C'] as const
  const stateDesc = tx?.withdrawal_states?.[stateKeys[stateIdx]]?.description
  const primaryAction = stateDesc ?? tx?.withdrawal_states?.[stateKeys[stateIdx]]?.name?.replace(/_/g, ' ') ?? stateLabel

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
      borderLeft: `3px solid ${stateColor}`, borderRadius: 0,
      display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 0,
      alignItems: 'stretch',
    }}>
      <div style={{
        padding: '8px 14px', borderRight: '1px solid var(--border2)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text2)', letterSpacing: '0.7px', textTransform: 'uppercase' }}>
          WITHDRAWAL STATE
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, color: stateColor, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          STATE {stateLabel}
        </div>
      </div>
      <div style={{
        padding: '8px 14px', display: 'flex', alignItems: 'center',
        fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)',
      }}>
        {primaryAction}
      </div>
      <div style={{
        padding: '8px 14px', borderLeft: '1px solid var(--border2)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, minWidth: 140,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text2)', letterSpacing: '0.7px', textTransform: 'uppercase' }}>UNREALIZED GAINS</div>
        <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)', color: gains >= 0 ? G : R }}>
          {gains >= 0 ? '+' : ''}{fmtMoneyFull(gains)}
        </div>
      </div>
      <div style={{
        padding: '8px 14px', borderLeft: '1px solid var(--border2)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, minWidth: 140,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text2)', letterSpacing: '0.7px', textTransform: 'uppercase' }}>
          {distToNext != null ? 'NEXT THRESHOLD' : 'FINAL STATE'}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)', color: distToNext != null ? Y : stateColor }}>
          {distToNext != null ? `${fmtMoneyFull(distToNext)} away` : 'MAX HARVEST'}
        </div>
        {distToNext != null && (
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            until State {stateIdx === 0 ? 'B' : 'C'} at {fmtMoneyFull(nextThreshold!)}
          </div>
        )}
      </div>
    </div>
  )
}

export function StatePipeline({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel
  if (!pi) return null

  const regimeColor = pi.market_regime === 'EXPANSION' ? G : pi.market_regime === 'RISK-OFF' ? R : Y
  const posColor = pi.positioning === 'AGGRESSIVE' ? R : pi.positioning === 'CONSERVATIVE' ? G : Y
  const confColor = confidenceColor(pi.system_confidence_score)
  const redRisks = pi.top_risks.filter(r => r.level === 'red').length
  const topAction = data.decision_strip[0]
  const actionColor = topAction?.level === 'red' ? R : topAction?.level === 'orange' ? A : G

  const PipeCol = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{
      flex: 1, padding: '8px 14px', background: 'var(--surface)',
      borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: M, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 2 }}>
        {title}
      </div>
      {children}
    </div>
  )

  const Arrow = () => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px', color: M, fontSize: 14, flexShrink: 0 }}>▶</div>
  )

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', background: 'var(--bg)',
      border: '1px solid var(--fd-hairline)', borderTop: `2px solid ${confColor}`, overflow: 'hidden',
    }}>
      <PipeCol title="① SYSTEM STATE">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: M }}>REGIME</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: regimeColor, fontFamily: 'var(--font-mono)' }}>{pi.market_regime}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: M }}>POSITIONING</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: posColor, fontFamily: 'var(--font-mono)' }}>{pi.positioning}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: M }}>CONFIDENCE</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: confColor, fontFamily: 'var(--font-mono)' }}>
              {pi.system_confidence_score.toFixed(0)}<span style={{ fontSize: 12, color: M }}>/100</span>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: M, marginTop: 2 }}>
          {pi.fragility_level} FRAGILITY · {pi.inc_stability_lbl ?? '—'} STABILITY
        </div>
      </PipeCol>
      <Arrow />
      <PipeCol title="② TOP RISKS">
        {pi.top_risks.slice(0, 3).map((r, i) => {
          const c = r.level === 'red' ? R : r.level === 'orange' ? A : Y
          return (
            <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.3 }}>
              <span style={{ color: c, fontSize: 12, flexShrink: 0, marginTop: 1 }}>
                {r.level === 'red' ? '⬤' : r.level === 'orange' ? '◆' : '◈'}
              </span>
              <span style={{ color: 'var(--text)' }}>{r.msg}</span>
            </div>
          )
        })}
        {redRisks > 0 && (
          <div style={{ fontSize: 12, color: R, fontWeight: 500, marginTop: 2 }}>{redRisks} CRITICAL ALERT{redRisks > 1 ? 'S' : ''}</div>
        )}
      </PipeCol>
      <Arrow />
      <PipeCol title="③ NEXT ACTIONS">
        {data.decision_strip.slice(0, 3).map((d, i) => {
          const c = d.level === 'red' ? R : d.level === 'orange' ? A : G
          return (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.3 }}>
              <span style={{ fontSize: 12 }}>{d.icon}</span>
              <div>
                <span style={{ color: c, fontWeight: 500, fontSize: 12 }}>[{d.action}] </span>
                <span style={{ color: 'var(--text2)' }}>{d.text}</span>
              </div>
            </div>
          )
        })}
        {data.decision_strip.length > 3 && (
          <div style={{ fontSize: 12, color: actionColor, fontWeight: 500 }}>+{data.decision_strip.length - 3} MORE ACTIONS</div>
        )}
      </PipeCol>
    </div>
  )
}

export function RisksAndOpportunities({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel
  if (!pi) return null
  const hasRisks = pi.top_risks.length > 0
  const hasOpps = pi.top_opportunities.length > 0
  if (!hasRisks && !hasOpps) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${R}`, borderRadius: 0, overflow: 'hidden' }}>
        <div style={{
          padding: '5px 12px', borderBottom: '1px solid var(--border2)',
          fontSize: 12, fontWeight: 500, color: R, letterSpacing: '0.8px', textTransform: 'uppercase',
        }}> TOP RISKS</div>
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {pi.top_risks.slice(0, 5).map((r, i) => {
            const c = r.level === 'red' ? R : r.level === 'orange' ? A : Y
            return (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{
                  fontSize: 12, fontWeight: 500, padding: '1px 5px', background: c,
                  color: 'var(--fd-ink)', flexShrink: 0, borderRadius: 0, marginTop: 1,
                }}>
                  {r.level.toUpperCase()}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>{r.msg}</span>
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderLeft: `3px solid ${G}`, borderRadius: 0, overflow: 'hidden' }}>
        <div style={{
          padding: '5px 12px', borderBottom: '1px solid var(--border2)',
          fontSize: 12, fontWeight: 500, color: G, letterSpacing: '0.8px', textTransform: 'uppercase',
        }}> OPPORTUNITIES</div>
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {pi.top_opportunities.slice(0, 5).map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: G, fontSize: 12, flexShrink: 0, marginTop: -1 }}>›</span>
              <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>{o.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function WatchlistStrip({ data }: { data: DashboardData }) {
  const pi = data.portfolio_intel
  if (!pi || pi.watchlist.length === 0) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', height: 30,
      background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
      borderRadius: 0, overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{
        padding: '0 10px', fontSize: 12, fontWeight: 500, color: M,
        borderRight: '1px solid var(--border2)', whiteSpace: 'nowrap',
        display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
      }}>
        <span style={{ color: A }}>◈</span> WATCHLIST
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', overflowX: 'auto',
        scrollbarWidth: 'none', gap: 0,
      }}>
        {pi.watchlist.map((w, i) => {
          const c = w.priority === 'high' ? A : M
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px',
              borderRight: i < pi.watchlist.length - 1 ? '1px solid var(--border2)' : 'none',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {w.priority === 'high' && (
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--as-washed-black)', background: 'var(--as-lilac)', padding: '1px 4px' }}>HIGH</span>
              )}
              <span style={{ fontSize: 12, color: c }}>{w.msg}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
