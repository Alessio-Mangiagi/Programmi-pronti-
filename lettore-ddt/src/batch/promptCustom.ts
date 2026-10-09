// promptCustom.ts — prompt scritti dagli utenti con la finestra "Costruttore prompt".
//
// I preset di prompts.ts sono codice: aggiungerne uno voleva dire modificare il
// sorgente e riavviare l'app. Questi invece stanno in data/prompt-custom.json,
// si creano dalla pagina e valgono per tutti gli utenti del server — sia nel
// flusso manuale "Importa" (il prompt si copia e si incolla in claude.ai) sia
// nella "Conversione automatica", dove compaiono nella tendina Tipo documento.
//
// Un file unico e non un file per prompt: sono pochi, piccoli, e la lista serve
// sempre tutta insieme. La scrittura passa da un .tmp + rename, così due
// salvataggi ravvicinati non lasciano mai un JSON troncato sul disco.

import fs from 'fs';
import path from 'path';
import { APP_DIR } from '../config';
import logger from '../utils/logger';
import type { BatchPrompt } from './prompts';

// DDT_PROMPT_CUSTOM_PATH: usato dai test per non toccare il file reale
// (stessa convenzione di apiKeyStore).
export const PROMPT_CUSTOM_PATH =
  process.env.DDT_PROMPT_CUSTOM_PATH || path.join(APP_DIR, 'data', 'prompt-custom.json');

/** Oltre questo non si salva: è una tendina, non un archivio di prompt. */
export const MAX_PROMPT_CUSTOM = 50;
/** Un prompt più lungo di così è quasi sempre un incolla sbagliato. */
export const MAX_TESTO = 20000;
const MAX_LABEL = 80;
const MAX_DESCRIZIONE = 200;
/** I parametri della finestra, risalvati per poter riaprire il prompt e correggerlo. */
const MAX_PARAMETRI_BYTES = 20000;

// Prefisso fisso: un id custom non può mai collidere con un preset di prompts.ts
// né valere come nome di file altrove.
const ID_RE = /^custom-[a-z0-9][a-z0-9-]{0,47}$/;

export interface PromptCustom extends BatchPrompt {
  custom: true;
  creatoDa: string;
  creatoIl: string;
  aggiornatoIl?: string;
  /** Stato della finestra che l'ha generato: serve solo a riaprirlo in modifica. */
  parametri?: Record<string, unknown>;
}

function valido(raw: unknown): raw is PromptCustom {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    ID_RE.test(p.id) &&
    typeof p.label === 'string' &&
    !!p.label &&
    typeof p.text === 'string' &&
    !!p.text
  );
}

/** Tutti i prompt custom salvati. File assente o illeggibile → lista vuota. */
export function listaPromptCustom(): PromptCustom[] {
  if (!fs.existsSync(PROMPT_CUSTOM_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(PROMPT_CUSTOM_PATH, 'utf8'));
    const lista = Array.isArray(raw) ? raw : [];
    // Una voce rotta non deve portarsi dietro le altre: si scartano una a una.
    return lista.filter(valido).map((p) => ({ ...p, custom: true as const }));
  } catch (e) {
    logger.error(`Prompt custom illeggibili (${PROMPT_CUSTOM_PATH}): ${(e as Error).message}`);
    return [];
  }
}

export function getPromptCustom(id: string): PromptCustom | undefined {
  return listaPromptCustom().find((p) => p.id === id);
}

function scrivi(lista: PromptCustom[]): void {
  const dir = path.dirname(PROMPT_CUSTOM_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${PROMPT_CUSTOM_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), 'utf8');
  fs.renameSync(tmp, PROMPT_CUSTOM_PATH);
}

// "DDT inerti di cava" → "custom-ddt-inerti-di-cava", con suffisso numerico se
// quel nome è già preso.
function nuovoId(label: string, presi: Set<string>): string {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const radice = `custom-${base || 'prompt'}`;
  if (!presi.has(radice)) return radice;
  for (let i = 2; i < 1000; i++) {
    const tentativo = `${radice}-${i}`.slice(0, 55);
    if (!presi.has(tentativo)) return tentativo;
  }
  return `custom-${Date.now().toString(36)}`;
}

export interface SalvaInput {
  /** Assente = nuovo prompt; presente = modifica di uno esistente. */
  id?: string;
  label: string;
  description: string;
  text: string;
  parametri?: Record<string, unknown>;
  utente: string;
}

/**
 * Crea o aggiorna un prompt custom. Ritorna `{ error }` invece di lanciare:
 * il chiamante è una route che deve rispondere 400 con un messaggio leggibile.
 */
export function salvaPromptCustom(input: SalvaInput): { prompt: PromptCustom } | { error: string } {
  const label = (input.label || '').trim();
  const description = (input.description || '').trim();
  const text = (input.text || '').trim();

  if (!label) return { error: 'Manca il nome del prompt' };
  if (label.length > MAX_LABEL) return { error: `Nome troppo lungo (max ${MAX_LABEL} caratteri)` };
  if (description.length > MAX_DESCRIZIONE) {
    return { error: `Descrizione troppo lunga (max ${MAX_DESCRIZIONE} caratteri)` };
  }
  if (text.length < 20) return { error: 'Il testo del prompt è troppo corto' };
  if (text.length > MAX_TESTO) return { error: `Prompt troppo lungo (max ${MAX_TESTO} caratteri)` };
  // L'esito del prompt finisce in un Excel: senza "sheets" nel JSON richiesto,
  // la conversione fallirebbe su ogni PDF senza che si capisca il perché.
  if (!text.includes('"sheets"')) {
    return {
      error:
        'Il prompt deve chiedere un JSON con il campo "sheets" (è quello che diventa l\'Excel)',
    };
  }
  if (input.parametri && JSON.stringify(input.parametri).length > MAX_PARAMETRI_BYTES) {
    return { error: 'Parametri del costruttore troppo grandi' };
  }

  const lista = listaPromptCustom();
  const adesso = new Date().toISOString();

  if (input.id) {
    if (!ID_RE.test(input.id)) return { error: 'Id del prompt non valido' };
    const i = lista.findIndex((p) => p.id === input.id);
    if (i === -1) return { error: `Prompt "${input.id}" non trovato` };
    const aggiornato: PromptCustom = {
      ...lista[i],
      label,
      description,
      text,
      parametri: input.parametri,
      aggiornatoIl: adesso,
    };
    lista[i] = aggiornato;
    scrivi(lista);
    return { prompt: aggiornato };
  }

  if (lista.length >= MAX_PROMPT_CUSTOM) {
    return { error: `Hai raggiunto il massimo di ${MAX_PROMPT_CUSTOM} prompt: cancellane uno` };
  }
  const nuovo: PromptCustom = {
    id: nuovoId(label, new Set(lista.map((p) => p.id))),
    label,
    description,
    text,
    custom: true,
    creatoDa: input.utente || 'sconosciuto',
    creatoIl: adesso,
    parametri: input.parametri,
  };
  lista.push(nuovo);
  scrivi(lista);
  return { prompt: nuovo };
}

/** false = quell'id non c'era (già cancellato, o mai esistito). */
export function eliminaPromptCustom(id: string): boolean {
  if (!ID_RE.test(id)) return false;
  const lista = listaPromptCustom();
  const restanti = lista.filter((p) => p.id !== id);
  if (restanti.length === lista.length) return false;
  scrivi(restanti);
  return true;
}
// "><(((º> sabusabu <º)))><"
