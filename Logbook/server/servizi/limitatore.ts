// "><(((º> sabusabu <º)))><"
/**
 * Blocco progressivo dei tentativi di accesso (Giorno 34: "dopo 10 tentativi fai aspettare 5
 * minuti e dopo sali a 10 e così via"), in due versioni con la stessa interfaccia:
 *
 * - `limitatoreInMemoria`: il conto sta in una Map del processo. È la versione di Copilota
 *   installato su un PC o nella suite, dove il server è un processo solo e sempre acceso.
 *   Il conto si fa prima di qualunque attesa, così 500 richieste insieme non passano tutte;
 * - `limitatoreSuDatabase` (Giorno 35, Vercel): lì ogni richiesta può finire su un processo
 *   diverso e la memoria non dura, quindi il conto sta nella tabella TentativoAccesso,
 *   incrementato con un'operazione sola del database (richieste parallele ricevono numeri
 *   diversi).
 *
 * Regola: 10 tentativi ammessi; l'undicesimo fa partire un'attesa di 5 minuti, e ogni blocco
 * successivo la raddoppia (10, 20, 40… fino a 24 ore). Un accesso riuscito azzera tutto;
 * senza tentativi per 24 ore si riparte da 5 minuti.
 */
import type { PrismaClient } from '../../generated/prisma/client';
import { ErroreHttp } from '../errori';

export const TENTATIVI_PRIMA_DEL_BLOCCO = 10;
export const PRIMA_ATTESA_MS = 5 * 60 * 1000;
const ATTESA_MASSIMA_MS = 24 * 60 * 60 * 1000;
const DIMENTICA_DOPO_MS = 24 * 60 * 60 * 1000;
const MAX_CHIAVI = 5000;

export const attesaLeggibile = (ms: number) => (ms >= 60 * 60 * 1000 ? `${Math.ceil(ms / 3_600_000)} ore` : `${Math.max(1, Math.ceil(ms / 60000))} minuti`);
const troppi = (ms: number) => new ErroreHttp(429, `Troppi tentativi sbagliati: riprova fra ${attesaLeggibile(ms)}`);
const attesaDelLivello = (livello: number) => Math.min(ATTESA_MASSIMA_MS, PRIMA_ATTESA_MS * 2 ** livello);

export type Limitatore = {
  /** Conta un tentativo; solleva 429 se la chiave è in attesa o se questo tentativo fa partire il blocco. */
  tentativo(chiave: string): Promise<void>;
  /** Tentativo riuscito: azzera conto e livello. */
  riuscito(chiave: string): Promise<void>;
};

export function limitatoreInMemoria(adesso: () => number = Date.now): Limitatore {
  const blocchi = new Map<string, { conta: number; livello: number; bloccatoFino: number; ultimo: number }>();
  return {
    // Nessun await prima del conto: la funzione è async solo per avere la stessa interfaccia.
    async tentativo(chiave) {
      const ora = adesso();
      if (blocchi.size >= MAX_CHIAVI) {
        for (const [k, v] of blocchi) if (ora > v.bloccatoFino && ora - v.ultimo > DIMENTICA_DOPO_MS) blocchi.delete(k);
        for (const k of blocchi.keys()) {
          if (blocchi.size < MAX_CHIAVI / 2) break;
          blocchi.delete(k);
        }
      }
      let b = blocchi.get(chiave);
      if (!b || (ora > b.bloccatoFino && ora - b.ultimo > DIMENTICA_DOPO_MS)) b = { conta: 0, livello: 0, bloccatoFino: 0, ultimo: ora };
      blocchi.set(chiave, b);
      if (ora < b.bloccatoFino) throw troppi(b.bloccatoFino - ora);
      b.conta += 1;
      b.ultimo = ora;
      if (b.conta > TENTATIVI_PRIMA_DEL_BLOCCO) {
        const attesa = attesaDelLivello(b.livello);
        b.bloccatoFino = ora + attesa;
        b.livello += 1;
        b.conta = 0;
        throw troppi(attesa);
      }
    },
    async riuscito(chiave) {
      blocchi.delete(chiave);
    },
  };
}

export function limitatoreSuDatabase(prisma: PrismaClient, adesso: () => number = Date.now): Limitatore {
  /** Incremento in un'operazione sola; se due richieste creano la riga insieme, la seconda riprova. */
  async function incrementa(chiave: string, ora: Date) {
    for (let giro = 0; ; giro++) {
      try {
        return await prisma.tentativoAccesso.upsert({
          where: { chiave },
          create: { chiave, conta: 1, ultimo: ora, bloccatoFino: new Date(0) },
          update: { conta: { increment: 1 }, ultimo: ora },
        });
      } catch (e) {
        if (giro >= 2) throw e;
      }
    }
  }

  return {
    async tentativo(chiave) {
      const ora = adesso();
      const prima = await prisma.tentativoAccesso.findUnique({ where: { chiave } });
      if (prima && ora < prima.bloccatoFino.getTime()) throw troppi(prima.bloccatoFino.getTime() - ora);
      // Fermo da più di 24 ore: si riparte da zero.
      if (prima && ora - prima.ultimo.getTime() > DIMENTICA_DOPO_MS) await prisma.tentativoAccesso.deleteMany({ where: { chiave } });
      const riga = await incrementa(chiave, new Date(ora));
      if (riga.conta > TENTATIVI_PRIMA_DEL_BLOCCO) {
        const attesa = attesaDelLivello(riga.livello);
        await prisma.tentativoAccesso.updateMany({ where: { chiave }, data: { conta: 0, livello: { increment: 1 }, bloccatoFino: new Date(ora + attesa) } });
        throw troppi(attesa);
      }
    },
    async riuscito(chiave) {
      await prisma.tentativoAccesso.deleteMany({ where: { chiave } });
    },
  };
}
