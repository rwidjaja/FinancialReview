/**
 * Static section metadata per tab — the single source for the Advanced rail,
 * the focus pager and global Find. Metadata only (no components), so App.tsx
 * can import every tab's list without pulling the lazy tab chunks.
 *
 * `id` must match the <WsSection id> rendered by the tab. `keys` are the
 * metric/row labels inside the section; they are what lets Find resolve
 * "IRMAA" or "bracket room" to a section. `sub` names the tab's internal
 * sub-tab the section lives on (the rail switches sub-tab when needed).
 */
export interface SectionMeta {
  id: string
  group: string
  title: string
  adv?: boolean
  keys?: string[]
  sub?: string
}
