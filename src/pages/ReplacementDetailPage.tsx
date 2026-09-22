import { AlertTriangle, ArrowDown, ArrowLeft, Check, CheckCircle2, Database, Link2, Search, ShieldAlert, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { replacementTone, validationTone } from '../components/statusTones'
import { allowedAreaIds, hasPermission } from '../config/access'
import { useDemo } from '../context/DemoContext'
import { areas } from '../data/demoData'
import { contractLabels, formatDate, getCandidateEligibility, getFulfillmentBlockers, hasCompleteSourceData, replacementLabels, validationLabels } from '../lib/businessRules'
import type { ReplacementNeed } from '../types'

const buildChain = (selected: ReplacementNeed, all: ReplacementNeed[]) => {
  let root = selected
  while (root.previousReplacementNeedId) {
    const previous = all.find((item) => item.id === root.previousReplacementNeedId)
    if (!previous) break
    root = previous
  }
  const chain: ReplacementNeed[] = [root]
  let cursor = root
  while (true) {
    const next = all.find((item) => item.previousReplacementNeedId === cursor.id)
    if (!next) break
    chain.push(next)
    cursor = next
  }
  return chain
}

export function ReplacementDetailPage() {
  const { needId } = useParams()
  const { currentUser, replacementNeeds, employees, projects, permissionConfig, matchCandidate, fulfillNeed } = useDemo()
  const [search, setSearch] = useState('')
  const need = replacementNeeds.find((item) => item.id === needId)
  const scopedAreas = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const candidates = useMemo(() => need ? employees.filter((employee) => employee.id !== need.originalEmployeeId && (!search || employee.name.toLowerCase().includes(search.toLowerCase()) || employee.personnelId.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => Number(getCandidateEligibility(need, b, replacementNeeds).eligible) - Number(getCandidateEligibility(need, a, replacementNeeds).eligible)) : [], [employees, need, replacementNeeds, search])
  if (!currentUser || !need || (scopedAreas !== null && (!need.areaId || !scopedAreas.includes(need.areaId)))) return <Navigate to="/replacements" replace />
  const original = employees.find((item) => item.id === need.originalEmployeeId)
  const replacement = employees.find((item) => item.id === need.replacementEmployeeId)
  const area = areas.find((item) => item.id === need.areaId)
  const project = projects.find((item) => item.id === need.projectId)
  const blockers = replacement ? getFulfillmentBlockers(replacement, need, replacementNeeds) : []
  const isComplete = ['FULFILLED', 'OVER_TARGET'].includes(need.status)
  const canMatch = hasPermission(currentUser, permissionConfig, 'match_replacement')
  const canFulfill = hasPermission(currentUser, permissionConfig, 'fulfill_replacement')
  const chain = buildChain(need, replacementNeeds)
  return <>
    <Link to="/replacements" className="back-link"><ArrowLeft /> Kembali ke Replacement Needs</Link>
    <PageHeader eyebrow={need.id.toUpperCase()} title={`Replacement untuk ${original?.name ?? 'Employee'}`} description="Pastikan kandidat sesuai Area, Project, dan Position sebelum melakukan matching." actions={<StatusBadge tone={replacementTone(need.status)}>{replacementLabels[need.status]}</StatusBadge>} />
    <div className="alert source"><Database /><div><strong>System output depends on the completeness and validity of source data.</strong><p>Data sumber tidak dapat disimpulkan oleh sistem apabila belum tersedia.</p></div></div>
    {!hasCompleteSourceData(need) && <div className="alert warning"><AlertTriangle /><div><strong>Matching dinonaktifkan karena data sumber belum lengkap</strong><p>Data sumber belum lengkap. Area, Project, dan Posisi harus dilengkapi oleh pihak pemilik data sebelum proses fulfillment dapat dilakukan.</p></div></div>}
    {chain.length > 1 && <section className="card chain-card"><div className="section-heading"><Link2 /><h2>Replacement Chain</h2></div><div className="replacement-chain">{chain.map((item, index) => { const source = employees.find((employee) => employee.id === item.originalEmployeeId); const target = employees.find((employee) => employee.id === item.replacementEmployeeId); return <div key={item.id}><span className="chain-person"><strong>{source?.name}</strong><small>Exit {formatDate(item.exitDate)}</small></span><ArrowDown /><span className={`chain-person ${target ? 'filled' : 'open'}`}><strong>{target?.name ?? 'Replacement masih open'}</strong><small>{target ? `${item.gapWorkingDays} hari kerja` : replacementLabels[item.status]}</small></span>{index < chain.length - 1 && <ArrowDown />}</div> })}</div></section>}
    <div className="replacement-overview"><section className="card need-card"><span>ORIGINAL EMPLOYEE</span><div className="person-large"><span className="initials large">{original?.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><div><h2>{original?.name}</h2><p>{original?.personnelId}</p></div></div><dl><div><dt>Area</dt><dd>{area?.name ?? 'Belum tersedia'}</dd></div><div><dt>Project</dt><dd>{project?.name ?? 'Belum tersedia'}</dd></div><div><dt>Position</dt><dd>{need.position ?? 'Belum tersedia'}</dd></div><div><dt>Exit Date</dt><dd>{formatDate(need.exitDate)}</dd></div></dl></section>
      <section className="card match-card"><span>MATCHING RESULT</span>{replacement ? <><div className="person-large"><span className="initials large green">{replacement.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><div><h2>{replacement.name}</h2><p>{replacement.personnelId}</p></div></div><div className="match-facts"><StatusBadge tone={validationTone(replacement.validationStatus)}>{validationLabels[replacement.validationStatus]}</StatusBadge><StatusBadge tone={replacement.contractStatus === 'SIGNED' ? 'success' : 'warning'}>{contractLabels[replacement.contractStatus]}</StatusBadge></div>{blockers.length > 0 && <div className="blocker-box"><ShieldAlert /><span><strong>Belum dapat fulfillment</strong>{blockers.map((reason) => <small key={reason}>{reason}</small>)}</span></div>}{!isComplete && canFulfill && <button className="button primary wide" disabled={blockers.length > 0} onClick={() => fulfillNeed(need.id)}><CheckCircle2 /> Mark as Fulfilled</button>}{isComplete && <div className="fulfilled-summary"><CheckCircle2 /><div><strong>{replacementLabels[need.status]}</strong><span>Join {formatDate(need.replacementJoinDate ?? replacement.joinDate)} · {need.gapWorkingDays} hari kerja sejak exit</span></div></div>}</> : <div className="no-match"><Link2 /><strong>Belum ada kandidat</strong><p>Pilih kandidat eligible dari daftar di bawah.</p></div>}</section>
    </div>
    <div className="rule-note"><strong>DEMO ASSUMPTION / TBC</strong><span>Fulfillment memakai JOIN DATE, kandidat tervalidasi, kontrak SIGNED, dan exact placement. Senin–Jumat dihitung; hari libur nasional belum termasuk.</span></div>
    <section className="card candidates-card"><div className="candidates-head"><div><h2>Candidate Matching</h2><p>Kandidat diurutkan berdasarkan kecocokan penempatan.</p></div><div className="search-box small-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari kandidat..." /></div></div><div className="candidate-list">{candidates.map((candidate) => { const result = getCandidateEligibility(need, candidate, replacementNeeds); const candidateArea = areas.find((item) => item.id === candidate.areaId); const candidateProject = projects.find((item) => item.id === candidate.projectId); const selected = candidate.id === need.replacementEmployeeId; return <article className={`candidate-row ${selected ? 'selected' : ''}`} key={candidate.id}><div className="candidate-person"><span className="initials">{candidate.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><div><strong>{candidate.name}</strong><small>{candidate.personnelId}</small></div></div><div className="candidate-placement"><span>{candidateArea?.name ?? 'Area kosong'}</span><span>{candidateProject?.name ?? 'Project kosong'}</span><span>{candidate.position ?? 'Posisi kosong'}</span></div><div className="candidate-contract"><small>Contract / Validation</small><span>{contractLabels[candidate.contractStatus]} · {validationLabels[candidate.validationStatus]}</span></div><div className="candidate-result">{result.eligible ? <><StatusBadge tone="success"><Check /> Eligible</StatusBadge><small>Placement sesuai</small></> : <><StatusBadge tone="danger"><XCircle /> Not Eligible</StatusBadge><small>{result.reasons.join(' · ')}</small></>}</div><button className={`button ${selected ? 'secondary' : 'primary'} compact-button`} disabled={!result.eligible || isComplete || !canMatch} onClick={() => matchCandidate(need.id, candidate.id)}>{selected ? 'Selected' : 'Pilih Kandidat'}</button></article> })}</div></section>
  </>
}
