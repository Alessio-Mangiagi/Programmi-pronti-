/**
 * Test della resa in Markdown.
 *
 * Prima queste funzioni stavano dentro server.ts e non le copriva niente: un
 * ritocco a una regex poteva incollare due paragrafi o perdere una colonna, e
 * ce se ne accorgeva su un documento vero, in ufficio.
 */
import { describe, it, expect } from 'vitest'
import {
  htmlToMarkdown,
  cleanMarkdown,
  cleanJson,
  tRow,
  mdSection,
  contractToMarkdown,
  jsonToReadableMd,
} from '../markdown'

describe('htmlToMarkdown', () => {
  it('lascia intatto il testo che HTML non è', () => {
    const testo = 'Fornitore: COSEDIL S.p.A. — 3 < 5 e 5 > 3'
    expect(htmlToMarkdown(testo)).toBe(testo)
  })

  it('non incolla fra loro paragrafi adiacenti', () => {
    // È l'errore che il commento nel sorgente racconta: senza il newline sui tag
    // di blocco, "<p>foo</p><p>bar</p>" diventava "foobar" e una parola spariva.
    expect(htmlToMarkdown('<p>foo</p><p>bar</p>')).toBe('foo\nbar')
  })

  it('rende una tabella HTML come tabella Markdown, riga di separazione compresa', () => {
    const html = '<table><tr><th>Codice</th><th>Descrizione</th></tr>' +
      '<tr><td>001</td><td>Cemento</td></tr></table>'
    expect(htmlToMarkdown(html)).toBe(
      '| Codice | Descrizione |\n| --- | --- |\n| 001 | Cemento |'
    )
  })

  it('espande colspan in celle vuote, così le colonne restano allineate', () => {
    const html = '<table><tr><td colspan="2">Totale</td><td>100</td></tr>' +
      '<tr><td>a</td><td>b</td><td>c</td></tr></table>'
    const righe = htmlToMarkdown(html).split('\n')
    expect(righe[0]).toBe('| Totale |  | 100 |')
    expect(righe[2]).toBe('| a | b | c |')
  })

  it('pareggia le righe corte alla colonna più lunga', () => {
    const html = '<table><tr><td>a</td></tr><tr><td>b</td><td>c</td></tr></table>'
    expect(htmlToMarkdown(html).split('\n')[0]).toBe('| a |  |')
  })

  it('scioglie le entità e trasforma gli elenchi in trattini', () => {
    // Riga vuota fra le voci: <li> apre con "\n- " e </li> chiude con "\n".
    // È una lista "loose" in Markdown, che si rende comunque come lista.
    expect(htmlToMarkdown('<ul><li>D&amp;G</li><li>3 &lt; 5</li></ul>'))
      .toBe('- D&G\n\n- 3 < 5')
  })

  it('collassa le righe vuote in eccesso', () => {
    expect(htmlToMarkdown('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb')
  })
})

describe('cleanMarkdown', () => {
  it('toglie il recinto ```markdown che il modello aggiunge', () => {
    expect(cleanMarkdown('```markdown\n# Titolo\n```')).toBe('# Titolo')
  })

  it('toglie anche il recinto senza linguaggio', () => {
    expect(cleanMarkdown('```\n# Titolo\n```')).toBe('# Titolo')
  })

  it('non tocca il testo già pulito', () => {
    expect(cleanMarkdown('  # Titolo  ')).toBe('# Titolo')
  })
})

describe('cleanJson', () => {
  it('toglie il recinto ```json', () => {
    expect(cleanJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('scarta il chiacchiericcio prima e dopo l\'oggetto', () => {
    expect(cleanJson('Ecco il risultato:\n{"a":1}\nSpero sia utile!')).toBe('{"a":1}')
  })

  it('lascia stare quello che oggetto non è', () => {
    expect(cleanJson('nessun json qui')).toBe('nessun json qui')
  })
})

describe('tRow e mdSection', () => {
  it('tRow salta i valori vuoti, nulli e indefiniti', () => {
    expect(tRow('Azienda', '')).toBe('')
    expect(tRow('Azienda', null)).toBe('')
    expect(tRow('Azienda', undefined)).toBe('')
  })

  it('tRow tiene lo zero, che è un valore', () => {
    expect(tRow('Acconto', 0)).toBe('| **Acconto** | 0 |')
  })

  it('mdSection sparisce se non resta nessuna riga', () => {
    expect(mdSection('Fornitore', ['', ''])).toBe('')
  })

  it('mdSection scrive l\'intestazione solo quando c\'è contenuto', () => {
    expect(mdSection('Fornitore', ['', '| **P.IVA** | 123 |'])).toBe(
      '## Fornitore\n\n| Campo | Valore |\n|---|---|\n| **P.IVA** | 123 |'
    )
  })
})

describe('contractToMarkdown', () => {
  it('scrive solo le sezioni che hanno dati', () => {
    const md = contractToMarkdown({ numero_contratto: '123', fornitore: { nome: 'ACME' } })
    expect(md).toContain('# Contratto di Acquisto n. 123')
    expect(md).toContain('## Fornitore')
    expect(md).toContain('| **Azienda** | ACME |')
    expect(md).not.toContain('## Importi')
    expect(md).not.toContain('## Pagamento')
  })

  it('regge un oggetto vuoto senza rompersi', () => {
    expect(contractToMarkdown({})).toBe('# Contratto di Acquisto')
  })

  it('mette in grassetto l\'importo totale, che è il numero che si cerca', () => {
    const md = contractToMarkdown({ importi: { importo_totale: '1.200,00 €' } })
    expect(md).toContain('| **Importo totale** | **1.200,00 €** |')
  })
})

describe('jsonToReadableMd', () => {
  it('riconosce un contratto dal campo numero_contratto', () => {
    expect(jsonToReadableMd('{"numero_contratto":"9"}')).toContain('# Contratto di Acquisto n. 9')
  })

  it('restituisce null su JSON non valido, invece di sollevare', () => {
    expect(jsonToReadableMd('{ questo non e json }')).toBeNull()
  })

  it('restituisce null su oggetto senza campi semplici', () => {
    expect(jsonToReadableMd('{"a":{"b":1}}')).toBeNull()
  })

  it('su un oggetto qualsiasi elenca i campi piatti', () => {
    expect(jsonToReadableMd('{"codice_ditta":"2","nome":"COSEDIL"}'))
      .toBe('**codice ditta:** 2  \n**nome:** COSEDIL')
  })
})
