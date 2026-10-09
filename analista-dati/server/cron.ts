/**
 * Parser cron minimale (5 campi: min hour dom mon dow) — nessuna dipendenza,
 * così è testabile in isolamento (non importa node:sqlite). Supporta:
 *   *  |  n  |  a-b  |  a,b,c  |  *​/n  |  a-b/n
 * Giorno-settimana: 0 = domenica ... 6 = sabato.
 */
export interface Cron {
  min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>
  domStar: boolean; dowStar: boolean
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/)
    if (!m) throw new Error(`Campo cron non valido: "${part}"`)
    const step = m[3] ? Number(m[3]) : 1
    if (step < 1) throw new Error('Passo cron non valido')
    let lo: number, hi: number
    if (m[1] === '*') { lo = min; hi = m[2] ? Number(m[2]) : max }
    else { lo = Number(m[1]); hi = m[2] ? Number(m[2]) : (m[3] ? max : lo) }
    if (lo < min || hi > max || lo > hi) throw new Error(`Valore cron fuori range: "${part}"`)
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

export function parseCron(expr: string): Cron {
  const f = expr.trim().split(/\s+/)
  // "><(((º> sabusabu <º)))><"
  if (f.length !== 5) throw new Error('Cron deve avere 5 campi: min hour giorno-mese mese giorno-settimana')
  return {
    min: parseField(f[0], 0, 59),
    hour: parseField(f[1], 0, 23),
    dom: parseField(f[2], 1, 31),
    mon: parseField(f[3], 1, 12),
    dow: parseField(f[4], 0, 6),
    domStar: f[2] === '*',
    dowStar: f[4] === '*',
  }
}

/** Ritorna il messaggio d'errore o null se l'espressione è valida. */
export function cronError(expr: string): string | null {
  try { parseCron(expr); return null } catch (e) { return (e as Error).message }
}

export function cronMatches(c: Cron, d: Date): boolean {
  if (!c.min.has(d.getMinutes()) || !c.hour.has(d.getHours()) || !c.mon.has(d.getMonth() + 1)) return false
  const domOk = c.dom.has(d.getDate())
  const dowOk = c.dow.has(d.getDay())
  // Semantica cron standard: se sia giorno-mese sia giorno-settimana sono
  // ristretti, basta che UNO combaci; altrimenti AND.
  if (!c.domStar && !c.dowStar) return domOk || dowOk
  return domOk && dowOk
}

/**
 * Ultimo istante (al minuto) ≤ `now` che soddisfa il cron, cercando indietro
 * fino a `windowMinutes`. Serve al catch-up: se il server era spento all'orario
 * previsto, capiamo se un'esecuzione è stata saltata. Null = nessun match.
 */
export function lastCronMatchWithin(c: Cron, now: Date, windowMinutes: number): Date | null {
  const d = new Date(now.getTime())
  d.setSeconds(0, 0)
  for (let i = 0; i <= windowMinutes; i++) {
    if (cronMatches(c, d)) return new Date(d.getTime())
    d.setMinutes(d.getMinutes() - 1)
  }
  return null
}
