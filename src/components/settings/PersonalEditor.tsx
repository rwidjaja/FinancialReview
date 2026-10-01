/**
 * PersonalEditor — compact table-style form matching AllocationEditor design.
 * Covers all sections of personal.json:
 *   _PERSONAL · _INCOME_TARGET · _TARGET_ALLOC
 * Schwab account mapping is managed separately in account_mapping.json.
 */
import { useState, useEffect } from 'react'
import { PanelHeader } from './PanelHeader'
import { SaveBar } from './SaveBar'
import { DEFAULT_SAFETY_BUFFER } from '../../utils/constants'
import { useDashboardData } from '../../hooks/useDashboardData'
import { fmtMoneyFull } from '../../utils/formatters'

const M  = 'var(--text2)'
const A  = 'var(--amber)'
const BG = 'var(--bg)'
const P  = 'var(--panel)'

// ── shared cell styles ────────────────────────────────────────────────────────

const LBL: React.CSSProperties = {
  padding: '5px 10px', fontSize: 12, color: M, fontWeight: 500,
  whiteSpace: 'nowrap', width: 200,
}

const VAL: React.CSSProperties = {
  padding: '3px 10px',
}

const CELL_INPUT: React.CSSProperties = {
  background: 'transparent', border: 'none', outline: 'none',
  color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
  width: '100%', padding: '2px 0',
}

const SELECT: React.CSSProperties = {
  background: P, border: '1px solid var(--fd-hairline)', outline: 'none',
  color: 'var(--text)', fontSize: 12, borderRadius: 0, padding: '2px 6px', cursor: 'pointer',
}

// ── section header row ────────────────────────────────────────────────────────

function SectionRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2} style={{
        padding: '5px 10px', fontSize: 12, fontWeight: 500, color: A,
        textTransform: 'uppercase', letterSpacing: '0.8px',
        background: `${A}0d`, borderTop: '1px solid var(--border2)',
      }}>
        {label}
      </td>
    </tr>
  )
}

// ── field row ─────────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border2)' }}>
      <td style={LBL}>{label}</td>
      <td style={VAL}>{children}</td>
    </tr>
  )
}

// ── types ─────────────────────────────────────────────────────────────────────

interface SSOption { label: string; date: string; monthly: number; annual: number }

interface TaxBracket { rate: number; min: number; max: number | null }

interface PersonalData {
  _PERSONAL: {
    name: string; dob: string; filing_status: string; ss_start_age: number
    retirement_year?: number
    estimated_spending: number; collect_medicare: boolean; medicare_people: number
    target_vol_pct?: number
    conversion_safety_buffer?: number
    /** Accounts whose dividends are reinvested (DRIP) — not counted as spendable income */
    reinvested_accounts?: string[]
    spouse?: { name: string; dob: string; ss_start_age: number }
    social_security?: Record<string, SSOption>
  }
  _INCOME_TARGET:  { monthly_min: number; monthly_max: number; annual_min: number; annual_max: number }
  _TARGET_ALLOC:   { annual_conversion: number; conversion_month: number; external_accounts?: Record<string, number | string | undefined> }
  _TAX_SETTINGS?:  { target_bracket_rate: number; prior_year_tax?: number; w2_withholding_ytd?: number; _comment?: string; _prior_year_tax_comment?: string; _w2_withholding_comment?: string }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── main component ────────────────────────────────────────────────────────────

export function PersonalEditor({ data, onSaved, taxBracketsData }: {
  data: Record<string, unknown>
  onSaved: (key: string, content: unknown) => void
  taxBracketsData?: Record<string, unknown>
}) {
  const r = data as unknown as PersonalData
  const p = r._PERSONAL ?? {} as PersonalData['_PERSONAL']

  // _PERSONAL
  const [name,            setName]          = useState(p.name ?? '')
  const [dob,             setDob]           = useState(p.dob ?? '')
  const [filing,          setFiling]        = useState(p.filing_status ?? 'MFJ')
  const [ssAge,           setSsAge]         = useState(p.ss_start_age ?? 70)
  const [retirementYear,  setRetirementYear] = useState(p.retirement_year ?? new Date().getFullYear())
  const [spending,        setSpending]      = useState(p.estimated_spending ?? 0)
  const [medicare,        setMedicare]      = useState(p.collect_medicare ?? false)
  const [medPeople,       setMedPeople]     = useState(p.medicare_people ?? 1)
  // Server default (key absent) = rollover reinvested
  const [rolloverDrip,    setRolloverDrip]  = useState((p.reinvested_accounts ?? ['rollover_ira']).includes('rollover_ira'))
  const [targetVol,       setTargetVol]     = useState(p.target_vol_pct ?? 15)
  const [safetyBuf,       setSafetyBuf]     = useState(p.conversion_safety_buffer ?? DEFAULT_SAFETY_BUFFER)
  const [spouseName,      setSpouseName]    = useState(p.spouse?.name ?? '')
  const [spouseDob,       setSpouseDob]     = useState(p.spouse?.dob ?? '')
  const [spouseSsAge,     setSpouseSsAge]   = useState(p.spouse?.ss_start_age ?? 70)

  // SS scenarios
  type SSRow = SSOption & { key: string }
  const [ssRows, setSsRows] = useState<SSRow[]>(() =>
    Object.entries(p.social_security ?? {}).map(([k, v]) => ({ key: k, ...v }))
  )
  const updSS = (i: number, f: keyof SSOption, v: string | number) =>
    setSsRows(prev => prev.map((r, j) => j === i ? { ...r, [f]: v } : r))

  // _INCOME_TARGET
  const it = r._INCOME_TARGET ?? {}
  const [mMin, setMMin] = useState(it.monthly_min ?? 0)
  const [mMax, setMMax] = useState(it.monthly_max ?? 0)
  const [aMin, setAMin] = useState(it.annual_min  ?? 0)
  const [aMax, setAMax] = useState(it.annual_max  ?? 0)

  // _TARGET_ALLOC
  const ta = r._TARGET_ALLOC ?? {}
  const ext = (ta.external_accounts ?? {}) as Record<string, number>
  const [annualConv,      setAnnualConv]      = useState(ta.annual_conversion ?? 0)
  const [convMonth,       setConvMonth]       = useState(ta.conversion_month ?? 12)
  const [k401Roth,    setK401Roth]    = useState(Number(ext.k401_roth ?? 0))
  const [k401,        setK401]        = useState(Number(ext.k401 ?? 0))

  // _TAX_SETTINGS
  const ts = r._TAX_SETTINGS ?? ({} as NonNullable<PersonalData['_TAX_SETTINGS']>)
  const [targetBracket,  setTargetBracket]  = useState(ts.target_bracket_rate ?? 24)
  const [priorYearTax,   setPriorYearTax]   = useState(ts.prior_year_tax ?? 0)
  const [w2Withholding,  setW2Withholding]  = useState(ts.w2_withholding_ytd ?? 0)

  // Sync form state when data prop changes (e.g. after parent refreshes cfg from server)
  useEffect(() => {
    const rr = data as unknown as PersonalData
    const pp = rr._PERSONAL ?? {} as PersonalData['_PERSONAL']
    setFiling(pp.filing_status ?? 'MFJ')
    setTargetBracket((rr._TAX_SETTINGS?.target_bracket_rate ?? 24))
    setPriorYearTax(rr._TAX_SETTINGS?.prior_year_tax ?? 0)
    setW2Withholding(rr._TAX_SETTINGS?.w2_withholding_ytd ?? 0)
  }, [data])

  // Tax brackets from tax_brackets.json (for showing actual income ranges)
  const tbData = (taxBracketsData as any)?._TAX_BRACKETS ?? {}
  const mfjBkts: TaxBracket[] = tbData.brackets_mfj ?? []
  const sinBkts: TaxBracket[] = tbData.brackets_single ?? []
  const activeBkts = filing === 'MFJ' ? mfjBkts : sinBkts

  // Live auto-calculated conversion recommendation — reference only, shown alongside
  // the manual "Annual conversion" input above. Does not affect the saved value unless
  // "Apply recommended" is clicked, which just fills the input (still requires Save).
  const { data: dash } = useDashboardData()
  const conversionRec = dash?.tax_data?.annual_conversion_breakdown ?? null

  // conversionRec.* reflects whatever was last SAVED on the server — it does NOT react to
  // any of the fields on THIS form until you Save and the page refetches. Bracket rate,
  // standard deduction (filing status + age-65/senior addition), safety buffer, and SS
  // taxable (SS start age/scenario) are all editable right here, so recompute all of them
  // live from current form state. Dividends, W2, and realized STCG genuinely come from live
  // portfolio/Schwab data with no local input to react to, so those stay sourced from conversionRec.
  const selectedBktRow = activeBkts.find(b => Math.round(b.rate * 100) === Number(targetBracket))

  const ageFromDob = (d: string) => d ? (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24 * 365.25) : null
  const seniorCount = [ageFromDob(dob), ageFromDob(spouseDob)].filter(a => a != null && a >= 65).length
  const stdDedBase   = filing === 'MFJ' ? (tbData.standard_deduction_mfj ?? 30000) : (tbData.standard_deduction_single ?? 30000)
  let liveStdDeduction = stdDedBase + (tbData.age_65_additional_deduction_per_person ?? 1650) * seniorCount
  if (new Date().getFullYear() <= (tbData.senior_deduction_expires_year ?? 2028)) {
    liveStdDeduction += (tbData.senior_deduction_per_person ?? 6000) * seniorCount
  }

  const ssChosen      = ssRows.find(o => o.key === `age_${ssAge}`)
  const ssAnnualLive  = ssChosen ? Number(ssChosen.annual) : 0
  const hasSsNowLive  = !!ssChosen?.date && new Date().getFullYear() >= parseInt(ssChosen.date.slice(0, 4), 10)
  const grossNoSsLive = dash?.tax_data?.gross_no_ss ?? 0
  const ssTaxPctLive  = (grossNoSsLive + ssAnnualLive * 0.5) > 44000 ? 0.85 : 0.50
  const liveSsTaxable = hasSsNowLive ? ssAnnualLive * ssTaxPctLive : 0

  const liveSafetyBuffer = Number(safetyBuf)

  const liveBracketCeiling = (conversionRec && selectedBktRow?.max != null)
    ? selectedBktRow.max + liveStdDeduction
    : null
  // Stable, full-year ceiling-fill target — must NOT net out anything that's
  // already happened this year (realized STCG YTD, conversions done so far),
  // or it drifts every time it's checked as the year progresses. Actual-vs-
  // target reconciliation lives in the Tax tab, not here.
  //
  // liveBracketCeiling is ALREADY a gross-income ceiling (bracket taxable max +
  // liveStdDeduction, added back above) so it can be compared directly against
  // gross-dollar figures (dividends, W2, SS, conversion) — do NOT subtract
  // liveStdDeduction again here, that double-counts it and understates the
  // recommendation by the full deduction amount.
  const liveRecommended = (conversionRec && liveBracketCeiling != null)
    ? Math.max(0, liveBracketCeiling
        - conversionRec.dividends
        - conversionRec.w2_annualized
        - liveSsTaxable
        - liveSafetyBuffer)
    : null

  // save
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  const buildPayload = (): PersonalData => ({
    _PERSONAL: {
      name, dob, filing_status: filing,
      ss_start_age: Number(ssAge),
      retirement_year: Number(retirementYear),
      estimated_spending: Number(spending),
      collect_medicare: medicare,
      medicare_people: Number(medPeople),
      reinvested_accounts: [
        ...(p.reinvested_accounts ?? []).filter(k => k !== 'rollover_ira'),
        ...(rolloverDrip ? ['rollover_ira'] : []),
      ],
      target_vol_pct: Number(targetVol),
      conversion_safety_buffer: Number(safetyBuf),
      ...(spouseName ? { spouse: { name: spouseName, dob: spouseDob, ss_start_age: Number(spouseSsAge) } } : {}),
      social_security: Object.fromEntries(ssRows.map(o => [o.key, {
        label: o.label, date: o.date, monthly: Number(o.monthly), annual: Number(o.annual),
      }])),
    },
    _INCOME_TARGET: { monthly_min: Number(mMin), monthly_max: Number(mMax), annual_min: Number(aMin), annual_max: Number(aMax) },
    _TARGET_ALLOC: {
      annual_conversion: Number(annualConv),
      conversion_month:  Number(convMonth),
      external_accounts: {
        _comment: 'Accounts outside Schwab — balances entered manually for projection modeling only',
        k401_roth: Number(k401Roth),
        k401:      Number(k401),
      },
    },
    _TAX_SETTINGS: {
      _comment: 'Your personal tax bracket target. target_bracket_rate controls the Roth conversion ceiling, bracket pressure, and the auto-calculated conversion recommendation — one setting for all three, not separate ones. Safety buffer is in _PERSONAL.conversion_safety_buffer.',
      target_bracket_rate: Number(targetBracket),
      prior_year_tax: Number(priorYearTax),
      _prior_year_tax_comment: 'Enter your total federal tax liability from last year\'s return (Form 1040 line 24). Used for the IRS 110% safe harbor test. 0 = unknown.',
      w2_withholding_ytd: Number(w2Withholding),
      _w2_withholding_comment: 'Total W2 federal income tax withheld YTD. Counts toward safe harbor alongside estimated tax payments. 0 = pure dividend year or not applicable.',
    },
  })

  const save = async () => {
    setSaving(true); setError('')
    try {
      const payload = buildPayload()
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'personal_json', content: payload }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Save failed')
      setSaved(true); onSaved('personal_json', payload)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  const tableStyle: React.CSSProperties = {
    width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed',
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <PanelHeader>Personal Configuration</PanelHeader>

      <div style={{ border: '1px solid var(--fd-hairline)', borderRadius: 0, overflow: 'hidden' }}>
        <table style={tableStyle}>
          <colgroup>
            <col style={{ width: 200 }} />
            <col />
          </colgroup>
          <tbody>

            {/* ── Your Info ── */}
            <SectionRow label="Your Info" />

            <Row label="Full name">
              <input value={name} onChange={e => setName(e.target.value)} style={CELL_INPUT} />
            </Row>
            <Row label="Date of birth">
              <input type="date" value={dob} onChange={e => setDob(e.target.value)} style={CELL_INPUT} />
            </Row>
            <Row label="Filing status">
              <select value={filing} onChange={e => setFiling(e.target.value)} style={SELECT}>
                <option value="MFJ">Married Filing Jointly</option>
                <option value="Single">Single</option>
                <option value="MFS">Married Filing Separately</option>
                <option value="HOH">Head of Household</option>
              </select>
            </Row>
            <Row label="SS collection age">
              <input type="number" value={ssAge} onChange={e => setSsAge(Number(e.target.value))}
                min={62} max={70} style={{ ...CELL_INPUT, width: 60 }} />
            </Row>
            <Row label="Retirement year">
              <input type="number" value={retirementYear} onChange={e => setRetirementYear(Number(e.target.value))}
                min={1950} max={2100} style={{ ...CELL_INPUT, width: 70 }} />
            </Row>
            <Row label="Estimated spending / yr">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: M, fontSize: 12 }}>$</span>
                <input type="number" value={spending} onChange={e => setSpending(Number(e.target.value))}
                  step={1000} style={{ ...CELL_INPUT, width: 120 }} />
              </div>
            </Row>
            <Row label="Target volatility">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <input type="number" value={targetVol} onChange={e => setTargetVol(Number(e.target.value))}
                  step={0.5} min={1} max={50} style={{ ...CELL_INPUT, width: 60 }} />
                <span style={{ color: M, fontSize: 12 }}>%  annualised</span>
                <span style={{ fontSize: 12, color: 'var(--amber)', marginLeft: 4 }}>post-rebalance target — current portfolio intentionally exceeds this</span>
              </div>
            </Row>
            <Row label="Medicare">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12 }}>
                  <input type="checkbox" checked={medicare} onChange={e => setMedicare(e.target.checked)} />
                  Collecting
                </label>
                {medicare && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <span style={{ color: M }}>People:</span>
                    <input type="number" value={medPeople} onChange={e => setMedPeople(Number(e.target.value))}
                      min={1} max={2} style={{ ...CELL_INPUT, width: 40 }} />
                  </div>
                )}
              </div>
            </Row>

            <Row label="Rollover IRA dividends">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12 }}>
                  <input type="checkbox" checked={rolloverDrip} onChange={e => setRolloverDrip(e.target.checked)} />
                  Reinvested (DRIP)
                </label>
                <span style={{ color: M, fontSize: 12 }}>
                  {rolloverDrip
                    ? 'Not counted as spendable income — coverage, income gap and forecasts leave it out'
                    : 'Counted as spendable income alongside Taxable and Roth'}
                </span>
              </div>
            </Row>

            {/* ── Spouse ── */}
            <SectionRow label="Spouse / Partner" />

            <Row label="Name">
              <input value={spouseName} onChange={e => setSpouseName(e.target.value)}
                placeholder="leave blank if single" style={CELL_INPUT} />
            </Row>
            {spouseName && <>
              <Row label="Date of birth">
                <input type="date" value={spouseDob} onChange={e => setSpouseDob(e.target.value)} style={CELL_INPUT} />
              </Row>
              <Row label="SS collection age">
                <input type="number" value={spouseSsAge} onChange={e => setSpouseSsAge(Number(e.target.value))}
                  min={62} max={70} style={{ ...CELL_INPUT, width: 60 }} />
              </Row>
            </>}

            {/* ── Tax Bracket Settings ── (before SS — bracket target is a key personal tax parameter) */}
            <SectionRow label="Tax Bracket Settings" />

            <Row label="Target bracket rate">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <select value={targetBracket} onChange={e => setTargetBracket(Number(e.target.value))} style={SELECT}>
                  {activeBkts.length > 0
                    ? activeBkts.map((b, i) => {
                        const ratePct = Math.round(b.rate * 100)
                        const rangeStr = b.max != null
                          ? `$${(b.min / 1000).toFixed(0)}K–$${(b.max / 1000).toFixed(0)}K`
                          : `$${(b.min / 1000).toFixed(0)}K+`
                        return (
                          <option key={i} value={ratePct}>
                            {ratePct}% — {rangeStr} ({filing === 'MFJ' ? 'MFJ' : 'Single'})
                            {ratePct === 24 ? ' ← Recommended' : ''}
                          </option>
                        )
                      })
                    : [10,12,22,24,32,35,37].map(r => (
                        <option key={r} value={r}>{r}%{r === 24 ? ' — Recommended' : ''}</option>
                      ))
                  }
                </select>
                <span style={{ fontSize: 12, color: M }}>
                  Stay within this bracket — controls Roth conversion ceiling, bracket pressure, and conversion room.
                  Ranges update automatically based on your filing status above.
                </span>
              </div>
            </Row>

            {conversionRec && (
              <tr style={{ borderTop: '1px solid var(--border2)' }}>
                <td colSpan={2} style={{ padding: '8px 10px' }}>
                  <div style={{ border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 12px', background: 'var(--fd-card)' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>
                      Auto Calculation — Reference Only
                    </div>
                    <div style={{ fontSize: 12, color: M, marginBottom: 6 }}>
                      Recommended Roth conversion amount to fill the {targetBracket}% bracket above, for comparison against the manual "Annual conversion" figure below.
                    </div>
                    {liveBracketCeiling == null ? (
                      <div style={{ fontSize: 12, color: 'var(--amber)', padding: '4px 0' }}>
                        No ceiling for the {targetBracket}% bracket (top bracket has no upper limit) — recommendation unavailable.
                      </div>
                    ) : (
                      <>
                        {([
                          [`${targetBracket}% bracket ceiling (incl. ${fmtMoneyFull(liveStdDeduction)} std deduction)`, liveBracketCeiling],
                          ['− Est. dividends (fwd-12m)',  -conversionRec.dividends],
                          ['− W2 annualized',             -conversionRec.w2_annualized],
                          ['− SS taxable (if any)',       -liveSsTaxable],
                          ['− Safety buffer',             -liveSafetyBuffer],
                        ] as [string, number][]).map(([lbl, v]) => (
                          <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: M, padding: '2px 0' }}>
                            <span>{lbl}</span>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(v)}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 500, color: 'var(--text)', padding: '5px 0', borderTop: '1px solid var(--border2)', marginTop: 4 }}>
                          <span>= Recommended</span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoneyFull(liveRecommended)}</span>
                        </div>
                        <button type="button" onClick={() => liveRecommended != null && setAnnualConv(liveRecommended)} style={{
                          marginTop: 8, fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 0,
                          background: 'transparent', border: '1px solid var(--amber)', color: 'var(--amber)', cursor: 'pointer',
                        }}>
                          Apply recommended → fills "Annual conversion" below (still requires Save)
                        </button>
                      </>
                    )}
                    {conversionRec.w2_annualized === 0 && (
                      <div style={{ fontSize: 12, color: M, marginTop: 6, fontStyle: 'italic' }}>
                        W2 income isn't tracked yet — treated as $0 above. If you have W2 wages this year,
                        the recommendation is overstated by that amount.
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            )}

            <Row label="Safety buffer">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: M, fontSize: 12 }}>$</span>
                  <input type="number" value={safetyBuf} onChange={e => setSafetyBuf(Number(e.target.value))}
                    step={100} min={0} max={50000} style={{ ...CELL_INPUT, width: 100 }} />
                </div>
                <span style={{ fontSize: 12, color: M }}>
                  Deducted from bracket room → safe conversion amount.
                  $7,200 = $600/month buffer for year-end dividend surprises and capital gain distributions.
                </span>
              </div>
            </Row>

            <Row label="Prior year Total Tax">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: M, fontSize: 12 }}>$</span>
                  <input type="number" value={priorYearTax} onChange={e => setPriorYearTax(Number(e.target.value))}
                    step={100} min={0} style={{ ...CELL_INPUT, width: 120 }} />
                </div>
                <span style={{ fontSize: 12, color: M }}>
                  Total federal tax from last year's return. Enables the IRS 110% safe harbor test on the Tax tab
                  — shows whether estimated payments are on track to avoid underpayment penalties.
                  {priorYearTax === 0 && <span style={{ color: 'var(--amber)', marginLeft: 4 }}> Not set — Safe Harbor panel shows "NEEDS CONFIG"</span>}
                </span>
              </div>
            </Row>

            <Row label="W2 Withholding YTD">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: M, fontSize: 12 }}>$</span>
                  <input type="number" value={w2Withholding} onChange={e => setW2Withholding(Number(e.target.value))}
                    step={100} min={0} style={{ ...CELL_INPUT, width: 120 }} />
                </div>
                <span style={{ fontSize: 12, color: M }}>
                  Federal income tax withheld from W2 wages year-to-date. Counts toward the safe harbor test
                  alongside estimated quarterly payments. Set to 0 in pure dividend years.
                </span>
              </div>
            </Row>

            {/* ── SS Scenarios ── */}
            <SectionRow label="Social Security Scenarios" />

          </tbody>
        </table>

        {/* SS scenarios — own sub-table with 5 columns */}
        <table style={{ ...tableStyle, borderTop: '1px solid var(--border2)' }}>
          <thead>
            <tr style={{ background: BG }}>
              {['Key','Label','Start','Monthly','Annual'].map(h => (
                <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontSize: 12,
                  color: M, fontWeight: 500, borderBottom: '1px solid var(--border2)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ssRows.map((opt, i) => (
              <tr key={opt.key} style={{ borderTop: '1px solid var(--border2)' }}>
                <td style={{ padding: '4px 8px', width: 80 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: A }}>{opt.key}</span>
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input value={opt.label} onChange={e => updSS(i, 'label', e.target.value)}
                    style={CELL_INPUT} />
                </td>
                <td style={{ padding: '4px 8px', width: 100 }}>
                  <input value={opt.date} onChange={e => updSS(i, 'date', e.target.value)}
                    placeholder="YYYY-MM" style={CELL_INPUT} />
                </td>
                <td style={{ padding: '4px 8px', width: 100 }}>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <span style={{ color: M, fontSize: 12 }}>$</span>
                    <input type="number" value={opt.monthly} onChange={e => updSS(i, 'monthly', Number(e.target.value))}
                      style={{ ...CELL_INPUT, width: 80 }} />
                  </div>
                </td>
                <td style={{ padding: '4px 8px', width: 110 }}>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <span style={{ color: M, fontSize: 12 }}>$</span>
                    <input type="number" value={opt.annual} onChange={e => updSS(i, 'annual', Number(e.target.value))}
                      style={{ ...CELL_INPUT, width: 90 }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Back to main table */}
        <table style={{ ...tableStyle }}>
          <colgroup>
            <col style={{ width: 200 }} />
            <col />
          </colgroup>
          <tbody>

            {/* ── Income Target ── */}
            <SectionRow label="Lifestyle Income Target" />

            {([
              ['Monthly min', mMin, setMMin],
              ['Monthly max', mMax, setMMax],
              ['Annual min',  aMin, setAMin],
              ['Annual max',  aMax, setAMax],
            ] as [string, number, (n: number) => void][]).map(([lbl, val, set]) => (
              <Row key={lbl} label={lbl}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: M, fontSize: 12 }}>$</span>
                  <input type="number" value={val} onChange={e => set(Number(e.target.value))}
                    step={1000} style={{ ...CELL_INPUT, width: 120 }} />
                  <span style={{ color: M, fontSize: 12 }}>/ {lbl.startsWith('Monthly') ? 'mo' : 'yr'}</span>
                </div>
              </Row>
            ))}

          </tbody>
        </table>

        {/* Roth conversion + External */}
        <table style={{ ...tableStyle }}>
          <colgroup>
            <col style={{ width: 200 }} />
            <col />
          </colgroup>
          <tbody>
            <SectionRow label="Roth Conversion Plan" />

            <Row label="Annual conversion">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: M, fontSize: 12 }}>$</span>
                <input type="number" value={annualConv} onChange={e => setAnnualConv(Number(e.target.value))}
                  step={5000} style={{ ...CELL_INPUT, width: 120 }} />
              </div>
            </Row>

            <Row label="Conversion month">
              <select value={convMonth} onChange={e => setConvMonth(Number(e.target.value))} style={SELECT}>
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m} ({i+1})</option>)}
              </select>
            </Row>
            <SectionRow label="External Accounts (non-Schwab)" />

            <Row label="401(k) Roth">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: M, fontSize: 12 }}>$</span>
                <input type="number" value={k401Roth} onChange={e => setK401Roth(Number(e.target.value))}
                  step={1000} style={{ ...CELL_INPUT, width: 120 }} />
              </div>
            </Row>
            <Row label="401(k) Traditional">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: M, fontSize: 12 }}>$</span>
                <input type="number" value={k401} onChange={e => setK401(Number(e.target.value))}
                  step={1000} style={{ ...CELL_INPUT, width: 120 }} />
              </div>
            </Row>


          </tbody>
        </table>
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </div>
  )
}
