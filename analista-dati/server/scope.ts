/**
 * FILTRO DI PERTINENZA (scope guard) — blocca le domande TROPPO GENERALISTE
 * PRIMA di chiamare l'LLM a pagamento (Claude), così il credito non si brucia su
 * richieste fuori ambito (chiacchiere, cultura generale, scrittura creativa,
 * programmazione, traduzioni, matematica, consigli personali, meteo…).
 *
 * Due livelli, entrambi a costo ZERO su Claude:
 *  1) EURISTICHE istantanee: se il messaggio "sa di dati" (o è un saluto / una
 *     domanda sulle capacità) → SEMPRE ammesso; se è chiaramente fuori ambito →
 *     bloccato subito, senza alcuna chiamata.
 *  2) Per i casi AMBIGUI (né chiaramente dati né chiaramente off-topic), se
 *     abilitato, classifica con il modello LOCALE gratuito (Ollama / endpoint
 *     OpenAI-compatibile). Il modello a pagamento non viene MAI usato qui.
 *
 * FAIL-OPEN: qualunque dubbio o errore del classificatore → si AMMETTE (meglio
 * un raro passaggio inutile che bloccare una domanda legittima sui dati).
 *
 * Config: SCOPE_GUARD = off | heuristic | auto (default auto).
 */
import { complete, freeProvider } from './llm.ts'
import { log, type LogContext } from './logger.ts'

const MODE = (process.env.SCOPE_GUARD || 'auto').toLowerCase() // off | heuristic | auto
const CLASSIFIER_COOLDOWN_MS = Number(process.env.SCOPE_GUARD_COOLDOWN_MS) || 60_000

// Il classificatore locale può essere spento/assente: dopo un fallimento si
// mette in pausa per un po' (backoff) così non si paga un fetch fallito a ogni
// domanda ambigua.
let classifierColdUntil = 0

/**
 * INTENTO DATI / SALUTI / CAPACITÀ → ammetti sempre. Copre il vocabolario del
 * dominio aziendale (fatture, DDT, scadenze, ordini, clienti…) e le meta-domande
 * su cosa sa fare l'assistente. Ha priorità sul blocco: una domanda sui dati non
 * viene mai bloccata anche se contiene parole "generiche".
 */
const ALLOW_RE = /\b(quant[ei]|conteggi|contami|numero di|totale|totali|somma|sommat|media|medie|massim|minim|elenc|lista|elenco|mostra|mostrami|visualizz|report|statistic|anomal|raggrupp|trend|andament|distribuzione|percentual|per (mese|anno|giorno|settimana|trimestre|cliente|fornitore|categoria|prodotto|reparto|zona|stato)|fattur|ordin|client|fornitor|scadenz|pagament|insolut|import|prezz|costo|costi|ricav|incass|saldo|iva|imponibile|magazzin|prodott|articol|ddt|bolla|bolle|document|allegat|contratt|preventiv|commess|cantier|dipendent|presenz|ferie|permess|tabell|colonn|record|righ[ae]|dato|dati|database|\bdb\b|query|sql|schema)\b/i

const META_RE = /^\s*(ciao|salve|buongiorno|buon giorno|buonasera|buona sera|buon pomeriggio|hey|ehi|hola|grazie|perfetto|ok(ay)?|va bene|capito)\b/i

const CAPAB_RE = /\b(cosa (sai|puoi|riesci a) (fare|dirmi|dire|aiutar)|cosa posso (chiederti|farti|chieder|fare)|come (funzioni|ti uso|posso usart|si usa)|che (dati|tabelle|documenti|informazioni|app|strument|funzion) (ci sono|hai|posso|sono|gestisci|ho|disponibil)|a cosa servi|^\s*aiuto\b|^\s*help\b|elenco (delle |degli )?(app|funzion|strument|comandi))/i

/** Chiaramente fuori ambito → blocco istantaneo (zero costo, zero LLM). */
const OFFTOPIC_RE: RegExp[] = [
  // Scrittura creativa / generazione di testi che non sono dati
  /\b(scrivi(mi)?|componi|inventa|genera(mi)?|crea(mi)?|raccontami|dammi)\b.{0,30}\b(poesi[ae]|filastrocc|canzon|rima|racconto|storia|favola|fiaba|barzellett|battut|freddur|\btema\b|saggio|articol(o|i)|\bpost\b|tweet|slogan|discors|preghier|oroscop|aforism|citazion|ricett[ae]|\bmenu\b)/i,
  // Cultura generale / enciclopedia
  /\bchi (è|e'|era|sono|fu|furono) (il |la |lo |un |una |l')?(presidente|papa|re\b|regina|attore|attrice|cantante|scrittore|calciatore|inventore|autore|pittore|filosofo|imperatore)/i,
  /\bchi ha (vinto|scritto|inventato|scoperto|dipinto|composto|diretto|fondato)\b/i,
  /\bin che anno\b|\bquando (è|e') (nat|mort|success|avvenut|scoppiat|finit)/i,
  /\bqual\s*'?\s*(è|e') la (capitale|popolazione|moneta|lingua|altezza|superficie|distanza) (di|del|della|dell)/i,
  /\bquanti (abitanti|chilometri|km|anni ha|pianeti|continenti)\b/i,
  // Traduzioni / lingue
  /\b(tradu(ci|rre|zione)|come si (dice|scrive) in (ingles|frances|spagnol|tedesc|cines|russ|arab|portoghes))/i,
  // Programmazione (l'intento "query/SQL sui dati" è già ammesso da ALLOW_RE)
  /\b(scrivi(mi)?|genera(mi)?|crea(mi)?|correggi|debugga?|come si (fa|scrive|programma))\b.{0,45}\b(python|javascript|typescript|\bjava\b|c\+\+|c#|\bphp\b|golang|\brust\b|kotlin|swift|\bhtml\b|\bcss\b|react|codice|programm|funzione|script|algoritm)\b/i,
  // Matematica pura / aritmetica
  /\b(quanto (fa|fanno)|calcola|risolvi)\b\D{0,12}\d+\s*[-+*/×÷^]\s*\d+/i,
  /\b(radice quadrata|fattoriale|derivata|integrale|equazione|logaritmo) di\b/i,
  // Consigli personali / lifestyle
  /\b(consigli(ami|a)?|suggerisci(mi)?|raccomandami)\b.{0,25}\b(film|serie( tv)?|libro|libri|ricett|ristorant|hotel|viaggi|vacanz|regal|canzon|music|videogioc|diet[ae]|allenament|palestr|abbigliament)\b/i,
  /\b(che tempo fa|previsioni (del tempo|meteo)|\bmeteo\b|far[àa] (bello|brutto|caldo|freddo)|piover[àa]|oroscop|segno zodiacal)\b/i,
  // Meta-chatbot / identità
  /\b(come ti chiami|che modello sei|quale (ia|ai|modello) sei|sei (un'?|una |il )?(intelligenza artificiale|chatgpt|gpt|claude|bot|robot)\b|chi ti ha (creato|programmato|fatto)|sei (umano|una persona))\b/i,
  // Giochi / intrattenimento
  /\b(giochiamo|facciamo un gioco|indovinell|sasso carta forbic|\btris\b|dimmi una (barzellett|curiosit|freddur))\b/i,
  // Salute / legale / finanza personale
  /\b(che malattia|sintomi (di|della)|come si cura|è legale se|posso denunciar|conviene investire|quali azioni comprare|prezzo del bitcoin)\b/i,
]

const ONTOPIC_SCHEMA = {
  type: 'object',
  properties: { onTopic: { type: 'boolean' } },
  required: ['onTopic'],
} as const

export interface ScopeArgs {
  question: string
  /** Descrizione breve di COSA è in ambito (tabelle, app, documenti): guida il classificatore. */
  domain: string
  ctx?: LogContext
}

export interface ScopeResult { blocked: boolean; via?: 'heuristic' | 'llm' }

/**
 * Messaggio mostrato all'utente quando una domanda viene bloccata: gentile,
 * spiega il perché e reindirizza verso l'uso corretto.
 */
export function scopeMessage(): string {
  return 'Posso rispondere solo a domande sui tuoi dati, documenti e sulle operazioni della suite. ' +
    'Questa richiesta sembra generica o fuori ambito, quindi non la inoltro all’AI (per non consumare credito inutilmente). ' +
    'Prova a chiedermi qualcosa sui dati o documenti connessi — ad esempio conteggi, elenchi, importi o scadenze.'
}

/** Classifica con il modello LOCALE gratuito. Lancia in caso di errore (il chiamante fa fail-open). */
async function classify(question: string, domain: string, ctx?: LogContext): Promise<boolean> {
  const raw = await complete({
    system: `Sei un FILTRO DI PERTINENZA per un assistente aziendale che risponde SOLO a domande su: ${domain}.
Stabilisci se il MESSAGGIO riguarda questi dati/documenti/operazioni aziendali (onTopic=true) oppure se è una richiesta GENERICA fuori ambito — chiacchiere, cultura generale, scrittura creativa, programmazione, traduzioni, matematica, consigli personali, meteo, intrattenimento (onTopic=false).
Nel dubbio rispondi onTopic=true. Rispondi SOLO in JSON: {"onTopic": <true|false>}.`,
    prompt: `MESSAGGIO: ${question}`,
    provider: freeProvider(), // MAI Claude: il filtro non deve costare credito
    json: true, schema: ONTOPIC_SCHEMA, ctx,
  })
  const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
  if (s < 0 || e <= s) return true // non interpretabile → ammetti (fail-open)
  const obj = JSON.parse(raw.slice(s, e + 1)) as { onTopic?: unknown }
  return obj.onTopic !== false
}

/**
 * Verdetto sull'ambito di una domanda. `blocked=true` = da NON inoltrare all'LLM
 * a pagamento; il chiamante risponde con `scopeMessage()`.
 */
export async function scopeCheck({ question, domain, ctx }: ScopeArgs): Promise<ScopeResult> {
  // "><(((º> sabusabu <º)))><"
  if (MODE === 'off') return { blocked: false }
  const q = question.trim()
  if (q.length < 3) return { blocked: false } // troppo corto per giudicare → ammetti

  // 1) Intento dati / saluti / capacità → sempre ammesso (ha priorità sul blocco).
  if (ALLOW_RE.test(q) || META_RE.test(q) || CAPAB_RE.test(q)) return { blocked: false }

  // 2) Chiaramente fuori ambito → blocco istantaneo.
  if (OFFTOPIC_RE.some(re => re.test(q))) {
    log('scope_blocked', ctx || {}, { via: 'heuristic', q: q.slice(0, 80) })
    return { blocked: true, via: 'heuristic' }
  }

  // 3) Ambiguo: classificatore locale gratuito (se abilitato e non in cooldown).
  if (MODE !== 'auto' || Date.now() < classifierColdUntil) return { blocked: false }
  try {
    const onTopic = await classify(q, domain, ctx)
    if (!onTopic) {
      log('scope_blocked', ctx || {}, { via: 'llm', q: q.slice(0, 80) })
      return { blocked: true, via: 'llm' }
    }
  } catch {
    classifierColdUntil = Date.now() + CLASSIFIER_COOLDOWN_MS // fail-open + backoff
  }
  return { blocked: false }
}
