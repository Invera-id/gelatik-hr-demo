import { useState } from 'react'
import { AlertCircle, GitCompareArrows, History, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { useDemo } from '../../context/DemoContext'
import { allowedAreaIds } from '../../config/access'
import { formatGeneratedAt, formatSnapshotDate, groups, selectSnapshot, summarizeGroup, summarizeQuality } from './calculations'
import { demoSnapshots, findDemoSnapshot } from './snapshots'
import type { ComparisonFilters, ComparisonRow } from './types'
import './financeTargetActual.css'

const number = (value: number | null) => value === null ? 'N/A' : new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)
const gap = (value: number | null) => value !== null && value > 0 ? `+${number(value)}` : number(value)
const rate = (value: number | null) => value === null ? 'N/A' : `${number(value)}%`
const unique = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b))
const statusTone = (row: ComparisonRow) => row.status === 'MAPPED' ? 'success' : row.status.includes('EXPIRED') ? 'danger' : 'warning'

/** Reads only auth/scope/reference labels. Never reads employees or writes HR state. */
export function FinanceTargetActualPage() {
  const { currentUser, permissionConfig, areas } = useDemo()
  const ids = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const allowedAreas = ids === null ? null : unique(demoSnapshots.flatMap((snapshot) => snapshot.rows.map((row) => row.areaCBS)))
    .filter((label) => areas.some((area) => ids.includes(area.id) && area.name.trim().toUpperCase() === label.toUpperCase()))
  return <FinanceTargetActualView allowedAreas={allowedAreas} />
}

export function FinanceTargetActualView({ allowedAreas = null }: { allowedAreas?: readonly string[] | null }) {
  const [date, setDate] = useState('2026-11-20')
  const [filters, setFilters] = useState<ComparisonFilters>({ sourceGroup: '', areaCBS: '', client: '', project: '' })
  const snapshot = findDemoSnapshot(date)
  const selected = snapshot ? selectSnapshot(snapshot, filters, allowedAreas) : { rows: [], quality: [] }
  const options = snapshot ? selectSnapshot(snapshot, { sourceGroup: filters.sourceGroup }, allowedAreas).rows : []
  const areaOptions = unique(options.map((row) => row.areaCBS))
  const clientRows = options.filter((row) => !filters.areaCBS || row.areaCBS === filters.areaCBS)
  const clientOptions = unique(clientRows.map((row) => row.client))
  const projectOptions = unique(clientRows.filter((row) => !filters.client || row.client === filters.client).map((row) => row.project))
  const quality = summarizeQuality(selected.rows, selected.quality)
  const shownGroups = groups.filter((group) => !filters.sourceGroup || filters.sourceGroup === group)
  const population = quality.comparable + quality.unmapped + quality.expired + quality.otherNoncomparable
  return <div className="finance-comparison">
    <PageHeader eyebrow="SIMULASI REKONSILIASI" title="Finance Target vs Actual" description="Bandingkan alokasi manpower Finance dengan Actual HR pada bucket Area CBS–Client–Project yang sepadan." actions={<span className="badge badge-info">PROTOTYPE · DATA SINTETIS</span>} />
    <div className="alert info"><GitCompareArrows /><div><strong>Modul simulasi terpisah dari data HR dan Client Quota</strong><p>Resolusi snapshot: DATE · Asia/Jakarta. Data tidak tersinkronisasi lintas pengguna. Bukan data aktual perusahaan, bukan akurasi intraday. Semua business rule masih provisional.</p></div></div>
    <section className="card finance-filters" aria-label="Filter comparison">
      <label>Snapshot Date<input aria-label="Snapshot Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label>Source Group<select aria-label="Source Group" value={filters.sourceGroup} onChange={(event) => setFilters({ sourceGroup: event.target.value as ComparisonFilters['sourceGroup'], areaCBS: '', client: '', project: '' })}><option value="">Semua Group — rekap terpisah</option>{groups.map((group) => <option key={group}>{group}</option>)}</select></label>
      <label>Area CBS<select aria-label="Area CBS" value={filters.areaCBS} onChange={(event) => setFilters({ ...filters, areaCBS: event.target.value, client: '', project: '' })}><option value="">Semua Area dalam scope</option>{areaOptions.map((area) => <option key={area}>{area}</option>)}</select></label>
      <label>Client<select aria-label="Client" value={filters.client} onChange={(event) => setFilters({ ...filters, client: event.target.value, project: '' })}><option value="">Semua Client</option>{clientOptions.map((client) => <option key={client}>{client}</option>)}</select></label>
      <label>Project<select aria-label="Project" value={filters.project} onChange={(event) => setFilters({ ...filters, project: event.target.value })}><option value="">Semua Project</option>{projectOptions.map((project) => <option key={project}>{project}</option>)}</select></label>
    </section>
    <p className="finance-caption">Evidence tersedia: 15, 20, dan 25 November 2026. Join inklusif; exit tidak aktif pada tanggal efektifnya. Akhir kontrak memakai batas eksklusif untuk simulasi.</p>
    {!snapshot ? <section className="card empty-state" role="status"><AlertCircle /><strong>Snapshot belum tersedia</strong><span>Tanggal ini belum memiliki evidence sintetis atau hasil tersimpan. Tidak dihitung dari current master.</span></section> : <>
      <p className="finance-caption">Kondisi: <strong>{formatSnapshotDate(snapshot.snapshotDate)}</strong> · Dibuat: {formatGeneratedAt(snapshot.generatedAt)} · {snapshot.ruleVersion}</p>
      {shownGroups.map((group) => {
        const summary = summarizeGroup(selected.rows, group)
        const metrics = [
          { title: 'Finance Target', value: number(summary.target), note: 'Alokasi pada bucket comparable' },
          { title: 'Confirmed Actual Comparable', value: number(summary.actual), note: 'Personnel ID sintetis unik, tanpa konflik' },
          { title: 'Gap', value: gap(summary.gap), note: 'Target − Actual; positif = kekurangan' },
          { title: 'Manpower Fulfillment Rate', value: rate(summary.rate), note: 'Actual ÷ Target; N/A bila target 0/NULL' },
        ]
        return <section className="finance-group" aria-label={`Ringkasan ${group}`} key={group}>
          <div className="finance-section-head"><h2>{group}</h2><span>Comparable coverage: {summary.comparableBuckets} / {summary.totalBuckets} bucket</span></div>
          <div className="kpi-grid">{metrics.map((metric) => <article className="card kpi-card" key={metric.title}><div className="kpi-top"><span className="kpi-icon"><GitCompareArrows /></span><small>{group} · DEMO</small></div><strong>{metric.value}</strong><h3>{metric.title}</h3><p>{metric.note}</p></article>)}</div>
          {!summary.comparableBuckets && <p className="finance-caption">Belum ada bucket comparable pada filter ini; N/A tidak berarti nol employee.</p>}
        </section>
      })}
      <p className="finance-caption">Tidak ada grand total resmi gabungan Gelatik + BTB. KPI hanya mencakup bucket comparable, bukan seluruh budget atau seluruh populasi HR.</p>
      <section className="card finance-quality" aria-label="Kualitas data comparison">
        <div className="finance-section-head"><h2><ShieldCheck size={18} /> Kualitas data comparison</h2><span>Distinct evidence sintetis · filter aktif</span></div>
        <dl className="finance-quality-grid">
          <div><dt>Active Unmapped for Comparison</dt><dd>{quality.unmapped}</dd></div>
          <div><dt>Needs Review · identitas</dt><dd>{quality.needsReview}</dd></div>
          <div><dt>Target Unknown · bucket</dt><dd>{quality.targetUnknownBuckets}</dd></div>
          <div><dt>Expired Contract Remaining Actual</dt><dd>{quality.expired}</dd></div>
          <div><dt>Unresolved Group · identitas</dt><dd>{quality.unresolvedGroup}</dd></div>
          <div><dt>Comparable Coverage · bucket</dt><dd>{quality.comparableBuckets} / {quality.totalBuckets}</dd></div>
        </dl>
        <p>Populasi comparison aktif terbukti: {population} = comparable {quality.comparable} + unmapped {quality.unmapped} + expired {quality.expired} + noncomparable lainnya {quality.otherNoncomparable}. Needs Review ({quality.needsReview}) terpisah, tidak termasuk populasi ini.</p>
        <p>Unresolved Group merupakan subset unmapped/review, bukan tambahan orang. Target Unknown dan coverage memakai satuan bucket. Jangan menjumlahkan counter lintas kategori. Konflik lintas bucket tetap direview walaupun filter memilih salah satu bucket.</p>
      </section>
      <section className="card table-card finance-detail" aria-label="Detail comparison">
        <div className="table-title"><div><h2>Detail Target vs Actual</h2><p>HR Aktif Teramati juga menampilkan data noncomparable. NULL/N/A bukan explicit 0. GMR hanya informasi, bukan dimensi perhitungan.</p></div></div>
        <div className="table-scroll"><table><thead><tr>{['Source Group', 'Area CBS', 'Client', 'Project', 'Finance Target', 'HR Aktif Teramati', 'HR Actual Comparable', 'Gap', 'Fulfillment Rate', 'Mapping Status', 'Contract Status', 'Status / Catatan'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>
          {selected.rows.map((row) => <tr key={row.id}>
            <td>{row.sourceGroup ?? 'Unresolved Group'}</td><td>{row.areaCBS ?? 'Belum Dipetakan'}</td><td>{row.client ?? 'Belum Dipetakan'}</td><td><strong>{row.project ?? 'Belum Dipetakan'}</strong>{row.isProvisional && <small>PROVISIONAL · effective date fallback approval: {row.effectiveDate ?? 'Belum ditentukan'}</small>}</td>
            <td>{row.targetValue === null ? <span className="missing-text">Belum diisi (NULL)</span> : number(row.targetValue)}</td><td>{row.observedActual}</td><td>{number(row.actualComparable)}</td><td className={row.gap !== null && row.gap > 0 ? 'finance-shortage' : ''}>{gap(row.gap)}</td><td>{rate(row.rate)}</td>
            <td><span className={`badge badge-${statusTone(row)}`}>{row.mappingStatus}</span></td><td>{row.contractStatus}</td><td><span className={`badge badge-${statusTone(row)}`}>{row.status}</span><small>{row.reason}</small></td>
          </tr>)}
          {!selected.rows.length && <tr><td colSpan={12}>Tidak ada bucket pada filter/scope ini.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
    <section className="card finance-history" aria-label="Riwayat snapshot demo">
      <div className="finance-section-head"><h2><History size={18} /> Riwayat snapshot demo</h2><span>Immutable · simulasi tersimpan dalam aplikasi</span></div>
      <p>Hasil beku, bukan query ulang Employee Master. Filter Group/Area/Client/Project diterapkan pada hasil tersimpan. Tidak ada sinkronisasi server atau penyimpanan snapshot baru pada Phase 1.</p>
      {shownGroups.map((group) => {
        const history = demoSnapshots.map((stored) => ({ stored, summary: summarizeGroup(selectSnapshot(stored, filters, allowedAreas).rows, group) }))
        const maximum = Math.max(1, ...history.flatMap(({ summary }) => [summary.target ?? 0, summary.actual ?? 0]))
        return <section className="finance-history-group" key={group} aria-label={`Histori ${group}`}><h3>{group}</h3><div className="finance-history-grid">{history.map(({ stored, summary }) => <button type="button" className={`finance-snapshot ${date === stored.snapshotDate ? 'selected' : ''}`} key={stored.id} onClick={() => { setDate(stored.snapshotDate); setFilters({ ...filters, sourceGroup: group }) }} aria-label={`Buka snapshot ${stored.snapshotDate} ${group}`}>
          <strong>{formatSnapshotDate(stored.snapshotDate)}</strong>
          <span className="finance-bar-label">Target {number(summary.target)}</span><span className="finance-bar-track" aria-hidden="true"><span className="finance-bar target" style={{ width: `${(summary.target ?? 0) / maximum * 100}%` }} /></span>
          <span className="finance-bar-label">Actual {number(summary.actual)}</span><span className="finance-bar-track" aria-hidden="true"><span className="finance-bar actual" style={{ width: `${(summary.actual ?? 0) / maximum * 100}%` }} /></span>
          <span>Gap {gap(summary.gap)} · Rate {rate(summary.rate)}</span>
          <small>Dibuat {formatGeneratedAt(stored.generatedAt)}<br />{stored.timezone} · Resolusi {stored.resolution}<br />{stored.ruleVersion}<br />{stored.sourceRevision} · {summary.comparableBuckets}/{summary.totalBuckets} comparable</small>
        </button>)}</div></section>
      })}
    </section>
    <div className="rule-note compact-note"><strong>PROVISIONAL DESIGN · TBC bersama Gelatik</strong><span>Alokasi target, pemetaan Group, batas kontrak, approval Finance/HR, dan effective date fallback perlu konfirmasi. Phase 2: import target, mapping, versi. Phase 3: backend, event historis bertimestamp, audit dan sinkronisasi.</span></div>
  </div>
}
