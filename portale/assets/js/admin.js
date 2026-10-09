function fmtData(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' +
         d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
const AZIONE_LABEL = { avvia: 'Avvio', apri: 'Apertura', login: 'Login portale', abilita: 'Abilitazioni' };

let accessi = [];
let assegnabili = [];   // programmi assegnabili: [{ id, nome, riservata }]

async function loadMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) { window.location.href = '/login'; return; }
  const me = await r.json();
  if (me.mustChange) { window.location.href = '/password'; return; }
  document.getElementById('userName').textContent = me.nome;
  document.getElementById('avatar').textContent = iniz(me.nome);
}

async function loadAccessi() {
  const r = await fetch('/api/accessi');
  if (!r.ok) { toast('Accesso negato'); return; }
  const data = await r.json();
  accessi = data.accessi || [];
  populateFilters();
  renderStats();
  renderLog();
}

function populateFilters() {
  const fUtente = document.getElementById('fUtente');
  const fApp = document.getElementById('fApp');
  const utenti = [...new Map(accessi.map(a => [a.username, a.nome])).entries()];
  fUtente.innerHTML = '<option value="">Tutti gli utenti</option>' +
    utenti.map(([u, n]) => `<option value="${esc(u)}">${esc(n || u)}</option>`).join('');
  const apps = [...new Map(accessi.filter(a => a.appId).map(a => [a.appId, a.appNome])).entries()];
  fApp.innerHTML = '<option value="">Tutti i programmi</option>' +
    apps.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
}

function renderStats() {
  const totale = accessi.length;
  const utentiUnici = new Set(accessi.map(a => a.username)).size;
  const avvii = accessi.filter(a => a.azione === 'avvia' || a.azione === 'apri');
  const conteggio = {};
  avvii.forEach(a => { conteggio[a.appNome] = (conteggio[a.appNome] || 0) + 1; });
  let topApp = '—', topN = 0;
  for (const [k, v] of Object.entries(conteggio)) if (v > topN) { topApp = k; topN = v; }
  const oggi = new Date().toDateString();
  const accessiOggi = accessi.filter(a => new Date(a.ts).toDateString() === oggi).length;

  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="label">Accessi totali</div><div class="value">${totale}</div></div>
    <div class="stat"><div class="label">Utenti registrati attivi</div><div class="value">${utentiUnici}</div></div>
    <div class="stat"><div class="label">Accessi oggi</div><div class="value"><span class="accent">${accessiOggi}</span></div></div>
    <div class="stat"><div class="label">Programma più usato</div><div class="value small">${esc(topApp)}${topN ? ` · ${topN}` : ''}</div></div>
  `;
}

function renderLog() {
  const u = document.getElementById('fUtente').value;
  const app = document.getElementById('fApp').value;
  const az = document.getElementById('fAzione').value;
  const rows = accessi.filter(a =>
    (!u || a.username === u) && (!app || a.appId === app) && (!az || a.azione === az));

  const body = document.getElementById('logBody');
  const empty = document.getElementById('logEmpty');
  if (!rows.length) { body.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  body.innerHTML = rows.map(a => `
    <tr>
      <td class="muted">${esc(fmtData(a.ts))}</td>
      <td><div class="who"><span class="av">${esc(iniz(a.nome))}</span><span>${esc(a.nome || a.username)}</span></div></td>
      <td>${a.appNome ? esc(a.appNome) : '<span class="muted">— (portale)</span>'}</td>
      <td><span class="badge ${esc(a.azione)}"><span class="dot"></span>${esc(AZIONE_LABEL[a.azione] || a.azione)}</span></td>
    </tr>
  `).join('');
}

['fUtente', 'fApp', 'fAzione'].forEach(id => document.getElementById(id).addEventListener('change', renderLog));

// ---- Utenti ----
async function loadUtenti() {
  const r = await fetch('/api/utenti');
  if (!r.ok) return;
  const data = await r.json();
  assegnabili = data.assegnabili || [];
  const body = document.getElementById('userBody');
  body.innerHTML = (data.utenti || []).map(u => `
    <tr>
      <td><div class="who"><span class="av">${esc(iniz(u.nome))}</span><span>${esc(u.nome)}</span></div></td>
      <td class="muted">${esc(u.username)}</td>
      <td>${u.ruolo === 'admin' ? '<span class="badge avvia"><span class="dot"></span>Admin</span>' : '<span class="muted">Utente</span>'}</td>
      <td>${celleAccessi(u)}</td>
      <td class="num"><button class="btn-ghost" data-del="${esc(u.username)}">Elimina</button></td>
    </tr>
  `).join('');
  body.querySelectorAll('[data-app]').forEach(c => c.addEventListener('change', () => salvaAccessi(c.dataset.user)));
  renderAppsForm();
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delUtente(b.dataset.del)));
}

// Caselle di una riga utente: un programma per casella. Un admin entra ovunque
// per ruolo, quindi le sue caselle non si spuntano: si dice perché.
function celleAccessi(u) {
  if (!assegnabili.length) return '<span class="muted">—</span>';
  if (u.ruolo === 'admin') return '<span class="muted">tutti (admin)</span>';
  const suoi = u.apps || [];
  return '<div class="accessi">' + assegnabili.map(a => `
    <label class="chk${a.riservata ? ' chk-riservata' : ''}" title="${esc(a.riservata ? a.nome + ' — programma riservato' : a.nome)}">
      <input type="checkbox" data-app="${esc(a.id)}" data-user="${esc(u.username)}"
             ${suoi.includes(a.id) ? 'checked' : ''} />
      <span>${esc(a.nome)}${a.riservata ? ' <span class="lucchetto" aria-hidden="true">riservato</span>' : ''}</span>
    </label>
  `).join('') + '</div>';
}

// Le caselle spuntate di quell'utente sono l'elenco completo: il PUT sostituisce.
async function salvaAccessi(username) {
  const apps = [...document.querySelectorAll(`#userBody [data-user="${CSS.escape(username)}"]:checked`)]
    .map(c => c.dataset.app);
  const r = await fetch('/api/utenti/' + encodeURIComponent(username) + '/apps', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apps }),
  });
  const data = await r.json().catch(() => ({}));
  if (data.ok) toast(apps.length ? username + ': ' + apps.length + ' programmi visibili' : username + ': nessun programma visibile');
  else { toast(data.error || 'Errore'); loadUtenti(); }
}

// Stesse caselle nel form di creazione, spuntate come il default (tutti i
// programmi tranne quelli riservati): così il caso normale è già pronto e si
// toglie o si aggiunge solo l'eccezione.
function renderAppsForm() {
  const fld = document.getElementById('nAppsFld');
  const box = document.getElementById('nApps');
  fld.hidden = !assegnabili.length;
  if (!assegnabili.length) return;
  box.innerHTML = assegnabili.map(a => `
    <label class="chk${a.riservata ? ' chk-riservata' : ''}">
      <input type="checkbox" data-new-app="${esc(a.id)}" ${a.riservata ? '' : 'checked'} />
      <span>${esc(a.nome)}${a.riservata ? ' <span class="lucchetto" aria-hidden="true">riservato</span>' : ''}</span>
    </label>
  `).join('');
}

async function delUtente(username) {
  if (!confirm(`Eliminare l'utente "${username}"?`)) return;
  const r = await fetch('/api/utenti/' + encodeURIComponent(username), { method: 'DELETE' });
  const data = await r.json();
  if (data.ok) { toast('Utente eliminato'); loadUtenti(); }
  else toast(data.error || 'Errore');
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('formMsg');
  msg.textContent = ''; msg.className = 'form-msg';
  const payload = {
    username: document.getElementById('nUsername').value,
    nome: document.getElementById('nNome').value,
    password: document.getElementById('nPassword').value,
    ruolo: document.getElementById('nRuolo').value,
    apps: [...document.querySelectorAll('#nApps [data-new-app]:checked')].map(c => c.dataset.newApp),
  };
  const r = await fetch('/api/utenti', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await r.json();
  if (data.ok) {
    msg.textContent = 'Utente aggiunto. Dovrà impostare la propria password al primo accesso.'; msg.className = 'form-msg ok';
    e.target.reset();
    loadUtenti();
  } else {
    msg.textContent = data.error || 'Errore'; msg.className = 'form-msg ko';
  }
});

// ---- Import da foglio Excel / CSV ----
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function renderImportResult(data) {
  const res = document.getElementById('impResult');
  const scartati = data.scartati || [];
  let html = `<div class="imp-summary"><span class="ok">${data.aggiunti} utenti importati</span>`;
  if (scartati.length) html += ` · <span class="ko">${scartati.length} righe scartate</span>`;
  html += '</div>';
  if (scartati.length) {
    html += '<table class="imp-table"><thead><tr><th>Riga</th><th>Username</th><th>Motivo</th></tr></thead><tbody>' +
      scartati.map(s => `<tr><td>${esc(s.riga)}</td><td>${esc(s.username || '—')}</td><td>${esc(s.motivo)}</td></tr>`).join('') +
      '</tbody></table>';
  }
  res.innerHTML = html;
}

document.getElementById('impBtn').addEventListener('click', async () => {
  const fileEl = document.getElementById('impFile');
  const res = document.getElementById('impResult');
  const file = fileEl.files[0];
  if (!file) { res.innerHTML = '<span class="ko">Seleziona un file .xlsx o .csv.</span>'; return; }
  res.textContent = 'Lettura file…';
  try {
    const dataBase64 = await fileToBase64(file);
    const defaultPassword = document.getElementById('impDefaultPw').value;
    const r = await fetch('/api/utenti/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, dataBase64, defaultPassword }),
    });
    const data = await r.json();
    if (!data.ok) { res.innerHTML = `<span class="ko">${esc(data.error || 'Errore')}</span>`; return; }
    renderImportResult(data);
    toast(`${data.aggiunti} utenti importati`);
    fileEl.value = '';
    loadUtenti();
  } catch {
    res.innerHTML = '<span class="ko">Errore nella lettura del file.</span>';
  }
});

document.getElementById('downloadModello').addEventListener('click', () => {
  const csv = 'username;nome;password;ruolo\r\n' +
    'mrossi;Mario Rossi;;utente\r\n' +
    'gverdi;Giulia Verdi;;admin\r\n';
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'modello-utenti.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

loadMe();
loadAccessi();
loadUtenti();
