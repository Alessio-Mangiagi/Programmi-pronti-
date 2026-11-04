// "><(((º> sabusabu <º)))><"
/**
 * Genera i file del MODULO CONTRATTO vuoto in docs/modulo/:
 *   - Modulo_contratto_OCR.txt   (lo stesso testo che scarica il pulsante nell'app)
 *   - Modulo_contratto_OCR.docx  (la stessa struttura in Word: campi come paragrafi,
 *                                 elenco prezzi come tabella vera)
 *
 *   npx tsx tools/genera_modulo.ts
 *
 * Entrambi escono dalla specifica in src/lib/modulo-contratto.ts: un campo aggiunto lì
 * compare qui da solo. Va rilanciato dopo ogni modifica alla specifica, e i file in
 * docs/modulo/ vanno committati: sono quelli che gli uffici si passano.
 *
 * Il .docx è pensato per chi compila in Word: mammoth lo riconverte in testo con le
 * celle separate da "|" (src/lib/file-input.ts, docxATesto) e leggiModulo lo legge come
 * il .txt. Le spiegazioni ("# …") sono paragrafi in grigio: il lettore le ignora.
 */
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { CAMPI_IMPORTI, CAMPI_TESTATA, COLONNE_RIGHE, MODULO_VERSIONE, NOME_FILE_MODULO, moduloVuoto, type CampoModulo } from '../src/lib/modulo-contratto.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'docs', 'modulo')
mkdirSync(DIR, { recursive: true })

// ── .txt ────────────────────────────────────────────────────────────────────
const txt = path.join(DIR, `${NOME_FILE_MODULO}.txt`)
writeFileSync(txt, '﻿' + moduloVuoto(), 'utf8')
console.log(`scritto ${path.relative(ROOT, txt)}`)

// ── .docx ───────────────────────────────────────────────────────────────────
const FONT = 'Calibri'
const testo = (t: string, opz: { bold?: boolean; color?: string; italics?: boolean; size?: number } = {}) =>
  new TextRun({ text: t, font: FONT, size: opz.size ?? 22, bold: opz.bold, italics: opz.italics, color: opz.color })
const paragrafo = (t: string, opz: Parameters<typeof testo>[1] = {}, spacingAfter = 80) =>
  new Paragraph({ children: [testo(t, opz)], spacing: { after: spacingAfter } })
// le spiegazioni restano righe "#": è così che leggiModulo le riconosce e le salta
const nota = (t: string) => paragrafo(`# ${t}`, { italics: true, color: '7F7F7F', size: 18 }, 40)
const sezione = (t: string) => paragrafo(t, { bold: true, size: 24 }, 120)

const cella = (t: string, opz: Parameters<typeof testo>[1] = {}, larghezza?: number) =>
  new TableCell({
    children: [new Paragraph({ children: [testo(t, { size: 20, ...opz })] })],
    ...(larghezza ? { width: { size: larghezza, type: WidthType.PERCENTAGE } } : {}),
  })

const campi = (lista: CampoModulo[]): Paragraph[] => lista.flatMap(c => [
  nota(`${c.aiuto}${c.obbligatorio ? ' — OBBLIGATORIO' : ''}`),
  paragrafo(`${c.etichetta}: `, { bold: true }, 160),
])

const colonne = COLONNE_RIGHE.filter(c => c.obbligatoria)
const LARGHEZZE = [14, 40, 8, 12, 12, 14]          // % — la descrizione è la colonna larga
const rigaVuota = () => new TableRow({ children: colonne.map((_, k) => cella('', {}, LARGHEZZE[k])) })
const tabellaRighe = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ tableHeader: true, children: colonne.map((c, k) => cella(c.etichetta, { bold: true }, LARGHEZZE[k])) }),
    ...Array.from({ length: 8 }, rigaVuota),
  ],
})

const doc = new Document({
  creator: 'OCR Documenti',
  title: MODULO_VERSIONE,
  sections: [{
    properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
    children: [
      paragrafo(MODULO_VERSIONE, { bold: true, size: 28 }, 120),
      nota('Compila i valori dopo i due punti. Le righe che iniziano con # sono spiegazioni e vengono ignorate.'),
      nota('Lascia vuoto ciò che il contratto non riporta: niente inventato. Numeri in formato italiano (1.234,56), date GG/MM/AAAA.'),
      nota('Il programma legge i valori alla lettera e si ferma, indicando la riga, se qualcosa non è nel formato atteso.'),
      paragrafo('', {}, 120),
      sezione('[TESTATA]'),
      ...campi(CAMPI_TESTATA),
      sezione('[IMPORTI]'),
      ...campi(CAMPI_IMPORTI),
      sezione('[RIGHE]'),
      nota('Elenco prezzi: una voce per riga della tabella, nell\'ordine del contratto. Le celle vuote restano vuote.'),
      nota('Esempio: B.03.025.a | Conglomerato cementizio C25/30 per fondazioni | mc | 120,00 | 95,50 | 11.460,00'),
      tabellaRighe,
      paragrafo('', {}, 120),
      sezione('[FINE]'),
    ],
  }],
})

const docx = path.join(DIR, `${NOME_FILE_MODULO}.docx`)
writeFileSync(docx, await Packer.toBuffer(doc))
console.log(`scritto ${path.relative(ROOT, docx)}`)
