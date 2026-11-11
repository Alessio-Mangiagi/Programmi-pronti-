// "><(((º> sabusabu <º)))><"
// Pagina Utenti (solo admin): elenco con ricerca e filtro, e le finestre per
// creare, importare da Excel, cambiare password, scegliere i programmi.
// Disattiva/Riattiva ed Elimina chiedono conferma e agiscono subito.
// API: /api/utenti (GET, POST), /api/utenti/import, /api/utenti/<u>/password,
// /api/utenti/<u>/attivo, /api/utenti/<u>/apps, /api/utenti/<u>/ruolo,
// /api/utenti/<u>/nome, DELETE /api/utenti/<u>.
//
// Proprietario della suite (11/11/2026): solo lui crea, promuove, declassa ed elimina gli
// amministratori e ne cambia password, email, nome e programmi. Per gli altri admin la pagina
// mostra le righe degli amministratori con i comandi spenti e il motivo al passaggio del mouse
// (il server rifiuta comunque, vedi controlloAmministratori in server.js). Il ruolo si cambia dal
// menu nella colonna Ruolo, il nome con «Nome» sotto la persona.

let utenti = [];
let assegnabili = [];   // programmi con casella: [{ id, nome, riservata }]
let me = null;
let sonoProprietario = false;   // da /api/utenti: chi guarda la pagina può gestire gli admin
const SOLO_PROP = 'Solo il proprietario della suite gestisce gli amministratori';

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
  sonoProprietario = !!d.sonoProprietario;
  // "Amministratore" fra i ruoli del nuovo utente solo per il proprietario; agli altri la nota
  // nell'import spiega che le righe admin del foglio vengono scartate.
  $('nRuoloAdmin').hidden = !sonoProprietario;
  $('nRuoloAdmin').disabled = !sonoProprietario;
  $('impAdminNota').hidden = sonoProprietario;
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

// Ruolo: menu per il proprietario (non sulla sua riga), testo per gli altri. Sulla riga del
// proprietario l'etichetta "Proprietario": è admin per sempre, nessuno lo declassa.
function ruolo(u) {
  const etichetta = u.ruolo === 'admin' ? '<span class="st adm">Admin</span>' : 'Utente';
  if (u.proprietario) return '<span class="st prop" title="Proprietario della suite: solo lui gestisce gli amministratori. Resta sempre amministratore.">Proprietario</span>';
  if (!sonoProprietario) {
    return u.ruolo === 'admin' ? `${etichetta}<span class="lucchetto" title="${esc(SOLO_PROP)}" aria-label="${esc(SOLO_PROP)}"></span>` : etichetta;
  }
  return `<select class="ruolo-sel" data-ruolo="${esc(u.username)}" aria-label="Ruolo di ${esc(u.nome)}">
      <option value="utente"${u.ruolo === 'admin' ? '' : ' selected'}>Utente</option>
      <option value="admin"${u.ruolo === 'admin' ? ' selected' : ''}>Amministratore</option>
    </select>`;
}

// Le righe degli amministratori le gestisce solo il proprietario: per gli altri i pulsanti restano
// visibili ma spenti, con il motivo nel suggerimento (così si capisce perché non succede niente).
const bloccata = (u) => u.ruolo === 'admin' && !sonoProprietario;
const spento = (u) => (bloccata(u) ? ` disabled title="${esc(SOLO_PROP)}"` : '');

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
    // Il proprietario non si disattiva né si elimina (nemmeno da sé): sulla sua riga niente pulsanti.
    const azioni = io ? '<span class="tu">Sei tu</span>'
      : u.proprietario ? '<span class="tu" title="Il proprietario della suite non si disattiva e non si elimina">Proprietario</span>' : `
        <button type="button" class="b" data-pw="${esc(u.username)}"${spento(u)}>Password</button>
        <button type="button" class="b" data-att="${esc(u.username)}" data-attivo="${u.attivo ? '0' : '1'}"${spento(u)}>${u.attivo ? 'Disattiva' : 'Riattiva'}</button>
        <button type="button" class="b rosso" data-del="${esc(u.username)}"${spento(u)}>Elimina</button>`;
    const titoloNome = bloccata(u) ? '' : ' title="Cambia il nome che si vede nel portale e nei programmi"';
    const titoloMail = bloccata(u) ? '' : ' title="Cambia l’email con cui InCampo e SkyTower riconoscono l’utente"';
    return `<tr class="${u.attivo ? '' : 'off'}">
      <td><div class="chi"><span class="u-av">${esc(iniz(u.nome))}</span><span><b>${esc(u.nome)}</b><small>${esc(u.username)}<button type="button" class="link nome-b" data-nome="${esc(u.username)}"${spento(u)}${titoloNome}>Nome</button></small></span></div></td>
      <td class="mail"><span title="${u.email ? 'Impostata dall’amministratore' : 'Non impostata: vale username@dominio'}">${esc(u.emailEffettiva || '').replace('@', '<wbr>@')}</span>${u.email ? '' : '<small class="dedotta">dedotta</small>'}<button type="button" class="b mini" data-mail="${esc(u.username)}"${spento(u)}${titoloMail}>Email</button></td>
      <td class="ruolo">${ruolo(u)}</td>
      <td>${stato(u)}</td>
      <td>${programmi(u)}</td>
      <td class="quando">${esc(data(u.creato))}</td>
      <td class="az">${azioni}</td>
    </tr>`;
  }).join('');
}

$('cerca').addEventListener('input', renderRighe);
$('fStato').addEventListener('change', renderRighe);

// Un solo ascoltatore per i pulsanti della tabella: le righe si rifanno spesso.
$('righe').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.disabled) return;
  if (b.dataset.mail) cambiaEmail(b.dataset.mail);
  else if (b.dataset.nome) cambiaNome(b.dataset.nome);
  else if (b.dataset.pw) apriPassword(b.dataset.pw);
  else if (b.dataset.att) cambiaAttivo(b.dataset.att, b.dataset.attivo === '1');
  else if (b.dataset.del) elimina(b.dataset.del);
  else if (b.dataset.apps) apriProgrammi(b.dataset.apps);
});

// Ruolo dal menu della riga (solo il proprietario lo vede). Chiede conferma spiegando cosa cambia
// nei programmi; se annulla, il menu torna com'era.
$('righe').addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-ruolo]');
  if (sel) cambiaRuolo(sel.dataset.ruolo, sel.value, sel);
});

// Tutti i pulsanti "Annulla"/"Chiudi" delle finestre.
document.querySelectorAll('[data-chiudi]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

const trova = (username) => utenti.find((u) => u.username === username);

// Email: una finestra semplice (prompt) basta, è un campo solo. Vuota = torna
// quella dedotta username@dominio.
async function cambiaEmail(username) {
  const u = trova(username);
  const nuova = prompt(`Email di ${u ? u.nome : username} (vuota = ${u && u.emailEffettiva ? u.emailEffettiva.replace(/^[^@]+/, 'username') : 'username@dominio'}):`, (u && u.email) || '');
  if (nuova === null) return;
  const d = await invia('PUT', `/api/utenti/${encodeURIComponent(username)}/email`, { email: nuova.trim() });
  if (!d.ok) { alert(d.error || 'Non salvata'); return; }
  await caricaUtenti();
}

// Ruolo: utente <-> amministratore. Il server chiude le sessioni aperte della persona (rientra col
// ruolo nuovo); i programmi con account propri (SkyTower, InCampo, VFP Transfer, Analista Dati)
// danno o tolgono l'admin al suo prossimo accesso, gli altri alla prossima verifica della sessione.
async function cambiaRuolo(username, nuovo, sel) {
  const u = trova(username);
  const testo = nuovo === 'admin'
    ? `Rendere ${u.nome} (${username}) amministratore?\n\nVedrà tutti i programmi e la gestione del portale, e sarà amministratore anche nei programmi della suite dal suo prossimo accesso. Le sue sessioni aperte si chiudono.`
    : `Togliere a ${u.nome} (${username}) il ruolo di amministratore?\n\nPerde subito la gestione del portale e, dal suo prossimo accesso, l'amministrazione nei programmi della suite. Le sue sessioni aperte si chiudono.`;
  if (!confirm(testo)) { sel.value = u.ruolo; return; }
  const d = await invia('PUT', `/api/utenti/${encodeURIComponent(username)}/ruolo`, { ruolo: nuovo });
  if (!d.ok) { sel.value = u.ruolo; toast(d.error || 'Ruolo non cambiato'); return; }
  toast(`${u.nome}: ${nuovo === 'admin' ? 'ora amministratore' : 'ora utente'}`);
  caricaUtenti();
}

// Nome visualizzato: una finestra semplice, come l'email. Vale subito nel portale e, nei programmi,
// alla prossima verifica della sessione (pochi secondi) o al prossimo accesso.
async function cambiaNome(username) {
  const u = trova(username);
  const nuovo = prompt(`Nome e cognome di ${username}:`, u ? u.nome : '');
  if (nuovo === null || !nuovo.trim() || (u && nuovo.trim() === u.nome)) return;
  const d = await invia('PUT', `/api/utenti/${encodeURIComponent(username)}/nome`, { nome: nuovo.trim() });
  if (!d.ok) { alert(d.error || 'Nome non salvato'); return; }
  toast('Nome salvato');
  caricaUtenti();
}

// Caselle dei programmi (nuovo utente, finestra "Programmi"): icona del programma (common.js) e nome.
function caselle(sel, attributo) {
  return assegnabili.map((a) => `
    <label class="chk"><input type="checkbox" ${attributo}="${esc(a.id)}" ${sel(a) ? 'checked' : ''} />
      <span class="chk-ic">${iconaApp(a.id)}</span>
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
    nome: $('nNome').value, username: $('nUsername').value, password: $('nPassword').value, email: $('nEmail').value,
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
  await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  window.location.href = '/login';
});

loadMe().then((ok) => { if (ok) caricaUtenti(); });
