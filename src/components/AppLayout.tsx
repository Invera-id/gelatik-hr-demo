import { BarChart3, BriefcaseBusiness, ChevronDown, ClipboardCheck, LogOut, Menu, RotateCcw, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { areas } from '../data/demoData'
import { roleLabels } from '../lib/businessRules'
import { useDemo } from '../context/DemoContext'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: BarChart3, roles: ['AREA_SUPPORT', 'HR_HO', 'MANAGEMENT'] },
  { to: '/employees', label: 'Master Employee', icon: Users, roles: ['AREA_SUPPORT', 'HR_HO', 'MANAGEMENT'] },
  { to: '/employees/new', label: 'Employee Entry', icon: UserPlus, roles: ['AREA_SUPPORT', 'HR_HO'] },
  { to: '/validation', label: 'HR Validation', icon: ClipboardCheck, roles: ['HR_HO'] },
  { to: '/replacements', label: 'Replacement & Fulfillment', icon: BriefcaseBusiness, roles: ['AREA_SUPPORT', 'HR_HO', 'MANAGEMENT'] },
]

export function AppLayout() {
  const { currentUser, logout, resetDemo } = useDemo()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  if (!currentUser) return null
  const area = areas.find((item) => item.id === currentUser.areaId)
  const handleLogout = () => { logout(); navigate('/login') }
  const handleReset = () => {
    if (window.confirm('Reset seluruh perubahan dan kembali ke data demo awal?')) resetDemo()
    setProfileOpen(false)
  }
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <div className="brand"><div className="brand-mark">GS</div><div><strong>Gelatik HR</strong><span>Workforce Monitor</span></div><button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="Tutup menu"><X size={20} /></button></div>
      <nav className="sidebar-nav"><span className="nav-caption">WORKSPACE</span>
        {navItems.filter((item) => item.roles.includes(currentUser.role)).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMobileOpen(false)} className={({ isActive }) => isActive || (to === '/employees' && location.pathname.startsWith('/employees/') && location.pathname !== '/employees/new') ? 'active' : ''}><Icon size={19} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-note"><span className="pulse-dot" /><div><strong>Demo Environment</strong><small>Data simulasi tersimpan lokal</small></div></div>
    </aside>
    {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Tutup menu" />}
    <div className="app-content">
      <header className="topbar"><button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="Buka menu"><Menu size={21} /></button><div className="topbar-context"><span>PT GELATIK SUPRA</span><strong>HR Workforce Monitoring System</strong></div>
        <div className="profile-wrap"><button className="profile-button" onClick={() => setProfileOpen((open) => !open)}><span className="avatar">{currentUser.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span className="profile-copy"><strong>{currentUser.name}</strong><small>{area?.name ?? roleLabels[currentUser.role]}</small></span><ChevronDown size={16} /></button>
          {profileOpen && <div className="profile-menu"><div><strong>{roleLabels[currentUser.role]}</strong><span>{currentUser.email}</span></div><button onClick={handleReset}><RotateCcw size={16} /> Reset data demo</button><button onClick={handleLogout}><LogOut size={16} /> Keluar</button></div>}
        </div>
      </header>
      <div className="demo-banner"><span>DEMO</span> Seluruh data yang ditampilkan merupakan data dummy untuk simulasi requirement dan bukan data aktual PT Gelatik Supra.</div>
      <main className="main-content"><Outlet /></main>
    </div>
  </div>
}

