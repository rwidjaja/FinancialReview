import { PanelHeader, DataRow, Divider, TermBadge } from '../ui/Terminal'
import { GaugeRing, MiniBar } from '../ui/Sparkline'
import { confidenceColor, fmtPctAbs } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'

const G = 'var(--green)'
const R = 'var(--red)'
const A = 'var(--amber)'
const Y = 'var(--yellow)'
const M = 'var(--text2)'

interface Props { data: DashboardData }

export function PortfolioSystemState({ data }: Props) {
  const pi = data.portfolio_intel
  const td = data.tax_data
  if (!pi) return null

  const confColor = confidenceColor(pi.system_confidence_score)
  const fragColor = pi.fragility_level === 'HIGH' ? R : pi.fragility_level === 'MODERATE' ? Y : G
  const durColor = pi.income_durability_score > 70 ? G : pi.income_durability_score > 40 ? Y : R
  const volColor = pi.vol_budget_used > 130 ? R : pi.vol_budget_used > 100 ? Y : G

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* ── Confidence mega-strip ── */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--fd-hairline)',
        borderRadius: 0,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
        borderLeft: `3px solid ${confColor}`,
      }}>
        <div>
          <div className="bb-label">SYSTEM CONFIDENCE</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 36, fontWeight: 500, color: confColor, letterSpacing: -2 }}>
              {pi.system_confidence_score.toFixed(0)}
            </span>
            <span style={{ color: M }}>/100</span>
            <TermBadge color={confColor}>{pi.system_confidence_label}</TermBadge>
            {pi.confidence_delta != null && (
              <span style={{ fontSize: 12, color: pi.confidence_delta >= 0 ? G : R, fontWeight: 500 }}>
                {pi.confidence_delta >= 0 ? '▲' : '▼'}{Math.abs(pi.confidence_delta).toFixed(1)}
              </span>
            )}
          </div>
        </div>

        {/* Gauge row */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <MiniGauge label="FRAGILITY" val={pi.fragility_score} color={fragColor} invert />
          <MiniGauge label="DURABILITY" val={pi.income_durability_score} color={durColor} />
          <MiniGauge label="STABILITY" val={pi.inc_stability_pct} color="var(--cyan)" unit="%" />
        </div>

        {/* Wide bar */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="bb-bar-track" style={{ height: 6, borderRadius: 0 }}>
            <div className="bb-bar-fill anim-bar" style={{ width: `${pi.system_confidence_score}%`, height: 6, background: confColor }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: M, marginTop: 3, letterSpacing: '0.5px' }}>
            <span>0 FRAGILE</span><span>35</span><span>55</span><span>75</span><span>100 ROBUST</span>
          </div>
        </div>
      </div>

      {/* ── 4-col data grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>

        {/* Primary Driver */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <PanelHeader>Primary Driver</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{pi.top_holding}</div>
            <div className="bb-sub">{pi.top_holding_pct}% OF PORTFOLIO</div>
            <Divider />
            <DataRow label="1Y RETURN"
              value={<span style={{ color: pi.top_return_1y_pct >= 0 ? G : R }}>{pi.top_return_1y_pct >= 0 ? '+' : ''}{fmtPctAbs(pi.top_return_1y_pct)}</span>} />
            <DataRow label="RETURN CONTRIB"
              value={<span style={{ color: pi.top_return_contrib_pct >= 0 ? G : R }}>+{fmtPctAbs(pi.top_return_contrib_pct)} PTS</span>} />
            <DataRow label="DRAWDOWN CONTRIB"
              value={<span style={{ color: R }}>−{fmtPctAbs(Math.abs(pi.top_drawdown_contrib_pct))} PTS</span>} />
          </div>
        </div>

        {/* Portfolio Shape */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <PanelHeader>Portfolio Shape</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            <ShapeRow label="GROWTH" pct={pi.tech_growth_pct} color="var(--blue)" />
            <ShapeRow label="INCOME" pct={pi.income_pct} color={G} />
            <ShapeRow label="DEFENSIVE" pct={pi.defensive_pct} color={Y} />
            <Divider />
            <DataRow label="PORTFOLIO BETA"
              value={<span style={{ color: A }}>β {pi.weighted_beta}</span>} />
            <DataRow label="VOL BUDGET"
              value={<span style={{ color: volColor }}>{pi.vol_budget_used}% USED</span>}
              bar={{ value: Math.min(100, pi.vol_budget_used), color: volColor }}
            />
            <div style={{ display: 'flex', gap: 3, marginTop: 4, fontSize: 12, color: M }}>
              <span>ACTUAL {pi.portfolio_vol_pct}%</span>
              <span>/</span>
              <span>TARGET {pi.target_vol_pct}%</span>
            </div>
          </div>
        </div>

        {/* Stress Scenarios */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <PanelHeader>Stress Scenarios</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            <StressRow label="MARKET −20%" pct={pi.stress_qqq_pct} dollar={pi.stress_qqq_dollar} />
            <StressRow label={`${pi.stress_top_sym} −30%`} pct={pi.stress_top_pct} dollar={pi.stress_top_dollar} />
            {pi.stress_top2_sym && (
              <StressRow label={`${pi.stress_top2_sym} −30%`} pct={pi.stress_top2_pct} dollar={pi.stress_top2_dollar} />
            )}
            <StressRow label="VIX → 30" pct={pi.stress_vix_pct} dollar={pi.stress_vix_dollar} />
            {pi.combined_stress_pct != null && (
              <>
                <div style={{ height: 1, background: 'var(--border2)', margin: '4px 0' }} />
                <StressRow label="COMBINED WORST" pct={pi.combined_stress_pct} dollar={pi.combined_stress_dollar} highlight />
              </>
            )}
          </div>
        </div>

        {/* Income & Tax */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
          <PanelHeader>Income &amp; Tax Exposure</PanelHeader>
          <div style={{ padding: '8px 10px' }}>
            <DataRow label="TAXABLE INCOME"
              value={<span style={{ color: R }}>{pi.taxable_inc_pct}%</span>}
              bar={{ value: pi.taxable_inc_pct, color: R }}
            />
            <DataRow label="TAX-FREE INCOME"
              value={<span style={{ color: G }}>{pi.tax_free_inc_pct}%</span>}
              bar={{ value: pi.tax_free_inc_pct, color: G }}
            />
            {pi.income_vix_spike_drop_pct != null && (
              <DataRow label="VOL SPIKE RISK"
                value={<span style={{ color: A }}>{pi.income_vix_spike_drop_pct}%</span>}
                sub="income drop if VIX↑"
              />
            )}
            <Divider label="risk budget" />
            <DataRow
              label="RISK BUDGET"
              value={<span style={{ color: pi.risk_budget_used >= 130 ? R : pi.risk_budget_used >= 100 ? A : G }}>
                {pi.risk_budget_used.toFixed(0)}%
              </span>}
              sub={pi.risk_budget_label}
              bar={{ value: Math.min(100, pi.risk_budget_used), color: pi.risk_budget_used >= 130 ? R : pi.risk_budget_used >= 100 ? A : G }}
            />

            {/* Roth score */}
            {td && (
              <>
                <Divider label="roth signal" />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div className="bb-label">CONV. SCORE</div>
                    <div style={{ fontSize: 20, fontWeight: 500, color: td.conv_action === 'AGGRESSIVE TOP-OFF' ? G : td.conv_action === 'PARTIAL' ? Y : A }}>
                      {td.conv_score}<span style={{ fontSize: 12, color: M }}>/10</span>
                    </div>
                  </div>
                  <TermBadge color={td.conv_action === 'AGGRESSIVE TOP-OFF' ? G : Y}>
                    {td.conv_action}
                  </TermBadge>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ShapeRow({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span style={{ color: M }}>{label}</span>
        <span style={{ fontWeight: 500, color }}>{pct}%</span>
      </div>
      <MiniBar value={pct} color={color} width={120} height={3} />
    </div>
  )
}

function StressRow({ label, pct, dollar, highlight = false }:
  { label: string; pct: number; dollar: number; highlight?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '3px 0', borderBottom: '1px solid var(--border)', fontSize: 12,
      fontWeight: highlight ? 700 : 400,
    }}>
      <span style={{ color: M, fontSize: 12 }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <span style={{ color: R }}>{pct}%</span>
        <span style={{ color: 'var(--text3)', fontSize: 12, marginLeft: 4 }}>
          ≈−${Math.abs(dollar).toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </span>
      </div>
    </div>
  )
}

function MiniGauge({ label, val, color, unit = '', invert = false }:
  { label: string; val: number; color: string; unit?: string; invert?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <GaugeRing value={invert ? Math.max(0, 100 - val) : val} color={color} size={36} />
      <div style={{ fontSize: 12, fontWeight: 500, color, marginTop: 1 }}>{val.toFixed(0)}{unit}</div>
      <div className="bb-label" style={{ fontSize: 12 }}>{label}</div>
    </div>
  )
}
