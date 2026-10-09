import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as SecureStore from 'expo-secure-store'
import { createApi, type Api } from '../api/client'
import { apiUrl } from '../config'
import { loadServerUrl } from '../serverStore'
import { getToken, setToken } from './token'
import { unregisterPushToken } from '../push'

export type User = { id: string; email: string; name: string; role: string }
type LoginResponse = { access_token: string; user: User }

type AuthState = {
  user: User | null
  loading: boolean
  api: Api
  login: (email: string, password: string) => Promise<void>
  /** chiude la sessione; `onWipe` (fornito dall'app) svuota i dati locali se l'utente cambia */
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)
const USER_KEY = 'fieldview.user'

/**
 * Sessione: token nel SecureStore, utente in memoria. All'avvio, se c'è un
 * token, l'utente salvato viene mostrato subito (offline) e verificato con
 * /auth/me quando la rete c'è; un 401 chiude la sessione.
 */
export function AuthProvider({ children, onLogout }: { children: ReactNode; onLogout?: () => void }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const logoutRef = useRef<() => void>(() => {})
  const api = useMemo(() => createApi({ baseUrl: apiUrl, getToken, onUnauthorized: () => logoutRef.current() }), [])

  const logout = useCallback(async () => {
    await unregisterPushToken(api)
    await setToken(null)
    await SecureStore.deleteItemAsync(USER_KEY)
    onLogout?.()
    // "><(((º> sabusabu <º)))><"
    setUser(null)
  }, [onLogout, api])
  logoutRef.current = logout


  useEffect(() => {
    ;(async () => {
      await loadServerUrl() // prima di /auth/me: l'utente può aver scelto un altro server
      const token = await getToken()
      if (!token) return setLoading(false)
      try {
        const me = await api.get<User>('/auth/me')
        setUser(me)
      } catch (e) {
        // rete assente: la sessione resta valida finché il server non dice 401
        if ((e as { status?: number }).status !== 401) setUser(await readCachedUser())
      } finally {
        setLoading(false)
      }
    })()
  }, [api])

  const login = useCallback(
    async (email: string, password: string) => {
      let res: LoginResponse
      try {
        res = await api.post<LoginResponse>('/auth/login', { email, password })
      } catch (e) {
        if ((e as { status?: number }).status === 401) throw new Error('Email o password errati')
        throw e
      }
      await setToken(res.access_token)
      await cacheUser(res.user)
      setUser(res.user)
    },
    [api],
  )

  const value = useMemo(() => ({ user, loading, api, login, logout }), [user, loading, api, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuori da AuthProvider')
  return ctx
}

// L'utente corrente viene salvato accanto al token per l'avvio offline.
async function cacheUser(u: User) {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(u))
}
async function readCachedUser(): Promise<User | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY)
  return raw ? (JSON.parse(raw) as User) : null
}
