import { useState } from 'react'
import type { LimitOrder } from './types'

const LO_KEY = 'tradsim-limit-orders'

export function useLimitOrders() {
  const [orders, setOrders] = useState<LimitOrder[]>(() => {
    try { return JSON.parse(localStorage.getItem(LO_KEY) ?? '[]') } catch { return [] }
  })
  const save = (next: LimitOrder[]) => {
    setOrders(next)
    localStorage.setItem(LO_KEY, JSON.stringify(next))
  }
  return {
    orders,
    addOrder:    (o: LimitOrder) => save([...orders, o]),
    updateOrder: (id: string, patch: Partial<LimitOrder>) =>
      save(orders.map(o => o.id === id ? { ...o, ...patch } : o)),
    cancelOrder: (id: string) =>
      save(orders.map(o => o.id === id ? { ...o, status: 'CANCELLED' as const } : o)),
  }
}
