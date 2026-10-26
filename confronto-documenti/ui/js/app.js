// =============================================================================
// app.js — ENTRY POINT del front-end (caricato come <script type="module">).
//
// Architettura moduli (ES modules, nessun bundler, serviti statici da Flask):
//   state.js     stato condiviso in memoria (file scelti, job corrente, viewer)
//   dom.js       micro-helper ($, escape HTML, formattazioni)
//   models.js    popola la tendina "Motore OCR" da /api/models
//   dropzones.js drag&drop dei due file → state.a / state.b
//   folder.js    cassetto laterale "Sfoglia cartella" → righe da trascinare su A/B
//   compare.js   POST /api/compare, poi polling di /api/jobs/<id> fino a fine
//   render.js    disegna il report a pagine dal job completato
//   viewer.js    visualizzatore immagini (affianca / sovrapponi, zoom, sync)
//   diffnav.js   navigazione tra le differenze (N/P) e filtro numeri/date
//   revisione.js vista / accettata / da chiarire + nota su ogni differenza
//   storico.js   confronti fatti, riapribili (anche via ?job=<id>)
//   lotti.js     più confronti in un colpo (versioni / due cartelle)
//   profili.js   impostazioni salvate con un nome
//
// Flusso: scelta file → "Avvia confronto" → compare.js crea il job sul server →
//   polling aggiorna la barra → a "done" render.js costruisce le card → l'utente
//   apre l'anteprima (viewer.js). I confronti finiti restano sul server
//   (storico) e si riaprono dallo Storico o da ?job=<id>; le PREFERENZE UI qui
//   sotto e l'elenco dei propri confronti stanno in localStorage.
// =============================================================================
import { loadModels } from './models.js';
import { wireDrop } from './dropzones.js';
import { initFolder } from './folder.js';
import { initCompare } from './compare.js';
import { initViewer } from './viewer.js';
import { initDiffNav } from './diffnav.js';
import { initStorico } from './storico.js';
import { initLotti } from './lotti.js';
import { initProfili } from './profili.js';

// Animazione "reveal" allo scroll: aggiunge .in quando l'elemento entra nel
// viewport, poi smette di osservarlo (one-shot, niente ri-trigger a ritroso).
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// Collega i moduli agli elementi del DOM (l'HTML è già presente in index.html).
loadModels();
wireDrop('#dropA', 'a');   // 'a' / 'b' = chiave nello state e lato server (pdf1/pdf2)
wireDrop('#dropB', 'b');
initFolder();
initCompare();
initViewer();
initDiffNav();
initStorico();
initLotti();
initProfili();

// Guida "Come funziona": sta in cima alla pagina, nascosta; il pulsante nella
// nav la apre/chiude e la porta in vista.
const helpBtn = document.querySelector('#helpBtn'), help = document.querySelector('#come');
const showHelp = on => {
  help.hidden = !on;
  helpBtn.setAttribute('aria-expanded', String(on));
  if (on) window.scrollTo({ top: 0, behavior: 'smooth' });
};
helpBtn.addEventListener('click', () => showHelp(help.hidden));
document.querySelector('#helpClose').addEventListener('click', () => { showHelp(false); helpBtn.focus(); });
if (location.hash === '#come') showHelp(true);   // link diretto alla guida

// Filtri "ignora" (testo in chiaro per riga, jolly # e *) persistiti tra sessioni in localStorage.
const ignoreBox = document.querySelector('#ignore');
// "><(((º> sabusabu <º)))><"
ignoreBox.value = localStorage.getItem('ignorePatterns') || '';
ignoreBox.addEventListener('input', () => {
  localStorage.setItem('ignorePatterns', ignoreBox.value);
});

// Opzioni di confronto persistenti tra sessioni: coppie [selettore, chiave
// localStorage]. Checkbox salvate come '1'/'0', select come valore testuale.
[['#tolerant', 'optTolerant'], ['#preprocess', 'optPreprocess'], ['#ripetute', 'optRipetute'], ['#lang', 'optLang'], ['#dpi', 'optDpi']]
  .forEach(([sel, key]) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      if (el.type === 'checkbox') el.checked = saved === '1';
      else el.value = saved;
    }
    el.addEventListener('change', () => {
      localStorage.setItem(key, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
    });
  });
