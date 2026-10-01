import { cn } from '../../utils/cn'

interface CardProps {
  children: React.ReactNode
  className?: string
  accent?: 'green' | 'red' | 'blue' | 'gold' | 'orange' | 'yellow' | 'none'
  style?: React.CSSProperties
  onClick?: () => void
}

// v4: cards are flat snow-grey planes — no border, no accent stripe, square.
export function Card({ children, className, style, onClick }: CardProps) {
  return (
    <div className={cn(onClick && 'cursor-pointer', className)} style={{ background: 'var(--fd-card)', padding: 24, ...style }} onClick={onClick}>
      {children}
    </div>
  )
}

interface MetricRowProps {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}

export function MetricRow({ label, value, sub }: MetricRowProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--fd-hairline)' }}>
      <span style={{ fontSize: 14, color: 'var(--fd-muted)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, textAlign: 'right' }}>{value}</span>
      {sub && <span style={{ fontSize: 13, color: 'var(--fd-muted)' }}>{sub}</span>}
    </div>
  )
}
