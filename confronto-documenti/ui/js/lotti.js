// "><(((º> sabusabu <º)))><"
// lotti.js — più confronti in un colpo dal cassetto cartella:
//   - "Abbina versioni": nella cartella aperta raggruppa i file con lo stesso
//     nome base (computo_rev1 / computo_rev2, offerta_v3, relazione_2026-10-01)
//     e propone di confrontare penultima e ultima versione di ogni gruppo;
//   - "Confronta con altra cartella": abbina i file di due cartelle per nome
//     uguale o molto simile (Rev1/computo.pdf con Rev2/computo.pdf).
// I confronti partono tutti insieme: il server li mette in coda e li esegue
// pochi alla volta; si seguono e si aprono dallo Storico.
import { $, esc } from './dom.js';
import { fileCartella } from './folder.js';
import { impostazioni } from './compare.js';
import { ricorda, mostraStorico } from './storico.js';

const rel = f => f.webkitRelativePath || f.name;
const estensione = n => (n.match(/\.[^.]+$/) || [''])[0].toLowerCase();

// Nome base senza estensione e senza i suffissi di versione più comuni.
const SUFFISSI = [
  /[\s_\-.]*(rev|r|v|ver|vers|versione|release)[\s_\-.]*\d+[a-z]?$/i,
  /[\s_\-.]*\d{4}[\-_.]?\d{2}[\-_.]?\d{2}$/,            // 2026-10-01 / 20261001
  /[\s_\-.]*\d{2}[\-_.]\d{2}[\-_.]\d{2,4}$/,             // 01-10-2026
  /[\s_\-.]*\(\d+\)$/,                                   // copia (2)
  /[\s_\-.]*(def|definitivo|definitiva|bozza|draft|old|new|vecchio|nuovo|firmato|firmata|agg|aggiornato|finale|copia)$/i,
];
export function nomeBase(nome) {
  let b = nome.replace(/\.[^.]+$/, '').toLowerCase().trim();
  for (let giro = 0, prima = ''; giro < 4 && b !== prima; giro++) {
    prima = b;
    SUFFISSI.forEach(re => { b = b.replace(re, ''); });
  }
  return b.replace(/[\s_\-.]+/g, ' ').trim();
}

// Chiave di ordinamento della versione: numero di rev/v, poi data nel nome,
// poi data di modifica del file.
function chiaveVersione(f) {
  const n = f.name.replace(/\.[^.]+$/, '');
  const rev = n.match(/(?:rev|r|v|ver|vers|versione)[\s_\-.]*(\d+)/i);
  const data = n.match(/(\d{4})[\-_.]?(\d{2})[\-_.]?(\d{2})/) || n.match(/(\d{2})[\-_.](\d{2})[\-_.](\d{4})/);
  let d = 0;
  if (data) d = data[1].length === 4 ? +(data[1] + data[2] + data[3]) : +(data[3] + data[2] + data[1]);
  return [rev ? +rev[1] : -1, d, f.lastModified || 0];
}
const confrontaChiavi = (x, y) => { for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// Gruppi di versioni nella cartella → coppie (consecutive); preselezionata
// l'ultima coppia di ogni gruppo (penultima ↔ ultima).
export function coppieVersioni(files) {
  const gruppi = new Map();
  files.forEach(f => {
    const k = nomeBase(f.name);
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(f);
  });
  const coppie = [];
  [...gruppi.entries()].sort().forEach(([base, fs]) => {
    if (fs.length < 2) return;
    fs.sort((x, y) => confrontaChiavi(chiaveVersione(x), chiaveVersione(y)));
    for (let i = 0; i < fs.length - 1; i++) {
      coppie.push({ a: fs[i], b: fs[i + 1], motivo: base + ' · versione ' + (i + 1) + ' → ' + (i + 2) + ' di ' + fs.length,
                    scelta: i === fs.length - 2 });
    }
  });
  return coppie;
}

// Somiglianza grezza tra due nomi (bigrammi di Dice), 0..1.
function somiglianza(x, y) {
  if (x === y) return 1;
  const big = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const a = big(x), b = big(y);
  let comuni = 0, tot = 0;
  a.forEach((n, g) => { comuni += Math.min(n, b.get(g) || 0); tot += n; });
  b.forEach(n => { tot += n; });
  return tot ? 2 * comuni / tot : 0;
}

// Abbina i file di due cartelle: stesso nome, altrimenti nome base più simile
// (almeno 80%). I file senza corrispondenza vengono elencati a parte.
export function coppieCartelle(filesA, filesB) {
  const liberi = new Set(filesB);
  const coppie = [], soli = [];
  filesA.forEach(fa => {
    let best = null, score = 0;
    liberi.forEach(fb => {
      if (estensione(fa.name) !== estensione(fb.name)) return;
      const s = fa.name.toLowerCase() === fb.name.toLowerCase() ? 1.01 : somiglianza(nomeBase(fa.name), nomeBase(fb.name));
      if (s > score) { best = fb; score = s; }
    });
    if (best && score >= 0.8) {
      liberi.delete(best);
      coppie.push({ a: fa, b: best, motivo: score > 1 ? 'stesso nome' : score === 1 ? 'stesso nome, altra versione'
                                         : 'nome simile ' + Math.round(score * 100) + '%', scelta: true });
    } else {
      soli.push('solo in A: ' + rel(fa));
    }
  });
  liberi.forEach(fb => soli.push('solo in B: ' + rel(fb)));
  return { coppie, soli };
}

let proposte = [];

function mostra(titolo, coppie, soli = []) {
  proposte = coppie;
  $('#lottiTitolo').textContent = titolo;
  $('#lottiLista').innerHTML = coppie.length
    ? coppie.map((c, i) =>
        '<li><label class="lotto-riga"><input type="checkbox" data-i="' + i + '"' + (c.scelta ? ' checked' : '') + '>' +
        '<span class="lotto-nomi"><b>' + esc(rel(c.a)) + '</b> <span class="lotto-freccia">↔</span> <b>' + esc(rel(c.b)) + '</b></span>' +
        '<span class="lotto-motivo">' + esc(c.motivo) + '</span></label></li>').join('')
    : '<li class="lotto-vuoto">Nessuna coppia trovata.</li>';
  $('#lottiSoli').innerHTML = soli.length
    ? '<details><summary>' + soli.length + ' file senza corrispondenza</summary><ul>' +
      soli.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul></details>' : '';
  aggiornaConteggio();
  $('#lottiEsito').textContent = '';
  $('#lotti').showModal();
}

function aggiornaConteggio() {
  const n = document.querySelectorAll('#lottiLista input:checked').length;
  $('#lottiVia').textContent = 'Avvia ' + n + (n === 1 ? ' confronto' : ' confronti');
  $('#lottiVia').disabled = !n;
}

async function avvia() {
  const scelte = [...document.querySelectorAll('#lottiLista input:checked')].map(i => proposte[+i.dataset.i]);
  $('#lottiVia').disabled = true;
  let ok = 0;
  for (const [k, c] of scelte.entries()) {
    $('#lottiEsito').textContent = 'Invio ' + (k + 1) + ' di ' + scelte.length + '…';
    const fd = new FormData();
    fd.append('pdf1', c.a);
    fd.append('pdf2', c.b);
    impostazioni(fd);
    try {
      const r = await fetch('/api/compare', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      ricorda(d.job_id, c.a.name, c.b.name);
      ok++;
    } catch (err) {
      $('#lottiEsito').textContent = rel(c.a) + ': ' + err.message;
    }
  }
  $('#lotti').close();
  mostraStorico();   // lo Storico mostra l'avanzamento e apre i risultati
  if (ok < scelte.length) alert((scelte.length - ok) + ' confronti non sono partiti.');
}

export function initLotti() {
  const secondaria = $('#folderInputB');
  $('#lottiVersioni').addEventListener('click', () => {
    mostra('Versioni nella cartella', coppieVersioni(fileCartella()));
  });
  $('#lottiAltra').addEventListener('click', () => secondaria.click());
  secondaria.addEventListener('change', () => {
    const b = [...secondaria.files].filter(f => fileCartella().length && /\.(pdf|png|jpe?g|tiff?|bmp|webp|gif|docx|txt|md|csv)$/i.test(f.name));
    secondaria.value = '';
    if (!b.length) return;
    const { coppie, soli } = coppieCartelle(fileCartella(), b);
    mostra('Cartella A ↔ cartella B', coppie, soli);
  });
  $('#lottiLista').addEventListener('change', aggiornaConteggio);
  $('#lottiVia').addEventListener('click', avvia);
  $('#lottiChiudi').addEventListener('click', () => $('#lotti').close());
}
