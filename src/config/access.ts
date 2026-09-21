import type { DemoUser, Permission, RolePermissionConfig, TransactionType, ValidationPolicy } from '../types'

export const permissionLabels: Record<Permission, string> = {
  view_dashboard: 'View dashboard',
  view_employee: 'View employee',
  create_employee: 'Create employee',
  edit_employee: 'Edit employee',
  create_exit: 'Create exit',
  validate_employee: 'Validate employee',
  validate_exit: 'Validate exit',
  view_replacement: 'View replacement',
  match_replacement: 'Match replacement',
  fulfill_replacement: 'Fulfill replacement',
  export_data: 'Export data',
  manage_users: 'Manage users',
  manage_roles: 'Manage roles',
}

export const allPermissions = Object.keys(permissionLabels) as Permission[]

export const defaultPermissionConfig: RolePermissionConfig[] = [
  { role: 'AREA_SUPPORT', scope: 'OWN_AREA', selectedAreaIds: [], permissions: ['view_dashboard', 'view_employee', 'create_employee', 'edit_employee', 'create_exit', 'view_replacement', 'export_data'] },
  { role: 'HR_HO', scope: 'ALL_AREAS', selectedAreaIds: [], permissions: ['view_dashboard', 'view_employee', 'create_employee', 'edit_employee', 'create_exit', 'validate_employee', 'validate_exit', 'view_replacement', 'match_replacement', 'fulfill_replacement', 'export_data'] },
  { role: 'OPERATIONS_MANAGER', scope: 'ALL_AREAS', selectedAreaIds: [], permissions: ['view_dashboard', 'view_employee', 'view_replacement', 'export_data'] },
  { role: 'MANAGEMENT', scope: 'ALL_AREAS', selectedAreaIds: [], permissions: ['view_dashboard', 'view_employee', 'view_replacement', 'export_data'] },
  { role: 'SUPER_ADMIN', scope: 'ALL_AREAS', selectedAreaIds: [], permissions: [...allPermissions] },
]

export const defaultValidationPolicy: ValidationPolicy = {
  EMPLOYEE_ENTRY: 'HR_HO',
  EMPLOYEE_BASIC_EDIT: 'AREA_ADMIN',
  EMPLOYEE_PLACEMENT_CHANGE: 'HR_HO',
  EMPLOYEE_EXIT: 'HR_HO',
}

export const transactionLabels: Record<TransactionType, string> = {
  EMPLOYEE_ENTRY: 'Employee Entry',
  EMPLOYEE_BASIC_EDIT: 'Employee Basic Edit',
  EMPLOYEE_PLACEMENT_CHANGE: 'Employee Placement Change',
  EMPLOYEE_EXIT: 'Employee Exit',
}

export const validatorLabels = {
  AREA_ADMIN: 'Area Admin',
  HR_HO: 'HR Head Office',
  BOTH: 'Both / Escalated',
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
