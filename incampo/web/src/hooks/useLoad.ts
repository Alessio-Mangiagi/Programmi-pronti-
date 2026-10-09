import { useEffect } from 'react'

/**
 * Esegue `load` al mount e ogni volta che cambia (cioè quando cambiano le
 * dipendenze del suo useCallback). `load` è asincrona e aggiorna lo stato solo
 * DOPO l'await della chiamata API: l'effetto sincronizza con il backend senza
 * setState sincroni (niente render a cascata). La stessa `load` si richiama a
 * mano dopo una modifica per ricaricare.
 */
export function useLoad(load: () => Promise<unknown>): void {
  useEffect(() => {
    load()
  }, [load])
}
