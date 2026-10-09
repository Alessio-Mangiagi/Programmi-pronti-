import { describe, it, expect } from 'vitest'
import { promptClaude, promptClaudeExcel, urlClaude, leggiEstratto, leggiTrascrizioneJson, leggiTrascrizioneMd } from '../claude'
import { IMPORT_CONTRATTI_COLS } from '../import-contratti'
import { ELENCHI } from '../../../server/alyante.ts'

describe('promptClaude', () => {
  it('su IMPORT P6 chiede a Claude di creare direttamente l’Import_Contratti.xlsx', () => {
    const p = promptClaude('contratti', 'LT26.pdf', false, ELENCHI)
    expect(p).toContain('"LT26.pdf"')
    expect(p).toContain('"LT26_Import_Contratti.xlsx"')
    expect(p).toContain('CREA UN FILE EXCEL')
    expect(p).toContain(IMPORT_CONTRATTI_COLS.join(' | '))
    expect(p).not.toContain('"testata"')
    // gli elenchi ufficiali sono dentro il prompt: senza, l'Excel esce con testi al posto dei codici
    expect(p).toContain('2=COSEDIL')
    for (const c of ELENCHI.condPagamento) expect(p).toContain(`${c.codice}=`)
    for (const c of ELENCHI.commesse) expect(p).toContain(`${c.codice}=`)
    for (const f of ELENCHI.famiglie) expect(p).toContain(`${f.fam}/${f.sfam}=`)
  })
  it('il prompt Excel con gli elenchi veri sta nel limite dell’URL di claude.ai (~64k codificato)', () => {
    const u = urlClaude(promptClaudeExcel('contratto con nome lungo 2026_198-138_029.pdf', ELENCHI, true))
    expect(u.length).toBeLessThan(60_000)
  })
  it('senza elenchi lo dice, invece di inventare codici', () => {
    const p = promptClaudeExcel('a.pdf', null)
    expect(p).toContain('Elenchi ufficiali non disponibili')
  })
  it('sul formato CONTRATTO chiede ancora l’Estratto {testata, importi, righe} in JSON', () => {
    const p = promptClaude('contract', 'LT26.pdf')
    expect(p).toContain('"testata"')
    expect(p).toContain('Rispondi SOLO con l\'oggetto JSON')
  })
  it('in .MD chiede la trascrizione, non il JSON', () => {
    const p = promptClaude('md', 'a.pdf')
    expect(p).toContain('Markdown')
    expect(p).not.toContain('"testata"')
  })
  it('l’URL apre claude.ai/new con il prompt in q', () => {
    const u = urlClaude('ciao mondo')
    expect(u.startsWith('https://claude.ai/new?q=')).toBe(true)
    expect(decodeURIComponent(u.split('q=')[1])).toBe('ciao mondo')
  })
})

describe('leggiEstratto', () => {
  it('legge il JSON anche dentro i fence e con testo attorno', () => {
    const r = 'Ecco i dati:\n```json\n{ "testata": { "codice": "LT26-1", "cig": null }, "importi": { "importo_lavori": "1.234,56" }, "righe": [ { "codice_epu": "A.1", "descrizione": "Scavo", "udm": "MC", "quantita": 10, "prezzo_lordo": "5,00", "importo": "50,00" } ] }\n```\nFammi sapere.'
    const e = leggiEstratto(r)
    expect(e.testata).toEqual({ codice: 'LT26-1' })
    expect(e.importi.importo_lavori).toBe('1.234,56')
    expect(e.righe).toHaveLength(1)
    expect(e.righe[0].quantita).toBe('10')
  })
  it('senza JSON dà un errore parlante', () => {
    expect(() => leggiEstratto('non ho trovato nulla')).toThrow(/oggetto JSON/)
  })
  it('JSON tagliato → errore che suggerisce «continua»', () => {
    expect(() => leggiEstratto('{ "testata": { "codice": "X" }, "righe": [ { "descrizione": "a" }')).toThrow(/tagliato|continua|JSON/)
  })
  it('JSON che non è l’Estratto → errore', () => {
    expect(() => leggiEstratto('{ "foo": 1 }')).toThrow(/testata/)
  })
})

describe('trascrizioni', () => {
  it('.JSON: tiene il JSON richiesto o impacchetta il testo riga per riga', () => {
    expect(JSON.parse(leggiTrascrizioneJson('{"tipo_documento":"Documento","testo":["a","b"]}')).testo).toEqual(['a', 'b'])
    expect(JSON.parse(leggiTrascrizioneJson('riga 1\n\nriga 2\n')).testo).toEqual(['riga 1', 'riga 2'])
  })
  it('.MD: toglie i fence attorno alla trascrizione', () => {
    expect(leggiTrascrizioneMd('```markdown\n# Titolo\ntesto\n```')).toBe('# Titolo\ntesto')
    expect(leggiTrascrizioneMd('  # Titolo  ')).toBe('# Titolo')
  })
})
