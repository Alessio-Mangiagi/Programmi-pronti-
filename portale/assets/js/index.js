// "><(((º> sabusabu <º)))><"
// Home degli utenti: una scheda per attività ("Trasformare una bolla in
// Excel"), con suggerimento al passaggio del mouse; la ricerca filtra le schede
// e, con Invio, gira la domanda all'assistente della suite.
// Niente stato acceso/spento né storico: un clic apre l'app, e se è spenta
// la avvia prima. Testi delle schede (fai, guida) dal server: /api/apps.

// Tratti delle icone per app (SVG stroke, niente emoji): solo i path, il
// contorno lo aggiunge icona(). Non sono gli ICONS di common.js (SVG interi).
const TRATTI = {
  ddt: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="M9 13h6M9 17h4"/>',
  agente: '<path d="M4 19V5M4 19h16"/><path d="M8 15v-4M12 15V8M16 15v-6"/>',
  confronta: '<path d="M5 4h6v16H5zM13 4h6v16h-6z"/>',
  ocr: '<path d="M3 8V6a2 2 0 0 1 2-2h2M17 4h2a2 2 0 0 1 2 2v2M21 16v2a2 2 0 0 1-2 2h-2M7 20H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10M9 9h6M9 15h4"/>',
  scadenzario: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/><path d="m9 15 2 2 4-4"/>',
  requisiti: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/><path d="m8 11 2.2 2.2L14.5 9"/>',
  trimble: '<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z"/><path d="M13 3v5a1 1 0 0 0 1 1h5"/><path d="M12 18v-6"/><path d="m9.5 14.5 2.5-2.5 2.5 2.5"/>',
  incampo: '<path d="M3 7v13l6-2 6 2 6-2V5l-6 2-6-2-3 1"/><path d="M15 7v5"/><path d="M9 5v13"/><path d="M15 21v-2"/>',
  auguri: '<path d="M4 21h16v-8H4v8Z"/><path d="M4 15c1.5 0 1.5-1.5 3-1.5S8.5 15 10 15s1.5-1.5 3-1.5S15.5 15 17 15s1.5-1.5 3-1.5"/><path d="M12 8v5"/><circle cx="12" cy="5.5" r="1.3"/>',
};
const icona = (id) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${TRATTI[id] || TRATTI.ddt}</svg>`;
const FRECCIA = '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

let apps = [];        // globale: lo riusa anche chat.js
const elTask = document.getElementById('task');
const elQ = document.getElementById('q');
const elAvviso = document.getElementById('avvisoAi');
const elRisposta = document.getElementById('risposta');
const elVuoto = document.getElementById('vuoto');

// Per il filtro: minuscolo e senza accenti ("attività" trova "attivita").
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function render() {
  elTask.innerHTML = apps.map((a) => `
    <button type="button" class="t" data-id="${esc(a.id)}" aria-describedby="tip-${esc(a.id)}">
      <span class="ic">${icona(a.id)}</span>
      <span><b>${esc(a.fai || a.nome)}</b><small>con <i>${esc(a.nome)}</i> · ${esc(a.sottotitolo)}</small></span>
      <span class="fr">${FRECCIA}</span>
      <span class="tip" role="tooltip" id="tip-${esc(a.id)}">${esc(a.guida || a.desc)}<em>Clic per aprire ${esc(a.nome)}. Se è spenta parte da sola in qualche secondo.</em></span>
    </button>`).join('');
  elTask.querySelectorAll('.t').forEach((b) => b.addEventListener('click', () => apriApp(b.dataset.id)));
}

// ---------------------------------------------------------------- apertura

function registraApertura(id) {
  fetch('/api/log-access', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: id }),
  }).catch(() => {});
}

async function eAccesa(id) {
  try { return !!(await (await fetch('/api/status/' + encodeURIComponent(id))).json()).online; } catch { return false; }
}

// Attende che l'app risponda sulla sua porta, fino al timeout.
function attendiPronta(id, timeoutMs = 120000, ogniMs = 700) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const giro = async () => {
      if (await eAccesa(id)) return resolve(true);
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(giro, ogniMs);
    };
    giro();
  });
}

// Un solo gesto per l'utente: "apri". Se l'app è spenta la si avvia e la
// scheda si apre da sola quando è pronta. La finestra si apre SUBITO sul clic
// (gesto utente), altrimenti il browser bloccherebbe il popup arrivato dopo.
let inApertura = null;
async function apriApp(id) {
  const app = apps.find((a) => a.id === id);
  if (!app || inApertura === id) return;
  let win = null;
  try { win = window.open('', '_blank'); } catch { /* popup bloccato: si ripiega sotto */ }
  const scheda = elTask.querySelector(`.t[data-id="${id}"]`);

  if (await eAccesa(id)) {
    if (win && !win.closed) win.location = app.url; else window.open(app.url, '_blank', 'noopener');
    registraApertura(id);
    return;
  }

  inApertura = id;
  if (scheda) scheda.classList.add('busy');
  if (win) { try { win.document.write(`<title>Avvio…</title><body style="font:16px/1.5 system-ui;padding:2rem;color:#334">Sto aprendo <b>${esc(app.nome)}</b>… la pagina si apre da sola appena è pronta.</body>`); } catch { /* scheda già navigata */ } }
  toast(`${app.nome} si sta avviando: si apre da sola appena è pronta.`);
  try {
    const r = await fetch('/api/launch/' + encodeURIComponent(id), { method: 'POST' });
    const data = await r.json();
    if (!data.ok) { if (win) win.close(); toast('Non riesco ad aprire ' + app.nome + ': ' + (data.error || 'riprova tra poco')); return; }
    if (await attendiPronta(id)) {
      if (win && !win.closed) win.location = app.url; else window.open(app.url, '_blank', 'noopener');
      registraApertura(id);
    } else {
      if (win && !win.closed) win.close();
      toast(app.nome + ' ci mette più del solito. Riprova tra un minuto.');
    }
  } catch {
    if (win) win.close();
    toast('Il portale non risponde. Riprova tra poco.');
  } finally {
    inApertura = null;
    if (scheda) scheda.classList.remove('busy');
  }
}
window.apriApp = apriApp;   // usata anche dai pulsanti dell'assistente (chat.js)

// ---------------------------------------------------------------- ricerca / assistente

function filtra() {
  const q = norm(elQ.value).trim();
  let visibili = 0;
  for (const b of elTask.querySelectorAll('.t')) {
    const a = apps.find((x) => x.id === b.dataset.id);
    const ok = !q || norm([a.fai, a.nome, a.sottotitolo, a.desc, a.guida].join(' ')).includes(q);
    b.hidden = !ok;
    if (ok) visibili++;
  }
  elVuoto.hidden = visibili > 0;
}

function mostraRisposta(testo, ids, contatto, domanda) {
  elRisposta.replaceChildren();
  const chi = document.createElement('span');
  chi.className = 'chi';
  chi.textContent = 'Assistente automatico';
  const p = document.createElement('p');
  p.className = 'testo';
  p.style.margin = '0';
  p.textContent = testo;          // textContent: niente HTML dalle risposte
  elRisposta.append(chi, p);
  const valide = (ids || []).filter((id) => apps.some((a) => a.id === id));
  // La risposta rimanda a una persona (credenziali, domanda complessa): pulsante
  // che apre la mail all'amministratore con la domanda già scritta.
  const mail = contatto ? mailAdmin(contatto.email, domanda) : '';
  if (valide.length || mail) {
    const box = document.createElement('div');
    box.className = 'azioni';
    for (const id of valide) {
      const a = apps.find((x) => x.id === id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'apri';
      b.textContent = 'Apri ' + a.nome;
      b.addEventListener('click', () => apriApp(id));
      box.appendChild(b);
    }
    if (mail) {
      const m = document.createElement('a');
      m.className = 'ghost';
      m.href = mail;
      m.textContent = 'Scrivi all’amministratore';
      m.dataset.tip = 'Apre la tua posta con la domanda già scritta: ' + contatto.email;
      box.appendChild(m);
    }
    elRisposta.appendChild(box);
  }
  elRisposta.hidden = false;
  elVuoto.hidden = true;          // c'è già la risposta: "nessuna attività" sarebbe rumore
}

let inAttesa = false;
async function chiedi(domanda) {
  const q = domanda.trim();
  if (!q || inAttesa) return;
  inAttesa = true;
  mostraRisposta('Ci penso…', []);
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domanda: q }),
    });
    if (r.status === 401) { window.location.href = '/login'; return; }
    const data = await r.json();
    mostraRisposta(data.risposta, data.apps, data.contatto, q);
  } catch {
    mostraRisposta('Non riesco a rispondere: il portale non risponde. Riprova tra poco.', []);
  } finally {
    inAttesa = false;
  }
}

// Entrando nella ricerca compare il promemoria: dall'altra parte c'è un
// assistente automatico, e va trattato con rispetto. Resta finché si scrive.
elQ.addEventListener('focus', () => { elAvviso.hidden = false; });
elQ.addEventListener('blur', () => { if (!elQ.value.trim()) elAvviso.hidden = true; });
elQ.addEventListener('input', () => {
  filtra();
  if (!elQ.value.trim()) elRisposta.hidden = true;
});
document.getElementById('cerca').addEventListener('submit', (e) => {
  e.preventDefault();
  chiedi(elQ.value);
});

document.getElementById('apriAssistente').addEventListener('click', (e) => {
  e.preventDefault();
  if (typeof chatApri === 'function') chatApri(true);
});

// ---------------------------------------------------------------- avvio

async function loadMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) { window.location.href = '/login'; return false; }
  const me = await r.json();
  // Primo accesso / reset: obbligo di cambiare password.
  if (me.mustChange) { window.location.href = '/password'; return false; }
  document.getElementById('userName').textContent = me.nome;
  document.getElementById('avatar').textContent = iniz(me.nome);
  return true;
}

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// Casella dell'amministratore: link nel pannello e nel riquadro di aiuto.
// Se non è configurata i link restano nascosti (l'assistente dice comunque
// di rivolgersi a un amministratore).
async function caricaContatti() {
  let email = '';
  try { email = (await (await fetch('/api/contatti')).json()).emailAdmin || ''; } catch { /* resta vuota */ }
  if (!email) return;
  for (const id of ['mailAdmin', 'mailAdmin2']) {
    const a = document.getElementById(id);
    a.href = mailAdmin(email);
    a.hidden = false;
  }
  document.getElementById('aiutoTesto').textContent = 'Chiedi all’assistente, apri la guida o scrivi all’amministratore: ' + email + '.';
}

async function init() {
  if (!(await loadMe())) return;
  caricaContatti();
  const data = await (await fetch('/api/apps')).json();
  apps = data.apps || [];
  // Admin in "vista utente" (/?vista=utente dalla plancia): via le app solo
  // admin, così vede la home come un utente, e un link per tornare indietro.
  if (new URLSearchParams(location.search).get('vista') === 'utente') {
    apps = apps.filter((a) => !a.adminOnly);
    const torna = document.createElement('a');
    torna.className = 'ghost';
    torna.href = '/';
    torna.textContent = 'Torna alla plancia';
    torna.dataset.tip = 'Stai vedendo la home come un utente: torna alla plancia admin';
    document.querySelector('.utente').prepend(torna);
  }
  render();
}

init();
