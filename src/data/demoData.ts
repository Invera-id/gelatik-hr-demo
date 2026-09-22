import type { Area, DemoData, DemoUser, Employee, EmployeeMovement, PlacementChangeRequest, Project } from '../types'
import { cloneDefaultPermissions, defaultValidationPolicy } from '../config/access'

export const areas: Area[] = [
  { id: 'area-bandung', name: 'Bandung' },
  { id: 'area-semarang', name: 'Semarang' },
  { id: 'area-jakarta', name: 'Jakarta' },
]

export const projects: Project[] = [
  { id: 'project-alpha-bandung', name: 'Project Alpha Bandung', clientName: 'PT Arunika Niaga', areaId: 'area-bandung', subArea: 'Bandung Raya', status: 'ACTIVE', startDate: '2024-01-01', endDate: null },
  { id: 'project-beta-bandung', name: 'Project Beta Bandung', clientName: 'PT Bintang Retail', areaId: 'area-bandung', subArea: 'Bandung Timur', status: 'ACTIVE', startDate: '2024-06-01', endDate: null },
  { id: 'project-alpha-semarang', name: 'Project Alpha Semarang', clientName: 'PT Arunika Niaga', areaId: 'area-semarang', subArea: 'Semarang Kota', status: 'ACTIVE', startDate: '2024-01-01', endDate: null },
  { id: 'project-gamma-jakarta', name: 'Project Gamma Jakarta', clientName: 'PT Cakrawala Distribusi', areaId: 'area-jakarta', subArea: 'Jakarta Pusat', status: 'ACTIVE', startDate: '2025-01-01', endDate: null },
]

export const projectQuotas = projects.flatMap((project, index) => [
  { id: `quota-${index}-2026-07`, projectId: project.id, period: '2026-07', quota: [12, 9, 10, 13][index] },
  { id: `quota-${index}-2026-08`, projectId: project.id, period: '2026-08', quota: [13, 10, 11, 14][index] },
  { id: `quota-${index}-2026-09`, projectId: project.id, period: '2026-09', quota: [14, 11, 12, 15][index] },
])

export const demoUsers: DemoUser[] = [
  { id: 'user-bandung', name: 'Rina Area Bandung', email: 'bandung@demo.test', password: 'password', role: 'AREA_SUPPORT', areaId: 'area-bandung' },
  { id: 'user-hr', name: 'Dewi HR Head Office', email: 'hr@demo.test', password: 'password', role: 'HR_HO', areaId: null },
  { id: 'user-operations', name: 'Arief Operational Manager', email: 'operations@demo.test', password: 'password', role: 'OPERATIONS_MANAGER', areaId: null },
  { id: 'user-management', name: 'Budi Management', email: 'management@demo.test', password: 'password', role: 'MANAGEMENT', areaId: null },
  { id: 'user-superadmin', name: 'Nadia Super Admin', email: 'superadmin@demo.test', password: 'password', role: 'SUPER_ADMIN', areaId: null },
]

const employeeSeed: Array<[string, string, string | null, string | null, string | null, string, string, string]> = [
  ['EMP-001', 'Raka Adiputra', 'area-bandung', 'project-alpha-bandung', 'Sales', 'INACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-002', 'Fikri Mahardika', 'area-bandung', 'project-alpha-bandung', 'Sales', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-003', 'Andi Kurniawan', 'area-semarang', 'project-alpha-semarang', 'Sales', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-004', 'Sari Wulandari', 'area-bandung', 'project-alpha-bandung', 'Team Leader', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-005', 'Fajar Ramadhan', 'area-bandung', 'project-beta-bandung', 'Promotor', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-006', 'Maya Lestari', 'area-bandung', 'project-beta-bandung', 'Admin', 'INACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-007', 'Rizky Mahendra', 'area-semarang', 'project-alpha-semarang', 'Promotor', 'INACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-008', 'Putri Anggraini', 'area-semarang', 'project-alpha-semarang', 'Promotor', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-009', 'Agus Setiawan', 'area-semarang', 'project-alpha-semarang', 'Team Leader', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-010', 'Indah Permata', 'area-jakarta', 'project-gamma-jakarta', 'Admin', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-011', 'Yoga Prakoso', 'area-jakarta', 'project-gamma-jakarta', 'Sales', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-012', 'Citra Maharani', 'area-jakarta', 'project-gamma-jakarta', 'Promotor', 'ACTIVE', 'DRAFT', 'SUBMITTED'],
  ['EMP-013', 'Bagas Nugraha', 'area-bandung', 'project-alpha-bandung', 'Sales', 'ACTIVE', 'DRAFT', 'SUBMITTED'],
  ['EMP-014', 'Lina Marlina', 'area-bandung', 'project-beta-bandung', 'Sales', 'ACTIVE', 'NOT_AVAILABLE', 'DRAFT'],
  ['EMP-015', 'Taufik Hidayat', 'area-semarang', 'project-alpha-semarang', 'Admin', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-016', 'Nisa Rahmawati', 'area-jakarta', 'project-gamma-jakarta', 'Team Leader', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-017', 'Reza Pahlevi', 'area-bandung', 'project-alpha-bandung', 'Promotor', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-018', 'Aulia Putri', 'area-bandung', 'project-beta-bandung', 'Promotor', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-019', 'Hendra Gunawan', 'area-semarang', 'project-alpha-semarang', 'Sales', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-020', 'Dina Oktavia', 'area-jakarta', 'project-gamma-jakarta', 'Admin', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-021', 'Farhan Akbar', 'area-bandung', null, 'Sales', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-022', 'Melati Kusuma', 'area-jakarta', 'project-gamma-jakarta', 'Sales', 'ACTIVE', 'DRAFT', 'REVISION_REQUIRED'],
  ['EMP-023', 'Wahyu Firmansyah', 'area-bandung', 'project-beta-bandung', 'Team Leader', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-024', 'Sekar Ayuningtyas', 'area-semarang', 'project-alpha-semarang', 'Promotor', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-025', 'Keisha Anindita', 'area-bandung', 'project-beta-bandung', 'Admin', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-026', 'Salsa Maharani', 'area-bandung', 'project-beta-bandung', 'Team Leader', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-027', 'Aldi Permana', 'area-jakarta', 'project-gamma-jakarta', 'Sales', 'INACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-028', 'Reno Pradipta', 'area-jakarta', 'project-gamma-jakarta', 'Sales', 'INACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-029', 'Dimas Santoso', 'area-jakarta', 'project-gamma-jakarta', 'Sales', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-030', 'Bayu Pramana', 'area-bandung', 'project-alpha-bandung', 'Promotor', 'INACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-031', 'Gilang Putra', 'area-bandung', 'project-alpha-bandung', 'Promotor', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-032', 'Nuri Handayani', 'area-jakarta', 'project-gamma-jakarta', 'Admin', 'INACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-033', 'Tia Larasati', 'area-jakarta', 'project-gamma-jakarta', 'Admin', 'ACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-034', 'Raka Prasetyo', 'area-semarang', 'project-alpha-semarang', 'Sales', 'INACTIVE', 'SIGNED', 'VALIDATED'],
]

const employeeDates: Record<string, string> = {
  'EMP-001': '2025-01-06', 'EMP-002': '2026-08-05', 'EMP-003': '2024-04-15', 'EMP-007': '2025-11-10',
  'EMP-008': '2026-08-17', 'EMP-013': '2026-09-02', 'EMP-021': '2026-01-12', 'EMP-022': '2026-09-01', 'EMP-025': '2026-09-02',
  'EMP-026': '2024-02-01',
  'EMP-027': '2025-03-03', 'EMP-028': '2026-07-02', 'EMP-029': '2026-09-08',
  'EMP-030': '2025-06-02', 'EMP-031': '2026-08-17', 'EMP-032': '2025-07-01', 'EMP-033': '2026-08-25',
  'EMP-034': '2024-05-06',
}

const contractEndDates: Record<string, string> = {
  'EMP-005': '2026-10-14',
  'EMP-004': '2026-09-28',
  'EMP-009': '2026-09-21',
  'EMP-019': '2026-09-10',
}

export const createInitialData = (): DemoData => {
  const employees: Employee[] = employeeSeed.map((item, index) => {
    const [personnelId, name, areaId, projectId, position, employmentStatus, contractStatus, validationStatus] = item
    const joinDate = employeeDates[personnelId] ?? `2025-${String((index % 11) + 1).padStart(2, '0')}-${String((index % 19) + 2).padStart(2, '0')}`
    return {
      id: `employee-${String(index + 1).padStart(3, '0')}`,
      personnelId, name, areaId, projectId, position,
      subArea: areaId === 'area-bandung' ? (index % 2 ? 'Bandung Timur' : 'Bandung Barat') : null,
      employmentStatus: employmentStatus as Employee['employmentStatus'],
      joinDate,
      contractStartDate: joinDate,
      contractEndDate: contractEndDates[personnelId] ?? '2026-12-31',
      contractStatus: contractStatus as Employee['contractStatus'],
      bpjsStatus: index % 5 === 0 ? 'IN_PROCESS' : 'ACTIVE',
      profile: {
        areaCbs: areas.find((area) => area.id === areaId)?.name ?? null,
        birthPlace: ['Bandung', 'Semarang', 'Jakarta'][index % 3],
        birthDate: `199${index % 8}-0${index % 8 + 1}-15`,
        gender: index % 2 ? 'Perempuan' : 'Laki-laki',
        ktpCity: ['Bandung', 'Semarang', 'Jakarta'][index % 3],
        ktpProvince: index % 3 === 2 ? 'DKI Jakarta' : 'Jawa Barat',
        domicileCity: areas.find((area) => area.id === areaId)?.name ?? null,
        maritalStatus: index % 3 ? 'Belum Menikah' : 'Menikah',
        education: 'SMA / Sederajat',
        email: `dummy.${personnelId.toLowerCase()}@example.test`,
        mobilePhone: '08xx-xxxx-xxxx',
        program: 'Workforce Monitoring Demo',
        teamLeader: index % 3 ? 'Sari Wulandari' : 'Nisa Rahmawati',
        employeeStatus: employmentStatus === 'ACTIVE' ? 'Aktif' : 'Tidak Aktif',
        outlet: `Outlet Simulasi ${index % 4 + 1}`,
        coverageArea: areas.find((area) => area.id === areaId)?.name ?? null,
        academicScore: String(70 + index % 20),
        personalityScore: String(75 + index % 15),
        height: `${155 + index % 20} cm`,
        weight: `${50 + index % 25} kg`,
        noGlasses: 'Ya',
        notColorBlind: 'Ya',
        agreementTermination: index % 4 === 0 ? 'YA' : index % 5 === 0 ? null : 'TIDAK',
        warningLetter: index % 6 === 0 ? 'SP1' : null,
        companyName: 'PT Contoh Karya Nusantara (Dummy)',
        tenureLabel: `${Math.max(1, 2026 - Number(joinDate.slice(0, 4)))} tahun (demo)`,
      },
      createdBy: index === 12 ? 'user-bandung' : 'user-hr',
      validationStatus: validationStatus as Employee['validationStatus'],
      validatedBy: validationStatus === 'VALIDATED' ? 'user-hr' : null,
      validatedAt: validationStatus === 'VALIDATED' ? '2026-08-01T09:00:00.000Z' : null,
      submittedAt: validationStatus === 'SUBMITTED' ? '2026-09-03T03:15:00.000Z' : null,
      revisionNote: validationStatus === 'REVISION_REQUIRED' ? 'Mohon konfirmasi kembali data kontrak sebelum divalidasi.' : null,
      createdAt: `${joinDate}T02:00:00.000Z`,
      updatedAt: '2026-09-03T03:15:00.000Z',
    }
  })

  return {
    projects: projects.map((project) => ({ ...project })),
    projectQuotas: projectQuotas.map((quota) => ({ ...quota })),
    permissionConfig: cloneDefaultPermissions(),
    validationPolicy: { ...defaultValidationPolicy },
    employees,
    employeeMovements: [
      { id: 'career-salsa-join', employeeId: 'employee-026', movementType: 'JOIN', effectiveDate: '2024-02-01', previousAreaId: null, newAreaId: 'area-bandung', previousProjectId: null, newProjectId: 'project-alpha-bandung', previousPosition: null, newPosition: 'SPG', notes: 'Bergabung sebagai SPG Project Alpha Bandung.', createdBy: 'user-hr', createdAt: '2024-02-01T02:00:00.000Z' },
      { id: 'career-salsa-promotion', employeeId: 'employee-026', movementType: 'PROMOTION', effectiveDate: '2025-01-01', previousAreaId: 'area-bandung', newAreaId: 'area-bandung', previousProjectId: 'project-alpha-bandung', newProjectId: 'project-alpha-bandung', previousPosition: 'SPG', newPosition: 'Team Leader', notes: 'Promosi dari SPG menjadi Team Leader.', createdBy: 'user-hr', createdAt: '2025-01-01T02:00:00.000Z' },
      { id: 'career-salsa-mutation', employeeId: 'employee-026', movementType: 'MUTATION', effectiveDate: '2025-08-01', previousAreaId: 'area-bandung', newAreaId: 'area-bandung', previousProjectId: 'project-alpha-bandung', newProjectId: 'project-beta-bandung', previousPosition: 'Team Leader', newPosition: 'Team Leader', notes: 'Mutasi dari Project Alpha ke Project Beta.', createdBy: 'user-hr', createdAt: '2025-08-01T02:00:00.000Z' },
      ...employees.filter((employee) => employee.id !== 'employee-026').map((employee): EmployeeMovement => ({ id: `career-${employee.id}-join`, employeeId: employee.id, movementType: 'JOIN', effectiveDate: employee.joinDate ?? employee.createdAt.slice(0, 10), previousAreaId: null, newAreaId: employee.areaId, previousProjectId: null, newProjectId: employee.projectId, previousPosition: null, newPosition: employee.position, notes: 'Initial employee master record (dummy).', createdBy: employee.createdBy, createdAt: employee.createdAt })),
      { id: 'career-aldi-exit', employeeId: 'employee-027', movementType: 'EXIT', effectiveDate: '2026-07-01', previousAreaId: 'area-jakarta', newAreaId: 'area-jakarta', previousProjectId: 'project-gamma-jakarta', newProjectId: 'project-gamma-jakarta', previousPosition: 'Sales', newPosition: 'Sales', notes: 'Exit dan kebutuhan replacement pertama.', createdBy: 'user-hr', createdAt: '2026-07-01T04:00:00.000Z' },
      { id: 'career-reno-replacement', employeeId: 'employee-028', movementType: 'REPLACEMENT', effectiveDate: '2026-07-02', previousAreaId: null, newAreaId: 'area-jakarta', previousProjectId: null, newProjectId: 'project-gamma-jakarta', previousPosition: null, newPosition: 'Sales', notes: 'Menggantikan Aldi Permana.', createdBy: 'user-hr', createdAt: '2026-07-02T04:00:00.000Z' },
      { id: 'career-reno-exit', employeeId: 'employee-028', movementType: 'EXIT', effectiveDate: '2026-07-06', previousAreaId: 'area-jakarta', newAreaId: 'area-jakarta', previousProjectId: 'project-gamma-jakarta', newProjectId: 'project-gamma-jakarta', previousPosition: 'Sales', newPosition: 'Sales', notes: 'Exit setelah tiga hari kerja; need lanjutan dibuat.', createdBy: 'user-hr', createdAt: '2026-07-06T04:00:00.000Z' },
    ],
    movementRequests: [{ id: 'movement-request-001', employeeId: 'employee-017', movementType: 'PROMOTION', effectiveDate: '2026-09-10', previousAreaId: 'area-bandung', newAreaId: 'area-bandung', previousProjectId: 'project-alpha-bandung', newProjectId: 'project-alpha-bandung', previousPosition: 'Promotor', newPosition: 'Team Leader', notes: 'Usulan promosi Reza untuk simulasi validasi movement.', createdBy: 'user-bandung', validationStatus: 'SUBMITTED', validatedBy: null, validatedAt: null, submittedAt: '2026-09-09T03:00:00.000Z', revisionNote: null, createdAt: '2026-09-09T03:00:00.000Z', updatedAt: '2026-09-09T03:00:00.000Z' } satisfies PlacementChangeRequest],
    employeeNotes: [{ id: 'note-raka-001', employeeId: 'employee-034', notes: 'Perlu review manual apabila employee mengajukan re-entry.', createdBy: 'user-hr', createdAt: '2026-02-10T04:00:00.000Z' }],
    employeeFlags: [{ id: 'flag-raka-001', employeeId: 'employee-034', status: 'REVIEW_REQUIRED', reason: 'Catatan evaluasi pada employment sebelumnya', notes: 'Lakukan review manual; bukan blacklist otomatis.', createdBy: 'user-hr', createdAt: '2026-02-10T04:00:00.000Z' }],
    employeeExits: [
      {
        id: 'exit-001', employeeId: 'employee-001', exitDate: '2026-08-03', exitReason: 'Mengundurkan diri', replacementRequired: true,
        createdBy: 'user-bandung', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-08-04T04:00:00.000Z', submittedAt: '2026-08-03T08:00:00.000Z', revisionNote: null, createdAt: '2026-08-03T08:00:00.000Z', updatedAt: '2026-08-05T09:00:00.000Z',
      },
      {
        id: 'exit-002', employeeId: 'employee-007', exitDate: '2026-08-07', exitReason: 'Kontrak berakhir', replacementRequired: true,
        createdBy: 'user-hr', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-08-08T04:00:00.000Z', submittedAt: '2026-08-07T06:00:00.000Z', revisionNote: null, createdAt: '2026-08-07T06:00:00.000Z', updatedAt: '2026-08-17T07:00:00.000Z',
      },
      {
        id: 'exit-003', employeeId: 'employee-021', exitDate: '2026-09-04', exitReason: 'Rotasi kebutuhan proyek', replacementRequired: true,
        createdBy: 'user-bandung', validationStatus: 'SUBMITTED', validatedBy: null, validatedAt: null, submittedAt: '2026-09-04T04:30:00.000Z', revisionNote: null, createdAt: '2026-09-04T04:00:00.000Z', updatedAt: '2026-09-04T04:30:00.000Z',
      },
      {
        id: 'exit-004', employeeId: 'employee-006', exitDate: '2026-08-28', exitReason: 'Mengundurkan diri', replacementRequired: true,
        createdBy: 'user-bandung', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-08-29T04:00:00.000Z', submittedAt: '2026-08-28T08:00:00.000Z', revisionNote: null, createdAt: '2026-08-28T08:00:00.000Z', updatedAt: '2026-08-29T04:00:00.000Z',
      },
      { id: 'exit-005', employeeId: 'employee-027', exitDate: '2026-07-01', exitReason: 'Mengundurkan diri', replacementRequired: true, createdBy: 'user-hr', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-07-01T04:00:00.000Z', submittedAt: '2026-07-01T03:00:00.000Z', revisionNote: null, createdAt: '2026-07-01T03:00:00.000Z', updatedAt: '2026-07-01T04:00:00.000Z' },
      { id: 'exit-006', employeeId: 'employee-028', exitDate: '2026-07-06', exitReason: 'Terminasi', replacementRequired: true, createdBy: 'user-hr', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-07-06T04:00:00.000Z', submittedAt: '2026-07-06T03:00:00.000Z', revisionNote: null, createdAt: '2026-07-06T03:00:00.000Z', updatedAt: '2026-07-06T04:00:00.000Z' },
      { id: 'exit-sla-005', employeeId: 'employee-030', exitDate: '2026-08-10', exitReason: 'Kontrak berakhir', replacementRequired: true, createdBy: 'user-hr', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-08-10T04:00:00.000Z', submittedAt: '2026-08-10T03:00:00.000Z', revisionNote: null, createdAt: '2026-08-10T03:00:00.000Z', updatedAt: '2026-08-17T04:00:00.000Z' },
      { id: 'exit-sla-007', employeeId: 'employee-032', exitDate: '2026-08-14', exitReason: 'Mengundurkan diri', replacementRequired: true, createdBy: 'user-hr', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-08-14T04:00:00.000Z', submittedAt: '2026-08-14T03:00:00.000Z', revisionNote: null, createdAt: '2026-08-14T03:00:00.000Z', updatedAt: '2026-08-25T04:00:00.000Z' },
    ],
    replacementNeeds: [
      {
        id: 'need-001', employeeExitId: 'exit-001', originalEmployeeId: 'employee-001', areaId: 'area-bandung', projectId: 'project-alpha-bandung', position: 'Sales', exitDate: '2026-08-03', replacementEmployeeId: 'employee-002', replacementJoinDate: '2026-08-05', previousReplacementNeedId: null, status: 'FULFILLED', fulfilledAt: '2026-08-05T09:00:00.000Z', gapWorkingDays: 2, createdAt: '2026-08-04T04:00:00.000Z', updatedAt: '2026-08-05T09:00:00.000Z',
      },
      {
        id: 'need-002', employeeExitId: 'exit-002', originalEmployeeId: 'employee-007', areaId: 'area-semarang', projectId: 'project-alpha-semarang', position: 'Promotor', exitDate: '2026-08-07', replacementEmployeeId: 'employee-008', replacementJoinDate: '2026-08-17', previousReplacementNeedId: null, status: 'OVER_TARGET', fulfilledAt: '2026-08-17T07:00:00.000Z', gapWorkingDays: 6, createdAt: '2026-08-08T04:00:00.000Z', updatedAt: '2026-08-17T07:00:00.000Z',
      },
      {
        id: 'need-003', employeeExitId: 'exit-004', originalEmployeeId: 'employee-006', areaId: 'area-bandung', projectId: 'project-beta-bandung', position: 'Admin', exitDate: '2026-08-28', replacementEmployeeId: 'employee-025', replacementJoinDate: '2026-09-02', previousReplacementNeedId: null, status: 'FULFILLED', fulfilledAt: '2026-09-02T04:00:00.000Z', gapWorkingDays: 3, createdAt: '2026-08-29T04:00:00.000Z', updatedAt: '2026-09-02T04:00:00.000Z',
      },
      { id: 'need-chain-001', employeeExitId: 'exit-005', originalEmployeeId: 'employee-027', areaId: 'area-jakarta', projectId: 'project-gamma-jakarta', position: 'Sales', exitDate: '2026-07-01', replacementEmployeeId: 'employee-028', replacementJoinDate: '2026-07-02', previousReplacementNeedId: null, status: 'FULFILLED', fulfilledAt: '2026-07-02T04:00:00.000Z', gapWorkingDays: 1, createdAt: '2026-07-01T04:00:00.000Z', updatedAt: '2026-07-02T04:00:00.000Z' },
      { id: 'need-chain-002', employeeExitId: 'exit-006', originalEmployeeId: 'employee-028', areaId: 'area-jakarta', projectId: 'project-gamma-jakarta', position: 'Sales', exitDate: '2026-07-06', replacementEmployeeId: null, replacementJoinDate: null, previousReplacementNeedId: 'need-chain-001', status: 'OPEN', fulfilledAt: null, gapWorkingDays: null, createdAt: '2026-07-06T04:00:00.000Z', updatedAt: '2026-07-06T04:00:00.000Z' },
      { id: 'need-sla-005', employeeExitId: 'exit-sla-005', originalEmployeeId: 'employee-030', areaId: 'area-bandung', projectId: 'project-alpha-bandung', position: 'Promotor', exitDate: '2026-08-10', replacementEmployeeId: 'employee-031', replacementJoinDate: '2026-08-17', previousReplacementNeedId: null, status: 'OVER_TARGET', fulfilledAt: '2026-08-17T04:00:00.000Z', gapWorkingDays: 5, createdAt: '2026-08-10T04:00:00.000Z', updatedAt: '2026-08-17T04:00:00.000Z' },
      { id: 'need-sla-007', employeeExitId: 'exit-sla-007', originalEmployeeId: 'employee-032', areaId: 'area-jakarta', projectId: 'project-gamma-jakarta', position: 'Admin', exitDate: '2026-08-14', replacementEmployeeId: 'employee-033', replacementJoinDate: '2026-08-25', previousReplacementNeedId: null, status: 'OVER_TARGET', fulfilledAt: '2026-08-25T04:00:00.000Z', gapWorkingDays: 7, createdAt: '2026-08-14T04:00:00.000Z', updatedAt: '2026-08-25T04:00:00.000Z' },
    ],
    movements: [
      { id: 'move-001', employeeId: 'employee-002', type: 'FULFILLMENT', title: 'Replacement terpenuhi', description: 'Menggantikan Raka Adiputra dalam 2 hari kerja', date: '2026-08-05T09:00:00.000Z' },
      { id: 'move-002', employeeId: 'employee-001', type: 'EXIT', title: 'Employee exit tervalidasi', description: 'Mengundurkan diri dari Project Alpha Bandung', date: '2026-08-04T04:00:00.000Z' },
      { id: 'move-003', employeeId: 'employee-008', type: 'FULFILLMENT', title: 'Replacement melewati SLA', description: 'Fulfillment tercapai dalam 6 hari kerja', date: '2026-08-17T07:00:00.000Z' },
      { id: 'move-004', employeeId: 'employee-013', type: 'ENTRY', title: 'Entry menunggu validasi', description: 'Data entry dikirim Area Bandung', date: '2026-09-03T03:15:00.000Z' },
      { id: 'move-005', employeeId: 'employee-021', type: 'EXIT', title: 'Exit menunggu validasi', description: 'Data sumber Project belum tersedia', date: '2026-09-04T04:30:00.000Z' },
    ],
  }
}

export const positions = ['Sales', 'SPG', 'Team Leader', 'Promotor', 'Admin']
