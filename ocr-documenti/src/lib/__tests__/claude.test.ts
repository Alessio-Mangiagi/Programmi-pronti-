import { describe, it, expect } from 'vitest'
import { promptClaude, promptClaudeModulo, urlClaude, leggiEstratto, leggiTrascrizioneJson, leggiTrascrizioneMd, moduloDaRisposta } from '../claude'
import { leggiModulo, moduloVuoto } from '../modulo-contratto'
import { ELENCHI } from '../../../server/alyante.ts'

describe('promptClaude', () => {
  it('su IMPORT P6 chiede a Claude di compilare il modulo contratto, non l’Excel né il JSON', () => {
    const p = promptClaude('contratti', 'LT26.pdf', false, ELENCHI)
    expect(p).toContain('"LT26.pdf"')
    expect(p).toContain('COMPILA IL MODULO CONTRATTO')
    // il modulo vuoto è dentro il prompt, generato dalla stessa specifica che lo rilegge
    expect(p).toContain(moduloVuoto())
    expect(p).not.toContain('CREA UN FILE EXCEL')
    expect(p).not.toContain('"testata"')
    // dell'elenco commesse servono i codici: il resto (DITTA, COND.PAG) lo aggancia il programma
    for (const c of ELENCHI.commesse) expect(p).toContain(`${c.codice}=`)
  })
  it('sul formato CONTRATTO chiede lo stesso modulo', () => {
    expect(promptClaude('contract', 'LT26.pdf', true, ELENCHI)).toBe(promptClaude('contratti', 'LT26.pdf', true, ELENCHI))
  })
  it('DIVISIONE 08 solo per i servizi: le forniture non la ricevono dal prompt', () => {
    const p = promptClaudeModulo('a.pdf', ELENCHI)
    expect(p).toMatch(/servizi[^\n]*Passivo a Misura e in questo solo caso DIVISIONE: 08/)
    expect(p).toMatch(/fornitura di materiali \(con o senza posa\) → Fornitura e posa/)
  })
  it('il prompt del modulo con gli elenchi veri sta nel limite dell’URL di claude.ai (~64k codificato)', () => {
    const u = urlClaude(promptClaudeModulo('contratto con nome lungo 2026_198-138_029.pdf', ELENCHI, true))
    expect(u.length).toBeLessThan(60_000)
  })
  it('senza elenchi lo dice, invece di inventare codici', () => {
    expect(promptClaudeModulo('a.pdf', null)).toContain('Elenco commesse non disponibile')
  })
  it('in .MD chiede la trascrizione, non il JSON', () => {
    // "><(((º> sabusabu <º)))><"
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

// Modulo d'esempio come lo scrive Claude: campi obbligatori, una voce che torna.
const MODULO = `MODULO CONTRATTO OCR v1
# Modulo compilato da Claude leggendo "a.pdf"
[TESTATA]
CODICE CONTRATTO: 208-148_042/2026
COMMESSA: 208-148
FORNITORE: Sidersipe S.r.l.
TIPOLOGIA: Fornitura e posa
DATA CONTRATTO: 11/05/2026
OGGETTO: Fornitura acciaio B450C
[IMPORTI]
IMPORTO LAVORI: 1.000,00
[RIGHE]
ARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO
A.1 | Acciaio in barre | kg | 100,00 | 10,00 | 1.000,00
[FINE]`

describe('moduloDaRisposta', () => {
  it('prende il blocco di codice col modulo e scarta il testo attorno', () => {
    const m = moduloDaRisposta(`Ecco il modulo compilato:\n\n\`\`\`text\n${MODULO}\n\`\`\`\n\n1 voce.`)
    expect(m).toBe(MODULO + '\n')
    expect(leggiModulo(m!).errori).toEqual([])
  })
  it('unisce le prosecuzioni chieste con «continua» (blocchi successivi)', () => {
    const [prima, dopo] = MODULO.split('A.1 |')
    const r = `\`\`\`text\n${prima}\`\`\`\nScrivi «continua».\n\`\`\`text\nA.1 |${dopo}\n\`\`\``
    const m = moduloDaRisposta(r)!
    expect(leggiModulo(m).estratto.righe).toHaveLength(1)
    expect(leggiModulo(m).errori).toEqual([])
  })
  it('senza blocchi di codice prende dal marcatore in poi; dopo [FINE] taglia', () => {
    expect(moduloDaRisposta(`Ecco:\n${MODULO}\nSpero vada bene.`)).toBe(MODULO + '\n')
  })
  it('un blocco rimasto aperto (risposta interrotta) si legge lo stesso', () => {
    const m = moduloDaRisposta('```text\n' + MODULO.replace('[FINE]', ''))
    expect(m?.startsWith('MODULO CONTRATTO OCR v1')).toBe(true)
    expect(m).toContain('A.1 | Acciaio in barre')
  })
  it('null se la risposta non contiene un modulo (es. il JSON del prompt di prima)', () => {
    expect(moduloDaRisposta('{ "testata": { "codice": "X" } }')).toBeNull()
    expect(moduloDaRisposta('Non riesco ad aprire il file.')).toBeNull()
  })
})
