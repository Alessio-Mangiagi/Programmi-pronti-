// "><(((º> sabusabu <º)))><"
// Icone dei programmi (assets/js/common.js, ICONE_APP + iconaApp): un solo insieme per home, plancia,
// registro, abilitazioni, avvisi e utenti dal 09/11/2026. Questi test fanno sì che un programma nuovo
// in APPS (server.js) non mostri mai una sigla di testo o un'icona mancante: senza il suo disegno in
// common.js il test fallisce. Zero dipendenze: node --test.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// server.js risolve DATA_DIR al caricamento: cartella temporanea, mai i dati veri del portale
const DATA_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'portale-icone-'));
process.env.DATA_DIR = DATA_TMP;
test.after(() => fs.rmSync(DATA_TMP, { recursive: true, force: true }));
const { APPS } = require('./server.js');

// common.js è uno script del browser (niente export): lo si esegue in un contesto a parte e si
// leggono le due costanti che servono.
const sorgente = fs.readFileSync(path.join(__dirname, 'assets', 'js', 'common.js'), 'utf8');
const { ICONE_APP, ICONA_GENERICA, iconaApp } = vm.runInNewContext(
  sorgente + '\n;({ ICONE_APP, ICONA_GENERICA, iconaApp })', {});

test('ogni programma del registro APPS ha la sua icona in common.js', () => {
  const senza = APPS.map((a) => a.id).filter((id) => !Object.prototype.hasOwnProperty.call(ICONE_APP, id));
  assert.deepStrictEqual(senza, [], `programmi senza icona in assets/js/common.js (ICONE_APP): ${senza.join(', ')}`);
});

test("c'è anche l'icona del portale (righe del registro fatte nel portale)", () => {
  assert.ok(ICONE_APP.portale);
});

test('iconaApp: SVG a linee decorativo; id sconosciuto = icona generica, mai testo', () => {
  for (const id of [...APPS.map((a) => a.id), 'portale']) {
    const svg = iconaApp(id);
    assert.match(svg, /^<svg class="ic-app" aria-hidden="true"[^>]* viewBox="0 0 24 24" fill="none" stroke="currentColor"/);
    assert.ok(svg.includes(ICONE_APP[id]), id);
    assert.ok(svg.endsWith('</svg>'));
  }
  const ignota = iconaApp('programma-aggiunto-dagli-admin');
  assert.ok(ignota.includes(ICONA_GENERICA));
  assert.ok(iconaApp('__proto__').includes(ICONA_GENERICA));   // niente sorprese dal prototipo
  assert.ok(iconaApp(undefined).includes(ICONA_GENERICA));
});

test('nessuna pagina usa più il vecchio doppione delle icone (ICONS / TRATTI)', () => {
  const js = path.join(__dirname, 'assets', 'js');
  for (const f of fs.readdirSync(js).filter((n) => n.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(js, f), 'utf8');
    assert.ok(!/\bICONS\[|\bTRATTI\[/.test(s), `${f} usa ancora ICONS/TRATTI invece di iconaApp`);
  }
});

test('tutte le pagine hanno il marchio ufficiale come icona della scheda del browser', () => {
  const pagine = path.join(__dirname, 'pages');
  for (const f of fs.readdirSync(pagine).filter((n) => n.endsWith('.html'))) {
    const s = fs.readFileSync(path.join(pagine, f), 'utf8');
    assert.ok(s.includes('href="/assets/icon/favicon-32.png"'), `${f}: favicon`);
    assert.ok(s.includes('src="/assets/icon/marchio-96.png"'), `${f}: marchio in testata`);
  }
  for (const file of ['favicon-32.png', 'marchio-96.png', 'suite-cosedil.ico']) {
    assert.ok(fs.existsSync(path.join(__dirname, 'assets', 'icon', file)), file);
  }
});
