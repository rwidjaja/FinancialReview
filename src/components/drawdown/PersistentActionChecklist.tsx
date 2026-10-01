/**
 * PersistentActionChecklist — Persistent Annual Action Checklist
 * Lines ~2975–3085 of the original DrawdownTab.tsx
 */

import type { DashboardData } from '../../types/dashboard'
import { G, R, A, M, Y } from './drawdown.shared'
import { useYearActions } from './useYearActions'

export function PersistentActionChecklist({ data }: { data: DashboardData }) {
  const currentYear = new Date().getFullYear()
  const nextReviewMonth = new Date().getMonth() < 9 ? 'October' : 'January'
  const nextReviewYear  = new Date().getMonth() < 9 ? currentYear : currentYear + 1

  const actions = useYearActions(data)

  const hasUrgent = actions.some(a => a.priority === 'urgent')
  const hasHigh   = actions.some(a => a.priority === 'high')
  const confLabel = hasUrgent ? 'ACTION REQUIRED' : hasHigh ? 'HIGH PRIORITY' : 'ROUTINE'
  const confColor = hasUrgent ? R : hasHigh ? A : G

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${confColor}`,
      borderTop: `3px solid ${confColor}`, padding: '10px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: confColor, letterSpacing: '0.8px' }}>
            {currentYear} ACTION PLAN
          </span>
          <span style={{ fontSize: 12, background: confColor, color: 'var(--bg)',
            padding: '1px 6px', fontWeight: 500, letterSpacing: '0.5px' }}>
            {confLabel}
          </span>
        </div>
        <span style={{ fontSize: 12, color: M }}>
          Dynamic Bracket · MFJ {currentYear} · Next review: {nextReviewMonth} {nextReviewYear}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 5 }}>
        {actions.map((action, i) => {
          const itemColor = action.priority === 'urgent' ? R
            : action.priority === 'high' ? A
            : action.priority === 'medium' ? Y : M
          const borderColor = (action.priority === 'urgent' || action.priority === 'high')
            ? `rgba(245,158,11,0.25)` : 'var(--border2)'
          return (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start',
              background: 'var(--bg)', padding: '5px 8px', border: `1px solid ${borderColor}` }}>
              <span style={{ fontSize: 12, color: M, minWidth: 16, paddingTop: 1, fontFamily: 'var(--font-mono)' }}>
                {i + 1}.
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: itemColor, lineHeight: 1.3 }}>
                  {action.icon} {action.text}
                </div>
                <div style={{ fontSize: 12, color: M, lineHeight: 1.3, marginTop: 1 }}>
                  {action.sub}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
