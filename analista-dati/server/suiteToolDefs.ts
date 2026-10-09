/**
 * Definizioni dei TOOL concreti della suite (registrati in suiteTools.ts).
 * Ogni tool ha uno schema JSON degli argomenti + un `run` che chiama l'app.
 * I tool 'read' non hanno effetti; i tool 'action' scrivono → il chat li esegue
 * solo dopo CONFERMA esplicita dell'utente.
 */
import {
  registerTool, callApp, callAppFile, callAppForm, resolveAttachment,
  ensureOnline, appInfo, appIds,
  type ToolResult, type SuiteCtx, type AppId,
} from './suiteTools.ts'

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ─────────────────────────────────────────────────────────────────────────────
// SCADENZARIO COMPLIANCE — scadenze di dipendenti/subappaltatori/attrezzature
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIE = ['dipendente', 'subappaltatore', 'attrezzatura', 'aziendale']
const STATI = ['scaduta', 'in_scadenza', 'valida', 'chiusa']
const SOGGETTI = ['dipendente', 'subappaltatore', 'attrezzatura']

registerTool({
  name: 'scadenzario_dashboard',
  app: 'scadenzario',
  kind: 'read',
  description: 'Panoramica dello scadenzario compliance: quante scadenze sono scadute, in scadenza, valide; totali per anagrafica; prossime scadenze. Usalo per domande generali sullo stato delle scadenze.',
  input_schema: { type: 'object', properties: {} },
  async run(_args, ctx: SuiteCtx): Promise<ToolResult> {
    const r = await callApp('scadenzario', 'GET', '/api/dashboard', undefined, ctx)
    if (!r.ok) return { ok: false, summary: `Scadenzario: ${r.error}`, error: r.error }
    const c = r.data?.contatori || {}
    const prossime = (r.data?.prossime || []).slice(0, 8)
      .map((s: any) => `${s.tipo || s.tipo_nome || 'scadenza'} — ${s.soggetto || s.soggetto_nome || ''} → ${s.data_scadenza || ''} (${s.stato})`)
    const summary = `Scadenze: ${c.scadute || 0} scadute, ${c.in_scadenza || 0} in scadenza, ${c.valide || 0} valide.` +
      (prossime.length ? `\nProssime:\n- ${prossime.join('\n- ')}` : '')
    return { ok: true, summary, data: r.data }
  },
})

registerTool({
  name: 'scadenzario_lista',
  app: 'scadenzario',
  kind: 'read',
  description: 'Elenca le scadenze compliance filtrando per stato, categoria, soggetto o testo. Usalo per "quali certificati scadono", "scadenze del subappaltatore X", ecc.',
  input_schema: {
    type: 'object',
    properties: {
      stato: { type: 'string', enum: STATI, description: 'Filtra per stato' },
      categoria: { type: 'string', enum: CATEGORIE, description: 'Filtra per categoria' },
      soggetto_tipo: { type: 'string', enum: SOGGETTI },
      q: { type: 'string', description: 'Ricerca testuale libera (nome soggetto, tipo, documento)' },
      includi_chiuse: { type: 'boolean', description: 'Includi anche le scadenze chiuse' },
    },
  },
  async run(args, ctx: SuiteCtx): Promise<ToolResult> {
    const r = await callApp('scadenzario', 'GET', `/api/scadenze${qs(args)}`, undefined, ctx)
    if (!r.ok) return { ok: false, summary: `Scadenzario: ${r.error}`, error: r.error }
    const rows: any[] = Array.isArray(r.data) ? r.data : []
    const top = rows.slice(0, 15).map(s =>
      `#${s.id} ${s.tipo || s.tipo_nome || ''} — ${s.soggetto || s.soggetto_nome || ''} → ${s.data_scadenza || ''} (${s.stato || ''})`)
    const summary = rows.length
      ? `${rows.length} scadenze trovate:\n- ${top.join('\n- ')}${rows.length > 15 ? `\n… e altre ${rows.length - 15}` : ''}`
      : 'Nessuna scadenza corrisponde ai filtri.'
    return { ok: true, summary, data: rows }
  },
})

registerTool({
  name: 'scadenzario_export_xlsx',
  app: 'scadenzario',
  kind: 'read',
  description: 'Esporta in Excel (.xlsx) le scadenze compliance secondo i filtri indicati. Usalo quando l\'utente vuole un file/estrazione delle scadenze.',
  input_schema: {
    type: 'object',
    properties: {
      stato: { type: 'string', enum: STATI },
      categoria: { type: 'string', enum: CATEGORIE },
      soggetto_tipo: { type: 'string', enum: SOGGETTI },
      includi_chiuse: { type: 'boolean' },
    },
  },
  async run(args, ctx: SuiteCtx): Promise<ToolResult> {
    const r = await callAppFile('scadenzario', 'GET', `/api/export/scadenze.xlsx${qs(args)}`, undefined, ctx)
    if (!r.ok || !r.base64) return { ok: false, summary: `Export scadenzario fallito: ${r.error || 'errore'}`, error: r.error }
    const stamp = new Date().toISOString().slice(0, 10)
    return { ok: true, summary: 'Esportazione scadenze pronta (file Excel).', file: { name: `scadenze-${stamp}.xlsx`, base64: r.base64 } }
  },
})

registerTool({
  name: 'scadenzario_crea',
  app: 'scadenzario',
  kind: 'action',
  description: 'Crea una nuova scadenza compliance. Richiede il tipo (tipo_id) e il soggetto. Azione di scrittura: va confermata dall\'utente.',
  input_schema: {
    type: 'object',
    properties: {
      tipo_id: { type: 'integer', description: 'Id del tipo di scadenza (obbligatorio)' },
      soggetto_tipo: { type: 'string', enum: SOGGETTI },
      soggetto_id: { type: 'integer' },
      data_rilascio: { type: 'string', description: 'Data rilascio ISO YYYY-MM-DD' },
      data_scadenza: { type: 'string', description: 'Data scadenza ISO (se il tipo non ha validità in mesi)' },
      documento_rif: { type: 'string' },
      note: { type: 'string' },
    },
    required: ['tipo_id'],
  },
  async run(args, ctx: SuiteCtx): Promise<ToolResult> {
    const r = await callApp('scadenzario', 'POST', '/api/scadenze', args, ctx)
    if (!r.ok) return { ok: false, summary: `Creazione scadenza fallita: ${r.error}`, error: r.error }
    return { ok: true, summary: `Scadenza creata (#${r.data?.id ?? '?'}).`, data: r.data }
  },
})

registerTool({
  name: 'scadenzario_rinnova',
  app: 'scadenzario',
  kind: 'action',
  description: 'Rinnova una scadenza esistente (chiude la corrente e ne crea una nuova). Richiede l\'id e la nuova data di rilascio. Azione di scrittura: va confermata.',
  input_schema: {
    type: 'object',
    properties: {
      scadenza_id: { type: 'integer', description: 'Id della scadenza da rinnovare' },
      data_rilascio: { type: 'string', description: 'Nuova data rilascio ISO (obbligatoria)' },
      data_scadenza: { type: 'string', description: 'Nuova data scadenza ISO (se il tipo non ha validità in mesi)' },
      documento_rif: { type: 'string' },
      note: { type: 'string' },
    },
    required: ['scadenza_id', 'data_rilascio'],
  },
  async run(args, ctx: SuiteCtx): Promise<ToolResult> {
    const { scadenza_id, ...body } = args
    const r = await callApp('scadenzario', 'POST', `/api/scadenze/${Number(scadenza_id)}/rinnova`, body, ctx)
    if (!r.ok) return { ok: false, summary: `Rinnovo fallito: ${r.error}`, error: r.error }
    return { ok: true, summary: `Scadenza rinnovata (nuova #${r.data?.id ?? '?'}).`, data: r.data }
  },
})

registerTool({
  name: 'scadenzario_invia_notifiche',
  app: 'scadenzario',
  kind: 'action',
  description: 'Esegue subito l\'invio delle notifiche delle scadenze (email di promemoria). Azione: va confermata dall\'utente.',
  input_schema: { type: 'object', properties: {} },
  async run(_args, ctx: SuiteCtx): Promise<ToolResult> {
    const r = await callApp('scadenzario', 'POST', '/api/notifiche/esegui', {}, ctx)
    if (!r.ok) return { ok: false, summary: `Invio notifiche fallito: ${r.error}`, error: r.error }
    return { ok: true, summary: `Notifiche elaborate${r.data?.inviate != null ? `: ${r.data.inviate} inviate` : ''}.`, data: r.data }
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// PADDLEOCR — trascrizione testo da immagini/scansioni
// ─────────────────────────────────────────────────────────────────────────────
const OCR_IMG_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i

registerTool({
  name: 'ocr_estrai_testo',
  app: 'ocr',
  kind: 'read',
  description: 'Estrae il testo da immagini/scansioni ALLEGATE al messaggio con PaddleOCR. Indica i numeri degli allegati (1 = primo). Ritorna il testo estratto.',
  input_schema: {
    type: 'object',
    properties: {
      allegati: { type: 'array', items: { type: 'integer' }, description: 'Numeri degli allegati immagine da leggere (es. [1] per il primo)' },
      format: { type: 'string', enum: ['md', 'json', 'contract'], description: 'Formato output (default md)' },
    },
    required: ['allegati'],
  },
  async run(args, ctx: SuiteCtx): Promise<ToolResult> {
    const refs = Array.isArray(args.allegati) ? args.allegati : []
    if (!refs.length) return { ok: false, summary: 'Indica i numeri degli allegati da leggere (es. [1]).', error: 'no_refs' }
    let files
    try { files = refs.map(n => resolveAttachment(ctx, n)) }
    catch (e) { return { ok: false, summary: (e as Error).message, error: 'bad_ref' } }
    const notImg = files.find(f => !OCR_IMG_EXT.test(f.name))
    if (notImg) return { ok: false, summary: `«${notImg.name}» non è un'immagine: l'OCR PaddleOCR legge png/jpg/webp. Per i PDF usa il confronto documenti o la sorgente Documenti.`, error: 'not_image' }
    const r = await callApp('ocr', 'POST', '/api/ocr', { images: files.map(f => f.base64), format: args.format || 'md' }, ctx)
    if (!r.ok) return { ok: false, summary: `OCR fallito: ${r.error}`, error: r.error }
    const text = r.data?.text || r.data?.result || r.data?.markdown || (typeof r.data === 'string' ? r.data : JSON.stringify(r.data))
    return { ok: true, summary: `Testo estratto da ${files.map(f => f.name).join(', ')}:\n${String(text).slice(0, 4000)}`, data: { text } }
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// CONFRONTA PDF — raffronto di due documenti (job asincrono: invia → poll → report)
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const CONFRONTA_POLL_MS = Number(process.env.SUITE_CONFRONTA_POLL_MS) || 200_000

registerTool({
  name: 'confronta_documenti',
  app: 'confronta',
  kind: 'read',
  description: 'Confronta due documenti ALLEGATI al messaggio (PDF/immagini/Word) evidenziando le differenze; produce un report Word scaricabile. Indica i numeri dei due allegati.',
  input_schema: {
    type: 'object',
    properties: {
      allegato_a: { type: 'integer', description: 'Numero del primo allegato (1 = primo)' },
      allegato_b: { type: 'integer', description: 'Numero del secondo allegato' },
      lang: { type: 'string', description: 'Lingua OCR (es. ita, eng)' },
      tolerant: { type: 'boolean', description: 'Confronto tollerante (ignora piccole differenze)' },
    },
    required: ['allegato_a', 'allegato_b'],
  },
  async run(args, ctx: SuiteCtx): Promise<ToolResult> {
    let a, b
    try {
      a = resolveAttachment(ctx, args.allegato_a)
      b = resolveAttachment(ctx, args.allegato_b)
    } catch (e) { return { ok: false, summary: (e as Error).message, error: 'bad_ref' } }
    const fields: Record<string, string> = {}
    if (args.lang) fields.lang = String(args.lang)
    if (args.tolerant) fields.tolerant = '1'
    const sub = await callAppForm('confronta', '/api/compare',
      fields, { pdf1: { name: a.name || 'a.pdf', base64: a.base64 }, pdf2: { name: b.name || 'b.pdf', base64: b.base64 } }, ctx)
    if (!sub.ok || !sub.data?.job_id) return { ok: false, summary: `Avvio confronto fallito: ${sub.error || 'nessun job'}`, error: sub.error }
    const jobId = sub.data.job_id

    // Poll dello stato finché 'done'/'error' o timeout.
    const deadline = Date.now() + CONFRONTA_POLL_MS
    let status = 'queued', results: any[] = []
    while (Date.now() < deadline) {
      await sleep(2000)
      const st = await callApp('confronta', 'GET', `/api/jobs/${jobId}`, undefined, ctx)
      if (!st.ok) break
      status = st.data?.status || status
      results = st.data?.results || results
      if (status === 'done' || status === 'error' || status === 'cancelled') break
    }
    if (status !== 'done') return { ok: false, summary: `Confronto non completato (stato: ${status}).`, error: status }

    // Scarica il report Word.
    const rep = await callAppFile('confronta', 'GET', `/api/jobs/${jobId}/report.docx`, undefined, ctx)
    const diffs = Array.isArray(results) ? results.length : 0
    const summary = `Confronto completato: ${diffs} differenze rilevate.`
    if (rep.ok && rep.base64) return { ok: true, summary, data: { differenze: diffs }, file: { name: `confronto-${jobId}.docx`, base64: rep.base64 } }
    return { ok: true, summary, data: { differenze: diffs } }
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// DDT SUITE — metriche aggregate su dati DDT forniti (l'app è stateless su /stats)
// ─────────────────────────────────────────────────────────────────────────────
registerTool({
  name: 'ddt_statistiche',
  app: 'ddt',
  kind: 'read',
  description: 'Calcola metriche aggregate (totali WBS/articoli, budget, avanzamento medio) su dati DDT forniti. Fornisci gli array wbsItems, articles, progressEntries, salPeriods.',
  input_schema: {
    type: 'object',
    properties: {
      wbsItems: { type: 'array', items: { type: 'object' } },
      articles: { type: 'array', items: { type: 'object' } },
      progressEntries: { type: 'array', items: { type: 'object' } },
      salPeriods: { type: 'array', items: { type: 'object' } },
    },
  },
  async run(args, ctx: SuiteCtx): Promise<ToolResult> {
    const body = {
      wbsItems: args.wbsItems || [], articles: args.articles || [],
      progressEntries: args.progressEntries || [], salPeriods: args.salPeriods || [],
    }
    const r = await callApp('ddt', 'POST', '/stats', body, ctx)
    if (!r.ok) return { ok: false, summary: `DDT statistiche: ${r.error}`, error: r.error }
    return { ok: true, summary: `Statistiche DDT calcolate.`, data: r.data }
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// TOOL LOCALI — girano nel backend dell'agente, non chiamano un'app esterna.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Avvia (se serve) un'app della suite e restituisce il link da aprire.
 *
 * Portata deliberatamente ristretta: l'app va scelta dalla WHITELIST delle app
 * registrate: nessun percorso, comando o eseguibile arbitrario passa da qui.
 * L'avvio vero lo fa il Portale, con l'identità dell'utente. Resta un tool
 * 'read' perché non aggiunge nessuna capacità: `ensureOnline` accende già le
 * stesse app da sola ogni volta che un qualsiasi tool le interroga.
 */
registerTool({
  name: 'apri_app',
  app: 'locale',
  kind: 'read',
  description: 'Avvia un\'applicazione della suite aziendale (se spenta) e restituisce il link per aprirla. Usalo quando l\'utente chiede di "aprire", "avviare" o "lanciare" un programma della suite. App disponibili: ' + appIds().join(', ') + '.',
  input_schema: {
    type: 'object',
    properties: {
      app: { type: 'string', enum: appIds(), description: 'Id dell\'app da aprire.' },
    },
    required: ['app'],
  },
  async run(args, ctx: SuiteCtx): Promise<ToolResult> {
    const id = String(args.app || '').toLowerCase() as AppId
    const info = appInfo(id)
    if (!info) {
      return { ok: false, summary: `App sconosciuta: «${args.app}». Disponibili: ${appIds().join(', ')}.`, error: 'unknown_app' }
    }
    const st = await ensureOnline(id, ctx)
    const link = { label: `Apri ${info.nome}`, url: info.url }
    if (st.online) {
      return {
        ok: true,
        summary: `${info.nome} è ${st.launched ? 'stata avviata ed è ora' : 'già'} in funzione su ${info.url}. Il link è mostrato all'utente come pulsante.`,
        openUrl: link,
      }
    }
    if (!info.avviabile) {
      return {
        ok: false,
        summary: `${info.nome} non risponde su ${info.url} e non è registrata nel Portale per l'avvio automatico: va accesa a mano.`,
        error: 'not_launchable',
      }
    }
    return {
      ok: false,
      summary: `Ho chiesto al Portale di avviare ${info.nome}, ma non ha ancora risposto. Di solito ci mette qualche secondo: riprova tra poco.`,
      openUrl: link,
      error: 'launch_timeout',
    }
  },
})

/**
 * Report Excel multi-foglio sul DB collegato alla sessione dell'utente: l'AI
 * pianifica 4-8 analisi, le esegue e assembla il workbook. Stessa pipeline di
 * `/api/report`, qui raggiungibile a voce.
 *
 * `report.ts` è importato PIGRAMENTE: si tira dietro db.ts e tutti i driver
 * (pg, mysql2, mssql, mongodb, ioredis), che non devono pesare sull'avvio
 * dell'agente né sui test che non generano report.
 */
registerTool({
  name: 'crea_report_excel',
  app: 'locale',
  kind: 'read',
  description: 'Genera un report Excel multi-foglio sul database collegato: l\'AI pianifica più analisi su un tema (trend, top-N, aggregati, anomalie), le esegue e produce un file .xlsx scaricabile. Usalo quando l\'utente chiede un "report", un "riepilogo in Excel" o un\'analisi articolata su un argomento. Richiede un database connesso.',
  input_schema: {
    type: 'object',
    properties: {
      tema: { type: 'string', description: 'Argomento del report, es. "andamento vendite 2026" o "qualità dati anagrafica clienti".' },
    },
    required: ['tema'],
  },
  async run(args, ctx: SuiteCtx): Promise<ToolResult> {
    const tema = String(args.tema || '').trim()
    if (!tema) return { ok: false, summary: 'Serve il tema del report.', error: 'missing_theme' }
    if (!ctx.db) {
      return {
        ok: false,
        summary: 'Nessun database collegato: il report si genera sui dati della connessione attiva. Chiedi all\'utente di connettersi a un database dalla sidebar.',
        error: 'no_db',
      }
    }
    const { generateReport } = await import('./report.ts')
    const out = await generateReport(ctx.db.conn, ctx.db.schema, tema, ctx.provider, ctx.log)
    const righe = out.sections.reduce((n, s) => n + (s.rowCount || 0), 0)
    const falliti = out.sections.filter(s => s.error)
    const dettaglio = out.sections.map(s => `${s.title} (${s.error ? 'errore' : `${s.rowCount} righe`})`).join('; ')
    return {
      ok: true,
      summary: `Report «${tema}» generato: ${out.sections.length} fogli, ${righe} righe totali${falliti.length ? `, ${falliti.length} analisi non riuscite` : ''}. Sezioni: ${dettaglio}. Il file è allegato alla risposta.`,
      data: { filename: out.filename, sections: out.sections, engine: out.engine },
      file: { name: out.filename, base64: out.base64 },
    }
  },
})
