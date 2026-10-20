import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { useDemo } from './context/DemoContext'
import { DashboardPage } from './pages/DashboardPage'
import { EmployeeDetailPage } from './pages/EmployeeDetailPage'
import { EmployeeEntryPage } from './pages/EmployeeEntryPage'
import { EmployeeExitPage } from './pages/EmployeeExitPage'
import { EmployeesPage } from './pages/EmployeesPage'
import { LoginPage } from './pages/LoginPage'
import { ReplacementDetailPage } from './pages/ReplacementDetailPage'
import { ReplacementsPage } from './pages/ReplacementsPage'
import { ValidationPage } from './pages/ValidationPage'
import { AccessSettingsPage } from './pages/AccessSettingsPage'
import { MovementHistoryPage } from './pages/MovementHistoryPage'
import { EmployeeMovementPage } from './pages/EmployeeMovementPage'
import { ReentryPage } from './pages/ReentryPage'
import { ExportPage } from './pages/ExportPage'
import { ImportPage } from './pages/ImportPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { hasPermission } from './config/access'
import type { Permission } from './types'

function ProtectedLayout() {
  const { currentUser } = useDemo()
  return currentUser ? <AppLayout /> : <Navigate to="/login" replace />
}

function PermissionRoute({ permission, children }: { permission: Permission | Permission[]; children: ReactNode }) {
  const { currentUser, permissionConfig } = useDemo()
  const required = Array.isArray(permission) ? permission : [permission]
  return currentUser && required.some((item) => hasPermission(currentUser, permissionConfig, item)) ? children : <Navigate to="/dashboard" replace />
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedLayout />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<PermissionRoute permission="view_dashboard"><DashboardPage /></PermissionRoute>} />
      <Route path="employees" element={<PermissionRoute permission="view_employee"><EmployeesPage /></PermissionRoute>} />
      <Route path="employees/new" element={<PermissionRoute permission="create_employee"><EmployeeEntryPage /></PermissionRoute>} />
      <Route path="employees/:employeeId" element={<PermissionRoute permission="view_employee"><EmployeeDetailPage /></PermissionRoute>} />
      <Route path="employees/:employeeId/edit" element={<PermissionRoute permission="edit_employee_basic"><EmployeeEntryPage /></PermissionRoute>} />
      <Route path="employees/:employeeId/exit" element={<PermissionRoute permission="request_employee_exit"><EmployeeExitPage /></PermissionRoute>} />
      <Route path="employees/:employeeId/movement" element={<PermissionRoute permission="request_placement_change"><EmployeeMovementPage /></PermissionRoute>} />
      <Route path="employees/:employeeId/reentry" element={<PermissionRoute permission="reentry_employee"><ReentryPage /></PermissionRoute>} />
      <Route path="movements" element={<PermissionRoute permission="view_movement_history"><MovementHistoryPage /></PermissionRoute>} />
      <Route path="projects" element={<PermissionRoute permission="view_project"><ProjectsPage /></PermissionRoute>} />
      <Route path="projects/:projectId" element={<PermissionRoute permission="view_project"><ProjectDetailPage /></PermissionRoute>} />
      <Route path="reports/analytics" element={<PermissionRoute permission="view_analytics"><AnalyticsPage /></PermissionRoute>} />
      <Route path="validation" element={<PermissionRoute permission={['validate_employee_entry_edit', 'validate_placement_change', 'validate_employee_exit']}><ValidationPage /></PermissionRoute>} />
      <Route path="replacements" element={<PermissionRoute permission="view_replacement"><ReplacementsPage /></PermissionRoute>} />
      <Route path="replacements/:needId" element={<PermissionRoute permission="view_replacement"><ReplacementDetailPage /></PermissionRoute>} />
      <Route path="reports/export" element={<PermissionRoute permission="export_data"><ExportPage /></PermissionRoute>} />
      <Route path="import" element={<PermissionRoute permission={['import_personnel', 'view_import_review']}><ImportPage /></PermissionRoute>} />
      <Route path="notifications" element={<PermissionRoute permission="view_notifications"><NotificationsPage /></PermissionRoute>} />
      <Route path="settings/access" element={<PermissionRoute permission="manage_roles"><AccessSettingsPage /></PermissionRoute>} />
      <Route path="settings/validation" element={<PermissionRoute permission="manage_validation_policy"><AccessSettingsPage mode="validation" /></PermissionRoute>} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>
}
