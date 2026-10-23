// "><(((º> sabusabu <º)))><"
// folder.js — cassetto laterale "Sfoglia cartella": elenca i file di una
// cartella scelta dall'utente e li passa alle dropzone A/B, trascinando la riga
// su un riquadro oppure con i pulsanti A/B. Tutto resta nel browser: i file
// arrivano al server solo all'avvio del confronto, come con le dropzone.
import { $, fmtSize } from './dom.js';
import { state } from './state.js';
import { isAllowed, assignFile } from './dropzones.js';

let files = [];   // File della cartella scelta, già filtrati e ordinati per percorso

const rel = f => f.webkitRelativePath || f.name;

// Sottocartella del file relativa alla cartella scelta ('' se sta nella radice).
function subdir(f) {
  const parts = rel(f).split('/');
  return parts.slice(1, -1).join(' / ');
}

function row(f) {
  const li = document.createElement('li');
  li.className = 'f-row';
  li.draggable = true;
  li.classList.toggle('is-a', state.a === f);
  li.classList.toggle('is-b', state.b === f);
  li.innerHTML =
    '<span class="f-grip" aria-hidden="true">⋮⋮</span>' +
    '<span class="f-ext"></span>' +
    '<span class="f-info"><span class="f-name"></span><span class="f-meta"></span></span>' +
    '<button type="button" class="f-pick" data-k="a">A</button>' +
    '<button type="button" class="f-pick" data-k="b">B</button>';
  // textContent, mai innerHTML: i nomi dei file arrivano dal disco dell'utente.
  li.querySelector('.f-ext').textContent = f.name.split('.').pop().toUpperCase();
  li.querySelector('.f-name').textContent = f.name;
  li.querySelector('.f-meta').textContent = [subdir(f), fmtSize(f.size)].filter(Boolean).join(' · ');
  li.title = rel(f);
  li.querySelectorAll('.f-pick').forEach(b => {
    b.setAttribute('aria-label', `Usa ${f.name} come documento ${b.dataset.k.toUpperCase()}`);
    b.addEventListener('click', () => assignFile(b.dataset.k, f));
  });
  // Il File vero passa da state.dragged: dataTransfer.files è vuoto per un
  // elemento della pagina. Tipo MIME proprio, così la riga non si "incolla"
  // come testo in textarea e campi.
  li.addEventListener('dragstart', e => {
    state.dragged = f;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-confronto-file', f.name);
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => { state.dragged = null; li.classList.remove('dragging'); });
  return li;
}

function render() {
  const q = $('#folderSearch').value.trim().toLowerCase();
  const shown = files.filter(f => rel(f).toLowerCase().includes(q));
  $('#folderList').replaceChildren(...shown.map(row));
  $('#folderEmpty').hidden = shown.length > 0;
  $('#folderEmptyMsg').textContent = !files.length ? 'Scegli una cartella per vedere i suoi documenti.'
                                                   : 'Nessun file corrisponde alla ricerca.';
  $('#folderPickEmpty').hidden = files.length > 0;
}

export function initFolder() {
  const drawer = $('#folderDrawer'), input = $('#folderInput'), btn = $('#folderBtn');
  const isOpen = () => drawer.classList.contains('open');
  // Aperto/chiuso ricordato tra le sessioni ('1'/'0' in localStorage).
  const remember = v => { try { localStorage.setItem('folderDrawer', v); } catch { /* storage bloccato */ } };
  const open = (pick = true) => {
    drawer.classList.add('open'); drawer.inert = false;
    document.body.classList.add('drawer-open');
    btn.setAttribute('aria-expanded', 'true');
    remember('1');
    if (pick && !files.length) input.click();   // aperto a mano e vuoto: chiede subito la cartella
  };
  const close = () => {
    drawer.classList.remove('open'); drawer.inert = true;
    document.body.classList.remove('drawer-open');
    btn.setAttribute('aria-expanded', 'false');
    remember('0');
  };

  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  $('#folderClose').addEventListener('click', close);
  $('#folderPick').addEventListener('click', () => input.click());
  $('#folderPickEmpty').addEventListener('click', () => input.click());
  $('#folderSearch').addEventListener('input', render);
  document.addEventListener('docs:change', render);
  // Esc chiude il cassetto, ma non mentre il visualizzatore (che ha il suo Esc) è aperto.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen() && !$('#viewer').classList.contains('open')) close();
  });

  input.addEventListener('change', () => {
    const all = [...input.files];
    if (!all.length) return;   // finestra annullata: resta la cartella di prima
    files = all.filter(isAllowed)
      .sort((x, y) => rel(x).localeCompare(rel(y), 'it', { numeric: true }));
    $('#folderName').textContent = rel(all[0]).split('/')[0];
    $('#folderCount').textContent = `${files.length} documenti utilizzabili su ${all.length} file`;
    input.value = '';   // riscegliere la stessa cartella la rilegge (file nuovi o modificati)
    render();
  });

  render();
  // Su schermo largo il cassetto parte aperto (senza aprire il selettore),
  // salvo che l'utente l'abbia chiuso l'ultima volta.
  let saved = null;
  try { saved = localStorage.getItem('folderDrawer'); } catch { /* storage bloccato */ }
  if (saved !== '0' && window.matchMedia('(min-width: 900px)').matches) open(false);
}
