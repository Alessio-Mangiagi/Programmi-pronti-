// "><(((º> sabusabu <º)))><"
/**
 * Regole che una fascia oraria deve rispettare oltre alla forma (quella la controlla
 * comune/registrazioni.ts): esistenza di dipendente e progetto, periodo di lavoro,
 * giorni di ferie/malattia, date future, e dal 24/11/2026 niente ore il sabato, la
 * domenica e i giorni festivi (richiesta: "nei giorni festivi, sabato e domenica non deve
 * poter essere possibile inserire nulla"). Togliere le ore già presenti in quei giorni
 * resta possibile: la regola scatta solo sulle fasce che si salvano.
 *
 * Usato da due punti con esigenze diverse:
 * - le rotte /api/registrazioni (una giornata alla volta);
 * - l'import Excel (Giorno 7), che controlla centinaia di righe e vuole tutti gli errori
 *   riga per riga invece di fermarsi al primo.
 * Per questo il contesto (dipendenti, progetti, assenze) si carica una volta sola e le
 * regole restituiscono un elenco di errori invece di sollevare eccezioni.
 */
import type { Assenza, Dipendente, PrismaClient, Progetto } from '../../generated/prisma/client';
import { formattaData, isFineSettimana } from '../../comune/date';

export type ContestoOre = {
  dipendenti: Map<number, Dipendente>;
  progetti: Map<number, Progetto>;
  /** Ferie e malattie APPROVATE dei dipendenti nel periodo: giorni senza ore. */
  assenzeIntere: Assenza[];
  /** Festività del periodo (data → descrizione): giorni senza ore. */
  festivita: Map<string, string>;
  /** Data di oggi (AAAA-MM-GG): non si registrano ore nei giorni futuri. */
  oggi: string;
};

export type ErroreRegola = { campo: 'dipendenteId' | 'progettoId' | 'data'; messaggio: string };

/** Carica quanto serve per controllare fasce di questi dipendenti fra `da` e `a`. */
export async function caricaContestoOre(
  prisma: PrismaClient,
  opzioni: { dipendenteIds: number[]; da: string; a: string; oggi: string },
): Promise<ContestoOre> {
  const [dipendenti, progetti, assenzeIntere, festivita] = await Promise.all([
    prisma.dipendente.findMany({ where: { id: { in: opzioni.dipendenteIds } } }),
    prisma.progetto.findMany(),
    prisma.assenza.findMany({
      where: {
        dipendenteId: { in: opzioni.dipendenteIds },
        stato: 'APPROVATA',
        tipo: { in: ['FERIE', 'MALATTIA'] },
        dataInizio: { lte: opzioni.a },
        dataFine: { gte: opzioni.da },
      },
    }),
    prisma.festivita.findMany({ where: { data: { gte: opzioni.da, lte: opzioni.a } } }),
  ]);
  return {
    dipendenti: new Map(dipendenti.map((d) => [d.id, d])),
    progetti: new Map(progetti.map((p) => [p.id, p])),
    assenzeIntere,
    festivita: new Map(festivita.map((f) => [f.data, f.descrizione])),
    oggi: opzioni.oggi,
  };
}

/**
 * Errori di una fascia rispetto al contesto (elenco vuoto = va bene).
 * `progettiGiaPresenti`: progetti che il dipendente aveva già quel giorno; per quelli
 * un progetto CHIUSO è tollerato, così si può correggere l'orario di ore vecchie.
 */
export function erroriRegole(
  ctx: ContestoOre,
  riga: { dipendenteId: number; data: string; progettoId: number },
  progettiGiaPresenti: Set<number> = new Set(),
): ErroreRegola[] {
  const errori: ErroreRegola[] = [];
  const dip = ctx.dipendenti.get(riga.dipendenteId);
  if (!dip) {
    errori.push({ campo: 'dipendenteId', messaggio: 'Dipendente inesistente' });
  } else {
    if (riga.data < dip.dataAssunzione) {
      errori.push({ campo: 'data', messaggio: `${dip.nome} ${dip.cognome} è stato assunto il ${formattaData(dip.dataAssunzione)}` });
    }
    if (dip.dataCessazione && riga.data > dip.dataCessazione) {
      errori.push({ campo: 'data', messaggio: `${dip.nome} ${dip.cognome} è cessato il ${formattaData(dip.dataCessazione)}` });
    }
  }
  if (riga.data > ctx.oggi) {
    errori.push({ campo: 'data', messaggio: 'Non si possono registrare ore per giorni futuri' });
  }
  if (isFineSettimana(riga.data)) {
    errori.push({ campo: 'data', messaggio: `Il ${formattaData(riga.data)} è ${new Date(`${riga.data}T12:00:00Z`).getUTCDay() === 6 ? 'sabato' : 'domenica'}: niente ore nel fine settimana` });
  }
  const festa = ctx.festivita.get(riga.data);
  if (festa) {
    errori.push({ campo: 'data', messaggio: `Il ${formattaData(riga.data)} è festivo (${festa}): niente ore nei giorni festivi` });
  }
  const assenza = ctx.assenzeIntere.find((a) => a.dipendenteId === riga.dipendenteId && a.dataInizio <= riga.data && riga.data <= a.dataFine);
  if (assenza) {
    const tipo = assenza.tipo === 'FERIE' ? 'ferie' : 'malattia';
    errori.push({ campo: 'data', messaggio: `Il ${formattaData(riga.data)} risulta in ${tipo} approvata: niente ore in quel giorno` });
  }
  const prog = ctx.progetti.get(riga.progettoId);
  if (!prog) {
    errori.push({ campo: 'progettoId', messaggio: 'Progetto inesistente' });
  } else {
    if (prog.stato === 'CHIUSO' && !progettiGiaPresenti.has(prog.id)) {
      errori.push({ campo: 'progettoId', messaggio: `Il progetto ${prog.codice} è chiuso` });
    }
    if (riga.data < prog.dataInizio || (prog.dataFine && riga.data > prog.dataFine)) {
      errori.push({ campo: 'progettoId', messaggio: `Il progetto ${prog.codice} non è aperto il ${formattaData(riga.data)}` });
    }
  }
  return errori;
}
