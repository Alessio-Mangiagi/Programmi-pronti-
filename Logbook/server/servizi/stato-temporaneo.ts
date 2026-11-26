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

    /**
     * Crea la chiave solo se non c'è già: true a chi la crea, false a tutti gli altri. La
     * chiave è unica nel database, quindi fra richieste arrivate insieme una sola passa.
     * Serve a contare senza corse (tentativi sui codici, servizi/codice-conferma.ts).
     */
    async prenota(chiave: string, scade: number): Promise<boolean> {
      try {
        await prisma.statoTemporaneo.create({ data: { chiave, valore: '1', scadeIl: new Date(scade) } });
        return true;
      } catch {
        return false;
      }
    },

    /** Toglie tutte le chiavi che cominciano con `prefisso`. */
    async togliConPrefisso(prefisso: string): Promise<void> {
      await prisma.statoTemporaneo.deleteMany({ where: { chiave: { startsWith: prefisso } } });
    },

    /** Quante chiavi non scadute cominciano con `prefisso`. */
    async conta(prefisso: string): Promise<number> {
      return prisma.statoTemporaneo.count({ where: { chiave: { startsWith: prefisso }, scadeIl: { gte: new Date(adesso()) } } });
    },

    /** Toglie tutto quello che è scaduto (manutenzione). */
    async pulisci(): Promise<number> {
      return (await prisma.statoTemporaneo.deleteMany({ where: { scadeIl: { lt: new Date(adesso()) } } })).count;
    },
  };
}

export type StatoTemporaneo = ReturnType<typeof statoTemporaneo>;
