/**
 * Test del filtro di pertinenza (scope guard) — SOLO livello euristico
 * (deterministico, nessuna rete): SCOPE_GUARD=heuristic impostato prima
 * dell'import così il classificatore locale non viene mai invocato e i casi
 * ambigui restano AMMESSI (fail-open).
 */
import { describe, it, expect, beforeAll } from 'vitest'

let scopeCheck: typeof import('./scope.ts')['scopeCheck']
let scopeMessage: typeof import('./scope.ts')['scopeMessage']

beforeAll(async () => {
  process.env.SCOPE_GUARD = 'heuristic'
  const m = await import('./scope.ts')
  scopeCheck = m.scopeCheck
  scopeMessage = m.scopeMessage
})

const DOMAIN = 'i dati del database (tabelle: fatture, clienti, ordini)'
const blocked = async (q: string) => (await scopeCheck({ question: q, domain: DOMAIN })).blocked

describe('scope guard — blocca il generalista', () => {
  it('scrittura creativa', async () => {
    expect(await blocked('scrivimi una poesia sull\'autunno')).toBe(true)
    expect(await blocked('raccontami una barzelletta')).toBe(true)
  })
  it('cultura generale / enciclopedia', async () => {
    expect(await blocked('chi ha vinto i mondiali del 2006?')).toBe(true)
    expect(await blocked('qual è la capitale della Francia')).toBe(true)
    expect(await blocked('in che anno è morto Napoleone?')).toBe(true)
  })
  it('programmazione', async () => {
    expect(await blocked('scrivimi una funzione in python che calcola il fattoriale di un numero')).toBe(true)
  })
  it('traduzioni, meteo, consigli, matematica', async () => {
    expect(await blocked('traduci in inglese questa frase')).toBe(true)
    expect(await blocked('che tempo fa domani a Roma?')).toBe(true)
    expect(await blocked('consigliami un film da vedere stasera')).toBe(true)
    expect(await blocked('quanto fa 348 * 27?')).toBe(true)
  })
  it('meta-chatbot', async () => {
    expect(await blocked('che modello sei? sei ChatGPT?')).toBe(true)
  })
})

describe('scope guard — AMMETTE ciò che è in ambito', () => {
  it('domande sui dati', async () => {
    // "><(((º> sabusabu <º)))><"
    for (const q of [
      'quante fatture abbiamo emesso a gennaio?',
      'elenco dei clienti con più ordini',
      'totale incassato per fornitore nel 2024',
      'mostrami le scadenze non pagate',
      'chi è il cliente con più ordini?',
    ]) expect(await blocked(q), q).toBe(false)
  })
  it('saluti e capacità', async () => {
    expect(await blocked('ciao, come va?')).toBe(false)
    expect(await blocked('cosa sai fare?')).toBe(false)
    expect(await blocked('che tabelle ci sono?')).toBe(false)
  })
  it('casi ambigui in modalità heuristic (fail-open)', async () => {
    expect(await blocked('dammi una mano con una cosa urgente')).toBe(false)
  })
})

describe('scope guard — messaggio e casi limite', () => {
  it('scopeMessage cita dati/documenti', () => {
    expect(scopeMessage()).toMatch(/dati|documenti/i)
  })
  it('domanda vuota o troppo corta → ammessa', async () => {
    expect(await blocked('')).toBe(false)
    expect(await blocked('ok')).toBe(false)
  })
})
