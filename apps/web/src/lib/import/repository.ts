import type { ImportBatch, ImportException, ReviewItem, ReviewResolution, ReviewStatus, SourceImportRecord, StoredPersonnel } from './types'
import { ImportAbortError } from './types'
import type { ImportPlan } from './reconcile'

/**
 * Storage abstraction for imported personnel. The import feature depends only on
 * this interface, so the IndexedDB implementation can later be swapped for an
 * HTTP/backend implementation without rewriting the parser, normalizers, mapping,
 * reconciliation, review, or UI.
 */
export interface PersonnelRepository {
  getAllPersonnel(): Promise<StoredPersonnel[]>
  getBatches(): Promise<ImportBatch[]>
  getExceptions(batchId?: string): Promise<ImportException[]>
  getSourceRecords(businessKey?: string): Promise<SourceImportRecord[]>
  getReviewItems(status?: ReviewStatus): Promise<ReviewItem[]>
  /** Apply an import plan atomically: masters, source records, review items, batch, exceptions. */
  commit(plan: ImportPlan): Promise<void>
  /** Update one review item's status + resolution (idempotent re-confirmation via decisionVersion). Returns the stored item. */
  resolveReviewItem(id: string, status: ReviewStatus, resolution: ReviewResolution | null): Promise<ReviewItem | null>
  /** Resolve review and patch its current master in one IndexedDB transaction. */
  resolveReviewAndPatch(id: string, businessKey: string, status: ReviewStatus, resolution: ReviewResolution, patch: Partial<StoredPersonnel['employee']>): Promise<ReviewItem | null>
  isSeeded(): Promise<boolean>
  markSeeded(): Promise<void>
  seedPersonnel(records: StoredPersonnel[]): Promise<void>
  /** Apply a partial update to the stored employee with this internal id (no-op if absent). */
  patchEmployee(employeeId: string, patch: Partial<StoredPersonnel['employee']>): Promise<boolean>
  /** Apply one patch to several imported employees in a single transaction. */
  patchEmployees(employeeIds: string[], patch: Partial<StoredPersonnel['employee']>): Promise<number>
  clearAll(): Promise<void>
}

const DB_NAME = 'gelatik-personnel-db'
const DB_VERSION = 2
const STORE_PERSONNEL = 'personnel'
const STORE_BATCHES = 'batches'
const STORE_EXCEPTIONS = 'exceptions'
const STORE_META = 'meta'
const STORE_SOURCES = 'sourceRecords'
const STORE_REVIEWS = 'reviewItems'
const META_SEEDED = 'seeded'

const promisifyRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export const isIndexedDbAvailable = (): boolean =>
  typeof indexedDB !== 'undefined' && indexedDB !== null

export class IndexedDbPersonnelRepository implements PersonnelRepository {
  private dbPromise: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (!isIndexedDbAvailable()) {
      return Promise.reject(
        new ImportAbortError('IndexedDB tidak tersedia di browser ini, sehingga data impor tidak dapat disimpan.'),
      )
    }
    if (this.dbPromise) return this.dbPromise
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      // Runs for a fresh DB and for a v1 → v2 upgrade. Existing stores/data are kept;
      // only the two new history stores are added.
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_PERSONNEL)) db.createObjectStore(STORE_PERSONNEL, { keyPath: 'businessKey' })
        if (!db.objectStoreNames.contains(STORE_BATCHES)) db.createObjectStore(STORE_BATCHES, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(STORE_EXCEPTIONS)) {
          const store = db.createObjectStore(STORE_EXCEPTIONS, { keyPath: 'id' })
          store.createIndex('batchId', 'batchId', { unique: false })
        }
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' })
        if (!db.objectStoreNames.contains(STORE_SOURCES)) {
          const store = db.createObjectStore(STORE_SOURCES, { keyPath: 'id' })
          store.createIndex('businessKey', 'businessKey', { unique: false })
        }
        if (!db.objectStoreNames.contains(STORE_REVIEWS)) {
          const store = db.createObjectStore(STORE_REVIEWS, { keyPath: 'id' })
          store.createIndex('businessKey', 'businessKey', { unique: false })
          store.createIndex('status', 'status', { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new ImportAbortError('Akses IndexedDB terblokir oleh sesi lain.'))
    })
    return this.dbPromise
  }

  async getAllPersonnel(): Promise<StoredPersonnel[]> {
    const db = await this.open()
    const tx = db.transaction(STORE_PERSONNEL, 'readonly')
    return promisifyRequest(tx.objectStore(STORE_PERSONNEL).getAll() as IDBRequest<StoredPersonnel[]>)
  }

  async getBatches(): Promise<ImportBatch[]> {
    const db = await this.open()
    const tx = db.transaction(STORE_BATCHES, 'readonly')
    const batches = await promisifyRequest(tx.objectStore(STORE_BATCHES).getAll() as IDBRequest<ImportBatch[]>)
    return batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getExceptions(batchId?: string): Promise<ImportException[]> {
    const db = await this.open()
    const tx = db.transaction(STORE_EXCEPTIONS, 'readonly')
    const store = tx.objectStore(STORE_EXCEPTIONS)
    return batchId
      ? promisifyRequest(store.index('batchId').getAll(batchId) as IDBRequest<ImportException[]>)
      : promisifyRequest(store.getAll() as IDBRequest<ImportException[]>)
  }

  async getSourceRecords(businessKey?: string): Promise<SourceImportRecord[]> {
    const db = await this.open()
    const tx = db.transaction(STORE_SOURCES, 'readonly')
    const store = tx.objectStore(STORE_SOURCES)
    return businessKey
      ? promisifyRequest(store.index('businessKey').getAll(businessKey) as IDBRequest<SourceImportRecord[]>)
      : promisifyRequest(store.getAll() as IDBRequest<SourceImportRecord[]>)
  }

  async getReviewItems(status?: ReviewStatus): Promise<ReviewItem[]> {
    const db = await this.open()
    const tx = db.transaction(STORE_REVIEWS, 'readonly')
    const store = tx.objectStore(STORE_REVIEWS)
    return status
      ? promisifyRequest(store.index('status').getAll(status) as IDBRequest<ReviewItem[]>)
      : promisifyRequest(store.getAll() as IDBRequest<ReviewItem[]>)
  }

  /**
   * Single read-write transaction across the five stores. IndexedDB aborts the
   * whole transaction on any error, so either everything commits or nothing does.
   */
  async commit(plan: ImportPlan): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PERSONNEL, STORE_BATCHES, STORE_EXCEPTIONS, STORE_SOURCES, STORE_REVIEWS], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new ImportAbortError('Transaksi penyimpanan dibatalkan.'))
      tx.onerror = () => reject(tx.error ?? new ImportAbortError('Transaksi penyimpanan gagal.'))
      const personnel = tx.objectStore(STORE_PERSONNEL)
      const batches = tx.objectStore(STORE_BATCHES)
      const exceptions = tx.objectStore(STORE_EXCEPTIONS)
      const sources = tx.objectStore(STORE_SOURCES)
      const reviews = tx.objectStore(STORE_REVIEWS)
      for (const record of plan.mastersToPut) personnel.put(record)
      for (const source of plan.sourceRecordsToPut) sources.put(source)
      for (const item of plan.reviewItemsToPut) reviews.put(item)
      batches.put(plan.batch)
      for (const exception of plan.exceptions) exceptions.put(exception)
    })
  }

  async resolveReviewItem(id: string, status: ReviewStatus, resolution: ReviewResolution | null): Promise<ReviewItem | null> {
    const db = await this.open()
    return new Promise<ReviewItem | null>((resolve, reject) => {
      const tx = db.transaction(STORE_REVIEWS, 'readwrite')
      const store = tx.objectStore(STORE_REVIEWS)
      const request = store.get(id) as IDBRequest<ReviewItem | undefined>
      let updated: ReviewItem | null = null
      request.onsuccess = () => {
        const current = request.result
        if (current) {
          updated = { ...current, status, resolution, updatedAt: new Date().toISOString() }
          store.put(updated)
        }
      }
      request.onerror = () => reject(request.error)
      tx.oncomplete = () => resolve(updated)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }

  async resolveReviewAndPatch(id: string, businessKey: string, status: ReviewStatus, resolution: ReviewResolution, patch: Partial<StoredPersonnel['employee']>): Promise<ReviewItem | null> {
    const db = await this.open()
    return new Promise<ReviewItem | null>((resolve, reject) => {
      const tx = db.transaction([STORE_REVIEWS, STORE_PERSONNEL], 'readwrite')
      const reviews = tx.objectStore(STORE_REVIEWS)
      const personnel = tx.objectStore(STORE_PERSONNEL)
      let updated: ReviewItem | null = null
      const reviewRequest = reviews.get(id) as IDBRequest<ReviewItem | undefined>
      reviewRequest.onsuccess = () => {
        if (!reviewRequest.result) { tx.abort(); return }
        updated = { ...reviewRequest.result, status, resolution, updatedAt: new Date().toISOString() }
        reviews.put(updated)
        const masterRequest = personnel.get(businessKey) as IDBRequest<StoredPersonnel | undefined>
        masterRequest.onsuccess = () => {
          if (!masterRequest.result) { tx.abort(); return }
          const now = new Date().toISOString()
          personnel.put({ ...masterRequest.result, employee: { ...masterRequest.result.employee, ...patch, updatedAt: now }, updatedAt: now })
        }
      }
      tx.oncomplete = () => resolve(updated)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new ImportAbortError('Keputusan review dibatalkan karena master tidak dapat diperbarui.'))
    })
  }

  async isSeeded(): Promise<boolean> {
    const db = await this.open()
    const tx = db.transaction(STORE_META, 'readonly')
    const value = await promisifyRequest(tx.objectStore(STORE_META).get(META_SEEDED) as IDBRequest<{ key: string; value: boolean } | undefined>)
    return Boolean(value?.value)
  }

  async markSeeded(): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE_META).put({ key: META_SEEDED, value: true })
    })
  }

  async seedPersonnel(records: StoredPersonnel[]): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PERSONNEL, STORE_META], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      const personnel = tx.objectStore(STORE_PERSONNEL)
      for (const record of records) personnel.put(record)
      tx.objectStore(STORE_META).put({ key: META_SEEDED, value: true })
    })
  }

  async patchEmployee(employeeId: string, patch: Partial<StoredPersonnel['employee']>): Promise<boolean> {
    const db = await this.open()
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_PERSONNEL, 'readwrite')
      const store = tx.objectStore(STORE_PERSONNEL)
      const request = store.getAll() as IDBRequest<StoredPersonnel[]>
      let found = false
      request.onsuccess = () => {
        const target = request.result.find((item) => item.employee.id === employeeId)
        if (target) {
          found = true
          const now = new Date().toISOString()
          store.put({ ...target, employee: { ...target.employee, ...patch, updatedAt: now }, updatedAt: now })
        }
      }
      request.onerror = () => reject(request.error)
      tx.oncomplete = () => resolve(found)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }

  async patchEmployees(employeeIds: string[], patch: Partial<StoredPersonnel['employee']>): Promise<number> {
    if (!employeeIds.length) return 0
    const db = await this.open()
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_PERSONNEL, 'readwrite')
      const store = tx.objectStore(STORE_PERSONNEL)
      const request = store.getAll() as IDBRequest<StoredPersonnel[]>
      const wanted = new Set(employeeIds)
      let updated = 0
      request.onsuccess = () => {
        const now = new Date().toISOString()
        for (const target of request.result) {
          if (!wanted.has(target.employee.id)) continue
          updated++
          store.put({ ...target, employee: { ...target.employee, ...patch, updatedAt: now }, updatedAt: now })
        }
      }
      request.onerror = () => reject(request.error)
      tx.oncomplete = () => resolve(updated)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }

  async clearAll(): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PERSONNEL, STORE_BATCHES, STORE_EXCEPTIONS, STORE_META, STORE_SOURCES, STORE_REVIEWS], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE_PERSONNEL).clear()
      tx.objectStore(STORE_BATCHES).clear()
      tx.objectStore(STORE_EXCEPTIONS).clear()
      tx.objectStore(STORE_META).clear()
      tx.objectStore(STORE_SOURCES).clear()
      tx.objectStore(STORE_REVIEWS).clear()
    })
  }
}

/** Default repository instance used by the app. */
export const personnelRepository: PersonnelRepository = new IndexedDbPersonnelRepository()
