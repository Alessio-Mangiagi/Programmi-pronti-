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
 * - DELETE /api/file/:id    toglie un file caricato e non ancora collegato (ripensamento).
 *
 * Chi può leggere un file: HR tutti; un dipendente solo quelli che ha caricato lui
 * (risposta 2c: il dipendente vede solo la sua documentazione). Attestati e documenti
 * del dipendente li carica HR, quindi restano riservati a HR.
 */
import express, { Router } from 'express';
import fs from 'node:fs';
import type { PrismaClient } from '../../generated/prisma/client';
import { ErroreHttp, nonTrovato, vietato } from '../errori';
import { idDaParametro, isAdmin } from '../middleware';
import { MAX_BYTE_FILE, percorsoFile, salvaFile, SI_APRE_NEL_BROWSER, vistaFile, eliminaFile } from '../servizi/archivio-file';

/** Content-Disposition con il nome originale (anche accentato): filename ASCII + filename* UTF-8. */
export function intestazioneNomeFile(tipo: 'inline' | 'attachment', nome: string): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

export function rotteFile(prisma: PrismaClient, cartella: string) {
  const router = Router();
  // Un po' di margine oltre i 20 MB: il limite preciso (con il messaggio giusto) lo dà controllaFile.
  const corpoFile = express.raw({ type: 'application/octet-stream', limit: MAX_BYTE_FILE + 1024 });

  router.post('/', corpoFile, async (req, res) => {
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

  router.get('/:id', async (req, res) => {
    const file = await prisma.fileCaricato.findUnique({ where: { id: idDaParametro(req.params.id)! }, include: { assenza: { select: { dipendenteId: true } } } });
    if (!file) throw nonTrovato('File');
    // Lo aprono HR, chi l'ha caricato e (Giorno 22) il dipendente della cui assenza è
    // l'allegato, anche se l'ha caricato HR.
    const suaAssenza = file.assenza != null && req.utente!.dipendenteId === file.assenza.dipendenteId;
    if (!isAdmin(req) && file.caricatoDaId !== req.utente!.id && !suaAssenza) throw vietato('Non puoi aprire questo file');
    const percorso = percorsoFile(cartella, file.nomeDisco);
    if (!fs.existsSync(percorso)) throw new ErroreHttp(404, 'Il file non è più nella cartella dei documenti: avvisa l\'amministratore');
    const nelBrowser = SI_APRE_NEL_BROWSER.has(file.tipoMime) && req.query.scarica !== '1';
    res.setHeader('Content-Type', file.tipoMime);
    res.setHeader('Content-Length', String(file.dimensione));
    res.setHeader('Content-Disposition', intestazioneNomeFile(nelBrowser ? 'inline' : 'attachment', file.nomeOriginale));
    // Il browser non deve "indovinare" il tipo (un file di testo trattato come pagina web).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Le immagini aperte da sole non eseguono nulla; il PDF resta senza sandbox perché il
    // visualizzatore PDF dei browser non funziona dentro una sandbox.
    if (file.tipoMime !== 'application/pdf') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(percorso).pipe(res);
  });

  router.delete('/:id', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const file = await prisma.fileCaricato.findUnique({
      where: { id },
      include: { attestato: true, documentoDipendente: true, documentoProgetto: true, assenza: true },
    });
    if (!file) throw nonTrovato('File');
    if (file.caricatoDaId !== req.utente!.id) throw vietato('Puoi togliere solo i file che hai caricato tu');
    if (file.attestato || file.documentoDipendente || file.documentoProgetto || file.assenza) {
      throw new ErroreHttp(409, 'Il file è già collegato a un documento: elimina il documento');
    }
    await eliminaFile(prisma, cartella, id);
    res.status(204).end();
  });

  return router;
}
