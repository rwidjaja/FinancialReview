// ── API hooks ─────────────────────────────────────────────────────────────────

import { useQuery } from '@tanstack/react-query'
import type { ResearchApiData, EtfComponentData } from './researchTypes'

async function fetchResearch(symbol: string): Promise<ResearchApiData> {
  const res = await fetch(`/api/research?symbol=${symbol}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function useResearch(symbol: string | null) {
  return useQuery<ResearchApiData>({
    queryKey: ['research', symbol],
    queryFn: () => fetchResearch(symbol!),
    enabled: symbol != null && symbol !== '',
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}

async function fetchEtfComponents(symbol: string): Promise<EtfComponentData> {
  const res = await fetch(`/api/research/components?symbol=${symbol}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function useEtfComponents(symbol: string | null, eligible: boolean) {
  return useQuery<EtfComponentData>({
    queryKey: ['etf-components', symbol],
    queryFn: () => fetchEtfComponents(symbol!),
    enabled: eligible && symbol != null && symbol !== '',
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}
