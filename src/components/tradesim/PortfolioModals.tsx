import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import type { Portfolio } from './types'
import { G, R, A, M, BASE, POST, apiFetch, GET } from './constants'
import { Btn, Input, Label } from './shared'

export function EditModal({ port, onClose, onSave }:
  { port: Portfolio; onClose: () => void; onSave: () => void }) {
  const [name,      setName]      = useState(port.name)
  const [desc,      setDesc]      = useState(port.description ?? '')
  const [isDefault, setIsDefault] = useState(port.is_default === 1)
  const [err,       setErr]       = useState('')

  const mut = useMutation({
    mutationFn: () => apiFetch(`${BASE}/portfolios/${port.portfolio_id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description: desc, is_default: isDefault }),
    }),
    onSuccess: () => onSave(),
    onError:   (e: Error) => setErr(e.message),
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0,
        padding: 24, width: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: A,
          textTransform: 'uppercase', letterSpacing: '1px' }}>
          ◈ EDIT PORTFOLIO
        </div>
        <Input label="Name" value={name} onChange={setName} placeholder="My Strategy" />
        <Input label="Description (opt)" value={desc} onChange={setDesc} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8,
            cursor: 'pointer', fontSize: 12, color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={e => setIsDefault(e.target.checked)}
              style={{ accentColor: 'var(--fd-accent)', width: 14, height: 14 }}
            />
            <span>Set as default portfolio</span>
          </label>
          {isDefault && (
            <span style={{ fontSize: 12, color: 'var(--fd-accent)' }}>
              (watchlist add from Research will use this)
            </span>
          )}
        </div>
        {err && <div style={{ fontSize: 12, color: R }}> {err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => {
            if (!name) { setErr('Name required'); return }
            mut.mutate()
          }} variant="blue" disabled={mut.isPending}>
            Save
          </Btn>
        </div>
      </div>
    </div>
  )
}

export function CreateModal({ onClose, onCreate }:
  { onClose: () => void; onCreate: () => void }) {
  const [name,    setName]    = useState('')
  const [desc,    setDesc]    = useState('')
  const [capital, setCapital] = useState('1000000')
  const [err,     setErr]     = useState('')

  const mut = useMutation({
    mutationFn: () => POST(`${BASE}/portfolios`, {
      name, description: desc, seed_capital: parseFloat(capital) || 1_000_000,
    }),
    onSuccess: () => onCreate(),
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0,
        padding: 24, width: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: A,
          textTransform: 'uppercase', letterSpacing: '1px' }}>
          ◈ CREATE PORTFOLIO
        </div>
        <Input label="Name" value={name} onChange={setName} placeholder="My Strategy" />
        <Input label="Description (opt)" value={desc} onChange={setDesc} />
        <Input label="Seed Capital ($)" type="number" value={capital}
          onChange={setCapital} />
        {err && <div style={{ fontSize: 12, color: R }}> {err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => {
            if (!name) { setErr('Name required'); return }
            mut.mutate()
          }} variant="green" disabled={mut.isPending}>
            Create
          </Btn>
        </div>
      </div>
    </div>
  )
}

interface SchwabAccount {
  account: string; label: string; positions: number; symbols: string[]; value: number
}

export function ImportModal({ portfolioId, onClose, onImport }:
  { portfolioId: number; onClose: () => void; onImport: () => void }) {
  const [cash,       setCash]       = useState('')
  const [acctType,   setAcctType]   = useState<string>('')
  const [err,        setErr]        = useState('')
  const [info,       setInfo]       = useState('')

  // Load available Schwab accounts
  const { data: accounts = [], isLoading: acctLoading } = useQuery<SchwabAccount[]>({
    queryKey: ['schwab-accounts'],
    queryFn:  () => GET(`${BASE}/schwab-accounts`),
    staleTime: 60_000,
  })

  // Auto-select if only one account
  const resolvedAcct = acctType || (accounts.length === 1 ? accounts[0].account : '')

  const selectedAcct = accounts.find(a => a.account === resolvedAcct)

  const mut = useMutation<
    { imported: number; symbols: string[]; skipped: string[]; accounts: string[] },
    Error, void
  >({
    mutationFn: () => POST(`${BASE}/portfolios/${portfolioId}/import-schwab`, {
      cash:         cash ? parseFloat(cash) : undefined,
      account_type: resolvedAcct || undefined,
    }),
    onSuccess: (r) => {
      const skip = r.skipped?.length ? ` (${r.skipped.length} skipped)` : ''
      setInfo(`✓ Imported ${r.imported} positions from ${r.accounts?.join(', ') ?? resolvedAcct}${skip}: ${r.symbols.slice(0, 10).join(', ')}${r.symbols.length > 10 ? '…' : ''}`)
      setTimeout(() => onImport(), 3000)
    },
    onError: (e) => setErr(e.message),
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,.64)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--fd-hairline)', borderRadius: 0,
        padding: 24, width: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: A,
          textTransform: 'uppercase', letterSpacing: '1px' }}>
          ◈ IMPORT FROM SCHWAB
        </div>
        <div style={{ fontSize: 12, color: M, lineHeight: 1.6 }}>
          Imports your live Schwab positions using <strong style={{ color: 'var(--text)' }}>current market prices</strong>.
          Dividend schedule and fundamentals are auto-populated. Your real account is not affected.
        </div>

        {/* Account selection */}
        <div>
          <Label>Select Schwab Account</Label>
          {acctLoading ? (
            <div style={{ fontSize: 12, color: M, marginTop: 4 }}>Loading accounts…</div>
          ) : accounts.length === 0 ? (
            <div style={{ fontSize: 12, color: R, marginTop: 4 }}>
               No Schwab accounts found. Check Schwab connection and account_mapping.json.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {accounts.map(a => (
                <button key={a.account} onClick={() => setAcctType(a.account)} style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', transition: 'all 0.1s',
                  background: resolvedAcct === a.account
                    ? 'var(--fd-card)' : 'var(--fd-card)',
                  border: `1px solid ${resolvedAcct === a.account ? 'var(--fd-accent)' : 'var(--border2)'}`,
                  color: resolvedAcct === a.account ? 'var(--fd-accent)' : M,
                }}>
                  {a.label}
                  <span style={{ fontSize: 12, marginLeft: 6, opacity: 0.7 }}>
                    {a.positions} pos
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Preview of positions to import */}
        {selectedAcct && (
          <div style={{ background: 'var(--surface)',
            border: '1px solid var(--fd-hairline)', borderRadius: 0, padding: '8px 12px' }}>
            <div style={{ fontSize: 12, color: M, textTransform: 'uppercase',
              letterSpacing: '0.6px', marginBottom: 6 }}>
              {selectedAcct.label} · {selectedAcct.positions} positions
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {selectedAcct.symbols.map(sym => (
                <span key={sym} style={{
                  fontSize: 12, fontWeight: 500, color: 'var(--fd-accent)',
                  background: 'var(--fd-card)',
                  padding: '1px 6px', borderRadius: 0,
                }}>{sym}</span>
              ))}
            </div>
          </div>
        )}

        <Input label="Cash Balance Override ($) — optional"
          type="number" value={cash} onChange={setCash}
          placeholder="Leave blank to use existing portfolio cash" />

        {err  && <div style={{ fontSize: 12, color: R }}> {err}</div>}
        {info && <div style={{ fontSize: 12, color: G, lineHeight: 1.5 }}>{info}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => { setErr(''); mut.mutate() }} variant="blue"
            disabled={mut.isPending || accounts.length === 0}>
            {mut.isPending ? ' Importing…' : `⬇ Import${selectedAcct ? ` ${selectedAcct.label}` : ''}`}
          </Btn>
        </div>
      </div>
    </div>
  )
}
