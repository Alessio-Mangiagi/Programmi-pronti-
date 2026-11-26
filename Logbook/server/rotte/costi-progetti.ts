// "><(((º> sabusabu <º)))><"
/**
 * Costo della manodopera per commessa (Giorno 41, 26/11/2026), montato su /api/costi-progetti.
 * Solo amministratori: i costi orari sono dati riservati di HR.
 *
 * - GET /               tutti i progetti con ore, costo lordo e netto e confronto col preventivo;
 * - GET /:id            un progetto: dettaglio per dipendente e per mese;
 * - PUT /:id/preventivo preventivo della manodopera (euro lordi) e ore preventivate.
 *
 * Come si calcola il costo: minuti registrati sul progetto × costo orario del dipendente
 * (scheda del dipendente: lordo e netto). Si usa il costo orario di OGGI anche per le ore
 * passate: Logbook non conserva lo storico dei costi, quindi dopo un aumento il costo dei
 * mesi precedenti risulta ricalcolato. Chi non ha il costo orario in anagrafica conta nelle
 * ore ma non negli euro, e viene segnalato (`senzaCosto`): il totale in quel caso è parziale.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { durataMinuti } from '../../comune/orari';
import { nonTrovato } from '../errori';
import { idDaParametro, richiediAdmin } from '../middleware';

/** Costo in centesimi di `minuti` di lavoro a `centOra` centesimi l'ora. */
export function costoCent(minuti: number, centOra: number): number {
  return Math.round((minuti * centOra) / 60);
}

/** Percentuale consumata di un preventivo (null se il preventivo manca o è zero). */
export function percentuale(consumato: number, preventivo: number | null | undefined): number | null {
  return preventivo ? Math.round((consumato / preventivo) * 1000) / 10 : null;
}

const facoltativo = (nome: string, massimo: number) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number({ error: `${nome}: numero non valido` }).min(0, `${nome}: non può essere negativo`).max(massimo, `${nome}: valore troppo alto`).nullable());

const schemaPreventivo = z.object({
  preventivoManodoperaCent: facoltativo('Preventivo manodopera', 1_000_000_000_00).transform((v) => (v == null ? null : Math.round(v))),
  preventivoOre: facoltativo('Ore preventivate', 10_000_000),
});

type Fascia = { progettoId: number; dipendenteId: number; data: string; oraInizio: string; oraFine: string };
type Costi = { costoOrarioLordoCent: number | null; costoOrarioNettoCent: number | null };

/** Somma ore e costi di un insieme di fasce; `senzaCosto` = dipendenti con ore ma senza costo orario lordo. */
function totali(fasce: Fascia[], costi: Map<number, Costi>) {
  let minuti = 0;
  let lordo = 0;
  let netto = 0;
  const senza = new Set<number>();
  for (const f of fasce) {
    const m = durataMinuti(f.oraInizio, f.oraFine);
    const c = costi.get(f.dipendenteId);
    minuti += m;
    if (c?.costoOrarioLordoCent != null) lordo += (m * c.costoOrarioLordoCent) / 60;
    else senza.add(f.dipendenteId);
    if (c?.costoOrarioNettoCent != null) netto += (m * c.costoOrarioNettoCent) / 60;
  }
  return { minuti, costoLordoCent: Math.round(lordo), costoNettoCent: Math.round(netto), senzaCosto: senza.size };
}

export function rotteCostiProgetti(prisma: PrismaClient) {
  const router = Router();
  router.use(richiediAdmin);

  const mappaCosti = async () =>
    new Map(
      (await prisma.dipendente.findMany({ select: { id: true, nome: true, cognome: true, costoOrarioLordoCent: true, costoOrarioNettoCent: true } })).map((d) => [d.id, d] as const),
    );
  const SELEZIONE = { progettoId: true, dipendenteId: true, data: true, oraInizio: true, oraFine: true } as const;

  router.get('/', async (_req, res) => {
    const [progetti, fasce, costi] = await Promise.all([
      prisma.progetto.findMany({ orderBy: { codice: 'asc' } }),
      prisma.registrazioneOraria.findMany({ select: SELEZIONE }),
      mappaCosti(),
    ]);
    res.json(
      progetti.map((p) => {
        const t = totali(fasce.filter((f) => f.progettoId === p.id), costi);
        return {
          id: p.id, codice: p.codice, nome: p.nome, stato: p.stato, colore: p.colore,
          ...t,
          preventivoManodoperaCent: p.preventivoManodoperaCent,
          preventivoOre: p.preventivoOre,
          percentualeCosto: percentuale(t.costoLordoCent, p.preventivoManodoperaCent),
          percentualeOre: percentuale(t.minuti / 60, p.preventivoOre),
        };
      }),
    );
  });

  router.get('/:id', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const p = await prisma.progetto.findUnique({ where: { id } });
    if (!p) throw nonTrovato('Progetto');
    const [fasce, costi] = await Promise.all([prisma.registrazioneOraria.findMany({ where: { progettoId: id }, select: SELEZIONE }), mappaCosti()]);
    const t = totali(fasce, costi);
    const perDipendente = [...new Set(fasce.map((f) => f.dipendenteId))]
      .map((dipendenteId) => {
        const d = costi.get(dipendenteId);
        const sue = totali(fasce.filter((f) => f.dipendenteId === dipendenteId), costi);
        return {
          dipendenteId,
          nome: d ? `${d.cognome} ${d.nome}` : `Dipendente ${dipendenteId}`,
          minuti: sue.minuti,
          costoOrarioLordoCent: d?.costoOrarioLordoCent ?? null,
          costoLordoCent: d?.costoOrarioLordoCent != null ? sue.costoLordoCent : null,
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    const perMese = [...new Set(fasce.map((f) => f.data.slice(0, 7)))].sort().map((mese) => {
      const sue = totali(fasce.filter((f) => f.data.startsWith(mese)), costi);
      return { mese, minuti: sue.minuti, costoLordoCent: sue.costoLordoCent };
    });
    res.json({
      id: p.id, codice: p.codice, nome: p.nome,
      ...t,
      preventivoManodoperaCent: p.preventivoManodoperaCent,
      preventivoOre: p.preventivoOre,
      percentualeCosto: percentuale(t.costoLordoCent, p.preventivoManodoperaCent),
      percentualeOre: percentuale(t.minuti / 60, p.preventivoOre),
      perDipendente,
      perMese,
    });
  });

  router.put('/:id/preventivo', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    if (!(await prisma.progetto.findUnique({ where: { id } }))) throw nonTrovato('Progetto');
    const dati = schemaPreventivo.parse(req.body);
    const p = await prisma.progetto.update({ where: { id }, data: dati });
    res.json({ preventivoManodoperaCent: p.preventivoManodoperaCent, preventivoOre: p.preventivoOre });
  });

  return router;
}
