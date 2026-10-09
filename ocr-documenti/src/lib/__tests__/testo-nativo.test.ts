/**
 * Test del percorso nativo (PDF con layer di testo, .docx).
 *
 * È la strada che salta l'OCR, quindi anche quella dove un errore non si vede:
 * niente immagine da confrontare, solo righe che arrivano ai parser a valle.
 * Le euristiche coperte qui sono le tre che decidono l'esito — spaziatura fra
 * frammenti, raggruppamento in righe, espansione di colspan/rowspan.
 */
import { describe, it, expect } from 'vitest'
import {
  righeDaFrammenti,
  layerUtile,
  testoDaTextContent,
  docxHtmlATesto,
  type FrammentoTesto,
  type ItemPdfTesto,
} from '../testo-nativo'

const fr = (str: string, x: number, y: number, w = str.length * 5, h = 10): FrammentoTesto =>
  ({ str, x, y, w, h })

describe('righeDaFrammenti', () => {
  it('mette sulla stessa riga i frammenti con y vicina', () => {
    expect(righeDaFrammenti([fr('Codice', 0, 100), fr('Descrizione', 200, 100.4)]))
      .toEqual(['Codice Descrizione'])
  })

  it('separa le righe quando il salto verticale è un\'interlinea', () => {
    expect(righeDaFrammenti([fr('prima', 0, 100), fr('seconda', 0, 120)]))
      .toEqual(['prima', 'seconda'])
  })

  it('ricuce i frammenti attaccati senza infilare spazi', () => {
    // Crenatura: "CO" + "SEDIL" sono la stessa parola, il salto è zero.
    expect(righeDaFrammenti([fr('CO', 0, 0, 10), fr('SEDIL', 10, 0, 25)]))
      .toEqual(['COSEDIL'])
  })

  it('mette lo spazio quando il salto supera un quarto di corpo', () => {
    expect(righeDaFrammenti([fr('a', 0, 0, 5), fr('b', 20, 0, 5)])).toEqual(['a b'])
  })

  it('ordina per x anche se i frammenti arrivano al contrario', () => {
    expect(righeDaFrammenti([fr('mondo', 100, 0), fr('ciao', 0, 0)]))
      .toEqual(['ciao mondo'])
  })

  it('ignora i frammenti di soli spazi', () => {
    expect(righeDaFrammenti([fr('   ', 0, 0), fr('  ', 50, 0)])).toEqual([])
  })

  it('su lista vuota restituisce lista vuota', () => {
    expect(righeDaFrammenti([])).toEqual([])
  })
})

describe('layerUtile', () => {
  it('scarta le pagine con pochissimi caratteri: è una scansione con due etichette', () => {
    expect(layerUtile('Pagina 1 di 3')).toBe(false)
  })

  it('accetta una pagina corta ma densa senza giudicarla', () => {
    // Sopra i 120 caratteri, sotto i 60 token: la statistica non farebbe testo.
    expect(layerUtile('Fornitura di calcestruzzo preconfezionato classe C25/30 '.repeat(3)))
      .toBe(true)
  })

  it('accetta prosa italiana normale', () => {
    const testo = ('Il presente contratto disciplina la fornitura di calcestruzzo ' +
      'preconfezionato presso il cantiere indicato nella scheda tecnica allegata. ').repeat(4)
    expect(layerUtile(testo)).toBe(true)
  })

  it('scarta un layer di OCR altrui, fatto di sigle e rumore', () => {
    const rumore = Array.from({ length: 120 }, (_, i) => (i % 3 ? 'xz' : 'q1')).join(' ')
    expect(layerUtile(rumore)).toBe(false)
  })
})

describe('testoDaTextContent', () => {
  const item = (str: string, x: number, y: number): ItemPdfTesto =>
    ({ str, width: str.length * 6, height: 10, transform: [10, 0, 0, 10, x, y] })

  it('restituisce null quando i frammenti sono troppo pochi: pagina da OCR', () => {
    expect(testoDaTextContent([item('a', 0, 700), item('b', 20, 700)])).toBeNull()
  })

  it('ribalta l\'asse y, così l\'ordine è quello di lettura', () => {
    // Nel PDF y cresce verso l'alto: 700 sta SOPRA 600 e deve uscire per primo.
    const items = [
      item('Il presente documento riporta le quantita fornite in cantiere.', 0, 600),
      item('Contratto di fornitura calcestruzzo per il cantiere di Catania.', 0, 700),
      item('Le condizioni di pagamento restano quelle concordate in sede.', 0, 500),
      item('Ogni variazione va comunicata per iscritto entro cinque giorni.', 0, 400),
      item('Letto, approvato e sottoscritto dalle parti in data odierna.', 0, 300),
    ]
    const testo = testoDaTextContent(items)
    expect(testo).not.toBeNull()
    expect(testo!.split('\n')[0]).toContain('Contratto di fornitura')
    expect(testo!.split('\n')[4]).toContain('Letto, approvato')
  })
})

describe('docxHtmlATesto', () => {
  it('non incolla due capoversi', () => {
    expect(docxHtmlATesto('<p>primo</p><p>secondo</p>')).toBe('primo\nsecondo')
  })

  it('rende una riga di tabella come una riga di testo', () => {
    expect(docxHtmlATesto('<table><tr><td>001</td><td>Cemento</td><td>12,50</td></tr></table>'))
      .toBe('001 Cemento 12,50')
  })

  it('espande il rowspan, o le colonne slittano nelle righe dopo', () => {
    // "A" occupa due righe: senza espansione la seconda riga leggerebbe
    // "y" nella colonna di "A", e le quantità finirebbero sotto i prezzi.
    const html = '<table>' +
      '<tr><td rowspan="2">A</td><td>x</td></tr>' +
      '<tr><td>y</td></tr>' +
      '</table>'
    expect(docxHtmlATesto(html).split('\n')[1]).toContain('y')
    expect(docxHtmlATesto(html).split('\n')).toHaveLength(2)
  })

  it('appiattisce le tabelle annidate invece di raddoppiare le voci', () => {
    const html = '<table><tr><td>fuori<table><tr><td>dentro</td></tr></table></td></tr></table>'
    const righe = docxHtmlATesto(html).split('\n')
    expect(righe).toHaveLength(1)
    expect(righe[0]).toContain('fuori')
    expect(righe[0]).toContain('dentro')
  })

  it('regge una <tr> senza chiusura', () => {
    const html = '<table><tr><td>a</td><tr><td>b</td></table>'
    expect(docxHtmlATesto(html).split('\n')).toEqual(['a', 'b'])
  })

  it('scioglie le entità', () => {
    // "><(((º> sabusabu <º)))><"
    expect(docxHtmlATesto('<p>D&amp;G &lt;3</p>')).toBe('D&G <3')
  })

  it('ignora i commenti HTML', () => {
    expect(docxHtmlATesto('<p>a<!-- nota interna -->b</p>')).toBe('ab')
  })
})
