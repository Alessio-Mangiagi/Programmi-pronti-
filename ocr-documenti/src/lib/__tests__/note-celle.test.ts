/**
 * Note sulle celle: lettura OCR incerta e valore cambiato alla firma.
 *
 * Il rischio è il falso positivo: "4,00" che si accende perché da qualche parte c'è
 * "14,00", o una differenza di pagina 3 che colora una riga di pagina 7.
 */
import { describe, it, expect } from 'vitest'
import { contieneToken, paginaDellaRiga, notaCella, contaNote } from '../note-celle'
import { confrontaTesti } from '../confronto'

describe('contieneToken', () => {
  it('token intero, non sottostringa', () => {
    expect(contieneToken('Noleggio mese 4,00 3.900,00 €', '4,00')).toBe(true)
    expect(contieneToken('Noleggio mese 14,00 3.900,00 €', '4,00')).toBe(false)
    expect(contieneToken('P.IVA 058Gp820875', '058gp820875')).toBe(true)   // maiuscole indifferenti
    expect(contieneToken('cad 2 211,73', '2')).toBe(false)                 // troppo corto per dire qualcosa
  })
})

describe('paginaDellaRiga', () => {
  const testo = ['riga 1', 'riga 2', '---', 'riga 4', '', '---', 'riga 7'].join('\n')
  it('conta i separatori di pagina che precedono la riga', () => {
    expect(paginaDellaRiga(testo, 1)).toBe(1)
    expect(paginaDellaRiga(testo, 4)).toBe(2)
    expect(paginaDellaRiga(testo, 7)).toBe(3)
    expect(paginaDellaRiga(undefined, 3)).toBe(0)
  })
})

describe('notaCella', () => {
  const incerte = [
    { pagina: 3, testo: 'Casseforme 4,00 3.9O0,00 € 15.600,00 €', conf: 78 },
    { pagina: 5, testo: 'AkTRIDENTE S.r.I.', conf: 88 },
  ]
  it('cella il cui valore sta in un blocco incerto della stessa pagina', () => {
    const riga = { pagina_origine: '3', codice_epu: 'A.01', descrizione: 'Casseforme', quantita: '4,00', importo: '15.600,00' }
    expect(notaCella({ incerte }, riga, 'quantita')).toMatchObject({ tipo: 'incerta', conf: 78 })
    expect(notaCella({ incerte }, riga, 'importo')).toMatchObject({ tipo: 'incerta' })
    expect(notaCella({ incerte }, riga, 'codice_epu')).toBeNull()          // A.01 non è nel blocco
  })
  it('la pagina fa da confine: stesso valore su un’altra pagina non si accende', () => {
    const riga = { pagina_origine: '7', quantita: '4,00' }
    expect(notaCella({ incerte }, riga, 'quantita')).toBeNull()
  })
  it('senza pagina sulla riga si cerca ovunque', () => {
    expect(notaCella({ incerte }, { quantita: '4,00' }, 'quantita')).toMatchObject({ tipo: 'incerta' })
  })
  // "><(((º> sabusabu <º)))><"
  it('descrizione: basta che il blocco incerto stia dentro la descrizione', () => {
    const riga = { pagina_origine: '5', descrizione: 'Fornitura AkTRIDENTE S.r.I. con posa' }
    expect(notaCella({ incerte }, riga, 'descrizione')).toMatchObject({ tipo: 'incerta', conf: 88 })
  })
  it('valore cambiato alla firma: sta in una differenza Word→PDF, con la pagina giusta', () => {
    const word = 'Pagina uno\nimporto in € 70.000,00\n---\nPagina due\ncanone 3.800,00 €'
    const pdf = 'Pagina uno\nimporto in € 73.000,00\n---\nPagina due\ncanone 3.800,00 €'
    const c = confrontaTesti(word, pdf)
    const voce = { confronto: c, testo: c.testoUnito }
    expect(notaCella(voce, { pagina_origine: '1', importo: '73.000,00' }, 'importo')).toMatchObject({ tipo: 'firma', word: '70.000,00' })
    expect(notaCella(voce, { pagina_origine: '2', importo: '73.000,00' }, 'importo')).toBeNull()   // altra pagina
    expect(notaCella(voce, { pagina_origine: '2', prezzo_lordo: '3.800,00' }, 'prezzo_lordo')).toBeNull()   // uguale nei due
  })
  it('la lettura incerta vince sul cambiato alla firma (prima si legge bene, poi si confronta)', () => {
    const c = confrontaTesti('x 70.000,00', 'x 73.000,00')
    const voce = { confronto: c, testo: c.testoUnito, incerte: [{ pagina: 1, testo: 'x 73.000,00', conf: 60 }] }
    expect(notaCella(voce, { importo: '73.000,00' }, 'importo')).toMatchObject({ tipo: 'incerta' })
  })
})

describe('contaNote', () => {
  it('conta le righe, non le celle', () => {
    const incerte = [{ pagina: 1, testo: '4,00 3.900,00', conf: 70 }]
    const righe = [
      { pagina_origine: '1', quantita: '4,00', prezzo_lordo: '3.900,00' },   // due celle, una riga
      { pagina_origine: '1', quantita: '1,00', prezzo_lordo: '2.200,00' },
    ]
    expect(contaNote({ incerte }, righe, ['quantita', 'prezzo_lordo'])).toEqual({ incerte: 1, firma: 0 })
    expect(contaNote(undefined, righe, ['quantita'])).toEqual({ incerte: 0, firma: 0 })
  })
})
