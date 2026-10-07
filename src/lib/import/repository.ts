import type { ImportBatch, ImportException, StoredPersonnel } from './types'
import { ImportAbortError } from './types'
import type { ImportPlan } from './plan'

/**
 * Storage abstraction for imported personnel. The import feature depends only on
 * this interface, so the IndexedDB implementation can later be swapped for an
 * HTTP/backend implementation without rewriting the parser, normalizers, mapping,
 * validation, or UI.
 */
export interface PersonnelRepository {
  getAllPersonnel(): Promise<StoredPersonnel[]>
  getBatches(): Promise<ImportBatch[]>
  getExceptions(batchId?: string): Promise<ImportException[]>
  /** Apply an import plan atomically: insert/update records, append the batch and exceptions. */
  commit(plan: ImportPlan): Promise<void>
  isSeeded(): Promise<boolean>
  markSeeded(): Promise<void>
  seedPersonnel(records: StoredPersonnel[]): Promise<void>
  /** Apply a partial update to the stored employee with this internal id (no-op if absent). */
  patchEmployee(employeeId: string, patch: Partial<StoredPersonnel['employee']>): Promise<boolean>
  clearAll(): Promise<void>
}

const DB_NAME = 'gelatik-personnel-db'
const DB_VERSION = 1
const STORE_PERSONNEL = 'personnel'
const STORE_BATCHES = 'batches'
const STORE_EXCEPTIONS = 'exceptions'
const STORE_META = 'meta'
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
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_PERSONNEL)) db.createObjectStore(STORE_PERSONNEL, { keyPath: 'businessKey' })
        if (!db.objectStoreNames.contains(STORE_BATCHES)) db.createObjectStore(STORE_BATCHES, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(STORE_EXCEPTIONS)) {
          const store = db.createObjectStore(STORE_EXCEPTIONS, { keyPath: 'id' })
          store.createIndex('batchId', 'batchId', { unique: false })
        }
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' })
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
    const all = batchId
      ? await promisifyRequest(store.index('batchId').getAll(batchId) as IDBRequest<ImportException[]>)
      : await promisifyRequest(store.getAll() as IDBRequest<ImportException[]>)
    return all
  }

  /**
   * Single read-write transaction across all three stores. IndexedDB aborts the
   * whole transaction on any error, so either everything commits or nothing does.
   */
  async commit(plan: ImportPlan): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PERSONNEL, STORE_BATCHES, STORE_EXCEPTIONS], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new ImportAbortError('Transaksi penyimpanan dibatalkan.'))
      tx.onerror = () => reject(tx.error ?? new ImportAbortError('Transaksi penyimpanan gagal.'))
      const personnel = tx.objectStore(STORE_PERSONNEL)
      const batches = tx.objectStore(STORE_BATCHES)
      const exceptions = tx.objectStore(STORE_EXCEPTIONS)
      for (const record of plan.toPut) personnel.put(record)
      batches.put(plan.batch)
      for (const exception of plan.exceptions) exceptions.put(exception)
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

  async clearAll(): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PERSONNEL, STORE_BATCHES, STORE_EXCEPTIONS, STORE_META], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE_PERSONNEL).clear()
      tx.objectStore(STORE_BATCHES).clear()
      tx.objectStore(STORE_EXCEPTIONS).clear()
      tx.objectStore(STORE_META).clear()
    })
  }
}

/** Default repository instance used by the app. */
export const personnelRepository: PersonnelRepository = new IndexedDbPersonnelRepository()
