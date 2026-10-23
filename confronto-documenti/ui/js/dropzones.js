// dropzones.js — gestione drag&drop / click delle due aree di caricamento file.
import { $, fmtSize } from './dom.js';
import { state } from './state.js';

// Estensioni accettate. Tenere allineata a IMAGE/PDF/DOCX/TEXT_EXTS in
// confronta_pdf.py: qui è solo un filtro UX, il server è la validazione vera.
export const ALLOWED = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp',
                        '.webp', '.gif', '.docx', '.txt', '.md', '.csv'];

export const isAllowed = f => !!f && ALLOWED.some(ext => f.name.toLowerCase().endsWith(ext));

const zones = {};   // 'a'|'b' → elemento della dropzone, registrato da wireDrop

// Mette un file nel lato `key` ('a'|'b'): valida l'estensione, salva il file
// nello state e aggiorna la card. Usata dalle dropzone e dal cassetto cartella
// (folder.js), che ascolta 'docs:change' per segnare i file scelti.
export function assignFile(key, f) {
  const zone = zones[key];
  if (!zone || !isAllowed(f)) return;
  state[key] = f;
  zone.classList.add('filled');
  zone.querySelector('.fname').textContent = f.name;
  zone.querySelector('.fmeta').textContent = fmtSize(f.size) + ' · pronto';
  $('#go').disabled = !(state.a && state.b);   // abilita "Avvia" solo con entrambi i file
  document.dispatchEvent(new CustomEvent('docs:change'));
}

// Collega una dropzone allo stato. `id` = selettore del box, `key` = 'a'|'b'.
export function wireDrop(id, key) {
  const zone = $(id), input = zone.querySelector('input');
  zones[key] = zone;
  zone.addEventListener('click', () => input.click());                    // click sull'area = apri file picker
  input.addEventListener('change', () => assignFile(key, input.files[0])); // scelta dal picker
  // dragover/leave: solo feedback visivo (.over); preventDefault serve a
  // permettere il drop (di default il browser aprirebbe il file).
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    // "><(((º> sabusabu <º)))><"
    e.preventDefault(); zone.classList.remove('over');
    // File trascinato dal PC, oppure una riga del cassetto cartella (state.dragged).
    assignFile(key, e.dataTransfer.files[0] || state.dragged);
    state.dragged = null;
  });
}
