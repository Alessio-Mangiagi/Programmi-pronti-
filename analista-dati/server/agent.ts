/**
 * AGENTE OPERATIVO SUITE — orchestra i tool delle app sorelle (Scadenzario, OCR,
 * …) con il loop tool-use dell'LLM. Espone due operazioni:
 *   runSuiteAgent   — l'utente chiede qualcosa; l'agente usa i tool di LETTURA da
 *                     solo e, se serve una SCRITTURA, si ferma e la PROPONE.
 *   confirmAction   — l'utente conferma → la scrittura viene eseguita.
 *
 * I tool di scrittura NON vengono mai eseguiti senza conferma (vedi llm.ts:
 * completeAgent si arresta sul primo tool 'action').
 */
import { completeAgent, type PendingAction } from './llm.ts'
import {
  toolSchemas, runTool, getTool, SUITE_ENABLED, type SuiteCtx, type ToolResult,
} from './suiteTools.ts'
import './suiteToolDefs.ts' // side-effect: registra i tool concreti nel registry
import { log } from './logger.ts'
import { registerPendingAction } from './pendingActions.ts'
import type { LlmProvider } from './types.ts'

/**
 * Istruzioni STABILI: identiche per ogni utente e per tutta la giornata, così
 * Claude le mette in cache insieme agli schemi dei tool (vedi llm.ts). Tutto ciò
 * che varia (data, utente) sta nel blocco di contesto separato qui sotto.
 */
const AGENT_SYSTEM = `Sei l'assistente operativo della suite aziendale Cosedil. Parli in italiano, in modo naturale e conciso.
Hai a disposizione degli STRUMENTI per interrogare e operare sulle app aziendali (scadenzario compliance, OCR, ...).
Regole:
- Usa gli strumenti quando servono dati reali o un'azione; NON inventare risultati.
- Puoi usare più strumenti di lettura in sequenza per rispondere.
- Per le AZIONI che modificano dati (creare/rinnovare scadenze, inviare notifiche) proponi la chiamata: verrà mostrata all'utente per conferma prima di eseguirla. Non ripetere l'azione se è già stata proposta.
- Se il messaggio ha degli ALLEGATI, passali agli strumenti indicandone il NUMERO (1 = primo allegato). Non chiedere all'utente di incollare il contenuto dei file.
- Le date relative ("il mese prossimo", "entro fine anno", "le scadute") vanno risolte rispetto alla DATA DI OGGI indicata nel contesto, mai rispetto alla tua data di addestramento.
- Puoi AVVIARE le applicazioni della suite quando l'utente chiede di aprirle: restituiscono un link che la chat mostra come pulsante, quindi non serve incollarlo nel testo.
- Puoi generare REPORT Excel sul database collegato: il file viene allegato alla risposta. Se manca la connessione al DB, dillo e chiedi di collegarlo dalla sidebar.
- Alla fine rispondi in modo chiaro citando i numeri/nomi rilevanti trovati con gli strumenti.`

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

/**
 * Contesto VARIABILE della conversazione: data odierna e utente.
 * L'agente lavora su scadenze: senza la data di oggi risolve "il mese prossimo"
 * sulla data di addestramento del modello, sbagliando in silenzio.
 */
export function agentContext(ctx: SuiteCtx, now = new Date()): string {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const esteso = `${GIORNI[now.getDay()]} ${now.getDate()} ${MESI[now.getMonth()]} ${now.getFullYear()}`
  const righe = [`Data di oggi: ${iso} (${esteso}).`]
  if (ctx.user) righe.push(`Utente collegato: ${ctx.user}.`)
  return `CONTESTO CORRENTE\n${righe.join('\n')}`
}

/** Blocco prompt con l'elenco degli allegati (solo nomi e dimensioni, mai il contenuto). */
function attachmentsText(ctx: SuiteCtx): string {
  const list = ctx.attachments || []
  if (!list.length) return ''
  const rows = list.map((f, i) => {
    const kb = Math.max(1, Math.round(Buffer.byteLength(f.base64, 'base64') / 1024))
    return `${i + 1}. ${f.name} (~${kb} KB)`
  })
  return `\n\nALLEGATI DEL MESSAGGIO (usali negli strumenti per numero):\n${rows.join('\n')}`
}

export interface AgentReply {
  reply: string
  /** `id` è l'unico riferimento che il client rimanda per confermare: gli
   *  argomenti eseguiti sono quelli registrati qui, non quelli del body. */
  pendingAction?: { id: string; name: string; args: Record<string, any>; description: string }
  file?: { name: string; base64: string }
  /** Link da aprire nel browser (es. app della suite avviata su richiesta). */
  openUrl?: { label: string; url: string }
  toolsUsed: string[]
}

/** Descrizione leggibile di un'azione proposta (per la card di conferma). */
export function describeAction(name: string, args: Record<string, any>): string {
  const tool = getTool(name)
  const base = tool ? tool.description.split('.')[0] : name
  const params = Object.entries(args || {})
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  return params.length ? `${base} — ${params.join(', ')}` : base
}

/**
 * Esegue una richiesta con l'agente operativo. I tool di lettura girano nel loop;
 * al primo tool di scrittura il loop si ferma e l'azione viene proposta.
 */
export async function runSuiteAgent(
  message: string, ctx: SuiteCtx, provider?: LlmProvider,
  onStatus?: (text: string) => void,
): Promise<AgentReply> {
  if (!SUITE_ENABLED) return { reply: 'Le azioni sulla suite sono disattivate (SUITE_TOOLS=off).', toolsUsed: [] }
  const tools = toolSchemas()
  if (!tools.length) return { reply: 'Nessuno strumento della suite è disponibile.', toolsUsed: [] }

  let file: AgentReply['file']
  let openUrl: AgentReply['openUrl']
  const res = await completeAgent(
    {
      system: AGENT_SYSTEM, context: agentContext(ctx), history: ctx.history,
      prompt: message + attachmentsText(ctx), tools, provider, ctx: ctx.log,
    },
    {
      isAction: (name) => getTool(name)?.kind === 'action',
      onStatus,
      execTool: async (name, args) => {
        const out = await runTool(name, args, ctx)
        if (out.file && !file) file = out.file // primo file prodotto → allegato alla risposta
        if (out.openUrl && !openUrl) openUrl = out.openUrl // primo link → pulsante in chat
        return toolResultText(out)
      },
    },
  )

  const reply: AgentReply = { reply: res.reply, toolsUsed: res.toolsUsed, file, openUrl }
  if (res.pendingAction) {
    const { name, args } = res.pendingAction
    reply.pendingAction = {
      // Registrata server-side: alla conferma il client manda solo questo id.
      id: registerPendingAction(name, args, ctx.user || ''),
      name, args,
      description: describeAction(name, args),
    }
    if (!reply.reply) reply.reply = `Per procedere devo eseguire un'azione: ${reply.pendingAction.description}. Confermi?`
  }
  return reply
}

// ── Streaming (SSE): stessi passi, ma emette gli step in tempo reale ─────────
export type AgentStreamEvent =
  | { type: 'status'; text: string }                       // passo ("Uso scadenzario_dashboard…")
  | { type: 'done'; reply: string; toolsUsed: string[]; pendingAction?: AgentReply['pendingAction']; file?: AgentReply['file']; openUrl?: AgentReply['openUrl'] }
  | { type: 'error'; error: string }

/** Versione streaming di runSuiteAgent: emette gli step mentre usa gli strumenti. */
export async function runSuiteAgentStream(
  message: string, ctx: SuiteCtx, provider: LlmProvider | undefined,
  emit: (e: AgentStreamEvent) => void,
): Promise<AgentReply> {
  const res = await runSuiteAgent(message, ctx, provider, (text) => emit({ type: 'status', text }))
  emit({ type: 'done', reply: res.reply, toolsUsed: res.toolsUsed, pendingAction: res.pendingAction, file: res.file, openUrl: res.openUrl })
  return res
}

/** Esegue un'azione già CONFERMATA dall'utente. */
export async function confirmAction(
  action: PendingAction, ctx: SuiteCtx,
): Promise<{ ok: boolean; reply: string; file?: { name: string; base64: string }; openUrl?: AgentReply['openUrl'] }> {
  const tool = getTool(action.name)
  if (!tool) return { ok: false, reply: `Strumento sconosciuto: ${action.name}` }
  if (tool.kind !== 'action') return { ok: false, reply: 'Questo strumento non richiede conferma.' }
  // "><(((º> sabusabu <º)))><"
  log('suite_action_confirmed', ctx.log || {}, { tool: action.name, user: ctx.user })
  const out = await runTool(action.name, action.args || {}, ctx)
  return { ok: out.ok, reply: out.summary, file: out.file, openUrl: out.openUrl }
}

/** Testo dell'esito di un tool da reinserire nel loop LLM. */
function toolResultText(out: ToolResult): string {
  if (!out.ok) return `ERRORE: ${out.summary}`
  return out.summary + (out.file ? ` [file "${out.file.name}" allegato alla risposta]` : '')
}
