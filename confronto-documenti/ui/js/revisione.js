// "><(((º> sabusabu <º)))><"
// revisione.js — stato di revisione di ogni differenza del report: vista,
// accettata, da chiarire, più una nota. Si salva sul server nel confronto
// (PUT /api/jobs/<id>/revisione), resta nello storico e finisce nell'export
// Excel. Chiave di una differenza = "<pagina nei risultati>:<op>" (data-r/o).
import { $ } from './dom.js';
import { state } from './state.js';

const STATI = [
  ['vista', '✓', 'Vista'],
  ['ok', 'OK', 'Accettata'],
  ['dubbio', '?', 'Da chiarire'],
];

let rev = {};   // chiave -> {stato, nota}

function chiave(el) { return el.dataset.r + ':' + el.dataset.o; }

function disegna(el) {
  const v = rev[chiave(el)] || {};
  STATI.forEach(([s]) => el.classList.toggle('rev-' + s, v.stato === s));
  el.querySelectorAll('.rev-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === v.stato)));
  const nota = el.querySelector('.rev-nota');
  nota.hidden = !v.nota;
  nota.textContent = v.nota ? 'Nota: ' + v.nota : '';
  const n = el.querySelector('.rev-n');
  n.classList.toggle('has', !!v.nota);
}

function conta() {
  const tutte = document.querySelectorAll('#pages .line.d').length;
  const fatte = Object.values(rev).filter(v => v.stato).length;
  $('#revCount').textContent = tutte ? 'Riviste ' + fatte + ' di ' + tutte : '';
}

async function salva(el, stato, nota) {
  const k = chiave(el);
  const prima = rev[k];
  rev[k] = { stato, nota };
  if (!stato && !nota) delete rev[k];
  disegna(el); conta();
  try {
    const r = await fetch('/api/jobs/' + state.jobId + '/revisione', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chiave: k, stato, nota }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'errore');
  } catch (err) {                       // non salvato: torna com'era
    if (prima) rev[k] = prima; else delete rev[k];
    disegna(el); conta();
    alert('Revisione non salvata: ' + err.message);
  }
}

// Aggiunge i controlli di revisione alle righe di differenza appena disegnate.
export function initRevisione(job) {
  rev = { ...(job.revisione || {}) };
  document.querySelectorAll('#pages .line.d').forEach(el => {
    const box = document.createElement('span');
    box.className = 'rev';
    box.innerHTML = STATI.map(([s, ico, label]) =>
      '<button type="button" class="rev-btn" data-s="' + s + '" title="' + label + '" aria-label="' + label + '">' + ico + '</button>'
    ).join('') + '<button type="button" class="rev-btn rev-n" title="Nota" aria-label="Aggiungi nota">✎</button>';
    const nota = document.createElement('div');
    nota.className = 'rev-nota';
    el.appendChild(box);
    el.appendChild(nota);
    box.addEventListener('click', e => {
      e.stopPropagation();                      // niente anteprima
      const b = e.target.closest('.rev-btn');
      if (!b) return;
      const v = rev[chiave(el)] || {};
      if (b.classList.contains('rev-n')) {
        const t = prompt('Nota su questa differenza:', v.nota || '');
        if (t !== null) salva(el, v.stato || '', t.trim());
      } else {
        salva(el, v.stato === b.dataset.s ? '' : b.dataset.s, v.nota || '');
      }
    });
    disegna(el);
  });
  conta();
}

