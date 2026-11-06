// "><(((º> sabusabu <º)))><"
/**
 * PDF FIRMATI DIGITALMENTE (.p7m) — lato browser.
 *
 * Un `.p7m` (busta CAdES) non si legge con pdf.js: va aperto. Appena entra in coda (scelto a
 * mano, trascinato o trovato dalla scansione di una cartella) lo si manda al backend
 * (`POST /api/firma/apri`, server/firma.ts → motore comune shared/firma), che restituisce
 * il PDF contenuto e il rapporto della verifica. In coda va il PDF, così tutta la filiera
 * (anteprima, testo nativo, OCR, modulo contratto, Excel) resta quella di sempre.
 *
 * Il rapporto resta attaccato al File estratto (`firmaDi(file)`), e con lui l'originale
 * firmato (`originaleDi(file)`): la scansione della cartella sposta in «elaborati» il .p7m
 * vero, non la sua copia PDF, perché il valore legale ce l'ha la busta. Nella sessione
 * salvata il rapporto viaggia nella voce (sessione.ts) e torna qui con `registraFirma`.
 */

export type EsitoFirma = 'valida' | 'non valida' | 'da verificare'

/** Una firma della busta (sottoinsieme del JSON di shared/firma/firma.py apri). */
export interface FirmaVoce {
  firmatario: string
  codice_fiscale?: string | null
  organizzazione?: string | null
  ente_certificatore?: string | null
  tipo?: string
  esito: EsitoFirma | null
  motivi: string[]
  data_firma_dichiarata?: string | null
  data_riferimento?: string | null
  marca_temporale?: { data: string | null; valida: boolean; motivo: string | null; ente: string | null } | null
  certificato_valido_al?: string
  livello?: number
}
export interface RapportoFirma {
  firmato: boolean
  esito: EsitoFirma | null
  riepilogo: string
  firme: FirmaVoce[]
  livelli: number
  nome_contenuto?: string
  /** nome del file firmato com'era arrivato (es. "contratto.pdf.p7m") */
  nomeOriginale?: string
  elenchi?: { fonte: string | null; aggiornati_il: string | null; servizi: number; errore: string | null } | null
}

const rapporti = new WeakMap<File, RapportoFirma>()
const originali = new WeakMap<File, File>()

/** Rapporto della firma del documento in coda (undefined = documento non firmato). */
export const firmaDi = (f: File): RapportoFirma | undefined => rapporti.get(f)
/** Il .p7m da cui è stato estratto questo PDF (per spostare l'originale firmato). */
export const originaleDi = (f: File): File | undefined => originali.get(f)
/** Riaggancia un rapporto salvato nella sessione al File ripreso da IndexedDB. */
export const registraFirma = (f: File, r: unknown) => {
  if (r && typeof r === 'object' && 'firme' in (r as object)) rapporti.set(f, r as RapportoFirma)
}

/** Busta firmata dal nome o dal tipo dichiarato (il contenuto lo controlla il server). */
export const sembraFirmato = (f: File): boolean =>
  /\.p7m\s*$/i.test(f.name) || /pkcs7-mime|x-pkcs7/i.test(f.type)

// 1.2.840.113549.1.7.2 (SignedData) in DER: c'è nei primi byte di ogni busta CAdES
const OID_SIGNED_DATA = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]
/** Busta riconosciuta dal contenuto, per i file senza estensione (allegati PEC rinominati). */
export const contenutoFirmato = async (f: File): Promise<boolean> => {
  const testa = new Uint8Array(await f.slice(0, 64).arrayBuffer())
  if (testa[0] !== 0x30) return false
  for (let i = 0; i + OID_SIGNED_DATA.length <= testa.length; i++) {
    if (OID_SIGNED_DATA.every((b, k) => testa[i + k] === b)) return true
  }
  return false
}

const daBase64 = (b64: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Apre una busta .p7m sul server e restituisce il File del documento contenuto (di solito
 * il PDF), con rapporto e originale registrati. Se il server dice che non era una busta,
 * torna il file com'era. Errori con messaggio per l'utente (motore non installato, busta rotta).
 */
export const apriFirmato = async (f: File, fetchFn: typeof fetch = fetch): Promise<File> => {
  const r = await fetchFn('/api/firma/apri', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Nome-File': encodeURIComponent(f.name) },
    body: f,
  })
  let dati: { firmato?: boolean; nomeContenuto?: string; tipo?: string; contenuto?: string; rapporto?: RapportoFirma; error?: string } = {}
  try { dati = await r.json() } catch { /* corpo non JSON: messaggio generico sotto */ }
  if (!r.ok) throw new Error(dati.error || `${f.name}: apertura della busta firmata non riuscita (HTTP ${r.status})`)
  if (!dati.firmato || !dati.contenuto || !dati.rapporto) return f
  const estratto = new File([daBase64(dati.contenuto)], dati.nomeContenuto || f.name.replace(/\.p7m$/i, ''),
    { type: dati.tipo || 'application/pdf', lastModified: f.lastModified })
  rapporti.set(estratto, { ...dati.rapporto, nomeOriginale: f.name })
  originali.set(estratto, f)
  return estratto
}

/**
 * Prepara un gruppo di file per la coda: le buste firmate diventano il loro documento, gli
 * altri passano com'erano. Una busta che non si apre non entra in coda e finisce in `errori`
 * (la coda non si ferma per un file).
 */
export const preparaFile = async (files: File[], fetchFn: typeof fetch = fetch):
  Promise<{ pronti: File[]; errori: string[] }> => {
  const pronti: File[] = []
  const errori: string[] = []
  for (const f of files) {
    const firmato = sembraFirmato(f) || (!/\.[a-z0-9]{1,5}$/i.test(f.name) && await contenutoFirmato(f))
    if (!firmato) { pronti.push(f); continue }
    try { pronti.push(await apriFirmato(f, fetchFn)) } catch (err) {
      errori.push(err instanceof Error ? err.message : String(err))
    }
  }
  return { pronti, errori }
}

/** Colore ed etichetta del badge per un esito (verde / rosso / giallo, grigio se non verificata). */
export const aspettoEsito = (esito: EsitoFirma | null | undefined): { etichetta: string; colore: string; sfondo: string } => {
  if (esito === 'valida') return { etichetta: 'Firma valida', colore: '#1e8e3e', sfondo: '#e6f4ea' }
  if (esito === 'non valida') return { etichetta: 'Firma NON valida', colore: '#c5221f', sfondo: '#fce8e6' }
  if (esito === 'da verificare') return { etichetta: 'Firma da verificare', colore: '#a16207', sfondo: '#fff8e1' }
  return { etichetta: 'Firmato (non verificato)', colore: '#66707a', sfondo: '#f2f3f5' }
}

/** Una riga per il registro della scansione di cartella e per i messaggi. */
export const notaFirma = (r: RapportoFirma | undefined): string => (r ? `Firmato .p7m — ${r.riepilogo}` : '')
