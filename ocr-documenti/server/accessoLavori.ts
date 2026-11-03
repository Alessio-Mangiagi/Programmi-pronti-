// "><(((º> sabusabu <º)))><"
// Chi può vedere un lavoro OCR (revisione di sicurezza del 03/11/2026).
//
// Prima ogni utente loggato elencava tutti i lavori, scaricava il PDF altrui (contratti
// con importi), leggeva il risultato e poteva cancellarlo. Ora un lavoro è di chi l'ha
// creato: lo vedono lui e gli admin dell'app (admin per-app del portale).
//
// L'identità arriva dal gate SSO del portale (`req.cosedil`), montato sul backend quando
// serve lui le pagine (produzione) o è esposto in rete. In sviluppo il gate sta sul dev
// server di Vite e qui non c'è identità: l'app è usata da una persona sola sul suo PC e
// tutto resta visibile come prima. Lo stesso vale con COSEDIL_SSO=off.
// Logica separata da lavori.ts perché sia testabile senza avviare la pipeline OCR.

/** Identità del chiamante, come la mette il gate SSO in `req.cosedil`. */
export interface Chi {
  identificato: boolean   // false = nessun gate davanti (sviluppo, SSO spento)
  utente?: string
  admin: boolean
}

/** Legge l'identità dalla richiesta (senza dipendere dai tipi di express). */
export const chiDa = (req: unknown): Chi => {
  const c = (req as { cosedil?: { username?: string | null; admin?: boolean } }).cosedil
  if (!c?.username) return { identificato: false, admin: false }
  return { identificato: true, utente: c.username, admin: !!c.admin }
}

/** True se `chi` può vedere, scaricare o cancellare il lavoro di `utente`. */
export const puoVedere = (lavoro: { utente?: string }, chi: Chi): boolean =>
  !chi.identificato || chi.admin || (!!lavoro.utente && lavoro.utente === chi.utente)
