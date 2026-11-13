import { History, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CareerTimeline } from '../components/CareerTimeline'
import { PageHeader } from '../components/PageHeader'
import { useDemo } from '../context/DemoContext'
import { demoUsers } from '../data/demoData'
import { filterEmployeesForUser } from '../lib/businessRules'

export function MovementHistoryPage() {
  const { currentUser, areas, employees, projects, employeeMovements, permissionConfig } = useDemo()
  const user = currentUser ?? demoUsers[0]
  const [employeeId, setEmployeeId] = useState('employee-026')
  const [query, setQuery] = useState('')
  const visibleEmployees = useMemo(() => filterEmployeesForUser(user, employees, permissionConfig).filter((employee) => !query || employee.name.toLowerCase().includes(query.toLowerCase()) || employee.personnelId.toLowerCase().includes(query.toLowerCase())), [employees, permissionConfig, query, user])
  const selected = visibleEmployees.find((employee) => employee.id === employeeId) ?? visibleEmployees[0]
  const records = selected ? employeeMovements.filter((item) => item.employeeId === selected.id) : []
  const area = areas.find((item) => item.id === selected?.areaId)
  const project = projects.find((item) => item.id === selected?.projectId)
  return <>
    <PageHeader eyebrow="EMPLOYEE MOVEMENT" title="Career & Movement History" description="Current placement dan riwayat karier ditampilkan sebagai dua sumber informasi yang berbeda." />
    <div className="movement-workspace"><aside className="card movement-picker"><div className="search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari employee..." /></div><div>{visibleEmployees.map((employee) => <button className={selected?.id === employee.id ? 'active' : ''} key={employee.id} onClick={() => setEmployeeId(employee.id)}><span className="initials">{employee.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{employee.name}</strong><small>{employee.personnelId}</small></span></button>)}</div></aside><section className="card career-panel"><div className="career-profile"><span className="section-icon"><History /></span><div><h2>{selected?.name ?? 'Employee'}</h2><p>Current: {area?.name ?? '—'} · {project?.name ?? '—'} · {selected?.position ?? '—'}</p></div>{selected && <Link className="button secondary" to={`/employees/${selected.id}`}>Employee Detail</Link>}</div><CareerTimeline records={records} /></section></div>
  </>
}
