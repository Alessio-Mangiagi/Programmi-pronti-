// "><(((º> sabusabu <º)))><"
/**
 * REGOLE DELLA SCANSIONE DI UNA CARTELLA — comuni a browser e server.
 *
 * Quando partire (a mano, a un orario, all'arrivo di un file), quali file considerare,
 * nomi che non sovrascrivono, righe del registro_scansioni.csv. Nessun accesso a cartelle
 * qui: nel browser lo fa lib/scansione-cartella.ts (File System Access API, solo
 * Chrome/Edge, a pagina aperta), sul server server/cartella.ts (percorsi del PC dove gira
 * OCR Documenti, in ogni browser e anche a pagina chiusa, dal 23/11/2026).
 *
 * Tenute fuori da scansione-cartella.ts perché quel file usa tipi del DOM (handle delle
 * cartelle, IndexedDB) e il controllo dei tipi del server (tsconfig.server.json) non li ha.
 */

// ── Pianificazione ─────────────────────────────────────────────────────────────
export type ModoAvvio = 'mano' | 'orario' | 'arrivo'
/** I campi che decidono quando parte una scansione automatica (browser e server). */
export interface Pianificazione {
  avvio: ModoAvvio
  orario: string                  // "HH:MM", per avvio = 'orario'
  giorni: number[]                // Date.getDay(): 0 = domenica … 6 = sabato
  ogniMinuti: number              // per avvio = 'arrivo': ogni quanto guardare la cartella
  ultimaScansione: number         // ms dell'ultima scansione partita (0 = mai)
}
export const SOTTOCARTELLA_FATTI = 'elaborati'
export const SOTTOCARTELLA_RESPINTI = 'da controllare'
export const REGISTRO = 'registro_scansioni.csv'
// Un file modificato da meno di un minuto può essere ancora in copia (scanner, rete):
// con «all'arrivo di un file» lo si lascia al giro dopo (pochi minuti). A mano e
// all'orario si prende: all'orario rimandarlo vorrebbe dire rimandarlo al giorno dopo.
export const ETA_MINIMA_MS = 60_000
export const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']

/** L'orario "HH:MM" delle impostazioni, nel giorno di `giorno`; null se scritto male. */
export const orarioDelGiorno = (imp: Pick<Pianificazione, 'orario'>, giorno: Date): Date | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(imp.orario.trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const d = new Date(giorno)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d
}

/**
 * Deve partire una scansione automatica adesso?
 * - 'orario': in un giorno scelto, passata l'ora, se l'ultima scansione è di prima di
 *   quell'ora. Se a quell'ora la pagina era chiusa, parte appena si riapre — lo stesso
 *   giorno; i giorni precedenti persi non si recuperano.
 * - 'arrivo': ogni `ogniMinuti` dall'ultimo controllo (`ultimoControllo`, in memoria):
 *   il controllo guarda la cartella e scansiona solo se c'è qualcosa di nuovo.
 * - 'mano': mai.
 */
export const deveAvviare = (imp: Pianificazione, ora: Date, ultimoControllo: number): boolean => {
  if (imp.avvio === 'orario') {
    if (!imp.giorni.includes(ora.getDay())) return false
    const slot = orarioDelGiorno(imp, ora)
    return !!slot && ora.getTime() >= slot.getTime() && imp.ultimaScansione < slot.getTime()
  }
  if (imp.avvio === 'arrivo') return ora.getTime() - ultimoControllo >= Math.max(1, imp.ogniMinuti) * 60_000
  return false
}

/** Quando parte la prossima scansione automatica (per la finestra); null = a mano. */
export const prossimoAvvio = (imp: Pianificazione, ora: Date, ultimoControllo: number): Date | null => {
  if (imp.avvio === 'mano') return null
  if (deveAvviare(imp, ora, ultimoControllo)) return ora
  if (imp.avvio === 'arrivo') return new Date(ultimoControllo + Math.max(1, imp.ogniMinuti) * 60_000)
  for (let k = 0; k <= 7; k++) {
    const giorno = new Date(ora)
    giorno.setDate(ora.getDate() + k)
    if (!imp.giorni.includes(giorno.getDay())) continue
    const slot = orarioDelGiorno(imp, giorno)
    if (slot && slot.getTime() > ora.getTime()) return slot
  }
  return null
}

// Tipi di file che il programma elabora (vedi detectKind). Gli Excel entrano come
// ALLEGATI del contratto con lo stesso nome, non da soli. Esclusi i file temporanei di
// Office ("~$…"), quelli nascosti e il registro che il programma stesso scrive.
// .p7m = contratto firmato digitalmente (busta CAdES): App.tsx lo apre e in coda va il PDF
const ESTENSIONI = /\.(pdf|p7m|docx|xlsx|xls|xlsm|png|jpe?g|tiff?|bmp|webp|txt|md)$/i
export const daConsiderare = (nome: string): boolean =>
  ESTENSIONI.test(nome) && !nome.startsWith('~$') && !nome.startsWith('.') && nome !== REGISTRO

/** Nome che non sovrascrive niente: "x.pdf" → "x (2).pdf", "x (3).pdf"… */
export const nomeLibero = (nome: string, esistenti: Set<string>): string => {
  if (!esistenti.has(nome)) return nome
  const i = nome.lastIndexOf('.')
  const [base, est] = i > 0 ? [nome.slice(0, i), nome.slice(i)] : [nome, '']
  for (let n = 2; ; n++) {
    const prova = `${base} (${n})${est}`
    if (!esistenti.has(prova)) return prova
  }
}

// ── Registro delle scansioni (CSV col ";", come lo apre Excel italiano) ──────
export const INTESTAZIONE_REGISTRO = 'Data;Ora;File;Esito;Voci;Note'
export interface RigaRegistro { quando: Date; file: string; esito: 'elaborato' | 'da controllare'; voci?: number; note?: string }
const cellaCsv = (v: string): string => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export const rigaRegistro = (r: RigaRegistro): string => [
  r.quando.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  r.quando.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
  r.file, r.esito, r.voci === undefined ? '' : String(r.voci), (r.note ?? '').replace(/\s+/g, ' ').trim(),
].map(cellaCsv).join(';')
