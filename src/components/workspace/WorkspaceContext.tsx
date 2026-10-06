/** Section wrapper for the Advanced workspace — see ./context.ts for the plumbing. */
import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Status } from '../ui/primitives'
import { WorkspaceContext, InsideSectionContext } from './context'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Inspect what the section actually rendered:
 *  - empty: no text and no chart/table/input → hidden from the rail
 *  - headed: it opens with its own heading (an h1–h3, or text starting with
 *    the rail title) → otherwise the workspace prints the rail title above it
 */
function inspect(el: HTMLElement, title: string | undefined) {
  const parts = [...el.children].filter(c => !(c as HTMLElement).dataset.wsAuto)
  const text = parts.map(c => c.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim()
  const empty = text === '' && !parts.some(c => c.querySelector('svg, canvas, img, input, select, table, textarea'))
  let headed = true
  if (title && !empty) {
    const h = parts.map(c => c.querySelector('h1, h2, h3')).find(Boolean)
    const before = h ? text.indexOf((h.textContent ?? '').replace(/\s+/g, ' ').trim()) : -1
    const startsWithTitle = norm(text.slice(0, title.length + 12)).startsWith(norm(title).slice(0, 12))
    headed = (h != null && before >= 0 && before < 40) || startsWithTitle
  }
  return { empty, headed }
}

export function WsSection({ id, value, status, title, group, children }: {
  id: string; value?: string; status?: Status; title?: string; group?: string; children: ReactNode
}) {
  const ws = useContext(WorkspaceContext)
  const { enabled, register, unregister } = ws
  const ref = useRef<HTMLDivElement>(null)
  const railTitle = ws.titleFor(id) ?? title
  const [shape, setShape] = useState({ empty: false, headed: true })

  // Re-inspect whenever the section's content changes (async data, toggles).
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const check = () => setShape(prev => {
      const next = inspect(el, railTitle)
      return prev.empty === next.empty && prev.headed === next.headed ? prev : next
    })
    check()
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => mo.disconnect()
  }, [enabled, railTitle])

  useLayoutEffect(() => {
    if (!enabled) return
    register(id, { value, status, title, group, empty: shape.empty })
  }, [enabled, register, id, value, status, title, group, shape.empty])
  useLayoutEffect(() => {
    if (!enabled) return
    return () => unregister(id)
  }, [enabled, unregister, id])

  const hidden = enabled && (shape.empty || (ws.visibleIds != null && !ws.visibleIds.has(id)))
  return (
    <InsideSectionContext.Provider value={true}>
      <div
        ref={ref}
        id={`sec-${id}`}
        data-ws-id={id}
        style={enabled
          ? { display: hidden ? 'none' : 'flex', flexDirection: 'column', gap: 16, minWidth: 0, scrollMarginTop: 140, order: ws.orderFor(id) }
          : { display: 'contents' }}
      >
        {enabled && !shape.headed && railTitle && (
          <h3 data-ws-auto="1" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.005em', margin: 0 }}>{railTitle}</h3>
        )}
        {children}
      </div>
    </InsideSectionContext.Provider>
  )
}
