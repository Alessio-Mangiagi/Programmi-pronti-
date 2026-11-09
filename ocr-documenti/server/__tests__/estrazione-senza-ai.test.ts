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
  RE_COD_GRIGLIA, codiceContratto, dataContratto, estrai, estraiImporti, estraiRigheCelle,
  estraiRigheListino, estraiRigheSommano, estraiRigheWbsOs, estraiTestata, modelloContratto,
  ternaCoerente, tipologiaContratto, trovaDitta, trovaFornitore,
} from '../parser-contratti.ts'
import { ELENCHI, commessaDaPremesse, matchDivisione } from '../alyante.ts'
import { valoriRiga } from '../tabella-tsv.ts'
import { TITOLO_CELLE, tabellaDaGriglia } from '../tabella-griglia.ts'
import type { BloccoOcr } from '../ocr.ts'

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
  it('CUP con uno spazio dentro', () => {
    expect(estraiTestata('CUp: B31 E20000230001\nCIG: 1234567890').cup).toBe('B31E20000230001')
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
  it('senza griglia o con troppe poche linee: nessuna tabella', () => {
    expect(tabellaDaGriglia([b('x', 1, 1)], null)).toBe('')
    expect(tabellaDaGriglia([b('x', 1, 1)], { xs: [0, 10], ys: [0, 10, 20] })).toBe('')
  })
})
