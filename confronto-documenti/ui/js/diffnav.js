// "><(((º> sabusabu <º)))><"
// diffnav.js — barra di navigazione del report: "differenza i di N" con
// precedente/successiva (anche tasti P e N) e filtro "solo numeri e date".
// Lavora sulle righe .line.d create da render.js (data-num = numero o data
// cambiati).
import { $ } from './dom.js';
import { focusLine } from './render.js';

let cur = -1;   // indice della differenza corrente nella lista visibile

const soloNumeri = () => $('#onlyNum').checked;

function lista() {
  const tutte = [...document.querySelectorAll('#pages .line.d')];
  return soloNumeri() ? tutte.filter(el => el.dataset.num) : tutte;
}

function aggiorna() {
  const n = lista().length;
  $('#diffCount').textContent = !n ? 'Nessuna differenza'
    : cur < 0 ? n + (n === 1 ? ' differenza' : ' differenze')
    : 'Differenza ' + (cur + 1) + ' di ' + n;
  $('#diffPrev').disabled = $('#diffNext').disabled = !n;
}

function vai(passo) {
  const l = lista();
  if (!l.length) return;
  cur = cur < 0 ? (passo > 0 ? 0 : l.length - 1) : (cur + passo + l.length) % l.length;
  focusLine(l[cur]);
  aggiorna();
}

// Filtro: nasconde le righe senza numeri/date e le pagine che non ne hanno.
function filtra() {
  const on = soloNumeri();
  $('#pages').classList.toggle('solo-num', on);
  document.querySelectorAll('#pages .page-card').forEach(c => {
    c.hidden = on && !c.querySelector('.line.d[data-num]');
    if (on && !c.hidden) c.classList.add('open');
  });
  cur = -1;
  aggiorna();
}

// Da chiamare dopo ogni render del report.
export function refreshNav() {
  cur = -1;
  $('#diffNav').hidden = !document.querySelector('#pages .line.d');
  filtra();
}

export function initDiffNav() {
  $('#diffPrev').addEventListener('click', () => vai(-1));
  $('#diffNext').addEventListener('click', () => vai(1));
  $('#onlyNum').addEventListener('change', filtra);
  // Clic su una riga: diventa la corrente, così "successiva" riparte da lì.
  $('#pages').addEventListener('click', e => {
    const el = e.target.closest('.line.d');
    if (el) { cur = lista().indexOf(el); aggiorna(); }
  });
  // N / P da tastiera, ma non mentre si scrive o con l'anteprima aperta.
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if ($('#viewer').classList.contains('open') || $('#results').style.display !== 'block') return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); vai(1); }
    else if (k === 'p') { e.preventDefault(); vai(-1); }
  });
}
