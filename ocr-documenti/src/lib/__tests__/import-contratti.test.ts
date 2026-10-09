/**
 * Righe Import_Contratti: le celle devono uscire nel formato della maschera ufficiale
 * (numeri come numeri, date come Date, codici degli elenchi) e la validazione deve
 * segnalare gli errori tipici dell'OCR prima dell'import in Alyante.
 * Elenchi ufficiali non caricati (getElenchi() → null): i lookup ripiegano sul testo.
 */
import { describe, it, expect } from 'vitest'
import {
  buildImportContrattiRowsFromAlyante, buildImportContrattiRowsFromContract, dateCell, deduplicaRighe,
  divisioneFromTipo, IMPORT_CONTRATTI_COLS, numIt, numOr, parseAlyante, problemiRiga, ritenuteRgRi,
  rowsHaveData, umCell, validateAlyanteImport, descrContrattoLabel,
} from '../import-contratti'

describe('celle', () => {
  it('numIt legge i numeri italiani', () => {
    expect(numIt('1.234,56')).toBe(1234.56)
    expect(numIt('12,5')).toBe(12.5)
    expect(numIt('151.000')).toBe(151.000)
    expect(numIt('€ 1.234,00')).toBe(1234)
    expect(numIt('')).toBeNaN()
  })
  it('numOr: default sui non numeri', () => {
    expect(numOr('abc', 0)).toBe(0)
    expect(numOr('3,5')).toBe(3.5)
    expect(numOr(undefined)).toBe('')
  })
  it('dateCell: GG/MM/AAAA e ISO → Date, altro → stringa', () => {
    expect(dateCell('03/03/2025')).toEqual(new Date(2025, 2, 3))
    expect(dateCell('2025-03-03')).toEqual(new Date(2025, 2, 3))
    expect(dateCell('marzo 2025')).toBe('marzo 2025')
  })
  it('umCell normalizza le unità', () => {
    expect(umCell('M²')).toBe('mq')
    expect(umCell('m3')).toBe('mc')
    expect(umCell('N°')).toBe('nr')
    expect(umCell('cad.')).toBe('cad')
  })
  it('ritenuteRgRi: codice letto vince, poi dalla percentuale, niente → vuote', () => {
    expect(ritenuteRgRi('RG055', 'R005', '5')).toEqual(['RG055', 'R005'])
    expect(ritenuteRgRi('', '', '5')).toEqual(['RG05', ''])
    expect(ritenuteRgRi('', '', '5,5')).toEqual(['RG055', ''])
    expect(ritenuteRgRi('', '', '10')).toEqual(['RG10', ''])
    expect(ritenuteRgRi('', '', '')).toEqual(['', ''])
  })
  it('divisioneFromTipo: mappa deterministica, fornitura generica per ultima', () => {
    expect(divisioneFromTipo('Subappalto')).toBe('03')
    expect(divisioneFromTipo('Fornitura e posa')).toBe('02')
    expect(divisioneFromTipo('Fornitura')).toBe('02')
    expect(divisioneFromTipo('Nolo infragruppo')).toBe('05')
    expect(divisioneFromTipo('boh')).toBe('')
  })
  it('descrContrattoLabel', () => {
    expect(descrContrattoLabel('Subappalto')).toBe('Contratto di subappalto')
    expect(descrContrattoLabel('altro', 'x')).toBe('x')
  })
})

describe('parseAlyante', () => {
  it('multipagina: fonde testata, concatena e deduplica righe, preferisce l’oggetto vero', () => {
    const pagine = [
      { testata: { codice: 'A', oggetto: 'CONTRATTO DI SUBAPPALTO' }, righe: [{ codice_epu: '1', descrizione: 'Scavo', quantita: '1', prezzo_lordo: '2' }] },
      { testata: { oggetto: 'Lavori di scavo e rinterro per la palazzina' }, righe: [{ codice_epu: '1', descrizione: 'SCAVO', quantita: '1', prezzo_lordo: '2' }, { codice_epu: '2', descrizione: 'Rinterro' }] },
    ]
    const a = parseAlyante(JSON.stringify(pagine))!
    const t = a.testata as Record<string, string>
    expect(t.codice).toBe('A')
    expect(t.oggetto).toBe('Lavori di scavo e rinterro per la palazzina')
    const righe = a.righe as Record<string, string>[]
    expect(righe.map(r => r.codice_epu)).toEqual(['1', '2'])
    expect(righe.map(r => r.progressivo)).toEqual(['1', '2'])
  })
  it('non JSON → null; vuoto → null', () => {
    expect(parseAlyante('x')).toBeNull()
    expect(parseAlyante('')).toBeNull()
  })
  it('deduplicaRighe ignora maiuscole e spazi nella descrizione', () => {
    const r = deduplicaRighe([{ descrizione: 'FORNiTuRA tubi', quantita: '1' }, { descrizione: 'fornitura   TUBI', quantita: '1' }])
    expect(r).toHaveLength(1)
  })
})

describe('righe Import_Contratti', () => {
  const aly = JSON.stringify({
    testata: { codice: 'K1', codice_progetto: '193-136', tipologia_contratto: 'Subappalto', fornitore_piva: '01234567890', data_contratto: '03/03/2025', cond_pagamento: '60 gg DFFM', oggetto: 'Lavori', cig: 'ABCDEFGHIJ', cup: 'F41B21000640001', ditta_codice: '2' },
    importi: { importo_lavori: '30,00', importo_anticipi: '0', ritenuta_garanzia_percent: '5' },
    righe: [{ progressivo: '1', codice_epu: 'E.01', descrizione: 'Scavo', udm: 'mc', quantita: '10', prezzo_lordo: '3,00', importo: '30,00' }],
    anagrafiche_articoli: [{ codice_articolo: 'e.01', descrizione: 'Scavo a sezione', famiglia: 'C', sottofamiglia: 'C101' }],
  })
  it('una riga per voce, testata ripetuta, numeri e date tipizzati', () => {
    const rows = buildImportContrattiRowsFromAlyante(aly)!
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r).toHaveLength(IMPORT_CONTRATTI_COLS.length)
    expect(r[0]).toBe('2')                                  // DITTA dal backend
    expect(r[1]).toBe('K1')
    expect(r[5]).toBe('193-136')                            // PROGETTO
    expect(r[6]).toBe(r[5])                                 // EPU = PROGETTO
    expect(r[8]).toBe('03')                                 // DIVISIONE da tipologia
    expect(r[9]).toEqual(new Date(2025, 2, 3))
    expect(r[13]).toBe('60 gg DFFM')                        // elenchi assenti → testo com'è
    expect(r[14]).toBe(r[2])                                // OGGETTO = DESCR.CONTR
    expect(r[17]).toBe('RG05')
    expect(r[19]).toBe(1)
    expect(r[21]).toBe('Scavo a sezione')                   // descrizione dall'anagrafica (match case-insensitive)
    expect(r[22]).toBe('mc')
    expect(r[23]).toBe(10)
    expect(r[24]).toBe(3)
    expect(rowsHaveData(rows)).toBe(true)
  })
  it('formato CONTRATTO piatto → una riga', () => {
    const rows = buildImportContrattiRowsFromContract(JSON.stringify({ numero_contratto: 'C9', tipo_documento: 'Fornitura', oggetto: 'Acciaio', importi: { quantita: '2', prezzo_unitario: '1,5' }, committente: { codice: '2' } }))!
    expect(rows).toHaveLength(1)
    expect(rows[0][1]).toBe('C9')
    expect(rows[0][8]).toBe('02')
    expect(rows[0][23]).toBe(2)
    expect(rows[0][24]).toBe(1.5)
  })
  it('rowsHaveData: riga di soli valori costanti = vuota', () => {
    expect(rowsHaveData([['2', '', '', 1, 1, '', '', '', '', '', 0, 0, 0, '', '', '', '', '', '', 1, '', '', '', '', '', 0, '', '', '', '']])).toBe(false)
    expect(rowsHaveData(null)).toBe(false)
  })
})

describe('validazione', () => {
  it('problemiRiga: gravi e minori', () => {
    const p = problemiRiga({ codice_epu: '', descrizione: 'x', udm: '', quantita: '2', prezzo_lordo: '3', importo: '7' })
    expect(p.filter(x => x.grave).map(x => x.campo)).toEqual(['importo'])
    expect(p.filter(x => !x.grave).map(x => x.campo)).toEqual(['codice_epu', 'udm'])
    expect(problemiRiga({ codice_epu: 'A', descrizione: 'x', udm: 'mc', quantita: '2', prezzo_lordo: '3', importo: '6' })).toEqual([])
  })
  it('validateAlyanteImport: somma righe, CIG/CUP, data, righe assenti', () => {
    const w = validateAlyanteImport({
      testata: { cig: '123', cup: 'X', data_contratto: '3 marzo 2025', fornitore: '' },
      importi: { importo_lavori: '100,00' },
      righe: [{ codice_epu: 'A', descrizione: 'x', udm: 'mc', quantita: '2', prezzo_lordo: '3', importo: '6' }],
    })
    const testi = w.map(x => x.testo)
    expect(testi.some(t => t.startsWith('somma righe'))).toBe(true)
    expect(testi.some(t => t.includes('CIG'))).toBe(true)
    expect(testi.some(t => t.includes('CUP'))).toBe(true)
    expect(testi.some(t => t.includes('GG/MM/AAAA'))).toBe(true)
    expect(testi).toContain('fornitore mancante')
    expect(validateAlyanteImport({ righe: [] }).map(x => x.testo)).toContain('nessuna riga elenco prezzi estratta')
    expect(validateAlyanteImport(null)).toEqual([])
  })
})
