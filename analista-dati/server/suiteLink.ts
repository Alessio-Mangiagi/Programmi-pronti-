// "><(((º> sabusabu <º)))><"
/**
 * suiteLink.ts — ponte verso shared/suite/suite_link.js (CommonJS, senza tipi):
 * token di servizio e chiamate dirette alle app della suite (InCampo,
 * SkyTower, Magazzino, Scadenzario) con l'utente del portale negli header.
 * I tool lo importano da qui, così nei test si sostituisce con vi.mock.
 */
import { createRequire } from 'node:module'

export interface SuiteLink {
  chiama(app: string, metodo: string, percorso: string, opzioni?: Record<string, unknown>): Promise<any>
  commesse(opts?: { soloAttive?: boolean }): Array<{ code: string; nome: string; stato: string; cliente: string; indirizzo: string; note: string }>
  trovaCommessa(codice: string): { code: string; nome: string } | null
  normalizzaCommessa(codice: string): string
  urlPubblico(app: string, host?: string): string
  /** Link con host di loopback → host della richiesta (cookie del portale per host); altrimenti invariato. */
  conHostRichiesta?(url: string, host?: string): string
  SuiteError: new (app: string, stato: number, messaggio: string) => Error & { app: string; stato: number; messaggio: string }
}

const require = createRequire(import.meta.url)
export const suite: SuiteLink = require('../../shared/suite/suite_link.js')
