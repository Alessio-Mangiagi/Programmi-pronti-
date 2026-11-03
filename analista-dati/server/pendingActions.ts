/**
 * AZIONI IN ATTESA DI CONFERMA — lega la conferma dell'utente all'azione che
 * l'agente ha DAVVERO proposto.
 *
 * Perché serve: senza questo registro l'endpoint di conferma riceverebbe nome e
 * argomenti dal body del client, quindi qualsiasi utente autenticato potrebbe
 * invocare un tool di scrittura con argomenti arbitrari saltando del tutto
 * l'LLM (il gate «conferma umana» non proteggerebbe nulla).
 *
 * Come funziona: quando l'agente propone un'azione la registriamo qui e
 * restituiamo al client solo un `id` opaco. Alla conferma il client rimanda
 * l'id: il server riesegue gli argomenti SALVATI, mai quelli del body.
 *
 * Proprietà: monouso (consumato al primo prelievo), scadenza breve, legato
 * all'utente che l'ha ricevuta.
 */
import { randomUUID } from 'node:crypto'

/** Allegato del messaggio che ha generato l'azione (stesso formato di SuiteCtx.attachments). */
export interface StoredAttachment { name: string; base64: string }

export interface StoredAction {
  name: string
  args: Record<string, any>
  user: string
  expiresAt: number
  /** Allegati del messaggio: servono alle azioni che lavorano sui file (es. confronta_documenti,
   *  diventata azione con conferma il 03/11/2026). La conferma rimanda solo l'id: senza
   *  conservarli qui, l'azione confermata non avrebbe più i file su cui lavorare. */
  attachments?: StoredAttachment[]
}

/** Validità di un'azione proposta. Oltre, va richiesta di nuovo all'agente. */
const TTL_MS = Number(process.env.AGENT_ACTION_TTL_MS) || 5 * 60_000
/** Tetto di sicurezza: evita crescita illimitata se nessuno conferma mai. */
const MAX_PENDING = Number(process.env.AGENT_ACTION_MAX_PENDING) || 500
/** Tetto separato per le azioni con allegati: ognuna può pesare decine di MB in memoria. */
const MAX_PENDING_ALLEGATI = Number(process.env.AGENT_ACTION_MAX_PENDING_ALLEGATI) || 20

const store = new Map<string, StoredAction>()

/** Elimina le voci scadute (e le più vecchie se il registro sfora il tetto). */
function prune(now = Date.now()): void {
  for (const [id, a] of store) if (a.expiresAt <= now) store.delete(id)
  const conAllegati = [...store.entries()].filter(([, a]) => a.attachments?.length)
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
  for (const [id] of conAllegati.slice(0, Math.max(0, conAllegati.length - MAX_PENDING_ALLEGATI))) store.delete(id)
  if (store.size <= MAX_PENDING) return
  const byAge = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
  for (const [id] of byAge.slice(0, store.size - MAX_PENDING)) store.delete(id)
}

/** Registra un'azione proposta dall'agente. Ritorna l'id da dare al client. */
export function registerPendingAction(name: string, args: Record<string, any>, user: string,
                                      attachments?: StoredAttachment[]): string {
  const id = randomUUID()
  // "><(((º> sabusabu <º)))><"
  store.set(id, { name, args: args || {}, user: user || '', expiresAt: Date.now() + TTL_MS,
                  ...(attachments?.length ? { attachments } : {}) })
  prune()
  return id
}

export type TakeResult =
  | { ok: true; action: { name: string; args: Record<string, any>; attachments?: StoredAttachment[] } }
  | { ok: false; error: string }

/**
 * Preleva e CONSUMA un'azione. Fallisce se l'id è ignoto, scaduto, già usato o
 * appartiene a un altro utente (un id indovinato non deve valere per nessun altro).
 */
export function takePendingAction(id: string, user: string): TakeResult {
  prune()
  const a = store.get(id)
  if (!a) return { ok: false, error: 'Azione non più valida: è scaduta o è già stata eseguita. Richiedila di nuovo all\'agente.' }
  store.delete(id) // monouso: consumata comunque, anche se l'utente non combacia
  if (a.user !== (user || '')) return { ok: false, error: 'Azione non valida per questo utente.' }
  return { ok: true, action: { name: a.name, args: a.args, ...(a.attachments ? { attachments: a.attachments } : {}) } }
}

/** Solo per i test: svuota il registro. */
export function _resetPendingActions(): void { store.clear() }
