/**
 * Ispezione della geometria OCR di una singola pagina, dai blocchi in cache del banco.
 * Serve quando una tabella esce sbagliata e bisogna capire DOVE stanno le parole
 * (colonne, margine destro, righe corte) invece di indovinare.
 *
 *   npx tsx tools/dbg_pagina.ts <parte-del-nome-pdf> <numero-pagina>
 *
 * Stampa, riga per riga: Y, X di inizio, X di fine, testo. In coda il testo ricomposto.
 */
process.env.OCR_LIB_MODE = '1'
process.env.PADDLE_VISION_FALLBACK = '0'
process.env.OLLAMA_BASE = 'http://127.0.0.1:1'

import { createHash } from 'crypto'
import fs from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { componiTesto } = await import('../server.ts')

const [filtro, pagina = '1'] = process.argv.slice(2)
const dirPagine = path.join(ROOT, '.harness-cache', 'pagine')
const png = readdirSync(dirPagine).find(f =>
  f.toLowerCase().includes(filtro.toLowerCase()) && f.endsWith(`__p${String(pagina).padStart(3, '0')}.png`))
if (!png) { console.error(`Pagina non in cache: ${filtro} p${pagina}`); process.exit(1) }

const key = createHash('sha1').update(await fs.readFile(path.join(dirPagine, png))).digest('hex')
const cache = path.join(ROOT, '.harness-cache', 'blocchi', `${key}.json`)
if (!existsSync(cache)) { console.error(`Blocchi non in cache per ${png}`); process.exit(1) }

type Blocco = { text: string; x: number; y: number; w: number; h: number; conf: number }
const blocchi: Blocco[] = JSON.parse(await fs.readFile(cache, 'utf8'))
console.log(`${png} — ${blocchi.length} blocchi\n`)

// stesse righe visuali della pipeline (raggruppamento per Y)
const ordinati = [...blocchi].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))
const righe: Blocco[][] = []
let cy = -1e9
for (const b of ordinati) {
  const c = b.y + b.h / 2
  if (righe.length && c - cy <= Math.max(8, b.h * 0.55)) righe[righe.length - 1].push(b)
  else { righe.push([b]); cy = c }
}
for (const r of righe) {
  r.sort((a, b) => a.x - b.x)
  const x0 = r[0].x, x1 = Math.max(...r.map(b => b.x + b.w))
  console.log(`y=${String(r[0].y).padStart(5)} x=${String(x0).padStart(5)}→${String(x1).padStart(5)}  ${r.map(b => b.text).join(' ').slice(0, 150)}`)
}

console.log('\n──── testo ricomposto ────')
console.log(componiTesto(blocchi as never))
