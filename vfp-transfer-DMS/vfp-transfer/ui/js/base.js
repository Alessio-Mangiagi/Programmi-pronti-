// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: stato condiviso, utilita' e navigazione.
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  cfg: null,
  preview: null,        // ultima anteprima
  previewKey: '',       // sorgente+manifest usati per l'anteprima (per capire se e' scaduta)
  pvFilter: 'all',
  events: [],
  evFilter: 'all',
  logSeq: 0,
  logLines: 0,
  polling: null,
  report: [],
  rpFilter: 'all',
  dirty: false,
  authTimer: null,
  env: null,
  mail: null,
  mpFilter: 'all',
  mailTimer: null,
  ovReport: null,
  ovTimer: null,
  flFilter: 'all',
  flGroups: [],
  mlData: null,
  mlPeriod: '7',
  mlSource: '',
  me: null,             // utente collegato: { user, role, role_label, email }
  sendDays: '7',
  users: [],
  ai: null,
  aiFilter: 'all',
  aiTimer: null,
  act: null,
  actCat: '',
  actDays: '7',
  actTimer: null,
  prot: null,           // controllo della numerazione dei protocolli PEC
  protYear: '',
  drawerGroup: null,    // email aperta nel dettaglio
  searchTimer: null,
};
const isAdmin = () => state.me && state.me.role === 'admin';
// l'amministratore vede tutte le aree, l'utente normale solo quella assegnata
const canSeeArea = (area) => isAdmin() || (!!state.me && state.me.area === area);

// ------------------------------------------------------------------ utilita'

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['X-VFP-UI'] = '1';
    opts.body = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error("Il programma non risponde. Controlla che la finestra 'Trasferimento VFP' sia ancora aperta.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 428 && data.approval_required) {  // modifica protetta: codice inviato all'amministratore
    const code = await askApprovalCode(data.error);
    if (!code) throw new Error("Modifica annullata: serve il codice inviato all'amministratore.");
    return api(path, { method, body: { ...(body || {}), otp: code } });
  }
  if (res.status === 401 && data.login) {  // sessione scaduta: di nuovo alla pagina di accesso
    window.location.replace('/login.html');
    throw new Error('Sessione scaduta: accedi di nuovo.');
  }
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

async function askApprovalCode(message) {
  const pending = confirmDialog({
    title: 'Codice di autorizzazione',
    html: `<p>${esc(message)}</p><div class="field"><label for="otpCode">Codice ricevuto via email</label>
      <input id="otpCode" type="text" class="mono otp-input" autocomplete="one-time-code" spellcheck="false" maxlength="12" placeholder="XXXX-XXXX"></div>`,
    okText: 'Conferma modifica',
  });
  const input = $('#otpCode');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#confirmOk').click(); });
  const ok = await pending;
  const code = (($('#otpCode') || {}).value || '').trim();
  return ok && code ? code : '';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const icon = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;

function fmtSize(bytes) {
  if (bytes == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('it-IT', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}
const fmtNum = (n) => Number(n || 0).toLocaleString('it-IT');

function splitPath(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i < 0 ? ['', p] : [p.slice(0, i), p.slice(i + 1)];
}

function fileCell(path, rel) {
  const [dir, name] = splitPath(rel || path);
  return `<td class="cell-file" title="${esc(path)}"><span class="fname">${esc(name)}</span>${dir ? `<span class="fdir">${esc(dir)}</span>` : ''}</td>`;
}

function toast(msg, type = 'info', ms = 4500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'info')}<div>${esc(msg)}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

function setLoading(btn, on) {
  btn.classList.toggle('is-loading', on);
  btn.disabled = on;
}

const BADGES = {
  pronto: ['b-ok', 'Da caricare'],
  trasferito: ['b-mute', 'Già trasferito'],
  ripresa: ['b-info', 'Ripresa upload'],
  mancante: ['b-err', 'File mancante'],
  radice: ['b-warn', 'Senza cartella'],
  caricato: ['b-ok', 'Caricato'],
  saltato: ['b-mute', 'Saltato'],
  errore: ['b-err', 'Errore'],
  prova: ['b-info', 'Pronto'],
};
const badge = (s) => { const [c, l] = BADGES[s] || ['b-mute', s]; return `<span class="badge ${c}">${esc(l)}</span>`; };

// ------------------------------------------------------------------ aree: documenti e posta

// stesso programma, due aree: ogni voce del menu e ogni scheda della panoramica ha data-area
// (documenti, posta, comune); quelle dell'altra area le nasconde il CSS (body[data-area])
const AREAS = { documenti: 'Documenti', posta: 'Posta' };

function setArea(area, { go = true } = {}) {
  if (state.me && !isAdmin()) area = state.me.area;  // l'utente normale non cambia area
  if (!AREAS[area]) area = 'documenti';
  document.body.dataset.area = area;
  $$('.area-btn').forEach((b) => {
    const on = b.dataset.area === area;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on);
  });
  const label = $('#ovArea');
  if (label) label.textContent = AREAS[area];
  try { localStorage.setItem('vfp.area', area); } catch { /* storage non disponibile */ }
  // la pagina aperta e' dell'altra area: si torna alla panoramica della nuova
  const current = $('.tab.is-active');
  if (go && current && AREAS[current.dataset.area] && current.dataset.area !== area) showView('panoramica');
}

$$('.area-btn').forEach((b) => b.addEventListener('click', () => setArea(b.dataset.area)));
try { setArea(localStorage.getItem('vfp.area') || 'documenti', { go: false }); } catch { setArea('documenti', { go: false }); }

// ------------------------------------------------------------------ navigazione

function showView(name) {
  // l'utente vede solo le pagine per tutti (voci di menu con data-tutti: Panoramica, Confronta documenti)
  if (!isAdmin() && !$(`.tab[data-view="${name}"][data-tutti]`)) name = 'panoramica';
  // un collegamento verso una pagina dell'altra area (es. "Vai al flusso posta") cambia area da solo
  const target = $(`.tab[data-view="${name}"]`);
  if (target && AREAS[target.dataset.area] && target.dataset.area !== document.body.dataset.area) {
    setArea(target.dataset.area, { go: false });
  }
  $$('.tab').forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', on);
  });
  $$('.view').forEach((v) => {
    const on = v.id === `view-${name}`;
    v.hidden = !on;
    v.classList.toggle('is-active', on);
  });
  if (name === 'storico') loadReport();
  if (name === 'smistamento') aiPoll();
  if (name === 'attivita') loadActivity();
  if (name === 'posta' || name === 'flusso') loadMail();
  if (name === 'panoramica') loadOverview();
  if (name === 'confronto') loadConfronto();
  if (name === 'impostazioni') { loadAuth(); loadMailLog(); loadUsers(); loadHealth(); }
  window.scrollTo({ top: 0 });
}

$$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) {
    e.preventDefault();
    showView(g.dataset.goto);
    if (g.dataset.anchor) setTimeout(() => $(`#${g.dataset.anchor}`).scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
});

// oggetto da mostrare: senza "POSTA CERTIFICATA:" (lo dice gia' l'etichetta PEC); l'originale va nel title
const cleanSubject = (s) => String(s || '').replace(/^\s*posta\s+certificata\s*:\s*/i, '').trim();
const subjHtml = (s) => {
  const full = String(s || '');
  const short = cleanSubject(full);
  return short ? `<span title="${esc(full)}">${esc(short)}</span>` : '<span class="muted">(senza oggetto)</span>';
};
const subjText = (s) => cleanSubject(s) || '(senza oggetto)';

// porta a un campo delle impostazioni (o di un'altra pagina), lo mostra e lo evidenzia per un attimo
function focusField(el, { focus = false } = {}) {
  if (!el) return;
  const view = el.closest('.view');
  if (view && view.hidden) showView(view.id.replace('view-', ''));
  const adv = el.closest('details');
  if (adv) adv.open = true;
  const box = el.closest('.field, .toggle, .mailbox, .radio-cards, .mode-switch') || el;
  setTimeout(() => {
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.remove('undo-flash');
    void box.offsetWidth;  // riavvia l'animazione
    box.classList.add('undo-flash');
    if (focus && el.focus) el.focus({ preventScroll: true });
  }, 30);
}

// tempo relativo ("3 giorni fa") con la data completa da mostrare al passaggio del mouse
function fmtAgo(ts) {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d)) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${h === 1 ? 'ora' : 'ore'} fa`;
  const g = Math.round(h / 24);
  if (g < 30) return `${g} ${g === 1 ? 'giorno' : 'giorni'} fa`;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
const fmtFull = (ts) => {
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return ts && !isNaN(d) ? d.toLocaleString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
};

// gruppo di pulsanti "chip": uno attivo alla volta, il valore va in state[key]
function bindChips(groupSel, key, render) {
  $(groupSel).addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $$('.chip', $(groupSel)).forEach((x) => x.classList.toggle('is-active', x === c));
    state[key] = c.dataset.f;
    render();
  });
}
