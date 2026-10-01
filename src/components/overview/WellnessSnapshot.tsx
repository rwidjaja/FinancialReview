/**
 * Overview › Financial wellness — v4: three ruled columns + pill chips.
 * Columns: Wealth and income · Readiness · Signals. Same /api/wellness fields
 * and derived values as v3 (gauges/sparklines became rows).
 */
import { useMemo, type ReactNode } from 'react'
import { useWellnessData, useBalanceHistory } from '../../hooks/useDashboardData'
import { DEFAULT_BRACKET_RATE } from '../../utils/constants'
import { computeConversionVerdict, verdictTone } from '../../utils/conversionVerdict'
import { fmtFull, fmtSignFull, fmtPctAbs } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { Section, Pill, MonoNote, StatusChip, mono, muted, type Status } from '../ui/primitives'

interface Row { label: string; value: ReactNode; sub?: ReactNode; color?: string; status?: Status }

function Column({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--fd-rule)', minWidth: 0 }}>
      <span style={{ ...mono, padding: '12px 0' }}>{title}</span>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 0', borderTop: '1px solid var(--fd-hairline)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {r.status && <StatusChip status={r.status} size={10} />}{r.label}
            </span>
            <span style={{ fontSize: 15, fontWeight: 500, color: r.color ?? 'var(--fd-ink)', whiteSpace: 'nowrap' }}>{r.value}</span>
          </div>
          {r.sub && <span style={{ fontSize: 13, ...muted, lineHeight: 1.35 }}>{r.sub}</span>}
        </div>
      ))}
    </div>
  )
}

/** 90-day net-worth change from balance-history closes. */
function useNetWorthTrend(current: number | undefined) {
  const { data: rows } = useBalanceHistory(90)
  return useMemo(() => {
    if (!rows || rows.length === 0 || !current) return null
    const byDate: Record<string, number> = {}
    for (const r of rows) if (!byDate[r.date] || r.label === 'close') byDate[r.date] = r.total_value
    const first = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))[0]?.[1]
    return first ? ((current - first) / first) * 100 : null
  }, [rows, current])
}

const successStatus = (p: number): Status => p >= 0.9 ? 'ok' : p >= 0.8 ? 'watch' : p >= 0.7 ? 'warn' : 'alert'

export function WellnessSnapshot({ data }: { data: DashboardData }) {
  const { data: w, isLoading, error } = useWellnessData()
  const trend = useNetWorthTrend(w?.net_worth)
  const pi = data.portfolio_intel
  const td = data.tax_data
  const s = data.summary
  const ih = data.income_history

  const meta = w ? `Age ${w.current_age} · SS at ${w.ss_start_age} · to ${w.target_age}` : undefined

  if (isLoading) return <Section title="Financial wellness"><MonoNote>Loading financial wellness…</MonoNote></Section>
  if (error || !w) {
    return (
      <Section title="Financial wellness">
        <div style={{ display: 'grid', gridTemplateColumns: '8px 1fr', background: 'var(--fd-card)' }}>
          <div style={{ background: 'var(--fd-alert)' }} />
          <span style={{ ...mono, padding: 20 }}>Wellness endpoint unavailable</span>
        </div>
      </Section>
    )
  }

  const seqPct = (w.seq_risk_pct ?? 0) * 100
  const cov = w.income_coverage_pct

  // Coverage narrative (v3 copy, unchanged logic)
  let covSub: ReactNode = 'How much of planned spending dividends alone would cover'
  if (cov != null) {
    if (cov >= 100) covSub = `Dividends (${fmtFull(w.portfolio_income)}/yr) fully cover the ${fmtFull(w.estimated_spending)}/yr plan — no selling needed.`
    else {
      const shortfall = w.estimated_spending - w.portfolio_income
      const addlWR = s.total_value > 0 ? (shortfall / s.total_value) * 100 : 0
      const impact = addlWR < 0.5 ? 'barely moves the needle' : addlWR < 1.5 ? 'not a big deal' : addlWR < 3 ? 'worth keeping an eye on' : 'worth addressing'
      covSub = `The other ${fmtFull(shortfall)}/yr comes from selling investments — an extra ${addlWR.toFixed(2)}% a year, which is ${impact}.`
    }
  }

  // Bracket gauge — configured target rate from _TAX_RULE_ENGINE
  const bktRate = (td?.target_bracket_rate ?? DEFAULT_BRACKET_RATE) / 100
  const bktLabel = `${td?.target_bracket_rate ?? DEFAULT_BRACKET_RATE}%`
  const bracket = td?.brackets?.find(b => Math.abs(b.rate - bktRate) < 0.001)
  const bktUsed = bracket ? Math.round((td!.annual_div_for_agi / bracket.max) * 100) : null

  // Roth conversion — canonical verdict (same as Tax / Drawdown)
  const verdict = td ? computeConversionVerdict(td) : null
  const STATUS_PLAIN: Record<string, string> = {
    GO: 'Good time to convert more', WAIT: 'Hold off for now', STOP: "This year's limit is reached", COMPLETE: "This year's target is met",
  }
  const statusCode = verdict?.status ?? td?.conv_action ?? ''
  const convStatus: Status = verdict == null ? 'info' : verdictTone(verdict.status) === 'good' ? 'ok' : verdictTone(verdict.status) === 'bad' ? 'alert' : 'warn'
  const fragStatus: Status = pi?.fragility_level === 'HIGH' ? 'alert' : pi?.fragility_level === 'MODERATE' ? 'warn' : 'ok'

  const wealth: Row[] = [
    { label: 'Net worth', value: fmtFull(w.net_worth), sub: `All accounts${trend != null ? ` · ${trend >= 0 ? '+' : '−'}${Math.abs(trend).toFixed(1)}% in 90 days` : ''}` },
    { label: 'Portfolio income', value: `${fmtFull(w.portfolio_income)}/yr`, sub: 'Dividends expected over the next 12 months' },
    { label: 'Plan spending', value: `${fmtFull(w.estimated_spending)}/yr`, sub: 'What you expect to spend' },
    { label: 'Dividends vs spending', value: cov != null ? `${cov.toFixed(1)}%` : '—', sub: covSub, status: cov == null ? 'info' : cov >= 100 ? 'ok' : cov >= 75 ? 'warn' : 'alert' },
    { label: 'Withdrawal rate', value: w.withdrawal_rate != null ? fmtPctAbs(w.withdrawal_rate * 100, 2) : '—',
      sub: w.withdrawal_rate == null ? 'Not available' : w.withdrawal_rate < 0.04 ? 'Under the 4% guideline' : 'Above the 4% guideline — worth a look',
      status: w.withdrawal_rate == null ? undefined : w.withdrawal_rate < 0.04 ? 'ok' : 'warn' },
    { label: 'Cash flow', value: `${fmtSignFull(w.cashflow_surplus)}/yr`, color: w.cashflow_surplus >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)',
      sub: w.cashflow_surplus < 0 && td?.withdrawal_current_state === 'C'
        ? 'The gap is covered by planned investment sales — not a shortfall in the plan'
        : `${fmtFull(w.portfolio_income)} income − ${fmtFull(w.estimated_spending)} spending` },
  ]

  const readiness: Row[] = [
    { label: 'Lasts to 100', value: `${(w.success_prob_100 * 100).toFixed(1)}%`, status: successStatus(w.success_prob_100),
      sub: w.success_prob_100 >= 0.9 ? 'On track' : w.success_prob_100 >= 0.8 ? 'Some risk' : 'High risk' },
    { label: 'Lasts to 95', value: `${(w.success_prob_95 * 100).toFixed(1)}%`, status: successStatus(w.success_prob_95), sub: 'Monte Carlo success' },
    { label: 'Portfolio at 95', value: fmtFull(w.projected_95_median), sub: 'Median simulated outcome' },
    { label: 'Safe spending', value: `${fmtFull(w.safe_spending)}/yr`, sub: '95% chance the money lasts' },
    { label: 'Bad-start risk', value: `−${fmtPctAbs(seqPct)}`, color: seqPct >= 20 ? 'var(--fd-negative)' : undefined,
      status: seqPct < 10 ? 'ok' : seqPct < 20 ? 'watch' : seqPct < 30 ? 'warn' : 'alert', sub: `A rough first five years leaves ${fmtFull(w.seq_risk_penalty)} less at the end — shown as % of today's portfolio` },
    { label: 'Failure line', value: fmtFull(w.ruin_threshold), sub: 'Plan counted as failed below' },
  ]

  const signals: Row[] = [
    { label: 'Invested', value: fmtFull(s.total_cost), sub: 'Before gains or losses' },
    { label: 'Projected income', value: `${fmtFull(s.total_income)}/yr`, sub: 'Last 12 months of dividend yield' },
    ...(ih.ytd_total > 0 ? [{ label: `Received ${ih.year}`, value: fmtFull(ih.ytd_total), sub: 'Dividends so far, from Schwab' }] : []),
    ...(td ? [{ label: 'Roth conversion', value: statusCode || '—', status: convStatus,
      sub: `${STATUS_PLAIN[statusCode] ?? td.conv_action?.toLowerCase() ?? ''} · opportunity score ${td.conv_score}/10${verdict ? `. ${verdict.headline}` : ''}` }] : []),
    ...(bktUsed != null ? [{ label: 'Bracket used', value: `${bktUsed}% of ${bktLabel}`, status: (bktUsed >= 90 ? 'alert' : bktUsed >= 70 ? 'warn' : 'ok') as Status, sub: 'Dividends counted toward AGI' }] : []),
    { label: 'Concentration', value: `${pi?.fragility_score ?? '—'} / 100`, status: fragStatus, color: fragStatus === 'alert' ? 'var(--fd-negative)' : undefined, sub: `Fragility — ${pi?.fragility_level?.toLowerCase() ?? 'n/a'}` },
  ]

  return (
    <Section title="Financial wellness" meta={meta}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 32 }}>
        <Column title="Wealth and income" rows={wealth} />
        <Column title="Readiness" rows={readiness} />
        <Column title="Signals" rows={signals} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Pill k="Social Security" v={`${fmtFull(w.ss_annual)}/yr at ${w.ss_start_age}`} />
        {w.buffer_years != null && <Pill k="Cash reserve" v={`${w.buffer_years.toFixed(1)} yrs`} />}
        <Pill k="Comfortable spending" v={`${fmtFull(w.comfortable_spending)}/yr`} />
        <Pill k="Don't go below" v={fmtFull(w.ruin_threshold)} />
      </div>
    </Section>
  )
}
