// Fase B del banco di prova: rigioca il testo OCR in cache attraverso /api/ocr
// (format=contratti, una pagina per richiesta, come fa il frontend), fonde i JSON
// pagina per pagina e stampa un riepilogo confrontabile fra una modifica e l'altra.
//
//   node tools/harness/run_pipeline.mjs [filtro] [--json out.json]
//
// Nessun OCR: il testo arriva dai file scritti da render_ocr.py.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
// HARNESS_CACHE punta a una cache alternativa (es. cache-nativo, scritta da
// render_nativo.mjs) senza toccare quella OCR: il confronto prima/dopo si fa
// eseguendo lo stesso comando due volte con due cache diverse.
const CACHE = process.env.HARNESS_CACHE
  ? path.resolve(process.env.HARNESS_CACHE)
  : path.join(ROOT, 'cache')
const API = process.env.OCR_API ?? 'http://127.0.0.1:3007/api/ocr'

const argv = process.argv.slice(2)
const outJson = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : ''
const filtro = argv.filter(a => !a.startsWith('--') && a !== outJson)[0]?.toLowerCase() ?? ''

const postOcr = async (body) => {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? r.statusText)
  return j.result
}

// stessa fusione del frontend (parseAlyante): testata/importi dalla prima pagina che
// li porta, righe e anagrafiche concatenate e deduplicate fra pagine
const chiaveRiga = (r) => [
  String(r.codice_epu ?? '').toUpperCase().replace(/\s+/g, ''),
  String(r.udm ?? '').toLowerCase(),
  r.quantita ?? '', r.prezzo_lordo ?? '',
  String(r.descrizione ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 50),
].join('|')
const fondi = (pagine) => {
  const m = { testata: {}, righe: [], anagrafiche_articoli: [], importi: {} }
  for (const p of pagine) {
    m.testata = { ...(p.testata ?? {}), ...m.testata }
    m.importi = { ...(p.importi ?? {}), ...m.importi }
    if (Array.isArray(p.righe)) m.righe.push(...p.righe)
    if (Array.isArray(p.anagrafiche_articoli)) m.anagrafiche_articoli.push(...p.anagrafiche_articoli)
  }
  // stessa preferenza del frontend: il titolo del documento non è l'oggetto
  if (!m.testata.oggetto || /^contratto\s+di\b/i.test(m.testata.oggetto)) {
    const vero = pagine.map(p => String(p.testata?.oggetto ?? ''))
      .find(o => o.length > 15 && !/^contratto\s+di\b/i.test(o))
    if (vero) m.testata.oggetto = vero
  }
  const visti = new Set()
  const uniche = m.righe.filter(r => {
    const k = chiaveRiga(r)
    if (visti.has(k)) return false
    visti.add(k)
    return true
  })
  m.dupRimossi = m.righe.length - uniche.length
  m.righe = uniche
  return m
}

const num = (s) => {
  const n = parseFloat(String(s ?? '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

// Indicatori di qualità, gli stessi misurati sugli xlsx delle scansioni
const metriche = (m) => {
  const r = m.righe ?? []
  let mid = 0, senzaCod = 0, senzaUm = 0, senzaVal = 0, incoerenti = 0
  const dup = m.dupRimossi ?? 0
  for (const x of r) {
    const d = String(x.descrizione ?? '')
    if (d && (/^[a-zà-ü]/.test(d) || /^[,.;)\]]/.test(d))) mid++
    if (!x.codice_epu) senzaCod++
    if (!x.udm) senzaUm++
    const q = num(x.quantita), p = num(x.prezzo_lordo), i = num(x.importo)
    if (!(q > 0) || !(p > 0)) senzaVal++
    else if (Number.isFinite(i) && i > 0 && Math.abs(q * p - i) > i * 0.02) incoerenti++
  }
  return { righe: r.length, dup, mid, senzaCod, senzaUm, senzaVal, incoerenti }
}

const main = async () => {
  const cartelle = fs.readdirSync(CACHE).filter(d => fs.statSync(path.join(CACHE, d)).isDirectory())
  const report = []
  for (const c of cartelle.sort()) {
    if (filtro && !c.toLowerCase().includes(filtro)) continue
    const pagine = fs.readdirSync(path.join(CACHE, c)).filter(f => /^p\d+\.txt$/.test(f)).sort()
    if (!pagine.length) continue
    // origine.txt lo scrive render_nativo.mjs: senza, il testo in cache viene dall'OCR
    // (render_ocr.py) e il server non deve applicargli le normalizzazioni del nativo.
    const marker = path.join(CACHE, c, 'origine.txt')
    const origine = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : undefined
    const out = []
    for (const f of pagine) {
      const text = fs.readFileSync(path.join(CACHE, c, f), 'utf8')
      if (!text.trim()) continue
      try { out.push(JSON.parse(await postOcr({ text, format: 'contratti', ...(origine ? { origine } : {}) }))) }
      catch (e) { console.error(`  ! ${c}/${f}: ${e.message}`) }
    }
    const m = fondi(out.flat())
    const q = metriche(m)
    report.push({ contratto: c, ...q, testata: m.testata, righe_dett: m.righe })
    console.log(`${c.slice(0, 52).padEnd(52)} righe:${String(q.righe).padStart(4)} dup:${String(q.dup).padStart(3)} midD:${String(q.mid).padStart(3)} noCod:${String(q.senzaCod).padStart(3)} noUM:${String(q.senzaUm).padStart(3)} noVal:${String(q.senzaVal).padStart(3)} incoer:${String(q.incoerenti).padStart(3)}`)
  }
  const tot = report.reduce((a, r) => ({
    righe: a.righe + r.righe, dup: a.dup + r.dup, mid: a.mid + r.mid,
    senzaCod: a.senzaCod + r.senzaCod, senzaUm: a.senzaUm + r.senzaUm,
    senzaVal: a.senzaVal + r.senzaVal, incoerenti: a.incoerenti + r.incoerenti,
  }), { righe: 0, dup: 0, mid: 0, senzaCod: 0, senzaUm: 0, senzaVal: 0, incoerenti: 0 })
  console.log('\nTOTALE', JSON.stringify(tot))
  if (outJson) fs.writeFileSync(outJson, JSON.stringify(report, null, 2))
}

main()
