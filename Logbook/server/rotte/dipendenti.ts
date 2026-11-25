// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/dipendenti: anagrafica dei dipendenti e loro account di accesso.
 *
 * Lettura: l'admin vede tutti (con costi orari e account), il dipendente solo la
 * propria scheda e senza costi (dati riservati a HR).
 * Scrittura: solo admin. Non esiste la cancellazione: un dipendente che lascia
 * l'azienda si "disattiva" (stato CESSATO + data), così le sue ore restano nei report.
 *
 * Validazione: comune/schemi.ts (schemaDipendente, schemaAccount), la stessa usata dai
 * moduli dell'interfaccia. Matricola e codice fiscale unici → 409 con l'errore sul campo.
 *
 * Giorno 26 (24/11/2026, risposte 1a 2a 3a 4a):
 * - la matricola è SIGLA-NUMERO del contratto (comune/matricola.ts) e il NUMERO è unico fra
 *   tutti, qualunque sia la sigla (IND-0004 e DET-0004 non possono convivere);
 * - GET /prossima-matricola?tipoContratto=… propone il prossimo numero libero (HR può
 *   correggerlo);
 * - GET /mansioni è l'elenco delle mansioni proposte; una mansione nuova scritta in una
 *   scheda viene aggiunta all'elenco al salvataggio, e una già presente con altre maiuscole
 *   prende la grafia dell'elenco (niente doppioni "Operaio" / "operaio").
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Dipendente, PrismaClient } from '../../generated/prisma/client';
import { isDataAmmessa, isDataValida, MESSAGGIO_DATA_MINIMA, oggiIso } from '../../comune/date';
import { componiMatricola, numeroMatricola, prossimoNumero } from '../../comune/matricola';
import { schemaAccount, schemaDipendente, TIPI_CONTRATTO, type DatiDipendente } from '../../comune/schemi';
import { controllaPasswordNuova, creaImpronta } from '../auth/password';
import { ErroreHttp, nonTrovato, richiestaNonValida } from '../errori';
import { dipendenteAmmesso, idDaParametro, isAdmin, richiediAdmin } from '../middleware';

type DipendenteConAccount = Dipendente & {
  utente?: { id: number; username: string; attivo: boolean; ruolo: 'ADMIN' | 'DIPENDENTE' } | null;
};

/** Toglie i campi riservati a HR quando chi legge non è admin. */
function vistaDipendente(d: DipendenteConAccount, admin: boolean) {
  if (admin) return d;
  const { costoOrarioNettoCent: _n, costoOrarioLordoCent: _l, utente: _u, ...resto } = d;
  return resto;
}

// passwordDaCambiare: HR vede se il dipendente ha ancora la password provvisoria (Giorno 24).
const selezioneAccount = { select: { id: true, username: true, attivo: true, ruolo: true, passwordDaCambiare: true } } as const;

export function rotteDipendenti(prisma: PrismaClient, proprietario?: string) {
  const router = Router();

  /**
   * L'account del proprietario di Logbook (LOGBOOK_PROPRIETARIO, vedi rotte/proprietario.ts)
   * lo tocca solo lui (verifica di sicurezza del Giorno 33). Se fosse collegato a una scheda
   * dipendente, un altro amministratore potrebbe reimpostargli la password o disattivarlo
   * da qui, e nessun altro nome utente può diventare quello del proprietario.
   */
  function proteggiProprietario(req: Request, username: string | undefined | null, nuovoUsername?: string) {
    if (!proprietario || req.utente?.username === proprietario) return;
    if (username === proprietario || nuovoUsername === proprietario) {
      throw new ErroreHttp(403, "L'account del proprietario di Logbook lo può modificare solo il proprietario");
    }
  }

  /**
   * 409 se il numero di matricola o il codice fiscale sono già di un altro dipendente. Il
   * numero conta da solo (Giorno 26): DET-0004 è "già usata" se esiste IND-0004.
   */
  async function controllaUnicita(dati: DatiDipendente, escludiId?: number) {
    const altri = await prisma.dipendente.findMany({
      where: escludiId ? { NOT: { id: escludiId } } : {},
      select: { matricola: true, codiceFiscale: true, nome: true, cognome: true },
    });
    const numero = numeroMatricola(dati.matricola);
    const campi: Record<string, string> = {};
    for (const a of altri) {
      if (a.matricola === dati.matricola || (numero !== null && numeroMatricola(a.matricola) === numero)) {
        campi.matricola = `Numero di matricola già usato da ${a.cognome} ${a.nome} (${a.matricola})`;
      }
      if (a.codiceFiscale === dati.codiceFiscale) campi.codiceFiscale = `Codice fiscale già registrato per ${a.cognome} ${a.nome}`;
    }
    if (Object.keys(campi).length) throw new ErroreHttp(409, 'Dati già presenti in un\'altra scheda', campi);
  }

  /**
   * Mansione della scheda → grafia dell'elenco: se c'è già (anche con altre maiuscole) si usa
   * quella, altrimenti la si aggiunge all'elenco (risposta 4a). Restituisce i dati da salvare.
   */
  async function conMansioneDellElenco(dati: DatiDipendente): Promise<DatiDipendente> {
    if (!dati.mansione) return dati;
    const elenco = await prisma.mansione.findMany();
    const uguale = elenco.find((m) => m.nome.toLocaleLowerCase('it') === dati.mansione!.toLocaleLowerCase('it'));
    if (uguale) return { ...dati, mansione: uguale.nome };
    await prisma.mansione.create({ data: { nome: dati.mansione } });
    return dati;
  }

  /** Prossima matricola libera per il contratto scelto (risposta 2a): la propone il modulo. */
  router.get('/prossima-matricola', richiediAdmin, async (req, res) => {
    const { tipoContratto } = z.object({ tipoContratto: z.enum(TIPI_CONTRATTO) }).parse(req.query);
    const matricole = (await prisma.dipendente.findMany({ select: { matricola: true } })).map((d) => d.matricola);
    res.json({ matricola: componiMatricola(tipoContratto, prossimoNumero(matricole)) });
  });

  /** Elenco delle mansioni proposte nella scheda (risposta 4a), in ordine alfabetico. */
  router.get('/mansioni', richiediAdmin, async (_req, res) => {
    const elenco = await prisma.mansione.findMany({ select: { nome: true } });
    res.json(elenco.map((m) => m.nome).sort((a, b) => a.localeCompare(b, 'it')));
  });

  router.get('/', async (req, res) => {
    const soloId = dipendenteAmmesso(req);
    const elenco = await prisma.dipendente.findMany({
      where: soloId ? { id: soloId } : {},
      include: { utente: selezioneAccount },
      orderBy: [{ cognome: 'asc' }, { nome: 'asc' }],
    });
    res.json(elenco.map((d) => vistaDipendente(d, isAdmin(req))));
  });

  router.get('/:id', async (req, res) => {
    const id = dipendenteAmmesso(req, idDaParametro(req.params.id))!;
    const d = await prisma.dipendente.findUnique({ where: { id }, include: { utente: selezioneAccount } });
    if (!d) throw nonTrovato('Dipendente');
    res.json(vistaDipendente(d, isAdmin(req)));
  });

  router.post('/', richiediAdmin, async (req, res) => {
    const dati = schemaDipendente.parse(req.body);
    await controllaUnicita(dati);
    const creato = await prisma.dipendente.create({ data: await conMansioneDellElenco(dati) });
    res.status(201).json(creato);
  });

  router.put('/:id', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const esistente = await prisma.dipendente.findUnique({ where: { id } });
    if (!esistente) throw nonTrovato('Dipendente');
    const letti = schemaDipendente.parse(req.body);
    await controllaUnicita(letti, id);
    // Mansione aggiunta all'elenco solo dopo i controlli: una scheda rifiutata non lascia tracce.
    const dati = await conMansioneDellElenco(letti);
    const aggiornato = await prisma.$transaction(async (tx) => {
      const d = await tx.dipendente.update({ where: { id }, data: dati });
      // Un dipendente cessato non deve più poter entrare: si disattiva l'account e si
      // chiudono le sessioni aperte. Riattivarlo non riapre l'account da solo (scelta HR).
      if (dati.stato === 'CESSATO') await disattivaAccount(tx, id);
      return d;
    });
    res.json(aggiornato);
  });

  /** Disattivazione rapida dalla tabella: stato CESSATO alla data indicata (default oggi). */
  router.post('/:id/disattiva', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const { dataCessazione = oggiIso() } = z.object({ dataCessazione: z.string().optional() }).parse(req.body ?? {});
    if (!isDataValida(dataCessazione)) throw richiestaNonValida('Data di cessazione non valida', { dataCessazione: 'Data non valida' });
    if (!isDataAmmessa(dataCessazione)) throw richiestaNonValida(MESSAGGIO_DATA_MINIMA, { dataCessazione: MESSAGGIO_DATA_MINIMA });
    const d = await prisma.dipendente.findUnique({ where: { id } });
    if (!d) throw nonTrovato('Dipendente');
    proteggiProprietario(req, (await prisma.utente.findUnique({ where: { dipendenteId: id } }))?.username);
    if (dataCessazione < d.dataAssunzione) {
      throw richiestaNonValida("La cessazione non può precedere l'assunzione", { dataCessazione: "Prima dell'assunzione" });
    }
    const aggiornato = await prisma.$transaction(async (tx) => {
      const r = await tx.dipendente.update({ where: { id }, data: { stato: 'CESSATO', dataCessazione } });
      await disattivaAccount(tx, id);
      return r;
    });
    res.json(aggiornato);
  });

  /** Riattivazione: torna ATTIVO e la data di cessazione si svuota. */
  router.post('/:id/riattiva', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    if (!(await prisma.dipendente.findUnique({ where: { id } }))) throw nonTrovato('Dipendente');
    res.json(await prisma.dipendente.update({ where: { id }, data: { stato: 'ATTIVO', dataCessazione: null } }));
  });

  /**
   * Crea o modifica l'account di accesso del dipendente (ruolo DIPENDENTE).
   * Alla creazione la password è obbligatoria; in modifica, se presente, la reimposta
   * e chiude le sessioni aperte. Disattivare l'account chiude le sessioni.
   */
  router.put('/:id/account', richiediAdmin, async (req: Request, res) => {
    const id = idDaParametro(req.params.id)!;
    const dati = schemaAccount.parse(req.body);
    const dipendente = await prisma.dipendente.findUnique({ where: { id }, include: { utente: true } });
    if (!dipendente) throw nonTrovato('Dipendente');
    proteggiProprietario(req, dipendente.utente?.username, dati.username);
    const omonimo = await prisma.utente.findUnique({ where: { username: dati.username } });
    if (omonimo && omonimo.id !== dipendente.utente?.id) {
      throw new ErroreHttp(409, 'Nome utente già in uso', { username: 'Nome utente già in uso' });
    }
    const password = dati.password?.trim() ? dati.password : undefined;
    if (password) {
      const debolezza = controllaPasswordNuova(password);
      if (debolezza) throw richiestaNonValida(debolezza, { password: debolezza });
    } else if (!dipendente.utente) {
      throw richiestaNonValida('Indica una password per il nuovo account', { password: 'Obbligatoria per un nuovo account' });
    }
    if (dati.attivo && dipendente.stato === 'CESSATO') {
      throw richiestaNonValida('Un dipendente cessato non può avere un account attivo', { attivo: 'Riattiva prima il dipendente' });
    }

    const impronta = password ? await creaImpronta(password) : undefined;
    // La password che HR comunica al dipendente è provvisoria: al primo accesso Logbook
    // chiede di cambiarla (Giorno 24, risposta 1a), così la conosce solo il dipendente.
    const account = dipendente.utente
      ? await prisma.utente.update({
          where: { id: dipendente.utente.id },
          data: { username: dati.username, attivo: dati.attivo, ...(impronta ? { passwordHash: impronta, passwordDaCambiare: true } : {}) },
          select: selezioneAccount.select,
        })
      : await prisma.utente.create({
          data: { username: dati.username, passwordHash: impronta!, passwordDaCambiare: true, ruolo: 'DIPENDENTE', attivo: dati.attivo, dipendenteId: id },
          select: selezioneAccount.select,
        });
    if (impronta || !dati.attivo) await prisma.sessione.deleteMany({ where: { utenteId: account.id } });
    res.json(account);
  });

  return router;
}

/** Disattiva l'account collegato al dipendente (se c'è) e ne chiude le sessioni. */
async function disattivaAccount(tx: Pick<PrismaClient, 'utente' | 'sessione'>, dipendenteId: number) {
  const account = await tx.utente.findUnique({ where: { dipendenteId } });
  if (!account) return;
  await tx.utente.update({ where: { id: account.id }, data: { attivo: false } });
  await tx.sessione.deleteMany({ where: { utenteId: account.id } });
}
