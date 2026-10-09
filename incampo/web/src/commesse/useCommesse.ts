import { createContext, useContext } from 'react'
import type { Project } from '../api/types'
import type { Commessa, CommessaParam } from './CommesseContext'

export type State = {
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

export const Ctx = createContext<State | null>(null)

export function useCommesse(): State {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCommesse fuori da CommesseProvider')
  return v
}
