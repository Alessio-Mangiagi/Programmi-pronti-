// "><(((º> sabusabu <º)))><"
// Pagina Abilitazioni (solo admin): una riga per utente, una colonna per
// programma, una casella per incrocio. È la stessa informazione della finestra
// "Programmi" della pagina Utenti, ma vista tutta insieme.
//
// Le spunte non si salvano a ogni clic: si accumulano in `modifiche` e partono
// col pulsante "Salva modifiche", un PUT /api/utenti/<u>/apps per utente
// cambiato (l'elenco inviato SOSTITUISCE il precedente, vedi server.js). Così
// un giro di spunte fa una riga di registro per utente, non una per casella.
//
// Gli amministratori non hanno caselle: per ruolo vedono tutto (accessoApp in
// server.js). Le app adminOnly (Ponte Trimble, Auguri) non hanno colonna:
// seguono il ruolo, e la nota in testa lo dice.

let utenti = [];
let assegnabili = [];   // [{ id, nome, riservata }] — una colonna ciascuno
let me = null;
// username -> Set degli id spuntati, solo per gli utenti con modifiche non salvate.
const modifiche = new Map();

const $ = (id) => document.getElementById(id);
const json = (r) => r.json().catch(() => ({}));

async function loadMe() {
  const r = await fetch('/api/me');
  if (r.status === 401) { window.location.href = '/login'; return false; }
  me = await r.json();
  if (me.mustChange) { window.location.href = '/password'; return false; }
  $('userName').textContent = me.nome;
  $('avatar').textContent = iniz(me.nome);
  return true;
}

async function carica() {
  const r = await fetch('/api/utenti');
  if (r.status === 403) { window.location.href = '/'; return; }
  const d = await json(r);
  utenti = (d.utenti || []).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  assegnabili = d.assegnabili || [];
  const soloAdmin = (d.soloAdmin || []).map((a) => a.nome);
  $('notaSoloAdmin').hidden = !soloAdmin.length;
  $('notaSoloAdmin').textContent = soloAdmin.length
    ? `${soloAdmin.join(' e ')} non ${soloAdmin.length === 1 ? 'compare' : 'compaiono'}: ${soloAdmin.length === 1 ? 'lo usano' : 'li usano'} solo gli amministratori.`
    : '';
  render();
}

// Elenco attuale di un utente: quello in modifica se c'è, altrimenti il salvato.
function spuntati(u) {
  return modifiche.get(u.username) || new Set(u.apps || []);
}

const stessiElementi = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// Cambia una casella. Se l'elenco torna uguale al salvato la modifica sparisce:
// spuntare e rispuntare non lascia "1 modifica" fantasma.
function imposta(u, appId, acceso) {
  const s = new Set(spuntati(u));
  if (acceso) s.add(appId); else s.delete(appId);
  if (stessiElementi(s, new Set(u.apps || []))) modifiche.delete(u.username);
  else modifiche.set(u.username, s);
}

function visibili() {
  const q = $('cerca').value.trim().toLowerCase();
  const f = $('fStato').value;
  const admin = $('mostraAdmin').checked;
  return utenti.filter((u) =>
    (admin || u.ruolo !== 'admin') &&
    (!q || u.nome.toLowerCase().includes(q) || u.username.includes(q)) &&
    (!f || (f === 'attivo' && u.attivo) || (f === 'off' && !u.attivo)));
}

// Intestazione: nome del programma, quanti utenti (non admin) lo hanno, e i
// pulsanti "tutti / nessuno" che agiscono sulle righe visibili (rispettano
// ricerca e filtro: si abilita un programma a "tutti i cantieristi" cercando).
function renderTesta() {
  const nonAdmin = utenti.filter((u) => u.ruolo !== 'admin');
  $('testa').innerHTML = `<tr>
    <th class="ab-chi" scope="col">Utente</th>
    ${assegnabili.map((a) => {
      const n = nonAdmin.filter((u) => spuntati(u).has(a.id)).length;
      // piccola icona del programma sopra il nome (common.js, la stessa di home e plancia):
      // le colonne si riconoscono a colpo d'occhio senza allargarle. Il nome ha sempre l'altezza di
      // due righe e "riservato" lascia il suo posto anche quando non c'è (segnaposto invisibile),
      // così le icone stanno tutte sulla stessa riga.
      return `<th class="ab-app" scope="col">
        <span class="ab-ic">${iconaApp(a.id)}</span>
        <span class="ab-nome">${esc(a.nome)}</span>
        ${a.riservata ? '<span class="ris" title="Arriva solo a chi ha la spunta">riservato</span>' : '<span class="ris segnaposto" aria-hidden="true">riservato</span>'}
        <span class="ab-conta">${n === 1 ? '1 utente' : n + ' utenti'}</span>
        <span class="ab-col">
          <button type="button" class="ab-tutti" data-col="${esc(a.id)}" data-val="1" title="Spunta ${esc(a.nome)} a tutti gli utenti in elenco">tutti</button>
          <button type="button" class="ab-tutti" data-col="${esc(a.id)}" data-val="0" title="Togli ${esc(a.nome)} a tutti gli utenti in elenco">nessuno</button>
        </span>
      </th>`;
    }).join('')}
    <th class="ab-tot" scope="col">Totale</th>
  </tr>`;
}

function rigaHtml(u) {
  const admin = u.ruolo === 'admin';
  const s = spuntati(u);
  const salvati = new Set(u.apps || []);
  const celle = assegnabili.map((a) => {
    if (admin) return `<td class="ab-cella ab-adm" title="Amministratore: usa tutti i programmi"><span aria-label="sì, per ruolo">✓</span></td>`;
    const on = s.has(a.id);
    const cambiata = on !== salvati.has(a.id);
    return `<td class="ab-cella${cambiata ? ' ab-mod' : ''}"><input type="checkbox" data-u="${esc(u.username)}" data-a="${esc(a.id)}" ${on ? 'checked' : ''}
      aria-label="${esc(a.nome)} per ${esc(u.nome)}" /></td>`;
  }).join('');
  const tot = admin ? 'tutti' : String(s.size);
  const badge = admin ? ' <span class="st adm">Admin</span>' : (!u.attivo ? ' <span class="st off">Disattivato</span>' : '');
  return `<tr class="${u.attivo ? '' : 'off'}${modifiche.has(u.username) ? ' ab-riga-mod' : ''}">
    <th class="ab-chi" scope="row"><div class="chi"><span class="u-av">${esc(iniz(u.nome))}</span><span><b>${esc(u.nome)}${badge}</b><small>${esc(u.username)}${me && u.username === me.username ? ' · sei tu' : ''}</small></span></div></th>
    ${celle}
    <td class="ab-tot">${tot}</td>
  </tr>`;
}

function renderBarra() {
  const n = modifiche.size;
  $('barraSalva').hidden = n === 0;
  $('contaModifiche').innerHTML = n ? `<b>${n}</b> ${n === 1 ? 'utente modificato' : 'utenti modificati'}, non ancora salvat${n === 1 ? 'o' : 'i'}` : '';
}

function render() {
  const righe = visibili();
  renderTesta();
  $('righe').innerHTML = righe.map(rigaHtml).join('');
  $('vuoto').hidden = righe.length > 0;
  renderBarra();
}

// Una casella: aggiorna lo stato e ridisegna (righe, conteggi in testa, barra).
$('righe').addEventListener('change', (e) => {
  const c = e.target.closest('input[data-u]');
  if (!c) return;
  const u = utenti.find((x) => x.username === c.dataset.u);
  if (!u) return;
  imposta(u, c.dataset.a, c.checked);
  render();
  // Il ridisegno rifà le caselle: il fuoco torna su quella appena toccata,
  // così chi usa la tastiera (spazio, tab) non perde il segno.
  const di = $('righe').querySelector(`input[data-u="${CSS.escape(c.dataset.u)}"][data-a="${CSS.escape(c.dataset.a)}"]`);
  if (di) di.focus();
});

// "tutti" / "nessuno" in testa a una colonna: solo righe visibili, admin esclusi.
$('testa').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-col]');
  if (!b) return;
  const acceso = b.dataset.val === '1';
  const bersagli = visibili().filter((u) => u.ruolo !== 'admin');
  for (const u of bersagli) imposta(u, b.dataset.col, acceso);
  render();
});

['cerca', 'fStato', 'mostraAdmin'].forEach((id) => $(id).addEventListener(id === 'cerca' ? 'input' : 'change', render));

$('annulla').addEventListener('click', () => {
  modifiche.clear();
  render();
});

// Salva un utente alla volta: se uno fallisce (utente cancellato da un altro
// admin nel frattempo) gli altri passano lo stesso, e quello rimasto resta
// evidenziato con la modifica ancora da salvare.
$('salva').addEventListener('click', async () => {
  const b = $('salva');
  b.disabled = true;
  let ok = 0;
  const errori = [];
  for (const [username, s] of [...modifiche]) {
    const d = await fetch('/api/utenti/' + encodeURIComponent(username) + '/apps', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apps: [...s] }),
    }).then(json).catch(() => ({}));
    const u = utenti.find((x) => x.username === username);
    if (d.ok && u) {
      u.apps = d.apps;   // l'elenco come l'ha salvato il server (ripulito da filtraApps)
      modifiche.delete(username);
      ok++;
    } else {
      errori.push(`${u ? u.nome : username}: ${d.error || 'non salvato'}`);
    }
  }
  b.disabled = false;
  render();
  if (errori.length) alert('Alcune abilitazioni non sono state salvate:\n\n' + errori.join('\n'));
  else toast(ok === 1 ? 'Abilitazioni salvate per 1 utente' : `Abilitazioni salvate per ${ok} utenti`);
});

// Uscire con spunte non salvate: il browser chiede conferma.
window.addEventListener('beforeunload', (e) => {
  if (!modifiche.size) return;
  e.preventDefault();
  e.returnValue = '';
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  window.location.href = '/login';
});

loadMe().then((ok) => { if (ok) carica(); });
