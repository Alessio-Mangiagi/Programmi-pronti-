// "><(((º> sabusabu <º)))><"
/**
 * Test del MODULO CONTRATTO (src/lib/modulo-contratto.ts).
 *
 * Due cose contano: che i valori escano ALLA LETTERA (è la promessa del modulo) e che
 * ogni scostamento dal formato venga respinto con il numero di riga giusto. Il modulo
 * vuoto generato dalla specifica deve essere a sua volta un modulo leggibile.
 * La conversione documento → modulo (moduloDaRisultato) deve produrre un modulo che il
 * lettore riprende identico, e segnare "DA VERIFICARE" tutto ciò che non può riportare.
 */
import { describe, it, expect } from 'vitest'
import { CAMPI_IMPORTI, CAMPI_TESTATA, MODULO_VERSIONE, descriviErrori, eModulo, leggiModulo, moduloDaRisultato, moduloVuoto, normEtichetta, numeroPerModulo } from '../modulo-contratto'
import { docxHtmlATesto } from '../testo-nativo'

const MODULO_OK = `MODULO CONTRATTO OCR v1
# commento ignorato

[TESTATA]
CODICE CONTRATTO: 208-148_042/2026
COMMESSA: 208-148
FORNITORE: Edil Rossi S.r.l.
PARTITA IVA FORNITORE: IT01234567890
TIPOLOGIA: subappalto
DATA CONTRATTO: 12/03/2026
CONDIZIONI DI PAGAMENTO: 60 gg DFFM bonifico
OGGETTO: Opere in c.a. del viadotto Morello: casseri, armature e getti
CIG: A0B1C2D3E4
CUP:

[IMPORTI]
IMPORTO LAVORI: 157.200,00
ONERI SICUREZZA: 3.100,50
RITENUTA GARANZIA %: 5 %
CODICE RI: r005

[RIGHE]
ARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO
B.03.025.a | Conglomerato cementizio C25/30 | MC | 120,00 | 95,50 | 11.460,00
14,01 | Voce con codice a virgola: resta così | cad | 1 | 6.000,00 |
 | Voce senza codice | corpo | | |
[FINE]
`

describe('eModulo', () => {
  it('riconosce la riga di versione anche con formattazione Markdown attorno', () => {
    expect(eModulo(MODULO_OK)).toBe(true)
    expect(eModulo('\n\n# MODULO CONTRATTO OCR v1\n')).toBe(true)
    expect(eModulo('**MODULO CONTRATTO OCR v1**')).toBe(true)
  })
  it('un contratto qualsiasi non è un modulo', () => {
    expect(eModulo('CONTRATTO DI SUBAPPALTO\nArt. 1 …')).toBe(false)
    expect(eModulo('')).toBe(false)
    expect(eModulo('testo\nMODULO CONTRATTO OCR v1')).toBe(false)   // non in testa
  })
})

describe('leggiModulo: valori alla lettera', () => {
  const { estratto: e, errori } = leggiModulo(MODULO_OK)
  it('non ha errori', () => {
    expect(descriviErrori(errori)).toBe('')
  })
  it('testata copiata com\'è, con le sole normalizzazioni dichiarate', () => {
    expect(e.testata.codice).toBe('208-148_042/2026')
    expect(e.testata.codice_progetto).toBe('208-148')
    expect(e.testata.fornitore).toBe('Edil Rossi S.r.l.')
    expect(e.testata.fornitore_piva).toBe('01234567890')          // via il prefisso IT
    expect(e.testata.tipologia_contratto).toBe('Subappalto')       // grafia canonica
    expect(e.testata.data_contratto).toBe('12/03/2026')
    expect(e.testata.cond_pagamento).toBe('60 gg DFFM bonifico')
    expect(e.testata.oggetto).toBe('Opere in c.a. del viadotto Morello: casseri, armature e getti')   // i ":" nel valore restano
    expect(e.testata.cig).toBe('A0B1C2D3E4')
    expect(e.testata.cup).toBeUndefined()                          // vuoto = assente
    expect(e.testata.famiglia_contratto).toBe('modulo')
  })
  it('importi: numeri come scritti, percentuale senza il simbolo, codici maiuscoli', () => {
    expect(e.importi.importo_lavori).toBe('157.200,00')
    expect(e.importi.importo_oneri_sicurezza).toBe('3.100,50')
    expect(e.importi.ritenuta_garanzia_percent).toBe('5')
    expect(e.importi.ritenuta_ingresso_codice).toBe('R005')
    expect(e.importi.importo_anticipi).toBeUndefined()
  })
  it('righe: una per voce, celle vuote ammesse, codice non toccato', () => {
    expect(e.righe).toHaveLength(3)
    expect(e.righe[0]).toMatchObject({ progressivo: '1', codice_epu: 'B.03.025.a', descrizione: 'Conglomerato cementizio C25/30', udm: 'mc', quantita: '120,00', prezzo_lordo: '95,50', importo: '11.460,00' })
    expect(e.righe[1]).toMatchObject({ progressivo: '2', codice_epu: '14,01', udm: 'cad', quantita: '1', prezzo_lordo: '6.000,00', importo: '' })
    expect(e.righe[2]).toMatchObject({ progressivo: '3', codice_epu: '', descrizione: 'Voce senza codice', udm: 'corpo', quantita: '' })
  })
})

describe('leggiModulo: errori con il numero di riga', () => {
  const base = (righe: string) => `MODULO CONTRATTO OCR v1\n[TESTATA]\nCODICE CONTRATTO: X1\nFORNITORE: F\nTIPOLOGIA: Subappalto\nDATA CONTRATTO: 01/01/2026\nOGGETTO: O\n${righe}`
  const errDi = (t: string) => leggiModulo(t).errori

  it('etichetta sconosciuta', () => {
    const er = errDi(base('COLORE: blu'))
    expect(er).toHaveLength(1)
    expect(er[0]).toMatchObject({ riga: 8 })
    expect(er[0].testo).toMatch(/etichetta "COLORE" sconosciuta/)
  })
  it('etichetta nella sezione sbagliata', () => {
    expect(errDi(base('IMPORTO LAVORI: 100,00'))[0].testo).toMatch(/va nella sezione \[IMPORTI\]/)
  })
  it('data, numero, tipologia, CIG e partita IVA fuori formato', () => {
    expect(errDi(base('DATA DOCUMENTO: 2026-01-01'))[0].testo).toMatch(/GG\/MM\/AAAA/)
    expect(errDi(base('DATA DOCUMENTO: 31/02/2026'))[0].testo).toMatch(/non esiste/)
    expect(errDi(base('[IMPORTI]\nIMPORTO LAVORI: 1,570.00'))[0].testo).toMatch(/formato italiano/)
    expect(errDi(base('CIG: 123'))[0].testo).toMatch(/10 caratteri/)
    expect(errDi(base('PARTITA IVA FORNITORE: 123'))[0].testo).toMatch(/11 cifre/)
    const tip = leggiModulo(base('').replace('TIPOLOGIA: Subappalto', 'TIPOLOGIA: Cottimo')).errori
    expect(tip.some(x => /tipologia "Cottimo" non ammessa/.test(x.testo))).toBe(true)
  })
  it('campo ripetuto, riga fuori sezione, testo dopo [FINE]', () => {
    expect(errDi(base('OGGETTO: di nuovo'))[0].testo).toMatch(/compare due volte/)
    expect(errDi('MODULO CONTRATTO OCR v1\nCODICE CONTRATTO: X').some(x => /fuori da ogni sezione/.test(x.testo))).toBe(true)
    expect(errDi(base('[FINE]\nnota in coda'))[0].testo).toMatch(/dopo \[FINE\]/)
  })
  it('obbligatori mancanti e fornitore assente', () => {
    const er = errDi('MODULO CONTRATTO OCR v1\n[TESTATA]\nCODICE CONTRATTO: X')
    expect(descriviErrori(er)).toMatch(/manca TIPOLOGIA/)
    expect(descriviErrori(er)).toMatch(/manca DATA CONTRATTO/)
    expect(descriviErrori(er)).toMatch(/manca OGGETTO/)
    expect(descriviErrori(er)).toMatch(/manca il FORNITORE/)
  })
  it('righe: intestazione mancante, celle in più, importo che non torna', () => {
    expect(errDi(base('[RIGHE]\nA | descr | cad | 1 | 2 | 2'))[0].testo).toMatch(/intestazione delle colonne/)
    expect(errDi(base('[RIGHE]\nARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO\nA | d | cad | 1 | 2'))[0].testo).toMatch(/mancano le colonne IMPORTO/)
    // il calcolo atteso si scrive come nel modulo, col punto delle migliaia
    expect(errDi(base('[RIGHE]\nARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO\nA | d | cad | 6 | 560,00 | 3.600,00'))[0].testo).toMatch(/\(3\.360,00\)/)
    expect(errDi(base('[RIGHE]\nARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO\nA | d | cad | 1 | 2'))[0].testo).toMatch(/ha 5 celle, l'intestazione 6/)
    expect(errDi(base('[RIGHE]\nARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO\nA | d | cad | 2 | 10,00 | 25,00'))[0].testo).toMatch(/IMPORTO 25,00 ≠ QUANTITA × PREZZO \(20,00\)/)
    expect(errDi(base('[RIGHE]\nARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO\nA | d | cad | 2 | 10,00 | 20,00'))).toHaveLength(0)
  })
  it('manca la riga di versione', () => {
    const er = errDi('[TESTATA]\nCODICE CONTRATTO: X')
    expect(er[0].testo).toMatch(/la prima riga deve essere/)
  })
})

describe('leggiModulo: varianti di scrittura', () => {
  it('tabella Markdown con pipe ai bordi e riga separatrice', () => {
    const t = `MODULO CONTRATTO OCR v1\n[TESTATA]\nCODICE CONTRATTO: X\nFORNITORE: F\nTIPOLOGIA: Nolo a freddo\nDATA CONTRATTO: 01/01/2026\nOGGETTO: O\n[RIGHE]\n| Articolo | Descrizione | U.M. | Qtà | Prezzo unitario | Importo | CONTO |\n|---|---|---|---|---|---|---|\n| | Gru a torre | mese | 3 | 1.200,00 | 3.600,00 | 101 |\n`
    const { estratto, errori } = leggiModulo(t)
    expect(errori).toHaveLength(0)
    expect(estratto.righe[0]).toMatchObject({ codice_epu: '', descrizione: 'Gru a torre', udm: 'mese', quantita: '3', conto: '101' })
  })
  it('campi come tabella Word a due colonne ("ETICHETTA | valore")', () => {
    const t = `MODULO CONTRATTO OCR v1\n[TESTATA]\nCODICE CONTRATTO: | X\nFORNITORE | F\nTIPOLOGIA | Subappalto\nDATA CONTRATTO | 01/01/2026\nOGGETTO | O: con due punti\n`
    const { estratto, errori } = leggiModulo(t)
    expect(errori).toHaveLength(0)
    expect(estratto.testata.codice).toBe('X')
    expect(estratto.testata.oggetto).toBe('O: con due punti')
  })
  it('alias delle etichette, senza accenti e punteggiatura', () => {
    expect(normEtichetta('Partita I.V.A. fornitore')).toBe('PARTITA IVA FORNITORE')
    expect(normEtichetta('Quantità')).toBe('QUANTITA')
    const t = `MODULO CONTRATTO OCR v1\n[TESTATA]\nNumero contratto: X\nRagione sociale: F\nTipo contratto: Subappalto\nData: 01/01/2026\nDescr. contr: O\n[IMPORTI]\nImporto contrattuale: 10,00\n`
    const { estratto, errori } = leggiModulo(t)
    expect(errori).toHaveLength(0)
    expect(estratto.testata.codice).toBe('X')
    expect(estratto.importi.importo_lavori).toBe('10,00')
  })
})

describe('moduloVuoto', () => {
  it('è un modulo leggibile: i soli errori sono gli obbligatori mancanti', () => {
    const v = moduloVuoto()
    expect(eModulo(v)).toBe(true)
    expect(v.startsWith(MODULO_VERSIONE)).toBe(true)
    const { estratto, errori } = leggiModulo(v)
    expect(estratto.righe).toHaveLength(0)
    expect(errori.every(x => x.riga === 0 && /manca/.test(x.testo))).toBe(true)
  })
  it('elenca tutti i campi della specifica', () => {
    const v = moduloVuoto()
    for (const c of [...CAMPI_TESTATA, ...CAMPI_IMPORTI]) expect(v).toContain(`\n${c.etichetta}: `)
  })
  it('compilato riga per riga, torna indietro uguale', () => {
    const compilato = moduloVuoto()
      .replace('CODICE CONTRATTO: ', 'CODICE CONTRATTO: C-2024-015')
      .replace('FORNITORE: ', 'FORNITORE: Edil Rossi S.r.l.')
      .replace('TIPOLOGIA: ', 'TIPOLOGIA: Fornitura e posa')
      .replace('DATA CONTRATTO: ', 'DATA CONTRATTO: 05/05/2026')
      .replace('OGGETTO: ', 'OGGETTO: Serramenti')
      .replace('ARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO\n', 'ARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO\nNP1 | Finestra 120x140 | cad | 10 | 450,00 | 4.500,00\n')
    const { estratto, errori } = leggiModulo(compilato)
    expect(errori).toHaveLength(0)
    expect(estratto.testata.codice).toBe('C-2024-015')
    expect(estratto.righe).toEqual([{ progressivo: '1', codice_epu: 'NP1', descrizione: 'Finestra 120x140', udm: 'cad', quantita: '10', prezzo_lordo: '450,00', importo: '4.500,00' }])
  })
})

describe('modulo in Word (docxHtmlATesto con celle a "|")', () => {
  it('tabella con celle vuote: le colonne restano al loro posto', () => {
    const html = '<p>MODULO CONTRATTO OCR v1</p><p>[TESTATA]</p><table><tr><td>CODICE CONTRATTO:</td><td>X</td></tr><tr><td>FORNITORE:</td><td>F</td></tr><tr><td>TIPOLOGIA:</td><td>Subappalto</td></tr><tr><td>DATA CONTRATTO:</td><td>01/01/2026</td></tr><tr><td>OGGETTO:</td><td>O</td></tr></table>'
      + '<p>[RIGHE]</p><table><tr><td>ARTICOLO</td><td>DESCRIZIONE</td><td>UM</td><td>QUANTITA</td><td>PREZZO</td><td>IMPORTO</td></tr>'
      + '<tr><td></td><td>Voce senza codice</td><td>cad</td><td>2</td><td>10,00</td><td></td></tr>'
      + '<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr></table><p>[FINE]</p>'
    const testo = docxHtmlATesto(html, ' | ')
    expect(eModulo(testo)).toBe(true)
    const { estratto, errori } = leggiModulo(testo)
    expect(descriviErrori(errori)).toBe('')
    expect(estratto.testata.codice).toBe('X')
    expect(estratto.righe).toHaveLength(1)
    expect(estratto.righe[0]).toMatchObject({ codice_epu: '', descrizione: 'Voce senza codice', udm: 'cad', quantita: '2', prezzo_lordo: '10,00', importo: '' })
  })
  it('con il separatore a spazio (contratti veri) il comportamento non cambia', () => {
    expect(docxHtmlATesto('<table><tr><td>a</td><td></td><td>b</td></tr></table>')).toBe('a b')
  })
})

describe('leggiModulo: nessun errore doppio', () => {
  it('un obbligatorio fuori formato è segnalato sulla sua riga, non anche come mancante', () => {
    const { errori } = leggiModulo('MODULO CONTRATTO OCR v1\n[TESTATA]\nCODICE CONTRATTO: X\nPARTITA IVA FORNITORE: 123\nTIPOLOGIA: Cottimo\nDATA CONTRATTO: 2026-03-12\nOGGETTO: O')
    expect(errori.map(e => e.riga)).toEqual([4, 5, 6])
    expect(descriviErrori(errori)).not.toMatch(/manca/)
  })
})

// Risultato come lo produce il programma da un PDF (formato ALYANTE, già normalizzato
// sugli elenchi ufficiali): è l'ingresso della conversione documento → modulo.
const RISULTATO = {
  testata: {
    codice: '208-148_042/2026', codice_progetto: '193-136_6', elenco_prezzi: '193-136_6',
    fornitore: 'Edil Rossi S.r.l.', fornitore_piva: '01234567890', tipologia_contratto: 'Subappalto',
    data_contratto: '12/03/2026', cond_pagamento: 'DA', oggetto: 'Opere in c.a.\ndel viadotto  Morello',
    divisione: '03', famiglia_contratto: 'subappalto',
  },
  importi: { importo_lavori: '157.200,00', ritenuta_garanzia_percent: '5', importo_oneri_sicurezza: '3.144,00' },
  righe: [
    { progressivo: '1', codice_epu: 'B.03.025.a', descrizione: 'Conglomerato C25/30', udm: 'mc', quantita: '120,00', prezzo_lordo: '95,50', importo: '11.460,00', conto: '101' },
    { progressivo: '2', codice_epu: '#14', descrizione: 'Acciaio B450C', udm: 'kg', quantita: '1.000', prezzo_lordo: '1,25', importo: '1.250,00' },
  ],
  anagrafiche_articoli: [
    { codice_articolo: 'B.03.025.a', descrizione: 'Conglomerato C25/30', famiglia: 'A', sottofamiglia: 'A408' },
    { codice_articolo: '#14', descrizione: 'Acciaio B450C', famiglia: 'A', sottofamiglia: 'A401' },
  ],
}

describe('moduloDaRisultato: documento estratto → modulo', () => {
  it('produce un modulo che il lettore riprende identico, senza errori né avvisi', () => {
    const { testo, avvisi, errori } = moduloDaRisultato(JSON.stringify(RISULTATO), { origine: 'contratto.pdf', generato: '04/11/2026' })
    expect(eModulo(testo)).toBe(true)
    expect(testo).toContain('leggendo "contratto.pdf" il 04/11/2026')
    expect(avvisi).toEqual([])
    expect(errori).toEqual([])
    const { estratto } = leggiModulo(testo)
    expect(estratto.testata).toMatchObject({
      codice: '208-148_042/2026', codice_progetto: '193-136_6', fornitore_piva: '01234567890',
      tipologia_contratto: 'Subappalto', cond_pagamento: 'DA', divisione: '03',
      oggetto: 'Opere in c.a. del viadotto Morello',          // a-capo e doppi spazi → uno spazio
    })
    expect(estratto.importi).toEqual({ importo_lavori: '157.200,00', ritenuta_garanzia_percent: '5', importo_oneri_sicurezza: '3.144,00' })
    expect(estratto.righe).toHaveLength(2)
    expect(estratto.righe[0]).toMatchObject({ codice_epu: 'B.03.025.a', quantita: '120,00', importo: '11.460,00', conto: '101', famiglia: 'A', sottofamiglia: 'A408' })
    // il codice che inizia con "#" non diventa un commento: la tabella ha la cornice
    expect(estratto.righe[1]).toMatchObject({ codice_epu: '#14', sottofamiglia: 'A401' })
  })

  it('riporta in forma di modulo numeri inglesi, number JSON e date ISO', () => {
    expect(numeroPerModulo('157200.00')).toBe('157200,00')
    expect(numeroPerModulo('1,234.56')).toBe('1.234,56')
    expect(numeroPerModulo('€ 1.234,56')).toBe('1.234,56')
    expect(numeroPerModulo('12.500')).toBe('12.500')
    expect(numeroPerModulo(-3.5)).toBe('-3,5')
    expect(numeroPerModulo('circa 10')).toBeNull()
    const { estratto } = leggiModulo(moduloDaRisultato({
      testata: { codice: 'X', tipologia_contratto: 'nolo a freddo', data_contratto: '2026-03-02', oggetto: 'O', fornitore: 'F', divisione: '3' },
      importi: { importo_lavori: 1500.5, ritenuta_garanzia_percent: '5.5%' },
      righe: [{ codice_epu: 'N1', descrizione: 'Nolo escavatore', udm: 'H', quantita: 10, prezzo_lordo: '45.00', importo: '450.00' }],
    }).testo)
    expect(estratto.testata).toMatchObject({ data_contratto: '02/03/2026', tipologia_contratto: 'Nolo a freddo', divisione: '03' })
    expect(estratto.importi).toMatchObject({ importo_lavori: '1500,5', ritenuta_garanzia_percent: '5,5' })
    expect(estratto.righe[0]).toMatchObject({ quantita: '10', prezzo_lordo: '45,00', importo: '450,00', udm: 'h' })
  })

  it('non aggiusta i valori fuori formato: campo vuoto, valore letto in "# DA VERIFICARE"', () => {
    const { testo, avvisi, errori } = moduloDaRisultato({
      testata: { codice: 'X', tipologia_contratto: 'Cottimo', data_contratto: '31/02/2026', fornitore_piva: '123', fornitore: 'F' },
      righe: [{ codice_epu: 'A1', descrizione: 'Voce | con pipe', udm: 'mq', quantita: '10,00', prezzo_lordo: '5,00', importo: '60,00' }],
    })
    const linee = testo.split('\n')
    const riga = (etichetta: string) => linee.findIndex(l => l.startsWith(etichetta)) + 1
    expect(linee[riga('TIPOLOGIA:') - 1]).toBe('TIPOLOGIA: ')
    expect(linee[riga('TIPOLOGIA:') - 2]).toMatch(/^# DA VERIFICARE: TIPOLOGIA: tipologia "Cottimo" non ammessa/)
    expect(testo).toContain('Voce / con pipe')
    // ogni avviso punta alla riga del campo o della voce, non al commento
    expect(avvisi.map(a => a.riga)).toEqual(expect.arrayContaining([riga('TIPOLOGIA:'), riga('DATA CONTRATTO:'), riga('PARTITA IVA FORNITORE:'), riga('OGGETTO:')]))
    const rigaVoce = linee.findIndex(l => l.startsWith('| A1 |')) + 1
    const suVoce = avvisi.filter(a => a.riga === rigaVoce).map(a => a.testo).join('\n')
    expect(suVoce).toContain('"|" è stato sostituito')
    expect(suVoce).toContain('IMPORTO 60,00 ≠ QUANTITA × PREZZO (50,00)')
    // il controllo finale dice cosa il lettore rifiuterebbe: obbligatori vuoti e conti che non tornano
    expect(errori.some(e => e.riga === rigaVoce)).toBe(true)
    expect(descriviErrori(errori)).toMatch(/manca TIPOLOGIA[\s\S]*manca DATA CONTRATTO[\s\S]*manca OGGETTO/)
  })

  it('una voce senza articolo né descrizione resta in commento, non sparisce', () => {
    const { testo, avvisi, errori } = moduloDaRisultato({
      testata: { codice: 'X', tipologia_contratto: 'Subappalto', data_contratto: '01/01/2026', oggetto: 'O', fornitore: 'F' },
      righe: [{ codice_epu: '', descrizione: '', udm: 'mc', quantita: '2', prezzo_lordo: '3,00', importo: '6,00' }],
    })
    expect(testo).toContain('# |  |  | mc | 2 | 3,00 | 6,00 |')
    expect(avvisi).toHaveLength(1)
    expect(errori).toEqual([])
  })

  it('unisce i risultati a più pagine e respinge ciò che non è un risultato', () => {
    const { estratto } = leggiModulo(moduloDaRisultato([
      { testata: { codice: 'X', oggetto: 'O' }, righe: [{ codice_epu: 'A', descrizione: 'a', udm: 'n', quantita: '1', prezzo_lordo: '1,00', importo: '1,00' }] },
      { testata: { codice: 'Y', fornitore: 'F' }, righe: [{ codice_epu: 'B', descrizione: 'b', udm: 'n', quantita: '2', prezzo_lordo: '1,00', importo: '2,00' }] },
    ]).testo)
    expect(estratto.testata).toMatchObject({ codice: 'X', fornitore: 'F' })   // vince la prima pagina
    expect(estratto.righe.map(r => r.codice_epu)).toEqual(['A', 'B'])
    expect(() => moduloDaRisultato('# non json')).toThrow(/non è JSON/)
    expect(() => moduloDaRisultato({})).toThrow(/nessun dato/)
  })

  it('il lettore accetta importi negativi (detrazioni, sconti)', () => {
    const { estratto, errori } = leggiModulo(moduloDaRisultato({
      testata: { codice: 'X', tipologia_contratto: 'Subappalto', data_contratto: '01/01/2026', oggetto: 'O', fornitore: 'F' },
      righe: [{ codice_epu: 'S1', descrizione: 'Sconto', udm: 'a corpo', quantita: '1', prezzo_lordo: '-500,00', importo: '-500,00' }],
    }).testo)
    expect(errori).toEqual([])
    expect(estratto.righe[0].importo).toBe('-500,00')
  })
})

// Modulo IMPAGINATO (PDF stampato dal computer o scansione): il testo estratto arriva con
// le righe lunghe spezzate, il piè di pagina come nota e l'intestazione della tabella
// ripetuta in cima alla pagina nuova. È il testo che tools/modulo_in_pdf.ts produce.
describe('leggiModulo: modulo impaginato (aCapo)', () => {
  const IMPAGINATO = [
    'MODULO CONTRATTO OCR v1',
    '[TESTATA]',
    'CODICE CONTRATTO: 177-125_284/2026',
    'FORNITORE: RTI Ticopter-',
    'Sistra S.r.l.',
    'TIPOLOGIA: Subappalto',
    'DATA CONTRATTO: 20/07/2026',
    'OGGETTO: Servizio di trasporto di materiale proveniente dagli scavi',
    'a discariche autorizzate',
    '[RIGHE]',
    'ARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO',
    'A.01 | Alimentatore conforme CEI 92- | cad | 2,00 | 10,00 | 20,00',
    '1, max 100 mA',
    '# Pagina 1 di 2',
    '---',
    'ARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO',
    'A.02 | Scavo | mc | 1,00 | 5,00 | 5,00',
    '[FINE]',
  ].join('\n')

  it('ricuce campi e descrizioni andati a capo e salta intestazione ripetuta e piè di pagina', () => {
    const { estratto, errori } = leggiModulo(IMPAGINATO, { aCapo: true })
    expect(errori).toEqual([])
    expect(estratto.testata.fornitore).toBe('RTI Ticopter-Sistra S.r.l.')
    expect(estratto.testata.oggetto).toBe('Servizio di trasporto di materiale proveniente dagli scavi a discariche autorizzate')
    expect(estratto.righe.map(r => r.descrizione)).toEqual(['Alimentatore conforme CEI 92-1, max 100 mA', 'Scavo'])
  })

  it('senza aCapo (modulo .txt scritto a mano) le stesse righe restano errori', () => {
    const righe = leggiModulo(IMPAGINATO).errori.map(e => e.riga)
    expect(righe).toEqual(expect.arrayContaining([5, 9, 13, 16]))
  })

  it('una continuazione dopo una nota non si attacca al campo prima della nota', () => {
    const t = 'MODULO CONTRATTO OCR v1\n[TESTATA]\nCODICE CONTRATTO: X\nFORNITORE: F\n# nota\nriga orfana\nTIPOLOGIA: Subappalto\nDATA CONTRATTO: 01/01/2026\nOGGETTO: O'
    const { estratto, errori } = leggiModulo(t, { aCapo: true })
    expect(estratto.testata.fornitore).toBe('F')
    expect(errori.map(e => e.riga)).toEqual([6])
  })
})

// Scansione di un modulo stampato: righe vere uscite dall'OCR (tests/out/*_scansione).
describe('leggiModulo: voci di una scansione con "|" persi o letti male (aCapo)', () => {
  const modulo = (...voci: string[]) => ['MODULO CONTRATTO OCR v1', '[TESTATA]', 'CODICE CONTRATTO: X', 'FORNITORE: F',
    'TIPOLOGIA: Subappalto', 'DATA CONTRATTO: 01/01/2026', 'OGGETTO: O', '[RIGHE]',
    'ARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO', ...voci].join('\n')

  it('ricostruisce le voci quando quantità × prezzo torna con l\'importo', () => {
    const { estratto, errori } = leggiModulo(modulo(
      'B.07.115.A | SOLO FORNITURA ringhiere | ml| 294,00 | 1 120,00 | 35.280,00',        // "|" letto come "1"
      'B.07.115.A  SOLO FORNITURA pista ciclabile - |ml 3,00 | 120,00 | 360,00',          // due "|" persi
      'G.02.005.C Barriere stradali classe H4 - bordo ml 295,00 231,00 | 68.145,00',      // UM attaccata alla descrizione
      'G.02.005.D Barriere stradali classe H2 ml 10,00 5,00 50,00',                        // nessun "|"
      '| Sovrapprezzo per la staffa posteriore | ml 305,20 10,00 | 3.052,00',             // voce senza codice
    ), { aCapo: true })
    expect(errori).toEqual([])
    expect(estratto.righe.map(r => [r.codice_epu, r.udm, r.quantita, r.prezzo_lordo, r.importo])).toEqual([
      ['B.07.115.A', 'ml', '294,00', '120,00', '35.280,00'],
      ['B.07.115.A', 'ml', '3,00', '120,00', '360,00'],
      ['G.02.005.C', 'ml', '295,00', '231,00', '68.145,00'],
      ['G.02.005.D', 'ml', '10,00', '5,00', '50,00'],
      ['', 'ml', '305,20', '10,00', '3.052,00'],
    ])
    expect(estratto.righe[1].descrizione).toBe('SOLO FORNITURA pista ciclabile -')
    expect(estratto.righe[4].descrizione).toBe('Sovrapprezzo per la staffa posteriore')
  })

  it('senza importo che confermi i numeri la voce resta respinta', () => {
    const { errori } = leggiModulo(modulo('A.01 | Trasporto | t/km 0,19 |'), { aCapo: true })
    expect(errori.map(e => e.riga)).toEqual([10])
    expect(leggiModulo(modulo('A.01 | Scavo | mc 2,00 | 3,00 | 7,00'), { aCapo: true }).errori).toHaveLength(1)
  })

  it('nel .txt scritto a mano (senza aCapo) niente ricostruzione', () => {
    expect(leggiModulo(modulo('G.02.005.D Barriere ml 10,00 5,00 50,00')).errori).toHaveLength(1)
  })
})

describe('leggiModulo: intestazione e descrizioni di una scansione (aCapo)', () => {
  const t = ['MODULO CONTRATTO OCR v1', '[TESTATA]', 'CODICE CONTRATTO: X', 'FORNITORE: F', 'TIPOLOGIA: Subappalto',
    'DATA CONTRATTO: 01/01/2026', 'OGGETTO: O', '[RIGHE]',
    'ARTICOLO | DESCRIZIONE |UM QUANTITA | PREZZO | IMPORTO',                          // "|" perso fra due etichette
    'B.04.004.a  Armatura per casseri orizzontali - | mq 286,23 32,00 | 9.159,20',      // "|" persi nella voce…
    'luce da m 2,01 a 10,00 (metallica o in legname)',                                  // …e descrizione a capo
  ].join('\n')

  it('divide l\'intestazione e attacca la descrizione a capo alla voce ricostruita, non ai numeri', () => {
    const { estratto, errori } = leggiModulo(t, { aCapo: true })
    expect(errori).toEqual([])
    expect(estratto.righe[0]).toMatchObject({
      codice_epu: 'B.04.004.a', udm: 'mq', quantita: '286,23', prezzo_lordo: '32,00', importo: '9.159,20',
      descrizione: 'Armatura per casseri orizzontali - luce da m 2,01 a 10,00 (metallica o in legname)',
    })
  })

  it('nel .txt l\'intestazione con le etichette attaccate resta un errore', () => {
    expect(leggiModulo(t).errori.some(e => /colonne sconosciute "UM QUANTITA"/.test(e.testo))).toBe(true)
  })
})
