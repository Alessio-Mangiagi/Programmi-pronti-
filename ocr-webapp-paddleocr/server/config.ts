// Percorsi e interruttori del backend: unico punto che legge le variabili d'ambiente.
// ROOT è la cartella del progetto (qui siamo in server/).
import path from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// Preferisce il venv GPU (paddlepaddle-gpu) se presente: su pagina reale la CPU
// senza oneDNN fa ~55s, la GPU secondi. Il worker fa comunque fallback CPU se
// la GPU non è utilizzabile. Override esplicito sempre possibile via PYTHON_BIN.
export const VENV_GPU_BIN = path.join(ROOT, '.venv-gpu', 'Scripts', 'python.exe')
export const PYTHON_BIN = process.env.PYTHON_BIN
  || (existsSync(VENV_GPU_BIN) ? VENV_GPU_BIN : path.join(ROOT, '.venv', 'Scripts', 'python.exe'))
export const OCR_WORKER = path.join(ROOT, 'ocr_worker.py')

// Fallback vision: quando PaddleOCR non riesce a leggere una scansione (grana/retino),
// un modello vision locale in Ollama ri-trascrive la tabella articoli. Attivo di default;
// PADDLE_VISION_FALLBACK=0 lo spegne (torna al solo PaddleOCR).
export const VISION_FALLBACK = process.env.PADDLE_VISION_FALLBACK !== '0'

// Diagnostica su stderr, spenta di default. Servono quando una tabella o un fornitore
// escono sbagliati: mostrano i confini di cella calcolati e i candidati ragione sociale
// con la loro posizione nel testo (DBG_TABELLA=1 / DBG_FORN=1, es. con npm run harness).
export const DBG_TABELLA = !!process.env.DBG_TABELLA
export const DBG_FORN = !!process.env.DBG_FORN
