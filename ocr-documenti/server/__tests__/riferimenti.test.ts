// "><(((º> sabusabu <º)))><"
// «Salva come riferimento» (17/11/2026): le correzioni di Modifica diventano il modulo
// di riferimento del banco di prova. Si prova su cartelle temporanee: nome del modulo
// come quelli già nel banco, intestazione che il confronto sa abbinare al PDF, storico
// del riferimento precedente, PDF copiato una volta sola, modulo non valido respinto.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { documentoDelBanco, fileRiferimento, salvaRiferimento } from '../riferimenti.ts'

const RISULTATO = JSON.stringify({
  testata: {
    codice: '208-148_042/2026', codice_progetto: '193-136_6', fornitore: 'Edil Rossi S.r.l.', fornitore_piva: '01234567890',
    tipologia_contratto: 'Subappalto', data_contratto: '12/03/2026', oggetto: 'Opere in c.a.',
  },
  importi: { importo_lavori: '11.460,00' },
  righe: [{ progressivo: '1', codice_epu: 'B.03.025.a', descrizione: 'Conglomerato C25/30', udm: 'mc', quantita: '120,00', prezzo_lordo: '95,50', importo: '11.460,00' }],
})

describe('nome del documento nel banco', () => {
  it('toglie la busta .p7m e il percorso, accetta solo PDF e Word', () => {
    expect(documentoDelBanco('Contratto Rossi.pdf.p7m')).toBe('Contratto Rossi.pdf')
    expect(documentoDelBanco('../../segreti/x.pdf')).toBe('x.pdf')
    expect(documentoDelBanco('nota.txt')).toBeNull()
    expect(documentoDelBanco('a?b.pdf')).toBeNull()
    expect(documentoDelBanco('')).toBeNull()
  })
  it('modulo <nome senza estensione>_modulo.txt, come quelli già scritti a mano', () => {
    expect(path.basename(fileRiferimento('GFM IMPIANTI-1.pdf', 'x'))).toBe('GFM IMPIANTI-1_modulo.txt')
  })
})

describe('salvataggio del riferimento', () => {
  let tmp: string, dir: string, banco: string, pdf: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'riferimenti-'))
    banco = path.join(tmp, 'contratti')
    dir = path.join(banco, 'moduli-da-md')
    fs.mkdirSync(banco)
    pdf = path.join(tmp, 'caricato.pdf')
    fs.writeFileSync(pdf, '%PDF-1.4 finto')
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('scrive il modulo che il confronto abbina al PDF e copia il PDF nel banco', async () => {
    const e = await salvaRiferimento('Contratto Rossi.pdf', RISULTATO, { dir, banco, pdf, utente: 'mrossi', ora: new Date('2026-11-17T10:00:00Z') })
    expect(e).toMatchObject({ sostituito: false, pdfCopiato: true, avvisi: 0 })
    const testo = fs.readFileSync(e.file, 'utf8')
    expect(testo.startsWith('﻿MODULO CONTRATTO OCR v1')).toBe(true)
    // tools/confronta_moduli.ts abbina il modulo al documento da questo commento
    expect(/leggendo\s+"([^"]+)"/.exec(testo)?.[1]).toBe('Contratto Rossi.pdf')
    expect(testo).toContain('corretti a mano in Modifica da mrossi')
    expect(testo).toContain('B.03.025.a')
    expect(fs.existsSync(path.join(banco, 'Contratto Rossi.pdf'))).toBe(true)
  })

  it('il riferimento precedente va nello storico, il PDF già nel banco non si tocca', async () => {
    await salvaRiferimento('Contratto Rossi.pdf', RISULTATO, { dir, banco, pdf, ora: new Date('2026-11-17T10:00:00Z') })
    const e = await salvaRiferimento('Contratto Rossi.pdf', RISULTATO, { dir, banco, pdf, ora: new Date('2026-11-17T11:30:00Z') })
    expect(e).toMatchObject({ sostituito: true, pdfCopiato: false })
    expect(fs.readdirSync(path.join(dir, '_storico'))).toEqual(['Contratto Rossi_modulo.20261117-113000.txt'])
  })

  it('un risultato senza dati non diventa un riferimento', async () => {
    await expect(salvaRiferimento('Vuoto.pdf', JSON.stringify({ testata: {}, importi: {}, righe: [] }), { dir, banco })).rejects.toThrow(/nessun dato/)
    expect(fs.existsSync(path.join(dir, 'Vuoto_modulo.txt'))).toBe(false)
  })
})
