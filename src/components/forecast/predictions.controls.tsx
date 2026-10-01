import { SegBtn, SegGroup } from '../ui/primitives'
import {
  BEAR_C, M,
  SCENARIO_META, HORIZONS,
  type Scenario, type Horizon,
} from './predictions.constants'

// ─── Scenario / Horizon toggles (v4 segmented controls) ───────────────────────
export function ScenarioToggle({ value, onChange }: { value: Scenario; onChange: (s: Scenario) => void }) {
  return (
    <SegGroup>
      {(['bear', 'base', 'bull'] as Scenario[]).map(s => (
        <SegBtn key={s} active={value === s} onClick={() => onChange(s)} title={SCENARIO_META[s].desc}>{s}</SegBtn>
      ))}
    </SegGroup>
  )
}

export function HorizonToggle({ value, onChange }: { value: Horizon; onChange: (h: Horizon) => void }) {
  return (
    <SegGroup>
      {HORIZONS.map(h => <SegBtn key={h} active={value === h} onClick={() => onChange(h)}>{h}Y</SegBtn>)}
    </SegGroup>
  )
}

// ─── Mode toggle button — V2 pill style ───────────────────────────────────────
// v4: segmented-control segment (see ui/primitives SegBtn)
export const ModeBtn = SegBtn

// Stress test button — used inline in the main tab but kept here for cohesion
export { BEAR_C, M }
