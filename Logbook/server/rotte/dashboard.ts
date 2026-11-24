// "><(((º> sabusabu <º)))><"
/**
 * GET /api/dashboard — riepilogo del mese corrente e cose che richiedono attenzione.
 *
 * Per ogni dipendente visibile (HR: tutti gli attivi; dipendente: sé stesso):
 * - ore lavorate dal primo del mese a oggi;
 * - ore attese a oggi = giorni lavorativi (da inizio mese o assunzione fino a oggi,
 *   esclusi i giorni di ferie/malattia approvate) × ore settimanali / 5, meno i permessi
 *   approvati;
 * - giorni senza ore: giorni lavorativi fino a IERI senza fasce né ferie/malattia (oggi
 *   non conta: la giornata può essere ancora in corso).
 * In più: richieste di assenza in attesa, assenze e festività dei prossimi 14 giorni, ore
 * del mese per progetto. "Oggi" arriva da creaApp (fissabile nei test).
 *
 * Solo HR (dal 24/11/2026, risposta 1c): attestati scaduti o in scadenza nei prossimi
 * 30 giorni (GIORNI_PREAVVISO_ATTESTATI), i più urgenti prima.
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { aggiungiGiorni, dataIso, giorniNelMese } from '../../comune/date';
import { GIORNI_PREAVVISO_ATTESTATI, statoAttestato } from '../../comune/documenti';
import { calcolaTotali, giorniLavorativi } from '../../comune/riepiloghi';
import { dipendenteAmmesso, isAdmin } from '../middleware';

export function rotteDashboard(prisma: PrismaClient, oggi: () => string) {
  const router = Router();

  router.get('/', async (req, res) => {
    const soloId = dipendenteAmmesso(req);
    const giorno = oggi();
    const [anno, mese] = giorno.split('-').map(Number);
    const inizioMese = dataIso(anno, mese, 1);
    const fineMese = dataIso(anno, mese, giorniNelMese(anno, mese));
    const ieri = aggiungiGiorni(giorno, -1);
    const fraDueSettimane = aggiungiGiorni(giorno, 14);

    const dipendenti = await prisma.dipendente.findMany({
      where: soloId ? { id: soloId } : { stato: 'ATTIVO' },
      orderBy: [{ cognome: 'asc' }, { nome: 'asc' }],
    });
    const ids = dipendenti.map((d) => d.id);
    const [fasce, assenzeMese, inAttesa, prossimeAssenze, festivita, progetti] = await Promise.all([
      prisma.registrazioneOraria.findMany({ where: { dipendenteId: { in: ids }, data: { gte: inizioMese, lte: giorno } } }),
      prisma.assenza.findMany({ where: { dipendenteId: { in: ids }, stato: 'APPROVATA', dataInizio: { lte: fineMese }, dataFine: { gte: inizioMese } } }),
      prisma.assenza.findMany({
        where: { dipendenteId: { in: ids }, stato: 'RICHIESTA' },
        include: { dipendente: { select: { nome: true, cognome: true } } },
        orderBy: { creatoIl: 'asc' },
      }),
      prisma.assenza.findMany({
        where: { dipendenteId: { in: ids }, stato: 'APPROVATA', dataInizio: { lte: fraDueSettimane }, dataFine: { gte: giorno } },
        include: { dipendente: { select: { nome: true, cognome: true } } },
        orderBy: { dataInizio: 'asc' },
      }),
      prisma.festivita.findMany({ where: { data: { gte: inizioMese, lte: aggiungiGiorni(fineMese, 60) } }, orderBy: { data: 'asc' } }),
      prisma.progetto.findMany({ select: { id: true, codice: true, nome: true, colore: true } }),
    ]);
    const festivi = new Set(festivita.map((f) => f.data));
    const totali = calcolaTotali(fasce);

    // Attestati da rinnovare (HR): scaduti o in scadenza entro il preavviso, dei dipendenti attivi.
    const attestati = isAdmin(req)
      ? await prisma.attestato.findMany({
          where: { dataScadenza: { not: null, lte: aggiungiGiorni(giorno, GIORNI_PREAVVISO_ATTESTATI) }, dipendente: { stato: 'ATTIVO' } },
          include: { dipendente: { select: { id: true, nome: true, cognome: true } } },
          orderBy: { dataScadenza: 'asc' },
        })
      : [];

    const perDipendente = dipendenti.map((d) => {
      const inizio = d.dataAssunzione > inizioMese ? d.dataAssunzione : inizioMese;
      const assenzeIntere = assenzeMese.filter((a) => a.dipendenteId === d.id && a.tipo !== 'PERMESSO');
      const inAssenza = (g: string) => assenzeIntere.some((a) => a.dataInizio <= g && g <= a.dataFine);
      const lavorativiAOggi = inizio <= giorno ? giorniLavorativi(inizio, giorno, festivi).filter((g) => !inAssenza(g)) : [];
      const permessi = assenzeMese
        .filter((a) => a.dipendenteId === d.id && a.tipo === 'PERMESSO' && a.dataInizio <= giorno)
        .reduce((s, a) => s + (a.minutiPermesso ?? 0), 0);
      const giorniConOre = new Set(fasce.filter((f) => f.dipendenteId === d.id).map((f) => f.data));
      return {
        id: d.id,
        nome: `${d.cognome} ${d.nome}`,
        oreSettimanali: d.oreSettimanali,
        minutiLavorati: totali.perDipendente[d.id] ?? 0,
        minutiAttesi: Math.max(0, Math.round((lavorativiAOggi.length * d.oreSettimanali * 60) / 5) - permessi),
        giorniSenzaOre: lavorativiAOggi.filter((g) => g <= ieri && !giorniConOre.has(g)),
      };
    });

    res.json({
      oggi: giorno,
      mese: { da: inizioMese, a: fineMese },
      totaleMinuti: totali.totale,
      totaleAttesi: perDipendente.reduce((s, d) => s + d.minutiAttesi, 0),
      perDipendente,
      perProgetto: progetti
        .filter((p) => totali.perProgetto[p.id])
        .map((p) => ({ ...p, minuti: totali.perProgetto[p.id] }))
        .sort((a, b) => b.minuti - a.minuti),
      richiesteInAttesa: inAttesa.map((a) => ({
        id: a.id, tipo: a.tipo, dataInizio: a.dataInizio, dataFine: a.dataFine, minutiPermesso: a.minutiPermesso,
        dipendente: `${a.dipendente.cognome} ${a.dipendente.nome}`, creatoIl: a.creatoIl,
      })),
      prossimeAssenze: prossimeAssenze.map((a) => ({
        id: a.id, tipo: a.tipo, dataInizio: a.dataInizio, dataFine: a.dataFine, minutiPermesso: a.minutiPermesso,
        dipendente: `${a.dipendente.cognome} ${a.dipendente.nome}`,
      })),
      prossimeFestivita: festivita.filter((f) => f.data >= giorno).slice(0, 3),
      attestatiDaRinnovare: attestati.map((a) => ({
        id: a.id, tipo: a.tipo, titolo: a.titolo, dataScadenza: a.dataScadenza, stato: statoAttestato(a.dataScadenza, giorno),
        dipendenteId: a.dipendenteId, dipendente: `${a.dipendente.cognome} ${a.dipendente.nome}`,
      })),
    });
  });

  return router;
}
