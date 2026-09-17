/**
 * Client HTTP minimale (fetch) per l'API FastAPI: bearer token, JSON, errori
 * leggibili. Volutamente senza openapi-fetch: i tipi che servono al mobile
 * sono quelli delle righe locali (db/schema.ts) e del protocollo di sync.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message)
  }
}

export type ApiOptions = { baseUrl: string; getToken: () => Promise<string | null> | string | null; onUnauthorized?: () => void }

export function createApi(opts: ApiOptions) {
  async function request<T>(method: string, path: string, body?: unknown, init?: { form?: FormData }): Promise<T> {
    const token = await opts.getToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        body: init?.form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      })
    } catch (e) {
      throw new ApiError(0, 'Rete non disponibile', e)
    }
    if (res.status === 401) opts.onUnauthorized?.()
    if (res.status === 204) return undefined as T
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!res.ok) throw new ApiError(res.status, errorMessage(data, `Errore ${res.status}`), data)
    return data as T
  }
  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
    upload: <T>(path: string, form: FormData) => request<T>('POST', path, undefined, { form }),
  }
}

export type Api = ReturnType<typeof createApi>

/** Messaggio leggibile da un errore FastAPI (detail string o lista di errori campo). */
export function errorMessage(data: unknown, fallback: string): string {
  const detail = (data as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const field = (e as { field?: string }).field ?? (e as { loc?: unknown[] }).loc?.slice(-1)[0]
        const msg = (e as { message?: string; msg?: string }).message ?? (e as { msg?: string }).msg
        return field ? `${field}: ${msg}` : String(msg)
      })
      .join('; ')
  }
  return fallback
}
