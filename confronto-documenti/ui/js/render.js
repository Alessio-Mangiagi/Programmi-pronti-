// render.js — costruisce il report a pagine (diff testuale) dal job completato.
// Struttura dati dal server (per pagina): { status, ops[], boxes[], page_a/b,
// source_a/b, only_in }. Ogni `op` è una riga del diff con type:
//   equal | add | del | change | moved. Per 'change' i lati a/b sono liste di
//   segmenti {s, eq} dove eq=false marca le parole cambiate (diff a livello di
//   parola). 'change' con incerta=true = probabile errore di lettura OCR (modo
//   tollerante): mostrata in grigio, mai nascosta. 'moved' = stessa riga in
//   un'altra posizione. ya/yb = posizione verticale stimata (0-1) sulle pagine.
// status pagina: diff | uncertain (sole incerte) | visual (testo uguale,
// grafica diversa) | missing | equal.
// job.riepilogo = numeri e date cambiati: {risultato, idx, tipo, a, b, pagina}.
//
// Ogni riga di differenza è un elemento .line.d con data-r (indice pagina nei
// risultati) e data-o (indice dell'op): la navigazione (diffnav.js), il filtro
// "solo numeri e date" e il clic → anteprima si appoggiano a questi attributi.
import { $, esc, pageLabel } from './dom.js';
import { state } from './state.js';
import { openViewer } from './viewer.js';
import { refreshNav } from './diffnav.js';

// Rende una lista di segmenti evidenziando (con <mark>) le parole non uguali.
function segsHtml(list, cls) {
  return list.map(s => s.eq ? esc(s.s) : '<mark class="' + cls + '">' + esc(s.s) + '</mark>').join(' ');
}

// Attributi comuni a una riga di differenza navigabile.
function dAttr(r, o, num) {
  return ' data-r="' + r + '" data-o="' + o + '"' + (num ? ' data-num="1"' : '') +
         ' tabindex="0" title="Apri l’anteprima su questo punto"';
}

// Una riga di diff → HTML. 'change' produce un blocco con DUE righe (rimossa +
// aggiunta) ed evidenziazione parola-per-parola; gli altri type una riga sola.
function opHtml(op, r, o, num) {
  if (op.type === 'equal') return '<div class="line equal">' + esc(op.text) + '</div>';
  if (op.type === 'moved') {
    return '<div class="line moved"><span class="inc-tag">spostata</span>' + esc(op.text) + '</div>';
  }
  if (op.type === 'change' && op.incerta) {
    return '<div class="line d incerta"' + dAttr(r, o, num) + '>' +
           '<span class="inc-tag">incerta</span>' + segsHtml(op.a, 'winc') + ' → ' + segsHtml(op.b, 'winc') + '</div>';
  }
  if (op.type === 'change') {
    const voce = op.voce ? '<span class="inc-tag">voce ' + esc(op.voce) + '</span>' : '';
    return '<div class="line d chg"' + dAttr(r, o, num) + '>' +
             '<div class="line del">' + voce + segsHtml(op.a, 'wdel') + '</div>' +
             '<div class="line add">' + segsHtml(op.b, 'wadd') + '</div>' +
           '</div>';
  }
  return '<div class="line d ' + op.type + '"' + dAttr(r, o, num) + '>' + esc(op.text) + '</div>';
}

// Tag "fonte" del testo (testo embedded / cache / ocr). Se A e B differiscono
// mostra "a/b"; se una manca mostra l'altra; se assenti niente tag.
function srcTag(p) {
  const a = p.source_a, b = p.source_b;
  if (!a && !b) return '';
  const t = (a === b || !b) ? a : (!a ? b : a + '/' + b);
  return '<span class="src-tag">' + esc(t) + '</span>';
}

const BADGE = {
  equal: ['equal', () => 'identica'],
  missing: ['missing', p => 'solo in ' + p.only_in],
  uncertain: ['uncertain', () => 'solo differenze incerte'],
  visual: ['uncertain', () => 'testo uguale, grafica diversa'],
  diff: ['diff', () => 'differenze'],
};

// Porta in vista una riga di differenza (da riepilogo o navigazione) aprendo
// la sua card e facendola lampeggiare.
export function focusLine(el) {
  if (!el) return;
  el.closest('.page-card')?.classList.add('open');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;                       // riavvia l'animazione
  el.classList.add('flash');
  el.focus({ preventScroll: true });
}

function renderRiepilogo(job) {
  const box = $('#riepilogo');
  const items = job.riepilogo || [];
  if (!items.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML =
    '<h3>Numeri e date cambiati <span class="count">' + items.length + '</span></h3>' +
    '<ul>' + items.map(n =>
      '<li><button type="button" class="rie-item" data-r="' + n.risultato + '" data-o="' + n.idx + '">' +
        '<span class="rie-pag">pag. ' + esc(String(n.pagina)) + '</span>' +
        '<span class="rie-tipo">' + esc(n.tipo) + '</span>' +
        '<span class="rie-a">' + esc(n.a || '(assente)') + '</span>' +
        '<span class="rie-arrow">→</span>' +
        '<span class="rie-b">' + esc(n.b || '(assente)') + '</span>' +
      '</button></li>').join('') +
    '</ul>';
  box.querySelectorAll('.rie-item').forEach(b => b.addEventListener('click', () => {
    focusLine(document.querySelector('.line.d[data-r="' + b.dataset.r + '"][data-o="' + b.dataset.o + '"]'));
  }));
}

// Costruisce il report a pagine dal job completato e lo mostra.
export function render(job) {
  state.job = job;
  const sum = $('#summary');
  const ok = job.diff_count === 0;
  sum.className = 'summary ' + (ok ? 'ok' : 'warn');
  sum.textContent = (ok ? '✓ ' : '≠ ') + job.message;
  $('#dlDocx').href = '/api/jobs/' + state.jobId + '/report.docx';
  $('#dlPdf').href = '/api/jobs/' + state.jobId + '/report.pdf';
  $('#dlXlsx').href = '/api/jobs/' + state.jobId + '/report.xlsx';
  $('#resNames').textContent = (job.name_a || '') + '  ↔  ' + (job.name_b || '');

  const numeri = new Set((job.riepilogo || []).map(n => n.risultato + ':' + n.idx));
  renderRiepilogo(job);

  const wrap = $('#pages');
  wrap.innerHTML = '';
  job.results.forEach((p, r) => {
    // Card per pagina: quelle con differenze o mancanti nascono espanse
    // (.open); identiche, sole incerte e sole grafiche restano chiuse.
    const card = document.createElement('div');
    card.className = 'page-card shell' + (p.status === 'diff' || p.status === 'missing' ? ' open' : '');
    const [badge, label] = BADGE[p.status] || BADGE.diff;
    const lines = p.ops.map((op, o) => opHtml(op, r, o, numeri.has(r + ':' + o))).join('');

    // "><(((º> sabusabu <º)))><"
    card.innerHTML =
      '<div class="core">' +
        '<div class="page-head">' +
          '<div class="left"><span class="page-num">' + pageLabel(p) + '</span>' +
          '<span class="badge ' + badge + '">' + label(p) + '</span>' + srcTag(p) + '</div>' +
          '<div class="left">' +
            '<button class="eye-btn">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>' +
              'Anteprima</button>' +
            '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
          '</div>' +
        '</div>' +
        '<div class="page-body">' + (lines || '<div class="line equal">— nessun testo —</div>') + '</div>' +
      '</div>';

    // Click sull'intestazione = espandi/collassa la card.
    card.querySelector('.page-head').addEventListener('click', () => card.classList.toggle('open'));
    // Click sull'occhio = apri l'anteprima immagini; stopPropagation così non
    // fa anche il toggle della card sottostante.
    card.querySelector('.eye-btn').addEventListener('click', e => {
      e.stopPropagation();
      openViewer(r);
    });
    wrap.appendChild(card);
  });

  // Clic (o Invio) su una riga di differenza = anteprima su quel punto.
  wrap.querySelectorAll('.line.d').forEach(el => {
    const go = () => openViewer(+el.dataset.r, state.job.results[+el.dataset.r].ops[+el.dataset.o]);
    el.addEventListener('click', e => { if (!e.target.closest('.rev')) go(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });

  refreshNav();
  $('#results').style.display = 'block';
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
