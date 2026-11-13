import type { ReactNode } from 'react'
import type { BadgeTone } from './statusTones'

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
