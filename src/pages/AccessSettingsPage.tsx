import { KeyRound, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useDemo } from '../context/DemoContext'
import { areas } from '../data/demoData'
import { allPermissions, permissionLabels, transactionLabels, validatorLabels } from '../config/access'
import { roleLabels } from '../lib/businessRules'
import type { Role, ScopeType, TransactionType, ValidatorAuthority } from '../types'

const roles: Role[] = ['AREA_SUPPORT', 'HR_HO', 'OPERATIONS_MANAGER', 'MANAGEMENT', 'SUPER_ADMIN']
const transactions = Object.keys(transactionLabels) as TransactionType[]

export function AccessSettingsPage({ mode = 'access' }: { mode?: 'access' | 'validation' }) {
  const { permissionConfig, validationPolicy, togglePermission, setRoleScope, resetPermissions, setValidationPolicy } = useDemo()

  if (mode === 'validation') return <>
    <PageHeader eyebrow="DEMO CONFIGURATION" title="Validation Policy" description="Atur contoh otoritas validasi tanpa membangun approval engine production." />
    <div className="alert info"><SlidersHorizontal /><div><strong>Demo Configuration — final validation authority TBC bersama Gelatik.</strong><p>Perubahan tersimpan lokal dan kembali ke default saat Reset Demo Data.</p></div></div>
    <section className="card policy-list">
      {transactions.map((transaction) => <div className="policy-row" key={transaction}><div><strong>{transactionLabels[transaction]}</strong><span>Siapa yang berwenang memvalidasi transaksi ini?</span></div><select value={validationPolicy[transaction]} onChange={(event) => setValidationPolicy(transaction, event.target.value as ValidatorAuthority)}>{Object.entries(validatorLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>)}
    </section>
  </>

  return <>
    <PageHeader eyebrow="SUPER ADMIN" title="Access & Roles" description="Atur permission dan data scope untuk setiap role." actions={<button className="button secondary" onClick={() => window.confirm('Reset permission ke konfigurasi awal?') && resetPermissions()}><RotateCcw /> Reset Permission</button>} />
    <section className="card permission-matrix"><div className="table-title"><div><span className="section-icon"><KeyRound /></span><div><h2>Permission Matrix</h2><p>Perubahan tersimpan di browser ini.</p></div></div></div><div className="table-scroll"><table><thead><tr><th>Permission</th>{roles.map((role) => <th key={role}>{roleLabels[role]}</th>)}</tr></thead><tbody>{allPermissions.map((permission) => <tr key={permission}><td><strong>{permissionLabels[permission]}</strong><small>{permission}</small></td>{roles.map((role) => { const enabled = permissionConfig.find((item) => item.role === role)?.permissions.includes(permission) ?? false; return <td key={role}><label className="permission-check"><input type="checkbox" checked={enabled} disabled={role === 'SUPER_ADMIN' && permission === 'manage_roles'} onChange={() => togglePermission(role, permission)} /><span>{enabled ? 'Aktif' : 'Nonaktif'}</span></label></td> })}</tr>)}</tbody></table></div></section>
    <div className="scope-grid">{roles.map((role) => { const item = permissionConfig.find((entry) => entry.role === role); if (!item) return null; return <section className="card scope-card" key={role}><div><strong>{roleLabels[role]}</strong><StatusBadge tone={item.scope === 'ALL_AREAS' ? 'success' : 'info'}>{item.scope.replaceAll('_', ' ')}</StatusBadge></div><label>Data scope<select value={item.scope} onChange={(event) => setRoleScope(role, event.target.value as ScopeType)}><option value="OWN_AREA">Own Area</option><option value="SELECTED_AREAS">Selected Areas</option><option value="ALL_AREAS">All Areas</option></select></label>{item.scope === 'SELECTED_AREAS' && <div className="area-checks">{areas.map((area) => <label key={area.id}><input type="checkbox" checked={item.selectedAreaIds.includes(area.id)} onChange={() => setRoleScope(role, item.scope, item.selectedAreaIds.includes(area.id) ? item.selectedAreaIds.filter((id) => id !== area.id) : [...item.selectedAreaIds, area.id])} /> {area.name}</label>)}</div>}</section> })}</div>
  </>
}
