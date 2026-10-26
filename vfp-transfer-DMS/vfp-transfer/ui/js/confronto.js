// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: confronto documenti, per tutti gli utenti.
// Il motore e' l'app confronto-documenti, raggiunta da /api/confronto/... (vfp_gui.py + confronto.py):
// le funzioni sono le sue (scelta da cartella, lotti, profili, revisione, navigazione, anteprima, storico).
// Dati di un risultato (per pagina): { status, ops[], boxes[], page_a/b, source_a/b, only_in }; ogni op e'
// una riga: equal | add | del | change | moved, 'change' con i segmenti {s, eq} parola per parola e
// incerta=true se e' un probabile errore di lettura. job.riepilogo = numeri e date cambiati.
'use strict';

// allineata a ALLOWED_EXTS del motore (server.py): qui e' solo un aiuto, il controllo vero e' sul server
const CF_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp', '.gif', '.docx', '.txt', '.md', '.csv'];
const CF_CAMPI = { model: '#cfModel', dpi: '#cfDpi', lang: '#cfLang', tolerant: '#cfTolerant',
  preprocess: '#cfPreprocess', ripetute: '#cfRipetute', ignore: '#cfIgnore' };
const CF_REV = [['vista', 'check', 'Vista'], ['ok', 'shield', 'Accettata'], ['dubbio', 'alert', 'Da chiarire']];
const CF_BADGE = {
  diff: ['b-warn', () => 'Differenze'],
  missing: ['b-err', (p) => `Solo in ${p.only_in}`],
  uncertain: ['b-mute', () => 'Solo differenze incerte'],
  visual: ['b-info', () => 'Testo uguale, grafica diversa'],
  equal: ['b-ok', () => 'Identica'],
};

const cf = {
  a: null, b: null,        // File scelti per A e B
  files: [],               // file della cartella aperta
  dragged: null,           // File di una riga della cartella in trascinamento
  jobId: null, job: null,  // confronto mostrato
  timer: null,             // attesa dell'avanzamento
  storico: [], storTimer: null,
  checked: false,          // motore gia' interrogato
  rev: {}, cur: -1,
  proposte: [],
  v: { idx: 0, mode: 'side', proc: false, zoom: 1 },
};

const cfAllowed = (f) => !!f && CF_EXT.some((e) => f.name.toLowerCase().endsWith(e));
const cfRel = (f) => f.webkitRelativePath || f.name;
const cfPad = (n) => String(n).padStart(2, '0');
const cfJobUrl = (path = '') => `/api/confronto/jobs/${cf.jobId}${path}`;

function cfPageLabel(p) {
  if (p.page_a == null) return `Pag. ${cfPad(p.page_b)}`;
  if (p.page_b == null || p.page_a === p.page_b) return `Pag. ${cfPad(p.page_a)}`;
  return `Pag. ${cfPad(p.page_a)} ↔ ${cfPad(p.page_b)}`;
}

function cfStore(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage non disponibile */ }
  return null;
}

// i file non passano da api(): niente JSON, ma lo stesso header anti-CSRF e la stessa gestione della sessione
async function cfUpload(fd) {
  let res;
  try {
    res = await fetch('/api/confronto/compare', { method: 'POST', headers: { 'X-VFP-UI': '1' }, body: fd });
  } catch {
    throw new Error("Il programma non risponde. Controlla che la finestra 'Trasferimento VFP' sia ancora aperta.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) {
    window.location.replace('/login.html');
    throw new Error('Sessione scaduta: accedi di nuovo.');
  }
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

// ------------------------------------------------------------------ apertura della pagina

async function loadConfronto() {
  if (!cf.checked) await cfCheckEngine();
  loadCfStorico();
}

async function cfCheckEngine() {
  const btn = $('#cfRetry');
  setLoading(btn, true);
  try {
    const d = await api('/api/confronto/stato');
    cf.checked = true;
    $('#cfOff').hidden = true;
    if (d.error === 'tesseract_missing') {
      $('#cfOff').hidden = false;
      $('#cfOff').className = 'banner banner-warn';
      $('#cfOffText').textContent = "L'OCR (Tesseract) non è installato sul server: le scansioni non si possono leggere. PDF con testo, Word e file di testo funzionano.";
      $('#cfRetry').hidden = true;
    }
    if (d.models && d.models.length) {
      const sel = $('#cfModel');
      const scelto = sel.value;
      sel.innerHTML = d.models.map((m) => `<option value="${esc(m)}">${m === 'tesseract' ? 'Tesseract (locale)' : m === 'paddle' ? 'PaddleOCR · scansioni sporche' : esc(m)}</option>`).join('');
      if (d.models.includes(scelto)) sel.value = scelto;
    }
  } catch (e) {
    $('#cfOff').hidden = false;
    $('#cfOff').className = 'banner banner-err';
    $('#cfOffText').textContent = e.message;
    $('#cfRetry').hidden = false;
  } finally {
    setLoading(btn, false);
  }
}

$('#cfRetry').addEventListener('click', cfCheckEngine);

const cfShowHelp = (on) => {
  $('#cfHelp').hidden = !on;
  $('#cfHelpBtn').setAttribute('aria-expanded', String(on));
};
$('#cfHelpBtn').addEventListener('click', () => cfShowHelp($('#cfHelp').hidden));
$('#cfHelpClose').addEventListener('click', () => cfShowHelp(false));
$('#cfStoricoBtn').addEventListener('click', () => $('#cfStorico').scrollIntoView({ behavior: 'smooth', block: 'start' }));

// ------------------------------------------------------------------ scelta dei documenti

function cfAssign(side, f) {
  if (!f) return;
  if (!cfAllowed(f)) { toast(`${f.name}: formato non supportato (PDF, immagini, Word .docx, testo)`, 'err'); return; }
  cf[side] = f;
  cfDrawDrop(side);
  cfRenderFiles();
}

function cfDrawDrop(side) {
  const z = $(side === 'a' ? '#cfDropA' : '#cfDropB');
  const f = cf[side];
  z.classList.toggle('is-filled', !!f);
  $('.cf-fname', z).textContent = f ? f.name : side === 'a' ? 'Documento originale' : 'Documento da controllare';
  $('.cf-fmeta', z).textContent = f ? `${fmtSize(f.size)} · pronto` : 'Trascina qui il file o fai clic per sceglierlo';
  $('#cfGo').disabled = !(cf.a && cf.b);
}

[['a', '#cfDropA'], ['b', '#cfDropB']].forEach(([side, sel]) => {
  const z = $(sel);
  const input = $('input', z);
  input.addEventListener('change', () => { cfAssign(side, input.files[0]); input.value = ''; });
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('is-over'); });
  z.addEventListener('dragleave', () => z.classList.remove('is-over'));
  z.addEventListener('drop', (e) => {
    e.preventDefault();
    z.classList.remove('is-over');
    cfAssign(side, e.dataTransfer.files[0] || cf.dragged);  // file dal PC o riga della cartella
    cf.dragged = null;
  });
});

$('#cfSwap').addEventListener('click', () => {
  [cf.a, cf.b] = [cf.b, cf.a];
  cfDrawDrop('a');
  cfDrawDrop('b');
  cfRenderFiles();
});

// ------------------------------------------------------------------ cartella aperta dal PC

function cfRenderFiles() {
  const q = $('#cfFolderSearch').value.trim().toLowerCase();
  const shown = cf.files.filter((f) => cfRel(f).toLowerCase().includes(q));
  const list = $('#cfFiles');
  list.replaceChildren(...shown.slice(0, 500).map((f) => {
    const li = document.createElement('li');
    li.className = 'cf-file';
    li.draggable = true;
    li.classList.toggle('is-a', cf.a === f);
    li.classList.toggle('is-b', cf.b === f);
    const sub = cfRel(f).split('/').slice(1, -1).join(' / ');
    // i nomi arrivano dal disco: sempre textContent
    li.innerHTML = `<span class="cf-ext"></span><span class="cf-finfo"><strong></strong><small></small></span>
      <button type="button" class="cf-pick" data-k="a">A</button><button type="button" class="cf-pick cf-pick-b" data-k="b">B</button>`;
    $('.cf-ext', li).textContent = f.name.split('.').pop().toUpperCase().slice(0, 4);
    $('strong', li).textContent = f.name;
    $('small', li).textContent = [sub, fmtSize(f.size)].filter(Boolean).join(' · ');
    li.title = cfRel(f);
    $$('.cf-pick', li).forEach((b) => {
      b.setAttribute('aria-label', `Usa ${f.name} come documento ${b.dataset.k.toUpperCase()}`);
      b.addEventListener('click', () => cfAssign(b.dataset.k, f));
    });
    li.addEventListener('dragstart', (e) => {
      cf.dragged = f;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-confronto-file', f.name);
    });
    li.addEventListener('dragend', () => { cf.dragged = null; });
    return li;
  }));
  if (cf.files.length && !shown.length) list.innerHTML = '<li class="empty small">Nessun file corrisponde alla ricerca.</li>';
}

$('#cfFolderPick').addEventListener('click', () => $('#cfFolderInput').click());
$('#cfFolderSearch').addEventListener('input', cfRenderFiles);
$('#cfFolderInput').addEventListener('change', (e) => {
  const all = [...e.target.files];
  e.target.value = '';  // riscegliere la stessa cartella la rilegge
  if (!all.length) return;
  cf.files = all.filter(cfAllowed).sort((x, y) => cfRel(x).localeCompare(cfRel(y), 'it', { numeric: true }));
  $('#cfFolderInfo').textContent = `${cfRel(all[0]).split('/')[0]} · ${cf.files.length} documenti utilizzabili su ${all.length} file`;
  $('#cfLottiBox').hidden = cf.files.length < 2;
  cfRenderFiles();
});

// ------------------------------------------------------------------ impostazioni e profili

function cfValori() {
  const v = {};
  Object.entries(CF_CAMPI).forEach(([k, sel]) => { const el = $(sel); v[k] = el.type === 'checkbox' ? el.checked : el.value; });
  return v;
}

function cfApplica(v) {
  Object.entries(CF_CAMPI).forEach(([k, sel]) => {
    const el = $(sel);
    if (!v || !(k in v)) return;
    if (el.type === 'checkbox') el.checked = !!v[k];
    else if (el.tagName !== 'SELECT' || [...el.options].some((o) => o.value === v[k])) el.value = v[k];
  });
}

function cfFormData(a, b) {
  const v = cfValori();
  const fd = new FormData();
  fd.append('pdf1', a);
  fd.append('pdf2', b);
  fd.append('model', v.model);
  fd.append('dpi', v.dpi);
  fd.append('lang', v.lang);
  fd.append('tolerant', v.tolerant ? '1' : '0');
  fd.append('preprocess', v.preprocess ? '1' : '0');
  fd.append('ripetute', v.ripetute ? '1' : '0');
  fd.append('ignore', v.ignore);
  return fd;
}

function cfElencaProfili(scelto = '') {
  const profili = cfStore('cf.profili') || {};
  const nomi = Object.keys(profili).sort((x, y) => x.localeCompare(y, 'it'));
  $('#cfProfilo').innerHTML = '<option value="">— nessun profilo —</option>' + nomi.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('#cfProfilo').value = scelto;
  $('#cfProfiloElimina').disabled = !scelto;
}

cfApplica(cfStore('cf.opzioni'));
Object.values(CF_CAMPI).forEach((sel) => $(sel).addEventListener('change', () => cfStore('cf.opzioni', cfValori())));
$('#cfIgnore').addEventListener('input', () => cfStore('cf.opzioni', cfValori()));
cfElencaProfili();
$('#cfProfilo').addEventListener('change', (e) => {
  const p = (cfStore('cf.profili') || {})[e.target.value];
  if (p) { cfApplica(p); cfStore('cf.opzioni', cfValori()); }
  $('#cfProfiloElimina').disabled = !e.target.value;
});
$('#cfProfiloSalva').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Salva le impostazioni',
    html: `<p>Le impostazioni attuali (lettura, opzioni e righe da ignorare) restano in questo browser con un nome.</p>
      <div class="field"><label for="cfProfiloNome">Nome del profilo</label><input id="cfProfiloNome" type="text" maxlength="60" placeholder="Es. Computi Lotto 3" value="${esc($('#cfProfilo').value)}"></div>`,
    okText: 'Salva profilo',
  });
  const nome = (($('#cfProfiloNome') || {}).value || '').trim().slice(0, 60);
  if (!ok || !nome) return;
  const profili = cfStore('cf.profili') || {};
  profili[nome] = cfValori();
  cfStore('cf.profili', profili);
  cfElencaProfili(nome);
  toast(`Profilo "${nome}" salvato`, 'ok');
});
$('#cfProfiloElimina').addEventListener('click', async () => {
  const nome = $('#cfProfilo').value;
  if (!nome || !(await confirmDialog({ title: 'Elimina il profilo', html: `<p>Eliminare il profilo <strong>${esc(nome)}</strong>?</p>`, okText: 'Elimina' }))) return;
  const profili = cfStore('cf.profili') || {};
  delete profili[nome];
  cfStore('cf.profili', profili);
  cfElencaProfili();
});

// ------------------------------------------------------------------ avvio e avanzamento

function cfProgress({ title, names, msg, count = '', frac = null, state: st = 'running' }) {
  const card = $('#cfProgress');
  card.hidden = false;
  card.classList.toggle('is-running', st === 'running' && frac === null);
  card.classList.toggle('is-done', st === 'done');
  card.classList.toggle('is-failed', st === 'failed');
  if (title) $('#cfProgTitle').textContent = title;
  if (names !== undefined) $('#cfProgNames').textContent = names;
  $('#cfProgMsg').textContent = msg;
  $('#cfProgCount').textContent = count;
  $('#cfProgBar').style.transform = `scaleX(${st === 'done' || (st === 'running' && frac === null) ? 1 : frac || 0})`;
  $('#cfCancel').hidden = st !== 'running';
}

$('#cfGo').addEventListener('click', async () => {
  if (!cf.a || !cf.b) return;
  const btn = $('#cfGo');
  setLoading(btn, true);
  $('#cfResults').hidden = true;
  cfProgress({ title: 'Confronto in corso', names: `${cf.a.name}  ↔  ${cf.b.name}`, msg: 'Caricamento dei file…' });
  try {
    const d = await cfUpload(cfFormData(cf.a, cf.b));
    cf.jobId = d.job_id;
    cfPoll();
    loadCfStorico();
  } catch (e) {
    cfProgress({ title: 'Confronto non avviato', msg: e.message, state: 'failed' });
  } finally {
    setLoading(btn, false);
    btn.disabled = !(cf.a && cf.b);
  }
});

function cfPoll() {
  clearTimeout(cf.timer);
  const id = cf.jobId;
  const giro = async () => {
    let job;
    try {
      job = await api(`/api/confronto/jobs/${id}`);
    } catch (e) {
      if (/non trovato/i.test(e.message)) return cfProgress({ msg: e.message, state: 'failed' });
      cf.timer = setTimeout(giro, 2000);  // errore di rete passeggero: si riprova
      return;
    }
    if (id !== cf.jobId) return;  // nel frattempo e' stato aperto un altro confronto
    if (job.status === 'done') {
      cfProgress({ title: 'Confronto completato', msg: job.message || '', state: 'done' });
      setTimeout(() => { if (cf.jobId === id) $('#cfProgress').hidden = true; }, 1500);
      cfRender(job);
      loadCfStorico();
      return;
    }
    if (job.status === 'error' || job.status === 'cancelled') {
      cfProgress({ title: job.status === 'cancelled' ? 'Confronto annullato' : 'Confronto non riuscito', msg: job.message || '', state: 'failed' });
      loadCfStorico();
      return;
    }
    const tot = job.total_pages || 0;
    cfProgress({ names: `${job.name_a || ''}  ↔  ${job.name_b || ''}`, msg: job.message || '…',
      count: tot ? `${job.current_page || 0} / ${tot}` : '', frac: tot ? (job.current_page || 0) / tot : null });
    cf.timer = setTimeout(giro, 900);
  };
  giro();
}

$('#cfCancel').addEventListener('click', async () => {
  if (!cf.jobId) return;
  try {
    await api(cfJobUrl('/cancel'), { method: 'POST' });
    $('#cfProgMsg').textContent = 'Annullamento in corso…';
  } catch (e) { toast(e.message, 'err'); }
});

// ------------------------------------------------------------------ risultato

const cfSegs = (list, cls) => list.map((s) => (s.eq ? esc(s.s) : `<mark class="${cls}">${esc(s.s)}</mark>`)).join(' ');
const cfAttr = (r, o, num) => ` data-r="${r}" data-o="${o}"${num ? ' data-num="1"' : ''} tabindex="0" title="Apri l'anteprima su questo punto"`;

function cfOpHtml(op, r, o, num) {
  if (op.type === 'equal') return `<div class="cf-line equal">${esc(op.text)}</div>`;
  if (op.type === 'moved') return `<div class="cf-line moved"><span class="cf-tag">spostata</span>${esc(op.text)}</div>`;
  if (op.type === 'change' && op.incerta) {
    return `<div class="cf-line d incerta"${cfAttr(r, o, num)}><span class="cf-tag">incerta</span>${cfSegs(op.a, 'winc')} → ${cfSegs(op.b, 'winc')}</div>`;
  }
  if (op.type === 'change') {
    const voce = op.voce ? `<span class="cf-tag">voce ${esc(op.voce)}</span>` : '';
    return `<div class="cf-line d chg"${cfAttr(r, o, num)}><div class="cf-l del">${voce}${cfSegs(op.a, 'wdel')}</div><div class="cf-l add">${cfSegs(op.b, 'wadd')}</div></div>`;
  }
  return `<div class="cf-line d ${op.type}"${cfAttr(r, o, num)}>${esc(op.text)}</div>`;
}

function cfSrcTag(p) {
  const a = p.source_a, b = p.source_b;
  if (!a && !b) return '';
  const t = a === b || !b ? a : !a ? b : `${a}/${b}`;
  return `<span class="cf-src" title="Da dove viene il testo">${esc(t)}</span>`;
}

function cfFocusLine(el) {
  if (!el) return;
  el.closest('.cf-page')?.classList.add('open');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;  // riavvia l'animazione
  el.classList.add('flash');
  el.focus({ preventScroll: true });
}

function cfRender(job) {
  cf.job = job;
  const ok = job.diff_count === 0;
  $('#cfResNames').textContent = `${job.name_a || ''}  ↔  ${job.name_b || ''}`;
  const sum = $('#cfSummary');
  sum.className = `cf-summary ${ok ? 'ok' : 'warn'}`;
  sum.innerHTML = `${icon(ok ? 'check' : 'alert')}<span>${esc(job.message || '')}</span>`;
  $('#cfDlPdf').href = cfJobUrl('/report.pdf');
  $('#cfDlDocx').href = cfJobUrl('/report.docx');
  $('#cfDlXlsx').href = cfJobUrl('/report.xlsx');

  const numeri = new Set((job.riepilogo || []).map((n) => `${n.risultato}:${n.idx}`));
  const rie = job.riepilogo || [];
  $('#cfRiepilogo').hidden = !rie.length;
  $('#cfRiepilogo').innerHTML = rie.length ? `<h3>Numeri e date cambiati <span class="badge b-warn">${rie.length}</span></h3><ul>${rie.map((n) =>
    `<li><button type="button" class="cf-rie" data-r="${n.risultato}" data-o="${n.idx}"><span class="mono muted">pag. ${esc(String(n.pagina))}</span><span class="cf-rie-tipo">${esc(n.tipo)}</span><span class="cf-rie-a">${esc(n.a || '(assente)')}</span><span class="muted">→</span><span class="cf-rie-b">${esc(n.b || '(assente)')}</span></button></li>`).join('')}</ul>` : '';

  $('#cfPages').innerHTML = job.results.map((p, r) => {
    const [cls, label] = CF_BADGE[p.status] || CF_BADGE.diff;
    const lines = p.ops.map((op, o) => cfOpHtml(op, r, o, numeri.has(`${r}:${o}`))).join('');
    const open = p.status === 'diff' || p.status === 'missing' ? ' open' : '';
    return `<section class="cf-page${open}" data-r="${r}">
      <header class="cf-page-head"><button type="button" class="cf-page-toggle" aria-expanded="${!!open}"><svg class="ic cf-chev"><use href="#i-chevron"/></svg>
        <span class="mono cf-pnum">${cfPageLabel(p)}</span><span class="badge ${cls}">${esc(label(p))}</span>${cfSrcTag(p)}</button>
        <button type="button" class="btn btn-ghost btn-sm cf-eye">${icon('eye')}Anteprima</button></header>
      <div class="cf-page-body">${lines || '<div class="cf-line equal muted">— nessun testo —</div>'}</div></section>`;
  }).join('');

  cfInitRevisione(job);
  cfRefreshNav();
  $('#cfResults').hidden = false;
  $('#cfResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#cfRiepilogo').addEventListener('click', (e) => {
  const b = e.target.closest('.cf-rie');
  if (b) cfFocusLine($(`#cfPages .cf-line.d[data-r="${b.dataset.r}"][data-o="${b.dataset.o}"]`));
});

$('#cfPages').addEventListener('click', (e) => {
  const page = e.target.closest('.cf-page');
  if (!page) return;
  if (e.target.closest('.cf-rev')) return;  // controlli di revisione: gestiti a parte
  if (e.target.closest('.cf-eye')) return cfOpenViewer(+page.dataset.r);
  const toggle = e.target.closest('.cf-page-toggle');
  if (toggle) {
    page.classList.toggle('open');
    toggle.setAttribute('aria-expanded', page.classList.contains('open'));
    return;
  }
  const line = e.target.closest('.cf-line.d');
  if (line) {
    cf.cur = cfLista().indexOf(line);
    cfAggiornaNav();
    cfOpenViewer(+line.dataset.r, cf.job.results[+line.dataset.r].ops[+line.dataset.o]);
  }
});
$('#cfPages').addEventListener('keydown', (e) => {
  const line = e.target.closest('.cf-line.d');
  if (line && e.key === 'Enter' && e.target === line) cfOpenViewer(+line.dataset.r, cf.job.results[+line.dataset.r].ops[+line.dataset.o]);
});

// ------------------------------------------------------------------ navigazione tra le differenze

const cfSoloNumeri = () => $('#cfOnlyNum').checked;

function cfLista() {
  const tutte = $$('#cfPages .cf-line.d');
  return cfSoloNumeri() ? tutte.filter((el) => el.dataset.num) : tutte;
}

function cfAggiornaNav() {
  const n = cfLista().length;
  $('#cfDiffCount').textContent = !n ? 'Nessuna differenza'
    : cf.cur < 0 ? `${fmtNum(n)} ${n === 1 ? 'differenza' : 'differenze'}`
      : `Differenza ${fmtNum(cf.cur + 1)} di ${fmtNum(n)}`;
  $('#cfPrev').disabled = $('#cfNext').disabled = !n;
}

function cfVai(passo) {
  const l = cfLista();
  if (!l.length) return;
  cf.cur = cf.cur < 0 ? (passo > 0 ? 0 : l.length - 1) : (cf.cur + passo + l.length) % l.length;
  cfFocusLine(l[cf.cur]);
  cfAggiornaNav();
}

function cfFiltra() {
  const on = cfSoloNumeri();
  $('#cfPages').classList.toggle('solo-num', on);
  $$('#cfPages .cf-page').forEach((c) => {
    c.hidden = on && !$('.cf-line.d[data-num]', c);
    if (on && !c.hidden) c.classList.add('open');
  });
  cf.cur = -1;
  cfAggiornaNav();
}

function cfRefreshNav() {
  cf.cur = -1;
  $('#cfNav').hidden = !$('#cfPages .cf-line.d');
  cfFiltra();
}

$('#cfPrev').addEventListener('click', () => cfVai(-1));
$('#cfNext').addEventListener('click', () => cfVai(1));
$('#cfOnlyNum').addEventListener('change', cfFiltra);
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if ($('#view-confronto').hidden || $('#cfResults').hidden || !$('#cfViewer').hidden || $('.modal:not([hidden])')) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); cfVai(1); }
  else if (k === 'p') { e.preventDefault(); cfVai(-1); }
});

// ------------------------------------------------------------------ revisione delle differenze

const cfChiave = (el) => `${el.dataset.r}:${el.dataset.o}`;

function cfDisegnaRev(el) {
  const v = cf.rev[cfChiave(el)] || {};
  CF_REV.forEach(([s]) => el.classList.toggle(`rev-${s}`, v.stato === s));
  $$('.cf-rev-btn', el).forEach((b) => b.setAttribute('aria-pressed', String(!!b.dataset.s && b.dataset.s === v.stato)));
  const nota = $('.cf-rev-nota', el);
  nota.hidden = !v.nota;
  nota.textContent = v.nota ? `Nota: ${v.nota}` : '';
  $('.cf-rev-n', el).classList.toggle('has', !!v.nota);
}

function cfContaRev() {
  const tutte = $$('#cfPages .cf-line.d').length;
  const fatte = Object.values(cf.rev).filter((v) => v.stato).length;
  $('#cfRevCount').textContent = tutte ? `Riviste ${fmtNum(fatte)} di ${fmtNum(tutte)}` : '';
}

async function cfSalvaRev(el, stato, nota) {
  const k = cfChiave(el);
  const prima = cf.rev[k];
  if (stato || nota) cf.rev[k] = { stato, nota }; else delete cf.rev[k];
  cfDisegnaRev(el);
  cfContaRev();
  try {
    await api(cfJobUrl('/revisione'), { method: 'POST', body: { chiave: k, stato, nota } });
  } catch (e) {  // non salvata: torna com'era
    if (prima) cf.rev[k] = prima; else delete cf.rev[k];
    cfDisegnaRev(el);
    cfContaRev();
    toast(`Revisione non salvata: ${e.message}`, 'err');
  }
}

function cfInitRevisione(job) {
  cf.rev = { ...(job.revisione || {}) };
  $$('#cfPages .cf-line.d').forEach((el) => {
    const box = document.createElement('span');
    box.className = 'cf-rev';
    box.innerHTML = CF_REV.map(([s, ic, label]) => `<button type="button" class="cf-rev-btn" data-s="${s}" title="${label}" aria-label="${label}">${icon(ic)}</button>`).join('')
      + `<button type="button" class="cf-rev-btn cf-rev-n" title="Nota" aria-label="Aggiungi una nota">${icon('edit')}</button>`;
    const nota = document.createElement('div');
    nota.className = 'cf-rev-nota';
    el.append(box, nota);
    box.addEventListener('click', async (e) => {
      e.stopPropagation();  // niente anteprima
      const b = e.target.closest('.cf-rev-btn');
      if (!b) return;
      const v = cf.rev[cfChiave(el)] || {};
      if (!b.classList.contains('cf-rev-n')) return cfSalvaRev(el, v.stato === b.dataset.s ? '' : b.dataset.s, v.nota || '');
      const ok = await confirmDialog({
        title: 'Nota sulla differenza',
        html: `<div class="field"><label for="cfNota">Nota (finisce nell'elenco Excel)</label><textarea id="cfNota" rows="3" maxlength="1000">${esc(v.nota || '')}</textarea></div>`,
        okText: 'Salva nota',
      });
      if (ok) cfSalvaRev(el, v.stato || '', (($('#cfNota') || {}).value || '').trim());
    });
    cfDisegnaRev(el);
  });
  cfContaRev();
}

// ------------------------------------------------------------------ anteprima delle pagine

const cfBoxes = (boxes) => (boxes || []).map((b) => `<div class="cf-box" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"></div>`).join('');
const cfBand = (y) => (y == null ? '' : `<div class="cf-band" style="top:calc(${y * 100}% - 1.4%)" title="Zona della differenza (posizione stimata)"></div>`);
const cfImg = (page, side) => cfJobUrl(`/page/${page}/${side}${cf.v.proc ? '?v=proc' : ''}`);

function cfScrollToY(pane, y) {
  if (y == null) return;
  const img = $('img', pane);
  const go = () => { pane.scrollTop = Math.max(0, y * pane.scrollHeight - pane.clientHeight / 2); };
  if (img && !img.complete) img.addEventListener('load', go, { once: true }); else go();
}

function cfPane(sel, side, page, boxes, missingName, y) {
  const pane = $(sel);
  if (missingName) {
    pane.innerHTML = '<div class="cf-pane-empty"></div>';
    pane.firstChild.textContent = `Pagina non presente in ${missingName}`;
    return;
  }
  pane.innerHTML = `<div class="cf-wrap"><img src="${cfImg(page, side)}" alt="Pagina ${page} di ${side.toUpperCase()}">${cfBoxes(boxes)}${cfBand(y)}</div>`;
  cfScrollToY(pane, y);
}

function cfApplyZoom() {
  $$('#cfViewer .cf-wrap').forEach((w) => { w.style.width = `${cf.v.zoom * 100}%`; });
  $('#cfVZoom').textContent = `${Math.round(cf.v.zoom * 100)}%`;
}

function cfSlider(v) {
  const top = $('#cfVOverlay img.top');
  const div = $('#cfVOverlay .cf-divider');
  if (top) top.style.clipPath = `inset(0 0 0 ${v}%)`;
  if (div) div.style.left = `${v}%`;
}

function cfOpenViewer(idx, focus) {
  if (!cf.job) return;
  const res = cf.job.results;
  cf.v.idx = Math.max(0, Math.min(idx, res.length - 1));
  const p = res[cf.v.idx];
  $('#cfVPage').textContent = `${cfPageLabel(p)} · ${cf.v.idx + 1}/${res.length}`;
  $('#cfVNames').textContent = '';
  $('#cfVNameA').textContent = cf.job.name_a || '';
  $('#cfVNameB').textContent = cf.job.name_b || '';
  const missing = p.status === 'missing';
  $('#cfVMode').hidden = $('#cfVProc').hidden = missing;
  if (missing) cf.v.mode = 'side';
  $('#cfVSide').hidden = cf.v.mode === 'overlay';
  $('#cfVOverlayWrap').hidden = cf.v.mode !== 'overlay';
  $('#cfVMode span').textContent = cf.v.mode === 'overlay' ? 'Affianca' : 'Sovrapponi';
  if (cf.v.mode === 'overlay') {
    $('#cfVOverlay').innerHTML = `<div class="cf-wrap"><img src="${cfImg(p.page_a, 'a')}" alt="A"><img class="top" src="${cfImg(p.page_b, 'b')}" alt="B"><div class="cf-divider"></div>${cfBoxes(p.boxes)}${cfBand(focus?.ya)}</div>`;
    cfSlider($('#cfVSlider').value);
    cfScrollToY($('#cfVOverlay'), focus?.ya);
  } else {
    cfPane('#cfVPaneA', 'a', p.page_a, p.boxes, p.page_a == null ? cf.job.name_a : null, focus?.ya);
    cfPane('#cfVPaneB', 'b', p.page_b, p.boxes, p.page_b == null ? cf.job.name_b : null, focus?.yb);
  }
  cfApplyZoom();
  $('#cfVPrev').disabled = cf.v.idx === 0;
  $('#cfVNext').disabled = cf.v.idx === res.length - 1;
  if ($('#cfViewer').hidden) {
    $('#cfViewer').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#cfVClose').focus();
  }
}

function cfCloseViewer() {
  $('#cfViewer').hidden = true;
  document.body.style.overflow = '';
}

// scorrimento allineato dei due lati, in proporzione (A e B possono avere dimensioni diverse)
let cfSyncing = false;
function cfSync(src, dst) {
  if (cfSyncing) return;
  cfSyncing = true;
  dst.scrollLeft = (src.scrollLeft / Math.max(1, src.scrollWidth - src.clientWidth)) * (dst.scrollWidth - dst.clientWidth);
  dst.scrollTop = (src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight)) * (dst.scrollHeight - dst.clientHeight);
  requestAnimationFrame(() => { cfSyncing = false; });
}
$('#cfVPaneA').addEventListener('scroll', () => cfSync($('#cfVPaneA'), $('#cfVPaneB')));
$('#cfVPaneB').addEventListener('scroll', () => cfSync($('#cfVPaneB'), $('#cfVPaneA')));

const cfZoom = (z) => { cf.v.zoom = Math.max(0.5, Math.min(4, z)); cfApplyZoom(); };
$('#cfVZoomIn').addEventListener('click', () => cfZoom(cf.v.zoom + 0.25));
$('#cfVZoomOut').addEventListener('click', () => cfZoom(cf.v.zoom - 0.25));
$('#cfVZoom').addEventListener('click', () => cfZoom(1));
$('#cfVSlider').addEventListener('input', (e) => cfSlider(e.target.value));
$('#cfVMode').addEventListener('click', () => { cf.v.mode = cf.v.mode === 'overlay' ? 'side' : 'overlay'; cfOpenViewer(cf.v.idx); });
$('#cfVProc').addEventListener('click', () => {
  cf.v.proc = !cf.v.proc;
  $('#cfVProc').setAttribute('aria-pressed', String(cf.v.proc));
  $('#cfVProc span').textContent = cf.v.proc ? 'Vista originale' : 'Vista OCR';
  cfOpenViewer(cf.v.idx);
});
$('#cfVPrev').addEventListener('click', () => cfOpenViewer(cf.v.idx - 1));
$('#cfVNext').addEventListener('click', () => cfOpenViewer(cf.v.idx + 1));
$('#cfVClose').addEventListener('click', cfCloseViewer);
document.addEventListener('keydown', (e) => {
  if ($('#cfViewer').hidden) return;
  if (e.key === 'Escape') cfCloseViewer();
  else if (e.key === 'ArrowLeft' && !$('#cfVPrev').disabled) cfOpenViewer(cf.v.idx - 1);
  else if (e.key === 'ArrowRight' && !$('#cfVNext').disabled) cfOpenViewer(cf.v.idx + 1);
});

// ------------------------------------------------------------------ piu' confronti in un colpo

// nome base senza estensione e senza i suffissi di versione piu' comuni (computo_rev2, offerta v3, ..._2026-10-01)
const CF_SUFFISSI = [
  /[\s_\-.]*(rev|r|v|ver|vers|versione|release)[\s_\-.]*\d+[a-z]?$/i,
  /[\s_\-.]*\d{4}[\-_.]?\d{2}[\-_.]?\d{2}$/,
  /[\s_\-.]*\d{2}[\-_.]\d{2}[\-_.]\d{2,4}$/,
  /[\s_\-.]*\(\d+\)$/,
  /[\s_\-.]*(def|definitivo|definitiva|bozza|draft|old|new|vecchio|nuovo|firmato|firmata|agg|aggiornato|finale|copia)$/i,
];
function cfNomeBase(nome) {
  let b = nome.replace(/\.[^.]+$/, '').toLowerCase().trim();
  for (let giro = 0, prima = ''; giro < 4 && b !== prima; giro++) {
    prima = b;
    CF_SUFFISSI.forEach((re) => { b = b.replace(re, ''); });
  }
  return b.replace(/[\s_\-.]+/g, ' ').trim();
}

// ordine delle versioni: numero di rev/v, poi data nel nome, poi data di modifica del file
function cfChiaveVersione(f) {
  const n = f.name.replace(/\.[^.]+$/, '');
  const rev = n.match(/(?:rev|r|v|ver|vers|versione)[\s_\-.]*(\d+)/i);
  const data = n.match(/(\d{4})[\-_.]?(\d{2})[\-_.]?(\d{2})/) || n.match(/(\d{2})[\-_.](\d{2})[\-_.](\d{4})/);
  let d = 0;
  if (data) d = data[1].length === 4 ? +(data[1] + data[2] + data[3]) : +(data[3] + data[2] + data[1]);
  return [rev ? +rev[1] : -1, d, f.lastModified || 0];
}
const cfConfrontaChiavi = (x, y) => { for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

function cfCoppieVersioni(files) {
  const gruppi = new Map();
  files.forEach((f) => {
    const k = cfNomeBase(f.name);
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(f);
  });
  const coppie = [];
  [...gruppi.entries()].sort().forEach(([base, fs]) => {
    if (fs.length < 2) return;
    fs.sort((x, y) => cfConfrontaChiavi(cfChiaveVersione(x), cfChiaveVersione(y)));
    for (let i = 0; i < fs.length - 1; i++) {
      coppie.push({ a: fs[i], b: fs[i + 1], motivo: `${base} · versione ${i + 1} → ${i + 2} di ${fs.length}`, scelta: i === fs.length - 2 });
    }
  });
  return coppie;
}

// somiglianza tra due nomi (bigrammi di Dice), 0..1
function cfSomiglianza(x, y) {
  if (x === y) return 1;
  const big = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const a = big(x), b = big(y);
  let comuni = 0, tot = 0;
  a.forEach((n, g) => { comuni += Math.min(n, b.get(g) || 0); tot += n; });
  b.forEach((n) => { tot += n; });
  return tot ? (2 * comuni) / tot : 0;
}

function cfCoppieCartelle(filesA, filesB) {
  const ext = (n) => (n.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  const liberi = new Set(filesB);
  const coppie = [], soli = [];
  filesA.forEach((fa) => {
    let best = null, score = 0;
    liberi.forEach((fb) => {
      if (ext(fa.name) !== ext(fb.name)) return;
      const s = fa.name.toLowerCase() === fb.name.toLowerCase() ? 1.01 : cfSomiglianza(cfNomeBase(fa.name), cfNomeBase(fb.name));
      if (s > score) { best = fb; score = s; }
    });
    if (best && score >= 0.8) {
      liberi.delete(best);
      coppie.push({ a: fa, b: best, motivo: score > 1 ? 'stesso nome' : score === 1 ? 'stesso nome, altra versione' : `nome simile ${Math.round(score * 100)}%`, scelta: true });
    } else {
      soli.push(`solo in A: ${cfRel(fa)}`);
    }
  });
  liberi.forEach((fb) => soli.push(`solo in B: ${cfRel(fb)}`));
  return { coppie, soli };
}

function cfMostraLotti(titolo, coppie, soli = []) {
  cf.proposte = coppie;
  $('#cfLottiTitle').textContent = titolo;
  $('#cfLottiList').innerHTML = coppie.length ? coppie.map((c, i) =>
    `<li><label class="cf-lotto"><input type="checkbox" data-i="${i}"${c.scelta ? ' checked' : ''}><span class="cf-lotto-nomi"><strong>${esc(cfRel(c.a))}</strong> <span class="muted">↔</span> <strong>${esc(cfRel(c.b))}</strong></span><small class="muted">${esc(c.motivo)}</small></label></li>`).join('')
    : '<li class="empty small">Nessuna coppia trovata.</li>';
  $('#cfLottiSoli').innerHTML = soli.length
    ? `<details class="advanced"><summary>${icon('chevron')}${soli.length} file senza corrispondenza</summary><ul class="cf-soli">${soli.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>` : '';
  $('#cfLottiEsito').textContent = '';
  cfContaLotti();
  $('#cfLottiModal').hidden = false;
}

function cfContaLotti() {
  const n = $$('#cfLottiList input:checked').length;
  $('#cfLottiGo').textContent = `Avvia ${n} ${n === 1 ? 'confronto' : 'confronti'}`;
  $('#cfLottiGo').disabled = !n;
}

const cfChiudiLotti = () => { $('#cfLottiModal').hidden = true; };

$('#cfLottiVersioni').addEventListener('click', () => cfMostraLotti('Versioni nella cartella', cfCoppieVersioni(cf.files)));
$('#cfLottiAltra').addEventListener('click', () => $('#cfFolderInputB').click());
$('#cfFolderInputB').addEventListener('change', (e) => {
  const b = [...e.target.files].filter(cfAllowed);
  e.target.value = '';
  if (!b.length || !cf.files.length) return;
  const { coppie, soli } = cfCoppieCartelle(cf.files, b);
  cfMostraLotti('Cartella aperta ↔ altra cartella', coppie, soli);
});
$('#cfLottiList').addEventListener('change', cfContaLotti);
$$('#cfLottiModal [data-close]').forEach((b) => b.addEventListener('click', cfChiudiLotti));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#cfLottiModal').hidden) cfChiudiLotti(); });
$('#cfLottiGo').addEventListener('click', async () => {
  const scelte = $$('#cfLottiList input:checked').map((i) => cf.proposte[+i.dataset.i]);
  const btn = $('#cfLottiGo');
  setLoading(btn, true);
  let ok = 0;
  for (const [k, c] of scelte.entries()) {
    $('#cfLottiEsito').textContent = `Invio ${k + 1} di ${scelte.length}…`;
    try {
      await cfUpload(cfFormData(c.a, c.b));  // il motore li mette in coda e ne esegue pochi alla volta
      ok++;
    } catch (e) {
      toast(`${cfRel(c.a)}: ${e.message}`, 'err', 8000);
    }
  }
  setLoading(btn, false);
  cfChiudiLotti();
  toast(`${ok} ${ok === 1 ? 'confronto avviato' : 'confronti avviati'}: li trovi in "I miei confronti"`, ok ? 'ok' : 'err');
  await loadCfStorico();
  $('#cfStorico').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ------------------------------------------------------------------ confronti fatti

const CF_STATO = {
  done: (c) => (c.diff_count ? ['b-warn', 'Differenze'] : ['b-ok', 'Uguali']),
  error: () => ['b-err', 'Errore'],
  cancelled: () => ['b-mute', 'Annullato'],
  scaduto: () => ['b-mute', 'Non più disponibile'],
};
const cfInCorso = (c) => !CF_STATO[c.status];

async function loadCfStorico() {
  clearTimeout(cf.storTimer);
  const btn = $('#cfStoricoReload');
  setLoading(btn, true);
  try {
    const d = await api('/api/confronto/storico');
    cf.storico = d.confronti || [];
    cfRenderStorico();
  } catch (e) {
    $('#cfStoricoBody').innerHTML = '';
    $('#cfStoricoEmpty').hidden = false;
    $('#cfStoricoEmpty p').textContent = e.message;
  } finally {
    setLoading(btn, false);
  }
  const run = cf.storico.filter(cfInCorso).length;
  $('#cfRunCount').hidden = !run;
  $('#cfRunCount').textContent = run;
  // confronti ancora in corso (es. dopo un lotto): l'elenco si aggiorna da solo finche' la pagina e' aperta
  if (run && !$('#view-confronto').hidden) cf.storTimer = setTimeout(loadCfStorico, 3000);
}

function cfRenderStorico() {
  $('#cfStoricoTitle').textContent = isAdmin() ? 'Confronti di tutti gli utenti' : 'I miei confronti';
  const q = $('#cfStoricoSearch').value.trim().toLowerCase();
  const rows = cf.storico.filter((c) => !q || `${c.name_a} ${c.name_b} ${c.utente}`.toLowerCase().includes(q));
  $('#cfStoricoBody').innerHTML = rows.map((c) => {
    const [cls, label] = (CF_STATO[c.status] || (() => ['b-info', 'In corso']))(c);
    const apribile = c.status === 'done';
    return `<tr class="${apribile ? 'row-link' : ''}${c.id === cf.jobId ? ' cf-current' : ''}" data-id="${esc(c.id)}">
      <td class="nowrap small" title="${esc(fmtFull(c.creato))}">${esc(fmtAgo(c.creato))}</td>
      <td class="cf-sto-nomi"><strong>${esc(c.name_a || '?')}</strong><span class="muted"> ↔ </span><strong>${esc(c.name_b || '?')}</strong></td>
      <td><span class="badge ${cls}">${label}</span><span class="fdir">${esc(c.message || '')}</span></td>
      <td data-admin>${esc(c.utente || '')}</td>
      <td class="num"><div class="user-actions">
        ${apribile ? `<button class="btn btn-ghost btn-sm" type="button" data-open="${esc(c.id)}">${icon('eye')}Apri</button>` : ''}
        ${cfInCorso(c) ? '' : `<button class="icon-btn" type="button" data-del="${esc(c.id)}" title="Elimina" aria-label="Elimina il confronto">${icon('trash')}</button>`}
      </div></td></tr>`;
  }).join('');
  $('#cfStoricoEmpty').hidden = rows.length > 0;
  $('#cfStoricoEmpty p').textContent = cf.storico.length ? 'Nessun confronto corrisponde alla ricerca.' : 'Ancora nessun confronto.';
}

async function cfApri(id) {
  try {
    const job = await api(`/api/confronto/jobs/${encodeURIComponent(id)}`);
    clearTimeout(cf.timer);
    cf.jobId = id;
    $('#cfProgress').hidden = true;
    if (job.status === 'done') cfRender(job);
    else if (!['error', 'cancelled'].includes(job.status)) cfPoll();
    cfRenderStorico();
  } catch (e) {
    toast(e.message, 'err');
  }
}

$('#cfStoricoSearch').addEventListener('input', cfRenderStorico);
$('#cfStoricoReload').addEventListener('click', loadCfStorico);
$('#cfStoricoBody').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const ok = await confirmDialog({ title: 'Elimina il confronto', html: '<p>Report, anteprime e revisione di questo confronto non saranno più disponibili.</p>', okText: 'Elimina' });
    if (!ok) return;
    try {
      await api(`/api/confronto/jobs/${del.dataset.del}/delete`, { method: 'POST' });
      if (cf.jobId === del.dataset.del) { cf.jobId = null; cf.job = null; $('#cfResults').hidden = true; }
      toast('Confronto eliminato', 'ok');
      loadCfStorico();
    } catch (err) { toast(err.message, 'err'); }
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (row && (e.target.closest('[data-open]') || row.classList.contains('row-link'))) cfApri(row.dataset.id);
});
