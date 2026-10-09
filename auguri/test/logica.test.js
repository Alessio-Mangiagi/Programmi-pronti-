// Test della logica pura (date, celle Excel, messaggi): node --test.
// Il motore WhatsApp non si tocca: server.js non viene caricato.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logica');

// Le date di ExcelJS arrivano a mezzanotte UTC.
const utc = (a, m, g) => new Date(Date.UTC(a, m - 1, g));
const locale = (a, m, g) => new Date(a, m - 1, g, 10, 0);

test('eCompleannoOggi: Date di Excel (UTC)', () => {
    assert.equal(L.eCompleannoOggi(utc(1980, 3, 15), locale(2026, 3, 15)), true);
    assert.equal(L.eCompleannoOggi(utc(1980, 3, 15), locale(2026, 3, 16)), false);
    assert.equal(L.eCompleannoOggi(new Date('x'), locale(2026, 3, 15)), false);
});

test('eCompleannoOggi: seriale Excel', () => {
    // 29221 = 1 gennaio 1980
    assert.equal(L.eCompleannoOggi(29221, locale(2026, 1, 1)), true);
    assert.equal(L.eCompleannoOggi(29221, locale(2026, 1, 2)), false);
});

test('eCompleannoOggi: stringhe GG/MM/AAAA e ISO', () => {
    assert.equal(L.eCompleannoOggi('15/03/1980', locale(2026, 3, 15)), true);
    assert.equal(L.eCompleannoOggi('1980-03-15', locale(2026, 3, 15)), true);
    assert.equal(L.eCompleannoOggi('1980-03-15T00:00:00Z', locale(2026, 3, 15)), true);
    assert.equal(L.eCompleannoOggi('15.03.1980', locale(2026, 3, 15)), false);
});

test('eCompleannoOggi: date impossibili scartate, non spostate', () => {
    // new Date() avrebbe trasformato il 31/04 nel 1 maggio
    assert.equal(L.eCompleannoOggi('31/04/1980', locale(2026, 5, 1)), false);
    assert.equal(L.eCompleannoOggi('00/04/1980', locale(2026, 3, 31)), false);
    assert.equal(L.eCompleannoOggi('10/13/1980', locale(2026, 1, 10)), false);
});

test('eCompleannoOggi: 29 febbraio', () => {
    const nato = utc(1984, 2, 29);
    assert.equal(L.eCompleannoOggi(nato, locale(2026, 2, 28)), true, 'anno non bisestile: il 28');
    assert.equal(L.eCompleannoOggi(nato, locale(2026, 3, 1)), false);
    assert.equal(L.eCompleannoOggi(nato, locale(2028, 2, 28)), false, 'anno bisestile: non il 28');
    assert.equal(L.eCompleannoOggi(nato, locale(2028, 2, 29)), true);
    assert.equal(L.eCompleannoOggi('29/02/1984', locale(2027, 2, 28)), true);
    assert.equal(L.eCompleannoOggi(nato, locale(2100, 2, 28)), true, '2100 non e\' bisestile');
});

test('eCompleannoOggi: tipi non data', () => {
    for (const v of [null, undefined, true, {}, []]) {
        // "><(((º> sabusabu <º)))><"
        assert.equal(L.eCompleannoOggi(v, locale(2026, 1, 1)), false);
    }
});

test('valoreCella: formula, rich text, link, errore', () => {
    const d = utc(1980, 1, 1);
    assert.equal(L.valoreCella({ formula: 'DATE(1980,1,1)', result: d }), d);
    assert.equal(L.valoreCella({ richText: [{ text: 'Ma' }, { text: 'rio' }] }), 'Mario');
    assert.equal(L.valoreCella({ text: 'Luigi', hyperlink: 'mailto:x' }), 'Luigi');
    assert.equal(L.valoreCella({ error: '#N/A' }), null);
    assert.equal(L.valoreCella('testo'), 'testo');
    assert.equal(L.valoreCella(42), 42);
    assert.equal(L.valoreCella(null), null);
});

test('formattaData', () => {
    assert.equal(L.formattaData(utc(1980, 3, 5)), '05/03/1980');
    assert.equal(L.formattaData(29221), '01/01/1980');
    assert.equal(L.formattaData('1980-03-05T00:00:00Z'), '1980-03-05');
});

test('unisciNomi e nomeCompleto', () => {
    assert.equal(L.unisciNomi([{ nome: 'Anna', cognome: 'Rossi' }]), 'Anna Rossi');
    assert.equal(L.unisciNomi([{ nome: 'Anna' }, { nome: 'Bruno' }, { nome: 'Carla' }]), 'Anna, Bruno e Carla');
});

test('costruisciMessaggio: segnaposto {nome}', () => {
    const p = [{ nome: 'Anna', cognome: '' }, { nome: 'Bruno', cognome: '' }];
    assert.equal(L.costruisciMessaggio(p, 'Auguri {nome}! Grazie {nome}'), 'Auguri Anna e Bruno! Grazie Anna e Bruno');
    assert.equal(L.costruisciMessaggio(p, 'Auguri!'), '🎉 Anna e Bruno!\n\nAuguri!');
});

test('costruisciMessaggio: "$" nei nomi non viene interpretato', () => {
    const p = [{ nome: 'A$&B', cognome: '$1' }];
    assert.equal(L.costruisciMessaggio(p, 'Ciao {nome}'), 'Ciao A$&B $1');
});

test('prossimiCompleanni: ordine, oggi escluso, finestra, cambio anno', () => {
    const persone = [
        { nome: 'Oggi', cognome: '', dataNascita: utc(1990, 12, 30) },
        { nome: 'Tra3', cognome: '', dataNascita: utc(1985, 1, 2) },
        { nome: 'Domani', cognome: 'X', dataNascita: '31/12/1970' },
        { nome: 'Lontano', cognome: '', dataNascita: utc(1980, 2, 1) },
    ];
    const r = L.prossimiCompleanni(persone, 14, locale(2026, 12, 30));
    assert.deepEqual(r.map((p) => [p.nome, p.tra]), [['Domani X', 1], ['Tra3', 3]]);
    assert.equal(r[1].data, '02/01/1985');
    assert.deepEqual(L.prossimiCompleanni(persone, 0, locale(2026, 12, 30)), []);
});

test('prossimiCompleanni: 29 febbraio nella finestra di un anno non bisestile', () => {
    const r = L.prossimiCompleanni([{ nome: 'Bis', cognome: '', dataNascita: utc(1984, 2, 29) }], 7, locale(2027, 2, 25));
    assert.deepEqual(r.map((p) => p.tra), [3]);   // festeggiato il 28
});

test('fraseCasuale: pool vuoto -> frase di riserva', () => {
    assert.match(L.fraseCasuale([]), /auguri/i);
    assert.equal(L.fraseCasuale(['unica']), 'unica');
});
