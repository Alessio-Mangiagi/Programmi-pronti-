// Note sulle celle della tabella di modifica: dove guardare.
//
// Due fonti, entrambe già in mano all'app dopo la scansione:
//  - le letture INCERTE dell'OCR (blocchi sotto soglia di confidenza, con la pagina):
//    se il valore di una cella sta in uno di quei blocchi, la cella è da ricontrollare;
//  - le differenze bozza Word → PDF firmato: se il valore sta in un pezzo di testo che
//    nel PDF è diverso dalla bozza, quel valore è CAMBIATO ALLA FIRMA (vale il PDF, ma
//    il revisore deve saperlo).
// Funzioni pure, senza React: testate in __tests__/note-celle.test.ts.
import type { Confronto } from './confronto'

export interface Incerta { pagina: number; testo: string; conf: number }
export type NotaCella =
  | { tipo: 'incerta'; testo: string; conf: number }
  | { tipo: 'firma'; testo: string; word: string }

// Quel che serve di una voce della coda: le incerte, il confronto e il testo unito
// (per risalire alla pagina di una riga del confronto).
export interface VoceConNote { incerte?: Incerta[]; confronto?: Confronto; testo?: string }

const scappaRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Il valore compare nel testo come token intero: "4,00" non deve accendersi su "14,00".
export const contieneToken = (testo: string, valore: string): boolean => {
  const v = valore.trim().toLowerCase()
  if (v.length < 2) return false
  return new RegExp(`(^|[^0-9a-zà-ü])${scappaRe(v)}([^0-9a-zà-ü]|$)`, 'i').test(testo.toLowerCase())
}

// Pagina di una riga (1-based) del testo unito: si contano i separatori "---" prima.
export const paginaDellaRiga = (testo: string | undefined, riga: number): number => {
  if (!testo) return 0
  let p = 1
  const righe = testo.split('\n')
  for (let i = 0; i < Math.min(riga - 1, righe.length); i++) if (righe[i].trim() === '---') p++
  return p
}

export const notaCella = (voce: VoceConNote | undefined, riga: Record<string, string>, campo: string): NotaCella | null => {
  if (!voce) return null
  const valore = String(riga[campo] ?? '').trim()
  if (valore.length < 2) return null
  const pag = Number(riga.pagina_origine) || 0
  // 1) lettura OCR incerta: il valore sta in un blocco sotto soglia della stessa pagina
  //    (per la descrizione basta il contrario: il blocco sta nella descrizione)
  for (const inc of voce.incerte ?? []) {
    if (pag && inc.pagina !== pag) continue
    if (contieneToken(inc.testo, valore) || (campo === 'descrizione' && inc.testo.trim().length >= 4 && contieneToken(valore, inc.testo)))
      return { tipo: 'incerta', testo: inc.testo, conf: inc.conf }
  }
  // 2) cambiato alla firma: il valore sta in una differenza Word→PDF (modificata/aggiunta)
  const conf = voce.confronto
  if (conf?.confrontabile) {
    for (const d of conf.differenze) {
      if (d.tipo !== 'modificata' && d.tipo !== 'aggiunta') continue
      if (pag && voce.testo && paginaDellaRiga(voce.testo, d.rigaPdf) !== pag) continue
      if (contieneToken(d.pdf, valore)) return { tipo: 'firma', testo: d.pdf, word: d.word }
    }
  }
  return null
}

// Quante righe hanno almeno una cella incerta / cambiata alla firma (per i riepiloghi).
export const contaNote = (voce: VoceConNote | undefined, righe: Record<string, string>[], campi: readonly string[]): { incerte: number; firma: number } => {
  let incerte = 0, firma = 0
  if (!voce || (!voce.incerte?.length && !voce.confronto)) return { incerte, firma }
  for (const r of righe) {
    const note = campi.map(c => notaCella(voce, r, c)).filter((n): n is NotaCella => n !== null)
    if (note.some(n => n.tipo === 'incerta')) incerte++
    if (note.some(n => n.tipo === 'firma')) firma++
  }
  return { incerte, firma }
}
