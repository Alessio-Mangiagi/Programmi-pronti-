// "><(((º> sabusabu <º)))><"
/**
 * SCANSIONE DI UNA CARTELLA SUL SERVER — i contratti che arrivano in una cartella del PC
 * dove gira OCR Documenti diventano Import_Contratti.xlsx e modulo contratto, da soli.
 *
 * Perché (richiesta del 23/11/2026, «migliorare il caricamento dei dati»): la scansione
 * della cartella nel browser (lib/scansione-cartella.ts) usa la File System Access API,
 * che c'è solo in Chrome ed Edge, e parte solo con la scheda aperta. In Firefox, il
 * browser della suite, non funziona. Qui la stessa cosa la fa il server, con un orologio
 * suo: funziona da qualunque browser e anche a pagina chiusa. Le cartelle sono percorsi
 * del PC del server, non del PC di chi guarda la pagina: per questo le imposta solo
 * l'amministratore dell'app.
 *
 * Stesse regole della scansione nel browser (lib/regole-cartella.ts): quando partire (a
 * mano, a un orario, all'arrivo di un file), quali file, nomi che non sovrascrivono,
 * registro_scansioni.csv, originali spostati in «elaborati» o «da controllare». Stessa
 * filiera dei «lavori lato server» (server/lavori.ts): ogni PDF diventa un lavoro, con
 * rendering, OCR, estrazione e cache identici a quelli del bottone «Elabora → Excel».
 * Stesso Excel del browser (byteImportContrattiXlsx, celle fuori elenco in rosso) e stesso
 * modulo contratto (moduloDaRisultato).
 *
 * File letti: .pdf, .p7m (busta aperta e verificata dal motore comune shared/firma), moduli
 * contratto .txt/.md. Gli Excel con un nome simile al PDF entrano come allegati, il Word
 * con un nome simile come bozza da confrontare (come nella coda del browser). Restano nella
 * cartella, elencati nello stato, i file che il server non legge da solo (Word senza PDF,
 * immagini, .doc): si caricano dalla pagina.
 *
 * Impostazioni in _cartella/impostazioni.json (OCR_CARTELLA_DIR per spostarle).
 * Rotte: GET /api/cartella (tutti: chi non è admin vede solo se è attiva), PUT /api/cartella
 * e POST /api/cartella/avvia (solo admin).
 */
import path from 'path'
import fs from 'fs/promises'
import { existsSync, statSync } from 'fs'
import type express from 'express'
import XLSX from 'xlsx'
import mammoth from 'mammoth'
import firmaComune from '../../shared/firma/firma.mjs'
import { ROOT } from './config.ts'
import { ELENCHI } from './alyante.ts'
import { ascolta, creaLavoro, lavoro as leggiLavoro, ricevutoFile, type Lavoro } from './lavori.ts'
import { risultatoDaModulo } from './modulo.ts'
import { chiDa } from './accessoLavori.ts'
import { descriviErrori, eModulo, moduloDaRisultato } from '../src/lib/modulo-contratto.ts'
import { docxHtmlATesto } from '../src/lib/testo-nativo.ts'
import { impostaElenchi } from '../src/lib/elenchi-client.ts'
import { nomeFileSicuro, nomiSimili } from '../src/lib/nomi-file.ts'
import {
  ETA_MINIMA_MS, INTESTAZIONE_REGISTRO, REGISTRO, SOTTOCARTELLA_FATTI, SOTTOCARTELLA_RESPINTI,
  daConsiderare, deveAvviare, nomeLibero, prossimoAvvio, rigaRegistro, type ModoAvvio, type Pianificazione,
} from '../src/lib/regole-cartella.ts'

// import-contratti.ts importa salvataggio.ts (Blob, document: codice del browser usato solo
// per salvare il file). Col percorso non letterale tsc non lo segue e tsconfig.server.json
// resta senza lib DOM, come in tools/verifica_moduli.ts; i tipi usati qui sono a mano.
type CellaImport = string | number | Date
interface ModuloImport {
  buildImportContrattiRowsFromAlyante: (s: string) => CellaImport[][] | null
  buildImportContrattiRowsFromContract: (s: string) => CellaImport[][] | null
  rowsHaveData: (rows: CellaImport[][] | null) => boolean
  byteImportContrattiXlsx: (rows: CellaImport[][]) => Promise<Uint8Array>
}
const PERCORSO_IMPORT = '../src/lib/import-contratti.ts'
let moduloImport: Promise<ModuloImport> | null = null
const importContratti = (): Promise<ModuloImport> => {
  if (!moduloImport) {
    // l'Excel legge gli elenchi ufficiali da getElenchi(): nel browser arrivano da
    // /api/elenchi, qui sono quelli che il server ha già caricato
    impostaElenchi(ELENCHI)
    moduloImport = import(PERCORSO_IMPORT) as Promise<ModuloImport>
  }
  return moduloImport
}

// ── Impostazioni ─────────────────────────────────────────────────────────────
export interface ImpostazioniServer extends Pianificazione {
  contratti: string       // percorso assoluto della cartella dei contratti (sul PC del server)
  destinazione: string    // percorso assoluto dove scrivere Excel, moduli e registro
  ultimoEsito: string     // riassunto dell'ultima scansione, per la finestra ⚙
  utente?: string         // chi le ha salvate: i lavori della scansione risultano suoi
}
export const IMPOSTAZIONI_SERVER_INIZIALI: ImpostazioniServer = {
  contratti: '', destinazione: '', avvio: 'mano', orario: '20:00', giorni: [1, 2, 3, 4, 5],
  ogniMinuti: 5, ultimaScansione: 0, ultimoEsito: '',
}

const DIR_CARTELLA = process.env.OCR_CARTELLA_DIR || path.join(ROOT, '_cartella')
const FILE_IMPOSTAZIONI = path.join(DIR_CARTELLA, 'impostazioni.json')
let impostazioni: ImpostazioniServer = { ...IMPOSTAZIONI_SERVER_INIZIALI }

export const leggiImpostazioniServer = async (): Promise<ImpostazioniServer> => {
  try {
    impostazioni = { ...IMPOSTAZIONI_SERVER_INIZIALI, ...JSON.parse(await fs.readFile(FILE_IMPOSTAZIONI, 'utf8')) }
  } catch { impostazioni = { ...IMPOSTAZIONI_SERVER_INIZIALI } }
  return impostazioni
}
const salvaImpostazioniServer = async (imp: ImpostazioniServer): Promise<void> => {
  impostazioni = imp
  await fs.mkdir(DIR_CARTELLA, { recursive: true })
  await fs.writeFile(FILE_IMPOSTAZIONI, JSON.stringify(imp, null, 2), 'utf8')
}

const MODI: ModoAvvio[] = ['mano', 'orario', 'arrivo']
const eCartella = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }

/**
 * Controlla le impostazioni mandate dalla finestra ⚙. Le cartelle devono esistere sul PC
 * del server ed essere percorsi assoluti (un percorso relativo dipenderebbe da dove è
 * partito il programma). Restituisce le impostazioni pulite o il primo errore, in italiano.
 */
export const validaImpostazioni = (b: Partial<ImpostazioniServer>, attuali: ImpostazioniServer):
  { imp: ImpostazioniServer } | { errore: string } => {
  const contratti = String(b.contratti ?? '').trim()
  const destinazione = String(b.destinazione ?? '').trim()
  if (!contratti || !destinazione) return { errore: 'Scrivi le due cartelle: quella dei contratti e quella di destinazione.' }
  for (const [nome, p] of [['dei contratti', contratti], ['di destinazione', destinazione]] as const) {
    if (!path.isAbsolute(p)) return { errore: `La cartella ${nome} deve essere un percorso completo (es. C:\\Contratti\\Da leggere).` }
    if (!eCartella(p)) return { errore: `La cartella ${nome} «${p}» non esiste sul PC dove gira OCR Documenti.` }
  }
  if (path.resolve(contratti).toLowerCase() === path.resolve(destinazione).toLowerCase()) {
    return { errore: 'La cartella dei contratti e quella di destinazione devono essere diverse.' }
  }
  const avvio = MODI.includes(b.avvio as ModoAvvio) ? b.avvio as ModoAvvio : 'mano'
  const orario = /^\d{1,2}:\d{2}$/.test(String(b.orario ?? '')) ? String(b.orario) : attuali.orario
  const giorni = Array.isArray(b.giorni) ? [...new Set(b.giorni.map(Number).filter(g => Number.isInteger(g) && g >= 0 && g <= 6))] : attuali.giorni
  if (avvio === 'orario' && !giorni.length) return { errore: 'Scegli almeno un giorno per la scansione all\'orario.' }
  const ogniMinuti = Math.min(240, Math.max(1, Math.round(Number(b.ogniMinuti) || attuali.ogniMinuti)))
  return { imp: { ...attuali, contratti, destinazione, avvio, orario, giorni, ogniMinuti } }
}

// ── Stato (in memoria: vale finché il server gira) ───────────────────────────
export interface EsitoFile { quando: number; file: string; esito: 'elaborato' | 'da controllare'; voci?: number; note?: string }
interface StatoCartella {
  inCorso: boolean
  file: string               // contratto in lavorazione
  fase: string               // fase del suo lavoro ("OCR pagina 4/20")
  fatti: number
  totali: number
  ultimi: EsitoFile[]        // esiti più recenti per primi (al massimo ULTIMI)
  lasciati: string[]         // file che il server non legge da solo, rimasti nella cartella
  errore: string             // perché l'ultima scansione non è partita (cartella sparita…)
}
const ULTIMI = 30
const stato: StatoCartella = { inCorso: false, file: '', fase: '', fatti: 0, totali: 0, ultimi: [], lasciati: [], errore: '' }
// ultimo sguardo alla cartella con «all'arrivo di un file» (0 = al primo giro dell'orologio)
let ultimoControllo = 0
// file già passati in questa vita del server: se lo spostamento non è riuscito restano
// nella cartella, e la scansione automatica non deve rifarli a ogni giro
const giaFatti = new Set<string>()

// ── Il giro su un file ───────────────────────────────────────────────────────
interface Candidato { nome: string; percorso: string; dimensione: number; modificato: number }
const chiave = (c: Candidato) => `${c.nome}|${c.dimensione}|${c.modificato}`
const eExcel = (n: string) => /\.(xlsx|xls|xlsm)$/i.test(n)
const eWord = (n: string) => /\.docx$/i.test(n)
const eTesto = (n: string) => /\.(txt|md)$/i.test(n)
const eDocumento = (n: string) => /\.(pdf|p7m)$/i.test(n)

/** Allegati Excel → testo "ALLEGATO <nome>", come testoAllegatiExcel nel browser (App.tsx). */
const testoAllegati = async (excel: Candidato[]): Promise<string> => {
  const blocchi: string[] = []
  for (const x of excel) {
    try {
      const wb = XLSX.read(await fs.readFile(x.percorso), { type: 'buffer' })
      for (const foglio of wb.SheetNames) {
        const righe = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[foglio], { header: 1, raw: false }) as (string | number)[][]
        const testo = righe
          .map(r => r.map(c => String(c ?? '').trim()).join(' | ').replace(/(\s*\|\s*)+$/, ''))
          .filter(l => l.replace(/[|\s]/g, '').length > 0)
          .join('\n')
        if (testo) blocchi.push(`ALLEGATO ${x.nome}${wb.SheetNames.length > 1 ? ` — ${foglio}` : ''}\n${testo}`)
      }
    } catch { /* allegato illeggibile: si procede senza, come nel browser */ }
  }
  return blocchi.join('\n\n')
}

/** Testo della bozza Word (stessa conversione del browser: mammoth → docxHtmlATesto). */
const testoBozza = async (word: Candidato): Promise<string> => {
  const { value: html } = await mammoth.convertToHtml({ buffer: await fs.readFile(word.percorso) })
  return docxHtmlATesto(html)
}

/** Attende la fine di un lavoro (fatto, errore o annullato), seguendo la fase per lo stato. */
const fineLavoro = (id: string): Promise<Lavoro> => new Promise(resolve => {
  const finito = (l: Lavoro) => l.stato === 'fatto' || l.stato === 'errore' || l.stato === 'annullato'
  const attuale = leggiLavoro(id)
  if (attuale && finito(attuale)) return resolve(attuale)
  const stacca = ascolta(id, l => {
    stato.fase = l.fase
    if (finito(l)) { stacca(); resolve(l) }
  })
})

interface EsitoElaborazione { json: string; formato: 'contratti' | 'contract'; nota: string }

/**
 * Un documento dall'inizio alla fine: busta firmata aperta, modulo letto alla lettera o PDF
 * mandato ai lavori lato server, poi Excel e modulo nella destinazione. Solleva un errore
 * con un testo per chi legge il registro se il documento va controllato a mano.
 */
const elaboraDocumento = async (doc: Candidato, allegati: Candidato[], bozza: Candidato | null, imp: ImpostazioniServer): Promise<EsitoElaborazione & { voci: number }> => {
  let contenuto: Buffer = await fs.readFile(doc.percorso)
  let nome = doc.nome
  let nota = ''
  // contratto firmato digitalmente: la busta si apre col motore comune, che verifica anche
  // la firma; si lavora sul documento estratto e a fine giro si sposta la busta originale
  if (/\.p7m$/i.test(nome) || firmaComune.eBustaFirmata(contenuto, nome)) {
    const aperta = await firmaComune.apri(contenuto, nome)
    contenuto = aperta.contenuto
    nome = aperta.nomeContenuto
    nota = aperta.rapporto?.riepilogo ? `Firmato .p7m — ${aperta.rapporto.riepilogo}` : ''
  }
  let esito: EsitoElaborazione
  const ePdf = contenuto.subarray(0, 5).toString('latin1') === '%PDF-'
  if (!ePdf && (eTesto(nome) || eModulo(contenuto.toString('utf8')))) {
    // modulo contratto (anche dentro una busta): letto alla lettera, niente OCR né parser.
    // Un modulo stampato in PDF passa invece dai lavori, che lo riconoscono da soli.
    const testo = contenuto.toString('utf8').replace(/^\uFEFF/, '')
    const { result, errori } = risultatoDaModulo(testo, 'contratti')
    if (errori.length || !result) throw new Error(`Modulo contratto non valido: ${descriviErrori(errori).replace(/\s+/g, ' ')}`)
    esito = { json: result, formato: 'contratti', nota }
  } else if (ePdf) {
    stato.fase = 'invio ai lavori del server'
    const l = await creaLavoro({
      nome, chiaveFile: chiave(doc), formato: 'contratti', utente: imp.utente,
      testoAllegati: (await testoAllegati(allegati)) || undefined,
      bozza: bozza ? { nome: bozza.nome, testo: await testoBozza(bozza) } : undefined,
    })
    await ricevutoFile(l.id, contenuto)
    const fine = await fineLavoro(l.id)
    if (fine.stato !== 'fatto' || !fine.risultato) throw new Error(fine.errore || `lavoro ${fine.stato}`)
    const r = fine.risultato
    esito = { json: r.json, formato: r.formato === 'contract' ? 'contract' : 'contratti', nota }
  } else {
    throw new Error(`«${nome}» non è un PDF né un modulo contratto: caricalo dalla pagina.`)
  }

  const ic = await importContratti()
  const rows = esito.formato === 'contratti' ? ic.buildImportContrattiRowsFromAlyante(esito.json) : ic.buildImportContrattiRowsFromContract(esito.json)
  if (!ic.rowsHaveData(rows)) throw new Error('Testo non riconosciuto come contratto: nessun dato estratto. Controlla che la scansione sia leggibile.')
  // Nomi come nel browser: l'Excel ripulisce il nome intero (salvaFile), il modulo solo la
  // base (App.tsx). Diversi solo per uno spazio in coda al nome, ma così sono gli stessi file.
  const base = doc.nome.replace(/\.p7m$/i, '').replace(/\.[^.]+$/, '')
  await fs.writeFile(path.join(imp.destinazione, nomeFileSicuro(`${base}_Import_Contratti.xlsx`)), await ic.byteImportContrattiXlsx(rows!))
  let voci = 0
  try {
    voci = ((JSON.parse(esito.json) as { righe?: unknown[] }).righe ?? []).length
    const m = moduloDaRisultato(esito.json, { origine: doc.nome, generato: new Date().toLocaleDateString('it-IT') })
    await fs.writeFile(path.join(imp.destinazione, `${nomeFileSicuro(base)}_modulo.txt`), '\uFEFF' + m.testo, 'utf8')
  } catch { /* modulo non scrivibile: l'Excel c'è, basta quello (come nel browser) */ }
  return { ...esito, voci }
}

/** Sposta un file in una sottocartella della cartella dei contratti, senza sovrascrivere. */
const sposta = async (c: Candidato, dirContratti: string, sotto: string): Promise<void> => {
  const dest = path.join(dirContratti, sotto)
  await fs.mkdir(dest, { recursive: true })
  const nome = nomeLibero(c.nome, new Set(await fs.readdir(dest)))
  await fs.rename(c.percorso, path.join(dest, nome))
}

/** Righe in fondo al registro; la prima volta con il BOM (Excel legge gli accenti) e l'intestazione. */
const scriviRegistro = async (dir: string, righe: string[]): Promise<void> => {
  if (!righe.length) return
  const f = path.join(dir, REGISTRO)
  const nuovo = !existsSync(f)
  await fs.appendFile(f, (nuovo ? `\uFEFF${INTESTAZIONE_REGISTRO}\r\n` : '') + righe.map(r => `${r}\r\n`).join(''), 'utf8')
}

// ── La scansione ─────────────────────────────────────────────────────────────
/** File della cartella dei contratti (solo il primo livello: le sottocartelle sono gli esiti). */
const elencaCandidati = async (dir: string): Promise<Candidato[]> => {
  const out: Candidato[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (!e.isFile() || !daConsiderare(e.name)) continue
    const percorso = path.join(dir, e.name)
    try {
      const s = statSync(percorso)
      out.push({ nome: e.name, percorso, dimensione: s.size, modificato: s.mtimeMs })
    } catch { /* sparito nel frattempo */ }
  }
  return out
}

/**
 * Una scansione: guarda la cartella, elabora un contratto alla volta, sposta gli originali,
 * scrive il registro. `automatica` = partita dall'orologio (salta i file già passati e,
 * «all'arrivo», quelli più giovani di un minuto: potrebbero essere ancora in copia).
 * Non rilancia mai: gli errori finiscono nello stato e nel registro.
 */
export const scansiona = async (automatica: boolean): Promise<void> => {
  if (stato.inCorso) return
  const imp = impostazioni
  if (!imp.contratti || !imp.destinazione) return
  if (!eCartella(imp.contratti) || !eCartella(imp.destinazione)) {
    stato.errore = `Cartella non raggiungibile: ${!eCartella(imp.contratti) ? imp.contratti : imp.destinazione}`
    return
  }
  stato.inCorso = true
  stato.errore = ''
  const ora = Date.now()
  const righe: string[] = []
  let fatti = 0, respinti = 0
  try {
    const tutti = (await elencaCandidati(imp.contratti))
      .filter(c => !(automatica && giaFatti.has(chiave(c))))
      .filter(c => !(automatica && imp.avvio === 'arrivo' && ora - c.modificato < ETA_MINIMA_MS))
    // un .txt/.md entra solo se è un modulo contratto: un appunto qualunque resta dov'è
    const documenti: Candidato[] = []
    for (const c of tutti) {
      if (eDocumento(c.nome)) documenti.push(c)
      else if (eTesto(c.nome)) {
        try { if (eModulo(await fs.readFile(c.percorso, 'utf8'))) documenti.push(c) } catch { /* illeggibile: resta */ }
      }
    }
    const excel = tutti.filter(c => eExcel(c.nome))
    const word = tutti.filter(c => eWord(c.nome))
    const pdf = documenti.filter(c => /\.pdf$/i.test(c.nome))
    // Allegati e bozza come nella coda del browser: con un solo documento tutti gli Excel
    // sono suoi; con più documenti valgono quelli col nome simile. La bozza Word è il Word
    // col nome simile (o l'unico Word se c'è un solo PDF).
    const allegatiDi = (d: Candidato) => documenti.length <= 1 ? excel : excel.filter(x => nomiSimili(d.nome, x.nome))
    const bozzaDi = (d: Candidato): Candidato | null => {
      if (!/\.pdf$/i.test(d.nome) || !word.length) return null
      if (word.length === 1 && pdf.length === 1) return word[0]
      return word.find(w => nomiSimili(d.nome, w.nome)) ?? null
    }
    const usati = new Set<Candidato>()
    for (const d of documenti) { allegatiDi(d).forEach(x => usati.add(x)); const b = bozzaDi(d); if (b) usati.add(b) }
    // Word senza PDF, immagini, .doc: il server non li legge da soli, restano nella cartella
    stato.lasciati = tutti.filter(c => !documenti.includes(c) && !usati.has(c) && !eExcel(c.nome)).map(c => c.nome)

    if (!documenti.length) {
      if (automatica && imp.avvio === 'orario') {
        await salvaImpostazioniServer({ ...impostazioni, ultimaScansione: ora, ultimoEsito: `${new Date(ora).toLocaleString('it-IT')} — nessun contratto nuovo` })
      }
      return
    }
    await salvaImpostazioniServer({ ...impostazioni, ultimaScansione: ora })
    stato.totali = documenti.length
    stato.fatti = 0
    for (const d of documenti) {
      stato.file = d.nome
      stato.fase = 'in lavorazione'
      const compagni = [...allegatiDi(d), bozzaDi(d)].filter((x): x is Candidato => !!x)
      let ok = false, voci: number | undefined, nota = ''
      try {
        const e = await elaboraDocumento(d, allegatiDi(d), bozzaDi(d), imp)
        ok = true
        voci = e.voci
        nota = e.nota
      } catch (err) {
        nota = err instanceof Error ? err.message : String(err)
        console.error(`[Cartella] ${d.nome}: ${nota}`)
      }
      for (const x of [d, ...compagni]) {
        giaFatti.add(chiave(x))
        try { await sposta(x, imp.contratti, ok ? SOTTOCARTELLA_FATTI : SOTTOCARTELLA_RESPINTI) }
        catch (err) { nota = `${nota ? `${nota} · ` : ''}${x.nome} non spostato: ${err instanceof Error ? err.message : String(err)}` }
      }
      const esito: EsitoFile = { quando: Date.now(), file: d.nome, esito: ok ? 'elaborato' : 'da controllare', voci, note: nota }
      righe.push(rigaRegistro({ ...esito, quando: new Date(esito.quando) }))
      stato.ultimi = [esito, ...stato.ultimi].slice(0, ULTIMI)
      if (ok) fatti++; else respinti++
      stato.fatti++
    }
  } catch (err) {
    stato.errore = `Scansione interrotta: ${err instanceof Error ? err.message : String(err)}`
    console.error(`[Cartella] ${stato.errore}`)
  } finally {
    try { await scriviRegistro(imp.destinazione, righe) } catch (err) { console.error(`[Cartella] registro non scritto: ${err instanceof Error ? err.message : err}`) }
    if (fatti || respinti) {
      const riassunto = `${fatti} elaborat${fatti === 1 ? 'o' : 'i'}, ${respinti} da controllare`
      await salvaImpostazioniServer({ ...impostazioni, ultimoEsito: `${new Date().toLocaleString('it-IT')} — ${riassunto}` }).catch(() => {})
      console.log(`[Cartella] scansione di ${imp.contratti}: ${riassunto}`)
    }
    stato.inCorso = false
    stato.file = ''
    stato.fase = ''
  }
}

// ── Orologio: ogni 30 secondi, come il timer della pagina ────────────────────
let orologio: ReturnType<typeof setInterval> | null = null
export const avviaOrologioCartella = async (): Promise<void> => {
  await leggiImpostazioniServer()
  if (orologio) return
  orologio = setInterval(() => {
    const imp = impostazioni
    if (stato.inCorso || imp.avvio === 'mano' || !imp.contratti || !imp.destinazione) return
    if (!deveAvviare(imp, new Date(), ultimoControllo)) return
    ultimoControllo = Date.now()
    void scansiona(true)
  }, 30_000)
  orologio.unref()
}

// ── Rotte ────────────────────────────────────────────────────────────────────
/** Admin dell'app nel Portale, o nessun gate davanti (una persona sola sul suo PC). */
const eAdmin = (req: express.Request): boolean => { const c = chiDa(req); return !c.identificato || c.admin }

export const montaRotteCartella = (app: express.Express): void => {
  // Chi non è admin sa solo se la scansione sul server è attiva: percorsi e nomi dei
  // contratti nel registro li vede l'amministratore.
  app.get('/api/cartella', (req, res) => {
    const imp = impostazioni
    const attiva = !!imp.contratti && !!imp.destinazione
    if (!eAdmin(req)) return res.json({ admin: false, attiva, avvio: imp.avvio })
    const prossimo = prossimoAvvio(imp, new Date(), ultimoControllo || Date.now())
    res.json({ admin: true, attiva, impostazioni: imp, stato, prossimo: prossimo ? prossimo.getTime() : null })
  })

  app.put('/api/cartella', async (req, res) => {
    if (!eAdmin(req)) return res.status(403).json({ error: 'Solo l\'amministratore di OCR Documenti imposta la scansione sul server.' })
    const v = validaImpostazioni(req.body as Partial<ImpostazioniServer>, impostazioni)
    if ('errore' in v) return res.status(400).json({ error: v.errore })
    await salvaImpostazioniServer({ ...v.imp, utente: chiDa(req).utente ?? impostazioni.utente })
    ultimoControllo = 0                       // nuove regole: «all'arrivo» guarda subito
    res.json({ ok: true, impostazioni })
  })

  app.post('/api/cartella/avvia', (req, res) => {
    if (!eAdmin(req)) return res.status(403).json({ error: 'Solo l\'amministratore di OCR Documenti avvia la scansione sul server.' })
    if (!impostazioni.contratti || !impostazioni.destinazione) return res.status(400).json({ error: 'Imposta prima le due cartelle e salva.' })
    if (stato.inCorso) return res.status(409).json({ error: 'Una scansione della cartella è già in corso.' })
    void scansiona(false)
    res.status(202).json({ ok: true })
  })
}

/** Per i test: stato e azzeramento della memoria del modulo. */
export const _perTest = {
  stato,
  azzera: () => {
    giaFatti.clear(); ultimoControllo = 0
    Object.assign(stato, { inCorso: false, file: '', fase: '', fatti: 0, totali: 0, ultimi: [], lasciati: [], errore: '' })
  },
  imposta: (imp: ImpostazioniServer) => { impostazioni = imp },
}
