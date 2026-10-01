import { MiniBar } from '../ui/Sparkline'
import { fmtMoneyFull } from '../../utils/formatters'
import { G, R, B } from './taxColors'
import type { DashboardData } from '../../types/dashboard'

export function DividendCharacter({ tx }: { tx: DashboardData['tax_data'] }) {
  const total = tx.annual_div_total
  const ord = tx.total_ordinary_div
  const qual = tx.total_qualified_div
  const roc = tx.total_roc_div

  const ordPct = total > 0 ? (ord / total) * 100 : 0
  const qualPct = total > 0 ? (qual / total) * 100 : 0
  const rocPct = total > 0 ? (roc / total) * 100 : 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div className="bb-label">TOTAL DIVIDENDS</div>
        <div style={{ fontSize: 22, fontWeight: 500, color: G, margin: '4px 0' }}>{fmtMoneyFull(total)}</div>
        <div className="bb-sub">Qualified share: {qualPct.toFixed(1)}%</div>
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div className="bb-label">ORDINARY</div>
        <div style={{ fontSize: 20, fontWeight: 500, color: R, margin: '4px 0' }}>{fmtMoneyFull(ord)}</div>
        <MiniBar value={ordPct} color={R} height={4} />
        <div className="bb-sub" style={{ marginTop: 3 }}>{ordPct.toFixed(1)}% of total</div>
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div className="bb-label">QUALIFIED</div>
        <div style={{ fontSize: 20, fontWeight: 500, color: G, margin: '4px 0' }}>{fmtMoneyFull(qual)}</div>
        <MiniBar value={qualPct} color={G} height={4} />
        <div className="bb-sub" style={{ marginTop: 3 }}>{qualPct.toFixed(1)}% of total</div>
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
        <div className="bb-label">RETURN OF CAPITAL</div>
        <div style={{ fontSize: 20, fontWeight: 500, color: B, margin: '4px 0' }}>{fmtMoneyFull(roc)}</div>
        <MiniBar value={rocPct} color={B} height={4} />
        <div className="bb-sub" style={{ marginTop: 3 }}>{rocPct.toFixed(1)}% of total · tax-deferred (reduces cost basis)</div>
      </div>
    </div>
  )
}
