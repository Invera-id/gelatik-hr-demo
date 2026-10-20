import type { Area, EmployeeMovement, Project } from '../../types'
import type { ReviewItem, SourceImportRecord } from './types'
import { findAreaId, findProjectId } from './referenceCatalog'

export interface DeriveContext {
  /** businessKey → master employee internal id. */
  employeeIdByKey: Map<string, string>
  areas: Area[]
  projects: Project[]
}

const IMPORT_SOURCE_LABEL = 'Import Excel'

/**
 * Derive confirmed career-timeline movements from CONFIRMED review items. This is
 * a VIEW over the IndexedDB review decisions — it performs no writes and never
 * mutates localStorage, so there is no cross-store atomicity to claim (§8, §13).
 *
 * Event ids are deterministic (`imp-ev:<reviewItemId>:<decisionVersion>`), so
 * re-confirming the same decision reconciles to one event instead of duplicating;
 * a corrected decision (higher version) produces a different id.
 */
export const deriveImportMovements = (
  reviewItems: ReviewItem[],
  sourceRecords: SourceImportRecord[],
  ctx: DeriveContext,
): EmployeeMovement[] => {
  const sourceById = new Map(sourceRecords.map((s) => [s.id, s]))
  const byId = new Map<string, EmployeeMovement>()

  for (const item of reviewItems) {
    if (item.status !== 'CONFIRMED' || !item.resolution) continue
    const res = item.resolution
    // An identical-duplicate / dismissed / kept-pending decision produces no event.
    if (res.decisionKind === 'IDENTICAL_DUPLICATE' || res.decisionKind === 'PROFILE_VARIATION') continue
    const employeeId = ctx.employeeIdByKey.get(item.businessKey)
    if (!employeeId) continue

    const before = res.beforeRecordId ? sourceById.get(res.beforeRecordId) : undefined
    const after = res.afterRecordId ? sourceById.get(res.afterRecordId) : undefined
    const beforeFields = res.beforeRecordId === 'CURRENT_MASTER' ? item.currentMasterFields ?? undefined : before?.fields

    const movementType =
      res.decisionKind === 'EXIT' ? 'EXIT'
        : res.decisionKind === 'REENTRY' ? 'REENTRY'
          : res.movementType ?? 'MUTATION'

    const effectiveDate = res.effectiveDate
    if (!effectiveDate) continue

    const id = `imp-ev:${item.id}:${res.decisionVersion}`
    byId.set(id, {
      id,
      employeeId,
      movementType,
      effectiveDate,
      previousAreaId: findAreaId(beforeFields?.areaCbs, ctx.areas),
      newAreaId: findAreaId(after?.fields.areaCbs, ctx.areas),
      previousProjectId: findProjectId(beforeFields?.projectName, findAreaId(beforeFields?.areaCbs, ctx.areas), ctx.projects),
      newProjectId: findProjectId(after?.fields.projectName, findAreaId(after?.fields.areaCbs, ctx.areas), ctx.projects),
      previousPosition: beforeFields?.position ?? null,
      newPosition: after?.fields.position ?? null,
      notes: `${IMPORT_SOURCE_LABEL} — ${res.note || item.reason || item.kind.replaceAll('_', ' ')}`,
      createdBy: res.reviewedBy,
      createdAt: item.updatedAt,
    })
  }

  return [...byId.values()]
}
