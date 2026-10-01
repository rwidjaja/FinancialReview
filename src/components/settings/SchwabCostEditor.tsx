import { useState, useRef } from 'react'
import { PanelHeader } from './PanelHeader'
import { SaveBar } from './SaveBar'

const G = 'var(--green)'
const R = 'var(--red)'
const Y = 'var(--yellow)'
const M = 'var(--text2)'
const BG = 'var(--bg)'
const P = 'var(--panel)'
const A = 'var(--amber)'

interface CostLot {
  acquiredDate: string
  quantity: number
  price: number
  costPerShare: number
  marketValue: number
  costBasis: number
  gainLoss: number
  gainLossPercent: number
  holdingPeriod: 'Short Term' | 'Long Term'
}

interface SchwabSymbolData {
  symbol: string
  account: string
  asOfDate: string
  totalQuantity: number
  totalMarketValue: number
  totalCostBasis: number
  totalGainLoss: number
  totalGainLossPercent: number
  lots: CostLot[]
}

// Helper to recalculate totals for a symbol
function recalculateSymbol(_symbol: string, symData: SchwabSymbolData): SchwabSymbolData {
  if (!symData.lots.length) {
    return {
      ...symData,
      totalQuantity: 0,
      totalMarketValue: 0,
      totalCostBasis: 0,
      totalGainLoss: 0,
      totalGainLossPercent: 0,
      asOfDate: new Date().toISOString(),
    }
  }

  const totalQuantity = symData.lots.reduce((sum, lot) => sum + lot.quantity, 0)
  const totalMarketValue = symData.lots.reduce((sum, lot) => sum + lot.marketValue, 0)
  const totalCostBasis = symData.lots.reduce((sum, lot) => sum + lot.costBasis, 0)
  const totalGainLoss = totalMarketValue - totalCostBasis
  const totalGainLossPercent = totalCostBasis > 0 ? (totalGainLoss / totalCostBasis) * 100 : 0

  return {
    ...symData,
    totalQuantity,
    totalMarketValue,
    totalCostBasis,
    totalGainLoss,
    totalGainLossPercent,
    asOfDate: new Date().toISOString(),
    lots: [...symData.lots].sort((a, b) => new Date(b.acquiredDate).getTime() - new Date(a.acquiredDate).getTime())
  }
}

// Helper to create a new lot with calculated fields
function createLot(lotData: Partial<CostLot>): CostLot {
  const quantity = lotData.quantity || 0
  const price = lotData.price || 0
  const costPerShare = lotData.costPerShare || 0
  const marketValue = quantity * price
  const costBasis = quantity * costPerShare
  const gainLoss = marketValue - costBasis
  const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0

  return {
    acquiredDate: lotData.acquiredDate || new Date().toISOString().split('T')[0],
    quantity,
    price,
    costPerShare,
    marketValue,
    costBasis,
    gainLoss,
    gainLossPercent,
    holdingPeriod: lotData.holdingPeriod || 'Short Term'
  }
}

// Properly split a CSV line respecting quoted fields (handles commas inside quotes)
function splitCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  values.push(current.trim())
  return values
}

// Schwab exports dates as MM/DD/YYYY — convert to YYYY-MM-DD for the date input.
// Returns "" for any format that isn't recognizable so callers can skip/warn.
function toISODate(dateStr: string): string {
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  // Already ISO (YYYY-MM-DD)?
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  return ''
}

function parseNum(s: string | undefined): number {
  return parseFloat((s ?? '').replace(/[$,%]/g, '').replace(/,/g, '')) || 0
}

// Parse Schwab "Lot Details" CSV export
// Format per section: "TICKER Lot Details for ...acct as of DATE","","","","",...
function parseCSVLotDetails(csvContent: string): Map<string, CostLot[]> {
  const symbolLots = new Map<string, CostLot[]>()
  let currentSymbol = ''
  let hasHeaders = false

  for (const rawLine of csvContent.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const vals = splitCSVLine(line)
    const first = vals[0] ?? ''

    // Section header: "ADX Lot Details for  ...632 as of ..."
    if (first.includes('Lot Details for')) {
      const m = first.match(/^([A-Z0-9./]+)\s+Lot Details/i)
      currentSymbol = m ? m[1].toUpperCase() : ''
      if (currentSymbol && !symbolLots.has(currentSymbol)) {
        symbolLots.set(currentSymbol, [])
      }
      hasHeaders = false
      continue
    }

    // Column header row
    if (first.toLowerCase() === 'open date' || first.toLowerCase() === 'date') {
      hasHeaders = true
      continue
    }

    // Skip total/summary rows and blank-first-field rows
    if (!first || first.toLowerCase() === 'total' || first === '--') continue

    // Data row
    if (currentSymbol && hasHeaders && vals.length >= 8) {
      const qty = parseNum(vals[1])
      if (qty <= 0) continue   // skip ghost/summary rows
      const acquiredDate = toISODate(first)
      if (!acquiredDate) continue   // skip rows where date is unrecognizable (e.g. "Various", "--")
      const lot: CostLot = {
        acquiredDate,
        quantity: qty,
        price: parseNum(vals[2]),
        costPerShare: parseNum(vals[3]),
        marketValue: parseNum(vals[4]),
        costBasis: parseNum(vals[5]),
        gainLoss: parseNum(vals[6]),
        gainLossPercent: parseNum(vals[7]),
        holdingPeriod: (vals[8] ?? '').toLowerCase().includes('long') ? 'Long Term' : 'Short Term',
      }
      symbolLots.get(currentSymbol)!.push(lot)
    }
  }

  return symbolLots
}

// Deduplicate lots based on acquiredDate and costPerShare
function deduplicateLots(lots: CostLot[]): CostLot[] {
  const seen = new Map<string, CostLot>()
  
  for (const lot of lots) {
    const key = `${lot.acquiredDate}|${lot.costPerShare}`
    
    if (!seen.has(key)) {
      seen.set(key, lot)
    } else {
      // If duplicate exists, merge quantities
      const existing = seen.get(key)!
      existing.quantity += lot.quantity
      // Recalculate derived fields
      existing.marketValue = existing.quantity * existing.price
      existing.costBasis = existing.quantity * existing.costPerShare
      existing.gainLoss = existing.marketValue - existing.costBasis
      existing.gainLossPercent = existing.costBasis > 0 ? (existing.gainLoss / existing.costBasis) * 100 : 0
    }
  }
  
  return Array.from(seen.values())
}

export function SchwabCostEditor({ data, accountMapping = {}, onSaved }: {
  data: Record<string, SchwabSymbolData>
  accountMapping?: Record<string, string>
  onSaved: (key: string, content: unknown) => void
}) {
  // Only taxable accounts are relevant for cost basis tracking
  const taxableAccounts = Object.entries(accountMapping)
    .filter(([k, v]) => !k.startsWith('_') && v === 'taxable')
    .map(([suffix]) => `...${suffix}`)

  const defaultAccount = taxableAccounts[0] ?? ''

  // Recalculate totals from the lots on load — stored JSON totals can drift
  // from the lot data (e.g. XLK showing a positive gain with $0 MV).
  const [symbols, setSymbols] = useState<Record<string, SchwabSymbolData>>(() =>
    Object.fromEntries(Object.entries(data || {}).map(([sym, sd]) => [sym, recalculateSymbol(sym, sd)]))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState('')
  const [expandedSym, setExpandedSym] = useState<string | null>(null)
  const [newSymbol, setNewSymbol] = useState('')
  const [newAccount, setNewAccount] = useState(defaultAccount)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Form state for adding a new lot to the currently selected symbol
  const [newLotForm, setNewLotForm] = useState<Partial<CostLot>>({
    acquiredDate: new Date().toISOString().split('T')[0],
    quantity: 0,
    price: 0,
    costPerShare: 0,
    holdingPeriod: 'Short Term'
  })

  // Update a specific lot
  const updateLot = (symbol: string, lotIndex: number, updates: Partial<CostLot>) => {
    setSymbols(prev => {
      const symData = prev[symbol]
      if (!symData) return prev
      
      const updatedLots = [...symData.lots]
      const currentLot = updatedLots[lotIndex]
      
      const newLot = { ...currentLot, ...updates }
      
      if (updates.quantity !== undefined || updates.price !== undefined || updates.costPerShare !== undefined) {
        newLot.marketValue = newLot.quantity * newLot.price
        newLot.costBasis = newLot.quantity * newLot.costPerShare
        newLot.gainLoss = newLot.marketValue - newLot.costBasis
        newLot.gainLossPercent = newLot.costBasis > 0 ? (newLot.gainLoss / newLot.costBasis) * 100 : 0
      }
      
      updatedLots[lotIndex] = newLot
      const updatedSymbol = { ...symData, lots: updatedLots }
      const recalculated = recalculateSymbol(symbol, updatedSymbol)
      
      return { ...prev, [symbol]: recalculated }
    })
  }

  // Add a lot to a symbol
  const addLot = (symbol: string) => {
    if (!newLotForm.acquiredDate) {
      setError('Please enter an acquired date')
      return
    }
    if (!newLotForm.quantity || newLotForm.quantity <= 0) {
      setError('Please enter a valid quantity')
      return
    }
    if (!newLotForm.price || newLotForm.price <= 0) {
      setError('Please enter a valid price')
      return
    }
    if (!newLotForm.costPerShare || newLotForm.costPerShare <= 0) {
      setError('Please enter a valid cost per share')
      return
    }

    const newLot = createLot(newLotForm)
    
    setSymbols(prev => {
      const symData = prev[symbol]
      if (!symData) return prev
      
      const updatedLots = [...symData.lots, newLot]
      const updatedSymbol = { ...symData, lots: updatedLots }
      const recalculated = recalculateSymbol(symbol, updatedSymbol)
      
      return { ...prev, [symbol]: recalculated }
    })
    
    setNewLotForm({
      acquiredDate: new Date().toISOString().split('T')[0],
      quantity: 0,
      price: 0,
      costPerShare: 0,
      holdingPeriod: 'Short Term'
    })
    setError('')
  }

  // Remove a lot
  const removeLot = (symbol: string, lotIndex: number) => {
    setSymbols(prev => {
      const symData = prev[symbol]
      if (!symData) return prev
      
      const updatedLots = symData.lots.filter((_, i) => i !== lotIndex)
      if (updatedLots.length === 0) {
        const { [symbol]: _, ...rest } = prev
        return rest
      }
      
      const updatedSymbol = { ...symData, lots: updatedLots }
      const recalculated = recalculateSymbol(symbol, updatedSymbol)
      return { ...prev, [symbol]: recalculated }
    })
  }

  // Add a new symbol
  const addSymbol = () => {
    const sym = newSymbol.trim().toUpperCase()
    if (!sym) {
      setError('Please enter a symbol')
      return
    }
    if (symbols[sym]) {
      setError(`Symbol ${sym} already exists`)
      return
    }
    
    const newSymData: SchwabSymbolData = {
      symbol: sym,
      account: newAccount,
      asOfDate: new Date().toISOString(),
      totalQuantity: 0,
      totalMarketValue: 0,
      totalCostBasis: 0,
      totalGainLoss: 0,
      totalGainLossPercent: 0,
      lots: []
    }
    
    setSymbols(prev => ({ ...prev, [sym]: newSymData }))
    setExpandedSym(sym)
    setNewSymbol('')
    setError('')
  }

  // Import CSV file — parses, deduplicates, auto-saves to SQLite
  const importCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setImportStatus('Reading file...')
    setError('')

    try {
      const content = await file.text()
      setImportStatus('Parsing CSV...')

      const importedLots = parseCSVLotDetails(content)
      setImportStatus(`Found ${importedLots.size} symbols, saving...`)

      // Build merged snapshot outside setSymbols so we can POST it
      const newSymbols = { ...symbols }
      let totalLots = 0
      let totalDedupRemoved = 0

      for (const [symbol, rawLots] of importedLots.entries()) {
        const deduped = deduplicateLots(rawLots)
        totalDedupRemoved += rawLots.length - deduped.length
        const account = newSymbols[symbol]?.account || defaultAccount
        const updatedSymbol: SchwabSymbolData = {
          symbol, account,
          asOfDate: new Date().toISOString(),
          totalQuantity: 0, totalMarketValue: 0,
          totalCostBasis: 0, totalGainLoss: 0, totalGainLossPercent: 0,
          lots: deduped,
        }
        newSymbols[symbol] = recalculateSymbol(symbol, updatedSymbol)
        totalLots += deduped.length
      }

      // Auto-save to SQLite immediately — no manual Save click needed
      setSaving(true)
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'schwab_cost', content: newSymbols }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Save failed')

      setSymbols(newSymbols)
      onSaved('schwab_cost', newSymbols)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)

      const dedupNote = totalDedupRemoved > 0 ? ` (${totalDedupRemoved} dupes removed)` : ''
      setImportStatus(`Saved ${totalLots} lots across ${importedLots.size} symbols${dedupNote}`)
      setTimeout(() => setImportStatus(''), 5000)

      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
      setImportStatus('')
    } finally {
      setSaving(false)
    }
  }

  // Remove entire symbol
  const removeSymbol = (symbol: string) => {
    if (window.confirm(`Delete all data for ${symbol}?`)) {
      setSymbols(prev => {
        const { [symbol]: _, ...rest } = prev
        return rest
      })
      if (expandedSym === symbol) setExpandedSym(null)
    }
  }

  // Refresh all lot prices from live quotes, then auto-save
  const refreshPrices = async () => {
    setRefreshing(true); setError(''); setRefreshStatus('')
    try {
      const syms = Object.keys(symbols)
      const quotes: Record<string, number> = {}
      let failed = 0
      await Promise.all(syms.map(async sym => {
        try {
          const res = await fetch(`/api/sim/quote/${sym}`)
          if (!res.ok) { failed++; return }
          const j = await res.json()
          if (j.price && j.price > 0) quotes[sym] = j.price
          else failed++
        } catch { failed++ }
      }))

      if (Object.keys(quotes).length === 0) {
        setError('Could not fetch any live prices — market may be closed or API unavailable.')
        return
      }

      // Update lot prices and recalculate totals
      const updated = Object.fromEntries(
        Object.entries(symbols).map(([sym, sd]) => {
          if (!quotes[sym]) return [sym, sd]
          const newLots = sd.lots.map(l => ({
            ...l,
            price: quotes[sym],
            marketValue: l.quantity * quotes[sym],
            gainLoss: l.quantity * quotes[sym] - l.costBasis,
            gainLossPercent: l.costBasis > 0
              ? ((l.quantity * quotes[sym] - l.costBasis) / l.costBasis) * 100
              : 0,
          }))
          return [sym, recalculateSymbol(sym, { ...sd, lots: newLots })]
        })
      )

      // Auto-save
      setSaving(true)
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'schwab_cost', content: updated }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Save failed')

      setSymbols(updated)
      onSaved('schwab_cost', updated)
      const refreshed = Object.keys(quotes).length
      const failNote = failed > 0 ? ` · ${failed} symbol${failed > 1 ? 's' : ''} unavailable` : ''
      setRefreshStatus(`✓ Prices refreshed for ${refreshed} symbol${refreshed !== 1 ? 's' : ''}${failNote}`)
      setTimeout(() => setRefreshStatus(''), 5000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false); setSaving(false)
    }
  }

  // Save all changes
  const save = async () => {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'schwab_cost', content: symbols }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Save failed')
      setSaved(true); onSaved('schwab_cost', symbols)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num)
  }

  const formatNumber = (num: number) => num?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) ?? '0'

  const symbolList = Object.keys(symbols).sort()

  return (
    <div>
      <PanelHeader>Schwab Cost Basis — Edit Lots & Symbols</PanelHeader>
      
      <div style={{ fontSize: 12, color: A, marginBottom: 12, padding: '6px 10px',
        background: `${A}12`, border: `1px solid ${A}40`, borderRadius: 0 }}>
         Edit cost basis lots directly. Add new symbols and purchase lots. 
        Values auto-calculate (MV = qty × price, gain/loss = MV - basis).
      </div>

      {/* Add new symbol and Import CSV */}
      <div style={{ marginBottom: 20, padding: 12, background: P, borderRadius: 0, border: '1px solid var(--fd-hairline)' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: M, marginBottom: 8 }}> ADD NEW SYMBOL</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={newSymbol}
            onChange={e => setNewSymbol(e.target.value.toUpperCase())}
            placeholder="SYMBOL (e.g., AAPL)"
            style={{ padding: '6px 10px', background: BG, border: '1px solid var(--fd-hairline)',
              color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
              width: 120, borderRadius: 0, outline: 'none' }}
          />
          <select value={newAccount} onChange={e => setNewAccount(e.target.value)}
            style={{ padding: '6px 10px', background: BG, border: '1px solid var(--fd-hairline)',
              color: 'var(--text)', fontSize: 12, borderRadius: 0, outline: 'none' }}>
            {taxableAccounts.length > 0
              ? taxableAccounts.map(a => <option key={a} value={a}>{a} (taxable)</option>)
              : <option value="">No taxable accounts — configure in Schwab Accounts</option>
            }
          </select>
          <button onClick={addSymbol} style={{
            padding: '6px 16px', fontSize: 12, fontWeight: 500, background: G,
            color: 'var(--fd-ink)', border: 'none', borderRadius: 0, cursor: 'pointer',
          }}>Create Symbol</button>
          
          <div style={{ width: 1, height: 24, background: 'var(--border2)', margin: '0 8px' }} />
          
          <label style={{
            padding: '6px 16px', fontSize: 12, fontWeight: 500, background: '#0984e3',
            color: 'var(--fd-ink)', border: 'none', borderRadius: 0, cursor: 'pointer',
            display: 'inline-block',
          }}>
             Import CSV
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={importCSV}
              style={{ display: 'none' }}
            />
          </label>
          {importStatus && (
            <span style={{ fontSize: 12, color: G }}>{importStatus}</span>
          )}

          <div style={{ width: 1, height: 24, background: 'var(--border2)', margin: '0 8px' }} />

          <button
            onClick={refreshPrices}
            disabled={refreshing || saving}
            style={{
              padding: '6px 16px', fontSize: 12, fontWeight: 500,
              background: refreshing ? 'var(--fd-card)' : A,
              color: refreshing ? M : 'var(--fd-page)',
              border: 'none', borderRadius: 0, cursor: refreshing ? 'default' : 'pointer',
              opacity: refreshing ? 0.7 : 1,
            }}
          >
            {refreshing ? '⟳ Refreshing…' : '⟳ Refresh Prices'}
          </button>
          {refreshStatus && (
            <span style={{ fontSize: 12, color: G }}>{refreshStatus}</span>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && <div style={{ fontSize: 12, color: R, marginBottom: 12, padding: '6px 10px', background: `${R}10`, borderRadius: 0 }}> {error}</div>}

      {/* Symbol list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {symbolList.map(sym => {
          const symData = symbols[sym]
          const isExpanded = expandedSym === sym
          const glColor = symData.totalGainLoss >= 0 ? G : R
          // Lot prices are captured at import time. If any lot has no/zero
          // price (delisted or never-quoted symbol), the MV and gain math is
          // meaningless — show "stale price" instead of a bogus gain.
          const hasStalePrice = symData.lots.length > 0 &&
            symData.lots.some(l => !l.price || l.price <= 0)

          return (
            <div key={sym} style={{ border: `1px solid ${isExpanded ? G : 'var(--border2)'}`, borderRadius: 0, overflow: 'hidden' }}>
              {/* Symbol header */}
              <div 
                onClick={() => setExpandedSym(isExpanded ? null : sym)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', background: isExpanded ? `${G}08` : BG,
                  cursor: 'pointer', borderBottom: isExpanded ? `1px solid ${G}30` : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{sym}</span>
                  <span style={{ fontSize: 12, color: M }}>Acct {symData.account}</span>
                  {symData.lots.length === 0 && <span style={{ fontSize: 12, color: Y }}>(no lots)</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
                  <span style={{ color: M }}>{formatNumber(symData.totalQuantity)} shares</span>
                  {hasStalePrice ? (
                    <>
                      <span style={{ color: M }} title="One or more lots have no import price — market value unknown">— MV</span>
                      <span style={{ color: M }}>{formatCurrency(symData.totalCostBasis)} basis</span>
                      <span style={{
                        color: Y, fontWeight: 500, fontSize: 12,
                        padding: '1px 6px', border: `1px solid ${Y}50`, borderRadius: 0,
                      }} title="Gain/loss not computable — lot price missing or zero at import">
                        STALE PRICE
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: M }}>{formatCurrency(symData.totalMarketValue)} MV</span>
                      <span style={{ color: M }}>{formatCurrency(symData.totalCostBasis)} basis</span>
                      <span style={{ color: glColor, fontWeight: 500 }}
                        title="Computed from lot prices at import time — may differ from live market value">
                        {symData.totalGainLoss >= 0 ? '+' : ''}{formatCurrency(symData.totalGainLoss)}
                        {' '}({symData.totalGainLossPercent.toFixed(1)}%)
                      </span>
                    </>
                  )}
                  <button 
                    onClick={(e) => { e.stopPropagation(); removeSymbol(sym); }}
                    style={{ background: 'none', border: 'none', color: R, cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
                  >×</button>
                  <span style={{ fontSize: 12, color: M }}>{isExpanded ? '▼' : '▶'}</span>
                </div>
              </div>

              {/* Expanded content - Lots table */}
              {isExpanded && (
                <div style={{ padding: 12 }}>
                  {symData.lots.some(l => !l.acquiredDate) && (
                    <div style={{ fontSize: 12, color: R, marginBottom: 8, padding: '4px 8px', background: `${R}12`, borderRadius: 0 }}>
                       One or more lots are missing an acquired date — they will be excluded from tax calculations. Edit each lot to add the date.
                    </div>
                  )}
                  {/* Lots table */}
                  {symData.lots.length > 0 && (
                    <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto', marginBottom: 16 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: BG, position: 'sticky', top: 0 }}>
                            <th style={{ padding: '6px 8px', textAlign: 'left', color: M, fontSize: 12 }}>Acquired</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', color: M, fontSize: 12 }}>Qty</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', color: M, fontSize: 12 }}>Price</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', color: M, fontSize: 12 }}>Cost/Sh</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', color: M, fontSize: 12 }}>MV</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', color: M, fontSize: 12 }}>Basis</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', color: M, fontSize: 12 }}>G/L</th>
                            <th style={{ padding: '6px 8px', textAlign: 'center', color: M, fontSize: 12 }}>Term</th>
                            <th style={{ width: 40 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {symData.lots.map((lot, idx) => (
                            <tr key={idx} style={{ borderTop: '1px solid var(--border2)' }}>
                              <td style={{ padding: '4px 8px', background: !lot.acquiredDate ? `${R}18` : 'transparent' }}
                                title={!lot.acquiredDate ? 'Missing acquired date — lot excluded from tax calculations' : undefined}>
                                <input
                                  type="date"
                                  value={lot.acquiredDate}
                                  onChange={e => updateLot(sym, idx, { acquiredDate: e.target.value })}
                                  style={{ background: 'transparent', border: 'none', color: !lot.acquiredDate ? R : 'var(--text)', fontSize: 12, width: 100, outline: 'none' }}
                                />
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                <input
                                  type="number"
                                  value={lot.quantity}
                                  onChange={e => updateLot(sym, idx, { quantity: parseFloat(e.target.value) || 0 })}
                                  step="any"
                                  style={{ background: 'transparent', border: 'none', textAlign: 'right', width: 70, outline: 'none' }}
                                />
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                <input
                                  type="number"
                                  value={lot.price}
                                  onChange={e => updateLot(sym, idx, { price: parseFloat(e.target.value) || 0 })}
                                  step="0.01"
                                  style={{ background: 'transparent', border: 'none', textAlign: 'right', width: 60, outline: 'none' }}
                                />
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                <input
                                  type="number"
                                  value={lot.costPerShare}
                                  onChange={e => updateLot(sym, idx, { costPerShare: parseFloat(e.target.value) || 0 })}
                                  step="0.01"
                                  style={{ background: 'transparent', border: 'none', textAlign: 'right', width: 60, outline: 'none' }}
                                />
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', color: M }}>${formatNumber(lot.marketValue)}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', color: M }}>${formatNumber(lot.costBasis)}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', color: lot.gainLoss >= 0 ? G : R }}>
                                ${formatNumber(lot.gainLoss)} ({lot.gainLossPercent.toFixed(1)}%)
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                                <select
                                  value={lot.holdingPeriod}
                                  onChange={e => updateLot(sym, idx, { holdingPeriod: e.target.value as 'Short Term' | 'Long Term' })}
                                  style={{ background: P, border: '1px solid var(--fd-hairline)', fontSize: 12, padding: '2px 4px', borderRadius: 0 }}
                                >
                                  <option value="Short Term">ST</option>
                                  <option value="Long Term">LT</option>
                                </select>
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                                <button onClick={() => removeLot(sym, idx)} style={{ background: 'none', border: 'none', color: R, cursor: 'pointer' }}>×</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add new lot form */}
                  <div style={{ padding: 12, background: BG, borderRadius: 0, border: '1px solid var(--fd-hairline)' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: M, marginBottom: 8 }}> ADD PURCHASE LOT for {sym}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="date"
                        value={newLotForm.acquiredDate}
                        onChange={e => setNewLotForm({ ...newLotForm, acquiredDate: e.target.value })}
                        style={{ padding: '4px 8px', background: P, border: '1px solid var(--fd-hairline)', fontSize: 12, borderRadius: 0 }}
                      />
                      <input
                        type="number"
                        placeholder="Qty"
                        value={newLotForm.quantity || ''}
                        onChange={e => setNewLotForm({ ...newLotForm, quantity: parseFloat(e.target.value) || 0 })}
                        style={{ padding: '4px 8px', width: 80, background: P, border: '1px solid var(--fd-hairline)', fontSize: 12, borderRadius: 0 }}
                      />
                      <input
                        type="number"
                        placeholder="Price $"
                        value={newLotForm.price || ''}
                        onChange={e => setNewLotForm({ ...newLotForm, price: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        style={{ padding: '4px 8px', width: 80, background: P, border: '1px solid var(--fd-hairline)', fontSize: 12, borderRadius: 0 }}
                      />
                      <input
                        type="number"
                        placeholder="Cost/Sh $"
                        value={newLotForm.costPerShare || ''}
                        onChange={e => setNewLotForm({ ...newLotForm, costPerShare: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        style={{ padding: '4px 8px', width: 80, background: P, border: '1px solid var(--fd-hairline)', fontSize: 12, borderRadius: 0 }}
                      />
                      <select
                        value={newLotForm.holdingPeriod}
                        onChange={e => setNewLotForm({ ...newLotForm, holdingPeriod: e.target.value as "Short Term" | "Long Term" })}
                        style={{ padding: '4px 8px', background: P, border: '1px solid var(--fd-hairline)', fontSize: 12, borderRadius: 0 }}
                      >
                        <option value="Short Term">Short Term</option>
                        <option value="Long Term">Long Term</option>
                      </select>
                      <button
                        onClick={() => addLot(sym)}
                        style={{
                          padding: '4px 16px', fontSize: 12, fontWeight: 500,
                          background: 'var(--as-cobalt)', color: 'var(--as-warm-white)', border: 'none', borderRadius: 0, cursor: 'pointer',
                        }}
                      >
                        + Add Lot
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {symbolList.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: M, fontSize: 12 }}>
            No symbols found. Click "Create Symbol" or "Import CSV" to add holdings.
          </div>
        )}
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </div>
  )
}