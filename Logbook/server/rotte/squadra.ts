// "><(((º> sabusabu <º)))><"
/**
 * Caposquadra (Giorno 43, 26/11/2026, risposta 3a: "inserisce le ore solo per i dipendenti
 * dei suoi progetti; HR vede e corregge tutto"). Montato su /api/squadra.
 *
 * Chi è caposquadra lo decide HR, progetto per progetto (AssegnazioneProgetto.caposquadra,
 * dalla scheda del progetto). Un caposquadra può scrivere le ore dei dipendenti assegnati a
 * QUEL progetto, e solo SU quel progetto: non vede e non tocca le ore che gli stessi
 * dipendenti hanno su altri progetti (ne riceve solo gli orari occupati, per non sovrapporsi).
 * Le ore nascono con origine CAPOSQUADRA, così HR le riconosce e le può correggere.
 *
 * Limiti (oltre alle regole di tutte le ore: festivi, ferie, massimo del progetto, mese chiuso):
 * - solo progetti ATTIVI di cui si è caposquadra;
 * - solo oggi e i GIORNI_INDIETRO giorni precedenti: le correzioni più vecchie restano a HR.
 *
 * - GET /          i miei progetti da caposquadra, ognuno con la squadra;
 * - GET /giornata  ?progettoId&data: per ogni dipendente le fasce su quel progetto e gli
 *                  orari già occupati da altri progetti;
 * - PUT /giornata  {progettoId, dipendenteId, data, fasce:[{oraInizio, oraFine}]}: sostituisce
 *                  le fasce di quel dipendente su quel progetto in quel giorno (elenco vuoto = le toglie).
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { aggiungiGiorni, formattaData, isDataValida } from '../../comune/date';
import { durataMinuti, isOrarioValido } from '../../comune/orari';
import { coppieSovrapposte, messaggioMassimo, siSovrappongono, superamentiMassimo } from '../../comune/registrazioni';
import { ErroreHttp, richiestaNonValida, vietato } from '../errori';
import { idDaParametro } from '../middleware';
import { controllaMesiAperti } from '../servizi/mesi-chiusi';
import { caricaContestoOre, erroriRegole } from '../servizi/regole-ore';

/** Quanti giorni indietro, oltre a oggi, il caposquadra può scrivere. */
export const GIORNI_INDIETRO = 7;

const orario = (nome: string) => z.string({ error: `${nome}: campo obbligatorio` }).refine(isOrarioValido, `${nome}: orario non valido (HH:MM)`);
const schemaGiornataSquadra = z.object({
  progettoId: z.coerce.number().int().positive('Progetto non valido'),
  dipendenteId: z.coerce.number().int().positive('Dipendente non valido'),
  data: z.string().refine(isDataValida, 'Data non valida'),
  fasce: z.array(z.object({ oraInizio: orario('Ora inizio'), oraFine: orario('Ora fine') })).max(12, 'Troppe fasce nello stesso giorno'),
});

/** true se il dipendente è caposquadra di almeno un progetto attivo (serve al menu). */
export async function isCaposquadra(prisma: PrismaClient, dipendenteId: number | null | undefined): Promise<boolean> {
  if (dipendenteId == null) return false;
  return (await prisma.assegnazioneProgetto.count({ where: { dipendenteId, caposquadra: true, progetto: { stato: 'ATTIVO' } } })) > 0;
}

export function rotteSquadra(prisma: PrismaClient, oggi: () => string) {
  const router = Router();

  const mioDipendente = (req: Request): number => {
    const id = req.utente?.dipendenteId;
    if (id == null) throw vietato('Il tuo account non è collegato a una scheda dipendente');
    return id;
  };

  /** 403 se chi chiama non è caposquadra di quel progetto attivo. */
  async function controllaCaposquadra(req: Request, progettoId: number) {
    const a = await prisma.assegnazioneProgetto.findUnique({
      where: { progettoId_dipendenteId: { progettoId, dipendenteId: mioDipendente(req) } },
      include: { progetto: { select: { id: true, codice: true, nome: true, stato: true, maxMinutiGiorno: true } } },
    });
    if (!a?.caposquadra) throw vietato('Non sei caposquadra di questo progetto');
    if (a.progetto.stato !== 'ATTIVO') throw vietato(`Il progetto ${a.progetto.codice} non è attivo`);
    return a.progetto;
  }

  function controllaGiorno(data: string) {
    const giorno = oggi();
    if (data > giorno) throw richiestaNonValida('Non si registrano ore nei giorni futuri', { data: 'Giorno futuro' });
    if (data < aggiungiGiorni(giorno, -GIORNI_INDIETRO)) {
      throw richiestaNonValida(`Da caposquadra puoi scrivere le ore di oggi e dei ${GIORNI_INDIETRO} giorni precedenti: per date più vecchie rivolgiti a HR`, { data: 'Giorno troppo vecchio' });
    }
  }

  /** Dipendenti attivi assegnati al progetto: la squadra. */
  const squadra = (progettoId: number) =>
    prisma.dipendente.findMany({
      where: { stato: 'ATTIVO', assegnazioni: { some: { progettoId } } },
      select: { id: true, nome: true, cognome: true, matricola: true },
      orderBy: [{ cognome: 'asc' }, { nome: 'asc' }],
    });

  router.get('/', async (req, res) => {
    const miei = await prisma.assegnazioneProgetto.findMany({
      where: { dipendenteId: mioDipendente(req), caposquadra: true, progetto: { stato: 'ATTIVO' } },
      include: { progetto: { select: { id: true, codice: true, nome: true, colore: true } } },
      orderBy: { progetto: { codice: 'asc' } },
    });
    res.json({
      oggi: oggi(),
      dal: aggiungiGiorni(oggi(), -GIORNI_INDIETRO),
      progetti: await Promise.all(miei.map(async (a) => ({ ...a.progetto, squadra: await squadra(a.progettoId) }))),
    });
  });

  router.get('/giornata', async (req, res) => {
    const progettoId = idDaParametro(req.query.progettoId, 'progettoId');
    const data = String(req.query.data ?? '');
    if (!progettoId || !isDataValida(data)) throw richiestaNonValida('Servono progetto e data');
    await controllaCaposquadra(req, progettoId);
    const membri = await squadra(progettoId);
    const fasce = await prisma.registrazioneOraria.findMany({
      where: { dipendenteId: { in: membri.map((m) => m.id) }, data },
      select: { id: true, dipendenteId: true, progettoId: true, oraInizio: true, oraFine: true, origine: true },
      orderBy: { oraInizio: 'asc' },
    });
    res.json(
      membri.map((m) => {
        const sue = fasce.filter((f) => f.dipendenteId === m.id);
        return {
          ...m,
          fasce: sue.filter((f) => f.progettoId === progettoId).map(({ id, oraInizio, oraFine, origine }) => ({ id, oraInizio, oraFine, origine })),
          // Degli altri progetti solo gli orari: il caposquadra non vede su cosa.
          occupato: sue.filter((f) => f.progettoId !== progettoId).map(({ oraInizio, oraFine }) => ({ oraInizio, oraFine })),
        };
      }),
    );
  });

  router.put('/giornata', async (req, res) => {
    const g = schemaGiornataSquadra.parse(req.body);
    const progetto = await controllaCaposquadra(req, g.progettoId);
    controllaGiorno(g.data);
    if (!(await squadra(g.progettoId)).some((m) => m.id === g.dipendenteId)) throw vietato('Questo dipendente non è nella squadra del progetto');
    for (const [i, f] of g.fasce.entries()) {
      if (f.oraFine <= f.oraInizio) throw richiestaNonValida('L\'ora di fine deve essere dopo l\'inizio', { [`fasce.${i}.oraFine`]: 'Deve essere dopo l\'inizio' });
    }
    const doppie = coppieSovrapposte(g.fasce.map((f) => ({ ...f, progettoId: g.progettoId })));
    if (doppie.length) throw richiestaNonValida('Due fasce si sovrappongono', { [`fasce.${doppie[0][1]}.oraInizio`]: 'Si sovrappone a un\'altra fascia' });

    await controllaMesiAperti(prisma, [g.data]);
    const [ctx, delGiorno] = await Promise.all([
      caricaContestoOre(prisma, { dipendenteIds: [g.dipendenteId], da: g.data, a: g.data, oggi: oggi() }),
      prisma.registrazioneOraria.findMany({ where: { dipendenteId: g.dipendenteId, data: g.data } }),
    ]);
    const altre = delGiorno.filter((f) => f.progettoId !== g.progettoId);
    if (g.fasce.length) {
      const errori = erroriRegole(ctx, { dipendenteId: g.dipendenteId, data: g.data, progettoId: g.progettoId });
      if (errori.length) throw richiestaNonValida(errori[0].messaggio);
    }
    for (const f of g.fasce) {
      const conflitto = altre.find((a) => siSovrappongono(f, a));
      if (conflitto) throw new ErroreHttp(409, `La fascia ${f.oraInizio}-${f.oraFine} si sovrappone a ore già registrate su un altro progetto (${conflitto.oraInizio}-${conflitto.oraFine}) il ${formattaData(g.data)}`);
    }
    const nuove = g.fasce.map((f) => ({ ...f, progettoId: g.progettoId }));
    const oltre = superamentiMassimo([...altre, ...nuove], new Map([[progetto.id, progetto.maxMinutiGiorno]]));
    if (oltre.length) throw richiestaNonValida(messaggioMassimo(progetto.codice, oltre[0].minuti, oltre[0].massimo));

    // Sostituzione atomica delle sole fasce di questo progetto: le altre non si toccano.
    await prisma.$transaction([
      prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: g.dipendenteId, data: g.data, progettoId: g.progettoId } }),
      prisma.registrazioneOraria.createMany({ data: nuove.map((f) => ({ ...f, dipendenteId: g.dipendenteId, data: g.data, origine: 'CAPOSQUADRA' as const })) }),
    ]);
    res.json({ salvate: nuove.length, minuti: nuove.reduce((s, f) => s + durataMinuti(f.oraInizio, f.oraFine), 0) });
  });

  return router;
}
