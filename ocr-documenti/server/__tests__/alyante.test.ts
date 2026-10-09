/**
 * Aggancio agli elenchi ufficiali Alyante: le funzioni sono pure, ma leggono
 * ELENCHI (cartella Elenchi/) a import. I casi qui sotto dipendono solo dalle
 * regole deterministiche (regex, punteggi), non dal contenuto degli xlsx, salvo
 * dove indicato con `skipIf`.
 */
import { describe, it, expect } from 'vitest'
import {
  ELENCHI, COMMESSA_RE, HA_FORMA_COMMESSA, classifyFamSfam, condFeatures, diceSim,
  matchCommessa, matchCondPagamento, matchConto, matchDivisione, matchFamSfam,
  migliorePerDescrizione, normTxt, normalizzaRisultatoAlyante, tokenSet,
} from '../alyante.ts'

describe('fuzzy su descrizione', () => {
  it('normTxt toglie accenti, maiuscole e punteggiatura', () => {
    expect(normTxt('  Società  À-B.C. ')).toBe('societa a b c')
  })
  it('tokenSet scarta i token corti', () => {
    expect([...tokenSet('a di posa in opera')]).toEqual(['posa', 'opera'])
  })
  it('diceSim: uguali → 1, disgiunti → 0, vuoti → 0', () => {
    expect(diceSim(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
    // "><(((º> sabusabu <º)))><"
    expect(diceSim(new Set(['a']), new Set(['b']))).toBe(0)
    expect(diceSim(new Set(), new Set(['b']))).toBe(0)
  })
  it('migliorePerDescrizione rispetta la soglia', () => {
    const lista = [{ codice: '1', descrizione: 'fornitura acciaio' }, { codice: '2', descrizione: 'nolo gru' }]
    expect(migliorePerDescrizione('fornitura di acciaio', lista, 0.5)?.codice).toBe('1')
    expect(migliorePerDescrizione('trasporto', lista, 0.5)).toBeNull()
  })
})

describe('matchDivisione', () => {
  it('tipologia → codice deterministico', () => {
    expect(matchDivisione('', 'Subappalto')).toBe('03')
    expect(matchDivisione('', 'Fornitura e posa')).toBe('02')
    expect(matchDivisione('', 'Nolo a caldo')).toBe('04')
    expect(matchDivisione('', 'Nolo a freddo')).toBe('05')
    expect(matchDivisione('', 'Nolo infragruppo')).toBe('05')
  })
  it('"prestazioni" vince solo se nessun altro pattern combacia', () => {
    expect(matchDivisione('', 'prestazioni in subappalto')).toBe('03')
    expect(matchDivisione('', 'prestazione di servizi')).toBe('06')
  })
  it('valore non riconosciuto → invariato', () => {
    expect(matchDivisione('xyz', '')).toBe('xyz')
  })
})

describe('condFeatures / matchCondPagamento', () => {
  it('legge giorni, strumento, scadenza, acconto', () => {
    const f = condFeatures('acc. 30% BB 60/90 gg DFFM')
    expect(f.strumento).toBe('BB')
    expect(f.scadenza).toBe('DFFM')
    expect(f.acconto).toBe(true)
    expect(f.pctAcconto).toBe(30)
    expect(f.giorni.has(60)).toBe(true)
    expect(f.giorni.has(90)).toBe(true)
  })
  it('percentuali non sono giorni', () => {
    expect([...condFeatures('bonifico 60 gg, ritenuta 10%').giorni]).toEqual([60])
  })
  it('RB batte BB quando c’è "ri.ba."', () => {
    expect(condFeatures('Ri.Ba. 60 gg fine mese').strumento).toBe('RB')
    expect(condFeatures('Ri.Ba. 60 gg fine mese').scadenza).toBe('FM')
  })
  it('valore vuoto → vuoto; codice già in elenco → identico', () => {
    expect(matchCondPagamento('')).toBe('')
    if (ELENCHI.condPagamento.length) {
      const c = ELENCHI.condPagamento[0].codice
      expect(matchCondPagamento(c.toLowerCase())).toBe(c)
    }
  })
})

describe('COMMESSA_RE / matchCommessa', () => {
  it('trova NNN-NNN e suffisso, tollerando i separatori', () => {
    const m = [...'commessa 193-136_6_008 e 208.148'.matchAll(COMMESSA_RE)]
    expect(m.map(x => x[0].trim())).toEqual(['193-136_6', '208.148'])
  })
  it('HA_FORMA_COMMESSA è stabile fra chiamate (niente flag g)', () => {
    expect(HA_FORMA_COMMESSA.test('193-136')).toBe(true)
    expect(HA_FORMA_COMMESSA.test('193-136')).toBe(true)
    expect(HA_FORMA_COMMESSA.test('FORPOS-2025-0')).toBe(false)
  })
  it.skipIf(!ELENCHI.commesse.length)('codice in elenco → esatto; suffisso ≥2 cifre = progressivo contratto', () => {
    const base = ELENCHI.commesse.find(c => /^\d{3}-\d{3}$/.test(c.codice))
    if (!base) return
    expect(matchCommessa({ codice: `${base.codice}_042` })).toBe(base.codice)
    expect(matchCommessa({ codice_progetto: base.codice.replace('-', '.') })).toBe(base.codice)
  })
  it('niente candidati e oggetto ignoto → vuoto', () => {
    expect(matchCommessa({ oggetto: 'zzz qqq' })).toBe('')
  })
})

describe('matchConto', () => {
  it.skipIf(!ELENCHI.pianoConti.length)('prende le ultime 3 cifre', () => {
    const c = ELENCHI.pianoConti[0].codice
    expect(matchConto(`1.${c}`)).toBe(c)
  })
  it('vuoto → vuoto', () => { expect(matchConto('')).toBe('') })
})

describe('matchFamSfam', () => {
  it('codici non in elenco → svuotati', () => {
    expect(matchFamSfam('ZZ', 'ZZ999')).toEqual(['', ''])
  })
  it.skipIf(!ELENCHI.famiglie.length)('sottofamiglia valida → famiglia coerente', () => {
    const v = ELENCHI.famiglie[0]
    expect(matchFamSfam('', v.sfam.toLowerCase())).toEqual([v.fam, v.sfam])
  })
})

describe('classifyFamSfam', () => {
  it('tipologia prima delle parole chiave', () => {
    expect(classifyFamSfam('Subappalto', 'acciaio')).toEqual(['C', 'C101'])
    expect(classifyFamSfam('Nolo a freddo')).toEqual(['E', 'E035'])
    expect(classifyFamSfam('Nolo a caldo')).toEqual(['C', 'C107'])
    expect(classifyFamSfam('Nolo infragruppo')).toEqual(['E', 'E030'])
  })
  it('fornitura: sottofamiglia da parola chiave', () => {
    expect(classifyFamSfam('Fornitura', 'tondino b450c')).toEqual(['A', 'A401'])
    expect(classifyFamSfam('Fornitura', 'calcestruzzo C25/30')).toEqual(['A', 'A408'])
    expect(classifyFamSfam('Fornitura', 'materiale generico')).toEqual(['A', ''])
  })
  it('incerto → vuoto', () => { expect(classifyFamSfam('', 'boh')).toEqual(['', '']) })
})

describe('normalizzaRisultatoAlyante', () => {
  it('JSON non parsabile → invariato', () => {
    expect(normalizzaRisultatoAlyante('{non json')).toBe('{non json')
  })
  it.skipIf(!ELENCHI.commesse.length)('codice_progetto senza forma commessa → svuotato', () => {
    const out = JSON.parse(normalizzaRisultatoAlyante(JSON.stringify({ testata: { codice_progetto: 'FORPOS-2025-0', oggetto: '' } })))
    expect(out.testata.codice_progetto).toBe('')
  })
})
