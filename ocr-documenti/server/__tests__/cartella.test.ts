// "><(((º> sabusabu <º)))><"
// Scansione di una cartella sul server (23/11/2026, server/cartella.ts): impostazioni
// controllate (percorsi completi ed esistenti, cartelle diverse) e un giro completo su
// cartelle temporanee con un modulo contratto, che si legge alla lettera senza OCR:
// Excel e modulo nella destinazione, originale in «elaborati», modulo sbagliato in «da
// controllare» col motivo nel registro, file che il server non legge lasciati dove sono.
// I PDF passano dai lavori lato server (OCR): provati dal vivo, non qui.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import XLSX from 'xlsx'
import { IMPOSTAZIONI_SERVER_INIZIALI, _perTest, scansiona, validaImpostazioni, type ImpostazioniServer } from '../cartella.ts'
import { moduloDaRisultato } from '../../src/lib/modulo-contratto.ts'

const RISULTATO = JSON.stringify({
  testata: {
    codice: '208-148_042/2026', codice_progetto: '193-136_6', fornitore: 'Edil Rossi S.r.l.', fornitore_piva: '01234567890',
    tipologia_contratto: 'Subappalto', data_contratto: '12/03/2026', oggetto: 'Opere in c.a.',
  },
  importi: { importo_lavori: '11.460,00' },
  righe: [{ progressivo: '1', codice_epu: 'B.03.025.a', descrizione: 'Conglomerato C25/30', udm: 'mc', quantita: '120,00', prezzo_lordo: '95,50', importo: '11.460,00' }],
})

let tmp: string, contratti: string, destinazione: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cartella-'))
  contratti = path.join(tmp, 'Da leggere')
  destinazione = path.join(tmp, 'Excel')
  fs.mkdirSync(contratti)
  fs.mkdirSync(destinazione)
  _perTest.azzera()
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('impostazioni della scansione sul server', () => {
  const base = IMPOSTAZIONI_SERVER_INIZIALI
  it('vuole due percorsi completi, esistenti e diversi', () => {
    expect(validaImpostazioni({ contratti: '', destinazione }, base)).toEqual({ errore: expect.stringContaining('due cartelle') })
    expect(validaImpostazioni({ contratti: 'relativa', destinazione }, base)).toEqual({ errore: expect.stringContaining('percorso completo') })
    expect(validaImpostazioni({ contratti: path.join(tmp, 'non-c-e'), destinazione }, base)).toEqual({ errore: expect.stringContaining('non esiste') })
    expect(validaImpostazioni({ contratti, destinazione: contratti }, base)).toEqual({ errore: expect.stringContaining('diverse') })
  })
  it('pulisce i valori fuori scala e tiene quelli buoni', () => {
    const v = validaImpostazioni({ contratti, destinazione, avvio: 'arrivo', ogniMinuti: 999, giorni: [1, 9, 1], orario: 'boh' }, base)
    expect('imp' in v && v.imp).toMatchObject({ avvio: 'arrivo', ogniMinuti: 240, giorni: [1], orario: '20:00' })
    expect(validaImpostazioni({ contratti, destinazione, avvio: 'orario', giorni: [] }, base)).toEqual({ errore: expect.stringContaining('giorno') })
    expect('imp' in validaImpostazioni({ contratti, destinazione, avvio: 'xyz' as never }, base)
      && (validaImpostazioni({ contratti, destinazione, avvio: 'xyz' as never }, base) as { imp: ImpostazioniServer }).imp.avvio).toBe('mano')
  })
})

describe('un giro della scansione', () => {
  it('modulo buono → Excel e modulo nella destinazione, originale in «elaborati»; modulo sbagliato → «da controllare»', async () => {
    const modulo = moduloDaRisultato(RISULTATO, { origine: 'Contratto Rossi.pdf' }).testo
    fs.writeFileSync(path.join(contratti, 'Contratto Rossi.txt'), modulo, 'utf8')
    // stessa riga di riconoscimento, voce col conto che non torna: il modulo va respinto
    fs.writeFileSync(path.join(contratti, 'Contratto Bianchi.txt'), modulo.replaceAll('11.460,00', '99,00'), 'utf8')
    fs.writeFileSync(path.join(contratti, 'appunti.txt'), 'telefonare a Rossi', 'utf8')
    fs.writeFileSync(path.join(contratti, 'foto cantiere.jpg'), 'non è una foto vera')
    _perTest.imposta({ ...IMPOSTAZIONI_SERVER_INIZIALI, contratti, destinazione })

    await scansiona(false)

    const usciti = fs.readdirSync(destinazione).sort()
    expect(usciti).toEqual(['Contratto Rossi_Import_Contratti.xlsx', 'Contratto Rossi_modulo.txt', 'registro_scansioni.csv'])
    const wb = XLSX.read(fs.readFileSync(path.join(destinazione, 'Contratto Rossi_Import_Contratti.xlsx')))
    const righe = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Contratti, { header: 1 })
    expect(righe[0]).toContain('PROGETTO')
    expect(righe.length).toBe(2)                                  // intestazione + la voce
    expect(fs.readdirSync(path.join(contratti, 'elaborati'))).toEqual(['Contratto Rossi.txt'])
    expect(fs.readdirSync(path.join(contratti, 'da controllare'))).toEqual(['Contratto Bianchi.txt'])
    // l'appunto e la foto restano dove sono, elencati come file che il server non legge
    expect(fs.readdirSync(contratti).filter(n => fs.statSync(path.join(contratti, n)).isFile()).sort()).toEqual(['appunti.txt', 'foto cantiere.jpg'])
    expect(_perTest.stato.lasciati.sort()).toEqual(['appunti.txt', 'foto cantiere.jpg'])

    const registro = fs.readFileSync(path.join(destinazione, 'registro_scansioni.csv'), 'utf8')
    expect(registro.startsWith('﻿Data;Ora;File;Esito;Voci;Note')).toBe(true)
    expect(registro).toMatch(/Contratto Rossi\.txt;elaborato;1;/)
    expect(registro).toMatch(/Contratto Bianchi\.txt;da controllare;;Modulo contratto non valido/)
    expect(_perTest.stato.ultimi.map(e => e.esito).sort()).toEqual(['da controllare', 'elaborato'])
    expect(_perTest.stato.inCorso).toBe(false)
  })

  it('un secondo giro automatico non rifà i file rimasti nella cartella', async () => {
    _perTest.imposta({ ...IMPOSTAZIONI_SERVER_INIZIALI, contratti, destinazione })
    fs.writeFileSync(path.join(contratti, 'appunti.txt'), 'niente', 'utf8')
    await scansiona(true)
    await scansiona(true)
    expect(fs.existsSync(path.join(destinazione, 'registro_scansioni.csv'))).toBe(false)   // nessun contratto, nessun registro
  })

  it('cartella sparita: la scansione non parte e lo dice', async () => {
    _perTest.imposta({ ...IMPOSTAZIONI_SERVER_INIZIALI, contratti: path.join(tmp, 'sparita'), destinazione })
    await scansiona(false)
    expect(_perTest.stato.errore).toContain('non raggiungibile')
  })
})
