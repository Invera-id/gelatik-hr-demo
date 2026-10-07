import { BarChart3, Bell, BriefcaseBusiness, ChevronDown, ClipboardCheck, Download, FileUp, History, KeyRound, LogOut, Menu, RotateCcw, Settings2, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { areas } from '../data/demoData'
import { roleLabels } from '../lib/businessRules'
import { useDemo } from '../context/DemoContext'
import { hasPermission } from '../config/access'
import type { Permission } from '../types'
import { terminology as term } from '../config/terminology'
import { NotificationBell } from './NotificationBell'
import { Toaster } from './Toaster'

const navItems: Array<{ to: string; label: string; icon: typeof BarChart3; permission?: Permission | Permission[]; superOnly?: boolean }> = [
  { to: '/dashboard', label: 'Dashboard', icon: BarChart3, permission: 'view_dashboard' },
  { to: '/employees', label: term.employeeMaster, icon: Users, permission: 'view_employee' },
  { to: '/projects', label: 'Projects', icon: BriefcaseBusiness, permission: 'view_employee' },
  { to: '/reports/analytics', label: 'Analytics / Reports', icon: BarChart3, permission: 'view_employee' },
  { to: '/employees/new', label: term.employeeEntry, icon: UserPlus, permission: 'create_employee' },
  { to: '/import', label: 'Import Excel', icon: FileUp, permission: 'create_employee' },
  { to: '/notifications', label: 'Notifikasi', icon: Bell, permission: 'view_dashboard' },
  { to: '/movements', label: term.movementHistory, icon: History, permission: 'view_employee' },
  { to: '/validation', label: term.validation, icon: ClipboardCheck, permission: ['validate_employee', 'validate_exit'] },
  { to: '/replacements', label: term.replacementFulfillment, icon: BriefcaseBusiness, permission: 'view_replacement' },
  { to: '/reports/export', label: 'Reports / Export', icon: Download, permission: 'export_data' },
  { to: '/settings/access', label: 'Access & Roles', icon: KeyRound, superOnly: true },
  { to: '/settings/validation', label: 'Validation Policy', icon: Settings2, superOnly: true },
]

export function AppLayout() {
  const { currentUser, logout, resetDemo, permissionConfig } = useDemo()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  if (!currentUser) return null
  const area = areas.find((item) => item.id === currentUser.areaId)
  const access = permissionConfig.find((item) => item.role === currentUser.role)
  const scopeLabel = access?.scope === 'ALL_AREAS' ? 'All Areas' : access?.scope === 'SELECTED_AREAS' ? `${access.selectedAreaIds.length} Selected Areas` : area?.name ?? 'Own Area'
  const handleLogout = () => { logout(); navigate('/login') }
  const handleReset = () => {
    if (window.confirm('Reset seluruh perubahan dan kembali ke data demo awal?')) resetDemo()
    setProfileOpen(false)
  }
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <div className="brand"><div className="brand-mark">GS</div><div><strong>Gelatik HR</strong><span>Workforce Monitor</span></div><button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="Tutup menu"><X size={20} /></button></div>
      <nav className="sidebar-nav"><span className="nav-caption">WORKSPACE</span>
        {navItems.filter((item) => item.to === '/import' ? ['HR_HO', 'SUPER_ADMIN'].includes(currentUser.role) && hasPermission(currentUser, permissionConfig, 'create_employee') : item.superOnly ? currentUser.role === 'SUPER_ADMIN' : item.permission && (Array.isArray(item.permission) ? item.permission.some((permission) => hasPermission(currentUser, permissionConfig, permission)) : hasPermission(currentUser, permissionConfig, item.permission))).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMobileOpen(false)} className={({ isActive }) => isActive || (to === '/employees' && location.pathname.startsWith('/employees/') && location.pathname !== '/employees/new') ? 'active' : ''}><Icon size={19} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-note"><span className="pulse-dot" /><div><strong>Penyimpanan lokal</strong><small>Data tersimpan di browser ini</small></div></div>
    </aside>
    {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Tutup menu" />}
    <div className="app-content">
      <header className="topbar"><button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="Buka menu"><Menu size={21} /></button><div className="topbar-context"><span>PT GELATIK SUPRA</span><strong>HR Workforce Monitoring System</strong></div>
        <div className="topbar-actions"><NotificationBell /></div>
        <div className="profile-wrap"><button className="profile-button" onClick={() => setProfileOpen((open) => !open)}><span className="avatar">{currentUser.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span className="profile-copy"><strong>{currentUser.name}</strong><small>{roleLabels[currentUser.role]} · {scopeLabel}</small></span><ChevronDown size={16} /></button>
          {profileOpen && <div className="profile-menu"><div><strong>{roleLabels[currentUser.role]}</strong><span>{currentUser.email}</span></div><button onClick={handleReset}><RotateCcw size={16} /> Reset data demo</button><button onClick={handleLogout}><LogOut size={16} /> Keluar</button></div>}
        </div>
      </header>
      <div className="demo-banner"><span>DEMO</span> Seluruh data bersifat contoh dan bukan data aktual PT Gelatik Supra.</div>
      <main className="main-content"><Outlet /></main>
      <Toaster />
    </div>
  </div>
}
