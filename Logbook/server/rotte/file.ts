// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/file: caricamento e lettura dei file (attestati, documenti, documentazione
 * dei progetti). Il file si carica PRIMA e da solo; poi la scheda che lo usa (attestato,
 * documento, documentazione) lo collega col suo id. Così il modulo resta un normale JSON
 * e il controllo del file (server/servizi/archivio-file.ts) è uno solo per tutti.
 *
 * - POST   /api/file        corpo = byte del file (application/octet-stream), nome
 *                           nell'intestazione X-Nome-File (encodeURIComponent); qualunque
 *                           utente collegato. Risposta: { id, nome, tipo, dimensione }.
 * - GET    /api/file/:id    il file; ?scarica=1 lo scarica invece di aprirlo nel browser.
 *
 * Non c'è la cancellazione diretta (tolta il 24/11/2026, risposta 2: l'interfaccia non la
 * usava): un file caricato e poi non salvato in una scheda lo toglie la pulizia dopo un
 * giorno; quello di una scheda si cancella con la scheda.
 *
 * Chi può leggere un file: HR tutti; un dipendente solo quelli che ha caricato lui
 * (risposta 2c: il dipendente vede solo la sua documentazione). Attestati e documenti
 * del dipendente li carica HR, quindi restano riservati a HR.
 */
import { randomBytes } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { ErroreHttp, nonTrovato, vietato } from '../errori';
import { idDaParametro, isAdmin } from '../middleware';
import { BYTE_PER_PARTE, leggiContenuto, MAX_BYTE_FILE, maxByteFile, PREFISSO_PARTE, salvaFile, SI_APRE_NEL_BROWSER, vistaFile } from '../servizi/archivio-file';
import { statoTemporaneo } from '../servizi/stato-temporaneo';

/** Content-Disposition con il nome originale (anche accentato): filename ASCII + filename* UTF-8. */
function intestazioneNomeFile(tipo: 'inline' | 'attachment', nome: string): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

/**
 * Quanti file caricati e non ancora collegati può avere ogni utente (verifica di sicurezza
 * del Giorno 23). Nell'uso normale se ne ha uno per modulo aperto; senza tetto uno script
 * poteva caricare migliaia di file da 20 MB e riempire il disco del database. Quelli mai
 * collegati li toglie la pulizia dopo un giorno (server/index.ts).
 */
const MAX_FILE_IN_SOSPESO = 20;

export function rotteFile(prisma: PrismaClient, cartella: string) {
  const router = Router();
  // Un po' di margine oltre i 20 MB: il limite preciso (con il messaggio giusto) lo dà controllaFile.
  const corpoFile = express.raw({ type: 'application/octet-stream', limit: MAX_BYTE_FILE + 1024 });

  /** Prima di leggere il corpo (fino a 20 MB in memoria): troppi file in sospeso → 429 subito. */
  const controllaSospesi: express.RequestHandler = async (req, _res, next) => {
    const inSospeso = await prisma.fileCaricato.count({
      where: { caricatoDaId: req.utente!.id, attestato: null, documentoDipendente: null, documentoProgetto: null, assenza: null, notaSpesa: null },
    });
    if (inSospeso >= MAX_FILE_IN_SOSPESO) {
      throw new ErroreHttp(429, `Hai già ${inSospeso} file caricati e non ancora salvati in una scheda: salva o chiudi i moduli aperti, oppure riprova domani`);
    }
    next();
  };

  router.post('/', controllaSospesi, corpoFile, async (req, res) => {
    const dati = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let nome = 'documento';
    try {
      nome = decodeURIComponent(req.get('X-Nome-File') ?? '') || nome;
    } catch {
      throw new ErroreHttp(400, 'Nome del file non leggibile');
    }
    const file = await salvaFile(prisma, cartella, dati, nome, req.utente!.id);
    res.status(201).json(vistaFile(file));
  });

  // --- Caricamento a parti (Giorno 46) ----------------------------------------------------
  // Vercel rifiuta le richieste oltre 4,5 MB. Un file più grande il browser lo manda a parti
  // da BYTE_PER_PARTE: "inizio" apre il caricamento, ogni parte finisce nella tabella
  // ContenutoFile con il nome "parte:<caricamento>:<numero>", "fine" le ricompone e fa
  // passare il file intero da salvaFile, cioè dagli stessi controlli di un caricamento
  // normale (dimensione, formato, contenuto). Chi ha aperto il caricamento è scritto nello
  // stato temporaneo: le parti e la fine le accetta solo da lui, per un'ora.
  const stato = statoTemporaneo(prisma);
  const corpoParte = express.raw({ type: 'application/octet-stream', limit: BYTE_PER_PARTE + 1024 });
  const UN_ORA = 60 * 60 * 1000;
  type Caricamento = { utenteId: number; nome: string; dimensione: number; parti: number };
  const idCaricamento = (v: unknown) => z.string().regex(/^[a-f0-9]{32}$/, 'Caricamento non valido').parse(v);

  /** Il caricamento, se esiste ed è di chi chiama. */
  async function mioCaricamento(req: express.Request): Promise<{ id: string; c: Caricamento }> {
    const id = idCaricamento(req.params.caricamento);
    const c = await stato.leggi<Caricamento>(`caricamento:${id}`);
    if (!c || c.utenteId !== req.utente!.id) throw new ErroreHttp(404, 'Caricamento scaduto o inesistente: riprova dall\'inizio');
    return { id, c };
  }

  /** Quanto può essere grande un file qui e da che dimensione va mandato a parti. */
  router.get('/limiti', (_req, res) => {
    res.json({ massimo: maxByteFile(cartella), bytePerParte: BYTE_PER_PARTE });
  });

  router.post('/parti', controllaSospesi, async (req, res) => {
    const { nome, dimensione } = z
      .object({ nome: z.string().trim().min(1, 'Nome del file mancante').max(300), dimensione: z.coerce.number().int().positive('File vuoto') })
      .parse(req.body);
    const massimo = maxByteFile(cartella);
    if (dimensione > massimo) throw new ErroreHttp(413, `File troppo grande: massimo ${massimo / 1024 / 1024} MB`);
    const id = randomBytes(16).toString('hex');
    const parti = Math.ceil(dimensione / BYTE_PER_PARTE);
    await stato.scrivi(`caricamento:${id}`, { utenteId: req.utente!.id, nome, dimensione, parti } satisfies Caricamento, Date.now() + UN_ORA);
    res.status(201).json({ caricamento: id, parti, bytePerParte: BYTE_PER_PARTE });
  });

  router.put('/parti/:caricamento/:numero', corpoParte, async (req, res) => {
    const { id, c } = await mioCaricamento(req);
    const numero = Number(req.params.numero);
    if (!Number.isInteger(numero) || numero < 0 || numero >= c.parti) throw new ErroreHttp(400, 'Numero della parte non valido');
    const dati = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!dati.length || dati.length > BYTE_PER_PARTE) throw new ErroreHttp(400, 'Parte vuota o troppo grande');
    const nomeDisco = `${PREFISSO_PARTE}${id}:${numero}`;
    // Una parte rimandata (rete caduta a metà) sostituisce quella di prima.
    await prisma.contenutoFile.upsert({ where: { nomeDisco }, create: { nomeDisco, dati: new Uint8Array(dati) }, update: { dati: new Uint8Array(dati) } });
    res.json({ ok: true });
  });

  router.post('/parti/:caricamento/fine', async (req, res) => {
    const { id, c } = await mioCaricamento(req);
    const prefisso = `${PREFISSO_PARTE}${id}:`;
    const righe = await prisma.contenutoFile.findMany({ where: { nomeDisco: { startsWith: prefisso } } });
    const pulisci = async () => {
      await prisma.contenutoFile.deleteMany({ where: { nomeDisco: { startsWith: prefisso } } });
      await stato.togli(`caricamento:${id}`);
    };
    try {
      const perNumero = new Map(righe.map((r) => [Number(r.nomeDisco.slice(prefisso.length)), Buffer.from(r.dati)]));
      const pezzi: Buffer[] = [];
      for (let n = 0; n < c.parti; n++) {
        const pezzo = perNumero.get(n);
        if (!pezzo) throw new ErroreHttp(400, `Caricamento incompleto: manca la parte ${n + 1} di ${c.parti}. Riprova`);
        pezzi.push(pezzo);
      }
      const dati = Buffer.concat(pezzi);
      if (dati.length !== c.dimensione) throw new ErroreHttp(400, 'Il file arrivato non ha la dimensione dichiarata: riprova');
      const file = await salvaFile(prisma, cartella, dati, c.nome, req.utente!.id);
      res.status(201).json(vistaFile(file));
    } finally {
      // Riuscito o no, le parti non servono più: un nuovo tentativo riparte da capo.
      await pulisci();
    }
  });

  router.get('/:id', async (req, res) => {
    const file = await prisma.fileCaricato.findUnique({ where: { id: idDaParametro(req.params.id)! }, include: { assenza: { select: { dipendenteId: true } }, notaSpesa: { select: { dipendenteId: true } } } });
    if (!file) throw nonTrovato('File');
    // Lo aprono HR, chi l'ha caricato e (Giorno 22) il dipendente della cui assenza è
    // l'allegato, anche se l'ha caricato HR.
    // Giorno 45: lo stesso vale per lo scontrino di una sua nota spese.
    const suaAssenza =
      (file.assenza != null && req.utente!.dipendenteId === file.assenza.dipendenteId) ||
      (file.notaSpesa != null && req.utente!.dipendenteId === file.notaSpesa.dipendenteId);
    if (!isAdmin(req) && file.caricatoDaId !== req.utente!.id && !suaAssenza) throw vietato('Non puoi aprire questo file');
    // Giorno 35: il contenuto arriva dall'archivio (cartella dei documenti o, su Vercel, database).
    const dati = await leggiContenuto(prisma, cartella, file.nomeDisco);
    if (!dati) throw new ErroreHttp(404, 'Il file non è più nell\'archivio dei documenti: avvisa l\'amministratore');
    const nelBrowser = SI_APRE_NEL_BROWSER.has(file.tipoMime) && req.query.scarica !== '1';
    res.setHeader('Content-Type', file.tipoMime);
    res.setHeader('Content-Length', String(dati.length));
    // Giorno 46: i file fino a 20 MB escono a pezzi (vedi in fondo alla rotta).
    res.setHeader('Content-Disposition', intestazioneNomeFile(nelBrowser ? 'inline' : 'attachment', file.nomeOriginale));
    // Il browser non deve "indovinare" il tipo (un file di testo trattato come pagina web).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Le immagini aperte da sole non eseguono nulla; il PDF resta senza sandbox perché il
    // visualizzatore PDF dei browser non funziona dentro una sandbox.
    if (file.tipoMime !== 'application/pdf') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'private, no-store');
    // Giorno 46: il contenuto esce a pezzi da 1 MB invece che in un colpo solo. Su Vercel una
    // risposta intera oltre 4,5 MB viene rifiutata, una risposta a pezzi (streaming) no.
    const PEZZO = 1024 * 1024;
    for (let da = 0; da < dati.length; da += PEZZO) {
      const pieno = !res.write(dati.subarray(da, da + PEZZO));
      // Se chi scarica è lento si aspetta che abbia letto, senza accumulare tutto in memoria.
      if (pieno) await new Promise((ok) => res.once('drain', ok));
    }
    res.end();
  });

  return router;
}
