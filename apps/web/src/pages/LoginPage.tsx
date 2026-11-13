import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useDemo } from '../context/DemoContext'
import { demoUsers } from '../data/demoData'
import { roleLabels } from '../lib/businessRules'

export function LoginPage() {
  const { currentUser, login, authError, dataSource } = useDemo()
  // Local prototype keeps its fixed demo password; API mode never pre-fills credentials.
  const localMode = dataSource === 'local'
  const showDemoAccounts = localMode || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true'
  const [email, setEmail] = useState(localMode ? 'hr@demo.test' : '')
  const [password, setPassword] = useState(localMode ? 'password' : '')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  if (currentUser) return <Navigate to="/dashboard" replace />
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    const ok = await login(email, password)
    setSubmitting(false)
    if (ok) navigate('/dashboard')
    else setError(authError || 'Email atau password tidak sesuai.')
  }
  const selectAccount = (user: typeof demoUsers[number]) => { setEmail(user.email); setPassword(localMode ? user.password : ''); setError('') }
  return <div className="login-page">
    <section className="login-showcase">
      <div className="login-brand"><span className="brand-mark light">GS</span><div><strong>PT Gelatik Supra</strong><small>Powered by Invera</small></div></div>
      <div className="showcase-copy"><span className="overline">HR OPERATIONS PLATFORM</span><h1>Workforce visibility,<br />from movement to fulfillment.</h1><p>Pantau pergerakan karyawan, validasi data, dan kebutuhan replacement dalam satu alur kerja yang jelas.</p>
        <div className="showcase-points"><span><CheckCircle2 /> Source data transparency</span><span><CheckCircle2 /> Role-based workflow</span><span><CheckCircle2 /> Working-day SLA monitoring</span></div>
      </div>
      <div className="showcase-foot"><ShieldCheck size={18} /> Demo untuk validasi requirement — seluruh data bersifat fiktif.</div>
    </section>
    <main className="login-panel"><div className="login-card"><div className="login-heading"><span className="login-icon"><LockKeyhole /></span><h2>Masuk ke workspace</h2><p>Gunakan salah satu akun demo untuk melihat akses berdasarkan peran.</p></div>
      <form onSubmit={submit}><label>Email pengguna<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" onClick={() => setShowPassword((show) => !show)} aria-label="Tampilkan password">{showPassword ? <EyeOff /> : <Eye />}</button></div></label>{error && <div className="form-error">{error}</div>}<button className="button primary wide" type="submit">Masuk ke Dashboard <ArrowRight size={18} /></button></form>
      {showDemoAccounts && <><div className="account-divider"><span>Akun demo cepat</span></div><div className="demo-accounts">{demoUsers.map((user) => <button key={user.id} onClick={() => selectAccount(user)} className={email === user.email ? 'selected' : ''}><span className="account-avatar">{{ AREA_SUPPORT: 'AR', HR_HO: 'HR', OPERATIONS_MANAGER: 'OP', MANAGEMENT: 'BD', SUPER_ADMIN: 'SA' }[user.role]}</span><span><strong>{roleLabels[user.role]}</strong><small>{user.email}</small></span><ArrowRight size={15} /></button>)}</div></>}
    </div></main>
  </div>
}
