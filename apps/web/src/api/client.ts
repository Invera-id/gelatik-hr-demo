import type { components } from './schema'

/**
 * Central API client. Session auth uses an HttpOnly cookie (never readable here);
 * the CSRF token from /auth/login or /auth/me is held in memory only and sent on
 * every state-changing request. Nothing auth-related is stored in localStorage.
 *
 * VITE_API_BASE_URL is baked in at build time; changing it requires a rebuild.
 * Default '/api/v1' assumes same-origin (Vite dev proxy or a reverse proxy).
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api/v1'

export type Schemas = components['schemas']

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>
  readonly requestId: string | null

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}, requestId: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.requestId = requestId
  }
}

let csrfToken: string | null = null
let onUnauthorized: (() => void) | null = null

export const setCsrfToken = (token: string | null) => { csrfToken = token }
export const setUnauthorizedHandler = (handler: (() => void) | null) => { onUnauthorized = handler }

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  form?: FormData
  query?: Record<string, string | number | boolean | null | undefined>
  signal?: AbortSignal
  /** Return the raw Response (file downloads). */
  raw?: boolean
}

const buildUrl = (path: string, query?: RequestOptions['query']) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return `${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`
}

const toError = async (response: Response): Promise<ApiError> => {
  try {
    const body = await response.json() as { error?: { code?: string; message?: string; fields?: Record<string, string>; requestId?: string } }
    const e = body.error ?? {}
    return new ApiError(response.status, e.code ?? 'HTTP_ERROR', e.message ?? `Permintaan gagal (${response.status}).`, e.fields ?? {}, e.requestId ?? null)
  } catch {
    return new ApiError(response.status, 'HTTP_ERROR', `Permintaan gagal (${response.status}).`)
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  let body: BodyInit | undefined
  if (options.form) body = options.form
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken
  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), { method, headers, body, credentials: 'include', signal: options.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'NETWORK_ERROR', 'Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.')
  }
  if (!response.ok) {
    const error = await toError(response)
    if (response.status === 401 && path !== '/auth/login') onUnauthorized?.()
    throw error
  }
  if (options.raw) return response as unknown as T
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

/** Download a server-generated file and save it with the server-provided name. */
export async function download(path: string, query?: RequestOptions['query']): Promise<string> {
  const response = await request<Response>(path, { query, raw: true })
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const encoded = /filename\*=utf-8''([^;]+)/i.exec(disposition)?.[1]
  const name = (encoded && decodeURIComponent(encoded)) || /filename="?([^";]+)"?/i.exec(disposition)?.[1] || 'export.xlsx'
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
  return name
}

/** Human-readable message for any thrown value. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    // Document blockers are keyed by document type code; show which document blocks.
    const fields = error.code === 'DOCUMENTS_INCOMPLETE' ? Object.entries(error.fields).map(([code, reason]) => `${code}: ${reason}`) : Object.values(error.fields)
    return fields.length ? `${error.message} ${fields.join(' ')}` : error.message
  }
  return error instanceof Error ? error.message : 'Terjadi kesalahan.'
}
