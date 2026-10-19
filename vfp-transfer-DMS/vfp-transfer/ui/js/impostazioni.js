// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: impostazioni salvate nel file .env.
'use strict';

// ------------------------------------------------------------------ configurazione (file .env)

const IF_EXISTS_LABEL = { new_revision: 'Aggiungi revisione', skip: 'Salta' };
const TARGET_LABEL = { project: 'Progetto', folder: 'Cartella' };
const isTrue = (v) => ['1', 'true', 'si', 'sì', 'yes', 'on'].includes(String(v).trim().toLowerCase());

async function loadConfig() {
  const data = await api('/api/config');
  state.env = data.env;
  fillSettings(data);
  applyConfigSummary(data);
}

function applyConfigSummary({ env, problems }) {
  $('#sumTarget').textContent = TARGET_LABEL[env.VFP_TARGET_TYPE] || env.VFP_TARGET_TYPE;
  $('#sumTargetId').textContent = /^[0-]*$/.test(env.VFP_TARGET_ID || '') ? 'non impostato' : env.VFP_TARGET_ID;
  $('#sumIfExists').textContent = IF_EXISTS_LABEL[env.VFP_IF_EXISTS] || env.VFP_IF_EXISTS;
  $('#mpDoneFolder').textContent = env.MAIL_DONE_FOLDER || 'Trasferite a VFP';
  const has = problems && problems.length;
  $('#configBanner').hidden = !has;
  $('#settingsBadge').hidden = !has;
  if (has) $('#configBannerText').textContent = problems.join('. ') + '.';
  state.problems = problems || [];
  if (state.preview) updateSide();
}

function fillSettings({ env, from_os, mail_warnings, send_problems }) {
  const sec = [...(mail_warnings || []), ...(send_problems || []).map((x) => `invio email: ${x}`)];
  if (send_problems && send_problems.length) sec.unshift('finché l’invio email non è configurato, le modifiche a utenti e credenziali NON chiedono il codice all’amministratore');
  $('#secBanner').hidden = !sec.length;
  $('#secBannerList').innerHTML = sec.map((x) => {
    const key = secField(x);
    const text = x.charAt(0).toUpperCase() + x.slice(1);
    return `<li>${esc(text)}${key ? ` <button type="button" class="btn-link" data-field="${esc(key)}">Vai al campo</button>` : ''}</li>`;
  }).join('');
  $$('[data-env]').forEach((el) => {
    const v = env[el.dataset.env] ?? '';
    if (el.type === 'checkbox') el.checked = isTrue(v);
    else if (el.type === 'radio') el.checked = el.value === v;
    else el.value = el.hasAttribute('data-list') ? v.split(/[\s,;]+/).filter(Boolean).join(',\n') : v;
  });
  // i JSON vuoti si mostrano come campo vuoto
  if (['{}', ''].includes(($('#cfgDefaults').value || '').trim())) $('#cfgDefaults').value = '';
  const sources = (env.MAIL_SOURCES || '').split(',').map((x) => x.trim().toLowerCase());
  $$('[data-source]').forEach((el) => {
    el.checked = sources.includes(el.dataset.source);
    el.closest('.mailbox').classList.toggle('is-on', el.checked);
  });
  $('#smtpFields').hidden = env.REPORT_SEND_METHOD === 'graph';
  $('#fromOsBanner').hidden = !(from_os && from_os.length);
  $('#fromOsList').textContent = (from_os || []).join(', ');
  $$('.test-result').forEach((r) => { r.hidden = true; });
  markChanges();
  validateAll(true);
  undoReset();  // valori appena letti dal .env: si riparte senza passi da annullare
}

function setDirty(on, n = 0) {
  state.dirty = on;
  $('.save-bar').classList.toggle('dirty', on);
  $('#saveStatus').textContent = !on ? 'Nessuna modifica'
    : n ? `${n} ${n === 1 ? 'modifica non salvata' : 'modifiche non salvate'}` : 'Modifiche non salvate';
}

// campo dell'impostazione nominata in un avviso: "(SMTP_HOST)" nel testo, oppure parole chiave
function secField(text) {
  const m = /\(([A-Z][A-Z0-9_]+)\)/.exec(text);
  if (m && $(`[data-env="${m[1]}"]`)) return m[1];
  const t = text.toLowerCase();
  if (t.includes('mittenti autorizzati')) return 'MAIL_ALLOWED_SENDERS';
  if (t.includes('antivirus')) return 'MAIL_ANTIVIRUS';
  if (t.includes('spf') || t.includes('dmarc')) return 'MAIL_REQUIRE_AUTH';
  if (t.includes('amministratore') && t.includes('email')) return 'ADMIN_EMAIL';
  if (t.includes('codice')) return 'ADMIN_EMAIL';
  return '';
}

$('#secBannerList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-field]');
  if (b) focusField($(`[data-env="${b.dataset.field}"]`), { focus: true });
});

// ---- campi modificati rispetto al .env: segnati in giallo e contati nella barra di salvataggio

const listNorm = (v) => String(v || '').split(/[\s,;]+/).filter(Boolean).join(',');

function markChanges() {
  if (!state.env) return 0;
  const changed = new Set();
  $$('#view-impostazioni .is-changed').forEach((x) => x.classList.remove('is-changed'));
  $$('[data-env]').forEach((el) => {
    const k = el.dataset.env;
    let orig = state.env[k] ?? '', cur;
    if (el.type === 'radio') {
      if (!el.checked) return;
      cur = el.value;
    } else if (el.type === 'checkbox') {
      cur = el.checked; orig = isTrue(orig);
    } else if (el.hasAttribute('data-list')) {
      cur = listNorm(el.value); orig = listNorm(orig);
    } else if (k === 'VFP_DOCUMENT_DEFAULTS') {
      cur = el.value.trim() || '{}'; orig = String(orig).trim() || '{}';
    } else {
      cur = el.type === 'password' ? el.value : el.value.trim(); orig = String(orig);
    }
    if (cur === orig) return;
    changed.add(k);
    const box = el.closest('.field, .toggle');
    if (box) box.classList.add('is-changed');
  });
  const now = $$('[data-source]').filter((x) => x.checked).map((x) => x.dataset.source).sort().join(',');
  const was = (state.env.MAIL_SOURCES || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).sort().join(',');
  if (now !== was) {
    changed.add('MAIL_SOURCES');
    $$('[data-source]').forEach((x) => {
      if (was.split(',').includes(x.dataset.source) !== x.checked) x.closest('.toggle').classList.add('is-changed');
    });
  }
  setDirty(changed.size > 0, changed.size);
  return changed.size;
}

// ---- controllo dei campi mentre si scrive (lo stesso controllo lo rifa' il programma al salvataggio)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IP_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$|^::1?$/;
const isPort = (v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535;
const LIVE_CHECKS = {
  ADMIN_EMAIL: [(v) => EMAIL_RE.test(v), 'Indirizzo email non valido'],
  REPORT_FROM: [(v) => EMAIL_RE.test(v), 'Indirizzo email non valido'],
  GRAPH_MAILBOX: [(v) => EMAIL_RE.test(v), 'Indirizzo email non valido'],
  IMAP_HOST: [(v) => HOST_RE.test(v), 'Nome del server non valido (es. imaps.aruba.it, senza https://)'],
  PEC_HOST: [(v) => HOST_RE.test(v), 'Nome del server non valido (es. imaps.pec.aruba.it, senza https://)'],
  SMTP_HOST: [(v) => HOST_RE.test(v), 'Nome del server non valido (es. smtps.aruba.it, senza https://)'],
  GUI_HOSTNAME: [(v) => HOST_RE.test(v), 'Nome del server non valido'],
  IMAP_PORT: [isPort, 'Porta: un numero da 1 a 65535'],
  PEC_PORT: [isPort, 'Porta: un numero da 1 a 65535'],
  SMTP_PORT: [isPort, 'Porta: un numero da 1 a 65535'],
  GUI_PORT: [isPort, 'Porta: un numero da 1 a 65535'],
  GUI_BIND: [(v) => IP_RE.test(v) || v === 'localhost', 'Indirizzo IP: 127.0.0.1 (solo questo PC) oppure 0.0.0.0 (rete)'],
  MAIL_POLL_SECONDS: [(v) => /^\d+$/.test(v) && Number(v) >= 30, 'Almeno 30 secondi'],
  MAIL_MAX_ATTEMPTS: [(v) => /^\d+$/.test(v) && Number(v) >= 1, 'Un numero da 1 in su'],
  MAIL_MAX_MB: [(v) => /^\d+$/.test(v) && Number(v) >= 1, 'Un numero da 1 in su'],
  VFP_DOC_URL: [(v) => /^https:\/\/[^\s]+$/.test(v) && v.includes('{id}'), 'Serve un indirizzo https:// con {id} al posto dell\'ID del documento'],
  PEC_PROTOCOL_REGEX: [(v) => { try { new RegExp(v.replace(/\(\?P</g, '(?<')); return v.length <= 300; } catch { return false; } }, 'Espressione regolare non valida'],
};

function validateField(el, quiet = false) {
  const check = LIVE_CHECKS[el.dataset.env];
  if (!check) return true;
  const v = el.value.trim();
  const ok = !v || check[0](v);
  let msg = el.parentElement.querySelector('.field-error[data-live]');
  if (!ok && !quiet) {
    if (!msg) {
      msg = document.createElement('p');
      msg.className = 'field-error';
      msg.dataset.live = '1';
      el.insertAdjacentElement('afterend', msg);
    }
    msg.textContent = check[1];
  } else if (ok && msg) {
    msg.remove();
  }
  el.classList.toggle('is-invalid', !ok && !quiet);
  return ok;
}

function validateAll(quiet = false) {
  return $$('[data-env]').filter((el) => LIVE_CHECKS[el.dataset.env]).map((el) => validateField(el, quiet)).every(Boolean);
}

$('#view-impostazioni').addEventListener('focusout', (e) => {
  if (e.target.matches && e.target.matches('[data-env]')) validateField(e.target);
});

// ---- spiegazioni delle parole tecniche (icona "i" accanto all'etichetta)

const TIPS = {
  VFP_TARGET_ID: 'GUID: codice identificativo lungo (8-4-4-4-12 caratteri) del progetto o della cartella in Viewpoint. Si trova nell\'indirizzo della pagina del progetto.',
  VFP_CLIENT_ID: 'Codice dell\'applicazione registrata presso Trimble/Viewpoint per usare le API. Lo fornisce il supporto Viewpoint.',
  GRAPH_TENANT_ID: 'Tenant ID: codice dell\'azienda in Microsoft 365 (Entra ID). Lo trova l\'IT nel portale Azure.',
  GRAPH_CLIENT_ID: 'Client ID: codice dell\'app registrata in Azure per leggere la casella.',
  IMAP_HOST: 'IMAP: il sistema con cui i programmi di posta leggono una casella. Il server di solito inizia con imap o imaps.',
  PEC_HOST: 'Server IMAP della casella PEC, indicato dal gestore (es. imaps.pec.aruba.it).',
  SMTP_HOST: 'SMTP: il sistema con cui si inviano le email. Il server lo indica il fornitore della posta.',
  MAIL_REQUIRE_AUTH: 'SPF, DKIM e DMARC: controlli che il server di posta fa sul mittente. Se falliscono, il mittente potrebbe essere falso.',
  GUI_BIND: 'Indirizzo su cui il programma accetta collegamenti: 127.0.0.1 solo da questo PC, 0.0.0.0 da tutta la rete.',
  PEC_PROTOCOL_REGEX: 'Espressione regolare: un modo per descrivere un testo da cercare. Va scritta solo se le regole predefinite non riconoscono i vostri protocolli.',
};
const SOURCE_TIPS = { graph: 'Microsoft 365 letto tramite Microsoft Graph, il servizio di Microsoft per accedere alla posta aziendale.' };

function addTip(target, text) {
  if (!target || target.querySelector('.tip')) return;
  const t = document.createElement('span');
  t.className = 'tip';
  t.tabIndex = 0;
  t.setAttribute('role', 'note');
  t.setAttribute('aria-label', text);
  t.dataset.tip = text;
  t.textContent = 'i';
  target.appendChild(t);
}
Object.entries(TIPS).forEach(([k, text]) => {
  const el = $(`[data-env="${k}"]`);
  if (!el) return;
  const field = el.closest('.field');
  addTip(field ? $('label, .label', field) : el.closest('.toggle')?.lastElementChild, text);
});
Object.entries(SOURCE_TIPS).forEach(([k, text]) => addTip($(`[data-source="${k}"]`)?.closest('.toggle')?.lastElementChild, text));
addTip($('input[name=smtpSec]')?.closest('.field')?.querySelector('.label'), 'STARTTLS (porta 587) e SSL (porta 465) sono due modi di cifrare il collegamento al server: usare quello indicato dal fornitore.');

// ---- indice dei settori in alto: un clic porta al settore, si accende quello visibile

function buildSettingsIndex() {
  const nav = $('#setIndex');
  const sectors = $$('#view-impostazioni .set-sector');
  sectors.forEach((h, i) => { h.id = h.id || `settore-${i}`; });
  nav.innerHTML = sectors.map((h) => `<a href="#${h.id}" data-sector="${h.id}">${esc(h.childNodes[0].textContent.trim())}</a>`).join('');
}
buildSettingsIndex();

$('#setIndex').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-sector]');
  if (!a) return;
  e.preventDefault();
  $(`#${a.dataset.sector}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
});

window.addEventListener('scroll', () => {
  if ($('#view-impostazioni').hidden) return;
  let current = '';
  $$('#view-impostazioni .set-sector').forEach((h) => { if (h.getBoundingClientRect().top < 140) current = h.id; });
  $$('#setIndex a').forEach((a) => a.classList.toggle('is-active', a.dataset.sector === (current || $('#setIndex a')?.dataset.sector)));
}, { passive: true });

$('#view-impostazioni').addEventListener('input', (e) => {
  if (e.target.closest('#cardMailLog, #cardUsers, #protSubject')) return; // non sono impostazioni del .env
  markChanges();
  if (e.target.classList.contains('is-invalid')) validateField(e.target);
  if (e.target.dataset.env === 'REPORT_SEND_METHOD') $('#smtpFields').hidden = e.target.value === 'graph';
  const src = e.target.closest('[data-source]');
  if (src) src.closest('.mailbox').classList.toggle('is-on', src.checked);
});

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function collectSettings() {
  let ok = true;
  const targetId = $('#cfgTargetId').value.trim();
  const badId = targetId && !GUID_RE.test(targetId);
  $('#cfgTargetId').classList.toggle('is-invalid', badId);
  $('#errTargetId').hidden = !badId;
  if (badId) ok = false;

  const raw = $('#cfgDefaults').value.trim();
  let badJson = false;
  if (raw) {
    try {
      const extra = JSON.parse(raw);
      if (typeof extra !== 'object' || Array.isArray(extra) || extra === null) badJson = true;
    } catch { badJson = true; }
  }
  $('#cfgDefaults').classList.toggle('is-invalid', badJson);
  $('#errDefaults').hidden = !badJson;
  if (badJson) { ok = false; $('.advanced').open = true; }

  $$('[data-env][inputmode=numeric]').forEach((el) => {
    const bad = el.value.trim() !== '' && !/^\d+$/.test(el.value.trim());
    el.classList.toggle('is-invalid', bad);
    if (bad) ok = false;
  });
  if (!validateAll()) ok = false;
  if (!ok) return null;

  const env = {};
  $$('[data-env]').forEach((el) => {
    const k = el.dataset.env;
    if (el.type === 'checkbox') env[k] = el.checked ? 'true' : 'false';
    else if (el.type === 'radio') { if (el.checked) env[k] = el.value; }
    else if (el.hasAttribute('data-list')) env[k] = el.value.split(/[\s,;]+/).filter(Boolean).join(', ');
    else env[k] = el.type === 'password' ? el.value : el.value.trim();
  });
  env.VFP_DOCUMENT_DEFAULTS = raw || '{}';
  env.MAIL_SOURCES = $$('[data-source]').filter((el) => el.checked).map((el) => el.dataset.source).join(',');
  return env;
}

async function saveSettings() {
  const env = collectSettings();
  if (!env) { toast('Correggi i campi evidenziati.', 'err'); return false; }
  const btn = $('#btnSaveCfg');
  setLoading(btn, true);
  try {
    const data = await api('/api/config', { method: 'POST', body: { env } });
    state.env = data.env;
    fillSettings(data);
    applyConfigSummary(data);
    invalidatePreview();
    toast('Impostazioni salvate nel file .env.', 'ok');
    loadMail();
    return true;
  } catch (e) {
    toast(e.message, 'err');
    return false;
  } finally {
    setLoading(btn, false);
  }
}

$('#btnSaveCfg').addEventListener('click', saveSettings);

$$('[data-test]').forEach((b) => b.addEventListener('click', async () => {
  const kind = b.dataset.test;
  if (state.dirty && !(await saveSettings())) return;
  const out = $(`[data-result=${kind}]`);
  setLoading(b, true);
  out.hidden = false;
  out.className = 'test-result';
  out.textContent = 'Connessione in corso…';
  try {
    const r = await api('/api/mail/test', { method: 'POST', body: { kind } });
    out.classList.add(r.ok ? 'ok' : 'err');
    out.textContent = r.message;
  } catch (e) {
    out.classList.add('err');
    out.textContent = e.message;
  } finally {
    setLoading(b, false);
  }
}));

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});
