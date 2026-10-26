// "><(((º> sabusabu <º)))><"
// Pagina Utenti (solo admin): elenco con ricerca e filtro, e le finestre per
// creare, importare da Excel, cambiare password, scegliere i programmi.
// Disattiva/Riattiva ed Elimina chiedono conferma e agiscono subito.
// API: /api/utenti (GET, POST), /api/utenti/import, /api/utenti/<u>/password,
// /api/utenti/<u>/attivo, /api/utenti/<u>/apps, DELETE /api/utenti/<u>.

let utenti = [];
let assegnabili = [];   // programmi con casella: [{ id, nome, riservata }]
let me = null;

const $ = (id) => document.getElementById(id);
const json = (r) => r.json().catch(() => ({}));
const invia = (metodo, url, corpo) => fetch(url, {
  method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(json);

function data(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function loadMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) { window.location.href = '/login'; return false; }
  me = await r.json();
  if (me.mustChange) { window.location.href = '/password'; return false; }
  $('userName').textContent = me.nome;
  $('avatar').textContent = iniz(me.nome);
  return true;
}

async function caricaUtenti() {
  const r = await fetch('/api/utenti');
  if (r.status === 403) { window.location.href = '/'; return; }
  const d = await json(r);
  utenti = (d.utenti || []).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  assegnabili = d.assegnabili || [];
  renderNumeri();
  renderRighe();
}

function renderNumeri() {
  const admin = utenti.filter((u) => u.ruolo === 'admin').length;
  $('kTot').textContent = utenti.length;
  $('kAdmin').textContent = admin === 1 ? '1 amministratore' : admin + ' amministratori';
  $('kAttivi').textContent = utenti.filter((u) => u.attivo).length;
  $('kCambio').textContent = utenti.filter((u) => u.attivo && u.mustChange).length;
  $('kOff').textContent = utenti.filter((u) => !u.attivo).length;
}

function stato(u) {
  if (!u.attivo) return '<span class="st off">Disattivato</span>';
  if (u.mustChange) return '<span class="st cambio" title="Al prossimo accesso dovrà scegliere una sua password">Password da cambiare</span>';
  return '<span class="st ok">Attivo</span>';
}

// Un admin vede tutto per ruolo: niente caselle, lo si dice e basta.
function programmi(u) {
  if (u.ruolo === 'admin') return '<span class="tu">Tutti (admin)</span>';
  const n = (u.apps || []).length;
  return `<button type="button" class="progr" data-apps="${esc(u.username)}">${n === 1 ? '1 programma' : n + ' programmi'}</button>`;
}

function renderRighe() {
  const q = $('cerca').value.trim().toLowerCase();
  const f = $('fStato').value;
  const righe = utenti.filter((u) =>
    (!q || u.nome.toLowerCase().includes(q) || u.username.includes(q)) &&
    (!f || (f === 'attivo' && u.attivo) || (f === 'off' && !u.attivo) ||
      (f === 'cambio' && u.attivo && u.mustChange) || (f === 'admin' && u.ruolo === 'admin')));
  $('vuoto').hidden = righe.length > 0;
  $('righe').innerHTML = righe.map((u) => {
    const io = me && u.username === me.username;
    return `<tr class="${u.attivo ? '' : 'off'}">
      <td><div class="chi"><span class="u-av">${esc(iniz(u.nome))}</span><span><b>${esc(u.nome)}</b><small>${esc(u.username)}</small></span></div></td>
      <td>${u.ruolo === 'admin' ? '<span class="st adm">Admin</span>' : 'Utente'}</td>
      <td>${stato(u)}</td>
      <td>${programmi(u)}</td>
      <td class="quando">${esc(data(u.creato))}</td>
      <td class="az">${io ? '<span class="tu">Sei tu</span>' : `
        <button type="button" class="b" data-pw="${esc(u.username)}">Password</button>
        <button type="button" class="b" data-att="${esc(u.username)}" data-attivo="${u.attivo ? '0' : '1'}">${u.attivo ? 'Disattiva' : 'Riattiva'}</button>
        <button type="button" class="b rosso" data-del="${esc(u.username)}">Elimina</button>`}</td>
    </tr>`;
  }).join('');
}

$('cerca').addEventListener('input', renderRighe);
$('fStato').addEventListener('change', renderRighe);

// Un solo ascoltatore per i pulsanti della tabella: le righe si rifanno spesso.
$('righe').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.pw) apriPassword(b.dataset.pw);
  else if (b.dataset.att) cambiaAttivo(b.dataset.att, b.dataset.attivo === '1');
  else if (b.dataset.del) elimina(b.dataset.del);
  else if (b.dataset.apps) apriProgrammi(b.dataset.apps);
});

// Tutti i pulsanti "Annulla"/"Chiudi" delle finestre.
document.querySelectorAll('[data-chiudi]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

const trova = (username) => utenti.find((u) => u.username === username);

function caselle(sel, attributo) {
  return assegnabili.map((a) => `
    <label class="chk"><input type="checkbox" ${attributo}="${esc(a.id)}" ${sel(a) ? 'checked' : ''} />
      <span>${esc(a.nome)}${a.riservata ? ' <span class="ris">riservato</span>' : ''}</span></label>`).join('');
}

// ---- Disattiva / riattiva / elimina ----
async function cambiaAttivo(username, attivo) {
  const u = trova(username);
  if (!attivo && !confirm(`Disattivare ${u.nome} (${username})?\n\nNon potrà più entrare nel portale né nelle app, e le sue sessioni aperte si chiudono subito. Storico e programmi restano: potrai riattivarlo quando vuoi.`)) return;
  const d = await invia('PUT', '/api/utenti/' + encodeURIComponent(username) + '/attivo', { attivo });
  if (d.ok) { toast(u.nome + (attivo ? ' riattivato' : ' disattivato')); caricaUtenti(); }
  else toast(d.error || 'Operazione non riuscita');
}

async function elimina(username) {
  const u = trova(username);
  if (!confirm(`Eliminare definitivamente ${u.nome} (${username})?\n\nL'account sparisce e non si può recuperare. Se vuoi solo impedirgli di entrare, usa «Disattiva».`)) return;
  const d = await invia('DELETE', '/api/utenti/' + encodeURIComponent(username));
  if (d.ok) { toast(u.nome + ' eliminato'); caricaUtenti(); }
  else toast(d.error || 'Operazione non riuscita');
}

// ---- Nuovo utente ----
$('apriNuovo').addEventListener('click', () => {
  $('formNuovo').reset();
  $('nuovoEsito').innerHTML = '';
  // Spuntate come il default (tutto tranne i riservati): si toglie solo l'eccezione.
  $('nAppsFld').hidden = !assegnabili.length;
  $('nApps').innerHTML = caselle((a) => !a.riservata, 'data-n');
  $('dlgNuovo').showModal();
  $('nNome').focus();
});

// Username proposto dal nome ("Mario Rossi" -> "mrossi") finché l'admin non lo tocca.
let usernameToccato = false;
$('nUsername').addEventListener('input', () => { usernameToccato = true; });
$('dlgNuovo').addEventListener('close', () => { usernameToccato = false; });
$('nNome').addEventListener('input', () => {
  if (usernameToccato) return;
  const parti = $('nNome').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  $('nUsername').value = parti.length > 1 ? parti[0][0] + parti.slice(1).join('') : (parti[0] || '');
});

$('nRuolo').addEventListener('change', () => { $('nAppsFld').hidden = $('nRuolo').value === 'admin' || !assegnabili.length; });

$('formNuovo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const admin = $('nRuolo').value === 'admin';
  const d = await invia('POST', '/api/utenti', {
    nome: $('nNome').value, username: $('nUsername').value, password: $('nPassword').value,
    ruolo: $('nRuolo').value,
    apps: admin ? undefined : [...$('nApps').querySelectorAll('[data-n]:checked')].map((c) => c.dataset.n),
  });
  if (!d.ok) { $('nuovoEsito').innerHTML = `<span class="ko">${esc(d.error || 'Errore')}</span>`; return; }
  toast('Utente creato');
  $('dlgNuovo').close();
  caricaUtenti();
});

// ---- Import da Excel / CSV ----
function base64(file) {
  return new Promise((ok, ko) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1] || '');
    fr.onerror = () => ko(fr.error);
    fr.readAsDataURL(file);
  });
}

$('apriImport').addEventListener('click', () => {
  $('formImport').reset();
  $('importEsito').innerHTML = '';
  $('dlgImport').showModal();
});

$('formImport').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('impFile').files[0];
  const esito = $('importEsito');
  if (!file) return;
  esito.textContent = 'Lettura del file…';
  $('importOk').disabled = true;
  try {
    const d = await invia('POST', '/api/utenti/import', { filename: file.name, dataBase64: await base64(file), defaultPassword: $('impPw').value });
    if (!d.ok) { esito.innerHTML = `<span class="ko">${esc(d.error || 'Errore')}</span>`; return; }
    const sc = d.scartati || [];
    esito.innerHTML = `<span class="ok">${d.aggiunti === 1 ? '1 utente importato' : d.aggiunti + ' utenti importati'}</span>` +
      (sc.length ? ` · <span class="ko">${sc.length === 1 ? '1 riga scartata' : sc.length + ' righe scartate'}</span>
        <table><thead><tr><th>Riga</th><th>Username</th><th>Motivo</th></tr></thead><tbody>${
          sc.map((s) => `<tr><td>${esc(s.riga)}</td><td>${esc(s.username || '—')}</td><td>${esc(s.motivo)}</td></tr>`).join('')}</tbody></table>` : '');
    $('impFile').value = '';
    caricaUtenti();
  } catch {
    esito.innerHTML = '<span class="ko">Il file non si legge.</span>';
  } finally {
    $('importOk').disabled = false;
  }
});

// Modello in CSV con ";" (Excel italiano lo apre a colonne) e BOM per gli accenti.
$('modello').addEventListener('click', () => {
  const csv = 'username;nome;password;ruolo\r\nmrossi;Mario Rossi;;utente\r\ngverdi;Giulia Verdi;;admin\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'modello-utenti.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---- Password ----
let pwUtente = null;

function apriPassword(username) {
  const u = trova(username);
  pwUtente = username;
  $('formPw').reset();
  $('pwSceltaFld').hidden = true;
  $('pwEsito').innerHTML = '';
  $('pwOk').hidden = false;
  $('pwChiudi').textContent = 'Annulla';
  $('pwSotto').textContent = `${u.nome} (${username}) dovrà cambiarla al primo accesso. Le sue sessioni aperte si chiudono.`;
  $('dlgPw').showModal();
}

document.querySelectorAll('[name="pwModo"]').forEach((r) => r.addEventListener('change', () => {
  const scegli = document.querySelector('[name="pwModo"]:checked').value === 'scegli';
  $('pwSceltaFld').hidden = !scegli;
  $('pwScelta').required = scegli;
  if (scegli) $('pwScelta').focus();
}));

$('formPw').addEventListener('submit', async (e) => {
  e.preventDefault();
  const scegli = document.querySelector('[name="pwModo"]:checked').value === 'scegli';
  const d = await invia('POST', '/api/utenti/' + encodeURIComponent(pwUtente) + '/password', { password: scegli ? $('pwScelta').value : '' });
  if (!d.ok) { $('pwEsito').innerHTML = `<span class="ko">${esc(d.error || 'Errore')}</span>`; return; }
  $('pwOk').hidden = true;
  $('pwChiudi').textContent = 'Chiudi';
  // La temporanea si vede solo qui, una volta: il server tiene solo l'hash.
  $('pwEsito').innerHTML = d.password
    ? `Password temporanea: <code>${esc(d.password)}</code><br>Comunicala all'utente: dopo aver chiuso non sarà più visibile.`
    : '<span class="ok">Password impostata.</span>';
  caricaUtenti();
});

// ---- Programmi visibili ----
let appsUtente = null;

function apriProgrammi(username) {
  const u = trova(username);
  appsUtente = username;
  $('appsEsito').innerHTML = '';
  $('appsSotto').textContent = `Programmi che ${u.nome} vede nella home e può aprire.`;
  $('appsChks').innerHTML = caselle((a) => (u.apps || []).includes(a.id), 'data-a');
  $('dlgApps').showModal();
}

$('formApps').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apps = [...$('appsChks').querySelectorAll('[data-a]:checked')].map((c) => c.dataset.a);
  const d = await invia('PUT', '/api/utenti/' + encodeURIComponent(appsUtente) + '/apps', { apps });
  if (!d.ok) { $('appsEsito').innerHTML = `<span class="ko">${esc(d.error || 'Errore')}</span>`; return; }
  toast('Programmi salvati');
  $('dlgApps').close();
  caricaUtenti();
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

loadMe().then((ok) => { if (ok) caricaUtenti(); });
