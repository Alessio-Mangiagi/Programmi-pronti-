// "><(((º> sabusabu <º)))><"
/**
 * SCANSIONE DI UNA CARTELLA DEL PC — logica del pulsante ⚙ Impostazioni.
 *
 * L'utente sceglie due cartelle del suo PC (contratti da leggere, destinazione dei
 * risultati) e quando partire: a mano, a un orario nei giorni scelti, o all'arrivo di un
 * file nuovo. App.tsx mette in coda i contratti trovati, li elabora con la filiera di
 * sempre (stesso giro di «Elabora → Excel») e scrive l'Excel nella destinazione; qui ci
 * sono le regole (quando partire, quali file, nomi liberi, registro) e l'accesso alle
 * cartelle.
 *
 * Perché nel browser e non sul server: le cartelle stanno sul PC di chi usa l'app (scelta
 * dell'utente del 05/11/2026). Vuol dire File System Access API, che esiste SOLO su Chrome
 * ed Edge (non su Firefox né Safari), e una scansione automatica che parte solo mentre la
 * scheda dell'app è aperta. Le cartelle scelte restano in IndexedDB: il browser conserva
 * il permesso o lo richiede con un clic alla riapertura (`permesso`).
 *
 * Impostazioni PER UTENTE: la chiave in IndexedDB è l'utente del Portale (/api/utente);
 * senza Portale davanti (sviluppo, SSO spento) è «locale».
 *
 * Dopo la scansione l'originale lascia la cartella: in «elaborati» se l'Excel è stato
 * fatto, in «da controllare» se il programma l'ha respinto. Così la cartella dice da sola
 * cosa resta da fare e niente viene letto due volte.
 */
import type { DirHandle } from './salvataggio'
import { INTESTAZIONE_REGISTRO, REGISTRO, daConsiderare, nomeLibero, type Pianificazione } from './regole-cartella'

// ── Tipi minimi della File System Access API (lib.dom non li ha tutti) ────────
export interface FileScrivibile {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>
}
export interface Cartella extends DirHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterable<FileScrivibile | Cartella>
  getFileHandle(nome: string, opts?: { create?: boolean }): Promise<FileScrivibile>
  getDirectoryHandle(nome: string, opts?: { create?: boolean }): Promise<Cartella>
  removeEntry(nome: string): Promise<void>
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
}

// ── Impostazioni del browser ─────────────────────────────────────────────────
// Le regole pure (quando partire, quali file, nomi liberi, registro) stanno in
// regole-cartella.ts, condiviso col server: qui si riesportano per chi le importa da qui.
export * from './regole-cartella'

export interface Impostazioni extends Pianificazione {
  contratti: Cartella | null      // dove arrivano i contratti da leggere
  destinazione: Cartella | null   // dove vanno Excel, modulo e registro
  ultimoEsito: string             // riassunto dell'ultima scansione, per la finestra
}
export const IMPOSTAZIONI_INIZIALI: Impostazioni = {
  contratti: null, destinazione: null, avvio: 'mano', orario: '20:00', giorni: [1, 2, 3, 4, 5],
  ogniMinuti: 5, ultimaScansione: 0, ultimoEsito: '',
}

// ── Accesso alle cartelle (solo browser) ─────────────────────────────────────
/**
 * Permesso di lettura/scrittura sulla cartella. `chiedi` = true solo dentro un clic
 * dell'utente: fuori da un gesto il browser rifiuta la richiesta.
 */
export const permesso = async (c: Cartella, chiedi: boolean): Promise<boolean> => {
  try {
    if (!c.queryPermission) return true
    if ((await c.queryPermission({ mode: 'readwrite' })) === 'granted') return true
    return chiedi && !!c.requestPermission && (await c.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/** Permesso su ENTRAMBE le cartelle delle impostazioni (false se ne manca una). */
export const permessoCartelle = async (imp: Pick<Impostazioni, 'contratti' | 'destinazione'>, chiedi: boolean): Promise<boolean> =>
  !!imp.contratti && !!imp.destinazione && await permesso(imp.contratti, chiedi) && await permesso(imp.destinazione, chiedi)

/** File al primo livello della cartella (le sottocartelle, «elaborati» compresa, no). */
export const elencaFile = async (c: Cartella): Promise<{ nome: string; file: File }[]> => {
  const out: { nome: string; file: File }[] = []
  for await (const e of c.values()) {
    if (e.kind !== 'file' || !daConsiderare(e.name)) continue
    out.push({ nome: e.name, file: await e.getFile() })
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
}

const nomiIn = async (c: Cartella): Promise<Set<string>> => {
  const s = new Set<string>()
  for await (const e of c.values()) s.add(e.name)
  return s
}

/**
 * Sposta un file della cartella nella sottocartella `sotto` (creata se manca), senza
 * sovrascrivere: copia e poi cancella l'originale. `FileSystemFileHandle.move()` farebbe
 * prima, ma sulle cartelle del PC non c'è in tutte le versioni di Chrome/Edge.
 * Ritorna il nome con cui il file è finito là.
 */
export const sposta = async (da: Cartella, nome: string, file: File, sotto: string): Promise<string> => {
  const dest = await da.getDirectoryHandle(sotto, { create: true })
  const finale = nomeLibero(nome, await nomiIn(dest))
  const w = await (await dest.getFileHandle(finale, { create: true })).createWritable()
  await w.write(file)
  await w.close()
  await da.removeEntry(nome)
  return finale
}

/** Scrive un file di testo nella cartella (sovrascrive). */
export const scriviTesto = async (c: Cartella, nome: string, testo: string): Promise<void> => {
  const w = await (await c.getFileHandle(nome, { create: true })).createWritable()
  await w.write(new Blob([testo], { type: 'text/plain;charset=utf-8' }))
  await w.close()
}

/** Accoda righe al registro della cartella di destinazione (lo crea con l'intestazione). */
export const aggiungiAlRegistro = async (c: Cartella, righe: string[]): Promise<void> => {
  if (!righe.length) return
  let prima = ''
  try { prima = await (await (await c.getFileHandle(REGISTRO)).getFile()).text() } catch { /* registro ancora da creare */ }
  const testo = prima.trim()
    ? `${prima.replace(/\s+$/, '')}\r\n${righe.join('\r\n')}\r\n`
    : `\uFEFF${INTESTAZIONE_REGISTRO}\r\n${righe.join('\r\n')}\r\n`     // BOM: Excel legge gli accenti
  await scriviTesto(c, REGISTRO, testo)
}

// ── Memoria per utente (IndexedDB) ───────────────────────────────────────────
// Database a parte da quello della sessione (lib/sessione.ts): aggiungere uno store là
// vorrebbe dire alzare la versione e migrare le sessioni salvate. Le cartelle (handle)
// si salvano così come sono: IndexedDB le accetta (structured clone), localStorage no.
const DB = 'ocr-impostazioni'
const STORE = 'utenti'
const apri = (): Promise<IDBDatabase> => new Promise((res, rej) => {
  if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB assente'))
  const r = indexedDB.open(DB, 1)
  r.onupgradeneeded = () => { r.result.createObjectStore(STORE) }
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
const conStore = async <T,>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await apri()
  try {
    return await new Promise<T>((res, rej) => {
      const tx = db.transaction(STORE, modo)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => res(req.result)
      tx.onerror = () => rej(tx.error)
      tx.onabort = () => rej(tx.error)
    })
  } finally {
    db.close()
  }
}
export const leggiImpostazioni = async (utente: string): Promise<Impostazioni> => {
  try {
    const salvate = await conStore<Partial<Impostazioni> | undefined>('readonly', s => s.get(utente))
    return { ...IMPOSTAZIONI_INIZIALI, ...(salvate ?? {}) }
  } catch {
    return { ...IMPOSTAZIONI_INIZIALI }    // finestra privata o IndexedDB bloccato: si riparte vuoti
  }
}
export const salvaImpostazioni = async (utente: string, imp: Impostazioni): Promise<boolean> => {
  try { await conStore('readwrite', s => s.put(imp, utente)); return true } catch { return false }
}
