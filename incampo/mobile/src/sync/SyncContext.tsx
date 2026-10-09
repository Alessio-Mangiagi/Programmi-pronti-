import NetInfo from '@react-native-community/netinfo'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { getToken } from '../auth/token'
import { apiUrl } from '../config'
import { useDb } from '../db/DbContext'
import { registerBackgroundSync } from './background'
import { expoFileStore } from './expoFileStore'
import { syncAll, type SyncResult } from './index'
import { rnUploadOptions } from './rnUpload'
import { pendingCounts, type PendingCounts } from './status'
import { registerPushToken } from '../push'

export type SyncState = {
  syncing: boolean
  online: boolean
  last: SyncResult | null
  error: string | null
  pending: PendingCounts
  /** sync manuale (pull-to-refresh, tap sulla barra) */
  sync: () => Promise<SyncResult | null>
  /** da chiamare dopo una scrittura locale: aggiorna i contatori */
  refreshCounts: () => void
}

const SyncContext = createContext<SyncState | null>(null)
const FOREGROUND_INTERVAL_MS = 15 * 60_000

/**
 * Sync automatico: all'avvio con utente loggato, quando l'app torna in
 * foreground, quando la connettività torna, ogni 15 minuti in foreground e
 * (dove il sistema lo consente) in background. Nessuna azione manuale
 * necessaria nell'uso normale; la barra mostra ultima sync, elementi in attesa, errori.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useDb()
  const { user, api } = useAuth()
  const [syncing, setSyncing] = useState(false)
  const [online, setOnline] = useState(true)
  const [last, setLast] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingCounts>(() => pendingCounts(db))
  const userRef = useRef(user)
  userRef.current = user

  const refreshCounts = useCallback(() => setPending(pendingCounts(db)), [db])

  const sync = useCallback(async () => {
    if (!userRef.current) return null
    setSyncing(true)
    try {
      const res = await syncAll(db, api, { files: { baseUrl: apiUrl(), getToken, store: expoFileStore }, uploads: rnUploadOptions })
      setLast(res)
      setError(res.errors[0] ?? null)
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync non riuscita')
      return null
    } finally {
      setSyncing(false)
      setPending(pendingCounts(db))
    }
  }, [db, api])

  // avvio / login
  useEffect(() => {
    if (user) {
      sync()
      registerBackgroundSync()
      registerPushToken(api)
    }
  }, [user, sync, api])

  // foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync()
    })
    return () => sub.remove()
  }, [sync])

  // connettività: quando torna la rete, sync; offline = solo indicatore
  useEffect(() => {
    let wasOnline = true
    const unsub = NetInfo.addEventListener((s) => {
      const now = !!s.isConnected && s.isInternetReachable !== false
      setOnline(now)
      if (now && !wasOnline) sync()
      wasOnline = now
    })
    return unsub
  }, [sync])

  // periodico in foreground
  useEffect(() => {
    const id = setInterval(() => {
      if (AppState.currentState === 'active') sync()
    }, FOREGROUND_INTERVAL_MS)
    return () => clearInterval(id)
  }, [sync])

  const value = useMemo(() => ({ syncing, online, last, error, pending, sync, refreshCounts }), [syncing, online, last, error, pending, sync, refreshCounts])
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext)
  // "><(((º> sabusabu <º)))><"
  if (!ctx) throw new Error('useSync fuori da SyncProvider')
  return ctx
}
