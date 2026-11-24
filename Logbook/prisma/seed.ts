// "><(((º> sabusabu <º)))><"
/**
 * Dati di esempio di Logbook: 5 dipendenti, 3 progetti, festività nazionali e ore
 * lavorate dal primo giorno del mese scorso fino a ieri (almeno un mese pieno), con
 * qualche assenza in ogni stato (approvata, richiesta, rifiutata).
 *
 * Le date sono relative al giorno in cui si lancia il seed, così il calendario non è
 * mai vuoto; la scelta dei progetti usa un generatore pseudo-casuale con seme fisso,
 * quindi lo stesso giorno produce sempre gli stessi dati.
 *
 * Si usa in tre modi:
 * - da solo `npm run dev` la prima volta (scripts/prepara-db.ts, solo se il DB è vuoto);
 * - `npm run db:reset`: cancella TUTTO e ricarica questi dati;
 * - `npm run db:seed`: rifiuta di partire se il database contiene già dipendenti,
 *   per non mescolare dati di prova e dati veri.
 *
 * Nomi, codici fiscali (con carattere di controllo valido), telefoni e clienti sono
 * inventati. Account di accesso: vedi CREDENZIALI_DEMO.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dipendente, Prisma, PrismaClient, Progetto } from '../generated/prisma/client';
import { carattereControllo } from '../comune/codiceFiscale';
import { aggiungiGiorni, dataIso, giorniNelMese, intervalloDate, isFineSettimana, oggiIso } from '../comune/date';
import { festivitaNazionali } from '../comune/festivita';
import { minutiDaOrario, orarioDaMinuti } from '../comune/orari';
import { creaImpronta } from '../server/auth/password';

/** Generatore pseudo-casuale mulberry32: stessi numeri a ogni esecuzione col seme dato. */
function generatore(seme: number) {
  let a = seme >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Credenziali dei dati di esempio (riportate nel README). Solo per prova: su un
 * database vero si cambiano subito da "Cambia password".
 */
export const CREDENZIALI_DEMO = {
  admin: { username: 'admin', password: 'Admin2026!' },
  passwordDipendenti: 'Logbook2026!',
} as const;

/** Username dei dipendenti di esempio: nome.cognome in minuscolo (es. mario.rossi). */
export const usernameDemo = (d: { nome: string; cognome: string }) => `${d.nome}.${d.cognome}`.toLowerCase();

/** Codice fiscale completo dai primi 15 caratteri (calcola il carattere di controllo). */
const cf = (primi15: string) => primi15 + carattereControllo(primi15);

const PROGETTI = [
  { codice: 'PRG-001', nome: 'Ristrutturazione scuola media', cliente: 'Comune di Esempio', colore: '#0c4577', maxMinutiGiorno: 540 },
  { codice: 'PRG-002', nome: 'Nuovo capannone logistico', cliente: 'Logistica Demo S.r.l.', colore: '#65bc7b', maxMinutiGiorno: 540 },
  { codice: 'PRG-003', nome: 'Manutenzione rete idrica', cliente: 'Acque Esempio S.p.A.', colore: '#d97706', maxMinutiGiorno: null },
] as const;

/**
 * Dipendenti di esempio con la loro giornata tipo: fasce (inizio-fine) e progetti su
 * cui lavorano (indici in PROGETTI). Ferrari è part-time a 30 ore, una fascia sola.
 */
const DIPENDENTI = [
  {
    dati: {
      matricola: '0001', nome: 'Mario', cognome: 'Rossi', codiceFiscale: cf('RSSMRA85C15C351'),
      email: 'mario.rossi@esempio.it', telefono: '333 000 0001', mansione: 'Capocantiere', reparto: 'Produzione',
      dataAssunzione: '2020-02-03', tipoContratto: 'INDETERMINATO', oreSettimanali: 40,
      costoOrarioNettoCent: 1450, costoOrarioLordoCent: 2780,
    },
    fasce: [['07:30', '12:30'], ['13:30', '16:30']], progetti: [0, 2],
  },
  {
    dati: {
      matricola: '0002', nome: 'Giulia', cognome: 'Bianchi', codiceFiscale: cf('BNCGLI90L62F205'),
      email: 'giulia.bianchi@esempio.it', telefono: '333 000 0002', mansione: 'Ingegnere di cantiere', reparto: 'Ufficio tecnico',
      dataAssunzione: '2020-09-14', tipoContratto: 'INDETERMINATO', oreSettimanali: 40,
      costoOrarioNettoCent: 1620, costoOrarioLordoCent: 3150,
    },
    fasce: [['08:30', '13:00'], ['14:00', '17:30']], progetti: [0, 1],
  },
  {
    dati: {
      matricola: '0003', nome: 'Luca', cognome: 'Esposito', codiceFiscale: cf('SPSLCU78S03F839'),
      email: 'luca.esposito@esempio.it', telefono: '333 000 0003', mansione: 'Operaio specializzato', reparto: 'Produzione',
      dataAssunzione: '2021-03-01', tipoContratto: 'INDETERMINATO', oreSettimanali: 40,
      costoOrarioNettoCent: 1180, costoOrarioLordoCent: 2290,
    },
    fasce: [['07:00', '12:00'], ['13:00', '16:00']], progetti: [0, 1],
  },
  {
    dati: {
      matricola: '0004', nome: 'Chiara', cognome: 'Ferrari', codiceFiscale: cf('FRRCHR95A49H501'),
      email: 'chiara.ferrari@esempio.it', telefono: '333 000 0004', mansione: 'Geometra', reparto: 'Ufficio tecnico',
      dataAssunzione: '2024-03-04', tipoContratto: 'DETERMINATO', oreSettimanali: 30,
      costoOrarioNettoCent: 1100, costoOrarioLordoCent: 2050,
    },
    fasce: [['08:00', '14:00']], progetti: [1, 2],
  },
  {
    dati: {
      matricola: '0005', nome: 'Giuseppe', cognome: 'Russo', codiceFiscale: cf('RSSGPP82E28G273'),
      email: 'giuseppe.russo@esempio.it', telefono: '333 000 0005', mansione: 'Operaio', reparto: 'Produzione',
      dataAssunzione: '2020-06-15', tipoContratto: 'INDETERMINATO', oreSettimanali: 40,
      costoOrarioNettoCent: 1050, costoOrarioLordoCent: 2010,
    },
    fasce: [['07:30', '12:00'], ['13:00', '16:30']], progetti: [1, 2],
  },
] as const;

/** Giorni lavorativi (lun-ven, non festivi) di un mese. */
function giorniLavorativi(anno: number, mese: number, festivi: Set<string>): string[] {
  return intervalloDate(dataIso(anno, mese, 1), dataIso(anno, mese, giorniNelMese(anno, mese))).filter(
    (d) => !isFineSettimana(d) && !festivi.has(d),
  );
}

/** Esito del seed, stampato a video e usato dai test. */
export type RiepilogoSeed = {
  dipendenti: number;
  progetti: number;
  registrazioni: number;
  assenze: number;
  festivita: number;
  periodo: { da: string; a: string };
};

/**
 * Carica i dati di esempio. `oggi` (AAAA-MM-GG) è il giorno di riferimento: le ore
 * arrivano fino al giorno prima. Solleva un errore se ci sono già dipendenti.
 */
export async function semina(prisma: PrismaClient, oggi: string = oggiIso()): Promise<RiepilogoSeed> {
  if ((await prisma.dipendente.count()) > 0) {
    throw new Error(
      'Il database contiene già dei dipendenti: il seed non parte per non mescolare dati di prova e dati veri. ' +
        'Per ripartire dai soli dati di esempio usare "npm run db:reset" (CANCELLA TUTTO).',
    );
  }

  const [annoOggi, meseOggi] = oggi.split('-').map(Number);
  // Mese scorso (gestendo gennaio → dicembre dell'anno prima) e mese prossimo.
  const annoPrec = meseOggi === 1 ? annoOggi - 1 : annoOggi;
  const mesePrec = meseOggi === 1 ? 12 : meseOggi - 1;
  const annoSucc = meseOggi === 12 ? annoOggi + 1 : annoOggi;
  const meseSucc = meseOggi === 12 ? 1 : meseOggi + 1;

  const inizio = dataIso(annoPrec, mesePrec, 1);
  const fine = aggiungiGiorni(oggi, -1);

  // --- Festività nazionali degli anni toccati dai dati (di solito uno solo) ---------
  const anni = [...new Set([annoPrec, annoOggi, annoSucc])];
  const festivita = anni.flatMap((anno) => festivitaNazionali(anno));
  await prisma.festivita.createMany({ data: festivita.map((f) => ({ ...f, tipo: 'NAZIONALE' as const })) });
  const festivi = new Set(festivita.map((f) => f.data));

  // --- Progetti: iniziati sei mesi prima dei dati, ancora aperti -----------------------
  const progetti: Progetto[] = [];
  for (const p of PROGETTI) {
    progetti.push(
      await prisma.progetto.create({
        data: { ...p, dataInizio: aggiungiGiorni(inizio, -180), dataFine: p.codice === 'PRG-003' ? null : aggiungiGiorni(fine, 240) },
      }),
    );
  }

  // --- Dipendenti ----------------------------------------------------------------------
  const dipendenti: Dipendente[] = [];
  for (const d of DIPENDENTI) dipendenti.push(await prisma.dipendente.create({ data: { ...d.dati } }));
  const [rossi, bianchi, esposito, ferrari, russo] = dipendenti;

  // --- Assegnazioni ai progetti (Giorno 17): ognuno ai due progetti su cui lavora --------
  // Senza assegnazione non si registrano ore (server/servizi/regole-ore.ts).
  await prisma.assegnazioneProgetto.createMany({
    data: DIPENDENTI.flatMap((modello, i) => modello.progetti.map((p) => ({ dipendenteId: dipendenti[i].id, progettoId: progetti[p].id }))),
  });

  // --- Account di accesso: un admin (HR) e un account per ogni dipendente ---------------
  const hr = await prisma.utente.create({
    data: { username: CREDENZIALI_DEMO.admin.username, passwordHash: await creaImpronta(CREDENZIALI_DEMO.admin.password), ruolo: 'ADMIN' },
  });
  const improntaDipendenti = await creaImpronta(CREDENZIALI_DEMO.passwordDipendenti);
  for (const d of dipendenti) {
    await prisma.utente.create({
      data: { username: usernameDemo(d), passwordHash: improntaDipendenti, ruolo: 'DIPENDENTE', dipendenteId: d.id },
    });
  }

  // --- Assenze: una per stato e per tipo, in giorni lavorativi veri ---------------------
  const lavPrec = giorniLavorativi(annoPrec, mesePrec, festivi);
  const lavOggi = giorniLavorativi(annoOggi, meseOggi, festivi);
  const lavSucc = giorniLavorativi(annoSucc, meseSucc, festivi);
  const decisoIl = new Date(`${inizio}T09:00:00`);
  const decisoDaId = hr.id;
  const assenze = [
    { dipendenteId: rossi.id, tipo: 'FERIE', dataInizio: lavPrec[5], dataFine: lavPrec[7], stato: 'APPROVATA', decisoIl, decisoDaId },
    {
      dipendenteId: esposito.id, tipo: 'MALATTIA', dataInizio: lavPrec[12], dataFine: lavPrec[13], stato: 'APPROVATA',
      protocolloCertificato: '7710453829', decisoIl, decisoDaId,
    },
    {
      dipendenteId: bianchi.id, tipo: 'PERMESSO', dataInizio: lavPrec[9], dataFine: lavPrec[9], minutiPermesso: 120,
      stato: 'APPROVATA', noteDipendente: 'Visita medica nel pomeriggio', decisoIl, decisoDaId,
    },
    {
      dipendenteId: russo.id, tipo: 'PERMESSO', dataInizio: lavOggi[2], dataFine: lavOggi[2], minutiPermesso: 240,
      stato: 'RIFIUTATA', noteHr: 'Quel giorno è prevista una consegna in cantiere: proporre un altro giorno', decisoIl, decisoDaId,
    },
    { dipendenteId: ferrari.id, tipo: 'FERIE', dataInizio: lavSucc[3], dataFine: lavSucc[5], stato: 'RICHIESTA', noteDipendente: 'Viaggio' },
    { dipendenteId: bianchi.id, tipo: 'PERMESSO', dataInizio: lavSucc[1], dataFine: lavSucc[1], minutiPermesso: 60, stato: 'RICHIESTA' },
  ] as const;
  await prisma.assenza.createMany({ data: assenze.map((a) => ({ ...a })) });

  /** Giorni interi di assenza approvata (ferie, malattia) per dipendente: niente ore. */
  const assente = (dipendenteId: number, data: string) =>
    assenze.some(
      (a) => a.dipendenteId === dipendenteId && a.stato === 'APPROVATA' && a.tipo !== 'PERMESSO' && a.dataInizio <= data && data <= a.dataFine,
    );
  /** Minuti di permesso approvato in quel giorno (si tolgono dalla fine dell'ultima fascia). */
  const permesso = (dipendenteId: number, data: string) =>
    assenze
      .filter((a) => a.dipendenteId === dipendenteId && a.stato === 'APPROVATA' && a.tipo === 'PERMESSO' && a.dataInizio === data)
      .reduce((s, a) => s + (('minutiPermesso' in a && a.minutiPermesso) || 0), 0);

  // --- Ore lavorate: ogni giorno lavorativo dal primo del mese scorso a ieri ------------
  const casuale = generatore(20261123);
  const registrazioni: Prisma.RegistrazioneOrariaCreateManyInput[] = [];
  for (const data of intervalloDate(inizio, fine)) {
    if (isFineSettimana(data) || festivi.has(data)) continue;
    DIPENDENTI.forEach((modello, i) => {
      const dip = dipendenti[i];
      if (assente(dip.id, data)) return;
      const tagliaMinuti = permesso(dip.id, data);
      modello.fasce.forEach(([oraInizio, oraFineBase], f) => {
        let oraFine: string = oraFineBase;
        const ultima = f === modello.fasce.length - 1;
        if (ultima && tagliaMinuti) oraFine = orarioDaMinuti(minutiDaOrario(oraFineBase) - tagliaMinuti);
        // Un giorno su otto circa, mezz'ora di straordinario a fine giornata.
        else if (ultima && casuale() < 0.12) oraFine = orarioDaMinuti(minutiDaOrario(oraFineBase) + 30);
        const progetto = progetti[modello.progetti[casuale() < 0.65 ? 0 : 1]];
        registrazioni.push({ dipendenteId: dip.id, progettoId: progetto.id, data, oraInizio, oraFine });
      });
    });
  }
  await prisma.registrazioneOraria.createMany({ data: registrazioni });

  return {
    dipendenti: dipendenti.length,
    progetti: progetti.length,
    registrazioni: registrazioni.length,
    assenze: assenze.length,
    festivita: festivita.length,
    periodo: { da: inizio, a: fine },
  };
}

// Eseguito come script (`prisma db seed` → `tsx prisma/seed.ts`), non quando importato.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { creaPrisma } = await import('../server/db');
  const prisma = creaPrisma();
  try {
    const r = await semina(prisma);
    console.log(
      `[logbook] dati di esempio caricati: ${r.dipendenti} dipendenti, ${r.progetti} progetti, ` +
        `${r.registrazioni} fasce orarie (${r.periodo.da} → ${r.periodo.a}), ${r.assenze} assenze, ${r.festivita} festività`,
    );
  } catch (err) {
    console.error('[logbook]', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
