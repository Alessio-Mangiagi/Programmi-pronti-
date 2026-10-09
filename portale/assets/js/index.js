// Icone per app (SVG stroke 1.5, stile Phosphor/Radix, niente emoji).
const ICONS = {
  ddt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="M9 13h6M9 17h4"/></svg>',
  agente: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"/></svg>',
  confronta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M7 7H4l3-4 3 4H7v6a2 2 0 0 0 2 2h1"/><path d="M17 17h3l-3 4-3-4h3v-6a2 2 0 0 0-2-2h-1"/></svg>',
  ocr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V6a2 2 0 0 1 2-2h2M17 4h2a2 2 0 0 1 2 2v2M21 16v2a2 2 0 0 1-2 2h-2M7 20H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10M9 9h6M9 15h4"/></svg>',
  scadenzario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 13v3l2 1.5"/></svg>',
  requisiti: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/><path d="m8 11 2.2 2.2L14.5 9"/></svg>',
  trimble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z"/><path d="M13 3v5a1 1 0 0 0 1 1h5"/><path d="M12 18v-6"/><path d="m9.5 14.5 2.5-2.5 2.5 2.5"/></svg>',
  auguri: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16v-8H4v8Z"/><path d="M4 15c1.5 0 1.5-1.5 3-1.5S8.5 15 10 15s1.5-1.5 3-1.5S15.5 15 17 15s1.5-1.5 3-1.5"/><path d="M12 8v5"/><circle cx="12" cy="5.5" r="1.3"/></svg>'
};
const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 14 8-14 8V4Z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';

let apps = [];
let isAdmin = false;   // solo gli admin del portale possono fermare le app
const grid = document.getElementById('grid');

function statusHtml(state) {
  if (state === 'online') return '<span class="status online"><span class="dot"></span>Attivo</span>';
  if (state === 'offline') return '<span class="status offline"><span class="dot"></span>Spento</span>';
  return '<span class="status checking"><span class="dot"></span>Verifica…</span>';
}

function render() {
  grid.innerHTML = apps.map(a => `
    <article class="card" data-id="${esc(a.id)}">
      <div class="card-top">
        <div class="card-icon">${ICONS[a.id] || ''}</div>
        <span data-status>${statusHtml('checking')}</span>
      </div>
      <h2>${esc(a.nome)}</h2>
      <p class="card-sub">${esc(a.sottotitolo)}</p>
      <p class="desc">${esc(a.desc)}</p>
      <div class="actions">
        <button class="btn btn-outline" data-launch="${esc(a.id)}">${PLAY_ICON} Avvia</button>
        <a class="btn btn-primary disabled" data-open="${esc(a.id)}" href="${esc(a.url)}" target="_blank" rel="noopener">${OPEN_ICON} Apri</a>
        ${isAdmin ? `<button class="btn btn-stop hidden" data-stop="${esc(a.id)}" title="Ferma ${esc(a.nome)}" aria-label="Ferma ${esc(a.nome)}">${STOP_ICON}</button>` : ''}
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('[data-launch]').forEach(btn => {
    btn.addEventListener('click', () => launch(btn.dataset.launch, btn));
  });
  grid.querySelectorAll('[data-stop]').forEach(btn => {
    btn.addEventListener('click', () => stop(btn.dataset.stop, btn));
  });
  grid.querySelectorAll('[data-open]').forEach(a => {
    a.addEventListener('click', (e) => {
      if (a.classList.contains('disabled')) { e.preventDefault(); return; }
      // Registra l'apertura (non blocca l'apertura in nuova scheda).
      fetch('/api/log-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: a.dataset.open }),
      }).catch(() => {});
    });
  });
}

// Attende che l'app risponda sulla sua porta: poll rapido (0,7s) fino al pronto
// o al timeout. Aggiorna la card appena è online.
function waitReady(id, { timeoutMs = 120000, intervalMs = 700 } = {}) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      let online = false;
      try { online = !!(await (await fetch('/api/status/' + encodeURIComponent(id))).json()).online; } catch {}
      if (online) {
        setCardState(id, true);
        return resolve(true);
      }
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function launch(id, btn) {
  const app = apps.find(a => a.id === id);
  // Apre subito una scheda "vuota" sul click (gesto utente): la navigheremo
  // quando l'app è pronta, aggirando il blocco dei popup differiti dei browser.
  let win = null;
  try { win = window.open('', '_blank'); } catch {}
  if (win) { try { win.document.write(`<title>Avvio…</title><body style="font:16px/1.5 system-ui;padding:2rem;color:#334">Avvio di <b>${esc(app.nome)}</b> in corso… la pagina si aprirà da sola appena è pronta.</body>`); } catch {} }

  btn.classList.add('busy');
  btn.disabled = true;
  btn.innerHTML = PLAY_ICON + ' Avvio…';
  const resetBtn = () => { btn.classList.remove('busy'); btn.disabled = false; btn.innerHTML = PLAY_ICON + ' Avvia'; };

  try {
    const r = await fetch('/api/launch/' + id, { method: 'POST' });
    const data = await r.json();
    if (!data.ok) { if (win) win.close(); toast('Errore: ' + (data.error || 'avvio non riuscito')); return; }

    toast(app.nome + ' in avvio — si aprirà da sola appena pronta.');
    const ready = await waitReady(id);
    if (ready) {
      if (win && !win.closed) win.location = app.url; else window.open(app.url, '_blank', 'noopener');
      // Registra l'apertura (come il pulsante "Apri").
      fetch('/api/log-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: id }),
      }).catch(() => {});
      toast(app.nome + ' pronto.');
    } else {
      if (win && !win.closed) win.close();
      toast(app.nome + ' ci mette più del solito. Riprova tra poco con "Apri".');
    }
  } catch (e) {
    if (win) win.close();
    toast('Errore di rete durante l\'avvio.');
  } finally {
    resetBtn();
  }
}

// Ferma un'app (solo admin). L'app è condivisa: se qualcun altro la sta usando
// la sua sessione muore, quindi si chiede conferma.
async function stop(id, btn) {
  const app = apps.find(a => a.id === id);
  if (!confirm(`Fermare ${app.nome}?\n\nChi lo sta usando in questo momento perde il lavoro non salvato.`)) return;

  btn.disabled = true;
  btn.classList.add('busy');
  try {
    const r = await fetch('/api/stop/' + encodeURIComponent(id), { method: 'POST' });
    const data = await r.json();
    if (data.ok) {
      toast(app.nome + ' fermato.');
      setCardState(id, false);
    } else {
      toast('Errore: ' + (data.error || 'chiusura non riuscita'));
    }
  } catch {
    toast('Errore di rete durante la chiusura.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}

// Stato di una card: pallino, "Apri" attivo, "Ferma" visibile solo se accesa.
function setCardState(id, online) {
  const card = grid.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  card.querySelector('[data-status]').innerHTML = statusHtml(online ? 'online' : 'offline');
  const openBtn = card.querySelector('[data-open]');
  if (openBtn) openBtn.classList.toggle('disabled', !online);
  const stopBtn = card.querySelector('[data-stop]');
  if (stopBtn) stopBtn.classList.toggle('hidden', !online);
}

function applyStatus(stati) {
  const map = Object.fromEntries(stati.map(s => [s.id, s.online]));
  // "><(((º> sabusabu <º)))><"
  apps.forEach(a => setCardState(a.id, !!map[a.id]));
}

async function pollStatus() {
  try {
    const r = await fetch('/api/status');
    const data = await r.json();
    applyStatus(data.apps);
  } catch (e) { /* silenzioso: il portale resta usabile */ }
}

async function loadMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) { window.location.href = '/login'; return false; }
  const me = await r.json();
  // Primo accesso / reset: obbligo di cambiare password.
  if (me.mustChange) { window.location.href = '/password'; return false; }
  document.getElementById('userName').textContent = me.nome;
  document.getElementById('avatar').textContent = iniz(me.nome);
  // admin del portale: ruolo "vero" oppure elevazione dall'IP (adminPortale).
  isAdmin = !!(me.adminPortale || me.ruolo === 'admin');
  if (isAdmin) document.getElementById('adminLink').style.display = 'inline-flex';
  return true;
}

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

async function init() {
  const ok = await loadMe();
  if (!ok) return;
  const r = await fetch('/api/apps');
  const data = await r.json();
  apps = data.apps;
  render();
  pollStatus();
  setInterval(pollStatus, 4000);
}

init();
