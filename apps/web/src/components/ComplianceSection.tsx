import { CalendarClock, CalendarX2, FileClock, FileWarning, FileX2, HelpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Schemas } from '../api/client'
import { useApiResource } from '../hooks/useApiResource'
import { formatDate } from '../lib/businessRules'

/**
 * Contract and document KPIs from GET /dashboard/compliance (aggregated on the server
 * after scope). Each card names its unit and opens the matching detail list. The
 * dashboard period filter does not apply here; only Area does.
 */
export function ComplianceSection({ areaId }: { areaId: string }) {
  const res = useApiResource<Schemas['ComplianceSummary']>('/dashboard/compliance', { areaId })
  const qs = areaId ? `&areaId=${encodeURIComponent(areaId)}` : ''
  if (res.loading && !res.data) return <section className="card contract-reminder"><p className="empty-inline">Memuat monitoring kontrak & dokumen…</p></section>
  if (res.error) return <section className="card contract-reminder"><div className="alert error"><div><strong>Monitoring kontrak & dokumen tidak dapat dimuat</strong><p>{res.error}</p></div><button className="button ghost" onClick={res.reload}>Coba lagi</button></div></section>
  const data = res.data
  if (!data || (!data.contracts && !data.employeeDocuments)) return null
  const c = data.contracts, d = data.employeeDocuments
  const card = (to: string, Icon: typeof CalendarClock, value: number | undefined, label: string, unit: string) =>
    <Link to={to} key={label}><span><Icon size={15} /> {label}</span><strong>{value ?? 'Belum ada data'}</strong><small>{unit}</small></Link>
  return <section className="card contract-reminder"><div className="chart-heading"><div><h2>Monitoring Kontrak & PKWT</h2>
    <p>Tanggal bisnis {formatDate(data.businessDate)} (Asia/Jakarta). Filter yang berlaku: Area{areaId ? '' : ' (semua area dalam cakupan Anda)'}; periode dashboard tidak berlaku untuk kartu ini.</p></div></div>
    {c && <><h3 className="compliance-group-title">Kontrak <small>· pengingat {c.reminderDays.join(' / ')} hari sebelum tanggal berakhir</small></h3>
      <div className="contract-categories compliance">
        {card(`/contracts?status=EXPIRING${qs}`, CalendarClock, c.summary.monitored ? c.summary.expiring : undefined, 'Akan berakhir', `personel · ≤ ${c.reminderDays[0]} hari lagi`)}
        {card(`/contracts?status=EXPIRED${qs}`, CalendarX2, c.summary.monitored ? c.summary.expired : undefined, 'Sudah berakhir', 'personel aktif · tanggal berakhir terlewati')}
        {card(`/contracts?status=INCOMPLETE${qs}`, HelpCircle, c.summary.monitored ? c.summary.incomplete : undefined, 'Data kontrak belum lengkap', 'personel · tanggal berakhir kosong/tidak valid')}
      </div>
      <p className="compliance-note">Dihitung dari {c.summary.monitored} personel aktif & tervalidasi (satu kontrak berjalan per personel). Indikator “4 tahun” belum ditampilkan sampai maknanya dikonfirmasi.</p></>}
    {d && <><h3 className="compliance-group-title">PKWT karyawan <small>· peringatan saja, tidak menghalangi validasi</small></h3>
      <div className="contract-categories compliance">
        {card(`/documents?status=MISSING${qs}`, FileWarning, d.monitored ? d.missing : undefined, 'PKWT belum diunggah', 'karyawan aktif')}
        {card(`/documents?status=PENDING${qs}`, FileClock, d.monitored ? d.pending : undefined, 'Menunggu pemeriksaan', 'karyawan · PKWT sudah diunggah')}
        {card(`/documents?status=REJECTED${qs}`, FileX2, d.monitored ? d.rejected : undefined, 'PKWT ditolak', 'karyawan · perlu unggah ulang')}
      </div>
      <p className="compliance-note">Dihitung dari {d.monitored} karyawan aktif dalam cakupan.</p></>}
  </section>
}
