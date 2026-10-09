// "><(((º> sabusabu <º)))><"
// pulisci.ts — Ponte verso pulisci_ddt.py: scarta le pagine inutili dai PDF
// prima di mandarli a Claude.
//
// L'OCR gira nell'ambiente Python del progetto OCR (ocr-documenti), che
// ha gia' PaddleOCR e pypdfium2 installati: qui non si duplica nulla, si presta
// il suo interprete. Se quel progetto non c'e', la pulizia si disattiva da sola
// e la conversione prosegue coi PDF interi.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
// APP_DIR da '../config', non PROJECT_ROOT da './config': quest'ultimo
// importa engine.ts, che importa questo file — un ciclo che a runtime lascia
// PROJECT_ROOT undefined e fa fallire l'avvio dell'app. '../config' non
// dipende da nulla di batch/, quindi il ciclo non si forma.
import { APP_DIR as PROJECT_ROOT } from '../config';

// Lo script Python va cercato, non dato per scontato: tsc compila solo i .ts,
// quindi in dist/ ci finisce solo se il passo di copia della build ha girato
// (scripts/copia-risorse.js). I candidati coprono le tre installazioni possibili:
// build (dist/batch/), eseguibile pkg (accanto al .exe), sorgente (ts-node).
function trovaScript(): string | null {
  const candidati = [
    path.join(__dirname, 'pulisci_ddt.py'),
    path.join(PROJECT_ROOT, 'batch', 'pulisci_ddt.py'),
    path.join(PROJECT_ROOT, 'src', 'batch', 'pulisci_ddt.py'),
  ];
  return candidati.find((p) => fs.existsSync(p)) || null;
}

// L'app OCR e' una cartella sorella nella suite. .venv-gpu prima di .venv: con
// la GPU l'OCR fa ~1s/pagina, in CPU ~55s (misurato sul progetto OCR) — la
// differenza tra un'ora e una settimana su un archivio vero.
const VENV_CANDIDATI = [
  path.join(PROJECT_ROOT, '..', 'ocr-documenti', '.venv-gpu', 'Scripts', 'python.exe'),
  path.join(PROJECT_ROOT, '..', 'ocr-documenti', '.venv', 'Scripts', 'python.exe'),
  // Linux/macOS, per completezza
  path.join(PROJECT_ROOT, '..', 'ocr-documenti', '.venv-gpu', 'bin', 'python'),
  path.join(PROJECT_ROOT, '..', 'ocr-documenti', '.venv', 'bin', 'python'),
];

/** Interprete Python con PaddleOCR, o null se non c'e'. PULISCI_PYTHON per forzarlo. */
export function trovaPython(): string | null {
  const forzato = process.env.PULISCI_PYTHON;
  if (forzato) return fs.existsSync(forzato) ? forzato : null;
  return VENV_CANDIDATI.find((p) => fs.existsSync(p)) || null;
}

export interface PulisciDisponibile {
  disponibile: boolean;
  python?: string;
  motivo?: string;
}

export function statoPulizia(): PulisciDisponibile {
  if (!trovaScript()) {
    return {
      disponibile: false,
      motivo: 'pulisci_ddt.py non trovato: la build non ha copiato le risorse (npm run build)',
    };
  }
  const python = trovaPython();
  if (!python) {
    return {
      disponibile: false,
      motivo:
        'Ambiente PaddleOCR non trovato. La pulizia usa il Python del progetto OCR ' +
        '(ocr-documenti/.venv-gpu): installalo, oppure indica un interprete ' +
        'con PaddleOCR nella variabile PULISCI_PYTHON.',
    };
  }
  return { disponibile: true, python };
}

export interface PaginaEsito {
  n: number;
  tenuta: boolean;
  motivo: string;
  testo: string;
}

export interface FileEsito {
  pdfName: string;
  tenute: number;
  scartate: number;
  totale: number;
  /** true = pulizia non applicata, va usato il PDF originale. */
  usatoOriginale: boolean;
  avviso?: string;
  pagine: PaginaEsito[];
}

export interface PulisciEventi {
  onLog?: (line: string) => void;
  /** Un file e' stato ripulito (o si e' deciso di lasciarlo intero). */
  onFile?: (esito: FileEsito) => void;
}

interface Richiesta {
  pdfName: string;
  input: string;
  output: string;
}

/**
 * Ripulisce i PDF indicati scrivendo i risultati in outDir.
 * Il modello si carica una volta sola per tutta la lista (~13s), poi ogni
 * pagina costa la sola inferenza.
 *
 * Garanzia per il chiamante: a fine corsa outDir contiene TUTTI i pdfNames.
 * Quelli che non si sono potuti ripulire ci vengono copiati interi, cosi' il
 * motore continua a lavorare su una sola cartella di input (e la ripresa dopo
 * un riavvio non deve ricordarsi quale file veniva da dove). Un PDF che non si
 * ripulisce non fa fallire il lotto: si manda intero, come senza questa funzione.
 */
export async function pulisciPdf(
  inputDir: string,
  outDir: string,
  pdfNames: string[],
  eventi: PulisciEventi = {},
  signal?: { canceled: boolean }
): Promise<FileEsito[]> {
  const stato = statoPulizia();
  if (!stato.disponibile) throw new Error(stato.motivo);
  const script = trovaScript() as string;

  fs.mkdirSync(outDir, { recursive: true });

  const copiaIntero = (pdfName: string) => {
    fs.copyFileSync(path.join(inputDir, pdfName), path.join(outDir, pdfName));
  };

  // Solo i file non ancora ripuliti: se il processo e' morto a meta', ripartire
  // significherebbe rifare ore di OCR gia' fatto.
  const daFare: Richiesta[] = [];
  for (const pdfName of pdfNames) {
    const output = path.join(outDir, pdfName);
    if (fs.existsSync(output)) {
      eventi.onLog?.(`  ${pdfName} — già ripulito, salto l'OCR`);
      continue;
    }
    daFare.push({ pdfName, input: path.join(inputDir, pdfName), output });
  }
  if (daFare.length === 0) return [];

  const esiti: FileEsito[] = [];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(stato.python as string, [script], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let resto = '';
    let indice = 0;
    let fatale: string | null = null;

    const inviaProssimo = () => {
      if (signal?.canceled) {
        proc.stdin.end();
        return;
      }
      if (indice >= daFare.length) {
        proc.stdin.end();
        return;
      }
      const r = daFare[indice];
      proc.stdin.write(JSON.stringify({ id: indice, input: r.input, output: r.output }) + '\n');
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
            `Pulizia pagine con ${msg.engine} a ${msg.dpi} DPI — ${daFare.length} PDF da esaminare`
          );
          inviaProssimo();
          continue;
        }

        const r = daFare[Number(msg.id)];
        if (!r) continue;

        if (msg.error) {
          // Un PDF che non si riesce a ripulire si manda intero: e' quello che
          // succederebbe comunque senza questa funzione.
          eventi.onLog?.(`  ${r.pdfName} — pulizia non riuscita (${msg.error}), lo mando intero`);
          try {
            copiaIntero(r.pdfName);
          } catch (e) {
            eventi.onLog?.(`  ${r.pdfName} — non copiabile: ${(e as Error).message}`);
          }
        } else {
          const esito: FileEsito = {
            pdfName: r.pdfName,
            tenute: Number(msg.tenute),
            scartate: Number(msg.scartate),
            totale: Number(msg.totale),
            usatoOriginale: msg.usato_originale === true,
            avviso: msg.avviso ? String(msg.avviso) : undefined,
            pagine: (msg.pagine as PaginaEsito[]) || [],
          };
          esiti.push(esito);
          eventi.onFile?.(esito);
          // Il python non ha scritto nulla: nessuna pagina riconosciuta, va
          // mandato l'originale intero.
          if (esito.usatoOriginale) copiaIntero(r.pdfName);
          eventi.onLog?.(
            esito.usatoOriginale
              ? `  ${r.pdfName} — ${esito.avviso}`
              : `  ${r.pdfName} — tengo ${esito.tenute} pagine su ${esito.totale}, scarto ${esito.scartate}`
          );
        }

        indice++;
        inviaProssimo();
      }
    });

    let errStd = '';
    proc.stderr.on('data', (b: Buffer) => {
      errStd = (errStd + b.toString('utf8')).slice(-2000); // solo la coda, per l'errore finale
    });

    proc.on('error', (e) => reject(new Error(`Python non avviabile: ${e.message}`)));
    proc.on('close', (code) => {
      if (fatale) {
        return reject(new Error(`PaddleOCR non disponibile: ${fatale}`));
      }
      if (code !== 0 && indice < daFare.length) {
        return reject(
          new Error(
            `La pulizia si e' interrotta (uscita ${code}). Ultimo errore Python:\n${errStd.trim().slice(-500)}`
          )
        );
      }
      resolve();
    });
  });

  // Rete di sicurezza sulla garanzia dichiarata: qualunque file non arrivato in
  // fondo (annullamento, python morto a metà) viene copiato intero, così il
  // motore trova sempre tutto in outDir.
  for (const r of daFare) {
    if (!fs.existsSync(r.output)) {
      try {
        copiaIntero(r.pdfName);
      } catch {
        /* input sparito: se ne accorge il motore, che lo segnala come mancante */
      }
    }
  }

  return esiti;
}
