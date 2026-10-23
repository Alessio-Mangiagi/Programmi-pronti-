// Pagina Avvisi (solo admin): gli avvisi che i programmi della suite lasciano
// al portale (shared/avvisi) e quelli del portale stesso. Un avviso resta qui
// finché un admin non lo segna come visto; poi passa nello storico.
// "><(((º> sabusabu <º)))><"

const LIVELLO_LABEL = { errore: 'Errore', attenzione: 'Attenzione', info: 'Informazione' };

let aperti = [];
let visti = [];

function fmtData(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' +
         d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

async function loadMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) { window.location.href = '/login'; return; }
  const me = await r.json();
  if (me.mustChange) { window.location.href = '/password'; return; }
  document.getElementById('userName').textContent = me.nome;
  document.getElementById('avatar').textContent = iniz(me.nome);
}

async function loadAvvisi() {
  const r = await fetch('/api/avvisi');
  if (r.status === 401) { window.location.href = '/login'; return; }
  if (!r.ok) { toast('Accesso negato'); return; }
  const data = await r.json();
  aperti = data.aperti || [];
  visti = data.visti || [];
  populateFilters();
  renderStats();
  renderAperti();
  renderVisti();
}

function populateFilters() {
  const fApp = document.getElementById('fApp');
  const scelto = fApp.value;
  const apps = [...new Map([...aperti, ...visti].map((a) => [a.app, a.appNome])).entries()];
  fApp.innerHTML = '<option value="">Tutti i programmi</option>' +
    apps.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
  if (apps.some(([id]) => id === scelto)) fApp.value = scelto;
}

function renderStats() {
  const conta = (l) => aperti.filter((a) => a.livello === l).length;
  const programmi = new Set(aperti.map((a) => a.app)).size;
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="label">Da vedere</div><div class="value">${aperti.length}</div></div>
    <div class="stat"><div class="label">Errori</div><div class="value${conta('errore') ? ' rosso' : ''}">${conta('errore')}</div></div>
    <div class="stat"><div class="label">Attenzione</div><div class="value">${conta('attenzione')}</div></div>
    <div class="stat"><div class="label">Programmi coinvolti</div><div class="value">${programmi}</div></div>`;
}

function filtrati() {
  const app = document.getElementById('fApp').value;
  const liv = document.getElementById('fLivello').value;
  return aperti.filter((a) => (!app || a.app === app) && (!liv || a.livello === liv));
}

function avvisoHtml(a) {
  const quando = a.n > 1
    ? `${a.n} volte · prima ${esc(fmtData(a.data))} · ultima ${esc(fmtData(a.ultimo))}`
    : esc(fmtData(a.data));
  return `
    <li class="avviso ${esc(a.livello)}">
      <div class="avviso-testa">
        <span class="badge liv-${esc(a.livello)}"><span class="dot"></span>${esc(LIVELLO_LABEL[a.livello] || a.livello)}</span>
        <span class="avviso-app">${esc(a.appNome)}</span>
        <span class="avviso-quando">${quando}</span>
      </div>
      <p class="avviso-titolo">${esc(a.titolo)}</p>
      ${a.testo ? `<p class="avviso-testo">${esc(a.testo)}</p>` : ''}
      <button class="btn-link" type="button" data-visto="${esc(a.id)}">Segna come visto</button>
    </li>`;
}

function renderAperti() {
  const lista = filtrati();
  document.getElementById('aperti').innerHTML = lista.map(avvisoHtml).join('');
  document.getElementById('apertiEmpty').hidden = lista.length > 0;
  document.getElementById('tuttiVisti').disabled = aperti.length === 0;
  document.querySelectorAll('[data-visto]').forEach((b) =>
    b.addEventListener('click', () => segnaVisto({ id: b.dataset.visto }, b)));
}

function renderVisti() {
  document.getElementById('vistiBody').innerHTML = visti.map((a) => `
    <tr>
      <td class="muted">${esc(fmtData(a.ultimo || a.data))}</td>
      <td>${esc(a.appNome)}</td>
      <td><span class="badge liv-${esc(a.livello)}"><span class="dot"></span>${esc(LIVELLO_LABEL[a.livello] || a.livello)}</span> ${esc(a.titolo)}${a.n > 1 ? ` <span class="muted">(${a.n} volte)</span>` : ''}</td>
      <td class="muted">${esc(a.visto_da)} · ${esc(fmtData(a.visto_il))}</td>
    </tr>`).join('');
  document.getElementById('vistiEmpty').hidden = visti.length > 0;
}

async function segnaVisto(corpo, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/avvisi/visto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
    const data = await r.json();
    if (!data.ok) { toast(data.error || 'Errore'); if (btn) btn.disabled = false; return; }
    toast(data.visti === 1 ? 'Avviso segnato come visto' : `${data.visti} avvisi segnati come visti`);
    loadAvvisi();
  } catch {
    toast('Portale non raggiungibile');
    if (btn) btn.disabled = false;
  }
}

document.getElementById('fApp').addEventListener('change', renderAperti);
document.getElementById('fLivello').addEventListener('change', renderAperti);
document.getElementById('tuttiVisti').addEventListener('click', (e) => {
  if (!confirm(`Segnare come visti tutti i ${aperti.length} avvisi?`)) return;
  segnaVisto({ tutti: true }, e.currentTarget);
});
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

loadMe();
loadAvvisi();
// Gli avvisi arrivano anche mentre la pagina è aperta.
setInterval(() => { if (!document.hidden) loadAvvisi(); }, 60_000);
