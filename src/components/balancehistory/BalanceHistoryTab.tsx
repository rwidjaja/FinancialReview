/**
 * BalanceHistoryTab — dedicated tab for balance history analysis.
 * Migrated from SettingsTab.tsx BalanceHistoryViewer section.
 * Simple / Advanced mode toggle via SystemRibbon right slot.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AreaChart, Area, LineChart, Line,
  BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { InfoTooltip } from '../research/InfoTooltip'
import { useGlobalViewMode } from '../ui/ModeToggle'
import { PageHero, KpiStrip, Button, moneyUnit, fmtShortDate } from '../ui/primitives'
import type { DashboardData, BalanceSnapshot } from '../../types/dashboard'
import { fmtMoney, fmtMoneyFull, fmtK } from '../../utils/formatters'
import { directionInfo, dayScore, dayScoreColor } from '../../utils/sessionMetrics'
import { PlainBalanceSummary } from './PlainBalanceSummary'
import {
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_LABEL_RECHARTS,
  TOOLTIP_ITEM_RECHARTS,
  TOOLTIP_CURSOR,
} from '../ui/chartTooltip'

// Silence unused-import warning for fmtK (used in axis formatters via closure)
void fmtK

// ── Palette ───────────────────────────────────────────────────────────────────
const G  = 'var(--green)'
const R  = 'var(--red)'
const A  = 'var(--amber)'
const M  = 'var(--text2)'
const BL = 'var(--blue)'
const Y  = 'var(--yellow)'

// Suppress unused warning — Y/BL are available for use
void Y; void BL; void A

// ── Helpers ───────────────────────────────────────────────────────────────────
const DAY_ABBR   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ET session phase for a manual snapshot based on its recorded_at UTC timestamp
function manualPhase(recordedAt: string): 'pre-market' | 'intraday' | 'after-close' {
  const utcMs  = new Date(recordedAt).getTime()
  // ET = UTC-4 (EDT) or UTC-5 (EST). Use -4 as approximation (Apr–Oct)
  const etHour = new Date(utcMs - 4 * 3600_000).getUTCHours()
  const etMin  = new Date(utcMs - 4 * 3600_000).getUTCMinutes()
  const etMins = etHour * 60 + etMin
  if (etMins < 9 * 60 + 30) return 'pre-market'
  if (etMins < 16 * 60)     return 'intraday'
  return 'after-close'
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Session {
  date:   string
  open?:  number
  close?: number
  delta?: number
  pct?:   number
}

// Suppress Session — used below in 5-session bar chart
void (undefined as unknown as Session)

type DayRow = {
  date:    string
  dayName: string
  open?:   number
  close?:  number
  closeLabel?:      'close' | 'manual'
  closeRecordedAt?: string
  intradayDelta:   number | null
  dovDelta:        number | null
  dovPct:          number | null
  // Gap analysis (computed)
  gapDelta:  number | null
  gapPct:    number | null
  gapFilled: boolean | null
  // High/Low (reserved for future backfill schema support)
  high?: number
  low?:  number
}

type MonthRow = {
  ym:      string
  label:   string
  open?:   number
  close?:  number
  openIsReal:  boolean
  gain:        number | null
  momDelta:    number | null
  momPct:      number | null
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props { data: DashboardData }

// ── Main ──────────────────────────────────────────────────────────────────────
export function BalanceHistoryTab({ data }: Props) {
  const [mode] = useGlobalViewMode()
  const [showSummary, setShowSummary] = useState(false)

  const [rows, setRows]           = useState<BalanceSnapshot[]>([])
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback((start?: string, end?: string) => {
    setLoading(true); setErr('')
    const params = start && end ? `start=${start}&end=${end}` : 'days=365'
    fetch(`/api/balance-history?${params}`)
      .then(r => r.json())
      .then((d: unknown) => {
        if (Array.isArray(d)) setRows(d as BalanceSnapshot[])
        else setErr((d as Record<string, string>)?.error ?? 'Unexpected server response')
        setLoading(false)
      })
      .catch((e: unknown) => { setErr(String(e)); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (startDate && endDate && startDate <= endDate) load(startDate, endDate)
      else if (!startDate && !endDate) load()
    }, 400)
  }, [startDate, endDate, load])

  // ── Derived: daily rows (oldest → newest) ──────────────────────────────────
  // Belt-and-suspenders: the market is never open on a weekend, so a snapshot
  // dated Sat/Sun is always bad data (server-side writers now guard against
  // this too — see db_manager.balance_snapshot_record — but this filter also
  // protects against any stray legacy row already sitting in the DB).
  const sorted = [...rows]
    .filter(r => { const dow = new Date(r.date + 'T12:00:00').getDay(); return dow !== 0 && dow !== 6 })
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))

  const byDate: Record<string, DayRow> = {}
  for (const r of sorted) {
    if (!byDate[r.date]) byDate[r.date] = {
      date: r.date,
      dayName: DAY_ABBR[new Date(r.date + 'T12:00:00').getDay()],
      intradayDelta: null, dovDelta: null, dovPct: null,
      gapDelta: null, gapPct: null, gapFilled: null,
    }
    if (r.label === 'open') {
      byDate[r.date].open = r.total_value
    } else {
      if (!byDate[r.date].closeLabel || byDate[r.date].closeLabel !== 'close') {
        byDate[r.date].close           = r.total_value
        byDate[r.date].closeLabel      = r.label as 'close' | 'manual'
        byDate[r.date].closeRecordedAt = r.recorded_at
        // Populate H/L from backfill data when available
        if (r.session_high != null) byDate[r.date].high = r.session_high
        if (r.session_low  != null) byDate[r.date].low  = r.session_low
      }
    }
  }

  // ── Inject live value as provisional close for today if no close yet ────────
  // Lets Intraday Δ, DoD, Gap all compute intraday before the 16:10 capture fires.
  const todayStr   = new Date().toISOString().slice(0, 10)
  const liveTotal  = data.summary?.total_value
  if (liveTotal && byDate[todayStr] && byDate[todayStr].open != null && byDate[todayStr].close == null) {
    byDate[todayStr].close      = liveTotal
    byDate[todayStr].closeLabel = 'manual'   // styled as provisional (amber)
  }

  const days = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))

  for (let i = 0; i < days.length; i++) {
    const d = days[i]
    if (d.open != null && d.close != null) d.intradayDelta = d.close - d.open
    const prevClose = days.slice(0, i).reverse().find(p => p.close != null)?.close

    if (d.close != null && prevClose != null) {
      d.dovDelta = d.close - prevClose
      d.dovPct   = prevClose > 0 ? (d.dovDelta / prevClose) * 100 : null
    }

    // Gap analysis
    if (d.open != null && prevClose != null) {
      d.gapDelta = d.open - prevClose
      d.gapPct   = prevClose > 0 ? (d.gapDelta / prevClose) * 100 : null
      // Gap filled: close crossed prevDay.close
      if (d.close != null && d.gapDelta != null) {
        if (d.gapDelta > 0) {
          d.gapFilled = d.close <= prevClose
        } else if (d.gapDelta < 0) {
          d.gapFilled = d.close >= prevClose
        } else {
          d.gapFilled = null
        }
      }
    }
  }

  // ── Derived: monthly rows ─────────────────────────────────────────────────
  const byMonth: Record<string, MonthRow> = {}
  for (const r of sorted) {
    const ym = r.date.slice(0, 7)
    if (!byMonth[ym]) {
      const [y, m] = ym.split('-')
      byMonth[ym] = { ym, label: `${MONTH_ABBR[+m - 1]} ${y.slice(2)}`, openIsReal: false, gain: null, momDelta: null, momPct: null }
    }
    if (r.label === 'open') {
      byMonth[ym].open = r.total_value
      byMonth[ym].openIsReal = true
    } else if (byMonth[ym].open == null) {
      byMonth[ym].open = r.total_value
      byMonth[ym].openIsReal = false
    }
    if (r.label === 'close' || r.label === 'manual') {
      byMonth[ym].close = r.total_value
    }
  }

  const months = Object.values(byMonth).sort((a, b) => a.ym.localeCompare(b.ym))
  for (let i = 0; i < months.length; i++) {
    const mo = months[i]
    if (mo.open != null && mo.close != null) mo.gain = mo.close - mo.open
    const prevClose = months.slice(0, i).reverse().find(p => p.close != null)?.close
    if (mo.close != null && prevClose != null) {
      mo.momDelta = mo.close - prevClose
      mo.momPct   = prevClose > 0 ? (mo.momDelta / prevClose) * 100 : null
    }
  }

  // ── Display windows ────────────────────────────────────────────────────────
  const isCustomRange = !!(startDate && endDate)
  const displayDays   = isCustomRange ? days   : days.slice(-30)
  const displayMonths = isCustomRange ? months : months.slice(-12)

  // Only show High/Low columns when at least one day has H/L data captured
  const hasHighLowData = displayDays.some(d => (d as any).high != null || (d as any).low != null)

  // ── Period stats ───────────────────────────────────────────────────────────
  const closeDays   = displayDays.filter(d => d.close != null)
  const firstClose  = closeDays[0]?.close   ?? 0
  const lastClose   = closeDays[closeDays.length - 1]?.close ?? 0
  const periodDelta = firstClose && lastClose ? lastClose - firstClose : null
  const periodPct   = firstClose > 0 && periodDelta != null ? (periodDelta / firstClose) * 100 : null

  const bestMonth  = displayMonths.reduce<MonthRow | null>(
    (b, m) => !b || (m.momDelta ?? -Infinity) > (b.momDelta ?? -Infinity) ? m : b, null)
  const worstMonth = displayMonths.reduce<MonthRow | null>(
    (w, m) => !w || (m.momDelta ?? Infinity)  < (w.momDelta ?? Infinity)  ? m : w, null)

  // ── All-time stats ─────────────────────────────────────────────────────────
  const allCloses = sorted
    .filter(r => r.label === 'close' || r.label === 'manual')
    .sort((a, b) => a.date.localeCompare(b.date))
  const allTimeFirst = allCloses[0]
  const allTimeLast  = allCloses[allCloses.length - 1]

  const hwm        = allCloses.length ? Math.max(...allCloses.map(r => r.total_value)) : 0
  const hwmSnap    = allCloses.find(r => r.total_value === hwm)
  const currentVal = allTimeLast?.total_value ?? 0
  const drawdownPct = hwm > 0 && currentVal < hwm ? ((currentVal - hwm) / hwm) * 100 : 0
  const daysSinceHwm = hwmSnap
    ? Math.floor((Date.now() - new Date(hwmSnap.date + 'T12:00:00').getTime()) / 86400000)
    : 0
  const atHwm = Math.abs(currentVal - hwm) < 1

  const yearsElapsed = allTimeFirst && allTimeLast
    ? (new Date(allTimeLast.date).getTime() - new Date(allTimeFirst.date).getTime()) / (365.25 * 86400000)
    : 0

  const twelveMonthsAgoStr = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const cagrBaseSnap = allCloses.filter(r => r.date <= twelveMonthsAgoStr).at(-1)
  const cagr = cagrBaseSnap && allTimeLast
    ? ((allTimeLast.total_value / cagrBaseSnap.total_value) - 1) * 100
    : null

  const velocityDays     = displayDays.filter(d => d.dovDelta != null)
  const avgDailyChange   = velocityDays.length > 0
    ? velocityDays.reduce((s, d) => s + (d.dovDelta ?? 0), 0) / velocityDays.length
    : null
  const avgWeeklyChange  = avgDailyChange != null ? avgDailyChange * 5 : null

  // Balance Milestones
  const MILESTONE_STEP = 500_000
  const milestones: { level: number; date: string }[] = []
  const hwmLevel = Math.floor(hwm / MILESTONE_STEP) * MILESTONE_STEP
  for (let lvl = MILESTONE_STEP; lvl <= hwmLevel; lvl += MILESTONE_STEP) {
    const hit = allCloses.find(r => r.total_value >= lvl)
    if (hit) milestones.push({ level: lvl, date: hit.date })
  }
  const nextMilestone = hwmLevel + MILESTONE_STEP
  const distToNext    = currentVal > 0 ? nextMilestone - currentVal : null

  // Monthly HWM tracking
  let runningHwm = 0
  const monthsWithHwm = displayMonths.map(mo => {
    const isNew = (mo.close ?? 0) > runningHwm
    if (isNew && (mo.close ?? 0) > 0) runningHwm = mo.close!
    return { ...mo, newHigh: isNew && (mo.close ?? 0) > 0 }
  })

  // Trend Projection
  const trendPts = displayDays.filter(d => d.close != null)
  const trendSlope = (() => {
    const n = trendPts.length
    if (n < 3) return null
    const sumX  = trendPts.reduce((s, _, i) => s + i, 0)
    const sumY  = trendPts.reduce((s, d) => s + (d.close ?? 0), 0)
    const sumXY = trendPts.reduce((s, d, i) => s + i * (d.close ?? 0), 0)
    const sumX2 = trendPts.reduce((s, _, i) => s + i * i, 0)
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  })()
  const trendMonthly = trendSlope != null ? trendSlope * 21 : null
  // trendSlope is $/trading-day (fit over consecutive trading-day indices —
  // weekends/holidays aren't in trendPts at all). Projecting "30 days" /
  // "90 days" ahead means 30/90 CALENDAR days, which is fewer trading-day
  // steps than that (markets are open ~252 of 365 days/year) — multiplying
  // the calendar-day count directly by trendSlope silently overstated the
  // move by ~45% (30 trading-day steps is actually ~42 calendar days).
  const TRADING_DAYS_PER_CALENDAR_DAY = 252 / 365
  const proj30d = currentVal && trendSlope != null ? currentVal + trendSlope * 30 * TRADING_DAYS_PER_CALENDAR_DAY : null
  const proj90d = currentVal && trendSlope != null ? currentVal + trendSlope * 90 * TRADING_DAYS_PER_CALENDAR_DAY : null

  // Account distribution
  const latestWithAccts = [...allCloses].reverse().find(r => Object.keys(r.accounts ?? {}).length > 0)
  const latestTotal     = latestWithAccts?.total_value ?? currentVal

  const acctKeys: string[] = [...new Set(
    sorted.flatMap(r => Object.keys(r.accounts ?? {}))
  )].sort()

  const acctLabel = (k: string) => {
    const l = k.toLowerCase()
    if (l.includes('taxable') || l.includes('brokerage') || l.includes('individual')) return 'Taxable'
    if (l.includes('rollover') || l.includes('trad')) return 'Rollover IRA'
    if (l.includes('roth')) return 'Roth IRA'
    return k
  }
  const ACCT_COLORS: Record<string, string> = {}
  const PALETTE = ['var(--fd-accent)', 'var(--fd-lilac-ink)', 'var(--fd-lime-ink)', 'var(--fd-muted)', 'var(--fd-ink)']
  acctKeys.forEach((k, i) => { ACCT_COLORS[k] = PALETTE[i % PALETTE.length] })

  const monthsWithAccts = displayMonths.map(mo => {
    const closeSnap = sorted.filter(r => r.date.startsWith(mo.ym) && (r.label === 'close' || r.label === 'manual')).at(-1)
    const acctVals: Record<string, number> = {}
    if (closeSnap?.accounts) {
      for (const k of acctKeys) acctVals[k] = closeSnap.accounts[k] ?? 0
    }
    return { ...mo, ...acctVals }
  })

  const daysWithAccts = displayDays.map(d => {
    const closeSnap = sorted.find(r => r.date === d.date && (r.label === 'close' || r.label === 'manual'))
                   ?? sorted.find(r => r.date === d.date && r.label === 'open')
    const acctVals: Record<string, number> = {}
    if (closeSnap?.accounts) {
      for (const k of acctKeys) acctVals[k] = closeSnap.accounts[k] ?? 0
    }
    return { ...d, date: d.date.slice(5), ...acctVals }
  })

  // Normalized growth index
  const baseValues: Record<string, number> = {}
  const baseLabels: Record<string, string> = {}
  for (const mo of monthsWithAccts) {
    if ((mo.close ?? 0) > 0 && !('_total' in baseValues)) { baseValues['_total'] = mo.close!; baseLabels['_total'] = mo.label }
    for (const k of acctKeys) {
      const v = (mo as Record<string, unknown>)[k] as number | undefined
      if (v && v > 0 && !(k in baseValues)) { baseValues[k] = v; baseLabels[k] = mo.label }
    }
  }
  // Carries the raw $ value alongside each indexed point (as `${key}_usd`) so
  // tooltips can show real dollars next to the index — a bare "100.00" reads
  // like a dollar figure otherwise, easy to confuse with the account's actual
  // ~$1M balance.
  const normalizedMonths = monthsWithAccts.map(mo => {
    const row: Record<string, number | string | null> = { label: mo.label }
    row['_total'] = baseValues['_total'] && mo.close
      ? +((mo.close / baseValues['_total']) * 100).toFixed(2) : null
    row['_total_usd'] = mo.close ?? null
    for (const k of acctKeys) {
      const v = (mo as Record<string, unknown>)[k] as number | undefined
      row[k] = baseValues[k] && v ? +((v / baseValues[k]) * 100).toFixed(2) : null
      row[`${k}_usd`] = v ?? null
    }
    return row
  })

  // Monthly account attribution
  type AttrRow = Record<string, number | string>
  const monthlyAttribution: AttrRow[] = []
  for (let i = 1; i < monthsWithAccts.length; i++) {
    const cur  = monthsWithAccts[i]
    const prev = monthsWithAccts[i - 1]
    const row: AttrRow = { label: cur.label }
    let total = 0
    for (const k of acctKeys) {
      const curV  = ((cur  as Record<string, unknown>)[k] as number) ?? 0
      const prevV = ((prev as Record<string, unknown>)[k] as number) ?? 0
      const delta = (curV && prevV) ? +(curV - prevV).toFixed(2) : 0
      row[k] = delta
      total += delta
    }
    row['_total'] = +total.toFixed(2)
    monthlyAttribution.push(row)
  }

  // ── 5-session open→close bar chart data ────────────────────────────────────
  const last5Sessions: Session[] = days
    .filter(d => d.open != null && d.close != null)
    .slice(-5)
    .map(d => ({
      date:  d.date.slice(5),
      open:  d.open,
      close: d.close,
      delta: d.intradayDelta ?? undefined,
      pct:   d.intradayDelta != null && d.open != null && d.open > 0
        ? (d.intradayDelta / d.open) * 100 : undefined,
    }))

  // ── Pressure Classification ────────────────────────────────────────────────
  function pressureClass(d: DayRow, prevDayClose?: number): string {
    const { open, close, gapDelta } = d
    if (open == null || close == null) return '—'
    const isUp   = close > open
    const isDown = close < open
    if (prevDayClose == null) return isUp ? 'Weak Buy' : isDown ? 'Weak Sell' : '—'
    const gapUp   = gapDelta != null && gapDelta > 0
    const gapDown = gapDelta != null && gapDelta < 0
    const strongMoveUp   = (close - prevDayClose) / prevDayClose * 100 > 0.5
    const strongMoveDown = (close - prevDayClose) / prevDayClose * 100 < -0.5
    // Reversal Up: opened below prev close, closed above
    if (open < prevDayClose && close > prevDayClose) return 'Reversal Up'
    // Reversal Down: opened above prev close, closed below
    if (open > prevDayClose && close < prevDayClose) return 'Reversal Down'
    if (isUp  && (gapUp  || strongMoveUp))   return 'Strong Buy'
    if (isUp  && gapDown)                    return 'Weak Buy'
    if (isDown && (gapDown || strongMoveDown)) return 'Strong Sell'
    if (isDown && gapUp)                     return 'Weak Sell'
    return '—'
  }

  const pressureColor: Record<string, string> = {
    'Strong Buy':    G,
    'Weak Buy':      G,
    'Strong Sell':   R,
    'Weak Sell':     R,
    'Reversal Up':   A,
    'Reversal Down': 'var(--yellow)',
    '—':             M,
  }

  // Mechanical definitions — deterministic, no LLM needed
  const PRESSURE_DEFS: Record<string, { rule: string; meaning: string; cycle: string }> = {
    'Strong Buy': {
      rule:    'Close > Open · strong intraday move · gap not contradicted',
      meaning: 'Buyers controlled the entire session with conviction.',
      cycle:   'Leg-1 ignition or Leg-2 continuation. Clean upward pressure.',
    },
    'Weak Buy': {
      rule:    'Close > Open · small intraday move · often after gap down',
      meaning: 'Buyers won the day but without force — bought the dip.',
      cycle:   'Early Leg-1 accumulation or late Leg-3 recovery.',
    },
    'Strong Sell': {
      rule:    'Close < Open · strong negative intraday · sellers held all day',
      meaning: 'Sellers distributed aggressively — no recovery attempt.',
      cycle:   'Leg-3 exhaustion or start of a pullback.',
    },
    'Weak Sell': {
      rule:    'Close < Open · small negative intraday · often after gap up',
      meaning: 'Sellers took control but without aggression — faded the gap.',
      cycle:   'Often noise, early reversal signal, or late Leg-2 drift.',
    },
    'Reversal Up': {
      rule:    'Gap down → gap filled → close above prior close',
      meaning: 'Buyers rejected the gap down and reclaimed yesterday\'s close.',
      cycle:   'Bullish reversal. Leg-1 ignition or Leg-2 continuation signal.',
    },
    'Reversal Down': {
      rule:    'Gap up → gap filled → close below prior close',
      meaning: 'Sellers rejected the gap up and reclaimed yesterday\'s close.',
      cycle:   'Bearish reversal. Leg-2 exhaustion or Leg-3 start signal.',
    },
  }

  // Pressure badge with hover tooltip — uses position:fixed to escape table overflow clipping
  function PressureBadge({ label, d, prevClose }: { label: string; d: DayRow; prevClose?: number }) {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
    const color = pressureColor[label] ?? M
    const def   = PRESSURE_DEFS[label]
    if (label === '—') return <span style={{ color: M, fontSize: 12 }}>—</span>

    const handleMouseMove = (e: React.MouseEvent) => {
      setPos({ x: e.clientX, y: e.clientY })
    }
    const handleMouseLeave = () => setPos(null)

    return (
      <div style={{ position: 'relative', display: 'inline-block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}>
        {/* Badge */}
        <span style={{
          fontSize: 12, fontWeight: 500, padding: '2px 6px',
          border: `1px solid ${color}`,
          color, background: `${color}12`,
          borderRadius: 0, cursor: 'default', whiteSpace: 'nowrap',
          letterSpacing: '0.4px',
        }}>
          {label}
        </span>
        {/* Tooltip — fixed position, renders above table overflow */}
        {pos && def && (
          <div style={{
            position: 'fixed',
            left: pos.x + 12,
            top:  pos.y - 8,
            transform: pos.x > window.innerWidth - 320 ? 'translateX(-100%)' : undefined,
            zIndex: 9999, minWidth: 260, maxWidth: 300,
            background: 'var(--bg2)',
            border: `1px solid ${color}`,
            borderTop: `2px solid ${color}`,
            borderRadius: 0,
            padding: '10px 12px',
            boxShadow: 'none',
            pointerEvents: 'none',
          }}>
            {/* Label */}
            <div style={{ fontSize: 12, fontWeight: 500, color, marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
              {label}
            </div>
            {/* Rule */}
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 500, color: M }}>Rule: </span>{def.rule}
            </div>
            {/* Meaning */}
            <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 6, lineHeight: 1.5 }}>
              {def.meaning}
            </div>
            {/* Cycle context */}
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 500, color: M }}>Cycle: </span>{def.cycle}
            </div>
            {/* This day's contributing data */}
            <div style={{ borderTop: '1px solid var(--fd-hairline)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                This session
              </div>
              {d.open != null && d.close != null && (
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  Open → Close:&nbsp;
                  <span style={{ color: d.intradayDelta != null && d.intradayDelta >= 0 ? G : R }}>
                    {d.intradayDelta != null ? `${d.intradayDelta >= 0 ? '+' : ''}${fmtMoneyFull(d.intradayDelta)}` : '—'}
                  </span>
                </div>
              )}
              {d.gapDelta != null && prevClose != null && (
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  Gap from prev close:&nbsp;
                  <span style={{ color: d.gapDelta >= 0 ? G : R }}>
                    {d.gapDelta >= 0 ? '+' : ''}{fmtMoneyFull(d.gapDelta)}
                  </span>
                  {d.gapFilled != null && (
                    <span style={{ color: M, marginLeft: 6 }}>
                      · {d.gapFilled ? '✓ filled' : '✗ not filled'}
                    </span>
                  )}
                </div>
              )}
              {d.dovDelta != null && (
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  DoD change:&nbsp;
                  <span style={{ color: d.dovDelta >= 0 ? G : R }}>
                    {d.dovDelta >= 0 ? '+' : ''}{fmtMoneyFull(d.dovDelta)}
                    {d.dovPct != null && ` (${d.dovPct >= 0 ? '+' : ''}${d.dovPct.toFixed(2)}%)`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Action handlers ────────────────────────────────────────────────────────
  const [capturing,    setCapturing]    = useState(false)
  const [captureMsg,   setCaptureMsg]   = useState('')
  const [backfilling,  setBackfilling]  = useState(false)
  const [backfillMsg,  setBackfillMsg]  = useState('')
  const [backfillDays, setBackfillDays] = useState(365)

  const captureNow = () => {
    setCapturing(true); setCaptureMsg('')
    fetch('/api/balance-history/capture', { method: 'POST' })
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        if (d.status === 'ok') {
          setCaptureMsg(`Captured ${String(d.label)} snapshot for ${String(d.date)} — $${Number(d.total_value).toLocaleString()}`)
          load()
        } else {
          setCaptureMsg(`Error: ${String(d.error)}`)
        }
      })
      .catch((e: unknown) => setCaptureMsg(`Error: ${String(e)}`))
      .finally(() => setCapturing(false))
  }

  const runBackfill = () => {
    setBackfilling(true); setBackfillMsg('')
    fetch('/api/balance-history/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: backfillDays }),
    })
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        if (d.status === 'ok') {
          setBackfillMsg(
            `✓ ${d.inserted} new · ${d.updated_hl ?? 0} updated with High/Low · ${d.skipped} skipped · ${d.symbols} symbols`
          )
          load()
        } else {
          setBackfillMsg(`Error: ${String(d.error)}`)
        }
      })
      .catch((e: unknown) => setBackfillMsg(`Error: ${String(e)}`))
      .finally(() => setBackfilling(false))
  }

  // ── CSV export — one row per trading day, matching the table view ──────────
  const exportCSV = () => {
    const acctHeaders = acctKeys.map(k => acctLabel(k))
    const hlHeaders   = hasHighLowData ? ['High', 'Low', 'Range $', 'Range %', 'Close Pos %'] : []
    const header = [
      'Date', 'Day',
      ...acctHeaders,
      'Open', 'Close',
      ...hlHeaders,
      'Intraday Δ', 'DoD Δ', 'DoD %',
      'Gap $', 'Gap %', 'Gap Filled',
      'Pressure',
    ]

    const rows2 = [...displayDays].reverse().map(d => {
      const closeSnap = sorted.find(r => r.date === d.date && (r.label === 'close' || r.label === 'manual'))
      const acctVals  = acctKeys.map(k => closeSnap?.accounts?.[k]?.toFixed(2) ?? '')

      const high = d.high
      const low  = d.low
      const rangeAmt = high != null && low != null ? (high - low).toFixed(2) : ''
      const rangePct = high != null && low != null && d.open != null && d.open > 0
        ? (((high - low) / d.open) * 100).toFixed(2) + '%' : ''
      const closePct = high != null && low != null && d.close != null
        && (high - low) > 0
        ? (((d.close - low) / (high - low)) * 100).toFixed(1) + '%' : ''

      const prevD   = displayDays[displayDays.findIndex(x => x.date === d.date) - 1] ?? null
      const gapAmt  = d.open != null && prevD?.close != null ? (d.open - prevD.close).toFixed(2) : ''
      const gapPct  = d.open != null && prevD?.close != null && prevD.close > 0
        ? (((d.open - prevD.close) / prevD.close) * 100).toFixed(2) + '%' : ''
      const gapFill = d.open != null && prevD?.close != null && d.close != null
        ? (d.open > prevD.close ? d.close >= prevD.close : d.close <= prevD.close) ? 'Yes' : 'No'
        : ''

      const pressure = (() => {
        if (d.close == null || d.open == null) return ''
        const intra = d.close - d.open
        const gap   = prevD?.close != null ? d.open - prevD.close : 0
        if (intra > 0 && gap >= 0) return 'Strong Buy'
        if (intra > 0 && gap < 0)  return 'Weak Buy'
        if (intra < 0 && gap <= 0) return 'Strong Sell'
        if (intra < 0 && gap > 0)  return 'Weak Sell'
        return 'Flat'
      })()

      const hlVals = hasHighLowData ? [
        high?.toFixed(2) ?? '', low?.toFixed(2) ?? '', rangeAmt, rangePct, closePct
      ] : []

      return [
        d.date, d.dayName,
        ...acctVals,
        d.open?.toFixed(2) ?? '',
        d.close?.toFixed(2) ?? '',
        ...hlVals,
        d.intradayDelta?.toFixed(2) ?? '',
        d.dovDelta?.toFixed(2)      ?? '',
        d.dovPct?.toFixed(4)        ?? '',
        gapAmt, gapPct, gapFill,
        pressure,
      ]
    })

    const csv  = [header, ...rows2].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'balance_history.csv' })
    a.click(); URL.revokeObjectURL(url)
  }

  // ── Shared styles ─────────────────────────────────────────────────────────
  // v4: sections sit under a 2px ink rule; tiles are hairline-framed page cells
  const cardStyle: React.CSSProperties = {
    borderTop: '2px solid var(--fd-rule)',
    paddingTop: 16,
  }
  const tileStyle: React.CSSProperties = {
    background:   'var(--fd-page)',
    border: '1px solid var(--fd-hairline)',
    padding:      '16px 20px',
  }
  const yFmt     = (v: number) => `$${(v / 1_000_000).toFixed(3)}M`
  const yDomain  = ([min, max]: readonly [number, number]): [number, number] => {
    const pad = Math.max((max - min) * 0.4, max * 0.002)
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }
  const inputStyle: React.CSSProperties = {
    background:   'var(--fd-card)',
    border: '1px solid transparent',
    color:        'var(--fd-ink)',
    fontSize: 13,
    height: 36,
    padding:      '0 12px',
    fontFamily:   'var(--font-mono)',
  }
  const monthlyColor = periodDelta != null && periodDelta >= 0 ? G : R

  // ── Render ────────────────────────────────────────────────────────────────
  const ghost: React.CSSProperties = { height: 36, padding: '0 14px', border: '1px solid var(--fd-hairline)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.03em', textTransform: 'uppercase', cursor: 'pointer', color: 'var(--fd-ink)' }
  const hwmDateTxt = hwmSnap ? fmtShortDate(hwmSnap.date) : null

  return (
    <div style={{ paddingBottom: 64 }}>
      <PageHero
        eyebrow="Balance history · exact Schwab open and close"
        {...(rows.length === 0 ? { before: 'No ', em: 'history', after: ' yet.' }
          : atHwm ? { before: 'At a new ', em: 'high', after: '.' }
          : { before: `${Math.abs(drawdownPct).toFixed(1)}% below the `, em: 'high', after: '.' })}
        lead={<>
          {rows.length > 0 && <span>{atHwm ? `The balance is ${fmtMoneyFull(currentVal)}, a new all-time high.` : `The all-time high of ${fmtMoneyFull(hwm)} was set on ${hwmDateTxt}. ${daysSinceHwm} days later the balance is ${fmtMoneyFull(currentVal)}.`}</span>}
          <span style={{ color: 'var(--fd-muted)' }}>Captured automatically at 9:30 and 16:00 ET on trading days.</span>
        </>}
        aside={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button variant="primary" onClick={captureNow} disabled={capturing} style={{ height: 36 }}>{capturing ? 'Capturing…' : 'Capture now'}</Button>
              <select value={backfillDays} onChange={e => setBackfillDays(Number(e.target.value))} style={inputStyle} aria-label="Backfill window">
                {[30, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
              <button className="fd-ghost" style={ghost} onClick={runBackfill} disabled={backfilling}>{backfilling ? 'Fetching…' : 'Backfill'}</button>
              {rows.length > 0 && <button className="fd-ghost" style={ghost} onClick={exportCSV}>Export CSV</button>}
              {days.length > 0 && <button className="fd-ghost" style={ghost} onClick={() => setShowSummary(true)}>Summary</button>}
            </div>
            {captureMsg && <span style={{ fontSize: 13, color: captureMsg.startsWith('Error') ? 'var(--fd-negative)' : 'var(--fd-ink)' }}>{captureMsg}</span>}
            {backfillMsg && <span style={{ fontSize: 13, color: backfillMsg.startsWith('Error') ? 'var(--fd-negative)' : 'var(--fd-ink)' }}>{backfillMsg}</span>}
            <span style={{ fontSize: 13, color: 'var(--fd-muted)', maxWidth: 420, textAlign: 'right' }}>Backfill estimates past values from current share counts × historical closes — balances before large trades may be materially off.</span>
          </div>
        }
      />

      {rows.length > 0 && (
        <KpiStrip size={32} items={[
          { label: 'Current balance', value: moneyUnit(currentVal).value, unit: moneyUnit(currentVal).unit, sub: allTimeLast ? `as of ${fmtShortDate(allTimeLast.date)}` : undefined },
          { label: 'High-water mark', value: moneyUnit(hwm).value, unit: moneyUnit(hwm).unit, sub: hwmDateTxt ?? undefined },
          { label: 'Drawdown', value: atHwm ? '0.0' : drawdownPct.toFixed(1), unit: '%', status: atHwm ? 'ok' : drawdownPct < -5 ? 'alert' : 'watch', sub: atHwm ? 'At the high today' : `${daysSinceHwm} days since the high` },
          { label: cagr != null ? '12-month return' : 'Since first capture', value: cagr != null ? `${cagr >= 0 ? '+' : '−'}${Math.abs(cagr).toFixed(1)}` : (allTimeFirst && allTimeLast ? `${((allTimeLast.total_value - allTimeFirst.total_value) / allTimeFirst.total_value * 100).toFixed(1)}` : '—'), unit: '%', sub: 'Includes transfers' },
          { label: 'Velocity', value: avgDailyChange != null ? `${avgDailyChange >= 0 ? '+' : '−'}${fmtMoney(Math.abs(avgDailyChange))}` : '—', sub: avgWeeklyChange != null ? `per day · ${avgWeeklyChange >= 0 ? '+' : '−'}${fmtMoney(Math.abs(avgWeeklyChange))}/wk` : 'Average daily change' },
          { label: 'Best / worst month', value: bestMonth?.momDelta != null ? `${bestMonth.momDelta >= 0 ? '+' : '−'}${fmtMoney(Math.abs(bestMonth.momDelta))}` : '—', sub: worstMonth?.momDelta != null ? `${bestMonth?.label ?? ''} · worst ${worstMonth.label} ${worstMonth.momDelta >= 0 ? '+' : '−'}${fmtMoney(Math.abs(worstMonth.momDelta))}` : bestMonth?.label },
        ]} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 40, paddingTop: 40 }}>
          {/* ── Filter bar ─────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
            <span style={{ fontSize: 12, color: M }}>→</span>
            <input type="date" value={endDate}   onChange={e => setEndDate(e.target.value)}   style={inputStyle} />
            <button onClick={() => { setStartDate(''); setEndDate(''); load() }}
              style={{ ...inputStyle, cursor: 'pointer', padding: '4px 10px', fontSize: 12, color: M }}>
              Reset (12mo / 30d)
            </button>
            {rows.length > 0 && (<>
              <span style={{ fontSize: 12, color: M }}>
                {isCustomRange
                  ? `${displayDays.length} trading days · ${displayMonths.length} months (custom range)`
                  : `Daily closes last ${displayDays.length} sessions · monthly closes ${displayMonths.length} months`}
              </span>

            </>)}
          </div>

          {loading && <div style={{ color: M, fontSize: 12 }}>Loading…</div>}
          {err     && <div style={{ color: R,  fontSize: 12 }}>Error: {err}</div>}

          {/* Empty state */}
          {!loading && !err && rows.length === 0 && (
            <div style={{ border: '1px dashed var(--fd-hairline)', borderRadius: 0,
              padding: '36px 20px', textAlign: 'center',
              display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--fd-muted)', fontWeight: 500 }}>No snapshots yet</span>
              <span style={{ fontSize: 12, color: M, lineHeight: 1.6 }}>
                Captured automatically at <strong style={{ color: 'var(--text)' }}>9:30 ET</strong> (open) and{' '}
                <strong style={{ color: 'var(--text)' }}>16:00 ET</strong> (close) on trading days.
              </span>
            </div>
          )}

          {!loading && !err && days.length > 0 && (<>

            {showSummary && (() => {
              const isCustom = isCustomRange
              const periodLabel = isCustom
                ? `over your selected ${displayDays.length}-day range`
                : `over the last ${displayDays.length} trading days`
              const accounts = acctKeys
                .map(k => ({
                  label: acctLabel(k),
                  pct: latestTotal > 0 ? ((latestWithAccts?.accounts?.[k] ?? 0) / latestTotal) * 100 : 0,
                }))
                .filter(a => a.pct > 0)
                .sort((a, b) => b.pct - a.pct)
              return (
                <PlainBalanceSummary
                  onClose={() => setShowSummary(false)}
                  currentVal={currentVal}
                  hwm={hwm}
                  hwmDate={hwmSnap?.date ?? null}
                  atHwm={atHwm}
                  drawdownPct={drawdownPct}
                  daysSinceHwm={daysSinceHwm}
                  periodDelta={periodDelta}
                  periodPct={periodPct}
                  periodLabel={periodLabel}
                  cagr={cagr}
                  bestMonth={bestMonth}
                  worstMonth={worstMonth}
                  avgDailyChange={avgDailyChange}
                  nextMilestone={nextMilestone}
                  distToNext={distToNext}
                  proj30d={proj30d}
                  proj90d={proj90d}
                  accounts={accounts}
                />
              )
            })()}

            {/* ── 6 Summary tiles ────────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
              {/* Balance Change */}
              <div style={{ ...tileStyle }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>Balance Change</div>
                <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  color: periodDelta != null ? (periodDelta >= 0 ? G : R) : M }}>
                  {periodDelta != null ? `${periodDelta >= 0 ? '+' : ''}${fmtMoneyFull(periodDelta)}` : '—'}
                </div>
                {periodPct != null && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    {periodPct >= 0 ? '+' : ''}{periodPct.toFixed(2)}%
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, opacity: 0.7, lineHeight: 1.4 }}>
                  includes transfers · see Returns tab for price-based return
                </div>
              </div>

              {/* 12-Month Return / Since First Capture */}
              <div style={{ ...tileStyle }}>
                {cagr != null ? (<>
                  <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
                    12-Month Return
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)',
                    color: cagr >= 0 ? G : R }}>
                    {cagr >= 0 ? '+' : ''}{cagr.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{cagrBaseSnap!.date} → today</div>
                </>) : (<>
                  <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
                    Since First Capture
                  </div>
                  {(() => {
                    const totalPct = allTimeFirst && allTimeLast
                      ? ((allTimeLast.total_value - allTimeFirst.total_value) / allTimeFirst.total_value) * 100
                      : null
                    return (
                      <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)',
                        color: totalPct != null ? (totalPct >= 0 ? G : R) : M }}>
                        {totalPct != null ? `${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}%` : '—'}
                      </div>
                    )
                  })()}
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    {allTimeFirst && yearsElapsed > 0
                      ? `${Math.round(yearsElapsed * 12)}mo · base ${fmtMoneyFull(allTimeFirst.total_value)}`
                      : 'no history yet'}
                  </div>
                </>)}
              </div>

              {/* Wealth Velocity */}
              <div style={{ ...tileStyle }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>Wealth Velocity</div>
                <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  color: avgDailyChange != null ? (avgDailyChange >= 0 ? G : R) : M }}>
                  {avgDailyChange != null ? `${avgDailyChange >= 0 ? '+' : ''}${fmtMoneyFull(avgDailyChange)}/d` : '—'}
                </div>
                {avgWeeklyChange != null && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    {avgWeeklyChange >= 0 ? '+' : ''}{fmtMoneyFull(avgWeeklyChange)}/wk · avg {velocityDays.length}d · mark-to-market, not cash
                  </div>
                )}
              </div>

              {/* Best Month */}
              <div style={{ ...tileStyle }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>Best Month (MoM)</div>
                <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: G }}>
                  {bestMonth?.momDelta != null ? `+${fmtMoneyFull(bestMonth.momDelta)}` : '—'}
                </div>
                {bestMonth?.label && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{bestMonth.label} · prior close → this close</div>}
              </div>

              {/* Worst Month */}
              <div style={{ ...tileStyle }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>Worst Month (MoM)</div>
                <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: R }}>
                  {worstMonth?.momDelta != null ? fmtMoneyFull(worstMonth.momDelta) : '—'}
                </div>
                {worstMonth?.label && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{worstMonth.label} · prior close → this close</div>}
              </div>

              {/* CAGR / Since first capture (6th tile) */}
              <div style={{ ...tileStyle }}>
                <div style={{ fontSize: 12, color: M, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
                  {cagr != null ? 'CAGR (12mo)' : 'Since First Capture'}
                </div>
                {cagr != null ? (
                  <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: cagr >= 0 ? G : R }}>
                    {cagr >= 0 ? '+' : ''}{cagr.toFixed(2)}%
                  </div>
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: M }}>
                    {yearsElapsed > 0 ? `${(yearsElapsed * 12).toFixed(0)}mo` : '—'}
                  </div>
                )}
                {trendMonthly != null && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    Trend: {trendMonthly >= 0 ? '+' : ''}{fmtMoney(trendMonthly)}/mo
                  </div>
                )}
              </div>
            </div>

            {/* ── Balance Milestones ──────────────────────────────────────────── */}
            {milestones.length > 0 && (
              <div style={{ ...cardStyle }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase',
                  letterSpacing: '0.8px', marginBottom: 10 }}>Balance Milestones</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[...milestones].slice(-5).reverse().map(ms => (
                    <div key={ms.level} style={{ display: 'flex', alignItems: 'center', gap: 10,
                      fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                      <span style={{ color: G, fontWeight: 500 }}>✓</span>
                      <span style={{ color: 'var(--text)', fontWeight: 500 }}>{fmtMoney(ms.level)} reached</span>
                      <span style={{ color: M }}>{ms.date}</span>
                    </div>
                  ))}
                </div>
                {distToNext != null && distToNext > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--fd-hairline)',
                    fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: M }}>Next milestone: </span>
                    <span style={{ color: 'var(--amber)', fontWeight: 500 }}>{fmtMoney(nextMilestone)}</span>
                    <span style={{ color: M }}> — {fmtMoneyFull(distToNext)} to go</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Account Distribution ────────────────────────────────────────── */}
            {latestWithAccts && Object.keys(latestWithAccts.accounts ?? {}).length > 0 && latestTotal > 0 && (
              <div style={{ ...cardStyle }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase',
                  letterSpacing: '0.8px', marginBottom: 10 }}>Account Distribution</div>
                <div style={{ display: 'flex', height: 16, borderRadius: 0, overflow: 'hidden', marginBottom: 10 }}>
                  {acctKeys.map(k => {
                    const v = latestWithAccts.accounts?.[k] ?? 0
                    const pct = latestTotal > 0 ? (v / latestTotal) * 100 : 0
                    if (pct < 0.5) return null
                    return <div key={k} style={{ width: `${pct}%`, background: ACCT_COLORS[k] }} />
                  })}
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {acctKeys.map(k => {
                    const v = latestWithAccts.accounts?.[k] ?? 0
                    const pct = latestTotal > 0 ? (v / latestTotal) * 100 : 0
                    if (pct < 0.5) return null
                    const lbl = acctLabel(k)
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8,
                          borderRadius: 0, background: ACCT_COLORS[k] }} />
                        <span style={{ fontSize: 12, color: M }}>{lbl}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
                          color: ACCT_COLORS[k] }}>{pct.toFixed(1)}%</span>
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>({fmtMoneyFull(v)})</span>
                        {lbl === 'Rollover IRA' && (
                          <span style={{ fontSize: 12, color: 'var(--text3)', opacity: 0.7 }}>conversion vehicle — not spendable</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── 5-Session Open→Close Bar Chart ─────────────────────────────── */}
            {last5Sessions.length > 0 && (
              <div style={{ ...cardStyle }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase',
                  letterSpacing: '0.8px', marginBottom: 10 }}>
                  Last {last5Sessions.length} Sessions — Open → Close
                </div>
                <ResponsiveContainer width="100%" height={80}>
                  <BarChart data={last5Sessions.map(s => ({ ...s, delta: s.delta ?? 0 }))}
                    margin={{ left: 8, right: 8, top: 0, bottom: 0 }} barSize={32}>
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} width={72}
                      tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${fmtMoney(v)}`} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                      formatter={(v: unknown) => [`${Number(v) >= 0 ? '+' : ''}${fmtMoneyFull(Number(v))}`, 'Session Δ']} />
                    <ReferenceLine y={0} stroke="var(--fd-hairline)" />
                    <Bar dataKey="delta" radius={[2, 2, 0, 0]}>
                      {last5Sessions.map((s, i) => (
                        <Cell key={i} fill={(s.delta ?? 0) >= 0 ? G : R} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════════
                ADVANCED MODE — charts and tables
            ════════════════════════════════════════════════════════════════ */}
            {mode === 'advanced' && (<>

              {/* ── Chart 1: Monthly Performance ─────────────────────────────── */}
              <div style={{ ...cardStyle }}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Monthly Performance
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {isCustomRange
                        ? `${displayMonths[0]?.label ?? ''} → ${displayMonths[displayMonths.length - 1]?.label ?? ''}`
                        : `rolling ${displayMonths.length}mo`}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    True growth line — last close per month, month-over-month.
                  </div>
                </div>

                {months.length < 2 ? (
                  <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: M, fontSize: 12, border: '1px dashed var(--fd-hairline)', borderRadius: 0 }}>
                    Need at least 2 months of data
                  </div>
                ) : (<>
                  {acctKeys.length > 0 && (
                    <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                      {acctKeys.map(k => (
                        <span key={k} style={{ fontSize: 12, color: M }}>
                          <span style={{ color: ACCT_COLORS[k], marginRight: 4 }}>—</span>
                          {acctLabel(k)}
                        </span>
                      ))}
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                        <span style={{ color: monthlyColor, marginRight: 4, fontWeight: 500 }}>━</span>Total
                      </span>
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height={acctKeys.length > 0 ? 200 : 180}>
                    <AreaChart data={monthsWithAccts} margin={{ left: 8, right: 8, top: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="bhMonthGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={monthlyColor} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={monthlyColor} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} width={72}
                        tickFormatter={yFmt} domain={yDomain} />
                      <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                        formatter={(v: unknown, name: unknown) => [
                          v != null && Number(v) > 0 ? fmtMoneyFull(Number(v)) : '—', String(name)
                        ]} />
                      {monthsWithAccts[0]?.close != null && (
                        <ReferenceLine y={monthsWithAccts[0].close} stroke="var(--fd-hairline)" strokeDasharray="4 3" />
                      )}
                      {acctKeys.map(k => (
                        <Line key={k} type="monotone" dataKey={k} name={acctLabel(k)}
                          stroke={ACCT_COLORS[k]} strokeWidth={1} strokeDasharray="4 2"
                          dot={{ r: 2, fill: ACCT_COLORS[k], strokeWidth: 0 }}
                          connectNulls />
                      ))}
                      <Area type="monotone" dataKey="close" name="Total"
                        stroke={monthlyColor} strokeWidth={2.5}
                        fill="url(#bhMonthGrad)"
                        dot={{ r: 4, fill: monthlyColor, strokeWidth: 0 }}
                        connectNulls />
                    </AreaChart>
                  </ResponsiveContainer>

                  <div style={{ borderTop: '1px solid var(--fd-hairline)', margin: '10px 0 8px' }} />
                  <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
                    letterSpacing: '0.6px', marginBottom: 6 }}>
                    Month-over-Month Change
                  </div>
                  <ResponsiveContainer width="100%" height={70}>
                    <BarChart data={months.filter(m => m.momDelta != null)} margin={{ left: 8, right: 8, top: 0, bottom: 0 }} barSize={24}>
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} width={72}
                        tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${fmtMoney(v)}`} />
                      <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                        formatter={(v: unknown) => [`${Number(v) >= 0 ? '+' : ''}${fmtMoneyFull(Number(v))}`, 'MoM change']} />
                      <ReferenceLine y={0} stroke="var(--fd-hairline)" />
                      <Bar dataKey="momDelta" radius={[2, 2, 0, 0]}>
                        {months.filter(m => m.momDelta != null).map((m, i) => (
                          <Cell key={i} fill={(m.momDelta ?? 0) >= 0 ? G : R} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>)}
              </div>

              {/* ── Chart 2: Account Growth Comparison ───────────────────────── */}
              {acctKeys.length >= 2 && normalizedMonths.some(r => acctKeys.some(k => r[k] != null)) && (
                <div style={{ ...cardStyle }}>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Account Growth Comparison
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                      All accounts indexed to 100 at start of period — removes size bias.
                      {' '} Balance growth, not investment return: Roth conversions and transfers move money between
                      accounts, so Rollover/Roth lines include those flows. See Returns tab for price-based per-account CAGR.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
                    {acctKeys.map(k => (
                      <span key={k} style={{ fontSize: 12, color: M, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ display: 'inline-block', width: 20, height: 2, background: ACCT_COLORS[k], borderRadius: 0 }} />
                        {acctLabel(k)}
                        {(() => {
                          const last = [...normalizedMonths].reverse().find(r => r[k] != null)
                          const curr = last?.[k] as number | null
                          if (!curr) return null
                          const chg = curr - 100
                          return (
                            <span style={{ color: chg >= 0 ? G : R, fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                              title="Balance growth incl. transfers/conversions — not investment return">
                              {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
                              <span style={{ color: 'var(--text3)', fontWeight: 400 }}> incl. transfers</span>
                            </span>
                          )
                        })()}
                      </span>
                    ))}
                  </div>

                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={normalizedMonths} margin={{ left: 8, right: 8, top: 4, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} width={48}
                        tickFormatter={(v: number) => `${v.toFixed(0)}`}
                        domain={([min, max]: readonly [number, number]): [number, number] => {
                          const pad = Math.max((max - min) * 0.15, 2)
                          return [Math.floor(min - pad), Math.ceil(max + pad)]
                        }}
                      />
                      <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                        formatter={(v: unknown, name: unknown, entry: any) => {
                          const n = Number(v)
                          const chg = n - 100
                          const pctStr = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`
                          const key = entry?.dataKey as string | undefined
                          const usd = key ? (entry?.payload?.[`${key}_usd`] as number | null | undefined) : null
                          const baseLabel = key ? baseLabels[key] : undefined
                          // Lead with the real $ balance — a bare index number ("100.00")
                          // reads like a dollar figure and gets confused with the account's
                          // actual balance, especially next to Daily Price-Action's $ chart.
                          const label = usd != null
                            ? `${fmtMoneyFull(usd)} (${pctStr}${baseLabel ? ` since ${baseLabel}` : ''})`
                            : pctStr
                          return [label, String(name)]
                        }} />
                      <ReferenceLine y={100} stroke="var(--fd-hairline)" strokeDasharray="4 3"
                        label={{ value: 'Base 100', position: 'right', fontSize: 12, fill: M }} />
                      {acctKeys.map(k => (
                        <Line key={k} type="monotone" dataKey={k} name={acctLabel(k)}
                          stroke={ACCT_COLORS[k]} strokeWidth={2}
                          dot={{ r: 3, fill: ACCT_COLORS[k], strokeWidth: 0 }}
                          connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>

                  {monthlyAttribution.length >= 1 && (<>
                    <div style={{ borderTop: '1px solid var(--fd-hairline)', margin: '10px 0 8px' }} />
                    <div style={{ fontSize: 12, color: M, fontWeight: 500, textTransform: 'uppercase',
                      letterSpacing: '0.6px', marginBottom: 6 }}>
                      Monthly Sleeve Attribution
                    </div>
                    <ResponsiveContainer width="100%" height={90}>
                      <BarChart data={monthlyAttribution} margin={{ left: 8, right: 8, top: 0, bottom: 0 }} barSize={20}>
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} width={72}
                          tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${fmtMoney(v)}`} />
                        <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                          formatter={(v: unknown, name: unknown) => [
                            `${Number(v) >= 0 ? '+' : ''}${fmtMoneyFull(Number(v))}`, String(name)
                          ]} />
                        <ReferenceLine y={0} stroke="var(--fd-hairline)" />
                        {acctKeys.map(k => (
                          <Bar key={k} dataKey={k} name={acctLabel(k)} stackId="attr"
                            fill={ACCT_COLORS[k]} fillOpacity={0.85} radius={[0, 0, 0, 0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </>)}
                </div>
              )}

              {/* ── Chart 3A: Daily Price-Action ─────────────────────────────── */}
              <div style={{ ...cardStyle }}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Daily Price-Action
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {isCustomRange
                        ? `${displayDays[0]?.date ?? ''} → ${displayDays[displayDays.length - 1]?.date ?? ''}`
                        : `last ${displayDays.length} trading days`}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    Cycle detection — volatility, pullback depth, momentum drift.
                  </div>
                </div>

                <ResponsiveContainer width="100%" height={acctKeys.length > 0 ? 180 : 160}>
                  <AreaChart data={daysWithAccts} margin={{ left: 8, right: 8, top: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="bhDailyGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={G} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={G} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} width={72}
                      tickFormatter={yFmt} domain={yDomain} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                      formatter={(v: unknown, name: unknown) => [
                        v != null && Number(v) > 0 ? fmtMoneyFull(Number(v)) : '—', String(name)
                      ]} />
                    {firstClose > 0 && (
                      <ReferenceLine y={firstClose} stroke="var(--fd-hairline)" strokeDasharray="4 3" />
                    )}
                    {acctKeys.map(k => (
                      <Line key={k} type="monotone" dataKey={k} name={acctLabel(k)}
                        stroke={ACCT_COLORS[k]} strokeWidth={1} strokeDasharray="4 2"
                        dot={{ r: 1.5, fill: ACCT_COLORS[k], strokeWidth: 0 }}
                        connectNulls />
                    ))}
                    <Area type="monotone" dataKey="close" name="Total"
                      stroke={G} strokeWidth={2} fill="url(#bhDailyGrad)"
                      dot={{ r: 2.5, fill: G, strokeWidth: 0 }} connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* ── Chart 3B: Daily P&L Full History ──────────────────────────── */}
              {days.filter(d => d.dovDelta != null).length >= 2 && (
                <div style={{ ...cardStyle }}>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                        Daily P&amp;L — Full History
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                        {days[0]?.date ?? ''} → {days[days.length - 1]?.date ?? ''}
                        {' · '}{days.filter(d => d.dovDelta != null).length} sessions
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                      Close-to-close daily returns across all captured history.
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={80}>
                    <BarChart data={days.filter(d => d.dovDelta != null).map(d => ({ ...d, date: d.date.slice(5) }))}
                      margin={{ left: 8, right: 8, top: 0, bottom: 0 }} barSize={8}>
                      <XAxis dataKey="date" tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 12, fill: M }} axisLine={false} tickLine={false} width={72}
                        tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${fmtMoney(v)}`} />
                      <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_RECHARTS} itemStyle={TOOLTIP_ITEM_RECHARTS} cursor={TOOLTIP_CURSOR}
                        formatter={(v: unknown) => [`${Number(v) >= 0 ? '+' : ''}${fmtMoneyFull(Number(v))}`, 'Day P&L']} />
                      <ReferenceLine y={0} stroke="var(--fd-hairline)" />
                      <Bar dataKey="dovDelta" radius={[2, 2, 0, 0]}>
                        {days.filter(d => d.dovDelta != null).map((d, i) => (
                          <Cell key={i} fill={(d.dovDelta ?? 0) >= 0 ? G : R} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* ── Monthly Summary Table ────────────────────────────────────── */}
              {monthsWithHwm.length >= 1 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
                  borderRadius: 0, overflowX: 'auto' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase',
                    letterSpacing: '0.6px', padding: '8px 14px', borderBottom: '1px solid var(--fd-hairline)' }}>
                    Monthly Summary
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)', minWidth: 600 }}>
                    <thead>
                      <tr style={{ background: 'var(--panel)' }}>
                        {['Month', 'Month Open', 'Month Close', 'MoM Δ ¹', 'MoM %', 'New High?'].map(h => (
                          <th key={h} style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: M,
                            fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px',
                            borderBottom: '1px solid var(--fd-hairline)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...monthsWithHwm].reverse().map((m, i) => (
                        <tr key={m.ym} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--panel)' }}>
                          <td style={{ padding: '5px 12px', textAlign: 'right', color: M, fontWeight: 500 }}>{m.label}</td>
                          <td style={{ padding: '5px 12px', textAlign: 'right',
                            color: m.open != null ? 'var(--amber)' : M }}>
                            {m.open != null ? (
                              <>
                                {fmtMoneyFull(m.open)}
                                {!m.openIsReal && (
                                  <span title="Estimated — no 9:30 ET open captured this month"
                                    style={{ fontSize: 12, color: M, marginLeft: 4, fontWeight: 400 }}>~</span>
                                )}
                              </>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '5px 12px', textAlign: 'right', color: G, fontWeight: 500 }}>
                            {m.close != null ? fmtMoneyFull(m.close) : '—'}
                          </td>
                          <td style={{ padding: '5px 12px', textAlign: 'right',
                            color: m.momDelta == null ? M : m.momDelta >= 0 ? G : R, fontWeight: 500 }}>
                            {m.momDelta == null ? '—' : `${m.momDelta >= 0 ? '+' : ''}${fmtMoneyFull(m.momDelta)}`}
                          </td>
                          <td style={{ padding: '5px 12px', textAlign: 'right',
                            color: m.momPct == null ? M : m.momPct >= 0 ? G : R }}>
                            {m.momPct == null ? '—' : `${m.momPct >= 0 ? '+' : ''}${m.momPct.toFixed(2)}%`}
                          </td>
                          <td style={{ padding: '5px 12px', textAlign: 'right' }}>
                            {m.newHigh ? <span style={{ color: G, fontWeight: 500 }}>✓</span> : <span style={{ color: M }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 12, color: 'var(--text3)', padding: '6px 14px 8px', borderTop: '1px solid var(--fd-hairline)', lineHeight: 1.5 }}>
                    ¹ MoM Δ = this month's last close − prior month's last close (not within-month open → close)
                  </div>
                </div>
              )}

              {/* ── Daily Detail Table with Gap Analysis & Pressure Classification ── */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)',
                borderRadius: 0, overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase',
                  letterSpacing: '0.6px', padding: '8px 14px', borderBottom: '1px solid var(--fd-hairline)',
                  position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
                  Daily Detail — Session Analysis
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)', minWidth: 900 }}>
                  <thead style={{ position: 'sticky', top: 33, background: 'var(--panel)', zIndex: 1 }}>
                    <tr>
                      {(() => {
                        const thStyle: React.CSSProperties = {
                          padding: '5px 12px', textAlign: 'right', fontSize: 12, color: M,
                          fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px',
                          borderBottom: '1px solid var(--fd-hairline)', whiteSpace: 'nowrap',
                        }
                        const th = (h: string) => <th key={h} style={thStyle}>{h}</th>
                        return <>
                          {['Date', 'Day', ...acctKeys.map(k => acctLabel(k)), 'Open', 'Close'].map(th)}
                          {hasHighLowData && <>
                            {['High', 'Low', 'Range $', 'Range %'].map(th)}
                            <th key="Close Pos %" style={thStyle}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                Close Pos %
                                <InfoTooltip term="close_pos_pct" inline />
                              </span>
                            </th>
                          </>}
                          {['Intraday Δ', 'DoD Δ', 'DoD %', 'Direction'].map(th)}
                          {hasHighLowData && (
                            <th key="Day Score" style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12, color: M,
                              fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px',
                              borderBottom: '1px solid var(--fd-hairline)', whiteSpace: 'normal', maxWidth: 80, verticalAlign: 'bottom' }}>
                              <div>Day Score</div>
                              <div style={{ fontSize: 12, fontWeight: 400, textTransform: 'none', letterSpacing: 0,
                                color: 'var(--text3)', lineHeight: 1.3, opacity: 0.85 }}>
                                0–100 · close position + direction + pressure
                              </div>
                            </th>
                          )}
                          {['Gap $', 'Gap %', 'Filled', 'Pressure'].map(th)}
                        </>
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {[...displayDays].reverse().map((d, i) => {
                      const closeSnap = sorted.find(r => r.date === d.date && (r.label === 'close' || r.label === 'manual'))
                                    ?? sorted.find(r => r.date === d.date && r.label === 'open')
                      const isManual   = d.closeLabel === 'manual'
                      const phase      = isManual && d.closeRecordedAt ? manualPhase(d.closeRecordedAt) : null
                      const phaseLabel = phase === 'pre-market' ? 'pre-market'
                                       : phase === 'intraday'   ? 'intraday'
                                       : phase === 'after-close'? 'after-close'
                                       : null
                      const isRealClose = !isManual
                      const suppress   = isManual && phase !== 'after-close'

                      // Get prev day's close for gap and pressure
                      const dIdx  = displayDays.findIndex(x => x.date === d.date)
                      const prevD = displayDays.slice(0, dIdx).reverse().find(p => p.close != null)

                      const pressure = pressureClass(d, prevD?.close)

                      // High/Low — not available yet (schema future)
                      const high = d.high
                      const low  = d.low
                      const rangeAmt = high != null && low != null ? high - low : null
                      const rangePct = high != null && low != null && d.open != null && d.open > 0
                        ? (rangeAmt! / d.open) * 100 : null
                      const closePct = high != null && low != null && d.close != null && rangeAmt != null && rangeAmt > 0
                        ? ((d.close - low) / rangeAmt) * 100 : null

                      return (
                        <tr key={d.date} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--panel)' }}>
                          <td style={{ padding: '4px 12px', textAlign: 'right', color: M }}>{d.date}</td>
                          <td style={{ padding: '4px 12px', textAlign: 'right', color: M }}>{d.dayName}</td>
                          {acctKeys.map(k => (
                            <td key={k} style={{ padding: '4px 12px', textAlign: 'right', color: ACCT_COLORS[k] }}>
                              {closeSnap?.accounts?.[k] != null ? fmtMoneyFull(closeSnap.accounts[k]) : '—'}
                            </td>
                          ))}
                          {/* Open */}
                          <td style={{ padding: '4px 12px', textAlign: 'right', color: 'var(--amber)' }}>
                            {d.open != null ? fmtMoneyFull(d.open) : '—'}
                          </td>
                          {/* Close */}
                          <td style={{ padding: '4px 12px', textAlign: 'right',
                            color: isRealClose ? G : 'var(--amber)', fontWeight: 500 }}>
                            {d.close != null ? (
                              <>
                                {fmtMoneyFull(d.close)}
                                {phaseLabel && (
                                  <span style={{ fontSize: 12, color: 'var(--amber)', marginLeft: 5,
                                    fontWeight: 400, opacity: 0.7 }}>{phaseLabel}</span>
                                )}
                              </>
                            ) : '—'}
                          </td>
                          {/* High / Low / Range — only when H/L data exists */}
                          {hasHighLowData && (<>
                            <td style={{ padding: '4px 12px', textAlign: 'right', color: M }}>
                              {high != null ? fmtMoneyFull(high) : '—'}
                            </td>
                            <td style={{ padding: '4px 12px', textAlign: 'right', color: M }}>
                              {low != null ? fmtMoneyFull(low) : '—'}
                            </td>
                            <td style={{ padding: '4px 12px', textAlign: 'right', color: M }}>
                              {rangeAmt != null ? fmtMoneyFull(rangeAmt) : '—'}
                            </td>
                            <td style={{ padding: '4px 12px', textAlign: 'right', color: M }}>
                              {rangePct != null ? `${rangePct.toFixed(2)}%` : '—'}
                            </td>
                            <td style={{ padding: '4px 12px', textAlign: 'right',
                              color: closePct != null ? (closePct >= 50 ? G : R) : M }}>
                              {closePct != null ? `${closePct.toFixed(1)}%` : '—'}
                            </td>
                          </>)}
                          {/* Intraday Δ */}
                          <td style={{ padding: '4px 12px', textAlign: 'right',
                            color: d.intradayDelta == null ? M : d.intradayDelta >= 0 ? G : R }}>
                            {d.intradayDelta == null ? '—' : `${d.intradayDelta >= 0 ? '+' : ''}${fmtMoneyFull(d.intradayDelta)}`}
                          </td>
                          {/* DoD Δ */}
                          <td style={{ padding: '4px 12px', textAlign: 'right',
                            color: suppress ? M : d.dovDelta == null ? M : d.dovDelta >= 0 ? G : R, fontWeight: 500 }}>
                            {suppress
                              ? <span style={{ fontSize: 12, opacity: 0.4 }}>{phase ?? 'pending'}</span>
                              : d.dovDelta == null ? '—' : `${d.dovDelta >= 0 ? '+' : ''}${fmtMoneyFull(d.dovDelta)}`}
                          </td>
                          {/* DoD % */}
                          <td style={{ padding: '4px 12px', textAlign: 'right',
                            color: suppress ? M : d.dovPct == null ? M : d.dovPct >= 0 ? G : R }}>
                            {suppress || d.dovPct == null ? '—' : `${d.dovPct >= 0 ? '+' : ''}${d.dovPct.toFixed(2)}%`}
                          </td>
                          {/* Direction chip */}
                          {(() => {
                            const di = directionInfo(suppress ? null : d.dovPct)
                            return (
                              <td style={{ padding: '4px 12px', textAlign: 'right' }}>
                                {di.label === '—'
                                  ? <span style={{ color: M, fontSize: 12 }}>—</span>
                                  : <span style={{
                                      fontSize: 12, fontWeight: 500, padding: '2px 6px',
                                      border: `1px solid ${di.color}`,
                                      color: di.color, background: `${di.color}12`,
                                      borderRadius: 0, whiteSpace: 'nowrap', letterSpacing: '0.4px',
                                    }}>
                                      {di.emoji} {di.label}
                                    </span>}
                              </td>
                            )
                          })()}
                          {/* Day Score — composite 0-100, only when H/L data */}
                          {hasHighLowData && (() => {
                            const intradayPct = d.open != null && d.open > 0 && d.intradayDelta != null
                              ? (d.intradayDelta / d.open) * 100 : null
                            const score = dayScore(closePct, intradayPct, suppress ? null : d.dovPct)
                            const scoreColor = score == null ? M : dayScoreColor(score)
                            return (
                              <td style={{ padding: '4px 12px', textAlign: 'right' }}>
                                {score == null
                                  ? <span style={{ color: M }}>—</span>
                                  : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12,
                                      fontWeight: 500, color: scoreColor }}>
                                      {score}
                                    </span>}
                              </td>
                            )
                          })()}
                          {/* Gap $ */}
                          <td style={{ padding: '4px 12px', textAlign: 'right',
                            color: d.gapDelta == null ? M : d.gapDelta >= 0 ? G : R }}>
                            {d.gapDelta == null ? '—' : `${d.gapDelta >= 0 ? '+' : ''}${fmtMoneyFull(d.gapDelta)}`}
                          </td>
                          {/* Gap % */}
                          <td style={{ padding: '4px 12px', textAlign: 'right',
                            color: d.gapPct == null ? M : d.gapPct >= 0 ? G : R }}>
                            {d.gapPct == null ? '—' : `${d.gapPct >= 0 ? '+' : ''}${d.gapPct.toFixed(2)}%`}
                          </td>
                          {/* Gap Filled */}
                          <td style={{ padding: '4px 12px', textAlign: 'right' }}>
                            {d.gapFilled == null ? <span style={{ color: M }}>—</span>
                              : d.gapFilled
                                ? <span style={{ color: G, fontWeight: 500 }}
                                    title={d.gapDelta != null && d.gapDelta < 0 ? 'Close ≥ prev close — down-gap filled' : 'Close ≤ prev close — up-gap filled'}>
                                    Yes ✓
                                  </span>
                                : <span style={{ color: R }}
                                    title={d.gapDelta != null && d.gapDelta < 0 ? 'Close stayed below prev close — gap open' : 'Close stayed above prev close — gap open'}>
                                    No
                                  </span>}
                          </td>
                          {/* Pressure — badge with hover definition tooltip */}
                          <td style={{ padding: '4px 12px', textAlign: 'right' }}>
                            <PressureBadge label={pressure} d={d} prevClose={prevD?.close} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Trend Projection ────────────────────────────────────────── */}
              {trendSlope != null && proj30d != null && proj90d != null && (
                <div style={{ ...cardStyle }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: M, textTransform: 'uppercase',
                    letterSpacing: '0.8px', marginBottom: 10 }}>Trend Projection</div>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 12, color: M, marginBottom: 2 }}>30-day slope</div>
                      <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)',
                        color: (trendMonthly ?? 0) >= 0 ? G : R }}>
                        {(trendMonthly ?? 0) >= 0 ? '+' : ''}{fmtMoneyFull(trendMonthly ?? 0)}/mo
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: M, marginBottom: 2 }}>Projected 30d</div>
                      <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                        {fmtMoneyFull(proj30d)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: M, marginBottom: 2 }}>Projected 90d</div>
                      <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                        {fmtMoneyFull(proj90d)}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: M, marginTop: 8, fontStyle: 'italic' }}>
                    Linear regression over last {displayDays.length} sessions — not a forecast. Recent strong performance is embedded in the slope; results may not persist.
                  </div>
                </div>
              )}

            </>)}
            {/* end advanced mode */}

          </>)}
      </div>
    </div>
  )
}
