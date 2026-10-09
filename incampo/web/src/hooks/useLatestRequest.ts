import { useCallback, useRef } from 'react'

/**
 * Filtri cambiati in fretta = più richieste in volo, che possono tornare in
 * disordine. `begin()` apre una richiesta e restituisce `isLatest()`: dopo
 * l'await si applica la risposta solo se nel frattempo non ne è partita un'altra.
 */
export function useLatestRequest() {
  const seq = useRef(0)
  return useCallback(() => {
    const id = ++seq.current
    return () => id === seq.current
  }, [])
}
