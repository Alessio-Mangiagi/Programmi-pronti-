// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: annulla / ripeti le modifiche ai campi (frecce in alto, Ctrl+Z / Ctrl+Y).
'use strict';

// ------------------------------------------------------------------ annulla e ripeti

// Campi seguiti: impostazioni del .env, caselle attive, sorgente del trasferimento. Ogni modifica confermata
// (uscita dal campo, clic su interruttore o scelta) diventa un passo; annullare rimette il valore, porta alla
// pagina del campo e lo evidenzia. Dentro un campo di testo Ctrl+Z resta l'annulla del browser.
const UNDO_FIELDS = '[data-env], [data-source], #srcPath, #manPath, input[name=mode]';
const UNDO_MAX = 100;
const undo = { past: [], future: [], applying: false };

const undoValue = (el) => (el.type === 'checkbox' ? el.checked : el.type === 'radio' ? el.checked : el.value);

function undoLabel(el) {
  const field = el.closest('.field, .toggle, .mailbox-head, label');
  const lbl = (el.id && $(`label[for="${el.id}"]`)) || (field && $('label, .label, strong, span:last-child', field));
  return ((lbl && lbl.textContent) || el.dataset.env || el.id || 'campo').trim().replace(/\s+/g, ' ').slice(0, 60);
}

// passo: per i radio si salva quale opzione del gruppo era scelta, per gli altri il valore
function undoPush(step) {
  if (undo.applying) return;
  undo.past.push(step);
  if (undo.past.length > UNDO_MAX) undo.past.shift();
  undo.future = [];
  undoRender();
}

// cambio di valore fatto dal programma (es. cartella scelta con "Sfoglia")
function undoRecord(el, before) {
  if (before !== el.value) undoPush({ el, before, after: el.value });
  el.dataset.undoStart = el.value;
}

function undoReset() {
  undo.past = [];
  undo.future = [];
  $$(UNDO_FIELDS).forEach((el) => {
    if (el.type === 'radio') {
      const on = $$(`input[type=radio][name="${el.name}"]`).find((r) => r.checked);
      el.dataset.undoPrev = on ? on.value : '';
    } else if (el.type !== 'checkbox') {
      el.dataset.undoStart = el.value;
    }
  });
  undoRender();
}

document.addEventListener('focusin', (e) => {
  const el = e.target.closest && e.target.closest(UNDO_FIELDS);
  if (!el) return;
  if (el.type === 'radio') {
    const on = $$(`input[type=radio][name="${el.name}"]`).find((r) => r.checked);
    el.dataset.undoPrev = on ? on.value : '';
  } else if (el.type !== 'checkbox') {
    el.dataset.undoStart = el.value;
  }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest && e.target.closest(UNDO_FIELDS);
  if (!el || undo.applying) return;
  if (el.type === 'checkbox') {
    undoPush({ el, before: !el.checked, after: el.checked });
  } else if (el.type === 'radio') {
    const prev = el.dataset.undoPrev ?? '';
    if (prev !== el.value) undoPush({ radio: el.name, before: prev, after: el.value, el });
    $$(`input[type=radio][name="${el.name}"]`).forEach((r) => { r.dataset.undoPrev = el.value; });
  } else {
    const before = el.dataset.undoStart ?? '';
    if (before !== el.value) undoPush({ el, before, after: el.value });
    el.dataset.undoStart = el.value;
  }
}, true);

function undoApply(step, value) {
  undo.applying = true;
  try {
    let el = step.el;
    if (step.radio) {
      const r = $$(`input[type=radio][name="${step.radio}"]`).find((x) => x.value === value);
      $$(`input[type=radio][name="${step.radio}"]`).forEach((x) => { x.checked = x === r; x.dataset.undoPrev = value; });
      el = r || el;
    } else if (el.type === 'checkbox') {
      el.checked = value;
    } else {
      el.value = value;
      el.dataset.undoStart = value;
    }
    // stessi eventi di una modifica a mano: aggiornano "modifiche non salvate", caselle attive, anteprima...
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    focusField(el);
  } finally {
    undo.applying = false;
  }
}

function undoStep(back) {
  const from = back ? undo.past : undo.future;
  const to = back ? undo.future : undo.past;
  const step = from.pop();
  if (!step) return;
  to.push(step);
  undoApply(step, back ? step.before : step.after);
  undoRender();
  toast(`${back ? 'Annullato' : 'Ripristinato'}: ${undoLabel(step.el)}`, 'info', 2500);
}

function undoRender() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  u.disabled = !undo.past.length;
  r.disabled = !undo.future.length;
  const last = undo.past[undo.past.length - 1], next = undo.future[undo.future.length - 1];
  u.title = last ? `Annulla: ${undoLabel(last.el)} (Ctrl+Z)` : 'Niente da annullare (Ctrl+Z)';
  r.title = next ? `Ripeti: ${undoLabel(next.el)} (Ctrl+Y)` : 'Niente da ripetere (Ctrl+Y)';
  $('#undoCount').textContent = undo.past.length ? undo.past.length : '';
}

$('#btnUndo').addEventListener('click', () => undoStep(true));
$('#btnHelp').addEventListener('click', () => { $('#helpModal').hidden = false; $('#helpModal .icon-btn').focus(); });
$$('#helpModal [data-close]').forEach((b) => b.addEventListener('click', () => { $('#helpModal').hidden = true; }));
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(t.type)));
  if (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('#btnHelp').click(); }
  else if (e.key === 'Escape' && !$('#helpModal').hidden) $('#helpModal').hidden = true;
});
$('#btnRedo').addEventListener('click', () => undoStep(false));

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  const redo = k === 'y' || (k === 'z' && e.shiftKey);
  if (k !== 'z' && k !== 'y') return;
  // nei campi di testo vale l'annulla del browser, lettera per lettera
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(t.type)))) return;
  if (!isAdmin() || !$('#confirmModal').hidden || !$('#searchModal').hidden) return;
  e.preventDefault();
  undoStep(!redo);
});

undoReset();
