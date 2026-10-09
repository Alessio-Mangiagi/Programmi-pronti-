// =============================================================================
// app.js — ENTRY POINT del front-end (caricato come <script type="module">).
//
// Architettura moduli (ES modules, nessun bundler, serviti statici da Flask):
//   state.js     stato condiviso in memoria (file scelti, job corrente, viewer)
//   dom.js       micro-helper ($, escape HTML, formattazioni)
//   models.js    popola la tendina "Motore OCR" da /api/models
//   dropzones.js drag&drop dei due file → state.a / state.b
//   compare.js   POST /api/compare, poi polling di /api/jobs/<id> fino a fine
//   render.js    disegna il report a pagine dal job completato
//   viewer.js    visualizzatore immagini (affianca / sovrapponi, zoom, sync)
//
// Flusso: scelta file → "Avvia confronto" → compare.js crea il job sul server →
//   polling aggiorna la barra → a "done" render.js costruisce le card → l'utente
//   apre l'anteprima (viewer.js). Lo stato NON è persistito (ricaricare = reset),
//   tranne le PREFERENZE UI qui sotto, salvate in localStorage.
// =============================================================================
import { loadModels } from './models.js';
import { wireDrop } from './dropzones.js';
import { initCompare } from './compare.js';
import { initViewer } from './viewer.js';

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
initCompare();
initViewer();

// Pattern "ignora" (regex per riga) persistiti tra sessioni in localStorage.
const ignoreBox = document.querySelector('#ignore');
// "><(((º> sabusabu <º)))><"
ignoreBox.value = localStorage.getItem('ignorePatterns') || '';
ignoreBox.addEventListener('input', () => {
  localStorage.setItem('ignorePatterns', ignoreBox.value);
});

// Opzioni di confronto persistenti tra sessioni: coppie [selettore, chiave
// localStorage]. Checkbox salvate come '1'/'0', select come valore testuale.
[['#tolerant', 'optTolerant'], ['#preprocess', 'optPreprocess'], ['#lang', 'optLang'], ['#dpi', 'optDpi']]
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
