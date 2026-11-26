// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/progetti: progetti (o commesse) su cui si registrano le ore, e dal Giorno 17
 * (24/11/2026) i dipendenti assegnati a ciascuno.
 *
 * - GET    /                     elenco; ?stato=ATTIVO per i soli selezionabili;
 *                                ?assegnatiA=<dipendenteId> solo i progetti di quel dipendente
 *                                (un DIPENDENTE può chiedere solo i propri). Ogni progetto ha
 *                                `assegnati` = quanti dipendenti ci sono assegnati.
 * - GET    /:id                  un progetto; un DIPENDENTE solo se ci è assegnato
 * - POST   /, PUT /:id           creazione e modifica (admin); se la modifica porta lo stato
 *                                a CHIUSO parte l'email di chiusura (Giorno 47, servizi/avvisi.ts)
 * - GET    /:id/dipendenti       dipendenti assegnati con le ore registrate sul progetto (admin)
 * - POST   /:id/dipendenti       { dipendenteId } assegna UN dipendente (admin)
 * - DELETE /:id/dipendenti/:dipendenteId   toglie l'assegnazione (admin); le ore già
 *                                registrate restano, ma non se ne possono aggiungere altre
 *
 * Lettura dell'elenco: HR tutti; un DIPENDENTE (verifica di sicurezza del Giorno 23) solo
 * i progetti a cui è assegnato più quelli su cui ha ore registrate (nel calendario servono
 * codice e colore delle sue ore anche se nel frattempo è stato tolto dal progetto), senza
 * commessa SkyTower e numero di assegnati, che sono dati di HR. Niente cancellazione dei progetti: uno finito si
 * mette in stato CHIUSO e non compare più fra quelli selezionabili, ma le ore già
 * registrate restano nei report.
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { durataMinuti } from '../../comune/orari';
import { schemaAssegnazione, schemaProgetto, type DatiProgetto } from '../../comune/schemi';
import { ErroreHttp, nonTrovato, richiestaNonValida, vietato } from '../errori';
import { dipendenteAmmesso, idDaParametro, isAdmin, richiediAdmin } from '../middleware';
import type { Avvisi } from '../servizi/avvisi';
import { tieniVivo } from '../vercel';

export function rotteProgetti(prisma: PrismaClient, avvisi?: Avvisi) {
  const router = Router();

  async function controllaCodice(dati: DatiProgetto, escludiId?: number) {
    const altro = await prisma.progetto.findUnique({ where: { codice: dati.codice } });
    if (altro && altro.id !== escludiId) {
      throw new ErroreHttp(409, 'Codice progetto già usato', { codice: `Codice già usato da "${altro.nome}"` });
    }
  }

  /** Il progetto esiste? Altrimenti 404. */
  async function progettoOppure404(id: number) {
    const p = await prisma.progetto.findUnique({ where: { id } });
    if (!p) throw nonTrovato('Progetto');
    return p;
  }

  router.get('/', async (req, res) => {
    const stato = req.query.stato;
    // ?assegnatiA: per il dipendente vale sempre e solo il suo id (dipendenteAmmesso → 403 se ne chiede un altro).
    const richiesto = idDaParametro(req.query.assegnatiA, 'assegnatiA');
    const assegnatiA = richiesto !== undefined ? dipendenteAmmesso(req, richiesto) : undefined;
    const admin = isAdmin(req);
    // Dipendente senza ?assegnatiA: i suoi progetti, cioè assegnati oppure con sue ore.
    const mioId = admin ? undefined : dipendenteAmmesso(req);
    const elenco = await prisma.progetto.findMany({
      where: {
        ...(stato === 'ATTIVO' || stato === 'SOSPESO' || stato === 'CHIUSO' ? { stato } : {}),
        ...(assegnatiA ? { assegnazioni: { some: { dipendenteId: assegnatiA } } } : {}),
        ...(!admin && !assegnatiA
          ? { OR: [{ assegnazioni: { some: { dipendenteId: mioId ?? -1 } } }, { registrazioni: { some: { dipendenteId: mioId ?? -1 } } }] }
          : {}),
      },
      include: { _count: { select: { assegnazioni: true } } },
      orderBy: { codice: 'asc' },
    });
    // Commessa SkyTower e preventivi (Giorno 41) sono dati di HR: ai dipendenti non arrivano.
    res.json(
      elenco.map(({ _count, commessaSkytower, preventivoManodoperaCent, preventivoOre, ...p }) =>
        admin ? { ...p, commessaSkytower, preventivoManodoperaCent, preventivoOre, assegnati: _count.assegnazioni } : p,
      ),
    );
  });

  router.get('/:id', async (req, res) => {
    const p = await progettoOppure404(idDaParametro(req.params.id)!);
    if (!isAdmin(req)) {
      const mioId = dipendenteAmmesso(req)!;
      const assegnato = await prisma.assegnazioneProgetto.findUnique({ where: { progettoId_dipendenteId: { progettoId: p.id, dipendenteId: mioId } } });
      if (!assegnato) throw vietato('Non sei assegnato a questo progetto');
      // Come nell'elenco: la commessa SkyTower è un dato di HR.
      const { commessaSkytower: _nascosta, preventivoManodoperaCent: _euro, preventivoOre: _ore, ...perDipendente } = p;
      res.json(perDipendente);
      return;
    }
    res.json(p);
  });

  router.post('/', richiediAdmin, async (req, res) => {
    const dati = schemaProgetto.parse(req.body);
    await controllaCodice(dati);
    res.status(201).json(await prisma.progetto.create({ data: dati }));
  });

  router.put('/:id', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const prima = await progettoOppure404(id);
    const dati = schemaProgetto.parse(req.body);
    await controllaCodice(dati, id);
    const dopo = await prisma.progetto.update({ where: { id }, data: dati });
    // Giorno 47: solo il passaggio a CHIUSO avvisa (non ogni salvataggio di un progetto già chiuso).
    // L'email parte a risposta già data: tieniVivo impedisce a Vercel di fermare la funzione prima.
    if (avvisi && prima.stato !== 'CHIUSO' && dopo.stato === 'CHIUSO') tieniVivo(avvisi.progettoChiuso(id));
    res.json(dopo);
  });

  // --- Dipendenti assegnati (Giorno 17, risposte 2a 3a) --------------------------------

  /**
   * Assegnati con le ore registrate da ciascuno sul progetto (utili a HR per capire chi ci
   * lavora davvero prima di togliere qualcuno).
   */
  router.get('/:id/dipendenti', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    await progettoOppure404(id);
    const [assegnazioni, fasce] = await Promise.all([
      prisma.assegnazioneProgetto.findMany({
        where: { progettoId: id },
        include: { dipendente: { select: { id: true, matricola: true, nome: true, cognome: true, codiceFiscale: true, mansione: true, stato: true } } },
      }),
      prisma.registrazioneOraria.findMany({ where: { progettoId: id }, select: { dipendenteId: true, oraInizio: true, oraFine: true } }),
    ]);
    const minuti = new Map<number, number>();
    for (const f of fasce) minuti.set(f.dipendenteId, (minuti.get(f.dipendenteId) ?? 0) + durataMinuti(f.oraInizio, f.oraFine));
    res.json(
      assegnazioni
        .map((a) => ({ id: a.id, creatoIl: a.creatoIl, caposquadra: a.caposquadra, dipendente: a.dipendente, minuti: minuti.get(a.dipendenteId) ?? 0 }))
        .sort((x, y) => `${x.dipendente.cognome} ${x.dipendente.nome}`.localeCompare(`${y.dipendente.cognome} ${y.dipendente.nome}`, 'it')),
    );
  });

  router.post('/:id/dipendenti', richiediAdmin, async (req, res) => {
    const progetto = await progettoOppure404(idDaParametro(req.params.id)!);
    const { dipendenteId } = schemaAssegnazione.parse(req.body);
    const dip = await prisma.dipendente.findUnique({ where: { id: dipendenteId } });
    if (!dip) throw nonTrovato('Dipendente');
    if (dip.stato === 'CESSATO') throw richiestaNonValida(`${dip.cognome} ${dip.nome} è cessato: non si può assegnare`, { dipendenteId: 'Dipendente cessato' });
    if (progetto.stato === 'CHIUSO') throw richiestaNonValida(`Il progetto ${progetto.codice} è chiuso`);
    const esiste = await prisma.assegnazioneProgetto.findUnique({ where: { progettoId_dipendenteId: { progettoId: progetto.id, dipendenteId } } });
    if (esiste) throw new ErroreHttp(409, `${dip.cognome} ${dip.nome} è già assegnato a ${progetto.codice}`, { dipendenteId: 'Già assegnato' });
    const a = await prisma.assegnazioneProgetto.create({ data: { progettoId: progetto.id, dipendenteId } });
    res.status(201).json(a);
  });

  /** Giorno 43: HR nomina (o toglie) il caposquadra del progetto fra i dipendenti assegnati. */
  router.put('/:id/dipendenti/:dipendenteId/caposquadra', richiediAdmin, async (req, res) => {
    const progettoId = idDaParametro(req.params.id)!;
    const dipendenteId = idDaParametro(req.params.dipendenteId, 'dipendenteId')!;
    const caposquadra = req.body?.caposquadra === true;
    const cambiate = await prisma.assegnazioneProgetto.updateMany({ where: { progettoId, dipendenteId }, data: { caposquadra } });
    if (!cambiate.count) throw nonTrovato('Assegnazione');
    res.json({ caposquadra });
  });

  router.delete('/:id/dipendenti/:dipendenteId', richiediAdmin, async (req, res) => {
    const progettoId = idDaParametro(req.params.id)!;
    const dipendenteId = idDaParametro(req.params.dipendenteId, 'dipendenteId')!;
    const tolte = await prisma.assegnazioneProgetto.deleteMany({ where: { progettoId, dipendenteId } });
    if (!tolte.count) throw nonTrovato('Assegnazione');
    res.status(204).end();
  });

  return router;
}
