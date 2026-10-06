import type { ReactNode } from 'react'
import { WsSection } from './WorkspaceContext'
import { useWorkspace } from './context'
import { SectionTitle, type Status } from '../ui/primitives'

/**
 * A workspace section for blocks that have no heading of their own: in the
 * Advanced workspace it adds a SectionTitle so the block reads standalone;
 * elsewhere it renders the children untouched.
 */
export function WsBlock({ id, title, meta, value, status, children }: {
  id: string; title: string; meta?: string; value?: string; status?: Status; children: ReactNode
}) {
  const { enabled } = useWorkspace()
  if (!enabled) return <>{children}</>
  return (
    <WsSection id={id} value={value} status={status}>
      <SectionTitle title={title} meta={meta} />
      {children}
    </WsSection>
  )
}
