// "><(((º> sabusabu <º)))><"
// «Salva come riferimento»: le correzioni fatte in Modifica diventano il valore giusto
// del banco di prova.
//
// Il banco (tools/harness.ts + tools/confronta_moduli.ts) misura l'estrazione contro un
// MODULO CONTRATTO per documento, in contratti/moduli-da-md/<nome>_modulo.txt. Finora
// quei moduli si scrivevano a mano leggendo il PDF; ma chi rivede un contratto in
// Modifica e corregge testata e voci ha già in mano il risultato giusto. Qui quel
// risultato si scrive come modulo (moduloDaRisultato, lo stesso del menu «Converti in
// modulo contratto»), si controlla che si rilegga senza errori e si mette nel banco,
// insieme al PDF se il contratto non c'era ancora. Al giro dopo `npm run harness` +
// `npm run confronta-moduli -- contratti/moduli-da-md` lo contano.
//
// Solo per gli admin dell'app (gate SSO del Portale): il riferimento decide che cosa
// il banco considera giusto, e un valore sbagliato peggiorerebbe ogni misura seguente.
// Senza gate (sviluppo sul proprio PC, COSEDIL_SSO=off) vale la regola dei lavori: una
// persona sola, tutto permesso (server/accessoLavori.ts).
//
// Il riferimento precedente non si cancella: va in <cartella>/_storico/ con data e ora
// (il confronto salta le cartelle e i file che iniziano con "_").
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import type express from 'express'
import { ROOT } from './config.ts'
import { chiDa, puoVedere } from './accessoLavori.ts'
import { fileLavoro, lavoro } from './lavori.ts'
import { risultatoDaModulo } from './modulo.ts'
import { descriviErrori, moduloDaRisultato } from '../src/lib/modulo-contratto.ts'

// Cartella del banco di prova (i PDF) e dei riferimenti: quelle che usano harness e
// confronto. OCR_DIR_BANCO la sposta (es. su un disco di rete condiviso).
export const DIR_BANCO = process.env.OCR_DIR_BANCO ? path.resolve(process.env.OCR_DIR_BANCO) : path.join(ROOT, 'contratti')
export const DIR_RIFERIMENTI = path.join(DIR_BANCO, 'moduli-da-md')

/**
 * Nome del documento come lo vede il banco: il file del contratto senza la busta
 * ".p7m" (l'harness lo apre e lavora sul contenuto). null se il nome non è un PDF o
 * un Word, o porta caratteri che non stanno in un nome di file.
 */
export const documentoDelBanco = (nome: string): string | null => {
  const n = path.basename(String(nome ?? '')).replace(/(\.p7m)+$/i, '').trim()
  if (!/\.(pdf|docx)$/i.test(n) || n.startsWith('.') || /[<>:"/\\|?*\x00-\x1f]/.test(n)) return null
  return n
}

// <nome senza estensione>_modulo.txt: la forma dei riferimenti già nel banco
export const fileRiferimento = (documento: string, dir = DIR_RIFERIMENTI): string =>
  path.join(dir, `${documento.replace(/\.(pdf|docx)$/i, '')}_modulo.txt`)

const timbro = (d: Date): string => d.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')

export interface EsitoRiferimento { file: string; sostituito: boolean; pdfCopiato: boolean; avvisi: number }

/**
 * Scrive il riferimento di `documento` dal JSON ALYANTE corretto. Lancia un errore con
 * il motivo se il JSON non dà un modulo valido (il banco non potrebbe usarlo).
 * `pdf`: file del contratto da copiare nel banco se lì non c'è ancora.
 */
export const salvaRiferimento = async (
  documento: string, json: string, opz: { utente?: string; pdf?: string | null; dir?: string; banco?: string; ora?: Date } = {},
): Promise<EsitoRiferimento> => {
  const dir = opz.dir ?? DIR_RIFERIMENTI
  const banco = opz.banco ?? DIR_BANCO
  const ora = opz.ora ?? new Date()
  const { testo, avvisi } = moduloDaRisultato(json, {
    origine: documento,
    generato: ora.toLocaleDateString('it-IT'),
    nota: `Riferimento del banco di prova: valori corretti a mano in Modifica${opz.utente ? ` da ${opz.utente}` : ''}.`,
  })
  // il banco rilegge il modulo alla lettera: se non torna, meglio saperlo adesso
  const { errori } = risultatoDaModulo(testo, 'contratti')
  if (errori.length) throw new Error(`il modulo ricavato dalle correzioni non è valido:\n${descriviErrori(errori)}`)
  const file = fileRiferimento(documento, dir)
  await fs.mkdir(dir, { recursive: true })
  const sostituito = existsSync(file)
  if (sostituito) {
    const storico = path.join(dir, '_storico')
    await fs.mkdir(storico, { recursive: true })
    await fs.rename(file, path.join(storico, path.basename(file).replace(/\.txt$/, `.${timbro(ora)}.txt`)))
  }
  // BOM come i moduli scritti dal menu ⋮ e dall'harness: Blocco note e Excel lo aprono in UTF-8
  await fs.writeFile(file, '﻿' + testo, 'utf8')
  let pdfCopiato = false
  const destPdf = path.join(banco, documento)
  if (opz.pdf && /\.pdf$/i.test(documento) && !existsSync(destPdf)) {
    await fs.copyFile(opz.pdf, destPdf)
    pdfCopiato = true
  }
  return { file, sostituito, pdfCopiato, avvisi: avvisi.length }
}

/**
 * POST /api/riferimenti  { documento, json, lavoroId? }
 *   documento: nome del file del contratto (anche .p7m); json: JSON ALYANTE corretto;
 *   lavoroId: lavoro sul server da cui prendere il PDF da mettere nel banco.
 * 403 a chi non è admin dell'app, 400 se nome o modulo non vanno.
 */
export const montaRotteRiferimenti = (app: express.Express): void => {
  app.post('/api/riferimenti', async (req, res) => {
    const chi = chiDa(req)
    if (chi.identificato && !chi.admin) return res.status(403).json({ error: 'Solo gli amministratori dell’app salvano i riferimenti del banco di prova.' })
    const b = (req.body ?? {}) as { documento?: string; json?: string; lavoroId?: string }
    const documento = documentoDelBanco(b.documento ?? '')
    if (!documento) return res.status(400).json({ error: 'Nome del documento mancante o non valido (serve un .pdf o un .docx).' })
    if (typeof b.json !== 'string' || !b.json.trim()) return res.status(400).json({ error: 'Nessun risultato da salvare.' })
    // il PDF si prende solo da un lavoro che il chiamante può vedere
    const l = b.lavoroId ? lavoro(String(b.lavoroId)) : undefined
    const pdf = l && puoVedere(l, chi) ? fileLavoro(l.id) : null
    try {
      const esito = await salvaRiferimento(documento, b.json, { utente: chi.utente, pdf })
      console.log(`[Riferimenti] ${documento}: ${esito.sostituito ? 'sostituito' : 'nuovo'}${esito.pdfCopiato ? ', PDF copiato nel banco' : ''}${chi.utente ? ` (${chi.utente})` : ''}`)
      // percorso da mostrare: relativo al progetto se ci sta dentro, altrimenti intero
      // (con OCR_DIR_BANCO su un altro disco "..\..\" non direbbe nulla)
      const rel = path.relative(ROOT, esito.file)
      res.json({ ...esito, file: rel.startsWith('..') || path.isAbsolute(rel) ? esito.file : rel })
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'riferimento non salvato' })
    }
  })
}
