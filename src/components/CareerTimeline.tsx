import { ArrowRight, BriefcaseBusiness } from 'lucide-react'
import { useDemo } from '../context/DemoContext'
import { formatDate } from '../lib/businessRules'
import type { EmployeeMovement } from '../types'
import { StatusBadge } from './StatusBadge'

export function CareerTimeline({ records }: { records: EmployeeMovement[] }) {
  const { areas, projects } = useDemo()
  const areaName = (id: string | null) => areas.find((item) => item.id === id)?.name ?? '—'
  const projectName = (id: string | null) => projects.find((item) => item.id === id)?.name ?? '—'
  const sorted = [...records].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
  if (!sorted.length) return <div className="empty-inline">Belum ada structured movement history.</div>
  return <div className="career-timeline">{sorted.map((item) => {
    const placementChanged = item.previousAreaId || item.previousProjectId || item.previousPosition
    return <article className="career-record" key={item.id}><div className="career-date"><strong>{formatDate(item.effectiveDate)}</strong><span>{item.effectiveDate.slice(0, 4)}</span></div><span className="career-node"><BriefcaseBusiness /></span><div className="career-content"><StatusBadge tone={item.movementType === 'EXIT' ? 'danger' : item.movementType === 'REENTRY' ? 'purple' : item.movementType === 'PROMOTION' ? 'success' : 'info'}>{item.movementType.replaceAll('_', ' ')}</StatusBadge><h3>{item.notes}</h3>{placementChanged ? <div className="placement-shift"><span>{areaName(item.previousAreaId)} / {projectName(item.previousProjectId)} / {item.previousPosition ?? '—'}</span><ArrowRight /><strong>{areaName(item.newAreaId)} / {projectName(item.newProjectId)} / {item.newPosition ?? '—'}</strong></div> : <div className="placement-current">{areaName(item.newAreaId)} / {projectName(item.newProjectId)} / {item.newPosition ?? '—'}</div>}</div></article>
  })}</div>
}
