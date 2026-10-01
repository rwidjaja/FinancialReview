import { PanelHeader, DataRow, Divider } from '../ui/Terminal'
import { fmtMoneyFull } from '../../utils/formatters'
import { G, A, M } from './taxColors'
import type { DashboardData } from '../../types/dashboard'

export function PersonalInfo({ tx }: { tx: DashboardData['tax_data'] }) {
  // SS countdown for primary
  const ssYrs = tx.ss_years_until
  let ssChip: React.ReactNode = null
  if (ssYrs != null) {
    if (ssYrs <= 0) {
      ssChip = (
        <span style={{
          padding: '2px 8px', borderRadius: 0, background: 'var(--fd-card)',
          border: '1px solid var(--green)', color: G, fontSize: 12, fontWeight: 500,
        }}>SS ACTIVE</span>
      )
    } else {
      ssChip = (
        <span style={{
          padding: '2px 8px', borderRadius: 0, background: 'var(--bg)',
          border: '1px solid var(--fd-hairline)', color: A, fontSize: 12, fontWeight: 500,
        }}>SS IN {ssYrs} YR{ssYrs !== 1 ? 'S' : ''}</span>
      )
    }
  }

  // Spouse SS countdown
  let spouseChip: React.ReactNode = null
  if (tx.spouse_name && tx.spouse_age != null && tx.spouse_ss_start_age != null) {
    const spYrs = Math.max(0, tx.spouse_ss_start_age - Math.floor(tx.spouse_age))
    if (spYrs <= 0) {
      spouseChip = (
        <span style={{
          padding: '2px 8px', borderRadius: 0, background: 'var(--fd-card)',
          border: '1px solid var(--green)', color: G, fontSize: 12, fontWeight: 500,
        }}>SPOUSE SS ACTIVE</span>
      )
    } else {
      spouseChip = (
        <span style={{
          padding: '2px 8px', borderRadius: 0, background: 'var(--bg)',
          border: '1px solid var(--fd-hairline)', color: A, fontSize: 12, fontWeight: 500,
        }}>SPOUSE SS IN {spYrs} YR{spYrs !== 1 ? 'S' : ''}</span>
      )
    }
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '10px 14px' }}>
      <PanelHeader>PERSONAL PROFILE</PanelHeader>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <DataRow label="NAME" value={<span style={{ color: 'var(--text)', fontWeight: 500 }}>{tx.name}</span>} />
        <DataRow label="AGE" value={<span style={{ color: 'var(--text)' }}>{tx.current_age}</span>} />
        <DataRow label="FILING" value={<span style={{ color: A }}>{tx.filing_status}</span>} />
        <DataRow label="SS START" value={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text)' }}>Age {tx.ss_start_age} · {fmtMoneyFull(Math.round(tx.ss_annual / 12))}/mo</span>
            {ssChip}
          </span>
        } />
        <DataRow label="STD DEDUCTION" value={<span style={{ color: M }}>{fmtMoneyFull(tx.std_deduction)}</span>} />
        {tx.ss_start_date && (
          <DataRow label="SS DATE" value={<span style={{ color: M }}>{tx.ss_start_date}</span>} />
        )}
        {tx.spouse_name && (
          <>
            <Divider label={`${tx.spouse_name}`} />
            <DataRow label="SPOUSE AGE" value={<span style={{ color: 'var(--text)' }}>{tx.spouse_age}</span>} />
            {tx.spouse_ss_start_age != null && (
              <DataRow label="SPOUSE SS" value={
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--text)' }}>
                    Age {tx.spouse_ss_start_age} · {fmtMoneyFull(Math.round(tx.ss_annual * 0.5 / 12))}/mo
                  </span>
                  {spouseChip}
                </span>
              } />
            )}
            {tx.spouse_ss_start_age != null && (
              <DataRow label="SPOUSAL BENEFIT" value={
                <span style={{ color: M }}>
                  1/2 of earner · {fmtMoneyFull(Math.round(tx.ss_annual * 0.5))}/yr
                </span>
              } />
            )}
          </>
        )}
      </div>
    </div>
  )
}
