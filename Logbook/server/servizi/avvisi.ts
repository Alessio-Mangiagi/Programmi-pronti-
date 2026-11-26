// "><(((º> sabusabu <º)))><"
/**
 * Avvisi via email (26/11/2026). Prima di questo modulo ogni novità si vedeva solo entrando
 * in Logbook: una richiesta di ferie restava ferma finché HR non apriva la dashboard, e il
 * dipendente scopriva l'esito solo tornando a guardare.
 *
 * Quattro avvisi, ognuno si accende e si spegne da Impostazioni → Avvisi via email:
 * - `richieste`:   a HR, quando un dipendente chiede ferie/permesso o comunica una malattia;
 * - `esiti`:       al dipendente, quando HR approva o rifiuta la sua richiesta;
 * - `oreMancanti`: al dipendente, una volta alla settimana, se negli ultimi 14 giorni ha
 *                  giorni lavorativi senza ore (più un riepilogo a HR);
 * - `attestati`:   al dipendente e a HR, quando un attestato entra nei 30 giorni dalla
 *                  scadenza, poi a 7 giorni e il giorno in cui scade. Una volta per soglia.
 *
 * Dove stanno le scelte: tabella Impostazione, chiavi `avvisi.*` (CHIAVI_AVVISI). Gli
 * indirizzi di HR sono `avvisi.emailHr` (più indirizzi separati da virgola); se è vuota vale
 * l'email del proprietario (LOGBOOK_PROPRIETARIO_EMAIL).
 *
 * "Già mandato": tabella StatoTemporaneo, chiavi `avviso:…` create con una insert (la chiave è
 * unica): se due processi partono insieme (su Vercel succede) solo uno riesce a crearla e solo
 * quello spedisce. Così nessuno riceve due volte lo stesso promemoria.
 *
 * Chi chiama `giornaliero`: server/index.ts ogni ora (PC e suite), la manutenzione di
 * server/vercel-funzione.ts e la rotta /api/cron/avvisi (Vercel Cron). È sempre sicuro
 * chiamarla più volte: lavora una volta sola al giorno, e mai prima delle 7 di mattina.
 *
 * Senza posta configurata (inviaEmail assente) ogni funzione non fa nulla e non dà errore.
 */
import type { PrismaClient } from '../../generated/prisma/client';
import { aggiungiGiorni, formattaData, giornoSettimana } from '../../comune/date';
import { GIORNI_PREAVVISO_ATTESTATI } from '../../comune/documenti';
import { giorniLavorativi } from '../../comune/riepiloghi';
import type { InviaEmail } from './email';

export const CHIAVI_AVVISI = {
  emailHr: 'avvisi.emailHr',
  richieste: 'avvisi.richieste',
  esiti: 'avvisi.esiti',
  oreMancanti: 'avvisi.oreMancanti',
  attestati: 'avvisi.attestati',
} as const;

export type ScelteAvvisi = { emailHr: string[]; richieste: boolean; esiti: boolean; oreMancanti: boolean; attestati: boolean };

/** Giorni indietro in cui si cercano i giorni senza ore (due settimane: copre anche il cambio di mese). */
export const GIORNI_CONTROLLO_ORE = 14;
/** Soglie del preavviso sugli attestati, in giorni alla scadenza. */
const SOGLIE_ATTESTATI = [GIORNI_PREAVVISO_ATTESTATI, 7, 0];
/** Gli avvisi del giorno non partono prima di quest'ora (fuso italiano). */
export const ORA_AVVISI = 7;
const GIORNO_MS = 24 * 60 * 60 * 1000;

const NOMI_TIPO: Record<string, string> = { FERIE: 'ferie', PERMESSO: 'permesso', MALATTIA: 'malattia' };

/** Separa gli indirizzi scritti in un campo solo (virgola, punto e virgola, spazi, a capo). */
export function separaIndirizzi(testo: string): string[] {
  return [...new Set(testo.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/** Ora del giorno (0-23) nel fuso italiano: su Vercel l'orologio è UTC. */
export function oraItalia(adesso: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(adesso));
}

/** Scelte salvate; quello che non è mai stato toccato vale "acceso". */
export async function leggiScelteAvvisi(prisma: PrismaClient, emailProprietario?: string): Promise<ScelteAvvisi> {
  const righe = await prisma.impostazione.findMany({ where: { chiave: { in: Object.values(CHIAVI_AVVISI) } } });
  const v = (k: string) => righe.find((r) => r.chiave === k)?.valore;
  const acceso = (k: string) => v(k) !== '0';
  const salvati = separaIndirizzi(v(CHIAVI_AVVISI.emailHr) ?? '');
  return {
    emailHr: salvati.length ? salvati : emailProprietario ? [emailProprietario.trim().toLowerCase()] : [],
    richieste: acceso(CHIAVI_AVVISI.richieste),
    esiti: acceso(CHIAVI_AVVISI.esiti),
    oreMancanti: acceso(CHIAVI_AVVISI.oreMancanti),
    attestati: acceso(CHIAVI_AVVISI.attestati),
  };
}

type AssenzaAvviso = {
  tipo: string;
  dataInizio: string;
  dataFine: string;
  minutiPermesso: number | null;
  stato: string;
  noteDipendente: string | null;
  noteHr: string | null;
  dipendente: { nome: string; cognome: string; email?: string | null };
};

export type OpzioniAvvisi = {
  inviaEmail?: InviaEmail | null;
  emailProprietario?: string;
  /** Indirizzo a cui si apre Logbook, messo in fondo alle email (es. https://…vercel.app). */
  indirizzo?: string;
  adesso?: () => number;
};

/** Indirizzo pubblico di Logbook: variabile esplicita, oppure quello di produzione dato da Vercel. */
export function indirizzoDaAmbiente(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const scelto = env.LOGBOOK_INDIRIZZO_PUBBLICO?.trim().replace(/\/+$/, '');
  if (scelto) return scelto;
  return env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined;
}

export function creaAvvisi(prisma: PrismaClient, opzioni: OpzioniAvvisi = {}) {
  const invia = opzioni.inviaEmail ?? null;
  const adesso = opzioni.adesso ?? Date.now;
  const piede = `\n\n--\nLogbook, ore e presenze${opzioni.indirizzo ? `\n${opzioni.indirizzo}` : ''}\nMessaggio automatico: non rispondere a questa email.`;
  const scelte = () => leggiScelteAvvisi(prisma, opzioni.emailProprietario);

  /** Spedisce senza mai sollevare errori: un avviso non partito non deve bloccare il lavoro. */
  async function spedisci(a: string, oggetto: string, testo: string): Promise<boolean> {
    if (!invia) return false;
    try {
      await invia({ a, oggetto: `Logbook: ${oggetto}`, testo: testo + piede });
      return true;
    } catch (e) {
      console.warn(`[logbook] avviso "${oggetto}" non inviato:`, e instanceof Error ? e.message : e);
      return false;
    }
  }

  /**
   * Segna un avviso come mandato. true solo per chi crea la riga: la chiave è unica, quindi
   * fra due processi partiti insieme uno solo passa.
   */
  async function prenota(chiave: string, giorni: number): Promise<boolean> {
    try {
      await prisma.statoTemporaneo.create({ data: { chiave: `avviso:${chiave}`, valore: '1', scadeIl: new Date(adesso() + giorni * GIORNO_MS) } });
      return true;
    } catch {
      return false;
    }
  }

  const periodo = (a: AssenzaAvviso) =>
    a.tipo === 'PERMESSO'
      ? `${formattaData(a.dataInizio)}, ${Math.floor((a.minutiPermesso ?? 0) / 60)}:${String((a.minutiPermesso ?? 0) % 60).padStart(2, '0')} ore`
      : a.dataInizio === a.dataFine
        ? formattaData(a.dataInizio)
        : `dal ${formattaData(a.dataInizio)} al ${formattaData(a.dataFine)}`;

  return {
    /** Un dipendente ha mandato una richiesta: avviso a HR. */
    async nuovaRichiesta(a: AssenzaAvviso): Promise<number> {
      const s = await scelte();
      if (!invia || !s.richieste) return 0;
      const chi = `${a.dipendente.cognome} ${a.dipendente.nome}`;
      const tipo = NOMI_TIPO[a.tipo] ?? a.tipo.toLowerCase();
      const testo =
        `${chi} ha ${a.tipo === 'MALATTIA' ? 'comunicato una malattia' : `chiesto ${tipo}`}: ${periodo(a)}.` +
        (a.noteDipendente ? `\n\nNota del dipendente: ${a.noteDipendente}` : '') +
        `\n\nPer approvare o rifiutare: Logbook → Assenze.`;
      let mandate = 0;
      for (const indirizzo of s.emailHr) if (await spedisci(indirizzo, `richiesta di ${tipo} da ${chi}`, testo)) mandate++;
      return mandate;
    },

    /** HR ha deciso: avviso al dipendente, se ha un'email in anagrafica. */
    async esitoRichiesta(a: AssenzaAvviso): Promise<number> {
      const s = await scelte();
      const indirizzo = a.dipendente.email?.trim();
      if (!invia || !s.esiti || !indirizzo || (a.stato !== 'APPROVATA' && a.stato !== 'RIFIUTATA')) return 0;
      const tipo = NOMI_TIPO[a.tipo] ?? a.tipo.toLowerCase();
      const esito = a.stato === 'APPROVATA' ? 'approvata' : 'rifiutata';
      const testo =
        `Ciao ${a.dipendente.nome},\n\nla tua richiesta di ${tipo} (${periodo(a)}) è stata ${esito}.` +
        (a.noteHr ? `\n\nNota dell'ufficio personale: ${a.noteHr}` : '');
      return (await spedisci(indirizzo, `richiesta di ${tipo} ${esito}`, testo)) ? 1 : 0;
    },

    /** Email di prova agli indirizzi di HR, dal pulsante delle impostazioni. Solleva se non parte. */
    async prova(): Promise<string[]> {
      const s = await scelte();
      if (!invia) throw new Error('La posta non è configurata su questo Logbook');
      if (!s.emailHr.length) throw new Error('Nessun indirizzo di HR a cui scrivere');
      for (const indirizzo of s.emailHr) {
        await invia({ a: indirizzo, oggetto: 'Logbook: email di prova', testo: `Questa è l'email di prova degli avvisi di Logbook: l'invio funziona.${piede}` });
      }
      return s.emailHr;
    },

    /**
     * Avvisi del giorno: promemoria delle ore mancanti (una volta alla settimana) e attestati
     * in scadenza. Si può chiamare quante volte si vuole: lavora una volta sola per giorno.
     * `oggi` è la data di Logbook (AAAA-MM-GG, fuso italiano).
     */
    async giornaliero(oggi: string): Promise<{ fatto: boolean; oreMancanti: number; attestati: number }> {
      const niente = { fatto: false, oreMancanti: 0, attestati: 0 };
      if (!invia || !(await prenota(`giorno:${oggi}`, 3))) return niente;
      const s = await scelte();
      const esito = { fatto: true, oreMancanti: 0, attestati: 0 };

      // --- Ore mancanti: al primo giro di ogni settimana (di lunedì, o più tardi se il PC era spento).
      const lunedi = aggiungiGiorni(oggi, -((giornoSettimana(oggi) + 6) % 7));
      if (s.oreMancanti && (await prenota(`ore:${lunedi}`, 21))) {
        const ieri = aggiungiGiorni(oggi, -1);
        const da = aggiungiGiorni(oggi, -GIORNI_CONTROLLO_ORE);
        const [dipendenti, fasce, assenze, festivita] = await Promise.all([
          prisma.dipendente.findMany({ where: { stato: 'ATTIVO' }, orderBy: [{ cognome: 'asc' }, { nome: 'asc' }] }),
          prisma.registrazioneOraria.findMany({ where: { data: { gte: da, lte: ieri } }, select: { dipendenteId: true, data: true } }),
          // Le assenze di un giorno intero, anche ancora da approvare: chi ha chiesto ferie non va sollecitato.
          prisma.assenza.findMany({ where: { tipo: { not: 'PERMESSO' }, stato: { in: ['APPROVATA', 'RICHIESTA'] }, dataInizio: { lte: ieri }, dataFine: { gte: da } } }),
          prisma.festivita.findMany({ where: { data: { gte: da, lte: ieri } } }),
        ]);
        const festivi = new Set(festivita.map((f) => f.data));
        const riepilogo: string[] = [];
        for (const d of dipendenti) {
          const inizio = d.dataAssunzione > da ? d.dataAssunzione : da;
          const fine = d.dataCessazione && d.dataCessazione < ieri ? d.dataCessazione : ieri;
          if (inizio > fine) continue;
          const conOre = new Set(fasce.filter((f) => f.dipendenteId === d.id).map((f) => f.data));
          const mie = assenze.filter((a) => a.dipendenteId === d.id);
          const mancanti = giorniLavorativi(inizio, fine, festivi).filter((g) => !conOre.has(g) && !mie.some((a) => a.dataInizio <= g && g <= a.dataFine));
          if (!mancanti.length) continue;
          const elenco = mancanti.map(formattaData).join(', ');
          riepilogo.push(`- ${d.cognome} ${d.nome}: ${elenco}`);
          const indirizzo = d.email?.trim();
          if (!indirizzo) continue;
          const testo =
            `Ciao ${d.nome},\n\nnegli ultimi ${GIORNI_CONTROLLO_ORE} giorni ${mancanti.length === 1 ? 'risulta un giorno lavorativo' : `risultano ${mancanti.length} giorni lavorativi`} senza ore registrate:\n${elenco}\n\n` +
            `Se hai lavorato, comunica le ore all'ufficio personale; se eri assente, inserisci la richiesta in Logbook → Assenze.`;
          if (await spedisci(indirizzo, 'giorni senza ore registrate', testo)) esito.oreMancanti++;
        }
        if (riepilogo.length) {
          const testo = `Giorni lavorativi senza ore negli ultimi ${GIORNI_CONTROLLO_ORE} giorni (fino al ${formattaData(ieri)}):\n\n${riepilogo.join('\n')}\n\nDettaglio in Logbook → Dashboard.`;
          for (const indirizzo of s.emailHr) await spedisci(indirizzo, `giorni senza ore, ${riepilogo.length} ${riepilogo.length === 1 ? 'dipendente' : 'dipendenti'}`, testo);
        }
      }

      // --- Attestati: una email per soglia superata (30 giorni, 7 giorni, scaduto).
      if (s.attestati) {
        const attestati = await prisma.attestato.findMany({
          where: { dataScadenza: { not: null, lte: aggiungiGiorni(oggi, GIORNI_PREAVVISO_ATTESTATI) }, dipendente: { stato: 'ATTIVO' } },
          include: { dipendente: { select: { nome: true, cognome: true, email: true } } },
          orderBy: { dataScadenza: 'asc' },
        });
        const perHr: string[] = [];
        for (const a of attestati) {
          const scadenza = a.dataScadenza!;
          // La soglia più stretta già superata: 0 se è scaduto, 7 se manca una settimana o meno, altrimenti 30.
          const soglia = [...SOGLIE_ATTESTATI].reverse().find((g) => scadenza <= aggiungiGiorni(oggi, g))!;
          if (!(await prenota(`attestato:${a.id}:${scadenza}:${soglia}`, 400))) continue;
          const quando = scadenza < oggi ? `è scaduto il ${formattaData(scadenza)}` : scadenza === oggi ? 'scade oggi' : `scade il ${formattaData(scadenza)}`;
          perHr.push(`- ${a.dipendente.cognome} ${a.dipendente.nome}: "${a.titolo}" ${quando}`);
          esito.attestati++;
          const indirizzo = a.dipendente.email?.trim();
          if (indirizzo) {
            await spedisci(indirizzo, `attestato in scadenza: ${a.titolo}`, `Ciao ${a.dipendente.nome},\n\nil tuo attestato "${a.titolo}" ${quando}.\n\nContatta l'ufficio personale per il rinnovo.`);
          }
        }
        if (perHr.length) {
          for (const indirizzo of s.emailHr) await spedisci(indirizzo, `attestati da rinnovare (${perHr.length})`, `Attestati scaduti o in scadenza:\n\n${perHr.join('\n')}\n\nDettaglio in Logbook → Dashboard.`);
        }
      }
      return esito;
    },
  };
}

export type Avvisi = ReturnType<typeof creaAvvisi>;
