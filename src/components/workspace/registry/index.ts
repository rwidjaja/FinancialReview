import type { TabId } from '../../layout/AppHeader'
import type { SectionMeta } from './types'
import { sections as overview } from './overview'
import { sections as roadmap } from './roadmap'
import { sections as portfolio } from './portfolio'
import { sections as risk } from './risk'
import { sections as returns } from './returns'
import { sections as tax } from './tax'
import { sections as cashflow } from './cashflow'
import { sections as forecast } from './forecast'
import { sections as drawdown } from './drawdown'
import { sections as simulate } from './simulate'
import { sections as research } from './research'
import { sections as trade_sim } from './trade_sim'
import { sections as ai } from './ai'
import { sections as balance_history } from './balance_history'
import { sections as settings } from './settings'

export type { SectionMeta } from './types'

export const SECTION_REGISTRY: Record<TabId, SectionMeta[]> = {
  overview, roadmap, portfolio, risk, returns, tax, cashflow, forecast,
  drawdown, simulate, research, trade_sim, ai, balance_history, settings,
}
