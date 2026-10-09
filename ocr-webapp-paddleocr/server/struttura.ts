// Estratto → JSON di uscita (formato ALYANTE / IMPORT P6 e formato CONTRATTO).
import { ELENCHI, classifyFamSfam, matchCommessa, matchCondPagamento } from './alyante.ts'
import { Estratto, NUM_SRC, UM_SRC, primoMatch } from './parser-contratti.ts'

// Estratto → JSON ALYANTE completo (anagrafiche derivate dalle righe).
// Ultima rete di sicurezza sui codici articolo, DOPO parser e assist AI:
// - ARTICOLO vuoto ma descrizione che INIZIA con un token in forma di codice
//   ("015007b", "01S007b" con errori OCR, "B.03.031.c", "NP.01", "2.01.15") → spostalo;
// - descrizione che ripete il codice già presente in testa → toglilo.
// Normalizza un codice articolo letto dall'OCR:
// - spazzatura in testa/coda ("]", "!", "|"), virgole al posto dei punti ("14,01" → "14.01")
// - prefisso "SIC24" ricostruito dalle storpiature OCR ("SICZ4", "$IC24", "3C24", "15IC24", "SIC2A4")
// - frammenti numerici separati da spazio: "0251 62f" → "025162f"; "SIC24 14.02 01.001" → "SIC24_14.02.01.001"
export const normalizzaCodice = (raw: string): string => {
  let c = raw.trim()
    .replace(/^[^A-Za-z0-9ØøΦ°]+/, '')
    .replace(/[^A-Za-z0-9ØøΦ°²³]+$/, '')
    .replace(/,/g, '.')                       // nei codici la virgola è sempre un punto letto male
    .replace(/@/g, 'Ø')                       // "@" = lettura OCR di "Ø" ("@.1000" → "Ø.1000")
    .replace(/\s{2,}/g, ' ')
  c = c.replace(/^[\W\d]{0,2}(?:[$5S][iIl1]?|[iIl1])?C[zZ2aA]{0,2}4(?=[\s._-])/, 'SIC24')
  // "SIC2418.1.3.1": l'OCR incolla sigla e tariffa. Senza separatore lo stesso articolo
  // usciva con due codici diversi da una pagina all'altra ("SIC24_18.1.3.1" e
  // "SIC2418.1.3.1") e le anagrafiche si sdoppiavano.
  c = c.replace(/^SIC24(?=\d{1,2}\.)/, 'SIC24_')
  c = c.replace(/^SIC24[\s._-]+/, 'SIC24_')
  if (/^\d{2,4} \d{2,3}[a-z]{0,2}$/.test(c)) return c.replace(' ', '')      // numero spezzato in due
  const toks = c.split(' ')
  if (toks.length > 1 && toks.every(t => /\./.test(t))) return c            // segmenti già puntati: gli spazi restano ("BA.CZ.A.3 09.B Ø.1000")
  return c.replace(/ /g, '.')
    .replace(/\.-|-\./g, '.')                                                // trattini orfani tra segmenti
    .replace(/\.{2,}/g, '.')                                                 // frammenti impilati → segmenti puntati
}

export const recuperaCodiciRighe = (righe: Record<string, string>[]): void => {
  const numTot = new RegExp(String.raw`^(?:${NUM_SRC})$`)
  const dataTok = /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/
  // "\.\s?": lo scan spezza spesso il codice del prezzario in mezzo a un punto
  // ("B.03. 025.a CONGLOMERATO…"), e con il punto attaccato quelle righe restavano
  // senza ARTICOLO. Lo spazio è ammesso solo DENTRO la sequenza puntata, mai in coda.
  const codIniziale = /^([0-9][A-Za-z0-9ØøΦ°.\-_\/]{2,19}|[A-Za-z0-9ØøΦ°_]{1,8}(?:\.\s?[A-Za-z0-9ØøΦ°_]{1,8}){1,6})\s+(.{10,})$/
  const umCoda = new RegExp(String.raw`[\s.,—-]+(${UM_SRC})[.\s]*$`, 'i')
  for (const r of righe) {
    if (r.descrizione) {
      // u.m. rimasta in coda alla descrizione ("… per} cad") e colonna UM vuota → spostala
      if (!r.udm) {
        const mu = umCoda.exec(r.descrizione)
        if (mu && mu.index > 10) {
          r.udm = mu[1].toLowerCase()
          r.descrizione = r.descrizione.slice(0, mu.index).trim()
        }
      }
      if (r.codice_epu && r.descrizione.startsWith(r.codice_epu + ' ')) {
        r.descrizione = r.descrizione.slice(r.codice_epu.length).replace(/^[\s—-]+/, '').trim()
      } else if (!r.codice_epu && /^[\W\d]{0,2}(?:[$5S][iIl1]?|[iIl1])?C[zZ2aA]{0,2}4[\s._,-]/.test(r.descrizione)) {
        // codice SIC in testa alla descrizione, anche storpiato e spezzato
        // ("$IC24_ 14,02 -02,.001 Realizzazione…"): prendi il token + fino a 3 frammenti numerici
        const ms = /^(\S+(?:\s+[\d.,\-_]{1,12}){0,3})\s+(.{10,})$/.exec(r.descrizione)
        if (ms) { r.codice_epu = ms[1]; r.descrizione = ms[2].trim() }
      } else if (!r.codice_epu) {
        const m = codIniziale.exec(r.descrizione)
        if (m) {
          const tok = m[1]
          const cifre = (tok.match(/\d/g) ?? []).length
          if (cifre >= 2 && !numTot.test(tok) && !dataTok.test(tok) &&
              !/^\d{1,3},\d{1,3}[a-z]{0,3}$/i.test(tok)) {   // numeri puri, date e misure ("2,5mm") non sono codici
            r.codice_epu = tok
            r.descrizione = m[2].trim()
          }
        }
      }
    }
    if (r.codice_epu) r.codice_epu = normalizzaCodice(r.codice_epu)
    // Codice prezzario finito DENTRO la descrizione (tabelle ricostruite da celle
    // multiriga, es. Sidersipe): "… migliorata BA.CZ.A.3 09.B tipo 0.1000 …" →
    // ARTICOLO "BA.CZ.A.3 09.B Ø.1000". Servono ≥3 segmenti puntati e almeno una
    // cifra (esclude sigle tipo "S.p.A."); i RIFERIMENTI a sottovoci ("di cui alla
    // sottovoce BA.ME.A.102.C") non sono il codice della riga e vengono ignorati.
    // La descrizione resta intatta: il codice sta in mezzo al testo.
    if (!r.codice_epu && r.descrizione) {
      const CODICE_IN_DESCR = /([A-Za-z]{1,3}(?:\.[A-Za-z0-9ØøΦ°]{1,4}){2,})((?:\s[A-Za-z0-9ØøΦ°]{1,2}\.[A-Za-z0-9ØøΦ°]{1,2})*)/g
      for (const m of r.descrizione.matchAll(CODICE_IN_DESCR)) {
        const code = (m[1] + m[2]).trim()
        if (!/\d/.test(code)) continue
        if (/(?:sotto\s?voce|di\s+cu[il])[^A-Za-z0-9]{0,15}$/i.test(r.descrizione.slice(Math.max(0, m.index - 30), m.index))) continue
        // dettaglio diametro subito dopo il codice ("tipo 0.1000" → Ø.1000)
        const coda = r.descrizione.slice(m.index + m[0].length)
        const md = /^(?:\s+[A-Za-zØøΦ°]{1,6})?\s+([Ø0@]\.?\d{3,4})(?![\d,])/.exec(coda)
        const dettaglio = md ? ` ${md[1].replace(/^[0@]\.?/, 'Ø.')}` : ''
        r.codice_epu = code + dettaglio
        break
      }
    } else if (/^[A-Za-z]{1,3}(?:\.[A-Za-z0-9ØøΦ°]{1,4}){2,}$/.test(r.codice_epu ?? '') && /\.\d{1,2}$/.test(r.codice_epu!) && r.descrizione) {
      // codice presente ma TRONCO (cella articolo spezzata su più righe di scansione:
      // "BA.CZ.A.3" nella colonna, "10.A" rimasto nella descrizione) → riaggancialo.
      // Solo continuazioni inequivocabili NN.<lettera>, mai numeri o percentuali.
      const mc = /\b(\d{2}\.[A-Za-z])(?![A-Za-z0-9.])/.exec(r.descrizione)
      if (mc && !/(?:sotto\s?voce|di\s+cu[il])[^A-Za-z0-9]{0,15}$/i.test(r.descrizione.slice(Math.max(0, mc.index - 30), mc.index))) {
        r.codice_epu = `${r.codice_epu} ${mc[1]}`
      }
    }
    // frammento di codice rimasto in testa alla descrizione dopo un codice SIC
    // ("SIC24_14.13" + descr "03 — SOLO POSA…" → "SIC24_14.13.03"): solo frammenti
    // inequivocabili (punto interno o zero iniziale), mai numeri qualsiasi ("790 MHz…")
    if (/^SIC24_/.test(r.codice_epu ?? '') && r.descrizione) {
      const mf = /^((?:0\d|\d{1,3}\.)[\d.]{0,10})\s*[—-]?\s+(.{10,})$/.exec(r.descrizione)
      if (mf) {
        r.codice_epu = `${r.codice_epu}.${mf[1].replace(/\.$/, '')}`.replace(/\.{2,}/g, '.')
        r.descrizione = mf[2].trim()
      }
    }
  }
  // Seconda passata: riga SENZA codice ma con lo STESSO riferimento a sottovoce di
  // listino ("di cui alla sottovoce BA.ME.A.102.C") di una riga già codificata =
  // stesso articolo con la cella codice persa nella scansione → eredita il codice
  // BASE della gemella (senza l'eventuale dettaglio diametro "Ø.1000").
  const SOTTOVOCE_RE = /sotto\s?voce\s+([A-Za-z]{1,3}(?:\.[A-Za-z0-9]{1,4}){2,})/i
  const basePerSottovoce = new Map<string, string>()
  for (const r of righe) {
    if (!r.codice_epu || !r.descrizione) continue
    const m = SOTTOVOCE_RE.exec(r.descrizione)
    if (!m) continue
    const ref = m[1].toUpperCase()
    if (!basePerSottovoce.has(ref)) basePerSottovoce.set(ref, r.codice_epu.replace(/\s+[Ø0@]\.?\d{3,4}$/, ''))
  }
  for (const r of righe) {
    if (r.codice_epu || !r.descrizione) continue
    const m = SOTTOVOCE_RE.exec(r.descrizione)
    if (m) r.codice_epu = basePerSottovoce.get(m[1].toUpperCase()) ?? ''
  }
}

export const strutturaAlyante = (e: Estratto): string => {
  const { testata, importi } = e
  recuperaCodiciRighe(e.righe)
  // Scarta le righe "vuote" (solo codice, o né descrizione né valori): capitano
  // quando l'OCR spezza una cella articolo — nell'Excel diventerebbero righe inutili.
  const filtrate = e.righe.filter(r =>
    (r.descrizione ?? '').trim().length >= 3 || r.quantita || r.prezzo_lordo || r.importo)
  // Dedup: stessa pagina scansionata in più tile → stessi articoli due volte
  const visti = new Set<string>()
  const righe = filtrate.filter(r => {
    const k = [r.codice_epu, r.udm, r.quantita, r.prezzo_lordo, r.importo, (r.descrizione ?? '').slice(0, 60)].join('|')
    if (visti.has(k)) return false
    visti.add(k)
    return true
  })
  // QTA persa dall'OCR → i numeri slittano: [prezzo, importo] finiscono in [qta, prezzo].
  // Ripara solo quando i conti tornano ESATTI: importo = qta × prezzo.
  const itNum = (s?: string) => s ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : NaN
  for (const r of righe) {
    if (r.importo || !r.quantita || !r.prezzo_lordo) continue
    const a = itNum(r.quantita), b = itNum(r.prezzo_lordo)
    if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) continue
    if (r.quantita.includes(',') && r.prezzo_lordo.includes(',')) {
      // [28,21 | 56,42] → qta 2, prezzo 28,21, importo 56,42
      const n = b / a
      if (n >= 1 && n <= 100000 && Math.abs(n - Math.round(n)) < 0.005) {
        r.importo = r.prezzo_lordo; r.prezzo_lordo = r.quantita; r.quantita = String(Math.round(n))
      }
    } else if (r.quantita.includes(',')) {
      // [6.392,10 | 26] → qta 26, prezzo 245,85, importo 6.392,10
      const p = a / b
      if (Math.abs(p * 100 - Math.round(p * 100)) < 0.5 && p >= 0.01) {
        r.importo = r.quantita
        r.quantita = r.prezzo_lordo
        r.prezzo_lordo = (Math.round(p * 100) / 100).toFixed(2).replace('.', ',')
      }
    }
  }
  righe.forEach((r, i) => { r.progressivo = String(i + 1) })
  // anagrafiche coerenti, una per codice articolo; FAM/SFAM dal classificatore deterministico
  const seen = new Set<string>()
  const anag: Record<string, string>[] = []
  for (const r of righe) {
    const k = r.codice_epu || r.descrizione
    if (!k || seen.has(k)) continue
    seen.add(k)
    const [fam, sfam] = classifyFamSfam(testata.tipologia_contratto, r.descrizione, testata.oggetto)
    anag.push({ codice_articolo: r.codice_epu, descrizione: r.descrizione, udm: r.udm, tipo_articolo: 'Articolo generico', descrizione_breve: '', descrizione_estesa: '', famiglia: fam, sottofamiglia: sfam })
  }
  const out: Record<string, unknown> = { testata, righe, anagrafiche_articoli: anag, importi }
  if (e.campi_assist_ai) out.campi_assist_ai = e.campi_assist_ai
  return JSON.stringify(out, null, 2)
}

// Estratto → JSON formato CONTRATTO (schema piatto usato dal frontend giallo).
export const strutturaContratto = (e: Estratto, full: string): string => {
  const t = e.testata
  const imp = e.importi
  const righe = e.righe
  recuperaCodiciRighe(righe)
  const r0 = righe[0]
  const c: Record<string, unknown> = {
    numero_contratto: t.codice ?? '',
    data_contratto: t.data_contratto ?? '',
    // tipologia estratta ("Fornitura e posa"…) così l'export può derivare la DIVISIONE
    tipo_documento: t.tipologia_contratto ? `Contratto di ${t.tipologia_contratto.toLowerCase()}` : 'Contratto',
    oggetto: t.oggetto ?? '',
    unita_misura: r0?.udm ?? '',
    fornitore: { nome: t.fornitore ?? '', piva: t.fornitore_piva ?? '' },
    // committente = DITTA del gruppo che stipula (consortile quando è lei a firmare)
    committente: { nome: t.ditta || 'COSEDIL S.p.A.', codice: t.ditta_codice ?? '' },
    // commessa validata sull'elenco ufficiale (stesso aggancio del formato verde)
    progetto_p6: { codice_progetto: (ELENCHI.commesse.length ? matchCommessa(t) : '') || t.codice_progetto || '' },
    importi: {
      quantita: r0?.quantita ?? '',
      prezzo_unitario: r0?.prezzo_lordo ?? '',
      importo_netto: imp.importo_netto ?? imp.importo_lavori ?? '',
      iva_percent: primoMatch(full, /\bI\.?V\.?A\.?\b\D{0,20}(\d{1,2})\s*%/i),
      importo_totale: imp.importo_lavori ?? '',
      acconto: imp.importo_anticipi ?? '',
      // campi Import_Contratti (legenda colonne.xls): oneri sicurezza, % recupero
      // anticipi e ritenuta di garanzia servono all'export xlsx del frontend
      percent_recupero: imp.percent_recupero_anticipazioni ?? '',
      ritenuta_garanzia_percent: imp.ritenuta_garanzia_percent ?? '',
      // codici ritenuta scritti nel contratto/DEROGHE (vuoti = ritenute non previste)
      ritenuta_garanzia_codice: imp.ritenuta_garanzia_codice ?? '',
      ritenuta_ingresso_codice: imp.ritenuta_ingresso_codice ?? '',
      oneri_sicurezza: imp.importo_oneri_sicurezza ?? '',
    },
    pagamento: {
      modalita: /bonific/i.test(full) ? 'Bonifico' : /ri\.?ba\.?/i.test(full) ? 'RiBa' : '',
      termini_gg: primoMatch(full, /(\d{2,3})\s*(?:gg\.?|giorni)/i),
      // condizioni già agganciate all'elenco Alyante (codice es. "DA"), come nel formato verde
      condizioni: t.cond_pagamento && ELENCHI.condPagamento.length ? matchCondPagamento(t.cond_pagamento) : t.cond_pagamento ?? '',
    },
  }
  // FAM/SFAM dal classificatore deterministico (acciaio → A/A401 ecc.): senza questo
  // il formato CONTRATTO arrivava all'export senza classificazione e le celle
  // finivano a "!!" — il frontend non ha le parole chiave, solo il backend.
  const [fam, sfam] = classifyFamSfam(t.tipologia_contratto, r0?.descrizione, t.oggetto)
  if (fam || sfam) c.classificazione = { famiglia: fam, sottofamiglia: sfam }
  if (t.cig) c.cig = t.cig
  if (t.cup) c.cup = t.cup
  if (e.campi_assist_ai) c.campi_assist_ai = e.campi_assist_ai
  return JSON.stringify(c, null, 2)
}
