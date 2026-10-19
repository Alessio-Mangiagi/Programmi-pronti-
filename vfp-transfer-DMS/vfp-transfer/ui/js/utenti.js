// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: utente collegato, attivita', tema, invio report, utenti.
'use strict';

// ------------------------------------------------------------------ utente collegato e uscita

async function loadSession() {
  state.me = await api('/api/session');
  document.body.classList.toggle('role-user', !isAdmin());
  if (!isAdmin()) setArea(state.me.area, { go: false });  // l'utente normale vede solo la sua area
  $('#meName').textContent = state.me.user;
  $('#meRole').textContent = state.me.role_label;
  let saved = '';
  try { saved = localStorage.getItem('vfp.sendTo') || ''; } catch { /* storage non disponibile */ }
  $('#sendTo').value = saved || state.me.email || '';
}

$('#btnSignOut').addEventListener('click', async () => {
  if (state.dirty && !(await confirmDialog({ title: 'Uscire senza salvare?', html: '<p>Ci sono impostazioni modificate non salvate.</p>', okText: 'Esci' }))) return;
  state.dirty = false;
  try { await api('/api/session/logout', { method: 'POST' }); } catch { /* si esce comunque */ }
  window.location.replace('/login.html');
});

// ------------------------------------------------------------------ attivita' degli utenti (solo amministratori)

const ACT_OUTCOME = { ok: ['b-ok', 'Riuscita'], fallito: ['b-err', 'Non riuscita'], negato: ['b-warn', 'Negata'] };
const ACT_CAT = { accesso: 'Accessi', modifica: 'Modifiche', trasferimento: 'Trasferimenti', report: 'Report', sicurezza: 'Sicurezza' };
const ROLE_LABEL = { admin: 'Amministratore', utente: 'Utente' };

function actParams() {
  const p = new URLSearchParams({ days: state.actDays });
  if (state.actCat) p.set('cat', state.actCat);
  if ($('#actUser').value) p.set('user', $('#actUser').value);
  if ($('#actOutcome').value) p.set('esito', $('#actOutcome').value);
  if ($('#actSearch').value.trim()) p.set('q', $('#actSearch').value.trim());
  return p;
}

async function loadActivity() {
  clearTimeout(state.actTimer);
  let d;
  try { d = await api(`/api/activity?${actParams()}`); } catch (e) { toast(e.message, 'err'); return; }
  state.act = d;
  renderActivity();
  if (!$('#view-attivita').hidden) state.actTimer = setTimeout(loadActivity, 10000);
}

function renderActivity() {
  const d = state.act;
  const s = d.stats;
  $('#actOnline').textContent = fmtNum(s.online);
  $('#actOnlineSub').textContent = d.sessions.length ? `${fmtNum(d.sessions.length)} ${d.sessions.length === 1 ? 'sessione' : 'sessioni'}` : 'nessuno';
  $('#actLogins').textContent = fmtNum(s.logins_today);
  $('#actFailed').textContent = fmtNum(s.failed_24h + s.denied_24h);
  $('#actFailedSub').textContent = `${fmtNum(s.failed_24h)} accessi falliti, ${fmtNum(s.denied_24h)} funzioni negate`;
  $('#actFailCard').classList.toggle('has-items', s.failed_24h + s.denied_24h > 0);
  $('#actChanges').textContent = fmtNum(s.changes_today);
  $('#actIntegrity').hidden = d.integrity.ok;
  $('#actIntegrityText').textContent = d.integrity.ok ? '' : `La catena delle impronte non torna dalla riga ${d.integrity.broken_at}: qualcuno ha modificato o tolto delle righe dal file del registro.`;
  $('#actAlert').hidden = d.integrity.ok && s.failed_24h + s.denied_24h === 0;

  $('#actSessCount').textContent = `${fmtNum(d.sessions.length)} attive`;
  $('#actSessions').innerHTML = d.sessions.map((x) => `<tr data-sid="${esc(x.id)}">
      <td><strong>${esc(x.user)}</strong>${x.mine ? '<span class="badge b-info me-tag">tu</span>' : ''}<span class="fdir">${esc(ROLE_LABEL[x.role] || x.role)}</span></td>
      <td class="nowrap mono small">${fmtWhen(x.created)}</td>
      <td class="nowrap mono small">${fmtWhen(x.seen)}</td>
      <td class="num">${x.mine ? '' : '<button class="btn btn-danger-outline btn-sm" type="button" data-act="close"><svg class="ic"><use href="#i-x"/></svg>Disconnetti</button>'}</td>
    </tr>`).join('');
  $('#actSessEmpty').hidden = d.sessions.length > 0;

  $('#actUsers').innerHTML = d.users.map((u) => `<tr>
      <td><span class="online-dot ${u.online ? 'on' : ''}" title="${u.online ? 'Collegato' : 'Non collegato'}"></span><strong>${esc(u.name)}</strong></td>
      <td class="small">${esc(u.role_label)}</td>
      <td class="nowrap mono small">${u.last_login ? fmtWhen(u.last_login) : 'mai'}</td>
      <td class="nowrap mono small">${u.last_activity ? fmtWhen(u.last_activity) : '—'}</td>
    </tr>`).join('');

  const sel = $('#actUser');
  const cur = sel.value;
  const names = [...new Set([...d.users.map((u) => u.name), ...d.events.map((e) => e.u)])].filter(Boolean).sort();
  sel.innerHTML = '<option value="">Tutti gli utenti</option>' + names.map((n) => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');

  $('#actBody').innerHTML = d.events.map((e) => {
    const [cls, label] = ACT_OUTCOME[e.o] || ['b-mute', e.o];
    return `<tr class="${e.o !== 'ok' ? 'act-problem' : ''}">
      <td class="nowrap mono small">${fmtWhen(e.t)}</td>
      <td><strong>${esc(e.u || '—')}</strong>${e.r ? `<span class="fdir">${esc(ROLE_LABEL[e.r] || e.r)}</span>` : ''}</td>
      <td class="small">${esc(ACT_CAT[e.c] || e.c)}</td>
      <td>${esc(e.a)}</td>
      <td class="cell-msg">${esc(e.d)}</td>
      <td><span class="badge ${cls}">${esc(label)}</span></td>
    </tr>`;
  }).join('');
  $('#actEmpty').hidden = d.events.length > 0;
  $('#actCount').textContent = d.total > d.events.length
    ? `${fmtNum(d.total)} eventi, mostrati i ${fmtNum(d.events.length)} più recenti (nel file Excel ci sono tutti)`
    : `${fmtNum(d.total)} eventi`;
  $('#actXlsx').href = `/api/activity.xlsx?${actParams()}`;
}

bindChips('#actCat', 'actCat', loadActivity);
bindChips('#actDays', 'actDays', loadActivity);
['#actUser', '#actOutcome'].forEach((s) => $(s).addEventListener('change', loadActivity));
let actSearchTimer = null;
$('#actSearch').addEventListener('input', () => { clearTimeout(actSearchTimer); actSearchTimer = setTimeout(loadActivity, 300); });
$('#actReload').addEventListener('click', loadActivity);

$('#actSessions').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act=close]');
  if (!b) return;
  const tr = b.closest('tr');
  const name = $('strong', tr).textContent;
  const ok = await confirmDialog({ title: `Disconnettere ${name}?`, html: '<p>La sessione viene chiusa subito: per continuare dovrà accedere di nuovo.</p>', okText: 'Disconnetti' });
  if (!ok) return;
  try {
    await api('/api/activity/session-close', { method: 'POST', body: { id: tr.dataset.sid } });
    toast(`Sessione di ${name} chiusa.`, 'ok');
    loadActivity();
  } catch (ex) { toast(ex.message, 'err'); }
});

// ------------------------------------------------------------------ tema chiaro / scuro

function updateThemeButton() {
  const light = document.documentElement.dataset.theme === 'light';
  const label = light ? 'Tema scuro' : 'Tema chiaro';
  $('#btnTheme').title = label;
  $('#btnTheme').setAttribute('aria-label', label);
}

$('#btnTheme').addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  if (light) document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('vfp.theme', light ? 'light' : 'dark'); } catch { /* storage non disponibile */ }
  updateThemeButton();
});
updateThemeButton();

// ------------------------------------------------------------------ invio del report via email

bindChips('#sendPeriod', 'sendDays', () => {});

$('#sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const to = $('#sendTo').value.trim();
  const out = $('#sendResult');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    $('#sendTo').classList.add('is-invalid');
    out.hidden = false; out.className = 'send-result err'; out.textContent = 'Scrivi un indirizzo email valido.';
    $('#sendTo').focus();
    return;
  }
  $('#sendTo').classList.remove('is-invalid');
  const btn = $('#sendBtn');
  setLoading(btn, true);
  out.hidden = true;
  try {
    const r = await api('/api/report/send', { method: 'POST', body: { email: to, days: state.sendDays } });
    try { localStorage.setItem('vfp.sendTo', to); } catch { /* storage non disponibile */ }
    out.className = 'send-result';
    out.textContent = `Report inviato a ${r.to.filter((x, i, a) => a.indexOf(x) === i).join(' e ')}.`;
    out.hidden = false;
  } catch (ex) {
    out.className = 'send-result err';
    out.textContent = ex.message;
    out.hidden = false;
  } finally {
    setLoading(btn, false);
  }
});

$('#btnSendTest').addEventListener('click', async () => {
  if (state.dirty && !(await saveSettings())) return;
  const b = $('#btnSendTest');
  const out = $('#sendTestResult');
  setLoading(b, true);
  out.hidden = false; out.className = 'test-result'; out.textContent = 'Invio in corso…';
  try {
    const r = await api('/api/notify/test', { method: 'POST' });
    out.classList.add('ok'); out.textContent = r.message;
  } catch (ex) {
    out.classList.add('err'); out.textContent = ex.message;
  } finally {
    setLoading(b, false);
  }
});

// ------------------------------------------------------------------ utenti (solo amministratori)

async function loadUsers() {
  try { renderUsers(await api('/api/users')); } catch (e) { toast(e.message, 'err'); }
}

function renderUsers(d) {
  state.users = d.users;
  $('#usersHint').textContent = `Password di almeno ${d.min_password} caratteri. Chi cambia ruolo o password deve rientrare.`;
  $('#usersBody').innerHTML = d.users.map((u) => {
    const me = u.name === state.me.user;
    const roles = Object.entries(d.roles).map(([k, l]) => `<option value="${esc(k)}" ${k === u.role ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const areas = Object.entries(d.areas).map(([k, l]) => `<option value="${esc(k)}" ${k === u.area ? 'selected' : ''}>${esc(l)}</option>`).join('');
    // l'amministratore vede tutte le aree: l'area conta solo per gli utenti normali
    const area = u.role === 'admin' ? '<span class="muted small">Tutte</span>'
      : `<select data-act="area" aria-label="Area di ${esc(u.name)}">${areas}</select>`;
    return `<tr data-user="${esc(u.name)}">
      <td><strong>${esc(u.name)}</strong>${me ? '<span class="badge b-info me-tag">tu</span>' : ''}</td>
      <td><select data-act="role" aria-label="Ruolo di ${esc(u.name)}" ${me ? 'disabled' : ''}>${roles}</select></td>
      <td>${area}</td>
      <td class="small">${esc(u.email || '—')}</td>
      <td class="nowrap mono small">${u.last_login ? fmtWhen(u.last_login) : 'mai'}</td>
      <td class="num"><span class="user-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-act="password"><svg class="ic"><use href="#i-key"/></svg>Password</button>
        ${me ? '' : '<button class="btn btn-danger-outline btn-sm" type="button" data-act="delete"><svg class="ic"><use href="#i-x"/></svg>Elimina</button>'}
      </span></td>
    </tr>`;
  }).join('');
}

async function userAction(body, okMsg) {
  try {
    renderUsers(await api('/api/users', { method: 'POST', body }));
    toast(okMsg, 'ok');
    return true;
  } catch (e) {
    toast(e.message, 'err', 7000);
    loadUsers();
    return false;
  }
}

$('#usersBody').addEventListener('change', (e) => {
  const sel = e.target.closest('[data-act=role], [data-act=area]');
  if (!sel) return;
  const name = sel.closest('tr').dataset.user;
  if (sel.dataset.act === 'area') {
    userAction({ action: 'update', name, area: sel.value }, `${name} ora vede l'area ${sel.selectedOptions[0].textContent}.`);
  } else {
    userAction({ action: 'update', name, role: sel.value }, `Ruolo di ${name} aggiornato.`);
  }
});

$('#usersBody').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const name = b.closest('tr').dataset.user;
  if (b.dataset.act === 'delete') {
    const ok = await confirmDialog({ title: `Eliminare ${name}?`, html: '<p>L’utente non potrà più accedere al programma.</p>', okText: 'Elimina' });
    if (ok) userAction({ action: 'delete', name }, `Utente ${name} eliminato.`);
  } else if (b.dataset.act === 'password') {
    const ok = await confirmDialog({
      title: `Nuova password per ${name}`,
      html: '<div class="field"><label for="pwNew">Nuova password</label><input id="pwNew" type="password" autocomplete="new-password"></div>',
      okText: 'Salva password',
    });
    const pw = ($('#pwNew') || {}).value || '';
    if (ok) userAction({ action: 'password', name, password: pw }, `Password di ${name} aggiornata.`);
  }
});

const syncAreaField = () => { $('#uaAreaField').hidden = $('#uaRole').value === 'admin'; };
$('#uaRole').addEventListener('change', syncAreaField);
syncAreaField();

$('#userAdd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { action: 'add', name: $('#uaName').value.trim(), role: $('#uaRole').value, area: $('#uaArea').value, email: $('#uaEmail').value.trim(), password: $('#uaPass').value };
  if (await userAction(body, `Utente ${body.name} creato.`)) {
    ['#uaName', '#uaEmail', '#uaPass'].forEach((s) => { $(s).value = ''; });
  }
});
