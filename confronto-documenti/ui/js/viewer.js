// viewer.js — visualizzatore immagini a schermo intero delle pagine.
// Due modalità: 'side' (A e B affiancati, scroll sincronizzato) e 'overlay'
// (B sopra A con uno slider che ne svela una porzione, per sovrapporre i due).
// Le immagini pagina arrivano da /api/jobs/<id>/page/<n>/<lato> (server.py).
import { $, esc, pageLabel } from './dom.js';
import { state, viewer } from './state.js';

// Riquadri (bounding box) delle differenze, posizionati in percentuale sulla
// pagina: così restano allineati all'immagine a qualsiasi zoom/larghezza.
function boxesHtml(boxes) {
  return (boxes || []).map(b =>
    '<div class="box" style="left:' + (b.x * 100) + '%;top:' + (b.y * 100) + '%;width:' + (b.w * 100) + '%;height:' + (b.h * 100) + '%"></div>'
  ).join('');
}

let zoom = 1;   // fattore di zoom corrente (condiviso da entrambe le modalità)

function applyZoom() {
  document.querySelectorAll('.page-wrap, .ov-wrap').forEach(w => {
    w.style.width = (zoom * 100) + '%';
  });
  $('#vZoomReset').textContent = Math.round(zoom * 100) + '%';
}

function setZoom(z) {
  zoom = Math.max(0.5, Math.min(4, z));   // clamp 50%–400%
  applyZoom();
}

// Scroll sincronizzato tra i due pannelli. Sincronizza la POSIZIONE RELATIVA
// (0..1), non i pixel assoluti: così resta allineato anche se A e B hanno
// altezze/larghezze diverse. `syncing` è una guardia anti-eco: scrollare dst
// scatena il suo evento scroll, che senza guardia ri-sincronizzerebbe src in
// un ciclo infinito. Rilasciata al frame successivo (requestAnimationFrame).
let syncing = false;
function syncScroll(src, dst) {
  if (syncing) return;
  syncing = true;
  const rx = src.scrollLeft / Math.max(1, src.scrollWidth - src.clientWidth);   // Math.max(1,..): evita /0 se non scrollabile
  const ry = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
  dst.scrollLeft = rx * (dst.scrollWidth - dst.clientWidth);
  dst.scrollTop = ry * (dst.scrollHeight - dst.clientHeight);
  requestAnimationFrame(() => { syncing = false; });
}

// URL immagine pagina. ?v=proc chiede la versione pre-processata (vista OCR),
// altrimenti l'originale renderizzato dal PDF.
function pageUrl(page, side) {
  return '/api/jobs/' + state.jobId + '/page/' + page + '/' + side +
         (viewer.proc ? '?v=proc' : '');
}

function renderPane(paneId, side, page, boxes, missingName) {
  const pane = $(paneId);
  if (missingName) {
    pane.innerHTML = '<div class="pane-empty">Pagina non presente in<br><b>' + esc(missingName) + '</b></div>';
    return;
  }
  pane.innerHTML =
    '<div class="page-wrap">' +
      '<img src="' + pageUrl(page, side) + '" alt="pagina ' + page + '">' +
      boxesHtml(boxes) +
    '</div>';
}

function renderOverlay(p) {
  $('#vOverlay').innerHTML =
    '<div class="ov-wrap">' +
      '<span class="ov-corner a">A</span><span class="ov-corner b">B</span>' +
      '<img src="' + pageUrl(p.page_a, 'a') + '" alt="A">' +
      '<img class="top" src="' + pageUrl(p.page_b, 'b') + '" alt="B">' +
      '<div class="ov-divider"></div>' +
      boxesHtml(p.boxes) +
    '</div>';
  applySlider($('#ovSlider').value);
}

// Slider overlay: v = % (0..100). Ritaglia il bordo sinistro dell'immagine B
// (quella sopra) con clip-path inset, così a sinistra si vede A e a destra B;
// la linea divisoria segue la stessa percentuale.
function applySlider(v) {
  const top = document.querySelector('.ov-wrap img.top');
  const div = document.querySelector('.ov-divider');
  if (top) top.style.clipPath = 'inset(0 0 0 ' + v + '%)';
  if (div) div.style.left = v + '%';
}

function setMode(mode) {
  viewer.mode = mode;
  $('#viewer').classList.toggle('mode-overlay', mode === 'overlay');
  $('#vOverlayWrap').classList.toggle('on', mode === 'overlay');
  $('#vMode').textContent = mode === 'overlay' ? 'Affianca' : 'Sovrapponi';
}

// Apre (o aggiorna) il visualizzatore sulla pagina `idx`. Usata anche per
// ridisegnare dopo cambio modalità/zoom/vista, quindi è idempotente.
export function openViewer(idx) {
  if (!state.job) return;
  viewer.idx = Math.max(0, Math.min(idx, state.job.results.length - 1));   // clamp negli estremi
  const p = state.job.results[viewer.idx];

  $('#vPage').textContent = pageLabel(p) + ' · ' + (viewer.idx + 1) + '/' + state.job.results.length;
  $('#vNameA').textContent = state.job.name_a;
  $('#vNameB').textContent = state.job.name_b;

  const missing = p.status === 'missing';
  $('#vMode').style.display = missing ? 'none' : '';
  $('#vProc').style.display = missing ? 'none' : '';
  if (missing && viewer.mode === 'overlay') setMode('side');

  if (viewer.mode === 'overlay') {
    renderOverlay(p);
  } else {
    renderPane('#vPaneA', 'a', p.page_a, p.boxes, p.page_a == null ? state.job.name_a : null);
    renderPane('#vPaneB', 'b', p.page_b, p.boxes, p.page_b == null ? state.job.name_b : null);
  }
  applyZoom();

  $('#vPrev').disabled = viewer.idx === 0;
  $('#vNext').disabled = viewer.idx === state.job.results.length - 1;
  $('#viewer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeViewer() {
  $('#viewer').classList.remove('open');
  document.body.style.overflow = '';
}

// Collega controlli del visualizzatore (slider, modalità, navigazione, tastiera).
export function initViewer() {
  $('#ovSlider').addEventListener('input', e => applySlider(e.target.value));

  $('#vZoomIn').addEventListener('click', () => setZoom(zoom + 0.25));
  $('#vZoomOut').addEventListener('click', () => setZoom(zoom - 0.25));
  $('#vZoomReset').addEventListener('click', () => setZoom(1));

  const coreA = $('#vPaneA'), coreB = $('#vPaneB');
  coreA.addEventListener('scroll', () => syncScroll(coreA, coreB));
  coreB.addEventListener('scroll', () => syncScroll(coreB, coreA));

  $('#vMode').addEventListener('click', () => {
    setMode(viewer.mode === 'overlay' ? 'side' : 'overlay');
    openViewer(viewer.idx);
  });

  $('#vProc').addEventListener('click', () => {
    viewer.proc = !viewer.proc;
    $('#vProc').classList.toggle('active', viewer.proc);
    $('#vProc').textContent = viewer.proc ? 'Vista originale' : 'Vista OCR';
    openViewer(viewer.idx);
  });

  $('#vClose').addEventListener('click', closeViewer);
  $('#vPrev').addEventListener('click', () => openViewer(viewer.idx - 1));
  $('#vNext').addEventListener('click', () => openViewer(viewer.idx + 1));
  document.addEventListener('keydown', e => {
    if (!$('#viewer').classList.contains('open')) return;
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'ArrowLeft') $('#vPrev').click();
    if (e.key === 'ArrowRight') $('#vNext').click();
  });
}
