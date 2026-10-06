/** Section wrapper for the Advanced workspace — see ./context.ts for the plumbing. */
import { useContext, useLayoutEffect, type ReactNode } from 'react'
import type { Status } from '../ui/primitives'
import { WorkspaceContext, InsideSectionContext } from './context'

export function WsSection({ id, value, status, title, group, children }: {
  id: string; value?: string; status?: Status; title?: string; group?: string; children: ReactNode
}) {
  const ws = useContext(WorkspaceContext)
  const { enabled, register, unregister } = ws

  useLayoutEffect(() => {
    if (!enabled) return
    register(id, { value, status, title, group })
  }, [enabled, register, id, value, status, title, group])
  useLayoutEffect(() => {
    if (!enabled) return
    return () => unregister(id)
  }, [enabled, unregister, id])

  const hidden = enabled && ws.layout === 'focus' && ws.activeId !== id
  return (
    <InsideSectionContext.Provider value={true}>
      <div
        id={`sec-${id}`}
        data-ws-id={id}
        style={enabled
          ? { display: hidden ? 'none' : 'flex', flexDirection: 'column', gap: 16, minWidth: 0, scrollMarginTop: 140 }
          : { display: 'contents' }}
      >
        {children}
      </div>
    </InsideSectionContext.Provider>
  )
}

