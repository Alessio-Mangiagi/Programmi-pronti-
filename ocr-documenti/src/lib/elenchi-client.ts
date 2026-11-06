// Elenchi ufficiali Alyante nel browser: caricati una volta da GET /api/elenchi
// (cartella Elenchi/ sul server) e letti dai lookup dell'export.
import type { Elenchi } from './elenchi'

let ELENCHI: Elenchi | null = null
export const getElenchi = (): Elenchi | null => ELENCHI
// Fuori dal browser non c'è /api/elenchi: gli strumenti node (tools/verifica_moduli.ts)
// passano direttamente gli elenchi letti dal server (server/alyante.ts → ELENCHI).
export const impostaElenchi = (e: Elenchi | null) => { ELENCHI = e }
// "><(((º> sabusabu <º)))><"
// true = elenchi arrivati. Con il backend non ancora su (pagina aperta mentre il server
// parte) i lookup ricadono sulle liste manuali: App riprova finché il server risponde,
// altrimenti l'export userebbe le liste manuali per tutta la sessione.
export const caricaElenchi = async (): Promise<boolean> => {
  try {
    const r = await fetch('/api/elenchi')
    if (!r.ok) return false
    ELENCHI = await r.json() as Elenchi
    return true
  } catch { return false }
}
