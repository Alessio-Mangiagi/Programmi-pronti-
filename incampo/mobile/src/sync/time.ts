/**
 * Timestamp come li usa il server: ISO 8601 UTC "naive" (senza Z), es.
 * "2026-09-17T10:00:00.123". Si confrontano sempre come istanti, non come
 * stringhe, perché il server scrive i microsecondi e il device i millisecondi.
 */
export const nowIso = (): string => new Date().toISOString().replace('Z', '')

export const toMs = (iso: string | null | undefined): number => (iso ? Date.parse(iso.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z') : 0)

/** true se `a` è strettamente più recente di `b`. */
export const isNewer = (a: string | null | undefined, b: string | null | undefined): boolean => toMs(a) > toMs(b)
