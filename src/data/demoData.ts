import type { Area, DemoData, DemoUser, Employee, Project } from '../types'

export const areas: Area[] = [
  { id: 'area-bandung', name: 'Bandung' },
  { id: 'area-semarang', name: 'Semarang' },
  { id: 'area-jakarta', name: 'Jakarta' },
]

export const projects: Project[] = [
  { id: 'project-alpha-bandung', name: 'Project Alpha Bandung', clientName: 'PT Arunika Niaga', areaId: 'area-bandung' },
  { id: 'project-beta-bandung', name: 'Project Beta Bandung', clientName: 'PT Bintang Retail', areaId: 'area-bandung' },
  { id: 'project-alpha-semarang', name: 'Project Alpha Semarang', clientName: 'PT Arunika Niaga', areaId: 'area-semarang' },
  { id: 'project-gamma-jakarta', name: 'Project Gamma Jakarta', clientName: 'PT Cakrawala Distribusi', areaId: 'area-jakarta' },
]

export const demoUsers: DemoUser[] = [
  { id: 'user-bandung', name: 'Rina Area Bandung', email: 'bandung@demo.test', password: 'password', role: 'AREA_SUPPORT', areaId: 'area-bandung' },
  { id: 'user-hr', name: 'Dewi HR Head Office', email: 'hr@demo.test', password: 'password', role: 'HR_HO', areaId: null },
  { id: 'user-management', name: 'Budi Management', email: 'management@demo.test', password: 'password', role: 'MANAGEMENT', areaId: null },
]

const employeeSeed: Array<[string, string, string | null, string | null, string | null, string, string, string]> = [
  ['EMP-001', 'Nanda Pratama', 'area-bandung', 'project-alpha-bandung', 'Sales', 'INACTIVE', 'SIGNED', 'VALIDATED'],
  ['EMP-002', 'Dony Saputra', 'area-bandung', 'project-alpha-bandung', 'Sales', 'ACTIVE', 'SIGNED', 'VALIDATED'],
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
]

const employeeDates: Record<string, string> = {
  'EMP-001': '2025-01-06', 'EMP-002': '2026-08-05', 'EMP-003': '2024-04-15', 'EMP-007': '2025-11-10',
  'EMP-008': '2026-08-17', 'EMP-013': '2026-09-02', 'EMP-021': '2026-01-12', 'EMP-022': '2026-09-01', 'EMP-025': '2026-09-02',
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
      contractEndDate: '2026-12-31',
      contractStatus: contractStatus as Employee['contractStatus'],
      bpjsStatus: index % 5 === 0 ? 'Dalam proses' : 'Aktif',
      createdBy: index === 12 ? 'user-bandung' : 'user-hr',
      validationStatus: validationStatus as Employee['validationStatus'],
      validatedBy: validationStatus === 'VALIDATED' ? 'user-hr' : null,
      validatedAt: validationStatus === 'VALIDATED' ? '2026-08-01T09:00:00.000Z' : null,
      submittedAt: validationStatus === 'SUBMITTED' ? '2026-09-03T03:15:00.000Z' : null,
      createdAt: `${joinDate}T02:00:00.000Z`,
      updatedAt: '2026-09-03T03:15:00.000Z',
    }
  })

  return {
    employees,
    employeeExits: [
      {
        id: 'exit-001', employeeId: 'employee-001', exitDate: '2026-08-03', exitReason: 'Mengundurkan diri', replacementRequired: true,
        createdBy: 'user-bandung', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-08-04T04:00:00.000Z', submittedAt: '2026-08-03T08:00:00.000Z', createdAt: '2026-08-03T08:00:00.000Z', updatedAt: '2026-08-05T09:00:00.000Z',
      },
      {
        id: 'exit-002', employeeId: 'employee-007', exitDate: '2026-08-07', exitReason: 'Kontrak berakhir', replacementRequired: true,
        createdBy: 'user-hr', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-08-08T04:00:00.000Z', submittedAt: '2026-08-07T06:00:00.000Z', createdAt: '2026-08-07T06:00:00.000Z', updatedAt: '2026-08-17T07:00:00.000Z',
      },
      {
        id: 'exit-003', employeeId: 'employee-021', exitDate: '2026-09-04', exitReason: 'Rotasi kebutuhan proyek', replacementRequired: true,
        createdBy: 'user-bandung', validationStatus: 'SUBMITTED', validatedBy: null, validatedAt: null, submittedAt: '2026-09-04T04:30:00.000Z', createdAt: '2026-09-04T04:00:00.000Z', updatedAt: '2026-09-04T04:30:00.000Z',
      },
      {
        id: 'exit-004', employeeId: 'employee-006', exitDate: '2026-08-28', exitReason: 'Mengundurkan diri', replacementRequired: true,
        createdBy: 'user-bandung', validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-08-29T04:00:00.000Z', submittedAt: '2026-08-28T08:00:00.000Z', createdAt: '2026-08-28T08:00:00.000Z', updatedAt: '2026-08-29T04:00:00.000Z',
      },
    ],
    replacementNeeds: [
      {
        id: 'need-001', employeeExitId: 'exit-001', originalEmployeeId: 'employee-001', areaId: 'area-bandung', projectId: 'project-alpha-bandung', position: 'Sales', exitDate: '2026-08-03', replacementEmployeeId: 'employee-002', status: 'FULFILLED', fulfilledAt: '2026-08-05T09:00:00.000Z', gapWorkingDays: 2, createdAt: '2026-08-04T04:00:00.000Z', updatedAt: '2026-08-05T09:00:00.000Z',
      },
      {
        id: 'need-002', employeeExitId: 'exit-002', originalEmployeeId: 'employee-007', areaId: 'area-semarang', projectId: 'project-alpha-semarang', position: 'Promotor', exitDate: '2026-08-07', replacementEmployeeId: 'employee-008', status: 'OVER_TARGET', fulfilledAt: '2026-08-17T07:00:00.000Z', gapWorkingDays: 6, createdAt: '2026-08-08T04:00:00.000Z', updatedAt: '2026-08-17T07:00:00.000Z',
      },
      {
        id: 'need-003', employeeExitId: 'exit-004', originalEmployeeId: 'employee-006', areaId: 'area-bandung', projectId: 'project-beta-bandung', position: 'Admin', exitDate: '2026-08-28', replacementEmployeeId: null, status: 'OPEN', fulfilledAt: null, gapWorkingDays: null, createdAt: '2026-08-29T04:00:00.000Z', updatedAt: '2026-08-29T04:00:00.000Z',
      },
    ],
    movements: [
      { id: 'move-001', employeeId: 'employee-002', type: 'FULFILLMENT', title: 'Replacement terpenuhi', description: 'Menggantikan Nanda Pratama dalam 2 hari kerja', date: '2026-08-05T09:00:00.000Z' },
      { id: 'move-002', employeeId: 'employee-001', type: 'EXIT', title: 'Employee exit tervalidasi', description: 'Mengundurkan diri dari Project Alpha Bandung', date: '2026-08-04T04:00:00.000Z' },
      { id: 'move-003', employeeId: 'employee-008', type: 'FULFILLMENT', title: 'Replacement melewati SLA', description: 'Fulfillment tercapai dalam 6 hari kerja', date: '2026-08-17T07:00:00.000Z' },
      { id: 'move-004', employeeId: 'employee-013', type: 'ENTRY', title: 'Entry menunggu validasi', description: 'Data entry dikirim Area Bandung', date: '2026-09-03T03:15:00.000Z' },
      { id: 'move-005', employeeId: 'employee-021', type: 'EXIT', title: 'Exit menunggu validasi', description: 'Data sumber Project belum tersedia', date: '2026-09-04T04:30:00.000Z' },
    ],
  }
}

export const positions = ['Sales', 'Team Leader', 'Promotor', 'Admin']
