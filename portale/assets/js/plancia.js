// "><(((º> sabusabu <º)))><"
// Plancia degli amministratori: barra delle app (lanciatore) + utenti e attività.
// Gli utenti normali ricevono index.html, la griglia di sempre.
//
// La logica di avvio, apertura e arresto è quella di prima, invariata: cambia
// solo dove vive. Ogni voce della barra è una .card[data-id] con dentro
// [data-launch] e [data-open], gli agganci che chat.js usa per avviare e
// aprire le app dalle risposte dell'assistente.

// Sigle per le colonne di testo (utenti, attività, "più usata"). Un programma
// aggiunto dagli admin (app-extra) non è qui: prende le prime tre lettere del nome.
const SIGLE = { ddt: 'DDT', agente: 'AI', confronta: 'PDF', ocr: 'OCR', scadenzario: 'SCA', requisiti: 'REQ', incampo: 'CAM', trimble: 'TRM', auguri: 'WA' };
const sigla = (a) => SIGLE[a.id] || String(a.nome || a.id).replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase();
// Nella barra delle app, le stesse icone della griglia (ICONS, in common.js);
// la sigla resta per chi un'icona non ce l'ha.
const marchio = (a) => ICONS[a.id] || esc(sigla(a));

let apps = [];
let isAdmin = false;   // solo gli admin del portale possono fermare le app
const online = {};     // id -> true/false, dall'ultimo giro di /api/status
const appById = (id) => apps.find((a) => a.id === id);

// ---------------------------------------------------------------- barra app

function cardHtml(a) {
  return `
    <div class="card${a.adminOnly ? ' adm' : ''}" data-id="${esc(a.id)}">
      <button class="hit" type="button" data-go="${esc(a.id)}" aria-label="${esc(a.nome)}: apri o avvia"></button>
      <span class="k">${marchio(a)}</span>
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
  login: 'Accesso', logout: 'Uscita', apri: 'Apertura', avvia: 'Avvio', ferma: 'Arresto',
  chiudi: 'Chiusura', evento: 'Azione', 'login-bloccato': 'Accesso bloccato',
  'richiesta-aiuto': 'Richiesta aiuto', 'reset-password': 'Reset password', 'richiesta-gestita': 'Richiesta gestita',
};

// ---------------------------------------------------------------- richieste di aiuto
// Dal login (password dimenticata / account bloccato). Ogni avviso dice chi è,
// come ricontattarlo e da dove scrive (IP interno o esterno alla rete aziendale).

async function caricaRichieste() {
  let r;
  try {
    const res = await fetch('/api/richieste');
    if (!res.ok) return;
    r = await res.json();
  } catch { return; }
  const lista = r.richieste || [];
  const box = document.getElementById('richieste');
  box.hidden = !lista.length;
  if (!lista.length) return;
  document.getElementById('richiesteN').textContent = lista.length === 1 ? '1 da gestire' : lista.length + ' da gestire';
  const el = document.getElementById('richiesteLista');
  // Una password temporanea appena generata non va cancellata dal giro di aggiornamento.
  if (el.querySelector('.pwd-temp')) return;
  el.innerHTML = lista.map((q) => {
    const account = q.username
      ? (q.account ? `account <b>${esc(q.username)}</b>` : `username «${esc(q.username)}» <span class="tag no">non esiste</span>`)
      : '<span class="tag no">username non indicato</span>';
    return `<li class="avviso" data-id="${esc(q.id)}">
      <div class="chi">
        <b>${esc(q.nome)} ${esc(q.cognome)}</b> chiede di reimpostare la password
        <p><a href="mailto:${esc(q.email)}">${esc(q.email)}</a> · ${account} · IP ${esc(q.ip)}
          <span class="tag ${q.interno ? 'interno' : 'esterno'}">${q.interno ? 'Interno' : 'Esterno'}</span> · ${esc(quando(q.ts))}</p>
        ${q.messaggio ? `<p class="msg">${esc(q.messaggio)}</p>` : ''}
      </div>
      <div class="az">
        ${q.account ? `<button type="button" class="primario" data-reimposta="${esc(q.id)}">Reimposta password</button>` : ''}
        <button type="button" data-gestita="${esc(q.id)}">Segna gestita</button>
      </div>
    </li>`;
  }).join('');
  el.querySelectorAll('[data-reimposta]').forEach((b) => b.addEventListener('click', () => gestisciRichiesta(b.dataset.reimposta, 'reimposta', b)));
  el.querySelectorAll('[data-gestita]').forEach((b) => b.addEventListener('click', () => gestisciRichiesta(b.dataset.gestita, 'gestita', b)));
}

async function gestisciRichiesta(id, azione, btn) {
  const li = btn.closest('.avviso');
  const nome = li.querySelector('.chi b').textContent;
  if (azione === 'reimposta' && !confirm(`Reimpostare la password di ${nome}?\n\nLa password attuale smette di funzionare e le sue sessioni aperte si chiudono. Riceverai una password temporanea da comunicargli.`)) return;
  li.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch(`/api/richieste/${encodeURIComponent(id)}/${azione}`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) { toast(data.error || 'Operazione non riuscita'); li.querySelectorAll('button').forEach((b) => { b.disabled = false; }); return; }
    if (data.password) {
      // Mostrata una sola volta: il server non la conserva in chiaro.
      const email = li.querySelector('.chi a').textContent;
      li.querySelector('.az').remove();
      const box = document.createElement('div');
      box.className = 'pwd-temp';
      box.innerHTML = `Password temporanea: <code>${esc(data.password)}</code>
        <button type="button" class="copia">Copia</button>
        <a href="mailto:${esc(email)}?subject=${encodeURIComponent('Portale Suite Cosedil — nuova password')}&body=${encodeURIComponent('Ciao,\n\nti ho reimpostato la password del portale.\nPassword temporanea: ' + data.password + '\n\nAl primo accesso ti verrà chiesto di sceglierne una nuova.\n')}">Mandala per email</a>
        <button type="button" class="fatto">Fatto</button>`;
      li.appendChild(box);
      box.querySelector('.copia').addEventListener('click', () => { navigator.clipboard.writeText(data.password).then(() => toast('Password copiata.'), () => toast('Copia non riuscita: selezionala a mano.')); });
      box.querySelector('.fatto').addEventListener('click', () => { li.remove(); caricaRichieste(); });
      toast('Password reimpostata e account sbloccato.');
    } else {
      li.remove();
      toast('Richiesta segnata come gestita.');
      caricaRichieste();
    }
  } catch {
    toast('Il portale non risponde. Riprova.');
    li.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

function durata(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 1) return 'meno di 1 min';
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
}

// Nome breve dell'app per le frasi ("in DDT dalle 10:03").
const nomeApp = (id) => { const a = appById(id); return a ? sigla(a) : id; };

// ---------------------------------------------------------------- calendario
// Mese a griglia (lunedì per primo). Ogni giorno ha un livello di attività
// (utenti distinti quel giorno, relativo al giorno più attivo del mese) e il
// dettaglio nel tooltip. Clic su un giorno = filtra le attività dell'utente
// selezionato su quel giorno; secondo clic o "Tutti i giorni" toglie il filtro.

let giorni = {};             // 'YYYY-MM-DD' -> { accessi, aperture, azioni, utenti } (da /api/plancia)
let meseVisto = null;        // Date al primo del mese mostrato
let giornoSel = null;        // 'YYYY-MM-DD' filtrato, o null

// '2026-10-13' -> "lunedì 13 ottobre" (da mezzogiorno: niente scivoloni di fuso).
const giornoTesto = (k) => new Date(k + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const chiaveGiorno = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

function renderCalendario() {
  const oggi = new Date();
  if (!meseVisto) meseVisto = new Date(oggi.getFullYear(), oggi.getMonth(), 1);
  const anno = meseVisto.getFullYear();
  const mese = meseVisto.getMonth();
  document.getElementById('calTitolo').textContent = meseVisto.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const stessoMese = anno === oggi.getFullYear() && mese === oggi.getMonth();
  document.getElementById('calOggi').hidden = stessoMese && !giornoSel;
  // Mese futuro: non c'è niente da vedere.
  document.getElementById('calNext').disabled = stessoMese || meseVisto > oggi;

  const nGiorni = new Date(anno, mese + 1, 0).getDate();
  const vuoti = (new Date(anno, mese, 1).getDay() + 6) % 7;   // lunedì = 0
  let max = 0;
  for (let g = 1; g <= nGiorni; g++) {
    const c = giorni[chiaveGiorno(new Date(anno, mese, g))];
    if (c && c.utenti > max) max = c.utenti;
  }

  const celle = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((n, i) => `<span class="cal-h${i > 4 ? ' we' : ''}">${n}</span>`);
  for (let i = 0; i < vuoti; i++) celle.push('<span class="cal-v" aria-hidden="true"></span>');
  const chiaveOggi = chiaveGiorno(oggi);
  for (let g = 1; g <= nGiorni; g++) {
    const d = new Date(anno, mese, g);
    const k = chiaveGiorno(d);
    const c = giorni[k];
    const futuro = d > oggi && k !== chiaveOggi;
    // 3 livelli: un giorno "pieno" è vicino al massimo del mese, non a un numero fisso.
    const lv = c && c.utenti ? Math.min(3, Math.max(1, Math.ceil((c.utenti / max) * 3))) : 0;
    const etichetta = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    const det = c
      ? `${c.utenti} ${c.utenti === 1 ? 'utente' : 'utenti'} · ${c.accessi} accessi · ${c.aperture} aperture · ${c.azioni} azioni`
      : 'nessuna attività';
    const cls = ['cal-d', lv ? 'lv' + lv : '', k === chiaveOggi ? 'oggi' : '', k === giornoSel ? 'sel' : '', d.getDay() % 6 === 0 ? 'we' : ''].filter(Boolean).join(' ');
    celle.push(`<button type="button" class="${cls}" data-giorno="${k}" ${futuro ? 'disabled' : ''}
      title="${esc(etichetta + ': ' + det)}" aria-label="${esc(etichetta + ', ' + det)}" aria-pressed="${k === giornoSel}">
      <b>${g}</b>${c && c.utenti ? `<small>${c.utenti}</small>` : ''}</button>`);
  }
  const grid = document.getElementById('calGrid');
  grid.innerHTML = celle.join('');
  grid.querySelectorAll('[data-giorno]').forEach((b) => b.addEventListener('click', () => {
    giornoSel = giornoSel === b.dataset.giorno ? null : b.dataset.giorno;
    renderCalendario();
    caricaAttivita();
  }));
}

function spostaMese(delta) {
  meseVisto = new Date(meseVisto.getFullYear(), meseVisto.getMonth() + delta, 1);
  renderCalendario();
}
document.getElementById('calPrev').addEventListener('click', () => spostaMese(-1));
document.getElementById('calNext').addEventListener('click', () => spostaMese(1));
document.getElementById('calOggi').addEventListener('click', () => {
  const oggi = new Date();
  meseVisto = new Date(oggi.getFullYear(), oggi.getMonth(), 1);
  giornoSel = null;
  renderCalendario();
  caricaAttivita();
});
document.getElementById('togliFiltro').addEventListener('click', () => {
  giornoSel = null;
  renderCalendario();
  caricaAttivita();
});

let me = null;               // utente collegato (da /api/me)
let utenti = [];             // righe di /api/plancia
let selezionato = null;      // username di cui si mostrano le attività

function renderUtenti() {
  const el = document.getElementById('utenti');
  if (!utenti.length) { el.innerHTML = '<p class="empty">Nessun utente registrato.</p>'; return; }
  el.innerHTML = utenti.map((u) => {
    const app = u.ultimaApp && appById(u.ultimaApp.appId);
    const ora = u.inUso || [];
    // Chi ha un'app aperta adesso lo si dice prima di tutto: è la domanda della plancia.
    const meta = ora.length
      ? 'Ora in ' + ora.map((x) => nomeApp(x.appId)).join(', ')
      : u.ultimoAccesso ? 'Ultimo accesso ' + quando(u.ultimoAccesso) : 'Mai entrato';
    return `<button type="button" class="urow" role="option" data-utente="${esc(u.username)}" aria-selected="${u.username === selezionato}">
      <span class="u-av${ora.length ? ' live' : u.attivoOggi ? ' oggi' : ''}" title="${ora.length ? 'In uso adesso' : u.attivoOggi ? 'Attivo oggi' : ''}">${esc(iniz(u.nome))}</span>
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

// Testo della riga: cosa è successo, con i dettagli che l'azione porta con sé.
function testoRiga(e, app) {
  const nomeB = app ? `<b>${esc(app.nome)}</b>` : e.appId ? `<b>${esc(e.appId)}</b>` : '';
  if (e.azione === 'chiudi') {
    const dal = e.inizio ? ora2(new Date(e.inizio)) + '–' + ora2(new Date(e.ts)) : '';
    return `${nomeB} <small>usata ${esc(dal)} · ${esc(durata(e.durataMin))}</small>`;
  }
  if (e.azione === 'evento') {
    return `${nomeB} · ${esc(e.evento || 'Azione')}` + (e.dettaglio ? ` <small>${esc(e.dettaglio)}</small>` : '');
  }
  if (e.azione === 'login') return 'Accesso al Portale';
  if (e.azione === 'logout') return 'Uscita dal Portale';
  return nomeB || esc(AZIONI[e.azione] || e.azione);
}

function renderTimeline(attivita, nome, inUso) {
  const el = document.getElementById('timeline');
  // In cima, le app aperte adesso: sessione ancora viva, chiusura non ancora nota.
  // Con un giorno passato filtrato, "Adesso" non c'entra.
  const conVive = !giornoSel || giornoSel === chiaveGiorno(new Date());
  const vive = (conVive ? inUso || [] : []).map((x) => {
    const app = appById(x.appId);
    return `<li class="live">
      <time datetime="${esc(x.dal)}">${esc(ora2(new Date(x.dal)))}</time>
      <span class="k">${app ? esc(sigla(app)) : '—'}</span>
      <span class="t"><b>${esc(app ? app.nome : x.appId)}</b> <small>aperta da ${esc(durata((Date.now() - Date.parse(x.dal)) / 60000))}</small></span>
      <span class="az">In uso ora</span></li>`;
  });
  if (!attivita.length && !vive.length) {
    el.innerHTML = giornoSel
      ? `<li class="empty">${esc(nome)} non ha attività registrate ${esc(giornoTesto(giornoSel))}.</li>`
      : `<li class="empty">${esc(nome)} non ha ancora attività registrate nel Portale.</li>`;
    return;
  }
  let ultimoGiorno = '';
  const righe = vive.length ? ['<li class="day">Adesso</li>', ...vive] : [];
  for (const e of giornoSel ? attivita : attivita.slice(0, 40)) {
    const d = new Date(e.ts);
    const g = giornoEtichetta(d);
    if (g !== ultimoGiorno) { righe.push(`<li class="day">${esc(g)}</li>`); ultimoGiorno = g; }
    const app = e.appId ? appById(e.appId) : null;
    // App non più nell'elenco (rimossa o non visibile): si mostra l'id, non si perde la riga.
    const testo = testoRiga(e, app);
    righe.push(`<li class="${e.azione === 'login-bloccato' ? 'warn' : e.azione === 'evento' ? 'ev' : ''}">
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
  document.getElementById('togliFiltro').hidden = !giornoSel;
  let r;
  try {
    const q = '?utente=' + encodeURIComponent(selezionato) + (giornoSel ? '&giorno=' + giornoSel : '');
    const res = await fetch('/api/attivita' + q);
    if (!res.ok) throw new Error();
    r = await res.json();
  } catch { document.getElementById('timeline').innerHTML = '<li class="empty">Attività non disponibili. Riprova tra poco.</li>'; return; }
  const n = r.numeri || {};
  const piu = n.piuUsata && appById(n.piuUsata.appId);
  document.getElementById('notaAttivita').textContent = giornoSel
    ? 'Solo ' + giornoTesto(giornoSel)
    : `${n.aperture7 ?? 0} app aperte in 7 gg` + (piu ? ` · più usata: ${sigla(piu)}` : '');
  renderTimeline(r.attivita || [], nome, r.inUso);
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
  giorni = r.giorni || {};
  renderOggi();
  renderCalendario();
  renderUtenti();
  caricaAttivita();
}

// ---------------------------------------------------------------- avvio

// Testata: la data di oggi in grande. Si riscrive a ogni aggiornamento, così
// una plancia lasciata aperta passa da sola al giorno dopo.
function renderOggi() {
  const d = new Date();
  document.getElementById('oggiNum').textContent = String(d.getDate());
  document.getElementById('oggiGiorno').textContent = d.toLocaleDateString('it-IT', { weekday: 'long' });
  document.getElementById('oggiMese').textContent = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

async function loadMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) { window.location.href = '/login'; return false; }
  me = await r.json();
  // Primo accesso / reset: obbligo di cambiare password.
  if (me.mustChange) { window.location.href = '/password'; return false; }
  document.getElementById('userName').textContent = me.nome;
  document.getElementById('avatar').textContent = iniz(me.nome);
  // admin del portale: ruolo "vero" oppure elevazione dall'IP (adminPortale).
  isAdmin = !!(me.adminPortale || me.ruolo === 'admin');
  document.getElementById('adminLink').hidden = !isAdmin;
  document.getElementById('avvisiLink').hidden = !isAdmin;
  return true;
}

// ---------------------------------------------------------------- avvisi

// Avvisi lasciati dai programmi (vedi /avvisi). Il contatore sta nella barra in
// alto; il riquadro si apre una volta per accesso, se c'è qualcosa da vedere.
async function aggiornaAvvisi(allAccesso) {
  if (!isAdmin) return;
  let data;
  try {
    const r = await fetch('/api/avvisi');
    if (!r.ok) return;
    data = await r.json();
  } catch { return; }
  const aperti = data.aperti || [];
  const errori = aperti.filter((a) => a.livello === 'errore').length;
  const n = document.getElementById('avvisiN');
  n.hidden = aperti.length === 0;
  n.textContent = aperti.length;
  n.classList.toggle('err', errori > 0);
  document.getElementById('avvisiLink').title = aperti.length
    ? `${aperti.length} da vedere${errori ? `, ${errori} errori` : ''}` : 'Nessun avviso da vedere';

  if (!allAccesso || !aperti.length) return;
  try {
    if (sessionStorage.getItem('avvisiMostrati')) return;
    sessionStorage.setItem('avvisiMostrati', '1');
  } catch { /* storage bloccato: si mostra comunque */ }
  document.getElementById('avvisiDlgSotto').textContent =
    `${aperti.length === 1 ? 'C\'è 1 avviso' : `Ci sono ${aperti.length} avvisi`} da vedere` +
    (errori ? `, di cui ${errori} ${errori === 1 ? 'errore' : 'errori'}.` : '.');
  const primi = aperti.slice(0, 5);
  document.getElementById('avvisiDlgLista').innerHTML = primi.map((a) =>
    `<li class="${esc(a.livello)}"><b>${esc(a.appNome)}</b> ${esc(a.titolo)}${a.n > 1 ? ` <small>(${a.n} volte)</small>` : ''}</li>`).join('') +
    (aperti.length > primi.length ? `<li class="altri">e altri ${aperti.length - primi.length}…</li>` : '');
  const dlg = document.getElementById('avvisiDlg');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}
document.getElementById('avvisiDlgDopo').addEventListener('click', () => {
  const dlg = document.getElementById('avvisiDlg');
  if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

async function init() {
  const ok = await loadMe();
  if (!ok) return;
  apps = (await (await fetch('/api/apps')).json()).apps;
  renderApps();
  renderOggi();
  renderCalendario();   // subito, vuoto: i livelli arrivano con /api/plancia
  aggiornaPlancia();
  aggiornaAvvisi(true);
  caricaRichieste();
  setInterval(caricaRichieste, 20000);   // una richiesta di aiuto non aspetta il minuto
  pollStatus();
  setInterval(pollStatus, 4000);
  setInterval(aggiornaPlancia, 60000);
  setInterval(() => aggiornaAvvisi(false), 60000);
}

init();
