import type { TabId } from '../../layout/AppHeader'
import type { SectionMeta } from './types'
import { sections as overview } from './overview'
import { sections as roadmap } from './roadmap'
import { sections as portfolio } from './portfolio'
import { sections as risk } from './risk'
import { sections as returns } from './returns'
import { sections as tax, subTabs as taxSubs } from './tax'
import { sections as cashflow } from './cashflow'
import { sections as forecast } from './forecast'
import { sections as drawdown, subTabs as drawdownSubs } from './drawdown'
import { sections as simulate, subTabs as simulateSubs } from './simulate'
import { sections as research, subTabs as researchSubs } from './research'
import { sections as trade_sim, subTabs as trade_simSubs } from './trade_sim'
import { sections as ai } from './ai'
import { sections as balance_history } from './balance_history'
import { sections as settings } from './settings'

export type { SectionMeta, SubTabMeta } from './types'
import type { SubTabMeta } from './types'

export const SECTION_REGISTRY: Record<TabId, SectionMeta[]> = {
  overview, roadmap, portfolio, risk, returns, tax, cashflow, forecast,
  drawdown, simulate, research, trade_sim, ai, balance_history, settings,
}

/** Tabs whose rail is scoped to one sub-tab at a time. */
export const SUBTAB_REGISTRY: Partial<Record<TabId, SubTabMeta[]>> = {
  tax: taxSubs, research: researchSubs, drawdown: drawdownSubs, simulate: simulateSubs, trade_sim: trade_simSubs,
}
