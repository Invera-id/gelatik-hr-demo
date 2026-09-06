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

function ProtectedLayout() {
  const { currentUser } = useDemo()
  return currentUser ? <AppLayout /> : <Navigate to="/login" replace />
}

function HRRoute({ children }: { children: ReactNode }) {
  const { currentUser } = useDemo()
  return currentUser?.role === 'HR_HO' ? children : <Navigate to="/dashboard" replace />
}

function EditableRoute({ children }: { children: ReactNode }) {
  const { currentUser } = useDemo()
  return currentUser?.role !== 'MANAGEMENT' ? children : <Navigate to="/employees" replace />
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedLayout />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="employees" element={<EmployeesPage />} />
      <Route path="employees/new" element={<EditableRoute><EmployeeEntryPage /></EditableRoute>} />
      <Route path="employees/:employeeId" element={<EmployeeDetailPage />} />
      <Route path="employees/:employeeId/edit" element={<EditableRoute><EmployeeEntryPage /></EditableRoute>} />
      <Route path="employees/:employeeId/exit" element={<EditableRoute><EmployeeExitPage /></EditableRoute>} />
      <Route path="validation" element={<HRRoute><ValidationPage /></HRRoute>} />
      <Route path="replacements" element={<ReplacementsPage />} />
      <Route path="replacements/:needId" element={<ReplacementDetailPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>
}
