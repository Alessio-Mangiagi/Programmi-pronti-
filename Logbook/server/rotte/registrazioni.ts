// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/registrazioni: fasce orarie lavorate.
 *
 * - GET    /                ?da&a&dipendenteId&progettoId — elenco con `minuti` calcolati
 * - PUT    /giornata        sostituisce tutte le fasce di un dipendente in un giorno
 *                           (è quello che usa l'editor della giornata nel calendario)
 * - POST   /blocco          stesse fasce sullo stesso progetto per più dipendenti e più
 *                           giorni (pannello del calendario, Giorno 27): tutto o niente
 * - DELETE /:id             cancella una sola fascia, subito (pulsante "Elimina fascia"
 *                           dell'editor della giornata, Giorno 24)
 *
 * Giorno 24 (risposta 2 del 24/11/2026): tolte le rotte POST / e PUT /:id per la fascia
 * singola, mai usate dall'interfaccia: le ore si scrivono solo a giornata intera.
 *
 * Lettura: il dipendente vede solo le proprie fasce (dipendenteAmmesso → 403), l'admin
 * tutte. Scrittura (giornata e cancellazione): SOLO HR, dal Giorno 20
 * (24/11/2026, risposta 1b "tutti i dati li inserisce HR"). Il Giorno 19 permetteva al
 * dipendente la sola giornata di oggi; ora nemmeno quella: se qualcosa non torna il
 * dipendente lo segnala (/api/segnalazioni) e HR interviene. Così nessuno può dichiarare
 * ore non lavorate che finirebbero nei pagamenti. Ogni scrittura controlla forma e sovrapposizioni (comune/registrazioni.ts) e le
 * regole di contesto (servizi/regole-ore.ts). Una sovrapposizione risponde 409 con il
 * messaggio che indica la fascia in conflitto.
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { isDataValida } from '../../comune/date';
import { durataMinuti } from '../../comune/orari';
import { formattaData } from '../../comune/date';
import { messaggioMassimo, schemaBlocco, schemaGiornata, siSovrappongono, superamentiMassimo, type ProblemaBlocco } from '../../comune/registrazioni';
import { nonTrovato, richiestaNonValida } from '../errori';
import { dipendenteAmmesso, idDaParametro, richiediAdmin } from '../middleware';
import { caricaContestoOre, erroriRegole } from '../servizi/regole-ore';
import { controllaMesiAperti } from '../servizi/mesi-chiusi';

/** Legge un parametro data opzionale; 400 se presente ma non "AAAA-MM-GG". */
export function dataDaQuery(valore: unknown, nome: string): string | undefined {
  if (valore === undefined || valore === '') return undefined;
  if (typeof valore !== 'string' || !isDataValida(valore)) throw richiestaNonValida(`Parametro "${nome}" non valido (AAAA-MM-GG)`);
  return valore;
}

const conProgetto = { progetto: { select: { codice: true, nome: true, colore: true, maxMinutiGiorno: true } } } as const;

export function rotteRegistrazioni(prisma: PrismaClient, oggi: () => string) {
  const router = Router();

  /** Fasce già registrate da un dipendente in un giorno (con progetto per i messaggi). */
  const fasceDelGiorno = (dipendenteId: number, data: string) =>
    prisma.registrazioneOraria.findMany({ where: { dipendenteId, data }, include: conProgetto, orderBy: { oraInizio: 'asc' } });

  /** Controlla le regole di contesto; al primo gruppo di errori risponde 400 per campo. */
  async function controllaRegole(dipendenteId: number, data: string, progettoIds: number[], giaPresenti: Set<number>) {
    const ctx = await caricaContestoOre(prisma, { dipendenteIds: [dipendenteId], da: data, a: data, oggi: oggi() });
    for (const [i, progettoId] of progettoIds.entries()) {
      const errori = erroriRegole(ctx, { dipendenteId, data, progettoId }, giaPresenti);
      if (errori.length) {
        const prefisso = progettoIds.length > 1 ? `fasce.${i}.` : '';
        const campi = Object.fromEntries(errori.map((e) => [e.campo === 'data' ? 'data' : prefisso + e.campo, e.messaggio]));
        throw richiestaNonValida(errori[0].messaggio, campi);
      }
    }
  }

  /**
   * Ore massime giornaliere dei progetti (risposta 2b): `fasce` sono TUTTE le fasce che il
   * dipendente avrebbe nel giorno dopo il salvataggio. Oltre il limite → 400 con l'errore
   * su ogni riga di quel progetto.
   */
  async function controllaMassimi(fasce: { progettoId: number; oraInizio: string; oraFine: string }[]) {
    const progetti = await prisma.progetto.findMany({ where: { id: { in: [...new Set(fasce.map((f) => f.progettoId))] } } });
    const oltre = superamentiMassimo(fasce, new Map(progetti.map((p) => [p.id, p.maxMinutiGiorno])));
    if (!oltre.length) return;
    const { progettoId, minuti, massimo } = oltre[0];
    const messaggio = messaggioMassimo(progetti.find((p) => p.id === progettoId)!.codice, minuti, massimo);
    const campi = Object.fromEntries(fasce.flatMap((f, i) => (f.progettoId === progettoId ? [[`fasce.${i}.progettoId`, messaggio]] : [])));
    throw richiestaNonValida(messaggio, campi);
  }

  router.get('/', async (req, res) => {
    const dipendenteId = dipendenteAmmesso(req, idDaParametro(req.query.dipendenteId, 'dipendenteId'));
    const progettoId = idDaParametro(req.query.progettoId, 'progettoId');
    const da = dataDaQuery(req.query.da, 'da');
    const a = dataDaQuery(req.query.a, 'a');
    const fasce = await prisma.registrazioneOraria.findMany({
      where: {
        ...(dipendenteId ? { dipendenteId } : {}),
        ...(progettoId ? { progettoId } : {}),
        ...(da || a ? { data: { ...(da ? { gte: da } : {}), ...(a ? { lte: a } : {}) } } : {}),
      },
      include: conProgetto,
      orderBy: [{ data: 'asc' }, { oraInizio: 'asc' }],
    });
    res.json(fasce.map((f) => ({ ...f, minuti: durataMinuti(f.oraInizio, f.oraFine) })));
  });

  router.put('/giornata', richiediAdmin, async (req, res) => {
    const g = schemaGiornata.parse(req.body);
    // Giorno 37: in un mese chiuso da HR le ore non si toccano (né aggiunte né tolte).
    await controllaMesiAperti(prisma, [g.data]);
    const esistenti = await fasceDelGiorno(g.dipendenteId, g.data);
    await controllaRegole(g.dipendenteId, g.data, g.fasce.map((f) => f.progettoId), new Set(esistenti.map((e) => e.progettoId)));
    await controllaMassimi(g.fasce);
    // Sostituzione atomica: o tutte le fasce nuove o nessuna modifica.
    await prisma.$transaction([
      prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: g.dipendenteId, data: g.data } }),
      prisma.registrazioneOraria.createMany({ data: g.fasce.map((f) => ({ ...f, dipendenteId: g.dipendenteId, data: g.data })) }),
    ]);
    const nuove = await fasceDelGiorno(g.dipendenteId, g.data);
    res.json(nuove.map((f) => ({ ...f, minuti: durataMinuti(f.oraInizio, f.oraFine) })));
  });

  /**
   * Inserimento a blocchi (Giorno 27, risposta 1a): per ogni dipendente e ogni giorno si
   * controllano le stesse regole della giornata (assegnazione al progetto, giorno futuro,
   * sabato/domenica/festivi, ferie e malattia, sovrapposizioni con le ore già registrate,
   * massimo del progetto). Tutto o niente: con anche un solo problema non si inserisce nulla
   * e la risposta 400 elenca chi, quale giorno e perché (al massimo 200 righe).
   * La tolleranza per i progetti chiusi o tolti vale solo per correggere ore vecchie, non qui.
   */
  router.post('/blocco', richiediAdmin, async (req, res) => {
    const b = schemaBlocco.parse(req.body);
    const date = [...new Set(b.date)].sort();
    await controllaMesiAperti(prisma, date);
    const dipendenteIds = [...new Set(b.dipendenteIds)];
    const [ctx, esistenti, progetti] = await Promise.all([
      caricaContestoOre(prisma, { dipendenteIds, da: date[0], a: date[date.length - 1], oggi: oggi() }),
      prisma.registrazioneOraria.findMany({ where: { dipendenteId: { in: dipendenteIds }, data: { in: date } }, include: conProgetto }),
      prisma.progetto.findMany({ select: { id: true, codice: true, maxMinutiGiorno: true } }),
    ]);
    const massimi = new Map(progetti.map((p) => [p.id, p.maxMinutiGiorno]));
    const codice = new Map(progetti.map((p) => [p.id, p.codice]));
    const nuove = b.fasce.map((f) => ({ ...f, progettoId: b.progettoId }));
    const problemi: ProblemaBlocco[] = [];
    for (const dipendenteId of dipendenteIds) {
      const d = ctx.dipendenti.get(dipendenteId);
      const nome = d ? `${d.cognome} ${d.nome}` : `Dipendente ${dipendenteId}`;
      for (const data of date) {
        const aggiungi = (messaggio: string) => problemi.push({ dipendenteId, dipendente: nome, data, messaggio });
        for (const e of erroriRegole(ctx, { dipendenteId, data, progettoId: b.progettoId })) aggiungi(e.messaggio);
        const delGiorno = esistenti.filter((e) => e.dipendenteId === dipendenteId && e.data === data);
        for (const f of nuove) {
          const conflitto = delGiorno.find((e) => siSovrappongono(f, e));
          if (conflitto) aggiungi(`La fascia ${f.oraInizio}-${f.oraFine} si sovrappone a quella già registrata ${conflitto.oraInizio}-${conflitto.oraFine} (${conflitto.progetto.codice})`);
        }
        for (const o of superamentiMassimo([...delGiorno, ...nuove], massimi)) aggiungi(messaggioMassimo(codice.get(o.progettoId) ?? '?', o.minuti, o.massimo));
      }
    }
    if (problemi.length) {
      const giorniCoinvolti = new Set(problemi.map((p) => `${p.dipendenteId}|${p.data}`)).size;
      res.status(400).json({
        errore: `Nessuna ora inserita: ${giorniCoinvolti === 1 ? 'una giornata non va bene' : `${giorniCoinvolti} giornate non vanno bene`}. Correggi la scelta e riprova.`,
        problemi: problemi.slice(0, 200),
        totaleProblemi: problemi.length,
      });
      return;
    }
    const righe = dipendenteIds.flatMap((dipendenteId) => date.flatMap((data) => nuove.map((f) => ({ ...f, dipendenteId, data, note: b.note }))));
    // In una transazione: o tutte le righe o nessuna, anche se Prisma le spezza in più INSERT.
    await prisma.$transaction([prisma.registrazioneOraria.createMany({ data: righe })]);
    res.status(201).json({ inserite: righe.length, dipendenti: dipendenteIds.length, giorni: date.length, minuti: righe.reduce((s, f) => s + durataMinuti(f.oraInizio, f.oraFine), 0), dal: formattaData(date[0]), al: formattaData(date[date.length - 1]) });
  });

  /**
   * Cancella una sola fascia, subito. Togliere ore è sempre possibile (anche nei giorni
   * festivi o su progetti chiusi): le regole valgono solo per le ore che si aggiungono.
   */
  router.delete('/:id', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const vecchia = await prisma.registrazioneOraria.findUnique({ where: { id } });
    if (!vecchia) throw nonTrovato('Registrazione');
    await controllaMesiAperti(prisma, [vecchia.data]);
    await prisma.registrazioneOraria.delete({ where: { id } });
    res.json({ ok: true });
  });

  return router;
}
