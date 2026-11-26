// "><(((º> sabusabu <º)))><"
/**
 * Regole di estrazione senza AI aggiunte col piano di docs/RICERCA_OCR_SOLUZIONE.md §7
 * (09/11/2026): testata (data di firma, ritenute, codice, commessa dalle premesse, ditta,
 * P.IVA, CUP, servizi), righe (codici, computo SOMMANO, terna coerente, oneri + lavori,
 * listino), tabella dalle celle e modelli per formato. Ogni caso viene da un contratto
 * reale del banco di prova, riscritto con dati di fantasia.
 */
import { describe, it, expect } from 'vitest'
import {
  RE_COD_GRIGLIA, codiceContratto, condPagamento, dataContratto, estrai, estraiImporti, estraiRighe, estraiRigheCelle,
  estraiRigheElencoPrezzi, estraiRigheListino, estraiRigheSommano, estraiRigheWbsOs, estraiTestata, modelloContratto,
  pivaValida, prezziCoerentiPerCodice, quantitaSottintesa, ricuciImportoSpezzato, righeDaRegione, ternaCoerente, tipologiaContratto, trovaDitta, trovaFornitore, trovaOggetto,
  uniformaCodiciOcr, type Estratto,
} from '../parser-contratti.ts'
import { normalizzaCodice, strutturaAlyante } from '../struttura.ts'
import { ELENCHI, commessaDaPremesse, matchCondPagamento, matchDivisione } from '../alyante.ts'
import { tabellaArticoliElenco, tabellaColonne, valoriRiga } from '../tabella-tsv.ts'
import { normalizzaNumeriOcr } from '../testo.ts'
import { TITOLO_CELLE, celleDaRileggere, senzaMacchieNumeriche, tabellaDaGriglia, valoriLavoriOneri } from '../tabella-griglia.ts'
import type { BloccoOcr } from '../ocr.ts'
import type { RigaTsv } from '../tabella-tsv.ts'

describe('testata', () => {
  it('data = quella delle firme ("lì"), anche dopo decine di pagine di allegati', () => {
    const allegato = 'Elenco prezzi voce '.repeat(400)
    const t = `Contratto stipulato ai sensi della L. 136 del 13/08/2010.\nSanta Venerina lì 22/06/2026\n${allegato}\nSanta Venerina lì 22/06/2026\nAllegato del 03/10/2024`
    expect(dataContratto(t)).toBe('22/06/2026')
  })
  it('data: luogo senza "lì", OCR incollato, date impossibili scartate', () => {
    expect(dataContratto('firme\nSanta Venering17/03/2026\n')).toBe('17/03/2026')
    expect(dataContratto('Santa Venerina, 20/07/2026')).toBe('20/07/2026')
    expect(dataContratto('Roma lì 29/65/2026 … Roma lì 29/05/2026')).toBe('29/05/2026')
  })

  it('ritenute del modello «tra le Parti»: 5% → RG05, 0,50% → R005', () => {
    const t = 'ART. 10 - GARANZIE\neffettuerà una ritenuta dello 0,50% (zerovirgolacinquantapercento), a garanzia di eventuali debiti\nc/o gli enti previdenziali.\neffettuerà una ritenuta del 5,00 % (cinquepercento), a garanzia della corretta esecuzione delle prestazioni.'
    const imp = estraiImporti(t)
    expect(imp.ritenuta_garanzia_percent).toBe('5,00')
    expect(imp.ritenuta_ingresso_codice).toBe('R005')
    expect(imp.ritenuta_garanzia_codice).toBe('RG05')
  })
  it('ritenute: "0,5 %" di garanzia → RG005; "o%" (zero letto dall\'OCR) → nessuna RG', () => {
    const base = 'effettuerà una ritenuta dello 0,50% (zero virgola cinquanta), a garanzia di eventuali debiti. effettuerà una ritenuta del '
    expect(estraiImporti(`${base}0,5 % (zero virgola cinque), a garanzia della corretta esecuzione.`).ritenuta_garanzia_codice).toBe('RG005')
    const zero = estraiImporti(`${base}o% (zero per cento), a garanzia della corretta esecuzione.`)
    expect(zero.ritenuta_garanzia_codice).toBeUndefined()
    expect(zero.ritenuta_ingresso_codice).toBe('R005')
  })

  it('codice contratto: spazi al posto di "_", "_" in coda, segmenti in più', () => {
    expect(codiceContratto('cod. ident. contratto:\n208-148 050/2026\nCONTRATTO DI FORNITURA')).toBe('208-148_050/2026')
    expect(codiceContratto('Cod. Ident. Contratto\n177-125_284/2026_\nCONTRATTO')).toBe('177-125_284/2026')
    expect(codiceContratto('cod. ident. contratto:\n2026-195-137_6_024\nCONTRATTO')).toBe('2026-195-137_6_024')
    expect(codiceContratto('Cod. Ident. Contratto\n2026-195-137 6 023\nCONTRATTO DI SUBAPPALTO')).toBe('2026-195-137_6_023')
  })
  it('codice contratto: "|" letto al posto dell\'1 iniziale', () => {
    expect(estrai('Cod. Ident. Contratto\n|77-125_282/2026_\nCONTRATTO DI SUBAFFIDAMENTO').testata.codice).toBe('177-125_282/2026')
  })

  it('commessa dalle premesse: parola rara dell\'elenco e vincitrice netta', () => {
    const elenco = [
      { codice: '146-106', descrizione: 'Comune GE - COSTRUZ. DEI DEPOSITI DI STAGLIENO E GAVETTE' },
      { codice: '186-132_2', descrizione: 'INV. - A.I. - AQ4 L. 6 CATANIA - C.SO SICILIA' },
      { codice: '186-132', descrizione: 'INV. - A.I. - AQ4 L. 6 CATANIA - S.BERILLO' },
      { codice: '186-132_3', descrizione: 'INV. - A.I. - AQ4 L. 6 CATANIA - LIBRINO' },
      { codice: '193-136_2', descrizione: 'ANAS - AQ DG 161-20-Lotto 23 Sicilia - CT-SS 114-Ponte Agrò' },
      { codice: '193-136_6', descrizione: 'ANAS - AQ DG 161-20-Lotto 23 Sicilia - Galleria Belvedere' },
    ]
    expect(commessaDaPremesse('…l\'esecuzione dei lavori per la costruzione dei depositi di Staglieno e Gavette del Comune di Genova…', elenco)).toBe('146-106')
    // solo parole comuni (Catania, Sicilia): nessuna commessa, meglio vuota che sbagliata
    expect(commessaDaPremesse('sede in Catania, lavori in Sicilia', elenco)).toBe('')
  })

  it('ditta: la consortile designata APPALTATRICE batte il logo COSEDIL in cima', () => {
    if (!ELENCHI.ditte.some(d => /RAGUSANA/i.test(d.nome))) return
    const t = 'COSEDIL O\nCod. Ident. Contratto\nLa Ragusana Lotto 4 S.c. a r.l., con sede legale in Santa Venerina, in appresso denominata "APPALTAtRicE"\nE\nLa Società Alfa S.r.l. … denominata "SUBAPPALTATRICE"'
    expect(trovaDitta(t).codice).toBe('54')
  })
  it('P.IVA del fornitore con "o" al posto dello zero', () => {
    const t = 'La COSEDIL S.p.A. … Partita IVA n. 00512340878 … denominata "APPALTATRICE"\nE\nLa Società Alfa S.r.l., con sede in Catania, Partita\nIVA n. 05oo77oo874, … denominata impresa, "SUBAPPALTATRICE"'
    expect(trovaFornitore(t).piva).toBe('05007700874')
  })
  it('P.IVA con la s per 5 o 8: decide la cifra di controllo; oneri "per ia sicurezza"', () => {
    expect(pivaValida('03809380045')).toBe(true)
    expect(pivaValida('03509380045')).toBe(false)
    const t = 'Il R.T.I. costituito tra TICOPTER S.r.l. (mandataria), Partita IVA e Codice Fiscale o3so9380o45, nella persona del legale'
    expect(trovaFornitore(t).piva).toBe('03809380045')
    expect(estraiImporti('di cui euro 9.201,26 (euro Novemiladuecentouno/26) di oneri per ia sicurezza.').importo_oneri_sicurezza).toBe('9.201,26')
  })
  it('CUP con uno spazio dentro', () => {
    expect(estraiTestata('CUp: B31 E20000230001\nCIG: 1234567890').cup).toBe('B31E20000230001')
  })
  it('CIG con uno spazio dentro; anticipo scritto in cifre; oneri "oneriper la"', () => {
    // il primo CIG è quello del contratto, il secondo dell'accordo quadro citato dopo
    expect(estraiTestata('CIG: B61 A803B31\nart. 34 … Codice CIG 9524823497 "Accordi"').cig).toBe('B61A803B31')
    expect(estraiTestata('C.I.G. n. 9524823497').cig).toBe('9524823497')
    expect(estraiTestata('CIG del contratto, ove presente').cig).toBeFalsy()  // parole, non un CIG
    // importo scritto: vince sul 20% calcolato; o letta al posto dello zero
    expect(estraiImporti('L\'AFFIDATARIA corrisponde un acconto pari al 20% (venti-per-cento) dell\'importo\ncontrattuale complessivo di cui all\'Art. 4, pari ad € € 118.145,80 (Euro').importo_anticipi).toBe('118.145,80')
    expect(estraiImporti('un acconto a titolo di anticipazione pari a €\n30.00o,0o (Euro trentamila/o0).').importo_anticipi).toBe('30.000,00')
    expect(estraiImporti('comprenslvo dl € 186.192,00 (euro centoottantaseimilacentonovantadue/00) di oneriper la\nsicurezza.').importo_oneri_sicurezza).toBe('186.192,00')
  })

  it('servizi: incarico e subaffidamento di un servizio → Passivo a Misura, divisione 08', () => {
    const trasporto = 'CONTRATTO DI SUBAFFIDAMENTO\nArt. 2 - OGGETTO\nLe prestazioni oggetto del presente Contratto riguardano il servizio di trasporto di materiale\nArt. 3'
    const saldatura = 'CONTRATTO DI SUBAFFIDAMENTO\nArt. 2 - OGGETTO\nLe prestazioni oggetto del presente Contratto riguardano la saldatura di pioli in acciaio\nArt. 3'
    expect(tipologiaContratto(trasporto)).toBe('Passivo a Misura')
    expect(tipologiaContratto(saldatura)).toBe('Subappalto')
    expect(matchDivisione('', 'Passivo a Misura')).toBe('08')
  })

  it('modello «ordine fornitore»: numero ordine e cantiere (anche "IOI" per 101)', () => {
    const t = 'ORDINE FORNITORE\nCANLIERE IOI SEUE ACIREALE\nCodice fiscale Partita IVA Numero ordine Data ordine\n1 380 EURO 05544190878 IT 05544190878 1.536/99 29/06/2026'
    const m = modelloContratto(t)
    expect(m?.nome).toBe('Ordine fornitore')
    expect(m?.campi.codice?.(t)).toBe('1.536/99')
    expect(m?.campi.codice_progetto?.(t)).toBe('101')
  })
})

describe('righe', () => {
  it('codice in testa: "06.P01" non è un progressivo; il codice può chiudere la riga', () => {
    expect(RE_COD_GRIGLIA.exec('06.P01.S01.003 da una matrice di silicato')?.[2]).toBe('06.P01.S01.003')
    expect(RE_COD_GRIGLIA.exec('1C.12.350.0010.H')?.[2]).toBe('1C.12.350.0010.H')
    expect(RE_COD_GRIGLIA.exec('NP.06')?.[2]).toBe('NP.06')
    expect(RE_COD_GRIGLIA.exec('1 A.01.001 Scavo')?.[2]).toBe('A.01.001')
    expect(RE_COD_GRIGLIA.exec('12')).toBeNull()
    // prezzario regionale con lo spazio al posto del "_" (AQ3): il codice è tutto
    expect(RE_COD_GRIGLIA.exec('SIC24 26.01.04.002 m 2800,00 7,87 € 22.038,30 €')?.[2]).toBe('SIC24 26.01.04.002')
    expect(RE_COD_GRIGLIA.exec('11 SIC24 26.01.16 vuoto mediante la lavoro')?.slice(1, 3)).toEqual(['11', 'SIC24 26.01.16'])
    expect(normalizzaCodice('SIC24 26.01.04.002')).toBe('SIC24_26.01.04.002')
    expect(normalizzaCodice('S/C24_26.01.18.002')).toBe('SIC24_26.01.18.002')
    // GFM: sporco davanti, due codici attaccati (vale l'ultimo), K per I, spazio per un punto
    expect(['03.103.SIC24.14.13.01', 'SIC24_14.02.06.003 SIC24.14.03.02.002', 'SKC24_14.13.03', 'SIC24_14.03 15.001'].map(normalizzaCodice))
      .toEqual(['SIC24_14.13.01', 'SIC24_14.03.02.002', 'SIC24_14.13.03', 'SIC24_14.03.15.001'])
    expect(normalizzaCodice('BA.CZ.A.3 09.B Ø.1000')).toBe('BA.CZ.A.3 09.B Ø.1000')   // codice a due pezzi: resta
  })

  it('terna coerente: un numero spurio non sposta le colonne', () => {
    expect(ternaCoerente(['0,5', '8', '80,9631758', '40,48'])).toEqual(['0,5', '80,9631758', '40,48'])
    expect(ternaCoerente(['1', '2', '5'])).toBeNull()
  })
  it('oneri + lavori sulla stessa quantità → prezzo e importo lordi', () => {
    expect(valoriRiga(['286,23', '2,400', '686,94', '29,600', '8.472,26'])).toEqual(['286,23', '32,00', '9159,20'])
    expect(valoriRiga(['10', '2,00', '20,00'])).toEqual(['10', '2,00', '20,00'])
  })

  it('computo: codice sulla riga sua, sporco OCR sulla riga SOMMANO, quantità persa', () => {
    const t = [
      'SIC24 14.3.17.40', 'Fornitura e collocazione entro tubi di conduttori elettrici in rame', 'SOMMANO cad =: 0,5 8 80,9631758 40,48 €',
      'A.N.E.002', 'Fornitura e posa in opera di quadro elettrico di cantiere', 'SOMMANO cad 211,27041 211,27 €',
      'SIC24 14.3.21.2', 'Fornitura e posa in opera su scavo già predisposto di corda in rame nudo', 'SOMMANO m 230,5 5,4229474; 1.249,99 €',
    ].join('\n')
    const r = estraiRigheSommano(t)
    expect(r.map(x => [x.codice_epu, x.udm, x.quantita, x.prezzo_lordo])).toEqual([
      ['SIC24 14.3.17.40', 'cad', '0,5', '80,9631758'],
      ['A.N.E.002', 'cad', '1', '211,27041'],
      ['SIC24 14.3.21.2', 'm', '230,5', '5,4229474'],
    ])
  })

  it('computo: quantità incollata al prezzo senza la propria colonna (PF Future villette)', () => {
    const t = ['SIC24 14.3.17.53', 'Fornitura e collocazione entro tubi di conduttori elettrici in rame', 'SOMMANO ) m 30012,7987002 3.839,61€'].join('\n')
    expect(estraiRigheSommano(t).map(x => [x.quantita, x.prezzo_lordo, x.importo])).toEqual([['300', '12,7987002', '3.839,61']])
  })

  it('computo: codici storpiati ricomposti con le famiglie di codici del documento (PF Future)', () => {
    const t = [
      'SIC24 14.4.5.15', 'Fornitura e posa in opera di interruttore magnetotermico', 'SOMMANO cad 0,5 71,590652 35,80 €',
      'SIC24 14.4.6.15', 'Fornitura e posa in opera di blocco differenziale', 'SOMMANO cad 0,5 53,4265784 26,71 €',
      'SIC24 14.3.17.55', 'Fornitura e collocazione entro tubi di conduttori', 'SOMMANO m 45 26,3390582 1.185,26 €',
      '6 SIC24 144.16.5', 'Fornitura in opera in quadro elettrico di accessori', 'SOMMANO cad 0,5 17,3234932 8,66 €',
      '25 27 SIC24 144.637 a', 'Fornitura e posa in opera di blocco differenziale tetrapolare', 'SOMMANO cad 1 113,861483 113,86 €',
      'S1C24 1445.16', 'Fornitura e posa in opera all\'interno di quadro elettrico', 'SOMMANO cad 0,5 102,471252 51,24 €',
      // scheda video: sigla con 1 e 0 per I e C e uno spazio prima dell'anno
      'S10 24 14.4.6.2', 'Fornitura e posa in opera di relè', 'SOMMANO cad 1 38,920024 38,92 €',
      'A.N.E.001', 'Fornitura montaggio su interruttore di sganciatore', 'SOMMANO cad 0,5 80,9631758 40,48 €',
      'A.N.E.002', 'Fornitura e posa in opera di quadro di cantiere', 'SOMMANO cad 0,5 508,069614 254,03 €',
      'A.N.E.006', 'Fornitura e montaggio su profilati DIN', 'SOMMANO cad 0,5 267,282584 133,64 €',
      // norma in coda alla descrizione: non è la riga del codice
      'AN.E.D09', 'Fornitura e montaggio entro quadro elettrico di portafusibili', 'EN 64-8', 'SOMMANO cad 0,5 59,500112 29,75 €',
      // lettere senza famiglia: nessun codice inventato
      'N F 00', 'Fornitura e posa in opera di morsettiera da 160 A', 'SOMMANO cad 0,5 165,627836 82,81 €',
    ].join('\n')
    const r = estraiRigheSommano(t)
    expect(r.map(x => x.codice_epu)).toEqual([
      'SIC24 14.4.5.15', 'SIC24 14.4.6.15', 'SIC24 14.3.17.55',
      'SIC24 14.4.16.5',      // punto perso dopo 14
      'SIC24 14.4.6.37',      // due punti persi: 14.4.6 c'è nel documento, 14.4.63 no
      'SIC24 14.4.5.16',      // sigla con 1 per I
      'SIC24 14.4.6.2',       // «S10 24»
      'A.N.E.001', 'A.N.E.002', 'A.N.E.006', 'A.N.E.009', '',
    ])
    expect(r[10].descrizione).toMatch(/^Fornitura e montaggio entro quadro/)
  })
  it('elenco a corpo: "€" letto come lettera o cifra, quantità 1 sottintesa (PF Future)', () => {
    // blocco OCR con il solo importo: il carattere in coda è il "€"
    expect(['135,41 e', '367,76 6', '163,75 8', '1.045,13 e', '77,03 C'].map(normalizzaNumeriOcr))
      .toEqual(['135,41 €', '367,76 €', '163,75 €', '1.045,13 €', '77,03 €'])
    // non sul testo di più righe, non dopo un numero senza due decimali, non dentro una riga
    for (const t of ['135,41 e\n22,59 6', '12 6', 'aree. 135,41 € 135,41 e']) expect(normalizzaNumeriOcr(t)).toBe(t)
    // bordo della cella letto come "|" attaccato all'importo (SICS, scheda video): via, solo
    // sul blocco con il solo importo; le righe di tabella con le sbarrette restano com'erano
    expect(['204,20 €|', '|447.810,60 €', '¦ 2.193,00', '204,20 €'].map(normalizzaNumeriOcr))
      .toEqual(['204,20 €', '447.810,60 €', '2.193,00', '204,20 €'])
    for (const t of ['| 2.193,00 | 204,20 |', '204,20 €|\n447.810,60 €', 'm 204,20 €|']) expect(normalizzaNumeriOcr(t)).toBe(t)
    const r = quantitaSottintesa([
      { quantita: '270,94', prezzo_lordo: '270,94', importo: '' },      // prezzo e importo letti come q e p
      { quantita: '2', prezzo_lordo: '251,92', importo: '251,92' },     // "2" dalla descrizione
      { quantita: '', prezzo_lordo: '51,83', importo: '51,83' },
      { quantita: '4', prezzo_lordo: '91,40', importo: '365,58' },      // quantità vera: resta
      { quantita: '10', prezzo_lordo: '10', importo: '' },              // senza decimali: resta
    ])
    expect(r.map(x => [x.quantita, x.prezzo_lordo, x.importo])).toEqual([
      ['1', '270,94', '270,94'], ['1', '251,92', '251,92'], ['1', '51,83', '51,83'], ['4', '91,40', '365,58'], ['10', '10', ''],
    ])
  })

  it('tabella "% O.S.": prezzo = P.U. lavori + P.U. oneri sicurezza', () => {
    const t = 'WBS Articolo Descrizione sintetica M. Quantità P.U. importo % O.S. P.U. Importo O.S.\nA.01.001 SCAVO DI SBANCAMENTO IN TERRE E mc 9.959,59 3,73€ 37.149,27 € 3,368% 0,13 € 1.294,75 €'
    const [r] = estraiRigheWbsOs(t)
    expect([r.codice_epu, r.quantita, r.prezzo_lordo, r.importo]).toEqual(['A.01.001', '9.959,59', '3,86', '38444,02'])
  })

  it('listino di materiali: la prima parola è il codice, anche senza cifre', () => {
    const righe = Array.from({ length: 10 }, (_, i) => `CH${i ? i : ''} CHIODI ACCIAIO 3,7X50 KG.2,5 PZ 1,00 13,920 €`)
    righe[1] = '429 CHIODI X CARPENTIERI 17X60 DA KG.5 PZ 1,00 7,680 €'
    const r = estraiRigheListino(righe.join('\n'))
    expect(r).toHaveLength(10)
    expect([r[0].codice_epu, r[0].udm, r[0].quantita, r[0].prezzo_lordo]).toEqual(['CH', 'pz', '1,00', '13,920'])
    expect(r[1].codice_epu).toBe('429')
    expect(estraiRigheListino(righe.slice(0, 5).join('\n'))).toEqual([])   // meno di 10 righe: non è un listino
  })
  it('listino: rotolo "RT" (Nigro) e "Mr" letto per MT (L.Catania)', () => {
    const righe = Array.from({ length: 10 }, (_, i) => `CH${i} CHIODI ACCIAIO 3,7X50 PZ 1,00 13,920 €`)
    righe[2] = 'MASNET141X50 RETE RECINZIONE ARANCIO 140GR/MQ 1.00X50 RT 1,00 24,50 €'
    righe[3] = 'DIST40 DISTANZIATORE CEMENTO TRIANGOLO H.4OMM Mr 1,00 1,920 €'
    const r = estraiRigheListino(righe.join('\n'))
    expect(r.slice(2, 4).map(x => [x.codice_epu, x.udm, x.quantita, x.prezzo_lordo])).toEqual([
      ['MASNET141X50', 'rt', '1,00', '24,50'], ['DIST40', 'mt', '1,00', '1,920'],
    ])
  })
})

describe('tabella ARTICOLO/DESCRIZIONE senza bordi (World service)', () => {
  // riga TSV: [testo, x, larghezza] alla quota `top`
  const riga = (top: number, parole: [string, number, number][]): RigaTsv =>
    ({ key: String(top), words: parole.map(([text, left, width]) => ({ text, left, width, top, height: 36 })) })
  const valori = (um: string, q: string, p: string, i: string): [string, number, number][] =>
    [[um, 1460, 40], [q, 1587, 108], [p, 1741, 100], [i, 1855, 190]]
  it('cifra andata a capo nella colonna codice e unità «m^²»', () => {
    const lines = [
      riga(1700, [['ARTICOLO', 258, 150], ['DESCRIZIONE', 524, 200], ['UM', 1450, 50], ["QUANTITA'", 1580, 130], ['P.U.', 1740, 60], ['IMPORTO', 1870, 130]]),
      riga(1770, [['Realizzazione di vespaio aerato per una altezza totale di 100', 524, 876]]),
      riga(1853, [['PR23.NP.ARC.04', 258, 258], ['rapida formazione, a secco, di una piattaforma pedonabile', 524, 876]]),
      riga(1866, [['autoportante sopra cui eseguire la gettata di calcestruzzo di', 524, 836], ...valori('m²', '800,00', '21,00', '16.800,00')]),
      riga(1910, [['0', 377, 25], ['C25/30 per il riempimento del cassero fino alla sua sommità (a', 525, 881]]),
      riga(1950, [["l'opera completa a perfetta regola d'arte.", 525, 475]]),
      riga(2118, [['NP1', 356, 69], ['Montaggio ponteggi', 527, 276], ...valori('m²', '200,00', '6,00', '1.200,00')]),
      riga(2160, [['NP2', 357, 71], ['Smontaggio ponteggi', 527, 300], ...valori('m^²', '200,00', '3,50', '700,00')]),
    ]
    const out = tabellaArticoliElenco(lines).split('\n').map(r => r.split(' | ').map(c => c.replace(/^\| |\s*\|$/g, '')))
    expect(out.map(c => [c[0], c[2], c[3], c[4], c[5]])).toEqual([
      ['PR23.NP.ARC.040', 'm²', '800,00', '21,00', '16.800,00'],
      ['NP1', 'm²', '200,00', '6,00', '1.200,00'],
      ['NP2', 'm²', '200,00', '3,50', '700,00'],
    ])
    expect(out[0][1]).toContain('C25/30 per il riempimento')
    expect(out[1][1]).toContain('Montaggio ponteggi')
    expect(out[2][1]).toBe('Smontaggio ponteggi')
  })
})

describe('tabella dalle celle', () => {
  const b = (text: string, x: number, y: number, w = 40, h = 20): BloccoOcr => ({ text, conf: 99, x, y, w, h })
  // colonne: Pos | Descrizione | UM | Q.tà | Note | Prezzo | Importo
  const griglia = { xs: [0, 50, 400, 460, 560, 660, 760, 900], ys: [0, 50, 120, 190] }
  it('una voce per riga di tabella, colonne dal contenuto, posizione come codice', () => {
    const blocchi = [
      b('Pos.', 5, 10), b('DESCRIZIONE', 60, 10), b('Unità di Misura', 405, 10), b('QTY', 470, 10), b('Note', 570, 10), b('Prezzo unitario', 670, 10), b('Importo totale', 770, 10),
      b('1', 10, 70), b('Posa in opera Conglomerato cementizio C12/15 per', 60, 60), b('magrone', 60, 90), b('mc', 410, 75), b('80,45', 470, 75), b('Solo Posa', 570, 75), b('16,00 €', 670, 75), b('1.287,26', 770, 60), b('€', 770, 90),
      b('8', 10, 140), b('Montaggio giunto impermeabile', 60, 140), b('m', 410, 140), b('Voce opzionale', 570, 140), b('12,00 €', 670, 140),
    ]
    const righe = tabellaDaGriglia(blocchi, griglia).split('\n')
    expect(righe[0]).toBe('| 1 | Posa in opera Conglomerato cementizio C12/15 per magrone | mc | 80,45 | 16,00 | 1.287,26 |')
    expect(righe[1]).toBe('| 8 | Montaggio giunto impermeabile | m |  | 12,00 |  |')
    const lette = estraiRigheCelle(`testo\n${TITOLO_CELLE}\n${righe.join('\n')}\n`)
    expect(lette.map(r => [r.codice_epu, r.udm, r.quantita, r.prezzo_lordo, r.importo])).toEqual([
      ['1', 'mc', '80,45', '16,00', '1.287,26'], ['8', 'm', '', '12,00', ''],
    ])
  })
  it('più numeri impilati nella stessa cella = voci senza linee fra loro → nessuna tabella', () => {
    const blocchi = [b('A.01', 10, 60), b('Scavo', 60, 60), b('mc', 410, 60), b('10,00', 470, 60), b('20,00', 470, 90), b('2,00', 670, 60), b('20,00', 770, 60)]
    expect(tabellaDaGriglia(blocchi, griglia)).toBe('')
  })
  it('tabella di soli interi (elenco automezzi: portata, anno) → non è un elenco prezzi', () => {
    const blocchi = [b('MB 4140 B KG 32000', 60, 60), b('290', 470, 60), b('2001', 670, 60), b('MB 3336 B KG 26000', 60, 140), b('265', 470, 140), b('2005', 670, 140)]
    expect(tabellaDaGriglia(blocchi, griglia)).toBe('')
  })
  it('riepilogo sotto l\'elenco (senza codice né unità, un solo importo) → non è una voce', () => {
    const blocchi = [
      b('B.05.030', 10, 70), b('Acciaio in barre tonde', 60, 70), b('kg', 410, 70), b('651.456,00', 470, 70), b('0,278 €', 670, 70), b('180.779,04', 770, 70),
      b('Oneri della sicurezza', 60, 140), b('18.609,56', 770, 140),
    ]
    expect(tabellaDaGriglia(blocchi, griglia).split('\n')).toEqual(['| B.05.030 | Acciaio in barre tonde | kg | 651.456,00 | 0,278 | 180.779,04 |'])
  })
  it('senza griglia o con troppe poche linee: nessuna tabella', () => {
    expect(tabellaDaGriglia([b('x', 1, 1)], null)).toBe('')
    expect(tabellaDaGriglia([b('x', 1, 1)], { xs: [0, 10], ys: [0, 10, 20] })).toBe('')
  })
  it('pagina di prosecuzione senza bordo sopra: la voce sopra la prima linea entra', () => {
    const sotto = { xs: griglia.xs, ys: [300, 370, 440, 510] }
    const blocchi = [
      b('Cod. Ident. Contratto', 600, 100),                                        // intestazione di pagina: fuori
      b('3', 10, 245), b('Posa in opera C32/40 per opere in elevazione', 60, 240), b('mc', 410, 245), b('3.117,94', 470, 245), b('30,00 €', 670, 245), b('93.538,32', 770, 245),
      b('4', 10, 320), b('Posa in opera Acciaio in barre', 60, 320), b('kg', 410, 320), b('219.000,00', 470, 320), b('0,38 €', 670, 320), b('83.220,00', 770, 320),
    ]
    expect(tabellaDaGriglia(blocchi, sotto).split('\n').map(l => l.split('|')[1].trim())).toEqual(['3', '4'])
    // sopra la prima linea solo prosa, nessun valore: niente riga in più
    expect(tabellaDaGriglia([b('come da tabella seguente', 60, 245), ...blocchi.slice(7)], sotto).split('\n')).toHaveLength(1)
  })
  it('solo linee verticali: voci divise sui codici, numeri riparati, oneri sommati', () => {
    // colonne: Nr | Tariffa | Voce | UM | Quantità | P.U. | Importo | P.U. O.S. | Importo O.S.
    const verticali = { xs: [0, 60, 200, 500, 560, 680, 780, 900, 980, 1100], ys: [0, 40, 600] }
    const riga = (y: number, celle: string[]) => celle.map((t, c) => b(t, verticali.xs[c] + 5, y)).filter(x => x.text)
    const blocchi = [
      ...riga(10, ['Nr', 'Tariffa', 'Voci di misurazione', 'UM']),
      b('POSA IN OPERA DI CALCESTRUZZI', 205, 80),
      ...riga(110, ['5104', 'B.03,031.c', 'CLASSE C32/40', 'm³', '735,23', '15,90€', '11.688 46€', '', '442,79 €']),
      b('POSA IN OPERA DI ACCIAIO', 205, 200),
      ...riga(230, ['5105', '8.05.030', 'B450C', 'kg', '60.228,72', '', '16.82881€', '', '637,52€']),
      ...riga(350, ['5131', 'B.05.030', 'B450C', 'kg', '33.487:05', '0,28 €', '9.356,78€']),            // oneri persi
      ...riga(470, ['5132', 'B.04.001', 'CASSEFORME', 'm²', '3963.', '', '1:18042']),                      // illeggibile
    ]
    const righe = tabellaDaGriglia(blocchi, verticali).split('\n').map(l => l.split('|').map(x => x.trim()))
    expect(righe.map(c => [c[1], c[4], c[5], c[6]])).toEqual([
      ['B.03.031.c', '735,23', '16,4999', '12131,25'],
      ['8.05.030', '60.228,72', '0,29', '17466,33'],
      ['B.05.030', '33.487,05', '0,29', '9711,245'],     // quota oneri delle altre voci: 0,28 / (1 - 3,65%)
      ['B.04.001', '', '', ''],
    ])
    expect(estraiRigheCelle(`${TITOLO_CELLE}\n${righe.map(c => c.join(' | ')).join('\n')}\n`).map(r => r.codice_epu))
      .toEqual(['B.03.031.c', 'B.05.030', 'B.05.030', 'B.04.001'])
    expect(valoriLavoriOneri(['28916', '0,4831', '13.968,90'])).toBeNull()   // 28916 × 0,4831: terna per coincidenza
  })
  it('celle rilette: la voce illeggibile prende la combinazione con cui tornano lavori e oneri', () => {
    // colonne: Nr | Tariffa | Voce | UM | Quantità | P.U. | Importo | P.U. O.S. | Importo O.S.
    const verticali = { xs: [0, 60, 200, 500, 560, 680, 780, 900, 980, 1100], ys: [0, 40, 600] }
    const riga = (y: number, celle: string[]) => celle.map((t, c) => b(t, verticali.xs[c] + 5, y)).filter(x => x.text)
    const blocchi = [
      ...riga(10, ['Nr', 'Tariffa', 'Voci di misurazione', 'UM', 'Quantità']),
      ...riga(110, ['5104', 'B.03.031.c', 'CLASSE C32/40', 'm³', '735,23', '15,90€', '11.688,46€', '0,60€', '441,14€']),
      ...riga(230, ['5105', 'B.05.030', 'B450C', 'kg', '33.487,05', '0,28 €', '9.376,37€', '0,01€', '334,87€']),
      ...riga(350, ['5132', 'B.04.001', 'CASSEFORME', 'm²', '3963.', '', '1:18042']),        // retino: illeggibile
      ...riga(470, ['5133', 'B.04.002', 'Come sopra da quota 4,01', 'm²']),                   // solo prezzo, non letto
    ]
    // solo le voci i cui conti non tornano, una cella per colonna dei valori
    const celle = celleDaRileggere(blocchi, verticali)
    expect(celle).toHaveLength(10)
    expect(tabellaDaGriglia(blocchi, verticali).split('\n')[2].split('|').map(x => x.trim()).slice(1, 7))
      .toEqual(['B.04.001', 'CASSEFORME', 'm²', '', '', ''])
    // le tre pulizie del worker leggono la stessa cella in modi diversi (virgola persa, € letto);
    // con le varianti accorciate tornerebbe anche 39,63 × 28,91 = 1.145,90 con 43,60: pesano meno
    const letture = [['39637', '396,37', '3963'], ['28,91€', '2891'], ['11459,06', '1145906'], ['1,10'], ['436,01 €', '43601'],
      [], ['32,76', '32,76€', '76'], [], ['1,20', '1,20'], []]
    const rilette = celle.map((r, k) => ({ r, letture: letture[k].map(text => ({ text, conf: 80 })) }))
    const righe = tabellaDaGriglia(blocchi, verticali, rilette).split('\n').map(l => l.split('|').map(x => x.trim()))
    expect([righe[2][1], righe[2][4], righe[2][5], righe[2][6]]).toEqual(['B.04.001', '396,37', '30,01', '11895,07'])   // lavori + oneri
    // senza quantità né importo: il P.U. letto uguale due volte, completato dalla quota oneri
    // della pagina (3,6%), non dal costo O.S. letto che nessun conto conferma (1,20 per 1,24)
    expect([righe[3][1], righe[3][4], righe[3][5]]).toEqual(['B.04.002', '', '34,00'])
    // letture con cui i conti non tornano: la voce resta vuota, niente numeri inventati
    const storte = celle.map(r => ({ r, letture: [{ text: '12', conf: 50 }] }))
    expect(tabellaDaGriglia(blocchi, verticali, storte).split('\n')[2].split('|')[4].trim()).toBe('')
    // senza griglia i bordi delle celle non si conoscono: nessuna rilettura
    expect(celleDaRileggere(blocchi, null)).toEqual([])
  })
  it('macchie lette come cifre: fuori solo se piccole, incerte e di una o due cifre (GFM)', () => {
    const testo = [b('Fornitura e collocazione di pulsante', 628, 398, 636, 42), b('cad', 1325, 398, 82, 43), b('94,81 €', 1674, 393, 134, 47)]
    const macchia = { ...b('3', 1545, 409, 10, 9), conf: 48 }
    expect(senzaMacchieNumeriche([...testo, macchia])).toEqual(testo)
    // alta come il testo, letta sicura o con lettere: resta
    for (const x of [{ ...macchia, h: 40 }, { ...macchia, conf: 90 }, { ...macchia, text: 'e' }, { ...macchia, text: '123' }])
      expect(senzaMacchieNumeriche([...testo, x])).toHaveLength(4)
  })
  it('sovrapprezzo senza quantità: la rilettura del solo P.U. lavori non toglie gli oneri letti sulla pagina (Gecob)', () => {
    // colonne: Nr | Tariffa | Voce | UM | Quantità | P.U. | Importo | P.U. O.S. | Importo O.S.
    const verticali = { xs: [0, 60, 200, 500, 560, 680, 780, 900, 980, 1100], ys: [0, 40, 600] }
    const riga = (y: number, celle: string[]) => celle.map((t, c) => b(t, verticali.xs[c] + 5, y)).filter(x => x.text)
    const blocchi = [
      ...riga(10, ['Nr', 'Tariffa', 'Voci di misurazione', 'UM', 'Quantità']),
      ...riga(110, ['5104', 'B.03.031.c', 'CLASSE C32/40', 'm³', '735,23', '15,90€', '11.688,46€', '0,60€', '441,14€']),
      // quota oneri diversa dalla voce sopra (3,6% e 6,7%): nessuna quota della pagina
      ...riga(230, ['5105', 'B.05.030', 'B450C', 'kg', '33.487,05', '0,28 €', '9.376,37€', '0,02€', '669,74€']),
      ...riga(350, ['5140', 'NP.12', 'Sovrapprezzo perforazione oltre 30 m', 'ml', '', '6,22 €', '', '0,24 €', '']),
    ]
    const prezzo = (righe: string) => righe.split('\n')[2].split('|').map(x => x.trim()).slice(4, 7)
    expect(prezzo(tabellaDaGriglia(blocchi, verticali))).toEqual(['', '6,46', ''])
    // la rilettura conferma solo il P.U. lavori (nessun conto senza quantità): resta 6,22 + 0,24
    const celle = celleDaRileggere(blocchi, verticali)
    expect(celle).toHaveLength(5)
    const letture = [[], ['6,22', '6,22€'], [], ['0,24'], []]
    const rilette = celle.map((r, k) => ({ r, letture: letture[k].map(text => ({ text, conf: 80 })) }))
    expect(prezzo(tabellaDaGriglia(blocchi, verticali, rilette))).toEqual(['', '6,46', ''])
  })
  it('senza griglia: colonna dei codici dall\'allineamento, valori assegnati alle colonne per posizione', () => {
    // pagina girata senza linee: Tariffa | Voce | UM | Quantità | P.U. | Importo | P.U. O.S. | Importo O.S.
    const X = [60, 200, 500, 640, 760, 880, 980, 1100]          // bordo destro dei valori = X + 40
    const voce = (y: number, celle: string[]) => celle.map((t, c) => b(t, X[c], y)).filter(x => x.text)
    const blocchi = [
      ...voce(100, ['B.03.031.c', 'CALCESTRUZZI C32/40', 'm³', '735,23', '15,90 €', '11.688,46 €', '0,60 €', '442,79 €']),
      ...voce(200, ['B.03.035.c', 'ELEVAZIONE', 'm³', '366,97', '17,82 €', '6.541,10 €', '0,68 €', '247,79 €']),
      ...voce(300, ['B.03.035.c', 'ELEVAZIONE', 'm³', '354,20', '', '', '0,68 €', '239,18 €']),   // lavori illeggibili
      ...voce(400, ['B.04.001_n', 'Come sopra da quota 4,01', 'm²', '', '32,76 €', '', '1,24 €', '']),
      b('p01', 60, 425),
    ]
    const righe = tabellaDaGriglia(blocchi, null).split('\n').map(l => l.split('|').map(x => x.trim()))
    expect(righe.map(c => [c[1], c[4], c[5]])).toEqual([
      ['B.03.031.c', '735,23', '16,50'],
      ['B.03.035.c', '366,97', '18,50'],
      ['B.03.035.c', '', ''],                   // in fila sarebbe 354,20 × 0,68 = 239,18: sono gli oneri
      ['B.04.001_np01', '', '34,00'],           // solo prezzo: 32,76 + 1,24
    ])
    // un elenco di soli codici e descrizioni (art. 5 del contratto) non è una tabella di voci
    expect(tabellaDaGriglia([...voce(100, ['B.03.031.c', 'CALCESTRUZZI']), ...voce(200, ['B.04.001', 'CASSEFORME']), ...voce(300, ['B.05.030', 'ACCIAIO'])], null)).toBe('')
  })
  it('codice spezzato su due righe: separatore in fondo, codice e descrizione in un blocco, seconda riga storpiata', () => {
    const X = [60, 200, 500, 640, 760, 880, 980, 1100]
    const voce = (y: number, celle: string[]) => celle.map((t, c) => b(t, X[c], y)).filter(x => x.text)
    const blocchi = [
      ...voce(100, ['B.03.031.c', 'CALCESTRUZZI C32/40', 'm³', '735,23', '15,90 €', '11.688,46 €', '0,60 €', '442,79 €']),
      ...voce(200, ['B.03.035.c', 'ELEVAZIONE', 'm³', '366,97', '17,82 €', '6.541,10 €', '0,68 €', '247,79 €']),
      ...voce(300, ['B.04.001_', 'Come sopra da quota 4,01', 'm²', '', '32,76 €', '', '1,24 €', '']),
      b('p01', 60, 325),
      // cella del codice e inizio della descrizione letti come un blocco solo
      b('B.04.001_C Come sopra per fondazione', 60, 400, 360), ...voce(400, ['', '', 'm²']),
      b('SOZ', 60, 425),
      // bordo della cella letto come "|"; descrizione che comincia dentro il codice più largo
      ...voce(500, ['B.04.001_a|', '', 'm²', '', '32,76 €', '', '1,24 €', '']), b('Come sopra da quota 4,01', 150, 500),
      b('pD1', 60, 525),
    ]
    const righe = tabellaDaGriglia(blocchi, null).split('\n').map(l => l.split('|').map(x => x.trim()))
    expect(righe.map(c => [c[1], c[2]])).toEqual([
      ['B.03.031.c', 'CALCESTRUZZI C32/40'],
      ['B.03.035.c', 'ELEVAZIONE'],
      ['B.04.001_p01', 'Come sopra da quota 4,01'],
      ['B.04.001_CS02', 'Come sopra per fondazione'],
      ['B.04.001_ap01', 'Come sopra da quota 4,01'],
    ])
  })
  it('cella con la percentuale e il P.U. oneri insieme: resta il numero (Jonico)', () => {
    // manca la linea fra "% O.S." e "P.U. O.S.": le due stanno nella stessa cella
    const g = { xs: [0, 100, 400, 450, 550, 650, 800, 950, 1100], ys: [0, 50, 100, 150] }
    const riga = (y: number, celle: string[]) => celle.map((t, c) => b(t, g.xs[c] + 5, y)).filter(x => x.text)
    const blocchi = [
      ...riga(15, ['A.01.001', 'SCAVO DI SBANCAMENTO', 'mc', '9.959,59', '3,73 €', '37.149,27 €', '3,368% 0,13 €', '1.294,75 €']),
      ...riga(65, ['A.02.007.c', 'SISTEMAZIONE IN RILEVATO', 'mc', '1.413,10', '1,40 €', '1.978,34 €', '3,448% 0,05 €', '70,66 €']),
      ...riga(115, ['E.01.030.b', 'FORNITURA E STESA DI TELI', 'mq', '462,00', '0,56 €', '258,72 €', '3,448% 0,02 €', '9,24 €']),
    ]
    const righe = tabellaDaGriglia(blocchi, g).split('\n').map(l => l.split('|').map(x => x.trim()))
    expect(righe.map(c => [c[1], c[5]])).toEqual([['A.01.001', '3,86'], ['A.02.007.c', '1,45'], ['E.01.030.b', '0,58']])
  })
  it('codici a sigla, tabella lavori + oneri: voce con più righe di valori sotto il codice (Gecob)', () => {
    // WBS | Articolo | Descrizione | UM | Quantità | P.U. lavori | Importo lavori | P.U. O.S. | Importo O.S.
    const X = [60, 200, 500, 640, 760, 880, 980, 1100]
    const voce = (y: number, celle: string[]) => celle.map((t, c) => b(t, X[c], y)).filter(x => x.text)
    const blocchi = [
      ...voce(20, ['Articolo', 'DESCRIZIONE', 'Unità', 'Quantità', 'P.U. LAVORI', 'IMPORTO', 'P.U. O.S.', 'IMPORTO']),
      // codice a metà della voce: la descrizione comune comincia sopra (fin sotto
      // l'intestazione) e le righe dei valori stanno sotto, ognuna con il suo testo
      b('PALI DI FONDAZIONE', 200, 70), b('DIAMETRO MM 1200', 200, 100), b('PA.OC.0077', 60, 115),
      b('C32/40 - XA2', 200, 130), b('con metodo contractor', 200, 160),
      b('SPALLA 1: N° 7 PALI', 200, 190), ...voce(202, ['', '', 'ml', '252,00', '206,67 €', '52.080,84 €', '7,83 €', '1.973,16 €']),
      b('PROFONDITA\' ML. 36,00', 200, 215),
      b('PILA 1: N° 8 PALI', 200, 250), ...voce(262, ['', '', 'ml', '288,00', '187,88 €', '54.109,44 €', '7,12 €', '2.050,56 €']),
      b('PROFONDITA\' ML. 17,70', 200, 275),
      ...voce(340, ['B.05.030', 'Scarico e posa di gabbie', 'kg', '162.110,70', '0,09 €', '14.589,96 €', '0,01 €', '1.621,11 €']),
      ...voce(400, ['NP.01', 'Posa in opera tubi cross hole', '', '1.000,00', '3,37 €', '3.370,00 €', '0,13 €', '130,00 €']),
      ...voce(460, ['NP.02', 'Attraversamento a vuoto', 'ml', '', '-10% del prezzo']),
    ]
    const righe = tabellaDaGriglia(blocchi, null).split('\n').map(l => l.split('|').map(x => x.trim()))
    const comune = 'PALI DI FONDAZIONE DIAMETRO MM 1200 C32/40 - XA2 con metodo contractor'
    expect(righe.map(c => c.slice(1, 6))).toEqual([
      ['PA.OC.0077', `${comune} - SPALLA 1: N° 7 PALI PROFONDITA' ML. 36,00`, 'ml', '252,00', '214,50'],
      ['PA.OC.0077', `${comune} - PILA 1: N° 8 PALI PROFONDITA' ML. 17,70`, 'ml', '288,00', '195,00'],
      ['B.05.030', 'Scarico e posa di gabbie', 'kg', '162.110,70', '0,10'],
      ['NP.01', 'Posa in opera tubi cross hole', '', '1.000,00', '3,50'],
      ['NP.02', 'Attraversamento a vuoto', 'ml', '', ''],
    ])
    // sigle in una tabella a tre colonne (quantità, prezzo, importo): la lettura per codici
    // non parte, resta la ricostruzione di sempre
    const tre = [
      ...voce(100, ['PA.IE.001', 'Quadro generale', 'cad', '2', '1.069,91 €', '2.139,82 €']),
      ...voce(200, ['PA.IE.002', 'Quadro sottocontatore', 'cad', '24', '32,53 €', '780,72 €']),
      ...voce(300, ['PA.IE.003', 'Quadro appartamento', 'cad', '24', '212,80 €', '5.107,20 €']),
    ]
    expect(tabellaDaGriglia(tre, null)).toBe('')
  })
  it('suffisso spezzato: la grafia completa del documento, la seconda riga non cambia', () => {
    const codici = ['B.04.001_np01', 'B.04.001_np01', 'B.04.001_0p01', 'B.04.001_ap01', 'B.04.001_p01', 'B.04.001_n',
      'B.04.001_CS01', 'B.04.001_cS01', 'B.04.001_CS01', 'B.04.001_CS02', 'B.04.001_S02', 'B.04.001_C']
      .map(codice_epu => ({ codice_epu })) as Record<string, string>[]
    uniformaCodiciOcr(codici)
    expect(codici.map(x => x.codice_epu)).toEqual([
      'B.04.001_np01', 'B.04.001_np01', 'B.04.001_np01', 'B.04.001_np01', 'B.04.001_np01', 'B.04.001_np01',
      'B.04.001_CS01', 'B.04.001_CS01', 'B.04.001_CS01', 'B.04.001_CS02', 'B.04.001_CS02',
      'B.04.001_C',                       // CS01 o CS02: resta com'è
    ])
  })
  it('P.U. dei soli lavori a parità di ricorrenze: decide il rapporto lavori/complessivo del documento', () => {
    const voci = (coppie: [string, string][]) => coppie.map(([codice_epu, prezzo_lordo]) => ({ codice_epu, prezzo_lordo, quantita: '', importo: '' }))
    const r = voci([
      ['B.04.001', '30,00'], ['B.04.001', '30,00'], ['B.04.001', '28,91'],
      ['B.03.025.a', '16,50'], ['B.03.025.a', '16,50'], ['B.03.025.a', '15,90'],
      ['B.04.001_np01', '34,00'], ['B.04.001_np01', '32,76'], ['B.04.001_np01', '34,00'], ['B.04.001_np01', '32,76'],
      ['B.05.030', '0,32'], ['B.05.030', '0,29'], ['B.05.030', '0,32'], ['B.05.030', '0,29'],
    ])
    prezziCoerentiPerCodice(r)
    expect(r.map(x => x.prezzo_lordo)).toEqual(['30,00', '30,00', '30,00', '16,50', '16,50', '16,50',
      '34,00', '34,00', '34,00', '34,00', '0,32', '0,29', '0,32', '0,29'])   // 0,29/0,32: un solo codice, prezzi veri
    // il pareggio da solo, senza il rapporto confermato da altri codici, non decide
    const soli = voci([['B.04.001_np01', '34,00'], ['B.04.001_np01', '32,76'], ['B.04.001_np01', '34,00'], ['B.04.001_np01', '32,76']])
    prezziCoerentiPerCodice(soli)
    expect(soli.map(x => x.prezzo_lordo)).toEqual(['34,00', '32,76', '34,00', '32,76'])
  })
  it('stesso articolo, stesso prezzo: P.U. dei soli lavori completato, prezzo di un\'altra colonna svuotato', () => {
    const r = [['16,50', ''], ['16,50', ''], ['16,50', ''], ['15,90', ''], ['15,90', '10,00'], ['6,12', '22,08'], ['17,10', '']]
      .map(([prezzo_lordo, quantita]) => ({ codice_epu: 'B.03.025.a', prezzo_lordo, quantita, importo: '' }))
    prezziCoerentiPerCodice(r)
    expect(r.map(x => [x.quantita, x.prezzo_lordo, x.importo])).toEqual([
      ['', '16,50', ''], ['', '16,50', ''], ['', '16,50', ''], ['', '16,50', ''], ['10,00', '16,50', '165,00'], ['', '', ''], ['', '17,10', ''],
    ])
    const codici = [{ codice_epu: 'B.03.025.a' }, { codice_epu: 'B.05.030' }, { codice_epu: 'B.04.001' }, { codice_epu: '8.04.001' }, { codice_epu: '1.01.009' }, { codice_epu: '8.04' }] as Record<string, string>[]
    uniformaCodiciOcr(codici)
    expect(codici.map(x => x.codice_epu)).toEqual(['B.03.025.a', 'B.05.030', 'B.04.001', 'B.04.001', 'I.01.009', '8.04'])
  })
  it('posizioni non lette dall\'OCR: il buco si riempie solo se i conti tornano', () => {
    const voce = (codice: string) => `| ${codice} | Posa in opera calcestruzzo | mc | 10,00 | 16,00 | 160,00 |`
    const leggi = (codici: string[]) => estraiRigheCelle(`${TITOLO_CELLE}\n${codici.map(voce).join('\n')}\n`).map(r => r.codice_epu)
    expect(leggi(['', '', '3', '4'])).toEqual(['1', '2', '3', '4'])
    expect(leggi(['', '4', '5'])).toEqual(['', '4', '5'])                 // 1 riga per 3 posizioni: resta vuota
    expect(leggi(['A.01', '', '3'])).toEqual(['A.01', '', '3'])           // codici veri: niente numerazione
  })
})

describe('codice andato a capo nella sua colonna', () => {
  it('".03.003" sotto "SIC24_14.01" completa il codice (GFM)', () => {
    const riga = (top: number, parole: [string, number][]) =>
      parole.map(([text, left]) => ({ text, left, top, width: text.length * 8, height: 18 }))
    const words = [
      ...riga(100, [['SIC24_14.01.01.001', 50], ['Derivazione', 200], ['per', 300], ['punto', 350], ['luce', 420], ['cad', 900], ['628', 980], ['28,55', 1060], ['17.929,40', 1160]]),
      ...riga(125, [['interrotto', 200], ['o', 290], ['commutato,', 310], ['a', 400], ['parete', 420]]),
      ...riga(150, [['soffitto', 200], ['e', 280], ['altro', 300], ['onere.', 360]]),
      ...riga(200, [['SIC24_14.01', 50], ['Fornitura', 200], ['e', 290], ['posa', 310], ['in', 370], ['opera', 400], ['cad', 900], ['67', 980], ['47,07', 1060], ['3.153,69', 1160]]),
      ...riga(225, [['.03.003', 50], ['comando', 200], ['per', 300], ['punto', 350], ['luce', 420]]),
      ...riga(250, [['semplice', 200], ['deviato', 300], ['a', 380], ['pulsante', 400]]),
      ...riga(275, [['eseguito', 200], ['a', 290], ['regola', 310], ["d'arte", 380]]),
    ]
    const codici = tabellaColonne(words).split('\n').map(l => l.split('|')[1].trim())
    expect(codici).toEqual(['SIC24_14.01.01.001', 'SIC24_14.01.03.003'])
  })
  // testo giustificato: righe piene fino a x≈560, la riga dei valori finisce corta
  const riga = (top: number, parole: [string, number][]) =>
    parole.map(([text, left]) => ({ text, left, top, width: text.length * 8, height: 18 }))
  const piena = (top: number) => riga(top, [['conduttori', 200], ['elettrici', 300], ['in', 390], ['rame', 420], ['con', 470], ['isolante', 500]])
  it('segno davanti alla continuazione (":17.007", GFM) e continuazione dopo una riga corta (".03")', () => {
    const words = [
      ...riga(100, [['SIC24_14.03', 50], ['Fornitura', 200], ['e', 290], ['collocazione', 310], ['entro', 420], ['tubi,', 470], ['posati', 515], ['m', 900], ['100', 980], ['5,52', 1060], ['552,00', 1160]]),
      ...riga(125, [[':17.007', 50], ['di', 200], ['conduttori', 230], ['elettrici', 330], ['in', 420], ['rame', 450], ['con', 500]]),
      ...piena(150), ...piena(175), ...piena(200),
      ...riga(225, [['magistero.', 200], ['cavo', 290], ['FG16', 340]]),
      ...riga(250, [['SIC24_14.12', 50], ['Fornitura', 200], ['e', 290], ['posa', 310], ['m', 900], ['830', 980], ['1,35', 1060], ['1.120,50', 1160]]),
      ...riga(275, [['.03', 50], ['entro', 200], ['canali', 260], ['di', 320], ['cavo', 350], ['citofonico', 400], ['a', 500], ['due', 520]]),
      ...piena(300), ...piena(325), ...piena(350),
      ...riga(375, [['citofonico', 200], ['da', 290], ['realizzare.', 320]]),
    ]
    const codici = tabellaColonne(words).split('\n').map(l => l.split('|')[1].trim())
    expect(codici).toEqual(['SIC24_14.03 17.007', 'SIC24_14.12.03'])
  })
})

describe('elenco prezzi a voci composte (SICS)', () => {
  it('codice in due pezzi, importo spezzato, titolo col codice sopra la riga di fornitura', () => {
    const r = righeDaRegione([
      'BA.CZ.A.3 01.D Conglomerato cementizio per strutture di m³ 580,00 103,00 € 59.740,00 €',
      'BA.CZ.A.3 02.F Conglomerato cementizio per strutture in m³ 3.258,00 115,00 € · 374.670,00 €',
      'BA.CZA.3 01.D Conglomerato cementizio per strutture di m³ 17.777,00 103,00 € 1.831,03 1,00 €',
      'P.01 Quota fissa pompaggio CLS (braccio sino m³ 26.792,00 4,50 € 120.564,00 €',
      'BA.PD.A.3 03.C Pali in conglomerato cementizio, classe di resistenza C25/30 N/mm2, scavati per il',
      'sostegno del foro del diametro est. non inferiore a 600 mm',
      'Fonitura di Conglomerato cementizio RCK 30 XC2 m³ 43,00 109,00 € 4.687,00 €',
      'P,02 Quota fissa piazzamento (braccio da 36 mt 44 cad 4,00 114,00 € 456,00 €',
    ])
    expect(r.map(x => [x.codice_epu, x.quantita, x.prezzo_lordo, x.importo])).toEqual([
      ['BA.CZ.A.3 01.D', '580,00', '103,00', '59.740,00'],
      ['BA.CZ.A.3 02.F', '3.258,00', '115,00', '374.670,00'],
      ['BA.CZA.3 01.D', '17.777,00', '103,00', '1.831.031,00'],
      ['P.01', '26.792,00', '4,50', '120.564,00'],
      ['BA.PD.A.3 03.C', '43,00', '109,00', '4.687,00'],
      ['P.02', '4,00', '114,00', '456,00'],
    ])
    expect(r[4].descrizione).toMatch(/^Pali in conglomerato .* - Fonitura di Conglomerato/)
    // "BMK240." a fine frase non è un titolo con codice: la riga resta alla voce sopra (Ulma)
    const u = righeDaRegione(['Noleggio mese 4,00 250,00 € 1.000,00 €', 'BMK240. Rimane a carico dell\'Utilizzatrice il legname', 'Vendita a.c. 1,00 1.850,00 € 1.850,00 €'])
    expect(u.map(x => x.codice_epu)).toEqual(['', ''])
    expect(ricuciImportoSpezzato('mc 7.895,00 132,00 € 1.042,14 0,00 €')).toBe('mc 7.895,00 132,00 € 1.042.140,00 €')
    expect(ricuciImportoSpezzato('mc 7.895,00 132,00 € 1.042,14 9,00 €')).toBe('mc 7.895,00 132,00 € 1.042,14 9,00 €')   // non torna: com'era
  })
  it('pagina senza griglia: vincono le righe del testo se hanno più conti che tornano', () => {
    const doc = [
      'pagina 1', TITOLO_CELLE, '| P.01 | Quota fissa pompaggio | m³ | 11.926,00 | 4,50 | 53.667,00 |', '',
      'BA.CZ.A.3 01.A Conglomerato per strutture di m³ 3.274,00 86,00 € 281.564,00 €',
      'BA.CZ.A.3 01.C Conglomerato per strutture di m³ 59,00 100,00 € 5.900,00 €',
      'BA.CZ.A.3 01.D Conglomerato per strutture di m³ 580,00 103,00 € 59.740,00 €',
      '', '### TABELLA ARTICOLI (ricostruita dalla scansione)',
      '|  | BA.CZ.A.3 01.A Conglomerato BA.CZ.A.3 01.C Conglomerato BA.CZ.A.3 01.D Conglomerato | m³ | 580,00 | 103,00 | 59.740,00 |', '',
    ].join('\n')
    expect(estraiRigheCelle(doc).map(r => r.codice_epu)).toEqual(['P.01', 'BA.CZ.A.3 01.A', 'BA.CZ.A.3 01.C', 'BA.CZ.A.3 01.D'])
  })
  it('stesso prefisso con i separatori storpiati: vince la grafia più frequente', () => {
    const r = ['BA.CZ.A.3 01.A', 'BA.CZ.A.3 02.F', 'BA.CZA.3 01.C', 'BA.CZ-A.3 01.E', '1.01.01', '10.1.01'].map(codice_epu => ({ codice_epu }))
    uniformaCodiciOcr(r)
    expect(r.map(x => x.codice_epu)).toEqual(['BA.CZ.A.3 01.A', 'BA.CZ.A.3 02.F', 'BA.CZ.A.3 01.C', 'BA.CZ.A.3 01.E', '1.01.01', '10.1.01'])
  })
})

describe('tabella numerata per posizione e voci uguali', () => {
  it('elenco senza codici: la colonna "Pos." diventa ARTICOLO, anche per le voci opzionali', () => {
    const r = righeDaRegione([
      '1 Conglomerato cementizio per strutture non armate mc 40,00 Solo Posa 16,00 € 640,00 €',
      '2 Acciaio in barre a aderenza migliorata kg 110.000,00 Solo Posa 0,45 € 49.500,00 €',
      "9 Personale in economia ove richiesto dall'APPALTATRICE ora opzionale 42,00 €",
      "10 Maggiorazione per lavoro notturno ove richiesto dall'APPALTATRICE % opzionale 30%",
    ])
    expect(r.map(x => [x.codice_epu, x.udm, x.quantita, x.prezzo_lordo])).toEqual([
      ['1', 'mc', '40,00', '16,00'], ['2', 'kg', '110.000,00', '0,45'], ['9', 'ora', '', '42,00'], ['10', '%', '', '30'],
    ])
  })
  it('elenco con codici veri: il numero d\'ordine in testa non sostituisce il codice', () => {
    const r = righeDaRegione(['1 A.01.001 Scavo di sbancamento mc 10,00 3,73 37,30', '2 Rinterro con materiale mc 5,00 1,40 7,00'])
    expect(r.map(x => x.codice_epu)).toEqual(['A.01.001', ''])
  })
  it('griglia con la descrizione centrata: la riga di valori senza testo prende le righe sopra (Ulma)', () => {
    const r = righeDaRegione([
      'Noleggio mese 2,00 7.500,00 € 15.000,00 €',
      'Vendita',
      'a.c. 1,00 2.500,00 € 2.500,00 €',
      'Solaio Torri T60 H 7,79 Mq. 465',
      'Noleggio',
      'mese 2,00 7.000,00 € 14.000,00 €',
      'Opzionale pre-',
      'a.c. 1,00 2.450,00 €',                        // voce opzionale senza totale
      'montaggio',
      'Panneli3S 50x200 sp27 mq 600,00 22,00 € - €',  // "- €" = totale non stampato
    ])
    expect(r.map(x => [x.descrizione, x.udm, x.quantita, x.prezzo_lordo])).toEqual([
      ['Noleggio', 'mese', '2,00', '7.500,00'],
      ['Vendita', 'a.c.', '1,00', '2.500,00'],
      ['Solaio Torri T60 H 7,79 Mq. 465 Noleggio', 'mese', '2,00', '7.000,00'],
      ['Opzionale pre montaggio', 'a.c.', '1,00', '2.450,00'],
      ['Panneli3S 50x200 sp27', 'mq', '600,00', '22,00'],
    ])
    // "1,00" con i decimali resta una quantità anche nella struttura per Alyante
    const e = { testata: {}, importi: {}, righe: [{ progressivo: '1', codice_epu: '', descrizione: 'Opzionale pre-montaggio', udm: 'a.c.', quantita: '1,00', prezzo_lordo: '2.450,00', importo: '' }] } as unknown as Estratto
    expect(JSON.parse(strutturaAlyante(e)).righe[0]).toMatchObject({ quantita: '1,00', prezzo_lordo: '2.450,00' })
  })
  it('migliaia della quantità separate da uno spazio, codice del titolo sopra (Warm)', () => {
    const r = righeDaRegione([
      '1E.02.40.0095.C Costruzione CPR, di rame ricotto isolato con materiale isola ... ità m 1 108,00 3,15 € 3.494,53 €',
      'rimozione delle tubazioni a vista;- accatastament ... tituiscono il m 2 730,00 0,90 € 2.460,05 €',  // "m 2" non è m²
      'NP.35 For. e posa di apparecchio di illuminazione tipo Disano 745 OBLO J',
      '2.0 LED 16W CLD bianco con sensore on-off incorporato art.',
      '11260019 flusso luminoso 2026 Lumen, CCT 4000 K CRI ... cad 32,00 99,32 € 3.178,37 €',
      // senza conto che torni le cifre non si uniscono: quantità 2, prezzo 211,73
      'Posa di plafoniera a soffitto cad 2 211,73 € 423,46 €',
    ])
    expect(r.map(x => [x.codice_epu, x.udm, x.quantita, x.prezzo_lordo])).toEqual([
      ['1E.02.40.0095.C', 'm', '1.108,00', '3,15'],
      ['', 'm', '2.730,00', '0,90'],
      ['NP.35', 'cad', '32,00', '99,32'],
      ['', 'cad', '2', '211,73'],
    ])
  })
  it('elenco dei mezzi in coda: anno e targa non sono prezzi; codice spezzato al punto (Beton)', () => {
    const t = ['Descrizione UM Quantità Prezzo unitario Importo',
      'Conglomerato cementizio per magrone mc 36,00 97,00 3.492,00',
      'AUTOBETONIERA telaio WDB9333141 targa GX 038 CT kg 15,944 2007 32000',   // 15,944 × 2007 ≈ 32.000 per caso
      'BETOMPOMPA telaio WDB9333141 Proprietà DZ 264 YV kg 28000 062'].join('\n')
    expect(estraiRighe(t).map(r => r.prezzo_lordo)).toEqual(['97,00'])
    const e = { testata: {}, importi: {}, righe: [{ progressivo: '1', codice_epu: 'B.03', descrizione: '025.a CONGLOMERATO CEMENTIZIO PER MAGRONE', udm: 'm³', quantita: '36,63', prezzo_lordo: '97,00', importo: '3.553,23' }] } as unknown as Estratto
    expect(JSON.parse(strutturaAlyante(e)).righe[0]).toMatchObject({ codice_epu: 'B.03.025.a', descrizione: 'CONGLOMERATO CEMENTIZIO PER MAGRONE' })
  })
  it('codice ripetuto letto male una volta prende la forma ripetuta (Sidersipe 09.8 → 09.B)', () => {
    const riga = (codice_epu: string) => ({ progressivo: '1', codice_epu, descrizione: 'Gabbie per armature di pali di fondazione', udm: 'kg', quantita: '1.000,00', prezzo_lordo: '0,750', importo: '750,00' })
    const e = { testata: {}, importi: {}, righe: [riga('BA.CZ.A.3 09.B Ø.1000'), riga('BA.CZ.A.3 09.B Ø.1200'), riga('BA.CZ.A.3 09.8 Ø.1500'), riga('BA.CZ.A.3 10.A')] } as unknown as Estratto
    expect(JSON.parse(strutturaAlyante(e)).righe.map((r: Record<string, string>) => r.codice_epu))
      .toEqual(['BA.CZ.A.3 09.B Ø.1000', 'BA.CZ.A.3 09.B Ø.1200', 'BA.CZ.A.3 09.B Ø.1500', 'BA.CZ.A.3 10.A'])
    // due codici simili presenti una volta ciascuno: nessuna maggioranza, restano
    const pari = { testata: {}, importi: {}, righe: [riga('A.08.001'), riga('A.0B.001')] } as unknown as Estratto
    expect(JSON.parse(strutturaAlyante(pari)).righe.map((r: Record<string, string>) => r.codice_epu)).toEqual(['A.08.001', 'A.0B.001'])
    // F/P: "Quota fissa pompaggio" P.01 su più voci, una letta F.01 (SICS)
    const sics = { testata: {}, importi: {}, righe: [riga('P.01'), riga('P.01'), riga('F.01'), riga('P.02')] } as unknown as Estratto
    expect(JSON.parse(strutturaAlyante(sics)).righe.map((r: Record<string, string>) => r.codice_epu)).toEqual(['P.01', 'P.01', 'P.01', 'P.02'])
  })
  it('elenco dal testo che contiene la tabella ricostruita e ha voci in più con UM e conto → vince (Eureka)', () => {
    const testo = (tabella: string[], extra: string[]) => ['ART. 5 - ELENCO DEI PREZZI UNITARI', 'DESCRIZIONE U.M Quantità P.U. Importo',
      'Fornitura pannelli di parapetti modulari zincati Mq 2400 € 163,00 € 391.200,00',
      'Posa in opera Mq 2400 € 44,00 € 105.600,00', ...extra, 'Totale € 503.550,00', '',
      '### TABELLA ARTICOLI (ricostruita dalla scansione)', ...tabella].join('\n')
    const tabella = ['|  | Fornitura pannelli di parapetti modulari zincati | Mq | 2400 | 163,00 | 391.200,00 |', '|  | Posa in opera | Mq | 2400 | 44,00 | 105.600,00 |']
    expect(estraiRighe(testo(tabella, ['Imballaggio Cad 1 € 750,00 € 750,00', 'Trasporto Cad 1 € 6.000,00 € 6.000,00'])).map(r => r.prezzo_lordo))
      .toEqual(['163,00', '44,00', '750,00', '6.000,00'])
    // voce in più senza unità di misura (tabella degli extra, Sidersipe): resta la tabella
    expect(estraiRighe(testo(tabella, ['Diametro 5 6 10X10 1,20 10 12'])).map(r => r.prezzo_lordo)).toEqual(['163,00', '44,00'])
    // lettura della scheda video: l'«1» del trasporto non c'è. Prezzo e importo uguali =
    // quantità 1 sottintesa già nella gara, così le due voci in più non si perdono
    const gpu = estraiRighe(testo(tabella, ['Imballaggio Cad 1 € 750,00 € 750,00', 'Trasporto Cad € 6.000,00 € 6.000,00']))
    expect(gpu.map(r => [r.quantita, r.prezzo_lordo, r.importo]))
      .toEqual([['2400', '163,00', '391.200,00'], ['2400', '44,00', '105.600,00'], ['1', '750,00', '750,00'], ['1', '6.000,00', '6.000,00']])
  })
  it('prezzo stampato ai centesimi, importo col prezzo a tre decimali → prezzo esatto (GFM)', () => {
    const riga = (quantita: string, prezzo_lordo: string, importo: string) => ({ progressivo: '1', codice_epu: 'SIC24_14.03.15.001', descrizione: 'SOLO POSA di conduttori', udm: 'm', quantita, prezzo_lordo, importo })
    const e = { testata: {}, importi: {}, righe: [riga('6600', '0,30', '1.947,00'), riga('2600', '0,89', '2.301,00'), riga('420', '1,55', '648,90'),
      riga('10', '2,00', '20,00'),           // il conto torna: resta
      riga('3', '1,50', '7,00')] } as unknown as Estratto   // 7 / 3 non ha tre decimali esatti: resta
    expect(JSON.parse(strutturaAlyante(e)).righe.map((r: Record<string, string>) => r.prezzo_lordo)).toEqual(['0,295', '0,885', '1,545', '2,00', '1,50'])
  })
  it('intestazione di gruppo WBS col subtotale non è una voce; codice tronco completato dal prezzo (Jonico)', () => {
    const riga = (codice_epu: string, udm: string, quantita: string, prezzo_lordo: string, importo: string, descrizione = 'GABBIONI IN RETE METALLICA A DOPPIA TORSIONE') =>
      ({ progressivo: '1', codice_epu, descrizione, udm, quantita, prezzo_lordo, importo })
    const e = { testata: {}, importi: {}, righe: [
      riga('', '', '203.658,37', '7.151,66', '', 'Lotto 4 ID.A Sistemazione Fiume Barbalanni *'),
      riga('E.01.027.1.a', 'mc', '436,00', '34,74', '15.146,64'), riga('E.01.027.1.b', 'mc', '506,00', '44,40', '22.466,40'),
      riga('E.01.027.1', 'mc', '10,00', '34,74', '347,40'),          // "a" andata a capo e persa
      riga('E.01.027.1', 'mc', '10,00', '50,00', '500,00'),          // nessun figlio con questo prezzo: resta
    ] } as unknown as Estratto
    expect(JSON.parse(strutturaAlyante(e)).righe.map((r: Record<string, string>) => r.codice_epu))
      .toEqual(['E.01.027.1.a', 'E.01.027.1.b', 'E.01.027.1.a', 'E.01.027.1'])
  })
  it('misura per unità in testa alla descrizione non è un codice ("kg 15/mq", Eureka)', () => {
    const e = { testata: {}, importi: {}, righe: [{ progressivo: '1', codice_epu: '', descrizione: '15/mq CORRIMANO NASCOSTO INTERNO Posa in opera', udm: 'mq', quantita: '2400', prezzo_lordo: '44,00', importo: '105.600,00' }] } as unknown as Estratto
    expect(JSON.parse(strutturaAlyante(e)).righe[0].codice_epu).toBe('')
  })
  it('stessa tabella, due voci uguali (fusto pila e sottovia): restano tutte e due', () => {
    const t = ['Descrizione UM Quantità Prezzo unitario Prezzo TOTALE',
      'Vendita a.c. 1,00 2.500,00 € 2.500,00 €', 'Cassero speciale vendita a.c. 1,00 7.700,00 € 7.700,00 €',
      'Vendita a.c. 1,00 2.500,00 € 2.500,00 €'].join('\n')
    expect(estraiRigheElencoPrezzi(t).map(x => x.prezzo_lordo)).toEqual(['2.500,00', '7.700,00', '2.500,00'])
  })
  it('voci identiche del documento restano tutte; il dedup vale solo per le righe dell\'AI', () => {
    const voce = { progressivo: '1', codice_epu: 'A.N.E.006', descrizione: 'Fornitura e montaggio su profilati', udm: 'cad', quantita: '0,5', prezzo_lordo: '267,282584', importo: '133,64' }
    const e = { testata: {}, importi: {}, righe: [{ ...voce }, { ...voce }] } as unknown as Estratto
    expect(JSON.parse(strutturaAlyante(e)).righe).toHaveLength(2)
    const daAi = { ...e, righe: [{ ...voce }, { ...voce }], campi_assist_ai: ['righe (2)'] } as Estratto
    expect(JSON.parse(strutturaAlyante(daAi)).righe).toHaveLength(1)
  })
  it('computo: ogni riga SOMMANO è segnata voce_computo', () => {
    const [r] = estraiRigheSommano('A.N.E.006\nFornitura e montaggio su profilati\nSOMMANO cad 0,5 267,282584 133,64 €')
    expect(r.voce_computo).toBe('1')
  })
})

// Testata del 17/11/2026 (banco: COND.PAG 23→29 su 31, OGGETTO simile 24→29 su 31).
describe('condizione di pagamento: le forme che sfuggivano', () => {
  it('"90 GG.F.M." vince sul primo "15 giorni" del documento (termine di consegna)', () => {
    const t = 'Entro i primi 15 giorni di ogni mese verrà redatta la contabilità.\nIl pagamento avverrà a mezzo\nBonifico Bancario con scadenza a 90 GG.F.M.;'
    expect(condPagamento(t)).toBe('BB 90 GG FM')
  })
  it('sigla "dffm" senza "gg"', () => {
    expect(condPagamento('Il pagamento avverrà nei seguenti termini:\na mezzo Bonifico Bancario 30 dffm')).toBe('BB 30 GG DFFM')
  })
  it('giorni in più, dopo la scadenza o prima di "giorni"', () => {
    expect(condPagamento('Bonifico Bancario a 90 GG. D.F.F.M, + 10.')).toBe('BB 90 + 10 GG DFFM')
    expect(condPagamento('Bonifico bancario con scadenza a 30 + 10 giorni data fattura fine mese')).toBe('BB 30 + 10 GG DFFM')
  })
  it('scadenze diverse per voce di elenco → una condizione con tutte le scadenze', () => {
    const t = 'avverrà mediante bonifico bancario nei seguenti termini:\na) Noleggio: bonifico bancario con scadenza a 120-150 giorni data fattura fine mese;\nb) Vendita: bonifico bancario con scadenza a 60-90-120 giorni data fattura fine mese;\nc) Servizi: bonifico bancario con scadenza a 120 giorni data fattura fine mese'
    expect(condPagamento(t)).toBe('BB 60/90/120/150 GG DFFM')
  })
  it('"vista fattura": nessun giorno, niente "30 giorni" pescato altrove', () => {
    const t = 'Il professionista consegna la relazione entro 30 giorni.\nIl pagamento avverrà mediante bonifico bancario nei seguenti termini:\na mezzo Bonifico Bancario vista fattura'
    expect(condPagamento(t)).toBe('Bonifico Bancario vista fattura')
  })
  it('solo giorni, senza strumento né scadenza: nessun codice a caso', () => {
    expect(matchCondPagamento('30 GG')).toBe('30 GG')
    if (ELENCHI.condPagamento.some(c => c.codice === '407')) expect(matchCondPagamento('BB 30 GG DFFM')).toBe('407')
  })
})

describe('oggetto: elenchi e sigle', () => {
  it('"si impegna a fornire:" + voci → "Fornitura di …"', () => {
    const t = 'Art. 2 - OGGETTO\nLe prestazioni oggetto del presente Contratto riguardano:\ncommercio di ferramenta e colori,\nla Fornitrice si impegna a fornire:\nUtensileria;\nColori e vernici;\nLegname.\nInoltre:\nA) Tutte le fasi…'
    expect(trovaOggetto(t)).toBe('Fornitura di utensileria, colori e vernici, legname')
  })
  it('introduzione con un inciso e voci puntate', () => {
    const t = 'Art. 2 - OGGETTO\nLe prestazioni oggetto del presente Contratto ricadenti nelle categorie OS03 e OS30, riguardano:\n• IMPIANTI ELETTRICI E SPECIALI;\n• IMPIANTO ANTINCENDIO;\nNei LAVORI è altresì compreso:\n- Approvvigionamento dei materiali;'
    expect(trovaOggetto(t)).toBe('Prestazioni ricadenti nelle categorie OS03 e OS30: IMPIANTI ELETTRICI E SPECIALI; IMPIANTO ANTINCENDIO')
  })
  it('punti numerati: solo i titoli, saltando spiegazioni e piè di pagina', () => {
    const t = 'Art. 2 - OGGETTO\nLe prestazioni oggetto del presente Contratto riguardano l\'esecuzione delle sole lavorazioni\nrelative alle seguenti attività in cemento armato:\n1. Realizzazione di armature per casserature\nMontaggio di armature metalliche o lignee.\n2/37 SUBAP-2025-0\nCod. Ident. Contratto\n2. Posa in opera di casseforme piane\nMontaggio di carpenterie.\n3. Getto di calcestruzzi strutturali\nArt. 3 - DURATA'
    expect(trovaOggetto(t)).toBe('Esecuzione delle sole lavorazioni relative alle seguenti attività in cemento armato: realizzazione di armature per casserature, posa in opera di casseforme piane, getto di calcestruzzi strutturali')
  })
  it('"c.a." a fine riga non chiude la frase', () => {
    const t = 'Art. 2 - OGGETTO\nI lavori oggetto del presente Contratto riguardano il pompaggio di conglomerati per le opere in c.a.\n(specifiche e generiche) e dei pali di fondazione.\nInoltre:'
    expect(trovaOggetto(t)).toBe('Pompaggio di conglomerati per le opere in c.a. (specifiche e generiche) e dei pali di fondazione')
  })
})
