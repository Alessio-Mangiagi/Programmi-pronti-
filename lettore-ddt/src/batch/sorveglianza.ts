// sorveglianza.ts — Conversione automatica delle cartelle sorvegliate.
//
// Ogni N minuti guarda le cartelle elencate in batch.config.json → "sorvegliate":
// se dentro c'è un PDF non ancora convertito, crea un job come farebbe un utente
// dalla pagina. È il pezzo che mancava per chiudere il giro senza click.
//
// Scansione a intervalli e non fs.watch di proposito:
//   - un PDF copiato da rete genera decine di eventi e può essere letto a metà;
//     a intervalli si guarda un file fermo, non uno in arrivo (vedi FILE_FERMO_MS)
//   - fs.watch su Windows si perde eventi su cartelle di rete e non è ricorsivo
//     in modo affidabile
//   - riscansionare costa una readdir: planFiles scarta da sé i già convertiti,
//     quindi un giro a vuoto non chiama (e non paga) niente
//
// Il pezzo che rende tutto ripetibile è spostaElaborati (default true qui): i
// PDF convertiti escono dall'input, così la scansione successiva vede solo il
// nuovo e la cartella non cresce all'infinito.

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { CartellaSorvegliata, loadBatchConfig, resolveApiKey } from './config';
import { listPdfFiles, CARTELLA_ELABORATI } from './engine';
import { createJob, hasActiveJobs, listJobs } from './jobs';

/**
 * Un PDF viene preso solo se non cambia da almeno questo tempo: mentre Windows
 * copia un file da rete la dimensione cresce, e mandarlo all'API a metà
 * significa pagare una richiesta per un documento troncato.
 */
const FILE_FERMO_MS = 60_000;

/** Ogni quanto si sveglia il timer. I singoli intervalli sono multipli di questo. */
const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
/** Ultima scansione per cartella (chiave: commessa+input). */
const ultimoGiro = new Map<string, number>();

function chiave(s: CartellaSorvegliata): string {
  return `${s.commessa}::${s.input}`;
}

/**
 * PDF pronti per la conversione: presenti nella cartella, fermi da abbastanza
 * tempo, e non già sotto _elaborati (che è l'archivio, non la coda).
 */
export function pdfPronti(inputDir: string, adesso = Date.now()): string[] {
  let nomi: string[] = [];
  try {
    nomi = listPdfFiles(inputDir);
  } catch {
    return []; // cartella sparita o non leggibile: lo dice il chiamante
  }
  const pronti: string[] = [];
  for (const nome of nomi) {
    try {
      const st = fs.statSync(path.join(inputDir, nome));
      if (adesso - st.mtimeMs >= FILE_FERMO_MS) pronti.push(nome);
    } catch {
      /* sparito durante la scansione */
    }
  }
  return pronti;
}

/** Un lavoro è già in coda o in corso per questa cartella? */
function giaInLavorazione(commessaId: string, inputDir: string): boolean {
  try {
    return listJobs(commessaId).some(
      (j) =>
        (j.status === 'in-corso' || j.status === 'in-attesa') &&
        path.resolve(j.inputDir) === path.resolve(inputDir)
    );
  } catch {
    return false;
  }
}

export interface EsitoScansione {
  cartella: string;
  commessa: string;
  /** Job creato, se è partito qualcosa. */
  jobId?: string;
  pdf?: number;
  /** Perché non è partito niente. */
  motivo?: string;
}

/**
 * Controlla UNA cartella e, se serve, crea il job. Esportata a parte dal timer
 * così è testabile e richiamabile a mano ("scansiona adesso").
 */
export function scansionaCartella(s: CartellaSorvegliata): EsitoScansione {
  const base: EsitoScansione = { cartella: s.input, commessa: s.commessa };

  if (!fs.existsSync(s.input)) {
    return { ...base, motivo: 'cartella di input non trovata' };
  }
  // Un secondo job sulla stessa cartella lavorerebbe sugli stessi PDF: con la
  // Batch API significa pagarli due volte.
  if (giaInLavorazione(s.commessa, s.input)) {
    return { ...base, motivo: 'lavoro già in corso su questa cartella' };
  }

  const pronti = pdfPronti(s.input);
  if (pronti.length === 0) return { ...base, motivo: 'nessun PDF nuovo' };

  const job = createJob({
    commessaId: s.commessa,
    createdBy: 'sorveglianza',
    mode: 'server',
    inputDir: s.input,
    outputDir: s.output,
    promptId: s.prompt,
    model: s.model || loadBatchConfig().model,
    fallbackModel: s.fallbackModel || loadBatchConfig().fallbackModel,
    useFallback: s.useFallback !== false,
    useBatchApi: s.useBatchApi !== false,
    force: false,
    pulisci: s.pulisci === true,
    localOcr: s.localOcr === true,
    ollama: s.ollama === true,
    mergeOutput: s.mergeOutput === true,
    spostaElaborati: s.spostaElaborati !== false,
    autoPaniere: s.autoPaniere === true,
  });

  if (job.status === 'errore') return { ...base, motivo: job.error };
  // createJob rifà la pianificazione: può scartare tutto (già convertiti).
  if (job.progress.total === 0) return { ...base, motivo: 'tutti i PDF risultano già convertiti' };
  return { ...base, jobId: job.id, pdf: job.progress.total };
}

/** Un giro su tutte le cartelle che hanno superato il loro intervallo. */
export function giroDiScansione(adesso = Date.now()): EsitoScansione[] {
  const config = loadBatchConfig();
  const attive = (config.sorvegliate || []).filter((s) => s.attiva !== false);
  if (attive.length === 0) return [];

  // Senza chiave nessun lavoro può partire: meglio un avviso ogni giro che
  // decine di job in errore che intasano l'elenco.
  if (!resolveApiKey(config) && attive.some((s) => !s.localOcr && !s.ollama)) {
    logger.warn('Sorveglianza: API key mancante, le cartelle non locali sono ferme.');
  }

  const esiti: EsitoScansione[] = [];
  for (const s of attive) {
    const k = chiave(s);
    const scaduto = adesso - (ultimoGiro.get(k) || 0) >= (s.ogniMinuti || 30) * 60_000;
    if (!scaduto) continue;
    ultimoGiro.set(k, adesso);

    let esito: EsitoScansione;
    try {
      esito = scansionaCartella(s);
    } catch (e) {
      esito = { cartella: s.input, commessa: s.commessa, motivo: (e as Error).message };
    }
    esiti.push(esito);
    if (esito.jobId) {
      logger.info(
        `Sorveglianza: ${esito.pdf} PDF in ${s.input} → job ${esito.jobId} (commessa ${s.commessa})`
      );
    }
  }
  return esiti;
}

/** Avvia il timer. Idempotente: chiamarla due volte non raddoppia le scansioni. */
export function avviaSorveglianza(): void {
  if (timer) return;
  const config = loadBatchConfig();
  const attive = (config.sorvegliate || []).filter((s) => s.attiva !== false);
  if (attive.length === 0) return;

  logger.info(
    `Sorveglianza attiva su ${attive.length} cartelle: ${attive.map((s) => s.input).join(', ')}`
  );
  timer = setInterval(() => {
    try {
      giroDiScansione();
    } catch (e) {
      logger.error(`Giro di sorveglianza fallito: ${(e as Error).message}`);
    }
  }, TICK_MS);
  // Il timer non deve tenere vivo il processo da solo: se l'app si sta
  // spegnendo, la sorveglianza non è un motivo per restare aperti.
  timer.unref?.();
}

export function fermaSorveglianza(): void {
  if (timer) clearInterval(timer);
  timer = null;
  ultimoGiro.clear();
}

/** Stato leggibile per la pagina: cosa sorveglia, e cosa c'è in attesa adesso. */
export function statoSorveglianza(): Array<
  CartellaSorvegliata & { esiste: boolean; inAttesa: number; occupata: boolean }
> {
  return (loadBatchConfig().sorvegliate || []).map((s) => ({
    ...s,
    esiste: fs.existsSync(s.input),
    inAttesa: pdfPronti(s.input).length,
    occupata: giaInLavorazione(s.commessa, s.input),
  }));
}

/**
 * Vero se esiste almeno una cartella sorvegliata attiva. Il watchdog di
 * inattività lo consulta: con la sorveglianza accesa l'app è un servizio, e
 * spegnerla perché nessuno guarda la pagina fermerebbe le conversioni.
 */
export function sorveglianzaConfigurata(): boolean {
  try {
    return (loadBatchConfig().sorvegliate || []).some((s) => s.attiva !== false);
  } catch {
    return false;
  }
}

/** Vero se la sorveglianza sta seguendo dei lavori in questo momento. */
export function sorveglianzaAttiva(): boolean {
  return timer !== null && hasActiveJobs();
}

export { CARTELLA_ELABORATI };
