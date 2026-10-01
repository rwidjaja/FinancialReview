/**
 * TickerStrip — retired in v4. Holdings-today now lives in the Overview rail.
 * Kept as a no-op so unported tabs compile; remove usages as tabs are ported.
 */
import type { DashboardData } from '../../types/dashboard'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function TickerStrip(_props: { data: DashboardData }) {
  return null
}
