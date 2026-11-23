// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/dipendenti: anagrafica dei dipendenti.
 *
 * Lettura: l'admin vede tutti, il dipendente solo la propria scheda (e senza i costi
 * orari, che sono dati riservati a HR). Scrittura (Giorno 3): solo admin.
 */
import { Router } from 'express';
import type { Dipendente, PrismaClient } from '../../generated/prisma/client';
import { nonTrovato } from '../errori';
import { dipendenteAmmesso, idDaParametro, isAdmin } from '../middleware';

/** Toglie i campi riservati a HR quando chi legge non è admin. */
export function vistaDipendente(d: Dipendente, admin: boolean) {
  if (admin) return d;
  const { costoOrarioNettoCent: _n, costoOrarioLordoCent: _l, ...resto } = d;
  return resto;
}

export function rotteDipendenti(prisma: PrismaClient) {
  const router = Router();

  router.get('/', async (req, res) => {
    const soloId = dipendenteAmmesso(req);
    const elenco = await prisma.dipendente.findMany({
      where: soloId ? { id: soloId } : {},
      orderBy: [{ cognome: 'asc' }, { nome: 'asc' }],
    });
    res.json(elenco.map((d) => vistaDipendente(d, isAdmin(req))));
  });

  router.get('/:id', async (req, res) => {
    const id = dipendenteAmmesso(req, idDaParametro(req.params.id))!;
    const d = await prisma.dipendente.findUnique({ where: { id } });
    if (!d) throw nonTrovato('Dipendente');
    res.json(vistaDipendente(d, isAdmin(req)));
  });

  return router;
}
