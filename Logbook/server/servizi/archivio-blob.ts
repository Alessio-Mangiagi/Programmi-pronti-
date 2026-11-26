// "><(((º> sabusabu <º)))><"
/**
 * Archivio dei file su Vercel Blob (Giorno 46, 26/11/2026, risposta 6b dell'utente).
 *
 * Su Vercel non c'è un disco che dura, e dal Giorno 35 i file stavano nel database, con un
 * tetto di 4 MB. Con uno store Blob PRIVATO collegato al progetto i file vanno lì e possono
 * arrivare a 20 MB, come sul PC. "Privato" vuol dire che il file non ha un indirizzo
 * pubblico: si legge solo dal server, con il token dello store. Per documenti come i
 * certificati di malattia è l'unica modalità accettabile.
 *
 * Quando si usa: solo se c'è la variabile BLOB_READ_WRITE_TOKEN (la aggiunge Vercel quando
 * si collega lo store al progetto: `vercel blob create-store … --access private`). Senza,
 * Copilota resta sul database (Vercel) o sul disco (PC e suite), come prima.
 *
 * Questo file è l'unico che parla con @vercel/blob. Il resto del programma passa da
 * `archivioBlob()`, che i test sostituiscono con una versione in memoria (`usaArchivioBlob`).
 */
import { del, get, put } from '@vercel/blob';

export type ArchivioBlob = {
  metti(nome: string, dati: Buffer, tipoMime: string): Promise<void>;
  /** Il contenuto, o null se il file non c'è. */
  leggi(nome: string): Promise<Buffer | null>;
  togli(nome: string): Promise<void>;
};

/** true se a questo Copilota è collegato uno store Blob. */
export const blobConfigurato = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.BLOB_READ_WRITE_TOKEN?.trim());

/** Cartella dentro lo store: tiene i file di Copilota separati da altri usi futuri dello store. */
const percorso = (nome: string) => `documenti/${nome}`;

const veroArchivio: ArchivioBlob = {
  async metti(nome, dati, tipoMime) {
    // Il nome è già un UUID scelto dal server: niente suffisso casuale, niente sovrascritture.
    await put(percorso(nome), dati, { access: 'private', contentType: tipoMime, addRandomSuffix: false });
  },
  async leggi(nome) {
    const r = await get(percorso(nome), { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const pezzi: Buffer[] = [];
    const lettore = r.stream.getReader();
    for (;;) {
      const { done, value } = await lettore.read();
      if (done) break;
      pezzi.push(Buffer.from(value));
    }
    return Buffer.concat(pezzi);
  },
  async togli(nome) {
    await del(percorso(nome));
  },
};

let attuale: ArchivioBlob = veroArchivio;

export const archivioBlob = (): ArchivioBlob => attuale;

/** Solo per i test: sostituisce l'archivio vero; restituisce la funzione che lo rimette. */
export function usaArchivioBlob(finto: ArchivioBlob): () => void {
  attuale = finto;
  return () => {
    attuale = veroArchivio;
  };
}
