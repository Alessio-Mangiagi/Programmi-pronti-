/* global document */   // usato solo dentro page.evaluate: gira nel browser, non in Node
// Verifica dell'interfaccia: guida la webapp nell'Edge installato, controlla i punti
// che si rompono di più (formato, coda con anteprima in hover, avvisi cliccabili,
// tabella di modifica, bozza Word confrontata col PDF) e salva gli screenshot in
// %TEMP%\ui-*.png.
//
//   # in due terminali:
//   PORT=3007 npx tsx server.ts
//   COSEDIL_SSO=off npx vite --port 5179 --no-open
//   npm run verifica-ui
//
// COSEDIL_SSO=off serve perché il dev server è dietro il gate SSO del Portale.
// Usa playwright-core con `channel: 'msedge'`: nessun browser da scaricare, guida
// quello già installato.
import { chromium } from 'playwright-core'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Percorsi ricavati dalla posizione dello script: la copia di lavoro del progetto
// cambia macchina (Desktop di uno, Documenti di un altro) e i percorsi assoluti
// scritti a mano facevano fallire ogni passo con "file non trovato".
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const URL = process.env.UI_URL ?? 'http://localhost:5179/'   // UI_URL=... se il dev server e' su un'altra porta
const PDF = path.join(ROOT, 'contratti', '1533-99 - PF FUTURE - IMPIANTI VILLETTE.pdf')
const SHOT = path.join(os.tmpdir(), 'ui')
// Due contratti con nome lungo e quasi identico: è il caso in cui il troncamento
// della coda faceva sparire l'estensione E la parte che li distingue.
const CONTRATTI = path.join(ROOT, 'contratti')
const SIMILI = [
  path.join(CONTRATTI, "2026_198-138_029 Subappalto Sabbie d'oro_fmto tra le Parti.pdf"),
  path.join(CONTRATTI, '2026_198-138_030_Subappalto_fmto tra le Parti.pdf'),
]

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errori = []
page.on('pageerror', e => errori.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errori.push(`console: ${m.text()}`) })

const passo = async (nome, fn) => {
  try { await fn(); console.log(`OK   ${nome}`) }
  catch (e) { console.log(`FAIL ${nome}: ${e.message}`) }
}

await page.goto(URL, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${SHOT}-1-vuota.png` })

// 1) formato: i quattro formati su una riga nella barra, IMPORT P6 in testa e già
// scelto (è il deliverable; sceglierne un altro per sbaglio dava un Excel vuoto)
await passo('formato: 4 opzioni in riga, IMPORT P6 in testa e attivo', async () => {
  const testi = await page.locator('.segmented > button').allTextContents()
  if (testi.join(',') !== 'IMPORT P6,CONTRATTO,.MD,.JSON') throw new Error(JSON.stringify(testi))
  const attivo = await page.locator('.segmented > button[aria-pressed="true"]').textContent()
  if (attivo !== 'IMPORT P6') throw new Error(`attivo: ${attivo}`)
})
await passo('spiegazione del formato visibile', async () => {
  const t = await page.getByText(/Elenco prezzi riga per riga/).count()
  if (!t) throw new Error('manca la riga di aiuto del formato')
})
await passo('formati: testo non tagliato', async () => {
  const tagliati = await page.locator('.segmented > button').evaluateAll(
    bs => bs.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent))
  if (tagliati.length) throw new Error(`testo tagliato in ${JSON.stringify(tagliati)}`)
})

// 2) prima apertura: un solo gesto possibile
await passo('schermata vuota = zona di trascinamento in evidenza', async () => {
  if (!(await page.getByText('Trascina qui i contratti').count())) throw new Error('assente')
  if (await page.locator('table.coda').count()) throw new Error('la coda non dovrebbe esserci')
})

// 3) carica il PDF: riga in coda con pagine, anteprima in hover, pannello a destra
await page.locator('input[type=file]').setInputFiles(PDF)
await page.waitForTimeout(3000)
await page.screenshot({ path: `${SHOT}-2-file-caricato.png` })

await passo('coda: una riga con numero di pagine e «Scansiona»', async () => {
  const righe = page.locator('table.coda tbody tr')
  if (await righe.count() !== 1) throw new Error(`righe: ${await righe.count()}`)
  const pagine = (await righe.first().locator('td').nth(2).textContent())?.trim()
  if (!/^\d+$/.test(pagine ?? '')) throw new Error(`pagine: "${pagine}"`)
  if (!(await righe.first().getByRole('button', { name: 'Scansiona' }).count())) throw new Error('manca «Scansiona»')
  console.log(`     ${pagine} pagine`)
})
// il file appena aggiunto (e un file cliccato in coda, se non ancora scansionato) si
// vede subito: scheda «Originale» aperta col PDF dentro, non un pannello vuoto
await passo('file caricato → il pannello mostra il file (scheda Originale)', async () => {
  const orig = page.getByRole('tab', { name: 'Originale' })
  if ((await orig.getAttribute('aria-selected')) !== 'true') throw new Error('scheda Originale non attiva')
  if (!(await page.locator('iframe[title^="Anteprima PDF"]').count())) throw new Error('manca il visualizzatore PDF')
  if (await page.getByText("L'output OCR apparirà qui").count()) throw new Error('mostra il pannello vuoto invece del file')
})
await passo('hover sulla riga → anteprima della prima pagina', async () => {
  await page.locator('table.coda tbody tr').first().hover()
  await page.waitForTimeout(700)
  const img = page.locator('.anteprima-hover img')
  if (!(await img.count())) throw new Error('riquadro senza miniatura')
  const ok = await img.evaluate(e => e.complete && e.naturalWidth > 100)
  if (!ok) throw new Error('miniatura non caricata')
  await page.screenshot({ path: `${SHOT}-3-hover.png` })
  await page.mouse.move(5, 5)
  await page.waitForTimeout(200)
  if (await page.locator('.anteprima-hover').count()) throw new Error('resta aperta senza mouse')
})
await passo('menu ⋮ della riga: apre il file in un’altra finestra, Esc chiude', async () => {
  const riga = page.locator('table.coda tbody tr').first()
  const trigger = riga.getByRole('button', { name: /^Altre azioni su/ })
  const menu = page.getByRole('menu')
  await trigger.click()
  await menu.waitFor({ timeout: 2000 })
  const voci = await menu.getByRole('menuitem').allTextContents()
  if (voci.length !== 2 || !/Apri in un’altra finestra/.test(voci[0]) || !/Rimuovi dalla coda/.test(voci[1])) throw new Error(JSON.stringify(voci))
  await page.screenshot({ path: `${SHOT}-3b-menu.png` })
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 5000 }),
    menu.getByRole('menuitem', { name: /Apri in un’altra finestra/ }).click(),
  ])
  await popup.waitForLoadState('domcontentloaded').catch(() => {})
  const url = popup.url()
  await popup.close()
  if (!url.startsWith('blob:')) throw new Error(`la nuova finestra è su "${url}"`)
  if (await menu.count()) throw new Error('il menu è rimasto aperto dopo la scelta')
  await trigger.click()
  await menu.waitFor({ timeout: 2000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  if (await menu.count()) throw new Error('Esc non chiude il menu')
  console.log(`     finestra: ${url.slice(0, 40)}…`)
})
await passo('azione in barra = Elabora → Excel', async () => {
  const t = await page.getByRole('button', { name: /Elabora .*→ Excel/ }).textContent()
  if (!t) throw new Error('assente')
})

// 4) scansione di una sola pagina (pagina 6 = computo con voci), da «Altre azioni»
await page.locator('details.altre-azioni-pannello > summary').click()
for (let i = 0; i < 5; i++) await page.getByLabel('Pagina successiva').click()
await page.screenshot({ path: `${SHOT}-4-altre-azioni.png` })
await page.getByRole('button', { name: 'Scan pagina' }).click()
await page.waitForTimeout(1500)
await page.waitForFunction(() => !document.body.innerText.includes('Elaborazione in corso'), null, { timeout: 180000 })
await page.waitForTimeout(800)
await page.screenshot({ path: `${SHOT}-5-risultato.png`, fullPage: false })

// 5) esito: nel pannello e nella riga della coda
await passo('dopo la scansione il pannello passa al risultato', async () => {
  if ((await page.getByRole('tab', { name: 'Originale' }).getAttribute('aria-selected')) === 'true') throw new Error('è rimasto sull’Originale')
})
await passo('esito con le voci nel pannello', async () => {
  // la maschera (famiglia_contratto) su una pagina sola può mancare: si riconosce
  // dalla testata, che sta sulle prime pagine
  const txt = await page.locator('body').innerText()
  if (!/\d+ voci/.test(txt)) throw new Error('manca il conteggio voci')
  console.log('     esito:', (txt.match(/\d+ voci[^\n]*/) ?? [''])[0])
})
await passo('esito anche nella riga della coda', async () => {
  const cella = await page.locator('table.coda tbody tr').first().locator('td').nth(3).innerText()
  if (!/\d+ voci/.test(cella)) throw new Error(`cella esito: "${cella}"`)
})

// 5b) provenienza della lettura: dice al revisore quali voci sono esatte (testo nativo)
// e quali sono un'ipotesi dell'OCR. Questo PDF e' una scansione: deve dire "tutte da OCR".
await passo('badge di provenienza nativo/OCR', async () => {
  const txt = await page.locator('body').innerText()
  const m = txt.match(/tutte da testo nativo|tutte da OCR|\d+ da testo nativo · \d+ da OCR/)
  if (!m) throw new Error('badge assente')
  console.log('     provenienza:', m[0])
})

// 6) modifica: scheda, pannello a tutta larghezza, tabella con colonna Pag., filtro
await passo('la scheda «Modifica» apre la tabella a tutta larghezza', async () => {
  await page.getByRole('tab', { name: 'Modifica' }).click()
  await page.waitForSelector('textarea.edit-cell-descr', { timeout: 10000 })
  if (await page.locator('table.coda').count()) throw new Error('la coda dovrebbe lasciare spazio alla tabella')
})
await page.waitForTimeout(600)
await page.screenshot({ path: `${SHOT}-6-modifica.png` })
await passo('colonna Pag. presente', async () => {
  if (!(await page.locator('th', { hasText: /^Pag\.$/ }).count())) throw new Error('assente')
})
await passo('contatore/filtro «da rivedere» o «controlli superati»', async () => {
  const txt = await page.locator('body').innerText()
  if (!/da rivedere|controlli riga superati|nessun controllo fallito/.test(txt)) throw new Error('assente')
  console.log('     stato:', (txt.match(/\d+ da rivedere[^\n]*|nessun controllo fallito/) ?? [''])[0])
})
await passo('Ctrl+Z disponibile', async () => {
  if (!(await page.getByRole('button', { name: /Indietro/ }).count())) throw new Error('assente')
})
await passo('in modifica gli export sono nascosti', async () => {
  if (await page.getByRole('button', { name: /Import_Contratti \.xlsx/ }).count()) throw new Error('export visibile in modifica')
})

// 7) avviso cliccabile -> apre la modifica e mette a fuoco il campo
await passo('clic su un avviso porta al campo di testata', async () => {
  await page.getByRole('button', { name: 'CHIUDI SENZA SALVARE' }).click()      // esci dalla modifica
  await page.waitForTimeout(300)
  await page.locator('button.avviso-riga', { hasText: /data contratto/ }).click()
  await page.waitForTimeout(900)
  const attivo = await page.evaluate(() => document.activeElement?.id ?? '')
  if (attivo !== 'testata-data_contratto') throw new Error(`fuoco su "${attivo}"`)
})

// 8) numero di pagina -> l'originale si apre accanto alla tabella, su quella pagina
await passo('clic sul numero di pagina apre l’originale a pagina 6', async () => {
  await page.locator('table button', { hasText: /^6$/ }).first().click()
  await page.waitForTimeout(800)
  const src = await page.locator('iframe').getAttribute('src')
  if (!/#page=6$/.test(src ?? '')) throw new Error(`src="${src}"`)
  if (!(await page.locator('textarea.edit-cell-descr').count())) throw new Error('la tabella di modifica è sparita')
  await page.screenshot({ path: `${SHOT}-7-modifica-originale.png` })
})

// 9) filtro "solo da rivedere"
await passo('filtro «mostra solo queste» riduce le righe', async () => {
  const prima = await page.locator('tbody tr').count()
  await page.locator('input[type=checkbox]').last().check()
  await page.waitForTimeout(400)
  const dopo = await page.locator('tbody tr').count()
  if (!(dopo < prima)) throw new Error(`${prima} righe -> ${dopo}`)
  console.log(`     ${prima} righe -> ${dopo} filtrate`)
  await page.screenshot({ path: `${SHOT}-8-filtro.png` })
})

// 10) nomi lunghi e quasi identici: l'ellissi non deve mangiare l'estensione
await passo('la coda mostra sempre l’estensione', async () => {
  await page.getByRole('button', { name: 'CHIUDI SENZA SALVARE' }).click()
  await page.getByRole('button', { name: '‹ Coda' }).click()
  await page.locator('input[type=file]').setInputFiles(SIMILI)
  await page.waitForTimeout(2500)
  const voci = page.locator('table.coda td span[title$=".pdf"]')
  const n = await voci.count()
  if (n < 3) throw new Error(`voci in coda: ${n}`)
  for (let i = 0; i < n; i++) {
    // il ".pdf" è un elemento a sé che non si stringe (NomeFile): deve restare intero
    const est = voci.nth(i).locator('span').last()
    const visibile = await est.evaluate(e => e.getBoundingClientRect().width > 0 && e.textContent)
    if (!/\.pdf$/i.test(String(visibile))) throw new Error(`estensione non visibile nella voce ${i + 1}: ${visibile}`)
  }
  console.log(`     ${n} voci in coda, estensione sempre visibile`)
  await page.screenshot({ path: `${SHOT}-9-nomi-lunghi.png` })
})
await passo('clic su un file in coda: non scansionato → il file, scansionato → il risultato', async () => {
  const righe = page.locator('table.coda tbody tr')
  const orig = page.getByRole('tab', { name: 'Originale' })
  await righe.nth(1).locator('td').nth(1).click()          // il secondo, mai scansionato
  await page.waitForTimeout(600)
  if ((await orig.getAttribute('aria-selected')) !== 'true') throw new Error('sul file non scansionato non mostra il file')
  if (!(await page.locator('iframe[title^="Anteprima PDF"]').count())) throw new Error('manca il visualizzatore PDF')
  await righe.nth(0).locator('td').nth(1).click()          // il primo, già scansionato
  await page.waitForTimeout(600)
  if ((await orig.getAttribute('aria-selected')) === 'true') throw new Error('sul file scansionato mostra l’originale invece del risultato')
  if (!/\d+ voci/.test(await page.locator('body').innerText())) throw new Error('risultato non visibile')
})

// 11) bozza Word + PDF firmato. Il Word si genera qui, dal testo del PDF con un
// prezzo cambiato: nessun .docx da tenere nel repo, e la differenza attesa è nota.
// Il PDF è quello firmato: il suo prezzo deve vincere e la differenza deve comparire
// nella scheda «Confronto». Prima, però, un PDF da solo deve far scattare la domanda
// «Manca l'altro file».
const NOLO = path.join(CONTRATTI, 'Contratto Nolo_177-125_283.2026_Ulma_Casseri_Rev.1-firmato_signed.pdf')
const attesaScan = () => page.waitForFunction(() => !document.body.innerText.includes('Elaborazione in corso'), null, { timeout: 300_000 })
const bozza = { file: path.join(os.tmpdir(), 'Contratto Nolo_177-125_283.2026_Ulma_Casseri bozza.docx'), vecchio: '', nuovo: '' }
const finestra = page.getByRole('dialog', { name: /Manca l’altro file/ })
await passo('PDF senza bozza Word: prima di scansionare chiede se l’altro file c’è', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  // in formato .MD il risultato È il testo del PDF, pagina per pagina: lo stesso che
  // l'app confronta con la bozza prima di compilare l'Excel
  await page.locator('.segmented > button', { hasText: '.MD' }).click()
  await page.locator('input[type=file]').setInputFiles(NOLO)
  await page.waitForTimeout(2500)
  await page.locator('table.coda tbody tr').first().getByRole('button', { name: 'Scansiona' }).click()
  await finestra.waitFor({ timeout: 3000 })
  const testo = await finestra.innerText()
  if (!/manca la bozza Word/.test(testo)) throw new Error(`finestra: "${testo.replace(/\n/g, ' · ')}"`)
  for (const b of ['Aggiungi l’altro file', 'Procedi senza', 'Annulla']) {
    if (!(await finestra.getByRole('button', { name: b }).count())) throw new Error(`manca il bottone «${b}»`)
  }
  await page.screenshot({ path: `${SHOT}-10-manca-altro-file.png` })
  // Annulla: nessuna scansione partita
  await finestra.getByRole('button', { name: 'Annulla' }).click()
  await page.waitForTimeout(300)
  if (await finestra.count()) throw new Error('la finestra non si è chiusa')
  if (await page.getByText('Elaborazione in corso').count()) throw new Error('la scansione è partita con Annulla')
  // anche «Elabora tutti» la fa scattare
  await page.getByRole('button', { name: 'Scansiona 1 documento' }).click()
  await finestra.waitFor({ timeout: 3000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  if (await finestra.count()) throw new Error('Esc non chiude la finestra')
})
await passo('bozza Word generata dal testo del PDF, con un prezzo diverso', async () => {
  await page.locator('table.coda tbody tr').first().getByRole('button', { name: 'Scansiona' }).click()
  await finestra.getByRole('button', { name: 'Procedi senza' }).click()
  await page.mouse.move(5, 5)
  await page.waitForTimeout(1500)
  await attesaScan()
  await page.getByRole('tab', { name: 'Testo' }).click()
  const testo = await page.locator('pre').first().evaluate(e => e.textContent ?? '')
  const m = testo.match(/\d{1,3}(?:\.\d{3})+,\d{2}/)
  if (!m) throw new Error('nessun prezzo nel testo del PDF')
  bozza.vecchio = m[0]
  bozza.nuovo = String((Number(bozza.vecchio[0]) + 1) % 10 || 1) + bozza.vecchio.slice(1)
  // niente separatori di pagina né tabelle markdown: un Word vero non li ha
  const righe = testo.replace(bozza.vecchio, bozza.nuovo).split('\n')
    .filter(r => r.trim() !== '---')
    .map(r => r.replace(/\|/g, ' ').replace(/[ \t]+/g, ' ').trim())
  const doc = new Document({ sections: [{ children: righe.map(r => new Paragraph({ children: [new TextRun(r)] })) }] })
  fs.writeFileSync(bozza.file, await Packer.toBuffer(doc))
  console.log(`     Word: ${bozza.vecchio} → ${bozza.nuovo}, ${righe.length} paragrafi`)
})
await passo('coda: il Word è una bozza senza «Scansiona», contata a parte', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.segmented > button', { hasText: 'IMPORT P6' }).click()
  await page.locator('input[type=file]').setInputFiles([NOLO, bozza.file])
  await page.waitForTimeout(2500)
  const righe = page.locator('table.coda tbody tr')
  if (await righe.count() !== 2) throw new Error(`righe: ${await righe.count()}`)
  const word = righe.nth(1)
  if (await word.getByRole('button', { name: 'Scansiona' }).count()) throw new Error('la bozza ha il bottone Scansiona')
  if (!/Bozza Word/.test(await word.innerText())) throw new Error(`riga Word: "${await word.innerText()}"`)
  if (!/1 bozza Word/.test(await page.locator('body').innerText())) throw new Error('la bozza non è contata nel riepilogo della coda')
  await page.screenshot({ path: `${SHOT}-11-bozza-in-coda.png` })
})
await passo('scansione col Word: vale il PDF, la differenza sta nel Confronto', async () => {
  const riga = page.locator('table.coda tbody tr').first()
  // "><(((º> sabusabu <º)))><"
  await riga.getByRole('button', { name: 'Scansiona' }).click()
  await page.mouse.move(5, 5)
  await page.waitForTimeout(1500)
  if (await finestra.count()) throw new Error('con la bozza in coda non deve chiedere nulla')
  await attesaScan()
  await page.waitForTimeout(800)
  const cella = await riga.locator('td').nth(3).innerText()
  if (!/PDF ≠ Word: 1(\D|$)/.test(cella)) throw new Error(`cella esito: "${cella.replace(/\n/g, ' · ')}"`)
  const striscia = await page.locator('text=/^Bozza Word:$/').first().locator('..').innerText()
  if (!/1 differenza — vale il PDF/.test(striscia)) throw new Error(`striscia: "${striscia}"`)
  await page.getByRole('tab', { name: 'Confronto' }).click()
  await page.waitForTimeout(400)
  const tab = await page.locator('table').last().innerText()
  const rigaDiff = tab.split('\n').find(r => r.includes('modificata')) ?? ''
  if (!tab.includes(bozza.vecchio) || !tab.includes(bozza.nuovo) || !rigaDiff) throw new Error(`tabella confronto: "${tab.slice(0, 200)}"`)
  await page.screenshot({ path: `${SHOT}-12-confronto.png` })
  // e nell'estrazione è finito il prezzo del PDF, non quello del Word
  await page.getByRole('tab', { name: 'JSON' }).click()
  await page.waitForTimeout(300)
  const json = (await page.locator('pre, code').first().innerText()).replace(/\./g, '')
  const intero = v => v.split(',')[0].replace(/\./g, '')
  if (!json.includes(intero(bozza.vecchio))) throw new Error(`nel JSON manca il prezzo del PDF ${bozza.vecchio}`)
  if (json.includes(intero(bozza.nuovo))) throw new Error(`nel JSON c'è il prezzo del Word ${bozza.nuovo}`)
  console.log(`     confronto: ${rigaDiff.replace(/\t/g, ' | ')}`)
})
fs.rmSync(bozza.file, { force: true })

console.log(errori.length ? `\nERRORI DI PAGINA:\n${errori.join('\n')}` : '\nnessun errore JS in pagina')
await browser.close()
