import type { Area, Project } from '../../types'
import type { ParsedSourceRecord } from './parse'

const normalize = (value: string | null | undefined): string =>
  (value ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('id-ID')

const stableHash = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export interface ImportReferenceCatalog {
  areas: Area[]
  projects: Project[]
  discoveredAreas: Area[]
  discoveredProjects: Project[]
}

/**
 * In import-only mode the workbook is the placement reference source. Build stable
 * Area/Project ids from business labels without embedding company data in source.
 * A project is scoped by Area so equal project labels in different areas do not merge.
 */
export const buildImportReferenceCatalog = (
  records: ParsedSourceRecord[],
  existingAreas: Area[],
  existingProjects: Project[],
): ImportReferenceCatalog => {
  const areas = existingAreas.map((area) => ({ ...area }))
  const projects = existingProjects.map((project) => ({ ...project }))
  const discoveredAreas: Area[] = []
  const discoveredProjects: Project[] = []

  const areaByName = new Map(areas.map((area) => [normalize(area.name), area]))
  const projectByPlacement = new Map(projects.map((project) => [`${project.areaId}|${normalize(project.name)}`, project]))

  for (const record of records) {
    const areaName = record.fields.areaCbs?.trim()
    if (!areaName) continue
    const areaKey = normalize(areaName)
    let area = areaByName.get(areaKey)
    if (!area) {
      area = { id: `import-area-${stableHash(areaKey)}`, name: areaName }
      areas.push(area)
      discoveredAreas.push(area)
      areaByName.set(areaKey, area)
    }

    const projectName = record.fields.projectName?.trim()
    if (!projectName) continue
    const projectKey = `${area.id}|${normalize(projectName)}`
    if (projectByPlacement.has(projectKey)) continue
    const project: Project = {
      id: `import-project-${stableHash(projectKey)}`,
      name: projectName,
      clientName: record.fields.clientName?.trim() || 'Belum tersedia',
      areaId: area.id,
      subArea: record.fields.subArea?.trim() || null,
      status: 'ACTIVE',
      startDate: null,
      endDate: null,
    }
    projects.push(project)
    discoveredProjects.push(project)
    projectByPlacement.set(projectKey, project)
  }

  return { areas, projects, discoveredAreas, discoveredProjects }
}

export const findAreaId = (name: string | null | undefined, areas: Area[]): string | null => {
  const key = normalize(name)
  return key ? areas.find((area) => normalize(area.name) === key || normalize(area.id) === key)?.id ?? null : null
}

export const findProjectId = (
  name: string | null | undefined,
  areaId: string | null,
  projects: Project[],
): string | null => {
  const key = normalize(name)
  if (!key) return null
  return projects.find((project) => normalize(project.name) === key && (!areaId || project.areaId === areaId))?.id
    ?? projects.find((project) => normalize(project.id) === key)?.id
    ?? null
}
