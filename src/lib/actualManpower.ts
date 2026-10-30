import type { Area, Employee, EmployeeExit, EmployeeMovement, Project } from '../types'
import { evaluateEmploymentSnapshot, snapshotDateAt, type SnapshotExit } from './employmentSnapshot'
import { toBusinessKey } from './import/parse'
import type { ReviewItem } from './import/types'
import type { ExportWorkbookSheet } from './excelExport'

const UNMAPPED = 'Belum Dipetakan'
const REVIEW = 'Perlu Review'
const businessLabel = (value: string | null | undefined): string | null => {
  const text = value?.trim()
  return !text || ['-', 'n/a', 'belum tersedia', 'belum diisi', 'belum dipetakan'].includes(text.toLowerCase()) ? null : text
}

export interface ActualManpowerInput {
  /** Current masters before cross-storage collapse; historical source rows are not masters. */
  records: Employee[]
  exits: EmployeeExit[]
  movements?: EmployeeMovement[]
  reviewItems?: ReviewItem[]
  areas: Area[]
  projects: Project[]
  allowedAreas: string[] | null
  areaId?: string
  projectId?: string
  exportedAt: Date
}

export interface ActualManpowerRow {
  area: string
  subArea: string
  client: string
  project: string
  actual: number | null
  status: string
  reviewCount: number
  unidentifiedCount: number
  reason: string
}

/** Compare only identity/current-condition evidence. Never include personal values in the export. */
const placementSignature = (employee: Employee) => JSON.stringify([
  employee.areaId, employee.subArea?.trim() || null, employee.projectId,
  employee.position?.trim().toUpperCase() || null, employee.joinDate,
  employee.employmentStatus, employee.validationStatus, employee.conditionStatus ?? 'CONFIRMED',
])

export const buildActualManpowerSummary = (input: ActualManpowerInput) => {
  const { records, exits, movements = [], reviewItems = [], areas, projects, allowedAreas, areaId, projectId, exportedAt } = input
  const snapshot = snapshotDateAt(exportedAt)
  const areaById = new Map(areas.map((area) => [area.id, area]))
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const inScope = (employee: Employee) => (allowedAreas === null || Boolean(employee.areaId && allowedAreas.includes(employee.areaId)))
    && (!areaId || employee.areaId === areaId) && (!projectId || employee.projectId === projectId)
  const selected = records.filter(inScope)
  // Group BEFORE scope filtering so a duplicate with a conflicting out-of-scope
  // placement cannot be accepted merely because the second row is hidden.
  const groups = new Map<string, Employee[]>()
  for (const employee of records) {
    const key = toBusinessKey(employee.personnelId)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(employee)
    groups.set(key, group)
  }
  // A confirmed review has more precise exit scope/date than the legacy
  // profile-based inference. Real validated exit transactions remain intact.
  const reviewedExits = reviewItems.filter((item) => item.status === 'CONFIRMED' && item.resolution?.decisionKind === 'EXIT')
  const reviewedAliases = new Set(reviewedExits.flatMap((item) => (groups.get(toBusinessKey(item.businessKey)) ?? []).map((record) => record.id)))
  const snapshotExits: SnapshotExit[] = exits.filter((exit) => !exit.id.startsWith('import-assumed-exit-') || !reviewedAliases.has(exit.employeeId))
  const ambiguousExitKeys = new Set<string>()
  for (const item of reviewedExits) {
    const key = toBusinessKey(item.businessKey)
    if (!item.resolution?.exitScope) { ambiguousExitKeys.add(key); continue }
    if (item.resolution.exitScope === 'PLACEMENT_END') continue
    for (const record of groups.get(key) ?? []) snapshotExits.push({ employeeId: record.id, exitDate: item.resolution.effectiveDate ?? '', validationStatus: 'VALIDATED' })
  }
  const scopedKeys = new Set(selected.map((employee) => toBusinessKey(employee.personnelId)).filter(Boolean))
  const aggregation = new Map<string, ActualManpowerRow>()
  const add = (row: ActualManpowerRow) => {
    const key = JSON.stringify([row.area, row.subArea, row.client, row.project, row.status, row.reason])
    const existing = aggregation.get(key)
    if (existing) {
      if (existing.actual !== null && row.actual !== null) existing.actual += row.actual
      existing.reviewCount += row.reviewCount
      existing.unidentifiedCount += row.unidentifiedCount
    } else aggregation.set(key, { ...row })
  }
  const reviewRow = (count: number, reason: string) => add({ area: UNMAPPED, subArea: UNMAPPED, client: UNMAPPED, project: UNMAPPED, actual: null, status: REVIEW, reviewCount: count, unidentifiedCount: 0, reason })
  let duplicateGroups = 0
  let conflictingGroups = 0
  let active = 0
  let activeMapped = 0
  let activeUnmapped = 0
  let needsReview = 0
  let inactive = 0
  let activeClientConflicts = 0
  let excludedReview = 0
  for (const key of scopedKeys) {
    const group = groups.get(key)!
    if (group.length > 1) duplicateGroups++
    const nationalIds = new Set(group.map((employee) => toBusinessKey(employee.profile?.nationalId ?? '')).filter(Boolean))
    const signatures = new Set(group.map(placementSignature))
    if (nationalIds.size > 1 || signatures.size > 1) {
      conflictingGroups++
      needsReview++
      reviewRow(1, 'Identitas atau current master bertentangan')
      continue
    }
    // All records agree on placement/current state. Check exits for ALL internal
    // aliases so an exit linked to another storage's id is not lost.
    const employee = group[0]
    if (employee.conditionStatus === 'NEEDS_REVIEW') excludedReview++
    if (ambiguousExitKeys.has(key)) {
      needsReview++
      reviewRow(1, 'Review exit belum menentukan placement-end atau company-exit')
      continue
    }
    const employment = evaluateEmploymentSnapshot(group, snapshotExits, movements, snapshot)
    if (employment.status === 'NEEDS_REVIEW') {
      needsReview++
      reviewRow(1, employment.reason)
      continue
    }
    if (employment.status === 'INACTIVE') { inactive++; continue }
    const project = employee.projectId ? projectById.get(employee.projectId) : undefined
    const area = businessLabel(employee.areaId ? areaById.get(employee.areaId)?.name : null)
    const mismatch = Boolean(project && project.areaId !== employee.areaId)
    const normalizedClient = (value: string | null | undefined) => businessLabel(value)?.replace(/\s+/g, ' ').toUpperCase() ?? null
    const masterClient = normalizedClient(project?.clientName)
    const profileClients = new Set(group.map((record) => normalizedClient(record.profile?.clientName)).filter(Boolean))
    const clientConflict = profileClients.size > 1 || Boolean(masterClient && [...profileClients].some((client) => client !== masterClient))
    const historicalPlacementUnknown = employment.latestJoin !== employee.joinDate
    // Current master cannot establish the old placement before a future re-entry.
    // Restricted scopes must not claim an employee belongs to that scope then.
    if (historicalPlacementUnknown && (allowedAreas !== null || areaId || projectId)) {
      needsReview++
      reviewRow(1, 'Episode aktif diketahui, penempatan pada snapshot belum dapat dibuktikan dalam scope')
      continue
    }
    const reasons = [
      !area ? 'Area belum dipetakan' : '',
      !businessLabel(project?.name) ? 'Project belum dipetakan' : '',
      !masterClient ? 'Client belum dipetakan' : '',
      mismatch ? 'Area employee berbeda dari Master Project' : '',
      clientConflict ? 'Client profil berbeda dari Master Project/alias' : '',
      historicalPlacementUnknown ? 'Penempatan episode sebelumnya belum terbukti' : '',
    ].filter(Boolean)
    const unmapped = reasons.length > 0
    active++
    if (unmapped) activeUnmapped++; else activeMapped++
    if (clientConflict) activeClientConflicts++
    add({
      area: historicalPlacementUnknown ? UNMAPPED : area || UNMAPPED,
      subArea: historicalPlacementUnknown ? UNMAPPED : employee.subArea?.trim() || UNMAPPED,
      client: clientConflict || historicalPlacementUnknown ? UNMAPPED : businessLabel(project?.clientName) || UNMAPPED,
      project: historicalPlacementUnknown || mismatch ? UNMAPPED : businessLabel(project?.name) || UNMAPPED,
      actual: 1,
      status: unmapped ? 'Active Unmapped' : 'Active Mapped',
      reviewCount: 0,
      unidentifiedCount: 0,
      reason: reasons.join('; '),
    })
  }
  const withoutId = selected.filter((employee) => !toBusinessKey(employee.personnelId)).length
  if (withoutId) add({ area: UNMAPPED, subArea: UNMAPPED, client: UNMAPPED, project: UNMAPPED, actual: null, status: 'Record Tanpa Personnel ID', reviewCount: 0, unidentifiedCount: withoutId, reason: 'Belum dapat dihitung sebagai identitas unik' })
  const count = (test: (employee: Employee) => boolean) => selected.filter(test).length
  const quality: Array<[string, number, string]> = [
    ['Total employee records yang diperiksa', selected.length, 'Current master sebelum deduplikasi lintas storage; bukan jumlah source rows historis.'],
    ['Total Personnel ID unik', scopedKeys.size, 'Normalisasi mengikuti importer: rapikan spasi, trim, uppercase.'],
    ['Total Actual Active', active, 'Alias Total Active Confirmed; jangan dijumlahkan kembali.'],
    ['Total Active Confirmed', active, 'Personnel ID unik aktif berdasarkan episode kerja pada snapshot; sama dengan Mapped + Unmapped.'],
    ['Total Active Mapped', activeMapped, 'Aktif dengan Area/Client/Project konsisten. Sub Area kosong dilabeli terpisah tanpa menebak.'],
    ['Total Active Unmapped', activeUnmapped, 'Aktif terbukti, mapping belum lengkap/bertentangan; termasuk dalam Active Confirmed.'],
    ['Total Needs Review', needsReview, 'Identitas unik dengan identitas, validasi, episode, atau scope placement belum dapat dipastikan; tidak masuk Active Confirmed.'],
    ['Total Inactive / Belum Bergabung', inactive, 'Identitas unik dengan episode sudah berakhir atau join belum efektif.'],
    ['Record tanpa Personnel ID', withoutId, 'Satuan record, terpisah dari Total Needs Review yang bersatuan identitas unik.'],
    ['Kelompok Personnel ID duplikat', duplicateGroups, 'Satu kelompok dihitung satu kali; termasuk duplikat konsisten lintas storage.'],
    ['Kelompok identitas/status/penempatan konflik', conflictingGroups, 'Dikeluarkan dari Actual Active; tidak dipilih atau digabung otomatis.'],
    ['Employee dengan Area belum terisi', count((employee) => !employee.areaId), 'Jumlah record; kategori dapat tumpang tindih.'],
    ['Employee dengan Area tidak ditemukan', count((employee) => Boolean(employee.areaId && !areaById.has(employee.areaId))), 'Tidak dibuatkan mapping tebakan.'],
    ['Employee dengan Client belum terisi', count((employee) => !employee.projectId || !businessLabel(projectById.get(employee.projectId)?.clientName)), 'Client berasal dari Master Project; placeholder diperlakukan sebagai belum dipetakan.'],
    ['Employee dengan Project belum terisi', count((employee) => !employee.projectId), 'Actual yang memenuhi aturan aktif tetap terlihat di Belum Dipetakan.'],
    ['Employee dengan mapping project belum ditemukan', count((employee) => Boolean(employee.projectId && !projectById.has(employee.projectId))), 'Referensi tidak valid; tidak membuat project baru.'],
    ['Employee yang masih membutuhkan validasi', count((employee) => employee.validationStatus !== 'VALIDATED'), 'DRAFT, SUBMITTED, REVISION_REQUIRED tidak dihitung aktif.'],
    ['Employee berstatus NEEDS_REVIEW', count((employee) => employee.conditionStatus === 'NEEDS_REVIEW'), 'Tidak dihitung aktif.'],
    ['Identitas NEEDS_REVIEW tanpa konflik duplikat', excludedReview, 'Dikecualikan dari Actual Active.'],
    ['Record dengan Area berbeda dari Master Project', count((employee) => Boolean(employee.projectId && projectById.has(employee.projectId) && projectById.get(employee.projectId)!.areaId !== employee.areaId)), 'Tetap terlihat sebagai Mapping Perlu Review bila aktif.'],
    ['Record tanpa Join Date', count((employee) => !employee.joinDate), 'Perlu tanggal join atau riwayat JOIN/REENTRY yang dapat dibuktikan.'],
    ['Record tanpa Position', count((employee) => !businessLabel(employee.position)), 'Aturan aktif existing belum mewajibkan Position.'],
    ['Record dengan Client profil berbeda dari Master Project', count((employee) => Boolean(businessLabel(employee.profile?.clientName) && employee.projectId && businessLabel(projectById.get(employee.projectId)?.clientName) && employee.profile!.clientName!.trim().replace(/\s+/g, ' ').toUpperCase() !== projectById.get(employee.projectId)!.clientName.trim().replace(/\s+/g, ' ').toUpperCase())), 'Satuan record semua status; employee aktif terkait masuk Active Unmapped, Client tidak dipilih otomatis.'],
    ['Total Active dengan konflik Client', activeClientConflicts, 'Identitas unik; subset Active Unmapped, bukan tambahan ke Needs Review.'],
    ['Record dengan Join Date setelah tanggal export', count((employee) => Boolean(employee.joinDate && employee.joinDate > snapshot)), 'Join mendatang tidak memulai episode aktif pada snapshot. Riwayat episode sebelumnya tetap dievaluasi.'],
  ]
  const rows = [...aggregation.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'id-ID'))
  if (active !== activeMapped + activeUnmapped || scopedKeys.size !== active + inactive + needsReview
    || rows.reduce((sum, row) => sum + (row.actual ?? 0), 0) !== active
    || rows.reduce((sum, row) => sum + row.reviewCount, 0) !== needsReview) {
    throw new Error('Rekonsiliasi agregat Actual Manpower tidak konsisten.')
  }
  const references = projects.filter((project) => (allowedAreas === null || allowedAreas.includes(project.areaId))
    && (!areaId || project.areaId === areaId) && (!projectId || project.id === projectId))
  const sheets: ExportWorkbookSheet[] = [
    { name: 'Actual by Area & Project', headers: ['Area CBS', 'Sub Area', 'Client', 'Project', 'Actual Active', 'Status Rekap', 'Jumlah Perlu Review', 'Record Tanpa Personnel ID', 'Keterangan'],
      rows: rows.map((row) => [row.area, row.subArea, row.client, row.project, row.actual, row.status, row.reviewCount, row.unidentifiedCount, row.reason]) },
    { name: 'HR Project Reference', headers: ['Project ID', 'Client', 'Project Name', 'Area', 'Sub Area', 'Project Status'],
      rows: references.map((project) => [project.id, businessLabel(project.clientName) || UNMAPPED, businessLabel(project.name) || UNMAPPED, businessLabel(areaById.get(project.areaId)?.name) || UNMAPPED, project.subArea?.trim() || UNMAPPED, project.status]) },
    { name: 'Data Quality Summary', headers: ['Indikator', 'Jumlah', 'Catatan'], rows: quality },
    { name: 'Export Metadata', headers: ['Informasi', 'Keterangan'], rows: [
      ['Nama aplikasi', 'Gelatik HR Workforce Monitoring System'],
      ['Waktu export', exportedAt.toISOString()],
      ['Tanggal snapshot data', `Snapshot saat export: ${snapshot}`],
      ['Zona waktu snapshot', 'Asia/Jakarta; join inklusif, exit eksklusif (sudah tidak aktif pada tanggal exit).'],
      ['Filter Area', areaId ? areaById.get(areaId)?.name || UNMAPPED : 'Semua Area dalam scope'],
      ['Filter Project', projectId ? projectById.get(projectId)?.name || UNMAPPED : 'Semua Project dalam scope'],
      ['Scope Area', allowedAreas === null ? 'ALL_AREAS' : allowedAreas.map((id) => areaById.get(id)?.name || UNMAPPED).join(', ') || 'Tidak ada Area'],
      ['Filter tanggal', 'Date From/Date To pada halaman tidak diterapkan; export ini current snapshot.'],
      ['Sumber data', 'Current master localStorage dan IndexedDB browser, Master Area/Project, serta exit tervalidasi dan historical inference existing. Source rows historis bukan tambahan headcount.'],
      ['Definisi Actual Active', 'Personnel ID unik, VALIDATED, bukan NEEDS_REVIEW; episode JOIN/REENTRY terakhir yang sudah efektif belum ditutup exit tervalidasi pada snapshot.'],
      ['Aturan Join Date', 'Join <= snapshot. Riwayat JOIN/REENTRY dievaluasi per episode; tanggal kosong/invalid atau episode bertentangan masuk Needs Review.'],
      ['Aturan Exit Date', 'Hanya exit VALIDATED dengan join episode <= exit <= snapshot yang menutup episode. Exit mendatang tidak mengecualikan employee walau status sudah INACTIVE.'],
      ['Rekonsiliasi total', 'Active Confirmed = Active Mapped + Active Unmapped. Personnel ID unik = Active Confirmed + Inactive/Belum Bergabung + Needs Review. Record tanpa ID terpisah.'],
      ['Konflik Client', 'Perbedaan profil dan Master Project tidak diselesaikan otomatis; aktifnya tetap dihitung nasional dalam Active Unmapped. Client dikosongkan menjadi Belum Dipetakan.'],
      ['Batasan histori', 'Menggunakan tanggal dan riwayat yang tersedia; tidak mengklaim snapshot historis lengkap. Tanggal exit dan re-entry sama tanpa urutan masuk Needs Review.'],
      ['Review historis', 'Keputusan EXIT terkonfirmasi memakai effectiveDate dan exitScope. Placement-end tidak menutup employment. Inference profil digantikan untuk employee yang memiliki keputusan tersebut; transaksi exit resmi dipertahankan.'],
      ['Data belum dipetakan', 'Mapping kosong tidak menghapus Actual yang memenuhi aturan aktif. Perlu Review memakai Actual kosong, bukan nol.'],
      ['Kualitas data', 'Kategori masalah dapat tumpang tindih. Total Actual adalah confirmed subtotal; bukan sertifikasi bahwa seluruh data HR telah bersih.'],
      ['Privasi', 'Rekap agregat dan referensi project; tidak berisi identitas individu, source records, atau sheet tersembunyi.'],
      ['Kelompok Gelatik/BTB', 'Tidak diklasifikasikan karena tidak tersedia secara eksplisit pada master HR.'],
    ] },
  ]
  return { sheets, rows, actualActive: active, activeMapped, activeUnmapped, needsReview, inactive, conflictingGroups, withoutId, snapshotDate: snapshot }
}
