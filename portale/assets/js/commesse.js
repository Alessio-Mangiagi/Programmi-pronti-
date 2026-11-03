// "><(((º> sabusabu <º)))><"
// Pagina Commesse (solo admin): il registro unico della suite, modificabile
// sul posto. API: GET /api/commesse, PUT /api/commesse, POST /api/commesse/importa.
// Le righe si modificano nei campi; "Salva" manda tutto l'elenco (è il registro
// intero, non una riga per volta: poche decine di righe, nessuna concorrenza).

let commesse = [];
let sporco = false;
let me = null;

const $ = (id) => document.getElementById(id);
const json = (r) => r.json().catch(() => ({}));
const STATI = [['attiva', 'Attiva'], ['sospesa', 'Sospesa'], ['chiusa', 'Chiusa']];

async function loadMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) { window.location.href = '/login'; return false; }
  me = await r.json();
  if (!me.adminPortale) { window.location.href = '/'; return false; }
  $('userName').textContent = me.nome;
  $('avatar').textContent = iniz(me.nome);
  return true;
}

function esito(testo, errore) {
  const el = $('esito');
  el.textContent = testo;
  el.classList.toggle('err', !!errore);
  el.hidden = !testo;
}

function segnaSporco(v = true) {
  sporco = v;
  $('salva').disabled = !v;
}

function renderNumeri(meta) {
  $('kTot').textContent = commesse.length;
  $('kAttive').textContent = commesse.filter((c) => c.stato === 'attiva').length;
  $('kChiuse').textContent = commesse.filter((c) => c.stato !== 'attiva').length;
  $('kFonte').textContent = meta && meta.aggiornato ? `aggiornato ${new Date(meta.aggiornato).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })} (${meta.fonte || 'manuale'})` : ' ';
}

function rigaHtml(c, i) {
  const opt = STATI.map(([v, t]) => `<option value="${v}"${c.stato === v ? ' selected' : ''}>${t}</option>`).join('');
  return `<tr data-i="${i}" class="${c.nuova ? 'nuova' : ''} ${c.stato !== 'attiva' ? 'chiusa' : ''}">
    <td><input class="codice" data-campo="code" value="${esc(c.code)}" maxlength="40" placeholder="101-003" aria-label="Codice" /></td>
    <td><input data-campo="nome" value="${esc(c.nome)}" maxlength="200" placeholder="Nome della commessa" aria-label="Nome" /></td>
    <td><select data-campo="stato" aria-label="Stato">${opt}</select></td>
    <td><input data-campo="cliente" value="${esc(c.cliente)}" maxlength="200" aria-label="Cliente" /></td>
    <td><input data-campo="indirizzo" value="${esc(c.indirizzo)}" maxlength="300" aria-label="Indirizzo" /></td>
    <td><input data-campo="note" value="${esc(c.note)}" maxlength="500" aria-label="Note" /></td>
    <td class="az"><button type="button" class="b rosso" data-del="${i}" title="Toglie la riga dal registro (le app che usano già questo codice non cambiano)">Togli</button></td>
  </tr>`;
}

function render() {
  const q = $('cerca').value.trim().toLowerCase();
  const visibili = commesse.map((c, i) => [c, i]).filter(([c]) =>
    !q || [c.code, c.nome, c.cliente].some((v) => String(v || '').toLowerCase().includes(q)));
  $('righe').innerHTML = visibili.map(([c, i]) => rigaHtml(c, i)).join('');
  $('vuoto').hidden = commesse.length > 0;
}

async function carica() {
  const r = await fetch('/api/commesse');
  if (r.status === 403 || r.status === 401) { window.location.href = '/'; return; }
  const d = await json(r);
  commesse = (d.commesse || []).map((c) => Object.assign({ code: '', nome: '', stato: 'attiva', cliente: '', indirizzo: '', note: '' }, c));
  renderNumeri(d);
  render();
  segnaSporco(false);
}

// Doppioni (stesso codice senza spazi/maiuscole) e codici vuoti bloccano il salvataggio.
function controlla() {
  const visti = new Map();
  let errori = 0;
  $('righe').querySelectorAll('input.codice').forEach((inp) => {
    const k = inp.value.replace(/\s+/g, '').toUpperCase();
    const male = !k || visti.has(k);
    inp.setAttribute('aria-invalid', male ? 'true' : 'false');
    if (male) errori++; else visti.set(k, true);
  });
  return errori;
}

$('righe').addEventListener('input', (e) => {
  const tr = e.target.closest('tr');
  const campo = e.target.dataset.campo;
  if (!tr || !campo) return;
  commesse[Number(tr.dataset.i)][campo] = e.target.value;
  if (campo === 'stato') tr.classList.toggle('chiusa', e.target.value !== 'attiva');
  segnaSporco(true);
  controlla();
});
$('righe').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-del]');
  if (!b) return;
  commesse.splice(Number(b.dataset.del), 1);
  render();
  segnaSporco(true);
});
$('cerca').addEventListener('input', render);

$('aggiungi').addEventListener('click', () => {
  $('cerca').value = '';
  commesse.push({ code: '', nome: '', stato: 'attiva', cliente: '', indirizzo: '', note: '', nuova: true });
  render();
  segnaSporco(true);
  const ultimo = $('righe').querySelector('tr:last-child input.codice');
  if (ultimo) ultimo.focus();
});

$('salva').addEventListener('click', async () => {
  const errori = controlla();
  if (errori) { esito(`${errori} ${errori === 1 ? 'riga ha' : 'righe hanno'} codice vuoto o doppio: correggi prima di salvare.`, true); return; }
  $('salva').disabled = true;
  const r = await fetch('/api/commesse', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commesse }) });
  const d = await json(r);
  if (!r.ok) { esito(d.error || 'Salvataggio non riuscito', true); $('salva').disabled = false; return; }
  esito(`Registro salvato: ${d.commesse.length} commesse. Le app lo leggono subito.`);
  await carica();
});

$('importa').addEventListener('click', async () => {
  if (sporco && !confirm('Ci sono modifiche non salvate: l\'importazione le scarta. Continuo?')) return;
  $('importa').disabled = true;
  esito('Chiedo le commesse a InCampo, SkyTower e Magazzino…');
  const r = await fetch('/api/commesse/importa', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const d = await json(r);
  $('importa').disabled = false;
  if (!r.ok) { esito(d.error || 'Importazione non riuscita', true); return; }
  const fonti = (d.fonti || []).map((f) => `${f.app}: ${f.stato === 'ok' ? f.n + ' lette' : f.stato}`).join(' · ');
  esito(`Importate: ${d.aggiunte} nuove, ${d.completate} completate. ${fonti}`);
  await carica();
});

$('logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); window.location.href = '/login'; });
window.addEventListener('beforeunload', (e) => { if (sporco) { e.preventDefault(); e.returnValue = ''; } });

(async () => { if (await loadMe()) await carica(); })();
