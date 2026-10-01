/**
 * DrawdownPlanContext — shared source of truth for the Drawdown tab's plan
 * inputs (income target, Roth conversion toggle, etc.) and the resulting
 * current-year Annual Decision (from_taxable cash need).
 *
 * Lives above both the Drawdown tab and the Tax tab in the component tree so
 * that Tax tab's "Sell & Rebalance" section can size its sell plan to the
 * same taxable-account withdrawal need the Drawdown tab is showing — and
 * stays in sync when the user adjusts sliders in Drawdown, even after
 * switching tabs (tabs unmount; this context does not).
 */
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { DashboardData } from '../types/dashboard'
import {
  buildDrawdownInputs,
  buildAnnualDecisionInputs,
  computeAnnualDecision,
  type DrawdownInputs,
  type AnnualDecisionResult,
} from '../components/drawdown/drawdown.engine'

interface DrawdownPlanContextValue {
  inputs: DrawdownInputs
  updateInput: <K extends keyof DrawdownInputs>(k: K, v: DrawdownInputs[K]) => void
  annualDecision: AnnualDecisionResult
}

const DrawdownPlanContext = createContext<DrawdownPlanContextValue | null>(null)

export function DrawdownPlanProvider({ data, children }: { data: DashboardData; children: ReactNode }) {
  const [inputs, setInputs] = useState<DrawdownInputs>(() => buildDrawdownInputs(data))

  const updateInput = useCallback(<K extends keyof DrawdownInputs>(k: K, v: DrawdownInputs[K]) => {
    setInputs(prev => ({ ...prev, [k]: v }))
  }, [])

  const annualDecision = useMemo(() => {
    const decisionInputs = buildAnnualDecisionInputs(data, inputs.income_target, {
      do_roth_conversion: inputs.do_roth_conversion,
    })
    return computeAnnualDecision(decisionInputs)
  }, [data, inputs.income_target, inputs.do_roth_conversion])

  const value = useMemo(
    () => ({ inputs, updateInput, annualDecision }),
    [inputs, updateInput, annualDecision],
  )

  return (
    <DrawdownPlanContext.Provider value={value}>
      {children}
    </DrawdownPlanContext.Provider>
  )
}

export function useDrawdownPlan(): DrawdownPlanContextValue {
  const ctx = useContext(DrawdownPlanContext)
  if (!ctx) throw new Error('useDrawdownPlan must be used within a DrawdownPlanProvider')
  return ctx
}
