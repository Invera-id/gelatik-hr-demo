import { Info, KeyRound, RotateCcw, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useDemo } from '../context/DemoContext'
import { lockedSuperAdminPermissions, permissionDefinitions, permissionModules, permissionSummary, scopeLabels, transactionLabels, validatorLabels } from '../config/access'
import { roleLabels } from '../lib/businessRules'
import type { Role, ScopeType, TransactionType, ValidatorAuthority } from '../types'

const roles: Role[] = ['AREA_SUPPORT', 'HR_HO', 'OPERATIONS_MANAGER', 'MANAGEMENT', 'SUPER_ADMIN']
const transactions = Object.keys(transactionLabels) as TransactionType[]

export function AccessSettingsPage({ mode = 'access' }: { mode?: 'access' | 'validation' }) {
  const { areas, permissionConfig, validationPolicy, togglePermission, setRoleScope, resetPermissions, setValidationPolicy } = useDemo()

  if (mode === 'validation') return <>
    <PageHeader eyebrow="DEMO CONFIGURATION" title="Validation Policy" description="Atur contoh otoritas validasi tanpa membangun approval engine production." />
    <div className="alert info"><SlidersHorizontal /><div><strong>Demo Configuration — final validation authority TBC bersama Gelatik.</strong><p>Perubahan tersimpan lokal dan kembali ke default saat Reset Demo Data.</p></div></div>
    <section className="card policy-list">
      {transactions.map((transaction) => <div className="policy-row" key={transaction}><div><strong>{transactionLabels[transaction]}</strong><span>Siapa yang berwenang memvalidasi transaksi ini?</span></div><select value={validationPolicy[transaction]} onChange={(event) => setValidationPolicy(transaction, event.target.value as ValidatorAuthority)}>{Object.entries(validatorLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>)}
    </section>
  </>

  return <>
    <PageHeader eyebrow="KONFIGURASI DEMO" title="Access & Roles" description="Atur kemampuan setiap role dan batas Area data yang dapat digunakan." actions={<button className="button secondary" onClick={() => window.confirm('Reset permission ke konfigurasi awal?') && resetPermissions()}><RotateCcw /> Reset Permission Configuration</button>} />
    <div className="alert info"><Info /><div><strong>Prototype RBAC berbasis browser</strong><p>Konfigurasi role pada prototype digunakan untuk simulasi kebutuhan. Struktur permission dan otorisasi production akan ditentukan kembali bersama PT Gelatik Supra.</p></div></div>

    <section className="access-role-strip" aria-label="Ringkasan akses role">{roles.map((role) => { const item = permissionConfig.find((entry) => entry.role === role); if (!item) return null; return <article className="card access-role-summary" key={role}><div><strong>{roleLabels[role]}</strong><StatusBadge tone={item.scope === 'ALL_AREAS' ? 'success' : 'info'}>{scopeLabels[item.scope]}</StatusBadge></div><span>{permissionSummary(item.permissions)}</span><small>{item.permissions.length} permission aktif</small></article> })}</section>

    <div className="scope-grid">{roles.map((role) => { const item = permissionConfig.find((entry) => entry.role === role); if (!item) return null; return <section className="card scope-card" key={role}><div><strong>{roleLabels[role]}</strong><StatusBadge tone={item.scope === 'ALL_AREAS' ? 'success' : 'info'}>{scopeLabels[item.scope]}</StatusBadge></div><label>Cakupan data<select value={item.scope} onChange={(event) => setRoleScope(role, event.target.value as ScopeType)}><option value="OWN_AREA">Area Sendiri</option><option value="SELECTED_AREAS">Area Terpilih</option><option value="ALL_AREAS">Semua Area</option></select></label>{item.scope === 'SELECTED_AREAS' && <div className="area-checks">{areas.map((area) => <label key={area.id}><input type="checkbox" checked={item.selectedAreaIds.includes(area.id)} onChange={() => setRoleScope(role, item.scope, item.selectedAreaIds.includes(area.id) ? item.selectedAreaIds.filter((id) => id !== area.id) : [...item.selectedAreaIds, area.id])} /> {area.name}</label>)}</div>}</section> })}</div>

    <section className="card permission-matrix"><div className="table-title"><div><span className="section-icon"><KeyRound /></span><div><h2>Matriks Permission</h2><p>Permission dikelompokkan berdasarkan modul. Perubahan berlaku pada menu, route, dan action aplikasi.</p></div></div></div><div className="table-scroll"><table><thead><tr><th>Permission</th>{roles.map((role) => <th key={role}>{roleLabels[role]}</th>)}</tr></thead><tbody>{permissionModules.flatMap((module) => {
      const definitions = permissionDefinitions.filter((permission) => permission.module === module)
      return [<tr className="permission-module-row" key={`module-${module}`}><th colSpan={roles.length + 1}>{module}</th></tr>, ...definitions.map((definition) => <tr key={definition.key}><td><strong>{definition.label}</strong>{definition.description && <span>{definition.description}</span>}<small>{definition.key}</small></td>{roles.map((role) => { const enabled = permissionConfig.find((item) => item.role === role)?.permissions.includes(definition.key) ?? false; const locked = role === 'SUPER_ADMIN' && lockedSuperAdminPermissions.includes(definition.key); return <td key={role}><label className={`permission-check ${locked ? 'is-locked' : ''}`}><input type="checkbox" checked={enabled} disabled={locked} onChange={() => togglePermission(role, definition.key)} /><span>{locked ? <><ShieldCheck size={14} /> Wajib aktif</> : enabled ? 'Aktif' : 'Nonaktif'}</span></label></td> })}</tr>)]
    })}</tbody></table></div></section>
  </>
}
