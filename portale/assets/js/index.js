// "><(((º> sabusabu <º)))><"
// Home degli utenti: una scheda per attività ("Trasformare una bolla in
// Excel"), con suggerimento al passaggio del mouse; la ricerca filtra le schede
// e, con Invio, gira la domanda all'assistente della suite.
// Niente stato acceso/spento né storico: un clic apre l'app, e se è spenta
// la avvia prima. Testi delle schede (fai, guida) dal server: /api/apps.

// Icone dei programmi: le stesse della plancia, da common.js (ICONE_APP, iconaApp), così home e
// plancia mostrano lo stesso disegno per ogni programma (prima erano due insiemi diversi).
const icona = (id) => iconaApp(id);
const FRECCIA = '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

let apps = [];        // globale: lo riusa anche chat.js
const elTask = document.getElementById('task');
const elQ = document.getElementById('q');
const elAvviso = document.getElementById('avvisoAi');
const elRisposta = document.getElementById('risposta');
const elVuoto = document.getElementById('vuoto');

// Per il filtro: minuscolo e senza accenti ("attività" trova "attivita").
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Scheda normale: l'attività in grande, l'app in piccolo.
const schedaHtml = (a) => `
    <button type="button" class="t" data-id="${esc(a.id)}" aria-describedby="tip-${esc(a.id)}">
      <span class="ic">${icona(a.id)}</span>
      <span><b>${esc(a.fai || a.nome)}</b><small>con <i>${esc(a.nome)}</i> · ${esc(a.sottotitolo)}</small></span>
      <span class="fr">${FRECCIA}</span>
      <span class="tip" role="tooltip" id="tip-${esc(a.id)}">${esc(a.guida || a.desc)}<em>Clic per aprire ${esc(a.nome)}. Se è spenta parte da sola in qualche secondo.</em></span>
    </button>`;

// Scheda in evidenza (app principali: InCampo, SkyTower): grande, blu, con il
// nome dell'app come titolo, la descrizione per esteso e il pulsante "Apri".
const schedaGrandeHtml = (a) => `
    <button type="button" class="t grande" data-id="${esc(a.id)}" aria-describedby="tip-${esc(a.id)}">
      <span class="ic">${icona(a.id)}</span>
      <span class="testo"><small class="sopra">${esc(a.fai || '')}</small><b>${esc(a.nome)}</b><span class="sotto">${esc(a.sottotitolo)}</span><span class="desc">${esc(a.desc)}</span></span>
      <span class="apri-grande">Apri ${esc(a.nome)} ${FRECCIA}</span>
      <span class="tip" role="tooltip" id="tip-${esc(a.id)}">${esc(a.guida || a.desc)}<em>Clic per aprire ${esc(a.nome)}. Se è spenta parte da sola in qualche secondo.</em></span>
    </button>`;

function render() {
  const principali = apps.filter((a) => a.principale);
  const altre = apps.filter((a) => !a.principale);
  elTask.innerHTML =
    (principali.length ? `<div class="principali" id="principali"><p class="sez">In evidenza</p>${principali.map(schedaGrandeHtml).join('')}</div>` : '') +
    (principali.length && altre.length ? '<p class="sez" id="sezAltre">Tutti gli strumenti</p>' : '') +
    altre.map(schedaHtml).join('');
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
    const r = await fetch('/api/launch/' + encodeURIComponent(id), { method: 'POST', headers: { 'Content-Type': 'application/json' } });
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
  let visibiliGrandi = 0;
  for (const b of elTask.querySelectorAll('.t')) {
    const a = apps.find((x) => x.id === b.dataset.id);
    const ok = !q || norm([a.fai, a.nome, a.sottotitolo, a.desc, a.guida].join(' ')).includes(q);
    b.hidden = !ok;
    if (ok) { visibili++; if (b.classList.contains('grande')) visibiliGrandi++; }
  }
  // Con un filtro attivo le intestazioni delle sezioni spariscono se la sezione è vuota.
  const blocco = document.getElementById('principali');
  if (blocco) blocco.hidden = visibiliGrandi === 0;
  const sezAltre = document.getElementById('sezAltre');
  if (sezAltre) sezAltre.hidden = !!q || visibili === visibiliGrandi;
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
  await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
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

// ---------------------------------------------------------------- da fare oggi
// Cosa aspetta l'utente nelle app (task InCampo, documenti SkyTower, scadenze,
// magazzino): /api/da-fare le raccoglie col token di servizio. Clic → l'app
// alla pagina giusta. Se non c'è niente la sezione resta nascosta.
const ETICHETTE = { task: 'Task', nc: 'Non conformità', documento: 'Documento', scadenza: 'Scadenza', magazzino: 'Magazzino', avviso: 'Avviso' };
const dataIt = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '';
const oggiIso = () => new Date().toISOString().slice(0, 10);

function voceHtml(v) {
  const scaduta = v.data && v.data < oggiIso();
  const tag = v.tipo ? `<i class="dafare-tipo tipo-${esc(v.tipo)}">${ETICHETTE[v.tipo] || v.tipo}</i>` : '';
  const quando = v.data ? `<time class="${scaduta ? 'scaduta' : ''}" datetime="${esc(v.data)}">${scaduta ? 'scaduta il ' : ''}${dataIt(v.data)}</time>` : '';
  const dentro = `<span class="dafare-p p${v.priorita}" aria-hidden="true"></span><span class="dafare-testo"><b>${esc(v.titolo)}</b>${v.testo ? `<small>${esc(v.testo)}</small>` : ''}</span><span class="dafare-meta">${tag}${quando}</span>`;
  return v.url ? `<a class="dafare-voce" href="${esc(v.url)}" target="_blank" rel="noopener">${dentro}</a>` : `<span class="dafare-voce">${dentro}</span>`;
}

function renderDaFare(d) {
  const sez = document.getElementById('dafare');
  const gruppi = (d && d.gruppi) || [];
  const conVoci = gruppi.filter((g) => g.voci.length);
  const spente = gruppi.filter((g) => g.stato !== 'ok');
  if (!conVoci.length && !spente.length) { sez.hidden = true; return; }
  document.getElementById('dafareN').textContent = d.totale ? `${d.totale}` : '';
  document.getElementById('dafareGruppi').innerHTML =
    conVoci.map((g) => `<div class="dafare-gruppo"><h4><span class="ic">${icona(g.app)}</span>${esc(g.nome)}<em>${g.voci.length}</em></h4>${g.voci.map(voceHtml).join('')}</div>`).join('') +
    (spente.length ? `<p class="dafare-spente">Non raggiungibili ora: ${spente.map((g) => esc(g.nome)).join(', ')}. Si aggiornano da sole quando ripartono.</p>` : '');
  sez.hidden = false;
}

async function caricaDaFare(aggiorna) {
  try {
    const r = await fetch('/api/da-fare' + (aggiorna ? '?aggiorna=1' : ''));
    if (r.ok) renderDaFare(await r.json());
  } catch { /* la home funziona anche senza */ }
}
document.getElementById('dafareAggiorna').addEventListener('click', () => caricaDaFare(true));

async function init() {
  if (!(await loadMe())) return;
  caricaContatti();
  caricaDaFare(false);
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
