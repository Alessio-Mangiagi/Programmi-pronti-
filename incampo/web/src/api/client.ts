import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './schema'
import { getToken, onUnauthorized } from '../auth/token'

// Client tipizzato dallo schema OpenAPI del backend (npm run api:types).
export const api = createClient<paths>({ baseUrl: '/api' })

const authMiddleware: Middleware = {
  onRequest({ request }) {
    const token = getToken()
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    return request
  },
  onResponse({ response }) {
    // Token scaduto o revocato: torna al login invece di mostrare errori sparsi.
    if (response.status === 401 && !response.url.endsWith('/auth/login')) onUnauthorized()
    return response
  },
}
api.use(authMiddleware)

/** Messaggio leggibile da un errore FastAPI (detail string o lista di errori campo). */
export function errorMessage(error: unknown, fallback = 'Errore imprevisto'): string {
  if (!error || typeof error !== 'object') return fallback
  const detail = (error as { detail?: unknown }).detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        if (typeof e === 'string') return e
        const field = (e as { field?: string; loc?: unknown[] }).field ?? (e as { loc?: unknown[] }).loc?.slice(-1)[0]
        const msg = (e as { message?: string; msg?: string }).message ?? (e as { msg?: string }).msg
        return field ? `${field}: ${msg}` : String(msg)
      })
      .join('; ')
  }
  return fallback
}
