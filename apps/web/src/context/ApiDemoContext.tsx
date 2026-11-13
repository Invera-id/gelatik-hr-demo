import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, download, errorMessage, request, setCsrfToken, setUnauthorizedHandler, type Schemas } from '../api/client'
import { DemoContext, type ActionResult, type DemoContextValue } from './DemoContext'
import { toBusinessKey } from '../lib/import/parse'
import type { ImportPhase, ImportRunResult, PrepareImportResult, PreparedImport } from '../lib/import/service'
import type { ImportBatch, ImportException, ReviewItem, SourceImportRecord } from '../lib/import/types'
import type { ImportPlan } from '../lib/import/reconcile'
import type { Area, DemoUser, Employee, EmployeeExit, EmployeeFlag, EmployeeMovement, EmployeeNote, EmployeeProfile, MovementEvent, PendingChange, PlacementChangeRequest, Project, ProjectQuota, ReplacementNeed, RolePermissionConfig, ValidationPolicy } from '../types'

/**
 * API-mode implementation of the page contract. The PostgreSQL-backed server is
 * the only source of business data: nothing is written to localStorage or
 * IndexedDB, and failures surface as errors instead of falling back to local data.
 * Role, permission and scope shown here are UX hints; the server enforces them.
 */

type Me = Schemas['Me']

interface Snapshot {
  employees: Employee[]
  employeeExits: EmployeeExit[]
  replacementNeeds: ReplacementNeed[]
  employeeMovements: EmployeeMovement[]
  movementRequests: PlacementChangeRequest[]
  movements: MovementEvent[]
  employeeNotes: EmployeeNote[]
  employeeFlags: EmployeeFlag[]
}

interface Workspace {
  businessDate: string
  users: Array<{ id: string; name: string; role: DemoUser['role'] }>
  areas: Area[]
  projects: Project[]
  projectQuotas: ProjectQuota[]
  permissionConfig: RolePermissionConfig[]
  validationPolicy: ValidationPolicy
}

const emptySnapshot: Snapshot = { employees: [], employeeExits: [], replacementNeeds: [], employeeMovements: [], movementRequests: [], movements: [], employeeNotes: [], employeeFlags: [] }

const toEmployee = (e: Schemas['Employee']): Employee => ({
  ...e,
  profile: (e.profile ?? {}) as EmployeeProfile,
  pendingChange: e.pendingChange as PendingChange | undefined,
})

const toSnapshot = (s: Schemas['Snapshot']): Snapshot => ({
  employees: s.employees.map(toEmployee),
  employeeExits: s.employeeExits as EmployeeExit[],
  replacementNeeds: s.replacementNeeds as ReplacementNeed[],
  employeeMovements: s.employeeMovements as EmployeeMovement[],
  movementRequests: s.movementRequests as PlacementChangeRequest[],
  movements: s.movements as MovementEvent[],
  employeeNotes: s.employeeNotes,
  employeeFlags: s.employeeFlags,
})

const toUser = (me: Me): DemoUser => ({ id: me.user.id, name: me.user.name, email: me.email, password: '', role: me.user.role, areaId: me.user.areaId })

const emptyStructured = { scores: {}, measures: {}, booleans: {}, tenureMonths: null }

const toSource = (r: Schemas['SourceRecord']): SourceImportRecord => ({ ...r, raw: {}, fields: r.fields as Record<string, string | null>, structured: emptyStructured, warnings: r.warnings as SourceImportRecord['warnings'] })

const toReview = (r: Schemas['ReviewItem']): ReviewItem => r as unknown as ReviewItem

const ok = (id?: string): ActionResult => ({ ok: true, id })
const BULK_VALIDATE_LIMIT = 1000 // server limit per /employees/validate-bulk request

const fail = (error: unknown): ActionResult => ({ ok: false, error: errorMessage(error), fields: error instanceof ApiError ? error.fields : undefined })

export function ApiDemoProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot)
  const [importReviewItems, setImportReviewItems] = useState<ReviewItem[]>([])
  const [importSourceRecords, setImportSourceRecords] = useState<SourceImportRecord[]>([])
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([])
  const [importExceptions, setImportExceptions] = useState<ImportException[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const generation = useRef(0)

  const clearSession = useCallback(() => {
    generation.current++
    setCsrfToken(null)
    setMe(null)
    setWorkspace(null)
    setSnapshot(emptySnapshot)
    setImportReviewItems([])
    setImportSourceRecords([])
    setImportBatches([])
    setImportExceptions([])
  }, [])

  const refresh = useCallback(async (session: Me | null = me) => {
    if (!session) return
    const gen = generation.current
    try {
      const canImport = session.permissions.includes('import_personnel') || session.permissions.includes('view_import_review')
      const [ws, snap, overview] = await Promise.all([
        request<Workspace>('/workspace'),
        request<Schemas['Snapshot']>('/snapshot'),
        canImport ? request<Schemas['ImportOverview']>('/imports', { query: { status: 'PENDING,KEPT_PENDING,CONFIRMED,DISMISSED' } }) : Promise.resolve(null),
      ])
      if (gen !== generation.current) return // a newer session/refresh superseded this response
      setWorkspace(ws)
      setSnapshot(toSnapshot(snap))
      if (overview) {
        setImportReviewItems(overview.reviewItems.map(toReview))
        setImportSourceRecords(overview.sourceRecords.map(toSource))
        setImportBatches(overview.batches as unknown as ImportBatch[])
      }
      setLoadError(null)
    } catch (error) {
      if (gen === generation.current) setLoadError(errorMessage(error))
    }
  }, [me])

  // Restore an existing server session (cookie) on load; a 401 anywhere clears it.
  useEffect(() => {
    setUnauthorizedHandler(clearSession)
    let cancelled = false
    request<Me>('/auth/me')
      .then(async (session) => {
        if (cancelled) return
        setCsrfToken(session.csrfToken)
        setMe(session)
        await refresh(session)
      })
      .catch(() => { /* no session */ })
      .finally(() => { if (!cancelled) setSessionChecked(true) })
    return () => { cancelled = true; setUnauthorizedHandler(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep other sessions' changes visible: refresh on focus and periodically.
  useEffect(() => {
    if (!me) return
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onFocus)
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    return () => { document.removeEventListener('visibilitychange', onFocus); window.clearInterval(timer) }
  }, [me, refresh])

  const run = useCallback(async (fn: () => Promise<string | void>): Promise<ActionResult> => {
    try {
      const id = await fn()
      await refresh()
      return ok(id ?? undefined)
    } catch (error) {
      await refresh()
      return fail(error)
    }
  }, [refresh])

  const employees = snapshot.employees
  const findEmployee = useCallback((id: string) => employees.find((e) => e.id === id), [employees])
  const roleConfig = useCallback((role: RolePermissionConfig['role']) => workspace?.permissionConfig.find((c) => c.role === role), [workspace])

  const preparePersonnelImport = useCallback(async (file: File, onProgress?: (phase: ImportPhase) => void): Promise<PrepareImportResult> => {
    if (!/\.xlsx$/i.test(file.name)) return { ok: false, prepared: null, error: 'Format .xls tidak didukung. Simpan ulang workbook sebagai .xlsx lalu coba lagi.' }
    try {
      onProgress?.('READING')
      const form = new FormData()
      form.append('file', file)
      onProgress?.('PARSING')
      const pv = await request<Schemas['ImportPreview']>('/imports/previews', { method: 'POST', form })
      const plan: ImportPlan = {
        mastersToPut: [], sourceRecordsToPut: [],
        reviewItemsToPut: pv.reviewItems.map((r) => ({ ...r, businessKey: toBusinessKey(r.personnelId), recordIds: [], areaId: null, diffFields: [], dates: [], candidate: null, status: 'PENDING', resolution: null, createdAt: '', updatedAt: '' }) as ReviewItem),
        exceptions: pv.exceptions.map((e) => ({ ...e, batchId: '', createdAt: '' })),
        summary: pv.summary, status: pv.status,
        batch: { id: '', fileName: pv.summary.fileName, sheetName: pv.summary.sheetName, status: pv.status, summary: pv.summary, createdAt: '' },
      }
      const prepared: PreparedImport = {
        plan, repositorySnapshot: '', previewId: pv.previewId, warnings: pv.warnings as PreparedImport['warnings'], warningsTotal: pv.warningsTotal,
        discoveredAreas: pv.discoveredAreas, discoveredProjects: pv.discoveredProjects.map((p) => ({ ...p, subArea: p.subArea ?? null, status: 'ACTIVE' as const, startDate: null, endDate: null })),
        scopePreview: pv.scopePreview as PreparedImport['scopePreview'], allowedAreaNames: null,
      }
      onProgress?.('PREVIEW')
      return { ok: true, prepared, error: null }
    } catch (error) {
      return { ok: false, prepared: null, error: errorMessage(error) }
    }
  }, [])

  const confirmPersonnelImport = useCallback(async (prepared: PreparedImport, onProgress?: (phase: ImportPhase) => void): Promise<ImportRunResult> => {
    try {
      onProgress?.('SAVING')
      const res = await request<Schemas['ImportCommit']>('/imports/commit', { method: 'POST', body: { previewId: prepared.previewId } })
      const exceptions = await request<{ items: Schemas['ImportException'][] }>(`/imports/batches/${encodeURIComponent(res.batchId)}/exceptions`)
      const mapped = exceptions.items.map((e) => ({ ...e, batchId: res.batchId, createdAt: '' }))
      setImportExceptions(mapped)
      await refresh()
      onProgress?.('DONE')
      return { ok: true, batch: { id: res.batchId, fileName: res.summary.fileName, sheetName: res.summary.sheetName, status: res.status, summary: res.summary, createdAt: new Date().toISOString() }, summary: res.summary, status: res.status, exceptions: mapped, error: null }
    } catch (error) {
      return { ok: false, batch: null, summary: null, status: null, exceptions: [], error: errorMessage(error) }
    }
  }, [refresh])

  const fetchEmployeeDetail = useCallback(async (id: string) => {
    try {
      const detail = await request<Schemas['EmployeeDetail']>(`/employees/${encodeURIComponent(id)}`)
      return toEmployee(detail.employee)
    } catch {
      return null
    }
  }, [])

  const currentUser = useMemo(() => (me ? toUser(me) : null), [me])

  const value: DemoContextValue = {
    dataMode: 'API', dataSource: 'api',
    businessDate: workspace?.businessDate ?? new Date().toISOString().slice(0, 10),
    users: workspace?.users ?? [],
    areas: workspace?.areas ?? [], projects: workspace?.projects ?? [], projectQuotas: workspace?.projectQuotas ?? [],
    permissionConfig: workspace?.permissionConfig ?? (me ? [{ role: me.user.role, scope: me.scope, selectedAreaIds: me.allowedAreaIds ?? [], permissions: me.permissions }] : []),
    validationPolicy: workspace?.validationPolicy ?? { EMPLOYEE_ENTRY: 'HR_HO', EMPLOYEE_BASIC_EDIT: 'AREA_ADMIN', EMPLOYEE_PLACEMENT_CHANGE: 'HR_HO', EMPLOYEE_EXIT: 'HR_HO' },
    ...snapshot,
    currentUser,
    authError,
    importedPersonnel: [], importBatches, importExceptions, importReviewItems, importSourceRecords,
    importStorageReady: sessionChecked, importStorageError: loadError,
    canImportPersonnel: Boolean(me?.permissions.includes('import_personnel')),
    login: async (email, password) => {
      try {
        clearSession()
        const session = await request<Me>('/auth/login', { method: 'POST', body: { email, password } })
        setCsrfToken(session.csrfToken)
        setMe(session)
        setAuthError(null)
        await refresh(session)
        return true
      } catch (error) {
        setAuthError(errorMessage(error))
        return false
      }
    },
    logout: () => {
      void request('/auth/logout', { method: 'POST' }).catch(() => undefined).finally(clearSession)
    },
    resetDemo: () => undefined, // not available against the real database
    importEmployees: () => undefined,
    importPersonnelFile: async (file, onProgress) => {
      const prepared = await preparePersonnelImport(file, onProgress)
      return prepared.ok && prepared.prepared ? confirmPersonnelImport(prepared.prepared, onProgress) : { ok: false, batch: null, summary: null, status: null, exceptions: [], error: prepared.error }
    },
    preparePersonnelImport,
    confirmPersonnelImport,
    refreshPersonnel: () => refresh(),
    pendingReviewFor: (employeeId) => {
      const e = findEmployee(employeeId)
      if (!e) return []
      const key = toBusinessKey(e.personnelId)
      return importReviewItems.filter((r) => r.businessKey === key && ['PENDING', 'KEPT_PENDING'].includes(r.status))
    },
    resolveReviewItem: async (id, decision) => {
      try {
        await request(`/imports/reviews/${encodeURIComponent(id)}/decision`, { method: 'POST', body: decision })
        await refresh()
        return null
      } catch (error) {
        return errorMessage(error)
      }
    },
    // The server accepts at most BULK_VALIDATE_LIMIT ids per request; larger queues are sent
    // in sequential batches. A failure stops the run and is reported with the partial count.
    validateEmployees: async (ids) => {
      let validated = 0
      try {
        for (let start = 0; start < ids.length; start += BULK_VALIDATE_LIMIT) {
          const res = await request<{ validated: number }>('/employees/validate-bulk', { method: 'POST', body: { ids: ids.slice(start, start + BULK_VALIDATE_LIMIT) } })
          validated += res.validated
        }
        return validated
      } catch (error) {
        throw new Error(`${validated} employee sudah divalidasi sebelum proses berhenti: ${errorMessage(error)}`, { cause: error })
      } finally {
        await refresh()
      }
    },
    fetchEmployeeDetail,
    downloadExport: (kind, query) => download(`/exports/${encodeURIComponent(kind.toLowerCase())}`, query),

    saveEmployee: (employee, measures) => run(async () => {
      const existing = findEmployee(employee.id)
      const body = {
        personnelId: employee.personnelId, name: employee.name, areaId: employee.areaId, projectId: employee.projectId, position: employee.position,
        subArea: employee.subArea, joinDate: employee.joinDate, contractStartDate: employee.contractStartDate, contractEndDate: employee.contractEndDate,
        contractStatus: employee.contractStatus, bpjsStatus: employee.bpjsStatus, submit: employee.validationStatus === 'SUBMITTED',
        expectedVersion: existing?.version, ...(measures ? { height: measures.height, weight: measures.weight } : {}),
      }
      const saved = existing
        ? await request<Schemas['Employee']>(`/employees/${encodeURIComponent(existing.id)}`, { method: 'PUT', body })
        : await request<Schemas['Employee']>('/employees', { method: 'POST', body })
      return saved.id
    }),
    saveExit: (exit) => run(async () => {
      const saved = await request<Schemas['EmployeeExit']>(`/employees/${encodeURIComponent(exit.employeeId)}/exit-request`, { method: 'POST',
        body: { exitDate: exit.exitDate, exitReason: exit.exitReason, replacementRequired: exit.replacementRequired, submit: exit.validationStatus === 'SUBMITTED' } })
      return saved.id
    }),
    setEmployeeValidation: (id, status, note) => run(async () => {
      const e = findEmployee(id)
      const pendingEdit = e?.validationStatus === 'VALIDATED' && e.pendingChange?.status === 'SUBMITTED' ? e.pendingChange : null
      if (pendingEdit) await request(`/change-requests/${encodeURIComponent(pendingEdit.requestId)}/validation`, { method: 'POST', body: { status, note } })
      else await request(`/employees/${encodeURIComponent(id)}/validation`, { method: 'POST', body: { status, note, expectedVersion: e?.version } })
    }),
    setExitValidation: (exitId, status, note) => run(async () => {
      await request(`/change-requests/${encodeURIComponent(exitId)}/validation`, { method: 'POST', body: { status, note } })
    }),
    setMovementValidation: (requestId, status, note) => run(async () => {
      await request(`/change-requests/${encodeURIComponent(requestId)}/validation`, { method: 'POST', body: { status, note } })
    }),
    matchCandidate: (needId, employeeId) => run(async () => {
      await request(`/replacements/${encodeURIComponent(needId)}/match`, { method: 'POST', body: { employeeId } })
    }),
    fulfillNeed: (needId) => run(async () => {
      await request(`/replacements/${encodeURIComponent(needId)}/fulfill`, { method: 'POST', body: {} })
    }),
    togglePermission: (role, permission) => run(async () => {
      const cfg = roleConfig(role)
      if (!cfg) return
      const permissions = cfg.permissions.includes(permission) ? cfg.permissions.filter((p) => p !== permission) : [...cfg.permissions, permission]
      await request(`/settings/roles/${role}`, { method: 'PUT', body: { scope: cfg.scope, selectedAreaIds: cfg.selectedAreaIds, permissions } })
    }),
    setRoleScope: (role, scope, selectedAreaIds) => run(async () => {
      const cfg = roleConfig(role)
      if (!cfg) return
      await request(`/settings/roles/${role}`, { method: 'PUT', body: { scope, selectedAreaIds: selectedAreaIds ?? cfg.selectedAreaIds, permissions: cfg.permissions } })
    }),
    resetPermissions: () => run(async () => { await request('/settings/roles/reset', { method: 'POST' }) }),
    setValidationPolicy: (transaction, authority) => run(async () => {
      await request(`/settings/validation-policy/${transaction}`, { method: 'PUT', body: { authority } })
    }),
    saveMovementRequest: (req) => run(async () => {
      const saved = await request<Schemas['PlacementChangeRequest']>(`/employees/${encodeURIComponent(req.employeeId)}/movement-request`, { method: 'POST',
        body: { movementType: req.movementType, effectiveDate: req.effectiveDate, newAreaId: req.newAreaId, newProjectId: req.newProjectId, newPosition: req.newPosition,
          notes: req.notes, submit: req.validationStatus === 'SUBMITTED', expectedVersion: findEmployee(req.employeeId)?.version } })
      return saved.id
    }),
    addEmployeeNote: (employeeId, notes) => run(async () => {
      await request(`/employees/${encodeURIComponent(employeeId)}/notes`, { method: 'POST', body: { notes, clientRef: crypto.randomUUID() } })
    }),
    setEmployeeFlag: (employeeId, status, reason, notes) => run(async () => {
      await request(`/employees/${encodeURIComponent(employeeId)}/flags`, { method: 'POST', body: { status, reason, notes, clientRef: crypto.randomUUID() } })
    }),
    reentryEmployee: (employeeId, areaId, projectId, position, joinDate, notes) => run(async () => {
      await request(`/employees/${encodeURIComponent(employeeId)}/reentry`, { method: 'POST', body: { areaId, projectId, position, joinDate, notes } })
    }),
    saveProject: (project) => run(async () => {
      const exists = workspace?.projects.some((p) => p.id === project.id)
      const body = { name: project.name, clientName: project.clientName, areaId: project.areaId, subArea: project.subArea, status: project.status, startDate: project.startDate, endDate: project.endDate }
      const saved = exists
        ? await request<Schemas['Project']>(`/projects/${encodeURIComponent(project.id)}`, { method: 'PUT', body })
        : await request<Schemas['Project']>('/projects', { method: 'POST', body })
      return saved.id
    }),
    setProjectStatus: (projectId, status) => run(async () => {
      await request(`/projects/${encodeURIComponent(projectId)}/status`, { method: 'POST', body: { status } })
    }),
    saveProjectQuota: (quota) => run(async () => {
      await request(`/projects/${encodeURIComponent(quota.projectId)}/quotas/${encodeURIComponent(quota.period)}`, { method: 'PUT', body: { quota: quota.quota } })
    }),
  }

  if (!sessionChecked) return <div className="app-loading" role="status">Memuat sesi…</div>
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}
