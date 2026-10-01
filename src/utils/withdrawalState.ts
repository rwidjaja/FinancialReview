/**
 * Withdrawal-state semantics — single source of truth for UI copy and gating.
 *
 * Everything here is derived from server-supplied config (`rules.json` →
 * `_WITHDRAWAL_STRATEGY.states`, surfaced as `tax_data.withdrawal_states`) and
 * the server's computed `tax_data.withdrawal_current_state`. Nothing about
 * State A/B/C behavior is hardcoded on the client: if the server sends no state
 * config, the accessors return `null` and callers must fall back to
 * state-neutral phrasing rather than assuming a state's rules.
 *
 * Motivation: panels used to hardcode State C wording (e.g. "TOTAL SPENDING
 * (STATE C)", "covered by controlled sales") and rendered it in every state,
 * which read as false whenever the server reported A or B.
 */
import type { ExtendedTaxData, WithdrawalStateDef, WithdrawalStateRules } from '../types/dashboard'

export type WithdrawalState = 'A' | 'B' | 'C'

export interface WithdrawalStateView {
  /** Server's computed state, or null when it hasn't reported one yet. */
  state: WithdrawalState | null
  /** Config entry for the current state (name + description + rules). */
  def: WithdrawalStateDef | null
  rules: WithdrawalStateRules | null
  /** Display label, e.g. "STATE B · HYBRID". Null when state is unknown. */
  label: string | null
  /** Tri-state capability flags — null means "config absent, do not assume". */
  allowControlledSale: boolean | null
  allowTrimmingIncomeEtfs: boolean | null
  /** Annual controlled-sale target band for this state, when configured. */
  saleTargetMin: number | null
  saleTargetMax: number | null
  /** Cash-bucket requirement in years, per this state's rules. */
  requiredBucketYears: number | null
}

/** Derive the current withdrawal state and its config-driven capabilities. */
export function getWithdrawalStateView(tx: ExtendedTaxData): WithdrawalStateView {
  const state = tx.withdrawal_current_state ?? null
  const def   = state != null ? (tx.withdrawal_states?.[state] ?? null) : null
  const rules = def?.rules ?? null

  return {
    state,
    def,
    rules,
    // Config `name` is the canonical descriptor (INCOME_DOMINANT / HYBRID /
    // CAPITAL_GAIN_DOMINANT); fall back to the bare letter if absent.
    label: state != null ? (def?.name ? `STATE ${state} · ${def.name}` : `STATE ${state}`) : null,
    allowControlledSale:     rules ? rules.allow_controlled_sale     : null,
    allowTrimmingIncomeEtfs: rules ? rules.allow_trimming_income_etfs : null,
    saleTargetMin:       rules?.controlled_sale_target_min ?? null,
    saleTargetMax:       rules?.controlled_sale_target_max ?? null,
    requiredBucketYears: rules?.required_bucket_years ?? null,
  }
}

/**
 * How a spending shortfall gets funded in the current state, as a short
 * sub-line. Returns null when the state or its rules are unknown, so callers
 * render nothing rather than an unfounded claim.
 *
 * States that permit controlled sales treat a shortfall as routine (it is the
 * designed funding path). States that forbid them do not: there the shortfall
 * has to come from cash reserves, which is worth flagging.
 */
export function shortfallFundingNote(v: WithdrawalStateView): string | null {
  if (v.allowControlledSale == null) return null
  if (v.allowControlledSale) {
    const band = v.saleTargetMin != null && v.saleTargetMax != null
      ? ` · target band ${fmtBandK(v.saleTargetMin)}–${fmtBandK(v.saleTargetMax)}/yr`
      : ''
    return `covered by controlled sales in State ${v.state} · not a crisis${band}`
  }
  return `State ${v.state} permits no controlled sales — fund from cash reserves or revisit the state`
}

/**
 * Whether a portfolio withdrawal in this state is expected to realize capital
 * gains (and therefore move quarterly AGI). True only where the state's rules
 * permit controlled sales. Null when unknown.
 */
export function withdrawalRealizesGains(v: WithdrawalStateView): boolean | null {
  return v.allowControlledSale
}

function fmtBandK(n: number): string {
  return `$${Math.round(n / 1000)}K`
}
