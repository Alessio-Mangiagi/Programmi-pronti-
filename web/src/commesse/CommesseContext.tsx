import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { components } from '../api/schema'
import type { Project } from '../api/types'

export type Commessa = components['schemas']['CommessaOut']
export type CommessaParam = components['schemas']['CommessaParamOut']

/** Chiave della voce fittizia "Senza commessa" (cantieri non ancora associati). */
export const NO_COMMESSA = '__none__'

type State = {
  commesse: Commessa[]
  params: CommessaParam[]
  /** Cantieri senza commessa (visibili all'utente). */
  orphans: Project[]
  loading: boolean
  /** Commessa selezionata nella barra in alto (id, NO_COMMESSA o null = tutte). */
  selectedId: string | null
  select: (id: string | null) => void
  reload: () => Promise<void>
  paramName: (id: string) => string
}

const Ctx = createContext<State | null>(null)
const LS_KEY = 'fv.commessa'

/**
 * Commesse + parametri caricati una volta per sessione; la commessa selezionata
 * sta in localStorage (comodità per-viewer) e viene riallineata quando si apre
 * un cantiere di un'altra commessa (vedi CommessaBar).
 */
export function CommesseProvider({ children }: { children: ReactNode }) {
  const [commesse, setCommesse] = useState<Commessa[]>([])
  const [params, setParams] = useState<CommessaParam[]>([])
  const [orphans, setOrphans] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_KEY)
    } catch {
      return null
    }
  })

  const reload = useCallback(async () => {
    const [c, p, o] = await Promise.all([
      api.GET('/commesse'),
      api.GET('/commessa-params'),
      api.GET('/projects', { params: { query: { commessa_id: '' } } }),
    ])
    setCommesse(c.data ?? [])
    setParams(p.data ?? [])
    setOrphans(o.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    try {
      if (id) localStorage.setItem(LS_KEY, id)
      else localStorage.removeItem(LS_KEY)
    } catch {
      /* storage non disponibile: la selezione vive solo in memoria */
    }
  }, [])

  const value = useMemo<State>(
    () => ({
      commesse,
      params,
      orphans,
      loading,
      selectedId,
      select,
      reload,
      paramName: (id) => params.find((p) => p.id === id)?.name ?? 'Parametro',
    }),
    [commesse, params, orphans, loading, selectedId, select, reload],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCommesse(): State {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCommesse fuori da CommesseProvider')
  return v
}
