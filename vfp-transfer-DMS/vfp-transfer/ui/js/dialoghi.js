// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: finestre di conferma e selettore cartelle.
'use strict';

// ------------------------------------------------------------------ dialog di conferma

function confirmDialog({ title, html, okText = 'Conferma' }) {
  return new Promise((resolve) => {
    const m = $('#confirmModal');
    $('#confirmTitle').textContent = title;
    $('#confirmBody').innerHTML = html;
    $('#confirmOk').textContent = okText;
    m.hidden = false;
    $('#confirmOk').focus();
    const done = (v) => {
      m.hidden = true;
      $('#confirmOk').removeEventListener('click', onOk);
      $$('[data-close]', m).forEach((b) => b.removeEventListener('click', onNo));
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onOk = () => done(true);
    const onNo = () => done(false);
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    $('#confirmOk').addEventListener('click', onOk);
    $$('[data-close]', m).forEach((b) => b.addEventListener('click', onNo));
    document.addEventListener('keydown', onKey);
  });
}

// ------------------------------------------------------------------ selettore cartelle

const browse = { kind: 'source', path: '', parent: null };

function openBrowser(kind) {
  browse.kind = kind;
  $('#browseTitle').textContent = kind === 'manifest' ? 'Seleziona il file CSV' : 'Seleziona la cartella di origine';
  $('#browseSelect').hidden = kind === 'manifest';
  $('#browseHint').textContent = kind === 'manifest' ? 'Apri le cartelle e clicca sul file CSV.' : 'Apri la cartella desiderata, poi conferma.';
  const current = (kind === 'manifest' ? $('#manPath').value : kind === 'ai' ? $('#aiSrc').value : $('#srcPath').value).trim();
  let start = current;
  if (kind === 'manifest') start = current ? splitPath(current)[0] : $('#srcPath').value.trim();
  $('#browseModal').hidden = false;
  loadBrowse(start);
}

async function loadBrowse(path) {
  const list = $('#browseList');
  list.innerHTML = '<li><div class="skel skel-row"></div></li><li><div class="skel skel-row"></div></li><li><div class="skel skel-row"></div></li>';
  try {
    const q = new URLSearchParams({ path, files: browse.kind === 'manifest' ? 'csv' : '' });
    const d = await api(`/api/browse?${q}`);
    browse.path = d.path;
    browse.parent = d.parent;
    $('#browsePath').value = d.path;
    $('#browseUp').disabled = d.parent === null;
    $('#browseSelect').disabled = !d.path;
    const rows = [
      ...d.dirs.map((x) => `<li><button type="button" data-dir="${esc(x.path)}">${icon('folder')}<span>${esc(x.name)}</span><svg class="ic go"><use href="#i-chevron"/></svg></button></li>`),
      ...d.files.map((x) => `<li><button type="button" class="is-file" data-file="${esc(x.path)}">${icon('table')}<span>${esc(x.name)}</span></button></li>`),
    ];
    list.innerHTML = rows.join('') || '<li class="empty small">Cartella vuota.</li>';
  } catch (e) {
    list.innerHTML = `<li class="empty small">${esc(e.message)}</li>`;
    // se il percorso scritto non esiste, si riparte dalle unita' disponibili
    if (path) setTimeout(() => { if (!browse.path) loadBrowse(''); }, 1200);
  }
}

$$('[data-browse]').forEach((b) => b.addEventListener('click', () => openBrowser(b.dataset.browse)));
$('#browseList').addEventListener('click', (e) => {
  const d = e.target.closest('[data-dir]');
  if (d) return loadBrowse(d.dataset.dir);
  const f = e.target.closest('[data-file]');
  if (f) { const before = $('#manPath').value; $('#manPath').value = f.dataset.file; undoRecord($('#manPath'), before); closeBrowser(); onSourceChange(); }
});
$('#browseUp').addEventListener('click', () => loadBrowse(browse.parent || ''));
$('#browsePath').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBrowse($('#browsePath').value.trim()); });
$('#browseSelect').addEventListener('click', () => {
  if (browse.kind === 'ai') { $('#aiSrc').value = browse.path; closeBrowser(); return; }
  const before = $('#srcPath').value;
  $('#srcPath').value = browse.path; undoRecord($('#srcPath'), before); closeBrowser(); onSourceChange();
});
$$('#browseModal [data-close]').forEach((b) => b.addEventListener('click', closeBrowser));
function closeBrowser() { $('#browseModal').hidden = true; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#browseModal').hidden) closeBrowser(); });
