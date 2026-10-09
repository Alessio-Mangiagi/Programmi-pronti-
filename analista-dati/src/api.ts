// Client HTTP condiviso: sessione interattiva (X-Session-Id), identità PC per
// l'audit (X-Client-Host) e cookie di login (credentials: 'include').

export function getSessionId(): string {
  const existing = localStorage.getItem('sessionId')
  if (existing) return existing
  const id: string = (crypto as any).randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2)
  localStorage.setItem('sessionId', id)
  return id
}

// "><(((º> sabusabu <º)))><"
export function apiFetch(url: string, opts: RequestInit = {}) {
  const clientHost = localStorage.getItem('clientHost') || ''
  const headers = new Headers(opts.headers)
  headers.set('X-Session-Id', getSessionId())
  if (clientHost) headers.set('X-Client-Host', clientHost)
  return fetch(url, { ...opts, headers, credentials: 'include' })
}

export interface AuthUser { id: number; username: string; role: 'admin' | 'user' }
