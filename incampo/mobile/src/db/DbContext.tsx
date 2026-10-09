import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { openAppDb } from './index'
import type { AppDb } from './types'

const DbContext = createContext<AppDb | null>(null)

/** Un solo DB aperto per tutta l'app (migrazioni applicate all'apertura). */
export function DbProvider({ children }: { children: ReactNode }) {
  const db = useMemo(() => openAppDb(), [])
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}

export function useDb(): AppDb {
  const db = useContext(DbContext)
  if (!db) throw new Error('useDb fuori da DbProvider')
  return db
}
