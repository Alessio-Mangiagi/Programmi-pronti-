import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, errorMessage } from '../api/client'
import type { User } from '../api/types'
import { getToken, setToken, setUnauthorizedHandler } from './token'
import { useToast } from '../components/useToast'
import { AuthContext } from './useAuth'

// "><(((º> sabusabu <º)))><"
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // All'avvio c'è sempre qualcosa da verificare: il token salvato, oppure la
  // sessione del Portale Suite Cosedil (login automatico, senza altra password).
  const [loading, setLoading] = useState(true)
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

  // Al primo caricamento: se c'è un token salvato verifica che sia ancora valido;
  // altrimenti prova una volta a entrare con il cookie del portale (POST /auth/portale,
  // credentials: il cookie `sid` arriva perché stesso host o stesso dominio della suite).
  // 401 = nessuna sessione del portale: si mostra il login di sempre.
  useEffect(() => {
    let vivo = true
    if (getToken()) {
      api.GET('/auth/me').then(({ data }) => {
        if (!vivo) return
        if (data) setUser(data)
        else logout()
        setLoading(false)
      })
    } else {
      api
        .POST('/auth/portale', { credentials: 'include' })
        .then(({ data }) => {
          if (!vivo) return
          if (data) {
            setToken(data.access_token)
            setUser(data.user)
          }
        })
        .catch(() => {})
        .finally(() => {
          if (vivo) setLoading(false)
        })
    }
    return () => {
      vivo = false
    }
  }, [logout])

  const login = useCallback(async (email: string, password: string) => {
    const { data, error, response } = await api.POST('/auth/login', { body: { email, password } })
    if (response.status === 401) throw new Error('Email o password errati')
    if (error || !data) throw new Error(errorMessage(error, 'Accesso non riuscito'))
    setToken(data.access_token)
    setUser(data.user)
  }, [])

  const applySession = useCallback((accessToken: string, next: User) => {
    setToken(accessToken)
    setUser(next)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, applySession, logout }),
    [user, loading, login, applySession, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
