import { alertColor } from '../../utils/formatters'
import type { DashboardData } from '../../types/dashboard'
import { buildUnifiedAlerts } from '../../utils/unifiedAlerts'

interface Props { data: DashboardData }

const ALERT_ICONS: Record<string, string> = {
  red: '', orange: '', yellow: '', green: ''
}

export function AlertPanel({ data }: Props) {
  // Unified list — identical to header badge, ribbon pill and Risk tab panel.
  const deduped = buildUnifiedAlerts(data).map(a => ({ level: a.level as string, label: a.source, msg: a.msg }))

  if (deduped.length === 0) return (
    <div className="text-xs text-[#64748b] px-1">No active alerts — all systems nominal</div>
  )

  return (
    <div className="space-y-2">
      {deduped.map((a, i) => {
        const c = alertColor(a.level)
        return (
          <div key={i}
            className="flex items-start gap-3 px-4 py-3 rounded-lg text-xs"
            style={{ background: `${c}10`, borderLeft: `3px solid ${c}` }}>
            <span className="flex-shrink-0">{ALERT_ICONS[a.level] ?? ''}</span>
            <div>
              <span className="font-bold" style={{ color: c }}>{a.label}</span>
              <span className="text-[#cbd5e1] ml-2">{a.msg}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function AlertHistory({ data }: Props) {
  const hist = [...(data.system_health?.alert_history ?? [])].reverse()
  if (hist.length === 0) return <div className="text-xs text-[#64748b]">No alert history</div>

  return (
    <div className="overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.07)]">
      <table className="fin-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Level</th>
            <th>Symbol</th>
            <th>Alert</th>
          </tr>
        </thead>
        <tbody>
          {hist.slice(0, 20).map((a, i) => {
            const c = alertColor(a.level)
            return (
              <tr key={i}>
                <td className="text-[#64748b] tabular text-xs">{a.date ?? '—'}</td>
                <td><span className="text-xs font-bold uppercase" style={{ color: c }}>{a.level}</span></td>
                <td><span className="font-bold font-mono text-[#e2e8f0] text-xs">{a.symbol ?? '—'}</span></td>
                <td className="text-xs text-[#94a3b8]" style={{ whiteSpace: 'normal' }}>{a.message}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
