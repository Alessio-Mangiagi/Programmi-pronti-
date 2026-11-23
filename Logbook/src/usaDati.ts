// "><(((º> sabusabu <º)))><"
/**
 * Hook per caricare dati da una GET con stati di caricamento ed errore, e ricaricarli
 * dopo un salvataggio. Evita di ripetere lo stesso useEffect in ogni pagina.
 * Se `percorso` è null non carica nulla (es. filtri non ancora pronti).
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function usaDati<T>(percorso: string | null) {
  const [dati, setDati] = useState<T | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(percorso !== null);

  const ricarica = useCallback(async () => {
    if (percorso === null) return;
    setCaricamento(true);
    setErrore(null);
    try {
      setDati(await api.get<T>(percorso));
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setCaricamento(false);
    }
  }, [percorso]);

  useEffect(() => {
    ricarica();
  }, [ricarica]);

  return { dati, errore, caricamento, ricarica, setDati };
}
