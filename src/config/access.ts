import type { DemoUser, Permission, Role, RolePermissionConfig, TransactionType, ValidationPolicy } from '../types'

export type PermissionModule = 'Monitoring' | 'Employee' | 'Import & Export' | 'Validation' | 'Replacement & Fulfillment' | 'Project' | 'Administrasi'

export interface PermissionDefinition {
  key: Permission
  label: string
  module: PermissionModule
  description?: string
}

export const permissionDefinitions: PermissionDefinition[] = [
  { key: 'view_dashboard', label: 'Melihat Dashboard', module: 'Monitoring' },
  { key: 'view_analytics', label: 'Melihat Analytics & Reports', module: 'Monitoring' },
  { key: 'view_notifications', label: 'Melihat Notifikasi', module: 'Monitoring' },
  { key: 'view_employee', label: 'Melihat Master Employee', module: 'Employee' },
  { key: 'create_employee', label: 'Membuat Employee Baru', module: 'Employee', description: 'Membuat data employee secara manual; tidak memberikan akses Import Excel.' },
  { key: 'edit_employee_basic', label: 'Mengubah Data Dasar Employee', module: 'Employee', description: 'Mengubah data profil dasar tanpa memindahkan Area, Project, atau Posisi.' },
  { key: 'request_placement_change', label: 'Mengajukan Perubahan Penempatan', module: 'Employee' },
  { key: 'request_employee_exit', label: 'Mengajukan Employee Exit', module: 'Employee' },
  { key: 'reentry_employee', label: 'Melakukan Re-entry Employee', module: 'Employee' },
  { key: 'manage_employee_notes_flags', label: 'Mengelola Catatan & Flag Employee', module: 'Employee', description: 'Catatan dan flag adalah informasi manual, bukan blacklist otomatis.' },
  { key: 'view_movement_history', label: 'Melihat Riwayat Movement', module: 'Employee' },
  { key: 'import_personnel', label: 'Mengimpor Excel Personel', module: 'Import & Export', description: 'Import mengikuti cakupan Area role dan hanya menyimpan baris di dalam cakupan.' },
  { key: 'view_import_review', label: 'Melihat Antrean Review Import', module: 'Import & Export' },
  { key: 'resolve_import_review', label: 'Menyelesaikan Review Import', module: 'Import & Export', description: 'Keputusan review dapat mengubah kondisi master dan movement history.' },
  { key: 'export_data', label: 'Mengekspor Data', module: 'Import & Export' },
  { key: 'validate_employee_entry_edit', label: 'Memvalidasi Employee Entry/Edit', module: 'Validation' },
  { key: 'validate_placement_change', label: 'Memvalidasi Perubahan Penempatan', module: 'Validation' },
  { key: 'validate_employee_exit', label: 'Memvalidasi Employee Exit', module: 'Validation' },
  { key: 'bulk_validate', label: 'Melakukan Validasi Massal', module: 'Validation', description: 'Memvalidasi banyak pengajuan entry sekaligus; tetap mengikuti Validation Policy.' },
  { key: 'view_replacement', label: 'Melihat Replacement & Fulfillment', module: 'Replacement & Fulfillment' },
  { key: 'match_replacement', label: 'Memilih Kandidat Replacement', module: 'Replacement & Fulfillment' },
  { key: 'fulfill_replacement', label: 'Menandai Replacement Terpenuhi', module: 'Replacement & Fulfillment', description: 'Menyelesaikan kebutuhan dan menghitung gap hari kerja.' },
  { key: 'view_project', label: 'Melihat Master Project', module: 'Project' },
  { key: 'manage_project', label: 'Membuat/Mengubah Project', module: 'Project' },
  { key: 'toggle_project_status', label: 'Mengaktifkan/Nonaktifkan Project', module: 'Project' },
  { key: 'manage_project_quota', label: 'Mengelola Quota Bulanan', module: 'Project' },
  { key: 'manage_roles', label: 'Mengelola Role & Permission', module: 'Administrasi', description: 'Dikunci aktif untuk Super Admin agar akses konfigurasi tidak hilang.' },
  { key: 'manage_validation_policy', label: 'Mengelola Kebijakan Validasi', module: 'Administrasi', description: 'Mengubah siapa yang berwenang memvalidasi setiap jenis transaksi.' },
  { key: 'reset_demo_data', label: 'Reset Data Demo', module: 'Administrasi', description: 'Mengembalikan transaksi lokal ke kondisi awal; data import IndexedDB tetap dipertahankan.' },
]

export const permissionLabels = Object.fromEntries(permissionDefinitions.map((item) => [item.key, item.label])) as Record<Permission, string>
export const allPermissions = permissionDefinitions.map((item) => item.key)
export const permissionModules = [...new Set(permissionDefinitions.map((item) => item.module))]
export const lockedSuperAdminPermissions: Permission[] = ['manage_roles', 'manage_validation_policy', 'reset_demo_data']

export const defaultPermissionConfig: RolePermissionConfig[] = [
  { role: 'AREA_SUPPORT', scope: 'OWN_AREA', selectedAreaIds: [], permissions: ['view_dashboard', 'view_notifications', 'view_employee', 'create_employee', 'edit_employee_basic', 'request_placement_change', 'request_employee_exit', 'reentry_employee', 'manage_employee_notes_flags', 'view_movement_history', 'import_personnel', 'view_replacement', 'view_project'] },
  { role: 'HR_HO', scope: 'ALL_AREAS', selectedAreaIds: [], permissions: ['view_dashboard', 'view_analytics', 'view_notifications', 'view_employee', 'create_employee', 'edit_employee_basic', 'request_placement_change', 'request_employee_exit', 'reentry_employee', 'manage_employee_notes_flags', 'view_movement_history', 'import_personnel', 'view_import_review', 'resolve_import_review', 'export_data', 'validate_employee_entry_edit', 'validate_placement_change', 'validate_employee_exit', 'bulk_validate', 'view_replacement', 'match_replacement', 'fulfill_replacement', 'view_project', 'manage_project', 'toggle_project_status', 'manage_project_quota'] },
  { role: 'OPERATIONS_MANAGER', scope: 'ALL_AREAS', selectedAreaIds: [], permissions: ['view_dashboard', 'view_analytics', 'view_employee', 'view_movement_history', 'export_data', 'view_replacement', 'view_project'] },
  { role: 'MANAGEMENT', scope: 'ALL_AREAS', selectedAreaIds: [], permissions: ['view_dashboard', 'view_analytics', 'view_employee', 'view_movement_history', 'export_data', 'view_replacement', 'view_project'] },
  { role: 'SUPER_ADMIN', scope: 'ALL_AREAS', selectedAreaIds: [], permissions: [...allPermissions] },
]

type LegacyPermission = 'edit_employee' | 'create_exit' | 'validate_employee' | 'validate_exit' | 'manage_users'

const legacyPermissionMap: Partial<Record<Permission, LegacyPermission>> = {
  edit_employee_basic: 'edit_employee',
  request_placement_change: 'edit_employee',
  manage_employee_notes_flags: 'edit_employee',
  request_employee_exit: 'create_exit',
  validate_employee_entry_edit: 'validate_employee',
  validate_placement_change: 'validate_employee',
  validate_employee_exit: 'validate_exit',
}

/** Upgrade browser-stored V2 permissions while preserving explicit legacy toggles. */
export const migratePermissionConfig = (stored: unknown): RolePermissionConfig[] => {
  if (!Array.isArray(stored)) return cloneDefaultPermissions()
  const roles = defaultPermissionConfig.map((item) => item.role)
  return roles.map((role) => {
    const fallback = defaultPermissionConfig.find((item) => item.role === role)!
    const raw = stored.find((item): item is { role: Role; permissions?: unknown; scope?: unknown; selectedAreaIds?: unknown } => Boolean(item && typeof item === 'object' && (item as { role?: unknown }).role === role))
    if (!raw) return { ...fallback, permissions: [...fallback.permissions], selectedAreaIds: [...fallback.selectedAreaIds] }
    const source = new Set(Array.isArray(raw.permissions) ? raw.permissions.filter((item): item is string => typeof item === 'string') : [])
    const hasLegacyKeys = [...source].some((key) => ['edit_employee', 'create_exit', 'validate_employee', 'validate_exit', 'manage_users'].includes(key))
    const permissions = allPermissions.filter((permission) => {
      if (source.has(permission)) return true
      if (!hasLegacyKeys) return false
      const legacy = legacyPermissionMap[permission]
      if (legacy) return source.has(legacy)
      if (['view_dashboard', 'view_employee', 'create_employee', 'view_replacement', 'match_replacement', 'fulfill_replacement', 'export_data', 'manage_roles'].includes(permission)) return false
      return fallback.permissions.includes(permission)
    })
    if (role === 'SUPER_ADMIN') lockedSuperAdminPermissions.forEach((permission) => { if (!permissions.includes(permission)) permissions.push(permission) })
    const scope = raw.scope === 'OWN_AREA' || raw.scope === 'SELECTED_AREAS' || raw.scope === 'ALL_AREAS' ? raw.scope : fallback.scope
    const selectedAreaIds = Array.isArray(raw.selectedAreaIds) ? raw.selectedAreaIds.filter((item): item is string => typeof item === 'string') : []
    return { role, scope, selectedAreaIds, permissions }
  })
}

export const defaultValidationPolicy: ValidationPolicy = {
  EMPLOYEE_ENTRY: 'HR_HO',
  EMPLOYEE_BASIC_EDIT: 'AREA_ADMIN',
  EMPLOYEE_PLACEMENT_CHANGE: 'HR_HO',
  EMPLOYEE_EXIT: 'HR_HO',
}

export const transactionLabels: Record<TransactionType, string> = {
  EMPLOYEE_ENTRY: 'Employee Baru',
  EMPLOYEE_BASIC_EDIT: 'Perubahan Data Dasar Employee',
  EMPLOYEE_PLACEMENT_CHANGE: 'Perubahan Penempatan Employee',
  EMPLOYEE_EXIT: 'Employee Exit',
}

export const validatorLabels = {
  AREA_ADMIN: 'Admin Area',
  HR_HO: 'HR Head Office',
  BOTH: 'Keduanya / Eskalasi',
} as const

export const hasPermission = (user: DemoUser, config: RolePermissionConfig[], permission: Permission) =>
  config.find((item) => item.role === user.role)?.permissions.includes(permission) ?? false

export const canValidateTransaction = (user: DemoUser, transaction: TransactionType, policy: ValidationPolicy) => {
  if (user.role === 'SUPER_ADMIN') return true
  const authority = policy[transaction]
  if (authority === 'BOTH') return user.role === 'AREA_SUPPORT' || user.role === 'HR_HO'
  return authority === 'AREA_ADMIN' ? user.role === 'AREA_SUPPORT' : user.role === 'HR_HO'
}

export const allowedAreaIds = (user: DemoUser, config: RolePermissionConfig[]) => {
  const roleConfig = config.find((item) => item.role === user.role)
  if (!roleConfig || roleConfig.scope === 'ALL_AREAS') return null
  if (roleConfig.scope === 'OWN_AREA') return user.areaId ? [user.areaId] : []
  return roleConfig.selectedAreaIds
}

export const cloneDefaultPermissions = () => defaultPermissionConfig.map((item) => ({ ...item, permissions: [...item.permissions], selectedAreaIds: [...item.selectedAreaIds] }))

export const scopeLabels = {
  OWN_AREA: 'Area Sendiri',
  SELECTED_AREAS: 'Area Terpilih',
  ALL_AREAS: 'Semua Area',
} as const

export const permissionSummary = (permissions: Permission[]) => {
  const active = new Set(permissions)
  const writePermissions: Permission[] = ['create_employee', 'edit_employee_basic', 'request_placement_change', 'request_employee_exit', 'reentry_employee', 'manage_employee_notes_flags', 'import_personnel', 'manage_project', 'toggle_project_status', 'manage_project_quota']
  const validationPermissions: Permission[] = ['validate_employee_entry_edit', 'validate_placement_change', 'validate_employee_exit', 'bulk_validate']
  const adminPermissions: Permission[] = ['manage_roles', 'manage_validation_policy', 'reset_demo_data']
  if (adminPermissions.some((permission) => active.has(permission)) || active.size === allPermissions.length) return 'Full access'
  if (validationPermissions.some((permission) => active.has(permission))) return 'Validator'
  if (writePermissions.some((permission) => active.has(permission))) return 'Data entry'
  return 'Read-only'
}
