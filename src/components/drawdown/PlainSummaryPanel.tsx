/**
 * PlainSummaryPanel — "Section 8. Summary"
 *
 * Sections 1-5 (Annual Decision Engine, Withdrawal Schedule, Lifetime Tax
 * Minimizer, Spending Plan, Depletion & Legacy) are dense, CFP-grade views.
 * This panel re-tells the same numbers in plain English for someone with
 * no finance background, plus one simple chart. It reads from the exact
 * same `result`/`inputs`/`annualDecision` those sections use — no new
 * calculations, just a different explanation of the same data.
 */
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { fmtMoneyFull } from '../../utils/formatters'
import { computeBucketStatus } from '../../utils/retirementEngine'
import type { DashboardData } from '../../types/dashboard'
import type { DrawdownInputs, DrawdownResult } from './drawdown.engine'
import { useDrawdownPlan } from '../../context/DrawdownPlanContext'
import { fmt, G, R, A, M, BL } from './drawdown.shared'

interface Props {
  result: DrawdownResult
  data:   DashboardData
  inputs: DrawdownInputs
}

function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line-strong)',
      borderLeft: accent ? `3px solid ${accent}` : undefined,
      borderRadius: 0, padding: '14px 16px',
    }}>
      {children}
    </div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text1)', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--text2)', margin: '0 0 8px', ...style }}>{children}</p>
}

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--fd-hairline)',
      borderRadius: 0, padding: '6px 10px', fontSize: 12 }}>
      <div style={{ color: M, marginBottom: 2 }}>Age {label}</div>
      <div style={{ color: G, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
        {fmtMoneyFull(payload[0].value)}
      </div>
    </div>
  )
}

export function PlainSummaryPanel({ result, data, inputs }: Props) {
  const { annualDecision: ad } = useDrawdownPlan()

  const bestLon = result.strategies.find(s => s.id === result.best_longevity)!
  const bestTax = result.strategies.find(s => s.id === result.best_tax)!
  const lifetimeTaxSavings = Math.max(0,
    result.strategies.reduce((max, s) => Math.max(max, s.total_taxes), 0) - bestTax.total_taxes
  )

  const totalToday = inputs.taxable_balance + inputs.rollover_balance + inputs.roth_balance
  const yearsOut   = inputs.target_age - inputs.current_age

  const { bucketShort, bucketMonths, bucketYearsRequired, requiredBucket, swvxxValue } = computeBucketStatus(data)
  const bucketShortfall = Math.max(0, requiredBucket - swvxxValue)

  const totalPortfolio = totalToday
  const allPositions = (data.accounts ?? []).flatMap(a => a.positions ?? [])
  const topConc = allPositions
    .filter(p => !p.is_money_market && (p.value ?? 0) > 0)
    .map(p => ({ symbol: p.symbol, pct: totalPortfolio > 0 ? (p.value / totalPortfolio) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct)[0]
  const hasConc = topConc && topConc.pct > 15

  const chartData = bestLon.years.map(y => ({ age: y.age, total: y.total }))

  const runsOut = bestLon.depleted_at_age != null

  // Plain-English taxable-sale composition, reusing the same lot-aware
  // numbers the Annual Decision Engine already computed.
  const saleNote = ad.from_taxable <= 0
    ? null
    : ad.no_lot_data
      ? `We don't have detailed lot data for this, so this estimate assumes a typical mix of tax treatment.`
      : ad.ltcg_from_taxable > 0 && ad.stcg_from_taxable > 0
        ? `Part of this sale qualifies for the lower "long-term" tax rate, and part is taxed like regular income because those particular shares haven't been held a full year yet.`
        : ad.stcg_from_taxable > 0
          ? `None of the shares being sold have been held a full year yet, so this entire sale is taxed like regular income — there's no tax discount available right now.`
          : ad.ltcg_from_taxable > 0
            ? `These shares have been held over a year, so this sale qualifies for the lower "long-term" tax rate.`
            : `This comes mostly from cash sitting in the account, so there's little or no tax owed on it.`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <Card accent={BL}>
        <CardTitle>What this page is</CardTitle>
        <P>
          Sections 1–7 above are detailed, professional-grade tools — useful once you know what
          you're looking at, but a lot to take in. This section says the same things in plain
          English, using the exact same numbers, so you can sanity-check the big picture without
          decoding all the jargon.
        </P>
      </Card>

      {/* ── 1. Big picture ─────────────────────────────────────────── */}
      <Card accent={G}>
        <CardTitle>The big picture</CardTitle>
        <P>
          You have <strong style={{ color: 'var(--text1)' }}>{fmtMoneyFull(totalToday)}</strong> saved
          across three accounts: a taxable brokerage account, a Rollover IRA, and a Roth IRA.
          You're <strong>{inputs.current_age}</strong> years old, and this plan looks ahead to
          age <strong>{inputs.target_age}</strong> — about <strong>{yearsOut}</strong> years from now.
        </P>
        <P>
          {runsOut ? (
            <>
              <strong style={{ color: R }}>Heads up:</strong> under the recommended strategy
              ("{bestLon.label}"), your money is projected to run out around
              age <strong style={{ color: R }}>{bestLon.depleted_at_age}</strong>. That's not a
              certainty — it's based on today's assumptions about growth, spending, and taxes —
              but it's worth a closer look at the Depletion & Legacy and Spending Plan sections
              above for ways to stretch it further.
            </>
          ) : (
            <>
              <strong style={{ color: G }}>Good news:</strong> under the recommended strategy
              ("{bestLon.label}"), your money is projected to last through the entire plan —
              it doesn't run out by age {inputs.target_age}.
            </>
          )}
        </P>
      </Card>

      {/* ── 2. This year, in plain steps ───────────────────────────── */}
      <Card accent={A}>
        <CardTitle>What to actually do this year</CardTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ad.from_taxable > 0 && (
            <div>
              <P>
                <strong>1. Sell about {fmt(ad.from_taxable)}</strong> worth of investments in
                your taxable (regular brokerage) account, to cover this year's spending needs
                that dividends alone don't cover.
              </P>
              {saleNote && <P style={{ marginTop: -6 }}>↳ {saleNote}</P>}
            </div>
          )}
          {ad.roth_conversion > 0 && !ad.tax_optimal_exceeded && (
            <P>
              <strong>2. Move about {fmt(ad.roth_conversion)}</strong> from your Rollover IRA
              into your Roth IRA (a "Roth conversion"). You pay tax on this amount now, at
              today's rate — but afterward it grows completely tax-free forever, including for
              whoever eventually inherits it.
            </P>
          )}
          {bucketShort && (
            <P>
              <strong style={{ color: R }}>3. Top up your cash reserve.</strong> The cash you
              keep aside for near-term spending only covers about {bucketMonths.toFixed(1)} of
              the {bucketYearsRequired * 12} months it's supposed to — about
              {' '}{fmt(bucketShortfall)} short. Part of this year's sale proceeds should go
              toward refilling that before anything else.
            </P>
          )}
          {hasConc && topConc && (
            <P>
              <strong style={{ color: A }}>4. Watch your concentration.</strong> One
              position, {topConc.symbol}, makes up about {topConc.pct.toFixed(0)}% of your
              entire portfolio. That's a lot of risk riding on one company — trimming it down
              gradually (as the tax rules allow) would spread that risk out.
            </P>
          )}
          {!ad.from_taxable && !ad.roth_conversion && !bucketShort && !hasConc && (
            <P>Nothing urgent this year — dividends and existing income cover your spending.</P>
          )}
        </div>
      </Card>

      {/* ── 3. Simple chart ────────────────────────────────────────── */}
      <Card accent={G}>
        <CardTitle>Your money over time, at a glance</CardTitle>
        <P>
          This is your total balance (all three accounts combined), year by year, if you follow
          the recommended "{bestLon.label}" strategy. Each point is one year older.
        </P>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 60 }}>
            <defs>
              <linearGradient id="plainSummaryGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={G} stopOpacity={0.25} />
                <stop offset="95%" stopColor={G} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--fd-hairline)" vertical={false} />
            <XAxis dataKey="age" tick={{ fill: M, fontSize: 12 }} tickLine={false} axisLine={false}
              label={{ value: 'Your age', position: 'insideBottom', offset: -2, fill: M, fontSize: 12 }} />
            <YAxis tick={{ fill: M, fontSize: 12 }} tickFormatter={v => fmt(v)} axisLine={false} tickLine={false} width={55} />
            <Tooltip content={<MoneyTooltip />} />
            {runsOut && <ReferenceLine x={bestLon.depleted_at_age!} stroke={R} strokeDasharray="4 3"
              label={{ value: 'money runs out', position: 'top', fill: R, fontSize: 12 }} />}
            <ReferenceLine y={0} stroke="var(--fd-hairline)" />
            <Area type="monotone" dataKey="total" stroke={G} fill="url(#plainSummaryGrad)" strokeWidth={2.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* ── 4. Tax situation, simply put ───────────────────────────── */}
      <Card accent={BL}>
        <CardTitle>Your tax situation, simply put</CardTitle>
        <P>
          You're aiming to stay inside the <strong>{(inputs.target_bracket * 100).toFixed(0)}%</strong> tax
          bracket this year, with about <strong>{fmt(ad.bracket_headroom)}</strong> of room left in
          it before you'd spill into a higher one.
        </P>
        <P>
          When you sell investments, how much tax you pay depends on how long you've owned
          them: over a year gets a lower "long-term" rate, under a year gets taxed like regular
          income. {ad.no_lot_data
            ? `We don't have the detailed data to say which applies to your holdings right now.`
            : ad.ltcg_from_taxable > 0 && ad.stcg_from_taxable === 0
              ? `Good news — the shares this plan sells this year all qualify for the lower rate.`
              : ad.stcg_from_taxable > 0 && ad.ltcg_from_taxable === 0
                ? `Right now, none of your taxable holdings have been owned long enough for the
                   lower rate — so any sale this year is taxed like regular income until lots
                   mature. The Tax tab's "Sell & Rebalance" section tracks exactly when each
                   one becomes eligible.`
                : `This year's plan is a mix of both — some shares qualify for the lower rate,
                   some don't yet.`}
        </P>
        <P>
          Switching to the smartest tax strategy (vs. the least efficient of the five options
          compared in the Withdrawal Schedule section) could save you roughly
          {' '}<strong style={{ color: G }}>{fmt(lifetimeTaxSavings)}</strong> in taxes over the
          life of the plan.
        </P>
      </Card>

      {/* ── 5. Will my money last / legacy ─────────────────────────── */}
      <Card accent={G}>
        <CardTitle>Will my money last, and what's left over?</CardTitle>
        <P>
          Using the recommended "{bestLon.label}" strategy, your money is projected to{' '}
          {runsOut ? `last until around age ${bestLon.depleted_at_age}` : `last for the whole plan, through age ${inputs.target_age}`}.
        </P>
        <P>
          If there's money left at the end, most of it sits in your Roth IRA — currently
          projected at about <strong>{fmt(bestLon.roth_preserved)}</strong>. That matters because
          Roth money passes to whoever inherits it completely tax-free, unlike the other accounts.
        </P>
      </Card>

      {/* ── 6. Safe spending recap ─────────────────────────────────── */}
      <Card accent={A}>
        <CardTitle>How "safe spending" works (Spending Plan section)</CardTitle>
        <P>
          Rather than locking in one fixed spending number forever, the Spending Plan section sets
          up "guardrails" — simple rules that automatically raise your spending a bit in good
          market years, and trim it a bit in bad ones. The goal is to avoid the worst outcome:
          spending too much right as a bad stretch of markets hits early in retirement, which can
          do lasting damage to a portfolio. Think of it as cruise control for your spending,
          not a strict budget.
        </P>
      </Card>

      {/* ── Glossary ────────────────────────────────────────────────── */}
      <Card>
        <CardTitle>Quick glossary</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 24px' }}>
          {[
            ['LTCG (long-term capital gain)', 'Profit from selling something you owned over a year — taxed at a lower rate.'],
            ['STCG (short-term capital gain)', 'Profit from selling something you owned under a year — taxed like regular income.'],
            ['Roth conversion', 'Voluntarily moving money from a pre-tax IRA into a Roth IRA, paying tax now so it grows tax-free later.'],
            ['RMD (required minimum distribution)', 'The amount the IRS forces you to withdraw from pre-tax accounts once you reach a certain age.'],
            ['Tax bracket', 'The tax rate that applies to your next dollar of income — income is taxed in layers, not all at one rate.'],
            ['NIIT', 'An extra 3.8% surtax on investment income for higher earners.'],
          ].map(([term, def]) => (
            <div key={term} style={{ padding: '4px 0' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)' }}>{term}</div>
              <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>{def}</div>
            </div>
          ))}
        </div>
      </Card>

    </div>
  )
}
