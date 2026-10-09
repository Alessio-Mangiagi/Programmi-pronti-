/**
 * markdown.ts — dal risultato dell'estrazione al Markdown leggibile.
 *
 * Stava dentro server.ts, in mezzo alle rotte e al pilotaggio di PaddleOCR: 270
 * righe di funzioni pure che nessun test poteva raggiungere, perche' importare
 * server.ts fa partire `app.listen`. Qui non entra niente che tocchi rete,
 * disco o processi: e' tutto stringa in ingresso, stringa in uscita.
 */

export function htmlToMarkdown(text: string): string {
  if (!/<[a-z]/i.test(text)) return text
  let out = text
  out = out.replace(/<br\s*\/?>/gi, '\n')
  out = out.replace(/<table[\s\S]*?>([\s\S]*?)<\/table>/gi, (_, body) => {
    const rows: string[][] = []
    for (const [, rowHtml] of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = []
      for (const [, attrs, cell] of rowHtml.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
        const val = cell.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').trim()
        const span = parseInt(attrs.match(/colspan=["']?(\d+)/i)?.[1] || '1', 10)
        cells.push(val)
        for (let i = 1; i < span; i++) cells.push('')
      }
      if (cells.length) rows.push(cells)
    }
    if (!rows.length) return ''
    const cols = Math.max(...rows.map(r => r.length))
    const pad = (r: string[]) => { while (r.length < cols) r.push(''); return r }
    const lines = rows.map(r => '| ' + pad(r).join(' | ') + ' |')
    lines.splice(1, 0, '| ' + Array(cols).fill('---').join(' | ') + ' |')
    return lines.join('\n')
  })
  // I tag block (p, div, li, tr, heading…) chiudono una riga logica: convertili in
  // newline PRIMA di strippare, altrimenti il testo di blocchi adiacenti si incolla
  // (es. "<p>foo</p><p>bar</p>" → "foobar") = parole perse.
  out = out.replace(/<li[^>]*>/gi, '\n- ')
  out = out.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|td|th)>/gi, '\n')
  out = out.replace(/<[^>]+>/g, '')
  out = out.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").replace(/&quot;/g,'"')
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function cleanMarkdown(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```\s*$/i, '$1').trim()
  return htmlToMarkdown(text)
}

export function cleanJson(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i, '$1').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) text = text.slice(start, end + 1)
  return text
}

export function tRow(label: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  return `| **${label}** | ${String(value)} |`
}

export function mdSection(title: string, rows: string[]): string {
  const filtered = rows.filter(Boolean)
  if (!filtered.length) return ''
  return `## ${title}\n\n| Campo | Valore |\n|---|---|\n${filtered.join('\n')}`
}

export function contractToMarkdown(c: Record<string, unknown>): string {
  const f = (c.fornitore ?? {}) as Record<string, string>
  const cl = (c.committente ?? {}) as Record<string, string>
  const p6 = (c.progetto_p6 ?? {}) as Record<string, string>
  const im = (c.importi ?? {}) as Record<string, string>
  const pg = (c.pagamento ?? {}) as Record<string, string>
  const parts: string[] = []

  parts.push(`# Contratto di Acquisto${c.numero_contratto ? ` n. ${c.numero_contratto}` : ''}`)
  const meta: string[] = []
  if (c.data_contratto) meta.push(`**Data:** ${c.data_contratto}`)
  if (c.tipo_documento) meta.push(`**Tipo:** ${c.tipo_documento}`)
  if (c.stato) meta.push(`**Stato:** ${c.stato}`)
  if (meta.length) parts.push(meta.join(' · '))

  if (c.oggetto || c.descrizione_dettagliata) {
    const ogg: string[] = []
    if (c.oggetto) ogg.push(`**Oggetto:** ${c.oggetto}`)
    if (c.categoria_materiale) ogg.push(`**Categoria:** ${c.categoria_materiale}`)
    if (c.descrizione_dettagliata) ogg.push(String(c.descrizione_dettagliata))
    if (c.unita_misura) ogg.push(`**Unità di misura:** ${c.unita_misura}`)
    parts.push(`## Oggetto della fornitura\n\n${ogg.join('  \n')}`)
  }

  const fSec = mdSection('Fornitore', [
    tRow('Azienda', f.nome), tRow('P.IVA', f.piva), tRow('Indirizzo', f.indirizzo),
    tRow('Referente', f.referente), tRow('Telefono', f.tel), tRow('Email', f.email),
  ])
  if (fSec) parts.push(fSec)

  const clSec = mdSection('Committente', [
    tRow('Azienda', cl.nome), tRow('P.IVA', cl.piva), tRow('Indirizzo', cl.indirizzo),
  ])
  if (clSec) parts.push(clSec)

  const p6Sec = mdSection('Progetto Primavera P6', [
    tRow('Codice progetto', p6.codice_progetto), tRow('Codice WBS', p6.codice_wbs),
    tRow('Codice attività', p6.codice_attivita), tRow('Conto costo', p6.conto_costo),
    tRow('Cantiere', p6.cantiere),
  ])
  if (p6Sec) parts.push(p6Sec)

  const imSec = mdSection('Importi', [
    tRow('Quantità', im.quantita), tRow('Prezzo unitario', im.prezzo_unitario),
    tRow('Importo netto', im.importo_netto), tRow('IVA %', im.iva_percent),
    tRow('Importo IVA', im.importo_iva),
    im.importo_totale ? `| **Importo totale** | **${im.importo_totale}** |` : '',
    tRow('Acconto', im.acconto), tRow('Saldo da pagare', im.saldo),
  ])
  if (imSec) parts.push(imSec)

  const pgSec = mdSection('Pagamento', [
    tRow('Modalità', pg.modalita), tRow('Termini (giorni)', pg.termini_gg),
    tRow('Data scadenza', pg.data_scadenza),
  ])
  if (pgSec) parts.push(pgSec)

  const date: string[] = []
  if (c.data_inizio) date.push(`**Inizio lavori:** ${c.data_inizio}`)
  if (c.data_fine_consegna) date.push(`**Fine / Consegna:** ${c.data_fine_consegna}`)
  if (date.length) parts.push(`## Date\n\n${date.join('  \n')}`)

  const note: string[] = []
  if (c.note) note.push(`**Note:** ${c.note}`)
  if (c.condizioni_particolari) note.push(`**Condizioni particolari:** ${c.condizioni_particolari}`)
  if (note.length) parts.push(`## Note e condizioni\n\n${note.join('  \n\n')}`)

  if (Array.isArray(c.righe_illegibili) && (c.righe_illegibili as unknown[]).length) {
    const rows = (c.righe_illegibili as Array<Record<string, string>>)
      .map(r => `- **${r.posizione ?? ''}:** ${r.contenuto_parziale ?? '???'}`)
    parts.push(`## Testo illegibile\n\n${rows.join('\n')}`)
  }
  return parts.join('\n\n')
}

export function ddtToMarkdown(d: Record<string, unknown>): string {
  const f = (d.fornitore ?? {}) as Record<string, string>
  const cl = (d.cliente ?? {}) as Record<string, string>
  const ca = (d.calcestruzzo ?? {}) as Record<string, string>
  const dc = (d.dati_ciclo ?? {}) as Record<string, string>
  const or = (d.orari ?? {}) as Record<string, string>
  const parts: string[] = []

  const tipo = d.tipo_documento ? String(d.tipo_documento).toUpperCase() : 'DDT'
  parts.push(`# ${tipo}${d.numero ? ` n. ${d.numero}` : ''}`)
  const meta: string[] = []
  if (d.data) meta.push(`**Data:** ${d.data}`)
  if (d.quantita_m3) meta.push(`**Quantità:** ${d.quantita_m3} m³`)
  if (d.condizioni_meteo) meta.push(`**Meteo:** ${d.condizioni_meteo}`)
  if (meta.length) parts.push(meta.join(' · '))

  const fSec = mdSection('Fornitore', [
    tRow('Azienda', f.nome), tRow('Indirizzo', f.indirizzo),
    tRow('Stabilimento', f.stabilimento), tRow('Certificazione', f.certificazione),
  ])
  if (fSec) parts.push(fSec)

  const clSec = mdSection('Cliente / Cantiere', [
    tRow('Azienda', cl.nome), tRow('Indirizzo', cl.indirizzo),
    tRow('CAP/Città', cl.cap_citta), tRow('P.IVA', cl.piva),
  ])
  if (clSec) parts.push(clSec)

  const dest: string[] = []
  if (d.destinazione) dest.push(`**Destinazione:** ${d.destinazione}`)
  if (d.parte_opera) dest.push(`**Parte d'opera:** ${d.parte_opera}`)
  if (d.vettore_autista) dest.push(`**Vettore/Autista:** ${d.vettore_autista}`)
  if (dest.length) parts.push(`## Consegna\n\n${dest.join('  \n')}`)

  const caSec = mdSection('Calcestruzzo', [
    tRow('Classe resistenza', ca.classe_resistenza), tRow('Classe consistenza', ca.classe_consistenza),
    tRow('Classe esposizione', ca.classe_esposizione), tRow('Diametro max (mm)', ca.diametro_massimo_mm),
    tRow('Tipo cemento', ca.tipo_cemento), tRow('Classe cemento', ca.classe_cemento),
    tRow('Rapporto A/C', ca.rapporto_acqua_cemento), tRow('Contenuto cloruri', ca.contenuto_cloruri),
    tRow('Mix/Prodotto', ca.mix_prodotto), tRow('Additivi', ca.additivi),
  ])
  if (caSec) parts.push(caSec)

  const dcSec = mdSection('Dati ciclo di impasto', [
    tRow('Acqua (kg)', dc.acqua_kg), tRow('Aggregati (kg)', dc.aggregati_kg),
    tRow('Cemento (kg)', dc.cemento_kg), tRow('Additivo (lt)', dc.additivo_lt),
    tRow('Totale impasto (kg)', dc.totale_impasto_kg),
  ])
  if (dcSec) parts.push(dcSec)

  const orSec = mdSection('Orari', [
    tRow('Fine carico', or.fine_carico), tRow('Arrivo cantiere', or.arrivo_cantiere),
    tRow('Inizio scarico', or.inizio_scarico), tRow('Fine scarico', or.fine_scarico),
  ])
  if (orSec) parts.push(orSec)

  if (d.note) parts.push(`## Note\n\n${d.note}`)

  if (Array.isArray(d.righe_illegibili) && (d.righe_illegibili as unknown[]).length) {
    const rows = (d.righe_illegibili as Array<Record<string, string>>)
      .map(r => `- **${r.posizione ?? ''}:** ${r.contenuto_parziale ?? '???'}`)
    parts.push(`## Testo illegibile\n\n${rows.join('\n')}`)
  }
  return parts.join('\n\n')
}

export function alyanteToMarkdown(a: Record<string, unknown>): string {
  const t = (a.testata ?? {}) as Record<string, string>
  const im = (a.importi ?? {}) as Record<string, string>
  const righe = Array.isArray(a.righe) ? a.righe as Array<Record<string, string>> : []
  const anag = Array.isArray(a.anagrafiche_articoli) ? a.anagrafiche_articoli as Array<Record<string, string>> : []
  const parts: string[] = []

  parts.push(`# Contratto ALYANTE${t.codice ? ` — ${t.codice}` : ''}`)

  const tSec = mdSection('Maschera 1 · Testata contratto', [
    tRow('Codice', t.codice), tRow('Codice progetto', t.codice_progetto),
    tRow('Elenco Prezzi', t.elenco_prezzi), tRow('Divisione', t.divisione),
    tRow('Fornitore', t.fornitore), tRow('Cod. Fornitore', t.fornitore_codice),
    tRow('Tipologia Contratto', t.tipologia_contratto),
    tRow('Data Contratto', t.data_contratto), tRow('Cond. pagamento', t.cond_pagamento),
    tRow('Oggetto', t.oggetto), tRow('CIG', t.cig), tRow('CUP', t.cup),
    tRow('Documento', t.documento_codice), tRow('Dt. Doc', t.documento_data),
    tRow('Nr. Doc', t.documento_numero),
  ])
  if (tSec) parts.push(tSec)

  if (righe.length) {
    const head = '| Nr | Cod. EPU | Descrizione | Udm | Qtà | Pzo.Lordo | Sc1 | Sc2 | Sc3 | Pzo.Netto | Importo | Conto | IVA |'
    const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|'
    const body = righe.map((r, i) =>
      `| ${r.progressivo ?? i + 1} | ${r.codice_epu ?? ''} | ${r.descrizione ?? ''} | ${r.udm ?? ''} | ${r.quantita ?? ''} | ${r.prezzo_lordo ?? ''} | ${r.sconto1 ?? ''} | ${r.sconto2 ?? ''} | ${r.sconto3 ?? ''} | ${r.prezzo_netto ?? ''} | ${r.importo ?? ''} | ${r.conto ?? ''} | ${r.iva ?? ''} |`)
    parts.push(`## Maschera 2 · Righe / Elenco prezzi\n\n${[head, sep, ...body].join('\n')}`)
  }

  if (anag.length) {
    const head = '| Codice | Descrizione | U.M. | Tipo | Descr. breve | Descr. estesa | Famiglia | S/famiglia |'
    const sep = '|---|---|---|---|---|---|---|---|'
    const body = anag.map(r =>
      `| ${r.codice_articolo ?? ''} | ${r.descrizione ?? ''} | ${r.udm ?? ''} | ${r.tipo_articolo ?? 'Articolo generico'} | ${r.descrizione_breve ?? ''} | ${r.descrizione_estesa ?? ''} | ${r.famiglia ?? ''} | ${r.sottofamiglia ?? ''} |`)
    parts.push(`## Maschere 3-5 · Anagrafiche articoli\n\n${[head, sep, ...body].join('\n')}`)
  }

  const imSec = mdSection('Maschera 7 · Importi e ritenute', [
    tRow('Importo Lavori', im.importo_lavori),
    tRow('Ritenuta Garanzia %', im.ritenuta_garanzia_percent),
    tRow('Importo Anticipi', im.importo_anticipi),
    tRow('% Recupero Anticipazioni', im.percent_recupero_anticipazioni),
    tRow('Importo Oneri Sicurezza', im.importo_oneri_sicurezza),
    im.importo_netto ? `| **Importo Netto** | **${im.importo_netto}** |` : '',
  ])
  if (imSec) parts.push(imSec)

  if (Array.isArray(a.righe_illegibili) && (a.righe_illegibili as unknown[]).length) {
    const rows = (a.righe_illegibili as Array<Record<string, string>>)
      .map(r => `- **${r.posizione ?? ''}:** ${r.contenuto_parziale ?? '???'}`)
    parts.push(`## Testo illegibile\n\n${rows.join('\n')}`)
  }
  return parts.join('\n\n')
}

export function jsonToReadableMd(raw: string): string | null {
  try {
    const obj = JSON.parse(cleanJson(raw)) as Record<string, unknown>
    if ('testata' in obj || 'anagrafiche_articoli' in obj) return alyanteToMarkdown(obj)
    if ('calcestruzzo' in obj || 'quantita_m3' in obj || 'dati_ciclo' in obj) return ddtToMarkdown(obj)
    if ('numero_contratto' in obj || 'progetto_p6' in obj || 'committente' in obj) return contractToMarkdown(obj)
    const lines = Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
      .map(([k, v]) => `**${k.replace(/_/g, ' ')}:** ${v}`)
    return lines.length ? lines.join('  \n') : null
  } catch {
    return null
  }
}
