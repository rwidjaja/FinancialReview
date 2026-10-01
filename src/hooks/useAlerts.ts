import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PriceAlert } from '../types/dashboard'

const BASE = '/api/alerts'

async function fetchAlerts(): Promise<PriceAlert[]> {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const d = await res.json()
  return d.alerts ?? []
}

export function useAlerts() {
  return useQuery<PriceAlert[]>({
    queryKey: ['price-alerts'],
    queryFn: fetchAlerts,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
}

export function useCreateAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      symbol: string; direction: 'above' | 'below'; mode: 'price' | 'pct'
      threshold: number; base_price: number; notes?: string
    }) => {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<PriceAlert>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  })
}

export function useUpdateAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }: Partial<PriceAlert> & { id: string }) => {
      const res = await fetch(`${BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<PriceAlert>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  })
}

export function useDeleteAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  })
}

export function useDismissAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/${id}/dismiss`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<PriceAlert>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  })
}
