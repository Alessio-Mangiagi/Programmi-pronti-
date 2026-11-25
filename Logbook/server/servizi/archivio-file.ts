// "><(((º> sabusabu <º)))><"
/**
 * Archivio dei file caricati in Logbook (risposta 4a del 24/11/2026: i file stanno sul
 * server di Logbook). Lo usano attestati, documenti del dipendente e documentazione dei
 * progetti: prima si carica il file (POST /api/file, server/rotte/file.ts), poi lo si
 * collega alla scheda con il suo id.
 *
 * Regole:
 * - cartella: LOGBOOK_DOCUMENTI_DIR oppure data/documenti dentro l'app (accanto al
 *   database, quindi nello stesso backup); nei test una cartella temporanea;
 * - massimo 20 MB a file;
 * - solo i formati di ufficio (PDF, immagini, Word, Excel, OpenDocument, testo, .p7m),
 *   riconosciuti dall'estensione E dai primi byte del contenuto: un .pdf che non comincia
 *   con %PDF viene rifiutato, così un eseguibile rinominato non entra;
 * - sul disco il nome è un UUID con l'estensione ammessa: il nome scelto dall'utente
 *   resta solo nel database (FileCaricato.nomeOriginale) e non diventa mai un percorso.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '../../generated/prisma/client';
import { RADICE_APP } from '../database-url';
import { ErroreHttp } from '../errori';

export const MAX_BYTE_FILE = 20 * 1024 * 1024;

/** Cartella dei documenti: variabile d'ambiente o data/documenti dell'app. */
export function cartellaDocumentiPredefinita(): string {
  const env = process.env.LOGBOOK_DOCUMENTI_DIR?.trim();
  return env ? path.resolve(env) : path.join(RADICE_APP, 'data', 'documenti');
}

type Firma = (b: Buffer) => boolean;
const inizia = (...byte: number[]): Firma => (b) => byte.every((v, i) => b[i] === v);
const PDF = inizia(0x25, 0x50, 0x44, 0x46); // %PDF
const ZIP = inizia(0x50, 0x4b, 0x03, 0x04); // PK.. (docx, xlsx, odt, ods sono archivi zip)
const OLE = inizia(0xd0, 0xcf, 0x11, 0xe0); // vecchi doc/xls
const DER = (b: Buffer) => b[0] === 0x30; // busta CAdES .p7m (struttura ASN.1 DER)
/** Testo: nessun byte nullo nei primi 4 KB. */
const TESTO = (b: Buffer) => !b.subarray(0, 4096).includes(0);

/** Formati ammessi: estensione → tipo MIME servito e controllo dei primi byte. */
const FORMATI: Record<string, { mime: string; firma: Firma }> = {
  pdf: { mime: 'application/pdf', firma: PDF },
  p7m: { mime: 'application/pkcs7-mime', firma: DER },
  jpg: { mime: 'image/jpeg', firma: inizia(0xff, 0xd8, 0xff) },
  jpeg: { mime: 'image/jpeg', firma: inizia(0xff, 0xd8, 0xff) },
  png: { mime: 'image/png', firma: inizia(0x89, 0x50, 0x4e, 0x47) },
  webp: { mime: 'image/webp', firma: (b) => inizia(0x52, 0x49, 0x46, 0x46)(b) && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', firma: ZIP },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', firma: ZIP },
  odt: { mime: 'application/vnd.oasis.opendocument.text', firma: ZIP },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', firma: ZIP },
  doc: { mime: 'application/msword', firma: OLE },
  xls: { mime: 'application/vnd.ms-excel', firma: OLE },
  txt: { mime: 'text/plain; charset=utf-8', firma: TESTO },
};

/** Elenco per i messaggi e per l'attributo accept dei campi file. */
export const ESTENSIONI_AMMESSE = Object.keys(FORMATI);

/** Si possono aprire nel browser (anteprima) invece di scaricarli. */
export const SI_APRE_NEL_BROWSER = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/** Estensione in minuscolo senza punto ("Foto.JPG" → "jpg"); '' se manca. */
function estensione(nome: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(nome.trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * Nome scelto dall'utente, ripulito: niente percorsi, caratteri di controllo o lunghezze
 * assurde. Serve solo per mostrarlo e come nome del file scaricato.
 */
function pulisciNome(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? '';
  const pulito = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  return (pulito || 'documento').slice(-150);
}

/** Controlla dimensione, formato e contenuto; restituisce il formato riconosciuto. */
function controllaFile(dati: Buffer, nome: string): { ext: string; mime: string } {
  if (!dati.length) throw new ErroreHttp(400, 'Il file è vuoto');
  if (dati.length > MAX_BYTE_FILE) throw new ErroreHttp(413, `File troppo grande: massimo ${MAX_BYTE_FILE / 1024 / 1024} MB`);
  const ext = estensione(nome);
  const formato = FORMATI[ext];
  if (!formato) {
    throw new ErroreHttp(415, `Formato non ammesso${ext ? ` (.${ext})` : ''}: si possono caricare ${ESTENSIONI_AMMESSE.map((e) => `.${e}`).join(', ')}`);
  }
  if (!formato.firma(dati)) {
    throw new ErroreHttp(415, `Il contenuto non corrisponde a un file .${ext}: il file è danneggiato o ha l'estensione sbagliata`);
  }
  return { ext, mime: formato.mime };
}

/**
 * Salva il file sul disco e ne registra i metadati. Restituisce la riga FileCaricato.
 * Prima si scrive su disco, poi nel database: se il database fallisce si cancella il file,
 * così non restano file orfani.
 */
export async function salvaFile(prisma: PrismaClient, cartella: string, dati: Buffer, nomeOriginale: string, utenteId: number) {
  const nome = pulisciNome(nomeOriginale);
  const { ext, mime } = controllaFile(dati, nome);
  fs.mkdirSync(cartella, { recursive: true });
  const nomeDisco = `${crypto.randomUUID()}.${ext}`;
  const percorso = path.join(cartella, nomeDisco);
  fs.writeFileSync(percorso, dati, { flag: 'wx' });
  try {
    return await prisma.fileCaricato.create({
      data: {
        nomeDisco,
        nomeOriginale: nome,
        tipoMime: mime,
        dimensione: dati.length,
        sha256: crypto.createHash('sha256').update(dati).digest('hex'),
        caricatoDaId: utenteId,
      },
    });
  } catch (e) {
    fs.rmSync(percorso, { force: true });
    throw e;
  }
}

/** Percorso del file sul disco (il nome viene dal database, mai dalla richiesta). */
export function percorsoFile(cartella: string, nomeDisco: string): string {
  return path.join(cartella, path.basename(nomeDisco));
}

/** Cancella file e metadati (quando si elimina l'attestato o il documento che lo usava). */
export async function eliminaFile(prisma: PrismaClient, cartella: string, fileId: number | null | undefined) {
  if (!fileId) return;
  const file = await prisma.fileCaricato.findUnique({ where: { id: fileId } });
  if (!file) return;
  await prisma.fileCaricato.delete({ where: { id: fileId } });
  fs.rmSync(percorsoFile(cartella, file.nomeDisco), { force: true });
}

/**
 * Verifica che un file appena caricato si possa collegare a una scheda: deve esistere,
 * essere stato caricato dallo stesso utente e non essere già usato altrove.
 * Così nessuno può "prendere" un file caricato da un altro conoscendone l'id.
 */
export async function fileCollegabile(prisma: PrismaClient, fileId: number, utenteId: number) {
  const file = await prisma.fileCaricato.findUnique({
    where: { id: fileId },
    include: { attestato: true, documentoDipendente: true, documentoProgetto: true, assenza: true },
  });
  if (!file || file.caricatoDaId !== utenteId) throw new ErroreHttp(400, 'File non trovato: caricalo di nuovo', { fileId: 'File non trovato' });
  if (file.attestato || file.documentoDipendente || file.documentoProgetto || file.assenza) {
    throw new ErroreHttp(409, 'Questo file è già collegato a un altro documento', { fileId: 'File già usato' });
  }
  return file;
}

/**
 * Pulizia dei file caricati ma mai collegati (es. finestra chiusa dopo il caricamento)
 * più vecchi di un giorno. La chiama l'avvio del server (server/index.ts).
 */
export async function pulisciFileOrfani(prisma: PrismaClient, cartella: string, oraRiferimento = new Date()) {
  const limite = new Date(oraRiferimento.getTime() - 24 * 60 * 60 * 1000);
  const orfani = await prisma.fileCaricato.findMany({
    where: { creatoIl: { lt: limite }, attestato: null, documentoDipendente: null, documentoProgetto: null, assenza: null },
  });
  for (const f of orfani) await eliminaFile(prisma, cartella, f.id);
  return orfani.length;
}

/** Vista per l'interfaccia: niente nome su disco né impronta. */
export function vistaFile(f: { id: number; nomeOriginale: string; tipoMime: string; dimensione: number; creatoIl: Date } | null | undefined) {
  if (!f) return null;
  return { id: f.id, nome: f.nomeOriginale, tipo: f.tipoMime, dimensione: f.dimensione, caricatoIl: f.creatoIl };
}
