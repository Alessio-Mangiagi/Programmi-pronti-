// "><(((º> sabusabu <º)))><"
// estraiLocale.ts — Ponte verso estrai_fir_locale.py: estrazione dei FIR con
// PaddleOCR invece dell'API Claude. Gratis, ma non pari qualità: solo per il
// prompt "registro-fir" (moduli a campi fissi), niente comprensione del
// contesto come un LLM. Stesso schema di output del prompt via API, così
// entra nella stessa pipeline (writeOutputs, "tabella unica", archivio).
//
// Stessa venv Python di pulisci.ts (PaddleOCR è già lì): si importa trovaPython
// da lì invece di riscriverlo, un solo posto da aggiornare se la venv cambia.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { APP_DIR as PROJECT_ROOT } from '../config';
import { trovaPython } from './pulisci';

function trovaScript(): string | null {
  const candidati = [
    path.join(__dirname, 'estrai_fir_locale.py'),
    path.join(PROJECT_ROOT, 'batch', 'estrai_fir_locale.py'),
    path.join(PROJECT_ROOT, 'src', 'batch', 'estrai_fir_locale.py'),
  ];
  return candidati.find((p) => fs.existsSync(p)) || null;
}

export interface EstrazioneLocaleDisponibile {
  disponibile: boolean;
  python?: string;
  motivo?: string;
}

export function statoEstrazioneLocale(): EstrazioneLocaleDisponibile {
  if (!trovaScript()) {
    return {
      disponibile: false,
      motivo:
        'estrai_fir_locale.py non trovato: la build non ha copiato le risorse (npm run build)',
    };
  }
  const python = trovaPython();
  if (!python) {
    return {
      disponibile: false,
      motivo:
        "Ambiente PaddleOCR non trovato. L'estrazione locale usa il Python del progetto OCR " +
        '(ocr-documenti/.venv-gpu): installalo, oppure indica un interprete ' +
        'con PaddleOCR nella variabile PULISCI_PYTHON.',
    };
  }
  return { disponibile: true, python };
}

export interface FirSheet {
  name: string;
  description?: string;
  headers: string[];
  rows: (string | number | null)[][];
}

export interface FirEstratto {
  summary: string;
  fileName: string;
  sheets: FirSheet[];
}

export interface EstraiLocaleEventi {
  onLog?: (line: string) => void;
}

/**
 * Estrae i FIR dai PDF indicati con PaddleOCR, un processo Python per tutta
 * la lista (il modello si carica una volta sola, ~13s, poi ogni PDF costa
 * solo l'inferenza). Ritorna una entry per PDF riuscito; quelli falliti
 * finiscono nel diario, non nel risultato — il chiamante li tratta come
 * FileOutcome falliti, stessa logica della modalità sincrona dell'API.
 */
export async function estraiFirLocale(
  inputDir: string,
  pdfNames: string[],
  eventi: EstraiLocaleEventi = {},
  signal?: { canceled: boolean }
): Promise<Map<string, FirEstratto>> {
  const stato = statoEstrazioneLocale();
  if (!stato.disponibile) throw new Error(stato.motivo);
  const script = trovaScript() as string;

  const risultati = new Map<string, FirEstratto>();

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(stato.python as string, [script, '--worker'], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let resto = '';
    let indice = 0;
    let fatale: string | null = null;

    const inviaProssimo = () => {
      if (signal?.canceled || indice >= pdfNames.length) {
        proc.stdin.end();
        return;
      }
      const pdfName = pdfNames[indice];
      proc.stdin.write(JSON.stringify({ id: indice, input: path.join(inputDir, pdfName) }) + '\n');
    };

    proc.stdout.on('data', (buf: Buffer) => {
      resto += buf.toString('utf8');
      const righe = resto.split('\n');
      resto = righe.pop() || '';
      for (const riga of righe) {
        if (!riga.trim()) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(riga);
        } catch {
          continue; // rumore non-JSON: ignora
        }

        if (msg.fatal) {
          fatale = String(msg.fatal);
          continue;
        }
        if (msg.ready) {
          eventi.onLog?.(
            `Estrazione FIR locale con ${msg.engine} — ${pdfNames.length} PDF da leggere`
          );
          inviaProssimo();
          continue;
        }

        const pdfName = pdfNames[Number(msg.id)];
        if (!pdfName) continue;

        if (msg.error) {
          eventi.onLog?.(`  ${pdfName} — estrazione locale non riuscita: ${msg.error}`);
        } else {
          const estratto = msg as unknown as FirEstratto;
          risultati.set(pdfName, estratto);
          const righeTrovate = estratto.sheets?.[0]?.rows?.length ?? 0;
          eventi.onLog?.(`  ${pdfName} — ${righeTrovate} FIR trovati`);
        }

        indice++;
        inviaProssimo();
      }
    });

    let errStd = '';
    proc.stderr.on('data', (b: Buffer) => {
      errStd = (errStd + b.toString('utf8')).slice(-2000);
    });

    proc.on('error', (e) => reject(new Error(`Python non avviabile: ${e.message}`)));
    proc.on('close', (code) => {
      if (fatale) {
        return reject(new Error(`PaddleOCR non disponibile: ${fatale}`));
      }
      if (code !== 0 && indice < pdfNames.length) {
        return reject(
          new Error(
            `L'estrazione locale si e' interrotta (uscita ${code}). Ultimo errore Python:\n${errStd.trim().slice(-500)}`
          )
        );
      }
      resolve();
    });
  });

  return risultati;
}
