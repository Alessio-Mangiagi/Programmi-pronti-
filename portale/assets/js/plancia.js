// Plancia degli amministratori: barra delle app (lanciatore) + utenti e attività.
// Gli utenti normali ricevono index.html, la griglia di sempre.
//
// La logica di avvio, apertura e arresto è quella di prima, invariata: cambia
// solo dove vive. Ogni voce della barra è una .card[data-id] con dentro
// [data-launch] e [data-open], gli agganci che chat.js usa per avviare e
// aprire le app dalle risposte dell'assistente.

// Sigle al posto delle icone. Un programma aggiunto dagli admin (app-extra) non
// è qui: prende le prime tre lettere del nome.
const SIGLE = { ddt: 'DDT', agente: 'AI', confronta: 'PDF', ocr: 'OCR', scadenzario: 'SCA', requisiti: 'REQ', trimble: 'TRM', auguri: 'WA' };
const sigla = (a) => SIGLE[a.id] || String(a.nome || a.id).replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase();

let apps = [];
let isAdmin = false;   // solo gli admin del portale possono fermare le app
const online = {};     // id -> true/false, dall'ultimo giro di /api/status
const appById = (id) => apps.find((a) => a.id === id);

// ---------------------------------------------------------------- barra app

function cardHtml(a) {
  return `
    <div class="card${a.adminOnly ? ' adm' : ''}" data-id="${esc(a.id)}">
      <button class="hit" type="button" data-go="${esc(a.id)}" aria-label="${esc(a.nome)}: apri o avvia"></button>
      <span class="k">${esc(sigla(a))}</span>
      <span class="n" title="${esc(a.nome)}">${esc(a.nome)}</span>
      <span class="right">
        <span class="state" data-state>…</span>
        ${isAdmin ? `<button class="stop" type="button" data-stop="${esc(a.id)}" title="Ferma ${esc(a.nome)}" aria-label="Ferma ${esc(a.nome)}"></button>` : ''}
        <i class="sq" data-sq></i>
      </span>
      <button type="button" data-launch="${esc(a.id)}" tabindex="-1">Avvia</button>
      <a class="disabled" data-open="${esc(a.id)}" href="${esc(a.url)}" target="_blank" rel="noopener" tabindex="-1">Apri</a>
    </div>`;
}

function renderApps() {
  const normali = apps.filter((a) => !a.adminOnly);
  const riservate = apps.filter((a) => a.adminOnly);
  document.getElementById('apps').innerHTML = normali.map(cardHtml).join('');
  document.getElementById('appsRiservate').innerHTML = riservate.map(cardHtml).join('');
  document.getElementById('secRiservate').hidden = riservate.length === 0;

  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => vai(b.dataset.go)));
  document.querySelectorAll('[data-launch]').forEach((b) => b.addEventListener('click', () => launch(b.dataset.launch, b)));
  document.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); stop(b.dataset.stop, b); }));
  document.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => {
    if (a.classList.contains('disabled')) { e.preventDefault(); return; }
    registraApertura(a.dataset.open);
  }));
}

// Un clic sulla riga fa la cosa ovvia: apre se è accesa, avvia se è spenta.
function vai(id) {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  if (online[id]) card.querySelector('[data-open]').click();
  else card.querySelector('[data-launch]').click();
}

function registraApertura(id) {
  fetch('/api/log-access', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: id }),
  }).then(() => aggiornaPlancia()).catch(() => {});
}

// Stato di una voce: quadratino pieno/vuoto, "Apri" attivo, "Ferma" per gli admin.
function setCardState(id, isOnline) {
  online[id] = isOnline;
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card || card.classList.contains('busy')) return;
  card.classList.toggle('online', isOnline);
  card.querySelector('[data-sq]').classList.toggle('on', isOnline);
  card.querySelector('[data-state]').textContent = isOnline ? 'Accesa' : 'Spenta';
  card.querySelector('[data-open]').classList.toggle('disabled', !isOnline);
  aggiornaAccese();
}

function setBusy(id, busy, testo) {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  card.classList.toggle('busy', busy);
  if (busy) card.querySelector('[data-state]').textContent = testo;
  else setCardState(id, !!online[id]);
}

function aggiornaAccese() {
  document.getElementById('kAccese').textContent = String(apps.filter((a) => online[a.id]).length);
}

// Attende che l'app risponda sulla sua porta: poll rapido (0,7s) fino al pronto
// o al timeout.
function waitReady(id, { timeoutMs = 120000, intervalMs = 700 } = {}) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      let ok = false;
      try { ok = !!(await (await fetch('/api/status/' + encodeURIComponent(id))).json()).online; } catch {}
      if (ok) return resolve(true);
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function launch(id, btn) {
  const app = appById(id);
  // Apre subito una scheda "vuota" sul click (gesto utente): la navigheremo
  // quando l'app è pronta, aggirando il blocco dei popup differiti dei browser.
  let win = null;
  try { win = window.open('', '_blank'); } catch {}
  if (win) { try { win.document.write(`<title>Avvio…</title><body style="font:16px/1.5 system-ui;padding:2rem;color:#334">Avvio di <b>${esc(app.nome)}</b> in corso… la pagina si aprirà da sola appena è pronta.</body>`); } catch {} }

  btn.disabled = true;
  setBusy(id, true, 'Avvio…');
  try {
    const r = await fetch('/api/launch/' + id, { method: 'POST' });
    const data = await r.json();
    if (!data.ok) { if (win) win.close(); toast('Errore: ' + (data.error || 'avvio non riuscito')); return; }

    toast(app.nome + ' in avvio — si aprirà da sola appena pronta.');
    const ready = await waitReady(id);
    if (ready) {
      online[id] = true;
      if (win && !win.closed) win.location = app.url; else window.open(app.url, '_blank', 'noopener');
      registraApertura(id);
      toast(app.nome + ' pronto.');
    } else {
      if (win && !win.closed) win.close();
      toast(app.nome + ' ci mette più del solito. Riprova tra poco.');
    }
  } catch {
    if (win) win.close();
    toast('Errore di rete durante l\'avvio.');
  } finally {
    btn.disabled = false;
    setBusy(id, false);
  }
}

// Ferma un'app (solo admin). L'app è condivisa: se qualcun altro la sta usando
// la sua sessione muore, quindi si chiede conferma.
async function stop(id, btn) {
  const app = appById(id);
  if (!confirm(`Fermare ${app.nome}?\n\nChi lo sta usando in questo momento perde il lavoro non salvato.`)) return;
  btn.disabled = true;
  setBusy(id, true, 'Arresto…');
  try {
    const r = await fetch('/api/stop/' + encodeURIComponent(id), { method: 'POST' });
    const data = await r.json();
    if (data.ok) { online[id] = false; toast(app.nome + ' fermato.'); aggiornaPlancia(); }
    else toast('Errore: ' + (data.error || 'chiusura non riuscita'));
  } catch {
    toast('Errore di rete durante la chiusura.');
  } finally {
    btn.disabled = false;
    setBusy(id, false);
  }
}

async function pollStatus() {
  try {
    const data = await (await fetch('/api/status')).json();
    const map = Object.fromEntries(data.apps.map((s) => [s.id, s.online]));
    apps.forEach((a) => setCardState(a.id, !!map[a.id]));
  } catch { /* silenzioso: il portale resta usabile */ }
}

// ---------------------------------------------------------------- plancia
// Pagina riservata agli admin: numeri della suite, elenco utenti e attività
// dell'utente selezionato. I dati arrivano da /api/plancia e /api/attivita,
// che il server nega a chi non è admin.

const ora2 = (d) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const giornoChiave = (d) => d.toLocaleDateString('it-IT');

function giornoEtichetta(d) {
  const oggi = new Date();
  const ieri = new Date(oggi); ieri.setDate(oggi.getDate() - 1);
  if (giornoChiave(d) === giornoChiave(oggi)) return 'Oggi';
  if (giornoChiave(d) === giornoChiave(ieri)) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

function quando(ts) {
  const d = new Date(ts);
  const g = giornoEtichetta(d);
  return (g === 'Oggi' || g === 'Ieri' ? g.toLowerCase() : g) + ' alle ' + ora2(d);
}

// Le azioni come nomi, non come participi: "Scadenzario · Apertura" vale per
// qualunque app, senza accordare maschile e femminile.
const AZIONI = {
  login: 'Accesso', apri: 'Apertura', avvia: 'Avvio', ferma: 'Arresto',
  'login-bloccato': 'Accesso bloccato',
};

let me = null;               // utente collegato (da /api/me)
let utenti = [];             // righe di /api/plancia
let selezionato = null;      // username di cui si mostrano le attività

function renderUtenti() {
  const el = document.getElementById('utenti');
  if (!utenti.length) { el.innerHTML = '<p class="empty">Nessun utente registrato.</p>'; return; }
  el.innerHTML = utenti.map((u) => {
    const app = u.ultimaApp && appById(u.ultimaApp.appId);
    const meta = u.ultimoAccesso ? 'Ultimo accesso ' + quando(u.ultimoAccesso) : 'Mai entrato';
    return `<button type="button" class="urow" role="option" data-utente="${esc(u.username)}" aria-selected="${u.username === selezionato}">
      <span class="u-av${u.attivoOggi ? ' oggi' : ''}" title="${u.attivoOggi ? 'Attivo oggi' : ''}">${esc(iniz(u.nome))}</span>
      <span class="u-name"><b>${esc(u.nome)}</b><span class="u-meta">${esc(u.username)} · ${esc(meta)}</span></span>
      <span class="u-role">${u.ruolo === 'admin' ? 'Admin' : 'Utente'}</span>
      <span class="u-num"><b>${u.accessi30}</b><small>accessi 30 gg</small></span>
      <span class="u-app" title="${app ? 'Ultima app: ' + esc(app.nome) : ''}">${app ? esc(sigla(app)) : '—'}</span>
    </button>`;
  }).join('');
  el.querySelectorAll('[data-utente]').forEach((b) => b.addEventListener('click', () => {
    selezionato = b.dataset.utente;
    el.querySelectorAll('[data-utente]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    caricaAttivita();
  }));
}

function renderTimeline(attivita, nome) {
  const el = document.getElementById('timeline');
  if (!attivita.length) {
    el.innerHTML = `<li class="empty">${esc(nome)} non ha ancora attività registrate nel Portale.</li>`;
    return;
  }
  let ultimoGiorno = '';
  const righe = [];
  for (const e of attivita.slice(0, 16)) {
    const d = new Date(e.ts);
    const g = giornoEtichetta(d);
    if (g !== ultimoGiorno) { righe.push(`<li class="day">${esc(g)}</li>`); ultimoGiorno = g; }
    const app = e.appId ? appById(e.appId) : null;
    // App non più nell'elenco (rimossa o non visibile): si mostra l'id, non si perde la riga.
    const testo = app ? `<b>${esc(app.nome)}</b>` : e.appId ? `<b>${esc(e.appId)}</b>` : (e.azione === 'login' ? 'Accesso al Portale' : esc(AZIONI[e.azione] || e.azione));
    righe.push(`<li class="${e.azione === 'login-bloccato' ? 'warn' : ''}">
      <time datetime="${esc(e.ts)}">${esc(ora2(d))}</time>
      <span class="k">${app ? esc(sigla(app)) : '—'}</span>
      <span class="t">${testo}</span>
      <span class="az">${esc(AZIONI[e.azione] || e.azione)}</span></li>`);
  }
  el.innerHTML = righe.join('');
}

async function caricaAttivita() {
  if (!selezionato) return;
  const u = utenti.find((x) => x.username === selezionato);
  const nome = u ? u.nome : selezionato;
  document.getElementById('titoloAttivita').textContent = 'Attività di ' + nome;
  let r;
  try {
    const res = await fetch('/api/attivita?utente=' + encodeURIComponent(selezionato));
    if (!res.ok) throw new Error();
    r = await res.json();
  } catch { document.getElementById('timeline').innerHTML = '<li class="empty">Attività non disponibili. Riprova tra poco.</li>'; return; }
  const n = r.numeri || {};
  const piu = n.piuUsata && appById(n.piuUsata.appId);
  document.getElementById('notaAttivita').textContent =
    `${n.aperture7 ?? 0} app aperte in 7 gg` + (piu ? ` · più usata: ${sigla(piu)}` : '');
  renderTimeline(r.attivita || [], nome);
}

async function aggiornaPlancia() {
  let r;
  try {
    const res = await fetch('/api/plancia');
    if (!res.ok) throw new Error();
    r = await res.json();
  } catch { return; }
  utenti = r.utenti || [];
  if (!selezionato || !utenti.some((u) => u.username === selezionato)) {
    selezionato = (utenti.find((u) => u.username === (me && me.username)) || utenti[0] || {}).username || null;
  }
  const n = r.numeri || {};
  document.getElementById('kUtentiOggi').textContent = String(n.utentiOggi ?? 0);
  document.getElementById('kUtentiTot').textContent = `su ${n.utentiTotali ?? 0} registrati`;
  document.getElementById('kAccessiOggi').textContent = String(n.accessiOggi ?? 0);
  const piu = n.piuUsata && appById(n.piuUsata.appId);
  document.getElementById('kPiuUsata').textContent = piu ? sigla(piu) : '—';
  document.getElementById('kPiuUsataNota').textContent = piu
    ? `${piu.nome} · ${n.piuUsata.volte} ${n.piuUsata.volte === 1 ? 'volta' : 'volte'} in 30 gg`
    : 'negli ultimi 30 giorni';
  document.getElementById('aggiornato').textContent = 'Aggiornato alle ' + ora2(new Date());
  renderUtenti();
  caricaAttivita();
}

// ---------------------------------------------------------------- avvio

function saluto(nome) {
  const h = new Date().getHours();
  // "><(((º> sabusabu <º)))><"
  const s = h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const primo = String(nome || '').trim().split(/\s+/)[0];
  return primo ? `${s},<br>${esc(primo)}` : s;
}

async function loadMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) { window.location.href = '/login'; return false; }
  me = await r.json();
  // Primo accesso / reset: obbligo di cambiare password.
  if (me.mustChange) { window.location.href = '/password'; return false; }
  document.getElementById('userName').textContent = me.nome;
  document.getElementById('avatar').textContent = iniz(me.nome);
  document.getElementById('saluto').innerHTML = saluto(me.nome);
  // admin del portale: ruolo "vero" oppure elevazione dall'IP (adminPortale).
  isAdmin = !!(me.adminPortale || me.ruolo === 'admin');
  document.getElementById('adminLink').hidden = !isAdmin;
  return true;
}

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

async function init() {
  const ok = await loadMe();
  if (!ok) return;
  apps = (await (await fetch('/api/apps')).json()).apps;
  renderApps();
  aggiornaPlancia();
  pollStatus();
  setInterval(pollStatus, 4000);
  setInterval(aggiornaPlancia, 60000);
}

init();
