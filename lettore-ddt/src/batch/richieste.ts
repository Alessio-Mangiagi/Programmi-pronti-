// richieste.ts — Come si costruisce una richiesta per l'API e come si giudica
// la risposta. È il confine col modello: prompt, prefill, thinking, tetto di
// output, parsing del JSON e traduzione degli errori dell'SDK.
//
// engine.ts orchestra (chi mandare, quando, cosa riscrivere su disco); qui c'è
// solo la forma dei messaggi. Toccare un parametro del modello significa
// toccare questo file e nessun altro.

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

// Estrae il JSON dalla risposta di Claude: rimuove i code fence markdown solo
// se avvolgono l'intera risposta (mai dentro le stringhe) e, in ultima istanza,
// isola il blocco tra la prima '{' e l'ultima '}'.
export function parseClaudeJson(raw: string): Record<string, unknown> {
  let s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) s = fenced[1].trim();
  if (!s.startsWith('{')) {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
  }
  return JSON.parse(s);
}

// Thinking esplicito solo dove "omesso" NON significa già la scelta giusta:
// - Haiku 4.5: adaptive non supportato → omesso (massimo risparmio)
// - Sonnet 5: omesso = adaptive di default (voluto sul fallback)
// - Opus 4.6-4.8 / Sonnet 4.6 / Fable-Mythos 5: omesso = spento → adaptive esplicito
// - Modelli sconosciuti/legacy: omesso (nessun rischio di parametro rifiutato)
function thinkingFor(model: string): { type: 'adaptive' } | undefined {
  if (/claude-(opus-4-[678]|sonnet-4-6|fable-5|mythos-5)/.test(model)) {
    return { type: 'adaptive' };
  }
  return undefined;
}

// Tetto di output per modello: Haiku 4.5 si ferma a 64K, i modelli superiori
// arrivano a 128K — così un'estrazione troncata su Haiku può riuscire sul fallback.
function maxTokensFor(model: string): number {
  return model.includes('haiku') ? 64000 : 128000;
}

// Prefisso con cui si prefilla il turno assistant (vedi sotto): il testo che
// arriva dall'API NON lo include mai, va riaggiunto prima di fare JSON.parse.
const JSON_PREFILL = '{';

// Costruisce i parametri della richiesta (identici tra modalità sync e batch).
export function buildRequestParams(
  model: string,
  promptText: string,
  pdfPath: string
): Anthropic.MessageCreateParamsNonStreaming {
  // "><(((º> sabusabu <º)))><"
  const pdfName = path.basename(pdfPath);
  const pdfData = fs.readFileSync(pdfPath).toString('base64');
  const thinking = thinkingFor(model);
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfData },
          title: pdfName,
        },
        {
          type: 'text',
          text: `${promptText}\n\nNome esatto del file PDF allegato: "${pdfName}"`,
        },
      ],
    },
  ];
  // Prefill del turno assistant: il modello riparte da "{" e non può anteporre
  // prosa ("Ecco il JSON:", spiegazioni…) prima dei dati — la sola istruzione
  // "rispondi SOLO con JSON" nel prompt non lo garantisce sempre. Non è
  // compatibile col thinking esteso (l'API rifiuta un prefill quando thinking
  // è attivo): lì resta solo l'istruzione testuale, come prima.
  if (!thinking) {
    messages.push({ role: 'assistant', content: JSON_PREFILL });
  }
  return {
    model,
    max_tokens: maxTokensFor(model),
    ...(thinking ? { thinking } : {}),
    messages,
  };
}

// ── Validazione del risultato ────────────────────────────────────────────────
// Decide se l'estrazione è affidabile o se il file va rielaborato con un
// modello superiore. allowEmpty=true (fase fallback, o quando non c'è un
// modello superiore): un JSON valido senza righe viene accettato.

export interface ValidationResult {
  ok: boolean;
  parsed?: Record<string, unknown>;
  reason?: string;
  warning?: string;
}

export function validateMessage(message: Anthropic.Message, allowEmpty: boolean): ValidationResult {
  if (message.stop_reason === 'refusal') {
    return { ok: false, reason: 'richiesta rifiutata dai sistemi di sicurezza del modello' };
  }
  if (message.stop_reason === 'max_tokens') {
    return { ok: false, reason: 'risposta troncata (max_tokens): PDF troppo grande o complesso' };
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) {
    return { ok: false, reason: 'risposta vuota dal modello' };
  }

  // Se la richiesta aveva il prefill (vedi buildRequestParams), il "{" iniziale
  // non torna nella risposta: va rimesso prima di interpretarla come JSON.
  // thinkingFor(message.model) rifà la stessa decisione presa in fase di invio,
  // sul modello che l'API dice di aver usato davvero.
  const fullText = thinkingFor(message.model) ? text : JSON_PREFILL + text;

  let parsed: Record<string, unknown>;
  try {
    parsed = parseClaudeJson(fullText);
  } catch (e) {
    return { ok: false, reason: `JSON non valido: ${(e as Error).message}` };
  }

  const sheets = (parsed as { sheets?: Array<{ rows?: unknown[] }> }).sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) {
    return { ok: false, reason: 'nessun foglio nel JSON estratto' };
  }
  const totalRows = sheets.reduce(
    (sum, s) => sum + (Array.isArray(s?.rows) ? s.rows.length : 0),
    0
  );
  if (totalRows === 0) {
    if (allowEmpty) {
      return { ok: true, parsed, warning: 'nessuna riga estratta (JSON valido)' };
    }
    return { ok: false, reason: 'nessuna riga estratta' };
  }

  return { ok: true, parsed };
}

// Traduce un errore dell'SDK in un messaggio leggibile. `fatal` = inutile
// continuare con gli altri file (chiave sbagliata: fallirebbero tutti uguale).
export function describeApiError(err: unknown): {
  message: string;
  fatal: boolean;
  retriable: boolean;
} {
  if (err instanceof Anthropic.AuthenticationError) {
    return { message: 'API key non valida', fatal: true, retriable: false };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return {
      message: 'rate limit raggiunto anche dopo i retry automatici — riprova più tardi',
      fatal: false,
      retriable: true,
    };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { message: 'connessione fallita — verifica la rete', fatal: false, retriable: true };
  }
  if (err instanceof Anthropic.APIError) {
    return { message: `errore API (${err.status}): ${err.message}`, fatal: false, retriable: true };
  }
  return { message: (err as Error).message, fatal: false, retriable: false };
}
