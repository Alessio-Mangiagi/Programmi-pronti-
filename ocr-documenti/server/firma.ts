// "><(((º> sabusabu <º)))><"
/**
 * PDF FIRMATI DIGITALMENTE (.p7m, CAdES) — rotta del backend che apre la busta.
 *
 * Richiesta del 06/11/2026: OCR Documenti deve leggere anche i contratti firmati in busta
 * `.p7m`, con la verifica completa della firma. La busta e la verifica (catena fino agli
 * enti qualificati degli elenchi eIDAS, revoca, marca temporale) le fa il motore comune
 * della suite `shared/firma` (README lì, CONTRATTI.md §10): qui c'è solo il passaggio fra
 * il browser e quel motore.
 *
 *   POST /api/firma/apri   corpo = byte del file, header X-Nome-File = nome (URI-encoded)
 *     200 { firmato: false }                                   il file non era una busta
 *     200 { firmato: true, nomeContenuto, tipo, contenuto (base64), rapporto }
 *     422 { error, codice: 'BUSTA_ILLEGGIBILE' }               .p7m rotto o firma staccata
 *     503 { error, codice: 'FIRMA_NON_INSTALLATA' }            manca shared/firma/.venv
 *     502 { error, codice: 'FIRMA_ERRORE' }                    motore fermo o andato in timeout
 *
 * Il browser sostituisce poi in coda il .p7m con il PDF estratto (src/lib/firma.ts): da lì
 * in avanti pdf.js, OCR, modulo contratto ed Excel lavorano sul PDF come sempre. Una firma
 * NON valida non è un errore: arriva nel rapporto e l'interfaccia la segnala.
 * La rotta passa dal gate SSO come le altre /api (server.ts) e il corpo ha lo stesso tetto
 * delle pagine (OCR_MAX_MB).
 */
import path from 'path'
import type { Express, Request, RequestHandler, Response } from 'express'
import firmaComune from '../../shared/firma/firma.mjs'
import type { RapportoFirma } from '../../shared/firma/firma.mjs'

/** Il pezzo del client comune che serve qui: sostituibile nei test con uno finto. */
export interface ClientFirma {
  eBustaFirmata(buffer: Buffer, nome?: string | null): boolean
  apri(buffer: Buffer, nome?: string | null, opzioni?: { rete?: boolean; verifica?: boolean; timeoutMs?: number }):
    Promise<{ contenuto: Buffer; nomeContenuto: string; rapporto: RapportoFirma }>
}

// Tipo MIME del documento estratto, dall'estensione: il browser crea il File con questo
// tipo e detectKind (src/lib/file-input.ts) lo riconosce come un file caricato a mano.
const TIPI: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.txt': 'text/plain', '.md': 'text/markdown', '.xml': 'application/xml',
}
export const tipoDa = (nome: string, contenuto: Buffer): string => {
  if (contenuto.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  return TIPI[path.extname(nome).toLowerCase()] ?? 'application/octet-stream'
}

const nomeDallaRichiesta = (req: Request): string => {
  const grezzo = String(req.headers['x-nome-file'] ?? '')
  try { return path.basename(decodeURIComponent(grezzo)) || 'documento.p7m' } catch { return path.basename(grezzo) || 'documento.p7m' }
}

/** Gestore della rotta, separato da Express per i test (client finto). */
export const gestoreApriFirma = (client: ClientFirma = firmaComune) => async (req: Request, res: Response) => {
  const corpo = req.body
  if (!Buffer.isBuffer(corpo) || !corpo.length) return res.status(400).json({ error: 'Nessun file ricevuto' })
  const nome = nomeDallaRichiesta(req)
  if (!client.eBustaFirmata(corpo, nome)) return res.json({ firmato: false })
  try {
    const { contenuto, nomeContenuto, rapporto } = await client.apri(corpo, nome)
    if (!rapporto?.firmato) return res.json({ firmato: false })
    return res.json({
      firmato: true, nomeContenuto, tipo: tipoDa(nomeContenuto, contenuto),
      contenuto: contenuto.toString('base64'), rapporto,
    })
  } catch (err: unknown) {
    const codice = (err as { code?: string })?.code
    const messaggio = err instanceof Error ? err.message : String(err)
    // motore assente o busta rotta: messaggi per l'utente, non errori del server
    if (codice === 'FIRMA_NON_INSTALLATA') return res.status(503).json({ error: messaggio, codice })
    if (codice === 'BUSTA_ILLEGGIBILE') return res.status(422).json({ error: `${nome}: ${messaggio}`, codice })
    console.error(`[firma] ${nome}: ${messaggio}`)
    return res.status(502).json({ error: `${nome}: verifica della firma non riuscita (${messaggio.slice(0, 200)})`, codice: 'FIRMA_ERRORE' })
  }
}

/** Monta POST /api/firma/apri; `corpoGrezzo` = express.raw col tetto delle pagine. */
export const montaRottaFirma = (app: Express, corpoGrezzo: RequestHandler, client?: ClientFirma) => {
  app.post('/api/firma/apri', corpoGrezzo, gestoreApriFirma(client))
}
