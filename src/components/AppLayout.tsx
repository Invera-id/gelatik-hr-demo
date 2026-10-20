import { BarChart3, Bell, BriefcaseBusiness, ChevronDown, ClipboardCheck, Download, FileUp, History, KeyRound, LogOut, Menu, RotateCcw, Settings2, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { roleLabels } from '../lib/businessRules'
import { useDemo } from '../context/DemoContext'
import { hasPermission, scopeLabels } from '../config/access'
import type { Permission } from '../types'
import { terminology as term } from '../config/terminology'
import { NotificationBell } from './NotificationBell'
import { Toaster } from './Toaster'

const navItems: Array<{ to: string; label: string; icon: typeof BarChart3; permission: Permission | Permission[] }> = [
  { to: '/dashboard', label: 'Dashboard', icon: BarChart3, permission: 'view_dashboard' },
  { to: '/employees', label: term.employeeMaster, icon: Users, permission: 'view_employee' },
  { to: '/projects', label: 'Projects', icon: BriefcaseBusiness, permission: 'view_project' },
  { to: '/reports/analytics', label: 'Analytics / Reports', icon: BarChart3, permission: 'view_analytics' },
  { to: '/employees/new', label: term.employeeEntry, icon: UserPlus, permission: 'create_employee' },
  { to: '/import', label: 'Import Excel', icon: FileUp, permission: ['import_personnel', 'view_import_review'] },
  { to: '/notifications', label: 'Notifikasi', icon: Bell, permission: 'view_notifications' },
  { to: '/movements', label: term.movementHistory, icon: History, permission: 'view_movement_history' },
  { to: '/validation', label: term.validation, icon: ClipboardCheck, permission: ['validate_employee_entry_edit', 'validate_placement_change', 'validate_employee_exit'] },
  { to: '/replacements', label: term.replacementFulfillment, icon: BriefcaseBusiness, permission: 'view_replacement' },
  { to: '/reports/export', label: 'Reports / Export', icon: Download, permission: 'export_data' },
  { to: '/settings/access', label: 'Access & Roles', icon: KeyRound, permission: 'manage_roles' },
  { to: '/settings/validation', label: 'Validation Policy', icon: Settings2, permission: 'manage_validation_policy' },
]

export function AppLayout() {
  const { currentUser, areas, logout, resetDemo, permissionConfig, dataMode } = useDemo()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  if (!currentUser) return null
  const area = areas.find((item) => item.id === currentUser.areaId)
  const access = permissionConfig.find((item) => item.role === currentUser.role)
  const scopeLabel = access?.scope === 'OWN_AREA' ? `${scopeLabels.OWN_AREA}: ${area?.name ?? 'Belum ditetapkan'}` : access?.scope === 'SELECTED_AREAS' ? `${scopeLabels.SELECTED_AREAS}: ${access.selectedAreaIds.length}` : scopeLabels.ALL_AREAS
  const handleLogout = () => { logout(); navigate('/login') }
  const handleReset = () => {
    if (window.confirm('Reset transaksi lokal aplikasi? Data import dan riwayat batch di IndexedDB tetap dipertahankan.')) resetDemo()
    setProfileOpen(false)
  }
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <div className="brand"><div className="brand-mark">GS</div><div><strong>Gelatik HR</strong><span>Workforce Monitor</span></div><button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="Tutup menu"><X size={20} /></button></div>
      <nav className="sidebar-nav"><span className="nav-caption">WORKSPACE</span>
        {navItems.filter((item) => Array.isArray(item.permission) ? item.permission.some((permission) => hasPermission(currentUser, permissionConfig, permission)) : hasPermission(currentUser, permissionConfig, item.permission)).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMobileOpen(false)} className={({ isActive }) => isActive || (to === '/employees' && location.pathname.startsWith('/employees/') && location.pathname !== '/employees/new') ? 'active' : ''}><Icon size={19} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-note"><span className="pulse-dot" /><div><strong>Penyimpanan lokal</strong><small>Data tersimpan di browser ini</small></div></div>
    </aside>
    {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Tutup menu" />}
    <div className="app-content">
      <header className="topbar"><button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="Buka menu"><Menu size={21} /></button><div className="topbar-context"><span>PT GELATIK SUPRA</span><strong>HR Workforce Monitoring System</strong></div>
        <div className="topbar-actions">{hasPermission(currentUser, permissionConfig, 'view_notifications') && <NotificationBell />}</div>
        <div className="profile-wrap"><button className="profile-button" onClick={() => setProfileOpen((open) => !open)}><span className="avatar">{currentUser.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span className="profile-copy"><strong>{currentUser.name}</strong><small>{roleLabels[currentUser.role]} · {scopeLabel}</small></span><ChevronDown size={16} /></button>
          {profileOpen && <div className="profile-menu"><div><strong>{roleLabels[currentUser.role]}</strong><span>{currentUser.email}</span></div>{hasPermission(currentUser, permissionConfig, 'reset_demo_data') && <button onClick={handleReset}><RotateCcw size={16} /> Reset data demo</button>}<button onClick={handleLogout}><LogOut size={16} /> Keluar</button></div>}
        </div>
      </header>
      <div className="demo-banner"><span>{dataMode === 'IMPORT_ONLY' ? 'IMPORT-ONLY' : 'DEMO'}</span> {dataMode === 'IMPORT_ONLY' ? 'Data workforce berasal dari import/transaksi lokal pada browser ini; tidak dikirim ke server.' : 'Seluruh data bersifat contoh dan bukan data aktual PT Gelatik Supra.'}</div>
      <main className="main-content"><Outlet /></main>
      <Toaster />
    </div>
  </div>
}
