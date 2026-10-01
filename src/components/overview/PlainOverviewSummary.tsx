/**
 * PlainOverviewSummary — "What am I looking at?" popup.
 *
 * Overview packs a lot onto one screen, and much of it is conditional —
 * gated by tax-bracket timing, withdrawal state, or rules that only fire
 * some years. This popup doesn't compute anything new: it reads the exact
 * same `data`/`decision` already on screen and re-tells it in plain English,
 * explicitly separating "this needs your attention" from "this is fine,
 * ignore it for now" so the noise gets filtered instead of just translated.
 */
import type { DashboardData } from '../../types/dashboard'
import type { RetirementDecision, PrimaryAction } from '../../utils/retirementEngine'
import { fmtMoneyFull } from '../../utils/formatters'
import { Dialog, STATUS_MARK, mono, type Status } from '../ui/primitives'

interface Props {
  data:     DashboardData
  decision: RetirementDecision
  onClose:  () => void
}

const ACTION_PLAIN: Record<PrimaryAction, string> = {
  REDUCE_RISK:        'Your portfolio is carrying more risk than it should right now. The recommendation is to dial that back before anything else — including Roth conversions — is worth doing.',
  REFILL_BUCKET:      "Your cash safety net (the money set aside to cover near-term spending) is running low. Topping that up comes before other moves.",
  DEFER_CONVERSION:   'Hold off on moving money to your Roth IRA for now — recent short-term investment gains are already using up your room in this year\'s tax bracket.',
  CONTROLLED_SALE:    "Your spending right now is being funded by selling investments, not by dividends — that's expected for the phase you're in, not a problem.",
  EXECUTE_CONVERSION: "This is a good window to move money from your IRA into your Roth IRA — there's room left in your tax bracket to do it without jumping to a higher rate.",
  HOLD_INCOME_ONLY:   'Your dividends alone cover your spending this year — no withdrawals needed.',
  MONITOR_ONLY:       "Nothing urgent. Everything's within normal range — just keep an eye on things.",
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n < 0 ? '-' : ''
  const abs  = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${sign}$${Math.round(abs / 1_000)}K`
  return `${sign}$${Math.round(abs)}`
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: Status }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: accent ? '8px 1fr' : '1fr', gap: 20, borderTop: '2px solid var(--fd-rule)', paddingTop: 16 }}>
      {accent && <div style={{ background: STATUS_MARK[accent] }} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 500 }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0 }}>{children}</p>
}

export function PlainOverviewSummary({ data, decision, onClose }: Props) {
  const s  = data.summary
  const pi = data.portfolio_intel
  const ia = data.income_analytics

  const cashPct = (() => {
    let cash = 0, total = 0
    for (const acct of data.accounts) {
      for (const pos of acct.positions) {
        total += pos.value
        if (pos.is_money_market) cash += pos.value
      }
    }
    return total > 0 ? (cash / total) * 100 : null
  })()
  const beta     = pi?.weighted_beta
  const yieldPct = ia?.yield_pct ?? (s.total_value > 0 && s.total_income > 0 ? (s.total_income / s.total_value) * 100 : null)

  const items         = decision.retirement_scorecard.items
  const needsAttention = items.filter(i => i.status !== 'ok')
  const allFine        = items.filter(i => i.status === 'ok')

  const alertCounts = data.alerts?.reduce((acc, a) => {
    acc[a.level] = (acc[a.level] ?? 0) + 1
    return acc
  }, {} as Record<string, number>) ?? {}
  const urgentAlerts = (alertCounts.red ?? 0) + (alertCounts.orange ?? 0)
  const totalAlerts  = data.alerts?.length ?? 0

  return (
    <Dialog onClose={onClose} width={680} label="Overview in plain English">
          <span style={{ ...mono, color: 'var(--fd-accent)' }}>Overview · in plain English</span>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 56, lineHeight: 0.9, letterSpacing: '-0.02em', margin: 0 }}>What am I <em>looking</em> at?</h2>

          <Section title="Right now, the one thing that actually matters" accent="ok">
            <P><strong>{decision.action_label}</strong></P>
            <P>{ACTION_PLAIN[decision.primary_action]}</P>
          </Section>

          <Section title="Your numbers, in plain terms">
            <P>
              Your accounts are worth <strong>{fmtMoneyFull(s.total_value)}</strong> total.
              Today it moved <strong style={{ color: (s.day_change ?? 0) >= 0 ? 'var(--fd-accent)' : 'var(--fd-negative)' }}>
                {(s.day_change ?? 0) >= 0 ? '+' : ''}{fmt(s.day_change)}
              </strong>, and since you started investing you're
              up <strong>{fmt(s.total_pnl)}</strong> ({s.total_pnl_pct.toFixed(1)}%).
            </P>
            <P>
              {cashPct != null && <>About <strong>{cashPct.toFixed(1)}%</strong> of your portfolio is sitting in cash. </>}
              {beta != null && <>Your "beta" is <strong>{beta.toFixed(2)}</strong> — that means your
                portfolio swings about {beta.toFixed(1)}× as much as the overall market, up or
                down. Above 1 = bumpier ride than the market; below 1 = smoother. </>}
              {yieldPct != null && <>Your dividend yield is about <strong>{yieldPct.toFixed(1)}%</strong> —
                roughly that share of your portfolio's value comes back as cash dividends each
                year, before selling anything.</>}
            </P>
          </Section>

          <Section title="Your 6-point health check, decoded" accent={needsAttention.length ? 'warn' : 'ok'}>
            {needsAttention.length > 0 ? (
              <>
                <P>These are worth a look:</P>
                {needsAttention.map(i => (
                  <P key={i.label}>
                    <strong>{i.label}</strong> — {i.note}
                  </P>
                ))}
              </>
            ) : (
              <P>Everything on your health check is green — nothing needs action right now.</P>
            )}
            {allFine.length > 0 && (
              <P>
                Already fine, no action needed: {allFine.map(i => i.label).join(' · ')}.
              </P>
            )}
          </Section>

          {decision.why_not_convert && decision.why_not_convert.reasons.length > 0 && (
            <Section title={'Why isn\'t Roth conversion happening right now?'}>
              {decision.why_not_convert.reasons.map((r, i) => <P key={i}>• {r}</P>)}
            </Section>
          )}

          <Section title="Stuff on this page you can skip for now">
            <P>
              {totalAlerts > 0 ? (
                <>Needs attention lists <strong>{totalAlerts}</strong> item{totalAlerts === 1 ? '' : 's'},
                  but only <strong>{urgentAlerts}</strong> of those are actually urgent (red/orange).
                  The rest are informational — safe to skim past.</>
              ) : (
                <>No active alerts right now.</>
              )}
            </P>
            <P>
              "Diagnostics" in the side rail shows the four most pressing checks; expand it for
              all nine. Switch the header to Advanced for the full action engine — deeper detail
              for when you want it, not something you need to check regularly.
            </P>
          </Section>

          <Section title="Quick glossary">
            <P><strong>Beta</strong> — how much your portfolio moves compared to the overall market.</P>
            <P><strong>Fragility</strong> — how much a bad month could hurt you, based on concentration and correlation.</P>
            <P><strong>Confidence score</strong> — a 0–100 rollup of how healthy the plan looks right now.</P>
            <P><strong>Withdrawal state (A/B/C)</strong> — A: dividends cover spending · B: a mix of dividends and sales · C: sales are the main funding source.</P>
          </Section>

    </Dialog>
  )
}
