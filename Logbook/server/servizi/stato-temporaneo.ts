// "><(((º> sabusabu <º)))><"
/**
 * Dati a scadenza tenuti nel database invece che nella memoria del server (Giorno 35,
 * 25/11/2026: Copilota pubblicato su Vercel).
 *
 * Su Vercel il server non è un processo sempre acceso: ogni richiesta può finire su un
 * processo diverso, appena nato. Quello che prima stava in una Map (il codice via email in
 * attesa, l'accesso di un amministratore fra password e codice) lì andrebbe perso fra una
 * richiesta e l'altra. La tabella StatoTemporaneo fa da memoria comune; funziona uguale in
 * locale su SQLite, così c'è una strada sola e i test la provano.
 *
 * `adesso` è iniettabile perché i test usano un orologio finto per le scadenze.
 */
import type { PrismaClient } from '../../generated/prisma/client';

export function statoTemporaneo(prisma: PrismaClient, adesso: () => number = Date.now) {
  return {
    /** Valore della chiave, o null se manca o è scaduto (e allora lo toglie). */
    async leggi<T>(chiave: string): Promise<T | null> {
      const r = await prisma.statoTemporaneo.findUnique({ where: { chiave } });
      if (!r) return null;
      if (r.scadeIl.getTime() < adesso()) {
        await prisma.statoTemporaneo.deleteMany({ where: { chiave } });
        return null;
      }
      return JSON.parse(r.valore) as T;
    },

    /** Scrive (o sostituisce) il valore, valido fino a `scade` (millisecondi dall'epoca). */
    async scrivi(chiave: string, valore: unknown, scade: number): Promise<void> {
      const dati = { valore: JSON.stringify(valore), scadeIl: new Date(scade) };
      await prisma.statoTemporaneo.upsert({ where: { chiave }, create: { chiave, ...dati }, update: dati });
    },

    async togli(chiave: string): Promise<void> {
      await prisma.statoTemporaneo.deleteMany({ where: { chiave } });
    },

    /** Toglie tutto quello che è scaduto (manutenzione). */
    async pulisci(): Promise<number> {
      return (await prisma.statoTemporaneo.deleteMany({ where: { scadeIl: { lt: new Date(adesso()) } } })).count;
    },
  };
}

export type StatoTemporaneo = ReturnType<typeof statoTemporaneo>;
