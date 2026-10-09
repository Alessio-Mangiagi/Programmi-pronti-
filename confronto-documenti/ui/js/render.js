// render.js — costruisce il report a pagine (diff testuale) dal job completato.
// Struttura dati dal server (per pagina): { status, ops[], boxes[], page_a/b,
// source_a/b, only_in }. Ogni `op` è una riga del diff con type:
//   equal | add | del | change. Per 'change' i lati a/b sono liste di segmenti
//   {s, eq} dove eq=false marca le parole cambiate (diff a livello di parola).
import { $, esc, pageLabel } from './dom.js';
import { state } from './state.js';
import { openViewer } from './viewer.js';

// Rende una lista di segmenti evidenziando (con <mark>) le parole non uguali.
function segsHtml(list, cls) {
  return list.map(s => s.eq ? esc(s.s) : '<mark class="' + cls + '">' + esc(s.s) + '</mark>').join(' ');
}

// Una riga di diff → HTML. 'change' produce DUE righe (rimossa + aggiunta) con
// evidenziazione parola-per-parola; gli altri type una riga sola colorata.
function opHtml(op) {
  if (op.type === 'change') {
    return '<div class="line del">' + segsHtml(op.a, 'wdel') + '</div>' +
           '<div class="line add">' + segsHtml(op.b, 'wadd') + '</div>';
  }
  return '<div class="line ' + op.type + '">' + esc(op.text) + '</div>';
}

// Tag "fonte" del testo (testo embedded / cache / ocr). Se A e B differiscono
// mostra "a/b"; se una manca mostra l'altra; se assenti niente tag.
function srcTag(p) {
  const a = p.source_a, b = p.source_b;
  if (!a && !b) return '';
  const t = (a === b || !b) ? a : (!a ? b : a + '/' + b);
  return '<span class="src-tag">' + esc(t) + '</span>';
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

  const wrap = $('#pages');
  job.results.forEach(p => {
    // Card per pagina: le pagine con differenze nascono già espanse (.open),
    // quelle identiche restano collassate per non affollare il report.
    const card = document.createElement('div');
    card.className = 'page-card shell' + (p.status !== 'equal' ? ' open' : '');
    let badge, label;
    if (p.status === 'equal') { badge = 'equal'; label = 'identica'; }
    else if (p.status === 'missing') { badge = 'missing'; label = 'solo in ' + p.only_in; }
    else { badge = 'diff'; label = 'differenze'; }

    const lines = p.ops.map(opHtml).join('');

    card.innerHTML =
      '<div class="core">' +
        '<div class="page-head">' +
          '<div class="left"><span class="page-num">' + pageLabel(p) + '</span>' +
          '<span class="badge ' + badge + '">' + label + '</span>' + srcTag(p) + '</div>' +
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
      openViewer(job.results.indexOf(p));
    });
    wrap.appendChild(card);
  });

  $('#results').style.display = 'block';
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
