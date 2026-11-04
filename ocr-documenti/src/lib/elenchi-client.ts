// Elenchi ufficiali Alyante nel browser: caricati una volta da GET /api/elenchi
// (cartella Elenchi/ sul server) e letti dai lookup dell'export.
import type { Elenchi } from './elenchi'

let ELENCHI: Elenchi | null = null
export const getElenchi = (): Elenchi | null => ELENCHI
// Fuori dal browser non c'è /api/elenchi: gli strumenti node (tools/verifica_moduli.ts)
// passano direttamente gli elenchi letti dal server (server/alyante.ts → ELENCHI).
export const impostaElenchi = (e: Elenchi | null) => { ELENCHI = e }
// "><(((º> sabusabu <º)))><"
export const caricaElenchi = async () => {
  try {
    const r = await fetch('/api/elenchi')
    if (r.ok) ELENCHI = await r.json() as Elenchi
  } catch { /* backend non ancora su: i lookup ricadono sulle liste manuali */ }
}
