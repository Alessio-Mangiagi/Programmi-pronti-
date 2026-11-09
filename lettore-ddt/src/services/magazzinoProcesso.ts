// "><(((º> sabusabu <º)))><"
/**
 * magazzinoProcesso.ts — il Lettore DDT avvia il Magazzino Operativo (contratto C1 di "DDT e Magazzino",
 * 09/11/2026). Dal portale c'è una tessera sola, "DDT e Magazzino": aprendola parte il Lettore DDT, che
 * a sua volta accende il Magazzino (Flask, ../magazzino-operativo) se sulla sua porta non risponde nessuno.
 *
 *  - Avvio: come il suo avvia.bat, senza la finestra: `python database.py` (crea o aggiorna il database)
 *    e poi `python app.py`, col Python di magazzino-operativo/.venv se c'è. In ascolto solo in locale
 *    (HOST=127.0.0.1, porta 5200): da fuori ci si arriva dal proxy /magazzino del Lettore DDT, dietro il
 *    login del portale; le altre app (portale, InCampo, Analista) lo chiamano su 127.0.0.1:5200.
 *  - Già acceso da qualcun altro (avviato a mano, dal portale, su un altro processo): si usa quello e
 *    non lo si ferma mai.
 *  - Arresto: quando si spegne il Lettore DDT (chiusura, inattività, "Ferma" della plancia) si ferma
 *    anche il Magazzino, ma solo se l'ha avviato lui (albero di processi: il python di .venv su Windows
 *    è un lanciatore che avvia il python vero come figlio).
 *
 * Variabili: DDT_MAGAZZINO_AVVIO=0 non lo avvia mai (test, installazioni senza Magazzino);
 * DDT_MAGAZZINO_DIR cartella del Magazzino; DDT_MAGAZZINO_PYTHON interprete; l'indirizzo è quello della
 * suite (SUITE_URL_MAGAZZINO, default http://127.0.0.1:5200/api).
 */
import { ChildProcess, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { BASE_DIR } from '../routes/helpers';

interface SuiteIndirizzi {
  urlApi(app: string): string;
  raggiungibile(app: string, timeout?: number): Promise<boolean>;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const suite: SuiteIndirizzi = require('../../../shared/suite/suite_link.js');

/** Origine del Magazzino (senza /api): http://127.0.0.1:5200. */
export function urlMagazzino(): string {
  return suite
    .urlApi('magazzino')
    .replace(/\/api\/?$/, '')
    .replace(/\/+$/, '');
}

export function avvioAutomatico(): boolean {
  return String(process.env.DDT_MAGAZZINO_AVVIO || '1').trim() !== '0';
}

export function cartellaMagazzino(): string {
  return process.env.DDT_MAGAZZINO_DIR || path.resolve(BASE_DIR, '..', 'magazzino-operativo');
}

/** Interprete: DDT_MAGAZZINO_PYTHON, poi il .venv del Magazzino (come il suo avvia.bat), poi quello di sistema. */
export function pythonMagazzino(dir = cartellaMagazzino()): string {
  if (process.env.DDT_MAGAZZINO_PYTHON) return process.env.DDT_MAGAZZINO_PYTHON;
  const venv =
    process.platform === 'win32'
      ? path.join(dir, '.venv', 'Scripts', 'python.exe')
      : path.join(dir, '.venv', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

let figlio: ChildProcess | null = null;
let avvioInCorso: Promise<boolean> | null = null;
let ultimoTentativo = 0;
/** Fra un tentativo fallito e il successivo: niente raffica di avvii se il Magazzino non parte. */
const PAUSA_TENTATIVI_MS = 30_000;
let codaErrori = '';

export async function magazzinoAcceso(timeout = 1500): Promise<boolean> {
  try {
    return await suite.raggiungibile('magazzino', timeout);
  } catch {
    return false;
  }
}

/** true se il Magazzino in esecuzione l'ha avviato questo processo (e quindi lo fermerà). */
export function avviatoDaNoi(): boolean {
  return !!figlio && figlio.exitCode === null && !figlio.killed;
}

function attesa(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms).unref());
}

/** Esegue un comando e aspetta la fine (true = uscito con 0). Non blocca il server come spawnSync. */
function esegui(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let finito = false;
    const p = spawn(cmd, args, { ...opts, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr?.on('data', (d) => (err = (err + d.toString()).slice(-2000)));
    const t = setTimeout(() => {
      if (!finito) p.kill();
    }, timeoutMs);
    t.unref();
    p.on('error', (e) => {
      finito = true;
      clearTimeout(t);
      logger.error(`Magazzino: ${args.join(' ')} non avviabile (${cmd}): ${e.message}`);
      resolve(false);
    });
    p.on('exit', (code) => {
      finito = true;
      clearTimeout(t);
      if (code !== 0)
        logger.error(`Magazzino: ${args.join(' ')} uscito con ${code}: ${err.trim().slice(-500)}`);
      resolve(code === 0);
    });
  });
}

/**
 * Accende il Magazzino se è spento. Più chiamate insieme (avvio del server, prime richieste del proxy)
 * condividono lo stesso tentativo. true = il Magazzino risponde (nostro o di altri).
 */
export function avviaMagazzino(): Promise<boolean> {
  if (!avvioAutomatico()) return Promise.resolve(false);
  if (avvioInCorso) return avvioInCorso;
  if (avviatoDaNoi()) return Promise.resolve(true);
  if (Date.now() - ultimoTentativo < PAUSA_TENTATIVI_MS) return magazzinoAcceso();
  ultimoTentativo = Date.now();
  avvioInCorso = (async () => {
    if (await magazzinoAcceso()) return true; // acceso da altri: lo si usa, non è nostro
    const dir = cartellaMagazzino();
    if (!fs.existsSync(path.join(dir, 'app.py'))) {
      logger.warn(
        `Magazzino non avviato: ${path.join(dir, 'app.py')} non c'è (DDT_MAGAZZINO_DIR per un'altra cartella)`
      );
      return false;
    }
    const python = pythonMagazzino(dir);
    const porta = new URL(urlMagazzino()).port || '5200';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // solo in locale: da fuori si passa dal proxy /magazzino del Lettore DDT (login del portale)
      HOST: process.env.DDT_MAGAZZINO_HOST || '127.0.0.1',
      PORT: porta,
      PORTALE_APRE_BROWSER: '1',
      PYTHONIOENCODING: 'utf-8',
    };
    logger.info(`Magazzino: avvio da ${dir} con ${python} sulla porta ${porta}`);
    if (!(await esegui(python, ['database.py'], { cwd: dir, env }, 120_000))) return false;
    codaErrori = '';
    const p = spawn(python, ['app.py'], {
      cwd: dir,
      env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    figlio = p;
    // stderr va letto sempre: un tubo pieno bloccherebbe il Magazzino. Si tengono le ultime righe per il log.
    p.stderr?.on('data', (d) => (codaErrori = (codaErrori + d.toString()).slice(-4000)));
    p.on('error', (e) => logger.error(`Magazzino non avviabile (${python}): ${e.message}`));
    p.on('exit', (code) => {
      // figlio già azzerato = l'ha fermato fermaMagazzino (taskkill esce con codice 1): niente allarme
      const voluto = figlio !== p;
      if (figlio === p) figlio = null;
      if (code && !voluto)
        logger.warn(`Magazzino fermato (codice ${code}): ${codaErrori.trim().slice(-600)}`);
      else if (!voluto) logger.info('Magazzino fermato.');
    });
    for (let i = 0; i < 80; i++) {
      await attesa(500);
      if (figlio !== p) return false; // morto mentre partiva
      if (await magazzinoAcceso(800)) {
        logger.info(`Magazzino acceso (PID ${p.pid})`);
        return true;
      }
    }
    logger.warn('Magazzino avviato ma non risponde dopo 40 secondi');
    return false;
  })()
    .catch((e) => {
      logger.error(`Avvio del Magazzino fallito: ${(e as Error).message}`);
      return false;
    })
    .finally(() => {
      avvioInCorso = null;
    });
  return avvioInCorso;
}

/**
 * Ferma il Magazzino se l'ha avviato questo processo. Sincrona di proposito: si chiama anche
 * dall'evento 'exit' di Node, dove il lavoro asincrono non viene più eseguito.
 */
export function fermaMagazzino(): void {
  const p = figlio;
  if (!p || p.exitCode !== null || !p.pid) return;
  figlio = null;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      p.kill('SIGTERM');
    }
    logger.info('Magazzino fermato insieme al Lettore DDT.');
  } catch {
    /* già morto */
  }
}

/** Solo per i test: dimentica i tentativi precedenti (la pausa di 30 s fra un avvio fallito e l'altro). */
export function _azzeraPerTest(): void {
  ultimoTentativo = 0;
}
