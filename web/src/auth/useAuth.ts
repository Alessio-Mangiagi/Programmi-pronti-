import { createContext, useContext } from 'react'
import type { User } from '../api/types'

export type AuthState = {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  /** Sessione aperta senza passare dal login (accettazione di un invito). */
  applySession: (accessToken: string, user: User) => void
  logout: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuori da AuthProvider')
  return ctx
}

export const isManager = (u: User | null) => u?.role === 'admin' || u?.role === 'manager'
