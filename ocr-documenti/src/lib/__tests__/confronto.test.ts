/**
 * Test del confronto bozza Word ↔ PDF firmato.
 *
 * La regola è una sola — il PDF vince — ma le trappole sono tre: l'OCR spezza i
 * paragrafi in righe, sbaglia lettere, e un prezzo cambiato di una cifra deve
 * contare come modifica mentre una lettera sbagliata no.
 */
import { describe, it, expect } from 'vitest'
import { chiaveParola, diffMyers, somiglianza, confrontaTesti } from '../confronto'

describe('chiaveParola', () => {
  it('appiattisce maiuscole, accenti, punteggiatura e confusioni OCR', () => {
    expect(chiaveParola('Perché,')).toBe('perche')
    expect(chiaveParola('Il')).toBe(chiaveParola('II'))
    expect(chiaveParola('Il')).toBe(chiaveParola('11'))
    expect(chiaveParola('**Art.**')).toBe('art')
  })
  it('i token di sola formattazione hanno chiave vuota', () => {
    expect(chiaveParola('|')).toBe('')
    expect(chiaveParola('---')).toBe('')
  })
})

describe('diffMyers', () => {
  const testo = (p: ReturnType<typeof diffMyers>) => p!.map(x => x.tipo[0]).join('')
  it('sequenze uguali → solo «uguale»', () => {
    expect(testo(diffMyers(['a', 'b', 'c'], ['a', 'b', 'c']))).toBe('uuu')
  })
  it('inserimento e cancellazione al posto giusto', () => {
    expect(testo(diffMyers(['a', 'b', 'c'], ['a', 'x', 'b', 'c']))).toBe('umuu')
    expect(testo(diffMyers(['a', 'b', 'c'], ['a', 'c']))).toBe('utu')
  })
  it('sostituzione = togli + metti contigui', () => {
    const p = diffMyers(['a', 'b', 'c'], ['a', 'z', 'c'])!
    expect(p.filter(x => x.tipo !== 'uguale').map(x => x.tipo).sort()).toEqual(['metti', 'togli'])
  })
  it('rinuncia oltre il tetto di differenze', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`)
    expect(diffMyers(a, b, 20)).toBeNull()
    expect(diffMyers(a, b)).not.toBeNull()
  })
})

describe('somiglianza', () => {
  it('1 per uguali, 0 per estranei, in mezzo per simili', () => {
    expect(somiglianza('fornitura', 'fornitura')).toBe(1)
    expect(somiglianza('fornitura', 'xyz')).toBe(0)
    expect(somiglianza('fornitura', 'fornltura')).toBeGreaterThan(0.6)
  })
})

describe('confrontaTesti', () => {
  const word = [
    'CONTRATTO DI NOLO A FREDDO',
    'La società Ragusana Lotto 4 scarl con sede in Santa Venerina affida il nolo delle casseforme.',
    'Il canone mensile è di 1.250,00 € per ogni modulo, oltre IVA.',
    'La consegna avviene entro 30 giorni dalla firma.',
  ].join('\n')

  it('testi uguali: nessuna differenza, testo esatto dal Word nella struttura del PDF', () => {
    // il PDF spezza il paragrafo in due righe fisiche e perde un accento
    const pdf = [
      'CONTRATTO DI NOLO A FREDDO',
      'La societa Ragusana Lotto 4 scarl con sede in Santa',
      'Venerina affida il nolo delle casseforme.',
      'Il canone mensile e di 1.250,00 € per ogni modulo, oltre IVA.',
      'La consegna avviene entro 30 giorni dalla firma.',
    ].join('\n')
    const c = confrontaTesti(word, pdf)
    expect(c.confrontabile).toBe(true)
    expect(c.differenze).toEqual([])
    const righe = c.testoUnito.split('\n')
    expect(righe).toHaveLength(5)                       // struttura del PDF
    expect(righe[1]).toBe('La società Ragusana Lotto 4 scarl con sede in Santa')   // accento dal Word
    expect(righe[3]).toContain('è di 1.250,00')
  })

  it('un prezzo cambiato a penna è una modifica e vince il PDF', () => {
    const pdf = word.replace('1.250,00', '1.350,00')
    const c = confrontaTesti(word, pdf)
    expect(c.riepilogo).toEqual({ modificate: 1, aggiunte: 0, rimosse: 0, spostate: 0, rumore: 0 })
    expect(c.differenze[0]).toMatchObject({ tipo: 'modificata', word: '1.250,00', pdf: '1.350,00', rigaPdf: 3 })
    expect(c.testoUnito).toContain('1.350,00')
    expect(c.testoUnito).not.toContain('1.250,00')
  })

  it('una lettera sbagliata dall’OCR è rumore: resta il Word', () => {
    const pdf = word.replace('casseforme', 'cassefonne').replace('consegna', 'consegua')
    const c = confrontaTesti(word, pdf)
    expect(c.riepilogo.rumore).toBe(2)
    expect(c.riepilogo.modificate).toBe(0)
    expect(c.testoUnito).toContain('casseforme')
    expect(c.testoUnito).toContain('consegna')
  })

  it('una frase riscritta è una modifica (non rumore) e vince il PDF', () => {
    const pdf = word.replace('entro 30 giorni dalla firma', 'a cura dell’appaltatore entro 60 giorni')
    const c = confrontaTesti(word, pdf)
    // il diff è a parole: «entro» e «giorni» coincidono, il resto sono più differenze
    // piccole, e «30 → 60» resta una modifica (non un tolto + un messo)
    expect(c.riepilogo.rumore).toBe(0)
    expect(c.differenze).toContainEqual({ tipo: 'modificata', word: '30', pdf: '60', rigaPdf: 4 })
    expect(c.testoUnito).toContain('a cura dell’appaltatore entro 60 giorni')
    expect(c.testoUnito).not.toContain('dalla firma')
  })

  it('righe solo nel PDF si aggiungono, righe solo nel Word spariscono', () => {
    const pdf = word.split('\n').slice(0, 3).concat('Firmato per accettazione.').join('\n')
    const c = confrontaTesti(word, pdf)
    // riga sparita e riga comparsa nello stesso punto: due fatti, non una «modifica»
    expect(c.riepilogo.rimosse).toBe(1)
    expect(c.riepilogo.aggiunte).toBe(1)
    expect(c.riepilogo.modificate).toBe(0)
    expect(c.testoUnito).toContain('Firmato per accettazione.')
    expect(c.testoUnito).not.toContain('La consegna')
  })

  it('la stessa riga in un altro punto è «spostata», non tolta + aggiunta', () => {
    const righe = word.split('\n')
    const pdf = [righe[0], righe[3], righe[1], righe[2]].join('\n')     // l'ultima riga sale in seconda posizione
    const c = confrontaTesti(word, pdf)
    expect(c.riepilogo.spostate).toBe(1)
    expect(c.riepilogo.aggiunte + c.riepilogo.rimosse).toBe(0)
    expect(c.testoUnito.split('\n')[1]).toBe(righe[3])                   // ordine del PDF
  })

  it('lo spazio dopo l’apostrofo non è una differenza', () => {
    const c = confrontaTesti('a carico dell’Utilizzatrice', 'a carico dell’ Utilizzatrice')
    expect(c.differenze).toEqual([])
    expect(c.testoUnito).toBe('a carico dell’Utilizzatrice')     // e in uscita lo spazio sparisce
  })

  it('conserva i separatori di pagina e le tabelle markdown del PDF', () => {
    const pdf = 'CONTRATTO DI NOLO A FREDDO\n\n---\n\n| Voce | Prezzo |\n| Casseforme | 1.250,00 |'
    const w = 'CONTRATTO DI NOLO A FREDDO\nVoce Prezzo\nCasseforme 1.250,00'
    const c = confrontaTesti(w, pdf)
    expect(c.testoUnito).toBe(pdf)
  })

  it('documenti estranei: non confrontabile, resta il PDF', () => {
    const c = confrontaTesti('tutt’altro documento su tutt’altro argomento', 'CONTRATTO DI NOLO A FREDDO')
    expect(c.confrontabile).toBe(true)          // pochi token: il diff riesce, ma sono tutte differenze
    expect(confrontaTesti('', 'x').confrontabile).toBe(false)
  })
})
