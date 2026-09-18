import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, errorMessage } from '../api/client'
import type { User } from '../api/types'
import { getToken, setToken, setUnauthorizedHandler } from './token'
import { useToast } from '../components/Toast'

type AuthState = {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(!!getToken())
  const toast = useToast()

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  // 401 da qualsiasi chiamata: token scaduto o revocato -> avviso e ritorno al login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (getToken()) toast.info('Sessione scaduta: accedi di nuovo')
      logout()
    })
  }, [logout, toast])

  // Al primo caricamento, se c'è un token salvato, verifica che sia ancora valido.
  useEffect(() => {
    if (!getToken()) return
    api.GET('/auth/me').then(({ data }) => {
      if (data) setUser(data)
      else logout()
      setLoading(false)
    })
  }, [logout])

  const login = useCallback(async (email: string, password: string) => {
    const { data, error, response } = await api.POST('/auth/login', { body: { email, password } })
    if (response.status === 401) throw new Error('Email o password errati')
    if (error || !data) throw new Error(errorMessage(error, 'Accesso non riuscito'))
    setToken(data.access_token)
    setUser(data.user)
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuori da AuthProvider')
  return ctx
}

export const isManager = (u: User | null) => u?.role === 'admin' || u?.role === 'manager'
