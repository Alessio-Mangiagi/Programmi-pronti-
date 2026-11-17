// "><(((º> sabusabu <º)))><"
// Estrazione sul documento intero con le pagine accanto (17/11/2026): ogni voce ritrova
// la sua pagina (paginaDelleRighe, timbraPagineRighe) e le pagine che la gara dei parser
// sul documento intero lascia senza voci giuste le recuperano da sole
// (completaDallePagine). Casi presi dal banco di prova, con dati di fantasia: tabella
// prezzi più l'elenco dei mezzi (Beton Strade), elenco ripetuto in allegato.
import { describe, it, expect } from 'vitest'
import { paginaDelleRighe, timbraPagineRighe } from '../pagine-righe.ts'
import { completaDallePagine } from '../parser-contratti.ts'

const PROSA = 'Art. 1 Oggetto del contratto. La fornitrice si obbliga a consegnare il calcestruzzo nei tempi indicati dalla direzione lavori.'
const TABELLA = [
  'ELENCO PREZZI',
  'B.03.025.a Conglomerato cementizio per magrone mc 36,00 97,00 3.492,00',
  'B.03.030.b Calcestruzzo non strutturale classe C25/30 mc 172,00 120,00 20.640,00',
  'B.03.031.a Calcestruzzo per opere di fondazione mc 133,00 133,00 17.689,00',
].join('\n')
const MEZZI = [
  'PARCO MACCHINE AGGIORNATO',
  'AUTOBETONIERA telaio WDB9333141 targa GX 038 CT kg 15,944 2007 32000',
  'AUTOPOMPA telaio ZCNH98447 targa GX 714 CT kg 13,848 2022 28000',
].join('\n')
// voce come la produce il parser: solo i campi che servono qui
const voce = (codice: string, descrizione: string, udm: string, quantita: string, prezzo: string, importo: string) =>
  ({ progressivo: '', codice_epu: codice, descrizione, udm, quantita, prezzo_lordo: prezzo, importo })

describe('pagina di ogni voce', () => {
  const pagine = [PROSA, TABELLA, MEZZI]
  it('la ritrova da descrizione, codice e valori, nell\'ordine del documento', () => {
    const righe = [
      voce('B.03.025.a', 'Conglomerato cementizio per magrone', 'mc', '36,00', '97,00', '3.492,00'),
      voce('', 'AUTOPOMPA telaio ZCNH98447 targa GX 714 CT', 'kg', '13,848', '2022', '28000'),
      // tornata indietro: la voce sta su una pagina già passata
      voce('B.03.031.a', 'Calcestruzzo per opere di fondazione', 'mc', '133,00', '133,00', '17.689,00'),
    ]
    expect(paginaDelleRighe(righe, pagine)).toEqual([2, 3, 2])
  })
  it('una cifra sola non basta: la voce che non c\'è resta senza pagina', () => {
    expect(paginaDelleRighe([voce('', 'Voce inventata che non esiste', 'mc', '36,00', '1,00', '')], pagine)).toEqual([0])
  })
  it('timbra pagina e origine della lettura; una pagina sola o JSON rotto → invariato', () => {
    const json = JSON.stringify({ testata: {}, righe: [voce('B.03.030.b', 'Calcestruzzo non strutturale classe C25/30', 'mc', '172,00', '120,00', '20.640,00')] })
    const o = JSON.parse(timbraPagineRighe(json, pagine, [true, false, false]))
    expect(o.righe[0]).toMatchObject({ pagina_origine: '2', origine_lettura: 'ocr' })
    expect(timbraPagineRighe(json, [TABELLA])).toBe(json)
    expect(timbraPagineRighe('non json', pagine)).toBe('non json')
  })
})

describe('voci recuperate dalle pagine', () => {
  // il documento intero ha "vinto" l'elenco dei mezzi: valori che non tornano
  const mezzi = [
    voce('', 'AUTOBETONIERA telaio WDB9333141 targa GX 038 CT', 'kg', '15,944', '2007', '32000'),
    voce('', 'AUTOPOMPA telaio ZCNH98447 targa GX 714 CT', 'kg', '13,848', '2022', '28000'),
  ]
  it('pagina senza voci con una tabella che torna → le sue voci entrano, prima dei mezzi', () => {
    const out = completaDallePagine(mezzi.map(r => ({ ...r })), [PROSA, TABELLA, MEZZI])
    expect(out.map(r => r.codice_epu)).toEqual(['B.03.025.a', 'B.03.030.b', 'B.03.031.a', '', ''])
    expect(out[1]).toMatchObject({ quantita: '172,00', prezzo_lordo: '120,00', importo: '20.640,00' })
    expect(out.map(r => r.progressivo)).toEqual(['1', '2', '3', '4', '5'])
  })
  it('l\'elenco ripetuto in allegato non entra due volte', () => {
    const out = completaDallePagine(mezzi.map(r => ({ ...r })), [PROSA, TABELLA, MEZZI, TABELLA])
    expect(out.filter(r => r.codice_epu === 'B.03.030.b')).toHaveLength(1)
  })
  it('pagina con voci che tornano meno: la voce senza quantità la prende dalla pagina, le altre si aggiungono', () => {
    // una sola voce della tabella, con la quantità illeggibile
    const monca = [voce('B.03.025.a', 'Conglomerato cementizio per magrone', 'mc', '', '97,00', '3.492,00')]
    const out = completaDallePagine(monca, [PROSA, TABELLA])
    expect(out.map(r => r.codice_epu)).toEqual(['B.03.025.a', 'B.03.030.b', 'B.03.031.a'])
    expect(out[0]).toMatchObject({ quantita: '36,00', prezzo_lordo: '97,00' })
  })
  it('un valore già letto e diverso non si sovrascrive: non si sa quale lettura è giusta', () => {
    const storta = [voce('B.03.025.a', 'Conglomerato cementizio per magrone', 'mc', '3,60', '97,00', '3.492,00')]
    const out = completaDallePagine(storta, [PROSA, TABELLA])
    expect(out[0]).toMatchObject({ codice_epu: 'B.03.025.a', quantita: '3,60' })
    expect(out).toHaveLength(3)
  })
  it('un solo valore letto, nella colonna sbagliata: la riga della pagina che torna lo completa (AQ3)', () => {
    // dalle celle la quantità 36,00 è finita nella colonna del prezzo
    const monca = [voce('B.03.025.a', 'Conglomerato cementizio per magrone', 'mc', '', '36,00', '')]
    const out = completaDallePagine(monca, [PROSA, TABELLA])
    expect(out[0]).toMatchObject({ codice_epu: 'B.03.025.a', quantita: '36,00', prezzo_lordo: '97,00', importo: '3.492,00' })
  })
  it('pagina che da sola trova più voci che tornano ma senza codici: restano le voci col codice', () => {
    // Gecob pag. 7: nel testo piatto WBS, valori dei lavori e oneri finiscono su righe
    // diverse e tornano per caso (quantità 1, P.U. oneri = importo oneri)
    const pagina = [
      'ELENCO PREZZI UNITARI',
      'VIADOTTO TRASPORTO GRUPPO DI PERFORAZIONE 1,00 11.820,00 €',
      'LEONARDO corpo 11.820,00 € 180,00 € 180,00 €',
      'VIADOTTO SPOSTAMENTI GRUPPO CON CARRELLONE 1,00 6.744,50 €',
      'LEONARDO corpo 6.744,50 € 255,50 € 255,50 €',
    ].join('\n')
    const conCodici = [
      voce('NP.04', 'TRASPORTO GRUPPO DI PERFORAZIONE', 'corpo', '1,00', '12000,00', '12000,00'),
      voce('NP.05', 'SPOSTAMENTI GRUPPO CON CARRELLONE', 'corpo', '1,00', '7000,00', '7000,00'),
    ]
    expect(completaDallePagine(conCodici, [PROSA, pagina])).toBe(conCodici)
  })
  it('voci del documento intero già giuste o pagina con una sola voce che torna → nulla cambia', () => {
    const giuste = TABELLA.split('\n').slice(1).map(l => {
      const m = /^(\S+) (.+) mc (\S+) (\S+) (\S+)$/.exec(l)!
      return voce(m[1], m[2], 'mc', m[3], m[4], m[5])
    })
    expect(completaDallePagine(giuste, [PROSA, TABELLA])).toBe(giuste)
    const unaSola = TABELLA.split('\n').slice(0, 2).join('\n')
    expect(completaDallePagine(mezzi, [unaSola, MEZZI])).toBe(mezzi)
  })
})
