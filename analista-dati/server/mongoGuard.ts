/**
 * Mongo Guard: accetta solo spec di LETTURA (find / aggregate).
 * Spec JSON: { collection, filter?, projection?, sort?, limit?, pipeline? }
 * Blocca stage di scrittura nell'aggregazione ($out, $merge) e operatori $where/$function (code exec).
 */

const FORBIDDEN_STAGES = ['$out', '$merge']
const FORBIDDEN_OPS = ['$where', '$function', '$accumulator', '$expr$function']

export interface MongoGuardResult { ok: boolean; reason?: string }

function deepHasKey(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (keys.includes(k)) return k
    const found = deepHasKey(v, keys)
    if (found) return found
  }
  return null
}

export function guardMongo(raw: string): MongoGuardResult {
  let spec: any
  try { spec = JSON.parse(raw) } catch { return { ok: false, reason: 'Spec JSON non valida' } }
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'Spec non valida' }
  if (!spec.collection || typeof spec.collection !== 'string') {
    return { ok: false, reason: 'Campo "collection" mancante' }
  }
  if (spec.pipeline) {
    if (!Array.isArray(spec.pipeline)) return { ok: false, reason: 'pipeline deve essere un array' }
    for (const stage of spec.pipeline) {
      for (const s of FORBIDDEN_STAGES) {
        if (stage && typeof stage === 'object' && s in stage) {
          return { ok: false, reason: `Stage di scrittura vietato: ${s}` }
        }
      }
    }
  }
  // Operatori che eseguono codice (read ma pericolosi) → vietati ovunque
  const badOp = deepHasKey(spec, FORBIDDEN_OPS)
  if (badOp) return { ok: false, reason: `Operatore vietato: ${badOp}` }
  return { ok: true }
}
