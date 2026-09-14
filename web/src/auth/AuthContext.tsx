import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, errorMessage } from '../api/client'
import type { User } from '../api/types'
import { getToken, setToken, setUnauthorizedHandler } from './token'

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

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
  }, [logout])

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
    const { data, error } = await api.POST('/auth/login', { body: { email, password } })
    if (error || !data) throw new Error(errorMessage(error, 'Credenziali non valide'))
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
