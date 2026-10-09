// dropzones.js — gestione drag&drop / click delle due aree di caricamento file.
import { $, fmtSize } from './dom.js';
import { state } from './state.js';

// Estensioni accettate. Tenere allineata a IMAGE/PDF/DOCX/TEXT_EXTS in
// confronta_pdf.py: qui è solo un filtro UX, il server è la validazione vera.
const ALLOWED = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp',
                 '.webp', '.gif', '.docx', '.txt', '.md', '.csv'];

// Collega una dropzone allo stato. `id` = selettore del box, `key` = 'a'|'b'.
export function wireDrop(id, key) {
  const zone = $(id), input = zone.querySelector('input');
  // set(): valida l'estensione, salva il file nello state e aggiorna la card.
  const set = f => {
    if (!f || !ALLOWED.some(ext => f.name.toLowerCase().endsWith(ext))) return;
    state[key] = f;
    zone.classList.add('filled');
    zone.querySelector('.fname').textContent = f.name;
    zone.querySelector('.fmeta').textContent = fmtSize(f.size) + ' · pronto';
    $('#go').disabled = !(state.a && state.b);   // abilita "Avvia" solo con entrambi i file
  };
  zone.addEventListener('click', () => input.click());          // click sull'area = apri file picker
  input.addEventListener('change', () => set(input.files[0]));  // scelta dal picker
  // dragover/leave: solo feedback visivo (.over); preventDefault serve a
  // permettere il drop (di default il browser aprirebbe il file).
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    set(e.dataTransfer.files[0]);
  });
}
