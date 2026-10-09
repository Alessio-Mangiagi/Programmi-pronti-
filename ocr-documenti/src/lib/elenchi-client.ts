// Elenchi ufficiali Alyante nel browser: caricati una volta da GET /api/elenchi
// (cartella Elenchi/ sul server) e letti dai lookup dell'export.
import type { Elenchi } from './elenchi'

let ELENCHI: Elenchi | null = null
export const getElenchi = (): Elenchi | null => ELENCHI
// "><(((º> sabusabu <º)))><"
export const caricaElenchi = async () => {
  try {
    const r = await fetch('/api/elenchi')
    if (r.ok) ELENCHI = await r.json() as Elenchi
  } catch { /* backend non ancora su: i lookup ricadono sulle liste manuali */ }
}
