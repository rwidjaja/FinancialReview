// ── Deep Analytics Panels ─────────────────────────────────────────────────────

import { PanelHeader, DataRow, Divider } from '../ui/Terminal'
import { MiniBar } from '../ui/Sparkline'
import { fmtPct, gainColor } from '../../utils/formatters'
import { G, R, A, M, Y } from './researchTypes'
import type { ResearchApiData } from './researchTypes'
import { fmtAssets } from './researchHelpers'
import { MomentumScorePanel } from './ResearchMeters'
import type { DashboardData } from '../../types/dashboard'

export function NavTrendPanel({ nm }: { nm: NonNullable<ResearchApiData['nav_metrics']> }) {
  const arrow = (t?: string) => t === 'Up' ? '▲' : t === 'Down' ? '▼' : '→'
  const arrowColor = (t?: string) => t === 'Up' ? G : t === 'Down' ? R : M
  const pctColor = (p?: number) => p == null ? M : p > 3 ? G : p < -3 ? R : 'var(--text)'
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>{nm.is_price_proxy ? 'PRICE TREND (≈ NAV PROXY)' : 'PRICE TREND / NAV'}</PanelHeader>
      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[['3M', nm.price_3m_pct, nm.trend_3m], ['6M', nm.price_6m_pct, nm.trend_6m], ['12M', nm.price_12m_pct, nm.trend_12m]].map(([label, pct, trend]) => (
          <div key={label as string} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 500, color: pctColor(pct as number | undefined), fontFamily: 'var(--font-mono)' }}>
              {pct != null ? `${(pct as number) >= 0 ? '+' : ''}${(pct as number).toFixed(1)}%` : '—'}
            </div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: arrowColor(trend as string) }}>{arrow(trend as string)}</span>
              <span style={{ color: M }}> {trend ?? '—'}</span>
            </div>
          </div>
        ))}
      </div>
      {nm.roc_risk && nm.roc_note && (
        <div style={{ marginTop: 8, padding: '6px 8px', background: 'var(--fd-card)', border: '1px solid var(--fd-hairline)', fontSize: 12 }}>
           <strong>ROC Risk:</strong> {nm.roc_note}
        </div>
      )}
      {nm.note && <div style={{ marginTop: 6, fontSize: 12, color: M }}>{nm.note}</div>}
    </div>
  )
}

export function TechPanelAdvanced({ r }: { r: ResearchApiData }) {
  const t = r.technicals
  if (!t) return null
  const rsi = t.rsi_14
  const rsiColor = rsi == null ? M : rsi >= 70 ? R : rsi <= 30 ? G : M
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>TECHNICALS — TREND & MOMENTUM</PanelHeader>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rsi != null && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 12, color: M, fontWeight: 500 }}>RSI (14)</span>
              <span style={{ color: rsiColor, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                {rsi.toFixed(1)} — {rsi >= 70 ? 'OVERBOUGHT' : rsi <= 30 ? 'OVERSOLD' : 'NEUTRAL'}
              </span>
            </div>
            <MiniBar value={rsi} color={rsiColor} height={5} />
            <Divider />
          </>
        )}
        {t.macd_histogram != null && <DataRow label="MACD" value={<span style={{ color: t.macd_bullish ? G : R, fontWeight: 500 }}>{t.macd_bullish ? 'Bullish' : 'Bearish'} ({t.macd_histogram.toFixed(4)})</span>} />}
        {t.stochastic_k != null && <DataRow label="STOCH %K/%D" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{t.stochastic_k.toFixed(1)} / {t.stochastic_d?.toFixed(1) ?? '—'}</span>} />}
        {t.obv_bullish != null && <DataRow label="OBV Signal" value={<span style={{ color: t.obv_bullish ? G : R, fontWeight: 500 }}>{t.obv_bullish ? 'Bullish' : 'Bearish'}</span>} />}
        <Divider />
        {t.ma_20 != null && <DataRow label="20-Day MA" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${t.ma_20.toFixed(2)}</span>} />}
        {t.ma_50 != null && <DataRow label="50-Day MA" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${t.ma_50.toFixed(2)}</span>} />}
        {t.ma_200 != null && <DataRow label="200-Day MA" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${t.ma_200.toFixed(2)}</span>} />}
        {t.bollinger_upper != null && <DataRow label="BB U/M/L" value={<span style={{ color: M, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{t.bollinger_upper.toFixed(2)} / {t.bollinger_mid?.toFixed(2) ?? '—'} / {t.bollinger_lower?.toFixed(2) ?? '—'}</span>} />}
        <Divider />
        {t.avg_volume_10d != null && <DataRow label="10D Avg Vol" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{t.avg_volume_10d.toLocaleString()}</span>} />}
        {t.avg_volume_90d != null && <DataRow label="90D Avg Vol" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{t.avg_volume_90d.toLocaleString()}</span>} />}
        {t.hist_vol_10d != null && <DataRow label="Hist. Vol (10D)" value={<span style={{ color: t.hist_vol_10d > 30 ? R : t.hist_vol_10d > 15 ? Y : G, fontFamily: 'var(--font-mono)' }}>{t.hist_vol_10d.toFixed(1)}%</span>} />}
      </div>
      <MomentumScorePanel technicals={t} tl={r.trading_levels} />
    </div>
  )
}

export function RiskPanelAdvanced({ r }: { r: ResearchApiData }) {
  const rs = r.risk_stats
  if (!rs) return null
  const upCl = (rs.upside_capture ?? 0) >= 100 ? G : Y
  const downCl = (rs.downside_capture ?? 0) <= 100 ? G : R
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>RISK STATISTICS {rs.period_years ? `(${rs.period_years}Y vs ${rs.benchmark ?? 'SPY'})` : ''}</PanelHeader>
      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
        {[
          { label: 'BETA', val: rs.beta?.toFixed(2) ?? '—', color: rs.beta != null ? (rs.beta > 1.2 ? R : rs.beta < 0.8 ? G : M) : M },
          { label: 'ALPHA', val: rs.alpha != null ? `${rs.alpha >= 0 ? '+' : ''}${rs.alpha.toFixed(2)}%` : '—', color: rs.alpha != null ? (rs.alpha >= 0 ? G : R) : M },
          { label: 'R²', val: rs.r_squared?.toFixed(1) ? `${rs.r_squared.toFixed(1)}%` : '—' },
          { label: 'UPSIDE CAPTURE', val: rs.upside_capture?.toFixed(1) ? `${rs.upside_capture.toFixed(1)}%` : '—', color: upCl },
          { label: 'DOWNSIDE CAPTURE', val: rs.downside_capture?.toFixed(1) ? `${rs.downside_capture.toFixed(1)}%` : '—', color: downCl },
          { label: 'SHARPE', val: rs.sharpe?.toFixed(2) ?? '—', color: rs.sharpe != null ? (rs.sharpe > 1 ? G : rs.sharpe > 0.5 ? A : R) : M },
          { label: 'MAX DRAWDOWN', val: rs.max_drawdown?.toFixed(2) ? `${rs.max_drawdown.toFixed(2)}%` : '—', color: R },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '6px 8px' }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', marginBottom: 2 }}>{c.label}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: (c as any).color ?? 'var(--text)', fontFamily: 'var(--font-mono)' }}>{c.val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DrawdownPanel({ beta, maxDD }: { beta: number; maxDD?: number }) {
  const scenarios = [
    { label: 'Mild', market: -10, color: Y },
    { label: 'Moderate', market: -20, color: 'var(--fd-ink)' },
    { label: 'Severe', market: -30, color: R },
  ]
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border2)' }}>
        <PanelHeader> DRAWDOWN PROJECTION</PanelHeader>
        <span style={{ fontSize: 12, color: M }}>expected loss if SPY drops (β × market move)</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 8 }}>
        {scenarios.map(sc => {
          const exp = (beta * sc.market).toFixed(1)
          const wst = (beta * 1.25 * sc.market).toFixed(1)
          return (
            <div key={sc.label} style={{ textAlign: 'center', padding: '10px 8px', background: 'var(--fd-card)', border: `1px solid ${sc.color}` }}>
              <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', fontWeight: 500, marginBottom: 4 }}>{sc.label}</div>
              <div style={{ fontSize: 12, color: M }}>SPY {sc.market}%</div>
              <div style={{ fontSize: 28, fontWeight: 500, color: sc.color, margin: '4px 0', fontFamily: 'var(--font-mono)' }}>{exp}%</div>
              <div style={{ fontSize: 12, color: M }}>worst ~{wst}%</div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 12, color: M }}>
        Beta: <strong style={{ color: 'var(--text)' }}>{beta.toFixed(2)}</strong>
        {maxDD != null && <> &nbsp;·&nbsp; Historical max drawdown: <strong style={{ color: R }}>{maxDD.toFixed(1)}%</strong></>}
        {' '}&nbsp;·&nbsp; Illustrative only — actual moves vary with regime and position sizing.
      </div>
    </div>
  )
}

export function PerfTable({ pt }: { pt: NonNullable<ResearchApiData['performance_table']> }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px', overflowX: 'auto' }}>
      <PanelHeader>PRICE PERFORMANCE vs BENCHMARK</PanelHeader>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 6 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '5px 10px', fontSize: 12, color: M, borderBottom: '1px solid var(--border2)', fontWeight: 500 }}>CATEGORY</th>
            {pt.periods.map(p => <th key={p} style={{ textAlign: 'right', padding: '5px 10px', fontSize: 12, color: M, borderBottom: '1px solid var(--border2)', fontWeight: 500 }}>{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {pt.rows.map((row, i) => {
            const isBm = row.label.toLowerCase().includes('s&p') || row.label.toLowerCase().includes('benchmark')
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border2)', background: i === 0 ? 'var(--fd-card)' : 'transparent' }}>
                <td style={{ padding: '5px 10px', color: isBm ? M : 'var(--text)', fontWeight: isBm ? 400 : 700, fontSize: 12 }}>{row.label}</td>
                {row.values.map((v, j) => (
                  <td key={j} style={{ textAlign: 'right', padding: '5px 10px', color: v == null ? M : v >= 0 ? G : R, fontWeight: 500 }}>
                    {v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function FundPanel({ r, data, symbol, advanced }: { r: ResearchApiData; data: DashboardData; symbol: string; advanced?: boolean }) {
  const snap = data.snapshots[symbol]
  const dist = r.distributions
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>FUNDAMENTALS & INCOME</PanelHeader>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {dist?.ttm_yield != null && <DataRow label="TTM YIELD" value={<span style={{ color: G, fontWeight: 500, fontSize: 13 }}>{dist.ttm_yield.toFixed(2)}%</span>} />}
        {dist?.last_amount != null && <DataRow label="LAST DIST" value={<span style={{ color: G, fontFamily: 'var(--font-mono)' }}>${dist.last_amount.toFixed(4)}</span>} />}
        {dist?.frequency && <DataRow label="FREQUENCY" value={<span style={{ color: M }}>{dist.frequency}</span>} />}
        {r.annualized_returns?.symbol?.['1Y'] != null && (
          <>
            <Divider />
            <DataRow label="1Y TOTAL RETURN" value={<span style={{ color: gainColor((r.annualized_returns.symbol['1Y'] ?? 0) / 100), fontWeight: 500 }}>{(r.annualized_returns.symbol['1Y'] ?? 0) >= 0 ? '+' : ''}{r.annualized_returns.symbol['1Y']!.toFixed(2)}%</span>} />
            {r.annualized_returns.spy?.['1Y'] != null && <DataRow label="SPY 1Y (BM)" value={<span style={{ color: M }}>{r.annualized_returns.spy['1Y']!.toFixed(2)}%</span>} />}
          </>
        )}
        {r.profile?.expense_ratio != null && (
          <>
            <Divider />
            <DataRow label="EXPENSE RATIO" value={<span style={{ color: r.profile.expense_ratio > 0.001 ? Y : G }}>{(r.profile.expense_ratio * 100).toFixed(2)}%</span>} />
          </>
        )}
        {snap?.distribution_cut_pct != null && (
          <>
            <Divider />
            <DataRow label="DIST CUT (12M)" value={<span style={{ color: snap.distribution_cut_pct < 0 ? R : G, fontWeight: 500 }}>{fmtPct(snap.distribution_cut_pct * 100)}</span>} />
          </>
        )}
        {advanced && r.fund_strategy && (
          <>
            <Divider label="STRATEGY" />
            <div style={{ fontSize: 12, color: M, lineHeight: 1.5 }}>{r.fund_strategy}</div>
          </>
        )}
      </div>
    </div>
  )
}

export function FundProfilePanel({ r }: { r: ResearchApiData }) {
  const p = r.profile
  if (!p) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>FUND PROFILE</PanelHeader>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <DataRow label="Fund Type" value={<span style={{ color: M }}>{p.asset_type ?? '—'}</span>} />
        <DataRow label="Category" value={<span style={{ color: M }}>{p.category ?? '—'}</span>} />
        <DataRow label="Fund Company" value={<span style={{ color: M }}>{p.fund_company ?? '—'}</span>} />
        <DataRow label="Inception Date" value={<span style={{ color: M }}>{p.inception_date ?? '—'}</span>} />
        <DataRow label="Total Assets" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{fmtAssets(p.total_assets)}</span>} />
        <DataRow label="Expense Ratio" value={<span style={{ color: p.expense_ratio != null && p.expense_ratio > 0.001 ? Y : G }}>{p.expense_ratio != null ? `${(p.expense_ratio * 100).toFixed(2)}%` : '—'}</span>} />
        <DataRow label="Beta (3Y)" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{p.beta ?? '—'}</span>} />
        {p.holdings_count != null && <DataRow label="Holdings Count" value={<span style={{ color: M }}>{p.holdings_count}</span>} />}
        {r.events?.ex_div_date && (() => {
          const daysToEx = Math.round((new Date(r.events!.ex_div_date!).getTime() - Date.now()) / 86400000)
          const soonWarning = daysToEx >= 1 && daysToEx <= 30
          return (
            <>
              <DataRow label="Ex-Div Date" value={
                <span style={{ color: soonWarning ? Y : G, fontFamily: 'var(--font-mono)' }}>
                  {r.events!.ex_div_date}{soonWarning ? ` (${daysToEx}d)` : ''}
                </span>
              } />
              {soonWarning && (
                <div style={{ fontSize: 12, color: Y, padding: '2px 0 2px 4px',
                  borderLeft: `2px solid ${Y}`, marginTop: 2 }}>
                  Ex-div in {daysToEx} day{daysToEx === 1 ? '' : 's'} — buy before to capture distribution
                </div>
              )}
            </>
          )
        })()}
        {r.events?.div_date && <DataRow label="Pay Date" value={<span style={{ color: M }}>{r.events.div_date}</span>} />}
      </div>
    </div>
  )
}

export function AnalystPanel({ r, price }: { r: ResearchApiData; price: number }) {
  const ks = r.key_stats
  if (!ks) return null
  const rec = ks.recommendation ?? ''
  const recLabel = rec === 'strong_buy' ? 'Strong Buy' : rec === 'buy' ? 'Buy' : rec === 'hold' ? 'Hold' : rec === 'sell' ? 'Sell' : rec === 'strong_sell' ? 'Strong Sell' : rec || '—'
  const recColor = rec.includes('buy') ? G : rec === 'hold' ? Y : rec.includes('sell') ? R : M
  const tgtUpside = ks.analyst_target && price ? ((ks.analyst_target - price) / price * 100) : null
  const tgtColor = tgtUpside != null ? (tgtUpside > 5 ? G : tgtUpside < 0 ? R : Y) : M
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>ANALYST CONSENSUS</PanelHeader>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <DataRow label="Consensus" value={<span style={{ color: recColor, fontWeight: 500 }}>{recLabel}</span>} />
        <DataRow label="Price Target" value={<span style={{ color: tgtColor, fontFamily: 'var(--font-mono)' }}>{ks.analyst_target ? `$${ks.analyst_target.toFixed(2)}${tgtUpside != null ? ` (${tgtUpside >= 0 ? '+' : ''}${tgtUpside.toFixed(1)}%)` : ''}` : '—'}</span>} />
        <DataRow label="Target Range" value={<span style={{ color: M, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{ks.analyst_low && ks.analyst_high ? `$${ks.analyst_low.toFixed(2)} – $${ks.analyst_high.toFixed(2)}` : '—'}</span>} />
        <DataRow label="Analyst Count" value={<span style={{ color: M }}>{ks.num_analyst_opinions ?? '—'}</span>} />
        <Divider />
        {ks.pe_ratio != null && <DataRow label="P/E Ratio" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{ks.pe_ratio.toFixed(1)}</span>} />}
        {ks.price_to_book != null && <DataRow label="P/B" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>{ks.price_to_book.toFixed(2)}</span>} />}
        {ks.profit_margin != null && <DataRow label="Profit Margin" value={<span style={{ color: gainColor(ks.profit_margin) }}>{(ks.profit_margin * 100).toFixed(1)}%</span>} />}
      </div>
    </div>
  )
}

export function EarningsPanel({ r }: { r: ResearchApiData }) {
  const ks = r.key_stats
  const ev = r.events
  if (!ks) return null
  const nextEarnings = ev?.earnings_date ?? ''
  const daysToEarnings = nextEarnings ? Math.round((new Date(nextEarnings).getTime() - Date.now()) / 86400000) : null
  const earningsColor = daysToEarnings != null && daysToEarnings <= 14 ? R : daysToEarnings != null && daysToEarnings <= 30 ? Y : 'var(--text)'
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>EARNINGS & GROWTH</PanelHeader>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {nextEarnings && <DataRow label="Next Earnings" value={<span style={{ color: earningsColor, fontWeight: 500 }}>{nextEarnings.split('T')[0]}{daysToEarnings != null ? ` (${daysToEarnings}d)` : ''}</span>} />}
        {ks.eps_ttm != null && <DataRow label="EPS (TTM)" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${ks.eps_ttm.toFixed(2)}</span>} />}
        {ks.eps_forward != null && <DataRow label="Forward EPS" value={<span style={{ color: M, fontFamily: 'var(--font-mono)' }}>${ks.eps_forward.toFixed(2)}</span>} />}
        {ks.earnings_growth != null && <DataRow label="EPS Growth" value={<span style={{ color: gainColor(ks.earnings_growth), fontFamily: 'var(--font-mono)' }}>{(ks.earnings_growth * 100).toFixed(1)}%</span>} />}
        {ks.revenue_growth != null && <DataRow label="Rev Growth" value={<span style={{ color: gainColor(ks.revenue_growth), fontFamily: 'var(--font-mono)' }}>{(ks.revenue_growth * 100).toFixed(1)}%</span>} />}
        {ks.return_on_equity != null && <DataRow label="ROE" value={<span style={{ color: gainColor(ks.return_on_equity), fontFamily: 'var(--font-mono)' }}>{(ks.return_on_equity * 100).toFixed(1)}%</span>} />}
        {ks.debt_to_equity != null && <DataRow label="D/E" value={<span style={{ color: ks.debt_to_equity > 2 ? R : M, fontFamily: 'var(--font-mono)' }}>{ks.debt_to_equity.toFixed(2)}</span>} />}
      </div>
    </div>
  )
}

export function HoldingsPanel({ holdings, holdingsUrl, onSymbolClick }: { holdings: NonNullable<ResearchApiData['holdings']>; holdingsUrl?: string; onSymbolClick?: (sym: string) => void }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>TOP HOLDINGS</PanelHeader>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {holdings.slice(0, 15).map((h, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: M, width: 16, flexShrink: 0 }}>{i + 1}</span>
            <span
              onClick={() => h.symbol && onSymbolClick?.(h.symbol)}
              style={{
                fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, width: 60, flexShrink: 0,
                cursor: onSymbolClick && h.symbol ? 'pointer' : 'default',
                color: onSymbolClick && h.symbol ? A : 'var(--text)',
                textDecoration: onSymbolClick && h.symbol ? 'underline dotted' : 'none',
                textUnderlineOffset: 2,
              }}
            >{h.symbol ?? '—'}</span>
            {h.weight_pct != null && (
              <>
                <div style={{ flex: 1, height: 4, background: 'var(--bg)', borderRadius: 0, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, h.weight_pct * 4)}%`, background: A, borderRadius: 0 }} />
                </div>
                <span style={{ fontSize: 12, color: A, fontFamily: 'var(--font-mono)', width: 40, textAlign: 'right' }}>{h.weight_pct.toFixed(2)}%</span>
              </>
            )}
            {h.name && <span style={{ fontSize: 12, color: M, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>}
          </div>
        ))}
        {holdingsUrl && (
          <a href={holdingsUrl} target="_blank" rel="noopener" style={{ display: 'block', marginTop: 8, fontSize: 12, color: A, textDecoration: 'none', borderTop: '1px solid var(--border2)', paddingTop: 6 }}>
             View full holdings on fund website ↗
          </a>
        )}
      </div>
    </div>
  )
}
