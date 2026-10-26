// "><(((º> sabusabu <º)))><"
// Registro accessi (solo admin). La gestione utenti sta in /utenti (utenti.js).
function fmtData(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' +
         d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
const AZIONE_LABEL = { avvia: 'Avvio', apri: 'Apertura', login: 'Login portale', abilita: 'Abilitazioni' };

let accessi = [];

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

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

loadMe();
loadAccessi();
