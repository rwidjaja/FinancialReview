// ── palette ───────────────────────────────────────────────────────────────────
export const G = 'var(--green)'
export const R = 'var(--red)'
export const A = 'var(--amber)'
export const M = 'var(--text2)'
export const B = 'var(--fd-accent)'
export const COLORS = ['var(--fd-accent)','var(--fd-lilac-ink)','var(--fd-lime-ink)','var(--fd-muted)','var(--fd-ink)','var(--fd-negative)','var(--fd-accent)','var(--fd-lilac-ink)']

// ── API helpers ───────────────────────────────────────────────────────────────
export const BASE = '/api/sim'
export async function apiFetch<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
  return d as T
}
export const GET  = <T,>(url: string) => apiFetch<T>(url)
export const POST = <T,>(url: string, body: unknown) =>
  apiFetch<T>(url, { method: 'POST', body: JSON.stringify(body) })
export const DEL  = <T,>(url: string) => apiFetch<T>(url, { method: 'DELETE' })
