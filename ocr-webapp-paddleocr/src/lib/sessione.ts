// Sessione di lavoro su IndexedDB: coda (file compresi), risultati, confronti, lavori
// lato server in corso. Un reload, o una scheda chiusa per sbaglio, non buttano via
// 800 pagine di OCR: all'avvio l'app propone «Riprendi».
//
// IndexedDB e non localStorage perché i File si salvano così come sono (structured
// clone) e non ci sono limiti da pochi MB. Se IndexedDB manca (finestra privata,
// browser bloccato) tutto qui fallisce in silenzio: l'app funziona uguale, senza memoria.
export interface VoceSalvata {
  file: File
  result: string
  testo?: string
  formato?: string
  confronto?: unknown
  incerte?: unknown
  lavoroId?: string
  motore?: string
}
export interface Sessione {
  voci: VoceSalvata[]
  activeIdx: number
  format: string
  abbinamenti?: Record<string, string>
  salvataAl: number
}

const DB = 'ocr-converter'
const STORE = 'sessione'
const CHIAVE = 'corrente'

const apri = (): Promise<IDBDatabase> => new Promise((res, rej) => {
  if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB assente'))
  const r = indexedDB.open(DB, 1)
  r.onupgradeneeded = () => { r.result.createObjectStore(STORE) }
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
  r.onblocked = () => rej(new Error('IndexedDB bloccato'))
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

export const salvaSessione = async (s: Sessione): Promise<boolean> => {
  try { await conStore('readwrite', st => st.put(s, CHIAVE)); return true } catch { return false }
}
export const leggiSessione = async (): Promise<Sessione | null> => {
  try {
    const s = (await conStore<Sessione | undefined>('readonly', st => st.get(CHIAVE))) ?? null
    return s && Array.isArray(s.voci) ? s : null
  } catch { return null }
}
export const cancellaSessione = async (): Promise<void> => {
  try { await conStore('readwrite', st => st.delete(CHIAVE)) } catch { /* niente da cancellare */ }
}
